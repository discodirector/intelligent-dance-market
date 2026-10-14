# Swarm Sequencer contracts

Immutable Uniswap v4 hook for the IMD factory-created SEQ/IMD pool on Robinhood Chain (4663). Each swap mutates the SPEC.md §3 sequencer and emits its complete packed state. The hook has no owner, fee, return delta or fund handling.

```sh
cd contracts
forge build
forge test
forge fmt --check src test
python3 scripts/validate-vectors.py
```

Validation: **68 tests passed**, including 1,536 fuzz executions and **116 generated vectors**. Normal cold callback maximum **32,379 gas**; the approved rare zero-word exception is **47,464 gas**.

Solidity 0.8.26 and dependencies are pinned. Tests need no RPC, FFI, wallet, deployed chain state or external services. An installed compiler is needed for fully offline builds. On the development machine, ignored local tools are already available:

```sh
cd contracts
export PATH="$PWD/bin:$PATH"
export FOUNDRY_SOLC="$PWD/bin/solc"
forge build
forge test
```

`forge test` regenerates `../spec/vectors.json` from the production Solidity transition. The existing tracked JSON file must be present: Foundry's permission is scoped to that exact file, not the whole parent workspace. The vector generator is `test/Vectors.t.sol`; rerun just it with `forge test --match-test test_GenerateVectors`.

- `src/SequencerState.sol`: exact codec and deterministic transition; uint32 counter wrapping, widened signed arithmetic, bounded BPM/modes and timestamp edge semantics from SPEC.
- `src/SequencerHook.sol`: direct IHooks interface, factory-only initialization, immutable exact pair and full poolId binding, state in physical slots 0 and 1, manager-only callbacks. Flags `0x3040`.
- `src/SequencerToken.sol`: 1 billion SEQ, 18 decimals, fixed supply minted to deployer for factory allocation. Working metadata, pending owner finalization.
- `test/SequencerHook.t.sol`: mined CREATE2 hook deployments, real v4 PoolManager, swaps and LP operations in both currency orderings, event verification, authorization and gas cases.
- `IMD_LAUNCH_NOTES.md`, `launch.json`, `../swarm/BRIEF.md`: launch compatibility evidence, reference manifest and swarm instructions. Deployment was not performed.
- `GAS.md`: measured callback costs and coordinator-approved rare zero-word storage exception.

The vector format keeps large integers as **decimal strings**: packed words, IMD amounts and block numbers. Timestamp, tick, counts, modes and step/track fields are JSON numbers; booleans are actual JSON booleans. `event` contains the Mutated fields and `movement: null | {patternId,root,swapCount}`. The vector sender is a fixed test fixture address; onchain sender is the actual PoolManager callback argument, usually the swap router. A whale on a page boundary has an intermediate Movement patternId and a final Mutated patternId. The schema is `vectors.schema.json`; the standard-library Python validator enforces the schema subset used and packed width/cross-field invariants.

The source layout and external ABI remain exactly canonical. releaseCount and TrackReleased are reserved for stretch R7; no oracle callback or release mutation is implemented. The hash is deterministic sequencing, not adversarially secure randomness. This local reference has not undergone a third-party audit or a fork rehearsal against the live IMD factory; those remain launch-stage review tasks.
