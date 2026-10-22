#!/usr/bin/env node
// IDM radio: one station's loop video + its live synth audio -> one FLV/RTMP output, rotating through stations.
//
//   node stream.mjs --dist ../../../site/dist --loops ../out --registry ../../../stations/registry.json \
//        --stations idm:30,imd-eth:30 --out test.flv [--seconds 300]
//   STREAM_URL_FILE=/etc/idm-stream/url node stream.mjs ...                     # production: RTMP URL from a file
//   --stations auto [--plus-minutes 8] [--data-dir <stations-data>]             # house + Station+ (rotation.mjs)
//
// Audio: each station is site/stream.html?net=<key> in headless Chromium; an AudioWorklet tap sends s16le PCM here.
// A real-time mixer writes exactly what the clock asks for to ffmpeg: queued audio, silence for gaps (page reload,
// slow tab), and a 2 s crossfade when the station changes. The next station's page starts a minute early so its
// history is loaded before it goes on air.
// Video: every station has its own pre-rendered loop (sim/stream/build.py station <key>) with the same frames, the
// same GOP layout (IDR every 48 frames, no B-frames) and an AUD per frame. A feeder ffmpeg per loop demuxes it to
// raw H.264 (faster than real time, back-pressured); this process forwards whole frames into a FIFO on its own
// clock (frame n at t0 + n/24), and the main ffmpeg stamps them by frame count. A station change switches feeders
// on a keyframe and the next loop starts at that same loop frame: Pepe keeps moving, only the screens' colours and
// the NOW PLAYING plate change. The RTMP URL holds the stream key: it is never printed or logged.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { autoRotation, mergedStations } from "./rotation.mjs";

const { values: a } = parseArgs({
  options: {
    dist: { type: "string" },
    loops: { type: "string" },
    registry: { type: "string" },
    stations: { type: "string", default: "idm:30" }, // key:minutes,... or "auto" (house + Station+, rotation.mjs)
    "default-minutes": { type: "string", default: "20" },
    // --stations auto: each Station+ station this long per cycle, the house stations share the rest of the hour
    "plus-minutes": { type: "string", default: "8" },
    "hour-minutes": { type: "string", default: "60" },
    "house-min-minutes": { type: "string", default: "5" },
    "data-origin": { type: "string", default: "https://theidm.fun" }, // /stations-data (checkpoints, status)
    // read status.json and stations.json from this directory instead (the bot's stations-data on the same host)
    "data-dir": { type: "string" },
    out: { type: "string" },
    gain: { type: "string", default: "0.75" },
    // the site plays at about -22.5 LUFS; YouTube never turns a stream up: +7 dB, limiter + soft clip
    // -> about -16 LUFS with true peaks under -1 dBFS after AAC
    boost: { type: "string", default: "7" },
    seconds: { type: "string" },
    "audio-bitrate": { type: "string", default: "160k" },
    port: { type: "string", default: "4190" },
    playwright: { type: "string", default: process.env.PLAYWRIGHT_DIR || "playwright" },
    chrome: { type: "string", default: process.env.CHROME || "" },
  },
});
const log = (...m) => console.log(new Date().toISOString(), ...m);
const die = (m) => { console.error(m); process.exit(2); };

const dist = resolve(a.dist ?? die("--dist <site/dist> required"));
const loopsDir = resolve(a.loops ?? die("--loops <dir with loop-<key>-1080p24.mp4> required"));
const registry = JSON.parse(readFileSync(resolve(a.registry ?? die("--registry <stations/registry.json> required")), "utf8"));
if (!existsSync(join(dist, "stream.html"))) die(`${dist}/stream.html missing: npm run build -w site`);
let out = a.out;
if (!out && process.env.STREAM_URL_FILE) out = readFileSync(process.env.STREAM_URL_FILE, "utf8").trim();
if (!out && process.env.STREAM_URL) out = process.env.STREAM_URL;
if (!out) die("--out <file.flv> or STREAM_URL_FILE / STREAM_URL required");
const isRtmp = /^rtmps?:\/\//.test(out);
const outLabel = isRtmp ? out.replace(/^(rtmps?:\/\/[^/]+\/).*/, "$1***") : out;

