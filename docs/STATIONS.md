# Stations: a radio for any token

A station plays one token's pool through the $IDM rules (v2), off-chain, exactly like the IMD/ETH station
(site `?net=imd-eth`, `site/src/data/virtual.ts`, `bot/src/station.ts`). No hook, no permission: Swap logs are public.
Token owners buy a station; the IMD swarm writes its sound; theidm.fun lists every station on air.

## Flow

1. **Apply** on theidm.fun/stations: chain, pool, ticker, links, contact.
2. **Eligibility** (automatic, `bot/scripts/station-check.ts`), refused at once if any fails:
   market cap >= $50k, holders >= 100, pool liquidity >= $20k, token age >= 7 days, a simulated sell succeeds.
   The owner (theidm) keeps a veto; a station whose token rugs is switched off, no refund.
3. **Pay** in stablecoins (Ethereum, Base, Arbitrum, Robinhood): setup = a service fee + the swarm's cost in IMD at the
   rate of the order day (launch: $50 + 1.5 IMD, later $100 + 3 IMD; first month included), then a subscription
   (launch $30/month or $75/3 months, later $50 / $125). The IMD part buys the IMD that pays the swarm. Service fees and
   subscriptions are split in three: 1/3 buys back and burns $IDM, 1/3 buys back and burns IMD, 1/3 pays for the
   infrastructure. A station that is not renewed goes off air and keeps its sound; renewing needs no new setup.
4. **Swarm**: theidm opens `job.open` (0.5 IMD) on the public repo for the station's style pack, from theidm's own
   wallet, so `job.continue` revisions (0.5 IMD each) stay available. Price includes up to two revisions.
   Tooling: `bot/scripts/swarm-style.ts` (below, "Ordering the sound").
5. **Gate**: automatic checks on the pack (below), then the owner listens. Nothing goes on air unheard.
6. **On air**: the station is added to the registry, gets its page `theidm.fun/s/<key>`, its LCD theme and a launch post.
   Fallback if the swarm fails twice: the station starts on house styles with its own theme, partial refund.

## Program: what a station plays

Today `eraOf(epoch)` / `styleOf(era, epoch)` read global schedules. A **program** carries both:

```ts
interface Program {
  key: string;                         // "idm" (house), "imd-eth", "<station>"
  eras: EraScheduleEntry[];           // which genres, in which order (ERA_SCHEDULE shape)
  styles: StyleScheduleEntry[];       // which styles per genre (STYLE_SCHEDULE shape)
}
```

The house program is today's schedules, so $IDM and IMD/ETH sound exactly as before (FROZEN_SHA256 unchanged).
Every caller (`player`, `engine`, `clock`, `release`, site `main`/`bot`, bot `facts`) takes the program, default house.
A station's program is frozen like ours once it is on air: append-only.

## Style pack: what the swarm writes

A station style is a **variant of an existing style renderer**: same voice code in `engine.ts`, different data —
tempo/swing/feel, drum patterns, chord progressions, bass lines, phrases, and the sound: kit timbres, synth patches,
lead patches, effects, mix trims.
Data only, one file, no engine edits:

```
packages/synth/src/stations/<key>.ts   export default { key, name, genres: [...], styles: { <genre>: GenreStyle[] } }
```

Each `GenreStyle` gets `base: "<existing style id>"` and `data: {...}` overrides for the tables that renderer reads.
The engine reads `c.style.data?.<table> ?? <DEFAULT_TABLE>`; renderers are opened to data overrides genre by genre
(start: liquid, futuregarage, triphop, lofihouse, acid — the most table-driven).

Implemented: the data contract per genre is `packages/synth/src/styledata.ts`; `pack.ts` has `validatePack` and
`programFromPack` (fields a style leaves out are inherited from its base, so `{ id, name, base }` plays exactly like
the base); `stations/example.ts` is the reference pack and `stations/README.md` the swarm's brief.

Sound (level 1): besides notes and rhythm, a style's data opens the sound of its base, so a station can sound like
another producer: drum voices (kick specs, snares/claps/perc as synth layers, hats, shakers), the sub and the
genre's tonal voices (pads, strings, choirs, reese, bass guitar, organ, chord sample, the 303), effects (echo, room,
sends, drum filter, saturation, sidechain, master lowpass/highpass/crusher, vinyl, rain) and per-bus mix trims
(±6 dB). The pack may also define its own lead patches (`patches`). All data, bounded ranges, merged over the
base's values (`SOUND_DEFAULTS` in `engine.ts`); a style that restates them plays exactly like its base.
`packages/synth/scripts/engine-trace.ts --ref <ref>` proves a refactor leaves the house schedule untouched;
`web/scripts/station-ab.mjs <key>` renders house-base-vs-style A/B clips for listening.

