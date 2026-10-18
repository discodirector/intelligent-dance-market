# sim — Sepolia swap simulator (W3b)

**v2 (IDM/ETH, native ETH)**: `--net v2` uses `contracts/deployments/sepolia-v2.json`, ETH amounts, the v2 rules
(parity against core `V2_RULES`, `TrackComplete` included) and the extra `track` profile. The full rehearsal,
from deploy to site and bot, is `contracts/SEPOLIA-V2.md`; record the deploy with `npm run write-deployment-v2`.
`--dry` prints a plan without a key or RPC. The rest of this file describes the v1 rehearsal.

Drives real swaps through the self-deployed IDM/IMD (v1) SequencerHook pool on Sepolia
(`contracts/deployments/sepolia.json`, key from gitignored `contracts/.env.sepolia`) and checks, for every swap,
that the on-chain `slot0/slot1` emitted in `Mutated` equal `packages/core` `mutate()` applied to the previous
on-chain state (Solidity ⇔ TS parity on a real chain).

```sh
cd sim && npm run sim -- --profile busy --count 40 --interval 20s
npm run sim -- --profile smoke            # calm, busy, whale, selloff, random back to back (66 swaps, crosses page 64)
npm run sim -- --profile whale --dry      # print the plan only
# once "sim" is in the root workspaces: npm -w sim run sim -- --profile busy --count 40 --interval 20s
```

Profiles: `calm` (0.1–3 IMD, slow) · `busy` (0.2–60 IMD, fast, mixed) · `whale` (alternating 100–500 IMD whales →
Movement/root+7) · `selloff` (92% sells → Phrygian/Locrian) · `random` (mix, ~10% whales). `--seed` makes a plan
reproducible. Buys pay an exact IMD input; sells receive an exact IMD output, so `imdAmount` equals the requested size.
Test IMD is minted (`mint(to, amount)`, free on Sepolia) when the wallet runs low.

Run logs: `runs/<ISO timestamp>.json` — per swap tx hash, block, decoded Mutated/Movement, expected vs actual slots,
`parity: match|mismatch`, plus a summary.

Deploy (from `contracts/`, Foundry in `bin/`):
```sh
export PATH=$PWD/bin:$PATH FOUNDRY_SOLC=$PWD/bin/solc; set -a; . ./.env.sepolia; set +a
forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --slow --skip-simulation --gas-estimate-multiplier 125 --verify --verifier sourcify
cd ../sim && npm run write-deployment      # -> contracts/deployments/sepolia.json
```

**Gas gotcha (Sepolia, Oct 2026):** Sepolia's current fork prices contract creation / new state ~5× higher than
forge's local EVM (token 2.17M vs 435k, hook 9.3M vs 1.8M). Forge's default local simulation sets gas limits too low
and the CREATEs run out of gas. `--skip-simulation` makes forge estimate each tx on the RPC. Three earlier attempts
failed this way (cost < 0.001 ETH; they left an orphan token at 0x1AfF03E808F4921024Fa67fc5Ffb28CA0e6e85E5, which is unused).
