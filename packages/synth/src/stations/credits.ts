import type { StationPack } from "../pack.ts";

// Credits Techno: dark dub techno only (Brickman's dark side, Elizar Pirogov, Deepchord / Basic Channel, Echospace).
// One cold chord held 16..32 bars: a low minor triad (the fifth under the root), the only movement a half step
// (i -> bII, phrygian) or an added b6. No major chord, no maj7/9 colour. A straight groove (swing 0.5, closed offbeat
// hats, a dry rim or none), a solid techno kick in front (a short pitch drop, a 1.5 kHz knock, the body at 45..55 Hz),
// Void's sub tone on the root under it, ducked around every kick and soft at the front (a 70 ms attack; the 16th
// rolls a quieter 30 ms one) so a sub note never reads as a second kick in the kick's own register, a resonant stab under a dark lowpass that plays
// rarely (`stabBars` rests it most bars) so the narrow echo (~450..1500 Hz, long tail) carries the space, a low drone
// kept down, and the kick's rumble room under the kick, not over it.
// Styles deep and hard in turn, each with its own groove (the sub's rhythm, `hats`, `claps`, `percs`): no two
// share drums and bass. Signature, Clearing and Provenance came from the Credits Lab pack (2026-10-26); Foil (an FM
// stab) and Letterpress (a struck resonator chord) from its second round (stabTone.engine), so ten in all.
// The first Credits Techno styles Debit and Margin are in the commit history; the dub house first pack is
// credits-dubhouse.ts (kept, on no station).
export default {
  key: "credits",
  name: "Credits Techno",
  genres: ["dubtechno"],
  styles: {
    dubtechno: [
      // Echospace night: a low minor triad with a b6 rubbing the fifth, a soft stab in three bars of eight into a
      // dotted-quarter echo, the long held offbeat sub, a dark saw drone under it, a dull low noise for air, one cold
      // far ping every eight phrases, a long rumble kept under the kick.
      {
        id: "credits-void",
        name: "Void",
        base: "ixtlan",
        bpm: [124, 124],
        swing: 0.5,
        microScale: 0.08,
        trim: 0.83,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-5, -4, 0, 3] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "turn", "i"] },
            { bars: 8, seq: ["i", "i", "i", "i"] },
          ],
          figures: [[3, 11], [6, 14], [2, 10]],
          accents: [0.9, 0.6],
          stabBars: [1, 0, 0, 0, 0.75, 0, 0, 0],
          bassline: [[2, 5.5, 1], [10, 5.5, 0.9]],
          bells: [[[38, 0, 0.8]]],
          kit: {
            kick: { center: 50, rise: 2.8, sweep: 0.035, hold: 0.09, decay: 0.42, drive: 2.2, lp: 420, click: 0.8, clickHz: 1500, level: 0.36 },
            clap: { level: 0 },
            hat: { off: 0.38, decay: 0.04, hp: 8400, metal: 0.1, shaker: 0 },
            perc: { level: 0 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: { wave: "sawtooth", detune: 5, lp: 460, env: 1.8, envTime: 0.2, q: 2.6, hp: 200, attack: 0.012, release: 0.4, gain: 0.75, pan: -0.08, move: 0.1, octave: 0 },
          padTone: { level: 0.9, wave: "sawtooth", detune: 7, octave: -12, lp: 280, attack: 6, release: 6 },
          bellTone: { level: 0.3, every: 8, ratio: 3.5, index: 0.6, decay: 1.4 },
          sweep: { stab: 32, echo: 32 },
          field: { level: 0.5, hz: 250 },
          rumble: { level: 0.8, lp: 150, decay: 2.2, duck: 0.85 },
          vinyl: 0.2,
          mix: { lead: -4, tex: -1 },
          fx: {
            echo: { steps: 6, taps: 12, fb: 0.74, lp: 1200, hp: 450 },
            echoSend: { harm: 0.9, snare: 0.4, perc: 0.4, lead: 0.7, fx: 1 },
            space: { size: 2.5, fb: 0.83, lp: 1600 },
            spaceSend: { harm: 0.55, tex: 0.65, lead: 0.6, snare: 0.3, hat: 0.1, perc: 0.2, kick: 0.03, fx: 0.5 },
            drumLp: 7000,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.3 },
            master: { lp: 6500 },
          },
        },
      },
      // The driving one (Elizar Pirogov): 127-128, a cold minor triad that turns phrygian, up a half step to bII minor
      // for eight bars, over a static root; a short resonant square stab in three bars of eight, a 16th sub roll, a dry
      // rim far down, a shaker on each beat's last 16th over a metallic offbeat hat, the hardest kick, the rumble
      // deep-ducked under it.
      {
        id: "credits-watermark",
        name: "Watermark",
        base: "moment",
        bpm: [127, 128],
        swing: 0.5,
        microScale: 0.04,
        trim: 0.87,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-4, 1, 4] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "turn", "i"] },
            { bars: 8, seq: ["i", "i", "i", "turn"] },
          ],
          figures: [[2, 10], [3, 11], [6, 14]],
          accents: [1, 0.6],
          stabBars: [1, 0, 0.7, 0, 0, 0, 0.85, 0],
          bassline: [[2, 1, 1], [3, 0.8, 0.65], [6, 1, 1], [7, 0.8, 0.65], [10, 1, 1], [11, 0.8, 0.65], [14, 1, 1], [15, 0.8, 0.65]],
          kit: {
            kick: { center: 52, rise: 3, sweep: 0.03, hold: 0.08, decay: 0.4, drive: 2.6, lp: 500, click: 0.8, clickHz: 1700, level: 0.37 },
            clap: { level: 0.4, hz: 1300, decay: 0.04, rim: true },
            hat: { off: 0.55, decay: 0.03, hp: 9000, metal: 0.32, shaker: 0.14, shakerDecay: 0.02, shuffle: [0, 0, 0, 1] },
            perc: { level: 0 },
          },
          subTone: { level: 0.4, octave: 0.05, lp: 180, attack: 0.03, release: 0.04, drive: 1.3 },
          stabTone: { wave: "square", detune: 3, lp: 640, env: 2.4, envTime: 0.09, q: 3.4, hp: 260, attack: 0.003, release: 0.18, gain: 0.8, pan: 0.06, move: 0.4, octave: 0 },
          padTone: { level: 0 },
          bellTone: { level: 0 },
          sweep: { stab: 24, echo: 16 },
          field: { level: 0 },
          rumble: { level: 0.9, lp: 200, decay: 1.3, duck: 0.95 },
          vinyl: 0.2,
          mix: { lead: -3, tex: -3 },
          fx: {
            echo: { steps: 3, taps: 11, fb: 0.72, lp: 1500, hp: 550 },
            echoSend: { harm: 0.85, snare: 0.4, perc: 0.4, lead: 0.5, fx: 1 },
            space: { size: 2, fb: 0.8, lp: 1800 },
            spaceSend: { harm: 0.35, tex: 0.5, lead: 0.4, snare: 0.25, hat: 0.06, perc: 0.15, kick: 0.03, fx: 0.35 },
            drumLp: 7500,
            duck: { bass: 0.2 },
            duckTime: { bass: 0.16 },
            master: { lp: 7000 },
          },
        },
      },
      // The deepest and emptiest (Void slowed): 122-123, the low minor triad held 24 bars before its b6, one soft stab
      // a phrase (a second, quieter, six bars later) into the longest dotted-quarter echo, one long sub note a bar, a
      // rounder kick, a quiet hat on two offbeats a bar and nothing else, the drone low and far, no bell.
      {
        id: "credits-null",
        name: "Null",
        base: "ixtlan",
        bpm: [122, 123],
        swing: 0.5,
        microScale: 0.08,
        trim: 0.85,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-5, -4, 0, 3] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "i", "turn"] },
            { bars: 8, seq: ["i", "i", "i", "i"] },
          ],
          figures: [[6], [3], [11]],
          accents: [0.9],
          stabBars: [1, 0, 0, 0, 0, 0, 0.6, 0],
          bassline: [[2, 12, 1]],
          hats: [[6, 1], [14, 1], [22, 1], [30, 1]],
          kit: {
            kick: { center: 48, rise: 2.6, sweep: 0.04, hold: 0.1, decay: 0.48, drive: 2, lp: 380, click: 0.7, clickHz: 1400, level: 0.36 },
            clap: { level: 0 },
            hat: { off: 0.26, decay: 0.04, hp: 8600, metal: 0.08, shaker: 0 },
            perc: { level: 0 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: { wave: "sawtooth", detune: 5, lp: 420, env: 1.8, envTime: 0.25, q: 2.8, hp: 200, attack: 0.015, release: 0.5, gain: 0.8, pan: -0.1, move: 0.1, octave: 0 },
          padTone: { level: 0.7, wave: "sawtooth", detune: 7, octave: -12, lp: 260, attack: 7, release: 6 },
          bellTone: { level: 0 },
          sweep: { stab: 32, echo: 32 },
          field: { level: 0.4, hz: 240 },
          rumble: { level: 0.7, lp: 140, decay: 2.6, duck: 0.85 },
          vinyl: 0.2,
          mix: { lead: -4, tex: -2 },
          fx: {
            echo: { steps: 6, taps: 12, fb: 0.75, lp: 1100, hp: 450 },
            echoSend: { harm: 0.95, snare: 0.4, perc: 0.4, lead: 0.7, fx: 1 },
            space: { size: 2.5, fb: 0.84, lp: 1500 },
            spaceSend: { harm: 0.6, tex: 0.65, lead: 0.6, snare: 0.3, hat: 0.1, perc: 0.2, kick: 0.03, fx: 0.5 },
            drumLp: 6500,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.3 },
            master: { lp: 6000 },
          },
        },
      },
      // A Prophet-ish stab: a detuned saw pair with a narrow pulse layered on each tone, the accents opening the
      // filter and the soft hits closing it; the level into the echo and its repeats breathe over 16 bars, so the
      // tail swells and thins on its own. The pad highpassed out of the kick. The driving groove: the sub on every
      // offbeat 8th, closed offbeat hats with an open one closing every second bar, a low rim on 2 and 4.
      {
        id: "credits-signature",
        name: "Signature",
        base: "ixtlan",
        bpm: [125, 126],
        swing: 0.5,
        microScale: 0.06,
        trim: 0.85,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-5, -4, 0, 3] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "turn", "i"] },
            { bars: 8, seq: ["i", "i", "i", "turn"] },
          ],
          figures: [[3, 10, 14], [2, 7, 11], [3, 11, 14]],
          accents: [1, 0.5, 0.75],
          stabBars: [1, 0, 0, 0.6, 0, 0, 0.85, 0],
          bassline: [[2, 1.6, 1], [6, 1.6, 0.85], [10, 1.6, 1], [14, 1.6, 0.85]],
          hats: [[2, 1], [6, 1], [10, 1], [14, 1], [18, 1], [22, 1], [26, 1], [30, 0.8, 0.22]],
          kit: {
            kick: { center: 50, rise: 2.8, sweep: 0.035, hold: 0.09, decay: 0.42, drive: 2.2, lp: 420, click: 0.8, clickHz: 1500, level: 0.36 },
            clap: { level: 0.22, hz: 1500, decay: 0.04, rim: true },
            hat: { off: 0.4, decay: 0.035, hp: 8600, metal: 0.12, shaker: 0 },
            perc: { level: 0 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: {
            wave: "sawtooth", detune: 7, lp: 620, env: 2.6, envTime: 0.13, q: 2.4, hp: 210, attack: 0.006, release: 0.34, gain: 0.7, pan: -0.06, move: 0.15, octave: 0,
            wave2: "pulse", width: 0.2, mix2: 0.8, octave2: 0, velLp: 0.85,
          },
          padTone: { level: 0.7, wave: "sawtooth", detune: 7, octave: -12, lp: 340, attack: 6, release: 6, hp: 170 },
          bellTone: { level: 0 },
          sweep: { stab: 32, echo: 24, send: 0.5, fb: 0.35, breath: 16 },
          field: { level: 0.4, hz: 250 },
          rumble: { level: 0.75, lp: 160, decay: 2, duck: 0.85 },
          vinyl: 0.2,
          mix: { lead: -4, tex: -2 },
          fx: {
            echo: { steps: 3, taps: 12, fb: 0.73, lp: 1500, hp: 480 },
            echoSend: { harm: 0.95, snare: 0.4, perc: 0.4, lead: 0.6, fx: 1 },
            space: { size: 2.3, fb: 0.82, lp: 1700 },
            spaceSend: { harm: 0.5, tex: 0.6, lead: 0.5, snare: 0.25, hat: 0.08, perc: 0.15, kick: 0.03, fx: 0.45 },
            drumLp: 7000,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.28 },
            master: { lp: 6800 },
          },
        },
      },
      // Rare synth notes floating over a minimal groove: a soft detuned triangle an octave over the stabs, one or two
      // notes in about half of the four-bar cells from the dark minor (root, minor third, fifth, flat seventh), a slow swell, held,
      // a long release into a dotted-quarter echo and the room. The stab plays once in sixteen bars, the drone under it.
      // The floating groove: long sub notes from the offbeats of 2 and 4, a soft straight 16th shaker under a quiet
      // offbeat hat, one perc knock in two bars.
      {
        id: "credits-provenance",
        name: "Provenance",
        base: "ixtlan",
        bpm: [121, 122],
        swing: 0.5,
        microScale: 0.08,
        trim: 0.77,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-5, -4, 0, 3] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "i", "turn"] },
            { bars: 8, seq: ["i", "i", "i", "i"] },
          ],
          figures: [[6], [3], [11]],
          accents: [0.7],
          stabBars: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          bassline: [[6, 6, 1], [14, 6, 0.85]],
          percs: [[27, 1.5, 0.7]],
          kit: {
            kick: { center: 48, rise: 2.6, sweep: 0.04, hold: 0.1, decay: 0.46, drive: 2, lp: 400, click: 0.7, clickHz: 1400, level: 0.36 },
            clap: { level: 0 },
            hat: { off: 0.24, decay: 0.035, hp: 8800, metal: 0.08, shaker: 0.16, shakerDecay: 0.03, shuffle: [0.55, 0.8, 0.65, 1] },
            perc: { level: 0.25, decay: 0.2 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: { wave: "sawtooth", detune: 5, lp: 420, env: 1.8, envTime: 0.25, q: 2.6, hp: 200, attack: 0.015, release: 0.5, gain: 0.7, pan: -0.1, move: 0.1, octave: 0 },
          padTone: { level: 0.8, wave: "sawtooth", detune: 7, octave: -12, lp: 300, attack: 7, release: 6, hp: 140 },
          bellTone: { level: 0 },
          melody: {
            level: 1.5, wave: "triangle", detune: 5, octave: 12, notes: [-2, 0, 3, 7, 10, 12], every: 4, count: 2, chance: 0.6,
            attack: 0.5, hold: 3, release: 3.5, lp: 1900, echo: 0.55, space: 0.6,
          },
          sweep: { stab: 32, echo: 32 },
          field: { level: 0.45, hz: 260 },
          rumble: { level: 0.7, lp: 150, decay: 2.4, duck: 0.85 },
          vinyl: 0.2,
          mix: { lead: 0, tex: -1 },
          fx: {
            echo: { steps: 6, taps: 12, fb: 0.72, lp: 1500, hp: 420 },
            echoSend: { harm: 0.9, snare: 0.4, perc: 0.4, lead: 0.5, fx: 1 },
            space: { size: 2.5, fb: 0.83, lp: 1800 },
            spaceSend: { harm: 0.55, tex: 0.65, lead: 0.55, snare: 0.3, hat: 0.1, perc: 0.2, kick: 0.03, fx: 0.5 },
            drumLp: 6500,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.3 },
            master: { lp: 6500 },
          },
        },
      },
      // Void driven harder, phrygian: 126-127, the minor triad up a half step to bII minor for eight bars over the
      // static root; a brighter resonant stab in two bars of eight (its answer a bar before the phrase turns), a
      // syncopated sub with ghost 16ths, a tuned perc on 7 and 15, a hard kick with a dry rim on 2 and 4, a shorter
      // rumble deep-ducked.
      {
        id: "credits-escrow",
        name: "Escrow",
        base: "ixtlan",
        bpm: [126, 127],
        swing: 0.5,
        microScale: 0.05,
        trim: 0.87,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-4, 1, 4] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "turn", "i"] },
            { bars: 8, seq: ["i", "i", "i", "turn"] },
          ],
          figures: [[2, 10], [3, 11], [3, 14]],
          accents: [1, 0.6],
          stabBars: [1, 0, 0, 0, 0.8, 0, 0, 0.55],
          bassline: [[2, 3.5, 1], [7, 0.75, 0.5], [10, 2, 0.95], [13, 1, 0.7], [15, 0.75, 0.45]],
          percs: [[7, 1, 1], [15, 1.5, 0.7], [23, 1, 0.9], [31, 1.5, 0.6]],
          kit: {
            kick: { center: 52, rise: 3, sweep: 0.03, hold: 0.08, decay: 0.4, drive: 2.6, lp: 500, click: 0.8, clickHz: 1700, level: 0.37 },
            clap: { level: 0.35, hz: 1400, decay: 0.04, rim: true },
            hat: { off: 0.45, decay: 0.032, hp: 8800, metal: 0.15, shaker: 0 },
            perc: { level: 0.3, decay: 0.08 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: { wave: "sawtooth", detune: 4, lp: 540, env: 2.2, envTime: 0.12, q: 3.2, hp: 230, attack: 0.006, release: 0.3, gain: 0.8, pan: 0.06, move: 0.3, octave: 0 },
          padTone: { level: 0.6, wave: "sawtooth", detune: 6, octave: -12, lp: 300, attack: 5, release: 5 },
          bellTone: { level: 0 },
          sweep: { stab: 16, echo: 24 },
          field: { level: 0 },
          rumble: { level: 0.8, lp: 180, decay: 1.4, duck: 0.9 },
          vinyl: 0.2,
          mix: { lead: -3, tex: -2 },
          fx: {
            echo: { steps: 3, taps: 12, fb: 0.73, lp: 1400, hp: 520 },
            echoSend: { harm: 0.9, snare: 0.4, perc: 0.4, lead: 0.5, fx: 1 },
            space: { size: 2.2, fb: 0.82, lp: 1700 },
            spaceSend: { harm: 0.45, tex: 0.55, lead: 0.5, snare: 0.25, hat: 0.08, perc: 0.15, kick: 0.03, fx: 0.4 },
            drumLp: 7500,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.28 },
            master: { lp: 7000 },
          },
        },
      },
      // A different delay: a quarter on the left answered by a dotted eighth on the right (fx.echo.steps 4, echoTone.alt
      // 3), wide, with a slow tape wobble on every repeat; one short dry stab every few bars throws it, the long tail
      // carries the space, darker and thinner with every repeat. The groove talks to it: a dotted (3/16) sub, a perc
      // knock on the echo's grid, the rim on the 4 only.
      {
        id: "credits-clearing",
        name: "Clearing",
        base: "ixtlan",
        bpm: [123, 124],
        swing: 0.5,
        microScale: 0.07,
        trim: 0.85,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-4, 1, 4] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "turn", "i"] },
            { bars: 8, seq: ["i", "i", "i", "i"] },
          ],
          figures: [[6], [3], [11]],
          accents: [0.95],
          stabBars: [1, 0, 0, 0, 0, 0.7, 0, 0],
          bassline: [[2, 2.5, 1], [5, 2.5, 0.8], [11, 2.5, 0.9], [14, 1.5, 0.7]],
          percs: [[3, 1, 1], [22, 1.5, 0.7]],
          claps: [[12, 1], [28, 1]],
          kit: {
            kick: { center: 50, rise: 2.8, sweep: 0.035, hold: 0.09, decay: 0.42, drive: 2.2, lp: 420, click: 0.8, clickHz: 1500, level: 0.36 },
            clap: { level: 0.34, hz: 1350, decay: 0.04, rim: true },
            hat: { off: 0.4, decay: 0.035, hp: 8800, metal: 0.12, shaker: 0 },
            perc: { level: 0.28, decay: 0.1 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: { wave: "sawtooth", detune: 5, lp: 520, env: 2.2, envTime: 0.12, q: 2.8, hp: 230, attack: 0.005, release: 0.22, gain: 0.85, pan: 0, move: 0.15, octave: 0 },
          padTone: { level: 0.55, wave: "sawtooth", detune: 6, octave: -12, lp: 300, attack: 6, release: 6, hp: 150 },
          bellTone: { level: 0 },
          sweep: { stab: 32, echo: 32 },
          field: { level: 0.35, hz: 240 },
          rumble: { level: 0.7, lp: 160, decay: 1.8, duck: 0.9 },
          echoTone: { width: 0.9, alt: 3, wobble: 0.5, rate: 0.3 },
          vinyl: 0.2,
          mix: { lead: -4, tex: -2 },
          fx: {
            echo: { steps: 4, taps: 12, fb: 0.72, lp: 1300, hp: 460 },
            echoSend: { harm: 1, snare: 0.5, perc: 0.4, lead: 0.6, fx: 1 },
            space: { size: 2.2, fb: 0.8, lp: 1600 },
            spaceSend: { harm: 0.4, tex: 0.55, lead: 0.5, snare: 0.2, hat: 0.08, perc: 0.15, kick: 0.03, fx: 0.4 },
            drumLp: 7000,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.3 },
            master: { lp: 6500 },
          },
        },
      },
      // The hypnotic one: 124-125, the minor triad (on some nights a b6 in the last eight of 32 bars), a single stab on
      // the same 16th every other bar (the second softer) answered by a long dotted-eighth echo, Void's sub tone
      // rolling every 16th off the kick, accented 3+3+2 (3, 6, 11, 14), no drone, a short rumble that pulses between
      // the kicks.
      {
        id: "credits-redacted",
        name: "Redacted",
        base: "ixtlan",
        bpm: [124, 125],
        swing: 0.5,
        microScale: 0.06,
        trim: 0.88,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-5, -4, 0, 3] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "i", "i"] },
            { bars: 8, seq: ["i", "i", "i", "turn"] },
          ],
          figures: [[6], [3], [11]],
          accents: [0.95],
          stabBars: [1, 0, 0.65, 0],
          bassline: [
            [1, 0.8, 0.45], [2, 0.8, 0.6], [3, 0.9, 1], [5, 0.8, 0.5], [6, 0.9, 1], [7, 0.8, 0.55],
            [9, 0.8, 0.45], [10, 0.8, 0.6], [11, 0.9, 1], [13, 0.8, 0.5], [14, 0.9, 1], [15, 0.8, 0.55],
          ],
          kit: {
            kick: { center: 50, rise: 2.8, sweep: 0.035, hold: 0.09, decay: 0.42, drive: 2.2, lp: 420, click: 0.8, clickHz: 1500, level: 0.36 },
            clap: { level: 0 },
            hat: { off: 0.42, decay: 0.035, hp: 8800, metal: 0.12, shaker: 0 },
            perc: { level: 0 },
          },
          subTone: { level: 0.5, octave: 0.03, lp: 150, attack: 0.03, release: 0.05, drive: 1 },
          stabTone: { wave: "sawtooth", detune: 5, lp: 480, env: 2, envTime: 0.15, q: 3, hp: 220, attack: 0.008, release: 0.35, gain: 0.8, pan: 0.1, move: 0.2, octave: 0 },
          padTone: { level: 0 },
          bellTone: { level: 0 },
          sweep: { stab: 32, echo: 16 },
          field: { level: 0.3, hz: 260 },
          rumble: { level: 0.6, lp: 180, decay: 0.9, duck: 0.95 },
          vinyl: 0.2,
          mix: { lead: -4, tex: -2 },
          fx: {
            echo: { steps: 3, taps: 12, fb: 0.75, lp: 1300, hp: 500 },
            echoSend: { harm: 0.95, snare: 0.4, perc: 0.4, lead: 0.6, fx: 1 },
            space: { size: 2.2, fb: 0.82, lp: 1600 },
            spaceSend: { harm: 0.5, tex: 0.55, lead: 0.5, snare: 0.25, hat: 0.08, perc: 0.15, kick: 0.03, fx: 0.45 },
            drumLp: 7000,
            duck: { bass: 0.2 },
            duckTime: { bass: 0.16 },
            master: { lp: 6500 },
          },
        },
      },
      // Metallic Echospace stabs: per chord tone an FM pair (3 cents apart) whose index falls in 0.2 s, with a 7:1 ping
      // that dies in 60 ms, so every hit is a metal tick that settles into a dark, soft chord the echo carries; harder
      // hits ring brighter. The turn: the fifth up a half step to the b6 for eight bars (Void's move, over the same
      // sub root, in the key). The groove: the sub held from the "a" of 1 and of 3 with a ghost on the "a" of 2 and 4,
      // a closed hat pair on the offbeats, a rim on the 4 and on the "a" of 3 in the second bar.
      {
        id: "credits-foil",
        name: "Foil",
        base: "ixtlan",
        bpm: [126, 126],
        swing: 0.5,
        microScale: 0.05,
        trim: 0.83,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-4, 0, 3] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "turn", "i"] },
            { bars: 8, seq: ["i", "i", "i", "turn"] },
          ],
          figures: [[3, 10], [2, 11], [6, 14]],
          accents: [1, 0.65],
          stabBars: [1, 0, 0, 0.7, 0, 0, 0, 0],
          bassline: [[3, 3, 1], [7, 0.75, 0.5], [11, 3, 0.95], [15, 0.75, 0.5]],
          hats: [[2, 1], [3, 0.4], [6, 0.8], [10, 1], [11, 0.4], [14, 0.8], [18, 1], [19, 0.4], [22, 0.8], [26, 1], [27, 0.4], [30, 0.7, 0.16]],
          claps: [[12, 1], [27, 0.6]],
          kit: {
            kick: { center: 50, rise: 2.8, sweep: 0.035, hold: 0.09, decay: 0.42, drive: 2.2, lp: 420, click: 0.8, clickHz: 1500, level: 0.36 },
            clap: { level: 0.3, hz: 1500, decay: 0.04, rim: true },
            hat: { off: 0.4, decay: 0.03, hp: 8800, metal: 0.2, shaker: 0 },
            perc: { level: 0 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: {
            engine: "fm", wave: "sine", detune: 3, lp: 1300, env: 1.6, envTime: 0.12, q: 1.2, hp: 200, attack: 0.003, release: 0.45, gain: 0.75,
            pan: -0.05, move: 0.2, octave: 0, velLp: 0.4,
            fm: { ratio: 1, index: 1.6, floor: 0.3, decay: 0.22, ratio2: 7, index2: 1.4, decay2: 0.06, vel: 0.7 },
          },
          padTone: { level: 0.6, wave: "sawtooth", detune: 6, octave: -12, lp: 280, attack: 6, release: 6, hp: 150 },
          bellTone: { level: 0 },
          sweep: { stab: 24, echo: 24 },
          field: { level: 0.3, hz: 250 },
          rumble: { level: 0.8, lp: 160, decay: 1.8, duck: 0.9 },
          echoTone: { width: 0.7, alt: 0, wobble: 0, rate: 0.4 },
          vinyl: 0.2,
          mix: { lead: -4, tex: -2 },
          fx: {
            echo: { steps: 3, taps: 12, fb: 0.72, lp: 1500, hp: 500 },
            echoSend: { harm: 0.9, snare: 0.4, perc: 0.4, lead: 0.6, fx: 1 },
            space: { size: 2.2, fb: 0.82, lp: 1700 },
            spaceSend: { harm: 0.45, tex: 0.55, lead: 0.5, snare: 0.25, hat: 0.08, perc: 0.15, kick: 0.03, fx: 0.45 },
            drumLp: 7000,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.28 },
            master: { lp: 6800 },
          },
        },
      },
      // A struck chord: a hard mallet on a marimba bar's two whole modes (1 and 4, two octaves) per chord tone, the
      // upper one gone in a third of a second, the fundamental ringing 1.4 s into a wide dotted-quarter echo; woody,
      // Rhythm & Sound dark. The highpass sits under the lowest tone so the fundamental carries the pitch.
      // The minor triad and a quartal sus (fifth, root, fourth). The groove: the sub short on the offbeat then long
      // from the "a" of 2, a wooden perc on the "e" of 2 and 4, a soft hat on the offbeats of 1 and 3 that opens at
      // the end of the second bar, no clap.
      {
        id: "credits-letterpress",
        name: "Letterpress",
        base: "ixtlan",
        bpm: [123, 123],
        swing: 0.5,
        microScale: 0.07,
        trim: 0.85,
        data: {
          chords: {
            i: { root: 0, upper: [-5, 0, 3] },
            turn: { root: 0, upper: [-5, 0, 5] },
          },
          progressions: [
            { bars: 8, seq: ["i", "i", "turn", "i"] },
            { bars: 8, seq: ["i", "turn", "i", "i"] },
          ],
          figures: [[2, 7], [3, 10], [6, 11]],
          accents: [1, 0.7],
          stabBars: [1, 0, 0, 0, 0.8, 0, 0.6, 0],
          bassline: [[2, 1, 1], [7, 2.5, 0.85], [10, 1, 0.9], [15, 1, 0.6]],
          percs: [[5, 1, 0.8], [13, 1.5, 0.6], [21, 1, 0.7], [29, 1.5, 0.5]],
          hats: [[2, 0.8], [10, 1], [18, 0.8], [26, 1], [30, 0.6, 0.2]],
          kit: {
            kick: { center: 50, rise: 2.8, sweep: 0.035, hold: 0.09, decay: 0.42, drive: 2.2, lp: 420, click: 0.8, clickHz: 1500, level: 0.36 },
            clap: { level: 0 },
            hat: { off: 0.36, decay: 0.035, hp: 8600, metal: 0.08, shaker: 0 },
            perc: { level: 0.28, decay: 0.07 },
          },
          subTone: { level: 0.64, octave: 0.03, lp: 150, attack: 0.07, release: 0.2, drive: 1 },
          stabTone: {
            engine: "pluck", wave: "sine", detune: 0, lp: 1600, env: 1.2, envTime: 0.1, q: 0.8, hp: 110, attack: 0.002, release: 1.2, gain: 0.8,
            pan: 0.06, move: 0.15, octave: 0, velLp: 0.3,
            pluck: { modes: [1, 4], decay: 1.4, damp: 1.1, tone: 3500, burst: 0.0006, vel: 0.7 },
          },
          padTone: { level: 0.6, wave: "sawtooth", detune: 7, octave: -12, lp: 280, attack: 7, release: 6, hp: 150 },
          bellTone: { level: 0 },
          sweep: { stab: 32, echo: 32 },
          field: { level: 0.35, hz: 240 },
          rumble: { level: 0.75, lp: 150, decay: 2.2, duck: 0.85 },
          echoTone: { width: 0.8, alt: 0, wobble: 0, rate: 0.4 },
          vinyl: 0.2,
          mix: { lead: -4, tex: -2 },
          fx: {
            echo: { steps: 6, taps: 12, fb: 0.72, lp: 1300, hp: 420 },
            echoSend: { harm: 0.9, snare: 0.4, perc: 0.45, lead: 0.6, fx: 1 },
            space: { size: 2.4, fb: 0.83, lp: 1600 },
            spaceSend: { harm: 0.5, tex: 0.6, lead: 0.55, snare: 0.3, hat: 0.1, perc: 0.2, kick: 0.03, fx: 0.5 },
            drumLp: 6800,
            duck: { bass: 0.15 },
            duckTime: { bass: 0.3 },
            master: { lp: 6500 },
          },
        },
      },
    ],
  },
} satisfies StationPack;
