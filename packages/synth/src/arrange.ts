import { hash32 } from "./hash.ts";
import { bassAt, type SequencerState } from "./state.ts";

/**
 * SPEC §4.3. The on-chain grid is a set of knobs, not a score. Each track's
 * hit count sets its density; the rules below turn densities into a groove
 * that stays musical no matter how many identical swaps arrive: the kick
 * keeps the downbeat, the snare keeps the backbeat, hats are evenly spread,
 * glitch stays sparse. Bass onsets are rhythm: the genre engine picks their pitch from its own
 * small note set over a fixed tonic (no chord progression; the chain drives rhythm, not harmony).
 */
export interface Arrangement {
  /** Per track (kick, snare, hat, glitch), per step: 0 = rest, else velocity 0..1. */
  vel: number[][];
  /** Same grid packed like `state.pattern`, for voices and visuals that read bits. */
  pattern: bigint;
  /** Bass onsets per step, packed like `state.bass` (1 root, 3, 5, 8 octave); the genre maps them to its note set. */
  bass: bigint;
  /** 0..1 overall density of the on-chain grid. */
  energy: number;
  /** Raw on-chain hit count per track. */
  density: number[];
  /** Song-form position of this bar and its layer levels (SPEC §4.4). */
  section: Section;
  /** Always 0: harmony is static (one tonal centre per genre instance). Kept for API stability. */
  chordRoot: number;
  /** Lead motif notes of this bar by step: scale degree above the key root, length in steps. */
  motif: (MotifNote | null)[];
}

export type SectionName = "intro" | "build" | "full" | "breakdown" | "rebuild";

export interface Section {
  name: SectionName;
  /** Bar inside the 32-bar form. */
  bar: number;
  kick: number;
  snare: number;
  hat: number;
  glitch: number;
  bass: number;
  pad: number;
  /** Motif lead. */
  lead: number;
  /** The era's own arp/texture lead (busy; only in the full section). */
  texture: number;
  /** Sustained root/fifth bed under the groove. */
  bed: number;
  /** Master lowpass opening 0..1. */
  filter: number;
}

export interface MotifNote {
  deg: number;
  len: number;
}

export const FORM_BARS = 32;

/**
 * SPEC §4.4. A fixed 32-bar song form on the playback bar counter:
 * intro 8 · build 8 · full 8 · breakdown 4 · rebuild 4. The market sets how dense each part is;
 * the form sets which layers speak, so the track breathes even under a steady stream of swaps.
 */
export function sectionAt(bar: number): Section {
  const b = ((bar % FORM_BARS) + FORM_BARS) % FORM_BARS;
  const u = (from: number, len: number) => (b - from + 1) / len; // 1/len .. 1 across the part
  if (b < 8) {
    return { name: "intro", bar: b, kick: 0.75, snare: 0, hat: b < 4 ? 0 : 0.45, glitch: 0, bass: b < 4 ? 0 : 0.6, pad: 1, lead: 0, texture: 0, bed: 1, filter: 0.3 + 0.2 * u(0, 8) };
  }
  if (b < 16) {
    return { name: "build", bar: b, kick: 1, snare: 0.8, hat: 0.8, glitch: 0.5, bass: 0.9, pad: 0.85, lead: b < 12 ? 0 : 0.7, texture: 0, bed: 0.75, filter: 0.5 + 0.45 * u(8, 8) };
  }
  if (b < 24) {
    return { name: "full", bar: b, kick: 1, snare: 1, hat: 1, glitch: 1, bass: 1, pad: 0.7, lead: 1, texture: 0.55, bed: 0.5, filter: 1 };
  }
  if (b < 28) {
    return { name: "breakdown", bar: b, kick: 0, snare: 0, hat: b < 26 ? 0 : 0.35, glitch: 0.4, bass: 0.45, pad: 1, lead: 1, texture: 0, bed: 1, filter: 0.6 };
  }
  return { name: "rebuild", bar: b, kick: b < 30 ? 0.6 : 1, snare: b < 30 ? 0.5 : 1, hat: 0.75, glitch: 0.6, bass: 0.8, pad: 0.9, lead: 0.8, texture: 0, bed: 0.8, filter: 0.65 + 0.35 * u(28, 4) };
}

// Two-bar call/answer rhythms (onsets in 32 steps).
const RHYTHMS = [
  [0, 3, 6, 10, 14, 16, 19, 22, 28],
  [0, 2, 4, 8, 12, 16, 18, 20, 24],
  [2, 6, 8, 14, 18, 22, 24, 30],
  [0, 6, 12, 14, 16, 22, 28],
  [0, 4, 7, 10, 16, 20, 23, 26],
];

const motifCache = new Map<number, (MotifNote | null)[][]>();

/**
 * One motif per epoch (patternId / 4) and key: bar A is the call, bar B answers with the
 * same rhythm and resolves to the root. Every 4th bar varies the tail up a third.
 */
