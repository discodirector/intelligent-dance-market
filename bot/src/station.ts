// Stations without the hook (docs/STATIONS.md): a pool's swaps run through the v2 rules off-chain from the same
// genesis block the site uses, so both count the same tracks. Logs -> rules input is core swaps.ts, shared with the
// site (data/virtual.ts), for every pool kind (v4, v3, v2 and forks). First: the IMD/ETH station (site ?net=imd-eth),
// the main IMD/ETH Uniswap v4 pool on Ethereum. The timeline is cached on disk (OUT_DIR/stations/<key>.json) and
// extended with new blocks on every tick. Every live registry station is kept the same way (updateStations) and its
// state published as a checkpoint (OUT_DIR/stations-data/<key>.checkpoint.json, core checkpoint.ts) that the site
// starts from instead of replaying the whole history (docs/STATIONS.md "Checkpoints").
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CHECKPOINT_VERSION, decodeSwapLogs, encode, stationFingerprint, swapLogFilter,
  type Calibration, type CheckpointSwap, type PoolKind, type StationCheckpoint, type SwapSource,
} from "@swarm-sequencer/core";
import { getRawLogsChunked, makeClients, withRetry } from "./replay/rpc.ts";
import { MAIN_POOL_ID, POOL_MANAGER } from "./replay/pools.ts";
import { buildTimeline, type RawSwap, type TimelineEntry } from "./lib/timeline.ts";
import { decodeFor, initialFor, slotOptions } from "./lib/hookRules.ts";

export interface BotStation {
  key: string;
  /** Shown on the release module. */
  label: string;
  /** Pool name for captions, e.g. "IMD/ETH". */
  pool: string;
  chainId: number;
  source: SwapSource;
  genesisBlock: bigint;
  /** Blocks per eth_getLogs request to start with. */
  logChunk: bigint;
  /** Never ask for more (registry chains.logChunk); undefined = grow while results are small (replay/rpc.ts). */
  maxChunk?: bigint;
  /** RPCs for this station's chain; undefined = the bot's Ethereum list (ETH_RPC_URL or replay/rpc.ts defaults). */
  rpcUrls?: string[];
}

/** Must match stations/registry.json "imd-eth" (site ?net=imd-eth), or the two count different tracks. */
export const IMD_STATION = {
  key: "imd-eth",
  label: "imd/eth station",
  pool: "IMD/ETH",
  chainId: 1,
  // Token (IMD) is currency1, native ETH currency0.
  source: { kind: "v4", address: POOL_MANAGER, poolId: MAIN_POOL_ID, ethSide: 0 },
  genesisBlock: 26_185_800n,
  logChunk: 5_000n,
} as const satisfies BotStation;

// ---------------------------------------------------------------- registry

export interface RegistryChain {
  name: string;
  explorer: string;
  rpcUrls: string[];
  logChunk: number;
  weth: `0x${string}`;
  poolManager?: `0x${string}`;
  nativeSymbol?: string;
}

export interface RegistryEntry {
  key: string;
  label: string;
  ticker: string;
  chainId: number;
  rpcUrls?: string[];
  kind: "hook" | PoolKind;
  poolManager?: `0x${string}`;
  poolId?: `0x${string}`;
  pool?: `0x${string}`;
  ethSide?: 0 | 1;
  quote?: `0x${string}`;
  calibration?: Calibration;
  genesisBlock: number;
  token: `0x${string}`;
  house?: boolean;
  /** What it plays: "idm" (house schedules) or a pack key (baked, or a runtime pack). */
  program: string;
  quoteSymbol?: string;
  theme?: { phos: string; phosDim: string; ghost: string; lcd: string };
  /**
   * "pending": added, not on air; "preview": its pack is in, playable at ?net=<key>, not listed; "live": on air (the
   * only status replayed for checkpoints); "paused": off.
   */
  status: "live" | "paused" | "pending" | "preview";
  /** Subscription end (YYYY-MM-DD or ISO timestamp, UTC): past it a live station is "expired" (subscription.ts). */
  paidUntil?: string;
  /** Station+ end (same format; docs/STATIONS.md "Station+"): set when a Station+ setup goes live; paid at runtime. */
  plusUntil?: string;
}

export interface Registry {
  chains: Record<string, RegistryChain>;
  stations: RegistryEntry[];
}

