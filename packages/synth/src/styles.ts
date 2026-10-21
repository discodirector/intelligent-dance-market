import { ERA_SCHEDULE, eraOf, type Era, type EraScheduleEntry, type GenreId } from "./eras.ts";
import { hash32 } from "./hash.ts";
import type { LeadPatch } from "./leads.ts";
import type { Program } from "./program.ts";
import type { StyleData } from "./styledata.ts";

/**
 * Styles: each genre has several distinct sound worlds (kit, groove, bass, harmony treatment, processing).
 * Each appearance of a genre plays ONE style for its whole epoch.
 *
 * Which styles a genre has is versioned by epoch, like the genre pool (ERA_SCHEDULE): STYLE_SCHEDULE is a list of
 * entries `{ fromEpoch, styles: { <genre>: [style, ...] } }`. For an epoch, a genre plays from the list of the last
 * entry that has started (fromEpoch <= epoch) and names that genre. Rotation: the genre's appearances since that
 * entry's fromEpoch walk the list in order, round and round (appearance k since fromEpoch plays style k % n). So a
 * new list starts over at its first style on the genre's first appearance on or after its fromEpoch (put a new
 * style first to hear it at once), and every epoch before fromEpoch keeps the style it had.
 *
 * History is frozen once the app is live (bot posts and releases name the style). So:
 *   - never edit, remove or reorder a list already in force; to change a genre's styles, APPEND an entry from a
 *     future epoch with the genre's whole new list (other genres can be left out: they keep their list);
 *   - a style id, once defined, means one sound: reuse the same definition in later lists, give a changed sound a
 *     new id (and bump the synth version, README "How to add a genre or a style after launch").
 * test/styles.test.ts pins the (genre, style) of epochs 0..4095.
 *
 * The id "classic" marks the sound the genre had before styles existed; it need not be listed first.
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
  /** Station styles: the pack's own lead patches by id (pack.ts `patches`), which `leads` may name. */
  patches?: Readonly<Record<string, LeadPatch>>;
  /**
   * The style whose renderer (engine.ts) plays this one; default its own id. Station styles (stations/<key>.ts) are
   * variants of a house style: a new id, `base` the house id, and `data` for the tables they change.
   */
  base?: string;
  /** Overrides for the tables the base renderer reads (styledata.ts); a table left out keeps the house one. */
  data?: StyleData;
}

