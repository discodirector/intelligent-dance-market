// A/B bench for relative-to-market track tiers (prototype, core `mutate(..., { relative })`).
//   npx tsx web/scripts/relative-ab.ts      → comparison table + sim/stress/relative/timelines/*.timeline.json
// Then `node web/scripts/relative-render.mjs` renders the A/B WAVs into sim/stress/relative/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arrange, isOn, type SequencerState } from "../../packages/synth/src/index.ts";
import {
  DEFAULT_RELATIVE_TIERS,
  encode,
  initialRelativeState,
  initialState,
  INITIAL_RELATIVE_TIERS,
  mutate,
  type RelativeTiers,
  type State,
} from "../../packages/core/src/index.ts";

/** 1 IMD-equivalent at the ETH calibration (1/400): 0.0025 ETH in wei. */

const E = 10n ** 18n / 400n;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "sim/stress/relative/timelines");
mkdirSync(outDir, { recursive: true });

type Swap = { isBuy: boolean; quoteAmt: bigint; tick?: number; ts?: number; block?: bigint };

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

/** Log-normal size: median * 2^(sigma * z), sigma in octaves. */
function logNormal(r: () => number, median: number, sigma: number): bigint {
  const z = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  return BigInt(Math.round(median * 2 ** (sigma * z) * 1e9)) * 10n ** 9n / 400n; // IMD-equivalent median -> ETH wei
}

const repeat = (n: number, s: Swap): Swap[] => Array.from({ length: n }, () => ({ ...s }));

// Existing stress.ts scenarios, same sizes and seed.
const SIZE = { hat: E / 4n, glitch: 2n * E, snare: 10n * E, kick: 40n * E, whale: 160n * E };
const r7 = rng(7);
const SCENARIOS: Record<string, Swap[]> = {
  "50-small-buys": repeat(50, { isBuy: true, quoteAmt: SIZE.hat }),
  "50-snare-buys": repeat(50, { isBuy: true, quoteAmt: SIZE.snare }),
  "50-kick-buys": repeat(50, { isBuy: true, quoteAmt: SIZE.kick }),
  "50-glitch-buys": repeat(50, { isBuy: true, quoteAmt: SIZE.glitch }),
  "50-sells": repeat(50, { isBuy: false, quoteAmt: SIZE.snare }),
  "whales-only": Array.from({ length: 20 }, (_, i) => ({ isBuy: i % 3 !== 2, quoteAmt: SIZE.whale })),
  "same-tick-buys": repeat(50, { isBuy: true, quoteAmt: SIZE.snare, tick: 1200 }),
  "mixed-random": Array.from({ length: 60 }, () => ({
    isBuy: r7() < 0.6,
    quoteAmt: [SIZE.hat, SIZE.glitch, SIZE.snare, SIZE.kick][Math.floor(r7() * 4)],
  })),
};

const r11 = rng(11);
SCENARIOS["small-buys-varied"] = Array.from({ length: 200 }, () => ({ isBuy: true, quoteAmt: logNormal(r11, 0.3, 1.2) }));
const r13 = rng(13);
SCENARIOS["mixed-market-varied"] = Array.from({ length: 300 }, () => ({
  isBuy: r13() < 0.55,
  quoteAmt: r13() < 0.02 ? BigInt(120 + Math.floor(r13() * 200)) * E : logNormal(r13, 3, 1.6),
}));
SCENARIOS["dust-then-trade"] = [...repeat(100, { isBuy: false, quoteAmt: 10n ** 12n }), { isBuy: true, quoteAmt: 3n * E }];

// Real tape the site replays for ?replay=imd-week.
interface WeekEvent { ts: number; blockNumber: number; isBuy: boolean; quoteAmt: string; tick: number; slot0: string; slot1: string }
const week = JSON.parse(readFileSync(resolve(root, "site/public/timelines/imd-week.json"), "utf8")) as WeekEvent[];
SCENARIOS["imd-week"] = week.map((e) => ({ isBuy: e.isBuy, quoteAmt: BigInt(e.quoteAmt), tick: e.tick, ts: e.ts, block: BigInt(e.blockNumber) }));

type Model = { name: string; tiers: RelativeTiers | null };
const MODELS: Model[] = [
  { name: "abs", tiers: null },
  { name: "rel0", tiers: INITIAL_RELATIVE_TIERS },
  { name: "rel", tiers: DEFAULT_RELATIVE_TIERS },
];

const BAR = 16; // full section, as stress.ts
const RENDER_SWAPS = 240; // last swaps spread over the render window
const RENDER_SPAN = 20; // seconds

function groove(s: State): string {
  const a = arrange(s as SequencerState, BAR);
  return a.vel.map((row) => row.join(",")).join("|") + "|" + a.bass.toString(16);
}

