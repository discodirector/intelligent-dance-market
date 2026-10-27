/**
 * Style data: the tables a style renderer in engine.ts plays from, opened to overrides (docs/STATIONS.md "Style
 * pack"). A style names the renderer it uses (`GenreStyle.base`, default its own id) and may replace any of that
 * renderer's tables with `GenreStyle.data`; a field left out keeps the house table, so a style with no `data`
 * renders exactly like its base. House styles carry no data: their sound is the default tables in engine.ts.
 *
 * This file is the swarm's contract (packages/synth/src/stations/README.md): every field says which bases read it,
 * its shape, units and valid range, and pack.ts validatePack checks exactly these rules. Common conventions:
 *   - steps are 16ths. A "two-bar figure" has onsets 0..31, a "four-bar figure" 0..63; `len` is in 16ths
 *     (fractions allowed). `core` notes play even in a quiet market; the others need the chain's glitch row.
 *   - a table is a LIST of alternatives: each genre instance (epoch) picks one entry by hash, so 1..N entries.
 *   - pitches are semitones; "pad root" is the genre's pad register (about E3..D#4) on the instance tonic, "bass
 *     tonic" the sub register (E1..D#2). Every genre has a fixed note set (eras.ts `notes`); stay inside it.
 */

/** Drum synth kick: a sine (or `osc`) swept from `start` to `end` Hz. */
export interface KickSpec {
  osc?: OscillatorType;
  /** Start pitch, Hz. 40..250. */
  start: number;
  /** End pitch, Hz. 30..120. */
  end: number;
  /** Pitch sweep time, s. 0.005..0.2. */
  sweep: number;
  /** Body decay, s. 0.05..1. */
  decay: number;
  /** Click level. 0..1. */
  click: number;
  /** Click highpass, Hz. 500..8000. */
  clickHp?: number;
  /** tanh drive on the body (per hit). 0..4. */
  drive?: number;
  /** Body level. 0..1.5. */
  body?: number;
}

/** A note or hit on the step grid: onset `s` (16th), length `len` (16ths). */
export interface StepNote {
  s: number;
  len: number;
}
/** A step note that plays in a quiet market when `core`; the others need the chain's glitch row. */
export interface CoreNote extends StepNote {
  core: boolean;
}

/** A chord: pad voicing (semitones over the pad root, low to high) over the sub's root (semitones over the bass tonic). */
export interface PadChord {
  /** 2..6 tones, each -12..26. */
  pad: number[];
  /** -12..12. */
  root: number;
}
/** Two chords the pad alternates between (a vamp). */
export interface Vamp {
  a: PadChord;
  b: PadChord;
}

/**
 * Kick figures by how busy the chain's kick row is: `lo` (1-2 kicks), `mid` (3-4), `hi` (5+). Each tier is a list
 * of one-bar figures (onset steps 0..15, ascending, 1..6 per figure); the instance picks one per tier.
 */
export interface KickFigures {
  lo: readonly (readonly number[])[];
  mid: readonly (readonly number[])[];
  hi: readonly (readonly number[])[];
}

// ----------------------------------------------------------------------------------------------------- sound
//
// Sound fields: the drum timbres, synth patches, effects and mix of a base, opened to data so a station can sound
// like another producer. Every genre reads `mix`, `fx` and `vinyl` on every base; its kit and voices are listed per
// genre below. The house values of every field are SOUND_DEFAULTS in engine.ts (per genre and base): copy one, change
// a few numbers. An object field you give is merged over the base's (leave out what you keep); a list replaces.

/** The mix buses every voice plays into. */
export const BUS_NAMES = ["kick", "snare", "hat", "perc", "bass", "harm", "lead", "tex", "fx"] as const;
export type BusName = (typeof BUS_NAMES)[number];

/** An oscillator wave. */
export type Wave = "sine" | "triangle" | "square" | "sawtooth";

/** Per-bus level trims in dB, -6..6 (0 = the house level). harm = pads/chords, tex = vinyl/rain, fx = risers/throws. */
export type MixTrims = Partial<Record<BusName, number>>;

/**
 * Effects of the style: the genre's sends, rooms and master, merged over the genre's (engine.ts MIX). Echo and room
 * are fed post bus level; the echo also feeds the room a little.
 */
export interface FxData {
  /**
   * Tempo-synced echo, a chain of feed-forward taps: `steps` delay in 16ths (integer 1..8), `taps` 1..12 repeats,
   * `fb` level of each repeat after the first 0..0.75, `lp` 400..8000 Hz and `hp` 80..1500 Hz per repeat (each
   * repeat is darker and thinner than the last, like a dub delay).
   */
  echo?: { steps?: number; taps?: number; fb?: number; lp?: number; hp?: number };
  /** Bus -> echo send, 0..1 per bus (0 = none). */
  echoSend?: Partial<Record<BusName, number>>;
  /** The room: `size` scales its taps' times 0.4..2.5 (bigger = longer, sparser), `fb` its tail 0..0.85, `lp` its darkness 800..9000 Hz. */
  space?: { size?: number; fb?: number; lp?: number };
  /** Bus -> room send, 0..1 per bus (0 = dry). */
  spaceSend?: Partial<Record<BusName, number>>;
  /** Lowpass on the whole drum kit (kick, snare, hat, perc), Hz 1500..18000 (18000 = open, 6000 = behind a wall). */
  drumLp?: number;
  /** Master saturation: drive into the master tanh stage 0.8..1.8 (1 = clean), and how much buy pressure adds 0..0.6. */
  drive?: number;
  pressDrive?: number;
  /** Kick sidechain depth on the bass and the harmony: gain at the kick 0.1..1 (1 = no duck; bass at least 0.1, harm 0.3). */
  duck?: { bass?: number; harm?: number };
  /** Sidechain recovery, s 0.05..0.6. */
  duckTime?: { bass?: number; harm?: number };
  /**
   * Master inserts after the saturation: `lp` a lowpass 2000..18000 Hz (a dark, tape-like top), `hp` the master
   * highpass 20..200 Hz (thins the low end), `crush` a bit crusher 6..12 bits (6 = gritty sampler, 12 = faint).
   */
  master?: { lp?: number; hp?: number; crush?: number };
}

/** The fields every base of every opened genre reads. */
export interface SoundData {
  /** Bus level trims, dB. */
  mix?: MixTrims;
  /** Sends, room, echo, drum filter, saturation, sidechain, master inserts. */
  fx?: FxData;
  /** Vinyl hiss and crackle level 0..2.5 (0 = none). Default per base (SOUND_DEFAULTS; liquid and acid 0). */
  vinyl?: number;
}

/** A hat: highpassed noise plus a metal ring. */
export interface HatSpec {
  /** Highpass, Hz 1000..14000 (lower = thicker). */
  hp: number;
  /** Decay, s 0.005..1 (about the -20 dB time). */
  decay: number;
  /** Metal ring level 0..1. */
  metal: number;
  /** Highpass resonance 0.3..4 (default 0.7; a crushed hat 0.9). */
  q?: number;
  /** Level 0..1.5 (the chain's hat velocity scales it). */
  level: number;
  /** Level on the off 16ths where the base tells them apart, 0..1.5. */
  off?: number;
  /** A crushed hat (old sampler): bits 3..8; no metal ring. */
  crush?: number;
}

/** Drum layer fields every kind shares. */
interface LayerBase {
  /** Level 0..1.5. */
  level: number;
  /** Offset from the hit, s 0..0.08 (flams, clap bursts, drag). */
  at?: number;
  /** Decay scales with the hit's length (ghosts and rolls are short); off = the same decay on every hit. */
  tail?: boolean;
  /** Pan: the hit's own pan unless set (-1..1, fixed), `flip` mirrors the hit's pan. */
  pan?: number;
  flip?: boolean;
  /** Plays only on the base's accented hits (backbeats); ghosts leave it out. */
  accent?: boolean;
}
/** A pitched body: `tone` wave from `freq` (Hz 30..4000) falling to `to` over `sweep` s, decay s 0.005..2, attack s. */
export interface ToneLayer extends LayerBase {
  tone: Wave;
  freq: number;
  to?: number;
  sweep?: number;
  decay: number;
  attack?: number;
  /** Added to the decay of a `tail` layer, s 0..0.2. */
  floor?: number;
}
/**
 * A filtered noise burst: `noise` filter type at `freq` Hz 100..16000 (optionally sweeping to `to`), resonance `q`
 * 0.3..12, decay s 0.005..3, attack s 0..2. `color` adds Hz per unit of the pool-tick colour (0..4000); `press`
 * moves the filter with buy/sell pressure (freq * (1 + press * pressure), 0..0.5).
 */
export interface NoiseLayer extends LayerBase {
  noise: "bandpass" | "highpass" | "lowpass";
  freq: number;
  to?: number;
  q: number;
  decay: number;
  attack?: number;
  color?: number;
  press?: number;
}
/**
 * A bit-crushed noise crack (a sampled break): `crush` bits 3..8, through a `filter` at `freq` Hz 200..12000 (q
 * 0.3..4). Without `lp` the crusher sits after the level (quiet hits crush harder); with `lp` (Hz 1000..16000) it
 * sits before it and a lowpass follows (a sampler's even grit).
 */
export interface CrushLayer {
  crush: number;
  filter: "bandpass" | "highpass";
  freq: number;
  q?: number;
  decay: number;
  level: number;
  at?: number;
  tail?: boolean;
  lp?: number;
}
/** The house clap (three bandpassed bursts) inside another voice, at `clap` level 0..1.5. */
export interface ClapLayer {
  clap: number;
  at?: number;
  flip?: boolean;
}
export type DrumLayer = ToneLayer | NoiseLayer | CrushLayer | ClapLayer;
/** A synthesised drum hit (snare, clap, rim, perc): 1..6 layers fired together, in order. */
export type DrumVoice = readonly DrumLayer[];

/** A shaker: one bandpassed noise burst on the chain's hat row. `off` / `offDecay`: the off 16ths, where the base tells them apart. */
export interface ShakerSpec {
  /** Hz 2000..14000; `color` adds Hz per unit of the pool-tick colour 0..4000. */
  freq: number;
  color?: number;
  /** 0.3..6. */
  q: number;
  /** s 0.005..0.3. */
  decay: number;
  offDecay?: number;
  /** s 0..0.05. */
  attack: number;
  /** 0..1. */
  level: number;
  off?: number;
}

/** The sine sub under a base: `wave` sine | triangle, attack s 0.002..0.1, `hold` the part of the note held 0.3..1. */
export interface SubSpec {
  wave: "sine" | "triangle";
  attack: number;
  hold: number;
  /** tanh drive 0..4 (0 = clean): a triangle or sine pushed into harmonics that cut through small speakers. */
  drive: number;
  /** The octave-up layer some bases add over the sub, 0..0.5 (0 = none). */
  octave: number;
}

/** One oscillator of a pad stack, per chord tone: wave, detune in cents -40..40, level 0..1. */
export interface PadOsc {
  type: Wave;
  detune: number;
  level: number;
}
/**
 * A pad, string, choir or chord-sample voice. Each voice reads the fields its sound has (listed per genre); the
 * market still moves the filter over `cutoff` (pool tick colour, heat, sell pressure).
 */
export interface PadSpec {
  /** 1..4 oscillators per chord tone. Saws are bright and wide, triangles and sines soft. */
  osc: readonly PadOsc[];
  /** Base lowpass, Hz 150..8000. */
  cutoff: number;
  /** Filter resonance 0.3..6. */
  q: number;
  /** Attack, s 0.003..8 (most voices also cap it to part of the chord). */
  attack: number;
  /** Release after the chord, s 0.05..6. */
  release: number;
  /** Peak level 0.005..1 (per voice: see SOUND_DEFAULTS; double it = +6 dB). */
  level: number;
  /** Pitch wobble, cents 0..30 (tape wow or vibrato; 0 = steady). */
  vib: number;
  /** tanh drive 0..4 (chord samples). */
  drive?: number;
  /** Breath or hiss level 0..1. */
  noise?: number;
  /** Highpass, Hz 20..1000. */
  hp?: number;
}

// ---------------------------------------------------------------------------------------------------- liquid

/** A liquid hat voice: a HatSpec with its pan -1..1. */
export interface LiquidHat extends HatSpec {
  pan: number;
}
/**
 * A liquid break over two bars: one lane per voice, 32 characters, a digit per 16th = velocity in ninths, "." a
 * rest. kick: digits under 5 are pickups (busy kick row only). snare: 7+ is a backbeat, less a flam. ghost: the
 * chopped break layer under the kit; 1-2 only with a busy chain or on the turn bar. hat: even 16ths are the hat,
 * odd ones the shaker. open: open hat / tambourine accents ("" = none).
 */
export interface LiquidBreakLanes {
  kick: string;
  snare: string;
  ghost: string;
  hat: string;
  open: string;
}
export interface LiquidKit {
  kick: KickSpec;
  /** 0..2. */
  kickLevel: number;
  /** Snare voice: "keys" bright crack, "soft" round and roomy, "soul" warm rimshot, or your own layers (LIQUID_SNARES). */
  snare: "keys" | "soft" | "soul" | DrumVoice;
  /** 0..2. */
  snareLevel: number;
  /** 0..1. */
  ghostLevel: number;
  hat: LiquidHat;
  shaker: LiquidHat;
  open: LiquidHat;
  /** Crash on the first bar of every eight. 0..0.5. */
  crash: number;
  /** 1..4 breaks; the instance picks one. */
  breaks: readonly LiquidBreakLanes[];
}

