// Virtual station: a pool without the hook (IMD/ETH on Ethereum, any registry station) played through the same v2
// rules in the browser. Every viewer replays the pool's Swap logs from one fixed genesis block with core.mutate, so
// all of them hear the same state; then it polls new blocks like the live feed. Nothing here is on-chain state: it is
// the hook's rules applied to someone else's pool, labelled as such in the UI. Logs -> rules input is core swaps.ts,
// shared with the bot, for every pool kind (v4, v3, v2 and their forks).
// Long histories: the bot publishes each station's state as a checkpoint (core checkpoint.ts); the replay starts
// there and reads only the blocks after it. Missing, unreadable or for another stream: the full replay from genesis.
// An NFT station (kind "nft", core nft.ts) reads its collection instead of a pool: per log chunk, the collection's
// Transfers and the ecosystem's events over the chunk, then Seaport only at the blocks where a Credit moved (JSON-RPC
// batched), and plays one input per item sold.
import { createPublicClient, defineChain, fallback, http, toHex, type PublicClient } from "viem";
import {
  checkpointProblem, checkpointState, decodeNftLogs, nftCarryFromJSON, decodeSwapLogs, mutate, rawLog, readNftLogs, readNftPageLogs, swapLogFilter,
  type CheckpointSwap, type CreditTable, type DecodedSwap, type NftCarry, type NftOrnament, type NftTag, type RawLog, type StationSource, type State,
} from "@swarm-sequencer/core";
import type { Network } from "../config";
import { decodeSlots, RULES } from "../rules";
import { loadRatings } from "./ratings";
import { fromWei, type Feed, type SwapEvent } from "./types";

const POLL_MS = 12_000;
/** The token an NFT station's pool ornaments name on the feed (core nft.ts balancePool: Credits' BALANCE). */
const ORNAMENT_TOKEN = "BALANCE";

export interface VirtualPool {
  /** Where the swaps come from: kind, PoolManager + poolId (v4) or the pool, and which side is ETH; or a collection. */
  source: StationSource;
  /** The station's state starts from the v2 initial state at this block, for every viewer. */
  genesisBlock: number;
  /** Blocks per eth_getLogs request (registry chains.logChunk). */
  logChunk: number;
  /** Pool token, for links. */
  token: `0x${string}`;
  tokenSymbol: string;
  /** The bot's checkpoint for this station (stations.ts CHECKPOINT_BASE); absent = always replay from genesis. */
  checkpoint?: { url: string; key: string; fingerprint: string };
}

const CHECKPOINT_TIMEOUT_MS = 8_000;
/** JSON-RPC batch size of an NFT station's reads; at most this many log ranges in flight (more trips Tenderly's 429). */
const NFT_BATCH = 5;

