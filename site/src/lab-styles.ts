// The style lab's data side (lab.html, lab.ts): the genres it opens, their presets, knobs, macros and choices, each a
// real style data field (synth styledata.ts) clamped to its range and to the taste rules of stations/README.md.
// What the lab holds is a Recipe (lab-codec.ts: preset id, knob values, choice ids, a riff grid, chord picks, a name),
// never a style: buildStyle rebuilds the style from the preset and those values every time, so a style can only be one
// the controls can reach. A built style is a one-style station pack in the making (packOf, packSource).
import type { Take } from "./lab-take";
import { eraOf, PACKS, PARTS, programFromPack, SOUND_DEFAULTS, styleFeel, validatePack, type DataGenre, type GenreStyle, type PackLeadPatch, type Part, type StationPack, type StationStyle } from "@swarm-sequencer/synth";

export type LabGenre = "acid" | "ambientidm" | "dubtechno" | "dubhouse" | "electro" | "liquid";
/**
 * The engine genre a lab genre plays: each is itself, except Dub House, a lab tab of its own (its own presets, knobs
 * and id in the recipe) that is the dubtechno genre in the engine and in the packs it exports.
 */
export const engineOf = (g: LabGenre): DataGenre => (g === "dubhouse" ? "dubtechno" : g);
type Obj = Record<string, any>;

/** A style being built: the genre, the style (data only) and the lead patches its preset brought. */
export interface Draft {
  genre: LabGenre;
  style: StationStyle;
  patches?: Record<string, PackLeadPatch>;
}

/** What the lab holds and shares: the closed schema of lab-codec.ts. Every value is looked up or clamped on build. */
export interface Recipe {
  genre: LabGenre;
  preset: string;
  name: string;
  /** Knob values by knob key. Absent: the preset's value. */
  knobs: Record<string, number>;
  /** Macro positions 0..1 by macro key. Absent: the macro was not moved. */
  macros: Record<string, number>;
  /** Choice option ids by choice key. Absent: the preset's. */
  choices: Record<string, string>;
  /** acid: a riff of the lab's own, 16 steps (riffCode). Plays when the riff choice is "custom". */
  riff?: number[];
  /** ambientidm: the progression as indices into CHORD_PALETTE. Plays when the chords choice is "custom". */
  chords?: number[];
  /** Loudness correction, dB (the gate's target): the style's trim times 10^(dB/20). */
  gain?: number;
  /** A recorded take over this recipe (lab-take.ts): automation and trades from its start. */
  take?: Take;
  /** Muted parts, one bit per PARTS entry (bit 0 the kick). Absent: every part plays. Not a style field: never exported. */
  mutes?: number;
}

/** The parts a listener turns on and off (engine.ts PARTS), as the PARTS buttons name them. */
export const PART_LABELS: Record<Part, string> = { kick: "KICK", snare: "SNARE", hat: "HATS", glitch: "GLITCH", bass: "BASS", pad: "PADS", lead: "LEAD", fx: "FX" };
/**
 * The parts a preset never sounds (solo renders of each part on the gate's tape, peak under -46 dBFS): their switches
 * are dimmed, so a dead button is never mistaken for a broken one.
 */
export const SILENT_PARTS: Record<string, readonly Part[]> = {
  "acid:hamster-squeak": ["pad", "lead"],
  "acid:hamster-wheel": ["pad", "lead"],
  "acid:hamster-den": ["pad", "lead"],
  "acid:hamster-hop": ["pad", "lead"],
  "acid:infer-clock": ["pad", "lead"],
  "acid:infer-register": ["pad", "lead"],
  "acid:house-classic": ["pad", "lead"],
  "acid:house-acidhouse": ["pad", "lead"],
  "acid:house-rubber": ["pad", "lead"],
  "dubtechno:credits-void": ["snare", "glitch", "lead"],
  "dubtechno:credits-watermark": ["glitch", "lead"],
  "dubtechno:credits-null": ["snare", "glitch", "lead"],
  "dubtechno:credits-signature": ["glitch", "lead"],
  "dubtechno:credits-provenance": ["snare"],
  "dubtechno:credits-escrow": ["lead"],
  "dubtechno:credits-clearing": ["lead"],
  "dubtechno:credits-redacted": ["snare", "glitch", "lead"],
  "dubtechno:credits-foil": ["glitch", "lead"],
  "dubtechno:credits-letterpress": ["snare", "lead"],
  "dubhouse:credits-overprint": ["lead"],
  "electro:house-classic": ["pad"],
  "liquid:hamster-dnb-roller": ["glitch"],
  "liquid:hamster-dnb-shift": ["glitch"],
  "liquid:hamster-dnb-burrow": ["glitch"],
  "liquid:house-classic": ["glitch"],
  "liquid:house-atmos": ["glitch"],
  "liquid:house-soulful": ["glitch"],
  "ambientidm:hamster-music-box": ["kick", "snare", "hat"],
  "ambientidm:hamster-lullaby": ["kick", "snare", "glitch", "bass"],
  "ambientidm:hamster-snow-globe": ["kick", "snare", "hat"],
  "ambientidm:house-classic": ["glitch", "bass"],
};
export const ALL_MUTED = (1 << PARTS.length) - 1;
export const mutedParts = (r: Recipe): Part[] => PARTS.filter((_, i) => ((r.mutes ?? 0) >> i) & 1);
/** One part on or off in a recipe (an empty mask leaves the field out, as a recipe that never muted). */
export function setPart(r: Recipe, part: Part, on: boolean) {
  const bit = 1 << PARTS.indexOf(part);
  const m = on ? (r.mutes ?? 0) & ~bit : (r.mutes ?? 0) | bit;
  if (m) r.mutes = m;
  else delete r.mutes;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const inv = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);
const round = (v: number, step: number) => Math.round(v / step) * step;

const data = (s: Draft): Obj => ((s.style as Obj).data ??= {});
const house = (s: Draft): Obj => (SOUND_DEFAULTS[engineOf(s.genre)] as Obj)[s.style.base] ?? {};
const at = (o: Obj | undefined, path: readonly string[]) => path.reduce<any>((x, k) => (x == null ? undefined : x[k]), o);
/** A field's value: the style's own, else the base's house value. */
export const field = (s: Draft, path: readonly string[], fallback = 0): number => {
  const v = at(data(s), path) ?? at(house(s), path);
  return typeof v === "number" ? v : fallback;
};
/**
 * Writes one field. Depth 2 (`voice.cutoff`, `pad.level`) merges into the style's partial object; depth 3
 * (`kit.hat.level`, `fx.space.size`) writes the whole inner object over the base's, since a kit voice is replaced whole.
 */
export function put(s: Draft, path: readonly string[], v: unknown) {
  const d = data(s);
  const [a, b, c] = path;
  if (path.length === 1) d[a] = v;
  else if (path.length === 2) d[a] = { ...(d[a] ?? {}), [b]: v };
  else {
    d[a] = { ...(d[a] ?? {}) };
    d[a][b] = { ...(at(house(s), [a, b]) ?? {}), ...(d[a][b] ?? {}), [c]: v };
  }
}

// ------------------------------------------------------------------------------------------------ knobs

