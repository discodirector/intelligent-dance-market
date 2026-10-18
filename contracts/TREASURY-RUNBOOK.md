# Pulse treasury runbook

`PulseTreasury` (`src/PulseTreasury.sol`) receives the launcher's fee share and, after 15 minutes without any swap,
buys a hat-sized amount of IDM with ETH so the track keeps playing in silence. It is immutable: no owner, no admin,
no withdrawal. Rules and numbers (Russian): `SPEC.md` §9 "Казна-пульс". Nothing below has been run.

## Constants

| Name | Value | Meaning |
| --- | --- | --- |
| `PULSE_IDLE` | 900 s (15 min) | minimum silence since the hook's `lastTs` |
| `MAX_PULSE` | 0.002 ETH | largest pulse (L = 812) |
| `MIN_PULSE` | 0.000025 ETH | dust floor = hook EMA floor (L = 710); below it `pulse()` reverts `NoBudget` |
| `HAT_OFFSET` | 24 (1.5 octaves) | pulse size = `2^((sizeLogEma - 24)/16)` in `log2Fixed` space |
| `BUDGET_DIVISOR` | 100 | one pulse spends at most 1% of the ETH balance |
| `SQRT_PRICE_LIMIT_BPS` | 9900 | price may fall at most 1.99% per pulse (partial fill at the limit) |

Cadence in total silence: one pulse per 15 min, 96/day, at most 0.192 ETH/day (each pulse also <= 1% of the
balance). Heat never resets during pulsed silence (15 min < 3600 s), so on a saturated grid 16 pulses finish a
track in ~4 h. The synth thins after 10 min idle and comes back with each pulse; it never reaches sparse or drone. Measured `pulse()` gas
(cold, test suite): ~143k normal grid, ~169k saturated grid.

## 1. Deploy (after launch)

The constructor checks the key against `hook.poolId()`, so the hook must already be initialized by the factory.

```sh
cd contracts
export PATH="$PWD/bin:$PATH" FOUNDRY_SOLC="$PWD/bin/solc"
export POOL_MANAGER=0x8366a39cc670b4001a1121b8f6a443a643e40951   # Robinhood Chain 4663 (docs table, recheck)
export HOOK=0x...   # deployed SequencerHook
export IDM=0x...    # launched IDM token
# Simulate first (no --broadcast). Broadcasting is a separate, owner-approved step with the owner's own signer.
forge script script/DeployTreasury.s.sol --rpc-url "$RPC_URL"
```

Record the address in `deployments/` and set it as the treasury address in the clients (see 4).

## 2. Point the launcher's fee share at the treasury

IMD pays 1% of the 1.25% pool fee to the launch's requester, in both pool currencies (native ETH and IDM).
The owner redirects it with the LaunchFactory (Robinhood: `0xa25b02a1e93903b790e6aaf7da1b8b8d50294645`):

```text
LaunchFactory.setRequester(uint64 launchNumber, address next)   // next = treasury; called by the paying wallet
```

What we know (IMD docs + the factory bytecode, 2026-10-18; the source is not verified on the explorer):

- `setRequester(uint64,address)` is called by the wallet that paid the launch (docs: "the payer calls
  `setRequester(launchNumber, next)` on the factory that deployed it"). `launchNumber` is on `GET /launches/:id`.
- The fee is distributed by `claimFees(uint64 launchNumber)`, which anyone may call ("Anyone can call the
  distribution"). Payouts are **pushed** in both pool currencies; "a payout a contract cannot take is kept owed to it
  on the factory, not lost" (`owed(address,address)`, `withdraw(address,address)`). The treasury's empty `receive()`
  takes pushed ETH, and IDM arrives by transfer, so nothing should stay owed.
- The pulse keeper calls `claimFees` once a day when `FEE_FACTORY` and `LAUNCH_NUMBER` are set (bot/src/pulse.ts),
  so the treasury tops itself up without a manual step.

Still to confirm on the first real payout: whether `setRequester` applies to fees accrued before it (call
`claimFees` once **before** redirecting to keep those on the paying wallet if they matter), and that both treasury
balances grew after `claimFees`. If a payout ever stays owed, the treasury has no call to withdraw it: that would
need a new treasury version.

## 3. Run it

`pulse()` is permissionless; anyone can call it. Our keeper is `bot/src/pulse.ts` (dry-run by default, key only from
`PULSE_KEY`), see `bot/README.md`. `burn()` is also permissionless: it sends the whole IDM balance to `0x…dEaD`
(open question for the owner: burn regularly or hold).

## 4. Clients

Pulses are swaps whose `Mutated.sender` is the treasury address. Set the address in:

- site: `site/src/config.ts` → `treasury` of the network (log line "PULSE · treasury buy");
- bot: `PULSE_TREASURY` env (facts `pulse: true`, keeper target);
- core: `isPulse(sender, treasury)`.

Empty until deployed: nothing is labelled.
