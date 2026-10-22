import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePackSource, type StationPack } from "@swarm-sequencer/synth";
import { mergeRegistry } from "../../stations/validate.mjs";
import type { Application } from "../src/api/store.ts";
import type { Registry, RegistryEntry } from "../src/station.ts";
import { checkSource, fetchDelivered, gateDelivery, githubRepo } from "../src/stations/gate.ts";
import { advance, goLive, hold, newPipeline, reject, SUBMIT_STUCK_MS, type Pipeline, type PipelineDeps, type PayStep } from "../src/stations/pipeline.ts";
import { addRuntimeEntry, loadMerged, publishPack, readRuntime, updateRuntimeEntry } from "../src/stations/runtime.ts";
import { clean, ownerCommands, parseCommand, telegram } from "../src/stations/telegram.ts";
import { NeedsApproval } from "../src/imd/paid.ts";

const BAKED = JSON.parse(readFileSync(new URL("../../stations/registry.json", import.meta.url), "utf8")) as Registry;
const EXAMPLE = readFileSync(new URL("../../packages/synth/src/stations/example.ts", import.meta.url), "utf8");
const HOT = "0x00000000000000000000000000000000000000aa";
const T0 = Date.parse("2026-10-22T12:00:00Z");
const BASE = "b".repeat(40), COMMIT = "c".repeat(40), COMMIT2 = "d".repeat(40);

/** A pack for station `key`: example.ts as data, renamed (its style ids keep their own prefix; validatePack allows). */
const packFor = (key: string) => ({ ...(parsePackSource(EXAMPLE) as StationPack), key, name: "Test Station" }) as StationPack;

const app = (over: Partial<Application> = {}): Application => ({
  id: "a".repeat(24), kind: "setup", createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 1_800_000).toISOString(),
  payTo: "0x12a7c4567eef583ca6bc73f72ab980fd40f89cea",
  quote: { plan: { kind: "setup" }, usd: { feeUsd: 50, totalCents: 5938 }, tag: 1, amounts: [] },
  chainId: 143, token: "0x350035555e10d9afaf1566aaebfced5ba6c27777", pool: "0x116e7d070f1888b81e1e0324f56d6746b2d7d8f1", symbol: "CHOG",
  contact: { kind: "x", value: "chog" }, vibe: "bouncy purple acid", genres: ["acid", "liquid"],
  payment: { chainId: 143, txHash: `0x${"e".repeat(64)}`, token: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", symbol: "USDC", from: "0x00000000000000000000000000000000000000bb", value: "59380010", block: 1, blockTime: 1, paidAt: new Date(T0).toISOString() },
  ...over,
});

/** A fake world: swarm API with orders and jobs, a gate with queued verdicts, a registry, Telegram. */
function world() {
  let now = T0;
  const sent: string[] = [];
  const pays: { action: string; orderId: string }[] = [];
  const orders = new Map<string, { status: string; jobId?: string }>();
  const jobs = new Map<string, { state: string; head?: string; base?: string; delivery?: { repoUrl?: string; commit?: string } }>();
  const gateQueue: ({ ok: true } | { ok: false; lines: string[] })[] = [];
  const entries = new Map<string, RegistryEntry>();
  let balance = 10n * 10n ** 18n;
  let n = 0;
  let payBehaviour: "ok" | "needs-approval" | "crash-after-submit" = "ok";
  const saves: Pipeline[] = [];
  const deps: PipelineDeps = {
    now: () => now,
    swarm: {
      payer: HOT,
      baseCommit: async () => BASE,
      check: async () => ({ blockers: [], owner: HOT }),
      async pay(action, _input, step, save) {
        if (payBehaviour === "needs-approval") throw new NeedsApproval(HOT, "0xd34a", 5n * 10n ** 17n, 0n, "automatic approve is off");
        // As paid.ts: an order past "quoted" is returned without paying again.
        if (step.paid.orderId && orders.get(step.paid.orderId)?.status !== "quoted") return { orderId: step.paid.orderId };
        const orderId = step.paid.orderId ?? `order-${++n}`;
        step.paid.orderId = orderId;
        orders.set(orderId, { status: "quoted" });
        save();
        step.submitting = orderId;
        save();
        if (payBehaviour === "crash-after-submit") throw new Error("connection reset during submit");
        pays.push({ action, orderId });
        orders.set(orderId, { status: "paid" });
        return { orderId };
      },
      order: async (step: PayStep) => orders.get(step.paid.orderId!) ?? { status: "unknown" },
      job: async (id) => jobs.get(id) ?? { state: "running" },
    },
    async register(a) {
      const e = { key: "chog", label: "CHOG/MON", ticker: "CHOG", chainId: a.chainId!, kind: "v3", genesisBlock: 1, token: a.token!, status: "pending", program: "idm" } as RegistryEntry;
      entries.set(e.key, e);
      return e;
    },
    async gate() {
      const v = gateQueue.shift() ?? { ok: true };
      return v.ok ? { ok: true, lines: [], pack: packFor("chog"), styles: ["acid/x: X"] } : { ok: false, lines: v.lines };
    },
    publishPack: () => {},
    setEntry: (k, f) => Object.assign(entries.get(k)!, f),
    imdBalance: async () => balance,
    notify: async (t) => void sent.push(t),
    save: (p) => void saves.push(JSON.parse(JSON.stringify(p))),
    siteUrl: "https://theidm.fun",
    autoLiveMs: 24 * 3_600_000,
    minImdWei: 5n * 10n ** 17n,
  };
  return {
    deps, sent, pays, orders, jobs, gateQueue, entries, saves,
    tick: (ms: number) => (now += ms),
    setBalance: (b: bigint) => (balance = b),
    setPay: (b: typeof payBehaviour) => (payBehaviour = b),
    admit: (orderId: string, jobId: string) => orders.set(orderId, { status: "admitted", jobId }),
  };
}

