// From a token to its registry entry (docs/STATIONS.md "Onboarding"): the network half of bot/scripts/station-add.ts,
// shared with the pipeline worker (stations/pipeline.ts "registered"). Resolves the main pool and its kind, computes
// the calibration, picks a short genesis, a key and an LCD theme. Read-only (chain and DexScreener reads), no keys;
// every step reports through `log` and throws on a problem (the CLI turns it into its exit code).
import { decodeSwapLogs, fdvWeiAtTick, POOL_KINDS, swapLogFilter, whaleWeiAtTick, type PoolKind, type SwapSource } from "@swarm-sequencer/core";
import type { PublicClient } from "viem";
import { makeClients, withRetry } from "../replay/rpc.ts";
import type { Registry, RegistryChain } from "../station.ts";
import {
  buildEntry, calibrationFor, defaultPreset, ethPairs, fmtDecimal, labelOf, parseCandidate, parseTokenAmount, pickKey,
  supplyTickOffset, themeFor, tickerOf, v4Side, type Hex, type PairCandidate, type Status, type Theme,
} from "./onboard.ts";
import { blockAtTime, detectKind, dexQuote, ethUsd, lastLogs, NATIVE, pairSide, readToken, type TokenFacts } from "./pool.ts";
import { CHAINS, fetchJson, type ChainInfo } from "./sources.ts";

/** How far back kind detection and the FDV check look for a swap: 60 log chunks. */
const SCAN_CHUNKS = 60;

export interface StationContext {
  reg: Registry;
  chainId: number;
  chain: RegistryChain;
  info: ChainInfo;
  token: Hex;
  clients: PublicClient[];
  head: bigint;
  tok: TokenFacts;
  nativeSymbol: string;
  log: (line: string) => void;
}

/** The chain, the token's facts and the head block. `reg` is the registry keys, themes and pools are checked against. */
export async function stationContext(reg: Registry, chainId: number, token: Hex, log: (line: string) => void = console.log): Promise<StationContext> {
  const chain = reg.chains[String(chainId)];
  const info = CHAINS[chainId];
  if (!chain || !info) throw new Error(`chain ${chainId}: one of ${Object.keys(reg.chains).filter((id) => CHAINS[Number(id)]).join(", ")}`);
  const clients = makeClients(chain.rpcUrls);
  const head = await withRetry(clients, (c) => c.getBlockNumber());
  const tok = await readToken(clients, token);
  if (tok.totalSupply <= 0n) throw new Error(`${token}: totalSupply() unreadable on ${chain.name}`);
  log(`${tok.symbol} ${token} · ${chain.name} (${chainId}) · ${tok.decimals} dec · totalSupply ${(Number(tok.totalSupply) / 10 ** tok.decimals).toLocaleString("en-US")} · head ${head}`);
  return { reg, chainId, chain, info, token, clients, head, tok, nativeSymbol: chain.nativeSymbol ?? "ETH", log };
}

export interface Resolved { pool: Hex; kind: PoolKind; source: SwapSource; quote: Hex; how: string }

/** One candidate pool -> kind, source, quote; null (with a note) when the chain does not confirm a known kind. */
async function resolveOne(ctx: StationContext, pool: Hex, dexQuoteAddr: string | null, kindArg?: PoolKind): Promise<Resolved | null> {
  const { chain, clients, head, token, log } = ctx;
  const chunk = BigInt(chain.logChunk);
  if (pool.length === 66) {
    if (!chain.poolManager) throw new Error(`${chain.name}: no v4 PoolManager in the registry`);
    // v4 currencies are sorted (native first): the side follows from the quote DexScreener names for the pool.
    const quote = (dexQuoteAddr ?? NATIVE).toLowerCase() as Hex;
    const source: SwapSource = { kind: "v4", address: chain.poolManager, poolId: pool, ethSide: v4Side(token, quote) };
    const { logs } = await lastLogs(clients, swapLogFilter(source), head, chunk, SCAN_CHUNKS);
    if (!logs.length) {
      log(`  ${pool}: no v4 Swap for this poolId in the last ${SCAN_CHUNKS * chain.logChunk} blocks, skipped`);
      return null;
    }
    return { pool, kind: "v4", source, quote, how: "v4 poolId (PoolManager Swap logs), side from the sorted currencies" };
  }
  const side = await pairSide(clients, pool, token).catch((e) => {
    log(`  ${pool}: token0()/token1() ${String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]}, skipped`);
    return null;
  });
  if (!side) return null;
  const kind = kindArg ?? (await detectKind(clients, pool, head, chunk, SCAN_CHUNKS));
  if (!kind) {
    log(`  ${pool}: no Swap event of a known kind (${POOL_KINDS.join(", ")}) in the last ${SCAN_CHUNKS * chain.logChunk} blocks, skipped`);
    return null;
  }
  return { pool, kind, source: { kind, address: pool, ethSide: side.ethSide }, quote: side.quote, how: kindArg ? "--kind" : `its Swap event topic (${kind}), token0/token1 on chain` };
}

