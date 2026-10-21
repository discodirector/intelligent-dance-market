// v2 hook: a "track #N complete" post renders the run-up to the latest drop and a few bars of the new track.
import type { TimelineEntry, TimelineTrackComplete } from "./timeline.ts";

/** Swaps of the new track kept after the drop, so the video lands the drop and plays the fresh seed. */
export const AFTER_DROP = 24;

/** The window around the latest track complete: the finished track (bounded by `max`) plus AFTER_DROP swaps. */
export function trackWindow(entries: TimelineEntry[], max = 400): TimelineEntry[] {
  let at = -1;
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].trackComplete) { at = i; break; }
  if (at < 0) return entries;
  const swaps = entries[at].trackComplete!.swaps ?? max;
  return entries.slice(Math.max(0, at + 1 - Math.min(max, swaps)), at + 1 + AFTER_DROP);
}

/** Swaps kept around the latest whale movement: the groove before it and the rotated one after. */
export const MOVEMENT_BEFORE = 32;
export const MOVEMENT_AFTER = 24;

/** The window around the latest Movement (a whale rotated the root); the whole tape when there is none. */
export function movementWindow(entries: TimelineEntry[]): TimelineEntry[] {
  let at = -1;
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].movement) { at = i; break; }
  if (at < 0) return entries;
  return entries.slice(Math.max(0, at - MOVEMENT_BEFORE), at + 1 + MOVEMENT_AFTER);
}

export const trackSubtitle = (tc: TimelineTrackComplete) =>
  `TRACK #${tc.trackNo} COMPLETE${tc.swaps != null ? ` · ${tc.swaps} SWAPS` : ""}`;
