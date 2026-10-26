import {
  advanceIdle,
  CueQueue,
  freshIdleMemory,
  genreStep,
  planSteps,
  stepCharacter,
  viewAt,
  type DropCue,
  type IdleMemory,
  type InkCue,
  type LockCue,
  type OverprintCue,
  type PageCue,
  type SaleCue,
  type StepHit,
  type TimelinePoint,
  type TransportView,
} from "./clock.ts";
import { ceilingCurve, MASTER_CEILING, MixChain, OfflineReaper, setOfflineReaper, VoiceEngine, type OrnamentPlay } from "./engine.ts";
import { FORM_BARS } from "./arrange.ts";
import { crossfadeSeconds, epochOf, eraById, eraOf, type Era } from "./eras.ts";
import { HOUSE_PROGRAM, type Program } from "./program.ts";
import { initialState, type SequencerState } from "./state.ts";
import type { ReleasePlan } from "./release.ts";

export interface StepListenerEvent {
  step: number;
  time: number;
  state: SequencerState;
}

export interface EraView {
  epoch: number;
  id: string;
  name: string;
  /** True while two era engines are still crossfading. */
  fading: boolean;
}

export interface LivePlayerOptions {
  /** What the player plays (program.ts). Fixed for the player's life: a new station is a new player. Default house. */
  program?: Program;
}

export interface LivePlayer {
  setState(state: SequencerState): void;
  /** Next unscheduled step uses this era. `null` follows `eraOf(epochOf(state))`. */
  setEraOverride(eraId: string | null): void;
  /**
   * Virtual unix clock for replay and render. `null` uses the wall clock,
   * which is what live mode wants. Demo pins this to `lastTs` so a fake
   * timestamp is not compared with the wall.
   */
  setClock(nowSec: number | null): void;
  /** Whale drop. A buy waits for the next downbeat; a sell starts on the next step. */
  noteDrop(drop: DropCue | null): void;
  /** NFT stations: a rated Credit sale (lands on the next 8th) or a BALANCE withdraw (the next downbeat). */
  noteSale(cue: SaleCue): void;
  noteLock(cue: LockCue): void;
  /** NFT stations: a Statement sold or an overprint (the next beat), a BALANCE swap's ornament (the next off-16th). */
  notePage(cue: PageCue): void;
  noteOverprint(cue: OverprintCue): void;
  noteInk(cue: InkCue): void;
  /**
   * Heat -> drop prototype: the latest swap finished the track. Until the next downbeat the voices keep
   * playing `held` (the finished track; omit to hold the state before the drop), then that bar lands as the drop.
   */
  noteTrackDrop(held?: SequencerState | null): void;
  /**
   * Attention layer (prototype): one mention of the token now. The genre plays it as a quiet ornament in its own voice
   * on the next unscheduled step that suits it (RenderOptions.ornaments). `smart`: the clearer version.
   */
  noteMention(smart?: boolean): void;
  start(): void;
  stop(): void;
  readonly running: boolean;
  getTransport(): TransportView;
  getEra(): EraView;
  onStep(listener: (event: StepListenerEvent) => void): () => void;
}

export interface RenderOptions {
  /** Force one era for the whole render. Omit to follow the epoch of each state. */
  eraId?: string;
  /** What the render plays (program.ts): genre order and style lists, for every step and engine. Default house. */
  program?: Program;
  /** First bar of the 32-bar song form (SPEC §4.4). Short clips start in the build. */
  barOffset?: number;
  /**
   * Attention layer (prototype, docs/STATIONS.md): mentions of the token, each played as one quiet ornament in the
   * playing genre's own voice on the next step that suits it (OrnamentCue). Omitted or empty: the render is exactly
   * what it was without the layer.
   */
  ornaments?: readonly OrnamentCue[];
  /**
   * NFT stations: BALANCE swaps' ornaments at render seconds, in time order (clock.ts InkCue, CueQueue). Omitted or
   * empty: the render is exactly what it was without them.
   */
  inks?: readonly { time: number; cue: InkCue }[];
}

/**
 * Attention layer: one mention, requested at `time` (render seconds, or the live context's clock). The engine plays it
 * on the first step at or after `time` that is one of the playing base's ornament slots (engine.ts ORNAMENT_PLAN), at
 * least an 8th after the previous ornament; a request still waiting a bar later is let go. `smart`: the clearer version.
 */
