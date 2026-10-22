// The style pack gate's in-browser half (docs/STATIONS.md "Style pack"): every style of a pack rendered on 3 epochs of
// its genre in the station's program, measured and judged. One copy for both callers:
//   - web/scripts/station-check-pack.mjs (the swarm job and a checkout: Vite dev server, the pack's .ts module);
//   - web/gate.html (built into web/dist, the bot image): the pipeline's gate on a pack parsed as data
//     (bot/src/stations/gate.ts), with no TypeScript, git or Vite in the container.
// Per style: loudness = median loudest-3s RMS within ±1 dB of -14.3 dBFS (the house level); peak under -0.5 dBFS on
// every clip; no stretch under -50 dBFS (50 ms RMS) longer than 2 bars at the clip's slowest tempo; every clip renders
// twice to the same SHA-256. 20 s clips on three stretches of the imd-week tape (station-gate-windows.json), opening
// 10 s before a track drop. Idle stages off, as in the sketches.
import * as synth from "@swarm-sequencer/synth";

export const GATE = { TARGET_DB: -14.3, LOUD_TOL_DB: 1, PEAK_MAX_DB: -0.5, SILENCE_DB: -50, SILENCE_BARS: 2, CLIP_SEC: 20, BAR_OFFSET: 8, EPOCHS: 3 } as const;

export interface GateClip { epoch: number; key: number; peakDb: number; loudDb: number; silenceBars: number; deterministic: boolean; sha: string; wav?: string }
export interface GateRow {
  genre: string; style: string; name: string; base: string; clips: GateClip[];
  median: number; peak: number; silence: number; det: boolean;
  /** Names of the failed checks (clips, loud, peak, silence, det); empty = this style passes. */
  bad: string[];
}
export interface GateResult {
  /** validatePack problems (no render when there are any). */
  errors: string[];
  rows: GateRow[];
  /** One line per failure, for the report and a revision's notes. */
  failures: string[];
}

type Point = Parameters<typeof synth.planSteps>[0][number];
type WindowRow = { time: number; state: Record<string, unknown> & { pattern: string; bass: string; patternId: number }; held?: WindowRow["state"]; whale?: boolean; isBuy?: boolean; track?: number };

const toState = (s: WindowRow["state"]) => ({ ...s, pattern: BigInt(s.pattern), bass: BigInt(s.bass) });
function toPoints(rows: WindowRow[], epoch: number): Point[] {
  const pin = (s: ReturnType<typeof toState>) => ({ ...s, patternId: 4 * epoch + (s.patternId % 4) });
  return rows.map((p) => ({
    time: p.time,
    state: pin(toState(p.state)),
    ...(p.whale ? { drop: { track: p.track, fill: p.isBuy } } : {}),
    ...(p.held ? { trackDrop: { held: pin(toState(p.held)) } } : {}),
  })) as unknown as Point[];
}

