// Station+ (docs/STATIONS.md "Station+"): a station in the 24/7 YouTube rotation, posted once a week on @theidmfun and
// listed above the plain stations. Pure: the slots taken and the days an upgrade covers. The API refuses a new Station+
// (setup, renewal or upgrade) when the slots are taken; the worker tells the owner when they fill up.
import { LIMITS } from "../api/config.ts";
import { stateOf, type Application } from "../api/store.ts";
import type { Registry, RegistryEntry } from "../station.ts";
import { effectivePaidUntil, effectivePlusUntil, paidEnd, stationStatus, type Subscription, type Subscriptions } from "./subscription.ts";

const DAY = 86_400_000;
/** A Station+ gap this short before the paid end is not charged (a quote paid minutes later than it was made). */
export const UPGRADE_GRACE_MS = 3_600_000;

/**
 * Whole days of the paid period a Station+ upgrade covers: from the later of now and the current Station+ end to the
 * paid end, rounded up (the first UPGRADE_GRACE_MS free). 0 = nothing to upgrade: Station+ already runs to the paid end,
 * or there is no paid end ahead (lapsed, or a station that never expires).
 */
export function upgradeDays(e: RegistryEntry, sub: Subscription | undefined, now: number): number {
  const paid = paidEnd(effectivePaidUntil(e, sub));
  if (paid === null || paid <= now) return 0;
  const gap = paid - Math.max(now, paidEnd(effectivePlusUntil(e, sub)) ?? 0);
  return gap > UPGRADE_GRACE_MS ? Math.ceil((gap - UPGRADE_GRACE_MS) / DAY) : 0;
}

export interface PlusSlots {
  max: number;
  used: number;
  left: number;
  /** Stations on Station+ now. */
  active: string[];
  /** Paid Station+ setups not on air yet (their slot is held from the payment). */
  pending: number;
  /** Open quotes that would add a Station+ station (held for the quote's life, so a paid quote always has its slot). */
  quoted: number;
}

/**
 * The Station+ slots taken now: the stations inside their Station+, the paid Station+ setups the pipeline has not put
 * on air yet (stage from `stage`; a rejected one frees its slot), and the open quotes for a new Station+ (setups, and
 * renewals or upgrades of a station not on Station+ now, one per station). `except`: an application not to count.
 */
export function plusSlots(o: {
  reg: Registry;
  subs: Subscriptions;
  apps: Application[];
  stage: (appId: string) => string | undefined;
  now: number;
  max: number;
  except?: string;
}): PlusSlots {
  const active = o.reg.stations.filter((e) => stationStatus(e, o.subs[e.key], o.now).plus).map((e) => e.key);
  const on = new Set(active);
  let pending = 0, quoted = 0;
  const quotedKeys = new Set<string>();
  for (const a of o.apps) {
    if (a.id === o.except) continue;
    const plus = a.plus || a.kind === "upgrade";
    if (!plus) continue;
    if (a.payment) {
      if (a.kind === "setup" && !["live", "rejected"].includes(o.stage(a.id) ?? "paid")) pending++;
      continue;
    }
    if (stateOf(a, o.now, LIMITS.graceMs) === "expired") continue;
    if (a.kind === "setup") quoted++;
    else if (a.key && !on.has(a.key) && !quotedKeys.has(a.key)) {
      quotedKeys.add(a.key);
      quoted++;
    }
  }
  const used = active.length + pending + quoted;
  return { max: o.max, used, left: Math.max(0, o.max - used), active, pending, quoted };
}
