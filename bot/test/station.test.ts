// The bot's IMD/ETH station must read the same pool from the same block as the site's ?net=imd-eth (registry entry),
// or the two count different tracks.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkpointProblem, checkpointState, initialDropState, initialRelativeState, mutate, stationFingerprint, V2_RULES, type State, type StationCheckpoint,
} from "@swarm-sequencer/core";
import { decodeFor } from "../src/lib/hookRules.ts";
import { quoteAmtOf, type RawSwap, type TimelineEntry } from "../src/lib/timeline.ts";
import {
  CHECKPOINT_RECENT, checkpointOf, emptyCache, extendCache, IMD_STATION, loadRegistry, stationFromEntry, writeCheckpoint, type BotStation,
} from "../src/station.ts";

describe("station registry", () => {
  const reg = loadRegistry();

  it("IMD_STATION matches stations/registry.json imd-eth", () => {
    const st = stationFromEntry(reg.stations.find((s) => s.key === IMD_STATION.key)!, reg);
    expect(st.source).toEqual(IMD_STATION.source);
    expect(st.genesisBlock).toBe(IMD_STATION.genesisBlock);
    expect(st.chainId).toBe(IMD_STATION.chainId);
  });

  it("every played entry becomes a bot station with its chain's log chunk", () => {
    for (const e of reg.stations.filter((s) => s.kind !== "hook" && s.kind !== "hamster")) {
      const st = stationFromEntry(e, reg);
      expect(st.maxChunk).toBe(BigInt(reg.chains[String(e.chainId)].logChunk));
      expect(st.rpcUrls!.length).toBeGreaterThan(0);
    }
    expect(() => stationFromEntry(reg.stations.find((s) => s.kind === "hook")!, reg)).toThrow();
    // the hamster reads its published night (updateHamsterStation), not logs
    expect(() => stationFromEntry(reg.stations.find((s) => s.kind === "hamster")!, reg)).toThrow(/published night/);
  });
});

