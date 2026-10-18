// Deterministic synthetic v2 tape for track releases (SPEC §4.6): core mutate with V2 rules (relative tiers,
// accumulation, heat/drop) over a realistic swap mix, until three tracks are complete, plus the first swaps of the
// fourth. There is no real v2 TrackComplete tape yet; this one exercises seeds, saturation, heat, whales and drops.
//   npx tsx bot/scripts/release-tape.ts [out]   (default web/public/release-test.timeline.json)
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { whaleWeiAtTick } from "@swarm-sequencer/core";
import { buildTimeline, type RawSwap } from "../src/lib/timeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? resolve(here, "../../web/public/release-test.timeline.json"));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = rng(0x1d3);
const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const E18 = 10n ** 18n;
/** Token amount with 18 decimals from a float. */
const wei = (x: number) => (BigInt(Math.round(x * 1e6)) * E18) / 1_000_000n;

const TRACKS = 3;
const AFTER = 12;
const swaps: RawSwap[] = [];
let ts = 1_793_000_000;
let block = 30_000_000;
// Launch market: FDV ~4 ETH (tick 193380, whale ~0.04 ETH). Buys lower the tick (IDM per ETH falls, FDV rises).
let tick = 193_380;
let buyBias = 0.6;

function next(): RawSwap {
  // Calm and busy stretches: mean gap 3 min, bursts of seconds. The release ignores the gaps; the tape keeps them real.
  const busy = Math.floor(swaps.length / 40) % 3 === 1;
  const gap = Math.max(2, Math.round(-Math.log(1 - r()) * (busy ? 40 : 180)));
  ts += gap;
  block += Math.max(1, Math.round(gap / 2));
  // Buy share drifts between ~45% and ~75%, so the grid fills, stalls and fills again.
  buyBias = Math.min(0.75, Math.max(0.45, buyBias + (r() - 0.5) * 0.08));
  const isBuy = r() < buyBias;
  // Sizes in units of 0.0025 ETH (the 1/400 IMD->ETH calibration, so 1 unit = the old 1 IMD): log-normal around one
  // unit (sigma ~1.4 octaves), capped under the whale; about 1 in 120 swaps is a whale, 1..4x the FDV-scaled
  // threshold at the post-swap tick (SPEC §3.1: ~0.04 ETH at FDV 4 ETH).
  const whale = r() < 1 / 120;
  const size = whale ? 0 : Math.min(14, Math.exp(gauss() * 1.0));
  const k = whale ? 1 + r() * 3 : 0;
  // ~2 ETH of liquidity per side: 0.0025 ETH moves the price ~0.25% (~25 ticks); a whale ~0.1 ETH ~1000 ticks.
  const units = whale ? k * 16 : size;
  tick += Math.round((isBuy ? -1 : 1) * (r() * 10 + units * 25));
  const quoteAmt = whale ? (whaleWeiAtTick(tick) * BigInt(Math.round(k * 1000))) / 1000n : wei(size / 400);
  return { isBuy, quoteAmt, tick, blockNumber: BigInt(block), timestamp: ts };
}

let after = -1;
while (swaps.length < 20_000) {
  swaps.push(next());
  if (after >= 0 && --after === 0) break;
  if (after < 0 && swaps.length % 50 === 0) {
    const done = buildTimeline(swaps, undefined, "v2").entries.filter((e) => e.trackComplete).length;
    if (done >= TRACKS) {
      // Trim to the swap that completed track TRACKS, then add the start of the next track.
      const full = buildTimeline(swaps, undefined, "v2").entries;
      const at = full.findIndex((e) => e.trackComplete?.trackNo === TRACKS);
      swaps.length = at + 1;
      after = AFTER;
    }
  }
}

const { entries } = buildTimeline(swaps, undefined, "v2");
// Drop the decoded `state` copy and provenance the release never reads, to keep the committed file small.
// Synthetic swaps have no transactions: no txHash, block numbers are made up.
const slim = entries.map(({ state: _state, poolId: _pool, txHash: _tx, logIndex: _log, ...rest }) => rest);
writeFileSync(out, JSON.stringify(slim) + "\n");
const ends = entries.filter((e) => e.trackComplete);
console.log(`${out}: ${entries.length} swaps, tracks ${ends.map((e) => `#${e.trackComplete!.trackNo} ${e.trackComplete!.swaps} swaps`).join(", ")}`);
