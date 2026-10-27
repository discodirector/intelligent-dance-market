// Hamster source (docs/STATIONS.md "Hamster station"): a real hamster's wheel (Squeekchain, docs.squeekchain.com) ->
// the rules input, for a station that plays the wheel instead of a pool. The API keeps no history of the wheel, so our
// recorder (bot/src/hamster/recorder.ts) logs /v1/status 24/7; this decoder reads those measurements (and the API's
// event feed) and is shared by the bot (track releases) and the site (live and the replay of the last run).
//
// Inputs, in time order:
//   run        every HAMSTER_STEP_MM of wheel distance (the measurement's distanceMm counter, a per-day counter: a drop
//              is a reset, counted from 0) is one BUY at the measurement that crossed it (the last metres before a
//              stop arrive on the first still measurement: the usual size there). The tempo follows the gaps between
//              them, so a faster hamster is a faster track (core mutate step 6; held only inside one measurement).
//   stop       the wheel stopping (a measurement with rpm 0 after a running one) is one SELL of the usual size: it
//              thins the grid and cools the heat, a breakdown, and a track rarely ends on a pause.
//   milestone  measurement.distance_milestone / daily_distance_milestone / speed_record / speed_milestone /
//              distance_streak from the event feed: one whale BUY (a movement), at the event's time.
// Sound, all from the measurements, integers only so every replay is bit-identical:
//   size       quoteAmt = SIZE_REF x (speed / median of the last HAMSTER_WINDOW running speeds)^HAMSTER_SIZE_POWER,
//              holdSizeEma (as nft.ts): faster than his usual climbs to snare and kick, slower falls to hat.
//   tick       HAMSTER_TICK_PER_MM_S x the median of the last HAMSTER_TICK_WINDOW running speeds: the bass degree
//              (core mutate step 5, 60 ticks a degree) follows his pace, smoothed, so it moves as he speeds up.
// The wheel is never rewarded: the station only listens (Squeekchain's welfare policy). Cues (not rules inputs) are
// the settlements, claims and merges on Sepolia: ornaments that keep the sleep mode alive.
import { whaleWeiAtTick, type MutationInput } from "./index.ts";

/** One distinct measurement (measurement.observedAt) of /v1/status. */
export interface HamsterSample {
  /** observedAt, ms. */
  t: number;
  rpmMilli: number;
  speedMmPerSecond: number;
  /** Today's distance (resets once a day). */
  distanceMm: number;
}

/** One item of /v1/events as the recorder logs it (only the fields read here). */
export interface HamsterEvent {
  id: string;
  type: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export type HamsterVia = "run" | "stop" | "milestone";

export interface HamsterInput extends MutationInput {
  /** ms of the measurement (or event) it came from. */
  t: number;
  hamster: {
    via: HamsterVia;
    /** Speed at the input, mm/s (0 for a stop). */
    speed: number;
    /** Distance since the decoder's start, mm (run inputs: the step crossed). */
    distanceMm: number;
    /** milestone: the event type's last part (distance_milestone, speed_record, ...) and its threshold or record. */
    kind?: string;
    value?: string;
  };
}

export type HamsterCueKind = "settlement" | "claim" | "merge" | "mint" | "block";

/** An ornament: never a rules input. */
export interface HamsterCue {
  t: number;
  kind: HamsterCueKind;
  /** settlement: blocks completed; claim: SQK claimed (whole tokens); merge: the survivor's level. */
  n?: number;
}

/** What a decoder hands the next batch. */
export interface HamsterCarry {
  /** Distance since the start, mm. */
  total: number;
  /** The last day counter seen (a drop is a reset). */
  lastDayMm: number | null;
  /** The last measurement's time and whether the wheel was turning. */
  lastT: number;
  running: boolean;
  /** Running speeds, oldest first (HAMSTER_WINDOW). */
  speeds: number[];
  /** Event ids already decoded (milestones and cues come from a feed that repeats items). */
  seen: string[];
}

/** One BUY per this much wheel: ~29 s at his usual 1.05 m/s: a track is ~35 min of running, 2-3 over a night. */
export const HAMSTER_STEP_MM = 30_000;
/** Running speeds the size reads against: ~10 min of running. */
export const HAMSTER_WINDOW = 127;
/** Running speeds the tick reads: one minute. */
export const HAMSTER_TICK_WINDOW = 12;
export const HAMSTER_TICK_PER_MM_S = 3;
/** The usual size (the rules' starting size EMA, 0.0125 ETH): r = 0 at the median speed. */
export const HAMSTER_SIZE_REF = 12_500_000_000_000_000n;
/** Speed ratio to the 8th: 0.957x his median is a hat, 1.055x a snare, 1.145x a kick (the tiers of nft.ts). */
export const HAMSTER_SIZE_POWER = 8;
/** Event ids kept in the carry (the feed's first page is 50 items). */
export const HAMSTER_SEEN = 500;

const MILESTONES: Record<string, string> = {
  "measurement.distance_milestone": "thresholdDistanceMm",
  "measurement.daily_distance_milestone": "thresholdDistanceMm",
  "measurement.speed_record": "recordMmPerSecond",
  "measurement.speed_milestone": "thresholdMmPerSecond",
  "measurement.distance_streak": "streakDays",
};

export const emptyHamsterCarry = (): HamsterCarry => ({ total: 0, lastDayMm: null, lastT: 0, running: false, speeds: [], seen: [] });

const medianOf = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
};

