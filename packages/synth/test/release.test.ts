import { describe, expect, it } from "vitest";
import { arrange, counterBars, eraOf, initialState, planRelease, releaseGenre, sectionAt, styleFeel, styleOf, type SequencerState } from "../src/index.ts";

const base = (): SequencerState => ({ ...initialState(), heat: 0, trackNo: 0 });

/** A toy track: bits fill one per swap, the last swap holds the finished track at full heat. */
function track(n: number) {
  let pattern = base().pattern;
  const swaps = Array.from({ length: n }, (_, i) => {
    pattern |= 1n << BigInt((i * 7) % 64);
    return { state: { ...base(), pattern, swapCount: i + 1, heat: i === n - 1 ? 1 : Math.min(1, Math.max(0, (i - n + 16) / 16)) } };
  });
  return { seed: base(), swaps, next: { ...base(), patternId: 1, trackNo: 1 } };
}

describe("release plan", () => {
  it("every bar is a bar of the live form, so arrange() sees exactly what the live loop would", () => {
    const plan = planRelease(track(90));
    for (let r = 0; r < plan.bars; r++) {
      const hit = plan.hits[r * 16];
      expect(sectionAt(hit.bar)).toEqual(sectionAt(plan.formBars[r]));
      expect(arrange(hit.state, hit.bar).section.name).toBe(sectionAt(plan.formBars[r]).name);
    }
    expect(counterBars(plan.formBars)).toEqual(plan.hits.filter((h) => h.step === 0).map((h) => h.bar));
  });
  it("intro on the seed, one swap per downbeat, drop on the downbeat after the last swap", () => {
    const t = track(90);
    const plan = planRelease(t, { minSeconds: 0 });
    expect(plan.pace.slotSteps).toBe(16);
    expect(plan.hits.slice(0, plan.introBars * 16).every((h) => h.state === t.seed)).toBe(true);
    t.swaps.forEach((s, k) => expect(plan.hits[(plan.introBars + k) * 16].state).toBe(s.state));
    expect(plan.dropBar).toBe(plan.introBars + plan.bodyBars);
    expect(plan.hits[plan.dropBar! * 16]).toMatchObject({ trackDrop: true, step: 0 });
    expect(plan.hits[plan.dropBar! * 16].state).toBe(t.next);
    expect(plan.hits.at(-1)!.gridTime + plan.hits.at(-1)!.duration).toBeCloseTo(plan.seconds, 9);
  });
  it("whale cues land like live: a sell on its step, a buy on the next quarter", () => {
    const t = track(40);
    (t.swaps[3] as any).drop = { track: 1, fill: false };
    (t.swaps[5] as any).drop = { track: 2, fill: true, mask: 0x1111 };
    const plan = planRelease(t, { swapsPerBar: 4, minSeconds: 0 });
    const at = (k: number) => plan.introBars * 16 + plan.pace.swapSteps[k];
    const drops = plan.hits.map((h, g) => (h.drop ? g : -1)).filter((g) => g >= 0);
    expect(plan.pace.swapSteps.slice(0, 6)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(drops).toEqual([at(3), at(5)]);
    // Eight swaps per bar: a buy on an off-beat 8th still waits for the quarter.
    const t2 = track(40);
    (t2.swaps[1] as any).drop = { track: 2, fill: true };
    const p2 = planRelease(t2, { swapsPerBar: 8, minSeconds: 0 });
    const g2 = p2.hits.findIndex((h) => h.drop);
    expect(p2.introBars * 16 + p2.pace.swapSteps[1]).toBe(p2.introBars * 16 + 2);
    expect(g2).toBe(p2.introBars * 16 + 4);
  });
  it("plays one genre instance from start to end: the epoch the track finished in", () => {
    // Seed in epoch 0 (Liquid DnB, 170+ bpm), the body crosses into epoch 1, the next seed is in epoch 2.
    const t = track(60);
    t.swaps.forEach((s, i) => (s.state.patternId = i < 20 ? 0 : 4 + (i % 4)));
    t.next = { ...t.next, patternId: 8 };
    const plan = planRelease(t);
    const g = releaseGenre(t);
    expect(plan.genre).toEqual(g);
    expect(g.epoch).toBe(1);
    expect(g.era).toBe(eraOf(1).id);
    expect(g.style).toBe(styleOf(eraOf(1), 1).style.id);
    const [lo, hi] = styleFeel(eraOf(1), styleOf(eraOf(1), 1).style).bpm;
    for (const h of plan.hits) expect(h.tempo! >= lo && h.tempo! <= hi).toBe(true);
    // Unfinished: the last swap decides; no swaps: the seed.
    expect(releaseGenre({ seed: t.seed, swaps: [] }).epoch).toBe(0);
  });
  it("bounds hold for any tempo mix", () => {
    for (const n of [5, 40, 200, 900, 3000]) {
      const plan = planRelease(track(n));
      expect(plan.seconds).toBeLessThanOrEqual(360 + 1e-6);
      expect(plan.bars % 4).toBe(0);
    }
  });
});

describe("release NFT cues", () => {
  it("a collection's cues land as live lands them; no cue, no change", () => {
    const plain = planRelease(track(40), { minSeconds: 0 });
    expect(plain.hits.some((h) => h.sale || h.lock || h.page || h.overprint)).toBe(false);
    const t = track(40);
    (t.swaps[3] as any).sale = { pct: 200, mask: 5 };
    (t.swaps[7] as any).lock = { points: 1200 };
    (t.swaps[9] as any).page = { rel: 140 };
    const plan = planRelease(t, { minSeconds: 0 });
    // One swap per bar: each lands on a downbeat, so every cue plays on that downbeat.
    const at = (k: number) => plan.hits[(plan.introBars + k) * 16];
    expect(at(3).sale).toEqual({ pct: 200, mask: 5 });
    expect(at(7).lock).toEqual({ points: 1200 });
    expect(at(9).page).toEqual({ rel: 140 });
    expect(plan.hits.filter((h) => h.sale || h.lock || h.page).length).toBe(3);
    // Everything else is the plain plan's.
    expect(plan.hits.map((h) => [h.time, h.state])).toEqual(plain.hits.map((h) => [h.time, h.state]));
  });
});
