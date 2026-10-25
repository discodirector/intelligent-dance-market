import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORNAMENT_PLAN, VoiceEngine } from "../src/engine.ts";
import { eraById, GENRE_STYLES, initialState, OrnamentQueue, planSteps, type GenreId, type OrnamentCue, type Program, type StepHit } from "../src/index.ts";

// Attention layer (prototype, docs/STATIONS.md): mentions played as quiet ornaments through each base's own voice.
// The engine is driven the way the rig drives its primary engine (player.ts EraRig.play), on a stand-in context that
// logs every node, connection, parameter write and buffer (as test/pack.test.ts and scripts/engine-trace.ts do).

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

/** A one-style program: `genre` playing only `style` (as the showcase renders every house style). */
const only = (genre: GenreId, style: string): Program => ({
  key: `only-${genre}-${style}`,
  eras: [{ fromEpoch: 0, ids: [genre] }],
  styles: [{ fromEpoch: 0, styles: { [genre]: GENRE_STYLES[genre].filter((s) => s.id === style) } }],
});

/** A busy stretch of chain states (pack.test.ts schedule()), full song-form section from bar 16. */
function hitsFor(genre: GenreId, program: Program, seconds: number): StepHit[] {
  const busy = (k: number) => ({
    ...initialState(),
    patternId: k % 4,
    pattern: 0x9249_2492_4924_9249n ^ BigInt(k * 0x1357),
    bass: 0x8421_8421_8421_8421n >> BigInt(k % 5),
    heat: Math.min(1, k / 6),
    pressure: (k % 3) * 3000 - 3000,
    lastTick: k * 400,
  });
  const points = Array.from({ length: 8 }, (_, k) => ({ time: k * 1.5, state: busy(k) }));
  return planSteps(points, seconds, genre, 16, program).filter((hit) => hit.time < seconds);
}

/** The rig's primary path: offer the queue's due mention each step. Returns the log hash and the steps that played one. */
function drive(genre: GenreId, style: string, cues: readonly OrnamentCue[], seconds = 12) {
  const program = only(genre, style);
  const { ctx, log } = recordingContext();
  const engine = new VoiceEngine(ctx, eraById(genre).index, 0, program);
  const queue = new OrnamentQueue();
  for (const cue of cues) queue.request(cue);
  const played: StepHit[] = [];
  for (const hit of hitsFor(genre, program, seconds)) {
    const due = queue.due(hit);
    if (engine.trigger(hit, true, due) && due) {
      queue.played(hit);
      played.push(hit);
    }
  }
  return { hash: createHash("sha256").update(log.join("\n")).digest("hex"), played, pending: queue.pending };
}

const WAVE: OrnamentCue[] = [2.0, 3.1, 3.9, 4.4, 4.8, 5.1, 5.45, 5.9, 6.6, 7.5].map((time) => ({ time, ...(time === 5.45 ? { smart: true } : {}) }));
const ALL = (Object.keys(GENRE_STYLES) as GenreId[]).flatMap((genre) => GENRE_STYLES[genre].map((s) => [genre, s.id] as const));

afterEach(() => vi.restoreAllMocks());

