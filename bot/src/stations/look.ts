// A played registry station's posts in its own look and sound (scheduler.ts: Station+ weekly posts, station track
// posts; scripts/station-release.ts: a dry render of one track): its pack and program, its theme and skin, its quote,
// and for a collection (kind "nft") sales instead of swaps.
import { existsSync, readFileSync } from "node:fs";
import { packFor, programFromPack, type StationPack } from "@swarm-sequencer/synth";
import { produceRelease } from "../pipeline.ts";
import type { TimelineEntry } from "../lib/timeline.ts";
import { stationFromEntry, type Registry, type RegistryEntry } from "../station.ts";
import { plusCaption, trackSwaps } from "./plusPosts.ts";
import { packJsonPath } from "./runtime.ts";
import { hamsterTrackCaption, nftItemName, nftTrackCaption } from "./trackPosts.ts";

/** A station's pack as data: baked (synth PACKS) or the pipeline's runtime JSON; undefined for the house program. */
export function packOf(program: string, stationsData: string): unknown {
  if (program === "idm") return undefined;
  const baked = packFor(program);
  if (baked) return baked;
  const p = packJsonPath(stationsData, program);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
}

/**
 * The station's look and sound for its posts: its name on the module, its pack and program, its theme (and skin), a
 * calibrated quote (CHOG/MON: MON; else ETH), and for a collection the item and collection names (its videos count sales).
 */
export function stationLook(e: RegistryEntry, reg: Registry, stationsData: string) {
  // The hamster station has no pool to read: its name is all a release needs of it; its "chain" is the wheel.
  const st = e.kind === "hamster" ? { label: `${e.label.toLowerCase()} station` } : stationFromEntry(e, reg);
  const chain = e.kind === "hamster" ? "a real wheel" : (reg.chains[String(e.chainId)]?.name ?? String(e.chainId));
  const pack = packOf(e.program, stationsData);
  const program = pack ? programFromPack(pack as StationPack) : undefined;
  // A calibrated quote (not ETH): the feed shows the pool's own currency, named by its label (CHOG/MON: MON).
  const perEth = Number(e.calibration?.quotePerEth ?? 1);
  const quote = perEth !== 1 ? { symbol: e.label.split("/")[1] ?? "ETH", perEth } : undefined;
  const nft = e.kind === "nft" ? { item: nftItemName(e.ticker), name: e.label } : undefined;
  const hamster = e.kind === "hamster" ? { name: e.label } : undefined;
  return { chain, opts: { station: st.label, pack, program, theme: e.theme, quote, skin: e.key, nft, hamster } };
}

/**
 * A station release's title line: "CREDITS · ETHEREUM · TRACK #9 · 214 SALES IN ORDER" (a pool: SWAPS; the hamster:
 * "SQUEEKCHAIN · A REAL WHEEL · TRACK #3 · 96 NOTES IN ORDER").
 */
export const releaseTitle = (e: RegistryEntry, chain: string, trackNo: number, count: number) =>
  `${e.label.toUpperCase()} · ${chain.toUpperCase()} · TRACK #${trackNo} · ${count} ${e.kind === "nft" ? "SALES" : e.kind === "hamster" ? "NOTES" : "SWAPS"} IN ORDER`;

/**
 * A non-house station's finished track as a post (stations/trackPosts.ts): its release in its look and sound, with a
 * fixed caption: a collection's names its sales and $IDM only; a pool's (plusCaption) its own ticker only.
 */
export function stationTrackRelease(entries: TimelineEntry[], e: RegistryEntry, reg: Registry, trackNo: number, o: { site: string; stationsData: string }) {
  const { chain, opts } = stationLook(e, reg, o.stationsData);
  const count = trackSwaps(entries, trackNo);
  return produceRelease(entries, {
    chain: chain.toLowerCase(), pool: e.label, track: trackNo, ...opts,
    title: releaseTitle(e, chain, trackNo, count),
    caption: (f, rel) =>
      e.kind === "hamster"
        ? hamsterTrackCaption({ label: e.label, key: e.key, tag: e.hamster?.tag, trackNo, count: f.release?.swaps ?? count, genre: rel?.genre, style: rel?.style, site: o.site })
        : e.kind === "nft"
        ? nftTrackCaption({ label: e.label, key: e.key, trackNo, count: f.release?.swaps ?? count, genre: rel?.genre, style: rel?.style, site: o.site })
        : plusCaption({ kind: "release", label: e.label, ticker: e.ticker, key: e.key, trackNo, swaps: f.release?.swaps ?? count, genre: rel?.genre, site: o.site }),
  });
}
