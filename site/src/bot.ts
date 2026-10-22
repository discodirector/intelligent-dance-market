// Bot render page: the IDM-16 module driven frame by frame from a timeline, plus the offline-rendered track.
// Contract (bot/src/render): __setup(opts) → { frames, steps, swaps }; __frame(i) paints frame i and returns null,
// the bot screenshots the viewport; __audio() → base64 WAV. Deterministic for the same timeline and options.
// Release mode (bot/src/release, SPEC §4.6): __setupRelease(opts) plans the finished track exactly as web/render.html
// does for the WAV, then __frame(i) paints the same module synced to that plan; posts name the genre only (no style).
/// <reference path="../../web/src/build.d.ts" />
import "./style.css";
import "./bot.css";
import { DEFAULT_DROP_RULES } from "@swarm-sequencer/core";
import {
  audioBufferToWavBase64,
  decode,
  epochOf,
  FORM_BARS,
  sectionAt,
  eraOf,
  genreKey,
  idleStage,
  nowAt,
  NOTE_NAMES,
  planSteps,
  renderTimelineToBuffer,
  stepDuration,
  viewAt,
  type Program,
  type SequencerState,
  type StepHit,
  type TimelinePoint,
} from "@swarm-sequencer/synth";
import { barAt, buildRelease, programOfPack, sectionOfBar, type BuiltRelease, type ReleaseEntry, type ReleaseRequest } from "../../web/src/release";
import { formatQuote, normalizeTimeline, quoteOf, quoteSymbolOf, type RawTimelineEvent } from "../../web/src/timeline";
import { sevenSeg } from "./sevenseg";
import { drawGrid, drawScope, drawSpectrum, Surface, type Flash } from "./visuals";

interface Entry extends RawTimelineEvent {
  ts?: number;
  blockNumber?: number;
  /** bot/src/lib/timeline.ts: absent = v1. */
  rules?: "v1" | "v2";
  /** v2: this swap finished a track; slots = the finished track before the reset. */
  trackComplete?: { trackNo: number; swaps?: number; slot0: string; slot1: string };
}

interface SetupOptions {
  timeline: Entry[] | { entries?: Entry[]; frames?: Entry[] };
  width?: number;
  height?: number;
  fps?: number;
  seconds?: number;
  title?: string;
  subtitle?: string;
  /** Hook rules of the timeline. Default: "v2" when any entry says so, else "v1". */
  rules?: "v1" | "v2";
  /** A station clip: its name on the module and the blue LCD theme, as a station release (ReleaseSetup.station). */
  station?: string;
  /** The station's style pack as JSON (a Station+ post, bot scheduler): the clip plays its program, not the house's. */
  pack?: unknown;
  /** The station's LCD colours (registry theme); unset = the blue station theme (html.station-alt). */
  theme?: StationTheme;
  /** A calibrated quote (CHOG/MON): the feed shows amounts in it (ETH value x perEth), not in ETH. */
  quote?: ShownQuote;
}

const SR = 44100;
/** A ~32 s clip is about 13 bars: start late in the build so the video lands in the full groove. */
const BOT_BAR_OFFSET = 10;
const TRACKS = ["KICK", "SNARE", "HAT", "GLITCH"];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let entries: Entry[] = [];
let points: TimelinePoint[] = [];
let hits: StepHit[] = [];
let audio: AudioBuffer | null = null;
/** Channel 0 of the audio the frames show (teaser: the rendered buffer; release: the release WAV). */
let samples: Float32Array | null = null;
let rel: BuiltRelease | null = null;
let opts: Required<Omit<SetupOptions, "timeline" | "rules" | "station" | "pack" | "theme" | "quote">>;
/** The clip's program: a station's pack (SetupOptions.pack), else undefined = the house schedules. */
let program: Program | undefined;
let v2 = false;
const HEAT_MAX = DEFAULT_DROP_RULES.heatMax;
let grid: Surface, scope: Surface, spectrum: Surface;
let shownLines = -1;

const seg = {
  bpm: sevenSeg($("seg-bpm"), 3),
  key: sevenSeg($("seg-key"), 2),
  mode: sevenSeg($("seg-mode"), 3),
  swap: sevenSeg($("seg-swap"), 5),
  page: sevenSeg($("seg-page"), 3),
  epoch: sevenSeg($("seg-epoch"), 2),
  track: sevenSeg($("seg-track"), 3),
};
const heatBar = $("heat-bar");
heatBar.innerHTML = "<i></i>".repeat(HEAT_MAX);
const heatLeds = [...heatBar.children] as HTMLElement[];
const vu = $("vu");
vu.innerHTML = "<i></i>".repeat(12);
const vuBars = [...vu.children] as HTMLElement[];
const idleLis = [...$("idle-leds").children] as HTMLElement[];

