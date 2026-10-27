// Hamster station (kind "hamster", docs/STATIONS.md "Hamster station"): a real hamster's wheel (Squeekchain) played
// through the same v2 rules in the browser. The API keeps no history, so our recorder logs it and the publisher
// (bot/src/hamster/publish.ts) hands out the night as one JSON file; every viewer decodes it with core hamster.ts
// (one BUY per 30 m of wheel, a SELL when it stops, a whale per milestone) from the station's first measurement, so
// all of them hear the same state, then polls the file for what is new. The newest measurement, still or not, drives
// the wheel on screen. Sleep is the player's (synth sleep.ts): nothing here changes when the hamster sleeps.
//
// Replay of the last run: the inputs of the last finished run (a stretch of inputs with no gap of SLEEP_AFTER_SEC),
// from the state just before it, on a virtual clock at 1x; live inputs wait meanwhile and land as history after it.
import { decodeHamster, emptyHamsterCarry, mutate, type HamsterCarry, type HamsterEvent, type HamsterInput, type HamsterSample, type State } from "@swarm-sequencer/core";
import { SLEEP_AFTER_SEC } from "@swarm-sequencer/synth";
import type { Network } from "../config";
import { decodeSlots, RULES } from "../rules";
import type { Feed, SwapEvent } from "./types";

const POLL_MS = 5_000;
const TIMEOUT_MS = 8_000;

export interface HamsterSourceConfig {
  /** The publisher's file (CHECKPOINT_BASE/hamster.json). */
  url: string;
}

/** The newest measurement. */
export interface HamsterNow extends HamsterSample {
  freshness: string;
}

/** One played input: the event as the feed got it, and the state before it. */
interface Played {
  ev: SwapEvent;
  before: State;
}

export interface HamsterRun {
  /** Unix seconds of its first and last input. */
  start: number;
  end: number;
  /** Metres the wheel turned in it. */
  metres: number;
  inputs: number;
}

export interface HamsterControl {
  /** Newest measurement (null before the first read). */
  now(): HamsterNow | null;
  /** The last finished run, or null. */
  lastRun(): HamsterRun | null;
  /** Plays the last finished run at 1x on a virtual clock; `onEnd` when it ends or is stopped. False: no run. */
  replay(onEnd: () => void): boolean;
  stopReplay(): void;
  readonly replaying: boolean;
  stop(): void;
}

