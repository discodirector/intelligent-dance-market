// Runs every case of spec/vectors.json (generated from the Solidity implementation, SPEC §3.5).
// Skips until the file exists; once present, every vector must pass.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as suite, expect, it } from "vitest";
import { decode, mutate } from "../src/index.ts";

const path = fileURLToPath(new URL("../../../spec/vectors.json", import.meta.url));
const present = existsSync(path);
const raw = present ? JSON.parse(readFileSync(path, "utf8")) : [];
const cases: any[] = Array.isArray(raw) ? raw : raw.vectors ?? raw.cases ?? [];

const big = (v: unknown) => BigInt(v as string | number);
const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

suite.skipIf(!present)("spec/vectors.json", () => {
  it("has >= 40 cases", () => expect(cases.length).toBeGreaterThanOrEqual(40));
  it("covers whale drop/fill (every k, sells)", () => {
    const drops = cases.map((c) => c.event?.drop).filter(Boolean);
    expect(drops.length).toBeGreaterThanOrEqual(12);
    const ks = new Set(drops.filter((d: any) => d.fill).map((d: any) => Number(d.mask).toString(2).split("1").length - 1));
    for (let k = 3; k <= 8; k++) expect(ks.has(k)).toBe(true);
    expect(drops.some((d: any) => !d.fill)).toBe(true);
  });

  cases.forEach((c, i) => {
    it(`vector #${i}${c.name ? ` ${c.name}` : ""}`, () => {
      const before = decode(big(c.before.slot0), big(c.before.slot1));
      const { state, event } = mutate(before, {
        isBuy: bool(c.input.isBuy),
        imdAmt: big(c.input.imdAmt),
        tick: Number(c.input.tick),
        blockNumber: big(c.input.blockNumber),
        timestamp: big(c.input.timestamp),
      });
      expect("0x" + event.slot0.toString(16)).toBe("0x" + big(c.after.slot0).toString(16));
      expect("0x" + event.slot1.toString(16)).toBe("0x" + big(c.after.slot1).toString(16));
      expect(state).toEqual(decode(big(c.after.slot0), big(c.after.slot1)));
      const e = c.event ?? {};
      if (e.track !== undefined) expect(event.track).toBe(Number(e.track));
      if (e.step !== undefined) expect(event.step).toBe(Number(e.step));
      if (e.on !== undefined) expect(event.on).toBe(bool(e.on));
      if (e.bassNote !== undefined) expect(event.bassNote).toBe(Number(e.bassNote));
      if (e.isBuy !== undefined) expect(event.isBuy).toBe(bool(e.isBuy));
      if (e.swapCount !== undefined) expect(event.swapCount).toBe(Number(e.swapCount));
      const mv = e.movement;
      if (e.movement === null || e.movement === false) expect(event.movement).toBeUndefined();
      if (mv && typeof mv === "object") {
        expect(event.movement).toBeDefined();
        if (mv.patternId !== undefined) expect(event.movement!.patternId).toBe(Number(mv.patternId));
        if (mv.root !== undefined) expect(event.movement!.root).toBe(Number(mv.root));
      }
      if (e.whale !== undefined) expect(event.whale).toBe(bool(e.whale));
      if ("drop" in e) {
        if (e.drop === null) expect(event.drop).toBeUndefined();
        else {
          expect(event.drop).toEqual({ track: Number(e.drop.track), fill: bool(e.drop.fill), mask: Number(e.drop.mask) });
          // cross-field: mask is exactly the dropped track's resulting 16 bits
          expect(Number((state.pattern >> BigInt(event.drop!.track * 16)) & 0xffffn)).toBe(event.drop!.mask);
        }
      }
    });
  });
});