describe("attention layer", () => {
  it("every house style has an ornament voice that the engine has, and slots inside the bar", () => {
    expect(ALL.length).toBe(30);
    for (const [genre, style] of ALL) {
      const plan = ORNAMENT_PLAN[genre][style];
      expect(plan, `${genre}/${style}`).toBeDefined();
      expect(typeof (VoiceEngine.prototype as any)[plan.voice], `${genre}/${style} ${plan.voice}`).toBe("function");
      expect(plan.slots.every((s) => Number.isInteger(s) && s >= 0 && s < 16)).toBe(true);
    }
  });

  it("no mentions: the engine schedules exactly what it schedules without the layer", () => {
    for (const [genre, style] of ALL) {
      const program = only(genre, style);
      const plain = recordingContext();
      const engine = new VoiceEngine(plain.ctx, eraById(genre).index, 0, program);
      for (const hit of hitsFor(genre, program, 6)) engine.trigger(hit);
      expect(drive(genre, style, [], 6).hash, `${genre}/${style}`).toBe(createHash("sha256").update(plain.log.join("\n")).digest("hex"));
    }
  });

  it("is deterministic: the same mentions schedule the same audio, and mentions change it", () => {
    for (const [genre, style] of ALL) {
      const a = drive(genre, style, WAVE);
      const b = drive(genre, style, WAVE);
      expect(a.hash, `${genre}/${style}`).toBe(b.hash);
      expect(a.played.map((h) => h.gridTime)).toEqual(b.played.map((h) => h.gridTime));
      expect(a.hash, `${genre}/${style}`).not.toBe(drive(genre, style, []).hash);
    }
  });

  it("each base plays a mention through its own voice, on one of its slots", () => {
    for (const [genre, style] of ALL) {
      const { voice } = ORNAMENT_PLAN[genre][style];
      const program = only(genre, style);
      const spy = vi.spyOn(VoiceEngine.prototype as any, voice);
      // Two engines in lockstep: one is offered a mention every step until it plays it.
      const plain = new VoiceEngine(recordingContext().ctx, eraById(genre).index, 0, program);
      const asked = new VoiceEngine(recordingContext().ctx, eraById(genre).index, 0, program);
      let played: StepHit | null = null;
      for (const hit of hitsFor(genre, program, 8)) {
        spy.mockClear();
        plain.trigger(hit, true);
        const base = spy.mock.calls.length;
        const took = asked.trigger(hit, true, played ? null : { smart: false, index: 0 });
        const extra = spy.mock.calls.length - 2 * base;
        if (took) {
          expect(extra, `${genre}/${style}: ${voice} on step ${hit.step}`).toBeGreaterThanOrEqual(1);
          expect(ORNAMENT_PLAN[genre][style].slots).toContain(hit.step);
          played = hit;
        } else expect(extra, `${genre}/${style}: no ornament, no extra ${voice}`).toBe(0);
      }
      expect(played, `${genre}/${style} never played its ornament`).not.toBeNull();
      spy.mockRestore();
    }
  });

  it("a smart mention is played, and differs from a plain one", () => {
    for (const [genre, style] of ALL) {
      const plain = drive(genre, style, [{ time: 2 }]);
      const smart = drive(genre, style, [{ time: 2, smart: true }]);
      expect(plain.played.length).toBe(1);
      expect(smart.played.length).toBe(1);
      expect(smart.hash, `${genre}/${style}`).not.toBe(plain.hash);
    }
  });

  it("slots and spacing: on the base's slots, never before the request, never closer than an 8th", () => {
    // A dense burst: a mention every 50 ms for four seconds.
    const burst: OrnamentCue[] = Array.from({ length: 80 }, (_, i) => ({ time: 2 + i * 0.05 }));
    for (const [genre, style] of ALL) {
      const { played } = drive(genre, style, burst);
      expect(played.length, `${genre}/${style}`).toBeGreaterThan(1);
      for (const hit of played) expect(ORNAMENT_PLAN[genre][style].slots, `${genre}/${style}`).toContain(hit.step);
      for (let i = 1; i < played.length; i++) {
        expect(played[i].gridTime - played[i - 1].gridTime, `${genre}/${style}`).toBeGreaterThanOrEqual(2 * played[i].duration - 1e-6);
      }
      expect(played[0].time).toBeGreaterThanOrEqual(2);
    }
  });

  it("the queue: due in time order, an 8th apart, and a mention a bar late is let go", () => {
    const q = new OrnamentQueue();
    const hit = (step: number, d = 0.125) => ({ gridTime: step * d, time: step * d, duration: d });
    q.request({ time: 1 });
    q.request({ time: 0.2, smart: true });
    q.request({ time: Number.NaN });
    expect(q.pending).toBe(2);
    expect(q.due(hit(1))).toBeNull(); // 0.125 < 0.2: not yet
    expect(q.due(hit(2))).toEqual({ smart: true, index: 0 });
    q.played(hit(2));
    expect(q.due(hit(7))).toBeNull(); // 0.875 < 1
    expect(q.due(hit(8))).toEqual({ smart: false, index: 1 });
    // Not played on step 8 (not a slot of the genre): still waiting a bar later, then let go.
    expect(q.due(hit(8 + 16))).toEqual({ smart: false, index: 1 });
    expect(q.due(hit(8 + 17))).toBeNull();
    expect(q.pending).toBe(0);
    // Spacing: after playing on step 30, step 31 may not play, step 32 may.
    q.request({ time: 3.5 });
    q.request({ time: 3.5 });
    expect(q.due(hit(30))).not.toBeNull();
    q.played(hit(30));
    expect(q.due(hit(31))).toBeNull();
    expect(q.due(hit(32))).toEqual({ smart: false, index: 2 });
  });
});

