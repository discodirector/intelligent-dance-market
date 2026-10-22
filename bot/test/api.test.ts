import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_GENRES as SYNTH_GENRES } from "@swarm-sequencer/synth";
import { createHandler, type Deps } from "../src/api/app.ts";
import { DATA_GENRES, LIMITS, PAY_CHAINS, PRICES, STABLES, type ApiConfig } from "../src/api/config.ts";
import { cachedCheck, cachedImdPrice } from "../src/api/market.ts";
import { checkPayment, stableTransfers, type ReceiptLike } from "../src/api/payments.ts";
import { formatUnits, pickTag, quoteFor, tagged, TAG_MAX, usdFor } from "../src/api/pricing.ts";
import { RateLimiter } from "../src/api/ratelimit.ts";
import { stateOf, Store, type Application } from "../src/api/store.ts";
import { applyReq, contact, genres, Invalid, payReq, renewReq, vibe } from "../src/api/validate.ts";
import type { Registry, RegistryEntry } from "../src/station.ts";
import type { Report } from "../src/stations/eligibility.ts";
import { addMonths, buildStatus, expiring, paidEnd, renewedUntil, stationStatus } from "../src/stations/subscription.ts";

// Real receipts, recorded 2026-10-22 (raw JSON-RPC): a 165 USDC transfer on Base and a 354.4 USDT transfer on Ethereum.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as { chainId: number; blockTime: number; receipt: ReceiptLike & { transactionHash: string } };
const BASE = fixture("receipt-base-usdc");
const ETH = fixture("receipt-eth-usdt");
const BASE_TO = "0x4a1d84b766679cd4920cb6052309d3854c20d43f";
const ETH_TO = "0x467b35b891e7a2497795e377bd66904f9cc10c64";
const LAUNCH = PRICES.launch;

/** An application quoted at `cents` with `tag`, created a minute before the fixture's block. */
function app(over: Partial<Application> & { cents?: number; tag?: number; at?: number } = {}): Application {
  const at = (over.at ?? BASE.blockTime) * 1000 - 60_000;
  const q = quoteFor({ kind: "renew", months: 1 }, LAUNCH, over.tag ?? 123);
  if (over.cents) for (const a of q.amounts) a.amount = tagged(over.cents, over.tag ?? 123, a.decimals).toString();
  return { id: "a".repeat(24), kind: "renew", key: "infer", months: 1, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + LIMITS.quoteTtlMs).toISOString(), payTo: BASE_TO, quote: q, ...over };
}

