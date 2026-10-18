/** Seconds. SPEC §4.2. */
export const IDLE_FULL_SEC = 10 * 60;
export const IDLE_SPARSE_SEC = 30 * 60;
export const IDLE_DRONE_SEC = 60 * 60;

export type IdleName = "full" | "thinning" | "sparse" | "drone";

export interface IdleGains {
  kick: number;
  snare: number;
  hat: number;
  glitch: number;
  bass: number;
  pad: number;
  lead: number;
  /** Sustained root/fifth tone that keeps a long-idle pool audible in every era. */
  drone: number;
  /**
   * Heat -> drop prototype: multiplier on every heat-driven effect (filter, drive, rolls, riser).
   * 1 in "full", fading through thinning and sparse, 0 at drone, so a riser never drones over silence.
   * Undefined is 1.
   */
  heat?: number;
}

export interface IdleStage extends IdleGains {
  /** Seconds since the last swap. 0 when `lastTs` is still 0. */
  idleSec: number;
  stage: IdleName;
  /** `IDLE 23m · THINNING` */
  label: string;
}

function clamp01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/** 0 at `a`, 1 at `b`. */
function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** 1 at `a`, 0 at `b`. */
function fade(a: number, b: number, x: number): number {
  return 1 - smooth(a, b, x);
}

export function idleLabel(idleSec: number, stage: IdleName): string {
  const name = stage === "full" ? "FULL" : stage === "thinning" ? "THINNING" : stage === "sparse" ? "SPARSE" : "DRONE";
  const idle = Math.max(0, idleSec);
  if (idle < 60) return `IDLE ${Math.floor(idle)}s · ${name}`;
  return `IDLE ${Math.floor(idle / 60)}m · ${name}`;
}

/** Heat effects follow the idle stage: 1 until IDLE_FULL_SEC, smooth fade to 0 at IDLE_DRONE_SEC. */
export function heatIdleFactor(idleSec: number): number {
  return fade(IDLE_FULL_SEC, IDLE_DRONE_SEC, idleSec);
}

/**
 * How quiet the market is. `nowSec` is wall-clock unix time in live mode and
 * the timeline's virtual clock in replay and offline render. `lastTs === 0`
 * means no swap yet, so the opening groove stays full.
 */
export function idleStage(state: { lastTs: number }, nowSec: number): IdleStage {
  const last = state.lastTs;
  let idle = 0;
  if (last > 0 && Number.isFinite(nowSec)) idle = Math.max(0, nowSec - last);

  // 10–20 min: hats and glitch leave. 20–30 min: snare leaves.
  const hat = fade(IDLE_FULL_SEC, 20 * 60, idle);
  const glitch = hat;
  const snare = fade(20 * 60, IDLE_SPARSE_SEC, idle);
  // 30–60 min: kick settles to a quiet pulse, then drops out.
  let kick = 1;
  if (idle >= IDLE_SPARSE_SEC && idle < IDLE_DRONE_SEC) kick = 1 - smooth(IDLE_SPARSE_SEC, IDLE_DRONE_SEC, idle) * 0.72;
  else if (idle >= IDLE_DRONE_SEC) kick = 0.28 - smooth(IDLE_DRONE_SEC, 65 * 60, idle) * 0.1;
  const lead = fade(IDLE_SPARSE_SEC, 40 * 60, idle);
  // The drone must stay clearly audible: bass settles to a low hum, pad stays full, kick is a soft heartbeat.
  const bass = 1 - smooth(50 * 60, IDLE_DRONE_SEC, idle) * 0.45;
  const pad = 1;
  const drone = smooth(40 * 60, IDLE_DRONE_SEC, idle);

  let stage: IdleName = "full";
  if (idle >= IDLE_DRONE_SEC) stage = "drone";
  else if (idle >= IDLE_SPARSE_SEC) stage = "sparse";
  else if (idle >= IDLE_FULL_SEC) stage = "thinning";

  return {
    idleSec: idle,
    stage,
    label: idleLabel(idle, stage),
    kick,
    snare,
    hat,
    glitch,
    bass,
    pad,
    lead,
    drone,
    heat: heatIdleFactor(idle),
  };
}
