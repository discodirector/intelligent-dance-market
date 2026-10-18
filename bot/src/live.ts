// Live watcher: reads the deployed hook's Mutated/Movement events on Robinhood Chain (4663) -> timeline entries.
import { createPublicClient, defineChain, http, parseAbiItem, type PublicClient } from "viem";
import { toTimelineState, type TimelineEntry } from "./lib/timeline.ts";
import { decodeFor, liveRulesFromEnv, type HookRules } from "./lib/hookRules.ts";

export const MUTATED = parseAbiItem(
  "event Mutated(address indexed sender, uint32 indexed swapCount, uint8 track, uint8 step, bool on, uint8 bassNote, bool isBuy, uint128 imdAmount, int24 tick, uint256 slot0, uint256 slot1)",
);

/** v2 hook only. slot0/slot1 = the finished track before the reset; trackNo/patternId/root/seed are after the movement. */
export const TRACK_COMPLETE = parseAbiItem(
  "event TrackComplete(uint16 indexed trackNo, uint32 patternId, uint8 root, uint256 slot0, uint256 slot1, uint32 swapCount, uint64 seed)",
);

export interface LiveConfig { rpcUrl: string; hook: `0x${string}`; chainId: number; startBlock?: bigint; rules: HookRules }

export function liveConfigFromEnv(): LiveConfig | null {
  const hook = process.env.HOOK_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = process.env.LIVE_RPC_URL;
  if (!hook || !rpcUrl) return null;
  return {
    hook,
    rpcUrl,
    chainId: Number(process.env.LIVE_CHAIN_ID ?? 4663),
    startBlock: process.env.HOOK_START_BLOCK ? BigInt(process.env.HOOK_START_BLOCK) : undefined,
    rules: liveRulesFromEnv(),
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

/**
 * Fetch Mutated events in [from, to] (chunked) as timeline entries.
 * v2: TrackComplete events (same range) mark the swaps that finished a track; Mutated holds the state after the reset.
 */
export async function fetchMutated(client: PublicClient, hook: `0x${string}`, from: bigint, to: bigint, rules: HookRules = "v1"): Promise<TimelineEntry[]> {
  const logs: any[] = [];
  const completes: any[] = [];
  let chunk = 10_000n;
  for (let a = from; a <= to; ) {
    const b = a + chunk - 1n > to ? to : a + chunk - 1n;
    try {
      const [m, t] = await Promise.all([
        client.getLogs({ address: hook, event: MUTATED, fromBlock: a, toBlock: b, strict: true }),
        rules === "v2" ? client.getLogs({ address: hook, event: TRACK_COMPLETE, fromBlock: a, toBlock: b, strict: true }) : [],
      ]);
      logs.push(...m);
      completes.push(...t);
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
  const tcBy = new Map<number, any>(completes.map((l) => [Number(l.args.swapCount), l.args]));
  let trackStart: number | null = null;
  return logs.map((l, i) => {
    const a = l.args;
    const st = decodeFor(a.slot0, a.slot1, rules);
    const prevRoot = i > 0 ? decodeFor(logs[i - 1].args.slot0, logs[i - 1].args.slot1, rules).root : undefined;
    const tc = tcBy.get(Number(a.swapCount));
    // v2: a drop also moves the root; it is not a whale unless the amount says so.
    const whale = prevRoot !== undefined ? prevRoot !== st.root && (!tc || a.imdAmount >= 100n * 10n ** 18n) : false;
    const extra: Pick<TimelineEntry, "rules" | "trackComplete"> = rules === "v1" ? {} : { rules };
    if (tc) {
      const no = Number(tc.trackNo), at = Number(tc.swapCount);
      extra.trackComplete = {
        // Swaps in the track: exact when its start is in this window or it is the hook's first track, else unknown.
        trackNo: no, swaps: trackStart !== null ? at - trackStart : no === 1 ? at : undefined,
        swapCount: at, patternId: Number(tc.patternId), root: Number(tc.root), slot0: "0x" + tc.slot0.toString(16), slot1: "0x" + tc.slot1.toString(16),
      };
      trackStart = at;
    }
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
      ...extra,
    };
  });
}