describe("attention layer: the electro robot word as style data (packs restyle it)", () => {
  /** Client_03 with `data` on top, as a pack style on that base would be. */
  const styled = (data: Record<string, unknown>): Program => {
    const base = GENRE_STYLES.electro.find((s) => s.id === "client03")!;
    return { key: "styled-electro", eras: [{ fromEpoch: 0, ids: ["electro"] }], styles: [{ fromEpoch: 0, styles: { electro: [{ ...base, id: "x-robot", data: { ...(base as any).data, ...data } }] } }] } as unknown as Program;
  };
  function run(program: Program, cues: readonly OrnamentCue[]) {
    const { ctx, log } = recordingContext();
    const engine = new VoiceEngine(ctx, eraById("electro").index, 0, program);
    const queue = new OrnamentQueue();
    for (const cue of cues) queue.request(cue);
    const played: StepHit[] = [];
    for (const hit of hitsFor("electro", program, 12)) {
      const due = queue.due(hit);
      if (engine.trigger(hit, true, due) && due) {
        queue.played(hit);
        played.push(hit);
      }
    }
    return { hash: createHash("sha256").update(log.join("\n")).digest("hex"), played, log };
  }
  const ornament = { wave: "sawtooth", vowels: [[330, 650], [700, 1200], [400, 2200]], steps: 4, ring: 1.5, slots: [4, 12] };

  it("the style's ornament changes the word and where it lands", () => {
    const base = run(styled({}), WAVE);
    const own = run(styled({ ornament }), WAVE);
    expect(own.hash).not.toBe(base.hash);
    expect(own.played.length).toBeGreaterThan(0);
    for (const hit of own.played) expect([4, 12]).toContain(hit.step);
    expect(own.log.some((l) => l.includes(".type=sawtooth"))).toBe(true);
  });

  it("without mentions the ornament data plays nothing: the style sounds exactly like its base", () => {
    expect(run(styled({ ornament }), []).hash).toBe(run(styled({}), []).hash);
  });

  it("validatePack takes a robot word in range and refuses one that would cover the track or ring", async () => {
    const { validatePack } = await import("../src/pack.ts");
    const pack = (orn: Record<string, unknown>) => ({
      key: "robots", name: "Robots", genres: ["electro", "acid"],
      styles: { electro: [{ id: "x-robot", name: "Robot", base: "client03", data: { ornament: orn } }], acid: [{ id: "x-acid", name: "Acid", base: "classic" }] },
    });
    expect(validatePack(pack(ornament))).toEqual([]);
    expect(validatePack(pack({ ...ornament, echo: null }))).toEqual([]);
    const bad = validatePack(pack({ level: 0.3, echo: { steps: 3, feedback: 0.9 }, slots: [16], vowels: [[700, 1200], [700, 1200], [700, 1200], [700, 1200], [700, 1200]] })).join("\n");
    expect(bad).toMatch(/ornament\.level/);
    expect(bad).toMatch(/ornament\.echo\.feedback/);
    expect(bad).toMatch(/ornament\.slots\[0\]/);
    expect(bad).toMatch(/ornament\.vowels/);
  });
});

