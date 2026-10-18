// FDV-scaled whale threshold (SPEC §3.1) and the TickMath port it rests on. Bit-exactness against Solidity is
// pinned by spec/vectors-v2.json (event.whaleWei on every case); these tests pin the calibration and the edges.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DROP_RULES,
  DEFAULT_THRESHOLDS,
  IMD_WHALE_WEI,
  MAX_TICK,
  MIN_TICK,
  V2_RULES,
  WHALE_C,
  WHALE_K,
  IDM_SUPPLY,
  WHALE_MAX_WEI,
  WHALE_MIN_WEI,
  fdvWeiAtTick,
  getSqrtPriceAtTick,
  initialDropState,
  initialRelativeState,
  isWhaleSwap,
  mutate,
  whaleThresholdFor,
  whaleWeiAtTick,
} from "../src/index.ts";

const ETH = 10n ** 18n;
const Q96 = 2n ** 96n;
const isqrt = (n: bigint) => {
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
};

describe("getSqrtPriceAtTick (v4-core TickMath port)", () => {
  it("matches the v4-core constants at the ends and 2^96 at tick 0", () => {
    expect(getSqrtPriceAtTick(MIN_TICK)).toBe(4295128739n);
    expect(getSqrtPriceAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n);
    expect(getSqrtPriceAtTick(0)).toBe(Q96);
    // Uniswap's published reference values (v3/v4 TickMath tests).
    expect(getSqrtPriceAtTick(-1)).toBe(79224201403219477170569942574n);
    expect(getSqrtPriceAtTick(1)).toBe(79232123823359799118286999568n);
    expect(getSqrtPriceAtTick(50)).toBe(79426470787362580746886972461n);
  });

  it("rejects ticks outside the range", () => {
    expect(() => getSqrtPriceAtTick(MAX_TICK + 1)).toThrow(RangeError);
    expect(() => getSqrtPriceAtTick(MIN_TICK - 1)).toThrow(RangeError);
  });

  it("tracks sqrt(1.0001^tick) and is strictly increasing", () => {
    let prev = 0n;
    for (let t = MIN_TICK; t <= MAX_TICK; t += 7919) {
      const p = getSqrtPriceAtTick(t);
      expect(p > prev).toBe(true);
      prev = p;
      const want = Math.exp((t / 2) * Math.log(1.0001));
      const got = Number(p) / 2 ** 96;
      expect(Math.abs(got / want - 1)).toBeLessThan(1e-9);
    }
  });
});