/**
 * The pool: `poolArg` (a pair or a v4 pool id), else the deepest ETH / WETH / wrapped-native pair on DexScreener
 * whose kind the chain confirms (the five deepest are tried). Throws when none can be played or the pool already has
 * a station in `ctx.reg`.
 */
export async function resolvePool(ctx: StationContext, poolArg?: Hex, kindArg?: PoolKind): Promise<Resolved> {
  const { chain, info, token, nativeSymbol, log } = ctx;
  let picked: Resolved | null = null;
  const pairs = ((await fetchJson(`https://api.dexscreener.com/token-pairs/v1/${info.dex}/${token}`)) as unknown[]).map(parseCandidate).flatMap((p) => (p ? [p] : []));
  const otherSide = (p: PairCandidate) => (p.base === token ? p.quote : p.base);
  if (poolArg) {
    const p = pairs.find((x) => x.pairAddress === poolArg);
    picked = await resolveOne(ctx, poolArg, p ? otherSide(p) : null, kindArg);
    if (!picked) throw new Error(`${poolArg}: not a pool this tool can play`);
  } else {
    const candidates = ethPairs(pairs, token, [chain.weth, ...(info.wrappedNative ? [info.wrappedNative] : [])]);
    if (!candidates.length) throw new Error(`${ctx.tok.symbol}: no ETH / WETH / ${nativeSymbol} pair on DexScreener (${info.dex}); pass the pool`);
    log(`DexScreener: ${candidates.length} ETH-side pair(s), deepest first:`);
    for (const c of candidates.slice(0, 5)) log(`  ${c.pairAddress} ${c.dexId}${c.labels.length ? ` ${c.labels.join("/")}` : ""} vs ${otherSide(c) === NATIVE ? nativeSymbol : c.base === token ? c.quoteSymbol : otherSide(c)} · liquidity $${Math.round(c.liquidityUsd).toLocaleString("en-US")}`);
    for (const c of candidates.slice(0, 5)) if ((picked = await resolveOne(ctx, c.pairAddress as Hex, otherSide(c), kindArg))) break;
    if (!picked) throw new Error("none of the five deepest pairs is a pool kind the decoder plays; pass the pool and its kind");
  }
  const dup = duplicateOf(ctx.reg, ctx.chainId, picked.pool);
  if (dup) throw new Error(`refused: ${dup} already plays pool ${picked.pool}`);
  log(`pool ${picked.pool} · kind ${picked.kind} (${picked.how}) · quote ${picked.quote === NATIVE ? `native ${nativeSymbol}` : picked.quote} · ethSide ${picked.source.ethSide}`);
  return picked;
}

/** The key of a station that already plays this pool on this chain (two stations never hear the same swaps). */
export function duplicateOf(reg: Registry, chainId: number, pool: string): string | undefined {
  return reg.stations.find((s) => s.chainId === chainId && [s.pool, s.poolId].some((p) => p?.toLowerCase() === pool.toLowerCase()))?.key;
}

export interface FinishOptions {
  /** Total tokens across chains (a bridged token); default totalSupply. */
  supply?: string;
  /** Days of history the replay starts with (default 7), or an exact genesis block. */
  days?: number;
  genesis?: number;
  key?: string;
  /** A preset or #rrggbb; default the first preset no station uses. */
  theme?: string;
  status?: Status;
  paidUntil?: string;
  program?: string;
}

