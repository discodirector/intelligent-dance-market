// timeline entries -> render -> caption -> publish (queue or X)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "./render/index.ts";
import { caption } from "./caption/index.ts";
import { publish } from "./post/index.ts";
import { factsFromTimeline, type Facts } from "./lib/facts.ts";
import type { TimelineEntry } from "./lib/timeline.ts";
import { replay } from "./replay/index.ts";

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

/** Pre-launch teaser: replay the Ethereum IMD pool for `days` and queue a post. */
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
  else throw new Error(`unknown command ${cmd}`);
}
