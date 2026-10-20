# bot — Swarm Sequencer X bot (W3)

```
replay  : Ethereum IMD/ETH pool Swap logs (ETH side = quoteAmt) -> packages/core mutate() -> timeline.json   (TIMELINE.md)
render  : Playwright/Chromium page -> JPEG frames + WAV -> ffmpeg -> mp4 1080x1080 + 1920x1080 (20–45 s)
caption : facts.json -> claude-sonnet-5-5 (validated, <=240 chars) | template fallback
post    : DRY_RUN=true (default) -> out/queue/<ts>_<kind>/{video.mp4,caption.txt,facts.json,post.json}
          DRY_RUN=false -> X API v2 chunked media upload + POST /2/tweets
release : finished v2 track (SPEC §4.6) -> web/render.html release mode -> <trackNo>.wav + .json
          (+ .mp4 1080x1080: frames from site/bot.html, the IDM-16 module of the other posts)
schedule: SPEC §5 rules (src/rules.ts): pre-launch teaser every 6h; live snapshot every 6h,
          Movement/whale max 1/h, cap 6 posts / rolling 24h; v2 track complete -> release post
```

## Commands (from repo root, after `npm install`)
```sh
npm run replay -w @swarm-sequencer/bot -- --days 7 --pools main --out out/timeline.json
npm run render -w @swarm-sequencer/bot -- --timeline out/timeline.json --seconds 32
npm run teaser -w @swarm-sequencer/bot        # replay + render + caption + queue (one post)
npm run scheduler -w @swarm-sequencer/bot     # long-running loop
npm run release -w @swarm-sequencer/bot -- --track 2 --mp4   # release of one track -> sim/release/2.{wav,mp4,json}
npx tsx bot/src/pipeline.ts release [timeline.json] [trackNo] # dry-run track post from a tape (default: synthetic tape)
npm test -w @swarm-sequencer/bot
```

