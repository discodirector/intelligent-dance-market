import type { StationPack } from "../pack.ts";

// Hamster Acid: the Squeekchain station. A real hamster's wheel plays the 303: every ~30 m of wheel distance is
// one input into the chain, his speed sets the tier, a stop thins the grid. The resonant 303 line is the squeak.
// Music first: four acid producers, each with its own groove and its own 303.
//   Squeak  Phuture / Armando: raw resonant saw, a driven 909 and a 707 clap, straight Chicago machine groove.
//   Wheel   Hardfloor acid techno: a deep rolling 16th line, a slow 32-bar filter sweep, a dotted echo, faster.
//   Den     slow rubbery acid: a hollow square sliding low under long gates, a swung pocket, a dusty room.
//   Hop     bouncy shuffled acid: short plucked octave jumps, offbeat accents, a wooden seed knock in the perc row.
// Steps: degree 0..4 of the acid notes (root, m3, 5th, b7, octave), octave -1..1, flags 1 accent + 2 slide +
// 4 ornament (plays only when the chain's bass row is busy, so a slow wheel drops it).
// No noise risers (riser 0: the owner hears them as air blowing through the second half). Even loudness: 0.4 of the
// heat (a hot floor swelled them by 3-5 dB) and a breakdown that keeps a half kick and the full 303 (it fell to
// -30 LUFS, near silence).
// A sub under every 303 (voice.sub): the resonant line alone read as a squelch with no bass under it (its fundamental
// sat ~15 dB under the mix and added 0.5 dB to the 40-250 Hz band, the kick was all the low end). The trims came down
// 1 dB for the added weight.
export default {
  key: "hamster-acid",
  name: "Hamster Acid",
  genres: ["acid"],
  styles: {
    acid: [
      // Phuture night: the root hammered with accents, slides up an octave, a squealing high resonance. One octave
      // span and no accent on the high notes, so the line keeps an even level (a 2-octave accented leap jumped out).
      {
        id: "hamster-squeak",
        name: "Squeak",
        base: "acidhouse",
        bpm: [120, 124],
        swing: 0.5,
        microScale: 0.05,
        trim: 0.96,
        riser: 0,
        heat: 0.4,
        breakdown: { kick: 0.5, bass: 1, filter: 0.85, hat: 0.45 },
        data: {
          lines: [
            [
              { degree: 0, octave: 0, flags: 1 }, { degree: 0, octave: 0, flags: 0 }, { degree: 4, octave: 0, flags: 3 }, { degree: 0, octave: 0, flags: 0 },
              null, { degree: 0, octave: 0, flags: 4 }, { degree: 3, octave: 0, flags: 1 }, { degree: 0, octave: 0, flags: 2 },
              { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 1 }, { degree: 4, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 2 },
              { degree: 2, octave: 0, flags: 0 }, null, { degree: 0, octave: 0, flags: 1 }, { degree: 3, octave: 0, flags: 4 },
            ],
            [
              { degree: 0, octave: 0, flags: 1 }, { degree: 0, octave: 0, flags: 2 }, { degree: 0, octave: 1, flags: 0 }, null,
              { degree: 0, octave: 0, flags: 0 }, { degree: 3, octave: 0, flags: 2 }, { degree: 4, octave: 0, flags: 1 }, { degree: 0, octave: 0, flags: 0 },
              { degree: 0, octave: 0, flags: 1 }, { degree: 0, octave: 0, flags: 0 }, { degree: 2, octave: 0, flags: 2 }, { degree: 3, octave: 0, flags: 0 },
              null, { degree: 0, octave: 0, flags: 1 }, { degree: 4, octave: 0, flags: 4 }, { degree: 0, octave: 0, flags: 2 },
            ],
            [
              { degree: 0, octave: 0, flags: 1 }, null, { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 1, flags: 2 },
              { degree: 3, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, null, { degree: 0, octave: 0, flags: 1 },
              { degree: 0, octave: 0, flags: 0 }, { degree: 4, octave: 0, flags: 2 }, { degree: 3, octave: 0, flags: 2 }, { degree: 0, octave: 0, flags: 1 },
              { degree: 0, octave: 0, flags: 0 }, null, { degree: 1, octave: 0, flags: 4 }, { degree: 0, octave: 0, flags: 0 },
            ],
          ],
          voice: { wave: "saw", cutoff: 165, envMod: 1700, resonance: 3.25, decay: 0.2, drive: 2.2, level: 0.2, accent: 1.12, gate: 0.72, sweep: 32, sub: 0.6 },
          kit: {
            kick: { start: 160, end: 50, sweep: 0.026, decay: 0.26, click: 0.45, clickHp: 2600, drive: 2, body: 1.2 },
            hat: { hp: 7200, decay: 0.017, metal: 0.25, level: 0.32, off: 0.22 },
            open: { hp: 6200, decay: 0.12, metal: 0.25, level: 0.6 },
          },
          fx: {
            echo: { steps: 3, taps: 2, fb: 0.35, lp: 2400, hp: 500 },
            echoSend: { bass: 0.08, perc: 0.25 },
            space: { size: 0.6, fb: 0.55, lp: 5000 },
            spaceSend: { snare: 0.14, perc: 0.15, bass: 0.03 },
          },
        },
      },
      // Hardfloor: every 16th a note, low and rolling, few accents, slides in groups; a 32-bar knob sweep through a
      // squealing resonance, a dotted-8th echo on the 303, a tight punchy techno kick and a bright 16th hat.
      {
        id: "hamster-wheel",
        name: "Wheel Spin",
        base: "classic",
        bpm: [128, 133],
        swing: 0.5,
        microScale: 0.04,
        trim: 0.95,
        riser: 0,
        heat: 0.4,
        breakdown: { kick: 0.5, bass: 1, filter: 0.85, hat: 0.45 },
        data: {
          lines: [
            [
              { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, { degree: 4, octave: 0, flags: 2 },
              { degree: 0, octave: 1, flags: 1 }, { degree: 0, octave: 0, flags: 0 }, { degree: 1, octave: 0, flags: 0 }, { degree: 2, octave: 0, flags: 2 },
              { degree: 3, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 1, flags: 1 }, { degree: 0, octave: 0, flags: 0 },
              { degree: 0, octave: 0, flags: 2 }, { degree: 4, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 4 }, { degree: 3, octave: 0, flags: 4 },
            ],
            [
              { degree: 0, octave: 1, flags: 1 }, { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, { degree: 3, octave: 0, flags: 0 },
              { degree: 2, octave: 0, flags: 2 }, { degree: 3, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 1, flags: 1 },
              { degree: 0, octave: 0, flags: 0 }, { degree: 4, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 2 }, { degree: 0, octave: 0, flags: 0 },
              { degree: 0, octave: 0, flags: 0 }, { degree: 1, octave: 1, flags: 4 }, { degree: 0, octave: 0, flags: 0 }, { degree: 2, octave: 0, flags: 2 },
            ],
            [
              { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 2 }, { degree: 4, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 },
              { degree: 0, octave: 1, flags: 1 }, { degree: 0, octave: 0, flags: 0 }, { degree: 3, octave: 0, flags: 2 }, { degree: 4, octave: 0, flags: 0 },
              { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 1, flags: 1 }, { degree: 0, octave: 0, flags: 4 },
              { degree: 2, octave: 0, flags: 0 }, { degree: 0, octave: 0, flags: 2 }, { degree: 0, octave: 0, flags: 0 }, { degree: 3, octave: 0, flags: 4 },
            ],
          ],
          voice: { wave: "saw", cutoff: 70, envMod: 2000, resonance: 3.75, decay: 0.28, drive: 1.4, level: 0.25, accent: 1.22, gate: 0.52, sweep: 32, sub: 0.6 },
          kit: {
            kick: { start: 150, end: 48, sweep: 0.03, decay: 0.28, click: 0.4, clickHp: 3000, drive: 1.6, body: 1.15 },
            clap: [
              { noise: "bandpass", freq: 1500, q: 1, decay: 0.014, level: 0.6 },
              { noise: "bandpass", freq: 1500, q: 1, decay: 0.014, level: 0.6, at: 0.009 },
              { noise: "bandpass", freq: 1500, q: 1, decay: 0.15, level: 0.66, at: 0.018 },
              { noise: "highpass", freq: 4200, q: 0.6, decay: 0.08, level: 0.18, at: 0.012 },
            ],
            hat: { hp: 9000, decay: 0.02, metal: 0.5, q: 1, level: 0.42 },
            open: { hp: 7000, decay: 0.16, metal: 0.45, q: 0.9, level: 0.5 },
          },
          fx: {
            echo: { steps: 3, taps: 5, fb: 0.5, lp: 3000, hp: 500 },
            echoSend: { bass: 0.22, perc: 0.3, snare: 0.12 },
            space: { size: 1.2, fb: 0.7, lp: 5500 },
            spaceSend: { snare: 0.24, perc: 0.2, bass: 0.05 },
            duck: { bass: 0.55 },
            drive: 1.2,
          },
        },
      },
      // Slow rubber: the hollow square sliding low on long gates over syncopated onsets, a round driven kick on the
      // one (and the three when he runs), a soft snap with room, a dotted-quarter echo and a little dust.
      {
        id: "hamster-den",
        name: "Rubber Den",
        base: "rubber",
        bpm: [110, 115],
        swing: 0.57,
        microScale: 0.3,
        trim: 0.95,
        riser: 0,
        heat: 0.4,
        breakdown: { kick: 0.5, bass: 1, filter: 0.85, hat: 0.45 },
        data: {
          lines: [
            [
              { degree: 0, octave: 0, flags: 3, gate: 2.5 }, null, null, { degree: 2, octave: 1, flags: 0, gate: 1.5 },
              null, null, { degree: 0, octave: 1, flags: 2, gate: 2 }, null,
              { degree: 3, octave: 0, flags: 0, gate: 1.5 }, null, null, { degree: 0, octave: 0, flags: 2, gate: 2 },
              null, null, { degree: 4, octave: 0, flags: 4, gate: 0.8 }, null,
            ],
            [
              { degree: 0, octave: 0, flags: 1, gate: 2 }, null, { degree: 0, octave: 1, flags: 2, gate: 1 }, null,
              null, { degree: 3, octave: 1, flags: 0, gate: 2 }, null, null,
              { degree: 0, octave: 0, flags: 3, gate: 2.5 }, null, null, { degree: 2, octave: 0, flags: 0, gate: 1.5 },
              null, { degree: 4, octave: 0, flags: 6, gate: 1 }, null, { degree: 3, octave: 0, flags: 4, gate: 0.6 },
            ],
            [
              { degree: 0, octave: 0, flags: 2, gate: 2 }, null, null, { degree: 4, octave: 0, flags: 1, gate: 1 },
              null, null, null, { degree: 2, octave: 1, flags: 2, gate: 2 },
              null, null, { degree: 0, octave: 0, flags: 0, gate: 2.5 }, null,
              { degree: 1, octave: 1, flags: 4, gate: 1 }, null, { degree: 0, octave: 1, flags: 5, gate: 0.7 }, null,
            ],
          ],
          voice: { wave: "square", cutoff: 100, envMod: 1300, resonance: 3.4, decay: 0.3, drive: 1.2, level: 0.16, accent: 1.3, gate: 2.2, sweep: 12, sub: 0.45 },
          kit: {
            kick: { start: 92, end: 44, sweep: 0.08, decay: 0.4, click: 0.08, drive: 1.8, body: 1.05 },
            clap: [
              { noise: "bandpass", freq: 1100, q: 0.9, decay: 0.02, level: 0.55 },
              { noise: "bandpass", freq: 1100, q: 0.9, decay: 0.2, level: 0.6, at: 0.014 },
              { tone: "triangle", freq: 200, to: 165, sweep: 0.03, decay: 0.06, level: 0.18 },
            ],
            hat: { hp: 6200, decay: 0.026, metal: 0.4, level: 0.38 },
            open: { hp: 5600, decay: 0.14, metal: 0.4, level: 0.5 },
          },
          vinyl: 0.4,
          fx: {
            echo: { steps: 6, taps: 3, fb: 0.42, lp: 1800, hp: 400 },
            echoSend: { bass: 0.12, snare: 0.3, perc: 0.35 },
            space: { size: 1.6, fb: 0.72, lp: 3500 },
            spaceSend: { snare: 0.35, perc: 0.3, bass: 0.04, hat: 0.08 },
            master: { lp: 9500 },
          },
        },
      },
      // Bouncy: short plucked notes leaping octaves, accents on the offbeats, a shuffled groove, a rounder 808 and a
      // wooden seed knock in the perc row; less resonance, so it pops instead of squeals (a darker base and a longer
      // gate than at first, so the plucks carry the sub and do not read as a toy).
      {
        id: "hamster-hop",
        name: "Seed Hop",
        base: "classic",
        bpm: [122, 127],
        swing: 0.6,
        microScale: 0.2,
        trim: 1.2,
        riser: 0,
        heat: 0.4,
        breakdown: { kick: 0.5, bass: 1, filter: 0.85, hat: 0.45 },
        data: {
          lines: [
            [
              { degree: 0, octave: 0, flags: 0 }, null, { degree: 0, octave: 1, flags: 0 }, { degree: 0, octave: 0, flags: 0 },
              null, { degree: 0, octave: 1, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, { degree: 4, octave: 0, flags: 2 },
              { degree: 3, octave: 0, flags: 0 }, null, { degree: 0, octave: 1, flags: 0 }, { degree: 0, octave: 0, flags: 0 },
              { degree: 2, octave: 0, flags: 0 }, null, { degree: 4, octave: 0, flags: 5 }, { degree: 0, octave: 0, flags: 4 },
            ],
            [
              { degree: 0, octave: 1, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, null, { degree: 0, octave: 1, flags: 0 },
              { degree: 0, octave: 0, flags: 0 }, null, { degree: 3, octave: 0, flags: 1 }, { degree: 2, octave: 0, flags: 2 },
              { degree: 0, octave: 1, flags: 0 }, { degree: 0, octave: 0, flags: 0 }, null, { degree: 4, octave: 0, flags: 1 },
              { degree: 0, octave: 0, flags: 0 }, null, { degree: 2, octave: 0, flags: 4 }, { degree: 3, octave: 0, flags: 0 },
            ],
            [
              { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 1, flags: 0 }, null, { degree: 0, octave: 0, flags: 0 },
              { degree: 4, octave: 0, flags: 1 }, null, { degree: 0, octave: 0, flags: 0 }, { degree: 0, octave: 1, flags: 0 },
              null, { degree: 3, octave: 0, flags: 1 }, { degree: 0, octave: 0, flags: 2 }, { degree: 0, octave: 1, flags: 0 },
              null, { degree: 0, octave: 0, flags: 0 }, { degree: 1, octave: 0, flags: 5 }, { degree: 0, octave: 1, flags: 4 },
            ],
          ],
          voice: { wave: "saw", cutoff: 230, envMod: 1300, resonance: 3, decay: 0.12, drive: 1.9, level: 0.24, accent: 1.2, gate: 0.5, sweep: 24, sub: 0.6 },
          kit: {
            kick: { start: 120, end: 52, sweep: 0.05, decay: 0.3, click: 0.25, body: 1.05 },
            hat: { hp: 8500, decay: 0.03, metal: 0.3, level: 0.45 },
            open: { hp: 7000, decay: 0.09, metal: 0.3, level: 0.5 },
            perc: [
              { tone: "triangle", freq: 1250, to: 1100, sweep: 0.01, decay: 0.05, level: 0.5 },
              { noise: "bandpass", freq: 2500, q: 2, decay: 0.02, level: 0.2 },
            ],
          },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.4, lp: 2800, hp: 500 },
            echoSend: { bass: 0.08, perc: 0.35 },
            space: { size: 0.6, fb: 0.55, lp: 6000 },
            spaceSend: { snare: 0.16, perc: 0.22, bass: 0.03 },
            drumLp: 13000,
          },
        },
      },
    ],
  },
} satisfies StationPack;
