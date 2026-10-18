// Real data for the genre sketches: the site's imd-week tape (?replay=imd-week) re-simulated under the v2 hook
// (core V2_RULES), exactly as the site does with &rules=v2, then mapped to audio time at the site's replay speed.
//   npx tsx web/scripts/genre-timeline.ts   → sim/genres/timelines/imd-week-v2.json (+ the chosen window)
// genre-sketches.mjs runs this first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, DEFAULT_DROP_RULES, initialDropState, initialRelativeState, mutate, V2_RULES, V2_SLOTS, type State } from "../../packages/core/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "sim/genres/timelines");
mkdirSync(outDir, { recursive: true });

/** site/src/config.ts REPLAYS["imd-week"].speed: virtual seconds per audio second. */
const SPEED = 840;
const WINDOW_SEC = 30;
const WHALE_WEI = 100n * 10n ** 18n;
const HEAT_MAX = DEFAULT_DROP_RULES.heatMax;

interface Row { ts: number; blockNumber: number; isBuy: boolean; imdAmt: string; tick: number }
const rows = JSON.parse(readFileSync(resolve(root, "site/public/timelines/imd-week.json"), "utf8")) as Row[];

const json = (s: State) => ({
  ...s,
  pattern: s.pattern.toString(),
  bass: s.bass.toString(),
  heat: Math.min(1, (s.heat ?? 0) / HEAT_MAX),
  trackNo: s.trackNo ?? 0,
});

let s: State = initialDropState(initialRelativeState());
const events = rows.map((r) => {
  const imdAmt = BigInt(r.imdAmt);
  const { state, event } = mutate(s, { isBuy: r.isBuy, imdAmt, tick: r.tick, blockNumber: BigInt(r.blockNumber), timestamp: r.ts }, undefined, V2_RULES);
  s = state;
  const tc = event.trackComplete;
  const whale = imdAmt >= WHALE_WEI;
  return {
    ts: r.ts,
    isBuy: r.isBuy,
    whale,
    track: event.track,
    state: json(state),
    ...(tc ? { held: json(decode(tc.slot0, tc.slot1, V2_SLOTS)) } : {}),
  };
});

// Pick a WINDOW_SEC window around a track drop (heat builds before it): the drop lands 10..22 s in, so the
// listener hears the build, the drop and what follows. Among those, the busiest with whales and mixed buys/sells.
const t0 = events[0].ts - 30;
const audio = (ts: number) => (ts - t0) / SPEED;
let best = { start: 0, score: -1, swaps: 0, drops: 0, whales: 0, buys: 0, dropAt: 0 };
for (const drop of events.filter((e) => e.held)) {
  for (let lead = 10; lead <= 22; lead += 0.5) {
    const start = audio(drop.ts) - lead;
    const inWin = events.filter((e) => audio(e.ts) >= start && audio(e.ts) < start + WINDOW_SEC);
    const whales = inWin.filter((e) => e.whale).length;
    const buys = inWin.filter((e) => e.isBuy).length;
    const mixed = Math.min(buys, inWin.length - buys);
    const score = inWin.length + 2 * mixed + 15 * whales;
    if (score > best.score) best = { start, score, swaps: inWin.length, drops: inWin.filter((e) => e.held).length, whales, buys, dropAt: audio(drop.ts) };
  }
}

const points = events.map((e) => ({ time: audio(e.ts), now: e.ts, isBuy: e.isBuy, whale: e.whale, track: e.track, state: e.state, ...(e.held ? { held: e.held } : {}) }));
writeFileSync(resolve(outDir, "imd-week-v2.json"), JSON.stringify({ speed: SPEED, t0, window: { ...best, seconds: WINDOW_SEC }, points }));
console.log(
  `imd-week v2: ${events.length} swaps, ${events.filter((e) => e.held).length} drops, ${events.filter((e) => e.whale).length} whales; ` +
    `window ${best.start.toFixed(1)}..${(best.start + WINDOW_SEC).toFixed(1)} s audio: ${best.swaps} swaps (${best.buys} buys), ${best.drops} drop(s) (at ${best.dropAt.toFixed(1)} s), ${best.whales} whale(s)`,
);