/** Steps until nothing changes. */
async function run(a: Application, p: Pipeline, d: PipelineDeps) {
  for (let i = 0; i < 12 && (await advance(a, p, d)); i++);
}

describe("pipeline state machine", () => {
  it("paid -> registered -> ordered -> delivered -> preview -> live (auto after 24 h)", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    await run(a, p, w.deps);
    expect(p.stage).toBe("registered");
    expect(w.pays).toEqual([{ action: "job.open", orderId: "order-1" }]);
    expect(w.sent.some((s) => s.startsWith("ORDERED"))).toBe(true);
    // Waiting for the admission: nothing more is paid however often it steps.
    await run(a, p, w.deps);
    await run(a, p, w.deps);
    expect(w.pays).toHaveLength(1);
    w.admit("order-1", "job-1");
    await run(a, p, w.deps);
    expect([p.stage, p.jobId]).toEqual(["ordered", "job-1"]);
    w.jobs.set("job-1", { state: "completed", base: BASE, delivery: { repoUrl: "https://github.com/o/r", commit: COMMIT } });
    await run(a, p, w.deps);
    expect(p.stage).toBe("preview");
    expect(w.entries.get("chog")).toMatchObject({ status: "preview", program: "chog" });
    const preview = w.sent.find((s) => s.startsWith("PREVIEW"))!;
    expect(preview).toContain("https://theidm.fun/?net=chog");
    expect(preview).toContain(`Genres: ${packFor("chog").genres.join(", ")}`);
    w.tick(23 * 3_600_000);
    await run(a, p, w.deps);
    expect(p.stage).toBe("preview");
    w.tick(2 * 3_600_000);
    await run(a, p, w.deps);
    expect(p.stage).toBe("live");
    expect(w.entries.get("chog")).toMatchObject({ status: "live", paidUntil: "2026-11-23T13:00:00Z" });
  });

  it("hold stops the automatic go-live; /live puts a preview on air; /reject marks it failed with the refund details", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    await run(a, p, w.deps);
    w.admit("order-1", "job-1");
    w.jobs.set("job-1", { state: "completed", base: BASE, delivery: { repoUrl: "https://github.com/o/r", commit: COMMIT } });
    await run(a, p, w.deps);
    expect(hold(p)).toContain("held at preview");
    w.tick(48 * 3_600_000);
    await run(a, p, w.deps);
    expect(p.stage).toBe("preview");
    await goLive(a, p, w.deps, "on the owner's command");
    expect(p.stage).toBe("live");
    const q = newPipeline(a.id);
    q.key = "chog";
    await reject(a, q, w.deps);
    expect(q.stage).toBe("rejected");
    const msg = w.sent.at(-1)!;
    expect(msg).toContain("$59.38");
    expect(msg).toContain("x chog");
    expect(w.entries.get("chog")!.status).toBe("paused");
  });

  it("a Station+ setup goes live as Station+ for its included month (plusUntil = paidUntil)", async () => {
    const w = world(), a = app({ plus: true }), p = newPipeline(a.id);
    await run(a, p, w.deps);
    expect(w.sent.find((s) => s.startsWith("PAID"))).toContain("as STATION+");
    w.admit("order-1", "job-1");
    w.jobs.set("job-1", { state: "completed", base: BASE, delivery: { repoUrl: "https://github.com/o/r", commit: COMMIT } });
    await run(a, p, w.deps);
    await goLive(a, p, w.deps, "on the owner's command");
    expect(w.entries.get("chog")).toMatchObject({ status: "live", paidUntil: "2026-11-22T12:00:00Z", plusUntil: "2026-11-22T12:00:00Z" });
    expect(w.sent.at(-1)).toContain("Station+ until 2026-11-22T12:00:00Z");
    // A plain setup never gets plusUntil.
    const v = world(), b = app(), q = newPipeline(b.id);
    await run(b, q, v.deps);
    v.admit("order-1", "job-1");
    v.jobs.set("job-1", { state: "completed", base: BASE, delivery: { repoUrl: "https://github.com/o/r", commit: COMMIT } });
    await run(b, q, v.deps);
    await goLive(b, q, v.deps, "now");
    expect(v.entries.get("chog")!.plusUntil).toBeUndefined();
  });

  it("gate fails once -> ONE automatic job.continue with the failing lines; fails again -> attention, nothing more paid", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    await run(a, p, w.deps);
    w.admit("order-1", "job-1");
    w.jobs.set("job-1", { state: "completed", head: "job-1", base: BASE, delivery: { repoUrl: "https://github.com/o/r", commit: COMMIT } });
    w.gateQueue.push({ ok: false, lines: ["acid/chog-a: loudest-3s median -17.10 dBFS"] }, { ok: false, lines: ["acid/chog-a: peak -0.1 dBFS"] });
    await run(a, p, w.deps);
    expect(p.stage).toBe("revising");
    expect(p.revise!.notes).toContain("loudest-3s median -17.10");
    expect(w.pays.map((x) => x.action)).toEqual(["job.open", "job.continue"]);
    w.admit("order-2", "job-2");
    await run(a, p, w.deps);
    expect([p.stage, p.jobId]).toEqual(["ordered", "job-2"]);
    w.jobs.set("job-2", { state: "completed", head: "job-2", base: COMMIT, delivery: { repoUrl: "https://github.com/o/r", commit: COMMIT2 } });
    await run(a, p, w.deps);
    expect(p.stage).toBe("attention");
    expect(w.sent.at(-1)).toContain("NEEDS ATTENTION");
    expect(w.pays).toHaveLength(2);
    await run(a, p, w.deps);
    expect(w.pays).toHaveLength(2);
  });

  it("a job that ends without a delivery -> attention", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    await run(a, p, w.deps);
    w.admit("order-1", "job-1");
    w.jobs.set("job-1", { state: "failed" });
    await run(a, p, w.deps);
    expect(p.stage).toBe("attention");
  });

  it("low IMD and a missing Permit2 allowance wait (the owner told once), then resume", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    w.setBalance(10n ** 17n);
    await run(a, p, w.deps);
    await run(a, p, w.deps);
    expect([p.stage, p.waiting]).toEqual(["registered", "low-imd"]);
    expect(w.sent.filter((s) => s.startsWith("LOW IMD"))).toHaveLength(1);
    expect(w.pays).toHaveLength(0);
    w.setBalance(10n ** 19n);
    w.setPay("needs-approval");
    await run(a, p, w.deps);
    await run(a, p, w.deps);
    expect(p.waiting).toBe("approval");
    expect(w.sent.filter((s) => s.startsWith("PERMIT2 APPROVAL NEEDED"))).toHaveLength(1);
    w.setPay("ok");
    await run(a, p, w.deps);
    expect(w.pays).toHaveLength(1);
    expect(p.waiting).toBeUndefined();
  });
});

