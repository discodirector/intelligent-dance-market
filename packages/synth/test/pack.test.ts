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
import demo from "./fixtures/dub-electro.ts";

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
    ["no genre", (p) => (p.genres = []), /expected 1\.\.\d+ genres/],
    ["a genre not opened to data", (p) => (p.genres = ["acid", "wonky"]), /genres\[1\]/],
    ["styles for a genre outside genres", (p) => (p.genres = ["acid", "triphop"]), /styles\.liquid: not in genres/],
    ["eleven styles", (p) => p.styles.acid.push(...Array.from({ length: 11 - p.styles.acid.length }, (_, i) => ({ ...p.styles.acid[0], id: `x${i}` }))), /expected 1\.\.10 styles, got 11/],
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

  it("plays a one-genre pack every epoch, walking its styles in order", () => {
    const acid = copy().styles.acid;
    const solo = { key: "solo", name: "Solo", genres: ["acid"], styles: { acid } } as StationPack;
    expect(validatePack(solo)).toEqual([]);
    const p = programFromPack(solo);
    const era = eraById("acid");
    const ids = acid.map((s: { id: string }) => s.id);
    for (let e = 0; e < 64; e++) {
      expect(eraOf(e, p).id).toBe("acid");
      expect(styleOf(era, e, p).style.id).toBe(ids[e % ids.length]);
    }
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
    const notes = new Set(["vamps", "stabs", "answers", "contours", "phrases", "fills", "sub", "progressions", "walks", "comps", "chords", "skips", "foley", "kicks", "choirs", "pans", "statements", "turns", "space", "pedal", "calls", "voicings", "cuts", "chops", "organ", "lines", "figures", "accents", "stabBars", "bassline", "bells", "percs", "claps", "hats", "arps", "ghosts", "warps", "riffs", "words", "opens", "arpCells"]);
    for (const f of ["tiers", "notes", "bars", "voicing", "colours", "busy", "glints", "partials"]) notes.add(f); // ambientidm, drone
    for (const genre of DATA_GENRES) {
      for (const [base, fields] of Object.entries(DATA_FIELDS[genre])) {
        // Trip-hop `strings` is Bristol's string chord (notes); liquid's is the Soulful string voice.
        // `ornament` (electro) is the attention layer's voice: silent without mentions, tested in attention.test.ts.
        const sound = (fields as string[]).filter((f) => !notes.has(f) && !(genre === "triphop" && f === "strings") && f !== "ornament");
        expect(Object.keys(SOUND_DEFAULTS[genre][base]).sort(), `${genre}/${base}`).toEqual(sound.sort());
      }
    }
  });

  // Every sound field is live: nudging the first number in a base's house value changes what is scheduled.
  // Slow genres need longer to reach every voice (Crystal's high line comes at most once per chord).
  const NUDGE_SECONDS: Partial<Record<DataGenre, number>> = { ambientidm: 80 };
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
        const seconds = NUDGE_SECONDS[genre] ?? 40;
        const house = schedule(genre, stationAt(genre, base, {}).epoch, HOUSE_PROGRAM, seconds);
        for (const [field, value] of Object.entries(SOUND_DEFAULTS[genre][base])) {
          const { epoch, station } = stationAt(genre, base, { data: { [field]: nudge(value) } });
          expect(schedule(genre, epoch, station, seconds), `${field}`).not.toBe(house);
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

// Dub techno and electro, opened last: their contract on the demo pack (test/fixtures/dub-electro.ts), the ranges that
// keep a pack from blowing up, and every notes field reaching the schedule (the sound fields: "override path" above).
describe("dub techno and electro", () => {
  const demoCopy = (): any => JSON.parse(JSON.stringify(demo));

  it("the demo pack validates and every demo style differs from its base", () => {
    expect(validatePack(demo)).toEqual([]);
    const station = programFromPack(demo);
    for (const genre of demo.genres) {
      const era = eraById(genre);
      for (const style of demo.styles[genre]!) {
        let epoch = 0;
        while (!(eraOf(epoch, station).id === genre && styleOf(era, epoch, station).style.id === style.id)) epoch++;
        const resolved = styleById(era, style.id, station).style;
        const pinned = (s: GenreStyle): Program => ({ key: "pin", eras: [{ fromEpoch: 0, ids: [genre] }], styles: [{ fromEpoch: 0, styles: { [genre]: [s] } }] });
        expect(schedule(genre, epoch, pinned(resolved)), style.id).not.toBe(schedule(genre, epoch, pinned({ ...resolved, data: undefined })));
      }
    }
  });

  it("a pack may name every opened genre, not one more", () => {
    const all = { key: "all", name: "All", genres: [...DATA_GENRES], styles: Object.fromEntries(DATA_GENRES.map((g) => [g, [{ id: `s-${g}`, name: g, base: "classic" }]])) };
    expect(validatePack(all)).toEqual([]);
    expect(validatePack({ ...all, genres: [...DATA_GENRES, "acid"] }).join("\n")).toMatch(new RegExp(`1\\.\\.${DATA_GENRES.length} genres`));
  });

  const bad: [string, (p: any) => void, RegExp][] = [
    ["a dub base of another genre", (p) => (p.styles.dubtechno[0].base = "client03"), /styles\.dubtechno\[0\]\.base: expected one of classic, ixtlan, moment/],
    ["an electro base of another genre", (p) => (p.styles.electro[0].base = "ixtlan"), /styles\.electro\[0\]\.base: expected one of classic, client03, alienrave/],
    ["a dub tempo outside the genre", (p) => (p.styles.dubtechno[0].bpm = [100, 110]), /styles\.dubtechno\[0\]\.bpm\[0\]/],
    ["an unknown dub chord", (p) => (p.styles.dubtechno[0].data.progressions[0].seq[1] = "II9"), /progressions\[0\]\.seq\[1\]: unknown chord "II9"/],
    ["a dub chord of six tones", (p) => (p.styles.dubtechno[0].data.chords.i9wide.upper = [0, 3, 7, 10, 14, 17]), /chords\.i9wide\.upper: expected 2\.\.5 entries/],
    ["a stab figure step of 16", (p) => (p.styles.dubtechno[0].data.figures[0][0] = 16), /figures\[0\]\[0\]: expected an integer in 0\.\.15/],
    ["a bassline note of two values", (p) => (p.styles.dubtechno[1].data.bassline[0] = [2, 1]), /bassline\[0\]: expected \[step, length, level\]/],
    ["an echo of 13 taps", (p) => (p.styles.dubtechno[0].data.fx.echo.taps = 13), /fx\.echo\.taps: expected an integer in 1\.\.12/],
    ["an echo feedback of 1", (p) => (p.styles.dubtechno[0].data.fx.echo.fb = 1), /fx\.echo\.fb: expected a number in 0\.\.0\.75/],
    ["a dub kick hold past the tail", (p) => (p.styles.dubtechno[0].data.kit.kick.hold = 0.4), /kit\.kick\.hold: expected a number in 0\.02\.\.0\.3/],
    ["a stab resonance of 20", (p) => (p.styles.dubtechno[0].data.stabTone.q = 20), /stabTone\.q: expected a number in 0\.3\.\.12/],
    ["a stab octave of 0.5", (p) => (p.styles.dubtechno[0].data.stabTone.octave = 0.5), /stabTone\.octave: expected an integer/],
    ["a sub drive of 0", (p) => (p.styles.dubtechno[0].data.subTone.drive = 0), /subTone\.drive: expected a number in 0\.1\.\.4/],
    ["a shaker shuffle of three", (p) => (p.styles.dubtechno[0].data.kit.hat.shuffle = [1, 1, 1]), /kit\.hat\.shuffle: expected \[4 values\]/],
    ["a filter sweep of 1 bar", (p) => (p.styles.dubtechno[0].data.sweep.stab = 1), /sweep\.stab: expected a number in 2\.\.64/],
    ["a rumble lowpass of 800 Hz", (p) => (p.styles.dubtechno[0].data.rumble = { level: 0.5, lp: 800 }), /rumble\.lp: expected a number in 60\.\.400/],
    ["a rumble duck over 1", (p) => (p.styles.dubtechno[0].data.rumble = { duck: 1.2 }), /rumble\.duck: expected a number in 0\.\.1/],
    ["an unknown rumble field", (p) => (p.styles.dubtechno[0].data.rumble = { size: 2 }), /rumble\.size: unknown field/],
    ["an empty stab bar mask", (p) => (p.styles.dubtechno[0].data.stabBars = []), /stabBars: expected 1\.\.16 entries/],
    ["a stab layer wave of noise", (p) => (p.styles.dubtechno[0].data.stabTone.wave2 = "noise"), /stabTone\.wave2: expected one of/],
    ["a stab layer over 1.5", (p) => (p.styles.dubtechno[0].data.stabTone.mix2 = 2), /stabTone\.mix2: expected a number in 0\.\.1\.5/],
    ["a pulse width of 0.7", (p) => (p.styles.dubtechno[0].data.stabTone.width = 0.7), /stabTone\.width: expected a number in 0\.05\.\.0\.5/],
    ["a velocity cutoff depth of 2", (p) => (p.styles.dubtechno[0].data.stabTone.velLp = 2), /stabTone\.velLp: expected a number in 0\.\.1/],
    ["a stab engine of wavetable", (p) => (p.styles.dubtechno[0].data.stabTone.engine = "wavetable"), /stabTone\.engine: expected one of/],
    ["an FM ratio of 20", (p) => (p.styles.dubtechno[0].data.stabTone.fm = { ratio: 20 }), /stabTone\.fm\.ratio: expected a number in 0\.5\.\.12/],
    ["an FM index of 30", (p) => (p.styles.dubtechno[0].data.stabTone.fm = { index2: 30 }), /stabTone\.fm\.index2: expected a number in 0\.\.12/],
    ["an unknown FM field", (p) => (p.styles.dubtechno[0].data.stabTone.fm = { feedback: 1 }), /stabTone\.fm\.feedback: unknown field/],
    ["five pluck modes", (p) => (p.styles.dubtechno[0].data.stabTone.pluck = { modes: [1, 2, 3, 4, 5] }), /stabTone\.pluck\.modes: expected 1\.\.4 entries/],
    ["a pluck ring of 10 s", (p) => (p.styles.dubtechno[0].data.stabTone.pluck = { decay: 10 }), /stabTone\.pluck\.decay: expected a number in 0\.05\.\.4/],
    ["a 20 ms mallet", (p) => (p.styles.dubtechno[0].data.stabTone.pluck = { burst: 0.02 }), /stabTone\.pluck\.burst: expected a number in 0\.0002\.\.0\.005/],
    ["a pad highpass of 2 kHz", (p) => (p.styles.dubtechno[0].data.padTone.hp = 2000), /padTone\.hp: expected a number in 20\.\.1000/],
    ["an echo breath deeper than 1", (p) => (p.styles.dubtechno[0].data.sweep.fb = 1.2), /sweep\.fb: expected a number in 0\.\.1/],
    ["a ping-pong time of 9 16ths", (p) => (p.styles.dubtechno[0].data.echoTone = { alt: 9 }), /echoTone\.alt: expected an integer in 0\.\.8/],
    ["a tape wobble of 3", (p) => (p.styles.dubtechno[0].data.echoTone = { wobble: 3 }), /echoTone\.wobble: expected a number in 0\.\.1/],
    ["a melody of five notes a cell", (p) => (p.styles.dubtechno[0].data.melody = { level: 1, count: 5 }), /melody\.count: expected an integer in 1\.\.4/],
    ["a melody pool of nine notes", (p) => (p.styles.dubtechno[0].data.melody = { notes: [0, 3, 7, 10, 12, 15, 19, 22, 24] }), /melody\.notes: expected 1\.\.8 entries/],
    ["an unknown melody field", (p) => (p.styles.dubtechno[0].data.melody = { scale: "minor" }), /melody\.scale: unknown field/],
    ["a stab bar level of 2", (p) => (p.styles.dubtechno[0].data.stabBars = [1, 2]), /stabBars\[1\]: expected a number in 0\.\.1\.5/],
    ["a clap past two bars", (p) => (p.styles.dubtechno[0].data.claps = [[32, 1]]), /claps\[0\]\[0\]: expected an integer in 0\.\.31/],
    ["a clap level of 2", (p) => (p.styles.dubtechno[0].data.claps = [[12, 2]]), /claps\[0\]\[1\]: expected a number in 0\.\.1\.5/],
    ["a hat without a level", (p) => (p.styles.dubtechno[0].data.hats = [[2]]), /hats\[0\]: expected \[16th, level\] or \[16th, level, decay\]/],
    ["a hat decay of 1 s", (p) => (p.styles.dubtechno[0].data.hats = [[2, 1, 1]]), /hats\[0\]\[2\]: expected a number in 0\.005\.\.0\.5/],
    ["seventeen hats", (p) => (p.styles.dubtechno[0].data.hats = Array.from({ length: 17 }, (_, i) => [i, 1])), /hats: expected 1\.\.16 entries/],
    ["a kick figure onset of 32", (p) => p.styles.electro[0].data.kicks.lo[0].push(32), /kicks\.lo\[0\]\[5\]: expected an integer in 0\.\.31/],
    ["kicks without the half tier", (p) => delete p.styles.electro[0].data.kicks.half, /kicks\.half: missing/],
    ["an arp of four notes", (p) => (p.styles.electro[0].data.arps[0] = [0, 7, 10, 12]), /arps\[0\]: expected 1\.\.3 entries/],
    ["an electro snare name that does not exist", (p) => (p.styles.electro[1].data.kit.snare = "909"), /kit\.snare: expected one of "808", "client", "alien"/],
    ["a bass resonance pair out of range", (p) => (p.styles.electro[0].data.bassTone.q = [9, 20]), /bassTone\.q\[1\]: expected a number in 0\.3\.\.14/],
    ["a bass level over 0.3", (p) => (p.styles.electro[1].data.bassTone.level = [0.2, 0.5]), /bassTone\.level\[1\]/],
    ["a hat accent over 1", (p) => (p.styles.electro[0].data.kit.accents[2] = 1.4), /kit\.accents\[2\]/],
    ["a progression index past the chords", (p) => (p.styles.electro[2].data.progressions = [[0, 1, 2, 6]]), /progressions\[0\]\[3\]: chord 6 is not in chords \(0\.\.5\)/],
    ["fewer chords than the house progressions use", (p) => (p.styles.electro[2].data.chords = [{ bass: 0, tones: [0, 7, 12] }, { bass: 5, tones: [0, 5, 8] }]), /data\.chords: the house progressions use chords 0\.\.5/],
    ["a warp of 15 steps", (p) => (p.styles.electro[1].data.warps = [Array(15).fill(1)]), /warps\[0\]: expected 16 entries/],
    ["a phase line of one note", (p) => (p.styles.electro[2].data.lines = [[[0, 1], null, null, null, null, null]]), /lines\[0\]: needs at least 2 notes/],
    ["a voice crushed to 2 bits", (p) => (p.styles.electro[1].data.voice.bits = 2), /voice\.bits: expected an integer in 3\.\.8/],
    ["a hoover bend of 24", (p) => (p.styles.electro[2].data.hoover.bend = 24), /hoover\.bend: expected a number in 0\.\.12/],
    ["a field the base does not read", (p) => (p.styles.electro[0].data.hoover = { bend: 2 }), /base "classic" does not read it/],
    ["a dub field on electro", (p) => (p.styles.electro[0].data.stabTone = { lp: 900 }), /unknown electro table/],
  ];
  for (const [what, breakIt, message] of bad) {
    it(`rejects ${what}`, () => {
      const p = demoCopy();
      breakIt(p);
      const errors = validatePack(p);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(message);
    });
  }

  /** The first epoch the house plays `base` of `genre`, and a station playing a style of it with `data` there. */
  const at = (genre: DataGenre, base: string, data: object) => {
    const era = eraById(genre);
    let epoch = 0;
    while (!(eraOf(epoch).id === genre && styleOf(era, epoch).style.id === base)) epoch++;
    const other = genre === "dubtechno" ? "electro" : "dubtechno";
    const pack = {
      key: "notes",
      name: "Notes",
      genres: [genre, other],
      styles: { [genre]: [{ id: `n-${base}`, name: "N", base, data }], [other]: [{ id: "n-other", name: "O", base: "classic" }] },
    } as unknown as StationPack;
    expect(validatePack(pack)).toEqual([]);
    return { epoch, station: programFromPack(pack) };
  };
  // A value for every notes field, unlike the house's: each must change what is scheduled.
  const NOTES: Record<"dubtechno" | "electro", Record<string, unknown>> = {
    dubtechno: {
      chords: { i9: { root: 0, upper: [7, 10, 14, 15] }, i11: { root: 0, upper: [7, 10, 15, 17] } },
      progressions: [{ bars: 1, seq: ["v7", "VI9"] }],
      figures: [[0, 4, 8, 12]],
      accents: [0.3],
      stabBars: [1, 0],
      bassline: [[0, 4, 1]],
      bells: [[[0, 0, 1], [16, 1, 1], [32, 2, 1], [48, 0, 1]]],
      percs: [[0, 1, 1], [8, 1.5, 1], [16, 1, 1], [24, 1.5, 1]],
      claps: [[12, 1], [28, 1]],
      hats: [[2, 1], [6, 0.5], [14, 1, 0.2], [18, 1], [30, 0.7]],
    },
    electro: {
      kicks: { half: [[0]], lo: [[0, 8]], mid: [[0, 8, 16, 24]], hi: [[0, 4, 8, 12, 16, 20, 24, 28]] },
      arps: [[0, 7, 15]],
      chords: Array.from({ length: 6 }, (_, i) => ({ bass: i - 2, tones: [0, 3, 7] })),
      progressions: [[1, 0, 1, 0]],
      ghosts: [[{ s: 1, vel: 0.5, core: true }, { s: 5, vel: 0.5, core: true }, { s: 21, vel: 0.5, core: true }]],
      warps: [Array(16).fill(1.3)],
      chops: [{ open: 2, steps: [1, 5] }],
      riffs: [[{ s: 0, semi: 0, len: 2, f: 1 }, { s: 4, semi: 7, len: 2, f: 1 }, { s: 8, semi: 12, len: 2, f: 1 }, { s: 20, semi: 10, len: 2, f: 1 }]],
      words: [{ s: 0, syl: [[300, 2000, "s"]] }],
      opens: [[0, 4, 8, 12]],
      lines: [[[0, 1], [7, 1], null, [12, 1], null, [10, 1]]],
      stabs: [[{ s: 0, len: 4, core: true }, { s: 16, len: 4, core: true }]],
      arpCells: [[0, 2, 4, 6]],
      calls: [{ s: 0, len: 4, vowels: [[300, 2300], [700, 1100]] }],
    },
  };
  for (const genre of ["dubtechno", "electro"] as const) {
    for (const [base, fields] of Object.entries(DATA_FIELDS[genre])) {
      it(`${genre}/${base}: every notes field changes what is scheduled`, () => {
        const house = schedule(genre, at(genre, base, {}).epoch, HOUSE_PROGRAM, 40);
        const notes = (fields as string[]).filter((f) => f in NOTES[genre]);
        expect(notes.length).toBeGreaterThan(0);
        for (const field of notes) {
          const { epoch, station } = at(genre, base, { [field]: NOTES[genre][field] });
          expect(schedule(genre, epoch, station, 40), field).not.toBe(house);
        }
      });
    }
  }

  it("a stab bar mask of all ones schedules what no mask does; a rest or a level changes it", () => {
    for (const base of ["classic", "ixtlan", "moment"]) {
      const house = schedule("dubtechno", at("dubtechno", base, {}).epoch, HOUSE_PROGRAM, 40);
      const ones = at("dubtechno", base, { stabBars: [1, 1, 1] });
      expect(schedule("dubtechno", ones.epoch, ones.station, 40), base).toBe(house);
      for (const mask of [[1, 0], [1, 1, 1, 0.5], [0]]) {
        const { epoch, station } = at("dubtechno", base, { stabBars: mask });
        expect(schedule("dubtechno", epoch, station, 40), `${base} ${mask}`).not.toBe(house);
      }
    }
  });

  it("clap and hat figures restating 2 and 4 and the offbeats schedule what none does; a move changes it", () => {
    const claps = [[4, 0.88], [12, 1], [20, 0.88], [28, 1]];
    const hats = [2, 6, 10, 14, 18, 22, 26, 30].map((s) => [s, 1]);
    for (const base of ["classic", "ixtlan", "moment"]) {
      const house = schedule("dubtechno", at("dubtechno", base, {}).epoch, HOUSE_PROGRAM, 40);
      const same = at("dubtechno", base, { claps, hats });
      expect(schedule("dubtechno", same.epoch, same.station, 40), base).toBe(house);
      for (const data of [{ claps: [[12, 1], [28, 1]] }, { hats: [...hats.slice(0, 7), [30, 1, 0.2]] }, { hats: hats.slice(0, 4) }]) {
        const { epoch, station } = at("dubtechno", base, data);
        expect(schedule("dubtechno", epoch, station, 40), `${base} ${JSON.stringify(data)}`).not.toBe(house);
      }
    }
  });

  it("the rumble is off unless its level is raised; on, every rumble field changes what is scheduled", () => {
    for (const base of ["classic", "ixtlan", "moment"]) {
      const house = schedule("dubtechno", at("dubtechno", base, {}).epoch, HOUSE_PROGRAM, 40);
      // Level 0 builds nothing, whatever the other fields say.
      const off = at("dubtechno", base, { rumble: { level: 0, lp: 300, decay: 2, duck: 0.3 } });
      expect(schedule("dubtechno", off.epoch, off.station, 40), base).toBe(house);
      const on = { level: 0.6, lp: 180, decay: 1.2, duck: 0.8 };
      const ref = at("dubtechno", base, { rumble: on });
      const heard = schedule("dubtechno", ref.epoch, ref.station, 40);
      expect(heard, base).not.toBe(house);
      for (const [field, value] of [["level", 0.9], ["lp", 220], ["decay", 1.6], ["duck", 0.5]] as const) {
        const { epoch, station } = at("dubtechno", base, { rumble: { ...on, [field]: value } });
        expect(schedule("dubtechno", epoch, station, 40), `${base} rumble.${field}`).not.toBe(heard);
      }
    }
  });
});

describe("dub techno voice upgrades (all off by default)", () => {
  const at = (base: string, data: object) => {
    const era = eraById("dubtechno");
    let epoch = 0;
    while (!(eraOf(epoch).id === "dubtechno" && styleOf(era, epoch).style.id === base)) epoch++;
    const pack = { key: "up", name: "Up", genres: ["dubtechno"], styles: { dubtechno: [{ id: `u-${base}`, name: "U", base, data }] } } as unknown as StationPack;
    expect(validatePack(pack)).toEqual([]);
    return schedule("dubtechno", epoch, programFromPack(pack), 40);
  };
  const BASES = ["classic", "ixtlan", "moment"];

  it("absent or at their off values, the stab layer, velocity cutoff, pad highpass, echo breath, echo shape and melody schedule what the base does", () => {
    for (const base of BASES) {
      const house = at(base, {});
      const off = {
        stabTone: { wave2: "pulse", mix2: 0, width: 0.2, octave2: 12, velLp: 0, engine: "osc", fm: { ratio: 3, index: 6 }, pluck: { modes: [1, 4] } },
        sweep: { send: 0, fb: 0, breath: 8 },
        echoTone: { width: 0.55, alt: 0, wobble: 0, rate: 1 },
        melody: { level: 0, notes: [0, 3, 7], every: 1, count: 4, chance: 1 },
      };
      expect(at(base, off), base).toBe(house);
    }
  });

  // Each field, on, against the same style without it (or with the field moved).
  const ON: [string, object, object][] = [
    ["stabTone.mix2", { stabTone: {} }, { stabTone: { mix2: 0.6 } }],
    ["stabTone.wave2", { stabTone: { mix2: 0.6, wave2: "sawtooth" } }, { stabTone: { mix2: 0.6, wave2: "pulse" } }],
    ["stabTone.width", { stabTone: { mix2: 0.6, wave2: "pulse", width: 0.3 } }, { stabTone: { mix2: 0.6, wave2: "pulse", width: 0.15 } }],
    ["stabTone.octave2", { stabTone: { mix2: 0.6 } }, { stabTone: { mix2: 0.6, octave2: -12 } }],
    ["stabTone.velLp", { stabTone: {} }, { stabTone: { velLp: 0.8 } }],
    ["stabTone.engine fm", { stabTone: {} }, { stabTone: { engine: "fm" } }],
    ["stabTone.engine pluck", { stabTone: {} }, { stabTone: { engine: "pluck" } }],
    ["stabTone.engine fm / pluck", { stabTone: { engine: "fm" } }, { stabTone: { engine: "pluck" } }],
    ["stabTone fm + mix2 layer", { stabTone: { engine: "fm" } }, { stabTone: { engine: "fm", mix2: 0.5 } }],
    ["stabTone pluck + mix2 layer", { stabTone: { engine: "pluck" } }, { stabTone: { engine: "pluck", mix2: 0.5 } }],
    ["padTone.hp", { padTone: {} }, { padTone: { hp: 180 } }],
    ["sweep.send", { sweep: {} }, { sweep: { send: 0.5 } }],
    ["sweep.fb", { sweep: {} }, { sweep: { fb: 0.5 } }],
    ["sweep.breath", { sweep: { send: 0.5, fb: 0.5 } }, { sweep: { send: 0.5, fb: 0.5, breath: 4 } }],
    ["echoTone.width", { echoTone: {} }, { echoTone: { width: 0.9 } }],
    ["echoTone.alt", { echoTone: {} }, { echoTone: { alt: 4 } }],
    ["echoTone.wobble", { echoTone: {} }, { echoTone: { wobble: 0.5 } }],
    ["echoTone.rate", { echoTone: { wobble: 0.5 } }, { echoTone: { wobble: 0.5, rate: 1.2 } }],
  ];
  for (const [field, value] of [["ratio", 3.5], ["index", 6], ["floor", 0.6], ["decay", 0.8], ["vel", 0]] as const) {
    ON.push([`stabTone.fm.${field}`, { stabTone: { engine: "fm" } }, { stabTone: { engine: "fm", fm: { [field]: value } } }]);
  }
  for (const [field, value] of [["ratio2", 5], ["decay2", 0.2]] as const) {
    ON.push([`stabTone.fm.${field}`, { stabTone: { engine: "fm", fm: { index2: 2 } } }, { stabTone: { engine: "fm", fm: { index2: 2, [field]: value } } }]);
  }
  ON.push(["stabTone.fm.index2", { stabTone: { engine: "fm" } }, { stabTone: { engine: "fm", fm: { index2: 2 } } }]);
  for (const [field, value] of [["modes", [1, 3.99, 9.83]], ["decay", 2.5], ["damp", 0.2], ["tone", 6000], ["burst", 0.003], ["vel", 0]] as const) {
    ON.push([`stabTone.pluck.${field}`, { stabTone: { engine: "pluck" } }, { stabTone: { engine: "pluck", pluck: { [field]: value } } }]);
  }
  const MELODY = { level: 1, every: 2, chance: 1, count: 2 };
  for (const [field, value] of [["level", 1.5], ["wave", "sawtooth"], ["detune", 12], ["octave", 0], ["notes", [0, 3, 7, 10]], ["every", 1], ["count", 3], ["chance", 0.4], ["attack", 1], ["hold", 8], ["release", 4], ["lp", 900], ["echo", 0.7], ["space", 0.7]] as const) {
    ON.push([`melody.${field}`, { melody: MELODY }, { melody: { ...MELODY, [field]: value } }]);
  }
  ON.push(["melody (on)", {}, { melody: { level: 1 } }]);

  it("on, every field changes what is scheduled", () => {
    for (const base of BASES) {
      for (const [field, a, b] of ON) expect(at(base, b), `${base} ${field}`).not.toBe(at(base, a));
    }
  });
});

describe("chords the house progressions need", () => {
  // A style that replaces `chords` but keeps the house progressions must keep every chord they index.
  const pack = (genre: "futuregarage" | "ambientidm", data: Record<string, unknown>): any => ({
    key: "chords",
    name: "Chords",
    genres: [genre, "acid"],
    styles: { [genre]: [{ id: "cx", name: "C", base: "classic", data }], acid: [{ id: "ax", name: "A", base: "classic" }] },
  });
  const garage = { bass: 0, pad: [0, 3, 7], guide: 10, dark: [0, 7, 15] };
  const ambient = { bass: 0, pad: [-12, 0, 7], glass: [0, 7], arp: [0, 3, 7, 10], sing: [3, 7, 5, 0, 10] };

  it("future garage: fewer than 7 chords need their own progressions", () => {
    expect(validatePack(pack("futuregarage", { chords: Array(6).fill(garage) })).join("\n")).toMatch(/chords: the house progressions use chords 0\.\.6/);
    expect(validatePack(pack("futuregarage", { chords: Array(7).fill(garage) }))).toEqual([]);
    expect(validatePack(pack("futuregarage", { chords: Array(2).fill(garage), progressions: [[0, 1]] }))).toEqual([]);
  });

  it("ambient IDM: fewer than 5 chords need their own progressions", () => {
    expect(validatePack(pack("ambientidm", { chords: Array(4).fill(ambient) })).join("\n")).toMatch(/chords: the house progressions use chords 0\.\.4/);
    expect(validatePack(pack("ambientidm", { chords: Array(5).fill(ambient) }))).toEqual([]);
    expect(validatePack(pack("ambientidm", { chords: Array(2).fill(ambient), progressions: [[0, 1]] }))).toEqual([]);
  });
});
