import type { StationPack } from "../pack.ts";

// IMD Dark: underground dark disco / dark electro / indie dance, the new music parked for the $IDM station (owner,
// 2026-10-27). First written for Squeekchain's wheel after the UK garage sets read as too light; the owner kept three
// of the four (Velvet Disco is gone) for the IDM station, not the hamster, then asked for three more (Iron Body, Night
// Roller, Echo Cellar) and moved Abyssal Drift over from the hamster's dark electro. Aesthetic and arrangement after
// Blex, Alejandro Molinari, Damon Jee, Cabizbajo, Pavel Petrov, Theus Mago, Far&High; every line, pattern and patch
// here is original.
// Few elements, a strong four-to-the-floor groove, the BASSLINE as the lead (a resonant, driven saw through an
// enveloped lowpass, octaves and Phrygian minor seconds), sparse dissonant stabs into long dark echoes and rooms, a cold
// drone, filters opening over 8 / 16 / 32 bars (ukg.sweep), sidechained bass and filter breakdowns; no noise risers
// (riser 0: over the long echoes they read as air blowing through the track).
// Future garage: the UK garage voices (engine.ts garageUkg, styledata.ts UkgSpec) with four-to-the-floor kick figures,
// each style's own keys (ukg.keys) and dark scales (ukg.scale: Phrygian, "dark" = natural + harmonic minor + b2 +
// tritone), validated note by note. Electro: Abyssal Drift, deep aquatic electro on the Client_03 renderer (a
// syncopated 808 break, not four to the floor).
// Baked (stations/index.ts PACKS) but on no station yet. The station's tempo lands at the top of each `bpm` range: the
// top is the tempo each style wants.

/** Dense, short, deep kick: a fast sweep, a click, drive, a restrained tail. */
const KICK = { start: 160, end: 48, sweep: 0.035, decay: 0.24, click: 0.2, clickHp: 3500, drive: 1, body: 1.2 };
/** Clap on 2 and 4: a body of noise, two claps a flam apart, a metallic ring, a short gated tail. */
const CLAP = [
  { noise: "bandpass", freq: 1800, q: 1, decay: 0.06, level: 1.25 },
  { clap: 1.5 },
  { clap: 0.85, at: 0.012, flip: true },
  { tone: "square", freq: 560, to: 540, decay: 0.03, level: 0.25 },
  { noise: "highpass", freq: 5000, q: 0.7, decay: 0.14, level: 0.55 },
] as const;
/** Ghost hits: a short rim. */
const RIM = [
  { tone: "triangle", freq: 900, to: 850, decay: 0.015, level: 0.8 },
  { noise: "bandpass", freq: 4000, q: 2, decay: 0.02, level: 0.45 },
] as const;
const KIT = {
  kick: KICK,
  snare: CLAP,
  ghost: RIM,
  hat: { hp: 9000, decay: 0.025, metal: 0.45, level: 0.5 },
  shaker: { freq: 7000, q: 1.2, decay: 0.03, attack: 0.004, level: 0.16, off: 0.16 },
  open: { hp: 7000, decay: 0.14, metal: 0.5, level: 0.24 },
};
/** Four to the floor; a tier's figures alternate bar by bar, so the extra hits come every other bar. */
const FOUR = { lo: [[0, 4, 8, 12]], mid: [[0, 4, 8, 12], [0, 4, 8, 11, 12]], hi: [[0, 4, 8, 12], [0, 4, 7, 8, 12, 14]] };
/** Long dark rooms and a dotted-eighth tape-ish echo; the bass ducks hard under the kick. */
const FX = {
  echo: { steps: 3, taps: 5, fb: 0.5, lp: 2500, hp: 400 },
  echoSend: { kick: 0, bass: 0, snare: 0.1, perc: 0.25, lead: 0.3, harm: 0.1, fx: 0.6 },
  space: { size: 1.8, fb: 0.78, lp: 3500 },
  spaceSend: { kick: 0, bass: 0, snare: 0.25, hat: 0.05, perc: 0.3, lead: 0.3, harm: 0.5, tex: 0, fx: 0.4 },
  drumLp: 15000,
  drive: 1.15,
  pressDrive: 0.15,
  duck: { bass: 0.45, harm: 0.5 },
  duckTime: { bass: 0.15, harm: 0.25 },
  master: { lp: 14000 },
} as const;
const QUIET = { pluck: { level: 0 }, lead: { level: 0 }, organ: { level: 0 } } as const;

