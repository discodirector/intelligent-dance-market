import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import {
  planSteps,
  renderTimelineToBuffer,
  viewAt,
  audioBufferToWavBase64,
  epochOf,
  eraOf,
  idleStage,
  infoLine,
  nowAt,
  initialState,
  type TimelinePoint,
  renderReleaseToBuffer,
  RELEASE_HEAT_MAX,
} from "@swarm-sequencer/synth";
import { readConfig } from "./config";
import { loadTimeline } from "./modes/replay";
import { barAt, buildRelease, releaseSummary, sectionOfBar, type BuiltRelease, type ReleaseEntry, type ReleaseRequest, type ReleaseSummary } from "./release";
import { Visualizer } from "./visualizer";

interface RenderOptions {
  fps: number;
  seconds: number;
}

const cfg = readConfig();
const canvas = document.querySelector<HTMLCanvasElement>("#grid");
if (!canvas) throw new Error("render canvas missing");

const viz = new Visualizer(canvas, true);
let points: TimelinePoint[] = [];
let failed: Error | null = null;

function secondsOr(arg?: number): number {
  if (arg != null && Number.isFinite(arg) && arg > 0) return arg;
  if (cfg.seconds != null) return cfg.seconds;
  return 8;
}

function drawAt(t: number, span: number) {
  const hits = planSteps(points, Math.max(span, t + 0.05));
  const view = viewAt(hits, t, points[0]?.state ?? initialState());
  const flashes = [];
  for (const point of points) {
    if (!point.flash) continue;
    const age = t - point.time;
    const limit = point.flash.row ? 0.7 : 0.45;
    if (age < 0 || age > limit) continue;
    const born = t * 1000 - age * 1000;
    flashes.push({ track: point.flash.track, step: point.flash.step, born, row: point.flash.row });
    if (point.flash.bass) flashes.push({ track: 4, step: point.flash.step, born });
  }
  viz.resize();
  viz.setFrame(view.state, view.step, view.phase, view.bar);
  viz.setFlashes(flashes);
  viz.draw(t * 1000);
  const epoch = epochOf(view.state);
  const era = eraOf(epoch);
  const now = nowAt(points, t);
  const idle = now == null ? idleStage(view.state, view.state.lastTs) : idleStage(view.state, now);
  window.__frame = {
    time: t,
    step: view.step,
    epoch,
    era: era.name,
    eraId: era.id,
    bpm: view.bpm,
    info: infoLine(view.state),
    idleSec: idle.idleSec,
    idle: idle.stage,
    idleLabel: idle.label,
  };
}

function paintWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => finish());
    window.setTimeout(finish, Math.max(16, ms));
  });
}

// ---------------------------------------------------------------- release mode (RENDER.md "Release")

const query = new URLSearchParams(window.location.search);
const num = (key: string) => {
  const v = query.get(key);
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const releaseQuery: ReleaseRequest | null =
  query.get("release") === "1"
    ? { track: num("track") ?? null, swapsPerBar: num("pace"), maxSeconds: num("maxSeconds"), minSeconds: num("minSeconds") }
    : null;
let rawTape: Promise<ReleaseEntry[]> | null = null;
let release: BuiltRelease | null = null;

function fetchRaw(): Promise<ReleaseEntry[]> {
  rawTape ??= (async () => {
    const url = cfg.timelineUrl;
    if (!url) throw new Error("render.html needs ?timeline=<url>");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`timeline ${response.status} ${url}`);
    const json = await response.json();
    if (!Array.isArray(json)) throw new Error("timeline is not an array");
    return json as ReleaseEntry[];
  })();
  return rawTape;
}

function clean(req: ReleaseRequest): ReleaseRequest {
  const out: ReleaseRequest = {};
  for (const [k, v] of Object.entries(req)) if (v != null && !(typeof v === "number" && !Number.isFinite(v))) (out as Record<string, unknown>)[k] = v;
  return out;
}

