// A/B bench for heat -> drop (prototype, core `mutate(..., { relative, accumulate, drop })`).
//   npx tsx web/scripts/drop-ab.ts            → seed check + grid table (satBits × heatMax, coolSec 120) + alternatives
//                                              + cadence table (steady 80% buy flow at 1..90-min gaps: gap vs clock vs silence)
//                                              + sim/stress/drop/timelines/*.timeline.json + results.json
//   npx tsx web/scripts/drop-ab.ts --quick    → grid only, no musical check per state (fast)
// Base = rel+acc. Timelines for the recommended rules (DEFAULT_DROP_RULES) feed `node web/scripts/drop-render.mjs`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arrange, type SequencerState } from "../../packages/synth/src/index.ts";
import {
  coolHeat,
  DEFAULT_DROP_RULES,
  dropSeed,
  encode,
  initialDropState,
  initialRelativeState,
  isOn,
  mutate,
  popcount64,
  SEED_KICKS,
  SEED_SNARES,
  SILENCE_RESET_SEC,
  euclidMask,
  type DropRules,
  type MutateOptions,
  type State,
} from "../../packages/core/src/index.ts";

/** 1 IMD-equivalent at the ETH calibration (1/400): 0.0025 ETH in wei. */

const E = 10n ** 18n / 400n;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "sim/stress/drop");
const tlDir = resolve(outDir, "timelines");
mkdirSync(tlDir, { recursive: true });
const QUICK = process.argv.includes("--quick");

type Swap = { isBuy: boolean; quoteAmt: bigint; tick?: number; ts?: number; block?: bigint; gap?: number };

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

// Same generators and seeds as accumulate-ab.ts; small-buys-varied is extended to 600 swaps (its first 200 are identical).
const SIZE = { hat: E / 4n, glitch: 2n * E };
const SCENARIOS: Record<string, Swap[]> = {
  "identical-spam-200": repeat(200, { isBuy: true, quoteAmt: SIZE.hat }),
};
const r11 = rng(11);
SCENARIOS["small-buys-varied"] = Array.from({ length: 600 }, () => ({ isBuy: true, quoteAmt: logNormal(r11, 0.3, 1.2) }));
const r13 = rng(13);
SCENARIOS["mixed-market-varied"] = Array.from({ length: 300 }, () => ({
  isBuy: r13() < 0.55,
  quoteAmt: r13() < 0.02 ? BigInt(120 + Math.floor(r13() * 200)) * E : logNormal(r13, 3, 1.6),
}));
SCENARIOS["buy-sell-churn"] = Array.from({ length: 200 }, (_, i) => ({ isBuy: i % 2 === 0, quoteAmt: SIZE.glitch }));
// Buy-heavy market (70/30) of small varied sizes: the realistic case for drops.
const r19 = rng(19);
SCENARIOS["buy-heavy-varied"] = Array.from({ length: 600 }, () => ({ isBuy: r19() < 0.7, quoteAmt: logNormal(r19, 0.3, 1.2) }));
interface WeekEvent { ts: number; blockNumber: number; isBuy: boolean; quoteAmt: string; tick: number }
const week = JSON.parse(readFileSync(resolve(root, "site/public/timelines/imd-week.json"), "utf8")) as WeekEvent[];
SCENARIOS["imd-week"] = week.map((e) => ({ isBuy: e.isBuy, quoteAmt: BigInt(e.quoteAmt), tick: e.tick, ts: e.ts, block: BigInt(e.blockNumber) }));
// burst-then-silence is adaptive (see burst()): small varied buys every 6 s until heat = heatMax - 1, a 30-minute gap, 150 more buys.
const BURST = "burst-then-silence";
const r17 = rng(17);
const BURST_SWAPS = Array.from({ length: 1000 }, () => ({ isBuy: true, quoteAmt: logNormal(r17, 0.3, 1.2) }));
const BURST_GAP = 1800;
const BURST_AFTER = 150;
const BURST_BASE_LEN = 200; // base variant (no heat): fixed burst length

