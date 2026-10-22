import type { StationPack } from "../../src/pack.ts";

// A demo pack restyling the two genres opened last (ambientidm, drone), one idea per style. Not a station: it is not
// in stations/index.ts. test/pack-ambient.test.ts validates it and checks every style differs from its base; the gate
// runs on a copy (stations/README.md "Gate"): cp it to src/stations/ambient-demo.ts, run
// `node web/scripts/station-check-pack.mjs ambient-demo`, delete the copy.
export default {
  key: "ambient-demo",
  name: "Ambient Demo",
  genres: ["ambientidm", "drone"],
  styles: {
    ambientidm: [
      // Tape Keys slowed into a lullaby: sparse broken chords that only fill in when the chain is very busy, a
      // rounder pad with deeper wow, a softer kit, more hiss.
      {
        id: "demo-lullaby",
        name: "Lullaby Tape",
        base: "classic",
        trim: 1.285,
        data: {
          progressions: [[0, 3], [0, 2, 3, 4]],
          figures: [
            [[0, 0, 0], [8, 2, 0], [16, 1, 0], [24, 3, 1], [28, 6, 2]],
            [[0, 1, 0], [12, 3, 0], [16, 0, 0], [22, 2, 1], [30, 4, 2]],
          ],
          tiers: [0.5, 0.85],
          kit: {
            kick: { start: 80, end: 48, sweep: 0.08, decay: 0.3, click: 0, body: 0.8 },
            hat: { hp: 3200, decay: 0.03, metal: 0.06, level: 0.24 },
          },
          pad: { osc: [{ type: "triangle", detune: -7, level: 0.5 }, { type: "sine", detune: 6, level: 0.4 }], cutoff: 560, vib: 15, attack: 2.4 },
          line: { level: 0.022, cutoff: 1900 },
          vinyl: 1.3,
          mix: { hat: -2, lead: 1 },
          fx: { echo: { steps: 3, taps: 6, fb: 0.6 }, echoSend: { lead: 0.75 } },
        },
      },
      // Crystal as a music box: integer-ratio bells, a slower and longer-ringing arp of its own cells, fewer edits.
      {
        id: "demo-musicbox",
        name: "Music Box",
        base: "crystal",
        trim: 1.33,
        data: {
          arps: [[0, 2, 4, 6, 8, 6, 4, 2], [1, 3, 5, 7, 5, 3]],
          tiers: [0.3, 0.8],
          notes: [0, 7, 12, 15, 19],
          bell: { ratio: 4, index: 1.8, decay: 1.6, level: 0.05 },
          shimmer: { partials: [{ ratio: 1, detune: 0, level: 0.8 }, { ratio: 4, detune: 3, level: 0.1 }], decay: 0.8, short: 0.45, level: 0.13 },
          glass: { partials: [{ type: "sine", ratio: 1, detune: 0, level: 0.5 }, { type: "sine", ratio: 2, detune: 7, level: 0.24 }, { type: "sine", ratio: 3, detune: -3, level: 0.08 }] },
          kit: { hat: { hp: 6000, decay: 0.012, metal: 0.3, level: 0.22 }, open: { hp: 6000, decay: 0.008, metal: 0.3, level: 0.12 } },
          fx: { space: { size: 2.1, fb: 0.8 } },
        },
      },
      // Tape Haze through a broken deck: a new tune, a deeper scoop and wow, a darker bass, the lead into a dub echo.
      {
        id: "demo-warped",
        name: "Warped Deck",
        base: "boc",
        trim: 1.62,
        data: {
          phrases: [
            [[0, 0, 12, 0, 0], [16, 2, 8, 0, 0], [32, 1, 24, 0, 0], [64, 0, 16, 0, 0], [84, 3, 6, 0, 1], [96, 2, 24, 0, 0]],
          ],
          lead: { scoop: 70, vib: 18, cutoff: 760 },
          pad: { vib: 20, drive: 1.6, cutoff: 1300 },
          bass: { cutoff: 160, level: 0.07 },
          kit: { open: { hp: 1000, decay: 0.08, metal: 0.02, level: 0.3 }, thump: 0.06 },
          vinyl: 1.4,
          fx: { echo: { steps: 6, taps: 6, fb: 0.62, lp: 1800 }, echoSend: { lead: 0.8 } },
        },
      },
    ],
    drone: [
      // Wall as a cathedral: longer phrases, a sixth-and-tenth colour, sines and triangles that beat slowly, glints
      // an octave higher and rarer.
      {
        id: "demo-cathedral",
        name: "Cathedral",
        base: "classic",
        trim: 2.13,
        data: {
          bars: 8,
          voicing: [0, 7, 12, 16, 19, 24],
          colours: [[0, 9, 12, 16, 21, 24]],
          glints: [12, 19, 24, 31],
          wall: { waves: ["sine", "triangle"], detune: 5, spread: 2, period: 30, depth: 0.25, cutoff: 520, level: 0.06 },
          glint: { gap: 3, decay: 6 },
          breath: 0.03,
          fx: { space: { size: 2.4, fb: 0.84 } },
        },
      },
      // Dark Low further down: sixteen-bar phrases, slower beating, sawtooth air in the pad, more rumble.
      {
        id: "demo-abyss",
        name: "Abyss",
        base: "dark",
        trim: 1.27,
        data: {
          bars: 16,
          bed: { beat: 0.45, subs: [[-12, -9, 0.6], [-12, 10, 0.6], [0, -5, 0.3], [0, 6, 0.3]], cutoff: 220 },
          pad: { waves: ["sawtooth", "triangle"], cutoff: 240, period: 40 },
          kick: { decay: 2.4, end: 24 },
          rumble: 0.06,
        },
      },
      // Overtone Pulse with the seventh-free upper series opened: the fifth on most phrases, deeper breathing.
      {
        id: "demo-choir",
        name: "Series Choir",
        base: "pulse",
        trim: 2.09,
        data: {
          partials: [
            { n: 1, g: 0.4, group: 0 },
            { n: 2, g: 0.36, group: 0 },
            { n: 3, g: 0.32, group: 1 },
            { n: 5, g: 0.14, group: 1 },
            { n: 6, g: 0.16, group: 2 },
            { n: 10, g: 0.04, group: 2 },
            { n: 12, g: 0.03, group: 3 },
          ],
          figures: [[1, 1, 0, 1]],
          overtone: { depths: [0.2, 0.7, 0.7, 0.8], cutoff: 1400 },
          glints: [3, 5, 6, 8],
        },
      },
    ],
  },
} satisfies StationPack;
