import { hash32 } from "./hash.ts";

/**
 * Epoch = floor(patternId / 4), from on-chain state. No contract change.
 * Era = the epoch's slot in the genre cycles of ERA_SCHEDULE (see eraOf): every genre once per cycle.
 *
 * Each era is a GENRE: one coherent sound world with its own palette, groove rules and tempo range.
 * The chain drives rhythm and timbre, not pitch: harmony is a fixed tonal centre per genre instance
 * (from the epoch hash) and a small allowed note set. See sim/genres/NOTES.md.
 */
export type GenreId =
  | "dubtechno" | "electro" | "acid" | "ambientidm" | "drone" | "liquid"
  | "futuregarage" | "triphop" | "lofihouse" | "wonky";

export interface Era {
  id: GenreId;
  name: string;
  index: number;
  /** Genre tempo range. The on-chain bpm (72..118) maps linearly into it. */
  bpm: readonly [number, number];
  /** Odd-16th swing. 0.5 is straight. The grid is still 16th notes. */
  swing: number;
  microScale: number;
  ratchetEvery: number;
  stutterEvery: number;
  /** Tonic pitch classes this genre may sit on; the epoch picks one and keeps it (no key changes). */
  keys: readonly number[];
  /** Semitones above the tonic that bass/stab/melody may use. Everything else is never played. */
  notes: readonly number[];
  /** What sounds at once (at most four), for the rack and NOTES.md. */
  layers: readonly string[];
  /** Master trim so every genre lands near the same loudness under the ceiling. */
  trim: number;
  hp: number;
  // Rack labels (site ERA rack reads these names).
  bassMode: string;
  padMode: string;
  leadMode: string;
  snare: string;
  hat: string;
}

/** One bar — four beats — inside the spec's 1–2 bar crossfade. */
export const ERA_CROSSFADE_BARS = 1;

