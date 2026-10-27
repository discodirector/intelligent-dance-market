import type { StationPack } from "../pack.ts";

// Hamster Dark Electro: underground electro on the electro renderers, for Squeekchain's running wheel. Dark, cold,
// mechanical and minimal: a syncopated 808 break (never four-on-the-floor, the snare on 2 and 4), a cold analog bass
// as the hook, few elements, minor keys with the Phrygian b2, minor seconds and tritones. Hull Breach (fast and
// aggressive: locked 16th hats, a snarling FM bass and sparse b9 stabs) and Hypnagogue (hypnotic, slightly
// psychedelic: a held tritone drone, phase bass and phase arp into a long dark echo) play on the hamster station
// (hamster.ts, owner 2026-10-27). Zero Kelvin, reworked after "needs work, boring" (it was a static three-note arp
// and one stab in two bars on Cold 808), is now cold machine funk on Client_03: a two-bar bass riff calling and the
// cold lead answering in its gaps (the opt-in `answers`), ghost snares, chopped hats, a breathing Phrygian pad, a
// robot voice every four bars; the owner put it on the hamster station too. The fourth style, Abyssal Drift, moved to imd-dark.ts. The chain tempo lands at the top of each
// `bpm` range: about 129, 136 and 126. No noise risers (riser 0: over the dark echoes they read as air blowing
// through the second half).
export default {
  key: "hamster-electro",
  name: "Hamster Dark Electro",
  genres: ["electro"],
  styles: {
    electro: [
      // Cold machine funk on Client_03, a Phrygian call and response. The bass calls in the first bar of each two-bar
      // riff (root, an octave pop, a slide up into the b9 or the tritone, dead notes between) and the cold lead answers
      // in its gaps (Ab-G and Db-C sighs, a high Eb falling to C); answer i goes with riff i. A tight 808 break with
      // ghost snares, limping two-bar kick figures and chopped metal hats with an open slice. A tonic pedal under a
      // breathing pad that turns i, the bII cluster, i with the tritone and iv across eight bars; a crushed robot
      // voice reads a phrase every four bars of the full section and in the breakdown. The lead enters at the build's bar 12, its
      // ornaments only on a busy chain; a dotted echo and a dark room give it space.
      {
        id: "hamster-delectro-kelvin",
        name: "Zero Kelvin",
        base: "client03",
        bpm: [124, 129],
        swing: 0.52,
        microScale: 0.05,
        trim: 0.8,
        riser: 0,
        leads: ["hdelectro-vocoder", "hdelectro-cold"],
        data: {
          chords: [
            { bass: 0, third: 3, seventh: 10, tones: [0, 7, 15] },
            { bass: 0, third: 3, seventh: 10, tones: [1, 8, 15] },
            { bass: 5, third: 3, seventh: 10, tones: [0, 5, 8] },
            { bass: 0, third: 3, seventh: 10, tones: [0, 6, 15] },
          ],
          progressions: [[0, 1, 0, 3], [0, 0, 2, 1], [0, 3, 2, 1]],
          kicks: {
            half: [[0, 10, 16], [0, 16, 26]],
            lo: [[0, 10, 16, 26, 29], [0, 7, 10, 16, 22, 26]],
            mid: [[0, 3, 10, 16, 22, 26, 27], [0, 6, 10, 16, 19, 26, 30]],
            hi: [[0, 3, 6, 10, 16, 19, 22, 26, 27, 30], [0, 2, 7, 10, 16, 22, 23, 26, 29]],
          },
          ghosts: [
            [
              { s: 7, vel: 0.3, core: true }, { s: 9, vel: 0.2, core: false }, { s: 14, vel: 0.26, core: false }, { s: 15, vel: 0.32, core: true },
              { s: 23, vel: 0.34, core: true }, { s: 25, vel: 0.22, core: false }, { s: 30, vel: 0.28, core: true }, { s: 31, vel: 0.2, core: false },
            ],
            [
              { s: 3, vel: 0.28, core: true }, { s: 10, vel: 0.24, core: false }, { s: 14, vel: 0.32, core: true }, { s: 19, vel: 0.26, core: false },
              { s: 22, vel: 0.3, core: true }, { s: 26, vel: 0.22, core: false }, { s: 29, vel: 0.3, core: true }, { s: 31, vel: 0.24, core: false },
            ],
          ],
          warps: [
            [1, 0.9, 1.08, 0.92, 1, 0.88, 1.12, 0.94, 1, 0.9, 1.06, 0.9, 1, 0.86, 1.15, 0.95],
            [1.05, 0.92, 1, 0.86, 1.1, 0.94, 0.82, 1, 1.05, 0.92, 1, 0.84, 1.12, 0.9, 0.8, 1.02],
          ],
          chops: [{ open: 14, steps: [7, 15] }, { open: 10, steps: [3, 11] }, { open: 6, steps: [13] }],
          // Flags: 1 accent (a quiet chain plays only these), 2 slide in, 4 ornament (busy chain), 8 dead note.
          riffs: [
            [
              { s: 0, semi: 0, len: 2, f: 1 }, { s: 3, semi: 12, len: 1, f: 1 }, { s: 4, semi: 13, len: 1, f: 2 }, { s: 6, semi: 0, len: 1, f: 8 },
              { s: 7, semi: 0, len: 2, f: 1 }, { s: 10, semi: 6, len: 2, f: 3 }, { s: 13, semi: 7, len: 1, f: 4 }, { s: 14, semi: 0, len: 1, f: 8 },
              { s: 16, semi: 0, len: 3, f: 1 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 22, semi: 12, len: 1, f: 1 }, { s: 23, semi: 10, len: 1, f: 2 },
              { s: 24, semi: 7, len: 2, f: 0 }, { s: 27, semi: 1, len: 1, f: 4 }, { s: 28, semi: 0, len: 2, f: 3 }, { s: 31, semi: 12, len: 1, f: 12 },
            ],
            [
              { s: 0, semi: 0, len: 1.5, f: 1 }, { s: 2, semi: 12, len: 1, f: 0 }, { s: 3, semi: 0, len: 1, f: 8 }, { s: 6, semi: -2, len: 2, f: 1 },
              { s: 8, semi: 0, len: 1, f: 2 }, { s: 10, semi: 6, len: 1, f: 1 }, { s: 11, semi: 7, len: 1, f: 2 }, { s: 13, semi: 0, len: 1, f: 8 },
              { s: 14, semi: 13, len: 1, f: 4 }, { s: 15, semi: 12, len: 1, f: 6 },
              { s: 16, semi: 0, len: 2, f: 1 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 20, semi: 12, len: 1, f: 4 }, { s: 22, semi: 0, len: 2, f: 1 },
              { s: 25, semi: 1, len: 1, f: 0 }, { s: 26, semi: 0, len: 1, f: 2 }, { s: 28, semi: -5, len: 2, f: 1 }, { s: 30, semi: 0, len: 1, f: 8 },
              { s: 31, semi: 6, len: 1, f: 4 },
            ],
            [
              { s: 0, semi: 0, len: 4, f: 1 }, { s: 5, semi: 12, len: 1, f: 0 }, { s: 6, semi: 13, len: 1, f: 2 }, { s: 7, semi: 12, len: 1, f: 4 },
              { s: 10, semi: 7, len: 2, f: 1 }, { s: 13, semi: 6, len: 1, f: 2 }, { s: 14, semi: 0, len: 1, f: 8 },
              { s: 16, semi: 0, len: 2, f: 1 }, { s: 18, semi: 0, len: 1, f: 8 }, { s: 19, semi: 12, len: 1, f: 1 }, { s: 22, semi: 10, len: 1, f: 0 },
              { s: 23, semi: 7, len: 2, f: 2 }, { s: 26, semi: 0, len: 1, f: 8 }, { s: 27, semi: 1, len: 1, f: 1 }, { s: 28, semi: 0, len: 3, f: 2 },
            ],
          ],
          answers: [
            [
              { s: 14, semi: 7, len: 1, core: false }, { s: 17, semi: 8, len: 1, core: true }, { s: 18, semi: 7, len: 2, core: true },
              { s: 21, semi: 3, len: 1, core: false }, { s: 25, semi: 1, len: 1, core: true }, { s: 26, semi: 0, len: 3, core: true },
            ],
            [
              { s: 18, semi: 15, len: 2, core: true }, { s: 21, semi: 13, len: 1, core: true }, { s: 23, semi: 12, len: 3, core: true },
              { s: 29, semi: 6, len: 2, core: false },
            ],
            [
              { s: 2, semi: 7, len: 1, core: true }, { s: 3, semi: 8, len: 2, core: true }, { s: 8, semi: 6, len: 2, core: false },
              { s: 20, semi: 3, len: 1, core: true }, { s: 21, semi: 1, len: 2, core: true }, { s: 30, semi: 0, len: 2, core: false },
            ],
          ],
          // The robot reads a phrase every four bars of the full section: "ZE-RO KEL-VIN", "AB-SO-LUTE ZE-RO", "SYS-TEM
          // FROZ-EN" (one per epoch), each syllable a vowel's two formants and its consonant's click or hiss.
          words: [
            { s: 2, syl: [[400, 2000, "s"], [450, 800, null], [550, 1800, "k"], [300, 2300, null]] },
            { s: 2, syl: [[750, 1200, null], [450, 800, "s"], [330, 850, "t"], [400, 2000, "s"], [450, 800, null]] },
            { s: 4, syl: [[300, 2200, "s"], [500, 1800, "t"], [450, 800, "p"], [500, 1700, null]] },
          ],
          kit: {
            kick: { start: 155, end: 47, sweep: 0.035, decay: 0.34, click: 0.35, clickHp: 3000, drive: 1.6, body: 1.1 },
            snare: [
              { tone: "triangle", freq: 220, to: 186, sweep: 0.025, decay: 0.07, level: 0.5 },
              { noise: "bandpass", freq: 1800, q: 1.1, decay: 0.11, level: 0.55 },
              { noise: "highpass", freq: 4000, q: 0.7, decay: 0.04, level: 0.18 },
            ],
            ghost: [
              { noise: "bandpass", freq: 2100, q: 1.1, decay: 0.045, level: 0.4 },
              { tone: "triangle", freq: 236, to: 196, sweep: 0.02, decay: 0.025, level: 0.14 },
            ],
            hat: { hp: 8200, decay: 0.014, metal: 0.8, q: 1.5 },
            open: { hp: 6800, decay: 0.09, metal: 0.85, q: 1.3, level: 0.42 },
            accents: [0.36, 0.2, 0.5, 0.24],
          },
          bassTone: {
            osc: [{ type: "square", detune: -5, level: 0.45 }, { type: "sawtooth", detune: 6, level: 0.4 }],
            cutoff: 140, color: 220, q: [5, 7.5], open: [4, 7.5], decay: [0.08, 0.14], drive: 2.2, level: [0.15, 0.19], sub: [1.2, 1.45], glide: 0.06,
          },
          pad: { osc: [{ type: "triangle", detune: -9, level: 0.5 }, { type: "triangle", detune: 8, level: 0.5 }], cutoff: 520, q: 2.5, level: 0.09 },
          voice: { pitch: 96, bits: 5, hp: 280, lp: 3600, level: 0.12, every: 4 },
          ornament: { vowels: [[330, 650], [450, 800], [300, 870]], wave: "square", steps: 3, octave: -12, syllable: 2, ring: 0, lowpass: 1800, echo: null, level: 0.07, slots: [2, 10] },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.38, lp: 2400, hp: 450 },
            echoSend: { lead: 0.45, perc: 0.06, snare: 0.03, harm: 0.15 },
            space: { size: 1.1, fb: 0.55, lp: 3000 },
            spaceSend: { lead: 0.3, snare: 0.08, perc: 0.03, harm: 0.3 },
            drumLp: 12000,
            drive: 1.12,
            master: { lp: 10000 },
          },
          mix: { hat: -3, lead: -1 },
        },
      },
      // Fast aggressive electro: a hard short kick on busy syncopated figures, a cracking clap-snare, clipped 16th
      // hats that lock straight with short metallic "chick" opens, a snarling FM bass rolling 16ths with b9 and
      // tritone ornaments, sparse dissonant stabs (root, fifth, b9) and a low ring-modulated robot call.
      {
        id: "hamster-delectro-breach",
        name: "Hull Breach",
        base: "alienrave",
        bpm: [131, 136],
        swing: 0.5,
        microScale: 0.03,
        trim: 0.76,
        riser: 0,
        data: {
          chords: [
            { bass: 0, tones: [0, 7, 13] },
            { bass: 0, tones: [0, 3, 10] },
            { bass: 1, tones: [1, 7, 13] },
            { bass: -2, tones: [-2, 3, 10] },
            { bass: -4, tones: [-4, 3, 7] },
            { bass: 0, tones: [0, 6, 12] },
          ],
          progressions: [[0, 0, 2, 0], [0, 1, 0, 5], [0, 0, 3, 2], [1, 0, 4, 2]],
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 7, 10, 16, 23, 26], [0, 10, 13, 16, 26, 29]],
            mid: [[0, 3, 7, 10, 16, 19, 23, 26], [0, 6, 10, 11, 16, 22, 26, 27]],
            hi: [[0, 3, 6, 10, 11, 14, 16, 19, 22, 26, 27, 30], [0, 2, 7, 10, 13, 16, 18, 23, 26, 29]],
          },
          opens: [[2, 10], [6, 14], [3, 11]],
          lines: [
            [[0, 1], [0, 0], [12, 0], [0, 4], [0, 1], [13, 0], [12, 2], [0, 0], [0, 1], [0, 4], [10, 0], [0, 0], [15, 1], [12, 2], [0, 0], [7, 4]],
            [[0, 1], null, [0, 0], [0, 0], [12, 1], null, [0, 0], [1, 2], [0, 1], null, [0, 0], [12, 0], [0, 1], [10, 2], [0, 0], [0, 4]],
            [[0, 1], [0, 0], [12, 0], [0, 0], [13, 2], [12, 0], [0, 1], [0, 0], [7, 0], [6, 4]],
          ],
          stabs: [
            [{ s: 3, len: 1, core: true }, { s: 14, len: 1, core: false }, { s: 22, len: 2, core: true }],
            [{ s: 6, len: 1, core: true }, { s: 19, len: 1, core: true }, { s: 27, len: 1, core: false }],
          ],
          arpCells: [[0, 1, 0, 2], [0, 2, 1, 0, 2, 1]],
          calls: [
            { s: 10, len: 4, vowels: [[330, 650], [450, 800]] },
            { s: 12, len: 3, vowels: [[300, 870], [600, 1000]] },
          ],
          kit: {
            kick: { start: 175, end: 50, sweep: 0.025, decay: 0.24, click: 0.55, clickHp: 3200, drive: 2.4, body: 1.05 },
            snare: [
              { tone: "triangle", freq: 230, to: 190, sweep: 0.025, decay: 0.05, level: 0.45 },
              { noise: "bandpass", freq: 1600, q: 1, decay: 0.1, level: 0.55 },
              { clap: 0.32, at: 0.003 },
            ],
            hat: { hp: 9400, decay: 0.009, metal: 0.55, q: 1.4 },
            open: { hp: 7000, decay: 0.05, metal: 0.6, q: 1.2, level: 0.3 },
            accents: [0.36, 0.24, 0.5, 0.26],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -7, level: 0.42 }, { type: "sawtooth", detune: 7, level: 0.38 }],
            cutoff: 150, color: 300, q: [6, 8.5], open: [3.4, 5.5], decay: [0.06, 0.1], drive: 2.4, level: [0.155, 0.195], sub: [1.3, 1.5], glide: 0.03, fm: [1.6, 2.6],
          },
          hoover: { cutoff: 450, color: 700, q: 2.2, hp: 220, bend: 0.5, detune: [-9, 8], level: 0.16 },
          vox: { ring: 0.5, level: 0.5 },
          // No lasers, a dark low arp (both read as mouse squeaks on small speakers; owner 2026-10-27).
          laser: { level: 0 },
          arp: { open: 1.8, color: 1, cap: 2600, q: 2, level: 0.13 },
          ornament: { vowels: [[450, 800], [330, 650]], wave: "square", steps: 4, octave: -12, ring: 1.5, lowpass: 2200, echo: null, level: 0.06 },
          fx: {
            echoSend: { lead: 0.35, perc: 0.3, snare: 0.05 },
            space: { size: 0.6, fb: 0.45, lp: 4000 },
            spaceSend: { snare: 0.12, perc: 0.15, lead: 0.25, harm: 0.15 },
            drumLp: 13000,
            drive: 1.2,
            master: { lp: 11000 },
          },
          mix: { hat: -3, lead: -3, perc: -4, fx: -3 },
        },
      },
      // Hypnotic, slightly psychedelic electro: slower, a deep round kick on a sparse figure, a soft snare thrown into
      // the echo; a held, resonant, wide-detuned chord drone every bar (i, i with the tritone, bII with the tritone),
      // a deep bass and a 16th arp both phasing in 6- and 10-step cells against the bar, a robot vowel morphing slowly.
      {
        id: "hamster-delectro-hypno",
        name: "Hypnagogue",
        base: "alienrave",
        bpm: [121, 126],
        swing: 0.52,
        microScale: 0.12,
        trim: 0.8,
        riser: 0,
        data: {
          chords: [
            { bass: 0, tones: [0, 7, 12, 15] },
            { bass: 0, tones: [0, 6, 12, 15] },
            { bass: 1, tones: [1, 7, 13] },
            { bass: -4, tones: [-4, 3, 7, 12] },
          ],
          progressions: [[0, 0, 0, 1], [0, 1, 0, 2], [0, 0, 3, 1]],
          kicks: {
            half: [[0, 16]],
            lo: [[0, 10, 16, 26]],
            mid: [[0, 10, 16, 22, 26], [0, 6, 10, 16, 26]],
            hi: [[0, 6, 10, 16, 22, 26, 29], [0, 3, 10, 16, 19, 26, 30]],
          },
          opens: [[14], [10]],
          lines: [
            [[0, 1], [0, 0], [12, 0], [0, 2], [1, 0], [0, 0]],
            [[0, 1], null, [0, 0], [12, 0], null, [0, 1], [6, 4], [0, 0], null, [10, 2]],
            [[0, 1], null, [0, 0], [0, 0], [12, 1], null, [0, 0], null, [0, 1], null, [0, 0], [13, 2], [12, 0], null, [0, 0], null],
          ],
          stabs: [
            [{ s: 0, len: 14, core: true }, { s: 16, len: 14, core: true }],
            [{ s: 0, len: 16, core: true }, { s: 16, len: 12, core: true }, { s: 29, len: 1, core: false }],
          ],
          arpCells: [[0, 2, 1, 4, 3, 2], [0, 1, 2, 4, 2, 1, 0, 3, 2, 1]],
          calls: [{ s: 8, len: 8, vowels: [[300, 870], [650, 1100], [400, 800]] }],
          kit: {
            kick: { start: 130, end: 44, sweep: 0.05, decay: 0.5, click: 0.15, clickHp: 2000, drive: 1.3, body: 1.15 },
            snare: [
              { tone: "triangle", freq: 190, to: 160, sweep: 0.03, decay: 0.1, level: 0.55 },
              { noise: "bandpass", freq: 1000, q: 0.9, decay: 0.18, level: 0.45 },
              { clap: 0.15, at: 0.005 },
            ],
            hat: { hp: 7800, decay: 0.02, metal: 0.35, q: 1 },
            open: { hp: 5600, decay: 0.22, metal: 0.4, q: 0.9, level: 0.3 },
            accents: [0.28, 0.18, 0.4, 0.2],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -14, level: 0.4 }, { type: "sawtooth", detune: 14, level: 0.4 }],
            cutoff: 120, color: 160, q: [5, 7], open: [2.6, 4], decay: [0.15, 0.25], drive: 1.8, level: [0.16, 0.19], sub: [1.4, 1.55], glide: 0.08, fm: [0.4, 0.8],
          },
          hoover: { cutoff: 300, color: 360, q: 2.6, hp: 150, bend: 0, detune: [-24, -6, 7, 23], level: 0.13 },
          vox: { ring: 0.75, level: 0.55 },
          // No lasers; the phase arp stays, darker and lower (the bright one read as mouse squeaks on small speakers).
          laser: { level: 0 },
          arp: { open: 2, color: 1.2, cap: 2400, q: 1.5, level: 0.14 },
          ornament: { vowels: [[300, 870], [650, 1100]], wave: "triangle", steps: 5, octave: 0, syllable: 3, ring: 0.75, lowpass: 2000, echo: { steps: 3, feedback: 0.5 }, level: 0.05 },
          fx: {
            echo: { steps: 3, taps: 8, fb: 0.6, lp: 2200, hp: 400 },
            echoSend: { lead: 0.7, perc: 0.4, snare: 0.2, harm: 0.3 },
            space: { size: 2.2, fb: 0.75, lp: 3500 },
            spaceSend: { harm: 0.45, lead: 0.5, snare: 0.25 },
            drumLp: 10000,
            drive: 1.1,
            master: { lp: 9000 },
          },
          mix: { lead: -3, hat: -3, perc: -5, fx: -4 },
        },
      },
    ],
  },
  patches: {
    // A cold vocoder-ish stab: saw and a thin pulse through two formants ("oh-ah"), short, a breath of noise.
    "hdelectro-vocoder": {
      name: "Cold Vocoder",
      osc: [
        { type: "sawtooth", detune: -6, oct: 0, level: 0.7 },
        { type: "pulse12", detune: 7, oct: 0, level: 0.5 },
      ],
      filter: { type: "lowpass", cutoff: 1800, env: 600, decay: 0.15, q: 1 },
      formants: [520, 1150],
      amp: { a: 0.004, d: 0.2, s: 0.3, r: 0.16 },
      noise: 0.03,
      gain: 0.62,
    },
    // A dark square stab: a closed lowpass with a short resonant blip, no vibrato.
    "hdelectro-cold": {
      name: "Cold Square",
      osc: [
        { type: "square", detune: -5, oct: 0, level: 0.6 },
        { type: "square", detune: 6, oct: -1, level: 0.4 },
      ],
      filter: { type: "lowpass", cutoff: 600, env: 1400, decay: 0.1, q: 5 },
      amp: { a: 0.003, d: 0.18, s: 0.2, r: 0.14 },
      gain: 0.6,
    },
  },
} satisfies StationPack;
