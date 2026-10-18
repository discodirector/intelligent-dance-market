// Bot render page: the IDM-16 module driven frame by frame from a timeline, plus the offline-rendered track.
// Contract (bot/src/render): __setup(opts) → { frames, steps, swaps }; __frame(i) paints frame i and returns null,
// the bot screenshots the viewport; __audio() → base64 WAV. Deterministic for the same timeline and options.
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
  type SequencerState,
  type StepHit,
  type TimelinePoint,
} from "@swarm-sequencer/synth";
import { normalizeTimeline, type RawTimelineEvent } from "../../web/src/timeline";
import { sevenSeg } from "./sevenseg";
import { drawGrid, drawScope, drawSpectrum, Surface, type Flash } from "./visuals";

interface Entry extends RawTimelineEvent {
  ts?: number;
  blockNumber?: number;
  imd?: number;
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
let opts: Required<Omit<SetupOptions, "timeline" | "rules">>;
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
  if (!audio) return out;
  const ch = audio.getChannelData(0);
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
    const amt = (e.imd ?? 0).toFixed(2).padStart(8, " ");
    const tag = whale ? ` <span class="tag">${e.isBuy ? "FILL" : "DROP"}</span>` : "";
    const trk = TRACKS[(e.track ?? 0) & 3].padEnd(6, " ");
    rows.push(
      `<li class="${cls}"><span class="p">&gt;</span> <span class="t">${hhmm(e.ts ?? 0)}</span>  <span class="sd">${e.isBuy ? "BUY " : "SELL"}</span> ${amt} IMD  ` +
        `<span class="trk">${trk}</span> s${String((e.step ?? 0) + 1).padStart(2, "0")}${tag}</li>`,
    );
  }
  log.innerHTML = rows.join("");
  $("c-swaps").textContent = String(Math.max(0, upto));
  $("c-buys").textContent = String(buys);
  $("c-sells").textContent = String(sells);
  $("c-whales").textContent = String(whales);
}

function paint(t: number) {
  const view = viewAt(hits, t, points[0].state);
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

  const win = windowAt(t, 2048);
  const bytes = new Uint8Array(win.length);
  let sum = 0;
  for (let i = 0; i < win.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(128 + win[i] * 128)));
    sum += win[i] * win[i];
  }
  drawScope(scope, audio ? bytes : null);
  drawSpectrum(spectrum, audio ? spectrumBytes(win) : null, SR);
  const level = Math.min(1, Math.sqrt(sum / win.length) * 3);
  const lit = Math.round(level * vuBars.length);
  vuBars.forEach((b, i) => b.classList.toggle("on", i < lit));

  const era = eraOf(epochOf(st));
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
    title: o.title ?? "IMD/ETH · ETHEREUM · UNISWAP V4",
    subtitle: o.subtitle ?? "",
  };
  entries = raw.slice().sort((a, b) => (a.ts ?? a.timestamp ?? 0) - (b.ts ?? b.timestamp ?? 0));
  v2 = (o.rules ?? (entries.some((e) => e.rules === "v2") ? "v2" : "v1")) === "v2";
  document.body.classList.toggle("rules-v2", v2);
  points = spread(entries, opts.seconds);
  if (v2) points = withHeat(points, entries);
  hits = planSteps(points, opts.seconds, null, BOT_BAR_OFFSET);
  $("title").textContent = opts.title;
  $("subtitle").textContent = opts.subtitle;
  await document.fonts.ready;
  grid = new Surface($("grid") as HTMLCanvasElement);
  scope = new Surface($("scope") as HTMLCanvasElement);
  spectrum = new Surface($("spectrum") as HTMLCanvasElement);
  layout();
  audio = await renderTimelineToBuffer(points, opts.seconds, SR, { barOffset: BOT_BAR_OFFSET });
  shownLines = -1;
  paint(0);
  return { frames: Math.round(opts.fps * opts.seconds), steps: hits.length, swaps: Math.max(0, points.length - 1) };
};

window.__frame = (i) => {
  paint(i / opts.fps);
  return null;
};

window.__audio = async () => {
  if (!audio) throw new Error("__setup first");
  return audioBufferToWavBase64(audio);
};
