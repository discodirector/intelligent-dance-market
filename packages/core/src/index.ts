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
export const DEFAULT_THRESHOLDS: Thresholds = {
  hat: E18 / 2n,
  glitch: 5n * E18,
  snare: 25n * E18,
  kick: 100n * E18,
};

export const BPM_MIN = 90;
export const BPM_MAX = 170;
export const EMA_CAP = 3600;
export const PAGE = 64;

export const INITIAL_PATTERN = 0x10100101n;
export const INITIAL_BPM = 128;
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
}

export interface Slots {
  slot0: bigint;
  slot1: bigint;
}

export interface MutationInput {
  isBuy: boolean;
  imdAmt: bigint; // 18 decimals, absolute value
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
  imdAmount: bigint;
  tick: number;
  whale: boolean;
  slot0: bigint;
  slot1: bigint;
  /** Present when a Movement event is emitted (whale swap). */
  movement?: { patternId: number; root: number; swapCount: number };
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

export function encode(s: State): Slots {
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
    (toUnsigned(s.releaseCount, 32) << 120n);
  return { slot0, slot1 };
}

export function decode(slot0: bigint | string, slot1: bigint | string): State {
  const a = BigInt(slot0);
  const b = BigInt(slot1);
  return {
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
}

export function stepHash(swapCount: number, tick: number, blockNumber: bigint | number): bigint {
  return BigInt(
    keccak256(
      encodePacked(["uint32", "int24", "uint64"], [swapCount, tick, BigInt(blockNumber)]),
    ),
  );
}

export function trackFor(imdAmt: bigint, t: Thresholds = DEFAULT_THRESHOLDS): number {
  if (imdAmt < t.hat) return TRACK_HAT;
  if (imdAmt < t.glitch) return TRACK_GLITCH;
  if (imdAmt < t.snare) return TRACK_SNARE;
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

/** Pure: returns a new state and the event the hook would emit. */
export function mutate(
  prev: State,
  input: MutationInput,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): { state: State; event: MutationEvent } {
  const s: State = { ...prev };
  const { isBuy, imdAmt, tick } = input;
  const now = Number(input.timestamp);

  // 2. counter + hash
  s.swapCount = (s.swapCount + 1) >>> 0;
  const h = stepHash(s.swapCount, tick, input.blockNumber);

  // 3. track
  const whale = imdAmt >= thresholds.kick;
  const track = trackFor(imdAmt, thresholds);

  // 4. step bit
  const step = Number(h % 16n);
  const bit = 1n << BigInt(track * 16 + step);
  s.pattern = isBuy ? s.pattern | bit : s.pattern & ~bit & M64;

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

  const { slot0, slot1 } = encode(s);
  return {
    state: s,
    event: {
      swapCount: s.swapCount,
      track,
      step,
      on: isBuy,
      bassNote: bassAt(s.bass, step),
      isBuy,
      imdAmount: imdAmt,
      tick,
      whale,
      slot0,
      slot1,
      movement,
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