const raw = (s: State) => [0, 1, 2, 3].map((t) => Array.from({ length: 16 }, (_, i) => isOn(s.pattern, t, i)).filter(Boolean).length);
const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(1, d))}`.padStart(3);

interface Row { scenario: string; model: string; n: number; pat: number[]; cls: number[]; whales: number; changes: number; lateChanges: number; kickEnd: boolean; kickFrac: number; last?: string; fixtureMatch?: boolean }
const rows: Row[] = [];

for (const [name, swaps] of Object.entries(SCENARIOS)) {
  for (const model of MODELS) {
    let state = model.tiers ? initialRelativeState() : initialState();
    let ts = 1_760_000_000;
    let block = 21_000_000n;
    const cls = [0, 0, 0, 0];
    let whales = 0, changes = 0, lateChanges = 0, kickSwaps = 0;
    let fixtureMatch = name === "imd-week" && !model.tiers ? true : undefined;
    let prevGroove = groove(state);
    let lastTrack = "";
    const preroll = Math.max(0, swaps.length - RENDER_SWAPS);
    const spacing = RENDER_SPAN / Math.min(swaps.length, RENDER_SWAPS);
    const events: Record<string, unknown>[] = [];
    const push = (s0: bigint, s1: bigint, t: number, drop?: unknown) =>
      events.push({ slot0: "0x" + s0.toString(16), slot1: "0x" + s1.toString(16), timestamp: Number(t.toFixed(3)), ...(drop ? { drop } : {}) });
    if (preroll === 0) push(...slotsOf(state, !!model.tiers), 0);

    swaps.forEach((swap, i) => {
      ts = swap.ts ?? ts + 6;
      block = swap.block ?? block + 1n;
      const next = mutate(
        state,
        { isBuy: swap.isBuy, quoteAmt: swap.quoteAmt, tick: swap.tick ?? 600 + ((i * 397) % 2400), blockNumber: block, timestamp: ts },
        undefined,
        model.tiers ? { relative: model.tiers } : undefined,
      );
      state = next.state;
      const e = next.event;
      if (e.whale) whales++;
      else cls[e.track]++;
      lastTrack = e.whale ? "whale" : ["kick", "snare", "hat", "glitch"][e.track];
      // The tape predates the whale-drop rule, so only non-whale classification is comparable.
      if (fixtureMatch && !e.whale && (week[i] as unknown as { track: number }).track !== e.track) fixtureMatch = false;
      const g = groove(state);
      if (g !== prevGroove) {
        changes++;
        if (i >= swaps.length / 2) lateChanges++;
      }
      prevGroove = g;
      if (raw(state)[0] > 0) kickSwaps++;
      if (i + 1 === preroll) push(e.slot0, e.slot1, 0);
      else if (i + 1 > preroll) push(e.slot0, e.slot1, (i + 1 - preroll) * spacing, e.drop);
    });
    writeFileSync(resolve(outDir, `${name}-${model.name}.timeline.json`), JSON.stringify(events) + "\n");
    const pat = raw(state);
    rows.push({
      scenario: name, model: model.name, n: swaps.length, pat, cls, whales, changes, lateChanges,
      kickEnd: arrange(state as SequencerState, BAR).vel[0].some((v) => v > 0),
      kickFrac: kickSwaps / swaps.length,
      last: name === "dust-then-trade" ? lastTrack : undefined,
      fixtureMatch,
    });
  }
}

function slotsOf(s: State, relative: boolean): [bigint, bigint] {
  const { slot0, slot1 } = encode(s, relative ? { relative: true } : undefined);
  return [slot0, slot1];
}

console.log("pattern = hits per row after N swaps (k/s/h/g); classified = % of non-whale swaps per track (k/s/h/g) + whale count;");
console.log("groove Δ = swaps that changed arrange(state, bar 16) (all / second half); kick = kick plays at the end, % of swaps with kick row non-empty");
console.log("models: abs = current absolute thresholds, rel0 = brief's initial tiers (-16/+9/+32), rel = tuned tiers (-8/+10/+25)\n");
console.log("scenario             model   N    pattern k/s/h/g   classified k/s/h/g  wh  groove Δ   kick");
for (const r of rows) {
  const tot = r.cls.reduce((a, b) => a + b, 0);
  const pat = r.pat.map((v) => String(v).padStart(2)).join("/");
  const cls = r.cls.map((v) => pct(v, tot)).join("/");
  const extra = [r.last ? `final 3 IMD-eq (0.0075 ETH) buy → ${r.last}` : "", r.fixtureMatch != null ? `non-whale tracks ${r.fixtureMatch ? "match" : "DIFFER from"} tape` : ""].filter(Boolean).join("  ");
  console.log(
    `${r.scenario.padEnd(20)} ${r.model.padEnd(5)} ${String(r.n).padStart(4)}   ${pat}    ${cls}  ${String(r.whales).padStart(3)}  ${String(r.changes).padStart(4)}/${String(r.lateChanges).padEnd(4)}  ${r.kickEnd ? "yes" : "NO "} ${pct(r.kickFrac * 100, 100)}%  ${extra}`,
  );
}
writeFileSync(resolve(root, "sim/stress/relative/results.json"), JSON.stringify(rows, null, 1) + "\n");