// Cadence: one steady buy-heavy flow (80% buys, small varied sizes, 600 swaps), replayed at fixed mean gaps.
// Same swaps in every cadence; only the clock changes. Gaps jitter ±25% around the mean (deterministic).
const CADENCE_MIN = [1, 5, 10, 30, 60, 90];
const CADENCE_N = 600;
const r23 = rng(23);
const CADENCE_FLOW = Array.from({ length: CADENCE_N }, () => ({ isBuy: r23() < 0.8, quoteAmt: logNormal(r23, 0.3, 1.2) }));
const r29 = rng(29);
const CADENCE_JITTER = Array.from({ length: CADENCE_N }, () => 0.75 + 0.5 * r29());
const cadenceKey = (m: number) => `cadence-${m}m`;
for (const m of CADENCE_MIN) SCENARIOS[cadenceKey(m)] = CADENCE_FLOW.map((x, i) => ({ ...x, gap: Math.round(m * 60 * CADENCE_JITTER[i]) }));

const BAR = 16;
const STEPS = 16;
const drums = (s: State) => arrange(s as SequencerState, BAR).vel.map((row) => row.join(",")).join("|");
const groove = (s: State) => drums(s) + "|" + arrange(s as SequencerState, BAR).bass.toString(16);

/** The stress.ts musical rules (+ no kick machine gun), across the whole 32-bar form. Same as accumulate-ab.ts. */
function check(s: SequencerState): string[] {
  const bad: string[] = [];
  for (let bar = 0; bar < 32; bar++) {
    const a = arrange(s, bar);
    const n = a.vel.map((row) => row.filter((v) => v > 0).length);
    if (n[0] > 6) bad.push(`kick ${n[0]} hits`);
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

/** Every seed of the set, with a full and with a thinned bass, must pass check(). Also: raw kick has step 0, snare has 4/12. */
function checkSeeds(): { seeds: number; bad: string[] } {
  const bad: string[] = [];
  let seeds = 0;
  const base = initialRelativeState();
  const basses = [0x123456789abcdef1n, 0x0005000300070001n];
  for (const k of SEED_KICKS) for (const sn of SEED_SNARES) for (let hk = 3; hk <= 6; hk++) for (let rot = 0; rot < 16; rot++) {
    for (let g = -1; g < 16; g++) {
      seeds++;
      const pattern = BigInt(k) | (BigInt(sn) << 16n) | (BigInt(euclidMask(hk, rot)) << 32n) | (g < 0 ? 0n : 1n << BigInt(48 + g));
      if (!(k & 1) || (sn & 0x1010) !== 0x1010) bad.push(`seed ${pattern.toString(16)} raw anchors`);
      for (const bass of basses) for (const patternId of [0, 5, 17]) {
        const p = check({ ...base, pattern, bass, patternId } as SequencerState);
        if (p.length) bad.push(`seed 0x${pattern.toString(16)}: ${p.join(", ")}`);
      }
    }
  }
  return { seeds, bad };
}

type Variant = { name: string; rules?: DropRules };
const BASE_OPTS: MutateOptions = { relative: true, accumulate: true };

interface Row {
  scenario: string; variant: string; n: number;
  drops: number; dropAt: number[];
  /** Unix seconds of each drop swap, and of the first swap. */
  dropTs: number[]; firstTs: number;
  noops: number; nonWhale: number; grooveChanges: number;
  /** Longest run of consecutive swaps with no change to the arranged groove. */
  frozen: number;
  heatTime: number; totalTime: number; maxHeat: number;
  /** Swaps with popcount(pattern) >= satBits (or >= 56 for the base), i.e. a saturated grid. */
  saturated: number;
  burst?: { len: number; heatBefore: number; heatAfter: number };
  /** Swap index (0-based) whose gap was replaced by the render lull. */
  lullAt?: number;
  /** Swap index (1-based) of the first maximum of heat. */
  maxHeatAt: number;
  problems: string[];
}

type TimelineOpts = {
  file: string; window?: [number, number]; spacing?: number;
  /** Audio seconds per virtual second: events carry `now` (virtual unix s) so the render runs the idle stages. */
  compress?: number;
};

function run(name: string, v: Variant, opts: { musical: boolean; timeline?: TimelineOpts; lull?: { atHeat: number; gap: number } }): Row {
  const dr = v.rules;
  const mopts: MutateOptions = dr ? { ...BASE_OPTS, drop: dr } : BASE_OPTS;
  const slotOpts = { relative: true, drop: !!dr };
  let state: State = dr ? initialDropState(initialRelativeState()) : initialRelativeState();
  let ts = 1_760_000_000;
  let block = 21_000_000n;
  let prevGroove = groove(state);
  let grooveChanges = 0, noops = 0, nonWhale = 0, frozen = 0, run0 = 0, heatTime = 0, maxHeat = 0, saturated = 0;
  const dropAt: number[] = [];
  const dropTs: number[] = [];
  let firstTs = 0;
  let lullAt = -1;
  const problems = new Set<string>();
  const events: Record<string, unknown>[] = [];
  const sat = dr?.satBits ?? 56;
  let burst: Row["burst"];

  // Scenario source. burst-then-silence is driven by the state's heat.
  const isBurst = name === BURST;
  const fixed = isBurst ? null : SCENARIOS[name];
  let phase = 0, burstLen = 0, after = 0, bi = 0;
  const next = (): Swap | null => {
    if (fixed) return bi < fixed.length ? fixed[bi++] : null;
    if (phase === 0) {
      const done = dr ? (state.heat ?? 0) >= dr.heatMax - 1 : burstLen >= BURST_BASE_LEN;
      if (!done && bi < BURST_SWAPS.length - BURST_AFTER) { burstLen++; return BURST_SWAPS[bi++]; }
      phase = 1;
      burst = { len: burstLen, heatBefore: state.heat ?? 0, heatAfter: 0 };
      return { ...BURST_SWAPS[bi++], gap: BURST_GAP };
    }
    return after++ < BURST_AFTER - 1 ? BURST_SWAPS[bi++] : null;
  };

  const all: { s0: bigint; s1: bigint; heat: number; ts: number; tc?: unknown; whaleDrop?: unknown }[] = [];
  const { slot0, slot1 } = encode(state, slotOpts);
  all.push({ s0: slot0, s1: slot1, heat: 0, ts });
  let i = 0;
  for (let swap = next(); swap; swap = next(), i++) {
    const prevTs = ts;
    // Optional render lull: the first time heat reaches atHeat, the next gap is replaced by a long one.
    const lullNow = !!opts.lull && lullAt < 0 && (state.heat ?? 0) >= opts.lull.atHeat;
    if (lullNow) lullAt = i;
    ts = swap.ts ?? ts + (lullNow ? opts.lull!.gap : swap.gap ?? 6);
    if (i === 0) firstTs = ts;
    block = swap.block ?? block + 1n;
    if (i > 0) {
      const dt = Math.max(0, ts - prevTs);
      // Time with heat > 0 inside the gap. "clock" mode loses a point at each coolSec boundary instead;
      // "silence" keeps it until SILENCE_RESET_SEC of silence.
      if (dr) {
        const h = state.heat ?? 0;
        heatTime += !h
          ? 0
          : dr.coolMode === "silence"
            ? Math.min(dt, SILENCE_RESET_SEC)
            : dr.coolMode === "clock"
              ? Math.min(ts, (Math.floor(prevTs / dr.coolSec) + h) * dr.coolSec) - prevTs
              : Math.min(dt, h * dr.coolSec);
      }
    }
    const prevPattern = state.pattern;
    const res = mutate(
      state,
      { isBuy: swap.isBuy, quoteAmt: swap.quoteAmt, tick: swap.tick ?? 600 + ((i * 397) % 2400), blockNumber: block, timestamp: ts },
      undefined,
      mopts,
    );
    if (burst && swap.gap && dr) burst.heatAfter = coolHeat(state.heat ?? 0, prevTs, ts, dr);
    state = res.state;
    const e = res.event;
    if (!e.whale) {
      nonWhale++;
      if (state.pattern === prevPattern) noops++;
    }
    if (e.trackComplete) { dropAt.push(i + 1); dropTs.push(ts); }
    maxHeat = Math.max(maxHeat, e.trackComplete ? dr!.heatMax : state.heat ?? 0);
    if (popcount64(prevPattern) >= sat) saturated++;
    const g = groove(state);
    if (g !== prevGroove) { grooveChanges++; run0 = 0; } else frozen = Math.max(frozen, ++run0);
    prevGroove = g;
    if (opts.musical) for (const x of check(state as SequencerState)) problems.add(x);
    all.push({ s0: e.slot0, s1: e.slot1, heat: e.trackComplete ? dr!.heatMax : state.heat ?? 0, ts, tc: e.trackComplete, whaleDrop: e.drop });
  }
  const n = i;
  const totalTime = Math.max(1, ts - firstTs);

  if (opts.timeline) {
    const [a, b] = opts.timeline.window ?? [Math.max(0, n - 240), n];
    const spacing = opts.timeline.spacing ?? 20 / Math.max(1, b - a);
    const cmp = opts.timeline.compress;
    for (let k = a; k <= b; k++) {
      const x = all[k];
      const tc = x.tc as { slot0: bigint; slot1: bigint; trackNo: number } | undefined;
      events.push({
        slot0: "0x" + x.s0.toString(16),
        slot1: "0x" + x.s1.toString(16),
        timestamp: Number((cmp ? (x.ts - all[a].ts) * cmp : (k - a) * spacing).toFixed(3)),
        ...(cmp ? { now: x.ts } : {}),
        ...(x.whaleDrop && k > a ? { drop: x.whaleDrop } : {}),
        ...(tc && k > a ? { trackComplete: { trackNo: tc.trackNo, slot0: "0x" + tc.slot0.toString(16), slot1: "0x" + tc.slot1.toString(16) } } : {}),
      });
    }
    writeFileSync(resolve(tlDir, opts.timeline.file), JSON.stringify({ heatMax: dr?.heatMax ?? 0, swaps: [a, b], ...(lullAt >= 0 ? { lullAt } : {}), events }) + "\n");
  }

  return {
    scenario: name, variant: v.name, n, drops: dropAt.length, dropAt, dropTs, firstTs, noops, nonWhale, grooveChanges, frozen,
    heatTime, totalTime, maxHeat, saturated, burst, ...(lullAt >= 0 ? { lullAt } : {}), maxHeatAt: all.findIndex((x) => x.heat === maxHeat), problems: [...problems],
  };
}

const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}`.padStart(3) + "%";
const gaps = (r: Row) => {
  if (!r.dropAt.length) return "-".padStart(11);
  const d = r.dropAt.map((x, i) => x - (i ? r.dropAt[i - 1] : 0));
  return `${d[0]}/${d.length > 1 ? Math.round(d.slice(1).reduce((p, c) => p + c, 0) / (d.length - 1)) : "-"}`.padStart(11);
};
const label = (r: DropRules) =>
  `sat${r.satBits}/h${r.heatMax}/${r.coolMode === "silence" ? "sil" : `c${r.coolSec}`}${r.sellCool !== 1 ? `/s${r.sellCool}` : ""}${r.noopHeat ? "+n" : ""}${r.coolMode === "clock" ? "/clock" : ""}`;

const KEYS = ["identical-spam-200", "small-buys-varied", "buy-heavy-varied", "mixed-market-varied", "buy-sell-churn", "imd-week", BURST];
const GRID: DropRules[] = [];
for (const satBits of [44, 48, 52, 56, 60]) for (const heatMax of [8, 16, 24]) GRID.push({ satBits, heatMax, coolSec: 120, sellCool: 1 });
// The previous default (gap cooling, coolSec 120) and its clock variant, for comparison with silence.
const GAP120: DropRules = { ...DEFAULT_DROP_RULES, coolSec: 120, coolMode: "gap" };
const CLOCK120: DropRules = { ...GAP120, coolMode: "clock" };
const ALT: DropRules[] = [
  DEFAULT_DROP_RULES,
  { ...DEFAULT_DROP_RULES, satBits: 48 }, // the previous default
  GAP120,
  CLOCK120,
  { ...GAP120, coolSec: 60 },
  { ...GAP120, coolSec: 300 },
  { ...DEFAULT_DROP_RULES, sellCool: 0 },
  { ...DEFAULT_DROP_RULES, noopHeat: !DEFAULT_DROP_RULES.noopHeat },
];
const MODES: DropRules[] = [GAP120, CLOCK120, DEFAULT_DROP_RULES];

if (!QUICK) {
  const t0 = Date.now();
  const s = checkSeeds();
  console.log(`seed set: ${s.seeds} seeds (6 kick × 4 snare × 4 hat k × 16 rot × 17 glitch), × 2 basses × 3 pages, 32 bars each: ${s.bad.length ? `${s.bad.length} FAIL, e.g. ${s.bad[0]}` : "all pass"} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
}