describe("attention layer: the future garage mention voices (per base, style data restyles them)", () => {
  /** `base` with `data` on top, as a pack style on that base would be. */
  const styled = (base: string, data: Record<string, unknown>): Program => {
    const b = GENRE_STYLES.futuregarage.find((s) => s.id === base)!;
    return { key: `styled-garage-${base}`, eras: [{ fromEpoch: 0, ids: ["futuregarage"] }], styles: [{ fromEpoch: 0, styles: { futuregarage: [{ ...b, id: "x-garage", base, data: { ...(b as any).data, ...data } }] } }] } as unknown as Program;
  };
  const VOICES = ["mentionReverse", "mentionFoley", "mentionGroove", "mentionYeah"] as const;
  type Voice = (typeof VOICES)[number];
  /** Drive `program` with `cues`; count the calls of every mention voice. */
  function run(program: Program, cues: readonly OrnamentCue[]) {
    const spies = Object.fromEntries(VOICES.map((v) => [v, vi.spyOn(VoiceEngine.prototype as any, v)]));
    const { ctx, log } = recordingContext();
    const engine = new VoiceEngine(ctx, eraById("futuregarage").index, 0, program);
    const queue = new OrnamentQueue();
    for (const cue of cues) queue.request(cue);
    const played: StepHit[] = [];
    for (const hit of hitsFor("futuregarage", program, 12)) {
      const due = queue.due(hit);
      if (engine.trigger(hit, true, due) && due) {
        queue.played(hit);
        played.push(hit);
      }
    }
    const calls = Object.fromEntries(VOICES.map((v) => [v, spies[v].mock.calls.length])) as Record<Voice, number>;
    vi.restoreAllMocks();
    return { hash: createHash("sha256").update(log.join("\n")).digest("hex"), played, calls, log };
  }
  /** `k` plain mentions, well apart. */
  const plainWave = (k: number): OrnamentCue[] => Array.from({ length: k }, (_, i) => ({ time: 2 + i * 0.9 }));

  it("each base plays all its voices on its slots; a smart mention its smart set", () => {
    const expected: Record<string, { slots: number[]; plain: Voice[]; smart: Voice[] }> = {
      classic: { slots: [6, 14], plain: ["mentionYeah"], smart: ["mentionYeah", "mentionGroove"] },
      dark: { slots: [3, 11], plain: ["mentionGroove", "mentionFoley"], smart: ["mentionReverse", "mentionFoley"] },
      atmos: { slots: [3, 11], plain: ["mentionFoley"], smart: ["mentionReverse"] },
    };
    for (const [base, e] of Object.entries(expected)) {
      expect(ORNAMENT_PLAN.futuregarage[base]).toEqual({ voice: "garageMention", slots: e.slots });
      const plain = run(only("futuregarage", base), plainWave(4));
      expect(plain.played.length, base).toBe(4);
      for (const hit of plain.played) expect(e.slots, base).toContain(hit.step);
      for (const v of VOICES) expect(plain.calls[v], `${base} ${v}`).toBe(e.plain.includes(v) ? 4 : 0);
      const smart = run(only("futuregarage", base), [{ time: 2, smart: true }]);
      expect(smart.played.length, base).toBe(1);
      for (const v of VOICES) expect(smart.calls[v], `${base} smart ${v}`).toBe(e.smart.includes(v) ? 1 : 0);
    }
  });

  it("the reverse breath swells from its step and is cut on the next strong beat (step 0 or 8)", () => {
    const { log, played } = run(styled("atmos", {}), [{ time: 2, smart: true }]);
    const hit = played[0];
    const cut = hit.gridTime + (8 - (hit.step % 8)) * hit.duration;
    expect(log.some((l) => l.includes(`exponentialRampToValueAtTime(${0.05 * 1.5},${cut - 0.005})`))).toBe(true);
    expect(log.some((l) => l.includes(`linearRampToValueAtTime(0.0001,${cut})`))).toBe(true);
  });

  it("the style's ornament changes the voices and where they land", () => {
    const base = run(styled("classic", {}), plainWave(3));
    const own = run(styled("classic", { ornament: { voices: ["foley", "groove"], foley: ["vinyl"], level: 0.8, slots: [4, 12] } }), plainWave(3));
    expect(own.hash).not.toBe(base.hash);
    expect(own.played.length).toBe(3);
    for (const hit of own.played) expect([4, 12]).toContain(hit.step);
    expect(own.calls).toEqual({ mentionReverse: 0, mentionFoley: 3, mentionGroove: 3, mentionYeah: 0 });
  });

  it("without mentions the ornament data plays nothing: the style sounds exactly like its base", () => {
    for (const b of ["classic", "dark", "atmos"]) {
      const ornament = { voices: ["reverse", "yeah"], smart: ["foley"], level: 1.4, slots: [0, 8] };
      expect(run(styled(b, { ornament }), []).hash, b).toBe(run(styled(b, {}), []).hash);
    }
  });

  it("validatePack takes a garage mention in range and refuses one out of range", async () => {
    const { validatePack } = await import("../src/pack.ts");
    const pack = (orn: Record<string, unknown>) => ({
      key: "garages", name: "Garages", genres: ["futuregarage", "acid"],
      styles: { futuregarage: [{ id: "x-garage", name: "Garage", base: "dark", data: { ornament: orn } }], acid: [{ id: "x-acid", name: "Acid", base: "classic" }] },
    });
    expect(validatePack(pack({ voices: ["reverse", "foley", "groove", "yeah"], smart: ["yeah"], foley: ["lighter", "drop", "vinyl"], level: 1.6, slots: [4, 12] }))).toEqual([]);
    expect(validatePack(pack({ level: 0 }))).toEqual([]);
    const bad = validatePack(pack({ level: 2, slots: [16], voices: ["reverse", "foley", "groove", "yeah", "yeah"], smart: ["shout"], foley: [] })).join("\n");
    expect(bad).toMatch(/ornament\.level/);
    expect(bad).toMatch(/ornament\.slots\[0\]/);
    expect(bad).toMatch(/ornament\.voices: expected 1\.\.4 entries/);
    expect(bad).toMatch(/ornament\.smart\[0\]/);
    expect(bad).toMatch(/ornament\.foley: expected 1\.\.3/);
    expect(validatePack(pack({ voices: ["foley", "foley"] })).join("\n")).toMatch(/ornament\.voices: expected each entry once/);
  });
});