/** Liquid DnB. Bases: "classic" (Keys), "atmos" (Atmospheric), "soulful" (Soulful). */
export interface LiquidData extends SoundData {
  /** classic, atmos. Two-chord vamps (classic: four bars a chord; atmos: eight). 1..6. Default LIQUID_VAMPS. */
  vamps?: readonly Vamp[];
  /** classic. Keys stabs over four bars (onsets 0..63), never on a downbeat. 1..6 figures of 1..12. Default LIQUID_STABS. */
  stabs?: readonly (readonly CoreNote[])[];
  /** classic. The Rhodes answer in bar 7 of 8: one bar, onsets 0..15, 1..4 notes. 1..6. Default LIQUID_ANSWERS. */
  answers?: readonly (readonly StepNote[])[];
  /** classic, atmos. Steps through the chord's tones (0 = lowest), one per phrase note: 4..16 values 0..7. Default LIQUID_CONTOURS. */
  contours?: readonly (readonly number[])[];
  /** atmos. Lead line over four bars (onsets 0..63), played in bars 5-8 of each eight. 1..6 figures of 1..12. Default LIQUID_ATMOS_PHRASES. */
  phrases?: readonly (readonly CoreNote[])[];
  /** classic, atmos, soulful. The drum kit and its breaks; fields left out keep the base's kit (LIQUID_KITS). */
  kit?: Partial<LiquidKit>;
  /** classic, atmos, soulful. Fills for steps 8-15 of every eighth bar: 8-character lanes. 1..6. Default LIQUID_FILLS. */
  fills?: readonly { kick: string; snare: string }[];
  /** classic, atmos, soulful. Sub level, 0..1. Default LIQUID_SUB[base]. */
  sub?: number;
  /** soulful. Four-chord progressions, two bars a chord: exactly 4 chords each. 1..6. Default LIQUID_SOUL_PROGS. */
  progressions?: readonly (readonly PadChord[])[];
  /**
   * soulful, classic. Sub walks over one chord (two bars, onsets 0..31); `oct` 0 or 1 = an octave up, `semi` -12..12
   * semitones over the chord root (left out: the root). 1..6 of 1..12. Soulful default LIQUID_SOUL_BASS; classic
   * left out keeps its rolling sub on the chain's bass onsets, given plays the walk on each vamp chord instead.
   */
  walks?: readonly (readonly (CoreNote & { oct: number; semi?: number })[])[];
  /** soulful. Rhodes comping over one chord (onsets 0..31; a hit on 30+ plays the next chord early). 1..6 of 1..10. Default LIQUID_SOUL_COMP. */
  comps?: readonly (readonly CoreNote[])[];
  /** classic, atmos, soulful. The sub's voice (classic: `octave` 0.14 is its octave layer). */
  bass?: Partial<SubSpec>;
  /**
   * classic, atmos, soulful. A reese over the sub, off by default (`level` 0): a detuned saw pair an octave up on
   * every sub note, driven, through a lowpass that may wobble in time (LiquidReeseSpec; the values when on are
   * engine.ts LIQUID_REESE).
   */
  reese?: Partial<LiquidReeseSpec>;
  /** classic, atmos. The tape pad (reads osc, cutoff, q, attack, release, level, vib = wow depth). */
  pad?: Partial<PadSpec>;
  /** atmos. The airy formant choir over the pads (reads osc, cutoff, q, attack, release, level, vib). */
  choir?: Partial<PadSpec>;
  /** soulful. The string swells (reads osc, cutoff, q, attack, release, level, vib; the swell takes 55% of the chord unless `attack` is shorter). */
  strings?: Partial<PadSpec>;
  /**
   * classic, atmos, soulful. The attention layer's mention voices (engine.ts liquidMention), merged field by field
   * over the base's preset (LIQUID_ORNAMENTS). Only plays on a mention of the token.
   */
  ornament?: Partial<LiquidOrnamentSpec>;
}

/** The liquid reese (LiquidData.reese): Dark Sub's reese voice on the liquid sub notes. */
export interface LiquidReeseSpec {
  /** Level 0..1.5: 0 = off (the house), 1 = the house reese level (Dark Sub's). */
  level: number;
  /** Saw detune, ± cents 0..40. */
  detune: number;
  /** tanh drive 0.1..5. */
  drive: number;
  /** Lowpass base Hz 60..1200 and resonance 0.3..8. */
  cutoff: number;
  q: number;
  /** Wobble depth, a share of the cutoff 0..1 (0 = a still filter). */
  depth: number;
  /** Wobble cycles per beat 0.0625..4. */
  rate: number;
}

/** A liquid mention voice: nature far away, an amen ghost snare, one note of the style's keys. */
export type LiquidMentionVoice = "nature" | "amen" | "keys";
/** A far-away nature sound: a bird (two chirps), a gust of wind, a water drop. */
export type LiquidNatureKind = "bird" | "gust" | "drop";

/**
 * The liquid mention (attention layer: one per mention of the token). Every mention plays all of `voices`, a smart
 * one all of `smart`: "nature" one far-away sound of `nature` in turn (smart: two birds answering, a beat apart);
 * "amen" a soft ghost snare (smart: a quick four-hit roll on 32nds, rising); "keys" one note of the style's keys on
 * the chord's top, an octave over the stabs, with a fast attack so it speaks on its step (smart: a dyad).
 */
export interface LiquidOrnamentSpec {
  /** 1..3 distinct voices a mention plays. */
  voices: readonly LiquidMentionVoice[];
  /** 1..3 distinct voices a smart mention plays. */
  smart: readonly LiquidMentionVoice[];
  /** 1..3 distinct nature sounds, played in turn by plain mentions. */
  nature: readonly LiquidNatureKind[];
  /** Overall level 0..1.6 (1 = the preset, as the owner approved it by ear). */
  level: number;
  /** The bar's 16ths it may land on, 1..8 of 0..15. */
  slots: readonly number[];
}

// ---------------------------------------------------------------------------------------------- futuregarage

/** A Future Garage chord, semitones from the tonic. */
export interface GarageChord {
  /** Sub root, folded down into the bass register. -12..12. */
  bass: number;
  /** Pad voicing over 48 + tonic: 3..6 tones, each -12..26. */
  pad: readonly number[];
  /** Five chord tones low to high (kept for reference; no renderer reads it). */
  hook?: readonly number[];
  /** The guide tone the Vocal Chops counter-line holds over 60 + tonic (3rd or 7th, so the line moves by step). 0..24. */
  guide: number;
  /** Dark Sub choir: a plain open triad over 48 + tonic, 3 tones -12..26 with no seconds inside. */
  dark: readonly number[];
}

/**
 * A Future Garage kit. classic: `snare` the clap-on-a-body backbeat, `ghost` the skips, `shaker` the 16ths (`off`:
 * the off 8ths), `hat` the off-8th closed hat, `open` the open hat ending every fourth bar. dark: `snare` the crunch
 * (also on the chain's ghosts), `hat` the clicks on even 16ths, `shaker` the odd ones. atmos: `snare` the brushed
 * snap, `ghost` the chain's ghosts (default: the house rim), `shaker` the even 16ths, `hat` the odd ticks.
 */
export interface GarageKit {
  kick: KickSpec;
  snare: DrumVoice;
  ghost: DrumVoice;
  hat: HatSpec;
  shaker: ShakerSpec;
  open: HatSpec;
}

/** Dark Sub's reese: a detuned saw pair an octave over the sub, driven, through a lowpass that wobbles in time. */
export interface ReeseSpec {
  /** Saw detune, ± cents 0..40. */
  detune: number;
  /** tanh drive 0..5. */
  drive: number;
  /** Lowpass base Hz 60..1200 and resonance 0.3..8. */
  cutoff: number;
  q: number;
  /** Wobble depth, a share of the cutoff 0..1. */
  depth: number;
  /** Level 0..0.2. */
  level: number;
}

/** Future Garage. Bases: "classic" (Vocal Chops), "dark" (Dark Sub), "atmos" (Rain Atmos). */
export interface GarageData extends SoundData {
  /** classic, dark. The chord table progressions index into: 2..12 chords. Default GARAGE_CHORDS. */
  chords?: readonly GarageChord[];
  /**
   * classic, dark. Progressions as indices into `chords`, 1..8 chords each, 1..6 progressions. classic plays two
   * bars a chord, dark four. Default GARAGE_CHOP_PROGRESSIONS / GARAGE_DARK_PROGRESSIONS.
   */
  progressions?: readonly (readonly number[])[];
  /** classic. Ghost snares over two bars, [step 0..31, velocity 0..1], played in order as far as the chain's ghosts reach. 1..6 of 1..10. Default GARAGE_SKIPS. */
  skips?: readonly (readonly (readonly [number, number])[])[];
  /** dark. Foley ticks over two bars, [step 0..31, object 0..2], played in order as far as the density reaches. 1..6 of 1..10. Default GARAGE_FOLEY. */
  foley?: readonly (readonly (readonly [number, number])[])[];
  /** classic, dark, atmos. Kick figures. Default GARAGE_KICKS[base]. */
  kicks?: KickFigures;
  /** classic, dark, atmos. Sub level 0..1.2 (dark: the reese's sine). Default GARAGE_SUB[base]. */
  sub?: number;
  /** atmos. Two-chord vamps, four bars a chord. 1..6. Default GARAGE_VAMPS. */
  vamps?: readonly Vamp[];
  /** atmos. Choir chops and swells over two bars (onsets 0..31); a swell rises into its end and cuts. 1..6 of 1..10. Default GARAGE_CHOIRS. */
  choirs?: readonly (readonly (CoreNote & { swell: boolean })[])[];
  /** atmos. Steel pan over two bars (onsets 0..31), only on a busy glitch tier. 1..6 of 1..8. Default GARAGE_PANS. */
  pans?: readonly (readonly StepNote[])[];
  /** classic, dark, atmos. The drum kit, merged over the base's (GARAGE_KITS). */
  kit?: Partial<GarageKit>;
  /** classic, dark, atmos. The sine sub (classic, atmos: `octave` is the octave layer; dark: the sine under the reese). */
  bass?: Partial<SubSpec>;
  /** dark. The reese over the sub. */
  reese?: Partial<ReeseSpec>;
  /** classic, atmos. The pad (classic: the held warm pad, reads osc, cutoff, q, attack, release, level; atmos: the tape pad, also vib). */
  pad?: Partial<PadSpec>;
  /**
   * dark, atmos. The choir (dark: the far-off choir, reads osc, cutoff, hp, noise = breath, attack, release, level;
   * atmos: the chopped choir, reads osc, cutoff, level).
   */
  choir?: Partial<PadSpec>;
  /** classic. The vocal chops' vowels: formant pairs [f1 Hz 200..1200, f2 Hz 600..3000], 1..6; chops pick by index. Default GARAGE_VOWELS. */
  vowels?: readonly (readonly [number, number])[];
  /** classic, dark, atmos. The rain bed level 0..2.5 (0 = none). Default classic 0, dark 1, atmos 0.75. */
  rain?: number;
  /**
   * classic, dark, atmos. The attention layer's mention voices (engine.ts garageMention), merged field by field over
   * the base's preset (GARAGE_ORNAMENTS). Not the Dark Sub `foley` ticks above: this one only plays on a mention.
   */
  ornament?: Partial<GarageOrnamentSpec>;
  /**
   * classic. The UK garage voices (UkgSpec), off by default: with `ukg.level` > 0 the Vocal Chops renderer gives way
   * to the energetic synth 2-step (engine.ts garageUkg), which reads `kicks`, `skips`, `chords`, `progressions`,
   * `vowels`, `kit`, `stabs`, `basslines`, `motifs`, `calls` and the sound fields (`bass`, `pad` and `rain` are not
   * read; its sub is `ukg.sub`). Merged field by field over UKG_SPEC (engine.ts); `{ level: 0 }` (the house value)
   * builds nothing new, so every house style and older pack schedules exactly as before.
   */
  ukg?: UkgData;
  /**
   * classic, ukg only. Chord stab rhythms over two bars: 1..6 figures of 2..12 hits { s 0..31, len 0.25..8 16ths,
   * vel 0.1..1, core }. `vel` is the hit's velocity: it scales the stab's level, cutoff, filter envelope and drive,
   * so every chord sounds a little different. Non-core hits need the chain's glitch row. Default UKG_STABS.
   */
  stabs?: readonly (readonly UkgStab[])[];
  /**
   * classic, ukg only. Basslines over two bars: 1..6 lines of 2..16 notes { s 0..31, len 0.25..8, semi -12..24 over
   * the chord's bass (0 root, 12 the octave jump, 7 the fifth), vel 0.1..1, core, glide? (slide in from the last
   * note, `ukg.sub.glide` s) }. Non-core notes play where the chain has a bass onset (or on a busy glitch row).
   * Every note must stay in the key: (chord bass + semi) mod 12 in the natural minor scale for every chord of the
   * style's table (validatePack). Default UKG_BASSLINES.
   */
  basslines?: readonly (readonly UkgBassNote[])[];
  /**
   * classic, ukg only. Pluck (and lead) motifs over two bars: 1..6 of 2..8 notes { s 0..31, len 0.25..8, tone 0..5
   * (index into the chord's stab voicing, low to high; past the top it wraps up an octave), oct -1..2, core }. Chord
   * tones only, so a motif is always in key. Every second time round its last core note moves up one chord tone.
   * Default UKG_MOTIFS.
   */
  motifs?: readonly (readonly UkgMotifNote[])[];
  /**
   * classic, ukg only. Vocal-synth calls over two bars ("yeah", "uh", "eh", "oh"): 1..6 of 1..12 calls { s 0..31,
   * len 0.5..8, vowel 0..5 and to? 0..5 (indices into `vowels`: the formants glide from one to the other), tone
   * 0..5 (chord tone, as motifs), oct? -1..1, rep? 0..4 (stutter cuts a 32nd apart before it), core }. Default UKG_CALLS (over UKG_VOWELS unless the style gives `vowels`).
   */
  calls?: readonly (readonly UkgCall[])[];
}

