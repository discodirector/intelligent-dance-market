// Swap sources (docs/STATIONS.md "Registry"): one pool's Swap logs -> the rules input {isBuy, quoteAmt, tick}, for
// every pool kind a station can play. Pure: callers read logs with swapLogFilter() over their own RPC and hand them
// to decodeSwapLogs(). Site (data/virtual.ts, stations-page.ts) and bot (station.ts) share it, so both hear the same
// swaps. Which side of the pool is ETH (native or WETH) comes from the registry entry, never from a guess here.
//
// Tick orientation: every kind yields the tick of the IMD/ETH v4 station, ETH = currency0 and the token = currency1,
// so 1.0001^tick = token per ETH in raw units (wei of token per wei of ETH). That is what whaleWeiAtTick reads
// (FDV-scaled whale) and what stepHash hashes. A pool with ETH on the other side is inverted from its sqrtPrice;
// a v2 pool has no tick and gets floor(log_1.0001(reserveToken / reserveEth)) from the Sync of the same swap.
//
// Calibration (optional, per registry entry, frozen once the station is on air): the rules were written for $IDM,
// 1e9 tokens of 18 decimals against ETH. A token of another supply, or a pool quoted in another token (WMON, USDC),
// is mapped onto that frame here, before the rules: amounts become ETH wei at a fixed rate and the tick is shifted so
// that the FDV the whale reads is the token's real FDV in ETH. Integers and exact rationals only, so every replay
// (site, bot, any machine) gets the same inputs. No calibration = the swaps exactly as the pool reports them.
import { decodeEventLog, parseAbiItem, toEventSelector, type AbiEvent, type Hex } from "viem";
import { getSqrtPriceAtTick, MAX_TICK, MIN_TICK } from "./index.ts";
import type { NftSource } from "./nft.ts";

/**
 * Pool kinds, by Swap event:
 *   v4            Uniswap v4 PoolManager, logs filtered by poolId; amounts from the swapper's side.
 *   v3            Uniswap v3 and forks with its exact Swap event (Aerodrome Slipstream, Sushi v3); amounts from the pool's side.
 *   pancake-v3    PancakeSwap v3: the v3 event plus two protocol-fee fields (another topic0).
 *   v2            Uniswap v2 and forks with its Swap/Sync events (Sushi v2, PancakeSwap v2); tick from the Sync reserves.
 *   aerodrome-v2  Aerodrome classic (volatile) pools on Base: their own Swap and Sync (uint256 reserves).
 */
export type PoolKind = "v4" | "v3" | "pancake-v3" | "v2" | "aerodrome-v2";
export const POOL_KINDS: readonly PoolKind[] = ["v4", "v3", "pancake-v3", "v2", "aerodrome-v2"];

export interface SwapSource {
  kind: PoolKind;
  /** v4: the PoolManager. Others: the pool (pair) itself. */
  address: Hex;
  /** v4 only: the pool's id (topic1 of its Swap logs). */
  poolId?: Hex;
  /**
   * Which side is ETH (native or WETH), or the calibrated quote (calibration.quotePerEth): v4 currency0/currency1,
   * v2/v3 token0/token1. Stored in the registry.
   */
  ethSide: 0 | 1;
  /** Absent = identity (ETH or WETH quote, supply read as is). See Calibration. */
  calibration?: Calibration;
}

/**
 * How a station's pool is mapped onto the rules' frame ($IDM: 1e9 tokens x 1e18, quoted in ETH), fixed at
 * registration (bot/scripts/station-probe.ts --calibrate prints it) and never changed while the station is on air.
 *
 *   supplyTickOffset  added to every tick: round(log_1.0001(1e27 / totalSupplyRaw)). The whale reads
 *                     FDV = 1e27 / 1.0001^tick (core fdvWeiAtTick), so the shifted tick gives the token's real
 *                     FDV = totalSupplyRaw / price. PEPE (4.2e32 raw): about -129,000; any 1e9 x 1e18 token: 0.
 *   quotePerEth       the pool's quote token per 1 ETH at registration, a decimal string ("1" or absent: the quote is
 *                     ETH/WETH). quoteAmt -> floor(quoteAmt x 1e18 / (quotePerEth x 10^quoteDecimals)) ETH wei, and
 *                     the tick (token per quote) gains floor(log_1.0001(quotePerEth x 10^quoteDecimals / 1e18)), so it
 *                     reads token per ETH like every other station.
 *   quoteDecimals     the quote token's decimals (default 18; USDC 6).
 */
