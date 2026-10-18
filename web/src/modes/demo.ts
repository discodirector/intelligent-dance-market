import type { SequencerState } from "@swarm-sequencer/synth";
import { initialState, mutate, type SwapInput } from "../demo/mutate";

const E = 10n ** 18n;
const AMOUNTS = [E / 4n, E / 2n - 1n, 2n * E, 4n * E, 12n * E, 20n * E, 45n * E, 80n * E, 150n * E];

export interface AppliedSwap {
  track: number;
  step: number;
  bass: boolean;
  /** Whale: light the whole track row. */
  row?: boolean;
  drop?: { track: number; fill: boolean; mask?: number };
}

export interface DemoHooks {
  setState: (state: SequencerState, flash?: AppliedSwap) => void;
}

/** Local random swaps through the temporary mutate(). The grid keeps moving before audio starts. */
export function startDemo(hooks: DemoHooks): () => void {
  let state = initialState();
  let block = 18_400_000n;
  hooks.setState(state);

  const id = window.setInterval(() => {
    const input: SwapInput = {
      isBuy: Math.random() < 0.62,
      imdAmt: AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)] ?? E,
      tick: Math.floor(Math.random() * 3600) - 600,
      blockNumber: block,
      timestamp: state.lastTs === 0 ? 1_700_000_000 : state.lastTs + 3 + Math.floor(Math.random() * 24),
    };
    block += 1n;
    const next = mutate(state, input);
    state = next.state;
    hooks.setState(state, {
      track: next.event.track,
      step: next.event.step,
      bass: next.event.isBuy || next.event.bassNote === 0,
    });
  }, 1400);

  return () => window.clearInterval(id);
}
