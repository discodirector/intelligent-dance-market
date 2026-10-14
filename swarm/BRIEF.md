# Intelligent Dance Market — IMD launch brief

Launch an immutable Uniswap v4 music sequencer hook and its fixed-supply token on **Robinhood Chain (4663)** through IMD `launch.open`, kind **`univ4_hook`**, **`pairWith: "imd"`**. Token name: **Intelligent Dance Market**; symbol: **IDM** (final, owner-approved). The IDM/IMD pairing is an intentional anagram. The hook charges **zero additional fees**, needs **no signer**, and has **no owner**.

## Source of truth and provenance

Repository: **`https://github.com/discodirector/intelligent-dance-market`**. Immutable source commit: **`3bd29b0e7e1c154175cc6e9ee2f1f193ce7a5cdf`**.

These are intentional placeholders approved by the coordinator: this repository is not public yet, and publication still requires the owner's approval. Before `launch.open`, the coordinator must pin the actual commit containing `contracts/`, `spec/vectors.json`, and `SPEC.md`, then replace both placeholders and import the repository. Do not use the initial planning commit as if it contained the implementation. The local source workspace is `IMD_vibe`; the Foundry project root is `contracts/`.

Read **SPEC.md §3 in full**. It is canonical. Use the reference implementation `contracts/src/SequencerHook.sol`, `SequencerState.sol`, and `SequencerToken.sol`; the reviewed reference manifest is `contracts/launch.json`. Research and compatibility evidence are in `contracts/IMD_LAUNCH_NOTES.md`; exact dependency pins are in `contracts/DEPENDENCIES.md`. The Solidity-generated shared vector file is `spec/vectors.json`, validated by `contracts/scripts/validate-vectors.py` against `contracts/vectors.schema.json`.

## Launch request shape

Use the following fields in the final validated request; integrate the imported source reference using the live IMD import/check response rather than inventing an input format:

```json
{
  "objective": "Review and launch Intelligent Dance Market (IDM) from https://github.com/discodirector/intelligent-dance-market at 3bd29b0e7e1c154175cc6e9ee2f1f193ce7a5cdf on Robinhood Chain 4663 with its immutable zero-fee Uniswap v4 sequencer hook. Preserve SPEC.md section 3, the two packed state words, ABI and Solidity test vectors exactly. Use the supplied contracts/ Foundry project and launch.json. No owner, signer, upgrade, fee, return delta or fund handling in the hook. Pair SEQ with IMD and provide verified deployed hook/token/pool addresses and launch receipts.",
  "shape": "chain",
  "references": ["uniswap-v4-hooks", "uniswap-v4-security"],
  "steps": [{"skill": "build-contract-project"}, {"skill": "adversarial-review"}],
  "onchain": "univ4_hook",
  "chainId": 4663,
  "pairWith": "imd",
  "github": true
}
```

Do not add an `owner` constructor reference or an owner role. Any optional token distribution economics must come from the owner. The factory's standard LP fee and distribution policy are separate from the hook's zero fee. Source publication, payment and deployment are future authorized launch-stage actions; this brief itself authorizes none of them.

## Deployment bindings

- IMD: `0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127`, 18 decimals.
- Documented Robinhood LaunchFactory: `0xa25b02a1e93903b790e6aaf7da1b8b8d50294645`.
- Documented Robinhood PoolManager: `0x8366a39cc670b4001a1121b8f6a443a643e40951`.
- Recheck addresses, bytecode and `GET /requests/capabilities` before the chain-fork rehearsal and launch. They are not deployment receipts.
- Hook constructor: `($poolManager, $token, $factory, IMD, 5e17, 5e18, 25e18, 100e18)`; four thresholds are immutable. The constructor performs no chain-state reads, so empty-EVM admission rehearsals work.
- The factory predicts/creates the plain ERC-20 and supplies `$token`; that token mints exactly `10^27` minor units once to its deployer. The factory handles allocations, single-sided seeding and registry receipts.
- Sort IDM/IMD into `currency0/currency1`; set fee `12500`, tick spacing `60`, and SequencerHook as the only hook. `beforeInitialize` and `afterInitialize` accept only the immutable factory's initialization and only this exact pair. One successful pool binding is permanent.
- Mine final CREATE2 initcode using the actual factory deployer. **Required low-14-bit permission mask: `0x3040`**, exactly `beforeInitialize`, `afterInitialize`, `afterSwap`. Re-mine whenever code, constructor args or compiler settings change. Constructor flag validation must remain enabled.
- Use the launch system's policy-derived opening price, range and liquidity; the sample manifest's `2^96` initialPrice is provenance-only. Deploy and initialize atomically. The ProjectFactory's `PoolInitializationGuard` is a separate launch path, not a second hook to attach or inherit.

