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
   (launch $30/month or $75/3 months, later $50 / $125), or Station+ ($90 / $225, later $150 / $375; "Station+"
   below). The IMD part buys the IMD that pays the swarm. Service fees and
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

Dub techno and electro (opened 2026-10-22, same level). A pack names 1 or more of the opened genres (the apply
form, the API and the swarm order take the same range; one genre plays every epoch, its styles in turn). Dub techno opens every table of its three bases
(Lucidflow, Ixtlan, The Moment): chords (by name, over the house m9/m11 set) and progressions, the stab figures and
accents, the sub's bassline, the bell fragments and the percussion figure; the kit (kick, clap or rim, offbeat hat
and swung shaker, percussion), the sub, the chord stab (wave, detune, filter envelope, resonance, wobble), the pad,
the bell (FM ratio, index, decay, how often), the filter sweeps (bars per open-close of the stab and the echo loop)
and the rain; its dub echo is `fx.echo` (now up to 12 taps; feedback < 0.75, feed-forward, so it can never ring).
The `rumble` (2026-10-25) is the techno rumble: the kick bus into its own dark room (lowpass `lp`, feed-forward taps
over `decay`), ducked by every kick (`duck`) so it pumps; off unless `level` > 0, so every house style and every
earlier pack schedules exactly what it did (engine-trace vs 25a20f1: 180/180 identical).
`stabBars` (2026-10-26) is the stab's bar mask: the figure's level per bar of a 1..16-bar cycle, 0 resting it, so a
style can play one stab a phrase and let the echo carry the space; left out, every bar plays at 1 (engine-trace vs
67beb11: 180/180 identical). A pack may now hold up to 6 styles per genre (was 4).
Dub techno voice upgrades (2026-10-26), every one off unless a style sets it: a second stab oscillator per chord tone
(`stabTone.wave2` a wave or a pulse of `width`, `mix2`, `octave2`: saw + pulse, a hollow square over a sine, glass two
octaves up), velocity to cutoff (`stabTone.velLp`: soft figure hits darker), a pad highpass (`padTone.hp`), the echo's
breath (`sweep.send` / `sweep.fb` dip the level into the echo and its repeats over `sweep.breath` bars, never above
`fx.echo`), the echo's shape (`echoTone`: stereo `width`, a ping-pong second time `alt`, a tape `wobble` from one slow
oscillator on the repeats' delay times, bit-exact offline), and a sparse atmospheric `melody` (rare single notes from a
pool or the chord, in cells of bars, long attack and release into the echo and the room; a whale buy answers).
engine-trace vs e44c7be: 180/180 identical; the baked packs schedule exactly as before.
Groove placement (2026-10-26): `claps` (the clap's or rim's two-bar figure, in place of 2 and 4) and `hats` (the hat's
two-bar figure with an optional decay per hit, a long one an open hat, in place of every offbeat); left out, the house
placement (engine-trace vs 0fd919a: 212/212 identical, house styles and the infer and credits-dubhouse packs). A pack
may now hold up to 10 styles per genre (was 6, then 8; the swarm's style job still writes 1..4).
Two new stab voices (2026-10-26), `stabTone.engine` (default `"osc"`, the detuned oscillator pair, every house style
and earlier pack unchanged: engine-trace vs adfc10a 244/244 identical): `"fm"` a two-operator FM voice per chord tone
(`stabTone.fm`: a sine modulator at `ratio` into two detuned sine carriers, its `index` falling to `floor` x index in
`decay` s, an optional second modulator `ratio2` / `index2` / `decay2` for a clang on the attack, `vel` the hit's level
to the index) and `"pluck"` a struck resonator bank per chord tone (`stabTone.pluck`: a half-sine mallet click `burst`
s wide through a lowpass at `tone` Hz strikes one bandpass resonator per `modes` ratio, each ringing `decay` x
(1 / ratio)^`damp` s; `vel` opens the mallet). Both run under the stab's highpass, lowpass envelope, sweep, velocity
cutoff, `mix2` layer, sends, whale throws and the attention-layer ornament; both bit-exact offline. Per stab of a
three-tone chord: the pair 24 nodes, FM 39 (with the second modulator), the pluck 36 (one buffer source, 9 resonators).
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
status: "live"|"paused"|"pending", paidUntil?, plusUntil? }` (plusUntil: Station+, same format as paidUntil).
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

### NFT stations

`kind: "nft"` plays an ERC-721 collection's sales instead of a pool (first: `credits`, Credits by Jack Butcher, Ethereum
0x9763…3043, a gift). On-chain data only (`packages/core/src/nft.ts`, shared by site `data/virtual.ts` and bot
`station.ts`): `token` is the collection, `quote` native 0x0, and

```
"nft": { "itemSupply": 77114, "refPrice": "0.01", "seaport": ["0x…68F1…B395"], "strategy": "0x8e60…53d6",
         "core": "0xcdb1…e0dD", "statements": "0x75Ed…069b", "balance": "0x3620…eA07", "ratings": "credits",
         "statementsFrom": 26100993, "balancePool": { "poolManager": "0x0000…8A90", "poolId": "0xd262…9a03" } }
