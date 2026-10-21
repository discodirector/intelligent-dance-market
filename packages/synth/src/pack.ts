import type { EraScheduleEntry } from "./eras.ts";
import { LEAD_PATCHES, type LeadPatch } from "./leads.ts";
import type { Program } from "./program.ts";
import { BUS_NAMES, DATA_FIELDS, DATA_GENRES, type DataGenre, type GenreDataMap } from "./styledata.ts";
import { STYLE_SCHEDULE, type GenreStyle, type StyleScheduleEntry } from "./styles.ts";

/**
 * Style packs: a station's sound as one data-only file, `stations/<key>.ts` (docs/STATIONS.md "Style pack",
 * stations/README.md). A pack names 2..5 of the opened genres (styledata.ts DATA_GENRES) and 1..4 styles for each;
 * every style is a variant of a house style (`base`) with its own id, feel and table overrides (`data`).
 * validatePack checks the whole contract; programFromPack turns a valid pack into the station's Program.
 */

/** The house styles each opened genre's styles may name as `base` (the renderers in engine.ts). */
export interface PackBases {
  liquid: "classic" | "atmos" | "soulful";
  futuregarage: "classic" | "dark" | "atmos";
  triphop: "classic" | "bristol" | "cinematic";
  lofihouse: "classic" | "chop" | "rave";
  acid: "classic" | "acidhouse" | "rubber";
}

/**
 * A station style of genre G. Fields left out are inherited from the base style (bpm, swing, microScale, trim,
 * leads); `data` tables left out keep the house tables. So `{ id, name, base }` alone plays exactly like the base.
 */
export interface StationStyle<G extends DataGenre = DataGenre> extends Omit<GenreStyle, "base" | "data"> {
  base: PackBases[G];
  data?: GenreDataMap[G];
}

export interface StationPack {
  /** The station key (registry `program`): lowercase letters, digits and "-", 2..24 characters. */
  key: string;
  /** Display name of the sound, 1..40 characters. */
  name: string;
  /** 2..5 distinct opened genres; the first cycle plays them in this order, later cycles shuffle them. */
  genres: readonly DataGenre[];
  /** For each genre in `genres` (and no other), 1..4 styles, in play order. */
  styles: { readonly [G in DataGenre]?: readonly StationStyle<G>[] };
  /**
   * The pack's own lead patches (the LeadPatch shape of leads.ts, without `id`), by id: 1..8 of them, ids like style
   * ids and not a house patch id. A style's `leads` may name them next to the house patches. Same field ranges as
   * the house patches (PATCH_CHECK).
   */
  patches?: Readonly<Record<string, PackLeadPatch>>;
}

/** A lead patch written in a pack: leads.ts LeadPatch, its id being its key in `patches`. */
export type PackLeadPatch = Omit<LeadPatch, "id">;

/** Station keys the house programs use. */
const HOUSE_KEYS = ["idm", "imd-eth"];

/** Every style id the house schedules ever defined, in any genre: a station id must not reuse one. */
const HOUSE_STYLE_IDS: ReadonlySet<string> = new Set(
  STYLE_SCHEDULE.flatMap((entry) => Object.values(entry.styles).flatMap((list) => (list ?? []).map((s) => s.id))),
);

/** Tempo window a station style's `bpm` range must sit in, per genre (around the house range). */
const PACK_BPM: Record<DataGenre, readonly [number, number]> = {
  liquid: [160, 180],
  futuregarage: [120, 145],
  triphop: [66, 104],
  lofihouse: [112, 132],
  acid: [108, 140],
};

// ---------------------------------------------------------------------------------------------- checks

type Err = (msg: string) => void;
type Check = (x: unknown, path: string, err: Err) => void;

