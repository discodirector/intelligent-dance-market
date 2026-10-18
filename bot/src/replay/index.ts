// bot/replay: real IMD/ETH pool swaps on Ethereum mainnet -> core.mutate -> timeline.json
// The hook pairs IDM with native ETH, so the tape reads the ETH side of the pool: amount = |ETH delta| (wei),
// buy = the swapper received the pool token (IMD), mirroring "bought IDM with ETH".
//   tsx src/replay/index.ts [--days 7] [--pools main|eth|<id,id>] [--out out/timeline.json] [--rules v1|v2]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseAbiItem, getAddress } from "viem";
import { getLogsChunked, makeClients, withRetry } from "./rpc.ts";
import { IMD_TOKEN, MAIN_POOL_ID, POOL_MANAGER, V4_DEPLOY_BLOCK, type PoolKeyInfo } from "./pools.ts";
import { buildTimeline, type RawSwap, type TimelineMeta } from "../lib/timeline.ts";
import { isHookRules, replayRulesFromEnv, type HookRules } from "../lib/hookRules.ts";

const SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
const INIT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

export function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const log = (...a: unknown[]) => console.error("[replay]", ...a);

/** All v4 pools with IMD on either side. */
export async function findImdPools(clients = makeClients()): Promise<PoolKeyInfo[]> {
  const head = await withRetry(clients, (c) => c.getBlockNumber());
  const out: PoolKeyInfo[] = [];
  for (const args of [{ currency0: IMD_TOKEN }, { currency1: IMD_TOKEN }]) {
    const logs = await getLogsChunked(clients, { address: POOL_MANAGER, event: INIT, args, fromBlock: V4_DEPLOY_BLOCK, toBlock: head }, { chunk: 500_000n });
    for (const l of logs)
      out.push({ id: l.args.id, currency0: l.args.currency0, currency1: l.args.currency1, fee: l.args.fee, tickSpacing: l.args.tickSpacing, hooks: l.args.hooks, block: l.blockNumber });
  }
  return out;
}

export interface FetchOpts {
  days: number;
  poolIds: `0x${string}`[];
  /** For each pool: is IMD currency1? (true for ETH/IMD pools since address(0) sorts first). The other side must be ETH. */
  imdIsCurrency1?: Record<string, boolean>;
}

export async function fetchSwaps(opts: FetchOpts) {
  const clients = makeClients();
  const head = await withRetry(clients, (c) => c.getBlockNumber());
  const headBlock = await withRetry(clients, (c) => c.getBlock({ blockNumber: head }));
  const fromTs = Number(headBlock.timestamp) - opts.days * 86400;
  const fromBlock = head - BigInt(Math.ceil((opts.days * 86400) / 12) + 600);
  log(`head ${head}, scanning ${fromBlock}..${head} for ${opts.poolIds.length} pool(s)`);
  const logs = await getLogsChunked(
    clients,
    { address: POOL_MANAGER, event: SWAP, args: { id: opts.poolIds }, fromBlock, toBlock: head },
    { chunk: 5_000n, onProgress: (d, t, f) => process.stderr.write(`\r[replay] ${((Number(d) / Number(t)) * 100).toFixed(0)}% ${f} swaps   `) },
  );
  process.stderr.write("\n");

  // Block timestamps: most public RPCs include blockTimestamp on logs; fall back to getBlock.
  const tsCache = new Map<bigint, number>();
  for (const l of logs) if (l.blockTimestamp != null) tsCache.set(l.blockNumber, Number(l.blockTimestamp));
  const missing = [...new Set(logs.map((l) => l.blockNumber as bigint))].filter((b) => !tsCache.has(b));
  if (missing.length) log(`fetching ${missing.length} block timestamps`);
  for (let i = 0; i < missing.length; i += 10) {
    await Promise.all(
      missing.slice(i, i + 10).map(async (b) => {
        const blk = await withRetry(clients, (c) => c.getBlock({ blockNumber: b }));
        tsCache.set(b, Number(blk.timestamp));
      }),
    );
  }

  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const swaps: RawSwap[] = [];
  for (const l of logs) {
    const ts = tsCache.get(l.blockNumber)!;
    if (ts < fromTs) continue;
    const imd1 = opts.imdIsCurrency1?.[l.args.id] ?? true;
    // Swap amounts are from the swapper's perspective: positive = received by the swapper.
    const imdDelta: bigint = imd1 ? l.args.amount1 : l.args.amount0;
    const ethDelta: bigint = imd1 ? l.args.amount0 : l.args.amount1;
    if (imdDelta === 0n) continue;
    swaps.push({
      isBuy: imdDelta > 0n,
      quoteAmt: ethDelta < 0n ? -ethDelta : ethDelta,
      tick: Number(l.args.tick),
      blockNumber: l.blockNumber,
      timestamp: ts,
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      poolId: l.args.id,
    });
  }
  return { swaps, head: Number(head), fromBlock: Number(fromBlock) };
}

export async function replay(opts: { days: number; pools: string; out: string; rules?: HookRules }) {
  const rules = opts.rules ?? replayRulesFromEnv();
  let poolIds: `0x${string}`[];
  const imdIsCurrency1: Record<string, boolean> = {};
  if (opts.pools === "main") poolIds = [MAIN_POOL_ID];
  else if (opts.pools === "eth") {
    const pools = await findImdPools();
    const eth = pools.filter((p) => BigInt(p.currency0) === 0n);
    poolIds = eth.map((p) => p.id);
    log(`found ${eth.length} ETH/IMD pools`);
  } else {
    poolIds = opts.pools.split(",") as `0x${string}`[];
    log("explicit pool ids: amounts are read from the non-IMD side, which must be native ETH");
  }

  const { swaps, head, fromBlock } = await fetchSwaps({ days: opts.days, poolIds, imdIsCurrency1 });
  const { entries, initial } = buildTimeline(swaps, undefined, rules);
  const meta: TimelineMeta = {
    version: 1,
    ...(rules === "v1" ? {} : { rules }),
    quoteSymbol: "ETH",
    chainId: 1,
    source: `uniswap-v4 PoolManager Swap logs, last ${opts.days}d`,
    poolManager: getAddress(POOL_MANAGER),
    poolIds,
    token: getAddress(IMD_TOKEN),
    fromBlock: entries[0]?.blockNumber ?? fromBlock,
    toBlock: entries.at(-1)?.blockNumber ?? head,
    fromTs: entries[0]?.ts ?? 0,
    toTs: entries.at(-1)?.ts ?? 0,
    count: entries.length,
    generatedAt: new Date().toISOString(),
    initial,
  };
  const out = resolve(opts.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(entries));
  writeFileSync(out.replace(/\.json$/, ".meta.json"), JSON.stringify(meta, null, 2));
  log(`wrote ${entries.length} entries -> ${out}`);
  return { entries, meta };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = arg("rules");
  if (r != null && !isHookRules(r)) throw new Error(`--rules must be v1 or v2`);
  await replay({ days: Number(arg("days", "7")), pools: arg("pools", "main")!, out: arg("out", "out/timeline.json")!, rules: r });
}