/** A UK garage stab hit (GarageData.stabs). */
export interface UkgStab extends CoreNote {
  /** Velocity 0.1..1. */
  vel: number;
}
/** A UK garage bass note (GarageData.basslines). */
export interface UkgBassNote extends CoreNote {
  /** Semitones over the chord's bass, -12..24. */
  semi: number;
  /** Velocity 0.1..1. */
  vel: number;
  /** Slide into this note from the last bass note. */
  glide?: boolean;
}
/** A UK garage pluck/lead note (GarageData.motifs). */
export interface UkgMotifNote extends CoreNote {
  /** Chord tone index 0..5 (low to high in the stab voicing). */
  tone: number;
  /** Octave shift -1..2. Default 0. */
  oct?: number;
}
/** A UK garage vocal-synth call (GarageData.calls). */
export interface UkgCall extends CoreNote {
  /** Vowel index into `vowels`, 0..5, and the vowel it glides to (default the same). */
  vowel: number;
  to?: number;
  /** Chord tone index 0..5. */
  tone: number;
  /** Octave shift -1..1. Default 0. */
  oct?: number;
  /** Stutter: 0..4 short cuts (a 32nd apart) before the call ("y-y-yeah"). Default 0. */
  rep?: number;
}

/**
 * The main synth: a short chord stab ("TUM", not a pad). Per chord tone `voices` unison saws `detune` cents apart
 * (split left and right when 2 or more), a square `osc2` an octave up in the middle; a 12 or 24 dB lowpass whose
 * envelope jumps to cutoff x (1 + 4 x env x vel) and falls back in `fdecay`; tanh drive; amp A/D/S/R; an optional
 * pitch envelope (`punch` semitones over the note falling in `punchTime`).
 */
export interface UkgStabSpec {
  /** Level 0..1.5 (1 = the house level). */
  level: number;
  /** Unison saws per tone 1..4 and their spread, cents 0..40. */
  voices: number;
  detune: number;
  /** Square an octave up, 0..1 of the saw. */
  osc2: number;
  /** Lowpass, Hz 400..9000; resonance 0.3..8; slope 12 or 24 dB/oct. */
  cutoff: number;
  q: number;
  slope: 12 | 24;
  /** Filter envelope amount 0..1 and its decay, s 0.03..1. */
  env: number;
  fdecay: number;
  /** Amp envelope: attack 0.001..0.05 s, decay 0.05..1 s, sustain 0..1, release 0.02..0.6 s. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Pitch envelope: semitones over the note 0..12 (0 = none), falling in 0.005..0.1 s. */
  punch: number;
  punchTime: number;
  /** tanh drive 0..4 (scaled by velocity). */
  drive: number;
  /** How much velocity moves level, cutoff, envelope and drive, 0..1 (0 = every hit the same). */
  vel: number;
  /** Stereo spread of the two unison sides 0..1. */
  width: number;
  /** Register shift, semitones -12..12, over the chord voicing (its pad tones over the tonic in F#3..F4, MIDI 54..65). */
  octave: number;
}

/** Organ under the stab: per chord tone sines at 0, +12 and +19 semitones (drawbars), chorus, drive, a short envelope. */
export interface UkgOrganSpec {
  /** Level 0..1.5 (0 = no organ). */
  level: number;
  /** Drawbar levels of the 8', 4' and 2 2/3' (0, +12, +19), each 0..1. */
  bars: readonly [number, number, number];
  /** Chorus detune, cents 0..20; drive 0..4; lowpass Hz 600..9000. */
  chorus: number;
  drive: number;
  cutoff: number;
  /** Decay 0.05..1.5 s, sustain 0..1, release 0.02..0.8 s. */
  decay: number;
  sustain: number;
  release: number;
}

/** The sub: one sine, mono, with glide and a little drive (energy 40..90 Hz). */
export interface UkgSubSpec {
  /** Level 0..1.5. */
  level: number;
  /** Attack 0.001..0.03 s, decay 0.1..1.5 s, sustain 0..1, release 0.03..0.4 s. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** tanh drive 0..3 (harmonics for small speakers). */
  drive: number;
  /** Glide time of a `glide` note, s 0.02..0.2. */
  glide: number;
  /** Pitch drop into every note that does not glide: semitones 0..12 over the note, falling in `bendTime` 0.02..0.4 s (0 = none). */
  bend: number;
  bendTime: number;
}

/**
 * The mid bass an octave over the sub (the "womp" in 100..500 Hz), centred: "saw" a saw and a square, "fm" a sine
 * carrier with a sine modulator at `ratio` whose index falls from `index` to `floor` x index in `fmDecay`, "reese"
 * two saws `detune` cents apart plus a centre saw (a gentle chorus). All through a highpass (`hp`), a lowpass with an
 * envelope and drive.
 */
export interface UkgMidSpec {
  /** "organ": the M1 organ bass (a sine, its octave and a little square, driven). */
  kind: "saw" | "fm" | "reese" | "organ";
  /** Level 0..1.5 (0 = no mid bass). */
  level: number;
  /** Lowpass Hz 150..3000, its envelope 0..1 (to cutoff x (1 + 5 x env)), resonance 0.3..8. */
  cutoff: number;
  env: number;
  q: number;
  /** Decay 0.05..1 s, sustain 0..1, release 0.02..0.4 s. */
  decay: number;
  sustain: number;
  release: number;
  /** tanh drive 0..5. */
  drive: number;
  /** Detune, cents 0..40 (saw: the square against the saw; reese: the two outer saws). */
  detune: number;
  /** FM: modulator ratio 0.5..6, index 0..8, its fall 0.03..0.6 s and floor 0..1. */
  ratio: number;
  index: number;
  fmDecay: number;
  floor: number;
  /** Highpass under it, Hz 40..300 (the sub owns the bottom). */
  hp: number;
  /**
   * The warp ("BWOOM"): every note that does not glide starts `bend` semitones (0..12) over its pitch and falls in
   * `bendTime` (0.02..0.4 s). 0 = none.
   */
  bend: number;
  bendTime: number;
}

/**
 * Korg M1-style organ chords on the stab rhythm: per tone a sine, its octave and a quiet third harmonic, a key click,
 * drive for grit, a lowpass, a percussive envelope (short decay to a low sustain).
 */
export interface UkgM1Spec {
  /** Level 0..1.5 (0 = none). */
  level: number;
  /** Register shift over the stab voicing, semitones -12..12. */
  octave: number;
  /** Lowpass Hz 600..8000; drive 0..4; key click 0..1. */
  cutoff: number;
  drive: number;
  click: number;
  /** Decay 0.05..1 s, sustain 0..1, release 0.02..0.4 s. */
  decay: number;
  sustain: number;
  release: number;
}

/** FM electric piano chords on the stab rhythm: per tone a sine modulator at `ratio` into two chorused sine carriers. */
export interface UkgEpSpec {
  /** Level 0..1.5 (0 = none). */
  level: number;
  /** Register shift over the stab voicing, semitones -12..12. */
  octave: number;
  /** Modulator ratio 0.5..4, index 0..6 falling to `floor` (0..1) x index in `decay` 0.05..2 s (the tine). */
  ratio: number;
  index: number;
  floor: number;
  decay: number;
  /** Chorus detune, cents 0..20; lowpass Hz 800..9000; release 0.05..1.5 s. */
  chorus: number;
  cutoff: number;
  release: number;
}

/** String pad swells on each chord of the breakdown, the rebuild's first half and the intro's break. */
export interface UkgStringsSpec {
  /** Level 0..1.5 (0 = none). */
  level: number;
  /** Saw pair detune, cents 0..40; lowpass Hz 400..6000 (opens with the swell); attack 0.05..4 s; release 0.1..4 s. */
  detune: number;
  cutoff: number;
  attack: number;
  release: number;
  /** 1: swell on every chord in every section (a held pad or drone), not only the breakdowns. 0..1. */
  hold: number;
}

/** The pluck: a short bright note (saw or triangle), a quick lowpass envelope, a small pitch drop, ping-pong panned. */
export interface UkgPluckSpec {
  /** Level 0..1.5 (0 = no pluck). */
  level: number;
  wave: "sawtooth" | "triangle" | "square";
  /** Lowpass Hz 400..9000 and its envelope 0..1; decay 0.05..0.6 s, release 0.03..0.5 s. */
  cutoff: number;
  env: number;
  decay: number;
  release: number;
  /** Pitch drop into the note, semitones 0..12 over 0.03 s. */
  bend: number;
  /** Ping-pong pan width 0..1 (the notes alternate sides). */
  pan: number;
}

/** The vocal synth: saw + square + breath through two formant bandpasses that glide vowel to vowel, a pitch scoop. */
export interface UkgVoxSpec {
  /** Level 0..1.5 (0 = no calls). */
  level: number;
  /** Formant resonance 2..14. */
  q: number;
  /** Breath noise 0..1. */
  breath: number;
  /** Pitch scoop into the note, semitones -12..12 over `scoop` s 0.01..0.2 (negative: from below). */
  bend: number;
  scoop: number;
  /** Release 0.02..0.5 s. */
  release: number;
  /** Lowpass, Hz 1000..9000 (the pool tick opens it up to 1500 more). */
  lp: number;
}

/** The lead: square + saw an octave up, portamento, chorus; it plays the motif in the drop sections. */
export interface UkgLeadSpec {
  /** Level 0..1.5 (0 = no lead; the pluck plays the motif everywhere). */
  level: number;
  /** Portamento, s 0..0.2; chorus detune, cents 0..25; lowpass Hz 600..9000; release 0.03..0.6 s. */
  glide: number;
  detune: number;
  cutoff: number;
  release: number;
}

/**
 * The groove on top of the swing: odd 16th hats land `hatLate` x a 16th later still (0..0.35, each hit varied by
 * `jitter` 0..1 of it), the percussion `percLate` (0..0.35); ghost snares at `ghost` (0..1.5) x their figure
 * velocity, each varied; `perc` (0..1.5) the rim/conga figure in the gaps; `open` (0..1.5) the open hats.
 */
export interface UkgGrooveSpec {
  hatLate: number;
  percLate: number;
  jitter: number;
  ghost: number;
  perc: number;
  open: number;
  /** Tambourine on the off-8ths 0..1.5, skippy ghost kicks 0..1.5 (0 = none). */
  tamb: number;
  ghostKick: number;
  /** Disco open hats on every off-8th 0..1.5; metallic ticks on the percussion figure's high hits 0..1.5 (0 = none). */
  offOpen: number;
  metal: number;
}

/** UK garage (GarageData.ukg): every part's sound and the song-form switches. */
export interface UkgSpec {
  /** Overall level of the synths 0..1.5; 0 = off (the base plays its own renderer). */
  level: number;
  /** Bars per chord, 1 or 2. */
  bars: number;
  stab: UkgStabSpec;
  organ: UkgOrganSpec;
  sub: UkgSubSpec;
  /** The mid bass from the build on. */
  mid: UkgMidSpec;
  /** A second mid bass for the second half of the drop and the rebuild (the "second drop"); level 0 = the `mid` stays. */
  drop2: UkgMidSpec;
  pluck: UkgPluckSpec;
  vox: UkgVoxSpec;
  lead: UkgLeadSpec;
  groove: UkgGrooveSpec;
  /** M1 organ chords, FM electric piano chords (both on the stab rhythm) and string swells; all off by default. */
  m1: UkgM1Spec;
  ep: UkgEpSpec;
  strings: UkgStringsSpec;
  /**
   * The style's own tonics (pitch classes 0..11, 1..6 of them; the instance picks one), in place of the genre's
   * (futuregarage C# D# G# A#). Empty = the genre's.
   */
  keys: readonly number[];
  /**
   * The scale validatePack holds every chord tone and bass note to: "minor" (natural minor, the default),
   * "harmonic" (harmonic minor), "phrygian" (b2), "dark" (natural + harmonic minor + Phrygian b2 + the tritone:
   * every pitch but the major 3rd and the major 6th).
   */
  scale: "minor" | "harmonic" | "phrygian" | "dark";
  /** 1: the mid bass plays from the intro's bar 4 and through the build (a bassline-led style). 0..1. */
  midEarly: number;
  /** 1: every fourth bar's last beat turns the bass's roots and octaves over (0 <-> 12) with a slide; 0: the line as written. */
  turn: number;
  /** A slow filter arc on the stab, mid bass and pluck: open over `bars` (8, 16 or 32) bars, close over as many; `depth` 0..1. */
  sweep: { bars: number; depth: number };
}

/** GarageData.ukg as a style writes it: every object merged field by field over UKG_SPEC (engine.ts). */
export type UkgData = { [K in keyof UkgSpec]?: UkgSpec[K] extends number | string | readonly number[] ? UkgSpec[K] : Partial<UkgSpec[K]> };

/** A future garage mention voice: a reverse breath, a foley object, a ghost groove, a vocal "yeah". */
export type GarageMentionVoice = "reverse" | "foley" | "groove" | "yeah";
/** A mention's foley object: a lighter click, a water drop, a vinyl crack. */
export type GarageFoleyKind = "lighter" | "drop" | "vinyl";