describe("pricing", () => {
  it("setup = fee + IMD part at the order price, cents rounded up; renewals flat", () => {
    const u = usdFor({ kind: "setup" }, LAUNCH, 12.3456);
    expect(u.imd).toEqual({ amount: 1.5, priceUsd: 12.3456, usd: 18.52 }); // 18.5184 -> 18.52
    expect(u.totalCents).toBe(6852);
    expect(usdFor({ kind: "setup" }, PRICES.regular, 10).totalCents).toBe(10_000 + 3_000);
    expect(usdFor({ kind: "renew", months: 1 }, LAUNCH).totalCents).toBe(3000);
    expect(usdFor({ kind: "renew", months: 3 }, LAUNCH).totalCents).toBe(7500);
    expect(usdFor({ kind: "renew", months: 3 }, PRICES.regular).totalCents).toBe(12_500);
    expect(() => usdFor({ kind: "setup" }, LAUNCH)).toThrow(/IMD price/);
    expect(() => usdFor({ kind: "setup" }, LAUNCH, 0)).toThrow(/IMD price/);
  });

  it("the tag is 0.00xyz on top of the cents, exact in base units", () => {
    expect(tagged(6852, 123, 6)).toBe(68_521_230n);
    expect(formatUnits(68_521_230n, 6)).toBe("68.52123");
    expect(tagged(3000, 1, 6)).toBe(30_000_010n);
    expect(formatUnits(30_000_010n, 6)).toBe("30.00001");
    expect(tagged(3000, 999, 18)).toBe(30n * 10n ** 18n + 999n * 10n ** 13n);
    expect(formatUnits(5n, 6)).toBe("0.000005");
    expect(formatUnits(30_000_000n, 6)).toBe("30");
    expect(() => tagged(3000, 0, 6)).toThrow();
    expect(() => tagged(3000, 1000, 6)).toThrow();
    expect(() => tagged(3000, 1, 4)).toThrow();
  });

  it("a quote lists every accepted stable with the same tagged amount", () => {
    const q = quoteFor({ kind: "setup" }, LAUNCH, 42, 12.3456);
    expect(q.amounts).toHaveLength(STABLES.length);
    for (const a of q.amounts) expect(a.display).toBe("68.52042");
    expect(new Set(q.amounts.map((a) => `${a.chainId}:${a.token}`)).size).toBe(STABLES.length);
  });

  it("tags are unique among open quotes; none left = null", () => {
    const taken = new Set<number>();
    for (let i = 0; i < TAG_MAX; i++) {
      const t = pickTag(taken)!;
      expect(taken.has(t)).toBe(false);
      taken.add(t);
    }
    expect(pickTag(taken)).toBeNull();
    expect(pickTag([1, 2, 3], () => 0)).toBe(4);
  });

  it("stables: 6 decimals, five chains (Robinhood: USDG), Base USDC only; genres = synth DATA_GENRES", () => {
    expect(new Set(STABLES.map((s) => s.chainId))).toEqual(new Set([1, 8453, 42161, 143, 4663]));
    expect(STABLES.filter((s) => s.chainId === 8453).map((s) => s.symbol)).toEqual(["USDC"]);
    expect(STABLES.filter((s) => s.chainId === 4663).map((s) => s.symbol)).toEqual(["USDG"]);
    for (const s of STABLES) expect(PAY_CHAINS[s.chainId]).toBeDefined();
    for (const s of STABLES) expect(s.decimals).toBe(6);
    expect([...DATA_GENRES]).toEqual([...SYNTH_GENRES]);
  });
});

describe("payment verification (recorded receipts)", () => {
  const base = (a: Application, over: Partial<Parameters<typeof checkPayment>[0]> = {}) =>
    checkPayment({ app: a, chainId: 8453, receipt: BASE.receipt, blockTime: BASE.blockTime, head: BigInt(BASE.receipt.blockNumber) + 100n, others: [], ...over });

  it("decodes the stable's Transfer and ignores other logs", () => {
    const t = stableTransfers(8453, BASE.receipt.logs);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ to: BASE_TO, value: 165_000_000n });
    expect(t[0].stable.symbol).toBe("USDC");
    expect(stableTransfers(1, BASE.receipt.logs)).toEqual([]); // same logs, other chain: not its USDC
    const e = stableTransfers(1, ETH.receipt.logs);
    expect(e[0]).toMatchObject({ to: ETH_TO, value: 354_400_000n });
    expect(e[0].stable.symbol).toBe("USDT");
  });

  it("accepts a transfer to payTo at or above the quote", () => {
    const r = base(app({ cents: 8137 }));
    expect(r.ok).toBe(true);
    const eth = checkPayment({ app: app({ payTo: ETH_TO, at: ETH.blockTime, cents: 30000 }), chainId: 1, receipt: ETH.receipt, blockTime: ETH.blockTime, head: BigInt(ETH.receipt.blockNumber) + 6n, others: [] });
    expect(eth.ok).toBe(true);
  });

  it("refuses: underpaid, another recipient, reverted, other chain", () => {
    expect(base(app({ cents: 20000 }))).toMatchObject({ ok: false, code: "underpaid" });
    expect(base(app({ cents: 8137, payTo: ETH_TO }))).toMatchObject({ ok: false, code: "no-transfer" });
    expect(base(app({ cents: 8137 }), { receipt: { ...BASE.receipt, status: "0x0" } })).toMatchObject({ ok: false, code: "reverted" });
    expect(base(app({ cents: 8137 }), { chainId: 1 })).toMatchObject({ ok: false, code: "no-transfer" });
  });

  it("refuses a transfer that is exactly another open quote's amount (a swapped tx hash)", () => {
    const mine = app({ cents: 8137 });
    const theirs = app({ id: "b".repeat(24) });
    for (const a of theirs.quote.amounts) a.amount = "165000000";
    expect(base(mine, { others: [theirs] })).toMatchObject({ ok: false, code: "other-application" });
    // Its own exact amount is never refused, whatever the others hold.
    const exact = app({ cents: 8137 });
    for (const a of exact.quote.amounts) a.amount = "165000000";
    expect(base(exact, { others: [theirs] }).ok).toBe(true);
  });

  it("the window: not before the quote, not after its expiry + grace", () => {
    expect(base(app({ cents: 8137, at: BASE.blockTime + 3600 }))).toMatchObject({ ok: false, code: "before-quote" });
    const late = app({ cents: 8137, at: BASE.blockTime - (LIMITS.quoteTtlMs + LIMITS.graceMs) / 1000 - 120 });
    expect(base(late)).toMatchObject({ ok: false, code: "after-expiry" });
    const inGrace = app({ cents: 8137, at: BASE.blockTime - LIMITS.quoteTtlMs / 1000 - 60 });
    expect(base(inGrace).ok).toBe(true);
  });

  it("waits for confirmations (Base 30)", () => {
    const r = base(app({ cents: 8137 }), { head: BigInt(BASE.receipt.blockNumber) + 4n });
    expect(r).toMatchObject({ ok: false, code: "confirming", confirmations: 5, required: 30 });
    expect(base(app({ cents: 8137 }), { head: BigInt(BASE.receipt.blockNumber) + 29n }).ok).toBe(true);
  });
});

