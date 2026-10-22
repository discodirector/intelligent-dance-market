// Long-running bot: applies SPEC §5 rules every TICK_MINUTES.
//  - pre-launch (no HOOK_ADDRESS/LIVE_RPC_URL): teaser from the Ethereum IMD/ETH pool replay (ETH side) every 6h
//  - live: snapshot every 6h, every track-complete (v2 hook, HOOK_RULES=v2) as soon as rendered, Movement/whale max 1/2h (own clock), daily cap 24
//  - STATION_CHECKPOINTS=1: every live registry station replayed and its checkpoint published each tick (station.ts)
//  - every tick: stations-data/status.json (registry status + paid renewals, expired = off air); once a day the
//    stations expiring within 3 days are logged and written to applications/reminders.json (stations/subscription.ts)
//  - Station+ (docs/STATIONS.md "Station+"): one post a week per Station+ station, the release of a track finished
//    that week or a now-playing clip, at most one per tick and 3 h apart (stations/plusPosts.ts), inside the daily cap
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packFor, programFromPack, type StationPack } from "@swarm-sequencer/synth";
import { decide, DEFAULT_RULES, H, prune, readyTracks, type PostKind, type SchedState } from "./rules.ts";
import { producePost, produceRelease, teaser } from "./pipeline.ts";
import { fetchMutated, liveClient, liveConfigFromEnv } from "./live.ts";
import { isDryRun } from "./post/index.ts";
import { Store } from "./api/store.ts";
import { IMD_STATION, stationFromEntry, updateStations, type Registry } from "./station.ts";
import {
  duePlusPost, failedPlus, plusCaption, PLUS_POST_RULES, plusTrack, postedPlus, trackSwaps, xHandle,
  type PlusPostRules, type PlusPostStates,
} from "./stations/plusPosts.ts";
import { loadMergedRegistry, packJsonPath } from "./stations/runtime.ts";
import { expiring, publishStatus, writeJsonAtomic, type StatusFile } from "./stations/subscription.ts";
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

const REMINDERS = join(OUT, "applications", "reminders.json");
/** Days ahead a subscription's end is reminded. */
const REMIND_DAYS = 3;

/**
 * The runtime station status for the site (every tick: an expiry takes the station off air within one tick) and,
 * once a UTC day, the stations whose subscription ends within REMIND_DAYS: logged and written for the owner (posts and
 * DMs later). A failure here never stops the tick: the site falls back to the registry.
 */
function subscriptions(reg: Registry): StatusFile {
  try {
    const status = publishStatus(reg, OUT, STATIONS_DATA);
    const today = new Date().toISOString().slice(0, 10);
    let last: string | undefined;
    try { last = JSON.parse(readFileSync(REMINDERS, "utf8")).checkedOn; } catch { /* first run */ }
    if (last !== today) {
      const soon = expiring(reg, status, Date.now(), REMIND_DAYS);
      for (const r of soon) log(`subscription: ${r.key} ${r.status === "expired" ? "EXPIRED" : `ends in ${r.daysLeft} d`} (paidUntil ${r.paidUntil})`);
      if (!soon.length) log(`subscription: none ending within ${REMIND_DAYS} days`);
      writeJsonAtomic(REMINDERS, { checkedOn: today, checkedAt: new Date().toISOString(), days: REMIND_DAYS, stations: soon });
    }
    return status;
  } catch (e) {
    log("subscription status failed:", (e as Error).message);
    return {};
  }
}

/** STATION_PLUS_POSTS=0 turns the Station+ weekly posts off (default on; DRY_RUN still decides whether X sees them). */
const PLUS_POSTS = process.env.STATION_PLUS_POSTS !== "0";
const PLUS_RULES: PlusPostRules = {
  ...PLUS_POST_RULES,
  dailyCap: DEFAULT_RULES.dailyCap,
  gapMs: Number(process.env.PLUS_POST_GAP_HOURS ?? PLUS_POST_RULES.gapMs / H) * H,
};
/** Swaps a "now playing" clip plays: the station's newest. */
const PLUS_CLIP_SWAPS = 200;
const SITE = (process.env.SITE_URL ?? "https://theidm.fun").replace(/\/$/, "");

/** Live Station+ stations now (status.json's plus). */
const plusKeys = (status: StatusFile) => Object.entries(status).flatMap(([k, v]) => (v.plus && v.status === "live" ? [k] : []));
/** Dry runs keep their own Station+ state: a dry run never delays the first real post. */
const plusStates = (s: SchedState): PlusPostStates => (isDryRun() ? (s.plusPostsDry ??= {}) : (s.plusPosts ??= {}));

/** A station's pack as data: baked (synth PACKS) or the pipeline's runtime JSON; undefined for the house program. */
function packOf(program: string): unknown {
  if (program === "idm") return undefined;
  const baked = packFor(program);
  if (baked) return baked;
  const p = packJsonPath(STATIONS_DATA, program);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
}

/** The client's X handle from the station's paid setup application (pipeline stations); null for others. */
function handleOf(key: string): string | null {
  try {
    const store = new Store(OUT);
    const app = store.list().find((a) => a.kind === "setup" && a.payment && store.pipeline<{ key?: string }>(a.id)?.key === key);
    return xHandle(app?.contact);
  } catch {
    return null;
  }
}

