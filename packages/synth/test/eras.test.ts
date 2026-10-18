import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ERA_SCHEDULE, ERAS, eraOf } from "../src/eras.ts";

// The genre of a past epoch must never change once the app is live: bot posts, recordings and replays name it.
// FROZEN_EPOCHS covers epochs 0..4095 (index digits). If this test fails, a change rewrote history: revert it and
// append an ERA_SCHEDULE entry from a future epoch instead. Only raise FROZEN_EPOCHS with a digest that still
// matches the old prefix.
const FROZEN_EPOCHS = 4096;
// Re-pinned 2026-10-18, before launch: Industrial left, the owner's first-cycle order, then shuffled cycles.
const FROZEN_SHA256 = "d8c74e5df4528a7313bae7ade5b018ca4f12e2726d8ae74470cc8249815bc426";

describe("genre history", () => {
  it("the genre of every frozen epoch is unchanged", () => {
    const seq = Array.from({ length: FROZEN_EPOCHS }, (_, e) => eraOf(e).index).join("");
    expect(createHash("sha256").update(seq).digest("hex")).toBe(FROZEN_SHA256);
  });

  it("neighbouring epochs never share a genre", () => {
    for (let e = 1; e < FROZEN_EPOCHS; e++) expect(eraOf(e).index).not.toBe(eraOf(e - 1).index);
  });

  it("the schedule starts at epoch 0, only moves forward, and names real genres", () => {
    expect(ERA_SCHEDULE[0].fromEpoch).toBe(0);
    for (let i = 1; i < ERA_SCHEDULE.length; i++) {
      expect(ERA_SCHEDULE[i].fromEpoch).toBeGreaterThan(ERA_SCHEDULE[i - 1].fromEpoch);
    }
    const ids = new Set(ERAS.map((e) => e.id));
    for (const entry of ERA_SCHEDULE) for (const id of entry.ids) expect(ids.has(id)).toBe(true);
  });

  it("ERAS indices match their position (append-only list)", () => {
    ERAS.forEach((era, i) => expect(era.index).toBe(i));
  });
});