export function startHamster(net: Network, feed: Feed, cfg: HamsterSourceConfig): HamsterControl {
  const rules = RULES.v2;
  let state: State = rules.initial();
  let trackStart = state.swapCount;
  let carry: HamsterCarry = emptyHamsterCarry();
  let now: HamsterNow | null = null;
  const played: Played[] = [];
  let closed = false;
  let timer = 0;
  let synced = false;
  /** While a replay plays: live inputs wait here, played as history after it. */
  let held: SwapEvent[] | null = null;
  let replayTimer = 0;
  let replayEnd: (() => void) | null = null;

  function toEvent(i: HamsterInput): SwapEvent {
    const before = state;
    const r = mutate(state, i, undefined, rules.mutate);
    state = r.state;
    const ts = Number(i.timestamp);
    const ev: SwapEvent = {
      ts,
      block: ts,
      tx: null,
      isBuy: r.event.isBuy,
      quote: i.hamster.speed / 1000,
      quoteSymbol: "ETH",
      track: r.event.track,
      step: r.event.writeStep ?? r.event.step,
      on: r.event.on,
      bassNote: r.event.bassNote,
      whale: r.event.whale,
      state,
      hamster: i.hamster,
    };
    const tc = r.event.trackComplete;
    if (tc) {
      ev.trackComplete = { trackNo: tc.trackNo, swaps: tc.swapCount - trackStart, held: decodeSlots(tc.slot0, tc.slot1, rules) };
      trackStart = tc.swapCount;
    }
    played.push({ ev, before });
    return ev;
  }

  async function read() {
    const res = await fetch(`${cfg.url}?t=${Math.floor(Date.now() / POLL_MS)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { samples?: [number, number, number, number][]; events?: HamsterEvent[]; now?: HamsterNow | null };
    if (!Array.isArray(j.samples)) throw new Error("not a hamster file");
    const samples = j.samples.map(([t, rpmMilli, speedMmPerSecond, distanceMm]) => ({ t, rpmMilli, speedMmPerSecond, distanceMm }));
    const r = decodeHamster(samples, j.events ?? [], carry);
    carry = r.carry;
    now = j.now ?? now;
    return r.inputs;
  }

  async function loop() {
    try {
      const inputs = await read();
      if (closed) return;
      const first = !synced;
      for (const i of inputs) {
        const ev = toEvent(i);
        if (held) held.push(ev);
        else feed.onSwap(ev, first);
      }
      if (first) {
        feed.onState(state);
        synced = true;
      }
      feed.onStatus(`${net.label} · live`, true);
    } catch (err) {
      feed.onStatus(`${net.label} · data error, retrying`, false);
      console.warn(err);
    }
    if (!closed) timer = window.setTimeout(loop, POLL_MS);
  }

  /** The last run whose last input is SLEEP_AFTER_SEC old (a run going on now is live, not a replay). */
  function lastRunRange(): [number, number] | null {
    const t = (k: number) => played[k].ev.ts;
    const nowSec = Date.now() / 1000;
    let end = played.length - 1;
    while (end >= 0 && nowSec - t(end) < SLEEP_AFTER_SEC) {
      // skip the run going on now: back to the gap before it
      let k = end;
      while (k > 0 && t(k) - t(k - 1) < SLEEP_AFTER_SEC) k--;
      end = k - 1;
    }
    if (end < 0) return null;
    let start = end;
    while (start > 0 && t(start) - t(start - 1) < SLEEP_AFTER_SEC) start--;
    return [start, end];
  }

  function stopReplay() {
    if (!replayEnd) return;
    clearTimeout(replayTimer);
    const done = replayEnd;
    replayEnd = null;
    feed.onClock(null);
    // Back to live: the state now, then whatever arrived meanwhile, as history.
    const waiting = held ?? [];
    feed.onReset?.(waiting.length ? played[played.length - waiting.length].before : state);
    for (const ev of waiting) feed.onSwap(ev, true);
    held = null;
    feed.onState(state);
    done();
  }

  void loop();
  return {
    now: () => now,
    lastRun() {
      const r = lastRunRange();
      if (!r) return null;
      const [a, b] = r;
      const metres = played.slice(a, b + 1).filter((p) => p.ev.hamster?.via === "run").length * 30;
      return { start: played[a].ev.ts, end: played[b].ev.ts, metres, inputs: b - a + 1 };
    },
    replay(onEnd) {
      const r = lastRunRange();
      if (!r || replayEnd) return false;
      const [a, b] = r;
      const run = played.slice(a, b + 1);
      held = [];
      replayEnd = onEnd;
      const t0 = run[0].ev.ts;
      const wall0 = performance.now() / 1000;
      feed.onReset?.(run[0].before);
      let k = 0;
      // A virtual clock at 1x from the run's first input; each input lands when the clock passes it.
      const step = () => {
        const virt = t0 + (performance.now() / 1000 - wall0);
        feed.onClock(virt);
        while (k < run.length && run[k].ev.ts <= virt) feed.onSwap(run[k++].ev, false);
        if (k >= run.length) {
          // let the last bar ring, then back to live
          replayTimer = window.setTimeout(stopReplay, 8_000);
          return;
        }
        replayTimer = window.setTimeout(step, 250);
      };
      step();
      return true;
    },
    stopReplay,
    get replaying() {
      return replayEnd !== null;
    },
    stop() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(replayTimer);
    },
  };
}
