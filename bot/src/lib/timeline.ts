// Timeline format consumed by web/render.html and the bot. See bot/TIMELINE.md.
import { encode, initialState, mutate, type MutationInput, type State } from "@swarm-sequencer/core";

export interface TimelineState {
  pattern: string; // 0x hex uint64
  bass: string; // 0x hex uint64
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
}

export interface TimelineEntry {
  i: number;
  ts: number; // unix seconds (block timestamp)
  blockNumber: number;
  txHash?: string;
  logIndex?: number;
  poolId?: string;
  // mutation input
  isBuy: boolean;
  imdAmt: string; // wei, decimal string
  imd: number; // human IMD amount (float, display only)
  tick: number;
  // mutation result (= Mutated event fields)
  track: number;
  step: number;
  on: boolean;
  bassNote: number;
  whale: boolean;
  movement: boolean;
  // full state after the swap
  slot0: string;
  slot1: string;
  state: TimelineState;
}

export interface TimelineMeta {
  version: 1;
  chainId: number;
  source: string;
  poolManager?: string;
  poolIds: string[];
  token: string;
  fromBlock: number;
  toBlock: number;
  fromTs: number;
  toTs: number;
  count: number;
  generatedAt: string;
  initial: { slot0: string; slot1: string; state: TimelineState };
}

const hex = (v: bigint) => "0x" + v.toString(16);

export function toTimelineState(s: State): TimelineState {
  return { ...s, pattern: hex(s.pattern), bass: hex(s.bass) };
}

export interface RawSwap extends MutationInput {
  txHash?: string;
  logIndex?: number;
  poolId?: string;
}

export function buildTimeline(swaps: RawSwap[], start: State = initialState()) {
  let s = start;
  const entries: TimelineEntry[] = swaps.map((sw, i) => {
    const r = mutate(s, sw);
    s = r.state;
    return {
      i,
      ts: Number(sw.timestamp),
      blockNumber: Number(sw.blockNumber),
      txHash: sw.txHash,
      logIndex: sw.logIndex,
      poolId: sw.poolId,
      isBuy: sw.isBuy,
      imdAmt: sw.imdAmt.toString(),
      imd: Number(sw.imdAmt / 10n ** 12n) / 1e6,
      tick: sw.tick,
      track: r.event.track,
      step: r.event.step,
      on: r.event.on,
      bassNote: r.event.bassNote,
      whale: r.event.whale,
      movement: !!r.event.movement,
      slot0: hex(r.event.slot0),
      slot1: hex(r.event.slot1),
      state: toTimelineState(s),
    };
  });
  const init = encode(start);
  return { entries, final: s, initial: { slot0: hex(init.slot0), slot1: hex(init.slot1), state: toTimelineState(start) } };
}