```

- **One input per item sold.** Every collection Transfer (not a mint or a burn) is matched to a venue event of the same
  tx naming that token id: Seaport `OrderFulfilled` with the item in `offer` = a listing taken, BUY at the ETH/WETH
  consideration / items; in `consideration` = a bid or collection offer hit, SELL at the WETH offer / items (venue
  "OpenSea" when OpenSea's fee recipient is paid). CreditStrategy `NFTBoughtByProtocol` = someone sold to the protocol,
  SELL at purchasePrice; `NFTSoldByProtocol` = someone bought its relisting, BUY. Core `CreditBought` = SELL at cost,
  `CreditSold` / `ListingBought` = BUY. A Transfer two venues claim is one sale (ecosystem over bid over listing). An
  item that changes hands twice in a tx is ONE input, the first hop: the item leaving its holder (a router buying a
  floor listing and selling it to the strategy = the OpenSea BUY at the listing price; the strategy's relisting bought
  and sold on to Core = the strategy BUY). Unclaimed Transfers (gifts, NFTX, wallet moves) are not sales. Order: block,
  log index, token id.
- **Compose** (Statements `Composed`, 80 Credits burned into a page): one BUY of 80 x the last item price in the stream
  (`refPrice` before any sale), never under the whale line, so every compose drops.
- **Sound** (owner-approved 2026-10-25), all from the stream: the **tick** is the median of the last 127 item prices
  (`NFT_WINDOW`), tick = floor(log_1.0001(1e27 / (median x itemSupply))), so the whale reads the market cap and a bid/ask
  flip no longer jumps the bass (bass changes on 8% of notes over 2 days, was 37%). The **size** (quoteAmt) is 0.0125 ETH x
  (price / median before it)^8 under half the whale line, and the rules' size EMA is held (core `holdSizeEma`): under
  0.957x the median is a hat, over 1.055x a snare, over 1.145x a kick. The **tempo** moves once per block of sales (core
  `holdTempo` on every later item of the block), so a 50-item sweep is one beat of tempo (BPM p50 106, was 117). Both
  flags are set by nothing but this decoder; without them `mutate` is the hook's rules (every pool, every vector). The
  feed shows the price (`nft.price` in the tag), not the size.
- **Carry**: the last price and the median's window, in the bot's cache and the checkpoint (`nft: { lastPrice, recent
  }`); the site refuses an nft checkpoint without it. A single item is a whale only far above the market. `itemSupply`
  is fixed at registration (77,114 live Credits on 2026-10-25), frozen like a calibration; the fingerprint covers the
  collection, supply, refPrice and every venue.
- **Reads** (`readNftLogs`): Transfers and the ecosystem events over the range (2 requests per chunk), then Seaport only
  at the sale blocks (neighbours within 2 blocks merged, at most 16 per range), since OrderFulfilled cannot be filtered
  by collection. Two days of Credits from genesis: ~410 Seaport ranges, ~6 MB, ~50 s in a browser (JSON-RPC batches of
  5); a live poll: 2-3 requests. The bot's checkpoint makes the first replay short.
- **Player**: feed lines "BUY Credit #1234 · 0.0092 ETH · OpenSea", "COMPOSE · 80 Credits → page #563"; the NFT screen
  (`site/src/nftscreen.ts`) shows the item's on-chain SVG (tokenURI -> data:image/svg+xml only, as an `<img>`, cached,
  2 fetches at a time) on the next beat; with no new sale the last one stays on the glass. Optional skin in the theme (`panel`,
  `sell`, `whale`), player page only.

#### Credit rating and plates (`nft.ratings`, owner-approved 2026-10-26)

A Credit's score (CreditScore, 80-800, the one jack.art/credits/rating shows) is not in tokenURI and is a pure function
of its seed and payment second, so it is precomputed once for the sealed edition: `packages/core/data/credit-scores.bin.gz`
(format CRS2, `core/src/credittable.ts`; 122,154 Credits, 366 KB raw, 231 KB gzipped). Built by
`npx tsx packages/core/scripts/build-credit-scores.ts` from every `Credits.Distributed(tokenId, to, seed, paidAt)` log
(read-only getLogs, ranges halved when the gateway refuses 20k+ results) through a TS port of CreditScore
(`scripts/credit-score.ts`), checked before writing against eth_call `scoreOf(seed, paidAt)` on the contract
(0x817a…b7b7) and `seedOf` / `timestampOf` for 24+ random Credits and Credit #1 (1,324,012). Per Credit: the CMYK
plates (`paidAt % 15 + 1`, bit0 C … bit3 K) and the score in tenths; the percentile (0..255, Credits scoring strictly
lower / edition) is ranked when the table is read.

- **Tags only.** With the table (`decodeNftLogs(…, { ratings })`) every Credit sale's tag carries `score` (percentile),
  `mask` (plates) and `rating` (tenths). The rules input is the same with or without it: state, tracks and checkpoints
  do not depend on the table, and a station without `ratings` (or a failed load) plays exactly as before.
- **Loading**: the bot reads the file once (`station.ts ratingsFor`, the image copies `packages/core/data`); the site
  imports it as a hashed asset URL (`site/src/data/ratings.ts`), fetched only by a station that names it, before its
  first read, and gunzipped with DecompressionStream. The main bundle does not grow.
- **Sound** (dub techno only; `engine.ts creditSale`): a rated sale is a plate stab on the bar's chord, landing on the
  next 8th (`clock.ts CueQueue`, at most 4 waiting: a sweep is a short run). Percentile -> level and cutoff (and a
  longer release); plates -> voice: as many chord tones as plates, from the top of the voicing; C pans left, M right, Y
  lifts it an octave, K adds a soft sub on the chord root. The top ~5% (pct >= 243) go into the echo and also sing one
  note of the sparse melody (the style's, or a fixed triangle voice). The price-based size (the rules' tiers) is as
  before.
- **NFT screen**: a rated sale wears "RATING 132 · CK" on the glass; the feed line ends "· RATING 132 · CK".

#### BALANCE withdraws (`nft.balance`)

BALANCE (the Statements' ERC-20, 0x3620…eA07) pays a Statement's holder its credit score in tokens when the page is
locked (`withdraw`): `Withdrawn(statementId, holder, amount)`, amount = score x 1e14, i.e. **points = amount / 1e18**
(whole tokens = the page's score in points; median ~40k, 13.5k..190k over the first 73). In the same tx, before it,
`InkMoved(BALANCE, holder, ink[4])` is the release's CMYK split (every other BALANCE transfer moves ink too, ~12k a
day, so the read names BALANCE as the sender: one more request per range, `nftInkFilter`).

- **Input**: one SELL of the usual size (`NFT_SIZE_REF`, never a whale) at the current median's tick, the price window
  untouched; tag `{ via: "withdraw", venue: "BALANCE", id: statementId, points, ink: [c, m, y, k] (whole percent,
  floor), holder, price: "0" }`. Core locking a page emits its own `StatementRedeemed` beside BALANCE's `Withdrawn`:
  only `Withdrawn` is read, so it is one input. `WithdrawnOverprinted` (bookkeeping) is not an input. Ordered by the
  Withdrawn's log index with the sales. The fingerprint names `balance` (a source with withdraws is another stream);
  the carry is unchanged, so old checkpoints and caches read as before.
- **Sound** (`engine.ts creditLock`, on the next downbeat): the torn tag. Two short band-passed rips into the echo, a
  sub falling an octave to the floor, a low rumble swelling over a bar or two, and the bar's whole chord thrown long
  into the echo only. Depth and length scale with points against 40k (x0.4 .. x2); the ink tints the throw: yellow
  opens its filter, black closes it, cyan pulls it left, magenta right. Distinct from the whale (a compose).
- **NFT screen**: two beats: the locked page (Statements tokenURI, now in its WITHDRAWN format; label "WITHDRAWN",
  caption "LOCK PAGE #144 · 29,958 BALANCE"), then the holder's Balance artwork (BALANCE `artwork()` ->
  LineageArtwork `tokenIdOf(holder)` -> tokenURI: the wallet's CMYK mixture; caption the release's "C24 M23 Y24 K27").
  Same art rules (data SVG only, as an `<img>`, cached, 2 fetches at a time). Feed: "LOCK · page #144 → 29,958 BALANCE
  · C24 M23 Y24 K27".
- Cues reach every scheduler the same way (`TimelinePoint.sale / lock`, `LivePlayer.noteSale / noteLock`, the bot
  render page); no other station emits them, so the house (FROZEN_SHA256) and every pack schedule exactly as before
  (`engine-trace.ts --packs infer,credits-dubhouse,credits` IDENTICAL; `--cues` shows what they add).

#### Statement sales, overprints, BALANCE swaps (`nft.statementsFrom`, `nft.balancePool`)

```
"statementsFrom": 26100993,
"balancePool": { "poolManager": "0x0000…4444…8A90", "poolId": "0xd262…9a03" }
```

- **Statement sales** (a page changing hands): the Statements' Transfers are read with the Credits' (one request, both
  addresses) and matched like a Credit's: Seaport `OrderFulfilled` with a page in it (`statement-listing` BUY /
  `statement-bid` SELL, `seaportClaims` takes the set of collections; an order with tracked items on both sides is a
  swap: none) or Core `StatementSoldTo(sid, buyer, price, …)` (`core-statement`, Core selling a page it holds, BUY).
  Not sales: a page sent to Core or to BALANCE (a lock: BALANCE's `Withdrawn` tells it), a mint or burn, a move no venue
  prices (a gift, OpenSea's TransferHelper). Tag `kind: "statement"`, `rel` and, from the page history, `overprints`
  and `points`. **Size**: (price / 80) against the Credits median, the item formula, but never under a kick
  (`NFT_PAGE_FLOOR` = 3 x 0.0125 ETH, over the 2^(25/16) kick tier) and never a whale (capped under half the whale line):
  a page is 80 Credits that already traded, the harmony moves on a compose, not on a resale. Measured against the
  Credits rather than its own median because pages trade a few times a week (1 sale in the first 2.4 days): their own
  median would take weeks to mean anything, while 80 x the Credits median is a fair price from the first sale. The
  page price also enters its own window (`NFT_PAGE_WINDOW` 31, carry `pages`, written only once a page has sold, so
  old JSON reads and writes as before): `rel` = price / that window's median in percent (80 x the Credits median while
  it is empty), what the sound reads. The Credits' window and last price are untouched.
- **Overprints** (`Statements.Overprinted(baseId, topId, by)`, read with the ecosystem events): one BUY of the usual size
  (like a withdraw), tag `{ via: "overprint", id: base, top, overprints, points }`. BALANCE's `overprintWithdrawn` emits
  its own `WithdrawnOverprinted` beside it: not read, one input.
- **Points and counts, deterministic**: `creditScoreOf` / `overprintsOf` change with every overprint, so the decoder
  never calls them. `readNftPageLogs` reads, for every page that may have sold in the batch (moved in a tx with a
  Seaport fill or a Core event) and both pages of every overprint, the page's `Composed` (its 80 Credit ids) and the
  `Overprinted` events onto it, from `statementsFrom` (the first compose) to the batch's end, one request per round
  (topic1 = the ids), then the same for the pages those overprints burned until none is new. The count at a point of
  the chain is the contract's rule (base += 1 + the top's own) over the events before it; the points are the rating
  table's scores of every Credit in those pages (truncated tenths summed: up to ~1 point under per 10 Credits; #211:
  14,949 vs creditScoreOf 14,952.9; #123: 7 overprints, 264,3xx vs 264,387.8). Tags only, like the rating: inputs,
  state and checkpoints are the same with or without them. 32 overprints happened before the station's genesis (none
  in its first 2.4 days), which is why the history is read from the Statements' start, not counted in the carry.
- **BALANCE swaps** (`balancePool`, the official BALANCE/ETH pool: Initialize at block 26241566 names native ETH and
  BALANCE, fee 3000, tick spacing 30, hook 0x2eef…a000; clone pools are other ids): the PoolManager's `Swap` with topic1
  = poolId, and the `InkMoved` out of the PoolManager (a buy: same request as the withdraw releases, topic1 = [BALANCE,
  PoolManager]) and into it (a sell: one more request, topic2 = PoolManager). `decodeNftLogs` returns them apart as
  `ornaments` (block, log index order; amount, ETH, the ink of the tx's InkMoved nearest the Swap, `plate`): **never
  rules inputs**, never in the carry, the bot cache or the checkpoint. The plate is the ink's leading plate only when
  it leads the next by 2 points (`NFT_INK_LEAD`): BALANCE's ink mixes as it trades, and 99% of the pool's swaps over
  the first 2.4 days moved ink within a point of [24, 24, 25, 26] (an argmax would say K every time); a mixed ink has
  no plate. The bot never reads the pool (`readNftLogs(…, { ornaments: false })`): ornaments are the site's.
- **Sound** (dub techno only, `clock.ts CueQueue`, `engine.ts`): a **page sale** (`creditPage`, next beat) is the
  bar's whole chord with its bottom tone doubled an octave down, one stab bigger and longer than a plate stab (level
  0.8..1.3 of the stab gain, about twice a plate stab, release ~3x the stab's plus a quarter bar or more), half of it into the echo, a soft sub
  on the root; `rel` opens it (level, cutoff, tail: 50% of the median shut, 200% wide open). An **overprint**
  (`creditOverprint`, next beat): a double strike, the chord twice a 16th apart (a little left, then right: the
  misregistered second pass), the second thrown long into the echo; from the 7th overprint (`INVERTED_AT`, black
  paper) both strikes drop an octave, the lowpass closes to 0.45x the stab's and a sub holds the root. A **swap**
  (`creditInk`): a quiet ornament, one chord tone (a buy the top, a sell the bottom) an octave over the stabs, a short
  sine ping into the echo bus; plate C pans left, M right, Y lifts it an octave (a triangle), K drops it two octaves;
  the ETH it moved (`inkSize`, < 0.02 · < 0.1 · < 0.5 · more) nudges the level. Cap: ornaments land only on the
  off-16ths (never where a sale's 8th or a beat cue lands), at most one an 8th; at most 8 wait (a bar's worth: a
  burst drops its oldest) and one waiting over a bar is let go (`CueQueue.dropped`, `planSteps(…, inks, stats)`).
- **Feed and screen**: "SELL page #211 · 0.5020 ETH · OpenSea · 14,949 PTS"; "OVERPRINT · page #117 → #123 · 7
  OVERPRINTS · 264,3xx PTS"; a swap is one muted LAST SWAP line ("12:04 BALANCE BUY 1,234 · C", the plate only when
  there is one), never a log line, never a step, never the NFT screen. The NFT screen shows a sold page's art
  (Statements tokenURI, utf8 JSON) with "PAGE #211 · 14,949", an overprint the base page after it with "OVERPRINT
  #123 ← #117" (read afresh: the overprint changed the art).
- **Fingerprint**: a source with the Statements adds `"pages"` (page sales and overprints are inputs: another stream
  than before them); `statementsFrom` and `balancePool` only tag and ornament and are not in it.
- **Load** (the station's first 2.4 days, genesis 26255150 -> 26272292: 1,855 Credit sales, 1 Statement sale, 2
  withdraws, 0 overprints, 9,073 pool swaps): the bot's replay is 549 getLogs (the one page lookup included) + 1
  blockNumber, ~61 s, the pool never read; the site's full replay with ornaments is 860 getLogs in 173 HTTP batches,
  ~100 s, the extra ~310 being the pool's launch day (8,556 swaps that day, mostly 20-a-block micro buys of ~5e-6 ETH:
  ranges halved under Tenderly's 20k results and viem's 10 MB response limit, which the site's getLogs now also
  halves on). A live poll with a checkpoint: 2 more requests a poll. The cap over the window (every swap pushed at its
  block, a 124 BPM 16th): 8,645 ornaments played, 428 dropped, 427 of them on the launch day, 1 since.
- **"how" section** (`site/src/how.ts`): an nft station replaces the house text of `#how` (the pitch and the
  `cat spec/…` table) with its own: Credits a dedicated text and table, any other collection a generic one. The house
  page is untouched.