describe("whaleWeiAtTick", () => {
  it("C = floor(K * sqrt(SUPPLY))", () => {
    expect(WHALE_C).toBe(isqrt(WHALE_K * WHALE_K * IDM_SUPPLY));
    expect(WHALE_C).toBe(632_455_532_033_675_866_399n);
  });

  it("FDV 4 / 40 / 400 / 4000 ETH -> 0.04 / 0.1265 / 0.4 / 1.265 ETH (within one tick)", () => {
    const table: [number, number, number][] = [
      // [tick nearest FDV, FDV ETH, whale ETH = 2e7 * sqrt(FDV wei) / 1e18]
      [193379, 4, 0.04],
      [170352, 40, 0.12649110640673517],
      [147325, 400, 0.4],
      [124298, 4000, 1.2649110640673518],
    ];
    for (const [tick, fdv, whale] of table) {
      expect(Math.abs(Number(fdvWeiAtTick(tick)) / 1e18 / fdv - 1)).toBeLessThan(1e-4);
      expect(Math.abs(Number(whaleWeiAtTick(tick)) / 1e18 / whale - 1)).toBeLessThan(1e-4);
    }
    // Exact pins (also in spec/vectors-v2.json and contracts/scripts/validate-vectors.py).
    expect(whaleWeiAtTick(193380)).toBe(39_998_766_246_454_331n);
    expect(whaleWeiAtTick(193379)).toBe(40_000_766_134_770_696n);
  });

  it("clamps to [0.005, 50] ETH with exact boundary ticks", () => {
    expect(WHALE_MIN_WEI).toBe(5n * ETH / 1000n);
    expect(WHALE_MAX_WEI).toBe(50n * ETH);
    expect(whaleWeiAtTick(50754)).toBe(WHALE_MAX_WEI);
    expect(whaleWeiAtTick(50755)).toBe(49_998_189_365_703_816_076n);
    expect(whaleWeiAtTick(234970)).toBe(5_000_073_327_709_522n);
    expect(whaleWeiAtTick(234971)).toBe(WHALE_MIN_WEI);
    expect(whaleWeiAtTick(0)).toBe(WHALE_MAX_WEI);
    expect(whaleWeiAtTick(MIN_TICK)).toBe(WHALE_MAX_WEI);
    expect(whaleWeiAtTick(MAX_TICK)).toBe(WHALE_MIN_WEI);
  });

  it("saturates int24 ticks outside TickMath's range instead of throwing", () => {
    expect(whaleWeiAtTick(-(2 ** 23))).toBe(WHALE_MAX_WEI);
    expect(whaleWeiAtTick(2 ** 23 - 1)).toBe(WHALE_MIN_WEI);
  });

  it("is non-increasing in tick (higher tick = cheaper IDM = lower FDV) and orientation-symmetric", () => {
    let prev = WHALE_MAX_WEI;
    for (let t = 40000; t <= 250000; t += 37) {
      const w = whaleWeiAtTick(t);
      expect(w <= prev).toBe(true);
      prev = w;
      expect(whaleWeiAtTick(-t, false)).toBe(w);
    }
  });

  it("one client helper: ETH from the tick, IMD (v1 tapes) fixed", () => {
    expect(whaleThresholdFor("ETH", 193380)).toBe(whaleWeiAtTick(193380));
    expect(whaleThresholdFor("IMD", 193380)).toBe(IMD_WHALE_WEI);
    expect(isWhaleSwap(40_000_000_000_000_000n, 193380)).toBe(true);
    expect(isWhaleSwap(39_000_000_000_000_000n, 193380)).toBe(false);
    expect(isWhaleSwap(10n ** 20n, 193380, "IMD")).toBe(true);
  });
});

describe("v2 mutate uses the tick's whale threshold", () => {
  const base = { blockNumber: 21_000_000n, timestamp: 1_800_000_000 };
  const s = initialDropState(initialRelativeState());

  it("whale iff quoteAmt >= whaleWeiAtTick(tick); the event carries whaleWei", () => {
    const w = whaleWeiAtTick(193380);
    const at = mutate(s, { isBuy: true, quoteAmt: w, tick: 193380, ...base }, DEFAULT_THRESHOLDS, V2_RULES);
    const under = mutate(s, { isBuy: true, quoteAmt: w - 1n, tick: 193380, ...base }, DEFAULT_THRESHOLDS, V2_RULES);
    expect(at.event.whale).toBe(true);
    expect(under.event.whale).toBe(false);
    expect(at.event.whaleWei).toBe(w);
    // The same 0.04 ETH at FDV 400 ETH is an ordinary trade.
    expect(mutate(s, { isBuy: true, quoteAmt: w, tick: 147325, ...base }, DEFAULT_THRESHOLDS, V2_RULES).event.whale).toBe(false);
  });

  it("the EMA upper clamp follows the threshold", () => {
    // A 10 ETH sell at FDV 4 ETH enters the EMA as L(~0.04 ETH) = 881, at tick 0 as L(10 ETH).
    const big = 10n * ETH;
    const lo = mutate(s, { isBuy: false, quoteAmt: big, tick: 193380, ...base }, DEFAULT_THRESHOLDS, V2_RULES);
    expect(lo.state.sizeLogEma).toBe(Math.floor((854 * 7 + 881) / 8));
    const hi = mutate(s, { isBuy: false, quoteAmt: big, tick: 0, ...base }, DEFAULT_THRESHOLDS, V2_RULES);
    expect(hi.state.sizeLogEma).toBe(Math.floor((854 * 7 + 1008) / 8)); // L(10 ETH) = 1008
  });

  it("satBits 44", () => {
    expect(DEFAULT_DROP_RULES.satBits).toBe(44);
  });
});
