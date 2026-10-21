// Checkpoints (checkpoint.ts): starting from a checkpoint's slots and replaying the blocks after it must give the
// state of the full replay from genesis, after every swap, and the same track numbers and lengths. The replay loop
// below is the site's (data/virtual.ts): mutate with V2_RULES, trackStart for TrackDone.swaps.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkpointProblem, checkpointState, CHECKPOINT_VERSION, decodeSwapLogs, encode, initialDropState, initialRelativeState, mutate, stationFingerprint, V2_RULES, V2_SLOTS,
  type MutationInput, type State, type StationCheckpoint, type SwapSource,
} from "../src/index.ts";

interface Step { state: State; trackDone?: { trackNo: number; swaps: number } }

/** The site's loop from (state, trackStart) over swaps. */
function replay(start: State, trackStart: number, swaps: MutationInput[]): { steps: Step[]; state: State; trackStart: number } {
  let state = start;
  const steps: Step[] = [];
  for (const sw of swaps) {
    const r = mutate(state, sw, undefined, V2_RULES);
    state = r.state;
    const tc = r.event.trackComplete;
    const step: Step = { state };
    if (tc) {
      step.trackDone = { trackNo: tc.trackNo, swaps: tc.swapCount - trackStart };
      trackStart = tc.swapCount;
    }
    steps.push(step);
  }
  return { steps, state, trackStart };
}

const hex = (v: bigint) => "0x" + v.toString(16);
const initial = () => initialDropState(initialRelativeState());

/** What the bot publishes after reading through `block` (JSON round trip included). */
function checkpointAt(key: string, fingerprint: string, block: number, state: State, trackStart: number): StationCheckpoint {
  const s = encode(state, V2_SLOTS);
  const cp: StationCheckpoint = {
    version: CHECKPOINT_VERSION, key, fingerprint, block, slot0: hex(s.slot0), slot1: hex(s.slot1),
    swapCount: state.swapCount, trackNo: state.trackNo ?? 0, trackStartSwap: trackStart, generatedAt: "2026-10-21T00:00:00Z", recent: [],
  };
  return JSON.parse(JSON.stringify(cp));
}

/** Deterministic swap stream: several swaps per block, bursts of buys (so tracks drop), sizes over five decades. */
function synthetic(n: number): MutationInput[] {
  let x = 0x2545f491;
  const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out: MutationInput[] = [];
  let block = 1_000_000;
  let ts = 1_760_000_000;
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.6) {
      block += 1 + Math.floor(rnd() * 40);
      ts += 1 + Math.floor(rnd() * (rnd() < 0.01 ? 5000 : 30));
    }
    const wei = BigInt(Math.floor(10 ** (13 + rnd() * 4.3)));
    out.push({ isBuy: rnd() < (i % 600 < 450 ? 0.92 : 0.3), quoteAmt: wei, tick: 140_000 + Math.floor(rnd() * 2000), blockNumber: block, timestamp: ts });
  }
  return out;
}

function checkSplits(name: string, swaps: MutationInput[], fingerprint: string) {
  const full = replay(initial(), 0, swaps);
  const blocks = [...new Set(swaps.map((s) => Number(s.blockNumber)))];
  // Every 15th block boundary, plus the blocks right after each drop (trackStart moves there).
  const drops = full.steps.flatMap((s, i) => (s.trackDone ? [Number(swaps[i].blockNumber)] : []));
  const cuts = [...new Set([blocks[0] - 1, ...blocks.filter((_, i) => i % 15 === 0), ...drops, blocks[blocks.length - 1]])];
  for (const cut of cuts) {
    const before = swaps.filter((s) => Number(s.blockNumber) <= cut);
    const after = swaps.filter((s) => Number(s.blockNumber) > cut);
    const head = replay(initial(), 0, before);
    const cp = checkpointAt(name, fingerprint, cut, head.state, head.trackStart);
    expect(checkpointProblem(cp, { key: name, fingerprint, genesisBlock: blocks[0] })).toBeNull();
    const tail = replay(checkpointState(cp), cp.trackStartSwap, after);
    expect(tail.state, `${name} cut ${cut}`).toEqual(full.state);
    expect(tail.steps, `${name} cut ${cut}`).toEqual(full.steps.slice(before.length));
  }
  return { swaps: swaps.length, tracks: full.steps.filter((s) => s.trackDone).length, cuts: cuts.length };
}

describe("checkpoint replay = full replay", () => {
  it("synthetic stream: every cut, tracks dropping across cuts", () => {
    const r = checkSplits("synthetic", synthetic(3000), "fp");
    expect(r.tracks).toBeGreaterThan(20); // 39 drops, 164 cuts
  });

  it("real pools (fixtures): every block boundary", () => {
    for (const name of ["v2-pepe-eth", "v3-pepe-eth", "v3-arb-arbitrum", "aerodrome-v2-aero-base", "v4-imd-eth"]) {
      const j = JSON.parse(readFileSync(new URL(`./fixtures/swaps/${name}.json`, import.meta.url), "utf8"));
      const src: SwapSource = { ...j.source, calibration: name === "v4-imd-eth" ? undefined : { supplyTickOffset: -20_000 } };
      const logs = j.logs.map((l: any) => ({ ...l, blockNumber: BigInt(l.blockNumber), blockTimestamp: l.blockTimestamp ? BigInt(l.blockTimestamp) : null }));
      const swaps = decodeSwapLogs(src, logs).map((s) => ({ isBuy: s.isBuy, quoteAmt: s.quoteAmt, tick: s.tick, blockNumber: s.blockNumber, timestamp: s.timestamp! }));
      checkSplits(name, swaps, stationFingerprint(j.chainId, src, 1));
    }
  });

  it("a checkpoint for another stream, a future block or broken slots is refused (full replay instead)", () => {
    const st = replay(initial(), 0, synthetic(200)).state;
    const want = { key: "k", fingerprint: "fp", genesisBlock: 1_000_000, head: 2_000_000 };
    const ok = checkpointAt("k", "fp", 1_500_000, st, 0);
    expect(checkpointProblem(ok, want)).toBeNull();
    expect(checkpointProblem(null, want)).toMatch(/object/);
    expect(checkpointProblem({ ...ok, version: 2 }, want)).toMatch(/version/);
    expect(checkpointProblem({ ...ok, key: "other" }, want)).toMatch(/key/);
    expect(checkpointProblem({ ...ok, fingerprint: "fp2" }, want)).toMatch(/another source/);
    expect(checkpointProblem({ ...ok, block: 2_000_001 }, want)).toMatch(/past the head/);
    expect(checkpointProblem({ ...ok, block: 999_998 }, want)).toMatch(/before genesis/);
    expect(checkpointProblem({ ...ok, swapCount: ok.swapCount + 1 }, want)).toMatch(/disagree/);
    expect(checkpointProblem({ ...ok, slot0: "nope" }, want)).toMatch(/hex/);
    expect(checkpointProblem({ ...ok, trackStartSwap: ok.swapCount + 1 }, want)).toMatch(/trackStartSwap/);
  });
});
