// TS port of the Swarm Sequencer hook state model (SPEC §3). Must match Solidity bit for bit.
import { encodePacked, keccak256 } from "viem";

export const STEPS = 16;
export const TRACKS = 4;
export const TRACK_KICK = 0;
export const TRACK_SNARE = 1;
export const TRACK_HAT = 2;
export const TRACK_GLITCH = 3;
export const TRACK_NAMES = ["kick", "snare", "hat", "glitch"] as const;
export const MODE_NAMES = ["Dorian", "Phrygian", "Lydian", "Locrian"] as const;
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const E18 = 10n ** 18n;

// ---------------------------------------------------------------------------
// Quote calibration (SPEC §3.1). The launch hook pairs IDM with native ETH; the rules read |ETH delta| in wei.
// A 1/400 scale of the original IMD calibration, so the relative rules behave the same. The whale threshold is
// not a constant: it scales with the pool's FDV, read from the post-swap tick (whaleWeiAtTick below).
// Mirrors contracts/src/QuoteCalibration.sol; the hook gets hat/glitch/snare as constructor arguments.
// ---------------------------------------------------------------------------

/** Display symbol of the launch hook's quote currency. */
export const QUOTE_SYMBOL = "ETH";
/**
 * ETH thresholds (wei of native ETH): 0.00125 · 0.0125 · 0.0625 ETH, a 1/400 scale of the IMD ones.
 * `kick` (0.2 ETH) is the whale of the absolute v1-rules path only: ETH-calibrated replays of the old IMD tapes
 * (teasers keep their sound). The launch hook (V2_RULES, fdvWhale) ignores it and uses whaleWeiAtTick(tick).
 */
export const ETH_THRESHOLDS: Thresholds = {
  hat: 1_250_000_000_000_000n, // 0.5 IMD / 400
  glitch: 12_500_000_000_000_000n, // 5 IMD / 400
  snare: 62_500_000_000_000_000n, // 25 IMD / 400
  kick: 200_000_000_000_000_000n, // v1-rules replays only; not the launch hook's whale
};
/** Amounts under this are clamped up before entering the size EMA: 0.000025 ETH (0.01 IMD / 400). */
export const ETH_EMA_FLOOR = 25_000_000_000_000n;
/** sizeLogEma starts at log2Fixed of this: 0.0125 ETH (5 IMD / 400). */
export const ETH_INITIAL_SIZE = 12_500_000_000_000_000n;
/** v1 hook (Sepolia, IMD quote) thresholds: old replays and spec/vectors.json only. */
export const IMD_THRESHOLDS: Thresholds = {
  hat: E18 / 2n,
  glitch: 5n * E18,
  snare: 25n * E18,
  kick: 100n * E18,
};
/** The launch hook's thresholds (native ETH). */
export const DEFAULT_THRESHOLDS: Thresholds = ETH_THRESHOLDS;
/** Whale threshold of the v1 IMD-quoted hook (old tapes), wei of IMD. */
export const IMD_WHALE_WEI = IMD_THRESHOLDS.kick;

// ---------------------------------------------------------------------------
// FDV-scaled whale threshold (SPEC §3.1). whale_wei = K * sqrt(FDV_wei), clamped to [WHALE_MIN_WEI, WHALE_MAX_WEI].
// FDV_wei = SUPPLY / P with P = 1.0001^tick = IDM per ETH (currency0 = ETH, currency1 = IDM), so
// sqrt(FDV) = sqrt(SUPPLY) * getSqrtPriceAtTick(-tick) / 2^96 and whale_wei = C * getSqrtPriceAtTick(-tick) >> 96,
// C = floor(K * sqrt(SUPPLY)). K = 2e7: FDV 4 / 40 / 400 / 4000 ETH -> 0.04 / 0.1265 / 0.4 / 1.265 ETH.
// The tick is the post-swap pool tick: Mutated.tick, MutationInput.tick, the timeline entry's tick.
// ---------------------------------------------------------------------------

/** Fixed IDM supply, wei (1 billion tokens). */
export const IDM_SUPPLY = 10n ** 27n;
/** Whale scale factor, wei per sqrt(wei) of FDV. */
export const WHALE_K = 20_000_000n;
/** floor(WHALE_K * sqrt(IDM_SUPPLY)) = floor(sqrt(4e41)). */
export const WHALE_C = 632_455_532_033_675_866_399n;
/** Whale threshold clamp: 0.005 ETH (reached at tick >= 234971, FDV <= 0.0625 ETH) .. 50 ETH (tick <= 50754). */
export const WHALE_MIN_WEI = 5_000_000_000_000_000n;
export const WHALE_MAX_WEI = 50_000_000_000_000_000_000n;
/** v4-core TickMath bounds. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

const SQRT_MUL = [
  0xfffcb933bd6fad37aa2d162d1a594001n, 0xfff97272373d413259a46990580e213an, 0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n, 0xffcb9843d60f6159c9db58835c926644n, 0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n, 0xfe5dee046a99a2a811c461f1969c3053n, 0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n, 0xf3392b0822b70005940c7a398e4b70f3n, 0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n, 0xa9f746462d870fdf8a65dc1f90e061e5n, 0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n, 0x9aa508b5b7a84e1c677de54f3e99bc9n, 0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n, 0x48a170391f7dc42444e8fa2n,
] as const;
const U256_MAX = (1n << 256n) - 1n;

/** Bit-exact v4-core TickMath.getSqrtPriceAtTick: sqrt(1.0001^tick) * 2^96 (Q64.96). Throws if |tick| > MAX_TICK. */
export function getSqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || Math.abs(tick) > MAX_TICK) throw new RangeError(`InvalidTick(${tick})`);
  const abs = Math.abs(tick);
  let price = abs & 1 ? SQRT_MUL[0] : 1n << 128n;
  for (let i = 1; i < 20; i++) if ((abs >> i) & 1) price = (price * SQRT_MUL[i]) >> 128n;
  if (tick > 0) price = U256_MAX / price;
  return (price + (1n << 32n) - 1n) >> 32n;
}