export interface Knob {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Bases that read it (all when left out). */
  bases?: readonly string[];
  /** A sound field the engine reads once per start (mix, fx, tempo's echo): the lab swaps players on the next bar. */
  bar?: boolean;
  /**
   * Loudness guard: how many dB louder (the gate's loudest-3s) the style gets with this knob turned from low to max,
   * measured (sim/lab/knobs.mjs). buildStyle takes the share of that travel above the preset's own value off the trim,
   * so a level knob changes the balance, never how loud the whole thing gets.
   */
  loud?: number;
  fmt?: (v: number) => string;
  get(s: Draft): number;
  set(s: Draft, v: number): void;
}

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
const pct = (v: number) => `${Math.round(v * 100)}`;
const two = (v: number) => v.toFixed(2);
const sec = (v: number) => `${v.toFixed(2)}s`;
const of = (max: number) => (v: number) => pct(v / max);

/** One field as a knob. */
const knob = (key: string, label: string, path: readonly string[], min: number, max: number, step: number, more: Partial<Knob> = {}): Knob => ({
  key,
  label,
  min,
  max,
  step,
  fmt: two,
  get: (s) => clamp(field(s, path, min), min, max),
  set: (s, v) => put(s, path, round(clamp(v, min, max), step)),
  ...more,
});

const tempo = (lo: number, hi: number): Knob => ({
  key: "tempo",
  label: "Tempo",
  min: lo + 2,
  max: hi - 2,
  step: 1,
  bar: true,
  fmt: (v) => `${Math.round(v)}`,
  get: (s) => clamp(s.style.bpm ? (s.style.bpm[0] + s.style.bpm[1]) / 2 : (lo + hi) / 2, lo + 2, hi - 2),
  // The market still moves it: two bpm either side of the knob.
  set: (s, v) => ((s.style as Obj).bpm = [clamp(Math.round(v) - 2, lo, hi), clamp(Math.round(v) + 2, lo, hi)]),
});
const swing: Knob = {
  key: "swing",
  label: "Swing",
  min: 0.5,
  max: 0.64,
  step: 0.01,
  fmt: two,
  get: (s) => clamp(s.style.swing ?? 0.5, 0.5, 0.64),
  set: (s, v) => ((s.style as Obj).swing = round(clamp(v, 0.5, 0.64), 0.01)),
};
/** The room: size, tail and the sends of the voices the README says to send (never the kick). */
const room = (sends: Record<string, [number, number]>, size: [number, number]): Knob => ({
  key: "room",
  label: "Room",
  min: 0,
  max: 1,
  step: 0.01,
  bar: true,
  fmt: pct,
  get: (s) => inv(size[0], size[1], field(s, ["fx", "space", "size"], size[0])),
  set: (s, v) => {
    const u = clamp(v, 0, 1);
    put(s, ["fx", "space", "size"], round(lerp(size[0], size[1], u), 0.01));
    put(s, ["fx", "space", "fb"], round(lerp(0.5, 0.8, u), 0.01));
    for (const [bus, [a, b]] of Object.entries(sends)) put(s, ["fx", "spaceSend", bus], round(lerp(a, b, u), 0.01));
  },
});
const hats = (max: number) => knob("hats", "Hats", ["kit", "hat", "level"], 0, max, 0.01, { fmt: pct });
const dust = (max: number) => knob("dust", "Dust", ["vinyl"], 0, max, 0.05, { fmt: two });

// ------------------------------------------------------------------------------------------------ macros

export interface Macro {
  key: string;
  left: string;
  right: string;
  /** The knobs it moves: moving the macro hands those back to it (their stored values are dropped). */
  knobs: readonly string[];
  set(s: Draft, v: number): void;
  /** Where it sits on a style it did not make: read back from the field it moves most. */
  get(s: Draft): number;
  /** Loudness guard (Knob.loud) of its top half. */
  loud?: number;
  /** It moves something the engine reads at a genre's start or once a chord (Knob.bar): the lab swaps on the next bar. */
  bar?(s: Draft): boolean;
}

// ------------------------------------------------------------------------------------------------ choices

export interface Choice {
  key: string;
  label: string;
  /** Option ids and labels: the only values a recipe may name. */
  options(s: Draft): readonly { id: string; label: string }[];
  /** The option the preset itself plays. */
  initial(preset: Preset): string;
  /** Writes the option into the style (choices the build does not handle itself). */
  apply?(s: Draft, id: string): void;
}

// ------------------------------------------------------------------------------------------------ genres

export interface Genre {
  id: LabGenre;
  label: string;
  /** A style's tempo window (pack.ts PACK_BPM). */
  bpm: readonly [number, number];
  bases: Record<string, string>;
  knobs: readonly Knob[];
  macros: readonly Macro[];
  choices: readonly Choice[];
  presets: readonly Preset[];
  /**
   * How the loudness guards of several knobs add up (measured with sim/lab/loud.mjs: voices sharing the master
   * ceiling add a part of their sum, acid about half, electro a third; Ambient IDM's add fully). Never under the
   * largest single one.
   */
  guardSum: number;
}

export interface Preset {
  /** Stable id: `<genre>:<style id>`, or `<genre>:house-<base>` for a house base. */
  id: string;
  label: string;
  genre: LabGenre;
  style: StationStyle;
  patches?: Record<string, PackLeadPatch>;
}

const fromPack = (genre: LabGenre, pack: StationPack | undefined, by: string): Preset[] =>
  ((pack?.styles[engineOf(genre)] ?? []) as readonly StationStyle[]).map((style) => {
    const own = (style.leads ?? []).filter((id) => pack?.patches?.[id]);
    return {
      id: `${genre}:${style.id}`,
      label: `${style.name} · ${by}`,
      genre,
      style: clone(style),
      ...(own.length ? { patches: Object.fromEntries(own.map((id) => [id, clone(pack!.patches![id])])) } : {}),
    };
  });
const houseBase = (genre: LabGenre, base: string, name: string): Preset => ({
  id: `${genre}:house-${base}`,
  label: `${name} · IDM station`,
  genre,
  style: { id: "lab-style", name, base } as StationStyle,
});

// acid -------------------------------------------------------------------------------------------------

const ACID_PRESETS: Preset[] = [
  ...fromPack("acid", PACKS.hamster, "Squeekchain"),
  ...fromPack("acid", PACKS.infer, "Infer"),
  houseBase("acid", "classic", "303 Floor"),
  houseBase("acid", "acidhouse", "Acid House"),
  houseBase("acid", "rubber", "Slow Rubber"),
];

/** The acid riff sets the lab offers: every pack style's own lines, by the style's id. */
export const RIFFS: readonly { id: string; label: string; lines: readonly (readonly (Obj | null)[])[] }[] = ACID_PRESETS.flatMap((p) => {
  const lines = (p.style.data as Obj | undefined)?.lines;
  return lines ? [{ id: p.style.id, label: p.style.name, lines }] : [];
});

/** The 303 degrees (the acid note set 0 3 7 10 12), for the riff editor. */
export const ACID_DEGREES = ["root", "m3", "5th", "b7", "oct"] as const;
/**
 * A 303 step as one small integer: 0 rest, else 1 + degree + 5 x (octave + 1) + 15 x accent + 30 x slide (1..60).
 * The riff grid of a recipe is 16 of these: nothing else can be written into a line.
 */
