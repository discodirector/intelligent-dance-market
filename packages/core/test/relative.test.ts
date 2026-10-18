import { describe, expect, it } from "vitest";
import {
  decode,
  encode,
  initialRelativeState,
  initialState,
  INITIAL_SIZE_LOG_EMA,
  log2Fixed,
  msb,
  mutate,
  nextSizeLogEma,
  TRACK_GLITCH,
  TRACK_HAT,
  TRACK_KICK,
  ETH_EMA_FLOOR,
  ETH_THRESHOLDS,
  ETH_INITIAL_SIZE,
  WHALE_MAX_WEI,
  WHALE_MIN_WEI,
  whaleWeiAtTick,
} from "../src/index.ts";

/** 1 IMD at the launch calibration (1/400): 0.0025 ETH in wei. Keeps every relative case identical. */
const E = 10n ** 18n / 400n;
const swap = (quoteAmt: bigint, i = 0, isBuy = true) => ({ isBuy, quoteAmt, tick: 600, blockNumber: 21_000_000n + BigInt(i), timestamp: 1_760_000_000 + i * 6 });

describe("relative tiers (prototype)", () => {
  it("log2Fixed is msb*16 + 4 mantissa bits", () => {
    expect(log2Fixed(0n)).toBe(0);
    expect(log2Fixed(1n)).toBe(0);
    expect(log2Fixed(3n)).toBe(16 + 8);
    expect(log2Fixed(16n)).toBe(64);
    expect(log2Fixed(31n)).toBe(64 + 15);
    expect(msb(2n ** 255n)).toBe(255);
    expect(INITIAL_SIZE_LOG_EMA).toBe(854); // L(0.0125 ETH); was L(5 IMD) = 993
    expect(INITIAL_SIZE_LOG_EMA).toBe(log2Fixed(ETH_INITIAL_SIZE));
    expect(log2Fixed(ETH_EMA_FLOOR)).toBe(710); // was L(0.01 IMD) = 849, same 144 gap below the start
    // v1-rules replays keep 0.2 ETH; the launch hook's whale scales with FDV (whale.test.ts).
    expect(ETH_THRESHOLDS.kick).toBe(200_000_000_000_000_000n);
    expect(log2Fixed(WHALE_MAX_WEI)).toBe(1045); // highest possible EMA upper clamp
    expect(log2Fixed(WHALE_MIN_WEI)).toBe(833); // lowest
    expect(log2Fixed(whaleWeiAtTick(193380))).toBe(881); // FDV 4 ETH (launch): L(~0.04 ETH)
    expect(log2Fixed(5n * 10n ** 18n)).toBe(993);
    for (let k = 0; k < 200; k++) expect(log2Fixed(1n << BigInt(k))).toBe(k * 16);
  });

  it("absolute path ignores the option-less call and never touches sizeLogEma", () => {
    const a = mutate(initialState(), swap(E / 4n));
    expect(a.state.sizeLogEma).toBeUndefined();
    expect(a.event.slot1 >> 152n).toBe(0n);
  });

  it("classifies against the EMA before updating it, whale stays absolute", () => {
    const s = initialRelativeState();
    const big = mutate(s, swap(30n * E), undefined, { relative: true });
    expect(big.event.track).toBe(TRACK_KICK); // 6x the 5 IMD prior
    expect(big.event.whale).toBe(false);
    expect(big.state.sizeLogEma).toBe(nextSizeLogEma(INITIAL_SIZE_LOG_EMA, 30n * E));
    expect(mutate(s, swap(5n * E), undefined, { relative: true }).event.track).toBe(TRACK_GLITCH);
    expect(mutate(s, swap(E), undefined, { relative: true }).event.track).toBe(TRACK_HAT);
    expect(mutate(s, swap(150n * E), undefined, { relative: true }).event.whale).toBe(true);
  });

  it("dust cannot turn a 3 IMD buy into a whale", () => {
    let s = initialRelativeState();
    for (let i = 0; i < 100; i++) s = mutate(s, swap(10n ** 9n, i, false), undefined, { relative: true }).state;
    const e = mutate(s, swap(3n * E, 100), undefined, { relative: true }).event;
    expect(e.whale).toBe(false);
    expect(e.drop).toBeUndefined();
  });

  it("packs sizeLogEma into slot1 bits 152..167 only when asked", () => {
    const s = { ...initialRelativeState(), sizeLogEma: 0xbeef };
    expect(encode(s).slot1).toBe(encode(initialState()).slot1);
    const packed = encode(s, { relative: true });
    expect(decode(packed.slot0, packed.slot1, { relative: true }).sizeLogEma).toBe(0xbeef);
    expect(decode(packed.slot0, packed.slot1).sizeLogEma).toBeUndefined();
  });
});