/** A two-bar line of 16th notes: `at(step)` gives [semi, velocity, glide] or null (a rest). */
const line = (at: (s: number) => readonly [number, number, boolean?] | null) =>
  Array.from({ length: 32 }, (_, s) => {
    const n = at(s);
    return n ? { s, len: 0.8, semi: n[0], vel: n[1], core: true, ...(n[2] ? { glide: true } : {}) } : null;
  }).filter((x) => x !== null);

export default {
  key: "imd-dark",
  name: "IMD Dark",
  genres: ["futuregarage", "electro"],
  styles: {
    futuregarage: [
      // A Phrygian 16th-bass driver: the rolling gallop between the kicks (three 16ths a beat), octave lifts, a b2 at
      // the end of every second beat; its filter opens over 16 bars and closes over 16. One stab a bar into the
      // echo, a low dark arp, a cold drone, a robotic "oh" a phrase.
      {
        id: "imd-dark-phrygian",
        name: "Phrygian Drive",
        base: "classic",
        bpm: [121, 126],
        swing: 0.53,
        microScale: 0.1,
        trim: 1.13,
        riser: 0,
        data: {
          chords: [
            { bass: 0, pad: [0, 3, 7], guide: 3, dark: [0, 7, 15] }, // i
            { bass: 1, pad: [1, 5, 8], guide: 5, dark: [1, 8, 13] }, // bII (the Phrygian second)
          ],
          progressions: [[0, 0, 0, 1], [0, 1, 0, 0]],
          kicks: FOUR,
          skips: [[[7, 0.3], [23, 0.35], [15, 0.25], [31, 0.25]]],
          stabs: [[{ s: 14, len: 1, vel: 0.8, core: true }, { s: 30, len: 1.5, vel: 0.9, core: true }]],
          basslines: [
            line((s) => {
              const k = s >> 2, p = s % 4;
              if (p === 0) return null;
              if (p === 2) return [k % 2 ? 12 : 0, 0.9, k % 2 === 1];
              if (p === 3 && k % 2 === 1) return [1, 0.75];
              return [0, p === 1 ? 0.6 : 0.7];
            }),
          ],
          motifs: [
            [2, 6, 10, 14, 18, 22, 26, 30].map((s, i) => ({ s, len: 1, tone: [0, 2, 1, 2, 0, 2, 1, 3][i], core: true })),
          ],
          calls: [[{ s: 28, len: 4, vowel: 3, to: 4, tone: 0, core: true }]],
          ukg: {
            ...QUIET,
            keys: [5, 7, 4, 2],
            scale: "dark",
            midEarly: 1,
            sweep: { bars: 16, depth: 0.6 },
            stab: { level: 1.5, voices: 2, detune: 9, osc2: 0, cutoff: 1400, q: 3, slope: 24, env: 0.5, fdecay: 0.15, decay: 0.2, sustain: 0, release: 0.3, drive: 2, width: 0.6 },
            sub: { level: 0.8, decay: 0.12, sustain: 0.3, release: 0.05 },
            mid: { kind: "saw", level: 1, cutoff: 500, env: 0.7, q: 4, decay: 0.1, sustain: 0.15, release: 0.05, drive: 3, detune: 5, hp: 80, bend: 0 },
            pluck: { level: 1, wave: "sawtooth", cutoff: 900, env: 0.4, decay: 0.15, release: 0.2, bend: 0, pan: 0.5 },
            vox: { level: 0.8, q: 12, breath: 0.1, bend: 0, scoop: 0.02, release: 0.1, lp: 2500 },
            strings: { level: 1, detune: 20, cutoff: 900, attack: 2, release: 3, hold: 1 },
            groove: { hatLate: 0.03, percLate: 0.05, jitter: 0.6, ghost: 0.6, perc: 0.6, open: 0.6, offOpen: 0.8, metal: 1.5, tamb: 0, ghostKick: 0.5 },
          },
          kit: KIT,
          vinyl: 0,
          mix: {},
          fx: FX,
        },
      },
      // Aggressive acid-tinged electro: a resonant, driven 16th saw line with slides, octaves, minor seconds and a
      // tritone, its filter opening and shutting every 8 bars; short dissonant stabs, metallic ticks and toms, kick
      // extras every other bar, a stuttered robot syllable.
      {
        id: "imd-dark-acid",
        name: "Acid Machine",
        base: "classic",
        bpm: [123, 128],
        swing: 0.52,
        microScale: 0.08,
        trim: 1.04,
        riser: 0,
        data: {
          chords: [
            { bass: 0, pad: [0, 3, 7], guide: 3, dark: [0, 7, 15] }, // i
            { bass: 0, pad: [0, 1, 7], guide: 1, dark: [0, 7, 13] }, // the minor-second cluster
            { bass: 0, pad: [0, 6, 12], guide: 6, dark: [0, 6, 12] }, // the tritone
          ],
          progressions: [[0, 1, 0, 2]],
          kicks: { lo: [[0, 4, 8, 12]], mid: [[0, 4, 8, 12], [0, 4, 7, 8, 12, 14]], hi: [[0, 4, 8, 11, 12], [0, 4, 7, 8, 12, 14]] },
          skips: [[[7, 0.4], [15, 0.35], [23, 0.4], [31, 0.35], [11, 0.3]]],
          stabs: [[{ s: 7, len: 0.5, vel: 0.9, core: true }, { s: 23, len: 0.5, vel: 0.8, core: true }, { s: 30, len: 0.5, vel: 0.7, core: false }]],
          basslines: [
            line((s) => {
              const notes: Record<number, readonly [number, number, boolean?]> = {
                0: [0, 1], 1: [0, 0.6], 2: [12, 0.9, true], 3: [0, 0.6], 5: [13, 0.8, true], 6: [12, 0.7], 7: [0, 0.6],
                9: [0, 0.7], 10: [12, 0.9, true], 11: [6, 0.7], 13: [0, 0.6], 14: [12, 0.8, true], 15: [1, 0.7],
                16: [0, 1], 17: [0, 0.6], 18: [12, 0.9, true], 19: [0, 0.6], 21: [7, 0.8], 22: [12, 0.7, true], 23: [0, 0.6],
                25: [0, 0.7], 26: [13, 0.9, true], 27: [12, 0.7], 29: [1, 0.8, true], 30: [0, 0.7], 31: [12, 0.8, true],
              };
              return notes[s] ?? null;
            }),
          ],
          calls: [[{ s: 14, len: 1, vowel: 2, tone: 0, rep: 3, core: true }]],
          ukg: {
            ...QUIET,
            keys: [7, 4, 5],
            scale: "dark",
            midEarly: 1,
            sweep: { bars: 8, depth: 0.8 },
            stab: { level: 1.5, voices: 2, detune: 12, osc2: 0, cutoff: 2200, q: 4, slope: 12, env: 0.6, fdecay: 0.1, decay: 0.12, sustain: 0, release: 0.2, drive: 2.5, width: 0.6 },
            sub: { level: 0.7, decay: 0.12, sustain: 0.2, release: 0.04 },
            mid: { kind: "saw", level: 1.5, cutoff: 380, env: 0.9, q: 7, decay: 0.09, sustain: 0.1, release: 0.04, drive: 4, detune: 4, hp: 70, bend: 0 },
            vox: { level: 0.9, q: 14, breath: 0, bend: 0, scoop: 0.01, release: 0.04, lp: 2200 },
            groove: { hatLate: 0.02, percLate: 0.04, jitter: 0.5, ghost: 0.9, perc: 1.2, open: 0.6, offOpen: 0.6, metal: 1.5, tamb: 0, ghostKick: 0.9 },
          },
          kit: { ...KIT, kick: { ...KICK, drive: 1.6, decay: 0.22 }, hat: { ...KIT.hat, metal: 0.6 } },
          vinyl: 0,
          mix: {},
          fx: { ...FX, echo: { steps: 3, taps: 4, fb: 0.45, lp: 3000, hp: 500 } },
        },
      },
      // Hypnotic minimal: a sparse sub-heavy line (a b2 slide, a tritone at the phrase end), a tritone stab twice in
      // two bars thrown into the echo, a slowly breathing drone, a low arp ticking on the 8ths, metallic percussion;
      // the filters breathe over 32 bars.
      {
        id: "imd-dark-tritone",
        name: "Tritone Hypnosis",
        base: "classic",
        bpm: [120, 125],
        swing: 0.54,
        microScale: 0.1,
        trim: 1.09,
        riser: 0,
        data: {
          chords: [
            { bass: 0, pad: [0, 3, 7], guide: 3, dark: [0, 7, 15] }, // i
            { bass: 0, pad: [0, 6, 12], guide: 6, dark: [0, 6, 12] }, // the tritone
          ],
          progressions: [[0, 1]],
          kicks: { lo: [[0, 4, 8, 12]], mid: [[0, 4, 8, 12]], hi: [[0, 4, 8, 12], [0, 4, 8, 11, 12]] },
          skips: [[[7, 0.3], [23, 0.3], [15, 0.25]]],
          stabs: [[{ s: 6, len: 1, vel: 0.9, core: true }, { s: 22, len: 1, vel: 0.7, core: false }]],
          basslines: [
            [
              { s: 3, len: 1, semi: 0, vel: 0.9, core: true }, { s: 6, len: 2, semi: 0, vel: 0.8, core: true },
              { s: 10, len: 1, semi: 12, vel: 0.7, core: true, glide: true }, { s: 11, len: 1, semi: 0, vel: 0.8, core: true },
              { s: 14, len: 1, semi: 1, vel: 0.7, core: true, glide: true }, { s: 19, len: 1, semi: 0, vel: 0.9, core: true },
              { s: 22, len: 2, semi: 0, vel: 0.8, core: true }, { s: 26, len: 1, semi: 12, vel: 0.7, core: true },
              { s: 27, len: 1, semi: 0, vel: 0.8, core: true }, { s: 30, len: 1, semi: 6, vel: 0.7, core: true, glide: true },
            ],
          ],
          motifs: [[2, 6, 10, 14, 18, 22, 26, 30].map((s, i) => ({ s, len: 1, tone: [0, 1, 0, 2, 0, 1, 2, 1][i], core: true }))],
          ukg: {
            ...QUIET,
            keys: [0, 2, 6],
            scale: "dark",
            midEarly: 1,
            sweep: { bars: 32, depth: 0.7 },
            stab: { level: 1.5, voices: 3, detune: 15, osc2: 0, cutoff: 1800, q: 2, slope: 24, env: 0.4, fdecay: 0.2, decay: 0.25, sustain: 0, release: 0.4, drive: 1.5, width: 0.8 },
            sub: { level: 1, decay: 0.3, sustain: 0.5, release: 0.08 },
            mid: { kind: "saw", level: 1.2, cutoff: 450, env: 0.5, q: 3, decay: 0.15, sustain: 0.2, release: 0.06, drive: 2.5, detune: 6, hp: 80, bend: 0 },
            pluck: { level: 0.9, wave: "triangle", cutoff: 1200, env: 0.3, decay: 0.15, release: 0.2, bend: 0, pan: 0.4 },
            strings: { level: 1.4, detune: 25, cutoff: 800, attack: 3, release: 4, hold: 1 },
            groove: { hatLate: 0.04, percLate: 0.06, jitter: 0.6, ghost: 0.5, perc: 0.9, open: 0.5, offOpen: 0.5, metal: 1.5, tamb: 0, ghostKick: 0.4 },
          },
          kit: KIT,
          vinyl: 0,
          mix: {},
          fx: { ...FX, echoSend: { ...FX.echoSend, lead: 0.45 } },
        },
      },
      // Cold EBM body music: a sequenced 16th machine bass (every 16th, fixed accents, the octave on the off-beat of
      // beats 2 and 4, a fifth into each bar), no slides, no swing; one chord a bar walking i - bVI - bII in Phrygian,
      // a hard dry clap, a short flat echo, a low cold drone, a clipped stab twice in two bars.
      {
        id: "imd-dark-body",
        name: "Iron Body",
        base: "classic",
        bpm: [120, 121],
        swing: 0.5,
        microScale: 0,
        trim: 1.04,
        riser: 0,
        data: {
          chords: [
            { bass: 0, pad: [0, 3, 7], guide: 3, dark: [0, 7, 15] }, // i
            { bass: 8, pad: [0, 3, 8], guide: 0, dark: [8, 15, 20] }, // bVI
            { bass: 1, pad: [1, 5, 8], guide: 5, dark: [1, 8, 13] }, // bII
          ],
          progressions: [[0, 0, 1, 0, 0, 0, 2, 2]],
          kicks: { lo: [[0, 4, 8, 12]], mid: [[0, 4, 8, 12]], hi: [[0, 4, 8, 12], [0, 4, 8, 12, 14]] },
          skips: [[[14, 0.25], [30, 0.3]]],
          stabs: [[{ s: 10, len: 0.5, vel: 0.9, core: true }, { s: 23, len: 0.5, vel: 0.7, core: false }, { s: 26, len: 0.5, vel: 0.8, core: true }]],
          basslines: [
            line((s) => {
              const p = s % 4, k = s >> 2;
              if (s === 15 || s === 31) return [7, 0.7];
              return [p === 2 && k % 2 === 1 ? 12 : 0, [0.95, 0.5, 0.8, 0.55][p]];
            }),
          ],
          ukg: {
            ...QUIET,
            bars: 1,
            keys: [1, 3],
            scale: "phrygian",
            midEarly: 1,
            turn: 0,
            sweep: { bars: 16, depth: 0.3 },
            stab: { level: 1.3, voices: 1, detune: 0, osc2: 0, cutoff: 1100, q: 5, slope: 24, env: 0.5, fdecay: 0.06, decay: 0.08, sustain: 0, release: 0.08, drive: 3, width: 0.3 },
            sub: { level: 0.6, decay: 0.1, sustain: 0.2, release: 0.03 },
            mid: { kind: "saw", level: 1.3, cutoff: 600, env: 0.55, q: 4.5, decay: 0.07, sustain: 0.1, release: 0.03, drive: 3.5, detune: 3, hp: 90, bend: 0 },
            strings: { level: 0.7, detune: 8, cutoff: 600, attack: 2.5, release: 3, hold: 1 },
            groove: { hatLate: 0, percLate: 0.02, jitter: 0, ghost: 0.4, perc: 0.5, open: 0.3, offOpen: 0, metal: 1, tamb: 0, ghostKick: 0 },
          },
          kit: {
            ...KIT,
            kick: { start: 180, end: 50, sweep: 0.03, decay: 0.2, click: 0.35, clickHp: 3000, drive: 2.2, body: 1.1 },
            snare: [
              { noise: "bandpass", freq: 1300, q: 0.9, decay: 0.09, level: 1.4 },
              { clap: 1.5 },
              { tone: "square", freq: 220, to: 180, decay: 0.03, level: 0.3 },
              { noise: "highpass", freq: 3000, q: 0.7, decay: 0.06, level: 0.6 },
            ],
            hat: { hp: 9500, decay: 0.02, metal: 0.6, level: 0.45 },
          },
          vinyl: 0,
          mix: {},
          fx: { ...FX, echo: { steps: 2, taps: 3, fb: 0.35, lp: 2000, hp: 500 }, space: { size: 1.1, fb: 0.65, lp: 3000 }, drive: 1.3 },
        },
      },
      // A hypnotic indie-dance roller: a long off-beat bass phrase over two bars (a b2 kick-up, a tritone slide home),
      // a chord every two bars over 16 (i - iv - bII), a dissonant stab (root, fifth, b9) answering the bass into a
      // dotted echo, open hats on the off-beats, a cold drone; the filters build over 32 bars and a reese takes over
      // the mid bass in the drop's second half.
      {
        id: "imd-dark-roller",
        name: "Night Roller",
        base: "classic",
        bpm: [120, 124],
        swing: 0.52,
        microScale: 0.08,
        trim: 1.18,
        riser: 0,
        data: {
          chords: [
            { bass: 0, pad: [0, 7, 13], guide: 7, dark: [0, 7, 13] }, // i (root, fifth, b9)
            { bass: 5, pad: [0, 5, 8], guide: 8, dark: [5, 12, 20] }, // iv
            { bass: 1, pad: [1, 5, 8], guide: 5, dark: [1, 8, 13] }, // bII
          ],
          progressions: [[0, 0, 0, 1, 0, 0, 2, 1]],
          kicks: { lo: [[0, 4, 8, 12]], mid: [[0, 4, 8, 12], [0, 4, 8, 11, 12]], hi: [[0, 4, 8, 12], [0, 4, 8, 12, 14]] },
          skips: [[[7, 0.25], [15, 0.3], [31, 0.3]]],
          stabs: [[{ s: 7, len: 1, vel: 0.85, core: true }, { s: 15, len: 0.5, vel: 0.5, core: false }, { s: 27, len: 1, vel: 0.75, core: true }]],
          basslines: [
            [
              { s: 2, len: 1.5, semi: 0, vel: 0.9, core: true }, { s: 5, len: 0.5, semi: 0, vel: 0.55, core: true },
              { s: 6, len: 1.5, semi: 12, vel: 0.85, core: true }, { s: 10, len: 1.5, semi: 0, vel: 0.9, core: true },
              { s: 13, len: 0.5, semi: 1, vel: 0.6, core: true }, { s: 14, len: 1.5, semi: 7, vel: 0.85, core: true, glide: true },
              { s: 18, len: 1.5, semi: 0, vel: 0.9, core: true }, { s: 21, len: 0.5, semi: 0, vel: 0.55, core: false },
              { s: 22, len: 1, semi: 13, vel: 0.85, core: true, glide: true }, { s: 23, len: 0.75, semi: 12, vel: 0.7, core: true },
              { s: 26, len: 1.5, semi: 0, vel: 0.9, core: true }, { s: 29, len: 0.5, semi: 7, vel: 0.6, core: true },
              { s: 30, len: 1, semi: 6, vel: 0.8, core: true, glide: true },
              { s: 31, len: 1, semi: 0, vel: 0.75, core: true, glide: true },
            ],
          ],
          ukg: {
            ...QUIET,
            keys: [9, 11],
            scale: "dark",
            midEarly: 1,
            turn: 0,
            sweep: { bars: 32, depth: 0.8 },
            stab: { level: 1.4, voices: 2, detune: 10, osc2: 0, cutoff: 1600, q: 3.5, slope: 24, env: 0.5, fdecay: 0.12, decay: 0.15, sustain: 0, release: 0.25, drive: 2, width: 0.7 },
            sub: { level: 0.75, decay: 0.15, sustain: 0.3, release: 0.05, glide: 0.06 },
            mid: { kind: "saw", level: 1.2, cutoff: 420, env: 0.75, q: 5, decay: 0.12, sustain: 0.15, release: 0.05, drive: 3.5, detune: 5, hp: 80, bend: 0 },
            drop2: { kind: "reese", level: 1.1, cutoff: 650, env: 0.5, q: 3, decay: 0.2, sustain: 0.3, release: 0.06, drive: 3, detune: 14, hp: 80, bend: 0 },
            strings: { level: 0.9, detune: 18, cutoff: 700, attack: 3, release: 4, hold: 1 },
            groove: { hatLate: 0.02, percLate: 0.04, jitter: 0.4, ghost: 0.5, perc: 0.7, open: 0.3, offOpen: 0.4, metal: 0.6, tamb: 0, ghostKick: 0.3 },
          },
          kit: KIT,
          vinyl: 0,
          mix: {},
          fx: { ...FX, echo: { steps: 3, taps: 6, fb: 0.55, lp: 2200, hp: 450 }, echoSend: { ...FX.echoSend, lead: 0.5 } },
        },
      },
      // Dub-wise dark disco at 120: a deep, long sub under a gritty FM mid bass on a sparse line (the root held, a b7
      // slide, a minor-third pickup), a clustered stab (the 9th grinding on the minor 3rd) twice in two bars into a
      // long dark echo, metallic ticks and rims in the gaps, low hats; mostly bass and drums, no drone, no melody.
      {
        id: "imd-dark-dub",
        name: "Echo Cellar",
        base: "classic",
        bpm: [120, 120],
        swing: 0.55,
        microScale: 0.12,
        trim: 1.02,
        riser: 0,
        data: {
          chords: [
            { bass: 0, pad: [0, 2, 3, 7], guide: 3, dark: [0, 7, 15] }, // i add9
            { bass: 5, pad: [0, 5, 7, 8], guide: 8, dark: [5, 12, 20] }, // iv over its fifth, the b6 against the 5th
          ],
          progressions: [[0, 0, 0, 1]],
          kicks: { lo: [[0, 4, 8, 12]], mid: [[0, 4, 8, 12]], hi: [[0, 4, 8, 12], [0, 4, 8, 10, 12]] },
          skips: [[[7, 0.2], [23, 0.25]]],
          stabs: [[{ s: 10, len: 0.5, vel: 0.9, core: true }, { s: 29, len: 0.5, vel: 0.6, core: true }]],
          basslines: [
            [
              { s: 0, len: 3, semi: 0, vel: 0.95, core: true }, { s: 6, len: 1, semi: 0, vel: 0.7, core: true },
              { s: 10, len: 2, semi: -2, vel: 0.75, core: true, glide: true }, { s: 13, len: 1, semi: 0, vel: 0.6, core: false },
              { s: 16, len: 4, semi: 0, vel: 0.9, core: true }, { s: 22, len: 1, semi: 3, vel: 0.7, core: true },
              { s: 23, len: 1.5, semi: 0, vel: 0.75, core: true, glide: true }, { s: 27, len: 1, semi: 12, vel: 0.6, core: false },
              { s: 30, len: 1.5, semi: 0, vel: 0.7, core: true },
            ],
          ],
          ukg: {
            ...QUIET,
            keys: [8, 10],
            scale: "minor",
            midEarly: 1,
            sweep: { bars: 16, depth: 0.5 },
            stab: { level: 1.4, voices: 3, detune: 12, osc2: 0, cutoff: 1300, q: 2.5, slope: 24, env: 0.45, fdecay: 0.15, decay: 0.12, sustain: 0, release: 0.3, drive: 1.8, width: 0.8 },
            sub: { level: 1.2, decay: 0.6, sustain: 0.6, release: 0.12, drive: 0.8, glide: 0.09, bend: 1, bendTime: 0.06 },
            mid: { kind: "fm", level: 1, cutoff: 700, env: 0.4, q: 2, decay: 0.2, sustain: 0.25, release: 0.06, drive: 3.5, ratio: 1, index: 4, fmDecay: 0.12, floor: 0.3, hp: 110, bend: 0 },
            groove: { hatLate: 0.05, percLate: 0.08, jitter: 0.6, ghost: 0.5, perc: 1.2, open: 0.4, offOpen: 0, metal: 1.5, tamb: 0, ghostKick: 0.3 },
          },
          kit: { ...KIT, kick: { ...KICK, end: 44, decay: 0.32, drive: 1.2, body: 1.3 }, hat: { ...KIT.hat, level: 0.35 } },
          vinyl: 0,
          mix: {},
          fx: {
            ...FX,
            echo: { steps: 3, taps: 8, fb: 0.62, lp: 1800, hp: 500 },
            echoSend: { ...FX.echoSend, lead: 0.7, perc: 0.35 },
            space: { size: 2.2, fb: 0.8, lp: 3000 },
          },
        },
      },
    ],
    electro: [
      // Abyssal Drift (first written for the hamster's dark electro set; the owner picked it for the IDM station).
      // Deep aquatic electro: a boomy deep 808 with little click, a muffled snare, low quiet hats; the bass rolls
      // in octaves with slides and chromatic b2 passing notes, a dark drowned pad breathes over two-bar chords
      // (i, bVI, bII, iv and an i with a minor-second cluster); everything sinks into a dark dub echo and a big room.
      {
        id: "imd-dark-abyss",
        name: "Abyssal Drift",
        base: "client03",
        bpm: [122, 127],
        swing: 0.53,
        microScale: 0.2,
        trim: 0.712,
        riser: 0,
        data: {
          chords: [
            { bass: 0, third: 3, seventh: 10, tones: [0, 7, 15] },
            { bass: -4, third: 4, seventh: 11, tones: [0, 8, 15] },
            { bass: 1, third: 4, seventh: 11, tones: [1, 8, 13] },
            { bass: 5, third: 3, seventh: 10, tones: [0, 8, 17] },
            { bass: -5, third: 3, seventh: 10, tones: [2, 10, 19] },
            { bass: 0, third: 3, seventh: 10, tones: [1, 7, 15] },
          ],
          progressions: [[0, 0, 5, 0], [0, 1, 0, 2], [0, 3, 1, 2], [0, 5, 3, 1]],
          kicks: {
            half: [[0, 16, 26]],
            lo: [[0, 10, 16, 26], [0, 11, 16, 27]],
            mid: [[0, 6, 10, 16, 22, 27], [0, 10, 13, 16, 26, 29]],
            hi: [[0, 3, 6, 10, 16, 19, 22, 26, 29], [0, 6, 10, 11, 16, 22, 26, 27, 30]],
          },
          ghosts: [
            [{ s: 7, vel: 0.3, core: true }, { s: 15, vel: 0.26, core: false }, { s: 23, vel: 0.3, core: true }, { s: 29, vel: 0.24, core: false }],
            [{ s: 3, vel: 0.26, core: false }, { s: 9, vel: 0.3, core: true }, { s: 25, vel: 0.3, core: true }, { s: 31, vel: 0.24, core: false }],
          ],
          warps: [[1, 0.92, 1.04, 0.9, 1, 0.9, 1.06, 0.92, 1, 0.92, 1.04, 0.9, 1, 0.88, 1.08, 0.92]],
          chops: [{ open: 14, steps: [] }, { open: 6, steps: [15] }],
          riffs: [
            [
              { s: 0, semi: 0, len: 2, f: 1 }, { s: 3, semi: 0, len: 1, f: 8 }, { s: 4, semi: 12, len: 1, f: 2 },
              { s: 6, semi: 10, len: 2, f: 0 }, { s: 8, semi: 0, len: 2, f: 1 }, { s: 11, semi: 3, len: 1, f: 4 },
              { s: 12, semi: 1, len: 2, f: 2 }, { s: 14, semi: 0, len: 2, f: 1 },
              { s: 16, semi: 0, len: 2, f: 1 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 20, semi: 7, len: 1, f: 0 },
              { s: 22, semi: 10, len: 1, f: 2 }, { s: 23, semi: 12, len: 2, f: 1 }, { s: 26, semi: 0, len: 1, f: 8 },
              { s: 27, semi: 15, len: 1, f: 4 }, { s: 28, semi: 13, len: 2, f: 2 }, { s: 30, semi: 12, len: 1, f: 0 },
            ],
            [
              { s: 0, semi: 0, len: 4, f: 1 }, { s: 5, semi: 0, len: 1, f: 8 }, { s: 6, semi: 12, len: 2, f: 2 },
              { s: 9, semi: 10, len: 1, f: 0 }, { s: 10, semi: 7, len: 3, f: 1 }, { s: 14, semi: 6, len: 2, f: 6 },
              { s: 16, semi: 0, len: 3, f: 1 }, { s: 20, semi: 0, len: 1, f: 8 }, { s: 22, semi: -2, len: 2, f: 1 },
              { s: 25, semi: 0, len: 1, f: 2 }, { s: 26, semi: 3, len: 2, f: 1 }, { s: 29, semi: 1, len: 1, f: 4 },
              { s: 30, semi: 0, len: 2, f: 2 },
            ],
          ],
          words: [
            { s: 2, syl: [[300, 870, null], [450, 800, "t"], [330, 650, null]] },
            { s: 10, syl: [[570, 840, "k"], [300, 870, "s"]] },
          ],
          kit: {
            kick: { start: 118, end: 42, sweep: 0.065, decay: 0.56, click: 0.12, clickHp: 1800, drive: 1.2, body: 1.15 },
            snare: [
              { tone: "triangle", freq: 180, to: 148, sweep: 0.04, decay: 0.12, level: 0.6 },
              { noise: "bandpass", freq: 1400, q: 0.8, decay: 0.16, level: 0.5 },
              { clap: 0.2, at: 0.005 },
            ],
            ghost: [
              { noise: "bandpass", freq: 1200, q: 1.2, decay: 0.04, level: 0.34, tail: true },
              { tone: "triangle", freq: 380, to: 340, sweep: 0.02, decay: 0.03, level: 0.2 },
            ],
            hat: { hp: 6800, decay: 0.018, metal: 0.35, q: 0.9 },
            open: { hp: 5200, decay: 0.12, metal: 0.3, q: 0.9, level: 0.36 },
            accents: [0.32, 0.22, 0.42, 0.24],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -10, level: 0.42 }, { type: "square", detune: 9, level: 0.32 }],
            cutoff: 130, color: 180, q: [5, 7.5], open: [3.5, 6], decay: [0.12, 0.2], drive: 2, level: [0.16, 0.19], sub: [1.35, 1.5], glide: 0.07,
          },
          pad: {
            osc: [{ type: "triangle", detune: -14, level: 0.5 }, { type: "sawtooth", detune: 12, level: 0.22 }],
            cutoff: 520, q: 2.2, attack: 1.6, release: 1.2, level: 0.13,
          },
          voice: { pitch: 92, bits: 4, hp: 250, lp: 2400, level: 0.07 },
          ornament: { vowels: [[330, 650], [450, 800]], wave: "square", steps: 4, octave: -12, lowpass: 1600, echo: { steps: 3, feedback: 0.45 }, level: 0.06 },
          fx: {
            echo: { steps: 3, taps: 6, fb: 0.55, lp: 1800, hp: 350 },
            echoSend: { perc: 0.45, lead: 0.6, snare: 0.1 },
            space: { size: 1.8, fb: 0.72, lp: 3200 },
            spaceSend: { lead: 0.45, snare: 0.22, perc: 0.3, hat: 0.08 },
            drumLp: 9000,
            drive: 1.1,
            duck: { bass: 0.5, harm: 0.8 },
            master: { lp: 9000 },
          },
          mix: { hat: -2, harm: 2 },
        },
      },
    ],
  },
} satisfies StationPack;
