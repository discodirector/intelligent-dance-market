// Swap sources (swaps.ts) on real logs. Fixtures are raw eth_getLogs results saved by bot/scripts/station-probe.ts;
// the spot checks are the ETH amounts the explorers show for those txs (the pool's WETH Transfer in or out).
import { readFileSync } from "node:fs";
import { decodeEventLog, parseAbiItem, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  calibrationProblems, calibrationShift, calibrator, decodeSwapLogs, fdvWeiAtTick, getSqrtPriceAtTick, initialState, mutate, stationFingerprint, swapLogFilter, SWAP_EVENTS,
  tickAtRatio, V2_RULES, whaleWeiAtTick, type RawLog, type State, type SwapSource,
} from "../src/index.ts";

interface Fixture {
  chainId: number;
  source: SwapSource;
  token: string;
  symbol: string;
  logs: RawLog[];
}

function fixture(name: string): Fixture {
  const j = JSON.parse(readFileSync(new URL(`./fixtures/swaps/${name}.json`, import.meta.url), "utf8"));
  return { ...j, logs: j.logs.map((l: any) => ({ ...l, blockNumber: BigInt(l.blockNumber), blockTimestamp: l.blockTimestamp ? BigInt(l.blockTimestamp) : null })) };
}

/** [tx prefix, buy?, ETH] per fixture, read off the explorer's token transfers into / out of the pool. */
const SPOTS: Record<string, [string, boolean, number][]> = {
  "v2-pepe-eth": [["0x121507d9dd", false, 2.05999], ["0x0d815d2b9b", true, 0.00231296], ["0x3af727fcdd", true, 0.0766979]],
  "v3-pepe-eth": [["0x42048c86c0", false, 0.000170323], ["0xa28df50b8e", false, 0.0153068], ["0x753cf65306", true, 0.0141091]],
  "pancake-v3-pepe-eth": [["0x794e0b54b3", false, 0.00470132], ["0xca4e61825d", false, 0.139004], ["0xe2b4b62841", true, 0.0199547]],
  "v3-arb-arbitrum": [["0x6aea1d809b", true, 0.00778731], ["0x13d55690bb", false, 0.086284], ["0x7072ce8a30", false, 0.282082]],
  "v3-slipstream-aero-base": [["0x34d8e9640e", true, 0.132461], ["0xdd67239c0e", true, 0.0694256]],
  "aerodrome-v2-aero-base": [["0x81167ad042", false, 0.000829875], ["0xa55b4a63f1", false, 0.049519], ["0xc5daf56843", false, 0.0926514]],
};

/** Station-orientation tick (token wei per ETH wei) the pool should sit near: same price, any kind or side. */
const NEAR: Record<string, number> = {
  "v2-pepe-eth": 201_142,
  "v3-pepe-eth": 202_315,
  "pancake-v3-pepe-eth": 202_656,
  "v3-arb-arbitrum": 94_672,
  "v3-slipstream-aero-base": 79_790,
  "aerodrome-v2-aero-base": 79_470,
};