const REGISTRY_PATH = new URL("../../stations/registry.json", import.meta.url);

export const loadRegistry = (path: string | URL = REGISTRY_PATH): Registry => JSON.parse(readFileSync(path, "utf8"));

/** A played registry entry as a bot station (site/scripts/check-stations.mjs has checked its fields). */
export function stationFromEntry(e: RegistryEntry, reg: Registry): BotStation {
  if (e.kind === "hook") throw new Error(`${e.key}: the hook station is read on chain, not replayed`);
  const chain = reg.chains[String(e.chainId)];
  const pool: SwapSource = e.kind === "v4" ? { kind: "v4", address: e.poolManager!, poolId: e.poolId!, ethSide: e.ethSide ?? 0 } : { kind: e.kind, address: e.pool!, ethSide: e.ethSide! };
  const source: SwapSource = e.calibration ? { ...pool, calibration: e.calibration } : pool;
  return {
    key: e.key,
    label: `${e.label.toLowerCase()} station`,
    pool: e.label,
    chainId: e.chainId,
    source,
    genesisBlock: BigInt(e.genesisBlock),
    logChunk: BigInt(chain.logChunk),
    maxChunk: BigInt(chain.logChunk),
    rpcUrls: e.rpcUrls ?? chain.rpcUrls,
  };
}

// ---------------------------------------------------------------- timeline cache

export interface StationCache {
  cursor: number; // last block read
  slot0: string; // state after the last entry
  slot1: string;
  trackStart: number; // swapCount at the start of the current track
  entries: TimelineEntry[];
}

const hex = (v: bigint) => "0x" + v.toString(16);

export function emptyCache(st: BotStation): StationCache {
  const s = encode(initialFor("v2"), slotOptions("v2"));
  return { cursor: Number(st.genesisBlock) - 1, slot0: hex(s.slot0), slot1: hex(s.slot1), trackStart: 0, entries: [] };
}

function load(path: string, st: BotStation): StationCache {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : emptyCache(st);
}

/**
 * Pure step of updateStation: the swaps of (c.cursor, head] through the rules from the cached state. `keep` bounds
 * the cached entries (oldest dropped; undefined = all, which track releases need). Returns the finished tracks.
 */
export function extendCache(c: StationCache, swaps: RawSwap[], head: number, keep?: number): { trackNo: number; block: number }[] {
  const { entries, final } = buildTimeline(swaps, decodeFor(c.slot0, c.slot1, "v2"), "v2");
  const finished: { trackNo: number; block: number }[] = [];
  let i = c.entries.length ? c.entries[c.entries.length - 1].i + 1 : 0;
  for (const e of entries) {
    e.i = i++;
    // buildTimeline counts a track's swaps from the start of this read; the cache knows where it really began.
    if (e.trackComplete) {
      e.trackComplete.swaps = e.trackComplete.swapCount! - c.trackStart;
      c.trackStart = e.trackComplete.swapCount!;
      finished.push({ trackNo: e.trackComplete.trackNo, block: e.blockNumber });
    }
    c.entries.push(e);
  }
  if (keep !== undefined && c.entries.length > keep) c.entries.splice(0, c.entries.length - keep);
  const s = encode(final, slotOptions("v2"));
  Object.assign(c, { cursor: head, slot0: hex(s.slot0), slot1: hex(s.slot1) });
  return finished;
}

/** Swaps of the player's tape a checkpoint carries (the newest, oldest first). */
export const CHECKPOINT_RECENT = 64;

/** The site's starting point for this station: the cached state after `c.cursor` (core checkpoint.ts). */
export function checkpointOf(st: BotStation, c: StationCache, now = new Date()): StationCheckpoint {
  const s = decodeFor(c.slot0, c.slot1, "v2");
  const recent: CheckpointSwap[] = c.entries.slice(-CHECKPOINT_RECENT).map((e) => ({
    ts: e.ts, block: e.blockNumber, tx: e.txHash ?? null, isBuy: e.isBuy, quoteAmt: e.quoteAmt, tick: e.tick,
    track: e.track, step: e.writeStep ?? e.step, on: e.on, bassNote: e.bassNote, whale: e.whale, slot0: e.slot0, slot1: e.slot1,
    ...(e.trackComplete ? { trackComplete: { trackNo: e.trackComplete.trackNo, swaps: e.trackComplete.swaps ?? 0, slot0: e.trackComplete.slot0, slot1: e.trackComplete.slot1 } } : {}),
  }));
  return {
    version: CHECKPOINT_VERSION,
    key: st.key,
    fingerprint: stationFingerprint(st.chainId, st.source, st.genesisBlock),
    block: c.cursor,
    slot0: c.slot0,
    slot1: c.slot1,
    swapCount: s.swapCount,
    trackNo: s.trackNo ?? 0,
    trackStartSwap: c.trackStart,
    generatedAt: now.toISOString(),
    recent,
  };
}

