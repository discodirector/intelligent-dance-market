// Payment verification (docs/STATIONS.md "Applications and payment"): the payer submits the tx hash; the receipt must
// hold an ERC20 Transfer of an accepted stablecoin on that chain to payTo, worth at least the quote, mined inside the
// quote's window and confirmed enough times; a tx credits one application only (store.ts used-tx.json). The quote's
// tag (pricing.ts) is the second key: a transfer that is not this quote's amount but exactly another open quote's is
// refused, so swapped tx hashes never credit the wrong application. Pure here; ChainReader reads the chain.
import type { PublicClient } from "viem";
import { makeClients, withRetry } from "../replay/rpc.ts";
import { LIMITS, PAY_CHAINS, STABLES, type Stable } from "./config.ts";
import type { Application } from "./store.ts";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** A log as both viem receipts and raw JSON-RPC receipts carry it. */
export interface LogLike { address: string; topics: readonly string[]; data: string; logIndex?: number | string | null }

export interface ReceiptLike {
  /** viem: "success" | "reverted"; raw JSON-RPC: "0x1" | "0x0". */
  status: string;
  blockNumber: bigint | string;
  logs: readonly LogLike[];
}

export interface StableTransfer { stable: Stable; from: `0x${string}`; to: `0x${string}`; value: bigint; logIndex: number }

const addr = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase() as `0x${string}`;
const big = (v: bigint | string) => (typeof v === "bigint" ? v : BigInt(v));

/** Every Transfer(from, to, value) log of an accepted stablecoin on `chainId` (other tokens and events ignored). */
export function stableTransfers(chainId: number, logs: readonly LogLike[], stables: Stable[] = STABLES): StableTransfer[] {
  const byAddr = new Map(stables.filter((s) => s.chainId === chainId).map((s) => [s.address.toLowerCase(), s]));
  const out: StableTransfer[] = [];
  for (const l of logs) {
    const stable = byAddr.get(l.address.toLowerCase());
    if (!stable || l.topics.length !== 3 || l.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(l.data)) continue;
    out.push({ stable, from: addr(l.topics[1]), to: addr(l.topics[2]), value: BigInt(l.data), logIndex: Number(l.logIndex ?? -1) });
  }
  return out;
}

export type PayCheck =
  | { ok: true; transfer: StableTransfer }
  | { ok: false; code: "reverted" | "no-transfer" | "underpaid" | "other-application" | "before-quote" | "after-expiry"; error: string }
  | { ok: false; code: "confirming"; error: string; confirmations: number; required: number };

export interface PayInput {
  app: Application;
  chainId: number;
  receipt: ReceiptLike;
  /** Unix seconds of the receipt's block. */
  blockTime: number;
  head: bigint;
  /** Other applications still open (their tagged amounts are refused here). */
  others: Application[];
  required?: number;
  stables?: Stable[];
}

const quoted = (a: Application, chainId: number, token: string) =>
  a.quote.amounts.find((x) => x.chainId === chainId && x.token.toLowerCase() === token.toLowerCase());

/**
 * The verdict on one receipt for one application. Order: reverted, a transfer to payTo, its amount against this quote
 * (and the other open quotes), the time window, then confirmations last (a payment that will never count is refused
 * at once, not after waiting).
 */
export function checkPayment(i: PayInput): PayCheck {
  const { app, chainId, receipt } = i;
  if (!(receipt.status === "success" || receipt.status === "0x1")) return { ok: false, code: "reverted", error: "the transaction reverted" };
  const payTo = app.payTo.toLowerCase();
  const toUs = stableTransfers(chainId, receipt.logs, i.stables).filter((t) => t.to === payTo);
  const names = (i.stables ?? STABLES).filter((s) => s.chainId === chainId).map((s) => s.symbol).join(", ");
  if (!toUs.length) return { ok: false, code: "no-transfer", error: `no ${names} transfer to ${app.payTo} in this transaction` };

  // The best transfer for this quote: exact first, then the largest that covers it.
  const covering = toUs
    .map((t) => ({ t, need: BigInt(quoted(app, chainId, t.stable.address)?.amount ?? "0") }))
    .filter((x) => x.need > 0n && x.t.value >= x.need);
  const exact = covering.find((x) => x.t.value === x.need);
  const pick = exact ?? covering.sort((a, b) => (a.t.value > b.t.value ? -1 : 1))[0];
  if (!pick) {
    const t = toUs[0], need = quoted(app, chainId, t.stable.address)?.display ?? "?";
    return { ok: false, code: "underpaid", error: `${t.stable.symbol} transfer is below the quoted ${need}` };
  }
  if (!exact) {
    // Not this quote's amount: refused when it is exactly another open quote's (a swapped tx hash).
    const other = i.others.find((o) => o.id !== app.id && quoted(o, chainId, pick.t.stable.address)?.amount === pick.t.value.toString());
    if (other) return { ok: false, code: "other-application", error: "this transfer is the exact amount of another application: submit it there" };
  }

  const t = i.blockTime * 1000;
  if (t < Date.parse(app.createdAt) - LIMITS.clockSkewMs) return { ok: false, code: "before-quote", error: "the transaction is older than the quote" };
  if (t > Date.parse(app.expiresAt) + LIMITS.graceMs) return { ok: false, code: "after-expiry", error: "the transaction was mined after the quote expired: ask for a new quote" };

  const required = i.required ?? PAY_CHAINS[chainId]?.confirmations ?? 1;
  const confirmations = Number(i.head - big(receipt.blockNumber) + 1n);
  if (confirmations < required) return { ok: false, code: "confirming", error: `waiting for confirmations (${Math.max(confirmations, 0)}/${required})`, confirmations: Math.max(confirmations, 0), required };
  return { ok: true, transfer: pick.t };
}

// ---------------------------------------------------------------- chain

export interface ChainReader {
  /** null = not mined (or unknown to the RPC) yet. */
  receipt(chainId: number, txHash: `0x${string}`): Promise<ReceiptLike | null>;
  blockTime(chainId: number, block: bigint): Promise<number>;
  head(chainId: number): Promise<bigint>;
}

/** Read-only RPC reader over each pay chain's registry RPCs (stations/registry.json chains), tried in order. */
export function rpcReader(rpcUrls: (chainId: number) => string[]): ChainReader {
  const cache = new Map<number, PublicClient[]>();
  const clients = (id: number) => {
    if (!cache.has(id)) cache.set(id, makeClients(rpcUrls(id)));
    return cache.get(id)!;
  };
  return {
    async receipt(chainId, hash) {
      try {
        return await withRetry(clients(chainId), (c) => c.getTransactionReceipt({ hash }), 2);
      } catch (e) {
        if ((e as Error)?.name === "TransactionReceiptNotFoundError") return null;
        throw e;
      }
    },
    async blockTime(chainId, block) {
      return Number((await withRetry(clients(chainId), (c) => c.getBlock({ blockNumber: block }), 3)).timestamp);
    },
    head: (chainId) => withRetry(clients(chainId), (c) => c.getBlockNumber(), 3),
  };
}