export function stepCode(n: Obj | null): number {
  if (!n) return 0;
  const degree = clamp(Math.round(n.degree) || 0, 0, 4);
  const octave = clamp(Math.round(n.octave) || 0, -1, 1);
  return 1 + degree + 5 * (octave + 1) + 15 * (n.flags & 1) + 30 * ((n.flags >> 1) & 1);
}
export function stepNote(code: number): Obj | null {
  if (!Number.isInteger(code) || code < 1 || code > 60) return null;
  const c = code - 1;
  return { degree: c % 5, octave: Math.floor(c / 5) % 3 - 1, flags: (Math.floor(c / 15) % 2) + 2 * Math.floor(c / 30) };
}
/** A riff for the editor to start from: the chosen riff's first line, or roots on the eighths. */
export const riffStart = (riff: string): number[] => {
  const r = RIFFS.find((x) => x.id === riff);
  return r ? r.lines[0].map(stepCode) : Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? stepCode({ degree: 0, octave: 0, flags: i % 4 === 0 ? 1 : 0 }) : 0));
};

/** A deterministic 0..1 per step, so thinning and filling a riff is the same on every machine. */
const stepHash = (line: number, i: number) => ((((i * 7 + line * 5 + 3) * 2654435761) >>> 0) % 1000) / 1000;

/**
 * A riff set thinned (d < 0.5) or filled (d > 0.5). Thinning drops unaccented notes off the beat first and keeps at
 * least four notes; filling turns rests into ornaments (flag 4: they play only while the chain's bass row is busy, so
 * the market still decides how dense it gets).
 */
export function densify(lines: readonly (readonly (Obj | null)[])[], d: number): (Obj | null)[][] {
  return lines.map((line, li) => {
    if (Math.abs(d - 0.5) < 0.02) return clone(line) as (Obj | null)[];
    if (d < 0.5) {
      const thin = (0.5 - d) * 2;
      const out = line.map((n, i) => (n && !(n.flags & 1) && i % 4 !== 0 && stepHash(li, i) < thin * 0.9 ? null : n));
      return clone(out.filter(Boolean).length >= 4 ? out : line) as (Obj | null)[];
    }
    const fill = (d - 0.5) * 2;
    let last: Obj = line.find(Boolean) ?? { degree: 0, octave: 0 };
    return line.map((n, i) => {
      if (n) return (last = n), clone(n);
      if (stepHash(li, i) >= fill * 0.85) return null;
      return { degree: i % 3 === 0 ? 0 : last.degree, octave: i % 4 === 2 ? 1 : 0, flags: 4 };
    });
  });
}

const ACID: Genre = {
  id: "acid",
  label: "Acid",
  bpm: [108, 140],
  bases: { classic: "303 Floor", acidhouse: "Acid House", rubber: "Slow Rubber" },
  presets: ACID_PRESETS,
  guardSum: 0.55,
  knobs: [
    { ...tempo(108, 140), loud: 0.8 },
    swing,
    knob("cutoff", "Cutoff", ["voice", "cutoff"], 50, 400, 1, { fmt: hz }),
    knob("envMod", "Env mod", ["voice", "envMod"], 300, 4000, 10, { fmt: hz }),
    knob("resonance", "Resonance", ["voice", "resonance"], 1.5, 4.2, 0.05),
    knob("decay", "Decay", ["voice", "decay"], 0.05, 0.6, 0.01, { fmt: sec }),
    knob("drive", "Drive", ["voice", "drive"], 0.5, 3, 0.05, { loud: 3 }),
    knob("level", "303 level", ["voice", "level"], 0.08, 0.3, 0.005, { fmt: of(0.3), loud: 2.7 }),
    knob("sub", "Sub", ["voice", "sub"], 0, 1, 0.05, { fmt: pct, loud: 4.7 }),
    knob("kickDecay", "Kick boom", ["kit", "kick", "decay"], 0.12, 0.6, 0.01, { fmt: sec, loud: 2.5 }),
    knob("kickDrive", "Kick drive", ["kit", "kick", "drive"], 0, 3, 0.05, { loud: 2.3 }),
    hats(0.6),
    knob("echo", "303 echo", ["fx", "echoSend", "bass"], 0, 0.5, 0.01, { fmt: pct, bar: true }),
    room({ snare: [0.05, 0.5], perc: [0.05, 0.45], bass: [0, 0.08] }, [0.5, 2.2]),
    dust(1.5),
  ],
  macros: [
    {
      key: "bright",
      left: "Dark",
      right: "Bright",
      knobs: ["cutoff", "envMod"],
      set(s, v) {
        put(s, ["voice", "cutoff"], Math.round(lerp(60, 260, v)));
        put(s, ["voice", "envMod"], round(lerp(800, 3200, v), 10));
        put(s, ["kit", "hat", "hp"], Math.round(lerp(6000, 10500, v)));
        put(s, ["kit", "open", "hp"], Math.round(lerp(5500, 9500, v)));
      },
      get: (s) => inv(60, 260, field(s, ["voice", "cutoff"], 145)),
    },
    {
      key: "dense",
      left: "Sparse",
      right: "Dense",
      knobs: [],
      loud: 0.8,
      // The riff's thinning or filling is buildStyle's (it knows the riff); here the offbeat hats.
      set: (s, v) => put(s, ["kit", "hat", "off"], round(lerp(0, 0.4, v), 0.01)),
      get: () => 0.5,
    },
  ],
  choices: [
    {
      key: "riff",
      label: "Riff",
      options: (s) => [{ id: "base", label: `${ACID.bases[s.style.base]} (IDM station)` }, ...RIFFS.map((r) => ({ id: r.id, label: r.label })), { id: "custom", label: "My riff" }],
      initial: (p) => RIFFS.find((r) => r.lines === (p.style.data as Obj | undefined)?.lines)?.id ?? "base",
    },
    {
      key: "wave",
      label: "Wave",
      options: () => [{ id: "saw", label: "Saw" }, { id: "square", label: "Square" }],
      initial: (p) => ((p.style.data as Obj | undefined)?.voice?.wave ?? (SOUND_DEFAULTS.acid as Obj)[p.style.base].voice.wave) as string,
    },
  ],
};

// ambient IDM ---------------------------------------------------------------------------------------------

