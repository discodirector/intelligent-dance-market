import { hash32 } from "./hash.ts";

/**
 * SPEC §4.5. Lead patches for the motif. A genre that wants melody owns up to three; the epoch picks one.
 * All parameters are fixed data: the voice is deterministic for a given patch, note and time.
 */
export interface LeadPatch {
  id: string;
  name: string;
  /** Oscillator stack. `pulse25` / `pulse12` are narrow pulse waves. Octave is relative to the motif note. */
  osc: { type: OscillatorType | "pulse25" | "pulse12"; detune: number; oct: number; level: number }[];
  /** Sine modulator on every oscillator's frequency: ratio to the note, peak index, index decay (s). */
  fm?: { ratio: number; index: number; decay: number; floor: number };
  /** Lowpass/bandpass with its own envelope: cutoff Hz, extra Hz at the attack, decay s, Q. */
  filter: { type: BiquadFilterType; cutoff: number; env: number; decay: number; q: number };
  /** Two parallel bandpass formants (vowel) instead of the filter. */
  formants?: [number, number];
  amp: { a: number; d: number; s: number; r: number };
  /** Vibrato: rate Hz, depth cents, fade-in delay s. */
  vib?: { rate: number; depth: number; delay: number };
  /** Portamento from the previous motif note, seconds. */
  glide?: number;
  /** Attack pitch flick in semitones, settling in 40 ms. */
  blip?: number;
  /** Breath / bow noise level. */
  noise?: number;
  /** tanh drive amount before the filter. */
  drive?: number;
  gain: number;
}

