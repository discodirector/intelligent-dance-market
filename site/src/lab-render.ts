// A take rendered offline (lab.ts RENDER): the whole take with its automation and its trades, deterministic (the same
// take gives the same WAV). The engine plays one style per render (a program is fixed for a render, and a genre reads
// its mix and effects once at its start), so the take is cut where its style changes, at bar resolution: each run of
// bars with one style is its own render (renderTimelineToBuffer, as the gate renders), started two bars early (four for
// Ambient IDM, whose pads hold a whole chord) so its voices, echo and room are already sounding, and the runs are
// stitched on their downbeats with a 12 ms crossfade. Trades land on their steps: TakeRun steps the take exactly as
// live playback does, and each trade becomes a timeline point at the grid time the engine's own planSteps gives that
// step. Live moves inside a bar are heard from the bar's start (the live player hears them on their step). The parts
// switched on and off and the auto market's switch (off: manual mode, no song form) cut runs as a style does: heard
// from the downbeat after the press, as live.
import * as synth from "@swarm-sequencer/synth";
import { buildStyle, engineOf, mutedParts, packOf, type Recipe } from "./lab-styles";
import type { TradeResult } from "./lab-market";
import { TakeRun, type Take } from "./lab-take";

const RATE = 44100;
const XFADE = 0.012;
/** Seconds per step that bound any genre's slowest tempo (planSteps' horizon). */
const STEP_MAX = 0.6;

type Point = Parameters<typeof synth.planSteps>[0][number];

/** The take stepped through: per step the state the player plays and the trades on it; per bar the recipe at its start. */
function simulate(base: Recipe, take: Take, steps: number) {
  const run = new TakeRun(base, take);
  const states: synth.SequencerState[] = [];
  const trades: TradeResult[][] = [];
  const recipes: Recipe[] = [];
  const autos: boolean[] = [];
  for (let k = 0; k < steps; k++) {
    trades.push(run.advance(k).trades);
    states.push(run.market.synth);
    if (k % 16 === 0) {
      recipes.push(JSON.parse(JSON.stringify(run.recipe)) as Recipe);
      autos.push(run.auto);
    }
  }
  // The song-form bar of each bar: from the take's first, a finished track lands on the next downbeat as bar 16.
  const forms: number[] = [];
  const lands = new Set<number>();
  trades.forEach((ts, k) => ts.some((t) => t.held) && lands.add(Math.ceil(k / 16)));
  let bar = take.bar;
  for (let i = 0; i < steps / 16; i++) {
    if (lands.has(i)) bar = 16;
    forms.push(bar);
    bar = (bar + 1) % 32;
  }
  return { states, trades, recipes, autos, forms };
}

/** One run of bars with one style, rendered with its preroll and a bar of tail; where its bars sit in it. */
async function renderRun(sim: ReturnType<typeof simulate>, pack: synth.StationPack, mutes: synth.Part[], formless: boolean, a: number, b: number, pre: number) {
  const program = synth.programFromPack(pack);
  const genre = pack.genres[0];
  const s0 = (a - pre) * 16;
  const sEnd = Math.min(sim.states.length, (b + 1) * 16);
  const barOffset = sim.forms[a - pre];
  const plan = (points: Point[], upTo: number) => synth.planSteps(points, (upTo - s0 + 2) * STEP_MAX, genre, barOffset, program);
  const point = (time: number, r: { state: synth.SequencerState } & Partial<TradeResult>): Point =>
    ({ time, state: r.state, ...(r.drop ? { drop: r.drop } : {}), ...(r.held ? { trackDrop: { held: r.held } } : {}) }) as Point;
  const points: Point[] = [point(0, { state: sim.states[s0] })];
  for (const r of sim.trades[s0]) if (r.drop || r.held) points.push(point(0, { ...r, state: sim.states[s0] }));
  for (let k = s0 + 1; k < sEnd; k++) {
    if (!sim.trades[k].length) continue;
    const t = plan(points, k)[k - s0].gridTime;
    for (const r of sim.trades[k]) points.push(point(t, r));
  }
  const hits = plan(points, sEnd);
  const at = (k: number) => hits[k - s0].gridTime;
  const last = hits[sEnd - s0 - 1];
  const seconds = last.gridTime + last.duration;
  const buf = await synth.renderTimelineToBuffer(points, seconds, RATE, { eraId: genre, barOffset, program, mutes, formless });
  return { buf, from: at(a * 16), to: b * 16 < sEnd ? at(b * 16) : seconds };
}

/** The whole take as one buffer: its runs of bars stitched on their downbeats. `progress` 0..1 as runs finish. */
export async function renderTake(base: Recipe, take: Take, progress?: (done: number) => void): Promise<AudioBuffer> {
  const bars = take.bars;
  const sim = simulate(base, take, (bars + 1) * 16);
  const styles = sim.recipes.slice(0, bars).map((r, i) => JSON.stringify([packOf(buildStyle(r)), mutedParts(r), !sim.autos[i]]));
  const runs: [number, number][] = [];
  styles.forEach((s, i) => (i > 0 && s === styles[i - 1] ? (runs[runs.length - 1][1] = i + 1) : runs.push([i, i + 1])));
  const preroll = engineOf(base.genre) === "ambientidm" ? 4 : 2;
  const parts: { buf: AudioBuffer; from: number; to: number }[] = [];
  for (const [i, [a, b]] of runs.entries()) {
    const [pack, mutes, formless] = JSON.parse(styles[a]) as [synth.StationPack, synth.Part[], boolean];
    parts.push(await renderRun(sim, pack, mutes, formless, a, b, Math.min(a, preroll)));
    progress?.((i + 1) / runs.length);
  }
  // Stitch: each run from its first downbeat to its last (the final one to its end), crossfaded at the joins.
  const xf = Math.round(XFADE * RATE);
  const spans = parts.map((p, i) => {
    const from = Math.round(p.from * RATE);
    const to = i === parts.length - 1 ? p.buf.length : Math.round(p.to * RATE);
    return { ...p, from, to };
  });
  const length = spans.reduce((n, s) => n + (s.to - s.from), 0);
  const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: RATE });
  let at = 0;
  spans.forEach((s, i) => {
    const end = i === spans.length - 1 ? s.to : Math.min(s.buf.length, s.to + xf);
    for (let ch = 0; ch < 2; ch++) {
      const src = s.buf.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let j = s.from; j < end && at + (j - s.from) < length; j++) {
        let g = 1;
        if (i > 0 && j - s.from < xf) g = (j - s.from) / xf;
        if (j >= s.to) g = 1 - (j - s.to) / xf;
        dst[at + (j - s.from)] += src[j] * g;
      }
    }
    at += s.to - s.from;
  });
  return out;
}
