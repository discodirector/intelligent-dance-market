import { whaleThresholdFor, type HamsterInput, type NftTag, type State } from "@swarm-sequencer/core";

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
  /** NFT stations: the item sold (a compose: the page) and the venue (core nft.ts). */
  nft?: NftTag;
  /** Hamster station: what the wheel did (core hamster.ts). `quote` is then the speed in m/s. */
  hamster?: HamsterInput["hamster"];
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
  /** NFT stations with a token pool: a swap there, an ornament in order with the swaps (never changes the state). */
  onOrnament?(o: OrnamentEvent, backfill: boolean): void;
  onState(s: State): void;
  onBlock(n: number): void;
  onStatus(text: string, ok: boolean): void;
  /** Virtual clock for replay (unix seconds); null = wall clock. */
  onClock(now: number | null): void;
  /** Hamster station's replay of the last run: start over from this state (it may be older than the one shown). */
  onReset?(s: State): void;
}

export type QuoteSymbol = "ETH" | "IMD";
/** Whale (drop) threshold per quote at the swap's post-swap tick: FDV-scaled for ETH (launch hook), 100 IMD (v1 hook). */
export const whaleWeiFor = (q: QuoteSymbol, tick: number): bigint => whaleThresholdFor(q, tick);
/** ETH amounts are small: four decimals below 1. */
export const formatQuote = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
export const fromWei = (w: bigint) => Number(w / 10n ** 12n) / 1e6;

/** What the NFT cues need of a player (synth LivePlayer noteSale / noteLock / notePage / noteOverprint / noteInk). */
interface NftCuePlayer {
  noteSale(cue: { pct: number; mask: number }): void;
  noteLock(cue: { points: number; ink?: readonly [number, number, number, number] }): void;
  notePage(cue: { rel: number; points?: number }): void;
  noteOverprint(cue: { count?: number }): void;
  noteInk(cue: { plate?: number; isBuy: boolean; size: number }): void;
}

/**
 * An NFT station's sound cues of a live input (core nft.ts tags): a rated Credit sale is a plate stab, a BALANCE
 * withdraw the deep lock event, a Statement sale the full-chord page stab, an overprint the double strike (synth
 * clock.ts SaleCue / LockCue / PageCue / OverprintCue). Untagged inputs (every other station) cue nothing.
 */
export function noteNftCues(player: NftCuePlayer, e: SwapEvent) {
  const n = e.nft;
  if (!n) return;
  if (n.via === "withdraw") player.noteLock({ points: n.points ?? 0, ...(n.ink ? { ink: n.ink } : {}) });
  else if (n.via === "overprint") player.noteOverprint(n.overprints !== undefined ? { count: n.overprints } : {});
  else if (n.kind === "statement") player.notePage({ rel: n.rel ?? 100, ...(n.points !== undefined ? { points: n.points } : {}) });
  else if (n.score !== undefined && n.mask) player.noteSale({ pct: n.score, mask: n.mask });
}

/**
 * A swap in an NFT station's token pool (Credits: BALANCE/ETH, core nft.ts NftOrnament): an ornament, never a rules
 * input. The feed shows it muted; the player plays it as a quiet ornament (synth InkCue); the NFT screen ignores it.
 */
export interface OrnamentEvent {
  ts: number;
  block: number;
  tx: string;
  isBuy: boolean;
  /** Tokens moved (whole, display). */
  amount: number;
  /** ETH moved. */
  eth: number;
  ink?: [number, number, number, number];
  /** The ink's strongest plate, 0 C .. 3 K. */
  plate?: number;
  /** The token's name on the feed ("BALANCE"). */
  token: string;
}

/** The ornament's cue (synth InkCue): the plate, the side, the size by the ETH it moved (synth inkSize's tiers). */
export const inkCueOf = (o: OrnamentEvent) => ({ ...(o.plate !== undefined ? { plate: o.plate } : {}), isBuy: o.isBuy, size: o.eth < 0.02 ? 0 : o.eth < 0.1 ? 1 : o.eth < 0.5 ? 2 : 3 });

/** A withdraw's ink, "C24 M23 Y24 K27". */
export const inkText = (ink: readonly number[]) => ink.map((x, i) => "CMYK"[i] + x).join(" ");
