import { whaleThresholdFor, type State } from "@swarm-sequencer/core";

export interface SwapEvent {
  ts: number; // unix seconds
  block: number;
  tx: string | null;
  isBuy: boolean;
  quote: number; // display amount in quoteSymbol
  /** ETH for the launch hook; IMD for the v1 Sepolia hook and legacy tapes. */
  quoteSymbol: QuoteSymbol;
  track: number;
  step: number;
  on: boolean;
  bassNote: number;
  whale: boolean;
  /** Mutated.sender is the network's pulse treasury: an automatic buy after 15 min of silence. */
  pulse?: boolean;
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

export type QuoteSymbol = "ETH" | "IMD";
/** Whale (drop) threshold per quote at the swap's post-swap tick: FDV-scaled for ETH (launch hook), 100 IMD (v1 hook). */
export const whaleWeiFor = (q: QuoteSymbol, tick: number): bigint => whaleThresholdFor(q, tick);
/** ETH amounts are small: four decimals below 1. */
export const formatQuote = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
export const fromWei = (w: bigint) => Number(w / 10n ** 12n) / 1e6;