console.log("drops = track drops; gap = swaps to the 1st drop / mean swaps between later drops; noop = % non-whale swaps that changed no bit;");
console.log("grooveΔ = % swaps that changed arrange(state, 16) incl. bass; frozen = longest run of swaps with no groove change;");
console.log("sat = % swaps that arrived on a grid with popcount >= satBits; heat>0 = % of wall time with heat > 0 (lazy cooling, exact);");
console.log(`musical = stress.ts rules + no kick machine gun on every state × 32 bars${QUICK ? " (skipped: --quick)" : ""}; burst = buys to heatMax-1 → heat after the 30-min gap\n`);
console.log("scenario             variant              N  drops         gap  noop grooveΔ frozen   sat heat>0 maxH  musical");
const rows: Row[] = [];
const print = (r: Row) => {
  const extra = r.burst ? `  burst ${r.burst.len} swaps, heat ${r.burst.heatBefore} → ${r.burst.heatAfter} after 30 min` : "";
  console.log(
    `${r.scenario.padEnd(20)} ${r.variant.padEnd(18)} ${String(r.n).padStart(4)} ${String(r.drops).padStart(5)} ${gaps(r)} ${pct(r.noops, r.nonWhale)}   ${pct(r.grooveChanges, r.n)} ${String(r.frozen).padStart(6)} ${pct(r.saturated, r.n)}  ${pct(r.heatTime, r.totalTime)} ${String(r.maxHeat).padStart(4)}  ${r.problems.length ? "FAIL " + r.problems.join(", ") : QUICK ? "-" : "ok"}${extra}`,
  );
};
for (const k of KEYS) {
  const variants: Variant[] = [{ name: "rel+acc" }, ...GRID.map((r) => ({ name: label(r), rules: r }))];
  for (const v of variants) {
    const r = run(k, v, { musical: !QUICK });
    rows.push(r);
    print(r);
  }
  console.log("");
}
console.log(`alternatives around the recommended ${label(DEFAULT_DROP_RULES)} (silence cooling; gap/clock cooling at 120 s, gap at 60 / 300 s, sells do not cool, noopHeat toggled):`);
for (const k of KEYS) {
  for (const rules of ALT) {
    const r = run(k, { name: label(rules), rules }, { musical: !QUICK });
    rows.push(r);
    print(r);
  }
}

