// bot/release: render a finished v2 track as a release (SPEC §4.6, web/RENDER.md "Release"): the track's whole
// history from its timeline, one swap per bar by default, WAV + metadata JSON (+ optional square mp4).
//   tsx src/release/index.ts [--timeline web/public/release-test.timeline.json] [--meta tape.meta.json]
//     [--track N (default: latest completed)] [--out sim/release] [--pace 1] [--max-seconds 360] [--min-seconds 180]
//     [--mp4] [--fps 30] [--size 1080] [--web-dir web/dist]
// The page is web/render.html: from a built web (--web-dir / RENDER_WEB_DIR) or, in a checkout, a Vite dev server.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { selectTrack, wavLevels, type TrackEntry, type WavLevels } from "../lib/release.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
const TAPE_PATH = "/__release/timeline.json";
const log = (...a: unknown[]) => console.error("[release]", ...a);

export interface ReleaseOpts {
  timeline: TrackEntry[];
  /** Packed state before the tape's first entry (timeline.meta.json `initial`). */
  initial?: { slot0: string; slot1: string } | null;
  track?: number | null;
  outDir: string;
  swapsPerBar?: number;
  maxSeconds?: number;
  minSeconds?: number;
  mp4?: boolean;
  fps?: number;
  size?: number;
  webDir?: string;
}

export interface ReleaseResult {
  trackNo: number;
  wav: string;
  mp4: string | null;
  meta: string;
  seconds: number;
  levels: WavLevels;
  summary: Record<string, unknown>;
}

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff",
};

/** A built web/ (vite build) on loopback, plus the tape. */
async function serveStatic(dir: string, tape: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    if (path === TAPE_PATH) {
      res.writeHead(200, { "content-type": "application/json" }).end(tape);
      return;
    }
    const file = join(dir, path === "/" ? "render.html" : path);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(() => r())) };
}

/** Checkout fallback: web/ through Vite's dev server (same as web/scripts/*.mjs). */
async function serveDev(tape: string): Promise<{ base: string; close: () => Promise<void> }> {
  const vite = await import("vite");
  const allow = [REPO];
  const nm = join(REPO, "node_modules");
  if (existsSync(nm)) allow.push(realpathSync(nm));
  const server = await vite.createServer({
    configFile: join(REPO, "web/vite.config.ts"),
    root: join(REPO, "web"),
    logLevel: "error",
    // No HMR or watching: an edit in the checkout must not reload the page mid-render.
    server: { port: 0, host: "127.0.0.1", fs: { allow }, hmr: false, watch: null },
    plugins: [
      {
        name: "release-tape",
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (req.url?.split("?")[0] !== TAPE_PATH) return next();
            res.setHeader("content-type", "application/json");
            res.end(tape);
          });
        },
      },
    ],
  });
  await server.listen();
  const addr = server.httpServer!.address() as AddressInfo;
  return { base: `http://127.0.0.1:${addr.port}`, close: () => server.close() };
}

/**
 * The checkout the bot renders from: `git rev-parse HEAD`, and whether packages/synth or web had uncommitted changes.
 * Null outside a git checkout. A published release is archived as WAV + metadata; re-rendering the same track with a
 * newer synth may sound different, so the metadata names the code that made it.
 */
