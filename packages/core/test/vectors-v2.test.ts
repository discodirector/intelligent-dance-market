// Foundry emits these from the production v2 transition. A missing fixture is a failure.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode, encode, mutate, V2_RULES, V2_SLOTS, DEFAULT_THRESHOLDS, log2Fixed, relativeTrackFor, SEED_KICKS, SEED_SNARES } from "../src/index.ts";

const cases = JSON.parse(readFileSync(new URL("../../../spec/vectors-v2.json", import.meta.url), "utf8"));
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));

describe("Solidity v2 vectors", () => {
  it("covers all tiers, accumulation, cooling boundaries, snapshots and whales", () => {
    expect(cases.length).toBeGreaterThanOrEqual(300);
    const names = new Set(cases.map((c: any) => c.name));
    for (const name of ["relative-boundary", "accumulation-column", "scan-wrap", "live-heat-build", "edge-3", "edge-4"])
      expect(names.has(name)).toBe(true);
    const tiers = new Set(cases.filter((c: any) => c.name === "relative-boundary").map((c: any) => c.event.fromTrack));
    expect(tiers).toEqual(new Set([0, 1, 2, 3]));
    expect(cases.some((c: any) => c.event.promoted && c.event.writeStep !== c.event.step)).toBe(true);
    expect(cases.some((c: any) => c.event.noop)).toBe(true);
    expect(cases.filter((c: any) => c.event.trackComplete).length).toBeGreaterThan(5);
    expect(cases.some((c: any) => c.event.whale && c.event.trackComplete)).toBe(true);
    const seeds = cases.filter((c: any) => c.name === "curated-seed").map((c: any) => BigInt(c.event.trackComplete.seed));
    expect(new Set(seeds.map((s: bigint) => Number(s & 0xffffn)))).toEqual(new Set(SEED_KICKS));
    expect(new Set(seeds.map((s: bigint) => Number((s >> 16n) & 0xffffn)))).toEqual(new Set(SEED_SNARES));
    const edge = (n: number) => cases.find((c: any) => c.name === `edge-${n}`);
    expect(edge(3).event.trackComplete).not.toBeNull(); // 3599 preserves heat 15
    expect(decode(edge(4).after.slot0, edge(4).after.slot1, V2_SLOTS).heat).toBe(1); // 3600 resets before the buy
  });

  for (const [i, c] of cases.entries()) {
    it(`#${i} ${c.name}`, () => {
      const before = decode(c.before.slot0, c.before.slot1, V2_SLOTS);
      expect(json(encode(before, V2_SLOTS))).toEqual(c.before);
      const input = { ...c.input, quoteAmt: BigInt(c.input.quoteAmt), blockNumber: BigInt(c.input.blockNumber) };
      const { state, event } = mutate(before, input, DEFAULT_THRESHOLDS, V2_RULES);
      expect(json(encode(state, V2_SLOTS))).toEqual(c.after);
      expect(state).toEqual(decode(c.after.slot0, c.after.slot1, V2_SLOTS));
      const { sender, ...expected } = c.event;
      expect(sender).toBe("0x0000000000000000000000000000000000001234");
      // Compare every event field, including absent accumulation metadata on whales and the complete snapshot.
      const actual = json({ ...event, movement: event.movement ?? null, drop: event.drop ?? null, trackComplete: event.trackComplete ?? null });
      expect(actual).toEqual(expected);
      if (!event.whale) {
        expect(event.fromTrack).toBe(relativeTrackFor(log2Fixed(input.quoteAmt) - before.sizeLogEma!));
      }
      if (event.trackComplete) {
        const snap = decode(event.trackComplete.slot0, event.trackComplete.slot1, V2_SLOTS);
        expect(snap.trackNo).toBe(before.trackNo);
        expect(snap.heat).toBeGreaterThanOrEqual(16);
        expect(snap.swapCount).toBe(state.swapCount);
        expect(state.bass).toBe(snap.bass & 0x000f000f000f000fn);
        expect(event.bassNote).toBe(Number((snap.bass >> BigInt(event.step * 4)) & 15n));
        expect(state.heat).toBe(0);
        expect(state.pattern).toBe(event.trackComplete.seed);
      }
    });
  }
});