// Cadence: does the swarm finish a track regardless of speed? gap(120) vs clock(120) vs silence.
const hrs = (sec: number) => (sec / 3600 < 10 ? (sec / 3600).toFixed(1) : String(Math.round(sec / 3600)));
const timing = (r: Row) => {
  if (!r.dropTs.length) return { swaps: "-", hours: "-" };
  const ds = r.dropAt.map((x, i) => x - (i ? r.dropAt[i - 1] : 0));
  const dt = r.dropTs.map((x, i) => x - (i ? r.dropTs[i - 1] : r.firstTs));
  const mean = (a: number[]) => a.slice(1).reduce((p, c) => p + c, 0) / (a.length - 1);
  return {
    swaps: `${ds[0]}/${ds.length > 1 ? Math.round(mean(ds)) : "-"}`,
    hours: `${hrs(dt[0])}/${dt.length > 1 ? hrs(mean(dt)) : "-"}`,
  };
};
const CADENCE_KEYS = [...CADENCE_MIN.map(cadenceKey), "imd-week", "small-buys-varied", "buy-heavy-varied", "mixed-market-varied", "buy-sell-churn", "identical-spam-200", BURST];
console.log(`\ncadence: one steady flow (${CADENCE_N} swaps, 80% buys, small varied sizes) at mean gaps of ${CADENCE_MIN.join(", ")} min (±25% jitter), plus the other scenarios;`);
console.log("cooling: gap(120) = old default, clock(120) = lossless, sil = silence (no time cooling, reset after 3600 s of silence) = new default.");
console.log("1st/btw = to the first drop / mean between later drops, in swaps and in wall-clock hours; heat>0 = % wall time.\n");
console.log("scenario             cooling               N  drops  swaps 1st/btw  hours 1st/btw  noop grooveΔ heat>0 maxH  musical");
const cadenceRows: (Row & { swaps1: string; hours1: string })[] = [];
for (const k of CADENCE_KEYS) {
  for (const rules of MODES) {
    const r = run(k, { name: label(rules), rules }, { musical: !QUICK });
    const t = timing(r);
    rows.push(r);
    cadenceRows.push({ ...r, swaps1: t.swaps, hours1: t.hours });
    const mode = rules.coolMode === "silence" ? "silence" : `${rules.coolMode}(${rules.coolSec})`;
    console.log(
      `${k.padEnd(20)} ${mode.padEnd(18)} ${String(r.n).padStart(4)} ${String(r.drops).padStart(6)} ${t.swaps.padStart(14)} ${t.hours.padStart(14)} ${pct(r.noops, r.nonWhale)}   ${pct(r.grooveChanges, r.n)}   ${pct(r.heatTime, r.totalTime)} ${String(r.maxHeat).padStart(4)}  ${r.problems.length ? "FAIL " + r.problems.join(", ") : QUICK ? "-" : "ok"}`,
    );
  }
}
writeFileSync(resolve(outDir, "cadence.json"), JSON.stringify(cadenceRows.map(({ scenario, variant, n, drops, dropAt, swaps1, hours1, noops, nonWhale, grooveChanges, heatTime, totalTime, maxHeat, problems }) => ({ scenario, variant, n, drops, dropAt, swaps: swaps1, hours: hours1, noop: noops / Math.max(1, nonWhale), groove: grooveChanges / n, heat: heatTime / totalTime, maxHeat, problems })), null, 1) + "\n");