export interface OrnamentCue {
  time: number;
  smart?: boolean;
}

/** A waiting mention gives up after this many 16ths (one bar): a player who missed the moment lets it go. */
const ORNAMENT_PATIENCE_STEPS = 16;
/** Two ornaments are at least this many 16ths apart (an 8th), on the grid. */
const ORNAMENT_GAP_STEPS = 2;

/**
 * Attention layer: the mentions waiting to be played (oldest first) and the rules for when one may be. The rig offers
 * `due(hit)` to the primary engine each step and calls `played(hit)` when the engine took it. Deterministic.
 */
export class OrnamentQueue {
  private readonly cues: OrnamentCue[] = [];
  /** Grid time of the last ornament played, and how many were played. */
  private lastGrid = -Infinity;
  private count = 0;

  /** Queue one mention, in time order (equal times keep their arrival order). Non-finite times are ignored. */
  request(cue: OrnamentCue) {
    if (!Number.isFinite(cue.time)) return;
    let i = this.cues.length;
    while (i > 0 && this.cues[i - 1].time > cue.time) i--;
    this.cues.splice(i, 0, { time: cue.time, smart: cue.smart === true });
  }

  /** Mentions still waiting. */
  get pending(): number {
    return this.cues.length;
  }

  /**
   * The oldest waiting mention, if this step may play one: it is due (requested at or before the step's time) and the
   * last ornament is an 8th back on the grid. Mentions a bar older than the step are let go first.
   */
  due(hit: Pick<StepHit, "gridTime" | "time" | "duration">): OrnamentPlay | null {
    if (this.cues.length === 0) return null;
    const patience = ORNAMENT_PATIENCE_STEPS * hit.duration;
    while (this.cues.length > 0 && this.cues[0].time < hit.gridTime - patience) this.cues.shift();
    const head = this.cues[0];
    if (!head || head.time > hit.time) return null;
    if (hit.gridTime - this.lastGrid < ORNAMENT_GAP_STEPS * hit.duration - 1e-6) return null;
    return { smart: head.smart === true, index: this.count };
  }

  /** The mention `due` offered was played on this step. */
  played(hit: Pick<StepHit, "gridTime">) {
    this.cues.shift();
    this.lastGrid = hit.gridTime;
    this.count += 1;
  }
}

interface Scheduled {
  gridTime: number;
  index: number;
  /** Song-form bar (index / 16 plus the heat -> drop form shift). */
  bar: number;
  duration: number;
  tempo: number;
  state: SequencerState;
}

interface Slot {
  era: Era;
  engine: VoiceEngine;
  gain: GainNode;
  ramp: { t0: number; t1: number; from: number; to: number };
  /** Time of the last setValueAtTime, not the end of a future ramp. */
  lastSet: number;
}

const LOOKAHEAD_SEC = 0.16;
const TICK_MS = 25;
const SILENT = 0.0001;

function stereo(node: AudioNode) {
  node.channelCount = 2;
  node.channelCountMode = "explicit";
  node.channelInterpretation = "speakers";
}

/**
 * One VoiceEngine per era. Their slot gains crossfade over one bar into a
 * shared bus, then a soft-knee waveshaper. The shaper is the master limiter:
 * DynamicsCompressorNode is not bit-exact in Chromium.
 */
class EraRig {
  private readonly slots: Slot[] = [];
  private incoming: Slot | null = null;
  private eraId: string | null;
  private readonly live: boolean;
  private readonly sampleRate: number;
  private readonly output: GainNode;
  private readonly mix: MixChain;
  private outLastSet = -1;
  private outRamp = { t0: 0, t1: 0, from: 1, to: 1 };
  /** Attention layer: mentions not played yet. */
  private readonly ornaments = new OrnamentQueue();

