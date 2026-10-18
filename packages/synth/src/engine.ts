import type { StepHit } from "./clock.ts";
import { eraByIndex, epochOf, genreKey, type Era, type GenreId } from "./eras.ts";
import { styleOf, type GenreStyle } from "./styles.ts";
import type { IdleGains } from "./idle.ts";
import { arrange, euclid, type Arrangement, type Section } from "./arrange.ts";
import { leadPatch, type LeadPatch } from "./leads.ts";
import { hash32, mulberry32 } from "./hash.ts";
import { bassAt, midiToFreq, type SequencerState } from "./state.ts";

/**
 * Genre engine. The chain drives RHYTHM and TIMBRE, not pitch:
 * - arrange() turns trade tiers/density into a capped groove; each genre maps the four rows to its own voices;
 * - pool tick -> filter/timbre movement (`color`), buy/sell pressure -> darkness/drive/space (`press`);
 * - whales and drops -> structural events (impact, throw, fill), never a key change;
 * - harmony is one tonic per genre instance (eras.ts genreKey) and the genre's small note set.
 */

/** Voice gains that follow the idle stage (IdleGains.heat is a multiplier, not a bus). */
type IdleVoice = Exclude<keyof IdleGains, "heat">;

/** Soft-knee ceiling, about -1.2 dBFS, so the master stays under -1 dBFS. */
export const MASTER_CEILING = 0.87;

export function ceilingCurve(ceiling = MASTER_CEILING): Float32Array {
  const n = 2049;
  const curve = new Float32Array(n);
  const knee = 0.42;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const sign = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    let y = a;
    if (a > knee) {
      const t = (a - knee) / (1 - knee);
      y = knee + (ceiling - knee) * (Math.tanh(t * 1.35) / Math.tanh(1.35));
    }
    curve[i] = sign * Math.min(ceiling, y);
  }
  return curve;
}

function bitCurve(bits: number): Float32Array {
  const n = 257;
  const curve = new Float32Array(n);
  const levels = 2 ** (Math.max(2, bits) - 1);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

function tanhCurve(drive: number): Float32Array {
  const n = 1025;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

function makeNoise(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const samples = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rnd = mulberry32(seed);
  for (let i = 0; i < samples; i++) data[i] = rnd() * 2 - 1;
  return buffer;
}

/** Vinyl: soft hiss plus sparse crackle pops, seeded. */
function makeVinyl(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 2);
  const buffer = ctx.createBuffer(1, n, sr);
  const data = buffer.getChannelData(0);
  const rnd = mulberry32(seed);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp = lp * 0.6 + (rnd() * 2 - 1) * 0.4;
    data[i] = lp * 0.35;
  }
  const pops = 28;
  for (let k = 0; k < pops; k++) {
    const at = Math.floor(rnd() * (n - 400));
    const amp = (0.3 + rnd() * 0.7) * (rnd() < 0.5 ? -1 : 1);
    const len = 20 + Math.floor(rnd() * 120);
    for (let i = 0; i < len; i++) data[at + i] += amp * Math.exp(-i / (len * 0.25)) * (i % 2 === 0 ? 1 : -0.6);
  }
  return buffer;
}

/** Inharmonic metal burst. Seeded, so a page's metal stays put. */
function makeMetal(ctx: BaseAudioContext, seed: number, base: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * (decay * 6 + 0.02));
  const buffer = ctx.createBuffer(1, n, sr);
  const data = buffer.getChannelData(0);
  const rnd = mulberry32(seed);
  const ratios = [1, 1.42, 1.73, 2.21, 2.87, 3.37, 4.19];
  const phases = ratios.map(() => rnd() * Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-i / (sr * decay));
    let s = 0;
    for (let k = 0; k < ratios.length; k++) {
      const amp = k === 0 ? 0.42 : 0.16;
      s += Math.sin(phases[k] + (2 * Math.PI * base * ratios[k] * i) / sr) * amp;
    }
    data[i] = Math.tanh(s * 1.7) * env;
  }
  return buffer;
}

/**
 * Every envelope lands on exactly 0, not -80 dB: a voice's resonant filter keeps ringing after its source stops,
 * and Chromium cuts that tail at a moment that depends on the main thread. At 0 the cut cannot reach the mix.
 */
function pulse(gain: AudioParam, time: number, attack: number, peak: number, release: number) {
  const a = Math.max(0.001, attack);
  const peakSafe = Math.max(0.001, peak);
  gain.cancelScheduledValues(time);
  gain.setValueAtTime(0.0001, time);
  gain.exponentialRampToValueAtTime(peakSafe, time + a);
  gain.exponentialRampToValueAtTime(0.0001, time + a + Math.max(0.01, release));
  gain.setValueAtTime(0, time + a + Math.max(0.01, release));
}

function dispose(node: AudioBufferSourceNode | OscillatorNode, rest: AudioNode[], when: number, live: boolean) {
  node.stop(when);
  if (!live) return;
  node.onended = () => {
    try {
      node.disconnect();
    } catch {
      /* already stopped */
    }
    for (const item of rest) {
      try {
        item.disconnect();
      } catch {
        /* already stopped */
      }
    }
  };
}

function stereo(node: AudioNode) {
  node.channelCount = 2;
  node.channelCountMode = "explicit";
  node.channelInterpretation = "speakers";
}

/** 0..1 triangle fold: a slowly moving pool tick becomes a continuous timbre control with no wrap jumps. */
function fold(x: number): number {
  const f = x - Math.floor(x);
  return f < 0.5 ? f * 2 : 2 - f * 2;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/**
 * Sums inputs two at a time. A node with three or more inputs is not bit-exact
 * across OfflineAudioContext renders in Chromium (1 LSB). Live playback connects
 * straight through; the click-free bus matters more there than sample identity.
 */
export class MixChain {
  private acc: AudioNode | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    readonly dest: AudioNode,
    private readonly live: boolean,
  ) {}

  add(source: AudioNode) {
    if (this.live || this.acc == null) {
      source.connect(this.dest);
      this.acc ??= source;
      return;
    }
    const sum = this.ctx.createGain();
    stereo(sum);
    this.acc.disconnect(this.dest);
    this.acc.connect(sum);
    source.connect(sum);
    sum.connect(this.dest);
    this.acc = sum;
  }
}

type BusName = "kick" | "snare" | "hat" | "perc" | "bass" | "harm" | "lead" | "tex" | "fx";
const BUSES: readonly BusName[] = ["kick", "snare", "hat", "perc", "bass", "harm", "lead", "tex", "fx"];

/** Per-genre mix and space. Echo is tempo-synced (feed-forward taps, see echoSet); space is a fixed multi-tap room. */
interface Mix {
  echo: { steps: number; taps: number; fb: number; lp: number; hp: number };
  /** Bus -> echo send. */
  echoSend: Partial<Record<BusName, number>>;
  /** Bus -> space send. */
  spaceSend: Partial<Record<BusName, number>>;
  /** Space length multiplier and decay per tap. */
  space: { size: number; fb: number; lp: number };
  /** Drum lowpass (kick/snare/hat/perc). 18000 is open. */
  drumLp: number;
  /** Master drive into the tanh stage, and how much buy pressure adds. */
  drive: number;
  pressDrive: number;
  /** Floor of the song-form master filter opening (0..1): ambient genres never close all the way. */
  toneFloor: number;
  /** Kick sidechain depth on bass / harm (1 = no duck). */
  duck: { bass: number; harm: number };
  /** Duck recovery time in seconds (default bass 0.2, harm 0.26). */
  duckTime?: { bass: number; harm: number };
}

const MIX: Record<GenreId, Mix> = {
  dubtechno: {
    echo: { steps: 3, taps: 8, fb: 0.68, lp: 2300, hp: 320 },
    echoSend: { harm: 0.7, snare: 0.75, fx: 0.95, perc: 0.6 },
    // The kick's room is dark and short: the space highpass keeps the sub dry, only its warmth blooms.
    spaceSend: { harm: 0.35, snare: 0.3, hat: 0.16, perc: 0.15, kick: 0.12, fx: 0.3 },
    space: { size: 1.3, fb: 0.74, lp: 3800 },
    drumLp: 10000,
    drive: 1.05,
    pressDrive: 0.2,
    toneFloor: 0.4,
    // The sub steps aside for the whole kick body, so the two share the low end instead of beating.
    duck: { bass: 0.15, harm: 0.7 },
    duckTime: { bass: 0.34, harm: 0.3 },
  },
  electro: {
    echo: { steps: 3, taps: 5, fb: 0.52, lp: 3400, hp: 380 },
    echoSend: { lead: 0.6, perc: 0.35, snare: 0.12 },
    spaceSend: { lead: 0.35, snare: 0.18, perc: 0.2 },
    space: { size: 1, fb: 0.7, lp: 5200 },
    drumLp: 15000,
    drive: 1.1,
    pressDrive: 0.3,
    toneFloor: 0.35,
    duck: { bass: 0.6, harm: 1 },
  },
  acid: {
    echo: { steps: 3, taps: 4, fb: 0.45, lp: 2600, hp: 400 },
    echoSend: { bass: 0.16, perc: 0.3 },
    spaceSend: { snare: 0.18, perc: 0.2, bass: 0.06 },
    space: { size: 0.8, fb: 0.66, lp: 5000 },
    drumLp: 15000,
    drive: 1.15,
    pressDrive: 0.45,
    toneFloor: 0.35,
    duck: { bass: 0.72, harm: 1 },
  },
  ambientidm: {
    echo: { steps: 6, taps: 5, fb: 0.52, lp: 2400, hp: 260 },
    echoSend: { lead: 0.64, harm: 0.12, perc: 0.3 },
    spaceSend: { harm: 0.55, lead: 0.72, snare: 0.22, hat: 0.1, tex: 0.2, fx: 0.4 },
    space: { size: 1.7, fb: 0.78, lp: 3600 },
    drumLp: 6500,
    drive: 1.02,
    pressDrive: 0.1,
    toneFloor: 0.65,
    duck: { bass: 0.85, harm: 0.88 },
  },
  liquid: {
    echo: { steps: 3, taps: 4, fb: 0.5, lp: 3200, hp: 420 },
    echoSend: { lead: 0.32, snare: 0.12, perc: 0.2 },
    spaceSend: { harm: 0.5, lead: 0.58, snare: 0.3, hat: 0.1, fx: 0.35 },
    space: { size: 1.4, fb: 0.74, lp: 5200 },
    drumLp: 16000,
    drive: 1.42,
    pressDrive: 0.22,
    toneFloor: 0.5,
    duck: { bass: 0.55, harm: 0.78 },
  },
  futuregarage: {
    echo: { steps: 3, taps: 5, fb: 0.55, lp: 2600, hp: 350 },
    echoSend: { lead: 0.5, snare: 0.3, perc: 0.3 },
    spaceSend: { harm: 0.5, lead: 0.45, snare: 0.35, hat: 0.1, fx: 0.4, tex: 0.2 },
    space: { size: 1.6, fb: 0.78, lp: 3800 },
    drumLp: 11000,
    drive: 1.05,
    pressDrive: 0.15,
    toneFloor: 0.5,
    duck: { bass: 0.5, harm: 0.75 },
  },
  triphop: {
    echo: { steps: 3, taps: 4, fb: 0.45, lp: 2200, hp: 300 },
    echoSend: { snare: 0.2, fx: 0.5 },
    spaceSend: { snare: 0.45, harm: 0.4, fx: 0.3, tex: 0.1 },
    space: { size: 1.3, fb: 0.74, lp: 3400 },
    drumLp: 9000,
    drive: 1.12,
    pressDrive: 0.25,
    toneFloor: 0.45,
    duck: { bass: 0.7, harm: 0.85 },
  },
  lofihouse: {
    echo: { steps: 3, taps: 4, fb: 0.45, lp: 2800, hp: 380 },
    echoSend: { lead: 0.3, perc: 0.2 },
    spaceSend: { lead: 0.3, snare: 0.25, hat: 0.1, harm: 0.3 },
    space: { size: 1, fb: 0.7, lp: 4200 },
    drumLp: 9500,
    drive: 1.08,
    pressDrive: 0.2,
    toneFloor: 0.45,
    duck: { bass: 0.55, harm: 0.7 },
  },
  wonky: {
    echo: { steps: 3, taps: 4, fb: 0.46, lp: 2600, hp: 420 },
    echoSend: { lead: 0.42, perc: 0.22, fx: 0.45 },
    spaceSend: { harm: 0.32, lead: 0.45, snare: 0.16, fx: 0.35, tex: 0.08 },
    space: { size: 1.15, fb: 0.72, lp: 4200 },
    // Drums lead: the kit stays open and dry, the chords sit under a duck.
    drumLp: 14000,
    drive: 1.1,
    pressDrive: 0.22,
    toneFloor: 0.45,
    duck: { bass: 0.6, harm: 0.8 },
  },
  drone: {
    echo: { steps: 8, taps: 6, fb: 0.62, lp: 1800, hp: 220 },
    echoSend: { perc: 0.55, hat: 0.4 },
    spaceSend: { harm: 0.6, perc: 0.75, hat: 0.7, kick: 0.6, tex: 0.5, fx: 0.6 },
    space: { size: 2.1, fb: 0.82, lp: 2600 },
    drumLp: 240,
    drive: 1.02,
    pressDrive: 0.1,
    toneFloor: 0.7,
    duck: { bass: 1, harm: 1 },
  },
};

interface KickSpec {
  osc?: OscillatorType;
  start: number;
  end: number;
  sweep: number;
  decay: number;
  click: number;
  clickHp?: number;
  /** tanh drive on the body (per hit). */
  drive?: number;
  body?: number;
}

/** Per-hit context shared by the genre voices. */
interface Ctx {
  hit: StepHit;
  arr: Arrangement;
  v: number[][];
  step: number;
  /** Bar-global 16th index, for polyrhythms that run across bar lines. */
  n: number;
  t: number;
  dur: number;
  vel: number;
  sec: Section;
  epoch: number;
  /** Style of this genre instance (styles.ts): index into GENRE_STYLES[genre] and its entry. Branch on style.id. */
  styleIndex: number;
  style: GenreStyle;
  /** Tonic pitch class (fixed per genre instance). */
  tonic: number;
  /** Bass register tonic MIDI, E1..D#2. */
  low: number;
  /** Pool tick folded to 0..1: filter/timbre movement. */
  color: number;
  /** Buy/sell pressure -1..1 (sell .. buy). */
  press: number;
  heat: number;
  pan: number;
}

const rowCount = (row: number[]) => row.reduce((a, x) => a + (x > 0 ? 1 : 0), 0);
const rowMax = (row: number[]) => row.reduce((a, x) => Math.max(a, x), 0);

/**
 * Persistent voice graph. Pattern changes only affect what gets scheduled;
 * the buses stay connected, so a setState at a step boundary does not click.
 */
export class VoiceEngine {
  readonly ctx: BaseAudioContext;
  readonly era: Era;
  /** Dub techno swaps in its style's mix on the first hit (DUB_MIX); every other genre keeps MIX. */
  private mix: Mix;
  private readonly live: boolean;
  private readonly bus = {} as Record<BusName, GainNode>;
  private readonly busIn = {} as Record<BusName, MixChain>;
  private readonly bassDuck: GainNode;
  private readonly harmDuck: GainNode;
  /** Song-form lowpass on the whole music bus (SPEC §4.4), darkened by sell pressure. */
  private readonly tone: BiquadFilterNode;
  /**
   * Where the song-form filter is headed (Hz). Tracked here, not read back from AudioParam.value: before an
   * offline render starts that getter does not reflect the automation, and each bar's glide started near 0 Hz.
   */
  private toneHz = 16000;
  private readonly drive: GainNode;
  private readonly master: GainNode;
  /** Style loudness trim (styles.ts `trim`), set when the instance's epoch is known. */
  private readonly styleGain: GainNode;
  private readonly mains: MixChain;
  private readonly echoIn: GainNode;
  private readonly echoLevel: GainNode;
  private readonly spaceLevel: GainNode;
  /** One fixed-time echo per genre instance, at its first tempo. Automating DelayNode.delayTime is not bit-exact in Chromium. */
  private echoBuilt = false;
  private idleReady = false;
  private idleNow: Record<IdleVoice, number> = { kick: 1, snare: 1, hat: 1, glitch: 1, bass: 1, pad: 1, lead: 1, drone: 0 };
  private idleSet: Record<IdleVoice, number> = { kick: -1, snare: -1, hat: -1, glitch: -1, bass: -1, pad: -1, lead: -1, drone: -1 };
  private macro = { primed: false, drive: 0, echo: 0, space: 0 };
  private noiseCache = new Map<number, AudioBuffer>();
  private bufCache = new Map<string, AudioBuffer>();
  private patternId = 0;
  /** Sustained voices (pad, drone, hiss) run until this time; a new one starts on its phrase or when this runs out. */
  private padUntil = -1;
  /** Drone glints: no new one before this time. */
  private droneGlintNext = -1;
  private droneGlassAt = 0;
  private texUntil = -1;
  /** Dub techno: field texture runs until this time; the echo loop lowpasses and where their sweep is headed. */
  private fieldUntil = -1;
  private echoLp: BiquadFilterNode[] = [];
  private dubEchoHz = 0;
  private dubEchoBar = -1;
  private drumLp!: BiquadFilterNode;
  private sends!: { echoSum: MixChain; spaceSum: MixChain; spaceIn: GainNode };
  private lastLeadFreq = 0;
  /** Wonky Glitch-hop: the rubber bass glides from its last note. */
  private wonkyLastBass = 0;
  /**
   * Epoch of this genre instance (the first hit it played). Tonic, figures and patches come from it, so an
   * auditioned genre keeps its key across epoch changes; following the chain, a new epoch is a new instance.
   */
  private instance = -1;
  private readonly trim: number;

  constructor(ctx: BaseAudioContext, eraIndex = 0) {
    this.ctx = ctx;
    this.era = eraByIndex(eraIndex);
    this.mix = MIX[this.era.id];
    this.live = typeof AudioContext !== "undefined" && ctx instanceof AudioContext;
    const gain = (value = 1) => {
      const g = ctx.createGain();
      g.gain.value = value;
      stereo(g);
      return g;
    };
    this.master = gain(0.5 * this.era.trim);
    this.trim = this.era.trim;
    this.styleGain = gain();
    this.master.connect(this.styleGain);
    this.mains = new MixChain(ctx, this.master, this.live);
    this.drive = gain(this.mix.drive);
    for (const name of BUSES) {
      this.bus[name] = gain();
      this.busIn[name] = new MixChain(ctx, this.bus[name], this.live);
    }
    this.bassDuck = gain();
    this.harmDuck = gain();

    // Drums: kick+snare and hat+perc in pairs, then one lowpass (lofi / behind-a-wall genres close it).
    const pairA = gain();
    const pairB = gain();
    const drumSum = gain();
    this.bus.kick.connect(pairA);
    this.bus.snare.connect(pairA);
    this.bus.hat.connect(pairB);
    this.bus.perc.connect(pairB);
    pairA.connect(drumSum);
    pairB.connect(drumSum);
    const drumLp = ctx.createBiquadFilter();
    drumLp.type = "lowpass";
    drumLp.frequency.value = this.mix.drumLp;
    drumLp.Q.value = 0.5;
    drumSum.connect(drumLp);
    this.drumLp = drumLp;

    const sum = gain();
    const music = new MixChain(ctx, sum, false);
    music.add(drumLp);
    this.bus.bass.connect(this.bassDuck);
    music.add(this.bassDuck);
    this.bus.harm.connect(this.harmDuck);
    music.add(this.harmDuck);
    music.add(this.bus.lead);
    music.add(this.bus.tex);
    music.add(this.bus.fx);

    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 16000;
    this.tone.Q.value = 0.6;
    const shaper = ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.55));
    // Oversample and DynamicsCompressor are not bit-exact across two OfflineAudioContext renders in Chromium.
    shaper.oversample = "none";
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = this.era.hp;
    hp.Q.value = 0.7;
    sum.connect(this.tone);
    this.tone.connect(this.drive);
    this.drive.connect(shaper);
    shaper.connect(hp);
    this.mains.add(hp);

    // Sends, post bus gain (so idle stages and the song form carry into the tails).
    this.echoIn = gain();
    this.echoLevel = gain();
    this.spaceLevel = gain();
    const echoSum = new MixChain(ctx, this.echoIn, this.live);
    const spaceIn = gain();
    const spaceSum = new MixChain(ctx, spaceIn, this.live);
    if (!this.live) {
      // Offline only: a -120 dB constant keeps the echo and room chains from ever going silent. A silent chain's
      // delays and filters finish their tails and Chromium disables them at a moment that depends on the main
      // thread, which moved offline renders by a few ULP from run to run. The master highpass removes the offset.
      const keep = ctx.createConstantSource();
      keep.offset.value = 1e-6;
      keep.start(0);
      echoSum.add(keep);
      spaceSum.add(keep);
    }
    this.sends = { echoSum, spaceSum, spaceIn };
    // Dub techno's sends and room depend on the style, known only at the first hit.
    if (this.era.id !== "dubtechno") this.wireSends();
  }

  /** Bus sends into the echo and the room, the echo into the room, and the room itself. */
  private wireSends() {
    const { echoSum, spaceSum, spaceIn } = this.sends;
    const gain = (value = 1) => {
      const g = this.ctx.createGain();
      g.gain.value = value;
      stereo(g);
      return g;
    };
    for (const name of BUSES) {
      const tap = name === "bass" ? this.bassDuck : name === "harm" ? this.harmDuck : this.bus[name];
      const e = this.mix.echoSend[name] ?? 0;
      if (e > 0) {
        const g = gain(e);
        tap.connect(g);
        echoSum.add(g);
      }
      const s = this.mix.spaceSend[name] ?? 0;
      if (s > 0) {
        const g = gain(s);
        tap.connect(g);
        spaceSum.add(g);
      }
    }
    this.echoIn.connect(this.echoLevel);
    // The echo also feeds the room a little, so the throws bloom instead of ticking.
    const echoToSpace = gain(0.25);
    this.echoLevel.connect(echoToSpace);
    spaceSum.add(echoToSpace);
    spaceIn.connect(this.spaceLevel);
    this.buildSpace(this.spaceLevel);
  }

  connect(destination: AudioNode) {
    this.styleGain.connect(destination);
  }

  /** Soft open / close of the whole mix. Voices themselves always ramp. */
  fade(to: number, time: number, seconds: number) {
    const gain = this.master.gain;
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(Math.max(0.0001, gain.value), time);
    gain.linearRampToValueAtTime(Math.max(0.0001, to), time + seconds);
  }

  trigger(hit: StepHit, primary = true) {
    // SPEC §4.3: voices play the arrangement of the on-chain grid, never the raw bits.
    const arr = arrange(hit.state, hit.bar);
    const state = hit.state;
    this.patternId = state.patternId >>> 0;
    // Heat effects fade with the idle stage (1 in full, 0 at drone): a riser never drones over silence.
    const heatFade = hit.idle?.heat ?? 1;
    const heat = clamp(state.heat ?? 0, 0, 1) * heatFade;
    if (this.instance < 0) {
      this.instance = epochOf(state);
      const first = styleOf(this.era, this.instance).style;
      this.styleGain.gain.value = first.trim ?? 1;
      if (this.era.id === "dubtechno") {
        this.mix = { ...MIX.dubtechno, ...DUB_MIX[first.id] };
        this.drumLp.frequency.value = this.mix.drumLp;
        this.drive.gain.value = this.mix.drive;
        this.wireSends();
      }
    }
    const epoch = this.instance;
    const { index: styleIndex, style } = styleOf(this.era, epoch);
    const tonic = genreKey(this.era, epoch);
    const c: Ctx = {
      hit,
      arr,
      v: arr.vel,
      step: hit.step,
      n: hit.bar * 16 + hit.step,
      t: hit.time,
      dur: hit.duration,
      vel: hit.velocity,
      sec: arr.section,
      epoch,
      styleIndex,
      style,
      tonic,
      low: 28 + ((tonic - 4 + 12) % 12),
      // One fold per 1500 ticks (~16% price move): the timbre follows the price level, it does not flicker per swap.
      color: fold((state.lastTick | 0) / 1500 + 0.25),
      press: clamp((state.pressure | 0) / 12000, -1, 1),
      heat,
      pan: ((hash32(this.patternId, hit.step, 4) % 100) / 99 - 0.5) * 0.5,
    };
    this.applyMacro(c, hit.tempo ?? 60 / (hit.duration * 4));
    this.followIdle(hit, primary, arr.section, c);
    switch (this.era.id) {
      case "dubtechno":
        this.dubTechno(c);
        break;
      case "electro":
        this.electro(c);
        break;
      case "acid":
        this.acid(c);
        break;
      case "ambientidm":
        this.ambientIdm(c);
        break;
      case "drone":
        this.drone(c);
        break;
      case "liquid":
        this.liquid(c);
        break;
      case "futuregarage":
        this.futureGarage(c);
        break;
      case "triphop":
        this.tripHop(c);
        break;
      case "lofihouse":
        this.lofiHouse(c);
        break;
      case "wonky":
        this.wonky(c);
        break;
    }
    if (c.step === 0) {
      const bed = hit.idle?.drone ?? 0;
      if (bed > 0.01) this.droneTone(c, bed);
      if (primary) {
        const floor = this.mix.toneFloor;
        const opening = floor + (1 - floor) * c.sec.filter;
        if (hit.trackDrop) this.openNow(c.t);
        else this.sweep(c.t, c.dur * 16, heat > 0 ? opening + (1 - opening) * heat : opening, c.press);
        // Drone takes heat as quicker breathing, never as a swell that rises through each bar.
        if (heat > 0 && this.era.id !== "drone") this.riser(c, heatFade);
      }
    }
  }

  // ------------------------------------------------------------------ genres

  /**
   * Dub techno after Brickman (Lucidflow, Deepindub): warm, deep and rolling, not the cold Basic Channel skeleton.
   * A round kick on every beat, a sub rolling with it on the chord root, a soft clap on 2 and 4, an offbeat open hat
   * over a swung 16th shaker and a little tuned percussion; a voice-led minor progression (m9 / m11 / maj9, two to
   * four chords over 8-16 bars) as filtered stabs into a dotted echo, a soft pad underneath that glues it, sparse
   * bell fragments on the chord, rain and tape hiss. The song form brings the layers in and out; the stab, pad and
   * echo-loop filters sweep over 8-32 bars. Heat opens them and throws stabs into the echo, sells darken them, the
   * chain's density adds the figures' answers and the shaker's in-between 16ths.
   * Lucidflow is the main groove, Ixtlan the ambient journey, The Moment the tight minimal loop.
   */
  private dubTechno(c: Ctx) {
    const d = this.dubStyle(c);
    const { v, step, t, sec } = c;
    const bar = c.hit.bar;
    const chord = this.dubChordAt(c, d);
    if (step === 0) {
      this.dubEchoSweep(c, d);
      this.dubPad(c, d, chord);
      this.vinyl(c, d.vinyl);
      if (d.field > 0) this.dubField(c, d.field, d.fieldHz);
    }
    if (this.fourFloor(c)) {
      this.dubKick(c, c.vel * (step === 0 ? 1 : 0.93), d.kick);
      this.duck(t);
    }
    // Sub: the style's rolling figure on the chord root; the fifth and the octave only as passing tones.
    const note = d.bass.notes.find(([s]) => s === step);
    if (note && c.arr.bass !== 0n) {
      this.dubSub(c, this.dubBassRoot(c, chord) + (note[3] ?? 0), note[1] * c.dur, note[2] * d.bass.level, d.bass);
    }
    // Soft clap (or rim) on 2 and 4, mostly heard in the echo.
    if (sec.snare > 0 && rowMax(v[1]) > 0 && (step === 4 || step === 12)) {
      this.dubClap(c, c.vel * d.clap.level * sec.snare * (step === 12 ? 1 : 0.88), d.clap);
    }
    // Hats: an open hat on every offbeat and a swung 16th shaker; low density keeps only the shaker's offbeat 16ths.
    if (sec.hat > 0 && rowMax(v[2]) > 0) {
      const h = d.hat;
      if (step % 4 === 2 && h.off > 0) this.hat(t, c.vel * h.off * sec.hat, { hp: h.hp, decay: h.decay, metal: h.metal, pan: 0.12 });
      const accent = h.shuffle[step % 4];
      const dense = c.arr.energy > 0.35 || v[2][step] > 0 || c.heat > 0.4;
      if (accent > 0 && (step % 2 === 1 || dense)) {
        this.dubShaker(c, c.vel * h.shaker * accent * sec.hat, h.shakerDecay, step % 4 === 3 ? 0.32 : -0.28);
      }
    }
    // Tuned percussion: a two-bar figure on tonic and fifth, in when the glitch tier or heat is.
    if (sec.glitch > 0 && d.perc.level > 0 && (rowCount(v[3]) > 0 || c.heat > 0.3)) {
      const p = d.perc.figure.find(([s]) => s === (((bar % 2) + 2) % 2) * 16 + step);
      if (p) this.dubPerc(c, c.vel * d.perc.level * p[2] * sec.glitch, p[1], d.perc.decay);
    }
    // The stab: one figure per epoch. Density adds the figure's answer; the intro keeps its first hit from bar 4.
    const fig = d.figures[hash32(c.epoch, 0x57ab) % d.figures.length];
    const busy = rowCount(v[1]) >= 2 || c.arr.energy > 0.55 || c.heat > 0.5;
    const hits = busy ? fig : fig.slice(0, Math.max(1, fig.length - 1));
    const idx = hits.indexOf(step);
    if (idx >= 0 && (sec.name !== "intro" || (sec.bar >= 4 && idx === 0))) {
      // Heat throws: the last hit of every fourth bar goes hard into the echo instead.
      const throwIt = c.heat > 0.35 && idx === hits.length - 1 && ((bar % 4) + 4) % 4 === 3;
      this.dubStab(c, d.accents[idx % d.accents.length], throwIt ? "fx" : "harm");
    }
    // Bell fragments: a few long chord tones every `every` four-bar phrases, when the song form lets the lead in.
    if (sec.lead > 0 && d.bell.level > 0) {
      const phrase = Math.floor(bar / 4);
      if (((phrase % d.bell.every) + d.bell.every) % d.bell.every === d.bell.every - 1) {
        const frag = d.bell.frags[hash32(c.epoch, phrase, 0xbe11) % d.bell.frags.length];
        const pos = (((bar % 4) + 4) % 4) * 16 + step;
        const b = frag.find(([s]) => s === pos);
        if (b) {
          const tones = chord.upper;
          this.dubBell(c, this.dubBase(c) + 12 + tones[Math.max(0, tones.length - 1 - b[1])], c.vel * d.bell.level * b[2] * sec.lead, d.bell);
        }
      }
    }
  }

  private dubStyle(c: Ctx): DubStyle {
    return DUB_STYLES[c.style.id] ?? DUB_STYLES.classic;
  }

  /** Stab / pad register: the tonic between D3 and C#4. */
  private dubBase(c: Ctx): number {
    return 50 + ((c.tonic - 2 + 12) % 12);
  }

  /** The chord of this bar: one progression per epoch, each chord held `bars` bars. */
  private dubChordAt(c: Ctx, d: DubStyle): DubChord {
    const prog = d.progs[hash32(c.epoch, 0xc407) % d.progs.length];
    const i = Math.floor(c.hit.bar / prog.bars);
    return DUB_CHORDS[prog.seq[((i % prog.seq.length) + prog.seq.length) % prog.seq.length]];
  }

  /** The sub's root for a chord, folded into E1..D#2 so the low end never jumps out of the kick's register. */
  private dubBassRoot(c: Ctx, chord: DubChord): number {
    let m = c.low + chord.root;
    while (m < 28) m += 12;
    while (m >= 40) m -= 12;
    return m;
  }

  /** 0..1 over `period` bars, phase per epoch: the slow hand on the filter knobs. */
  private dubSlow(c: Ctx, period: number, salt: number): number {
    const phase = (hash32(c.epoch, salt) % 1000) / 1000;
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * (c.hit.bar / period + phase));
  }

  /** Once a bar: the echo loop's lowpass glides toward this bar's opening (slow sweep, heat opens, sells darken). */
  private dubEchoSweep(c: Ctx, d: DubStyle) {
    if (this.echoLp.length === 0 || c.hit.bar === this.dubEchoBar) return;
    this.dubEchoBar = c.hit.bar;
    const slow = this.dubSlow(c, d.echoPeriod, 0xd0e1);
    const dark = c.press < 0 ? 1 + 0.45 * c.press : 1 + 0.12 * c.press;
    const target = this.mix.echo.lp * (0.55 + 0.8 * slow) * (1 + 0.5 * c.heat) * dark;
    const from = this.dubEchoHz > 0 ? this.dubEchoHz : target;
    for (const f of this.echoLp) {
      f.frequency.setValueAtTime(from, c.t);
      f.frequency.linearRampToValueAtTime(target, c.t + c.dur * 16);
    }
    this.dubEchoHz = target;
  }

  /**
   * The chord stab: the bar's chord (upper voicing, the sub plays the root) on detuned oscillators through a
   * lowpass whose envelope closes fast; the echo and the room make the bloom. The cutoff follows the style's slow
   * sweep, a faster `move` wobble over four bars, the pool tick, heat and pressure.
   */
  private dubStab(c: Ctx, level: number, bus: "harm" | "fx") {
    const d = this.dubStyle(c);
    const s = d.stab;
    const t = c.t;
    const base = this.dubBase(c) + s.octave;
    const voicing = this.dubChordAt(c, d).upper;
    const slow = this.dubSlow(c, d.stabPeriod, 0xd0e2);
    const wobble = 1 + s.move * (0.5 - 0.5 * Math.cos((2 * Math.PI * (((c.n % 64) + 64) % 64)) / 64) - 0.5);
    const dark = c.press < 0 ? 1 + 0.4 * c.press : 1 + 0.12 * c.press;
    const cutoff = s.lp * (0.55 + 0.9 * slow) * wobble * (0.85 + 0.3 * c.color) * (1 + 0.6 * c.heat) * dark * (bus === "fx" ? 1.25 : 1);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 170;
    hp.Q.value = 0.5;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = s.q;
    f.frequency.setValueAtTime(cutoff * s.env, t);
    f.frequency.exponentialRampToValueAtTime(cutoff, t + s.envTime);
    const amp = this.ctx.createGain();
    const end = t + s.attack + s.release;
    pulse(amp.gain, t, s.attack, s.gain * level * c.vel, s.release);
    hp.connect(f);
    f.connect(amp);
    const pan = this.panNode(bus === "fx" ? c.pan * 1.2 : s.pan, this.busIn[bus]);
    pan.add(amp);
    let chain: AudioNode | null = null;
    const oscs: OscillatorNode[] = [];
    const rest: AudioNode[] = [];
    for (const semi of voicing) {
      for (const cents of [-s.detune, s.detune]) {
        const osc = this.ctx.createOscillator();
        osc.type = s.wave;
        osc.frequency.setValueAtTime(midiToFreq(base + semi), t);
        osc.detune.setValueAtTime(cents, t);
        const g = this.ctx.createGain();
        g.gain.value = 0.3;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    }
    chain!.connect(hp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? [...rest, hp, f, amp, pan.dest] : [], end + 0.02));
  }

  /**
   * The pad: the bar's chord with its root an octave under, held for the whole chord and crossfading into the next.
   * Detuned oscillators under a lowpass that swells and settles across the chord. It sits in the room, not the
   * echo, and is not ducked, so it glues the stabs and the sub together.
   */
  private dubPad(c: Ctx, d: DubStyle, chord: DubChord) {
    const p = d.pad;
    if (p.level <= 0) return;
    const barSec = c.dur * 16;
    const prog = d.progs[hash32(c.epoch, 0xc407) % d.progs.length];
    const pos = ((c.hit.bar % prog.bars) + prog.bars) % prog.bars;
    if (pos !== 0 && c.t < this.padUntil - barSec * 0.25) return;
    const t = c.t;
    const hold = (prog.bars - pos) * barSec;
    this.padUntil = t + hold;
    const end = t + hold + p.release;
    const base = this.dubBase(c) + p.octave;
    const notes = [base + (((chord.root % 12) + 12) % 12) - 12, ...chord.upper.map((s) => base + s)];
    const slow = this.dubSlow(c, d.stabPeriod, 0xd0e5);
    const dark = c.press < 0 ? 1 + 0.35 * c.press : 1;
    const lo = p.lp * (0.6 + 0.4 * slow) * dark;
    const hi = lo * (1.5 + 0.6 * c.heat);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(lo, t);
    f.frequency.linearRampToValueAtTime(hi, t + hold * 0.55);
    f.frequency.linearRampToValueAtTime(lo, end);
    const amp = this.ctx.createGain();
    const peak = 0.05 * p.level * (0.55 + 0.45 * c.sec.pad) * (c.hit.idle?.pad ?? 1);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + p.attack);
    amp.gain.setValueAtTime(peak, t + Math.max(p.attack, hold));
    amp.gain.linearRampToValueAtTime(0, end);
    f.connect(amp);
    const pan = this.panNode(c.hit.bar % 2 === 0 ? -0.15 : 0.15, this.busIn.tex);
    pan.add(amp);
    let chain: AudioNode | null = null;
    const oscs: OscillatorNode[] = [];
    const rest: AudioNode[] = [];
    notes.forEach((m, k) => {
      for (const cents of [-p.detune, p.detune]) {
        const osc = this.ctx.createOscillator();
        osc.type = p.wave;
        osc.frequency.setValueAtTime(midiToFreq(m), t);
        osc.detune.setValueAtTime(cents, t);
        const g = this.ctx.createGain();
        g.gain.value = k === 0 ? 0.5 : 0.32;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    chain!.connect(f);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? [...rest, f, amp, pan.dest] : [], end + 0.02));
  }

  /** Bell / soft pluck: a sine with a harmonic FM partial that fades faster than the note, on the lead bus into the echo. */
  private dubBell(c: Ctx, midi: number, level: number, b: DubStyle["bell"]) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const car = this.ctx.createOscillator();
    car.type = "sine";
    car.frequency.setValueAtTime(freq, t);
    const mod = this.ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(freq * b.ratio, t);
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(freq * b.index, t);
    depth.gain.exponentialRampToValueAtTime(Math.max(1, freq * b.index * 0.05), t + b.decay * 0.5);
    mod.connect(depth);
    depth.connect(car.frequency);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    lp.Q.value = 0.5;
    const amp = this.ctx.createGain();
    pulse(amp.gain, t, 0.006, 0.16 * level, b.decay);
    car.connect(lp);
    lp.connect(amp);
    const pan = this.panNode(c.step < 8 ? -0.3 : 0.3, this.busIn.lead);
    pan.add(amp);
    car.start(t);
    mod.start(t);
    this.end(car, [lp, amp, pan.dest], t + b.decay + 0.05);
    this.end(mod, [depth], t + b.decay + 0.05);
  }

  /** Dub sub: a round sine with a little octave so it reads on small speakers, through warm tanh and a closed lowpass. */
  private dubSub(c: Ctx, midi: number, length: number, level: number, b: DubStyle["bass"]) {
    const t = c.t;
    const len = Math.max(0.06, length);
    const freq = midiToFreq(midi);
    const a = this.ctx.createOscillator();
    a.type = "sine";
    a.frequency.setValueAtTime(freq, t);
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 2, t);
    const og = this.ctx.createGain();
    og.gain.value = b.octave;
    o.connect(og);
    const sum = this.ctx.createGain();
    a.connect(sum);
    og.connect(sum);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.3));
    shaper.oversample = "none";
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = b.lp * (1 + 0.15 * c.heat);
    lp.Q.value = 0.5;
    const amp = this.ctx.createGain();
    const peak = 0.24 * level * c.vel;
    const endAt = t + len + b.release;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + b.attack);
    amp.gain.setValueAtTime(peak, t + Math.max(b.attack, len * 0.5));
    amp.gain.linearRampToValueAtTime(peak * 0.8, t + len);
    amp.gain.linearRampToValueAtTime(0, endAt);
    sum.connect(shaper);
    shaper.connect(lp);
    lp.connect(amp);
    this.busIn.bass.add(amp);
    a.start(t);
    o.start(t);
    this.end(a, [og, sum, shaper, lp, amp], endAt + 0.02);
    this.end(o, [], endAt + 0.02);
  }

  /** Field texture: a bar of band-limited noise (rain on a window, a far room), slowly swelling. */
  private dubField(c: Ctx, level: number, hz: number) {
    const bar = c.dur * 16;
    if (c.t < this.fieldUntil - bar * 0.5) return;
    this.fieldUntil = c.t + bar;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = hz * (0.8 + 0.4 * this.dubSlow(c, 8, 0xd0e3));
    bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    const peak = 0.03 * level * (1 + 0.5 * Math.max(0, -c.press));
    g.gain.setValueAtTime(0.0001, c.t);
    g.gain.linearRampToValueAtTime(peak, c.t + bar * 0.4);
    g.gain.linearRampToValueAtTime(peak * 0.7, c.t + bar);
    g.gain.linearRampToValueAtTime(0.0001, c.t + bar + 0.2);
    g.gain.setValueAtTime(0, c.t + bar + 0.2);
    src.connect(bp);
    bp.connect(g);
    const pan = this.panNode(c.hit.bar % 2 === 0 ? -0.3 : 0.3, this.busIn.tex);
    pan.add(g);
    src.start(c.t, (hash32(c.hit.bar, 0xd0e4) % 1000) / 1000);
    this.end(src, [bp, g, pan.dest], c.t + bar + 0.25);
  }

  /**
   * Dub techno kick: a long round sine tuned to the key (root or fifth nearest `center` Hz), a soft pitch fall,
   * tanh warmth under a closed lowpass so the harmonics stay felt, and only a hint of click.
   */
  private dubKick(c: Ctx, velocity: number, k: DubKick) {
    const t = c.t;
    let freq = 0;
    for (let m = 24; m < 48; m++) {
      const pc = (m - c.tonic + 12) % 12;
      if (pc !== 0 && pc !== 7) continue;
      const f = midiToFreq(m);
      if (freq === 0 || Math.abs(f - k.center) < Math.abs(freq - k.center)) freq = f;
    }
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * k.rise, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + k.sweep);
    // Attack, a slow first fall (the round body) and then the long tail.
    const env = this.ctx.createGain();
    const peak = 0.62 * velocity;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    env.gain.exponentialRampToValueAtTime(peak * 0.55, t + k.hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t + k.decay);
    env.gain.setValueAtTime(0, t + k.decay);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(k.drive));
    shaper.oversample = "none";
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = k.lp;
    lp.Q.value = 0.5;
    osc.connect(env);
    env.connect(shaper);
    const out = this.ctx.createGain();
    out.gain.value = k.level;
    shaper.connect(lp);
    lp.connect(out);
    this.busIn.kick.add(out);
    osc.start(t);
    this.end(osc, [env, shaper, lp, out], t + k.decay + 0.05);
    if (k.click > 0) {
      this.noiseHit(t, 0.2 * velocity * k.click, { type: "bandpass", freq: k.clickHz, q: 0.9, decay: 0.012, pan: 0, bus: this.busIn.kick });
    }
  }

  /** Soft clap: three close noise bursts and a short tail on the snare bus, which feeds the echo. Or a muted rim. */
  private dubClap(c: Ctx, level: number, k: DubStyle["clap"]) {
    if (k.rim) {
      this.rim(c.t, level, -0.15, k.hz / 1700);
      return;
    }
    for (let i = 0; i < 3; i++) {
      this.noiseHit(c.t + i * 0.009, level * (i === 2 ? 1 : 0.6), { type: "bandpass", freq: k.hz, q: 0.9, decay: i === 2 ? k.decay : 0.014, pan: -0.12, bus: this.busIn.snare });
    }
  }

  /** Soft shaker: band-limited noise with a short swell, on the hat bus. */
  private dubShaker(c: Ctx, level: number, decay: number, pan: number) {
    this.noiseHit(c.t, level, {
      type: "bandpass", freq: 4200 + c.color * 1600, q: 1.1, attack: 0.004, decay, pan, bus: this.busIn.hat,
    });
  }

  /** Tuned hand percussion: a short sine knock on the tonic (G3..F#4) or its fifth, into the echo. */
  private dubPerc(c: Ctx, level: number, ratio: number, decay: number) {
    const freq = midiToFreq(55 + ((c.tonic - 7 + 12) % 12)) * ratio;
    this.toneHit(c.t, level, { type: "sine", freq: freq * 1.4, to: freq, sweep: 0.025, decay, pan: ratio > 1 ? 0.38 : -0.38, bus: this.busIn.perc });
  }

  /**
   * Electro. Style 0 is Cold 808 (Cybotron / Model 500): a sparse 808 break, a 1–3 note
   * resonant bass and one cold fifth. Client_03 is dark swung machine funk: a hard 808 break with ghost
   * snares, a staggering grimy bass and ghostly pads. Alien Rave is the modern dancefloor cousin
   * (Denso, Manao): hard break, snarling 16th bass, hoovers and lasers.
   */
  private electro(c: Ctx) {
    if (c.style.id === "client03") {
      this.electroClient(c);
      return;
    }
    if (c.style.id === "alienrave") {
      this.electroAlien(c);
      return;
    }
    const { v, step, t, sec } = c;
    const k = rowCount(v[0]);
    const lvl = rowMax(v[0]);
    if (k > 0 && lvl > 0) {
      const figs = k <= 2 ? [[0, 10]] : k <= 4 ? [[0, 6, 10], [0, 10, 11]] : [[0, 3, 6, 10], [0, 6, 10, 11], [0, 3, 10, 14]];
      let fig = figs[hash32(c.epoch, k, 0xe1) % figs.length];
      if (sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30)) fig = [0];
      if (fig.includes(step)) {
        // Rounder 808: a longer pitch drop into a low body, less click than the other styles.
        this.kick(t, c.vel * lvl * (step === 0 ? 1 : 0.85), { start: 190, end: 46, sweep: 0.07, decay: 0.62, click: 0.1, drive: 1.4, body: 1.02 });
        this.duck(t);
      }
    }
    // 808 snare on the backbeat (and the chain's fill rolls); ghosts stay out of a cold groove.
    if (v[1][step] >= 0.9 || (v[1][step] > 0 && step >= 13)) this.snare808(t, c.vel * v[1][step], -c.pan * 0.3);
    if (v[2][step] > 0) {
      const open = step % 8 === 6 && rowCount(v[2]) >= 8;
      this.hat(t, c.vel * v[2][step] * 0.5, { hp: 7400, decay: open ? 0.14 : 0.03, metal: 0.9, pan: c.pan * 0.6, q: 1.5 });
    }
    if (v[3][step] > 0) this.zap(c, c.vel * 0.5);
    // Bass arpeggio: the chain's onsets cycle through one, two or three notes (density decides how many).
    const onsets = this.onsets(c.arr.bass);
    const at = onsets.indexOf(step);
    if (at >= 0) {
      const sets = [[0, 12, 10], [0, 12, 7], [0, 10, 12]];
      const set = sets[hash32(c.epoch, 0xa2) % sets.length].slice(0, onsets.length <= 2 ? 1 : onsets.length <= 4 ? 2 : 3);
      this.electroBass(c, c.low + 12 + set[at % set.length], this.holdSteps(c.arr.bass, step, 2) * c.dur);
    }
    // Cold stabs: at most one per two bars, on the motif's first onset, as an open fifth.
    if (sec.lead > 0 && c.hit.bar % 2 === 1) {
      const first = c.arr.motif.findIndex((x, i) => x != null && i >= 2);
      if (first === step) {
        const note = c.arr.motif[step]!;
        const notes = this.era.notes;
        const base = 60 + c.tonic + notes[note.deg % notes.length];
        this.motifNote(c, base, Math.min(2, note.len) * c.dur, sec.lead * 0.8);
        this.motifNote(c, base + 7, Math.min(2, note.len) * c.dur, sec.lead * 0.5);
      }
    }
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.snare808(time, vel, 0));
  }

  /**
   * Client_03 (Cultivated Electronics): dark machine funk. A swung 808 electro break with a crisp snare and
   * clap, a ghost-snare funk layer and chopped, warped break hats; a staggering grimy mono bass is the hook;
   * ghostly minor pads, a few sci-fi blips and a crushed computer-voice fragment sit underneath.
   * The figures are composed per epoch; the chain decides how much of them plays and how bright.
   */
  private electroClient(c: Ctx) {
    const { v, step, t, sec } = c;
    const half = sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30);
    const chord = this.clientChord(c);
    const odd = (c.hit.bar & 1) === 1;
    const k = rowCount(v[0]);
    const lvl = rowMax(v[0]);
    if (k > 0 && lvl > 0) {
      const bank = half ? CLIENT_KICK_HALF : k <= 2 ? CLIENT_KICK_LO : k <= 4 ? CLIENT_KICK_MID : CLIENT_KICK_HI;
      const fig = bank[hash32(c.epoch, k, 0xc11) % bank.length];
      if ((odd ? fig.b : fig.a).includes(step)) {
        // 808 with a short click: round enough to boom, tight enough to punch through the bass.
        this.kick(t, c.vel * lvl * (step === 0 ? 1.2 : 1.05), {
          start: 168, end: 47, sweep: 0.042, decay: 0.44, click: 0.3, clickHp: 2600,
          drive: 1.8 + 0.6 * c.heat + 0.4 * Math.max(0, c.press), body: 1.12,
        });
        this.duck(t, 0.5, 0.16);
      }
    }
    if (rowMax(v[1]) > 0) {
      if (step === 4 || step === 12) this.clientSnare(c, c.vel * Math.max(0.65, sec.snare));
      else if (v[1][step] > 0 && step >= 13 && sec.name !== "intro") this.clientGhost(c, c.vel * v[1][step] * 0.8, c.t);
      if (!half) this.clientGhostStep(c);
    }
    if (rowCount(v[2]) > 0) this.clientHatStep(c, half);
    if (v[3][step] > 0 && sec.name !== "intro") this.clientBlip(c, chord, c.vel * v[3][step]);
    this.clientBassStep(c, chord);
    if (sec.pad > 0 && step === 0 && c.hit.bar % 2 === 0) this.clientPad(c, chord);
    this.clientVoiceStep(c);
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.clientGhost(c, vel * 1.3, time));
  }

  /** This bar's chord: a four-chord progression per epoch, two bars a chord. */
  private clientChord(c: Ctx): ClientChord {
    const prog = CLIENT_PROGRESSIONS[hash32(c.epoch, 0xc20) % CLIENT_PROGRESSIONS.length];
    return CLIENT_CHORDS[prog[(((c.hit.bar >> 1) % 4) + 4) % 4]];
  }

  /** Crisp 808 snare: a short tuned body, a bright noise snap and a clap layered a hair late. */
  private clientSnare(c: Ctx, velocity: number) {
    const t = c.t;
    const pan = -c.pan * 0.15;
    this.toneHit(t, 0.5 * velocity, { type: "triangle", freq: 246, to: 188, sweep: 0.04, decay: 0.08, pan, bus: this.busIn.snare });
    this.toneHit(t, 0.22 * velocity, { type: "triangle", freq: 492, decay: 0.035, pan, bus: this.busIn.snare });
    this.noiseHit(t, 0.82 * velocity, { type: "highpass", freq: 2300 + 700 * c.color, q: 0.8, decay: 0.17, pan, bus: this.busIn.snare });
    this.clap(t + 0.006, velocity * 0.5, c.pan * 0.25);
  }

  /** Ghost snare from a break: a short bandpassed slice with a low tick, quiet. `time` lets rolls reuse it. */
  private clientGhost(c: Ctx, velocity: number, time: number) {
    this.noiseHit(time, 0.42 * velocity, { type: "bandpass", freq: 1900 + 500 * c.color, q: 0.9, decay: 0.06, pan: c.pan * 0.5, bus: this.busIn.snare });
    this.toneHit(time, 0.16 * velocity, { type: "triangle", freq: 210, to: 175, sweep: 0.02, decay: 0.03, pan: c.pan * 0.5, bus: this.busIn.snare });
  }

  /** The funk layer: a composed ghost figure per epoch. A quiet chain plays its core, a busy one the whole figure. */
  private clientGhostStep(c: Ctx) {
    const fig = CLIENT_GHOSTS[hash32(c.epoch, 0xc13) % CLIENT_GHOSTS.length];
    const hit = fig.find((x) => x.s === (c.hit.bar & 1) * 16 + c.step);
    if (!hit) return;
    const busy = c.arr.energy > 0.4 || rowCount(c.v[1]) >= 4 || c.heat > 0.45;
    if (!hit.core && !busy) return;
    this.clientGhost(c, c.vel * hit.vel, c.t);
  }

  /**
   * Chopped break hats. Each step of the bar has its own slice pitch (a warped break, not a drum machine),
   * accents fall on the offbeats, one open slice per epoch figure, and the chop steps stutter in 32nds
   * when the chain is busy or hot.
   */
  private clientHatStep(c: Ctx, half: boolean) {
    const { v, step } = c;
    const warp = CLIENT_HAT_WARP[hash32(c.epoch, 0xc14) % CLIENT_HAT_WARP.length];
    const chops = CLIENT_HAT_CHOPS[hash32(c.epoch, 0xc15) % CLIENT_HAT_CHOPS.length];
    const hats = rowCount(v[2]);
    const play = v[2][step] > 0 || (hats >= 6 && !half && step % 2 === 0);
    if (!play) return;
    const open = hats >= 4 && step === chops.open;
    const hp = (open ? 5200 : 7600 + 2200 * c.color) * warp[step];
    const accent = open ? 0.62 : step % 4 === 2 ? 0.6 : step % 2 === 0 ? 0.44 : 0.32;
    const level = c.vel * Math.max(0.55, v[2][step]) * accent;
    this.hat(c.t, level, { hp, decay: open ? 0.1 : 0.022 + 0.012 * (warp[step] < 1 ? 1 : 0), metal: open ? 0.25 : 0.4, pan: c.pan * 0.8, q: 1.1 });
    // A grain of the break's snare body under the hat, so the slices sound cut from a loop.
    this.noiseHit(c.t, 0.05 * level, { type: "bandpass", freq: 3400 * warp[step], q: 1.6, decay: 0.03, pan: -c.pan * 0.4, bus: this.busIn.perc });
    const chop = chops.steps.includes(step) && (c.arr.energy > 0.45 || c.heat > 0.3 || hats >= 8) && !half;
    if (chop) {
      for (let i = 1; i < 3; i++) {
        this.hat(c.t + (i * c.dur) / 3, level * (0.8 - 0.2 * i), { hp: hp * (1 - 0.08 * i), decay: 0.016, metal: 0.3, pan: -c.pan * 0.8, q: 1.4 });
      }
    }
  }

  /**
   * The bass line: a two-bar figure per epoch over the chord root, full of rests and dead notes.
   * A quiet chain plays the core notes, a normal one the line, a busy one adds the ornaments.
   * The breakdown holds the bar's first note.
   */
  private clientBassStep(c: Ctx, chord: ClientChord) {
    if (c.sec.bass <= 0 || c.arr.bass === 0n) return;
    const fig = CLIENT_BASS[hash32(c.epoch, 0xc40) % CLIENT_BASS.length];
    const pos = (c.hit.bar & 1) * 16 + c.step;
    const at = fig.findIndex((x) => x.s === pos);
    if (at < 0) return;
    const note = fig[at];
    const onsets = this.onsets(c.arr.bass).length;
    const breakdown = c.sec.name === "breakdown";
    const tier = breakdown || onsets <= 2 ? 0 : onsets >= 6 || c.arr.energy > 0.6 || c.heat > 0.7 ? 2 : 1;
    const accent = (note.f & 1) !== 0;
    if (breakdown && c.step !== 0) return;
    if ((note.f & 4) !== 0 && tier < 2) return;
    if (tier === 0 && !accent) return;
    const root = c.low + 12 + chord.bass;
    const pitch = (s: number) => {
      const pc = ((s % 12) + 12) % 12;
      return root + s + (pc === 3 ? chord.third - 3 : pc === 10 ? chord.seventh - 10 : 0);
    };
    const prev = fig[(at + fig.length - 1) % fig.length];
    const from = (note.f & 2) !== 0 ? pitch(prev.semi) : null;
    const ghost = (note.f & 8) !== 0;
    const length = breakdown ? c.dur * 12 : note.len * c.dur * (ghost ? 0.5 : 0.9);
    this.clientBass(c, pitch(note.semi), from, length, accent, ghost);
  }

  /**
   * Grimy mono bass: saw and square into two cascaded lowpasses (a 24 dB slope with an envelope),
   * then tanh. A clean sine an octave down carries the weight. Dead notes barely open the filter.
   * The tick and buy pressure open it, sell pressure shuts it and adds resonance, heat adds grit.
   */
  private clientBass(c: Ctx, midi: number, from: number | null, length: number, accent: boolean, ghost: boolean) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const buy = Math.max(0, c.press);
    const sell = Math.max(0, -c.press);
    const floorHz = Math.max(110, (150 + 260 * c.color + 220 * buy) * (1 - 0.3 * sell));
    const peakHz = ghost ? floorHz * 1.6 : Math.min(5200, floorHz * (accent ? 7 : 4.2) * (1 + 0.4 * c.heat));
    const env = ghost ? 0.03 : accent ? 0.16 : 0.1;
    const lps: BiquadFilterNode[] = [];
    for (let i = 0; i < 2; i++) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = i === 0 ? 0.7 : (accent ? 5.5 : 3.8) + 2.5 * sell;
      lp.frequency.setValueAtTime(peakHz, t);
      lp.frequency.exponentialRampToValueAtTime(floorHz, t + env);
      lps.push(lp);
    }
    lps[0].connect(lps[1]);
    const hold = Math.max(0.035, length);
    const amp = this.ctx.createGain();
    const peak = ghost ? 0.08 : accent ? 0.19 : 0.155;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setValueAtTime(peak * 0.8, t + hold * 0.75);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.02);
    amp.gain.setValueAtTime(0, t + hold + 0.02);
    const startF = from !== null ? midiToFreq(from) : freq;
    const glide = from !== null ? 0.05 : 0.001;
    const oscs: OscillatorNode[] = [];
    const rest: AudioNode[] = [...lps];
    let chain: AudioNode | null = null;
    for (const [type, cents, level] of [["sawtooth", -6, 0.5], ["square", 7, 0.34]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(startF, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + glide);
      osc.detune.setValueAtTime(cents, t);
      const g = this.ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(2.4 + 1.4 * c.heat + 0.5 * buy));
    shaper.oversample = "none";
    chain!.connect(lps[0]);
    lps[1].connect(shaper);
    shaper.connect(amp);
    rest.push(shaper, amp);
    if (!ghost) {
      const sub = this.ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(startF / 2, t);
      sub.frequency.exponentialRampToValueAtTime(freq / 2, t + glide);
      const sg = this.ctx.createGain();
      sg.gain.value = accent ? 1.45 : 1.2;
      sub.connect(sg);
      sg.connect(amp);
      rest.push(sg);
      oscs.push(sub);
    }
    this.busIn.bass.add(amp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + hold + 0.06));
  }

  /**
   * Ghostly pad: the chord as three slow, detuned triangle pairs and a faint sine an octave up, through
   * a dark lowpass that breathes over the two bars. A little of it goes to the lead bus for the echo and room.
   */
  private clientPad(c: Ctx, chord: ClientChord) {
    const t = c.t;
    const length = c.dur * 32;
    const base = 50 + ((c.tonic - 2 + 12) % 12);
    const level = c.sec.pad * (0.7 + 0.3 * c.arr.energy);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.4;
    const dark = (700 + 1100 * c.color + 500 * c.heat) * (1 - 0.3 * Math.max(0, -c.press));
    lp.frequency.setValueAtTime(dark * 0.6, t);
    lp.frequency.linearRampToValueAtTime(dark, t + length * 0.45);
    lp.frequency.linearRampToValueAtTime(dark * 0.55, t + length);
    const amp = this.ctx.createGain();
    const attack = Math.min(0.9, length * 0.2);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.11 * level, t + attack);
    amp.gain.setValueAtTime(0.11 * level, t + length * 0.7);
    amp.gain.linearRampToValueAtTime(0.0001, t + length + 0.3);
    amp.gain.setValueAtTime(0, t + length + 0.3);
    lp.connect(amp);
    const pan = this.panNode(-0.12, this.busIn.harm);
    pan.add(amp);
    const send = this.ctx.createGain();
    send.gain.value = 0.35;
    amp.connect(send);
    this.busIn.lead.add(send);
    const rest: AudioNode[] = [lp, amp, pan.dest, send];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    const voices: [OscillatorType, number, number, number][] = [];
    for (const semi of chord.pad) {
      voices.push(["triangle", base + semi, -9, 0.5], ["triangle", base + semi, 8, 0.5]);
    }
    voices.push(["sine", base + chord.pad[0] + 12, 0, 0.18]);
    for (const [type, midi, cents, gain] of voices) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(midiToFreq(midi), t);
      osc.detune.setValueAtTime(cents, t);
      const g = this.ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    chain!.connect(lp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + length + 0.35));
  }

  /** Sci-fi blip on the glitch row: a short square pip on a chord tone, high up, dropping a hair; into the echo. */
  private clientBlip(c: Ctx, chord: ClientChord, velocity: number) {
    const t = c.t;
    const tones = chord.pad;
    const semi = tones[hash32(c.epoch, c.n, 0xc30) % tones.length];
    const midi = 74 + ((c.tonic - 2 + 12) % 12) + semi;
    const freq = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.pulseWave(0.5));
    osc.frequency.setValueAtTime(freq * (1 + 0.03 * c.color), t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.97, t + 0.05);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(Math.min(9000, freq * (2.5 + 2 * c.color)), t);
    const g = this.ctx.createGain();
    pulse(g.gain, t, 0.001, 0.09 * velocity, 0.05);
    osc.connect(lp);
    lp.connect(g);
    const pan = this.panNode(c.pan * 1.8, this.busIn.lead);
    pan.add(g);
    osc.start(t);
    this.end(osc, [lp, g, pan.dest], t + 0.1);
  }

  /** The computer voice: one word per epoch, every eight bars in the full section and once in the breakdown. */
  private clientVoiceStep(c: Ctx) {
    const word = CLIENT_WORDS[hash32(c.epoch, 0xc50) % CLIENT_WORDS.length];
    const sec = c.sec;
    const on =
      (sec.name === "full" && c.hit.bar % 8 === 6 && c.step === word.s) ||
      (sec.name === "breakdown" && sec.bar % 8 === 2 && c.step === word.s);
    if (!on) return;
    this.clientVoice(c, word);
  }

  /**
   * Speak-and-spell fragment: a monotone narrow pulse through two formant bandpasses that jump (not glide)
   * from syllable to syllable, gated per syllable, crushed to a few bits and band-limited like a cheap speaker.
   * Consonants are short noise ticks. Quiet, so it reads as a fragment in the back, not a hook.
   */
  private clientVoice(c: Ctx, word: ClientWord) {
    const t = c.t;
    const f0 = 118 + 10 * (hash32(c.epoch, 0xc51) % 3);
    const syl = c.dur * 1.5;
    const total = syl * word.syl.length;
    const src = this.ctx.createOscillator();
    src.setPeriodicWave(this.pulseWave(0.2));
    src.frequency.setValueAtTime(f0, t);
    // The last syllable falls, like a machine reading out the end of a word.
    src.frequency.setValueAtTime(f0, t + total - syl);
    src.frequency.linearRampToValueAtTime(f0 * 0.84, t + total);
    const gate = this.ctx.createGain();
    gate.gain.setValueAtTime(0, t);
    const rest: AudioNode[] = [gate];
    let chain: AudioNode | null = null;
    const bps: BiquadFilterNode[] = [];
    for (let f = 0; f < 2; f++) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = f === 0 ? 6 : 8;
      const g = this.ctx.createGain();
      g.gain.value = f === 0 ? 1 : 0.7;
      src.connect(bp);
      bp.connect(g);
      rest.push(bp, g);
      chain = this.pairSum(chain, g, rest);
      bps.push(bp);
    }
    word.syl.forEach(([f1, f2, cons], i) => {
      const at = t + i * syl;
      bps[0].frequency.setValueAtTime(f1, at);
      bps[1].frequency.setValueAtTime(f2, at);
      gate.gain.setValueAtTime(0, at);
      gate.gain.linearRampToValueAtTime(1, at + 0.012);
      gate.gain.setValueAtTime(1, at + syl * 0.72);
      gate.gain.linearRampToValueAtTime(0, at + syl * 0.86);
      if (cons) {
        this.noiseHit(at, 0.03 * Math.max(0.6, c.sec.lead), {
          type: cons === "s" ? "highpass" : "bandpass", freq: cons === "s" ? 5200 : 2600, q: 1.2, decay: cons === "s" ? 0.06 : 0.015, pan: 0.3, bus: this.busIn.lead,
        });
      }
    });
    gate.gain.setValueAtTime(0, t + total);
    chain!.connect(gate);
    const crush = this.ctx.createWaveShaper();
    crush.curve = new Float32Array(bitCurve(4));
    crush.oversample = "none";
    const pre = this.ctx.createGain();
    pre.gain.value = 3.2;
    gate.connect(pre);
    pre.connect(crush);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 340;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3600;
    const out = this.ctx.createGain();
    out.gain.value = 0.06 * Math.max(0.6, c.sec.lead);
    crush.connect(hp);
    hp.connect(lp);
    lp.connect(out);
    const pan = this.panNode(0.3, this.busIn.lead);
    pan.add(out);
    rest.push(pre, crush, hp, lp, out, pan.dest);
    src.start(t);
    this.end(src, rest, t + total + 0.05);
  }

  /**
   * Alien Rave (Denso, Manao "Electro Phase"): a punchy, straight 909-ish electro break, a gritty FM-edged
   * 16th bass riding a four-bar minor progression, hoover stabs on top, a sci-fi arp and a robot formant
   * call when the floor is full. Lasers on the glitch row, a riser into every section change.
   * The figures are composed per epoch; the chain only decides how much of them plays and how bright.
   */
  private electroAlien(c: Ctx) {
    const { v, step, t, sec } = c;
    const half = sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30);
    const chord = this.alienChord(c);
    const k = rowCount(v[0]);
    const lvl = rowMax(v[0]);
    if (k > 0 && lvl > 0) {
      const bank = half ? ALIEN_KICK_HALF : k <= 2 ? ALIEN_KICK_LO : k <= 4 ? ALIEN_KICK_MID : ALIEN_KICK_HI;
      const fig = bank[hash32(c.epoch, k, 0xa11) % bank.length];
      if (fig.includes(step)) {
        // Tight 909-ish body with a hard click; buy pressure and heat push the drive.
        this.kick(t, c.vel * lvl * (step === 0 ? 1.25 : 1.1), {
          start: 172, end: 48, sweep: 0.034, decay: 0.3, click: 0.5, clickHp: 2400,
          drive: 2 + 0.8 * Math.max(0, c.press) + 0.8 * c.heat, body: 1.08,
        });
        this.duck(t);
      }
    }
    if (rowMax(v[1]) > 0) {
      if (step === 4 || step === 12) this.alienSnare(c, 1.35 * c.vel * Math.max(0.6, sec.snare));
      else if (v[1][step] > 0 && step >= 13 && sec.name !== "intro") this.alienTom(c, c.vel * v[1][step], step);
      else if (v[1][step] > 0 && v[1][step] < 0.75) this.rim(t, c.vel * v[1][step] * 0.32, c.pan * 0.8, 1.45);
    }
    const hats = rowCount(v[2]);
    if (hats > 0) {
      // A busy hat row locks into straight 16ths; a quiet one plays only the chain's steps.
      const play = v[2][step] > 0 || (hats >= 7 && !half);
      const opens = ALIEN_OPEN_HATS[hash32(c.epoch, 0xa12) % ALIEN_OPEN_HATS.length];
      const open = hats >= 4 && opens.includes(step);
      if (open) {
        this.hat(t, c.vel * 0.5, { hp: 6200, decay: 0.11, metal: 0.45, pan: c.pan * 0.3, q: 0.8 });
      } else if (play) {
        const accent = step % 4 === 2 ? 0.56 : step % 2 === 0 ? 0.42 : 0.3;
        this.hat(t, c.vel * Math.max(0.5, v[2][step]) * accent, { hp: 9400 + 1400 * c.color, decay: 0.019, metal: 0.6, pan: c.pan * 0.7, q: 1.3 });
      }
      if (c.heat > 0.15 && play) this.hatRoll(c, 9800);
    }
    if (v[3][step] > 0) this.alienLaser(c, c.vel * v[3][step]);
    this.alienBassStep(c, chord);
    if (sec.lead > 0) this.alienStabStep(c, chord);
    const arpOn = sec.texture > 0 || (sec.name === "build" && sec.bar >= 12 && c.arr.energy > 0.5) || c.heat > 0.6;
    if (arpOn && sec.lead > 0) this.alienArpStep(c, chord);
    this.alienVoxStep(c, chord);
    if (step === 0 && (sec.bar === 15 || sec.bar === 31)) this.alienRiser(c);
    if (step === 0 && sec.bar === 16) this.noiseHit(t, 0.07 * c.vel, { type: "highpass", freq: 4200, q: 0.6, decay: 0.9, pan: 0.1, bus: this.busIn.fx });
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.alienSnare(c, vel * 0.6, time));
  }

  /** This bar's chord: a four-bar progression per epoch, over the instance tonic. */
  private alienChord(c: Ctx): AlienChord {
    const prog = ALIEN_PROGRESSIONS[hash32(c.epoch, 0xa20) % ALIEN_PROGRESSIONS.length];
    return ALIEN_CHORDS[prog[((c.hit.bar % 4) + 4) % 4]];
  }

  /** 909 snare with a clap layered in. `time` lets heat rolls reuse it inside the step. */
  private alienSnare(c: Ctx, velocity: number, time = c.t) {
    this.toneHit(time, 0.36 * velocity, { type: "triangle", freq: 212, to: 168, sweep: 0.03, decay: 0.07, pan: -c.pan * 0.15, bus: this.busIn.snare });
    this.noiseHit(time, 0.6 * velocity, { type: "highpass", freq: 1500 + 600 * c.color, q: 0.7, decay: 0.15, pan: -c.pan * 0.15, bus: this.busIn.snare });
    this.clap(time + 0.004, velocity * 0.42, c.pan * 0.2);
  }

  /** Fill tom: a dropping sine, pitched down the fill so the last 16ths fall into the bar. */
  private alienTom(c: Ctx, velocity: number, step: number) {
    const f = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 210, 170, 135][step];
    this.toneHit(c.t, 0.26 * velocity, { type: "sine", freq: f * 1.6, to: f, sweep: 0.03, decay: 0.16, pan: (15 - step) * 0.25 - 0.25, bus: this.busIn.perc });
    this.noiseHit(c.t, 0.08 * velocity, { type: "bandpass", freq: 2600, q: 1.2, decay: 0.02, pan: 0, bus: this.busIn.perc });
  }

  /** Pitch-dropping laser: a resonant square falling two to four octaves, into the echo. */
  private alienLaser(c: Ctx, velocity: number) {
    const t = c.t;
    const from = 2400 + 2600 * c.color + 1200 * Math.max(0, c.press);
    const to = 140 + (hash32(c.epoch, c.n, 0xa30) % 3) * 60;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.11 + 0.05 * c.heat);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "lowpass";
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(from * 1.2, t);
    bp.frequency.exponentialRampToValueAtTime(to * 3, t + 0.12);
    const g = this.ctx.createGain();
    pulse(g.gain, t, 0.001, 0.28 * velocity, 0.14);
    osc.connect(bp);
    bp.connect(g);
    const pan = this.panNode(c.pan * 1.6, this.busIn.perc);
    pan.add(g);
    osc.start(t);
    this.end(osc, [bp, g, pan.dest], t + 0.2);
  }

  /**
   * The 16th bass: one composed line per epoch, on the bar's chord root. A quiet chain plays the
   * accents only, a normal one the line, a busy one adds the ornaments. Phase lines run a 6- or 10-step
   * cell against the bar (Electro Phase). Breakdown keeps the accents, longer.
   */
  private alienBassStep(c: Ctx, chord: AlienChord) {
    if (c.sec.bass <= 0 || c.arr.bass === 0n) return;
    const line = ALIEN_BASS[hash32(c.epoch, 0xa40) % ALIEN_BASS.length];
    const at = (s: number) => (line.length === 16 ? s % 16 : (c.hit.bar * 16 + s) % line.length);
    const note = line[at(c.step)];
    if (!note) return;
    const [semi, flags] = note;
    const onsets = this.onsets(c.arr.bass).length;
    const breakdown = c.sec.name === "breakdown";
    const tier = breakdown || onsets <= 2 ? 0 : onsets >= 6 || c.arr.energy > 0.6 || c.heat > 0.7 ? 2 : 1;
    if ((flags & 4) !== 0 && tier < 2) return;
    if (tier === 0 && (flags & 1) === 0) return;
    const root = c.low + 12 + chord.bass;
    const prev = line[at(c.step + 15)];
    const from = prev && (prev[1] & 2) !== 0 && c.step > 0 ? root + prev[0] : null;
    const gate = breakdown ? 3.4 : (flags & 2) !== 0 ? 1.05 : 0.62;
    this.alienBass(c, root + semi, from, gate * c.dur, (flags & 1) !== 0);
    if ((flags & 1) !== 0 && semi === 0 && (c.step === 0 || c.step === 8 || breakdown)) {
      this.sub(c, root - 12, Math.min(c.dur * 3, 0.32), 0.5);
    }
  }

  /**
   * Two detuned saws plus an FM sine (modulator at 2x, index decaying fast) for the snarl, into a
   * resonant lowpass with its own envelope, then hard tanh. The pool tick and buy pressure open it,
   * sell pressure shuts it and adds resonance, heat pushes the FM and the drive.
   */
  private alienBass(c: Ctx, midi: number, from: number | null, length: number, accent: boolean) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const buy = Math.max(0, c.press);
    const sell = Math.max(0, -c.press);
    // A slow sweep across eight bars, as a hand on the cutoff.
    const knob = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((c.hit.bar + c.step / 16) / 8 + (hash32(c.epoch, 0xa41) % 4) / 8));
    const floorHz = Math.max(120, (170 + 420 * c.color + 260 * knob + 300 * buy) * (1 - 0.3 * sell));
    const peakHz = Math.min(7000, floorHz * (accent ? 6.5 : 3.6) * (1 + 0.6 * c.heat));
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = (accent ? 9 : 6.5) + 3 * sell;
    lp.frequency.setValueAtTime(peakHz, t);
    lp.frequency.exponentialRampToValueAtTime(floorHz, t + (accent ? 0.11 : 0.07));
    const hold = Math.max(0.05, length);
    const amp = this.ctx.createGain();
    const peak = accent ? 0.2 : 0.155;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setValueAtTime(peak * 0.75, t + hold * 0.7);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + hold);
    amp.gain.setValueAtTime(0, t + hold);
    const startF = from !== null ? midiToFreq(from) : freq;
    const glide = from !== null ? 0.045 : 0.001;
    const oscs: OscillatorNode[] = [];
    const rest: AudioNode[] = [];
    let chain: AudioNode | null = null;
    for (const [type, cents, level] of [["sawtooth", -9, 0.42], ["sawtooth", 10, 0.36]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(startF, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + glide);
      osc.detune.setValueAtTime(cents, t);
      const g = this.ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    const carrier = this.ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(startF, t);
    carrier.frequency.exponentialRampToValueAtTime(freq, t + glide);
    const mod = this.ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(startF * 2, t);
    mod.frequency.exponentialRampToValueAtTime(freq * 2, t + glide);
    const index = this.ctx.createGain();
    const depth = freq * (accent ? 2.2 : 1.3) * (1 + 1.2 * c.heat + 0.6 * buy);
    index.gain.setValueAtTime(depth, t);
    index.gain.exponentialRampToValueAtTime(Math.max(1, depth * 0.18), t + 0.09);
    mod.connect(index);
    index.connect(carrier.frequency);
    const cg = this.ctx.createGain();
    cg.gain.value = 0.44;
    carrier.connect(cg);
    rest.push(index, cg);
    chain = this.pairSum(chain, cg, rest);
    oscs.push(carrier, mod);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(2.1 + 1.2 * c.heat + 0.6 * buy));
    shaper.oversample = "none";
    chain!.connect(lp);
    lp.connect(shaper);
    shaper.connect(amp);
    rest.push(lp, shaper, amp);
    // The weight: a clean sine an octave under every note, outside the filter and the drive.
    const sub = this.ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(startF / 2, t);
    sub.frequency.exponentialRampToValueAtTime(freq / 2, t + glide);
    const sg = this.ctx.createGain();
    sg.gain.value = accent ? 1.5 : 1.25;
    sub.connect(sg);
    sg.connect(amp);
    rest.push(sg);
    oscs.push(sub);
    this.busIn.bass.add(amp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + hold + 0.04));
  }

  /** Hoover stabs: a two-bar figure per epoch on the bar's chord. Core hits whenever the lead layer is open. */
  private alienStabStep(c: Ctx, chord: AlienChord) {
    const fig = ALIEN_STABS[hash32(c.epoch, 0xa50) % ALIEN_STABS.length];
    const hit = fig.find((x) => x.s === (c.hit.bar & 1) * 16 + c.step);
    if (!hit) return;
    const busy = rowCount(c.v[3]) > 0 || c.sec.name === "full" || c.arr.energy > 0.5 || c.heat > 0.55;
    if (!hit.core && !busy) return;
    const level = (hit.core ? 1 : 0.72) * Math.max(0.45, c.sec.lead);
    this.alienHoover(c, chord.tones, hit.len * c.dur, level);
  }

  /**
   * Detuned saw stack, three a note plus a saw an octave under the root. Every voice scoops up from a
   * whole tone below (the hoover bend), a resonant lowpass snaps open and closes. Heat widens the detune.
   */
  private alienHoover(c: Ctx, tones: readonly number[], length: number, level: number) {
    const t = c.t;
    const root = 52 + ((c.tonic - 4 + 12) % 12);
    const buy = Math.max(0, c.press);
    const sell = Math.max(0, -c.press);
    const cut = (900 + 2600 * c.color + 1500 * buy + 1500 * c.heat) * (1 - 0.35 * sell);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 3.2;
    lp.frequency.setValueAtTime(Math.min(12000, cut * 2.4), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, cut * 0.55), t + Math.max(0.09, length * 0.8));
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 180;
    hp.Q.value = 0.7;
    const hold = Math.max(0.06, length * 0.92);
    const amp = this.ctx.createGain();
    const peak = 0.22 * level;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.setValueAtTime(peak * 0.8, t + hold * 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.06);
    amp.gain.setValueAtTime(0, t + hold + 0.06);
    lp.connect(hp);
    hp.connect(amp);
    const pan = this.panNode(0.05, this.busIn.harm);
    pan.add(amp);
    const spread = 1 + 0.8 * c.heat;
    const rest: AudioNode[] = [lp, hp, amp, pan.dest];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    const voices: [number, number, number][] = [];
    tones.forEach((semi) => {
      for (const cents of [-17, 2, 16]) voices.push([root + semi, cents * spread, 0.3]);
    });
    voices.push([root + tones[0] - 12, 0, 0.42]);
    for (const [midi, cents, gain] of voices) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      const f = midiToFreq(midi);
      osc.frequency.setValueAtTime(f * Math.pow(2, -2 / 12), t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      osc.detune.setValueAtTime(cents, t);
      const g = this.ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    chain!.connect(lp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + hold + 0.1));
  }

  /** Sci-fi arp: 16ths through the chord over two octaves, a cell per epoch cycling against the bar. Into the echo. */
  private alienArpStep(c: Ctx, chord: AlienChord) {
    const cell = ALIEN_ARPS[hash32(c.epoch, 0xa60) % ALIEN_ARPS.length];
    // Quiet chains thin it to 8ths; a busy one runs every 16th.
    if (c.step % 2 === 1 && c.arr.energy < 0.45 && c.heat < 0.6) return;
    const i = cell[c.n % cell.length];
    const tones = chord.tones;
    const semi = tones[i % tones.length] + 12 * Math.floor(i / tones.length);
    let midi = 64 + ((c.tonic - 4 + 12) % 12) + semi;
    while (midi > 88) midi -= 12;
    const t = c.t;
    const freq = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.pulseWave(0.25));
    osc.frequency.setValueAtTime(freq, t);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 5;
    const top = Math.min(11000, freq * (3 + 3 * c.color + 2 * Math.max(0, c.press)));
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 1.2), t + 0.08);
    const g = this.ctx.createGain();
    const accent = c.n % cell.length === 0 ? 1.25 : 1;
    pulse(g.gain, t, 0.002, 0.22 * accent * Math.max(0.5, c.sec.lead), 0.09);
    osc.connect(lp);
    lp.connect(g);
    const pan = this.panNode(c.step % 2 === 0 ? -0.35 : 0.35, this.busIn.lead);
    pan.add(g);
    osc.start(t);
    this.end(osc, [lp, g, pan.dest], t + 0.14);
  }

  /** Robot call: a formant stab on the chord root, a four-bar call in the full section, every two bars in the breakdown. */
  private alienVoxStep(c: Ctx, chord: AlienChord) {
    const call = ALIEN_VOX[hash32(c.epoch, 0xa70) % ALIEN_VOX.length];
    const sec = c.sec;
    let on = false;
    if (sec.name === "breakdown") on = c.hit.bar % 2 === 0 && c.step === call.s % 16;
    else if (sec.name === "full" || (sec.name === "build" && sec.bar >= 12)) on = c.hit.bar % 4 === 3 && c.step === call.s;
    if (!on) return;
    this.alienVox(c, 52 + ((c.tonic - 4 + 12) % 12) + chord.tones[0], call.len * c.dur, call.vowels);
  }

  /** Saw and square through two bandpass formants gliding between vowels; ring-modulated so it talks like a machine. */
  private alienVox(c: Ctx, midi: number, length: number, vowels: readonly (readonly [number, number])[]) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const hold = Math.max(0.1, length);
    const saw = this.ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(freq, t);
    const sq = this.ctx.createOscillator();
    sq.type = "square";
    sq.frequency.setValueAtTime(freq * 0.5, t);
    const src = this.ctx.createGain();
    src.gain.value = 0.5;
    saw.connect(src);
    const sqg = this.ctx.createGain();
    sqg.gain.value = 0.3;
    sq.connect(sqg);
    sqg.connect(src);
    // Ring modulator at a fixed alien interval: a carrier gain wobbling at 1.5x the note.
    const ring = this.ctx.createGain();
    ring.gain.value = 0;
    const rm = this.ctx.createOscillator();
    rm.type = "sine";
    rm.frequency.setValueAtTime(freq * 1.5, t);
    rm.connect(ring.gain);
    src.connect(ring);
    const out = this.ctx.createGain();
    const peak = 0.75 * Math.max(0.5, c.sec.lead);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(peak, t + 0.01);
    out.gain.setValueAtTime(peak, t + hold * 0.75);
    out.gain.exponentialRampToValueAtTime(0.0001, t + hold);
    out.gain.setValueAtTime(0, t + hold);
    const rest: AudioNode[] = [src, sqg, ring, out];
    let chain: AudioNode | null = null;
    for (let f = 0; f < 2; f++) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = f === 0 ? 7 : 9;
      vowels.forEach((v, i) => {
        const at = t + (hold * i) / Math.max(1, vowels.length - 1);
        if (i === 0) bp.frequency.setValueAtTime(v[f], at);
        else bp.frequency.linearRampToValueAtTime(v[f], at);
      });
      const g = this.ctx.createGain();
      g.gain.value = f === 0 ? 1 : 0.8;
      ring.connect(bp);
      src.connect(bp);
      bp.connect(g);
      rest.push(bp, g);
      chain = this.pairSum(chain, g, rest);
    }
    chain!.connect(out);
    const pan = this.panNode(-c.pan * 0.6, this.busIn.lead);
    pan.add(out);
    rest.push(pan.dest);
    for (const osc of [saw, sq, rm]) osc.start(t);
    this.end(saw, rest, t + hold + 0.05);
    this.end(sq, [], t + hold + 0.05);
    this.end(rm, [], t + hold + 0.05);
  }

  /** Into a section change: a bar of rising noise and a saw sweeping up two octaves. */
  private alienRiser(c: Ctx) {
    const t = c.t;
    const bar = c.dur * 16;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noise();
    noise.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + bar);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.06 * (1 + c.heat), t + bar * 0.95);
    ng.gain.linearRampToValueAtTime(0.0001, t + bar);
    ng.gain.setValueAtTime(0, t + bar);
    noise.connect(bp);
    bp.connect(ng);
    this.busIn.fx.add(ng);
    noise.start(t);
    this.end(noise, [bp, ng], t + bar + 0.02);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    const f0 = midiToFreq(52 + ((c.tonic - 4 + 12) % 12));
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 4, t + bar);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(6000, t + bar);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.03, t + bar * 0.95);
    g.gain.linearRampToValueAtTime(0.0001, t + bar);
    g.gain.setValueAtTime(0, t + bar);
    osc.connect(lp);
    lp.connect(g);
    this.busIn.fx.add(g);
    osc.start(t);
    this.end(osc, [lp, g], t + bar + 0.02);
  }

  /** Analord: dry 808s, octave answers and a slowly worked resonant saw. */
  private acid(c: Ctx) {
    if (c.style.id === "acidhouse") return this.acidHouse(c);
    if (c.style.id === "rubber") return this.acidRubber(c);
    const { v, step, t } = c;
    if (this.fourFloor(c)) {
      this.kick(t, c.vel * (step === 0 ? 1.2 : 1.08), { start: 125, end: 50, sweep: 0.045, decay: 0.32, click: 0.32, body: 1 });
      this.duck(t, 0.6);
    }
    // Keep 2/4 audible in the build as well as the full section.
    if (v[1][step] > 0 && (step === 4 || step === 12 || step >= 13)) this.clap(t, c.vel * v[1][step] * 1.15, -c.pan * 0.3);
    if (v[2][step] > 0) {
      const open = step % 4 === 2;
      this.hat(t, c.vel * v[2][step] * (open ? 0.6 : 0.52), { hp: 7800, decay: open ? 0.12 : 0.026, metal: 0.9, pan: c.pan * 0.5, q: 1.2 });
    }
    if (v[3][step] > 0) this.cowbell(t, c.vel * 0.32, c.pan);
    this.acid303Line(c);
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.clap(time, vel * 0.7, 0));
  }

  /** Phuture / Armando: straight Chicago machine groove, 909 thump and raspy saw squelch. */
  private acidHouse(c: Ctx) {
    const { v, step, t } = c;
    if (rowMax(v[0]) > 0 && step % 4 === 0) {
      this.kick(t, c.vel * rowMax(v[0]) * (step === 0 ? 1.25 : 1.15), {
        start: 165, end: 49, sweep: 0.028, decay: 0.25, click: 0.48, clickHp: 2600, drive: 2.1, body: 1.2,
      });
      // Deep, slightly held duck: the 303 breathes around the kick instead of sitting on it.
      this.duck(t, 0.42, 0.24);
    }
    if (v[1][step] > 0 && (step === 4 || step === 12)) {
      this.acidHouseClap(c, c.vel * v[1][step] * 1.3);
    } else if (v[1][step] > 0 && c.hit.bar % 4 === 3) {
      this.noiseHit(t, c.vel * v[1][step] * 0.2, { type: "bandpass", freq: 2600, q: 0.7, decay: 0.055, pan: 0, bus: this.busIn.snare });
    }
    const hat = rowMax(v[2]);
    if (hat > 0) {
      const open = step % 4 === 2;
      // Offbeats are structural; the chain adds closed sixteenths around them.
      if (open || step % 2 === 0 || c.arr.density[2] >= 6 || v[2][step] > 0) {
        this.hat(t, c.vel * hat * (open ? 0.68 : step % 2 ? 0.26 : 0.39), {
          hp: open ? 5900 : 6900, decay: open ? 0.105 : 0.018, metal: 0.2, pan: open ? 0.13 : -0.11,
        });
      }
    }
    if (v[3][step] > 0) this.rim(t, c.vel * v[3][step] * 0.35, 0.2, 1.1);
    if (step === 14 && c.arr.density[3] >= 7 && c.sec.glitch > 0) this.cowbell(t, c.vel * 0.23, -0.2);
    this.acid303Line(c);
  }

  /** 909/707-style handclap: four short bursts, broad noisy tail and a quiet snare body. */
  private acidHouseClap(c: Ctx, level: number) {
    for (let i = 0; i < 4; i++) {
      this.noiseHit(c.t + i * 0.009, level * (i === 3 ? 0.64 : 0.5), {
        type: "bandpass", freq: 1700 + c.color * 400, q: 0.65, decay: i === 3 ? 0.17 : 0.012, pan: -0.04, bus: this.busIn.snare,
      });
    }
    this.noiseHit(c.t + 0.015, level * 0.22, { type: "highpass", freq: 3800, q: 0.6, decay: 0.105, pan: 0.06, bus: this.busIn.snare });
    this.toneHit(c.t, level * 0.12, { type: "triangle", freq: 185, to: 155, sweep: 0.03, decay: 0.06, pan: 0, bus: this.busIn.snare });
  }

  /** Slow hollow square, syncopated low glides and space between the drums. */
  private acidRubber(c: Ctx) {
    const { v, step, t, sec } = c;
    const kickLevel = rowMax(v[0]);
    if (kickLevel > 0 && (step === 0 || (step === 8 && rowCount(v[0]) >= 2) || (step === 12 && c.arr.density[0] >= 10))) {
      this.kick(t, c.vel * 1.6 * kickLevel * (step === 0 ? 0.94 : 0.8), {
        start: 100, end: 46, sweep: 0.065, decay: 0.34, click: 0.11, drive: 2.3, body: 1.05,
      });
      // The held square makes room for every kick: deep duck, slow recovery.
      this.duck(t, 0.4, 0.3);
    }
    if (v[1][step] > 0 && (step === 4 || step === 12)) {
      this.clap(t + 0.008, c.vel * v[1][step] * 1.1, -0.08);
      this.rim(t, c.vel * v[1][step] * 0.3, 0.08, 0.8);
    }
    if (v[2][step] > 0 && step % 2 === 0) {
      const open = step === 6 || step === 14;
      this.hat(t, c.vel * v[2][step] * (open ? 0.64 : 0.44), {
        hp: 5900, decay: open ? 0.11 : 0.024, metal: 0.65, pan: open ? 0.12 : -0.13,
      });
    }
    if (v[3][step] > 0 && step % 2 === 1 && sec.glitch > 0) {
      this.toneHit(t, c.vel * v[3][step] * 0.075, { type: "sine", freq: midiToFreq(c.low + 24), to: midiToFreq(c.low + 12), sweep: 0.07, decay: 0.12, pan: c.pan, bus: this.busIn.perc });
    }
    this.acid303Line(c);
  }

  /** Composed per-epoch score. Chain density unmutes ornaments; it never random-walks the pitch. */
  private acid303Pattern(c: Ctx): (Acid303Note | null)[] {
    const rubber = c.style.id === "rubber";
    const bank = rubber ? ACID_RUBBER_LINES : c.style.id === "acidhouse" ? ACID_HOUSE_LINES : ACID_FLOOR_LINES;
    const figure = bank[hash32(c.epoch, rubber ? 0x2b3 : 0x303a) % bank.length];
    const density = this.onsets(c.hit.state.bass).length;
    return figure.map((note, step) => {
      if (!note || ((note.flags & 4) !== 0 && density < (rubber ? 5 : 7))) return null;
      // The last four steps answer up an octave every fourth bar, as a composed phrase variation.
      const octave = note.octave + (!rubber && step >= 12 && c.hit.bar % 4 === 3 && step % 2 === 0 ? 1 : 0);
      return { ...note, octave };
    });
  }

  /** A slide chain is ONE continuous source and filter envelope, including chains of three or more notes. */
  private acid303Line(c: Ctx) {
    if (c.sec.bass <= 0 || c.hit.state.bass === 0n) return;
    const line = this.acid303Pattern(c);
    if (!line[c.step]) return;
    let previous = c.step - 1;
    while (previous >= 0 && !line[previous]) previous--;
    if (previous >= 0 && (line[previous]!.flags & 2) !== 0) return;
    const run: { step: number; note: Acid303Note }[] = [];
    for (let step = c.step; step < 16;) {
      const note = line[step]!;
      run.push({ step: step - c.step, note });
      if ((note.flags & 2) === 0) break;
      const next = line.findIndex((n, s) => s > step && n !== null);
      if (next < 0) break;
      step = next;
    }
    // Accent capacitor: nearby prior accents retain charge, consecutive accents ratchet the wow.
    let charge = 0;
    for (let s = 0; s < c.step; s++) {
      charge *= Math.exp(-c.dur / 0.38);
      if (line[s] && (line[s]!.flags & 1) !== 0) charge = Math.min(1.8, charge + 0.65);
    }
    this.acid303Voice(c, run, charge);
  }

  /**
   * Acid-only, 2x sampled TB-303 approximation: one band-limited oscillator into four TPT lowpass poles,
   * nonlinear ladder feedback, short RC filter envelope, accent charge and a constant 60 ms legato glide.
   * Feedback >4 briefly self-oscillates at hot settings; tanh in the loop bounds the resonance.
   * Baking each gesture is deterministic offline and live, with no worklet or shared-voice changes.
   */
  private acid303Voice(c: Ctx, run: { step: number; note: Acid303Note }[], charge: number) {
    const rubber = c.style.id === "rubber";
    const house = c.style.id === "acidhouse";
    const sr = this.ctx.sampleRate;
    const osr = sr * 2;
    const last = run[run.length - 1];
    const gate = (last.step + (last.note.gate ?? (rubber ? 2.65 : house ? 0.79 : 0.58))) * c.dur;
    const release = rubber ? 0.018 : 0.009;
    const length = Math.ceil((gate + release) * sr);
    const buffer = this.ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);
    const register = c.low + (rubber ? 0 : 12);
    const pitch = (n: Acid303Note) => midiToFreq(register + this.era.notes[n.degree] + 12 * n.octave);
    const sweepBars = house ? 16 : rubber ? 8 : 12;
    const phaseBar = c.hit.bar + c.step / 16;
    const knob = 0.5 - 0.5 * Math.cos(2 * Math.PI * (phaseBar / sweepBars + (hash32(c.epoch, 0xc07) % 5) / 10));
    const base = (rubber ? 95 : house ? 110 : 145) * Math.pow(2, 1.6 * knob + 1.5 * c.color + 0.75 * c.press);
    const envMod = (rubber ? 900 : house ? 2600 : 1700) * (0.65 + 0.7 * c.color + 0.4 * Math.max(0, c.press));
    const resonance = (rubber ? 3.0 : house ? 3.65 : 3.35) + c.heat * (house ? 0.55 : 0.6);
    const drive = (rubber ? 1.05 : house ? 1.6 : 1.25) + c.heat * (house ? 1 : 0.45);
    const firstAccent = (run[0].note.flags & 1) !== 0;
    if (firstAccent) charge = Math.min(1.8, charge + 0.65);
    const envelope = (firstAccent ? 1.8 + charge * 0.65 : 1) * envMod;
    const decay = firstAccent ? 0.075 : rubber ? 0.22 : 0.15;
    // The 303 sits inside the groove: kick and clap lead, most of all in House and Rubber.
    const level = (rubber ? 0.155 : house ? 0.21 : 0.255) * c.sec.bass * (0.8 + c.vel * 0.2);
    const accentBoost = house ? 1.18 : 1.28;
    const state = [0, 0, 0, 0];
    let phase = (hash32(c.epoch, c.n, 0x303) % 1000) / 1000;
    let event = 0, frequency = pitch(run[0].note), from = frequency, to = frequency;
    let slideAt = -1, accentGain = firstAccent ? accentBoost : 1, dc = 0;
    // PolyBLEP removes the saw/pulse discontinuity before the resonant ladder.
    const blep = (p: number, dt: number) => p < dt ? 2 * (p / dt) - (p / dt) ** 2 - 1 : p > 1 - dt ? ((p - 1) / dt) ** 2 + 2 * ((p - 1) / dt) + 1 : 0;
    for (let i = 0; i < length; i++) {
      let sample = 0;
      for (let sub = 0; sub < 2; sub++) {
        const time = (i * 2 + sub) / osr;
        if (event + 1 < run.length && time >= run[event + 1].step * c.dur) {
          event++;
          from = frequency;
          to = pitch(run[event].note);
          slideAt = run[event].step * c.dur;
          // Slid notes keep the filter/amp envelope running; an accent only charges its extra wow circuit.
          if ((run[event].note.flags & 1) !== 0) {
            charge = Math.min(1.8, charge + 0.65);
            accentGain = accentBoost;
          }
        }
        if (slideAt >= 0) frequency = from * Math.pow(to / from, clamp((time - slideAt) / 0.06, 0, 1));
        const dt = frequency / osr;
        phase = (phase + dt) % 1;
        let wave = 2 * phase - 1 - blep(phase, dt);
        if (rubber) wave = (phase < 0.48 ? 1 : -1) + blep(phase, dt) - blep((phase + 0.52) % 1, dt);
        const wow = charge * envMod * 0.55;
        const cutoff = clamp(base + envelope * Math.exp(-time / decay) + wow, 55, 6500);
        charge *= Math.exp(-1 / (osr * 0.18));
        const g = Math.tan(Math.PI * cutoff / osr);
        const G = g / (1 + g), G2 = G * G, G4 = G2 * G2;
        const S = (1 - G) * (G2 * G * state[0] + G2 * state[1] + G * state[2] + state[3]);
        let x = Math.tanh((wave * 0.55 - resonance * S) / (1 + resonance * G4));
        for (let pole = 0; pole < 4; pole++) {
          const v = (x - state[pole]) * G;
          x = v + state[pole];
          state[pole] = x + v;
        }
        // Mixer input overload after the resonant filter. Keep the low register hollow in Rubber.
        const driven = Math.tanh(x * drive * 2.4) / Math.tanh(drive);
        dc += (driven - dc) * (2 * Math.PI * 28 / osr);
        const amp = Math.min(1, time / (rubber ? 0.006 : 0.002)) * Math.max(0, Math.min(1, (gate + release - time) / release));
        sample += (driven - dc) * level * accentGain * amp * 0.5;
      }
      data[i] = sample;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    this.busIn.bass.add(source);
    source.start(c.t);
    this.end(source, [], c.t + length / sr);
  }

  /**
   * Ambient IDM, three sound worlds. Tape Keys: Selected Ambient Works, warm tape pad and soft drums.
   * Tape Haze: Boards of Canada, heavy wow and a dusty hip-hop pocket. Crystal: Amber / Ulrich Schnauss,
   * glass bells and micro-edits. Harmony stays on the instance tonic; the chain still sets density and tone.
   */
  private ambientIdm(c: Ctx) {
    if (c.style.id === "boc") {
      this.ambientHaze(c);
      return;
    }
    if (c.style.id === "crystal") {
      this.ambientCrystal(c);
      return;
    }
    this.ambientTapeKeys(c);
  }

  /**
   * Tape Keys (SAW 85-92: Xtal, Ageispolis). The pad walks the epoch's progression, four bars a chord;
   * a soft warm-keys ostinato breaks the current chord over two bars, under the pad, and rests every eighth bar.
   */
  private ambientTapeKeys(c: Ctx) {
    const { v, step, t, sec } = c;
    const kv = v[0][step];
    if (kv > 0) {
      this.kick(t, c.vel * kv * 0.78, { start: 88, end: 50, sweep: 0.07, decay: 0.24, click: 0.01, body: 0.9 });
      this.duck(t);
    }
    if (v[1][step] > 0) this.tapeSnare(t, c.vel * v[1][step] * (v[1][step] >= 0.9 ? 0.6 : 0.26), -c.pan * 0.4);
    if (v[2][step] > 0 && step % 2 === 0) this.hat(t, c.vel * v[2][step] * 0.34, { hp: 2600, decay: 0.045, metal: 0.12, pan: c.pan });
    if (c.heat > 0.4 && v[2][step] > 0) this.hatRoll(c, 2400);
    const { chord, left, since } = this.ambientChord(c, 0x7a9e, 4);
    const root = 48 + c.tonic;
    // Voices overlap so the change is a blend.
    if (step === 0 && (since === 0 || t >= this.padUntil - c.dur * 2)) {
      const length = left * 16 * c.dur;
      this.pad(c, root, [...chord.pad], length);
    }
    const level = Math.max(sec.lead, 0.55 * sec.pad);
    const bar = c.hit.bar;
    if (level > 0 && ((bar % 8) + 8) % 8 !== 7) {
      const dens = this.ambientDensity(c);
      const fig = AMBIENT_KEYS_FIGURES[hash32(c.epoch, 0x7a91) % AMBIENT_KEYS_FIGURES.length];
      const at = (((bar % 2) + 2) % 2) * 16 + step;
      const cycle = Math.floor(bar / 2);
      const h = hash32(c.epoch, cycle, 0x7a92);
      const tweak = (h >>> 4) % fig.length;
      fig.forEach(([s, idx, tier], i) => {
        if (s !== at || tier > (dens > 0.68 ? 2 : dens > 0.36 ? 1 : 0)) return;
        // Tiny variation per two-bar cycle: one note leaves for the chord's colour tone, or drops out.
        if (i === tweak && h % 5 === 1) return;
        const tone = i === tweak && h % 5 === 0 ? 6 : idx;
        const accent = s % 16 === 0 ? 1 : 0.8;
        this.motifNote(c, root + 12 + this.ambientArpTone(chord, tone), (1.5 + 0.8 * (1 - dens)) * 0.6, 0.62 * level * accent);
      });
    }
    // Now and then one long high note, the chord's colour tone an octave over the figure.
    if (step === 0 && ((bar % 8) + 8) % 8 === 4 && sec.pad > 0 && hash32(c.epoch, Math.floor(bar / 8), 0x7a93) % 3 !== 0) {
      this.ambientHighLine(c, root + 24 + chord.sing[2], 2 * 16 * c.dur, 0.016 * Math.max(0.6, sec.pad), 2600);
    }
    if (step === 0) this.vinyl(c, 0.55);
  }

  /** The epoch's progression (chosen by salt) and the chord at this bar: steps since it began, bars left. */
  private ambientChord(c: Ctx, salt: number, bars: number) {
    const prog = AMBIENT_PROGRESSIONS[hash32(c.epoch, salt) % AMBIENT_PROGRESSIONS.length];
    const slot = Math.floor(c.hit.bar / bars);
    const inBar = ((c.hit.bar % bars) + bars) % bars;
    return { chord: AMBIENT_CHORDS[prog[((slot % prog.length) + prog.length) % prog.length]], left: bars - inBar, since: inBar * 16 + c.step };
  }

  /** How busy the composed figures may get: the chain's hats/glitches, the arranged energy, the heat. 0..1. */
  private ambientDensity(c: Ctx): number {
    return Math.min(1, 0.55 * c.arr.energy + 0.35 * c.heat + 0.022 * (rowCount(c.v[2]) + rowCount(c.v[3])));
  }

  /** Arp tone by index: 0-3 the chord tones, 4-5 the root and third an octave up, 6 the colour tone on top. */
  private ambientArpTone(chord: AmbientChord, idx: number): number {
    if (idx < 4) return chord.arp[idx];
    if (idx < 6) return chord.arp[idx - 4] + 12;
    let colour = chord.sing[2];
    while (colour <= chord.arp[3]) colour += 12;
    return colour;
  }

  /** A slow, quiet sine-and-triangle line note that swells in and hangs in the room. */
  private ambientHighLine(c: Ctx, midi: number, length: number, peak: number, open: number) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const attack = Math.min(1.2, length * 0.3);
    const end = t + length + 2.2;
    const dark = c.press < 0 ? 1 + 0.4 * c.press : 1 + 0.1 * c.press;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.5;
    f.frequency.setValueAtTime(Math.max(600, (open + 1200 * c.color) * dark), t);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + attack);
    amp.gain.setValueAtTime(peak * 0.8, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    f.connect(amp);
    const pan = this.panNode(-0.25, this.busIn.lead);
    pan.add(amp);
    const tape = this.ambientWow(t, 0, 0.2, 7, 0.38, 1.2);
    const oscs: OscillatorNode[] = [...tape.oscs];
    const rest: AudioNode[] = [...tape.nodes, f, amp, pan.dest];
    let chain: AudioNode | null = null;
    for (const [type, cents, lvl] of [["sine", -4, 0.7], ["triangle", 5, 0.3]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime(cents, t);
      tape.mod.connect(osc.detune);
      const g = this.ctx.createGain();
      g.gain.value = lvl;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    (chain as AudioNode | null)?.connect(f);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /**
   * Tape Haze (Boards of Canada: Roygbiv, Olson, Turquoise Hexagon Sun). Warped analog pad on the epoch's
   * progression, boom-bap pocket, and a nostalgic tune of a few long, scooped notes that sits on the chord.
   */
  private ambientHaze(c: Ctx) {
    const { v, step, t, sec } = c;
    if (v[0][step] > 0) {
      this.kick(t, c.vel * v[0][step] * 0.7, { start: 90, end: 58, sweep: 0.08, decay: 0.2, click: 0, body: 0.78, drive: 1.05 });
      this.duck(t);
      this.noiseHit(t, 0.04 * v[0][step], { type: "lowpass", freq: 460, q: 0.5, decay: 0.16, pan: 0, bus: this.busIn.tex });
    }
    if (v[1][step] > 0) {
      const accent = v[1][step] >= 0.7;
      this.ambientDustSnare(t, c.vel * v[1][step] * (accent ? 0.78 : 0.32), -c.pan * 0.3, accent);
    }
    if (v[2][step] > 0) {
      const off = step % 4 === 2;
      this.hat(t, c.vel * v[2][step] * (off ? 0.34 : 0.2), { hp: 1100, decay: off ? 0.065 : 0.032, metal: 0.04, pan: c.pan * 0.45 });
      if (c.heat > 0.45 && hash32(this.patternId, c.step, c.hit.bar, 0x0c0c) % 100 < Math.round(c.heat * 60)) {
        this.hat(t + c.dur * 0.5, c.vel * 0.14 * c.heat, { hp: 900, decay: 0.028, metal: 0, pan: -c.pan });
      }
    }
    if (v[3][step] > 0) this.ambientHazeBlip(c);
    const { chord, left, since } = this.ambientChord(c, 0x77b0, 4);
    if (step === 0 && (since === 0 || t >= this.padUntil - c.dur * 2)) {
      this.ambientHazePad(c, 48 + c.tonic, chord.pad.filter((semi) => semi >= 0), left * 16 * c.dur);
    }
    if (bassAt(c.arr.bass, step) > 0 && sec.bass > 0) this.ambientHazeBass(c, chord.bass, this.holdSteps(c.arr.bass, step, 4) * c.dur);
    // The tune: an eight-bar phrase of a few long notes on the chord's 3rd/5th/colour, many rests.
    const level = Math.max(sec.lead, 0.5 * sec.pad);
    if (level > 0) {
      const phrase = AMBIENT_HAZE_PHRASES[hash32(c.epoch, 0x77b1) % AMBIENT_HAZE_PHRASES.length];
      const at = (((c.hit.bar % 8) + 8) % 8) * 16 + step;
      const again = Math.floor(c.hit.bar / 8) % 2 !== 0;
      const dens = this.ambientDensity(c);
      const tier = dens > 0.72 ? 2 : dens > 0.42 ? 1 : 0;
      const lastCore = phrase.reduce((k, n, i) => (n[4] === 0 ? i : k), 0);
      phrase.forEach(([s, role, len, oct, need], i) => {
        if (s !== at || need > tier) return;
        // The repeat answers itself: its last long note moves (3rd <-> colour, anything else to the 3rd).
        const r = again && i === lastCore ? (role === 0 ? 2 : 0) : role;
        const midi = 60 + c.tonic + chord.sing[r] + 12 * oct;
        this.ambientHazeLead(c, midi, len * c.dur, level * 0.62);
      });
    }
    if (step === 0) this.vinyl(c, 1.05);
  }

  /** Wide-detuned saws under one slow tape wow, so the whole chord swims together. Four bars a chord. */
  private ambientHazePad(c: Ctx, root: number, chord: readonly number[], length: number) {
    const t = c.t;
    const attack = Math.min(2.4, length * 0.28);
    const release = 3.2;
    const end = t + length + release;
    this.padUntil = t + length;
    const dark = c.press < 0 ? 1 + 0.48 * c.press : 1 + 0.1 * c.press;
    const cutoff = Math.max(260, (1500 + 1300 * c.color + 1500 * c.heat) * dark);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.65;
    f.frequency.setValueAtTime(Math.max(80, cutoff * 0.55), t);
    f.frequency.exponentialRampToValueAtTime(cutoff, t + Math.min(length, 6));
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.35));
    shaper.oversample = "none";
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 140;
    hp.Q.value = 0.7;
    const trim = this.ctx.createGain();
    trim.gain.value = 0.78;
    const amp = this.ctx.createGain();
    const level = 0.058 * (1 + 0.28 * c.heat) * Math.max(0.7, c.sec.pad);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setValueAtTime(level, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    shaper.connect(trim);
    trim.connect(hp);
    hp.connect(f);
    f.connect(amp);
    const pan = this.panNode(0.08, this.busIn.harm);
    pan.add(amp);
    const drift = 0.07 + (hash32(c.epoch, 0x77a1) % 5) / 100;
    const wowRate = 0.24 + (hash32(c.epoch, 0x77a2) % 16) / 100;
    const tape = this.ambientWow(t, 16, drift, 14, wowRate, 4.5);
    const oscs: OscillatorNode[] = [...tape.oscs];
    const rest: AudioNode[] = [...tape.nodes, shaper, trim, hp, f, amp, pan.dest];
    let chain: AudioNode | null = null;
    const layers: readonly (readonly [OscillatorType, number, number])[] = [
      ["sawtooth", -18, 0.2],
      ["sawtooth", 13, 0.18],
      ["triangle", 3, 0.3],
    ];
    chord.forEach((semi) => {
      for (const [type, cents, lvl] of layers) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(cents, t);
        tape.mod.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = lvl * (semi < 0 ? 0.6 : 0.85);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    (chain as AudioNode | null)?.connect(shaper);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /** Round analog bass on the chord root: a detuned mid over a quiet sine sub. Rhythm is the chain's bass onsets. */
  private ambientHazeBass(c: Ctx, rootSemi: number, length: number) {
    const t = c.t;
    const hold = Math.max(0.12, length * 0.9);
    const end = t + hold + 0.06;
    const freq = midiToFreq(c.low + 12 + rootSemi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    const cut = Math.max(120, (200 + 240 * c.color + 160 * c.heat) * (c.press < 0 ? 1 + 0.35 * c.press : 1 + 0.08 * c.press));
    lp.frequency.setValueAtTime(cut * 1.7, t);
    lp.frequency.exponentialRampToValueAtTime(cut, t + 0.16);
    const amp = this.ctx.createGain();
    const peak = 0.06 * c.sec.bass;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.028);
    amp.gain.setValueAtTime(peak, t + hold * 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + hold);
    amp.gain.setValueAtTime(0, t + hold);
    lp.connect(amp);
    this.busIn.bass.add(amp);
    const tape = this.ambientWow(t, 5, 0.15, 7, 0.36, 1.6);
    const oscs: OscillatorNode[] = [...tape.oscs];
    const rest: AudioNode[] = [...tape.nodes, lp, amp];
    let chain: AudioNode | null = null;
    for (const [type, cents, lvl] of [["triangle", -9, 0.72], ["sawtooth", 12, 0.26]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime(cents, t);
      tape.mod.connect(osc.detune);
      const g = this.ctx.createGain();
      g.gain.value = lvl;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    (chain as AudioNode | null)?.connect(lp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end));
    this.sub(c, c.low + rootSemi, length * 0.65, 0.08 * c.sec.bass);
  }

  /** A cheap keyboard through the same cassette: two flat triangles and a faint music-box octave. */
  private ambientHazeLead(c: Ctx, midi: number, length: number, level: number) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const hold = Math.max(0.18, length * 0.92);
    const end = t + hold + 0.55;
    const dark = c.press < 0 ? 1 + 0.4 * c.press : 1 + 0.12 * c.press;
    const cut = Math.max(500, (900 + 1100 * c.color + 700 * c.heat) * dark);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.6;
    f.frequency.setValueAtTime(cut, t);
    const amp = this.ctx.createGain();
    const peak = 0.11 * level;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.06);
    amp.gain.setValueAtTime(peak * 0.72, t + Math.max(0.12, hold * 0.7));
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    f.connect(amp);
    const pan = this.panNode(-c.pan * 0.35, this.busIn.lead);
    pan.add(amp);
    const wowRate = 0.3 + (hash32(c.epoch, 0x7ea0) % 12) / 100;
    const tape = this.ambientWow(t, 8, 0.11, 11, wowRate, 2.4);
    const oscs: OscillatorNode[] = [...tape.oscs];
    const rest: AudioNode[] = [...tape.nodes, f, amp, pan.dest];
    let chain: AudioNode | null = null;
    for (const [oct, cents, lvl] of [[0, -12, 0.62], [0, 11, 0.58], [1, 4, 0.16]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq * (oct === 1 ? 2 : 1), t);
      // A slow scoop up into the note, the cassette catching up.
      osc.detune.setValueAtTime(cents - 38, t);
      osc.detune.linearRampToValueAtTime(cents, t + 0.16);
      tape.mod.connect(osc.detune);
      const g = this.ctx.createGain();
      g.gain.value = lvl;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    (chain as AudioNode | null)?.connect(f);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /** SP-style snare: a short body, a narrow noise crack, and a darker dust layer on the backbeat. */
  private ambientDustSnare(time: number, velocity: number, panAmount: number, accent: boolean) {
    this.toneHit(time, 0.22 * velocity, {
      type: "triangle", freq: accent ? 172 : 196, to: 130, sweep: 0.045, decay: accent ? 0.09 : 0.04, pan: panAmount, bus: this.busIn.snare,
    });
    this.noiseHit(time, (accent ? 0.62 : 0.28) * velocity, {
      type: "bandpass", freq: accent ? 1400 : 1600, q: 0.7, decay: accent ? 0.22 : 0.06, pan: panAmount, bus: this.busIn.snare,
    });
    if (accent) {
      this.noiseHit(time, 0.12 * velocity, { type: "lowpass", freq: 2200, q: 0.4, decay: 0.1, pan: panAmount * 0.4, bus: this.busIn.snare });
    }
  }

  /** One scale-tone skate, the glitch row heard as a tape slip rather than a digital click. */
  private ambientHazeBlip(c: Ctx) {
    const notes = this.era.notes;
    const h = hash32(c.epoch, c.n, 0xb10c);
    const from = notes[h % notes.length];
    const to = notes[(h >>> 8) % notes.length];
    const base = 72 + c.tonic;
    const freq = midiToFreq(base + from);
    const dest = midiToFreq(base + (to === from ? from + 12 : to));
    this.toneHit(c.t, 0.06 * (0.7 + 0.3 * c.heat), {
      type: "triangle", freq, to: dest, sweep: 0.11, decay: 0.13, pan: c.pan, bus: this.busIn.perc,
    });
  }

  /** Crystal. Struck glass, a slow bright bed, and small edited clicks. Straight, not swung. */
  private ambientCrystal(c: Ctx) {
    const { v, step, t, sec } = c;
    const { chord: prog, left, since } = this.ambientChord(c, 0x51c0, 4);
    const chord = prog.glass;
    const root = 60 + c.tonic;
    if (v[0][step] > 0) {
      const kv = c.vel * v[0][step];
      this.toneHit(t, 0.3 * kv, { type: "sine", freq: 188, to: 74, sweep: 0.032, decay: 0.08, pan: 0, bus: this.busIn.kick });
      this.noiseHit(t, 0.055 * kv, { type: "highpass", freq: 3400, q: 0.7, decay: 0.01, pan: 0, bus: this.busIn.kick });
    }
    if (v[1][step] > 0) {
      const accent = v[1][step] >= 0.7;
      if (accent) {
        this.rim(t, c.vel * v[1][step] * 0.32, -c.pan * 0.35, 1.6);
        this.noiseHit(t, 0.14 * c.vel * v[1][step], { type: "highpass", freq: 4000, q: 0.8, decay: 0.035, pan: -c.pan * 0.5, bus: this.busIn.snare });
      } else {
        this.noiseHit(t, 0.07 * c.vel * v[1][step], { type: "bandpass", freq: 3000, q: 2.2, decay: 0.016, pan: c.pan, bus: this.busIn.perc });
      }
    }
    if (v[2][step] > 0) {
      const tick = step % 2 === 0;
      this.hat(t, c.vel * v[2][step] * (tick ? 0.3 : 0.18), { hp: 4600, decay: tick ? 0.018 : 0.01, metal: 0.22, pan: c.pan * 0.8 });
    }
    const glitch = v[3][step];
    if (glitch > 0 || (c.heat > 0.55 && hash32(c.epoch, c.n, 0xc1a) % 100 < Math.round(c.heat * 40))) {
      this.ambientMicro(c, glitch > 0 ? glitch : 0.4);
    }
    if (step === 0 && (since === 0 || t >= this.padUntil - c.dur * 2)) {
      this.ambientGlassBed(c, root, chord, left * 16 * c.dur);
    }
    if (sec.pad > 0 && (step === 0 || (step === 8 && (rowCount(v[0]) >= 3 || c.arr.energy > 0.4)))) {
      const highs = [...chord].filter((semi) => semi >= 7 && semi <= 19).slice(-3);
      highs.forEach((semi, i) => {
        this.ambientBell(c, t + i * 0.014, root + semi, 0.04 * (1 - i * 0.16) * sec.pad, 0.9, "harm");
      });
    }
    if (bassAt(c.arr.bass, step) > 0 && sec.bass > 0) {
      this.toneHit(t, 0.16 * sec.bass * (0.75 + 0.25 * c.color), {
        type: "sine", freq: midiToFreq(c.low + 12 + prog.bass), decay: Math.min(0.26, this.holdSteps(c.arr.bass, step, 2) * c.dur), pan: 0, bus: this.busIn.bass,
      });
    }
    // No tune: the chord's tones cycle over two octaves, eighths or sixteenths, ping-ponging into the dotted echo.
    const level = Math.max(sec.lead, 0.6 * sec.pad);
    const dens = this.ambientDensity(c);
    const gap = dens >= 0.5 ? 1 : dens >= 0.1 ? 2 : 4;
    if (level > 0 && since % gap === 0) {
      const cells = AMBIENT_CRYSTAL_ARPS[hash32(c.epoch, 0x51c1) % AMBIENT_CRYSTAL_ARPS.length];
      const k = Math.floor(since / gap);
      const cell = cells[k % cells.length];
      const tone = cell >= 8 ? prog.arp[0] + 24 : prog.arp[cell % 4] + 12 * Math.floor(cell / 4);
      const beat = step % 4 === 0 ? 1 : 0.72;
      const peak = 0.15 * level * beat * (0.85 + 0.15 * (cell / 8)) * (gap === 1 ? 0.78 : 1);
      this.ambientShimmer(c, root + tone, peak, (gap === 1 ? 0.32 : 0.55) + 0.25 * (1 - c.heat), k % 2 === 0 ? -0.55 : 0.55);
    }
    // The slow high line: the chord's colour tone held for two bars, half way through the chord.
    if (step === 0 && since === 32 && sec.pad > 0 && hash32(c.epoch, c.hit.bar, 0x51c2) % 2 === 0) {
      this.ambientHighLine(c, root + 12 + prog.sing[2], 2 * 16 * c.dur, 0.013 * Math.max(0.6, sec.pad), 4200);
    }
  }

  /** One arp step: sine, a soft octave and a faint twelfth, a 15 ms attack (no strike), a short ring. */
  private ambientShimmer(c: Ctx, midi: number, peak: number, decay: number, panAmount: number) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const dark = c.press < 0 ? 1 + 0.45 * c.press : 1 + 0.14 * c.press;
    const open = Math.max(1200, (2600 + 5200 * c.color + 2400 * c.heat) * dark);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.5;
    f.frequency.setValueAtTime(Math.min(14000, open), t);
    const amp = this.ctx.createGain();
    pulse(amp.gain, t, 0.015, peak, decay);
    f.connect(amp);
    const pan = this.panNode(panAmount, this.busIn.lead);
    pan.add(amp);
    const oscs: OscillatorNode[] = [];
    const rest: AudioNode[] = [f, amp, pan.dest];
    let chain: AudioNode | null = null;
    for (const [ratio, cents, lvl] of [[1, 0, 0.72], [2, 5, 0.22], [3, -4, 0.07]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * ratio, t);
      osc.detune.setValueAtTime(cents, t);
      const g = this.ctx.createGain();
      g.gain.value = lvl;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    (chain as AudioNode | null)?.connect(f);
    const stop = t + 0.015 + decay + 0.05;
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], stop));
  }

  /** Sustained consonant glass: slow attack, detuned octaves, a slightly sharp shimmer. The chime is the attack. */
  private ambientGlassBed(c: Ctx, root: number, chord: readonly number[], length: number) {
    const t = c.t;
    const attack = Math.min(2.1, length * 0.34);
    const release = 2.6;
    const end = t + length + release;
    this.padUntil = t + length;
    const dark = c.press < 0 ? 1 + 0.42 * c.press : 1 + 0.14 * c.press;
    const cutoff = Math.max(1600, (3400 + 5200 * c.color + 2600 * c.heat) * dark);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 180;
    hp.Q.value = 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.5;
    f.frequency.setValueAtTime(Math.max(400, cutoff * 0.62), t);
    f.frequency.exponentialRampToValueAtTime(Math.min(14000, cutoff), t + Math.min(length, 5));
    const amp = this.ctx.createGain();
    const level = 0.11 * (0.85 + 0.3 * c.heat) * Math.max(0.75, c.sec.pad);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setValueAtTime(level, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    hp.connect(f);
    f.connect(amp);
    const pan = this.panNode(0.2, this.busIn.harm);
    pan.add(amp);
    const oscs: OscillatorNode[] = [];
    const rest: AudioNode[] = [hp, f, amp, pan.dest];
    let chain: AudioNode | null = null;
    const partials: readonly (readonly [OscillatorType, number, number, number])[] = [
      ["sine", 1, 0, 0.46],
      ["triangle", 1, -8, 0.28],
      ["sine", 2, 9, 0.2],
      ["sine", 4.02, -5, 0.12],
      ["sine", 6.07, 4, 0.045],
    ];
    chord.forEach((semi) => {
      const freq = midiToFreq(root + semi);
      for (const [type, ratio, cents, lvl] of partials) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq * ratio, t);
        osc.detune.setValueAtTime(cents, t);
        const g = this.ctx.createGain();
        g.gain.value = lvl * (semi >= 24 ? 0.7 : 1);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    (chain as AudioNode | null)?.connect(hp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /** One decaying FM bell. Ratio 3.49 so the strike is glass and the tail falls back to a sine. */
  private ambientBell(c: Ctx, time: number, midi: number, peak: number, decay: number, bus: "harm" | "lead") {
    const freq = midiToFreq(midi);
    const dark = c.press < 0 ? 1 + 0.45 * c.press : 1 + 0.12 * c.press;
    const open = Math.max(900, (2200 + 6400 * c.color + 2200 * c.heat) * dark);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.55;
    f.frequency.setValueAtTime(Math.min(14000, open * 1.35), time);
    f.frequency.exponentialRampToValueAtTime(Math.max(500, Math.min(open, 12000)), time + Math.min(0.35, decay));
    const amp = this.ctx.createGain();
    pulse(amp.gain, time, 0.004, Math.max(0.008, peak), decay);
    f.connect(amp);
    const pan = this.panNode(bus === "lead" ? -c.pan * 0.7 : 0.28, this.busIn[bus]);
    pan.add(amp);
    const car = this.ctx.createOscillator();
    car.type = "sine";
    car.frequency.setValueAtTime(freq, time);
    const mod = this.ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(freq * 3.49, time);
    const idx = this.ctx.createGain();
    idx.gain.setValueAtTime(freq * 3.1, time);
    idx.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.12), time + Math.min(0.5, decay));
    mod.connect(idx);
    idx.connect(car.frequency);
    const g = this.ctx.createGain();
    g.gain.value = 0.78;
    car.connect(g);
    const oct = this.ctx.createOscillator();
    oct.type = "sine";
    oct.frequency.setValueAtTime(freq * 2, time);
    oct.detune.setValueAtTime(6, time);
    const og = this.ctx.createGain();
    og.gain.value = 0.2;
    oct.connect(og);
    const mix = this.ctx.createGain();
    g.connect(mix);
    og.connect(mix);
    mix.connect(f);
    const stop = time + 0.01 + decay + 0.06;
    car.start(time);
    mod.start(time);
    oct.start(time);
    this.end(car, [idx, g, og, mix, f, amp, pan.dest], stop);
    this.end(mod, [], stop);
    this.end(oct, [], stop);
  }

  /** A few tuned clicks inside one 16th. Offsets come from the epoch, so a bar edits the same way twice. */
  private ambientMicro(c: Ctx, vel: number) {
    const notes = this.era.notes;
    const n = 2 + (hash32(c.epoch, c.n, 0xb11) % (c.heat > 0.75 ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const h = hash32(c.epoch, c.n, i, 0xc1ed);
      const at = c.t + c.dur * ((h % 70) / 100) * (i === 0 ? 0.2 : 0.9);
      const pan = (h % 180) / 90 - 1;
      if (h % 5 === 0) {
        this.noiseHit(at, 0.045 * vel * c.vel, {
          type: "bandpass", freq: 2200 + (h % 1800), q: 3.2, decay: 0.012, pan, bus: this.busIn.perc,
        });
      } else {
        const midi = 84 + c.tonic + notes[h % notes.length];
        this.toneHit(at, 0.04 * vel * c.vel, {
          type: "sine", freq: midiToFreq(midi), decay: 0.028 + (h % 6) / 200, attack: 0.002, pan, bus: this.busIn.perc,
        });
      }
    }
  }

  /**
   * Tape transport: a very slow drift, a wow, and a shallow flutter, summed once.
   * Depths are cents. One modulator on every detune, so the machine warbles as a whole.
   */
  private ambientWow(time: number, drift: number, driftRate: number, wow: number, wowRate: number, flutter: number) {
    const nodes: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    const mod = this.ctx.createGain();
    nodes.push(mod);
    const add = (rate: number, cents: number) => {
      if (cents <= 0) return;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.setValueAtTime(Math.max(0.02, rate), time);
      const g = this.ctx.createGain();
      g.gain.value = cents;
      lfo.connect(g);
      g.connect(mod);
      oscs.push(lfo);
      nodes.push(g);
    };
    add(driftRate, drift);
    add(wowRate, wow);
    add(5.6, flutter);
    return { mod, oscs, nodes };
  }

  /**
   * Ambient drone, three background worlds. Nothing here rings, gates or keeps building: every voice is a soft wave
   * through a low-Q lowpass, voiced on the tonic, fifth and octaves with the odd soft second or third, and it moves
   * only by slow breathing curves. The chain moves density (layers, glints), brightness within a soft range and
   * how quickly things breathe, never the key.
   *   Wall: Stars of the Lid / Gas without the beat. Wide string-pad layers crossfading, breath, high glints.
   *   Dark Low: Lustmord / Biosphere. Beating subs, a hollow low pad, distant soft bowls, the rare concussion.
   *   Overtone Pulse: Radigue / Eno. One harmonic series whose partials breathe in turn, glass glints.
   */
  private drone(c: Ctx) {
    if (c.style.id === "dark") {
      this.droneDark(c);
      return;
    }
    if (c.style.id === "pulse") {
      this.dronePulse(c);
      return;
    }
    this.droneWall(c);
  }

  /**
   * Soft market macros shared by the drone styles. `busy` counts the chain's hits this bar (more layers, more
   * glints), `glow` 0..1 is brightness (tick and buy/sell, clamped to a soft range), `move` speeds the breathing.
   */
  private droneMood(c: Ctx) {
    const busy = rowCount(c.v[0]) + rowCount(c.v[2]) + rowCount(c.v[3]);
    const glow = clamp(0.4 + 0.35 * (c.color - 0.5) + 0.3 * c.press, 0, 1);
    const move = 1 + 0.6 * c.heat;
    return { busy, glow, move };
  }

  /** Stars of the Lid: a new wide pad layer every four bars crossfades over the last; breath; glints; a rare sub. */
  private droneWall(c: Ctx) {
    const { step } = c;
    const mood = this.droneMood(c);
    if (step === 0 && (c.hit.bar % 4 === 0 || c.t >= this.padUntil - c.dur * 2)) {
      const bars = 4 - (((c.hit.bar % 4) + 4) % 4);
      this.droneWallLayer(c, bars * 16 * c.dur, mood);
    }
    if (step === 0) this.breath(c);
    if (this.droneGlintDue(c, mood, 2)) {
      const semi = DRONE_GLINT_NOTES[hash32(c.epoch, c.n, 0x9a) % DRONE_GLINT_NOTES.length];
      this.droneGlint(c, 60 + c.tonic + semi, 0.016 * (0.7 + 0.5 * mood.glow), 3.2 + 1.6 * (1 - c.heat));
    }
    this.droneRareSub(c, 0xd5b);
  }

  /**
   * One Wall layer: each voice two detuned saws/triangles panned apart, through two gentle lowpasses whose cutoff
   * drifts on a slow sine, a still sine core under it. Voicings alternate the open fifths with a soft colour.
   */
  private droneWallLayer(c: Ctx, length: number, mood: { busy: number; glow: number; move: number }) {
    const t = c.t;
    const fade = clamp(length * 0.5, 1.2, 6.5);
    const span = length + fade;
    this.padUntil = t + length;
    const phrase = c.hit.bar >> 2;
    const colour = DRONE_WALL_COLOURS[(hash32(c.epoch, 0xd0a) + (phrase >> 1)) % DRONE_WALL_COLOURS.length];
    const voicing = phrase % 2 === 0 ? DRONE_WALL_OPEN : colour;
    const notes = mood.busy >= 8 ? [...voicing, 31] : voicing;
    // The pad sits in octave 3; a still sine core an octave under it keeps it warm.
    const root = 48 + c.tonic;
    const level = 0.05 * (1 + 0.15 * c.heat) * Math.max(0.6, c.sec.pad);
    const lo = 440 + 380 * mood.glow;
    const hi = lo * (1.55 + 0.35 * c.heat);
    const period = (19 + (hash32(c.epoch, 0xd0f) % 7)) / mood.move;
    const rest: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    // Detune drift: opposite on each side, so the beating moves instead of sitting at one rate.
    const drift = this.ctx.createOscillator();
    drift.frequency.setValueAtTime(0.05 + (hash32(c.epoch, 0xd0e) % 8) / 160, t);
    const driftG = this.ctx.createGain();
    driftG.gain.value = 3;
    drift.connect(driftG);
    const invert = this.ctx.createGain();
    invert.gain.value = -1;
    driftG.connect(invert);
    rest.push(driftG, invert);
    oscs.push(drift);
    for (const side of [-1, 1]) {
      let chain: AudioNode | null = null;
      notes.forEach((semi, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = i < 2 ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(side * (3 + i * 1.5), t);
        (side < 0 ? driftG : invert).connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = (i === 0 ? 0.5 : 0.42) / (1 + i * 0.45);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      });
      for (const [semi, lvl] of [[-12, 0.26], [-5, 0.1]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        const g = this.ctx.createGain();
        g.gain.value = lvl;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
      const f1 = this.ctx.createBiquadFilter();
      const f2 = this.ctx.createBiquadFilter();
      for (const f of [f1, f2]) {
        f.type = "lowpass";
        f.Q.value = 0.5;
        // The two sides drift a quarter cycle apart: the brightness wanders slowly across the stereo field.
        this.droneCurve(f.frequency, t, span, (s) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * s) / period + (side < 0 ? 0 : Math.PI / 2))));
      }
      const amp = this.ctx.createGain();
      this.droneCurve(amp.gain, t, span, (s) => level * droneEnv(s, fade, length, fade) * (1 - 0.12 * (0.5 - 0.5 * Math.cos((2 * Math.PI * s) / (period * 0.7) + side))));
      chain!.connect(f1);
      f1.connect(f2);
      f2.connect(amp);
      const pan = this.panNode(side * 0.55, this.busIn.harm);
      pan.add(amp);
      rest.push(f1, f2, amp, pan.dest);
    }
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + span + 0.05));
  }

  /**
   * Lustmord, softened: beating subs and a hollow fifth under a dark breathing pad, distant bowls instead of metal.
   * Busy markets bring the bowls more often and, every other bar, move something heavy. Sells darken the pad.
   */
  private droneDark(c: Ctx) {
    const { v, step, t, sec } = c;
    const mood = this.droneMood(c);
    if (step === 0 && (c.hit.bar % 8 === 0 || t >= this.padUntil - c.dur * 2)) {
      const bars = 8 - (((c.hit.bar % 8) + 8) % 8);
      const length = bars * 16 * c.dur;
      this.droneDarkBed(c, length);
      this.droneDarkPad(c, length, mood);
    }
    // A concussion, not a kick pattern: only when the chain is actually putting weight on the downbeats.
    if (step === 0 && c.hit.bar % 2 === 0 && rowCount(v[0]) >= 3 && sec.kick > 0.45) {
      this.kick(t, c.vel * 0.34 * sec.kick * (0.75 + 0.4 * c.heat), { start: 42, end: 28, sweep: 0.7, decay: 1.8, click: 0, body: 1.2 });
    }
    if (this.droneGlintDue(c, mood, 2.5)) {
      const semi = DRONE_BOWL_NOTES[hash32(c.epoch, c.n, 0xb017) % DRONE_BOWL_NOTES.length];
      this.droneGlint(c, c.low + 24 + semi, 0.02 * (0.75 + 0.4 * mood.glow), 4 + 1.5 * (1 - c.heat), 0.22, 1100 + 400 * mood.glow);
    }
    if (step === 0) this.droneRumble(c);
  }

  /** Sub pressure on the bass bus, a hollow fifth/octave in the room. Beats quicken with heat; the market never retunes them. */
  private droneDarkBed(c: Ctx, length: number) {
    const t = c.t;
    const attack = Math.min(4.2, length * 0.32);
    const release = 5;
    const end = t + length + release;
    this.padUntil = t + length;
    const beat = 0.72 + c.heat * 1.05;
    const dark = c.press < 0 ? 1 + 0.62 * c.press : 1 + 0.18 * c.press;
    const rest: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];

    const subChain = this.droneSineBed(t, rest, oscs, [
      [c.low - 12, -13 * beat, 0.58],
      [c.low - 12, 14 * beat, 0.58],
      [c.low, -7 * beat, 0.34],
      [c.low, 8 * beat, 0.34],
    ]);
    const subLp = this.ctx.createBiquadFilter();
    subLp.type = "lowpass";
    subLp.Q.value = 0.6;
    subLp.frequency.value = Math.max(70, (130 + 50 * c.heat) * Math.max(0.55, dark));
    const subShape = this.ctx.createWaveShaper();
    subShape.curve = new Float32Array(tanhCurve(1.2 + 0.55 * c.heat));
    subShape.oversample = "none";
    const subAmp = this.ctx.createGain();
    const subLevel = 0.046 * (1 + 0.35 * c.heat) * Math.max(0.7, c.sec.bass);
    this.droneFade(subAmp.gain, t, attack, length, release, subLevel);
    subChain.connect(subShape);
    subShape.connect(subLp);
    subLp.connect(subAmp);
    const subPan = this.panNode(0, this.busIn.bass);
    subPan.add(subAmp);
    rest.push(subShape, subLp, subAmp, subPan.dest);

    const bodyChain = this.droneSineBed(t, rest, oscs, [
      [c.low + 7, -5 * beat, 0.48],
      [c.low + 7, 6 * beat, 0.48],
      [c.low + 12, 3 * beat, 0.22],
      [c.low + 19, -4 * beat, 0.12],
    ]);
    const body = this.ctx.createBiquadFilter();
    body.type = "lowpass";
    // No resonance: the sweep is a slow change of colour, not a peak travelling through the partials.
    body.Q.value = 0.6;
    const lo = Math.max(190, (260 + 240 * c.color) * Math.max(0.6, dark));
    const hi = Math.min(900, Math.max(lo + 50, lo * (1.5 + 0.4 * c.heat)));
    const phrase = hash32(c.epoch, c.hit.bar >> 3, 0xd0c);
    body.frequency.setValueAtTime(phrase % 2 ? lo : hi, t);
    body.frequency.linearRampToValueAtTime(phrase % 2 ? hi : lo, t + length);
    const bodyAmp = this.ctx.createGain();
    const bodyLevel = 0.064 * (1 + 0.2 * c.heat) * Math.max(0.65, c.sec.pad);
    this.droneFade(bodyAmp.gain, t, attack, length, release, bodyLevel);
    bodyChain.connect(body);
    body.connect(bodyAmp);
    const bodyPan = this.panNode(0, this.busIn.harm);
    bodyPan.add(bodyAmp);
    rest.push(body, bodyAmp, bodyPan.dest);

    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /**
   * The cave's pad: tonic, fifth and octave two octaves over the bass, wide triangles under a low lowpass that
   * breathes on a long sine. Busy markets add the upper octave; sells close it towards the floor.
   */
  private droneDarkPad(c: Ctx, length: number, mood: { busy: number; glow: number; move: number }) {
    const t = c.t;
    const fade = clamp(length * 0.3, 1.5, 7);
    const span = length + fade;
    const notes = mood.busy >= 8 ? [24, 31, 36, 43] : [24, 31, 36];
    const lo = 300 + 200 * mood.glow;
    const hi = lo * (1.35 + 0.25 * c.heat);
    const period = (24 + (hash32(c.epoch, 0xdad) % 9)) / mood.move;
    const level = 0.042 * Math.max(0.65, c.sec.pad);
    const rest: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    for (const side of [-1, 1]) {
      let chain: AudioNode | null = null;
      notes.forEach((semi, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(midiToFreq(c.low + semi), t);
        osc.detune.setValueAtTime(side * (4 + 2 * i), t);
        const g = this.ctx.createGain();
        g.gain.value = 0.5 / (1 + i * 0.6);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      });
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 0.5;
      this.droneCurve(f.frequency, t, span, (s) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * s) / period + (side < 0 ? 0 : 1.3))));
      const amp = this.ctx.createGain();
      this.droneCurve(amp.gain, t, span, (s) => level * droneEnv(s, fade, length, fade) * (0.7 + 0.3 * (0.5 - 0.5 * Math.cos((2 * Math.PI * s) / period))));
      chain!.connect(f);
      f.connect(amp);
      const pan = this.panNode(side * 0.6, this.busIn.harm);
      pan.add(amp);
      rest.push(f, amp, pan.dest);
    }
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + span + 0.05));
  }

  /** Cave air: a low rumble that follows the sell. No hiss on top: the far wall is the reverb. */
  private droneRumble(c: Ctx) {
    const bar = c.dur * 16;
    const end = c.t + bar * 1.75;
    const dark = 1 + 0.85 * Math.max(0, -c.press);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(70 + 80 * c.color, c.t);
    lp.frequency.linearRampToValueAtTime(60 + 120 * fold(c.color + 0.18) * Math.max(0.4, 1 + 0.5 * Math.min(0, c.press)), c.t + bar * 1.5);
    const g = this.ctx.createGain();
    const peak = 0.042 * dark * (1 + 0.35 * c.heat) * Math.max(0.35, c.sec.hat);
    g.gain.setValueAtTime(0.0001, c.t);
    g.gain.linearRampToValueAtTime(peak, c.t + bar * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, end);
    g.gain.setValueAtTime(0, end);
    src.connect(lp);
    lp.connect(g);
    this.busIn.tex.add(g);
    src.start(c.t);
    this.end(src, [lp, g], end + 0.05);
  }

  /**
   * Radigue / Eno: one harmonic series on the tonic, only its consonant partials (octaves, fifths, a soft third).
   * The partials breathe in turn on a slow tempo-locked sine, so the colour rises and falls through the series
   * like a held vowel. Density and heat quicken the breath; buys and the tick open the top a little.
   */
  private dronePulse(c: Ctx) {
    const { step } = c;
    const mood = this.droneMood(c);
    if (step === 0 && (c.hit.bar % 4 === 0 || c.t >= this.padUntil - c.dur * 2)) {
      const bars = 4 - (((c.hit.bar % 4) + 4) % 4);
      this.droneOvertone(c, bars * 16 * c.dur, mood);
    }
    if (this.droneGlintDue(c, mood, 3)) {
      // A glass partial of the same series: a glint, not a new pitch. Never the same partial twice running.
      this.droneGlassAt = (this.droneGlassAt + 1 + (hash32(c.epoch, c.n, 0xd3e) % (DRONE_GLASS.length - 1))) % DRONE_GLASS.length;
      const n = DRONE_GLASS[this.droneGlassAt];
      this.droneGlint(c, 0, 0.012 * (0.7 + 0.5 * mood.glow), 2.6 + 1.4 * (1 - c.heat), 0.12, 2200, midiToFreq(c.low + 12) * n);
    }
    this.droneRareSub(c, 0xd5c);
  }

  private droneOvertone(c: Ctx, length: number, mood: { busy: number; glow: number; move: number }) {
    const t = c.t;
    const fade = clamp(length * 0.35, 1, 4);
    const span = length + fade;
    this.padUntil = t + length;
    const fund = midiToFreq(c.low + 12);
    const bar = c.dur * 16;
    // One breath per two bars when the chain is quiet, per bar when it is busy or hot. Never quicker.
    const breath = (mood.busy >= 10 || c.heat >= 0.6 ? 1 : 2) * bar;
    const level = 0.2 * (1 + 0.15 * c.heat) * Math.max(0.65, c.sec.pad);
    const figure = DRONE_PULSE_FIGURES[hash32(c.epoch, 0x0d17) % DRONE_PULSE_FIGURES.length];
    const fifth = figure[Math.floor(c.hit.bar / 4) % figure.length] === 1;
    const partials = DRONE_PARTIALS.filter((p) => p.group < 3 || mood.busy >= 6 || c.heat >= 0.5);
    const rest: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    const chains: (AudioNode | null)[] = [null, null, null, null];
    const add = (group: number, freq: number, lvl: number) => {
      // Two sines a slow beat apart (0.08-0.2 Hz): the tone is alive but never rubs.
      const beatHz = 0.08 + (Math.round(freq) % 7) * 0.02;
      const cents = (1731 * beatHz) / freq;
      chains[group] = this.droneAddSine(chains[group], rest, oscs, t, freq, -cents / 2, lvl * 0.5);
      chains[group] = this.droneAddSine(chains[group], rest, oscs, t, freq, cents / 2, lvl * 0.5);
    };
    for (const p of partials) add(p.group, fund * p.n, p.g);
    // A just fifth (3:2) joins on some phrases: it shares partial 3, so it adds warmth without beating.
    if (fifth) {
      add(1, fund * 1.5, 0.2);
      add(2, fund * 3, 0.06);
    }
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    const top = 1000 + 900 * mood.glow;
    this.droneCurve(lp.frequency, t, span, (s) => top * (0.85 + 0.15 * Math.sin((2 * Math.PI * s) / (breath * 4))));
    const sum = this.ctx.createGain();
    sum.connect(lp);
    rest.push(lp, sum);
    const mix = new MixChain(this.ctx, sum, false);
    // Group 0 (1, 2) barely moves; groups 1-3 breathe a third of a cycle apart, so the light climbs the series.
    const depth = [0.12, 0.5, 0.55, 0.6];
    chains.forEach((chain, i) => {
      if (!chain) return;
      const g = this.ctx.createGain();
      const phase = i === 0 ? 0 : ((i - 1) * 2 * Math.PI) / 3;
      this.droneCurve(g.gain, t, span, (s) => level * droneEnv(s, fade, length, fade) * (1 - depth[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * s) / breath - phase))));
      chain.connect(g);
      const pan = this.panNode(i === 0 ? 0 : (i % 2 === 0 ? -0.3 : 0.3), mix);
      pan.add(g);
      rest.push(g, pan.dest);
    });
    const out = this.panNode(0, this.busIn.harm);
    out.add(lp);
    rest.push(out.dest);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + span + 0.05));
  }

  /**
   * Glints: at most one per `gap` beats, on the chain's glitch hits (and a share of its hats when it is busy).
   * Density raises the share; heat shortens the gap a little.
   */
  private droneGlintDue(c: Ctx, mood: { busy: number; glow: number; move: number }, gap: number): boolean {
    const { v, step, sec } = c;
    if (sec.hat + sec.glitch <= 0) return false;
    const idlePerc = Math.max(c.hit.idle?.hat ?? 1, c.hit.idle?.glitch ?? 1);
    if (idlePerc < 0.04) return false;
    if (c.t < this.droneGlintNext) return false;
    const share = 2 + Math.min(6, mood.busy >> 1);
    const hit = v[3][step] > 0 || (v[2][step] > 0 && hash32(c.epoch, c.n, 0x91) % 20 < share);
    if (!hit) return false;
    this.droneGlintNext = c.t + (gap * c.dur * 4) / (1 + 0.4 * c.heat);
    return true;
  }

  /**
   * A soft bell: a sine and its octave, a slow-ish attack and a long decay, through a gentle lowpass, mostly room.
   * `midi` is ignored when `freq` is given.
   */
  private droneGlint(c: Ctx, midi: number, level: number, decay: number, attack = 0.05, top = 2600, freq = 0) {
    const t = c.t;
    const f0 = freq > 0 ? freq : midiToFreq(midi);
    const idlePerc = Math.max(c.hit.idle?.hat ?? 1, c.hit.idle?.glitch ?? 1);
    const peak = level * c.vel * Math.min(1, idlePerc) * clamp(c.sec.hat + c.sec.glitch, 0.5, 1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    lp.frequency.value = top;
    const amp = this.ctx.createGain();
    pulse(amp.gain, t, attack, Math.max(0.002, peak), decay);
    lp.connect(amp);
    const pan = this.panNode(((hash32(c.epoch, c.n, 0x9b) % 200) / 99.5 - 1) * 0.7, this.busIn.fx);
    pan.add(amp);
    const rest: AudioNode[] = [lp, amp, pan.dest];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    for (const [ratio, g] of [[1, 0.8], [2, 0.16]] as const) {
      // A high glint is a pure sine: its octave would sit above the lowpass.
      if (f0 * ratio > top) continue;
      chain = this.droneAddSine(chain, rest, oscs, t, f0 * ratio, 0, g);
    }
    chain!.connect(lp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + attack + decay + 0.05));
  }

  /**
   * A rare deep sub swell, Dark Low's weight lent to the other styles: once every eight bars when the chain has
   * kicks, every four when it is busy. A soft bloom on the tonic, not a hit.
   */
  private droneRareSub(c: Ctx, salt: number) {
    const { v, step, sec } = c;
    if (step !== 0 || rowCount(v[0]) < 2 || sec.kick < 0.3) return;
    const slot = hash32(c.epoch, salt) % 8;
    const bar = ((c.hit.bar % 8) + 8) % 8;
    const every4 = rowCount(v[0]) >= 4 || c.heat >= 0.6;
    if (bar !== slot && !(every4 && bar === (slot + 4) % 8)) return;
    this.droneSubSwell(c, 0.06 * sec.kick * (0.8 + 0.3 * c.heat));
  }

  private droneSubSwell(c: Ctx, level: number) {
    const t = c.t;
    const attack = 0.9;
    const decay = 5.5;
    const span = attack + decay;
    const f0 = midiToFreq(c.low);
    const rest: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    for (const [freq, g] of [[f0, 0.7], [f0 / 2, f0 / 2 >= 27 ? 0.35 : 0]] as const) {
      const before = oscs.length;
      chain = this.droneAddSine(chain, rest, oscs, t, freq, 0, g);
      if (oscs.length > before) {
        // A breath of pitch: starts 3% sharp and settles, so the swell blooms rather than thuds.
        const osc = oscs[oscs.length - 1];
        osc.frequency.setValueAtTime(freq * 1.03, t);
        osc.frequency.exponentialRampToValueAtTime(freq, t + 1.2);
      }
    }
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    lp.frequency.value = 170;
    const amp = this.ctx.createGain();
    this.droneCurve(amp.gain, t, span, (s) =>
      s < attack ? level * (0.5 - 0.5 * Math.cos((Math.PI * s) / attack)) : level * Math.pow(0.0005, (s - attack) / decay) * (1 - (s - attack) / decay),
    );
    chain!.connect(lp);
    lp.connect(amp);
    const pan = this.panNode(0, this.busIn.bass);
    pan.add(amp);
    rest.push(lp, amp, pan.dest);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + span + 0.05));
  }

  /** Beating sines. `midi` is absolute; callers stay on the tonic, the fifth and their octaves. */
  private droneSineBed(
    time: number,
    rest: AudioNode[],
    oscs: OscillatorNode[],
    voices: readonly (readonly [number, number, number])[],
  ): AudioNode {
    let chain: AudioNode | null = null;
    for (const [midi, cents, level] of voices) {
      chain = this.droneAddSine(chain, rest, oscs, time, midiToFreq(midi), cents, level);
    }
    return chain ?? this.ctx.createGain();
  }

  /** One sine into a pairwise sum. Near-silent partials are left out so a dark phrase does not spawn them. */
  private droneAddSine(
    chain: AudioNode | null,
    rest: AudioNode[],
    oscs: OscillatorNode[],
    time: number,
    freq: number,
    cents: number,
    level: number,
  ): AudioNode | null {
    if (!(level > 0.004) || !(freq > 0)) return chain;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(Math.max(18, freq), time);
    osc.detune.setValueAtTime(cents, time);
    const g = this.ctx.createGain();
    g.gain.value = level;
    osc.connect(g);
    rest.push(g);
    oscs.push(osc);
    return this.pairSum(chain, g, rest);
  }

  /** Slow attack, hold, release to silence. Shared by the long drone beds. */
  private droneFade(gain: AudioParam, time: number, attack: number, length: number, release: number, level: number) {
    const end = time + length + release;
    const peak = Math.max(0.0001, level);
    gain.setValueAtTime(0.0001, time);
    gain.linearRampToValueAtTime(peak, time + Math.max(0.05, attack));
    gain.setValueAtTime(peak, time + length);
    gain.linearRampToValueAtTime(0.0001, end);
    gain.setValueAtTime(0, end);
  }

  /**
   * `fn(seconds since time)` over [time, time + span] as a 20 Hz value curve, landing on exactly 0 afterwards for
   * gains: slow LFOs and crossfades without extra oscillators, identical on every render.
   */
  private droneCurve(param: AudioParam, time: number, span: number, fn: (s: number) => number) {
    const n = Math.max(2, Math.ceil(span * 20) + 1);
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = fn((i / (n - 1)) * span);
    param.setValueCurveAtTime(curve, time, span);
  }

  /**
   * Liquid DnB, three sound worlds over one drum engine (liquidBreak): the break leads, the sub rolls under it and
   * the harmony sits back as a bed. Keys: LTJ Bukem / High Contrast, a crisp two-step, a lush pad vamp and a
   * warm Rhodes that mostly holds chords, with a few offbeat stabs and a short answer every eight bars.
   */
  private liquid(c: Ctx) {
    if (c.style.id === "atmos") return this.liquidAtmos(c);
    if (c.style.id === "soulful") return this.liquidSoulful(c);
    const { v, step, t, sec } = c;
    const vamp = LIQUID_VAMPS[hash32(c.epoch, 0x11d) % LIQUID_VAMPS.length];
    const second = Math.floor(c.hit.bar / 4) % 2 === 1;
    const chord = second ? vamp.b : vamp.a;
    this.liquidBreak(c, LIQUID_KITS.classic);
    // Pad: the vamp, four bars a chord, voices overlapping so the change is a blend.
    const padRoot = 52 + ((c.tonic - 4 + 12) % 12);
    if (step === 0 && (c.hit.bar % 4 === 0 || t >= this.padUntil - c.dur * 2)) {
      const bars = 4 - (((c.hit.bar % 4) + 4) % 4);
      this.pad(c, padRoot, chord.pad, bars * 16 * c.dur, 1.35);
    }
    // Rolling sub on the chain's bass onsets, on the chord root; the downbeat of a chord always speaks.
    const onset = bassAt(c.arr.bass, step) > 0 || (step === 0 && c.hit.bar % 4 === 0 && rowMax(v[0]) > 0);
    if (onset) {
      let midi = c.low + chord.root;
      if (midi < 28) midi += 12;
      const len = this.holdSteps(c.arr.bass, step, 6) * c.dur;
      this.sub(c, midi, len, LIQUID_SUB.classic);
      this.sub(c, midi + 12, len, 0.14);
    }
    if (sec.lead <= 0) return;
    const tones = chord.pad.filter((x) => x >= 0).sort((a, b) => a - b);
    // Keys: a soft held chord where the vamp changes, a few short offbeat stabs in between (the chain's glitch
    // row adds the non-core ones), and in the seventh bar of eight a three-note answer on the chord's top tones;
    // the third bar's call only when the glitch tier is busy. Everything else is space.
    const bar8 = c.hit.bar & 7;
    const answer = bar8 === 6 || (bar8 === 2 && rowCount(v[3]) > 2);
    if (step === 0 && c.hit.bar % 4 === 0) {
      for (const semi of tones.slice(-4)) this.motifNote(c, padRoot + semi, 40 * c.dur, sec.lead * 0.28);
    }
    if (!answer) {
      const fig = LIQUID_STABS[hash32(c.epoch, 0xa1) % LIQUID_STABS.length];
      const hit = fig.find((x) => x.s === (c.hit.bar & 3) * 16 + step);
      if (hit && (hit.core || rowCount(v[3]) > 0)) {
        for (const semi of tones.slice(-3)) this.motifNote(c, padRoot + semi, hit.len * c.dur, sec.lead * (hit.core ? 0.32 : 0.26));
      }
      return;
    }
    const phrase = LIQUID_ANSWERS[hash32(c.epoch, 0x9e) % LIQUID_ANSWERS.length];
    const i = phrase.findIndex((x) => x.s === step);
    if (i >= 0 && (bar8 === 6 || i > 0)) {
      const top = tones.slice(-3);
      const contour = LIQUID_CONTOURS[hash32(c.epoch, 0x9f) % LIQUID_CONTOURS.length];
      this.motifNote(c, padRoot + top[contour[i] % top.length], phrase[i].len * c.dur, sec.lead * 0.55);
    }
  }

  /**
   * The liquid drum engine: a composed two-bar break (LIQUID_KITS) in front of the music. Kick and backbeat snare
   * always speak; the chopped ghost layer and the shaker 16ths fill in with the chain's snare, glitch and hat rows;
   * every fourth bar turns (all ghosts, an open hat), every eighth ends on a fill and the next one opens on a crash.
   * Intro and the start of the rebuild play it half-time (kick on 1, snare on 3, hats only).
   */
  private liquidBreak(c: Ctx, kit: LiquidKit) {
    const { v, step, t, sec } = c;
    const half = sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30);
    const brk = kit.breaks[hash32(c.epoch, 0x1b4e) % kit.breaks.length];
    const pos = (c.hit.bar & 1) * 16 + step;
    const turn = !half && c.hit.bar % 4 === 3;
    const fill = !half && c.hit.bar % 8 === 7 && step >= 8 ? LIQUID_FILLS[hash32(c.epoch, c.hit.bar >> 3, 0xf1) % LIQUID_FILLS.length] : null;
    // Small fixed per-hit velocity spread, so no two hits of a bar are quite equal.
    const human = 0.93 + (hash32(c.epoch, c.hit.bar, step, 0x7e1) % 15) / 100;
    if (rowMax(v[0]) > 0) {
      let kv = half ? (step === 0 ? 1 : 0) : fill ? lane(fill.kick, step - 8) : lane(brk.kick, pos);
      // Soft kicks are pickups: they need a busy kick row.
      if (kv > 0 && kv < 0.5 && rowCount(v[0]) < 4) kv = 0;
      if (kv > 0) {
        this.kick(t, c.vel * kit.kickLevel * kv * human, kit.kick);
        this.duck(t);
      }
    }
    if (rowMax(v[1]) > 0) {
      const sv = half ? (step === 8 ? 1 : 0) : fill ? lane(fill.snare, step - 8) : lane(brk.snare, pos);
      const accent = Math.max(0.65, sec.snare);
      if (sv >= 0.75) this.liquidKitSnare(kit, t, c.vel * kit.snareLevel * sv * accent * human, -c.pan * 0.15, 1);
      else if (sv > 0) this.liquidKitSnare(kit, t, c.vel * kit.snareLevel * sv * 0.85 * human, c.pan * 0.4, 0.55);
      else if (!half) {
        const g = lane(brk.ghost, pos);
        const busy = turn || rowCount(v[3]) > 0 || v[1].some((x) => x > 0 && x < 0.9);
        const side = step % 2 === 1 ? 0.35 : -0.25;
        if (g >= 0.3 || (g > 0 && busy)) this.liquidKitSnare(kit, t, c.vel * kit.ghostLevel * g * human, side, 0.32);
        else if (g === 0 && v[1][step] > 0 && v[1][step] < 0.9 && step % 4 !== 0) this.liquidKitSnare(kit, t, c.vel * kit.ghostLevel * 0.12, side, 0.3);
      }
    }
    if (rowMax(v[2]) > 0) {
      const hv = lane(brk.hat, pos);
      const odd = step % 2 === 1;
      if (hv > 0 && (!odd || v[2][step] > 0 || rowCount(v[2]) >= 10 || turn)) {
        const h = odd ? kit.shaker : kit.hat;
        this.hat(t, c.vel * h.level * hv * human, { hp: h.hp, decay: h.decay, metal: h.metal, pan: h.pan, q: h.q });
      }
      const ov = half ? 0 : Math.max(lane(brk.open, pos), turn && step === 14 ? 0.6 : 0);
      if (ov > 0 && !(fill && step >= 12)) this.hat(t, c.vel * kit.open.level * ov * human, { hp: kit.open.hp, decay: kit.open.decay, metal: kit.open.metal, pan: kit.open.pan, q: kit.open.q });
      if (c.heat > 0 && v[2][step] > 0) this.hatRoll(c, kit.hat.hp);
      // Crash on the first bar of each eight-bar phrase (the bar after a fill).
      if (!half && step === 0 && c.hit.bar % 8 === 0) this.hat(t, c.vel * kit.crash, { hp: 3600, decay: 0.75, metal: 1, pan: -0.3, q: 0.8 });
    }
    if (c.heat >= 0.5 && v[1][step] === 0 && !fill) this.rollUp(c, (time, vel) => this.liquidKitSnare(kit, time, vel * 0.7, 0, 0.45));
  }

  private liquidKitSnare(kit: LiquidKit, time: number, velocity: number, panAmount: number, tail: number) {
    if (kit.snare === "soft") this.liquidSoftSnare(time, velocity, panAmount, tail);
    else if (kit.snare === "soul") this.liquidSoulSnare(time, velocity, panAmount, tail);
    else this.liquidSnare(time, velocity, panAmount, tail);
  }

  /** Keys snare: a tuned body with a shell ring, a hard crack of noise and a long bright air on top. `tail` scales the decay (ghosts are short). */
  private liquidSnare(time: number, velocity: number, panAmount: number, tail: number) {
    this.toneHit(time, 0.5 * velocity, { type: "triangle", freq: 232, to: 188, sweep: 0.03, decay: 0.09, pan: panAmount, bus: this.busIn.snare });
    this.toneHit(time, 0.16 * velocity, { type: "sine", freq: 334, decay: 0.05, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.95 * velocity, { type: "bandpass", freq: 2500, q: 0.8, decay: 0.16 * tail, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.5 * velocity, { type: "highpass", freq: 6800, q: 0.7, decay: 0.12 * tail, pan: panAmount, bus: this.busIn.snare });
  }

  /**
   * Atmospheric (LTJ Bukem / Good Looking): a soft, ghost-filled break under a jazzy ride, a deep held sub,
   * eight-bar chords as a double pad plus an airy formant choir; the flute/Rhodes only answers in the second half
   * of each eight bars, and wind swells.
   */
  private liquidAtmos(c: Ctx) {
    const { v, step, t, sec } = c;
    const vamp = LIQUID_VAMPS[hash32(c.epoch, 0x11d) % LIQUID_VAMPS.length];
    const second = Math.floor(c.hit.bar / 8) % 2 === 1;
    const chord = second ? vamp.b : vamp.a;
    const padRoot = 52 + ((c.tonic - 4 + 12) % 12);
    this.liquidBreak(c, LIQUID_KITS.atmos);
    // Pads: eight bars a chord, the full voicing plus its upper tones an octave higher, and the choir on top.
    if (step === 0 && (c.hit.bar % 8 === 0 || t >= this.padUntil - c.dur * 2)) {
      const bars = 8 - (((c.hit.bar % 8) + 8) % 8);
      const len = bars * 16 * c.dur;
      const tones = chord.pad.filter((x) => x >= 0).sort((a, b) => a - b);
      this.pad(c, padRoot, chord.pad, len, 1.15, 0.8);
      this.pad(c, padRoot + 12, tones.slice(-3), len, 0.85, 0.6);
      this.liquidChoir(c, padRoot + 12, tones.slice(-3), len, 0.65);
    }
    // Wind: a slow band of air swelling every four bars.
    if (step === 0 && c.hit.bar % 4 === 0) {
      const bar = c.dur * 16;
      this.noiseHit(t, 0.03 + 0.03 * c.heat, { type: "bandpass", freq: 1800 + 1500 * c.color, to: 6500, q: 1.2, attack: bar * 1.6, decay: bar * 2.2, pan: c.pan * 1.5, bus: this.busIn.fx });
    }
    // Sub: long held notes on the chord root; the chain's bass onsets on the kick positions re-strike it.
    const strike = (s: number) => s === 0 || ((s === 6 || s === 10) && bassAt(c.arr.bass, s) > 0);
    if (strike(step) && rowMax(v[0]) > 0) {
      let midi = c.low + chord.root;
      if (midi < 28) midi += 12;
      let hold = 1;
      while (step + hold < 16 && !strike(step + hold)) hold++;
      this.sub(c, midi, hold * c.dur, LIQUID_SUB.atmos);
    }
    // Lead: a slow four-bar line on the chord's tones, an octave up, only in bars 5-8 of each eight (the answer
    // to four bars of pads alone); the chain adds passing notes.
    if (sec.lead > 0 && (c.hit.bar & 7) >= 4) {
      const phrase = LIQUID_ATMOS_PHRASES[hash32(c.epoch, 0xa7) % LIQUID_ATMOS_PHRASES.length];
      const pos = (c.hit.bar & 3) * 16 + step;
      const i = phrase.findIndex((x) => x.s === pos);
      if (i >= 0 && (phrase[i].core || rowCount(v[3]) > 0)) {
        const tones = chord.pad.filter((x) => x >= 0).sort((a, b) => a - b);
        const contour = LIQUID_CONTOURS[hash32(c.epoch, 0xa8) % LIQUID_CONTOURS.length];
        const midi = padRoot + 12 + tones[contour[i % contour.length] % tones.length];
        this.motifNote(c, midi, phrase[i].len * c.dur, sec.lead * (phrase[i].core ? 0.62 : 0.42));
      }
    }
  }

  /** Soft break snare: a lower, rounder body and a dark, roomy band of noise with a little air. */
  private liquidSoftSnare(time: number, velocity: number, panAmount: number, tail: number) {
    this.toneHit(time, 0.46 * velocity, { type: "triangle", freq: 200, to: 170, sweep: 0.05, decay: 0.1, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.85 * velocity, { type: "bandpass", freq: 1750, q: 0.6, decay: 0.24 * tail, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.3 * velocity, { type: "highpass", freq: 5600, q: 0.7, decay: 0.1 * tail, pan: panAmount, bus: this.busIn.snare });
  }

  /**
   * Airy choir: per tone two detuned saws through "oo"→"ah" formants that open over the chord, slow attack, gentle
   * vibrato. The pool tick sets the vowel, heat makes it brighter.
   */
  private liquidChoir(c: Ctx, root: number, tones: number[], length: number, gain = 1) {
    const t = c.t;
    const attack = Math.min(2.4, length * 0.35);
    const release = 3;
    const end = t + length + release;
    const f1 = this.ctx.createBiquadFilter();
    const f2 = this.ctx.createBiquadFilter();
    f1.type = "bandpass";
    f2.type = "bandpass";
    f1.Q.value = 4;
    f2.Q.value = 6;
    const open = 0.5 + 0.5 * c.color;
    f1.frequency.setValueAtTime(380, t);
    f1.frequency.linearRampToValueAtTime(380 + 420 * open, t + length * 0.6);
    f2.frequency.setValueAtTime(900, t);
    f2.frequency.linearRampToValueAtTime(900 + (300 + 500 * c.heat) * open, t + length * 0.6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200 + 2400 * c.heat;
    lp.Q.value = 0.5;
    const formants = this.ctx.createGain();
    f1.connect(formants);
    f2.connect(formants);
    formants.connect(lp);
    const amp = this.ctx.createGain();
    const level = 0.16 * (1 + 0.3 * c.heat) * gain;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setValueAtTime(level, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    lp.connect(amp);
    const pan = this.panNode(-0.15, this.busIn.harm);
    pan.add(amp);
    const vib = this.ctx.createOscillator();
    vib.frequency.setValueAtTime(4.6, t);
    const vibG = this.ctx.createGain();
    vibG.gain.value = 7;
    vib.connect(vibG);
    const rest: AudioNode[] = [vibG, f1, f2, formants, lp, amp, pan.dest];
    const oscs: OscillatorNode[] = [vib];
    let chain: AudioNode | null = null;
    tones.forEach((semi, i) => {
      for (const cents of [-9, 8]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(cents + (i - 1) * 3, t);
        vibG.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = 0.5;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    const src = chain as AudioNode | null;
    src?.connect(f1);
    src?.connect(f2);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /**
   * Soulful (Calibre / Marcus Intalex / Lenzman): a rolling, ghost-heavy break with shaker and tambourine, a
   * jazzy four-chord minor progression (two bars a chord) comped on a clean Rhodes with pushed anticipations,
   * string swells on each chord and a warm round sub walking the roots with octave hops. No lead line at all.
   */
  private liquidSoulful(c: Ctx) {
    const { v, step, sec } = c;
    const prog = LIQUID_SOUL_PROGS[hash32(c.epoch, 0x501) % LIQUID_SOUL_PROGS.length];
    const at = (bar: number) => prog[(bar >> 1) & 3];
    const chord = at(c.hit.bar);
    const padRoot = 52 + ((c.tonic - 4 + 12) % 12);
    const pos = (c.hit.bar & 1) * 16 + step;
    this.liquidBreak(c, LIQUID_KITS.soulful);
    // Strings: each chord's upper tones an octave up, swelling over its two bars; fuller where the break is bare.
    if (pos === 0) {
      const bare = sec.name === "intro" || sec.name === "breakdown";
      this.liquidStrings(c, padRoot + 12, chord.pad.slice(-3), 32 * c.dur, bare ? 1 : 0.7);
    }
    // Sub: a composed two-bar walk on the chord root; non-core notes follow the chain's bass row.
    const walk = LIQUID_SOUL_BASS[hash32(c.epoch, 0x502) % LIQUID_SOUL_BASS.length];
    const note = walk.find((x) => x.s === pos);
    if (note && rowMax(v[0]) > 0 && (note.core || bassAt(c.arr.bass, step) > 0)) {
      let midi = c.low + chord.root;
      if (midi < 28) midi += 12;
      this.sub(c, midi + 12 * note.oct, note.len * c.dur, note.oct ? LIQUID_SUB.soulful * 0.5 : LIQUID_SUB.soulful);
    }
    // Rhodes comp: the whole voicing, softly; a pushed hit on the last 16th takes the next chord early.
    if (sec.lead > 0) {
      const comp = LIQUID_SOUL_COMP[hash32(c.epoch, 0x503) % LIQUID_SOUL_COMP.length];
      const hit = comp.find((x) => x.s === pos);
      if (hit && (hit.core || rowCount(v[3]) > 0)) {
        const voicing = hit.s >= 30 ? at(c.hit.bar + 1) : chord;
        for (const semi of voicing.pad) this.motifNote(c, padRoot + semi, hit.len * c.dur, sec.lead * (hit.core ? 0.4 : 0.3));
      }
    }
  }

  /** Soulful snare: a warm body, a rimshot snap and a roomy band of noise. */
  private liquidSoulSnare(time: number, velocity: number, panAmount: number, tail: number) {
    this.toneHit(time, 0.48 * velocity, { type: "triangle", freq: 206, to: 174, sweep: 0.04, decay: 0.11, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.4 * velocity, { type: "bandpass", freq: 4300, q: 1.4, decay: 0.022, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.85 * velocity, { type: "bandpass", freq: 1900, q: 0.65, decay: 0.21 * tail, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.32 * velocity, { type: "highpass", freq: 6200, q: 0.7, decay: 0.09 * tail, pan: panAmount, bus: this.busIn.snare });
  }

  /**
   * String swell: per tone three detuned saws through a lowpass that opens with the swell, a slow attack over
   * most of the chord and a long release, a little vibrato. Pool tick and heat brighten it.
   */
  private liquidStrings(c: Ctx, root: number, tones: number[], length: number, level: number) {
    const t = c.t;
    const attack = length * 0.55;
    const release = 2.2;
    const end = t + length + release;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.7;
    const cutoff = 1100 + 900 * c.color + 900 * c.heat;
    f.frequency.setValueAtTime(cutoff * 0.45, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + attack);
    f.frequency.linearRampToValueAtTime(cutoff * 0.6, t + length);
    const amp = this.ctx.createGain();
    const peak = 0.12 * level * (1 + 0.3 * c.heat);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + attack);
    amp.gain.linearRampToValueAtTime(peak * 0.7, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    f.connect(amp);
    const pan = this.panNode(-0.12, this.busIn.harm);
    pan.add(amp);
    const vib = this.ctx.createOscillator();
    vib.frequency.setValueAtTime(5.1, t);
    const vibG = this.ctx.createGain();
    vibG.gain.value = 4;
    vib.connect(vibG);
    const rest: AudioNode[] = [vibG, f, amp, pan.dest];
    const oscs: OscillatorNode[] = [vib];
    let chain: AudioNode | null = null;
    tones.forEach((semi, i) => {
      for (const cents of [-11, 1, 10]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(cents + i * 2, t);
        vibG.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = 0.33;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    (chain as AudioNode | null)?.connect(f);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /**
   * Future Garage, three sound worlds. Vocal Chops: Burial / Sepalcure / Jacques Greene, a pitched vocal hook on a
   * moving minor-9th progression. Dark Sub: Archangel / Kode9, a wobbling reese under a far-off choir, little melody.
   * Rain Atmos: Jamie xx / Submerse, an airy vamp with choir swells.
   */
  private futureGarage(c: Ctx) {
    if (c.style.id === "dark") return this.garageDark(c);
    if (c.style.id === "atmos") return this.garageAtmos(c);
    this.garageChops(c);
  }

  /**
   * Vocal Chops. A warm pad walks the epoch's progression, two bars a chord. No tune: past the intro a soft "oo"
   * holds each chord's guide tone (3rd or 7th), and a reversed chop swells into every eight-bar cycle. Shuffled 2-step with skippy ghost snares and shakers, deep sub on the root.
   */
  private garageChops(c: Ctx) {
    const { v, step, t, sec } = c;
    const half = sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30);
    const at = (((c.hit.bar % 2) + 2) % 2) * 16 + step;
    const k = rowCount(v[0]);
    if (k > 0 && rowMax(v[0]) > 0) {
      const figs = k <= 2 ? [[0, 10]] : k <= 4 ? [[0, 10], [0, 7, 10]] : [[0, 7, 10], [0, 3, 10], [0, 10, 13]];
      const fig = half ? [0] : figs[hash32(c.epoch, k, 0xf6) % figs.length];
      if (fig.includes(step)) {
        this.kick(t, c.vel * (step === 0 ? 0.95 : 0.8), { start: 118, end: 45, sweep: 0.05, decay: 0.32, click: 0.08, body: 1.05 });
        this.duck(t);
      }
    }
    // Snare on 2 and 4 (beat 3 in half-time). Ghosts follow a composed skip figure; the chain's ghost count says
    // how far into it to play. The chain's fill rolls still come through.
    if (rowMax(v[1]) > 0) {
      const main = half ? step === 8 : step === 4 || step === 12;
      if (main) this.garageSnare(t, c.vel * Math.max(0.6, sec.snare), -c.pan * 0.2, false);
      else if (step >= 13 && v[1][step] >= 0.38) this.garageSnare(t, c.vel * v[1][step] * 0.7, c.pan * 0.4, true);
      else if (!half) {
        const ghosts = v[1].filter((x) => x > 0 && x < 0.9).length;
        const skips = GARAGE_SKIPS[hash32(c.epoch, 0xf7) % GARAGE_SKIPS.length];
        const i = skips.findIndex(([s]) => s === at);
        if (i >= 0 && i < 2 + 2 * ghosts) this.garageSnare(t, c.vel * skips[i][1], c.pan * 0.5, true);
      }
    }
    // Shaker on the chain's 16ths, accented on the 8ths; a closed hat on the off-8ths; an open hat ends every 4th bar.
    if (v[2][step] > 0) {
      const off = step % 2 === 1;
      this.noiseHit(t, c.vel * v[2][step] * (off ? 0.11 : 0.2), { type: "bandpass", freq: 7600, q: 1.3, decay: 0.03, attack: 0.007, pan: off ? c.pan * 0.7 : -c.pan * 0.4, bus: this.busIn.hat });
      if (step % 4 === 2) this.hat(t, c.vel * v[2][step] * 0.22, { hp: 9000, decay: 0.018, metal: 0.15, pan: c.pan * 0.5 });
      if (c.heat > 0) this.hatRoll(c, 8800);
    }
    if (step === 14 && ((c.hit.bar % 4) + 4) % 4 === 3 && rowMax(v[2]) > 0) this.hat(t, c.vel * 0.18, { hp: 7400, decay: 0.11, metal: 0.25, pan: c.pan });
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.garageSnare(time, vel * 0.7, 0, true));

    const { chord, left, since } = this.garageChord(c, GARAGE_CHOP_PROGRESSIONS, 0xf8, 2);
    if (step === 0 && (since === 0 || t >= this.padUntil - c.dur * 2)) this.garageWarmPad(c, 48 + c.tonic, chord.pad, left * 16 * c.dur);
    // Sub on the chord root at each change and on the chain's onsets; some off-beat onsets jump the octave.
    // No note rings over the chord change.
    const nib = bassAt(c.arr.bass, step);
    if (nib > 0 || since === 0) {
      const midi = this.garageRoot(c, chord, 40) + (step % 4 !== 0 && nib % 3 === 0 ? 12 : 0);
      const len = Math.min(this.holdSteps(c.arr.bass, step, 6), left * 16 - step) * c.dur;
      this.sub(c, midi, len, 1);
      this.sub(c, midi + 12, len, 0.12);
    }

    // Counter-line: one held guide tone a chord.
    const base = 60 + (c.tonic >= 6 ? c.tonic - 12 : c.tonic);
    if (since === 0 && sec.name !== "intro") {
      this.garageChop(c, t, base + chord.guide, left * 16 * c.dur * 0.92, 0.5 * sec.pad, 3, { pan: -c.pan * 0.5, attack: 0.5, release: 0.3, body: 0.3 });
    }
    // A reversed chop on the tonic swells into the top of each eight-bar cycle (every progression ends on a chord
    // that holds the tonic, and starts on one that does too).
    if (step === 8 && ((c.hit.bar % 8) + 8) % 8 === 7 && sec.name !== "intro") this.garageChop(c, t, base + 12, 8 * c.dur, 0.6 * sec.pad, 0, { pan: c.pan * 0.8, rev: true, air: 0.3 });
    if (step === 0) this.vinyl(c, 1.1);
  }

  /**
   * Dark Sub (Burial "Archangel", "Near Dark", Kode9, Clubroot). A dark progression four bars a chord, sung by a
   * far-off breathy choir; a reese over the sub whose filter wobbles in time; a hard-shuffled 2-step of crunchy
   * snares, skips and metallic foley under rain and loud crackle. No tune. A noise swell
   * leans into every chord change; a boom opens the breakdown and the rebuild.
   */
  private garageDark(c: Ctx) {
    const { v, step, t, sec } = c;
    const half = sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30);
    const at = (((c.hit.bar % 2) + 2) % 2) * 16 + step;
    const k = rowCount(v[0]);
    if (k > 0 && rowMax(v[0]) > 0) {
      const figs = k <= 2 ? [[0, 10]] : k <= 4 ? [[0, 10], [0, 11]] : [[0, 10, 14], [0, 6, 11], [0, 3, 10]];
      const fig = half ? [0] : figs[hash32(c.epoch, k, 0xd6) % figs.length];
      if (fig.includes(step)) {
        this.kick(t, c.vel * (step === 0 ? 0.9 : 0.72), { start: 92, end: 41, sweep: 0.07, decay: 0.36, click: 0, body: 1.1 });
        this.duck(t);
      }
    }
    // The crunch on 2 and 4; the chain's ghosts become skips on the odd 16ths and the "e" of 4.
    if (rowMax(v[1]) > 0) {
      const main = half ? step === 8 : step === 4 || step === 12;
      if (main) this.garageCrunch(t, c.vel * Math.max(0.55, sec.snare), -c.pan * 0.2, 1);
      else if (!half && v[1][step] > 0 && v[1][step] < 0.9 && (step % 2 === 1 || step === 14)) this.garageCrunch(t, c.vel * 0.3, c.pan * 0.6, 0.45);
    }
    // Clicks on the even 16ths, a soft shaker on the odd ones; about one odd hit in four drops out, so it skips.
    if (v[2][step] > 0) {
      const skip = step % 2 === 1 && hash32(c.epoch, c.n, 0xd7) % 4 === 0;
      if (!skip) {
        if (step % 2 === 0) this.hat(t, c.vel * v[2][step] * 0.26, { hp: 7200, decay: 0.014, metal: 0.08, pan: c.pan * 0.8 });
        else this.noiseHit(t, c.vel * v[2][step] * 0.15, { type: "bandpass", freq: 5200, q: 1.2, decay: 0.05, attack: 0.012, pan: -c.pan, bus: this.busIn.hat });
      }
      if (c.heat > 0) this.hatRoll(c, 7200);
    }
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.garageCrunch(time, vel * 0.7, 0, 0.4));
    // Foley: a composed two-bar figure of metal ticks, more of it as the chain gets busier; glitches rattle.
    const dens = this.garageDensity(c);
    if (rowMax(v[2]) > 0 && !half) {
      const fol = GARAGE_FOLEY[hash32(c.epoch, 0xdb) % GARAGE_FOLEY.length];
      const i = fol.findIndex(([s]) => s === at);
      if (i >= 0 && i < 1 + Math.round(5 * dens)) this.garageFoley(c, t, c.vel * (i === 0 ? 0.9 : 0.6), fol[i][1], (i % 2 ? 0.6 : -0.6) * (0.5 + Math.abs(c.pan)));
    }
    if (v[3][step] > 0) {
      this.garageFoley(c, t, c.vel * 0.5, 2, c.pan * 1.4);
      this.garageFoley(c, t + c.dur * 0.5, c.vel * 0.3, 2, c.pan * 1.4);
    }

    const { chord, left, since } = this.garageChord(c, GARAGE_DARK_PROGRESSIONS, 0xd9, 4);
    if (step === 0 && (since === 0 || t >= this.padUntil - c.dur * 2)) this.garageDarkChoir(c, 48 + c.tonic, chord.dark, left * 16 * c.dur);
    // Bass: the chord root, long, on each change and on the chain's onsets that fall on a beat, held to the next
    // one but never over the chord change. Its wobble follows the heat; the breakdown and half-time slow it down.
    const onBeat = (s: number) => s % 4 === 0 && bassAt(c.arr.bass, s) > 0;
    if (onBeat(step) || since === 0) {
      let len = 1;
      while (len < 16 && !onBeat((step + len) % 16)) len++;
      const rate = half || sec.name === "breakdown" ? 0.5 : c.heat >= 0.6 ? 2 : 1;
      this.garageReese(c, this.garageRoot(c, chord, 37), Math.min(len, left * 16 - step) * c.dur, rate);
    }
    // Tension: a dark swell of noise through the last bar of each chord; a boom into the breakdown and the rebuild.
    if (step === 0 && left === 1 && sec.pad > 0) {
      this.noiseHit(t, 0.05 * (0.6 + 0.6 * c.heat), { type: "lowpass", freq: 220, to: 2400 + 1600 * c.color, q: 1.2, decay: 0.08, attack: c.dur * 15, pan: -c.pan * 0.5, bus: this.busIn.fx });
    }
    if (step === 0 && ((sec.name === "breakdown" && sec.bar === 24) || (sec.name === "rebuild" && sec.bar === 28))) {
      this.toneHit(t, 0.36, { type: "sine", freq: 96, to: 36, sweep: 0.5, decay: 1.4, pan: 0, bus: this.busIn.fx });
      this.noiseHit(t, 0.12, { type: "lowpass", freq: 700, to: 90, q: 0.8, decay: 1.1, pan: 0, bus: this.busIn.fx });
    }
    if (step === 0) {
      this.vinyl(c, 1.9);
      this.garageRain(c, 1, false);
    }
  }

  /** The chord at this bar of the epoch's progression (`salt` picks it), with steps since it began and bars left. */
  private garageChord(c: Ctx, progs: readonly (readonly number[])[], salt: number, bars: number) {
    const prog = progs[hash32(c.epoch, salt) % progs.length];
    const slot = Math.floor(c.hit.bar / bars);
    const inBar = ((c.hit.bar % bars) + bars) % bars;
    return { chord: GARAGE_CHORDS[prog[((slot % prog.length) + prog.length) % prog.length]], left: bars - inBar, since: inBar * 16 + c.step };
  }

  /** The chord root as a sub note at or under `ceiling` (MIDI). */
  private garageRoot(c: Ctx, chord: GarageChord, ceiling: number): number {
    let midi = c.low + chord.bass;
    while (midi > ceiling) midi -= 12;
    return midi;
  }

  /** How busy the composed figures may get: the chain's hats and glitches, the arranged energy, the heat. 0..1. */
  private garageDensity(c: Ctx): number {
    return Math.min(1, 0.5 * c.arr.energy + 0.35 * c.heat + 0.025 * (rowCount(c.v[2]) + rowCount(c.v[3])));
  }

  /** Vocal Chops snare: a tight clap on a short snappy body. A ghost is only the snap, small and dry. */
  private garageSnare(time: number, velocity: number, panAmount: number, ghost: boolean) {
    this.noiseHit(time, (ghost ? 0.3 : 0.38) * velocity, { type: "bandpass", freq: ghost ? 3300 : 2400, q: 0.9, decay: ghost ? 0.035 : 0.11, pan: panAmount, bus: this.busIn.snare });
    if (ghost) return;
    this.toneHit(time, 0.28 * velocity, { type: "triangle", freq: 230, to: 185, sweep: 0.04, decay: 0.07, pan: panAmount, bus: this.busIn.snare });
    this.clap(time + 0.004, 0.5 * velocity, -panAmount);
  }

  /** Burial's snare: short, dry and crunchy, a crushed crack of noise over a high tuned knock. `tail` scales it. */
  private garageCrunch(time: number, velocity: number, panAmount: number, tail: number) {
    this.toneHit(time, 0.3 * velocity, { type: "triangle", freq: 340, to: 260, sweep: 0.03, decay: 0.05 * tail + 0.01, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.3 * velocity, { type: "bandpass", freq: 3800, q: 1.5, decay: 0.04 * tail, pan: panAmount, bus: this.busIn.snare });
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const g = this.ctx.createGain();
    pulse(g.gain, time, 0.001, 0.55 * velocity, 0.1 * tail);
    const crush = this.ctx.createWaveShaper();
    crush.curve = new Float32Array(bitCurve(5));
    crush.oversample = "none";
    src.connect(hp);
    hp.connect(g);
    g.connect(crush);
    const pan = this.panNode(panAmount, this.busIn.snare);
    pan.add(crush);
    src.start(time);
    this.end(src, [hp, g, crush, pan.dest], time + 0.1 * tail + 0.06);
  }

  /**
   * Vocal Chops pad: per note a detuned saw pair and a triangle, held in pitch (no tape wow, so the chops above it
   * stay in tune); the movement is a slow filter breath across the chord.
   */
  private garageWarmPad(c: Ctx, root: number, chord: readonly number[], length: number) {
    const t = c.t;
    const attack = Math.min(0.8, length * 0.2);
    const release = 1.2;
    const end = t + length + release;
    this.padUntil = t + length;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 1.1;
    const cutoff = (560 + 1000 * c.color + 1100 * c.heat) * (c.press < 0 ? 1 + 0.35 * c.press : 1 + 0.1 * c.press);
    f.frequency.setValueAtTime(cutoff * 0.7, t);
    f.frequency.linearRampToValueAtTime(cutoff * 1.25, t + length * 0.5);
    f.frequency.linearRampToValueAtTime(cutoff * 0.8, end);
    const amp = this.ctx.createGain();
    const level = 0.07 * (1 + 0.3 * c.heat);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setValueAtTime(level, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    f.connect(amp);
    const pan = this.panNode(0.05, this.busIn.harm);
    pan.add(amp);
    const rest: AudioNode[] = [f, amp, pan.dest];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    chord.forEach((semi, i) => {
      for (const [type, cents, lvl] of [["sawtooth", -5, 0.3], ["sawtooth", 6, 0.3], ["triangle", 0, 0.3]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(cents + (i % 2 ? 1 : -1), t);
        const g = this.ctx.createGain();
        g.gain.value = lvl * (semi < 0 ? 0.6 : 1);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    (chain as AudioNode | null)?.connect(f);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /**
   * A vocal chop: a saw and a square through two vowel formants (GARAGE_VOWELS) over a little of the dry tone,
   * gated hard like a sliced sample. `rev` swells into its end and cuts (a reversed chop); `air` adds breath and a
   * faint octave above (pitched up, ghostly); `body` a sine an octave under. Pitch is fixed: no glide, no vibrato.
   */
  private garageChop(
    c: Ctx,
    time: number,
    midi: number,
    length: number,
    level: number,
    vowel: number,
    o: { pan: number; rev?: boolean; attack?: number; release?: number; air?: number; body?: number },
  ) {
    const freq = midiToFreq(midi);
    const hold = Math.max(0.03, length * 0.9);
    const release = o.release ?? (length > c.dur * 3 ? 0.1 : 0.025);
    const rest: AudioNode[] = [];
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
    let chain: AudioNode | null = null;
    const voices: [OscillatorType, number, number, number][] = [["sawtooth", -4, 1, 0.6], ["square", 5, 1, 0.35]];
    if (o.body) voices.push(["sine", 0, 0.5, 0.5 * o.body]);
    if (o.air) voices.push(["triangle", 3, 2, 0.3 * o.air]);
    for (const [type, cents, mult, lvl] of voices) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * mult, time);
      osc.detune.setValueAtTime(cents, time);
      const g = this.ctx.createGain();
      g.gain.value = lvl;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      sources.push(osc);
    }
    if (o.air) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noise();
      n.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0.22 * o.air;
      n.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      sources.push(n);
    }
    const voice = chain as AudioNode | null;
    if (!voice) return;
    const [f1, f2] = GARAGE_VOWELS[vowel % GARAGE_VOWELS.length];
    const shift = 0.9 + 0.25 * c.color;
    const a = this.ctx.createBiquadFilter();
    const b = this.ctx.createBiquadFilter();
    a.type = "bandpass";
    b.type = "bandpass";
    a.frequency.value = f1 * shift;
    b.frequency.value = f2 * shift;
    a.Q.value = 5;
    b.Q.value = 7;
    const dry = this.ctx.createGain();
    dry.gain.value = 0.12;
    voice.connect(a);
    voice.connect(b);
    voice.connect(dry);
    const ab = this.ctx.createGain();
    a.connect(ab);
    b.connect(ab);
    const mix = this.ctx.createGain();
    ab.connect(mix);
    dry.connect(mix);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = (2600 + 2400 * c.color + 1600 * c.heat) * (c.press < 0 ? 1 + 0.35 * c.press : 1);
    mix.connect(lp);
    const amp = this.ctx.createGain();
    const peak = 0.4 * level;
    let end: number;
    if (o.rev) {
      end = time + hold + 0.012;
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(peak, time + hold);
      amp.gain.linearRampToValueAtTime(0.0001, end);
    } else {
      const attack = Math.min(o.attack ?? 0.005, hold * 0.5);
      end = time + hold + release;
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.linearRampToValueAtTime(peak, time + attack);
      amp.gain.setValueAtTime(peak, time + hold);
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
    }
    amp.gain.setValueAtTime(0, end);
    lp.connect(amp);
    const pan = this.panNode(o.pan, this.busIn.lead);
    pan.add(amp);
    rest.push(a, b, dry, ab, mix, lp, amp, pan.dest);
    for (const src of sources) src.start(time);
    sources.forEach((src, i) => this.end(src, i === 0 ? rest : [], end + 0.05));
  }

  /**
   * Dark Sub choir: far-off breathy voices. Each chord tone a close-detuned saw pair, all through one dark "oo"
   * formant pair with a breath of noise; a long swell in and out, mostly room.
   */
  private garageDarkChoir(c: Ctx, root: number, chord: readonly number[], length: number) {
    const t = c.t;
    const attack = Math.min(3.2, length * 0.45);
    const release = 2.5;
    const end = t + length + release;
    this.padUntil = t + length;
    const rest: AudioNode[] = [];
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
    let chain: AudioNode | null = null;
    chord.forEach((semi, i) => {
      for (const cents of [-4 - i, 4 + i]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(cents, t);
        const g = this.ctx.createGain();
        g.gain.value = 0.5 * (semi < 0 ? 0.7 : 1);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        sources.push(osc);
      }
    });
    const breath = this.ctx.createBufferSource();
    breath.buffer = this.noise();
    breath.loop = true;
    const bg = this.ctx.createGain();
    bg.gain.value = 0.35;
    breath.connect(bg);
    rest.push(bg);
    chain = this.pairSum(chain, bg, rest);
    sources.push(breath);
    const shift = 0.9 + 0.2 * c.color;
    const a = this.ctx.createBiquadFilter();
    const b = this.ctx.createBiquadFilter();
    a.type = "bandpass";
    b.type = "bandpass";
    a.frequency.value = 400 * shift;
    b.frequency.value = 900 * shift;
    a.Q.value = 3;
    b.Q.value = 4;
    (chain as AudioNode | null)?.connect(a);
    (chain as AudioNode | null)?.connect(b);
    const mix = this.ctx.createGain();
    a.connect(mix);
    b.connect(mix);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = (1300 + 900 * c.color + 700 * c.heat) * (c.press < 0 ? 1 + 0.4 * c.press : 1);
    // The choir stays out of the reese's register, so only one line moves down there.
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 220;
    hp.Q.value = 0.6;
    mix.connect(hp);
    hp.connect(lp);
    rest.push(hp);
    const amp = this.ctx.createGain();
    const level = 0.13 * (0.8 + 0.4 * c.heat);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setValueAtTime(level, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    lp.connect(amp);
    const pan = this.panNode(c.pan * 0.4, this.busIn.harm);
    pan.add(amp);
    rest.push(a, b, mix, lp, amp, pan.dest);
    for (const src of sources) src.start(t);
    sources.forEach((src, i) => this.end(src, i === 0 ? rest : [], end + 0.05));
  }

  /**
   * Dark Sub bass: the sine sub, and over it an octave-up detuned saw pair, driven, through a resonant lowpass that
   * wobbles in time with the beat (`rate` cycles per beat). The pitch never moves; only the filter does.
   */
  private garageReese(c: Ctx, midi: number, length: number, rate: number) {
    const t = c.t;
    this.sub(c, midi, length, 1.1);
    const hold = Math.max(0.1, length * 0.92);
    const end = t + hold + 0.12;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(2.2));
    shaper.oversample = "none";
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    // Low resonance: a high Q made the wobble sing the saw's harmonics as a second bass tune.
    f.Q.value = 1.4;
    const cut = (150 + 220 * c.color + 260 * c.heat) * (c.press < 0 ? 1 + 0.4 * c.press : 1 + 0.25 * c.press);
    f.frequency.setValueAtTime(cut, t);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(rate / (4 * c.dur), t);
    const depth = this.ctx.createGain();
    depth.gain.value = cut * 0.75;
    lfo.connect(depth);
    depth.connect(f.frequency);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.075, t + 0.02);
    amp.gain.setValueAtTime(0.075, t + hold);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    const rest: AudioNode[] = [depth, shaper, f, amp];
    const oscs: OscillatorNode[] = [lfo];
    let chain: AudioNode | null = null;
    for (const cents of [-8, 8]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(midiToFreq(midi + 12), t);
      osc.detune.setValueAtTime(cents, t);
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    (chain as AudioNode | null)?.connect(shaper);
    shaper.connect(f);
    f.connect(amp);
    this.busIn.bass.add(amp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.04));
  }

  /** Dark Sub foley: a dry metallic tick (keys, a can, a lighter), one of three objects tuned per epoch. */
  private garageFoley(c: Ctx, time: number, velocity: number, which: number, panAmount: number) {
    const base = Math.round([1400, 2300, 3500][which] * (0.85 + (hash32(c.epoch, which, 0xdc) % 30) / 100));
    const src = this.ctx.createBufferSource();
    src.buffer = this.metalBuffer(`gfoley${base}`, base, 0.018);
    const g = this.ctx.createGain();
    pulse(g.gain, time, 0.001, 0.3 * velocity, 0.08);
    src.connect(g);
    const pan = this.panNode(panAmount, this.busIn.perc);
    pan.add(g);
    src.start(time);
    this.end(src, [g, pan.dest], time + 0.14);
    this.noiseHit(time, 0.2 * velocity, { type: "highpass", freq: 6000, q: 0.7, decay: 0.006, pan: panAmount, bus: this.busIn.perc });
  }

  /** Rain bed, a bar at a time with overlap (like the vinyl). Sells bring more of it and darker; `air` lifts it. */
  private garageRainUntil = -1;
  private garageRain(c: Ctx, level: number, air: boolean) {
    const bar = c.dur * 16;
    if (c.t < this.garageRainUntil - bar * 0.5) return;
    this.garageRainUntil = c.t + bar;
    const key = `garageRain${this.era.index}:${this.ctx.sampleRate}`;
    let buffer = this.bufCache.get(key);
    if (!buffer) {
      buffer = garageRainBuffer(this.ctx, hash32(this.era.index, 0x4a1));
      this.cache(key, buffer);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = air ? 1600 : 450;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = air ? 9000 + 3000 * c.color : (2200 + 2600 * c.color) * (c.press < 0 ? 1 + 0.4 * c.press : 1);
    const g = this.ctx.createGain();
    const peak = 0.05 * level * (1 + 0.8 * Math.max(0, -c.press));
    g.gain.setValueAtTime(0.0001, c.t);
    g.gain.linearRampToValueAtTime(peak, c.t + 0.15);
    g.gain.setValueAtTime(peak, c.t + bar);
    g.gain.linearRampToValueAtTime(0.0001, c.t + bar + 0.15);
    g.gain.setValueAtTime(0, c.t + bar + 0.15);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    this.busIn.tex.add(g);
    src.start(c.t, (hash32(c.hit.bar, 0x4a2) % 3000) / 1000);
    this.end(src, [hp, lp, g], c.t + bar + 0.2);
  }

  /**
   * Rain Atmos (Jamie xx, Sorrow, Submerse): a soft rounded 2-step, a wide airy pad vamping between two chords of the
   * note set (fixed per epoch), choir chords chopped and swelled into the echo, a steel pan when the market is busy,
   * light rain on top.
   */
  private garageAtmos(c: Ctx) {
    const { v, step, t, sec } = c;
    const half = sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30);
    const vamp = GARAGE_VAMPS[hash32(c.epoch, 0xa7) % GARAGE_VAMPS.length];
    const chord = Math.floor(c.hit.bar / 4) % 2 === 1 ? vamp.b : vamp.a;
    const padRoot = 52 + ((c.tonic - 4 + 12) % 12);
    const k = rowCount(v[0]);
    if (k > 0 && rowMax(v[0]) > 0) {
      const figs = k <= 2 ? [[0, 10]] : k <= 4 ? [[0, 10], [0, 7, 10]] : [[0, 7, 10], [0, 10, 13], [0, 6, 10]];
      const fig = half ? [0] : figs[hash32(c.epoch, k, 0xa8) % figs.length];
      if (fig.includes(step)) {
        this.kick(t, c.vel * (step === 0 ? 0.8 : 0.66), { start: 105, end: 50, sweep: 0.05, decay: 0.24, click: 0.03, clickHp: 3000, body: 0.85 });
        this.duck(t);
      }
    }
    if (rowMax(v[1]) > 0) {
      const main = half ? step === 8 : step === 4 || step === 12;
      if (main) this.garageSoftSnare(t, c.vel * Math.max(0.5, sec.snare), -c.pan * 0.2);
      else if (!half && v[1][step] > 0 && v[1][step] < 0.9 && step % 4 !== 0) this.rim(t, c.vel * 0.14, c.pan, 2);
    }
    // Soft shaker on the even 16ths, a faint tick on the odd ones.
    if (v[2][step] > 0) {
      if (step % 2 === 0) this.noiseHit(t, c.vel * v[2][step] * 0.2, { type: "bandpass", freq: 7000, q: 0.9, decay: 0.035, attack: 0.006, pan: c.pan * 0.6, bus: this.busIn.hat });
      else this.hat(t, c.vel * v[2][step] * 0.11, { hp: 9500, decay: 0.012, metal: 0, pan: -c.pan * 0.8 });
      if (c.heat > 0) this.hatRoll(c, 9000);
    }
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.garageSoftSnare(time, vel * 0.6, 0));
    // Pad: the vamp, four bars a chord, bright and slow; an air layer two octaves up into the room.
    if (step === 0 && (c.hit.bar % 4 === 0 || t >= this.padUntil - c.dur * 2)) {
      const bars = 4 - (((c.hit.bar % 4) + 4) % 4);
      this.pad(c, padRoot, chord.pad, bars * 16 * c.dur, 1.9);
      this.garageAir(c, padRoot, chord.pad, bars * 16 * c.dur);
    }
    const onset = bassAt(c.arr.bass, step) > 0 || (step === 0 && c.hit.bar % 4 === 0 && rowMax(v[0]) > 0);
    if (onset) {
      let midi = c.low + chord.root;
      if (midi < 28) midi += 12;
      const len = this.holdSteps(c.arr.bass, step, 8) * c.dur;
      this.sub(c, midi, len, 0.95);
      this.sub(c, midi + 12, len, 0.14);
    }
    // Choir: a two-bar figure of chops and swells on the chord's top tones; the glitch tier fills in the extras.
    if (sec.lead > 0) {
      const fig = GARAGE_CHOIRS[hash32(c.epoch, 0xa9) % GARAGE_CHOIRS.length];
      const hit = fig.find((x) => x.s === (c.hit.bar & 1) * 16 + step);
      if (hit && (hit.core || rowCount(v[3]) > 0)) {
        const tones = chord.pad.slice().sort((a, b) => a - b).slice(-3);
        this.garageChoir(c, tones.map((s) => padRoot + s), hit.len * c.dur, sec.lead * (hit.core ? 1 : 0.8), hit.swell);
      }
      // Steel pan: only on a busy glitch tier, more of the figure the busier it is.
      const g = rowCount(v[3]);
      if (g > 0) {
        const pans = GARAGE_PANS[hash32(c.epoch, 0xaa) % GARAGE_PANS.length];
        const i = pans.findIndex((x) => x.s === (c.hit.bar & 1) * 16 + step);
        if (i >= 0 && i < 1 + g) {
          const tones = chord.pad.filter((x) => x >= 0 && x <= 12);
          const midi = padRoot + 12 + tones[hash32(c.epoch, i, 0xab) % tones.length];
          this.motifNote(c, midi, pans[i].len * c.dur, sec.lead * 0.6);
        }
      }
    }
    if (step === 0) this.garageRain(c, 0.75, true);
  }

  /** Rain Atmos snare: a soft brushed snap, more room than crack. */
  private garageSoftSnare(time: number, velocity: number, panAmount: number) {
    this.toneHit(time, 0.22 * velocity, { type: "sine", freq: 200, to: 170, sweep: 0.04, decay: 0.07, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.5 * velocity, { type: "bandpass", freq: 1900, q: 0.6, decay: 0.18, attack: 0.003, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.18 * velocity, { type: "lowpass", freq: 6000, to: 2500, q: 0.5, decay: 0.25, attack: 0.01, pan: -panAmount, bus: this.busIn.snare });
  }

  /** Rain Atmos air: the chord's top tones two octaves up as soft sines, slow in and out, mostly room. */
  private garageAir(c: Ctx, root: number, chord: number[], length: number) {
    const t = c.t;
    const attack = Math.min(2.4, length * 0.4);
    const end = t + length + 3.2;
    const level = 0.016 * (0.7 + 0.3 * c.color + 0.5 * c.heat);
    chord.slice().sort((a, b) => a - b).slice(-3).forEach((semi, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(midiToFreq(root + 24 + semi), t);
      osc.detune.setValueAtTime(i % 2 ? 4 : -4, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level, t + attack);
      g.gain.setValueAtTime(level, t + length);
      g.gain.linearRampToValueAtTime(0.0001, end);
      g.gain.setValueAtTime(0, end);
      osc.connect(g);
      const pan = this.panNode(i === 1 ? 0 : i === 0 ? -0.5 : 0.5, this.busIn.fx);
      pan.add(g);
      osc.start(t);
      this.end(osc, [g, pan.dest], end + 0.05);
    });
  }

  /** Rain Atmos choir: each note two detuned saws through an "ah" formant pair. A swell rises into its end and cuts. */
  private garageChoir(c: Ctx, midis: number[], length: number, level: number, swell: boolean) {
    const t = c.t;
    const rest: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    midis.forEach((midi, i) => {
      for (const cents of [-7 - i * 2, 6 + i * 2]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(midiToFreq(midi), t);
        osc.detune.setValueAtTime(cents, t);
        const g = this.ctx.createGain();
        g.gain.value = 0.5;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    const a = this.ctx.createBiquadFilter();
    const b = this.ctx.createBiquadFilter();
    a.type = "bandpass";
    b.type = "bandpass";
    a.frequency.value = 650;
    b.frequency.value = 1080;
    a.Q.value = 4;
    b.Q.value = 5;
    const mix = this.ctx.createGain();
    (chain as AudioNode | null)?.connect(a);
    (chain as AudioNode | null)?.connect(b);
    a.connect(mix);
    b.connect(mix);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = (2400 + 2200 * c.color + 1800 * c.heat) * (c.press < 0 ? 1 + 0.35 * c.press : 1);
    mix.connect(lp);
    const amp = this.ctx.createGain();
    const peak = 0.08 * level;
    let end: number;
    if (swell) {
      end = t + length + 0.04;
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.linearRampToValueAtTime(peak * 0.25, t + length * 0.5);
      amp.gain.exponentialRampToValueAtTime(peak, t + length);
      amp.gain.linearRampToValueAtTime(0.0001, end);
    } else {
      const hold = Math.max(0.04, length * 0.8);
      end = t + hold + 0.3;
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.012);
      amp.gain.setValueAtTime(peak, t + hold);
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
    }
    amp.gain.setValueAtTime(0, end);
    lp.connect(amp);
    const pan = this.panNode(c.pan * 0.8, this.busIn.lead);
    pan.add(amp);
    rest.push(a, b, mix, lp, amp, pan.dest);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /** Three fixed-tonic record worlds: dusty Rhodes, oppressive Bristol, and orchestral cut-up breaks. */
  private tripHop(c: Ctx) {
    if (c.style.id === "bristol") return this.tripHopBristol(c);
    if (c.style.id === "cinematic") return this.tripHopCinematic(c);
    const { v, step, t, sec } = c;
    const k = rowCount(v[0]);
    if (k > 0 && rowMax(v[0]) > 0) {
      const figs = k <= 2 ? [[0, 10]] : k <= 4 ? [[0, 7, 10], [0, 10, 11]] : [[0, 3, 10], [0, 7, 10, 11], [0, 6, 10]];
      const fig = sec.name === "intro" ? [0] : figs[hash32(c.epoch, k, 0x7c) % figs.length];
      if (fig.includes(step)) {
        this.kick(t, c.vel * (step === 0 ? 1 : 0.85), { start: 95, end: 44, sweep: 0.08, decay: 0.42, click: 0.15, drive: 1.8, body: 1.1 });
        this.duck(t);
      }
    }
    if (rowMax(v[1]) > 0) {
      if (step === 4 || step === 12) this.tapeSnare(t, c.vel * 0.95 * Math.max(0.5, sec.snare), -c.pan * 0.2);
      else if (v[1][step] > 0 && v[1][step] < 0.9 && step % 4 !== 0) this.tapeSnare(t, c.vel * 0.22, c.pan * 0.4);
    }
    if (v[2][step] > 0 && step % 2 === 0) this.hat(t, c.vel * v[2][step] * 0.3, { hp: 6000, decay: 0.03, metal: 0.2, pan: c.pan * 0.6 });
    // Glitch tier: a scratch, a band of noise swept up and back.
    if (v[3][step] > 0) {
      this.noiseHit(t, c.vel * 0.22, { type: "bandpass", freq: 700, to: 2600, q: 4, decay: 0.07, attack: 0.01, pan: c.pan, bus: this.busIn.fx });
      this.noiseHit(t + c.dur * 0.5, c.vel * 0.16, { type: "bandpass", freq: 2400, to: 800, q: 4, decay: 0.06, pan: -c.pan, bus: this.busIn.fx });
    }
    // A composed per-epoch progression, one chord per two bars; the Rhodes, strings and bass all follow it.
    const prog = TRIPHOP_RHODES_PROGRESSIONS[hash32(c.epoch, 0x7b) % TRIPHOP_RHODES_PROGRESSIONS.length];
    const slot = Math.floor(c.hit.bar / 2);
    const chord = TRIPHOP_RHODES_CHORDS[prog[((slot % 4) + 4) % 4]];
    const phrase = (c.hit.bar & 1) * 16 + step;
    if (step === 0 && ((c.hit.bar & 1) === 0 || t >= this.padUntil - c.dur * 2)) {
      // Strings end on the chord change (short tail), so no old chord tone rings into the next chord.
      this.tripHopStrings(c, chord.voice, (32 - phrase) * c.dur, 0.6, false, 0.15);
    }
    if (sec.pad > 0) this.tripHopRhodes(c, chord, slot, phrase);
    const change = phrase === 0 && rowMax(v[0]) > 0;
    if (bassAt(c.arr.bass, step) > 0 || change) {
      // The chord root, folded into one octave above the tonic so the line never leaps a seventh.
      let midi = c.low + chord.root - (chord.root >= 7 ? 12 : 0);
      if (midi < 28) midi += 12;
      const len = Math.min(this.holdSteps(c.arr.bass, step, 8), 32 - phrase) * c.dur;
      this.sub(c, midi, len, 0.55);
      this.sub(c, midi + 12, len, 0.13);
    }
    if (step === 0) this.vinyl(c, 1.2);
  }

  /**
   * Rhodes Break keys: an eight-bar phrase over the four chords of the progression. Bars 1-2 and 5-6 state the
   * chord, 3-4 answer with a short top line, 7-8 turn into the next phrase. Each new phrase picks other figures and
   * swaps to the other voicing, so the part keeps moving. Every note is a tone of the current voicing and stops
   * before the chord changes. `opt` notes only play while the glitch row is busy; intro and breakdown leave space.
   */
  private tripHopRhodes(c: Ctx, chord: TripHopChord, slot: number, phrase: number) {
    const cycle = Math.floor(slot / 4);
    const role = ((slot % 4) + 4) % 4;
    const h = hash32(c.epoch, cycle, 0x7d);
    const sparse = c.sec.name === "intro" || c.sec.name === "breakdown";
    const set = sparse ? TRIPHOP_RHODES_SPACE : role === 1 ? TRIPHOP_RHODES_ANSWERS : role === 3 ? TRIPHOP_RHODES_TURNS : TRIPHOP_RHODES_STATEMENTS;
    const figure = set[(h + (role === 2 ? 1 : 0)) % set.length];
    const busy = rowCount(c.v[3]) > 0;
    const voice = (h >>> 4) % 2 === cycle % 2 ? chord.voice : chord.alt;
    for (const note of figure) {
      if (note.s !== phrase || (note.opt && !busy)) continue;
      const tones = note.p === "C" ? voice : note.p === "U" ? voice.slice(2) : note.p === "L" ? voice.slice(0, 2) : [voice[note.p]];
      const len = Math.min(note.len, 31.6 - phrase) * c.dur;
      const level = (tones.length === 1 ? 1.7 : note.p === "C" ? 1.25 : 1.05) * c.sec.pad;
      for (const [i, semi] of tones.entries()) this.motifNote({ ...c, t: c.t + i * 0.009 }, c.low + 24 + semi, len, level);
    }
  }

  /** Mezzanine / Dummy: a dragged break, midrange bass growl, narrow strings and a lonely sine voice. */
  private tripHopBristol(c: Ctx) {
    const { v, step, t, sec } = c;
    const size = rowCount(v[0]);
    const kickFigure = sec.name === "intro" ? [0] : size <= 2 ? [0, 10] : size <= 4 ? [0, 7, 10] : [0, 3, 10, 14];
    if (size > 0 && kickFigure.includes(step)) {
      this.kick(t, c.vel * Math.max(0.35, sec.kick) * (step === 0 ? 1 : 0.8), { start: 105, end: 41, sweep: 0.065, decay: 0.34, click: 0.12, drive: 2.5, body: 1.2 });
      this.duck(t);
    }
    if (v[1][step] > 0) this.tripHopSnare(c, c.vel * v[1][step], false);
    if (v[2][step] > 0 && (step % 2 === 0 || c.arr.density[2] > 9)) {
      this.hat(t + 0.006, c.vel * v[2][step] * (step % 2 ? 0.12 : 0.28), { hp: 4600 + c.color * 1200, decay: step === 14 ? 0.09 : 0.027, metal: 0.08, pan: c.pan * 0.35 });
    }
    if (v[3][step] > 0) this.tripHopScratch(c, 0.18 * v[3][step]);
    if (bassAt(c.arr.bass, step) > 0) {
      // Pitch comes from a composed four-bar pedal figure; swaps only retrigger/change its length.
      const semi = c.hit.bar % 4 === 3 ? 10 : 0;
      // A note before the pedal moves (into or out of the b7 bar) stops at the bar line.
      const moves = c.hit.bar % 4 === 2 || c.hit.bar % 4 === 3;
      const steps = Math.min(this.holdSteps(c.arr.bass, step, 7), moves ? 16 - step : 7);
      this.tripHopBass(c, c.low + semi, steps * c.dur, true);
    }
    if (step === 0 && (c.hit.bar % 2 === 0 || t >= this.padUntil - c.dur)) {
      this.tripHopStrings(c, [0, 7, 10], 32 * c.dur, 0.8, false);
    }
    const phrase = (c.hit.bar & 1) * 16 + step;
    const figure = TRIPHOP_BRISTOL_CALLS[hash32(c.epoch, 0xb715) % TRIPHOP_BRISTOL_CALLS.length];
    const note = figure.find((x) => x.s === phrase);
    if (note && sec.pad > 0) this.motifNote(c, c.low + 36 + note.semi, note.len * c.dur, 1.15 * (0.45 + 0.55 * sec.lead));
    if (step === 0) this.vinyl(c, 1.45);
  }

  /** DJ Shadow / Bonobo: an open, ghosted break under piano cuts, plucked bass and wide bowed swells. */
  private tripHopCinematic(c: Ctx) {
    const { v, step, t, sec } = c;
    if (v[0][step] > 0) {
      this.kick(t, c.vel * v[0][step] * 0.87, { start: 135, end: 49, sweep: 0.045, decay: 0.27, click: 0.3, clickHp: 1400, drive: 1.25, body: 1.05 });
      this.duck(t);
    }
    if (v[1][step] > 0) this.tripHopSnare(c, c.vel * v[1][step], true);
    if (v[2][step] > 0) {
      this.hat(t, c.vel * v[2][step] * (step % 4 === 2 ? 0.4 : 0.22), { hp: 5800 + c.color * 1800, decay: step % 4 === 2 ? 0.12 : 0.035, metal: 0.45, pan: step % 4 === 2 ? 0.28 : -0.32 });
      if (c.heat > 0.4 && step >= 14) this.hatRoll(c, 6800);
    }
    if (v[3][step] > 0) {
      this.noiseHit(t, c.vel * v[3][step] * 0.13, { type: "bandpass", freq: 850 + 900 * c.color, to: 400, q: 1.6, decay: 0.13, pan: c.pan * 1.5, bus: this.busIn.perc });
    }
    const chord = TRIPHOP_VOICINGS[(Math.floor(c.hit.bar / 2) + hash32(c.epoch, 0xc17) % 2) % 2];
    const phrase = (c.hit.bar & 1) * 16 + step;
    // The bass stops at the chord change instead of ringing into the other root.
    if (bassAt(c.arr.bass, step) > 0) this.tripHopBass(c, c.low + chord.root, Math.min(this.holdSteps(c.arr.bass, step, 4), 32 - phrase) * c.dur, false);
    const hit = TRIPHOP_PIANO_CUTS.find((x) => x.s === phrase);
    if (hit && (hit.core || rowCount(v[3]) > 1) && sec.pad > 0) {
      // Spread, hammer-struck voicings; the shorter optional cut responds to glitch activity.
      for (const [i, semi] of chord.pad.entries()) {
        this.motifNote({ ...c, t: t + i * 0.007 }, c.low + 36 + semi, hit.len * c.dur, (hit.core ? 1.4 : 0.7) * Math.max(0.6, sec.pad));
      }
    }
    if (step === 0 && (c.hit.bar % 2 === 0 || t >= this.padUntil - c.dur)) {
      this.tripHopStrings(c, chord.pad, 32 * c.dur, 1.55, true);
    }
    // A reverse cymbal breath into each four-bar boundary, more open as the market heats.
    if (step === 12 && c.hit.bar % 4 === 3 && sec.hat > 0) {
      this.noiseHit(t, (0.07 + 0.05 * c.heat) * sec.hat, { type: "highpass", freq: 3300, to: 6500, q: 0.6, attack: c.dur * 3.6, decay: c.dur * 0.35, pan: -0.3, bus: this.busIn.fx });
    }
    if (step === 0) this.vinyl(c, 0.55);
  }

  /** Genre-local kit layers: dull dragged room snare vs a brighter, woody sampled-break crack. */
  private tripHopSnare(c: Ctx, level: number, cinematic: boolean) {
    const backbeat = c.step === 4 || c.step === 12;
    const time = c.t + (backbeat ? cinematic ? 0.009 : 0.019 : 0.004);
    const velocity = level * (backbeat ? cinematic ? 0.85 : 0.95 : 0.5);
    this.toneHit(time, 0.44 * velocity, { type: "triangle", freq: cinematic ? 205 : 170, to: cinematic ? 165 : 135, decay: cinematic ? 0.1 : 0.13, pan: 0, bus: this.busIn.snare });
    this.noiseHit(time, 0.7 * velocity, { type: "bandpass", freq: (cinematic ? 2050 : 1150) * (1 + c.press * 0.12), q: 0.65, decay: cinematic ? 0.23 : 0.3, pan: -0.04, bus: this.busIn.snare });
    if (backbeat) this.noiseHit(time + 0.026, (cinematic ? 0.15 : 0.1) * velocity, { type: "bandpass", freq: cinematic ? 3400 : 650, q: 0.8, decay: cinematic ? 0.18 : 0.34, pan: cinematic ? 0.28 : -0.15, bus: this.busIn.snare });
  }

  /** A centred, filtered bass guitar-like sustain, or a short round pluck for the orchestral break. */
  private tripHopBass(c: Ctx, midi: number, length: number, bristol: boolean) {
    const osc = this.ctx.createOscillator();
    osc.type = bristol ? "square" : "triangle";
    osc.frequency.setValueAtTime(midiToFreq(midi), c.t);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = bristol ? 1.3 : 0.65;
    const cutoff = (bristol ? 190 + c.color * 390 : 480 + c.color * 550) * (1 + 0.25 * c.press + 0.35 * c.heat);
    filter.frequency.setValueAtTime(cutoff * (bristol ? 1.5 : 2), c.t);
    filter.frequency.exponentialRampToValueAtTime(cutoff * (bristol ? 0.8 : 0.4), c.t + Math.max(0.06, length * 0.7));
    const drive = this.ctx.createWaveShaper();
    drive.curve = new Float32Array(tanhCurve(bristol ? 2.8 + c.heat : 1.2));
    const amp = this.ctx.createGain();
    const hold = Math.max(0.09, length * 0.88);
    amp.gain.setValueAtTime(0, c.t);
    amp.gain.linearRampToValueAtTime(bristol ? 0.12 : 0.16, c.t + 0.009);
    amp.gain.exponentialRampToValueAtTime(bristol ? 0.088 : 0.04, c.t + hold * 0.65);
    amp.gain.exponentialRampToValueAtTime(0.0001, c.t + hold + 0.08);
    amp.gain.setValueAtTime(0, c.t + hold + 0.08);
    osc.connect(filter);
    filter.connect(drive);
    drive.connect(amp);
    this.busIn.bass.add(amp);
    osc.start(c.t);
    this.end(osc, [filter, drive, amp], c.t + hold + 0.12);
    this.sub(c, midi, length, bristol ? 0.25 : 0.19);
  }

  /** Sustained bowed harmonics, highpassed to leave the break and bass their own space. */
  private tripHopStrings(c: Ctx, chord: readonly number[], length: number, level: number, wide: boolean, tail = 0.7) {
    this.padUntil = c.t + length;
    const end = c.t + length + tail;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = wide ? 280 : 200;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.6;
    const cutoff = (wide ? 1250 + 1600 * c.color : 480 + 600 * c.color) * (1 + c.press * 0.2 + c.heat * 0.6);
    filter.frequency.setValueAtTime(cutoff * 0.45, c.t);
    filter.frequency.linearRampToValueAtTime(cutoff, c.t + length * 0.6);
    filter.frequency.linearRampToValueAtTime(cutoff * 0.65, end);
    const amp = this.ctx.createGain();
    const peak = 0.052 * level * (1 + 0.25 * c.heat);
    amp.gain.setValueAtTime(0, c.t);
    amp.gain.linearRampToValueAtTime(peak * 0.65, c.t + Math.min(0.75, length * 0.2));
    amp.gain.linearRampToValueAtTime(peak, c.t + length * 0.65);
    amp.gain.linearRampToValueAtTime(0, end);
    hp.connect(filter);
    filter.connect(amp);
    this.busIn.harm.add(amp);
    const rest: AudioNode[] = [hp, filter, amp];
    const sources: OscillatorNode[] = [];
    const bow = this.ctx.createOscillator();
    bow.frequency.setValueAtTime(4.7, c.t);
    const depth = this.ctx.createGain();
    depth.gain.value = wide ? 6 : 10;
    bow.connect(depth);
    sources.push(bow);
    rest.push(depth);
    const chordMix = new MixChain(this.ctx, hp, this.live);
    for (const side of [-1, 1]) {
      const pan = this.panNode(wide ? side * 0.62 : 0.08, chordMix);
      rest.push(pan.dest);
      for (const [i, semi] of chord.entries()) {
        const osc = this.ctx.createOscillator();
        osc.type = wide ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(midiToFreq(c.low + (wide ? 36 : 24) + semi), c.t);
        osc.detune.setValueAtTime(side * 7 + i, c.t);
        depth.connect(osc.detune);
        const gain = this.ctx.createGain();
        gain.gain.value = 0.42;
        osc.connect(gain);
        rest.push(gain);
        pan.add(gain);
        sources.push(osc);
      }
    }
    // A quiet opposite-side octave supplies width without a chorus/delay pitch smear.
    if (wide) this.toneHit(c.t, peak * 0.7, { type: "triangle", freq: midiToFreq(c.low + 48 + 7), attack: Math.min(1.2, length * 0.3), decay: length, pan: 0.5, bus: this.busIn.harm });
    for (const source of sources) source.start(c.t);
    sources.forEach((source, i) => this.end(source, i === 0 ? rest : [], end + 0.05));
  }

  /** Two deliberate platter gestures, not a constant noise wash. */
  private tripHopScratch(c: Ctx, level: number) {
    const start = 420 + 500 * c.color;
    this.noiseHit(c.t, level * c.vel, { type: "bandpass", freq: start, to: 2100 + c.heat * 1100, q: 3.6, attack: 0.008, decay: c.dur * 0.35, pan: -0.2, bus: this.busIn.fx });
    this.noiseHit(c.t + c.dur * 0.5, level * c.vel * 0.7, { type: "bandpass", freq: 2300, to: start, q: 4, attack: 0.005, decay: c.dur * 0.3, pan: 0.2, bus: this.busIn.fx });
  }

  /** DJ Boring / Ross from Friends: dusty 4/4, warm chord stabs on a two-chord vamp, a round bass, tape hiss. */
  private lofiHouse(c: Ctx) {
    if (c.style.id === "chop") return this.lofiChop(c);
    if (c.style.id === "rave") return this.lofiRave(c);
    const { v, step, t, sec } = c;
    if (this.fourFloor(c)) {
      this.kick(t, c.vel * (step === 0 ? 0.95 : 0.85), { start: 110, end: 50, sweep: 0.06, decay: 0.3, click: 0.05, body: 0.95 });
      this.duck(t);
    }
    if (v[1][step] >= 0.9 && (step === 4 || step === 12)) this.clap(t, c.vel * 0.5, -c.pan * 0.3);
    if (v[2][step] > 0) {
      if (step % 4 === 2) this.hat(t, c.vel * v[2][step] * 0.32, { hp: 6800, decay: 0.14, metal: 0.4, pan: c.pan * 0.4 });
      else this.hat(t, c.vel * v[2][step] * 0.18, { hp: 8000, decay: 0.02, metal: 0.1, pan: -c.pan * 0.5 });
    }
    const vamp = LIQUID_VAMPS[hash32(c.epoch, 0x10f) % LIQUID_VAMPS.length];
    const chord = Math.floor(c.hit.bar / 2) % 2 === 1 ? vamp.b : vamp.a;
    const padRoot = 52 + ((c.tonic - 4 + 12) % 12);
    if (sec.lead > 0 || sec.pad > 0) {
      const fig = HOUSE_STABS[hash32(c.epoch, 0x110) % HOUSE_STABS.length];
      const hit = fig.find((x) => x.s === (c.hit.bar & 1) * 16 + step);
      if (hit && (hit.core || rowCount(v[3]) > 0)) {
        const tones = chord.pad.filter((x) => x >= 0).sort((a, b) => a - b).slice(-4);
        const lvl = Math.max(sec.lead, sec.pad * 0.7) * (hit.core ? 0.5 : 0.4);
        for (const semi of tones) this.motifNote(c, padRoot + semi, hit.len * c.dur, lvl);
      }
    }
    if (bassAt(c.arr.bass, step) > 0) {
      let midi = c.low + chord.root;
      if (midi < 28) midi += 12;
      const len = this.holdSteps(c.arr.bass, step, 3) * c.dur;
      this.sub(c, midi, len, 0.95);
      this.sub(c, midi + 12, len, 0.3);
    }
    if (step === 0) this.vinyl(c, 0.7);
  }

  /**
   * Lofi House "Sample Chop" (DJ Seinfeld / Ross From Friends): one chord sample, filtered thin and chopped into a
   * two-bar loop of hard-gated slices, pumping under a boomy kick; 16th shakers, a long deep sub, heavy crackle.
   */
  private lofiChop(c: Ctx) {
    const { v, step, t, sec } = c;
    if (this.fourFloor(c)) {
      this.kick(t, c.vel * (step === 0 ? 1 : 0.9), { start: 96, end: 45, sweep: 0.075, decay: 0.42, click: 0.03, drive: 1.6, body: 1.05 });
      // The pump: the whole sample breathes with the kick; heat digs it deeper.
      this.lofiPump(t, 0.35, 0.22 - 0.1 * c.heat, c.dur * 3.4);
    }
    if (rowMax(v[1]) > 0) {
      if (v[1][step] >= 0.9 && (step === 4 || step === 12)) {
        this.clap(t, c.vel * 0.42, -c.pan * 0.3);
        this.rim(t, c.vel * 0.25, c.pan * 0.4, 1.1);
      } else if (v[1][step] > 0 && v[1][step] < 0.9 && step % 4 !== 0) this.rim(t, c.vel * 0.18, c.pan, 1.35);
    }
    // Shakers on the chain's hat row, soft-attack and swung; the open hat only on the "and" of 2 and 4 when busy.
    if (v[2][step] > 0) {
      const off = step % 2 === 1;
      this.noiseHit(t, c.vel * v[2][step] * (off ? 0.2 : 0.13), { type: "bandpass", freq: 6200 + 1400 * c.color, q: 0.9, decay: off ? 0.05 : 0.035, attack: 0.007, pan: c.pan * 0.8, bus: this.busIn.hat });
      if ((step === 6 || step === 14) && rowCount(v[2]) >= 6) this.hat(t, c.vel * 0.22, { hp: 5600, decay: 0.16, metal: 0.25, pan: -c.pan * 0.4 });
      if (c.heat > 0) this.hatRoll(c, 7600);
    }
    const vamp = LIQUID_VAMPS[hash32(c.epoch, 0x10f) % LIQUID_VAMPS.length];
    const chord = Math.floor(c.hit.bar / 2) % 2 === 1 ? vamp.b : vamp.a;
    const padRoot = 52 + ((c.tonic - 4 + 12) % 12);
    const tones = chord.pad.filter((x) => x >= 0).sort((a, b) => a - b);
    // The loop: a two-bar chop figure per epoch. Quiet market = the core slices; glitch hits fill the rest in and a
    // busy glitch row stutters the core ones (a 32nd retrigger).
    const amount = Math.max(sec.lead, sec.pad * 0.8);
    if (amount > 0) {
      const fig = LOFIHOUSE_CHOPS[hash32(c.epoch, 0x1c0) % LOFIHOUSE_CHOPS.length];
      const hit = fig.find((x) => x.s === (c.hit.bar & 1) * 16 + step);
      const busy = rowCount(v[3]);
      if (hit && (hit.core || busy > 0)) {
        // Slices of the same sample: the full chord, its top, the top an octave up, the low root and fifth.
        const slices = [chord.pad, tones.slice(-3), tones.slice(-2).map((x) => x + 12), [chord.root < 0 ? chord.root + 12 : chord.root, chord.root + 7 < 0 ? chord.root + 19 : chord.root + 7].map((x) => x - 12)];
        const notes = slices[hit.slice];
        const len = hit.len * c.dur;
        const lvl = amount * (hit.core ? 1 : 0.8);
        if (busy >= 3 && hit.core && hit.len >= 2) {
          this.lofiChopVoice(c, padRoot, notes, c.dur * 0.5, lvl, hit.slice, false);
          this.lofiChopVoice({ ...c, t: t + c.dur }, padRoot, notes, len - c.dur, lvl * 0.9, hit.slice, false);
        } else this.lofiChopVoice(c, padRoot, notes, len, lvl, hit.slice, false);
      }
      // Glitch tier: the sample played backwards into the next beat.
      if (v[3][step] > 0 && step % 8 === 5 && !hit) this.lofiChopVoice(c, padRoot, chord.pad, c.dur * 3, amount * 0.75, 1, true);
    }
    // A long deep sub on the chord root, no octave: the pump carves room for the kick.
    const onset = bassAt(c.arr.bass, step) > 0 || (step === 0 && c.hit.bar % 2 === 0 && rowMax(v[0]) > 0);
    if (onset) {
      let midi = c.low + chord.root;
      if (midi < 28) midi += 12;
      const len = this.holdSteps(c.arr.bass, step, 8) * c.dur;
      this.sub(c, midi, len, 0.8);
      this.sub(c, midi + 12, len, 0.15);
    }
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.rim(time, vel * 0.8, 0, 1.2));
    if (step === 0) this.vinyl(c, 1.25);
  }

  /** Sidechain pump with its own depth and release (the shared duck is the genre's gentle one). */
  private lofiPump(time: number, bass: number, harm: number, release: number) {
    const pairs: [AudioParam, number][] = [[this.bassDuck.gain, bass], [this.harmDuck.gain, Math.max(0.08, harm)]];
    for (const [g, depth] of pairs) {
      g.cancelScheduledValues(time);
      g.setValueAtTime(depth, time);
      g.linearRampToValueAtTime(depth + (1 - depth) * 0.6, time + release * 0.45);
      g.linearRampToValueAtTime(1, time + release);
    }
  }

  /**
   * One slice of the chord "sample": warm detuned keys+strings with sample hiss, saturated, band-limited like a
   * filtered loop, hard-gated at both ends. Reverse: the slice swells in and cuts on the beat.
   */
  private lofiChopVoice(c: Ctx, root: number, semis: number[], length: number, level: number, slice: number, reverse: boolean) {
    const t = c.t;
    const gate = Math.max(0.04, length * 0.92);
    const attack = reverse ? gate * 0.95 : 0.003;
    const end = t + gate + 0.024;
    const bright = [1, 0.85, 1.25, 0.6][slice] ?? 1;
    const cutoff = clamp((560 + 2100 * c.color + 2600 * c.heat) * bright * (c.press < 0 ? 1 + 0.4 * c.press : 1 + 0.25 * c.press), 280, 9000);
    const pre = this.ctx.createGain();
    pre.gain.value = 0.2;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.8));
    shaper.oversample = "none";
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.1;
    lp.frequency.setValueAtTime(cutoff * 1.3, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.08);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = slice === 3 ? 90 : 230;
    hp.Q.value = 0.7;
    const amp = this.ctx.createGain();
    const peak = 0.65 * level;
    amp.gain.setValueAtTime(0.0001, t);
    if (reverse) amp.gain.exponentialRampToValueAtTime(peak, t + attack);
    else {
      amp.gain.linearRampToValueAtTime(peak, t + attack);
      amp.gain.exponentialRampToValueAtTime(peak * 0.72, t + gate);
    }
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    pre.connect(shaper);
    shaper.connect(lp);
    lp.connect(hp);
    hp.connect(amp);
    const pan = this.panNode(slice === 2 ? -c.pan * 0.6 : 0.08, this.busIn.harm);
    pan.add(amp);
    // The sample sits a little off concert pitch (per epoch) and wobbles like the tape it came from.
    const wow = this.ctx.createOscillator();
    wow.frequency.setValueAtTime(0.55 + (hash32(c.epoch, 0x1c1) % 30) / 100, t);
    const wowG = this.ctx.createGain();
    wowG.gain.value = 7;
    wow.connect(wowG);
    const off = (hash32(c.epoch, 0x1c2) % 25) - 12;
    const rest: AudioNode[] = [wowG, pre, shaper, lp, hp, amp, pan.dest];
    const srcs: (OscillatorNode | AudioBufferSourceNode)[] = [wow];
    let chain: AudioNode | null = null;
    semis.forEach((semi, i) => {
      for (const [type, cents, lvl] of [["triangle", -4, 0.6], ["sawtooth", 9, 0.24]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(off + cents + (i % 2 ? 3 : -3), t);
        wowG.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = lvl * (semi < 0 ? 0.6 : 1);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        srcs.push(osc);
      }
    });
    // Hiss baked into the sample: it pumps and chops with the chord.
    const hiss = this.ctx.createBufferSource();
    hiss.buffer = this.noise();
    hiss.loop = true;
    const hissF = this.ctx.createBiquadFilter();
    hissF.type = "bandpass";
    hissF.frequency.value = 3000;
    hissF.Q.value = 0.5;
    const hissG = this.ctx.createGain();
    hissG.gain.value = 0.35;
    hiss.connect(hissF);
    hissF.connect(hissG);
    rest.push(hissF, hissG);
    chain = this.pairSum(chain, hissG, rest);
    srcs.push(hiss);
    (chain as AudioNode | null)?.connect(pre);
    for (const s of srcs) s.start(t);
    srcs.forEach((s, i) => this.end(s, i === 0 ? rest : [], end + 0.03));
  }

  /**
   * Lofi House "Raw Rave" (Mall Grab / Baltra): a crunchy driven kick over a chopped-break snare and crushed hats,
   * M1 piano stabs, a bouncing organ bass and a hoover-ish rave pad that blooms in the breakdown.
   */
  private lofiRave(c: Ctx) {
    const { v, step, t, sec } = c;
    if (this.fourFloor(c)) {
      this.kick(t, c.vel * (step === 0 ? 1 : 0.92), {
        start: 135, end: 48, sweep: 0.05, decay: 0.34, click: 0.5, clickHp: 2200, drive: 2.6 + 1.6 * Math.max(0, c.press) + 1.5 * c.heat, body: 1,
      });
      this.duck(t);
    }
    if (rowMax(v[1]) > 0) {
      if (step === 4 || step === 12) {
        this.lofiCrunchSnare(t, c.vel * Math.max(0.55, sec.snare) * 0.9, -c.pan * 0.2, 1);
        this.clap(t, c.vel * 0.28, c.pan * 0.3);
      } else if (v[1][step] > 0 && v[1][step] < 0.9 && step % 4 !== 0) this.lofiCrunchSnare(t, c.vel * 0.3, c.pan * 0.5, 0.45);
    }
    if (v[2][step] > 0) {
      const open = step % 4 === 2;
      this.lofiCrunchHat(t, c.vel * v[2][step] * (open ? 0.5 : 0.3), open ? 0.075 : 0.018, c.pan * (open ? 0.3 : 0.7), open ? 5600 : 7200);
      if (c.heat > 0) this.hatRoll(c, 7800);
    }
    const vamp = LIQUID_VAMPS[hash32(c.epoch, 0x10f) % LIQUID_VAMPS.length];
    const chord = Math.floor(c.hit.bar / 2) % 2 === 1 ? vamp.b : vamp.a;
    const padRoot = 52 + ((c.tonic - 4 + 12) % 12);
    // Rave pad: the chord, two bars at a time, voices overlapping into the next.
    if (step === 0 && (c.hit.bar % 2 === 0 || t >= this.padUntil - c.dur * 2)) {
      const bars = 2 - (((c.hit.bar % 2) + 2) % 2);
      this.lofiRavePad(c, padRoot, chord.pad, bars * 16 * c.dur);
    }
    // M1 piano: a two-bar stab figure per epoch, the top of the chord with the upper tones an octave up.
    if (sec.lead > 0 || sec.pad > 0) {
      const fig = LOFIHOUSE_RAVE_STABS[hash32(c.epoch, 0x1d0) % LOFIHOUSE_RAVE_STABS.length];
      const hit = fig.find((x) => x.s === (c.hit.bar & 1) * 16 + step);
      if (hit && (hit.core || rowCount(v[3]) > 0)) {
        const tones = chord.pad.filter((x) => x >= 0).sort((a, b) => a - b).slice(-4);
        const lvl = Math.max(sec.lead, sec.pad * 0.6) * (hit.core ? 0.65 : 0.5);
        tones.forEach((semi, i) => this.motifNote(c, padRoot + semi + (i > 0 ? 12 : 0), hit.len * c.dur, lvl));
      }
    }
    // Glitch tier: a crushed rave power-chord hit on the offbeats.
    if (v[3][step] > 0 && step % 2 === 1 && hash32(c.epoch, c.n, 0x1d1) % 3 === 0) this.lofiRaveHit(c, padRoot + chord.root, sec.glitch);
    // Organ bass: the chain's onsets bounce between root, octave and fifth of the chord.
    const nib = bassAt(c.arr.bass, step);
    if (nib > 0) {
      let base = c.low + 12 + chord.root;
      if (base > c.low + 17) base -= 12;
      if (base < 36) base += 12;
      const set = [0, 12, 0, 7, 12, 0, 12, 7];
      this.lofiOrgan(c, base + set[nib % set.length], this.holdSteps(c.arr.bass, step, 2) * c.dur, 1);
    }
    if (c.heat >= 0.5 && v[1][step] === 0) this.rollUp(c, (time, vel) => this.lofiCrunchSnare(time, vel * 0.8, 0, 0.5));
    if (step === 0) this.vinyl(c, 0.55);
  }

  /** Crushed hat: highpassed noise through a 5-bit stair, like a hat off an old sampler. */
  private lofiCrunchHat(time: number, velocity: number, decay: number, panAmount: number, hpHz: number) {
    const tail = decay * 3;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = hpHz;
    hp.Q.value = 0.9;
    const env = this.ctx.createGain();
    pulse(env.gain, time, 0.001, 0.85, tail);
    const crush = this.ctx.createWaveShaper();
    crush.curve = new Float32Array(bitCurve(5));
    crush.oversample = "none";
    const out = this.ctx.createGain();
    out.gain.value = 0.5 * velocity;
    src.connect(hp);
    hp.connect(env);
    env.connect(crush);
    crush.connect(out);
    const pan = this.panNode(panAmount, this.busIn.hat);
    pan.add(out);
    src.start(time);
    this.end(src, [hp, env, crush, out, pan.dest], time + tail + 0.06);
  }

  /** Chopped-break snare: a short tuned body and a 4-bit crushed noise crack. */
  private lofiCrunchSnare(time: number, velocity: number, panAmount: number, tail: number) {
    this.toneHit(time, 0.38 * velocity, { type: "triangle", freq: 215, to: 172, sweep: 0.04, decay: 0.07, pan: panAmount, bus: this.busIn.snare });
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.6;
    const env = this.ctx.createGain();
    pulse(env.gain, time, 0.001, 0.9, 0.17 * tail);
    const crush = this.ctx.createWaveShaper();
    crush.curve = new Float32Array(bitCurve(4));
    crush.oversample = "none";
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 7500;
    const out = this.ctx.createGain();
    out.gain.value = 0.5 * velocity;
    src.connect(bp);
    bp.connect(env);
    env.connect(crush);
    crush.connect(lp);
    lp.connect(out);
    const pan = this.panNode(panAmount, this.busIn.snare);
    pan.add(out);
    src.start(time);
    this.end(src, [bp, env, crush, lp, out, pan.dest], time + 0.17 * tail + 0.08);
  }

  /** Rave pad: three detuned saws a note, bending up into pitch like a hoover, a resonant filter swelling over the chord. */
  private lofiRavePad(c: Ctx, root: number, chord: number[], length: number) {
    const t = c.t;
    const attack = Math.min(0.5, length * 0.12);
    const release = 1.4;
    const end = t + length + release;
    this.padUntil = t + length;
    const lo = (520 + 900 * c.color) * (c.press < 0 ? 1 + 0.35 * c.press : 1 + 0.15 * c.press);
    const hi = lo * (2.1 + 1.6 * c.heat);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2.4;
    lp.frequency.setValueAtTime(lo, t);
    lp.frequency.linearRampToValueAtTime(hi, t + length * 0.55);
    lp.frequency.linearRampToValueAtTime(lo * 1.2, t + length + release);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 240;
    hp.Q.value = 0.7;
    const amp = this.ctx.createGain();
    const level = 0.065 * (1 + 0.4 * c.heat);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setValueAtTime(level, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    lp.connect(hp);
    hp.connect(amp);
    const pan = this.panNode(-0.05, this.busIn.harm);
    pan.add(amp);
    const wow = this.ctx.createOscillator();
    wow.frequency.setValueAtTime(0.42, t);
    const wowG = this.ctx.createGain();
    wowG.gain.value = 6;
    wow.connect(wowG);
    const rest: AudioNode[] = [wowG, lp, hp, amp, pan.dest];
    const oscs: OscillatorNode[] = [wow];
    let chain: AudioNode | null = null;
    chord.forEach((semi, i) => {
      for (const cents of [-15, 1, 14]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        const f = midiToFreq(root + semi);
        osc.frequency.setValueAtTime(f * Math.pow(2, -1.5 / 12), t);
        osc.frequency.exponentialRampToValueAtTime(f, t + 0.22);
        osc.detune.setValueAtTime(cents + (i % 2 ? 2 : -2), t);
        wowG.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = 0.3 * (semi < 0 ? 0.5 : 1);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    (chain as AudioNode | null)?.connect(lp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /** M1-style organ bass: four sine drawbars, a percussive drop to sustain, a key click; a sine sub underneath. */
  private lofiOrgan(c: Ctx, midi: number, length: number, level: number) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const hold = Math.max(0.06, length * 0.8);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.8;
    lp.frequency.value = clamp(1300 + 2000 * c.color + 1400 * Math.max(0, c.press) + 1500 * c.heat, 600, 7000) * (c.press < 0 ? 1 + 0.4 * c.press : 1);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.4));
    shaper.oversample = "none";
    const pre = this.ctx.createGain();
    pre.gain.value = 0.45;
    const amp = this.ctx.createGain();
    const peak = 0.17 * level;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.exponentialRampToValueAtTime(peak * 0.55, t + Math.min(hold, 0.12));
    amp.gain.setValueAtTime(peak * 0.55, t + hold);
    amp.gain.linearRampToValueAtTime(0.0001, t + hold + 0.04);
    amp.gain.setValueAtTime(0, t + hold + 0.04);
    pre.connect(shaper);
    shaper.connect(lp);
    lp.connect(amp);
    this.busIn.bass.add(amp);
    const rest: AudioNode[] = [pre, shaper, lp, amp];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    for (const [mult, lvl] of [[1, 1], [2, 0.6], [3, 0.32], [4, 0.24]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * mult, t);
      const g = this.ctx.createGain();
      g.gain.value = lvl;
      osc.connect(g);
      rest.push(g);
      chain = this.pairSum(chain, g, rest);
      oscs.push(osc);
    }
    (chain as AudioNode | null)?.connect(pre);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + hold + 0.08));
    this.toneHit(t, 0.03 * level, { type: "sine", freq: freq * 8, decay: 0.012, pan: 0, bus: this.busIn.bass });
    this.sub(c, midi - 12, length * 0.85, 0.35 * level);
  }

  /** Rave hit: a crushed saw power chord (root, fifth, octave) with a snapping filter. */
  private lofiRaveHit(c: Ctx, midi: number, level: number) {
    const t = c.t;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(2600 + 3000 * c.color + 2000 * c.heat, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.15);
    const env = this.ctx.createGain();
    pulse(env.gain, t, 0.002, 0.8, 0.16);
    const crush = this.ctx.createWaveShaper();
    crush.curve = new Float32Array(bitCurve(6));
    crush.oversample = "none";
    const out = this.ctx.createGain();
    out.gain.value = 0.09 * level;
    lp.connect(env);
    env.connect(crush);
    crush.connect(out);
    const pan = this.panNode(c.pan * 1.4, this.busIn.perc);
    pan.add(out);
    const rest: AudioNode[] = [lp, env, crush, out, pan.dest];
    const oscs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    for (const semi of [0, 7, 12]) {
      for (const cents of [-10, 10]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(midiToFreq(midi + semi), t);
        osc.detune.setValueAtTime(cents, t);
        const g = this.ctx.createGain();
        g.gain.value = 0.16;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    }
    (chain as AudioNode | null)?.connect(lp);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], t + 0.24));
  }

  // ------------------------------------------------------------------ shared rhythm helpers

  /** Four on the floor while the kick tier is present; the intro and early rebuild keep the half-time pulse. */
  // ------------------------------------------------------------------ wonky

  /** The beat scene: three styles, each with its own kit, feel and harmony voice. Drums lead in all three. */
  private wonky(c: Ctx) {
    if (c.style.id === "brainfeeder") return this.wonkyFeeder(c);
    if (c.style.id === "glitch") return this.wonkyGlitch(c);
    return this.wonkyDilla(c);
  }

  /** The chord in force: a per-epoch four-chord progression, `bars` bars per chord. */
  private wonkyChord(c: Ctx, progs: readonly (readonly WonkyChordId[])[], salt: number, bars: number): WonkyChord {
    const prog = progs[hash32(c.epoch, salt) % progs.length];
    const slot = Math.floor(c.hit.bar / bars);
    return WONKY_CHORDS[prog[((slot % prog.length) + prog.length) % prog.length]];
  }

  /** Which of the chord's two voicings plays: it swaps every four chords, per epoch. */
  private wonkyVoice(c: Ctx, chord: WonkyChord, bars: number, salt: number): readonly number[] {
    const cycle = Math.floor(c.hit.bar / (bars * 4));
    return (hash32(c.epoch, cycle, salt) & 1) === 0 ? chord.voice : chord.alt;
  }

  /** Bass MIDI of the chord root, folded into the octave above the genre's low tonic, so the line never leaps. */
  private wonkyRoot(c: Ctx, chord: WonkyChord): number {
    let midi = c.low + chord.root - (chord.root >= 7 ? 12 : 0);
    if (midi < 28) midi += 12;
    return midi;
  }

  /**
   * Kick figure of this bar: the chain's kick count picks how busy, the epoch picks which figure. The count is the
   * chain's own (arr.density), not the arranged row: the arranged row gains a pickup on every fill bar and would
   * switch the figure every fourth bar.
   */
  private wonkyKicks(c: Ctx, sets: readonly (readonly WonkyKicks[])[], salt: number): readonly number[] {
    const k = c.arr.density[0];
    if (k === 0 || rowMax(c.v[0]) <= 0) return [];
    // Intro and the first half of the rebuild: the half-time pulse.
    if (c.sec.name === "intro" || (c.sec.name === "rebuild" && c.sec.bar < 30)) return [0, 10];
    const tier = k <= 2 ? 0 : k <= 12 ? 1 : 2;
    const set = sets[tier];
    const fig = set[hash32(c.epoch, tier, salt) % set.length];
    return (c.hit.bar & 1) === 1 ? fig.b : fig.a;
  }

  /** Hat density from the chain's hat count (as arrange spreads it), steady across the phrase's hat breaks. */
  private wonkyHatCount(c: Ctx): number {
    const d = c.arr.density[2];
    if (d === 0 || rowMax(c.v[2]) <= 0) return 0;
    return Math.min(12, Math.max(4, Math.round(4 + d * 0.55)));
  }

  /** Backbeat velocity: confident and even; the step's humanised velocity only shades it. */
  private wonkyBackbeat(c: Ctx): number {
    return (0.92 + 0.3 * (c.vel - 0.91)) * Math.max(0.6, c.sec.snare);
  }

  /**
   * Dilla Swing (Donuts / Slum Village): the kick is straight, the snare sits a fixed few ms behind it every bar, the
   * eighth hats are on the grid and the sixteenths between them all fall equally late (the epoch picks the feel).
   * Dusty soul chords chopped on the chord, a round 808 on the chord root, vinyl.
   */
  private wonkyDilla(c: Ctx) {
    const { v, step, sec } = c;
    const feel = WONKY_DILLA_FEELS[hash32(c.epoch, 0xd111) % WONKY_DILLA_FEELS.length];
    // One drag per voice, the same in every bar and at every heat: the backbeat is lazy, never wandering.
    const lateHat = step % 2 === 1 ? c.t + feel.swing * c.dur : c.t;
    const bar2 = (c.hit.bar & 1) === 1;
    const kicks = this.wonkyKicks(c, WONKY_DILLA_KICKS, 0xd112);
    if (kicks.includes(step)) {
      this.kick(c.t, c.vel * (step === 0 ? 1 : 0.84) * Math.max(0.6, sec.kick), { start: 112, end: 47, sweep: 0.055, decay: 0.36, click: 0.22, clickHp: 1600, drive: 1.7, body: 1.15 });
      this.duck(c.t);
    }
    if (rowMax(v[1]) > 0) {
      if (step === 4 || step === 12) this.wonkySnare(c.t + feel.snare, this.wonkyBackbeat(c), -0.06, WONKY_SNARES.dilla);
      else if (c.arr.density[1] >= 4 && feel.ghosts.includes(step) && !kicks.includes(step) && (sec.name === "full" || step === feel.ghosts[0])) {
        // A ghost: the snare body brushed, no clap, well under the backbeat; one in the build, two in the full part.
        this.wonkySnare(c.t + feel.snare, c.vel * 0.12, 0.22, WONKY_SNARES.dillaGhost);
      }
    }
    // Hats: eighths, the in-between sixteenths only when the chain's hat row is busy.
    const hd = this.wonkyHatCount(c);
    if (hd > 0 && (step % 2 === 0 || hd >= 9 || (hd >= 5 && (step === 7 || step === 15)))) {
      const open = bar2 && step === feel.open && hd >= 6;
      const accent = step % 4 === 0 ? 0.84 : step % 2 === 0 ? 0.62 : 0.42;
      this.hat(lateHat, c.vel * accent * (open ? 0.75 : 1), {
        hp: open ? 5200 : 6600 + c.color * 1000, decay: open ? 0.11 : 0.026, metal: 0.22, pan: step % 2 === 1 ? 0.24 : -0.12,
      });
    }
    // Glitch tier: a dusty shaker tick in the hat feel (a knock on the snare bus read as a stray snare).
    if (v[3][step] > 0) this.wonkyCrushHat(lateHat, c.vel * 0.34 * v[3][step], 0.03, c.pan * 1.2, 4200, 5, this.busIn.perc);
    const chord = this.wonkyChord(c, WONKY_DILLA_PROGS, 0xd113, 1);
    const voice = this.wonkyVoice(c, chord, 1, 0xd114);
    if (sec.pad > 0) {
      // The sample is chopped on the chord: a one-bar chop figure per epoch, quiet markets keep the core chops.
      const fig = WONKY_DILLA_CHOPS[hash32(c.epoch, 0xd115) % WONKY_DILLA_CHOPS.length];
      const busy = rowCount(v[3]) > 0 || c.arr.energy > 0.55;
      const hit = fig.find((x) => x.s === step);
      if (hit && (hit.core || busy)) {
        const tones = hit.p === "C" ? voice : hit.p === "U" ? voice.slice(2) : voice.slice(0, 2);
        this.wonkySoul(c, c.t + feel.chop, tones, Math.min(hit.len, 15.6 - step) * c.dur, sec.pad * (hit.core ? 1 : 0.75));
      }
    }
    if (bassAt(c.arr.bass, step) > 0 || (step === 0 && rowMax(v[0]) > 0)) {
      const len = Math.min(this.holdSteps(c.arr.bass, step, 8), 16 - step) * c.dur;
      this.wonky808(c, c.t, this.wonkyRoot(c, chord), len, 0.17, step === 0, 1.7);
    }
    if (step === 0) this.vinyl(c, 1.3);
  }

  /**
   * Brainfeeder (Cosmogramma / Los Angeles): a swung, off-grid crunchy beat, woozy analog chords that wobble together
   * (in tune on average), a deep sub, a dotted arp into the echo and harp/glass glints on the chord.
   */
  private wonkyFeeder(c: Ctx) {
    const { v, step, sec } = c;
    const feel = WONKY_FEEDER_FEELS[hash32(c.epoch, 0xbf01) % WONKY_FEEDER_FEELS.length];
    // The limp is the style swing (on c.t) plus one fixed lean per voice, the same in every bar and at every heat:
    // the downbeat kick is on the grid, the other kicks sit a little behind, the snare a little more.
    const odd = step % 2 === 1;
    const bar2 = (c.hit.bar & 1) === 1;
    const phrase = (c.hit.bar & 1) * 16 + step;
    const kicks = this.wonkyKicks(c, WONKY_FEEDER_KICKS, 0xbf04);
    if (kicks.includes(step)) {
      const at = step === 0 ? c.t : c.t + feel.kick;
      this.kick(at, c.vel * (step === 0 ? 1 : 0.82) * Math.max(0.6, sec.kick), { start: 150, end: 45, sweep: 0.045, decay: 0.3, click: 0.35, clickHp: 2400, drive: 2.8 + c.heat, body: 1.1 });
      this.duck(at);
    }
    if (rowMax(v[1]) > 0) {
      if (step === 4 || step === 12) this.wonkySnare(c.t + feel.snare, this.wonkyBackbeat(c), 0.05, WONKY_SNARES.feeder);
      else if (bar2 && step === 15 && sec.name === "full" && c.arr.density[1] >= 4 && !kicks.includes(step)) {
        // One crunchy ghost into the next pair's downbeat, well under the backbeat.
        this.wonkySnare(c.t + feel.snare, c.vel * 0.13, 0.3, WONKY_SNARES.feeder);
      }
    }
    const hd = this.wonkyHatCount(c);
    if (hd > 0 && (step % 2 === 0 || hd >= 6)) {
      const at = odd ? c.t + feel.hat * c.dur : c.t;
      const accent = WONKY_FEEDER_HATS[step];
      const hat = { hp: 6400 + c.color * 1600, decay: step === 10 ? 0.07 : 0.022, metal: 0.5, pan: ((step % 3) - 1) * 0.3 };
      this.hat(at, c.vel * accent * 0.87, hat);
      // Heat: a 32nd flam on the last sixteenth of each half bar.
      if (c.heat > 0.35 && (step === 7 || step === 15)) this.hat(at + c.dur * 0.5, c.vel * accent * 0.56, hat);
    }
    // Glitch tier: a crushed tick, in the hat lean.
    if (v[3][step] > 0) this.wonkyCrushHat(c.t + feel.hat * c.dur, c.vel * 0.5 * v[3][step], 0.035, c.pan * 1.4, 2600, 3, this.busIn.perc);
    const chord = this.wonkyChord(c, WONKY_FEEDER_PROGS, 0xbf02, 2);
    const voice = this.wonkyVoice(c, chord, 2, 0xbf03);
    if (step === 0 && (phrase === 0 || c.t >= this.padUntil - c.dur * 2)) {
      this.wonkyWoozy(c, voice, (32 - phrase) * c.dur, 1);
    }
    if (bassAt(c.arr.bass, step) > 0 || phrase === 0) {
      const len = Math.min(this.holdSteps(c.arr.bass, step, 12), 32 - phrase) * c.dur;
      this.wonky808(c, c.t, this.wonkyRoot(c, chord), len, 0.32, false, 1.2);
    }
    const slot = Math.floor(c.hit.bar / 2);
    if (sec.lead > 0) {
      // Ear candy, all on the chord: the arp into the echo, a harp run opening every other chord, glass on glitches.
      const tones = [...voice, ...voice.slice(1).map((x) => x + 12)];
      if (c.arr.energy > 0.3 || sec.name === "full") {
        const arp = WONKY_FEEDER_ARPS[hash32(c.epoch, 0xbf05) % WONKY_FEEDER_ARPS.length];
        const a = arp.find((x) => x[0] === phrase);
        if (a) this.wonkyGlint(c.t, c.low + 36 + tones[a[1] % tones.length], 0.55 * sec.lead, 0.22, a[1] % 2 === 0 ? -0.35 : 0.35, true);
      }
      if (phrase === 0 && slot % 2 === 1) {
        voice.forEach((semi, i) => this.wonkyGlint(c.t + i * c.dur * 0.5, c.low + 48 + semi, 0.7 * sec.lead, 0.9, -0.4 + i * 0.25, false));
      }
      if (v[3][step] > 0 && step % 4 === 2) {
        const semi = voice[hash32(c.epoch, c.n, 0xbf06) % voice.length];
        this.wonkyGlint(c.t + 0.1 * c.dur, c.low + 48 + semi, 0.45 * sec.lead, 1.1, c.pan * 1.6, true);
      }
    }
    // Space: a reversed breath into every other chord change.
    if (phrase === 26 && slot % 2 === 1 && sec.pad > 0) {
      this.noiseHit(c.t, 0.06 + 0.04 * c.heat, { type: "bandpass", freq: 900 + 1200 * c.color, to: 4200, q: 0.9, attack: c.dur * 5.8, decay: c.dur * 0.2, pan: 0.2, bus: this.busIn.fx });
    }
    if (step === 0) this.vinyl(c, 0.6);
  }

  /**
   * Glitch-hop (Prefuse 73 / Machinedrum): a tight beat that is edited, not played: 32nd kick retriggers, reversed
   * snares into the backbeat, snare stutters, crushed hats; chord stabs that stutter, a rubbery bass on the chord and
   * pitched vocal chops on the chord's top tones.
   */
  private wonkyGlitch(c: Ctx) {
    const { v, step, sec } = c;
    const phrase = (c.hit.bar & 1) * 16 + step;
    const hot = rowCount(v[3]) > 0 || c.heat > 0.3 || c.arr.energy > 0.6;
    const kit: KickSpec = { start: 165, end: 52, sweep: 0.035, decay: 0.24, click: 0.55, clickHp: 2600, drive: 1.5, body: 1.05 };
    const kicks = this.wonkyKicks(c, WONKY_GLITCH_KICKS, 0x91c1);
    if (kicks.includes(step)) {
      this.kick(c.t, c.vel * (step === 0 ? 1 : 0.86) * Math.max(0.6, sec.kick), kit);
      this.duck(c.t);
    }
    const edits = WONKY_GLITCH_EDITS[hash32(c.epoch, 0x91c3) % WONKY_GLITCH_EDITS.length];
    const edit = edits.find((e) => e.s === phrase && (e.core || hot));
    // A 32nd retrigger of a kick that is there and has room after it (never a kick of its own, never a burst into
    // the backbeat: see the edit table).
    if (edit?.k === "k32" && kicks.includes(step) && !kicks.includes(step + 1)) this.kick(c.t + c.dur * 0.5, c.vel * 0.62, kit);
    const snares = rowMax(v[1]) > 0;
    const snareAt = c.t + 0.003;
    if (snares && (step === 4 || step === 12)) this.wonkySnare(snareAt, this.wonkyBackbeat(c), 0.03, WONKY_SNARES.glitch);
    // The snare edits all sit two sixteenths before a backbeat (or the phrase's last downbeat) and resolve onto it.
    if (snares && edit?.k === "rev") {
      // A reversed snare that swells for two sixteenths and cuts just before the backbeat lands.
      this.noiseHit(c.t, c.vel * 0.36, { type: "bandpass", freq: 1300, to: 3600, q: 0.8, attack: c.dur * 2 - 0.002, decay: 0.008, pan: 0.18, bus: this.busIn.snare });
    }
    if (snares && edit?.k === "stut") {
      // A 32nd pickup that climbs into the backbeat: quiet, so the backbeat stays the loudest hit.
      const n = c.heat > 0.6 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const back = n - i; // 32nds before the backbeat
        this.wonkySnare(c.t + c.dur * 2 - back * c.dur * 0.5 + 0.003, c.vel * (0.34 - 0.07 * back), i % 2 ? 0.2 : -0.2, WONKY_SNARES.glitch);
      }
    }
    if (snares && edit?.k === "roll" && step === 14 && c.hit.bar % 4 === 3) {
      // End of the four-bar phrase: a 32nd roll into the downbeat, quiet and rising.
      for (let i = 0; i < 4; i++) this.wonkySnare(c.t + i * c.dur * 0.5 + 0.003, c.vel * (0.14 + 0.06 * i), i % 2 ? 0.2 : -0.2, WONKY_SNARES.glitch);
    }
    // Crushed hats on an accent table; a busy row or heat ratchets the last sixteenth of each beat.
    const hd = this.wonkyHatCount(c);
    if (hd > 0 && (step % 2 === 0 || hd >= 6)) {
      const accent = WONKY_GLITCH_HATS[step];
      this.wonkyCrushHat(c.t, c.vel * accent * 1.6, 0.02, step % 2 === 1 ? 0.3 : -0.18, 7000 + c.color * 1500, 4, this.busIn.hat);
      if ((hd >= 10 || c.heat > 0.5) && step % 4 === 3) this.wonkyCrushHat(c.t + c.dur * 0.5, c.vel * accent * 1.1, 0.015, 0.4, 8200, 4, this.busIn.hat);
    }
    if (edit?.k === "hrev" && hd > 0) {
      // A reversed hat that swells into the next beat.
      this.noiseHit(c.t, c.vel * 0.12, { type: "highpass", freq: 5200, q: 0.7, attack: c.dur * (4 - (step % 4)) - 0.004, decay: 0.01, pan: -0.3, bus: this.busIn.hat });
    }
    // Glitch tier: a tape-stop zap and a crushed tick.
    if (v[3][step] > 0) {
      this.toneHit(c.t, c.vel * 0.12 * v[3][step], { type: "sine", freq: 1900 + 900 * c.color, to: 110, sweep: 0.06, decay: 0.07, pan: c.pan * 1.5, bus: this.busIn.perc });
      this.wonkyCrushHat(c.t + c.dur * 0.5, c.vel * 0.3, 0.02, -c.pan, 3200, 3, this.busIn.perc);
    }
    const chord = this.wonkyChord(c, WONKY_GLITCH_PROGS, 0x91c2, 1);
    const voice = this.wonkyVoice(c, chord, 1, 0x91c4);
    const end = (c.hit.bar & 1) * 16 + 15.7;
    if (sec.pad > 0) {
      const fig = WONKY_GLITCH_STABS[hash32(c.epoch, 0x91c5) % WONKY_GLITCH_STABS.length];
      const s = fig.find((x) => x.s === phrase && (x.core || hot));
      if (s) {
        const tones = s.p === "C" ? voice : s.p === "U" ? voice.slice(2) : voice.slice(0, 2);
        const n = hot ? s.rt : 1;
        for (let r = 0; r < n; r++) {
          const last = r === n - 1;
          const len = last ? Math.max(0.38, Math.min(s.len - r * 0.5, end - phrase - r * 0.5)) : 0.38;
          this.wonkyStab(c, c.t + r * c.dur * 0.5, tones, len * c.dur, sec.pad * (1 - 0.12 * r), false);
        }
      }
      // A busy glitch row plays the chord backwards into the bar line.
      if (step === 13 && rowCount(v[3]) >= 2) this.wonkyStab(c, c.t, voice, c.dur * 2.6, sec.pad * 0.7, true);
    }
    const bass = WONKY_GLITCH_BASS[hash32(c.epoch, 0x91c6) % WONKY_GLITCH_BASS.length];
    const b = bass.find((x) => x.s === phrase && (x.core || hot || bassAt(c.arr.bass, step) > 0));
    if (b) {
      const midi = this.wonkyRoot(c, chord) + [0, 12, 7][b.d];
      this.wonkyRubber(c, midi, Math.min(b.len, end - phrase) * c.dur, c.vel * 0.45);
    }
    if (sec.lead > 0) {
      const vox = WONKY_GLITCH_VOX[hash32(c.epoch, 0x91c7) % WONKY_GLITCH_VOX.length];
      const x = vox.find((y) => y.s === phrase && (y.core || hot));
      if (x) {
        const midi = c.low + 36 + voice[voice.length - 1 - x.n];
        const vowels = WONKY_VOWELS[x.v];
        const len = Math.min(x.len, end - phrase) * c.dur;
        if (hot && x.len >= 2 && rowCount(v[3]) >= 2) {
          this.wonkyVox(c, c.t, midi, c.dur * 0.4, vowels, sec.lead * 0.9);
          this.wonkyVox(c, c.t + c.dur * 0.5, midi, Math.max(c.dur * 0.5, len - c.dur * 0.5), vowels, sec.lead);
        } else this.wonkyVox(c, c.t, midi, len, vowels, sec.lead);
      }
    }
    if (step === 0) this.vinyl(c, 0.45);
  }

  /** Snare: a tuned body and a noise crack (bit-crushed when `bits` is set), with an optional clap layer just behind. */
  private wonkySnare(time: number, velocity: number, pan: number, s: WonkySnareSpec) {
    this.toneHit(time, s.bodyLevel * velocity, { type: "triangle", freq: s.body, to: s.to, sweep: 0.04, decay: s.bodyDecay, pan, bus: this.busIn.snare });
    if (s.bits) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise();
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = s.noise;
      bp.Q.value = s.q;
      const env = this.ctx.createGain();
      pulse(env.gain, time, 0.001, 0.9, s.noiseDecay);
      const crush = this.ctx.createWaveShaper();
      crush.curve = new Float32Array(bitCurve(s.bits));
      crush.oversample = "none";
      const out = this.ctx.createGain();
      out.gain.value = s.noiseLevel * velocity;
      src.connect(bp);
      bp.connect(env);
      env.connect(crush);
      crush.connect(out);
      const p = this.panNode(pan, this.busIn.snare);
      p.add(out);
      src.start(time);
      this.end(src, [bp, env, crush, out, p.dest], time + s.noiseDecay + 0.08);
    } else {
      this.noiseHit(time, s.noiseLevel * velocity, { type: "bandpass", freq: s.noise, q: s.q, decay: s.noiseDecay, pan, bus: this.busIn.snare });
    }
    if (s.clap) {
      for (let i = 0; i < 2; i++) {
        this.noiseHit(time + 0.002 + i * 0.007, s.clap * velocity, { type: "bandpass", freq: 1150, q: 1.2, decay: i === 1 ? 0.09 : 0.015, pan: -pan, bus: this.busIn.snare });
      }
    }
  }

  /** Bit-crushed noise tick. */
  private wonkyCrushHat(time: number, velocity: number, decay: number, panAmount: number, hpHz: number, bits: number, bus: MixChain) {
    const tail = decay * 3;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = hpHz;
    hp.Q.value = 0.8;
    const env = this.ctx.createGain();
    pulse(env.gain, time, 0.001, 0.9, tail);
    const crush = this.ctx.createWaveShaper();
    crush.curve = new Float32Array(bitCurve(bits));
    crush.oversample = "none";
    const out = this.ctx.createGain();
    out.gain.value = 0.5 * velocity;
    src.connect(hp);
    hp.connect(env);
    env.connect(crush);
    crush.connect(out);
    const pan = this.panNode(panAmount, bus);
    pan.add(out);
    src.start(time);
    this.end(src, [hp, env, crush, out, pan.dest], time + tail + 0.06);
  }

  /** Round 808: a sine with a soft octave, a little tanh under a closed lowpass. `punch` adds the pitch drop. */
  private wonky808(c: Ctx, time: number, midi: number, length: number, level: number, punch: boolean, drive: number) {
    const f = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(punch ? f * 1.5 : f, time);
    if (punch) osc.frequency.exponentialRampToValueAtTime(f, time + 0.045);
    const oct = this.ctx.createOscillator();
    oct.type = "triangle";
    oct.frequency.setValueAtTime(f * 2, time);
    const og = this.ctx.createGain();
    og.gain.value = 0.16;
    oct.connect(og);
    const env = this.ctx.createGain();
    const hold = Math.max(0.1, length * 0.9);
    const peak = 0.3 * level * (1 + 0.1 * c.heat);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.008);
    env.gain.setValueAtTime(peak, time + hold * 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, time + hold + 0.07);
    env.gain.setValueAtTime(0, time + hold + 0.07);
    osc.connect(env);
    og.connect(env);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(drive));
    shaper.oversample = "none";
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300 + 180 * c.color;
    lp.Q.value = 0.5;
    env.connect(shaper);
    shaper.connect(lp);
    this.busIn.bass.add(lp);
    osc.start(time);
    oct.start(time);
    this.end(osc, [env, shaper, lp], time + hold + 0.12);
    this.end(oct, [og], time + hold + 0.12);
  }

  /**
   * One chop of the soul sample: warm electric piano (sine + triangle) with a quiet string saw, all on the same pitch
   * (nothing to beat against), saturated and band-limited like a filtered loop, hard-gated at both ends.
   */
  private wonkySoul(c: Ctx, time: number, tones: readonly number[], length: number, level: number) {
    const gate = Math.max(0.05, length * 0.94);
    const end = time + gate + 0.03;
    const cutoff = clamp((750 + 1700 * c.color + 1500 * c.heat) * (c.press < 0 ? 1 + 0.35 * c.press : 1 + 0.2 * c.press), 400, 6500);
    const pre = this.ctx.createGain();
    pre.gain.value = 0.22;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.7));
    shaper.oversample = "none";
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(cutoff * 1.4, time);
    lp.frequency.exponentialRampToValueAtTime(cutoff, time + 0.1);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 200;
    hp.Q.value = 0.7;
    const amp = this.ctx.createGain();
    const peak = 0.2 * level;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(peak, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(peak * 0.6, time + gate);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    pre.connect(shaper);
    shaper.connect(lp);
    lp.connect(hp);
    hp.connect(amp);
    const pan = this.panNode(0.06, this.busIn.harm);
    pan.add(amp);
    // One shared tape wow for every voice: the chord bends as one, so it never beats against itself.
    const wow = this.ctx.createOscillator();
    wow.frequency.setValueAtTime(0.45 + (hash32(c.epoch, 0xd116) % 30) / 100, time);
    const wowG = this.ctx.createGain();
    wowG.gain.value = 5;
    wow.connect(wowG);
    const rest: AudioNode[] = [wowG, pre, shaper, lp, hp, amp, pan.dest];
    const srcs: OscillatorNode[] = [wow];
    let chain: AudioNode | null = null;
    for (const semi of tones) {
      for (const [type, lvl] of [["sine", 0.5], ["triangle", 0.3], ["sawtooth", 0.1]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(midiToFreq(c.low + 24 + semi), time);
        wowG.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = lvl;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        srcs.push(osc);
      }
    }
    (chain as AudioNode | null)?.connect(pre);
    for (const s of srcs) s.start(time);
    srcs.forEach((s, i) => this.end(s, i === 0 ? rest : [], end + 0.03));
  }

  /**
   * Woozy analog chord: per tone a saw on the left and a pulse on the right at exactly the same pitch (no detune, no
   * beating). One shared slow LFO bends the whole chord a few cents either way, so it is in tune on average, and each
   * chord sags in from a little flat.
   */
  private wonkyWoozy(c: Ctx, tones: readonly number[], length: number, level: number) {
    const t = c.t;
    this.padUntil = t + length;
    const end = t + length + 0.18;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 160;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.4));
    shaper.oversample = "none";
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.6;
    const cutoff = (600 + 1500 * c.color) * (1 + 0.3 * c.press + 0.5 * c.heat);
    lp.frequency.setValueAtTime(cutoff * 0.5, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + length * 0.4);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.7, end);
    const amp = this.ctx.createGain();
    const peak = 0.09 * level;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.15);
    amp.gain.setValueAtTime(peak, t + Math.max(0.16, length * 0.7));
    amp.gain.linearRampToValueAtTime(peak * 0.85, t + length);
    amp.gain.linearRampToValueAtTime(0, end);
    hp.connect(shaper);
    shaper.connect(lp);
    lp.connect(amp);
    this.busIn.harm.add(amp);
    const rest: AudioNode[] = [hp, shaper, lp, amp];
    const wob = this.ctx.createOscillator();
    wob.frequency.setValueAtTime(0.21 + (hash32(c.epoch, 0xbf07) % 10) / 100, t);
    const depth = this.ctx.createGain();
    depth.gain.value = 9;
    wob.connect(depth);
    rest.push(depth);
    const sources: OscillatorNode[] = [wob];
    const chordMix = new MixChain(this.ctx, hp, this.live);
    for (const side of [-1, 1]) {
      const pan = this.panNode(side * 0.4, chordMix);
      rest.push(pan.dest);
      for (const semi of tones) {
        const osc = this.ctx.createOscillator();
        if (side < 0) osc.type = "sawtooth";
        else osc.setPeriodicWave(this.pulseWave(0.25));
        osc.frequency.setValueAtTime(midiToFreq(c.low + 24 + semi), t);
        osc.detune.setValueAtTime(-22, t);
        osc.detune.linearRampToValueAtTime(0, t + 0.35);
        depth.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = side < 0 ? 0.3 : 0.24;
        osc.connect(g);
        rest.push(g);
        pan.add(g);
        sources.push(osc);
      }
    }
    for (const s of sources) s.start(t);
    sources.forEach((s, i) => this.end(s, i === 0 ? rest : [], end + 0.05));
  }

  /** Harp or glass glint: a pluck with one harmonic partial (2x harp, 4x glass), so it stays in tune. */
  private wonkyGlint(time: number, midi: number, level: number, decay: number, panAmount: number, glass: boolean) {
    const f = midiToFreq(midi);
    const pan = this.panNode(panAmount, this.busIn.lead);
    const a = this.ctx.createOscillator();
    a.type = glass ? "sine" : "triangle";
    a.frequency.setValueAtTime(f, time);
    const ga = this.ctx.createGain();
    pulse(ga.gain, time, 0.002, 0.2 * level, decay);
    a.connect(ga);
    pan.add(ga);
    const b = this.ctx.createOscillator();
    b.type = "sine";
    b.frequency.setValueAtTime(f * (glass ? 4 : 2), time);
    const gb = this.ctx.createGain();
    pulse(gb.gain, time, 0.001, 0.09 * level, decay * 0.35);
    b.connect(gb);
    pan.add(gb);
    a.start(time);
    b.start(time);
    this.end(a, [ga, pan.dest], time + decay + 0.06);
    this.end(b, [gb], time + decay + 0.06);
  }

  /** Glitch chord stab: a square/triangle pluck with a fast filter snap and a 6-bit grit. `reverse` swells into the cut. */
  private wonkyStab(c: Ctx, time: number, tones: readonly number[], length: number, level: number, reverse: boolean) {
    const gate = Math.max(0.03, length * 0.92);
    const end = time + gate + 0.015;
    const cutoff = clamp((900 + 2000 * c.color) * (1 + 0.3 * c.press + 0.5 * c.heat), 500, 9000);
    const pre = this.ctx.createGain();
    pre.gain.value = 0.25;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(cutoff * (reverse ? 0.6 : 3), time);
    lp.frequency.exponentialRampToValueAtTime(cutoff * (reverse ? 1.6 : 1), time + (reverse ? gate : 0.08));
    const crush = this.ctx.createWaveShaper();
    crush.curve = new Float32Array(bitCurve(6));
    crush.oversample = "none";
    const amp = this.ctx.createGain();
    const peak = 0.6 * level;
    amp.gain.setValueAtTime(0.0001, time);
    if (reverse) amp.gain.exponentialRampToValueAtTime(peak, time + gate);
    else {
      amp.gain.linearRampToValueAtTime(peak, time + 0.002);
      amp.gain.exponentialRampToValueAtTime(peak * 0.45, time + gate);
    }
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    pre.connect(lp);
    lp.connect(crush);
    crush.connect(amp);
    const pan = this.panNode(reverse ? -0.3 : c.pan * 0.5, this.busIn.harm);
    pan.add(amp);
    const rest: AudioNode[] = [pre, lp, crush, amp, pan.dest];
    const srcs: OscillatorNode[] = [];
    let chain: AudioNode | null = null;
    for (const semi of tones) {
      for (const [type, lvl] of [["square", 0.16], ["triangle", 0.42]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(midiToFreq(c.low + 24 + semi), time);
        const g = this.ctx.createGain();
        g.gain.value = lvl;
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        srcs.push(osc);
      }
    }
    (chain as AudioNode | null)?.connect(pre);
    for (const s of srcs) s.start(time);
    srcs.forEach((s, i) => this.end(s, i === 0 ? rest : [], end + 0.03));
  }

  /** Rubbery bass: a saw gliding from the last note (or bending up into its first), a resonant filter snap, a sine body. */
  private wonkyRubber(c: Ctx, midi: number, length: number, level: number) {
    const t = c.t;
    const f = midiToFreq(midi);
    const from = this.wonkyLastBass;
    this.wonkyLastBass = f;
    const glide = (osc: OscillatorNode, mul: number) => {
      osc.frequency.setValueAtTime((from > 0 && from !== f ? from : f * 0.92) * mul, t);
      osc.frequency.exponentialRampToValueAtTime(f * mul, t + (from > 0 && from !== f ? 0.05 : 0.04));
    };
    const saw = this.ctx.createOscillator();
    saw.type = "sawtooth";
    glide(saw, 1);
    const body = this.ctx.createOscillator();
    body.type = "sine";
    glide(body, 1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 7;
    const base = (220 + 500 * c.color) * (1 + 0.3 * c.press + 0.5 * c.heat);
    lp.frequency.setValueAtTime(base * 5, t);
    lp.frequency.exponentialRampToValueAtTime(base, t + 0.14);
    const sg = this.ctx.createGain();
    sg.gain.value = 0.32;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array(tanhCurve(1.6));
    shaper.oversample = "none";
    const bg = this.ctx.createGain();
    bg.gain.value = 0.7;
    const amp = this.ctx.createGain();
    const hold = Math.max(0.06, length * 0.9);
    const peak = 0.26 * level;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.setValueAtTime(peak * 0.85, t + hold * 0.6);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.05);
    amp.gain.setValueAtTime(0, t + hold + 0.05);
    saw.connect(lp);
    lp.connect(sg);
    sg.connect(shaper);
    body.connect(bg);
    const sum = this.ctx.createGain();
    shaper.connect(sum);
    bg.connect(sum);
    sum.connect(amp);
    this.busIn.bass.add(amp);
    saw.start(t);
    body.start(t);
    this.end(saw, [lp, sg, shaper, sum, amp], t + hold + 0.1);
    this.end(body, [bg], t + hold + 0.1);
  }

  /** Vocal-ish chop: a saw through two formant bands gliding from one vowel to the next, a little vibrato. */
  private wonkyVox(c: Ctx, time: number, midi: number, length: number, vowels: readonly (readonly [number, number])[], level: number) {
    const f = midiToFreq(midi);
    const hold = Math.max(0.05, length * 0.9);
    const end = time + hold + 0.06;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f, time);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(5.5, time);
    const vib = this.ctx.createGain();
    vib.gain.setValueAtTime(0, time);
    vib.gain.linearRampToValueAtTime(f * 0.006, time + Math.min(hold, 0.2));
    lfo.connect(vib);
    vib.connect(osc.frequency);
    const [[a1, a2], [b1, b2]] = vowels;
    const fa = this.ctx.createBiquadFilter();
    fa.type = "bandpass";
    fa.Q.value = 6;
    fa.frequency.setValueAtTime(a1, time);
    fa.frequency.linearRampToValueAtTime(b1, time + hold);
    const fb = this.ctx.createBiquadFilter();
    fb.type = "bandpass";
    fb.Q.value = 8;
    fb.frequency.setValueAtTime(a2, time);
    fb.frequency.linearRampToValueAtTime(b2, time + hold);
    const mix = this.ctx.createGain();
    osc.connect(fa);
    osc.connect(fb);
    fa.connect(mix);
    fb.connect(mix);
    const amp = this.ctx.createGain();
    const peak = 0.25 * level;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(peak, time + 0.012);
    amp.gain.setValueAtTime(peak, time + hold);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    mix.connect(amp);
    const pan = this.panNode(-0.22, this.busIn.lead);
    pan.add(amp);
    osc.start(time);
    lfo.start(time);
    this.end(osc, [fa, fb, mix, amp, pan.dest], end + 0.03);
    this.end(lfo, [vib], end + 0.03);
  }

  private fourFloor(c: Ctx): boolean {
    const row = c.v[0];
    if (rowMax(row) <= 0 || c.step % 4 !== 0) return false;
    const sec = c.sec;
    if (sec.name === "intro" || (sec.name === "rebuild" && sec.bar < 30)) return c.step === 0 || c.step === 8;
    return true;
  }

  private onsets(bass: bigint): number[] {
    const out: number[] = [];
    for (let s = 0; s < 16; s++) if (bassAt(bass, s) > 0) out.push(s);
    return out;
  }

  /** Steps until the next bass onset (capped). */
  private holdSteps(bass: bigint, step: number, cap: number): number {
    for (let i = 1; i < cap; i++) if (bassAt(bass, (step + i) % 16) > 0) return i;
    return cap;
  }

  /** Heat: extra hats inside the step (a roll), more often and denser as heat rises. Never adds grid steps. */
  private hatRoll(c: Ctx, hp: number) {
    if (hash32(this.patternId, c.step, c.hit.bar, 0x4ea7) % 100 >= Math.round(c.heat * 70)) return;
    const n = c.heat >= 0.75 ? 3 : 2;
    for (let i = 1; i < n; i++) {
      this.hat(c.t + (i * c.dur) / n, c.vel * (0.4 - i * 0.1), { hp, decay: 0.02, metal: 0.5, pan: -c.pan });
    }
  }

  /** Heat >= 0.5: a roll up into the next bar on the empty steps; from step 8 and in 32nds near the top. */
  private rollUp(c: Ctx, voice: (time: number, vel: number) => void) {
    const hot = c.heat >= 0.85;
    if (!hot && c.hit.bar % 2 === 0) return;
    const start = hot ? 8 : 12;
    if (c.step < start) return;
    const rel = (c.step - start) / (15 - start);
    const vel = c.vel * c.heat * (0.16 + 0.44 * rel);
    voice(c.t, vel);
    if (hot && c.step >= 14) voice(c.t + c.dur / 2, vel * 0.85);
  }

  // ------------------------------------------------------------------ voices

  private kick(time: number, velocity: number, k: KickSpec) {
    const osc = this.ctx.createOscillator();
    osc.type = k.osc ?? "sine";
    const body = this.ctx.createGain();
    osc.frequency.setValueAtTime(k.start, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, k.end), time + k.sweep);
    pulse(body.gain, time, 0.003, 0.45 * velocity * (k.body ?? 1), k.decay);
    osc.connect(body);
    const rest: AudioNode[] = [body];
    if (k.drive) {
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = new Float32Array(tanhCurve(k.drive));
      shaper.oversample = "none";
      body.connect(shaper);
      const trim = this.ctx.createGain();
      trim.gain.value = 0.85;
      shaper.connect(trim);
      this.busIn.kick.add(trim);
      rest.push(shaper, trim);
    } else {
      this.busIn.kick.add(body);
    }
    osc.start(time);
    this.end(osc, rest, time + k.decay + 0.1);
    if (k.click > 0) {
      const click = this.ctx.createBufferSource();
      click.buffer = this.noise();
      click.loop = true;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = k.clickHp ?? 1800;
      const g = this.ctx.createGain();
      pulse(g.gain, time, 0.001, 0.2 * velocity * k.click, 0.012);
      click.connect(hp);
      hp.connect(g);
      this.busIn.kick.add(g);
      click.start(time);
      this.end(click, [hp, g], time + 0.05);
    }
  }

  /** `decay` is roughly the -20 dB time; the exponential tail runs to -80 dB over three times that. */
  private hat(time: number, velocity: number, h: { hp: number; decay: number; metal: number; pan: number; q?: number }) {
    const tail = h.decay * 3;
    const pan = this.panNode(h.pan, this.busIn.hat);
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noise();
    noise.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = h.hp;
    hp.Q.value = h.q ?? 0.7;
    const g = this.ctx.createGain();
    pulse(g.gain, time, 0.001, 0.62 * velocity, tail);
    noise.connect(hp);
    hp.connect(g);
    pan.add(g);
    noise.start(time);
    this.end(noise, [hp, g, pan.dest], time + tail + 0.06);
    if (h.metal > 0) {
      const metal = this.ctx.createBufferSource();
      metal.buffer = this.metalBuffer(`hat${this.era.index}`, 3400, 0.012);
      const mg = this.ctx.createGain();
      pulse(mg.gain, time, 0.001, 0.42 * velocity * h.metal, tail);
      metal.connect(mg);
      pan.add(mg);
      metal.start(time);
      this.end(metal, [mg], time + tail + 0.06);
    }
  }

  private rim(time: number, velocity: number, panAmount: number, pitch: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(820 * pitch, time);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700 * pitch;
    bp.Q.value = 2.2;
    const g = this.ctx.createGain();
    pulse(g.gain, time, 0.001, 0.8 * velocity, 0.08);
    osc.connect(bp);
    bp.connect(g);
    const pan = this.panNode(panAmount, this.busIn.snare);
    pan.add(g);
    osc.start(time);
    this.end(osc, [bp, g, pan.dest], time + 0.12);
  }

  /** Generic filtered-noise hit. */
  private noiseHit(
    time: number,
    peak: number,
    n: { type: BiquadFilterType; freq: number; q: number; decay: number; attack?: number; to?: number; pan: number; bus: MixChain },
  ) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = n.type;
    f.frequency.setValueAtTime(n.freq, time);
    if (n.to) f.frequency.exponentialRampToValueAtTime(n.to, time + n.decay);
    f.Q.value = n.q;
    const g = this.ctx.createGain();
    pulse(g.gain, time, n.attack ?? 0.001, peak, n.decay);
    src.connect(f);
    f.connect(g);
    const pan = this.panNode(n.pan, n.bus);
    pan.add(g);
    src.start(time);
    this.end(src, [f, g, pan.dest], time + (n.attack ?? 0) + n.decay + 0.06);
  }

  /** Generic pitched one-shot (sine/triangle) with an optional pitch drop. */
  private toneHit(
    time: number,
    peak: number,
    o: { type: OscillatorType; freq: number; to?: number; sweep?: number; decay: number; attack?: number; pan: number; bus: MixChain },
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, time);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, time + (o.sweep ?? o.decay));
    const g = this.ctx.createGain();
    pulse(g.gain, time, o.attack ?? 0.002, peak, o.decay);
    osc.connect(g);
    const pan = this.panNode(o.pan, o.bus);
    pan.add(g);
    osc.start(time);
    this.end(osc, [g, pan.dest], time + (o.attack ?? 0) + o.decay + 0.05);
  }

  private snare808(time: number, velocity: number, panAmount: number) {
    this.toneHit(time, 0.5 * velocity, { type: "triangle", freq: 238, to: 180, sweep: 0.05, decay: 0.09, pan: panAmount, bus: this.busIn.snare });
    this.toneHit(time, 0.3 * velocity, { type: "triangle", freq: 476, decay: 0.05, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.8 * velocity, { type: "highpass", freq: 1800, q: 0.7, decay: 0.26, pan: panAmount, bus: this.busIn.snare });
  }

  private clap(time: number, velocity: number, panAmount: number) {
    for (let i = 0; i < 3; i++) {
      this.noiseHit(time + i * 0.011, 0.68 * velocity, { type: "bandpass", freq: 1250, q: 1.1, decay: i === 2 ? 0.24 : 0.02, pan: panAmount, bus: this.busIn.snare });
    }
  }

  private tapeSnare(time: number, velocity: number, panAmount: number) {
    this.toneHit(time, 0.4 * velocity, { type: "triangle", freq: 190, to: 160, decay: 0.08, pan: panAmount, bus: this.busIn.snare });
    this.noiseHit(time, 0.6 * velocity, { type: "bandpass", freq: 1500, q: 0.6, decay: 0.32, pan: panAmount, bus: this.busIn.snare });
  }

  private cowbell(time: number, velocity: number, panAmount: number) {
    for (const f of [540, 800]) {
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(f, time);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900;
      bp.Q.value = 1.8;
      const g = this.ctx.createGain();
      pulse(g.gain, time, 0.001, 0.09 * velocity, 0.09);
      osc.connect(bp);
      bp.connect(g);
      const pan = this.panNode(panAmount, this.busIn.perc);
      pan.add(g);
      osc.start(time);
      this.end(osc, [bp, g, pan.dest], time + 0.14);
    }
  }

  /** Electro zap: a fast falling sine. */
  private zap(c: Ctx, velocity: number) {
    this.toneHit(c.t, 0.14 * velocity, { type: "sine", freq: 2200 + 1400 * c.color, to: 140, sweep: 0.07, decay: 0.08, pan: c.pan * 1.4, bus: this.busIn.perc });
  }


  /** Sine sub. `drop` adds an 808-style pitch fall at the start. */
  private sub(c: Ctx, midi: number, length: number, level: number, drop = false) {
    const freq = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(drop ? freq * 1.6 : freq, c.t);
    if (drop) osc.frequency.exponentialRampToValueAtTime(freq, c.t + 0.05);
    const g = this.ctx.createGain();
    const hold = Math.max(0.08, length * 0.92);
    g.gain.setValueAtTime(0.0001, c.t);
    g.gain.linearRampToValueAtTime(0.22 * level, c.t + 0.012);
    g.gain.setValueAtTime(0.22 * level, c.t + hold * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, c.t + hold + 0.06);
    g.gain.setValueAtTime(0, c.t + hold + 0.06);
    osc.connect(g);
    this.busIn.bass.add(g);
    osc.start(c.t);
    this.end(osc, [g], c.t + hold + 0.1);
  }

  /** Electro bass: square/saw with a snappy resonant filter; the tick sets how far it opens. */
  private electroBass(c: Ctx, midi: number, length: number) {
    const t = c.t;
    const freq = midiToFreq(midi);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 7;
    const open = 600 + 1800 * c.color + 1200 * Math.max(0, c.press);
    f.frequency.setValueAtTime(open, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 1.5), t + 0.13);
    const amp = this.ctx.createGain();
    const hold = Math.max(0.06, length * 0.8);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.2, t + 0.004);
    amp.gain.setValueAtTime(0.2, t + hold * 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + hold);
    amp.gain.setValueAtTime(0, t + hold);
    const a = this.ctx.createOscillator();
    a.type = "square";
    a.frequency.setValueAtTime(freq, t);
    const b = this.ctx.createOscillator();
    b.type = "sawtooth";
    b.frequency.setValueAtTime(freq, t);
    b.detune.setValueAtTime(7, t);
    const ga = this.ctx.createGain();
    ga.gain.value = 0.5;
    const gb = this.ctx.createGain();
    gb.gain.value = 0.45;
    a.connect(ga);
    b.connect(gb);
    const mix = this.ctx.createGain();
    ga.connect(mix);
    gb.connect(mix);
    mix.connect(f);
    f.connect(amp);
    this.busIn.bass.add(amp);
    a.start(t);
    b.start(t);
    this.end(a, [ga, gb, mix, f, amp], t + hold + 0.05);
    this.end(b, [], t + hold + 0.05);
    this.sub(c, midi - 12, length * 0.9, 0.45);
  }

  /** Ambient IDM pad: detuned saw+triangle per note, slow attack, tape wow and flutter on every oscillator. */
  private pad(c: Ctx, root: number, chord: number[], length: number, bright = 1, gain = 1) {
    const t = c.t;
    const attack = Math.min(1.6, length * 0.3);
    const release = 2.6;
    const end = t + length + release;
    this.padUntil = t + length;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.6;
    const cutoff = (650 + 900 * c.color + 1400 * c.heat) * bright * (c.press < 0 ? 1 + 0.3 * c.press : 1);
    f.frequency.setValueAtTime(cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + Math.min(length, 4));
    const amp = this.ctx.createGain();
    const level = 0.065 * (1 + 0.4 * c.heat) * gain;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setValueAtTime(level, t + length);
    amp.gain.linearRampToValueAtTime(0.0001, end);
    amp.gain.setValueAtTime(0, end);
    f.connect(amp);
    const pan = this.panNode(0.05, this.busIn.harm);
    pan.add(amp);
    // Wow (slow, deep) + flutter (fast, shallow), summed once, then one input per detune param.
    const wow = this.ctx.createOscillator();
    wow.frequency.setValueAtTime(0.35 + (hash32(c.epoch, 0x77) % 20) / 100, t);
    const wowG = this.ctx.createGain();
    wowG.gain.value = 9;
    wow.connect(wowG);
    const flut = this.ctx.createOscillator();
    flut.frequency.setValueAtTime(5.2, t);
    const flutG = this.ctx.createGain();
    flutG.gain.value = 2.5;
    flut.connect(flutG);
    const mod = this.ctx.createGain();
    wowG.connect(mod);
    flutG.connect(mod);
    const rest: AudioNode[] = [wowG, flutG, mod, f, amp, pan.dest];
    const oscs: OscillatorNode[] = [wow, flut];
    let chain: AudioNode | null = null;
    chord.forEach((semi, i) => {
      for (const [type, cents, lvl] of [["sawtooth", -6, 0.3], ["triangle", 5, 0.55]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(midiToFreq(root + semi), t);
        osc.detune.setValueAtTime(cents + (i % 2 ? 2 : -2), t);
        mod.connect(osc.detune);
        const g = this.ctx.createGain();
        g.gain.value = lvl * (semi < 0 ? 0.55 : 0.85);
        osc.connect(g);
        rest.push(g);
        chain = this.pairSum(chain, g, rest);
        oscs.push(osc);
      }
    });
    (chain as AudioNode | null)?.connect(f);
    for (const osc of oscs) osc.start(t);
    oscs.forEach((osc, i) => this.end(osc, i === 0 ? rest : [], end + 0.05));
  }

  /** Drone breath: one and a half bars of soft, low band-limited noise whose band follows the tick. */
  private breath(c: Ctx) {
    const bar = c.dur * 16;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(280 + 520 * c.color, c.t);
    bp.frequency.linearRampToValueAtTime(280 + 520 * fold(c.color + 0.2), c.t + bar * 1.6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    lp.frequency.value = 1400;
    const g = this.ctx.createGain();
    const peak = 0.022 * Math.max(0.3, c.sec.hat) * (1 + 0.5 * Math.max(0, -c.press));
    // 1.6 bars long, peaking mid-bar: consecutive breaths overlap into one slow-moving texture.
    g.gain.setValueAtTime(0.0001, c.t);
    g.gain.linearRampToValueAtTime(peak, c.t + bar * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, c.t + bar * 1.6);
    g.gain.setValueAtTime(0, c.t + bar * 1.6);
    src.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    this.busIn.tex.add(g);
    src.start(c.t);
    this.end(src, [bp, lp, g], c.t + bar * 1.65);
  }

  /** Vinyl hiss and crackle, a bar at a time with overlap. */
  private vinyl(c: Ctx, level: number) {
    const bar = c.dur * 16;
    if (c.t < this.texUntil - bar * 0.5) return;
    this.texUntil = c.t + bar;
    const key = `v${this.era.index}`;
    let buffer = this.bufCache.get(key);
    if (!buffer) {
      buffer = makeVinyl(this.ctx, hash32(this.era.index, 0x71));
      this.cache(key, buffer);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 3200;
    hp.Q.value = 0.4;
    const g = this.ctx.createGain();
    const peak = 0.05 * level * (1 + 0.6 * Math.max(0, -c.press));
    g.gain.setValueAtTime(0.0001, c.t);
    g.gain.linearRampToValueAtTime(peak, c.t + 0.08);
    g.gain.setValueAtTime(peak, c.t + bar);
    g.gain.linearRampToValueAtTime(0.0001, c.t + bar + 0.1);
    g.gain.setValueAtTime(0, c.t + bar + 0.1);
    src.connect(hp);
    hp.connect(g);
    this.busIn.tex.add(g);
    src.start(c.t, (hash32(c.hit.bar, 0x7a) % 1000) / 1000);
    this.end(src, [hp, g], c.t + bar + 0.15);
  }

  /** The genre's lead patch on one note (melody genres only). */
  private motifNote(c: Ctx, midi: number, length: number, level: number) {
    const patch: LeadPatch = leadPatch(this.era.id, c.epoch, c.style.leads);
    const time = c.t;
    const freq = midiToFreq(midi);
    const hold = Math.max(0.06, length * 0.94);
    const end = time + hold + patch.amp.r + 0.05;
    const nodes: AudioNode[] = [];
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
    const prev = this.lastLeadFreq;
    this.lastLeadFreq = freq;

    // Shared pitch modulators: vibrato and FM. Each oscillator frequency gets at most one input.
    let vib: GainNode | null = null;
    if (patch.vib) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.setValueAtTime(patch.vib.rate, time);
      vib = this.ctx.createGain();
      const depth = freq * (Math.pow(2, patch.vib.depth / 1200) - 1);
      vib.gain.setValueAtTime(0, time);
      vib.gain.setValueAtTime(0, time + Math.min(hold, patch.vib.delay));
      vib.gain.linearRampToValueAtTime(depth, time + Math.min(hold, patch.vib.delay) + 0.25);
      lfo.connect(vib);
      sources.push(lfo);
      nodes.push(vib);
    }
    let fm: GainNode | null = null;
    if (patch.fm) {
      const mod = this.ctx.createOscillator();
      mod.frequency.setValueAtTime(freq * patch.fm.ratio, time);
      fm = this.ctx.createGain();
      fm.gain.setValueAtTime(freq * patch.fm.index, time);
      fm.gain.exponentialRampToValueAtTime(Math.max(0.01, freq * patch.fm.index * patch.fm.floor), time + patch.fm.decay);
      mod.connect(fm);
      sources.push(mod);
      nodes.push(fm);
    }
    let pitchMod: AudioNode | null = vib ?? fm;
    if (vib && fm) {
      const both = this.ctx.createGain();
      vib.connect(both);
      fm.connect(both);
      nodes.push(both);
      pitchMod = both;
    }
    let chain: AudioNode | null = null;
    for (const o of patch.osc) {
      const osc = this.ctx.createOscillator();
      if (o.type === "pulse25" || o.type === "pulse12") osc.setPeriodicWave(this.pulseWave(o.type === "pulse25" ? 0.25 : 0.125));
      else osc.type = o.type;
      const target = freq * Math.pow(2, o.oct);
      if (patch.glide && prev > 0) {
        osc.frequency.setValueAtTime(prev * Math.pow(2, o.oct), time);
        osc.frequency.exponentialRampToValueAtTime(target, time + patch.glide);
      } else if (patch.blip) {
        osc.frequency.setValueAtTime(target * Math.pow(2, patch.blip / 12), time);
        osc.frequency.exponentialRampToValueAtTime(target, time + 0.04);
      } else {
        osc.frequency.setValueAtTime(target, time);
      }
      osc.detune.setValueAtTime(o.detune, time);
      pitchMod?.connect(osc.frequency);
      const g = this.ctx.createGain();
      g.gain.value = o.level;
      osc.connect(g);
      nodes.push(g);
      sources.push(osc);
      chain = this.pairSum(chain, g, nodes);
    }
    if (patch.noise) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noise();
      n.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = patch.noise;
      n.connect(g);
      nodes.push(g);
      sources.push(n);
      chain = this.pairSum(chain, g, nodes);
    }
    let voice = chain as AudioNode | null;
    if (!voice) return;
    if (patch.drive) {
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = new Float32Array(tanhCurve(patch.drive));
      shaper.oversample = "none";
      voice.connect(shaper);
      nodes.push(shaper);
      voice = shaper;
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = patch.filter.type;
    filter.Q.value = patch.filter.q;
    filter.frequency.setValueAtTime(patch.filter.cutoff + patch.filter.env, time);
    if (patch.filter.env > 0) filter.frequency.exponentialRampToValueAtTime(patch.filter.cutoff, time + patch.filter.decay);
    nodes.push(filter);
    if (patch.formants) {
      const [f1, f2] = patch.formants;
      const a = this.ctx.createBiquadFilter();
      const b = this.ctx.createBiquadFilter();
      a.type = "bandpass";
      b.type = "bandpass";
      a.frequency.value = f1;
      b.frequency.value = f2;
      a.Q.value = 6;
      b.Q.value = 8;
      voice.connect(a);
      voice.connect(b);
      const mix = this.ctx.createGain();
      a.connect(mix);
      b.connect(mix);
      mix.connect(filter);
      nodes.push(a, b, mix);
    } else {
      voice.connect(filter);
    }
    const amp = this.ctx.createGain();
    const peak = 0.11 * patch.gain * level;
    const { a, d, s: sus, r } = patch.amp;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(peak, time + a);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), time + a + d);
    amp.gain.setValueAtTime(Math.max(0.0001, peak * sus), time + Math.max(a + d, hold));
    amp.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(a + d, hold) + r);
    amp.gain.setValueAtTime(0, time + Math.max(a + d, hold) + r);
    filter.connect(amp);
    nodes.push(amp);
    const pan = this.panNode(-c.pan * 0.6, this.busIn.lead);
    pan.add(amp);
    nodes.push(pan.dest);
    for (const src of sources) src.start(time);
    sources.forEach((src, i) => this.end(src, i === 0 ? nodes : [], end));
  }

  private pulseCache = new Map<number, PeriodicWave>();
  /** Narrow pulse wave from its Fourier series (deterministic, no noise). */
  private pulseWave(duty: number): PeriodicWave {
    const hit = this.pulseCache.get(duty);
    if (hit) return hit;
    const n = 64;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    const wave = this.ctx.createPeriodicWave(real, imag);
    this.pulseCache.set(duty, wave);
    return wave;
  }

  /** Idle bed: one bar of root + fifth with long overlapping fades, at the genre's tonic. */
  private droneTone(c: Ctx, amount: number) {
    const bar = c.dur * 16;
    const fadeIn = Math.min(1.6, bar * 0.4);
    const len = bar + fadeIn;
    const time = c.t;
    const root = c.low + 12;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.5;
    const out = this.ctx.createGain();
    const peak = (0.07 * amount) / this.trim;
    out.gain.setValueAtTime(0.0001, time);
    out.gain.linearRampToValueAtTime(peak, time + fadeIn);
    out.gain.setValueAtTime(peak, time + bar);
    out.gain.linearRampToValueAtTime(0.0001, time + len);
    out.gain.setValueAtTime(0, time + len);
    filter.connect(out);
    this.busIn.tex.add(out);
    const voices: [number, OscillatorType, number, number][] = [
      [root, "sine", 0, 0.9],
      [root + 12, "triangle", -6, 0.45],
      [root + 19, "triangle", 5, 0.3],
      [root + 24, "sine", 3, 0.16],
    ];
    let chain: AudioNode | null = null;
    const rest: AudioNode[] = [];
    voices.forEach(([midi, type, cents, level], index) => {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(midiToFreq(midi), time);
      osc.detune.setValueAtTime(cents, time);
      const gain = this.ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain);
      rest.push(gain);
      chain = this.pairSum(chain, gain, rest);
      osc.start(time);
      this.end(osc, index === 0 ? [filter, out] : [], time + len + 0.05);
    });
    (chain as AudioNode | null)?.connect(filter);
  }

  // ------------------------------------------------------------------ structure: heat, drops, fills

  /** Heat: a swell across the bar. Techno/electro/acid get a bright noise riser; ambient genres a slow dark swell. */
  private riser(c: Ctx, level: number) {
    const bar = c.dur * 16;
    const soft = this.era.id === "ambientidm" || this.era.id === "drone" || this.era.id === "dubtechno";
    const heat = c.heat;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noise();
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = soft ? "lowpass" : "bandpass";
    filter.Q.value = soft ? 0.8 : 1.4 + heat * 2.6;
    filter.frequency.setValueAtTime(soft ? 200 : 380, c.t);
    filter.frequency.exponentialRampToValueAtTime((soft ? 200 + 2400 * heat : 380 + 9000 * heat * heat), c.t + bar * 0.97);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, c.t);
    gain.gain.linearRampToValueAtTime((0.03 + 0.11 * heat * heat) * level * (soft ? 0.7 : 1), c.t + bar * 0.94);
    gain.gain.linearRampToValueAtTime(0.0001, c.t + bar);
    gain.gain.setValueAtTime(0, c.t + bar);
    noise.connect(filter);
    filter.connect(gain);
    this.busIn.fx.add(gain);
    noise.start(c.t);
    this.end(noise, [filter, gain], c.t + bar + 0.02);
  }

  /** The drop downbeat: the song-form filter snaps fully open instead of gliding. */
  private openNow(time: number) {
    const f = this.tone.frequency;
    f.cancelScheduledValues(time);
    f.setValueAtTime(16000, time);
    this.toneHz = 16000;
  }

  /** Song-form filter: glides to this bar's opening across the bar. Sell pressure darkens it. */
  private sweep(time: number, bar: number, opening: number, press: number) {
    const dark = press < 0 ? 1 + 0.45 * press : 1;
    const target = Math.max(260, 420 * Math.pow(16000 / 420, clamp(opening, 0, 1)) * dark);
    const f = this.tone.frequency;
    f.cancelScheduledValues(time);
    f.setValueAtTime(this.toneHz, time);
    f.exponentialRampToValueAtTime(target, time + Math.max(0.05, bar));
    this.toneHz = target;
  }

  /** On the first hit: the echo at this tempo. Once a bar: the pressure macros (drive, echo and room levels). */
  private applyMacro(c: Ctx, tempo: number) {
    if (!this.echoBuilt) {
      this.buildEcho(Math.round(tempo));
      this.echoBuilt = true;
    }
    const drive = this.mix.drive * (1 + this.mix.pressDrive * Math.max(0, c.press)) * (1 + 0.3 * c.heat);
    const space = 1 + 0.7 * Math.max(0, -c.press) + (this.era.id === "ambientidm" || this.era.id === "drone" ? 0.6 * c.heat : 0);
    const echoAmt = 1 + (this.era.id === "dubtechno" ? 0.6 * c.heat + 0.3 * Math.max(0, -c.press) : 0.2 * c.heat);
    if (!this.macro.primed) {
      this.drive.gain.setValueAtTime(drive, 0);
      this.spaceLevel.gain.setValueAtTime(space, 0);
      this.echoLevel.gain.setValueAtTime(echoAmt, 0);
      this.macro = { primed: true, drive, echo: echoAmt, space };
      return;
    }
    if (c.step !== 0) return;
    const ramp = (param: AudioParam, from: number, to: number) => {
      if (Math.abs(from - to) < 1e-4) return;
      param.setValueAtTime(from, c.t);
      param.linearRampToValueAtTime(to, c.t + c.dur * 4);
    };
    ramp(this.drive.gain, this.macro.drive, drive);
    ramp(this.spaceLevel.gain, this.macro.space, space);
    ramp(this.echoLevel.gain, this.macro.echo, echoAmt);
    this.macro = { primed: true, drive, echo: echoAmt, space };
  }

  /**
   * Tempo-synced echo (the genre instance's first tempo; a later drift of a few bpm leaves it slightly off the grid)
   * as a chain of delay -> lowpass/highpass -> gain stages, each tap out to the mains.
   * A feedback cycle around DelayNode moved single PCM samples by 1 LSB between offline renders, so the
   * "feedback" is unrolled into feed-forward taps; each tap is darker than the last, like a dub delay.
   */
  private buildEcho(tempo: number) {
    const e = this.mix.echo;
    const time = Math.min(2.4, (60 / tempo / 4) * e.steps);
    let prev: AudioNode = this.echoLevel;
    for (let i = 0; i < e.taps; i++) {
      const delay = this.ctx.createDelay(2.5);
      delay.delayTime.value = time;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = e.lp;
      lp.Q.value = 0.5;
      if (this.era.id === "dubtechno") this.echoLp.push(lp);
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = e.hp;
      const g = this.ctx.createGain();
      g.gain.value = i === 0 ? 0.55 : e.fb;
      prev.connect(delay);
      delay.connect(lp);
      lp.connect(hp);
      hp.connect(g);
      const out = this.panNode(i % 2 === 0 ? 0.55 : -0.55, this.mains);
      out.add(g);
      prev = g;
    }
  }

  /** Fixed room: six early taps summed, then a chain of darker, sparser late taps alternating left and right. */
  private buildSpace(input: AudioNode) {
    const s = this.mix.space;
    const pre = this.ctx.createBiquadFilter();
    pre.type = "highpass";
    pre.frequency.value = 180;
    input.connect(pre);
    const early = this.ctx.createGain();
    stereo(early);
    const earlySum = new MixChain(this.ctx, early, this.live);
    [0.007, 0.013, 0.023, 0.031, 0.043, 0.059].forEach((sec, i) => {
      const d = this.ctx.createDelay(0.2);
      d.delayTime.value = sec * s.size;
      const g = this.ctx.createGain();
      g.gain.value = 0.32 - i * 0.035;
      pre.connect(d);
      d.connect(g);
      earlySum.add(g);
    });
    let prev: AudioNode = early;
    [0.047, 0.061, 0.079, 0.097, 0.113, 0.131, 0.149, 0.167, 0.191, 0.211].forEach((sec, i) => {
      const d = this.ctx.createDelay(1);
      d.delayTime.value = sec * s.size;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = s.lp;
      lp.Q.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.value = i === 0 ? 0.8 : s.fb;
      prev.connect(d);
      d.connect(lp);
      lp.connect(g);
      const out = this.panNode(i % 2 === 0 ? -0.6 : 0.6, this.mains);
      out.add(g);
      prev = g;
    });
  }

  private noise(): AudioBuffer {
    let buffer = this.noiseCache.get(this.patternId);
    if (!buffer) {
      buffer = makeNoise(this.ctx, hash32(this.patternId, 0x4e01));
      this.noiseCache.set(this.patternId, buffer);
      if (this.noiseCache.size > 6) {
        const first = this.noiseCache.keys().next().value;
        if (first !== undefined) this.noiseCache.delete(first);
      }
    }
    return buffer;
  }

  private metalBuffer(key: string, base: number, decay: number): AudioBuffer {
    const k = `${key}:${this.ctx.sampleRate}`;
    let buffer = this.bufCache.get(k);
    if (!buffer) {
      buffer = makeMetal(this.ctx, hash32(base | 0, (decay * 1000) | 0, 0xc0a7), base, decay);
      this.cache(k, buffer);
    }
    return buffer;
  }

  private cache(key: string, buffer: AudioBuffer) {
    this.bufCache.set(key, buffer);
    if (this.bufCache.size > 96) {
      const first = this.bufCache.keys().next().value;
      if (first !== undefined) this.bufCache.delete(first);
    }
  }

  /** Kick sidechain. A style can dig the bass duck deeper or hold it longer than its genre's mix does. */
  private duck(time: number, bassDepth?: number, bassRelease?: number) {
    const { harm } = this.mix.duck;
    const bass = bassDepth ?? this.mix.duck.bass;
    if (bass < 1) {
      const g = this.bassDuck.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(bass, time);
      g.linearRampToValueAtTime(1, time + (bassRelease ?? this.mix.duckTime?.bass ?? 0.2));
    }
    if (harm < 1) {
      const g = this.harmDuck.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(harm, time);
      g.linearRampToValueAtTime(1, time + (this.mix.duckTime?.harm ?? 0.26));
    }
  }

  /** Pairwise sum helper for voice stacks (bit-exact offline). */
  private pairSum(chain: AudioNode | null, node: AudioNode, rest: AudioNode[]): AudioNode {
    if (!chain) return node;
    const sum = this.ctx.createGain();
    chain.connect(sum);
    node.connect(sum);
    rest.push(sum);
    return sum;
  }

  /** Equal-power pan. StereoPannerNode is not bit-exact across offline renders. */
  private panNode(amount: number, bus: MixChain): MixChain {
    const input = this.ctx.createGain();
    const left = this.ctx.createGain();
    const right = this.ctx.createGain();
    const merger = this.ctx.createChannelMerger(2);
    const a = clamp(amount, -1, 1);
    left.gain.value = Math.cos(((a + 1) * Math.PI) / 4);
    right.gain.value = Math.sin(((a + 1) * Math.PI) / 4);
    input.connect(left);
    input.connect(right);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    bus.add(merger);
    return new MixChain(this.ctx, input, this.live);
  }

  private end(node: AudioBufferSourceNode | OscillatorNode, rest: AudioNode[], when: number) {
    dispose(node, rest, when, this.live);
  }

  /** Piecewise-linear voice levels. The first hit snaps so a new genre does not shout. */
  private followIdle(hit: StepHit, primary: boolean, section: Section, c: Ctx) {
    const idle = hit.idle;
    const gains = idle
      ? { ...idle, bass: idle.bass * section.bass, pad: idle.pad * section.pad }
      : { kick: 1, snare: 1, hat: 1, glitch: 1, bass: section.bass, pad: section.pad, lead: 1, drone: 0 };
    const dur = Math.max(hit.duration, 1 / this.ctx.sampleRate);
    // Genres whose bass is their bed (drone) keep a floor so the song form never empties them.
    const bassFloor = this.era.id === "drone" ? 0.55 : 0;
    const padFloor = ["drone", "ambientidm", "dubtechno", "liquid", "futuregarage", "triphop"].includes(this.era.id) ? 0.8 : 0;
    this.glide(this.bus.kick.gain, "kick", gains.kick, hit.time, dur);
    this.glide(this.bus.snare.gain, "snare", gains.snare, hit.time, dur);
    this.glide(this.bus.hat.gain, "hat", gains.hat, hit.time, dur);
    this.glide(this.bus.perc.gain, "glitch", gains.glitch, hit.time, dur);
    this.glide(this.bus.bass.gain, "bass", Math.max(gains.bass, bassFloor * (idle ? idle.bass : 1)), hit.time, dur);
    this.glide(this.bus.harm.gain, "pad", Math.max(gains.pad, padFloor), hit.time, dur);
    this.glide(this.bus.lead.gain, "lead", gains.lead, hit.time, dur);
    this.idleReady = true;
    if (!primary) return;
    if (hit.recover) this.playFill(c);
    if (hit.drop?.land) this.playDrop(c);
    if (hit.trackDrop) this.trackImpact(c);
  }

  private glide(param: AudioParam, key: IdleVoice, to: number, time: number, dur: number) {
    const dest = Math.max(0.0001, Math.min(1, to));
    const from = Math.max(0.0001, this.idleNow[key]);
    if (!this.idleReady) {
      param.setValueAtTime(dest, Math.max(0, time));
      this.idleNow[key] = dest;
      this.idleSet[key] = Math.max(0, time);
      return;
    }
    if (Math.abs(dest - from) < 1e-4) {
      this.idleNow[key] = dest;
      return;
    }
    const rising = dest > from + 0.25;
    const seconds = rising ? 0.018 : dur;
    param.cancelScheduledValues(time);
    let start = time;
    const last = this.idleSet[key];
    if (last >= 0 && Math.abs(start - last) < 0.5 / this.ctx.sampleRate) start = last + 1 / this.ctx.sampleRate;
    param.setValueAtTime(from, start);
    param.linearRampToValueAtTime(dest, start + Math.max(seconds, 1 / this.ctx.sampleRate));
    this.idleSet[key] = start;
    this.idleNow[key] = dest;
  }

  /** Heat -> drop: the first downbeat of the new track. Each genre lands it in its own way. */
  private trackImpact(c: Ctx) {
    const t = c.t;
    const id = this.era.id;
    if (id === "drone") {
      // A deep swell with one glint over it: the drop arrives as weight, not as a sweep.
      this.droneSubSwell(c, 0.075);
      this.droneGlint(c, 72 + c.tonic, 0.02, 4.5);
      return;
    }
    const soft = id === "ambientidm";
    // Sub boom on the tonic: the one thing every genre shares. Dub techno's deep kick already lands there.
    this.toneHit(t, soft ? 0.32 : id === "dubtechno" ? 0.3 : 0.5, { type: "sine", freq: midiToFreq(c.low + 12) * 1.6, to: midiToFreq(c.low), sweep: 1.1, decay: soft ? 2.2 : 1.2, attack: soft ? 0.08 : 0.004, pan: 0, bus: this.busIn.fx });
    if (soft) {
      // A slow bloom instead of a crash.
      this.noiseHit(t, 0.06, { type: "lowpass", freq: 300, to: 2400, q: 0.7, decay: 2.4, attack: 0.6, pan: 0, bus: this.busIn.fx });
      return;
    }
    if (id === "dubtechno") {
      this.dubStab({ ...c, heat: 1 }, 1.1, "fx");
      return;
    }
    this.noiseHit(t, 0.18, { type: "highpass", freq: 2600, q: 0.7, decay: 1.6, pan: 0, bus: this.busIn.fx });
  }

  /** Short riser on the downbeat that ends a long pause. */
  private playFill(c: Ctx) {
    const dur = Math.min(0.85, Math.max(0.18, c.dur * 4));
    const soft = this.era.id === "ambientidm" || this.era.id === "drone";
    this.noiseHit(c.t, soft ? 0.06 : 0.14, { type: "lowpass", freq: 160, to: soft ? 900 : 2800, q: 0.7, decay: dur, attack: dur * 0.8, pan: 0, bus: this.busIn.fx });
  }

  /** Whale: a buy is a hit on the next downbeat (the new pattern is already in), a sell is a sweep down. */
  private playDrop(c: Ctx) {
    const drop = c.hit.drop;
    if (!drop) return;
    if (this.era.id === "drone") {
      // A buy is a soft sub bloom, a sell a dark breath falling away. No resonant sweep.
      if (drop.fill) this.droneSubSwell(c, 0.045);
      else this.noiseHit(c.t, 0.06, { type: "lowpass", freq: 900, to: 90, q: 0.7, decay: clamp(c.dur * 8, 0.4, 1.2), pan: 0, bus: this.busIn.fx });
      return;
    }
    const soft = this.era.id === "ambientidm";
    if (drop.fill) {
      if (this.era.id === "dubtechno") this.dubStab(c, 0.8, "fx");
      this.toneHit(c.t, soft ? 0.2 : this.era.id === "dubtechno" ? 0.26 : 0.42, { type: "sine", freq: 150, to: 42, sweep: 0.16, decay: soft ? 0.5 : 0.18, pan: 0, bus: this.busIn.fx });
      if (!soft) this.noiseHit(c.t, 0.16, { type: "highpass", freq: 1500, q: 0.7, decay: 0.03, pan: 0, bus: this.busIn.fx });
    } else {
      const dur = Math.min(0.7, Math.max(0.22, c.dur * 4));
      this.noiseHit(c.t, soft ? 0.08 : 0.18, { type: "lowpass", freq: 2400, to: 90, q: 6, decay: dur, pan: 0, bus: this.busIn.fx });
    }
  }
}

/**
 * Liquid DnB vamps over the tonic, one per epoch: pad voicing (semitones from the pad root) and the sub's
 * chord root (semitones from the bass tonic). i m9 against bVI maj9, iv m9 or bVII add9 (dorian).
 */
const LIQUID_VAMPS: readonly { a: { pad: number[]; root: number }; b: { pad: number[]; root: number } }[] = [
  { a: { pad: [0, 3, 7, 10, 14], root: 0 }, b: { pad: [-4, 0, 3, 7, 10], root: -4 } },
  { a: { pad: [0, 3, 7, 10, 14], root: 0 }, b: { pad: [-7, 3, 8, 12, 19], root: 5 } },
  { a: { pad: [0, 3, 7, 10, 14], root: 0 }, b: { pad: [-2, 2, 5, 9, 12], root: -2 } },
];

/** Liquid Keys chord stabs over four bars (64 sixteenths): a few short offbeat chords, never on a downbeat. */
const LIQUID_STABS: readonly { s: number; len: number; core: boolean }[][] = [
  [{ s: 14, len: 2, core: true }, { s: 22, len: 2, core: false }, { s: 38, len: 2, core: true }, { s: 54, len: 3, core: false }, { s: 59, len: 2, core: true }],
  [{ s: 6, len: 2, core: true }, { s: 27, len: 2, core: false }, { s: 38, len: 2, core: true }, { s: 46, len: 2, core: false }, { s: 62, len: 2, core: false }],
  [{ s: 11, len: 3, core: true }, { s: 30, len: 2, core: false }, { s: 43, len: 3, core: true }, { s: 59, len: 2, core: false }],
];
/** Liquid Keys answers: three notes in one bar (16ths), the last one held into the next bar. */
const LIQUID_ANSWERS: readonly { s: number; len: number }[][] = [
  [{ s: 2, len: 4 }, { s: 6, len: 4 }, { s: 10, len: 12 }],
  [{ s: 3, len: 3 }, { s: 6, len: 6 }, { s: 14, len: 10 }],
  [{ s: 0, len: 6 }, { s: 7, len: 3 }, { s: 10, len: 14 }],
];
/** Steps through the chord's tones (sorted, low to high), one per phrase note: gentle arcs, no leaps over two tones. */
const LIQUID_CONTOURS: readonly number[][] = [
  [2, 1, 0, 1, 2, 3, 2],
  [0, 1, 2, 1, 0, 1, 0],
  [3, 2, 1, 2, 1, 0, 1],
];

/** Lofi House chord stabs over two bars. */
const HOUSE_STABS: readonly { s: number; len: number; core: boolean }[][] = [
  [{ s: 0, len: 3, core: true }, { s: 6, len: 2, core: false }, { s: 10, len: 3, core: true }, { s: 16, len: 3, core: true }, { s: 22, len: 2, core: false }, { s: 26, len: 4, core: true }],
  [{ s: 2, len: 2, core: false }, { s: 6, len: 2, core: true }, { s: 10, len: 2, core: false }, { s: 14, len: 2, core: true }, { s: 18, len: 2, core: false }, { s: 22, len: 2, core: true }, { s: 26, len: 2, core: false }, { s: 30, len: 2, core: true }],
  [{ s: 0, len: 2, core: true }, { s: 3, len: 2, core: true }, { s: 8, len: 2, core: false }, { s: 11, len: 3, core: true }, { s: 16, len: 2, core: true }, { s: 19, len: 2, core: true }, { s: 24, len: 2, core: false }, { s: 27, len: 3, core: true }],
];

interface Acid303Note {
  degree: number;
  octave: number;
  /** 1 accent, 2 slide to the next occupied step, 4 density-dependent ornament. */
  flags: number;
  gate?: number;
}
// Each row is exactly 16 steps; roots, octave displacement, rests and accent/slide chains are composed.
const ACID_FLOOR_LINES: readonly (readonly (Acid303Note | null)[])[] = [
  [0, 0, 4, -1, 0, 2, 0, -1, 0, 0, 3, 4, -1, 2, 1, -1],
  [0, -1, 0, 4, 2, 0, -1, 1, 0, 4, 0, -1, 3, 2, 0, -1],
  [0, 4, 0, -1, 1, 0, 2, -1, 0, -1, 3, 0, 4, 2, 0, -1],
].map((row) => row.map((degree, s) => degree < 0 ? null : ({ degree, octave: s === 4 ? -1 : 0, flags: (s === 0 || s === 2 || s === 10 ? 1 : 0) | (s === 1 || s === 9 ? 2 : 0) | (s === 5 || s === 13 ? 4 : 0) })));

const ACID_HOUSE_LINES: readonly (readonly (Acid303Note | null)[])[] = [
  [0, 0, 0, 4, -1, 0, 3, 0, 0, 0, 4, 0, -1, 2, 0, 4],
  [0, 0, 4, 0, 0, -1, 0, 3, 0, 0, 4, 2, 0, -1, 3, 0],
  [0, 0, 0, 1, -1, 0, 4, 0, 0, 3, 0, 4, 0, -1, 2, 0],
].map((row) => row.map((degree, s) => degree < 0 ? null : ({ degree, octave: s === 6 ? -1 : 0, flags: (s === 2 || s === 3 || s === 8 || s === 10 || s === 11 ? 1 : 0) | (s === 1 || s === 2 || s === 9 || s === 10 ? 2 : 0) | (s === 5 || s === 13 ? 4 : 0) })));

const ACID_RUBBER_LINES: readonly (readonly (Acid303Note | null)[])[] = [
  [0, 4, 4, 0, 1, 0], [0, 2, 4, 3, 1, 0], [0, 1, 2, 4, 3, 0],
].map((degrees) => {
  const line: (Acid303Note | null)[] = new Array(16).fill(null);
  [0, 3, 6, 9, 12, 14].forEach((s, i) => {
    line[s] = { degree: degrees[i], octave: 0, flags: (i % 2 === 0 ? 2 : 0) | (i === 0 ? 1 : 0) | (s >= 12 ? 4 : 0), gate: s === 14 ? 0.75 : 2.65 };
  });
  return line;
});

/**
 * Future Garage harmony (Vocal Chops, Dark Sub): natural-minor 7th / 9th / 11th chords (Dark Sub sings plain triads) on the instance tonic.
 * All values are semitones from the tonic. `hook` holds only chord tones, so a figure on it can never clash.
 */
interface GarageChord {
  /** Sub root, folded down into the bass register. */
  bass: number;
  /** Pad / choir voicing over 48 + tonic. */
  pad: readonly number[];
  /** Five chord tones low to high for the vocal figures. */
  hook: readonly number[];
  /** The guide tone (3rd or 7th, the 6th on bVII) the counter-line holds, picked so the line moves by step. */
  guide: number;
  /** Dark Sub choir: a plain open triad over 48 + tonic, no 9ths and no seconds inside it, so the saws never rub. */
  dark: readonly number[];
}
const GARAGE_CHORDS: readonly GarageChord[] = [
  // 0: i m9
  { bass: 0, pad: [0, 3, 7, 10, 14], hook: [12, 14, 15, 19, 22], guide: 10, dark: [0, 7, 15] },
  // 1: bVI maj9
  { bass: 8, pad: [-4, 3, 7, 10, 12], hook: [12, 15, 19, 20, 22], guide: 7, dark: [3, 8, 12] },
  // 2: bIII maj7
  { bass: 3, pad: [-2, 3, 7, 10, 14], hook: [10, 14, 15, 19, 22], guide: 7, dark: [3, 10, 19] },
  // 3: iv m9
  { bass: 5, pad: [-7, 3, 7, 8, 12], hook: [12, 15, 17, 19, 20], guide: 8, dark: [5, 12, 20] },
  // 4: v m7 add11
  { bass: 7, pad: [-5, 2, 5, 10, 12], hook: [10, 12, 14, 17, 19], guide: 10, dark: [7, 14, 22] },
  // 5: bVII 6/9
  { bass: 10, pad: [-2, 5, 7, 12, 14], hook: [10, 12, 14, 17, 19], guide: 7, dark: [5, 10, 14] },
  // 6: i m11, stacked fourths
  { bass: 0, pad: [0, 5, 10, 15, 19], hook: [12, 15, 17, 19, 22], guide: 10, dark: [0, 7, 15] },
];

/** Vocal Chops progressions (indices into GARAGE_CHORDS), two bars a chord. Each one starts and ends on the tonic's chords. */
const GARAGE_CHOP_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 1, 2, 5], // i9 - bVImaj9 - bIIImaj7 - bVII6/9
  [0, 3, 1, 4], // i9 - iv9 - bVImaj9 - v11
  [1, 5, 6, 0], // bVImaj9 - bVII6/9 - i11 - i9
  [0, 4, 3, 5], // i9 - v11 - iv9 - bVII6/9
];

/** Dark Sub progressions, four bars a chord: the tonic against darker neighbours, never resolving far. */
const GARAGE_DARK_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 1], // i - bVI
  [0, 1, 0, 3], // i - bVI - i - iv
  [6, 1, 3, 5], // i - bVI - iv - bVII
];

/** Vowel formants (Hz) of a pitched-up voice: ah, oh, ee, oo. */
const GARAGE_VOWELS: readonly (readonly [number, number])[] = [[1000, 1450], [640, 1050], [420, 2300], [380, 850]];

/** Vocal Chops ghost snares over two bars, [step, velocity], played in order as far as the chain's ghosts reach. */
const GARAGE_SKIPS: readonly (readonly (readonly [number, number])[])[] = [
  [[7, 0.5], [27, 0.45], [15, 0.35], [9, 0.3], [23, 0.3], [30, 0.25], [13, 0.25]],
  [[11, 0.45], [25, 0.4], [3, 0.4], [29, 0.35], [15, 0.3], [19, 0.25]],
  [[9, 0.45], [23, 0.5], [6, 0.35], [27, 0.3], [31, 0.3], [14, 0.25]],
];

/** Dark Sub foley over two bars, [step, object 0..2], played in order as far as the density reaches. */
const GARAGE_FOLEY: readonly (readonly (readonly [number, number])[])[] = [
  [[3, 0], [22, 1], [9, 2], [27, 0], [14, 1], [30, 2], [6, 0]],
  [[6, 1], [19, 0], [11, 2], [25, 1], [30, 0], [2, 2]],
  [[10, 2], [26, 0], [3, 1], [15, 2], [21, 1], [29, 0]],
];

/**
 * Future Garage Rain Atmos vamps (pad semitones from the pad root, sub root from the bass tonic), every tone in the
 * note set: i m7 against III, the bVII under it, or v over the fifth.
 */
const GARAGE_VAMPS: readonly { a: { pad: number[]; root: number }; b: { pad: number[]; root: number } }[] = [
  { a: { pad: [0, 3, 7, 10, 15], root: 0 }, b: { pad: [3, 7, 10, 15, 19], root: 3 } },
  { a: { pad: [0, 7, 10, 15], root: 0 }, b: { pad: [-2, 3, 7, 10, 15], root: -2 } },
  { a: { pad: [0, 3, 7, 10, 12], root: 0 }, b: { pad: [-5, 3, 7, 10, 12], root: 7 } },
];

/** Future Garage Rain Atmos choir over two bars: short chops and swells that rise into a beat and cut. */
const GARAGE_CHOIRS: readonly { s: number; len: number; swell: boolean; core: boolean }[][] = [
  [
    { s: 2, len: 2, swell: false, core: true }, { s: 6, len: 2, swell: false, core: false }, { s: 8, len: 8, swell: true, core: true },
    { s: 18, len: 2, swell: false, core: true }, { s: 22, len: 1, swell: false, core: false }, { s: 23, len: 1, swell: false, core: false }, { s: 24, len: 8, swell: true, core: true },
  ],
  [
    { s: 4, len: 12, swell: true, core: true }, { s: 19, len: 2, swell: false, core: true }, { s: 22, len: 2, swell: false, core: false },
    { s: 26, len: 2, swell: false, core: true }, { s: 28, len: 4, swell: false, core: false },
  ],
  [
    { s: 0, len: 3, swell: false, core: true }, { s: 3, len: 3, swell: false, core: true }, { s: 10, len: 6, swell: true, core: false },
    { s: 16, len: 3, swell: false, core: true }, { s: 19, len: 3, swell: false, core: true }, { s: 26, len: 6, swell: true, core: true },
  ],
];

/** Future Garage Rain Atmos steel pan over two bars; a busier glitch tier plays further into the figure. */
const GARAGE_PANS: readonly { s: number; len: number }[][] = [
  [{ s: 3, len: 2 }, { s: 11, len: 3 }, { s: 6, len: 2 }, { s: 19, len: 2 }, { s: 24, len: 4 }, { s: 30, len: 2 }],
  [{ s: 2, len: 3 }, { s: 18, len: 3 }, { s: 10, len: 2 }, { s: 14, len: 2 }, { s: 27, len: 3 }, { s: 7, len: 1 }],
];

/** Future Garage rain: bright hiss and many small seeded droplets, with a few heavier drips. */
function garageRainBuffer(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 4);
  const buffer = ctx.createBuffer(1, n, sr);
  const data = buffer.getChannelData(0);
  const rnd = mulberry32(seed);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    lp = lp * 0.85 + w * 0.15;
    data[i] = (w - lp) * 0.22;
  }
  const drop = (count: number, f0: number, f1: number, l0: number, l1: number, a0: number) => {
    for (let k = 0; k < count; k++) {
      const len = Math.floor(l0 + rnd() * (l1 - l0));
      const at = Math.floor(rnd() * (n - len * 6));
      const f = f0 + rnd() * (f1 - f0);
      const amp = a0 * (0.15 + 0.85 * rnd() ** 3);
      for (let i = 0; i < len * 6; i++) data[at + i] += amp * Math.exp(-i / len) * Math.sin((2 * Math.PI * f * i) / sr);
    }
  };
  drop(640, 2200, 7000, 12, 60, 0.5);
  drop(14, 700, 1500, 120, 260, 0.35);
  return buffer;
}

/** Liquid Atmospheric lead line over four bars (64 sixteenths): few, long notes; non-core ones are passing notes. */
const LIQUID_ATMOS_PHRASES: readonly { s: number; len: number; core: boolean }[][] = [
  [{ s: 0, len: 12, core: true }, { s: 14, len: 2, core: false }, { s: 16, len: 14, core: true },
   { s: 32, len: 6, core: true }, { s: 38, len: 4, core: false }, { s: 42, len: 20, core: true }],
  [{ s: 6, len: 10, core: true }, { s: 22, len: 4, core: false }, { s: 26, len: 12, core: true },
   { s: 40, len: 2, core: false }, { s: 42, len: 6, core: true }, { s: 48, len: 14, core: true }],
  [{ s: 0, len: 22, core: true }, { s: 22, len: 2, core: false }, { s: 24, len: 8, core: false },
   { s: 32, len: 10, core: true }, { s: 42, len: 4, core: false }, { s: 46, len: 16, core: true }],
];
/** Velocity in ninths at index `i` of a drum lane ("." or past the end = rest). */
const lane = (s: string, i: number) => {
  const d = s.charCodeAt(i) - 48;
  return d > 0 && d <= 9 ? d / 9 : 0;
};

interface LiquidHat { hp: number; decay: number; metal: number; pan: number; q?: number; level: number }
/**
 * A liquid break over two bars (32 sixteenths), one lane per voice, a digit per 16th = velocity in ninths.
 * kick: digits under 5 are pickups (busy kick row only). snare: 7+ is a backbeat, less a flam. ghost: the chopped
 * break layer under the kit; 1-2 only with a busy chain or on the turn bar. hat: even 16ths are the hat, odd ones
 * the shaker (where the chain's hat row plays). open: open hat / tambourine accents.
 */
interface LiquidBreakLanes { kick: string; snare: string; ghost: string; hat: string; open: string }
interface LiquidKit {
  kick: KickSpec;
  kickLevel: number;
  snare: "keys" | "soft" | "soul";
  snareLevel: number;
  ghostLevel: number;
  hat: LiquidHat;
  shaker: LiquidHat;
  open: LiquidHat;
  crash: number;
  breaks: readonly LiquidBreakLanes[];
}
const LIQUID_BACKBEAT = "....9.......9.......9.......9...";
const LIQUID_KITS: Record<"classic" | "atmos" | "soulful", LiquidKit> = {
  // Keys: a crisp two-step, tight kick with a click, bright snare, 8th hats with offbeat accents.
  classic: {
    kick: { start: 172, end: 50, sweep: 0.032, decay: 0.22, click: 0.6, clickHp: 3000, body: 1.1, drive: 1.3 },
    kickLevel: 1.1,
    snare: "keys",
    snareLevel: 1.45,
    ghostLevel: 0.42,
    hat: { hp: 8200, decay: 0.03, metal: 0.4, pan: 0.2, level: 0.5 },
    shaker: { hp: 9500, decay: 0.018, metal: 0, pan: -0.35, level: 0.35 },
    open: { hp: 6500, decay: 0.16, metal: 0.8, pan: 0.35, q: 1.2, level: 0.32 },
    crash: 0.2,
    breaks: [
      { kick: "9.........8.....9.........8..4..", snare: LIQUID_BACKBEAT, ghost: ".......3.2....2....2...3.2....3.", hat: "52724273527242735272427352724273", open: "..............................6." },
      { kick: "9.........8.....9.4.......8.....", snare: LIQUID_BACKBEAT, ghost: "..2....3......3........3.2.3...2", hat: "52724273527242735272427352724273", open: "..............6..............5.." },
    ],
  },
  // Atmospheric: a round low kick, a soft roomy snare in a Good Looking shuffle of ghosts, a jazz ride.
  atmos: {
    kick: { start: 132, end: 46, sweep: 0.045, decay: 0.28, click: 0.25, clickHp: 2000, body: 1.05 },
    kickLevel: 1.05,
    snare: "soft",
    snareLevel: 1.35,
    ghostLevel: 0.5,
    hat: { hp: 5000, decay: 0.22, metal: 1, pan: 0.3, q: 1.6, level: 0.26 },
    shaker: { hp: 9500, decay: 0.016, metal: 0, pan: -0.35, level: 0.22 },
    open: { hp: 5000, decay: 0.3, metal: 1, pan: 0.3, q: 1.6, level: 0.2 },
    crash: 0.14,
    breaks: [
      { kick: "9.........7.....9.........7..5..", snare: LIQUID_BACKBEAT, ghost: ".......3.2.....3...2...3.2....3.", hat: "62426242624262426242624262426242", open: "" },
      { kick: "9.........7.....9.....5...7.....", snare: LIQUID_BACKBEAT, ghost: ".......3.2.....3...2...3.2....3.", hat: "62426242624262426242624262426242", open: "" },
    ],
  },
  // Soulful: a rolling, Think-style break, heavy ghosts, shaker 16ths and a tambourine on the backbeat.
  soulful: {
    kick: { start: 150, end: 48, sweep: 0.04, decay: 0.25, click: 0.4, clickHp: 2400, body: 1.1, drive: 1.15 },
    kickLevel: 1.1,
    snare: "soul",
    snareLevel: 1.4,
    ghostLevel: 0.5,
    hat: { hp: 6800, decay: 0.035, metal: 0, pan: 0.25, q: 1.1, level: 0.42 },
    shaker: { hp: 8800, decay: 0.02, metal: 0, pan: -0.25, level: 0.3 },
    open: { hp: 7600, decay: 0.075, metal: 0.9, pan: 0.35, q: 2.2, level: 0.3 },
    crash: 0.16,
    breaks: [
      { kick: "9......5..8.....9.....6...8.....", snare: LIQUID_BACKBEAT, ghost: "..2..3.4.3...2.3..3.2..4.3.2..43", hat: "42634263426342634263426342634263", open: "....6.......6.......6.......6..." },
      { kick: "9.........8...5.9.......5.8.....", snare: LIQUID_BACKBEAT, ghost: ".....3.4..2..3.3..2..3.4.3....4.", hat: "42634263426342634263426342634263", open: "....6.......6.......6.......6..." },
    ],
  },
};
/** Fills for the second half of every eighth bar (steps 8-15): the backbeat stays on 12, the snare rolls out. */
const LIQUID_FILLS: readonly { kick: string; snare: string }[] = [
  { kick: "..8.....", snare: "..4.9.68" },
  { kick: "..8.....", snare: "4.5.9575" },
  { kick: "..8..6..", snare: "...59.79" },
];
/** Sub level per liquid style: under the break, not over it. */
const LIQUID_SUB = { classic: 0.62, atmos: 0.5, soulful: 0.62 } as const;

/**
 * Soulful progressions, two bars a chord: rootless voicings (semitones over the pad root, low to high, no second
 * between any two voices) over the sub's root (semitones over the bass tonic). The top voice moves by step.
 * i m9 · iv m9 · bIII maj9 · bVI maj9 / i m9 · bVI maj9 · bVII · v m7 / i m9 · iv m9 · v m7 · bVI maj9.
 */
const LIQUID_SOUL_PROGS: readonly { pad: number[]; root: number }[][] = [
  [{ pad: [3, 7, 10, 14], root: 0 }, { pad: [-4, 0, 3, 7, 12], root: 5 }, { pad: [-5, -2, 2, 5, 10], root: 3 }, { pad: [0, 3, 7, 10], root: -4 }],
  [{ pad: [3, 7, 10, 14], root: 0 }, { pad: [0, 3, 7, 10], root: -4 }, { pad: [2, 5, 10, 14], root: -2 }, { pad: [-5, -2, 2, 5, 10], root: 7 }],
  [{ pad: [3, 7, 10, 14], root: 0 }, { pad: [-4, 0, 3, 7, 12], root: 5 }, { pad: [-5, -2, 2, 5, 10], root: 7 }, { pad: [0, 3, 7, 10], root: -4 }],
];
/** Soulful sub walks over one chord (two bars): onset, length (16ths), octave up, core (plays when the chain is quiet). */
const LIQUID_SOUL_BASS: readonly { s: number; len: number; oct: number; core: boolean }[][] = [
  [{ s: 0, len: 6, oct: 0, core: true }, { s: 6, len: 4, oct: 0, core: false }, { s: 10, len: 6, oct: 0, core: true }, { s: 16, len: 4, oct: 0, core: true },
   { s: 20, len: 2, oct: 1, core: false }, { s: 22, len: 4, oct: 0, core: true }, { s: 26, len: 4, oct: 1, core: false }, { s: 30, len: 2, oct: 0, core: false }],
  [{ s: 0, len: 10, oct: 0, core: true }, { s: 10, len: 4, oct: 0, core: true }, { s: 14, len: 2, oct: 1, core: false },
   { s: 16, len: 6, oct: 0, core: true }, { s: 22, len: 2, oct: 1, core: false }, { s: 26, len: 6, oct: 0, core: true }],
  [{ s: 0, len: 7, oct: 0, core: true }, { s: 7, len: 3, oct: 1, core: false }, { s: 10, len: 6, oct: 0, core: true }, { s: 16, len: 3, oct: 0, core: true },
   { s: 19, len: 3, oct: 0, core: false }, { s: 22, len: 8, oct: 0, core: true }, { s: 30, len: 2, oct: 1, core: false }],
];
/** Soulful Rhodes comping over one chord (two bars). A hit on 30 is pushed: it plays the next chord early. */
const LIQUID_SOUL_COMP: readonly { s: number; len: number; core: boolean }[][] = [
  [{ s: 0, len: 14, core: true }, { s: 19, len: 2, core: false }, { s: 22, len: 3, core: true }, { s: 27, len: 2, core: false }],
  [{ s: 6, len: 2, core: false }, { s: 11, len: 3, core: true }, { s: 22, len: 2, core: false }, { s: 30, len: 14, core: true }],
  [{ s: 0, len: 10, core: true }, { s: 14, len: 2, core: false }, { s: 20, len: 8, core: true }],
];

/** Cinematic: the tonic minor seventh over its root, then over the falling b7 in the bass. The second voicing is
 * open (b7 4th 3rd 4th), so the saw strings and the piano never sit on a low whole-step cluster. */
const TRIPHOP_VOICINGS = [
  { pad: [0, 3, 7, 10], root: 0 },
  { pad: [-2, 3, 7, 12], root: 10 },
] as const;

/** Rhodes Break chords, semitones over the tonic: bass root and two hand-checked voicings (no minor second,
 * tritone or major seventh between any two voices or against the root). Voicings sit on c.low + 24. */
interface TripHopChord {
  root: number;
  voice: readonly number[];
  alt: readonly number[];
}
const TRIPHOP_RHODES_CHORDS: Record<string, TripHopChord> = {
  i: { root: 0, voice: [-2, 3, 7, 12], alt: [3, 7, 10, 15] },
  iv: { root: 5, voice: [0, 3, 8, 12], alt: [3, 8, 12, 17] },
  VI: { root: 8, voice: [-2, 3, 8, 12], alt: [3, 8, 12, 15] },
  VII: { root: 10, voice: [-2, 2, 5, 10], alt: [2, 5, 10, 14] },
  v: { root: 7, voice: [-2, 2, 7, 10], alt: [2, 7, 10, 14] },
  /** Dorian major IV (Massive Attack): F A C over the F root. */
  IV: { root: 5, voice: [0, 5, 9, 12], alt: [5, 9, 12, 17] },
};

/** Two bars per chord, eight-bar phrases. All aeolian except the last (dorian IV). */
const TRIPHOP_RHODES_PROGRESSIONS: readonly (readonly string[])[] = [
  ["i", "iv", "i", "VI"],
  ["i", "VI", "iv", "v"],
  ["i", "VII", "VI", "iv"],
  ["i", "IV", "i", "VII"],
];

/** Rhodes figures over one chord (two bars, steps 0..31): "C" whole voicing, "U"/"L" top/bottom pair, n one voice. */
type TripHopKeys = readonly { s: number; len: number; p: "C" | "U" | "L" | number; opt?: boolean }[];
const TRIPHOP_RHODES_STATEMENTS: readonly TripHopKeys[] = [
  [{ s: 0, len: 12, p: "C" }, { s: 14, len: 2, p: "U", opt: true }, { s: 18, len: 10, p: "C" }],
  [{ s: 2, len: 8, p: "C" }, { s: 10, len: 3, p: "L", opt: true }, { s: 20, len: 4, p: "U" }, { s: 24, len: 6, p: "C" }],
  [{ s: 0, len: 6, p: "C" }, { s: 6, len: 4, p: "U" }, { s: 16, len: 14, p: "C" }],
];
/** Answers: the chord, then a short top line on its upper voices. */
const TRIPHOP_RHODES_ANSWERS: readonly TripHopKeys[] = [
  [{ s: 0, len: 14, p: "C" }, { s: 16, len: 3, p: 3 }, { s: 19, len: 3, p: 2 }, { s: 22, len: 8, p: 3 }],
  [{ s: 0, len: 7, p: "C" }, { s: 8, len: 2, p: 1 }, { s: 10, len: 2, p: 2 }, { s: 12, len: 6, p: 3 }, { s: 24, len: 6, p: "U" }],
  [{ s: 2, len: 12, p: "C" }, { s: 18, len: 2, p: 2, opt: true }, { s: 20, len: 10, p: 3 }],
];
/** Turns: an arpeggio falling or rising through the voicing into the next phrase. */
const TRIPHOP_RHODES_TURNS: readonly TripHopKeys[] = [
  [{ s: 0, len: 10, p: "C" }, { s: 16, len: 6, p: "C" }, { s: 24, len: 2, p: 3 }, { s: 26, len: 2, p: 2 }, { s: 28, len: 2, p: 1 }, { s: 30, len: 1.5, p: 0 }],
  [{ s: 0, len: 16, p: "C" }, { s: 22, len: 2, p: 0, opt: true }, { s: 26, len: 2, p: 1 }, { s: 28, len: 2, p: 2 }, { s: 30, len: 1.5, p: 3 }],
];
/** Intro and breakdown: one long chord, a single top note late in the second bar. */
const TRIPHOP_RHODES_SPACE: readonly TripHopKeys[] = [
  [{ s: 0, len: 22, p: "C" }, { s: 26, len: 5, p: 3 }],
  [{ s: 2, len: 26, p: "C" }],
];

/** Space between the calls matters as much as the theremin notes. No market-driven pitch choices. */
const TRIPHOP_BRISTOL_CALLS = [
  [{ s: 2, semi: 7, len: 6 }, { s: 22, semi: 3, len: 4 }, { s: 28, semi: 0, len: 3 }],
  [{ s: 2, semi: 10, len: 6 }, { s: 20, semi: 7, len: 5 }, { s: 28, semi: 0, len: 3 }],
] as const;

const TRIPHOP_PIANO_CUTS = [
  { s: 0, len: 5, core: true }, { s: 6, len: 2, core: false }, { s: 10, len: 3, core: true },
  { s: 16, len: 6, core: true }, { s: 23, len: 1.5, core: false }, { s: 26, len: 5, core: true },
] as const;

/**
 * Lofi House "Sample Chop" loops over two bars: onsets, lengths in sixteenths, which slice of the chord sample
 * (0 full chord, 1 its top, 2 the top an octave up, 3 low root and fifth). `core` slices play in a quiet market.
 */
const LOFIHOUSE_CHOPS: readonly { s: number; len: number; slice: number; core: boolean }[][] = [
  // Ross From Friends: a syncopated loop, top slices answering on the "e"s.
  [
    { s: 0, len: 2, slice: 0, core: true }, { s: 3, len: 1, slice: 1, core: false }, { s: 4, len: 2, slice: 0, core: true },
    { s: 7, len: 1, slice: 2, core: false }, { s: 10, len: 2, slice: 0, core: true }, { s: 12, len: 1, slice: 3, core: false },
    { s: 14, len: 2, slice: 1, core: true }, { s: 16, len: 3, slice: 0, core: true }, { s: 19, len: 1, slice: 2, core: false },
    { s: 22, len: 2, slice: 0, core: true }, { s: 24, len: 1, slice: 3, core: false }, { s: 26, len: 2, slice: 0, core: true },
    { s: 28, len: 1, slice: 2, core: false }, { s: 29, len: 1, slice: 2, core: false }, { s: 30, len: 2, slice: 1, core: true },
  ],
  // DJ Seinfeld: offbeat chops riding the pump, a held slice before each bar line.
  [
    { s: 2, len: 2, slice: 0, core: true }, { s: 6, len: 2, slice: 0, core: true }, { s: 9, len: 1, slice: 2, core: false },
    { s: 10, len: 2, slice: 0, core: true }, { s: 13, len: 3, slice: 1, core: true }, { s: 18, len: 2, slice: 0, core: true },
    { s: 22, len: 2, slice: 0, core: true }, { s: 25, len: 1, slice: 2, core: false }, { s: 26, len: 2, slice: 0, core: true },
    { s: 28, len: 1, slice: 3, core: false }, { s: 29, len: 3, slice: 1, core: true },
  ],
  // Stutter: a slice retriggered on 16ths, then let ring.
  [
    { s: 0, len: 1, slice: 0, core: true }, { s: 1, len: 1, slice: 0, core: false }, { s: 2, len: 3, slice: 0, core: true },
    { s: 6, len: 2, slice: 1, core: true }, { s: 8, len: 1, slice: 2, core: false }, { s: 10, len: 3, slice: 0, core: true },
    { s: 14, len: 2, slice: 3, core: false }, { s: 16, len: 1, slice: 0, core: true }, { s: 17, len: 1, slice: 0, core: false },
    { s: 18, len: 3, slice: 0, core: true }, { s: 22, len: 2, slice: 1, core: true }, { s: 25, len: 1, slice: 2, core: false },
    { s: 26, len: 2, slice: 0, core: true }, { s: 28, len: 1, slice: 1, core: false }, { s: 29, len: 3, slice: 2, core: true },
  ],
];

/** Lofi House "Raw Rave" piano stabs over two bars (lengths in sixteenths): piano-house syncopation. */
const LOFIHOUSE_RAVE_STABS: readonly { s: number; len: number; core: boolean }[][] = [
  [
    { s: 0, len: 2, core: true }, { s: 3, len: 2, core: true }, { s: 6, len: 2, core: false }, { s: 10, len: 2, core: true },
    { s: 13, len: 3, core: false }, { s: 16, len: 2, core: true }, { s: 19, len: 2, core: true }, { s: 22, len: 3, core: true },
    { s: 27, len: 1, core: false }, { s: 28, len: 3, core: true },
  ],
  [
    { s: 2, len: 2, core: true }, { s: 5, len: 1, core: false }, { s: 8, len: 3, core: true }, { s: 14, len: 2, core: true },
    { s: 18, len: 2, core: true }, { s: 21, len: 1, core: false }, { s: 24, len: 3, core: true }, { s: 30, len: 2, core: true },
  ],
  [
    { s: 0, len: 3, core: true }, { s: 4, len: 1, core: false }, { s: 6, len: 2, core: true }, { s: 11, len: 3, core: true },
    { s: 16, len: 2, core: true }, { s: 18, len: 2, core: true }, { s: 20, len: 1, core: false }, { s: 22, len: 4, core: true },
    { s: 28, len: 1, core: false }, { s: 29, len: 2, core: true },
  ],
];

/**
 * Ambient IDM harmony. The genre note set is the minor pentatonic (0 3 5 7 10), so every chord is a sus /
 * add9 / quartal colour built only from it: i m7, bIII add9, bVII 6/9sus4, iv 9sus4, i m11 (quartal).
 * All values are semitones from the tonic; every pitch class is a genre note.
 */
interface AmbientChord {
  /** Root for the bass, near the tonic. */
  bass: number;
  /** Pad voicing over 48 + tonic (Tape Keys, Tape Haze takes the part at and above the root). */
  pad: readonly number[];
  /** Crystal glass-bed voicing over 60 + tonic. */
  glass: readonly number[];
  /** The four chord tones low to high, for figures and arps. */
  arp: readonly number[];
  /** Melody tones by role: [3rd (or 4th), 5th, colour (9th / 11th / 6th), root, 7th (or 6th)]. */
  sing: readonly number[];
}
const AMBIENT_CHORDS: readonly AmbientChord[] = [
  // 0: i m7
  { bass: 0, pad: [-12, 0, 7, 10, 15], glass: [0, 7, 12, 15, 24], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] },
  // 1: bIII add9
  { bass: 3, pad: [-9, 3, 10, 17, 19], glass: [3, 10, 15, 19, 29], arp: [3, 7, 10, 15], sing: [7, 10, 5, 3, 12] },
  // 2: bVII 6/9sus4
  { bass: -2, pad: [-14, 5, 10, 12, 19], glass: [-2, 5, 10, 12, 19], arp: [-2, 3, 5, 10], sing: [3, 5, 12, 10, 7] },
  // 3: iv 9sus4
  { bass: 5, pad: [-7, 5, 12, 15, 19], glass: [5, 12, 15, 19, 22], arp: [5, 10, 12, 15], sing: [10, 12, 7, 5, 15] },
  // 4: i m11, stacked fourths
  { bass: 0, pad: [-12, 0, 5, 10, 15, 19], glass: [0, 5, 10, 15, 19], arp: [0, 5, 10, 15], sing: [3, 7, 5, 0, 10] },
];

/** Progressions (indices into AMBIENT_CHORDS), one per epoch and style, four bars a chord. */
const AMBIENT_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 1, 3, 4], // i - bIII - iv - i11
  [0, 2, 1, 3], // i - bVII - bIII - iv
  [0, 3], // i - iv, the Xtal vamp
  [1, 3, 0, 4], // bIII - iv - i - i11
  [0, 4, 2, 1], // i - i11 - bVII - bIII
];

/**
 * Tape Keys ostinati over two bars: [step 0..31, arp tone (ambientArpTone), density tier].
 * Tier 0 always plays, 1 and 2 join as the chain gets busier. Broken-chord figures, Xtal / Ageispolis.
 */
const AMBIENT_KEYS_FIGURES: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 0, 0], [6, 2, 0], [12, 3, 1], [16, 1, 0], [22, 2, 0], [28, 3, 2]],
  [[0, 1, 0], [4, 2, 0], [8, 3, 0], [12, 4, 1], [20, 3, 2], [24, 2, 1]],
  [[0, 2, 0], [4, 0, 2], [8, 1, 0], [12, 4, 1], [16, 2, 0], [24, 3, 0], [28, 1, 2]],
  [[0, 3, 0], [6, 0, 2], [10, 1, 0], [16, 2, 0], [26, 1, 1]],
];

/**
 * Tape Haze phrases over eight bars: [step 0..127, sing role, length in 16ths, octave, density tier].
 * Few long notes per four bars and whole bars of rest; the chord under them changes at step 64.
 */
const AMBIENT_HAZE_PHRASES: readonly (readonly (readonly [number, number, number, number, number])[])[] = [
  [[0, 1, 14, 0, 0], [16, 0, 12, 0, 0], [30, 2, 2, 0, 2], [48, 2, 14, 0, 0], [64, 0, 14, 0, 0], [80, 1, 10, 0, 0], [92, 2, 4, 0, 1], [96, 0, 20, 0, 0]],
  [[8, 2, 8, 0, 0], [16, 0, 24, 0, 0], [44, 3, 4, 0, 1], [48, 1, 12, 0, 0], [72, 2, 8, 0, 0], [80, 0, 24, 0, 0], [108, 4, 4, 0, 2], [112, 1, 14, 0, 0]],
  [[0, 3, 4, 0, 1], [4, 1, 26, 0, 0], [40, 0, 8, 0, 0], [48, 2, 16, 0, 0], [68, 1, 26, 0, 0], [100, 0, 8, 0, 2], [104, 2, 18, 0, 0]],
  [[0, 0, 20, 0, 0], [24, 2, 6, 0, 1], [32, 1, 16, 0, 0], [64, 2, 20, 0, 0], [88, 0, 6, 0, 1], [96, 3, 16, 1, 0]],
];

/**
 * Crystal arp cells: indices into the chord's tones over two octaves (0-3, 4-7 an octave up, 8 the root
 * two octaves up). Lengths 6, 8, 10, 12 and 16 cycle against the bar, Amber-style.
 */
const AMBIENT_CRYSTAL_ARPS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7],
  [0, 4, 1, 5, 2, 6, 3, 7],
  [2, 3, 4, 6, 7, 4, 5, 1, 3, 6],
  [0, 1, 2, 4, 5, 6],
];

/**
 * Electro / Client_03. Chords: `bass` is the root in semitones from the bass tonic; `third` and `seventh` say
 * which third and seventh the bass may use over it (all in the natural minor); `pad` is the ghost voicing.
 */
interface ClientChord {
  bass: number;
  third: number;
  seventh: number;
  pad: readonly number[];
}

/** i, bVI, iv, v, bVII, bIII. Open, consonant voicings that share tones, so the pad drifts rather than changes. */
const CLIENT_CHORDS: readonly ClientChord[] = [
  { bass: 0, third: 3, seventh: 10, pad: [0, 7, 15] },
  { bass: -4, third: 4, seventh: 11, pad: [0, 8, 15] },
  { bass: 5, third: 3, seventh: 10, pad: [0, 8, 17] },
  { bass: -5, third: 3, seventh: 10, pad: [2, 10, 19] },
  { bass: -2, third: 4, seventh: 10, pad: [2, 10, 17] },
  { bass: 3, third: 4, seventh: 11, pad: [3, 10, 19] },
];

/** Four-chord progressions (two bars a chord), indices into CLIENT_CHORDS. One per epoch. */
const CLIENT_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 1, 0, 2],
  [0, 3, 1, 4],
  [0, 0, 2, 3],
  [0, 5, 1, 4],
];

/** Two-bar kick figures (a: even bar, b: odd bar). Syncopated electro, never four-on-the-floor; the b bar limps. */
const CLIENT_KICK_HALF: readonly { a: readonly number[]; b: readonly number[] }[] = [{ a: [0], b: [0, 10] }];
const CLIENT_KICK_LO: readonly { a: readonly number[]; b: readonly number[] }[] = [
  { a: [0, 10], b: [0, 7, 10] },
  { a: [0, 6, 10], b: [0, 10] },
];
const CLIENT_KICK_MID: readonly { a: readonly number[]; b: readonly number[] }[] = [
  { a: [0, 3, 10], b: [0, 6, 10, 14] },
  { a: [0, 7, 10], b: [0, 3, 6, 11] },
  { a: [0, 6, 10, 11], b: [0, 10, 13] },
];
const CLIENT_KICK_HI: readonly { a: readonly number[]; b: readonly number[] }[] = [
  { a: [0, 3, 6, 10, 14], b: [0, 6, 7, 10, 13] },
  { a: [0, 3, 7, 10, 11], b: [0, 2, 6, 10, 14] },
];

/** Ghost-snare funk figures over two bars: onset, level, core (plays even on a quiet chain). Never on 2 and 4. */
const CLIENT_GHOSTS: readonly { s: number; vel: number; core: boolean }[][] = [
  [
    { s: 7, vel: 0.35, core: true }, { s: 9, vel: 0.25, core: false }, { s: 15, vel: 0.3, core: true },
    { s: 23, vel: 0.35, core: true }, { s: 25, vel: 0.25, core: false }, { s: 30, vel: 0.3, core: false }, { s: 31, vel: 0.22, core: false },
  ],
  [
    { s: 3, vel: 0.3, core: true }, { s: 10, vel: 0.28, core: false }, { s: 14, vel: 0.33, core: true },
    { s: 19, vel: 0.3, core: false }, { s: 22, vel: 0.35, core: true }, { s: 27, vel: 0.25, core: false }, { s: 31, vel: 0.3, core: true },
  ],
  [
    { s: 6, vel: 0.3, core: false }, { s: 9, vel: 0.32, core: true }, { s: 11, vel: 0.22, core: false },
    { s: 25, vel: 0.32, core: true }, { s: 27, vel: 0.24, core: false }, { s: 29, vel: 0.3, core: true },
  ],
];

/** Per-step slice pitch of the break hats (multiplies the highpass): the warp of a resampled loop. */
const CLIENT_HAT_WARP: readonly (readonly number[])[] = [
  [1, 0.86, 1.12, 0.9, 1, 0.8, 1.2, 0.92, 1.05, 0.86, 1.15, 0.88, 1, 0.82, 1.22, 0.95],
  [1.1, 0.9, 1, 0.84, 1.18, 0.92, 0.78, 1, 1.1, 0.9, 1.02, 0.8, 1.16, 0.9, 0.76, 1.05],
  [0.95, 1.08, 0.85, 1.15, 0.95, 1.05, 1.25, 0.82, 0.95, 1.1, 0.85, 1.12, 0.95, 1.02, 1.22, 0.8],
];

/** The open slice and the chop steps (stuttered in 32nds) per epoch. */
const CLIENT_HAT_CHOPS: readonly { open: number; steps: readonly number[] }[] = [
  { open: 14, steps: [7, 15] },
  { open: 6, steps: [11, 15] },
  { open: 10, steps: [3, 13] },
];

/**
 * Bass figures over two bars: onset, semitones over the chord root (3 and 10 follow the chord's third and
 * seventh), length in steps, flags. Flags: 1 core/accent, 2 slide in from the previous note,
 * 4 ornament (busy chain only), 8 dead note (muted, no sub). Rests are the funk.
 */
const CLIENT_BASS: readonly { s: number; semi: number; len: number; f: number }[][] = [
  [
    { s: 0, semi: 0, len: 3, f: 1 }, { s: 3, semi: 0, len: 1, f: 8 }, { s: 4, semi: 12, len: 1, f: 0 },
    { s: 6, semi: 0, len: 2, f: 1 }, { s: 9, semi: 7, len: 1, f: 0 }, { s: 10, semi: 10, len: 2, f: 2 },
    { s: 13, semi: 0, len: 1, f: 12 }, { s: 14, semi: 12, len: 1, f: 1 },
    { s: 16, semi: 0, len: 2, f: 1 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 20, semi: 3, len: 1, f: 4 },
    { s: 22, semi: 7, len: 2, f: 1 }, { s: 25, semi: 12, len: 1, f: 0 }, { s: 26, semi: 10, len: 1, f: 2 },
    { s: 27, semi: 7, len: 2, f: 4 }, { s: 30, semi: 0, len: 1, f: 8 },
  ],
  [
    { s: 0, semi: 0, len: 2, f: 1 }, { s: 2, semi: 0, len: 1, f: 8 }, { s: 5, semi: 12, len: 1, f: 1 },
    { s: 7, semi: 0, len: 2, f: 0 }, { s: 11, semi: 0, len: 1, f: 8 }, { s: 12, semi: 10, len: 1, f: 4 },
    { s: 13, semi: 12, len: 2, f: 2 },
    { s: 16, semi: 0, len: 3, f: 1 }, { s: 21, semi: 12, len: 1, f: 1 }, { s: 22, semi: 10, len: 1, f: 2 },
    { s: 23, semi: 7, len: 2, f: 0 }, { s: 27, semi: 0, len: 1, f: 8 }, { s: 28, semi: 3, len: 2, f: 4 },
    { s: 30, semi: 0, len: 1, f: 1 },
  ],
  [
    { s: 0, semi: 0, len: 4, f: 1 }, { s: 6, semi: 0, len: 1, f: 0 }, { s: 7, semi: 12, len: 1, f: 8 },
    { s: 10, semi: 7, len: 3, f: 1 }, { s: 14, semi: 0, len: 1, f: 12 },
    { s: 16, semi: 0, len: 2, f: 1 }, { s: 18, semi: 12, len: 1, f: 0 }, { s: 19, semi: 10, len: 1, f: 2 },
    { s: 22, semi: 0, len: 2, f: 1 }, { s: 26, semi: 7, len: 1, f: 4 }, { s: 27, semi: 10, len: 1, f: 6 },
    { s: 28, semi: 12, len: 3, f: 1 },
  ],
  [
    { s: 0, semi: 0, len: 2, f: 1 }, { s: 3, semi: 0, len: 1, f: 8 }, { s: 5, semi: 0, len: 1, f: 12 },
    { s: 6, semi: 7, len: 2, f: 1 }, { s: 9, semi: 10, len: 1, f: 0 }, { s: 10, semi: 12, len: 2, f: 2 },
    { s: 14, semi: 7, len: 1, f: 4 },
    { s: 16, semi: 0, len: 3, f: 1 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 22, semi: 12, len: 1, f: 1 },
    { s: 23, semi: 10, len: 1, f: 2 }, { s: 24, semi: 7, len: 2, f: 0 }, { s: 27, semi: 3, len: 1, f: 4 },
    { s: 28, semi: 0, len: 3, f: 3 },
  ],
];

/** Computer-voice words: onset step and syllables as [F1, F2, consonant] (formants in Hz, jumped, not glided). */
interface ClientWord {
  s: number;
  syl: readonly (readonly [number, number, "k" | "t" | "p" | "s" | null])[];
}
const CLIENT_WORDS: readonly ClientWord[] = [
  { s: 2, syl: [[570, 840, "k"], [300, 870, "p"], [490, 1350, "t"]] },
  { s: 10, syl: [[530, 1840, null], [530, 1840, "k"], [570, 840, "t"]] },
  { s: 8, syl: [[270, 2290, "s"], [530, 1840, "t"]] },
  { s: 4, syl: [[300, 870, null], [270, 2290, "t"]] },
];

/** Alien Rave chords: `bass` is the root in semitones from the bass tonic, `tones` the stab voicing from the tonic. */
interface AlienChord {
  bass: number;
  tones: readonly number[];
}

/** i, bII, bVI, bVII, iv, i7. Minor with a phrygian b2 for the menace; the majors are the rave lift. */
const ALIEN_CHORDS: readonly AlienChord[] = [
  { bass: 0, tones: [0, 7, 12, 15] },
  { bass: 1, tones: [1, 8, 13, 17] },
  { bass: -4, tones: [-4, 3, 8, 12] },
  { bass: -2, tones: [-2, 5, 10, 14] },
  { bass: -7, tones: [5, 8, 12, 17] },
  { bass: 0, tones: [0, 7, 10, 15] },
];

/** Four-bar progressions, indices into ALIEN_CHORDS. One per epoch. */
const ALIEN_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 0, 2, 3],
  [0, 1, 0, 1],
  [0, 5, 2, 1],
  [0, 0, 4, 3],
  [0, 2, 3, 1],
];

/** Kick figures. Syncopated electro break; beat 2 (step 4) never gets a kick, so it is never four-on-the-floor. */
const ALIEN_KICK_HALF: readonly (readonly number[])[] = [[0, 10]];
const ALIEN_KICK_LO: readonly (readonly number[])[] = [
  [0, 7, 10],
  [0, 6, 11],
  [0, 10, 13],
];
const ALIEN_KICK_MID: readonly (readonly number[])[] = [
  [0, 3, 7, 10],
  [0, 6, 9, 11],
  [0, 7, 10, 13],
  [0, 3, 6, 10],
];
const ALIEN_KICK_HI: readonly (readonly number[])[] = [
  [0, 3, 6, 9, 11, 14],
  [0, 3, 7, 10, 11, 14],
  [0, 2, 6, 7, 10, 13],
];

/** Open-hat accents per epoch. */
const ALIEN_OPEN_HATS: readonly (readonly number[])[] = [[6, 14], [2, 10], [14], [10, 15]];

/**
 * 16th bass lines: [semitones over the chord root, flags] or a rest. Flags: 1 accent, 2 slide into the next,
 * 4 ornament (only on a busy chain). Lines of 6 and 10 steps run against the bar and phase over it.
 */
const ALIEN_BASS: readonly (readonly (readonly [number, number] | null)[])[] = [
  [[0, 1], [0, 4], [12, 0], [0, 0], null, [0, 0], [12, 1], [0, 4], [0, 1], [0, 4], [10, 0], [0, 0], [12, 2], [7, 0], [0, 1], [12, 4]],
  [[0, 1], null, [0, 0], [12, 0], [0, 4], [0, 0], [7, 1], null, [0, 0], [12, 1], [0, 0], [10, 4], [0, 0], [12, 2], [7, 0], [0, 4]],
  [[0, 1], [0, 0], null, [0, 0], [12, 1], [0, 0], null, [0, 0], [0, 1], [0, 0], null, [7, 0], [10, 1], [12, 2], [0, 4], [12, 4]],
  [[0, 1], [0, 0], [12, 0], [0, 4], [7, 0], [12, 2]],
  [[0, 1], [0, 0], [12, 0], null, [0, 1], [10, 0], [0, 4], [12, 0], [7, 2], [0, 0]],
];

/** Hoover stab figures over two bars: onset, length in steps, core (plays whenever the lead layer is open). */
const ALIEN_STABS: readonly { s: number; len: number; core: boolean }[][] = [
  [{ s: 3, len: 2, core: true }, { s: 6, len: 1, core: false }, { s: 10, len: 3, core: true }, { s: 19, len: 2, core: true }, { s: 26, len: 2, core: true }, { s: 30, len: 1, core: false }],
  [{ s: 0, len: 3, core: true }, { s: 7, len: 1, core: false }, { s: 14, len: 2, core: true }, { s: 22, len: 2, core: true }, { s: 27, len: 1, core: false }, { s: 28, len: 3, core: false }],
  [{ s: 2, len: 1, core: true }, { s: 5, len: 1, core: false }, { s: 8, len: 4, core: true }, { s: 18, len: 1, core: true }, { s: 21, len: 1, core: false }, { s: 24, len: 4, core: true }],
];

/** Arp cells: indices into the chord's four tones, 4-7 an octave up. Lengths 6, 8, 10, 12 cycle against the bar. */
const ALIEN_ARPS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 5, 4, 6],
  [0, 1, 4, 2, 5, 3],
  [0, 4, 1, 5, 2, 6, 3, 7, 4, 6, 2, 5],
];

/** Robot calls: onset, length in steps and the vowel path as [F1, F2] formants in Hz. */
const ALIEN_VOX: readonly { s: number; len: number; vowels: readonly (readonly [number, number])[] }[] = [
  { s: 10, len: 6, vowels: [[700, 1100], [300, 2300]] },
  { s: 12, len: 4, vowels: [[450, 800], [700, 1200], [350, 2000]] },
  { s: 8, len: 8, vowels: [[300, 870], [650, 1700], [300, 2300]] },
];

/** Overtone Pulse's series: only octaves, fifths and the soft third. Group 0 holds still; 1-3 breathe in turn (3 only when busy). */
const DRONE_PARTIALS: readonly { n: number; g: number; group: 0 | 1 | 2 | 3 }[] = [
  { n: 1, g: 0.42, group: 0 },
  { n: 2, g: 0.4, group: 0 },
  { n: 3, g: 0.3, group: 1 },
  { n: 4, g: 0.24, group: 1 },
  { n: 5, g: 0.1, group: 2 },
  { n: 6, g: 0.13, group: 2 },
  { n: 8, g: 0.035, group: 3 },
  { n: 12, g: 0.016, group: 3 },
];

/**
 * Which 4-bar phrases of Overtone Pulse bring a just fifth in. One figure per epoch, then it cycles.
 * The market never chooses the pitch. 0 = tonic series only, 1 = the fifth joins.
 */
const DRONE_PULSE_FIGURES: readonly (0 | 1)[][] = [
  [0, 0, 0, 0],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
  [1, 0, 1, 0],
];

/** Overtone Pulse glass glints: partials of the series (no 7th, no 9th), over the fundamental in octave 3. */
const DRONE_GLASS = [4, 6, 8, 12];

/** Wall glints, semitones over the tonic in octave 4: major pentatonic, fifth-heavy. */
const DRONE_GLINT_NOTES = [7, 12, 14, 16, 19, 24];

/** Dark Low's distant bowls, semitones over the bass tonic two octaves up: tonic, fifth, octave. */
const DRONE_BOWL_NOTES = [0, 7, 12];

/** Wall voicings, semitones over the tonic in octave 3. Phrases alternate the open fifths with one colour. */
const DRONE_WALL_OPEN = [0, 7, 12, 19, 24];
const DRONE_WALL_COLOURS: readonly number[][] = [
  [0, 7, 14, 19, 24], // add9
  [0, 7, 12, 16, 24], // major tenth
];

/** Equal-power crossfade envelope: rises over `attack`, holds until `hold`, falls over `release` to 0. */
function droneEnv(s: number, attack: number, hold: number, release: number): number {
  if (s < attack) return Math.sin((Math.PI / 2) * (s / attack));
  if (s < hold) return 1;
  if (s < hold + release) return Math.cos((Math.PI / 2) * ((s - hold) / release));
  return 0;
}

/**
 * Wonky chords, semitones over the tonic: the bass root and two voicings (placed on c.low + 24). Every voicing is
 * stacked thirds/fourths with no minor or major second between any two voices, and its second-lowest voice an
 * octave up still clears the top voice by a third or more (the Brainfeeder arp runs over both octaves).
 */
type WonkyChordId = "i" | "iv" | "VI" | "VII" | "v" | "IV";
interface WonkyChord {
  root: number;
  voice: readonly number[];
  alt: readonly number[];
}
const WONKY_CHORDS: Record<WonkyChordId, WonkyChord> = {
  /** i m9 rootless (b3 5 b7 9) / i m7 open (b7 b3 5 1). */
  i: { root: 0, voice: [3, 7, 10, 14], alt: [-2, 3, 7, 12] },
  /** iv m9 rootless (Ab C Eb G over F) / iv m7 shell. */
  iv: { root: 5, voice: [-4, 0, 3, 7], alt: [3, 8, 12, 15] },
  /** VI maj9 rootless (C Eb G Bb over Ab) / VI maj7 open. */
  VI: { root: 8, voice: [0, 3, 7, 10], alt: [-4, 3, 7, 12] },
  /** VII: Bb D F Bb, open. */
  VII: { root: 10, voice: [2, 5, 10, 14], alt: [-2, 2, 5, 10] },
  /** v m7. */
  v: { root: 7, voice: [-5, -2, 2, 5], alt: [-2, 2, 5, 10] },
  /** Dorian IV9 rootless (A Eb G C over F) / IV9 close. */
  IV: { root: 5, voice: [-3, 3, 7, 12], alt: [-3, 0, 3, 7] },
};

/** Dilla Swing: one chord per bar, a four-bar loop (minor, the third dorian). */
const WONKY_DILLA_PROGS: readonly (readonly WonkyChordId[])[] = [
  ["i", "iv", "VII", "VI"],
  ["i", "VI", "iv", "v"],
  ["i", "IV", "i", "VII"],
  ["VI", "v", "i", "iv"],
];
/** Brainfeeder: two bars per chord. */
const WONKY_FEEDER_PROGS: readonly (readonly WonkyChordId[])[] = [
  ["i", "VI", "iv", "v"],
  ["i", "VII", "VI", "v"],
  ["i", "IV", "VII", "i"],
  ["iv", "VII", "i", "VI"],
];
/** Glitch-hop: one chord per bar. */
const WONKY_GLITCH_PROGS: readonly (readonly WonkyChordId[])[] = [
  ["i", "VII", "VI", "v"],
  ["i", "iv", "i", "VII"],
  ["i", "VI", "VII", "i"],
];

/** Kick figures over two bars (a, b), in three density tiers (sparse, mid, busy). */
interface WonkyKicks {
  a: readonly number[];
  b: readonly number[];
}
const WONKY_DILLA_KICKS: readonly (readonly WonkyKicks[])[] = [
  [{ a: [0, 10], b: [0, 10] }, { a: [0, 9], b: [0, 10] }],
  [{ a: [0, 7, 10], b: [0, 3, 10] }, { a: [0, 3, 10], b: [0, 10, 11] }, { a: [0, 6, 10], b: [0, 7, 10, 15] }],
  [{ a: [0, 3, 7, 10], b: [0, 6, 10, 11] }, { a: [0, 2, 7, 10, 15], b: [0, 3, 10, 14] }],
];
const WONKY_FEEDER_KICKS: readonly (readonly WonkyKicks[])[] = [
  [{ a: [0, 9], b: [0, 6, 9] }],
  [{ a: [0, 6, 9], b: [0, 3, 9, 14] }, { a: [0, 7, 11], b: [0, 7, 10, 13] }],
  [{ a: [0, 3, 6, 9, 14], b: [0, 6, 9, 11] }, { a: [0, 2, 7, 11], b: [0, 3, 7, 9, 13] }],
];
const WONKY_GLITCH_KICKS: readonly (readonly WonkyKicks[])[] = [
  [{ a: [0, 10], b: [0, 7, 10] }],
  [{ a: [0, 3, 10], b: [0, 7, 9, 14] }, { a: [0, 6, 10, 11], b: [0, 10, 13] }],
  [{ a: [0, 3, 6, 10, 11], b: [0, 2, 7, 10, 14] }],
];

/**
 * Dilla feels, one fixed lateness per voice (the same in every bar): `snare` seconds behind the straight kick (the
 * ghosts drag with it), `swing` the fraction of a sixteenth every in-between hat falls late (the eighths stay on the
 * grid), `chop` seconds the sample chops lag. `ghosts` in order of use (the first plays in the build too); `open` is
 * the second bar's open hat.
 */
const WONKY_DILLA_FEELS: readonly { snare: number; swing: number; ghosts: readonly number[]; chop: number; open: number }[] = [
  // Donuts: the snare well back, the sixteenths lazy.
  { snare: 0.022, swing: 0.17, ghosts: [7, 15], chop: 0.004, open: 14 },
  // Slum: a milder drag.
  { snare: 0.018, swing: 0.14, ghosts: [15, 9], chop: 0.002, open: 6 },
  // Fantastic: the snare barely late, the hats nearly straight.
  { snare: 0.014, swing: 0.11, ghosts: [11, 3], chop: 0, open: 14 },
];

/** Dilla chops over one bar: "C" the whole voicing, "U" its top pair, "L" its bottom pair; `core` plays in a quiet market. */
type WonkyChop = { s: number; len: number; p: "C" | "U" | "L"; core: boolean };
const WONKY_DILLA_CHOPS: readonly (readonly WonkyChop[])[] = [
  [{ s: 0, len: 3, p: "C", core: true }, { s: 3, len: 3, p: "C", core: true }, { s: 6, len: 2, p: "U", core: false }, { s: 8, len: 3, p: "C", core: true },
   { s: 11, len: 1, p: "L", core: false }, { s: 12, len: 3, p: "C", core: true }, { s: 15, len: 0.8, p: "U", core: false }],
  [{ s: 0, len: 6, p: "C", core: true }, { s: 6, len: 2, p: "U", core: false }, { s: 8, len: 2, p: "C", core: true }, { s: 10, len: 4, p: "C", core: true },
   { s: 14, len: 1.8, p: "L", core: false }],
  [{ s: 0, len: 2, p: "C", core: true }, { s: 2, len: 1, p: "C", core: false }, { s: 3, len: 4, p: "C", core: true }, { s: 7, len: 1, p: "U", core: false },
   { s: 10, len: 5, p: "C", core: true }, { s: 15, len: 0.8, p: "L", core: false }],
];

/**
 * Brainfeeder feels, on top of the style swing, one fixed lean per voice: `kick` seconds behind for every kick but the
 * downbeat, `snare` seconds behind, `hat` the extra fraction of a sixteenth the in-between hats lean.
 */
const WONKY_FEEDER_FEELS: readonly { kick: number; snare: number; hat: number }[] = [
  { kick: 0.006, snare: 0.014, hat: 0.04 },
  { kick: 0.009, snare: 0.018, hat: 0.07 },
];
/** Brainfeeder hat accents per sixteenth: lopsided, so the bar limps. */
const WONKY_FEEDER_HATS: readonly number[] = [0.9, 0.3, 0.55, 0.42, 0.85, 0.25, 0.62, 0.5, 0.9, 0.35, 0.5, 0.45, 0.8, 0.3, 0.66, 0.55];
/** Brainfeeder arps over two bars: [step, index into the chord tones over two octaves]. */
const WONKY_FEEDER_ARPS: readonly (readonly (readonly [number, number])[])[] = [
  // Dotted eighths up and back: three against four.
  [[0, 0], [3, 1], [6, 2], [9, 3], [12, 4], [15, 5], [18, 6], [21, 5], [24, 4], [27, 3], [30, 1]],
  // Offbeat eighths falling.
  [[2, 6], [6, 5], [10, 4], [14, 3], [18, 2], [22, 1], [26, 2], [30, 0]],
  // Little three-note runs.
  [[0, 2], [1, 3], [2, 4], [8, 1], [9, 2], [10, 3], [16, 3], [17, 4], [18, 5], [24, 0], [25, 1], [26, 2]],
];

/**
 * Glitch-hop beat edits over two bars (phrase steps). k32 retriggers a kick that is on that step (never one into a
 * backbeat); rev (a reversed snare) and stut (a 32nd snare pickup) start two sixteenths before a backbeat and resolve
 * onto it; roll (phrase step 30 only, every fourth bar) runs 32nds into the next downbeat; hrev is a reversed hat into the next beat.
 */
const WONKY_GLITCH_EDITS: readonly (readonly { s: number; k: "k32" | "rev" | "stut" | "roll" | "hrev"; core: boolean }[])[] = [
  [{ s: 2, k: "rev", core: true }, { s: 10, k: "k32", core: true }, { s: 14, k: "hrev", core: false }, { s: 23, k: "k32", core: false },
   { s: 26, k: "rev", core: true }, { s: 30, k: "roll", core: false }],
  [{ s: 0, k: "k32", core: false }, { s: 10, k: "rev", core: true }, { s: 14, k: "hrev", core: true }, { s: 18, k: "rev", core: false },
   { s: 26, k: "stut", core: true }, { s: 30, k: "roll", core: false }],
  [{ s: 10, k: "stut", core: false }, { s: 15, k: "hrev", core: true }, { s: 16, k: "k32", core: true }, { s: 26, k: "rev", core: true },
   { s: 30, k: "k32", core: false }],
];
/** Glitch-hop hat accents per sixteenth. */
const WONKY_GLITCH_HATS: readonly number[] = [0.8, 0.25, 0.5, 0.35, 0.75, 0.3, 0.55, 0.6, 0.8, 0.25, 0.5, 0.4, 0.75, 0.3, 0.6, 0.5];
/** Glitch-hop chord stabs over two bars: `rt` 32nd retriggers when the market is hot. */
const WONKY_GLITCH_STABS: readonly (readonly { s: number; len: number; rt: number; p: "C" | "U" | "L"; core: boolean }[])[] = [
  [{ s: 0, len: 1.5, rt: 1, p: "C", core: true }, { s: 3, len: 1, rt: 2, p: "C", core: false }, { s: 6, len: 1, rt: 1, p: "U", core: true },
   { s: 10, len: 2, rt: 1, p: "C", core: true }, { s: 13, len: 1, rt: 3, p: "C", core: false }, { s: 16, len: 1.5, rt: 1, p: "C", core: true },
   { s: 19, len: 1, rt: 2, p: "L", core: false }, { s: 22, len: 2, rt: 1, p: "C", core: true }, { s: 27, len: 1, rt: 4, p: "U", core: false }],
  [{ s: 2, len: 2, rt: 1, p: "C", core: true }, { s: 7, len: 1, rt: 3, p: "C", core: true }, { s: 11, len: 2, rt: 1, p: "U", core: false },
   { s: 18, len: 2, rt: 1, p: "C", core: true }, { s: 23, len: 1, rt: 2, p: "C", core: true }, { s: 26, len: 1, rt: 4, p: "L", core: false },
   { s: 30, len: 1.5, rt: 1, p: "U", core: false }],
];
/** Glitch-hop rubber bass over two bars: degree 0 the chord root, 1 its octave, 2 its fifth (a chord tone in every chord). */
const WONKY_GLITCH_BASS: readonly (readonly { s: number; len: number; d: number; core: boolean }[])[] = [
  [{ s: 0, len: 3, d: 0, core: true }, { s: 3, len: 1, d: 1, core: false }, { s: 6, len: 2, d: 0, core: true }, { s: 10, len: 2, d: 2, core: true },
   { s: 13, len: 2, d: 1, core: false }, { s: 16, len: 3, d: 0, core: true }, { s: 20, len: 2, d: 2, core: false }, { s: 22, len: 3, d: 0, core: true },
   { s: 27, len: 1, d: 1, core: false }, { s: 29, len: 2.6, d: 2, core: true }],
  [{ s: 0, len: 2, d: 0, core: true }, { s: 2, len: 1, d: 1, core: false }, { s: 4, len: 3, d: 0, core: true }, { s: 9, len: 1, d: 2, core: false },
   { s: 10, len: 4, d: 0, core: true }, { s: 16, len: 2, d: 0, core: true }, { s: 19, len: 2, d: 1, core: true }, { s: 23, len: 1, d: 2, core: false },
   { s: 26, len: 4, d: 0, core: true }, { s: 30, len: 1.6, d: 1, core: false }],
];
/** Glitch-hop vocal chops over two bars: `n` counts down from the voicing's top tone, `v` picks a vowel glide. */
const WONKY_GLITCH_VOX: readonly (readonly { s: number; len: number; n: number; v: number; core: boolean }[])[] = [
  [{ s: 2, len: 1, n: 0, v: 0, core: true }, { s: 5, len: 2, n: 1, v: 1, core: false }, { s: 11, len: 3, n: 0, v: 2, core: true },
   { s: 18, len: 1, n: 0, v: 0, core: true }, { s: 19, len: 1, n: 0, v: 3, core: false }, { s: 22, len: 3, n: 2, v: 1, core: true }],
  [{ s: 3, len: 2, n: 1, v: 3, core: true }, { s: 8, len: 1, n: 0, v: 0, core: false }, { s: 14, len: 2, n: 0, v: 2, core: true },
   { s: 20, len: 2, n: 2, v: 1, core: true }, { s: 27, len: 3, n: 1, v: 0, core: false }],
];
/** Formant pairs (F1, F2) a chop glides between: ah -> oh, eh -> ee, oh -> oo, ee -> ah. */
const WONKY_VOWELS: readonly (readonly (readonly [number, number])[])[] = [
  [[800, 1150], [450, 800]],
  [[550, 1770], [300, 2300]],
  [[450, 800], [325, 700]],
  [[300, 2300], [800, 1150]],
];

interface WonkySnareSpec {
  body: number;
  to: number;
  bodyDecay: number;
  bodyLevel: number;
  noise: number;
  q: number;
  noiseDecay: number;
  noiseLevel: number;
  bits?: number;
  clap?: number;
}
const WONKY_SNARES: Record<"dilla" | "dillaGhost" | "feeder" | "glitch", WonkySnareSpec> = {
  /** MPC snare with a clap layered tight on it. */
  dilla: { body: 190, to: 150, bodyDecay: 0.09, bodyLevel: 0.84, noise: 1750, q: 0.7, noiseDecay: 0.2, noiseLevel: 1.24, clap: 0.56 },
  /** The same snare brushed: shorter noise, no clap. */
  dillaGhost: { body: 190, to: 150, bodyDecay: 0.06, bodyLevel: 0.84, noise: 1750, q: 0.7, noiseDecay: 0.09, noiseLevel: 1.1 },
  /** Crunchy: 4-bit noise. */
  feeder: { body: 215, to: 165, bodyDecay: 0.07, bodyLevel: 0.84, noise: 2100, q: 0.6, noiseDecay: 0.16, noiseLevel: 1.65, bits: 4 },
  /** Tight and crisp, 6-bit grit. */
  glitch: { body: 245, to: 190, bodyDecay: 0.05, bodyLevel: 0.8, noise: 2900, q: 0.5, noiseDecay: 0.11, noiseLevel: 1.55, bits: 6 },
};

interface DubKick { center: number; rise: number; sweep: number; hold: number; decay: number; drive: number; lp: number; click: number; clickHz: number; level: number }

/** A chord of the natural minor: the sub's root (semitones from the tonic) and the stab's upper voicing over the tonic. */
interface DubChord { root: number; upper: readonly number[] }

/**
 * The chords, voice-led around the tonic so a change moves one or two voices by a step. Every tone is in the
 * natural minor and a chord tone (no minor seconds, no b9): i m9 / m11, iv m7, bVI maj9, bVII add9, v m7.
 */
const DUB_CHORDS = {
  i9: { root: 0, upper: [3, 7, 10, 14] },
  i11: { root: 0, upper: [3, 7, 10, 17] },
  iv7: { root: 5, upper: [0, 3, 8, 12] },
  VI9: { root: -4, upper: [0, 3, 7, 10] },
  VII9: { root: -2, upper: [2, 5, 10, 12] },
  v7: { root: 7, upper: [2, 7, 10, 14] },
} satisfies Record<string, DubChord>;
type DubChordName = keyof typeof DUB_CHORDS;

/** One dub techno style: kick, sub figure, progression, stab, pad, bell, drums, texture and how slowly it moves. */
interface DubStyle {
  kick: DubKick;
  /** Sub notes per bar: [step, length in 16ths, level, interval over the chord root (0 / 7 / 12)]. */
  bass: { notes: readonly (readonly [number, number, number, number?])[]; level: number; octave: number; lp: number; attack: number; release: number };
  /** Progressions, one per epoch: each chord holds `bars` bars. */
  progs: readonly { bars: number; seq: readonly DubChordName[] }[];
  stab: {
    octave: number;
    wave: OscillatorType;
    detune: number;
    lp: number;
    /** Cutoff multiplier at the attack, falling to the cutoff over `envTime`. */
    env: number;
    envTime: number;
    q: number;
    attack: number;
    release: number;
    gain: number;
    pan: number;
    /** Depth of the four-bar cutoff wobble on top of the slow sweep. */
    move: number;
  };
  /** Stab steps per bar, one figure per epoch. The last hit is the answer that density adds. */
  figures: readonly (readonly number[])[];
  /** Level of each figure hit, in order. */
  accents: readonly number[];
  /** Bars per full open-close of the stab and pad filters, and of the echo's loop filter. */
  stabPeriod: number;
  echoPeriod: number;
  pad: { level: number; wave: OscillatorType; detune: number; octave: number; lp: number; attack: number; release: number };
  /** Fragments over four bars: [16th in the four bars, chord tone counted from the top, level]; one in `every` phrases. */
  bell: { level: number; every: number; ratio: number; index: number; decay: number; frags: readonly (readonly (readonly [number, number, number])[])[] };
  clap: { level: number; hz: number; decay: number; rim: boolean };
  /** `shuffle`: shaker level per 16th of the beat (on, e, and, a). */
  hat: { off: number; decay: number; hp: number; metal: number; shaker: number; shakerDecay: number; shuffle: readonly number[] };
  /** Two-bar figure: [16th in the two bars, 1 tonic / 1.5 fifth, level]. */
  perc: { level: number; decay: number; figure: readonly (readonly [number, number, number])[] };
  vinyl: number;
  field: number;
  fieldHz: number;
}

const DUB_STYLES: Record<string, DubStyle> = {
  // Lucidflow: the main deep groove. A round kick, a rolling offbeat sub, soft clap on 2 and 4, open hat and swung
  // shaker; a two- or four-chord progression as m9 stabs three times a bar into the echo, a warm saw pad under it,
  // a bell fragment every second phrase, rain and hiss.
  classic: {
    kick: { center: 50, rise: 2, sweep: 0.075, hold: 0.14, decay: 0.6, drive: 1.7, lp: 230, click: 0.12, clickHz: 1500, level: 0.27 },
    bass: { notes: [[2, 1.7, 1], [6, 1.7, 0.92], [10, 1.7, 1], [13, 0.8, 0.62, 12], [14, 1.6, 0.9]], level: 0.62, octave: 0.14, lp: 300, attack: 0.01, release: 0.05 },
    progs: [
      { bars: 4, seq: ["i9", "iv7"] },
      { bars: 2, seq: ["i9", "VI9", "iv7", "i11"] },
      { bars: 4, seq: ["i9", "VII9", "VI9", "iv7"] },
    ],
    stab: { octave: 0, wave: "sawtooth", detune: 8, lp: 1050, env: 2.2, envTime: 0.16, q: 1.8, attack: 0.005, release: 0.34, gain: 0.9, pan: 0.1, move: 0.25 },
    figures: [[3, 10, 14], [2, 7, 10], [3, 6, 11], [2, 10, 13]],
    accents: [1, 0.82, 0.7],
    stabPeriod: 32,
    echoPeriod: 16,
    pad: { level: 1.7, wave: "sawtooth", detune: 9, octave: 0, lp: 900, attack: 1.4, release: 1.8 },
    bell: { level: 1.7, every: 2, ratio: 2, index: 0.9, decay: 1.6, frags: [[[6, 0, 1], [22, 1, 0.8], [38, 0, 0.9]], [[3, 1, 0.9], [11, 0, 1], [35, 2, 0.75]], [[10, 0, 1], [42, 1, 0.85]]] },
    clap: { level: 1.2, hz: 1250, decay: 0.16, rim: false },
    hat: { off: 0.68, decay: 0.085, hp: 6400, metal: 0.15, shaker: 0.34, shakerDecay: 0.04, shuffle: [0.35, 0.7, 0.45, 1] },
    perc: { level: 0.5, decay: 0.12, figure: [[7, 1, 1], [13, 1.5, 0.8], [23, 1, 0.9], [30, 1.5, 0.7]] },
    vinyl: 0.7,
    field: 1.2,
    fieldHz: 1800,
  },
  // Ixtlan: the ambient journey. Slower, a softer kick, a long sub, four chords of four bars each, long soft stabs
  // once or twice a bar, the pad up front, a slow bell melody every phrase, more rain and room; drums hushed but steady.
  ixtlan: {
    kick: { center: 47, rise: 1.7, sweep: 0.09, hold: 0.17, decay: 0.7, drive: 1.4, lp: 175, click: 0.04, clickHz: 900, level: 0.27 },
    bass: { notes: [[2, 5.6, 1], [10, 3.6, 0.95], [14, 1.6, 0.8, 7]], level: 0.64, octave: 0.08, lp: 220, attack: 0.03, release: 0.12 },
    progs: [
      { bars: 4, seq: ["i9", "VI9", "iv7", "i11"] },
      { bars: 4, seq: ["i11", "VII9", "VI9", "v7"] },
      { bars: 4, seq: ["i9", "iv7", "VI9", "VII9"] },
    ],
    stab: { octave: 0, wave: "sawtooth", detune: 12, lp: 750, env: 1.5, envTime: 0.3, q: 1.1, attack: 0.03, release: 0.8, gain: 0.71, pan: -0.1, move: 0.15 },
    figures: [[3, 11], [6, 14], [2, 10], [11, 3]],
    accents: [1, 0.72],
    stabPeriod: 32,
    echoPeriod: 24,
    pad: { level: 1.6, wave: "triangle", detune: 11, octave: 0, lp: 1400, attack: 2.4, release: 2.6 },
    bell: { level: 0.9, every: 1, ratio: 2, index: 0.6, decay: 2.4, frags: [[[2, 0, 1], [14, 1, 0.8], [34, 2, 0.85], [50, 1, 0.7]], [[6, 1, 0.9], [22, 0, 1], [46, 2, 0.8]], [[0, 2, 0.85], [10, 1, 0.9], [26, 0, 1]]] },
    clap: { level: 0.83, hz: 1100, decay: 0.2, rim: false },
    hat: { off: 0.5, decay: 0.1, hp: 7000, metal: 0, shaker: 0.37, shakerDecay: 0.05, shuffle: [0.3, 0.65, 0.4, 1] },
    perc: { level: 0.38, decay: 0.16, figure: [[10, 1, 1], [27, 1.5, 0.8]] },
    vinyl: 0.7,
    field: 2,
    fieldHz: 1300,
  },
  // The Moment: minimal-techno leaning. Tighter kick, a hypnotic 16th sub roll, a rim on 2 and 4, a looping
  // four-hit stab figure over two chords with the filter wobbling every four bars, drier hats, a rare single pluck.
  moment: {
    kick: { center: 52, rise: 1.9, sweep: 0.06, hold: 0.12, decay: 0.52, drive: 1.6, lp: 240, click: 0.16, clickHz: 1700, level: 0.27 },
    bass: { notes: [[2, 1, 1], [3, 0.9, 0.7], [6, 1, 1], [7, 0.9, 0.7], [10, 1, 1], [11, 0.9, 0.7], [14, 1, 1], [15, 0.8, 0.6, 12]], level: 0.66, octave: 0.12, lp: 260, attack: 0.008, release: 0.04 },
    progs: [
      { bars: 4, seq: ["i9", "iv7"] },
      { bars: 4, seq: ["i11", "VI9"] },
      { bars: 4, seq: ["i9", "v7"] },
    ],
    stab: { octave: 0, wave: "square", detune: 6, lp: 820, env: 1.9, envTime: 0.09, q: 3.2, attack: 0.005, release: 0.22, gain: 0.5, pan: 0.05, move: 0.7 },
    figures: [[2, 5, 10, 13], [3, 6, 11, 14], [2, 7, 10, 15]],
    accents: [1, 0.75, 0.9, 0.72],
    stabPeriod: 8,
    echoPeriod: 16,
    pad: { level: 1, wave: "sawtooth", detune: 7, octave: 0, lp: 700, attack: 1.2, release: 1.4 },
    bell: { level: 0.8, every: 4, ratio: 2, index: 1.1, decay: 1.1, frags: [[[6, 0, 1], [38, 0, 0.8]], [[11, 1, 1]]] },
    clap: { level: 2, hz: 1700, decay: 0.08, rim: true },
    hat: { off: 0.75, decay: 0.05, hp: 7400, metal: 0.25, shaker: 0.3, shakerDecay: 0.028, shuffle: [0.3, 0.6, 0.4, 1] },
    perc: { level: 0.35, decay: 0.08, figure: [[5, 1, 1], [11, 1.5, 0.7], [21, 1, 0.9], [27, 1, 0.6], [29, 1.5, 0.7]] },
    vinyl: 0.3,
    field: 1.2,
    fieldHz: 600,
  },
};

/**
 * Dub techno mix per style, over MIX.dubtechno. The echo is a dotted eighth (3 sixteenths); its taps are
 * feed-forward and lowpassed in the loop, so the "feedback" is a fixed decay that can never build or ring.
 * The pad (tex) and the bell (lead) bloom in the room; stabs, clap and percussion feed the echo.
 */
const DUB_MIX: Record<string, Partial<Mix>> = {
  classic: {
    echo: { steps: 3, taps: 9, fb: 0.58, lp: 2400, hp: 300 },
    echoSend: { harm: 0.75, fx: 1, snare: 0.55, perc: 0.5, lead: 0.5 },
    spaceSend: { harm: 0.42, fx: 0.35, tex: 0.4, lead: 0.45, snare: 0.3, hat: 0.12, perc: 0.2, kick: 0.05 },
    space: { size: 1.6, fb: 0.78, lp: 3200 },
    drumLp: 11000,
    duck: { bass: 0.2, harm: 0.6 },
    duckTime: { bass: 0.3, harm: 0.32 },
  },
  ixtlan: {
    echo: { steps: 3, taps: 11, fb: 0.6, lp: 1700, hp: 260 },
    echoSend: { harm: 0.85, fx: 1, snare: 0.6, perc: 0.6, lead: 0.6 },
    spaceSend: { harm: 0.6, fx: 0.5, tex: 0.6, lead: 0.6, snare: 0.4, hat: 0.25, perc: 0.3, kick: 0.05 },
    space: { size: 2.1, fb: 0.82, lp: 2400 },
    drumLp: 8000,
    duck: { bass: 0.25, harm: 0.75 },
    duckTime: { bass: 0.4, harm: 0.4 },
  },
  moment: {
    echo: { steps: 3, taps: 8, fb: 0.55, lp: 2000, hp: 320 },
    echoSend: { harm: 0.8, fx: 1, snare: 0.4, perc: 0.35, lead: 0.5 },
    spaceSend: { harm: 0.3, fx: 0.3, tex: 0.3, lead: 0.35, snare: 0.15, hat: 0.06, perc: 0.1, kick: 0.04 },
    space: { size: 1.3, fb: 0.74, lp: 2800 },
    drumLp: 12000,
    duck: { bass: 0.3, harm: 0.55 },
    duckTime: { bass: 0.2, harm: 0.28 },
  },
};
