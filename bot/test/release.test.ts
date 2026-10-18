import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { completedTracks, postCut, releaseHeadline, selectTrack, trackStartKnown, withTrackStart, X_VIDEO_MAX_SECONDS, type TrackEntry } from "../src/lib/release.ts";
import { buildTimeline, type RawSwap } from "../src/lib/timeline.ts";
import { factsFromTimeline } from "../src/lib/facts.ts";
import { templateCaption, validateCaption, MAX_LEN } from "../src/caption/index.ts";
import { counterBars, planRelease, releaseBodyForm, releasePace, RELEASE_HEAT_MAX } from "../../packages/synth/src/release.ts";
import { decode, initialState } from "../../packages/synth/src/state.ts";

const tape: TrackEntry[] = JSON.parse(readFileSync(new URL("../../web/public/release-test.timeline.json", import.meta.url), "utf8"));
const dec = (e: { slot0: any; slot1: any }) => decode(e.slot0, e.slot1, { heatMax: RELEASE_HEAT_MAX });

describe("release track selection", () => {
  const ends = tape.map((e, i) => (e.trackComplete ? i : -1)).filter((i) => i >= 0);
  it("the committed synthetic tape completes at least two tracks", () => {
    expect(completedTracks(tape)).toEqual([1, 2, 3]);
    expect(ends.length).toBe(3);
  });
  it("default = the latest completed track, from the swap after the previous drop through its TrackComplete", () => {
    const s = selectTrack(tape);
    expect(s).toMatchObject({ trackNo: 3, start: ends[1] + 1, end: ends[2], complete: true, seedIndex: ends[1] });
    expect(s.end - s.start + 1).toBe(s.hookSwaps);
  });
  it("the first track starts at the tape start", () => {
    const s = selectTrack(tape, 1);
    expect(s).toMatchObject({ trackNo: 1, start: 0, end: ends[0], seedIndex: null, complete: true });
    expect(s.end + 1).toBe(s.hookSwaps);
  });
  it("tracks tile the tape and agree with the hook's swap counts", () => {
    let next = 0;
    for (const no of completedTracks(tape)) {
      const s = selectTrack(tape, no);
      expect(s.start).toBe(next);
      expect(s.end - s.start + 1).toBe(tape[s.end].trackComplete!.swaps);
      next = s.end + 1;
    }
  });
  it("the seed of a track is the state its previous TrackComplete left (fresh seed, heat 0)", () => {
    const s = selectTrack(tape, 2);
    const seed = dec(tape[s.seedIndex!]);
    const finished = dec(tape[s.seedIndex!].trackComplete!);
    expect(seed.heat).toBe(0);
    expect(finished.heat).toBe(1);
    expect(seed.patternId).toBe(finished.patternId + 1);
  });
  it("trackNo one past the last drop = the unfinished track; others throw", () => {
    const s = selectTrack(tape, 4);
    expect(s).toMatchObject({ complete: false, start: ends[2] + 1, end: tape.length - 1 });
    expect(() => selectTrack(tape, 9)).toThrow(/not on this timeline/);
    expect(() => selectTrack(tape.slice(0, ends[0]))).toThrow(/no completed track/);
  });
});

