// Station radio (docs/STATIONS.md "Listen page"): a station's sound as a plain MP3 stream for someone else's stream
// setup, e.g. Squeekchain's 24/7 cage stream (theidm.fun/radio/squeekchain.mp3, Caddy -> this service).
// Headless Chromium plays the site's listen page (site/src/listen.ts, ?tap=1) from the built site, the same feed and
// player every visitor hears; its output arrives as s16le PCM (site/src/tap.ts), ffmpeg encodes it to MP3, and every
// connected listener gets the same bytes from the moment they join. A page that stops sending is restarted.
// /<net>.mp3 the stream · /now (JSON) and /now.txt (one line, for a chat bot's !music) what plays · /health its state.
//
// Env: RADIO_NET (default squeekchain), RADIO_PORT (default 8788), RADIO_KBPS (default 128),
//      RENDER_SITE_DIR (the built site, as the render harness), STATIONS_DATA_DIR (default /data/stations-data;
//      the page reads /stations-data/* from it) or STATIONS_DATA_URL (dev: fetch them from the live site instead).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { chromium, type Browser } from "playwright";
import { SITE_DIST } from "../render/index.ts";

const NET = process.env.RADIO_NET || "squeekchain";
const PORT = Number(process.env.RADIO_PORT || 8788);
const KBPS = Number(process.env.RADIO_KBPS || 128);
const DATA_DIR = process.env.STATIONS_DATA_DIR || "/data/stations-data";
const DATA_URL = process.env.STATIONS_DATA_URL?.replace(/\/$/, "");
/** No PCM for this long: the page is restarted. */
const STALL_MS = 20_000;
/** A listener this far behind (bytes queued) is dropped rather than buffered without end. */
const MAX_QUEUED = 2 << 20;
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".gz": "application/octet-stream", ".bin": "application/octet-stream" };

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[radio]", ...a);

/** The built site and the station data on loopback, for the page only. */
async function servePage(): Promise<string> {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    if (path.startsWith("/stations-data/")) {
      if (DATA_URL) {
        const r = await fetch(DATA_URL + (req.url ?? "").replace(/^\/stations-data/, "")).catch(() => null);
        if (!r) return void res.writeHead(502).end();
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }).end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      const file = join(DATA_DIR, path.slice("/stations-data/".length));
      if (!file.startsWith(DATA_DIR) || !existsSync(file)) return void res.writeHead(404).end();
      return void res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }).end(readFileSync(file));
    }
    const file = join(SITE_DIST, path);
    if (!file.startsWith(SITE_DIST) || !existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const listeners = new Set<ServerResponse>();
function broadcast(chunk: Buffer) {
  for (const res of listeners) {
    if (res.writableLength > MAX_QUEUED) {
      listeners.delete(res);
      res.destroy();
      continue;
    }
    res.write(chunk);
  }
}

let lastPcm = 0;
let started = 0;
/** What the page plays now (site/src/listen.ts info()), read every few seconds; null until it plays. */
let now: { asleep: boolean; genre: string; style: string } | null = null;
let nowAt = 0;

/** One run of the page and the encoder; resolves when either dies or the page stalls. */
async function run(base: string) {
  let browser: Browser | null = null;
  let ff: ChildProcess | null = null;
  try {
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--no-sandbox"] });
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("pageerror:", e.message));
    let rateSeen = 0;
    const pending: Buffer[] = [];
    await page.exposeFunction("__tapChunk", (b64: string) => {
      lastPcm = Date.now();
      const pcm = Buffer.from(b64, "base64");
      if (ff?.stdin?.writable) ff.stdin.write(pcm);
      else pending.push(pcm);
    });
    await page.goto(`${base}/listen.html?net=${encodeURIComponent(NET)}&ui=0&tap=1&vol=1`, { waitUntil: "load" });
    // The page reports its context's rate once the tap runs: the encoder reads PCM at that rate.
    const deadline = Date.now() + 30_000;
    while (!rateSeen && Date.now() < deadline) {
      rateSeen = await page.evaluate(() => (window as unknown as { __listen?: { rate(): number } }).__listen?.rate() ?? 0);
      if (!rateSeen) await new Promise((r) => setTimeout(r, 500));
    }
    if (!rateSeen) throw new Error("the page never started playing");
    ff = spawn("ffmpeg", ["-loglevel", "error", "-f", "s16le", "-ar", String(rateSeen), "-ac", "2", "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", `${KBPS}k`, "-ar", "44100", "-f", "mp3", "pipe:1"], { stdio: ["pipe", "pipe", "inherit"] });
    ff.stdout!.on("data", broadcast);
    for (const p of pending.splice(0)) ff.stdin!.write(p);
    started = Date.now();
    log(`on air: ${NET} at ${rateSeen} Hz -> ${KBPS} kbps`);
    const exited = new Promise<void>((r) => ff!.once("exit", () => r()));
    while (true) {
      if (Date.now() - nowAt > 5000) {
        now = await page.evaluate(() => (window as unknown as { __listen?: { info(): { asleep: boolean; genre: string; style: string } | null } }).__listen?.info() ?? null).catch(() => now);
        nowAt = Date.now();
      }
      const stalled = Date.now() - lastPcm > STALL_MS;
      const done = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);
      if (done) throw new Error("the encoder exited");
      if (stalled) throw new Error(`no audio for ${STALL_MS / 1000} s`);
    }
  } finally {
    ff?.kill("SIGKILL");
    await browser?.close().catch(() => {});
  }
}

function serveListeners() {
  createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0].replace(/^\/radio/, "");
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ net: NET, listeners: listeners.size, onAirSince: started || null, lastAudioMs: lastPcm ? Date.now() - lastPcm : null }));
      return;
    }
    if (path === "/now" || path === "/now.txt") {
      const page = `theidm.fun/?net=${NET}`;
      const text = !now ? `${NET} radio is tuning in · ${page}` : now.asleep ? `the hamster is asleep, the station dreams: ${now.style} (${now.genre}) · ${page}` : `now playing: ${now.genre} · ${now.style} · ${page}`;
      const body = path === "/now" ? JSON.stringify({ net: NET, playing: !!now, asleep: now?.asleep ?? null, genre: now?.genre ?? null, style: now?.style ?? null, text, listen: `https://${page}`, stream: `https://theidm.fun/radio/${NET}.mp3` }) : text;
      res.writeHead(200, { "content-type": path === "/now" ? "application/json" : "text/plain; charset=utf-8", "cache-control": "no-cache", "access-control-allow-origin": "*" }).end(body);
      return;
    }
    if (path !== `/${NET}.mp3`) return void res.writeHead(404).end();
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "cache-control": "no-cache, no-store",
      "access-control-allow-origin": "*",
      "icy-name": `${NET} radio · theidm.fun`,
    });
    if (req.method === "HEAD") return void res.end();
    listeners.add(res);
    req.on("close", () => listeners.delete(res));
  }).listen(PORT, "0.0.0.0", () => log(`listening on :${PORT}, /${NET}.mp3`));
}

async function main() {
  if (!existsSync(join(SITE_DIST, "listen.html"))) throw new Error(`no listen.html in ${SITE_DIST}`);
  const base = await servePage();
  serveListeners();
  for (;;) {
    try {
      await run(base);
    } catch (e) {
      log("restart:", (e as Error).message);
    }
    started = 0;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((e) => {
  log("fatal:", (e as Error).stack ?? e);
  process.exit(1);
});
