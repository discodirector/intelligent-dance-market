import type { StationPack } from "../pack.ts";

// Hamster UKG: energetic synth UK garage / 2-step for Squeekchain's running wheel. The late-90s set
// (hamster-ukg90-*) plays on the hamster station since 2026-10-27 in place of hamster-garage.ts; the v2 synth styles
// are out of rotation. Also the reference pack of the UK garage voices. On the future garage genre's
// UK garage voices (styledata.ts GarageData.ukg, engine.ts garageUkg): no rain, no Burial filter. A kick on 1 and a
// syncopated second kick (never four to the floor), clap-snare on 2 and 4, swung 16th hats pushed later still and
// each hit a little differently, rim and congas in the gaps; short saw chord stabs on minor 7 / minor 9 / major 7 /
// 6/9 / sus voicings, each stab its own velocity; a sub that jumps octaves and slides, a driven mid bass over it.
// Every pitch is in the natural minor over the tonic (validatePack checks the chords and basslines).
// The station's tempo lands at the top of each `bpm` range: the top is the tempo each style wants.
// Swing is the engine's: an odd 16th lands (swing - 0.5) of a 16th late, so 0.62..0.66 is an MPC 56..58%.

// One snappy 2-step kit, each style colouring it.
const KICK = { start: 150, end: 50, sweep: 0.03, decay: 0.26, click: 0.16, clickHp: 3200, drive: 0.4, body: 1.1 };
const SNARE = [
  { tone: "triangle", freq: 210, to: 175, sweep: 0.03, decay: 0.07, level: 0.6 },
  { noise: "bandpass", freq: 1900, q: 0.9, decay: 0.12, level: 0.8 },
  { noise: "highpass", freq: 6000, q: 0.7, decay: 0.06, level: 0.35 },
  { clap: 0.85, at: 0.004 },
] as const;
const GHOST = [
  { tone: "triangle", freq: 780, to: 690, decay: 0.02, level: 0.7 },
  { noise: "bandpass", freq: 3400, q: 1.1, decay: 0.03, level: 0.6 },
] as const;
const FX = {
  // A dotted-1/8 echo: the stab bounces into the next one; the last stab of every fourth bar is thrown (fx bus).
  echo: { steps: 3, taps: 4, fb: 0.42, lp: 4200, hp: 500 },
  echoSend: { kick: 0, bass: 0, snare: 0.05, perc: 0.18, lead: 0.2, harm: 0.08, fx: 0.7 },
  space: { size: 0.8, fb: 0.6, lp: 6500 },
  spaceSend: { kick: 0, bass: 0, snare: 0.14, hat: 0.04, perc: 0.2, lead: 0.2, harm: 0.25, tex: 0, fx: 0.3 },
  drumLp: 17500,
  drive: 1.08,
  pressDrive: 0.1,
  // Sidechain: the bass about -4 dB, the organ (harm) about -6 dB, the stabs (lead) none.
  duck: { bass: 0.6, harm: 0.5 },
  duckTime: { bass: 0.12, harm: 0.2 },
  master: { lp: 16500 },
} as const;

// The late-90s set (hamster-ukg90-*): the owner heard the v2 styles as toy-organ game music. Here the melody is the
// bassline, the chords are keys (M1 organ, FM electric piano, warm low-passed saws, strings in the breakdown) and the
// hook is chopped, stuttered vocal synth; no plucks, no leads. A deep 909-ish kick with weight, snare + clap, crisp
// hats, shaker and tambourine, rimshots, skippy ghost kicks, an MPC ~62% swing (engine swing 0.72..0.76).
const KICK90 = { start: 125, end: 46, sweep: 0.045, decay: 0.42, click: 0.1, clickHp: 2600, drive: 0.6, body: 1.25 };
const SNARE90 = [
  { tone: "triangle", freq: 190, to: 160, sweep: 0.03, decay: 0.08, level: 0.8 },
  { noise: "bandpass", freq: 2200, q: 0.9, decay: 0.1, level: 1.05 },
  { noise: "highpass", freq: 7000, q: 0.7, decay: 0.05, level: 0.42 },
  { clap: 1.25, at: 0.005 },
] as const;
const RIM90 = [
  { tone: "triangle", freq: 820, to: 760, decay: 0.018, level: 0.8 },
  { noise: "bandpass", freq: 3600, q: 1.4, decay: 0.025, level: 0.55 },
] as const;
const KIT90 = {
  kick: KICK90,
  snare: SNARE90,
  ghost: RIM90,
  hat: { hp: 9500, decay: 0.02, metal: 0.15, level: 0.55 },
  shaker: { freq: 9000, q: 1.3, decay: 0.035, attack: 0.004, level: 0.26, off: 0.26 },
  open: { hp: 8000, decay: 0.12, metal: 0.2, level: 0.18 },
};
const FX90 = {
  ...FX,
  spaceSend: { kick: 0, bass: 0, snare: 0.14, hat: 0.04, perc: 0.22, lead: 0.24, harm: 0.4, tex: 0, fx: 0.3 },
  drumLp: 16500,
  duck: { bass: 0.6, harm: 0.45 },
  master: { lp: 15000 },
} as const;
const OFF90 = { pluck: { level: 0 }, lead: { level: 0 }, organ: { level: 0 } } as const;

