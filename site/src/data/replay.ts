// Replay feed: W3's timeline.json (bot/TIMELINE.md) played on a virtual clock; loops.
// Under the tape's own rules the recorded slots are decoded as-is; under other rules (dev preview,
// ?replay=imd-week&rules=v2) the tape's swap inputs are re-simulated through core mutate().
import { mutate } from "@swarm-sequencer/core";
import { decodeSlots, type Rules } from "../rules";
import { WHALE_WEI, type Feed, type SwapEvent } from "./types";

interface Entry {
  ts: number; blockNumber: number; txHash?: string; isBuy: boolean; imd: number; imdAmt?: string; tick?: number;
  track: number; step: number; on: boolean; bassNote: number; whale: boolean; slot0: string; slot1: string;
}

function recorded(rows: Entry[], rules: Rules): SwapEvent[] {
  return rows.map((r) => ({
    ts: r.ts, block: r.blockNumber, tx: r.txHash ?? null, isBuy: r.isBuy, imd: r.imd, track: r.track, step: r.step,
    on: r.on, bassNote: r.bassNote, whale: r.whale, state: decodeSlots(r.slot0, r.slot1, rules),
  }));
}

/** Re-runs the tape's inputs (isBuy, imdAmt, tick, block, ts) under `rules`. */
export function resimulate(rows: Entry[], rules: Rules): SwapEvent[] {
  let s = rules.initial();
  let trackStart = 0;
  return rows.map((r) => {
    if (r.imdAmt == null || r.tick == null) throw new Error("timeline has no imdAmt/tick to re-simulate");
    const imdAmt = BigInt(r.imdAmt);
    const { state, event } = mutate(s, { isBuy: r.isBuy, imdAmt, tick: r.tick, blockNumber: BigInt(r.blockNumber), timestamp: r.ts }, undefined, rules.mutate);
    s = state;
    const e: SwapEvent = {
      ts: r.ts, block: r.blockNumber, tx: r.txHash ?? null, isBuy: r.isBuy, imd: r.imd, track: event.track,
      step: event.writeStep ?? event.step, on: event.on, bassNote: event.bassNote, whale: imdAmt >= WHALE_WEI, state,
    };
    const tc = event.trackComplete;
    if (tc) {
      e.trackComplete = { trackNo: tc.trackNo, swaps: tc.swapCount - trackStart, held: decodeSlots(tc.slot0, tc.slot1, rules) };
      trackStart = tc.swapCount;
    }
    return e;
  });
}

export async function startReplay(url: string, speed: number, label: string, feed: Feed, rules: Rules, resim: boolean): Promise<() => void> {
  feed.onStatus(`${label} · loading`, true);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`timeline ${res.status}`);
  const rows = (await res.json()) as Entry[];
  const events = resim ? resimulate(rows, rules) : recorded(rows, rules);
  if (!events.length) throw new Error("empty timeline");
  const t0 = events[0].ts - 30;
  const t1 = events.at(-1)!.ts + 120;
  let virt = t0;
  let i = 0;
  let last = performance.now();
  let raf = 0;
  let closed = false;
  feed.onStatus(`${label}`, true);
  feed.onBlock(events[0].block);

  const tick = (now: number) => {
    if (closed) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    virt += dt * speed;
    while (i < events.length && events[i].ts <= virt) {
      feed.onSwap(events[i], false);
      feed.onBlock(events[i].block);
      i++;
    }
    if (virt > t1) { virt = t0; i = 0; feed.onStatus(`${label} · loop`, true); }
    feed.onClock(virt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { closed = true; cancelAnimationFrame(raf); };
}
