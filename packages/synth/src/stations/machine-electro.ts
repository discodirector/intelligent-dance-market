import type { StationPack } from "../pack.ts";

// Futuristic Machine Electro: finished electro tracks as a system of interacting machines (groove, bass, sequence,
// space, evolution, each with its own job, few at once), from three axes: Anthony Rother (cold machine funk, hard
// repetitive bass, the vocoder), Plant43 (emotive sci-fi electro, melancholic sequences, space, slow evolution) and
// Client_03 (bass-heavy broken beat, rolling interlocking percussion, loose-and-robotic timing). Four styles sit at
// four points of that triangle, all dark and futuristic: Control Program (Rother), Memory Drift (Plant43), Orbit Roller
// (Client_03) and Machine System (the 0.4 / 0.3 / 0.3 mix). Minor keys with the Phrygian b2, the tritone and the odd
// cluster; kicks on the brief's four archetypes, the snare on 2 and 4; polymeter in the sequences and the metal (5-,
// 7-, 12-step cycles over 16-step drums: `seq`, `metal`), microtiming per voice (`jitter`: the kick and the snare
// stay on the grid). Three more continue Machine System (the one the owner kept) and take it darker: Iron March (a
// heavy march), Black Circuit (a relentless tritone system) and Cold Engine (a driving FM bass and interlocking
// metal): lower, heavier bass, Phrygian b2 / tritone / clusters in the low register, darker filters and rooms,
// colder vocoder phrases. Baked, on no station yet. The chain tempo lands at the top of each `bpm` range: about 132,
// 130, 134, 132, then 128, 132 and 134. No noise risers (riser 0: the owner hears them as air blowing through the
// second half).
export default {
  key: "machine-electro",
  name: "Futuristic Machine Electro",
  genres: ["electro"],
  styles: {
    electro: [
      // Rother: cold dystopian machine funk, straight and machine-tight (0-2 ms). A hard short kick on the A / D / B
      // archetypes, a body-noise-metal snare in a small gated room, a locked 16th hat pushing the e and the a; a
      // machine-pulse bass (narrow pulse, a hollow 1:1 FM) on a strict 16-step line from a root-octave-m3-5-m7 core,
      // a four-note machine arp (root, m3, root, fifth), sparse cold stabs, a metallic answer on the off-16ths, and
      // the vocoder reading out "SYSTEM RECEIVES HUMAN SIGNAL" / "CONTROL IDENTITY" every eight bars.
      {
        id: "mach-control",
        name: "Control Program",
        base: "alienrave",
        bpm: [127, 132],
        swing: 0.5,
        microScale: 0.03,
        trim: 0.75,
        riser: 0,
        data: {
          chords: [
            { bass: 0, tones: [0, 3, 7, 12] },
            { bass: 0, tones: [0, 3, 7, 10] },
            { bass: 1, tones: [1, 7, 13] },
            { bass: -4, tones: [-4, 3, 8] },
            { bass: -2, tones: [-2, 5, 10] },
            { bass: 0, tones: [0, 5, 10, 15] },
          ],
          progressions: [[0, 0, 0, 2], [0, 1, 0, 5], [0, 0, 3, 2], [1, 0, 4, 0]],
          kicks: {
            half: [[0, 8, 16, 24]],
            lo: [[0, 6, 8, 13, 16, 22, 24, 29]],
            mid: [[0, 6, 8, 13, 16, 24, 27, 30], [0, 5, 10, 12, 16, 22, 24, 29]],
            hi: [[0, 3, 8, 10, 14, 16, 22, 24, 29, 30], [0, 6, 8, 13, 16, 19, 24, 26, 30]],
          },
          opens: [[14], [6, 14]],
          lines: [
            [[0, 1], null, null, [12, 0], null, [3, 1], null, [0, 4], null, [7, 0], null, null, [10, 1], null, [0, 0], [12, 4]],
            [[0, 1], null, [0, 0], null, null, [12, 1], null, [3, 2], [0, 0], null, [7, 1], null, null, [10, 0], [11, 4], [12, 0]],
            [[0, 1], null, null, [12, 0], null, [0, 4]],
          ],
          stabs: [
            [{ s: 6, len: 1, core: true }, { s: 14, len: 0.5, core: false }, { s: 22, len: 1, core: true }],
            [{ s: 3, len: 1, core: true }, { s: 19, len: 1, core: true }, { s: 27, len: 0.5, core: false }],
          ],
          arpCells: [[0, 1, 0, 2], [0, 1, 0, 2, 0, 3]],
          calls: [
            { s: 8, len: 6, vowels: [[300, 870], [530, 1840]] },
            { s: 10, len: 4, vowels: [[570, 840], [390, 1990]] },
          ],
          words: [
            // SYS-TEM RE-CEIVES HU-MAN SIG-NAL
            { s: 2, syl: [[390, 1990, "s"], [530, 1840, "t"], [390, 1990, null], [270, 2290, "s"], [300, 870, null], [640, 1190, null], [390, 1990, "s"], [640, 1190, null]] },
            // CON-TROL I-DEN-TI-TY
            { s: 2, syl: [[570, 840, "k"], [450, 800, "t"], [730, 1090, null], [530, 1840, "t"], [390, 1990, "t"], [270, 2290, "t"]] },
          ],
          metal: { steps: [0, 0, 0.7, 0, 0, 0, 0, 0.5, 0, 0.6, 0, 0, 0.8, 0, 0, 0], freq: 2400, ratio: 1.41, index: 2.5, decay: 0.04, level: 0.08, pan: 0.45 },
          kit: {
            kick: { start: 160, end: 48, sweep: 0.03, decay: 0.3, click: 0.5, clickHp: 3000, drive: 2.4, body: 1.1 },
            snare: [
              { tone: "triangle", freq: 205, to: 172, sweep: 0.025, decay: 0.06, level: 0.5 },
              { noise: "bandpass", freq: 1700, q: 1, decay: 0.12, level: 0.55 },
              { noise: "highpass", freq: 6000, q: 0.9, decay: 0.02, level: 0.2 },
              { clap: 0.25, at: 0.003 },
            ],
            hat: { hp: 9000, decay: 0.01, metal: 0.7, q: 1.5 },
            open: { hp: 7000, decay: 0.07, metal: 0.7, q: 1.3, level: 0.3 },
            accents: [0.21, 0.36, 0.25, 0.45],
          },
          bassTone: {
            osc: [{ type: "pulse25", detune: -5, level: 0.45 }, { type: "square", detune: 6, level: 0.3 }],
            cutoff: 160, color: 260, q: [5, 7], open: [3, 5], decay: [0.05, 0.08], drive: 2.6, level: [0.16, 0.2], sub: [1.3, 1.5], glide: 0.03, fm: [0.4, 0.9], ratio: 1,
          },
          hoover: { cutoff: 380, color: 500, q: 2, hp: 200, bend: 0, detune: [-6, 6], level: 0.12 },
          vox: { ring: 0.5, level: 0.45 },
          ornament: { vowels: [[530, 1840], [640, 1190]], wave: "square", steps: 4, octave: -12, ring: 0.5, lowpass: 2200, echo: null, level: 0.06 },
          fx: {
            echo: { steps: 3, taps: 3, fb: 0.35, lp: 2600, hp: 500 },
            echoSend: { lead: 0.25, perc: 0.25, snare: 0 },
            space: { size: 0.6, fb: 0.4, lp: 4000 },
            spaceSend: { snare: 0.15, perc: 0.12, lead: 0.2, harm: 0.12 },
            drumLp: 12000,
            drive: 1.25,
            master: { lp: 10500 },
          },
          mix: { hat: -2, lead: -3, perc: -3, fx: -4 },
        },
      },
      // Plant43: emotive electro, human on hardware (hats and ghosts 1-6 ms loose). An off-kilter kick (A then B, A
      // then D), ghost snares between the beats; an elastic saw-and-pulse bass with slow slides, melodic over four
      // tonal centres (i add9, bVI maj7, bVII sus2, v m7, iv m9, i with a b5-b2 cluster), a slow sci-fi pad breathing
      // under it, and a seven-step emotional sequence in 8ths (14 16ths against 16) that rotates every eight bars;
      // a light 7-step metal, a soft computer voice ("MEMORY", "HUMAN"), all into a dark echo and a wide room.
      {
        id: "mach-memory",
        name: "Memory Drift",
        base: "client03",
        bpm: [125, 130],
        swing: 0.53,
        microScale: 0.15,
        trim: 0.735,
        riser: 0,
        leads: ["mach-memory-lead"],
        data: {
          chords: [
            { bass: 0, third: 3, seventh: 10, tones: [0, 7, 14, 15] },
            { bass: -4, third: 4, seventh: 11, tones: [-4, 3, 7, 12] },
            { bass: -2, third: 4, seventh: 10, tones: [-2, 0, 5, 12] },
            { bass: -5, third: 3, seventh: 10, tones: [7, 10, 14, 17] },
            { bass: 5, third: 3, seventh: 10, tones: [5, 8, 15, 19] },
            { bass: 0, third: 3, seventh: 10, tones: [0, 7, 13, 15] },
          ],
          progressions: [[0, 1, 2, 3], [0, 4, 1, 2], [0, 1, 0, 5], [0, 3, 4, 1]],
          kicks: {
            half: [[0, 16, 26]],
            lo: [[0, 6, 8, 16, 21, 26], [0, 10, 16, 22, 26]],
            mid: [[0, 6, 8, 13, 16, 21, 26, 28], [0, 6, 8, 13, 16, 24, 27, 30]],
            hi: [[0, 3, 8, 10, 14, 16, 22, 24, 29], [0, 6, 8, 11, 13, 16, 21, 26, 28, 30]],
          },
          ghosts: [
            [{ s: 3, vel: 0.24, core: true }, { s: 9, vel: 0.3, core: false }, { s: 14, vel: 0.22, core: true }, { s: 19, vel: 0.2, core: false }, { s: 23, vel: 0.3, core: true }, { s: 30, vel: 0.26, core: false }],
            [{ s: 2, vel: 0.2, core: false }, { s: 7, vel: 0.28, core: true }, { s: 11, vel: 0.22, core: false }, { s: 18, vel: 0.24, core: true }, { s: 25, vel: 0.3, core: true }, { s: 29, vel: 0.2, core: false }],
          ],
          warps: [[1, 0.94, 1.06, 0.92, 1, 0.95, 1.08, 0.9, 1, 0.94, 1.05, 0.92, 1, 0.9, 1.1, 0.94]],
          chops: [{ open: 14, steps: [] }, { open: 10, steps: [15] }],
          riffs: [
            [
              { s: 0, semi: 0, len: 2, f: 1 }, { s: 3, semi: 12, len: 1, f: 0 }, { s: 6, semi: 0, len: 1, f: 8 }, { s: 7, semi: 7, len: 2, f: 0 },
              { s: 10, semi: 10, len: 1, f: 2 }, { s: 11, semi: 12, len: 2, f: 1 }, { s: 14, semi: 3, len: 1, f: 4 },
              { s: 16, semi: 0, len: 3, f: 1 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 22, semi: 12, len: 1, f: 1 }, { s: 23, semi: 10, len: 1, f: 2 },
              { s: 25, semi: 7, len: 2, f: 0 }, { s: 28, semi: 3, len: 1, f: 4 }, { s: 30, semi: -1, len: 1, f: 4 },
            ],
            [
              { s: 0, semi: 0, len: 3, f: 1 }, { s: 4, semi: 12, len: 1, f: 2 }, { s: 6, semi: 7, len: 1, f: 0 }, { s: 9, semi: 0, len: 1, f: 8 },
              { s: 10, semi: 10, len: 2, f: 1 }, { s: 13, semi: 12, len: 1, f: 4 }, { s: 14, semi: 15, len: 2, f: 2 },
              { s: 16, semi: 0, len: 2, f: 1 }, { s: 18, semi: 0, len: 1, f: 8 }, { s: 20, semi: 7, len: 2, f: 0 }, { s: 23, semi: 12, len: 1, f: 1 },
              { s: 26, semi: 10, len: 1, f: 2 }, { s: 27, semi: 7, len: 2, f: 0 }, { s: 30, semi: 5, len: 1, f: 4 },
            ],
            [
              { s: 0, semi: 0, len: 6, f: 1 }, { s: 8, semi: 12, len: 2, f: 2 }, { s: 11, semi: 7, len: 3, f: 0 },
              { s: 16, semi: 0, len: 4, f: 1 }, { s: 22, semi: 10, len: 2, f: 2 }, { s: 26, semi: 12, len: 4, f: 1 },
            ],
          ],
          words: [
            // ME-MO-RY
            { s: 6, syl: [[530, 1840, null], [490, 1350, null], [270, 2290, null]] },
            // HU-MAN
            { s: 10, syl: [[300, 870, null], [640, 1190, null]] },
          ],
          seq: { notes: [3, 10, 15, 14, null, 7, 12], rate: 2, octave: -12, gate: 1.7, level: 0.42, accent: 0.3, evolve: 8 },
          metal: { steps: [0, 0.5, 0, 0, 0.7, 0, 0.35], freq: 3100, ratio: 2.76, index: 2, decay: 0.05, level: 0.06, pan: 0.6, jitter: 5 },
          jitter: { hat: 6, ghost: 5 },
          kit: {
            kick: { start: 140, end: 45, sweep: 0.05, decay: 0.48, click: 0.2, clickHp: 2200, drive: 1.5, body: 1.12 },
            snare: [
              { tone: "triangle", freq: 196, to: 160, sweep: 0.03, decay: 0.09, level: 0.5 },
              { noise: "bandpass", freq: 1300, q: 0.9, decay: 0.2, level: 0.5 },
              { noise: "highpass", freq: 5200, q: 0.8, decay: 0.025, level: 0.14 },
              { clap: 0.18, at: 0.005 },
            ],
            ghost: [
              { noise: "bandpass", freq: 1500, q: 1.1, decay: 0.045, level: 0.36, tail: true },
              { tone: "triangle", freq: 330, to: 290, sweep: 0.02, decay: 0.03, level: 0.16 },
            ],
            hat: { hp: 7600, decay: 0.018, metal: 0.4, q: 1 },
            open: { hp: 5600, decay: 0.1, metal: 0.3, q: 0.9, level: 0.38 },
            accents: [0.3, 0.2, 0.42, 0.24],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -8, level: 0.45 }, { type: "pulse25", detune: 7, level: 0.3 }],
            cutoff: 140, color: 200, q: [4, 6], open: [4, 6.5], decay: [0.14, 0.22], drive: 1.8, level: [0.155, 0.185], sub: [1.3, 1.45], glide: 0.08,
          },
          pad: {
            osc: [{ type: "sawtooth", detune: -12, level: 0.28 }, { type: "triangle", detune: 10, level: 0.5 }],
            cutoff: 640, q: 1.6, attack: 2.5, release: 3, level: 0.14,
          },
          voice: { pitch: 100, bits: 5, hp: 300, lp: 3000, level: 0.05 },
          ornament: { vowels: [[530, 1840], [490, 1350], [270, 2290]], wave: "triangle", steps: 6, octave: 0, syllable: 2, ring: 0, lowpass: 2400, echo: { steps: 3, feedback: 0.45 }, level: 0.05 },
          fx: {
            echo: { steps: 3, taps: 6, fb: 0.5, lp: 2200, hp: 400 },
            echoSend: { lead: 0.5, perc: 0.35, snare: 0.08 },
            space: { size: 1.8, fb: 0.7, lp: 3600 },
            spaceSend: { harm: 0.4, lead: 0.4, snare: 0.18, perc: 0.25 },
            drumLp: 11000,
            drive: 1.1,
            master: { lp: 9500 },
          },
          mix: { hat: -2, harm: 1, perc: -2, fx: -4 },
        },
      },
      // Client_03: bass-heavy broken-beat electro, loose and robotic at once. A broken kick with jungle doubles, the
      // snare on 2 and 4 with a metal transient, a dense rolling ghost figure and chopped, warped break hats rolling
      // 9-11 ms loose around a tight kick and snare; a driven saw-square bass with a deep sub on a rolling 7-9-note
      // two-bar riff (octaves, dead notes, a b9 and tritone pass), a five-step digital blip on the chord in 16ths
      // (5 against 16), a 5-step metal ping 12 ms loose, and a crushed voice: "NETWORK", "SIGNAL".
      {
        id: "mach-roller",
        name: "Orbit Roller",
        base: "client03",
        bpm: [129, 134],
        swing: 0.54,
        microScale: 0.25,
        trim: 0.635,
        riser: 0,
        leads: ["mach-digital"],
        data: {
          chords: [
            { bass: 0, third: 3, seventh: 10, tones: [0, 7, 15] },
            { bass: 1, third: 4, seventh: 11, tones: [1, 8, 13] },
            { bass: -4, third: 4, seventh: 11, tones: [0, 8, 15] },
            { bass: 5, third: 3, seventh: 10, tones: [0, 8, 17] },
            { bass: -2, third: 4, seventh: 10, tones: [2, 10, 17] },
            { bass: 0, third: 3, seventh: 10, tones: [0, 6, 15] },
          ],
          progressions: [[0, 0, 1, 0], [0, 2, 0, 5], [0, 3, 0, 1], [0, 0, 5, 2]],
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 10, 16, 22, 26], [0, 7, 10, 16, 26, 29]],
            mid: [[0, 3, 10, 16, 22, 26, 27], [0, 6, 10, 11, 16, 19, 26]],
            hi: [[0, 2, 10, 11, 16, 19, 22, 26, 30], [0, 3, 7, 10, 16, 18, 26, 27, 30]],
          },
          ghosts: [
            [
              { s: 3, vel: 0.3, core: true }, { s: 6, vel: 0.22, core: false }, { s: 9, vel: 0.32, core: true }, { s: 11, vel: 0.2, core: false },
              { s: 14, vel: 0.28, core: true }, { s: 15, vel: 0.2, core: false }, { s: 19, vel: 0.3, core: true }, { s: 22, vel: 0.24, core: false },
              { s: 25, vel: 0.32, core: true }, { s: 27, vel: 0.22, core: false }, { s: 30, vel: 0.3, core: true }, { s: 31, vel: 0.24, core: false },
            ],
            [
              { s: 2, vel: 0.26, core: true }, { s: 7, vel: 0.32, core: true }, { s: 9, vel: 0.2, core: false }, { s: 10, vel: 0.26, core: false },
              { s: 15, vel: 0.3, core: true }, { s: 18, vel: 0.24, core: false }, { s: 21, vel: 0.3, core: true }, { s: 23, vel: 0.22, core: false },
              { s: 26, vel: 0.24, core: false }, { s: 29, vel: 0.32, core: true }, { s: 31, vel: 0.26, core: false },
            ],
          ],
          warps: [
            [1, 0.84, 1.15, 0.9, 1, 0.8, 1.22, 0.9, 1.05, 0.85, 1.18, 0.88, 1, 0.8, 1.25, 0.94],
            [1.08, 0.88, 1, 0.82, 1.16, 0.9, 0.78, 1, 1.08, 0.9, 1.02, 0.8, 1.14, 0.88, 0.76, 1.04],
          ],
          chops: [{ open: 14, steps: [7, 11, 15] }, { open: 6, steps: [3, 13, 15] }],
          riffs: [
            [
              { s: 0, semi: 0, len: 2, f: 1 }, { s: 2, semi: 0, len: 1, f: 8 }, { s: 3, semi: 12, len: 1, f: 0 }, { s: 5, semi: 0, len: 1, f: 8 },
              { s: 6, semi: 7, len: 2, f: 1 }, { s: 9, semi: 12, len: 1, f: 0 }, { s: 10, semi: 10, len: 1, f: 2 }, { s: 12, semi: 0, len: 1, f: 8 },
              { s: 13, semi: 0, len: 2, f: 1 }, { s: 15, semi: 13, len: 1, f: 4 },
              { s: 16, semi: 0, len: 2, f: 1 }, { s: 18, semi: 12, len: 1, f: 0 }, { s: 19, semi: 0, len: 1, f: 8 }, { s: 22, semi: 3, len: 2, f: 1 },
              { s: 24, semi: 0, len: 1, f: 8 }, { s: 25, semi: 12, len: 1, f: 2 }, { s: 26, semi: 10, len: 2, f: 0 }, { s: 29, semi: 7, len: 1, f: 4 },
              { s: 30, semi: 0, len: 2, f: 1 },
            ],
            [
              { s: 0, semi: 0, len: 3, f: 1 }, { s: 3, semi: 0, len: 1, f: 8 }, { s: 4, semi: 12, len: 1, f: 2 }, { s: 6, semi: 0, len: 1, f: 1 },
              { s: 8, semi: 0, len: 1, f: 8 }, { s: 10, semi: 7, len: 1, f: 0 }, { s: 11, semi: 10, len: 2, f: 2 }, { s: 14, semi: 12, len: 1, f: 1 },
              { s: 15, semi: 0, len: 1, f: 8 },
              { s: 16, semi: 0, len: 2, f: 1 }, { s: 19, semi: 12, len: 1, f: 0 }, { s: 20, semi: 0, len: 1, f: 8 }, { s: 22, semi: 6, len: 1, f: 4 },
              { s: 23, semi: 7, len: 2, f: 1 }, { s: 26, semi: 0, len: 1, f: 8 }, { s: 27, semi: 10, len: 1, f: 2 }, { s: 28, semi: 12, len: 2, f: 1 },
              { s: 31, semi: 0, len: 1, f: 4 },
            ],
            [
              { s: 0, semi: 0, len: 4, f: 1 }, { s: 6, semi: 12, len: 1, f: 2 }, { s: 7, semi: 10, len: 1, f: 0 }, { s: 10, semi: 0, len: 2, f: 1 },
              { s: 14, semi: 7, len: 2, f: 0 }, { s: 16, semi: 0, len: 3, f: 1 }, { s: 20, semi: 0, len: 1, f: 8 }, { s: 22, semi: 12, len: 2, f: 1 },
              { s: 26, semi: 10, len: 1, f: 2 }, { s: 27, semi: 7, len: 3, f: 0 },
            ],
          ],
          words: [
            // NET-WORK
            { s: 10, syl: [[530, 1840, "t"], [490, 1350, "k"]] },
            // SIG-NAL
            { s: 2, syl: [[390, 1990, "s"], [640, 1190, null]] },
          ],
          seq: { notes: [0, null, 12, 13, null], rate: 1, octave: -12, follow: true, gate: 0.5, level: 0.3, accent: 0.35 },
          metal: { steps: [0.7, 0, 0, 0.45, 0], freq: 1500, ratio: 2.76, index: 3, decay: 0.05, level: 0.08, pan: 0.55, jitter: 12 },
          jitter: { hat: 11, ghost: 9 },
          kit: {
            kick: { start: 160, end: 46, sweep: 0.035, decay: 0.42, click: 0.35, clickHp: 2600, drive: 2.2, body: 1.15 },
            snare: [
              { tone: "triangle", freq: 230, to: 185, sweep: 0.035, decay: 0.07, level: 0.5 },
              { noise: "highpass", freq: 2200, q: 0.8, decay: 0.15, level: 0.7 },
              { noise: "highpass", freq: 6500, q: 1, decay: 0.02, level: 0.2 },
              { clap: 0.4, at: 0.006 },
            ],
            ghost: [
              { noise: "bandpass", freq: 1800, color: 400, q: 0.9, decay: 0.05, level: 0.4 },
              { tone: "triangle", freq: 210, to: 175, sweep: 0.02, decay: 0.03, level: 0.16 },
            ],
            hat: { hp: 7400, decay: 0.02, metal: 0.45, q: 1.1 },
            open: { hp: 5600, decay: 0.09, metal: 0.3, q: 1, level: 0.5 },
            accents: [0.4, 0.3, 0.55, 0.32],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -6, level: 0.48 }, { type: "square", detune: 7, level: 0.34 }],
            cutoff: 125, color: 220, q: [4.5, 6.5], open: [4.5, 7.5], decay: [0.09, 0.14], drive: 3, level: [0.16, 0.195], sub: [1.4, 1.6], glide: 0.04,
          },
          pad: {
            osc: [{ type: "triangle", detune: -9, level: 0.5 }, { type: "triangle", detune: 8, level: 0.5 }],
            cutoff: 520, q: 1.4, attack: 0.8, release: 0.6, level: 0.07,
          },
          voice: { pitch: 104, bits: 4, hp: 320, lp: 3200, level: 0.06 },
          ornament: { vowels: [[530, 1840], [490, 1350]], wave: "square", steps: 5, octave: 0, syllable: 1.5, ring: 0, lowpass: 2600, echo: null, level: 0.06 },
          fx: {
            echo: { steps: 3, taps: 4, fb: 0.4, lp: 2400, hp: 500 },
            echoSend: { perc: 0.3, lead: 0.35, snare: 0.05 },
            space: { size: 1, fb: 0.5, lp: 3800 },
            spaceSend: { snare: 0.12, perc: 0.2, lead: 0.25, harm: 0.3 },
            drumLp: 13000,
            drive: 1.25,
            duck: { bass: 0.45 },
            master: { lp: 11000 },
          },
          mix: { hat: -1, lead: -2, perc: -2 },
        },
      },
      // The default mix (Rother 0.4, Plant43 0.3, Client_03 0.3): machines interacting. The A / B / C / D kicks over
      // two bars, a body-noise-metal snare, 16th hats 4 ms loose; an FM bass (ratio 1.5: a metallic attack) on the
      // brief's own line (root, octave, m3, fifth, m7) with a 12-step phase line for the break; short dark stabs on a
      // melancholic minor (i add9, bVI maj7, v m7, bII, bVII sus2), a 5- and 7-cell arp, a four-note machine
      // sequence in dotted 8ths (12 against 16) that turns every 16 bars, a 12-step metal, robot calls and the
      // vocoder: "FUTURE SYSTEM", "MACHINE MEMORY".
      {
        id: "mach-system",
        name: "Machine System",
        base: "alienrave",
        bpm: [127, 132],
        swing: 0.52,
        microScale: 0.1,
        trim: 0.79,
        riser: 0,
        leads: ["mach-pulse"],
        data: {
          chords: [
            { bass: 0, tones: [0, 7, 14, 15] },
            { bass: -4, tones: [-4, 3, 7, 12] },
            { bass: -5, tones: [-5, -2, 2, 5] },
            { bass: 1, tones: [1, 7, 13] },
            { bass: -2, tones: [-2, 0, 5, 10] },
            { bass: 0, tones: [0, 3, 7, 10] },
          ],
          progressions: [[0, 0, 1, 0], [0, 5, 2, 3], [0, 1, 4, 0], [5, 0, 3, 0]],
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 6, 8, 13, 16, 24, 27, 30]],
            mid: [[0, 6, 8, 13, 16, 21, 26, 28], [0, 3, 8, 10, 14, 16, 22, 24, 29]],
            hi: [[0, 3, 8, 10, 14, 16, 19, 24, 26, 30], [0, 6, 8, 11, 13, 16, 22, 24, 27, 30]],
          },
          opens: [[14], [6, 14], [10]],
          lines: [
            [[0, 1], null, null, [12, 0], null, [3, 1], null, [0, 4], null, [7, 0], null, [13, 4], [10, 1], null, [0, 0], null],
            [[0, 1], null, [12, 0], null, [0, 4], null, [3, 1], null, [0, 0], [7, 0], null, [10, 2], [12, 1], null, [7, 0], [6, 4]],
            [[0, 1], null, null, [12, 0], null, [0, 0], [10, 1], null, null, [7, 0], null, [3, 4]],
          ],
          stabs: [
            [{ s: 2, len: 1, core: true }, { s: 11, len: 0.5, core: false }, { s: 18, len: 1, core: true }, { s: 26, len: 2, core: false }],
            [{ s: 6, len: 1, core: true }, { s: 22, len: 1, core: true }, { s: 30, len: 0.5, core: false }],
          ],
          arpCells: [[0, 2, 1, 4, 3], [0, 1, 3, 2, 4, 3, 1]],
          calls: [
            { s: 10, len: 6, vowels: [[330, 650], [530, 1840]] },
            { s: 12, len: 4, vowels: [[300, 870], [640, 1190]] },
          ],
          words: [
            // FU-TURE SYS-TEM
            { s: 2, syl: [[300, 870, "s"], [490, 1350, "t"], [390, 1990, "s"], [530, 1840, "t"]] },
            // MA-CHINE ME-MO-RY
            { s: 4, syl: [[640, 1190, null], [270, 2290, "s"], [530, 1840, null], [490, 1350, null], [270, 2290, null]] },
          ],
          seq: { notes: [0, 3, 0, 7], rate: 3, octave: -12, gate: 1.2, level: 0.42, accent: 0.3, evolve: 16 },
          metal: { steps: [0, 0, 0.7, 0, 0, 0, 0, 0.5, 0, 0.6, 0, 0], freq: 2200, ratio: 1.41, index: 3, decay: 0.05, level: 0.08, pan: 0.5, jitter: 3 },
          jitter: { hat: 4 },
          kit: {
            kick: { start: 165, end: 48, sweep: 0.03, decay: 0.32, click: 0.45, clickHp: 2800, drive: 2.2, body: 1.08 },
            snare: [
              { tone: "triangle", freq: 210, to: 170, sweep: 0.03, decay: 0.07, level: 0.48 },
              { noise: "bandpass", freq: 1500, q: 0.9, decay: 0.14, level: 0.55 },
              { noise: "highpass", freq: 6200, q: 0.9, decay: 0.02, level: 0.18 },
              { clap: 0.28, at: 0.004 },
            ],
            hat: { hp: 9000, decay: 0.012, metal: 0.6, q: 1.3 },
            open: { hp: 6400, decay: 0.07, metal: 0.5, q: 1, level: 0.32 },
            accents: [0.3, 0.2, 0.42, 0.26],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -8, level: 0.38 }, { type: "pulse25", detune: 6, level: 0.32 }],
            cutoff: 150, color: 300, q: [5.5, 8], open: [3.2, 5.5], decay: [0.06, 0.1], drive: 2.2, level: [0.155, 0.195], sub: [1.3, 1.5], glide: 0.04, fm: [1.1, 1.9], ratio: 1.5,
          },
          hoover: { cutoff: 420, color: 600, q: 2, hp: 220, bend: 0.3, detune: [-8, 7], level: 0.13 },
          vox: { ring: 0.75, level: 0.45 },
          ornament: { vowels: [[300, 870], [490, 1350], [390, 1990]], wave: "square", steps: 5, octave: -12, ring: 0.75, lowpass: 2200, echo: { steps: 3, feedback: 0.4 }, level: 0.06 },
          fx: {
            echo: { steps: 3, taps: 5, fb: 0.4, lp: 2200, hp: 450 },
            echoSend: { lead: 0.3, perc: 0.15, snare: 0.05 },
            space: { size: 1.3, fb: 0.6, lp: 3800 },
            spaceSend: { lead: 0.25, harm: 0.25, snare: 0.15, perc: 0.15 },
            drumLp: 11000,
            drive: 1.2,
            master: { lp: 9500 },
          },
          mix: { hat: -3.5, lead: -2, perc: -3, fx: -4 },
        },
      },
      // Machine System, darker (1/3): a heavy, menacing machine march at 128. Phrygian in the low register (i with
      // the b2 inside it, bII, the iv an octave down, a b5 diminished, i over the fifth under it); a heavier FM bass
      // (ratio 0.5: the modulator an octave under, a growl, a deeper sub) on a slow root line that leans on the b2,
      // falls to the b7 and the fifth below and slides; a seven-step sequence in quarters (28 16ths against 16) on
      // root, b2, tritone that turns every 16 bars, a low 9-step metal clang, sparse closed stabs, a deeper, longer
      // kick, and the vocoder: "HUMAN ERROR", "OBEY THE SYSTEM", "NO RETURN".
      {
        id: "mach-march",
        name: "Iron March",
        base: "alienrave",
        bpm: [124, 128],
        swing: 0.51,
        microScale: 0.06,
        trim: 0.65,
        riser: 0,
        leads: ["mach-cold"],
        data: {
          chords: [
            { bass: 0, tones: [-5, 0, 1, 3] },
            { bass: 1, tones: [-4, 1, 5] },
            { bass: -7, tones: [-7, -4, 0] },
            { bass: 6, tones: [-6, -3, 0, 3] },
            { bass: 0, tones: [-5, 0, 3, 7] },
            { bass: -2, tones: [-2, 1, 5] },
          ],
          progressions: [[0, 0, 1, 0], [4, 0, 3, 1], [0, 2, 1, 0], [4, 5, 1, 0]],
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 6, 8, 16, 22, 24]],
            mid: [[0, 6, 8, 13, 16, 22, 24, 30], [0, 3, 8, 16, 19, 24, 27]],
            hi: [[0, 3, 8, 10, 14, 16, 19, 24, 26, 30], [0, 6, 8, 11, 13, 16, 22, 24, 27, 30]],
          },
          opens: [[14], [10]],
          lines: [
            [[0, 1], null, null, [0, 0], null, null, [1, 2], [0, 0], [0, 1], null, null, [-2, 0], null, [0, 4], [-5, 2], null],
            [[0, 1], null, [0, 0], null, [12, 4], null, [1, 1], null, [0, 0], null, [0, 0], [-5, 2], [-2, 1], null, [1, 0], null],
            [[0, 1], null, null, [1, 0], null, [0, 0], null, null, [6, 1], null, [0, 4], null],
          ],
          stabs: [
            [{ s: 4, len: 2, core: true }, { s: 20, len: 2, core: true }],
            [{ s: 6, len: 1, core: true }, { s: 14, len: 1, core: false }, { s: 22, len: 3, core: true }],
          ],
          arpCells: [[0, 1, 0, 2, 1], [0, 1, 2, 1, 0, 1, 3]],
          calls: [
            { s: 8, len: 8, vowels: [[300, 870], [450, 800]] },
            { s: 12, len: 4, vowels: [[570, 840], [300, 870]] },
          ],
          words: [
            // HU-MAN ER-ROR
            { s: 2, syl: [[300, 870, null], [640, 1190, null], [530, 1840, null], [490, 1350, null]] },
            // O-BEY THE SYS-TEM
            { s: 2, syl: [[450, 800, null], [530, 1840, "p"], [640, 1190, "t"], [390, 1990, "s"], [530, 1840, "t"]] },
            // NO RE-TURN
            { s: 4, syl: [[450, 800, null], [270, 2290, "t"], [490, 1350, "t"]] },
          ],
          seq: { notes: [0, 1, 0, 6, 0, 1, -2], rate: 4, octave: -12, gate: 2.4, level: 0.4, accent: 0.35, evolve: 16 },
          metal: { steps: [0.7, 0, 0, 0.4, 0, 0, 0.55, 0, 0], freq: 1100, ratio: 1.41, index: 3.5, decay: 0.07, level: 0.075, pan: 0.4, jitter: 2 },
          jitter: { hat: 3 },
          kit: {
            kick: { start: 140, end: 42, sweep: 0.04, decay: 0.42, click: 0.3, clickHp: 2200, drive: 2.6, body: 1.15 },
            snare: [
              { tone: "triangle", freq: 180, to: 150, sweep: 0.03, decay: 0.08, level: 0.52 },
              { noise: "bandpass", freq: 1100, q: 0.9, decay: 0.16, level: 0.55 },
              { noise: "highpass", freq: 5000, q: 0.9, decay: 0.02, level: 0.1 },
              { clap: 0.22, at: 0.005 },
            ],
            hat: { hp: 8200, decay: 0.009, metal: 0.5, q: 1.2 },
            open: { hp: 5600, decay: 0.05, metal: 0.45, q: 1, level: 0.22 },
            accents: [0.28, 0.16, 0.36, 0.2],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -6, level: 0.4 }, { type: "pulse25", detune: 7, level: 0.34 }],
            cutoff: 110, color: 180, q: [6, 8.5], open: [2.6, 4.2], decay: [0.08, 0.13], drive: 2.8, level: [0.16, 0.2], sub: [1.5, 1.75], glide: 0.06, fm: [1.0, 1.7], ratio: 0.5,
          },
          hoover: { cutoff: 280, color: 300, q: 2.5, hp: 160, bend: 0.5, detune: [-9, 8], level: 0.1 },
          vox: { ring: 0.5, level: 0.4 },
          ornament: { vowels: [[300, 870], [450, 800]], wave: "square", steps: 4, octave: -12, ring: 0.5, lowpass: 1600, echo: { steps: 3, feedback: 0.35 }, level: 0.055 },
          fx: {
            echo: { steps: 3, taps: 4, fb: 0.35, lp: 1600, hp: 400 },
            echoSend: { lead: 0.25, perc: 0.12, snare: 0.04 },
            space: { size: 1.1, fb: 0.5, lp: 2600 },
            spaceSend: { lead: 0.18, harm: 0.18, snare: 0.1, perc: 0.1 },
            drumLp: 8500,
            drive: 1.25,
            master: { lp: 7500 },
          },
          mix: { hat: -5, lead: -2, perc: -3, fx: -5 },
        },
      },
      // Machine System, darker (2/3): a relentless dark system at 132, straight and tight (0-2 ms). Half-diminished
      // and Locrian colours (i m7b5, a bii minor, a diminished chord on the b5, i with the b2 cluster); the FM bass at
      // 1.5 as Machine System's but shut lower and driven harder, on 16ths hammering the root with b2 and tritone
      // pushes; a five-note tritone sequence in dotted 8ths (15 against 16: it creeps a 16th a cycle) that turns
      // every eight bars, a 12-step metal, short low stabs, and the vocoder: "TOTAL CONTROL", "SYSTEM FAILURE",
      // "THE GRID IS WATCHING".
      {
        id: "mach-circuit",
        name: "Black Circuit",
        base: "alienrave",
        bpm: [128, 132],
        swing: 0.5,
        microScale: 0.05,
        trim: 0.7,
        riser: 0,
        leads: ["mach-cold"],
        data: {
          chords: [
            { bass: 0, tones: [-6, 0, 3, 10] },
            { bass: 1, tones: [-4, 1, 4, 8] },
            { bass: -6, tones: [-6, -3, 0, 3] },
            { bass: 0, tones: [0, 1, 3, 7] },
            { bass: -2, tones: [-2, 1, 5] },
            { bass: 0, tones: [-5, 0, 3, 6] },
          ],
          progressions: [[0, 0, 1, 0], [3, 2, 0, 1], [0, 5, 2, 0], [3, 4, 1, 2]],
          kicks: {
            half: [[0, 8, 16, 24]],
            lo: [[0, 6, 8, 13, 16, 22, 24, 29]],
            mid: [[0, 6, 8, 13, 16, 24, 27, 30], [0, 5, 8, 10, 16, 22, 24, 29]],
            hi: [[0, 3, 8, 10, 14, 16, 22, 24, 29, 30], [0, 6, 8, 11, 13, 16, 19, 24, 26, 30]],
          },
          opens: [[14], [6]],
          lines: [
            [[0, 1], [0, 0], null, [0, 0], [1, 0], null, [0, 1], [0, 0], null, [6, 0], [0, 0], null, [0, 1], [1, 2], [0, 0], [-2, 4]],
            [[0, 1], null, [0, 0], [12, 4], [0, 0], null, [1, 1], [0, 0], [0, 0], null, [6, 1], null, [0, 0], [1, 0], [0, 0], [-1, 4]],
            [[0, 1], null, [0, 0], [1, 0], null, [0, 1], null, [6, 0], [0, 0], null],
          ],
          stabs: [
            [{ s: 2, len: 1, core: true }, { s: 18, len: 1, core: true }, { s: 27, len: 0.5, core: false }],
            [{ s: 6, len: 0.5, core: true }, { s: 13, len: 0.5, core: false }, { s: 22, len: 1, core: true }],
          ],
          arpCells: [[0, 1, 0, 2, 1], [0, 2, 1, 3, 0, 1, 2]],
          calls: [
            { s: 10, len: 6, vowels: [[570, 840], [300, 870]] },
            { s: 12, len: 4, vowels: [[450, 800], [640, 1190]] },
          ],
          words: [
            // TO-TAL CON-TROL
            { s: 2, syl: [[450, 800, "t"], [640, 1190, "t"], [570, 840, "k"], [450, 800, "t"]] },
            // SYS-TEM FAIL-URE
            { s: 2, syl: [[390, 1990, "s"], [530, 1840, "t"], [530, 1840, null], [490, 1350, null]] },
            // THE GRID IS WATCH-ING
            { s: 2, syl: [[640, 1190, "t"], [390, 1990, "k"], [390, 1990, "s"], [570, 840, "t"], [390, 1990, null]] },
          ],
          seq: { notes: [0, 6, 1, 0, -6], rate: 3, octave: -12, gate: 1.1, level: 0.42, accent: 0.35, evolve: 8 },
          metal: { steps: [0, 0, 0.7, 0, 0, 0.45, 0, 0.55, 0, 0, 0.4, 0], freq: 1500, ratio: 1.41, index: 3, decay: 0.05, level: 0.075, pan: 0.45, jitter: 1 },
          jitter: { hat: 2 },
          kit: {
            kick: { start: 155, end: 44, sweep: 0.03, decay: 0.34, click: 0.4, clickHp: 2600, drive: 2.5, body: 1.1 },
            snare: [
              { tone: "triangle", freq: 190, to: 158, sweep: 0.025, decay: 0.07, level: 0.5 },
              { noise: "bandpass", freq: 1250, q: 1, decay: 0.12, level: 0.55 },
              { noise: "highpass", freq: 5600, q: 0.9, decay: 0.018, level: 0.12 },
              { clap: 0.25, at: 0.003 },
            ],
            hat: { hp: 8400, decay: 0.009, metal: 0.6, q: 1.3 },
            open: { hp: 6000, decay: 0.05, metal: 0.5, q: 1, level: 0.22 },
            accents: [0.26, 0.16, 0.36, 0.2],
          },
          bassTone: {
            osc: [{ type: "sawtooth", detune: -8, level: 0.38 }, { type: "pulse25", detune: 6, level: 0.34 }],
            cutoff: 120, color: 200, q: [6, 8.5], open: [2.8, 4.6], decay: [0.06, 0.09], drive: 2.7, level: [0.155, 0.195], sub: [1.4, 1.6], glide: 0.035, fm: [1.2, 2.0], ratio: 1.5,
          },
          hoover: { cutoff: 300, color: 320, q: 2.2, hp: 180, bend: 0.3, detune: [-8, 7], level: 0.1 },
          vox: { ring: 0.71, level: 0.42 },
          ornament: { vowels: [[570, 840], [390, 1990]], wave: "square", steps: 4, octave: -12, ring: 0.71, lowpass: 1800, echo: { steps: 3, feedback: 0.35 }, level: 0.055 },
          fx: {
            echo: { steps: 3, taps: 4, fb: 0.35, lp: 1800, hp: 450 },
            echoSend: { lead: 0.25, perc: 0.12, snare: 0.03 },
            space: { size: 1.1, fb: 0.5, lp: 3000 },
            spaceSend: { lead: 0.2, harm: 0.2, snare: 0.12, perc: 0.12 },
            drumLp: 9500,
            drive: 1.25,
            master: { lp: 8000 },
          },
          mix: { hat: -5, lead: -2, perc: -3, fx: -5 },
        },
      },
      // Machine System, darker (3/3): a driving one at 134 with a dark FM bass and interlocking metal. Phrygian with
      // the b9 in the chord (i over the fifth under it with the b2, a bII, a bvi minor, a v with the b9: diminished,
      // a iv an octave down); a pulse12-and-saw bass with an inharmonic FM (ratio 1.41: a cold clang in the attack)
      // rolling the root with the b2 and the m3; a seven-step sequence in 8ths (14 against 16) and a 10-step metal
      // that lock against each other and the 16-step drums, low stabs, and the vocoder: "DEAD CIRCUIT", "NO SIGNAL",
      // "MACHINE WILL REMAIN".
      {
        id: "mach-engine",
        name: "Cold Engine",
        base: "alienrave",
        bpm: [130, 134],
        swing: 0.52,
        microScale: 0.08,
        trim: 0.655,
        riser: 0,
        leads: ["mach-iron"],
        data: {
          chords: [
            { bass: 0, tones: [-5, 0, 1, 3] },
            { bass: 1, tones: [-4, 1, 5] },
            { bass: -4, tones: [-4, -1, 3] },
            { bass: -5, tones: [-5, -2, 1] },
            { bass: 5, tones: [-7, -4, 0] },
            { bass: 0, tones: [-5, 0, 3, 7] },
          ],
          progressions: [[0, 0, 1, 0], [5, 2, 3, 0], [0, 4, 1, 3], [0, 0, 2, 1]],
          kicks: {
            half: [[0, 10, 16, 26]],
            lo: [[0, 6, 8, 13, 16, 22, 24, 27]],
            mid: [[0, 6, 8, 13, 16, 21, 24, 27, 30], [0, 3, 8, 10, 16, 19, 24, 29]],
            hi: [[0, 3, 6, 8, 10, 14, 16, 19, 22, 24, 27, 30], [0, 6, 8, 11, 13, 16, 22, 24, 27, 30]],
          },
          opens: [[14], [6, 14]],
          lines: [
            [[0, 1], null, [0, 0], [0, 0], null, [1, 1], [0, 0], null, [0, 1], null, [0, 0], [3, 0], null, [1, 2], [0, 0], null],
            [[0, 1], [0, 0], null, [-2, 0], [0, 1], null, [1, 0], [0, 0], [0, 1], null, [6, 4], [0, 0], null, [0, 0], [1, 1], [3, 4]],
            [[0, 1], null, [0, 0], null, [1, 1], [0, 0], null, [0, 1], null, [6, 0], [0, 0], null, [1, 2], [0, 0]],
          ],
          stabs: [
            [{ s: 3, len: 1, core: true }, { s: 11, len: 0.5, core: false }, { s: 19, len: 1, core: true }],
            [{ s: 6, len: 1, core: true }, { s: 22, len: 1, core: true }, { s: 30, len: 0.5, core: false }],
          ],
          arpCells: [[0, 1, 2, 1, 3], [0, 1, 0, 2, 1, 3, 2]],
          calls: [
            { s: 10, len: 6, vowels: [[300, 870], [570, 840]] },
            { s: 8, len: 4, vowels: [[450, 800], [530, 1840]] },
          ],
          words: [
            // DEAD CIR-CUIT
            { s: 2, syl: [[530, 1840, "t"], [490, 1350, "s"], [390, 1990, "k"]] },
            // NO SIG-NAL
            { s: 4, syl: [[450, 800, null], [390, 1990, "s"], [640, 1190, null]] },
            // MA-CHINE WILL RE-MAIN
            { s: 2, syl: [[640, 1190, null], [270, 2290, "s"], [390, 1990, null], [270, 2290, "t"], [530, 1840, null]] },
          ],
          seq: { notes: [0, null, 1, 0, null, 6, 3], rate: 2, octave: -12, gate: 0.9, level: 0.4, accent: 0.3, evolve: 8 },
          metal: { steps: [0.7, 0, 0, 0.4, 0, 0.6, 0, 0, 0.35, 0], freq: 1300, ratio: 2.76, index: 3, decay: 0.05, level: 0.08, pan: 0.5, jitter: 3 },
          jitter: { hat: 4 },
          kit: {
            kick: { start: 150, end: 44, sweep: 0.035, decay: 0.36, click: 0.4, clickHp: 2600, drive: 2.5, body: 1.12 },
            snare: [
              { tone: "triangle", freq: 195, to: 160, sweep: 0.03, decay: 0.07, level: 0.5 },
              { noise: "bandpass", freq: 1300, q: 0.9, decay: 0.13, level: 0.55 },
              { noise: "highpass", freq: 5600, q: 0.9, decay: 0.02, level: 0.12 },
              { clap: 0.25, at: 0.004 },
            ],
            hat: { hp: 8400, decay: 0.01, metal: 0.55, q: 1.2 },
            open: { hp: 6000, decay: 0.05, metal: 0.45, q: 1, level: 0.22 },
            accents: [0.28, 0.18, 0.38, 0.22],
          },
          bassTone: {
            osc: [{ type: "pulse12", detune: -6, level: 0.4 }, { type: "sawtooth", detune: 7, level: 0.36 }],
            cutoff: 120, color: 220, q: [5.5, 8], open: [3, 5], decay: [0.06, 0.1], drive: 2.6, level: [0.155, 0.195], sub: [1.4, 1.6], glide: 0.04, fm: [1.4, 2.3], ratio: 1.41,
          },
          hoover: { cutoff: 320, color: 360, q: 2.2, hp: 180, bend: 0.3, detune: [-8, 7], level: 0.1 },
          vox: { ring: 0.71, level: 0.42 },
          ornament: { vowels: [[530, 1840], [390, 1990]], wave: "square", steps: 4, octave: -12, ring: 0.71, lowpass: 1800, echo: { steps: 3, feedback: 0.35 }, level: 0.055 },
          fx: {
            echo: { steps: 3, taps: 4, fb: 0.38, lp: 1800, hp: 450 },
            echoSend: { lead: 0.25, perc: 0.15, snare: 0.03 },
            space: { size: 1.1, fb: 0.5, lp: 3000 },
            spaceSend: { lead: 0.2, harm: 0.2, snare: 0.12, perc: 0.14 },
            drumLp: 9500,
            drive: 1.25,
            master: { lp: 8000 },
          },
          mix: { hat: -5, lead: -2, perc: -3, fx: -5 },
        },
      },
    ],
  },
  patches: {
    // Memory Lead: a melancholic sci-fi line: a detuned saw and a triangle with a pulse an octave under, a slow
    // lowpass bloom, a late slight vibrato; it sings into the echo.
    "mach-memory-lead": {
      name: "Memory Lead",
      osc: [
        { type: "sawtooth", detune: -7, oct: 0, level: 0.45 },
        { type: "triangle", detune: 6, oct: 0, level: 0.6 },
        { type: "pulse25", detune: 0, oct: -1, level: 0.25 },
      ],
      filter: { type: "lowpass", cutoff: 900, env: 1100, decay: 0.35, q: 2.5 },
      amp: { a: 0.012, d: 0.5, s: 0.45, r: 0.5 },
      vib: { rate: 4.5, depth: 6, delay: 0.3 },
      gain: 0.6,
    },
    // Digital Blip: a short, dark FM tick (ratio 3.5, the index gone in 50 ms) through a resonant lowpass: percussive
    // and modulated, low in the register so it stays a machine part, not a game sound.
    "mach-digital": {
      name: "Digital Blip",
      osc: [
        { type: "square", detune: -4, oct: 0, level: 0.5 },
        { type: "pulse12", detune: 5, oct: 0, level: 0.35 },
      ],
      fm: { ratio: 3.5, index: 2.5, decay: 0.05, floor: 0.1 },
      filter: { type: "lowpass", cutoff: 1100, env: 1500, decay: 0.06, q: 6 },
      amp: { a: 0.002, d: 0.09, s: 0, r: 0.06 },
      gain: 0.55,
    },
    // Machine Pulse: a cold narrow pulse with a square an octave under, a short resonant filter blip, no vibrato.
    "mach-pulse": {
      name: "Machine Pulse",
      osc: [
        { type: "pulse25", detune: -4, oct: 0, level: 0.55 },
        { type: "square", detune: 5, oct: -1, level: 0.35 },
      ],
      filter: { type: "lowpass", cutoff: 900, env: 900, decay: 0.12, q: 4 },
      amp: { a: 0.003, d: 0.2, s: 0.3, r: 0.15 },
      gain: 0.6,
    },
    // Cold Pulse: a dark narrow pulse with a saw an octave under, shut low (a 520 Hz lowpass, a short small blip),
    // no vibrato: the darker machine sequence for Iron March and Black Circuit.
    "mach-cold": {
      name: "Cold Pulse",
      osc: [
        { type: "pulse25", detune: -5, oct: 0, level: 0.5 },
        { type: "sawtooth", detune: 6, oct: -1, level: 0.4 },
      ],
      filter: { type: "lowpass", cutoff: 520, env: 600, decay: 0.1, q: 5 },
      amp: { a: 0.003, d: 0.25, s: 0.25, r: 0.15 },
      gain: 0.65,
    },
    // Iron Pulse: a square and a narrow pulse with an inharmonic FM clang (ratio 1.41, gone in 80 ms) through a low
    // resonant lowpass: metallic in the attack, dark in the body (Cold Engine's sequence).
    "mach-iron": {
      name: "Iron Pulse",
      osc: [
        { type: "square", detune: -4, oct: 0, level: 0.45 },
        { type: "pulse12", detune: 5, oct: -1, level: 0.4 },
      ],
      fm: { ratio: 1.41, index: 2, decay: 0.08, floor: 0.05 },
      filter: { type: "lowpass", cutoff: 650, env: 800, decay: 0.08, q: 6 },
      amp: { a: 0.002, d: 0.18, s: 0.2, r: 0.12 },
      gain: 0.62,
    },
  },
} satisfies StationPack;