const show = (x: unknown) => {
  try {
    const s = JSON.stringify(x);
    return s === undefined ? String(x) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
  } catch {
    return String(x);
  }
};
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const num =
  (lo: number, hi: number, int = false): Check =>
  (x, p, e) => {
    if (typeof x !== "number" || !Number.isFinite(x) || (int && !Number.isInteger(x)) || x < lo || x > hi) {
      e(`${p}: expected ${int ? "an integer" : "a number"} in ${lo}..${hi}, got ${show(x)}`);
    }
  };
const int = (lo: number, hi: number) => num(lo, hi, true);
const bool: Check = (x, p, e) => {
  if (typeof x !== "boolean") e(`${p}: expected true or false, got ${show(x)}`);
};
const oneOf =
  (values: readonly unknown[]): Check =>
  (x, p, e) => {
    if (!values.includes(x)) e(`${p}: expected one of ${values.map(show).join(", ")}, got ${show(x)}`);
  };
const list =
  (min: number, max: number, each: Check): Check =>
  (x, p, e) => {
    if (!Array.isArray(x)) return e(`${p}: expected a list, got ${show(x)}`);
    if (x.length < min || x.length > max) e(`${p}: expected ${min === max ? min : `${min}..${max}`} entries, got ${x.length}`);
    x.forEach((v, i) => each(v, `${p}[${i}]`, e));
  };
/** An object with exactly these fields; names in `optional` may be left out. */
const shape =
  (fields: Record<string, Check>, optional: readonly string[] = []): Check =>
  (x, p, e) => {
    if (!isObj(x)) return e(`${p}: expected an object, got ${show(x)}`);
    for (const k of Object.keys(x)) if (!(k in fields)) e(`${p}.${k}: unknown field (allowed: ${Object.keys(fields).join(", ")})`);
    for (const [k, check] of Object.entries(fields)) {
      if (x[k] === undefined) {
        if (!optional.includes(k)) e(`${p}.${k}: missing`);
      } else check(x[k], `${p}.${k}`, e);
    }
  };
const both =
  (...checks: Check[]): Check =>
  (x, p, e) => {
    for (const check of checks) check(x, p, e);
  };
/** A fixed-length list: one check per position. */
const tuple =
  (...checks: Check[]): Check =>
  (x, p, e) => {
    if (!Array.isArray(x) || x.length !== checks.length) return e(`${p}: expected [${checks.length} values], got ${show(x)}`);
    checks.forEach((check, i) => check(x[i], `${p}[${i}]`, e));
  };
/** A drum lane: `len` characters of "." (rest) or 1-9 (velocity in ninths); `empty` also allows "". */
const lane =
  (len: number, empty = false): Check =>
  (x, p, e) => {
    if (typeof x !== "string" || !/^[.1-9]*$/.test(x) || !(x.length === len || (empty && x.length === 0))) {
      e(`${p}: expected ${len} characters of "." or 1-9${empty ? ' (or "")' : ""}, got ${show(x)}`);
    }
  };

/** A step note on a grid of `steps` 16ths, plus extra fields. */
const note = (steps: number, extra: Record<string, Check> = {}, optional: readonly string[] = []) =>
  shape({ s: int(0, steps - 1), len: num(0.25, 64), ...extra }, optional);
