# Style packs: the swarm's brief

A **station** is a radio for one token (docs/STATIONS.md). Its sound is a **style pack**: one TypeScript file,
`packages/synth/src/stations/<key>.ts`, that only holds data. The engine plays it; the pack can never break it.
Our gate checks it automatically, then the owner listens. Nothing goes on air unheard.

`example.ts` in this folder is the reference: copy it. The other files are packs on air (`infer.ts`, `credits.ts`:
Credits Techno, dark dub techno with the kick `rumble` and sparse `stabBars`) or kept for later (`credits-dubhouse.ts`: the Credits
station's first pack, dub house, on no station).

## What a pack is

```ts
import type { StationPack } from "../pack.ts";

export default {
  key: "pepe",                         // the station key: a-z 0-9 "-", 2..24 chars (not "idm" / "imd-eth")
  name: "Pepe Night Shift",            // 1..40 chars
  genres: ["liquid", "triphop", "acid"],   // 1 or more distinct genres from those below
  styles: {                            // for every genre in `genres` (and no other): 1..10 styles, in play order
    liquid: [{ id: "pepe-keys", name: "Pepe Keys", base: "classic", leads: ["pepe-ep"], data: { /* tables, sound */ } }],
    triphop: [/* ... */],
    acid: [/* ... */],
  },
  patches: { "pepe-ep": { /* optional: your own lead patches, LeadPatch shape (below) */ } },
} satisfies StationPack;
```

How it plays: the station walks its genres one epoch each, the first cycle in the listed order, then shuffled
cycles (never the same genre twice in a row, unless the pack names one genre: then it plays every epoch). Each
appearance of a genre plays one style for its whole epoch; a genre's appearances walk its styles in order, round
and round.

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
  triphop 66..104, lofihouse 112..132, acid 108..140, dubtechno 112..130, electro 110..140, ambientidm 70..124,
  drone 40..100.
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
| `liquid` | `classic` Keys | `vamps` `stabs` `answers` `contours` `walks` (off by default) `kit` `fills` `sub` | `kit` `bass` `reese` `pad` |
| | `atmos` Atmospheric | `vamps` `phrases` `contours` `kit` `fills` `sub` | `kit` `bass` `reese` `pad` `choir` |
| | `soulful` Soulful | `progressions` (exactly 4 chords) `walks` `comps` `kit` `fills` `sub` | `kit` `bass` `reese` `strings` |
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
| `dubtechno` | `classic` Lucidflow | `chords` (merged over i9 i11 iv7 VI9 VII9 v7) `progressions` `figures` `accents` `stabBars` `bassline` `bells` `percs` `claps` `hats` | `kit` `subTone` `stabTone` `padTone` `bellTone` `sweep` `field` `rumble` `echoTone` `melody` |
| | `ixtlan` Ixtlan | the same | the same |
| | `moment` The Moment | the same | the same |
| `electro` | `classic` Cold 808 | `kicks` `arps` `seq` `metal` `jitter` | `kit` `bassTone` |
| | `client03` Client_03 | `chords` `progressions` (4 indices, 2 bars a chord) `kicks` `ghosts` `warps` `chops` `riffs` `answers` `words` `seq` `metal` `jitter` | `kit` `bassTone` `pad` `voice` |
| | `alienrave` Alien Rave | `chords` `progressions` (4 indices, 1 bar a chord) `kicks` `opens` `lines` `stabs` `arpCells` `calls` `words` `seq` `metal` `jitter` | `kit` `bassTone` `hoover` `vox` |
| `ambientidm` | `classic` Tape Keys | `chords` `progressions` (4 bars a chord) `figures` `tiers` | `kit` `pad` `line` |
| | `boc` Tape Haze | `chords` `progressions` `phrases` `tiers` `notes` | `kit` `pad` `bass` `lead` |
| | `crystal` Crystal | `chords` `progressions` `arps` `tiers` `notes` | `kit` `line` `glass` `bell` `shimmer` |
| `drone` | `classic` Wall | `bars` `voicing` `colours` `busy` `glints` | `wall` `glint` `breath` `swell` |
| | `dark` Dark Low | `bars` `voicing` `busy` `glints` | `pad` `bed` `kick` `glint` `rumble` |
| | `pulse` Overtone Pulse | `bars` `glints` (harmonic numbers) `partials` `figures` | `overtone` `glint` `swell` |

The shapes in short (full rules in `styledata.ts`):

- `vamps`: `[{ a: { pad, root }, b: { pad, root } }]` — two chords; `pad` 2..6 tones -12..26 over the pad root (at
  least two in 0..12), `root` -12..12 over the bass tonic.
- `stabs` / `phrases` / `comps` / `cuts` / `choirs` / `walks` / `chops`: figures of `{ s, len, core }` (+ `swell`,
  `oct` 0|1, `slice` 0..3 where the genre says).
- liquid `walks`: `{ s, len, oct, core, semi? }` over two bars; `semi` -12..12 moves the note off the chord root (left
  out: the root; keep to roots, fifths and octaves so it fits every chord). Keys (`classic`) plays no walk unless the
  style gives one: then the walk replaces its rolling sub on the chain's bass onsets. Reference: `hamster-dnb.ts`.
- liquid `reese` (every base, off by default): `{ level, detune, drive, cutoff, q, depth, rate }`, Dark Sub's
  detuned saw pair an octave over every sub note, driven, through a lowpass wobbling `rate` cycles per beat by
  `depth`; `level` 0 = off, 1 = Dark Sub's level (0..1.5). Values when on: `engine.ts` `LIQUID_REESE`.
- `kit` (liquid): any of `kick` (synth kick spec), levels, `snare` "keys" | "soft" | "soul", hat voices, `crash`, and
  `breaks`: lanes of 32 characters, "." rest or 1-9 velocity in ninths (`kick` `snare` `ghost` `hat` `open`).
- `kicks`: `{ lo, mid, hi }` lists of one-bar kick figures (steps 0..15) for a quiet, medium and busy kick row.
- `progressions`: liquid soulful: 4 chords `{ pad, root }`; futuregarage: indices into `chords`; triphop: 4 chord names.
- `lines` (acid): 16 steps, each `null` (rest) or `{ degree 0..4, octave -1..1, flags (1 accent + 2 slide +
  4 ornament), gate? 16ths }`; at least 4 notes.
- `sub`: the sub level 0..1 (futuregarage up to 1.2).
- futuregarage `ukg` (classic only, off by default): the UK garage voices, an energetic synth 2-step in place of
  Vocal Chops when `ukg.level` > 0 (styledata.ts `UkgSpec`: `stab`, `organ`, `sub`, `mid`, `drop2`, `pluck`, `vox`,
  `lead`, `groove`, `bars`). It reads `kicks` `skips` `chords` `progressions` `vowels` `kit` and its own figures
  `stabs` (hits with a velocity), `basslines` (semitones over the chord's bass), `motifs` and `calls` (chord tones),
  which need `ukg` on. Every chord tone and bass note must be in the natural minor over the tonic (7ths, 9ths, sus and
  6/9 voicings are fine). Reference: `hamster-ukg.ts`, `imd-dark.ts`; docs/STATIONS.md "UK garage voices".
- futuregarage `ornament` (every base; not Dark Sub's `foley` ticks): the attention layer's mention voices, what a
  mention of the token plays: `{ voices, smart, foley, level, slots }` over the base's preset. `voices` / `smart` 1..4
  of `"reverse"` (an "aah" and a noise wash swelling from the step into the next 0 or 8, cut there), `"foley"` (one
  object; smart: the lighter with its flame), `"groove"` (a ghost rim + a shuffled hat; smart: a rising ghost snare
  roll), `"yeah"` (the same vocal "yeah" on the tonic, 3 16ths), each once, all played every mention; `foley` 1..3 of
  `"lighter"` `"drop"` `"vinyl"` in turn; `level` 0..1.6 (1 = the preset); `slots` 1..8 of 0..15. Presets: Vocal
  Chops a "yeah" on 6 / 14 (smart + the roll), Dark Sub groove + lighter / vinyl on 3 / 11 (smart: reverse + flame),
  Rain Atmos a drop on 3 / 11 (smart: reverse). Silent without mentions; a quiet reaction, never a melody.
- liquid `ornament` (every base): the attention layer's mention voices: `{ voices, smart, nature, level, slots }` over
  the base's preset. `voices` / `smart` 1..3 of `"nature"` (one far-away sound; smart: two birds answering, a beat
  apart), `"amen"` (a soft ghost snare; smart: a rising four-hit roll on 32nds), `"keys"` (one note of the style's
  keys on the chord's top, fast attack; smart: a dyad), each once, all played every mention; `nature` 1..3 of
  `"bird"` `"gust"` `"drop"` in turn; `level` 0..1.6 (1 = the preset); `slots` 1..8 of 0..15. Presets: Keys nature
  (bird, gust, drop) on 2 / 10 (smart: two birds), Soulful an amen ghost on 3 7 11 15 (smart: the roll + two birds),
  Atmospheric a key note on the offbeats (smart: a dyad). Silent without mentions; far away or under the break.
- dubtechno: `progressions` `[{ bars, seq: ["i9", "VI9", ...] }]` (chord names, `bars` each); `chords`
  `{ name: { root, upper } }` (your own names next to the house ones); `figures` the stab's steps in a bar (0..15; the
  last hit is the answer a busy chain adds) with `accents` their levels; `stabBars` the figure's level per bar of a
  1..16-bar cycle (0 rests it: `[1, 0, 0, 0]` = one bar in four, the echo carries the rest; left out, every bar plays);
  `bassline` `[[step, length, level, interval?]]` per bar; `bells` four-bar fragments `[[16th 0..63, tone from the top, level]]`; `percs` the two-bar
  percussion `[[16th 0..31, pitch ratio (1 tonic, 1.5 fifth), level]]`; `claps` the clap's (or rim's) two-bar placement
  `[[16th 0..31, level]]` (left out: 2 and 4; `[[12, 1], [28, 1]]` = the 4 only); `hats` the hat's two-bar placement
  `[[16th 0..31, level, decay?]]` (left out: every offbeat; `kit.hat.off` still scales it, a long `decay` opens it).
- electro: `kicks` `{ half, lo, mid, hi }` lists of **two-bar** kick figures (onsets 0..31; `half` plays in the intro);
  `arps` (classic) 1..3 semitones the bass cycles through; `chords` `[{ bass, tones, third?, seventh? }]` with
  `progressions` of 4 indices (give 6+ chords or your own progressions); `riffs` (client03) two-bar bass notes
  `{ s, semi, len, f }` (f: 1 accent, 2 slide, 4 ornament, 8 dead note); `answers` (client03, opt-in) the style's
  `leads` answering riff i with answer i, two-bar `{ s, semi over the tonic, len, core }`; `lines` (alienrave) 6..16 steps of `null` or
  `[semi, flags]`; `ghosts`, `stabs` two-bar `{ s, ... , core }` figures; `warps` 16 hat pitch multipliers; `chops`
  `{ open, steps }`; `opens` open-hat steps; `arpCells` chord-tone indices; `words` / `calls` the computer voice's
  syllables `[F1, F2, consonant]` (1..8; alienrave speaks only when given words) and the robot's vowels `[F1, F2]`;
  `seq` (every base, off unless given) a polymetric sequence on the style's lead patch `{ notes 3..16 (semitones or
  null), rate 1..4 16ths, octave, follow, gate, level, accent, evolve }`; `metal` (every base) FM metal percussion on its
  own cycle `{ steps 3..16 levels, freq, ratio, index, decay, level, pan, jitter }`; `jitter` `{ hat, ghost }` ms 0..15
  late (the kick and the snare stay on the grid); `ornament` (every base) the attention layer's
  robot word, the voice a mention of the token plays: `{ vowels [[F1, F2]] 1..4, wave, steps 2..16 (crush), octave
  -24..24, syllable 0.5..4 16ths, ring 0..4, lowpass 0..12000, echo { steps, feedback } | null, level 0.01..0.1, slots }`
  over the base's preset (Cold 808 dark dry "oh-oo", Client_03 "ah-ee", Alien Rave ring-modulated and echoed). It is
  silent without mentions; make it the station's own robot, a quiet answer between the kicks.
- `chords` (ambientidm): `[{ bass, pad, glass, arp, sing }]`, 2..8 chords in the minor pentatonic: `pad` over the pad
  root (Tape Haze plays the tones at and above 0), `glass` Crystal's bed an octave up, `arp` the four chord tones
  low to high, `sing` the melody roles `[3rd, 5th, colour, root, 7th]`. `progressions`: indices into `chords`.
- `figures` (Tape Keys, two bars): `[step 0..31, arp tone 0..6, tier 0..2]`; `phrases` (Tape Haze, eight bars):
  `[step 0..127, sing role 0..4, length 1..32, octave -1..1, tier 0..2]`; `arps` (Crystal): cells of chord-tone
  indices 0..8. Tier 0 always plays; `tiers: [low, high]` (0..1) is how busy the chain must be for tiers 1 and 2
  (Crystal: for the arp to go from quarters to eighths to sixteenths). `notes`: the pool of the blips / micro-edits.
- `bars` (drone): phrase length, 2..16 bars (a new layer each phrase). `voicing` / `colours`: the pad's tones
  (Wall over the pad root, alternating the voicing with a colour; Dark Low over the bass tonic); `busy` the tone a
  busy chain adds. `glints`: the bell pitches (Overtone Pulse: harmonic numbers 2..16 of its series). `partials`:
  `[{ n 1..16, g level, group 0..3 }]`, the series Overtone Pulse breathes through; `figures`: which phrases bring
  its just fifth in (0/1).

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
| `liquid` | `kit` (now also `snare` as your own layers, hats with `crush`), `bass` (all), `reese` (all, off unless `level` > 0), `pad` (classic, atmos), `choir` (atmos), `strings` (soulful) |
| `futuregarage` | `kit` `{ kick, snare, ghost, hat, shaker, open }`, `bass`, `reese` (dark), `pad` (classic, atmos), `choir` (dark, atmos), `vowels` (classic chops), `rain` |
| `triphop` | `kit` `{ kick, snare, drag, hat, open }`, `bass`, `bassTone` (bristol, cinematic), `bowed` (the strings) |
| `lofihouse` | `kit` `{ kick, clap, snare, hat, open, shaker }`, `bass`, `organTone` + `pad` (rave), `chop` + `pump` (chop) |
| `acid` | `kit` `{ kick, clap, snare, hat, open, perc }`, `voice` (the 303: `wave` saw/square, `cutoff`, `envMod`, `resonance`, `decay`, `drive`, `level`, `accent`, `gate`, `sweep`; optional and off by default `sub` 0..1, a softly rounded sine under the line in the bottom octave E1..D#2 at that share of the 303's level, sliding with it and ducked by the kick) |
| `dubtechno` | `kit` `{ kick: { center, rise, sweep, hold, decay, drive, lp, click, clickHz, level }, clap: { level, hz, decay, rim }, hat: { off, decay, hp, metal, shaker, shakerDecay, shuffle }, perc: { level, decay } }` (each voice merged field by field); `subTone` `{ level, octave, lp, attack, release, drive }`; `stabTone` `{ wave, detune, lp, env, envTime, q, hp, attack, release, gain, pan, move, octave }` plus, optional and off by default, a second oscillator per tone `wave2` (a wave or `"pulse"` of `width` 0.05..0.5) at `mix2` 0..1.5, `octave2` -12..24, and `velLp` 0..1 (the figure hit's level opens or darkens the cutoff), and the voice `engine` `"osc"` (default) / `"fm"` / `"pluck"`: `fm` `{ ratio 0.5..12, index 0..12, floor 0..1, decay 0.01..2, ratio2 0.5..16, index2 0..12, decay2 0.005..1, vel 0..1 }` (a sine modulator into two detuned sine carriers per tone, its index falling over `decay`; the second modulator off unless `index2` > 0), `pluck` `{ modes: 1..4 ratios 0.5..16, decay 0.05..4, damp 0..2, tone 200..10000, burst 0.0002..0.005, vel 0..1 }` (a mallet click strikes a resonator per tone and mode, each ringing `decay` x (1 / ratio)^`damp` s); `padTone` `{ level, wave, detune, octave, lp, attack, release }` and an optional `hp` 20..1000 Hz; `bellTone` `{ level, every, ratio, index, decay }`; `sweep` `{ stab, echo }` bars per filter open-close, and the echo's breath `send` / `fb` 0..1 (how far the level into the echo / of its repeats dips) over `breath` bars (default `echo`); `field` `{ level, hz }` the rain; `rumble` `{ level, lp, decay, duck }` the techno rumble (the kick into its own dark room, ducked by the kick; off unless `level` > 0); `echoTone` `{ width, alt, wobble, rate }` the echo's shape (repeats panned `width` 0..1, house 0.55; `alt` 1..8 16ths for the odd repeats = a ping-pong of two times; `wobble` 0..1 a tape wobble of up to 3 ms at `rate` Hz); `melody` `{ level, wave, detune, octave, notes?, every, count, chance, attack, hold, release, lp, echo, space }` a sparse melody of rare single notes (off unless `level` > 0: `count` notes in a cell of `every` bars with probability `chance`, pitches from `notes` or the bar's chord, a whale buy answers with one). The echo is `fx.echo` (`steps` 3 = dotted 8th, up to 12 `taps`, `fb` < 0.75) |
| `electro` | `kit` `{ kick, snare: "808" \| "client" \| "alien" \| layers, ghost (client03), hat: { hp, decay, metal, q }, open: { hp, decay, metal, q, level, crush? }, accents: [on, e, and, a] }`; `bassTone` `{ osc, cutoff, color, q, open, decay, drive, level, sub, glide, fm, ratio }` (pairs `[plain, accent]`; classic reads `cutoff color q decay level sub`; `osc` types may be "pulse25" / "pulse12"; `ratio` the alienrave FM ratio, default 2); `pad` (client03); `voice` `{ pitch, bits, hp, lp, level }` (client03's speak-and-spell); `hoover` `{ cutoff, color, q, hp, bend, detune, level }` and `vox` `{ ring, level }` (alienrave) |
| `ambientidm` | `kit`: each base its own parts (classic `{ kick, snare, hat }`, boc `{ kick, thump, snare, dust, ghost, hat, open }`, crystal `{ click, rim, crack, tick, hat, open }`), `pad` (classic, boc), `bass` + `lead` (boc), `line` (classic, crystal), `glass` + `bell` + `shimmer` (crystal) |
| `drone` | `wall` (classic) / `pad` (dark) the breathing layers, `bed` (dark: the beating subs), `overtone` (pulse), `glint` (all), `kick` (dark's concussion), `breath` (classic), `rumble` (dark), `swell` (classic, pulse) |

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
- **ambientidm voices**: `bass` `{ osc, cutoff, level, sub }` and `lead` `{ osc: [{ type, oct, detune, level }],
  cutoff, level, scoop (cents into each note), vib }` (Tape Haze's cassette); `line` `{ level, cutoff, osc }` (the slow
  high note); `glass` `{ level, partials: [{ type, ratio, detune, level }], cutoff, hp, attack, release }` (Crystal's
  bed), `bell` `{ level, ratio, index, decay }` (an FM bell: 3.49 glass, integers a music box), `shimmer` `{ level,
  partials: [{ ratio, detune, level }], decay, short }` (the arp's ring on eighths / sixteenths). Crystal's `crack` and
  `tick` are `{ noise, freq, q, decay, level }`, its `rim` `{ level, pitch }`.
- **drone voices**: `wall` / `pad` `{ level, waves (per voice, low to high), detune, spread, cutoff, glow, range,
  period }` (+ Wall's `depth`, `drift`, `core`): detuned pairs through a lowpass breathing from `cutoff` to `range`
  times it every `period` s. `bed` `{ subLevel, bodyLevel, subs, body: [[semitones, cents, level]], beat, drive,
  cutoff }`: sine pairs a few cents apart beat against each other (`beat` scales the cents). `overtone` `{ level,
  cutoff, glow, depths: [4 groups] }`. `glint` `{ level, decay, attack, top, gap (beats between glints) }`. `breath`,
  `rumble`, `swell`: levels of the noise breath, the cave rumble and the rare sub swell (0 = none).

### Taste

- **Keep the genre recognisable.** Liquid stays a fast rolling break with a sub; trip-hop slow and heavy; acid a
  303 over four-to-the-floor; dub techno a round four-on-the-floor kick under minor chord stabs into the echo; electro
  a syncopated 808 break (never four-on-the-floor) and a machine bass; ambient IDM soft chords over a dusty pocket with
  a few long notes; the drone beatless, held and slowly breathing (no fast `period`, no busy glints). Change the
  producer, not the genre: kick and snare character, the keys' patch, the room, the grit.
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

Known: the house Tape Haze (`ambientidm` base `boc`) renders differently on two runs in Chromium even with no data, so
every style on that base fails the determinism check for now. Use `classic` or `crystal` for ambientidm until it is
fixed on our side.

To hear what you changed, `node web/scripts/station-ab.mjs <key>` writes `sim/stations/<key>/ab-house-vs-pack.wav`:
for each style, 20 s of its house base then 20 s of your style, same key, same tape. If the two halves sound like the
same producer, push the sound fields further.

## Frozen once live

When a station is on air, its history is frozen like the house's (bot posts and recordings name the genre and
style): never edit, remove or reorder a style that has played, never change what an id sounds like. To change the
sound later, add styles with new ids; the program grows by appended entries from a future epoch (`program.ts`),
which we do on our side. Before launch, revisions may change anything.
