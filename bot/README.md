# bot — Swarm Sequencer X bot (W3)

```
replay  : Ethereum IMD pool Swap logs -> packages/core mutate() -> timeline.json   (TIMELINE.md)
render  : Playwright/Chromium page -> JPEG frames + WAV -> ffmpeg -> mp4 1080x1080 + 1920x1080 (20–45 s)
caption : facts.json -> claude-sonnet-5-5 (validated, <=240 chars) | template fallback
post    : DRY_RUN=true (default) -> out/queue/<ts>_<kind>/{video.mp4,caption.txt,facts.json,post.json}
          DRY_RUN=false -> X API v2 chunked media upload + POST /2/tweets
schedule: SPEC §5 rules (src/rules.ts): pre-launch teaser every 6h; live snapshot every 6h,
          Movement/whale max 1/h, cap 6 posts / rolling 24h
```

## Commands (from repo root, after `npm install`)
```sh
npm run replay -w @swarm-sequencer/bot -- --days 7 --pools main --out out/timeline.json
npm run render -w @swarm-sequencer/bot -- --timeline out/timeline.json --seconds 32
npm run teaser -w @swarm-sequencer/bot        # replay + render + caption + queue (one post)
npm run scheduler -w @swarm-sequencer/bot     # long-running loop
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
```
/opt/swarm-sequencer/
  .env                 # secrets (chmod 600), from bot/.env.example — DRY_RUN=true
  packages/core/  bot/ # rsync of the repo dirs
  out/                 # queue + scheduler state (volume)
```
```sh
rsync -azR --delete --exclude node_modules --exclude out ./packages/core ./bot root@138.201.92.157:/opt/swarm-sequencer/
ssh root@138.201.92.157 'cd /opt/swarm-sequencer/bot && docker compose up -d --build'
ssh root@138.201.92.157 'docker logs -f swarm-sequencer-bot'
```
Live mode turns on when `HOOK_ADDRESS` + `LIVE_RPC_URL` (Robinhood Chain 4663) are set in `.env`.
