import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VoiceEngine } from "../src/engine.ts";
import {
  DATA_FIELDS,
  eraById,
  eraOf,
  HOUSE_PROGRAM,
  initialState,
  planSteps,
  programFromPack,
  SOUND_DEFAULTS,
  styleById,
  styleOf,
  validatePack,
  type GenreId,
  type GenreStyle,
  type Program,
  type StationPack,
} from "../src/index.ts";
import demo from "./fixtures/ambient-demo.ts";

// Style packs on the two genres opened last, ambientidm and drone (styledata.ts AmbientIdmData, DroneData): the demo
// pack validates, out-of-range and misplaced values are refused, and every note/phrase field is live. The sound fields,
// the base-only identity and the restated SOUND_DEFAULTS are covered for every opened genre in test/pack.test.ts.

/** A deep copy of the demo to break in one place. */
const copy = (): any => JSON.parse(JSON.stringify(demo));

describe("validatePack: ambientidm and drone", () => {
  it("accepts the demo pack", () => {
    expect(validatePack(demo)).toEqual([]);
  });

  const amb = (p: any, i: number) => p.styles.ambientidm[i].data;
  const drn = (p: any, i: number) => p.styles.drone[i].data;
  const bad: [string, (p: any) => void, RegExp][] = [
    // Notes and phrases.
    ["a Tape Keys figure step past two bars", (p) => (amb(p, 0).figures[0][0][0] = 32), /figures\[0\]\[0\]\[0\]: expected an integer in 0\.\.31/],
    ["an arp tone past the colour tone", (p) => (amb(p, 0).figures[0][1][1] = 7), /figures\[0\]\[1\]\[1\]/],
    ["a progression naming a chord that is not there", (p) => (amb(p, 0).progressions[0][1] = 5), /progressions\[0\]\[1\]: chord 5 is not in chords \(0\.\.4\)/],
    ["a chord table with an index the progressions use left out", (p) => (amb(p, 0).chords = [{ bass: 0, pad: [0, 7, 10], glass: [0, 7], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] }, { bass: 3, pad: [3, 10, 15], glass: [3, 10], arp: [3, 7, 10, 15], sing: [7, 10, 5, 3, 12] }]), /progressions\[0\]\[1\]: chord 3 is not in chords \(0\.\.1\)/],
    ["a Tape Haze pad with one tone at or above the root", (p) => (amb(p, 2).chords = Array(5).fill({ bass: 0, pad: [-12, -5, 0], glass: [0, 7], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] })), /chords\[0\]\.pad: needs at least two tones at or above 0/],
    ["tiers high before low", (p) => (amb(p, 0).tiers = [0.8, 0.2]), /tiers: expected \[low, high\]/],
    ["a phrase note longer than two bars", (p) => (amb(p, 2).phrases[0][0][2] = 40), /phrases\[0\]\[0\]\[2\]: expected a number in 1\.\.32/],
    ["an arp cell past two octaves", (p) => (amb(p, 1).arps[0][0] = 9), /arps\[0\]\[0\]/],
    ["a blip note pool of one", (p) => (amb(p, 1).notes = [0]), /notes: expected 2\.\.12 entries/],
    ["drone phrases of one bar", (p) => (drn(p, 0).bars = 1), /bars: expected an integer in 2\.\.16/],
    ["a seven-tone wall voicing", (p) => (drn(p, 0).voicing = [0, 7, 12, 16, 19, 24, 28]), /voicing: expected 2\.\.6 entries/],
    ["Overtone Pulse with one glint", (p) => (drn(p, 2).glints = [3]), /Overtone Pulse needs at least 2 glints/],
    ["an Overtone Pulse glint that is not a harmonic of the series", (p) => (drn(p, 2).glints = [3, 17]), /glints\[1\]/],
    ["a partial past the 16th", (p) => (drn(p, 2).partials[0].n = 17), /partials\[0\]\.n/],
    ["thirteen partials", (p) => (drn(p, 2).partials = Array.from({ length: 13 }, (_, i) => ({ n: 1 + i, g: 0.1, group: 1 }))), /partials: expected 1\.\.12 entries/],
    ["a partial in group 4", (p) => (drn(p, 2).partials[0].group = 4), /partials\[0\]\.group/],
    ["a fifth figure value of 2", (p) => (drn(p, 2).figures = [[0, 2]]), /figures\[0\]\[1\]/],
    // Sound.
    ["a kit part the base does not play", (p) => (amb(p, 0).kit.click = [{ tone: "sine", freq: 200, decay: 0.05, level: 0.3 }]), /kit\.click: base "classic" does not play it/],
    ["a rim without a pitch", (p) => (amb(p, 1).kit.rim = { level: 0.3 }), /kit\.rim\.pitch: missing/],
    ["a lead oscillator three octaves up", (p) => (amb(p, 2).lead.osc = [{ type: "triangle", oct: 3, detune: 0, level: 0.5 }]), /lead\.osc\[0\]\.oct/],
    ["a scoop of two semitones", (p) => (amb(p, 2).lead.scoop = 200), /lead\.scoop: expected a number in 0\.\.100/],
    ["a glass bed of seven partials", (p) => (amb(p, 1).glass.partials = Array(7).fill({ type: "sine", ratio: 1, detune: 0, level: 0.1 })), /glass\.partials: expected 1\.\.6 entries/],
    ["a shimmer ringing 2 s", (p) => (amb(p, 1).shimmer.decay = 2), /shimmer\.decay: expected a number in 0\.05\.\.1\.5/],
    ["a bell louder than 0.12", (p) => (amb(p, 1).bell.level = 0.2), /bell\.level/],
    ["a field the base does not read", (p) => (amb(p, 1).pad = { level: 0.05 }), /data\.pad: base "crystal" does not read it/],
    ["a wall field on Dark Low", (p) => (drn(p, 1).wall = { level: 0.05 }), /data\.wall: base "dark" does not read it/],
    ["a Wall-only field on Dark Low's pad", (p) => (drn(p, 1).pad.depth = 0.2), /data\.pad\.depth: unknown field/],
    ["a wall breathing every 2 s", (p) => (drn(p, 0).wall.period = 2), /wall\.period: expected a number in 6\.\.60/],
    ["a wall core above the voicing", (p) => (drn(p, 0).wall.core = [[5, 0.2]]), /wall\.core\[0\]\[0\]/],
    ["seven beating subs", (p) => (drn(p, 1).bed.subs = Array(7).fill([0, 5, 0.3])), /bed\.subs: expected 1\.\.6 entries/],
    ["a concussion swept from 200 Hz", (p) => (drn(p, 1).kick.start = 200), /kick\.start: expected a number in 30\.\.120/],
    ["an overtone with three depths", (p) => (drn(p, 2).overtone.depths = [0.1, 0.5, 0.5]), /overtone\.depths: expected 4 entries/],
    ["glints every half beat", (p) => (drn(p, 0).glint.gap = 0.5), /glint\.gap/],
    ["a loud breath", (p) => (drn(p, 0).breath = 0.2), /breath: expected a number in 0\.\.0\.08/],
    ["a drone drum lowpass of 100 Hz", (p) => (drn(p, 1).fx = { drumLp: 100 }), /fx\.drumLp: expected a number in 150\.\.18000/],
    ["an ambient drum lowpass of 240 Hz (only the drone goes that low)", (p) => (amb(p, 0).fx.drumLp = 240), /fx\.drumLp: expected a number in 1500\.\.18000/],
    ["a drone echo of 13 steps", (p) => (drn(p, 0).fx.echo = { steps: 13 }), /fx\.echo\.steps: expected an integer in 1\.\.12/],
    ["an ambient tempo outside the window", (p) => (p.styles.ambientidm[0].bpm = [60, 80]), /ambientidm\[0\]\.bpm\[0\]/],
    ["a drone tempo outside the window", (p) => (p.styles.drone[0].bpm = [90, 110]), /drone\[0\]\.bpm\[1\]/],
  ];
  for (const [what, breakIt, message] of bad) {
    it(`rejects ${what}`, () => {
      const p = copy();
      breakIt(p);
      const errors = validatePack(p);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(message);
    });
  }
});

