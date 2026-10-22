// Station+ weekly posts on @theidmfun (docs/STATIONS.md "Station+"). Pure: which Station+ station posts now, what it
// posts and its caption; the scheduler (scheduler.ts) renders and publishes, because it owns the X posting state (the
// daily cap and the gaps), the station timelines (updateStations) and DRY_RUN. One post per station per week, at most
// one Station+ post per tick and none within `gapMs` of the previous one, so several stations never post together.
// A week with a finished track posts that track's release; otherwise a "now playing" clip of the station.
import { selectTrack, trackStartKnown } from "../lib/release.ts";
import type { TimelineEntry } from "../lib/timeline.ts";

const H = 3_600_000;
export const WEEK_MS = 7 * 24 * H;

export interface PlusPostState {
  /** Unix ms of the last post (or of the week given up after `maxFailures`). */
  lastAt?: number;
  /** The newest track already released (never released twice). */
  lastTrackNo?: number;
  lastKind?: "release" | "clip" | "skipped";
  /** Failed tries in a row, and the earliest next try. */
  failures?: number;
  retryAt?: number;
}
export type PlusPostStates = Record<string, PlusPostState>;

export interface PlusPostRules {
  /** One post per station this often. */
  everyMs: number;
  /** At least this long between two Station+ posts (any stations). */
  gapMs: number;
  /** The scheduler's cap of posts per rolling 24 h (rules.ts dailyCap): Station+ posts count in it. */
  dailyCap: number;
  retryMs: number;
  /** Failures in a row before the station's week is given up (the next post a week later). */
  maxFailures: number;
}
export const PLUS_POST_RULES: PlusPostRules = { everyMs: WEEK_MS, gapMs: 3 * H, dailyCap: 24, retryMs: H, maxFailures: 3 };

/** The latest Station+ post of any station (ms), -Infinity when none. */
export const lastPlusAt = (states: PlusPostStates) => Math.max(-Infinity, ...Object.values(states).map((s) => s.lastAt ?? -Infinity));

/**
 * The Station+ station that posts now: due (a week after its last post; a new one at once), not waiting for a retry,
 * the most overdue first (a new station before any other). Null when none is due, the previous Station+ post is
 * within `gapMs`, or `posts24h` has reached the daily cap.
 */
export function duePlusPost(keys: readonly string[], states: PlusPostStates, now: number, posts24h: number, r: PlusPostRules = PLUS_POST_RULES): string | null {
  if (posts24h >= r.dailyCap || now - lastPlusAt(states) < r.gapMs) return null;
  const due = keys
    .map((k) => ({ k, at: (states[k]?.lastAt ?? -Infinity) + r.everyMs, retry: states[k]?.retryAt ?? 0 }))
    .filter((x) => x.at <= now && x.retry <= now)
    .sort((a, b) => a.at - b.at || a.k.localeCompare(b.k));
  return due[0]?.k ?? null;
}

/**
 * The track a release post plays: the newest finished since the last post (a first post: within the last week), never
 * one released before, whose start is on the cached tape (a non-house station keeps its last 2,000 swaps). Null = none.
 */
export function plusTrack(entries: readonly TimelineEntry[], st: PlusPostState | undefined, now: number, everyMs = WEEK_MS): number | null {
  const since = st?.lastAt ?? now - everyMs;
  const done = entries.filter((e) => e.trackComplete && e.trackComplete.trackNo > (st?.lastTrackNo ?? -1) && e.ts * 1000 > since);
  for (const e of done.reverse()) if (trackStartKnown(entries, e.trackComplete!.trackNo)) return e.trackComplete!.trackNo;
  return null;
}

/** Swaps in a track on the tape (its first swap through its TrackComplete). */
export const trackSwaps = (entries: readonly TimelineEntry[], trackNo: number) => {
  const sel = selectTrack(entries, trackNo);
  return sel.end - sel.start + 1;
};

/** `$TICKER` when the ticker can be a cashtag on X (a letter, then letters, digits or _, 15 at most), else null. */
export function cashtag(ticker: string): string | null {
  const t = ticker.replace(/^\$/, "");
  return /^[A-Za-z][A-Za-z0-9_]{0,14}$/.test(t) ? `$${t}` : null;
}

/** `@handle` from an application's contact when it is an X handle, else null. */
export function xHandle(contact: { kind: string; value: string } | undefined): string | null {
  if (contact?.kind !== "x") return null;
  const h = contact.value.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? `@${h}` : null;
}

export interface PlusCaption {
  kind: "release" | "clip";
  /** Registry label, e.g. "CHOG/MON". */
  label: string;
  ticker: string;
  key: string;
  handle?: string | null;
  /** release: the track; clip: the swaps it plays. */
  trackNo?: number;
  swaps?: number;
  genre?: string;
  site?: string;
}

/**
 * The post's text: impersonal and lowercase, the client's ticker as the ONLY cashtag (X refuses a post with two:
 * 403), the client's X handle when the application gave one, the station's link. No prices, no calls to action.
 */
export function plusCaption(c: PlusCaption): string {
  const station = `the ${c.label.replace(/\$/g, "").toLowerCase()} station`;
  const tag = cashtag(c.ticker) ?? c.ticker.replace(/\$/g, "").toLowerCase();
  const genre = c.genre ? `, ${c.genre.toLowerCase()}` : "";
  const lines = c.kind === "release"
    ? [`track #${c.trackNo} finished on ${station}: ${c.swaps} swaps${genre}.`, `every ${tag} trade is a note, the whole track from its first swap to the drop.`]
    : [`now playing on ${station}${genre}.`, `the last ${c.swaps} ${tag} swaps, played through the idm rules.`];
  if (c.handle) lines.push(c.handle);
  lines.push(`${(c.site ?? "theidm.fun").replace(/^https?:\/\//, "").replace(/\/$/, "")}/?net=${c.key}`);
  return lines.join("\n");
}

/** Records a post (or a given-up week) for the station. */
export function postedPlus(states: PlusPostStates, key: string, now: number, kind: PlusPostState["lastKind"], trackNo?: number) {
  const prev = states[key] ?? {};
  states[key] = { lastAt: now, lastKind: kind, ...(trackNo != null ? { lastTrackNo: trackNo } : prev.lastTrackNo != null ? { lastTrackNo: prev.lastTrackNo } : {}) };
}

/** Records a failed try: retry after `retryMs`; after `maxFailures` in a row the week is given up. Returns true then. */
export function failedPlus(states: PlusPostStates, key: string, now: number, r: PlusPostRules = PLUS_POST_RULES): boolean {
  const prev = states[key] ?? {};
  const failures = (prev.failures ?? 0) + 1;
  if (failures >= r.maxFailures) {
    postedPlus(states, key, now, "skipped");
    return true;
  }
  states[key] = { ...prev, failures, retryAt: now + r.retryMs };
  return false;
}
