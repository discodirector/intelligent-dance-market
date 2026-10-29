// The style lab's takes (RECORD mode, lab.ts): a take is automation and trades over up to 64 bars. It starts from a
// base recipe and a market seed (lab-market.ts); every knob, macro, choice, trade key and auto-market switch is an
// event [step since the take's start, control id, value 0..255], values quantised to the control's range at record
// time so playback hears exactly what recording heard. A part switched on or off (u:<part>, 1 on, 0 off) is heard from
// the next downbeat, live and rendered. Ids are a fixed list per genre (controlsOf); in a link the events
// travel as bytes (a varint step delta, a control index, a value) and are parsed as hostile input like the rest of the
// recipe (lab-codec.ts). applyEvent replays one onto a recipe; buildStyle (and its taste rules) then runs on every step.
import { PARTS, type Part } from "@swarm-sequencer/synth";
import { clamp, GENRES, presetById, setPart, type LabGenre, type Recipe } from "./lab-styles";
import { Market, TRADES, type Trade, type TradeResult } from "./lab-market";

/** A take's limits: 64 bars (~2 min at 124 bpm), 512 events. */
export const TAKE_BARS = 64;
export const TAKE_EVENTS = 512;
/** The longest event string a link may carry (512 events of at most 4 bytes, base64url). */
export const TAKE_CHARS = 2800;

export interface TakeEvent {
  step: number;
  ctl: string;
  v: number;
}
export interface Take {
  /** The market's seed (lab-market.ts): the same seed plays the same trades. */
  seed: number;
  /** The song-form bar the take starts on (0..31). */
  bar: number;
  /** Length in bars, 1..64. */
  bars: number;
  /** The auto market at the start. */
  auto: boolean;
  /** In step order; at one step, in the order they were played. */
  events: TakeEvent[];
}

/** The controls a genre's take may name: knobs, macros, choices, the trade keys, the auto market and the parts. Fixed order (new ones go last, so older links keep their indices). */
export function controlsOf(g: LabGenre): string[] {
  const x = GENRES[g];
  return [...x.knobs.map((k) => `k:${k.key}`), ...x.macros.map((m) => `m:${m.key}`), ...x.choices.map((c) => `c:${c.key}`), ...TRADES.map((t) => `t:${t}`), "a:auto", ...PARTS.map((p) => `u:${p}`)];
}

const knobOf = (g: LabGenre, key: string) => GENRES[g].knobs.find((k) => k.key === key);
const snap = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));

/** A knob value as a byte of its range, and back (snapped to the knob's step). */
export function quant(g: LabGenre, key: string, value: number): number {
  const k = knobOf(g, key);
  if (!k || !Number.isFinite(value)) return 0;
  return clamp(Math.round(((value - k.min) / (k.max - k.min)) * 255), 0, 255);
}
export function dequant(g: LabGenre, key: string, q: number): number {
  const k = knobOf(g, key)!;
  return clamp(snap(k.min + (clamp(q, 0, 255) / 255) * (k.max - k.min), k.step), k.min, k.max);
}
export const macroValue = (q: number) => snap(clamp(q, 0, 255) / 255, 0.01);
export const macroQuant = (v: number) => clamp(Math.round(clamp(v, 0, 1) * 255), 0, 255);

/** The options a choice event's value indexes (the genre's own list). */
function optionsOf(r: Recipe, key: string) {
  const g = GENRES[r.genre];
  const c = g.choices.find((x) => x.key === key);
  const p = presetById(r.genre, r.preset) ?? g.presets[0];
  return c ? c.options({ genre: r.genre, style: p.style }) : [];
}
export const choiceIndex = (r: Recipe, key: string, id: string) => optionsOf(r, key).findIndex((o) => o.id === id);

/** What an event did besides the recipe: a trade to play, or the auto market switched. */
export type EventEffect = { trade: Trade } | { auto: boolean } | null;

/** Plays one event onto a recipe (as the controls would have). A value out of its control's range is ignored. */
export function applyEvent(r: Recipe, e: TakeEvent): EventEffect {
  const [kind, key] = e.ctl.split(":");
  if (kind === "k" && knobOf(r.genre, key)) r.knobs[key] = dequant(r.genre, key, e.v);
  else if (kind === "m") {
    const m = GENRES[r.genre].macros.find((x) => x.key === key);
    if (!m) return null;
    r.macros[key] = macroValue(e.v);
    for (const k of m.knobs) delete r.knobs[k];
  } else if (kind === "c") {
    const o = optionsOf(r, key)[e.v];
    if (o) r.choices[key] = o.id;
  } else if (kind === "u" && (PARTS as readonly string[]).includes(key)) setPart(r, key as Part, e.v > 0);
  else if (kind === "t" && (TRADES as readonly string[]).includes(key)) return { trade: key as Trade };
  else if (kind === "a") return { auto: e.v > 0 };
  return null;
}

/** Is this a well-formed event for the genre (known control, value in its range)? */
function validEvent(g: LabGenre, r: Recipe, e: TakeEvent): boolean {
  if (!Number.isInteger(e.v) || e.v < 0 || e.v > 255) return false;
  if (!controlsOf(g).includes(e.ctl)) return false;
  const [kind, key] = e.ctl.split(":");
  if (kind === "c") return e.v < optionsOf(r, key).length;
  if (kind === "a" || kind === "u") return e.v <= 1;
  if (kind === "t") return e.v === 0;
  return true;
}

