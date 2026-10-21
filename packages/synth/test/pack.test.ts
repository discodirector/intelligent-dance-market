import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VoiceEngine } from "../src/engine.ts";
import {
  DATA_FIELDS,
  DATA_GENRES,
  eraById,
  eraOf,
  HOUSE_PROGRAM,
  initialState,
  LEAD_PATCHES,
  planSteps,
  programFromPack,
  SOUND_DEFAULTS,
  styleById,
  styleOf,
  validatePack,
  type DataGenre,
  type GenreId,
  type GenreStyle,
  type Program,
  type StationPack,
} from "../src/index.ts";
import { PATCH_CHECK } from "../src/pack.ts";
import example from "../src/stations/example.ts";

// Style packs (pack.ts, stations/README.md): validation, the program a pack makes, and the override path being
// transparent (a station style with a base and no data schedules exactly what the base does).

/** A deep copy of the example to break in one place. */
const copy = (): any => JSON.parse(JSON.stringify(example));

describe("validatePack", () => {
  it("accepts the example pack", () => {
    expect(validatePack(example)).toEqual([]);
  });

  const bad: [string, (p: any) => void, RegExp][] = [
    ["a house style id", (p) => (p.styles.liquid[0].id = "soulful"), /house style id/],
    ["a duplicate id", (p) => (p.styles.acid[1].id = p.styles.acid[0].id), /used twice/],
    ["a base of another genre", (p) => (p.styles.acid[0].base = "soulful"), /styles\.acid\[0\]\.base/],
    ["one genre", (p) => (p.genres = ["acid"]), /2\.\.5 genres/],
    ["a genre not opened to data", (p) => (p.genres = ["acid", "drone"]), /genres\[1\]/],
    ["styles for a genre outside genres", (p) => (p.genres = ["acid", "triphop"]), /styles\.liquid: not in genres/],
    ["five styles", (p) => p.styles.acid.push(...p.styles.acid.map((s: any, i: number) => ({ ...s, id: `x${i}` })), { ...p.styles.acid[0], id: "x9" }), /1\.\.4 styles/],
    ["a table the base does not read", (p) => (p.styles.liquid[0].data.walks = []), /does not read it/],
    ["an unknown table", (p) => (p.styles.liquid[0].data.vibes = 1), /unknown liquid table/],
    ["an out-of-range value", (p) => (p.styles.liquid[0].data.answers[0][0].s = 16), /answers\[0\]\[0\]\.s/],
    ["a short break lane", (p) => (p.styles.liquid[0].data.kit.breaks[0].kick = "9...8"), /breaks\[0\]\.kick/],
    ["an acid line of 15 steps", (p) => p.styles.acid[0].data.lines[0].pop(), /lines\[0\]: expected 16 entries/],
    ["an unknown trip-hop chord", (p) => (p.styles.triphop[0].data.progressions[0][1] = "II"), /unknown chord "II"/],
    ["a tempo outside the genre", (p) => (p.styles.acid[1].bpm = [60, 70]), /bpm\[0\]/],
    ["an unknown lead patch", (p) => (p.styles.triphop[1].leads = ["kazoo"]), /unknown lead patch/],
    ["a pad with no top tones", (p) => (p.styles.liquid[0].data.vamps[0].a.pad = [-12, -7]), /two tones in 0\.\.12/],
    ["a house station key", (p) => (p.key = "idm"), /house station/],
    // Sound fields.
    ["a mix trim over 6 dB", (p) => (p.styles.liquid[0].data.mix = { kick: 7 }), /data\.mix\.kick: expected a number in -6\.\.6/],
    ["a mix trim on an unknown bus", (p) => (p.styles.liquid[0].data.mix = { vox: 1 }), /data\.mix\.vox: unknown field/],
    ["an echo of 0 steps", (p) => (p.styles.liquid[0].data.fx = { echo: { steps: 0 } }), /data\.fx\.echo\.steps: expected an integer in 1\.\.8/],
    ["a room too big", (p) => (p.styles.liquid[0].data.fx = { space: { size: 4 } }), /data\.fx\.space\.size/],
    ["a master crusher of 3 bits", (p) => (p.styles.acid[0].data.fx = { master: { crush: 3 } }), /data\.fx\.master\.crush/],
    ["a drum layer of no kind", (p) => (p.styles.liquid[0].data.kit.snare = [{ level: 1 }]), /kit\.snare\[0\]: a drum layer needs one of tone, noise, crush, clap/],
    ["a snare name that does not exist", (p) => (p.styles.liquid[0].data.kit.snare = "trap"), /kit\.snare: expected one of "keys", "soft", "soul"/],
    ["a noise layer resonance of 20", (p) => (p.styles.liquid[0].data.kit.snare = [{ noise: "bandpass", freq: 2000, q: 20, decay: 0.1, level: 1 }]), /kit\.snare\[0\]\.q/],
    ["a pad with five oscillators", (p) => (p.styles.liquid[0].data.pad = { osc: Array(5).fill({ type: "sine", detune: 0, level: 0.5 }) }), /data\.pad\.osc: expected 1\.\.4 entries/],
    ["a 303 resonance of 5", (p) => (p.styles.acid[0].data.voice = { resonance: 5 }), /data\.voice\.resonance/],
    ["a sound field the base does not read", (p) => (p.styles.liquid[0].data.strings = { level: 0.1 }), /base "classic" does not read it/],
    ["a pack patch with a house id", (p) => (p.patches = { rhodes: { ...p.patches["night-ep"] } }), /patches\.rhodes: "rhodes" is a house lead patch/],
    ["a pack patch out of range", (p) => (p.patches["night-ep"].filter.q = 30), /patches\.night-ep\.filter\.q/],
    ["leads naming a patch the pack does not have", (p) => (p.styles.liquid[0].leads = ["nope"]), /unknown lead patch "nope"/],
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

  it("programFromPack throws on an invalid pack, listing the problems", () => {
    const p = copy();
    p.styles.liquid[0].id = "classic";
    expect(() => programFromPack(p)).toThrow(/invalid style pack:[\s\S]*house style id/);
  });
});

describe("programFromPack", () => {
  const program = programFromPack(example);

  it("plays only the pack's genres, the first cycle in listed order", () => {
    const seq = Array.from({ length: 1024 }, (_, e) => eraOf(e, program).id);
    expect(seq.slice(0, 3)).toEqual(example.genres);
    expect(new Set(seq)).toEqual(new Set(example.genres));
  });

  it("walks the pack's styles in order, each resolved over its base", () => {
    expect(programFromPack(example)).toBe(program);
    for (const g of example.genres) {
      const era = eraById(g);
      const ids = example.styles[g]!.map((s) => s.id);
      const played = [];
      for (let e = 0; e < 64; e++) if (eraOf(e, program).id === g) played.push(styleOf(era, e, program).style.id);
      expect(played.slice(0, 4)).toEqual([...ids, ...ids].slice(0, 4));
    }
    // Left out: inherited from the base (Soulful's swing and micro timing); given: the pack's own (Night Keys' bpm,
    // Smoke's lead patch, carried on the resolved style).
    const deep = styleById(eraById("liquid"), "deep-soul", program).style;
    const soulful = styleById(eraById("liquid"), "soulful").style;
    expect(deep.swing).toBe(soulful.swing);
    expect(deep.microScale).toBe(soulful.microScale);
    const smoke = styleById(eraById("triphop"), "smoke-rhodes", program).style;
    expect(smoke.base).toBe("classic");
    expect(smoke.leads).toEqual(["smoke-wurli"]);
    expect(smoke.patches?.["smoke-wurli"]).toEqual({ id: "smoke-wurli", ...example.patches["smoke-wurli"] });
    expect(styleById(eraById("liquid"), "night-keys", program).style.bpm).toEqual([172, 176]);
  });
});

/**
 * A stand-in BaseAudioContext that records every node, connection, parameter write and buffer (hashed) the engine
 * makes, in order. Two engines that record the same log schedule the same audio.
 */
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
    const fn = function () {};
    return new Proxy(fn, {
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

/** The hash of everything an engine schedules for `genre` at `epoch` in `program` over a busy stretch. */
function schedule(genre: GenreId, epoch: number, program: Program, seconds = 24): string {
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
  const points = Array.from({ length: 8 }, (_, k) => ({ time: k * 3, state: busy(k) }));
  for (const hit of planSteps(points, seconds, genre, 8, program)) if (hit.time < seconds) engine.trigger(hit);
  return createHash("sha256").update(log.join("\n")).digest("hex");
}

describe("override path", () => {
  for (const genre of DATA_GENRES) {
    for (const base of Object.keys(DATA_FIELDS[genre])) {
      it(`${genre}: a station style with base "${base}" and no data schedules exactly what "${base}" does`, () => {
        const era = eraById(genre);
        let epoch = 0;
        while (!(eraOf(epoch).id === genre && styleOf(era, epoch).style.id === base)) epoch++;
        const other = genre === "acid" ? "liquid" : "acid";
        const pack = {
          key: "transparent",
          name: "Transparent",
          genres: [genre, other],
          styles: { [genre]: [{ id: `t-${base}`, name: "T", base }], [other]: [{ id: "t-other", name: "O", base: "classic" }] },
        } as unknown as StationPack;
        const station = programFromPack(pack);
        expect(styleOf(era, epoch, station).style.id).toBe(`t-${base}`);
        expect(schedule(genre, epoch, station)).toBe(schedule(genre, epoch, HOUSE_PROGRAM));
      });
    }
  }

  /** The first epoch the house plays `base` of `genre`, and a two-genre station program playing `style` there. */
  const stationAt = (genre: DataGenre, base: string, style: Record<string, unknown>, patches?: object) => {
    const era = eraById(genre);
    let epoch = 0;
    while (!(eraOf(epoch).id === genre && styleOf(era, epoch).style.id === base)) epoch++;
    const other = genre === "acid" ? "liquid" : "acid";
    const pack = {
      key: "sound",
      name: "Sound",
      genres: [genre, other],
      styles: { [genre]: [{ id: `s-${base}`, name: "S", base, ...style }], [other]: [{ id: "s-other", name: "O", base: "classic" }] },
      ...(patches ? { patches } : {}),
    } as unknown as StationPack;
    expect(validatePack(pack)).toEqual([]);
    return { epoch, station: programFromPack(pack) };
  };

  // The sound tables are exact: a style that restates every house sound value of its base (SOUND_DEFAULTS) as data
  // schedules exactly what the base does, so the defaults are the house sound and every value is read as written.
  for (const genre of DATA_GENRES) {
    for (const base of Object.keys(DATA_FIELDS[genre])) {
      it(`${genre}: a style restating "${base}"'s SOUND_DEFAULTS validates and schedules exactly what "${base}" does`, () => {
        const { epoch, station } = stationAt(genre, base, { data: SOUND_DEFAULTS[genre][base] });
        expect(schedule(genre, epoch, station)).toBe(schedule(genre, epoch, HOUSE_PROGRAM));
      });
    }
  }

  it("SOUND_DEFAULTS covers every sound field each base reads", () => {
    const notes = new Set(["vamps", "stabs", "answers", "contours", "phrases", "fills", "sub", "progressions", "walks", "comps", "chords", "skips", "foley", "kicks", "choirs", "pans", "statements", "turns", "space", "pedal", "calls", "voicings", "cuts", "chops", "organ", "lines"]);
    for (const genre of DATA_GENRES) {
      for (const [base, fields] of Object.entries(DATA_FIELDS[genre])) {
        // Trip-hop `strings` is Bristol's string chord (notes); liquid's is the Soulful string voice.
        const sound = (fields as string[]).filter((f) => !notes.has(f) && !(genre === "triphop" && f === "strings"));
        expect(Object.keys(SOUND_DEFAULTS[genre][base]).sort(), `${genre}/${base}`).toEqual(sound.sort());
      }
    }
  });

  // Every sound field is live: nudging the first number in a base's house value changes what is scheduled.
  const step = (x: number) => (x === 0 ? 0.5 : Number.isInteger(x) && Math.abs(x) < 20 ? x + 1 : x * 0.8);
  const nudge = (x: unknown): unknown => {
    const copy = JSON.parse(JSON.stringify(x));
    const walk = (o: any): boolean => {
      for (const k of Object.keys(o)) {
        if (typeof o[k] === "number") {
          o[k] = step(o[k]);
          return true;
        }
        if (o[k] && typeof o[k] === "object" && walk(o[k])) return true;
      }
      return false;
    };
    return typeof copy === "number" ? step(copy) : walk(copy) ? copy : { bass: -3 };
  };
  for (const genre of DATA_GENRES) {
    for (const base of Object.keys(DATA_FIELDS[genre])) {
      it(`${genre}/${base}: every sound field changes what is scheduled`, () => {
        const house = schedule(genre, stationAt(genre, base, {}).epoch, HOUSE_PROGRAM, 40);
        for (const [field, value] of Object.entries(SOUND_DEFAULTS[genre][base])) {
          const { epoch, station } = stationAt(genre, base, { data: { [field]: nudge(value) } });
          expect(schedule(genre, epoch, station, 40), `${field}`).not.toBe(house);
        }
      });
    }
  }

  it("a pack's own lead patch plays where `leads` names it; a copy of a house patch plays exactly like it", () => {
    const { id: _id, ...piano } = LEAD_PATCHES.triphop_piano;
    const copy = stationAt("triphop", "cinematic", { leads: ["my-piano"] }, { "my-piano": piano });
    expect(styleOf(eraById("triphop"), copy.epoch, copy.station).style.patches?.["my-piano"]).toEqual({ id: "my-piano", ...piano });
    expect(schedule("triphop", copy.epoch, copy.station)).toBe(schedule("triphop", copy.epoch, HOUSE_PROGRAM));
    const own = stationAt("triphop", "cinematic", { leads: ["my-piano"] }, { "my-piano": { ...piano, filter: { ...piano.filter, cutoff: 900 } } });
    expect(schedule("triphop", own.epoch, own.station)).not.toBe(schedule("triphop", own.epoch, HOUSE_PROGRAM));
  });

  it("every house lead patch passes the pack patch ranges", () => {
    for (const [id, { id: _id, ...patch }] of Object.entries(LEAD_PATCHES)) {
      const errors: string[] = [];
      PATCH_CHECK(patch, id, (m) => void errors.push(m));
      expect(errors, id).toEqual([]);
    }
  });

  it("data changes what is scheduled: every example style differs from itself without data", () => {
    const station = programFromPack(example);
    for (const genre of example.genres) {
      const era = eraById(genre);
      for (const style of example.styles[genre]!) {
        let epoch = 0;
        while (!(eraOf(epoch, station).id === genre && styleOf(era, epoch, station).style.id === style.id)) epoch++;
        // Same style with and without its data (same tempo and trim), so only the tables differ.
        const resolved = styleById(era, style.id, station).style;
        const pinned = (s: GenreStyle): Program => ({ key: "pin", eras: [{ fromEpoch: 0, ids: [genre] }], styles: [{ fromEpoch: 0, styles: { [genre]: [s] } }] });
        expect(schedule(genre, epoch, pinned(resolved))).not.toBe(schedule(genre, epoch, pinned({ ...resolved, data: undefined })));
      }
    }
  });
});