const FPS = 24, LOOP_FRAMES = 1056, GOP = 48;
const loopOf = (key) => join(loopsDir, `loop-${key}-1080p24.mp4`);
const netOf = (st) => (st.kind === "hook" ? "robinhood" : st.key); // the site's ?net= for this station
let closing = false;

// ---- rotation ------------------------------------------------------------------------------------------------
/** A stations-data file (status.json, stations.json): from --data-dir, else from --data-origin; null when unreadable. */
async function stationsData(name) {
  try {
    if (a["data-dir"]) return JSON.parse(readFileSync(join(a["data-dir"], name), "utf8"));
    const r = await fetch(`${a["data-origin"]}/stations-data/${name}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function rotation() {
  // The baked registry plus the pipeline's runtime stations (a Station+ station may be one of them).
  const stations = mergedStations(registry, await stationsData("stations.json"));
  const byKey = new Map(stations.map((s) => [s.key, s]));
  let list;
  if (a.stations === "auto") {
    list = autoRotation({
      stations, status: await stationsData("status.json"),
      plusMinutes: Number(a["plus-minutes"]), hourMinutes: Number(a["hour-minutes"]), houseMinMinutes: Number(a["house-min-minutes"]),
    });
  } else {
    list = a.stations.split(",").map((part) => {
      const [key, min] = part.split(":");
      const st = byKey.get(key);
      if (!st) die(`station ${key} is not in the registry`);
      return { st, minutes: Number(min || a["default-minutes"]) };
    });
  }
  list = list.filter(({ st }) => existsSync(loopOf(st.key)) || (log(`skip ${st.key}: no ${loopOf(st.key)}`), false));
  if (!list.length) die("no station with a loop to play");
  return list;
}

// ---- static server: site/dist, /stations-data proxied to the live site (checkpoints, status) -------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wav": "audio/wav" };
const port = Number(a.port);
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.startsWith("/stations-data/")) {
    try {
      const r = await fetch(a["data-origin"] + p, { signal: AbortSignal.timeout(15000) });
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
    return;
  }
  const f = resolve(join(dist, p === "/" ? "stream.html" : p));
  if (!f.startsWith(dist) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));

// ---- audio sources: one headless page per station ------------------------------------------------------------
const require = createRequire(import.meta.url);
const { chromium } = require(a.playwright);
const BYTES_PER_FRAME = 4; // s16le stereo
let rate = 0; // AudioContext rate (same machine, same rate for every page)

class Source {
  constructor(st) { this.st = st; this.queue = []; this.queued = 0; this.lastChunk = Date.now(); this.browser = null; this.page = null; this.restarting = false; this.dead = false; }
  push(b) { this.queue.push(b); this.queued += b.length; this.lastChunk = Date.now(); }
  /** Take n frames (zero-filled when short); returns [Buffer, frames missing]. */
  take(n) {
    const buf = Buffer.alloc(n * BYTES_PER_FRAME);
    let off = 0;
    while (off < buf.length && this.queue.length) {
      const b = this.queue[0], k = Math.min(b.length, buf.length - off);
      b.copy(buf, off, 0, k);
      off += k;
      if (k === b.length) this.queue.shift(); else this.queue[0] = b.subarray(k);
      this.queued -= k;
    }
    return [buf, (buf.length - off) / BYTES_PER_FRAME];
  }
  /** Keep at most `seconds` of queued audio (drop the oldest); returns frames dropped. */
  trim(seconds) {
    let dropped = 0;
    while (rate && this.queue.length && this.queued > seconds * rate * BYTES_PER_FRAME) { const b = this.queue.shift(); this.queued -= b.length; dropped += b.length / BYTES_PER_FRAME; }
    return dropped;
  }
  async launch() {
    this.restarting = true;
    const old = this.browser;
    this.browser = null;
    try { await old?.close(); } catch {}
    if (this.dead) return;
    const browser = await chromium.launch({
      ...(a.chrome ? { executablePath: a.chrome } : {}),
      args: [
        "--autoplay-policy=no-user-gesture-required", "--mute-audio",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
        "--disable-dev-shm-usage",
      ],
    });
    this.browser = browser;
    browser.on("disconnected", () => {
      if (closing || this.dead || this.restarting || this.browser !== browser) return;
      log(`[${this.st.key}] browser disconnected: relaunching`);
      this.launch().catch((e) => log(`[${this.st.key}] relaunch failed:`, e.message));
    });
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    this.page = page;
    page.on("console", (m) => { if (m.type() === "error") log(`[${this.st.key}] page:`, m.text().slice(0, 200)); });
    page.on("pageerror", (e) => log(`[${this.st.key}] page error:`, e.message));
    await page.exposeFunction("__tapChunk", (b64) => this.push(Buffer.from(b64, "base64")));
    const q = new URLSearchParams({ net: netOf(this.st), gain: a.gain });
    await page.goto(`http://127.0.0.1:${port}/stream.html?${q}`);
    for (let i = 0; i < 150; i++) {
      const info = await page.evaluate(() => window.__stream?.info()).catch(() => null);
      if (info?.rate && info.chunks > 0) { rate ||= info.rate; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!rate) throw new Error(`[${this.st.key}] page audio did not start`);
    this.lastChunk = Date.now();
    this.restarting = false;
    log(`[${this.st.key}] page up:`, JSON.stringify(await page.evaluate(() => window.__stream.info())));
  }
  async info() { return this.page?.evaluate(() => window.__stream?.info()).catch(() => null); }
  async close() { this.dead = true; try { await this.browser?.close(); } catch {} }
}

// ---- video: feeders (raw H.264 frames, buffered) and the frame clock --------------------------------------------
// 3-byte start code: the first AUD (after x264's SEI) has one, the 4-byte ones contain it
const AUD = Buffer.from([0, 0, 1, 9]);
const HIGH = 96, LOW = 48; // frames buffered per feeder

class Feeder {
  /** Loop `file` as raw H.264 from loop frame `startFrame` (a keyframe), split into whole frames. */
  constructor(key, startFrame) {
    this.key = key;
    this.startFrame = startFrame;
    this.frames = [];
    this.carry = null;
    this.ended = false;
    this.proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "fatal", "-ss", (startFrame / FPS).toFixed(6), "-stream_loop", "-1",
      "-i", loopOf(key), "-map", "0:v", "-c:v", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "h264", "pipe:1"], { stdio: ["ignore", "pipe", "inherit"] });
    this.proc.stdout.on("data", (d) => this.data(d));
    this.proc.on("exit", (code) => { this.ended = true; if (!this.killed && !closing) log(`[video ${key}] feeder exited (${code})`); });
  }
  data(d) {
    let buf = this.carry ? Buffer.concat([this.carry, d]) : d;
    let start = buf.indexOf(AUD);
    if (start < 0) { this.carry = this.carry ? buf : null; return; }
    for (;;) {
      const i = buf.indexOf(AUD, start + AUD.length);
      if (i < 0) break;
      this.frames.push(Buffer.from(buf.subarray(start, i)));
      start = i;
    }
    this.carry = Buffer.from(buf.subarray(start));
    if (this.frames.length > HIGH) this.proc.stdout.pause();
  }
  shift() {
    const f = this.frames.shift();
    if (this.frames.length < LOW) this.proc.stdout.resume();
    return f;
  }
  kill() { this.killed = true; try { this.proc.kill("SIGKILL"); } catch {} }
}

