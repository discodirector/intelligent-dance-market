// Pool facts read from the chain and DexScreener, shared by bot/scripts/station-probe.ts and station-add.ts
// (docs/STATIONS.md "Registry", "Calibration", "Onboarding"): the pool's tokens and kind, its recent swaps, the
// quote's rate in ETH, the block at a time. Read-only: no keys.
import { parseAbi, toEventSelector, type PublicClient } from "viem";
import { POOL_KINDS, SWAP_EVENTS, type PoolKind } from "@swarm-sequencer/core";
import { getRawLogsChunked, withRetry } from "../replay/rpc.ts";
import { fetchJson } from "./sources.ts";
import { KIND_BY_TOPIC, sideOf, type Hex } from "./onboard.ts";

export const NATIVE = "0x0000000000000000000000000000000000000000";
export const WETH_ETHEREUM = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

const ERC20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"]);
const PAIR = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)"]);

export interface TokenFacts { symbol: string; decimals: number; totalSupply: bigint }

/** symbol, decimals, totalSupply (fallbacks "?", 18, 0 when a call fails). */
export async function readToken(clients: PublicClient[], address: Hex): Promise<TokenFacts> {
  const read = <T>(functionName: "symbol" | "decimals" | "totalSupply", fallback: T) =>
    withRetry(clients, (c) => c.readContract({ address, abi: ERC20, functionName }), 3).catch(() => fallback) as Promise<T>;
  const [symbol, decimals, totalSupply] = await Promise.all([read("symbol", "?"), read("decimals", 18), read<bigint>("totalSupply", 0n)]);
  return { symbol, decimals: Number(decimals), totalSupply };
}

/** v2/v3 pool: the quote (the other token) and its side, read from token0()/token1(). */
export async function pairSide(clients: PublicClient[], pool: Hex, token: Hex): Promise<{ quote: Hex; ethSide: 0 | 1 }> {
  const [t0, t1] = await Promise.all([
    withRetry(clients, (c) => c.readContract({ address: pool, abi: PAIR, functionName: "token0" }), 3),
    withRetry(clients, (c) => c.readContract({ address: pool, abi: PAIR, functionName: "token1" }), 3),
  ]);
  return sideOf(token, t0, t1);
}

const ALL_SWAP_TOPICS = POOL_KINDS.map((k) => toEventSelector(SWAP_EVENTS[k]));

/**
 * The newest window (chunks of `chunk` blocks walking back from `head`, at most `maxChunks`) holding logs of the
 * filter, and its block range. Empty logs = nothing found that far back.
 */
export async function lastLogs(
  clients: PublicClient[], filter: { address: Hex; topics: (Hex | Hex[])[] }, head: bigint, chunk: bigint, maxChunks: number,
) {
  for (let i = 0; i < maxChunks; i++) {
    const to = head - BigInt(i) * chunk;
    const from = to - chunk + 1n;
    if (to <= 0n) break;
    const logs = await getRawLogsChunked(clients, filter, from < 0n ? 0n : from, to, { chunk, maxChunk: chunk });
    if (logs.length) return { logs, from, to };
  }
  return { logs: [], from: head, to: head };
}

/** A 20-byte pool's kind from its own Swap events (core SWAP_EVENTS topics), the newest swap within the scan. */
export async function detectKind(clients: PublicClient[], pool: Hex, head: bigint, chunk: bigint, maxChunks: number): Promise<PoolKind | null> {
  const { logs } = await lastLogs(clients, { address: pool, topics: [ALL_SWAP_TOPICS] }, head, chunk, maxChunks);
  const last = logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1)).at(-1);
  return last ? KIND_BY_TOPIC[last.topics[0].toLowerCase()] ?? null : null;
}

/**
 * About the first block whose timestamp is >= ts: secant steps from the recent block rate, then a few single blocks.
 * Never reads far below the answer (Monad's public RPCs prune old blocks, so a search from block 1 fails there).
 */
