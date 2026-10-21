// Long-running bot: applies SPEC §5 rules every TICK_MINUTES.
//  - pre-launch (no HOOK_ADDRESS/LIVE_RPC_URL): teaser from the Ethereum IMD/ETH pool replay (ETH side) every 6h
//  - live: snapshot every 6h, every track-complete (v2 hook, HOOK_RULES=v2) as soon as rendered, Movement/whale max 1/2h (own clock), daily cap 24
//  - STATION_CHECKPOINTS=1: every live registry station replayed and its checkpoint published each tick (station.ts)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, prune, readyTracks, type PostKind, type SchedState } from "./rules.ts";
import { producePost, produceRelease, teaser } from "./pipeline.ts";
import { fetchMutated, liveClient, liveConfigFromEnv } from "./live.ts";
import { isDryRun } from "./post/index.ts";
import { IMD_STATION, updateStations } from "./station.ts";
import type { TimelineEntry } from "./lib/timeline.ts";
import { movementWindow, trackSubtitle, trackWindow } from "./lib/track.ts";
import { withTrackStart } from "./lib/release.ts";

const OUT = process.env.OUT_DIR ?? "out";
const STATE = join(OUT, "scheduler-state.json");
const TICK = Number(process.env.TICK_MINUTES ?? 5) * 60_000;
const TEASER_WINDOWS = (process.env.TEASER_WINDOWS ?? "7,1,3").split(",").map(Number);
/** v2 track posts: "release" (default) renders the whole track (SPEC §4.6); "clip" keeps the old run-up clip. */
const TRACK_POST = process.env.TRACK_POST ?? "release";
/** Blocks per earlier fetch while looking for the start of a track. */
const TRACK_LOOKBACK_BLOCKS = BigInt(process.env.TRACK_LOOKBACK_BLOCKS ?? 30_000);
const TRACK_LOOKBACK_STEPS = Number(process.env.TRACK_LOOKBACK_STEPS ?? 24);
/** Live pool label in posts and video titles. */
const POOL_LABEL = process.env.POOL_LABEL ?? "IDM/ETH";
const LIVE_TITLE = `${POOL_LABEL} · ROBINHOOD CHAIN · LIVE HOOK STATE`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[scheduler]", ...a);
/** IMD_STATION=1: also post the IMD/ETH station's finished tracks (station.ts). */
const STATION = process.env.IMD_STATION === "1";
/** STATION_CHECKPOINTS=1: keep every live registry station and publish its checkpoint for the site. */
const CHECKPOINTS = process.env.STATION_CHECKPOINTS === "1";
/** Where the checkpoints go; the web server serves this directory as /stations-data/ (docs/STATIONS.md). */
const STATIONS_DATA = process.env.STATIONS_DATA_DIR ?? join(OUT, "stations-data");

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
  let stationEntries: TimelineEntry[] = [];
  let head = 0n;
  const client = live ? liveClient(live) : null;
  // Stations: all of them for the checkpoints, or only IMD/ETH for its track posts (live only, as before).
  const stations = CHECKPOINTS || (STATION && live)
    ? await updateStations(OUT, STATIONS_DATA, { keys: CHECKPOINTS ? undefined : [IMD_STATION.key] })
    : new Map<string, never>();
  for (const [key, r] of stations) if (r instanceof Error) log(`${key} station update failed:`, r.message);
  if (live && client) {
    head = await client.getBlockNumber();
    const from = s.lastBlock !== undefined ? BigInt(s.lastBlock) + 1n : live.startBlock ?? (head > 50_000n ? head - 50_000n : 0n);
    const fresh = from <= head ? await fetchMutated(client, live.hook, from, head, live.rules, live.treasury) : [];
    newMovements = fresh.filter((e) => e.movement).length + (s.pendingMovements ?? 0);
    // Every TrackComplete joins the queue once; the queue is posted oldest first, one per tick.
    s.trackQueue ??= [];
    for (const e of fresh) {
      const no = e.trackComplete?.trackNo;
      if (no != null && no > (s.lastTrackNo ?? 0)) {
        s.trackQueue.push({ trackNo: no, block: e.blockNumber });
        s.lastTrackNo = no;
      }
    }
    const st = stations.get(IMD_STATION.key);
    if (STATION && st && !(st instanceof Error)) {
      stationEntries = st.entries;
      for (const f of st.finished) {
        if (f.trackNo > (s.stationLastTrackNo ?? 0)) {
          s.trackQueue.push({ trackNo: f.trackNo, block: f.block, station: IMD_STATION.key });
          s.stationLastTrackNo = f.trackNo;
        }
      }
    }
    newTracks = readyTracks(s.trackQueue, Date.now()).length;
    // context for rendering: last 24h of events (bounded)
    const ctxFrom = head > 30_000n ? head - 30_000n : 0n;
    recent = (await fetchMutated(client, live.hook, ctxFrom, head, live.rules, live.treasury)).slice(-2000);
  }
  const kind: PostKind | null = decide(Date.now(), s, { live: !!live, newMovements, newTracks });
  log(`mode=${live ? `live ${live.rules}` : "pre-launch"} dryRun=${isDryRun()} posts24h=${s.posts.filter((p) => Date.now() - p.at < 86_400_000).length} movements=${newMovements} tracks=${newTracks} -> ${kind ?? "nothing"}`);
  if (live) {
    s.pendingMovements = kind === "movement" ? 0 : newMovements;
    delete s.pendingTracks;
    s.lastBlock = Number(head);
  }
  if (!kind) return save(s);

  if (kind === "teaser") {
    const n = s.posts.filter((p) => p.kind === "teaser").length;
    await teaser(TEASER_WINDOWS[n % TEASER_WINDOWS.length]);
  } else if (kind === "track" && TRACK_POST === "release" && live && client && readyTracks(s.trackQueue, Date.now()).length) {
    // The oldest queued track, whole: read up to its TrackComplete, then back until its start (the previous
    // TrackComplete or the hook's first swap).
    const item = readyTracks(s.trackQueue, Date.now())[0];
    let posted = false;
    try {
      if (item.station) {
        // A station track: its whole history is in the station's cached timeline.
        if (!stationEntries.some((e) => e.trackComplete?.trackNo === item.trackNo)) throw new Error("station timeline not loaded");
        await produceRelease(stationEntries, { chain: "ethereum", pool: IMD_STATION.pool, station: IMD_STATION.label, track: item.trackNo });
      } else {
        const floor = live.startBlock ?? 0n;
        const earlier = async (before: number | bigint) => {
          const to = BigInt(before);
          if (to < floor) return [];
          const from = to - TRACK_LOOKBACK_BLOCKS + 1n > floor ? to - TRACK_LOOKBACK_BLOCKS + 1n : floor;
          return fetchMutated(client, live.hook, from, to, live.rules, live.treasury);
        };
        const tail = await earlier(item.block);
        const { entries, partial } = await withTrackStart(tail, (before) => earlier(BigInt(before) - 1n), TRACK_LOOKBACK_STEPS, item.trackNo);
        if (partial) log(`track #${item.trackNo}: start not found within the lookback; release starts at the oldest swap read`);
        await produceRelease(entries, { chain: "robinhood", pool: POOL_LABEL, hook: live.hook, track: item.trackNo, partial });
      }
      posted = true;
    } catch (e) {
      log(`${item.station ?? "idm"} track #${item.trackNo}: release failed:`, (e as Error).stack ?? e);
    }
    s.trackQueue = s.trackQueue!.filter((t) => t !== item);
    // The run-up clip shows the recent tape, so it only stands in for the newest track.
    const newest = [...recent].reverse().find((e) => e.trackComplete)?.trackComplete?.trackNo;
    // A station track never falls back to the $IDM clip.
    if (!posted && (item.station || newest !== item.trackNo)) {
      log(`track #${item.trackNo}: skipped (no release, and the clip would show a later track)`);
      return save(s);
    }
    if (!posted) {
      const entries = trackWindow(recent);
      const tc = [...entries].reverse().find((e) => e.trackComplete)?.trackComplete;
      await producePost(entries, {
        kind, chain: "robinhood", pool: POOL_LABEL,
        title: LIVE_TITLE,
        subtitle: tc ? trackSubtitle(tc) : "TRACK COMPLETE",
        hook: live.hook,
      });
    }
  } else if (recent.length) {
    const entries = kind === "track" ? trackWindow(recent) : kind === "movement" ? movementWindow(recent) : recent;
    const tc = [...entries].reverse().find((e) => e.trackComplete)?.trackComplete;
    await producePost(entries, {
      kind, chain: "robinhood", pool: POOL_LABEL,
      title: LIVE_TITLE,
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
  // Dry runs post nothing, so they must not use up the daily cap or the gaps.
  if (!isDryRun()) s.posts.push({ at: Date.now(), kind });
  save(s);
}

log(`starting; tick every ${TICK / 60_000} min; out=${OUT}`);
for (;;) {
  try { await tick(); } catch (e) { log("tick failed:", (e as Error).stack ?? e); }
  await new Promise((r) => setTimeout(r, TICK));
}