/**
 * One Station+ weekly post (stations/plusPosts.ts): the release of a track finished since the station's last post,
 * else a "now playing" clip; square 1080x1080 only, the station's own sound (its pack) and name, a fixed caption with
 * its ticker as the only cashtag. A failure is retried in an hour; after three the week is given up.
 */
async function plusPost(s: SchedState, key: string, reg: Registry, stations: Awaited<ReturnType<typeof updateStations>>) {
  const states = plusStates(s);
  const now = Date.now();
  try {
    const e = reg.stations.find((x) => x.key === key);
    if (!e || e.kind === "hook") throw new Error("not a played registry station");
    let cache = stations.get(key);
    if (!cache || cache instanceof Error) cache = (await updateStations(OUT, STATIONS_DATA, { keys: [key], reg })).get(key);
    if (!cache || cache instanceof Error) throw cache ?? new Error("station timeline not loaded");
    const entries = cache.entries;
    if (!entries.length) {
      log(`station+ ${key}: no swaps yet; nothing to post this week`);
      postedPlus(states, key, now, "skipped");
      return;
    }
    const st = stationFromEntry(e, reg);
    const chain = reg.chains[String(e.chainId)]?.name ?? String(e.chainId);
    const pack = packOf(e.program);
    const program = pack ? programFromPack(pack as StationPack) : undefined;
    const base = { label: e.label, ticker: e.ticker, key, handle: handleOf(key), site: SITE };
    // A calibrated quote (not ETH): the feed shows the pool's own currency, named by its label (CHOG/MON: MON).
    const perEth = Number(e.calibration?.quotePerEth ?? 1);
    const quote = perEth !== 1 ? { symbol: e.label.split("/")[1] ?? "ETH", perEth } : undefined;
    const trackNo = plusTrack(entries, states[key], now);
    if (trackNo != null) {
      await produceRelease(entries, {
        chain: chain.toLowerCase(), pool: e.label, track: trackNo, station: st.label, pack, program, theme: e.theme, quote,
        title: `${e.label.toUpperCase()} · ${chain.toUpperCase()} · TRACK #${trackNo} · ${trackSwaps(entries, trackNo)} SWAPS IN ORDER`,
        caption: (f) => plusCaption({ ...base, kind: "release", trackNo, swaps: f.release?.swaps ?? trackSwaps(entries, trackNo), genre: f.release?.genre }),
      });
    } else {
      const recent = entries.slice(-PLUS_CLIP_SWAPS);
      await producePost(recent, {
        kind: "snapshot", chain: chain.toLowerCase(), pool: e.label,
        title: `${e.label.toUpperCase()} · ${chain.toUpperCase()} · NOW PLAYING`,
        subtitle: `${recent.length} RECENT SWAPS · THEIDM.FUN/?NET=${key.toUpperCase()}`,
        station: st.label, pack, program, theme: e.theme, quote, sizes: [[1080, 1080]],
        caption: (f) => plusCaption({ ...base, kind: "clip", swaps: f.swaps, genre: f.playing }),
      });
    }
    postedPlus(states, key, now, trackNo != null ? "release" : "clip", trackNo ?? undefined);
    log(`station+ ${key}: weekly ${trackNo != null ? `release of track #${trackNo}` : "now-playing clip"} ${isDryRun() ? "queued (dry run)" : "posted"}`);
    // Dry runs post nothing, so they must not use up the daily cap.
    if (!isDryRun()) s.posts.push({ at: now, kind: "station" });
  } catch (err) {
    const gaveUp = failedPlus(states, key, now, PLUS_RULES);
    log(`station+ ${key}: weekly post failed${gaveUp ? " again; this week is skipped" : ", retrying in an hour"}:`, (err as Error).stack ?? err);
  }
}

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
  let reg: Registry | undefined;
  // Baked + the pipeline's runtime stations (stations/runtime.ts): a runtime station gets checkpoints and expiry too.
  try { reg = loadMergedRegistry(STATIONS_DATA); } catch (e) { log("station registry unreadable:", (e as Error).message); }
  const status = reg ? subscriptions(reg) : {};
  const expired = new Set(Object.entries(status).flatMap(([k, v]) => (v.status === "expired" ? [k] : [])));
  // Stations: all of them for the checkpoints, or only IMD/ETH for its track posts (live only, as before).
  const stations = CHECKPOINTS || (STATION && live)
    ? await updateStations(OUT, STATIONS_DATA, { keys: CHECKPOINTS ? undefined : [IMD_STATION.key], reg, expired })
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
  // A Station+ station's weekly post takes the tick when one is due (it waits for the cap and its own gap, never for
  // the hook's posts); the hook's queue simply posts on the next tick.
  const plusKey = reg && PLUS_POSTS ? duePlusPost(plusKeys(status), plusStates(s), Date.now(), s.posts.filter((p) => Date.now() - p.at < 24 * H).length, PLUS_RULES) : null;
  if (plusKey && reg) {
    if (live) {
      s.pendingMovements = newMovements;
      delete s.pendingTracks;
      s.lastBlock = Number(head);
    }
    await plusPost(s, plusKey, reg, stations);
    return save(s);
  }
  const kind: Exclude<PostKind, "station"> | null = decide(Date.now(), s, { live: !!live, newMovements, newTracks });
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
