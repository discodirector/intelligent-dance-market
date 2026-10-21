import { describe, expect, it } from "vitest";
import { blockTimes, TIME_ANCHOR } from "../src/live.ts";

// A chain making exactly 10 blocks per second from block 0 at t = 1_000_000.
const timeOf = (b: bigint) => 1_000_000 + Number(b) / 10;
const fake = () => {
  const calls: bigint[] = [];
  const client = { getBlock: async ({ blockNumber }: { blockNumber: bigint }) => (calls.push(blockNumber), { timestamp: BigInt(Math.floor(timeOf(blockNumber))) }) };
  return { client: client as any, calls };
};

describe("block times", () => {
  it("a zero blockTimestamp counts as missing (Robinhood's RPC on recent logs)", async () => {
    const { client, calls } = fake();
    const ts = await blockTimes(client, [{ blockNumber: 5000n, blockTimestamp: 0n }, { blockNumber: 7000n, blockTimestamp: 1234n }]);
    expect(ts.get(5000n)).toBe(Math.floor(timeOf(5000n)));
    expect(ts.get(7000n)).toBe(1234);
    expect(calls).toEqual([5000n]);
  });
  it("a backfill reads anchors, not one block per log", async () => {
    const { client, calls } = fake();
    const logs = Array.from({ length: 500 }, (_, i) => ({ blockNumber: 93_576_944n + BigInt(i * 37), blockTimestamp: 0n }));
    const ts = await blockTimes(client, logs);
    expect(calls.length).toBeLessThan(20);
    for (const l of logs) expect(Math.abs(ts.get(l.blockNumber)! - timeOf(l.blockNumber))).toBeLessThanOrEqual(1);
    expect(TIME_ANCHOR).toBe(2500n);
  });
});