describe("never pays twice", () => {
  it("a crash after the submit marker: the restarted step never submits that order again", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    w.setPay("crash-after-submit");
    await expect(run(a, p, w.deps)).rejects.toThrow(/connection reset/);
    // What survived on disk: the order and the submit marker.
    const saved = w.saves.at(-1)!;
    expect(saved.open!.paid.orderId).toBe("order-1");
    expect(saved.open!.submitting).toBe("order-1");
    // Restart from the saved state; the API still says "quoted".
    w.setPay("ok");
    const q = JSON.parse(JSON.stringify(saved)) as Pipeline;
    await run(a, q, w.deps);
    await run(a, q, w.deps);
    expect(w.pays).toHaveLength(0);
    expect(q.stage).toBe("registered");
    // Stuck past SUBMIT_STUCK_MS: attention, still no payment.
    w.tick(SUBMIT_STUCK_MS + 60_000);
    await run(a, q, w.deps);
    expect(q.stage).toBe("attention");
    expect(q.reason).toContain("not paying again");
    expect(w.pays).toHaveLength(0);
  });

  it("an order already paid or admitted is never paid again after a restart", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    await run(a, p, w.deps);
    const restarted = JSON.parse(JSON.stringify(p)) as Pipeline;
    await run(a, restarted, w.deps);
    w.admit("order-1", "job-1");
    await run(a, restarted, w.deps);
    expect(restarted.stage).toBe("ordered");
    expect(w.pays).toHaveLength(1);
  });

  it("a failed order after the payment was submitted goes to the owner, not to a new payment", async () => {
    const w = world(), a = app(), p = newPipeline(a.id);
    await run(a, p, w.deps);
    w.orders.set("order-1", { status: "payment_failed" });
    await run(a, p, w.deps);
    expect(p.stage).toBe("attention");
    expect(p.reason).toContain("check the payment");
    expect(w.pays).toHaveLength(1);
  });
});