describe("validation", () => {
  const chains = [1, 8453];
  const ok = { chainId: 1, token: "0x53d0ea0a685220718dc6a0a6e4617194c6f37921", contact: { kind: "x", value: "@theidmfun" }, vibe: "dark  rolling\nliquid", plan: "setup" };

  it("apply: the known fields only, each checked", () => {
    expect(applyReq(ok, chains, 300)).toMatchObject({ chainId: 1, contact: { kind: "x", value: "theidmfun" }, vibe: "dark rolling liquid", genres: [] });
    expect(() => applyReq({ ...ok, extra: 1 }, chains, 300)).toThrow(/unknown field: extra/);
    expect(() => applyReq({ ...ok, chainId: 56 }, chains, 300)).toThrow(/chainId/);
    expect(() => applyReq({ ...ok, chainId: "1" }, chains, 300)).toThrow(/chainId/);
    expect(() => applyReq({ ...ok, token: "0x123" }, chains, 300)).toThrow(/token/);
    expect(() => applyReq({ ...ok, pool: "0xzz" }, chains, 300)).toThrow(/pool/);
    expect(applyReq({ ...ok, pool: "0x" + "AB".repeat(32) }, chains, 300).pool).toBe("0x" + "ab".repeat(32));
    expect(() => applyReq({ ...ok, plan: "renew" }, chains, 300)).toThrow(/plan/);
    expect(() => applyReq([ok], chains, 300)).toThrow(/object/);
  });

  it("contact: X, Telegram, email", () => {
    expect(contact({ kind: "telegram", value: "@imd_swarm" })).toEqual({ kind: "telegram", value: "imd_swarm" });
    expect(contact({ kind: "email", value: " a.b+c@theidm.fun " })).toEqual({ kind: "email", value: "a.b+c@theidm.fun" });
    expect(() => contact({ kind: "x", value: "way_too_long_handle_x" })).toThrow(Invalid);
    expect(() => contact({ kind: "telegram", value: "abc" })).toThrow(Invalid);
    expect(() => contact({ kind: "email", value: "a@b" })).toThrow(Invalid);
    expect(() => contact({ kind: "email", value: "<script>@x.io" })).toThrow(Invalid);
    expect(() => contact({ kind: "phone", value: "1" })).toThrow(Invalid);
  });

  it("vibe: one clean paragraph, bounded; genres: none or 2..5 known", () => {
    expect(vibe("a\u0000b‮c", 300)).toBe("a b c");
    expect(() => vibe("  \n ", 300)).toThrow(Invalid);
    expect(() => vibe("x".repeat(301), 300)).toThrow(/300/);
    expect(vibe("é".repeat(300), 300)).toHaveLength(300);
    expect(genres(undefined)).toEqual([]);
    expect(genres(["liquid", "acid"])).toEqual(["liquid", "acid"]);
    expect(() => genres(["liquid"])).toThrow(/2 to 5/);
    expect(() => genres(["liquid", "liquid"])).toThrow(/twice/);
    expect(() => genres(["liquid", "techno"])).toThrow(/one of/);
  });

  it("renew and pay", () => {
    expect(renewReq({ key: "infer", months: 3 })).toEqual({ key: "infer", months: 3 });
    expect(() => renewReq({ key: "infer", months: 2 })).toThrow(/months/);
    expect(() => renewReq({ key: "../x", months: 1 })).toThrow(/key/);
    const tx = "0x" + "Ab".repeat(32);
    expect(payReq({ applicationId: "f".repeat(24), chainId: 8453, txHash: tx }, chains).txHash).toBe(tx.toLowerCase());
    expect(() => payReq({ applicationId: "f".repeat(24), chainId: 8453, txHash: "0x12" }, chains)).toThrow(/txHash/);
    expect(() => payReq({ applicationId: "../../etc", chainId: 8453, txHash: tx }, chains)).toThrow(/applicationId/);
  });
});