  constructor(
    private readonly ctx: BaseAudioContext,
    eraId: string | null,
    liveFade: boolean,
    /** With `eraId`: every engine plays this genre instance (epoch), whatever the states' epochs. Releases only. */
    private readonly instance: number | null = null,
    /** Genre order and style lists of every engine in this rig. */
    readonly program: Program = HOUSE_PROGRAM,
  ) {
    this.eraId = eraId;
    this.live = typeof AudioContext !== "undefined" && ctx instanceof AudioContext;
    this.sampleRate = ctx.sampleRate || 44100;
    const bus = ctx.createGain();
    stereo(bus);
    bus.gain.value = 1;
    const shaper = ctx.createWaveShaper();
    shaper.curve = new Float32Array(ceilingCurve(MASTER_CEILING));
    shaper.oversample = "none";
    this.output = ctx.createGain();
    stereo(this.output);
    const opened = liveFade ? SILENT : 1;
    this.output.gain.value = opened;
    this.outRamp = { t0: 0, t1: 0, from: opened, to: opened };
    // Offline sums two at a time. Live connects straight through so a new era
    // can join the bus without disconnecting the one already playing.
    this.mix = new MixChain(ctx, bus, this.live);
    bus.connect(shaper);
    shaper.connect(this.output);
  }

  connect(destination: AudioNode) {
    this.output.connect(destination);
  }

  setOverride(eraId: string | null) {
    this.eraId = eraId;
  }

  get override(): string | null {
    return this.eraId;
  }

  describe(state: SequencerState, time: number): EraView {
    const era = this.eraFor(state);
    const fading = this.slots.some(
      (slot) => time < slot.ramp.t1 - 1e-4 && Math.abs(slot.ramp.to - slot.ramp.from) > 0.02,
    );
    return { epoch: epochOf(state), id: era.id, name: era.name, fading };
  }

  /** Attention layer: queue one mention for the primary engine (OrnamentQueue). */
  requestOrnament(cue: OrnamentCue) {
    this.ornaments.request(cue);
  }

  play(hit: StepHit) {
    const era = this.eraFor(hit.state);
    const slot = this.ensure(era, hit.time, hit.tempo);
    const due = this.ornaments.due(hit);
    if (slot.engine.trigger(hit, true, due) && due) this.ornaments.played(hit);
    for (const other of this.slots) {
      if (other === slot) continue;
      if (this.levelAt(other, hit.time) > 0.04) other.engine.trigger(hit, false);
    }
    this.prune(hit.time);
  }

  fadeOutput(to: number, time: number, seconds: number) {
    const param = this.output.gain;
    param.cancelScheduledValues(time);
    let start = time;
    if (this.outLastSet >= 0 && Math.abs(start - this.outLastSet) < 0.5 / this.sampleRate) {
      start = this.outLastSet + 1 / this.sampleRate;
    }
    const from = Math.max(SILENT, this.outputLevel(start));
    const dest = Math.max(SILENT, to);
    const end = start + Math.max(seconds, 1 / this.sampleRate);
    param.setValueAtTime(from, start);
    param.linearRampToValueAtTime(dest, end);
    this.outLastSet = start;
    this.outRamp = { t0: start, t1: end, from, to: dest };
  }

  /** Release outro: an equal-power fade of the whole output to silence over [time, time + seconds]. Offline only. */
  fadeOutCurve(time: number, seconds: number) {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.cos((i / (n - 1)) * (Math.PI / 2));
    curve[n - 1] = 0;
    this.output.gain.setValueCurveAtTime(curve, Math.max(0, time), Math.max(1 / this.sampleRate, seconds));
  }

  private eraFor(state: SequencerState): Era {
    return this.eraId ? eraById(this.eraId) : eraOf(epochOf(state), this.program);
  }

  private levelAt(slot: Slot, time: number): number {
    const { t0, t1, from, to } = slot.ramp;
    if (time <= t0 || t1 <= t0) return time <= t0 ? from : to;
    if (time >= t1) return to;
    const u = (time - t0) / (t1 - t0);
    return from + (to - from) * u;
  }

  private outputLevel(time: number): number {
    const { t0, t1, from, to } = this.outRamp;
    if (time <= t0 || t1 <= t0) return time <= t0 ? from : to;
    if (time >= t1) return to;
    const u = (time - t0) / (t1 - t0);
    return from + (to - from) * u;
  }

