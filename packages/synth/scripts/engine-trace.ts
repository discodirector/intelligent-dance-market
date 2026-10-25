// Engine trace: records everything VoiceEngine schedules (every node it creates, every connection, every parameter
// write and every buffer, hashed) for every house style of every genre, on a few epochs and two timelines (busy with
// drops and a track drop; going idle and recovering), and compares two versions of the synth. Use it after any engine
// refactor that must not change the house sound (style packs open engine constants to data: a style with no data must
// schedule exactly what it did before).
//
//   tsx packages/synth/scripts/engine-trace.ts --ref HEAD          compare the working tree against a git ref
//   tsx packages/synth/scripts/engine-trace.ts                     print the working tree's trace hashes (JSON)
//   options: --seconds 40  --epochs 3  --genre <id>  --verbose (print the first differing log line)
//            --packs infer,credits   the baked packs' styles instead of the house ones (each in its pack's program)
//            --cues                  the busy timeline also carries NFT cues (a rated sale per point, a BALANCE
//                                    withdraw at point 4): what only a collection station's tags schedule
//
// No audio is rendered: a stand-in BaseAudioContext logs the calls (as test/pack.test.ts does). Two engines with equal
// logs schedule the same audio. Exit 1 on any difference.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const REF = arg("--ref");
const SECONDS = Number(arg("--seconds") ?? 40);
const EPOCHS = Number(arg("--epochs") ?? 3);
const ONLY = arg("--genre");
const VERBOSE = process.argv.includes("--verbose");
const PACKS = arg("--packs")?.split(",").filter(Boolean) ?? [];
const CUES = process.argv.includes("--cues");

/** A stand-in BaseAudioContext that logs every node, connection, parameter write and buffer (hashed), in order. */
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

type Synth = typeof import("../src/index.ts");
type Engine = typeof import("../src/engine.ts");

/** Two timelines per epoch: busy (heat ramp, a whale drop, a track drop) and idle (stale swaps, then a recovery). */
function timelines(synth: Synth, epoch: number) {
  const base = synth.initialState();
  const busy = (k: number) => ({
    ...base,
    patternId: 4 * epoch + (k % 4),
    pattern: 0x9249_2492_4924_9249n ^ BigInt(k * 0x1357),
    bass: 0x8421_8421_8421_8421n >> BigInt(k % 5),
    heat: Math.min(1, k / 7),
    pressure: (k % 3) * 4000 - 4000,
    lastTick: k * 700 - 2000,
  });
  const n = Math.ceil(SECONDS / 3);
  const hot = Array.from({ length: n }, (_, k) => ({
    time: k * 3,
    state: busy(k),
    ...(k === 2 ? { drop: { track: 1, fill: true } } : k === 5 ? { drop: { track: 2, fill: false } } : {}),
    ...(k === 8 ? { trackDrop: { held: busy(k - 1) } } : {}),
    // NFT cues: a sale per point, every rating and plate mask in turn; one withdraw.
    ...(CUES ? { sale: { pct: (k * 37) % 256, mask: (k % 15) + 1 } } : {}),
    ...(CUES && k === 4 ? { lock: { points: 40_856, ink: [24, 23, 24, 27] } } : {}),
  }));
  // Idle: the last swap was long ago; virtual time runs through the thinning and sparse stages, then a swap lands.
  const last = 1_800_000_000;
  const idle = Array.from({ length: n }, (_, k) => {
    const fresh = k >= n - 3;
    return { time: k * 3, now: last + (fresh ? 0 : 9 * 60 + k * 240), state: { ...busy(k), lastTs: fresh ? last + 1 : last } };
  });
  return { busy: hot, idle };
}

/** sha256 of the engine's log for one genre/style/epoch/timeline, and the log itself. */
function trace(synth: Synth, engine: Engine, genre: string, epoch: number, points: any[], pack?: string) {
  const { ctx, log } = recordingContext();
  const era = synth.eraById(genre as any);
  const program = pack ? synth.programFromPack(synth.PACKS[pack]) : undefined;
  const voice = new engine.VoiceEngine(ctx, era.index, epoch, program);
  for (const hit of synth.planSteps(points, SECONDS, genre, 8, program)) if (hit.time < SECONDS) voice.trigger(hit);
  return { hash: createHash("sha256").update(log.join("\n")).digest("hex"), log };
}

