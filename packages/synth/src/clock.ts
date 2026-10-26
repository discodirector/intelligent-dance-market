import { FORM_BARS } from "./arrange.ts";
import { eraById, eraOf, epochOf, genreTempo, type Era } from "./eras.ts";
import { hash32 } from "./hash.ts";
import { HOUSE_PROGRAM, type Program } from "./program.ts";
import { styleFeel, styleOf } from "./styles.ts";
import { idleStage, type IdleGains } from "./idle.ts";
import { initialState, type SequencerState } from "./state.ts";

/** Whale drop. `fill` true is a buy (euclidean hit); false is a sell wipe. */
export interface DropCue {
  track: number;
  fill: boolean;
  mask?: number;
}

/**
 * NFT station cues (core nft.ts tags; only a collection station with them emits these, so every other station and the
 * house never see one). A rated Credit sale: its percentile in the edition (0..255) and its CMYK plates (1..15, bit0
 * C, bit1 M, bit2 Y, bit3 K). The engine plays it as a plate stab (engine.ts creditSale).
 */
export interface SaleCue {
  pct: number;
  mask: number;
}

/** A BALANCE withdraw (a Statement locked): the points released and the release's CMYK split in whole percent. */
export interface LockCue {
  points: number;
  ink?: readonly [number, number, number, number];
}

/**
 * A Statement sold (a page changing hands): its price against the recent page median, percent (100 = the median),
 * the page's points when known (core nft.ts tags rel / points). The engine plays a full-chord stab (creditPage).
 */
export interface PageCue {
  rel: number;
  points?: number;
}

/** An overprint: the base page's overprint count after it (absent: unknown). From INVERTED_AT on, the paper is black. */
export interface OverprintCue {
  count?: number;
}

/** Statements: from this many overprints a page is printed on black paper (Statements.INVERTED_AT). */
export const INVERTED_AT = 7;

/**
 * A swap in BALANCE's pool: an ornament, never a rules input. `plate` the ink's strongest plate (0 C, 1 M, 2 Y, 3 K;
 * absent: no ink read), `isBuy` BALANCE bought, `size` 0..3 by the ETH it moved (ornamentSize).
 */
export interface InkCue {
  plate?: number;
  isBuy: boolean;
  size: number;
}

/** An InkCue's size from the ETH a swap moved (wei): < 0.02 · < 0.1 · < 0.5 · more. */
export const inkSize = (wei: bigint): number => (wei < 20_000_000_000_000_000n ? 0 : wei < 100_000_000_000_000_000n ? 1 : wei < 500_000_000_000_000_000n ? 2 : 3);

/** Sales waiting for their 8th: a sweep longer than this plays its newest ones. */
export const SALE_QUEUE = 4;
/** Pages and overprints waiting for their beat (each kind): a burst plays its newest ones. */
export const PAGE_QUEUE = 4;
/** Ornaments waiting: at most one an 8th, so this many is a bar's worth; one older than a bar is dropped. */
export const INK_QUEUE = 8;
/** An ornament waiting longer than this many 16ths (a bar) is let go. */
export const INK_PATIENCE = 16;

/**
 * Where the NFT cues land, shared by every scheduler (planSteps, the live player): a sale on the next 8th (one per
 * 8th, so a sweep is a short run of stabs), a withdraw on the next downbeat, a page sale and an overprint on the next
 * beat, a BALANCE swap's ornament on the next off-16th (the "e" or "a" of a beat: never where a sale or a beat cue
 * lands), at most one an 8th, dropped after a bar of waiting (`dropped` counts them). Deterministic: the same pushes
 * and steps give the same landings.
 */
