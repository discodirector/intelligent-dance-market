// Track selection for releases (SPEC §4.6). Pure and import-free: web/render.html and the bot (bot/src/release)
// both use it, so they agree on which swaps make a track.

/** The fields of a timeline entry (bot/TIMELINE.md) that selection reads. */
export interface TrackEntry {
  slot0: string | number | bigint;
  slot1: string | number | bigint;
  /** v2: this swap finished a track; slot0/slot1 here = the finished track before the reset. */
  trackComplete?: { trackNo: number; swaps?: number; slot0: string; slot1: string };
}

export interface TrackSelection {
  trackNo: number;
  /** Index of the track's first swap in the timeline. */
  start: number;
  /** Index of the swap that emitted TrackComplete (inclusive), or of the last entry when the track is unfinished. */
  end: number;
  /** True when `end` emitted TrackComplete. */
  complete: boolean;
  /**
   * Where the seed comes from: the entry before `start` (the previous TrackComplete leaves the new seed in its
   * slots), or the tape start (the caller's initial slots, else the first entry's state).
   */
  seedIndex: number | null;
  /** Swaps in the track according to the hook, when the TrackComplete says so (equals end - start + 1 on a full tape). */
  hookSwaps?: number;
}

/** trackNo of every TrackComplete on the tape, in order. */
export function completedTracks(entries: readonly TrackEntry[]): number[] {
  return entries.filter((e) => e.trackComplete).map((e) => e.trackComplete!.trackNo);
}

/**
 * The swaps of one track: from the first swap after the previous TrackComplete (or the tape start) through the
 * swap that emitted this TrackComplete. `trackNo` omitted = the latest completed track. `trackNo` one past the last
 * completed track = the unfinished track still playing at the end of the tape (no drop).
 */
export function selectTrack(entries: readonly TrackEntry[], trackNo?: number | null): TrackSelection {
  const ends: number[] = [];
  entries.forEach((e, i) => {
    if (e.trackComplete) ends.push(i);
  });
  if (trackNo == null) {
    if (ends.length === 0) throw new Error("no completed track on this timeline");
    trackNo = entries[ends.at(-1)!].trackComplete!.trackNo;
  }
  const at = ends.findIndex((i) => entries[i].trackComplete!.trackNo === trackNo);
  if (at >= 0) {
    const end = ends[at];
    const start = at > 0 ? ends[at - 1] + 1 : 0;
    return { trackNo, start, end, complete: true, seedIndex: start > 0 ? start - 1 : null, hookSwaps: entries[end].trackComplete!.swaps };
  }
  // The unfinished track after the last drop.
  const lastNo = ends.length ? entries[ends.at(-1)!].trackComplete!.trackNo : 0;
  const start = ends.length ? ends.at(-1)! + 1 : 0;
  if (trackNo === lastNo + 1 && start < entries.length) {
    return { trackNo, start, end: entries.length - 1, complete: false, seedIndex: start > 0 ? start - 1 : null };
  }
  const known = completedTracks(entries);
  throw new Error(`track ${trackNo} is not on this timeline (completed: ${known.length ? known.join(", ") : "none"})`);
}
