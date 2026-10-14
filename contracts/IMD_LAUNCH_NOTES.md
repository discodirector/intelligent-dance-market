# IMD launch compatibility research

Researched 2026-10-15 (Asia/Bangkok), before implementation. No deployment, request submission, payment, broadcast or funded transaction was performed.

## Selected chain and live capability

The owner selected **Robinhood Chain, chainId 4663**, paired with IMD. The official [capabilities endpoint](https://api.imd.fun/requests/capabilities), read during this task, lists both `univ4_hook` and the `imd` pairing for 4663, with 18 decimals. This is distinct from Sepolia, whose current launch pairings list only ETH. Recheck capabilities at actual submission.

The [official contract address table](https://imd.fun/docs/#contract-addresses) lists:

| Contract | Robinhood address |
| --- | --- |
| IMD | `0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127` |
| LaunchFactory | `0xa25b02a1e93903b790e6aaf7da1b8b8d50294645` |
| LaunchFactory registry | `0x842e9bcff1e68566d45697a84f5b38c1c7766edb` |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| ProjectFactory (different launch path) | `0x9c9d2fcb75c2c132c0ac0c42df3819a42347265e` |
| PoolInitializationGuard (ProjectFactory path) | `0x19bec7c2e1b2aadaf67b259744751a9960d66000` |

Addresses are documentation-verified, not bytecode/fork-verified in this task. The docs warn that sources are not all explorer-verified. Local tests execute the pinned genuine v4 PoolManager, not a substitute.

## Request and factory lifecycle

[IMD docs](https://imd.fun/docs/) specify `launch.open@launch-1`, `onchain: "univ4_hook"`, explicit `chainId: 4663`, and `pairWith: "imd"`. This path creates a hook, a launch token and its pool. The token policy is 1 billion tokens, 18 decimals, plain transfers; the factory handles allocations and single-sided launch-token liquidity. Pool fee policy is currently 12500 (1.25%). The hook's own additional fee is **0**. The public check endpoint can evaluate a prepared request, but this task has not called a paid or mutating request endpoint.

The [Marginalia factory interface](https://github.com/identity-md-launches/launch-1283-marginalia-x-com-marginalia-md-notes-mar/blob/4666916/src/interfaces/ILaunchFactory.sol) exposes `predictToken(launchNumber, tokenCreationCode)` and `launch(LaunchParams)`. Parameters include token/hook creation code, hook CREATE2 salt/flags, paired currency, fee, tick spacing, price and LP range/liquidity. Its [manifest](https://github.com/identity-md-launches/launch-1283-marginalia-x-com-marginalia-md-notes-mar/blob/4666916/launch.json) resolves `$poolManager`, `$token`, `$factory` for the hook. The token is created with its full fixed supply minted to its constructor caller, the factory; creation, pool initialization and liquidity/recording belong to the factory workflow. The predicted token permits embedding its address in final hook initcode before deployment.

`PoolInitializationGuard` is documented as the **ProjectFactory** pool hook. It is not an inherited base contract and cannot be composed as a second hook in one v4 pool key. Our `univ4_hook` uses SequencerHook itself in `PoolKey.hooks`. Its `beforeInitialize` enforces the immutable LaunchFactory as callback `sender`, and `afterInitialize` repeats validation then binds the pool. This avoids a permissionless first initializer stealing the opening price. Construction and initialization still belong in the same factory transaction. Liquidity callbacks are disabled, so normal factory seeding and withdrawal are unaffected.

## What the actual examples demonstrate

- [Pixel Pool launch 1118](https://github.com/identity-md-launches/launch-1118-pixel-pool/tree/661f8bf): direct `IHooks`, manager-only callbacks, fixed IMD address, `$token` constructor argument, sorted pair and full pool-id binding, fee 12500/tick spacing 60, no hook delta or funds. The original uses `beforeInitialize`/`afterSwap` flags `0x2040`. It checks constructor code presence and leaves initializer identity unrestricted; **we do not copy those choices**, because Marginalia documents empty-EVM admission rehearsals and factory-only binding is stronger. Pixel uses swap direction to classify buys; our spec requires the actual SEQ delta sign instead.
- [Marginalia launch 1283 hook](https://github.com/identity-md-launches/launch-1283-marginalia-x-com-marginalia-md-notes-mar/blob/4666916/src/MarginaliaHook.sol): direct `IHooks`, constructor binding of manager/token/factory without chain-state reads, `Hooks.validateHookPermissions`, one factory-initialized pool. It discovers the other currency from the known launch token. Sequencer instead also accepts explicit IMD immutable input and validates the exact pair, preserving both currency orderings without trusting an arbitrary counter-token.
- [Launch 825](https://github.com/identity-md-launches/launch-825-build-uniswap-v4-hook/tree/a580c0f): its delivered `launch.json` explicitly says the manifest **cannot launch as written**. Bare implementation initialization is disabled; the working proxy needs a deployment sequence the manifest cannot express, and admission rejects `DELEGATECALL`. It is useful negative evidence, not a compatible deploy template. Sequencer has no proxy, delegatecall, initializer admin or owner.

No special IMD BaseHook inheritance is evidenced by these repos. The required surface is v4 `IHooks`, exact permission flags/selector returns, and caller validation. Sequencer implements this surface directly; disabled selectors revert. Its production code depends on v4-core; pinned v4-periphery `HookMiner` independently checks CREATE2 calculations in the tests.

## Sequencer implementation contract

Constructor, in order:

```solidity
SequencerHook(IPoolManager manager, address token, address factory, address imd,
              uint128 hat, uint128 glitch, uint128 snare, uint128 kick)
```

Default thresholds: `5e17, 5e18, 25e18, 100e18`. Nonzero/distinct addresses and increasing thresholds are checked without external code reads. There is no administrative role associated with `factory`; it only authorizes the one pool initialization.

Enabled flags are **beforeInitialize + afterInitialize + afterSwap = `0x3040`**. All return-delta flags are false; `afterSwap` returns `(IHooks.afterSwap.selector, 0)`. The SEQ delta is selected using immutable `$token`; buy means that component is positive. The other component must be the immutable IMD currency, whose absolute actual delta determines the track. Signed amounts/ticks are widened before absolute value. Post-swap tick comes from PoolManager's `StateLibrary.getSlot0`, not a pre-swap approximation or price-derived inference.

The two sequencer words occupy physical storage slots 0 and 1 exactly as SPEC §3.2; pool binding metadata is separate and never written during swaps. `raw()` and the event return precisely these words. No sentinel or reserved bit is used. All non-listed initial fields are zero. Coordinator-approved wrap semantics are in SPEC §3.3: unchecked 32-bit counters, first-swap detection before increment, timestamp-backwards interval zero, widened EMA/pressure math. `Movement` uses the whale increment before a simultaneous PAGE increment; `Mutated` contains final packed state.

## Address mining and versions

Mine the factory's **actual CREATE2 deployer**, not a wallet, generic CREATE2 proxy or guessed address:

```
address = low160(keccak256(0xff || factory || salt || keccak256(creationCode || abi.encode(args))))
(address & 0x3fff) == 0x3040
```

Every constructor argument, token prediction, compiler setting or code change invalidates the salt. Constructor `Hooks.validateHookPermissions` rejects a wrong address. Integration fixtures CREATE2-deploy the real hook at mined addresses and check the prediction with upstream `HookMiner.computeAddress`.

All three example projects pin Solidity **0.8.26**, Cancun, optimizer 200 and metadata hash `none`. Marginalia additionally uses IR; Sequencer does too. Their v4-core pin is `46c6834698c48bc4a463a86d8420f4eb1d7f3b75` (with standalone `PoolOperation.sol`). Pixel vendors forge-std v1.17.0; Marginalia uses v1.9.6 with a documented assertions patch; launch 825 pins forge-std `77041d2…`. Their manifests do not pin the Foundry binary, so its exact historical version cannot be inferred. This task used Foundry **1.8.5**, commit `51a52c59cffd940f76eddd0b4bb1791aa4b5ac7f`. Exact local dependency pins and licenses are in [DEPENDENCIES.md](DEPENDENCIES.md).

## Remaining launch-stage work

Finalize name/symbol and a public immutable source commit, import that reference, have the IMD swarm independently review and rehearse the actual Robinhood factory on a current fork, verify addresses and token prediction, mine the final flags, and let the owner authorize/pay the eventual launch. The sample manifest's `initialPrice = 2^96` is a provenance value, not an instruction to override policy economics. Actual sorted-pair price, one-sided range and liquidity must be computed by the launch workflow. None of those launch actions were performed here.
