// Station probe (docs/STATIONS.md "Registry"): plays a window of any pool's swaps through the shared swap decoder
// (core swaps.ts) and the v2 rules, without adding the pool to the registry. Resolves which side is the quote on chain
// (v2/v3: token0/token1; v4: native is currency0) and prints the registry fields to copy. Read-only: no keys.
//
//   npx tsx bot/scripts/station-probe.ts --chain 1 --kind v3 --pool 0x1195…7b58 --token 0x6982…1933 --blocks 2000
//   npx tsx bot/scripts/station-probe.ts --chain 1 --kind v4 --pool <poolId> --token 0x… [--eth-side 0] --from <block>
//   npx tsx bot/scripts/station-probe.ts --chain 143 --kind v3 --pool 0x116e…d8f1 --token 0x3500…7777 --calibrate
//
// --kind v4 | v3 | pancake-v3 | v2 | aerodrome-v2; --from defaults to head - blocks. --show N prints the first N
// decoded swaps (for explorer spot checks); --save <file> --save-max N writes the first N raw logs as a test fixture.
// --calibrate: reads totalSupply on chain and the quote's rate in ETH (DexScreener priceUsd / priceNative against
// Ethereum's WETH), plays the window with and without the calibration, checks the rules' FDV against DexScreener's,
// and prints the `calibration` block to paste into the registry. Without it a pool must pair ETH or WETH.
// --supply-offset N / --quote-per-eth X [--quote-decimals D] replay a given calibration instead (no price lookups).
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import {
  calibrationShift, decodeSwapLogs, fdvWeiAtTick, POOL_KINDS, swapLogFilter, whaleWeiAtTick,
  type Calibration, type PoolKind, type SwapSource,
} from "@swarm-sequencer/core";
import { buildTimeline, type RawSwap } from "../src/lib/timeline.ts";
import { getRawLogsChunked, makeClients, withRetry } from "../src/replay/rpc.ts";
import { loadRegistry } from "../src/station.ts";
import { CHAINS, fetchJson } from "../src/stations/sources.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const NATIVE = "0x0000000000000000000000000000000000000000";
const WETH_ETHEREUM = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

const reg = loadRegistry();
const chainId = Number(arg("chain"));
const kind = arg("kind") as PoolKind;
const pool = arg("pool")?.toLowerCase() as `0x${string}` | undefined;
const token = arg("token")?.toLowerCase() as `0x${string}` | undefined;
const calibrate = process.argv.includes("--calibrate");
const chain = reg.chains[String(chainId)];
if (!chain) die(`--chain: one of ${Object.keys(reg.chains).join(", ")}`);
if (!POOL_KINDS.includes(kind)) die(`--kind: one of ${POOL_KINDS.join(", ")}`);
if (!pool || !/^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(pool) || !token || !/^0x[0-9a-f]{40}$/.test(token)) {
  die("usage: station-probe.ts --chain <id> --kind <kind> --pool <pair|poolId> --token 0x.. (--from <block> | --blocks N) [--calibrate] [--show N] [--save file --save-max N]");
}

const clients = makeClients(chain.rpcUrls);
const client: PublicClient = createPublicClient({ transport: http(chain.rpcUrls[0]) }) as PublicClient;
const erc20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"]);
const pair = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)"]);
const nativeSymbol = chain.nativeSymbol ?? "ETH";
const given: Calibration | undefined = arg("supply-offset") || arg("quote-per-eth")
  ? {
      ...(arg("supply-offset") ? { supplyTickOffset: Number(arg("supply-offset")) } : {}),
      ...(arg("quote-per-eth") ? { quotePerEth: arg("quote-per-eth")! } : {}),
      ...(arg("quote-decimals") ? { quoteDecimals: Number(arg("quote-decimals")) } : {}),
    }
  : undefined;

// Which side is the quote: resolved here once, stored in the registry entry, never guessed at runtime.
let source: SwapSource;
let quote: `0x${string}`;
if (kind === "v4") {
  if (!chain.poolManager) die(`${chain.name}: no v4 PoolManager in the registry`);
  const ethSide = Number(arg("eth-side") ?? 0) as 0 | 1;
  quote = ethSide === 0 ? NATIVE : chain.weth;
  source = { kind, address: chain.poolManager!, poolId: pool, ethSide };
} else {
  const [t0, t1] = (await Promise.all([
    client.readContract({ address: pool, abi: pair, functionName: "token0" }),
    client.readContract({ address: pool, abi: pair, functionName: "token1" }),
  ])).map((a) => a.toLowerCase() as `0x${string}`);
  if (token !== t0 && token !== t1) die(`token ${token} is not in pool ${pool} (token0 ${t0}, token1 ${t1})`);
  quote = token === t0 ? t1 : t0;
  source = { kind, address: pool, ethSide: quote === t0 ? 0 : 1 };
}
const isEth = quote.toLowerCase() === chain.weth.toLowerCase() || (quote === NATIVE && nativeSymbol === "ETH");
if (!isEth && !calibrate && !given?.quotePerEth) die(`pool ${pool} pairs ${token} with ${quote}, not ETH or ${chain.name} WETH: add --calibrate (quote converted at its ETH rate)`);
const read = <T>(address: `0x${string}`, functionName: "symbol" | "decimals" | "totalSupply", fallback: T) =>
  withRetry(clients, (c) => c.readContract({ address, abi: erc20, functionName }), 3).catch(() => fallback) as Promise<T>;
