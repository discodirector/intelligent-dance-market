import { describe, expect, it } from "vitest";
import {
  accumulateWrite,
  DEFAULT_ACCUMULATE_RULES,
  initialRelativeState,
  initialState,
  isOn,
  mutate,
  TRACK_GLITCH,
  TRACK_HAT,
  TRACK_KICK,
  TRACK_SNARE,
  type MutateOptions,
  type State,
} from "../src/index.ts";

/** 1 IMD at the launch calibration (1/400): 0.0025 ETH in wei. Keeps every relative case identical. */
const E = 10n ** 18n / 400n;
const bit = (track: number, step: number) => 1n << BigInt(track * 16 + step);
const bits = (...ts: [number, number][]) => ts.reduce((p, [t, s]) => p | bit(t, s), 0n);
const rowFull = (track: number) => 0xffffn << BigInt(track * 16);
const swap = (quoteAmt: bigint, i = 0, isBuy = true) => ({ isBuy, quoteAmt, tick: 600 + ((i * 397) % 2400), blockNumber: 21_000_000n + BigInt(i), timestamp: 1_760_000_000 + i * 6 });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("accumulation: buy ladder", () => {
  it("a clear target is written exactly as before", () => {
    expect(accumulateWrite(0n, TRACK_HAT, 5, true)).toEqual({ pattern: bit(TRACK_HAT, 5), track: TRACK_HAT, step: 5, noop: false });
  });

  it("promotes hat → glitch → snare → kick at the same step", () => {
    let p = bit(TRACK_HAT, 5);
    for (const want of [TRACK_GLITCH, TRACK_SNARE, TRACK_KICK]) {
      const w = accumulateWrite(p, TRACK_HAT, 5, true);
      expect(w.track).toBe(want);
      expect(w.step).toBe(5);
      expect(w.pattern).toBe(p | bit(want, 5));
      p = w.pattern;
    }
  });

  it("skips set rungs and starts from the classified rung", () => {
    const p = bits([TRACK_GLITCH, 3], [TRACK_SNARE, 3]);
    expect(accumulateWrite(p, TRACK_GLITCH, 3, true).track).toBe(TRACK_KICK);
    // A snare buy never writes the weaker rungs.
    const q = bits([TRACK_SNARE, 3], [TRACK_KICK, 3]);
    const w = accumulateWrite(q, TRACK_SNARE, 3, true);
    expect(w.track).toBe(TRACK_SNARE);
    expect(w.step).toBe(4);
  });

  it("full column → scan the classified row for the next clear step (wrapping), full row → no-op", () => {
    const col = bits([TRACK_HAT, 15], [TRACK_GLITCH, 15], [TRACK_SNARE, 15], [TRACK_KICK, 15]);
    const w = accumulateWrite(col | bit(TRACK_HAT, 0), TRACK_HAT, 15, true);
    expect([w.track, w.step]).toEqual([TRACK_HAT, 1]);
    const full = rowFull(TRACK_HAT) | rowFull(TRACK_GLITCH) | rowFull(TRACK_SNARE) | rowFull(TRACK_KICK);
    expect(accumulateWrite(full, TRACK_HAT, 15, true)).toEqual({ pattern: full, track: TRACK_HAT, step: 15, noop: true });
    expect(accumulateWrite(rowFull(TRACK_KICK), TRACK_KICK, 2, true).noop).toBe(true);
  });

  it("other fallbacks: none is a no-op, spill only tries step+1", () => {
    const col = bits([TRACK_KICK, 7]);
    expect(accumulateWrite(col, TRACK_KICK, 7, true, { ...DEFAULT_ACCUMULATE_RULES, buyFallback: "none" }).noop).toBe(true);
    const s = accumulateWrite(col, TRACK_KICK, 7, true, { ...DEFAULT_ACCUMULATE_RULES, buyFallback: "spill" });
    expect([s.track, s.step]).toEqual([TRACK_KICK, 8]);
    expect(accumulateWrite(col | bit(TRACK_KICK, 8), TRACK_KICK, 7, true, { ...DEFAULT_ACCUMULATE_RULES, buyFallback: "spill" }).noop).toBe(true);
  });
});

