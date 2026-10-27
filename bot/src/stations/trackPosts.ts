// Station track posts on @theidmfun: the finished tracks of the stations listed in STATION_TRACKS (registry keys,
// e.g. "imd-eth,credits"; IMD_STATION=1 is the old switch for imd-eth alone and still adds it). Pure: which stations,
// what joins the queue, which queued track may post now, the caption. The scheduler (scheduler.ts) owns the state, the
// station timelines (updateStations), the render and DRY_RUN.
//
// Queue: a station's finished track joins the scheduler's track queue (rules.ts QueuedTrack, with its station key)
// once, oldest first, beside the $IDM hook's. A newly listed station starts from its newest finished track already in
// its cache, so enabling it never posts its backlog: only tracks finished after that are posted.
// Cadence: track posts go one per tick inside the daily cap (rules.ts); a house station (imd-eth) posts every track as
// before; any other station at most `perDay` tracks per rolling 24 h and `gapMs` apart, its other tracks wait in the
// queue (and are skipped if their start leaves the station's cached tape), so it can never take more than `perDay` of
// the day's posts from the $IDM hook.
import type { PostRecord, QueuedTrack, SchedState } from "../rules.ts";
import type { TimelineEntry } from "../lib/timeline.ts";
import { cashtag } from "./plusPosts.ts";

const H = 3_600_000;

/** The IMD/ETH station's key (station.ts IMD_STATION.key; registry "imd-eth"). */
export const IMD_ETH = "imd-eth";

/**
 * Stations whose finished tracks are posted: STATION_TRACKS (comma list of registry keys) plus "imd-eth" when
 * IMD_STATION=1 (the switch the server had before the list). In order, without repeats or blanks.
 */
export function stationTrackKeys(env: Record<string, string | undefined> = process.env): string[] {
  const keys = (env.STATION_TRACKS ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (env.IMD_STATION === "1") keys.unshift(IMD_ETH);
  return [...new Set(keys)];
}

/** The old single-station counter (stationLastTrackNo, IMD/ETH) moves into the per-station map, so nothing re-posts. */
export function migrateStationTracks(s: SchedState): Record<string, number> {
  s.stationTracks ??= {};
  if (s.stationLastTrackNo != null) {
    s.stationTracks[IMD_ETH] ??= s.stationLastTrackNo;
    delete s.stationLastTrackNo;
  }
  return s.stationTracks;
}

/** Finished tracks on a station's cached tape, oldest first. */
const finishedOn = (entries: readonly TimelineEntry[]) =>
  entries.flatMap((e) => (e.trackComplete ? [{ trackNo: e.trackComplete.trackNo, block: e.blockNumber }] : []));

/**
 * Queues the station's tracks finished since its last queued one (each once, oldest first) and returns how many. A
 * station seen for the first time starts from its newest finished track on the tape and queues nothing (no backlog).
 */
export function queueStationTracks(s: SchedState, key: string, entries: readonly TimelineEntry[]): number {
  const last = migrateStationTracks(s);
  const done = finishedOn(entries);
  if (last[key] == null) {
    last[key] = Math.max(0, ...done.map((d) => d.trackNo));
    return 0;
  }
  s.trackQueue ??= [];
  let n = 0;
  for (const d of done) {
    if (d.trackNo <= last[key]) continue;
    s.trackQueue.push({ trackNo: d.trackNo, block: d.block, station: key });
    last[key] = d.trackNo;
    n++;
  }
  return n;
}

export interface StationTrackRules {
  /** Track posts per rolling 24 h of one non-house station. */
  perDay: number;
  /** Between two track posts of one non-house station. */
  gapMs: number;
}
export const STATION_TRACK_RULES: StationTrackRules = { perDay: 3, gapMs: 2 * H };

/**
 * Queued tracks that may post at `now`, in queue order: the hook's, a house station's (`uncapped`), and a capped
 * station's while it has posted fewer than `perDay` tracks in 24 h and none within `gapMs` (posts with its key).
 */
export function postableTracks(
  queue: readonly QueuedTrack[] | undefined,
  posts: readonly PostRecord[],
  now: number,
  uncapped: ReadonlySet<string>,
  r: StationTrackRules = STATION_TRACK_RULES,
): QueuedTrack[] {
  const room = new Map<string, boolean>();
  const open = (key: string) => {
    if (!room.has(key)) {
      const mine = posts.filter((p) => p.kind === "track" && p.station === key && now - p.at < 24 * H);
      room.set(key, mine.length < r.perDay && mine.every((p) => now - p.at >= r.gapMs));
    }
    return room.get(key)!;
  };
  return (queue ?? []).filter((t) => (!t.notBefore || t.notBefore <= now) && (!t.station || uncapped.has(t.station) || open(t.station)));
}

/** "CREDIT" -> "Credit": an nft station's item as the site's feed names it (site main.ts nftItem). */
export const nftItemName = (ticker: string) => ticker[0] + ticker.slice(1).toLowerCase();

export interface StationTrackCaption {
  /** Registry label, e.g. "CREDITS". */
  label: string;
  key: string;
  trackNo: number;
  /** Sales (nft) in the track. */
  count: number;
  genre?: string;
  style?: string;
  site?: string;
  /** The hamster station: the wheel's makers' X handle (registry hamster.tag, their ok given 2026-10-27). */
  tag?: string;
}

/**
 * A collection station's (kind "nft") track post: impersonal and lowercase, $IDM as the ONLY cashtag (X refuses a
 * post with two: 403; the collection is named, never tagged; no handles), genre · style, the sales, the station link.
 */
export function nftTrackCaption(c: StationTrackCaption): string {
  const name = c.label.replace(/\$/g, "").toLowerCase();
  const sound = [c.genre, c.style].filter(Boolean).map((x) => x!.toLowerCase()).join(" · ");
  const site = (c.site ?? "https://theidm.fun").replace(/\/$/, "");
  return [
    `track #${c.trackNo} finished on the ${name} station: ${c.count} sales${sound ? `, ${sound}` : ""}.`,
    `every ${name} sale is a note, played through the ${cashtag("IDM")} rules.`,
    `${site}/?net=${c.key}`,
  ].join("\n");
}

/**
 * The hamster station's track post: same rules as a collection's (impersonal, lowercase, $IDM the only cashtag), the
 * notes, genre · style, the wheel's makers tagged when the registry names their handle (hamster.tag), the station link.
 */
export function hamsterTrackCaption(c: StationTrackCaption): string {
  const sound = [c.genre, c.style].filter(Boolean).map((x) => x!.toLowerCase()).join(" · ");
  const site = (c.site ?? "https://theidm.fun").replace(/\/$/, "");
  const name = c.label.replace(/\$/g, "").toLowerCase();
  return [
    `track #${c.trackNo} finished on the ${name} station: ${c.count} notes from a real hamster's wheel${sound ? `, ${sound}` : ""}.`,
    `every 30 m of the wheel is a note, played through the ${cashtag("IDM")} rules.${c.tag ? ` wheel by @${c.tag}` : ""}`,
    `${site}/?net=${c.key}`,
  ].join("\n");
}

/** Cashtags in a text ($ + a letter), for the one-cashtag rule. */
export const cashtags = (text: string) => text.match(/\$[A-Za-z][A-Za-z0-9_]*/g) ?? [];