export async function blockAtTime(clients: PublicClient[], ts: number, head: bigint): Promise<bigint> {
  const time = async (n: bigint) => Number((await withRetry(clients, (c) => c.getBlock({ blockNumber: n }))).timestamp);
  const tHead = await time(head);
  if (tHead <= ts) return head;
  const back = head > 10_000n ? 10_000n : head - 1n;
  const rate = (tHead - (await time(head - back))) / Number(back) || 1; // seconds per block, recent
  const clamp = (n: bigint) => (n < 1n ? 1n : n > head ? head : n);
  let b = clamp(head - BigInt(Math.round((tHead - ts) / rate)));
  for (let i = 0; i < 8; i++) {
    const step = BigInt(Math.round((ts - (await time(b))) / rate));
    if (step === 0n) break;
    b = clamp(b + step);
  }
  for (let i = 0; i < 64 && b < head && (await time(b)) < ts; i++) b++;
  for (let i = 0; i < 64 && b > 1n && (await time(b - 1n)) >= ts; i++) b--;
  return b;
}

/** ETH in USD: the deepest Ethereum pair that prices WETH on DexScreener. */
export async function ethUsd(): Promise<number> {
  const pairs = ((await fetchJson(`https://api.dexscreener.com/token-pairs/v1/ethereum/${WETH_ETHEREUM}`)) as any[])
    .filter((p) => p?.baseToken?.address?.toLowerCase() === WETH_ETHEREUM && Number(p.priceUsd) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const v = Number(pairs[0]?.priceUsd);
  if (!(v > 0)) throw new Error("DexScreener: no WETH price");
  return v;
}

export interface DexQuote {
  /** The token's price in USD (from the pair). */
  tokenUsd: number;
  /** The pool's quote token in USD. */
  quoteUsd: number;
  /** DexScreener's FDV for the pair (its own supply figure), null when absent. */
  fdvUsd: number | null;
}

/**
 * Prices from the pool's DexScreener pair: priceNative = base in the pair's quote, priceUsd = base in USD. `quote` is
 * the pool's quote as resolved on chain (address 0 = native), `isEth` when it is ETH or WETH.
 */
export async function dexQuote(dexSlug: string, pool: string, token: string, quote: string, isEth: boolean, ethPrice: number): Promise<DexQuote> {
  const j = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${dexSlug}/${pool}`);
  const p = (j?.pairs ?? []).find((x: any) => String(x?.pairAddress).toLowerCase() === pool.toLowerCase()) ?? (j?.pairs ?? [])[0];
  if (!p) throw new Error(`DexScreener has no pair ${pool} on ${dexSlug}`);
  const base = String(p.baseToken.address).toLowerCase();
  const pQuote = String(p.quoteToken.address).toLowerCase();
  const t = token.toLowerCase();
  const wrapped = quote === NATIVE ? null : quote.toLowerCase();
  const usd = Number(p.priceUsd), native = Number(p.priceNative);
  let quoteUsd: number, tokenUsd: number;
  if (base === t) {
    tokenUsd = usd;
    quoteUsd = isEth ? ethPrice : usd / native;
    // A native quote may be listed as address 0 or as the wrapped token; a wrapped quote must match.
    if (!isEth && quote !== NATIVE && wrapped !== pQuote) throw new Error(`DexScreener pair ${pool}: quote ${p.quoteToken.symbol} is not the pool's ${quote}`);
  } else if (wrapped === base || (quote === NATIVE && base === NATIVE)) {
    // The pair lists the quote as its base: priceUsd prices the quote, priceNative = quote per token.
    quoteUsd = isEth ? ethPrice : usd;
    tokenUsd = usd / native;
  } else throw new Error(`DexScreener pair ${pool}: cannot price (base ${p.baseToken.symbol}, quote ${p.quoteToken.symbol})`);
  if (!(quoteUsd > 0) || !(tokenUsd > 0)) throw new Error(`DexScreener pair ${pool}: no usable price`);
  return { tokenUsd, quoteUsd, fdvUsd: Number(p.fdv) || null };
}
