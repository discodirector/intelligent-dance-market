# Reproducible dependencies

Solidity 0.8.26, Cancun, optimizer 200, via IR, metadata hash `none`. Tested with Foundry 1.8.5 (`51a52c59cffd940f76eddd0b4bb1791aa4b5ac7f`). Source dependencies are ordinary vendored files, not submodules; building needs no dependency downloads.

| Path | Upstream revision | Included scope |
| --- | --- | --- |
| `lib/v4-core` | [Uniswap/v4-core `46c6834698c48bc4a463a86d8420f4eb1d7f3b75`](https://github.com/Uniswap/v4-core/tree/46c6834698c48bc4a463a86d8420f4eb1d7f3b75) | Production `src/` and licenses; real PoolManager in tests |
| `lib/v4-periphery` | [Uniswap/v4-periphery `9969eec44cfdf07e24b41de47f40276a58401976`](https://github.com/Uniswap/v4-periphery/tree/9969eec44cfdf07e24b41de47f40276a58401976) | Unmodified `test/shared/HookMiner.sol` and LICENSE |
| `lib/forge-std` | [foundry-rs/forge-std v1.17.0 `f3dae6e6ee381f25eb6a246f7da9b85c91a68219`](https://github.com/foundry-rs/forge-std/tree/f3dae6e6ee381f25eb6a246f7da9b85c91a68219) | Test `src/` and licenses |
| `lib/solmate` | [transmissions11/solmate `4b47a19038b798b4a33d9749d25e570443520647`](https://github.com/transmissions11/solmate/tree/4b47a19038b798b4a33d9749d25e570443520647) | PoolManager's `Owned.sol` dependency and LICENSE |

The vendored scope was selected from the [Pixel Pool launch 1118 snapshot](https://github.com/identity-md-launches/launch-1118-pixel-pool/tree/661f8bf), whose dependency manifest records those exact pins. Every file was then checked against a separately downloaded official upstream archive at the listed commit. Ten v4-core files in the example had formatting differences despite its stale checksum manifest; these were replaced with the exact official files. forge-std and Solmate matched directly. v4-periphery files were downloaded directly from the pinned official upstream commit. No delivered dependency source has been modified from its official pin. `DEPENDENCY_SHA256SUMS` lists every delivered vendored file.

`SequencerToken.sol` is adapted from that project's MIT `PixelToken.sol` (metadata changed to Swarm Sequencer / SEQ); `test/helpers/PoolRouter.sol` and `MockIMD.sol` are its MIT test helpers, copied unchanged. Original license notices are retained. Our original Solidity and test code is MIT; vendored files retain their individual upstream MIT, Apache or BUSL terms. The upstream PoolManager's ownership is part of the test environment, not an owner of SequencerHook.

`bin/` contains ignored local tools used during this task; it is not part of the source deliverable. Standard environments can use installed `forge` with the compiler version pinned by `foundry.toml`. This machine has no global Foundry installation; use `PATH="$PWD/bin:$PATH" FOUNDRY_SOLC="$PWD/bin/solc"` from `contracts/` with the already-downloaded tools.