## Hook behavior

After initialization the drum bitmap is `0x10100101`, bass is zero, BPM 128, root A (9), mode Dorian (0), interval EMA 600 seconds. All other sequencer fields start at zero, including lastTick and lastTs.

Each successful `afterSwap` reads actual BalanceDelta and the **post-swap** pool tick. A positive IDM delta is a buy; zero IDM delta follows the sell branch. Absolute IMD delta selects track: under 0.5 IMD hat, under 5 glitch, under 25 snare, otherwise kick. At least 100 IMD is a whale. The incremented wrapping uint32 count, signed int24 tick and uint64 block number form the exact **15-byte packed keccak preimage**. Its low four bits select a step. Buys set one drum bit and one bass nibble; sells clear the drum bit and sometimes clear the bass nibble according to hash bit 8.

The capped time-interval EMA determines BPM in [90,170]; decaying signed buy/sell pressure chooses Dorian, Phrygian, Lydian or Locrian. Whales move root by seven semitones modulo twelve, increment patternId and emit Movement. Every 64th swap increments patternId separately, including count zero after wrap. A whale on that boundary emits Movement with the intermediate patternId; Mutated carries the final packed state. Every swap emits the exact specified Mutated ABI, with callback `sender` (normally a router), never an invented trader address or `tx.origin`.

The fixed-width counters wrap modulo `2^32`; timestamp is `uint40(block.timestamp)`, and a backwards timestamp uses dt=0. First-swap detection uses the count **before** increment; its dt equals current EMA. Signed division truncates toward zero. Widen tick before absolute value and widen EMA/pressure arithmetic. Preserve the exact initial state, arithmetic, bit offsets, endianness, and event order against all shared vectors.

## Invariants the swarm must preserve

1. Exactly SPEC §3.2 physical packed slots 0/1 and matching `state()`/`raw()` views; reserved bits remain zero. No sentinel, transformed encoding, extra sequencer write, or different struct layout. Pool-binding metadata may remain separate.
2. Only the selected track/step drum bit and bass nibble can change; unrelated pattern bits, bass nibbles and releaseCount are preserved. BPM/mode/root remain in range for initialized state.
3. Valid bound-pool swaps must not fail due to counter/EMA overflow. Unauthorized callers, invalid pools, reinitialization and disabled callbacks must still revert.
4. No fee, return-delta flag, custody, transfer, mint, burn, token approval, settlement, donation, owner, setter, pause, rescue, signer, proxy or upgrade in the hook. Return exactly `(afterSwap.selector, 0)`. Keep the token's plain fixed-supply behavior.
5. Keep only the three required callback permissions. Do not copy proxy/all-flags launch 825, the fees or oracle machinery from Marginalia, or Pixel Pool's direction-based buy definition.
6. TrackReleased is a reserved ABI declaration only. No R7 oracle, release mutation, scheduler or additional administration in this version.

## Review and acceptance

Run `cd contracts && forge build && forge test`, `forge fmt --check src test`, and `python3 scripts/validate-vectors.py`. The Foundry tests generate vectors directly from the production transition and test real PoolManager swaps in both currency orderings, exact input/output, partial fills, per-event reconstruction, flags, authorization, pool binding, rollover and gas. Preserve Solidity/TypeScript parity when adapting launch packaging.

The coordinator approved **normal cold afterSwap <=35,000 gas**, with the rare canonical slot1 zero-to-nonzero SSTORE exception documented in `contracts/GAS.md`. Do not “fix” this with an unapproved state-layout change. Tests explicitly reproduce that reachable state and its larger gas cost.

Before actual launch, independently review and rehearse the selected Robinhood LaunchFactory on a current fork: token prediction/creation, flag mining, initialization, one-sided LP seeding, a buy, a sell, LP withdrawal, state/events and zero hook balances. Publish the immutable source commit, manifest hash, review/audit output, IMD job/launch IDs, deployed addresses, poolId, transaction receipts, and explorer links. No live factory/fork rehearsal or deployment is claimed by the local reference tests. Do not redesign the sequencer while adapting the packaging.
