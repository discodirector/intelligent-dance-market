// Hamster source (hamster.ts) on one real night of the recorder: the wheel -> rules inputs, through the v2 rules.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeHamster, emptyHamsterCarry, HAMSTER_SIZE_REF, HAMSTER_STEP_MM, hamsterSampleOf, initialDropState, initialRelativeState, mutate, V2_RULES, whaleWeiAtTick,
  type HamsterEvent, type HamsterInput, type HamsterSample, type State,
} from "../src/index.ts";

const night = JSON.parse(readFileSync(new URL("./fixtures/hamster/night.json", import.meta.url), "utf8"));
const samples: HamsterSample[] = night.samples.map(([at, rpmMilli, speedMmPerSecond, distanceMm]: [string, number, number, number]) => ({ t: Date.parse(at), rpmMilli, speedMmPerSecond, distanceMm }));
const events: HamsterEvent[] = night.events;

function play(inputs: HamsterInput[]) {
  let s: State = initialDropState(initialRelativeState());
  const tracks: number[] = [];
  for (const i of inputs) {
    const r = mutate(s, i, undefined, V2_RULES);
    s = r.state;
    if (r.event.trackComplete) tracks.push(i.t);
  }
  return { state: s, tracks };
}

describe("decodeHamster on a real night (2026-10-25/26)", () => {
  const { inputs, cues, carry } = decodeHamster(samples, events);
  const by = (via: string) => inputs.filter((i) => i.hamster.via === via);

  it("one BUY per 30 m of wheel, at the measurement that crossed it", () => {
    const runs = by("run");
    expect(runs.length).toBe(Math.floor(carry.total / HAMSTER_STEP_MM));
    expect(runs.every((i) => i.isBuy && i.hamster.distanceMm % HAMSTER_STEP_MM === 0)).toBe(true);
    // ~2 h of running at ~1 m/s
    expect(carry.total).toBeGreaterThan(6_500_000);
    expect(carry.total).toBeLessThan(8_000_000);
  });

  it("a SELL each time the wheel stops, a whale BUY per milestone", () => {
    let stops = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i - 1].rpmMilli > 0 && samples[i].rpmMilli === 0) stops++;
    expect(by("stop").length).toBe(stops);
    expect(by("stop").every((i) => !i.isBuy && i.quoteAmt === HAMSTER_SIZE_REF)).toBe(true);
    const ms = by("milestone");
    expect(ms.map((i) => i.hamster.kind)).toEqual(["daily_distance_milestone", "daily_distance_milestone", "daily_distance_milestone", "distance_streak"]);
    for (const m of ms) expect(m.quoteAmt).toBe(whaleWeiAtTick(m.tick));
  });

  it("time order, tempo held only inside one measurement", () => {
    for (let i = 1; i < inputs.length; i++) {
      expect(inputs[i].t).toBeGreaterThanOrEqual(inputs[i - 1].t);
      if (inputs[i].holdTempo) expect(inputs[i].t).toBe(inputs[i - 1].t);
    }
  });

  it("faster than his usual climbs the tiers, slower falls", () => {
    const runs = by("run");
    const fast = runs.filter((i) => i.quoteAmt > HAMSTER_SIZE_REF);
    const slow = runs.filter((i) => i.quoteAmt < HAMSTER_SIZE_REF);
    expect(fast.length).toBeGreaterThan(20);
    expect(slow.length).toBeGreaterThan(20);
    for (const i of runs) expect(i.quoteAmt).toBeLessThan(whaleWeiAtTick(i.tick) / 2n + 1n);
  });

  it("the night finishes 2-3 tracks under the v2 rules", () => {
    const { tracks } = play(inputs);
    expect(tracks.length).toBeGreaterThanOrEqual(2);
    expect(tracks.length).toBeLessThanOrEqual(3);
  });

  it("settlements and claims are cues, never inputs", () => {
    expect(cues.filter((c) => c.kind === "settlement").length).toBeGreaterThan(70);
    expect(cues.some((c) => c.kind === "claim")).toBe(true);
    expect(inputs.length).toBe(by("run").length + by("stop").length + by("milestone").length);
  });

  it("in batches with the carry = in one go", () => {
    let carry = emptyHamsterCarry();
    const got: HamsterInput[] = [];
    const cut = [0, 500, 900, 1400, 1801, samples.length];
    for (let k = 1; k < cut.length; k++) {
      const part = samples.slice(cut[k - 1], cut[k]);
      const evs = events.filter((e) => Date.parse(e.occurredAt) <= (part.at(-1)?.t ?? 0) + 120_000);
      // The feed repeats items: a batch sees everything up to its end, the carry drops what it has already read.
      const r = decodeHamster(part, evs, carry);
      got.push(...r.inputs);
      carry = r.carry;
    }
    const strip = (xs: HamsterInput[]) => xs.filter((i) => i.hamster.via !== "milestone").map((i) => JSON.stringify(i, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(strip(got)).toEqual(strip(inputs));
    expect(got.filter((i) => i.hamster.via === "milestone").length).toBe(by("milestone").length);
    expect(play(got).state).toEqual(play(inputs).state);
  });
});

describe("decodeHamster edges", () => {
  const T = Date.parse("2026-10-26T01:00:00Z");
  const run = (k: number, dist: number, speed = 1000, rpm = 70_000): HamsterSample => ({ t: T + k * 5000, rpmMilli: rpm, speedMmPerSecond: speed, distanceMm: dist });

  it("the day counter's reset counts from 0, not as a step back", () => {
    const r = decodeHamster([run(0, 4_990_000), run(1, 4_996_000), run(2, 2_000), run(3, 8_000)]);
    expect(r.carry.total).toBe(6_000 + 2_000 + 6_000);
  });

  it("duplicates and old measurements are skipped", () => {
    const a = decodeHamster([run(0, 0), run(1, 30_000), run(1, 30_000)]);
    expect(a.inputs.length).toBe(1);
    const b = decodeHamster([run(1, 30_000), run(2, 60_000)], [], a.carry);
    expect(b.inputs.map((i) => i.hamster.distanceMm)).toEqual([60_000]);
  });

  it("a recorder line -> a sample", () => {
    const line = { rx: 1, status: { measurement: { observedAt: "2026-10-26T01:00:05.000Z", rpmMilli: 81_000, speedMmPerSecond: 1185, distanceMm: 12_345 } } };
    expect(hamsterSampleOf(line)).toEqual({ t: T + 5000, rpmMilli: 81_000, speedMmPerSecond: 1185, distanceMm: 12_345 });
    expect(hamsterSampleOf({ status: { status: "unavailable" } })).toBeNull();
  });
});
