# Intelligent Dance Market — IMD launch brief

Launch an immutable Uniswap v4 music sequencer hook and its fixed-supply token on **Robinhood Chain (4663)** through IMD `launch.open`, kind **`univ4_hook`**, **`pairWith: "eth"`** (native ETH, currency `0x0000000000000000000000000000000000000000`). Token name: **Intelligent Dance Market**; symbol: **IDM** (final, owner-approved). The pool is **IDM/ETH**: IMD has no liquidity on Robinhood Chain, where trading is against ETH. The hook charges **zero additional fees**, needs **no signer**, and has **no owner**.

## Source of truth and provenance

Repository: **`https://github.com/discodirector/intelligent-dance-market`**. Immutable source commit: **`b7e08ee6dd3edcc17ad1d93bb24e80729f567dc2`**.

The pinned commit is public and contains `contracts/`, `spec/vectors.json`, `spec/vectors-v2.json` and `SPEC.md`. Later commits on `main` (for example this pin) do not change the source under review. The local source workspace is `IMD_vibe`; the Foundry project root is `contracts/`.

Read **SPEC.md §3 in full**. It is canonical. Use the reference implementation `contracts/src/SequencerHook.sol`, `SequencerState.sol`, `QuoteCalibration.sol` and `SequencerToken.sol`; the reviewed reference manifest is `contracts/launch.json`. Research and compatibility evidence are in `contracts/IMD_LAUNCH_NOTES.md`; exact dependency pins are in `contracts/DEPENDENCIES.md`. The Solidity-generated shared vector file is `spec/vectors.json`, validated by `contracts/scripts/validate-vectors.py` against `contracts/vectors.schema.json`.

## Launch request shape

Use the following fields in the final validated request; integrate the imported source reference using the live IMD import/check response rather than inventing an input format:

```json
{
  "objective": "Review and launch Intelligent Dance Market (IDM) from https://github.com/discodirector/intelligent-dance-market at b7e08ee6dd3edcc17ad1d93bb24e80729f567dc2 on Robinhood Chain 4663 with its immutable zero-fee Uniswap v4 sequencer hook. Preserve SPEC.md section 3, the two packed state words, ABI and Solidity test vectors exactly. Use the supplied contracts/ Foundry project and launch.json. No owner, signer, upgrade, fee, return delta or fund handling in the hook. Pair IDM with native ETH (IDM/ETH, pairWith eth) and provide verified deployed hook/token/pool addresses and launch receipts.",
  "shape": "chain",
  "references": ["uniswap-v4-hooks", "uniswap-v4-security"],
  "steps": [{"skill": "build-contract-project"}, {"skill": "adversarial-review"}],
  "onchain": "univ4_hook",
  "chainId": 4663,
  "pairWith": "eth",
  "economics": {"poolBps": 9000},
  "github": true
}
```

Do not add an `owner` constructor reference or an owner role. Token distribution economics, owner-decided: `poolBps: 9000`, i.e. the requester's whole 90% seeds the pool (the swarm keeps its fixed 10%); no remainder, so no `remainderTo`. The factory's standard LP fee and distribution policy are separate from the hook's zero fee. Source publication, payment and deployment are future authorized launch-stage actions; this brief itself authorizes none of them.

## Deployment bindings

- Quote currency: native ETH, `address(0)` (`0x0000000000000000000000000000000000000000`); it is always `currency0` and IDM `currency1`.
- Documented Robinhood LaunchFactory: `0xa25b02a1e93903b790e6aaf7da1b8b8d50294645`.
- Documented Robinhood PoolManager: `0x8366a39cc670b4001a1121b8f6a443a643e40951`.
- Recheck addresses, bytecode and `GET /requests/capabilities` before the chain-fork rehearsal and launch. They are not deployment receipts.
- Hook constructor: `($poolManager, $token, $factory, address(0), 1.25e15, 1.25e16, 6.25e16)`: the 4th argument is the `quote` currency (native ETH), the three thresholds are ETH wei from `contracts/src/QuoteCalibration.sol` (0.00125 / 0.0125 / 0.0625 ETH) and immutable. There is **no whale argument**: the whale threshold scales with FDV from the post-swap tick, `K * sqrt(FDV_wei)` with K = 2e7, computed as `632455532033675866399 * getSqrtPriceAtTick(-tick) >> 96` and clamped to [0.005, 50] ETH (SPEC §3.1: FDV 4 / 40 / 400 / 4000 ETH -> 0.04 / 0.126 / 0.4 / 1.26 ETH). The hook has no payable/receive path and never holds ETH. The constructor performs no chain-state reads, so empty-EVM admission rehearsals work.
- The factory predicts/creates the plain ERC-20 and supplies `$token`; that token mints exactly `10^27` minor units once to its deployer. The factory handles allocations, single-sided seeding and registry receipts.
- Pool key: `currency0 = address(0)` (ETH), `currency1 = IDM`; set fee `12500`, tick spacing `60`, and SequencerHook as the only hook. `beforeInitialize` and `afterInitialize` accept only the immutable factory's initialization and only this exact pair. One successful pool binding is permanent.
- Mine final CREATE2 initcode using the actual factory deployer. **Required low-14-bit permission mask: `0x3040`**, exactly `beforeInitialize`, `afterInitialize`, `afterSwap`. Re-mine whenever code, constructor args or compiler settings change. Constructor flag validation must remain enabled.
- Use the launch system's policy-derived opening price, range and liquidity; the manifest sets no opening price (precedent: launch #2124, pairWith eth, opened at tick 184200, FDV ~10 ETH; the hook's whale threshold follows the tick, `whaleThreshold()`). Deploy and initialize atomically. The ProjectFactory's `PoolInitializationGuard` is a separate launch path, not a second hook to attach or inherit.

