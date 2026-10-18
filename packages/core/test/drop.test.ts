import { describe, expect, it } from "vitest";
import { arrange } from "../../synth/src/arrange.ts";
import {
  BASS_KEEP,
  cooledHeat,
  coolHeat,
  decode,
  DEFAULT_DROP_RULES,
  dropSeed,
  encode,
  euclidMask,
  HEAT_SHIFT,
  initialDropState,
  initialRelativeState,
  initialState,
  isOn,
  mutate,
  popcount64,
  SEED_KICKS,
  SEED_SNARES,
  SILENCE_RESET_SEC,
  stepHash,
  TRACK_NO_SHIFT,
  type DropRules,
  type MutateOptions,
  type State,
} from "../src/index.ts";

const E = 10n ** 18n;
const M168 = (1n << 168n) - 1n;
const T0 = 1_760_000_000;
const swap = (imdAmt: bigint, i = 0, isBuy = true, ts = T0 + i * 6) => ({ isBuy, imdAmt, tick: 600 + ((i * 397) % 2400), blockNumber: 21_000_000n + BigInt(i), timestamp: ts });
const RULES: DropRules = { satBits: 56, heatMax: 16, coolSec: 120, sellCool: 1 };

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

/** Random market: mostly small buys, some sells, rare whales. */
function stream(seed: number, n: number, buyShare = 0.75) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const w = r() < 0.02;
    const amt = w ? 150n * E : BigInt(Math.round(1e6 * 2 ** (6 * r() - 4))) * 10n ** 12n;
    return swap(amt, i, r() < buyShare);
  });
}

describe("drop: off is byte-identical", () => {
  for (const [name, opts] of [
    ["abs", undefined],
    ["rel", { relative: true }],
    ["acc", { accumulate: true }],
    ["rel+acc", { relative: true, accumulate: true }],
  ] as [string, MutateOptions | undefined][]) {
    it(`${name}: { drop: false } and no option give the same slots and events, no heat bits`, () => {
      let a: State = opts?.relative ? initialRelativeState() : initialState();
      let b = { ...a };
      for (const input of stream(5, 400)) {
        const x = mutate(a, input, undefined, opts);
        const y = mutate(b, input, undefined, { ...opts, drop: false });
        expect(y.event).toEqual(x.event);
        expect(x.event.slot1 >> HEAT_SHIFT).toBe(0n);
        expect(x.state.heat).toBeUndefined();
        a = x.state;
        b = y.state;
      }
    });
  }

  it("rel+acc+drop matches rel+acc bit for bit (slot0, slot1 below bit 168, events) until the first drop", () => {
    let a = initialRelativeState();
    let b = initialDropState(initialRelativeState());
    let dropped = false;
    let heated = false;
    for (const input of stream(9, 600, 0.9)) {
      const x = mutate(a, input, undefined, { relative: true, accumulate: true });
      const y = mutate(b, input, undefined, { relative: true, accumulate: true, drop: RULES });
      if (y.event.trackComplete) { dropped = true; break; }
      expect(y.event.slot0).toBe(x.event.slot0);
      expect(y.event.slot1 & M168).toBe(x.event.slot1);
      const { slot0: _a, slot1: _b, ...ex } = x.event;
      const { slot0: _c, slot1: _d, ...ey } = y.event;
      expect(ey).toEqual(ex);
      heated ||= (y.state.heat ?? 0) > 0;
      a = x.state;
      b = y.state;
    }
    expect(heated).toBe(true);
    expect(dropped).toBe(true);
  });
});

describe("drop: storage", () => {
  it("packs heat into slot1 bits 168..175 and trackNo into 176..191 only when asked", () => {
    const s: State = { ...initialRelativeState(), heat: 0xab, trackNo: 0xbeef };
    const plain = encode(s, { relative: true });
    const packed = encode(s, { relative: true, drop: true });
    expect(packed.slot0).toBe(plain.slot0);
    expect(packed.slot1 & M168).toBe(plain.slot1);
    expect((packed.slot1 >> HEAT_SHIFT) & 0xffn).toBe(0xabn);
    expect((packed.slot1 >> TRACK_NO_SHIFT) & 0xffffn).toBe(0xbeefn);
    expect(packed.slot1 >> 192n).toBe(0n);
    expect(decode(packed.slot0, packed.slot1, { relative: true, drop: true })).toEqual(s);
    expect(decode(packed.slot0, packed.slot1, { relative: true }).heat).toBeUndefined();
  });
});

