// Track releases (SPEC §4.6): selection is shared with web/render.html; this file adds the bot's side
// (levels of the rendered WAV, output names).
import { selectTrack as select } from "../../../web/src/trackSelect.ts";
import { decodeFor } from "./hookRules.ts";
import type { TimelineEntry } from "./timeline.ts";

export { completedTracks, selectTrack, type TrackEntry, type TrackSelection } from "../../../web/src/trackSelect.ts";

export interface WavLevels {
  seconds: number;
  sampleRate: number;
  /** Highest absolute sample over both channels, dBFS. */
  peakDb: number;
  /** RMS of the whole file, channel 0, dBFS. */
  rmsDb: number;
  /** Loudest 3 s window (RMS, channel 0, 0.5 s hop), as web/scripts/genre-sketches.mjs measures genres. */
  loudest3sDb: number;
}

const db = (x: number) => (x <= 1e-12 ? -120 : 20 * Math.log10(x));

/** Levels of a 16-bit PCM WAV (the synth's audioBufferToWavBase64 output). */
export function wavLevels(wav: Buffer): WavLevels {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV");
  let off = 12;
  let channels = 2, sampleRate = 44100, bits = 16, data = -1, size = 0;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const len = wav.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = wav.readUInt16LE(off + 10);
      sampleRate = wav.readUInt32LE(off + 12);
      bits = wav.readUInt16LE(off + 22);
    } else if (id === "data") {
      data = off + 8;
      size = Math.min(len, wav.length - data);
      break;
    }
    off += 8 + len + (len & 1);
  }
  if (data < 0 || bits !== 16) throw new Error("expected 16-bit PCM data");
  const frames = Math.floor(size / (2 * channels));
  let peak = 0;
  const ch0 = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = wav.readInt16LE(data + (i * channels + c) * 2) / 32768;
      if (Math.abs(v) > peak) peak = Math.abs(v);
      if (c === 0) ch0[i] = v;
    }
  }
  let sum = 0;
  for (let i = 0; i < frames; i++) sum += ch0[i] * ch0[i];
  const win = 3 * sampleRate;
  const hop = sampleRate / 2;
  // Running sum over a 3 s window.
  const sq = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) sq[i + 1] = sq[i] + ch0[i] * ch0[i];
  let best = 0;
  for (let s = 0; s + win <= frames; s += hop) best = Math.max(best, (sq[s + win] - sq[s]) / win);
  if (frames < win && frames > 0) best = sum / frames;
  return { seconds: frames / sampleRate, sampleRate, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, frames))), loudest3sDb: db(Math.sqrt(best)) };
}

/** X's video length limit for ordinary accounts (seconds). Override with X_VIDEO_MAX_SECONDS. */
export const X_VIDEO_MAX_SECONDS = 140;

/**
 * The part of a release that fits a post: the whole release when it fits, else the last `max` seconds, which is the
 * climb into the drop plus the outro (the drop always lands inside the cut). Null = post the whole release.
 */
export function postCut(seconds: number, dropTime: number | null, max = X_VIDEO_MAX_SECONDS): { start: number; seconds: number } | null {
  if (!(seconds > max)) return null;
  // Keep the drop at least a quarter of the clip in, even when the outro is unusually long.
  const end = dropTime != null ? Math.min(seconds, dropTime + max * 0.75) : seconds;
  const start = Math.max(0, end - max);
  return { start: Math.round(start * 1000) / 1000, seconds: Math.round((end - start) * 1000) / 1000 };
}

/** `TRACK #N COMPLETE · K SWAPS · Genre / Style` */
export const releaseHeadline = (trackNo: number, swaps: number, genre: string, style: string) =>
  `TRACK #${trackNo} COMPLETE · ${swaps} SWAPS · ${genre} / ${style}`;

/** True when the selected track starts inside `entries`: after a TrackComplete, or at the hook's first swap. */
export function trackStartKnown(entries: readonly TimelineEntry[], trackNo?: number | null): boolean {
  const sel = select(entries, trackNo);
  const first = entries[sel.start];
  if (sel.seedIndex != null) return true;
  return first != null && (first.state?.swapCount ?? decodeFor(first.slot0, first.slot1, "v2").swapCount) === 1;
}

/**
 * Live: the latest completed track usually started before the scheduler's context window. Pull earlier blocks
 * (`fetchEarlier(beforeBlock)` returns the entries just before it, oldest first, [] when there are none) until the
 * track's start is on the tape. `partial` = gave up: the release starts at the oldest swap it could read.
 */
export async function withTrackStart(
  entries: TimelineEntry[],
  fetchEarlier: (beforeBlock: number) => Promise<TimelineEntry[]>,
  maxSteps = 12,
): Promise<{ entries: TimelineEntry[]; partial: boolean }> {
  let tape = entries;
  for (let i = 0; i < maxSteps; i++) {
    if (trackStartKnown(tape)) return { entries: tape, partial: false };
    const earlier = await fetchEarlier(tape[0].blockNumber);
    if (earlier.length === 0) break;
    tape = [...earlier, ...tape];
  }
  return { entries: tape, partial: !trackStartKnown(tape) };
}
