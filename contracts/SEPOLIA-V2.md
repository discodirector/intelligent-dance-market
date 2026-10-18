# Sepolia v2 rehearsal: IDM/ETH (native ETH)

A step-by-step runbook for the owner. It deploys the **v2 hook** (relative tiers + accumulation + heat/drop) paired with **native ETH**, exactly like the Robinhood Chain launch (`pairWith: "eth"`; Sepolia only offers ETH pairing anyway), drives real swaps through it until one `TrackComplete`, then points the site and the bot at it.

Nothing here has been run. Every step that sends a transaction is marked **[tx]** and needs your key and your go-ahead. No key, RPC URL or other secret goes into git.

## What gets deployed

`script/DeploySepolia.s.sol`, broadcast from your throwaway Sepolia key (the key acts as the "factory"):

| Step | What | Sepolia gas (approx.) |
| --- | --- | ---: |
| 1 | `SequencerToken` (1B IDM to the deployer) | ~2.2M |
| 2 | `SequencerHook` at a CREATE2 address mined for flags `0x3040`; quote `address(0)`, thresholds from `src/QuoteCalibration.sol` (0.00125 / 0.0125 / 0.0625 ETH); the whale threshold scales with FDV (SPEC §3.1), ~0.04 ETH at the opening price | ~9.3M |
| 3 | `SimRouter` (payable; refunds unspent ETH) | ~1M |
| 4 | `PoolManager.initialize`: ETH = currency0, IDM = currency1, fee 12500, tick spacing 60, 250,000,000 IDM per ETH (FDV 4 ETH, the launch target; tick 193379) | ~0.1M |
| 5 | `addLiquidity{value: 1.01 ETH}`: full range, 1 ETH + 250,000,000 IDM (unspent ETH refunded) | ~0.3M |

Gas figures come from the earlier Sepolia deploys (Sepolia prices contract creation ~5× higher than a local EVM). At 1–5 gwei the deploy costs roughly **0.015–0.07 ETH**, plus the **1 ETH** that stays in the pool as liquidity.

## Budget

| Item | ETH |
| --- | ---: |
| Deploy gas | 0.015–0.07 |
| Pool liquidity (stays in the pool) | 1.0 |
| `track` profile, 110 swaps: buys pay ~0.40, sells return ~0.04 | ~0.37 net |
| `whale` profile, 4 swaps (2 whales) | up to ~0.3 in, part back |
| Swap gas: ~150–220k per swap, ~120 swaps ≈ 20–26M gas | 0.02–0.13 |
| **Have on the key** | **≈ 2.5 Sepolia ETH** |

Bought IDM can be sold back later (`--profile selloff`), recovering most of the ETH minus the 1.25% pool fee.

## 0. Prerequisites (no tx)

- This branch checked out, Foundry in `contracts/bin`, `node_modules` installed.
- `contracts/.env.sepolia` (gitignored), same format as the v1 rehearsal:

  ```sh
  SEPOLIA_RPC_URL=https://...        # any Sepolia RPC
  DEPLOYER_PRIVATE_KEY=0x...         # throwaway key, never a real wallet
  DEPLOYER_ADDRESS=0x...
  ETHERSCAN_API_KEY=...              # optional; sourcify needs none
  ```

- Local checks:

  ```sh
  cd contracts
  export PATH="$PWD/bin:$PATH" FOUNDRY_SOLC="$PWD/bin/solc"
  forge build && forge test                 # 127 passed
  python3 scripts/validate-vectors.py
  ```

## 1. Deploy [tx]

```sh
cd contracts
export PATH="$PWD/bin:$PATH" FOUNDRY_SOLC="$PWD/bin/solc"
set -a; . ./.env.sepolia; set +a
forge script script/DeploySepolia.s.sol --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --slow --skip-simulation --gas-estimate-multiplier 125 --verify --verifier sourcify
```

Keep `--skip-simulation`: forge's local simulation underestimates Sepolia's creation gas and the CREATEs run out of gas (this failed three times on the v1 rehearsal). The script prints `token`, `hook`, `router`, `quote native ETH (currency0)` and the pool id.

## 2. Record the deployment (no tx)

```sh
cd ../sim
npm run write-deployment-v2        # broadcast + RPC reads -> contracts/deployments/sepolia-v2.json
```

This overwrites the placeholder `contracts/deployments/sepolia-v2.json` (the v1 record in `sepolia.json` is untouched). Check the hook on chain:

