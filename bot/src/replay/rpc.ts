// Chunked eth_getLogs with retries and adaptive range splitting for public RPCs.
import { createPublicClient, http, toHex, type AbiEvent, type PublicClient } from "viem";
import { rawLog, type RawLog } from "@swarm-sequencer/core";
import { mainnet } from "viem/chains";

// Public endpoints that serve eth_getLogs over wide ranges without a key (checked 2026-10-15).
// publicnode refuses non-recent ("archive") log ranges, so it is a fallback for recent blocks only.
export const DEFAULT_RPCS = [
  "https://mainnet.gateway.tenderly.co",
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.mevblocker.io",
  "https://rpc.flashbots.net",
];

export function rpcUrls(): string[] {
  const env = process.env.ETH_RPC_URL;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_RPCS;
}

export function makeClients(urls = rpcUrls()): PublicClient[] {
  return urls.map(
    (u) => createPublicClient({ chain: mainnet, transport: http(u, { timeout: 30_000, retryCount: 0 }) }) as PublicClient,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Try each client in turn with exponential backoff. */
export async function withRetry<T>(clients: PublicClient[], fn: (c: PublicClient) => Promise<T>, tries = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const c = clients[i % clients.length];
    try {
      return await fn(c);
    } catch (e) {
      last = e;
      await sleep(Math.min(8000, 400 * 2 ** i));
    }
  }
  throw last;
}

/** A rate limit, not a range limit: Tenderly answers "Request exceeds defined limit" with details "rate limit
 *  exceeded". Shrinking the range would only send more requests; wait and retry the same range. */
export function isRateLimit(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return /rate limit|ratelimit|too many requests|status: 429|\b429\b/.test(m);
}

export function isRangeError(e: unknown): boolean {
  if (isRateLimit(e)) return false;
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return /range|too many|limit|exceed|too large|10000|response size|took too long/.test(m);
}

export async function getLogsChunked<E extends AbiEvent>(
  clients: PublicClient[],
  params: { address: `0x${string}`; event: E; args?: Record<string, unknown>; fromBlock: bigint; toBlock: bigint },
  opts: ChunkOptions = {},
) {
  const read = (c: PublicClient, from: bigint, to: bigint) =>
    c.getLogs({ address: params.address, event: params.event, args: params.args, fromBlock: from, toBlock: to, strict: true } as any) as Promise<any[]>;
  return chunked(clients, read, params.fromBlock, params.toBlock, opts);
}

/** Same loop over a raw eth_getLogs filter (address + topics), e.g. core swapLogFilter(); returns core RawLogs. */
export async function getRawLogsChunked(
  clients: PublicClient[],
  filter: { address: `0x${string}`; topics: (`0x${string}` | `0x${string}`[])[] },
  fromBlock: bigint,
  toBlock: bigint,
  opts: ChunkOptions = {},
): Promise<RawLog[]> {
  const read = async (c: PublicClient, from: bigint, to: bigint) =>
    ((await c.request({ method: "eth_getLogs", params: [{ ...filter, fromBlock: toHex(from), toBlock: toHex(to) }] })) as any[]).map(rawLog);
  return chunked(clients, read, fromBlock, toBlock, opts);
}

export interface ChunkOptions {
  /** First range size, in blocks (default 5k). */
  chunk?: bigint;
  /** Ranges grow while results are small, never past this: a chain's limit (registry chains.logChunk). Unset: grow
   *  while under 200k. */
  maxChunk?: bigint;
  onProgress?: (done: bigint, total: bigint, found: number) => void;
}

async function chunked<T>(clients: PublicClient[], read: (c: PublicClient, from: bigint, to: bigint) => Promise<T[]>, fromBlock: bigint, toBlock: bigint, opts: ChunkOptions): Promise<T[]> {
  const out: T[] = [];
  const max = opts.maxChunk;
  let chunk = opts.chunk ?? 5_000n;
  if (max && chunk > max) chunk = max;
  let from = fromBlock;
  const total = toBlock - fromBlock + 1n;
  while (from <= toBlock) {
    const to = from + chunk - 1n > toBlock ? toBlock : from + chunk - 1n;
    try {
      const logs = await getOnce(clients, (c) => read(c, from, to));
      out.push(...logs);
      opts.onProgress?.(to - fromBlock + 1n, total, out.length);
      from = to + 1n;
      if (logs.length < 2000) {
        if (max) chunk = (chunk * 3n) / 2n > max ? max : (chunk * 3n) / 2n;
        else if (chunk < 200_000n) chunk = (chunk * 3n) / 2n;
      }
    } catch (e) {
      if (chunk <= 10n) throw e;
      chunk = chunk / 4n > 10n ? chunk / 4n : 10n;
    }
  }
  return out;
}

async function getOnce<T>(clients: PublicClient[], read: (c: PublicClient) => Promise<T[]>): Promise<T[]> {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    const c = clients[i % clients.length];
    try {
      return await read(c);
    } catch (e) {
      last = e;
      if (isRangeError(e)) throw e; // caller shrinks the range
      // Rate limited: back off longer (up to ~16 s) before the next client / try.
      await sleep(isRateLimit(e) ? Math.min(16_000, 1000 * 2 ** i) : 500 * 2 ** Math.min(i, 3));
    }
  }
  throw last;
}