/** Every house (genre, style, epoch) case: the first EPOCHS epochs in the house program that play the style. */
function cases(synth: Synth) {
  const out: { genre: string; style: string; epoch: number; pack?: string }[] = [];
  // A pack's styles: the first EPOCHS epochs of its program that play each.
  for (const key of PACKS) {
    const pack = synth.PACKS[key];
    if (!pack) throw new Error(`no baked pack ${key}`);
    const program = synth.programFromPack(pack);
    for (const [genre, styles] of Object.entries(pack.styles)) {
      if (ONLY && genre !== ONLY) continue;
      const era = synth.eraById(genre as any);
      for (const style of styles as { id: string }[]) {
        let found = 0;
        for (let e = 0; e < 200_000 && found < EPOCHS; e++) {
          if (synth.eraOf(e, program).id === genre && synth.styleOf(era, e, program).style.id === style.id) {
            out.push({ genre, style: style.id, epoch: e, pack: key });
            found++;
          }
        }
      }
    }
  }
  if (PACKS.length) return out;
  for (const era of synth.ERAS) {
    if (ONLY && era.id !== ONLY) continue;
    for (const style of synth.GENRE_STYLES[era.id]) {
      let found = 0;
      for (let e = 0; e < 200_000 && found < EPOCHS; e++) {
        if (synth.eraOf(e).id === era.id && synth.styleOf(era, e).style.id === style.id) {
          out.push({ genre: era.id, style: style.id, epoch: e });
          found++;
        }
      }
    }
  }
  return out;
}

async function load(src: string): Promise<{ synth: Synth; engine: Engine }> {
  const synth = (await import(pathToFileURL(join(src, "index.ts")).href)) as Synth;
  const engine = (await import(pathToFileURL(join(src, "engine.ts")).href)) as Engine;
  return { synth, engine };
}

const local = await load(resolve(repo, "packages/synth/src"));
const list = cases(local.synth);

if (!REF) {
  const out: Record<string, string> = {};
  for (const c of list) {
    const tl = timelines(local.synth, c.epoch);
    for (const [name, points] of Object.entries(tl)) out[`${c.genre}/${c.style}/e${c.epoch}/${name}`] = trace(local.synth, local.engine, c.genre, c.epoch, points, c.pack).hash;
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "engine-trace-"));
try {
  execFileSync("sh", ["-c", `git archive ${JSON.stringify(REF)} packages/synth/src | tar -x -C ${JSON.stringify(dir)}`], { cwd: repo });
  const other = await load(join(dir, "packages/synth/src"));
  let same = 0;
  const diffs: string[] = [];
  let lines = 0;
  for (const c of list) {
    for (const name of ["busy", "idle"] as const) {
      const a = trace(local.synth, local.engine, c.genre, c.epoch, timelines(local.synth, c.epoch)[name], c.pack);
      const b = trace(other.synth, other.engine, c.genre, c.epoch, timelines(other.synth, c.epoch)[name], c.pack);
      lines += a.log.length;
      const label = `${c.genre}/${c.style}/e${c.epoch}/${name}`;
      if (a.hash === b.hash) {
        same++;
        continue;
      }
      const at = a.log.findIndex((line, i) => line !== b.log[i]);
      diffs.push(`${label}: ${a.log.length} vs ${b.log.length} lines, first difference at line ${at}`);
      if (VERBOSE) diffs.push(`    here: ${a.log[at]}\n    ${REF}: ${b.log[at]}`);
    }
  }
  const styles = new Set(list.map((c) => `${c.genre}/${c.style}`)).size;
  console.log(`engine trace vs ${REF}${CUES ? " (with NFT cues)" : ""}: ${styles} ${PACKS.length ? `styles of ${PACKS.join(", ")}` : "house styles"} x ${EPOCHS} epochs x 2 timelines x ${SECONDS} s = ${same + diffs.length} cases, ${lines} log lines`);
  if (diffs.length) {
    console.log(`DIFFERENT: ${diffs.length} case(s)\n${diffs.join("\n")}`);
    process.exitCode = 1;
  } else console.log(`IDENTICAL: all ${same} cases schedule exactly the same nodes, connections, parameter writes and buffers`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