  private ramp(slot: Slot, t0: number, to: number, dur: number) {
    const param = slot.gain.gain;
    param.cancelScheduledValues(t0);
    let start = t0;
    if (slot.lastSet >= 0 && Math.abs(start - slot.lastSet) < 0.5 / this.sampleRate) {
      start = slot.lastSet + 1 / this.sampleRate;
    }
    const from = Math.max(SILENT, this.levelAt(slot, start));
    const dest = Math.max(SILENT, to);
    const end = start + Math.max(dur, 1 / this.sampleRate);
    param.setValueAtTime(from, start);
    param.linearRampToValueAtTime(dest, end);
    // A faded-out genre is muted to exactly 0, not left at -80 dB. Its graph keeps running: when its delays and
    // filters finish their tails, Chromium disables them at a moment that depends on the main thread, which moved
    // offline renders by a few ULP. Times 0, that cannot reach the mix.
    if (dest <= SILENT) param.setValueAtTime(0, end);
    slot.lastSet = start;
    slot.ramp = { t0: start, t1: end, from, to: dest };
  }

  private create(era: Era, time: number, level: number, schedule: boolean): Slot {
    const engine = new VoiceEngine(this.ctx, era.index, this.instance, this.program);
    const gain = this.ctx.createGain();
    stereo(gain);
    const held = Math.max(SILENT, level);
    if (schedule) gain.gain.setValueAtTime(held, Math.max(0, time));
    else gain.gain.value = held;
    engine.connect(gain);
    this.mix.add(gain);
    const slot: Slot = {
      era,
      engine,
      gain,
      ramp: { t0: time, t1: time, from: held, to: held },
      lastSet: schedule ? Math.max(0, time) : -1,
    };
    this.slots.push(slot);
    return slot;
  }

  private ensure(era: Era, time: number, bpm: number): Slot {
    if (this.incoming && this.incoming.era.index === era.index) return this.incoming;
    if (!this.incoming) {
      const slot = this.create(era, time, 1, true);
      this.incoming = slot;
      return slot;
    }
    const next = this.create(era, time, SILENT, false);
    const fade = crossfadeSeconds(bpm);
    this.ramp(this.incoming, time, SILENT, fade);
    this.ramp(next, time, 1, fade);
    this.incoming = next;
    return next;
  }

  /** Drop live engines after their fade and tails. Offline graphs stay put so the render stays identical. */
  private prune(time: number) {
    if (!this.live || this.slots.length < 8) return;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      if (slot === this.incoming) continue;
      if (time < slot.ramp.t1 + 2) continue;
      if (this.levelAt(slot, time) > 0.02) continue;
      slot.gain.disconnect();
      this.slots.splice(i, 1);
    }
  }
}

/**
 * Live scheduler. `setState` and `setEraOverride` apply on the next step that
 * has not been scheduled yet, and neither rebuilds a playing graph.
 */
