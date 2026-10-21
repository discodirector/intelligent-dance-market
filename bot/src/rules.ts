// SPEC §5 posting rules, pure + testable.
export const H = 3600_000;

export interface Rules {
  snapshotEveryMs: number; // 6h
  trackMinGapMs: number; // track-complete posts: min gap (0 = each finished track as soon as it is rendered)
  eventMinGapMs: number; // Movement/whale posts: max 1 per 2h, on their own clock (tracks do not hold them back)
  dailyCap: number; // 24 posts per rolling 24h
}
// Owner 2026-10-21: the launch market finishes a track every 20-60 min; every track is posted as soon as it is ready
// (a queue, oldest first, one per tick), whale movements get their own post every 2h, 24 posts/day
// (was a shared 1/h and 6/day that skipped most tracks and, with tracks that frequent, every movement).
export const DEFAULT_RULES: Rules = { snapshotEveryMs: 6 * H, trackMinGapMs: 0, eventMinGapMs: 2 * H, dailyCap: 24 };

export type PostKind = "snapshot" | "movement" | "track" | "teaser";
export interface PostRecord { at: number; kind: PostKind }
/** A finished track waiting for its release post: its number and the block of its TrackComplete. */
export interface QueuedTrack {
  trackNo: number; block: number;
  /** A station's track (station.ts, e.g. "imd-eth"); absent = the $IDM hook. */
  station?: string;
  /** Optional hold (unix ms): the track waits in the queue until then (set by hand to time a post). */
  notBefore?: number;
}

/** Queued tracks that may post at `now`, in queue order. */
export const readyTracks = (q: readonly QueuedTrack[] | undefined, now: number) => (q ?? []).filter((t) => !t.notBefore || t.notBefore <= now);
export interface SchedState {
  posts: PostRecord[]; lastBlock?: number; pendingMovements?: number;
  /** Finished tracks not posted yet, oldest first. */
  trackQueue?: QueuedTrack[];
  /** Highest trackNo ever queued: a TrackComplete is queued once. */
  lastTrackNo?: number;
  /** Highest trackNo queued from the IMD/ETH station. */
  stationLastTrackNo?: number;
  /** Legacy count before the queue (2026-10-21); ignored. */
  pendingTracks?: number;
}

export interface Signals {
  live: boolean; // hook deployed + watched
  newMovements: number; // Movement/whale events since last check
  newTracks?: number; // v2 hook: track-complete (heat drop) events since last check
}

/**
 * Decide what (if anything) to post now; everything respects the daily cap. Tracks go first, except that a due
 * movement takes the next slot after a track post, so a steady track queue cannot starve it. Snapshots come last.
 */
export function decide(now: number, s: SchedState, sig: Signals, r: Rules = DEFAULT_RULES): PostKind | null {
  const recent = s.posts.filter((p) => now - p.at < 24 * H);
  if (recent.length >= r.dailyCap) return null;
  const last = (kinds: PostKind[]) => Math.max(-Infinity, ...s.posts.filter((p) => kinds.includes(p.kind)).map((p) => p.at));
  if (!sig.live) return now - last(["teaser"]) >= r.snapshotEveryMs ? "teaser" : null;
  const trackReady = (sig.newTracks ?? 0) > 0 && now - last(["track"]) >= r.trackMinGapMs;
  const moveReady = sig.newMovements > 0 && now - last(["movement"]) >= r.eventMinGapMs;
  const lastKind = s.posts.reduce<PostRecord | null>((a, p) => (!a || p.at > a.at ? p : a), null)?.kind;
  if (moveReady && (!trackReady || lastKind === "track")) return "movement";
  if (trackReady) return "track";
  if (now - last(["snapshot", "teaser"]) >= r.snapshotEveryMs) return "snapshot";
  return null;
}

export function prune(s: SchedState, now: number): SchedState {
  return { ...s, posts: s.posts.filter((p) => now - p.at < 7 * 24 * H) };
}
