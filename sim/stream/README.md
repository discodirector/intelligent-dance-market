# sim/stream: YouTube radio background loop

The stream picture is a pre-rendered 44 s loop (no audio track). The only live part of the stream is the sound.

- `src/` raw Grok clips (`clip-a/b/c.mp4`, not committed)
- `build.py plate` clean background plate (temporal median) + Pepe matte
- `quads.py` measures the screen glass quads on the plate (a few are set by hand in `MANUAL`)
- `wall/wall.html` + `wall/render.cjs` baked screen graphics: IDM-16 LCD, scopes, spectra, ring, level meters,
  7-segment counters. Deterministic per frame, 352 steps = 22 bars at 120 BPM = 1056 frames, so the loop closes.
- `build.py compose` plate, blinking LEDs, screens, Pepe; `clean.py` cartoon clean-up (flatten + ink lines);
  writes `out/loop-1080p24.mp4` and `out/loop-720p24.mp4` (H.264, yuv420p, GOP 48 = 2 s, no audio)

`work/` and `out/` are build outputs (not committed).

Per station: `build.py base` once (Pepe, plate, LEDs; `work/base-1080p24.mkv`), then for each station the wall in
its theme and ticker (`STATION=<key> node wall/render.cjs work/wall-<key> 1.5`, `PLATE=1` for its NOW PLAYING plate)
and `build.py station <key>` -> `out/loop-<key>-1080p24.mp4`. Every loop has the same frames and GOP layout, so the
live stream (`live/`) splices one into another on a keyframe.

## Station+ loops (built on the stream host)

A Station+ station (docs/STATIONS.md "Station+") joins the 24/7 rotation, so it needs its loop. `live/build-loops.mjs`
builds it on the stream host, from a systemd timer next to the stream (`live/deploy/idm-stream-loops.*`, every 15
min, one station per run, Nice 19 / CPUWeight 10 so the live audio keeps the CPU): for each live Station+ station
(the bot's `stations-data/status.json`) without `loops/loop-<key>-1080p24.mp4`, the wall render with its theme from
the registry merged with the runtime `stations.json`, the plate, `build.py station <key>` (`STREAM_OUT`, `LOOP_720=0`),
a frame-count check (1056), then the loop is renamed into `loops/`. The stream skips the station until then and plays
it from its next station change. Outcomes go to `/opt/swarm-sequencer/out/stream/loops.json`; the stations worker
tells the owner on Telegram (LOOP BUILT / LOOP FAILED, once per new outcome); a failure is retried after 1 h, 2 h,
4 h ... (at most a day; `loopbuild/state.json`).

What the builder needs that is NOT in git, copied once from the machine that built the current loops:

- `work/base-1080p24.mkv` (near-lossless, crf 8: large; `build.py base`, which itself needs the Grok clips
  `src/clip-a/b/c.mp4`, the plate and the mask; none of those are needed on the host)
  -> `/opt/idm-stream/loopbuild/work/base-1080p24.mkv`
- `work/quads.json` (the screen quads, `quads.py`) -> `/opt/idm-stream/loopbuild/work/quads.json`

and from git: `build.py`, `clean.py`, `wall/` -> `/opt/idm-stream/loopbuild/`. Python 3 with numpy and pillow, ffmpeg,
and the stream's own Playwright + Chromium (`/opt/idm-stream/node_modules/playwright`, `PLAYWRIGHT_BROWSERS_PATH`).
Missing any of them: every waiting station gets one LOOP FAILED naming the missing files, and nothing else happens.
Checked locally (2026-10-22) end to end with a synthetic base: wall frames, plate, encode, 1056 frames, renamed in,
about 2 min on the dev Mac (expect several times that on one throttled VPS core).