/**
 * Whale threshold (quote wei) for a swap that leaves the pool at `tick` (SequencerState.whaleThreshold).
 * quoteIs0 (native ETH, the launch pool): sqrt(FDV) ~ sqrtPrice(-tick); a currency1 quote reads sqrtPrice(+tick).
 * Ticks outside TickMath's range saturate, so this never throws for an int24.
 */
export function whaleWeiAtTick(tick: number, quoteIs0 = true): bigint {
  const t = Math.min(MAX_TICK, Math.max(MIN_TICK, tick));
  const w = (WHALE_C * getSqrtPriceAtTick(quoteIs0 ? -t : t)) >> 96n;
  return w < WHALE_MIN_WEI ? WHALE_MIN_WEI : w > WHALE_MAX_WEI ? WHALE_MAX_WEI : w;
}

/** FDV in ETH wei at a pool tick (currency0 = ETH): IDM_SUPPLY / 1.0001^tick. Display only (float price). */
export function fdvWeiAtTick(tick: number): bigint {
  const sp = getSqrtPriceAtTick(Math.min(MAX_TICK, Math.max(MIN_TICK, -tick)));
  return (IDM_SUPPLY * sp * sp) >> 192n;
}

/**
 * The one whale helper for clients: threshold for an entry's quote and post-swap tick.
 * ETH (launch hook): FDV-scaled from the tick. IMD (v1 Sepolia hook, old tapes): the fixed 100 IMD.
 */
export function whaleThresholdFor(quote: "ETH" | "IMD", tick: number): bigint {
  return quote === "IMD" ? IMD_WHALE_WEI : whaleWeiAtTick(tick);
}

/** True when a swap of `quoteAmt` ending at `tick` is a whale (drop) for that quote. */
export function isWhaleSwap(quoteAmt: bigint, tick: number, quote: "ETH" | "IMD" = "ETH"): boolean {
  return quoteAmt >= whaleThresholdFor(quote, tick);
}

export const BPM_MIN = 72;
export const BPM_MAX = 118;
export const EMA_CAP = 900;
export const PAGE = 64;
/** Euclidean base masks for k = 3..8: bit i set iff (i * k) % 16 < k (SPEC §3.3.8). */
export const EUCLID_BASE = [0x0841, 0x1111, 0x2491, 0x4949, 0x54a9, 0x5555] as const;

export const INITIAL_PATTERN = 0x10100101n;
export const INITIAL_BPM = 96;
export const INITIAL_ROOT = 9;
export const INITIAL_MODE = 0;
export const INITIAL_INTERVAL_EMA = 600;

export interface Thresholds {
  hat: bigint;
  glitch: bigint;
  snare: bigint;
  kick: bigint;
}

export interface State {
  // slot0
  pattern: bigint; // uint64, bit track*16+step
  bass: bigint; // uint64, nibble per step
  swapCount: number; // uint32
  lastTs: number; // uint40
  bpm: number; // uint16
  root: number; // uint8
  mode: number; // uint8
  // slot1
  patternId: number; // uint32
  lastTick: number; // int24
  pressure: number; // int32
  intervalEma: number; // uint32
  releaseCount: number; // uint32
  /** Relative mode only: EMA of log2Fixed(quoteAmt), uint16, in slot1 bits 152..167. */
  sizeLogEma?: number;
  /** Drop mode only (prototype): buy pressure on a saturated grid, uint8. Would live in slot1 bits 168..175. */
  heat?: number;
  /** Drop mode only (prototype): tracks the swarm has finished, uint16 (wraps). Would live in slot1 bits 176..191. */
  trackNo?: number;
}

export interface Slots {
  slot0: bigint;
  slot1: bigint;
}

export interface MutationInput {
  isBuy: boolean;
  /** |delta| of the quote currency (launch: native ETH, wei; v1 hook: IMD), 18 decimals. */
  quoteAmt: bigint;
  tick: number; // pool tick after the swap
  blockNumber: bigint | number;
  timestamp: bigint | number;
}