export function createLivePlayer(ctx: AudioContext, options?: LivePlayerOptions): LivePlayer {
  const program = options?.program ?? HOUSE_PROGRAM;
  const rig = new EraRig(ctx, null, true, null, program);
  rig.connect(ctx.destination);

  let committed: SequencerState | null = null;
  let pending: SequencerState | null = null;
  let running = false;
  let timer = 0;
  let nextGrid = 0;
  let stepIndex = 0;
  let clockSec: number | null = null;
  let pendingDrop: DropCue | null = null;
  const cues = new CueQueue();
  let trackHold: SequencerState | null = null;
  let formShift = 0;
  let idleMem: IdleMemory = freshIdleMemory();
  const scheduled: Scheduled[] = [];
  const listeners = new Set<(event: StepListenerEvent) => void>();

  function arm(time: number) {
    if (!committed) return;
    let state = pending ?? committed;
    if (pending) {
      committed = pending;
      pending = null;
    }
    const step = stepIndex % 16;
    let trackDrop: true | undefined;
    if (trackHold) {
      if (step === 0) {
        trackDrop = true;
        trackHold = null;
        formShift = (((16 - Math.floor(stepIndex / 16)) % FORM_BARS) + FORM_BARS) % FORM_BARS;
      } else {
        state = trackHold;
      }
    }
    const { tempo, duration } = genreStep(state, rig.override, null, program);
    const character = stepCharacter(state.patternId, step, rig.override, null, program);
    const nowSec = clockSec != null ? clockSec : Date.now() / 1000;
    const idleStep = advanceIdle(idleMem, state, nowSec, step);
    idleMem = idleStep.mem;
    let drop: StepHit["drop"];
    if (pendingDrop && (!pendingDrop.fill || step % 4 === 0)) {
      drop = { ...pendingDrop, land: true };
      pendingDrop = null;
    }
    let when = nextGrid;
    if (step % 2 === 1) when += (character.swing - 0.5) * duration;
    when += character.micro;
    if (when < time + 0.005) when = time + 0.005;
    const hit: StepHit = {
      gridTime: nextGrid,
      time: when,
      step,
      bar: Math.floor(stepIndex / 16) + formShift,
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
    };
    rig.play(hit);
    scheduled.push({ gridTime: nextGrid, index: stepIndex, bar: hit.bar, duration, tempo, state });
    while (scheduled.length > 32) scheduled.shift();
    for (const listener of listeners) listener({ step, time: when, state });
    nextGrid += duration;
    stepIndex += 1;
  }

  function tick() {
    if (!running || !committed) return;
    const now = ctx.currentTime;
    let guard = 0;
    while (nextGrid < now + LOOKAHEAD_SEC && guard < 64) {
      arm(now);
      guard += 1;
    }
  }

  const player: LivePlayer = {
    setState(state) {
      if (!running || !committed) committed = state;
      else pending = state;
    },
    setEraOverride(eraId) {
      rig.setOverride(eraId);
    },
    setClock(nowSec) {
      clockSec = nowSec;
    },
    noteDrop(drop) {
      if (drop) pendingDrop = drop;
    },
    noteSale(cue) {
      if (running) cues.pushSale(cue);
    },
    noteLock(cue) {
      if (running) cues.pushLock(cue);
    },
    notePage(cue) {
      if (running) cues.pushPage(cue);
    },
    noteOverprint(cue) {
      if (running) cues.pushOverprint(cue);
    },
    noteInk(cue) {
      if (running) cues.pushInk(cue);
    },
    noteTrackDrop(held) {
      trackHold = held ?? committed ?? initialState();
    },
    noteMention(smart) {
      if (running) rig.requestOrnament({ time: ctx.currentTime, smart });
    },
    start() {
      if (running) return;
      if (!committed) committed = initialState();
      running = true;
      stepIndex = 0;
      formShift = 0;
      trackHold = null;
      idleMem = freshIdleMemory();
      scheduled.length = 0;
      nextGrid = ctx.currentTime + 0.05;
      rig.fadeOutput(1, ctx.currentTime, 0.02);
      tick();
      timer = window.setInterval(tick, TICK_MS);
    },
    stop() {
      if (!running) return;
      running = false;
      window.clearInterval(timer);
      rig.fadeOutput(SILENT, ctx.currentTime, 0.03);
    },
    get running() {
      return running;
    },
    getTransport() {
      const fallback = committed ?? initialState();
      if (!running) return { state: fallback, step: 0, bar: 0, phase: 0, time: 0, bpm: genreStep(fallback, rig.override, null, program).tempo };
      const now = ctx.currentTime;
      let current: Scheduled | null = null;
      for (const item of scheduled) {
        if (item.gridTime <= now) current = item;
      }
      if (!current) return { state: fallback, step: 0, bar: 0, phase: 0, time: now, bpm: genreStep(fallback, rig.override, null, program).tempo };
      const phase = current.duration > 0 ? Math.min(0.999, Math.max(0, (now - current.gridTime) / current.duration)) : 0;
      return {
        state: current.state,
        step: current.index % 16,
        bar: current.bar,
        phase,
        time: now,
        bpm: current.tempo,
      };
    },
    getEra() {
      const state = committed ?? pending ?? initialState();
      return rig.describe(state, ctx.currentTime);
    },
    onStep(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return player;
}

const OFFLINE_RATE = 44100;

export async function renderToBuffer(
  state: SequencerState,
  bars: number,
  sampleRate = OFFLINE_RATE,
  options?: RenderOptions,
): Promise<AudioBuffer> {
  const bpm = genreStep(state, options?.eraId, null, options?.program).tempo;
  const seconds = Math.max(0.05, bars * 4 * (60 / bpm));
  return renderTimelineToBuffer([{ time: 0, state }], seconds, sampleRate, options);
}

/**
 * Offline render of a timeline. Sample rate defaults to 44100.
 * Same points, duration and era override produce the same buffer in a given
 * browser: noise, metal, glitches, swing and era choice all come from the
 * state, not Math.random.
 */
export async function renderTimelineToBuffer(
  points: readonly TimelinePoint[],
  seconds: number,
  sampleRate = OFFLINE_RATE,
  options?: RenderOptions,
): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext !== "function") {
    throw new Error("OfflineAudioContext is not available");
  }
  const length = Math.max(1, Math.ceil(sampleRate * Math.max(0.05, seconds)));
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const eraId = options?.eraId ?? null;
  const program = options?.program ?? HOUSE_PROGRAM;
  const rig = new EraRig(ctx, eraId, false, null, program);
  rig.connect(ctx.destination);
  for (const cue of options?.ornaments ?? []) rig.requestOrnament(cue);
  const hits = planSteps(points, seconds, eraId, options?.barOffset ?? 0, program, options?.inks ?? []);
  for (const hit of hits) {
    if (hit.time < seconds) rig.play(hit);
  }
  return ctx.startRendering();
}