async function prepareRelease(req?: ReleaseRequest): Promise<BuiltRelease> {
  const raw = await fetchRaw();
  release = buildRelease(raw, clean({ ...(releaseQuery ?? {}), ...(req ?? {}) }));
  return release;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** One release frame at grid second `t`: the grid, the swaps' flashes, and a TRACK · SECTION · HEAT line on top. */
function drawRelease(r: BuiltRelease, t: number) {
  const plan = r.plan;
  const view = viewAt(plan.hits, t, r.seed);
  const flashes = [];
  for (let i = 0; i < r.swaps.length; i++) {
    const flash = r.swaps[i].flash;
    if (!flash) continue;
    const age = t - plan.swapTimes[i];
    const limit = flash.row ? 0.7 : 0.45;
    if (age < 0 || age > limit) continue;
    const born = t * 1000 - age * 1000;
    flashes.push({ track: flash.track, step: flash.step, born, row: flash.row });
    if (flash.bass) flashes.push({ track: 4, step: flash.step, born });
  }
  if (plan.dropTime != null && t >= plan.dropTime && t - plan.dropTime < 0.7) {
    for (let track = 0; track < 4; track++) flashes.push({ track, step: 0, born: plan.dropTime * 1000, row: true });
  }
  const g = plan.genre;
  viz.resize();
  // Genre only: style names are internal and never appear in a frame.
  viz.setGenreLine(`EPOCH #${g.epoch} · ${g.eraName}`);
  viz.setFrame(view.state, view.step, view.phase, view.bar);
  viz.setFlashes(flashes);
  viz.draw(t * 1000);
  const bar = barAt(plan, t);
  const section = sectionOfBar(plan, bar);
  const heat = Math.round((view.state.heat ?? 0) * RELEASE_HEAT_MAX);
  const ctx = canvas!.getContext("2d");
  if (ctx) {
    const w = canvas!.width;
    const size = Math.max(12, Math.round(w * 0.019));
    ctx.save();
    ctx.font = `500 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e0a15a";
    const label = `TRACK #${r.selection.trackNo} · ${section.name.toUpperCase()} · HEAT ${String(heat).padStart(2, "0")}/${RELEASE_HEAT_MAX} · ${mmss(t)} / ${mmss(plan.seconds)}`;
    ctx.fillText(label, w / 2, Math.round(size * 1.5));
    ctx.fillStyle = "rgba(224,161,90,0.55)";
    ctx.fillRect(0, canvas!.height - 3, (w * Math.min(1, t / plan.seconds)), 3);
    ctx.restore();
  }
  // The release's genre instance, not the state's epoch: the whole release plays one genre.
  window.__frame = {
    time: t,
    step: view.step,
    epoch: g.epoch,
    era: g.eraName,
    eraId: g.era,
    bpm: view.bpm,
    info: infoLine(view.state),
    idleSec: 0,
    idle: "full",
    idleLabel: "",
    bar,
    section: section.name,
    heat,
  };
}

const ready = (async () => {
  await document.fonts.ready;
  const url = cfg.timelineUrl;
  if (!url) throw new Error("render.html needs ?timeline=<url>");
  const loaded = await loadTimeline(url);
  const speed = cfg.speed;
  points = speed === 1 ? loaded : loaded.map((point) => ({ ...point, time: point.time / speed }));
  if (points.length === 0) throw new Error("timeline is empty");
  window.__timelineCount = points.length;
  if (releaseQuery) drawRelease(await prepareRelease(), 0);
  else drawAt(0, secondsOr());
})();

ready.then(
  () => {
    window.__ready = true;
  },
  (err: unknown) => {
    failed = err instanceof Error ? err : new Error(String(err));
    window.__error = failed.message;
    window.__ready = false;
  },
);

window.__ready = false;
window.__readyPromise = ready;

window.__render = async (options: RenderOptions) => {
  await ready;
  const fps = Math.max(1, options?.fps ?? 30);
  const seconds = secondsOr(options?.seconds);
  const frames = Math.max(1, Math.round(fps * seconds));
  const frameMs = 1000 / fps;
  const started = performance.now();
  for (let i = 0; i < frames; i++) {
    drawAt(i / fps, seconds);
    const target = started + (i + 1) * frameMs;
    const wait = target - performance.now();
    await paintWait(Math.max(0, wait));
  }
};

window.__renderAudio = async (seconds?: number) => {
  await ready;
  const length = secondsOr(seconds);
  const buffer = await renderTimelineToBuffer(points, length, 44100);
  return audioBufferToWavBase64(buffer);
};

window.__releaseInfo = async (req?: ReleaseRequest) => {
  await ready;
  return releaseSummary(await prepareRelease(req));
};

window.__renderRelease = async (req?: ReleaseRequest) => {
  await ready;
  const r = await prepareRelease(req);
  const buffer = await renderReleaseToBuffer(r.plan, 44100);
  return { wav: audioBufferToWavBase64(buffer), seconds: r.plan.seconds, summary: releaseSummary(r) };
};

window.__releaseFrame = (i: number, fps = 30, type = "image/jpeg", quality = 0.9) => {
  if (!release) throw new Error("call __releaseInfo or __renderRelease first");
  drawRelease(release, i / Math.max(1, fps));
  return canvas!.toDataURL(type, quality);
};

declare global {
  interface Window {
    __ready: boolean;
    __readyPromise: Promise<void>;
    __error?: string;
    __timelineCount?: number;
    __render: (options: RenderOptions) => Promise<void>;
    __renderAudio: (seconds?: number) => Promise<string>;
    /** Release mode: builds the track's plan (selection + pacing) and returns its metadata. */
    __releaseInfo: (req?: ReleaseRequest) => Promise<ReleaseSummary>;
    /** Release mode: base64 WAV of the whole track and its duration (seconds, exact). */
    __renderRelease: (req?: ReleaseRequest) => Promise<{ wav: string; seconds: number; summary: ReleaseSummary }>;
    /** Release mode: paints frame `i` at `fps` of the last built release and returns it as a data URL. */
    __releaseFrame: (i: number, fps?: number, type?: string, quality?: number) => string;
    __frame?: {
      time: number;
      step: number;
      epoch: number;
      era: string;
      eraId: string;
      bpm: number;
      info: string;
      idleSec: number;
      idle: string;
      idleLabel: string;
      /** Release mode only. */
      bar?: number;
      section?: string;
      heat?: number;
    };
  }
}
