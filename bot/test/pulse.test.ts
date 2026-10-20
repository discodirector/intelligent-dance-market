import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PublicClient } from "viem";
import { burnTick, decidePulse, harvestTick, pulseConfigFromEnv, pulseTick, type NextPulse, type PulseConfig } from "../src/pulse.ts";
import { factsFromTimeline } from "../src/lib/facts.ts";
import { templateCaption, validateCaption } from "../src/caption/index.ts";
import type { TimelineEntry } from "../src/lib/timeline.ts";

const TREASURY = "0x00000000000000000000000000000000000000aB" as const;
// Well-known test key (anvil #0): must never appear in any log line.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const next = (o: Partial<NextPulse> = {}): NextPulse => ({ ready: true, amount: 2_000_000_000_000_000n, idleSec: 900n, heat: 3, ...o });
const cfg = (o: Partial<PulseConfig> = {}): PulseConfig => ({ treasury: TREASURY, rpcUrl: "http://x", chainId: 4663, send: false, tickSec: 60, harvest: null, splitter: null, burnEverySec: 86400, ...o });
const fakeClient = (n: NextPulse, simulate = vi.fn().mockRejectedValue(new Error("NotIdle(10)"))) =>
  ({ readContract: vi.fn().mockResolvedValue([n.ready, n.amount, n.idleSec, n.heat]), simulateContract: simulate }) as unknown as PublicClient;

afterEach(() => vi.restoreAllMocks());

describe("pulse keeper", () => {
  it("is dry-run by default and needs a treasury + rpc", () => {
    expect(pulseConfigFromEnv({})).toBeNull();
    expect(pulseConfigFromEnv({ PULSE_TREASURY: TREASURY })).toBeNull();
    const c = pulseConfigFromEnv({ PULSE_TREASURY: TREASURY, LIVE_RPC_URL: "http://x", PULSE_KEY: KEY })!;
    expect(c.send).toBe(false);
    expect(c.chainId).toBe(4663);
    expect(JSON.stringify(c)).not.toContain(KEY.slice(2, 20));
    expect(pulseConfigFromEnv({ PULSE_TREASURY: TREASURY, LIVE_RPC_URL: "http://x", PULSE_SEND: "true" })!.send).toBe(true);
  });

  it("decides from the contract view like pulse() reverts", () => {
    expect(decidePulse(next({ idleSec: 899n })).act).toBe("wait");
    expect(decidePulse(next({ amount: 0n, ready: false })).act).toBe("wait");
    expect(decidePulse(next())).toEqual({ act: "pulse", amount: 2_000_000_000_000_000n, idleSec: 900n, heat: 3 });
  });

  it("dry run never touches the key or sends", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    const sim = vi.fn();
    expect(await pulseTick(cfg(), fakeClient(next(), sim), { PULSE_KEY: KEY })).toBeNull();
    expect(sim).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("DRY RUN would send pulse 0.002 ETH");
  });

  it("send mode requires PULSE_KEY and never logs it", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    await expect(pulseTick(cfg({ send: true }), fakeClient(next()), {})).rejects.toThrow(/PULSE_KEY/);
    await expect(pulseTick(cfg({ send: true }), fakeClient(next()), { PULSE_KEY: "nothex" })).rejects.toThrow(/PULSE_KEY/);
    // A lost race: simulation reverts, nothing is sent; neither the error nor the logs carry the key.
    const err = await pulseTick(cfg({ send: true }), fakeClient(next()), { PULSE_KEY: KEY }).catch((e: Error) => e);
    expect(String(err)).toContain("NotIdle");
    expect(String(err) + lines.join("\n")).not.toContain(KEY.slice(2));
  });
});

describe("pulse labels in facts and captions", () => {
  const tl: TimelineEntry[] = JSON.parse(readFileSync(new URL("../data/imd-eth-7d.timeline.json", import.meta.url), "utf8")).slice(0, 50);
  it("counts pulses only when present, and the template states them truthfully", () => {
    const plain = factsFromTimeline(tl, { kind: "snapshot", chain: "robinhood", pool: "IDM/ETH" });
    expect(plain.pulses).toBeUndefined();
    const tagged = tl.map((e, i) => (i % 10 === 0 && e.isBuy ? { ...e, pulse: true as const } : e));
    const n = tagged.filter((e) => e.pulse).length;
    expect(n).toBeGreaterThan(0);
    const f = factsFromTimeline(tagged, { kind: "snapshot", chain: "robinhood", pool: "IDM/ETH" });
    expect(f.pulses).toBe(n);
    const text = templateCaption(f);
    expect(text).toContain(`${n} buys were treasury pulses`);
    expect(validateCaption(text, f)).toEqual([]);
  });
});

