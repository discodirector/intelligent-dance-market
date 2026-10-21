import { ERA_SCHEDULE, type EraScheduleEntry } from "./eras.ts";
import { STYLE_SCHEDULE, type StyleScheduleEntry } from "./styles.ts";

/**
 * A program: what a station plays (docs/STATIONS.md "Program"). Both halves of the musical history in one value:
 *   - `eras`: which genres, in which order (ERA_SCHEDULE shape; a station names a subset of the genres);
 *   - `styles`: which styles per genre (STYLE_SCHEDULE shape; a station's lists, covering at least its genres).
 * eraOf / styleOf / stylesAt and everything that renders (clock, player, engine, release) take an optional program,
 * default HOUSE_PROGRAM, and one render passes the same program all the way down.
 *
 * Frozen like the house schedules once a station is on air: append-only. Caches key on the schedule arrays, so
 * build a program once and reuse the object (fresh copies of the arrays recompute the genre walk from epoch 0).
 *
 * eras.ts and styles.ts import only the type: they default to their own schedules when no program is passed, which
 * is the same thing as HOUSE_PROGRAM, and this module (which needs both schedules) stays out of an import cycle.
 */
export interface Program {
  /** "idm" (house), "imd-eth", "<station>". A label: nothing is cached by it. */
  key: string;
  eras: readonly EraScheduleEntry[];
  styles: readonly StyleScheduleEntry[];
}

/** Today's schedules: $IDM and IMD/ETH play this, exactly as before programs existed (FROZEN_SHA256 unchanged). */
export const HOUSE_PROGRAM: Program = { key: "idm", eras: ERA_SCHEDULE, styles: STYLE_SCHEDULE };