export interface MutationEvent {
  swapCount: number;
  track: number;
  step: number;
  on: boolean;
  bassNote: number;
  isBuy: boolean;
  /** Mutated.quoteAmount (was imdAmount; same ABI slot and type). */
  quoteAmount: bigint;
  tick: number;
  whale: boolean;
  /** fdvWhale only: the whale threshold this swap was judged against (whaleWeiAtTick(tick)). Not an on-chain field. */
  whaleWei?: bigint;
  slot0: bigint;
  slot1: bigint;
  /** Present when a Movement event is emitted (whale swap). */
  movement?: { patternId: number; root: number; swapCount: number };
  /** Present for whale swaps (Drop event): fill = Euclidean rhythm written, else wiped; mask = resulting track bits. */
  drop?: { track: number; fill: boolean; mask: number };
  /** Accumulate mode only (non-whale): the track the size classified to, before the ladder moved it. */
  fromTrack?: number;
  /** Accumulate mode only (non-whale): the write left the classified (track, step) — `track`/`writeStep` say where it went. */
  promoted?: boolean;
  /** Accumulate mode only (non-whale): the pattern step actually written (differs from `step` only on a spill). `step` stays the hashed step, which also carries the bass note. */
  writeStep?: number;
  /** Accumulate mode only (non-whale): true when the swap changed no pattern bit at all. */
  noop?: boolean;
  /** Drop mode only: the swap pushed heat to heatMax and finished the track. slot0/slot1 = the finished track (before the reset). */
  trackComplete?: TrackComplete;
}

export interface TrackComplete {
  /** The new trackNo (1-based number of the finished track, mod 2^16). The snapshot still holds trackNo - 1. */
  trackNo: number;
  slot0: bigint;
  slot1: bigint;
  swapCount: number;
  /** patternId and root after the drop's movement. */
  patternId: number;
  root: number;
  /** The seed pattern the next track starts from. */
  seed: bigint;
}

const mask = (bits: number) => (1n << BigInt(bits)) - 1n;
const M8 = mask(8);
const M16 = mask(16);
const M24 = mask(24);
const M32 = mask(32);
const M40 = mask(40);
const M64 = mask(64);

function toSigned(v: bigint, bits: number): number {
  const sign = 1n << BigInt(bits - 1);
  return Number(v & sign ? v - (1n << BigInt(bits)) : v);
}

function toUnsigned(v: number, bits: number): bigint {
  return BigInt(v) & mask(bits);
}

export function initialState(): State {
  return {
    pattern: INITIAL_PATTERN,
    bass: 0n,
    swapCount: 0,
    lastTs: 0,
    bpm: INITIAL_BPM,
    root: INITIAL_ROOT,
    mode: INITIAL_MODE,
    patternId: 0,
    lastTick: 0,
    pressure: 0,
    intervalEma: INITIAL_INTERVAL_EMA,
    releaseCount: 0,
  };
}

export interface SlotOptions {
  /** Pack/read sizeLogEma (slot1 bits 152..167). */
  relative?: boolean;
  /** Pack/read heat (slot1 bits 168..175) and trackNo (bits 176..191). */
  drop?: boolean;
}

export function encode(s: State, opts?: SlotOptions): Slots {
  const slot0 =
    (s.pattern & M64) |
    ((s.bass & M64) << 64n) |
    (toUnsigned(s.swapCount, 32) << 128n) |
    (toUnsigned(s.lastTs, 40) << 160n) |
    (toUnsigned(s.bpm, 16) << 200n) |
    (toUnsigned(s.root, 8) << 216n) |
    (toUnsigned(s.mode, 8) << 224n);
  const slot1 =
    toUnsigned(s.patternId, 32) |
    (toUnsigned(s.lastTick, 24) << 32n) |
    (toUnsigned(s.pressure, 32) << 56n) |
    (toUnsigned(s.intervalEma, 32) << 88n) |
    (toUnsigned(s.releaseCount, 32) << 120n) |
    (opts?.relative ? toUnsigned(s.sizeLogEma ?? INITIAL_SIZE_LOG_EMA, 16) << SIZE_LOG_EMA_SHIFT : 0n) |
    (opts?.drop ? (toUnsigned(s.heat ?? 0, 8) << HEAT_SHIFT) | (toUnsigned(s.trackNo ?? 0, 16) << TRACK_NO_SHIFT) : 0n);
  return { slot0, slot1 };
}

export function decode(slot0: bigint | string, slot1: bigint | string, opts?: SlotOptions): State {
  const a = BigInt(slot0);
  const b = BigInt(slot1);
  const s: State = {
    pattern: a & M64,
    bass: (a >> 64n) & M64,
    swapCount: Number((a >> 128n) & M32),
    lastTs: Number((a >> 160n) & M40),
    bpm: Number((a >> 200n) & M16),
    root: Number((a >> 216n) & M8),
    mode: Number((a >> 224n) & M8),
    patternId: Number(b & M32),
    lastTick: toSigned((b >> 32n) & M24, 24),
    pressure: toSigned((b >> 56n) & M32, 32),
    intervalEma: Number((b >> 88n) & M32),
    releaseCount: Number((b >> 120n) & M32),
  };
  if (opts?.relative) s.sizeLogEma = Number((b >> SIZE_LOG_EMA_SHIFT) & M16);
  if (opts?.drop) {
    s.heat = Number((b >> HEAT_SHIFT) & M8);
    s.trackNo = Number((b >> TRACK_NO_SHIFT) & M16);
  }
  return s;
}

export function stepHash(swapCount: number, tick: number, blockNumber: bigint | number): bigint {
  return BigInt(
    keccak256(
      encodePacked(["uint32", "int24", "uint64"], [swapCount, tick, BigInt(blockNumber)]),
    ),
  );
}

export function trackFor(quoteAmt: bigint, t: Thresholds = DEFAULT_THRESHOLDS): number {
  if (quoteAmt < t.hat) return TRACK_HAT;
  if (quoteAmt < t.glitch) return TRACK_GLITCH;
  if (quoteAmt < t.snare) return TRACK_SNARE;
  return TRACK_KICK; // < T_KICK or whale
}

