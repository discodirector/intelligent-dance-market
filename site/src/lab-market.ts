// The style lab's market (lab.ts, lab-take.ts): trades through the hook's v2 rules in the browser (core mutate, as
// data/virtual.ts does for a pool), reproducible. Every random choice (trade sizes, price moves, the auto market's
// timing and sides) comes from a seeded PRNG, and every timestamp from the step it lands on (a virtual clock: 8 steps a
// second from T0), so a take's seed and its events replay the same trades, live or rendered offline.
import { mutate, whaleThresholdFor, type State } from "@swarm-sequencer/core";
import type { DropCue, SequencerState } from "@swarm-sequencer/synth";
import { decodeSlots, RULES, toSynth } from "./rules";

const rules = RULES.v2;
export type Trade = "buy" | "sell" | "whale" | "whale-sell";
export const TRADES: readonly Trade[] = ["buy", "sell", "whale", "whale-sell"];

/** The lab market's virtual clock: unix seconds at step 0, and 8 steps a second after it. */
export const T0 = 1_790_000_000;
export const stepTs = (step: number) => T0 + Math.floor(step / 8);

/** mulberry32: a small, fast, seedable PRNG (0..1). */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;

/** What a trade did, for the player and the tape. */
export interface TradeResult {
  kind: Trade;
  /** Where it landed on the grid, for the screen's flash (visuals.ts Flash). */
  track: number;
  step: number;
  whale: boolean;
  state: SequencerState;
  drop?: DropCue;
  /** The swap finished the track: the player holds this until the next downbeat, which lands as the drop. */
  held?: SequencerState;
  label: string;
}

/** The pool tick a lab market starts at (an FDV of ~30 ETH: whale threshold in a plausible range). */
const TICK0 = 175_000;

export class Market {
  state!: State;
  trades = 0;
  private tick = TICK0;
  private block = 1;
  private size!: () => number;
  private dice!: () => number;
  private nextAuto = 0;

  constructor(seed: number) {
    this.reset(seed);
  }

  /** A market that already traded a little (so the first bar has a pattern), from the seed alone. */
  reset(seed: number) {
    this.size = prng(seed);
    this.dice = prng(seed ^ 0x9e3779b9);
    this.state = rules.initial();
    this.tick = TICK0;
    this.block = 1;
    this.trades = 0;
    for (let i = 0; i < 26; i++) this.trade(this.size() < 0.62 ? "buy" : "sell", -(26 - i) * 40);
    this.autoFrom(0);
  }

  get synth(): SequencerState {
    return toSynth(this.state, rules);
  }

  /** One trade landing on `step` (its timestamp is the step's). */
  trade(kind: Trade, step: number): TradeResult {
    const isBuy = kind === "buy" || kind === "whale";
    const whale = kind === "whale" || kind === "whale-sell";
    const limit = whaleThresholdFor("ETH", this.tick);
    const size = whale ? (limit * 13n) / 10n : (limit * BigInt(3 + Math.floor(this.size() * 157))) / 1000n;
    this.tick += (isBuy ? -1 : 1) * (whale ? 420 : 8 + Math.floor(this.size() * 102));
    this.block += 1;
    const r = mutate(this.state, { isBuy, quoteAmt: size, tick: this.tick, blockNumber: this.block, timestamp: stepTs(step) }, undefined, rules.mutate);
    this.state = r.state;
    this.trades += 1;
    const done = r.event.trackComplete;
    return {
      kind,
      track: r.event.track,
      step: r.event.step,
      whale: r.event.whale,
      state: this.synth,
      ...(r.event.drop ? { drop: r.event.drop } : {}),
      ...(done ? { held: toSynth(decodeSlots(done.slot0, done.slot1, rules), rules) } : {}),
      label: done ? "track drop" : r.event.whale ? (isBuy ? "row written" : "row wiped") : `track ${r.event.track}`,
    };
  }

  /** The auto market from `step` on: its next trade lands 4..25 steps later. */
  autoFrom(step: number) {
    this.nextAuto = step + 4 + Math.floor(this.dice() * 22);
  }

  /** The auto market's trade on `step`, or null: whales 4.5%, buys 55%, sells the rest, 4..25 steps apart. */
  auto(step: number): Trade | null {
    if (step < this.nextAuto) return null;
    const x = this.dice();
    this.autoFrom(step);
    return x < 0.03 ? "whale" : x < 0.045 ? "whale-sell" : x < 0.6 ? "buy" : "sell";
  }
}