### Gift stations

`"gift": true`: on air without a subscription. No paidUntil (the rules refuse one), never "expired", never Station+,
no reminders, `/renew` and `/upgrade` refuse it, and `station-add.ts --set-status <key> live` adds no first month. Baked
only (the runtime registry drops a gift). `credits` is one, pending until the owner turns it live.
Its pack is `credits.ts`, "Credits Techno": dark dub techno in ten styles (Void, Watermark, Null, Signature,
Provenance, Escrow, Clearing, Redacted, Foil, Letterpress; one cold chord held 16..32 bars, a half-step or b6 the only movement, straight
groove, a solid techno kick over Void's sub tone, a rare resonant stab (`stabBars`) into a narrow echo, the kick rumble
under the kick). Signature (a saw + pulse stab with velocity to cutoff, a breathing echo), Clearing (a wide quarter /
dotted-eighth ping-pong echo with a tape wobble) and Provenance (a sparse melody over a minimal groove) came from the
"Credits Lab" pack, now folded in. Every style has its own groove (sub rhythm, hats, rim, percussion): Void the held
offbeat sub on 2 / 10, Watermark a 16th roll with a rim and a shaker on each beat's last 16th, Null one long sub note a
bar under two hats a bar, Signature driving offbeat 8ths with an open hat closing every second bar and a low rim,
Provenance long offbeat notes over a soft straight 16th shaker, Escrow a syncopated sub with ghost 16ths and a perc on
7 / 15, Clearing a dotted (3/16) sub and a perc against the dotted-eighth echo with the rim on the 4 only, Redacted a
16th roll accented 3+3+2. The first two styles, Debit and Margin (busier stab loops), are in the commit history. The
first pack, "Credits Dub House" (Ledger, Statement, Composed, Overprint), came out warm and sunny; it is kept baked as
`credits-dubhouse.ts`, on no station. Foil and Letterpress came from a second "Credits Lab" round (now folded in too) on the new stab voices in
the Void world, each with its own groove: Foil (126, the FM stab with a 7:1 ping on the attack, the sub held from
the "a" of 1 and 3, closed hat pairs on the offbeats, a rim on the 4 and the "a" of 3, a dotted-eighth echo) and
Letterpress (123, the struck resonator on a marimba's two whole modes 1 and 4, a quartal sus for its turn, a
syncopated sub, a wooden perc on the "e" of 2 and 4, a wide dotted-quarter echo). Retuned 2026-10-26 after the owner
heard both off the key: the stabs' fundamentals were exact (within 5 cents of the chord), but Foil's turn was the
minor triad a half step up over the sub's root (Bb minor over A: 41% of the stab's partial power off the key's scale,
now the b6 move, 0.1%), its 3.5:1 clang put partials at x4.55 / x5.45 (a quarter tone off) that the echo's highpass
lifted to -8 dB under the second harmonic (now a whole 7:1 ping, -17 dB, carrier detune 6 -> 3 cents), and
Letterpress's 9.83 marimba mode rang +52..56 cents off the scale at -5 dB in the echo of a low chord (now modes 1, 4
and the highpass 180 -> 110 Hz so the fundamental carries the pitch). Whole ratios keep every partial on the tone's
harmonic series.

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

