import { describe, expect, it } from "vitest";
import { isRangeError, isRateLimit } from "../src/replay/rpc.ts";

describe("rpc errors", () => {
  it("Tenderly's rate limit is not a range error (the range must not shrink)", () => {
    const e = new Error('Request exceeds defined limit.\n\nURL: https://monad.gateway.tenderly.co\nRequest body: {"method":"eth_getLogs"}\n\nDetails: rate limit exceeded');
    expect(isRateLimit(e)).toBe(true);
    expect(isRangeError(e)).toBe(false);
    expect(isRateLimit(new Error("HTTP request failed. Status: 429"))).toBe(true);
  });

  it("range limits still shrink the range", () => {
    for (const m of ["eth_getLogs is limited to a 100 range", "block range too large", "ranges over 10000 blocks are not supported on free plan", "query returned more than 10000 results"]) {
      expect(isRangeError(new Error(m))).toBe(true);
      expect(isRateLimit(new Error(m))).toBe(false);
    }
  });
});
