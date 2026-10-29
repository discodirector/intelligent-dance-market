// The style lab's audio (lab.ts): the synth's live player behind the lab's own master, able to swap players on a
// downbeat. Each player gets its own bus (createLivePlayer connects to ctx.destination, shadowed per player as
// audio.ts does), so the old one is cut just before the downbeat the new one starts on. The master ends in a safety
// stage the other pages do not need: a style comes from a link, so a compressor and a -1 dBFS soft ceiling sit between
// it and the listener's ears whatever the knobs did.
import { createLivePlayer, type LivePlayer, type Part, type Program, type SequencerState } from "@swarm-sequencer/synth";

interface Deck {
  player: LivePlayer;
  /** The player's own bus into the master: the swap cuts it on the downbeat. */
  bus: GainNode;
  program: Program;
}

/** The output ceiling, linear (-1 dBFS). */
export const CEILING = 10 ** (-1 / 20);

/** The ceiling's curve over the input -4..4 (a 0.25 pre-gain maps it onto the shaper's -1..1): y = c tanh(x / c). */
function ceilingCurve(c: number, n = 4096) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = c * Math.tanh((((i / (n - 1)) * 2 - 1) * 4) / c);
  return curve;
}

export class LabAudio {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  deck: Deck | null = null;
  /** The program the next swap starts (null: none waiting), and what runs just before it starts (a take's start). */
  private waiting: Program | null = null;
  private before: ((bar: number) => void) | null = null;
  /**
   * The lab's step clock: called once per scheduled step of the playing player (as it is scheduled, ahead of the
   * sound), across swaps: the old player's steps stop at the downbeat the new one starts on, which is counted once.
   */
  onStep: ((step: number) => void) | null = null;
  private lastStep = -Infinity;
  swaps = 0;
  /** Where the next start lands in the song form (bar 8: the build, past the empty intro). */
  startBar = 8;
  private clock: number | null = null;
  /** The parts muted now (lab.ts sets them on downbeats): every player now and later. */
  mutes: Part[] = [];
  /** Manual mode: no song form (lab.ts sets it on downbeats with the parts). */
  formless = false;
  timeData = new Float32Array(2048);
  freqData = new Uint8Array(1024);

  constructor(private readonly state: () => SequencerState) {}

  get running() {
    return !!this.deck?.player.running && this.ctx?.state === "running";
  }
  get pending() {
    return this.waiting !== null;
  }
  /** The programs playing or about to: live edits go into both. */
  get programs(): Program[] {
    return [this.deck?.program, this.waiting].filter((p): p is Program => !!p);
  }

  /** In the tap/click handler, before any await (WebKit starts a context only inside the gesture: audio.ts). */
  unlock() {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        // older WebKit: no audio session control
      }
    }
    const ctx = this.context();
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(this.master!);
    src.start(0);
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: "interactive" });
      const master = ctx.createGain();
      master.gain.value = 0.62;
      // Safety: a gentle compressor catches a hot style, a soft ceiling holds every peak under -1 dBFS.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 6;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      const pre = ctx.createGain();
      pre.gain.value = 0.25; // the curve's domain is -4..4
      const ceiling = ctx.createWaveShaper();
      ceiling.curve = ceilingCurve(CEILING);
      ceiling.oversample = "2x";
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      master.connect(comp);
      comp.connect(pre);
      pre.connect(ceiling);
      ceiling.connect(analyser);
      analyser.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.analyser = analyser;
      this.timeData = new Float32Array(analyser.fftSize);
      this.freqData = new Uint8Array(analyser.frequencyBinCount);
    }
    return this.ctx;
  }

  private spawn(program: Program): Deck {
    const ctx = this.context();
    const bus = ctx.createGain();
    bus.connect(this.master!);
    Object.defineProperty(ctx, "destination", { value: bus, configurable: true });
    const player = createLivePlayer(ctx, { program });
    if (this.mutes.length) player.setMutes(this.mutes);
    if (this.formless) player.setFormless(true);
    player.setState(this.state());
    player.setClock(this.clock);
    const deck: Deck = { player, bus, program };
    player.onStep(({ step, time }) => {
      if (this.deck !== deck || time <= this.lastStep + 1e-3) return;
      this.lastStep = time;
      this.onStep?.(step);
    });
    return deck;
  }

  setMutes(parts: Part[]) {
    this.mutes = parts;
    this.deck?.player.setMutes(parts);
  }
  setFormless(on: boolean) {
    if (on === this.formless) return;
    this.formless = on;
    this.deck?.player.setFormless(on);
  }

  /** The feed's clock (a replay's virtual time; null = the wall clock), for every player now and later. */
  setClock(c: number | null) {
    this.clock = c;
    this.deck?.player.setClock(c);
  }

  async start(program: Program) {
    const ctx = this.context();
    await ctx.resume();
    this.retire(this.deck, ctx.currentTime);
    this.waiting = null;
    this.before = null;
    this.lastStep = -Infinity;
    this.deck = this.spawn(program);
    this.deck.player.start({ time: ctx.currentTime + 0.05, bar: this.startBar });
  }

  stop() {
    this.retire(this.deck, this.ctx?.currentTime ?? 0);
    this.deck = null;
    this.waiting = null;
    this.before = null;
    void this.ctx?.suspend();
  }

  /**
   * Plays `program` from the playing player's next downbeat: when the old player schedules its next step 0, the new
   * one starts on that time and bar of the form, and the old bus is cut over the last 30 ms before it. Calls made
   * while one waits only change what it will start.
   */
  swap(program: Program, before?: (bar: number) => void) {
    if (!this.deck || !this.running) return;
    const waiting = this.waiting;
    this.waiting = program;
    if (before) this.before = before;
    if (waiting) return;
    const old = this.deck;
    const off = old.player.onStep(({ step, time }) => {
      if (step !== 0 || !this.waiting || this.deck !== old) return;
      off();
      // The step being heard now is in the bar before this downbeat.
      const bar = old.player.getTransport().bar + 1;
      // A take starting here resets the market and the step clock before the new player reads the state.
      const before = this.before;
      this.before = null;
      if (before) {
        before(bar);
        this.lastStep = -Infinity;
      }
      const next = this.spawn(this.waiting);
      this.waiting = null;
      this.deck = next;
      next.player.start({ time, bar });
      this.retire(old, time);
      this.swaps += 1;
    });
  }

  /** Cuts a player's bus just before `at` and lets it go once that has passed. */
  private retire(deck: Deck | null, at: number) {
    if (!deck || !this.ctx) return;
    const g = deck.bus.gain;
    const from = Math.max(this.ctx.currentTime, at - 0.03);
    g.cancelScheduledValues(from);
    g.setValueAtTime(1, from);
    g.linearRampToValueAtTime(0, Math.max(from + 0.005, at));
    window.setTimeout(() => {
      deck.player.stop();
      deck.bus.disconnect();
    }, Math.max(0, (at - this.ctx.currentTime) * 1000) + 400);
  }

  /** Fills timeData / freqData: RMS and peak (0..1, after the safety stage) and the spectral centroid in Hz. */
  sample(): { rms: number; peak: number; centroid: number } {
    if (!this.analyser || !this.ctx) return { rms: 0, peak: 0, centroid: 0 };
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    let peak = 0;
    for (const v of this.timeData) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    let w = 0;
    let m = 0;
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.freqData.forEach((v, i) => {
      w += v * i * binHz;
      m += v;
    });
    return { rms: Math.sqrt(sum / this.timeData.length), peak, centroid: m ? w / m : 0 };
  }
}
