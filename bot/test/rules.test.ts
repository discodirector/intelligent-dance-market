import { describe, expect, it } from "vitest";
import { decide, H, readyTracks, type SchedState } from "../src/rules.ts";

const T = 1_800_000_000_000;
const st = (posts: [number, any][]): SchedState => ({ posts: posts.map(([at, kind]) => ({ at, kind })) });

describe("rules", () => {
  it("pre-launch: teaser every 6h", () => {
    expect(decide(T, st([]), { live: false, newMovements: 0 })).toBe("teaser");
    expect(decide(T, st([[T - 5 * H, "teaser"]]), { live: false, newMovements: 3 })).toBeNull();
    expect(decide(T, st([[T - 6 * H, "teaser"]]), { live: false, newMovements: 0 })).toBe("teaser");
  });
  it("live: snapshot every 6h", () => {
    expect(decide(T, st([[T - 2 * H, "snapshot"]]), { live: true, newMovements: 0 })).toBeNull();
    expect(decide(T, st([[T - 6 * H, "snapshot"]]), { live: true, newMovements: 0 })).toBe("snapshot");
  });
  it("live: movement at most once per 2h", () => {
    expect(decide(T, st([[T - 119 * 60_000, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 2 })).toBeNull();
    expect(decide(T, st([[T - 2 * H, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 1 })).toBe("movement");
  });
  it("live: a queued track posts as soon as it is ready, ahead of movements", () => {
    expect(decide(T, st([[T - 60_000, "track"], [T - H, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 3, newTracks: 1 })).toBe("track");
    // a recent movement does not hold a track back
    expect(decide(T, st([[T - 5 * 60_000, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 3, newTracks: 1 })).toBe("track");
    // movements run on their own clock: a track post does not hold them back
    expect(decide(T, st([[T - 40 * 60_000, "track"], [T - 3 * H, "movement"]]), { live: true, newMovements: 3, newTracks: 0 })).toBe("movement");
  });
  it("live: a steady track queue cannot starve a due movement", () => {
    // due movement, queued track, last post a track -> the movement takes this slot
    expect(decide(T, st([[T - 5 * 60_000, "track"], [T - 3 * H, "movement"]]), { live: true, newMovements: 3, newTracks: 2 })).toBe("movement");
    // ... and the queue resumes on the next tick
    expect(decide(T + 300_000, st([[T, "movement"], [T - 5 * 60_000, "track"]]), { live: true, newMovements: 0, newTracks: 2 })).toBe("track");
    // last post was not a track: the track goes first
    expect(decide(T, st([[T - 5 * 60_000, "snapshot"], [T - 3 * H, "movement"]]), { live: true, newMovements: 3, newTracks: 1 })).toBe("track");
  });
  it("daily cap 24 in rolling 24h", () => {
    const full = st(Array.from({ length: 24 }, (_, i) => [T - (i + 1) * 59 * 60_000, "track"]));
    expect(decide(T, full, { live: true, newMovements: 5, newTracks: 1 })).toBeNull();
    const room = st(Array.from({ length: 23 }, (_, i) => [T - (i + 1) * 59 * 60_000, "track"]).concat([[T - 25 * H, "snapshot"]]) as any);
    expect(decide(T, room, { live: true, newMovements: 0, newTracks: 1 })).toBe("track");
  });
  it("held tracks wait in the queue until notBefore", () => {
    const q = [{ trackNo: 4, block: 10, notBefore: T + H }, { trackNo: 5, block: 20 }];
    expect(readyTracks(q, T).map((t) => t.trackNo)).toEqual([5]);
    expect(readyTracks(q, T + H).map((t) => t.trackNo)).toEqual([4, 5]);
    expect(readyTracks(undefined, T)).toEqual([]);
  });
});
