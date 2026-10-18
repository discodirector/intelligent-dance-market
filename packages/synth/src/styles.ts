import { eraOf, type Era, type GenreId } from "./eras.ts";
import { hash32 } from "./hash.ts";

/**
 * Styles: each genre has several distinct sound worlds (kit, groove, bass, harmony treatment, processing).
 * Each appearance of a genre plays ONE style for its whole epoch. Appearances walk the genre's styles in list
 * order, round and round: the first appearance plays style 1, the second style 2, and so on.
 *
 * The id "classic" marks the sound the genre had before styles existed; it need not be listed first.
 * Changing the list after launch changes which style past appearances played: append only, and know that even
 * an append shifts the rotation of every later appearance.
 * Every field except id/name is optional and falls back to the genre's value in eras.ts.
 */
export interface GenreStyle {
  id: string;
  name: string;
  /** Tempo range override (the chain bpm maps linearly into it). */
  bpm?: readonly [number, number];
  swing?: number;
  microScale?: number;
  /** Loudness multiplier on top of the genre trim, so every style lands at the genre's level. */
  trim?: number;
  /** Lead patch ids (leads.ts) this style picks from; overrides the genre list. */
  leads?: readonly string[];
}

export const GENRE_STYLES: Record<GenreId, readonly GenreStyle[]> = {
  // Listed in play order: a genre's appearances walk its styles 1, 2, 3, 1, 2, 3 ... (owner's order, 2026-10-18).
  liquid: [
    { id: "classic", name: "Keys", trim: 0.955 },
    // Calibre / Marcus Intalex: a rolling break, jazzy four-chord Rhodes comping, strings and a walking sub.
    { id: "soulful", name: "Soulful", bpm: [170, 174], swing: 0.52, microScale: 0.2, leads: ["liquidRhodes"] },
    { id: "atmos", name: "Atmospheric", bpm: [164, 170], swing: 0.53, trim: 1.092, leads: ["rhodes", "flute"] },
  ],

  wonky: [
    // J Dilla / Slum Village: the clock is straight; the snare and hats are dragged by a composed per-voice feel.
    { id: "classic", name: "Dilla Swing", swing: 0.5, microScale: 0.04, trim: 1.52 },
    // Flying Lotus / Cosmogramma: a swung, off-grid crunchy beat under woozy analog chords.
    { id: "brainfeeder", name: "Brainfeeder", bpm: [84, 94], swing: 0.57, microScale: 0.2, trim: 1.1 },
    // Prefuse 73 / Machinedrum: tight and quicker, so the stutters and retriggers read as edits.
    { id: "glitch", name: "Glitch-hop", bpm: [88, 98], swing: 0.52, microScale: 0.05, trim: 1.684 },
  ],

  triphop: [
    { id: "bristol", name: "Bristol Dark", bpm: [72, 82], swing: 0.575, trim: 1.085, leads: ["triphop_theremin"] },
    { id: "cinematic", name: "Cinematic", bpm: [88, 100], swing: 0.545, trim: 1.526, leads: ["triphop_piano"] },
    { id: "classic", name: "Rhodes Break", trim: 1.424, leads: ["triphop_rhodes"] },
  ],

  lofihouse: [
    // Mall Grab / Baltra: crunchy drums, M1 piano stabs, organ bass, a hoover-ish rave pad.
    { id: "rave", name: "Raw Rave", bpm: [124, 130], swing: 0.53, leads: ["lofihouse_m1"], trim: 0.83 },
    // DJ Seinfeld / Ross From Friends: a filtered chord sample chopped on a loop, pumping under the kick.
    { id: "chop", name: "Sample Chop", bpm: [119, 124], swing: 0.6, trim: 0.9 },
    { id: "classic", name: "Dusty Keys", trim: 1.064 },
  ],

  futuregarage: [
    // Harder shuffle, slower-feeling; the reese and the choir carry it, the vocal is only a ghost.
    { id: "dark", name: "Dark Sub", bpm: [134, 140], swing: 0.63, microScale: 0.45, trim: 0.86 },
    { id: "atmos", name: "Rain Atmos", bpm: [126, 132], swing: 0.6, leads: ["garagepan"], trim: 1.049 },
    // Tight enough that the chopped hook sits on the shuffle.
    { id: "classic", name: "Vocal Chops", microScale: 0.3, trim: 1.018 },
  ],

  electro: [
    // Denso / Manao: fast, straight and machine-tight, so the 16th bass and the hats lock together.
    { id: "alienrave", name: "Alien Rave", bpm: [128, 136], swing: 0.5, microScale: 0.04, trim: 0.798 },
    { id: "classic", name: "Cold 808", trim: 0.979 },
    // Client_03: dark machine funk. Swung enough to limp, tight enough to stay a machine.
    { id: "client03", name: "Client_03", bpm: [126, 132], swing: 0.555, microScale: 0.3, trim: 0.68 },
  ],

  drone: [
    // Stars of the Lid: wide pad layers crossfading every four bars.
    { id: "classic", name: "Wall", trim: 2.13 },
    // Lustmord, softened: almost no grid, the beat is the slow interference of the subs.
    { id: "dark", name: "Dark Low", bpm: [44, 58], swing: 0.5, microScale: 2.6, trim: 1.27 },
    // Straight, so the partials' breathing locks to the bar: one breath per one or two bars.
    { id: "pulse", name: "Overtone Pulse", bpm: [74, 96], swing: 0.5, microScale: 0.25, trim: 1.76 },
  ],

  ambientidm: [
    // Boards of Canada: slow, shuffled, the pad swims and the drums stay dusty.
    { id: "boc", name: "Tape Haze", bpm: [76, 90], swing: 0.63, microScale: 2.1, trim: 1.62 },
    { id: "classic", name: "Tape Keys", trim: 1.285, leads: ["warmkeys"] },
    // Amber / Schnauss: straight, a little quicker, tight enough that the micro-edits read as edits.
    { id: "crystal", name: "Crystal", bpm: [104, 118], swing: 0.5, microScale: 0.4, trim: 1.33, leads: ["ambientidm-glass"] },
  ],

  dubtechno: [
    // Brickman / Lucidflow: deep, warm and rolling. Kick, rolling sub, soft clap and shaker, m9 stabs on a
    // two-to-four chord progression into the echo, a warm pad under them, bell fragments, rain.
    { id: "classic", name: "Lucidflow", bpm: [119, 123], swing: 0.54, microScale: 0.15, trim: 0.88 },
    // Brickman's Ixtlan: the ambient journey. Longer chords, the pad and the rain up front, a slow bell melody,
    // softer drums over a steady pulse.
    { id: "ixtlan", name: "Ixtlan", bpm: [117, 121], swing: 0.53, microScale: 0.2, trim: 0.9 },
    // Brickman's The Moment: minimal-techno leaning. A looping stab figure with the filter on the move, a 16th
    // sub roll, a rim, drier and tighter, still warm.
    { id: "moment", name: "The Moment", bpm: [121, 124], swing: 0.52, microScale: 0.1, trim: 0.92 },
  ],

  acid: [
    { id: "classic", name: "303 Floor", trim: 1.44 },
    { id: "acidhouse", name: "Acid House", bpm: [120, 126], swing: 0.5, microScale: 0.06, trim: 1 },
    { id: "rubber", name: "Slow Rubber", bpm: [110, 118], swing: 0.565, microScale: 0.35, trim: 0.975 },
  ],
};