async function sha(buf: AudioBuffer): Promise<string> {
  const parts: Uint8Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) parts.push(new Uint8Array(buf.getChannelData(ch).buffer.slice(0)));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) all.set(p, (at += p.length) - p.length);
  const digest = await crypto.subtle.digest("SHA-256", all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function measure(buf: AudioBuffer, slowestBpm: number) {
  const sr = buf.sampleRate;
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  // Loudest 3 s window (RMS) on the left channel, as genre-sketches.mjs / genre-variety.mjs.
  const ch0 = buf.getChannelData(0);
  const win = 3 * sr;
  let best = 0;
  for (let s = 0; s + win <= ch0.length; s += sr / 2) {
    let acc = 0;
    for (let i = s; i < s + win; i++) acc += ch0[i] * ch0[i];
    best = Math.max(best, acc / win);
  }
  // Longest near-silence: 50 ms RMS frames of the mid signal under SILENCE_DB.
  const l = buf.getChannelData(0), r = buf.getChannelData(Math.min(1, buf.numberOfChannels - 1));
  const frame = Math.round(sr * 0.05);
  const floor = 10 ** (GATE.SILENCE_DB / 10);
  let run = 0, longest = 0;
  for (let s = 0; s + frame <= l.length; s += frame) {
    let acc = 0;
    for (let i = s; i < s + frame; i++) {
      const m = (l[i] + r[i]) / 2;
      acc += m * m;
    }
    run = acc / frame < floor ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const barSec = 240 / slowestBpm;
  return { peakDb: 20 * Math.log10(Math.max(peak, 1e-12)), loudDb: 10 * Math.log10(Math.max(best, 1e-12)), silenceBars: (longest * 0.05) / barSec };
}

/**
 * Renders and judges a pack (an object: the .ts module's default export, or a pack parsed as data). `wav`: return
 * each clip as base64 WAV (the checkout writes them for listening; the pipeline does not need them).
 */
export async function gatePack(pack: unknown, windows: WindowRow[][], opts: { wav?: boolean } = {}): Promise<GateResult> {
  const errors = synth.validatePack(pack);
  if (errors.length) return { errors, rows: [], failures: errors.map((e) => `pack: ${e}`) };
  const p = pack as synth.StationPack;
  const program = synth.programFromPack(p);
  const rows: GateRow[] = [];
  for (const genre of p.genres) {
    const era = synth.eraById(genre);
    for (const style of p.styles[genre] as readonly { id: string; name: string; base: string }[]) {
      const epochs: number[] = [];
      for (let e = 0; e < 100000 && epochs.length < GATE.EPOCHS; e++) {
        if (synth.eraOf(e, program).id === genre && synth.styleOf(era, e, program).style.id === style.id) epochs.push(e);
      }
      const clips: GateClip[] = [];
      for (const [i, epoch] of epochs.entries()) {
        const points = toPoints(windows[i % windows.length], epoch);
        const options = { eraId: genre, barOffset: GATE.BAR_OFFSET, program };
        const tempos = synth.planSteps(points, GATE.CLIP_SEC, genre, GATE.BAR_OFFSET, program).map((h) => h.tempo);
        const a = await synth.renderTimelineToBuffer(points, GATE.CLIP_SEC, 44100, options);
        const b = await synth.renderTimelineToBuffer(points, GATE.CLIP_SEC, 44100, options);
        const [ha, hb] = [await sha(a), await sha(b)];
        clips.push({
          epoch, key: synth.genreKey(era, epoch), ...measure(a, Math.min(...tempos)), deterministic: ha === hb, sha: ha.slice(0, 12),
          ...(opts.wav ? { wav: synth.audioBufferToWavBase64(a) } : {}),
        });
      }
      const loud = clips.map((c) => c.loudDb).sort((x, y) => x - y);
      const median = loud[Math.floor(loud.length / 2)] ?? -Infinity;
      const peak = Math.max(...clips.map((c) => c.peakDb));
      const silence = Math.max(...clips.map((c) => c.silenceBars));
      const det = clips.every((c) => c.deterministic);
      const checks = {
        clips: clips.length === GATE.EPOCHS,
        loud: Math.abs(median - GATE.TARGET_DB) <= GATE.LOUD_TOL_DB,
        peak: peak <= GATE.PEAK_MAX_DB,
        silence: silence <= GATE.SILENCE_BARS,
        det,
      };
      const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
      rows.push({ genre, style: style.id, name: style.name, base: style.base, clips, median, peak, silence, det, bad });
    }
  }
  const failures = rows.filter((r) => r.bad.length).map((r) => {
    const why = r.bad.map((b) =>
      b === "loud" ? `loudest-3s median ${r.median.toFixed(2)} dBFS, target ${GATE.TARGET_DB} ±${GATE.LOUD_TOL_DB} (change the style's trim by ${(GATE.TARGET_DB - r.median).toFixed(2)} dB)`
      : b === "peak" ? `peak ${r.peak.toFixed(2)} dBFS over ${GATE.PEAK_MAX_DB}`
      : b === "silence" ? `silence ${r.silence.toFixed(2)} bars over ${GATE.SILENCE_BARS}`
      : b === "det" ? "renders differ between two runs (not deterministic)"
      : `only ${r.clips.length} of ${GATE.EPOCHS} epochs found in the program`);
    return `${r.genre}/${r.style}: ${why.join("; ")}`;
  });
  return { errors: [], rows, failures };
}