Pack checks (`web/scripts/station-check-pack.mjs`, run by the swarm job and again here):
types compile, only the pack file changed, every style renders 3 epochs offline, loudest-3s within ±1 dB of
-14.3 dB, no clipping, no silence > 2 bars, deterministic (two renders hash equal), house FROZEN_SHA256 unchanged.

## Ordering the sound

`bot/scripts/swarm-style.ts` orders a station's style pack from the IMD swarm and brings it back for the gate:

```
npx tsx bot/scripts/swarm-style.ts check  --key chog --genres liquid,acid --brief "playful, bouncy, Monad purple energy"
                                          [--styles 2] [--repo <public GitHub repo>] [--commit <sha>] [--json]
npx tsx bot/scripts/swarm-style.ts order  (same args) [--payer 0x...]    pays 0.5 IMD: job.open
npx tsx bot/scripts/swarm-style.ts revise --key chog --notes "<what the owner wants changed>"   0.5 IMD: job.continue
npx tsx bot/scripts/swarm-style.ts status --key chog                    one read of the order and the job
npx tsx bot/scripts/swarm-style.ts fetch  --key chog                    waits, takes the pack, runs the gate and the A/B
```

- **The body** (`bot/src/imd/styleJob.ts`, unit-tested): `skill: "refine-project"` (changes an existing tree, writes
  only the given `paths`, no Foundry checks; the implement-* skills check with Foundry, scaffold-project starts from
  an empty tree), `repoUrl` + `baseCommit` (default: the public repo's `main`, by `git ls-remote`),
  `paths: ["packages/synth/src/stations/<key>.ts"]`, `github: true`. The objective is `stations/README.md` boiled
  down: exactly one file, data only, the genres in order, 2 styles each (`--styles`), the owner's words, the taste
  rules, and the gate it must pass (`station-check-pack.mjs <key> --diff <baseCommit>`); ~2.2k of the 8k chars.
- **check** is the free `POST /requests/check`: prints the body and the blockers/suggestions. No key, nothing held.
- **order / revise** pay like `imd-launch.ts` (the shared flow is `bot/src/imd/paid.ts`): check first, hidden key
  prompt, an exact Permit2 approve if needed, typed `pay`, then the order is polled until admitted and its job id
  recorded. State per station in `bot/.swarm-style/<key>.json` (gitignored: request tokens, order and job ids, the
  payer), so a rerun resumes the same order instead of paying twice. `revise` continues the project's head job
  (`project.head`) and refuses before paying when the check's `owner` is not the wallet that paid the first job (the
  swarm would refuse it after the payment, and the payment would be spent).
- **fetch** waits for the job (`GET /jobs/:id`) and its delivery (`GET /jobs/:id/result`: `delivery.repoUrl` +
  `commit`), fetches that commit, and copies only `packages/synth/src/stations/<key>.ts` into the working tree on the
  local branch `station/<key>` (created from HEAD, never main, left uncommitted; it refuses a tree with other
  changes and reports any other file the delivery touched). Then `station-check-pack.mjs <key> --diff HEAD` and
  `station-ab.mjs <key>`; the WAVs are in `sim/stations/<key>/`, `ab-house-vs-pack.wav` first.

The public repo must carry what the job reads and runs: as of 2026-10-21 its `main` (8e39ef7) is an older snapshot
with no `pack.ts`, `styledata.ts`, `stations/` (README, example), no `station-check-pack.mjs` / `station-ab.mjs` /
`station-gate-windows.json` and none of the engine's data hooks. The free check does not read the tree (it passes on
that commit with no blockers and `judged: false`), so nothing warns: push those first, then `order` on that commit.

## Registry

`stations/registry.json`, shared by site and bot:
`{ key, label, ticker, chainId, kind, poolManager + poolId (v4) | pool (other kinds), token, quote, ethSide,
genesisBlock, quoteSymbol: "ETH", calibration?, rpcUrls?, theme: { phos, phosDim, ghost, lcd }, program: "<pack key>",
status: "live"|"paused" }`.
Also `kind: "hook"` (+ `hook` address) for the $IDM hook pool, `house: true` for theidm's own stations (listed first),
and a top-level `chains` map: name, explorer, default `rpcUrls` (public, browser CORS, old log ranges), `logChunk`
(blocks per eth_getLogs: Ethereum 20k, Base 1k, Arbitrum 50k, Robinhood 20k, Monad 1k), `weth`, v4 `poolManager`,
`nativeSymbol` when the native currency is not ETH (Monad: MON).
`site/scripts/check-stations.mjs` checks the shape before every site build; `site/src/stations.ts` types it, and every
entry but the hook becomes `?net=<key>` on the player.

