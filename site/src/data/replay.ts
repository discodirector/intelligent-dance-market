// Replay feed: W3's timeline.json (bot/TIMELINE.md) played on a virtual clock; loops.
// Under the tape's own rules the recorded slots are decoded as-is; under other rules (dev preview,
// ?replay=sepolia&rules=v1) the tape's swap inputs are re-simulated through core mutate().
// Tapes carry quoteAmt/quote (ETH); legacy tapes carry imdAmt/imd (IMD-quoted) and are still accepted.
import { ETH_THRESHOLDS, IMD_WHALE_WEI, mutate } from "@swarm-sequencer/core";
import { amountWei, quoteOf, quoteSymbolOf, type RawTimelineEvent } from "../../../web/src/timeline";
import { epochOf } from "@swarm-sequencer/synth";
import { decodeSlots, type Rules } from "../rules";
import { type Feed, type SwapEvent } from "./types";

type Entry = Pick<RawTimelineEvent, "quoteAmt" | "quote" | "quoteSymbol" | "imdAmt" | "imd"> & {
  ts: number; blockNumber: number; txHash?: string; isBuy: boolean; tick?: number;
  track: number; step: number; on: boolean; bassNote: number; whale: boolean; slot0: string; slot1: string;
  /** v2 tapes (bot/src/lib/timeline.ts): this swap finished a track; slots = the finished track. */
  trackComplete?: { trackNo: number; swaps?: number; slot0: string; slot1: string };
};

function recorded(rows: Entry[], rules: Rules): SwapEvent[] {
  return rows.map((r) => {
    const e: SwapEvent = {
      ts: r.ts, block: r.blockNumber, tx: r.txHash ?? null, isBuy: r.isBuy, quote: quoteOf(r), quoteSymbol: quoteSymbolOf(r),
      track: r.track, step: r.step, on: r.on, bassNote: r.bassNote, whale: r.whale, state: decodeSlots(r.slot0, r.slot1, rules),
    };
    const tc = r.trackComplete;
    if (tc) e.trackComplete = { trackNo: tc.trackNo, swaps: tc.swaps ?? 0, held: decodeSlots(tc.slot0, tc.slot1, rules) };
    return e;
  });
}

/**
 * Re-runs the tape's inputs (isBuy, amount, tick, block, ts) under `rules`, which are calibrated in ETH.
 * A legacy IMD tape is scaled by the calibration's 1/400 (1 IMD -> 0.0025 ETH), so it plays as it did.
 */
export function resimulate(rows: Entry[], rules: Rules): SwapEvent[] {
  let s = rules.initial();
  let trackStart = 0;
  return rows.map((r) => {
    const wei = amountWei(r);
    if (wei == null || r.tick == null) throw new Error("timeline has no quoteAmt/tick to re-simulate");
    const symbol = quoteSymbolOf(r);
    const quoteAmt = symbol === "IMD" ? wei / 400n : wei;
    // v2: the hook's own whale (FDV-scaled from the tick). v1 replays keep their legacy fixed label.
    const { state, event } = mutate(s, { isBuy: r.isBuy, quoteAmt, tick: r.tick, blockNumber: BigInt(r.blockNumber), timestamp: r.ts }, undefined, rules.mutate);
    s = state;
    const e: SwapEvent = {
      ts: r.ts, block: r.blockNumber, tx: r.txHash ?? null, isBuy: r.isBuy, quote: quoteOf(r), quoteSymbol: symbol, track: event.track,
      step: event.writeStep ?? event.step, on: event.on, bassNote: event.bassNote, whale: rules.version === "v2" ? event.whale : wei >= (symbol === "IMD" ? IMD_WHALE_WEI : ETH_THRESHOLDS.kick), state,
    };
    const tc = event.trackComplete;
    if (tc) {
      e.trackComplete = { trackNo: tc.trackNo, swaps: tc.swapCount - trackStart, held: decodeSlots(tc.slot0, tc.slot1, rules) };
      trackStart = tc.swapCount;
    }
    return e;
  });
}

/** Seconds each genre (epoch) plays in a replay: long enough to hear it, short enough to keep the week moving. */
export const EPOCH_PLAY: readonly [number, number] = [45, 75];

/**
 * Play time for every event: each epoch's stretch of the tape lasts its real duration / speed, clamped to EPOCH_PLAY,
 * and time inside an epoch runs evenly. A plain speed-up gave the median genre 14 s and the shortest 1 s.
 */
export function playTimes(ts: number[], epochs: number[], speed: number, t0: number, t1: number, span = EPOCH_PLAY): number[] {
  const starts = [0];
  for (let i = 1; i < ts.length; i++) if (epochs[i] !== epochs[i - 1]) starts.push(i);
  const out = new Array<number>(ts.length);
  let at = 0;
  starts.forEach((s, k) => {
    const from = k === 0 ? t0 : ts[s];
    const to = k + 1 < starts.length ? ts[starts[k + 1]] : t1;
    const real = Math.max(1, to - from);
    const play = Math.min(span[1], Math.max(span[0], real / speed));
    const end = k + 1 < starts.length ? starts[k + 1] : ts.length;
    for (let i = s; i < end; i++) out[i] = at + ((ts[i] - from) / real) * play;
    at += play;
  });
  out.push(at); // loop end, mapped to t1
  return out;
}

export async function startReplay(url: string, speed: number, label: string, feed: Feed, rules: Rules, resim: boolean, span: readonly [number, number] = EPOCH_PLAY): Promise<() => void> {
  feed.onStatus(`${label} · loading`, true);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`timeline ${res.status}`);
  const rows = (await res.json()) as Entry[];
  const events = resim ? resimulate(rows, rules) : recorded(rows, rules);
  if (!events.length) throw new Error("empty timeline");
  const t0 = events[0].ts - 30;
  const t1 = events.at(-1)!.ts + 120;
  // Knots of a piecewise-linear map play seconds -> tape unix time: (0, t0), each event, (loop end, t1).
  const P = [0, ...playTimes(events.map((e) => e.ts), events.map((e) => epochOf(e.state)), speed, t0, t1, span)];
  const T = [t0, ...events.map((e) => e.ts), t1];
  let play = 0;
  let k = 0;
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
    play += dt;
    if (play > P.at(-1)!) { play = 0; k = 0; i = 0; feed.onStatus(`${label} · loop`, true); }
    while (k + 2 < P.length && P[k + 1] <= play) k++;
    const span = P[k + 1] - P[k];
    const virt = span > 0 ? T[k] + ((play - P[k]) / span) * (T[k + 1] - T[k]) : T[k + 1];
    while (i < events.length && events[i].ts <= virt) {
      feed.onSwap(events[i], false);
      feed.onBlock(events[i].block);
      i++;
    }
    feed.onClock(virt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { closed = true; cancelAnimationFrame(raf); };
}
