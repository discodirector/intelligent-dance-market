import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import {
  ERAS,
  audioBufferToWavBase64,
  createLivePlayer,
  epochOf,
  eraById,
  eraOf,
  idleStage,
  infoLine,
  initialState,
  renderTimelineToBuffer,
  stepDuration,
  type LivePlayer,
  type SequencerState,
} from "@swarm-sequencer/synth";
import { readConfig } from "./config";
import { startDemo, type AppliedSwap } from "./modes/demo";
import { galleryState } from "./modes/gallery";
import { startLive } from "./modes/live";
import { loadTimeline, startReplay } from "./modes/replay";
import { Visualizer } from "./visualizer";

const cfg = readConfig();
const canvas = document.querySelector<HTMLCanvasElement>("#grid");
const info = document.querySelector<HTMLElement>("#info");
const status = document.querySelector<HTMLElement>("#status");
const modeEl = document.querySelector<HTMLElement>("#mode");
const startBtn = document.querySelector<HTMLButtonElement>("#start");
const transport = document.querySelector<HTMLElement>("#transport");
const speedInput = document.querySelector<HTMLInputElement>("#speed");
const fitBtn = document.querySelector<HTMLButtonElement>("#fit");
const epoch = document.querySelector<HTMLElement>("#epoch");
const idle = document.querySelector<HTMLElement>("#idle");
const gallery = document.querySelector<HTMLElement>("#gallery");

if (!canvas || !info || !status || !modeEl || !startBtn || !transport || !speedInput || !fitBtn || !epoch || !idle || !gallery) {
  throw new Error("page shell is missing");
}

const viz = new Visualizer(canvas, false);
let shown: SequencerState = initialState();
let ctx: AudioContext | null = null;
let player: LivePlayer | null = null;
let speed = cfg.speed;
let visOrigin = performance.now();

modeEl.textContent = cfg.mode;
speedInput.value = String(speed);
if (cfg.mode === "replay") transport.hidden = false;
let replaySpan = 0;
const infoEl: HTMLElement = info;
const statusEl: HTMLElement = status;
const epochEl: HTMLElement = epoch;
const idleEl: HTMLElement = idle;
const galleryEl: HTMLElement = gallery;
let virtualNow: number | null = null;
let queuedDrop: AppliedSwap["drop"] | null = null;
let selectedEra: string | null = cfg.mode === "gallery" ? ERAS[0].id : null;
let epochLabel = "";
let fadeUntil = 0;

function note(text: string) {
  statusEl.textContent = text;
}

function eraLabel(state: SequencerState): string {
  const n = epochOf(state);
  const name = selectedEra ? eraById(selectedEra).name : eraOf(n).name;
  return `EPOCH #${n} · ${name}`;
}

function paintEpoch(state: SequencerState) {
  const label = eraLabel(state);
  const now = performance.now();
  if (label !== epochLabel) {
    epochLabel = label;
    epochEl.textContent = label;
    fadeUntil = now + 700;
  }
  const fading = Boolean(player?.getEra().fading) || now < fadeUntil;
  epochEl.classList.toggle("is-fading", fading);
}

function clockNow(state: SequencerState): number {
  if (cfg.mode === "replay") return virtualNow ?? state.lastTs;
  if (cfg.mode === "demo") return state.lastTs > 0 ? state.lastTs : 0;
  return Date.now() / 1000;
}

function paintIdle(state: SequencerState) {
  const stage = idleStage(state, clockNow(state));
  idleEl.textContent = stage.label;
  idleEl.dataset.stage = stage.stage;
}

function show(state: SequencerState, flash?: AppliedSwap) {
  shown = state;
  player?.setState(state);
  if (cfg.mode === "demo") player?.setClock(state.lastTs > 0 ? state.lastTs : 0);
  if (flash?.drop) {
    if (player) player.noteDrop(flash.drop);
    else queuedDrop = flash.drop;
  }
  infoEl.textContent = infoLine(state);
  paintEpoch(state);
  paintIdle(state);
  if (!flash) return;
  const now = performance.now();
  if (flash.row) viz.flashRow(flash.track, now);
  else viz.flash(flash.track, flash.step, now);
  if (flash.bass) viz.flash(4, flash.step, now);
}

speedInput.addEventListener("input", () => {
  const next = Number(speedInput.value);
  if (Number.isFinite(next) && next > 0) speed = next;
});

fitBtn.addEventListener("click", () => {
  if (replaySpan <= 0) return;
  speed = Math.max(0.25, replaySpan / 48);
  speedInput.value = String(Math.round(speed * 100) / 100);
});

