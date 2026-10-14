// SPEC §5 posting rules, pure + testable.
export const H = 3600_000;

export interface Rules {
  snapshotEveryMs: number; // 6h
  eventMinGapMs: number; // Movement/whale posts: max 1 per hour
  dailyCap: number; // 6 posts per rolling 24h
}
export const DEFAULT_RULES: Rules = { snapshotEveryMs: 6 * H, eventMinGapMs: 1 * H, dailyCap: 6 };

export type PostKind = "snapshot" | "movement" | "teaser";
export interface PostRecord { at: number; kind: PostKind }
export interface SchedState { posts: PostRecord[]; lastBlock?: number; pendingMovements?: number }

export interface Signals {
  live: boolean; // hook deployed + watched
  newMovements: number; // Movement/whale events since last check
}

/** Decide what (if anything) to post now. Events beat snapshots; everything respects the daily cap. */
export function decide(now: number, s: SchedState, sig: Signals, r: Rules = DEFAULT_RULES): PostKind | null {
  const recent = s.posts.filter((p) => now - p.at < 24 * H);
  if (recent.length >= r.dailyCap) return null;
  const last = (kinds: PostKind[]) => Math.max(-Infinity, ...s.posts.filter((p) => kinds.includes(p.kind)).map((p) => p.at));
  if (!sig.live) return now - last(["teaser"]) >= r.snapshotEveryMs ? "teaser" : null;
  if (sig.newMovements > 0 && now - last(["movement"]) >= r.eventMinGapMs) return "movement";
  if (now - last(["snapshot", "teaser"]) >= r.snapshotEveryMs) return "snapshot";
  return null;
}

export function prune(s: SchedState, now: number): SchedState {
  return { ...s, posts: s.posts.filter((p) => now - p.at < 7 * 24 * H) };
}
