import type { StationPack } from "../pack.ts";

// Hamster Breaks: breakbeat on the electro renderers, for Squeekchain's running wheel. Never four-on-the-floor:
// every kick figure is a two-bar break (the kick on 1 and the "and" of 3, step 10, plus the pushes around it),
// the snare stays on 2 and 4 (the base's backbeat), the hats run busy 16ths, and a fat bass carries the hook.
// Nu-skool breaks / big beat: Stanton Warriors and Plump DJs (Wheelie), Prodigy rave breaks (Hoover Sprint),
// Chemical Brothers big beat (Seed Smash), Freq Nasty's dubby wobble (Cheek Pouch). The chain tempo lands at the top
// of each `bpm` range: about 132, 134, 128 and 130.
// No noise risers (riser 0: the owner hears them as air blowing through the second half).

export default {
  key: "hamster-breaks",
  name: "Hamster Breaks",
  genres: ["electro"],
  styles: {
    electro: [
      // Nu-skool breaks: a tight swung two-step break with ghost-snare funk and chopped 16th hats, a rubbery
      // octave-jumping bass riff with slides, a punchy short kick and a fat break snare; the computer voice squeaks.
      {
        id: "hamster-wheelie",
        name: "Wheelie",
        base: "client03",
        bpm: [127, 132],
        swing: 0.54,
        microScale: 0.18,
        trim: 0.64,
        riser: 0,
        data: {
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 10, 16, 26, 27], [0, 10, 16, 23, 26]],
            mid: [[0, 3, 10, 16, 26, 30], [0, 10, 11, 16, 22, 26], [0, 7, 10, 16, 26, 29]],
            hi: [[0, 3, 10, 11, 16, 19, 26, 27, 30], [0, 2, 10, 14, 16, 22, 26, 29]],
          },
          ghosts: [
            [
              { s: 7, vel: 0.36, core: true }, { s: 9, vel: 0.26, core: false }, { s: 14, vel: 0.4, core: true },
              { s: 15, vel: 0.28, core: false }, { s: 23, vel: 0.36, core: true }, { s: 25, vel: 0.28, core: false },
              { s: 30, vel: 0.4, core: true }, { s: 31, vel: 0.3, core: false },
            ],
            [
              { s: 2, vel: 0.28, core: false }, { s: 7, vel: 0.38, core: true }, { s: 13, vel: 0.3, core: false },
              { s: 15, vel: 0.36, core: true }, { s: 18, vel: 0.28, core: false }, { s: 23, vel: 0.38, core: true },
              { s: 25, vel: 0.3, core: false }, { s: 29, vel: 0.34, core: true },
            ],
          ],
          warps: [
            [1, 0.9, 1.06, 0.92, 1, 0.88, 1.1, 0.94, 1.02, 0.9, 1.08, 0.92, 1, 0.88, 1.12, 0.95],
          ],
          chops: [{ open: 14, steps: [7, 15] }, { open: 6, steps: [11, 15] }],
          riffs: [
            [
              { s: 0, semi: 0, len: 2, f: 1 }, { s: 3, semi: 12, len: 1, f: 0 }, { s: 5, semi: 0, len: 1, f: 8 },
              { s: 6, semi: 0, len: 2, f: 1 }, { s: 8, semi: 12, len: 1, f: 4 }, { s: 10, semi: 10, len: 2, f: 1 },
              { s: 13, semi: 12, len: 1, f: 2 }, { s: 14, semi: 7, len: 2, f: 0 },
              { s: 16, semi: 0, len: 2, f: 1 }, { s: 19, semi: 12, len: 1, f: 0 }, { s: 21, semi: 0, len: 1, f: 8 },
              { s: 22, semi: 0, len: 2, f: 1 }, { s: 24, semi: 15, len: 1, f: 4 }, { s: 26, semi: 12, len: 2, f: 3 },
              { s: 29, semi: 10, len: 1, f: 2 }, { s: 30, semi: 7, len: 2, f: 0 },
            ],
            [
              { s: 0, semi: 0, len: 3, f: 1 }, { s: 3, semi: 0, len: 1, f: 8 }, { s: 6, semi: 12, len: 1, f: 1 },
              { s: 7, semi: 10, len: 1, f: 2 }, { s: 10, semi: 0, len: 2, f: 1 }, { s: 12, semi: 7, len: 1, f: 4 },
              { s: 14, semi: 12, len: 2, f: 0 },
              { s: 16, semi: 0, len: 3, f: 1 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 22, semi: 12, len: 1, f: 1 },
              { s: 23, semi: 15, len: 1, f: 2 }, { s: 26, semi: 7, len: 2, f: 1 }, { s: 28, semi: 10, len: 1, f: 4 },
              { s: 30, semi: 12, len: 2, f: 2 },
            ],
          ],
          words: [
            { s: 10, syl: [[320, 2600, "s"], [300, 2800, "k"]] },
            { s: 6, syl: [[300, 2700, null], [350, 2400, "k"], [300, 2800, "t"]] },
          ],
          kit: {
            kick: { start: 150, end: 52, sweep: 0.036, decay: 0.34, click: 0.42, clickHp: 2800, drive: 1.5, body: 1.15 },
            snare: [
              { tone: "triangle", freq: 232, to: 180, sweep: 0.03, decay: 0.09, level: 0.55 },
              { noise: "bandpass", freq: 1800, color: 400, q: 0.7, decay: 0.19, level: 0.72 },
              { noise: "highpass", freq: 4600, q: 0.7, decay: 0.08, level: 0.32 },
              { clap: 0.32, at: 0.004 },
            ],
            ghost: [
              { noise: "bandpass", freq: 1900, color: 400, q: 0.8, decay: 0.05, level: 0.42, tail: true },
              { tone: "triangle", freq: 225, to: 180, sweep: 0.02, decay: 0.03, level: 0.18 },
            ],
            hat: { hp: 8200, decay: 0.026, metal: 0.3, q: 1 },
            open: { hp: 6000, decay: 0.15, metal: 0.25, q: 0.9, level: 0.5 },
            accents: [0.48, 0.32, 0.62, 0.36],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -8, level: 0.5 }, { type: "square", detune: 8, level: 0.36 }],
            cutoff: 210, color: 380, q: [4.2, 6], open: [5, 8], decay: [0.09, 0.15], drive: 2.6, level: [0.16, 0.2], sub: [1.25, 1.45], glide: 0.045,
          },
          pad: { level: 0.06, cutoff: 900 },
          voice: { pitch: 330, bits: 5, hp: 700, lp: 6500, level: 0.05 },
          fx: {
            echo: { steps: 3, taps: 4, fb: 0.45, lp: 4200, hp: 500 },
            echoSend: { perc: 0.3, lead: 0.5, snare: 0.06 },
            space: { size: 0.7, fb: 0.55, lp: 6500 },
            spaceSend: { snare: 0.14, perc: 0.16, lead: 0.3 },
            drumLp: 16000,
            drive: 1.15,
            duck: { bass: 0.45, harm: 0.8 },
          },
          mix: { kick: 1, snare: 2.5, hat: 0, bass: -1 },
        },
      },
      // Prodigy rave breaks: a straight, hard 16th break with a crushed sampled snare, open hats on the "ands",
      // hoover chord stabs and a snarling FM 16th bass rolling in octaves; the robot call squeals.
      {
        id: "hamster-hoover",
        name: "Hoover Sprint",
        base: "alienrave",
        bpm: [129, 134],
        swing: 0.51,
        microScale: 0.05,
        trim: 0.74,
        riser: 0,
        data: {
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 10, 16, 22, 26], [0, 7, 10, 16, 26]],
            mid: [[0, 3, 10, 16, 19, 26], [0, 10, 11, 16, 26, 30]],
            hi: [[0, 3, 10, 11, 16, 19, 22, 26, 27], [0, 2, 7, 10, 16, 18, 23, 26, 30]],
          },
          progressions: [[0, 0, 3, 2], [0, 3, 0, 1], [0, 2, 3, 3]],
          opens: [[6, 14], [2, 10], [10, 14]],
          lines: [
            [[0, 1], null, [12, 0], [0, 0], [0, 4], [0, 0], [12, 1], null, [0, 1], [0, 0], [10, 0], [12, 2], [15, 0], [12, 0], [0, 1], [7, 4]],
            [[0, 1], [0, 0], [12, 0], null, [0, 1], [12, 0], [10, 0], [0, 4], [0, 1], [12, 0], [0, 0], [7, 2], [10, 0], [12, 1], [0, 0], [12, 4]],
          ],
          stabs: [
            [{ s: 0, len: 3, core: true }, { s: 6, len: 2, core: true }, { s: 10, len: 1, core: false }, { s: 16, len: 3, core: true }, { s: 22, len: 1, core: false }, { s: 24, len: 6, core: true }],
            [{ s: 3, len: 2, core: true }, { s: 10, len: 3, core: true }, { s: 19, len: 2, core: true }, { s: 23, len: 1, core: false }, { s: 26, len: 4, core: true }],
          ],
          arpCells: [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 4, 6, 4, 2]],
          calls: [{ s: 10, len: 4, vowels: [[350, 2400], [700, 1200]] }],
          kit: {
            kick: { start: 165, end: 50, sweep: 0.032, decay: 0.32, click: 0.5, clickHp: 2600, drive: 2, body: 1.12 },
            snare: [
              { tone: "triangle", freq: 205, to: 165, sweep: 0.03, decay: 0.08, level: 0.5 },
              { crush: 5, filter: "bandpass", freq: 2100, q: 0.7, decay: 0.2, level: 0.55, lp: 9000 },
              { noise: "highpass", freq: 3200, q: 0.7, decay: 0.13, level: 0.38 },
              { clap: 0.22, at: 0.005 },
            ],
            hat: { hp: 9000, decay: 0.022, metal: 0.5, q: 1.2 },
            open: { hp: 6400, decay: 0.16, metal: 0.4, q: 0.8, level: 0.5 },
            accents: [0.42, 0.3, 0.58, 0.32],
          },
          bassTone: { cutoff: 190, color: 460, q: [6, 8], open: [4, 7], decay: [0.07, 0.12], drive: 2.3, level: [0.15, 0.19], sub: [1.3, 1.5], fm: [1.5, 2.4] },
          hoover: { cutoff: 1100, color: 2400, q: 2.6, hp: 200, bend: 3, detune: [-22, 0, 21], level: 0.2 },
          vox: { ring: 2, level: 0.6 },
          // No lasers, a dark low arp: the glitch row's laser and the bright arp read as mouse squeaks on small speakers.
          laser: { level: 0 },
          arp: { open: 1.8, color: 1, cap: 2800, q: 2, level: 0.14 },
          fx: {
            echoSend: { lead: 0.5, perc: 0.3, snare: 0.08, harm: 0.12 },
            spaceSend: { harm: 0.2, snare: 0.16, lead: 0.3 },
            drive: 1.15,
          },
          mix: { harm: 3, snare: 1.5, bass: -1 },
        },
      },
      // Chemical Brothers big beat: slower and heavier, a lazy swung break with a fat boomy kick and a big crushed
      // roomy snare, an acid-squelch bass riff, everything through a sampler's grit (crushed master, darker top).
      {
        id: "hamster-bigbeat",
        name: "Seed Smash",
        base: "client03",
        bpm: [124, 128],
        swing: 0.56,
        microScale: 0.35,
        trim: 0.629,
        riser: 0,
        data: {
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 10, 16, 26], [0, 7, 10, 16, 26]],
            mid: [[0, 10, 11, 16, 23, 26], [0, 3, 10, 16, 26]],
            hi: [[0, 3, 10, 11, 16, 19, 23, 26], [0, 7, 10, 16, 18, 26, 27]],
          },
          ghosts: [
            [{ s: 7, vel: 0.3, core: true }, { s: 15, vel: 0.32, core: false }, { s: 23, vel: 0.3, core: true }, { s: 30, vel: 0.34, core: true }],
            [{ s: 9, vel: 0.3, core: true }, { s: 14, vel: 0.28, core: false }, { s: 25, vel: 0.32, core: true }, { s: 31, vel: 0.3, core: false }],
          ],
          warps: [[1, 0.85, 1.05, 0.88, 1, 0.82, 1.1, 0.9, 1, 0.85, 1.06, 0.88, 1, 0.8, 1.12, 0.9]],
          chops: [{ open: 14, steps: [15] }, { open: 10, steps: [7] }],
          riffs: [
            [
              { s: 0, semi: 0, len: 3, f: 1 }, { s: 4, semi: 0, len: 1, f: 8 }, { s: 6, semi: 12, len: 1, f: 1 },
              { s: 7, semi: 10, len: 2, f: 2 }, { s: 10, semi: 0, len: 2, f: 1 }, { s: 13, semi: 15, len: 1, f: 4 },
              { s: 14, semi: 12, len: 2, f: 2 },
              { s: 16, semi: 0, len: 3, f: 1 }, { s: 20, semi: 0, len: 1, f: 8 }, { s: 22, semi: 7, len: 2, f: 1 },
              { s: 25, semi: 10, len: 1, f: 2 }, { s: 26, semi: 12, len: 2, f: 1 }, { s: 29, semi: 7, len: 1, f: 4 },
              { s: 30, semi: 0, len: 2, f: 0 },
            ],
          ],
          words: [{ s: 10, syl: [[300, 2700, "k"], [320, 2500, null]] }],
          kit: {
            kick: { start: 125, end: 46, sweep: 0.055, decay: 0.48, click: 0.32, clickHp: 2200, drive: 2.4, body: 1.2 },
            snare: [
              { tone: "triangle", freq: 192, to: 150, sweep: 0.04, decay: 0.12, level: 0.58 },
              { crush: 6, filter: "bandpass", freq: 1500, q: 0.6, decay: 0.26, level: 0.6, lp: 7000 },
              { noise: "bandpass", freq: 900, q: 0.6, decay: 0.24, level: 0.28 },
              { clap: 0.4, at: 0.006 },
            ],
            ghost: [
              { crush: 6, filter: "bandpass", freq: 1700, q: 0.8, decay: 0.06, level: 0.4, lp: 7000 },
              { tone: "triangle", freq: 200, to: 160, sweep: 0.02, decay: 0.03, level: 0.16 },
            ],
            hat: { hp: 6200, decay: 0.032, metal: 0.2, q: 0.9 },
            open: { hp: 5000, decay: 0.2, metal: 0.2, q: 0.8, level: 0.45, crush: 6 },
            accents: [0.5, 0.3, 0.6, 0.34],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -5, level: 0.55 }, { type: "sawtooth", detune: 6, level: 0.3 }],
            cutoff: 170, color: 520, q: [8, 10.5], open: [6, 9], decay: [0.12, 0.2], drive: 3, level: [0.15, 0.18], sub: [1.2, 1.4], glide: 0.06,
          },
          pad: { osc: [{ type: "sawtooth", detune: -10, level: 0.5 }, { type: "sawtooth", detune: 9, level: 0.5 }], cutoff: 1100, level: 0.05 },
          voice: { pitch: 280, bits: 4, hp: 600, lp: 5000, level: 0.045 },
          vinyl: 0.5,
          fx: {
            echoSend: { perc: 0.25, lead: 0.4, snare: 0.04 },
            space: { size: 1.4, fb: 0.62, lp: 5000 },
            spaceSend: { snare: 0.3, perc: 0.2, lead: 0.3, hat: 0.06 },
            drumLp: 12000,
            drive: 1.3,
            duck: { bass: 0.4, harm: 0.7 },
            master: { lp: 12000, crush: 10 },
          },
          mix: { snare: 2.5, bass: -1 },
        },
      },
      // Freq Nasty's dubby breaks: a rolling kick that pushes the "and" of 2, a wobbling detuned reese-ish bass
      // with long slides, dark hoover scoops a few times a phrase, the snare thrown into a dub echo.
      {
        id: "hamster-nasty",
        name: "Cheek Pouch",
        base: "alienrave",
        bpm: [125, 130],
        swing: 0.545,
        microScale: 0.2,
        trim: 0.724,
        riser: 0,
        data: {
          kicks: {
            half: [[0, 6, 16, 26]],
            lo: [[0, 6, 10, 16, 26], [0, 6, 16, 22, 26]],
            mid: [[0, 6, 10, 16, 22, 26, 29], [0, 3, 6, 16, 23, 26]],
            hi: [[0, 3, 6, 10, 16, 19, 22, 26, 30], [0, 6, 7, 10, 16, 22, 23, 26, 29]],
          },
          progressions: [[0, 0, 5, 3], [0, 0, 2, 2]],
          opens: [[14], [6], [10]],
          lines: [
            [[0, 1], null, null, [0, 2], [12, 0], null, [0, 1], null, null, [10, 2], [12, 0], null, [0, 1], null, [7, 2], [10, 4]],
            [[0, 3], [0, 0], null, null, [12, 1], null, [10, 2], [7, 0], null, null, [0, 1], null, [15, 2], [12, 0], null, [0, 4]],
          ],
          stabs: [
            [{ s: 10, len: 4, core: true }, { s: 26, len: 6, core: true }],
            [{ s: 3, len: 3, core: true }, { s: 22, len: 2, core: false }, { s: 27, len: 5, core: true }],
          ],
          arpCells: [[0, 2, 1, 3]],
          kit: {
            kick: { start: 140, end: 48, sweep: 0.045, decay: 0.42, click: 0.36, clickHp: 2400, drive: 1.8, body: 1.15 },
            snare: [
              { tone: "triangle", freq: 210, to: 170, sweep: 0.03, decay: 0.1, level: 0.5 },
              { noise: "bandpass", freq: 2200, q: 0.8, decay: 0.2, level: 0.62 },
              { noise: "highpass", freq: 5200, q: 0.7, decay: 0.06, level: 0.25 },
            ],
            hat: { hp: 8600, decay: 0.03, metal: 0.25, q: 1 },
            open: { hp: 5600, decay: 0.24, metal: 0.25, q: 0.8, level: 0.42 },
            accents: [0.46, 0.34, 0.6, 0.38],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -22, level: 0.42 }, { type: "sawtooth", detune: 24, level: 0.42 }, { type: "square", detune: 0, level: 0.2 }],
            cutoff: 150, color: 300, q: [4, 6], open: [2.6, 4.2], decay: [0.18, 0.28], drive: 2.2, level: [0.16, 0.19], sub: [1.35, 1.5], glide: 0.09, fm: [0.5, 0.9],
          },
          hoover: { cutoff: 650, color: 1400, q: 3.6, hp: 160, bend: 7, detune: [-30, 0, 28], level: 0.18 },
          vox: { ring: 0.5, level: 0.5 },
          laser: { level: 0 },
          arp: { open: 1.6, color: 0.8, cap: 2200, q: 1.5, level: 0.12 },
          fx: {
            echo: { steps: 3, taps: 6, fb: 0.55, lp: 2800, hp: 450 },
            echoSend: { snare: 0.28, lead: 0.5, perc: 0.35, harm: 0.25 },
            space: { size: 1.2, fb: 0.6, lp: 4500 },
            spaceSend: { snare: 0.2, harm: 0.3, lead: 0.3 },
            drive: 1.12,
            duck: { bass: 0.35, harm: 0.75 },
            duckTime: { bass: 0.2 },
          },
          mix: { harm: 2, snare: 1 },
        },
      },
    ],
  },
} satisfies StationPack;