describe("drop: heat", () => {
  const full = (bits: number) => (1n << BigInt(bits)) - 1n;
  const hot = (pattern: bigint, heat: number, extra: Partial<State> = {}): State => ({ ...initialDropState(initialRelativeState()), pattern, heat, swapCount: 10, lastTs: T0, ...extra });

  it("cools lazily: floor(dt / coolSec), saturating, clock going backwards does not cool", () => {
    expect(cooledHeat(10, 119, 120)).toBe(10);
    expect(cooledHeat(10, 240, 120)).toBe(8);
    expect(cooledHeat(3, 1800, 120)).toBe(0);
    expect(cooledHeat(5, -50, 120)).toBe(5);
    // In mutate the cooling comes first: a sell after 10 min on heat 7 → 7 - 5 - 1 = 1.
    const s = mutate(hot(full(40), 7), swap(E, 1, false, T0 + 600), undefined, { relative: true, accumulate: true, drop: RULES });
    expect(s.state.heat).toBe(1);
    const back = mutate(hot(full(40), 7), swap(E, 1, false, T0 - 600), undefined, { relative: true, accumulate: true, drop: RULES });
    expect(back.state.heat).toBe(6);
  });

  it("a buy heats only when the grid is saturated after the write; sells cool by sellCool, never below 0", () => {
    const opts = (r: Partial<DropRules> = {}): MutateOptions => ({ relative: true, accumulate: true, drop: { ...RULES, ...r } });
    // 55 bits + one buy that sets a bit = 56 → heats.
    const below = mutate(hot(full(55), 0), swap(E, 1), undefined, opts());
    expect(popcount64(below.state.pattern)).toBe(56);
    expect(below.state.heat).toBe(1);
    // 40 bits → no heat.
    expect(mutate(hot(full(40), 3), swap(E, 1), undefined, opts()).state.heat).toBe(3);
    expect(mutate(hot(full(60), 3), swap(E, 1, false), undefined, opts()).state.heat).toBe(2);
    expect(mutate(hot(full(60), 0), swap(E, 1, false), undefined, opts()).state.heat).toBe(0);
    expect(mutate(hot(full(60), 3), swap(E, 1, false), undefined, opts({ sellCool: 0 })).state.heat).toBe(3);
  });

  it("noopHeat: a buy that changes no bit heats even below satBits", () => {
    // Kick, snare and glitch rows full, hat row empty: a glitch-tier buy has nowhere to go (ladder + scan full).
    const p = 0xffffn | (0xffffn << 16n) | (0xffffn << 48n);
    const s = hot(p, 2, { sizeLogEma: 993 });
    const amt = 6n * E; // r = L(6) - 993 ≈ +4 → glitch
    const off = mutate(s, swap(amt, 1), undefined, { relative: true, accumulate: true, drop: RULES });
    expect(off.event.noop).toBe(true);
    expect(off.state.heat).toBe(2);
    const on = mutate(s, swap(amt, 1), undefined, { relative: true, accumulate: true, drop: { ...RULES, noopHeat: true } });
    expect(on.state.heat).toBe(3);
  });

  it("whales never add or remove heat (cooling by time still applies)", () => {
    for (const isBuy of [true, false]) {
      const w = mutate(hot(full(63), 9), swap(150n * E, 1, isBuy), undefined, { relative: true, accumulate: true, drop: RULES });
      expect(w.event.whale).toBe(true);
      expect(w.state.heat).toBe(9);
    }
  });
});

