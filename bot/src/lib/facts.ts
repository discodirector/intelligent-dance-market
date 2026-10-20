// Strict facts object: the only source of truth a caption may use.
import { MODE_NAMES, NOTE_NAMES, TRACK_NAMES } from "@swarm-sequencer/core";
import { epochOf, eraOf } from "@swarm-sequencer/synth";
import type { TimelineEntry } from "./timeline.ts";

export interface Facts {
  kind: "teaser" | "snapshot" | "movement" | "track";
  project: string;
  chain: string;
  pool: string;
  window: { from: string; to: string; hours: number; days: number };
  sequencer: { steps: 16; tracks: 4 };
  swaps: number;
  buys: number;
  sells: number;
  whales: number;
  movements: number;
  pageTurns: number;
  busiestTrack: string;
  bpm: { start: number; end: number; min: number; max: number };
  key: { start: string; end: string };
  swapCount: number;
  page: number;
  /** Genre the synth plays for the last state (epoch = page / 4): what the video ends in. Style names stay internal. */
  playing: string;
  videoSeconds?: number;
  hook?: string;
  /** Hook rules the state follows; absent = v1. */
  rules?: "v2";
  /** v2: tracks finished in the window, and the latest one (kind "track" posts about it). */
  tracksCompleted?: number;
  track?: { no: number; swaps?: number; swapCount: number; page: number; key: string };
  /** Buys in the window made by the pulse treasury (included in swaps/buys); absent when none. */
  pulses?: number;
  /** Track posts with a release video (SPEC §4.6): `TRACK #N COMPLETE · K SWAPS · Genre / Style`. */
  headline?: string;
  /** The release the video comes from. `clip` set = the video is its last `clip.seconds`, ending past the drop. */
  release?: ReleaseFacts;
}

export interface ReleaseFacts {
  seconds: number;
  bars: number;
  swaps: number;
  swapsPerBar: number;
  /** The genre the release plays from start to end: where the track finished (SPEC §4.6). */
  genre: string;
  /** Genres the chain passed through while the track was built, in order (context only; the release is one genre). */
  chainGenres: string[];
  clip: { from: number; seconds: number } | null;
  /** The start of the track was not on the tape: the release begins at the oldest swap read. */
  partial?: boolean;
}

const key = (root: number, mode: number) => `${NOTE_NAMES[root % 12]} ${MODE_NAMES[mode] ?? "?"}`;
const playingAt = (patternId: number) => eraOf(epochOf({ patternId })).name;
const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(/\.\d+Z$/, "Z");

export function factsFromTimeline(
  entries: TimelineEntry[],
  o: { kind: Facts["kind"]; chain: string; pool: string; project?: string; videoSeconds?: number; hook?: string; startPage?: number; windowHours?: number },
): Facts {
  if (!entries.length) throw new Error("no entries");
  const first = entries[0], last = entries.at(-1)!;
  const counts = [0, 0, 0, 0];
  for (const e of entries) counts[e.track]++;
  const bpms = entries.map((e) => e.state.bpm);
  const done = entries.filter((e) => e.trackComplete);
  const tc = done.at(-1)?.trackComplete;
  const v2 = entries.some((e) => e.rules === "v2");
  const pulses = entries.filter((e) => e.pulse).length;
  return {
    kind: o.kind,
    project: o.project ?? "Intelligent Dance Market",
    chain: o.chain,
    pool: o.pool,
    // A requested window (teasers: "the last 24 h") is reported as asked, not as first-to-last swap, which reads 23 h.
    window: o.windowHours
      ? { from: iso(last.ts - o.windowHours * 3600), to: iso(last.ts), hours: o.windowHours, days: Math.round(o.windowHours / 24) }
      : { from: iso(first.ts), to: iso(last.ts), hours: Math.round((last.ts - first.ts) / 3600), days: Math.round((last.ts - first.ts) / 86400) },
    sequencer: { steps: 16, tracks: 4 },
    swaps: entries.length,
    buys: entries.filter((e) => e.isBuy).length,
    sells: entries.filter((e) => !e.isBuy).length,
    whales: entries.filter((e) => e.whale).length,
    movements: entries.filter((e) => e.movement).length,
    pageTurns: last.state.patternId - (o.startPage ?? 0),
    busiestTrack: TRACK_NAMES[counts.indexOf(Math.max(...counts))],
    bpm: { start: first.state.bpm, end: last.state.bpm, min: Math.min(...bpms), max: Math.max(...bpms) },
    key: { start: key(first.state.root, first.state.mode), end: key(last.state.root, last.state.mode) },
    swapCount: last.state.swapCount,
    page: last.state.patternId,
    playing: playingAt(last.state.patternId),
    videoSeconds: o.videoSeconds,
    hook: o.hook,
    ...(v2 ? { rules: "v2" as const, tracksCompleted: done.length } : {}),
    ...(pulses ? { pulses } : {}),
    ...(tc ? { track: { no: tc.trackNo, swaps: tc.swaps, swapCount: tc.swapCount, page: tc.patternId, key: key(tc.root, done.at(-1)!.state.mode) } } : {}),
  };
}
