// Track release (SPEC §4.6): one finished v2 track, from its seed to its TrackComplete, played at a fixed musical
// pace instead of the wall clock. Pure planning: no Web Audio here (player.ts renders the plan).
//
// Layout in bars:  intro (seed) · body (one swap per bar by default) · drop bar + outro (new seed, fades out).
// The live 32-bar form is a loop; a release maps each of its bars onto a bar of that form (`formBar`) and keeps a
// monotonic bar counter that is congruent to it mod 32, so arrange() and the engines run unchanged.
// Genre: a release plays ONE genre instance from start to end (releaseGenre): the genre, style and tonic of the epoch
// the track finished in. Live playback follows the epochs; a release does not.
import { FORM_BARS, sectionAt, type SectionName } from "./arrange.ts";
import { CueQueue, genreStep, stepCharacter, type DropCue, type LockCue, type OverprintCue, type PageCue, type SaleCue, type StepHit } from "./clock.ts";
import { epochOf, eraOf, type GenreId } from "./eras.ts";
import { HOUSE_PROGRAM, type Program } from "./program.ts";
import type { SequencerState } from "./state.ts";
import { styleOf } from "./styles.ts";

export interface ReleaseSwap {
  /** State after the swap. For the swap that finished the track: the finished track (heat at max), before the reset. */
  state: SequencerState;
  /** Whale drop cue, as on a timeline point. */
  drop?: DropCue;
  /** Visual only. */
  flash?: { track: number; step: number; bass?: boolean; row?: boolean };
  /**
   * NFT stations (core nft.ts tags, as on a timeline point): a rated sale, a withdraw, a page sale, an overprint. They
   * land as live playback lands them (CueQueue: the next 8th, downbeat or beat from the step the swap lands on).
   */
  sale?: SaleCue;
  lock?: LockCue;
  page?: PageCue;
  overprint?: OverprintCue;
}

export interface ReleaseInput {
  /** The state the track starts from: the seed after the previous drop (or the start of the tape). */
  seed: SequencerState;
  /** The track's swaps in order; the last one finished it when `next` is set. */
  swaps: readonly ReleaseSwap[];
  /** The new seed after the TrackComplete. Absent: the track is not finished; no drop, the outro holds the last state. */
  next?: SequencerState;
}

export interface ReleaseOptions {
  /** Pace: swaps per bar (default 1). Raised automatically when the body would exceed `maxSeconds`. */
  swapsPerBar?: number;
  /** Upper bound of the whole release (default 360 s). */
  maxSeconds?: number;
  /** Lower bound (default 180 s). Short tracks hold each state for whole bars. */
  minSeconds?: number;
  /** Intro bars on the seed (default 8, multiple of 4). */
  introBars?: number;
  /** Drop bar + outro on the new seed (default 8, multiple of 4). The last half fades out. */
  outroBars?: number;
  /** Tempo used for the length bounds. Default: the median genre tempo of the track's states. */
  tempo?: number;
  /** What the release plays (program.ts): the genre and style of its instance, and every step's feel. Default house. */
  program?: Program;
}

export interface ReleasePace {
  /** Steps (16ths) between consecutive swaps; fractional when several swaps share a bar. */
  slotSteps: number;
  /** Body bars (multiple of 4, at least 8). */
  bodyBars: number;
  /** Body step at which each swap takes effect. */
  swapSteps: number[];
  /** Effective pace over the steps the swaps use. */
  swapsPerBar: number;
  /** Tempo the bounds were computed with. */
  tempo: number;
}

export interface ReleaseSection {
  name: SectionName | "outro";
  /** Release bar range [from, to). */
  from: number;
  to: number;
  /** Grid seconds of `from`. */
  time: number;
}

/** The genre instance a release plays from start to end. */
export interface ReleaseGenre {
  /** Epoch of the finished track's state (TrackComplete slot0/slot1, before the reset); unfinished: the last swap. */
  epoch: number;
  era: GenreId;
  eraName: string;
  style: string;
  styleName: string;
}

export interface ReleasePlan {
  hits: StepHit[];
  /** Grid seconds of the end of the last bar: the exact WAV length. */
  seconds: number;
  bars: number;
  introBars: number;
  bodyBars: number;
  outroBars: number;
  /** Release bar of the drop (the downbeat after the track's body), or null for an unfinished track. */
  dropBar: number | null;
  dropTime: number | null;
  /** The output fades to silence from here to `seconds`. */
  fadeAt: number;
  pace: ReleasePace;
  /** Grid seconds at which each swap takes effect. */
  swapTimes: number[];
  /** Song-form bar (0..31) of each release bar. */
  formBars: number[];
  sections: ReleaseSection[];
  /** The one genre, style and instance epoch the whole release plays. */
  genre: ReleaseGenre;
  /** The program the plan was made with; renderReleaseToBuffer renders with the same one. */
  program: Program;
  /** Release bar of the first state with a saturated grid (heat starts), or null. */
  saturationBar: number | null;
}

