# @swarm-sequencer/synth

WebAudio engine for Intelligent Dance Market ($IDM) — every trade is a note, pool IDM/IMD on Robinhood Chain 4663. No runtime dependencies. The web app imports this package as TypeScript source. The package name stays `@swarm-sequencer/synth`.

## State

`decode(slot0, slot1)` / `encode(state)` implement SPEC §3.2. `pattern` bit `track * 16 + step`, bass as 16 nibbles, then `swapCount`, `lastTs`, `bpm`, `root`, `mode` in slot0; `patternId`, `lastTick` (int24), `pressure` (int32), `intervalEma`, `releaseCount` in slot1.

This decoder is intentionally local. `packages/core` is the canonical port (it also owns `mutate` and uses viem for `keccak256`). The field layout and the initial state (`pattern = 0x10100101`, `bpm = 96`, `root = 9` A, `mode = 0` Dorian, `intervalEma = 600`) match core. On-chain tempo is 72–118. Synth does not import core, so the audio package stays free of viem.

`root` and `mode` are still decoded (and `bassMidi` still walks the mode) for displays, but the engine no longer plays them: the chain drives rhythm and timbre, not pitch. Each genre instance has one fixed tonic (`genreKey(era, epoch)`) and a small allowed note set; bass nibbles are onsets, and the nibble only picks among those notes.

## Clock

One scheduler tick is one 16th note at the genre tempo. `genreTempo(era, bpm)` maps the on-chain 72–118 linearly into the genre's range (Dub Techno 117–124, Electro 118–130, Acid 120–132, Ambient IDM 84–100, Drone 60–80, Liquid DnB 170–176, Future Garage 130–138, Trip-hop 84–96, Lofi House 118–124, Wonky 80–94), so a fast market is still a fast track within the genre. `StepHit.tempo` and `TransportView.bpm` carry that genre tempo. Tempos outside 40–300 fall back to 96. Odd 16ths are delayed by the genre's swing.

## Epochs and eras

`epochOf(state)` is `floor(patternId / 4)`. `eraOf(epoch)` walks cycles of the genre pool `ERA_SCHEDULE` gives (today one entry: all ten from epoch 0): the first cycle in the listed order, every later one a seeded shuffle with no repeat and no A-B-A across the seam. `styleOf(era, epoch)` walks each genre's styles in list order. Both are pure, so a bot can post the era without rendering audio.

```ts
import { epochOf, eraOf } from "@swarm-sequencer/synth";

const epoch = epochOf(state);          // number
const era = eraOf(epoch);              // { id, name, index, ...timbre }
```

The ten eras are genres: Dub Techno, Electro, Acid, Ambient IDM, Ambient Drone, Liquid DnB, Future Garage, Trip-hop, Lofi House, and Wonky. Each is a sound world with its own voices, at most four layers, groove rules, tempo range, tonic set and note set (`Era.layers`, `Era.notes`). Neighboring epochs always differ. Per-genre layers, chain mappings and what to listen for: `sim/genres/NOTES.md`.

The chain drives rhythm and timbre: `arrange()` (density caps, SPEC §4.3) still decides which drum tier hits where, and each genre maps the four rows to its own voices. Pool tick moves filters/timbre; buy/sell pressure sets darkness, drive and space; whales and drops are structural (impact, dub throw, fill), never a key change. An auditioned genre keeps its tonic across epoch changes (the engine pins the epoch of its first hit).