/** The rules' tick at a set of running speeds (none yet: his usual 1 m/s). */
export const hamsterTick = (speeds: readonly number[]) =>
  HAMSTER_TICK_PER_MM_S * (speeds.length ? medianOf(speeds.slice(-HAMSTER_TICK_WINDOW)) : 1000);

function sizeAt(speed: number, usual: number, tick: number): bigint {
  const k = BigInt(HAMSTER_SIZE_POWER);
  const cap = whaleWeiAtTick(tick) / 2n;
  let size = (HAMSTER_SIZE_REF * BigInt(Math.max(1, speed)) ** k) / BigInt(Math.max(1, usual)) ** k;
  if (size > cap) size = cap;
  if (size < 1n) size = 1n;
  return size;
}

/**
 * Measurements (any order, duplicates allowed) and events -> rules inputs and cues, both in time order. Pass the carry
 * of the previous batch to continue a stream: samples at or before carry.lastT are skipped, events by id.
 */
export function decodeHamster(
  samples: readonly HamsterSample[],
  events: readonly HamsterEvent[] = [],
  carryIn: HamsterCarry = emptyHamsterCarry(),
): { inputs: HamsterInput[]; cues: HamsterCue[]; carry: HamsterCarry } {
  const carry: HamsterCarry = { ...carryIn, speeds: [...carryIn.speeds], seen: [...carryIn.seen] };
  const seen = new Set(carry.seen);
  const byT = new Map<number, HamsterSample>();
  for (const s of samples) if (s.t > carry.lastT && Number.isFinite(s.t)) byT.set(s.t, s);
  const ordered = [...byT.values()].sort((a, b) => a.t - b.t);

  // Milestones join the measurements in time order; cues are apart.
  type Item = { t: number; sample?: HamsterSample; event?: HamsterEvent };
  const items: Item[] = ordered.map((sample) => ({ t: sample.t, sample }));
  const cues: HamsterCue[] = [];
  for (const e of [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(e.id)) continue;
    const t = Date.parse(e.occurredAt);
    if (!Number.isFinite(t)) continue;
    seen.add(e.id);
    carry.seen.push(e.id);
    if (MILESTONES[e.type]) items.push({ t, event: e });
    else {
      const cue = cueOf(e, t);
      if (cue) cues.push(cue);
    }
  }
  if (carry.seen.length > HAMSTER_SEEN) carry.seen.splice(0, carry.seen.length - HAMSTER_SEEN);
  // Stable: a milestone after the measurements of its millisecond.
  items.sort((a, b) => a.t - b.t || (a.sample ? 0 : 1) - (b.sample ? 0 : 1) || (a.event?.id ?? "").localeCompare(b.event?.id ?? ""));
  cues.sort((a, b) => a.t - b.t);

  const inputs: HamsterInput[] = [];
  const at = (t: number) => ({ blockNumber: BigInt(Math.floor(t / 1000)), timestamp: BigInt(Math.floor(t / 1000)) });
  for (const it of items) {
    const tick = hamsterTick(carry.speeds);
    if (it.event) {
      const e = it.event;
      const kind = e.type.split(".").pop()!;
      const v = e.payload?.[MILESTONES[e.type]];
      inputs.push({
        t: it.t, isBuy: true, quoteAmt: whaleWeiAtTick(tick), tick, ...at(it.t), holdSizeEma: true,
        hamster: { via: "milestone", speed: 0, distanceMm: carry.total, kind, ...(v !== undefined ? { value: String(v) } : {}) },
      });
      continue;
    }
    const s = it.sample!;
    const day = Math.max(0, Math.floor(s.distanceMm));
    const before = carry.total;
    if (carry.lastDayMm !== null) carry.total += day >= carry.lastDayMm ? day - carry.lastDayMm : day;
    carry.lastDayMm = day;
    carry.lastT = s.t;
    const running = s.rpmMilli > 0;
    // The wheel's last metres before a stop arrive on the first still measurement: a crossing there plays at the
    // usual size, then the stop.
    const usual = carry.speeds.length ? medianOf(carry.speeds) : s.speedMmPerSecond;
    if (running) {
      carry.speeds.push(s.speedMmPerSecond);
      if (carry.speeds.length > HAMSTER_WINDOW) carry.speeds.shift();
    }
    const tickNow = hamsterTick(carry.speeds);
    const speed = running ? s.speedMmPerSecond : usual;
    for (let step = Math.floor(before / HAMSTER_STEP_MM) + 1; step * HAMSTER_STEP_MM <= carry.total; step++) {
      inputs.push({
        t: s.t, isBuy: true, quoteAmt: running ? sizeAt(speed, usual, tickNow) : HAMSTER_SIZE_REF, tick: tickNow, ...at(s.t), holdSizeEma: true,
        ...(inputs.length && inputs[inputs.length - 1].t === s.t ? { holdTempo: true } : {}),
        hamster: { via: "run", speed, distanceMm: step * HAMSTER_STEP_MM },
      });
    }
    if (!running && carry.running) {
      inputs.push({
        t: s.t, isBuy: false, quoteAmt: HAMSTER_SIZE_REF, tick, ...at(s.t), holdSizeEma: true,
        ...(inputs.length && inputs[inputs.length - 1].t === s.t ? { holdTempo: true } : {}),
        hamster: { via: "stop", speed: 0, distanceMm: carry.total },
      });
    }
    carry.running = running;
  }
  return { inputs, cues, carry };
}

