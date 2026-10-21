import type { StationPack } from "../pack.ts";

// The reference pack (README.md): three genres, two styles each, every style a house renderer with its own tables
// AND its own sound, so each one reads as another producer: dry and tight vs dub-delay heavy, lofi crushed vs clean
// and wide. Copy this file to <key>.ts, then change the key, the name, the genres and the styles. Data only.

export default {
  key: "example",
  name: "Example Night Shift",
  genres: ["liquid", "triphop", "acid"],
  // The pack's own lead patches (leads.ts LeadPatch shape); a style's `leads` names them.
  patches: {
    // A darker, barking electric piano: FM tine through a little drive, short and percussive.
    "night-ep": {
      name: "Night EP",
      osc: [
        { type: "sine", detune: 0, oct: 0, level: 0.85 },
        { type: "triangle", detune: -4, oct: 0, level: 0.25 },
        { type: "sine", detune: 3, oct: 1, level: 0.12 },
      ],
      fm: { ratio: 1, index: 2.4, decay: 0.18, floor: 0.1 },
      filter: { type: "lowpass", cutoff: 1300, env: 1600, decay: 0.22, q: 0.8 },
      amp: { a: 0.003, d: 0.9, s: 0.25, r: 0.35 },
      drive: 1.8,
      gain: 0.75,
    },
    // A vibraphone-like tine: soft FM, long ring, a quick vibrato from the start.
    "soul-tine": {
      name: "Vibe Tine",
      osc: [
        { type: "sine", detune: 0, oct: 0, level: 0.9 },
        { type: "sine", detune: 0, oct: 1, level: 0.08 },
      ],
      fm: { ratio: 1, index: 1.2, decay: 0.5, floor: 0.15 },
      filter: { type: "lowpass", cutoff: 2600, env: 600, decay: 0.4, q: 0.5 },
      amp: { a: 0.006, d: 1.8, s: 0.4, r: 0.8 },
      vib: { rate: 5.6, depth: 14, delay: 0.05 },
      gain: 0.8,
    },
    // A worn Wurlitzer: a reedy FM bark, more drive, a darker top.
    "smoke-wurli": {
      name: "Smoke Wurli",
      osc: [
        { type: "sine", detune: 0, oct: 0, level: 0.8 },
        { type: "triangle", detune: 2, oct: 0, level: 0.3 },
      ],
      fm: { ratio: 1, index: 2.6, decay: 0.15, floor: 0.12 },
      filter: { type: "lowpass", cutoff: 1500, env: 1200, decay: 0.25, q: 0.7 },
      amp: { a: 0.003, d: 0.9, s: 0.3, r: 0.25 },
      drive: 2.2,
      gain: 0.72,
    },
    // A clean glassy piano: bright hammer, the octave a little detuned, long open ring.
    "noir-glass": {
      name: "Glass Piano",
      osc: [
        { type: "sine", detune: 0, oct: 0, level: 0.8 },
        { type: "sine", detune: 2, oct: 1, level: 0.35 },
        { type: "sine", detune: -3, oct: 2, level: 0.08 },
      ],
      fm: { ratio: 2, index: 1.4, decay: 0.25, floor: 0.05 },
      filter: { type: "lowpass", cutoff: 5200, env: 2000, decay: 0.2, q: 0.5 },
      amp: { a: 0.002, d: 0.6, s: 0.2, r: 0.9 },
      gain: 0.85,
    },
  },
  styles: {
    liquid: [
      // Keys renderer, DRY AND TIGHT: darker vamps and pushed stabs, a short clicky kick, a snappy high snare, closed
      // hats, a punchy driven triangle sub, a dark short pad and a barking EP; almost no room, no echo.
      {
        id: "night-keys",
        name: "Night Keys",
        base: "classic",
        bpm: [172, 176],
        trim: 1.14,
        leads: ["night-ep"],
        data: {
          vamps: [
            { a: { pad: [3, 7, 10, 14], root: 0 }, b: { pad: [5, 8, 12, 15], root: 5 } },
            { a: { pad: [0, 3, 7, 10, 14], root: 0 }, b: { pad: [-2, 2, 5, 10, 14], root: -2 } },
          ],
          stabs: [
            [
              { s: 6, len: 2, core: true }, { s: 14, len: 2, core: false }, { s: 22, len: 2, core: true },
              { s: 38, len: 3, core: true }, { s: 46, len: 2, core: false }, { s: 58, len: 2, core: true },
            ],
            [
              { s: 3, len: 2, core: true }, { s: 19, len: 2, core: true }, { s: 30, len: 2, core: false },
              { s: 35, len: 3, core: true }, { s: 51, len: 2, core: true }, { s: 62, len: 2, core: false },
            ],
          ],
          answers: [
            [{ s: 0, len: 4 }, { s: 4, len: 4 }, { s: 8, len: 14 }],
            [{ s: 2, len: 2 }, { s: 4, len: 6 }, { s: 12, len: 12 }],
          ],
          kit: {
            kick: { start: 190, end: 52, sweep: 0.022, decay: 0.16, click: 0.8, clickHp: 4200, drive: 0.6, body: 1 },
            snare: [
              { tone: "triangle", freq: 260, to: 210, sweep: 0.02, decay: 0.06, level: 0.45 },
              { noise: "bandpass", freq: 3200, q: 1.1, decay: 0.08, level: 1, tail: true },
              { noise: "highpass", freq: 8200, q: 0.7, decay: 0.05, level: 0.45, tail: true },
            ],
            hat: { hp: 9500, decay: 0.018, metal: 0.25, pan: 0.15, level: 0.55 },
            open: { hp: 8000, decay: 0.09, metal: 0.5, pan: 0.3, level: 0.25 },
            breaks: [
              {
                kick: "9.....5...8.....9.........8..4..",
                snare: "....9.......9.......9.......9...",
                ghost: "..3...2..3....2...3..2..3...2.3.",
                hat: "52725272527252725272527252725272",
                open: "......5...............5.........",
              },
            ],
          },
          bass: { wave: "triangle", drive: 1.2, hold: 0.7 },
          pad: { osc: [{ type: "triangle", detune: -3, level: 0.5 }, { type: "sine", detune: 4, level: 0.4 }], cutoff: 480, attack: 0.6, release: 1.2, vib: 3 },
          fx: {
            echoSend: { lead: 0, snare: 0, perc: 0.1 },
            space: { size: 0.7, fb: 0.6 },
            spaceSend: { harm: 0.2, lead: 0.22, snare: 0.08, hat: 0, fx: 0.2 },
            drumLp: 18000,
          },
          mix: { kick: 1.5, snare: 1, harm: -2 },
        },
      },
      // Soulful renderer, DUB-DELAY HEAVY: other changes and a lazier walk; a round low kick and the soft snare thrown
      // into a long dark echo, a huge room, wide slow strings and a vibraphone tine.
      {
        id: "deep-soul",
        name: "Deep Soul",
        base: "soulful",
        bpm: [170, 174],
        trim: 0.94,
        leads: ["soul-tine"],
        data: {
          progressions: [
            [{ pad: [3, 7, 10, 14], root: 0 }, { pad: [2, 5, 9, 14], root: -2 }, { pad: [-4, 0, 3, 7], root: -4 }, { pad: [-2, 2, 5, 10], root: 7 }],
            [{ pad: [3, 7, 10, 14], root: 0 }, { pad: [-4, 0, 3, 7], root: -4 }, { pad: [0, 3, 8, 12], root: 5 }, { pad: [2, 5, 9, 14], root: -2 }],
          ],
          walks: [
            [
              { s: 0, len: 8, oct: 0, core: true }, { s: 10, len: 4, oct: 1, core: false }, { s: 14, len: 2, oct: 0, core: true },
              { s: 16, len: 10, oct: 0, core: true }, { s: 28, len: 4, oct: 1, core: false },
            ],
          ],
          comps: [
            [{ s: 2, len: 6, core: true }, { s: 12, len: 2, core: false }, { s: 18, len: 8, core: true }, { s: 30, len: 10, core: true }],
          ],
          kit: {
            kick: { start: 120, end: 44, sweep: 0.06, decay: 0.38, click: 0.15, clickHp: 1800, body: 1.15 },
            snare: "soft",
            breaks: [
              {
                kick: "9.........9...4.9.....6...8.....",
                snare: "....9.......9.......9.......9...",
                ghost: "..2.3...2..3.2....2.3.4...3.2.43",
                hat: "42524252425242524252425242524252",
                open: "..............5...............6.",
              },
            ],
          },
          bass: { attack: 0.02, hold: 0.98 },
          strings: {
            osc: [{ type: "sawtooth", detune: -16, level: 0.3 }, { type: "sawtooth", detune: 0, level: 0.3 }, { type: "sawtooth", detune: 15, level: 0.3 }],
            cutoff: 1500, release: 3, vib: 7,
          },
          vinyl: 0.4,
          fx: {
            echo: { steps: 3, taps: 7, fb: 0.62, lp: 2000, hp: 500 },
            echoSend: { lead: 0.6, snare: 0.45, harm: 0.15, perc: 0.3 },
            space: { size: 2, fb: 0.8, lp: 3800 },
            spaceSend: { harm: 0.65, lead: 0.7, snare: 0.45 },
          },
          mix: { lead: 1, harm: 1, hat: -2 },
        },
      },
    ],
    triphop: [
      // Rhodes Break renderer, LOFI CRUSHED: a borrowed bIII chord, a heavier kick; everything off a dusty sampler: a
      // boomy driven kick, a crushed snare, crushed hats, a worn Wurlitzer, heavy crackle, a 9-bit, dark master.
      {
        id: "smoke-rhodes",
        name: "Smoke Rhodes",
        base: "classic",
        bpm: [80, 90],
        trim: 1.07,
        leads: ["smoke-wurli"],
        data: {
          chords: { III: { root: 3, voice: [-2, 3, 7, 14], alt: [3, 7, 10, 14] } },
          progressions: [
            ["i", "III", "VI", "VII"],
            ["i", "iv", "III", "v"],
          ],
          statements: [
            [{ s: 0, len: 6, p: "C" }, { s: 8, len: 2, p: "U", opt: true }, { s: 12, len: 4, p: "L" }, { s: 18, len: 12, p: "C" }],
            [{ s: 0, len: 14, p: "C" }, { s: 16, len: 2, p: 3 }, { s: 20, len: 10, p: "C" }],
          ],
          kicks: { lo: [[0, 10]], mid: [[0, 6, 10]], hi: [[0, 3, 8, 10], [0, 6, 10, 14]] },
          sub: 0.6,
          kit: {
            kick: { start: 80, end: 38, sweep: 0.09, decay: 0.5, click: 0.05, drive: 2.6, body: 1.2 },
            snare: [
              { tone: "triangle", freq: 180, to: 150, decay: 0.09, level: 0.35 },
              { crush: 5, filter: "bandpass", freq: 1700, q: 0.7, decay: 0.26, level: 0.55, lp: 5200 },
            ],
            hat: { hp: 5200, decay: 0.03, metal: 0, level: 0.32, crush: 5 },
          },
          bass: { wave: "triangle", drive: 2, octave: 0.08 },
          bowed: { cutoff: 380, vib: 16 },
          vinyl: 2.2,
          fx: {
            drumLp: 6500,
            drive: 1.25,
            space: { size: 0.9, lp: 2600 },
            master: { lp: 6800, crush: 9 },
          },
          mix: { tex: 2 },
        },
      },
      // Cinematic renderer, CLEAN AND WIDE: three chords and a sparser cut; a tight clean kick, a crisp snare with
      // a little air, no crackle, an open kit, a round sine bass, wide bright strings, a glass piano, a huge bright room.
      {
        id: "noir",
        name: "Noir",
        base: "cinematic",
        bpm: [86, 96],
        trim: 1.55,
        leads: ["noir-glass"],
        data: {
          voicings: [
            { pad: [0, 3, 7, 10], root: 0 },
            { pad: [-4, 3, 8, 12], root: 8 },
            { pad: [-2, 2, 7, 10], root: 7 },
          ],
          cuts: [
            { s: 0, len: 3, core: true }, { s: 4, len: 2, core: false }, { s: 8, len: 6, core: true },
            { s: 18, len: 2, core: true }, { s: 20, len: 2, core: false }, { s: 24, len: 7, core: true },
          ],
          kit: {
            kick: { start: 150, end: 52, sweep: 0.035, decay: 0.22, click: 0.45, clickHp: 3500, body: 1 },
            snare: [
              { tone: "triangle", freq: 220, to: 180, decay: 0.08, level: 0.4, pan: 0 },
              { noise: "bandpass", freq: 2600, press: 0.1, q: 0.8, decay: 0.18, level: 0.75, pan: 0 },
              { noise: "highpass", freq: 7000, q: 0.7, decay: 0.12, level: 0.3, pan: 0.2, at: 0.012, accent: true },
            ],
            drag: 0.004,
            hat: { hp: 7500, decay: 0.03, metal: 0.3, level: 0.24 },
            open: { hp: 7000, decay: 0.16, metal: 0.5, level: 0.35 },
          },
          bassTone: { wave: "sine", cutoff: 600, color: 300, q: 0.5, drive: 0.4, level: 0.18, sustain: 0.08 },
          bowed: { osc: [{ type: "sawtooth", detune: 12, level: 0.3 }, { type: "triangle", detune: 4, level: 0.3 }], cutoff: 1700, vib: 4 },
          vinyl: 0,
          fx: {
            drumLp: 17000,
            space: { size: 2.2, fb: 0.82, lp: 6500 },
            spaceSend: { harm: 0.55, snare: 0.5, lead: 0.45, fx: 0.4 },
            echoSend: { lead: 0.25, snare: 0.15 },
          },
          mix: { kick: 1 },
        },
      },
    ],
    acid: [
      // 303 Floor renderer, DUB ACID: its own two lines on a darker, squelchier 303 with a long decay, thrown into a
      // dark dub echo with the claps and the clave; a round driven kick, a snappy clap, shimmering hats.
      {
        id: "night-303",
        name: "Night 303",
        base: "classic",
        trim: 1.03,
        data: {
          lines: [
            [
              { degree: 0, octave: 0, flags: 1 }, { degree: 0, octave: 1, flags: 2 }, { degree: 2, octave: 0, flags: 0 }, null,
              { degree: 0, octave: -1, flags: 1 }, { degree: 3, octave: 0, flags: 4 }, { degree: 4, octave: 0, flags: 2 }, { degree: 2, octave: 0, flags: 0 },
              { degree: 0, octave: 0, flags: 1 }, null, { degree: 1, octave: 0, flags: 2 }, { degree: 2, octave: 0, flags: 0 },
              { degree: 0, octave: 1, flags: 1 }, { degree: 4, octave: 0, flags: 4 }, { degree: 3, octave: 0, flags: 2 }, null,
            ],
            [
              { degree: 0, octave: 0, flags: 1 }, null, { degree: 0, octave: 0, flags: 0 }, { degree: 1, octave: 0, flags: 2 },
              { degree: 2, octave: 0, flags: 0 }, null, { degree: 0, octave: 1, flags: 1 }, { degree: 0, octave: 0, flags: 0 },
              { degree: 3, octave: 0, flags: 2 }, { degree: 2, octave: 0, flags: 0 }, null, { degree: 0, octave: 0, flags: 1 },
              { degree: 4, octave: 0, flags: 4 }, { degree: 0, octave: 0, flags: 2 }, { degree: 1, octave: 0, flags: 0 }, { degree: 0, octave: -1, flags: 1 },
            ],
          ],
          voice: { cutoff: 120, envMod: 2200, resonance: 3.85, decay: 0.28, drive: 1.6, level: 0.22 },
          kit: {
            kick: { start: 140, end: 46, sweep: 0.04, decay: 0.38, click: 0.25, drive: 1.6, body: 1.1 },
            clap: [
              { noise: "bandpass", freq: 1500, q: 1.4, decay: 0.015, level: 0.7 },
              { noise: "bandpass", freq: 1500, q: 1.4, decay: 0.015, level: 0.7, at: 0.009 },
              { noise: "bandpass", freq: 1300, q: 1, decay: 0.3, level: 0.6, at: 0.02 },
              { noise: "highpass", freq: 5000, q: 0.7, decay: 0.08, level: 0.25, at: 0.02 },
            ],
            hat: { hp: 9000, decay: 0.02, metal: 0.4, q: 1, level: 0.5 },
            open: { hp: 8000, decay: 0.2, metal: 0.6, q: 1, level: 0.45 },
            perc: [
              { tone: "sine", freq: 1600, to: 1400, decay: 0.05, level: 0.25 },
              { noise: "bandpass", freq: 3000, q: 3, decay: 0.03, level: 0.2 },
            ],
          },
          fx: {
            echo: { steps: 3, taps: 6, fb: 0.6, lp: 1800, hp: 450 },
            echoSend: { bass: 0.4, perc: 0.5, snare: 0.35 },
            space: { size: 1.6, fb: 0.78, lp: 3200 },
            spaceSend: { snare: 0.4, bass: 0.1, hat: 0.1 },
          },
        },
      },
      // Slow Rubber renderer, DRY MINIMAL: longer held notes on other steps, played on a saw instead of the hollow
      // square; a short punchy kick, a tight clap, ticking hats and a clave, bone dry.
      {
        id: "rubber-band",
        name: "Rubber Band",
        base: "rubber",
        bpm: [112, 118],
        trim: 1.52,
        data: {
          lines: [
            [
              { degree: 0, octave: 0, flags: 3, gate: 3.5 }, null, null, null,
              { degree: 2, octave: 0, flags: 0, gate: 1.8 }, null, { degree: 3, octave: 0, flags: 2, gate: 3.5 }, null,
              null, null, { degree: 1, octave: 0, flags: 0, gate: 1.8 }, null,
              { degree: 0, octave: 1, flags: 6, gate: 1.5 }, null, null, null,
            ],
            [
              { degree: 0, octave: 0, flags: 1, gate: 2.5 }, null, null, { degree: 4, octave: -1, flags: 2, gate: 2.5 },
              null, null, null, { degree: 2, octave: 0, flags: 0, gate: 2 },
              null, null, { degree: 0, octave: 0, flags: 2, gate: 2.5 }, null,
              null, { degree: 1, octave: 0, flags: 4, gate: 1.5 }, null, null,
            ],
          ],
          voice: { wave: "saw", cutoff: 80, envMod: 1400, resonance: 3.4, decay: 0.12, drive: 1.4, level: 0.14 },
          kit: {
            kick: { start: 150, end: 52, sweep: 0.03, decay: 0.2, click: 0.55, clickHp: 3500, body: 1.1 },
            clap: [
              { noise: "bandpass", freq: 1800, q: 1.2, decay: 0.012, level: 0.6 },
              { noise: "bandpass", freq: 1800, q: 1.2, decay: 0.09, level: 0.65, at: 0.008 },
            ],
            hat: { hp: 9500, decay: 0.012, metal: 0.2, level: 0.5 },
            open: { hp: 8500, decay: 0.05, metal: 0.3, level: 0.5 },
            perc: [
              { tone: "triangle", freq: 2400, to: 2200, decay: 0.03, level: 0.4 },
              { noise: "highpass", freq: 6000, q: 0.7, decay: 0.01, level: 0.3 },
            ],
          },
          fx: {
            echoSend: { bass: 0, perc: 0.15 },
            spaceSend: { snare: 0.03, perc: 0.05, bass: 0 },
            drumLp: 18000,
            drive: 1.25,
          },
          mix: { kick: 1, hat: 1 },
        },
      },
    ],
  },
} satisfies StationPack;