describe("attention layer: the liquid mention voices (per base, style data restyles them)", () => {
  /** `base` with `data` on top, as a pack style on that base would be. */
  const styled = (base: string, data: Record<string, unknown>): Program => {
    const b = GENRE_STYLES.liquid.find((s) => s.id === base)!;
    return { key: `styled-liquid-${base}`, eras: [{ fromEpoch: 0, ids: ["liquid"] }], styles: [{ fromEpoch: 0, styles: { liquid: [{ ...b, id: "x-liquid", base, data: { ...(b as any).data, ...data } }] } }] } as unknown as Program;
  };
  const VOICES = ["mentionNature", "mentionAmen", "mentionKeys"] as const;
  type Voice = (typeof VOICES)[number];
  /** Drive `program` with `cues`; count the calls of every mention voice and keep the nature sounds asked for. */
  function run(program: Program, cues: readonly OrnamentCue[]) {
    const spies = Object.fromEntries(VOICES.map((v) => [v, vi.spyOn(VoiceEngine.prototype as any, v)]));
    const motif = vi.spyOn(VoiceEngine.prototype as any, "motifNote");
    const { ctx, log } = recordingContext();
    const engine = new VoiceEngine(ctx, eraById("liquid").index, 0, program);
    const queue = new OrnamentQueue();
    for (const cue of cues) queue.request(cue);
    const played: StepHit[] = [];
    for (const hit of hitsFor("liquid", program, 12)) {
      const due = queue.due(hit);
      if (engine.trigger(hit, true, due) && due) {
        queue.played(hit);
        played.push(hit);
      }
    }
    const calls = Object.fromEntries(VOICES.map((v) => [v, spies[v].mock.calls.length])) as Record<Voice, number>;
    const nature = spies.mentionNature.mock.calls.map((a) => a[1] as string);
    const attacks = motif.mock.calls.map((a) => a[4] as number | undefined);
    vi.restoreAllMocks();
    return { hash: createHash("sha256").update(log.join("\n")).digest("hex"), played, calls, nature, attacks, log };
  }
  /** `k` plain mentions, well apart. */
  const plainWave = (k: number): OrnamentCue[] => Array.from({ length: k }, (_, i) => ({ time: 2 + i * 0.9 }));

  it("each base plays all its voices on its slots; a smart mention its smart set", () => {
    const expected: Record<string, { slots: number[]; plain: Voice[]; smart: Voice[] }> = {
      classic: { slots: [2, 10], plain: ["mentionNature"], smart: ["mentionNature"] },
      soulful: { slots: [3, 7, 11, 15], plain: ["mentionAmen"], smart: ["mentionAmen", "mentionNature"] },
      atmos: { slots: [2, 6, 10, 14], plain: ["mentionKeys"], smart: ["mentionKeys"] },
    };
    for (const [base, e] of Object.entries(expected)) {
      expect(ORNAMENT_PLAN.liquid[base]).toEqual({ voice: "liquidMention", slots: e.slots });
      const plain = run(only("liquid", base), plainWave(4));
      expect(plain.played.length, base).toBe(4);
      for (const hit of plain.played) expect(e.slots, base).toContain(hit.step);
      for (const v of VOICES) expect(plain.calls[v], `${base} ${v}`).toBe(e.plain.includes(v) ? 4 : 0);
      const smart = run(only("liquid", base), [{ time: 2, smart: true }]);
      expect(smart.played.length, base).toBe(1);
      for (const v of VOICES) expect(smart.calls[v], `${base} smart ${v}`).toBe(e.smart.includes(v) ? 1 : 0);
      // A smart mention's nature is the two birds answering.
      expect(smart.nature.every((k) => k === "bird"), base).toBe(true);
    }
  });

  it("Keys plays a bird, a gust and a drop in turn; Soulful's smart roll is four rising ghost hits a 32nd apart", () => {
    expect(run(only("liquid", "classic"), plainWave(4)).nature).toEqual(["bird", "gust", "drop", "bird"]);
    const { log, played } = run(only("liquid", "soulful"), [{ time: 2, smart: true }]);
    const hit = played[0];
    for (let j = 0; j < 4; j++) {
      const at = hit.time + j * hit.duration * 0.5;
      expect(log.some((l) => l.includes(`setValueAtTime(${0.16 * (0.45 + j * 0.2)},`)), `hit ${j}`).toBe(true);
      expect(log.some((l) => l.includes(`frequency.setValueAtTime(240,${at})`)), `hit ${j} at ${at}`).toBe(true);
    }
  });

  it("the key note speaks on its step: a fast attack for the mention, the track's own notes keep the patch's", () => {
    const { attacks, calls } = run(only("liquid", "atmos"), plainWave(3));
    expect(calls.mentionKeys).toBe(3);
    const capped = attacks.filter((a) => a !== undefined);
    expect(capped.length).toBe(3);
    expect(capped.every((a) => a! <= 0.01)).toBe(true);
    expect(attacks.length).toBeGreaterThan(3);
  });

  it("the style's ornament changes the voices and where they land", () => {
    const base = run(styled("classic", {}), plainWave(3));
    const own = run(styled("classic", { ornament: { voices: ["amen", "keys"], level: 0.8, slots: [4, 12] } }), plainWave(3));
    expect(own.hash).not.toBe(base.hash);
    expect(own.played.length).toBe(3);
    for (const hit of own.played) expect([4, 12]).toContain(hit.step);
    expect(own.calls).toEqual({ mentionNature: 0, mentionAmen: 3, mentionKeys: 3 });
    const drops = run(styled("soulful", { ornament: { voices: ["nature"], nature: ["drop"] } }), plainWave(2));
    expect(drops.nature).toEqual(["drop", "drop"]);
  });

  it("without mentions the ornament data plays nothing: the style sounds exactly like its base", () => {
    for (const b of ["classic", "soulful", "atmos"]) {
      const ornament = { voices: ["nature", "amen", "keys"], smart: ["keys"], nature: ["gust"], level: 1.4, slots: [0, 8] };
      expect(run(styled(b, { ornament }), []).hash, b).toBe(run(styled(b, {}), []).hash);
    }
  });

  it("validatePack takes a liquid mention in range and refuses one out of range", async () => {
    const { validatePack } = await import("../src/pack.ts");
    const pack = (orn: Record<string, unknown>) => ({
      key: "liquids", name: "Liquids", genres: ["liquid", "acid"],
      styles: { liquid: [{ id: "x-liquid", name: "Liquid", base: "soulful", data: { ornament: orn } }], acid: [{ id: "x-acid", name: "Acid", base: "classic" }] },
    });
    expect(validatePack(pack({ voices: ["nature", "amen", "keys"], smart: ["amen"], nature: ["bird", "gust", "drop"], level: 1.6, slots: [3, 11] }))).toEqual([]);
    expect(validatePack(pack({ level: 0 }))).toEqual([]);
    const bad = validatePack(pack({ level: 2, slots: [16], voices: ["nature", "amen", "keys", "keys"], smart: ["choir"], nature: [] })).join("\n");
    expect(bad).toMatch(/ornament\.level/);
    expect(bad).toMatch(/ornament\.slots\[0\]/);
    expect(bad).toMatch(/ornament\.voices: expected 1\.\.3 entries/);
    expect(bad).toMatch(/ornament\.smart\[0\]/);
    expect(bad).toMatch(/ornament\.nature: expected 1\.\.3/);
    expect(validatePack(pack({ voices: ["amen", "amen"] })).join("\n")).toMatch(/ornament\.voices: expected each entry once/);
    expect(validatePack(pack({ nature: ["bird", "bird"] })).join("\n")).toMatch(/ornament\.nature: expected each entry once/);
  });
});
