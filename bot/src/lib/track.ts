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

export const trackSubtitle = (tc: TimelineTrackComplete) =>
  `TRACK #${tc.trackNo} COMPLETE${tc.swaps != null ? ` · ${tc.swaps} SWAPS` : ""}`;