const failures = rows.filter((r) => r.problems.length).length;
console.log(`\n${failures ? `${failures} run(s) broke a musical rule` : QUICK ? "musical check skipped" : "no run broke a musical rule (no machine gun)"}`);
writeFileSync(resolve(outDir, "results.json"), JSON.stringify(rows, null, 1) + "\n");

// Timelines for the renders (recommended rules vs base).
const REC: Variant = { name: "rel+acc+drop", rules: DEFAULT_DROP_RULES };
const sbv = run("small-buys-varied", REC, { musical: false });
// Window: 50 swaps before the first drop (frozen grid, then heat) to 56 after it (the new seed growing), ~0.75 s per swap.
const d1 = sbv.dropAt[0] ?? 300;
const win: [number, number] = [Math.max(0, d1 - 50), Math.min(sbv.n, d1 + 56)];
const SBV_SECONDS = 80;
run("small-buys-varied", REC, { musical: false, timeline: { file: "small-buys-varied-rel+acc+drop.timeline.json", window: win, spacing: SBV_SECONDS / (win[1] - win[0]) } });
run("small-buys-varied", { name: "rel+acc" }, { musical: false, timeline: { file: "small-buys-varied-rel+acc.timeline.json", window: win, spacing: SBV_SECONDS / (win[1] - win[0]) } });
// imd-week: the 240 swaps around the first drop (or the last 240 when there is none), as in the accumulation A/B.
const wk = run("imd-week", REC, { musical: false });
const wd = wk.dropAt[0];
const wc = wd ?? wk.maxHeatAt;
const wwin: [number, number] = [Math.max(0, Math.min(wc - 160, wk.n - 240)), Math.min(wk.n, Math.max(wc + 80, 240))];
for (const v of [REC, { name: "rel+acc" }]) run("imd-week", v, { musical: false, timeline: { file: `imd-week-${v.name}.timeline.json`, window: wwin, spacing: 24 / (wwin[1] - wwin[0]) } });
// Cadence renders, on the virtual clock (events carry `now`, so the synth runs its idle stages):
// 5-min cadence around the first drop (build → heat → drop), 0.75 s of audio per 5 minutes;
const C5 = cadenceKey(5);
const c5 = run(C5, REC, { musical: false });
const c5d = c5.dropAt[0] ?? 300;
const c5win: [number, number] = [Math.max(0, c5d - 40), Math.min(c5.n, c5d + 16)];
const c5run = run(C5, REC, { musical: false, timeline: { file: `${C5}-rel+acc+drop.timeline.json`, window: c5win, compress: 0.75 / 300 } });
const c5tl = JSON.parse(readFileSync(resolve(tlDir, `${C5}-rel+acc+drop.timeline.json`), "utf8")) as { events: { timestamp: number }[] };
// 30-min cadence: once heat reaches 10, one 55-min lull (< SILENCE_RESET_SEC, so heat survives), then the flow resumes.
// 0.3 s of audio per minute: heat effects fade with the idle stage and return on the next swap.
const C30 = cadenceKey(30);
const LULL = { atHeat: 10, gap: 55 * 60 };
const c30 = run(C30, REC, { musical: false, lull: LULL });
const la = c30.lullAt ?? 0;
const c30win: [number, number] = [Math.max(0, la - 3), Math.min(c30.n, la + 3)];
run(C30, REC, { musical: false, lull: LULL, timeline: { file: `${C30}-lull-rel+acc+drop.timeline.json`, window: c30win, compress: 0.3 / 60 } });
const c30tl = JSON.parse(readFileSync(resolve(tlDir, `${C30}-lull-rel+acc+drop.timeline.json`), "utf8")) as { events: { timestamp: number }[] };
const tlEnd = (tl: { events: { timestamp: number }[] }) => tl.events[tl.events.length - 1].timestamp;
writeFileSync(
  resolve(tlDir, "windows.json"),
  JSON.stringify(
    {
      "small-buys-varied": { window: win, drops: sbv.dropAt, seconds: SBV_SECONDS },
      "imd-week": { window: wwin, drops: wk.dropAt, seconds: 24 },
      [C5]: { window: c5win, drops: c5run.dropAt, seconds: Math.ceil(tlEnd(c5tl)) + 4 },
      [`${C30}-lull`]: { window: c30win, lullAt: la, seconds: Math.ceil(tlEnd(c30tl)) + 8 },
    },
    null,
    1,
  ) + "\n",
);
console.log(`cadence timelines: ${C5} swaps ${c5win[0]}..${c5win[1]} (drops at ${c5run.dropAt.join(", ")}), ${C30}-lull swaps ${c30win[0]}..${c30win[1]} (55-min lull after swap ${la})`);
console.log(`\ntimelines: small-buys-varied swaps ${win[0]}..${win[1]} (drops at ${sbv.dropAt.join(", ")}), imd-week swaps ${wwin[0]}..${wwin[1]} (drops at ${wk.dropAt.join(", ") || `none; max heat ${wk.maxHeat} at swap ${wk.maxHeatAt}`})`);