const [symbol, decimals, supply] = await Promise.all([read(token, "symbol", "?"), read(token, "decimals", 18), read<bigint>(token, "totalSupply", 0n)]);
const [quoteSymbol, quoteDecimals] = quote === NATIVE ? [nativeSymbol, 18] : await Promise.all([read(quote, "symbol", "?"), read(quote, "decimals", 18)]);

// ---------------------------------------------------------------- calibration
const fmt = (x: number, sig = 6) => {
  // A plain decimal string (no exponent), `sig` significant digits: what the registry stores.
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(x)));
  const s = x.toFixed(Math.min(digits, 18));
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};
let calibration: Calibration | undefined = given;
let dex: { fdvUsd: number | null; ethUsd: number; quoteUsd: number } | null = null;
if (calibrate) {
  if (supply <= 0n) die(`${token}: totalSupply() unreadable`);
  const supplyTickOffset = Math.round(Math.log(1e27 / Number(supply)) / Math.log(1.0001));
  const slug = CHAINS[chainId]?.dex ?? die(`chain ${chainId}: no DexScreener slug in bot/src/stations/sources.ts`);
  // ETH in USD: the deepest Ethereum pair that prices WETH.
  const wethPairs = ((await fetchJson(`https://api.dexscreener.com/token-pairs/v1/ethereum/${WETH_ETHEREUM}`)) as any[])
    .filter((p) => p?.baseToken?.address?.toLowerCase() === WETH_ETHEREUM && Number(p.priceUsd) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const ethUsd = Number(wethPairs[0]?.priceUsd) || die("DexScreener: no WETH price");
  const j = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${slug}/${pool}`);
  const p = (j?.pairs ?? [])[0];
  if (!p) die(`DexScreener has no pair ${pool} on ${slug}`);
  // priceNative = base token price in the pair's quote token, priceUsd = base token price in USD.
  const base = String(p.baseToken.address).toLowerCase();
  const pQuote = String(p.quoteToken.address).toLowerCase();
  const wrappedQuote = quote === NATIVE ? null : quote.toLowerCase();
  let quoteUsd: number;
  if (isEth) quoteUsd = ethUsd;
  else if (wrappedQuote === pQuote || (quote === NATIVE && base === token)) quoteUsd = Number(p.priceUsd) / Number(p.priceNative);
  else if (wrappedQuote === base) quoteUsd = Number(p.priceUsd);
  else quoteUsd = die(`DexScreener pair ${pool}: cannot price ${quoteSymbol} (base ${p.baseToken.symbol}, quote ${p.quoteToken.symbol})`);
  dex = { fdvUsd: Number(p.fdv) || null, ethUsd, quoteUsd };
  calibration = { supplyTickOffset };
  if (!isEth) {
    calibration.quotePerEth = fmt(ethUsd / quoteUsd);
    if (quoteDecimals !== 18) calibration.quoteDecimals = Number(quoteDecimals);
  }
}

// ---------------------------------------------------------------- window
const head = await withRetry(clients, (c) => c.getBlockNumber());
const blocks = BigInt(arg("blocks") ?? 2000);
const from = arg("from") ? BigInt(arg("from")!) : head - blocks + 1n;
const to = arg("from") && arg("blocks") ? from + blocks - 1n : head;
const t0 = Date.now();
const logs = await getRawLogsChunked(clients, swapLogFilter(source), from, to, { chunk: BigInt(chain.logChunk), maxChunk: BigInt(chain.logChunk) });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const calibrated: SwapSource = calibration ? { ...source, calibration } : source;
// The same logs, decoded with and without the calibration; block times read once (as readStationSwaps does).
const times = new Map<bigint, number>();
async function withTimes(list: ReturnType<typeof decodeSwapLogs>): Promise<RawSwap[]> {
  const out: RawSwap[] = [];
  for (const sw of list) {
    let ts = sw.timestamp ?? times.get(sw.blockNumber);
    if (ts === undefined) {
      ts = Number((await withRetry(clients, (cl) => cl.getBlock({ blockNumber: sw.blockNumber }))).timestamp);
      times.set(sw.blockNumber, ts);
    }
    out.push({ isBuy: sw.isBuy, quoteAmt: sw.quoteAmt, tick: sw.tick, blockNumber: sw.blockNumber, timestamp: ts, txHash: sw.txHash, logIndex: sw.logIndex });
  }
  return out;
}
const swaps = await withTimes(decodeSwapLogs(calibrated, logs));
const rawSwaps = await withTimes(decodeSwapLogs(source, logs));

const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(4);
const unit = isEth ? "ETH" : quoteSymbol;
console.log(`${chain.name} ${kind} ${pool} · ${symbol} (${decimals} dec, supply ${(Number(supply) / 10 ** Number(decimals)).toExponential(4)}) vs ${quote === NATIVE ? `native ${nativeSymbol}` : `${quoteSymbol} ${quote}`} · ethSide ${source.ethSide}`);
console.log(`blocks ${from}..${to} (${to - from + 1n}) read in ${secs}s, chunk ${chain.logChunk}, rpc ${chain.rpcUrls[0]}`);

function report(label: string, list: RawSwap[], amtUnit: string) {
  const { entries, final } = buildTimeline(list, undefined, "v2");
  const buys = list.filter((s) => s.isBuy);
  const vol = list.reduce((a, s) => a + s.quoteAmt, 0n);
  const tracks = entries.filter((e) => e.trackComplete);
  console.log(`[${label}] swaps ${list.length} · buys ${buys.length} · sells ${list.length - buys.length} · volume ${eth(vol)} ${amtUnit} (buys ${eth(buys.reduce((a, s) => a + s.quoteAmt, 0n))})`);
  if (list.length) {
    const ticks = list.map((s) => s.tick);
    const last = ticks[ticks.length - 1];
    console.log(`[${label}] ticks ${Math.min(...ticks)}..${Math.max(...ticks)} · last ${last} · rules FDV there ${eth(fdvWeiAtTick(last))} · whale line ${eth(whaleWeiAtTick(last))} ${amtUnit}`);
  }
  console.log(`[${label}] whales ${entries.filter((e) => e.whale).length} · tracks completed ${tracks.length}${tracks.length ? ` (#${tracks.map((e) => e.trackComplete!.trackNo).join(", #")})` : ""} · final track #${(final.trackNo ?? 0) + 1}, ${final.swapCount} swaps, heat ${final.heat}`);
}
if (calibration) report("uncalibrated", rawSwaps, unit);
report(calibration ? "calibrated" : "rules", swaps, "ETH");
if (calibration) console.log(`calibration tick shift ${calibrationShift(calibration)} (supply ${calibration.supplyTickOffset ?? 0}, quote ${calibrationShift(calibration) - (calibration.supplyTickOffset ?? 0)})`);
if (dex && swaps.length) {
  // The check: the FDV the whale reads (core fdvWeiAtTick at the calibrated tick) against DexScreener's, in ETH.
  const rulesFdv = Number(fdvWeiAtTick(swaps[swaps.length - 1].tick)) / 1e18;
  const realFdv = dex.fdvUsd === null ? null : dex.fdvUsd / dex.ethUsd;
  console.log(`FDV check: rules ${rulesFdv.toPrecision(5)} ETH · DexScreener ${realFdv === null ? "n/a" : `${realFdv.toPrecision(5)} ETH ($${Math.round(dex.fdvUsd!).toLocaleString("en-US")} at ETH $${dex.ethUsd})`}${realFdv ? ` · ratio ${(rulesFdv / realFdv).toFixed(3)}` : ""}${isEth ? "" : ` · ${quoteSymbol} $${dex.quoteUsd.toPrecision(5)}`}`);
}
const show = Number(arg("show") ?? 3);
for (const s of swaps.slice(0, show)) {
  const r = rawSwaps.find((x) => x.txHash === s.txHash && x.logIndex === s.logIndex);
  console.log(`  ${s.txHash} #${s.logIndex} block ${s.blockNumber} ${s.isBuy ? "BUY " : "SELL"} ${eth(s.quoteAmt)} ETH${calibration && r ? ` (${eth(r.quoteAmt)} ${unit}, pool tick ${r.tick})` : ""} tick ${s.tick}`);
}
const entry = kind === "v4" ? { kind, poolManager: source.address, poolId: pool } : { kind, pool };
console.log("registry fields:", JSON.stringify({ chainId, ...entry, token, quote, ethSide: source.ethSide, quoteSymbol: "ETH", genesisBlock: Number(from), ...(calibration ? { calibration } : {}) }));

const save = arg("save");
if (save) {
  const sorted = [...logs]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))
    .slice(0, Number(arg("save-max") ?? 40));
  const raw = sorted.map((l) => ({ ...l, blockNumber: String(l.blockNumber), blockTimestamp: l.blockTimestamp ? String(l.blockTimestamp) : null }));
  writeFileSync(save, JSON.stringify({ chainId, source: calibrated, token, symbol, from: String(from), to: String(to), logs: raw }, null, 1) + "\n");
  console.log(`saved ${sorted.length} raw logs (${decodeSwapLogs(calibrated, sorted).length} swaps) to ${save}`);
}