describe("release pacing", () => {
  it("one swap per bar on downbeats when it fits", () => {
    const p = releasePace(100, 120);
    expect(p.slotSteps).toBe(16);
    expect(p.swapSteps.slice(0, 4)).toEqual([0, 16, 32, 48]);
    expect(p.swapSteps.at(-1)).toBe(99 * 16);
    expect(p.bodyBars).toBe(100);
    expect(p.swapsPerBar).toBe(1);
  });
  it("the body is a multiple of 4 bars; the last state holds to the drop", () => {
    const p = releasePace(101, 120);
    expect(p.bodyBars).toBe(104);
    expect(p.swapSteps.at(-1)).toBe(100 * 16);
  });
  it("a long track is compressed to ~6 min with several swaps per bar, evenly", () => {
    const p = releasePace(1145, 120);
    // 360 s at 120 bpm = 180 bars, minus 8 intro and 8 outro.
    expect(p.bodyBars).toBe(164);
    expect(p.swapSteps.at(-1)!).toBeLessThan(164 * 16);
    expect(p.swapsPerBar).toBeCloseTo(1145 / 164, 5);
    const gaps = p.swapSteps.slice(1).map((s, i) => s - p.swapSteps[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });
  it("a short (whale-heavy) track holds each state longer, up to the minimum length", () => {
    // 180 s at 120 bpm = 90 bars, minus 16 = 74 → 76 (multiple of 4).
    const bars = releasePace(70, 120);
    expect(bars.bodyBars).toBe(76);
    expect(bars.slotSteps).toBe(16);
    const two = releasePace(10, 120);
    expect(two.slotSteps).toBe(7 * 16);
    expect(two.bodyBars).toBe(76);
    // 3 bars per swap would leave 16 bars of hold: an even spread on beats instead.
    const beats = releasePace(20, 120);
    expect(beats.bodyBars).toBe(76);
    expect(beats.slotSteps).toBe(60);
    expect(beats.swapSteps.every((s) => s % 4 === 0)).toBe(true);
    expect(76 * 16 - beats.swapSteps.at(-1)!).toBeLessThanOrEqual(80);
  });
  it("the pace is a parameter", () => {
    expect(releasePace(200, 120, { swapsPerBar: 2 }).swapSteps.slice(0, 3)).toEqual([0, 8, 16]);
    expect(releasePace(200, 120, { swapsPerBar: 2 }).bodyBars).toBe(100);
    expect(releasePace(100, 120, { swapsPerBar: 0.5, maxSeconds: 600 }).slotSteps).toBe(32);
    expect(releasePace(400, 120, { maxSeconds: 600 }).bodyBars).toBe(284);
  });
});

describe("release arc", () => {
  it("build, full, a break at saturation, then the rebuild right before the drop", () => {
    const f = releaseBodyForm(64, 32);
    expect(f.length).toBe(64);
    expect(f.slice(0, 8)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(f.slice(-4)).toEqual([28, 29, 30, 31]);
    expect(f.slice(32, 40)).toEqual([24, 25, 26, 27, 28, 29, 30, 31]);
    expect(f.slice(8, 32).every((b) => b >= 16 && b < 24)).toBe(true);
  });
  it("short bodies keep the build and the pre-drop rebuild", () => {
    expect(releaseBodyForm(8, null)).toEqual([12, 13, 14, 15, 28, 29, 30, 31]);
  });
  it("the bar counter is monotonic and congruent to the form bar mod 32", () => {
    const form = [0, 1, 2, 3, 12, 13, 16, 17, 16, 24, 28, 16];
    const c = counterBars(form);
    c.forEach((v, i) => {
      expect(v % 32).toBe(form[i]);
      if (i) expect(v).toBeGreaterThan(c[i - 1]);
    });
  });
  it("plan: drop exactly on the downbeat after the body, outro on the new seed, idle stays full", () => {
    const s = selectTrack(tape, 2);
    const slice = tape.slice(s.start, s.end + 1);
    const swaps = slice.map((e, i) => ({ state: i === slice.length - 1 ? dec(e.trackComplete!) : dec(e) }));
    const next = dec(slice.at(-1)!);
    const plan = planRelease({ seed: dec(tape[s.seedIndex!]), swaps, next });
    expect(plan.dropBar).toBe(plan.introBars + plan.bodyBars);
    const drops = plan.hits.filter((h) => h.trackDrop);
    expect(drops.length).toBe(1);
    expect(drops[0].gridTime).toBe(plan.dropTime);
    expect(drops[0].step).toBe(0);
    expect(drops[0].state).toBe(next);
    expect(plan.hits[plan.dropBar! * 16 - 1].state.heat).toBe(1);
    expect(plan.hits.every((h) => h.idle === null && h.nowSec === null)).toBe(true);
    expect(plan.seconds).toBeGreaterThan(170);
    expect(plan.seconds).toBeLessThan(370);
    expect(plan.formBars[plan.dropBar!]).toBe(16);
    expect(plan.formBars[plan.dropBar! - 1]).toBe(31);
    expect(plan.fadeAt).toBeGreaterThan(plan.dropTime!);
    expect(plan.sections[0]).toMatchObject({ name: "intro", from: 0 });
    expect(plan.sections.at(-1)!.name).toBe("outro");
    // Every hit plays the bar counter's form bar, and swaps land in order.
    plan.hits.forEach((h, g) => expect(h.bar % 32).toBe(plan.formBars[Math.floor(g / 16)]));
    expect(plan.swapTimes.every((t, i) => i === 0 || t >= plan.swapTimes[i - 1])).toBe(true);
    // Deterministic.
    const again = planRelease({ seed: dec(tape[s.seedIndex!]), swaps, next });
    expect(again.hits.map((h) => h.time)).toEqual(plan.hits.map((h) => h.time));
  });
  it("an unfinished track has no drop and holds its last state in the outro", () => {
    const plan = planRelease({ seed: { ...initialState(), heat: 0 }, swaps: [{ state: { ...initialState(), heat: 0.5 } }] });
    expect(plan.dropBar).toBeNull();
    expect(plan.hits.some((h) => h.trackDrop)).toBe(false);
    expect(plan.hits.at(-1)!.state.heat).toBe(0.5);
  });
});

describe("release post", () => {
  // The synthetic tape re-simulated with the decoded state, as the live watcher's entries look.
  const swaps: RawSwap[] = (tape as any[]).map((e) => ({ isBuy: e.isBuy, quoteAmt: BigInt(e.quoteAmt), tick: e.tick, blockNumber: BigInt(e.blockNumber), timestamp: e.ts }));
  const live = buildTimeline(swaps, undefined, "v2").entries;
  const ends = live.map((e, i) => (e.trackComplete ? i : -1)).filter((i) => i >= 0);

  it("re-simulating the committed tape gives the same slots (the tape is core mutate under V2 rules)", () => {
    expect(live.map((e) => [e.slot0, e.slot1])).toEqual((tape as any[]).map((e) => [e.slot0, e.slot1]));
  });
  it("a release that fits X is posted whole; a longer one posts the climb into the drop", () => {
    expect(postCut(120, 110)).toBeNull();
    const c = postCut(300, 280)!;
    expect(c.seconds).toBe(X_VIDEO_MAX_SECONDS);
    expect(c.start + c.seconds).toBeCloseTo(300, 6);
    expect(c.start).toBeLessThan(280);
    // A long outro: the clip ends 3/4 of the way past the drop at most.
    const l = postCut(600, 300, 100)!;
    expect(l).toEqual({ start: 275, seconds: 100 });
  });
  it("headline", () => {
    expect(releaseHeadline(3, 142, "Lofi House", "Dusty Keys")).toBe("TRACK #3 COMPLETE · 142 SWAPS · Lofi House / Dusty Keys");
  });
  it("live: reads earlier blocks until the track's start is on the tape", async () => {
    const window = live.slice(ends[2] - 40);
    expect(trackStartKnown(window)).toBe(false);
    const calls: number[] = [];
    const fetchEarlier = async (before: number) => {
      calls.push(before);
      const older = live.filter((e) => e.blockNumber < before);
      return older.slice(-50);
    };
    const r = await withTrackStart(window, fetchEarlier);
    expect(r.partial).toBe(false);
    const s = selectTrack(r.entries);
    expect(s.trackNo).toBe(3);
    expect(s.end - s.start + 1).toBe(live[ends[2]].trackComplete!.swaps);
    expect(calls.length).toBeGreaterThan(0);
    // The first track starts at the hook's first swap.
    expect(trackStartKnown(live.slice(0, ends[0] + 1))).toBe(true);
    // Nothing earlier to read: partial.
    const p = await withTrackStart(window, async () => []);
    expect(p.partial).toBe(true);
  });
  it("template caption with release facts is valid and carries the headline", () => {
    const s = selectTrack(live, 2);
    const track = live.slice(s.start, s.end + 1);
    const f = factsFromTimeline(track, { kind: "track", chain: "robinhood", pool: "IDM/IMD", videoSeconds: 140 });
    f.headline = releaseHeadline(2, track.length, "Trip-Hop", "Cold 808");
    f.release = { seconds: 349, bars: 136, swaps: track.length, swapsPerBar: 3.2, genre: "Trip-Hop", style: "Cold 808", chainGenres: ["Liquid DnB", "Wonky", "Trip-Hop"], clip: { from: 209, seconds: 140 } };
    const t = templateCaption(f);
    expect(t.split("\n")[0]).toBe(f.headline);
    expect(validateCaption(t, f)).toEqual([]);
    expect([...t].length).toBeLessThanOrEqual(MAX_LEN);
  });
});