`/stations`: a list of stations on air (ours first, then Station+, then the rest in registry order): mini LCD in the
station's colours, ticker, chain, genre · style now, track #, swaps; one plays at a time. `/s/<key>` = the player on that station. Long histories replay from a
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
IMD), first month included; renewal $30 / month or $75 / 3 months (regular $50 / $125). Station+ $90 / month or $225 /
3 months (regular $150 / $375); a setup as Station+ adds $60 (regular $100) for its first month; an upgrade is
prorated ("Station+" below). The IMD part is converted at
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
GET  /config              prices, stables per chain, genres, open or not, plus: {slots, used, left, prorateDays}
POST /check               {chainId, token, pool?}                    -> eligibility report
POST /apply               {chainId, token, pool?, contact: {kind: x|telegram|email, value}, vibe (<= 300 chars),
                           genres?: 2..9 of liquid|futuregarage|triphop|lofihouse|acid|dubtechno|electro|ambientidm|drone, plan: "setup",
                           plus?: true}                              -> quote
POST /renew               {key, months: 1|3, plus?: true}            -> quote for a registry station (not house)
POST /upgrade             {key}                                      -> quote: Station+ for the days already paid
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
genres, plan (Station or Station+, with the slots left; Station+ disabled when full); the eligibility table appears on
blur; GET A QUOTE shows the breakdown, the pay-to address and every amount
with copy buttons and the expiry; then the chain and the tx hash, CONFIRM PAYMENT polls until paid. RENEW · STATION+:
a registry station (`/stations?renew=<key>#apply` preselects it), Station or Station+, and 1 or 3 months, or (Station+
on a live station with paid days left) "upgrade only".

