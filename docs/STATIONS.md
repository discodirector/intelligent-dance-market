# Stations: a radio for any token

A station plays one token's pool through the $IDM rules (v2), off-chain, exactly like the IMD/ETH station
(site `?net=imd-eth`, `site/src/data/virtual.ts`, `bot/src/station.ts`). No hook, no permission: Swap logs are public.
Token owners buy a station; the IMD swarm writes its sound; theidm.fun lists every station on air.

## Flow

1. **Apply** on theidm.fun/stations: chain, token, pool (optional), contact, the vibe, genres (optional); the form
   checks eligibility, quotes and verifies the payment ("Applications and payment" below).
2. **Eligibility** (automatic, `bot/scripts/station-check.ts`), refused at once if any fails:
   market cap >= $50k, holders >= 100, pool liquidity >= $20k, token age >= 7 days, sells work (a simulated sell, or
   where no simulator serves the chain, GoPlus's automatic verdict: "Sell check" below). No manual step: a rule that
   cannot be verified refuses. The owner (theidm) keeps a veto; a station whose token rugs is switched off, no refund.
3. **Pay** in stablecoins (Ethereum, Base, Arbitrum, Monad, Robinhood): setup = a service fee + the swarm's cost in IMD at the
   rate of the order day (launch: $50 + 1.5 IMD, later $100 + 3 IMD; first month included, from the day it goes on air), then a subscription
   (launch $30/month or $75/3 months, later $50 / $125). The IMD part buys the IMD that pays the swarm. Service fees and
   subscriptions are split in three: 1/3 buys back and burns $IDM, 1/3 buys back and burns IMD, 1/3 pays for the
   infrastructure. A station that is not renewed goes off air and keeps its sound; renewing needs no new setup.
4. **Swarm**: theidm opens `job.open` (0.5 IMD) on the public repo for the station's style pack, from theidm's own
   wallet, so `job.continue` revisions (0.5 IMD each) stay available. Price includes up to two revisions.
   Tooling: `bot/scripts/swarm-style.ts` (below, "Ordering the sound").
5. **Gate**: automatic checks on the pack (below), then the owner listens. Nothing goes on air unheard.
6. **On air**: the station is added to the registry (`bot/scripts/station-add.ts`, "Onboarding" below: pending, then
   live once heard), gets its page `theidm.fun/s/<key>`, its LCD theme and a launch post.
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
(start: liquid, futuregarage, triphop, lofihouse, acid — the most table-driven; then dubtechno, electro, ambientidm, drone).

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

Dub techno and electro (opened 2026-10-22, same level). A pack names 2 or more of the opened genres (the apply
form, the API and the swarm order take the same range). Dub techno opens every table of its three bases
(Lucidflow, Ixtlan, The Moment): chords (by name, over the house m9/m11 set) and progressions, the stab figures and
accents, the sub's bassline, the bell fragments and the percussion figure; the kit (kick, clap or rim, offbeat hat
and swung shaker, percussion), the sub, the chord stab (wave, detune, filter envelope, resonance, wobble), the pad,
the bell (FM ratio, index, decay, how often), the filter sweeps (bars per open-close of the stab and the echo loop)
and the rain; its dub echo is `fx.echo` (now up to 12 taps; feedback < 0.75, feed-forward, so it can never ring).
Electro opens Cold 808 (two-bar kick figures, the bass arp, the 808 kit, the bass filter), Client_03 (chords and
progressions, kicks, ghost-snare funk, the break hats' warp and chops, the bass riffs, the computer voice's words;
the kit, the grimy bass, the ghost pad, the speak-and-spell voice) and Alien Rave (chords and progressions, kicks,
open hats, the phase bass lines, hoover stabs, arp cells, robot calls; the kit, the FM bass, the hoover, the ring-
modulated vox). `test/fixtures/dub-electro.ts` is the reference pack for both (not a station).

