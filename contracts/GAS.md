# V2 callback gas and verification report

Measured locally on **2026-10-15**, Foundry 1.8.5 (`51a52c59cffd940f76eddd0b4bb1791aa4b5ac7f`), Solidity 0.8.26, Cancun, optimizer 200, via IR, metadata hash `none`, and the pinned genuine Uniswap v4 PoolManager. No RPC, private key, broadcast, or deployment was used.

V2 is relative + accumulation + heat/drop, with the TS defaults: **48 saturated bits, heatMax 16, silence reset at 3600 seconds, sellCool 1, noopHeat on**. The state still occupies physical slots 0 and 1. `releaseCount` and `TrackReleased` remain reserved.

## Full cold callback measurements

| Case | IMD = currency0 | IMD = currency1 | Test ceiling |
| --- | ---: | ---: | ---: |
| Normal first buy, direct write | **33,376** | 33,344 | 35,000 |
| First sell, no-op + `Accumulated` | 36,315 | 36,283 | 40,000 |
| Saturated no-op buy + page 64 + `Accumulated` | 37,299 | 37,267 | 40,000 |
| Last available circular-scan cell + page 64 + `Accumulated` | **37,691** | 37,659 | 40,000 |
| **Track completion** + page 64 + `Accumulated` + `TrackComplete` | **41,467** | 41,435 | 45,000 |
| Whale buy (Euclidean fill) | 36,495 | 36,463 | 45,000 |
| Whale sell (track wipe) | 36,198 | 36,166 | 45,000 |
| Whale buy + page 64 | 36,650 | 36,618 | 45,000 |
| Whale sell + page 64 | 36,424 | 36,392 | 45,000 |
| Synthetic zero slot1, inherited storage-cost stress | 50,638 | 50,606 | 52,000 |

The normal callback maximum **among these cases** is 37,691 gas. The direct first buy costs 3,000 gas over the prior v1 measurement (30,376), including relative classification, size EMA, accumulation, the extended codec and heat/drop. This total is distinct from the incremental heat/drop estimate below. Extra `Accumulated` logs explain why promoted/no-op paths exceed the historical v1 normal ceiling of 35k; their explicit v2 ceiling is 40k. The old unconditional 35k target is not claimed for v2.

`Mutated` retains its existing signature. `Accumulated` emits only for non-whale `promoted || noop`, carrying fromTrack/writeStep/promoted/noop so clients can draw spills and no-ops truthfully while `Mutated.step` keeps its bass/hash meaning. This LOG2 carries four ABI words (about 2,149 gas before preparation). Ordinary direct writes emit no companion log.

## Incremental heat/drop cost

`test_GasHeatDropIncrement` compares the production transition with an internal reference entry `mutateRelativeAcc` that uses exactly the same relative + accumulation rules, without cooling, heat updates or completion. It returns the full state and mutation metadata in both cases to prevent dead-code elimination; it measures the transition before output encoding. This is a rule-only measurement, excluding callback/storage/log costs.

| Rule path | Extra gas over relative + accumulation |
| --- | ---: |
| Normal buy | **436** |
| Saturated buy | **496** |
| Sell | **338** |

These measurements meet the TS estimate of approximately **+150–600 gas** for normal heat/drop overhead. No additional SLOAD or SSTORE is introduced. The amount log is calculated once per transition and reused for classification and EMA; the circular scan uses a rotate and bounded bit search.

A completion costs **+4,168 gas** over the otherwise equivalent saturated no-op callback (41,467 − 37,299; both include the page increment and `Accumulated`). This is slightly above the +3–4k estimate: `TrackComplete` includes **all TS fields**, including the 64-bit seed in an extra ABI word, along with the before-reset snapshot, new trackNo/patternId/root and swapCount. Its LOG2 data occupies six ABI words (2,661 gas before preparation); snapshot encoding, seed selection, bass thinning, resets and movement account for the remainder. The estimate is not reported as an exact cap.

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

The existing v1 transition still proves that this same-timestamp, tick-zero sequence at 1 IMD reaches `slot1 == 0` after 38 swaps:

```
SBBBBBSSBBBBBBBBBBBBBBBBBBSBBBSSSSSSSS
```

V1's measured follow-up was 47,597 / 47,565 gas: recreating a zero slot1 adds the canonical 17,100 gas SSTORE differential. The original coordinator-approved v1 exception remains historical evidence; v1 transition tests and all 130 vectors remain unchanged in behavior.

With the default v2 thresholds, `sizeLogEma` starts at 993 and remains at least `L(0.01 IMD) = 849`, so **that zero-word state is unreachable from v2 initialization**. The callback test deliberately injects zero sizeLogEma to retain the arbitrary-state storage-cost stress; its 50,638 / 50,606 gas is a synthetic case, not a normal reachable v2 maximum. No sentinel, storage masking or extra reserved field was added.

## Verification

- `forge build` succeeds; fixed-width casts and bounded shifts are intentional.
- `forge test`: **97 passed**, 0 failed/skipped, **7 suites**. Six fuzz tests × 512 inputs = **3,072 fuzz executions**.
- Retained v1 state tests; new v2 packing, arbitrary-packed-state non-reversion, independent loop-versus-bit-search accumulation checks, cooling boundaries, saturation, counter wraps, snapshots, bass thinning and whale interplay.
- Real PoolManager integration in **both currency orderings**, including exact input/output, partial fill, post-swap tick, initialization/security restrictions, and exact `Accumulated`/`TrackComplete` ABI data and event order on completion.
- **130 v1 + 382 v2 = 512 vectors** generated from Solidity. V2 covers all relative boundaries, all 16 column occupancies × 4 classified tracks × both sides, scan cells, 3599/3600 seconds, sell cooling, dust/max widths, whale/page/completion combinations, every curated kick/snare seed pair and a continuous multi-track run.
- The dependency-free Python validator checks both vector files, additive schema fields, slot widths and snapshot/event cross-field invariants.
- Core TS: **576 tests passed**, including comparison of every v2 slot word and every event field. **No changes to `packages/core/src/index.ts` or TS v2 behavior.** The only core addition is the v2 replay test.
- `forge fmt --check` passes, including deployment scripts. The Sepolia script builds v2 through the updated hook creation code; it was not executed.

Live factory rehearsal, independent audit and deployment remain separate launch work.