const ERA_LIST: readonly Era[] = [
  {
    id: "dubtechno",
    name: "Dub Techno",
    index: 0,
    bpm: [120, 126],
    swing: 0.53,
    microScale: 0.3,
    ratchetEvery: 96,
    stutterEvery: 97,
    keys: [5, 7, 9, 2], // F, G, A, D
    notes: [0, 3, 7, 10, 14],
    layers: ["round 4/4 kick, clap, swung shaker", "minor-9 chord stabs -> dub echo", "rolling sub on the chord root", "warm pad, bell, rain"],
    trim: 1.6,
    hp: 26,
    bassMode: "rolling sub",
    padMode: "m9 stabs+pad",
    leadMode: "bell fragments",
    snare: "clap",
    hat: "soft",
  },
  {
    id: "electro",
    name: "Electro",
    index: 1,
    bpm: [118, 130],
    swing: 0.52,
    microScale: 0.25,
    ratchetEvery: 64,
    stutterEvery: 71,
    keys: [9, 11, 2, 4], // A, B, D, E
    notes: [0, 7, 10, 12, 15],
    layers: ["808 breakbeat", "1-3 note bass arp", "cold sparse stabs"],
    trim: 1.25,
    hp: 30,
    bassMode: "arp 1-3",
    padMode: "none",
    leadMode: "cold stab",
    snare: "808",
    hat: "808",
  },
  {
    id: "acid",
    name: "Acid",
    index: 2,
    bpm: [120, 132],
    swing: 0.55,
    microScale: 0.3,
    ratchetEvery: 72,
    stutterEvery: 83,
    keys: [9, 10, 0, 2], // A, A#, C, D
    notes: [0, 3, 7, 10, 12],
    layers: ["dry 808 kit", "303 line (slides/accents)"],
    trim: 1.25,
    hp: 30,
    bassMode: "303",
    padMode: "none",
    leadMode: "none",
    snare: "808 clap",
    hat: "808",
  },
  {
    id: "ambientidm",
    name: "Ambient IDM",
    index: 3,
    bpm: [84, 100],
    swing: 0.58,
    microScale: 1.6,
    ratchetEvery: 128,
    stutterEvery: 127,
    keys: [2, 4, 6, 9], // D, E, F#, A
    notes: [0, 3, 5, 7, 10, 12, 15],
    layers: ["warm detuned pad (2 chords)", "lofi soft drums", "one simple melody"],
    trim: 2.3,
    hp: 24,
    bassMode: "in pad",
    padMode: "wow pad",
    leadMode: "melody",
    snare: "tape",
    hat: "soft",
  },
  {
    id: "drone",
    name: "Ambient Drone",
    index: 4,
    bpm: [60, 80],
    swing: 0.5,
    microScale: 2,
    ratchetEvery: 128,
    stutterEvery: 127,
    keys: [0, 2, 4, 5], // C, D, E, F
    notes: [0, 7, 12, 19, 24],
    layers: ["crossfading pads and tones", "breath and soft glints", "rare deep sub swell"],
    trim: 3.4,
    hp: 18,
    bassMode: "drone",
    padMode: "drone",
    leadMode: "none",
    snare: "none",
    hat: "grains",
  },
  {
    id: "liquid",
    name: "Liquid DnB",
    index: 5,
    bpm: [170, 176],
    swing: 0.51,
    microScale: 0.3,
    ratchetEvery: 64,
    stutterEvery: 79,
    keys: [2, 4, 7, 9], // D, E, G, A
    notes: [0, 3, 7, 10, 14],
    layers: ["two-step break (kick 1 + 3&, snare 2 + 4, ghosts)", "rolling sub on the chord root", "lush pad (2-chord vamp)", "warm keys"],
    trim: 1.3,
    hp: 28,
    bassMode: "rolling sub",
    padMode: "lush vamp",
    leadMode: "warm keys",
    snare: "crisp+ghost",
    hat: "shuffle",
  },
  {
    id: "futuregarage",
    name: "Future Garage",
    index: 6,
    bpm: [130, 138],
    swing: 0.58,
    microScale: 0.6,
    ratchetEvery: 96,
    stutterEvery: 89,
    keys: [1, 3, 8, 10], // C#, D#, G#, A#
    notes: [0, 3, 7, 10, 12],
    layers: ["2-step shuffle kit + crackle", "deep sub", "ghost pad", "pitched vocal chops"],
    trim: 1.4,
    hp: 26,
    bassMode: "deep sub",
    padMode: "ghost pad",
    leadMode: "vocal chops",
    snare: "clap/rim",
    hat: "shuffle",
  },
  {
    id: "triphop",
    name: "Trip-hop",
    index: 7,
    bpm: [84, 96],
    swing: 0.56,
    microScale: 0.8,
    ratchetEvery: 128,
    stutterEvery: 113,
    keys: [0, 2, 4, 7], // C, D, E, G
    notes: [0, 3, 7, 10],
    layers: ["heavy slow break", "deep bass on the chord root", "dark strings (2 chords)", "vinyl + scratches"],
    trim: 1.02,
    hp: 24,
    bassMode: "deep",
    padMode: "dark strings",
    leadMode: "none",
    snare: "fat",
    hat: "dusty",
  },
  {
    id: "lofihouse",
    name: "Lofi House",
    index: 8,
    bpm: [118, 124],
    swing: 0.56,
    microScale: 0.5,
    ratchetEvery: 128,
    stutterEvery: 101,
    keys: [0, 2, 5, 7], // C, D, F, G
    notes: [0, 3, 7, 10, 14],
    layers: ["dusty 4/4 (soft kick, clap, open hat)", "warm chord stabs (2 chords)", "round bass", "tape hiss"],
    trim: 1.45,
    hp: 28,
    bassMode: "round",
    padMode: "keys stabs",
    leadMode: "warm keys",
    snare: "clap",
    hat: "open/dusty",
  },
  {
    id: "wonky",
    name: "Wonky",
    index: 9,
    bpm: [80, 94],
    // What the rack shows. Dilla Swing plays straight on the clock and drags each voice by its own composed amount.
    swing: 0.58,
    microScale: 0.3,
    ratchetEvery: 112,
    stutterEvery: 107,
    keys: [2, 5, 7, 10], // D, F, G, A#
    notes: [0, 3, 5, 7, 10, 14],
    layers: ["drunk MPC kit (straight kick, late snare)", "chopped soul / woozy synth chords (minor 7-9)", "round 808 sub on the chord root", "vinyl"],
    trim: 1.2,
    hp: 26,
    bassMode: "808 sub",
    padMode: "soul chops",
    leadMode: "glints",
    snare: "late clap",
    hat: "drunk",
  },
];

export const ERAS: readonly Era[] = ERA_LIST;