describe("rate limit", () => {
  it("max per window per IP and bucket, then the window rolls", () => {
    const rl = new RateLimiter();
    const lim = { max: 3, windowMs: 1000 };
    for (let i = 0; i < 3; i++) expect(rl.take("check", "1.1.1.1", lim, 0).ok).toBe(true);
    expect(rl.take("check", "1.1.1.1", lim, 500)).toEqual({ ok: false, retryAfterMs: 500 });
    expect(rl.take("check", "2.2.2.2", lim, 500).ok).toBe(true);
    expect(rl.take("pay", "1.1.1.1", lim, 500).ok).toBe(true);
    expect(rl.take("check", "1.1.1.1", lim, 1000).ok).toBe(true);
  });

  it("the map stays bounded", () => {
    const rl = new RateLimiter(100);
    for (let i = 0; i < 1000; i++) rl.take("all", `10.0.${i >> 8}.${i & 255}`, { max: 1, windowMs: 60_000 }, i);
    expect(rl.size).toBeLessThanOrEqual(100);
  });
});

describe("caches", () => {
  it("eligibility: one run per token for 10 minutes, concurrent asks share it, another pool is another check", async () => {
    let t = 0, runs = 0;
    const report = { verdict: "pass", rules: [{}], reasons: [] } as unknown as Report;
    const check = cachedCheck({ weth: () => undefined, now: () => t, run: async () => (runs++, report) });
    await Promise.all([check(1, "0xA"), check(1, "0xa")]);
    expect(runs).toBe(1);
    t = LIMITS.checkCacheMs + 1;
    await check(1, "0xa");
    expect(runs).toBe(2);
    await check(1, "0xa", "0xpool");
    expect(runs).toBe(3);
  });

  it("IMD price: cached 5 minutes", async () => {
    let t = 0, reads = 0;
    const price = cachedImdPrice({ now: () => t, fetch: async () => (++reads, 12.5) });
    expect(await price()).toBe(12.5);
    await price();
    expect(reads).toBe(1);
    t = LIMITS.imdPriceCacheMs + 1;
    await price();
    expect(reads).toBe(2);
  });
});