export class CueQueue {
  private sales: SaleCue[] = [];
  private lock: LockCue | null = null;
  private pages: PageCue[] = [];
  private overprints: OverprintCue[] = [];
  private inks: { cue: InkCue; at: number }[] = [];
  /** Steps taken so far (take() calls), the ornaments' clock. */
  private n = 0;
  private lastInk = -Infinity;
  /** Ornaments let go: over the queue, or waiting over a bar. */
  dropped = 0;
  pushSale(cue: SaleCue) {
    this.sales.push(cue);
    if (this.sales.length > SALE_QUEUE) this.sales.shift();
  }
  pushLock(cue: LockCue) {
    this.lock = cue;
  }
  pushPage(cue: PageCue) {
    this.pages.push(cue);
    if (this.pages.length > PAGE_QUEUE) this.pages.shift();
  }
  pushOverprint(cue: OverprintCue) {
    this.overprints.push(cue);
    if (this.overprints.length > PAGE_QUEUE) this.overprints.shift();
  }
  pushInk(cue: InkCue) {
    this.inks.push({ cue, at: this.n });
    if (this.inks.length > INK_QUEUE) {
      this.inks.shift();
      this.dropped++;
    }
  }
  /** The cues this step plays, as StepHit fields (none: an empty object, so a hit without cues is unchanged). */
  take(step: number): { sale?: SaleCue; lock?: LockCue; page?: PageCue; overprint?: OverprintCue; ink?: InkCue } {
    const out: { sale?: SaleCue; lock?: LockCue; page?: PageCue; overprint?: OverprintCue; ink?: InkCue } = {};
    const n = this.n++;
    if (this.lock && step === 0) {
      out.lock = this.lock;
      this.lock = null;
    }
    if (this.sales.length && step % 2 === 0) out.sale = this.sales.shift()!;
    if (step % 4 === 0) {
      if (this.pages.length) out.page = this.pages.shift()!;
      if (this.overprints.length) out.overprint = this.overprints.shift()!;
    }
    if (this.inks.length) {
      while (this.inks.length && n - this.inks[0].at > INK_PATIENCE) {
        this.inks.shift();
        this.dropped++;
      }
      if (this.inks.length && step % 2 === 1 && n - this.lastInk >= 2) {
        out.ink = this.inks.shift()!.cue;
        this.lastInk = n;
      }
    }
    return out;
  }
}

/**
 * Heat -> drop prototype: this point's swap finished the track (core `trackComplete`).
 * The rest of the bar keeps playing `held` (the finished track, at full heat); the next bar
 * lands as the drop: the song form jumps to the first bar of "full" and the engine plays the impact.
 */
export interface TrackDropCue {
  /** The finished track: decoded `trackComplete.slot0/slot1`. Omit to hold the previous point's state. */
  held?: SequencerState;
}

export interface TimelinePoint {
  /** Seconds from the start of playback. Speed scales this, not `now`. */
  time: number;
  state: SequencerState;
  /** Virtual unix seconds at this point. Replay and render idle from this clock. */
  now?: number;
  flash?: { track: number; step: number; bass?: boolean; row?: boolean };
  drop?: DropCue;
  trackDrop?: TrackDropCue;
  /** NFT stations: this point's sale was a rated Credit (SaleCue), or a BALANCE withdraw (LockCue). */
  sale?: SaleCue;
  lock?: LockCue;
  /** NFT stations: this point was a Statement sold (PageCue) or an overprint (OverprintCue). */
  page?: PageCue;
  overprint?: OverprintCue;
}

export interface StepCharacter {
  swing: number;
  micro: number;
  ratchet: number;
  stutter: boolean;
  openHat: boolean;
  velocity: number;
}

export interface StepHit extends StepCharacter {
  /** Unswung grid time of this step. */
  gridTime: number;
  /** When the voices fire (grid + swing + micro). */
  time: number;
  step: number;
  /** Bar counter since playback start; drives phrase-level fills (SPEC §4.3). */
  bar: number;
  /** One 16th at the genre tempo (`tempo`), not at the raw on-chain bpm. */
  duration: number;
  /** Genre tempo of this step: the on-chain bpm mapped into the genre's range (eras.ts genreTempo). */
  tempo: number;
  state: SequencerState;
  /** Virtual unix seconds, or null when this render has no clock (gallery). */
  nowSec: number | null;
  /** Null keeps every voice at unity. */
  idle: IdleGains | null;
  /** First downbeat after a long pause. */
  recover?: boolean;
  drop?: DropCue & { land: boolean };
  /** Heat -> drop: this downbeat is the first bar of the new track. */
  trackDrop?: boolean;
  /** NFT stations (CueQueue): a rated sale lands on this step, a withdraw on this downbeat. Absent everywhere else. */
  sale?: SaleCue;
  lock?: LockCue;
  /** NFT stations (CueQueue): a Statement sale or an overprint on this beat, a BALANCE swap's ornament on this 16th. */
  page?: PageCue;
  overprint?: OverprintCue;
  ink?: InkCue;
}

/**
 * One 16th note. The clock advances once per step — there is no hidden
 * double-time. Tempos outside 40–300 fall back to the on-chain initial 96.
 */
export function stepDuration(bpm: number): number {
  const b = bpm >= 40 && bpm <= 300 ? bpm : 96;
  return 60 / b / 4;
}