```sh
HOOK=$(node -p 'require("../contracts/deployments/sepolia-v2.json").hook')
cast call $HOOK "quote()(address)"   --rpc-url "$SEPOLIA_RPC_URL"   # 0x0000000000000000000000000000000000000000
cast call $HOOK "whaleThreshold()(uint128)" --rpc-url "$SEPOLIA_RPC_URL"  # ~40000766134770696 (0.04 ETH at FDV 4 ETH)
cast call $HOOK "quoteIs0()(bool)"   --rpc-url "$SEPOLIA_RPC_URL"   # true
cast call $HOOK "initialized()(bool)" --rpc-url "$SEPOLIA_RPC_URL"  # true
cast call $HOOK "raw()(uint256,uint256)" --rpc-url "$SEPOLIA_RPC_URL"
```

`raw()` slot1 bits 152..167 hold `sizeLogEma = 854` = L(0.0125 ETH).

## 3. Swaps [tx]

`sim` sends each swap through the deployed `SimRouter`, decodes `Mutated` / `Movement` / `Drop` / `TrackComplete`, and checks every swap against `packages/core` `mutate()` with the v2 rules (**parity: MATCH** expected on every line). Buys pay exact ETH in (`msg.value`); sells receive exact ETH out. Preview any plan first with `--dry`, which needs no key.

```sh
cd sim
npm run sim -- --net v2 --profile track --seed 7 --dry      # plan only

# a) smoke: 4 small swaps
npm run sim -- --net v2 --profile calm --count 4 --interval 15s
# b) whales: 2 whales of 0.08-0.15 ETH (Movement root +7, Drop: buy = Euclidean fill, sell = track wipe) and 2 fills
npm run sim -- --net v2 --profile whale --count 4
# c) one finished track: steady small buys (85%, 0.0005-0.01 ETH) until heat reaches 16
npm run sim -- --net v2 --profile track --seed 7
```

What to expect:

- **calm**: `Mutated` per swap, sometimes `Accumulated` (promoted or no-op write).
- **whale**: every swap at or above the FDV-scaled threshold (~0.04 ETH at the opening FDV of 4 ETH; it rises as buys lift the price, `whaleThreshold()` reads the current one) prints `MOVEMENT root→…` and `FILL`/`DROP`. Whales never change heat.
- **track**: heat climbs once the grid holds ≥ 44 of 64 bits (or a buy changes nothing); sells cool it by 1. In offline simulation of this profile (200 seeds, satBits 44, 1 ETH pool at FDV 4 ETH) the first `TRACK #1 COMPLETE` lands after **59–98 swaps (median 72)**, at ~3 s per swap plus confirmation, so about **10–20 minutes**. Run it in one go: **an hour of silence resets heat** to 0. If the 110 swaps end without a completion, run `--profile track --count 40` again right away.
- Every run writes `sim/runs/<timestamp>.json` with tx hashes, gas per swap, expected vs actual slots, and a summary (`tracksCompleted`, `whales`, `gasUsed`).

Gas per swap is about **150–220k** (router + PoolManager + hook; the hook's own callback is 35–43k, see `GAS.md`).

## 4. Point the site at it (no tx)

`site/src/config.ts` already reads `contracts/deployments/sepolia-v2.json` for the `sepolia-v2` network; once that file has a hook it stops falling back to v1.

```sh
npm run dev -w site          # open http://127.0.0.1:5180/?net=sepolia-v2
npm run build -w site
```

Expect `LIVE · SEPOLIA V2 · RULES V2`, amounts in ETH, whale lines at the FDV-scaled threshold (~0.04 ETH here), `PAIRED WITH native ETH`, and a `TRACK #1 COMPLETE` line where the track finished. To make it the default view, set `ACTIVE_NETWORK = "sepolia-v2"` in `site/src/config.ts` (owner's call).

## 5. Point the bot at it (no tx, no posting)

In `bot/.env` (keep `DRY_RUN=true`, the default, so nothing is posted):

```sh
HOOK_ADDRESS=<hook from sepolia-v2.json>
LIVE_RPC_URL=<Sepolia RPC>
LIVE_CHAIN_ID=11155111
HOOK_START_BLOCK=<startBlock from sepolia-v2.json>
HOOK_RULES=v2
DRY_RUN=true
```

```sh
npm run scheduler -w @swarm-sequencer/bot
```

With `HOOK_RULES=v2` the bot reads `Mutated.quoteAmount` as ETH (whale = the FDV-scaled threshold at `Mutated.tick`) and `TrackComplete`; the next tick queues a `track` post in `out/queue/<ts>_track/` (video, caption, facts) instead of posting. Its title still says Robinhood Chain; that is cosmetic for a rehearsal.

## 6. After the rehearsal

- Commit `contracts/deployments/sepolia-v2.json` and the `sim/runs/*.json` logs as evidence.
- Nothing needs undoing: the hook has no owner and holds no funds; the 1 ETH stays in the pool.
- The Robinhood launch itself goes through IMD `launch.open` (`swarm/BRIEF.md`), not this script.