export function modeFor(pressure: number): number {
  if (pressure > 8000) return 2;
  if (pressure >= 0) return 0;
  if (pressure >= -8000) return 1;
  return 3;
}

export function bassAt(bass: bigint, step: number): number {
  return Number((bass >> BigInt(step * 4)) & 0xfn);
}

export function isOn(pattern: bigint, track: number, step: number): boolean {
  return ((pattern >> BigInt(track * 16 + step)) & 1n) === 1n;
}

/** 16-bit Euclidean rhythm with k hits (3..8) rotated left by rot (0..15). */
export function euclidMask(k: number, rot: number): number {
  const base = EUCLID_BASE[k - 3];
  return ((base << rot) | (base >>> (16 - rot))) & 0xffff;
}

// ---------------------------------------------------------------------------
// Relative-to-market tiers (PROTOTYPE, opt-in). The absolute path above/below is unchanged.
//
// log2Fixed(x): integer log2 with 4 fractional bits, for x > 0:
//   m = msb(x)                       (index of the highest set bit, 0..255)
//   f = m >= 4 ? (x >> (m - 4)) & 15 : (x << (4 - m)) & 15   (next 4 bits below the msb, linear mantissa)
//   L = m * 16 + f                   (fits uint16; 1 unit = 1/16 octave)
// log2Fixed(0) = 0. Solidity: m via the usual binary-search msb (or FixedPointMathLib.log2), then the shift.
//
// Per swap, BEFORE the EMA update: r = L - sizeLogEma (signed, 1/16 octave), then
//   r < hatBelow → HAT, r < glitchBelow → GLITCH, r < snareBelow → SNARE, else KICK.
// Whale stays absolute: quoteAmt >= the whale threshold (v2: whaleWeiAtTick(tick)) still drops, regardless of r.
// Update: Lc = clamp(L, L(floor), L(whale threshold)); sizeLogEma = (sizeLogEma * 7 + Lc) / 8 (floor div).
// The clamps stop one whale or a run of dust from shoving the market median far.
// ---------------------------------------------------------------------------

export interface RelativeTiers {
  /** r below this → HAT. */
  hatBelow: number;
  /** r below this → GLITCH. */
  glitchBelow: number;
  /** r below this → SNARE, else KICK. */
  snareBelow: number;
  /** Amounts under this are clamped up before entering the EMA (anti dust drag). */
  emaFloor: bigint;
}

export const SIZE_LOG_EMA_SHIFT = 152n;

export function msb(x: bigint): number {
  let m = 0;
  for (let k = 128; k >= 1; k >>= 1) {
    if (x >> BigInt(k) > 0n) {
      x >>= BigInt(k);
      m += k;
    }
  }
  return m;
}

export function log2Fixed(x: bigint): number {
  if (x <= 0n) return 0;
  const m = msb(x);
  const f = m >= 4 ? (x >> BigInt(m - 4)) & 15n : (x << BigInt(4 - m)) & 15n;
  return m * 16 + Number(f);
}

/** L(0.0125 ETH) = 854 (was L(5 IMD) = 993; 1/400 is not a power of two, so log2Fixed rounds it on its own). */
export const INITIAL_SIZE_LOG_EMA = log2Fixed(ETH_INITIAL_SIZE);

export const DEFAULT_RELATIVE_TIERS: RelativeTiers = {
  // Tuned on small-buys-varied (log-normal, median 0.3 IMD = 0.00075 ETH, sigma 1.2 octaves, 50 seeds):
  // hat 28% · glitch 34% · snare 23% · kick 15% at steady state. Floor division keeps the EMA
  // ~3.5/16 octave under the market, so r centres near +3, hence the asymmetric cut points.
  hatBelow: -8,
  glitchBelow: 10,
  snareBelow: 25,
  emaFloor: ETH_EMA_FLOOR,
};

/** The brief's starting tiers (<0.5x, 0.5x..1.5x, 1.5x..4x, >=4x), kept for the A/B harness. */
export const INITIAL_RELATIVE_TIERS: RelativeTiers = { ...DEFAULT_RELATIVE_TIERS, hatBelow: -16, glitchBelow: 9, snareBelow: 32 };

export function initialRelativeState(): State {
  return { ...initialState(), sizeLogEma: INITIAL_SIZE_LOG_EMA };
}

export function relativeTrackFor(r: number, t: RelativeTiers = DEFAULT_RELATIVE_TIERS): number {
  if (r < t.hatBelow) return TRACK_HAT;
  if (r < t.glitchBelow) return TRACK_GLITCH;
  if (r < t.snareBelow) return TRACK_SNARE;
  return TRACK_KICK;
}

export function nextSizeLogEma(ema: number, quoteAmt: bigint, thresholds: Thresholds = DEFAULT_THRESHOLDS, t: RelativeTiers = DEFAULT_RELATIVE_TIERS): number {
  const lo = log2Fixed(t.emaFloor);
  const hi = log2Fixed(thresholds.kick);
  const l = Math.min(hi, Math.max(lo, log2Fixed(quoteAmt)));
  return Math.floor((ema * 7 + l) / 8);
}