/**
 * Swing, micro-offset, ratchets and stutters come from the era of this page
 * plus a hash of patternId and step. Odd 16ths are delayed; the grid itself
 * stays one 16th note per step. `eraId` forces a gallery preview.
 */
/** The genre that plays this page: the override, else the epoch's in `program`'s genre order. */
export function eraAt(patternId: number, eraId?: string | null, program: Program = HOUSE_PROGRAM): Era {
  return eraId ? eraById(eraId) : eraOf(epochOf({ patternId: patternId >>> 0 }), program);
}

/**
 * One 16th at the genre tempo of this state (the chain bpm mapped into the genre's range). `styleEpoch` pins the
 * instance whose style sets the feel (a release plays the epoch its track finished in); default: the state's epoch.
 * `program` picks genre and style (default house); every step of one render passes the same one.
 */
export function genreStep(
  state: { bpm: number; patternId: number },
  eraId?: string | null,
  styleEpoch?: number | null,
  program: Program = HOUSE_PROGRAM,
): { tempo: number; duration: number } {
  const era = eraAt(state.patternId, eraId, program);
  const feel = styleFeel(era, styleOf(era, styleEpoch ?? epochOf(state), program).style);
  const tempo = genreTempo(era, state.bpm, feel.bpm);
  return { tempo, duration: stepDuration(tempo) };
}

export function stepCharacter(
  patternId: number,
  step: number,
  eraId?: string | null,
  styleEpoch?: number | null,
  program: Program = HOUSE_PROGRAM,
): StepCharacter {
  const id = patternId >>> 0;
  const era = eraAt(id, eraId, program);
  const feel = styleFeel(era, styleOf(era, styleEpoch ?? epochOf({ patternId: id }), program).style);
  const h = hash32(id, step, 0xa11);
  const h2 = hash32(id, step, 0x9e37);
  const micro = ((h % 1000) / 999 - 0.5) * 0.012 * feel.microScale;
  const bucket = h2 % era.ratchetEvery;
  let ratchet = 1;
  const busy = era.ratchetEvery <= 12;
  if (busy) {
    if (bucket < 2) ratchet = 4;
    else if (bucket < 5) ratchet = 3;
    else if (bucket < 8) ratchet = 2;
  } else if (bucket === 0) ratchet = 4;
  else if (bucket < 3) ratchet = 3;
  else if (bucket < 8) ratchet = 2;
  return {
    swing: feel.swing,
    micro,
    ratchet,
    stutter: h2 % era.stutterEvery === 0,
    openHat: h % 7 === 0,
    velocity: 0.82 + (h % 19) / 100,
  };
}

/** Virtual unix time at playback second `t`. Null when the timeline has no `now`. */
export function nowAt(points: readonly TimelinePoint[], t: number): number | null {
  let prev: TimelinePoint | null = null;
  for (const point of points) {
    if (point.now == null || !Number.isFinite(point.now)) continue;
    if (point.time <= t + 1e-9) {
      prev = point;
      continue;
    }
    if (!prev || prev.now == null) return point.now;
    const span = point.time - prev.time;
    if (!(span > 1e-9)) return point.now;
    const u = (t - prev.time) / span;
    return prev.now + (point.now - prev.now) * u;
  }
  return prev?.now ?? null;
}

export interface IdleMemory {
  prevIdle: number;
  fillArmed: boolean;
}

export function freshIdleMemory(): IdleMemory {
  return { prevIdle: 0, fillArmed: false };
}

/**
 * Arms the return fill when a pause of at least 10 minutes ends, and fires it
 * on the next downbeat. Shared by the offline planner and the live scheduler.
 */
export function advanceIdle(
  mem: IdleMemory,
  state: { lastTs: number },
  nowSec: number | null,
  step: number,
): { mem: IdleMemory; recover: boolean; idle: IdleGains | null } {
  if (nowSec == null) return { mem, recover: false, idle: null };
  const stage = idleStage(state, nowSec);
  let fillArmed = mem.fillArmed;
  if (mem.prevIdle >= 600 && stage.idleSec < 90) fillArmed = true;
  let recover = false;
  if (fillArmed && step % 4 === 0) {
    recover = true;
    fillArmed = false;
  }
  return {
    mem: { prevIdle: stage.idleSec, fillArmed },
    recover,
    idle: stage,
  };
}

export function stateAt(points: readonly TimelinePoint[], t: number): SequencerState {
  let current: SequencerState | null = null;
  for (const point of points) {
    if (point.time <= t + 1e-6) current = point.state;
    else break;
  }
  return current ?? initialState();
}