/** A stand-in BaseAudioContext that logs every node, connection, parameter write and buffer (as test/pack.test.ts). */
function recordingContext() {
  const log: string[] = [];
  let next = 0;
  const hashData = (data: ArrayLike<number>) => createHash("sha1").update(Buffer.from(Float32Array.from(data).buffer)).digest("hex").slice(0, 12);
  const fmt = (x: unknown): string => {
    if (x === null || x === undefined || typeof x !== "object") return typeof x === "function" ? ((x as any).__id ?? "fn") : String(x);
    if ((x as any).__id) return (x as any).__id;
    if ((x as any).__buffer) return `${(x as any).__buffer}:${(x as any).channels.map(hashData).join("/")}`;
    if (ArrayBuffer.isView(x)) return `f32:${hashData(x as unknown as ArrayLike<number>)}`;
    if (Array.isArray(x)) return `[${x.map(fmt).join(",")}]`;
    return JSON.stringify(x);
  };
  const node = (id: string): any => {
    const stored = new Map<PropertyKey, unknown>();
    const kids = new Map<PropertyKey, unknown>();
    return new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "__id") return id;
        if (prop === "then" || typeof prop === "symbol") return undefined;
        if (stored.has(prop)) return stored.get(prop);
        if (prop === "value") return 0;
        if (!kids.has(prop)) kids.set(prop, node(`${id}.${String(prop)}`));
        return kids.get(prop);
      },
      set(_, prop, value) {
        log.push(`${id}.${String(prop)}=${fmt(value)}`);
        stored.set(prop, value);
        return true;
      },
      apply(_, __, args) {
        log.push(`${id}(${args.map(fmt).join(",")})`);
        if (id.endsWith(".connect")) return args[0];
        return node(`${id}()`);
      },
    });
  };
  const ctx: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "sampleRate") return 44100;
        if (prop === "currentTime") return 0;
        if (prop === "then" || typeof prop === "symbol") return undefined;
        if (prop === "createBuffer") {
          return (channels: number, length: number, sampleRate: number) => {
            const buf = { __buffer: `buf${next++}`, length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, channels: [] as Float32Array[] };
            for (let i = 0; i < channels; i++) buf.channels.push(new Float32Array(length));
            log.push(`createBuffer(${channels},${length},${sampleRate})`);
            return Object.assign(buf, { getChannelData: (i: number) => buf.channels[i] });
          };
        }
        return (...args: unknown[]) => {
          const id = `n${next++}`;
          log.push(`${String(prop)}(${args.map(fmt).join(",")})->${id}`);
          return node(id);
        };
      },
    },
  );
  return { ctx, log };
}

