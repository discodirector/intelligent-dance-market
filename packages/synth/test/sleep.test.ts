import { describe, expect, it } from "vitest";
import { eraOf, genreKey, programFromPack, SLEEP_AFTER_SEC, SLEEP_SLOT_SEC, sleepAt, sleepState, styleOf, withSleep, type StationPack } from "../src/index.ts";

const awake = {
  key: "t-awake", name: "Awake", genres: ["acid", "electro"],
  styles: { acid: [{ id: "t-acid-a", name: "A", base: "acidhouse" }], electro: [{ id: "t-el-a", name: "E", base: "classic" }] },
} as StationPack;
const sleep = {
  key: "t-sleep", name: "Sleep", genres: ["ambientidm", "drone"],
  styles: {
    ambientidm: [{ id: "t-amb-1", name: "A1", base: "classic" }, { id: "t-amb-2", name: "A2", base: "boc" }, { id: "t-amb-3", name: "A3", base: "crystal" }],
    drone: [{ id: "t-dr-1", name: "D1", base: "classic" }, { id: "t-dr-2", name: "D2", base: "pulse" }],
  },
} as StationPack;
const program = withSleep(programFromPack(awake), sleep);
const NOW = 1_793_000_000;

describe("sleep mode", () => {
  it("awake genres only on the chain's epochs; the sleep styles are in the program", () => {
    for (let e = 0; e < 200; e++) expect(["acid", "electro"]).toContain(eraOf(e, program).id);
    expect(program.styles[0].styles.ambientidm?.map((s) => s.id)).toEqual(["t-amb-1", "t-amb-2", "t-amb-3"]);
    expect(withSleep(programFromPack(awake), sleep)).toBe(program);
  });

  it("asleep 10 min after the last input, never before the first", () => {
    expect(sleepAt(0, NOW, program, sleep)).toBeNull();
    expect(sleepAt(NOW - SLEEP_AFTER_SEC + 1, NOW, program, sleep)).toBeNull();
    const s = sleepAt(NOW - SLEEP_AFTER_SEC, NOW, program, sleep)!;
    expect(s.asleepSec).toBe(0);
    expect(s.slot).toBe(Math.floor(NOW / SLEEP_SLOT_SEC));
  });

  it("one style per 30 min slot, each style once per cycle, never twice in a row, the engine's own pick", () => {
    const seen: string[] = [];
    const first = Math.floor(NOW / SLEEP_SLOT_SEC);
    for (let k = 0; k < 50; k++) {
      const s = sleepAt(1, (first + k) * SLEEP_SLOT_SEC + 5, program, sleep)!;
      expect(styleOf(s.era, s.epoch, program).style.id).toBe(s.styleId);
      if (seen.length) expect(s.styleId).not.toBe(seen[seen.length - 1]);
      seen.push(s.styleId);
    }
    const cycle0 = Math.ceil(first / 5) * 5 - first;
    expect(new Set(seen.slice(cycle0, cycle0 + 5)).size).toBe(5);
    // the same slot: the same everywhere; keys move between slots
    const a = sleepAt(1, first * SLEEP_SLOT_SEC + 10, program, sleep)!;
    expect(sleepAt(1, first * SLEEP_SLOT_SEC + 1700, program, sleep)).toEqual({ ...a, asleepSec: a.asleepSec + 1690 });
    const keys = new Set(Array.from({ length: 20 }, (_, k) => { const s = sleepAt(1, (first + k) * SLEEP_SLOT_SEC, program, sleep)!; return genreKey(s.era, s.epoch); }));
    expect(keys.size).toBeGreaterThan(2);
  });

  it("the frozen state: pinned epoch, idle and heat off", () => {
    const s = sleepAt(1, NOW, program, sleep)!;
    const st = sleepState({ pattern: 1n, bass: 2n, swapCount: 9, lastTs: NOW - 900, bpm: 116, root: 3, mode: 1, patternId: 41, lastTick: 0, pressure: 0, intervalEma: 30, releaseCount: 0, heat: 0.5, trackNo: 2 }, s);
    expect(st.patternId).toBe(s.epoch * 4);
    expect(st.lastTs).toBe(0);
    expect(st.heat).toBe(0);
    expect(st.pattern).toBe(1n);
  });
});