/** Written whole then renamed, so the web server never hands out half a file. */
export function writeCheckpoint(dir: string, cp: StationCheckpoint): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${cp.key}.checkpoint.json`);
  writeFileSync(path + ".tmp", JSON.stringify(cp));
  renameSync(path + ".tmp", path);
  return path;
}

/** A station's swaps in [from, to] as rules inputs (timestamps filled from the blocks when the logs lack them). */
export async function readStationSwaps(st: BotStation, from: bigint, to: bigint, clients = makeClients(st.rpcUrls)): Promise<RawSwap[]> {
  const logs = await getRawLogsChunked(clients, swapLogFilter(st.source), from, to, { chunk: st.logChunk, maxChunk: st.maxChunk });
  const times = new Map<bigint, number>();
  const swaps: RawSwap[] = [];
  for (const sw of decodeSwapLogs(st.source, logs)) {
    let ts = sw.timestamp ?? times.get(sw.blockNumber);
    if (ts === undefined) {
      ts = Number((await withRetry(clients, (cl) => cl.getBlock({ blockNumber: sw.blockNumber }))).timestamp);
      times.set(sw.blockNumber, ts);
    }
    swaps.push({ isBuy: sw.isBuy, quoteAmt: sw.quoteAmt, tick: sw.tick, blockNumber: sw.blockNumber, timestamp: ts, txHash: sw.txHash, logIndex: sw.logIndex, poolId: st.source.poolId });
  }
  return swaps;
}

/**
 * Reads the station's new swaps, extends the cached timeline, returns it with the tracks finished in this read.
 * `checkpointDir`: also publish the state there for the site. `keep`: see extendCache.
 */
export async function updateStation(path: string, st: BotStation = IMD_STATION, opts: { checkpointDir?: string; keep?: number } = {}) {
  const c = load(path, st);
  const clients = makeClients(st.rpcUrls);
  const head = await withRetry(clients, (cl) => cl.getBlockNumber());
  const from = BigInt(c.cursor) + 1n;
  let finished: { trackNo: number; block: number }[] = [];
  if (from <= head) {
    finished = extendCache(c, await readStationSwaps(st, from, head, clients), Number(head), opts.keep);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(c));
  }
  if (opts.checkpointDir) writeCheckpoint(opts.checkpointDir, checkpointOf(st, c));
  return { entries: c.entries, finished };
}

/** Timeline entries a non-house station keeps in its cache (house stations keep all: their tracks are released). */
const KEEP_ENTRIES = 2_000;

/**
 * Every live played registry station (or only `keys`; none in `expired`): cache extended, checkpoint published to
 * `checkpointDir`.
 * One station failing (RPC down) does not stop the others; its error is returned in its place.
 */
export async function updateStations(outDir: string, checkpointDir: string, opts: { keys?: string[]; reg?: Registry; expired?: Set<string> } = {}) {
  const reg = opts.reg ?? loadRegistry();
  const out = new Map<string, Awaited<ReturnType<typeof updateStation>> | Error>();
  for (const e of reg.stations) {
    if (e.kind === "hook" || e.status !== "live" || (opts.keys && !opts.keys.includes(e.key))) continue;
    // A lapsed subscription (stations/subscription.ts) is off air: its cache and last checkpoint stay as they are.
    if (opts.expired?.has(e.key)) continue;
    // The IMD/ETH station keeps its own RPC list and chunk (the bot's Ethereum RPCs), as before the registry.
    const st = e.key === IMD_STATION.key ? IMD_STATION : stationFromEntry(e, reg);
    try {
      out.set(e.key, await updateStation(join(outDir, "stations", `${e.key}.json`), st, { checkpointDir, keep: e.house ? undefined : KEEP_ENTRIES }));
    } catch (err) {
      out.set(e.key, err as Error);
    }
  }
  return out;
}