function cueOf(e: HamsterEvent, t: number): HamsterCue | null {
  const p = e.payload ?? {};
  switch (e.type) {
    case "system.settlement_completed":
      return { t, kind: "settlement", n: Number(p.completedBlockCount ?? 0) || 0 };
    case "player.rewards_claimed": {
      let whole = 0;
      try { whole = Number(BigInt(String(p.amountBaseUnits ?? "0")) / 10n ** 18n); } catch { /* not a number: 0 */ }
      return { t, kind: "claim", n: whole };
    }
    case "player.squeeks_merged":
      return { t, kind: "merge", n: Number(p.level ?? 0) || 0 };
    case "player.squeek_minted":
      return { t, kind: "mint" };
    default:
      return null;
  }
}

/** A recorder line ({rx, status} or {rx, hb, status}) -> a sample, or null. */
export function hamsterSampleOf(o: { status?: any }): HamsterSample | null {
  const m = o?.status?.measurement;
  if (!m || typeof m.observedAt !== "string") return null;
  const t = Date.parse(m.observedAt);
  if (!Number.isFinite(t)) return null;
  return { t, rpmMilli: Number(m.rpmMilli) || 0, speedMmPerSecond: Number(m.speedMmPerSecond) || 0, distanceMm: Number(m.distanceMm) || 0 };
}
