import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { factsFromTimeline } from "../src/lib/facts.ts";
import { templateCaption, validateCaption, MAX_LEN } from "../src/caption/index.ts";

const tl = JSON.parse(readFileSync(new URL("../data/imd-eth-7d.timeline.json", import.meta.url), "utf8"));

describe("caption", () => {
  for (const kind of ["teaser", "snapshot", "movement"] as const) {
    it(`template ${kind} is valid and <= ${MAX_LEN}`, () => {
      const f = factsFromTimeline(tl, { kind, chain: "ethereum", pool: "IMD/ETH" });
      const t = templateCaption(f);
      expect(validateCaption(t, f)).toEqual([]);
      expect([...t].length).toBeLessThanOrEqual(MAX_LEN);
    });
  }
  it("rejects price talk, promises and invented numbers", () => {
    const f = factsFromTimeline(tl, { kind: "teaser", chain: "ethereum", pool: "IMD/ETH" });
    expect(validateCaption("price is up, buy now", f).length).toBeGreaterThan(0);
    expect(validateCaption("this will moon", f).length).toBeGreaterThan(0);
    expect(validateCaption("31337 swaps", f)).toContain("unknown number 31337");
    expect(validateCaption(`${f.swaps} swaps`, f)).toEqual([]);
  });
});
