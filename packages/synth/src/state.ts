/**
 * Bit layout matches SPEC §3.2 and @swarm-sequencer/core.
 * This copy has no runtime dependencies (core's decode pulls viem for mutate).
 */

export const STEPS = 16;
export const TRACKS = 4;
export const TRACK_KICK = 0;
export const TRACK_SNARE = 1;
export const TRACK_HAT = 2;
export const TRACK_GLITCH = 3;

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const MODE_NAMES = ["Dorian", "Phrygian", "Lydian", "Locrian"] as const;

/** Semitone offsets from the root. Indexed by SPEC mode id. */
export const SCALES: readonly (readonly number[])[] = [
  [0, 2, 3, 5, 7, 9, 10], // Dorian
  [0, 1, 3, 5, 7, 8, 10], // Phrygian
  [0, 2, 4, 6, 7, 9, 11], // Lydian
  [0, 1, 3, 5, 6, 8, 10], // Locrian
];

export const INITIAL_PATTERN = 0x10100101n;
export const INITIAL_BPM = 96;
export const INITIAL_ROOT = 9;
export const INITIAL_MODE = 0;
export const INITIAL_INTERVAL_EMA = 600;

export interface SequencerState {
  pattern: bigint;
  bass: bigint;
  swapCount: number;
  lastTs: number;
  bpm: number;
  root: number;
  mode: number;
  patternId: number;
  lastTick: number;
  pressure: number;
  intervalEma: number;
  releaseCount: number;
  /**
   * Heat -> drop prototype only: buy pressure on a saturated grid, 0..1 (raw uint8 / heatMax).
   * Undefined or 0 leaves every voice exactly as before.
   */
  heat?: number;
  /** Heat -> drop prototype only: tracks the swarm has finished (uint16). */
  trackNo?: number;
}

/** Heat -> drop prototype: slot1 bit offsets of heat (uint8) and trackNo (uint16). */
export const HEAT_SHIFT = 168n;
export const TRACK_NO_SHIFT = 176n;

export interface DecodeOptions {
  /** Read heat (slot1 bits 168..175) and normalize it by this heatMax; also read trackNo. Omit for the shipped layout. */
  heatMax?: number;
}

/** Alias matching packages/core's `State`. */
export type State = SequencerState;

export interface Slots {
  slot0: bigint;
  slot1: bigint;
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
  const masked = v & mask(bits);
  return Number(masked >= sign ? masked - (1n << BigInt(bits)) : masked);
}

function toUnsigned(v: number, bits: number): bigint {
  return BigInt(Math.trunc(v)) & mask(bits);
}

export function initialState(): SequencerState {
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

export function encode(s: SequencerState): Slots {
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

export function decode(slot0: bigint | string | number, slot1: bigint | string | number, opts?: DecodeOptions): SequencerState {
  const a = BigInt(slot0);
  const b = BigInt(slot1);
  const s: SequencerState = {
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
  if (opts?.heatMax && opts.heatMax > 0) {
    s.heat = Math.min(1, Number((b >> HEAT_SHIFT) & M8) / opts.heatMax);
    s.trackNo = Number((b >> TRACK_NO_SHIFT) & M16);
  }
  return s;
}

export function isOn(pattern: bigint, track: number, step: number): boolean {
  return ((pattern >> BigInt(track * 16 + step)) & 1n) === 1n;
}

export function bassAt(bass: bigint, step: number): number {
  return Number((bass >> BigInt(step * 4)) & 0xfn);
}

/** MIDI note for scale degree 1..15, or null for a rest. Octave starts at C2. */
export function bassMidi(root: number, mode: number, deg: number): number | null {
  if (deg <= 0) return null;
  const scale = SCALES[mode] ?? SCALES[0];
  const index = deg - 1;
  const semi = scale[index % 7] + Math.floor(index / 7) * 12;
  return 36 + (((root % 12) + 12) % 12) + semi;
}

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function bassLabel(root: number, mode: number, deg: number): string {
  const midi = bassMidi(root, mode, deg);
  if (midi == null) return "·";
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

/** `bpm · root/mode · swap #N · page #M` — page is patternId (SPEC §3.1 «страница»). */
export function infoLine(s: SequencerState): string {
  const root = NOTE_NAMES[(((s.root % 12) + 12) % 12)];
  const mode = MODE_NAMES[s.mode] ?? "Dorian";
  return `${s.bpm | 0} · ${root}/${mode} · swap #${s.swapCount >>> 0} · page #${s.patternId >>> 0}`;
}

export function hexSlot(v: bigint): string {
  return "0x" + v.toString(16);
}