describe("runtime registry", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "rt-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const chog = (over: Partial<RegistryEntry> = {}) => ({
    key: "chog", label: "CHOG/MON", ticker: "CHOG", chainId: 143, kind: "v3", pool: "0x116e7d070f1888b81e1e0324f56d6746b2d7d8f1",
    genesisBlock: 1000, token: "0x350035555e10d9afaf1566aaebfced5ba6c27777", quote: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a", ethSide: 1,
    quoteSymbol: "ETH", calibration: { supplyTickOffset: 0, quotePerEth: "111372" },
    theme: { phos: "#ffb53d", phosDim: "#a0701f", ghost: "#2e2008", lcd: "#140d02" }, program: "idm", status: "pending", ...over,
  }) as RegistryEntry;

  it("merges valid runtime entries after the baked ones; baked wins; invalid entries are skipped with reasons", () => {
    const { registry, skipped } = mergeRegistry(BAKED, { stations: [chog(), chog({ key: "infer" }), { ...chog({ key: "bad" }), status: "weird" }, chog({ key: "dup-pool" }), chog({ key: "h", house: true, pool: `0x${"1".repeat(40)}` })] });
    expect(registry.stations.map((s) => s.key)).toEqual([...BAKED.stations.map((s) => s.key), "chog"]);
    expect(Object.fromEntries(skipped.map((s) => [s.key, s.reasons.join("; ")]))).toMatchObject({
      infer: expect.stringContaining("taken"), bad: expect.stringContaining("status"), "dup-pool": expect.stringContaining("pool already"), h: expect.stringContaining("house"),
    });
    expect(mergeRegistry(BAKED, null).registry.stations).toHaveLength(BAKED.stations.length);
  });

  it("a runtime program needs its runtime pack; publish, status preview, merged", () => {
    addRuntimeEntry(dir, chog(), BAKED);
    expect(() => addRuntimeEntry(dir, chog(), BAKED)).toThrow(/taken/);
    expect(() => addRuntimeEntry(dir, chog({ key: "infer" }), BAKED)).toThrow(/taken/);
    updateRuntimeEntry(dir, "chog", { program: "chog", status: "preview" });
    expect(loadMerged(dir, BAKED).skipped[0].reasons.join()).toContain('program "chog" has no pack');
    publishPack(dir, packFor("chog"));
    expect(loadMerged(dir, BAKED).registry.stations.at(-1)).toMatchObject({ key: "chog", status: "preview", program: "chog" });
    expect(() => publishPack(dir, { ...packFor("x"), genres: [] })).toThrow(/validate/);
    expect(() => publishPack(dir, packFor("infer"))).toThrow(/baked/);
    expect(readRuntime(dir).stations).toHaveLength(1);
  });
});