const coreNote = (steps: number, extra: Record<string, Check> = {}) => note(steps, { core: bool, ...extra });
/** A table of 1..6 figures, each of `min..max` notes. */
const figures = (min: number, max: number, each: Check) => list(1, 6, list(min, max, each));
/** A pad chord: 2..6 tones -12..26, at least two of them in 0..12 (the voices that take the top tones), root -12..12. */
const padChord: Check = both(shape({ pad: list(2, 6, int(-12, 26)), root: int(-12, 12) }), (x, p, e) => {
  const pad = isObj(x) && Array.isArray(x.pad) ? x.pad : [];
  if (pad.filter((t) => typeof t === "number" && t >= 0 && t <= 12).length < 2) e(`${p}.pad: needs at least two tones in 0..12`);
});
const vamps = list(1, 6, shape({ a: padChord, b: padChord }));
const kickFigures = shape({
  lo: list(1, 4, list(1, 6, int(0, 15))),
  mid: list(1, 4, list(1, 6, int(0, 15))),
  hi: list(1, 4, list(1, 6, int(0, 15))),
});
const kickSpec = shape(
  {
    osc: oneOf(["sine", "triangle", "square", "sawtooth"]),
    start: num(40, 250),
    end: num(30, 120),
    sweep: num(0.005, 0.2),
    decay: num(0.05, 1),
    click: num(0, 1),
    clickHp: num(500, 8000),
    drive: num(0, 4),
    body: num(0, 1.5),
  },
  ["osc", "clickHp", "drive", "body"],
);
// Sound fields (styledata.ts "sound"): every number bounded, so a pack can colour the sound but never break it.
const hatFields = { hp: num(1000, 14000), decay: num(0.005, 1), metal: num(0, 1), q: num(0.3, 4), level: num(0, 1.5), off: num(0, 1.5), crush: int(3, 8) };
const hat = shape(hatFields, ["q", "off", "crush"]);
const liquidHat = shape({ ...hatFields, pan: num(-1, 1) }, ["q", "off", "crush"]);
const waves = ["sine", "triangle", "square", "sawtooth"] as const;
const layerCommon = { level: num(0, 1.5), at: num(0, 0.08), tail: bool, pan: num(-1, 1), flip: bool, accent: bool };
const layerOptional = ["at", "tail", "pan", "flip", "accent"];
const toneLayer = shape(
  { tone: oneOf(waves), freq: num(30, 4000), to: num(20, 4000), sweep: num(0.005, 1), decay: num(0.005, 2), attack: num(0.001, 0.5), floor: num(0, 0.2), ...layerCommon },
  ["to", "sweep", "attack", "floor", ...layerOptional],
);
const noiseLayer = shape(
  {
    noise: oneOf(["bandpass", "highpass", "lowpass"]), freq: num(100, 16000), to: num(50, 16000), q: num(0.3, 12), decay: num(0.005, 3),
    attack: num(0, 2), color: num(0, 4000), press: num(0, 0.5), ...layerCommon,
  },
  ["to", "attack", "color", "press", ...layerOptional],
);
const crushLayer = shape(
  { crush: int(3, 8), filter: oneOf(["bandpass", "highpass"]), freq: num(200, 12000), q: num(0.3, 4), decay: num(0.005, 1), level: num(0, 1.5), at: num(0, 0.08), tail: bool, lp: num(1000, 16000) },
  ["q", "at", "tail", "lp"],
);
const clapLayer = shape({ clap: num(0, 1.5), at: num(0, 0.08), flip: bool }, ["at", "flip"]);
/** A drum layer: its kind is the field it has (tone, noise, crush or clap). */
const drumLayer: Check = (x, p, e) => {
  if (!isObj(x)) return e(`${p}: expected a drum layer { tone | noise | crush | clap, ... }, got ${show(x)}`);
  if ("tone" in x) toneLayer(x, p, e);
  else if ("noise" in x) noiseLayer(x, p, e);
  else if ("crush" in x) crushLayer(x, p, e);
  else if ("clap" in x) clapLayer(x, p, e);
  else e(`${p}: a drum layer needs one of tone, noise, crush, clap`);
};
const drumVoice = list(1, 6, drumLayer);
const shaker = shape(
  { freq: num(2000, 14000), color: num(0, 4000), q: num(0.3, 6), decay: num(0.005, 0.3), offDecay: num(0.005, 0.3), attack: num(0, 0.05), level: num(0, 1), off: num(0, 1) },
  ["color", "offDecay", "off"],
);
/** Every field optional: a spec is merged over the base's. */
const partial = (fields: Record<string, Check>) => shape(fields, Object.keys(fields));
const subSpec = partial({ wave: oneOf(["sine", "triangle"]), attack: num(0.002, 0.1), hold: num(0.3, 1), drive: num(0, 4), octave: num(0, 0.5) });
const padSpec = partial({
  osc: list(1, 4, shape({ type: oneOf(waves), detune: num(-40, 40), level: num(0, 1) })),
  cutoff: num(150, 8000), q: num(0.3, 6), attack: num(0.003, 8), release: num(0.02, 6), level: num(0.005, 1), vib: num(0, 30),
  drive: num(0.1, 4), noise: num(0, 1), hp: num(20, 1000),
});
const busLevels = (lo: number, hi: number) => partial(Object.fromEntries(BUS_NAMES.map((b) => [b, num(lo, hi)])));
const fxData = partial({
  echo: partial({ steps: int(1, 8), taps: int(1, 8), fb: num(0, 0.75), lp: num(400, 8000), hp: num(80, 1500) }),
  echoSend: busLevels(0, 1),
  space: partial({ size: num(0.4, 2.5), fb: num(0, 0.85), lp: num(800, 9000) }),
  spaceSend: busLevels(0, 1),
  drumLp: num(1500, 18000),
  drive: num(0.8, 1.8),
  pressDrive: num(0, 0.6),
  duck: partial({ bass: num(0.1, 1), harm: num(0.3, 1) }),
  duckTime: partial({ bass: num(0.05, 0.6), harm: num(0.05, 0.6) }),
  master: partial({ lp: num(2000, 18000), hp: num(20, 200), crush: int(6, 12) }),
});
/** The fields every base reads (styledata.ts SoundData). */
const SOUND_CHECKS = { mix: busLevels(-6, 6), fx: fxData, vinyl: num(0, 2.5) };

