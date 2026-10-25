import { HOUSE_PROGRAM, type Program } from "../program.ts";
import { programFromPack, validatePack, type StationPack } from "../pack.ts";
import credits from "./credits.ts";
import creditsDubhouse from "./credits-dubhouse.ts";
import infer from "./infer.ts";

/**
 * Station packs on air, by the registry's `program` key (stations/registry.json). "idm" is the house program; every
 * other key names a pack here. example.ts is the swarm's reference, not a station, so it is not listed.
 * credits-dubhouse is baked but on no station yet (the Credits station's first pack, kept for later).
 */
export const PACKS: Record<string, StationPack> = { infer, credits, "credits-dubhouse": creditsDubhouse };

/**
 * Packs added at runtime (docs/STATIONS.md "Automatic pipeline"): the pipeline publishes a gated pack as JSON
 * (OUT_DIR/stations-data/packs/<key>.json) and the site registers it here before it builds the program. Baked packs
 * win: a runtime pack never replaces one in PACKS.
 */
const RUNTIME: Record<string, StationPack> = {};

/**
 * Registers a runtime pack after validating it again (pack.ts validatePack): returns its problems, empty when it was
 * registered (or a pack with that key is already known: the first one stays).
 */
export function registerPack(pack: unknown): string[] {
  const errors = validatePack(pack);
  if (errors.length) return errors;
  const p = pack as StationPack;
  if (!PACKS[p.key] && !RUNTIME[p.key]) RUNTIME[p.key] = p;
  return [];
}

/** The pack a program key names, baked or registered at runtime. */
export const packFor = (key: string): StationPack | undefined => PACKS[key] ?? RUNTIME[key];

/** The program a registry station plays: the house schedules for "idm", else its pack's (cached by programFromPack). */
export function programFor(key: string): Program {
  if (key === "idm") return HOUSE_PROGRAM;
  const pack = packFor(key);
  if (!pack) throw new Error(`no station pack "${key}" (packages/synth/src/stations/index.ts, or a runtime pack)`);
  return programFromPack(pack);
}