// ---------------------------------------------------------------------------
// Accumulation (PROTOTYPE, opt-in, combinable with relative). Only changes the cases that used to be no-ops:
// a buy whose bit is already set, or a sell whose bit is already clear. Everything else writes exactly as before.
//
// Strength ladder (rung): hat 0 < glitch 1 < snare 2 < kick 3, all at the SAME step.
//   buy  (bit set):   set the first CLEAR rung above the classified one (hat→glitch→snare→kick).
//                     Every rung up to kick set → buyFallback.
//   sell (bit clear): "up" (default) = clear the first SET rung above the classified one, stopping at snare: the
//                     mirror of the buy, except that only a kick-classified sell (or a whale) clears a kick.
//                     "upAll" = same but may reach kick; "down" = nearest set rung below; "near" = nearest either
//                     way, below first; "top" = highest set rung. Nothing to clear → sellFallback.
// Fallbacks: "none" = no-op; "spill" = the classified track at step+1 (one bit, else no-op);
//            "scan" = the nearest step after the hashed one, on the classified track, that the write changes
//                     (first clear bit for a buy, first set bit for a sell; row full/empty → no-op).
// Defaults (see sim/stress/accumulate/REPORT.md): buy ladder + scan, sell "up" + none.
// Loops are bounded: ≤ 3 rung probes, ≤ 15 scan probes (Solidity: rotate + lowest-zero bit trick, no loop).
// ---------------------------------------------------------------------------

/** Ladder index per track: kick 3, snare 2, hat 0, glitch 1. */
export const RUNG_OF = [3, 2, 0, 1] as const;
/** Track per ladder index, weakest first. */
export const LADDER = [TRACK_HAT, TRACK_GLITCH, TRACK_SNARE, TRACK_KICK] as const;

export type AccumulateFallback = "none" | "spill" | "scan";
export interface AccumulateRules {
  buyFallback: AccumulateFallback;
  sell: "up" | "upAll" | "down" | "near" | "top";
  sellFallback: AccumulateFallback;
}

export const DEFAULT_ACCUMULATE_RULES: AccumulateRules = { buyFallback: "scan", sell: "up", sellFallback: "none" };

export interface AccumulateWrite {
  pattern: bigint;
  track: number;
  step: number;
  /** No bit changed. */
  noop: boolean;
}

/** Pure: where a non-whale write lands under accumulation, and the resulting pattern. */
export function accumulateWrite(
  pattern: bigint,
  track: number,
  step: number,
  isBuy: boolean,
  rules: AccumulateRules = DEFAULT_ACCUMULATE_RULES,
): AccumulateWrite {
  const on = (t: number, st: number) => isOn(pattern, t, st);
  const write = (t: number, st: number): AccumulateWrite => {
    const bit = 1n << BigInt(t * 16 + st);
    return { pattern: isBuy ? pattern | bit : pattern & ~bit & M64, track: t, step: st, noop: false };
  };
  // Unchanged cases: the classified bit flips.
  if (on(track, step) !== isBuy) return write(track, step);

  const p = RUNG_OF[track];
  if (isBuy) {
    for (let q = p + 1; q < 4; q++) if (!on(LADDER[q], step)) return write(LADDER[q], step);
  } else if (rules.sell === "up" || rules.sell === "upAll") {
    const top = rules.sell === "up" ? 3 : 4;
    for (let q = p + 1; q < top; q++) if (on(LADDER[q], step)) return write(LADDER[q], step);
  } else if (rules.sell === "down") {
    for (let q = p - 1; q >= 0; q--) if (on(LADDER[q], step)) return write(LADDER[q], step);
  } else if (rules.sell === "near") {
    for (let d = 1; d < 4; d++) {
      if (p - d >= 0 && on(LADDER[p - d], step)) return write(LADDER[p - d], step);
      if (p + d < 4 && on(LADDER[p + d], step)) return write(LADDER[p + d], step);
    }
  } else {
    for (let q = 3; q >= 0; q--) if (q !== p && on(LADDER[q], step)) return write(LADDER[q], step);
  }

  const fb = isBuy ? rules.buyFallback : rules.sellFallback;
  if (fb === "spill") {
    const st = (step + 1) % STEPS;
    if (on(track, st) !== isBuy) return write(track, st);
  } else if (fb === "scan") {
    for (let i = 1; i < STEPS; i++) {
      const st = (step + i) % STEPS;
      if (on(track, st) !== isBuy) return write(track, st);
    }
  }
  return { pattern, track, step, noop: true };
}

// ---------------------------------------------------------------------------
// Heat -> drop: "the swarm finishes a track" (PROTOTYPE, opt-in, combinable with relative + accumulate).
// Buys keep landing on a saturated 64-bit grid, the arranged groove freezes and further buys change nothing.
// Heat counts those buys; at heatMax the track is finished and a fresh seed starts the next one.
//
// Per swap, in this order:
//   0. cool (first thing in mutate): dt = now >= lastTs ? now - lastTs : 0;
//      coolMode "silence" (default): heat = dt >= SILENCE_RESET_SEC ? 0 : heat   (no time cooling while the market lives)
//      coolMode "gap":   heat = heat > dt / coolSec ? heat - dt / coolSec : 0    (integer floor division, saturating)
//      coolMode "clock": c = now / coolSec - lastTs / coolSec instead of dt / coolSec; 0 when the clock goes back
//   ... bit write (abs/rel/acc as before) ...
//   heat: non-whale BUY and (popcount(pattern) >= satBits
//                            or (noopHeat and the buy changed no bit)) → heat += 1
//         non-whale SELL                                  → heat -= sellCool (saturating at 0)
//         whale                                           → untouched (it is already a movement)
//   ... bass, tempo, pressure, whale movement, page, lastTs (unchanged) ...
//   drop (heat >= heatMax): snapshot = encode(state)  → trackComplete event
//         root = (root + 7) % 12; patternId += 1        (same movement as a whale)
//         pattern = dropSeed(h); bass &= BASS_KEEP; heat = 0; trackNo += 1 (uint16, wraps)
// Defaults: satBits 44 (was 48, sim/stress/drop/REPORT.md), heatMax 16, coolMode silence, sellCool 1, noopHeat on.
// A drop depends on how many trades went into a full grid, not on how fast they came.
// ---------------------------------------------------------------------------

