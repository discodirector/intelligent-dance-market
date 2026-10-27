import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UKG_BASSLINES, UKG_CHORDS, VoiceEngine } from "../src/engine.ts";
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
import { PATCH_CHECK, UKG_CHORD_BASS, UKG_KEY } from "../src/pack.ts";
import example from "../src/stations/example.ts";
import machineElectro from "../src/stations/machine-electro.ts";
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
    ["a table the base does not read", (p) => (p.styles.liquid[0].data.comps = []), /does not read it/],
    ["an unknown table", (p) => (p.styles.liquid[0].data.vibes = 1), /unknown liquid table/],
    ["an out-of-range value", (p) => (p.styles.liquid[0].data.answers[0][0].s = 16), /answers\[0\]\[0\]\.s/],
    ["a short break lane", (p) => (p.styles.liquid[0].data.kit.breaks[0].kick = "9...8"), /breaks\[0\]\.kick/],
    ["an acid line of 15 steps", (p) => p.styles.acid[0].data.lines[0].pop(), /lines\[0\]: expected 16 entries/],
    ["an unknown trip-hop chord", (p) => (p.styles.triphop[0].data.progressions[0][1] = "II"), /unknown chord "II"/],
    ["a tempo outside the genre", (p) => (p.styles.acid[1].bpm = [60, 70]), /bpm\[0\]/],
    ["an unknown lead patch", (p) => (p.styles.triphop[1].leads = ["kazoo"]), /unknown lead patch/],
    ["a riser above 1", (p) => (p.styles.acid[1].riser = 1.5), /styles\.acid\[1\]\.riser: expected a number in 0\.\.1/],
    ["a heat above 1", (p) => (p.styles.acid[1].heat = 2), /styles\.acid\[1\]\.heat: expected a number in 0\.\.1/],
    ["an unknown breakdown layer", (p) => (p.styles.acid[1].breakdown = { drums: 1 }), /breakdown\.drums: unknown field/],
    ["a breakdown level above 1", (p) => (p.styles.acid[1].breakdown = { kick: 2 }), /breakdown\.kick: expected a number in 0\.\.1/],
    ["a pad with no top tones", (p) => (p.styles.liquid[0].data.vamps[0].a.pad = [-12, -7]), /two tones in 0\.\.12/],
    ["a house station key", (p) => (p.key = "idm"), /house station/],
    // Sound fields.
    ["a mix trim over 6 dB", (p) => (p.styles.liquid[0].data.mix = { kick: 7 }), /data\.mix\.kick: expected a number in -6\.\.6/],
    ["a mix trim on an unknown bus", (p) => (p.styles.liquid[0].data.mix = { vox: 1 }), /data\.mix\.vox: unknown field/],
    ["an echo of 0 steps", (p) => (p.styles.liquid[0].data.fx = { echo: { steps: 0 } }), /data\.fx\.echo\.steps: expected an integer in 1\.\.8/],
    ["a room too big", (p) => (p.styles.liquid[0].data.fx = { space: { size: 4 } }), /data\.fx\.space\.size/],
    ["a 303 sub above 1", (p) => (p.styles.acid[0].data.voice = { sub: 1.5 }), /data\.voice\.sub: expected a number in 0\.\.1/],
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

  it("a style's heat and breakdown: at their house values nothing changes, below them the schedule does", () => {
    const at = (style: Record<string, unknown>, seconds: number) => {
      const { epoch, station } = stationAt("acid", "classic", style);
      return schedule("acid", epoch, station, seconds);
    };
    expect(at({ heat: 1 }, 24)).toBe(at({}, 24));
    expect(at({ heat: 0.4 }, 24)).not.toBe(at({}, 24));
    // The breakdown is bars 24..27 of the form: 60 s reaches it.
    expect(at({ breakdown: { kick: 0, snare: 0, bass: 0.45, filter: 0.6 } }, 60)).toBe(at({}, 60));
    expect(at({ breakdown: { kick: 0.5, bass: 1 } }, 60)).not.toBe(at({}, 60));
  });

  it("the 303's sub: absent or 0 schedules what the base does, above 0 it adds to the line", () => {
    for (const base of ["classic", "acidhouse", "rubber"]) {
      const at = (voice?: object) => {
        const { epoch, station } = stationAt("acid", base, voice ? { data: { voice } } : {});
        return schedule("acid", epoch, station);
      };
      const house = at();
      expect(at({ sub: 0 }), base).toBe(house);
      expect(at({ sub: 0.5 }), base).not.toBe(house);
    }
  });

  it("a style's intro: at its house values nothing changes, raised the intro does and nothing before it", () => {
    const at = (style: Record<string, unknown>, seconds: number) => {
      const { epoch, station } = stationAt("acid", "classic", style);
      return schedule("acid", epoch, station, seconds);
    };
    // The intro is bars 0..7 of the next form, after the rebuild: 90 s reaches it, 24 s does not.
    expect(at({ intro: { kick: 0.75, snare: 0 } }, 90)).toBe(at({}, 90));
    expect(at({ intro: { snare: 0.6, hat: 0.6, filter: 0.85 } }, 90)).not.toBe(at({}, 90));
    expect(at({ intro: { snare: 0.6, hat: 0.6, filter: 0.85 } }, 24)).toBe(at({}, 24));
    const bad = { key: "intro", name: "Intro", genres: ["acid"], styles: { acid: [{ id: "i-style", name: "I", base: "classic", intro: { snare: 1.5 } }] } };
    expect(validatePack(bad as unknown as StationPack).join("\n")).toMatch(/intro\.snare/);
  });

  it("SOUND_DEFAULTS covers every sound field each base reads", () => {
    const notes = new Set(["vamps", "stabs", "answers", "contours", "phrases", "fills", "sub", "progressions", "walks", "comps", "chords", "skips", "foley", "kicks", "choirs", "pans", "statements", "turns", "space", "pedal", "calls", "voicings", "cuts", "chops", "organ", "lines", "figures", "accents", "stabBars", "bassline", "bells", "percs", "claps", "hats", "arps", "ghosts", "warps", "riffs", "words", "opens", "arpCells", "basslines", "motifs", "calls"]);
    for (const f of ["tiers", "notes", "bars", "voicing", "colours", "busy", "glints", "partials"]) notes.add(f); // ambientidm, drone
    for (const f of ["seq", "metal", "jitter"]) notes.add(f); // electro: off unless given, no house value
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
    ["a voice every 3 bars", (p) => (p.styles.electro[1].data.voice.every = 3), /voice\.every/],
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
      seq: { notes: [0, 3, null, 7, 12] },
      metal: { steps: [1, 0, 0.5] },
      jitter: { hat: 8, ghost: 8 },
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

describe("electro lead answers (Client_03, off by default)", () => {
  const ANSWERS = [[{ s: 2, semi: 7, len: 1, core: true }, { s: 18, semi: 8, len: 2, core: false }, { s: 21, semi: 1, len: 2, core: true }]];
  const pack = (base: string, data: object, leads?: string[]) =>
    ({ key: "ans", name: "Ans", genres: ["electro"], styles: { electro: [{ id: "a-style", name: "A", base, ...(leads ? { leads } : {}), data }] } }) as unknown as StationPack;
  let epoch = 0;
  while (!(eraOf(epoch).id === "electro" && styleOf(eraById("electro"), epoch).style.id === "client03")) epoch++;
  const at = (data: object, leads?: string[]) => {
    const p = pack("client03", data, leads);
    expect(validatePack(p)).toEqual([]);
    return schedule("electro", epoch, programFromPack(p), 40);
  };

  it("left out, Client_03 schedules what it does; on, the lead answers and its patch is the style's", () => {
    const house = at({});
    expect(house).toBe(schedule("electro", epoch, HOUSE_PROGRAM, 40));
    const on = at({ answers: ANSWERS });
    expect(on).not.toBe(house);
    expect(at({ answers: ANSWERS }, ["rhodes"])).not.toBe(on);
    expect(at({ answers: [[{ ...ANSWERS[0][0], semi: 8 }, ...ANSWERS[0].slice(1)]] })).not.toBe(on);
  });

  it("only Client_03 reads it, and the notes stay in range", () => {
    expect(validatePack(pack("classic", { answers: ANSWERS })).join("\n")).toMatch(/data\.answers: base "classic" does not read it/);
    expect(validatePack(pack("client03", { answers: [[{ s: 32, semi: 0, len: 1, core: true }]] })).join("\n")).toMatch(/answers\[0\]\[0\]\.s/);
    expect(validatePack(pack("client03", { answers: [[{ s: 0, semi: 25, len: 1, core: true }]] })).join("\n")).toMatch(/answers\[0\]\[0\]\.semi/);
    expect(validatePack(pack("client03", { answers: [] })).join("\n")).toMatch(/answers/);
  });
});

// Alien Rave's laser and arp voices (styledata.ts LaserSpec, AlienArpSpec): the house sound unless a style gives them.
describe("Alien Rave laser and arp voices (off by default)", () => {
  const pack = (base: string, data: object) =>
    ({ key: "zap", name: "Zap", genres: ["electro"], styles: { electro: [{ id: `z-${base}`, name: "Z", base, data }] } }) as unknown as StationPack;
  let epoch = 0;
  while (!(eraOf(epoch).id === "electro" && styleOf(eraById("electro"), epoch).style.id === "alienrave")) epoch++;
  const at = (data: object) => {
    const p = pack("alienrave", data);
    expect(validatePack(p)).toEqual([]);
    return schedule("electro", epoch, programFromPack(p), 40);
  };
  const errors = (base: string, data: object) => validatePack(pack(base, data)).join("\n");

  it("left out or restated, Alien Rave schedules what it does; at level 0 the voice is gone; each value is read", () => {
    const house = at({});
    expect(house).toBe(schedule("electro", epoch, HOUSE_PROGRAM, 40));
    expect(at({ laser: { from: 2400, color: 2600, q: 6, level: 0.28 }, arp: { open: 3, color: 3, cap: 11000, q: 5, level: 0.22 } })).toBe(house);
    const noLaser = at({ laser: { level: 0 } });
    const noArp = at({ arp: { level: 0 } });
    expect(noLaser).not.toBe(house);
    expect(noArp).not.toBe(house);
    for (const laser of [{ from: 900 }, { color: 300 }, { q: 1.5 }, { level: 0.1 }]) expect(at({ laser }), JSON.stringify(laser)).not.toBe(house);
    for (const arp of [{ open: 1.8 }, { color: 1 }, { cap: 2600 }, { q: 2 }, { level: 0.14 }]) expect(at({ arp }), JSON.stringify(arp)).not.toBe(house);
  });

  it("only Alien Rave reads them, and the values stay in range", () => {
    expect(errors("classic", { laser: { level: 0 } })).toMatch(/data\.laser: base "classic" does not read it/);
    expect(errors("client03", { arp: { level: 0 } })).toMatch(/data\.arp: base "client03" does not read it/);
    expect(errors("alienrave", { laser: { level: 0.5 } })).toMatch(/laser\.level: expected a number in 0\.\.0\.4/);
    expect(errors("alienrave", { laser: { from: 9000 } })).toMatch(/laser\.from/);
    expect(errors("alienrave", { arp: { cap: 20000 } })).toMatch(/arp\.cap/);
    expect(errors("alienrave", { arp: { open: 0.5 } })).toMatch(/arp\.open/);
    expect(errors("alienrave", { arp: { sweep: 1 } })).toMatch(/arp\.sweep: unknown field/);
  });
});

// Liquid (engine.ts liquidWalk / liquidSub): Keys may play a composed walk, walk notes may move off the root, and a
// reese may sit over the sub. All off by default: the house schedules exactly what it did.
describe("liquid walks on Keys, walk semitones and the reese (off by default)", () => {
  const WALK = [[{ s: 0, len: 6, oct: 0, core: true }, { s: 6, len: 2, oct: 0, semi: 7, core: true }, { s: 10, len: 4, oct: 0, core: true }, { s: 16, len: 4, oct: 1, core: false }]];
  const pack = (base: string, data: object) =>
    ({ key: "lq", name: "Lq", genres: ["liquid"], styles: { liquid: [{ id: "lq-style", name: "L", base, data }] } }) as unknown as StationPack;
  const epochOf = (base: string) => {
    let epoch = 0;
    while (!(eraOf(epoch).id === "liquid" && styleOf(eraById("liquid"), epoch).style.id === base)) epoch++;
    return epoch;
  };
  const at = (base: string, data: object) => {
    const p = pack(base, data);
    expect(validatePack(p)).toEqual([]);
    return schedule("liquid", epochOf(base), programFromPack(p), 40);
  };
  const house = (base: string) => schedule("liquid", epochOf(base), HOUSE_PROGRAM, 40);

  it("Keys with walks plays the walk in place of its rolling sub; semitones move it", () => {
    expect(at("classic", {})).toBe(house("classic"));
    const on = at("classic", { walks: WALK });
    expect(on).not.toBe(house("classic"));
    expect(at("classic", { walks: [WALK[0].map((n) => ({ ...n, semi: 0 }))] })).not.toBe(on);
  });

  it("Soulful's walk semitones: 0 is the root, as left out", () => {
    const root = WALK[0].map(({ semi: _semi, ...n }) => n);
    expect(at("soulful", { walks: [root] })).toBe(at("soulful", { walks: [root.map((n) => ({ ...n, semi: 0 }))] }));
    expect(at("soulful", { walks: WALK })).not.toBe(at("soulful", { walks: [root] }));
  });

  it("the reese: level 0 is the house, on it plays over every base's sub and its fields shape it", () => {
    for (const base of ["classic", "atmos", "soulful"]) {
      expect(at(base, { reese: { level: 0, cutoff: 500 } }), base).toBe(house(base));
      const on = at(base, { reese: { level: 1 } });
      expect(on, base).not.toBe(house(base));
      expect(at(base, { reese: { level: 1, cutoff: 500 } }), base).not.toBe(on);
      expect(at(base, { reese: { level: 1, rate: 1 } }), base).not.toBe(on);
    }
  });

  it("validation: only Keys and Soulful read walks, and the ranges hold", () => {
    expect(validatePack(pack("atmos", { walks: WALK })).join("\n")).toMatch(/data\.walks: base "atmos" does not read it/);
    expect(validatePack(pack("classic", { walks: [[{ s: 0, len: 4, oct: 0, semi: 13, core: true }]] })).join("\n")).toMatch(/walks\[0\]\[0\]\.semi/);
    expect(validatePack(pack("soulful", { reese: { level: 2 } })).join("\n")).toMatch(/reese\.level/);
    expect(validatePack(pack("classic", { reese: { wobble: 1 } })).join("\n")).toMatch(/reese\.wobble: unknown field/);
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

  it("future garage with the UK garage voices: fewer than 9 chords need their own progressions", () => {
    const ukg = { ukg: { level: 1 } };
    expect(validatePack(pack("futuregarage", { ...ukg, chords: Array(7).fill(garage) })).join("\n")).toMatch(/chords: the house progressions use chords 0\.\.8/);
    expect(validatePack(pack("futuregarage", { ...ukg, chords: Array(9).fill(garage) }))).toEqual([]);
    expect(validatePack(pack("futuregarage", { ...ukg, progressions: [[0, 8, 2]] }))).toEqual([]);
    expect(validatePack(pack("futuregarage", { progressions: [[0, 8, 2]] })).join("\n")).toMatch(/progressions\[0\]\[1\]: chord 8 is not in chords/);
  });
});

// UK garage (futuregarage classic + `ukg`, engine.ts garageUkg): every field off by default, each one live when on,
// and every note in the key (the natural minor: 7th / 9th / sus extensions allowed, nothing chromatic).
describe("UK garage voices (off by default)", () => {
  const style = (data: object) => ({ id: "u-garage", name: "U", base: "classic", data });
  const at = (data: object) => {
    const era = eraById("futuregarage");
    let epoch = 0;
    while (!(eraOf(epoch).id === "futuregarage" && styleOf(era, epoch).style.id === "classic")) epoch++;
    const pack = { key: "ukg", name: "UKG", genres: ["futuregarage"], styles: { futuregarage: [style(data)] } } as unknown as StationPack;
    expect(validatePack(pack)).toEqual([]);
    return schedule("futuregarage", epoch, programFromPack(pack), 40);
  };
  const errors = (data: object) => validatePack({ key: "ukg", name: "UKG", genres: ["futuregarage"], styles: { futuregarage: [style(data)] } }).join("\n");

  it("absent or at level 0, the UK garage voices schedule what Vocal Chops does", () => {
    const house = at({});
    expect(at({ ukg: { level: 0 } })).toBe(house);
    expect(at({ ukg: { level: 0, bars: 1, stab: { voices: 4, punch: 12 }, mid: { kind: "fm" }, vox: { level: 1 }, groove: { hatLate: 0.3 } } })).toBe(house);
    expect(at({ ukg: { level: 1 } })).not.toBe(house);
  });

  const ON: [string, object][] = [
    ["level", { level: 0.6 }],
    ["bars", { bars: 1 }],
    ["stab.voices", { stab: { voices: 1 } }],
    ["stab.detune", { stab: { detune: 30 } }],
    ["stab.osc2", { stab: { osc2: 0 } }],
    ["stab.cutoff", { stab: { cutoff: 5000 } }],
    ["stab.slope", { stab: { slope: 24 } }],
    ["stab.env", { stab: { env: 0.8 } }],
    ["stab.decay", { stab: { decay: 0.5 } }],
    ["stab.punch", { stab: { punch: 12 } }],
    ["stab.drive", { stab: { drive: 3 } }],
    ["stab.vel", { stab: { vel: 0 } }],
    ["stab.width", { stab: { width: 1 } }],
    ["stab.octave", { stab: { octave: 12 } }],
    ["organ on", { organ: { level: 1 } }],
    ["sub.level", { sub: { level: 0.5 } }],
    ["sub.glide", { sub: { glide: 0.15 } }],
    ["sub.drive", { sub: { drive: 2 } }],
    ["mid.kind fm", { mid: { kind: "fm" } }],
    ["mid.kind reese", { mid: { kind: "reese" } }],
    ["mid.cutoff", { mid: { cutoff: 900 } }],
    ["drop2 on", { drop2: { level: 1 } }],
    ["pluck.wave", { pluck: { wave: "triangle" } }],
    ["pluck.bend", { pluck: { bend: 5 } }],
    ["pluck off", { pluck: { level: 0 } }],
    ["vox on", { vox: { level: 1 } }],
    ["lead on", { lead: { level: 1 } }],
    ["groove.hatLate", { groove: { hatLate: 0.3 } }],
    ["groove.perc", { groove: { perc: 0 } }],
    ["groove.ghost", { groove: { ghost: 0.5 } }],
    ["groove.open", { groove: { open: 0 } }],
    ["groove.tamb", { groove: { tamb: 1 } }],
    ["groove.ghostKick", { groove: { ghostKick: 1 } }],
    ["m1 on", { m1: { level: 1 } }],
    ["ep on", { ep: { level: 1 } }],
    ["strings on", { strings: { level: 1 } }],
    ["mid.kind organ", { mid: { kind: "organ" } }],
    ["mid.bend", { mid: { bend: 12 } }],
    ["sub.bend", { sub: { bend: 7 } }],
    ["vox.scoop", { vox: { level: 1, scoop: 0.02 } }],
    ["vox.lp", { vox: { level: 1, lp: 3000 } }],
    ["keys", { keys: [5] }],
    ["midEarly", { midEarly: 1 }],
    ["turn", { turn: 0 }],
    ["sweep", { sweep: { bars: 8, depth: 0.7 } }],
    ["strings.hold", { strings: { level: 1, hold: 1 } }],
    ["groove.offOpen", { groove: { offOpen: 1 } }],
    ["groove.metal", { groove: { metal: 1 } }],
  ];

  it("ukg.scale sets the key the chords and basslines are held to", () => {
    const style = (scale: string | undefined, pad: number[], semi = 0) => ({
      ukg: scale ? { scale } : {},
      progressions: [[0]],
      chords: [{ bass: 0, pad, guide: 3, dark: [0, 7, 15] }, { bass: 0, pad, guide: 3, dark: [0, 7, 15] }],
      basslines: [[{ s: 0, len: 1, semi: 0, vel: 1, core: true }, { s: 4, len: 1, semi, vel: 1, core: true }]],
    });
    expect(errors(style(undefined, [0, 1, 7]))).toMatch(/pad\[1\]: 1 is out of the key \(minor/);
    expect(errors(style("phrygian", [0, 1, 7]))).toBe("");
    expect(errors(style("harmonic", [0, 3, 11]))).toBe("");
    expect(errors(style("dark", [0, 6, 12], 1))).toBe("");
    expect(errors(style("dark", [0, 4, 7]))).toMatch(/pad\[1\]: 4 is out of the key \(dark/);
    expect(errors({ ukg: { scale: "lydian" } })).toMatch(/ukg\.scale/);
    expect(errors({ ukg: { keys: [5, 5] } })).toMatch(/ukg\.keys/);
    expect(errors({ ukg: { sweep: { bars: 12 } } })).toMatch(/ukg\.sweep\.bars/);
  });

  it("a call's stutter and octave change what is scheduled; future garage may swing to 0.8", () => {
    const call = (extra: object) => at({ ukg: { vox: { level: 1 } }, calls: [[{ s: 28, len: 2, vowel: 0, tone: 2, core: true, ...extra }]] });
    const plain = call({});
    expect(call({ rep: 2 })).not.toBe(plain);
    expect(call({ oct: -1 })).not.toBe(plain);
    expect(errors({ ukg: {} })).toBe("");
    const swing = (genre: string, base: string, value: number) =>
      validatePack({ key: "sw", name: "S", genres: [genre], styles: { [genre]: [{ id: "sw-x", name: "S", base, swing: value }] } }).join("\n");
    expect(swing("futuregarage", "classic", 0.76)).toBe("");
    expect(swing("futuregarage", "classic", 0.85)).toMatch(/swing/);
    expect(swing("acid", "classic", 0.76)).toMatch(/swing/);
  });
  it("on, every field changes what is scheduled", () => {
    const on = at({ ukg: {} });
    for (const [field, ukg] of ON) expect(at({ ukg }), field).not.toBe(on);
  });

  it("on, the figures change what is scheduled", () => {
    const on = at({ ukg: { vox: { level: 1 } } });
    const figures: [string, object][] = [
      ["stabs", { stabs: [[{ s: 3, len: 1, vel: 1, core: true }, { s: 19, len: 2, vel: 0.5, core: true }]] }],
      ["basslines", { basslines: [[{ s: 0, len: 2, semi: 0, vel: 1, core: true }, { s: 7, len: 2, semi: 12, vel: 0.8, core: true, glide: true }]] }],
      ["motifs", { motifs: [[{ s: 2, len: 1, tone: 0, core: true }, { s: 10, len: 1, tone: 4, oct: 1, core: true }]] }],
      ["calls", { calls: [[{ s: 30, len: 2, vowel: 1, tone: 1, core: true }]] }],
      ["vowels", { vowels: [[300, 2300], [760, 1150]] }],
      ["chords", { chords: Array(9).fill({ bass: 3, pad: [3, 7, 10, 14], guide: 7, dark: [3, 10, 19] }) }],
      ["progressions", { progressions: [[2, 4]] }],
      ["kicks", { kicks: { lo: [[0, 7]], mid: [[0, 7]], hi: [[0, 7]] } }],
    ];
    for (const [field, data] of figures) expect(at({ ukg: { vox: { level: 1 } }, ...data }), field).not.toBe(on);
  });

  it("refuses the figures without the voices, notes out of the key and bad values", () => {
    expect(errors({ stabs: [[{ s: 3, len: 1, vel: 1, core: true }, { s: 9, len: 1, vel: 1, core: true }]] })).toMatch(/stabs: only the UK garage voices read it/);
    expect(errors({ ukg: { level: 0 }, basslines: [[{ s: 0, len: 1, semi: 0, vel: 1, core: true }, { s: 4, len: 1, semi: 12, vel: 1, core: true }]] })).toMatch(/basslines: only the UK garage voices/);
    // A major third over the tonic, a flat second in the bass: chromatic, refused.
    expect(errors({ ukg: {}, progressions: [[0]], chords: [{ bass: 0, pad: [0, 4, 7], guide: 4, dark: [0, 7, 15] }] })).toMatch(/chords\[0\]\.pad\[1\]: 4 is out of the key/);
    expect(errors({ ukg: {}, progressions: [[0]], chords: [{ bass: 1, pad: [0, 3, 7], guide: 3, dark: [0, 7, 15] }] })).toMatch(/chords\[0\]\.bass: 1 is out of the key/);
    // A minor seventh over the bVI (Gb in F minor) is out of the key; the same seventh over the tonic is in it.
    const line = (semi: number) => [[{ s: 0, len: 1, semi: 0, vel: 1, core: true }, { s: 4, len: 1, semi, vel: 1, core: true }]];
    expect(errors({ ukg: {}, basslines: line(10) })).toMatch(/basslines\[0\]\[1\]\.semi: 10 over the chord bass 8, 3 is out of the key/);
    expect(errors({ ukg: {}, progressions: [[0, 4]], chords: [0, 0, 0, 0, 5].map((bass) => ({ bass, pad: [0, 3, 7], guide: 3, dark: [0, 7, 15] })), basslines: line(10) })).toBe("");
    expect(errors({ ukg: {}, calls: [[{ s: 0, len: 1, vowel: 5, tone: 0, core: true }]] })).toMatch(/calls\[0\]\[0\]\.vowel: vowel 5 is not in vowels \(0\.\.4\)/);
    expect(errors({ ukg: { stab: { voices: 5 } } })).toMatch(/ukg\.stab\.voices/);
    expect(errors({ ukg: { stab: { slope: 18 } } })).toMatch(/ukg\.stab\.slope/);
    expect(errors({ ukg: { mid: { kind: "wobble" } } })).toMatch(/ukg\.mid\.kind/);
    expect(errors({ ukg: { groove: { hatLate: 0.5 } } })).toMatch(/ukg\.groove\.hatLate/);
    expect(errors({ ukg: { organ: { bars: [1, 1] } } })).toMatch(/ukg\.organ\.bars/);
  });

  it("the house UK garage tables are in the key", () => {
    for (const chord of UKG_CHORDS) for (const x of [chord.bass, ...chord.pad]) expect(UKG_KEY, `${chord.pad}`).toContain(((x % 12) + 12) % 12);
    expect(UKG_CHORDS.map((c) => c.bass)).toEqual(UKG_CHORD_BASS);
    for (const line of UKG_BASSLINES) for (const n of line) for (const b of UKG_CHORD_BASS) expect(UKG_KEY).toContain((b + n.semi + 24) % 12);
  });
});

// Machine electro additions (stations/machine-electro.ts; styledata.ts ElectroSeqSpec, ElectroMetalSpec, ElectroJitter,
// ElectroBassSpec.ratio and pulse oscillators, words on Alien Rave): every one off unless a style gives it.
describe("machine electro additions (off by default)", () => {
  const BASES = ["classic", "client03", "alienrave"] as const;
  const pack = (base: string, data: object) =>
    ({ key: "mach", name: "Mach", genres: ["electro"], styles: { electro: [{ id: `m-${base}`, name: "M", base, data }] } }) as unknown as StationPack;
  const at = (base: string, data: object) => {
    const era = eraById("electro");
    let epoch = 0;
    while (!(eraOf(epoch).id === "electro" && styleOf(era, epoch).style.id === base)) epoch++;
    const p = pack(base, data);
    expect(validatePack(p)).toEqual([]);
    return schedule("electro", epoch, programFromPack(p), 40);
  };
  const errors = (base: string, data: object) => validatePack(pack(base, data)).join("\n");

  it("the pack validates and every style differs from its base without data", () => {
    expect(validatePack(machineElectro)).toEqual([]);
    const station = programFromPack(machineElectro);
    const era = eraById("electro");
    for (const style of machineElectro.styles.electro) {
      let epoch = 0;
      while (styleOf(era, epoch, station).style.id !== style.id) epoch++;
      const resolved = styleById(era, style.id, station).style;
      const pinned = (s: GenreStyle): Program => ({ key: "pin", eras: [{ fromEpoch: 0, ids: ["electro"] }], styles: [{ fromEpoch: 0, styles: { electro: [s] } }] });
      expect(schedule("electro", epoch, pinned(resolved)), style.id).not.toBe(schedule("electro", epoch, pinned({ ...resolved, data: undefined })));
      expect(style.riser, style.id).toBe(0);
    }
  });

  it("absent or at their off values, the jitter, the FM ratio and the bass waves schedule what the base does", () => {
    for (const base of BASES) {
      const house = at(base, {});
      expect(at(base, { jitter: { hat: 0, ghost: 0 } }), base).toBe(house);
      expect(at(base, { metal: { steps: [1, 0, 0.5], jitter: 0 }, jitter: {} }), base).not.toBe(house);
      expect(at(base, { seq: { notes: [0, 7, 12], evolve: 0 } }), base).not.toBe(house);
    }
    const alien = at("alienrave", {});
    expect(at("alienrave", { bassTone: { ratio: 2 } })).toBe(alien);
    expect(at("alienrave", { bassTone: { osc: SOUND_DEFAULTS.electro.alienrave.bassTone.osc } })).toBe(alien);
  });

  // Each field, on, against the same style without it (or with the field moved).
  const SEQ = { notes: [0, 3, null, 7, 12] };
  const METAL = { steps: [1, 0, 0.5] };
  const ON: [string, readonly string[], object, object][] = [
    ["seq.notes", BASES, { seq: SEQ }, { seq: { notes: [0, 5, null, 10, 12] } }],
    ["seq.rate", BASES, { seq: SEQ }, { seq: { ...SEQ, rate: 2 } }],
    ["seq.octave", BASES, { seq: SEQ }, { seq: { ...SEQ, octave: -12 } }],
    ["seq.follow", ["client03", "alienrave"], { seq: SEQ }, { seq: { ...SEQ, follow: true } }],
    ["seq.gate", BASES, { seq: SEQ }, { seq: { ...SEQ, gate: 2 } }],
    ["seq.level", BASES, { seq: SEQ }, { seq: { ...SEQ, level: 0.9 } }],
    ["seq.accent", BASES, { seq: SEQ }, { seq: { ...SEQ, accent: 0.8 } }],
    ["seq.evolve", BASES, { seq: SEQ }, { seq: { ...SEQ, evolve: 1 } }],
    ["metal.steps", BASES, { metal: METAL }, { metal: { steps: [0, 1, 0, 0.5, 0] } }],
    ["metal.freq", BASES, { metal: METAL }, { metal: { ...METAL, freq: 900 } }],
    ["metal.ratio", BASES, { metal: METAL }, { metal: { ...METAL, ratio: 2.76 } }],
    ["metal.index", BASES, { metal: METAL }, { metal: { ...METAL, index: 6 } }],
    ["metal.decay", BASES, { metal: METAL }, { metal: { ...METAL, decay: 0.2 } }],
    ["metal.level", BASES, { metal: METAL }, { metal: { ...METAL, level: 0.3 } }],
    ["metal.pan", BASES, { metal: METAL }, { metal: { ...METAL, pan: 0.1 } }],
    ["metal.jitter", BASES, { metal: METAL }, { metal: { ...METAL, jitter: 10 } }],
    ["jitter.hat", BASES, {}, { jitter: { hat: 6 } }],
    ["jitter.ghost", ["client03"], {}, { jitter: { ghost: 6 } }],
    ["bassTone.ratio", ["alienrave"], {}, { bassTone: { ratio: 1.5 } }],
    ["bassTone pulse25", ["client03", "alienrave"], {}, { bassTone: { osc: [{ type: "pulse25", detune: 0, level: 0.5 }] } }],
    ["bassTone pulse12", ["client03", "alienrave"], { bassTone: { osc: [{ type: "pulse25", detune: 0, level: 0.5 }] } }, { bassTone: { osc: [{ type: "pulse12", detune: 0, level: 0.5 }] } }],
    ["words on alienrave", ["alienrave"], {}, { words: [{ s: 2, syl: [[390, 1990, "s"], [530, 1840, "t"]] }] }],
    ["words of eight syllables", ["client03"], { words: [{ s: 2, syl: [[390, 1990, "s"], [530, 1840, "t"]] }] }, { words: [{ s: 2, syl: [[390, 1990, "s"], [530, 1840, "t"], [390, 1990, null], [270, 2290, "s"], [300, 870, null], [640, 1190, null], [390, 1990, "s"], [640, 1190, null]] }] }],
  ];

  it("on, every field changes what is scheduled", () => {
    for (const [field, bases, a, b] of ON) for (const base of bases) expect(at(base, b), `${base} ${field}`).not.toBe(at(base, a));
  });

  it("refuses bad values", () => {
    expect(errors("classic", { seq: { notes: [0, 7] } })).toMatch(/seq\.notes: expected 3\.\.16 entries/);
    expect(errors("classic", { seq: { notes: [0, null, null] } })).toMatch(/seq\.notes: needs at least 2 notes/);
    expect(errors("classic", { seq: { rate: 2 } })).toMatch(/seq\.notes: missing/);
    expect(errors("classic", { seq: { notes: [0, 3, 30] } })).toMatch(/seq\.notes\[2\]: expected an integer in -12\.\.24/);
    expect(errors("classic", { seq: { notes: [0, 3, 7], rate: 5 } })).toMatch(/seq\.rate/);
    expect(errors("classic", { seq: { notes: [0, 3, 7], evolve: 64 } })).toMatch(/seq\.evolve/);
    expect(errors("classic", { metal: { steps: [0, 0, 0] } })).toMatch(/metal\.steps: needs at least one hit/);
    expect(errors("classic", { metal: { steps: [1, 0] } })).toMatch(/metal\.steps: expected 3\.\.16 entries/);
    expect(errors("classic", { metal: { steps: [1, 0, 0], level: 0.8 } })).toMatch(/metal\.level/);
    expect(errors("classic", { metal: { steps: [1, 0, 0], jitter: 20 } })).toMatch(/metal\.jitter/);
    expect(errors("classic", { jitter: { hat: 20 } })).toMatch(/jitter\.hat: expected a number in 0\.\.15/);
    expect(errors("classic", { jitter: { kick: 2 } })).toMatch(/jitter\.kick: unknown field/);
    expect(errors("classic", { words: [{ s: 2, syl: [[390, 1990, "s"]] }] })).toMatch(/base "classic" does not read it/);
    expect(errors("client03", { words: [{ s: 2, syl: Array(9).fill([390, 1990, null]) }] })).toMatch(/words\[0\]\.syl: expected 1\.\.8 entries/);
    expect(errors("alienrave", { bassTone: { ratio: 5 } })).toMatch(/bassTone\.ratio: expected a number in 0\.5\.\.4/);
    expect(errors("alienrave", { bassTone: { osc: [{ type: "pulse50", detune: 0, level: 0.5 }] } })).toMatch(/bassTone\.osc\[0\]\.type/);
  });
});