export const RELEASE_DEFAULTS = { swapsPerBar: 1, maxSeconds: 360, minSeconds: 180, introBars: 8, outroBars: 8 } as const;

/** v2 heatMax (core DEFAULT_DROP_RULES.heatMax): decode release states with `{ heatMax: RELEASE_HEAT_MAX }`. */
export const RELEASE_HEAT_MAX = 16;

/** Bits a v2 grid needs before buys heat it (core DEFAULT_DROP_RULES.satBits). */
export const RELEASE_SAT_BITS = 44;

const up4 = (x: number) => Math.ceil(x / 4) * 4;
const down4 = (x: number) => Math.floor(x / 4) * 4;
const bars4 = (x: number | undefined, def: number) => Math.max(4, up4(x != null && Number.isFinite(x) ? x : def));

function popcount64(x: bigint): number {
  let n = 0;
  for (let v = BigInt.asUintN(64, x); v; v &= v - 1n) n++;
  return n;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 120;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * The genre instance of a release: the epoch of the state that finished the track (the last swap, which for a
 * finished track holds TrackComplete's snapshot before the reset), else the seed. Its genre is that epoch's genre and
 * its style the one that epoch played live, so the release sounds like the track did when it completed.
 */
export function releaseGenre(input: Pick<ReleaseInput, "seed" | "swaps">, program: Program = HOUSE_PROGRAM): ReleaseGenre {
  const finished = input.swaps.at(-1)?.state ?? input.seed;
  const epoch = epochOf(finished);
  const era = eraOf(epoch, program);
  const style = styleOf(era, epoch, program).style;
  return { epoch, era: era.id, eraName: era.name, style: style.id, styleName: style.name };
}

/** Median genre tempo of the states a release plays (in the release's genre, when given). */
export function releaseTempo(states: readonly SequencerState[], genre?: Pick<ReleaseGenre, "era" | "epoch">, program: Program = HOUSE_PROGRAM): number {
  return median(states.map((s) => genreStep(s, genre?.era, genre?.epoch, program).tempo));
}

/**
 * Pacing math. `swaps` swaps, one per bar by default (`swapsPerBar`), each on a downbeat. If that would make the
 * release longer than `maxSeconds` at `tempo`, the swaps are spread evenly over the longest body that fits
 * (several per bar). If it is shorter than `minSeconds`, each swap holds for whole bars (or, when that would leave
 * the last state holding for more than 8 bars, for an even number of beats). The body is a multiple of 4 bars; the last swap lands in its last stretch.
 */
export function releasePace(swaps: number, tempo: number, options: ReleaseOptions = {}): ReleasePace {
  const o = { ...RELEASE_DEFAULTS, ...options };
  const intro = bars4(o.introBars, RELEASE_DEFAULTS.introBars);
  const outro = bars4(o.outroBars, RELEASE_DEFAULTS.outroBars);
  const t = tempo > 0 && Number.isFinite(tempo) ? tempo : 120;
  const barSec = 240 / t;
  const maxBody = Math.max(8, down4(Math.floor(o.maxSeconds / barSec) - intro - outro));
  const minBody = Math.min(maxBody, Math.max(8, up4(Math.ceil(o.minSeconds / barSec) - intro - outro)));
  const n = Math.max(0, Math.floor(swaps));
  const spb = o.swapsPerBar > 0 && Number.isFinite(o.swapsPerBar) ? o.swapsPerBar : 1;
  let slot = 16 / spb;
  if (n > 0 && n * slot > maxBody * 16) slot = (maxBody * 16) / n;
  else if (n > 0 && n * slot < minBody * 16) {
    // Whole bars per swap when that leaves at most 8 bars for the last state to hold, else an even spread on beats.
    const k = Math.floor(minBody / n);
    slot = Math.max(slot, k >= 1 && minBody - k * n <= 8 ? 16 * k : 4 * Math.floor((minBody * 4) / n));
  }
  const swapSteps = Array.from({ length: n }, (_, k) => Math.floor(k * slot + 1e-9));
  const used = n > 0 ? swapSteps[n - 1] + Math.max(1, Math.min(16, Math.round(slot))) : 0;
  const bodyBars = Math.min(maxBody, Math.max(minBody, up4(Math.ceil(used / 16))));
  return { slotSteps: slot, bodyBars, swapSteps, swapsPerBar: n > 0 ? (16 * n) / Math.max(16, n * slot) : 0, tempo: t };
}

/** Form bars 8..15 (or 12..15), the build. */
const BUILD = (len: number) => Array.from({ length: len }, (_, i) => 16 - len + i);
const FULL8 = [16, 17, 18, 19, 20, 21, 22, 23];
const BREAK4 = [24, 25, 26, 27];
const REBUILD4 = [28, 29, 30, 31];

/**
 * The release arc over the body (bars relative to the body start; `sat` = first saturated bar or null):
 * build → full while the grid fills → a breakdown and rebuild when the grid saturates (heat starts) → full with the
 * heat effects → the rebuild's four bars (half-time, then the roll on 31) right before the drop. A long run of full
 * takes a 4-bar breakdown every 48 bars so it keeps breathing.
 */
export function releaseBodyForm(bodyBars: number, sat: number | null): number[] {
  const B = Math.max(8, up4(bodyBars));
  const build = B >= 24 ? 8 : 4;
  const tail = REBUILD4;
  const out: number[] = BUILD(build);
  const middle = B - build - tail.length;
  // The saturation break waits for at least 8 bars of full.
  const breakAt = sat != null ? Math.max(8, down4(sat) - build) : null;
  let broke = breakAt == null;
  let sinceBreak = 0;
  while (out.length < build + middle) {
    const at = out.length - build;
    const left = middle - at;
    if (!broke && at >= breakAt!) {
      broke = true;
      if (left >= 16) {
        out.push(...BREAK4, ...REBUILD4);
        sinceBreak = 0;
        continue;
      }
    }
    if (sinceBreak >= 48 && left >= 16) {
      out.push(...BREAK4);
      sinceBreak = 0;
      continue;
    }
    let run = Math.min(8, left);
    if (!broke && breakAt! > at) run = Math.min(run, breakAt! - at);
    out.push(...FULL8.slice(0, run));
    sinceBreak += run;
  }
  out.push(...tail);
  return out;
}

/** Monotonic bar counter whose value mod 32 is the form bar (so arrange/sectionAt and the engines see a live bar). */
export function counterBars(formBars: readonly number[]): number[] {
  const out: number[] = [];
  let v = -1;
  for (const f of formBars) {
    const d = ((((f - v - 1) % FORM_BARS) + FORM_BARS) % FORM_BARS) + 1;
    v = v < 0 ? f : v + d;
    out.push(v);
  }
  return out;
}

/** Plans every step of a release: the hits the offline renderer plays and the frames read. Deterministic. */
export function planRelease(input: ReleaseInput, options: ReleaseOptions = {}): ReleasePlan {
  const o = { ...RELEASE_DEFAULTS, ...options };
  const states = [input.seed, ...input.swaps.map((s) => s.state)];
  const program = options.program ?? HOUSE_PROGRAM;
  const genre = releaseGenre(input, program);
  let tempo = o.tempo ?? releaseTempo(states, genre, program);
  let plan = planAt(input, o, tempo, genre, program);
  // States differ in tempo (the chain bpm moves within the genre range), so the bounds are re-fit to the bar length the plan
  // actually got, a few times at most; an over-long refit falls back to the best plan within the bound.
  const fits = (p: ReleasePlan) => p.seconds <= o.maxSeconds + 1e-6;
  let best = fits(plan) ? plan : null;
  for (let i = 0; i < 4 && o.tempo == null; i++) {
    if (fits(plan) && plan.seconds >= o.minSeconds - 1e-6) break;
    tempo = (240 * plan.bars) / plan.seconds;
    const next = planAt(input, o, tempo, genre, program);
    if (next.bars === plan.bars) break;
    plan = next;
    if (fits(plan) && (!best || plan.seconds > best.seconds)) best = plan;
  }
  if (!fits(plan) && best) plan = best;
  return plan;
}

function planAt(
  input: ReleaseInput,
  o: Required<Omit<ReleaseOptions, "tempo" | "program">> & ReleaseOptions,
  tempo: number,
  genre: ReleaseGenre,
  program: Program,
): ReleasePlan {
  const intro = bars4(o.introBars, RELEASE_DEFAULTS.introBars);
  const outroLen = bars4(o.outroBars, RELEASE_DEFAULTS.outroBars);
  const swaps = input.swaps;
  const pace = releasePace(swaps.length, tempo, o);
  const satIndex = swaps.findIndex((s) => popcount64(s.state.pattern) >= RELEASE_SAT_BITS);
  const satBody = satIndex >= 0 ? Math.floor(pace.swapSteps[satIndex] / 16) : null;
  const body = releaseBodyForm(pace.bodyBars, satBody);
  // Intro: form 0..7 (repeating its second half when longer); outro: full from the drop, the last half a breakdown.
  const introForm = Array.from({ length: intro }, (_, i) => (i < 8 ? i : 4 + (i % 4)));
  const half = Math.max(4, down4(outroLen / 2));
  const outroForm = Array.from({ length: outroLen }, (_, i) => (i < outroLen - half ? 16 + (i % 8) : 24 + ((i - (outroLen - half)) % 4)));
  const formBars = [...introForm, ...body, ...outroForm];
  const counter = counterBars(formBars);
  const bodyStart = intro;
  const dropBar = input.next ? bodyStart + body.length : null;
  const tail = input.next ?? swaps.at(-1)?.state ?? input.seed;

  const hits: StepHit[] = [];
  const swapTimes: number[] = new Array(swaps.length).fill(0);
  const barTimes: number[] = [];
  const totalSteps = formBars.length * 16;
  let grid = 0;
  let cursor = 0;
  let state = input.seed;
  let pending: DropCue | null = null;
  // NFT cues only when a swap carries one: every other release's hits stay exactly as they were.
  const cues = swaps.some((sw) => sw.sale || sw.lock || sw.page || sw.overprint) ? new CueQueue() : null;
  for (let g = 0; g < totalSteps; g++) {
    const bar = Math.floor(g / 16);
    const step = g % 16;
    if (step === 0) barTimes.push(grid);
    const local = g - bodyStart * 16;
    if (bar >= bodyStart + body.length) state = tail;
    else {
      while (cursor < swaps.length && local >= pace.swapSteps[cursor]) {
        const sw = swaps[cursor];
        state = sw.state;
        if (sw.drop) pending = sw.drop;
        if (cues) {
          if (sw.sale) cues.pushSale(sw.sale);
          if (sw.lock) cues.pushLock(sw.lock);
          if (sw.page) cues.pushPage(sw.page);
          if (sw.overprint) cues.pushOverprint(sw.overprint);
        }
        swapTimes[cursor] = grid;
        cursor += 1;
      }
    }
    const trackDrop = dropBar != null && g === dropBar * 16;
    const { tempo: stepTempo, duration } = genreStep(state, genre.era, genre.epoch, program);
    const character = stepCharacter(state.patternId, step, genre.era, genre.epoch, program);
    let time = grid;
    if (step % 2 === 1) time += (character.swing - 0.5) * duration;
    time += character.micro;
    if (time < 0) time = 0;
    if (hits.length > 0) time = Math.max(time, hits[hits.length - 1].time + 0.008);
    let drop: StepHit["drop"];
    if (pending && (!pending.fill || step % 4 === 0)) {
      drop = { ...pending, land: true };
      pending = null;
    }
    hits.push({
      gridTime: grid,
      time,
      step,
      bar: counter[bar],
      duration,
      tempo: stepTempo,
      state,
      nowSec: null,
      idle: null,
      drop,
      ...(trackDrop ? { trackDrop: true } : {}),
      ...(cues ? cues.take(step) : {}),
      ...character,
    });
    grid += duration;
  }
  const seconds = grid;
  const fadeBar = formBars.length - half;
  const fadeAt = barTimes[fadeBar] ?? seconds;

  const sections: ReleaseSection[] = [];
  const nameAt = (r: number): ReleaseSection["name"] => (dropBar != null && r >= dropBar) || r >= bodyStart + body.length ? "outro" : sectionAt(formBars[r]).name;
  for (let r = 0; r < formBars.length; r++) {
    const name = nameAt(r);
    const last = sections.at(-1);
    if (last && last.name === name) {
      last.to = r + 1;
      continue;
    }
    sections.push({ name, from: r, to: r + 1, time: barTimes[r] });
  }

  return {
    hits,
    seconds,
    bars: formBars.length,
    introBars: intro,
    bodyBars: body.length,
    outroBars: outroLen,
    dropBar,
    dropTime: dropBar != null ? barTimes[dropBar] : null,
    fadeAt,
    pace,
    swapTimes,
    formBars,
    sections,
    genre,
    program,
    saturationBar: satBody != null ? bodyStart + satBody : null,
  };
}