/** The hash of everything an engine schedules for `genre` at `epoch` in `program` over a busy stretch (as test/pack.test.ts). */
function schedule(genre: GenreId, epoch: number, program: Program, seconds: number): string {
  const { ctx, log } = recordingContext();
  const engine = new VoiceEngine(ctx, eraById(genre).index, epoch, program);
  const busy = (k: number) => ({
    ...initialState(),
    patternId: 4 * epoch + (k % 4),
    pattern: 0x9249_2492_4924_9249n ^ BigInt(k * 0x1357),
    bass: 0x8421_8421_8421_8421n >> BigInt(k % 5),
    heat: Math.min(1, k / 6),
    pressure: (k % 3) * 3000 - 3000,
    lastTick: k * 400,
  });
  const points = Array.from({ length: 8 }, (_, k) => ({ time: k * (seconds / 8), state: busy(k) }));
  for (const hit of planSteps(points, seconds, genre, 8, program)) if (hit.time < seconds) engine.trigger(hit);
  return createHash("sha256").update(log.join("\n")).digest("hex");
}

type Opened = "ambientidm" | "drone";

/** The first epoch the house plays `base` of `genre`, and a station program playing a style on it with `data` there. */
function stationAt(genre: Opened, base: string, data: Record<string, unknown>) {
  const era = eraById(genre);
  let epoch = 0;
  while (!(eraOf(epoch).id === genre && styleOf(era, epoch).style.id === base)) epoch++;
  const pack = {
    key: "notes",
    name: "Notes",
    genres: [genre, "acid"],
    styles: { [genre]: [{ id: `n-${base}`, name: "N", base, data }], acid: [{ id: "n-other", name: "O", base: "classic" }] },
  } as unknown as StationPack;
  expect(validatePack(pack)).toEqual([]);
  return { epoch, station: programFromPack(pack) };
}

