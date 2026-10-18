import { describe, expect, it } from "vitest";
import { exp2Fixed, isPulse, log2Fixed, pulseSize, PULSE_MAX_WEI, PULSE_MIN_WEI } from "../src/index";

const T = "0x00000000000000000000000000000000000000aB";

describe("pulse treasury", () => {
  it("labels only the configured treasury, case-insensitively", () => {
    expect(isPulse(T.toLowerCase(), T)).toBe(true);
    expect(isPulse("0x0000000000000000000000000000000000000001", T)).toBe(false);
    expect(isPulse(T, "")).toBe(false);
    expect(isPulse(T, null)).toBe(false);
    expect(isPulse(undefined, T)).toBe(false);
  });

  it("exp2Fixed inverts log2Fixed", () => {
    for (let l = 64; l < 2048; l += 7) expect(log2Fixed(exp2Fixed(l))).toBe(l);
  });

  it("matches PulseTreasury.pulseSize clamps (contracts/test/PulseTreasury.t.sol)", () => {
    expect(log2Fixed(PULSE_MIN_WEI)).toBe(710);
    expect(log2Fixed(PULSE_MAX_WEI)).toBe(812);
    const ten = 10n * 10n ** 18n;
    expect(pulseSize(918, ten)).toBe(PULSE_MAX_WEI);
    expect(pulseSize(854, ten)).toBe(PULSE_MAX_WEI);
    expect(log2Fixed(pulseSize(800, ten))).toBe(776);
    expect(pulseSize(710, ten)).toBe(PULSE_MIN_WEI);
    expect(pulseSize(918, 10n ** 17n)).toBe(10n ** 15n);
    expect(pulseSize(918, 2_500_000_000_000_000n)).toBe(PULSE_MIN_WEI);
    expect(pulseSize(918, 2_500_000_000_000_000n - 1n)).toBe(0n);
  });
});
