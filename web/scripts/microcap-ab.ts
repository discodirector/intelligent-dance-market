// Micro-cap bench for the launch hook (core V2_RULES: relative tiers, accumulation, heat/drop, FDV-scaled whale).
//   npx tsx web/scripts/microcap-ab.ts   → table + sim/stress/microcap/results.json
// The market: IDM/ETH at FDV ~4-40 ETH (~$10k-100k at $2500/ETH). Trade sizes log-normal around 0.004 ETH
// (sigma 1.2 octaves), a few 0.02-0.1 ETH buys, 50-70% buys. The pool is a full-range v4 position (ETH reserve
// R at the start), so every swap moves sqrtPrice exactly as Uniswap math does and the post-swap tick is real:
// buys lift FDV, sells lower it, and the whale threshold follows (whaleWeiAtTick).
// Reported per scenario (mean over seeds): tracks completed, swaps per track, whales per 1000 swaps, FDV range.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DROP_RULES,
  DEFAULT_THRESHOLDS,
  IDM_SUPPLY,
  initialDropState,
  initialRelativeState,
  mutate,
  V2_RULES,
  whaleWeiAtTick,
  type MutateOptions,
  type State,
} from "../../packages/core/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "sim/stress/microcap");
mkdirSync(outDir, { recursive: true });

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
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

interface Scenario {
  name: string;
  /** Opening FDV in ETH. */
  fdv0: number;
  /** ETH reserve of the full-range position at the opening price. */
  reserve0: number;
  buyShare: number;
  /** Median trade, ETH, and log-normal sigma in octaves. */
  median: number;
  sigma: number;
  /** Share of trades that are 0.02-0.1 ETH buys (log-uniform). */
  bigBuys: number;
  swaps: number;
  /** Sell median = median * buyShare / (1 - buyShare): net flow ~0, so FDV wanders instead of trending up. */
  balanced?: boolean;
}

const BASE: Omit<Scenario, "name" | "buyShare"> = { fdv0: 4, reserve0: 2, median: 0.004, sigma: 1.2, bigBuys: 0.03, swaps: 3000 };
const SCENARIOS: Scenario[] = [
  { ...BASE, name: "fdv4-buy50", buyShare: 0.5 },
  { ...BASE, name: "fdv4-buy60", buyShare: 0.6 },
  { ...BASE, name: "fdv4-buy70", buyShare: 0.7 },
  { ...BASE, name: "fdv40-buy60", buyShare: 0.6, fdv0: 40, reserve0: 6.3 },
  { ...BASE, name: "fdv4-buy60-nobig", buyShare: 0.6, bigBuys: 0 },
  { ...BASE, name: "fdv4-buy60-bal", buyShare: 0.6, balanced: true },
  { ...BASE, name: "fdv4-buy70-bal", buyShare: 0.7, balanced: true },
];
const SEEDS = 20;

interface Result {
  scenario: string; satBits: number; swaps: number; tracks: number; swapsPerTrack: number | null;
  whalesPer1000: number; whaleBuys: number; whaleSells: number; fdvStart: number; fdvMin: number; fdvMax: number; fdvEnd: number;
  whaleEthStart: number; whaleEthEnd: number;
  /** The old fixed 0.2 ETH whale on the same swaps (whales per 1000). */
  fixedWhalesPer1000: number;
}

const fdvOfTick = (tick: number) => Number(IDM_SUPPLY) / 1e18 / Math.pow(1.0001, tick);