/** The house Ambient IDM chords (engine.ts AMBIENT_CHORDS) and three more, all in the genre's minor pentatonic. */
export const CHORD_PALETTE: readonly { label: string; chord: Obj }[] = [
  { label: "i m7", chord: { bass: 0, pad: [-12, 0, 7, 10, 15], glass: [0, 7, 12, 15, 24], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] } },
  { label: "bIII add9", chord: { bass: 3, pad: [-9, 3, 10, 17, 19], glass: [3, 10, 15, 19, 29], arp: [3, 7, 10, 15], sing: [7, 10, 5, 3, 12] } },
  { label: "bVII 6/9 sus4", chord: { bass: -2, pad: [-14, 5, 10, 12, 19], glass: [-2, 5, 10, 12, 19], arp: [-2, 3, 5, 10], sing: [3, 5, 12, 10, 7] } },
  { label: "iv 9 sus4", chord: { bass: 5, pad: [-7, 5, 12, 15, 19], glass: [5, 12, 15, 19, 22], arp: [5, 10, 12, 15], sing: [10, 12, 7, 5, 15] } },
  { label: "i m11", chord: { bass: 0, pad: [-12, 0, 5, 10, 15, 19], glass: [0, 5, 10, 15, 19], arp: [0, 5, 10, 15], sing: [3, 7, 5, 0, 10] } },
  { label: "v7 sus4", chord: { bass: 7, pad: [-5, 7, 12, 15, 17], glass: [7, 12, 15, 17, 24], arp: [7, 10, 12, 15], sing: [10, 12, 15, 7, 17] } },
  { label: "iv quartal", chord: { bass: 5, pad: [-7, 3, 5, 10, 15], glass: [5, 10, 15, 17, 24], arp: [3, 5, 10, 15], sing: [10, 15, 12, 5, 19] } },
  { label: "bIII 6/9 open", chord: { bass: 3, pad: [-9, 7, 10, 15, 17, 22], glass: [3, 7, 15, 17, 22], arp: [3, 7, 10, 17], sing: [7, 10, 17, 3, 15] } },
];
/** The house progressions (engine.ts AMBIENT_PROGRESSIONS), over the first five palette chords. */
export const PROGRESSIONS: readonly { id: string; label: string; prog: readonly number[] }[] = [
  { id: "p0", label: "i bIII iv i11", prog: [0, 1, 3, 4] },
  { id: "p1", label: "i bVII bIII iv", prog: [0, 2, 1, 3] },
  { id: "p2", label: "i iv (two chords)", prog: [0, 3] },
  { id: "p3", label: "bIII iv i i11", prog: [1, 3, 0, 4] },
  { id: "p4", label: "i i11 bVII bIII", prog: [0, 4, 2, 1] },
];
/** Tape Keys / Tape Haze / Crystal density thresholds of the house (styledata.ts AmbientIdmData.tiers). */
const HOUSE_TIERS: Record<string, [number, number]> = { classic: [0.36, 0.68], boc: [0.42, 0.72], crystal: [0.1, 0.5] };

const AMBIENT: Genre = {
  id: "ambientidm",
  label: "Ambient IDM",
  bpm: [70, 124],
  bases: { classic: "Tape Keys", boc: "Tape Haze", crystal: "Crystal" },
  guardSum: 1,
  presets: [
    ...fromPack("ambientidm", PACKS["hamster-sleep"], "hamster asleep"),
    houseBase("ambientidm", "classic", "Tape Keys"),
    houseBase("ambientidm", "boc", "Tape Haze"),
    houseBase("ambientidm", "crystal", "Crystal"),
  ],
  knobs: [
    { ...tempo(70, 124), loud: 1.2 },
    swing,
    // The pad and the glass bed sound a whole chord (four bars): their knobs land on the next bar with a fresh player.
    // The pad and the glass bed hold a whole chord and read these when the next one starts: no fresh player, so a
    // swell already rising is never cut and started again.
    knob("padTone", "Pad tone", ["pad", "cutoff"], 200, 3000, 10, { fmt: hz, bases: ["classic", "boc"] }),
    knob("padLevel", "Pad", ["pad", "level"], 0.01, 0.14, 0.002, { fmt: of(0.14), bases: ["classic", "boc"], loud: 2.1 }),
    knob("bloom", "Bloom", ["pad", "attack"], 0.2, 8, 0.1, { fmt: sec, bases: ["classic", "boc"] }),
    knob("wow", "Wow", ["pad", "vib"], 0, 30, 1, { fmt: (v) => `${Math.round(v)}c`, bases: ["classic", "boc"] }),
    knob("line", "High line", ["line", "level"], 0, 0.05, 0.001, { fmt: of(0.05), bases: ["classic", "crystal"], loud: 0.7 }),
    knob("keys", "Keys", ["lead", "level"], 0, 0.25, 0.005, { fmt: of(0.25), bases: ["boc"], loud: 1.6 }),
    knob("scoop", "Scoop", ["lead", "scoop"], 0, 100, 1, { fmt: (v) => `${Math.round(v)}c`, bases: ["boc"] }),
    knob("bass", "Bass", ["bass", "level"], 0, 0.16, 0.002, { fmt: of(0.16), bases: ["boc"], loud: 2.7 }),
    knob("glass", "Glass", ["glass", "level"], 0.005, 0.22, 0.005, { fmt: of(0.22), bases: ["crystal"], loud: 6.5 }),
    knob("bells", "Bells", ["bell", "level"], 0, 0.1, 0.002, { fmt: of(0.1), bases: ["crystal"] }),
    knob("shimmer", "Shimmer", ["shimmer", "level"], 0, 0.35, 0.005, { fmt: of(0.35), bases: ["crystal"], loud: 2.5 }),
    knob("kickDecay", "Kick boom", ["kit", "kick", "decay"], 0.1, 0.6, 0.01, { fmt: sec, bases: ["classic", "boc"], loud: 1.6 }),
    hats(0.5),
    knob("echo", "Echo", ["fx", "echoSend", "lead"], 0, 0.9, 0.01, { fmt: pct, bar: true }),
    room({ harm: [0.2, 0.8], lead: [0.3, 0.9], snare: [0.1, 0.4] }, [0.6, 2.5]),
    dust(2.2),
  ],
  macros: [
    {
      key: "bright",
      left: "Dark",
      right: "Bright",
      knobs: ["padTone"],
      // Every voice's filter, each heard from its next note (the pad's from the next chord): no fresh player, so the
      // bed never starts again. The master's tape top is a start-only field: the preset's stays.
      set(s, v) {
        const b = s.style.base;
        if (b !== "crystal") put(s, ["pad", "cutoff"], round(lerp(250, 3200, v), 10));
        if (b !== "boc") put(s, ["line", "cutoff"], round(lerp(900, 7500, v), 10));
        if (b === "crystal") put(s, ["glass", "cutoff"], round(lerp(900, 7500, v), 10));
        if (b === "crystal") put(s, ["bell", "index"], round(lerp(1, 5, v), 0.1));
        if (b === "boc") put(s, ["lead", "cutoff"], round(lerp(350, 3000, v), 10));
        if (b === "boc") put(s, ["bass", "cutoff"], round(lerp(120, 420, v), 5));
        put(s, ["kit", "hat", "hp"], Math.round(lerp(2000, 9000, v)));
      },
      get: (s) => (s.style.base === "crystal" ? inv(1200, 6000, field(s, ["line", "cutoff"], 4200)) : inv(300, 2400, field(s, ["pad", "cutoff"], 650))),
    },
    {
      key: "dense",
      left: "Sparse",
      right: "Dense",
      knobs: [],
      loud: 0.4,
      // Lower thresholds = the busier tiers join sooner (Crystal: the arp runs faster).
      set: (s, v) => put(s, ["tiers"], [round(lerp(0.85, 0.08, v), 0.01), round(lerp(0.98, 0.45, v), 0.01)]),
      get: (s) => inv(0.85, 0.08, ((data(s).tiers as [number, number] | undefined) ?? HOUSE_TIERS[s.style.base] ?? [0.4, 0.7])[0]),
    },
  ],
  choices: [
    {
      key: "chords",
      label: "Chords",
      options: () => [{ id: "own", label: "Preset's own" }, ...PROGRESSIONS.map((p) => ({ id: p.id, label: p.label })), { id: "custom", label: "My chords" }],
      initial: () => "own",
    },
  ],
};


// dub techno ----------------------------------------------------------------------------------------------