export interface DropRules {
  /** popcount(pattern) at or above which a non-whale buy adds heat. */
  satBits: number;
  /** Heat at which the track drops. 1..255. */
  heatMax: number;
  /** Seconds of silence per heat point lost (lazy, floor). Gap and clock modes only. */
  coolSec: number;
  /** Heat a non-whale sell removes (0 = sells do not cool). */
  sellCool: number;
  /** Also heat on a non-whale buy that changed no bit, whatever the popcount (a frozen row below satBits). */
  noopHeat?: boolean;
  /**
   * "silence" (default): no time cooling while the market is alive; a gap of SILENCE_RESET_SEC or more
   *   (the synth's drone stage) resets heat to 0. Only sells cool a live market.
   * "gap" (also the value when omitted): lose floor(dt / coolSec), so gaps shorter than coolSec never cool.
   * "clock": lose floor(now / coolSec) - floor(lastTs / coolSec), the coolSec boundaries crossed: no remainder is lost.
   */
  coolMode?: "gap" | "clock" | "silence";
}

/** Silence after which heat resets (coolMode "silence"). Mirrors packages/synth/src/idle.ts IDLE_DRONE_SEC. */
export const SILENCE_RESET_SEC = 3600;

export const DEFAULT_DROP_RULES: DropRules = { satBits: 44, heatMax: 16, coolSec: 120, sellCool: 1, noopHeat: true, coolMode: "silence" };

export const HEAT_SHIFT = 168n;
export const TRACK_NO_SHIFT = 176n;

/**
 * Seed set. Every component keeps the groove legible from the first bar of the new track:
 * kick has the downbeat, snare the 4/12 backbeat, hats an even Euclidean spread, glitch at most one hit.
 * 6 kick × 4 snare × 4 hat sizes × 16 rotations × 17 glitch options = 26,112 seeds, 7..14 bits each.
 */
export const SEED_KICKS = [0x0101, 0x0401, 0x0481, 0x0901, 0x4141, 0x1111] as const; // [0,8] [0,10] [0,7,10] [0,8,11] [0,6,8,14] [0,4,8,12]
export const SEED_SNARES = [0x1010, 0x1090, 0x1410, 0x9010] as const; // backbeat, + ghost on 7 / 10 / 15
/** Bass nibbles kept on a drop: the quarter-note anchors (steps 0, 4, 8, 12). */
export const BASS_KEEP = 0x000f000f000f000fn;

/** Seed pattern from the swap hash. Reads only bits 64..88 of h, which no other rule reads. */
export function dropSeed(h: bigint): bigint {
  const kick = SEED_KICKS[Number(((h >> 64n) & 0xffn) % 6n)];
  const snare = SEED_SNARES[Number((h >> 72n) & 3n)];
  const hat = euclidMask(3 + Number((h >> 76n) & 3n), Number((h >> 80n) & 15n));
  const g = Number((h >> 84n) & 31n);
  const glitch = g >= 16 ? 1 << (g & 15) : 0;
  return BigInt(kick) | (BigInt(snare) << 16n) | (BigInt(hat) << 32n) | (BigInt(glitch) << 48n);
}

export function popcount64(x: bigint): number {
  let n = 0;
  for (let v = x & M64; v; v &= v - 1n) n++;
  return n;
}

/** Lazy cooling: heat after `dt` seconds of silence. */
export function cooledHeat(heat: number, dt: number, coolSec: number): number {
  const c = Math.floor(Math.max(0, dt) / coolSec);
  return heat > c ? heat - c : 0;
}

/** Heat at `now` after the swap at `lastTs`, under the rules' cooling mode (step 1 of mutate). */
export function coolHeat(heat: number, lastTs: number, now: number, dr: DropRules): number {
  if (now < lastTs) return heat;
  if (dr.coolMode === "silence") return now - lastTs >= SILENCE_RESET_SEC ? 0 : heat;
  const cool = dr.coolMode === "clock" ? Math.floor(now / dr.coolSec) - Math.floor(lastTs / dr.coolSec) : Math.floor((now - lastTs) / dr.coolSec);
  return cooledHeat(heat, cool * dr.coolSec, dr.coolSec);
}

export function initialDropState(base: State = initialState()): State {
  return { ...base, heat: 0, trackNo: 0 };
}