## Subscription

`bot/src/stations/subscription.ts`. The runtime status `OUT_DIR/stations-data/status.json` =
`{ <key>: { status, paidUntil?, plus?: true, plusUntil? } }` (plus: "Station+" below), every registry station: the
registry's status, and "expired" for a live, non-house
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

## Station+

Everything in Station, plus (owner-approved 2026-10-22):

1. **The 24/7 YouTube radio**: a place in the stream's rotation (`sim/stream/live`, "Rotation" below).
2. **4 posts a month on @theidmfun**, one a week: the station's finished track (its release) if a drop happened that
   week, otherwise a "now playing" clip of the station ("Weekly posts" below). The client's ticker is the post's only
   cashtag; the client's X handle is tagged when the application gave one.
3. **Listed above the plain stations** on `/stations` (the house stations stay on top) and marked STATION+ on its card.

**Prices** (stablecoins, the same stables and the same three-way split as Station; `PRICES` in `bot/src/api/config.ts`):

| | launch | regular |
|---|---|---|
| Station+ month | $90 | $150 |
| Station+ 3 months | $225 | $375 |
| new station as Station+ | setup + $60 (its first month) | setup + $100 |
| upgrade | $2 a day already paid | $3.33 a day |

Station stays $30 / $75 (regular $50 / $125); the setup is unchanged ($50 + 1.5 IMD, regular $100 + 3 IMD) with the
first month included: a new application may take that month as Station+ for the month's difference on top.