export interface StyleChoice {
  index: number;
  style: GenreStyle;
}

const appearanceCache = new Map<number, number>();

/** How many times this epoch's genre appeared before it (0 = first appearance). */
function appearance(epoch: number): number {
  const hit = appearanceCache.get(epoch);
  if (hit !== undefined) return hit;
  const idx = eraOf(epoch).index;
  let k = 0;
  for (let e = 0; e < epoch; e++) if (eraOf(e).index === idx) k++;
  appearanceCache.set(epoch, k);
  return k;
}

/**
 * The style of a genre instance. When `era` is the epoch's own genre, its appearances walk the list in order; for a
 * forced genre (gallery, sketches) the epoch hash picks one.
 */
export function styleOf(era: Era, epoch: number): StyleChoice {
  const list = GENRE_STYLES[era.id];
  const n = list.length;
  const e = Number.isFinite(epoch) ? Math.max(0, Math.floor(epoch)) : 0;
  let index: number;
  if (n === 1) index = 0;
  else if (eraOf(e).index !== era.index) index = hash32(e, era.index, 0x5717) % n;
  else index = appearance(e) % n;
  return { index, style: list[index] };
}

/** Style by id within a genre (sketch scripts, tests). */
export function styleById(era: Era, id: string): StyleChoice {
  const index = GENRE_STYLES[era.id].findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`unknown style ${era.id}/${id}`);
  return { index, style: GENRE_STYLES[era.id][index] };
}

/** Genre values with the style's overrides applied. */
export function styleFeel(era: Era, style: GenreStyle) {
  return {
    bpm: style.bpm ?? era.bpm,
    swing: style.swing ?? era.swing,
    microScale: style.microScale ?? era.microScale,
    trim: era.trim * (style.trim ?? 1),
  };
}