## Render page contract
`src/render/index.ts` loads a page (default: the bot's own `src/render/page/teaser.html`, built from SPEC §4)
and calls, deterministically:
- `await __setup({ timeline, width, height, fps, seconds, title, subtitle }) -> { frames, steps, swaps }`
- `__frame(i) -> "data:image/jpeg;base64,…"` (draws frame i = time i/fps)
- `await __audio() -> base64 WAV` (OfflineAudioContext, 44.1 kHz)

`--page <path>` swaps in another page with the same API (e.g. web/render.html once it exposes it).

## Deploy (VPS `root@138.201.92.157`, only `/opt/swarm-sequencer`)
One image (`bot/Dockerfile`, context = repo root, ignore file `bot/Dockerfile.dockerignore`), three stages:
`site` builds `site/` (bot.html, the clip page), `web` builds `web/` (`render.html?release=1`, the release page; tsc +
vite as in `npm run build -w web`), and the bot stage copies both dists in (`RENDER_SITE_DIR=/app/site/dist`,
`RENDER_WEB_DIR=/app/web/dist`) next to `bot/src`, `packages/core/src`, `bot/data` and `web/src/trackSelect.ts`
(imported by `bot/src/lib/release.ts`, so the scheduler needs it). Chromium headless shell + ffmpeg are in the image.
Two compose services (`bot/docker-compose.yml`) run the same image:
- `bot` — `npx tsx src/scheduler.ts`, env `../.env`, volume `../out:/app/out`, always on;
- `pulse` — `npx tsx src/pulse.ts`, env `../pulse.env` only, profile `pulse` (not started by a plain `up`).
```
/opt/swarm-sequencer/
  .env                 # bot secrets (chmod 600), from bot/.env.example — DRY_RUN=true
  pulse.env            # keeper only (chmod 600), from bot/pulse.env.example — PULSE_SEND=false, PULSE_KEY
  packages/core/ packages/synth/ bot/ site/ web/ contracts/deployments/  # rsync of the repo dirs
  out/                 # queue + scheduler state (volume)
```
```sh
rsync -azR --delete --exclude node_modules --exclude out --exclude dist --exclude screenshots --exclude .env --exclude pulse.env \
  ./packages/core ./packages/synth ./bot ./site ./web ./contracts/deployments root@138.201.92.157:/opt/swarm-sequencer/
ssh root@138.201.92.157 'cd /opt/swarm-sequencer/bot && docker compose up -d --build'          # bot only
ssh root@138.201.92.157 'docker logs -f swarm-sequencer-bot'
```

**Env (`.env`, bot).** `DRY_RUN` (true = queue only), `ANTHROPIC_API_KEY`, `CAPTION_MODEL`, `X_API_KEY` /
`X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` or `X_OAUTH2_USER_TOKEN`, `ETH_RPC_URL`, `REPLAY_POOLS`,
`TEASER_WINDOWS`, `TICK_MINUTES`, `VIDEO_SECONDS`; live: `HOOK_ADDRESS`, `HOOK_START_BLOCK`, `LIVE_RPC_URL`,
`LIVE_CHAIN_ID` (4663), `HOOK_RULES` (`v1` default | `v2` at launch), `PULSE_TREASURY` (pulse labels only);
track posts: `TRACK_POST` (`release` default | `clip`), `X_VIDEO_MAX_SECONDS` (140), `TRACK_LOOKBACK_BLOCKS`,
`TRACK_LOOKBACK_STEPS`; render pages: `RENDER_SITE_DIR`, `RENDER_WEB_DIR` (set in the image, override only to test
another build). Never put `PULSE_KEY` here.
**Env (`pulse.env`, keeper).** `PULSE_TREASURY`, `LIVE_RPC_URL`, `LIVE_CHAIN_ID`, `PULSE_TICK_SEC`, `PULSE_SEND`
(false), `PULSE_KEY` (only read when `PULSE_SEND=true`); fee harvest: `FEE_FACTORY`, `LAUNCH_NUMBER`, `HARVEST_HOURS`,
`FEE_SPLITTER` (split() after each harvest), `BURN_HOURS`. The keeper needs nothing else: no X / Anthropic keys, no
volume. Both env files live outside the image (`.dockerignore` drops `.env*` and `pulse.env`).

**Release CLI in the container** (uses the built web; output in the `out/` volume):
```sh
docker exec swarm-sequencer-bot npx tsx src/release/index.ts --out /app/out/release --mp4          # synthetic tape, latest track
docker exec swarm-sequencer-bot npx tsx src/release/index.ts --timeline /app/out/timeline.json --track 2 --out /app/out/release --mp4
docker exec swarm-sequencer-bot npx tsx src/pipeline.ts release          # dry-run track post -> out/queue/<ts>_track/ (DRY_RUN=true)
```
The default tape is `/app/web/public/release-test.timeline.json` (also served at `/app/web/dist/`). A ~230 s release
renders the WAV in about real time and the mp4 in ~40 s more on a laptop; expect slower on the VPS's 1.5 CPUs.

**Post-launch checklist.**
1. `.env`: `HOOK_ADDRESS`, `HOOK_START_BLOCK`, `LIVE_RPC_URL`, `PULSE_TREASURY`, and
   `HOOK_RULES=v2`; `docker compose up -d` (recreates the bot), then `docker logs -f swarm-sequencer-bot`.
2. Smoke the release path in the container: `docker exec swarm-sequencer-bot npx tsx src/pipeline.ts release`.
3. `pulse.env`: `PULSE_TREASURY`, `LIVE_RPC_URL`, `PULSE_SEND=false`; `chmod 600`; start the keeper in dry run:
   `docker compose --profile pulse up -d pulse`, `docker logs -f swarm-sequencer-pulse` (`DRY RUN would send …` / `wait: …`).
4. Fund a dedicated hot wallet with a little ETH for gas, put its key in `pulse.env` as `PULSE_KEY`, set
   `PULSE_SEND=true`, `docker compose --profile pulse up -d pulse` again (env files are read at container creation).
5. Only then `DRY_RUN=false` for posting, if not already.

The keeper exits right away if `PULSE_TREASURY` or `LIVE_RPC_URL` is empty, and `restart: unless-stopped` would
restart it in a loop; that is why it sits behind the `pulse` profile and is started only after step 3.

## Pulse keeper (`src/pulse.ts`)
Calls `PulseTreasury.pulse()` (`contracts/src/PulseTreasury.sol`, runbook `contracts/TREASURY-RUNBOOK.md`) when the hook
has been silent for >= 15 min, so the track keeps playing. `pulse()` is permissionless and the contract enforces every
rule (idle window, size, 1% budget, ~2% price limit); the keeper only pays gas and reads `nextPulse()` first.
```sh
PULSE_TREASURY=0x… LIVE_RPC_URL=… npm run pulse -w @swarm-sequencer/bot            # dry run (default): logs what it would send
PULSE_TREASURY=0x… LIVE_RPC_URL=… PULSE_SEND=true PULSE_KEY=0x… npm run pulse -w @swarm-sequencer/bot   # sends
```
- **Dry run is the default**; only `PULSE_SEND=true` sends. Each send is simulated first, so a lost race (a real swap or
  another caller pulsed first) fails off-chain with `NotIdle` instead of burning gas.
- `PULSE_KEY` is read **only from env** and only in send mode; it is never logged or stored in config. Use a dedicated hot
  wallet holding a little ETH for gas (a pulse costs ~145–170k gas); it never needs the treasury's funds.
- Other env: `LIVE_CHAIN_ID` (default 4663), `PULSE_TICK_SEC` (default 60).
- Labels: set `PULSE_TREASURY` for the scheduler too. Swaps whose `Mutated.sender` is the treasury get `pulse: true` in the
  timeline, facts carry `pulses: N`, and captions may say "treasury pulses" (never as outside demand). Empty = no labels.

## Track releases (v2)
A release is a finished track played whole, from its seed to its `TrackComplete`, one swap per bar (SPEC §4.6,
`web/RENDER.md` "Release"). `src/release/index.ts` drives `web/render.html?release=1&track=N` in Chromium: it serves
the tape on loopback and calls `__renderRelease` (the WAV, unchanged by the video). With `--mp4` the frames come from
`site/bot.html`, the same IDM-16 module as the teaser/snapshot/movement posts: `__setupRelease` plans the same release
from the same tape and options (the CLI checks the length matches the WAV to the microsecond), reads the WAV for the
scope/spectrum/OUT meter, and `__frame(i)` + a viewport screenshot per frame go into ffmpeg with the WAV. In the frame:
BPM/KEY/MODE/EPOCH of the release's genre instance, SWAP #, PAGE, TRACK #, the HEAT ladder (16/16 on the climb and
the drop bar), the genre LCD with the **genre only** (style names are internal, never in a frame) and the sub-line
`TRACK #N · SECTION · m:ss / m:ss` (`TRACK #N COMPLETE · …` from the drop), the RELEASE block (INTRO/BUILD/DROP/OUTRO
LEDs, `BAR b/B`, progress bar), the swap tape under the module scrolling the swaps as they land and ending with
`TRACK #N COMPLETE · K SWAPS`; at the drop the panel rings and the grid flashes, then the outro shows the new seed.
`--stills` also writes PNGs of representative moments next to the mp4 (`<N>.intro.png`, `.build.png`, `.body.png`,
`.heat.png`, `.climb.png`, `.drop.png`, `.outro.png`). Pages come from built dists (`--web-dir` / `RENDER_WEB_DIR`,
`--site-dir` / `RENDER_SITE_DIR`) or, in a checkout, from Vite dev servers. Options: `--track` (default latest completed), `--pace` (swaps per bar, default 1),
`--max-seconds` / `--min-seconds` (360 / 180), `--fps`, `--size`, `--meta` (a `.meta.json` with `initial`, for a
track that starts the tape). The whole release plays one genre and style, the ones of the epoch the track finished
in. Output: `<out>/<trackNo>.wav`, `.json` (trackNo, swaps, bars, seconds, `genre` (genre/style played), `chainGenres`
(genres passed on chain), sections, `synth` (synth version, the page's build commit, the bot's `git rev-parse HEAD`),
first/last block and tx, seed, levels), `.mp4`. A published release is archived as WAV + JSON; re-rendering it with a
newer synth may sound different. Test tape: `web/public/release-test.timeline.json`
(`npx tsx bot/scripts/release-tape.ts`: core mutate under the V2 rules, three completed tracks).

