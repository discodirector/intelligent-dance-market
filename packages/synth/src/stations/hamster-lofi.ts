import type { StationPack } from "../pack.ts";

// Hamster Lo-Fi House: the Squeekchain station's lo-fi house, for a hamster running in his wheel. Warm, dusty and
// moving forward: every style keeps a four-on-the-floor kick, a present bassline and a loop that comes round like
// the wheel. Three producers, one idea each:
//   Wheel Loop    a swung, upbeat Sample Chop: a chord loop cut every three 16ths, so it turns against the bar like
//                 a wheel and lands back on the one every few bars, pumping under a round kick and a long sub.
//   Sawdust Rave  raw and crunchy on Raw Rave: a driven kick, a crushed break snare, a rolling organ bass that walks
//                 root, octave and seventh, a dark dusty piano and a low hoover pad. Rave-tinged, never bright.
//   Night Lap     deeper and jazzier on Dusty Keys: minor 11ths and altered dominants on a tine piano pushing on the
//                 offbeats, a driven triangle bass with its octave, thick shuffled hats. Late night, still running.
// The wheel plays the chain: each ~30 m of wheel is a buy (a bass onset, a busier loop), a stop a sell (thinner).
// Hard rules from the owner's feedback on this station: no noise risers (riser 0: heard as air blowing in the second
// half), no vinyl and no baked hiss (even 0.15 of vinyl lifted the 3-9 kHz floor 10 dB: a continuous wash; the
// dust is in the saturation, the dark master top and the crushed drums instead), no saw pads (Sawdust's held
// hoover saws were a hiss bed too), a smooth top (hats low and dark, no squeaks or blips),
// even loudness (0.45 of the heat, and a breakdown that keeps half the kick and the whole bass), and a bassline you
// hear on small speakers (triangle or organ harmonics over the sub).
export default {
  key: "hamster-lofi",
  name: "Hamster Lo-Fi House",
  genres: ["lofihouse"],
  patches: {
    // A dark, dusty house piano for Sawdust Rave: a soft triangle hammer, a low FM bark that falls fast, closed
    // filter. The M1 piano's colour without its bright ping.
    "hlofi-dust-piano": {
      name: "Dust Piano",
      osc: [
        { type: "triangle", detune: 0, oct: 0, level: 0.85 },
        { type: "sine", detune: -4, oct: 0, level: 0.4 },
        { type: "sawtooth", detune: 7, oct: 0, level: 0.08 },
      ],
      fm: { ratio: 1, index: 1.5, decay: 0.1, floor: 0.06 },
      filter: { type: "lowpass", cutoff: 1300, env: 1500, decay: 0.16, q: 0.7 },
      amp: { a: 0.003, d: 0.38, s: 0.2, r: 0.18 },
      drive: 1.3,
      gain: 0.72,
    },
    // A round electric-piano tine for Night Lap: sine body, a gentle FM bark at the attack, a slow tremolo-ish
    // vibrato, a long warm decay.
    "hlofi-night-tine": {
      name: "Night Tine",
      osc: [
        { type: "sine", detune: 0, oct: 0, level: 0.9 },
        { type: "triangle", detune: 4, oct: 0, level: 0.22 },
        { type: "sine", detune: -3, oct: -1, level: 0.3 },
      ],
      fm: { ratio: 1, index: 1.2, decay: 0.2, floor: 0.1 },
      filter: { type: "lowpass", cutoff: 1250, env: 900, decay: 0.28, q: 0.6 },
      amp: { a: 0.005, d: 1.1, s: 0.32, r: 0.6 },
      vib: { rate: 4.6, depth: 4, delay: 0.12 },
      gain: 0.78,
    },
  },
  styles: {
    lofihouse: [
      // A swung, upbeat roller on Sample Chop. The loop is cut every three 16ths (a dotted-eighth wheel) so it turns
      // against the bar and comes back to the one every few bars; a quiet chain plays the core cuts, a busy one fills
      // the turns. Minor 9th vamps that lift (i9 to IV13, i9 to bVImaj9, i11 to bVIImaj7). A round punchy kick with a
      // gentle pump, soft shakers, a long triangle sub with its octave so the bass reads on a laptop.
      {
        id: "hamster-lofi-loop",
        name: "Wheel Loop",
        base: "chop",
        bpm: [122, 126],
        swing: 0.58,
        microScale: 0.35,
        trim: 0.9,
        riser: 0,
        heat: 0.45,
        breakdown: { kick: 0.5, bass: 1, hat: 0.5, filter: 0.85, pad: 1, lead: 1 },
        data: {
          vamps: [
            { a: { pad: [0, 3, 7, 10, 14], root: 0 }, b: { pad: [-3, 3, 7, 12, 14], root: 5 } },
            { a: { pad: [-2, 3, 7, 10, 14], root: 0 }, b: { pad: [-4, 0, 3, 7, 10], root: -4 } },
            { a: { pad: [0, 5, 7, 10, 15], root: 0 }, b: { pad: [-2, 2, 5, 9, 14], root: -2 } },
          ],
          chops: [
            // The wheel: a cut every three 16ths across both bars, the full chord on the turns, its top between.
            [
              { s: 0, len: 2, slice: 0, core: true }, { s: 3, len: 2, slice: 1, core: true }, { s: 6, len: 2, slice: 0, core: true },
              { s: 9, len: 1, slice: 2, core: false }, { s: 12, len: 2, slice: 1, core: true }, { s: 15, len: 1, slice: 3, core: false },
              { s: 16, len: 2, slice: 0, core: true }, { s: 19, len: 2, slice: 1, core: true }, { s: 22, len: 2, slice: 0, core: true },
              { s: 25, len: 1, slice: 2, core: false }, { s: 28, len: 2, slice: 1, core: true }, { s: 30, len: 2, slice: 3, core: false },
            ],
            // Paddle steps: offbeat chords pushing forward, a short top answer before each beat.
            [
              { s: 2, len: 2, slice: 0, core: true }, { s: 5, len: 1, slice: 1, core: false }, { s: 6, len: 2, slice: 0, core: true },
              { s: 10, len: 2, slice: 0, core: true }, { s: 13, len: 1, slice: 2, core: false }, { s: 14, len: 2, slice: 1, core: true },
              { s: 18, len: 2, slice: 0, core: true }, { s: 21, len: 1, slice: 1, core: false }, { s: 22, len: 2, slice: 0, core: true },
              { s: 26, len: 2, slice: 0, core: true }, { s: 29, len: 1, slice: 3, core: false }, { s: 30, len: 2, slice: 1, core: true },
            ],
            // The spin-up: three short cuts climbing the slices, then a held chord; twice a bar.
            [
              { s: 0, len: 1, slice: 3, core: true }, { s: 1, len: 1, slice: 1, core: false }, { s: 2, len: 3, slice: 0, core: true },
              { s: 6, len: 2, slice: 1, core: true }, { s: 8, len: 1, slice: 3, core: false }, { s: 9, len: 1, slice: 1, core: false },
              { s: 10, len: 3, slice: 0, core: true }, { s: 14, len: 2, slice: 2, core: false },
              { s: 16, len: 1, slice: 3, core: true }, { s: 17, len: 1, slice: 1, core: false }, { s: 18, len: 3, slice: 0, core: true },
              { s: 22, len: 2, slice: 1, core: true }, { s: 25, len: 1, slice: 1, core: false }, { s: 26, len: 4, slice: 0, core: true },
            ],
          ],
          sub: 1,
          kit: {
            kick: { start: 118, end: 47, sweep: 0.05, decay: 0.34, click: 0.1, clickHp: 1500, drive: 1.3, body: 1.1 },
            shaker: { freq: 5200, color: 800, q: 0.9, decay: 0.03, offDecay: 0.042, attack: 0.008, level: 0.12, off: 0.2 },
            open: { hp: 5000, decay: 0.13, metal: 0.15, level: 0.2 },
          },
          bass: { wave: "triangle", attack: 0.01, hold: 0.85, drive: 0.9, octave: 0.22 },
          chop: {
            osc: [{ type: "triangle", detune: -5, level: 0.62 }, { type: "sine", detune: 6, level: 0.4 }, { type: "sawtooth", detune: 11, level: 0.12 }],
            cutoff: 620, q: 0.9, level: 0.66, vib: 6, drive: 1.5, noise: 0, hp: 200,
          },
          pump: { bass: 0.6, harm: 0.32, release: 3 },
          vinyl: 0,
          mix: { bass: 1.5 },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.35, lp: 2200, hp: 450 },
            echoSend: { harm: 0.12, perc: 0.15 },
            space: { size: 0.9, fb: 0.6, lp: 3800 },
            spaceSend: { harm: 0.22, snare: 0.22, hat: 0.06 },
            drumLp: 9000,
            master: { lp: 11000 },
          },
        },
      },
      // Raw and crunchy on Raw Rave, warmed down: a driven kick and a crushed break snare under a soft clap, dusty
      // 6-bit hats, a dark house piano stabbing the pushes. The organ bass is the hook: low drawbars and a solid sub,
      // rolling root, octave, seventh and fifth with the wheel's onsets. A low hoover pad breathes under it; the
      // crushed rave hit is kept quiet in the perc row.
      {
        id: "hamster-lofi-sawdust",
        name: "Sawdust Rave",
        base: "rave",
        bpm: [124, 128],
        swing: 0.53,
        microScale: 0.15,
        trim: 0.85,
        riser: 0,
        heat: 0.45,
        breakdown: { kick: 0.5, bass: 1, hat: 0.5, filter: 0.85, pad: 1, lead: 1 },
        leads: ["hlofi-dust-piano"],
        data: {
          vamps: [
            { a: { pad: [0, 3, 7, 12], root: 0 }, b: { pad: [-2, 2, 5, 10], root: -2 } },
            { a: { pad: [0, 3, 7, 10], root: 0 }, b: { pad: [-4, 0, 3, 8], root: -4 } },
            { a: { pad: [0, 5, 7, 12], root: 0 }, b: { pad: [-5, 2, 7, 10], root: -5 } },
          ],
          stabs: [
            // Push and roll: the chord just before the beat, answered on the "and".
            [
              { s: 0, len: 2, core: true }, { s: 3, len: 1, core: false }, { s: 6, len: 2, core: true }, { s: 10, len: 2, core: true },
              { s: 14, len: 2, core: true }, { s: 19, len: 2, core: true }, { s: 22, len: 2, core: true }, { s: 25, len: 1, core: false },
              { s: 27, len: 2, core: true }, { s: 30, len: 2, core: false },
            ],
            // Every third 16th for a bar, then a held chord: the loop goes round.
            [
              { s: 0, len: 2, core: true }, { s: 3, len: 2, core: true }, { s: 6, len: 2, core: true }, { s: 9, len: 2, core: false },
              { s: 12, len: 3, core: true }, { s: 18, len: 2, core: true }, { s: 22, len: 4, core: true }, { s: 28, len: 2, core: false },
            ],
            // Offbeat organ-house pushes.
            [
              { s: 2, len: 2, core: true }, { s: 6, len: 2, core: true }, { s: 10, len: 1, core: false }, { s: 11, len: 3, core: true },
              { s: 18, len: 2, core: true }, { s: 22, len: 2, core: true }, { s: 26, len: 1, core: false }, { s: 27, len: 3, core: true },
            ],
          ],
          organ: [0, 0, 12, 7, 10, 0, 12, 5],
          kit: {
            kick: { start: 128, end: 47, sweep: 0.048, decay: 0.33, click: 0.25, clickHp: 1800, drive: 1.8, body: 1.08 },
            snare: [
              { tone: "triangle", freq: 205, to: 165, sweep: 0.04, decay: 0.08, level: 0.42 },
              { crush: 5, filter: "bandpass", freq: 1600, q: 0.6, decay: 0.16, level: 0.46, tail: true, lp: 5500 },
            ],
            hat: { hp: 6300, decay: 0.018, metal: 0, level: 0.24, crush: 6 },
            open: { hp: 5000, decay: 0.07, metal: 0, level: 0.36, crush: 6 },
          },
          bass: { wave: "sine", attack: 0.008, hold: 0.9, drive: 0.4, octave: 0 },
          organTone: { drawbars: [[1, 1], [2, 0.5], [3, 0.18], [0.5, 0.3]], drive: 1.2, cutoff: 800, q: 0.8, level: 0.2, click: 0.012, sub: 0.6 },
          // The hoover, warmed down to a sine and triangle pair under a closed filter: it still bends up into pitch
          // and swells, but holds no saw hiss.
          pad: {
            osc: [{ type: "sine", detune: -8, level: 0.5 }, { type: "triangle", detune: 8, level: 0.35 }],
            cutoff: 200, q: 0.7, attack: 0.5, release: 1.2, level: 0.05, vib: 4, hp: 260,
          },
          vinyl: 0,
          mix: { perc: -5, bass: 1 },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.38, lp: 2400, hp: 400 },
            echoSend: { lead: 0.22, perc: 0.15 },
            space: { size: 0.8, fb: 0.6, lp: 3800 },
            spaceSend: { lead: 0.22, snare: 0.2, harm: 0.25 },
            drumLp: 8500,
            drive: 1.12,
            master: { lp: 10500 },
          },
        },
      },
      // Deeper and jazzier on Dusty Keys, a late-night lap that keeps running: minor 11ths, an F13 shell, Abmaj9#11
      // and a G7#9 on a round tine piano, stabbing the offbeats and pushes so the groove leans forward. A soft deep
      // kick, a warm clap, thick swung hats with a dark open hat on the "and"s, a driven triangle bass with its octave.
      {
        id: "hamster-lofi-night",
        name: "Night Lap",
        base: "classic",
        bpm: [120, 124],
        swing: 0.56,
        microScale: 0.3,
        trim: 0.95,
        riser: 0,
        heat: 0.45,
        breakdown: { kick: 0.5, bass: 1, hat: 0.5, filter: 0.85, pad: 1, lead: 1 },
        leads: ["hlofi-night-tine"],
        data: {
          vamps: [
            { a: { pad: [0, 3, 5, 10, 14], root: 0 }, b: { pad: [-3, 2, 3, 7], root: 5 } },
            { a: { pad: [-2, 3, 7, 10, 14], root: 0 }, b: { pad: [-4, 0, 2, 7, 10], root: -4 } },
            { a: { pad: [0, 3, 7, 10, 14], root: 0 }, b: { pad: [-5, -1, 3, 5, 10], root: -5 } },
          ],
          stabs: [
            // The lean: offbeat chords, a held one across the bar line.
            [
              { s: 2, len: 2, core: true }, { s: 6, len: 2, core: false }, { s: 10, len: 2, core: true }, { s: 13, len: 4, core: true },
              { s: 18, len: 2, core: true }, { s: 22, len: 2, core: false }, { s: 26, len: 3, core: true }, { s: 30, len: 2, core: false },
            ],
            // A dotted turn: every three 16ths from the "a" of one, then rest and push.
            [
              { s: 3, len: 2, core: true }, { s: 6, len: 2, core: true }, { s: 9, len: 2, core: false }, { s: 12, len: 3, core: true },
              { s: 19, len: 2, core: true }, { s: 22, len: 2, core: true }, { s: 25, len: 2, core: false }, { s: 28, len: 4, core: true },
            ],
            // Call and lift: two short stabs, a long one, the second bar answers higher in the rhythm.
            [
              { s: 0, len: 2, core: true }, { s: 3, len: 1, core: false }, { s: 7, len: 4, core: true }, { s: 14, len: 2, core: false },
              { s: 16, len: 1, core: true }, { s: 18, len: 2, core: true }, { s: 22, len: 1, core: false }, { s: 23, len: 5, core: true },
            ],
          ],
          sub: 1,
          kit: {
            kick: { start: 100, end: 46, sweep: 0.065, decay: 0.38, click: 0.06, drive: 1.1, body: 1.1 },
            clap: [
              { noise: "bandpass", freq: 1050, q: 1, decay: 0.02, level: 0.6 },
              { noise: "bandpass", freq: 1050, q: 1, decay: 0.02, level: 0.6, at: 0.012 },
              { noise: "bandpass", freq: 1050, q: 1, decay: 0.2, level: 0.62, at: 0.024 },
              { tone: "triangle", freq: 190, to: 160, sweep: 0.03, decay: 0.05, level: 0.2 },
            ],
            hat: { hp: 6200, decay: 0.024, metal: 0.05, level: 0.17 },
            open: { hp: 4800, decay: 0.14, metal: 0.18, level: 0.27 },
          },
          bass: { wave: "triangle", attack: 0.01, hold: 0.9, drive: 1, octave: 0.25 },
          vinyl: 0,
          mix: { bass: 1.5 },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.36, lp: 2000, hp: 450 },
            echoSend: { lead: 0.24, perc: 0.15 },
            space: { size: 1.2, fb: 0.68, lp: 3600 },
            spaceSend: { lead: 0.32, snare: 0.26, hat: 0.06, harm: 0.3 },
            drumLp: 8000,
            master: { lp: 10500 },
          },
        },
      },
    ],
  },
} satisfies StationPack;