/**
 * The future garage mention (attention layer: one per mention of the token). Every mention plays all of `voices`, a
 * smart one all of `smart`: "reverse" an "aah" and a noise wash swelling from the step into the next strong beat
 * (step 0 or 8) and cut there; "foley" one object (smart: the lighter with its flame); "groove" a ghost rim and a
 * shuffled hat (smart: a three-hit ghost snare roll, rising); "yeah" the same vocal "yeah" on the tonic, 3 16ths.
 */
export interface GarageOrnamentSpec {
  /** 1..4 distinct voices a mention plays. */
  voices: readonly GarageMentionVoice[];
  /** 1..4 distinct voices a smart mention plays (louder: reverse and yeah x1.5). */
  smart: readonly GarageMentionVoice[];
  /** 1..3 foley objects, played in turn by plain mentions. */
  foley: readonly GarageFoleyKind[];
  /** Overall level 0..1.6 (1 = the preset, as the owner approved it by ear). */
  level: number;
  /** The bar's 16ths it may land on, 1..8 of 0..15 (reverse swells from its slot to the next 0 or 8). */
  slots: readonly number[];
}

// --------------------------------------------------------------------------------------------------- triphop

/** A Rhodes Break chord, semitones over the tonic: bass root and two voicings (4 tones each, -12..24) on c.low + 24. */
export interface TripHopChord {
  /** 0..11. */
  root: number;
  voice: readonly number[];
  alt: readonly number[];
}
/**
 * A Rhodes figure over one chord (two bars, onsets 0..31): `p` "C" the whole voicing, "U"/"L" its top/bottom pair,
 * 0..3 one voice; `opt` notes only play while the glitch row is busy. 1..8 notes.
 */
export type TripHopKeys = readonly { s: number; len: number; p: "C" | "U" | "L" | number; opt?: boolean }[];

/**
 * A trip-hop kit. `snare` plays the backbeat `drag` s late (its `accent` layers only there) and the chain's ghosts
 * 4 ms late at half level (classic: on time, ghosts at 0.22). `hat` the even 16ths (`off`: the odd ones), `open`
 * the open hat (bristol: the hat on the "and" of 4; cinematic: the off-8ths; classic none).
 */
export interface TripHopKit {
  kick: KickSpec;
  snare: DrumVoice;
  /** Backbeat drag, s 0..0.04 (bristol, cinematic). */
  drag: number;
  hat: HatSpec;
  open: HatSpec;
}

/** The trip-hop bass guitar / pluck over the sub (bristol, cinematic). */
export interface TripHopBassSpec {
  wave: Wave;
  /** Lowpass base Hz 80..2000, plus `color` Hz 0..2000 with the pool tick; resonance 0.3..8. */
  cutoff: number;
  color: number;
  q: number;
  /** tanh drive 0..5 (bristol adds the heat). */
  drive: number;
  /** Attack level 0.01..0.3 and the level it falls to 0.001..0.3 (a pluck falls far, a growl sustains). */
  level: number;
  sustain: number;
}

/** Trip-hop. Bases: "classic" (Rhodes Break), "bristol" (Bristol Dark), "cinematic" (Cinematic). */
export interface TripHopData extends SoundData {
  /** classic. Chords by name, merged over the house set (i iv VI VII v IV). Default TRIPHOP_RHODES_CHORDS. */
  chords?: Readonly<Record<string, TripHopChord>>;
  /** classic. Progressions of exactly 4 chord names, two bars a chord. 1..6. Default TRIPHOP_RHODES_PROGRESSIONS. */
  progressions?: readonly (readonly string[])[];
  /** classic. Bars 1-2 and 5-6 of a phrase: state the chord. 1..4. Default TRIPHOP_RHODES_STATEMENTS. */
  statements?: readonly TripHopKeys[];
  /** classic. Bars 3-4: the chord, then a short top line. 1..4. Default TRIPHOP_RHODES_ANSWERS. */
  answers?: readonly TripHopKeys[];
  /** classic. Bars 7-8: a turn into the next phrase. 1..4. Default TRIPHOP_RHODES_TURNS. */
  turns?: readonly TripHopKeys[];
  /** classic. Intro and breakdown: mostly space. 1..4. Default TRIPHOP_RHODES_SPACE. */
  space?: readonly TripHopKeys[];
  /** classic, bristol. Kick figures. Default TRIPHOP_KICKS[base]. */
  kicks?: KickFigures;
  /** classic. Sub level 0..1. Default 0.55. */
  sub?: number;
  /** bristol. The bass pedal: semitones over the bass tonic per bar of four, exactly 4 values 0..12. Default [0, 0, 0, 10]. */
  pedal?: readonly number[];
  /** bristol. The narrow string chord over c.low + 24: 2..5 tones -12..24. Default [0, 7, 10]. */
  strings?: readonly number[];
  /** bristol. The sine ghost's calls over two bars (onsets 0..31, `semi` -12..24 over c.low + 36). 1..6 of 1..6. Default TRIPHOP_BRISTOL_CALLS. */
  calls?: readonly (readonly (StepNote & { semi: number })[])[];
  /** cinematic. Chords two bars each, in turn: 2..4, pad 3..5 tones -12..24 over c.low + 36, root -12..12. Default TRIPHOP_VOICINGS. */
  voicings?: readonly { pad: readonly number[]; root: number }[];
  /** cinematic. Piano cuts over two bars (onsets 0..31), one figure of 1..10. Default TRIPHOP_PIANO_CUTS. */
  cuts?: readonly CoreNote[];
  /** classic, bristol, cinematic. The drum kit, merged over the base's (TRIPHOP_KITS). */
  kit?: Partial<TripHopKit>;
  /** classic, bristol, cinematic. The sine sub (classic: `octave` is the octave layer; bristol, cinematic: the sine under `bassTone`). */
  bass?: Partial<SubSpec>;
  /** bristol, cinematic. The bass guitar growl / pluck over the sub. */
  bassTone?: Partial<TripHopBassSpec>;
  /** classic, bristol, cinematic. The bowed strings (reads osc, cutoff, hp, q, attack, level, vib). */
  bowed?: Partial<PadSpec>;
}

// ------------------------------------------------------------------------------------------------- lofihouse

/** A "Sample Chop" slice: 0 full chord, 1 its top, 2 the top an octave up, 3 low root and fifth. */
export interface LofiChop extends CoreNote {
  slice: number;
}

/**
 * A lofi house kit. `clap` on 2 and 4; `snare` (rave) the crunchy break snare under the clap and on the chain's
 * ghosts; `hat` closed (rave: crushed), `open` the open hat (classic, rave: the off-8ths; chop: the "and" of 2 and 4
 * when busy); `shaker` (chop) the 16ths (`off`: the off 16ths).
 */
export interface LofiKit {
  kick: KickSpec;
  clap: DrumVoice;
  snare: DrumVoice;
  hat: HatSpec;
  open: HatSpec;
  shaker: ShakerSpec;
}

/** The rave organ bass: sine drawbars, driven and lowpassed, with a key click and a sub. */
export interface OrganSpec {
  /** [harmonic 0.5..8, level 0..1], 1..6 drawbars. */
  drawbars: readonly (readonly [number, number])[];
  /** tanh drive 0..4. */
  drive: number;
  /** Lowpass Hz 300..6000 (the market opens it), resonance 0.3..6. */
  cutoff: number;
  q: number;
  /** Level 0..0.4, key click 0..0.1, the sub under it 0..1. */
  level: number;
  click: number;
  sub: number;
}

/** Lofi House. Bases: "classic" (Dusty Keys), "chop" (Sample Chop), "rave" (Raw Rave). */
export interface LofiHouseData extends SoundData {
  /** classic, chop, rave. Two-chord vamps, two bars a chord. 1..6. Default LIQUID_VAMPS. */
  vamps?: readonly Vamp[];
  /** classic, rave. Chord stabs over two bars (onsets 0..31). 1..6 of 1..12. Default HOUSE_STABS / LOFIHOUSE_RAVE_STABS. */
  stabs?: readonly (readonly CoreNote[])[];
  /** chop. The chopped loop over two bars (onsets 0..31, slice 0..3). 1..6 of 1..16. Default LOFIHOUSE_CHOPS. */
  chops?: readonly (readonly LofiChop[])[];
  /** rave. Organ bass: the chain's onsets walk these offsets over the chord root: 2..8 values 0..12. Default [0, 12, 0, 7, 12, 0, 12, 7]. */
  organ?: readonly number[];
  /** classic, chop. Sub level 0..1. Default 0.95 / 0.8. */
  sub?: number;
  /** classic, chop, rave. The drum kit, merged over the base's (LOFIHOUSE_KITS). */
  kit?: Partial<LofiKit>;
  /** classic, chop, rave. The sine sub (classic, chop: `octave` is the octave layer; rave: the sub under the organ). */
  bass?: Partial<SubSpec>;
  /** rave. The organ bass voice. */
  organTone?: Partial<OrganSpec>;
  /** rave. The hoover pad (reads osc, cutoff, q, hp, attack, release, level, vib). */
  pad?: Partial<PadSpec>;
  /** chop. The chord sample (reads osc, cutoff, q, hp, drive, noise = baked hiss, level, vib = tape wow). */
  chop?: Partial<PadSpec>;
  /** chop. The pump: bass and harmony gain at the kick 0.05..1, recovery in 16ths 1..8 (heat digs the harmony deeper). */
  pump?: { bass?: number; harm?: number; release?: number };
}

// ------------------------------------------------------------------------------------------------------ acid

/** One 303 step: a degree of the acid note set (0 3 7 10 12: degree 0..4), octave -1..1, flags, gate. */
export interface Acid303Note {
  degree: number;
  octave: number;
  /** 1 accent, 2 slide to the next occupied step, 4 density-dependent ornament (sum them: 0..7). */
  flags: number;
  /** Gate length in 16ths, 0.1..4 (default per base: classic 0.58, acidhouse 0.79, rubber 2.65). */
  gate?: number;
}

/**
 * An acid kit. `clap` on 2 and 4; `snare` (acidhouse) the turn-bar fills; `hat` closed (acidhouse: `off` on the odd
 * 16ths), `open` the open hat; `perc` the chain's glitch row (default: the house cowbell / rim / blip).
 */
export interface AcidKit {
  kick: KickSpec;
  clap: DrumVoice;
  snare: DrumVoice;
  hat: HatSpec;
  open: HatSpec;
  perc?: DrumVoice;
}

/** The 303: one oscillator into a resonant four-pole ladder with an accent circuit. */
export interface Acid303Voice {
  /** "saw" bright and buzzy, "square" hollow. */
  wave: "saw" | "square";
  /** Filter base Hz 50..400 (the knob sweep, colour and pressure open it) and envelope amount Hz 300..4000. */
  cutoff: number;
  envMod: number;
  /** Resonance 1.5..4.2 (4 squeals; heat adds a little). */
  resonance: number;
  /** Envelope decay s 0.05..0.6 (accents are always short). */
  decay: number;
  /** Drive after the filter 0.5..3. */
  drive: number;
  /** Level 0.05..0.4; accent boost 1..1.6. */
  level: number;
  accent: number;
  /** Default gate in 16ths 0.1..4; the knob sweep's length in bars 4..32. */
  gate: number;
  sweep: number;
  /**
   * Off unless given (no house value): a softly rounded sine under the line, 0..1 of the 303's level. It plays the line's
   * notes in the bottom octave (from E1..D#2, octave jumps up stay there), follows the slides and the gate, and sits
   * on the bass bus, so the kick ducks it. The low end a resonant 303 lacks: its passband drops as the peak rises.
   */
  sub?: number;
}

/** Acid. Bases: "classic" (303 Floor), "acidhouse" (Acid House), "rubber" (Slow Rubber). */
export interface AcidData extends SoundData {
  /** classic, acidhouse, rubber. 303 lines: exactly 16 steps each (a note or null = rest), 1..6. Default ACID_*_LINES. */
  lines?: readonly (readonly (Acid303Note | null)[])[];
  /** classic, acidhouse, rubber. The drum kit, merged over the base's (ACID_KITS). */
  kit?: Partial<AcidKit>;
  /** classic, acidhouse, rubber. The 303 voice, merged over the base's (ACID_VOICES). */
  voice?: Partial<Acid303Voice>;
}

// ------------------------------------------------------------------------------------------------- dubtechno

/** A dub techno chord: the sub's root (semitones over the bass tonic) and the stab's upper voicing over the stab root. */
export interface DubChordSpec {
  /** -12..12 (folded into E1..D#2 for the sub). */
  root: number;
  /** 2..5 tones -12..26, low to high; the pad adds the root an octave under, the bell plays them from the top. */
  upper: readonly number[];
}
/** A progression: chord names (DubTechnoData.chords or the house set), each held `bars` bars (1..8), 1..8 chords. */
export interface DubProgression {
  bars: number;
  seq: readonly string[];
}

/**
 * The dub techno kick: a long round sine tuned to the key (the root or fifth nearest `center`), falling from `rise`
 * times its pitch, tanh warmth under a closed lowpass, a hint of click.
 */
