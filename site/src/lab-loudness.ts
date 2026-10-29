// The style lab's loudness (lab.ts): a style rendered offline the way the pack gate does (web/src/gate.ts): 20 s clips
// on the gate's three stretches of the imd-week tape, from bar 8 of the form, idle off, measured as the median of the
// loudest-3s RMS and the peak. MATCH LOUDNESS moves the style's trim toward the gate's -14.3 dBFS with it, so an export
// passes the gate's loudness check; the headless check uses it to measure the worst case the knobs can reach. One
// render per stretch (the gate also renders each twice for determinism; the lab does not need that).
import * as synth from "@swarm-sequencer/synth";
import type { StationPack } from "@swarm-sequencer/synth";

/** The gate's numbers (web/src/gate.ts GATE). */
export const TARGET_DB = -14.3;
export const TOLERANCE_DB = 1;
const CLIP_SEC = 20;
const BAR_OFFSET = 8;

type Row = { time: number; state: Record<string, unknown> & { pattern: string; bass: string; patternId: number }; held?: Row["state"]; whale?: boolean; isBuy?: boolean; track?: number };
let windows: Promise<Row[][]> | null = null;
/** The gate's tape stretches (92 KB), loaded the first time a style is measured. */
const tape = () => (windows ??= import("../../web/scripts/station-gate-windows.json").then((m) => (m.default as unknown as { windows: Row[][] }).windows));

const toState = (s: Row["state"]) => ({ ...s, pattern: BigInt(s.pattern), bass: BigInt(s.bass) });
/** A stretch as render points on epoch 0 of a one-genre program (gate.ts toPoints). */
function toPoints(rows: Row[]) {
  const pin = (s: ReturnType<typeof toState>) => ({ ...s, patternId: s.patternId % 4 });
  return rows.map((p) => ({
    time: p.time,
    state: pin(toState(p.state)),
    ...(p.whale ? { drop: { track: p.track, fill: p.isBuy } } : {}),
    ...(p.held ? { trackDrop: { held: pin(toState(p.held)) } } : {}),
  })) as unknown as Parameters<typeof synth.renderTimelineToBuffer>[0];
}

/** Loudest 3 s RMS of the left channel in 0.5 s hops, and the peak (gate.ts measure). */
export function measure(buf: AudioBuffer) {
  const sr = buf.sampleRate;
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  const ch0 = buf.getChannelData(0);
  const win = 3 * sr;
  let best = 0;
  for (let s = 0; s + win <= ch0.length; s += sr / 2) {
    let acc = 0;
    for (let i = s; i < s + win; i++) acc += ch0[i] * ch0[i];
    best = Math.max(best, acc / win);
  }
  return { loudDb: 10 * Math.log10(Math.max(best, 1e-12)), peakDb: 20 * Math.log10(Math.max(peak, 1e-12)) };
}

/** One clip of the style on stretch `i`, as the gate renders it. */
export async function renderClip(pack: StationPack, i = 0, seconds = CLIP_SEC, mutes: readonly synth.Part[] = [], formless = false): Promise<AudioBuffer> {
  const program = synth.programFromPack(pack);
  const genre = pack.genres[0];
  const rows = (await tape())[i];
  return synth.renderTimelineToBuffer(toPoints(rows), seconds, 44100, { eraId: genre, barOffset: BAR_OFFSET, program, mutes, formless });
}

/** The style's loudness as the gate would judge it: the median over the stretches, and the loudest peak. */
export async function loudness(pack: StationPack, stretches = 3): Promise<{ loudDb: number; peakDb: number }> {
  const rows: { loudDb: number; peakDb: number }[] = [];
  for (let i = 0; i < stretches; i++) rows.push(measure(await renderClip(pack, i)));
  const loud = rows.map((r) => r.loudDb).sort((a, b) => a - b);
  return { loudDb: loud[Math.floor(loud.length / 2)], peakDb: Math.max(...rows.map((r) => r.peakDb)) };
}