describe("subscription", () => {
  const day = 86_400_000;
  const T = Date.parse("2026-10-22T12:00:00Z");
  const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({ key: "tok", label: "TOK/ETH", ticker: "TOK", program: "idm", chainId: 1, kind: "v2", genesisBlock: 1, token: "0x0000000000000000000000000000000000000001", status: "live", ...over });

  it("a date is paid through its UTC day; months clamp to the month's end", () => {
    expect(paidEnd("2026-10-22")).toBe(Date.parse("2026-10-23T00:00:00Z"));
    expect(paidEnd("2026-10-22T10:00:00Z")).toBe(Date.parse("2026-10-22T10:00:00Z"));
    expect(paidEnd(undefined)).toBeNull();
    expect(new Date(addMonths(Date.parse("2026-01-31T05:00:00Z"), 1)).toISOString()).toBe("2026-02-28T05:00:00.000Z");
    expect(new Date(addMonths(Date.parse("2026-11-30T00:00:00Z"), 3)).toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });

  it("expired = live, not house, paidUntil passed; no paidUntil never expires", () => {
    expect(stationStatus(entry({ paidUntil: "2026-10-21" }), undefined, T).status).toBe("expired");
    expect(stationStatus(entry({ paidUntil: "2026-10-22" }), undefined, T).status).toBe("live");
    expect(stationStatus(entry({ paidUntil: "2026-10-21", house: true }), undefined, T).status).toBe("live");
    expect(stationStatus(entry({ paidUntil: "2026-10-21", status: "paused" }), undefined, T).status).toBe("paused");
    expect(stationStatus(entry(), undefined, T)).toEqual({ status: "live" });
    // A paid renewal outruns the registry's date.
    expect(stationStatus(entry({ paidUntil: "2026-10-21" }), { paidUntil: "2026-11-21T00:00:00Z", renewals: [] }, T)).toEqual({ status: "live", paidUntil: "2026-11-21T00:00:00Z" });
  });

  it("a renewal extends from the end, or from now once lapsed", () => {
    expect(renewedUntil(entry({ paidUntil: "2026-10-30" }), undefined, 1, T)).toBe("2026-11-30T00:00:00Z");
    expect(renewedUntil(entry({ paidUntil: "2026-09-01" }), undefined, 3, T)).toBe("2027-01-22T12:00:00Z");
    expect(renewedUntil(entry(), { paidUntil: "2026-12-01T00:00:00Z", renewals: [] }, 1, T)).toBe("2027-01-01T00:00:00Z");
  });

  it("status file and reminders", () => {
    const reg = { chains: {}, stations: [entry({ key: "a", paidUntil: "2026-10-24" }), entry({ key: "b", paidUntil: "2026-12-01" }), entry({ key: "c", paidUntil: "2026-10-01" }), entry({ key: "h", house: true })] } as Registry;
    const st = buildStatus(reg, {}, T);
    expect(st).toEqual({ a: { status: "live", paidUntil: "2026-10-24" }, b: { status: "live", paidUntil: "2026-12-01" }, c: { status: "expired", paidUntil: "2026-10-01" }, h: { status: "live" } });
    expect(expiring(reg, st, T, 3).map((r) => [r.key, r.status])).toEqual([["c", "expired"], ["a", "live"]]);
    expect(expiring(reg, st, T + 40 * day, 3).map((r) => r.key)).toContain("b");
  });
});

describe("HTTP API (no network: fake chain, check and price)", () => {
  let dir: string, server: Server, url: string, store: Store;
  let receipt: ReceiptLike | null;
  let head: bigint;
  const now = () => BASE.blockTime * 1000 - 30_000; // the quotes are made 30 s before the recorded transfer
  const config: ApiConfig = { payTo: BASE_TO, open: true, tier: "launch", origins: ["https://theidm.fun"], trustProxy: true };
  const registry = { chains: {}, stations: [
    { key: "infer", label: "INFER/IMD", ticker: "INFER", program: "infer", chainId: 1, kind: "v4", genesisBlock: 1, token: "0x53d0ea0a685220718dc6a0a6e4617194c6f37921", status: "live", paidUntil: "2026-10-30" },
    { key: "idm", label: "$IDM", ticker: "IDM", program: "idm", chainId: 4663, kind: "hook", genesisBlock: 1, token: "0x4fe9f3823791c8b187b81ab8b7398d793fed28f6", status: "live", house: true },
  ] } as Registry;
  const pass = { chainId: 8453, pool: "0x" + "11".repeat(20), token: "0x" + "22".repeat(20), symbol: "TOK", checkedAt: "x", verdict: "pass", manualReviewAllowed: false, rules: [], reasons: [] } as Report;
  let report: Report;

  const start = async (over: Partial<Deps> = {}) => {
    const handle = createHandler({
      config, store, registry: () => registry, check: async () => report, imdUsd: async () => 12.3456,
      chain: { receipt: async () => receipt, blockTime: async () => BASE.blockTime, head: async () => head },
      stationsDataDir: join(dir, "stations-data"), checkChains: [1, 8453, 42161], now, rand: () => 0.5, log: () => {}, ...over,
    });
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/stations`;
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const apply = { chainId: 8453, token: "0x" + "22".repeat(20), contact: { kind: "telegram", value: "token_owner" }, vibe: "warm, late night", genres: ["liquid", "triphop"], plan: "setup" };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "api-test-"));
    store = new Store(dir);
    receipt = BASE.receipt;
    head = BigInt(BASE.receipt.blockNumber) + 100n;
    report = pass;
    await start();
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it("apply -> quote -> pay -> paid; the tx cannot pay twice", async () => {
    const r = await post("/apply", apply);
    expect(r.status).toBe(201);
    const q = await r.json();
    expect(q).toMatchObject({ state: "awaiting-payment", payTo: BASE_TO, quote: { totalUsd: "68.52" } });
    expect(q.quote.amounts.find((a: any) => a.chainId === 8453 && a.symbol === "USDC")).toMatchObject({ chain: "Base", confirmations: 30 });
    expect(JSON.stringify(q)).not.toContain("token_owner"); // contact never echoed

    const paid = await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ state: "paid", payment: { symbol: "USDC", value: "165000000" } });
    expect(store.usedTx()).toEqual({ [`8453:${BASE.receipt.transactionHash}`]: q.applicationId });
    // Again for the same application: idempotent. For another: refused.
    expect((await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash })).status).toBe(200);
    const q2 = await (await post("/apply", apply)).json();
    const again = await post("/pay", { applicationId: q2.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash });
    expect(again.status).toBe(409);
    const got = await (await fetch(`${url}/application/${q.applicationId}`)).json();
    expect(got.state).toBe("paid");
    expect(store.get(q.applicationId)!.contact).toEqual({ kind: "telegram", value: "token_owner" });
  });

  it("pay: not mined, confirming, refused", async () => {
    const q = await (await post("/apply", apply)).json();
    receipt = null;
    const a = await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash });
    expect([a.status, (await a.json()).code]).toEqual([202, "not-mined"]);
    receipt = BASE.receipt;
    head = BigInt(BASE.receipt.blockNumber) + 1n;
    const b = await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash });
    expect(b.status).toBe(202);
    expect(await b.json()).toMatchObject({ state: "confirming", pendingTx: { confirmations: 2, required: 30 } });
    receipt = { ...BASE.receipt, status: "0x0" };
    const c = await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash });
    expect([c.status, (await c.json()).code]).toEqual([422, "reverted"]);
  });

  it("eligibility is automatic: only PASS is quoted (no review), a registry token refused", async () => {
    report = { ...pass, verdict: "fail", reasons: ["holders 12 is below 100"] };
    expect((await post("/apply", apply)).status).toBe(422);
    // Even an UNAVAILABLE the old flow sent to the owner's review is refused now.
    report = { ...pass, verdict: "unavailable", manualReviewAllowed: true, reasons: ["sell: could not measure (could not verify sells automatically)"] };
    const r = await post("/apply", apply);
    const body = await r.json();
    expect([r.status, body.error]).toEqual([422, "could not verify eligibility automatically: sell: could not measure (could not verify sells automatically)"]);
    expect(store.list()).toHaveLength(0);
    const dup = await post("/apply", { ...apply, chainId: 1, token: "0x53d0ea0a685220718dc6a0a6e4617194c6f37921" });
    expect([dup.status, (await dup.json()).key]).toEqual([409, "infer"]);
  });

  it("renew: a paid renewal extends paidUntil and publishes status.json; house stations refused", async () => {
    expect((await post("/renew", { key: "idm", months: 1 })).status).toBe(400);
    expect((await post("/renew", { key: "nope", months: 1 })).status).toBe(404);
    const q = await (await post("/renew", { key: "infer", months: 3 })).json();
    expect(q.quote.totalUsd).toBe("75.00");
    const r = await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash });
    expect(await r.json()).toMatchObject({ state: "paid", paidUntil: "2027-01-31T00:00:00Z" });
    expect(store.subscriptions().infer.paidUntil).toBe("2027-01-31T00:00:00Z");
    const status = JSON.parse(readFileSync(join(dir, "stations-data", "status.json"), "utf8"));
    expect(status.infer).toEqual({ status: "live", paidUntil: "2027-01-31T00:00:00Z" });
  });

  it("closed without payTo or STATIONS_OPEN; payments of open quotes still verified when only closed to new ones", async () => {
    const q = await (await post("/apply", apply)).json();
    await new Promise((r) => server.close(r));
    await start({ config: { ...config, open: false } });
    expect((await post("/apply", apply)).status).toBe(503);
    expect((await post("/check", { chainId: 8453, token: apply.token })).status).toBe(503);
    expect((await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash })).status).toBe(200);
    await new Promise((r) => server.close(r));
    await start({ config: { ...config, payTo: null } });
    const r = await post("/pay", { applicationId: q.applicationId, chainId: 8453, txHash: BASE.receipt.transactionHash });
    expect([r.status, (await r.json()).error]).toEqual([503, "applications not open"]);
    expect(await (await fetch(`${url}/config`)).json()).toMatchObject({ open: false });
  });

  it("HTTP hygiene: CORS for theidm.fun only, body limit, JSON only, 404/405, per-IP limit", async () => {
    const opt = await fetch(url + "/check", { method: "OPTIONS", headers: { origin: "https://theidm.fun" } });
    expect([opt.status, opt.headers.get("access-control-allow-origin")]).toEqual([204, "https://theidm.fun"]);
    const evil = await post("/check", { chainId: 8453, token: apply.token }, { origin: "https://evil.example" });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect((await post("/check", "x".repeat(LIMITS.bodyBytes + 1))).status).toBe(413);
    expect((await post("/check", "{nope")).status).toBe(400);
    expect((await fetch(url + "/check", { method: "POST", body: "{}" })).status).toBe(415);
    expect((await fetch(url + "/check")).status).toBe(405);
    expect((await fetch(url + "/nothing")).status).toBe(404);
    expect((await fetch(`${url}/application/${"0".repeat(24)}`)).status).toBe(404);
    // check: 12 a minute per IP (the last X-Forwarded-For hop), another IP unaffected.
    const ip = { "x-forwarded-for": "9.9.9.9, 203.0.113.7" };
    for (let i = 0; i < 12; i++) expect((await post("/check", { chainId: 8453, token: apply.token }, ip)).status).toBe(200);
    const over = await post("/check", { chainId: 8453, token: apply.token }, ip);
    expect([over.status, over.headers.get("retry-after")]).toEqual([429, "60"]);
    expect((await post("/check", { chainId: 8453, token: apply.token }, { "x-forwarded-for": "203.0.113.8" })).status).toBe(200);
  });

  it("an open application's state: awaiting, then expired after the grace", () => {
    const a = app();
    const t = Date.parse(a.expiresAt);
    expect(stateOf(a, t, LIMITS.graceMs)).toBe("awaiting-payment");
    expect(stateOf(a, t + LIMITS.graceMs + 1, LIMITS.graceMs)).toBe("expired");
  });
});
