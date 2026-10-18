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
} from "@swarm-sequencer/synth";
import { readConfig } from "./config";
import { loadTimeline } from "./modes/replay";
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

const ready = (async () => {
  await document.fonts.ready;
  const url = cfg.timelineUrl;
  if (!url) throw new Error("render.html needs ?timeline=<url>");
  const loaded = await loadTimeline(url);
  const speed = cfg.speed;
  points = speed === 1 ? loaded : loaded.map((point) => ({ ...point, time: point.time / speed }));
  if (points.length === 0) throw new Error("timeline is empty");
  window.__timelineCount = points.length;
  drawAt(0, secondsOr());
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

declare global {
  interface Window {
    __ready: boolean;
    __readyPromise: Promise<void>;
    __error?: string;
    __timelineCount?: number;
    __render: (options: RenderOptions) => Promise<void>;
    __renderAudio: (seconds?: number) => Promise<string>;
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
    };
  }
}