const fifo = join(tmpdir(), `idm-stream-${process.pid}.h264`);
spawnSync("mkfifo", [fifo]);
let fifoOut = null; // write stream into the FIFO, open once ffmpeg reads it
let framesOut = 0, t0v = 0, videoStalls = 0;
let feeder = null; // on air
let pendingVideo = null; // { feeder, at, onSwitch }

function pumpVideo() {
  if (!fifoOut?.ready || !feeder) return;
  if (fifoOut.writableLength > 4 << 20) return; // ffmpeg is not reading: do not pile up
  const LEAD = 6; // frames written ahead of the clock (keeps ffmpeg's input fed)
  const target = Math.floor(((performance.now() - t0v) / 1000) * FPS) + LEAD;
  while (framesOut < target) {
    if (pendingVideo && framesOut === pendingVideo.at) {
      if (!pendingVideo.feeder.frames.length) { videoStalls++; return; } // next loop not buffered yet: wait
      const old = feeder;
      feeder = pendingVideo.feeder;
      const cb = pendingVideo.onSwitch;
      pendingVideo = null;
      old.kill();
      cb?.();
    }
    if (!feeder.frames.length) {
      if (feeder.ended && !feeder.killed) { // feeder died: restart it on the next keyframe-aligned loop frame
        const at = framesOut + ((GOP - (framesOut % GOP)) % GOP);
        if (at !== framesOut) { videoStalls++; return; }
        log(`[video ${feeder.key}] restarting feeder at loop frame ${at % LOOP_FRAMES}`);
        feeder = new Feeder(feeder.key, at % LOOP_FRAMES);
      }
      videoStalls++;
      return;
    }
    fifoOut.write(feeder.shift());
    framesOut++;
  }
}
setInterval(pumpVideo, 8);