/** Fits the module (laid out at its desktop width) into its slot with a CSS scale. */
function layout() {
  const wide = opts.width > opts.height * 1.3;
  document.body.classList.toggle("wide", wide);
  const slot = $("slot-module");
  const panel = $("panel");
  panel.style.transform = "none";
  const r = slot.getBoundingClientRect();
  const k = Math.min(r.width / panel.offsetWidth, r.height / panel.offsetHeight);
  panel.style.transform = `scale(${k})`;
  for (const s of [grid, scope, spectrum]) s.fit();
}

/** Above this many real seconds per clip second, idle decay would flicker on ordinary gaps between swaps. */
const MAX_IDLE_COMPRESSION = 600;

/**
 * Whole tape spread evenly over the clip (like the old teaser). Idle decay follows real block time
 * only when the tape is compressed gently enough for it to mean something.
 */
function spread(raw: Entry[], seconds: number): TimelinePoint[] {
  const base = normalizeTimeline(raw);
  const n = base.length;
  const span = Math.max(1, seconds - 0.85);
  const real = n > 1 && base[0].now != null && base[n - 1].now != null ? base[n - 1].now! - base[0].now! : 0;
  const keepIdle = real / seconds <= MAX_IDLE_COMPRESSION;
  return base.map((p, i) => ({ ...p, time: i === 0 ? 0 : 0.25 + (i / n) * span, now: keepIdle ? p.now : undefined }));
}

/** v2: states carry heat (normalised by heatMax) and trackNo; a track complete holds the finished track, then drops. */
function withHeat(pts: TimelinePoint[], raw: Entry[]): TimelinePoint[] {
  if (pts.length !== raw.length) return pts;
  return pts.map((p, i) => {
    const e = raw[i];
    const tc = e.trackComplete;
    return {
      ...p,
      state: decode(e.slot0, e.slot1, { heatMax: HEAT_MAX }),
      ...(tc ? { trackDrop: { held: decode(tc.slot0, tc.slot1, { heatMax: HEAT_MAX }) } } : {}),
    };
  });
}

function windowAt(t: number, size: number): Float32Array {
  const out = new Float32Array(size);
  if (!samples) return out;
  const ch = samples;
  const start = Math.max(0, Math.floor(t * SR) - size);
  for (let i = 0; i < size && start + i < ch.length; i++) out[i] = ch[start + i];
  return out;
}

/** Radix-2 FFT magnitude in AnalyserNode byte scale (-100..-30 dB → 0..255). */
function spectrumBytes(x: Float32Array): Uint8Array {
  const n = x.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k), wi = Math.sin(a * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const out = new Uint8Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const db = 20 * Math.log10(Math.hypot(re[i], im[i]) / n + 1e-12);
    out[i] = Math.max(0, Math.min(255, Math.round(((db + 100) / 70) * 255)));
  }
  return out;
}

const hhmm = (ts: number) => new Date(ts * 1000).toISOString().slice(11, 16);

function logLines(upto: number) {
  if (upto === shownLines) return;
  shownLines = upto;
  const log = $("log");
  const rows: string[] = [];
  let buys = 0, sells = 0, whales = 0;
  for (let i = 1; i <= upto && i < entries.length; i++) {
    const e = entries[i];
    e.isBuy ? buys++ : sells++;
    if (points[i].drop) whales++;
  }
  const first = Math.max(1, upto - 13);
  for (let i = first; i <= upto && i < entries.length; i++) {
    const e = entries[i];
    const tc = e.trackComplete;
    if (tc) rows.push(`<li class="sys track"><span class="p">#</span> TRACK #${tc.trackNo} COMPLETE${tc.swaps != null ? ` · ${tc.swaps} SWAPS` : ""}</li>`);
    const whale = Boolean(points[i].drop);
    const cls = whale ? "whale" : e.isBuy ? "buy" : "sell";
    const amt = formatQuote(quoteOf(e) * (shownQuote?.perEth ?? 1)).padStart(8, " ");
    const tag = whale ? ` <span class="tag">${e.isBuy ? "FILL" : "DROP"}</span>` : "";
    const trk = TRACKS[(e.track ?? 0) & 3].padEnd(6, " ");
    rows.push(
      `<li class="${cls}"><span class="p">&gt;</span> <span class="t">${hhmm(e.ts ?? 0)}</span>  <span class="sd">${e.isBuy ? "BUY " : "SELL"}</span> ${amt} ${shownQuote?.symbol ?? quoteSymbolOf(e)}  ` +
        `<span class="trk">${trk}</span> s${String((e.step ?? 0) + 1).padStart(2, "0")}${tag}</li>`,
    );
  }
  log.innerHTML = rows.join("");
  $("c-swaps").textContent = String(Math.max(0, upto));
  $("c-buys").textContent = String(buys);
  $("c-sells").textContent = String(sells);
  $("c-whales").textContent = String(whales);
}

