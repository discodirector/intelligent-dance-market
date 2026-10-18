# V2 callback gas and verification report

Measured locally on **2026-10-18** (re-measured after the FDV-scaled whale threshold and satBits 44), Foundry 1.8.5 (`51a52c59cffd940f76eddd0b4bb1791aa4b5ac7f`), Solidity 0.8.26, Cancun, optimizer 200, via IR, metadata hash `none`, and the pinned genuine Uniswap v4 PoolManager. No RPC, private key, broadcast, or deployment was used.

V2 is relative + accumulation + heat/drop, with the TS defaults: **44 saturated bits, heatMax 16, silence reset at 3600 seconds, sellCool 1, noopHeat on**, and the **FDV-scaled whale threshold** (SPEC §3.1: `C * getSqrtPriceAtTick(-tick) >> 96`, clamped to [0.005, 50] ETH). The state still occupies physical slots 0 and 1. `releaseCount` and `TrackReleased` remain reserved.

## Full cold callback measurements

The launch hook pairs IDM with **native ETH** (`address(0)`, always currency0); ERC20 quotes are still supported and measured in both sort orders. Normal swaps are 0.0025 ETH; whales are exactly the threshold at the pool's tick. The whale threshold costs one `TickMath.getSqrtPriceAtTick`, whose cost grows with the number of set bits in |tick|, so the hook is measured at two prices: **tick 193380 (launch FDV 4 ETH, 10 set bits; the realistic case)** and tick 0 (price 1, the earlier test pool; the threshold sits at the 50 ETH clamp).

| Case | Native ETH, launch FDV | ERC20 = currency1, launch FDV | Native ETH, tick 0 | ERC20 = currency0, tick 0 | ERC20 = currency1, tick 0 | Before (fixed 0.2 ETH, tick 0) | Test ceiling |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal first buy, direct write | **34,643** | 34,578 | 34,243 | 34,243 | 34,185 | 33,303 | 35,000 |
| First sell, no-op + `Accumulated` | 37,571 | 37,584 | 37,171 | 37,171 | 37,113 | 36,242 | 40,000 |
| Saturated no-op buy + page 64 + `Accumulated` | 38,566 | 38,501 | 38,166 | 38,166 | 38,108 | 37,226 | 40,000 |
| Last available circular-scan cell + page 64 + `Accumulated` | **38,928** | 38,806 | 38,558 | 38,558 | 38,500 | 37,618 | 40,000 |
| **Track completion** + page 64 + `Accumulated` + `TrackComplete` | **42,733** | 42,669 | 42,334 | 42,334 | 42,276 | 41,394 | 45,000 |
| Whale buy (Euclidean fill) | 37,857 | 37,792 | 37,389 | 37,389 | 37,331 | 36,487 | 45,000 |
| Whale sell (track wipe) | 37,549 | 37,562 | 37,081 | 37,081 | 37,023 | 36,190 | 45,000 |
| Whale buy + page 64 | 38,012 | 37,947 | 37,544 | 37,544 | 37,486 | 36,642 | 45,000 |
| Whale sell + page 64 | 37,775 | 37,646 | 37,307 | 37,307 | 37,249 | 36,416 | 45,000 |
| Synthetic zero slot1, inherited storage-cost stress | 55,056 | 51,840 | 51,505 | 51,505 | 51,447 | 50,565 | 56,000 |

**The dynamic threshold adds ~940 gas at tick 0 and ~1,340 gas at the launch tick** (first buy 33,303 → 34,243 / 34,643): the TickMath call, the clamp, the `quoteIs0` immutable and the threshold's own `log2Fixed` for the EMA clamp. TickMath does one conditional multiply-shift per set bit of |tick| (the launch tick has 10 of 20), so other prices differ by a few hundred gas at most. At the launch tick the synthetic zero-slot1 case also lands its hash on an occupied kick step and pays the scan plus the `Accumulated` log (~55.1k), hence its ceiling moved from 52k to 56k; with the currency1 orientation the same case misses that step (51.8k). The normal maximum among these cases is 38,928 gas at the launch tick, still under the 40k v2 ceiling.

Native ETH and an ERC20 quote in currency0 run the identical callback path (the hook only compares `currency0` with the token and never touches funds), so their costs are equal at the same tick; currency1 ordering saves 58 gas at tick 0.

The direct first buy at the launch tick costs 4,267 gas over the prior v1 measurement (30,376), including relative classification, size EMA, accumulation, the extended codec and heat/drop. This total is distinct from the incremental heat/drop estimate below. Extra `Accumulated` logs explain why promoted/no-op paths exceed the historical v1 normal ceiling of 35k; their explicit v2 ceiling is 40k. The old unconditional 35k target is not claimed for v2.

`Mutated` retains its existing signature. `Accumulated` emits only for non-whale `promoted || noop`, carrying fromTrack/writeStep/promoted/noop so clients can draw spills and no-ops truthfully while `Mutated.step` keeps its bass/hash meaning. This LOG2 carries four ABI words (about 2,149 gas before preparation). Ordinary direct writes emit no companion log.

## Incremental heat/drop cost