/** Tables of the house dub techno chord names (engine.ts DUB_CHORDS), so they play over any preset's chords. */
const DUB_CHANGES: readonly { id: string; label: string; progressions: readonly { bars: number; seq: readonly string[] }[] }[] = [
  { id: "one", label: "One chord (i9)", progressions: [{ bars: 8, seq: ["i9"] }] },
  { id: "two", label: "i9 VI9", progressions: [{ bars: 4, seq: ["i9", "VI9"] }] },
  { id: "minor", label: "i11 iv7", progressions: [{ bars: 4, seq: ["i11", "iv7"] }] },
  { id: "walk", label: "i9 VII9 VI9 v7", progressions: [{ bars: 2, seq: ["i9", "VII9", "VI9", "v7"] }] },
];
const STAB_BARS: readonly { id: string; label: string; bars: readonly number[] }[] = [
  { id: "every", label: "Every bar", bars: [1] },
  { id: "half", label: "One in two", bars: [1, 0] },
  { id: "quarter", label: "One in four", bars: [1, 0, 0, 0] },
  { id: "eight", label: "One in eight", bars: [1, 0, 0, 0, 0, 0, 0.7, 0] },
];
const own = (id = "own", label = "Preset's own") => ({ id, label });

const DUB: Genre = {
  id: "dubtechno",
  label: "Dub Techno",
  bpm: [112, 130],
  bases: { classic: "Lucidflow", ixtlan: "Ixtlan", moment: "The Moment" },
  guardSum: 0.6,
  presets: [
    // The IDM station's own three bases play under Dub House (DUBHOUSE): here, the Credits Techno pack only.
    ...fromPack("dubtechno", PACKS.credits, "Credits Techno"),
  ],
  knobs: [
    { ...tempo(112, 130), loud: 0.6 },
    swing,
    knob("kick", "Kick", ["kit", "kick", "level"], 0.12, 0.4, 0.005, { fmt: of(0.4), loud: 2.7 }),
    knob("kickTail", "Kick tail", ["kit", "kick", "decay"], 0.3, 1.2, 0.01, { fmt: sec, loud: 1.6 }),
    knob("sub", "Sub", ["subTone", "level"], 0.3, 0.95, 0.01, { fmt: pct, loud: 2.4 }),
    knob("stabs", "Stabs", ["stabTone", "gain"], 0.3, 1.2, 0.01, { fmt: pct, loud: 1.4 }),
    knob("stabTone", "Stab tone", ["stabTone", "lp"], 300, 2600, 10, { fmt: hz }),
    knob("stabReso", "Stab reso", ["stabTone", "q"], 0.5, 4, 0.05),
    knob("stabLength", "Stab length", ["stabTone", "release"], 0.1, 1.2, 0.01, { fmt: sec, loud: 0.85 }),
    knob("pad", "Pad", ["padTone", "level"], 0, 2.2, 0.05, { fmt: of(2.2), loud: 1.4 }),
    knob("hats", "Hats", ["kit", "hat", "off"], 0, 0.9, 0.01, { fmt: pct }),
    knob("clap", "Clap", ["kit", "clap", "level"], 0, 2, 0.05, { fmt: of(2) }),
    knob("rain", "Rain", ["field", "level"], 0, 2.5, 0.05, { fmt: two }),
    knob("rumble", "Rumble", ["rumble", "level"], 0, 1, 0.02, { fmt: pct, bar: true, loud: 1.7 }),
    knob("echoFb", "Echo tail", ["fx", "echo", "fb"], 0.3, 0.72, 0.01, { fmt: pct, bar: true }),
    knob("echo", "Echo", ["fx", "echoSend", "harm"], 0.3, 1, 0.01, { fmt: pct, bar: true }),
    room({ harm: [0.2, 0.7], lead: [0.2, 0.7], snare: [0.1, 0.45], perc: [0.1, 0.4] }, [0.8, 2.4]),
    dust(1.5),
  ],
  macros: [
    {
      key: "bright",
      left: "Dark",
      right: "Bright",
      knobs: ["stabTone"],
      set(s, v) {
        put(s, ["stabTone", "lp"], round(lerp(400, 2400, v), 10));
        put(s, ["padTone", "lp"], round(lerp(400, 2200, v), 10));
        put(s, ["kit", "hat", "hp"], Math.round(lerp(5000, 9500, v)));
      },
      get: (s) => inv(400, 2400, field(s, ["stabTone", "lp"], 1000)),
    },
    {
      key: "dense",
      left: "Sparse",
      right: "Dense",
      knobs: [],
      set(s, v) {
        put(s, ["kit", "hat", "shaker"], round(lerp(0.05, 0.55, v), 0.01));
        put(s, ["kit", "perc", "level"], round(lerp(0.1, 0.7, v), 0.01));
      },
      get: (s) => inv(0.05, 0.55, field(s, ["kit", "hat", "shaker"], 0.34)),
    },
  ],
  choices: [
    {
      key: "changes",
      label: "Changes",
      options: () => [own(), ...DUB_CHANGES.map((c) => ({ id: c.id, label: c.label }))],
      initial: () => "own",
      apply(s, id) {
        const c = DUB_CHANGES.find((x) => x.id === id);
        if (c) data(s).progressions = clone(c.progressions);
      },
    },
    {
      key: "stabBars",
      label: "Stab rhythm",
      options: () => [own(), ...STAB_BARS.map((c) => ({ id: c.id, label: c.label }))],
      initial: () => "own",
      apply(s, id) {
        const c = STAB_BARS.find((x) => x.id === id);
        if (c) data(s).stabBars = [...c.bars];
      },
    },
  ],
};

// electro -------------------------------------------------------------------------------------------------

/** A [plain, accent] pair knob (electro bassTone): the accent rides `lift` times the plain value. */
const pairKnob = (key: string, label: string, path: readonly string[], min: number, max: number, step: number, lift: number, cap: number, more: Partial<Knob> = {}): Knob => ({
  key,
  label,
  min,
  max,
  step,
  fmt: two,
  get: (s) => {
    const v = at(data(s), path) ?? at(house(s), path);
    return clamp(Array.isArray(v) ? v[0] : typeof v === "number" ? v : min, min, max);
  },
  set: (s, v) => {
    const a = round(clamp(v, min, max), step);
    put(s, path, [a, round(Math.min(cap, a * lift), step)]);
  },
  ...more,
});