export interface DubKickSpec {
  /** Target pitch, Hz 30..90 (the key's root or fifth nearest it plays). */
  center: number;
  /** Start pitch as a multiple of the note 1..4, falling over `sweep` s 0.005..0.3. */
  rise: number;
  sweep: number;
  /** The round body's first fall, s 0.02..0.3, then the tail to silence at `decay` s 0.3..1.5. */
  hold: number;
  decay: number;
  /** tanh drive 0.1..4 under a lowpass `lp` Hz 60..2000. */
  drive: number;
  lp: number;
  /** Click level 0..1 at `clickHz` Hz 300..8000 (bandpassed noise). */
  click: number;
  clickHz: number;
  /** Level 0..0.6. */
  level: number;
}
/** The clap on 2 and 4: three close noise bursts at `hz` (300..6000) and a `decay` s tail (0.01..0.5), or a muted rim pitched by `hz`. */
export interface DubClapSpec {
  /** 0..3. */
  level: number;
  hz: number;
  decay: number;
  rim: boolean;
}
/**
 * The hats: an open hat on every offbeat (`off` its level 0..1.2, 0 = none; `decay` s 0.005..0.5, `hp` Hz
 * 1000..14000, `metal` 0..1) and a swung 16th shaker (`shaker` level 0..1, `shakerDecay` s 0.005..0.2, `shuffle` the
 * shaker's level per 16th of the beat [on, e, and, a], each 0..1.5).
 */
export interface DubHatSpec {
  off: number;
  decay: number;
  hp: number;
  metal: number;
  shaker: number;
  shakerDecay: number;
  shuffle: readonly number[];
}
/** The tuned hand percussion: level 0..1 and decay s 0.02..0.5 (its notes are `percs`). */
export interface DubPercSpec {
  level: number;
  decay: number;
}
/**
 * A dub techno kit, merged per voice over the base's (DUB_STYLES): `kick`, `clap` (2 and 4), `hat` (offbeat open
 * hat and the shaker), `perc` (the tuned percussion). Each voice given is merged too: write only what you change.
 */
export interface DubTechnoKit {
  kick: Partial<DubKickSpec>;
  clap: Partial<DubClapSpec>;
  hat: Partial<DubHatSpec>;
  perc: Partial<DubPercSpec>;
}
/** The rolling sub: a sine with an octave layer through warm tanh and a closed lowpass. */
export interface DubSubSpec {
  /** Level 0..1.2, the octave layer 0..0.5. */
  level: number;
  octave: number;
  /** Lowpass Hz 80..1000 (heat opens it a little). */
  lp: number;
  /** Attack s 0.002..0.2, release after the note s 0.01..1. */
  attack: number;
  release: number;
  /** tanh drive 0.1..4. */
  drive: number;
}
/**
 * The chord stab: two detuned oscillators per chord tone through a highpass and a lowpass whose envelope closes fast;
 * the echo and the room make the bloom. The cutoff follows the slow sweep (`sweep.stab`), a four-bar wobble
 * (`move`), the pool tick, heat and pressure.
 */
export interface DubStabSpec {
  /** Register: semitones over the stab root, -12..12. */
  octave: number;
  wave: Wave;
  /** ± cents 0..40. */
  detune: number;
  /** Base lowpass Hz 150..4000; at the attack `env` times it (1..6), falling over `envTime` s 0.01..1; resonance `q` 0.3..12. */
  lp: number;
  env: number;
  envTime: number;
  q: number;
  /** Highpass Hz 20..1000. */
  hp: number;
  /** Attack s 0.001..1, release s 0.02..3, gain 0..1.5, pan -1..1. */
  attack: number;
  release: number;
  gain: number;
  pan: number;
  /** Depth of the four-bar cutoff wobble 0..1. */
  move: number;
  /**
   * A second oscillator per chord tone under the same filter (off unless `mix2` > 0): `wave2` a wave or "pulse" (a
   * pulse of width `width` 0.05..0.5, 0.5 = square; default 0.3), `mix2` its level against the detuned pair 0..1.5,
   * `octave2` its register in semitones over the stab -12..24 (default 0; -12 a sub, 12 / 19 / 24 glass). Saw + pulse
   * = a Prophet-ish stab, square + a sine under it = hollow, a sine two octaves up = glassy. Default: no layer.
   */
  wave2?: Wave | "pulse";
  mix2?: number;
  width?: number;
  octave2?: number;
  /**
   * Velocity to cutoff 0..1: the figure hit's level (its accent times the `stabBars` level) scales the cutoff by
   * level^(1.5 velLp), so quieter hits are darker and accents open (ornaments, throws and whale stabs are not
   * scaled). Default 0: every hit at the same cutoff.
   */
  velLp?: number;
  /**
   * The voice that plays the chord tones, under the same highpass, lowpass envelope, sweep and amp: "osc" the
   * detuned oscillator pair (default, every house style), "fm" a two-operator FM voice per tone (`fm`), "pluck" a
   * struck resonator bank per tone (`pluck`). The `mix2` layer, `velLp` and every send work with each.
   */
  engine?: DubStabEngine;
  /** The FM voice (engine "fm"), merged over DUB_STAB_FM. */
  fm?: Partial<DubStabFmSpec>;
  /** The struck resonator voice (engine "pluck"), merged over DUB_STAB_PLUCK. */
  pluck?: Partial<DubStabPluckSpec>;
}
export type DubStabEngine = "osc" | "fm" | "pluck";
/**
 * The FM stab: per chord tone two sine carriers (detuned by the stab's `detune`, which `wave` does not touch) on one
 * sine modulator at `ratio` times the tone; the modulator's index jumps to `index` at the hit and falls to
 * `floor` x index over `decay` s, so the hit is bright and metallic and the tail a near sine that the dub filter
 * darkens. An optional second modulator (`ratio2` at `index2`, falling over `decay2` s to nothing) adds a clang on
 * the attack only. `vel` 0..1: the figure hit's level scales both indices by level^(1.5 vel).
 */
export interface DubStabFmSpec {
  /**
   * Modulator / carrier ratio 0.5..12 (1 warm, 2 hollow, 3 / 7 metallic; 3.5 / 1.41 bell-like). A whole ratio keeps
   * every partial on the tone's harmonic series; a non-whole one adds partials off the key (3.5: x2.5, x5.5 ...) that
   * clash with the chord and the sub, and the echo's highpass lifts them over the fundamentals.
   */
  ratio: number;
  /** Peak index 0..12 (the deviation is index x the modulator's frequency). */
  index: number;
  /** Held share of the index after the decay 0..1. */
  floor: number;
  /** Index fall s 0.01..2. */
  decay: number;
  /** The second modulator: ratio 0.5..16 (default 7, a whole metal ping), peak index 0..12 (0 = none, the default), fall s 0.005..1. */
  ratio2: number;
  index2: number;
  decay2: number;
  /** Velocity to index 0..1. */
  vel: number;
}
/**
 * The struck resonator stab (modal synthesis): one mallet click (a half sine `burst` s wide, through a lowpass at
 * `tone` Hz: the narrower and the higher, the harder the mallet) strikes a bank of tuned resonators per chord tone, one per `modes` ratio (1 = the tone; 2, 3
 * a string, 4 a marimba bar's two-octave mode; its 9.9 mode or a wooden bar's 2.76 / 5.4 ring off the key, a quarter
 * tone from any scale tone, so a stab over a chord and a sub keeps to whole ratios). Each rings `decay` s (to -60 dB) times
 * (1 / ratio)^`damp`, so the upper modes die first and the hit darkens as it rings. `vel` 0..1: the figure hit's
 * level opens the mallet's lowpass by level^(1.5 vel). The stab's `wave` and `detune` do not apply.
 */
export interface DubStabPluckSpec {
  /** Mode ratios over the tone, 1..4 of 0.5..16. */
  modes: readonly number[];
  /** Ring of the first mode, s to -60 dB 0.05..4. */
  decay: number;
  /** How much faster the upper modes die 0..2. */
  damp: number;
  /** Mallet lowpass Hz 200..10000. */
  tone: number;
  /** Click width s 0.0002..0.005. */
  burst: number;
  /** Velocity to the mallet's lowpass 0..1. */
  vel: number;
}
/** The pad under the stabs: the chord with its root an octave under, held and crossfading; in the room, not ducked. */
export interface DubPadSpec {
  /** Level 0..3 (0 = no pad). */
  level: number;
  wave: Wave;
  /** ± cents 0..40; register semitones over the stab root -12..12. */
  detune: number;
  octave: number;
  /** Lowpass Hz 150..5000 (it swells across the chord). Attack s 0.01..8, release s 0.05..6. */
  lp: number;
  attack: number;
  release: number;
  /** A highpass under the pad, Hz 20..1000, keeping it out of the kick and the sub. Default: none. */
  hp?: number;
}
/** The bell: a sine with a harmonic FM partial (`ratio` 0.5..8, `index` 0..4) that fades faster than the note. */
export interface DubBellSpec {
  /** Level 0..3 (0 = no bell). */
  level: number;
  /** A fragment plays in one of every `every` four-bar phrases, 1..8. */
  every: number;
  ratio: number;
  index: number;
  /** Decay s 0.1..4. */
  decay: number;
}

/**
 * The techno rumble: the kick feeds its own dark room (a lowpassed, feed-forward tap chain, so it can never ring) and
 * the kick ducks the room's output, so the low smear pumps between the kicks. Off in every house style (`level` 0).
 */
export interface DubRumbleSpec {
  /** Send of the kick into the rumble room 0..1.5 (0 = no rumble: nothing is built). */
  level: number;
  /** Lowpass Hz 60..400, before and after the room. */
  lp: number;
  /** Tail length s 0.3..3 (the taps fall about 30 dB over it). */
  decay: number;
  /** Sidechain depth 0..1: at each kick the rumble drops to 1 - duck and recovers by the next beat. */
  duck: number;
}

/**
 * The dub echo's shape (dub techno; the echo itself is `fx.echo`, a chain of feed-forward taps that can never ring).
 * `width` pans its repeats left and right 0..1 (0 = centre, 1 = hard; house 0.55). `alt` 0..8 16ths: when > 0 the odd
 * repeats wait `alt` 16ths instead of `fx.echo.steps`, a ping-pong of two times (steps 4 + alt 3 = a quarter left, a
 * dotted eighth right, ...). `wobble` 0..1 a tape wobble: one slow sine (`rate` 0.05..2 Hz, default 0.4) moves every
 * repeat's time by up to 3 ms. House: { width 0.55, alt 0, wobble 0 }.
 */
export interface DubEchoToneSpec {
  width: number;
  alt: number;
  wobble: number;
  rate: number;
}

/**
 * A sparse atmospheric melody (off unless `level` > 0): rare single synth notes from a pool, floating over the
 * groove through the echo and the room. Every `every` bars (a cell) a note may come, `count` 1..4 of them in the cell
 * on 8th onsets, each cell with probability `chance` (heat raises it); the epoch and the cell pick the onsets and the
 * pitches, so a new epoch is a new line. A whale buy answers with one note. It plays on the lead bus (its own `fx.echoSend.lead` /
 * `spaceSend.lead`) plus its own `echo` and `space` sends 0..1.
 */
export interface DubMelodySpec {
  /** Level 0..2 (0 = no melody). */
  level: number;
  wave: Wave;
  /** ± cents between its two oscillators 0..30. */
  detune: number;
  /** Register: semitones over the stab register -12..24 (12 = an octave over the stabs). */
  octave: number;
  /** Pitches, semitones over the stab root -12..24, 1..8 of them. Default: the bar's chord tones (`upper`). */
  notes?: readonly number[];
  /** Bars per cell 1..16, notes per played cell 1..4, the chance a cell plays 0..1. */
  every: number;
  count: number;
  chance: number;
  /** Attack s 0.005..4, then held `hold` 16ths 0..32, then released over `release` s 0.1..8. */
  attack: number;
  hold: number;
  release: number;
  /** Lowpass Hz 200..8000. */
  lp: number;
  /** Extra sends straight into the echo and the room, 0..1. */
  echo: number;
  space: number;
}