**Upgrade** (`POST /upgrade`, a live station on Station): Station+ for the rest of the paid period, ending with the
paidUntil. Prorated:

```
days    = ceil((paidEnd - max(now, plusEnd) - 1 h) / 24 h)        (0 or less: nothing to upgrade)
price   = (plusMonthUsd - monthUsd) x days / 30, cents rounded up  (launch $60 / 30 = $2 a day)
```

`paidEnd`/`plusEnd` are the effective ends (registry or paid renewals, the later); the first hour is free so a quote
paid minutes later never charges a sliver of a day. Refused: a station off air or not live ("renew it as Station+"),
a station with no paid end ahead or already Station+ to its end (`code: "nothing-to-upgrade"`), a house station.
**Renewals**: a Station+ station renews at Station+ prices (`/renew` with `plus: true`); Station+ then runs to the new
paid end, so the days of the current period not on Station+ yet are added at the upgrade's rate in the same quote
(`usd.upgrade`). It may renew as plain Station: its Station+ ends where it was paid to, and it leaves the rotation and
the posts then. A lapsed station renewing as Station+ restarts from today with nothing to prorate.

**Slots**: at most `STATION_PLUS_SLOTS` (default 6; `api.env`, and the same value in `stations.env` for the worker's
count) at a time. Taken = live Station+ stations + paid Station+ setups the pipeline has not put on air yet (a rejected
one frees its slot) + open, unexpired quotes that would add one (a Station+ setup; a Station+ renewal or upgrade of a
station not on Station+ now, one per station). The check runs under the store's lock with the quote's creation, so two
quotes never take the last slot. Full: 409 `{ error: "Station+ is full (6 of 6 taken): a plain Station is still
available", code: "plus-full", plus: { slots, used, left } }` for any new Station+; plain Station is still sold; a
station already on Station+ keeps renewing. No waitlist. An open quote holds its slot for its 30 min (+15 min grace).

**Data**: `plusUntil` (YYYY-MM-DD or ISO timestamp, UTC, as paidUntil) in the registry entry (the pipeline writes it
when a Station+ setup goes live: plusUntil = paidUntil, the included month; the owner may set it on a baked station)
and in `applications/subscriptions.json` (`{ paidUntil?, plusUntil?, renewals: [{ ..., plan?: "plus" | "upgrade" }] }`,
written by paid Station+ renewals and upgrades); the later counts. Applications: `plus: true` (setup, renew),
`kind: "upgrade"` with `upgradeTo` (the paid end it was quoted for), and after payment `plusUntil`. `status.json` has
`plus: true` and `plusUntil` only while a live, unexpired, non-house station is inside it: a lapsed Station+ falls back
to a plain station (or off air) with no other change. The API rewrites status.json at once after a paid Station+
renewal or upgrade.

**Quote shape** (`publicApp`): `{ kind: "setup" | "renew" | "upgrade", plus?: true, upgradeTo?, plusUntil?, quote:
{ usd: { feeUsd, imd?, plusUsd?, upgrade?: { days, usd }, totalCents }, totalUsd, amounts } , ... }`.

**Rotation** (`sim/stream/live/rotation.mjs`, `stream.mjs --stations auto`): the house stations and the live
Station+ stations, nothing else. Each Station+ station 8 min an hour (`--plus-minutes`), the house stations share the
rest (with 6: 6 min each); each house station is followed by its half of the Station+ stations; re-read before every
change. A Station+ station plays once its loop exists: `sim/stream/live/build-loops.mjs` builds it on the stream host
(systemd timer, every 15 min, one station per run, low priority) and the stream skips the station until then
(`sim/stream/README.md` "Station+ loops"; it needs `work/base-1080p24.mkv` and `work/quads.json` copied from the dev
machine once).

**Weekly posts** (`bot/src/stations/plusPosts.ts`, run by the scheduler, which owns the X posting state, the station
timelines and DRY_RUN; the worker has no X keys): each live Station+ station posts once every 7 days (a new one at
once), the most overdue first, at most one Station+ post per tick and none within 3 h of the previous one
(`PLUS_POST_GAP_HOURS`), inside the daily cap of 24 (Station+ posts count in it; a due Station+ post takes the tick and
the hook's queue posts on the next). The post: the newest track finished since the station's last post (never one
released before; its start must be on the cached tape) as a release, else a "now playing" clip of its newest 200
swaps; both square 1080x1080 only, with the station's name, the blue station theme and its own sound (its pack sent
to the render pages as data). Caption, fixed (no model: X refuses two cashtags with a 403):