const ELECTRO: Genre = {
  id: "electro",
  label: "Electro",
  bpm: [110, 140],
  bases: { classic: "Cold 808", client03: "Client_03", alienrave: "Alien Rave" },
  guardSum: 0.35,
  presets: [
    ...fromPack("electro", PACKS.hamster, "Squeekchain"),
    ...fromPack("electro", PACKS["machine-electro"], "Machine"),
    ...fromPack("electro", PACKS["imd-dark"], "IMD dark"),
    houseBase("electro", "classic", "Cold 808"),
    houseBase("electro", "client03", "Client_03"),
    houseBase("electro", "alienrave", "Alien Rave"),
  ],
  knobs: [
    { ...tempo(110, 140), loud: 3.3 },
    swing,
    knob("kickDecay", "Kick boom", ["kit", "kick", "decay"], 0.15, 0.8, 0.01, { fmt: sec, loud: 5 }),
    knob("kickDrive", "Kick drive", ["kit", "kick", "drive"], 0, 3, 0.05, { loud: 4.5 }),
    knob("bassCutoff", "Bass cutoff", ["bassTone", "cutoff"], 80, 900, 5, { fmt: hz }),
    pairKnob("bassReso", "Bass reso", ["bassTone", "q"], 1, 10, 0.1, 1.25, 14),
    pairKnob("bassLevel", "Bass", ["bassTone", "level"], 0.08, 0.24, 0.005, 1.2, 0.3, { fmt: of(0.24), loud: 4.4 }),
    pairKnob("bassDecay", "Bass decay", ["bassTone", "decay"], 0.04, 0.3, 0.005, 1.3, 0.5, { fmt: sec }),
    pairKnob("bassSub", "Sub", ["bassTone", "sub"], 0, 1.6, 0.05, 1.15, 2, { fmt: of(1.6), loud: 3.8 }),
    knob("bassDrive", "Bass drive", ["bassTone", "drive"], 0.5, 4, 0.05, { bases: ["client03", "alienrave"], loud: 3.5 }),
    knob("open", "Open hat", ["kit", "open", "level"], 0, 0.7, 0.01, { fmt: pct }),
    knob("pad", "Pad", ["pad", "level"], 0.005, 0.2, 0.005, { fmt: of(0.2), bases: ["client03"], loud: 3.9 }),
    knob("hoover", "Hoover", ["hoover", "level"], 0, 0.3, 0.005, { fmt: of(0.3), bases: ["alienrave"], loud: 1.5 }),
    knob("echo", "Echo", ["fx", "echoSend", "lead"], 0, 0.9, 0.01, { fmt: pct, bar: true }),
    room({ snare: [0.05, 0.4], perc: [0.05, 0.4], lead: [0.1, 0.6] }, [0.5, 2]),
    dust(1),
  ],
  macros: [
    {
      key: "bright",
      left: "Dark",
      right: "Bright",
      knobs: [],
      set(s, v) {
        put(s, ["bassTone", "color"], Math.round(lerp(150, 2600, v)));
        put(s, ["kit", "hat", "hp"], Math.round(lerp(5500, 10500, v)));
        put(s, ["kit", "open", "hp"], Math.round(lerp(4500, 9000, v)));
      },
      get: (s) => inv(150, 2600, field(s, ["bassTone", "color"], 1000)),
    },
    {
      key: "dense",
      left: "Sparse",
      right: "Dense",
      knobs: [],
      // The hat's accents on each 16th of the beat [on, e, and, a]: sparse leans on the beat, dense fills the e's and a's.
      set: (s, v) => put(s, ["kit", "accents"], [round(lerp(0.6, 0.5, v), 0.01), round(lerp(0.05, 0.45, v), 0.01), round(lerp(0.5, 0.6, v), 0.01), round(lerp(0.05, 0.45, v), 0.01)]),
      get: (s) => {
        const a = at(data(s), ["kit", "accents"]) ?? at(house(s), ["kit", "accents"]);
        return Array.isArray(a) ? inv(0.05, 0.45, a[1]) : 0.5;
      },
    },
  ],
  choices: [
    {
      key: "snare",
      label: "Snare",
      options: () => [own(), { id: "808", label: "808" }, { id: "client", label: "Client" }, { id: "alien", label: "Alien" }],
      initial: () => "own",
      apply(s, id) {
        if (id !== "own") put(s, ["kit", "snare"], id);
      },
    },
  ],
};

// liquid --------------------------------------------------------------------------------------------------

const LIQUID: Genre = {
  id: "liquid",
  label: "Liquid DnB",
  bpm: [160, 180],
  bases: { classic: "Keys", atmos: "Atmospheric", soulful: "Soulful" },
  guardSum: 0.6,
  presets: [
    ...fromPack("liquid", PACKS.hamster, "Squeekchain"),
    houseBase("liquid", "classic", "Keys"),
    houseBase("liquid", "atmos", "Atmospheric"),
    houseBase("liquid", "soulful", "Soulful"),
  ],
  knobs: [
    { ...tempo(160, 180), loud: 0 },
    swing,
    knob("kickDecay", "Kick boom", ["kit", "kick", "decay"], 0.12, 0.5, 0.01, { fmt: sec, loud: 1.6 }),
    knob("kick", "Kick", ["kit", "kickLevel"], 0.6, 1.6, 0.02, { fmt: of(1.6), loud: 0.9 }),
    knob("snare", "Snare", ["kit", "snareLevel"], 0.8, 1.8, 0.02, { fmt: of(1.8), loud: 0.5 }),
    knob("ghosts", "Ghosts", ["kit", "ghostLevel"], 0, 0.8, 0.01, { fmt: pct }),
    hats(0.6),
    knob("bassGrit", "Bass grit", ["bass", "drive"], 0, 2, 0.05, { loud: 1.1 }),
    knob("bassHold", "Bass hold", ["bass", "hold"], 0.3, 1, 0.01, { fmt: pct }),
    knob("reese", "Reese", ["reese", "level"], 0, 1.2, 0.02, { fmt: of(1.2), loud: 1.5 }),
    knob("padTone", "Pad tone", ["pad", "cutoff"], 200, 3000, 10, { fmt: hz, bases: ["classic", "atmos"] }),
    knob("pad", "Pad", ["pad", "level"], 0.01, 0.14, 0.002, { fmt: of(0.14), bases: ["classic", "atmos"], loud: 0.9 }),
    knob("choir", "Choir", ["choir", "level"], 0.02, 0.3, 0.005, { fmt: of(0.3), bases: ["atmos"], loud: 1.5 }),
    knob("strings", "Strings", ["strings", "level"], 0.03, 0.25, 0.005, { fmt: of(0.25), bases: ["soulful"], loud: 1.5 }),
    knob("echo", "Echo", ["fx", "echoSend", "lead"], 0, 0.8, 0.01, { fmt: pct, bar: true }),
    room({ harm: [0.2, 0.7], lead: [0.2, 0.75], snare: [0.1, 0.45] }, [0.6, 2.2]),
    dust(1.2),
  ],
  macros: [
    {
      key: "bright",
      left: "Dark",
      right: "Bright",
      knobs: ["padTone"],
      set(s, v) {
        const b = s.style.base;
        if (b !== "soulful") put(s, ["pad", "cutoff"], round(lerp(300, 2600, v), 10));
        if (b === "soulful") put(s, ["strings", "cutoff"], round(lerp(500, 3200, v), 10));
        if (b === "atmos") put(s, ["choir", "cutoff"], round(lerp(1200, 5200, v), 10));
        put(s, ["kit", "hat", "hp"], Math.round(lerp(5500, 10500, v)));
      },
      get: (s) => (s.style.base === "soulful" ? inv(500, 3200, field(s, ["strings", "cutoff"], 1100)) : inv(300, 2600, field(s, ["pad", "cutoff"], 650))),
    },
    {
      key: "dense",
      left: "Sparse",
      right: "Dense",
      knobs: ["ghosts"],
      set(s, v) {
        put(s, ["kit", "ghostLevel"], round(lerp(0.1, 0.75, v), 0.01));
        put(s, ["kit", "shaker", "level"], round(lerp(0.05, 0.45, v), 0.01));
      },
      get: (s) => inv(0.1, 0.75, field(s, ["kit", "ghostLevel"], 0.45)),
    },
  ],
  choices: [
    {
      key: "bassWave",
      label: "Bass",
      options: () => [own(), { id: "sine", label: "Sine (clean sub)" }, { id: "triangle", label: "Triangle (audible)" }],
      initial: () => "own",
      apply(s, id) {
        if (id === "sine" || id === "triangle") put(s, ["bass", "wave"], id);
      },
    },
  ],
};

