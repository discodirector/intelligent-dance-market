// Long-running bot: applies SPEC §5 rules every TICK_MINUTES.
//  - pre-launch (no HOOK_ADDRESS/LIVE_RPC_URL): teaser from Ethereum IMD pool replay every 6h
//  - live: snapshot every 6h, Movement/whale or track-complete (v2 hook, HOOK_RULES=v2) post max 1/h, daily cap 6
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, prune, type PostKind, type SchedState } from "./rules.ts";
import { producePost, teaser } from "./pipeline.ts";
import { fetchMutated, liveClient, liveConfigFromEnv } from "./live.ts";
import { isDryRun } from "./post/index.ts";
import { trackSubtitle, trackWindow } from "./lib/track.ts";

const OUT = process.env.OUT_DIR ?? "out";
const STATE = join(OUT, "scheduler-state.json");
const TICK = Number(process.env.TICK_MINUTES ?? 5) * 60_000;
const TEASER_WINDOWS = (process.env.TEASER_WINDOWS ?? "7,1,3").split(",").map(Number);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[scheduler]", ...a);

function load(): SchedState {
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { posts: [] }; }
}
function save(s: SchedState) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

async function tick() {
  let s = prune(load(), Date.now());
  const live = liveConfigFromEnv();
  let newMovements = 0;
  let newTracks = 0;
  let recent: Awaited<ReturnType<typeof fetchMutated>> = [];
  let head = 0n;
  if (live) {
    const client = liveClient(live);
    head = await client.getBlockNumber();
    const from = s.lastBlock !== undefined ? BigInt(s.lastBlock) + 1n : live.startBlock ?? (head > 50_000n ? head - 50_000n : 0n);
    const fresh = from <= head ? await fetchMutated(client, live.hook, from, head, live.rules) : [];
    newMovements = fresh.filter((e) => e.movement).length + (s.pendingMovements ?? 0);
    newTracks = fresh.filter((e) => e.trackComplete).length + (s.pendingTracks ?? 0);
    // context for rendering: last 24h of events (bounded)
    const ctxFrom = head > 30_000n ? head - 30_000n : 0n;
    recent = (await fetchMutated(client, live.hook, ctxFrom, head, live.rules)).slice(-2000);
  }
  const kind: PostKind | null = decide(Date.now(), s, { live: !!live, newMovements, newTracks });
  log(`mode=${live ? `live ${live.rules}` : "pre-launch"} dryRun=${isDryRun()} posts24h=${s.posts.filter((p) => Date.now() - p.at < 86_400_000).length} movements=${newMovements} tracks=${newTracks} -> ${kind ?? "nothing"}`);
  if (live) {
    s.pendingMovements = kind === "movement" ? 0 : newMovements;
    s.pendingTracks = kind === "track" ? 0 : newTracks;
    s.lastBlock = Number(head);
  }
  if (!kind) return save(s);

  if (kind === "teaser") {
    const n = s.posts.filter((p) => p.kind === "teaser").length;
    await teaser(TEASER_WINDOWS[n % TEASER_WINDOWS.length]);
  } else if (recent.length) {
    const entries = kind === "track" ? trackWindow(recent) : recent;
    const tc = [...entries].reverse().find((e) => e.trackComplete)?.trackComplete;
    await producePost(entries, {
      kind, chain: "robinhood", pool: "IDM/IMD",
      title: "IDM/IMD · ROBINHOOD CHAIN · LIVE HOOK STATE",
      subtitle:
        kind === "track" && tc ? trackSubtitle(tc)
        : kind === "movement" ? "MOVEMENT — WHALE ROTATED THE ROOT"
        : `SNAPSHOT · ${recent.length} RECENT SWAPS`,
      hook: live!.hook,
    });
  } else {
    log("no hook events yet; skipping");
    return save(s);
  }
  s.posts.push({ at: Date.now(), kind });
  save(s);
}

log(`starting; tick every ${TICK / 60_000} min; out=${OUT}`);
for (;;) {
  try { await tick(); } catch (e) { log("tick failed:", (e as Error).stack ?? e); }
  await new Promise((r) => setTimeout(r, TICK));
}
