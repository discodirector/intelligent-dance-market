import type { StationPack } from "../pack.ts";

// Hamster Drum & Bass: the Squeekchain wheel at DnB speed, on the liquid renderers. A running hamster is a roller:
// relentless forward motion, a figure that comes round like the wheel, a bassline that runs with him. Three rollers,
// each its own corner of the scene:
//   Wheel Roller   a rolling liquid roller (soulful): a two-bar root-fifth-octave bass running under warm Rhodes
//                  comps and soft sine strings, a shuffled 16th shaker that never stops.
//   Night Shift    a dark techy minimal roller (classic + walks + reese): a dry steppy break, a gritty detuned reese
//                  on a two-bar loop, one muted stab, two dark chords four bars apiece.
//   Burrow Jungle  a jungle roller (soulful): chopped ghost-heavy breaks with a sampler-grit snare, a deep held sub
//                  that moves to the fifth, dub chord stabs thrown into the echo.
// Walks (the bass): onsets 0..31 over two bars, `semi` over the chord root; only roots, fifths and octaves, so every
// note sits in the key under every chord. The chain tempo lands at the top of each `bpm` range: about 174, 175, 172.
// The top end stays smooth (MacBook speakers): no hat over 7.4 kHz highpass, a drum lowpass, no birds on mentions.
// No noise risers (riser 0: heard as air blowing), no crash wash, no saw pads, rooms and echoes kept off the drums
// (their tails were a steady hiss). Even loudness: half the heat, a breakdown that keeps a half kick, the bass and
// the chords (a walk needs the kick row to speak), and an intro (the opt-in `intro`) that keeps its half-time snare,
// hats, bass and an open filter (the form's intro fell 6-8 dB under the body).
export default {
  key: "hamster-dnb",
  name: "Hamster Drum & Bass",
  genres: ["liquid"],
  styles: {
    liquid: [
      // Rolling liquid roller (Calibre / Lenzman school, sped up to the wheel). The bass runs root, octave pop,
      // fifth, root on the 8ths of a two-bar cycle; i9 - bVII - bVImaj7 - v7 (or i - iv - bVII - i sus) two bars a
      // chord on a clean Rhodes, comped on the pushes, strings swelling underneath; kick 1 and 3&, a ghosted roll.
      {
        id: "hamster-dnb-roller",
        name: "Wheel Roller",
        base: "soulful",
        bpm: [170, 174],
        swing: 0.52,
        microScale: 0.15,
        trim: 0.95,
        riser: 0,
        heat: 0.5,
        breakdown: { kick: 0.5, snare: 0.3, hat: 0.5, bass: 1, pad: 1, lead: 1, filter: 0.85 },
        intro: { kick: 0.85, snare: 0.6, hat: 0.6, bass: 1, filter: 0.85 },
        leads: ["liquidRhodes"],
        data: {
          progressions: [
            [{ pad: [3, 7, 10, 14], root: 0 }, { pad: [2, 5, 10, 12], root: -2 }, { pad: [0, 3, 7, 10], root: -4 }, { pad: [-2, 2, 5, 10], root: 7 }],
            [{ pad: [3, 7, 10, 14], root: 0 }, { pad: [-4, 0, 3, 7], root: 5 }, { pad: [2, 5, 10, 14], root: -2 }, { pad: [2, 7, 10, 15], root: 0 }],
          ],
          walks: [
            [
              { s: 0, len: 3, oct: 0, core: true }, { s: 3, len: 1, oct: 1, core: false }, { s: 4, len: 2, oct: 0, semi: 7, core: true },
              { s: 6, len: 2, oct: 0, core: true }, { s: 10, len: 2, oct: 0, core: true }, { s: 13, len: 1, oct: 1, core: false },
              { s: 14, len: 2, oct: 0, semi: 7, core: true }, { s: 16, len: 4, oct: 0, core: true },
              { s: 20, len: 2, oct: 0, semi: 7, core: true }, { s: 22, len: 2, oct: 0, core: true }, { s: 26, len: 2, oct: 0, core: true },
              { s: 28, len: 4, oct: 0, semi: -5, core: true },
            ],
            [
              { s: 0, len: 4, oct: 0, core: true }, { s: 4, len: 2, oct: 1, core: false }, { s: 6, len: 2, oct: 0, semi: 7, core: true },
              { s: 10, len: 3, oct: 0, core: true }, { s: 13, len: 1, oct: 0, semi: 7, core: false }, { s: 14, len: 2, oct: 0, core: true },
              { s: 16, len: 4, oct: 0, core: true }, { s: 20, len: 2, oct: 1, core: false }, { s: 22, len: 2, oct: 0, semi: 7, core: true },
              { s: 26, len: 2, oct: 0, core: true }, { s: 28, len: 2, oct: 0, semi: 7, core: true }, { s: 30, len: 2, oct: 0, semi: -5, core: true },
            ],
          ],
          comps: [
            [{ s: 0, len: 6, core: true }, { s: 7, len: 2, core: false }, { s: 10, len: 4, core: true }, { s: 22, len: 3, core: true }, { s: 30, len: 10, core: true }],
            [{ s: 0, len: 8, core: true }, { s: 11, len: 2, core: false }, { s: 14, len: 4, core: true }, { s: 24, len: 2, core: false }, { s: 27, len: 4, core: true }],
          ],
          sub: 0.72,
          bass: { wave: "sine", drive: 1.4, octave: 0.16, hold: 0.9 },
          strings: {
            osc: [{ type: "sine", detune: -8, level: 0.5 }, { type: "sine", detune: 7, level: 0.5 }],
            cutoff: 700, q: 0.6, attack: 6, release: 2, level: 0.15, vib: 3,
          },
          kit: {
            kick: { start: 150, end: 47, sweep: 0.04, decay: 0.26, click: 0.3, clickHp: 2000, body: 1.15, drive: 1.2 },
            kickLevel: 1.1,
            snare: [
              { tone: "triangle", freq: 208, to: 176, sweep: 0.04, decay: 0.11, level: 0.5 },
              { noise: "bandpass", freq: 3000, q: 1.2, decay: 0.02, level: 0.3 },
              { noise: "bandpass", freq: 1800, q: 0.65, decay: 0.2, level: 0.85, tail: true },
            ],
            snareLevel: 1.35,
            ghostLevel: 0.48,
            hat: { hp: 6800, decay: 0.03, metal: 0, q: 1, pan: 0.25, level: 0.34 },
            shaker: { hp: 7400, decay: 0.022, metal: 0, pan: -0.25, level: 0.26 },
            open: { hp: 6200, decay: 0.08, metal: 0.4, q: 1.2, pan: 0.35, level: 0.2 },
            crash: 0,
            breaks: [
              { kick: "9.........8.....9.....4...8.....", snare: "....9.......9.......9.......9...", ghost: "..2..3.4.3...2.3..3.2..4.3.2..3.", hat: "53635363536353635363536353635363", open: "..............5...............5." },
              { kick: "9.........8...4.9.........8.....", snare: "....9.......9.......9.......9...", ghost: ".....3.4..2..3.3..2..3.4.3....4.", hat: "53635363536353635363536353635363", open: "......4...............4........." },
            ],
          },
          fills: [
            { kick: "..8.....", snare: "..4.9.56" },
            { kick: "..8..6..", snare: "4.5.9.67" },
          ],
          ornament: { voices: ["amen"], smart: ["amen"] },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.4, lp: 2000, hp: 450 },
            echoSend: { lead: 0.18, snare: 0, perc: 0 },
            space: { size: 0.9, fb: 0.5, lp: 2600 },
            spaceSend: { harm: 0.25, lead: 0.25, snare: 0.04, hat: 0, perc: 0, fx: 0 },
            drumLp: 10500,
            drive: 1.3,
            duck: { bass: 0.6, harm: 0.8 },
            master: { lp: 11500 },
          },
          mix: { hat: -2 },
        },
      },
      // Dark techy minimal roller (Dutch / Dispatch school). A dry steppy break (kick 1 and 3&, a ghost kick before
      // the 3, a tight crack), offbeat hats only; a gritty detuned reese an octave over a clean sub, on a two-bar
      // root-fifth loop with a slow filter drift (one cycle in two bars); two dark chords four bars apiece as a low
      // pad, a single muted stab on the offbeats and a three-note answer every eight bars, into a short echo.
      {
        id: "hamster-dnb-shift",
        name: "Night Shift",
        base: "classic",
        bpm: [172, 176],
        swing: 0.5,
        microScale: 0.05,
        trim: 1,
        riser: 0,
        heat: 0.5,
        breakdown: { kick: 0.5, snare: 0.3, hat: 0.5, bass: 1, pad: 1, lead: 1, filter: 0.85 },
        intro: { kick: 0.85, snare: 0.6, hat: 0.6, bass: 1, filter: 0.85 },
        leads: ["hdnb-steel"],
        data: {
          vamps: [
            { a: { pad: [0, 3, 7, 10], root: 0 }, b: { pad: [-4, 0, 3, 7], root: -4 } },
            { a: { pad: [0, 7, 10, 15], root: 0 }, b: { pad: [-5, -2, 2, 7], root: 7 } },
            { a: { pad: [0, 3, 10, 14], root: 0 }, b: { pad: [-2, 2, 5, 10], root: -2 } },
          ],
          stabs: [
            [{ s: 6, len: 1, core: true }, { s: 27, len: 1, core: false }, { s: 38, len: 1, core: true }, { s: 59, len: 1, core: false }],
            [{ s: 10, len: 1, core: true }, { s: 22, len: 1, core: false }, { s: 42, len: 1, core: true }, { s: 54, len: 1, core: false }],
          ],
          answers: [
            [{ s: 3, len: 1 }, { s: 6, len: 1 }, { s: 10, len: 3 }],
            [{ s: 2, len: 2 }, { s: 7, len: 1 }, { s: 11, len: 3 }],
          ],
          contours: [[2, 1, 0, 1, 2, 1, 0], [0, 0, 1, 0, 2, 1, 0]],
          walks: [
            [
              { s: 0, len: 4, oct: 0, core: true }, { s: 6, len: 2, oct: 0, core: true }, { s: 10, len: 3, oct: 0, core: true },
              { s: 13, len: 1, oct: 0, semi: 7, core: false }, { s: 14, len: 2, oct: 0, core: true }, { s: 16, len: 3, oct: 0, core: true },
              { s: 19, len: 2, oct: 0, semi: -5, core: true }, { s: 22, len: 4, oct: 0, core: true }, { s: 27, len: 1, oct: 1, core: false },
              { s: 28, len: 2, oct: 0, semi: 7, core: true }, { s: 30, len: 2, oct: 0, core: true },
            ],
            [
              { s: 0, len: 6, oct: 0, core: true }, { s: 6, len: 2, oct: 0, semi: 7, core: true }, { s: 10, len: 4, oct: 0, core: true },
              { s: 14, len: 1, oct: 1, core: false }, { s: 16, len: 3, oct: 0, core: true }, { s: 19, len: 1, oct: 0, core: false },
              { s: 22, len: 3, oct: 0, semi: -5, core: true }, { s: 26, len: 4, oct: 0, core: true }, { s: 30, len: 2, oct: 0, semi: 7, core: true },
            ],
          ],
          sub: 0.66,
          bass: { wave: "sine", drive: 0.8, octave: 0, hold: 0.88 },
          reese: { level: 1.05, detune: 13, drive: 3, cutoff: 230, q: 1.3, depth: 0.3, rate: 0.125 },
          pad: {
            osc: [{ type: "sine", detune: -7, level: 0.5 }, { type: "triangle", detune: 6, level: 0.4 }],
            cutoff: 420, q: 0.8, attack: 1.2, release: 2, level: 0.05, vib: 3,
          },
          kit: {
            kick: { start: 178, end: 49, sweep: 0.028, decay: 0.24, click: 0.35, clickHp: 2200, body: 1.15, drive: 1.6 },
            kickLevel: 1.15,
            snare: [
              { tone: "triangle", freq: 218, to: 182, sweep: 0.025, decay: 0.08, level: 0.55 },
              { noise: "bandpass", freq: 2200, q: 1.1, decay: 0.03, level: 0.45 },
              { noise: "bandpass", freq: 1500, q: 0.8, decay: 0.13, level: 0.75, tail: true },
            ],
            snareLevel: 1.4,
            ghostLevel: 0.3,
            hat: { hp: 6600, decay: 0.022, metal: 0.25, q: 1, pan: 0.2, level: 0.38 },
            shaker: { hp: 7200, decay: 0.014, metal: 0, pan: -0.3, level: 0.16 },
            open: { hp: 6000, decay: 0.06, metal: 0.4, q: 1.1, pan: 0.3, level: 0.18 },
            crash: 0,
            breaks: [
              { kick: "9......4..9.....9.........9..4..", snare: "....9.......9.......9.......9...", ghost: "...........2...........2.....2..", hat: ".262.262.262.262.262.262.262.262", open: "" },
              { kick: "9.........9.....9.....4...9.....", snare: "....9.......9.......9.......9...", ghost: "..........2............2..2.....", hat: ".262.262.262.262.262.262.262.262", open: "" },
            ],
          },
          fills: [
            { kick: "..8.....", snare: "....9.6." },
            { kick: "..8..6..", snare: "..4.9..6" },
          ],
          ornament: { voices: ["amen"], smart: ["amen"] },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.4, lp: 1900, hp: 450 },
            echoSend: { lead: 0.3, snare: 0, perc: 0 },
            space: { size: 0.8, fb: 0.5, lp: 2600 },
            spaceSend: { harm: 0.25, lead: 0.2, snare: 0.03, hat: 0, perc: 0, fx: 0 },
            drumLp: 10000,
            drive: 1.3,
            duck: { bass: 0.65, harm: 0.8 },
            master: { lp: 11000 },
          },
          mix: { hat: -2, lead: -1 },
        },
      },
      // Jungle roller (mid-90s school, original lanes). A chopped two-step with a ghost roll on most 16ths, a snare
      // with a sampler's grit (a crushed band under the body), rolling snare fills; a deep held sub moving to the
      // fifth below and back (an octave layer and a little drive so a laptop hears it), dub chord stabs into a
      // dotted echo, a low dark sine-string drone (voicings kept under the fifth over the tonic). i - i7 - bVI - bVII
      // or i - bVII - bVI - v, two bars a chord.
      {
        id: "hamster-dnb-burrow",
        name: "Burrow Jungle",
        base: "soulful",
        bpm: [168, 172],
        swing: 0.53,
        microScale: 0.25,
        trim: 0.85,
        riser: 0,
        heat: 0.5,
        breakdown: { kick: 0.5, snare: 0.3, hat: 0.5, bass: 1, pad: 1, lead: 1, filter: 0.85 },
        intro: { kick: 0.85, snare: 0.6, hat: 0.6, bass: 1, filter: 0.85 },
        leads: ["hdnb-dub"],
        data: {
          progressions: [
            [{ pad: [-5, 0, 3, 7], root: 0 }, { pad: [-5, -2, 3, 7], root: 0 }, { pad: [-4, 0, 3, 7], root: -4 }, { pad: [-7, -2, 2, 5], root: -2 }],
            [{ pad: [-5, 0, 3, 7], root: 0 }, { pad: [-7, -2, 2, 5], root: -2 }, { pad: [-4, 0, 3, 7], root: -4 }, { pad: [-5, -2, 2, 5], root: 7 }],
          ],
          walks: [
            [
              { s: 0, len: 10, oct: 0, core: true }, { s: 10, len: 6, oct: 0, semi: -5, core: true },
              { s: 16, len: 6, oct: 0, core: true }, { s: 22, len: 2, oct: 1, core: false }, { s: 24, len: 8, oct: 0, semi: -5, core: true },
            ],
            [
              { s: 0, len: 6, oct: 0, core: true }, { s: 6, len: 4, oct: 0, semi: -5, core: true }, { s: 10, len: 6, oct: 0, core: true },
              { s: 16, len: 10, oct: 0, core: true }, { s: 26, len: 6, oct: 0, semi: 7, core: true },
            ],
          ],
          comps: [
            [{ s: 6, len: 1, core: true }, { s: 22, len: 1, core: true }, { s: 27, len: 1, core: false }],
            [{ s: 3, len: 1, core: true }, { s: 14, len: 1, core: false }, { s: 19, len: 1, core: true }],
          ],
          sub: 0.85,
          bass: { wave: "sine", drive: 1.2, octave: 0.2, hold: 0.95, attack: 0.008 },
          strings: {
            osc: [{ type: "sine", detune: -12, level: 0.5 }, { type: "sine", detune: 11, level: 0.5 }],
            cutoff: 550, q: 0.7, attack: 5, release: 2.5, level: 0.13, vib: 2,
          },
          kit: {
            kick: { start: 140, end: 45, sweep: 0.045, decay: 0.3, click: 0.25, clickHp: 1800, body: 1.15, drive: 1.3 },
            kickLevel: 1.05,
            snare: [
              { tone: "triangle", freq: 196, to: 168, sweep: 0.04, decay: 0.1, level: 0.5 },
              { crush: 7, filter: "bandpass", freq: 1700, q: 0.9, decay: 0.13, level: 0.55, lp: 6000, tail: true },
              { noise: "bandpass", freq: 1200, q: 0.7, decay: 0.17, level: 0.45, tail: true },
            ],
            snareLevel: 1.35,
            ghostLevel: 0.55,
            hat: { hp: 6400, decay: 0.028, metal: 0.2, q: 1, pan: 0.2, level: 0.3 },
            shaker: { hp: 7000, decay: 0.02, metal: 0, pan: -0.3, level: 0.22 },
            open: { hp: 5600, decay: 0.12, metal: 0.5, q: 1.2, pan: 0.35, level: 0.2 },
            crash: 0,
            breaks: [
              { kick: "9.........9.....9.....5...9.....", snare: "....9.......9.......9.......9...", ghost: "..4.3..5.3.4..3..4.3..5..4.3.4.3", hat: "43534353435343534353435343534353", open: ".......5...............5........" },
              { kick: "9.........9...5.9.......5.......", snare: "....9.......9.......9.......8...", ghost: ".3.4..3.5.4..3.4.3..4.35.4..3.43", hat: "43534353435343534353435343534353", open: "..............5...............5." },
            ],
          },
          fills: [
            { kick: "..8.....", snare: "3.4.9.67" },
            { kick: "........", snare: "4.5.9576" },
            { kick: "8.....8.", snare: "..5.9.58" },
          ],
          ornament: { voices: ["amen"], smart: ["amen"] },
          fx: {
            echo: { steps: 3, taps: 4, fb: 0.5, lp: 1700, hp: 400 },
            echoSend: { lead: 0.45, snare: 0, perc: 0 },
            space: { size: 1.1, fb: 0.55, lp: 2600 },
            spaceSend: { harm: 0.25, lead: 0.25, snare: 0.04, hat: 0, perc: 0, fx: 0 },
            drumLp: 9500,
            drive: 1.3,
            duck: { bass: 0.6, harm: 0.8 },
            master: { lp: 11000 },
          },
          mix: { hat: -2 },
        },
      },
    ],
  },
  patches: {
    // Night Shift's stab: a muted metallic chord hit, a sine with a short FM bark and a quiet square an octave
    // down, a closed lowpass, no sustain: dark and short, never bright.
    "hdnb-steel": {
      name: "Muted Steel",
      osc: [
        { type: "sine", detune: 0, oct: 0, level: 0.8 },
        { type: "square", detune: 5, oct: -1, level: 0.22 },
      ],
      fm: { ratio: 2, index: 1.4, decay: 0.07, floor: 0.05 },
      filter: { type: "lowpass", cutoff: 850, env: 900, decay: 0.09, q: 1.2 },
      amp: { a: 0.003, d: 0.24, s: 0, r: 0.16 },
      gain: 0.7,
    },
    // Burrow Jungle's dub stab: a detuned saw pair through a warm lowpass, a quick knock and a short tail for the
    // echo to carry.
    "hdnb-dub": {
      name: "Dub Stab",
      osc: [
        { type: "sawtooth", detune: -7, oct: 0, level: 0.55 },
        { type: "sawtooth", detune: 7, oct: 0, level: 0.55 },
        { type: "sine", detune: 0, oct: -1, level: 0.3 },
      ],
      filter: { type: "lowpass", cutoff: 800, env: 1100, decay: 0.12, q: 1.6 },
      amp: { a: 0.004, d: 0.3, s: 0.08, r: 0.22 },
      gain: 0.5,
    },
  },
} satisfies StationPack;
