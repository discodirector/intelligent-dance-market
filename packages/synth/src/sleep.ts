import { eraById, type Era } from "./eras.ts";
import { hash32 } from "./hash.ts";
import { programFromPack, type StationPack } from "./pack.ts";
import type { Program } from "./program.ts";
import type { SequencerState } from "./state.ts";
import { styleOf } from "./styles.ts";

/**
 * Sleep mode (docs/STATIONS.md "Hamster station"): a station whose source goes quiet for most of the day (the
 * hamster runs ~2 h a night) plays a sleep pack instead of thinning to a drone. Once the last input is SLEEP_AFTER_SEC
 * old, the player plays one sleep style per SLEEP_SLOT_SEC of the wall clock, every slot another style and key, in a
 * walk every viewer hears alike (slots count from the unix epoch). The state is the last one frozen: its grid and bass
 * are the night's last run; the epoch is pinned to the slot's, idle and heat are off. The next input wakes the station
 * on its own genre, as before.
 *
 * The rig plays both packs (withSleep: the awake genre order, the styles of both), so the sleep genres are reached
 * only through the player's genre override, never by the chain's epochs.
 */

/** Wheel still this long: asleep. Idle thinning would start here (idle.ts IDLE_FULL_SEC). */
export const SLEEP_AFTER_SEC = 10 * 60;
/** One sleep style this long. */
export const SLEEP_SLOT_SEC = 30 * 60;
/**
 * Epochs the slots pin start here (a forced genre's style is the epoch's hash pick, styles.ts). Sharing an epoch number
 * with the chain is harmless (another genre); kept small because a style lookup walks the genre order up to it.
 */
const SLEEP_EPOCH_BASE = 4096;

export interface SleepSlot {
  /** floor(now / SLEEP_SLOT_SEC). */
  slot: number;
  era: Era;
  styleId: string;
  /** The pinned epoch: the style's instance and key. */
  epoch: number;
  /** Seconds asleep (since the last input + SLEEP_AFTER_SEC). */
  asleepSec: number;
}

const combined = new WeakMap<Program, WeakMap<StationPack, Program>>();

/** The awake program with the sleep pack's styles added (its genre order unchanged). Cached per pair. */
export function withSleep(awake: Program, sleep: StationPack): Program {
  let byPack = combined.get(awake);
  if (!byPack) combined.set(awake, (byPack = new WeakMap()));
  const hit = byPack.get(sleep);
  if (hit) return hit;
  const s = programFromPack(sleep);
  const extra = s.styles[0].styles;
  const program: Program = {
    key: awake.key,
    eras: awake.eras,
    styles: awake.styles.map((entry) => ({ ...entry, styles: { ...extra, ...entry.styles } })),
  };
  byPack.set(sleep, program);
  return program;
}

/** Every (genre, style) of a sleep pack, genre by genre in pack order. */
function sleepStyles(sleep: StationPack): { era: Era; id: string }[] {
  return sleep.genres.flatMap((g) => (sleep.styles[g] ?? []).map((s) => ({ era: eraById(g), id: s.id })));
}

/** A cycle's shuffle of n styles. */
function shuffled(n: number, cycle: number): number[] {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = hash32(cycle, i, 0x51ee) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The walk: each cycle of N slots plays every sleep style once, shuffled; across the seam the next cycle's first two
 * swap when its first is the last one played (positions 0 and 1 only, so no cycle depends on more than the one before).
 */
function slotChoice(n: number, slot: number): number {
  if (n <= 1) return 0;
  if (n === 2) return slot % 2;
  const c = Math.floor(slot / n);
  const order = shuffled(n, c);
  if (order[0] === shuffled(n, c - 1)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[slot - c * n];
}

/** The pinned epoch of a slot: the first one from the slot's base whose hash picks the slot's style (styles.ts). */
function slotEpoch(program: Program, era: Era, id: string, slot: number): number {
  const base = SLEEP_EPOCH_BASE + (hash32(slot, 0x5eed) % 4096) * 16;
  for (let e = base; e < base + 1024; e++) if (styleOf(era, e, program).style.id === id) return e;
  return base;
}

/**
 * Asleep at `nowSec`: the slot's genre, style and epoch; awake (or no input yet): null. `program` is the rig's
 * (withSleep), so the style lookup is the engine's.
 */
export function sleepAt(lastInputSec: number, nowSec: number, program: Program, sleep: StationPack): SleepSlot | null {
  if (!(lastInputSec > 0) || !Number.isFinite(nowSec)) return null;
  const asleepSec = nowSec - lastInputSec - SLEEP_AFTER_SEC;
  if (asleepSec < 0) return null;
  const slot = Math.floor(nowSec / SLEEP_SLOT_SEC);
  const list = sleepStyles(sleep);
  const pick = list[slotChoice(list.length, slot)];
  return { slot, era: pick.era, styleId: pick.id, epoch: slotEpoch(program, pick.era, pick.id, slot), asleepSec };
}

/** The state the player plays asleep: the last one, its epoch pinned to the slot, idle and heat off. */
export function sleepState(state: SequencerState, s: SleepSlot): SequencerState {
  return { ...state, patternId: s.epoch * 4, lastTs: 0, heat: 0 };
}
