// Timeline format consumed by web/render.html and the bot. See bot/TIMELINE.md.
import { encode, mutate, whaleThresholdFor, type MutationInput, type NftTag, type State } from "@swarm-sequencer/core";
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
  /** |quote delta| in wei, decimal string (launch hook: native ETH). */
  quoteAmt: string;
  /** Human quote amount (float, display only). */
  quote: number;
  /** Quote currency of this entry; absent = ETH. "IMD" for the legacy IMD-quoted v1 hook. */
  quoteSymbol?: QuoteSymbol;
  /** Legacy tapes (IMD-quoted): read via quoteAmtOf/quoteOf/quoteSymbolOf, never written. */
  imdAmt?: string;
  imd?: number;
  tick: number;
  // mutation result (= Mutated event fields)
  track: number;
  step: number;
  /** Accumulate mode: the pattern step actually written, when a spill moved it off `step` (core writeStep). */
  writeStep?: number;
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
  /** Mutated.sender was the pulse treasury (PULSE_TREASURY): an automatic buy after 15 min of silence. */
  pulse?: true;
  /** NFT stations: the item sold and where (core nft.ts). */
  nft?: NftTag;
}

export interface TimelineMeta {
  version: 1;
  /** Absent = v1. */
  rules?: HookRules;
  /** Quote currency of the amounts; absent = IMD on legacy tapes that carry imdAmt, else ETH. */
  quoteSymbol?: QuoteSymbol;
  /** How the amounts were obtained, when not read directly from logs. */
  quoteNote?: string;
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

export type QuoteSymbol = "ETH" | "IMD";

/** Legacy-tolerant readers: new tapes carry quoteAmt/quote, old ones imdAmt/imd (IMD-quoted). */
type AmountFields = Partial<Pick<TimelineEntry, "quoteAmt" | "quote" | "quoteSymbol" | "imdAmt" | "imd">>;
export const quoteSymbolOf = (e: AmountFields): QuoteSymbol => e.quoteSymbol ?? (e.quoteAmt == null && e.imdAmt != null ? "IMD" : "ETH");
export const quoteAmtOf = (e: AmountFields): bigint => BigInt(e.quoteAmt ?? e.imdAmt ?? 0);
export const quoteOf = (e: AmountFields): number => e.quote ?? e.imd ?? weiToFloat(quoteAmtOf(e));
/** Whale threshold for the entry's quote at its post-swap tick: FDV-scaled for ETH (launch hook), 100 IMD (v1 hook). */
export const whaleWeiFor = (symbol: QuoteSymbol, tick: number): bigint => whaleThresholdFor(symbol, tick);
/** 18-decimal wei -> float with 6 decimals kept (display only). */
export const weiToFloat = (wei: bigint): number => Number(wei / 10n ** 12n) / 1e6;
/** Display: ETH amounts are small, so keep four decimals below 1. */
export const formatQuote = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));

export function toTimelineState(s: State): TimelineState {
  return { ...s, pattern: hex(s.pattern), bass: hex(s.bass) };
}

export interface RawSwap extends MutationInput {
  txHash?: string;
  logIndex?: number;
  poolId?: string;
  nft?: NftTag;
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
    const extra: Pick<TimelineEntry, "rules" | "trackComplete" | "writeStep"> = rules === "v1" ? {} : { rules };
    if (r.event.writeStep !== undefined && r.event.writeStep !== r.event.step) extra.writeStep = r.event.writeStep;
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
      quoteAmt: sw.quoteAmt.toString(),
      // An NFT item: quoteAmt is its size for the rules, the price is in its tag.
      quote: weiToFloat(sw.nft ? BigInt(sw.nft.price) : sw.quoteAmt),
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
      ...(sw.nft ? { nft: sw.nft } : {}),
    };
  });
  const init = encode(start, slotOptions(rules));
  return { entries, final: s, initial: { slot0: hex(init.slot0), slot1: hex(init.slot1), state: toTimelineState(start) } };
}