/** Dub techno. Bases: "classic" (Lucidflow), "ixtlan" (Ixtlan), "moment" (The Moment). Every base reads every field. */
export interface DubTechnoData extends SoundData {
  /** Chords by name, merged over the house set (i9 i11 iv7 VI9 VII9 v7). Default DUB_CHORDS. */
  chords?: Readonly<Record<string, DubChordSpec>>;
  /** 1..6 progressions; the epoch picks one. Default DUB_STYLES[base].progs. */
  progressions?: readonly DubProgression[];
  /**
   * Stab figures: steps of one bar (0..15), 1..6 hits, played every bar (`stabBars` may rest some); the last hit is
   * the answer only a busy chain adds. 1..6 figures, one per epoch. Default DUB_STYLES[base].figures.
   */
  figures?: readonly (readonly number[])[];
  /** Level of each figure hit in order (cycled), 1..6 values 0..1.5. Default DUB_STYLES[base].accents. */
  accents?: readonly number[];
  /**
   * The stab's bar mask: the figure's level per bar of a 1..16-bar cycle (counted from bar 0, like the progressions),
   * each 0..1.5; 0 rests the figure that bar, so the echo carries the space ([1, 0] = every other bar, [1, 0, 0, 0] =
   * once a phrase, [1, 0, 0.6, 0] = an answer softer). Default: every bar at 1.
   */
  stabBars?: readonly number[];
  /**
   * The sub's figure per bar: [step 0..15, length in 16ths 0.25..16, level 0..1.5, interval over the chord root
   * 0..24 (optional: 7 the fifth, 12 the octave)], 1..16 notes. Default DUB_STYLES[base].bass.notes.
   */
  bassline?: readonly (readonly [number, number, number, number?])[];
  /** Bell fragments over four bars: [16th 0..63, chord tone from the top 0..5, level 0..1.5], 1..8 each, 1..6 fragments. */
  bells?: readonly (readonly (readonly [number, number, number])[])[];
  /** The percussion's two-bar figure: [16th 0..31, pitch ratio over the tonic 0.5..3 (1.5 the fifth), level 0..1.5], 1..8. */
  percs?: readonly (readonly [number, number, number])[];
  /**
   * The clap's (or rim's) two-bar figure: [16th 0..31, level 0..1.5], 1..8 hits, in place of 2 and 4 (`[[12, 1],
   * [28, 1]]` = the 4 only). The clap still follows the song form and the chain's snare row. Default: 2 and 4.
   */
  claps?: readonly (readonly [number, number])[];
  /**
   * The hat's two-bar figure: [16th 0..31, level 0..1.5, decay s 0.005..0.5 (optional, default kit.hat.decay)], 1..16
   * hits, in place of the offbeat hat (`kit.hat.off` still scales it; a long decay is an open hat). Default: every
   * offbeat at 1.
   */
  hats?: readonly (readonly [number, number, number?])[];
  /** The drum kit, merged per voice over the base's (DUB_STYLES). */
  kit?: Partial<DubTechnoKit>;
  /** The rolling sub's voice. */
  subTone?: Partial<DubSubSpec>;
  /** The chord stab's voice. */
  stabTone?: Partial<DubStabSpec>;
  /** The pad's voice. */
  padTone?: Partial<DubPadSpec>;
  /** The bell's voice and how often it plays. */
  bellTone?: Partial<DubBellSpec>;
  /**
   * Bars per full open-close of the stab and pad filters (`stab`) and of the echo loop's filter (`echo`), 2..64.
   * The echo may breathe too (both off by default): `send` 0..1 dips the level into the echo by up to that share and
   * `fb` 0..1 the level of its repeats, over `breath` bars 2..64 (default the `echo` period). They only ever lower
   * the echo from its `fx.echo` values, so it can never build.
   */
  sweep?: { stab?: number; echo?: number; send?: number; fb?: number; breath?: number };
  /** The field texture (rain on a window, a far room): level 0..3 (0 = none), band centre Hz 200..6000. */
  field?: { level?: number; hz?: number };
  /** The kick's rumble room, ducked by the kick (DubRumbleSpec). Default off (level 0). */
  rumble?: Partial<DubRumbleSpec>;
  /** The echo's stereo width, ping-pong second time and tape wobble (DubEchoToneSpec). Default the house echo. */
  echoTone?: Partial<DubEchoToneSpec>;
  /** The sparse atmospheric melody (DubMelodySpec). Default off (level 0). */
  melody?: Partial<DubMelodySpec>;
}

// --------------------------------------------------------------------------------------------------- electro

/**
 * Electro kick figures as two-bar figures (onsets 0..31, so the second bar can limp), by how busy the chain's kick
 * row is: `lo` (1-2 kicks), `mid` (3-4), `hi` (5+), and `half` for the intro and the start of the rebuild. Each
 * tier 1..6 figures of 1..12 onsets; the instance picks one per tier.
 */
export interface ElectroKicks extends KickFigures {
  half: readonly (readonly number[])[];
}
/**
 * An electro chord. `bass` the root in semitones over the bass tonic -12..12; `tones` 3..5 tones -12..24 (client03:
 * the ghost pad's voicing over the pad root; alienrave: the hoover voicing over the stab root, the arp and the robot
 * call play from it). client03's bass line bends its 3 and 10 to the chord's `third` (3 | 4) and `seventh` (10 | 11).
 */
export interface ElectroChord {
  bass: number;
  tones: readonly number[];
  third?: number;
  seventh?: number;
}
/** An electro closed hat: highpass Hz 1000..14000 (client03, alienrave: the pool tick brightens it), decay s, metal ring 0..1, q 0.3..4. */
export interface ElectroHat {
  hp: number;
  decay: number;
  metal: number;
  q?: number;
}
/**
 * An electro kit. `snare` the backbeat (and classic's fills and heat rolls): a house voice by name ("808" Cold 808,
 * "client" Client_03's 808 with a clap, "alien" Alien Rave's 909 with a clap) or your own layers. `ghost` (client03)
 * the funk ghost snares and heat rolls. `hat` the closed hat, its level per 16th of the beat [on, e, and, a] in
 * `accents` (0..1 each); `open` the open hat with its own level (classic: the busy row's 7th 16th; client03: the
 * epoch's open slice; alienrave: the epoch's open-hat accents).
 */
export interface ElectroKit {
  kick: KickSpec;
  snare: "808" | "client" | "alien" | DrumVoice;
  ghost: DrumVoice;
  hat: ElectroHat;
  open: HatSpec;
  accents: readonly number[];
}
/**
 * The electro bass. Pairs are [plain note, accented note]. classic reads `cutoff` (where the filter opens before it
 * closes on the note), `color`, and the first of `q`, `decay`, `level`, `sub`. client03 (saw and square into a
 * 24 dB lowpass, tanh) and alienrave (two saws and an FM sine, resonant lowpass, hard tanh) read every field but
 * `fm` (alienrave only); for them `cutoff` is the filter floor and the envelope opens it to `open` times that.
 */
export interface ElectroBassSpec {
  /**
   * 1..4 oscillators: wave, detune cents -40..40, level 0..1 (client03, alienrave). A wave may also be a narrow pulse,
   * "pulse25" or "pulse12" (25% and 12.5% duty: a hollow, nasal machine pulse); the house basses use none.
   */
  osc: readonly ElectroBassOsc[];
  /** Filter Hz 60..1200, plus `color` Hz 0..3000 with the pool tick. */
  cutoff: number;
  color: number;
  /** Resonance 0.3..14 (sell pressure adds more). */
  q: readonly [number, number];
  /** Envelope peak as a multiple of the floor 1..12. */
  open: readonly [number, number];
  /** Filter envelope time s 0.01..0.5. */
  decay: readonly [number, number];
  /** tanh drive 0.1..5 (heat and buy pressure add). */
  drive: number;
  /** Level 0.02..0.3. */
  level: readonly [number, number];
  /** The clean sine an octave under, 0..2 (classic: the sub's level). */
  sub: readonly [number, number];
  /** Slide time s 0.001..0.2. */
  glide: number;
  /** FM index of the snarl sine, 0..4 (alienrave). */
  fm: readonly [number, number];
  /**
   * alienrave. The snarl's modulator as a ratio of the note 0.5..4 (default 2: the house snarl). 1 is a hollow,
   * woody FM, 1.5 and 3 metallic and clangy.
   */
  ratio?: number;
}
/** An electro bass oscillator: a wave or a narrow pulse ("pulse25", "pulse12"). */
export interface ElectroBassOsc {
  type: Wave | "pulse25" | "pulse12";
  detune: number;
  level: number;
}
/**
 * A polymetric machine sequence (every electro base; off unless a style gives `seq`): a cycle of 3..16 steps that runs
 * against the 16-step drums (a 7-step cycle over a 16-step bar comes round on a different 16th every bar), played by
 * the style's lead patch (`leads`). It plays while the section's lead layer is open.
 */
export interface ElectroSeqSpec {
  /** 3..16 steps: semitones -12..24 over the sequence root, or null (a rest). At least 2 notes. */
  notes: readonly (number | null)[];
  /** 16ths per step 1..4 (1 = 16ths, 2 = 8ths, 3 = dotted 8ths: a 3-against-4 feel). Default 1. */
  rate?: number;
  /** The root's register in semitones over E4..D#5 on the tonic, -24..12. Default 0. */
  octave?: number;
  /** client03, alienrave: follow the bar's chord (`bass`). Default false: one tonal centre. */
  follow?: boolean;
  /** Note length in 16ths 0.25..4. Default 0.8. */
  gate?: number;
  /** Level 0..1.2 (the lead patch's level scale; the cold stabs play at 0.8). Default 0.5. */
  level?: number;
  /** The first step's extra level, 0..1 (an accent once a cycle, so the phase is heard). Default 0.25. */
  accent?: number;
  /** Slow evolution: the cycle rotates one step every `evolve` bars, 0..32 (0 = never). Default 0. */
  evolve?: number;
}
/**
 * Metallic percussion (every electro base; off unless a style gives `metal`): a cycle of 3..16 levels at 16ths
 * running against the bar (an odd cycle phases against the 16-step drums), each hit a two-operator FM ping (a sine
 * carrier at `freq`, a modulator at `ratio` x freq whose index falls fast: inharmonic ratios ring like struck metal)
 * plus a short bandpassed tick. It plays while the hats play, on the perc bus, panned left and right in turn.
 */
export interface ElectroMetalSpec {
  /** 3..16 levels 0..1 (0 = rest), at least one hit. */
  steps: readonly number[];
  /** Carrier Hz 200..6000. Default 1800. */
  freq?: number;
  /** Modulator ratio 0.5..8. Default 1.41 (inharmonic: metal). */
  ratio?: number;
  /** FM index 0..8 at the hit. Default 3. */
  index?: number;
  /** Decay s 0.01..0.4. Default 0.06. */
  decay?: number;
  /** Peak 0..0.5. Default 0.12. */
  level?: number;
  /** Stereo spread 0..1, alternating hit to hit. Default 0.5. */
  pan?: number;
  /** Loose timing: each hit lands 0..`jitter` ms late (hashed, deterministic), 0..15. Default 0. */
  jitter?: number;
}
/**
 * Microtiming per voice (every electro base; off unless a style gives `jitter`), in ms 0..15: each hit lands 0..ms
 * late, hashed per step (deterministic). The kick and the snare are never moved: they stay on the grid while the hats
 * (`hat`, closed and open, with client03's chops and grains) and client03's ghost snares (`ghost`) roll around them.
 * 0-2 is a machine, 1-10 a human on hardware, 3-15 a loose roller.
 */
export interface ElectroJitter {
  hat?: number;
  ghost?: number;
}
/** Client_03's computer voice: a narrow pulse at `pitch` Hz 60..400 through jumping formants, crushed to `bits` 3..8, band-limited `hp`..`lp` Hz. */
export interface ElectroVoiceSpec {
  pitch: number;
  bits: number;
  /** Hz 100..2000 and 1000..8000. */
  hp: number;
  lp: number;
  /** Level 0..0.15. */
  level: number;
  /** How often it speaks in the full section: every 2, 4 or 8 bars (default 8). */
  every: number;
}
/** Alien Rave's hoover: detuned saws a tone scooping up `bend` semitones (0..12), a resonant lowpass that snaps open and closes. */
export interface HooverSpec {
  /** Lowpass Hz 200..4000 plus `color` Hz 0..4000 with the pool tick; resonance 0.3..8; highpass Hz 20..1000. */
  cutoff: number;
  color: number;
  q: number;
  hp: number;
  bend: number;
  /** 1..4 saws a tone, detune cents -50..50 each (heat widens them). */
  detune: readonly number[];
  /** Level 0..0.4. */
  level: number;
}
/**
 * Alien Rave's laser on the glitch row: a resonant square (lowpass resonance `q` 0.3..12) falling from `from` Hz
 * (300..6000) plus `color` Hz (0..4000) with the pool tick to 140..260 Hz in about 0.11 s, into the echo. `level`
 * 0..0.4 (0: no lasers). The house: from 2400, color 2600, q 6, level 0.28 (up to ~6 kHz on a bright pool).
 */
export interface LaserSpec {
  from: number;
  color: number;
  q: number;
  level: number;
}
/**
 * Alien Rave's sci-fi arp: a 25% pulse through a resonant lowpass (`q` 0.3..12) that snaps from the note times
 * `open` (1..8) plus `color` (0..6) with the pool tick, at most `cap` Hz (500..11000), down to the note in 80 ms.
 * `level` 0..0.4 (0: no arp). The house: open 3, color 3, cap 11000, q 5, level 0.22 (a bright plink up to ~8 kHz).
 */
export interface AlienArpSpec {
  open: number;
  color: number;
  cap: number;
  q: number;
  level: number;
}
/** Alien Rave's robot call: saw and square through gliding formants, ring-modulated at `ring` times the note (0.25..4). Level 0..1.2. */
export interface VoxSpec {
  ring: number;
  level: number;
}
/** A Client_03 bass note over two bars: onset 0..31, semitones over the chord root -12..24, length 0.25..16, flags. */
export interface ElectroRiffNote {
  s: number;
  semi: number;
  len: number;
  /** 1 core/accent, 2 slide in from the previous note, 4 ornament (busy chain only), 8 dead note (sum them: 0..15). */
  f: number;
}