describe("drop: the swarm finishes a track", () => {
  it("at heatMax: snapshot before the reset, movement, seed, thinned bass, heat 0, trackNo + 1", () => {
    const pre: State = { ...initialDropState(initialRelativeState()), pattern: (1n << 64n) - 1n, bass: 0x123456789abcdef1n, heat: 15, trackNo: 4, swapCount: 99, lastTs: T0, root: 9, patternId: 7 };
    const input = swap(E, 3);
    const opts: MutateOptions = { relative: true, accumulate: true, drop: RULES };
    const { state, event } = mutate(pre, input, undefined, opts);
    const tc = event.trackComplete!;
    expect(tc).toBeDefined();
    // The snapshot is this swap's state just before the reset: full grid, heat = heatMax, old trackNo.
    const snap = decode(tc.slot0, tc.slot1, { relative: true, drop: true });
    expect(snap.pattern).toBe((1n << 64n) - 1n);
    expect(snap.heat).toBe(16);
    expect(snap.trackNo).toBe(4);
    expect(snap.root).toBe(9);
    expect(snap.swapCount).toBe(100);
    // Movement like a whale; seed from the swap hash; bass keeps its quarter-note anchors.
    const h = stepHash(100, input.tick, input.blockNumber);
    expect(state.root).toBe(4);
    expect(state.patternId).toBe(8);
    expect(state.pattern).toBe(dropSeed(h));
    expect(state.bass).toBe(snap.bass & BASS_KEEP);
    expect(state.heat).toBe(0);
    expect(state.trackNo).toBe(5);
    expect(tc).toMatchObject({ trackNo: 5, swapCount: 100, patternId: 8, root: 4, seed: dropSeed(h) });
    expect(decode(event.slot0, event.slot1, { relative: true, drop: true })).toEqual(state);
    // The event's bassNote is the note this swap wrote (before the thinning).
    expect(event.bassNote).toBe(Number((snap.bass >> BigInt(event.step * 4)) & 0xfn));
  });

  it("trackNo wraps at 2^16, heatMax 1 drops on the first saturated buy", () => {
    const pre: State = { ...initialDropState(initialRelativeState()), pattern: (1n << 64n) - 1n, heat: 0, trackNo: 0xffff, swapCount: 5, lastTs: T0 };
    const { state, event } = mutate(pre, swap(E, 1), undefined, { relative: true, accumulate: true, drop: { ...RULES, heatMax: 1 } });
    expect(event.trackComplete?.trackNo).toBe(0);
    expect(state.trackNo).toBe(0);
  });

  it("buys-only flow drops again and again; every state stays within 64 bits and heat <= heatMax", () => {
    let s = initialDropState(initialRelativeState());
    let drops = 0;
    for (const input of stream(21, 1000, 1)) {
      const r = mutate(s, input, undefined, { relative: true, accumulate: true, drop: DEFAULT_DROP_RULES });
      if (r.event.trackComplete) drops++;
      expect(r.state.heat!).toBeLessThan(DEFAULT_DROP_RULES.heatMax);
      expect(r.state.pattern >> 64n).toBe(0n);
      s = r.state;
    }
    expect(drops).toBeGreaterThan(5);
    expect(s.trackNo).toBe(drops);
  });
});

describe("drop: seed set", () => {
  it("seed reads only hash bits 64..88", () => {
    const h = 0x1234_5678_9abc_def0_0fed_cba9_8765_4321_1111_2222_3333_4444_5555_6666_7777_8888n;
    const keep = ((1n << 25n) - 1n) << 64n;
    const other = h ^ (~keep & ((1n << 256n) - 1n));
    expect(dropSeed(other)).toBe(dropSeed(h));
  });

  it("every seed: kick downbeat, snare backbeat, 3..6 hats, at most one glitch, 7..14 bits", () => {
    for (let i = 0; i < 4096; i++) {
      const h = BigInt(i) << 64n | BigInt(i * 7919) << 76n;
      const p = dropSeed(h);
      expect(isOn(p, 0, 0)).toBe(true);
      expect(isOn(p, 1, 4) && isOn(p, 1, 12)).toBe(true);
      const hats = popcount64((p >> 32n) & 0xffffn);
      expect(hats).toBeGreaterThanOrEqual(3);
      expect(hats).toBeLessThanOrEqual(6);
      expect(popcount64(p >> 48n)).toBeLessThanOrEqual(1);
      expect(popcount64(p)).toBeGreaterThanOrEqual(7);
      expect(popcount64(p)).toBeLessThanOrEqual(14);
    }
  });

  it("all 26,112 seeds arrange within the caps (kick <= 6 with downbeat, backbeat, glitch <= 3, no machine gun)", () => {
    const base = initialRelativeState();
    for (const k of SEED_KICKS) for (const sn of SEED_SNARES) for (let hk = 3; hk <= 6; hk++) for (let rot = 0; rot < 16; rot++) for (let g = -1; g < 16; g++) {
      const pattern = BigInt(k) | (BigInt(sn) << 16n) | (BigInt(euclidMask(hk, rot)) << 32n) | (g < 0 ? 0n : 1n << BigInt(48 + g));
      for (const bar of [16, 19]) {
        const a = arrange({ ...base, pattern, bass: 0x123456789abcdef1n }, bar);
        const kicks = a.vel[0].filter((v) => v > 0).length;
        expect(kicks).toBeLessThanOrEqual(6);
        expect(a.vel[0][0]).toBeGreaterThan(0);
        expect(a.vel[1][4] > 0 && a.vel[1][12] > 0).toBe(true);
        expect(a.vel[3].filter((v) => v > 0).length).toBeLessThanOrEqual(3);
        for (let s = 0; s < 16; s++) expect(a.vel[0][s] > 0 && a.vel[0][(s + 1) % 16] > 0 && a.vel[0][(s + 2) % 16] > 0).toBe(false);
      }
    }
  });
});

