import { decode, type SequencerState, type TimelinePoint } from "@swarm-sequencer/synth";

/**
 * Accepts W3's `bot/TIMELINE.md` entries (`ts`, Mutated fields, slot0/slot1)
 * and the shorter demo shape (`timestamp`). Packed slots are the source of truth.
 */
export interface RawTimelineEvent {
  slot0: string | number | bigint;
  slot1: string | number | bigint;
  /** Demo tapes. W3 tapes use `ts` instead. */
  timestamp?: number;
  ts?: number;
  track?: number;
  step?: number;
  on?: boolean;
  bassNote?: number;
  isBuy?: boolean;
  imdAmount?: string;
  imdAmt?: string;
  tick?: number;
  swapCount?: number;
  whale?: boolean;
  /** Display IMD, not wei. */
  imd?: number;
  /** Present on timelines written after the whale-drop change. */
  drop?: { track?: number; fill?: boolean; mask?: number };
}

const T_KICK = 100n * 10n ** 18n;

function amountWei(event: RawTimelineEvent): bigint | null {
  const raw = event.imdAmt ?? event.imdAmount;
  if (raw == null || raw === "") return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function isWhale(event: RawTimelineEvent): boolean {
  if (event.drop && typeof event.drop.track === "number") return true;
  if (event.whale === true) return true;
  if (typeof event.imd === "number" && event.imd >= 100) return true;
  const wei = amountWei(event);
  return wei != null && wei >= T_KICK;
}

function readDrop(event: RawTimelineEvent): TimelinePoint["drop"] {
  const explicit = event.drop;
  if (explicit && typeof explicit.track === "number" && explicit.track >= 0 && explicit.track <= 3) {
    const mask = explicit.mask == null ? undefined : Number(explicit.mask) & 0xffff;
    return { track: explicit.track, fill: Boolean(explicit.fill), mask };
  }
  if (!isWhale(event)) return undefined;
  const track = typeof event.track === "number" ? event.track & 3 : 0;
  return { track, fill: Boolean(event.isBuy) };
}

function eventTime(event: RawTimelineEvent): number {
  if (event.timestamp != null && event.timestamp !== undefined) return Number(event.timestamp);
  if (event.ts != null) return Number(event.ts);
  return Number.NaN;
}

export function normalizeTimeline(raw: RawTimelineEvent[]): TimelinePoint[] {
  const rows = raw
    .map((event) => {
      if (event.slot0 == null || event.slot1 == null) {
        throw new Error("timeline entry is missing slot0/slot1");
      }
      const timestamp = eventTime(event);
      const state: SequencerState = decode(event.slot0, event.slot1);
      const drop = readDrop(event);
      const hasFlash = typeof event.track === "number" && typeof event.step === "number";
      const flash = hasFlash
        ? {
            track: event.track as number,
            step: event.step as number,
            bass: Boolean(event.isBuy) || event.bassNote === 0,
            row: drop != null,
          }
        : drop
          ? { track: drop.track, step: 0, row: true }
          : undefined;
      return { timestamp, state, flash, drop };
    })
    .filter((row) => Number.isFinite(row.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (rows.length === 0) return [];
  const origin = rows[0].timestamp;
  const asMillis = rows.some((row) => row.timestamp > 1e12);
  const scale = asMillis ? 0.001 : 1;
  return rows.map((row) => ({
    time: (row.timestamp - origin) * scale,
    now: row.timestamp * scale,
    state: row.state,
    flash: row.flash,
    drop: row.drop,
  }));
}
