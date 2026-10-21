// Live feed: backfills every Mutated event since the deployment block, then polls new blocks.
import { createPublicClient, defineChain, fallback, http, parseAbi, type PublicClient } from "viem";
import { isPulse } from "@swarm-sequencer/core";
import type { Network } from "../config";
import { decodeSlots, RULES } from "../rules";
import { fromWei, whaleWeiFor, type Feed, type SwapEvent } from "./types";

const abi = parseAbi([
  "function raw() view returns (uint256 slot0, uint256 slot1)",
  "event Mutated(address indexed sender, uint32 indexed swapCount, uint8 track, uint8 step, bool on, uint8 bassNote, bool isBuy, uint128 quoteAmount, int24 tick, uint256 slot0, uint256 slot1)",
  // v2 hook only. TrackComplete: slot0/slot1 = the finished track before the reset; the rest is after the movement.
  "event TrackComplete(uint16 indexed trackNo, uint32 patternId, uint8 root, uint256 slot0, uint256 slot1, uint32 swapCount, uint64 seed)",
  // v2 hook only, emitted only when promoted or noop; absent = the write landed on Mutated.track/step.
  "event Accumulated(uint32 indexed swapCount, uint8 fromTrack, uint8 writeStep, bool promoted, bool noop)",
]);
const CHUNK = 40_000n;
// Robinhood Chain makes ~10 blocks/s: a short poll keeps the sound within a few seconds of the trade.
const POLL_MS = 2_500;

export function startLive(net: Network, feed: Feed): () => void {
  if (!net.hook) {
    feed.onStatus(`${net.label} · hook not deployed yet`, false);
    return () => {};
  }
  const chain = defineChain({
    id: net.chainId,
    name: net.label,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
  });
  const urls = [net.rpcUrl, ...(net.rpcFallbacks ?? [])];
  const transport = urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1, batch: true }))) : http(net.rpcUrl, { retryCount: 3, batch: true });
  const client = createPublicClient({ chain, transport }) as PublicClient;
  const hook = net.hook;
  const rules = RULES[net.rules];
  // v2: swaps since the previous TrackComplete (backfill starts at the deployment block, so this is exact).
  let trackStart = 0;
  const tsCache = new Map<bigint, number>();
  let closed = false;
  let cursor = BigInt(net.startBlock) - 1n;
  let timer = 0;

  async function exact(blocks: bigint[], into: Map<bigint, number>) {
    for (let i = 0; i < blocks.length; i += 16) {
      await Promise.all(blocks.slice(i, i + 16).map(async (b) => into.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))));
    }
  }

  // A few blocks (the live poll) are read exactly. A backfill would need one block per swap (~10 blocks/s on Robinhood,
  // and its logs carry no usable time), so it reads anchors every ANCHOR blocks and interpolates: seconds off at most,
  // and the terminal shows minutes.
  const ANCHOR = 2500n;
  async function timestamps(blocks: bigint[]) {
    const todo = [...new Set(blocks)].filter((b) => !tsCache.has(b));
    if (todo.length <= 16) return exact(todo, tsCache);
    const top = todo.reduce((a, b) => (b > a ? b : a));
    const anchors = new Map<bigint, number>();
    const want = new Set<bigint>();
    for (const b of todo) {
      const lo = (b / ANCHOR) * ANCHOR;
      want.add(lo);
      want.add(lo + ANCHOR > top ? top : lo + ANCHOR);
    }
    await exact([...want], anchors);
    for (const b of todo) {
      const lo = (b / ANCHOR) * ANCHOR;
      const hi = lo + ANCHOR > top ? top : lo + ANCHOR;
      const t0 = anchors.get(lo)!, t1 = anchors.get(hi)!;
      tsCache.set(b, hi === lo ? t0 : Math.round(t0 + ((t1 - t0) * Number(b - lo)) / Number(hi - lo)));
    }
  }

  async function pull(to: bigint, backfill: boolean) {
    for (let from = cursor + 1n; from <= to && !closed; from += CHUNK) {
      const end = from + CHUNK - 1n > to ? to : from + CHUNK - 1n;
      const range = { address: hook, abi, fromBlock: from, toBlock: end, strict: true } as const;
      const logs = await client.getContractEvents({ ...range, eventName: "Mutated" });
      const [completes, accs] = rules.heatMax
        ? await Promise.all([client.getContractEvents({ ...range, eventName: "TrackComplete" }), client.getContractEvents({ ...range, eventName: "Accumulated" })])
        : [[], []];
      const tcBy = new Map(completes.map((l) => [l.args.swapCount, l.args]));
      const accBy = new Map(accs.map((l) => [l.args.swapCount, l.args]));
      // Many RPCs put blockTimestamp on each log; fetch blocks only for logs without it. Robinhood's sends 0x0 for
      // recent blocks, so 0 counts as missing.
      for (const l of logs) if (l.blockTimestamp) tsCache.set(l.blockNumber!, Number(l.blockTimestamp));
      await timestamps(logs.map((l) => l.blockNumber!));
      for (const l of logs) {
        if (closed) return;
        const a = l.args;
        const ev: SwapEvent = {
          ts: tsCache.get(l.blockNumber!) ?? Math.floor(Date.now() / 1000),
          block: Number(l.blockNumber),
          tx: l.transactionHash,
          isBuy: a.isBuy,
          quote: fromWei(a.quoteAmount),
          quoteSymbol: net.quoteSymbol,
          track: a.track,
          step: accBy.get(a.swapCount)?.writeStep ?? a.step,
          on: a.on,
          bassNote: a.bassNote,
          whale: a.quoteAmount >= whaleWeiFor(net.quoteSymbol, a.tick),
          pulse: isPulse(a.sender, net.treasury),
          state: decodeSlots(a.slot0, a.slot1, rules),
        };
        const tc = tcBy.get(a.swapCount);
        if (tc) {
          ev.trackComplete = { trackNo: tc.trackNo, swaps: tc.swapCount - trackStart, held: decodeSlots(tc.slot0, tc.slot1, rules) };
          trackStart = tc.swapCount;
        }
        feed.onSwap(ev, backfill);
      }
      cursor = end;
    }
  }

  async function loop(first: boolean) {
    try {
      const head = await client.getBlockNumber();
      if (closed) return;
      feed.onBlock(Number(head));
      if (first) {
        const [s0, s1] = await client.readContract({ address: hook, abi, functionName: "raw" });
        feed.onState(decodeSlots(s0, s1, rules));
        feed.onStatus(`${net.label} · backfilling from #${net.startBlock}`, true);
      }
      await pull(head, first);
      feed.onStatus(`${net.label} · live`, true);
    } catch (err) {
      feed.onStatus(`${net.label} · rpc error, retrying`, false);
      console.warn(err);
    }
    if (!closed) timer = window.setTimeout(() => loop(false), POLL_MS);
  }

  feed.onClock(null);
  void loop(true);
  return () => {
    closed = true;
    clearTimeout(timer);
  };
}