/**
 * The genre order. History is frozen: the genre of a past epoch must never change once the app is live (bot posts,
 * recordings and replays name it). So:
 *   - never edit or remove an entry; to change the pool, APPEND an entry starting at a future epoch (it takes effect
 *     at the first cycle that starts on or after it);
 *   - never reorder ERA_LIST or change an `index`; new genres go at the end of ERA_LIST.
 * Epochs run in cycles of one appearance per genre. The very first cycle plays `ids` in the listed order (the
 * owner's hand-picked opening); every later cycle is a seeded shuffle of the pool that never repeats a genre or
 * makes an A-B-A across the seam. Variations inside a genre (styles, timbres, phrases) do not touch this table.
 */
export const ERA_SCHEDULE: readonly { fromEpoch: number; ids: readonly GenreId[] }[] = [
  {
    fromEpoch: 0,
    ids: ["liquid", "wonky", "triphop", "lofihouse", "futuregarage", "electro", "drone", "ambientidm", "dubtechno", "acid"],
  },
];

/** Genre pool in force at `epoch`: the last schedule entry that has started. */
function poolAt(epoch: number): readonly Era[] {
  let ids = ERA_SCHEDULE[0].ids;
  for (const entry of ERA_SCHEDULE) if (entry.fromEpoch <= epoch) ids = entry.ids;
  return ids.map(eraById);
}

const eraOrder: number[] = [];

export function epochOf(state: { patternId: number }): number {
  return Math.floor((state.patternId >>> 0) / 4);
}

/** Deterministic era for an epoch: cycles of the pool in force, the first in schedule order, then shuffled. */
export function eraOf(epoch: number): Era {
  const target = Number.isFinite(epoch) ? Math.max(0, Math.floor(epoch)) : 0;
  while (eraOrder.length <= target) {
    const start = eraOrder.length;
    const pool = poolAt(start).map((era) => era.index);
    const prev = start > 0 ? eraOrder[start - 1] : -1;
    const prev2 = start > 1 ? eraOrder[start - 2] : -1;
    // Across the seam: no repeat and no A-B-A. Reshuffle with the next seed until the cycle fits.
    let cycle = pool;
    for (let attempt = 0; start > 0; attempt++) {
      cycle = shuffledCycle(pool, start, attempt);
      if (cycle.length < 3 || (cycle[0] !== prev && cycle[0] !== prev2 && cycle[1] !== prev) || attempt >= 63) break;
    }
    eraOrder.push(...cycle);
  }
  return ERA_LIST[eraOrder[target]];
}

/** Fisher-Yates over the pool, seeded by the cycle's first epoch and the attempt. */
function shuffledCycle(pool: readonly number[], start: number, attempt: number): number[] {
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) {
    const j = hash32(start, i, attempt, 0xe01c) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function eraById(id: string): Era {
  const found = ERA_LIST.find((era) => era.id === id);
  if (!found) throw new Error(`unknown era ${id}`);
  return found;
}

export function eraByIndex(index: number): Era {
  return ERA_LIST[index] ?? ERA_LIST[0];
}

/** On-chain bpm range (core BPM_MIN..BPM_MAX). */
export const CHAIN_BPM: readonly [number, number] = [72, 118];

/**
 * The genre's tempo for an on-chain bpm: a linear map of 72..118 into the genre range, rounded,
 * so a fast market is still a fast track within the genre. Out-of-range input falls back to 96.
 */
export function genreTempo(era: Era, chainBpm: number, range: readonly [number, number] = era.bpm): number {
  const b = chainBpm >= 40 && chainBpm <= 300 ? chainBpm : 96;
  const u = Math.max(0, Math.min(1, (b - CHAIN_BPM[0]) / (CHAIN_BPM[1] - CHAIN_BPM[0])));
  return Math.round(range[0] + u * (range[1] - range[0]));
}

/** Tonic pitch class of a genre instance: fixed per epoch, from the epoch hash. */
export function genreKey(era: Era, epoch: number): number {
  return era.keys[hash32(epoch >>> 0, era.index, 0x70e1) % era.keys.length];
}

/** Length of the era crossfade. One bar of quarter notes at `bpm`. */
export function crossfadeSeconds(bpm: number): number {
  const b = bpm >= 40 && bpm <= 300 ? bpm : 96;
  return ERA_CROSSFADE_BARS * 4 * (60 / b);
}