// dub house ----------------------------------------------------------------------------------------------

/** How fast the chords change, over the preset's own progressions (bars per chord). */
const CHANGE_SPEED: readonly { id: string; label: string; bars: number }[] = [
  { id: "slow", label: "Slow (8 bars)", bars: 8 },
  { id: "medium", label: "Medium (4 bars)", bars: 4 },
  { id: "fast", label: "Fast (2 bars)", bars: 2 },
];

/**
 * Dub House: a lab tab of its own over the dubtechno engine (engineOf). The Credits Dub House styles, warm and sunny:
 * Prophet-like stabs with a filter fall, a swung shaker, a walking sub, a far pad, an FM glass copy of the chord in the
 * echo, rain, vinyl and a long room. Knobs for that, not dub techno's; tempo kept around 118..124.
 */
const DUBHOUSE: Genre = {
  id: "dubhouse",
  label: "Dub House",
  bpm: [116, 126],
  bases: { classic: "Lucidflow", ixtlan: "Ixtlan", moment: "The Moment" },
  guardSum: 0.6,
  presets: [
    ...fromPack("dubhouse", PACKS["credits-dubhouse"], "Credits Dub House"),
    houseBase("dubhouse", "classic", "Lucidflow"),
    houseBase("dubhouse", "ixtlan", "Ixtlan"),
    houseBase("dubhouse", "moment", "The Moment"),
  ],
  knobs: [
    tempo(116, 126),
    swing,
    knob("warmth", "Stab warmth", ["stabTone", "lp"], 400, 2000, 10, { fmt: hz }),
    knob("fall", "Filter fall", ["stabTone", "envTime"], 0.05, 0.6, 0.01, { fmt: sec }),
    knob("stabs", "Stabs", ["stabTone", "gain"], 0.3, 1.1, 0.01, { fmt: pct, loud: 0.8 }),
    knob("shaker", "Shaker", ["kit", "hat", "shaker"], 0, 0.6, 0.01, { fmt: pct }),
    knob("hats", "Hats", ["kit", "hat", "off"], 0, 0.6, 0.01, { fmt: pct }),
    knob("sub", "Sub walk", ["subTone", "level"], 0.3, 0.95, 0.01, { fmt: pct, loud: 1.2 }),
    knob("pad", "Pad", ["padTone", "level"], 0, 2, 0.05, { fmt: of(2), loud: 0.3 }),
    knob("glass", "FM glass", ["bellTone", "level"], 0, 1.5, 0.05, { fmt: of(1.5) }),
    knob("echo", "Dub echo", ["fx", "echoSend", "harm"], 0.2, 1, 0.01, { fmt: pct, bar: true }),
    knob("echoFb", "Echo repeats", ["fx", "echo", "fb"], 0.3, 0.72, 0.01, { fmt: pct, bar: true }),
    room({ harm: [0.2, 0.6], lead: [0.25, 0.7], tex: [0.3, 0.7], snare: [0.1, 0.35] }, [0.9, 2.3]),
    knob("rain", "Rain", ["field", "level"], 0, 1.5, 0.05, { fmt: two }),
    dust(1.2),
  ],
  macros: [
    {
      key: "bright",
      left: "Warm",
      right: "Sunny",
      knobs: ["warmth"],
      // Warm: the stab closed and the top dark; sunny: the stab open, a brighter glass, an open master top.
      bar: () => true,
      set(s, v) {
        put(s, ["stabTone", "lp"], round(lerp(550, 1800, v), 10));
        put(s, ["padTone", "lp"], round(lerp(450, 1600, v), 10));
        put(s, ["bellTone", "index"], round(lerp(0.8, 2.2, v), 0.05));
        put(s, ["kit", "hat", "hp"], Math.round(lerp(6000, 9500, v)));
        put(s, ["fx", "master", "lp"], round(lerp(6500, 16000, v), 100));
      },
      get: (s) => inv(550, 1800, field(s, ["stabTone", "lp"], 850)),
    },
    {
      key: "dense",
      left: "Sparse",
      right: "Dense",
      knobs: ["shaker"],
      set(s, v) {
        put(s, ["kit", "hat", "shaker"], round(lerp(0.08, 0.5, v), 0.01));
        put(s, ["kit", "perc", "level"], round(lerp(0.1, 0.55, v), 0.01));
      },
      get: (s) => inv(0.08, 0.5, field(s, ["kit", "hat", "shaker"], 0.22)),
    },
  ],
  choices: [
    {
      key: "changes",
      label: "Chord changes",
      options: () => [own(), ...CHANGE_SPEED.map((c) => ({ id: c.id, label: c.label }))],
      initial: () => "own",
      apply(s, id) {
        const c = CHANGE_SPEED.find((x) => x.id === id);
        const progs = (data(s).progressions as { bars: number; seq: string[] }[] | undefined) ?? [{ bars: 4, seq: ["i9", "VI9"] }];
        if (c) data(s).progressions = progs.map((p) => ({ ...p, bars: c.bars }));
      },
    },
  ],
};

export const GENRES: Record<LabGenre, Genre> = { acid: ACID, ambientidm: AMBIENT, dubtechno: DUB, dubhouse: DUBHOUSE, electro: ELECTRO, liquid: LIQUID };
export const GENRE_LIST: readonly Genre[] = [ACID, DUB, DUBHOUSE, ELECTRO, LIQUID, AMBIENT];
export const isGenre = (g: unknown): g is LabGenre => typeof g === "string" && Object.prototype.hasOwnProperty.call(GENRES, g);
export const presetById = (g: LabGenre, id: unknown): Preset | undefined => GENRES[g].presets.find((p) => p.id === id);
/** The knobs a style's base reads. */
export const knobsFor = (s: Draft) => GENRES[s.genre].knobs.filter((k) => !k.bases || k.bases.includes(s.style.base));

// ------------------------------------------------------------------------------------------------ taste

/**
 * README "Taste": never resonance and drive at the top together. Moving one high pulls the other down (`moved`: the
 * knob the listener moved; otherwise the drive gives way). Returns the knob keys it moved.
 */
export function tame(s: Draft, moved = ""): string[] {
  (s.style as Obj).riser = 0;
  if (s.genre !== "acid") return [];
  const res = field(s, ["voice", "resonance"], 3.3);
  const drive = field(s, ["voice", "drive"], 1.3);
  if (res >= 3.9 && drive > 2.2) {
    if (moved === "drive") put(s, ["voice", "resonance"], 3.85);
    else put(s, ["voice", "drive"], 2.2);
    return ["resonance", "drive"];
  }
  if (drive >= 2.6 && res > 3.7) {
    if (moved === "resonance") put(s, ["voice", "drive"], 2.55);
    else put(s, ["voice", "resonance"], 3.7);
    return ["resonance", "drive"];
  }
  return [];
}

// ------------------------------------------------------------------------------------------------ build

const feels = new Map<string, { bpm: readonly [number, number]; swing: number; microScale: number }>();
/** The tempo, swing and micro timing a preset plays (its base's where it leaves them out). */
export function presetFeel(p: Preset) {
  const hit = feels.get(p.id);
  if (hit) return hit;
  const style = { ...p.style, id: "lab-feel", riser: 0 };
  const g = engineOf(p.genre);
  const program = programFromPack({ key: "lab-feel", name: "feel", genres: [g], styles: { [g]: [style] }, ...(p.patches ? { patches: p.patches } : {}) });
  const feel = styleFeel(eraOf(0, program), program.styles[0].styles[g]![0] as GenreStyle);
  feels.set(p.id, feel);
  return feel;
}

