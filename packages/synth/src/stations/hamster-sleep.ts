import type { StationPack } from "../pack.ts";

// Hamster Sleep: the Squeekchain station's sleep mode. While the hamster sleeps (the wheel still 10+ minutes) the
// station holds the last sequencer state and plays one of these styles for 30 minutes at a time, each slot in its
// own key. Calm, warm, a little dreamy (a hamster dreaming), never harsh or busy; slow motion rather than short
// loops, since each style plays half an hour.
// Ambient IDM is written in the relative major of the genre's minor pentatonic (Eb major pentatonic over a C
// tonic: the same five notes), so it reads as a lullaby rather than a lament; progressions are eight chords (four
// bars each) so a cycle lasts minutes, not seconds. The drone stays on the tonic, the fifth and their octaves.
// Drums only in two styles (Tape Dream, Nap Beat): a soft round kick, a brushed snare far down, hats nearly gone.
export default {
  key: "hamster-sleep",
  name: "Hamster Sleep",
  genres: ["ambientidm", "drone"],
  styles: {
    ambientidm: [
      // Warm tape-haze pads with soft dust and a lazy cassette tune; a heartbeat kick and a brushed snare far down.
      {
        id: "hamster-tape-dream",
        name: "Tape Dream",
        base: "boc",
        bpm: [70, 76],
        swing: 0.6,
        microScale: 1.6,
        trim: 2.1,
        data: {
          chords: [
            // 0: Eb6/9 (the "I" of the relative major)
            { bass: 3, pad: [-9, 3, 7, 10, 12, 17], glass: [3, 10, 15, 19, 24], arp: [3, 7, 10, 15], sing: [7, 10, 17, 3, 12] },
            // 1: Bb6/9 without the third (F Bb C G)
            { bass: -2, pad: [-14, 5, 10, 12, 19], glass: [-2, 5, 10, 12, 19], arp: [-2, 5, 10, 12], sing: [15, 17, 12, 10, 19] },
            // 2: Cm7 (vi)
            { bass: 0, pad: [-12, 0, 7, 10, 15], glass: [0, 7, 12, 15, 24], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] },
            // 3: F7sus4 (ii)
            { bass: 5, pad: [-7, 5, 10, 12, 15], glass: [5, 12, 15, 17, 22], arp: [5, 10, 12, 15], sing: [10, 12, 7, 5, 15] },
            // 4: Eb6 high, the octave open
            { bass: 3, pad: [-9, 7, 10, 12, 15, 19], glass: [3, 7, 15, 19, 22], arp: [3, 7, 12, 15], sing: [7, 10, 12, 3, 15] },
          ],
          progressions: [
            [0, 0, 1, 1, 2, 2, 3, 4],
            [0, 2, 3, 1, 0, 4, 3, 1],
            [2, 0, 3, 0, 1, 4, 3, 0],
          ],
          phrases: [
            [[0, 0, 24, 0, 0], [32, 1, 16, 0, 0], [56, 2, 6, 0, 1], [64, 3, 24, 0, 0], [96, 0, 28, 0, 0]],
            [[8, 1, 20, 0, 0], [40, 2, 12, 0, 1], [64, 0, 28, 0, 0], [104, 4, 20, 0, 0]],
            [[0, 3, 12, 0, 0], [16, 0, 28, 0, 0], [72, 1, 20, 0, 0], [100, 2, 24, 0, 1]],
          ],
          tiers: [0.6, 0.9],
          notes: [3, 7, 10, 12, 15],
          kit: {
            kick: { start: 72, end: 48, sweep: 0.09, decay: 0.24, click: 0, body: 0.6, drive: 0 },
            thump: 0.03,
            snare: [
              { tone: "triangle", freq: 150, to: 118, sweep: 0.05, decay: 0.08, level: 0.1 },
              { noise: "lowpass", freq: 1700, q: 0.5, decay: 0.16, level: 0.22 },
            ],
            dust: [{ noise: "lowpass", freq: 1400, q: 0.4, decay: 0.12, level: 0.08 }],
            ghost: [{ noise: "lowpass", freq: 1500, q: 0.5, decay: 0.05, level: 0.08 }],
            hat: { hp: 3000, decay: 0.02, metal: 0, level: 0.05 },
            open: { hp: 3000, decay: 0.04, metal: 0, level: 0.06 },
          },
          pad: {
            osc: [{ type: "sawtooth", detune: -14, level: 0.14 }, { type: "triangle", detune: 9, level: 0.4 }, { type: "triangle", detune: -3, level: 0.3 }],
            cutoff: 950, q: 0.55, attack: 4, release: 4.5, vib: 13, drive: 1.1, hp: 120,
          },
          bass: { cutoff: 170, level: 0.05, sub: 0.06 },
          lead: {
            osc: [{ type: "triangle", oct: 0, detune: -8, level: 0.6 }, { type: "sine", oct: 0, detune: 7, level: 0.6 }, { type: "sine", oct: 1, detune: 3, level: 0.1 }],
            cutoff: 800, level: 0.1, scoop: 30, vib: 10,
          },
          vinyl: 0.85,
          mix: { kick: -5, snare: -5, hat: -6, perc: -4, harm: 1 },
          fx: { drumLp: 3200, master: { lp: 7000 }, space: { size: 2, fb: 0.8, lp: 3000 } },
        },
      },
      // A music box in the next room: integer-ratio bells, the arp in slow quarters, a soft glass bed, no drums.
      {
        id: "hamster-music-box",
        name: "Music Box",
        base: "crystal",
        bpm: [70, 78],
        swing: 0.5,
        microScale: 0.4,
        trim: 2.1,
        data: {
          chords: [
            { bass: 3, pad: [-9, 3, 7, 10, 12], glass: [3, 10, 15, 19], arp: [3, 7, 10, 15], sing: [7, 10, 17, 3, 12] },
            { bass: -2, pad: [-14, 5, 10, 12, 19], glass: [-2, 5, 10, 17], arp: [-2, 5, 10, 12], sing: [15, 17, 12, 10, 19] },
            { bass: 0, pad: [-12, 0, 7, 10, 15], glass: [0, 7, 12, 15], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] },
            { bass: 5, pad: [-7, 5, 10, 12, 15], glass: [5, 12, 15, 17], arp: [5, 10, 12, 15], sing: [10, 12, 7, 5, 15] },
          ],
          progressions: [
            [0, 1, 0, 3, 0, 1, 2, 3],
            [0, 3, 2, 1, 0, 3, 1, 0],
          ],
          arps: [
            [4, 5, 6, 7, 6, 5],
            [4, 6, 8, 6, 5, 7],
            [8, 7, 6, 5, 4, 6, 5, 7],
          ],
          tiers: [0.92, 0.99],
          notes: [3, 7, 10, 15],
          kit: {
            click: [{ tone: "sine", freq: 120, to: 70, sweep: 0.03, decay: 0.05, level: 0 }],
            rim: { level: 0, pitch: 1 },
            crack: { noise: "lowpass", freq: 1500, q: 0.5, decay: 0.02, level: 0 },
            tick: { noise: "lowpass", freq: 1500, q: 0.5, decay: 0.01, level: 0 },
            hat: { hp: 6000, decay: 0.01, metal: 0, level: 0 },
            open: { hp: 6000, decay: 0.01, metal: 0, level: 0 },
          },
          glass: {
            level: 0.035, cutoff: 1600, hp: 200, attack: 3, release: 3,
            partials: [{ type: "sine", ratio: 1, detune: 0, level: 0.5 }, { type: "triangle", ratio: 1, detune: -6, level: 0.3 }, { type: "sine", ratio: 2, detune: 5, level: 0.1 }],
          },
          bell: { level: 0.032, ratio: 4, index: 1, decay: 2.2 },
          shimmer: { level: 0.15, decay: 1.4, short: 0.7, partials: [{ ratio: 1, detune: 0, level: 0.75 }, { ratio: 2, detune: -2, level: 0.1 }, { ratio: 3, detune: 3, level: 0.06 }] },
          line: { level: 0.01, cutoff: 2400 },
          mix: { perc: -6, kick: -6, snare: -6, hat: -6 },
          fx: {
            echo: { steps: 6, taps: 3, fb: 0.35, lp: 2200, hp: 400 },
            space: { size: 1.2, fb: 0.62, lp: 3600 },
            master: { lp: 6000 },
          },
        },
      },
      // A lullaby on warm keys: a slow celesta arpeggio over a soft tape pad and a high held line; no drums.
      {
        id: "hamster-lullaby",
        name: "Lullaby",
        base: "classic",
        bpm: [70, 73],
        swing: 0.54,
        microScale: 1,
        trim: 1.72,
        leads: ["hamster-celesta"],
        data: {
          chords: [
            { bass: 3, pad: [-9, 3, 7, 10, 12], glass: [3, 10, 15, 19], arp: [3, 7, 10, 15], sing: [7, 10, 17, 3, 12] },
            { bass: -2, pad: [-14, 5, 10, 12, 17], glass: [-2, 5, 10, 17], arp: [-2, 5, 10, 12], sing: [15, 17, 12, 10, 19] },
            { bass: 0, pad: [-12, 0, 7, 10, 15], glass: [0, 7, 12, 15], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] },
            { bass: 5, pad: [-7, 5, 10, 12, 15], glass: [5, 12, 15, 17], arp: [5, 10, 12, 15], sing: [10, 12, 7, 5, 15] },
            { bass: 3, pad: [-9, 7, 10, 15, 19], glass: [3, 7, 15, 19], arp: [3, 7, 12, 15], sing: [7, 10, 12, 3, 15] },
          ],
          progressions: [
            [0, 1, 2, 3, 0, 4, 3, 1],
            [0, 3, 0, 1, 2, 3, 4, 1],
          ],
          figures: [
            [[0, 0, 0], [6, 1, 0], [12, 2, 0], [16, 3, 0], [22, 2, 0], [28, 1, 1]],
            [[0, 4, 0], [8, 2, 0], [12, 1, 1], [16, 3, 0], [24, 2, 0]],
            [[0, 0, 0], [4, 2, 1], [8, 3, 0], [16, 5, 0], [24, 3, 0], [28, 2, 1]],
          ],
          tiers: [0.75, 0.95],
          kit: {
            kick: { start: 60, end: 45, sweep: 0.1, decay: 0.2, click: 0, body: 0 },
            snare: [{ noise: "lowpass", freq: 1200, q: 0.5, decay: 0.05, level: 0 }],
            hat: { hp: 4000, decay: 0.01, metal: 0, level: 0 },
          },
          pad: {
            osc: [{ type: "triangle", detune: -7, level: 0.5 }, { type: "sine", detune: 6, level: 0.5 }],
            cutoff: 800, q: 0.5, attack: 3.5, release: 4, level: 0.07, vib: 6,
          },
          line: { level: 0.016, cutoff: 2200, osc: [{ type: "sine", detune: -3, level: 0.8 }, { type: "sine", detune: 4, level: 0.3 }] },
          vinyl: 0.3,
          mix: { kick: -6, snare: -6, hat: -6 },
          fx: { space: { size: 1.9, fb: 0.8, lp: 3000 }, master: { lp: 7500 } },
        },
      },
      // The gentle broken-down beat: a round soft kick, a brushed snare, a warm bass and a darker minor pad.
      {
        id: "hamster-nap-beat",
        name: "Nap Beat",
        base: "boc",
        bpm: [76, 84],
        swing: 0.62,
        microScale: 1.8,
        trim: 1.66,
        data: {
          chords: [
            { bass: 0, pad: [-12, 0, 7, 10, 15], glass: [0, 7, 12, 15, 24], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] },
            { bass: 5, pad: [-7, 5, 12, 15, 19], glass: [5, 12, 15, 19, 22], arp: [5, 10, 12, 15], sing: [10, 12, 7, 5, 15] },
            { bass: 3, pad: [-9, 3, 10, 15, 19], glass: [3, 10, 15, 19, 27], arp: [3, 7, 10, 15], sing: [7, 10, 5, 3, 12] },
            { bass: -2, pad: [-14, 5, 10, 14, 17], glass: [-2, 5, 10, 12, 19], arp: [-2, 3, 5, 10], sing: [3, 5, 12, 10, 7] },
          ],
          progressions: [
            [0, 0, 1, 1, 2, 2, 3, 3],
            [0, 1, 2, 3, 0, 2, 1, 3],
          ],
          phrases: [
            [[0, 1, 12, 0, 0], [24, 0, 8, 0, 1], [40, 2, 16, 0, 0], [64, 1, 12, 0, 0], [88, 0, 8, 0, 1], [104, 3, 20, 0, 0]],
            [[4, 0, 16, 0, 0], [32, 2, 12, 0, 0], [68, 1, 16, 0, 0], [96, 4, 8, 0, 1], [112, 0, 14, 0, 0]],
          ],
          tiers: [0.55, 0.88],
          notes: [0, 3, 7, 10],
          kit: {
            kick: { start: 66, end: 46, sweep: 0.1, decay: 0.3, click: 0, body: 0.8, drive: 0.3 },
            thump: 0.05,
            snare: [
              { tone: "triangle", freq: 140, to: 110, sweep: 0.05, decay: 0.09, level: 0.12 },
              { noise: "lowpass", freq: 1300, q: 0.5, decay: 0.2, level: 0.28 },
            ],
            dust: [{ noise: "lowpass", freq: 1000, q: 0.4, decay: 0.14, level: 0.1 }],
            ghost: [{ noise: "lowpass", freq: 1200, q: 0.5, decay: 0.05, level: 0.1 }],
            hat: { hp: 3500, decay: 0.018, metal: 0, level: 0.07 },
            open: { hp: 3500, decay: 0.03, metal: 0, level: 0.06 },
          },
          pad: { cutoff: 800, vib: 9, drive: 1.05, hp: 150, attack: 3, release: 3.5 },
          bass: { cutoff: 180, level: 0.07, sub: 0.07, osc: [{ type: "triangle", detune: -6, level: 0.8 }, { type: "sine", detune: 5, level: 0.4 }] },
          lead: { cutoff: 700, level: 0.09, vib: 8 },
          vinyl: 0.6,
          mix: { kick: -3, snare: -4, hat: -6 },
          fx: { drumLp: 2600, master: { lp: 6500 }, echoSend: { snare: 0.15, lead: 0.5 } },
        },
      },
      // Snow globe: a glassy shimmer bed in slow bloom, the arp twinkling in eighths far off, long room.
      {
        id: "hamster-snow-globe",
        name: "Snow Globe",
        base: "crystal",
        bpm: [80, 88],
        swing: 0.5,
        microScale: 0.4,
        trim: 0.85,
        data: {
          chords: [
            { bass: 3, pad: [-9, 3, 7, 10, 12], glass: [3, 10, 15, 19, 24], arp: [3, 7, 10, 15], sing: [7, 10, 17, 3, 12] },
            { bass: 0, pad: [-12, 0, 7, 10, 15], glass: [0, 7, 12, 15, 19], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] },
            { bass: -2, pad: [-14, 5, 10, 12, 19], glass: [-2, 5, 10, 12, 17], arp: [-2, 5, 10, 12], sing: [15, 17, 12, 10, 19] },
            { bass: 5, pad: [-7, 5, 10, 12, 15], glass: [5, 10, 12, 15, 22], arp: [5, 10, 12, 15], sing: [10, 12, 7, 5, 15] },
          ],
          progressions: [
            [0, 0, 1, 1, 2, 2, 3, 0],
            [0, 2, 1, 3, 0, 2, 3, 1],
          ],
          arps: [
            [0, 2, 1, 3, 2, 4, 3, 1],
            [3, 1, 2, 0, 1, 2],
          ],
          tiers: [0.2, 0.98],
          notes: [3, 7, 10, 12, 15],
          kit: {
            click: [{ tone: "sine", freq: 110, to: 60, sweep: 0.04, decay: 0.06, level: 0 }],
            rim: { level: 0, pitch: 1 },
            crack: { noise: "lowpass", freq: 1500, q: 0.5, decay: 0.02, level: 0 },
            tick: { noise: "lowpass", freq: 1500, q: 0.5, decay: 0.01, level: 0 },
            hat: { hp: 6000, decay: 0.01, metal: 0, level: 0 },
            open: { hp: 6000, decay: 0.01, metal: 0, level: 0 },
          },
          glass: {
            level: 0.14, cutoff: 2000, hp: 200, attack: 6, release: 6,
            partials: [
              { type: "sine", ratio: 1, detune: -5, level: 0.4 },
              { type: "sine", ratio: 1, detune: 6, level: 0.4 },
              { type: "sine", ratio: 2, detune: 9, level: 0.16 },
              { type: "sine", ratio: 3, detune: -4, level: 0.05 },
            ],
          },
          bell: { level: 0.03, ratio: 3.49, index: 1, decay: 3 },
          shimmer: { level: 0.07, decay: 0.9, short: 0.5, partials: [{ ratio: 1, detune: 0, level: 0.8 }, { ratio: 2, detune: 6, level: 0.18 }] },
          line: { level: 0.014, cutoff: 3000 },
          mix: { perc: -6, kick: -6, snare: -6, hat: -6 },
          fx: {
            echo: { steps: 3, taps: 6, fb: 0.5, lp: 2200, hp: 400 },
            space: { size: 2.4, fb: 0.84, lp: 3400 },
            master: { lp: 7500 },
          },
        },
      },
    ],
    drone: [
      // Rain on the window: a warm wall of soft triangles and filtered saws breathing over a still sine core, a soft
      // crackle like rain on glass, a little breath, rare bells.
      {
        id: "hamster-rain-wall",
        name: "Rain Wall",
        base: "classic",
        bpm: [52, 58],
        swing: 0.5,
        microScale: 1.5,
        trim: 2.6,
        data: {
          bars: 8,
          voicing: [0, 7, 12, 19],
          colours: [[0, 12, 19, 24], [-12, 7, 12, 19, 24]],
          busy: 24,
          glints: [12, 19, 24],
          wall: { waves: ["sawtooth", "triangle", "triangle"], detune: 4, spread: 2, cutoff: 480, glow: 200, range: 1.7, period: 30, depth: 0.2, drift: 4, core: [[-12, 0.2]] },
          glint: { level: 0.012, decay: 5, attack: 0.3, top: 2000, gap: 6 },
          breath: 0.03,
          swell: 0.03,
          vinyl: 0.55,
          fx: { master: { lp: 5200, hp: 36 } },
        },
      },
      // Cloud choir: wide detuned saws high up under a slow lowpass, deep breaths in the level, a big room.
      {
        id: "hamster-cloud-choir",
        name: "Cloud Choir",
        base: "classic",
        bpm: [44, 50],
        swing: 0.5,
        microScale: 1.5,
        trim: 2.3,
        data: {
          bars: 6,
          voicing: [12, 19, 24, 31],
          colours: [[7, 12, 19, 24, 31], [12, 24, 31, 36]],
          busy: 36,
          glints: [24, 31, 36],
          wall: { level: 0.05, waves: ["sawtooth"], detune: 10, spread: 4, cutoff: 700, glow: 250, range: 1.4, period: 44, depth: 0.4, drift: 8, core: [[0, 0.22], [-12, 0.12]] },
          glint: { level: 0.008, decay: 6, attack: 0.5, top: 2400, gap: 8 },
          breath: 0.012,
          swell: 0,
          mix: { harm: 2.5 },
          fx: { space: { size: 2.5, fb: 0.84, lp: 2800 }, master: { lp: 5500, hp: 35 } },
        },
      },
      // Burrow: Dark Low made warm. A soft sub bed an octave up, a hollow fifth, wide triangles, far wooden bowls.
      {
        id: "hamster-burrow",
        name: "Burrow",
        base: "dark",
        bpm: [40, 46],
        swing: 0.5,
        microScale: 2,
        trim: 1.8,
        data: {
          bars: 8,
          voicing: [24, 31, 36, 43],
          busy: 48,
          glints: [12, 19, 24],
          pad: { level: 0.05, waves: ["triangle", "triangle", "sine"], detune: 5, spread: 2, cutoff: 520, glow: 260, range: 1.6, period: 36 },
          bed: {
            subLevel: 0.03, bodyLevel: 0.07,
            subs: [[0, -5, 0.6], [0, 5, 0.6]],
            body: [[12, -3, 0.4], [19, 3, 0.36], [24, 0, 0.2]],
            beat: 0.35, drive: 0.6, cutoff: 420,
          },
          kick: { start: 55, end: 38, sweep: 0.9, decay: 1.2, click: 0, body: 0 },
          glint: { level: 0.018, decay: 6, attack: 0.3, top: 1600, gap: 6 },
          rumble: 0,
          mix: { kick: -6 },
          fx: { master: { hp: 36 } },
        },
      },
      // Overtone glow: the harmonic series with its soft third and upper partials, breathing slowly upwards.
      {
        id: "hamster-overtone-glow",
        name: "Overtone Glow",
        base: "pulse",
        bpm: [60, 66],
        swing: 0.5,
        microScale: 0.25,
        trim: 1.25,
        data: {
          bars: 4,
          glints: [6, 8, 10, 12],
          partials: [
            { n: 1, g: 0.36, group: 0 },
            { n: 2, g: 0.36, group: 0 },
            { n: 3, g: 0.26, group: 1 },
            { n: 4, g: 0.22, group: 1 },
            { n: 5, g: 0.14, group: 2 },
            { n: 6, g: 0.14, group: 2 },
            { n: 8, g: 0.07, group: 3 },
            { n: 10, g: 0.03, group: 3 },
          ],
          figures: [[0, 1, 0, 0, 1, 0]],
          overtone: { level: 0.2, cutoff: 1500, glow: 500, depths: [0.1, 0.6, 0.7, 0.75] },
          glint: { level: 0.011, decay: 4, attack: 0.15, top: 2800, gap: 5 },
          swell: 0.04,
          fx: { master: { lp: 6000, hp: 36 } },
        },
      },
      // Nest hum: a low warm hum of the first few partials, a long slow breath, deep and round, rare low glass.
      {
        id: "hamster-nest-hum",
        name: "Nest Hum",
        base: "pulse",
        bpm: [48, 54],
        swing: 0.5,
        microScale: 0.5,
        trim: 1.2,
        data: {
          bars: 8,
          glints: [3, 4, 6],
          partials: [
            { n: 1, g: 0.44, group: 0 },
            { n: 2, g: 0.36, group: 0 },
            { n: 3, g: 0.2, group: 1 },
            { n: 4, g: 0.14, group: 2 },
            { n: 6, g: 0.06, group: 2 },
          ],
          figures: [[0, 0, 1, 1]],
          overtone: { level: 0.22, cutoff: 650, glow: 200, depths: [0.05, 0.35, 0.45, 0.4] },
          glint: { level: 0.01, decay: 6, attack: 0.4, top: 1300, gap: 8 },
          swell: 0.035,
          fx: { master: { lp: 5000, hp: 38 } },
        },
      },
    ],
  },
  patches: {
    "hamster-celesta": {
      name: "Hamster Celesta",
      osc: [
        { type: "sine", detune: 0, oct: 0, level: 0.85 },
        { type: "sine", detune: 4, oct: 1, level: 0.18 },
        { type: "triangle", detune: -3, oct: 0, level: 0.15 },
      ],
      fm: { ratio: 4, index: 0.9, decay: 0.4, floor: 0.03 },
      filter: { type: "lowpass", cutoff: 2400, env: 600, decay: 0.3, q: 0.5 },
      amp: { a: 0.006, d: 1.6, s: 0.12, r: 1.2 },
      gain: 0.6,
    },
  },
} satisfies StationPack;