const liquidKit = shape(
  {
    kick: kickSpec,
    kickLevel: num(0, 2),
    snare: (x, p, e) => (typeof x === "string" ? oneOf(["keys", "soft", "soul"])(x, p, e) : drumVoice(x, p, e)),
    snareLevel: num(0, 2),
    ghostLevel: num(0, 1),
    hat: liquidHat,
    shaker: liquidHat,
    open: liquidHat,
    crash: num(0, 0.5),
    breaks: list(1, 4, shape({ kick: lane(32), snare: lane(32), ghost: lane(32), hat: lane(32), open: lane(32, true) })),
  },
  ["kick", "kickLevel", "snare", "snareLevel", "ghostLevel", "hat", "shaker", "open", "crash", "breaks"],
);
const garageChord = shape(
  { bass: int(-12, 12), pad: list(3, 6, int(-12, 26)), hook: list(5, 5, int(0, 26)), guide: int(0, 24), dark: list(3, 3, int(-12, 26)) },
  ["hook"],
);
const tripHopKeys = list(1, 8, note(32, { p: oneOf(["C", "U", "L", 0, 1, 2, 3]), opt: bool }, ["opt"]));
const acidNote: Check = (x, p, e) => {
  if (x === null) return;
  shape({ degree: int(0, 4), octave: int(-1, 1), flags: int(0, 7), gate: num(0.1, 4) }, ["gate"])(x, p, e);
};
/**
 * A lead patch (leads.ts LeadPatch without `id`). The ranges hold every house patch in LEAD_PATCHES (test/pack.test.ts
 * checks them all), so a pack patch can be anything from a glass bell to an acid lead, and nothing beyond.
 */
