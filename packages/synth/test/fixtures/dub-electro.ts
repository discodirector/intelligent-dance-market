import type { StationPack } from "../../src/pack.ts";

// A demo style pack for the two genres opened last (dubtechno, electro): not a station (not in stations/index.ts),
// the tests' reference for their data fields. Every style restyles its base through notes and sound fields.
// To gate it: copy it to packages/synth/src/stations/<key>.ts with the import "../pack.ts" and run
// web/scripts/station-check-pack.mjs <key>.

export default {
  key: "dub-electro-demo",
  name: "Dub Electro Demo",
  genres: ["dubtechno", "electro"],
  styles: {
    dubtechno: [
      // A deep chamber: a longer, darker echo on wide m9 stabs, a softer and longer kick, more rain.
      {
        id: "demo-chamber",
        name: "Deep Chamber",
        base: "classic",
        trim: 0.803,
        data: {
          chords: { i9wide: { root: 0, upper: [3, 10, 14, 19] } },
          progressions: [
            { bars: 4, seq: ["i9wide", "VI9", "i11", "v7"] },
            { bars: 2, seq: ["i9wide", "iv7", "VI9", "VII9"] },
          ],
          figures: [[2, 6, 10, 14], [3, 7, 11]],
          accents: [1, 0.76, 0.86, 0.68],
          bells: [[[2, 0, 1], [18, 1, 0.8], [34, 2, 0.7], [50, 0, 0.9]]],
          kit: { kick: { center: 46, decay: 0.75, click: 0.06 }, hat: { off: 0.52, shaker: 0.3 } },
          subTone: { lp: 260, octave: 0.1 },
          stabTone: { lp: 860, q: 2.4, detune: 11, release: 0.5 },
          padTone: { level: 1.4, wave: "triangle", lp: 1100 },
          bellTone: { every: 1, decay: 2.2 },
          sweep: { stab: 48, echo: 24 },
          field: { level: 1.6, hz: 1500 },
          vinyl: 1,
          fx: { echo: { taps: 12, fb: 0.62, lp: 1900 }, space: { size: 1.9, fb: 0.8, lp: 2800 }, drumLp: 9000 },
        },
      },
      // A tape loop: The Moment drier and tighter, a saw stab wobbling hard, a clap instead of the rim, a busy sub.
      {
        id: "demo-tape-loop",
        name: "Tape Loop",
        base: "moment",
        trim: 1.013,
        data: {
          figures: [[2, 5, 10, 13], [3, 8, 11, 14]],
          bassline: [[2, 1, 1], [3, 0.9, 0.7], [6, 1, 1], [10, 1, 1], [11, 0.9, 0.7, 7], [14, 1, 1], [15, 0.8, 0.6, 12]],
          percs: [[3, 1, 1], [11, 1.5, 0.8], [19, 1, 0.9], [27, 1.5, 0.7]],
          kit: { clap: { rim: false, level: 1.1, hz: 1500, decay: 0.1 }, perc: { level: 0.42 } },
          stabTone: { wave: "sawtooth", lp: 1300, move: 0.9, q: 2.6 },
          padTone: { level: 0.6 },
          fx: { echo: { taps: 5, fb: 0.45 }, space: { size: 0.9, fb: 0.68 } },
          mix: { harm: 1.5, tex: -2 },
        },
      },
    ],
    electro: [
      // Drexciya-cold: a busier 808 break, a fifth-and-octave arp, a darker and longer bass filter, a wider echo.
      {
        id: "demo-deep-sea",
        name: "Deep Sea",
        base: "classic",
        trim: 1.009,
        data: {
          kicks: {
            half: [[0, 16]],
            lo: [[0, 10, 16, 23, 26]],
            mid: [[0, 6, 10, 16, 22, 27], [0, 3, 10, 16, 19, 26]],
            hi: [[0, 3, 6, 10, 16, 19, 22, 26, 30]],
          },
          arps: [[0, 7, 12], [0, 12, 15]],
          kit: { hat: { hp: 8200, decay: 0.025, metal: 0.7, q: 1.2 }, accents: [0.46, 0.34, 0.54, 0.34] },
          bassTone: { cutoff: 450, q: [9, 9], decay: [0.18, 0.18] },
          fx: { echo: { steps: 3, taps: 6, fb: 0.55 }, echoSend: { lead: 0.7, perc: 0.45 } },
        },
      },
      // Robot funk: Client_03 with Alien Rave's 909 snare, a lower and grittier computer voice, a hotter bass.
      {
        id: "demo-robot-funk",
        name: "Robot Funk",
        base: "client03",
        trim: 0.74,
        data: {
          riffs: [[
            { s: 0, semi: 0, len: 2, f: 1 }, { s: 3, semi: 0, len: 1, f: 8 }, { s: 6, semi: 12, len: 1, f: 1 }, { s: 8, semi: 10, len: 2, f: 2 },
            { s: 11, semi: 7, len: 1, f: 0 }, { s: 14, semi: 0, len: 1, f: 12 }, { s: 16, semi: 0, len: 3, f: 1 }, { s: 22, semi: 12, len: 1, f: 1 },
            { s: 23, semi: 10, len: 1, f: 2 }, { s: 26, semi: 7, len: 2, f: 0 }, { s: 30, semi: 3, len: 1, f: 4 },
          ]],
          words: [{ s: 4, syl: [[300, 2300, "s"], [650, 1100, "t"], [270, 2290, null]] }],
          kit: { snare: "alien" },
          bassTone: { drive: 3, q: [4.5, 6.5] },
          pad: { cutoff: 900, attack: 0.6 },
          voice: { pitch: 96, bits: 5, level: 0.07 },
        },
      },
      // Phase rave: Alien Rave with a 6-step phase bass, a wider hoover bend and a slower ring on the robot.
      {
        id: "demo-phase",
        name: "Phase Rave",
        base: "alienrave",
        trim: 0.708,
        data: {
          lines: [[[0, 1], [12, 0], [0, 4], [7, 1], [0, 0], [10, 2]]],
          arpCells: [[0, 2, 4, 1, 3, 5]],
          hoover: { bend: 5, detune: [-24, 0, 24], cutoff: 760 },
          vox: { ring: 2 },
          fx: { space: { size: 1.4 } },
        },
      },
    ],
  },
} satisfies StationPack;
