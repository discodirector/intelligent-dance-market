// bot/render: Playwright + Chromium drives a render page frame by frame, captures frames + WAV, muxes mp4 with ffmpeg.
//   tsx src/render/index.ts --timeline out/timeline.json [--seconds 32] [--fps 30] [--sizes 1080x1080,1920x1080] [--out out/render]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import type { TimelineEntry } from "../lib/timeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const FALLBACK_PAGE = join(here, "page", "teaser.html");
/** Built site (npm -w site run build); its bot.html is the IDM-16 module page. */
export const SITE_DIST = resolve(process.env.RENDER_SITE_DIR ?? join(here, "../../../site/dist"));
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff",
};

/** Module scripts do not load from file://, so the built site is served on loopback for the render. */
async function serveDir(dir: string): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(dir, path === "/" ? "bot.html" : path);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const log = (...a: unknown[]) => console.error("[render]", ...a);

export interface RenderOpts {
  timeline: TimelineEntry[];
  outDir: string;
  seconds?: number;
  fps?: number;
  sizes?: [number, number][];
  title?: string;
  subtitle?: string;
  page?: string; // path or URL of a page implementing __setup/__frame/__audio; default site bot.html, else teaser
  /** A station clip (station.ts label): the module shows its name in the station's blue theme, as its releases do. */
  station?: string;
  /** The station's style pack as JSON: the clip plays its program (site bot.ts registers it), not the house's. */
  pack?: unknown;
  /** The station's LCD colours (registry theme: phos, phosDim, ghost, lcd); unset = the blue station theme. */
  theme?: StationTheme;
  /** A calibrated quote (CHOG/MON: MON, 111949 per ETH): the feed shows amounts in it, not their ETH value. */
  quote?: ShownQuote;
}

/** Registry theme; panel / sell / whale: a station's faceplate skin (Credits), worn by its releases (ReleaseOpts.skin). */
export interface StationTheme { phos: string; phosDim: string; ghost: string; lcd: string; panel?: string; sell?: string; whale?: string }
export interface ShownQuote { symbol: string; perEth: number }

export interface RenderResult {
  videos: { width: number; height: number; path: string }[];
  wav: string;
  seconds: number;
}

function ffmpeg(args: string[], stdin = false) {
  const p = spawn(process.env.FFMPEG ?? "ffmpeg", args, { stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr!.on("data", (d) => (err = (err + d).slice(-4000)));
  const done = new Promise<void>((res, rej) =>
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}: ${err}`)))),
  );
  return { p, done };
}

export async function render(opts: RenderOpts): Promise<RenderResult> {
  const seconds = Math.min(45, Math.max(20, opts.seconds ?? 32));
  const fps = opts.fps ?? 30;
  const sizes = opts.sizes ?? [[1080, 1080], [1920, 1080]];
  mkdirSync(opts.outDir, { recursive: true });
  let site: { server: Server; base: string } | null = null;
  let page = opts.page;
  if (!page && existsSync(join(SITE_DIST, "bot.html"))) {
    site = await serveDir(SITE_DIST);
    page = `${site.base}/bot.html`;
  }
  page ??= FALLBACK_PAGE;
  log(`page ${page}`);

  const browser: Browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--no-sandbox"],
  });
  const result: RenderResult = { videos: [], wav: join(opts.outDir, "audio.wav"), seconds };
  try {
    for (const [i, [width, height]] of sizes.entries()) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const pg = await ctx.newPage();
      pg.on("console", (m) => m.type() === "error" && log("page:", m.text()));
      pg.on("pageerror", (e) => log("pageerror:", e.message));
      await pg.goto(/^https?:/.test(page) ? page : pathToFileURL(page).href, { waitUntil: "load" });
      await pg.waitForFunction(() => typeof (window as any).__setup === "function");
      const info = await pg.evaluate(
        (o) => (window as any).__setup(o),
        { timeline: opts.timeline, width, height, fps, seconds, title: opts.title, subtitle: opts.subtitle, station: opts.station, pack: opts.pack, theme: opts.theme, quote: opts.quote },
      );
      log(`${width}x${height}: ${info.frames} frames, ${info.steps} steps, ${info.swaps} swaps`);

      if (i === 0) {
        const t0 = Date.now();
        const b64: string = await pg.evaluate(() => (window as any).__audio());
        writeFileSync(result.wav, Buffer.from(b64, "base64"));
        log(`audio ${(Date.now() - t0) / 1000}s -> ${result.wav}`);
      }

      const outPath = join(opts.outDir, `video_${width}x${height}.mp4`);
      const ff = ffmpeg(
        [
          "-y", "-loglevel", "error",
          "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
          "-i", result.wav,
          "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
          "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
          outPath,
        ],
        true,
      );
      const t0 = Date.now();
      for (let f = 0; f < info.frames; f++) {
        const url: string | null = await pg.evaluate((n) => (window as any).__frame(n), f);
        // A page that returns null paints the DOM; the frame is a viewport screenshot.
        const buf = url
          ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64")
          : await pg.screenshot({ type: "jpeg", quality: 90 });
        if (!ff.p.stdin!.write(buf)) await new Promise((r) => ff.p.stdin!.once("drain", r));
        if (f % (fps * 5) === 0) process.stderr.write(`\r[render] ${width}x${height} frame ${f}/${info.frames}   `);
      }
      ff.p.stdin!.end();
      await ff.done;
      process.stderr.write("\n");
      log(`${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      result.videos.push({ width, height, path: outPath });
      await ctx.close();
    }
  } finally {
    await browser.close();
    site?.server.close();
  }
  return result;
}

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tl = resolve(arg("timeline", "out/timeline.json")!);
  if (!existsSync(tl)) throw new Error(`timeline not found: ${tl} (run replay first)`);
  const res = await render({
    timeline: JSON.parse(readFileSync(tl, "utf8")),
    outDir: resolve(arg("out", "out/render")!),
    seconds: Number(arg("seconds", "32")),
    fps: Number(arg("fps", "30")),
    sizes: arg("sizes", "1080x1080,1920x1080")!.split(",").map((s) => s.split("x").map(Number) as [number, number]),
    title: arg("title"),
    subtitle: arg("subtitle"),
    page: arg("page"),
  });
  console.log(JSON.stringify(res, null, 2));
}
