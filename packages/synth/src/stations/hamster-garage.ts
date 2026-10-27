import type { StationPack } from "../pack.ts";

// Hamster Garage: late-90s UK garage / 2-step for Squeekchain's running wheel (MJ Cole, Artful Dodger, Todd Edwards,
// El-B, Wookie, Zed Bias). Bright and bouncy, no rain: a kick on 1 and a late skipping kick (never four-on-the-floor),
// a snappy rimshot-and-clap on 2 and 4, swung 16th shakers and ticks, a warm round sub that jumps octaves, and on top
// either organ stabs, chopped vowel stabs, an R&B "ooh" over warm keys, or a bouncing speed-garage bass.
// Every pitch stays in the genre's note set (0 3 7 10 over the tonic): the harmony moves by its bass (i, III, v,
// bVII under one minor-seventh colour), so the chords change and nothing clashes with the chain's notes.
// The station's tempo lands near the top of each `bpm` range: the top is the tempo each style wants.
// No noise risers (riser 0: the owner hears them as air blowing through the second half).

export default {
  key: "hamster-garage",
  name: "Hamster Garage",
  genres: ["futuregarage"],
  styles: {
    futuregarage: [
      // MJ Cole / Artful Dodger organ 2-step: an M1-ish organ stab figure on the offbeats over a soft drawbar bed,
      // the stabs answered by an M1 organ lead on a busy wheel; punchy short kick, crisp rim + clap, swung shakers.
      {
        id: "hamster-organ",
        name: "Wheel Organ",
        base: "atmos",
        bpm: [128, 134],
        swing: 0.66,
        microScale: 0.2,
        trim: 0.828,
        riser: 0,
        leads: ["hamster-m1organ"],
        data: {
          vamps: [
            { a: { pad: [0, 7, 10, 12, 15], root: 0 }, b: { pad: [3, 7, 10, 15, 19], root: 3 } },
            { a: { pad: [0, 3, 7, 10, 15], root: 0 }, b: { pad: [-2, 3, 7, 12, 15], root: 10 } },
            { a: { pad: [3, 7, 10, 12, 15], root: 0 }, b: { pad: [-5, 3, 7, 10, 15], root: 7 } },
          ],
          // Organ stabs over two bars: on the "and"s and the late 16ths, a held one leaning into bar two.
          choirs: [
            [
              { s: 2, len: 1, swell: false, core: true }, { s: 6, len: 1, swell: false, core: true },
              { s: 10, len: 2, swell: false, core: true }, { s: 15, len: 1, swell: false, core: false },
              { s: 18, len: 1, swell: false, core: true }, { s: 22, len: 1, swell: false, core: true },
              { s: 27, len: 3, swell: false, core: true }, { s: 30, len: 1, swell: false, core: false },
            ],
            [
              { s: 3, len: 1, swell: false, core: true }, { s: 6, len: 2, swell: false, core: true },
              { s: 11, len: 1, swell: false, core: false }, { s: 14, len: 2, swell: false, core: true },
              { s: 19, len: 1, swell: false, core: true }, { s: 22, len: 2, swell: false, core: true },
              { s: 26, len: 1, swell: false, core: false }, { s: 28, len: 4, swell: true, core: true },
            ],
          ],
          pans: [
            [{ s: 7, len: 1 }, { s: 23, len: 1 }, { s: 13, len: 2 }, { s: 29, len: 2 }, { s: 3, len: 1 }],
            [{ s: 11, len: 1 }, { s: 26, len: 2 }, { s: 5, len: 1 }, { s: 21, len: 1 }],
          ],
          kicks: { lo: [[0, 10]], mid: [[0, 10], [0, 7, 10]], hi: [[0, 7, 10], [0, 10, 13], [0, 3, 10]] },
          sub: 1.05,
          bass: { wave: "sine", attack: 0.008, hold: 0.8, drive: 0.4, octave: 0.2 },
          // Drawbar bed: square + sines, a slow Leslie-ish wobble, kept under the stabs.
          pad: {
            osc: [{ type: "square", detune: -3, level: 0.18 }, { type: "sine", detune: 2, level: 0.5 }, { type: "triangle", detune: 0, level: 0.3 }],
            cutoff: 900, q: 0.6, attack: 0.08, release: 0.5, level: 0.05, vib: 5,
          },
          choir: {
            osc: [{ type: "square", detune: -4, level: 0.5 }, { type: "sine", detune: 3, level: 0.6 }],
            cutoff: 3600, level: 0.24,
          },
          kit: {
            kick: { start: 145, end: 50, sweep: 0.03, decay: 0.26, click: 0.16, clickHp: 3000, drive: 0.3, body: 1.05 },
            snare: [
              { tone: "triangle", freq: 480, to: 410, sweep: 0.02, decay: 0.03, level: 0.4 },
              { noise: "bandpass", freq: 2600, q: 1.1, decay: 0.09, level: 0.55 },
              { clap: 0.55, at: 0.003 },
            ],
            ghost: [
              { tone: "triangle", freq: 820, to: 720, decay: 0.022, level: 1.2 },
              { noise: "highpass", freq: 5200, q: 0.7, decay: 0.02, level: 0.8 },
            ],
            hat: { hp: 8200, decay: 0.03, metal: 0.25, level: 0.34 },
            shaker: { freq: 8200, q: 1.1, decay: 0.04, attack: 0.004, level: 0.27 },
            open: { hp: 7800, decay: 0.12, metal: 0.3, level: 0.2 },
          },
          rain: 0,
          vinyl: 0,
          mix: { kick: 1, bass: 1, harm: 0, lead: 1, hat: 0, tex: -6 },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.4, lp: 3800, hp: 500 },
            echoSend: { kick: 0, bass: 0, snare: 0.12, perc: 0.2, lead: 0.28, harm: 0 },
            space: { size: 0.9, fb: 0.6, lp: 6000 },
            spaceSend: { kick: 0, bass: 0, snare: 0.18, hat: 0.05, perc: 0.2, lead: 0.25, harm: 0.25, tex: 0, fx: 0.25 },
            drumLp: 17000, drive: 1.05, pressDrive: 0.1,
            duck: { bass: 0.45, harm: 0.75 },
            duckTime: { bass: 0.14, harm: 0.2 },
            master: { lp: 15000 },
          },
        },
      },
      // Todd Edwards / Zed Bias cut-up: a busy figure of 16th vowel chops on the chord's top tones, a pitched vowel
      // lead on a busy wheel, a bright airy bed; tighter swing, a deeper kick, shakers forward.
      {
        id: "hamster-chops",
        name: "Squeak Chops",
        base: "atmos",
        bpm: [127, 132],
        swing: 0.62,
        microScale: 0.15,
        trim: 0.943,
        riser: 0,
        leads: ["hamster-vowel"],
        data: {
          vamps: [
            { a: { pad: [3, 7, 10, 15, 19], root: 3 }, b: { pad: [0, 7, 10, 12, 15], root: 0 } },
            { a: { pad: [-2, 3, 7, 10, 15], root: 10 }, b: { pad: [3, 7, 12, 15, 19], root: 3 } },
            { a: { pad: [0, 3, 7, 10, 12], root: 0 }, b: { pad: [-5, 3, 7, 10, 12], root: 7 } },
          ],
          // Chops: short cuts on the 16ths, stuttered pairs, one swell into the bar.
          choirs: [
            [
              { s: 0, len: 1, swell: false, core: true }, { s: 3, len: 1, swell: false, core: true },
              { s: 6, len: 1, swell: false, core: true }, { s: 7, len: 1, swell: false, core: false },
              { s: 10, len: 1, swell: false, core: true }, { s: 13, len: 1, swell: false, core: false },
              { s: 19, len: 1, swell: false, core: true }, { s: 22, len: 1, swell: false, core: true },
              { s: 24, len: 4, swell: true, core: true }, { s: 30, len: 1, swell: false, core: false },
            ],
            [
              { s: 2, len: 1, swell: false, core: true }, { s: 5, len: 1, swell: false, core: false },
              { s: 8, len: 1, swell: false, core: true }, { s: 9, len: 1, swell: false, core: true },
              { s: 14, len: 2, swell: false, core: true }, { s: 18, len: 1, swell: false, core: true },
              { s: 21, len: 1, swell: false, core: false }, { s: 24, len: 1, swell: false, core: true },
              { s: 25, len: 1, swell: false, core: true }, { s: 28, len: 4, swell: true, core: false },
            ],
            [
              { s: 1, len: 1, swell: false, core: true }, { s: 4, len: 1, swell: false, core: false },
              { s: 6, len: 2, swell: false, core: true }, { s: 11, len: 1, swell: false, core: true },
              { s: 12, len: 4, swell: true, core: false }, { s: 17, len: 1, swell: false, core: true },
              { s: 19, len: 1, swell: false, core: true }, { s: 22, len: 2, swell: false, core: true },
              { s: 27, len: 1, swell: false, core: false }, { s: 30, len: 2, swell: false, core: true },
            ],
          ],
          pans: [
            [{ s: 5, len: 1 }, { s: 21, len: 1 }, { s: 11, len: 1 }, { s: 27, len: 2 }, { s: 15, len: 1 }],
            [{ s: 3, len: 1 }, { s: 13, len: 1 }, { s: 19, len: 1 }, { s: 29, len: 1 }],
          ],
          kicks: { lo: [[0, 10]], mid: [[0, 10], [0, 6, 10]], hi: [[0, 6, 10], [0, 10, 14], [0, 3, 10]] },
          sub: 1.1,
          bass: { wave: "sine", attack: 0.01, hold: 0.7, drive: 0.25, octave: 0.12 },
          pad: {
            osc: [{ type: "sine", detune: -4, level: 0.5 }, { type: "triangle", detune: 4, level: 0.4 }],
            cutoff: 1100, q: 0.5, attack: 0.6, release: 1.4, level: 0.03, vib: 2,
          },
          choir: {
            osc: [{ type: "sawtooth", detune: -6, level: 0.5 }, { type: "sawtooth", detune: 6, level: 0.5 }],
            cutoff: 4400, level: 0.36,
          },
          kit: {
            kick: { start: 125, end: 46, sweep: 0.04, decay: 0.32, click: 0.1, clickHp: 2600, drive: 0.2, body: 1.1 },
            snare: [
              { tone: "triangle", freq: 260, to: 200, sweep: 0.03, decay: 0.06, level: 0.32 },
              { noise: "bandpass", freq: 3200, q: 1.3, decay: 0.07, level: 0.5 },
              { noise: "highpass", freq: 6500, q: 0.7, decay: 0.05, level: 0.22 },
              { clap: 0.45, at: 0.002, flip: true },
            ],
            ghost: [
              { noise: "bandpass", freq: 3600, q: 1, decay: 0.03, level: 1.1 },
              { tone: "triangle", freq: 600, to: 520, decay: 0.018, level: 0.6 },
            ],
            hat: { hp: 9500, decay: 0.022, metal: 0.15, level: 0.3 },
            shaker: { freq: 9000, q: 1.4, decay: 0.05, attack: 0.008, level: 0.3 },
            open: { hp: 8500, decay: 0.09, metal: 0.2, level: 0.18 },
          },
          rain: 0,
          vinyl: 0,
          mix: { kick: 1, bass: 1, harm: -1, lead: 1, hat: 0, tex: -6 },
          fx: {
            echo: { steps: 3, taps: 4, fb: 0.45, lp: 4200, hp: 600 },
            echoSend: { kick: 0, bass: 0, snare: 0.1, perc: 0.2, lead: 0.35, harm: 0 },
            space: { size: 1.1, fb: 0.65, lp: 6500 },
            spaceSend: { kick: 0, bass: 0, snare: 0.15, hat: 0.05, perc: 0.2, lead: 0.3, harm: 0.4, tex: 0, fx: 0.3 },
            drumLp: 18000, drive: 1.05, pressDrive: 0.1,
            duck: { bass: 0.45, harm: 0.8 },
            duckTime: { bass: 0.14, harm: 0.2 },
            master: { lp: 16000 },
          },
        },
      },
      // Sunday-best R&B garage (Artful Dodger / MJ Cole smooth side): warm round keys walking under the chords two
      // bars each, a held "ooh" on the guide tone, a deep shuffle with skippy ghost snares, a bouncy sub.
      {
        id: "hamster-sunday",
        name: "Sunday Best",
        base: "classic",
        bpm: [126, 131],
        swing: 0.68,
        microScale: 0.25,
        trim: 0.905,
        riser: 0,
        data: {
          chords: [
            // 0: i m7
            { bass: 0, pad: [0, 3, 7, 10, 15], guide: 10, dark: [0, 7, 15] },
            // 1: III6 (the relative major over its own root)
            { bass: 3, pad: [3, 7, 10, 12, 15], guide: 7, dark: [3, 10, 19] },
            // 2: bVII under the i colour (Bb: 9, 11, 13)
            { bass: 10, pad: [-2, 3, 7, 12, 15], guide: 15, dark: [3, 10, 15] },
            // 3: v under it (G: the minor-seventh colour over the fifth)
            { bass: 7, pad: [-5, 3, 7, 10, 15], guide: 10, dark: [-5, 3, 10] },
            // 4: i, quartal and open
            { bass: 0, pad: [0, 7, 10, 15, 19], guide: 12, dark: [0, 7, 15] },
          ],
          progressions: [
            [0, 1, 2, 3],
            [1, 2, 0, 4],
            [0, 3, 1, 4],
            [4, 1, 2, 0],
          ],
          skips: [
            [[7, 0.5], [27, 0.45], [15, 0.4], [11, 0.3], [23, 0.35], [31, 0.3], [3, 0.25], [19, 0.25]],
            [[9, 0.5], [25, 0.45], [15, 0.35], [29, 0.35], [3, 0.3], [19, 0.3], [13, 0.25]],
            [[6, 0.45], [23, 0.5], [11, 0.35], [27, 0.35], [15, 0.3], [30, 0.3], [2, 0.25]],
          ],
          kicks: { lo: [[0, 10]], mid: [[0, 10], [0, 7, 10]], hi: [[0, 7, 10], [0, 10, 13], [0, 6, 10]] },
          sub: 1.1,
          bass: { wave: "triangle", attack: 0.01, hold: 0.85, drive: 0.5, octave: 0.25 },
          // Warm keys: sine + triangle with a little saw shine, a soft filter breath.
          pad: {
            osc: [{ type: "sine", detune: -3, level: 0.5 }, { type: "triangle", detune: 3, level: 0.4 }, { type: "sawtooth", detune: 0, level: 0.1 }],
            cutoff: 1500, q: 0.7, attack: 0.05, release: 1, level: 0.075,
          },
          // ah, oh, ee, ooh: the reversed chop sings index 0, the held guide index 3 (a warm R&B "ooh").
          vowels: [[850, 1300], [600, 1000], [400, 2200], [480, 1100]],
          kit: {
            kick: { start: 135, end: 48, sweep: 0.035, decay: 0.3, click: 0.12, clickHp: 2800, drive: 0.2, body: 1.05 },
            snare: [
              { tone: "triangle", freq: 440, to: 380, sweep: 0.02, decay: 0.035, level: 0.38 },
              { noise: "bandpass", freq: 2300, q: 1, decay: 0.1, level: 0.5 },
              { clap: 0.6, at: 0.004, flip: true },
            ],
            ghost: [
              { tone: "triangle", freq: 760, to: 650, decay: 0.02, level: 0.45 },
              { noise: "bandpass", freq: 3400, q: 1, decay: 0.03, level: 0.35 },
            ],
            hat: { hp: 8600, decay: 0.025, metal: 0.2, level: 0.3 },
            shaker: { freq: 7800, q: 1.2, decay: 0.035, attack: 0.006, level: 0.24, off: 0.15 },
            open: { hp: 7600, decay: 0.14, metal: 0.3, level: 0.2 },
          },
          rain: 0,
          vinyl: 0,
          mix: { kick: 1, bass: 0.5, harm: 0, lead: 0, hat: 0 },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.4, lp: 3200, hp: 450 },
            echoSend: { kick: 0, bass: 0, snare: 0.1, perc: 0.2, lead: 0.3, harm: 0 },
            space: { size: 1.2, fb: 0.68, lp: 5500 },
            spaceSend: { kick: 0, bass: 0, snare: 0.2, hat: 0.05, perc: 0.2, lead: 0.4, harm: 0.35, tex: 0, fx: 0.3 },
            drumLp: 16000, drive: 1.05, pressDrive: 0.1,
            duck: { bass: 0.5, harm: 0.8 },
            duckTime: { bass: 0.15, harm: 0.22 },
            master: { lp: 14000 },
          },
        },
      },
      // Bassline 2-step / speed garage: a bouncing reese that opens and shuts on every beat over the sub, a short
      // stab-like choir, tight hats on the 16ths and metal ticks; the darkest of the four, still dry and quick.
      {
        id: "hamster-bassline",
        name: "Wheel Bassline",
        base: "dark",
        bpm: [131, 136],
        swing: 0.64,
        microScale: 0.2,
        trim: 0.75,
        riser: 0,
        data: {
          chords: [
            { bass: 0, pad: [0, 3, 7, 10], guide: 10, dark: [0, 7, 15] },
            { bass: 3, pad: [3, 7, 10, 15], guide: 7, dark: [3, 10, 19] },
            { bass: 10, pad: [-2, 3, 7, 15], guide: 15, dark: [3, 10, 15] },
            { bass: 7, pad: [-5, 3, 7, 10], guide: 10, dark: [-5, 3, 10] },
          ],
          progressions: [
            [0, 0, 1, 2],
            [0, 3, 0, 1],
            [0, 2, 1, 3],
          ],
          foley: [
            [[3, 0], [14, 1], [19, 0], [27, 2], [9, 1], [30, 0], [6, 2]],
            [[6, 1], [11, 0], [22, 1], [27, 0], [2, 2], [15, 1]],
          ],
          kicks: { lo: [[0, 10]], mid: [[0, 10], [0, 11]], hi: [[0, 10, 14], [0, 6, 10], [0, 7, 11]] },
          sub: 1.05,
          bass: { wave: "sine", attack: 0.008, hold: 0.85, drive: 0.3, octave: 0 },
          reese: { detune: 14, drive: 2.4, cutoff: 360, q: 2, depth: 0.85, level: 0.13 },
          choir: {
            osc: [{ type: "sawtooth", detune: -6, level: 0.5 }, { type: "square", detune: 5, level: 0.35 }],
            cutoff: 2600, attack: 0.3, release: 0.8, level: 0.11, noise: 0.08, hp: 300,
          },
          kit: {
            kick: { start: 150, end: 48, sweep: 0.028, decay: 0.28, click: 0.18, clickHp: 3200, drive: 0.5, body: 1.1 },
            snare: [
              { tone: "triangle", freq: 300, to: 230, sweep: 0.03, decay: 0.06, level: 0.35 },
              { noise: "bandpass", freq: 2800, q: 1.2, decay: 0.09, level: 0.55 },
              { clap: 0.55, at: 0.003 },
            ],
            ghost: [
              { tone: "triangle", freq: 700, to: 600, decay: 0.02, level: 0.7, tail: true },
              { noise: "bandpass", freq: 3800, q: 1.2, decay: 0.03, level: 0.5, tail: true },
            ],
            hat: { hp: 8800, decay: 0.02, metal: 0.2, level: 0.3 },
            shaker: { freq: 7600, q: 1.2, decay: 0.035, attack: 0.006, level: 0.24 },
            open: { hp: 7600, decay: 0.1, metal: 0.25, level: 0.2 },
          },
          rain: 0,
          vinyl: 0.15,
          mix: { kick: 1, bass: 1, harm: -1, lead: 0, perc: -1, tex: -3 },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.4, lp: 3000, hp: 500 },
            echoSend: { kick: 0, bass: 0, snare: 0.12, perc: 0.3, lead: 0.3, harm: 0 },
            space: { size: 1, fb: 0.62, lp: 5000 },
            spaceSend: { kick: 0, bass: 0, snare: 0.16, hat: 0.05, perc: 0.25, lead: 0.3, harm: 0.4, tex: 0.1, fx: 0.3 },
            drumLp: 16000, drive: 1.08, pressDrive: 0.12,
            duck: { bass: 0.4, harm: 0.75 },
            duckTime: { bass: 0.13, harm: 0.2 },
            master: { lp: 14000 },
          },
        },
      },
    ],
  },
  patches: {
    // An M1-ish organ: square + sine drawbars, a quick key click from the filter, full sustain, short release.
    "hamster-m1organ": {
      name: "M1 Organ",
      osc: [
        { type: "square", detune: -3, oct: 0, level: 0.45 },
        { type: "sine", detune: 2, oct: 0, level: 0.7 },
        { type: "sine", detune: 0, oct: 1, level: 0.35 },
        { type: "sine", detune: 0, oct: -1, level: 0.25 },
      ],
      filter: { type: "lowpass", cutoff: 2600, env: 2200, decay: 0.06, q: 0.8 },
      amp: { a: 0.003, d: 0.2, s: 0.75, r: 0.08 },
      vib: { rate: 6.2, depth: 6, delay: 0.05 },
      drive: 1.2,
      gain: 0.55,
    },
    // A pitched vowel cut (Todd Edwards): two saws through an "eh" formant pair, gated short, no vibrato.
    "hamster-vowel": {
      name: "Vowel Cut",
      osc: [
        { type: "sawtooth", detune: -6, oct: 0, level: 0.7 },
        { type: "sawtooth", detune: 6, oct: 0, level: 0.7 },
      ],
      formants: [560, 1700],
      filter: { type: "lowpass", cutoff: 5000, env: 0, decay: 0.1, q: 0.6 },
      amp: { a: 0.004, d: 0.15, s: 0.8, r: 0.05 },
      noise: 0.04,
      gain: 1.1,
    },
  },
} satisfies StationPack;
