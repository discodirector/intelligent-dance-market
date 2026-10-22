// Station+ (docs/STATIONS.md "Station+"): prices, proration, slots, status, the API flows, the owner's notifications
// and the weekly posts' planning and captions.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../src/api/app.ts";
import { configFromEnv, LIMITS, PRICES, type ApiConfig } from "../src/api/config.ts";
import type { ReceiptLike } from "../src/api/payments.ts";
import { quoteFor, upgradeUsd, usdFor } from "../src/api/pricing.ts";
import { Store, type Application } from "../src/api/store.ts";
import { applyReq, renewReq, upgradeReq } from "../src/api/validate.ts";
import type { TimelineEntry } from "../src/lib/timeline.ts";
import type { Registry, RegistryEntry } from "../src/station.ts";
import type { Report } from "../src/stations/eligibility.ts";
import { plusSlots, upgradeDays } from "../src/stations/plus.ts";
import {
  cashtag, duePlusPost, failedPlus, plusCaption, PLUS_POST_RULES, plusTrack, postedPlus, trackSwaps, WEEK_MS, xHandle, type PlusPostStates,
} from "../src/stations/plusPosts.ts";
import { buildStatus, stationStatus } from "../src/stations/subscription.ts";
import { loopText, plusSlotsText, renewalText } from "../src/stations/telegram.ts";

const H = 3_600_000, DAY = 24 * H;
const T = Date.parse("2026-10-22T12:00:00Z");
const LAUNCH = PRICES.launch, REGULAR = PRICES.regular;
const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({ key: "tok", label: "TOK/ETH", ticker: "TOK", program: "idm", chainId: 1, kind: "v2", genesisBlock: 1, token: "0x0000000000000000000000000000000000000001", status: "live", ...over });

describe("Station+ prices", () => {
  it("setup as Station+ adds the first month's difference; renewals at Station+ prices; launch and regular", () => {
    expect(usdFor({ kind: "setup", plus: true }, LAUNCH, 12.3456)).toMatchObject({ feeUsd: 50, plusUsd: 60, totalCents: 5000 + 1852 + 6000 });
    expect(usdFor({ kind: "setup", plus: true }, REGULAR, 10).totalCents).toBe(10_000 + 3_000 + 10_000);
    expect(usdFor({ kind: "setup" }, LAUNCH, 12.3456).plusUsd).toBeUndefined();
    expect(usdFor({ kind: "renew", months: 1, plus: true }, LAUNCH).totalCents).toBe(9000);
    expect(usdFor({ kind: "renew", months: 3, plus: true }, LAUNCH).totalCents).toBe(22_500);
    expect(usdFor({ kind: "renew", months: 1, plus: true }, REGULAR).totalCents).toBe(15_000);
    expect(usdFor({ kind: "renew", months: 3, plus: true }, REGULAR).totalCents).toBe(37_500);
    // A plain renewal never carries an upgrade, even if asked.
    expect(usdFor({ kind: "renew", months: 1, upgradeDays: 5 }, LAUNCH)).toEqual({ feeUsd: 30, totalCents: 3000 });
  });

  it("the upgrade: (Station+ month - Station month) x days / 30, cents rounded up", () => {
    expect(upgradeUsd(10, LAUNCH)).toBe(20); // $2 a day at launch
    expect(upgradeUsd(1, REGULAR)).toBe(3.34); // $3.33... a day, rounded up
    expect(upgradeUsd(30, REGULAR)).toBe(100);
    expect(usdFor({ kind: "upgrade", days: 10 }, LAUNCH)).toEqual({ feeUsd: 20, upgrade: { days: 10, usd: 20 }, totalCents: 2000 });
    expect(usdFor({ kind: "renew", months: 1, plus: true, upgradeDays: 10 }, LAUNCH)).toEqual({ feeUsd: 90, upgrade: { days: 10, usd: 20 }, totalCents: 11_000 });
    expect(() => upgradeUsd(0, LAUNCH)).toThrow();
    expect(() => upgradeUsd(1.5, LAUNCH)).toThrow();
    // Tagged like any quote.
    expect(quoteFor({ kind: "upgrade", days: 10 }, LAUNCH, 7).amounts[0].display).toBe("20.00007");
  });

  it("days to upgrade: from the later of now and the Station+ end to the paid end, rounded up, the first hour free", () => {
    expect(upgradeDays(entry({ paidUntil: "2026-10-30" }), undefined, T)).toBe(9); // 8.5 days - 1 h
    expect(upgradeDays(entry({ paidUntil: "2026-10-30", plusUntil: "2026-10-25" }), undefined, T)).toBe(5);
    expect(upgradeDays(entry({ paidUntil: "2026-10-30T00:00:00Z", plusUntil: "2026-10-29T23:30:00Z" }), undefined, T)).toBe(0);
    expect(upgradeDays(entry({ paidUntil: "2026-10-30" }), { plusUntil: "2026-10-31T00:00:00Z", renewals: [] }, T)).toBe(0);
    expect(upgradeDays(entry({ paidUntil: "2026-10-01" }), undefined, T)).toBe(0); // lapsed
    expect(upgradeDays(entry(), undefined, T)).toBe(0); // never expires: nothing to prorate
    expect(upgradeDays(entry({ paidUntil: "2026-10-01" }), { paidUntil: "2026-11-22T12:00:00Z", renewals: [] }, T)).toBe(31);
  });
});