export interface MutateOptions {
  /** Classify non-whale swaps against the market's own size EMA instead of fixed thresholds. */
  relative?: boolean | RelativeTiers;
  /** Grow repeated buys up the strength ladder (and thin repeated sells) instead of re-writing a bit that is already there. */
  accumulate?: boolean | AccumulateRules;
  /** Heat on a saturated grid finishes the track: snapshot, movement, fresh seed (see DropRules). */
  drop?: boolean | DropRules;
  /**
   * Whale threshold from the post-swap tick (whaleWeiAtTick) instead of thresholds.kick, for the whale test and the
   * EMA upper clamp. `true` = quote is currency0 (native ETH, the launch pool).
   */
  fdvWhale?: boolean | { quoteIs0: boolean };
}

/** The v2 hook: relative tiers + accumulation + heat/drop with their default rules, FDV-scaled whale. */
export const V2_RULES: MutateOptions = { relative: true, accumulate: true, drop: true, fdvWhale: true };
/** Slot layout of the v2 hook (sizeLogEma, heat, trackNo in slot1). */
export const V2_SLOTS: SlotOptions = { relative: true, drop: true };

/** Pure: returns a new state and the event the hook would emit. */
export function mutate(
  prev: State,
  input: MutationInput,
  thresholdsIn: Thresholds = DEFAULT_THRESHOLDS,
  opts?: MutateOptions,
): { state: State; event: MutationEvent } {
  const s: State = { ...prev };
  const fdv = opts?.fdvWhale ? (opts.fdvWhale === true ? { quoteIs0: true } : opts.fdvWhale) : null;
  const whaleWei = fdv ? whaleWeiAtTick(input.tick, fdv.quoteIs0) : undefined;
  const thresholds: Thresholds = whaleWei === undefined ? thresholdsIn : { ...thresholdsIn, kick: whaleWei };
  const rel = opts?.relative ? (opts.relative === true ? DEFAULT_RELATIVE_TIERS : opts.relative) : null;
  const acc = opts?.accumulate ? (opts.accumulate === true ? DEFAULT_ACCUMULATE_RULES : opts.accumulate) : null;
  const dr = opts?.drop ? (opts.drop === true ? DEFAULT_DROP_RULES : opts.drop) : null;
  const { isBuy, quoteAmt, tick } = input;
  const now = Number(input.timestamp);

  // 1. cool (drop mode): before anything else, from the previous swap's timestamp.
  if (dr) {
    s.heat = coolHeat(s.heat ?? 0, prev.lastTs, now, dr);
    s.trackNo = s.trackNo ?? 0;
  }

  // 2. counter + hash
  s.swapCount = (s.swapCount + 1) >>> 0;
  const h = stepHash(s.swapCount, tick, input.blockNumber);

  // 3. track
  const whale = quoteAmt >= thresholds.kick;
  const step = Number(h % 16n);
  let track: number;
  let drop: MutationEvent["drop"];
  let accEvent: Pick<MutationEvent, "fromTrack" | "promoted" | "writeStep" | "noop"> | undefined;
  if (whale) {
    // SPEC §3.3.8: a whale acts on the whole dropTrack. Sell wipes it; buy writes a rotated Euclidean rhythm.
    track = Number((h >> 16n) % 4n);
    const shift = BigInt(track * 16);
    s.pattern &= ~(0xffffn << shift) & M64;
    let mask = 0;
    if (isBuy) {
      mask = euclidMask(3 + Number((h >> 24n) % 6n), Number((h >> 32n) % 16n));
      s.pattern |= BigInt(mask) << shift;
    }
    drop = { track, fill: isBuy, mask };
  } else {
    track = rel ? relativeTrackFor(log2Fixed(quoteAmt) - (s.sizeLogEma ?? INITIAL_SIZE_LOG_EMA), rel) : trackFor(quoteAmt, thresholds);
    if (acc) {
      const w = accumulateWrite(s.pattern, track, step, isBuy, acc);
      accEvent = { fromTrack: track, promoted: w.track !== track || w.step !== step, writeStep: w.step, noop: w.noop };
      s.pattern = w.pattern;
      track = w.track;
    } else {
      const bit = 1n << BigInt(track * 16 + step);
      s.pattern = isBuy ? s.pattern | bit : s.pattern & ~bit & M64;
    }
    // 4b. heat (drop mode): buys on a saturated grid heat it, sells cool it. Whales never touch heat.
    if (dr) {
      if (isBuy) {
        if (popcount64(s.pattern) >= dr.satBits || (dr.noopHeat && s.pattern === prev.pattern)) s.heat = Math.min(255, (s.heat ?? 0) + 1);
      } else {
        s.heat = Math.max(0, (s.heat ?? 0) - dr.sellCool);
      }
    }
  }

  // 5. bass
  const absTick = tick < 0 ? -tick : tick;
  const deg = 1 + (Math.floor(absTick / 60) % 15);
  const nibShift = BigInt(step * 4);
  if (isBuy) {
    s.bass = (s.bass & ~(0xfn << nibShift) & M64) | (BigInt(deg) << nibShift);
  } else if (((h >> 8n) & 1n) === 0n) {
    s.bass = s.bass & ~(0xfn << nibShift) & M64;
  }

  // 6. tempo
  // First swap = swapCount == 0 before increment; dt = 0 if the clock goes backwards (SPEC §3.3 edge cases).
  const dt =
    prev.swapCount === 0 ? s.intervalEma : now < prev.lastTs ? 0 : Math.min(now - prev.lastTs, EMA_CAP);
  s.intervalEma = Math.floor((s.intervalEma * 7 + dt) / 8) >>> 0;
  const bpm = BPM_MAX - Math.floor((s.intervalEma * (BPM_MAX - BPM_MIN)) / EMA_CAP);
  s.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));

  // 7. pressure (Solidity int division truncates toward zero)
  s.pressure = s.pressure - Math.trunc(s.pressure / 16) + (isBuy ? 1000 : -1000);
  s.mode = modeFor(s.pressure);

  // 8. whale
  let movement: MutationEvent["movement"];
  if (whale) {
    s.root = (s.root + 7) % 12;
    s.patternId = (s.patternId + 1) >>> 0;
    movement = { patternId: s.patternId, root: s.root, swapCount: s.swapCount };
  }

  // 9. page
  if (s.swapCount % PAGE === 0) s.patternId = (s.patternId + 1) >>> 0;

  // 10.
  s.lastTs = now;
  s.lastTick = tick;
  if (rel) s.sizeLogEma = nextSizeLogEma(s.sizeLogEma ?? INITIAL_SIZE_LOG_EMA, quoteAmt, thresholds, rel);

  const slotOpts: SlotOptions | undefined = rel || dr ? { relative: !!rel, drop: !!dr } : undefined;

  const bassNote = bassAt(s.bass, step);

  // 11. drop (drop mode): the swarm finished the track. Snapshot first, then movement + fresh seed.
  let trackComplete: TrackComplete | undefined;
  if (dr && (s.heat ?? 0) >= dr.heatMax) {
    const snap = encode(s, slotOpts);
    s.root = (s.root + 7) % 12;
    s.patternId = (s.patternId + 1) >>> 0;
    s.pattern = dropSeed(h);
    s.bass &= BASS_KEEP;
    s.heat = 0;
    s.trackNo = ((s.trackNo ?? 0) + 1) & 0xffff;
    trackComplete = { trackNo: s.trackNo, slot0: snap.slot0, slot1: snap.slot1, swapCount: s.swapCount, patternId: s.patternId, root: s.root, seed: s.pattern };
  }

  const { slot0, slot1 } = encode(s, slotOpts);
  return {
    state: s,
    event: {
      swapCount: s.swapCount,
      track,
      step,
      on: isBuy,
      bassNote,
      isBuy,
      quoteAmount: quoteAmt,
      tick,
      whale,
      ...(whaleWei !== undefined ? { whaleWei } : {}),
      slot0,
      slot1,
      movement,
      drop,
      ...accEvent,
      ...(trackComplete ? { trackComplete } : {}),
    },
  };
}