export function gitStamp(cwd = REPO): { commit: string; dirty: boolean } | null {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const status = execFileSync("git", ["status", "--porcelain", "--", "packages/synth", "web"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { commit, dirty: status.trim().length > 0 };
  } catch {
    return null;
  }
}

function ffmpeg(args: string[]) {
  const p = spawn(process.env.FFMPEG ?? "ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  p.stderr!.on("data", (d) => (err = (err + d).slice(-4000)));
  const done = new Promise<void>((res, rej) => p.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}: ${err}`)))));
  return { p, done };
}

export async function renderRelease(o: ReleaseOpts): Promise<ReleaseResult> {
  const sel = selectTrack(o.timeline, o.track);
  log(`track #${sel.trackNo}: entries ${sel.start}..${sel.end} (${sel.end - sel.start + 1} swaps)${sel.complete ? "" : " unfinished"}`);
  mkdirSync(o.outDir, { recursive: true });
  const tape = JSON.stringify(o.timeline);
  const webDir = o.webDir ?? process.env.RENDER_WEB_DIR;
  const srv = webDir ? await serveStatic(resolve(webDir), tape) : await serveDev(tape);
  const size = o.size ?? 1080;
  const fps = o.fps ?? 30;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && log("page:", m.text()));
    page.on("pageerror", (e) => log("pageerror:", e.message));
    await page.goto(`${srv.base}/render.html?timeline=${encodeURIComponent(TAPE_PATH)}&release=1&track=${sel.trackNo}`);
    await page.waitForFunction(() => (window as any).__ready === true || (window as any).__error, null, { timeout: 120_000 });
    const err = await page.evaluate(() => (window as any).__error as string | undefined);
    if (err) throw new Error(`render.html: ${err}`);
    if (!(await page.evaluate(() => typeof (window as any).__renderRelease === "function"))) {
      throw new Error("render.html has no __renderRelease (rebuild web/ or drop --web-dir)");
    }
    const req = { track: sel.trackNo, swapsPerBar: o.swapsPerBar, maxSeconds: o.maxSeconds, minSeconds: o.minSeconds, initial: o.initial ?? null };
    const t0 = Date.now();
    const res = await page.evaluate((r) => (window as any).__renderRelease(r), req);
    const wavBuf = Buffer.from(res.wav as string, "base64");
    const wav = join(o.outDir, `${sel.trackNo}.wav`);
    writeFileSync(wav, wavBuf);
    const levels = wavLevels(wavBuf);
    log(`audio ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${wav} (${levels.seconds.toFixed(2)}s, peak ${levels.peakDb.toFixed(2)}, loudest-3s ${levels.loudest3sDb.toFixed(2)} dBFS)`);

    let mp4: string | null = null;
    if (o.mp4) {
      mp4 = join(o.outDir, `${sel.trackNo}.mp4`);
      const frames = Math.round(fps * (res.seconds as number));
      const ff = ffmpeg([
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
        "-i", wav,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
        mp4,
      ]);
      const t1 = Date.now();
      for (let f = 0; f < frames; f++) {
        const url: string = await page.evaluate(([n, k]) => (window as any).__releaseFrame(n, k), [f, fps] as const);
        const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
        if (!ff.p.stdin!.write(buf)) await new Promise((r) => ff.p.stdin!.once("drain", r));
        if (f % (fps * 10) === 0) process.stderr.write(`\r[release] frame ${f}/${frames}   `);
      }
      ff.p.stdin!.end();
      await ff.done;
      process.stderr.write("\n");
      log(`${mp4} in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    }
    const meta = join(o.outDir, `${sel.trackNo}.json`);
    const summary = res.summary as Record<string, unknown>;
    // summary.synth comes from the page (synth version + the commit the web build embedded); add the bot's checkout.
    const synth = { ...(summary.synth as Record<string, unknown> | undefined), bot: gitStamp() };
    const out = {
      ...summary,
      synth,
      pace: { requested: o.swapsPerBar ?? 1, maxSeconds: o.maxSeconds ?? 360, minSeconds: o.minSeconds ?? 180 },
      levels,
      files: { wav, mp4 },
    };
    writeFileSync(meta, JSON.stringify(out, null, 2) + "\n");
    await ctx.close();
    return { trackNo: sel.trackNo, wav, mp4, meta, seconds: res.seconds, levels, summary };
  } finally {
    await browser.close();
    await srv.close();
  }
}

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const numArg = (name: string) => {
  const v = arg(name);
  return v == null ? undefined : Number(v);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const tl = resolve(arg("timeline", join(REPO, "web/public/release-test.timeline.json"))!);
  if (!existsSync(tl)) throw new Error(`timeline not found: ${tl}`);
  const metaPath = arg("meta") ?? tl.replace(/\.json$/, ".meta.json");
  const initial = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")).initial ?? null) : null;
  const res = await renderRelease({
    timeline: JSON.parse(readFileSync(tl, "utf8")),
    initial: initial ? { slot0: initial.slot0, slot1: initial.slot1 } : null,
    track: numArg("track") ?? null,
    outDir: resolve(arg("out", join(REPO, "sim/release"))!),
    swapsPerBar: numArg("pace"),
    maxSeconds: numArg("max-seconds"),
    minSeconds: numArg("min-seconds"),
    mp4: process.argv.includes("--mp4"),
    fps: numArg("fps"),
    size: numArg("size"),
    webDir: arg("web-dir"),
  });
  const { summary: _s, ...brief } = res;
  console.log(JSON.stringify(brief, null, 2));
}
