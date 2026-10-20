# Swarm Sequencer contracts

Immutable Uniswap v4 hook for the IMD-factory-created IDM/ETH pool (native ETH as the quote currency, `pairWith: "eth"`) on Robinhood Chain (4663). New deployments use the v2 SPEC.md §3 sequencer (relative + accumulation + heat/drop). Each swap mutates the sequencer and emits its complete packed state. The hook has no owner, fee, return delta or fund handling.

```sh
cd contracts
forge build
forge test
forge fmt --check
python3 scripts/validate-vectors.py
```

Validation: **127 Solidity tests passed** in 8 suites, including **3,072 fuzz executions**, plus **130 v1 + 382 v2 generated vectors**. Core TS: **576 tests passed**. Cold callback: direct normal buy **33,303 gas**, worst measured normal scan **37,618 gas**, track completion **41,394 gas**. Incremental heat/drop rules cost **338–496 gas** over relative + accumulation; completion adds **4,168 gas** over the equivalent hot no-op swap. The synthetic zero-word case measures **50,565 gas**. See `GAS.md` for event costs, methodology and that regression.

Solidity 0.8.26 and dependencies are pinned. Tests need no RPC, FFI, wallet, deployed chain state or external services. An installed compiler is needed for fully offline builds. On the development machine, ignored local tools are already available:

```sh
cd contracts
export PATH="$PWD/bin:$PATH"
export FOUNDRY_SOLC="$PWD/bin/solc"
forge build
forge test
```

`FOUNDRY_PROFILE=vectors forge test --match-contract VectorsTest` regenerates `../spec/vectors.json` (v1) and `../spec/vectors-v2.json` (v2); only that profile has write access, scoped to those exact files, and plain `forge test` runs the generators without writing. The generator is `test/Vectors.t.sol`. The v1 transition remains available as `initial/mutate`; the new hook uses `initialV2/mutateV2`. The extended codec reads/writes v2 fields in the formerly unused slot1 bits without shifting any v1 field.

- `src/SequencerState.sol`: v1/v2 codec and deterministic transitions; uint32 counter wrapping, widened signed arithmetic, bounded BPM/modes and timestamp edge semantics from SPEC.
- `src/SequencerHook.sol`: direct IHooks interface, factory-only initialization, immutable exact pair (`token` + `quote`; `quote = address(0)` is native ETH, always currency0) and full poolId binding, rules read the absolute quote-currency delta, state in physical slots 0 and 1, manager-only callbacks. Flags `0x3040`.
- `src/QuoteCalibration.sol`: the ETH-scale constants in one place (thresholds 0.00125 / 0.0125 / 0.0625 ETH, EMA floor 0.000025 ETH, initial size 0.0125 ETH: a 1/400 scale of the former IMD values) and the FDV-scaled whale (K = 2e7, C = 632455532033675866399, clamp 0.005..50 ETH; SPEC §3.1).
- `src/PulseTreasury.sol`: optional, separate from the hook. Immutable, ownerless treasury funded by the launcher's fee share; after 15 min without swaps anyone can call `pulse()`, which buys a hat-sized amount of IDM with ETH (<= 0.002 ETH, <= 1% of balance, open price limit, a zero fill reverts) so the track keeps playing. `burn()` sends its IDM to 0xdEaD. Deploy with `script/DeployTreasury.s.sol` after launch; see `TREASURY-RUNBOOK.md` and SPEC.md §9. `pulse()` ~143k gas cold (~169k on a saturated grid).
- `src/SequencerToken.sol`: 1 billion SEQ, 18 decimals, fixed supply minted to deployer for factory allocation. Working metadata, pending owner finalization.
- `test/SequencerV2.t.sol`, `test/SequencerGasV2.t.sol`: v2 arithmetic/packing/snapshot/fuzz checks and measured incremental heat/drop cost.
- `test/SequencerHook.t.sol`: mined CREATE2 hook deployments, real v4 PoolManager, swaps and LP operations for a native-ETH quote and an ERC20 quote in both currency orderings (3 suites x 27 tests), event verification, authorization and gas cases.
- `IMD_LAUNCH_NOTES.md`, `launch.json`, `../swarm/BRIEF.md`: launch compatibility evidence, reference manifest and swarm instructions. Deployment was not performed.
- `GAS.md`: measured v2 callback costs, incremental heat/drop costs and historical v1 versus synthetic v2 zero-word cases.

The vector format keeps large integers as **decimal strings**: packed words, quote amounts and block numbers. v1 (`spec/vectors.json`, the old IMD-quoted Sepolia hook) names them `imdAmt/imdAmount`; v2 uses `quoteAmt/quoteAmount` at the ETH scale. Timestamp, tick, counts, modes and step/track fields are JSON numbers; booleans are actual JSON booleans. `event` contains the Mutated fields, `movement: null | {patternId,root,swapCount}` and whale `drop`. V2 additionally includes whale, non-whale accumulation metadata (`fromTrack/promoted/writeStep/noop`) and `trackComplete: null | {trackNo,patternId,root,slot0,slot1,swapCount,seed}`. Snapshot slots precede reset; identity and seed follow it. Onchain, `Accumulated` emits only for promoted or no-op writes and `TrackComplete` precedes final `Mutated`; the existing Mutated signature is unchanged. The vector sender is a fixed test fixture address; onchain sender is the actual PoolManager callback argument, usually the swap router. A whale on a page boundary has an intermediate Movement patternId and a final Mutated patternId. The schema is `vectors.schema.json`; the standard-library Python validator enforces the schema subset used and packed width/cross-field invariants.

Slot0 is unchanged; slot1 adds sizeLogEma at 152..167, heat at 168..175 and trackNo at 176..191. The source state view adds those fields and the hook adds two events; the Mutated ABI remains canonical (its amount parameter is renamed `imdAmount` -> `quoteAmount`; types, order and topic are identical). releaseCount and TrackReleased are reserved for stretch R7; no oracle callback or release mutation is implemented. The hash is deterministic sequencing, not adversarially secure randomness. This local reference has not undergone a third-party audit or a fork rehearsal against the live IMD factory; those remain launch-stage review tasks.
