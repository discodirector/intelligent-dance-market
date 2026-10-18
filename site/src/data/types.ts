import type { State } from "@swarm-sequencer/core";

export interface SwapEvent {
  ts: number; // unix seconds
  block: number;
  tx: string | null;
  isBuy: boolean;
  imd: number; // display amount
  track: number;
  step: number;
  on: boolean;
  bassNote: number;
  whale: boolean;
  state: State;
  /** v2 only: this swap pushed heat to heatMax and finished the track. */
  trackComplete?: TrackDone;
}

export interface TrackDone {
  /** Number of the finished track (1-based). */
  trackNo: number;
  /** Swaps that went into it: since the previous drop, or since the start of the feed. */
  swaps: number;
  /** The finished track (hook snapshot before the reset); held by the synth until the next downbeat. */
  held: State;
}

export interface Feed {
  /** Called with every swap in order. `backfill` = historical load, no audio drop cue. */
  onSwap(e: SwapEvent, backfill: boolean): void;
  onState(s: State): void;
  onBlock(n: number): void;
  onStatus(text: string, ok: boolean): void;
  /** Virtual clock for replay (unix seconds); null = wall clock. */
  onClock(now: number | null): void;
}

export const WHALE_WEI = 100n * 10n ** 18n;
export const fromWei = (w: bigint) => Number(w / 10n ** 12n) / 1e6;