/** Release renders schedule hits this far ahead and prune finished voices this often. */
const RELEASE_WINDOW_SEC = 2;

/**
 * Offline render of a track release (release.ts planRelease): plays the plan's hits, fades the output out over the
 * outro's last bars, and is exactly `plan.seconds` long. Same plan → same buffer in a given browser.
 */
/** Release output trim (dB), after the master ceiling. Live, replay and clips are untouched. */
export const RELEASE_TRIM_DB = -1.2;

export async function renderReleaseToBuffer(plan: ReleasePlan, sampleRate = OFFLINE_RATE): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext !== "function") {
    throw new Error("OfflineAudioContext is not available");
  }
  const seconds = Math.max(0.05, plan.seconds);
  const length = Math.max(1, Math.ceil(sampleRate * seconds));
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  // One genre instance for the whole release: the genre, style and tonic the track finished in (SPEC §4.6), in the
  // program the plan was made with (its hits already carry that program's tempo and feel).
  const rig = new EraRig(ctx, plan.genre.era, false, plan.genre.epoch, plan.program);
  // Release master trim, after the ceiling: full-heat releases measured ~1 dB over the genres' loudest-3s target.
  const trim = ctx.createGain();
  trim.gain.value = 10 ** (RELEASE_TRIM_DB / 20);
  rig.connect(trim);
  trim.connect(ctx.destination);
  if (plan.fadeAt < seconds) rig.fadeOutCurve(plan.fadeAt, seconds - plan.fadeAt);
  // Hits are scheduled a window ahead and finished voices are dropped at fixed suspend points (OfflineReaper),
  // so the render stays linear in length. Suspend times are multiples of the window: deterministic.
  const reaper = new OfflineReaper();
  const hits = plan.hits.filter((hit) => hit.time < seconds);
  let next = 0;
  const playUntil = (until: number) => {
    setOfflineReaper(reaper);
    try {
      while (next < hits.length && hits[next].time < until) rig.play(hits[next++]);
    } finally {
      setOfflineReaper(null);
    }
  };
  playUntil(2 * RELEASE_WINDOW_SEC);
  const quantum = 128 / sampleRate;
  for (let k = 1; k * RELEASE_WINDOW_SEC < seconds - RELEASE_WINDOW_SEC; k++) {
    const at = Math.round((k * RELEASE_WINDOW_SEC) / quantum) * quantum;
    ctx.suspend(at).then(() => {
      reaper.segment = k;
      reaper.prune(at);
      playUntil(at + 2 * RELEASE_WINDOW_SEC);
      return ctx.resume();
    });
  }
  return ctx.startRendering();
}

export function projectTimeline(
  points: readonly TimelinePoint[],
  seconds: number,
  at: number,
  eraId?: string | null,
  program: Program = HOUSE_PROGRAM,
): TransportView {
  const hits = planSteps(points, Math.max(seconds, at + 0.001), eraId, 0, program);
  const fallback = points[0]?.state ?? initialState();
  return viewAt(hits, at, fallback, program);
}