describe("Station+ status and slots", () => {
  it("status.json: plus only while live, unexpired and inside plusUntil; the later end wins; never a house station", () => {
    expect(stationStatus(entry({ paidUntil: "2026-11-22", plusUntil: "2026-11-22" }), undefined, T)).toEqual({ status: "live", paidUntil: "2026-11-22", plus: true, plusUntil: "2026-11-22" });
    expect(stationStatus(entry({ paidUntil: "2026-11-22", plusUntil: "2026-10-21" }), undefined, T)).toEqual({ status: "live", paidUntil: "2026-11-22" });
    expect(stationStatus(entry({ paidUntil: "2026-10-21", plusUntil: "2026-11-22" }), undefined, T).status).toBe("expired");
    expect(stationStatus(entry({ paidUntil: "2026-10-21", plusUntil: "2026-11-22" }), undefined, T).plus).toBeUndefined();
    expect(stationStatus(entry({ plusUntil: "2026-11-22", status: "paused" }), undefined, T).plus).toBeUndefined();
    expect(stationStatus(entry({ plusUntil: "2026-11-22", house: true }), undefined, T).plus).toBeUndefined();
    const sub = { paidUntil: "2026-12-22T00:00:00Z", plusUntil: "2026-12-22T00:00:00Z", renewals: [] };
    expect(stationStatus(entry({ paidUntil: "2026-11-22", plusUntil: "2026-10-01" }), sub, T)).toMatchObject({ plus: true, plusUntil: "2026-12-22T00:00:00Z" });
  });

  const app = (id: string, over: Partial<Application>): Application => ({
    id: id.repeat(24), kind: "setup", createdAt: new Date(T - 60_000).toISOString(), expiresAt: new Date(T + LIMITS.quoteTtlMs).toISOString(),
    payTo: "0x00000000000000000000000000000000000000aa", quote: quoteFor({ kind: "renew", months: 1 }, LAUNCH, 1), ...over,
  });
  const paid = { chainId: 1, txHash: `0x${"e".repeat(64)}` as const, token: "0x00000000000000000000000000000000000000cc" as const, symbol: "USDC", from: "0x00000000000000000000000000000000000000bb" as const, value: "1", block: 1, blockTime: 1, paidAt: "x" };

  it("taken = live Station+ stations + paid setups not on air yet + open quotes for a new one (one per station)", () => {
    const reg = { chains: {}, stations: [entry({ key: "a", paidUntil: "2026-11-22", plusUntil: "2026-11-22" }), entry({ key: "b", paidUntil: "2026-11-22" }), entry({ key: "c", paidUntil: "2026-11-22", plusUntil: "2026-10-01" })] } as Registry;
    const stages: Record<string, string> = { ["1".repeat(24)]: "ordered", ["2".repeat(24)]: "rejected", ["3".repeat(24)]: "live" };
    const apps = [
      app("1", { plus: true, payment: paid }), // paid, in the pipeline: holds a slot
      app("2", { plus: true, payment: paid }), // rejected: frees it
      app("3", { plus: true, payment: paid }), // live: counted as its station
      app("4", { plus: true }), // open setup quote
      app("5", { kind: "renew", key: "b", months: 1, plus: true }), // open quote for b
      app("6", { kind: "upgrade", key: "b" }), // b again: still one
      app("7", { kind: "renew", key: "a", months: 1, plus: true }), // a is on Station+ already: no new slot
      app("8", { plus: true, expiresAt: new Date(T - LIMITS.graceMs - 1).toISOString() }), // expired quote
      app("9", { kind: "renew", key: "c", months: 1 }), // plain renewal
    ];
    const s = plusSlots({ reg, subs: {}, apps, stage: (id) => stages[id], now: T, max: 6 });
    expect(s).toEqual({ max: 6, used: 4, left: 2, active: ["a"], pending: 1, quoted: 2 });
    expect(plusSlots({ reg, subs: {}, apps, stage: (id) => stages[id], now: T, max: 3 }).left).toBe(0);
    expect(plusSlots({ reg, subs: {}, apps, stage: (id) => stages[id], now: T, max: 6, except: "4".repeat(24) }).used).toBe(3);
    // A plus renewal paid for c makes it active again.
    expect(plusSlots({ reg, subs: { c: { plusUntil: "2026-12-01T00:00:00Z", renewals: [] } }, apps: [], stage: () => undefined, now: T, max: 6 }).active).toEqual(["a", "c"]);
  });

  it("STATION_PLUS_SLOTS: default 6, a whole number 0..50", () => {
    expect(configFromEnv({}).plusSlots).toBe(6);
    expect(configFromEnv({ STATION_PLUS_SLOTS: "3" }).plusSlots).toBe(3);
    expect(configFromEnv({ STATION_PLUS_SLOTS: "0" }).plusSlots).toBe(0);
    expect(() => configFromEnv({ STATION_PLUS_SLOTS: "six" })).toThrow(/STATION_PLUS_SLOTS/);
    expect(() => configFromEnv({ STATION_PLUS_SLOTS: "99" })).toThrow(/STATION_PLUS_SLOTS/);
  });

  it("requests: plus is a boolean; upgrade takes a key only", () => {
    const ok = { chainId: 1, token: "0x53d0ea0a685220718dc6a0a6e4617194c6f37921", contact: { kind: "x", value: "a" }, vibe: "v", plan: "setup" };
    expect(applyReq({ ...ok, plus: true }, [1], 300).plus).toBe(true);
    expect(applyReq(ok, [1], 300).plus).toBe(false);
    expect(() => applyReq({ ...ok, plus: "yes" }, [1], 300)).toThrow(/plus/);
    expect(renewReq({ key: "infer", months: 1, plus: true })).toEqual({ key: "infer", months: 1, plus: true });
    expect(upgradeReq({ key: "infer" })).toEqual({ key: "infer" });
    expect(() => upgradeReq({ key: "infer", days: 3 })).toThrow(/unknown field: days/);
    expect(() => upgradeReq({ key: "../x" })).toThrow(/key/);
  });
});

