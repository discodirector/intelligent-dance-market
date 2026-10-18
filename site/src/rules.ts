// Hook rules versions. "v1" is the deployed hook (fixed IMD tiers, slots without heat); "v2" adds relative tiers,
// accumulation and heat -> drop (core V2_RULES / V2_SLOTS). Everything that decodes or simulates state goes through here.
import {
  DEFAULT_DROP_RULES,
  decode,
  initialDropState,
  initialRelativeState,
  initialState,
  V2_RULES,
  V2_SLOTS,
  type MutateOptions,
  type SlotOptions,
  type State,
} from "@swarm-sequencer/core";
import type { SequencerState } from "@swarm-sequencer/synth";

export type RulesVersion = "v1" | "v2";

export interface Rules {
  version: RulesVersion;
  /** mutate() options; undefined = v1. */
  mutate: MutateOptions | undefined;
  /** encode/decode layout; undefined = v1. */
  slots: SlotOptions | undefined;
  /** Heat at which a track drops; 0 = no heat in this version. */
  heatMax: number;
  initial(): State;
}

export const RULES: Record<RulesVersion, Rules> = {
  v1: { version: "v1", mutate: undefined, slots: undefined, heatMax: 0, initial: initialState },
  v2: { version: "v2", mutate: V2_RULES, slots: V2_SLOTS, heatMax: DEFAULT_DROP_RULES.heatMax, initial: () => initialDropState(initialRelativeState()) },
};

export const isRulesVersion = (v: unknown): v is RulesVersion => v === "v1" || v === "v2";

export function decodeSlots(slot0: bigint | string, slot1: bigint | string, rules: Rules): State {
  return decode(slot0, slot1, rules.slots);
}

/**
 * Core state -> synth state. v1 passes through untouched (same object, as before). v2 normalises the raw uint8
 * heat to 0..1 by heatMax, which is what the synth heat path expects.
 */
export function toSynth(s: State, rules: Rules): SequencerState {
  if (!rules.heatMax) return s as SequencerState;
  return { ...(s as SequencerState), heat: Math.min(1, (s.heat ?? 0) / rules.heatMax), trackNo: s.trackNo ?? 0 };
}