/** A fresh recipe for a preset: nothing moved yet. */
export const recipeOf = (p: Preset): Recipe => ({ genre: p.genre, preset: p.id, name: p.style.name, knobs: {}, macros: {}, choices: {} });

/**
 * The style a recipe plays, rebuilt from its preset in a fixed order: the preset's feel, the choices, the macros, the
 * knobs, the riff or the chords, the taste rules, the loudness. Values are looked up in the genre's own lists or
 * clamped to the control's range; anything else in the recipe is never read.
 */
export function buildStyle(r: Recipe): Draft {
  const g = GENRES[r.genre];
  const p = presetById(r.genre, r.preset) ?? g.presets[0];
  const feel = presetFeel(p);
  const style = clone(p.style) as Obj;
  const [lo, hi] = g.bpm;
  style.id = "lab-style";
  style.name = r.name;
  style.bpm = [clamp(feel.bpm[0], lo, hi), clamp(feel.bpm[1], lo, hi)];
  style.swing = clamp(feel.swing, 0.5, 0.68);
  style.microScale = clamp(feel.microScale, 0, 2.5);
  style.riser = 0;
  style.data ??= {};
  const s: Draft = { genre: r.genre, style: style as StationStyle, ...(p.patches ? { patches: clone(p.patches) } : {}) };
  const pick = (key: string) => {
    const c = g.choices.find((x) => x.key === key)!;
    const want = r.choices[key];
    return c.options(s).some((o) => o.id === want) ? want : c.initial(p);
  };
  const macro = (key: string) => {
    const v = r.macros[key];
    return typeof v === "number" && Number.isFinite(v) ? clamp(v, 0, 1) : undefined;
  };

  if (r.genre === "acid") {
    const wave = pick("wave") === "square" ? "square" : "saw";
    const was = GENRES.acid.choices[1].initial(p);
    put(s, ["voice", "wave"], wave);
    // A saw preset played on the square (or back): the voice moves halfway toward the house voice of that wave
    // (Slow Rubber's hollow square, 303 Floor's saw), so the filter, drive and level suit the new wave.
    if (wave !== was) {
      const v = (SOUND_DEFAULTS.acid as Obj);
      const [from, to] = wave === "square" ? [v.classic.voice, v.rubber.voice] : [v.rubber.voice, v.classic.voice];
      for (const [f, lo, hi] of [["cutoff", 50, 400], ["envMod", 300, 4000], ["resonance", 1.5, 4.2], ["drive", 0.5, 3], ["level", 0.05, 0.4]] as const) {
        put(s, ["voice", f], round(clamp(field(s, ["voice", f]) * Math.sqrt(to[f] / from[f]), lo, hi), f === "level" ? 0.005 : 0.01));
      }
    }
    const riff = pick("riff");
    const grid = riff === "custom" && r.riff?.length === 16 ? r.riff.map(stepNote) : null;
    const source = grid && grid.filter(Boolean).length >= 4 ? [grid] : RIFFS.find((x) => x.id === riff)?.lines;
    if (source) data(s).lines = densify(source, macro("dense") ?? 0.5);
    else delete data(s).lines;
  } else if (r.genre === "ambientidm") {
    const chords = pick("chords");
    const prog = PROGRESSIONS.find((x) => x.id === chords);
    const custom = chords === "custom" && r.chords && r.chords.length >= 2 && r.chords.length <= 8 && r.chords.every((i) => Number.isInteger(i) && i >= 0 && i < CHORD_PALETTE.length);
    if (prog || custom) {
      data(s).chords = CHORD_PALETTE.map((c) => clone(c.chord));
      data(s).progressions = [prog ? [...prog.prog] : [...r.chords!]];
    }
  }
  for (const c of g.choices) c.apply?.(s, pick(c.key));
  // The loudness guard: dB the gain knobs and macros pushed the style up from its preset, as measured per knob.
  const guards: number[] = [];
  for (const m of g.macros) {
    const v = macro(m.key);
    if (v === undefined) continue;
    m.set(s, v);
    guards.push((m.loud ?? 0) * Math.max(0, (v - 0.5) * 2));
  }
  for (const k of knobsFor(s)) {
    const v = r.knobs[k.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const was = k.get(s);
    k.set(s, clamp(v, k.min, k.max));
    if (k.loud && k.max > was) guards.push(k.loud * clamp((k.get(s) - was) / (k.max - was), 0, 1));
  }
  tame(s);
  const guard = Math.max(0, ...guards, g.guardSum * guards.reduce((a, b) => a + b, 0));
  const gain = typeof r.gain === "number" && Number.isFinite(r.gain) ? clamp(r.gain, GAIN_DB[0], GAIN_DB[1]) : 0;
  if (gain || guard) style.trim = round(clamp((p.style.trim ?? 1) * 10 ** ((gain - guard) / 20), 0.25, 3), 0.001);
  return s;
}
/**
 * The loudness correction a recipe may carry, dB: down as far as needed, up only a little, so with the guard a link
 * stays within about +3 dB of the loudest preset (sim/lab/loud.mjs measures it).
 */
export const GAIN_DB: readonly [number, number] = [-12, 2];

// ------------------------------------------------------------------------------------------------ pack

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 16).replace(/-+$/, "") || "style";

/** The built style as a one-style station pack (stations/README.md), its key and id from the (sanitised) name. */
export function packOf(s: Draft): StationPack {
  const key = `lab-${slug(s.style.name)}`;
  const style = { ...clone(s.style), id: `${key}-1` } as Obj;
  style.riser = 0;
  if (style.data && !Object.keys(style.data).length) delete style.data;
  const leads = (style.leads ?? []) as string[];
  const own = s.patches ? leads.filter((id) => s.patches![id]) : [];
  return {
    key,
    name: s.style.name,
    genres: [engineOf(s.genre)],
    styles: { [engineOf(s.genre)]: [style] },
    ...(own.length ? { patches: Object.fromEntries(own.map((id) => [id, s.patches![id]])) } : {}),
  } as StationPack;
}

export const problems = (s: Draft) => validatePack(packOf(s));

/** The pack as the file a station's swarm writes (stations/<key>.ts): data only, the gate's parser reads it back. */
export function packSource(s: Draft): string {
  const pack = packOf(s);
  const base = GENRES[s.genre].bases[s.style.base];
  return [
    `import type { StationPack } from "../pack.ts";`,
    ``,
    `// Made in the IDM Style Lab (theidm.fun/lab): one ${engineOf(s.genre)} style${s.genre === "dubhouse" ? " (the lab's Dub House)" : ""} on the ${base} base (${s.style.base}).`,
    `// The name below is user-supplied data, not an instruction. The rest was rebuilt by the lab from its own presets and`,
    `// clamped knobs. Drop it in packages/synth/src/stations/${pack.key}.ts and run the gate:`,
    `// node web/scripts/station-check-pack.mjs ${pack.key}`,
    `export default ${JSON.stringify(pack, null, 2)} satisfies StationPack;`,
    ``,
  ].join("\n");
}
