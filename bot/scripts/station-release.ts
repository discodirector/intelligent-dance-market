// Dry render of a station's finished track as the scheduler would post it (stations/look.ts stationTrackRelease: its
// pack, theme, sales or swaps, fixed caption), from the station's cached timeline (OUT_DIR/stations/<key>.json, kept
// by the scheduler or station.ts updateStations). Never posts: refuses unless DRY_RUN is on (the default); the post
// lands in OUT_DIR/queue like any dry run.
//   tsx scripts/station-release.ts <key> [trackNo (default: the newest finished)] [--cache path]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDryRun } from "../src/post/index.ts";
import { loadRegistry, type StationCache } from "../src/station.ts";
import { stationTrackRelease } from "../src/stations/look.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const OUT = process.env.OUT_DIR ?? "out";
const cachePath = opt("cache");
const [key, no] = args;
if (!key) throw new Error("usage: station-release.ts <key> [trackNo] [--cache path]");
if (!isDryRun()) throw new Error("dry runs only: unset DRY_RUN or set DRY_RUN=true");
const reg = loadRegistry();
const e = reg.stations.find((x) => x.key === key);
if (!e || e.kind === "hook" || e.house) throw new Error(`${key}: not a played non-house registry station`);
const cache: StationCache = JSON.parse(readFileSync(cachePath ?? join(OUT, "stations", `${key}.json`), "utf8"));
const done = cache.entries.filter((x) => x.trackComplete).map((x) => x.trackComplete!.trackNo);
const trackNo = no ? Number(no) : done.at(-1);
if (trackNo == null || !done.includes(trackNo)) throw new Error(`${key}: track ${no ?? "(none)"} not finished on the cached tape (${done.join(", ")})`);
const site = (process.env.SITE_URL ?? "https://theidm.fun").replace(/\/$/, "");
const res = await stationTrackRelease(cache.entries, e, reg, trackNo, { site, stationsData: process.env.STATIONS_DATA_DIR ?? join(OUT, "stations-data") });
console.log(JSON.stringify({ mode: res.mode, dir: res.dir, seconds: res.release.seconds, cut: res.cut }, null, 2));