`test_GasHeatDropIncrement` compares the production transition with an internal reference entry `mutateRelativeAcc` that uses exactly the same relative + accumulation rules, without cooling, heat updates or completion. It returns the full state and mutation metadata in both cases to prevent dead-code elimination; it measures the transition before output encoding. This is a rule-only measurement, excluding callback/storage/log costs.

| Rule path | Extra gas over relative + accumulation |
| --- | ---: |
| Normal buy | **436** |
| Saturated buy | **496** |
| Sell | **338** |

These measurements meet the TS estimate of approximately **+150–600 gas** for normal heat/drop overhead. No additional SLOAD or SSTORE is introduced. The amount log is calculated once per transition and reused for classification and EMA; the circular scan uses a rotate and bounded bit search.

A completion costs **+4,167 gas** over the otherwise equivalent saturated no-op callback (42,733 − 38,566 at the launch tick; both include the page increment and `Accumulated`). This is slightly above the +3–4k estimate: `TrackComplete` includes **all TS fields**, including the 64-bit seed in an extra ABI word, along with the before-reset snapshot, new trackNo/patternId/root and swapCount. Its LOG2 data occupies six ABI words (2,661 gas before preparation); snapshot encoding, seed selection, bass thinning, resets and movement account for the remainder. The estimate is not reported as an exact cap.

## Measurement method and reproduction

```sh
cd contracts
export PATH="$PWD/bin:$PATH"
export FOUNDRY_SOLC="$PWD/bin/solc"
forge test --match-test test_Gas -vv --gas-report
```

The captured output is [gas-report.txt](gas-report.txt). Callback values come from `CallbackGasMeter.measure`, a nested call around the production hook. Both the hook and manager (including storage) are deliberately marked cold. It includes calldata preparation, call/return overhead, authorization, pool binding, manager tick read, mutation, both state writes and all emitted events. It excludes setup, CREATE2 mining, deployment and transaction intrinsic gas. Real swaps warm their manager pool storage before the callback, so these cases are conservative for that access pattern.

Foundry call isolation starts a transaction for a top-level external call. Measuring the nested callback avoids mistaking intrinsic/calldata gas or the whole test transaction for hook overhead. The generic gas table is supplementary; use the printed `afterSwap gas` values for callback comparisons.

## Zero-word regression: v1 versus v2

The existing v1 transition (IMD-quoted Sepolia hook) still proves that this same-timestamp, tick-zero sequence at 1 IMD reaches `slot1 == 0` after 38 swaps:

```
SBBBBBSSBBBBBBBBBBBBBBBBBBSBBBSSSSSSSS
```

V1's measured follow-up was 47,597 / 47,565 gas: recreating a zero slot1 adds the canonical 17,100 gas SSTORE differential. The original coordinator-approved v1 exception remains historical evidence; v1 transition tests and all 130 vectors remain unchanged in behavior.

With the ETH calibration, `sizeLogEma` starts at `L(0.0125 ETH) = 854` and remains at least `L(0.000025 ETH) = 710`, so **that zero-word state is unreachable from v2 initialization**. The callback test deliberately injects zero sizeLogEma to retain the arbitrary-state storage-cost stress; its 51,505 (tick 0) / 55,056 (launch tick) gas is a synthetic case, not a normal reachable v2 maximum. No sentinel, storage masking or extra reserved field was added.

## Verification

- `forge build` succeeds; fixed-width casts and bounded shifts are intentional.
- `forge test`: **207 passed**, 0 failed/skipped, **11 suites** (hook integration at tick 0: native ETH, ERC20 quote as currency0, ERC20 quote as currency1; at the launch FDV (tick ±193380): native ETH and ERC20 quote as currency1, every hook test re-run at that price). Nine fuzz tests × 512 inputs = **4,608 fuzz executions**.
- Whale threshold: exact pins (FDV 4 ETH tick, both clamp boundaries 50754/50755 and 234970/234971, int24 and TickMath extremes), a fuzz test for monotonicity, bounds and orientation symmetry, and real swaps around 0.04 ETH at the launch price (`test_RealWhaleBoundaryAtLaunchFdv`); every hook swap asserts `whale == (amount >= whaleThresholdAt(postSwapTick))`.
- Retained v1 state tests; v2 packing, arbitrary-packed-state non-reversion, independent loop-versus-bit-search accumulation checks, cooling boundaries, saturation at 44 (43 → 44 heats, 42 → 43 does not), counter wraps, snapshots, bass thinning and whale interplay.
- **130 v1 + 554 v2 = 684 vectors** generated from Solidity. v1 is byte-identical. v2 adds `whaleWei` to every event, a `whale-threshold` sweep (26 ticks across the whole range, exactly at the threshold and 1 wei under) and a 120-swap `launch-market` run at FDV ~4 ETH.
- The dependency-free Python validator checks both vector files, additive schema fields, slot widths, snapshot/event invariants, and re-derives `whaleWei` and the EMA upper clamp with its own TickMath port.
- Core TS: **763 tests passed**, including every v2 slot word and event field (with `whaleWei`) against the vectors and the TickMath port against Uniswap reference values.
- `forge fmt --check` passes, including deployment scripts. The Sepolia script rehearses the native ETH pair at the launch FDV; it was not executed.

Live factory rehearsal, independent audit and deployment remain separate launch work.