/** Electro. Bases: "classic" (Cold 808), "client03" (Client_03), "alienrave" (Alien Rave). */
export interface ElectroData extends SoundData {
  /** classic, client03, alienrave. Kick figures by tier. Default ELECTRO_KICKS[base]. */
  kicks?: ElectroKicks;
  /** classic. The bass arp: the chain's bass onsets cycle through the first 1..3 notes (semitones 0..24 over the root). 1..6. Default ELECTRO_ARPS. */
  arps?: readonly (readonly number[])[];
  /** client03, alienrave. The chord table progressions index into, 2..8. Default CLIENT_CHORDS / ALIEN_CHORDS. */
  chords?: readonly ElectroChord[];
  /** client03, alienrave. Exactly 4 indices into `chords`; client03 two bars a chord, alienrave one. 1..6. */
  progressions?: readonly (readonly number[])[];
  /** client03. Ghost-snare funk over two bars: { s 0..31, vel 0..1, core }, 1..12 each, 1..6. Default CLIENT_GHOSTS. */
  ghosts?: readonly (readonly { s: number; vel: number; core: boolean }[])[];
  /** client03. The break hats' per-step slice pitch (multiplies the highpass): exactly 16 values 0.5..1.5, 1..6. Default CLIENT_HAT_WARP. */
  warps?: readonly (readonly number[])[];
  /** client03. The open slice (step 0..15) and 0..4 steps stuttered in 32nds when busy, 1..6. Default CLIENT_HAT_CHOPS. */
  chops?: readonly { open: number; steps: readonly number[] }[];
  /** client03. Bass figures over two bars, 1..24 notes each, 1..6. Default CLIENT_BASS. */
  riffs?: readonly (readonly ElectroRiffNote[])[];
  /**
   * client03, opt-in (left out: no answer). The lead's answers to the bass riff, on the style's `leads`: two-bar
   * figures { s 0..31, semi -12..24 over the tonic two octaves above the bass floor, len 0.25..16 16ths, core }, 1..16
   * notes each, 1..6. Picked with the riff's hash: with as many answers as riffs, answer i plays with riff i. Core
   * notes play wherever the lead speaks (from the build's bar 12), the rest only on a busy chain.
   */
  answers?: readonly (readonly { s: number; semi: number; len: number; core: boolean }[])[];
  /**
   * client03, alienrave. Computer-voice words: onset step 0..15 and 1..8 syllables [F1 Hz 200..1200, F2 Hz 600..3000,
   * consonant "k" | "t" | "p" | "s" | null] (a phrase of eight is "SYS-TEM RE-CEIVES HU-MAN SIG-NAL"). 1..6. Default
   * CLIENT_WORDS on client03; alienrave speaks only when the style gives words (CLIENT_VOICE's voice).
   */
  words?: readonly { s: number; syl: readonly (readonly [number, number, "k" | "t" | "p" | "s" | null])[] }[];
  /** alienrave. Open-hat steps (0..15, 0..4 a bar), 1..6. Default ALIEN_OPEN_HATS. */
  opens?: readonly (readonly number[])[];
  /**
   * alienrave. 16th bass lines of 6..16 steps (shorter ones phase against the bar): each a rest (null) or
   * [semitones over the chord root -12..24, flags 0..7: 1 accent, 2 slide into the next, 4 ornament]. 1..6. Default ALIEN_BASS.
   */
  lines?: readonly (readonly (readonly [number, number] | null)[])[];
  /** alienrave. Hoover stabs over two bars: { s 0..31, len 0.25..16, core }, 1..10 each, 1..6. Default ALIEN_STABS. */
  stabs?: readonly (readonly { s: number; len: number; core: boolean }[])[];
  /** alienrave. Arp cells: indices into the chord's tones (past the last one = an octave up), 2..16 values 0..11, 1..6. Default ALIEN_ARPS. */
  arpCells?: readonly (readonly number[])[];
  /** alienrave. Robot calls: onset step 0..15, length 1..16 16ths, 1..4 vowels [F1 Hz 200..1200, F2 Hz 600..3000]. 1..6. Default ALIEN_VOX. */
  calls?: readonly { s: number; len: number; vowels: readonly (readonly [number, number])[] }[];
  /** classic, client03, alienrave. A polymetric machine sequence on the lead patch. Default none. */
  seq?: ElectroSeqSpec;
  /** classic, client03, alienrave. Metallic FM percussion on its own cycle. Default none. */
  metal?: ElectroMetalSpec;
  /** classic, client03, alienrave. Hat and ghost microtiming. Default none (on the grid). */
  jitter?: ElectroJitter;
  /** classic, client03, alienrave. The drum kit, merged over the base's (ELECTRO_KITS). */
  kit?: Partial<ElectroKit>;
  /** classic, client03, alienrave. The bass voice, merged over the base's (ELECTRO_BASS_TONES). */
  bassTone?: Partial<ElectroBassSpec>;
  /** client03. The ghostly pad (reads osc, cutoff, q, attack, release, level). */
  pad?: Partial<PadSpec>;
  /** client03. The computer voice. */
  voice?: Partial<ElectroVoiceSpec>;
  /** alienrave. The hoover stab voice. */
  hoover?: Partial<HooverSpec>;
  /** alienrave. The robot call voice. */
  vox?: Partial<VoxSpec>;
  /** alienrave, opt-in. The glitch row's laser, merged over the base's (from 2400, color 2600, q 6, level 0.28); level 0 mutes it. Default: the base's. */
  laser?: Partial<LaserSpec>;
  /** alienrave, opt-in. The sci-fi arp's voice, merged over the base's (open 3, color 3, cap 11000, q 5, level 0.22); level 0 mutes it. */
  arp?: Partial<AlienArpSpec>;
  /**
   * Every base. The attention layer's robot word, the voice a mention of the token plays (engine.ts robotWord), merged
   * field by field over the base's preset (ROBOT_WORDS). Default: the base's preset.
   */
  ornament?: Partial<RobotWordSpec>;
}

/**
 * The electro robot word (attention layer: one per mention of the token). A buzzy oscillator through two formants
 * per syllable, crushed, gated; smart mentions play it louder, an octave up and echoed.
 */
export interface RobotWordSpec {
  /** 1..4 syllables, [F1 Hz 150..1200, F2 Hz 500..3500] each ("ah" ~ [700, 1200], "ee" ~ [400, 2200], "oo" ~ [330, 650]). */
  vowels: readonly (readonly [number, number])[];
  /** The buzz: "square" (classic), "sawtooth" (brighter), "triangle" / "sine" (softer). */
  wave: OscillatorType;
  /** Crush steps per half wave 2..16: fewer is rougher (Cold 808: 3, Client_03: 6). */
  steps: number;
  /** Register in semitones from MIDI 48 + the tonic, -24..24. */
  octave: number;
  /** Syllable length in 16ths, 0.5..4. */
  syllable: number;
  /** Ring modulation, a sine at this ratio of the pitch, 0..4 (0 = off; 1.5 is metallic). */
  ring: number;
  /** Lowpass Hz 0..12000 (0 = open). */
  lowpass: number;
  /** An echo on every mention ({ steps 1..8 16ths, feedback 0..0.7 }), or null: only smart mentions are echoed. */
  echo: { steps: number; feedback: number } | null;
  /** Peak 0.01..0.1 (smart: x1.6): the word stays a quiet answer under the track. */
  level: number;
  /** The bar's 16ths it may land on, 1..8 of 0..15 (default the offbeats 2, 6, 10, 14). */
  slots: readonly number[];
}

// ------------------------------------------------------------------------------------------------ ambientidm

/**
 * An Ambient IDM chord, semitones from the tonic. The genre's note set is the minor pentatonic (0 3 5 7 10): the
 * house chords are sus / add9 / quartal colours built only from it; stay inside it.
 */
export interface AmbientChord {
  /** The bass root, near the tonic. -12..12. */
  bass: number;
  /** Pad voicing over 48 + tonic, 2..6 tones -24..26 (Tape Haze plays the tones at and above 0: give it two). */
  pad: readonly number[];
  /** Crystal's glass bed over 60 + tonic, 2..6 tones -12..31 (its bells strike the top three in 7..19). */
  glass: readonly number[];
  /** The four chord tones low to high, -12..24, for the Tape Keys figures and the Crystal arps. */
  arp: readonly number[];
  /** Melody tones by role, -12..24: [3rd (or 4th), 5th, colour (9th / 11th / 6th), root, 7th (or 6th)]. */
  sing: readonly number[];
}

/** One oscillator of a stacked voice, at `oct` octaves over the note (-1..2): wave, detune cents -40..40, level 0..1. */
export interface AmbientOsc extends PadOsc {
  oct: number;
}

/** A partial of the glass bed: wave, frequency ratio over the note 0.5..8, detune cents -40..40, level 0..1. */
export interface AmbientPartial {
  type: Wave;
  ratio: number;
  detune: number;
  level: number;
}

/** The filtered noise of a hit (Crystal's crack and ticks): filter at `freq` Hz 100..16000, `q` 0.3..12, decay s 0.005..0.5, level 0..1. */
export interface AmbientNoise {
  noise: "bandpass" | "highpass" | "lowpass";
  freq: number;
  q: number;
  decay: number;
  level: number;
}

/**
 * An Ambient IDM kit; each base plays its own part of it. classic: `kick`, `snare` (the tape snare on the backbeat
 * and the chain's ghosts), `hat` (even 16ths). boc: `kick` and `thump` (a lowpassed puff under it, level 0..0.2),
 * `snare` and `dust` (the backbeat: body and crack, then a darker dust layer nearer the centre), `ghost` (the chain's
 * ghosts), `hat` (the 16ths), `open` (the "and" of each beat). crystal: `click` (the click kick, layers on the kick
 * bus), `rim` (the backbeat rim: level 0..1, pitch 0.5..2.5) with `crack` over it, `tick` (the ghosts, on the perc
 * bus), `hat` (even 16ths), `open` (odd 16ths). The chain's velocity scales every hit.
 */
export interface AmbientKit {
  kick: KickSpec;
  thump: number;
  click: DrumVoice;
  snare: DrumVoice;
  dust: DrumVoice;
  ghost: DrumVoice;
  rim: { level: number; pitch: number };
  crack: AmbientNoise;
  tick: AmbientNoise;
  hat: HatSpec;
  open: HatSpec;
}

/** Tape Haze's round analog bass: oscillators on the chord root through a lowpass, over a sine sub. */
export interface AmbientBassSpec {
  /** 1..4 oscillators (wave, detune, level). */
  osc: readonly PadOsc[];
  /** Lowpass, Hz 80..1200 (colour and heat open it, sells close it). */
  cutoff: number;
  /** Peak level 0..0.2 and the sine sub under it 0..0.25. */
  level: number;
  sub: number;
}

/** Tape Haze's cheap keyboard lead: 1..4 oscillators (`oct` octaves up), a lowpass, a pitch scoop into each note. */
export interface AmbientLeadSpec {
  osc: readonly AmbientOsc[];
  /** Lowpass, Hz 200..6000. */
  cutoff: number;
  /** Peak level 0..0.3. */
  level: number;
  /** The scoop up into the note, cents 0..100 (0 = straight onto the pitch). */
  scoop: number;
  /** Tape wow depth, cents 0..30. */
  vib: number;
}

/** The slow high line (Tape Keys, Crystal): 1..4 oscillators (sine-and-triangle), a lowpass, a level. */
export interface AmbientLineSpec {
  /** Peak level 0..0.06. */
  level: number;
  /** Lowpass, Hz 600..9000 (colour opens it). */
  cutoff: number;
  osc: readonly PadOsc[];
}

/** Crystal's glass bed: 1..6 partials per chord tone, highpassed, a slow lowpass bloom. */
export interface AmbientGlassSpec {
  /** Peak level 0.005..0.25. */
  level: number;
  partials: readonly AmbientPartial[];
  /** Lowpass the bloom opens to, Hz 800..9000; highpass Hz 40..1000. */
  cutoff: number;
  hp: number;
  /** Attack s 0.05..8 (capped to a third of the chord), release s 0.1..8. */
  attack: number;
  release: number;
}

/** Crystal's struck bells (an FM pair: glass on the strike, a sine in the tail). */
export interface AmbientBellSpec {
  /** Peak level 0..0.12. */
  level: number;
  /** Modulator ratio 0.5..8 (3.49 is glass; integers ring like a music box), strike index 0..8 (x the pitch). */
  ratio: number;
  index: number;
  /** Decay s 0.1..4. */
  decay: number;
}

/** Crystal's arp voice: sines at ratios over the note, a soft attack and a short ring. */
export interface AmbientShimmerSpec {
  /** Peak level 0..0.4. */
  level: number;
  /** 1..4 sines: ratio 0.5..8, detune cents -40..40, level 0..1. */
  partials: readonly { ratio: number; detune: number; level: number }[];
  /** Ring, s: `decay` 0.05..3 on eighths and slower, `short` 0.05..3 on sixteenths (heat shortens both a little). */
  decay: number;
  short: number;
}

/** Ambient IDM. Bases: "classic" (Tape Keys), "boc" (Tape Haze), "crystal" (Crystal). */
export interface AmbientIdmData extends SoundData {
  /** classic, boc, crystal. The chord table progressions index into: 2..8 chords. Default AMBIENT_CHORDS. */
  chords?: readonly AmbientChord[];
  /** classic, boc, crystal. Progressions as indices into `chords`, four bars a chord: 1..8 chords each, 1..6. Default AMBIENT_PROGRESSIONS. */
  progressions?: readonly (readonly number[])[];
  /**
   * classic. The warm-keys ostinato over two bars: [step 0..31, arp tone 0..6, density tier 0..2], 1..12 notes, 1..6
   * figures. Arp tone 0-3 the chord tones, 4-5 the root and third an octave up, 6 the colour tone on top. Tier 0 always
   * plays, 1 and 2 join as the chain gets busier (`tiers`). It rests every eighth bar. Default AMBIENT_KEYS_FIGURES.
   */
  figures?: readonly (readonly (readonly [number, number, number])[])[];
  /**
   * boc. The tune over eight bars: [step 0..127, sing role 0..4, length in 16ths 1..32, octave -1..1, density tier
   * 0..2], 1..12 notes, 1..6 phrases. The chord under it changes at step 64; the repeat moves its last tier-0 note.
   * Default AMBIENT_HAZE_PHRASES.
   */
  phrases?: readonly (readonly (readonly [number, number, number, number, number])[])[];
  /**
   * crystal. Arp cells: indices into the chord's tones over two octaves (0-3, 4-7 an octave up, 8 the root two
   * octaves up), 2..16 per cell, 1..6 cells; their lengths cycle against the bar. Default AMBIENT_CRYSTAL_ARPS.
   */
  arps?: readonly (readonly number[])[];
  /**
   * classic, boc, crystal. Density thresholds [low, high], 0..1 ascending: where tier 1 and tier 2 notes join
   * (classic, boc), or where the arp goes from quarters to eighths and from eighths to sixteenths (crystal). Lower =
   * busier. Default classic [0.36, 0.68], boc [0.42, 0.72], crystal [0.1, 0.5].
   */
  tiers?: readonly [number, number];
  /** boc, crystal. The note pool of the tape-slip blips (boc) and the micro-edit clicks (crystal): 2..12 semitones 0..24. Default the genre's notes. */
  notes?: readonly number[];
  /** classic, boc, crystal. The drum kit, merged over the base's (AMBIENT_KITS); each base plays its own part. */
  kit?: Partial<AmbientKit>;
  /** classic, boc. The pad (classic: the tape pad, reads osc, cutoff, q, attack, release, level, vib = wow; boc: the warped pad, also drive, hp). */
  pad?: Partial<PadSpec>;
  /** boc. The analog bass. */
  bass?: Partial<AmbientBassSpec>;
  /** boc. The tune's keyboard. */
  lead?: Partial<AmbientLeadSpec>;
  /** classic, crystal. The slow high line. */
  line?: Partial<AmbientLineSpec>;
  /** crystal. The glass bed. */
  glass?: Partial<AmbientGlassSpec>;
  /** crystal. The bells on the bar. */
  bell?: Partial<AmbientBellSpec>;
  /** crystal. The arp voice. */
  shimmer?: Partial<AmbientShimmerSpec>;
}