describe("accumulation: sell rule", () => {
  it("a set target is cleared exactly as before", () => {
    const p = bits([TRACK_GLITCH, 9], [TRACK_KICK, 9]);
    expect(accumulateWrite(p, TRACK_GLITCH, 9, false)).toEqual({ pattern: bit(TRACK_KICK, 9), track: TRACK_GLITCH, step: 9, noop: false });
  });

  it("clear target → clears the first set rung above, but never a kick", () => {
    const p = bits([TRACK_SNARE, 9], [TRACK_KICK, 9]);
    const w = accumulateWrite(p, TRACK_HAT, 9, false);
    expect([w.track, w.pattern]).toEqual([TRACK_SNARE, bit(TRACK_KICK, 9)]);
    expect(accumulateWrite(bit(TRACK_KICK, 9), TRACK_HAT, 9, false).noop).toBe(true);
    // Only a kick-classified sell clears a kick.
    expect(accumulateWrite(bit(TRACK_KICK, 9), TRACK_KICK, 9, false).pattern).toBe(0n);
    // Weaker rungs are never touched by the default rule, and there is no sell scan.
    expect(accumulateWrite(bits([TRACK_HAT, 9], [TRACK_GLITCH, 10]), TRACK_GLITCH, 9, false).noop).toBe(true);
  });

  it("alternative sell rules", () => {
    const p = bits([TRACK_HAT, 9], [TRACK_KICK, 9]);
    const r = (sell: "upAll" | "down" | "near" | "top") => accumulateWrite(p, TRACK_GLITCH, 9, false, { ...DEFAULT_ACCUMULATE_RULES, sell }).track;
    expect(r("upAll")).toBe(TRACK_KICK);
    expect(r("down")).toBe(TRACK_HAT);
    expect(r("near")).toBe(TRACK_HAT);
    expect(r("top")).toBe(TRACK_KICK);
    const s = accumulateWrite(bit(TRACK_GLITCH, 0), TRACK_GLITCH, 9, false, { ...DEFAULT_ACCUMULATE_RULES, sellFallback: "scan" });
    expect([s.track, s.step, s.pattern]).toEqual([TRACK_GLITCH, 0, 0n]);
  });
});

describe("accumulation through mutate", () => {
  const VARIANTS: [string, MutateOptions | undefined, MutateOptions, () => State][] = [
    ["abs", undefined, { accumulate: true }, initialState],
    ["rel", { relative: true }, { relative: true, accumulate: true }, initialRelativeState],
  ];

  for (const [name, base, acc, init] of VARIANTS) {
    it(`${name}+acc only differs from ${name} where ${name} changed no bit`, () => {
      const r = rng(5);
      let s = init();
      for (let i = 0; i < 600; i++) {
        const sz = r() < 0.03 ? 150n * E : BigInt(Math.floor(2 ** (r() * 12) * 1e6)) * (10n ** 12n / 400n);
        const input = swap(sz, i, r() < 0.55);
        const a = mutate(s, input, undefined, base);
        const b = mutate(s, input, undefined, acc);
        const { fromTrack, promoted, writeStep, noop, ...rest } = b.event;
        if (a.state.pattern !== s.pattern || a.event.whale) {
          expect(rest).toEqual(a.event);
          expect(b.state).toEqual(a.state);
          if (!a.event.whale) expect([fromTrack, promoted, writeStep, noop]).toEqual([a.event.track, false, a.event.step, false]);
        } else {
          // Same everything except the pattern (and the slot0 that packs it).
          expect({ ...b.state, pattern: 0n }).toEqual({ ...a.state, pattern: 0n });
          expect(b.event.slot1).toBe(a.event.slot1);
          expect(fromTrack).toBe(a.event.track);
          expect(b.event.step).toBe(a.event.step);
          expect(b.event.bassNote).toBe(a.event.bassNote);
        }
        expect(a.event).not.toHaveProperty("fromTrack");
        s = r() < 0.5 ? a.state : b.state;
      }
    });
  }

  it("the event reports the track and step actually written", () => {
    let s = initialState();
    let promotions = 0;
    for (let i = 0; i < 50; i++) {
      const { state, event } = mutate(s, swap(E / 4n, i), undefined, { accumulate: true });
      expect(event.fromTrack).toBe(TRACK_HAT);
      expect(event.on).toBe(true);
      if (!event.noop) {
        expect(isOn(s.pattern, event.track, event.writeStep!)).toBe(false);
        expect(state.pattern).toBe(s.pattern | bit(event.track, event.writeStep!));
      } else expect(state.pattern).toBe(s.pattern);
      expect(event.promoted).toBe(event.track !== TRACK_HAT || event.writeStep !== event.step);
      if (event.promoted) promotions++;
      s = state;
    }
    expect(promotions).toBeGreaterThan(20);
  });

  it("50 identical small buys grow kicks and snares (absolute stays hats only)", () => {
    let a = initialState();
    let b = initialState();
    for (let i = 0; i < 50; i++) {
      a = mutate(a, swap(E / 4n, i)).state;
      b = mutate(b, swap(E / 4n, i), undefined, { accumulate: true }).state;
    }
    const count = (s: State, t: number) => Array.from({ length: 16 }, (_, k) => isOn(s.pattern, t, k)).filter(Boolean).length;
    expect(count(a, TRACK_KICK)).toBe(2);
    expect(count(b, TRACK_KICK)).toBeGreaterThan(4);
    expect(count(b, TRACK_SNARE)).toBeGreaterThan(8);
  });

  it("whales are untouched by accumulate", () => {
    const s = { ...initialState(), pattern: 0xffff_ffff_ffff_ffffn };
    for (const isBuy of [true, false]) {
      const a = mutate(s, swap(160n * E, 3, isBuy));
      const b = mutate(s, swap(160n * E, 3, isBuy), undefined, { accumulate: true });
      expect(b).toEqual(a);
    }
  });

  it("adds no storage: rel+acc packs exactly the rel slots", () => {
    const s = initialRelativeState();
    const a = mutate(s, swap(E, 1), undefined, { relative: true });
    const b = mutate(s, swap(E, 1), undefined, { relative: true, accumulate: true });
    expect(b.event.slot1).toBe(a.event.slot1);
    expect(b.state.sizeLogEma).toBe(a.state.sizeLogEma);
  });
});
