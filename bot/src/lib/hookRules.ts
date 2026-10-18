// Which hook rules a timeline follows. "v1": the deployed hook (fixed tiers, no heat). "v2": relative tiers +
// accumulation + heat/drop (core V2_RULES / V2_SLOTS). Live: HOOK_RULES (default v1, the deployed hook);
// pre-launch replays: REPLAY_RULES (default v1, so teasers stay as they are).
import { decode, initialDropState, initialRelativeState, initialState, V2_RULES, V2_SLOTS, type MutateOptions, type SlotOptions, type State } from "@swarm-sequencer/core";

export type HookRules = "v1" | "v2";

export const isHookRules = (v: unknown): v is HookRules => v === "v1" || v === "v2";

function fromEnv(name: string): HookRules {
  const v = process.env[name];
  if (v == null || v === "") return "v1";
  if (!isHookRules(v)) throw new Error(`${name} must be v1 or v2, got ${v}`);
  return v;
}

export const liveRulesFromEnv = () => fromEnv("HOOK_RULES");
export const replayRulesFromEnv = () => fromEnv("REPLAY_RULES");

export const mutateOptions = (r: HookRules): MutateOptions | undefined => (r === "v2" ? V2_RULES : undefined);
export const slotOptions = (r: HookRules): SlotOptions | undefined => (r === "v2" ? V2_SLOTS : undefined);
export const initialFor = (r: HookRules): State => (r === "v2" ? initialDropState(initialRelativeState()) : initialState());
export const decodeFor = (slot0: bigint | string, slot1: bigint | string, r: HookRules): State => decode(slot0, slot1, slotOptions(r));
