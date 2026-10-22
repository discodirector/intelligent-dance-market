#!/usr/bin/env node
// Builds the rotation loop of every Station+ station that has none yet (docs/STATIONS.md "Station+"), on the stream
// host, next to the stream service: systemd timer idm-stream-loops (deploy/), every 15 minutes, one station per run,
// at low CPU priority so the live audio keeps the CPU. The stream (stream.mjs --stations auto) skips a station until
// its loop exists and picks it up at its next station change.
//
//   node build-loops.mjs --loops /opt/idm-stream/loops --registry /opt/idm-stream/registry.json \
//        --builder /opt/idm-stream/loopbuild --data-dir /opt/swarm-sequencer/out/stations-data \
//        --events /opt/swarm-sequencer/out/stream/loops.json [--only <key>] [--dry-run]
//
// Per station: the wall frames in its theme and ticker (wall/render.cjs, STATION=<key>, the registry merged with the
// runtime stations), its NOW PLAYING plate (PLATE=1), then build.py station <key> over work/base-1080p24.mkv; the loop
// is checked (1056 frames) and renamed into --loops, the frames deleted. Every outcome goes to --events (the bot's
// OUT_DIR/stream/loops.json, read by the stations worker, which tells the owner on Telegram) once per new outcome; a
// failure is retried after 1 h, 2 h, 4 h ... (at most a day), state in <builder>/state.json.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mergedStations } from "./rotation.mjs";

const { values: a } = parseArgs({
  options: {
    loops: { type: "string" },
    registry: { type: "string" },
    builder: { type: "string" },
    "data-dir": { type: "string" },
    "data-origin": { type: "string", default: "https://theidm.fun" },
    events: { type: "string" },
    only: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    playwright: { type: "string", default: process.env.PLAYWRIGHT_DIR || join(dirname(new URL(import.meta.url).pathname), "node_modules", "playwright") },
    python: { type: "string", default: process.env.PYTHON || "python3" },
    scale: { type: "string", default: "1.5" },
  },
});
const log = (...m) => console.log(new Date().toISOString(), ...m);
const die = (m) => { console.error(m); process.exit(2); };
const loops = resolve(a.loops ?? die("--loops <dir> required"));
const builder = resolve(a.builder ?? die("--builder <dir with build.py, clean.py, wall/, work/> required"));
const registry = JSON.parse(readFileSync(resolve(a.registry ?? die("--registry <stations/registry.json> required")), "utf8"));
const FRAMES = 1056;
const H = 3_600_000;

const writeJson = (path, v) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(v, null, 2));
  renameSync(`${path}.tmp`, path);
};
const readJson = (path, def) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return def; } };

async function stationsData(name) {
  try {
    if (a["data-dir"]) return JSON.parse(readFileSync(join(a["data-dir"], name), "utf8"));
    const r = await fetch(`${a["data-origin"]}/stations-data/${name}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Runs a command; resolves with its output tail, rejects with it. */
function run(cmd, args, env = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (d) => { tail = (tail + d).slice(-1500); };
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);
    p.on("error", (e) => rej(new Error(`${cmd}: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? res(tail) : rej(new Error(`${cmd} ${args[0] ?? ""} exited ${code}: ${tail.trim().split("\n").slice(-3).join(" | ")}`))));
  });
}

/** Frames of a video (counted packets: fast, exact for these all-intra-GOP H.264 loops). */
async function frameCount(file) {
  const out = await run("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file]);
  return Number(out.trim().split("\n").pop());
}

/** Everything a build needs that is not in git (copied once from the dev machine, sim/stream/README.md). */
function missing() {
  return [
    join(builder, "work", "base-1080p24.mkv"), join(builder, "work", "quads.json"),
    join(builder, "build.py"), join(builder, "clean.py"), join(builder, "wall", "render.cjs"), join(builder, "wall", "wall.html"),
    join(a.playwright, "package.json"),
  ].filter((p) => !existsSync(p));
}

async function build(key, merged) {
  const wall = join(builder, "work", `wall-${key}`);
  const outDir = join(builder, "out");
  const env = { STATION: key, REGISTRY: merged, PLAYWRIGHT_DIR: a.playwright, QUADS: join(builder, "work", "quads.json") };
  rmSync(wall, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  try {
    log(`[${key}] wall frames…`);
    await run(process.execPath, [join(builder, "wall", "render.cjs"), wall, a.scale], env);
    log(`[${key}] plate…`);
    await run(process.execPath, [join(builder, "wall", "render.cjs"), wall], { ...env, PLATE: "1" });
    log(`[${key}] build.py station…`);
    await run(a.python, [join(builder, "build.py"), "station", key], { STREAM_OUT: outDir, LOOP_720: "0" });
    const built = join(outDir, `loop-${key}-1080p24.mp4`);
    const n = await frameCount(built);
    if (n !== FRAMES) throw new Error(`the loop has ${n} frames, not ${FRAMES}`);
    mkdirSync(loops, { recursive: true });
    // Same filesystem: the stream sees no file, then the whole loop.
    const dst = join(loops, `loop-${key}-1080p24.mp4`);
    renameSync(built, dst);
    return dst;
  } finally {
    rmSync(wall, { recursive: true, force: true });
  }
}

const statePath = join(builder, "state.json");
const state = readJson(statePath, {});
const events = a.events ? readJson(a.events, {}) : null;
/** One event per new outcome: a retry that fails the same way tells nobody again. */
function event(key, e) {
  if (!events) return;
  const prev = events[key];
  if (e.state === "failed" && prev?.state === "failed" && prev.error === e.error) return;
  events[key] = { ...e, at: new Date().toISOString() };
  writeJson(a.events, events);
}

const status = await stationsData("status.json");
if (!status) die("status.json unreadable: nothing to decide (retry on the next run)");
const stations = mergedStations(registry, await stationsData("stations.json"));
const plus = stations.filter((s) => !s.house && status[s.key]?.plus === true && status[s.key]?.status === "live" && (!a.only || s.key === a.only));
const todo = plus.filter((s) => !existsSync(join(loops, `loop-${s.key}-1080p24.mp4`)));
log(`station+: ${plus.map((s) => s.key).join(", ") || "none"}; without a loop: ${todo.map((s) => s.key).join(", ") || "none"}`);
const now = Date.now();
const next = todo.find((s) => !(state[s.key]?.retryAt > now));
if (!next) process.exit(0);
if (a["dry-run"]) {
  log(`[${next.key}] would build (dry run)`);
  process.exit(0);
}
const gaps = missing();
if (gaps.length) {
  const error = `the loop builder is missing ${gaps.join(", ")} (sim/stream/README.md "Station+ loops")`;
  log(error);
  for (const s of todo) event(s.key, { state: "failed", error });
  process.exit(1);
}
const merged = join(builder, "work", "registry-merged.json");
writeJson(merged, { ...registry, stations });
try {
  const dst = await build(next.key, merged);
  delete state[next.key];
  writeJson(statePath, state);
  event(next.key, { state: "built", file: dst });
  log(`[${next.key}] built -> ${dst}`);
} catch (e) {
  const failures = (state[next.key]?.failures ?? 0) + 1;
  state[next.key] = { failures, retryAt: now + Math.min(24 * H, H * 2 ** (failures - 1)), error: e.message.slice(0, 500) };
  writeJson(statePath, state);
  event(next.key, { state: "failed", error: e.message.slice(0, 300) });
  log(`[${next.key}] failed (${failures} in a row, next try ${new Date(state[next.key].retryAt).toISOString()}):`, e.message);
  process.exit(1);
}
