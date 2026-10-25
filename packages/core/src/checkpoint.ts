// Station checkpoints (docs/STATIONS.md "Checkpoints"): the bot replays every station from its genesis block and
// publishes the v2 state it reached, so a browser starts there and replays only newer blocks instead of the whole
// history. A checkpoint is the encoded slots (the same packing the hook stores) plus the block they are valid after;
// replaying the blocks after it from that state is the full replay, bit for bit (test/checkpoint.test.ts).
// Pure: the bot writes the JSON (bot/src/station.ts), the site fetches and checks it (site/src/data/virtual.ts).
import { decode, V2_SLOTS, type State } from "./index.ts";
import type { NftTag } from "./nft.ts";

export const CHECKPOINT_VERSION = 1;

/** A recent swap the site shows on its tape (SwapEvent fields), with the state after it. */
export interface CheckpointSwap {
  ts: number;
  block: number;
  tx: string | null;
  isBuy: boolean;
  /** ETH wei (calibrated), decimal string. */
  quoteAmt: string;
  tick: number;
  track: number;
  /** The pattern step written (the event's writeStep, else its step). */
  step: number;
  on: boolean;
  bassNote: number;
  whale: boolean;
  /** State after the swap, v2 slots. */
  slot0: string;
  slot1: string;
  trackComplete?: { trackNo: number; swaps: number; slot0: string; slot1: string };
  /** NFT stations: the item and venue (nft.ts). */
  nft?: NftTag;
}

export interface StationCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  key: string;
  /** stationFingerprint (swaps.ts) of the stream it was computed from: chain, source, calibration, genesis. */
  fingerprint: string;
  /** Every swap up to and including this block is in the state; replay from block + 1. */
  block: number;
  /** State after the last swap, v2 slots (V2_SLOTS), 0x hex. */
  slot0: string;
  slot1: string;
  /** Same as the decoded state's: a cross-check, and what a card shows before decoding. */
  swapCount: number;
  trackNo: number;
  /** swapCount at the start of the current track (TrackDone.swaps of the next drop counts from here). */
  trackStartSwap: number;
  generatedAt: string;
  /** The last swaps before `block`, oldest first, for the player's tape (may be empty). */
  recent: CheckpointSwap[];
  /**
   * NFT stations only: the decoder's carry after `block` (nft.ts nftCarryToJSON: the last price and the median's window,
   * wei as decimal strings), so the sizes, ticks and composes after it are those of the full replay.
   */
  nft?: { lastPrice: string | null; recent: string[] };
}

const isHexStr = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v);
const isUint = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/** The checkpoint's state (v2 slots). */
export const checkpointState = (cp: StationCheckpoint): State => decode(cp.slot0, cp.slot1, V2_SLOTS);

/**
 * Why a fetched checkpoint must not be used for this station (null = use it): wrong version, another stream
 * (fingerprint), a block before genesis or past the RPC's head, or slots that disagree with their own summary.
 * The caller falls back to the full replay from genesis on any of these.
 */
export function checkpointProblem(cp: unknown, want: { key: string; fingerprint: string; genesisBlock: number; head?: number; nft?: boolean }): string | null {
  const c = cp as Partial<StationCheckpoint> | null;
  if (!c || typeof c !== "object") return "not an object";
  if (c.version !== CHECKPOINT_VERSION) return `version ${String(c.version)}, want ${CHECKPOINT_VERSION}`;
  if (c.key !== want.key) return `key ${String(c.key)}, want ${want.key}`;
  if (c.fingerprint !== want.fingerprint) return "computed for another source, calibration or genesis block";
  if (!isUint(c.block) || c.block! < want.genesisBlock - 1) return `block ${String(c.block)} before genesis ${want.genesisBlock}`;
  if (want.head !== undefined && c.block! > want.head) return `block ${c.block} is past the head ${want.head}`;
  if (!isHexStr(c.slot0) || !isHexStr(c.slot1)) return "slots are not hex";
  if (!isUint(c.swapCount) || !isUint(c.trackNo) || !isUint(c.trackStartSwap)) return "counters missing";
  const s = decode(c.slot0!, c.slot1!, V2_SLOTS);
  if (s.swapCount !== c.swapCount || (s.trackNo ?? 0) !== c.trackNo) return "slots disagree with swapCount/trackNo";
  if (c.trackStartSwap! > c.swapCount!) return "trackStartSwap past swapCount";
  if (!Array.isArray(c.recent)) return "recent is not an array";
  if (want.nft) {
    const p = c.nft?.lastPrice;
    const digits = (v: unknown) => typeof v === "string" && /^\d+$/.test(v);
    if (!c.nft || (p !== null && !digits(p)) || !Array.isArray(c.nft.recent) || !c.nft.recent.every(digits)) return "nft carry missing";
  }
  return null;
}