describe("gate (data checks, GitHub reads faked)", () => {
  const key = "chog", file = "packages/synth/src/stations/chog.ts";
  const source = EXAMPLE.replace('key: "example"', 'key: "chog"');
  it("only the pack file, plain data, the station's key, a valid pack", () => {
    expect(checkSource(key, source, [file]).ok).toBe(true);
    expect(checkSource(key, source, [file, "packages/synth/src/engine.ts"]).lines[0]).toContain("also changes: packages/synth/src/engine.ts");
    expect(checkSource(key, source, []).lines[0]).toContain("does not change");
    expect(checkSource(key, source.replace('name: "', 'name: String("'), [file]).lines[0]).toContain("not plain data");
    expect(checkSource("other", source, ["packages/synth/src/stations/other.ts"]).lines[0]).toContain('is not the station\'s "other"');
    expect(checkSource(key, source.replace(/genres: \[[^\]]*\]/, 'genres: ["acid"]'), [file]).ok).toBe(false);
  });

  it("reads the compare API and the raw file; refuses non-GitHub urls; renders only data that passed", async () => {
    expect(githubRepo("https://github.com/o/r.git")).toEqual({ owner: "o", repo: "r" });
    expect(() => githubRepo("https://evil.example/o/r")).toThrow();
    const urls: string[] = [];
    const fetchFn = (async (u: string) => {
      urls.push(String(u));
      if (String(u).includes("/compare/")) return new Response(JSON.stringify({ files: [{ filename: file }] }), { status: 200 });
      return new Response(source, { status: 200 });
    }) as typeof fetch;
    const d = { repoUrl: "https://github.com/o/r", commit: COMMIT, base: BASE };
    expect((await fetchDelivered(d, key, fetchFn)).changed).toEqual([file]);
    expect(urls).toEqual([`https://api.github.com/repos/o/r/compare/${BASE}...${COMMIT}`, `https://raw.githubusercontent.com/o/r/${COMMIT}/${file}`]);
    let rendered = 0;
    const render = async () => (rendered++, { errors: [], failures: ["acid/x: peak -0.20 dBFS over -0.5"], rows: [] });
    expect(await gateDelivery(key, d, { fetchFn, render })).toMatchObject({ ok: false, lines: ["acid/x: peak -0.20 dBFS over -0.5"] });
    const bad = (async (u: string) => (String(u).includes("/compare/") ? new Response(JSON.stringify({ files: [{ filename: file }, { filename: "x" }] })) : new Response(source))) as typeof fetch;
    expect((await gateDelivery(key, d, { fetchFn: bad, render })).ok).toBe(false);
    expect(rendered).toBe(1);
  });
});

describe("telegram", () => {
  it("parses only the known commands with a valid key", () => {
    expect(parseCommand("/status")).toEqual({ cmd: "status" });
    expect(parseCommand("/live chog")).toEqual({ cmd: "live", key: "chog" });
    expect(parseCommand("/hold@theidm_bot chog")).toEqual({ cmd: "hold", key: "chog" });
    expect(parseCommand("/live")).toBeNull();
    expect(parseCommand("/live ../../etc")).toBeNull();
    expect(parseCommand("/rm -rf")).toBeNull();
    expect(parseCommand("hello")).toBeNull();
  });

  it("accepts commands ONLY from the owner's chat", () => {
    const updates = [
      { update_id: 1, message: { chat: { id: -100123 }, text: "/live chog" } },
      { update_id: 2, message: { chat: { id: 555 }, text: "/live chog" } },
      { update_id: 3, message: { chat: { id: "-100123" }, text: "/reject chog" } },
      { update_id: 4 },
    ];
    expect(ownerCommands(updates, "-100123").map((c) => [c.updateId, c.command])).toEqual([[1, { cmd: "live", key: "chog" }], [3, { cmd: "reject", key: "chog" }]]);
  });

  it("plain, bounded text; the token never appears in an error", async () => {
    expect(clean("a\u0000b‮c\nd")).toBe("abc\nd");
    expect(clean("x".repeat(5000))).toHaveLength(3500);
    const logs: string[] = [];
    const bodies: unknown[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }))) as typeof fetch;
    const tg = telegram("123:SECRET", "-100123", (l) => logs.push(l), fetchFn);
    await tg.send("hi\u0007");
    expect(bodies[0]).toEqual({ chat_id: "-100123", text: "hi", disable_web_page_preview: true });
    expect(logs.join("\n")).not.toContain("SECRET");
    expect(logs.join("\n")).toContain("Unauthorized");
    await expect(tg.updates(0, 1)).rejects.toThrow(/^telegram getUpdates: 401 Unauthorized$/);
    const off = telegram(undefined, undefined, () => {}, fetchFn);
    expect(off.enabled).toBe(false);
  });
});