function motifBars(epoch: number, root: number): (MotifNote | null)[][] {
  const key = epoch * 16 + (root & 15);
  const hit = motifCache.get(key);
  if (hit) return hit;
  const seed = hash32(epoch, root, 0x6d6f);
  const rhythm = RHYTHMS[seed % RHYTHMS.length];
  const a = rhythm.filter((s) => s < 16);
  const b = rhythm.filter((s) => s >= 16).map((s) => s - 16);
  let deg = [2, 4, 4, 7][(seed >>> 4) % 4];
  const moves = [1, -1, 2, -2, 1, -1, 0, 3];
  const call: number[] = [];
  for (let i = 0; i < a.length; i++) {
    call.push(deg);
    deg = Math.max(0, Math.min(9, deg + moves[hash32(seed, i) % moves.length]));
  }
  const answer = b.map((_, i) => (i === b.length - 1 ? 0 : call[Math.min(i, call.length - 1)] - (i % 2)));
  const bars = [call, answer, call, answer.map((d, i) => (i >= answer.length - 2 ? d + 2 : d))].map((degs, k) => {
    const onsets = k % 2 === 0 ? a : b;
    const row = new Array<MotifNote | null>(STEPS).fill(null);
    onsets.forEach((s, i) => {
      const next = i + 1 < onsets.length ? onsets[i + 1] : STEPS;
      row[s] = { deg: Math.max(0, degs[i]), len: Math.min(6, next - s) };
    });
    return row;
  });
  if (motifCache.size > 256) motifCache.clear();
  motifCache.set(key, bars);
  return bars;
}

const STEPS = 16;

function popcount16(x: number): number {
  let n = 0;
  for (let v = x & 0xffff; v; v &= v - 1) n++;
  return n;
}

function trackWord(pattern: bigint, track: number): number {
  return Number((pattern >> BigInt(track * 16)) & 0xffffn);
}

/** Bjorklund-style even spread of k hits over 16 steps, starting on step `rot`. */
export function euclid(k: number, rot = 0): number[] {
  const out: number[] = [];
  if (k <= 0) return out;
  for (let i = 0; i < STEPS; i++) {
    if (((i * k) % STEPS) < k) out.push((i + rot) % STEPS);
  }
  return out.sort((a, b) => a - b);
}

// Kick figures by size. Every one keeps step 0; variants are picked by the chain's own bits.
const KICKS: number[][][] = [
  [],
  [[0, 8], [0, 10], [0, 7]],
  [[0, 8, 10], [0, 6, 8], [0, 7, 10], [0, 3, 8]],
  [[0, 4, 8, 12], [0, 6, 8, 14], [0, 3, 8, 11], [0, 7, 10, 12]],
  [[0, 4, 8, 10, 12], [0, 3, 6, 8, 12], [0, 4, 7, 8, 12]],
  [[0, 3, 4, 8, 11, 12], [0, 4, 6, 8, 12, 14]],
];
const GHOSTS = [2, 6, 7, 10, 11, 14, 15, 3];
// Chord tones in scale steps: root, third, fifth, octave.
const CHORD = [0, 2, 4, 7];

function kickSize(n: number): number {
  if (n === 0) return 0;
  if (n <= 2) return 1;
  if (n <= 5) return 2;
  if (n <= 8) return 3;
  if (n <= 12) return 4;
  return 5;
}

const cache = new Map<string, Arrangement>();

/**
 * Pure and deterministic: the same state and bar always give the same groove,
 * so the site, the bot's renders and replays agree. `bar` adds phrase-level
 * movement (a fill every 4th bar, a hat break every 8th) on top of the chain.
 */
