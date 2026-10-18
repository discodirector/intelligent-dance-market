import { decode, type SequencerState, type TimelinePoint } from "@swarm-sequencer/synth";
import { whaleThresholdFor } from "../../packages/core/src/index.ts";

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
  /** |quote delta| in wei (launch hook: native ETH). Mutated field name: quoteAmount. */
  quoteAmt?: string;
  quoteAmount?: string;
  /** Legacy IMD-quoted tapes (v1 hook / old replays). */
  imdAmount?: string;
  imdAmt?: string;
  tick?: number;
  swapCount?: number;
  whale?: boolean;
  /** Display quote amount, not wei. */
  quote?: number;
  /** Absent = ETH (or IMD when only legacy imd fields are present). */
  quoteSymbol?: QuoteSymbol;
  /** Legacy display IMD, not wei. */
  imd?: number;
  /** Present on timelines written after the whale-drop change. */
  drop?: { track?: number; fill?: boolean; mask?: number };
}

export type QuoteSymbol = "ETH" | "IMD";

/**
 * Whale threshold (wei) of the hook behind a quote at the swap's post-swap tick: FDV-scaled for ETH (the launch
 * hook, core whaleWeiAtTick), the fixed 100 IMD for legacy IMD tapes. null = unknown (an ETH entry with no tick).
 */
export function whaleWeiFor(symbol: QuoteSymbol, tick: number | null | undefined): bigint | null {
  if (symbol === "IMD") return whaleThresholdFor("IMD", 0);
  return tick == null ? null : whaleThresholdFor("ETH", tick);
}

type AmountFields = Pick<RawTimelineEvent, "quoteAmt" | "quoteAmount" | "quote" | "quoteSymbol" | "imdAmt" | "imdAmount" | "imd">;

/** New tapes carry quote fields; a tape with only imd fields is a legacy IMD-quoted one. */
export function quoteSymbolOf(event: AmountFields): QuoteSymbol {
  if (event.quoteSymbol) return event.quoteSymbol;
  const hasQuote = event.quoteAmt != null || event.quoteAmount != null || event.quote != null;
  const hasImd = event.imdAmt != null || event.imdAmount != null || event.imd != null;
  return !hasQuote && hasImd ? "IMD" : "ETH";
}

/** Display amount (float) in the entry's quote currency. */
export function quoteOf(event: AmountFields): number {
  if (typeof event.quote === "number") return event.quote;
  if (typeof event.imd === "number") return event.imd;
  const wei = amountWei(event);
  return wei == null ? 0 : Number(wei / 10n ** 12n) / 1e6;
}

/** ETH amounts are small: keep four decimals below 1. */
export function formatQuote(v: number): string {
  return v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
}

export function amountWei(event: AmountFields): bigint | null {
  const raw = event.quoteAmt ?? event.quoteAmount ?? event.imdAmt ?? event.imdAmount;
  if (raw == null || raw === "") return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function isWhale(event: RawTimelineEvent): boolean {
  if (event.drop && typeof event.drop.track === "number") return true;
  if (typeof event.whale === "boolean") return event.whale; // the tape's own verdict (bot timelines always carry it)
  const threshold = whaleWeiFor(quoteSymbolOf(event), event.tick);
  if (threshold == null) return false; // recorded tapes carry whale/drop; without a tick the amount alone cannot tell
  const wei = amountWei(event);
  if (wei != null) return wei >= threshold;
  const display = event.quote ?? event.imd;
  return typeof display === "number" && display * 1e18 >= Number(threshold);
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