/** Plan the video switch to `key` on a keyframe at least `leadFrames` ahead; returns the output frame. */
function planVideo(key, leadFrames, onSwitch) {
  const at = Math.ceil((framesOut + leadFrames) / GOP) * GOP;
  pendingVideo?.feeder.kill();
  pendingVideo = { feeder: new Feeder(key, at % LOOP_FRAMES), at, onSwitch };
  return at;
}

// ---- main ffmpeg ---------------------------------------------------------------------------------------------
let ffmpeg = null, t0 = 0, written = 0, underrun = 0, droppedA = 0;
function startFfmpeg() {
  const args = [
    "-hide_banner", "-loglevel", "warning", "-nostats", "-y",
    // video: raw H.264 from the FIFO; input -r ignores the stream's own timestamps (they restart at a spliced
    // keyframe) and stamps frame n at n/24 s
    "-thread_queue_size", "1024", "-probesize", "1M", "-analyzeduration", "500000", "-f", "h264", "-r", String(FPS), "-i", fifo,
    "-thread_queue_size", "1024", "-f", "s16le", "-ar", String(rate), "-ac", "2", "-i", "pipe:0",
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy",
    "-af", `aresample=48000:async=1,volume=${a.boost}dB,alimiter=limit=0.71:attack=1:release=60:level=false,asoftclip=type=tanh:threshold=0.89`,
    "-c:a", "aac", "-b:a", a["audio-bitrate"], "-ar", "48000", "-ac", "2",
    "-flvflags", "no_duration_filesize",
    ...(a.seconds ? ["-t", a.seconds] : []),
    "-f", "flv", out,
  ];
  ffmpeg = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "pipe"] });
  ffmpeg.stderr.on("data", (d) => process.stderr.write(String(d).replace(/(rtmps?:\/\/[^/\s]+\/[^/\s]+\/)\S+/g, "$1***")));
  ffmpeg.stdin.on("error", () => {});
  ffmpeg.on("exit", (code) => { log(`ffmpeg exited (${code})`); shutdown(code ?? 1); });
  fifoOut = createWriteStream(fifo); // opens once ffmpeg opens the FIFO for reading
  fifoOut.on("error", (e) => { if (!closing) log("fifo:", e.message); });
  t0 = t0v = performance.now();
  fifoOut.on("open", () => { fifoOut.ready = true; t0v = performance.now() - (framesOut / FPS) * 1000; });
  log(`ffmpeg -> ${outLabel} · audio ${rate} Hz -> 48 kHz AAC ${a["audio-bitrate"]} · video copy (station loops)`);
}

// ---- the audio mixer: exactly real time, with a crossfade between stations -----------------------------------
let cur = null, next = null, fade = null; // fade: { from, to, done }
const FADE_S = 2;
setInterval(() => {
  if (!ffmpeg || !rate) return;
  const due = Math.floor(((performance.now() - t0) / 1000) * rate) - written;
  if (due <= 0) return;
  if (next && !fade) next.trim(0.25); // a waiting station keeps only its freshest 0.25 s
  if (fade) {
    const [aBuf] = fade.from.take(due), [bBuf, miss] = fade.to.take(due);
    underrun += miss;
    const A = new Int16Array(aBuf.buffer, aBuf.byteOffset, due * 2), B = new Int16Array(bBuf.buffer, bBuf.byteOffset, due * 2);
    const total = FADE_S * rate;
    for (let i = 0; i < due; i++) {
      const t = Math.min(1, (fade.done + i) / total), ga = Math.cos((t * Math.PI) / 2), gb = Math.sin((t * Math.PI) / 2);
      A[2 * i] = Math.round(A[2 * i] * ga + B[2 * i] * gb);
      A[2 * i + 1] = Math.round(A[2 * i + 1] * ga + B[2 * i + 1] * gb);
    }
    fade.done += due;
    ffmpeg.stdin.write(aBuf);
    if (fade.done >= total) { const old = fade.from; fade = null; void old.close(); }
  } else if (cur) {
    droppedA += cur.trim(0.5 + due / rate); // latency cap
    const [buf, miss] = cur.take(due);
    underrun += miss;
    ffmpeg.stdin.write(buf);
  } else ffmpeg.stdin.write(Buffer.alloc(due * BYTES_PER_FRAME));
  written += due;
}, 20);