export const PATCH_CHECK: Check = shape(
  {
    name: (x, p, e) => (typeof x !== "string" || x.trim().length === 0 || x.length > 24) && e(`${p}: expected 1..24 characters, got ${show(x)}`),
    osc: list(1, 5, shape({ type: oneOf([...waves, "pulse25", "pulse12"]), detune: num(-50, 50), oct: int(-2, 2), level: num(0, 1.5) })),
    fm: shape({ ratio: num(0.25, 8), index: num(0, 8), decay: num(0.01, 3), floor: num(0, 1) }),
    filter: shape({ type: oneOf(["lowpass", "bandpass", "highpass"]), cutoff: num(100, 12000), env: num(0, 6000), decay: num(0.01, 2), q: num(0.3, 14) }),
    formants: tuple(num(200, 3000), num(200, 4000)),
    amp: shape({ a: num(0.001, 1), d: num(0.01, 3), s: num(0, 1), r: num(0.02, 2) }),
    vib: shape({ rate: num(0.5, 10), depth: num(0, 40), delay: num(0, 1) }),
    glide: num(0, 0.3),
    blip: num(-24, 24),
    noise: num(0, 0.3),
    drive: num(0, 4),
    gain: num(0.1, 1.5),
  },
  ["fm", "formants", "vib", "glide", "blip", "noise", "drive"],
);

const garageKit = partial({ kick: kickSpec, snare: drumVoice, ghost: list(0, 6, drumLayer), hat, shaker, open: hat });
const tripHopKit = partial({ kick: kickSpec, snare: drumVoice, drag: num(0, 0.04), hat, open: hat });
const lofiKit = partial({ kick: kickSpec, clap: drumVoice, snare: drumVoice, hat, open: hat, shaker });
const acidKit = partial({ kick: kickSpec, clap: drumVoice, snare: drumVoice, hat, open: hat, perc: drumVoice });

/** The check of every data field, per genre (shapes and ranges as documented in styledata.ts). */
const FIELD_CHECKS: { readonly [G in DataGenre]: Readonly<Record<keyof GenreDataMap[G] & string, Check>> } = {
  liquid: {
    vamps,
    stabs: figures(1, 12, coreNote(64)),
    answers: figures(1, 4, note(16)),
    contours: list(1, 6, list(4, 16, int(0, 7))),
    phrases: figures(1, 12, coreNote(64)),
    kit: liquidKit,
    fills: list(1, 6, shape({ kick: lane(8), snare: lane(8) })),
    sub: num(0, 1),
    progressions: list(1, 6, list(4, 4, padChord)),
    walks: figures(1, 12, coreNote(32, { oct: int(0, 1) })),
    comps: figures(1, 10, coreNote(32)),
    ...SOUND_CHECKS,
    bass: subSpec,
    pad: padSpec,
    choir: padSpec,
    strings: padSpec,
  },
  futuregarage: {
    chords: list(2, 12, garageChord),
    progressions: list(1, 6, list(1, 8, int(0, 11))),
    skips: figures(1, 10, tuple(int(0, 31), num(0, 1))),
    foley: figures(1, 10, tuple(int(0, 31), int(0, 2))),
    kicks: kickFigures,
    sub: num(0, 1.2),
    vamps,
    choirs: figures(1, 10, coreNote(32, { swell: bool })),
    pans: figures(1, 8, note(32)),
    ...SOUND_CHECKS,
    kit: garageKit,
    bass: subSpec,
    reese: partial({ detune: num(0, 40), drive: num(0.1, 5), cutoff: num(60, 1200), q: num(0.3, 8), depth: num(0, 1), level: num(0, 0.2) }),
    pad: padSpec,
    choir: padSpec,
    vowels: list(1, 6, tuple(num(200, 1200), num(600, 3000))),
    rain: num(0, 2.5),
  },
  triphop: {
    chords: (x, p, e) => {
      if (!isObj(x)) return e(`${p}: expected an object of chords by name, got ${show(x)}`);
      const chord = shape({ root: int(0, 11), voice: list(4, 4, int(-12, 24)), alt: list(4, 4, int(-12, 24)) });
      for (const [name, c] of Object.entries(x)) chord(c, `${p}.${name}`, e);
    },
    progressions: list(1, 6, list(4, 4, (x, p, e) => typeof x !== "string" && e(`${p}: expected a chord name, got ${show(x)}`))),
    statements: list(1, 4, tripHopKeys),
    answers: list(1, 4, tripHopKeys),
    turns: list(1, 4, tripHopKeys),
    space: list(1, 4, tripHopKeys),
    kicks: kickFigures,
    sub: num(0, 1),
    pedal: list(4, 4, int(0, 12)),
    strings: list(2, 5, int(-12, 24)),
    calls: figures(1, 6, note(32, { semi: int(-12, 24) })),
    voicings: list(2, 4, shape({ pad: list(3, 5, int(-12, 24)), root: int(-12, 12) })),
    cuts: list(1, 10, coreNote(32)),
    ...SOUND_CHECKS,
    kit: tripHopKit,
    bass: subSpec,
    bassTone: partial({
      wave: oneOf(waves), cutoff: num(80, 2000), color: num(0, 2000), q: num(0.3, 8), drive: num(0.1, 5), level: num(0.01, 0.3), sustain: num(0.001, 0.3),
    }),
    bowed: padSpec,
  },
  lofihouse: {
    vamps,
    stabs: figures(1, 12, coreNote(32)),
    chops: figures(1, 16, coreNote(32, { slice: int(0, 3) })),
    organ: list(2, 8, int(0, 12)),
    sub: num(0, 1),
    ...SOUND_CHECKS,
    kit: lofiKit,
    bass: subSpec,
    organTone: partial({
      drawbars: list(1, 6, tuple(num(0.5, 8), num(0, 1))), drive: num(0.1, 4), cutoff: num(300, 6000), q: num(0.3, 6),
      level: num(0, 0.4), click: num(0, 0.1), sub: num(0, 1),
    }),
    pad: padSpec,
    chop: padSpec,
    pump: partial({ bass: num(0.05, 1), harm: num(0.05, 1), release: num(1, 8) }),
  },
  acid: {
    lines: list(1, 6, both(list(16, 16, acidNote), (x, p, e) => {
      if (Array.isArray(x) && x.filter((n) => n !== null).length < 4) e(`${p}: needs at least 4 notes`);
    })),
    ...SOUND_CHECKS,
    kit: acidKit,
    voice: partial({
      wave: oneOf(["saw", "square"]), cutoff: num(50, 400), envMod: num(300, 4000), resonance: num(1.5, 4.2), decay: num(0.05, 0.6),
      drive: num(0.5, 3), level: num(0.05, 0.4), accent: num(1, 1.6), gate: num(0.1, 4), sweep: num(4, 32),
    }),
  },
};

