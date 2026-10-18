import { nowAt, type TimelinePoint } from "@swarm-sequencer/synth";
import { normalizeTimeline, type RawTimelineEvent } from "../timeline";

export interface ReplayHooks {
  onPoint: (point: TimelinePoint) => void;
  onStatus: (text: string) => void;
  getSpeed: () => number;
  /** Virtual unix time, so idle follows the tape instead of the wall clock. */
  onClock?: (nowSec: number) => void;
}

export async function loadTimeline(url: string): Promise<TimelinePoint[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`timeline ${response.status} ${url}`);
  const json = (await response.json()) as RawTimelineEvent[];
  if (!Array.isArray(json)) throw new Error("timeline is not an array");
  return normalizeTimeline(json);
}

/** Plays timestamped states. Speed scales timeline time. Loops when the tape ends. */
export function startReplay(points: TimelinePoint[], hooks: ReplayHooks): () => void {
  if (points.length === 0) {
    hooks.onStatus("replay · empty timeline");
    return () => {};
  }
  let index = 0;
  let pos = 0;
  let last = performance.now();
  let raf = 0;
  hooks.onPoint(points[0]);
  if (points[0].now != null) hooks.onClock?.(points[0].now);
  index = points[0].time <= 0 ? 1 : 0;

  const tick = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    pos += dt * Math.max(0.05, hooks.getSpeed());
    const end = points[points.length - 1].time;
    while (index < points.length && points[index].time <= pos) {
      hooks.onPoint(points[index]);
      index += 1;
    }
    if (index >= points.length && pos > end + 0.4) {
      pos = 0;
      index = 0;
      hooks.onStatus("replay · loop");
    }
    const clock = nowAt(points, pos);
    if (clock != null) hooks.onClock?.(clock);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