export default {
  key: "hamster-ukg",
  name: "Hamster UKG",
  genres: ["futuregarage"],
  styles: {
    futuregarage: [
      // MJ Cole / Artful Dodger organ stab garage: saw stabs with an M1-ish organ under them, a buzzing saw mid
      // bass, a bright pluck answering; Fm9 - Dbmaj7 - Abmaj7 - Eb6/9 and Fm7 - Abmaj7 - Bbm7 - Dbmaj7.
      {
        id: "hamster-ukg-organ",
        name: "Organ Stab",
        base: "classic",
        bpm: [130, 135],
        swing: 0.64,
        microScale: 0.15,
        trim: 1.39,
        data: {
          progressions: [[0, 2, 3, 6], [1, 3, 8, 2]],
          kicks: { lo: [[0, 10], [0, 11]], mid: [[0, 10], [0, 3, 10]], hi: [[0, 7, 10], [0, 10, 13]] },
          skips: [[[7, 0.5], [27, 0.45], [15, 0.4], [9, 0.3], [23, 0.35], [31, 0.3], [13, 0.25]]],
          stabs: [
            [
              { s: 2, len: 1, vel: 0.95, core: true }, { s: 7, len: 1.5, vel: 0.72, core: true }, { s: 11, len: 1, vel: 0.88, core: true },
              { s: 14, len: 1, vel: 0.6, core: false }, { s: 18, len: 1, vel: 1, core: true }, { s: 23, len: 2, vel: 0.8, core: true },
              { s: 27, len: 1, vel: 0.66, core: false }, { s: 30, len: 2, vel: 0.85, core: true },
            ],
          ],
          ukg: {
            stab: { voices: 3, detune: 12, osc2: 0.3, cutoff: 3400, q: 1.4, env: 0.35, fdecay: 0.25, decay: 0.28, sustain: 0.12, release: 0.12, drive: 1.1 },
            organ: { level: 1, bars: [1, 0.6, 0.35], chorus: 7, drive: 1.4, cutoff: 4200, decay: 0.3, sustain: 0.25, release: 0.1 },
            mid: { kind: "saw", level: 0.8, cutoff: 520, env: 0.6, decay: 0.15, sustain: 0.2, drive: 2.2 },
            pluck: { level: 0.75, wave: "sawtooth", cutoff: 2800, decay: 0.2, bend: 0.5 },
            groove: { hatLate: 0.12, percLate: 0.1, ghost: 1, perc: 0.8, open: 1 },
          },
          kit: { kick: KICK, snare: SNARE, ghost: GHOST, hat: { hp: 8400, decay: 0.026, metal: 0.25, level: 0.42 }, shaker: { freq: 8200, q: 1.1, decay: 0.04, attack: 0.004, level: 0.22, off: 0.22 }, open: { hp: 7600, decay: 0.13, metal: 0.3, level: 0.2 } },
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, harm: 0, hat: 0 },
          fx: FX,
        },
      },
      // FM womp garage (2-step "bounce"): a sine-on-sine FM mid bass whose index falls in 150 ms (the "womp") over
      // the sub, punchy stabs with a pitch drop, a short "uh / eh" vocal synth; Fm9 - Bbm9 - Cm7 - Dbmaj7.
      {
        id: "hamster-ukg-womp",
        name: "FM Womp",
        base: "classic",
        bpm: [131, 136],
        swing: 0.62,
        microScale: 0.12,
        trim: 1.23,
        data: {
          progressions: [[0, 4, 5, 2], [7, 0, 2, 6]],
          kicks: { lo: [[0, 11], [0, 10]], mid: [[0, 11], [0, 7, 10]], hi: [[0, 7, 11], [0, 3, 10]] },
          skips: [[[11, 0.45], [25, 0.4], [3, 0.4], [29, 0.35], [15, 0.3], [19, 0.25]]],
          stabs: [
            [
              { s: 3, len: 1.5, vel: 1, core: true }, { s: 6, len: 1, vel: 0.7, core: true }, { s: 11, len: 2, vel: 0.9, core: true },
              { s: 19, len: 1.5, vel: 0.95, core: true }, { s: 22, len: 1, vel: 0.68, core: true }, { s: 25, len: 1, vel: 0.6, core: false },
              { s: 29, len: 2, vel: 0.85, core: true },
            ],
          ],
          basslines: [
            [
              { s: 0, len: 2, semi: 0, vel: 1, core: true }, { s: 3, len: 1, semi: 12, vel: 0.8, core: true },
              { s: 7, len: 2, semi: 12, vel: 0.85, core: true, glide: true }, { s: 9, len: 1, semi: 7, vel: 0.7, core: false },
              { s: 11, len: 2, semi: 0, vel: 0.8, core: true, glide: true }, { s: 14, len: 2, semi: 12, vel: 0.75, core: true },
              { s: 18, len: 1, semi: 0, vel: 0.9, core: true }, { s: 22, len: 2, semi: 12, vel: 0.8, core: true, glide: true },
              { s: 25, len: 1, semi: 7, vel: 0.7, core: false }, { s: 27, len: 3, semi: 0, vel: 0.85, core: true, glide: true },
            ],
          ],
          calls: [[{ s: 9, len: 1, vowel: 4, tone: 2, core: true }, { s: 29, len: 2.5, vowel: 2, to: 4, tone: 3, core: true }]],
          ukg: {
            stab: { voices: 2, detune: 10, osc2: 0.4, cutoff: 3000, q: 2, env: 0.45, fdecay: 0.22, decay: 0.22, sustain: 0.08, release: 0.1, punch: 12, punchTime: 0.03, drive: 1.4, width: 0.5 },
            mid: { kind: "fm", level: 0.9, cutoff: 1400, env: 0.3, q: 1, decay: 0.18, sustain: 0.35, release: 0.08, drive: 1.8, ratio: 2, index: 3.5, fmDecay: 0.15, floor: 0.15 },
            pluck: { level: 0 },
            vox: { level: 0.9, q: 8, breath: 0.25, bend: -3, release: 0.08 },
            groove: { hatLate: 0.14, percLate: 0.12, ghost: 1.1, perc: 1, open: 0.8 },
          },
          kit: {
            kick: { ...KICK, start: 160, decay: 0.24, drive: 0.6 },
            snare: SNARE,
            ghost: GHOST,
            hat: { hp: 9000, decay: 0.022, metal: 0.2, level: 0.4 },
            shaker: { freq: 8800, q: 1.3, decay: 0.035, attack: 0.004, level: 0.22, off: 0.22 },
            open: { hp: 8000, decay: 0.11, metal: 0.25, level: 0.18 },
          },
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, hat: 0 },
          fx: FX,
        },
      },
      // Second-drop garage (speed garage / bassline leaning): darker 24 dB stabs, a saw mid bass in the first half of
      // the drop and a reese (two saws ±14 cents, driven) taking the second half and the rebuild, a square + saw lead
      // with portamento on the motif in the drop; Fm7 - Abmaj7 - Bbm7 - Dbmaj7.
      {
        id: "hamster-ukg-reese",
        name: "Second Drop",
        base: "classic",
        bpm: [132, 137],
        swing: 0.62,
        microScale: 0.1,
        trim: 1.28,
        data: {
          progressions: [[1, 3, 8, 2], [0, 2, 3, 6]],
          kicks: { lo: [[0, 10], [0, 10, 14]], mid: [[0, 10], [0, 6, 10]], hi: [[0, 7, 10], [0, 10, 14]] },
          skips: [[[9, 0.45], [23, 0.5], [6, 0.35], [27, 0.3], [31, 0.3], [14, 0.25]]],
          stabs: [
            [
              { s: 3, len: 1, vel: 1, core: true }, { s: 7, len: 1, vel: 0.75, core: true }, { s: 10, len: 2, vel: 0.85, core: true },
              { s: 19, len: 1, vel: 0.95, core: true }, { s: 23, len: 1, vel: 0.7, core: true }, { s: 26, len: 1, vel: 0.62, core: false },
              { s: 30, len: 1.5, vel: 0.8, core: true },
            ],
          ],
          motifs: [
            [
              { s: 2, len: 2, tone: 3, oct: 1, core: true }, { s: 6, len: 2, tone: 2, oct: 1, core: true }, { s: 13, len: 3, tone: 3, oct: 1, core: true },
              { s: 22, len: 2, tone: 1, oct: 1, core: true }, { s: 26, len: 4, tone: 2, oct: 1, core: true },
            ],
          ],
          ukg: {
            stab: { voices: 4, detune: 16, osc2: 0.2, cutoff: 2600, q: 2.5, slope: 24, env: 0.5, fdecay: 0.3, decay: 0.3, sustain: 0.15, release: 0.15, drive: 1.6, width: 0.7 },
            mid: { kind: "saw", level: 0.85, cutoff: 450, env: 0.7, q: 3, decay: 0.16, sustain: 0.25, drive: 2.6 },
            drop2: { kind: "reese", level: 0.9, cutoff: 650, env: 0.35, q: 1.5, decay: 0.3, sustain: 0.55, release: 0.1, drive: 2.8, detune: 14 },
            pluck: { level: 0.6, wave: "square", cutoff: 2400, decay: 0.18 },
            lead: { level: 0.8, glide: 0.05, detune: 8, cutoff: 3200, release: 0.15 },
            groove: { hatLate: 0.1, percLate: 0.08, ghost: 0.9, perc: 0.7, open: 1.1 },
          },
          kit: {
            kick: { ...KICK, start: 145, end: 47, decay: 0.3, drive: 0.5, body: 1.15 },
            snare: SNARE,
            ghost: GHOST,
            hat: { hp: 8800, decay: 0.02, metal: 0.3, level: 0.41 },
            shaker: { freq: 7600, q: 1.2, decay: 0.035, attack: 0.006, level: 0.2, off: 0.2 },
            open: { hp: 7600, decay: 0.12, metal: 0.3, level: 0.2 },
          },
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, hat: 0 },
          fx: FX,
        },
      },
      // Vocal-chop garage (Todd Edwards / MJ Cole vocal side): "yeah / oh" formant calls closing every two bars over
      // bright stabs and a soft organ, a bouncy sub with slides, a triangle pluck in ping-pong; Fsus4 - Fm9 - Dbmaj7 - Eb6/9.
      {
        id: "hamster-ukg-vox",
        name: "Vocal Chop",
        base: "classic",
        bpm: [129, 134],
        swing: 0.66,
        microScale: 0.15,
        trim: 1.31,
        data: {
          progressions: [[7, 0, 2, 6], [0, 2, 3, 6]],
          kicks: { lo: [[0, 10], [0, 11]], mid: [[0, 10], [0, 7, 10]], hi: [[0, 7, 10], [0, 3, 11]] },
          skips: [[[7, 0.5], [15, 0.4], [27, 0.45], [11, 0.3], [23, 0.35], [3, 0.25], [19, 0.25]]],
          stabs: [
            [
              { s: 2, len: 1.5, vel: 0.9, core: true }, { s: 6, len: 1, vel: 0.7, core: true }, { s: 10, len: 1, vel: 0.85, core: true },
              { s: 18, len: 1.5, vel: 1, core: true }, { s: 22, len: 1, vel: 0.72, core: true }, { s: 26, len: 1, vel: 0.65, core: false },
            ],
          ],
          calls: [
            [{ s: 13, len: 1.5, vowel: 2, tone: 3, core: true }, { s: 29, len: 2.5, vowel: 0, to: 1, tone: 3, core: true }],
            [{ s: 9, len: 1, vowel: 4, tone: 2, core: true }, { s: 28, len: 3, vowel: 3, to: 1, tone: 4, core: true }],
          ],
          motifs: [
            [
              { s: 4, len: 1, tone: 2, oct: 1, core: true }, { s: 8, len: 1, tone: 3, oct: 1, core: true }, { s: 15, len: 1, tone: 4, oct: 1, core: false },
              { s: 20, len: 1, tone: 2, oct: 1, core: true }, { s: 24, len: 2, tone: 1, oct: 1, core: true },
            ],
          ],
          ukg: {
            stab: { voices: 3, detune: 14, osc2: 0.35, cutoff: 3800, q: 1.2, env: 0.3, fdecay: 0.25, decay: 0.32, sustain: 0.18, release: 0.14, drive: 0.9 },
            organ: { level: 0.6, bars: [1, 0.4, 0.2], chorus: 5, drive: 1, cutoff: 3600, decay: 0.4, sustain: 0.3, release: 0.12 },
            sub: { glide: 0.09 },
            mid: { kind: "saw", level: 0.6, cutoff: 420, env: 0.5, drive: 1.6 },
            pluck: { level: 0.7, wave: "triangle", cutoff: 3200, env: 0.6, decay: 0.25, release: 0.2, pan: 0.75 },
            vox: { level: 1, q: 9, breath: 0.3, bend: -2, release: 0.1 },
            groove: { hatLate: 0.13, percLate: 0.12, ghost: 1.1, perc: 0.9, open: 0.9 },
          },
          vowels: [[300, 2300], [760, 1150], [560, 1800], [500, 850], [640, 1190]],
          kit: { kick: KICK, snare: SNARE, ghost: GHOST, hat: { hp: 8600, decay: 0.024, metal: 0.2, level: 0.4 }, shaker: { freq: 8000, q: 1.2, decay: 0.04, attack: 0.005, level: 0.22, off: 0.22 }, open: { hp: 7800, decay: 0.12, metal: 0.25, level: 0.18 } },
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, hat: 0 },
          fx: FX,
        },
      },
      // Double 99 "RIP Groove" / speed garage: sparse M1 organ stabs in the middle register (sine + octave, key
      // click, grit), a warp bass (a driven, filtered saw that falls an octave into every note, sliding) over a
      // bouncing sub as the tune, "y-y-yeah" closing the two bars; mostly the i m7 vamp.
      {
        id: "hamster-ukg90-organ",
        name: "RIP Organ",
        base: "classic",
        bpm: [128, 133],
        swing: 0.74,
        microScale: 0.15,
        trim: 1.05,
        riser: 0,
        heat: 0.5,
        data: {
          chords: [
            { bass: 0, pad: [-5, -2, 3, 7], guide: 3, dark: [0, 7, 15] }, // i m7 from the fifth
            { bass: 0, pad: [-2, 2, 3, 7], guide: 3, dark: [0, 7, 15] }, // i m9
            { bass: 8, pad: [-4, 0, 3, 7], guide: 7, dark: [3, 8, 12] }, // bVI maj7
            { bass: 7, pad: [-5, -2, 2, 5], guide: 5, dark: [7, 14, 22] }, // v m7
            { bass: 5, pad: [-7, -4, 0, 3], guide: 3, dark: [5, 12, 20] }, // iv m7
          ],
          progressions: [[0, 0, 4, 1], [0, 2, 3, 0]],
          kicks: { lo: [[0, 10]], mid: [[0, 10], [0, 7, 10]], hi: [[0, 7, 10], [0, 10, 14]] },
          skips: [[[7, 0.5], [15, 0.45], [27, 0.5], [9, 0.35], [23, 0.4], [31, 0.35], [13, 0.3], [3, 0.3]]],
          stabs: [
            [
              { s: 2, len: 1, vel: 0.95, core: true }, { s: 6, len: 1, vel: 0.7, core: false }, { s: 11, len: 1.5, vel: 0.9, core: true },
              { s: 18, len: 1, vel: 1, core: true }, { s: 22, len: 1, vel: 0.72, core: true }, { s: 27, len: 1.5, vel: 0.85, core: true },
              { s: 30, len: 1, vel: 0.6, core: false },
            ],
          ],
          basslines: [
            [
              { s: 0, len: 1.5, semi: 0, vel: 1, core: true }, { s: 3, len: 1, semi: 12, vel: 0.8, core: true, glide: true },
              { s: 5, len: 1, semi: 0, vel: 0.7, core: true }, { s: 7, len: 2, semi: 12, vel: 0.85, core: true, glide: true },
              { s: 11, len: 1, semi: 7, vel: 0.8, core: true }, { s: 13, len: 2, semi: 0, vel: 0.85, core: true, glide: true },
              { s: 16, len: 1, semi: 0, vel: 0.95, core: true }, { s: 18, len: 1, semi: 12, vel: 0.75, core: true, glide: true },
              { s: 21, len: 1, semi: 0, vel: 0.7, core: false }, { s: 22, len: 2, semi: 7, vel: 0.8, core: true },
              { s: 25, len: 1, semi: 12, vel: 0.75, core: true, glide: true }, { s: 27, len: 1.5, semi: 0, vel: 0.85, core: true },
              { s: 30, len: 2, semi: 12, vel: 0.8, core: false, glide: true },
            ],
          ],
          calls: [[{ s: 9, len: 0.75, vowel: 4, tone: 2, core: false }, { s: 28, len: 2, vowel: 0, to: 1, tone: 2, rep: 2, core: true }]],
          ukg: {
            ...OFF90,
            stab: { level: 0 },
            m1: { level: 1, octave: 0, cutoff: 2400, drive: 1.8, click: 0.6, decay: 0.2, sustain: 0.2, release: 0.06 },
            sub: { level: 1, glide: 0.1 },
            mid: { kind: "saw", level: 1, cutoff: 420, env: 0.6, q: 2.5, decay: 0.2, sustain: 0.35, release: 0.08, drive: 2.8, detune: 6, bend: 12, bendTime: 0.14 },
            vox: { level: 0.8, q: 9, breath: 0.35, bend: -3, scoop: 0.03, release: 0.06, lp: 4200 },
            groove: { hatLate: 0.08, percLate: 0.08, ghost: 1, perc: 1, open: 1, tamb: 0.8, ghostKick: 0.8 },
          },
          kit: KIT90,
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, hat: 0 },
          fx: FX90,
        },
      },
      // MJ Cole "Sincere" / Artful Dodger "Re-Rewind": FM electric piano chords (a ratio-1 tine that barks and settles)
      // on wide R&B voicings, a bouncing sub with octave jumps and a warm low saw under it, stuttered vocal-synth
      // calls as the hook, strings swelling in the breakdown; the heaviest swing of the set.
      {
        id: "hamster-ukg90-rhodes",
        name: "Rhodes 2-Step",
        base: "classic",
        bpm: [127, 132],
        swing: 0.76,
        microScale: 0.2,
        trim: 1.1,
        riser: 0,
        heat: 0.5,
        data: {
          progressions: [[0, 2, 3, 6], [1, 3, 8, 2]],
          kicks: { lo: [[0, 10]], mid: [[0, 10], [0, 11]], hi: [[0, 7, 10], [0, 3, 11]] },
          skips: [[[7, 0.5], [27, 0.45], [15, 0.4], [11, 0.3], [23, 0.35], [31, 0.3], [3, 0.25], [19, 0.25]]],
          stabs: [
            [
              { s: 2, len: 2, vel: 0.85, core: true }, { s: 7, len: 1.5, vel: 0.7, core: true }, { s: 11, len: 3, vel: 0.9, core: true },
              { s: 18, len: 2, vel: 0.95, core: true }, { s: 23, len: 1.5, vel: 0.7, core: true }, { s: 27, len: 3, vel: 0.8, core: true },
            ],
          ],
          basslines: [
            [
              { s: 0, len: 2, semi: 0, vel: 1, core: true }, { s: 3, len: 1, semi: 12, vel: 0.8, core: true },
              { s: 6, len: 1, semi: 0, vel: 0.7, core: true, glide: true }, { s: 8, len: 1, semi: 7, vel: 0.7, core: false },
              { s: 11, len: 1.5, semi: 12, vel: 0.85, core: true, glide: true }, { s: 14, len: 1, semi: 7, vel: 0.75, core: true },
              { s: 16, len: 2, semi: 0, vel: 0.95, core: true }, { s: 19, len: 1, semi: 12, vel: 0.8, core: true },
              { s: 22, len: 1, semi: 0, vel: 0.75, core: true, glide: true }, { s: 24, len: 1, semi: 12, vel: 0.7, core: false },
              { s: 26, len: 1.5, semi: 7, vel: 0.8, core: true }, { s: 29, len: 2, semi: 12, vel: 0.8, core: true, glide: true },
            ],
          ],
          calls: [
            [
              { s: 6, len: 1, vowel: 2, tone: 3, core: true }, { s: 13, len: 1.5, vowel: 0, to: 1, tone: 2, rep: 2, core: true },
              { s: 22, len: 0.75, vowel: 4, tone: 3, core: true }, { s: 29, len: 2, vowel: 3, to: 1, tone: 4, rep: 1, core: true },
            ],
          ],
          ukg: {
            ...OFF90,
            stab: { level: 0 },
            ep: { level: 1, octave: 0, ratio: 1, index: 1.8, floor: 0.12, decay: 0.5, chorus: 7, cutoff: 3800, release: 0.35 },
            strings: { level: 0.8, detune: 12, cutoff: 2200, attack: 1.5, release: 1.8 },
            sub: { level: 1.05, glide: 0.08 },
            mid: { kind: "saw", level: 0.45, cutoff: 300, env: 0.4, q: 1.2, decay: 0.2, sustain: 0.4, drive: 1.5, bend: 0 },
            vox: { level: 0.9, q: 10, breath: 0.3, bend: -2, scoop: 0.03, release: 0.07, lp: 4800 },
            groove: { hatLate: 0.1, percLate: 0.1, ghost: 1.1, perc: 0.7, open: 0.8, tamb: 0.6, ghostKick: 0.5 },
          },
          kit: KIT90,
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, hat: 0 },
          fx: FX90,
        },
      },
      // Tuff Jam / Dem 2 dub, speed garage: few chords (warm detuned saws low-passed at 1.5 kHz, 24 dB), a deep reese
      // under the sub, the warp bass taking the second half of the drop, rimshots, shakers and tambourine up front,
      // ghost kicks, one dark "oh" a phrase; i m7 against iv m7 and v m7.
      {
        id: "hamster-ukg90-dub",
        name: "Dub Pressure",
        base: "classic",
        bpm: [129, 134],
        swing: 0.72,
        microScale: 0.15,
        trim: 0.98,
        riser: 0,
        heat: 0.5,
        data: {
          progressions: [[1, 1, 8, 8], [1, 5, 1, 8]],
          kicks: { lo: [[0, 10], [0, 10, 14]], mid: [[0, 10], [0, 6, 10]], hi: [[0, 7, 10], [0, 10, 14]] },
          skips: [[[9, 0.5], [23, 0.5], [6, 0.4], [27, 0.4], [31, 0.35], [14, 0.3], [3, 0.3]]],
          stabs: [[{ s: 3, len: 1, vel: 1, core: true }, { s: 14, len: 1.5, vel: 0.75, core: true }, { s: 19, len: 1, vel: 0.9, core: true }, { s: 30, len: 1.5, vel: 0.7, core: false }]],
          basslines: [
            [
              { s: 0, len: 3, semi: 0, vel: 1, core: true }, { s: 6, len: 1, semi: 12, vel: 0.8, core: true, glide: true },
              { s: 7, len: 2, semi: 0, vel: 0.85, core: true, glide: true }, { s: 11, len: 1, semi: 0, vel: 0.8, core: true },
              { s: 13, len: 2, semi: 7, vel: 0.8, core: true, glide: true }, { s: 16, len: 2, semi: 0, vel: 0.95, core: true },
              { s: 19, len: 1, semi: 12, vel: 0.75, core: true }, { s: 21, len: 2, semi: 0, vel: 0.8, core: true, glide: true },
              { s: 27, len: 2, semi: 12, vel: 0.8, core: true, glide: true }, { s: 30, len: 2, semi: 7, vel: 0.75, core: false },
            ],
          ],
          calls: [[{ s: 28, len: 3, vowel: 3, to: 4, tone: 1, core: true }]],
          ukg: {
            ...OFF90,
            stab: { level: 1.2, voices: 3, detune: 18, osc2: 0, cutoff: 1500, q: 1.2, slope: 24, env: 0.25, fdecay: 0.2, decay: 0.25, sustain: 0.1, release: 0.15, drive: 1.2, width: 0.7 },
            strings: { level: 0.5, detune: 14, cutoff: 1400, attack: 2, release: 2 },
            sub: { level: 1.05 },
            mid: { kind: "reese", level: 1, cutoff: 450, env: 0.4, q: 1.6, decay: 0.3, sustain: 0.6, release: 0.1, drive: 3, detune: 15, bend: 0 },
            drop2: { kind: "saw", level: 0.9, cutoff: 380, env: 0.6, q: 3, decay: 0.25, sustain: 0.4, release: 0.08, drive: 3, detune: 6, bend: 12, bendTime: 0.2 },
            vox: { level: 0.6, q: 8, breath: 0.4, bend: -4, scoop: 0.04, release: 0.1, lp: 3800 },
            groove: { hatLate: 0.1, percLate: 0.12, ghost: 1.2, perc: 1.3, open: 1, tamb: 0.5, ghostKick: 1 },
          },
          kit: { ...KIT90, kick: { ...KICK90, decay: 0.48, body: 1.3 } },
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, hat: 0 },
          fx: FX90,
        },
      },
      // Todd Edwards cut-up: the hook is a dense figure of short, stuttered vocal-synth chops on chord tones
      // ("eh", "y-yeah", "uh"), over warm detuned saw stabs and an M1 organ bass; strings in the breakdown.
      {
        id: "hamster-ukg90-cutup",
        name: "Todd Cut-Up",
        base: "classic",
        bpm: [128, 133],
        swing: 0.74,
        microScale: 0.15,
        trim: 1.04,
        riser: 0,
        heat: 0.5,
        data: {
          progressions: [[0, 4, 5, 2], [7, 0, 2, 6]],
          kicks: { lo: [[0, 10]], mid: [[0, 10], [0, 7, 10]], hi: [[0, 7, 10], [0, 3, 11]] },
          skips: [[[7, 0.45], [15, 0.4], [27, 0.45], [11, 0.3], [23, 0.35], [3, 0.25], [19, 0.25]]],
          stabs: [[{ s: 2, len: 1.5, vel: 0.9, core: true }, { s: 11, len: 2, vel: 0.85, core: true }, { s: 18, len: 1.5, vel: 1, core: true }, { s: 27, len: 2, vel: 0.8, core: true }]],
          basslines: [
            [
              { s: 0, len: 1.5, semi: 0, vel: 1, core: true }, { s: 3, len: 1, semi: 12, vel: 0.8, core: true, glide: true },
              { s: 6, len: 1.5, semi: 0, vel: 0.8, core: true }, { s: 9, len: 1, semi: 12, vel: 0.7, core: false },
              { s: 11, len: 1, semi: 7, vel: 0.8, core: true }, { s: 14, len: 2, semi: 12, vel: 0.8, core: true, glide: true },
              { s: 16, len: 1.5, semi: 0, vel: 0.95, core: true }, { s: 19, len: 1, semi: 12, vel: 0.75, core: true },
              { s: 22, len: 1.5, semi: 0, vel: 0.8, core: true, glide: true }, { s: 25, len: 1, semi: 7, vel: 0.7, core: false },
              { s: 27, len: 1, semi: 0, vel: 0.85, core: true }, { s: 29, len: 2, semi: 12, vel: 0.8, core: true, glide: true },
            ],
          ],
          calls: [
            [
              { s: 1, len: 0.5, vowel: 2, tone: 2, core: true }, { s: 3, len: 0.5, vowel: 0, tone: 2, core: true },
              { s: 6, len: 1, vowel: 4, tone: 1, rep: 1, core: true }, { s: 9, len: 0.5, vowel: 2, tone: 3, core: true },
              { s: 13, len: 1, vowel: 0, to: 1, tone: 2, rep: 2, core: true }, { s: 17, len: 0.5, vowel: 3, tone: 1, core: true },
              { s: 19, len: 0.5, vowel: 3, tone: 2, core: true }, { s: 22, len: 1, vowel: 2, tone: 3, rep: 1, core: true },
              { s: 25, len: 0.5, vowel: 4, tone: 1, core: false }, { s: 28, len: 2, vowel: 0, to: 1, tone: 2, rep: 3, core: true },
            ],
          ],
          ukg: {
            ...OFF90,
            stab: { level: 1.2, voices: 4, detune: 16, osc2: 0.1, cutoff: 2000, q: 1, env: 0.3, fdecay: 0.25, decay: 0.3, sustain: 0.2, release: 0.15, drive: 1, width: 0.8 },
            strings: { level: 0.6, detune: 12, cutoff: 2000, attack: 1.5, release: 1.8 },
            sub: { level: 1, glide: 0.08 },
            mid: { kind: "organ", level: 0.8, cutoff: 900, env: 0.3, q: 1, decay: 0.25, sustain: 0.4, release: 0.08, drive: 2, bend: 0 },
            vox: { level: 1.1, q: 11, breath: 0.25, bend: -2, scoop: 0.025, release: 0.05, lp: 5000 },
            groove: { hatLate: 0.1, percLate: 0.1, ghost: 1, perc: 0.8, open: 0.9, tamb: 0.7, ghostKick: 0.6 },
          },
          kit: KIT90,
          vinyl: 0,
          mix: { kick: 1, bass: 0, lead: 0, hat: 0 },
          fx: FX90,
        },
      },
    ],
  },
} satisfies StationPack;
