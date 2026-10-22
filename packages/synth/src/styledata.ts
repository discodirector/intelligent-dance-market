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
  /** soulful. Sub walks over one chord (two bars, onsets 0..31); `oct` 0 or 1 = an octave up. 1..6 of 1..12. Default LIQUID_SOUL_BASS. */
  walks?: readonly (readonly (CoreNote & { oct: number })[])[];
  /** soulful. Rhodes comping over one chord (onsets 0..31; a hit on 30+ plays the next chord early). 1..6 of 1..10. Default LIQUID_SOUL_COMP. */
  comps?: readonly (readonly CoreNote[])[];
  /** classic, atmos, soulful. The sub's voice (classic: `octave` 0.14 is its octave layer). */
  bass?: Partial<SubSpec>;
  /** classic, atmos. The tape pad (reads osc, cutoff, q, attack, release, level, vib = wow depth). */
  pad?: Partial<PadSpec>;
  /** atmos. The airy formant choir over the pads (reads osc, cutoff, q, attack, release, level, vib). */
  choir?: Partial<PadSpec>;
  /** soulful. The string swells (reads osc, cutoff, q, attack, release, level, vib; the swell takes 55% of the chord unless `attack` is shorter). */
  strings?: Partial<PadSpec>;
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

/** Dub techno. Bases: "classic" (Lucidflow), "ixtlan" (Ixtlan), "moment" (The Moment). Every base reads every field. */
export interface DubTechnoData extends SoundData {
  /** Chords by name, merged over the house set (i9 i11 iv7 VI9 VII9 v7). Default DUB_CHORDS. */
  chords?: Readonly<Record<string, DubChordSpec>>;
  /** 1..6 progressions; the epoch picks one. Default DUB_STYLES[base].progs. */
  progressions?: readonly DubProgression[];
  /**
   * Stab figures: steps of one bar (0..15), 1..6 hits, played every bar; the last hit is the answer only a busy chain
   * adds. 1..6 figures, one per epoch. Default DUB_STYLES[base].figures.
   */
  figures?: readonly (readonly number[])[];
  /** Level of each figure hit in order (cycled), 1..6 values 0..1.5. Default DUB_STYLES[base].accents. */
  accents?: readonly number[];
  /**
   * The sub's figure per bar: [step 0..15, length in 16ths 0.25..16, level 0..1.5, interval over the chord root
   * 0..24 (optional: 7 the fifth, 12 the octave)], 1..16 notes. Default DUB_STYLES[base].bass.notes.
   */
  bassline?: readonly (readonly [number, number, number, number?])[];
  /** Bell fragments over four bars: [16th 0..63, chord tone from the top 0..5, level 0..1.5], 1..8 each, 1..6 fragments. */
  bells?: readonly (readonly (readonly [number, number, number])[])[];
  /** The percussion's two-bar figure: [16th 0..31, pitch ratio over the tonic 0.5..3 (1.5 the fifth), level 0..1.5], 1..8. */
  percs?: readonly (readonly [number, number, number])[];
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
  /** Bars per full open-close of the stab and pad filters (`stab`) and of the echo loop's filter (`echo`), 2..64. */
  sweep?: { stab?: number; echo?: number };
  /** The field texture (rain on a window, a far room): level 0..3 (0 = none), band centre Hz 200..6000. */
  field?: { level?: number; hz?: number };
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
  /** 1..4 oscillators: wave, detune cents -40..40, level 0..1 (client03, alienrave). */
  osc: readonly PadOsc[];
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
   * client03. Computer-voice words: onset step 0..15 and 1..4 syllables [F1 Hz 200..1200, F2 Hz 600..3000, consonant
   * "k" | "t" | "p" | "s" | null]. 1..6. Default CLIENT_WORDS.
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
    classic: ["vamps", "stabs", "answers", "contours", "kit", "fills", "sub", ...SOUND, "bass", "pad"],
    atmos: ["vamps", "phrases", "contours", "kit", "fills", "sub", ...SOUND, "bass", "pad", "choir"],
    soulful: ["progressions", "walks", "comps", "kit", "fills", "sub", ...SOUND, "bass", "strings"],
  },
  futuregarage: {
    classic: ["chords", "progressions", "skips", "kicks", "sub", ...SOUND, "kit", "bass", "pad", "vowels", "rain"],
    dark: ["chords", "progressions", "foley", "kicks", "sub", ...SOUND, "kit", "bass", "reese", "choir", "rain"],
    atmos: ["vamps", "choirs", "pans", "kicks", "sub", ...SOUND, "kit", "bass", "pad", "choir", "rain"],
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
    classic: ["chords", "progressions", "figures", "accents", "bassline", "bells", "percs", ...SOUND, "kit", "subTone", "stabTone", "padTone", "bellTone", "sweep", "field"],
    ixtlan: ["chords", "progressions", "figures", "accents", "bassline", "bells", "percs", ...SOUND, "kit", "subTone", "stabTone", "padTone", "bellTone", "sweep", "field"],
    moment: ["chords", "progressions", "figures", "accents", "bassline", "bells", "percs", ...SOUND, "kit", "subTone", "stabTone", "padTone", "bellTone", "sweep", "field"],
  },
  electro: {
    classic: ["kicks", "arps", ...SOUND, "kit", "bassTone"],
    client03: ["chords", "progressions", "kicks", "ghosts", "warps", "chops", "riffs", "words", ...SOUND, "kit", "bassTone", "pad", "voice"],
    alienrave: ["chords", "progressions", "kicks", "opens", "lines", "stabs", "arpCells", "calls", ...SOUND, "kit", "bassTone", "hoover", "vox"],
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
