# `render.html` capture contract

Headless page the bot opens in Chromium for Intelligent Dance Market ($IDM). No controls, no chrome. The canvas is square (`min(100vw, 100vh)`) and draws the 4×16 grid, the bass row, the running step, mutation flashes, the info line `bpm · root/mode · swap #N · page #M`, a second line `EPOCH #n · <era name>`, and `IDLE 23m · THINNING` from `idleStage`. The epoch line flashes amber for about 700ms when the epoch changes. A whale flashes the whole track row. Epoch and era are derived (`floor(patternId / 4)`, then `eraOf`); the timeline has no era field. Idle uses each entry's virtual unix time (`ts` or `timestamp`), not the sped-up audio clock.

## URL

```
/render.html?timeline=<url>&seconds=<n>
```

`timeline` is required. It is fetched as JSON (same-origin path or absolute URL). `seconds` is the default duration when a call omits it (default 8). `speed` (default 1) divides the timeline clock, so `speed=8` plays eight times faster. A 7-day tape fit into 48 seconds is about `speed=12585`.

## Timeline JSON

Two shapes are accepted. Both are a JSON array. Packed `slot0` / `slot1` are decoded with the synth (SPEC §3.2); a decoded `state` object on the entry is ignored.

**W3 `bot/TIMELINE.md` (what the bot writes).** One entry per swap, state after `mutate`:

| field | required | meaning |
|---|---|---|
| `slot0`, `slot1` | yes | packed state, `0x` hex or decimal |
| `ts` | yes | unix seconds (or unix ms if `> 1e12`). Playback time is `ts - first`. |
| `track`, `step` | no | mutation flash |
| `on`, `bassNote`, `isBuy`, `imdAmt`, `imd`, `tick`, `swapCount`, `whale`, `movement` | no | kept for the bot. A bass cell flashes when `isBuy` or `bassNote === 0`. |
| `whale` | no | `true`, or `imd` / `imdAmt` at least 100 IMD (`100e18` wei), makes the swap a drop |
| `drop` | no | `{ track: 0..3, fill, mask }`. Sell (`fill: false`) is a filter sweep into the breakdown on that step. Buy (`fill: true`) is an impact on the next downbeat, and the packed pattern is already the new Euclidean line. A whale with no `drop` uses `track` and `isBuy`. The whole track row flashes. |

The committed tape is served in dev and preview at `/timelines/imd-eth-7d.timeline.json` (file: `bot/data/imd-eth-7d.timeline.json`, 2036 swaps). The `.meta.json` sidecar is not required; playback starts at the first entry.

**Demo shape** (`web/public/demo-timeline.json`): same slots, but the clock field is `timestamp` (seconds from the start, or unix). An opening entry may omit `track` / `step` so it does not flash.

## Globals

The page sets these after the module loads:

```ts
window.__ready: boolean          // true once the timeline is decoded and the first frame is drawn
window.__readyPromise: Promise<void>
window.__error?: string          // set when the timeline fails; __ready stays false and the calls reject

window.__render({ fps, seconds }): Promise<void>
window.__renderAudio(seconds): Promise<string>
```

Wait for `window.__ready === true` (or `await window.__readyPromise`) before calling either function.

### `__render({ fps, seconds })`

Paints `round(fps * seconds)` frames. Frame `i` shows timeline time `i / fps`, using the same step clock as the offline audio (swing and micro-timing included). The promise resolves after that playback has been drawn, paced to about `seconds` of wall clock so a screencast records the frames. Each call starts again at t = 0.

### `__renderAudio(seconds)`

Returns a base64 WAV (no `data:` prefix): 16-bit PCM, stereo, 44100 Hz, duration exactly `seconds`. Rendered with `OfflineAudioContext` from the same timeline. Same timeline and duration resolve to the same string in one browser. Tails past `seconds` are cut.

`seconds` on either call overrides the query value. `speed` is taken from the query only, and it is already applied to the clock both calls share. `window.__timelineCount` is the number of entries once `__ready` is true.

Each painted frame also sets `window.__frame`:

```ts
window.__frame = {
  time,      // timeline seconds of this frame (already divided by speed)
  step,      // 0..15
  epoch,     // floor(patternId / 4)
  era,       // eraOf(epoch).name
  eraId,     // eraOf(epoch).id
  bpm,
  info,      // the same string drawn on the canvas
  idleSec,   // virtual seconds since lastTs
  idle,      // "full" | "thinning" | "sparse" | "drone"
  idleLabel, // "IDLE 23m · THINNING"
}
```

Era is not stored on the timeline. It is the synth's deterministic pick for that epoch. `idleSec` follows the virtual unix clock, so `speed` does not shrink a long gap.

## Idle test tape

`web/public/idle-test.timeline.json` is served at `/idle-test.timeline.json`. Nine swaps, pattern page 40 (epoch 10, Acid) for the whole tape. Gaps are 15 minutes, 45 minutes, and 2 hours, then a whale buy (`drop: { track: 2, fill: true, mask }` replaces the hat track with a Euclidean pattern) and a whale sell (snare track cleared, no `drop` field — inferred from `whale` and `track`).

```
/?mode=replay&timeline=/idle-test.timeline.json&speed=200
/render.html?timeline=/idle-test.timeline.json&seconds=57&speed=200
```

At `speed=200` the tape is about 57 seconds. The first part of each long gap is the recovery (full kit again, plus a short fill). Hats and glitch thin across the 15-minute gap, the 45-minute gap reaches the sparse pad-and-bass stage, and the 2-hour gap is the quiet pad. The whale buy and sell land in the last few seconds.

## Bot sketch

```js
await page.goto("http://127.0.0.1:4173/render.html?timeline=/demo-timeline.json&seconds=30");
await page.waitForFunction(() => window.__ready === true);
await page.evaluate(() => window.__render({ fps: 30, seconds: 30 }));
const wavBase64 = await page.evaluate(() => window.__renderAudio(30));
```

Viewport should be square (1080×1080 or 1920×1920). The canvas letterboxes itself if the viewport is not square; a square viewport fills the frame.