Coverage: Ethereum, Base, Arbitrum, Robinhood, Monad; ETH or WETH pairs, or any other quote (WMON, native MON,
stablecoins) with a `calibration.quotePerEth` (the check refuses them without). Kinds, by Swap event (`packages/core/src/swaps.ts`, used by site `data/virtual.ts`,
`stations-page.ts` and bot `station.ts`): `v4` (PoolManager logs by poolId), `v3` (Uniswap v3 and same-event forks:
Aerodrome Slipstream, Sushi v3), `pancake-v3`, `v2` (Uniswap v2 and same-event forks), `aerodrome-v2` (Aerodrome classic
volatile pools). Each decodes to the rules input `{ isBuy, quoteAmt, tick }`: isBuy = the token left the pool,
quoteAmt = |ETH delta| in wei, tick in the IMD/ETH orientation (ETH = currency0, 1.0001^tick = token wei per ETH wei,
what the FDV whale reads); a pool with ETH on the other side is inverted from its sqrtPrice, a v2 pool's tick is
floor(log_1.0001(reserveToken / reserveEth)) from the Sync of the same swap. `ethSide` (which side is ETH: v4
currency0/1, v2/v3 token0/1) is resolved on chain when the entry is added, never guessed at runtime:
`bot/scripts/station-probe.ts --chain --kind --pool --token --blocks N [--calibrate]` plays a window of any pool through
the decoder and the rules and prints the registry fields to copy.

### Calibration

The rules were written for $IDM: 1e9 tokens of 18 decimals, quoted in ETH. The whale reads the FDV from the tick as
1e27 / 1.0001^tick (K·sqrt(FDV)), and the sizes are ETH wei. Another supply or another quote puts a pool in the wrong
frame: PEPE (4.2e32 raw) reads as an FDV of ~1.9 ETH, so its whale line sits near the 0.005..0.03 ETH floor and most of
its swaps are whales; a WMON or USDC pool has its amounts in the wrong unit. An optional `calibration` on the entry
maps the pool onto the $IDM frame in the shared decoder (core `swaps.ts`), before the rules:

```
"calibration": { "supplyTickOffset": -129503 }                     PEPE/WETH (Ethereum)
"calibration": { "supplyTickOffset": 0, "quotePerEth": "111372" }   CHOG/WMON (Monad, nad.fun)
```

- `supplyTickOffset` (int): added to every tick, round(log_1.0001(1e27 / totalSupplyRaw)); the rules' FDV becomes the
  token's real FDV in ETH. 0 for any 1e9 x 1e18 token (nad.fun tokens).
- `quotePerEth` (decimal string): the quote token per 1 ETH at registration. Amounts become
  floor(quoteAmt x 1e18 / (quotePerEth x 10^quoteDecimals)) ETH wei and the tick (token per quote) gains
  floor(log_1.0001(quotePerEth x 10^quoteDecimals / 1e18)) so it reads token per ETH. Absent or "1" = ETH/WETH.
- `quoteDecimals` (int, default 18): USDC 6.

