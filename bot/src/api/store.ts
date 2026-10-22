// Applications on disk (docs/STATIONS.md "Applications and payment"): one JSON file per application under
// OUT_DIR/applications/, the index of tx hashes already credited (used-tx.json) and the paid renewals
// (subscriptions.json, read by the bot's status writer, stations/subscription.ts). No database: every write is a whole
// file renamed into place, and one API process serialises the writes that must not interleave (Store.exclusive).
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { subscriptionsPath, writeJsonAtomic, type Subscriptions } from "../stations/subscription.ts";
import type { Report } from "../stations/eligibility.ts";
import type { Quote } from "./pricing.ts";

export type Contact = { kind: "x" | "telegram" | "email"; value: string };

export interface Payment {
  chainId: number;
  txHash: `0x${string}`;
  token: `0x${string}`;
  symbol: string;
  from: `0x${string}`;
  value: string;
  block: number;
  /** Unix seconds of the block. */
  blockTime: number;
  paidAt: string;
}

export interface Application {
  id: string;
  /** "upgrade": Station+ for the rest of a station's paid period (docs/STATIONS.md "Station+"). */
  kind: "setup" | "renew" | "upgrade";
  createdAt: string;
  /** Quote valid until; a payment mined up to LIMITS.graceMs later still counts. */
  expiresAt: string;
  payTo: `0x${string}`;
  quote: Quote;
  /** Setup: the token, its pool, what the owner asked for. */
  chainId?: number;
  token?: `0x${string}`;
  pool?: string;
  symbol?: string | null;
  contact?: Contact;
  vibe?: string;
  genres?: string[];
  /** Setup: the eligibility report it was accepted on (always PASS: the check is automatic). */
  eligibility?: Pick<Report, "verdict" | "reasons" | "checkedAt" | "pool">;
  /** Renewal and upgrade: the station; renewal: the months. */
  key?: string;
  months?: 1 | 3;
  /** Setup or renewal as Station+ (an upgrade always is). */
  plus?: boolean;
  /** Upgrade: the paid end it was quoted up to (Station+ until then once paid). */
  upgradeTo?: string;
  /** The last tx submitted that is not yet confirmed (shown while the form polls). */
  pendingTx?: { chainId: number; txHash: string; confirmations: number; required: number };
  payment?: Payment;
  /** Renewal: the new paid end. */
  paidUntil?: string;
  /** Paid Station+ renewal or upgrade: the new Station+ end. */
  plusUntil?: string;
  /** Set by bot/scripts/station-apps.ts approve. */
  approvedAt?: string;
}

export type AppState = "awaiting-payment" | "confirming" | "paid" | "expired";

/** Paid; else expired once the quote and its grace are over; else waiting (or confirming a submitted tx). */
export function stateOf(a: Application, now: number, graceMs: number): AppState {
  if (a.payment) return "paid";
  if (Date.parse(a.expiresAt) + graceMs < now) return "expired";
  return a.pendingTx ? "confirming" : "awaiting-payment";
}

const ID = /^[0-9a-f]{24}$/;
export const isAppId = (s: unknown): s is string => typeof s === "string" && ID.test(s);
export const txKey = (chainId: number, txHash: string) => `${chainId}:${txHash.toLowerCase()}`;

export class Store {
  readonly dir: string;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(readonly outDir: string) {
    this.dir = join(outDir, "applications");
    mkdirSync(this.dir, { recursive: true });
  }

  /** Runs `f` after every earlier exclusive call has finished: read-check-write sections never interleave. */
  exclusive<T>(f: () => Promise<T> | T): Promise<T> {
    const run = this.lock.then(f, f);
    this.lock = run.catch(() => undefined);
    return run;
  }

  get(id: string): Application | null {
    if (!isAppId(id)) return null;
    const p = join(this.dir, `${id}.json`);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }

  save(a: Application) {
    if (!isAppId(a.id)) throw new Error(`bad application id ${a.id}`);
    writeJsonAtomic(join(this.dir, `${a.id}.json`), a);
  }

  list(): Application[] {
    return readdirSync(this.dir)
      .filter((f) => /^[0-9a-f]{24}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Application)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** chainId:txHash -> the application it paid. */
  usedTx(): Record<string, string> {
    const p = join(this.dir, "used-tx.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  }

  markUsed(chainId: number, txHash: string, appId: string) {
    const used = this.usedTx();
    const k = txKey(chainId, txHash);
    if (used[k] && used[k] !== appId) throw new Error(`${k} already paid ${used[k]}`);
    used[k] = appId;
    writeJsonAtomic(join(this.dir, "used-tx.json"), used);
  }

  /**
   * The pipeline's state of a paid application (stations/pipeline.ts), its own file so the worker never rewrites the
   * API's <id>.json and the API never rewrites this one.
   */
  pipeline<T>(id: string): T | null {
    if (!isAppId(id)) return null;
    const p = join(this.dir, `${id}.pipeline.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
  }

  savePipeline(p: { appId: string }) {
    if (!isAppId(p.appId)) throw new Error(`bad application id ${p.appId}`);
    writeJsonAtomic(join(this.dir, `${p.appId}.pipeline.json`), p);
  }

  subscriptions(): Subscriptions {
    const p = subscriptionsPath(this.outDir);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  }

  saveSubscriptions(s: Subscriptions) {
    writeJsonAtomic(subscriptionsPath(this.outDir), s);
  }
}