export interface Calibration {
  supplyTickOffset?: number;
  quotePerEth?: string;
  quoteDecimals?: number;
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** quotePerEth as an exact fraction num/den (den a power of ten). Throws on anything but a positive decimal. */
export function parseDecimal(v: string): { num: bigint; den: bigint } {
  const m = DECIMAL.exec(v);
  if (!m) throw new Error(`not a decimal number: ${JSON.stringify(v)}`);
  const frac = m[2] ?? "";
  const num = BigInt(m[1] + frac);
  if (num <= 0n) throw new Error(`must be > 0: ${v}`);
  return { num, den: 10n ** BigInt(frac.length) };
}

/** A calibration's checks (registry validator and decoder share them); returns the problems, empty = fine. */
export function calibrationProblems(c: unknown): string[] {
  if (c === undefined) return [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["calibration must be an object"];
  const out: string[] = [];
  const { supplyTickOffset: o, quotePerEth: q, quoteDecimals: d, ...rest } = c as Record<string, unknown>;
  for (const k of Object.keys(rest)) out.push(`calibration.${k}: unknown field`);
  if (o !== undefined && (!Number.isInteger(o) || Math.abs(o as number) > MAX_TICK)) out.push(`calibration.supplyTickOffset must be an integer within ±${MAX_TICK}`);
  if (q !== undefined && (typeof q !== "string" || !DECIMAL.test(q) || !/[1-9]/.test(q))) out.push("calibration.quotePerEth must be a positive decimal string, e.g. \"41250.5\"");
  if (d !== undefined && (!Number.isInteger(d) || (d as number) < 0 || (d as number) > 36)) out.push("calibration.quoteDecimals must be an integer 0..36");
  if (d !== undefined && q === undefined) out.push("calibration.quoteDecimals needs quotePerEth");
  return out;
}

interface Calibrator {
  amt(quoteAmt: bigint): bigint;
  /** Total tick shift (supply + quote). */
  shift: number;
}

/** The exact maps of a calibration, or null for none (the identity, decoded exactly as before calibrations). */
export function calibrator(c: Calibration | undefined): Calibrator | null {
  if (!c) return null;
  const problems = calibrationProblems(c);
  if (problems.length) throw new Error(problems.join("; "));
  let shift = c.supplyTickOffset ?? 0;
  let amt = (q: bigint) => q;
  if (c.quotePerEth !== undefined) {
    const { num, den } = parseDecimal(c.quotePerEth);
    // quote raw per ETH wei = (num / den) x 10^decimals / 1e18.
    const qNum = num * 10n ** BigInt(c.quoteDecimals ?? 18);
    const qDen = den * 10n ** 18n;
    amt = (q: bigint) => (q * qDen) / qNum;
    shift += tickAtRatio(qNum, qDen);
  }
  return { amt, shift };
}

/** Total tick shift of a calibration (0 without one): what station-probe prints and the tests check. */
export const calibrationShift = (c: Calibration | undefined): number => calibrator(c)?.shift ?? 0;

/** What a station plays: a pool's swaps (this file) or a collection's sales (nft.ts). */
export type StationSource = SwapSource | NftSource;

/**
 * Identity of a station's swap stream: chain, source (kind, address, poolId, side, calibration) and genesis block.
 * A checkpoint (checkpoint.ts) is only applied to the stream it was computed from. An NFT source: the collection, its
 * supply frame, the compose fallback price and every venue (a venue added later is another stream).
 */
export function stationFingerprint(chainId: number, src: StationSource, genesisBlock: number | bigint): string {
  if (src.kind === "nft") {
    const a = (v: Hex | undefined) => v?.toLowerCase() ?? null;
    return JSON.stringify([
      chainId, "nft", src.collection.toLowerCase(), src.itemSupply, src.refPrice,
      (src.seaport ?? []).map((x) => x.toLowerCase()).sort(), a(src.strategy), a(src.core), a(src.statements), src.weth.toLowerCase(),
      Number(genesisBlock),
      // BALANCE withdraws are inputs (nft.ts): a source with them is another stream. Absent: the fingerprint as before.
      ...(src.balance ? [a(src.balance)] : []),
    ]);
  }
  const c = src.calibration;
  return JSON.stringify([
    chainId,
    src.kind,
    src.address.toLowerCase(),
    src.poolId?.toLowerCase() ?? null,
    src.ethSide,
    c ? [c.supplyTickOffset ?? 0, c.quotePerEth ?? "1", c.quoteDecimals ?? 18] : null,
    Number(genesisBlock),
  ]);
}

/** A log as eth_getLogs returns it, numbers parsed (rawLog() converts the RPC's hex). */
export interface RawLog {
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  /** Some RPCs add the block's timestamp to each log; absent (or 0 on Robinhood) = read the block. */
  blockTimestamp?: bigint | null;
  /** The emitting contract (lowercase or checksummed); NFT sources read logs of several contracts at once (nft.ts). */
  address?: Hex;
}

/** One swap as the rules read it, plus where it came from. */
export interface DecodedSwap {
  isBuy: boolean;
  /** |ETH delta| in wei (native ETH or WETH; a calibrated quote converted at its frozen rate). */
  quoteAmt: bigint;
  /** Post-swap tick in the station orientation (ETH = currency0, see the header), calibrated when the source is. */
  tick: number;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  /** From the log when the RPC sent one (> 0), else undefined: the caller reads the block. */
  timestamp?: number;
}

export const SWAP_EVENTS = {
  v4: parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"),
  v3: parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"),
  "pancake-v3": parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint128 protocolFeesToken0, uint128 protocolFeesToken1)"),
  v2: parseAbiItem("event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)"),
  "aerodrome-v2": parseAbiItem("event Swap(address indexed sender, address indexed to, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out)"),
} as const satisfies Record<PoolKind, AbiEvent>;

/** v2-style pools: reserves after every swap (emitted just before its Swap, same tx). */
export const SYNC_EVENTS = {
  v2: parseAbiItem("event Sync(uint112 reserve0, uint112 reserve1)"),
  "aerodrome-v2": parseAbiItem("event Sync(uint256 reserve0, uint256 reserve1)"),
} as const;

const SWAP_TOPIC = Object.fromEntries(POOL_KINDS.map((k) => [k, toEventSelector(SWAP_EVENTS[k])])) as Record<PoolKind, Hex>;
const SYNC_TOPIC = { v2: toEventSelector(SYNC_EVENTS.v2), "aerodrome-v2": toEventSelector(SYNC_EVENTS["aerodrome-v2"]) };
const isV2 = (k: PoolKind): k is "v2" | "aerodrome-v2" => k === "v2" || k === "aerodrome-v2";

/** eth_getLogs filter (address + topics) for a source's swaps; v2 kinds also read Sync for the reserves. */
export function swapLogFilter(src: SwapSource): { address: Hex; topics: (Hex | Hex[])[] } {
  if (src.kind === "v4") {
    if (!src.poolId) throw new Error("a v4 swap source needs its poolId");
    return { address: src.address, topics: [SWAP_TOPIC.v4, src.poolId.toLowerCase() as Hex] };
  }
  return { address: src.address, topics: isV2(src.kind) ? [[SWAP_TOPIC[src.kind], SYNC_TOPIC[src.kind]]] : [SWAP_TOPIC[src.kind]] };
}

/** An eth_getLogs result entry (hex numbers) as a RawLog. */
export function rawLog(l: { topics: readonly Hex[] | Hex[]; data: Hex; blockNumber: Hex | bigint | null; logIndex: Hex | number | null; transactionHash: Hex | null; blockTimestamp?: Hex | bigint | null; address?: Hex }): RawLog {
  return {
    topics: [...l.topics],
    data: l.data,
    blockNumber: BigInt(l.blockNumber!),
    logIndex: Number(l.logIndex),
    transactionHash: l.transactionHash!,
    blockTimestamp: l.blockTimestamp == null ? null : BigInt(l.blockTimestamp),
    ...(l.address ? { address: l.address } : {}),
  };
}

const lnBig = (x: bigint): number => {
  // ln of a bigint without overflowing Number: scale down past 2^1000.
  const bits = x.toString(2).length;
  return bits > 1000 ? Math.log(Number(x >> BigInt(bits - 64))) + (bits - 64) * Math.LN2 : Math.log(Number(x));
};

/**
 * floor(log_1.0001(num / den)), clamped to v4 TickMath's range: the tick whose price is the last one <= num/den,
 * checked exactly against getSqrtPriceAtTick (a float guess, then integer steps).
 */
export function tickAtRatio(num: bigint, den: bigint): number {
  if (num <= 0n) return MIN_TICK;
  if (den <= 0n) return MAX_TICK;
  const target = num << 192n;
  const le = (t: number) => {
    const s = getSqrtPriceAtTick(t);
    return s * s * den <= target;
  };
  let t = Math.floor((lnBig(num) - lnBig(den)) / Math.log(1.0001));
  t = Math.min(MAX_TICK, Math.max(MIN_TICK, t));
  while (t > MIN_TICK && !le(t)) t--;
  while (t < MAX_TICK && le(t + 1)) t++;
  return t;
}

/** Station tick from a v3/v4 pool's post-swap state: as is when ETH is currency0, else the inverse price's tick. */
function stationTick(src: SwapSource, tick: number, sqrtPriceX96: bigint): number {
  return src.ethSide === 0 ? tick : tickAtRatio(1n << 192n, sqrtPriceX96 * sqrtPriceX96);
}

/**
 * Decodes one batch of a source's logs (any order; sorted here by block and log index) into rules inputs.
 * isBuy = the token flowed out of the pool to the trader. A swap that moves no token is skipped, as the IMD/ETH
 * station always did. v2 kinds: a Swap takes its tick from the last Sync of the same transaction before it;
 * a batch must hold whole blocks (block-ranged eth_getLogs does), or a Swap without its Sync is skipped.
 */
export function decodeSwapLogs(src: SwapSource, logs: readonly RawLog[]): DecodedSwap[] {
  const sorted = [...logs].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const swapTopic = SWAP_TOPIC[src.kind];
  const syncTopic = isV2(src.kind) ? SYNC_TOPIC[src.kind] : null;
  const poolId = src.poolId?.toLowerCase();
  const cal = calibrator(src.calibration);
  const out: DecodedSwap[] = [];
  let sync: { tx: Hex; r0: bigint; r1: bigint } | null = null;
  for (const l of sorted) {
    const topic = l.topics[0]?.toLowerCase();
    if (syncTopic && topic === syncTopic) {
      const { args } = decodeEventLog({ abi: [SYNC_EVENTS[src.kind as "v2"]], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      sync = { tx: l.transactionHash, r0: args.reserve0, r1: args.reserve1 };
      continue;
    }
    if (topic !== swapTopic) continue;
    if (src.kind === "v4" && l.topics[1]?.toLowerCase() !== poolId) continue;
    // Trader-side deltas: positive = the trader received it.
    let d0: bigint, d1: bigint, tick: number;
    if (src.kind === "v4") {
      const { args } = decodeEventLog({ abi: [SWAP_EVENTS.v4], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      d0 = args.amount0;
      d1 = args.amount1;
      tick = stationTick(src, args.tick, args.sqrtPriceX96);
    } else if (src.kind === "v3" || src.kind === "pancake-v3") {
      const { args } = decodeEventLog({ abi: [SWAP_EVENTS[src.kind] as typeof SWAP_EVENTS.v3], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      // v3 reports the pool's side: positive = the pool received it.
      d0 = -args.amount0;
      d1 = -args.amount1;
      tick = stationTick(src, args.tick, args.sqrtPriceX96);
    } else {
      const { args } = decodeEventLog({ abi: [SWAP_EVENTS[src.kind] as typeof SWAP_EVENTS.v2], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      d0 = args.amount0Out - args.amount0In;
      d1 = args.amount1Out - args.amount1In;
      if (!sync || sync.tx.toLowerCase() !== l.transactionHash.toLowerCase()) continue;
      const [rEth, rToken] = src.ethSide === 0 ? [sync.r0, sync.r1] : [sync.r1, sync.r0];
      tick = tickAtRatio(rToken, rEth);
    }
    const [ethDelta, tokenDelta] = src.ethSide === 0 ? [d0, d1] : [d1, d0];
    if (tokenDelta === 0n) continue;
    const ts = l.blockTimestamp ? Number(l.blockTimestamp) : undefined;
    let quoteAmt = ethDelta < 0n ? -ethDelta : ethDelta;
    if (cal) {
      quoteAmt = cal.amt(quoteAmt);
      tick = Math.min(MAX_TICK, Math.max(MIN_TICK, tick + cal.shift));
    }
    out.push({
      isBuy: tokenDelta > 0n,
      quoteAmt,
      tick,
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      txHash: l.transactionHash,
      timestamp: ts || undefined,
    });
  }
  return out;
}