if (cfg.mode === "demo") {
  note("demo · local swaps");
  startDemo({ setState: show });
} else if (cfg.mode === "replay") {
  const url = cfg.timelineUrl ?? "/demo-timeline.json";
  note(`replay · ${url}`);
  void loadTimeline(url)
    .then((points) => {
      replaySpan = points.length ? points[points.length - 1].time : 0;
      const hours = replaySpan / 3600;
      const spanLabel = hours >= 1 ? `${hours.toFixed(1)}h` : `${replaySpan.toFixed(1)}s`;
      note(`replay · ${points.length} states · ${spanLabel}`);
      startReplay(points, {
        onPoint: (point) =>
          show(
            point.state,
            point.drop || point.flash
              ? {
                  track: point.drop?.track ?? point.flash?.track ?? 0,
                  step: point.flash?.step ?? 0,
                  bass: Boolean(point.flash?.bass),
                  row: Boolean(point.flash?.row || point.drop),
                  drop: point.drop,
                }
              : undefined,
          ),
        onStatus: note,
        getSpeed: () => speed,
        onClock: (nowSec) => {
          virtualNow = nowSec;
          player?.setClock(nowSec);
          paintIdle(shown);
        },
      });
    })
    .catch((err: unknown) => {
      note(err instanceof Error ? err.message : String(err));
    });
} else if (cfg.mode === "gallery") {
  shown = galleryState();
  infoEl.textContent = infoLine(shown);
  galleryEl.hidden = false;
  note("gallery · one pattern, eight eras");
  for (const era of ERAS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = era.name;
    button.dataset.era = era.id;
    button.addEventListener("click", () => {
      selectedEra = era.id;
      player?.setEraOverride(era.id);
      galleryEl.querySelectorAll("button").forEach((other) => {
        other.dataset.on = other.dataset.era === era.id ? "1" : "0";
      });
      paintEpoch(shown);
    });
    galleryEl.append(button);
  }
  const first = galleryEl.querySelector("button");
  if (first) first.dataset.on = "1";
  paintEpoch(shown);
} else {
  startLive(cfg, { onState: show, onStatus: note });
}

startBtn.addEventListener("click", async () => {
  try {
    if (player?.running) {
      player.stop();
      startBtn.textContent = "start audio";
      startBtn.dataset.on = "0";
      visOrigin = performance.now();
      return;
    }
    if (!ctx || !player) {
      ctx = new AudioContext({ sampleRate: 44100 });
      player = createLivePlayer(ctx);
      player.setState(shown);
      if (selectedEra) player.setEraOverride(selectedEra);
      if (cfg.mode === "demo") player.setClock(shown.lastTs > 0 ? shown.lastTs : 0);
      if (queuedDrop) {
        player.noteDrop(queuedDrop);
        queuedDrop = null;
      }
    }
    if (ctx.state !== "running") await ctx.resume();
    player.setState(shown);
    player.start();
    startBtn.textContent = "stop";
    startBtn.dataset.on = "1";
  } catch (err) {
    note(err instanceof Error ? err.message : String(err));
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target === document.body) {
    event.preventDefault();
    startBtn.click();
  }
});

function playhead(): { step: number; phase: number; bar: number } {
  if (player?.running) {
    const transportView = player.getTransport();
    return { step: transportView.step, phase: transportView.phase, bar: transportView.bar };
  }
  const dur = stepDuration(shown.bpm) * 1000;
  const elapsed = performance.now() - visOrigin;
  return { step: Math.floor(elapsed / dur) % 16, phase: (elapsed % dur) / dur, bar: Math.floor(elapsed / dur / 16) };
}

function frame(now: number) {
  viz.resize();
  const head = playhead();
  viz.setFrame(shown, head.step, head.phase, head.bar);
  viz.draw(now);
  if (!infoEl.textContent) infoEl.textContent = infoLine(shown);
  paintEpoch(shown);
  paintIdle(shown);
  requestAnimationFrame(frame);
}

info.textContent = infoLine(shown);
paintEpoch(shown);
paintIdle(shown);
requestAnimationFrame(frame);

declare global {
  interface Window {
    __playerState?: () => { running: boolean; info: string; epoch: string };
    __eraList?: { id: string; name: string }[];
    __renderEra?: (eraId: string) => Promise<string>;
  }
}

window.__playerState = () => ({
  running: Boolean(player?.running),
  info: infoLine(shown),
  epoch: epochEl.textContent ?? "",
});

window.__eraList = ERAS.map((era) => ({ id: era.id, name: era.name }));

window.__renderEra = async (eraId: string) => {
  const buffer = await renderTimelineToBuffer([{ time: 0, state: galleryState() }], 12, 44100, { eraId });
  return audioBufferToWavBase64(buffer);
};
