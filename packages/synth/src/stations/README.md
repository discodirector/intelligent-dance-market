# Style packs: the swarm's brief

A **station** is a radio for one token (docs/STATIONS.md). Its sound is a **style pack**: one TypeScript file,
`packages/synth/src/stations/<key>.ts`, that only holds data. The engine plays it; the pack can never break it.
Our gate checks it automatically, then the owner listens. Nothing goes on air unheard.

`example.ts` in this folder is the reference: copy it.

## What a pack is

```ts
import type { StationPack } from "../pack.ts";

export default {
  key: "pepe",                         // the station key: a-z 0-9 "-", 2..24 chars (not "idm" / "imd-eth")
  name: "Pepe Night Shift",            // 1..40 chars
  genres: ["liquid", "triphop", "acid"],   // 2..5 distinct genres from the five below
  styles: {                            // for every genre in `genres` (and no other): 1..4 styles, in play order
    liquid: [{ id: "pepe-keys", name: "Pepe Keys", base: "classic", leads: ["pepe-ep"], data: { /* tables, sound */ } }],
    triphop: [/* ... */],
    acid: [/* ... */],
  },
  patches: { "pepe-ep": { /* optional: your own lead patches, LeadPatch shape (below) */ } },
} satisfies StationPack;
```

How it plays: the station walks its genres one epoch each, the first cycle in the listed order, then shuffled
cycles (never the same genre twice in a row). Each appearance of a genre plays one style for its whole epoch; a
genre's appearances walk its styles in order, round and round.

## Styles: ids and bases

A station style is a **variant of a house style**: same voice code in `engine.ts`, different data.

- `id` — your own id, a-z 0-9 "-", 2..24 chars, starting with a letter. It must not be a house style id (`classic`,
  `atmos`, `dark`, `soulful`, `bristol`, `rubber`, ... any genre) and must be unique in the pack. Prefix it with
  the key (`pepe-keys`).