function runOnce(sc: Scenario, seed: number, satBits: number): Result {
  const r = rng(seed * 7919 + Math.round(sc.buyShare * 100) + sc.fdv0);
  const opts: MutateOptions = { ...V2_RULES, drop: { ...DEFAULT_DROP_RULES, satBits } };
  // Price as sqrt(IDM per ETH) (currency0 = ETH, currency1 = IDM), i.e. the v4 sqrtPrice / 2^96.
  let sqrtP = Math.sqrt(Number(IDM_SUPPLY) / 1e18 / sc.fdv0);
  const L = sc.reserve0 * sqrtP; // full range: ETH reserve x = L / sqrtP (in ETH units)
  let state: State = initialDropState(initialRelativeState());
  let ts = 1_800_000_000;
  let block = 30_000_000n;
  let tracks = 0, whales = 0, whaleBuys = 0, whaleSells = 0, fixedWhales = 0;
  const trackAt: number[] = [];
  let fdvMin = Infinity, fdvMax = 0;
  let firstTick = 0, lastTick = 0;
  for (let i = 0; i < sc.swaps; i++) {
    const big = r() < sc.bigBuys;
    const isBuy = big || r() < sc.buyShare;
    const median = !isBuy && sc.balanced ? (sc.median * sc.buyShare) / (1 - sc.buyShare) : sc.median;
    let eth = big ? Math.exp(Math.log(0.02) + r() * Math.log(5)) : median * 2 ** (sc.sigma * gauss(r));
    const reserve = L / sqrtP;
    if (!isBuy) eth = Math.min(eth, reserve * 0.5); // exact ETH out cannot drain the pool
    // Exact ETH in (buy, zeroForOne): 1/sqrtP' = 1/sqrtP + dx/L. Exact ETH out (sell): 1/sqrtP' = 1/sqrtP - dx/L.
    // (The 1.25% LP fee only changes how much IDM moves; the hook reads the ETH delta.)
    sqrtP = 1 / (1 / sqrtP + (isBuy ? eth : -eth) / L);
    const tick = Math.floor(Math.log(sqrtP * sqrtP) / Math.log(1.0001));
    if (i === 0) firstTick = tick;
    lastTick = tick;
    const fdv = fdvOfTick(tick);
    fdvMin = Math.min(fdvMin, fdv);
    fdvMax = Math.max(fdvMax, fdv);
    ts += Math.max(2, Math.round(-Math.log(1 - r()) * 120));
    block += BigInt(1 + Math.floor(r() * 3));
    const quoteAmt = BigInt(Math.round(eth * 1e9)) * 10n ** 9n;
    if (quoteAmt >= 200_000_000_000_000_000n) fixedWhales++;
    const res = mutate(state, { isBuy, quoteAmt, tick, blockNumber: block, timestamp: ts }, DEFAULT_THRESHOLDS, opts);
    state = res.state;
    if (res.event.whale) {
      whales++;
      if (isBuy) whaleBuys++;
      else whaleSells++;
    }
    if (res.event.trackComplete) {
      tracks++;
      trackAt.push(i + 1);
    }
  }
  const gaps = trackAt.map((x, k) => x - (k ? trackAt[k - 1] : 0));
  return {
    scenario: sc.name, satBits, swaps: sc.swaps, tracks,
    swapsPerTrack: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    whalesPer1000: (1000 * whales) / sc.swaps, whaleBuys, whaleSells,
    fdvStart: fdvOfTick(firstTick), fdvMin, fdvMax, fdvEnd: fdvOfTick(lastTick),
    whaleEthStart: Number(whaleWeiAtTick(firstTick)) / 1e18, whaleEthEnd: Number(whaleWeiAtTick(lastTick)) / 1e18,
    fixedWhalesPer1000: (1000 * fixedWhales) / sc.swaps,
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f = (x: number, d = 1) => x.toFixed(d);
console.log(`micro-cap market, ${SEEDS} seeds per row; sizes log-normal median 0.004 ETH (sigma 1.2 oct), 3% 0.02-0.1 ETH buys unless noted;`);
console.log("whale = FDV-scaled (core whaleWeiAtTick of the post-swap tick); tracks/seed and swaps/track are means over seeds.\n");
console.log("bal = sells sized so ETH volume balances (FDV wanders, no trend); old0.2 = whales/1000 under the old fixed 0.2 ETH.\n");
console.log("scenario            sat  swaps  tracks/seed  swaps/track  whales/1000  (buy/sell)   FDV ETH start→end [min..max]   whale ETH start→end  old0.2");
const all: Result[] = [];
for (const satBits of [44, 48]) {
  for (const sc of SCENARIOS) {
    const rs = Array.from({ length: SEEDS }, (_, s) => runOnce(sc, s + 1, satBits));
    all.push(...rs);
    const spt = rs.filter((x) => x.swapsPerTrack != null).map((x) => x.swapsPerTrack!);
    console.log(
      `${sc.name.padEnd(19)} ${String(satBits).padStart(3)} ${String(sc.swaps).padStart(6)} ${f(mean(rs.map((x) => x.tracks))).padStart(12)} ${(spt.length ? f(mean(spt), 0) : "-").padStart(12)} ${f(mean(rs.map((x) => x.whalesPer1000)), 2).padStart(12)}  (${f(mean(rs.map((x) => x.whaleBuys)))}/${f(mean(rs.map((x) => x.whaleSells)))})`.padEnd(96) +
        `${f(mean(rs.map((x) => x.fdvStart)))}→${f(mean(rs.map((x) => x.fdvEnd)))} [${f(Math.min(...rs.map((x) => x.fdvMin)))}..${f(Math.max(...rs.map((x) => x.fdvMax)))}]`.padEnd(31) +
        `${f(mean(rs.map((x) => x.whaleEthStart)), 3)}→${f(mean(rs.map((x) => x.whaleEthEnd)), 3)}`.padEnd(21) +
        f(mean(rs.map((x) => x.fixedWhalesPer1000)), 2),
    );
  }
  console.log("");
}
writeFileSync(resolve(outDir, "results.json"), JSON.stringify(all, null, 1) + "\n");
