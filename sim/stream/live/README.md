# IDM radio: live stream pipeline

```
 site/stream.html?net=<station>  (headless Chromium, one    loops/loop-<station>-1080p24.mp4 (one per station:
 page per station; the next one starts a minute early)      same frames, screens in the station's colours,
        │ AudioWorklet tap, s16le, 100 ms chunks            NOW PLAYING plate; IDR every 48 frames, AUD, no B)
        ▼                                                          │ feeder ffmpeg: raw H.264, faster than real time
 stream.mjs mixer: exactly real time, gaps -> silence,             ▼
 2 s crossfade between stations, watchdog + relaunch     stream.mjs: whole frames into a FIFO at n/24 s; a station
        │ raw PCM on stdin                                change splices the next loop on a keyframe, same loop frame
        ▼                                                          ▼
 ffmpeg: video copy (input -r 24 stamps by frame count) + AAC 160k 48 kHz, +7 dB, limiter, soft clip -> FLV -> RTMP
```

Only the sound is live. The picture is pre-rendered (no video encoding on the server). A station change keeps Pepe
moving (same loop frame); the screens change colour, the LCD and the plate name the new station.

## Run locally

```sh
npm run build -w site                       # builds site/dist incl. stream.html
cd sim/stream/live && npm install           # playwright 1.64.1 (or --playwright <path to an installed one>)
node stream.mjs --dist ../../../site/dist --loops ../out --registry ../../../stations/registry.json \
  --stations idm:1,imd-eth:1,infer:1 --out /tmp/test.flv --seconds 200
```

`--stations key:minutes,...` (rotation order) or `auto`: the house stations and the Station+ stations only
(docs/STATIONS.md "Station+"; `rotation.mjs`, tested by `node --test rotation.test.mjs`), re-read before every change
from `status.json` + the runtime `stations.json` (`--data-dir <bot stations-data>` on the same host, else
`--data-origin`). One cycle is an hour: each Station+ station `--plus-minutes` (8), the house stations share the rest
(`--hour-minutes` 60, never under `--house-min-minutes` 5 each; past that the cycle runs longer). Each house station is
followed by its half of the Station+ stations:

| Station+ on air | cycle |
|---|---|
| 0 | idm 30, imd-eth 30 |
| 1 | idm 26, A 8, imd-eth 26 |
| 2 | idm 22, A 8, imd-eth 22, B 8 |
| 4 | idm 14, A 8, B 8, imd-eth 14, C 8, D 8 |
| 6 (the cap) | idm 6, A 8, B 8, C 8, imd-eth 6, D 8, E 8, F 8 |

A station needs its loop (`../build.py station <key>`); a Station+ station's is built on the host by
`build-loops.mjs` (timer `deploy/idm-stream-loops.*`, `../README.md` "Station+ loops") and the rotation skips it until
then. A Station+ that lapses (or is renewed as a plain station and its Station+ time ends) leaves the cycle at the next
change. `/stations-data/*` (checkpoints, subscription status) is proxied to `--data-origin` (https://theidm.fun).
`--boost 7` dB gain.
Production reads the RTMP URL from `STREAM_URL_FILE`; the URL (stream key) is never printed, ffmpeg's log is scrubbed.

## Measured on the dev Mac (Apple Silicon), 150 s live on Robinhood

| | CPU | RSS |
|---|---|---|
| Chromium renderer (synth) | ~7 % of a core | ~290 MB |
| other Chromium processes | ~0 % | ~600 MB total |
| ffmpeg (video copy + AAC) | ~1-3 % | ~27 MB |
| node harness | ~1 % | ~180 MB |

Output: 3.2 Mbit/s video + 160 kbit/s audio, about 1.1 TB/month upstream. Audio -16 LUFS integrated, true peak
under -1 dBFS. Killing Chromium mid-stream: ffmpeg keeps going, 0.5 s of silence, the page relaunches itself.

## Server

Any small Ubuntu 24.04 box is enough: the load is one Chromium tab doing WebAudio plus a stream copy. An ARM core
(Hetzner CAX) is slower than Apple Silicon, so expect roughly 15-30 % of one vCPU for the synth. 2 vCPU / 4 GB is
plenty, and 4 vCPU / 8 GB (CAX21) leaves a lot of headroom. x86 matches the bot's Docker image; arm64 works with
Playwright's own Chromium (Google Chrome has no Linux arm64 build).

Rotation tested locally ($IDM -> IMD/ETH -> INFER, 1 min each): switches land on the planned keyframe, Pepe's
frame-to-frame motion at the cut stays within normal, audio crossfades with no gap. While the next station's page
replays its pool history (no checkpoint published yet), the page on air can lose a little audio to CPU contention;
the bot's checkpoints (theidm.fun/stations-data) make that load short.

Setup: `deploy/setup-ubuntu.sh`, rsync `stream.mjs rotation.mjs build-loops.mjs package.json deploy/ dist/
registry.json loops/` to `/opt/idm-stream`, the owner writes the RTMP URL to
`/etc/idm-stream/url` (mode 600), then `systemctl enable --now idm-stream`.

### Station+ deploy (for the owner to approve; nothing here was run on a server)

On the VPS (the stream runs there as `idm-stream`, the bot in docker with OUT_DIR = /opt/swarm-sequencer/out):

1. From the checkout: `rsync -a sim/stream/live/{stream.mjs,rotation.mjs,build-loops.mjs,package.json,deploy}
   root@<vps>:/opt/idm-stream/` and `rsync -a sim/stream/{build.py,clean.py,wall} root@<vps>:/opt/idm-stream/loopbuild/`.
2. From the machine that built the loops: `rsync -a sim/stream/work/base-1080p24.mkv sim/stream/work/quads.json
   root@<vps>:/opt/idm-stream/loopbuild/work/`.
3. On the VPS: `apt-get install -y python3-numpy python3-pil`;
   `install -d -o idm -g idm /opt/idm-stream/loops /opt/idm-stream/loopbuild/work /opt/idm-stream/loopbuild/out /opt/swarm-sequencer/out/stream`;
   `chown -R idm:idm /opt/idm-stream/loopbuild`.
4. Dry run as the service user: `sudo -u idm node /opt/idm-stream/build-loops.mjs --dry-run --loops /opt/idm-stream/loops
   --registry /opt/idm-stream/registry.json --builder /opt/idm-stream/loopbuild --data-dir /opt/swarm-sequencer/out/stations-data`
   (prints the Station+ stations and which one it would build).
5. `cp /opt/idm-stream/deploy/idm-stream.service /opt/idm-stream/deploy/idm-stream-loops.{service,timer} /etc/systemd/system/`,
   `systemctl daemon-reload`, `systemctl enable --now idm-stream-loops.timer`, `systemctl restart idm-stream` (now
   `--stations auto --data-dir ...`; a short reconnect, YouTube keeps the broadcast). Logs: `journalctl -fu idm-stream`
   ("rotation: idm 26 min, ..."), `journalctl -u idm-stream-loops`.

## To verify on the server before going public

- Chromium on a box without a sound card: the AudioContext must still run in real time (Chromium falls back to a
  fake output). If it does not, add a PulseAudio null sink; nothing else changes (the tap is in the page).
- A private/unlisted YouTube test broadcast for a few hours: `journalctl -fu idm-stream` status lines every 60 s
  (swaps, queue, silence filled, RSS).
- Reload cost grows with the chain: the page backfills every Mutated since the hook's start block on each (re)start.