## Hook behavior (v2)

SPEC.md §3 is canonical; this is a summary. The hook runs the v2 transition (`SequencerState.initialV2` / `mutateV2`):
relative size classes, accumulation, heat and track completion. The v1 transition and `spec/vectors.json` stay in the
source only for the old Sepolia hook and its replays.

After initialization the drum bitmap is `0x10100101` (kick 0,8; snare 4,12), bass is zero, BPM 96, root A (9), mode
Dorian (0), interval EMA 600 s, `sizeLogEma = log2Fixed(0.0125 ETH) = 854`; every other field, heat and trackNo included,
is zero.

Each successful `afterSwap` reads the actual BalanceDelta and the **post-swap** pool tick. A positive IDM delta is a
buy; `|ETH delta|` is the size. In order (SPEC §3.3): a swap after >= 3600 s of silence first resets heat; the
incremented wrapping uint32 count, the int24 tick and the uint64 block number form the exact 15-byte packed keccak
preimage whose low four bits pick the step; a size at or above the FDV-scaled whale threshold at the post-swap tick is a
whale (~0.063 ETH at the ~10 ETH policy opening FDV) and wipes (sell) or Euclidean-fills (buy) a whole track, moves the
root by a fifth, increments patternId and emits Movement and Drop; otherwise the size is classified relative to the
market's size EMA (hat / glitch / snare / kick), buys climb the accumulation ladder or spill to the next free step,
sells clear up to snare, and a buy on a grid holding >= 44 of 64 bits (or one that changes nothing) adds 1 heat while a
sell removes 1. The bass nibble follows the tick. BPM = clamp(118 - interval EMA * 46 / 900, 72, 118); decaying
buy/sell pressure picks Dorian, Phrygian, Lydian or Locrian; every 64th swap increments patternId. At heat 16 the track
completes: TrackComplete carries the finished state, the pattern is reseeded from a curated set, the bass is thinned to
quarter-note anchors, root moves a fifth and trackNo increments. Events in order: Movement/Drop (whale), Accumulated
(promoted or no-op), TrackComplete, then Mutated with the final packed slots and the callback `sender` (normally a router),
never an invented trader address or `tx.origin`.

Counters wrap (swapCount and patternId mod 2^32, trackNo mod 2^16); timestamp is `uint40(block.timestamp)` and a
backwards timestamp uses dt = 0; first-swap detection uses the count **before** increment. Widen tick before abs and
widen EMA/pressure arithmetic. Preserve the exact arithmetic, bit offsets and event order against `spec/vectors-v2.json`
(554 cases, generated by Foundry from the production transition) and the TypeScript port in `packages/core`.

## Invariants the swarm must preserve

1. Exactly SPEC §3.2 physical packed slots 0/1 and matching `state()`/`raw()` views; reserved bits remain zero. No sentinel, transformed encoding, extra sequencer write, or different struct layout. Pool-binding metadata may remain separate.
2. A non-whale swap changes at most one drum bit (its accumulation/spill target) and the hashed step's bass nibble; a whale changes one whole track; a track completion reseeds the pattern and thins the bass as SPEC §3.3.10 says. releaseCount is never written. BPM/mode/root/heat remain in range for initialized state.
3. Valid bound-pool swaps must not fail due to counter/EMA overflow. Unauthorized callers, invalid pools, reinitialization and disabled callbacks must still revert.
4. No fee, return-delta flag, custody, transfer, mint, burn, token approval, settlement, donation, owner, setter, pause, rescue, signer, proxy or upgrade in the hook. Return exactly `(afterSwap.selector, 0)`. Keep the token's plain fixed-supply behavior.
5. Keep only the three required callback permissions. Do not copy proxy/all-flags launch 825, the fees or oracle machinery from Marginalia, or Pixel Pool's direction-based buy definition.
6. TrackReleased is a reserved ABI declaration only. No R7 oracle, release mutation, scheduler or additional administration in this version.

## Review and acceptance

Run `cd contracts && forge build && forge test`, `forge fmt --check src test`, and `python3 scripts/validate-vectors.py` (v1 and v2 vectors). The Foundry tests generate vectors directly from the production transition and test real PoolManager swaps with a native-ETH quote and an ERC20 quote in both currency orderings, exact input/output, partial fills, per-event reconstruction, flags, authorization, pool binding, rollover and gas. Preserve Solidity/TypeScript parity when adapting launch packaging.

Gas (cold callback, `contracts/GAS.md`): normal v2 swaps 34.6k–38.9k with a 40k test ceiling, track completion ~42.7k
(45k ceiling), whales ~36.5k; the synthetic zero-slot1 stress case ~55k (56k ceiling) is not reachable from v2
initialization. Do not "fix" this with a state-layout change. Because the step comes from a hash over `block.number`,
the path and its gas differ between the block a wallet estimated on and the block that mines the swap (~9k spread on a
~175k swap): routers and wallets need a normal gas margin; an exact estimate can run out of gas (seen on the Sepolia v2
rehearsal, `contracts/deployments/sepolia-v2.json`, where 118 swaps matched the TypeScript model bit for bit).

Before actual launch, independently review and rehearse the selected Robinhood LaunchFactory on a current fork: token prediction/creation, flag mining, initialization, one-sided LP seeding, a buy, a sell, LP withdrawal, state/events and zero hook balances. Publish the immutable source commit, manifest hash, review/audit output, IMD job/launch IDs, deployed addresses, poolId, transaction receipts, and explorer links. No live factory/fork rehearsal or deployment is claimed by the local reference tests. Do not redesign the sequencer while adapting the packaging.