/** Walk the grid from t=0. Step length follows the bpm of the state at that grid time. */
/** `barOffset` starts the song form later (SPEC §4.4); short clips use it to open in the build. */
export function planSteps(
  points: readonly TimelinePoint[],
  seconds: number,
  eraId?: string | null,
  barOffset = 0,
  program: Program = HOUSE_PROGRAM,
  /** NFT stations: BALANCE swaps' ornaments, at render seconds, in time order (never rules inputs, never points). */
  inks: readonly { time: number; cue: InkCue }[] = [],
  /** Out: the ornaments let go (over the queue or a bar late). */
  stats?: { inksDropped: number },
): StepHit[] {
  const hits: StepHit[] = [];
  let inkCursor = 0;
  let grid = 0;
  let index = 0;
  let dropCursor = 0;
  let pending: TimelinePoint["drop"] | null = null;
  const cues = new CueQueue();
  let idleMem = freshIdleMemory();
  // Heat -> drop: the cue's point index and the state held until the next downbeat; form shift after a landing.
  let trackPending: { at: number; held: SequencerState } | null = null;
  let formShift = 0;
  const limit = Math.max(0, seconds);
  while (grid < limit && index < 200_000) {
    while (dropCursor < points.length && points[dropCursor].time <= grid + 1e-6) {
      const point = points[dropCursor];
      if (point.drop) pending = point.drop;
      if (point.sale) cues.pushSale(point.sale);
      if (point.lock) cues.pushLock(point.lock);
      if (point.page) cues.pushPage(point.page);
      if (point.overprint) cues.pushOverprint(point.overprint);
      if (point.trackDrop) {
        trackPending = { at: dropCursor, held: point.trackDrop.held ?? points[dropCursor - 1]?.state ?? point.state };
      }
      dropCursor += 1;
    }
    while (inkCursor < inks.length && inks[inkCursor].time <= grid + 1e-6) cues.pushInk(inks[inkCursor++].cue);
    const step = index % 16;
    let state = stateAt(points, grid);
    let trackDrop: true | undefined;
    if (trackPending) {
      if (step === 0) {
        trackDrop = true;
        trackPending = null;
        formShift = (((16 - (Math.floor(index / 16) + barOffset)) % FORM_BARS) + FORM_BARS) % FORM_BARS;
      } else if (dropCursor - 1 === trackPending.at) {
        state = trackPending.held;
      }
    }
    const { tempo, duration } = genreStep(state, eraId, null, program);
    const character = stepCharacter(state.patternId, step, eraId, null, program);
    let time = grid;
    if (step % 2 === 1) time += (character.swing - 0.5) * duration;
    time += character.micro;
    if (time < 0) time = 0;
    if (hits.length > 0) time = Math.max(time, hits[hits.length - 1].time + 0.008);
    const nowSec = nowAt(points, grid);
    const idleStep = advanceIdle(idleMem, state, nowSec, step);
    idleMem = idleStep.mem;
    let drop: StepHit["drop"];
    if (pending && (!pending.fill || step % 4 === 0)) {
      drop = { ...pending, land: true };
      pending = null;
    }
    hits.push({
      gridTime: grid,
      time,
      step,
      bar: Math.floor(index / 16) + barOffset + formShift,
      duration,
      tempo,
      state,
      nowSec,
      idle: idleStep.idle,
      recover: idleStep.recover || undefined,
      drop,
      ...(trackDrop ? { trackDrop } : {}),
      ...cues.take(step),
      ...character,
    });
    grid += duration;
    index += 1;
  }
  if (stats) stats.inksDropped = cues.dropped;
  return hits;
}

export interface TransportView {
  state: SequencerState;
  step: number;
  /** Bar counter of the playing step (SPEC §4.3 phrase position). */
  bar: number;
  phase: number;
  time: number;
  /** Genre tempo of the playing step. */
  bpm: number;
}

export function viewAt(hits: readonly StepHit[], t: number, fallback: SequencerState, program: Program = HOUSE_PROGRAM): TransportView {
  if (hits.length === 0) {
    return { state: fallback, step: 0, bar: 0, phase: 0, time: t, bpm: genreStep(fallback, null, null, program).tempo };
  }
  let lo = 0;
  let hi = hits.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid].gridTime <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const hit = hits[ans];
  const phase = hit.duration > 0 ? Math.min(0.999, Math.max(0, (t - hit.gridTime) / hit.duration)) : 0;
  return { state: hit.state, step: hit.step, bar: hit.bar, phase, time: t, bpm: hit.tempo };
}
