// timeline entries -> render -> caption -> publish (queue or X)
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./render/index.ts";
import { caption } from "./caption/index.ts";
import { publish } from "./post/index.ts";
import { factsFromTimeline, type Facts } from "./lib/facts.ts";
import { toTimelineState, type TimelineEntry } from "./lib/timeline.ts";
import { decodeFor } from "./lib/hookRules.ts";
import { replay } from "./replay/index.ts";
import { renderRelease } from "./release/index.ts";
import { postCut, releaseHeadline, selectTrack, X_VIDEO_MAX_SECONDS } from "./lib/release.ts";

const log = (...a: unknown[]) => console.error("[pipeline]", ...a);

export async function producePost(
  entries: TimelineEntry[],
  o: { kind: Facts["kind"]; chain: string; pool: string; title: string; subtitle: string; seconds?: number; hook?: string; startPage?: number },
) {
  const work = mkdtempSync(join(tmpdir(), "seq-render-"));
  try {
    const seconds = o.seconds ?? Number(process.env.VIDEO_SECONDS ?? 32);
    const r = await render({ timeline: entries, outDir: work, seconds, title: o.title, subtitle: o.subtitle });
    const facts = factsFromTimeline(entries, { kind: o.kind, chain: o.chain, pool: o.pool, videoSeconds: r.seconds, hook: o.hook, startPage: o.startPage });
    const cap = await caption(facts);
    if (cap.errors?.length) log("caption fell back to template:", cap.errors.join("; "));
    const square = r.videos.find((v) => v.width === v.height) ?? r.videos[0];
    const res = await publish({
      caption: cap.text,
      captionSource: cap.source,
      facts,
      video: square.path,
      extraVideos: r.videos.filter((v) => v !== square).map((v) => v.path),
    });
    log(`${res.mode}: ${res.dir}`);
    return res;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function ffmpegCut(src: string, dst: string, start: number, seconds: number) {
  return new Promise<void>((res, rej) => {
    // Re-encoded so the cut starts on a frame; a short audio fade-in where the clip starts mid-bar.
    const p = spawn(process.env.FFMPEG ?? "ffmpeg", [
      "-y", "-loglevel", "error", "-ss", String(start), "-t", String(seconds), "-i", src,
      "-af", "afade=t=in:d=0.4", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dst,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr!.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg cut exited ${code}: ${err}`))));
  });
}

/**
 * v2 track complete: render the release of the track (SPEC §4.6, whole track at one swap per bar, WAV + 1080x1080
 * mp4) and queue a post with it. If the release is longer than X allows, the post video is the climb into the drop
 * (postCut) and the full mp4 + WAV + release metadata go to the queue as artifacts.
 */
export async function produceRelease(
  entries: TimelineEntry[],
  o: { chain: string; pool: string; hook?: string; track?: number | null; partial?: boolean; initial?: { slot0: string; slot1: string } | null; maxPostSeconds?: number },
) {
  const work = mkdtempSync(join(tmpdir(), "seq-release-"));
  try {
    const sel = selectTrack(entries, o.track);
    const r = await renderRelease({ timeline: entries, track: sel.trackNo, initial: o.initial, outDir: work, mp4: true });
    const sum = r.summary as any;
    const max = o.maxPostSeconds ?? Number(process.env.X_VIDEO_MAX_SECONDS ?? X_VIDEO_MAX_SECONDS);
    const cut = postCut(r.seconds, sum.dropTime ?? null, max);
    let video = r.mp4!;
    if (cut) {
      video = join(work, `${sel.trackNo}.post.mp4`);
      await ffmpegCut(r.mp4!, video, cut.start, cut.seconds);
    }
    // Tapes written without the decoded `state` copy (e.g. the synthetic one) get it from the slots.
    const track = entries.slice(sel.start, sel.end + 1).map((e) => (e.state ? e : { ...e, state: toTimelineState(decodeFor(e.slot0, e.slot1, e.rules ?? "v2")) }));
    const facts = factsFromTimeline(track, { kind: "track", chain: o.chain, pool: o.pool, hook: o.hook, videoSeconds: Math.round(cut ? cut.seconds : r.seconds) });
    if (facts.track && facts.track.swaps == null && !o.partial) facts.track.swaps = track.length;
    // The release plays one genre and style, the ones the track finished in (SPEC §4.6).
    const genre = sum.genre.eraName as string;
    const style = sum.genre.styleName as string;
    facts.headline = releaseHeadline(sel.trackNo, facts.track?.swaps ?? track.length, genre, style);
    facts.release = {
      seconds: Math.round(r.seconds),
      bars: sum.bars,
      swaps: track.length,
      swapsPerBar: Math.round(sum.swapsPerBar * 10) / 10,
      genre,
      style,
      chainGenres: (sum.chainGenres as { eraName: string }[]).map((g) => g.eraName),
      clip: cut ? { from: Math.round(cut.start), seconds: Math.round(cut.seconds) } : null,
      ...(o.partial ? { partial: true } : {}),
    };
    const cap = await caption(facts);
    if (cap.errors?.length) log("caption fell back to template:", cap.errors.join("; "));
    const res = await publish({
      caption: cap.text,
      captionSource: cap.source,
      facts,
      video,
      artifacts: [r.wav, r.meta, ...(cut ? [r.mp4!] : [])],
    });
    log(`${res.mode}: ${res.dir}`);
    return { ...res, release: r, cut };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Pre-launch teaser: replay the Ethereum IMD/ETH pool (ETH-side amounts, like the IDM/ETH hook) for `days` and queue a post. */
export async function teaser(days = Number(process.env.TEASER_DAYS ?? 7)) {
  const { entries, meta } = await replay({ days, pools: process.env.REPLAY_POOLS ?? "main", out: join(process.env.OUT_DIR ?? "out", "timeline.json") });
  if (entries.length < 10) throw new Error(`only ${entries.length} swaps in window`);
  const span = days >= 2 ? `LAST ${days} DAYS` : `LAST ${Math.round(days * 24)}H`;
  return producePost(entries, {
    kind: "teaser",
    chain: "ethereum",
    pool: "IMD/ETH",
    title: "IMD/ETH · ETHEREUM · UNISWAP V4 · REPLAY",
    subtitle: `${span} · ${meta.count} SWAPS · POOL4 CAPPEDBURNHOOK`,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] ?? "teaser";
  if (cmd === "teaser") console.log(JSON.stringify(await teaser(process.argv[3] ? Number(process.argv[3]) : undefined), null, 2));
  else if (cmd === "release") {
    // Dry-run check of the track post from a tape: tsx src/pipeline.ts release [timeline.json] [trackNo]
    const tl = process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), "../../web/public/release-test.timeline.json");
    if (!existsSync(tl)) throw new Error(`timeline not found: ${tl}`);
    const res = await produceRelease(JSON.parse(readFileSync(tl, "utf8")), {
      chain: "robinhood", pool: "IDM/IMD", track: process.argv[4] ? Number(process.argv[4]) : null,
    });
    console.log(JSON.stringify({ mode: res.mode, dir: res.dir, seconds: res.release.seconds, cut: res.cut }, null, 2));
  }
  else throw new Error(`unknown command ${cmd}`);
}