/** Calibration (with the FDV check), genesis, key, theme: the registry entry for a resolved pool. */
export async function finishEntry(ctx: StationContext, picked: Resolved, o: FinishOptions = {}): Promise<Record<string, unknown>> {
  const { reg, chain, info, clients, head, token, tok, nativeSymbol, log } = ctx;
  const { pool, kind, source, quote } = picked;
  const isEth = quote === chain.weth.toLowerCase() || (quote === NATIVE && nativeSymbol === "ETH");
  const qTok = quote === NATIVE ? { symbol: nativeSymbol, decimals: 18 } : await readToken(clients, quote);

  const supplyRaw = o.supply ? parseTokenAmount(o.supply, tok.decimals) : tok.totalSupply;
  const ethPrice = await ethUsd();
  const dq = await dexQuote(info.dex, pool, token, quote, isEth, ethPrice);
  const quotePerEth = isEth ? null : fmtDecimal(ethPrice / dq.quoteUsd);
  const calibration = calibrationFor(supplyTickOffset(supplyRaw), quotePerEth, qTok.decimals);
  const supplyTokens = Number(supplyRaw) / 10 ** tok.decimals;
  log(`calibration: ${calibration ? JSON.stringify(calibration) : "none (1e9 x 1e18 token against ETH)"} · supply ${supplyTokens.toLocaleString("en-US")}${o.supply ? " (given)" : " (totalSupply)"}${isEth ? "" : ` · ${qTok.symbol} $${dq.quoteUsd.toPrecision(5)}, ETH $${ethPrice}`}`);
  // The check: the FDV the whale reads at the newest swap's calibrated tick against price x supply, in ETH.
  const recent = await lastLogs(clients, swapLogFilter(source), head, BigInt(chain.logChunk), SCAN_CHUNKS);
  const swaps = decodeSwapLogs(calibration ? { ...source, calibration } : source, recent.logs);
  if (swaps.length) {
    const tick = swaps[swaps.length - 1].tick;
    const rules = Number(fdvWeiAtTick(tick)) / 1e18;
    const real = (dq.tokenUsd * supplyTokens) / ethPrice;
    log(`FDV check (swap in block ${swaps[swaps.length - 1].blockNumber}): rules ${rules.toPrecision(5)} ETH · price x supply ${real.toPrecision(5)} ETH · ratio ${(rules / real).toFixed(3)} · whale line ${(Number(whaleWeiAtTick(tick)) / 1e18).toFixed(4)} ETH${dq.fdvUsd ? ` · DexScreener fdv ${(dq.fdvUsd / ethPrice).toPrecision(5)} ETH` : ""}`);
  } else log(`FDV check: no swap in the last ${SCAN_CHUNKS * chain.logChunk} blocks`);

  let genesisBlock: number;
  if (o.genesis !== undefined) {
    genesisBlock = o.genesis;
    if (!Number.isInteger(genesisBlock) || genesisBlock <= 0 || genesisBlock > Number(head)) throw new Error("genesis: a block number <= head");
  } else {
    const days = o.days ?? 7;
    if (!(days > 0)) throw new Error("days: > 0");
    genesisBlock = Number(await blockAtTime(clients, Math.floor(Date.now() / 1000) - Math.round(days * 86_400), head));
  }
  const span = Number(head) - genesisBlock;
  const requests = Math.ceil(span / chain.logChunk);
  log(`genesis ${genesisBlock}: ${span.toLocaleString("en-US")} blocks to head, ~${requests.toLocaleString("en-US")} eth_getLogs requests for a full replay (chunk ${chain.logChunk})${requests > 500 ? ": long for a browser without a checkpoint, consider 1 day" : ""}`);

  const keys = reg.stations.map((s) => s.key);
  let key = o.key;
  if (key !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error(`key: a lowercase slug, not "${key}"`);
    if (keys.includes(key)) throw new Error(`key ${key}: taken`);
  } else key = pickKey(tok.symbol, info.dex, keys);
  const themes = (reg.stations as unknown as { theme: Theme }[]).map((s) => s.theme);
  const preset = o.theme ?? defaultPreset(themes);
  const theme = themeFor(preset);
  log(`theme ${preset}${o.theme ? "" : " (default: first preset no station uses)"}`);
  return buildEntry({
    key, label: labelOf(tickerOf(tok.symbol), quote === NATIVE ? nativeSymbol : qTok.symbol), ticker: tickerOf(tok.symbol), chainId: ctx.chainId, kind,
    poolManager: kind === "v4" ? chain.poolManager : undefined,
    pool, genesisBlock, token, quote, ethSide: source.ethSide, calibration, theme,
    program: o.program ?? "idm", status: o.status, paidUntil: o.paidUntil,
  });
}