Ambient IDM and drone (opened after the first five, same level): ambientidm opens its harmony (`chords`,
`progressions`), the phrase material of each base (Tape Keys `figures`, Tape Haze `phrases`, Crystal `arps`), how fast
it gets busy (`tiers`), the blip/edit note pool (`notes`), and its voices: a kit per base, the tape and haze pads, the
haze bass and keyboard lead, the high line, Crystal's glass bed, bells and arp voice. The drone opens its layers
(`bars` phrase length, `voicing`, `colours`, `busy`), the Overtone Pulse series (`partials`, `figures`), the glint
pitches, the breathing pads (`wall`, `pad`: waves, detune, filter range, breathing period), Dark Low's beating sub
`bed` and concussion `kick`, the series' `overtone` levels, the glints' voice and rate, and the breath, rumble and
sub-swell levels. Counts are capped (oscillators, partials, layers, ring times) to bound CPU. The house sound of both
is unchanged (engine-trace: all 30 house styles identical). Known: the house Tape Haze (`boc`) is not deterministic in
Chromium (two renders differ, also before it was opened), so styles on that base fail the gate's determinism check.

Pack checks (`web/scripts/station-check-pack.mjs`, run by the swarm job and again here):
types compile, only the pack file changed, every style renders 3 epochs offline, loudest-3s within ±1 dB of
-14.3 dB, no clipping, no silence > 2 bars, deterministic (two renders hash equal), house FROZEN_SHA256 unchanged.
The render and the judgement are `web/src/gate.ts`, shared with the built `web/gate.html` the pipeline runs
("Automatic pipeline" below).

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
status: "live"|"paused"|"pending", paidUntil? }`.
`status` is the switch: only "live" is on air (`/stations`, bot checkpoints); "pending" (a new entry, below),
"preview" (the pipeline's: its pack is in, labelled PREVIEW on the player, not listed) and "paused" still get
`?net=<key>` on the player, so the owner can listen before going live. The rules are `stations/validate.mjs`, shared
by check-stations, the bot and the site; the pipeline adds entries at runtime ("Automatic pipeline" below). `paidUntil` (YYYY-MM-DD,
paid through that UTC day, or an ISO timestamp in UTC) is the subscription it was added with; paid renewals push it
further at runtime, and a live station past it is "expired" ("Subscription" below). No paidUntil = never expires.
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

### Onboarding

One command from a token to its registry entry, `bot/scripts/station-add.ts` (read-only without `--write`, no keys):

```
npx tsx bot/scripts/station-add.ts --chain <id> --token 0x.. [--pool 0x..|--pool-id 0x..] [--kind k] [--key slug]
    [--supply <total tokens across chains>] [--theme <preset|#hex>] [--days 7|--genesis <block>]
    [--status pending] [--paid-until <date>] [--allow-manual] [--write]
npx tsx bot/scripts/station-add.ts --set-status <key> live|paused|pending [--write]
npx tsx bot/scripts/station-add.ts --set-paid-until <key> <YYYY-MM-DD> [--write]
```

1. **Pool**: `--pool`/`--pool-id`, else the deepest pair on DexScreener against native, the chain's WETH or its wrapped
   native (WMON); the five deepest are tried in order. A 20-byte pool's kind comes from its own Swap events (the
   topic0 of its newest swap among core `SWAP_EVENTS`, up to 60 log chunks back) and its side from token0/token1; a
   v4 pool id must have Swap logs at the chain's PoolManager, its side follows from the sorted currencies (native
   first) with the quote DexScreener names. Shared with the probe in `bot/src/stations/pool.ts`.
2. **Eligibility**: the station-check report is printed; anything but PASS is refused. (`--allow-manual` still accepts
   an UNAVAILABLE whose gaps all allow manual review, for the owner's own stations; the sell is now decided
   automatically, so this is rare. Applications never use it.)
3. **Calibration**, as `station-probe --calibrate`: `supplyTickOffset` from `--supply` (a bridged token: the total
   across chains, e.g. IMD 7,091,972 with only part of it on Ethereum) or totalSupply; `quotePerEth` for a quote that
   is not ETH. No block at all for a 1e9 x 1e18 token against ETH. Checked at the newest swap: the rules' FDV against
   price x supply (ratio ~1.000).
4. **Genesis**: the block ~`--days` (default 7) back, found from the recent block rate (Monad's RPCs prune old
   blocks), so the browser's first replay stays short until the bot's checkpoints exist; the request count is printed.
5. **Key, label, ticker** from the symbol (`pepe`, `PEPE/ETH`, `PEPE`; a taken key gets the chain: `imd-ethereum`).
   **Theme**: a preset (green and cyan are the house themes, exact; blue, violet, magenta, pink, red, orange, amber,
   yellow, lime) or any `#rrggbb`, derived at the house contrasts against the LCD glass: phos 11-15:1, phosDim
   ~4.4:1, ghost ~1.22:1, glass at ~5% lightness in the seed's hue. Default: the first preset no station uses.
6. **Status** "pending", program "idm" (house styles until the pack lands). The dry run prints the entry and the
   registry diff; `--write` appends it (every other byte unchanged), runs `site/scripts/check-stations.mjs` and puts
   the old file back if it refuses. A pool another station already plays is refused. After listening at
   `?net=<key>`: `--set-status <key> live --write`, and the site build puts it on air.

Pure parts (theme contrast, slugs, entry, text edits) in `bot/src/stations/onboard.ts`, tested in
`bot/test/onboard.test.ts`. Checked 2026-10-21 (dry runs): PEPE -> v2 0xa43f…c9f (Uniswap v2, $32M), offset -129503,
FDV ratio 1.000; CHOG -> nad.fun v3 0x116e…d8f1 vs WMON, `quotePerEth` 109869, ratio 1.000 (with `--allow-manual`);
IMD `--supply 7091972` -> v4 0xb07d…bfb3 (the deepest IMD/ETH pool, not imd-eth's 0x4158…a704), offset 49490,
ratio 1.000.

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

## Applications and payment

Token owners apply and pay on `/stations`; the owner still approves, orders the sound and listens before anything goes
on air. Pieces: the API service `bot/src/api/` (node:http, no framework, no keys: chain reads only), the form
`site/src/stations-apply.ts`, the owner's tool `bot/scripts/station-apps.ts`.

**Prices** (`bot/src/api/config.ts`, `STATION_PRICE_TIER=launch|regular`): setup = $50 + 1.5 IMD (regular $100 + 3
IMD), first month included; renewal $30 / month or $75 / 3 months (regular $50 / $125). The IMD part is converted at
the order time: IMD's USD price from its deepest DexScreener pair (Ethereum, token 0xd34a…63b7, cached 5 min), cents
rounded up.

**Accepted stablecoins** (each read on chain 2026-10-22: symbol, name, decimals, supply, code):

| chain | token | address | confirmations |
|---|---|---|---|
| Ethereum | USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | 6 |
| Ethereum | USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 | 6 |
| Base | USDC (native) | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 | 30 |
| Arbitrum | USDC (native) | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 | 120 |
| Arbitrum | USDT0 ("USD₮0", Tether's OFT) | 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 | 120 |
| Monad | USDC (Circle) | 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 | 300 |
| Robinhood Chain | USDG (Paxos, "Global Dollar") | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | 900 |

All 6 decimals. Confirmations are ~1-2 minutes of each chain's blocks (Robinhood: 0.103 s per block, measured over
10k blocks on 2026-10-22, so 900 = ~90 s). Base takes USDC only (its bridged "Tether USD" 0xfde4…9bb2 is left out),
Arbitrum's bridged USDC.e is left out. Robinhood has no USDC or USDT: the only "USDC" listed there (0x11D0…991e) is a
meme token ("UpSideDownCat on robinhood", 18 decimals, 1e9 supply); USDG there is an ERC1967 proxy, ~$715M supply.

**Pay-to**: 0x12a7c4567eEF583ca6bC73F72aB980fd40F89CEA (owner-approved), set only in the deploy env (`api.env`
`STATION_PAY_TO`, documented in `bot/api.env.example`), never in code.

**API** (`/api/stations/*`, Caddy proxies to 127.0.0.1:8797):

```
GET  /config              prices, stables per chain, genres, open or not
POST /check               {chainId, token, pool?}                    -> eligibility report
POST /apply               {chainId, token, pool?, contact: {kind: x|telegram|email, value}, vibe (<= 300 chars),
                           genres?: 2..9 of liquid|futuregarage|triphop|lofihouse|acid|dubtechno|electro|ambientidm|drone, plan: "setup"} -> quote
POST /renew               {key, months: 1|3}                         -> quote for a registry station (not house)
POST /pay                 {applicationId, chainId, txHash}           -> 200 paid | 202 not mined / confirming | 4xx
GET  /application/:id     the form's poll (no contact, no vibe)
```

- **Check**: `stations/sources.ts measure` + `eligibility.ts evaluate`, the same report as `station-check.ts`; without
  a pool, the deepest ETH / WETH / wrapped-native pair on DexScreener, else the deepest pair of any quote (INFER: its
  v4 INFER/IMD pool). Cached 10 min per (chain, token, pool), a failure 1 min; concurrent asks share one run; 90 s
  timeout -> "unavailable, retry".
- **Apply**: automatic, no owner step: only PASS is quoted; FAIL or UNAVAILABLE (a rule that could not be verified)
  -> 422 "could not verify eligibility automatically: <first reason>" with the report. A token already in the
  registry on that chain -> 409 (renew it instead).
- **Sell check** (`sources.ts`, `eligibility.ts goplusSell`): honeypot.is's buy+sell simulation where it has one
  (Ethereum, Base, BNB). Where it has none (Robinhood, Arbitrum, Monad: "Invalid chain"; or "pair not found", e.g.
  INFER's v4 pool quoted in IMD; or honeypot.is failing), decided automatically: on chains with the Transfer replay
  (Robinhood) a recent holder's transfer into the pool is simulated first and a revert fails; then GoPlus
  token_security. Pass only with `is_honeypot` "0", a numeric `sell_tax` <= 10% (GoPlus gives a fraction; "" is no
  figure, not 0) and none of the blocking flags set: `is_honeypot`, `cannot_sell_all`, `hidden_owner`,
  `selfdestruct`, `owner_change_balance`, `can_take_back_ownership`, `honeypot_with_same_creator` (each lets the owner
  or the code stop or drain a holder's sell). `transfer_pausable`, `is_blacklisted`, `slippage_modifiable`,
  `is_proxy`, `is_mintable`, `trading_cooldown`, `external_call` are noted in the report, never refusing (PEPE has
  pausable + blacklist). Absent fields do not refuse. No GoPlus record, no `is_honeypot` or no `sell_tax` ->
  unmeasured: "could not verify sells automatically", refused. GoPlus serves 1, 8453, 42161, 143 and 4663 (checked
  2026-10-22).
- **Quote**: total in cents + a tag 0.00xyz (xyz = 1..999, unique among open quotes), the same amount in every
  accepted stable; valid 30 min. The payer submits the tx hash; the tag is the second key.
- **Pay** (`payments.ts checkPayment`, pure, tested on recorded receipts): receipt status success; an ERC20 Transfer
  of an accepted stable on that chain to payTo; value >= the quote (overpaying counts); refused if the value is not
  this quote's but exactly another open quote's (a swapped hash); mined no earlier than the quote (2 min clock skew)
  and no later than its expiry + 15 min; confirmations >= the chain's; the tx not used before
  (`applications/used-tx.json`). Not mined or confirming -> 202, the form retries every 15 s. Paid renewal -> the
  station's paidUntil extended (from its current end, or from now once lapsed) in `applications/subscriptions.json`
  and `stations-data/status.json` rewritten at once.
- **Limits**: JSON only, 8 KB bodies, unknown fields refused, per-IP fixed windows (all 120/min, check 12/min, apply +
  renew 6 per 10 min, pay 30/min; the IP is the last X-Forwarded-For hop, set by Caddy), CORS only for
  https://theidm.fun (the site calls same-origin anyway). Gates: no `STATION_PAY_TO` -> everything but /config and
  the status answers 503 "applications not open"; `STATIONS_OPEN` other than 1 -> no new checks, applications or
  renewals, but quotes already given can still be paid.
- **Storage** (`store.ts`): `OUT_DIR/applications/<id>.json` (24 hex), `used-tx.json`, `subscriptions.json`,
  `reminders.json`; every write a whole file renamed into place, the check-then-write steps serialised in the one API
  process.

**Owner** (`bot/scripts/station-apps.ts`, also in the image):

```
npx tsx bot/scripts/station-apps.ts list [--all]        open and paid applications
npx tsx bot/scripts/station-apps.ts show <id>           everything, contact and vibe included
npx tsx bot/scripts/station-apps.ts approve <id>        prints the station-add (pending, no paidUntil) and swarm-style
                                                        check/order/fetch commands with its genres and vibe, then
                                                        --set-status live; runs nothing
docker compose exec api npx tsx scripts/station-apps.ts list     on the VPS (OUT_DIR=/app/out)
```

The included first month starts on air: `station-add.ts --set-status <key> live` on a non-house station with no
paidUntil yet writes paidUntil = now + 1 month (and prints it); one that already has a paidUntil keeps it.

**Form** (`site/stations.html` `#apply`): behind the build flag `VITE_STATIONS_APPLY=1` (default off: the page keeps
"Applications open soon", the form code is not even in the bundle). New station: chain, token, pool, contact, vibe,
genres; the eligibility table appears on blur; GET A QUOTE shows the breakdown, the pay-to address and every amount
with copy buttons and the expiry; then the chain and the tx hash, CONFIRM PAYMENT polls until paid. RENEW: a registry
station (`/stations?renew=<key>#apply` preselects it) and 1 or 3 months.

## Subscription

`bot/src/stations/subscription.ts`. The runtime status `OUT_DIR/stations-data/status.json` =
`{ <key>: { status, paidUntil? } }`, every registry station: the registry's status, and "expired" for a live, non-house
station whose paidUntil (the later of the registry's and the paid renewals') has passed. House stations never expire;
no paidUntil anywhere never expires (none in the registry now: INFER, the pilot, has a free month to 2026-11-22).
Expired = off air: hidden from `/stations`, no more checkpoints from the bot (its cache and last checkpoint are
kept); its player page shows the state but never plays: "OFF AIR" and "RENEW ▸" on the panel, PLAY disabled, and
PLAY waits for status.json (at most 2.5 s) before any audio starts on a non-house station. Its sound and registry entry stay; a paid renewal brings it back within one bot tick (and at once in
status.json, which the API rewrites).

The scheduler writes status.json every tick (no flag needed) and once a UTC day logs the stations ending within 3 days
(or expired) and writes them to `OUT_DIR/applications/reminders.json` (`{ checkedOn, stations: [{ key, paidUntil,
daysLeft, status }] }`); posts and DMs come later. The site fetches `/stations-data/status.json` (the checkpoints'
route) on `/stations` and the player; missing, unreadable or slower than 2.5 s -> the registry alone, as before.

### Deploy (for the owner to approve; nothing here is applied)

1. **Image**: rebuild on the VPS (`docker compose build bot` in /opt/swarm-sequencer/bot). The Dockerfile now copies
   `stations/registry.json` (needed by checkpoints, status and the API; before this it was missing from the image) and
   `bot/scripts/station-apps.ts`.
2. **Env**: `/opt/swarm-sequencer/api.env` from `bot/api.env.example`, chmod 600:
   `STATION_PAY_TO=0x12a7c4567eEF583ca6bC73F72aB980fd40F89CEA`, `STATIONS_OPEN=1` (when ready), `STATION_PRICE_TIER=launch`. In the bot's `/opt/swarm-sequencer/.env`:
   `STATION_CHECKPOINTS=1`.
3. **Services**: `docker compose up -d bot` (checkpoints + status.json), then
   `docker compose --profile api up -d api` (host port 127.0.0.1:8797 only; 8787 is taken on the VPS). Check:
   `curl -s 127.0.0.1:8797/api/stations/config`.
4. **Caddy** (`/etc/caddy/sites.d/theidm.caddy`, theidm.fun site block, before the SPA fallback), then
   `caddy validate` and `systemctl reload caddy`:

   ```
   handle /api/* {
   	reverse_proxy 127.0.0.1:8797
   }
   handle_path /stations-data/* {
   	root * /opt/swarm-sequencer/out/stations-data
   	header Cache-Control "public, max-age=60"
   	file_server
   }
   ```
   (If Caddy runs in a container, mount /opt/swarm-sequencer/out/stations-data and reach the API on the host.)
   Check: `curl -s https://theidm.fun/api/stations/config`, `curl -sI https://theidm.fun/stations-data/status.json`.
5. **Site**: `VITE_STATIONS_APPLY=1 npm run build -w site`, rsync `site/dist/` to /var/www/theidm as usual. Without
   the variable the page stays "Applications open soon".

## Automatic pipeline

After a client's payment nothing waits on the owner: the station registers, the swarm writes its sound, the gate
checks it, and it goes on air after the owner listens, or by itself 24 h after the preview is ready if the owner did
nothing. The swarm is paid from a server hot wallet; IMD top-ups stay manual (a low-balance warning); every event and
the owner's commands are on Telegram.

**Runtime stations** (the registry and the packs are baked into the image and the site bundle; a pipeline station
needs no rebuild). Under the directory Caddy already serves as `/stations-data` (`OUT_DIR/stations-data`):

```
stations.json        { version: 1, stations: [entry, ...] }   registry entries (same schema), written by the worker
packs/<key>.json     a gated style pack as JSON
```

- **Merge** (`stations/validate.mjs mergeRegistry`, the rules of check-stations): runtime entries after the baked ones;
  one is dropped (with its reasons) when it breaks a rule, reuses a baked key or pool (baked wins), is a house or hook
  station, or names a program with no pack. Bot: `bot/src/stations/runtime.ts loadMergedRegistry` (scheduler:
  checkpoints, status.json, expiry; API: renewals, duplicate check; worker). Site: `site/src/runtime.ts`, awaited by
  `stations.ts` before the networks are built (2.5 s at most, else the baked registry alone).
- **Packs as data, never code**: the delivered `packages/synth/src/stations/<key>.ts` is read by synth
  `parsePackSource` (`packages/synth/src/packLiteral.ts`), a parser for one object literal: comments, one
  `import type`, `export default { ... }` with `satisfies X` / `as const`; strings, numbers, booleans, null, arrays,
  objects. Refused: functions, arrows, calls, other imports, template expressions, computed keys, spreads,
  references, `new`, regexes, operators, `__proto__`. Never `import`ed, never `eval`ed. `validatePack` before
  publishing, again on every load (synth `registerPack`), then `programFromPack`; `programFor(key)` finds baked and
  registered packs (baked wins).
- **Status "preview"**: between pending and live; plays at `/?net=<key>` labelled PREVIEW, not on `/stations`.

**Worker** (`bot/src/stations/worker.ts`, compose service `stations`, profile `stations`, env `../stations.env`): every
minute, each paid setup application through the state machine (`bot/src/stations/pipeline.ts`), persisted in
`OUT_DIR/applications/<id>.pipeline.json` (the API owns `<id>.json`; the worker never rewrites it):

| stage | what happens | next |
|---|---|---|
| paid | runtime entry from `register.ts` (station-add's pool / calibration / genesis / key / theme; genesis 7 days back, 1 on Monad), status pending, program idm; idempotent (same chain + token found again) | registered |
| registered | free `/requests/check`; IMD >= 0.5 (else wait, told once); `job.open` paid from SWARM_KEY (paid.ts unattended); waits for the admission | ordered |
| ordered | polls the job | delivered (a commit) / attention (ended without one) |
| delivered | the gate (below) | preview / revising (first failure) / attention (second) |
| revising | ONE `job.continue` on the project's head with the gate's failing lines as notes, paid the same way | ordered |
| preview | pack published, entry `program: <key>`, `status: preview`; Telegram: link, genres, style names | live after 24 h unless `/hold`, or at `/live` |
| live | `status: live`, paidUntil = now + 1 month (as station-add --set-status live) | — |
| attention / rejected | stopped; nothing more is paid; the owner decides | — |

- **Never pays twice**: a pay step keeps paid.ts's PaidState (request token, requestKey, orderId: saved before the
  quote and when the order exists) and a `submitting` marker saved right before the payment is submitted. A restart
  resumes the same order; an order past "quoted" is never paid again (paid.ts); an order marked submitting that the
  API still shows "quoted" is never submitted again (after 30 min: attention). A failed order after a submit goes
  to attention, never to a new payment. Ten errors in a row at one stage: attention.
- **Permit2**: a short allowance stops the order and the owner is told once (the exact approve call); it resumes by
  itself after the approve. `SWARM_AUTO_APPROVE=1` lets the worker send an approve of `SWARM_APPROVE_IMD` when the
  wallet holds at least `SWARM_MIN_ETH`.
- **The gate in the container** (`bot/src/stations/gate.ts`; no git, TypeScript or Vite in the image): only the pack
  changed (GitHub compare API, the job's base ... delivered commit); the raw file at the delivered commit parsed as
  data, its key the station's; validatePack; then `web/gate.html` (built into web/dist with the tape windows baked in)
  in the image's Chromium headless shell renders 3 epochs per style and judges them with the same `web/src/gate.ts`
  as the checkout. The checkout's tsc and house-history tests are not rerun: a runtime pack is data and changes no
  code. Checked 2026-10-22: the built page gives INFER's numbers exactly (-14.85 / -14.31 / -14.34 / -14.33, PASS),
  ~60 s for 4 styles.

**Telegram** (`bot/src/stations/telegram.ts`): plain-text notifications (no markup; control characters stripped; 3.5k
chars at most; never a secret: the bot token is only in the request URL, never in logs or errors) for every
transition, errors, low IMD (< 2 IMD once a day), subscriptions ending within 3 days (the scheduler's
reminders.json), paid renewals. Commands by long polling, accepted ONLY from `TELEGRAM_CHAT_ID` (other chats are
ignored, never answered): `/status`, `/balance` (IMD, ETH, Permit2 allowance), `/live <key>` (a preview), `/hold <key>`
(no automatic go-live), `/reject <key>` (marked failed, station paused; the refund stays manual: the message gives the
amount, the payer, the tx and the client's contact).

`bot/scripts/station-apps.ts list|show` shows each application's pipeline stage, waits and errors; `approve` stays as
the manual fallback.

### What the owner provides

1. **Telegram**: a bot from @BotFather (`/newbot` -> the token), then send it any message and read the chat id from
   `https://api.telegram.org/bot<token>/getUpdates` (`message.chat.id`; a group's id starts with -100).
2. **Hot wallet**: a NEW Ethereum wallet used only for this (`cast wallet new` or any wallet), its private key in
   `stations.env` only. Fund it on Ethereum with IMD (0.5 per job, up to two per station: a few IMD) and a little ETH
   (~0.002) for the one-time Permit2 approve: `approve(0x000000000022D473030F116dDEE9F6B43aC78BA3, <amount>)` on IMD
   0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7, from the hot wallet (e.g. 5 IMD = 5e18), or set
   `SWARM_AUTO_APPROVE=1`. The swarm projects belong to this wallet (only it can continue them).
3. **The public repository's `main`** must carry what the jobs read and run (see "Ordering the sound").

### Deploy (for the owner to approve; nothing here is applied)

1. rsync as before (now with `./stations`, which holds `validate.mjs`), `docker compose build bot` (the web stage
   builds `gate.html`; the bot stage copies `stations/validate.mjs`).
2. `/opt/swarm-sequencer/stations.env` from `bot/stations.env.example`, chmod 600: `SWARM_KEY`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`, thresholds.
3. `docker compose up -d bot api` (recreated on the new image), then `docker compose --profile stations up -d
   stations`; `docker logs -f swarm-sequencer-stations` shows "starting; hot wallet 0x…" and Telegram gets "stations
   worker started". `/balance` in the chat checks the wallet.
4. Caddy needs nothing new: `/stations-data/*` already serves `stations.json` and `packs/`.

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
so GoPlus decides the sell automatically ("Sell check" above).
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