```
track #12 finished on the chog/mon station: 214 swaps, liquid.        now playing on the chog/mon station, liquid.
every $CHOG trade is a note, the whole track from its first swap...   the last 200 $CHOG swaps, played through the idm rules.
@client_handle                                                         @client_handle
theidm.fun/?net=chog                                                   theidm.fun/?net=chog
```

The handle is the paid setup application's X contact (none for a baked station or a Telegram/email contact). State
per station in `scheduler-state.json` `plusPosts` (`lastAt`, `lastTrackNo`, `lastKind`); dry runs keep `plusPostsDry`
(never delays a real post, never uses the cap). A failed post retries after an hour; after three the week is skipped.
`STATION_PLUS_POSTS=0` turns them off.

**Telegram** (worker): a paid setup as Station+ ("PAID ... as STATION+"), its go-live ("Station+ until ..."), Station+
renewals and upgrades (RENEWED ... as STATION+ / UPGRADED), the slots filling up (STATION+ FULL, once, and when one
frees), and each loop built or failed on the stream host (LOOP BUILT / LOOP FAILED, from `OUT_DIR/stream/loops.json`,
once per new outcome). `/status` shows the slots.

### Deploy (for the owner to approve; nothing here is applied)

1. Bot image as usual (`docker compose build bot`), then `docker compose up -d bot api` and `docker compose --profile
   stations up -d stations`. Optional env: `STATION_PLUS_SLOTS` (api.env and stations.env, default 6),
   `PLUS_POST_GAP_HOURS` (bot .env, default 3), `STATION_PLUS_POSTS=0` to hold the posts.