describe("drop: clock cooling (alternative)", () => {
  it("counts coolSec boundaries crossed, so short gaps still cool over time", () => {
    const rules: DropRules = { ...RULES, satBits: 65, coolMode: "clock" };
    const gap: DropRules = { ...rules, coolMode: "gap" };
    // 40 swaps 6 s apart = 240 s: gap mode never cools, clock mode crosses two 120 s boundaries.
    let a: State = { ...initialDropState(initialRelativeState()), heat: 5, swapCount: 1, lastTs: 1_760_000_040 };
    let b = { ...a };
    for (let i = 1; i <= 40; i++) {
      const input = swap(E, i, true, 1_760_000_040 + i * 6);
      a = mutate(a, input, undefined, { relative: true, accumulate: true, drop: rules }).state;
      b = mutate(b, input, undefined, { relative: true, accumulate: true, drop: gap }).state;
    }
    expect(b.heat).toBe(5);
    expect(a.heat).toBe(3);
  });
});

describe("drop: silence cooling (default)", () => {
  const rules: DropRules = { ...RULES, satBits: 65, coolMode: "silence" }; // satBits 65, noopHeat off: buys never heat
  const opts: MutateOptions = { relative: true, accumulate: true, drop: rules };
  const hot = (heat: number): State => ({ ...initialDropState(initialRelativeState()), heat, swapCount: 1, lastTs: T0 });

  it("is the default and mirrors the synth's drone stage", () => {
    expect(DEFAULT_DROP_RULES.coolMode).toBe("silence");
    expect(SILENCE_RESET_SEC).toBe(3600);
  });

  it("never cools by time while the market is alive (gaps up to 3599 s)", () => {
    let s = hot(9);
    for (let i = 1; i <= 20; i++) s = mutate(s, swap(E, i, true, T0 + i * 3599), undefined, opts).state;
    expect(s.heat).toBe(9);
    expect(coolHeat(9, T0, T0 + 3599, rules)).toBe(9);
  });

  it("resets heat at exactly 3600 s of silence, not at 3599", () => {
    expect(mutate(hot(12), swap(E, 1, true, T0 + 3599), undefined, opts).state.heat).toBe(12);
    expect(mutate(hot(12), swap(E, 1, true, T0 + 3600), undefined, opts).state.heat).toBe(0);
    expect(coolHeat(12, T0, T0 + SILENCE_RESET_SEC, rules)).toBe(0);
    // A clock going backwards does not reset.
    expect(mutate(hot(12), swap(E, 1, true, T0 - 5000), undefined, opts).state.heat).toBe(12);
  });

  it("the reset happens before the swap heats: a saturated buy after an hour starts again at 1", () => {
    const heating: MutateOptions = { relative: true, accumulate: true, drop: { ...rules, satBits: 0 } };
    expect(mutate(hot(12), swap(E, 1, true, T0 + 3600), undefined, heating).state.heat).toBe(1);
    expect(mutate(hot(12), swap(E, 1, true, T0 + 3599), undefined, heating).state.heat).toBe(13);
  });

  it("sells still cool by sellCool, saturating at 0", () => {
    let s = hot(3);
    s = mutate(s, swap(E, 1, false, T0 + 600), undefined, opts).state;
    expect(s.heat).toBe(2);
    s = mutate(s, swap(E, 2, false, T0 + 1200), undefined, opts).state;
    s = mutate(s, swap(E, 3, false, T0 + 1800), undefined, opts).state;
    s = mutate(s, swap(E, 4, false, T0 + 2400), undefined, opts).state;
    expect(s.heat).toBe(0);
  });

  it("a slow buy-heavy market still finishes a track (30-min gaps)", () => {
    let s: State = initialDropState(initialRelativeState());
    let drops = 0;
    const r = rng(5);
    for (let i = 0; i < 400; i++) {
      const res = mutate(s, swap(BigInt(Math.round(3e5 * 2 ** (2 * r() - 1))) * 10n ** 12n, i, r() < 0.8, T0 + i * 1800), undefined, { relative: true, accumulate: true, drop: true });
      s = res.state;
      if (res.event.trackComplete) drops++;
    }
    expect(drops).toBeGreaterThan(0);
  });
});