describe("Station+ over HTTP (no network)", () => {
  // The recorded 165 USDC transfer on Base (api.test.ts), quotes made 30 s before it (2026-10-21T17:59:27Z).
  const BASE = JSON.parse(readFileSync(new URL("./fixtures/receipt-base-usdc.json", import.meta.url), "utf8")) as { blockTime: number; receipt: ReceiptLike & { transactionHash: string } };
  const TO = "0x4a1d84b766679cd4920cb6052309d3854c20d43f";
  const now = () => BASE.blockTime * 1000 - 30_000;
  const pass = { chainId: 8453, pool: "0x" + "11".repeat(20), token: "0x" + "22".repeat(20), symbol: "TOK", checkedAt: "x", verdict: "pass", manualReviewAllowed: false, rules: [], reasons: [] } as Report;
  const apply = { chainId: 8453, token: "0x" + "22".repeat(20), contact: { kind: "x", value: "tok_owner" }, vibe: "warm", plan: "setup" };
  let dir: string, server: Server, url: string, store: Store, registry: Registry;

  const start = async (plusSlotsMax: number) => {
    const config: ApiConfig = { payTo: TO, open: true, tier: "launch", origins: [], trustProxy: true, plusSlots: plusSlotsMax };
    const handle = createHandler({
      config, store, registry: () => registry, check: async () => pass, imdUsd: async () => 12.3456,
      chain: { receipt: async () => BASE.receipt, blockTime: async () => BASE.blockTime, head: async () => BigInt(BASE.receipt.blockNumber as string) + 100n },
      stationsDataDir: join(dir, "stations-data"), checkChains: [8453], now, rand: () => 0.5, log: () => {},
    });
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/stations`;
  };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const pay = (id: string) => post("/pay", { applicationId: id, chainId: 8453, txHash: BASE.receipt.transactionHash });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "plus-test-"));
    store = new Store(dir);
    registry = { chains: {}, stations: [
      entry({ key: "infer", label: "INFER/IMD", ticker: "INFER", token: "0x53d0ea0a685220718dc6a0a6e4617194c6f37921", paidUntil: "2026-10-30" }),
      entry({ key: "old", paidUntil: "2026-10-01", token: "0x0000000000000000000000000000000000000002" }),
    ] };
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it("config shows the slots; a Station+ setup quotes the first month's difference", async () => {
    await start(6);
    const cfg = await (await fetch(url + "/config")).json();
    expect(cfg.plus).toEqual({ slots: 6, used: 0, left: 6, prorateDays: 30 });
    expect(cfg.prices).toMatchObject({ plusMonthUsd: 90, plusThreeMonthsUsd: 225 });
    const q = await post("/apply", { ...apply, plus: true });
    expect([q.status, q.body.plus, q.body.quote.totalUsd, q.body.quote.usd.plusUsd]).toEqual([201, true, "128.52", 60]);
    expect((await (await fetch(url + "/config")).json()).plus.left).toBe(5); // the open quote holds a slot
    expect((await pay(q.body.applicationId)).body.state).toBe("paid");
    expect(store.get(q.body.applicationId)!.plus).toBe(true);
  });

  it("a Station+ renewal pays the days already paid too and runs Station+ to the new end; status.json says so", async () => {
    await start(6);
    const q = await post("/renew", { key: "infer", months: 1, plus: true });
    // Paid to 2026-10-31T00:00Z from 2026-10-21T17:59Z: 9 d 6 h, less the free hour, rounded up = 10 days at $2.
    expect([q.status, q.body.quote.totalUsd, q.body.quote.usd.upgrade]).toEqual([201, "110.00", { days: 10, usd: 20 }]);
    const r = await pay(q.body.applicationId);
    expect(r.body).toMatchObject({ state: "paid", plus: true, paidUntil: "2026-11-30T00:00:00Z", plusUntil: "2026-11-30T00:00:00Z" });
    expect(store.subscriptions().infer).toMatchObject({ paidUntil: "2026-11-30T00:00:00Z", plusUntil: "2026-11-30T00:00:00Z", renewals: [{ months: 1, plan: "plus" }] });
    const status = JSON.parse(readFileSync(join(dir, "stations-data", "status.json"), "utf8"));
    expect(status.infer).toEqual({ status: "live", paidUntil: "2026-11-30T00:00:00Z", plus: true, plusUntil: "2026-11-30T00:00:00Z" });
    // Already Station+ to the end: nothing to upgrade. A plain renewal later keeps plusUntil (Station+ ends there).
    expect((await post("/upgrade", { key: "infer" })).body.code).toBe("nothing-to-upgrade");
  });

  it("an upgrade: prorated, Station+ to the paid end it was quoted for; an off-air station is told to renew", async () => {
    await start(6);
    const q = await post("/upgrade", { key: "infer" });
    expect([q.status, q.body.kind, q.body.quote.totalUsd, q.body.upgradeTo]).toEqual([201, "upgrade", "20.00", "2026-10-30"]);
    const r = await pay(q.body.applicationId);
    expect(r.body).toMatchObject({ state: "paid", plusUntil: "2026-10-30" });
    expect(store.subscriptions().infer).toEqual({ plusUntil: "2026-10-30", renewals: [expect.objectContaining({ months: 0, plan: "upgrade" })] });
    expect(JSON.parse(readFileSync(join(dir, "stations-data", "status.json"), "utf8")).infer).toMatchObject({ plus: true, plusUntil: "2026-10-30" });
    const off = await post("/upgrade", { key: "old" });
    expect([off.status, off.body.code]).toEqual([409, "not-live"]);
    // A plain renewal after the upgrade: paid further, Station+ still ends where it was paid to.
    const plain = await post("/renew", { key: "infer", months: 1 });
    expect(plain.body.quote.totalUsd).toBe("30.00");
  });

  it("full: new Station+ refused (setup, renewal, upgrade), plain Station still sold, a Station+ station keeps renewing", async () => {
    await start(1);
    const first = await post("/upgrade", { key: "infer" });
    expect(first.status).toBe(201);
    const full = await post("/apply", { ...apply, plus: true });
    expect([full.status, full.body.code, full.body.plus]).toEqual([409, "plus-full", { slots: 1, used: 1, left: 0 }]);
    expect(full.body.error).toMatch(/Station\+ is full \(1 of 1 taken\): a plain Station is still available/);
    expect((await post("/renew", { key: "old", months: 1, plus: true })).body.code).toBe("plus-full");
    expect((await post("/apply", apply)).status).toBe(201);
    expect((await post("/renew", { key: "old", months: 1 })).status).toBe(201);
    // The open upgrade quote holds infer's slot; once paid, infer is on Station+ and may renew as Station+.
    await pay(first.body.applicationId);
    expect((await post("/renew", { key: "infer", months: 1, plus: true })).status).toBe(201);
  });
});

describe("Station+ notifications", () => {
  const quote = (cents: number, upgrade?: { days: number }) => ({ usd: { totalCents: cents, ...(upgrade ? { upgrade } : {}) } });
  it("renewals, upgrades, full slots, loops", () => {
    expect(renewalText({ kind: "upgrade", key: "chog", plusUntil: "2026-11-30T00:00:00Z", quote: quote(2000, { days: 10 }), payment: { symbol: "USDC" } }))
      .toBe("UPGRADED chog to STATION+: 10 day(s), $20.00 in USDC; Station+ until 2026-11-30T00:00:00Z. Its rotation loop builds on the stream host; weekly posts start.");
    expect(renewalText({ kind: "renew", key: "chog", months: 1, plus: true, paidUntil: "P", plusUntil: "P", quote: quote(11_000, { days: 10 }), payment: { symbol: "USDG" } }))
      .toBe("RENEWED chog as STATION+: 1 month(s) + 10 day(s) of upgrade, $110.00 in USDG; paid until P, Station+ until P");
    expect(renewalText({ kind: "renew", key: "chog", months: 3, paidUntil: "P", quote: quote(7500), payment: { symbol: "USDC" } })).toBe("RENEWED chog: 3 month(s), $75.00 in USDC; paid until P");
    expect(plusSlotsText(true, { max: 6, used: 6, active: ["a", "b", "c", "d"], pending: 1, quoted: 1 })).toMatch(/^STATION\+ FULL: 6 of 6 slots taken \(4 on air, 1 paid and not live yet, 1 open quote\(s\)\)/);
    expect(plusSlotsText(false, { max: 6, used: 5, active: [], pending: 0, quoted: 0 })).toBe("STATION+ slot free again: 5 of 6 taken.");
    expect(loopText("chog", { state: "built" })).toMatch(/^LOOP BUILT chog/);
    expect(loopText("chog", { state: "failed", error: "missing work/base-1080p24.mkv" })).toMatch(/^LOOP FAILED chog: missing work\/base-1080p24\.mkv\./);
  });
});

describe("Station+ weekly posts", () => {
  it("one station per tick, the most overdue first (new ones at once), 3 h apart, inside the daily cap, retries wait", () => {
    const s: PlusPostStates = { a: { lastAt: T - WEEK_MS - H }, b: { lastAt: T - WEEK_MS - 5 * H }, c: { lastAt: T - DAY } };
    expect(duePlusPost(["a", "b", "c"], s, T, 0)).toBe("b");
    expect(duePlusPost(["a", "b", "c", "new"], s, T, 0)).toBe("new");
    expect(duePlusPost(["c"], s, T, 0)).toBeNull();
    expect(duePlusPost(["a", "b"], s, T, PLUS_POST_RULES.dailyCap)).toBeNull();
    // Just posted b: the next one waits for the gap.
    postedPlus(s, "b", T, "clip");
    expect(duePlusPost(["a", "b"], s, T + H, 0)).toBeNull();
    expect(duePlusPost(["a", "b"], s, T + 3 * H, 0)).toBe("a");
    // A failure waits an hour; three in a row give the week up.
    const f: PlusPostStates = {};
    expect(failedPlus(f, "x", T)).toBe(false);
    expect(duePlusPost(["x"], f, T + 30 * 60_000, 0)).toBeNull();
    expect(duePlusPost(["x"], f, T + H, 0)).toBe("x");
    failedPlus(f, "x", T + H);
    expect(failedPlus(f, "x", T + 2 * H)).toBe(true);
    expect(f.x).toEqual({ lastAt: T + 2 * H, lastKind: "skipped" });
  });

  // A tape: tracks #1..#3 finish at indexes 1, 3, 5; #1 starts at the tape's start (its start is not known).
  const tape = (tcAt: Record<number, [number, number]>) =>
    Array.from({ length: 6 }, (_, i) => ({ i, ts: T / 1000 - (6 - i) * 3600, slot0: "0x0", slot1: "0x0", ...(tcAt[i] ? { trackComplete: { trackNo: tcAt[i][0], swaps: tcAt[i][1], slot0: "0x0", slot1: "0x0" } } : {}) })) as unknown as TimelineEntry[];

  it("a release when a track finished since the last post (newest, never twice, start on the tape), else a clip", () => {
    const e = tape({ 1: [1, 2], 3: [2, 2], 5: [3, 2] });
    expect(plusTrack(e, undefined, T)).toBe(3);
    expect(trackSwaps(e, 3)).toBe(2);
    expect(plusTrack(e, { lastAt: T - 10 * H, lastTrackNo: 3 }, T)).toBeNull();
    expect(plusTrack(e, { lastAt: T - 10 * H, lastTrackNo: 2 }, T)).toBe(3);
    // Finished before the last post: not this week's.
    expect(plusTrack(e, { lastAt: T - 30 * 60_000 }, T)).toBeNull();
    // Only #1 finished, and its start is not on the tape: no release.
    expect(plusTrack(tape({ 1: [1, 2] }), undefined, T)).toBeNull();
    const s: PlusPostStates = {};
    postedPlus(s, "k", T, "release", 3);
    postedPlus(s, "k", T + WEEK_MS, "clip");
    expect(s.k).toEqual({ lastAt: T + WEEK_MS, lastKind: "clip", lastTrackNo: 3 });
  });

  it("captions: lowercase, the client's ticker as the ONLY cashtag, the handle when known, the station's link", () => {
    const rel = plusCaption({ kind: "release", label: "CHOG/MON", ticker: "CHOG", key: "chog", handle: "@chog_owner", trackNo: 12, swaps: 214, genre: "Liquid" });
    expect(rel).toBe("track #12 finished on the chog/mon station: 214 swaps, liquid.\nevery $CHOG trade is a note, the whole track from its first swap to the drop.\n@chog_owner\ntheidm.fun/?net=chog");
    const clip = plusCaption({ kind: "clip", label: "$IDM", ticker: "INFER", key: "infer", swaps: 200, site: "https://theidm.fun/" });
    expect(clip).toBe("now playing on the idm station.\nthe last 200 $INFER swaps, played through the idm rules.\ntheidm.fun/?net=infer");
    for (const c of [rel, clip]) {
      expect(c.match(/\$[A-Za-z]/g)).toHaveLength(1);
      const words = c.replace(/\$\w+|@\w+/g, "");
      expect(words).toBe(words.toLowerCase());
      expect([...c].length).toBeLessThanOrEqual(280);
    }
    // A ticker that cannot be a cashtag is written plain: no cashtag at all.
    expect(plusCaption({ kind: "clip", label: "X/ETH", ticker: "1INCH", key: "x", swaps: 5 })).not.toContain("$");
    expect(cashtag("$pepe")).toBe("$pepe");
    expect(cashtag("1INCH")).toBeNull();
    expect(xHandle({ kind: "x", value: "@chog" })).toBe("@chog");
    expect(xHandle({ kind: "telegram", value: "chog" })).toBeNull();
    expect(xHandle(undefined)).toBeNull();
  });

  it("the status the weekly posts read: Station+ keys", () => {
    const reg = { chains: {}, stations: [entry({ key: "a", paidUntil: "2026-11-22", plusUntil: "2026-11-22" }), entry({ key: "b", paidUntil: "2026-11-22" })] } as Registry;
    const st = buildStatus(reg, {}, T);
    expect(Object.entries(st).filter(([, v]) => v.plus).map(([k]) => k)).toEqual(["a"]);
  });
});