export function arrange(state: SequencerState, bar = 0): Arrangement {
  const phrase = ((bar % 8) + 8) % 8;
  const section = sectionAt(bar);
  const key = `${state.pattern}:${state.bass}:${state.patternId >>> 0}:${state.root}:${section.bar}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const words = [0, 1, 2, 3].map((t) => trackWord(state.pattern, t));
  const density = words.map(popcount16);
  const energy = density.reduce((a, b) => a + b, 0) / 64;
  const vel = [0, 1, 2, 3].map(() => new Array<number>(STEPS).fill(0));
  const fillBar = phrase % 4 === 3;

  // Kick: downbeat anchored, size from density, figure from the chain's bits.
  const ks = kickSize(density[0]);
  if (ks > 0) {
    const options = KICKS[ks];
    const figure = options[hash32(words[0], 1) % options.length];
    for (const s of figure) vel[0][s] = s === 0 ? 1 : s % 4 === 0 ? 0.92 : 0.78;
    // Intro and the first half of the rebuild keep only the half-time pulse.
    if (section.name === "intro" || (section.name === "rebuild" && section.bar < 30)) {
      for (let s = 1; s < STEPS; s++) if (s !== 8) vel[0][s] = 0;
    }
    // Fill bar: a pickup into the next downbeat.
    // A full six-hit figure gives up its last offbeat hit to the pickup, so the cap of six holds.
    if (fillBar && ks >= 2 && vel[0][14] === 0) {
      if (vel[0].filter((v) => v > 0).length >= 6) {
        for (let s = 13; s > 0; s--) if (s !== 8 && vel[0][s] > 0) { vel[0][s] = 0; break; }
      }
      vel[0][14] = 0.7;
    }
  }

  // Snare: backbeat first, then ghost notes, then a roll on fill bars.
  if (density[1] > 0) {
    vel[1][4] = 1;
    vel[1][12] = 1;
    const ghosts = section.name === "full" ? Math.min(4, Math.floor(density[1] / 3)) : Math.min(1, Math.floor(density[1] / 6));
    const start = hash32(words[1], 2) % GHOSTS.length;
    for (let i = 0, placed = 0; i < GHOSTS.length && placed < ghosts; i++) {
      const s = GHOSTS[(start + i) % GHOSTS.length];
      if (vel[0][s] > 0 || vel[1][s] > 0) continue;
      vel[1][s] = 0.32;
      placed++;
    }
    if (fillBar && density[1] >= 4) {
      vel[1][13] = 0.38;
      vel[1][14] = 0.55;
      vel[1][15] = 0.75;
    }
  }

  // Hats: an even spread whose count follows density; offbeats accented.
  if (density[2] > 0) {
    const k = Math.min(12, Math.max(4, Math.round(4 + density[2] * 0.55)));
    const rot = k === 4 ? 2 : hash32(words[2], 3) % 2;
    for (const s of euclid(k, rot)) vel[2][s] = s % 4 === 2 ? 0.95 : s % 2 === 0 ? 0.6 : 0.42;
    // Every 8th bar the hats sit out the last half bar.
    if (phrase === 7) for (let s = 8; s < STEPS; s++) vel[2][s] = 0;
  }

  // Glitch: at most three ornaments, on the chain's own steps when they are free.
  if (density[3] > 0) {
    const want = Math.min(3, Math.ceil(density[3] / 4));
    const free = (s: number) => vel[0][s] === 0 && vel[1][s] < 0.9;
    const picks: number[] = [];
    for (let s = 0; s < STEPS && picks.length < want; s++) {
      const step = (s + (hash32(words[3], 4) % STEPS)) % STEPS;
      if ((words[3] >> step) & 1 && free(step) && !picks.some((p) => Math.abs(p - step) < 3)) picks.push(step);
    }
    for (let i = 0; picks.length < want && i < STEPS; i++) {
      const step = hash32(words[3], 5, i) % STEPS;
      if (free(step) && !picks.includes(step)) picks.push(step);
    }
    for (const s of picks) vel[3][s] = 0.85;
  }

  // Bass: the chain's onsets, capped and ranked; each note tagged with a tone of the (fixed) tonic chord.
  const chordRoot = 0;
  // Motif follows the epoch only: the on-chain root (whale +7) no longer moves the melody.
  const motifRow = motifBars((state.patternId >>> 0) >>> 2, 0)[section.bar % 4];
  const motif = motifRow.map((n) => (n ? { deg: n.deg + chordRoot, len: n.len } : null));
  const onsets: number[] = [];
  for (let s = 0; s < STEPS; s++) if (bassAt(state.bass, s) > 0) onsets.push(s);
  const rank = (s: number) => (s % 4 === 0 ? 0 : s % 2 === 0 ? 1 : 2) * 32 + (vel[0][s] > 0 ? 0 : 16) + s;
  const kept = onsets.sort((a, b) => rank(a) - rank(b)).slice(0, 6);
  if (kept.length === 0 && energy > 0) kept.push(0);
  let bass = 0n;
  for (const s of kept) {
    const raw = bassAt(state.bass, s) || 1;
    const tone = s === 0 ? 0 : CHORD[raw % CHORD.length];
    const deg = Math.min(15, 1 + chordRoot + tone);
    bass |= BigInt(deg) << BigInt(s * 4);
  }

  const layer = [section.kick, section.snare, section.hat, section.glitch];
  for (let t = 0; t < 4; t++) for (let s = 0; s < STEPS; s++) vel[t][s] *= layer[t];
  // The bar before the drop back in: a snare roll up, whatever the chain says.
  if (section.bar === 31) {
    vel[1][4] = Math.max(vel[1][4], 0.5);
    vel[1][12] = Math.max(vel[1][12], 0.5);
    for (const [s, v] of [[13, 0.45], [14, 0.6], [15, 0.8]] as const) vel[1][s] = Math.max(vel[1][s], v);
  }

  let pattern = 0n;
  for (let t = 0; t < 4; t++) {
    for (let s = 0; s < STEPS; s++) if (vel[t][s] > 0) pattern |= 1n << BigInt(t * 16 + s);
  }

  const result: Arrangement = { vel, pattern, bass, energy, density, section, chordRoot, motif };
  if (cache.size > 512) cache.clear();
  cache.set(key, result);
  return result;
}
