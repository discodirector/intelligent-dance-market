// Chunked eth_getLogs with retries and adaptive range splitting for public RPCs.
import { createPublicClient, http, type AbiEvent, type PublicClient } from "viem";
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

function isRangeError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return /range|too many|limit|exceed|too large|10000|response size|took too long/.test(m);
}

export async function getLogsChunked<E extends AbiEvent>(
  clients: PublicClient[],
  params: { address: `0x${string}`; event: E; args?: Record<string, unknown>; fromBlock: bigint; toBlock: bigint },
  opts: { chunk?: bigint; onProgress?: (done: bigint, total: bigint, found: number) => void } = {},
) {
  const out: any[] = [];
  let chunk = opts.chunk ?? 5_000n;
  let from = params.fromBlock;
  const total = params.toBlock - params.fromBlock + 1n;
  while (from <= params.toBlock) {
    const to = from + chunk - 1n > params.toBlock ? params.toBlock : from + chunk - 1n;
    try {
      const logs = await getOnce(clients, { ...params, fromBlock: from, toBlock: to });
      out.push(...logs);
      opts.onProgress?.(to - params.fromBlock + 1n, total, out.length);
      from = to + 1n;
      if (logs.length < 2000 && chunk < 200_000n) chunk = (chunk * 3n) / 2n;
    } catch (e) {
      if (chunk <= 10n) throw e;
      chunk = chunk / 4n > 10n ? chunk / 4n : 10n;
    }
  }
  return out;
}

async function getOnce(clients: PublicClient[], p: any): Promise<any[]> {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    const c = clients[i % clients.length];
    try {
      return await c.getLogs({ address: p.address, event: p.event, args: p.args, fromBlock: p.fromBlock, toBlock: p.toBlock, strict: true } as any);
    } catch (e) {
      last = e;
      if (isRangeError(e)) throw e; // caller shrinks the range
      await sleep(500 * 2 ** i);
    }
  }
  throw last;
}
