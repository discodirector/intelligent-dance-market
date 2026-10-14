import { describe, expect, it } from "vitest";
import { decide, H, type SchedState } from "../src/rules.ts";

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
  it("live: movement at most once per hour", () => {
    expect(decide(T, st([[T - 30 * 60_000, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 2 })).toBeNull();
    expect(decide(T, st([[T - 61 * 60_000, "movement"], [T - H, "snapshot"]]), { live: true, newMovements: 1 })).toBe("movement");
  });
  it("daily cap 6 in rolling 24h", () => {
    const six = st(Array.from({ length: 6 }, (_, i) => [T - (i + 1) * 3 * H, "movement"]));
    expect(decide(T, six, { live: true, newMovements: 5 })).toBeNull();
    const five = st(Array.from({ length: 5 }, (_, i) => [T - (i + 1) * 3 * H, "movement"]).concat([[T - 25 * H, "snapshot"]]) as any);
    expect(decide(T, five, { live: true, newMovements: 5 })).toBe("movement");
  });
});
