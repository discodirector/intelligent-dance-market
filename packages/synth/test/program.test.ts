import { describe, expect, it } from "vitest";
import {
  ERA_SCHEDULE,
  eraById,
  eraOf,
  genreStep,
  HOUSE_PROGRAM,
  initialState,
  planRelease,
  planSteps,
  STYLE_SCHEDULE,
  styleListAt,
  styleOf,
  stylesAt,
  type GenreId,
  type Program,
} from "../src/index.ts";

// Programs (program.ts): a station plays a subset of the genres with its own style lists. The house program must be
// exactly today's schedules (eras.test.ts / styles.test.ts pin them); a station program must keep the cycle rules.

const N = 1024;
const launch = STYLE_SCHEDULE[0].styles;

/** A station on `ids` with the house launch lists of those genres (or `styles` when given). */
function station(key: string, ids: readonly GenreId[], styles?: Program["styles"]): Program {
  return {
    key,
    eras: [{ fromEpoch: 0, ids }],
    styles: styles ?? [{ fromEpoch: 0, styles: Object.fromEntries(ids.map((id) => [id, launch[id]!])) }],
  };
}

/** The genre ids of epochs [0, n) in a program. */
const order = (p: Program | undefined, n = N) => Array.from({ length: n }, (_, e) => eraOf(e, p).id);

describe("house program", () => {
  it("is today's schedules", () => {
    expect(HOUSE_PROGRAM.key).toBe("idm");
    expect(HOUSE_PROGRAM.eras).toBe(ERA_SCHEDULE);
    expect(HOUSE_PROGRAM.styles).toBe(STYLE_SCHEDULE);
  });

  it("passing it changes nothing: genre, style, tempo", () => {
    for (let e = 0; e < 4096; e++) {
      const era = eraOf(e);
      expect(eraOf(e, HOUSE_PROGRAM)).toBe(era);
      expect(styleOf(era, e, HOUSE_PROGRAM)).toEqual(styleOf(era, e));
    }
    const state = { ...initialState(), patternId: 4 * 37 + 1, bpm: 101 };
    expect(genreStep(state, null, null, HOUSE_PROGRAM)).toEqual(genreStep(state));
  });

  it("a copy of the house schedules (fresh arrays, own caches) walks the same history", () => {
    const copy: Program = { key: "copy", eras: [...ERA_SCHEDULE], styles: [...STYLE_SCHEDULE] };
    expect(order(copy)).toEqual(order(undefined));
    for (let e = 0; e < N; e++) expect(styleOf(eraOf(e, copy), e, copy).style.id).toBe(styleOf(eraOf(e), e).style.id);
  });
});

describe("station program: a subset of the genres", () => {
  const ids: readonly GenreId[] = ["acid", "liquid", "drone"];
  const three = station("three", ids);

  it("cycles hold only the station's genres, each once per cycle, the first in listed order", () => {
    const seq = order(three);
    expect(seq.slice(0, 3)).toEqual(ids);
    for (let c = 0; c + 3 <= N; c += 3) expect([...seq.slice(c, c + 3)].sort()).toEqual([...ids].sort());
  });

  it("no repeat and no A-B-A across the seams", () => {
    const seq = order(three);
    for (let e = 1; e < N; e++) expect(seq[e]).not.toBe(seq[e - 1]);
    for (let e = 2; e < N; e++) expect(seq[e]).not.toBe(seq[e - 2]);
  });

  it("four and five genres: shuffled cycles (not one fixed order), still no repeat or A-B-A", () => {
    for (const pool of [["acid", "liquid", "drone", "wonky"], ["acid", "liquid", "drone", "wonky", "electro"]] as GenreId[][]) {
      const seq = order(station(`s${pool.length}`, pool));
      const n = pool.length;
      const cycles = new Set<string>();
      for (let c = 0; c + n <= N; c += n) {
        expect([...seq.slice(c, c + n)].sort()).toEqual([...pool].sort());
        cycles.add(seq.slice(c, c + n).join());
      }
      expect(cycles.size).toBeGreaterThan(1);
      for (let e = 1; e < N; e++) expect(seq[e]).not.toBe(seq[e - 1]);
      for (let e = 2; e < N; e++) expect(seq[e]).not.toBe(seq[e - 2]);
    }
  });

  it("two genres alternate (no repeat)", () => {
    const seq = order(station("two", ["acid", "drone"]));
    for (let e = 1; e < N; e++) expect(seq[e]).not.toBe(seq[e - 1]);
  });

  it("an appended pool takes effect at the first cycle that starts on or after its fromEpoch", () => {
    const grown: Program = { ...three, key: "grown", eras: [...three.eras, { fromEpoch: 31, ids: [...ids, "wonky"] }] };
    const seq = order(grown, 200);
    expect(seq.slice(0, 33)).toEqual(order(three, 33)); // cycles start at 0, 3, ... 30: the new pool starts at 33
    expect(seq.slice(0, 33)).not.toContain("wonky");
    expect(seq.slice(33, 37)).toContain("wonky");
    for (let e = 1; e < 200; e++) expect(seq[e]).not.toBe(seq[e - 1]);
  });

  it("walking a station never disturbs the house walk (caches are per schedule)", () => {
    const before = order(undefined, 64);
    order(three, 2048);
    order(station("other", ["electro", "wonky", "ambientidm"]), 2048);
    expect(order(undefined, 64)).toEqual(before);
  });
});

describe("station program: styles", () => {
  const ids: readonly GenreId[] = ["acid", "liquid", "drone"];
  const slow = { id: "slow", name: "Slow", bpm: [100, 100] as const };
  const fast = { id: "fast", name: "Fast", bpm: [140, 140] as const };
  const own = station("own", ids, [{ fromEpoch: 0, styles: { acid: [slow, fast], liquid: launch.liquid!, drone: launch.drone! } }]);

  it("rotation counts the genre's appearances in the station's own order", () => {
    const seen: Partial<Record<GenreId, number>> = {};
    for (let e = 0; e < N; e++) {
      const era = eraOf(e, own);
      const k = seen[era.id] ?? 0;
      seen[era.id] = k + 1;
      const list = stylesAt(era.id, e, own);
      expect(styleOf(era, e, own).style.id).toBe(list[k % list.length].id);
    }
  });

  it("the station's lists, not the house's", () => {
    expect(stylesAt("acid", 0, own).map((s) => s.id)).toEqual(["slow", "fast"]);
    expect(styleListAt("acid", 0).styles).toBe(launch.acid);
    expect(() => styleListAt("wonky", 0, own)).toThrow(/no styles/);
  });

  it("clock and release follow the program: the station's genre, style and tempo", () => {
    // The first epoch the station plays acid, as its first appearance (style "slow", 100 bpm).
    const e = order(own).indexOf("acid");
    const state = { ...initialState(), patternId: e * 4, bpm: 96 };
    expect(genreStep(state, null, null, own).tempo).toBe(100);
    const hits = planSteps([{ time: 0, state }], 2, null, 0, own);
    expect(hits.every((h) => h.tempo === 100)).toBe(true);
    const plan = planRelease({ seed: state, swaps: [{ state }] }, { program: own, minSeconds: 0 });
    expect(plan.program).toBe(own);
    expect(plan.genre).toMatchObject({ epoch: e, era: "acid", style: "slow" });
    expect(plan.hits.every((h) => h.tempo === 100)).toBe(true);
    // The house plays its own genre at that epoch.
    expect(planRelease({ seed: state, swaps: [{ state }] }, { minSeconds: 0 }).genre.era).toBe(eraOf(e).id);
    expect(eraById("acid")).toBe(eraOf(e, own));
  });
});