// ----------------------------------------------------------------------------------------------------- drone

/**
 * A drone pad layer (Wall's `wall`, Dark Low's `pad`): per voice of the voicing, a detuned pair of oscillators
 * panned apart, through a low-Q lowpass whose cutoff breathes on a slow sine between `cutoff` and `cutoff` x `range`.
 */
export interface DronePadSpec {
  /** Peak level 0.005..0.15. */
  level: number;
  /** Wave per voice, low to high; voices past the list take its last wave. 1..6. */
  waves: readonly Wave[];
  /** Detune ± cents per side 0..20, plus `spread` cents 0..8 per voice up (wider = slower beating up high). */
  detune: number;
  spread: number;
  /** Lowpass floor Hz 150..2000, plus `glow` Hz 0..1500 with the market's brightness; the top is `range` 1..3 times it (heat adds a little). */
  cutoff: number;
  glow: number;
  range: number;
  /** Breathing period, s 6..60 (the epoch adds a few seconds, heat quickens it). */
  period: number;
  /** Wall: how far the level dips on each breath, 0..0.6. */
  depth?: number;
  /** Wall: the detune drift, ± cents 0..12 on a very slow sine (moves the beating). */
  drift?: number;
  /** Wall: the still sine core under the pad, [semitones -24..0 over the voicing's root, level 0..0.5], 0..3. */
  core?: readonly (readonly [number, number])[];
}

/** Dark Low's bed: beating sine pairs under the pad (`subs` on the bass bus, `body` a hollow fifth in the room). */
export interface DroneBedSpec {
  /** Sub level 0..0.12 and body level 0..0.15. */
  subLevel: number;
  bodyLevel: number;
  /** [semitones over the bass tonic -12..24, detune cents -30..30 (x the beat), level 0..1]: 1..6 sines each. */
  subs: readonly (readonly [number, number, number])[];
  body: readonly (readonly [number, number, number])[];
  /** Beat speed, a multiplier on the detunes 0.2..2 (heat adds up to 1.05). */
  beat: number;
  /** tanh drive on the subs 0.5..3 (heat adds a little). */
  drive: number;
  /** The body's lowpass floor, Hz 100..900 (colour opens it, sells close it). */
  cutoff: number;
}

/**
 * The drone's slow-ish bells (Wall's high glints, Dark Low's far bowls, Overtone Pulse's glass partials): at most
 * one per `gap` beats (1..8) on the chain's glitch hits; level 0..0.06, decay s 0.5..10 (a quiet market rings
 * longer), attack s 0.005..1, lowpass `top` Hz 500..8000.
 */
export interface DroneGlintSpec {
  level: number;
  decay: number;
  attack: number;
  top: number;
  gap: number;
}

/** Overtone Pulse's series: its level, the lowpass over it, and how deep each group breathes. */
export interface DroneOvertoneSpec {
  /** Peak level 0.02..0.4. */
  level: number;
  /** Lowpass Hz 400..6000, plus `glow` Hz 0..3000 with the market's brightness. */
  cutoff: number;
  glow: number;
  /** Breath depth per group 0..3, each 0..1 (group 0 the fundamental and octave: keep it shallow). Exactly 4. */
  depths: readonly number[];
}

/** One partial of the Overtone Pulse series: harmonic `n` 1..16, level `g` 0..0.5, breathing group 0..3 (3 only when busy). */
export interface DronePartial {
  n: number;
  g: number;
  group: number;
}

/**
 * Drone. Bases: "classic" (Wall), "dark" (Dark Low), "pulse" (Overtone Pulse). Nothing gates or builds: a drone is
 * its layers, their slow breathing and the glints over them.
 */
export interface DroneData extends SoundData {
  /** classic, dark, pulse. Phrase length in bars, 2..16: a new layer every phrase. Default classic 4, dark 8, pulse 4. */
  bars?: number;
  /**
   * classic, dark. The voicing, semitones -12..48 (classic: over 48 + tonic; dark: over the bass tonic), 2..6 tones
   * low to high. Default classic [0, 7, 12, 19, 24], dark [24, 31, 36].
   */
  voicing?: readonly number[];
  /** classic. Every other phrase plays one of these instead of `voicing` (the epoch walks them): 1..4 voicings of 2..6. Default DRONE_WALL_COLOURS. */
  colours?: readonly (readonly number[])[];
  /** classic, dark. The tone a busy chain adds over the voicing, -12..48. Default classic 31, dark 43. */
  busy?: number;
  /**
   * classic, dark, pulse. The glint pitches, 1..8 (pulse: 2..8): classic semitones 0..36 over 60 + tonic; dark
   * semitones 0..36 over the bass tonic two octaves up; pulse harmonic numbers 2..16 of the series. Default
   * DRONE_GLINT_NOTES / DRONE_BOWL_NOTES / DRONE_GLASS.
   */
  glints?: readonly number[];
  /** pulse. The harmonic series, 1..12 partials. Default DRONE_PARTIALS. */
  partials?: readonly DronePartial[];
  /** pulse. Which phrases bring the just fifth in: 1..6 figures of 1..8 values 0 or 1; the epoch picks one, it cycles. Default DRONE_PULSE_FIGURES. */
  figures?: readonly (readonly number[])[];
  /** classic. The wall's pad layers. */
  wall?: Partial<DronePadSpec>;
  /** dark. The cave pad (reads level, waves, detune, spread, cutoff, glow, range, period). */
  pad?: Partial<DronePadSpec>;
  /** dark. The beating sub bed. */
  bed?: Partial<DroneBedSpec>;
  /** dark. The rare concussion: a long, low swept sine (start 30..120 Hz, end 20..80, sweep s 0.05..1.5, decay s 0.3..3). */
  kick?: Partial<KickSpec>;
  /** pulse. The series' level, filter and breathing. */
  overtone?: Partial<DroneOvertoneSpec>;
  /** classic, dark, pulse. The glints' voice and rate. */
  glint?: Partial<DroneGlintSpec>;
  /** classic. The breath under the wall (soft band-limited noise), level 0..0.08 (0 = none). Default 0.022. */
  breath?: number;
  /** dark. The cave rumble (low noise that follows the sells), level 0..0.12 (0 = none). Default 0.042. */
  rumble?: number;
  /** classic, pulse. The rare deep sub swell, level 0..0.15 (0 = none). Default 0.06. */
  swell?: number;
}

/** The data type of each opened genre. */
export interface GenreDataMap {
  liquid: LiquidData;
  futuregarage: GarageData;
  triphop: TripHopData;
  lofihouse: LofiHouseData;
  acid: AcidData;
  dubtechno: DubTechnoData;
  electro: ElectroData;
  ambientidm: AmbientIdmData;
  drone: DroneData;
}
export type StyleData = GenreDataMap[keyof GenreDataMap];

/** The genres whose renderers read `data` (docs/STATIONS.md: start with the most table-driven). */
export const DATA_GENRES = ["liquid", "futuregarage", "triphop", "lofihouse", "acid", "dubtechno", "electro", "ambientidm", "drone"] as const;
export type DataGenre = (typeof DATA_GENRES)[number];

/** The sound fields every base of every opened genre reads (SoundData). */
const SOUND = ["mix", "fx", "vinyl"] as const;

/**
 * Which data fields each base renderer reads. A field outside its base's list is refused (it would do nothing).
 * Notes and rhythm first, then the sound fields. Bases of a genre share their drum engine and voice code where the
 * field name is the same (liquid's three bases one break engine, `kit`; every genre's `bass` is the shared sine sub).
 */
export const DATA_FIELDS: { readonly [G in DataGenre]: Readonly<Record<string, readonly (keyof GenreDataMap[G])[]>> } = {
  liquid: {
    classic: ["vamps", "stabs", "answers", "contours", "walks", "kit", "fills", "sub", ...SOUND, "bass", "reese", "pad", "ornament"],
    atmos: ["vamps", "phrases", "contours", "kit", "fills", "sub", ...SOUND, "bass", "reese", "pad", "choir", "ornament"],
    soulful: ["progressions", "walks", "comps", "kit", "fills", "sub", ...SOUND, "bass", "reese", "strings", "ornament"],
  },
  futuregarage: {
    classic: ["chords", "progressions", "skips", "kicks", "sub", "stabs", "basslines", "motifs", "calls", ...SOUND, "kit", "bass", "pad", "vowels", "rain", "ornament", "ukg"],
    dark: ["chords", "progressions", "foley", "kicks", "sub", ...SOUND, "kit", "bass", "reese", "choir", "rain", "ornament"],
    atmos: ["vamps", "choirs", "pans", "kicks", "sub", ...SOUND, "kit", "bass", "pad", "choir", "rain", "ornament"],
  },
  triphop: {
    classic: ["chords", "progressions", "statements", "answers", "turns", "space", "kicks", "sub", ...SOUND, "kit", "bass", "bowed"],
    bristol: ["kicks", "pedal", "strings", "calls", ...SOUND, "kit", "bass", "bassTone", "bowed"],
    cinematic: ["voicings", "cuts", ...SOUND, "kit", "bass", "bassTone", "bowed"],
  },
  lofihouse: {
    classic: ["vamps", "stabs", "sub", ...SOUND, "kit", "bass"],
    chop: ["vamps", "chops", "sub", ...SOUND, "kit", "bass", "chop", "pump"],
    rave: ["vamps", "stabs", "organ", ...SOUND, "kit", "bass", "organTone", "pad"],
  },
  acid: {
    classic: ["lines", ...SOUND, "kit", "voice"],
    acidhouse: ["lines", ...SOUND, "kit", "voice"],
    rubber: ["lines", ...SOUND, "kit", "voice"],
  },
  dubtechno: {
    classic: ["chords", "progressions", "figures", "accents", "stabBars", "bassline", "bells", "percs", "claps", "hats", ...SOUND, "kit", "subTone", "stabTone", "padTone", "bellTone", "sweep", "field", "rumble", "echoTone", "melody"],
    ixtlan: ["chords", "progressions", "figures", "accents", "stabBars", "bassline", "bells", "percs", "claps", "hats", ...SOUND, "kit", "subTone", "stabTone", "padTone", "bellTone", "sweep", "field", "rumble", "echoTone", "melody"],
    moment: ["chords", "progressions", "figures", "accents", "stabBars", "bassline", "bells", "percs", "claps", "hats", ...SOUND, "kit", "subTone", "stabTone", "padTone", "bellTone", "sweep", "field", "rumble", "echoTone", "melody"],
  },
  electro: {
    classic: ["kicks", "arps", "seq", "metal", "jitter", ...SOUND, "kit", "bassTone", "ornament"],
    client03: ["chords", "progressions", "kicks", "ghosts", "warps", "chops", "riffs", "answers", "words", "seq", "metal", "jitter", ...SOUND, "kit", "bassTone", "pad", "voice", "ornament"],
    alienrave: ["chords", "progressions", "kicks", "opens", "lines", "stabs", "arpCells", "calls", "words", "seq", "metal", "jitter", ...SOUND, "kit", "bassTone", "hoover", "vox", "laser", "arp", "ornament"],
  },
  ambientidm: {
    classic: ["chords", "progressions", "figures", "tiers", ...SOUND, "kit", "pad", "line"],
    boc: ["chords", "progressions", "phrases", "tiers", "notes", ...SOUND, "kit", "pad", "bass", "lead"],
    crystal: ["chords", "progressions", "arps", "tiers", "notes", ...SOUND, "kit", "line", "glass", "bell", "shimmer"],
  },
  drone: {
    classic: ["bars", "voicing", "colours", "busy", "glints", ...SOUND, "wall", "glint", "breath", "swell"],
    dark: ["bars", "voicing", "busy", "glints", ...SOUND, "pad", "bed", "kick", "glint", "rumble"],
    pulse: ["bars", "glints", "partials", "figures", ...SOUND, "overtone", "glint", "swell"],
  },
};

/** The parts of the Ambient IDM kit each base plays (AmbientKit); validatePack refuses the others. */
export const AMBIENT_KIT_PARTS: Readonly<Record<keyof (typeof DATA_FIELDS)["ambientidm"], readonly (keyof AmbientKit)[]>> = {
  classic: ["kick", "snare", "hat"],
  boc: ["kick", "thump", "snare", "dust", "ghost", "hat", "open"],
  crystal: ["click", "rim", "crack", "tick", "hat", "open"],
};
