// A/B bench for the accumulation rule (prototype, core `mutate(..., { accumulate, relative })`).
//   npx tsx web/scripts/accumulate-ab.ts            → 4-variant table {abs, rel, abs+acc, rel+acc}
//                                                    + sim/stress/accumulate/timelines/*.timeline.json + results.json
//   npx tsx web/scripts/accumulate-ab.ts --explore  → rule grid (buy fallback × sell rule) used to pick the defaults
// Then `node web/scripts/accumulate-render.mjs` renders the rel / rel+acc WAVs into sim/stress/accumulate/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arrange, isOn, type SequencerState } from "../../packages/synth/src/index.ts";
import {
  DEFAULT_ACCUMULATE_RULES,
  encode,
  initialRelativeState,
  initialState,
  mutate,
  type AccumulateRules,
  type MutateOptions,
  type State,
} from "../../packages/core/src/index.ts";

/** 1 IMD-equivalent at the ETH calibration (1/400): 0.0025 ETH in wei. */

const E = 10n ** 18n / 400n;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "sim/stress/accumulate/timelines");
mkdirSync(outDir, { recursive: true });
const EXPLORE = process.argv.includes("--explore");

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

// Same scenarios (sizes, seeds) as relative-ab.ts, plus the two accumulation stress cases.
const SIZE = { hat: E / 4n, glitch: 2n * E, snare: 10n * E, kick: 40n * E, whale: 160n * E };
const r7 = rng(7);
const SCENARIOS: Record<string, Swap[]> = {
  "50-small-buys": repeat(50, { isBuy: true, quoteAmt: SIZE.hat }),
  "identical-spam-200": repeat(200, { isBuy: true, quoteAmt: SIZE.hat }),
  "buy-sell-churn": Array.from({ length: 200 }, (_, i) => ({ isBuy: i % 2 === 0, quoteAmt: SIZE.glitch })),
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

interface WeekEvent { ts: number; blockNumber: number; isBuy: boolean; quoteAmt: string; tick: number }
const week = JSON.parse(readFileSync(resolve(root, "site/public/timelines/imd-week.json"), "utf8")) as WeekEvent[];
SCENARIOS["imd-week"] = week.map((e) => ({ isBuy: e.isBuy, quoteAmt: BigInt(e.quoteAmt), tick: e.tick, ts: e.ts, block: BigInt(e.blockNumber) }));

type Variant = { name: string; opts?: MutateOptions };
const VARIANTS: Variant[] = [
  { name: "abs" },
  { name: "rel", opts: { relative: true } },
  { name: "abs+acc", opts: { accumulate: true } },
  { name: "rel+acc", opts: { relative: true, accumulate: true } },
];

const BAR = 16; // full section, as stress.ts
const STEPS = 16;
const RENDER_SWAPS = 240;
const RENDER_SPAN = 20; // seconds

const drums = (s: State) => arrange(s as SequencerState, BAR).vel.map((row) => row.join(",")).join("|");
const groove = (s: State) => drums(s) + "|" + arrange(s as SequencerState, BAR).bass.toString(16);
const raw = (s: State) => [0, 1, 2, 3].map((t) => Array.from({ length: STEPS }, (_, i) => isOn(s.pattern, t, i)).filter(Boolean).length);
const played = (s: State) => arrange(s as SequencerState, BAR).vel.map((row) => row.filter((v) => v > 0).length);

/** The stress.ts musical rules, across the whole 32-bar form. */
function check(s: SequencerState): string[] {
  const bad: string[] = [];
  for (let bar = 0; bar < 32; bar++) {
    const a = arrange(s, bar);
    const n = a.vel.map((row) => row.filter((v) => v > 0).length);
    // A 6-hit figure without step 14 plus the fill-bar pickup gives 7: a pre-existing arrange() edge, tagged apart.
    if (n[0] > 6) bad.push(n[0] === 7 && bar % 4 === 3 && a.vel[0][14] === 0.7 ? "kick 7 hits (fill pickup)" : `kick ${n[0]} hits`);
    if (n[0] > 0 && a.vel[0][0] === 0) bad.push("kick without downbeat");
    if (n[1] > 0 && (a.vel[1][4] === 0 || a.vel[1][12] === 0)) bad.push("snare without backbeat");
    if (n[1] - (bar % 4 === 3 ? 3 : 0) > 6) bad.push(`snare ${n[1]} hits`);
    if (n[2] > 12) bad.push(`hat ${n[2]} hits`);
    if (n[3] > 3) bad.push(`glitch ${n[3]} hits`);
    let run = 0;
    for (let i = 0; i < STEPS * 2; i++) {
      run = a.vel[1][i % STEPS] >= 0.9 ? run + 1 : 0;
      if (run > 1) bad.push("two full snares in a row");
    }
    // Machine gun: three or more kicks on consecutive 16ths.
    let k = 0;
    for (let i = 0; i < STEPS * 2; i++) {
      k = a.vel[0][i % STEPS] > 0 ? k + 1 : 0;
      if (k > 2) bad.push("kick machine gun");
    }
    const notes = Array.from({ length: STEPS }, (_, i) => Number((a.bass >> BigInt(i * 4)) & 0xfn)).filter((d) => d > 0);
    if (notes.length > 6) bad.push(`bass ${notes.length} notes`);
  }
  return [...new Set(bad)];
}

interface Row {
  scenario: string; variant: string; n: number;
  pat: number[]; play: number[];
  grooveChanges: number; drumChanges: number;
  /** 1-based swap after which arranged drums never change again; null = still changing in the last 10% (never saturates). */
  saturation: number | null;
  /** Non-whale swaps that left the pattern unchanged. */
  noops: number; promoted: number; nonWhale: number;
  kickEnd: boolean; kickFrac: number; maxKick: number; problems: string[];
}

function run(name: string, swaps: Swap[], v: Variant, timeline: boolean, musical: boolean): Row {
  let state = v.opts?.relative ? initialRelativeState() : initialState();
  let ts = 1_760_000_000;
  let block = 21_000_000n;
  let grooveChanges = 0, drumChanges = 0, lastDrumChange = 0, noops = 0, promoted = 0, nonWhale = 0, kickSwaps = 0, maxKick = 0;
  let prevGroove = groove(state), prevDrums = drums(state);
  const problems = new Set<string>();
  const preroll = Math.max(0, swaps.length - RENDER_SWAPS);
  const spacing = RENDER_SPAN / Math.min(swaps.length, RENDER_SWAPS);
  const events: Record<string, unknown>[] = [];
  const push = (s0: bigint, s1: bigint, t: number, drop?: unknown) =>
    events.push({ slot0: "0x" + s0.toString(16), slot1: "0x" + s1.toString(16), timestamp: Number(t.toFixed(3)), ...(drop ? { drop } : {}) });
  if (preroll === 0) {
    const { slot0, slot1 } = encode(state, v.opts?.relative ? { relative: true } : undefined);
    push(slot0, slot1, 0);
  }

  swaps.forEach((swap, i) => {
    ts = swap.ts ?? ts + 6;
    block = swap.block ?? block + 1n;
    const prevPattern = state.pattern;
    const next = mutate(
      state,
      { isBuy: swap.isBuy, quoteAmt: swap.quoteAmt, tick: swap.tick ?? 600 + ((i * 397) % 2400), blockNumber: block, timestamp: ts },
      undefined,
      v.opts,
    );
    state = next.state;
    const e = next.event;
    if (!e.whale) {
      nonWhale++;
      if (state.pattern === prevPattern) noops++;
      if (e.promoted) promoted++;
    }
    const g = groove(state), d = drums(state);
    if (g !== prevGroove) grooveChanges++;
    if (d !== prevDrums) { drumChanges++; lastDrumChange = i + 1; }
    prevGroove = g; prevDrums = d;
    const p = played(state);
    if (raw(state)[0] > 0) kickSwaps++;
    maxKick = Math.max(maxKick, p[0]);
    if (musical) for (const x of check(state as SequencerState)) problems.add(x);
    if (timeline) {
      if (i + 1 === preroll) push(e.slot0, e.slot1, 0);
      else if (i + 1 > preroll) push(e.slot0, e.slot1, (i + 1 - preroll) * spacing, e.drop);
    }
  });
  if (timeline) writeFileSync(resolve(outDir, `${name}-${v.name}.timeline.json`), JSON.stringify(events) + "\n");
  const n = swaps.length;
  return {
    scenario: name, variant: v.name, n, pat: raw(state), play: played(state), grooveChanges, drumChanges,
    saturation: lastDrumChange > n - Math.max(1, Math.ceil(n / 10)) ? null : lastDrumChange,
    noops, promoted, nonWhale,
    kickEnd: played(state)[0] > 0, kickFrac: kickSwaps / n, maxKick, problems: [...problems],
  };
}

const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}`.padStart(3) + "%";
const sat = (r: Row) => (r.saturation == null ? "never" : String(r.saturation)).padStart(5);
const four = (a: number[]) => a.map((v) => String(v).padStart(2)).join("/");

if (EXPLORE) {
  const fallbacks = (process.env.FB ?? "none,spill,scan").split(",") as AccumulateRules["buyFallback"][];
  const sellFbs = (process.env.SFB ?? "none,scan").split(",");
  const sells = (process.env.SELL ?? "up,upAll,down,near,top").split(",") as AccumulateRules["sell"][];
  const keys = ["50-small-buys", "identical-spam-200", "buy-sell-churn", "50-sells", "small-buys-varied", "mixed-market-varied", "imd-week"];
  console.log("rule (buyFb/sell/sellFb)   scenario             pattern k/s/h/g  drumΔ   sat  noop  kick-end kick%");
  for (const fb of fallbacks) for (const sfb of sellFbs) for (const sell of sells) {
    const rules: AccumulateRules = { buyFallback: fb, sell, sellFallback: sfb === "same" ? fb : (sfb as AccumulateRules["sellFallback"]) };
    for (const k of keys) {
      const r = run(k, SCENARIOS[k], { name: "x", opts: { relative: true, accumulate: rules } }, false, false);
      console.log(`${`${fb}/${sell}/${rules.sellFallback}`.padEnd(26)} ${k.padEnd(20)} ${four(r.pat)}      ${pct(r.drumChanges, r.n)} ${sat(r)} ${pct(r.noops, r.nonWhale)}  ${r.kickEnd ? "yes" : "NO "}     ${pct(r.kickFrac, 1)}`);
    }
    console.log("");
  }
  process.exit(0);
}

const RENDERED = new Set(["50-small-buys", "identical-spam-200", "small-buys-varied", "imd-week"]);
const rows: Row[] = [];
for (const [name, swaps] of Object.entries(SCENARIOS)) {
  for (const v of VARIANTS) rows.push(run(name, swaps, v, RENDERED.has(name) && v.name.startsWith("rel"), true));
}

console.log(`accumulate rules: ${JSON.stringify(DEFAULT_ACCUMULATE_RULES)}`);
console.log("pattern = raw hits per row at the end (k/s/h/g); played = hits arrange() plays in bar 16 (k/s/h/g);");
console.log("grooveΔ = % swaps that changed arrange(state, 16) incl. bass; drumΔ = same, drums only; sat = swap after which the");
console.log("arranged drums never change again (never = still changing in the last 10%); noop = % non-whale swaps that changed no bit;");
console.log("kick = kick plays at the end / % swaps with a kick row; musical = stress.ts rules + no kick machine gun, every state × 32 bars\n");
console.log("scenario             variant     N  pattern k/s/h/g  played k/s/h/g  grooveΔ drumΔ   sat  noop  kick       musical");
const EDGE = "kick 7 hits (fill pickup)";
let failures = 0, edges = 0;
for (const r of rows) {
  if (r.problems.some((p) => p !== EDGE)) failures++;
  else if (r.problems.length) edges++;
  console.log(
    `${r.scenario.padEnd(20)} ${r.variant.padEnd(8)} ${String(r.n).padStart(4)}  ${four(r.pat)}      ${four(r.play)}     ${pct(r.grooveChanges, r.n)}  ${pct(r.drumChanges, r.n)} ${sat(r)} ${pct(r.noops, r.nonWhale)}  ${r.kickEnd ? "yes" : "NO "} ${pct(r.kickFrac, 1)}  ${r.problems.length ? "FAIL " + r.problems.join(", ") : "ok"}`,
  );
}
writeFileSync(resolve(root, "sim/stress/accumulate/results.json"), JSON.stringify(rows, null, 1) + "\n");
console.log(`\n${failures ? `${failures} run(s) broke a musical rule` : "no run broke a musical rule (no machine gun)"}; ${edges} run(s) only hit the pre-existing "${EDGE}" edge`);