describe("decodeSwapLogs on real pools", () => {
  for (const [name, spots] of Object.entries(SPOTS)) {
    it(`${name}: explorer spot checks, ticks in the station orientation`, () => {
      const f = fixture(name);
      const swaps = decodeSwapLogs(f.source, f.logs);
      expect(swaps.length).toBeGreaterThan(0);
      for (const [tx, buy, ethAmt] of spots) {
        const s = swaps.find((x) => x.txHash.startsWith(tx))!;
        expect(s, tx).toBeDefined();
        expect(s.isBuy, tx).toBe(buy);
        expect(Number(s.quoteAmt) / 1e18 / ethAmt, tx).toBeCloseTo(1, 4);
      }
      // ETH = currency0 orientation: these tokens are worth less than ETH, so token per ETH > 1 and the tick > 0
      // whichever side WETH sits on in the pool (PEPE pools: WETH is token1, ARB/AERO pools: token0).
      for (const s of swaps) expect(Math.abs(s.tick - NEAR[name])).toBeLessThan(400);
      for (const s of swaps) expect(s.timestamp).toBeGreaterThan(1_700_000_000);
    });
  }

  it("v3 with ETH as token0 passes the pool tick through; as token1 inverts the price exactly", () => {
    for (const name of ["v3-arb-arbitrum", "v3-pepe-eth", "pancake-v3-pepe-eth"]) {
      const f = fixture(name);
      const swaps = decodeSwapLogs(f.source, f.logs);
      const swapLogs = f.logs.filter((l) => l.topics[0] === swapLogFilter(f.source).topics[0]);
      expect(swaps.length).toBe(swapLogs.length);
      swapLogs.forEach((l, i) => {
        const { args } = decodeEventLog({ abi: [SWAP_EVENTS[f.source.kind as "v3"]], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
        const t = swaps[i].tick;
        if (f.source.ethSide === 0) expect(t).toBe(args.tick);
        else {
          // floor(log_1.0001(1/p)) is -tick or -tick-1, and brackets 2^192/sqrtP^2 exactly.
          expect([-args.tick, -args.tick - 1]).toContain(t);
          const p2 = args.sqrtPriceX96 * args.sqrtPriceX96;
          expect(getSqrtPriceAtTick(t) ** 2n * p2 <= 1n << 384n).toBe(true);
          expect(getSqrtPriceAtTick(t + 1) ** 2n * p2 > 1n << 384n).toBe(true);
        }
      });
    }
  });

  it("v2 kinds take the tick from the Sync of the same swap (reserves after it)", () => {
    for (const name of ["v2-pepe-eth", "aerodrome-v2-aero-base"]) {
      const f = fixture(name);
      const swaps = decodeSwapLogs(f.source, f.logs);
      for (const s of swaps) {
        const sync = f.logs.find((l) => l.transactionHash === s.txHash && l.logIndex === s.logIndex - 1)!;
        expect(sync, s.txHash).toBeDefined();
        const r0 = BigInt("0x" + sync.data.slice(2, 66));
        const r1 = BigInt("0x" + sync.data.slice(66, 130));
        const [rEth, rToken] = f.source.ethSide === 0 ? [r0, r1] : [r1, r0];
        expect(s.tick).toBe(Math.floor(Math.log(Number(rToken) / Number(rEth)) / Math.log(1.0001)));
      }
      // Without its Sync a Swap is skipped, never decoded against stale reserves.
      const noSync = f.logs.filter((l) => l.topics[0] === swapLogFilter(f.source).topics[0]?.[0]);
      expect(decodeSwapLogs(f.source, noSync)).toEqual([]);
    }
  });

  it("a v4 log of another pool is skipped", () => {
    const f = fixture("v4-imd-eth");
    const other = { ...f.source, poolId: ("0x" + "11".repeat(32)) as Hex };
    expect(decodeSwapLogs(other, f.logs)).toEqual([]);
  });
});

describe("v4 IMD/ETH: the generic decoder reproduces data/virtual.ts as it was", () => {
  // site/src/data/virtual.ts before swaps.ts (2026-10-21): token = currency1, native ETH = currency0, trader side.
  const SWAP = parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)");
  function legacy(logs: RawLog[], poolId: Hex) {
    const out: { isBuy: boolean; quoteAmt: bigint; tick: number; blockNumber: bigint; timestamp: number }[] = [];
    const sorted = [...logs].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
    for (const l of sorted) {
      const { args } = decodeEventLog({ abi: [SWAP], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if (args.id.toLowerCase() !== poolId.toLowerCase()) continue;
      const tokenDelta = args.amount1;
      const ethDelta = args.amount0;
      if (tokenDelta === 0n) continue;
      out.push({ isBuy: tokenDelta > 0n, quoteAmt: ethDelta < 0n ? -ethDelta : ethDelta, tick: Number(args.tick), blockNumber: l.blockNumber, timestamp: Number(l.blockTimestamp) });
    }
    return out;
  }

  it("same inputs and the same state after every swap", () => {
    const f = fixture("v4-imd-eth");
    expect(f.source).toMatchObject({ kind: "v4", ethSide: 0, poolId: "0x415829f72e9f54531c26eae76f107618540e898a45d6ae35959e143f5faca704" });
    const want = legacy([...f.logs].reverse(), f.source.poolId!);
    const got = decodeSwapLogs(f.source, [...f.logs].reverse()).map((s) => ({ isBuy: s.isBuy, quoteAmt: s.quoteAmt, tick: s.tick, blockNumber: s.blockNumber, timestamp: s.timestamp! }));
    expect(got.length).toBe(60);
    expect(got).toEqual(want);
    let a: State = initialState();
    let b: State = initialState();
    for (let i = 0; i < want.length; i++) {
      a = mutate(a, want[i], undefined, V2_RULES).state;
      b = mutate(b, got[i], undefined, V2_RULES).state;
      expect(b).toEqual(a);
    }
  });
});

describe("filters and ticks", () => {
  it("swapLogFilter: v4 by poolId topic, v3 by pool + Swap, v2 kinds by pool + Swap|Sync", () => {
    const id = ("0x" + "ab".repeat(32)) as Hex;
    const pm = "0x000000000004444c5dc75cB358380D2e3dE08A90";
    expect(swapLogFilter({ kind: "v4", address: pm, poolId: id, ethSide: 0 })).toEqual({ address: pm, topics: ["0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f", id] });
    expect(swapLogFilter({ kind: "v3", address: "0x1", ethSide: 1 }).topics).toEqual(["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"]);
    expect(swapLogFilter({ kind: "pancake-v3", address: "0x1", ethSide: 1 }).topics).toEqual(["0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83"]);
    expect(swapLogFilter({ kind: "v2", address: "0x1", ethSide: 1 }).topics).toEqual([["0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"]]);
    expect(swapLogFilter({ kind: "aerodrome-v2", address: "0x1", ethSide: 0 }).topics).toEqual([["0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b", "0xcf2aa50876cdfbb541206f89af0ee78d44a2abf8d328e37fa4917f982149848a"]]);
    expect(() => swapLogFilter({ kind: "v4", address: pm, ethSide: 0 })).toThrow();
  });

  it("tickAtRatio = floor(log_1.0001(num/den)), saturating", () => {
    expect(tickAtRatio(1n, 1n)).toBe(0);
    expect(tickAtRatio(2n, 1n)).toBe(Math.floor(Math.log(2) / Math.log(1.0001)));
    expect(tickAtRatio(1n, 2n)).toBe(Math.floor(-Math.log(2) / Math.log(1.0001)));
    expect(tickAtRatio(10n ** 30n, 7n * 10n ** 21n)).toBe(Math.floor(Math.log(1e30 / 7e21) / Math.log(1.0001)));
    expect(tickAtRatio(0n, 1n)).toBe(-887272);
    expect(tickAtRatio(1n, 0n)).toBe(887272);
    expect(tickAtRatio(1n << 300n, 1n)).toBe(887272);
  });
});

describe("calibration", () => {
  const ALL = ["v2-pepe-eth", "v3-pepe-eth", "pancake-v3-pepe-eth", "v3-arb-arbitrum", "v3-slipstream-aero-base", "aerodrome-v2-aero-base", "v4-imd-eth"];

  it("absent, empty or ETH-neutral calibration decodes every fixture exactly as before, same state after every swap", () => {
    for (const name of ALL) {
      const f = fixture(name);
      const base = decodeSwapLogs(f.source, f.logs);
      for (const calibration of [{}, { supplyTickOffset: 0 }, { quotePerEth: "1" }, { supplyTickOffset: 0, quotePerEth: "1.000", quoteDecimals: 18 }]) {
        const got = decodeSwapLogs({ ...f.source, calibration }, f.logs);
        expect(got, `${name} ${JSON.stringify(calibration)}`).toEqual(base);
      }
      let a: State = initialState();
      let b: State = initialState();
      const got = decodeSwapLogs({ ...f.source, calibration: { quotePerEth: "1" } }, f.logs);
      base.forEach((sw, i) => {
        a = mutate(a, { ...sw, timestamp: sw.timestamp! }, undefined, V2_RULES).state;
        b = mutate(b, { ...got[i], timestamp: got[i].timestamp! }, undefined, V2_RULES).state;
        expect(b).toEqual(a);
      });
    }
  });

  it("supplyTickOffset: the rules' FDV becomes the token's real FDV (supply / price)", () => {
    // [fixture, totalSupply raw]: PEPE 420.69T x 1e18 (Ethereum), ARB 10B x 1e18, AERO ~1.8B x 1e18 (rounded).
    const cases: [string, bigint][] = [["v3-pepe-eth", 420_690_000_000_000n * 10n ** 18n], ["v3-arb-arbitrum", 10n ** 28n], ["aerodrome-v2-aero-base", 1_800_000_000n * 10n ** 18n]];
    for (const [name, supply] of cases) {
      const offset = Math.round(Math.log(1e27 / Number(supply)) / Math.log(1.0001));
      const f = fixture(name);
      const raw = decodeSwapLogs(f.source, f.logs);
      const cal = decodeSwapLogs({ ...f.source, calibration: { supplyTickOffset: offset } }, f.logs);
      cal.forEach((s, i) => {
        expect(s.tick).toBe(raw[i].tick + offset);
        expect(s.quoteAmt).toBe(raw[i].quoteAmt);
        // Real FDV in ETH wei: supply / (token wei per ETH wei) at the uncalibrated tick.
        const real = Number(supply) / 1.0001 ** raw[i].tick;
        expect(Number(fdvWeiAtTick(s.tick)) / real).toBeCloseTo(1, 3);
      });
    }
    // The PEPE whale line moves from the 0.005 ETH floor to K·sqrt(FDV): tens of ETH.
    const pepe = decodeSwapLogs({ ...fixture("v3-pepe-eth").source, calibration: { supplyTickOffset: -129_514 } }, fixture("v3-pepe-eth").logs);
    expect(whaleWeiAtTick(pepe[0].tick)).toBeGreaterThan(10n ** 19n);
  });

  it("quotePerEth: amounts to ETH wei at the frozen rate, tick to token per ETH (any quote decimals)", () => {
    // USDC-like quote, 6 decimals, 4000 per ETH: 4000 USDC = 1 ETH; 1.0001^shift = 4000e6 / 1e18.
    const usdc = calibrator({ quotePerEth: "4000", quoteDecimals: 6 })!;
    expect(usdc.amt(4_000_000_000n)).toBe(10n ** 18n);
    expect(usdc.amt(1n)).toBe(250_000_000n); // 1e-6 USDC = 2.5e-10 ETH
    expect(usdc.shift).toBe(tickAtRatio(4000n * 10n ** 6n, 10n ** 18n));
    expect(usdc.shift).toBe(Math.floor(Math.log(4e-9) / Math.log(1.0001)));
    // WMON-like quote, 18 decimals, a fractional rate: exact rational, floor.
    const mon = calibrator({ quotePerEth: "41250.5", quoteDecimals: 18, supplyTickOffset: 7 })!;
    expect(mon.amt(41_250_500_000_000_000_000_000n)).toBe(10n ** 18n);
    expect(mon.amt(10n ** 18n)).toBe((10n ** 18n * 10n * 10n ** 18n) / (412_505n * 10n ** 18n));
    expect(mon.shift).toBe(7 + tickAtRatio(412_505n, 10n));
    expect(calibrationShift(undefined)).toBe(0);
    // A pool quoted in a token worth half an ETH reads as the same pool in ETH: half the amounts, the price doubled.
    const f = fixture("v3-arb-arbitrum");
    const base = decodeSwapLogs(f.source, f.logs);
    const half = decodeSwapLogs({ ...f.source, calibration: { quotePerEth: "2" } }, f.logs);
    half.forEach((s, i) => {
      expect(s.quoteAmt).toBe(base[i].quoteAmt / 2n);
      expect(s.tick).toBe(base[i].tick + tickAtRatio(2n, 1n));
    });
  });

  it("validation and fingerprint", () => {
    expect(calibrationProblems(undefined)).toEqual([]);
    expect(calibrationProblems({ supplyTickOffset: -129514, quotePerEth: "0.25", quoteDecimals: 6 })).toEqual([]);
    expect(calibrationProblems({ supplyTickOffset: 1.5 })).toHaveLength(1);
    expect(calibrationProblems({ quotePerEth: 4000 })).toHaveLength(1);
    expect(calibrationProblems({ quotePerEth: "0" })).toHaveLength(1);
    expect(calibrationProblems({ quotePerEth: "1e3" })).toHaveLength(1);
    expect(calibrationProblems({ quoteDecimals: 6 })).toHaveLength(1);
    expect(calibrationProblems({ foo: 1 })).toHaveLength(1);
    expect(() => calibrator({ quotePerEth: "-1" })).toThrow();
    const src = fixture("v3-arb-arbitrum").source;
    const fp = stationFingerprint(42161, src, 1);
    expect(stationFingerprint(42161, { ...src, address: src.address.toUpperCase() as Hex }, 1n)).toBe(fp);
    expect(stationFingerprint(42161, { ...src, calibration: { supplyTickOffset: 1 } }, 1)).not.toBe(fp);
    expect(stationFingerprint(42161, src, 2)).not.toBe(fp);
  });
});
