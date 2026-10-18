# site — Intelligent Dance Market ($IDM) public site

One-page Vite + TypeScript app. The hero is the player: the IDM-16 module (LCD grid, scope + spectrum from a real
`AnalyserNode`, 7-segment readouts, era display, idle-stage LEDs, PLAY, volume knob). Below it are the swap terminal,
"how it works", the eras rack (audition via `setEraOverride`), the onchain panel and the status bar.

```sh
npm -w site run dev        # http://127.0.0.1:5180
npm -w site run build
npm -w site run preview    # http://127.0.0.1:4180
npm -w site run check      # headless check against preview: screenshots/, backfill count, overflow, analyser, fps
node site/scripts/check-v2.mjs [--bot-timeline v2-window.json]  # v1 unchanged + v2 heat/drop: screenshots/v2-*.png
```

Data (`src/config.ts`):
- default: live on `ACTIVE_NETWORK` (Sepolia rehearsal from `contracts/deployments/sepolia.json`). It backfills every
  `Mutated` since `startBlock`, then polls every 8 s.
- `?replay=imd-week`: the W3 bot tape of the IMD/ETH mainnet pool (`public/timelines/imd-week.json`) on a virtual clock.
- `?replay=imd-week&rules=v2` (dev preview of the next hook): re-simulates the tape's swaps through core `mutate(..., V2_RULES)`: relative tiers, accumulation, heat and drops (3 drops in this tape; the first at swap 1145). `&speed=20000` gets there in seconds. HEAT ladder, TRACK # and the drop moment only show under v2.
- Rules versions live in `src/config.ts` (`rules` per network/replay, helpers in `src/rules.ts`). The deployed Sepolia hook is v1; `sepolia-v2` is a placeholder (hook `null`) and falls back to v1 until its address is filled in.
- `?net=robinhood`: once the IMD swarm launch exists, fill `NETWORKS.robinhood` (hook/token/pool/startBlock) and flip
  `ACTIVE_NETWORK`. No other code changes.

Audio: `createLivePlayer` connects to `ctx.destination`, so `src/audio.ts` shadows `destination` on its own
AudioContext instance with a master gain → analyser → real destination (volume + scope without a synth change).
Artwork (mark, module wall tiles, dithered floor) is generated in code: no IMD logos or characters.
