# Callback gas and verification report

Measured 2026-10-15 with Foundry 1.8.5 (`51a52c59cffd940f76eddd0b4bb1791aa4b5ac7f`), Solidity 0.8.26, Cancun, optimizer 200, via IR, metadata hash `none`, and pinned genuine Uniswap v4 PoolManager. No RPC or broadcast was used.

**Normal cold callback maximum measured: 32,379 gas. Rare canonical zero-word transition: 47,464 gas.**

The coordinator explicitly approved the acceptance refinement: **<=35,000 gas for the normal path, with the rare zero-word exception documented**. The original unconditional <=35k target is not claimed. The coordinator rejected a reserved sentinel bit and required exact SPEC §3.2 physical storage with no masking or transformed encoding.

## Measurements

| Callback case | IMD = currency0 | IMD = currency1 | Asserted ceiling |
| --- | ---: | ---: | ---: |
| First buy | 30,243 | 30,211 | 35,000 |
| First sell | 30,081 | 30,049 | 35,000 |
| Whale buy | 32,207 | 32,175 | 35,000 |
| Whale buy + page 64 | 32,379 | 32,347 | 35,000 |
| Whale sell + page 64 | 32,288 | 32,256 | 35,000 |
| Previously zero canonical slot1 | **47,464** | **47,432** | 50,000 (approved exception) |

Reproduce with:

```sh
cd contracts
forge test --match-test test_Gas -vv --gas-report
```

The captured output is [gas-report.txt](gas-report.txt). Each printed `afterSwap gas` value is measured inside `CallbackGasMeter.measure` around a nested call to the production hook. The test deliberately marks both hook and PoolManager (including storage) cold. The measurement includes calldata preparation, external call/return overhead, authorization, pool-id checks, manager tick read, mutation, both writes and emitted events. It excludes test-contract deployment, CREATE2 mining, token/pool setup and transaction intrinsic gas. The same assertions run in both actual currency orderings.

Foundry 1.8.5 enables call isolation by default: a top-level external call is a new transaction and its trace includes intrinsic/calldata gas. Measuring that top-level call with gasleft incorrectly counts transaction costs as hook overhead. The nested meter avoids that error; do not use the larger whole-test or `measure` transaction numbers from the generic gas table as afterSwap overhead. A real swap already warms PoolManager and its current pool storage before the callback, so the cold measurements are conservative for these tested paths.

## Exact zero-word reproducer

`slot1` contains only patternId, lastTick, pressure, intervalEma and releaseCount. All can legitimately be zero. Start from the canonical initial state; use 38 non-whale swaps at tick 0, all with the same timestamp, in this exact buy/sell order:

```
SBBBBBSSBBBBBBBBBBBBBBBBBBSBBBSSSSSSSS
```

Use IMD amount `1e18`, fixed block number `20000000`, timestamp `1800000000`. Here B means positive SEQ delta, S means nonpositive SEQ delta. The first interval is 600; subsequent zero intervals decay the integer EMA to zero. The pressure recurrence also ends exactly at zero, before the first page boundary. Consequently after swap 38, canonical `slot1 == 0`. The model-level test `test_ZeroSlot1IsReachableAfter38Swaps` proves this from the actual transition. The following swap must recreate slot1; zero-to-nonzero SSTORE costs 20,000 instead of the ordinary nonzero-to-nonzero 2,900, an extra **17,100 gas** before refunds.

`test_GasColdPreviouslyZeroSlot1` sets that proven reachable packed state, then executes the production callback against a real PoolManager through the gas meter. Both currency orderings pass the separately documented 50k ceiling. The final vector (index 115) covers this transition too. A future encounter after counter/page wrap can create another such exception; it is not a one-time lifetime guarantee. Do not hide it by changing pressure, EMA, page logic or reserved bits.

## Final verification

- `forge build`: succeeds. Compiler/lint warnings concern deliberate fixed-width encoding casts and bounded bit shifts; no compilation errors.
- `forge test`: **68 passed, 0 failed, 0 skipped**, across 5 suites.
- 21 state tests (including 2 fuzz tests), 6 token tests (including 1 fuzz test), 1 vector-generation test, and 20 integration/gas/security tests for each of the two currency orderings.
- Each fuzz test runs **512 inputs**, totaling 1,536 fuzz executions in the default run.
- Real PoolManager tests cover buys/sells, exact input/output, partial fills/post-swap tick, 64 consecutive swaps, LP add/remove, both event types, whale + page boundary, count wrap, no hook balances, flags and initialization/callback restrictions.
- `forge fmt --check src test`: passes.
- `python3 scripts/validate-vectors.py`: **116 cases** pass `vectors.schema.json`, integer-width and event/state consistency checks. JSON is emitted by Foundry's `vm.writeJson` using the production Solidity transition.
- Every vendored file matches the checksum manifest; core/std/Solmate were additionally byte-compared with the official pinned upstream archives.

No live IMD factory fork rehearsal, independent audit, or deployment was performed. Those remain launch-stage checks, not claims of this local test report.