- `name` — what the player shows, 1..24 chars.
- `base` — the house style whose renderer plays it (see the table below). It must belong to the style's genre.
- `bpm` `[low, high]`, `swing` (0.5 straight .. 0.68), `microScale` (0..2.5), `trim` (loudness, 0.25..3), `leads`
  (1..4 lead patch ids from `leads.ts` or the pack's own `patches`): optional. **Left out, they are inherited from the base style**, so
  `{ id, name, base }` alone sounds exactly like the base. Tempo windows: liquid 160..180, futuregarage 120..145,
  triphop 66..104, lofihouse 112..132, acid 108..140.
- `data` — the tables you change (below). A table left out keeps the house one. A table the base does not read is
  refused (it would do nothing).

## The data contract per genre

Every field, its shape, units and valid range are documented in `../styledata.ts` (that file is the contract;
`validatePack` in `../pack.ts` checks exactly those rules). Defaults are the tables at the bottom of `engine.ts`:
read them to see what the house plays, then write your own in the same shape.

Conventions: steps are 16ths (`s` = onset, `len` = length in 16ths); a two-bar figure has onsets 0..31, a four-bar
figure 0..63. `core: true` notes play even in a quiet market; the others need the chain's glitch row. A table is a
**list of alternatives**: each epoch picks one, so give 1..6 entries. Pitches are semitones over the instance tonic
(the engine picks the key; you never set it). Stay in the genre's note set (`eras.ts` `notes`).

| genre | base (house style) | notes and rhythm tables | sound fields (below; plus `mix` `fx` `vinyl` everywhere) |
| --- | --- | --- | --- |
| `liquid` | `classic` Keys | `vamps` `stabs` `answers` `contours` `kit` `fills` `sub` | `kit` `bass` `pad` |
| | `atmos` Atmospheric | `vamps` `phrases` `contours` `kit` `fills` `sub` | `kit` `bass` `pad` `choir` |
| | `soulful` Soulful | `progressions` (exactly 4 chords) `walks` `comps` `kit` `fills` `sub` | `kit` `bass` `strings` |
| `futuregarage` | `classic` Vocal Chops | `chords` `progressions` (2 bars a chord) `skips` `kicks` `sub` | `kit` `bass` `pad` `vowels` `rain` |
| | `dark` Dark Sub | `chords` `progressions` (4 bars a chord) `foley` `kicks` `sub` | `kit` `bass` `reese` `choir` `rain` |
| | `atmos` Rain Atmos | `vamps` `choirs` `pans` `kicks` `sub` | `kit` `bass` `pad` `choir` `rain` |
| `triphop` | `classic` Rhodes Break | `chords` (merged over i iv VI VII v IV) `progressions` (4 names) `statements` `answers` `turns` `space` `kicks` `sub` | `kit` `bass` `bowed` |
| | `bristol` Bristol Dark | `kicks` `pedal` `strings` `calls` | `kit` `bass` `bassTone` `bowed` |
| | `cinematic` Cinematic | `voicings` `cuts` | `kit` `bass` `bassTone` `bowed` |
| `lofihouse` | `classic` Dusty Keys | `vamps` `stabs` `sub` | `kit` `bass` |
| | `chop` Sample Chop | `vamps` `chops` `sub` | `kit` `bass` `chop` `pump` |
| | `rave` Raw Rave | `vamps` `stabs` `organ` | `kit` `bass` `organTone` `pad` |
| `acid` | `classic` 303 Floor | `lines` | `kit` `voice` |
| | `acidhouse` Acid House | `lines` | `kit` `voice` |
| | `rubber` Slow Rubber | `lines` | `kit` `voice` |

The shapes in short (full rules in `styledata.ts`):

- `vamps`: `[{ a: { pad, root }, b: { pad, root } }]` — two chords; `pad` 2..6 tones -12..26 over the pad root (at
  least two in 0..12), `root` -12..12 over the bass tonic.
- `stabs` / `phrases` / `comps` / `cuts` / `choirs` / `walks` / `chops`: figures of `{ s, len, core }` (+ `swell`,
  `oct` 0|1, `slice` 0..3 where the genre says).
- `kit` (liquid): any of `kick` (synth kick spec), levels, `snare` "keys" | "soft" | "soul", hat voices, `crash`, and
  `breaks`: lanes of 32 characters, "." rest or 1-9 velocity in ninths (`kick` `snare` `ghost` `hat` `open`).
- `kicks`: `{ lo, mid, hi }` lists of one-bar kick figures (steps 0..15) for a quiet, medium and busy kick row.
- `progressions`: liquid soulful: 4 chords `{ pad, root }`; futuregarage: indices into `chords`; triphop: 4 chord names.
- `lines` (acid): 16 steps, each `null` (rest) or `{ degree 0..4, octave -1..1, flags (1 accent + 2 slide +
  4 ornament), gate? 16ths }`; at least 4 notes.
- `sub`: the sub level 0..1 (futuregarage up to 1.2).

## Sound: kit, patches, effects, mix

The tables above change the notes and the groove. These change **the sound**: drum timbres, synth patches, effects
and mix. They are what makes a station sound like another producer and not like us; use them. Every field is a plain
number, word or list with a bounded range (`styledata.ts` "sound" has the units and ranges). **An object you give is
merged over the base's**: write only what you change. `SOUND_DEFAULTS` at the end of `engine.ts` holds the house value
of every field per genre and base: copy one, change a few numbers.

Every base of every genre reads:

| field | what it is |
| --- | --- |
| `mix` | bus trims in dB, -6..6: `{ kick, snare, hat, perc, bass, harm, lead, tex, fx }` (harm = pads/chords, tex = crackle/rain, fx = risers/throws) |
| `fx.echo` | the tempo-synced echo: `steps` 16ths (3 = a dotted 8th), `taps` repeats, `fb` level per repeat, `lp`/`hp` Hz of each repeat |
| `fx.echoSend`, `fx.spaceSend` | how much of each bus goes into the echo / the room, 0..1 |
| `fx.space` | the room: `size` (0.4 small .. 2.5 hall), `fb` tail length, `lp` darkness Hz |
| `fx.drumLp` | lowpass on the whole kit, Hz (18000 open, 6000 behind a wall) |
| `fx.drive`, `fx.pressDrive` | master saturation, and how much buy pressure adds |
| `fx.duck`, `fx.duckTime` | kick sidechain on `bass` / `harm` (gain at the kick; lower = deeper pump) and its recovery, s |
| `fx.master` | master inserts: `lp` a dark top (Hz), `hp` thinner low end (Hz), `crush` a bit crusher (6 gritty .. 12 faint) |
| `vinyl` | crackle and hiss level 0..2.5 (0 = none) |

Per genre (which base reads which: the table above and `DATA_FIELDS` in `styledata.ts`):

| genre | sound fields |
| --- | --- |
| `liquid` | `kit` (now also `snare` as your own layers, hats with `crush`), `bass` (all), `pad` (classic, atmos), `choir` (atmos), `strings` (soulful) |
| `futuregarage` | `kit` `{ kick, snare, ghost, hat, shaker, open }`, `bass`, `reese` (dark), `pad` (classic, atmos), `choir` (dark, atmos), `vowels` (classic chops), `rain` |
| `triphop` | `kit` `{ kick, snare, drag, hat, open }`, `bass`, `bassTone` (bristol, cinematic), `bowed` (the strings) |
| `lofihouse` | `kit` `{ kick, clap, snare, hat, open, shaker }`, `bass`, `organTone` + `pad` (rave), `chop` + `pump` (chop) |
| `acid` | `kit` `{ kick, clap, snare, hat, open, perc }`, `voice` (the 303: `wave` saw/square, `cutoff`, `envMod`, `resonance`, `decay`, `drive`, `level`, `accent`, `gate`, `sweep`) |

The shapes:

- **kick** `{ start, end, sweep, decay, click, clickHp?, drive?, body? }`: a sine swept from `start` to `end` Hz. Low
  `start` + long `decay` = boomy; high `start`, short `sweep`/`decay`, more `click` = tight and punchy; `drive` = grit.
- **snare / clap / perc / ghost**: a list of 1..6 **layers** fired together. A layer is one of
  `{ tone: "triangle", freq, to?, sweep?, decay, level }` (a pitched body), `{ noise: "bandpass", freq, q, decay, level }`
  (a noise burst; `highpass`/`lowpass` too), `{ crush: 4, filter, freq, decay, level, lp? }` (a bit-crushed crack, a
  sampled break) or `{ clap: 0.5 }` (the house clap inside). Each layer may add `at` (s later: flams, clap bursts),
  `tail: true` (shorter on ghosts), `pan`/`flip`, `accent: true` (backbeats only). The house snares are tables in
  `engine.ts` (`LIQUID_SNARES`, `GARAGE_CRUNCH`, `CLAP`, ...): start from one.
- **hat** `{ hp, decay, metal, q?, level, off?, crush? }`: highpass Hz (lower = thicker), decay s, metal ring 0..1;
  `crush` bits for an old-sampler hat. **shaker** `{ freq, q, decay, attack, level, off? }`.
- **bass** `{ wave: "sine" | "triangle", attack, hold, drive, octave }`: the sub every genre plays. A triangle with a
  little `drive` is audible on small speakers; `octave` adds the octave-up layer.
- **pad / choir / strings / bowed / chop** `{ osc: [{ type, detune, level }], cutoff, q, attack, release, level, vib,
  drive?, noise?, hp? }`: oscillators per chord tone (saws bright and wide, triangles and sines soft; detune in cents
  spreads them), base filter Hz (the market still moves it), envelope, wobble in cents. Each voice reads the fields
  its sound has (`styledata.ts` says which).
- **lead patches**: the pack may define its own in `patches` (top level, next to `styles`), by id, in the
  `LeadPatch` shape of `leads.ts` without `id`: `{ name, osc, fm?, filter, formants?, amp, vib?, glide?, blip?,
  noise?, drive?, gain }`. A style uses them with `leads: ["my-patch"]`. Ids like style ids, not a house patch id;
  ranges are those of the house patches (`PATCH_CHECK` in `pack.ts`). Copy a house patch from `leads.ts` and change it.

### Taste

- **Keep the genre recognisable.** Liquid stays a fast rolling break with a sub; trip-hop slow and heavy; acid a
  303 over four-to-the-floor. Change the producer, not the genre: kick and snare character, the keys' patch, the
  room, the grit.
- **Use contrast between your styles**, and against the house. Pick one idea per style and commit: dry and tight
  (small `space`, no echo, short kick and snare, closed hats) vs dub-delay heavy (`echo` with taps and feedback, big
  `spaceSend`); lofi crushed (`fx.master.crush` 8..10, `master.lp` 6000..8000, `drumLp`, crushed layers, `vinyl`) vs
  clean and wide (no vinyl, open `drumLp`, a big bright room, wide detuned strings). The example pack does exactly
  this: listen to `sim/stations/example/ab-house-vs-pack.wav`.
- **Avoid harshness.** No resonance or drive at the top of their ranges together; `master.crush` under 8 bits only
  for a deliberate effect; keep hats under ~0.6 level and snare noise `q` under ~2; bright layers short. When a style
  gets louder or brighter, the gate's loudness check will move its `trim` down: spend that headroom on the kick and
  bass, not on hats.
- **Mind the low end.** One thing owns the sub: a boomy kick wants a shorter `bass` `hold` or a deeper `fx.duck`;
  don't drive both the kick and the sub hard.
- **Space is a mix decision.** Echo and room on the kick and bass muddy the mix: send snares, leads, pads and percussion.

## Constraints

- **One file**: `stations/<key>.ts`. Nothing else in the repo changes (the gate checks it with `--diff`).
- **Data only**: an object literal. No functions, no loops, no `.map`, no computed values, no randomness.
- **No imports** except `import type { StationPack } from "../pack.ts"`. Ids you reference are plain strings (house
  bases, lead patch ids in `leads.ts` or your `patches`, trip-hop chord names).
- **No engine edits**, no new renderers: only the bases and tables above. If a sound needs a new knob, say so in the
  job; we open it in the engine for everyone.
- Every style ends up near the house loudness through its `trim` (the gate measures it; adjust `trim` until it passes).

## The gate

```
node web/scripts/station-check-pack.mjs <key> [--diff origin/main]
```

It runs `validatePack`, the synth typecheck and the house history tests, then renders every style on three epochs of
its genre in the station's program (20 s each, offline in Chromium, on fixed stretches of a real tape) and checks per
style: median loudest-3s within ±1 dB of -14.3 dBFS, peak under -0.5 dBFS, no near-silence (under -50 dBFS) longer
than 2 bars, and the same SHA-256 on two renders of each clip. It prints a pass/fail table, writes the clips to
`sim/stations/<key>/<genre>-<style>-e<epoch>.wav` and exits non-zero on any fail. Too quiet or too loud: change the
style's `trim` by the dB difference (`trim *= 10 ** (dB / 20)`) and run it again.

To hear what you changed, `node web/scripts/station-ab.mjs <key>` writes `sim/stations/<key>/ab-house-vs-pack.wav`:
for each style, 20 s of its house base then 20 s of your style, same key, same tape. If the two halves sound like the
same producer, push the sound fields further.

## Frozen once live

When a station is on air, its history is frozen like the house's (bot posts and recordings name the genre and
style): never edit, remove or reorder a style that has played, never change what an id sounds like. To change the
sound later, add styles with new ids; the program grows by appended entries from a future epoch (`program.ts`),
which we do on our side. Before launch, revisions may change anything.