Integers and exact rationals only (the tick shift is the exact floor from TickMath, not a float log), so every replay
is bit-identical. No calibration = the swaps exactly as before (tested on every fixture). Frozen once the station is on
air: changing it changes every tick and size, so the history (and the checkpoint fingerprint) with it.
`station-probe.ts --calibrate` reads totalSupply and decimals on chain and the quote's rate from DexScreener (the
pair's priceUsd / priceNative against the deepest Ethereum WETH price), plays the window with and without the
calibration, checks the rules' FDV (core `fdvWeiAtTick` at the calibrated tick) against DexScreener's FDV in ETH, and
prints the block to paste. Checked 2026-10-21: PEPE ratio 1.015, ARB 0.999, AERO 1.002 / 1.004, IMD 1.000; Monad
CHOG 1.000, emo 1.004, MOLANDAK 1.000, JAMES 1.088 (a v2 pool's tick is its reserves at the last swap, hours old).

The whale scales with sqrt(FDV): a calibrated large cap (PEPE, ARB, AERO: FDV 0.7-0.8M ETH) has a whale line of
~17 ETH, so whales are rare there and its tracks move by heat; the uncalibrated PEPE pool counted 589 whales in 1,007
swaps. The IMD/ETH station has no calibration (IMD's supply is 4.17M, so its rules FDV reads ~240x the real one): it
stays as it is, its history frozen.

## Site

`/stations`: a list of stations on air (ours first): mini LCD in the station's colours, ticker, chain, genre · style
now, track #, swaps; one plays at a time. `/s/<key>` = the player on that station. Long histories replay from a
checkpoint instead of from genesis (below).

### Checkpoints

The bot replays every live registry station and publishes `<key>.checkpoint.json` (core `checkpoint.ts`):
`{ version, key, fingerprint, block, slot0, slot1, swapCount, trackNo, trackStartSwap, generatedAt, recent[] }` —
the v2 state (the hook's slot packing) after every swap up to `block`, where the current track started, and the last
64 swaps for the player's tape. `fingerprint` = chain, source (kind, address, poolId, side, calibration) and genesis
block: a checkpoint is only applied to the stream it came from.

The site (`data/virtual.ts`, used by the player and `/stations` cards) fetches `/stations-data/<key>.checkpoint.json`,
checks it (`checkpointProblem`: version, key, fingerprint, block between genesis and the RPC's head, slots that agree
with their counters), starts from its state and replays only the blocks after it. Missing, unreadable (an SPA fallback
page included) or refused: the full replay from genesis, as before. An old checkpoint is still used (replaying from it
is never slower than from genesis). Starting from a checkpoint and replaying the rest = the full replay, state after
every swap and track lengths included (`packages/core/test/checkpoint.test.ts`, `bot/test/station.test.ts`).

Bot side (`bot/src/station.ts` `updateStations`, run by the scheduler each tick with `STATION_CHECKPOINTS=1`): the
cached timeline per station in `OUT_DIR/stations/<key>.json` (house stations keep every entry for releases, others the
last 2,000), the checkpoint written whole then renamed into `STATIONS_DATA_DIR` (default `OUT_DIR/stations-data`).
In production the bot's `OUT_DIR` is `/opt/swarm-sequencer/out` on the VPS, so the web server needs one route, in the
theidm.fun site block of `sites.d/theidm.caddy`, before the SPA fallback:

```
handle_path /stations-data/* {
	root * /opt/swarm-sequencer/out/stations-data
	header Cache-Control "public, max-age=60"
	file_server
}
```

(Not applied here: no server changes in this commit. If Caddy runs in a container, that directory must be mounted.)

## Bot

Posts each station's launch and a weekly digest on @theidmfun; per-track posts only for the house stations.
Station timelines are cached per key and published as checkpoints (`updateStations`, `STATION_CHECKPOINTS=1`);
`IMD_STATION=1` still queues the IMD/ETH station's finished tracks while the hook is live.

## Monad

Chain 143 (registry `chains`, eligibility `sources.ts`): v4 PoolManager 0x188d…9ea8e, WETH 0xEE8c…1242 (thin
liquidity), WMON 0x3bd3…433a, ~0.3 s blocks. RPC: Tenderly's gateway (CORS, 1k-block eth_getLogs); rpc.monad.xyz,
rpc1 and monadinfra serve 100-block ranges (the bot's eligibility checks may use them, the station replay does not).
Most token liquidity sits in nad.fun graduated pools quoted in WMON: kind `v3` (exact Uniswap v3 Swap, fee 10000) or
`v2` (an EIP-1167 proxy with the exact Uniswap V2 Swap + Sync), so a Monad station needs `calibration.quotePerEth`
(MON per ETH). nad.fun tokens have 1e9 x 1e18 supply, so their `supplyTickOffset` is about 0. Eligibility: DexScreener
for cap/liquidity/age, GoPlus token_security for holders (keyless), no sell simulator (honeypot.is: "Invalid chain"),
so the sell goes to the owner's manual review with GoPlus's static flags in the note.
nad.fun v2 pools forward a ~1.35% protocol fee out of the pool after the swap: the decoder counts the Swap event's
amountIn, what the trader paid into the pool (the explorer's WMON transfer in), not the net the pool keeps.
Activity is thin (2026-10-21: CHOG ~180 swaps / day, emo ~170, JAMES ~110 per 1.7 days, MOLANDAK ~60 per 3.5 days),
so a Monad station plays slowly; a 1k-block log chunk is 5 minutes of chain, ~290 requests per day of history.
None of these is in the public registry.

## Phases

1. **Manual** — registry + program threading + style-pack hooks for 5 genres + pack checks + /stations tab;
   applications by form, eligibility by script, payment to an address, swarm job opened by hand. Pilot: one paid
   swarm job (0.5 IMD) for a test pack, to learn whether it lands and in how many revisions.
2. **Semi-auto** — eligibility on the form, payment contract (pay -> registered), checks in CI.
3. **Marketplace** — self-serve; the payment contract opens the swarm job through the IMD Intake on chain.