describe("fee harvest", () => {
  const FACTORY = "0xa25b02a1e93903b790e6aaf7da1b8b8d50294645" as const;
  const harvest = { factory: FACTORY, launchNumber: 2200n, everySec: 86400 };
  const SPLITTER = "0x00000000000000000000000000000000000000eF" as const;

  it("is configured only with a factory and a launch number", () => {
    const base = { PULSE_TREASURY: TREASURY, LIVE_RPC_URL: "http://x" };
    expect(pulseConfigFromEnv(base)!.harvest).toBeNull();
    expect(pulseConfigFromEnv({ ...base, FEE_FACTORY: FACTORY })!.harvest).toBeNull();
    expect(pulseConfigFromEnv({ ...base, FEE_FACTORY: FACTORY, LAUNCH_NUMBER: "2200", HARVEST_HOURS: "12" })!.harvest).toEqual({ factory: FACTORY, launchNumber: 2200n, everySec: 43200 });
    expect(pulseConfigFromEnv(base)!.splitter).toBeNull();
    expect(pulseConfigFromEnv({ ...base, FEE_SPLITTER: "" })!.splitter).toBeNull();
    expect(pulseConfigFromEnv({ ...base, FEE_SPLITTER: SPLITTER })!.splitter).toBe(SPLITTER);
  });

  it("waits out the interval, and a dry run neither reads the key nor sends", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    const sim = vi.fn();
    const client = { simulateContract: sim } as unknown as PublicClient;
    expect(await harvestTick(cfg({ harvest }), client, 1000, 1000 + 3600, { PULSE_KEY: KEY })).toBe(1000);
    expect(await harvestTick(cfg({ harvest }), client, 1000, 1000 + 86400, { PULSE_KEY: KEY })).toBe(1000 + 86400);
    expect(sim).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("DRY RUN would call claimFees(2200)");
    expect(lines.join("\n")).not.toContain(KEY.slice(2, 20));
  });

  it("simulates claimFees before sending", async () => {
    const sim = vi.fn().mockRejectedValue(new Error("reverted"));
    const client = { simulateContract: sim } as unknown as PublicClient;
    await expect(harvestTick(cfg({ harvest, send: true }), client, 0, 86400, { PULSE_KEY: KEY })).rejects.toThrow("reverted");
    expect(sim).toHaveBeenCalledWith(expect.objectContaining({ address: FACTORY, functionName: "claimFees", args: [2200n] }));
  });

  it("with a splitter, the dry run names split() and a failed claim never splits", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    const sim = vi.fn().mockRejectedValue(new Error("reverted"));
    const client = { simulateContract: sim } as unknown as PublicClient;
    await harvestTick(cfg({ harvest, splitter: SPLITTER }), client, 0, 86400, { PULSE_KEY: KEY });
    expect(lines.join("\n")).toContain(`then split() on ${SPLITTER}`);
    await expect(harvestTick(cfg({ harvest, splitter: SPLITTER, send: true }), client, 0, 86400, { PULSE_KEY: KEY })).rejects.toThrow("reverted");
    expect(sim).toHaveBeenCalledTimes(1);
  });
});

describe("burn", () => {
  const IDM = "0x00000000000000000000000000000000000000cD" as const;
  const reader = (bal: bigint, simulate = vi.fn()) =>
    ({ readContract: vi.fn(async ({ functionName }: { functionName: string }) => (functionName === "idm" ? IDM : bal)), simulateContract: simulate }) as unknown as PublicClient;

  it("defaults to daily and can be switched off", () => {
    const base = { PULSE_TREASURY: TREASURY, LIVE_RPC_URL: "http://x" };
    expect(pulseConfigFromEnv(base)!.burnEverySec).toBe(86400);
    expect(pulseConfigFromEnv({ ...base, BURN_HOURS: "0" })!.burnEverySec).toBe(0);
  });

  it("waits out the interval, skips an empty balance, and a dry run never sends", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    const sim = vi.fn();
    expect(await burnTick(cfg(), reader(5n * 10n ** 18n, sim), 1000, 1000 + 3600)).toBe(1000);
    expect(await burnTick(cfg(), reader(0n, sim), 0, 86400)).toBe(86400);
    expect(await burnTick(cfg(), reader(5n * 10n ** 18n, sim), 0, 86400, { PULSE_KEY: KEY })).toBe(86400);
    expect(sim).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("DRY RUN would burn 5 IDM");
    expect(await burnTick(cfg({ burnEverySec: 0 }), reader(1n, sim), 0, 10 ** 9)).toBe(0);
  });

  it("simulates burn() before sending", async () => {
    const sim = vi.fn().mockRejectedValue(new Error("NothingToBurn"));
    await expect(burnTick(cfg({ send: true }), reader(1n, sim), 0, 86400, { PULSE_KEY: KEY })).rejects.toThrow("NothingToBurn");
    expect(sim).toHaveBeenCalledWith(expect.objectContaining({ address: TREASURY, functionName: "burn" }));
  });
});
