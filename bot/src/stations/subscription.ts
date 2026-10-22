// Subscriptions (docs/STATIONS.md "Subscription"): a station is on air while it is paid. The registry's status is the
// owner's switch, its paidUntil the subscription it was added with; paid renewals (bot/src/api, written to
// OUT_DIR/applications/subscriptions.json) push the end further. The runtime status the site reads,
// OUT_DIR/stations-data/status.json = { <key>: { status, paidUntil? } }, merges both: a live station whose paidUntil
// has passed is "expired" (off air, keeps its sound and its registry entry). House stations never expire; a station
// with no paidUntil anywhere (the pilot) never expires either.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Registry, RegistryEntry } from "../station.ts";

export type RuntimeStatus = RegistryEntry["status"] | "expired";
export interface StationStatus { status: RuntimeStatus; paidUntil?: string }
export type StatusFile = Record<string, StationStatus>;

export interface Renewal { applicationId: string; months: number; paidAt: string; txHash: string; chainId: number }
export interface Subscription { paidUntil: string; renewals: Renewal[] }
export type Subscriptions = Record<string, Subscription>;

const DAY = 86_400_000;

/**
 * End of a paidUntil, ms (exclusive): a date (YYYY-MM-DD) is paid through the end of that UTC day; an ISO timestamp
 * is exact. null = absent or unreadable.
 */
export function paidEnd(v: string | undefined): number | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const t = Date.parse(`${v}T00:00:00Z`);
    return Number.isFinite(t) ? t + DAY : null;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** ISO timestamp in UTC, whole seconds (the registry's isPaidUntil shape). */
export const isoSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

/** Calendar months added in UTC; a day the month does not have is clamped (Jan 31 + 1 = Feb 28/29). */
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

/** The later of the registry's paidUntil and the paid renewals', as written (null = none). */
export function effectivePaidUntil(e: RegistryEntry, sub?: Subscription): string | undefined {
  const a = paidEnd(e.paidUntil), b = paidEnd(sub?.paidUntil);
  if (a === null) return b === null ? undefined : sub!.paidUntil;
  if (b === null) return e.paidUntil;
  return b > a ? sub!.paidUntil : e.paidUntil;
}

/** A renewal of `months` from the later of now and the current end (a lapsed station restarts from today). */
export function renewedUntil(e: RegistryEntry, sub: Subscription | undefined, months: number, now: number): string {
  const end = paidEnd(effectivePaidUntil(e, sub));
  return isoSeconds(addMonths(Math.max(now, end ?? 0), months));
}

/** One station's runtime status: the registry's switch, "expired" when a live station's subscription has run out. */
export function stationStatus(e: RegistryEntry, sub: Subscription | undefined, now: number): StationStatus {
  const paidUntil = effectivePaidUntil(e, sub);
  const end = paidEnd(paidUntil);
  const expired = !e.house && e.status === "live" && end !== null && end <= now;
  return { status: expired ? "expired" : e.status, ...(paidUntil ? { paidUntil } : {}) };
}

export function buildStatus(reg: Registry, subs: Subscriptions, now: number): StatusFile {
  return Object.fromEntries(reg.stations.map((e) => [e.key, stationStatus(e, subs[e.key], now)]));
}

export interface Reminder { key: string; label: string; paidUntil: string; daysLeft: number; status: RuntimeStatus }

/** Live stations whose subscription ends within `days` (and those already expired), soonest first. */
export function expiring(reg: Registry, status: StatusFile, now: number, days = 3): Reminder[] {
  const out: Reminder[] = [];
  for (const e of reg.stations) {
    const s = status[e.key];
    const end = paidEnd(s?.paidUntil);
    if (e.house || e.status !== "live" || end === null || end - now > days * DAY) continue;
    out.push({ key: e.key, label: e.label, paidUntil: s.paidUntil!, daysLeft: Math.round(((end - now) / DAY) * 10) / 10, status: s.status });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ---------------------------------------------------------------- files

/** Written whole then renamed: a reader (web server, another process) never sees half a file. */
export function writeJsonAtomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

export const subscriptionsPath = (outDir: string) => join(outDir, "applications", "subscriptions.json");
export const statusPath = (stationsDataDir: string) => join(stationsDataDir, "status.json");

export function loadSubscriptions(outDir: string): Subscriptions {
  const p = subscriptionsPath(outDir);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

/** Recomputes and publishes status.json; returns it. */
export function publishStatus(reg: Registry, outDir: string, stationsDataDir: string, now = Date.now()): StatusFile {
  const status = buildStatus(reg, loadSubscriptions(outDir), now);
  writeJsonAtomic(statusPath(stationsDataDir), status);
  return status;
}
