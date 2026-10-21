// Virtual station: a pool without the hook (IMD/ETH on Ethereum, any registry station) played through the same v2
// rules in the browser. Every viewer replays the pool's Swap logs from one fixed genesis block with core.mutate, so
// all of them hear the same state; then it polls new blocks like the live feed. Nothing here is on-chain state: it is
// the hook's rules applied to someone else's pool, labelled as such in the UI. Logs -> rules input is core swaps.ts,
// shared with the bot, for every pool kind (v4, v3, v2 and their forks).
// Long histories: the bot publishes each station's state as a checkpoint (core checkpoint.ts); the replay starts
// there and reads only the blocks after it. Missing, unreadable or for another stream: the full replay from genesis.
import { createPublicClient, defineChain, fallback, http, toHex, type PublicClient } from "viem";
import { checkpointProblem, checkpointState, decodeSwapLogs, mutate, rawLog, swapLogFilter, type CheckpointSwap, type SwapSource, type State } from "@swarm-sequencer/core";
import type { Network } from "../config";
import { decodeSlots, RULES } from "../rules";
import { fromWei, type Feed, type SwapEvent } from "./types";

const POLL_MS = 12_000;

export interface VirtualPool {
  /** Where the swaps come from: kind, PoolManager + poolId (v4) or the pool, and which side is ETH. */
  source: SwapSource;
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

export function startVirtual(net: Network, feed: Feed): () => void {
  const pool = net.virtual!;
  const chain = defineChain({ id: net.chainId, name: net.label, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [net.rpcUrl] } } });
  const urls = [net.rpcUrl, ...(net.rpcFallbacks ?? [])];
  const transport = urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1 }))) : http(net.rpcUrl, { retryCount: 3 });
  const client = createPublicClient({ chain, transport }) as PublicClient;
  const rules = RULES.v2;
  const filter = swapLogFilter(pool.source);
  const chunk = BigInt(pool.logChunk);
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
      const why = checkpointProblem(j, { key: cp.key, fingerprint: cp.fingerprint, genesisBlock: pool.genesisBlock, head: Number(head) });
      if (why) {
        console.warn(`${net.key}: checkpoint not used (${why}); replaying from genesis`);
        return null;
      }
      state = checkpointState(j);
      trackStart = j.trackStartSwap;
      cursor = BigInt(j.block);
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
        quote: fromWei(BigInt(r.quoteAmt)),
        quoteSymbol: "ETH",
        track: r.track,
        step: r.step,
        on: r.on,
        bassNote: r.bassNote,
        whale: r.whale,
        state: decodeSlots(r.slot0, r.slot1, rules),
      };
      if (r.trackComplete) ev.trackComplete = { trackNo: r.trackComplete.trackNo, swaps: r.trackComplete.swaps, held: decodeSlots(r.trackComplete.slot0, r.trackComplete.slot1, rules) };
      feed.onSwap(ev, true);
    }
  }

  async function pull(to: bigint, backfill: boolean) {
    const times = new Map<bigint, number>();
    for (let from = cursor + 1n; from <= to && !closed; from += chunk) {
      const end = from + chunk - 1n > to ? to : from + chunk - 1n;
      const logs = await client.request({ method: "eth_getLogs", params: [{ ...filter, fromBlock: toHex(from), toBlock: toHex(end) }] });
      for (const sw of decodeSwapLogs(pool.source, logs.map(rawLog))) {
        if (closed) return;
        const ts = sw.timestamp ?? (await blockTime(sw.blockNumber, times));
        const r = mutate(state, { isBuy: sw.isBuy, quoteAmt: sw.quoteAmt, tick: sw.tick, blockNumber: sw.blockNumber, timestamp: ts }, undefined, rules.mutate);
        state = r.state;
        const ev: SwapEvent = {
          ts,
          block: Number(sw.blockNumber),
          tx: sw.txHash,
          isBuy: r.event.isBuy,
          quote: fromWei(sw.quoteAmt),
          quoteSymbol: "ETH",
          track: r.event.track,
          step: r.event.writeStep ?? r.event.step,
          on: r.event.on,
          bassNote: r.event.bassNote,
          whale: r.event.whale,
          state,
        };
        const tc = r.event.trackComplete;
        if (tc) {
          ev.trackComplete = { trackNo: tc.trackNo, swaps: tc.swapCount - trackStart, held: decodeSlots(tc.slot0, tc.slot1, rules) };
          trackStart = tc.swapCount;
        }
        feed.onSwap(ev, backfill);
      }
      cursor = end;
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
        // Once: a retry after an RPC error goes on from the cursor, wherever the first attempt started.
        const recent = checkpointTried ? null : await fromCheckpoint(head);
        checkpointTried = true;
        if (closed) return;
        if (recent) replayRecent(recent);
        feed.onState(state);
        feed.onStatus(recent ? `${net.label} · from checkpoint #${cursor}` : `${net.label} · replaying the pool from #${cursor + 1n}`, true);
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