/** JSON-friendly view of a state (bigints as 0x hex strings). */
export function stateToJSON(s: State) {
  const { slot0, slot1 } = encode(s);
  return {
    ...s,
    pattern: "0x" + s.pattern.toString(16),
    bass: "0x" + s.bass.toString(16),
    slot0: "0x" + slot0.toString(16),
    slot1: "0x" + slot1.toString(16),
  };
}

export function describe(s: State) {
  return {
    bpm: s.bpm,
    key: `${NOTE_NAMES[s.root % 12]} ${MODE_NAMES[s.mode] ?? "?"}`,
    swapCount: s.swapCount,
    page: s.patternId,
  };
}

// ---------------------------------------------------------------- pulse treasury
// contracts/src/PulseTreasury.sol: after PULSE_IDLE_SEC without swaps anyone may call pulse(), and the treasury buys
// a hat-sized amount of IDM with ETH. It calls PoolManager.swap itself, so Mutated.sender == the treasury address.

/** Seconds of silence (since the hook's lastTs) before a pulse is allowed. */
export const PULSE_IDLE_SEC = 900;
/** Pulse size clamp, wei of native ETH. MIN = the hook's EMA floor; below it pulse() reverts. */
export const PULSE_MIN_WEI = 25_000_000_000_000n;
export const PULSE_MAX_WEI = 2_000_000_000_000_000n;
/** Pulse size = 2^((sizeLogEma - 24)/16): 1.5 octaves under the size EMA, filed as a hat. */
export const PULSE_HAT_OFFSET = 24;

/** True when a Mutated.sender is the configured treasury. An empty/unset treasury labels nothing. */
export function isPulse(sender: string | null | undefined, treasury: string | null | undefined): boolean {
  return !!sender && !!treasury && sender.toLowerCase() === treasury.toLowerCase();
}

/** Inverse of log2Fixed on its grid (PulseTreasury.exp2Fixed). */
export function exp2Fixed(l: number): bigint {
  const m = BigInt(l >> 4), v = BigInt(16 + (l & 15));
  return m >= 4n ? v << (m - 4n) : v >> (4n - m);
}

/** PulseTreasury.pulseSize: wei the next pulse spends (0n = no budget). */
export function pulseSize(sizeLogEma: number, balanceWei: bigint): bigint {
  let a = sizeLogEma > PULSE_HAT_OFFSET ? exp2Fixed(sizeLogEma - PULSE_HAT_OFFSET) : 0n;
  if (a < PULSE_MIN_WEI) a = PULSE_MIN_WEI;
  if (a > PULSE_MAX_WEI) a = PULSE_MAX_WEI;
  const cap = balanceWei / 100n;
  if (a > cap) a = cap;
  return a < PULSE_MIN_WEI ? 0n : a;
}