export const LEAD_PATCHES: Record<string, LeadPatch> = {
  supersaw: {
    id: "supersaw", name: "Supersaw",
    osc: [
      { type: "sawtooth", detune: -16, oct: 0, level: 0.55 },
      { type: "sawtooth", detune: -6, oct: 0, level: 0.7 },
      { type: "sawtooth", detune: 7, oct: 0, level: 0.7 },
      { type: "sawtooth", detune: 17, oct: 0, level: 0.55 },
      { type: "square", detune: 0, oct: -1, level: 0.35 },
    ],
    filter: { type: "lowpass", cutoff: 1500, env: 3200, decay: 0.35, q: 2.2 },
    amp: { a: 0.012, d: 0.3, s: 0.65, r: 0.3 },
    vib: { rate: 5.2, depth: 14, delay: 0.25 },
    gain: 0.5,
  },
  reese: {
    id: "reese", name: "Reese",
    osc: [
      { type: "sawtooth", detune: -24, oct: 0, level: 0.8 },
      { type: "sawtooth", detune: 22, oct: 0, level: 0.8 },
      { type: "sine", detune: 0, oct: -1, level: 0.5 },
    ],
    filter: { type: "lowpass", cutoff: 700, env: 1300, decay: 0.5, q: 3.5 },
    amp: { a: 0.03, d: 0.4, s: 0.75, r: 0.35 },
    glide: 0.07,
    drive: 2.2,
    gain: 0.55,
  },
  pwm: {
    id: "pwm", name: "PWM Lead",
    osc: [
      { type: "pulse25", detune: -5, oct: 0, level: 0.7 },
      { type: "pulse12", detune: 6, oct: 0, level: 0.55 },
    ],
    filter: { type: "lowpass", cutoff: 2200, env: 2400, decay: 0.25, q: 1.5 },
    amp: { a: 0.006, d: 0.22, s: 0.55, r: 0.2 },
    vib: { rate: 6, depth: 18, delay: 0.18 },
    gain: 0.7,
  },
  rhodes: {
    id: "rhodes", name: "FM Electric Piano",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.9 },
      { type: "sine", detune: 4, oct: 1, level: 0.18 },
    ],
    fm: { ratio: 1, index: 3.2, decay: 0.7, floor: 0.35 },
    filter: { type: "lowpass", cutoff: 3800, env: 1500, decay: 0.4, q: 0.7 },
    amp: { a: 0.003, d: 1.1, s: 0.25, r: 0.5 },
    vib: { rate: 4.4, depth: 6, delay: 0.3 },
    drive: 1.4,
    gain: 0.6,
  },
  flute: {
    id: "flute", name: "Tape Flute",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.9 },
      { type: "triangle", detune: 3, oct: 1, level: 0.12 },
    ],
    filter: { type: "lowpass", cutoff: 2600, env: 600, decay: 0.3, q: 0.8 },
    amp: { a: 0.07, d: 0.3, s: 0.8, r: 0.35 },
    vib: { rate: 4.8, depth: 22, delay: 0.2 },
    noise: 0.12,
    gain: 0.75,
  },
  pluck: {
    id: "pluck", name: "Pluck",
    osc: [
      { type: "sawtooth", detune: -4, oct: 0, level: 0.7 },
      { type: "square", detune: 5, oct: 0, level: 0.45 },
    ],
    filter: { type: "lowpass", cutoff: 500, env: 4800, decay: 0.12, q: 4 },
    amp: { a: 0.002, d: 0.32, s: 0.08, r: 0.18 },
    gain: 0.75,
  },
  acid: {
    id: "acid", name: "Acid Lead",
    osc: [{ type: "sawtooth", detune: 0, oct: 0, level: 1 }],
    filter: { type: "lowpass", cutoff: 380, env: 3400, decay: 0.16, q: 13 },
    amp: { a: 0.004, d: 0.25, s: 0.6, r: 0.12 },
    glide: 0.06,
    drive: 2.6,
    gain: 0.5,
  },
  warmkeys: {
    id: "warmkeys", name: "Warm Keys",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.9 },
      { type: "triangle", detune: -5, oct: 0, level: 0.3 },
      { type: "sine", detune: 3, oct: -1, level: 0.25 },
    ],
    fm: { ratio: 1, index: 0.9, decay: 0.25, floor: 0.12 },
    filter: { type: "lowpass", cutoff: 1500, env: 700, decay: 0.3, q: 0.6 },
    amp: { a: 0.006, d: 1.3, s: 0.35, r: 0.7 },
    vib: { rate: 5.2, depth: 5, delay: 0.1 },
    gain: 0.75,
  },
  mellow: {
    id: "mellow", name: "Mellow Lead",
    osc: [
      { type: "triangle", detune: -6, oct: 0, level: 0.7 },
      { type: "triangle", detune: 6, oct: 0, level: 0.7 },
      { type: "sine", detune: 0, oct: -1, level: 0.3 },
    ],
    filter: { type: "lowpass", cutoff: 1300, env: 500, decay: 0.5, q: 0.7 },
    amp: { a: 0.045, d: 0.8, s: 0.55, r: 0.8 },
    vib: { rate: 4.6, depth: 9, delay: 0.25 },
    gain: 0.8,
  },
  bell: {
    id: "bell", name: "Glass Bell",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.8 },
      { type: "sine", detune: 7, oct: 0, level: 0.5 },
    ],
    fm: { ratio: 3.5, index: 5.5, decay: 1.4, floor: 0.08 },
    filter: { type: "lowpass", cutoff: 7000, env: 0, decay: 0.2, q: 0.5 },
    amp: { a: 0.002, d: 1.6, s: 0.15, r: 0.9 },
    gain: 0.6,
  },
  vox: {
    id: "vox", name: "Formant Vox",
    osc: [
      { type: "sawtooth", detune: -8, oct: 0, level: 0.75 },
      { type: "sawtooth", detune: 9, oct: 0, level: 0.75 },
    ],
    formants: [720, 1150],
    filter: { type: "lowpass", cutoff: 4000, env: 0, decay: 0.2, q: 0.6 },
    amp: { a: 0.08, d: 0.4, s: 0.85, r: 0.4 },
    vib: { rate: 5.3, depth: 16, delay: 0.25 },
    noise: 0.05,
    gain: 1.2,
  },
  melodica: {
    id: "melodica", name: "Melodica",
    osc: [
      { type: "square", detune: 0, oct: 0, level: 0.6 },
      { type: "sawtooth", detune: 5, oct: 0, level: 0.4 },
    ],
    filter: { type: "bandpass", cutoff: 1300, env: 500, decay: 0.2, q: 1.1 },
    amp: { a: 0.035, d: 0.25, s: 0.85, r: 0.25 },
    vib: { rate: 5.6, depth: 12, delay: 0.3 },
    noise: 0.09,
    gain: 1.1,
  },
  chip: {
    id: "chip", name: "Chip Pulse",
    osc: [{ type: "pulse12", detune: 0, oct: 0, level: 0.9 }],
    filter: { type: "lowpass", cutoff: 9000, env: 0, decay: 0.1, q: 0.5 },
    amp: { a: 0.002, d: 0.08, s: 0.7, r: 0.06 },
    vib: { rate: 7, depth: 30, delay: 0.12 },
    blip: 12,
    gain: 0.6,
  },
  bowed: {
    id: "bowed", name: "Bowed Drone",
    osc: [
      { type: "sawtooth", detune: -10, oct: 0, level: 0.6 },
      { type: "sawtooth", detune: 11, oct: -1, level: 0.5 },
    ],
    filter: { type: "bandpass", cutoff: 900, env: 400, decay: 0.8, q: 1.6 },
    amp: { a: 0.18, d: 0.5, s: 0.85, r: 0.6 },
    vib: { rate: 4.2, depth: 10, delay: 0.4 },
    noise: 0.14,
    drive: 1.6,
    gain: 0.85,
  },
  garagepan: {
    // Jamie xx: a soft steel pan, octave partial and a quick FM bloom.
    id: "garagepan", name: "Steel Pan",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.8 },
      { type: "sine", detune: 4, oct: 1, level: 0.28 },
    ],
    fm: { ratio: 2, index: 1.1, decay: 0.14, floor: 0.12 },
    filter: { type: "lowpass", cutoff: 4200, env: 0, decay: 0.2, q: 0.5 },
    amp: { a: 0.004, d: 0.32, s: 0.18, r: 0.55 },
    gain: 0.75,
  },
  /** Soulful liquid Rhodes: a soft tine bark into a clean sine, the octave in tune, no drive, for full voicings. */
  liquidRhodes: {
    id: "liquidRhodes", name: "Soul Rhodes",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.9 },
      { type: "sine", detune: 0, oct: 1, level: 0.1 },
      { type: "triangle", detune: -3, oct: 0, level: 0.12 },
    ],
    fm: { ratio: 1, index: 1.8, decay: 0.3, floor: 0.08 },
    filter: { type: "lowpass", cutoff: 1900, env: 1200, decay: 0.3, q: 0.5 },
    amp: { a: 0.004, d: 1.6, s: 0.32, r: 0.6 },
    gain: 0.8,
  },
  /**
   * Rhodes Break: a warm tine piano. A short FM bark at the attack falling to an almost pure sine, the octave
   * partial exactly in tune, no vibrato and no drive, so a four-note voicing stays clean and in tune.
   */
  triphop_rhodes: {
    id: "triphop_rhodes", name: "Warm Tine Rhodes",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.9 },
      { type: "sine", detune: 0, oct: 1, level: 0.12 },
    ],
    fm: { ratio: 1, index: 1.5, decay: 0.22, floor: 0.06 },
    filter: { type: "lowpass", cutoff: 2100, env: 1500, decay: 0.3, q: 0.5 },
    amp: { a: 0.004, d: 1.4, s: 0.34, r: 0.28 },
    gain: 0.84,
  },
  triphop_theremin: {
    id: "triphop_theremin", name: "Bristol Sine Ghost",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 1 },
      { type: "triangle", detune: 3, oct: 0, level: 0.12 },
    ],
    filter: { type: "lowpass", cutoff: 1500, env: 350, decay: 0.7, q: 0.65 },
    amp: { a: 0.11, d: 0.3, s: 0.7, r: 0.55 },
    vib: { rate: 5.1, depth: 34, delay: 0.12 },
    glide: 0.13,
    gain: 1.15,
  },
  triphop_piano: {
    id: "triphop_piano", name: "Cinema Felt Piano",
    osc: [
      { type: "sine", detune: -2, oct: 0, level: 0.9 },
      { type: "triangle", detune: 2, oct: 0, level: 0.22 },
      { type: "sine", detune: 3, oct: 1, level: 0.28 },
    ],
    fm: { ratio: 1, index: 0.85, decay: 0.12, floor: 0.02 },
    filter: { type: "lowpass", cutoff: 2400, env: 2800, decay: 0.16, q: 0.6 },
    amp: { a: 0.004, d: 0.18, s: 0.28, r: 0.7 },
    drive: 1.15,
    gain: 0.95,
  },
  /** Lofi House "rave": an M1-style house piano, bright hammer, fast-falling FM, a little tape crunch. */
  lofihouse_m1: {
    id: "lofihouse_m1", name: "Rave Piano",
    osc: [
      { type: "triangle", detune: 0, oct: 0, level: 0.8 },
      { type: "sawtooth", detune: 6, oct: 0, level: 0.22 },
      { type: "sine", detune: -4, oct: 1, level: 0.35 },
    ],
    fm: { ratio: 2, index: 2.2, decay: 0.12, floor: 0.08 },
    filter: { type: "lowpass", cutoff: 2400, env: 4200, decay: 0.18, q: 0.9 },
    amp: { a: 0.002, d: 0.42, s: 0.16, r: 0.16 },
    drive: 1.5,
    gain: 0.7,
  },
  "ambientidm-glass": {
    id: "ambientidm-glass", name: "Crystal Bell",
    osc: [
      { type: "sine", detune: 0, oct: 0, level: 0.82 },
      { type: "sine", detune: 8, oct: 1, level: 0.3 },
      { type: "sine", detune: -5, oct: 2, level: 0.06 },
    ],
    fm: { ratio: 3.49, index: 4.1, decay: 0.85, floor: 0.05 },
    filter: { type: "lowpass", cutoff: 6800, env: 2400, decay: 0.26, q: 0.45 },
    amp: { a: 0.004, d: 1.2, s: 0.07, r: 0.75 },
    gain: 0.48,
  },
};

/**
 * Lead patches per genre. Only genres that want melody play them: Ambient IDM (its one melody), Electro (cold
 * sparse stabs), Liquid DnB and Lofi House (keys) and Future Garage Rain Atmos (its steel pan, a style lead). Future
 * Garage's vocal chops are their own voice in engine.ts. The others never call the motif; their lists only serve the lead gallery.
 */
const ERA_LEADS: Record<string, string[]> = {
  ambientidm: ["rhodes", "flute", "bell"],
  electro: ["bell", "pwm", "pluck"],
  dubtechno: ["rhodes"],
  acid: ["acid"],
  drone: ["bowed"],
  liquid: ["warmkeys", "mellow"],
  futuregarage: ["vox"],
  triphop: ["rhodes"],
  lofihouse: ["warmkeys"],
  wonky: ["bell"],
};

/** The motif's patch for this genre and epoch. */
export function leadPatch(eraId: string, epoch: number, styleLeads?: readonly string[]): LeadPatch {
  const list = styleLeads ?? ERA_LEADS[eraId] ?? ["rhodes"];
  return LEAD_PATCHES[list[hash32(epoch >>> 0, 0x1ead) % list.length]];
}