/** Fields whose valid values depend on another table (progression indices / names), checked on the tables in force. */
function crossCheck(genre: DataGenre, data: Record<string, unknown>, p: string, e: Err) {
  if (genre === "futuregarage" && Array.isArray(data.progressions)) {
    const n = Array.isArray(data.chords) ? data.chords.length : 7;
    data.progressions.forEach((prog, i) => {
      if (Array.isArray(prog)) prog.forEach((c, j) => typeof c === "number" && c >= n && e(`${p}.progressions[${i}][${j}]: chord ${c} is not in chords (0..${n - 1})`));
    });
  }
  if (genre === "triphop" && Array.isArray(data.progressions)) {
    const names = new Set(["i", "iv", "VI", "VII", "v", "IV", ...(isObj(data.chords) ? Object.keys(data.chords) : [])]);
    data.progressions.forEach((prog, i) => {
      if (Array.isArray(prog)) prog.forEach((c, j) => typeof c === "string" && !names.has(c) && e(`${p}.progressions[${i}][${j}]: unknown chord "${c}" (known: ${[...names].join(" ")})`));
    });
  }
}

/** The style a base names, from the house lists of its genre. */
function houseStyle(genre: DataGenre, id: string): GenreStyle | undefined {
  for (const entry of STYLE_SCHEDULE) {
    const hit = entry.styles[genre]?.find((s) => s.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function checkStyle(genre: DataGenre, style: unknown, p: string, e: Err, seen: Set<string>, patchIds: readonly string[]) {
  if (!isObj(style)) return e(`${p}: expected a style object, got ${show(style)}`);
  const allowed = ["id", "name", "base", "bpm", "swing", "microScale", "trim", "leads", "data"];
  for (const k of Object.keys(style)) if (!allowed.includes(k)) e(`${p}.${k}: unknown field (allowed: ${allowed.join(", ")})`);
  const { id, name, base, bpm, swing, microScale, trim, leads, data } = style;
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{1,23}$/.test(id)) e(`${p}.id: expected 2..24 of a-z 0-9 "-" starting with a letter, got ${show(id)}`);
  else if (HOUSE_STYLE_IDS.has(id)) e(`${p}.id: "${id}" is a house style id; give the station style its own id`);
  else if (seen.has(id)) e(`${p}.id: "${id}" is used twice in this pack`);
  else seen.add(id);
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 24) e(`${p}.name: expected 1..24 characters, got ${show(name)}`);
  const bases = Object.keys(DATA_FIELDS[genre]);
  if (typeof base !== "string" || !bases.includes(base) || !houseStyle(genre, base)) {
    return e(`${p}.base: expected one of ${bases.join(", ")} (a ${genre} house style), got ${show(base)}`);
  }
  if (bpm !== undefined) {
    const [lo, hi] = PACK_BPM[genre];
    list(2, 2, num(lo, hi))(bpm, `${p}.bpm`, e);
    if (Array.isArray(bpm) && bpm[0] > bpm[1]) e(`${p}.bpm: expected [low, high], got ${show(bpm)}`);
  }
  if (swing !== undefined) num(0.5, 0.68)(swing, `${p}.swing`, e);
  if (microScale !== undefined) num(0, 2.5)(microScale, `${p}.microScale`, e);
  if (trim !== undefined) num(0.25, 3)(trim, `${p}.trim`, e);
  if (leads !== undefined) {
    const known = (x: unknown) => typeof x === "string" && (x in LEAD_PATCHES || patchIds.includes(x));
    list(1, 4, (x, q, err) => !known(x) && err(`${q}: unknown lead patch ${show(x)} (leads.ts, or the pack's patches)`))(leads, `${p}.leads`, e);
  }
  if (data === undefined) return;
  if (!isObj(data)) return e(`${p}.data: expected an object, got ${show(data)}`);
  const fields = DATA_FIELDS[genre][base] as readonly string[];
  const checks = FIELD_CHECKS[genre] as Record<string, Check>;
  for (const [k, v] of Object.entries(data)) {
    if (!(k in checks)) e(`${p}.data.${k}: unknown ${genre} table (styledata.ts)`);
    else if (!fields.includes(k)) e(`${p}.data.${k}: base "${base}" does not read it (it reads: ${fields.join(", ")})`);
    else if (v !== undefined) checks[k](v, `${p}.data.${k}`, e);
  }
  crossCheck(genre, data, `${p}.data`, e);
}

/** Every rule a pack breaks, as "path: problem" lines; empty when the pack is valid. */
export function validatePack(pack: unknown): string[] {
  const errors: string[] = [];
  const e: Err = (msg) => void errors.push(msg);
  if (!isObj(pack)) return [`pack: expected an object (export default { key, name, genres, styles }), got ${show(pack)}`];
  const top = ["key", "name", "genres", "styles", "patches"];
  for (const k of Object.keys(pack)) if (!top.includes(k)) e(`${k}: unknown field (allowed: ${top.join(", ")})`);
  const { key, name, genres, styles, patches } = pack;
  const patchIds: string[] = [];
  if (patches !== undefined) {
    if (!isObj(patches) || Object.keys(patches).length < 1 || Object.keys(patches).length > 8) e(`patches: expected an object of 1..8 lead patches by id, got ${show(patches)}`);
    else {
      for (const [id, patch] of Object.entries(patches)) {
        if (!/^[a-z][a-z0-9-]{1,23}$/.test(id)) e(`patches.${id}: expected an id of 2..24 a-z 0-9 "-" starting with a letter`);
        else if (id in LEAD_PATCHES) e(`patches.${id}: "${id}" is a house lead patch; give yours its own id`);
        else patchIds.push(id);
        PATCH_CHECK(patch, `patches.${id}`, e);
      }
    }
  }
  if (typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{1,23}$/.test(key)) e(`key: expected 2..24 of a-z 0-9 "-", got ${show(key)}`);
  else if (HOUSE_KEYS.includes(key)) e(`key: "${key}" is a house station`);
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 40) e(`name: expected 1..40 characters, got ${show(name)}`);
  const pool: DataGenre[] = [];
  if (!Array.isArray(genres)) e(`genres: expected a list of 2..5 of ${DATA_GENRES.join(", ")}`);
  else {
    if (genres.length < 2 || genres.length > 5) e(`genres: expected 2..5 genres, got ${genres.length}`);
    genres.forEach((g, i) => {
      if (!(DATA_GENRES as readonly unknown[]).includes(g)) e(`genres[${i}]: expected one of ${DATA_GENRES.join(", ")}, got ${show(g)}`);
      else if (pool.includes(g as DataGenre)) e(`genres[${i}]: "${g}" is listed twice`);
      else pool.push(g as DataGenre);
    });
  }
  if (!isObj(styles)) return [...errors, `styles: expected an object { <genre>: [style, ...] }`];
  for (const g of Object.keys(styles)) if (!pool.includes(g as DataGenre)) e(`styles.${g}: not in genres`);
  const seen = new Set<string>();
  for (const g of pool) {
    const list = styles[g];
    if (!Array.isArray(list) || list.length < 1 || list.length > 4) {
      e(`styles.${g}: expected 1..4 styles, got ${Array.isArray(list) ? list.length : show(list)}`);
      continue;
    }
    list.forEach((style, i) => checkStyle(g, style, `styles.${g}[${i}]`, e, seen, patchIds));
  }
  return errors;
}