/** The launch lists (STYLE_SCHEDULE entry 0). Frozen: change a genre's styles with a new STYLE_SCHEDULE entry. */
const LAUNCH_STYLES: Record<GenreId, readonly GenreStyle[]> = {
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

export interface StyleScheduleEntry {
  /** First epoch the lists apply to. Strictly increasing over the schedule; entry 0 starts at 0. */
  fromEpoch: number;
  /** The whole new style list of each genre this entry changes; genres left out keep their list. */
  styles: Partial<Record<GenreId, readonly GenreStyle[]>>;
}

/** Append-only (see the comment at the top). */
export const STYLE_SCHEDULE: readonly StyleScheduleEntry[] = [{ fromEpoch: 0, styles: LAUNCH_STYLES }];

/** A genre's style list in force at an epoch, and the epoch its rotation counts from. */
export interface StyleList {
  styles: readonly GenreStyle[];
  fromEpoch: number;
}

/**
 * Where styles come from: a Program (its `styles`, and its `eras` for the rotation), or a bare style schedule (tests:
 * a dummy appended entry over the house genre order). Omitted: the house program (STYLE_SCHEDULE over ERA_SCHEDULE),
 * which is HOUSE_PROGRAM (program.ts); this module only imports the Program type, so program.ts can import it.
 */
export type StyleSource = Program | readonly StyleScheduleEntry[];

const isProgram = (src: StyleSource): src is Program => !Array.isArray(src);

/** The style schedule of a source. */
function scheduleOf(src: StyleSource | undefined): readonly StyleScheduleEntry[] {
  return !src ? STYLE_SCHEDULE : isProgram(src) ? src.styles : src;
}

/** The genre schedule a source's rotation counts appearances in (a bare style schedule rotates over the house order). */
function erasOf(src: StyleSource | undefined): { readonly eras: readonly EraScheduleEntry[] } {
  return src && isProgram(src) ? src : { eras: ERA_SCHEDULE };
}

/**
 * The list `genre` plays from at `epoch`: the last entry that has started and names the genre. A genre with no list
 * yet at that epoch (a genre added later, auditioned at an earlier epoch) uses its first list. Throws when the
 * source never names the genre (a station program auditioned on a genre outside its pool).
 */
export function styleListAt(genre: GenreId, epoch: number, source?: StyleSource): StyleList {
  let hit: StyleList | null = null;
  for (const entry of scheduleOf(source)) {
    const list = entry.styles[genre];
    if (!list || list.length === 0) continue;
    if (entry.fromEpoch <= epoch || !hit) hit = { styles: list, fromEpoch: entry.fromEpoch };
    if (entry.fromEpoch > epoch) break;
  }
  if (!hit) throw new Error(`no styles for genre ${genre}`);
  return hit;
}

/** The styles of a genre in force at `epoch` (the rack, galleries). */
export function stylesAt(genre: GenreId, epoch: number, source?: StyleSource): readonly GenreStyle[] {
  return styleListAt(genre, epoch, source).styles;
}

/** Every style a genre has ever had, in order of first definition (ids are unique per genre). */
export function allStyles(genre: GenreId, source?: StyleSource): readonly GenreStyle[] {
  const out: GenreStyle[] = [];
  for (const entry of scheduleOf(source)) for (const st of entry.styles[genre] ?? []) if (!out.some((s) => s.id === st.id)) out.push(st);
  return out;
}

/** Every style ever defined, per genre (allStyles). With one schedule entry, the launch lists. */
export const GENRE_STYLES: Record<GenreId, readonly GenreStyle[]> = Object.fromEntries(
  (Object.keys(LAUNCH_STYLES) as GenreId[]).map((g) => [g, allStyles(g)]),
) as Record<GenreId, readonly GenreStyle[]>;

export interface StyleChoice {
  /** Index into the list in force at the epoch (styleListAt). */
  index: number;
  style: GenreStyle;
}

/**
 * Appearance counts, per genre schedule (the same array eraOf caches its walk under), then by `from:epoch`. Keyed by
 * the genre order the count walks, so a station's rotation never reads the house counts and vice versa.
 */
const appearanceCaches = new WeakMap<readonly EraScheduleEntry[], Map<string, number>>();

/** How many times this epoch's genre appeared in [from, epoch) (0 = first appearance since `from`), in `program`'s genre order. */
function appearance(epoch: number, from: number, program: { readonly eras: readonly EraScheduleEntry[] }): number {
  let cache = appearanceCaches.get(program.eras);
  if (!cache) appearanceCaches.set(program.eras, (cache = new Map()));
  const key = `${from}:${epoch}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const idx = eraOf(epoch, program).index;
  let k = 0;
  for (let e = from; e < epoch; e++) if (eraOf(e, program).index === idx) k++;
  cache.set(key, k);
  return k;
}

/**
 * The style of a genre instance. When `era` is the epoch's own genre, its appearances since the list's fromEpoch
 * walk the list in force in order; for a forced genre (gallery, sketches) the epoch hash picks from that list.
 * `source` is the program (default house): its style lists, and its genre order for "the epoch's own genre" and
 * the appearance count. A bare style schedule is for tests (a dummy appended entry over the house genre order).
 */
export function styleOf(era: Era, epoch: number, source?: StyleSource): StyleChoice {
  const e = Number.isFinite(epoch) ? Math.max(0, Math.floor(epoch)) : 0;
  const program = erasOf(source);
  const { styles: list, fromEpoch } = styleListAt(era.id, e, source);
  const n = list.length;
  let index: number;
  if (n === 1) index = 0;
  else if (eraOf(e, program).index !== era.index) index = hash32(e, era.index, 0x5717) % n;
  else index = appearance(e, Math.min(fromEpoch, e), program) % n;
  return { index, style: list[index] };
}

/** Style by id within a genre, from every list ever defined (sketch scripts, tests). `index` is its position in GENRE_STYLES. */
export function styleById(era: Era, id: string, source?: StyleSource): StyleChoice {
  const all = allStyles(era.id, source);
  const index = all.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`unknown style ${era.id}/${id}`);
  return { index, style: all[index] };
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
