import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTimeline, type RawSwap, type TimelineEntry } from "../src/lib/timeline.ts";
import { decodeFor } from "../src/lib/hookRules.ts";
import { factsFromTimeline } from "../src/lib/facts.ts";
import { templateCaption, validateCaption, MAX_LEN } from "../src/caption/index.ts";
import { decide, H, type SchedState } from "../src/rules.ts";
import { AFTER_DROP, trackSubtitle, trackWindow } from "../src/lib/track.ts";

const tl: TimelineEntry[] = JSON.parse(readFileSync(new URL("../data/imd-eth-7d.timeline.json", import.meta.url), "utf8"));
const swaps: RawSwap[] = tl.map((e) => ({ isBuy: e.isBuy, imdAmt: BigInt(e.imdAmt), tick: e.tick, blockNumber: BigInt(e.blockNumber), timestamp: e.ts }));
const v2 = buildTimeline(swaps, undefined, "v2").entries;
const drops = v2.filter((e) => e.trackComplete);

describe("hook rules", () => {
  it("v1 is the default and unchanged", () => {
    const a = buildTimeline(swaps).entries;
    const b = buildTimeline(swaps, undefined, "v1").entries;
    expect(b).toEqual(a);
    expect(a.every((e) => e.rules === undefined && e.trackComplete === undefined)).toBe(true);
    expect(decodeFor(a[5].slot0, a[5].slot1, "v1").heat).toBeUndefined();
  });
  it("v2 re-simulates with heat, trackNo and track completes", () => {
    expect(v2.every((e) => e.rules === "v2")).toBe(true);
    expect(drops.length).toBeGreaterThan(0);
    drops.forEach((e, i) => {
      expect(e.trackComplete!.trackNo).toBe(i + 1);
      expect(e.state.trackNo).toBe(i + 1);
      expect(e.state.heat).toBe(0);
      // the snapshot is the finished track: previous trackNo, full heat
      const held = decodeFor(e.trackComplete!.slot0, e.trackComplete!.slot1, "v2");
      expect(held.trackNo).toBe(i);
      expect(held.heat).toBe(16);
    });
    expect(drops.reduce((n, e) => n + e.trackComplete!.swaps!, 0)).toBe(drops.at(-1)!.state.swapCount);
  });
});

describe("track complete post", () => {
  it("template caption is valid", () => {
    const win = trackWindow(v2);
    const f = factsFromTimeline(win, { kind: "track", chain: "robinhood", pool: "IDM/IMD" });
    const tc = drops.at(-1)!.trackComplete!;
    expect(f.track).toMatchObject({ no: tc.trackNo, swaps: tc.swaps, swapCount: tc.swapCount, page: tc.patternId });
    const t = templateCaption(f);
    expect(t).toContain(`track #${tc.trackNo} complete`);
    expect(validateCaption(t, f)).toEqual([]);
    expect([...t].length).toBeLessThanOrEqual(MAX_LEN);
    expect(trackSubtitle(tc)).toBe(`TRACK #${tc.trackNo} COMPLETE · ${tc.swaps} SWAPS`);
  });
  it("window ends a few swaps after the latest drop", () => {
    const win = trackWindow(v2);
    const at = win.findIndex((e) => e === drops.at(-1));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(win.length - 1 - at).toBeLessThanOrEqual(AFTER_DROP);
    expect(trackWindow(tl)).toBe(tl);
  });
  it("track beats movement and shares its 1h gap", () => {
    const T = 1_800_000_000_000;
    const st = (posts: [number, any][]): SchedState => ({ posts: posts.map(([at, kind]) => ({ at, kind })) });
    expect(decide(T, st([[T - 7 * H, "snapshot"]]), { live: true, newMovements: 2, newTracks: 1 })).toBe("track");
    expect(decide(T, st([[T - 30 * 60_000, "track"], [T - H, "snapshot"]]), { live: true, newMovements: 2, newTracks: 0 })).toBeNull();
    expect(decide(T, st([[T - 30 * 60_000, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 0, newTracks: 1 })).toBeNull();
    expect(decide(T, st([[T - 61 * 60_000, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 0, newTracks: 1 })).toBe("track");
  });
});
