/**
 * TEMPORARY — SPEC §3.3 mutate(), local to the demo until the web app
 * switches over to @swarm-sequencer/core. Do not import this from the synth.
 * Behaviour is copied from the core port so a later swap does not retune the demo.
 */
import { encodePacked, keccak256 } from "viem";
import { bassAt, encode, type SequencerState } from "../../../packages/synth/src/state.ts";

export type { SequencerState };
export { initialState } from "../../../packages/synth/src/state.ts";

const E18 = 10n ** 18n;
const T_HAT = E18 / 2n;
const T_GLITCH = 5n * E18;
const T_SNARE = 25n * E18;
const T_KICK = 100n * E18;
const BPM_MIN = 72;
const BPM_MAX = 118;
const EMA_CAP = 900;
const PAGE = 64;
const M64 = (1n << 64n) - 1n;
/** Euclidean base masks for k = 3..8 (bit i set iff (i * k) % 16 < k). SPEC §3.3.8. */
const EUCLID = [0x0841n, 0x1111n, 0x2491n, 0x4949n, 0x54a9n, 0x5555n];

export interface SwapInput {
  isBuy: boolean;
  /** Absolute IMD amount, 18 decimals. */
  imdAmt: bigint;
  /** Pool tick after the swap. */
  tick: number;
  blockNumber: bigint | number;
  timestamp: bigint | number;
}

export interface Mutated {
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
  movement?: { patternId: number; root: number; swapCount: number };
  /** Whale track action: fill = Euclidean rhythm written, else wiped. `mask` = resulting 16 bits of the track. */
  drop?: { track: number; fill: boolean; mask: number };
}

function trackFor(imdAmt: bigint): number {
  if (imdAmt < T_HAT) return 2;
  if (imdAmt < T_GLITCH) return 3;
  if (imdAmt < T_SNARE) return 1;
  return 0;
}

function modeFor(pressure: number): number {
  if (pressure > 8000) return 2;
  if (pressure >= 0) return 0;
  if (pressure >= -8000) return 1;
  return 3;
}

export function mutate(prev: SequencerState, input: SwapInput): { state: SequencerState; event: Mutated } {
  const s: SequencerState = { ...prev };
  const { isBuy, imdAmt, tick } = input;
  const now = Number(input.timestamp);

  s.swapCount = (s.swapCount + 1) >>> 0;
  const h = BigInt(
    keccak256(encodePacked(["uint32", "int24", "uint64"], [s.swapCount, tick, BigInt(input.blockNumber)])),
  );

  const whale = imdAmt >= T_KICK;
  const step = Number(h % 16n);
  let track: number;
  let drop: Mutated["drop"];
  if (whale) {
    // Whale acts on a whole track: sell wipes it, buy writes a rotated Euclidean rhythm.
    track = Number((h >> 16n) % 4n);
    const shift = BigInt(track * 16);
    s.pattern &= ~(0xffffn << shift) & M64;
    let mask = 0n;
    if (isBuy) {
      const base = EUCLID[Number((h >> 24n) % 6n)];
      const rot = (h >> 32n) % 16n;
      mask = ((base << rot) | (base >> (16n - rot))) & 0xffffn;
      s.pattern |= mask << shift;
    }
    drop = { track, fill: isBuy, mask: Number(mask) };
  } else {
    track = trackFor(imdAmt);
    const bit = 1n << BigInt(track * 16 + step);
    s.pattern = isBuy ? s.pattern | bit : s.pattern & ~bit & M64;
  }

  const absTick = tick < 0 ? -tick : tick;
  const deg = 1 + (Math.floor(absTick / 60) % 15);
  const nibShift = BigInt(step * 4);
  if (isBuy) {
    s.bass = (s.bass & ~(0xfn << nibShift) & M64) | (BigInt(deg) << nibShift);
  } else if (((h >> 8n) & 1n) === 0n) {
    s.bass = s.bass & ~(0xfn << nibShift) & M64;
  }

  // First swap = swapCount == 0 before increment; dt = 0 if the clock goes backwards.
  const dt =
    prev.swapCount === 0 ? s.intervalEma : now < prev.lastTs ? 0 : Math.min(now - prev.lastTs, EMA_CAP);
  s.intervalEma = Math.floor((s.intervalEma * 7 + dt) / 8) >>> 0;
  const bpm = BPM_MAX - Math.floor((s.intervalEma * (BPM_MAX - BPM_MIN)) / EMA_CAP);
  s.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));

  s.pressure = s.pressure - Math.trunc(s.pressure / 16) + (isBuy ? 1000 : -1000);
  s.mode = modeFor(s.pressure);

  let movement: Mutated["movement"];
  if (whale) {
    s.root = (s.root + 7) % 12;
    s.patternId = (s.patternId + 1) >>> 0;
    movement = { patternId: s.patternId, root: s.root, swapCount: s.swapCount };
  }
  if (s.swapCount % PAGE === 0) s.patternId = (s.patternId + 1) >>> 0;

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
      drop,
    },
  };
}