/**
 * Events from untrusted triples [step, control id, value]: in step order (an event earlier than the one before it is
 * dropped), inside the take, known controls and values only, at most TAKE_EVENTS (more: null, the take is refused).
 */
export function eventsFrom(r: Recipe, list: unknown, bars: number): TakeEvent[] | null {
  if (!Array.isArray(list) || list.length > TAKE_EVENTS) return null;
  const out: TakeEvent[] = [];
  let last = 0;
  for (const x of list) {
    if (!Array.isArray(x) || x.length !== 3) continue;
    const [step, ctl, v] = x;
    if (!Number.isInteger(step) || step < last || step >= bars * 16 || typeof ctl !== "string") continue;
    const e = { step, ctl, v };
    if (!validEvent(r.genre, r, e as TakeEvent)) continue;
    out.push(e as TakeEvent);
    last = step;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ bytes

const b64u = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Events as bytes: a varint step delta, the control's index in controlsOf, the value. */
export function packEvents(g: LabGenre, events: readonly TakeEvent[]): string {
  const ids = controlsOf(g);
  const bytes: number[] = [];
  let last = 0;
  for (const e of events) {
    let d = e.step - last;
    last = e.step;
    while (d >= 0x80) {
      bytes.push((d & 0x7f) | 0x80);
      d >>>= 7;
    }
    bytes.push(d, ids.indexOf(e.ctl), e.v);
  }
  return b64u(Uint8Array.from(bytes));
}
/** Bytes back to [step, id, value] triples (unknown indices as ""), or null when they do not parse. */
export function unpackEvents(g: LabGenre, s: string): [number, string, number][] | null {
  if (s.length > TAKE_CHARS || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  let bytes: Uint8Array;
  try {
    bytes = unb64u(s);
  } catch {
    return null;
  }
  const ids = controlsOf(g);
  const out: [number, string, number][] = [];
  let i = 0;
  let step = 0;
  while (i < bytes.length) {
    let d = 0;
    let shift = 0;
    for (;;) {
      if (i >= bytes.length || shift > 14) return null;
      const b = bytes[i++];
      d |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    if (i + 2 > bytes.length) return null;
    step += d;
    out.push([step, ids[bytes[i]] ?? "", bytes[i + 1]]);
    i += 2;
    if (out.length > TAKE_EVENTS) return null;
  }
  return out;
}

/** A take's JSON for the link (lab-codec.ts recipeJson): short keys, events as bytes. */
export const takeJson = (g: LabGenre, t: Take) => ({ s: t.seed, b: t.bar, n: t.bars, a: t.auto ? 1 : 0, e: packEvents(g, t.events) });

/** A take from untrusted JSON for the recipe `r`, or undefined (no take, or one that does not parse). */
export function takeFrom(r: Recipe, x: unknown): Take | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const seed = own("s");
  const bar = own("b");
  const bars = own("n");
  const e = own("e");
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffffffff) return undefined;
  if (!Number.isInteger(bar) || (bar as number) < 0 || (bar as number) > 31) return undefined;
  if (!Number.isInteger(bars) || (bars as number) < 1 || (bars as number) > TAKE_BARS) return undefined;
  if (typeof e !== "string") return undefined;
  const raw = unpackEvents(r.genre, e);
  const events = raw && eventsFrom(r, raw, bars as number);
  if (!events) return undefined;
  return { seed: seed as number, bar: bar as number, bars: bars as number, auto: own("a") === 1, events };
}

/** The controls a take moves (knobs, macros, choices), for the lanes and the knobs' automated mark. */
export const lanesOf = (t: Take) => [...new Set(t.events.map((e) => e.ctl).filter((c) => !c.startsWith("t:") && c !== "a:auto"))];

/**
 * A take played step by step, the same way live (lab.ts) and offline (lab-render.ts): a fresh market from the take's
 * seed, the base recipe, then per step the auto market's trade (from step 1) and the step's events in order.
 */
export class TakeRun {
  readonly market: Market;
  readonly recipe: Recipe;
  auto: boolean;
  private cursor = 0;

  constructor(base: Recipe, readonly take: Take) {
    this.market = new Market(take.seed);
    this.recipe = JSON.parse(JSON.stringify(base)) as Recipe;
    delete this.recipe.take;
    this.auto = take.auto;
  }

  get done() {
    return this.cursor >= this.take.events.length;
  }

  /** Everything that happens on `step`: the trades it plays (in order) and which controls moved. */
  advance(step: number): { trades: TradeResult[]; moved: string[] } {
    const trades: TradeResult[] = [];
    const moved: string[] = [];
    if (step > 0 && this.auto) {
      const kind = this.market.auto(step);
      if (kind) trades.push(this.market.trade(kind, step));
    }
    const events = this.take.events;
    while (this.cursor < events.length && events[this.cursor].step <= step) {
      const e = events[this.cursor++];
      if (e.step < step) continue;
      const fx = applyEvent(this.recipe, e);
      if (fx && "trade" in fx) trades.push(this.market.trade(fx.trade, step));
      else if (fx && "auto" in fx) {
        this.auto = fx.auto;
        if (fx.auto) this.market.autoFrom(step);
      } else moved.push(e.ctl);
    }
    return { trades, moved };
  }
}