**Track post.** With `HOOK_RULES=v2`, when the scheduler sees a new `TrackComplete` and `decide` picks `track`
(beats movements and snapshots, shares the 1/h event gap, counts toward 6 posts/24h), `produceRelease`
(`src/pipeline.ts`):
1. reads the hook's logs back from the context window, `TRACK_LOOKBACK_BLOCKS` (30k) at a time, up to
   `TRACK_LOOKBACK_STEPS` (24) times, until the track's start is on the tape (previous `TrackComplete`, or swap #1);
   if not found the release starts at the oldest swap read and `facts.release.partial` is set;
2. renders the release WAV + 1080x1080 mp4;
3. if it is longer than `X_VIDEO_MAX_SECONDS` (140), cuts the climb into the drop: the last 140 s, ending at most
   105 s after the drop (so the drop and the start of the outro are in), audio faded in over 0.4 s;
4. captions from facts only: `facts.headline` = `track #N complete. K swaps, genre.` (the genre the track ended in,
   which the whole release plays; never the style) and `facts.release` (seconds, bars, swaps, swaps per bar,
   genre, style, `chainGenres` passed on chain, clip); the template
   caption starts with the headline;
5. queues `out/queue/<ts>_track/` with `video.mp4` (the post video), `caption.txt`, `facts.json`, and as artifacts
   (listed in `post.json.artifacts`, not uploaded) the full `<N>.wav`, `<N>.json` and, when cut, the full `<N>.mp4`.

`TRACK_POST=clip` keeps the old 32 s run-up clip (`trackWindow`); the scheduler also falls back to it when the release
fails. The Docker image builds `web/` and sets `RENDER_WEB_DIR=/app/web/dist` (see Deploy).