/** Another table for each note / phrase field (the sound fields are nudged in test/pack.test.ts). */
const CHORDS = [
  { bass: 0, pad: [-12, 0, 5, 7, 15], glass: [0, 5, 7, 12, 19], arp: [0, 5, 7, 15], sing: [5, 7, 3, 0, 10] },
  { bass: 5, pad: [-7, 5, 10, 12, 17], glass: [5, 10, 12, 17, 24], arp: [5, 7, 10, 12], sing: [10, 12, 7, 5, 15] },
  { bass: -2, pad: [-14, 3, 7, 10, 17], glass: [-2, 3, 7, 10, 17], arp: [-2, 3, 7, 10], sing: [7, 10, 12, 3, 5] },
  { bass: 3, pad: [-9, 3, 7, 10, 15], glass: [3, 7, 10, 15, 22], arp: [3, 7, 10, 15], sing: [7, 10, 5, 3, 12] },
  { bass: 0, pad: [-12, 0, 7, 12, 15], glass: [0, 7, 12, 15, 19], arp: [0, 7, 12, 15], sing: [3, 7, 5, 0, 10] },
];
const NOTE_VALUES: { [G in Opened]: Record<string, unknown> } = {
  ambientidm: {
    chords: CHORDS,
    progressions: [[1, 0], [3, 2]],
    figures: [[[0, 3, 0], [4, 1, 0], [8, 2, 0], [12, 0, 0], [16, 3, 0], [20, 1, 0], [24, 2, 0], [28, 0, 0]]],
    phrases: [[[0, 1, 8, 0, 0], [16, 0, 8, 0, 0], [32, 2, 8, 0, 0], [48, 1, 8, 0, 0], [64, 0, 8, 0, 0], [80, 2, 8, 0, 0], [96, 1, 8, 0, 0], [112, 0, 8, 0, 0]]],
    arps: [[8, 4, 0, 4]],
    tiers: [0, 0.01],
    notes: [0, 12],
  },
  drone: {
    bars: 6,
    voicing: [0, 5, 12],
    colours: [[0, 5, 10, 12]],
    busy: 36,
    glints: [12, 16],
    partials: [{ n: 1, g: 0.4, group: 0 }, { n: 3, g: 0.3, group: 1 }, { n: 5, g: 0.2, group: 2 }],
    figures: [[1]],
  },
};

describe("ambientidm and drone: every note and phrase field is live", () => {
  for (const genre of ["ambientidm", "drone"] as const) {
    for (const [base, fields] of Object.entries(DATA_FIELDS[genre])) {
      const notes = (fields as readonly string[]).filter((f) => !(f in SOUND_DEFAULTS[genre][base]));
      it(`${genre}/${base}: ${notes.join(", ")}`, () => {
        const house = schedule(genre, stationAt(genre, base, {}).epoch, HOUSE_PROGRAM, 80);
        for (const field of notes) {
          // Overtone Pulse's glints are harmonic numbers, the others semitones.
          const value = genre === "drone" && base === "pulse" && field === "glints" ? [3, 5] : NOTE_VALUES[genre][field];
          expect(value, `${field} has a test value`).toBeDefined();
          const { epoch, station } = stationAt(genre, base, { [field]: value });
          expect(schedule(genre, epoch, station, 80), field).not.toBe(house);
        }
      });
    }
  }
});

describe("the demo pack", () => {
  const station = programFromPack(demo);

  it("plays its genres and styles", () => {
    const seq = Array.from({ length: 64 }, (_, e) => eraOf(e, station).id);
    expect(seq.slice(0, 2)).toEqual(demo.genres);
    expect(new Set(seq)).toEqual(new Set(demo.genres));
  });

  it("every style differs from itself without data", () => {
    for (const genre of demo.genres) {
      const era = eraById(genre);
      for (const style of demo.styles[genre]!) {
        let epoch = 0;
        while (!(eraOf(epoch, station).id === genre && styleOf(era, epoch, station).style.id === style.id)) epoch++;
        const resolved = styleById(era, style.id, station).style;
        const pinned = (s: GenreStyle): Program => ({ key: "pin", eras: [{ fromEpoch: 0, ids: [genre] }], styles: [{ fromEpoch: 0, styles: { [genre]: [s] } }] });
        expect(schedule(genre, epoch, pinned(resolved), 40), style.id).not.toBe(schedule(genre, epoch, pinned({ ...resolved, data: undefined }), 40));
      }
    }
  });
});