A new era gets its own voice graph. The old and new graphs crossfade over one bar (`crossfadeSeconds(bpm)`, inside the spec's 1–2 bars) by complementary gain ramps. Both play during the fade so the handover has no click. `renderTimelineToBuffer(points, seconds, 44100, { eraId })` forces one era for a whole render (the gallery A/B). Omit `eraId` and the render follows the epoch of each state.

## Sound

Voices are synthesized, not sampled:

- drums — each genre maps the kick/snare/hat/glitch rows to its own kit: muffled 4/4 (Dub), 808 breakbeat and zaps (Electro), dry 808 + cowbell (Acid), lofi soft kit (Ambient IDM), a kick behind a wall (Drone), a two-step break (Liquid), a skippy 2-step under crackle (Future Garage), a slow heavy break with scratches (Trip-hop), dusty 4/4 with an open hat (Lofi House), a drunk MPC kit with a straight kick and a dragged snare, an off-grid crunchy beat or an edited, stuttered one (Wonky)
- bass — pedal on the tonic (sub, rumble, tuned kick tail), a 1–3 note arpeggio (Electro), or a 303 line from the raw bass nibbles inside a minor-pentatonic subset (Acid)
- harmony — only where the genre has it: one minor-9 stab into a long echo (Dub), a two-chord wobbling pad (Ambient IDM), an evolving drone (Drone). No chord progressions
- melody — the epoch motif on a lead patch, only in Ambient IDM (the one melody) and as sparse cold stabs in Electro

Every choice is a function of the state and the era. Noise, hat metal, and glitch waveforms are `mulberry32` buffers seeded by `patternId`. Nothing calls `Math.random`.

## Idle decay

`idleStage(state, nowSec)` is the SPEC §4.2 read the bot can call without starting audio. Idle seconds are `nowSec - lastTs` when `lastTs > 0`. A zero `lastTs` (no swap yet) stays full, and a clock behind `lastTs` stays full too.

Live playback uses the wall clock. Replay and offline render use the timeline's virtual unix clock (`TimelinePoint.now`), not the sped-up audio clock, so a 15-minute gap is still a 15-minute idle even when the tape is compressed into a few seconds.

| idle | stage | voices |
|---|---|---|
| under 10 min | `full` | everything |
| 10–30 min | `thinning` | hats and glitch fade across 10–20 min, then the snare across 20–30 |
| 30–60 min | `sparse` | pad, bass, and a kick that settles quieter. The lead is gone by 40 min. Bass fades from 50 to 60 |
| over 60 min | `drone` | the current genre's harmony bus and an idle bed on its tonic. Drone keeps a low bass floor |

Gains ramp across the current 16th. A voice that jumps back up ramps in 18 ms, so the return does not click. The first swap after a pause of at least 10 minutes restores every voice on that step and plays one short era fill on the next downbeat (`step % 4 === 0`), including that step when it already is one.

```ts
import { idleStage } from "@swarm-sequencer/synth";

idleStage(state, Date.now() / 1000);
// { idleSec, stage: "thinning", label: "IDLE 23m · THINNING", kick, snare, hat, glitch, bass, pad, lead }
```

`player.setClock(nowSec)` pins that clock. `null` means wall time. Demo mode pins it to `lastTs`, so a canned 2023 timestamp does not read as years of silence.

## Drops

A whale is `imdAmt >= 100 IMD` (`100e18` wei), `whale: true`, or a `drop` object. `player.noteDrop({ track, fill, mask })` arms it on the next unscheduled step. The state's pattern is already the post-swap pattern; the cue is the gesture around it.

- Sell (`fill: false`) lands on the step that reaches the event: a lowpass sweep and five short noise ticks into the breakdown.
- Buy (`fill: true`) waits for the downbeat: an impact, and the new Euclidean pattern (already in the state) is what plays on that beat.

A timeline entry with no `drop` field still drops when it is a whale. The track is `event.track` and `fill` follows `isBuy`. The player flashes that whole track row. Fills and drops play on the incoming era only; a fading era still follows the idle gains.

The master is a soft-knee waveshaper with a ceiling of 0.87 (about −1.2 dBFS), after the era sum, so peaks stay at or under −1 dBFS. `DynamicsCompressorNode` is not used: Chromium's compressor is not bit-exact. The same constraint drops `ConvolverNode`, delay feedback, and automating `DelayNode.delayTime`. The tempo echo is a chain of feed-forward delay → lowpass/highpass → gain stages (eight taps for Dub Techno), each darker than the last; the room is six early taps into ten chained late taps. One echo chain per tempo, switched by gain. Offline renders sum signals two at a time: a node with three or more inputs is not bit-exact in Chromium. Live playback connects straight through so a new era can join without clicking.

## API

```ts
import { createLivePlayer, decode, renderToBuffer, renderTimelineToBuffer } from "@swarm-sequencer/synth";

const player = createLivePlayer(audioContext);
player.setState(decode(slot0, slot1));
player.setClock(null); // wall clock. Pass unix seconds to replay a virtual clock.
player.noteDrop({ track: 2, fill: true, mask: 0x2491 }); // whale buy, lands on the next downbeat
player.start();
// setState, setClock, setEraOverride, and noteDrop after start apply on the next unscheduled step.

player.setEraOverride("dubtechno"); // optional. null follows eraOf(epochOf(state))
const buffer = await renderToBuffer(state, 4); // 4 bars, OfflineAudioContext @ 44100
const timeline = await renderTimelineToBuffer([{ time: 0, state }], 8);
const oneEra = await renderTimelineToBuffer([{ time: 0, state }], 12, 44100, { eraId: "ambientidm" });
```

`renderToBuffer` / `renderTimelineToBuffer` use `OfflineAudioContext` at 44100 Hz unless a sample rate is passed. Two calls with the same points, duration, and era override produce the same samples in one browser. `setState` and `setEraOverride` after `start` apply on the next unscheduled step. The playing graph stays up.

## Changing the synth after launch

The hook only stores state; everything audible lives here, so the sound can change with a site deploy and no contract change.

- **Genre history is frozen.** The genre of a past epoch must not change: bot posts, recordings and replays name it. `test/eras.test.ts` pins the genre of epochs 0–4095 by digest.
  - To change the genre pool, append an `ERA_SCHEDULE` entry with a future `fromEpoch`. Never edit or remove an entry.
  - New genres go at the end of `ERA_LIST`. Never reorder it or change an `index`.
- **Variations inside a genre are free.** Timbres, phrases, chord vamps and figures do not move the genre schedule.
  - Adding an item to a per-epoch list (`hash(epoch) % list.length`) re-rolls which item past epochs get. The genre stays the same; only the details change.
  - If a past epoch must sound exactly as it did, gate the new items by epoch the same way `ERA_SCHEDULE` does.