describe("station cache and checkpoint (what the site starts from)", () => {
  // A real week of the IMD/ETH pool plus a run of small buys that saturates the grid, so tracks drop.
  const tl: TimelineEntry[] = JSON.parse(readFileSync(new URL("../data/imd-eth-7d.timeline.json", import.meta.url), "utf8"));
  const last = tl.at(-1)!;
  const swaps: RawSwap[] = [
    ...tl.map((e) => ({ isBuy: e.isBuy, quoteAmt: quoteAmtOf(e), tick: e.tick, blockNumber: BigInt(e.blockNumber), timestamp: e.ts, txHash: e.txHash, logIndex: e.logIndex })),
    ...Array.from({ length: 400 }, (_, i) => ({
      isBuy: i % 5 !== 4, quoteAmt: 2_500_000_000_000_000n, tick: last.tick + ((i * 37) % 600) - 300,
      blockNumber: BigInt(last.blockNumber + 1 + (i >> 1)), timestamp: last.ts + 12 * (i + 1), txHash: `0x${i.toString(16).padStart(64, "0")}`, logIndex: i & 1,
    })),
  ];
  // The week predates the station's genesis: a station on the same pool starting at its first swap.
  const st: BotStation = { ...IMD_STATION, genesisBlock: BigInt(tl[0].blockNumber) };
  const headOf = (n: number) => Number(swaps[n - 1].blockNumber);
  /** Bot cache read in pieces ending at the given swap counts (block-aligned), JSON round trip between reads. */
  function inPieces(ends: number[]) {
    let c = emptyCache(st);
    let at = 0;
    for (const end of ends) {
      extendCache(c, swaps.slice(at, end), headOf(end));
      c = JSON.parse(JSON.stringify(c));
      at = end;
    }
    return c;
  }
  /** Swap counts that end a block. */
  const cuts = swaps.flatMap((s, i) => (i + 1 < swaps.length && swaps[i + 1].blockNumber !== s.blockNumber ? [i + 1] : []));

  it("the cache read in pieces equals one read: state, entries, track lengths", () => {
    const whole = inPieces([swaps.length]);
    expect(whole.entries.filter((e) => e.trackComplete).length).toBeGreaterThan(1);
    for (const k of cuts.filter((_, i) => i % 50 === 0)) {
      const split = inPieces([k, swaps.length]);
      expect(split).toEqual(whole);
    }
  });

  it("checkpoint + the site's replay of the newer swaps = the full replay, after every swap", () => {
    const full: { state: State; swaps?: number }[] = [];
    let s: State = initialDropState(initialRelativeState());
    const play = (from: State, ts0: number, list: RawSwap[], out: { state: State; swaps?: number }[]) => {
      let state = from;
      let t0 = ts0;
      for (const sw of list) {
        const r = mutate(state, sw, undefined, V2_RULES);
        state = r.state;
        const tc = r.event.trackComplete;
        out.push(tc ? { state, swaps: tc.swapCount - t0 } : { state });
        if (tc) t0 = tc.swapCount;
      }
      return state;
    };
    s = play(s, 0, swaps, full);
    const drops = full.filter((x) => x.swaps !== undefined);
    expect(drops.length).toBeGreaterThan(1);
    // Every block boundary around the drops, and every 25th elsewhere.
    const dropAt = full.flatMap((x, i) => (x.swaps !== undefined ? [i] : []));
    const picks = cuts.filter((k, i) => i % 25 === 0 || dropAt.some((d) => Math.abs(d - k) < 3));
    for (const k of picks) {
      const cp: StationCheckpoint = JSON.parse(JSON.stringify(checkpointOf(st, inPieces([k]))));
      expect(checkpointProblem(cp, { key: "imd-eth", fingerprint: stationFingerprint(1, st.source, st.genesisBlock), genesisBlock: Number(st.genesisBlock), head: headOf(swaps.length) })).toBeNull();
      expect(cp.block).toBe(headOf(k));
      const tail: { state: State; swaps?: number }[] = [];
      const end = play(checkpointState(cp), cp.trackStartSwap, swaps.filter((x) => Number(x.blockNumber) > cp.block), tail);
      expect(end).toEqual(s);
      expect(tail).toEqual(full.slice(k));
      // The tape it carries: the last swaps before the checkpoint, the newest one at its state.
      expect(cp.recent.length).toBe(Math.min(CHECKPOINT_RECENT, k));
      if (k) expect(decodeFor(cp.recent.at(-1)!.slot0, cp.recent.at(-1)!.slot1, "v2")).toEqual(full[k - 1].state);
    }
  });

  it("the bot's IMD/ETH checkpoint fits the site's registry station (same fingerprint)", () => {
    const reg = loadRegistry();
    const e = reg.stations.find((x) => x.key === IMD_STATION.key)!;
    const fromReg = stationFromEntry(e, reg);
    expect(stationFingerprint(1, IMD_STATION.source, IMD_STATION.genesisBlock)).toBe(stationFingerprint(e.chainId, fromReg.source, e.genesisBlock));
  });

  it("calibration travels from the registry entry to the swap source", () => {
    const reg = loadRegistry();
    const e = { ...reg.stations.find((x) => x.key === IMD_STATION.key)!, calibration: { supplyTickOffset: 5 } };
    expect(stationFromEntry(e, reg).source.calibration).toEqual({ supplyTickOffset: 5 });
    expect(stationFromEntry(reg.stations.find((x) => x.key === IMD_STATION.key)!, reg).source).not.toHaveProperty("calibration");
  });

  it("writeCheckpoint writes <key>.checkpoint.json whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "cp-"));
    const cp = checkpointOf(st, inPieces([cuts[3]]));
    const path = writeCheckpoint(dir, cp);
    expect(path.endsWith("imd-eth.checkpoint.json")).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(JSON.parse(JSON.stringify(cp)));
    expect(existsSync(path + ".tmp")).toBe(false);
  });
});