export function startVirtual(net: Network, feed: Feed): () => void {
  const pool = net.virtual!;
  const chain = defineChain({ id: net.chainId, name: net.label, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [net.rpcUrl] } } });
  const urls = [net.rpcUrl, ...(net.rpcFallbacks ?? [])];
  const src = pool.source;
  // An NFT station sends its per-block Seaport reads in JSON-RPC batches (Tenderly and publicnode take them).
  const batch = src.kind === "nft" ? { batch: { batchSize: NFT_BATCH } } : {};
  const transport = urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1, ...batch }))) : http(net.rpcUrl, { retryCount: 3, ...batch });
  const client = createPublicClient({ chain, transport }) as PublicClient;
  const rules = RULES.v2;
  const filter = src.kind === "nft" ? null : swapLogFilter(src);
  const chunk = BigInt(pool.logChunk);
  /** NFT stations: the decoder's carry after the cursor (the last item price, for a compose). */
  let carry: NftCarry = { lastPrice: null };
  /** NFT stations with a rating table (nft.ratings): loaded before the first read; null = untagged sales. */
  let ratings: CreditTable | null = null;
  let state: State = rules.initial();
  let trackStart = state.swapCount;
  let cursor = BigInt(pool.genesisBlock) - 1n;
  let closed = false;
  let timer = 0;

  async function blockTime(b: bigint, cache: Map<bigint, number>) {
    if (!cache.has(b)) cache.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp));
    return cache.get(b)!;
  }

  /** Starts from the bot's checkpoint when it fits this station and the chain; returns its recent swaps, or null. */
  async function fromCheckpoint(head: bigint): Promise<CheckpointSwap[] | null> {
    const cp = pool.checkpoint;
    if (!cp) return null;
    try {
      const res = await fetch(cp.url, { cache: "no-cache", signal: AbortSignal.timeout(CHECKPOINT_TIMEOUT_MS) });
      if (!res.ok) return null;
      const j = await res.json();
      const why = checkpointProblem(j, { key: cp.key, fingerprint: cp.fingerprint, genesisBlock: pool.genesisBlock, head: Number(head), nft: src.kind === "nft" });
      if (why) {
        console.warn(`${net.key}: checkpoint not used (${why}); replaying from genesis`);
        return null;
      }
      state = checkpointState(j);
      trackStart = j.trackStartSwap;
      cursor = BigInt(j.block);
      if (src.kind === "nft") carry = nftCarryFromJSON(j.nft);
      return j.recent;
    } catch (err) {
      console.warn(`${net.key}: no checkpoint (${(err as Error).message}); replaying from genesis`);
      return null;
    }
  }

  /** The checkpoint's last swaps, for the tape: history (backfill), states from before the checkpoint's. */
  function replayRecent(recent: CheckpointSwap[]) {
    for (const r of recent) {
      const ev: SwapEvent = {
        ts: r.ts,
        block: r.block,
        tx: r.tx,
        isBuy: r.isBuy,
        // An NFT input's quoteAmt is its size for the rules; the feed shows the price.
        quote: fromWei(BigInt(r.nft?.price ?? r.quoteAmt)),
        quoteSymbol: "ETH",
        track: r.track,
        step: r.step,
        on: r.on,
        bassNote: r.bassNote,
        whale: r.whale,
        state: decodeSlots(r.slot0, r.slot1, rules),
        ...(r.nft ? { nft: r.nft } : {}),
      };
      if (r.trackComplete) ev.trackComplete = { trackNo: r.trackComplete.trackNo, swaps: r.trackComplete.swaps, held: decodeSlots(r.trackComplete.slot0, r.trackComplete.slot1, rules) };
      feed.onSwap(ev, true);
    }
  }

  /**
   * eth_getLogs over [a, b]: halved when the RPC refuses the size (a busy collection can pass Tenderly's 20k results in
   * one chunk), retried after a pause on anything else (a rate limit: splitting would only send more).
   */
  async function getLogs(f: { address: `0x${string}` | `0x${string}`[]; topics: (`0x${string}` | `0x${string}`[] | null)[] }, a: bigint, b: bigint, tries = 3): Promise<RawLog[]> {
    try {
      const logs = await client.request({ method: "eth_getLogs", params: [{ ...f, fromBlock: toHex(a), toBlock: toHex(b) }] } as never);
      return (logs as Parameters<typeof rawLog>[0][]).map(rawLog);
    } catch (err) {
      if (closed) throw err;
      const msg = String((err as Error)?.message ?? err).toLowerCase();
      if (/more than \d+ results|block range|too large|response size|size limit/.test(msg) && b - a >= 16n) {
        const m = (a + b) / 2n;
        return [...(await getLogs(f, a, m)), ...(await getLogs(f, m + 1n, b))];
      }
      if (tries <= 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (4 - tries)));
      return getLogs(f, a, b, tries - 1);
    }
  }

  /**
   * One chunk of the source as rules inputs: a pool's swaps, or a collection's sales and the carry after them (with the
   * pages' history for a sold or overprinted Statement), and its token pool's swaps as ornaments (Credits: BALANCE).
   */
  async function readChunk(from: bigint, end: bigint): Promise<{ swaps: (DecodedSwap & { nft?: NftTag; holdTempo?: true; holdSizeEma?: true })[]; carry?: NftCarry; ornaments?: NftOrnament[] }> {
    if (src.kind !== "nft") {
      const logs = await client.request({ method: "eth_getLogs", params: [{ ...filter!, fromBlock: toHex(from), toBlock: toHex(end) }] });
      return { swaps: decodeSwapLogs(src, logs.map(rawLog)) };
    }
    const logs = await readNftLogs(src, from, end, getLogs, { concurrency: NFT_BATCH });
    const pages = await readNftPageLogs(src, logs, end, getLogs);
    const r = decodeNftLogs(src, logs, carry, { ratings, pages });
    return { swaps: r.sales, carry: r.carry, ornaments: r.ornaments };
  }

  async function pull(to: bigint, backfill: boolean) {
    const times = new Map<bigint, number>();
    for (let from = cursor + 1n; from <= to && !closed; from += chunk) {
      const end = from + chunk - 1n > to ? to : from + chunk - 1n;
      const read = await readChunk(from, end);
      // Ornaments go out in order with the swaps (block, log index), none of them touching the state.
      const orn = read.ornaments ?? [];
      let oi = 0;
      let lastTs = 0;
      const before = (o: NftOrnament, b: bigint, i: number) => o.blockNumber < b || (o.blockNumber === b && o.logIndex < i);
      const flush = async (b: bigint | null, i: number) => {
        while (oi < orn.length && (b === null || before(orn[oi], b, i))) {
          const o = orn[oi++];
          if (closed) return;
          // No block read for an old ornament (thousands on a launch day): the last known time is close enough.
          const ts = o.timestamp ?? times.get(o.blockNumber) ?? (backfill && lastTs ? lastTs : await blockTime(o.blockNumber, times));
          lastTs = ts;
          feed.onOrnament?.({ ts, block: Number(o.blockNumber), tx: o.txHash, isBuy: o.isBuy, amount: fromWei(BigInt(o.amount)), eth: fromWei(BigInt(o.eth)), ...(o.ink ? { ink: o.ink, plate: o.plate } : {}), token: ORNAMENT_TOKEN }, backfill);
        }
      };
      for (const sw of read.swaps) {
        if (closed) return;
        await flush(sw.blockNumber, sw.logIndex);
        const ts = sw.timestamp ?? (await blockTime(sw.blockNumber, times));
        lastTs = ts;
        const r = mutate(state, { isBuy: sw.isBuy, quoteAmt: sw.quoteAmt, tick: sw.tick, blockNumber: sw.blockNumber, timestamp: ts, ...(sw.holdTempo ? { holdTempo: true } : {}), ...(sw.holdSizeEma ? { holdSizeEma: true } : {}) }, undefined, rules.mutate);
        state = r.state;
        const ev: SwapEvent = {
          ts,
          block: Number(sw.blockNumber),
          tx: sw.txHash,
          isBuy: r.event.isBuy,
          quote: fromWei(sw.nft ? BigInt(sw.nft.price) : sw.quoteAmt),
          quoteSymbol: "ETH",
          track: r.event.track,
          step: r.event.writeStep ?? r.event.step,
          on: r.event.on,
          bassNote: r.event.bassNote,
          whale: r.event.whale,
          state,
          ...(sw.nft ? { nft: sw.nft } : {}),
        };
        const tc = r.event.trackComplete;
        if (tc) {
          ev.trackComplete = { trackNo: tc.trackNo, swaps: tc.swapCount - trackStart, held: decodeSlots(tc.slot0, tc.slot1, rules) };
          trackStart = tc.swapCount;
        }
        feed.onSwap(ev, backfill);
      }
      await flush(null, 0);
      cursor = end;
      if (read.carry) carry = read.carry;
    }
  }

  let checkpointTried = false;
  let synced = false;

  async function loop(first: boolean) {
    try {
      const head = await client.getBlockNumber();
      if (closed) return;
      feed.onBlock(Number(head));
      if (first) {
        if (src.kind === "nft" && src.ratings && !ratings) ratings = await loadRatings(src.ratings);
        // Once: a retry after an RPC error goes on from the cursor, wherever the first attempt started.
        const recent = checkpointTried ? null : await fromCheckpoint(head);
        checkpointTried = true;
        if (closed) return;
        if (recent) replayRecent(recent);
        feed.onState(state);
        feed.onStatus(recent ? `${net.label} · from checkpoint #${cursor}` : `${net.label} · replaying the ${src.kind === "nft" ? "collection" : "pool"} from #${cursor + 1n}`, true);
      }
      await pull(head, first);
      if (first) feed.onState(state);
      synced = true;
      feed.onStatus(`${net.label} · live`, true);
    } catch (err) {
      feed.onStatus(`${net.label} · rpc error, retrying`, false);
      console.warn(err);
    }
    // Until the history is in, a retry is still a backfill (no drop cues for old swaps).
    if (!closed) timer = window.setTimeout(() => loop(!synced), POLL_MS);
  }

  feed.onClock(null);
  void loop(true);
  return () => {
    closed = true;
    clearTimeout(timer);
  };
}