/** Scope, spectrum and the OUT meter from the audio around grid second `t`. */
function audioPanels(t: number) {
  const win = windowAt(t, 2048);
  const bytes = new Uint8Array(win.length);
  let sum = 0;
  for (let i = 0; i < win.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(128 + win[i] * 128)));
    sum += win[i] * win[i];
  }
  drawScope(scope, samples ? bytes : null);
  drawSpectrum(spectrum, samples ? spectrumBytes(win) : null, SR);
  const level = Math.min(1, Math.sqrt(sum / win.length) * 3);
  const lit = Math.round(level * vuBars.length);
  vuBars.forEach((b, i) => b.classList.toggle("on", i < lit));
}

function paint(t: number) {
  const view = viewAt(hits, t, points[0].state, program);
  const st: SequencerState = view.state;
  let idx = 0;
  while (idx + 1 < points.length && points[idx + 1].time <= t) idx++;

  const flashes: Flash[] = [];
  for (let i = Math.max(1, idx - 10); i <= idx; i++) {
    const p = points[i];
    if (p.trackDrop) for (let track = 0; track < 4; track++) flashes.push({ track, step: 0, row: true, color: "whale", at: p.time * 1000 });
    if (!p.flash) continue;
    const e = entries[i];
    flashes.push({
      track: p.flash.track,
      step: p.flash.step,
      row: Boolean(p.flash.row),
      color: p.drop ? "whale" : e.isBuy ? "buy" : "sell",
      at: p.time * 1000,
    });
  }
  drawGrid(grid, st, view.step, view.bar, view.phase, flashes, t * 1000);

  audioPanels(t);

  const era = eraOf(epochOf(st), program);
  const note = NOTE_NAMES[genreKey(era, epochOf(st))];
  seg.bpm(String(Math.round(view.bpm)));
  seg.key(note[0] + " ", note.includes("#") ? [0] : []);
  seg.mode(era.notes.includes(3) ? "min" : "---");
  seg.swap(String(st.swapCount % 100000));
  seg.page(String(st.patternId % 1000));
  const epoch = epochOf(st);
  seg.epoch(String(epoch % 100));
  if (v2) {
    seg.track(String(((st.trackNo ?? 0) + 1) % 1000));
    const heat = Math.round((st.heat ?? 0) * HEAT_MAX);
    heatLeds.forEach((b, i) => b.classList.toggle("on", i < heat));
    $("heat-label").textContent = `${String(heat).padStart(2, "0")}/${HEAT_MAX}`;
  }
  $("era-name").textContent = era.name.toUpperCase();
  $("era-sub").textContent = `EPOCH ${epoch} · ${sectionAt(view.bar).name.toUpperCase()} ${(view.bar % FORM_BARS) + 1}/${FORM_BARS}`;

  const now = nowAt(points, Math.max(0, t - view.phase * stepDuration(view.bpm)));
  const idle = idleStage(st, now ?? st.lastTs);
  const order = ["full", "thinning", "sparse", "drone"];
  idleLis.forEach((li) => li.classList.toggle("on", order.indexOf(li.dataset.stage!) <= order.indexOf(idle.stage)));
  $("idle-label").textContent = idle.label;

  const e = entries[idx];
  const when = e?.ts ? new Date(e.ts * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
  $("foot-right").textContent = [when, e?.blockNumber ? `BLK ${e.blockNumber.toLocaleString("en-US")}` : ""].filter(Boolean).join(" · ");
  logLines(idx);
}

declare global {
  interface Window {
    __setup: (o: SetupOptions) => Promise<{ frames: number; steps: number; swaps: number }>;
    __setupRelease: (o: ReleaseSetup) => Promise<ReleaseInfo>;
    /** Release mode: grid seconds of representative moments (bot/src/release --stills). */
    __releaseMarks: () => Record<string, number>;
    __frame: (i: number) => null;
    __audio: () => Promise<string>;
  }
}

window.__setup = async (o) => {
  const raw = Array.isArray(o.timeline) ? o.timeline : (o.timeline.entries ?? o.timeline.frames ?? []);
  opts = {
    width: o.width ?? 1080,
    height: o.height ?? 1080,
    fps: o.fps ?? 30,
    seconds: o.seconds ?? 32,
    title: o.title ?? "IMD/ETH · ETHEREUM · REPLAYED THROUGH THE IDM HOOK",
    subtitle: o.subtitle ?? "",
  };
  program = o.pack ? programOfPack(o.pack) : undefined;
  entries = raw.slice().sort((a, b) => (a.ts ?? a.timestamp ?? 0) - (b.ts ?? b.timestamp ?? 0));
  v2 = (o.rules ?? (entries.some((e) => e.rules === "v2") ? "v2" : "v1")) === "v2";
  document.body.classList.toggle("rules-v2", v2);
  document.documentElement.classList.toggle("station-alt", !!o.station);
  stationTheme(o.theme);
  shownQuote = o.quote ?? null;
  if (o.station) {
    $("model-sub").textContent = o.station;
    $("foot-left").textContent = `EVERY TRADE IS A NOTE · ${o.station.toUpperCase()}`;
  }
  points = spread(entries, opts.seconds);
  if (v2) points = withHeat(points, entries);
  hits = planSteps(points, opts.seconds, null, BOT_BAR_OFFSET, program);
  $("title").textContent = opts.title;
  $("subtitle").textContent = opts.subtitle;
  await document.fonts.ready;
  grid = new Surface($("grid") as HTMLCanvasElement);
  scope = new Surface($("scope") as HTMLCanvasElement);
  spectrum = new Surface($("spectrum") as HTMLCanvasElement);
  layout();
  audio = await renderTimelineToBuffer(points, opts.seconds, SR, { barOffset: BOT_BAR_OFFSET, program });
  samples = audio.getChannelData(0);
  shownLines = -1;
  paint(0);
  return { frames: Math.round(opts.fps * opts.seconds), steps: hits.length, swaps: Math.max(0, points.length - 1) };
};

window.__frame = (i) => {
  if (rel) paintRelease(rel, i / opts.fps);
  else paint(i / opts.fps);
  return null;
};

window.__audio = async () => {
  if (!audio) throw new Error("__setup first");
  return audioBufferToWavBase64(audio);
};

// ---------------------------------------------------------------- release mode (SPEC §4.6)

interface StationTheme { phos: string; phosDim: string; ghost: string; lcd: string }
interface ShownQuote { symbol: string; perEth: number }
let shownQuote: ShownQuote | null = null;
/** A station's own colours over html.station-alt's blue (the canvases read the CSS variables). */
function stationTheme(t?: StationTheme) {
  const st = document.documentElement.style;
  if (!t) { for (const v of ["--phos", "--phos-rgb", "--phos-dim", "--phos-ghost", "--lcd-bg"]) st.removeProperty(v); return; }
  const rgb = [1, 3, 5].map((i) => parseInt(t.phos.slice(i, i + 2), 16)).join(", ");
  st.setProperty("--phos", t.phos); st.setProperty("--phos-rgb", rgb); st.setProperty("--phos-dim", t.phosDim);
  st.setProperty("--phos-ghost", t.ghost); st.setProperty("--lcd-bg", t.lcd);
}

interface ReleaseSetup extends ReleaseRequest {
  /** The station's LCD colours (registry theme); unset = the blue station theme. */
  theme?: StationTheme;
  /** A calibrated quote: the feed shows amounts in it. */
  quote?: ShownQuote;
  timeline: ReleaseEntry[];
  width?: number;
  height?: number;
  fps?: number;
  /** URL of the release WAV (web/render.html __renderRelease) for the scope, spectrum and OUT meter. */
  wavUrl?: string;
  title?: string;
  subtitle?: string;
  /** A station's release (bot/src/station.ts): its name on the module and the blue LCD theme, so its tracks never
   *  pass for $IDM ones. Absent = the $IDM hook. The music follows `program` (ReleaseOptions, synth program.ts),
   *  not this name: IMD/ETH plays the house program; a station passes its own, and the plan carries it (plan.program),
   *  so web/render.html must be given the same one for the WAV. */
  station?: string;
}

interface ReleaseInfo {
  frames: number;
  seconds: number;
  bars: number;
  dropTime: number | null;
  swaps: number;
  trackNo: number;
}

const STAGES = [
  ["intro", "INTRO"],
  ["body", "BUILD"],
  ["drop", "DROP"],
  ["outro", "OUTRO"],
] as const;
let shownTape = "";
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Same as web/render.html: unset options must not override the plan's defaults. */
function cleanRequest(req: ReleaseRequest): ReleaseRequest {
  const out: ReleaseRequest = {};
  for (const [k, v] of Object.entries(req)) if (v != null && !(typeof v === "number" && !Number.isFinite(v))) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Channel 0 of a 16-bit PCM WAV as floats. */
function wavChannel0(buf: ArrayBuffer): Float32Array {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("release audio is not a WAV");
  let off = 12;
  let channels = 2, bits = 16;
  while (off + 8 <= v.byteLength) {
    const id = tag(off);
    const len = v.getUint32(off + 4, true);
    if (id === "fmt ") {
      channels = v.getUint16(off + 10, true);
      bits = v.getUint16(off + 22, true);
    } else if (id === "data") {
      if (bits !== 16) throw new Error("expected 16-bit PCM");
      const data = off + 8;
      const frames = Math.floor(Math.min(len, v.byteLength - data) / (2 * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) out[i] = v.getInt16(data + i * channels * 2, true) / 32768;
      return out;
    }
    off += 8 + len + (len & 1);
  }
  throw new Error("WAV has no data chunk");
}

const barTime = (r: BuiltRelease, bar: number) => r.plan.hits[Math.min(r.plan.bars - 1, Math.max(0, bar)) * 16].gridTime;

/** Swaps that have landed by grid second `t`. */
function landed(r: BuiltRelease, t: number): number {
  let n = 0;
  while (n < r.plan.swapTimes.length && r.plan.swapTimes[n] <= t) n++;
  return n;
}

/** The swap tape under the module: the track's swaps as they land, then the TrackComplete line at the drop. */
function releaseTape(r: BuiltRelease, n: number, dropped: boolean) {
  const key = `${n}|${dropped}`;
  if (key === shownTape) return;
  shownTape = key;
  let buys = 0, sells = 0, whales = 0;
  for (let i = 0; i < n; i++) {
    r.entries[i].isBuy ? buys++ : sells++;
    if (r.swaps[i].drop) whales++;
  }
  const rows: string[] = [];
  for (let i = Math.max(0, n - 14); i < n; i++) {
    const e = r.entries[i];
    const whale = Boolean(r.swaps[i].drop);
    const cls = whale ? "whale" : e.isBuy ? "buy" : "sell";
    const amt = formatQuote(quoteOf(e) * (shownQuote?.perEth ?? 1)).padStart(8, " ");
    const tag = whale ? ` <span class="tag">${e.isBuy ? "FILL" : "DROP"}</span>` : "";
    const trk = TRACKS[(e.track ?? 0) & 3].padEnd(6, " ");
    rows.push(
      `<li class="${cls}"><span class="p">&gt;</span> <span class="t">${hhmm(e.ts ?? 0)}</span>  <span class="sd">${e.isBuy ? "BUY " : "SELL"}</span> ${amt} ${shownQuote?.symbol ?? quoteSymbolOf(e)}  ` +
        `<span class="trk">${trk}</span> s${String((e.step ?? 0) + 1).padStart(2, "0")}${tag}</li>`,
    );
  }
  const tc = r.entries.at(-1)?.trackComplete;
  if (dropped && tc) rows.push(`<li class="sys track"><span class="p">#</span> TRACK #${tc.trackNo} COMPLETE · ${r.entries.length} SWAPS</li>`);
  $("log").innerHTML = rows.join("");
  $("c-swaps").textContent = String(n);
  $("c-buys").textContent = String(buys);
  $("c-sells").textContent = String(sells);
  $("c-whales").textContent = String(whales);
}

function paintRelease(r: BuiltRelease, t: number) {
  const plan = r.plan;
  const view = viewAt(plan.hits, t, r.seed, plan.program);
  const st: SequencerState = view.state;
  const n = landed(r, t);
  const dropT = plan.dropTime;
  const dropped = dropT != null && t >= dropT;

  const flashes: Flash[] = [];
  for (let i = Math.max(0, n - 12); i < n; i++) {
    const f = r.swaps[i].flash;
    if (!f) continue;
    flashes.push({ track: f.track, step: f.step, row: Boolean(f.row), color: r.swaps[i].drop ? "whale" : r.entries[i].isBuy ? "buy" : "sell", at: plan.swapTimes[i] * 1000 });
  }
  if (dropped) for (let track = 0; track < 4; track++) flashes.push({ track, step: 0, row: true, color: "whale", at: dropT! * 1000 });
  drawGrid(grid, st, view.step, view.bar, view.phase, flashes, t * 1000);
  audioPanels(t);

  // The release plays one genre instance (plan.genre); the readouts follow it, never a style.
  const g = plan.genre;
  const era = eraOf(g.epoch, plan.program);
  const note = NOTE_NAMES[genreKey(era, g.epoch)];
  seg.bpm(String(Math.round(view.bpm)));
  seg.key(note[0] + " ", note.includes("#") ? [0] : []);
  seg.mode(era.notes.includes(3) ? "min" : "---");
  seg.swap(String(st.swapCount % 100000));
  seg.page(String(st.patternId % 1000));
  seg.epoch(String(g.epoch % 100));
  const bar = barAt(plan, t);
  const dropBar = plan.dropBar;
  const stage = bar < plan.introBars ? 0 : dropBar == null || bar < dropBar ? 1 : bar === dropBar ? 2 : 3;
  // The drop bar still shows the finished track (TRACK #, full heat ladder); the outro shows the new seed.
  const finished = stage === 2;
  seg.track(String((finished ? r.selection.trackNo : (st.trackNo ?? 0) + 1) % 1000));
  const heat = finished ? HEAT_MAX : Math.round((st.heat ?? 0) * HEAT_MAX);
  heatLeds.forEach((b, i) => b.classList.toggle("on", i < heat));
  $("heat-label").textContent = `${String(heat).padStart(2, "0")}/${HEAT_MAX}`;
  const section = stage === 2 ? "DROP" : sectionOfBar(plan, bar).name.toUpperCase();
  const no = r.selection.trackNo;
  $("era-name").textContent = g.eraName.toUpperCase();
  $("era-sub").textContent = `TRACK #${no}${dropped ? " COMPLETE" : ""} · ${section} · ${mmss(t)} / ${mmss(plan.seconds)}`;
  idleLis.forEach((li, i) => li.classList.toggle("on", i <= stage));
  $("idle-label").textContent = `BAR ${String(bar + 1).padStart(String(plan.bars).length, "0")}/${plan.bars}`;
  const prog = $("rel-progress");
  prog.classList.toggle("dropped", dropped);
  (prog.firstElementChild as HTMLElement).style.width = `${Math.min(100, (t / plan.seconds) * 100).toFixed(2)}%`;

  // The drop: the module rings and the grid flashes (deterministic per frame; CSS animations are off here).
  const age = dropT == null ? -1 : t - dropT;
  const panel = $("panel");
  const lcdCanvas = $("grid");
  if (age >= 0 && age < 1.6) {
    const k = 1 - age / 1.6;
    const ring = age < 0.3 && Math.floor(age / 0.1) % 2 === 1 ? "var(--amber)" : "var(--phos)";
    panel.style.boxShadow = `inset 0 0 0 ${(2 + 2 * k).toFixed(1)}px ${ring}, 0 0 0 4px var(--black), 0 0 ${Math.round(60 * k)}px ${Math.round(14 * k)}px rgba(var(--phos-rgb), ${(0.55 * k).toFixed(2)})`;
    lcdCanvas.style.filter = `brightness(${(1 + 1.6 * k * k).toFixed(2)})${age < 0.12 ? " saturate(0.4)" : ""}`;
  } else {
    panel.style.boxShadow = "";
    lcdCanvas.style.filter = "";
  }
  $("net-status").textContent = dropped && age < 4 ? "TRACK COMPLETE" : "RELEASE";

  const e = n > 0 ? r.entries[n - 1] : null;
  const when = e?.ts ? new Date(e.ts * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
  $("foot-right").textContent = [when, e?.blockNumber ? `BLK ${e.blockNumber.toLocaleString("en-US")}` : ""].filter(Boolean).join(" · ");
  releaseTape(r, n, dropped);
}

function paceText(r: BuiltRelease): string {
  const slot = r.plan.pace.slotSteps;
  if (Math.abs(slot - 16) < 1e-9) return "ONE SWAP PER BAR";
  if (slot > 16) {
    const bars = slot / 16;
    return Number.isInteger(bars) ? `ONE SWAP EVERY ${bars} BARS` : `ONE SWAP EVERY ${Math.round(slot / 4)} BEATS`;
  }
  return `${(16 / slot).toFixed(1).replace(/\.0$/, "")} SWAPS PER BAR`;
}

window.__setupRelease = async (o) => {
  const { timeline, width, height, fps, wavUrl, title, subtitle, station, theme, quote, ...req } = o;
  rel = buildRelease(timeline, cleanRequest(req));
  const r = rel;
  const no = r.selection.trackNo;
  opts = {
    width: width ?? 1080,
    height: height ?? 1080,
    fps: fps ?? 30,
    seconds: r.plan.seconds,
    title: title ?? `${station ? `${station.toUpperCase()} · ETHEREUM` : "$IDM · ROBINHOOD CHAIN"} · TRACK #${no} · ${r.entries.length} SWAPS IN ORDER`,
    subtitle: subtitle ?? `${paceText(r)} · ${r.plan.dropTime != null ? `DROP AT ${mmss(r.plan.dropTime)}` : "UNFINISHED"}`,
  };
  v2 = true;
  document.body.classList.add("rules-v2", "release");
  // The canvases read their colours from the CSS variables, so the theme class recolours every LCD.
  document.documentElement.classList.toggle("station-alt", !!station);
  stationTheme(theme);
  shownQuote = quote ?? null;
  if (station) {
    $("model-sub").textContent = station;
    $("foot-left").textContent = `EVERY TRADE IS A NOTE · ${station.toUpperCase()}`;
  }
  $("title").textContent = opts.title;
  $("subtitle").textContent = opts.subtitle;
  $("net-status").textContent = "RELEASE";
  $("idle-silk").textContent = "RELEASE";
  $("idle-leds").innerHTML = STAGES.map(([id, label]) => `<li data-stage="${id}"><b></b>${label}</li>`).join("");
  idleLis.splice(0, idleLis.length, ...([...$("idle-leds").children] as HTMLElement[]));
  if (wavUrl) {
    const res = await fetch(wavUrl);
    if (!res.ok) throw new Error(`release audio ${res.status} ${wavUrl}`);
    samples = wavChannel0(await res.arrayBuffer());
  }
  await document.fonts.ready;
  grid = new Surface($("grid") as HTMLCanvasElement);
  scope = new Surface($("scope") as HTMLCanvasElement);
  spectrum = new Surface($("spectrum") as HTMLCanvasElement);
  layout();
  shownTape = "";
  paintRelease(r, 0);
  return {
    frames: Math.round(opts.fps * r.plan.seconds),
    seconds: r.plan.seconds,
    bars: r.plan.bars,
    dropTime: r.plan.dropTime,
    swaps: r.entries.length,
    trackNo: no,
  };
};

window.__releaseMarks = () => {
  const r = rel;
  if (!r) throw new Error("__setupRelease first");
  const p = r.plan;
  const bodyEnd = p.dropBar ?? p.introBars + p.bodyBars;
  const at = (bar: number) => barTime(r, bar);
  // First bar with the heat ladder half full, else the middle of the body.
  const half = p.hits.findIndex((h) => (h.state.heat ?? 0) * HEAT_MAX >= HEAT_MAX / 2);
  const marks: Record<string, number> = {
    intro: at(Math.floor(p.introBars / 2)) + 0.3,
    build: at(p.introBars + 2) + 0.3,
    body: at(Math.floor((p.introBars + bodyEnd) / 2)) + 0.3,
    heat: half >= 0 ? p.hits[half].gridTime + 0.4 : at(bodyEnd - 6) + 0.3,
    climb: at(bodyEnd) - 1.2,
  };
  if (p.dropTime != null) {
    marks.drop = p.dropTime + 0.12;
    marks.outro = (p.dropTime + p.fadeAt) / 2;
  } else marks.end = p.fadeAt;
  return marks;
};
