// Release mode of render.html (web/RENDER.md, SPEC §4.6): one finished track from its timeline entries,
// one swap per bar by default, rendered offline. Selection lives in trackSelect.ts (shared with the bot).
import {
  decode,
  epochOf,
  eraOf,
  initialState,
  planRelease,
  RELEASE_HEAT_MAX,
  styleOf,
  SYNTH_VERSION,
  type ReleaseOptions,
  type ReleasePlan,
  type ReleaseSwap,
  type SequencerState,
} from "@swarm-sequencer/synth";
import { normalizeTimeline, type RawTimelineEvent } from "./timeline";
import { selectTrack, type TrackEntry, type TrackSelection } from "./trackSelect";

export type ReleaseEntry = RawTimelineEvent & TrackEntry & { ts?: number; blockNumber?: number; txHash?: string };

export interface ReleaseRequest extends ReleaseOptions {
  /** trackNo of a TrackComplete (default: the latest completed track). */
  track?: number | null;
  /** Packed state before the tape's first entry (bot timeline.meta.json `initial`), for a track that starts the tape. */
  initial?: { slot0: string; slot1: string } | null;
}

export interface BuiltRelease {
  selection: TrackSelection;
  entries: ReleaseEntry[];
  seed: SequencerState;
  next: SequencerState | null;
  plan: ReleasePlan;
  /** Per swap: the entry it came from. */
  swaps: ReleaseSwap[];
}

const dec = (slot0: RawTimelineEvent["slot0"], slot1: RawTimelineEvent["slot1"]) => decode(slot0, slot1, { heatMax: RELEASE_HEAT_MAX });

export function buildRelease(raw: readonly ReleaseEntry[], req: ReleaseRequest = {}): BuiltRelease {
  const selection = selectTrack(raw, req.track);
  const entries = raw.slice(selection.start, selection.end + 1);
  // Drop cues and flashes exactly as replay reads them; packed slots are re-decoded with heat.
  const pts = normalizeTimeline(entries);
  const cues = pts.length === entries.length ? pts : null;
  const swaps: ReleaseSwap[] = entries.map((e, i) => {
    const finished = selection.complete && i === entries.length - 1 && e.trackComplete;
    return {
      state: finished ? dec(finished.slot0, finished.slot1) : dec(e.slot0, e.slot1),
      ...(cues?.[i].drop ? { drop: cues[i].drop } : {}),
      ...(cues?.[i].flash ? { flash: cues[i].flash } : {}),
    };
  });
  let seed: SequencerState;
  if (selection.seedIndex != null) seed = dec(raw[selection.seedIndex].slot0, raw[selection.seedIndex].slot1);
  else if (req.initial) seed = dec(req.initial.slot0, req.initial.slot1);
  else seed = { ...initialState(), heat: 0, trackNo: 0 };
  const last = entries.at(-1)!;
  const next = selection.complete ? dec(last.slot0, last.slot1) : null;
  const plan = planRelease({ seed, swaps, ...(next ? { next } : {}) }, req);
  return { selection, entries, seed, next, plan, swaps };
}

/** Metadata the bot writes next to the WAV. */
export function releaseSummary(r: BuiltRelease) {
  const first = r.entries[0];
  const last = r.entries.at(-1)!;
  const genre = (s: SequencerState) => {
    const epoch = epochOf(s);
    const era = eraOf(epoch);
    const style = styleOf(era, epoch).style;
    return { epoch, era: era.id, eraName: era.name, style: style.id, styleName: style.name };
  };
  const finished = r.swaps.at(-1)?.state ?? r.seed;
  const epochs = [...new Set([r.seed, ...r.swaps.map((s) => s.state)].map((s) => epochOf(s)))];
  // Live genres of the epochs the track passed through, in order (context only: the release plays r.plan.genre).
  const chainGenres = epochs.map((epoch) => {
    const era = eraOf(epoch);
    return { epoch, era: era.id, eraName: era.name };
  });
  return {
    trackNo: r.selection.trackNo,
    complete: r.selection.complete,
    swaps: r.entries.length,
    hookSwaps: r.selection.hookSwaps ?? null,
    bars: r.plan.bars,
    introBars: r.plan.introBars,
    bodyBars: r.plan.bodyBars,
    outroBars: r.plan.outroBars,
    seconds: r.plan.seconds,
    dropBar: r.plan.dropBar,
    dropTime: r.plan.dropTime,
    fadeAt: r.plan.fadeAt,
    saturationBar: r.plan.saturationBar,
    swapsPerBar: r.plan.pace.swapsPerBar,
    paceTempo: r.plan.pace.tempo,
    /** The one genre and style the whole release plays: the epoch the track finished in (SPEC §4.6). */
    genre: r.plan.genre,
    /** The synth that rendered it: package version and the commit the page was built from. */
    synth: { version: SYNTH_VERSION, build: typeof __IDM_BUILD__ !== "undefined" ? __IDM_BUILD__ : null },
    seed: { ...genre(r.seed), pattern: "0x" + r.seed.pattern.toString(16), patternId: r.seed.patternId, root: r.seed.root },
    /** Live genre and style of the track's last swap, before the drop (equals `genre`). */
    finished: genre(finished),
    next: r.next ? { ...genre(r.next), pattern: "0x" + r.next.pattern.toString(16), patternId: r.next.patternId, root: r.next.root } : null,
    epochs,
    epochChanges: epochs.length - 1,
    chainGenres,
    sections: r.plan.sections.map((s) => ({ ...s, time: Math.round(s.time * 1000) / 1000 })),
    first: { index: r.selection.start, ts: first.ts ?? first.timestamp ?? null, blockNumber: first.blockNumber ?? null, txHash: first.txHash ?? null },
    last: { index: r.selection.end, ts: last.ts ?? last.timestamp ?? null, blockNumber: last.blockNumber ?? null, txHash: last.txHash ?? null },
  };
}

export type ReleaseSummary = ReturnType<typeof releaseSummary>;

/** The section a release bar belongs to. */
export function sectionOfBar(plan: ReleasePlan, bar: number) {
  return plan.sections.find((s) => bar >= s.from && bar < s.to) ?? plan.sections.at(-1)!;
}

/** Release bar at grid second `t`. */
export function barAt(plan: ReleasePlan, t: number): number {
  let lo = 0;
  let hi = plan.bars - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (plan.hits[mid * 16].gridTime <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
