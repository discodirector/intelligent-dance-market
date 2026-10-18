// Timeline format consumed by web/render.html and the bot. See bot/TIMELINE.md.
import { encode, mutate, type MutationInput, type State } from "@swarm-sequencer/core";
import { initialFor, mutateOptions, slotOptions, type HookRules } from "./hookRules.ts";

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
  /** v2 only. */
  sizeLogEma?: number;
  heat?: number;
  trackNo?: number;
}

/** v2 only: this swap finished a track (core `trackComplete`). slot0/slot1 = the finished track, before the reset. */
export interface TimelineTrackComplete {
  trackNo: number;
  /** Swaps that went into the track (since the previous drop). Absent when the track started before the window. */
  swaps?: number;
  swapCount: number;
  patternId: number;
  root: number;
  slot0: string;
  slot1: string;
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
  /** Hook rules the slots follow; absent = v1. */
  rules?: HookRules;
  trackComplete?: TimelineTrackComplete;
}

export interface TimelineMeta {
  version: 1;
  /** Absent = v1. */
  rules?: HookRules;
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

export function buildTimeline(swaps: RawSwap[], start?: State, rules: HookRules = "v1") {
  start ??= initialFor(rules);
  let s = start;
  let trackStart = start.swapCount;
  const opts = mutateOptions(rules);
  const entries: TimelineEntry[] = swaps.map((sw, i) => {
    const r = mutate(s, sw, undefined, opts);
    s = r.state;
    const tc = r.event.trackComplete;
    const extra: Pick<TimelineEntry, "rules" | "trackComplete"> = rules === "v1" ? {} : { rules };
    if (tc) {
      extra.trackComplete = {
        trackNo: tc.trackNo, swaps: tc.swapCount - trackStart, swapCount: tc.swapCount, patternId: tc.patternId, root: tc.root,
        slot0: hex(tc.slot0), slot1: hex(tc.slot1),
      };
      trackStart = tc.swapCount;
    }
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
      ...extra,
    };
  });
  const init = encode(start, slotOptions(rules));
  return { entries, final: s, initial: { slot0: hex(init.slot0), slot1: hex(init.slot1), state: toTimelineState(start) } };
}
