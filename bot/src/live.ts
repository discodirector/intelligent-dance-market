// Live watcher: reads the deployed hook's Mutated/Movement events on Robinhood Chain (4663) -> timeline entries.
import { createPublicClient, defineChain, http, parseAbiItem, type PublicClient } from "viem";
import { decode } from "@swarm-sequencer/core";
import { toTimelineState, type TimelineEntry } from "./lib/timeline.ts";

export const MUTATED = parseAbiItem(
  "event Mutated(address indexed sender, uint32 indexed swapCount, uint8 track, uint8 step, bool on, uint8 bassNote, bool isBuy, uint128 imdAmount, int24 tick, uint256 slot0, uint256 slot1)",
);

export interface LiveConfig { rpcUrl: string; hook: `0x${string}`; chainId: number; startBlock?: bigint }

export function liveConfigFromEnv(): LiveConfig | null {
  const hook = process.env.HOOK_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = process.env.LIVE_RPC_URL;
  if (!hook || !rpcUrl) return null;
  return {
    hook,
    rpcUrl,
    chainId: Number(process.env.LIVE_CHAIN_ID ?? 4663),
    startBlock: process.env.HOOK_START_BLOCK ? BigInt(process.env.HOOK_START_BLOCK) : undefined,
  };
}

export function liveClient(c: LiveConfig): PublicClient {
  const chain = defineChain({
    id: c.chainId,
    name: c.chainId === 4663 ? "Robinhood Chain" : `chain-${c.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(c.rpcUrl, { retryCount: 3 }) }) as PublicClient;
}

/** Fetch Mutated events in [from, to] (chunked) as timeline entries. */
export async function fetchMutated(client: PublicClient, hook: `0x${string}`, from: bigint, to: bigint): Promise<TimelineEntry[]> {
  const logs: any[] = [];
  let chunk = 10_000n;
  for (let a = from; a <= to; ) {
    const b = a + chunk - 1n > to ? to : a + chunk - 1n;
    try {
      logs.push(...(await client.getLogs({ address: hook, event: MUTATED, fromBlock: a, toBlock: b, strict: true })));
      a = b + 1n;
    } catch (e) {
      if (chunk <= 100n) throw e;
      chunk /= 4n;
    }
  }
  const ts = new Map<bigint, number>();
  for (const l of logs) if (l.blockTimestamp != null) ts.set(l.blockNumber, Number(l.blockTimestamp));
  for (const bn of new Set(logs.map((l) => l.blockNumber as bigint)))
    if (!ts.has(bn)) ts.set(bn, Number((await client.getBlock({ blockNumber: bn })).timestamp));
  return logs.map((l, i) => {
    const a = l.args;
    const st = decode(a.slot0, a.slot1);
    const prevRoot = i > 0 ? decode(logs[i - 1].args.slot0, logs[i - 1].args.slot1).root : undefined;
    const whale = prevRoot !== undefined ? prevRoot !== st.root : false;
    return {
      i,
      ts: ts.get(l.blockNumber)!,
      blockNumber: Number(l.blockNumber),
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      isBuy: a.isBuy,
      imdAmt: a.imdAmount.toString(),
      imd: Number(a.imdAmount / 10n ** 12n) / 1e6,
      tick: Number(a.tick),
      track: Number(a.track),
      step: Number(a.step),
      on: a.on,
      bassNote: Number(a.bassNote),
      whale,
      movement: whale,
      slot0: "0x" + a.slot0.toString(16),
      slot1: "0x" + a.slot1.toString(16),
      state: toTimelineState(st),
    };
  });
}