// Watchdog: a station sent no audio for 10 s -> relaunch its page (the mixer plays silence meanwhile).
setInterval(() => {
  for (const s of [cur, next]) {
    if (!s || s.restarting || s.dead) continue;
    if (Date.now() - s.lastChunk > 10_000) { log(`[${s.st.key}] no audio for 10 s: relaunching`); s.launch().catch((e) => log(`[${s.st.key}] relaunch failed:`, e.message)); }
  }
}, 2_000);

// ---- schedule -------------------------------------------------------------------------------------------------
const PREFETCH_MS = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

async function run() {
  let list = await rotation();
  log("rotation:", list.map(({ st, minutes }) => `${st.key} ${minutes} min`).join(", "));
  let idx = 0;
  cur = new Source(list[0].st);
  await cur.launch();
  feeder = new Feeder(cur.st.key, 0);
  startFfmpeg();
  log(`on air: ${cur.st.key} ($${cur.st.ticker})`);
  let until = Date.now() + list[0].minutes * 60_000;
  // auto keeps re-reading (a Station+ station joins once its loop exists), even while one station plays
  if (list.length === 1 && a.stations !== "auto") return;
  for (;;) {
    await sleep(until - PREFETCH_MS - Date.now());
    if (closing) return;
    if (a.stations === "auto") {
      // the next station is the one after the station on air in the fresh cycle (stations come and go)
      const fresh = await rotation();
      const at = fresh.findIndex((x) => x.st.key === cur.st.key);
      list = fresh;
      if (at >= 0) idx = at;
    }
    idx = (idx + 1) % list.length;
    const { st, minutes } = list[idx];
    if (st.key === cur.st.key) { until = Date.now() + minutes * 60_000; continue; }
    const src = new Source(st);
    next = src;
    try { await src.launch(); } catch (e) { log(`[${st.key}] could not start, staying on ${cur.st.key}:`, e.message); await src.close(); next = null; until = Date.now() + 5 * 60_000; continue; }
    await sleep(until - Date.now());
    if (closing) return;
    // video cuts on the first keyframe at least 1 s ahead; the audio crossfade starts with it
    const at = planVideo(st.key, FPS, () => {
      fade = { from: cur, to: src, done: 0 };
      cur = src;
      if (next === src) next = null; // `next` may already be the station after this one (prefetching)
      log(`on air: ${st.key} ($${st.ticker}) · output frame ${framesOut} = loop frame ${framesOut % LOOP_FRAMES}`);
    });
    log(`switching to ${st.key} at output frame ${at}`);
    until = Date.now() + minutes * 60_000;
  }
}

// Status line every 60 s.
setInterval(async () => {
  const info = await cur?.info();
  log(`status ${cur?.st.key ?? "-"}: ${info ? `${info.status} · swaps ${info.swaps} · drops ${info.drops}` : "page n/a"} · next ${next?.st.key ?? "-"} · frames ${framesOut} (stalls ${videoStalls}) · queue ${((cur?.queued ?? 0) / BYTES_PER_FRAME / (rate || 1)).toFixed(2)} s · silence filled ${(underrun / (rate || 1)).toFixed(1)} s · dropped ${(droppedA / (rate || 1)).toFixed(1)} s · rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
}, 60_000);

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try { ffmpeg?.stdin.end(); } catch {}
  feeder?.kill();
  pendingVideo?.feeder.kill();
  await Promise.all([cur, next, fade?.from].filter(Boolean).map((s) => s.close()));
  server.close();
  try { unlinkSync(fifo); } catch {}
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run().catch((e) => { log("fatal:", e.message); shutdown(1); });