/** Throws with every problem listed when the pack is invalid. */
export function assertPack(pack: unknown): asserts pack is StationPack {
  const errors = validatePack(pack);
  if (errors.length) throw new Error(`invalid style pack:\n  ${errors.join("\n  ")}`);
}

/**
 * A station style with the base's feel filled in where the pack leaves it out (the base's id and name are its own),
 * and the pack's own lead patches its `leads` name.
 */
function resolveStyle(genre: DataGenre, style: StationStyle, patches: StationPack["patches"]): GenreStyle {
  const { id: _id, name: _name, ...inherit } = houseStyle(genre, style.base)!;
  const own = (style.leads ?? []).filter((id) => patches?.[id]);
  if (!own.length) return { ...inherit, ...style };
  return { ...inherit, ...style, patches: Object.fromEntries(own.map((id) => [id, { id, ...patches![id] }])) };
}

const programs = new WeakMap<StationPack, Program>();

/**
 * The station's Program: its genres from epoch 0 (first cycle in listed order, then shuffled cycles of the pool,
 * eras.ts eraOf) and its style lists from epoch 0, each style resolved over its base. Validates first (throws).
 * One Program per pack object, so the schedule caches (keyed on the arrays) are shared by every caller.
 * A live station is frozen like the house: changes go in as appended entries, never edits (stations/README.md).
 */
export function programFromPack(pack: StationPack): Program {
  const hit = programs.get(pack);
  if (hit) return hit;
  assertPack(pack);
  const eras: EraScheduleEntry[] = [{ fromEpoch: 0, ids: [...pack.genres] }];
  const lists: StyleScheduleEntry["styles"] = Object.fromEntries(
    pack.genres.map((g) => [g, (pack.styles[g] as readonly StationStyle[]).map((s) => resolveStyle(g, s, pack.patches))]),
  );
  const program: Program = { key: pack.key, eras, styles: [{ fromEpoch: 0, styles: lists }] };
  programs.set(pack, program);
  return program;
}
