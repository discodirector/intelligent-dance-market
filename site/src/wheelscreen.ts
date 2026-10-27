// The wheel screen of the hamster station (docs/STATIONS.md "Hamster station"): a small LCD on the drum machine with
// the hamster running in its wheel at its live speed, on a dot matrix like the pattern grid (hamsterart.ts) (the newest measurement of our recorder, data/hamster.ts), what he is
// doing (running, resting, asleep, or the replay of his last run), and the REPLAY LAST RUN button. Drawn, not an
// image: no one's artwork or branding on the glass.
import type { HamsterControl, HamsterRun } from "./data/hamster";
import type { SleepSlot } from "@swarm-sequencer/synth";
import { SLEEP_AFTER_SEC } from "@swarm-sequencer/synth";
import { drawHamsterLCD } from "./hamsterart";
import { Surface } from "./visuals";

/** A measurement older than this is not "now": the wheel shows still. */
const STALE_MS = 120_000;

const hm = (sec: number) => {
  const m = Math.max(0, Math.floor(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)}H ${String(m % 60).padStart(2, "0")}M` : `${m}M`;
};
const hhmm = (ts: number) => new Date(ts * 1000).toISOString().slice(11, 16);
const mmss = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, "0")}`;

export interface WheelView {
  /** Unix seconds of the last input (state.lastTs), 0 = none yet. */
  lastInput: number;
  /** The sleep slot now, or null (synth sleepAt). */
  sleep: SleepSlot | null;
  /** The sleep style's name, when asleep. */
  sleepStyle?: string;
  /** The replay's virtual clock, or null live. */
  clock: number | null;
}

export class WheelScreen {
  private readonly surface: Surface;
  private readonly cap: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private angle = 0;
  private gait = 0;
  private lastFrame = 0;
  private replayRun: HamsterRun | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly ctl: HamsterControl,
    /** The page starts/stops the replay (it owns the player and the log). */
    private readonly onReplay: (on: boolean) => void,
  ) {
    this.surface = new Surface(el.querySelector("canvas")!);
    this.cap = el.querySelector(".wheel-cap")!;
    this.btn = el.querySelector("button")!;
    el.hidden = false;
    document.body.classList.add("has-nft-screen", "has-wheel");
    this.btn.addEventListener("click", () => this.onReplay(!this.ctl.replaying));
  }

  /** The run being replayed (null when the replay ends). */
  setReplay(run: HamsterRun | null) {
    this.replayRun = run;
  }

  frame(now: number, v: WheelView) {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    const m = this.ctl.now();
    const fresh = !!m && Date.now() - m.t < STALE_MS && !v.clock;
    // In a replay the wheel turns while the replayed inputs come (one per ~30 m): his usual pace.
    const replayRunning = !!v.clock && v.lastInput > 0 && v.clock - v.lastInput < 60;
    const rpm = replayRunning ? 75 : fresh && m!.rpmMilli > 0 ? m!.rpmMilli / 1000 : 0;
    this.angle += (rpm / 60) * Math.PI * 2 * dt;
    const speed = replayRunning ? 1050 : fresh && m!.rpmMilli > 0 ? m!.speedMmPerSecond : 0;
    this.draw(rpm, speed, !!v.sleep && !v.clock, dt, now);

    let cap: string;
    if (this.ctl.replaying && this.replayRun && v.clock) {
      const r = this.replayRun;
      cap = `REPLAY ${hhmm(r.start)}–${hhmm(r.end)}\n${mmss(v.clock - r.start)}/${mmss(r.end - r.start)} · ${(r.metres / 1000).toFixed(1)} KM`;
    } else if (fresh && m!.rpmMilli > 0) {
      cap = `RUNNING · ${(m!.speedMmPerSecond / 1000).toFixed(2)} M/S\n${Math.round(m!.rpmMilli / 1000)} RPM · TODAY ${(m!.distanceMm / 1e6).toFixed(2)} KM`;
    } else if (v.sleep) {
      cap = `ASLEEP · ${hm(v.sleep.asleepSec + SLEEP_AFTER_SEC)}\nDREAMING: ${(v.sleepStyle ?? "").toUpperCase()}`;
    } else if (v.lastInput) {
      cap = `RESTING · ${hm(Date.now() / 1000 - v.lastInput)}\n${m ? `TODAY ${(m.distanceMm / 1e6).toFixed(2)} KM` : ""}`;
    } else cap = "WAITING FOR THE WHEEL";
    if (this.cap.textContent !== cap) this.cap.textContent = cap;

    const run = this.ctl.replaying ? null : this.ctl.lastRun();
    const label = this.ctl.replaying ? "■ BACK TO LIVE" : run ? "▶ REPLAY LAST RUN" : "NO FINISHED RUN YET";
    if (this.btn.textContent !== label) this.btn.textContent = label;
    const title = run ? `The last run, ${hhmm(run.start)}–${hhmm(run.end)} UTC, ${(run.metres / 1000).toFixed(2)} km, at 1x` : "";
    if (this.btn.title !== title) this.btn.title = title;
    this.btn.disabled = !this.ctl.replaying && !run;
  }

  private draw(rpm: number, speedMmS: number, asleep: boolean, dt: number, now: number) {
    const { ctx, w, h } = this.surface;
    const css = getComputedStyle(this.el);
    const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
    const colors = { bg: v("--lcd-bg", "#120b04"), on: v("--phos", "#ffc46b"), dim: v("--phos-dim", "#a3702a"), ghost: v("--phos-ghost", "#2e1f0c") };
    // About 3.2 strides per metre of wheel: legs and wheel keep the same pace.
    this.gait += 2 * Math.PI * (speedMmS / 1000) * 3.2 * dt;
    drawHamsterLCD(ctx, w, h, { angle: this.angle, gait: this.gait, pose: rpm > 0 ? "run" : asleep ? "sleep" : "sit", t: now / 1000 }, colors, 56);
  }
}