2. Site: `VITE_STATIONS_APPLY=1 npm run build -w site`, rsync as usual (the price table and the form show Station+).
3. Stream host: `sim/stream/live/README.md` "Station+ deploy" (rsync the stream and the builder, copy the base loop and
   the quads, python3-numpy/pil, the loops timer, `--stations auto --data-dir`, restart the stream).

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
reminders.json), paid renewals, Station+ (bought, upgraded, slots full, loops: "Station+" above). Commands by long polling, accepted ONLY from `TELEGRAM_CHAT_ID` (other chats are
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

Posts each station's launch and a weekly digest on @theidmfun; per-track posts only for the house stations; one post
a week per Station+ station ("Station+" above).
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

## Attention layer (prototype)

A station keeps playing its swaps; mentions of its token on X (Moni social data) add two things on top: "weather"
(elsewhere) and one quiet **ornament per mention**, played by the engine through the playing genre's **own** voice, so it
sounds like that genre's material and a pack's tables restyle it with the rest of the style. Nothing reads mentions
yet: the engine input is ready, the data feed is not wired.

- Input: `renderTimelineToBuffer(points, seconds, sr, { ..., ornaments: [{ time, smart? }] })` (render seconds), and
  `LivePlayer.noteMention(smart?)` live (the context's clock). Omitted or empty: the render is bit-identical to the
  synth without the layer (`engine-trace.ts --ref`: 180/180 identical).
- Scheduling (`OrnamentQueue`, player.ts): a mention plays on the first step at or after its time that is one of the
  playing base's slots (`ORNAMENT_PLAN`, engine.ts), at the step's own time (swing and micro included), never closer
  than an 8th to the previous ornament; one still waiting a bar later is let go (a dense wave thins out instead of
  trailing on). Deterministic: same inputs, same output. Successive mentions walk the voice's material (a word's
  syllables, the chord's tones, vowels), pitched from the bar's chord or the instance key.
- Level: about 18-23 dB RMS under the track (house styles, full section, showcase below). **Smart** mentions are the
  clearer version: louder and said in the voice's own terms (the whole word, a longer call, a second tone, an octave,
  a retrigger, a harder throw).

**Packs (electro first).** A style restyles its mention voice with `data.ornament` (styledata.ts `RobotWordSpec`, merged over
its base's preset `ROBOT_WORDS`): `vowels` (1..4 syllables `[F1, F2]`), `wave`, `steps` (crush, fewer = rougher), `octave`,
`syllable` (16ths), `ring` (ring-modulation ratio), `lowpass`, `echo` (`{ steps, feedback < 0.7 }` or null), `level`
(<= 0.1: a quiet answer, never over the track), `slots` (16ths of the bar). Silent without mentions: a style's
`ornament` never changes its track. Future garage next (styledata.ts `GarageOrnamentSpec`, over `GARAGE_ORNAMENTS`):
`voices` (1..4 of `reverse`, `foley`, `groove`, `yeah`, all played on every mention), `smart` (1..4, a smart mention's
set), `foley` (1..3 of `lighter`, `drop`, `vinyl`, in turn), `level` (0..1.6, 1 = the owner's preset) and `slots`. Then
liquid (styledata.ts `LiquidOrnamentSpec`, over `LIQUID_ORNAMENTS`): `voices` (1..3 of `nature`, `amen`, `keys`, all
played on every mention), `smart` (1..3), `nature` (1..3 of `bird`, `gust`, `drop`, in turn), `level` (0..1.6) and
`slots`. The other genres' voices already read their style's tables (stabs, 303, vowels, glints, lead patches); their own
`ornament` fields come next, genre by genre.

| Genre | Base | Voice (engine method) | Slots (16ths) | Smart |
|---|---|---|---|---|
| electro | all | the robot word (`robotWord`, owner-chosen): formant syllables, crushed, per base (Cold 808 a dark dry "oh-oo" an octave down; Client_03 "ah-ee"; Alien Rave a ring-modulated three-syllable call, echoed); style data `ornament` restyles it | offbeats 2 6 10 14 (style `ornament.slots`) | louder, an octave up, echoed |
| acid | all | a 303 chirp (`acid303Voice`) an octave over the line's last note | off-8ths and their 16ths the line leaves free | accent + slide up an octave |
| ambientidm | Tape Keys | one warm-keys note (`motifNote`, the style's patch) an octave over the ostinato | beats 0 4 8 12 | two notes a 16th apart |
| ambientidm | Tape Haze | the glitch row's tape-slip blip (`ambientHazeBlip`) | offbeats | louder |
| ambientidm | Crystal | a glass FM bell (`ambientBell`) on the chord's top, into the echo | beats | louder, with its octave |
| drone | Wall / Dark Low / Overtone Pulse | the base's glint (`droneGlint`): bell tones / distant bowls / a glass partial of the series | every 8th | louder |
| dubtechno | all | the bar's chord stab (`dubStab`) thrown into the echo | off-8ths and 16ths the stab figure leaves free | harder throw + a bell on the chord's top |
| liquid | Keys | the owner's mention voices (`liquidMention`): nature far away, in turn a bird (two sine chirps 2600 -> 4200 -> 3000 Hz, 0.12 s apart), a gust (bandpass noise 400 -> 1400 -> 500 Hz over 0.9 s), a water drop (a sine 1100 -> 2100 Hz in 20 ms), dry and a little into the room; style data `ornament` restyles it | off-8ths 2 10 (style `ornament.slots`) | two birds answering, the second pair a beat later, detuned x0.95 / x1.05 |
| liquid | Soulful | an amen ghost snare (bandpass noise 2.4 kHz + a triangle 240 -> 180 Hz), dry | shuffled 16ths 3 7 11 15 | a quick four-hit roll on 32nds, rising, + the two birds answering |
| liquid | Atmospheric | one note of the style's keys (`motifNote`) on the chord's top, an octave over the stabs, its attack capped at 8 ms so a slow patch (the tape flute, 70 ms) speaks on its step | offbeats 2 6 10 14 | a dyad |
| futuregarage | Vocal Chops | the owner's mention voices (`garageMention`): the same vocal "yeah" (a saw on the tonic, formant glide, a small fall, 3 16ths), dry and into the room; style data `ornament` restyles it | off-8ths 6 14, a beat before 1 and 3 (style `ornament.slots`) | the "yeah" x1.5 + a rising three-hit ghost snare roll into the kick |
| futuregarage | Dark Sub | ghost groove (a ghost rim + a shuffled closed hat 1.15 16ths later) and a foley object (lighter click / vinyl crack in turn) | shuffled 16ths 3 11 | a reverse breath ("aah" + noise wash) swelling from the step and cut on the next strong beat (8 / 0) + the lighter with its flame |
| futuregarage | Rain Atmos | a water drop (a sine chirping 900 -> 1900 Hz) among the rain | shuffled 16ths 3 11 | the reverse breath into 8 / 0 |
| triphop | all | the platter scratch (`tripHopScratch`) | after the snare 5 7 13 15 | louder |
| lofihouse | Dusty Keys | a house-keys stab of the chord's top two tones (`motifNote`) | offbeats | three tones |
| lofihouse | Sample Chop | a slice of the sample's top, an octave up (`lofiChopVoice`) | offbeats | a 32nd retrigger |
| lofihouse | Raw Rave | the crushed rave power-chord hit (`lofiRaveHit`) | odd 16ths 3 7 11 15 | louder |
| wonky | Dilla Swing | a soul chop of the chord's top (`wonkySoul`), late like the style's chops | offbeats | the whole voicing |
| wonky | Brainfeeder | a glass glint (`wonkyGlint`) on the chord | offbeats | louder, its octave a 16th later |
| wonky | Glitch-hop | a pitched vocal chop (`wonkyVox`), vowels in turn | odd 16ths | a 32nd stutter |

Listening: `node web/scripts/attention-showcase.mjs` renders all 30 house styles, 9 s each, on swaps 40..69 of
`imd-eth-7d` with the same mention wave (2.0, 3.1, 3.9, 4.4, 4.8, 5.1, 5.45 smart, 5.9, 6.6, 7.5 s) into
`sim/stations/attention/all-styles.wav`, the same without mentions (`all-styles-no-ornaments.wav`, A/B) and an index
with each segment's start, voice and measured ornament level (`all-styles.txt`). `--only <genre|genre/style,...>` for
a subset.

## Phases

1. **Manual** — registry + program threading + style-pack hooks for 5 genres + pack checks + /stations tab;
   applications by form, eligibility by script, payment to an address, swarm job opened by hand. Pilot: one paid
   swarm job (0.5 IMD) for a test pack, to learn whether it lands and in how many revisions.
2. **Semi-auto** — eligibility on the form, payment contract (pay -> registered), checks in CI.
3. **Marketplace** — self-serve; the payment contract opens the swarm job through the IMD Intake on chain.
