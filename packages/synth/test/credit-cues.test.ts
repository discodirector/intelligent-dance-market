import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VoiceEngine } from "../src/engine.ts";
import { CueQueue, eraById, initialState, PACKS, planSteps, programFromPack, SALE_QUEUE, type GenreId, type Program, type TimelinePoint } from "../src/index.ts";

// NFT station cues (clock.ts SaleCue / LockCue; engine.ts creditSale / creditLock): a rated Credit sale and a BALANCE
// withdraw. Off by default: a timeline without them plans and schedules exactly as before (engine-trace --packs
// proves it against main); with them, only dub techno plays them. Stand-in context as in attention.test.ts.

function recordingContext() {
  const log: string[] = [];
  let next = 0;
  const fmt = (x: unknown): string => {
    if (x === null || x === undefined || typeof x !== "object") return typeof x === "function" ? ((x as any).__id ?? "fn") : String(x);
    if ((x as any).__id) return (x as any).__id;
    if ((x as any).__buffer) return `${(x as any).__buffer}`;
    if (ArrayBuffer.isView(x)) return `f32:${createHash("sha1").update(Buffer.from((x as Float32Array).buffer)).digest("hex").slice(0, 12)}`;
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

const credits = programFromPack(PACKS.credits);
const busy = (k: number) => ({ ...initialState(), patternId: k % 4, pattern: 0x9249_2492_4924_9249n ^ BigInt(k * 0x1357), bass: 0x8421_8421_8421_8421n, heat: 0.3, lastTick: k * 400 });
const points = (cues: boolean): TimelinePoint[] =>
  Array.from({ length: 10 }, (_, k) => ({
    time: k * 2,
    state: busy(k),
    ...(cues ? { sale: { pct: (k * 61) % 256, mask: (k % 15) + 1 } } : {}),
    ...(cues && k === 3 ? { lock: { points: 40_856, ink: [24, 23, 24, 27] as const } } : {}),
  }));

function schedule(genre: GenreId, program: Program | undefined, pts: TimelinePoint[]) {
  const { ctx, log } = recordingContext();
  const engine = new VoiceEngine(ctx, eraById(genre).index, 0, program);
  for (const hit of planSteps(pts, 20, genre, 16, program)) engine.trigger(hit);
  return log;
}

describe("NFT cues: where they land", () => {
  it("a timeline without cues plans no cue fields (every other station, the house)", () => {
    for (const h of planSteps(points(false), 20, "dubtechno", 16, credits)) {
      expect("sale" in h).toBe(false);
      expect("lock" in h).toBe(false);
    }
  });

  it("sales land one per 8th, the newest SALE_QUEUE of a sweep; a withdraw on the next downbeat", () => {
    const q = new CueQueue();
    for (let i = 0; i < 6; i++) q.pushSale({ pct: i, mask: 1 });
    q.pushLock({ points: 1 });
    expect(q.take(1)).toEqual({});
    expect(q.take(2)).toEqual({ sale: { pct: 6 - SALE_QUEUE, mask: 1 } });
    const landed = [3, 4, 5, 6, 7, 8, 9, 10].map((s) => q.take(s).sale?.pct ?? null);
    expect(landed).toEqual([null, 3, null, 4, null, 5, null, null]);
    expect(q.take(0)).toEqual({ lock: { points: 1 } });
    const hits = planSteps(points(true), 20, "dubtechno", 16, credits);
    expect(hits.filter((h) => h.sale).every((h) => h.step % 2 === 0)).toBe(true);
    expect(hits.filter((h) => h.lock).map((h) => h.step)).toEqual([0]);
    expect(hits.filter((h) => h.sale).length).toBe(10);
  });
});

describe("NFT cues: what the engine plays", () => {
  it("dub techno (the Credits program): the cues schedule more voices; the same timeline without them is untouched", () => {
    const a = schedule("dubtechno", credits, points(false));
    const b = schedule("dubtechno", credits, points(true));
    expect(b.length).toBeGreaterThan(a.length);
    // Before the first cue lands everything is identical.
    const first = b.findIndex((l, i) => l !== a[i]);
    expect(first).toBeGreaterThan(100);
  });

  it("another genre ignores them: bit-identical schedule", () => {
    for (const g of ["acid", "electro", "ambientidm"] as GenreId[]) expect(schedule(g, undefined, points(true)), g).toEqual(schedule(g, undefined, points(false)));
  });

  it("deterministic: the same cues schedule the same", () => {
    expect(schedule("dubtechno", credits, points(true))).toEqual(schedule("dubtechno", credits, points(true)));
  });
});
