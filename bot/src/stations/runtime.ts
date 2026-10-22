// Runtime stations (docs/STATIONS.md "Automatic pipeline"): the registry and the packs are baked into the image and
// the site bundle, so a station the pipeline adds lives next to them at runtime, in the directory the web server
// already serves as /stations-data:
//   <STATIONS_DATA_DIR>/stations.json        { version: 1, stations: [entry, ...] }  (registry entry schema)
//   <STATIONS_DATA_DIR>/packs/<key>.json     a gated style pack as JSON (pack.ts validatePack)
// Readers merge the runtime entries over the baked registry with stations/validate.mjs (the rules check-stations
// applies; baked wins on a key or pool clash). Every write is a whole file renamed into place.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKS, validatePack, type StationPack } from "@swarm-sequencer/synth";
import { mergeRegistry } from "../../../stations/validate.mjs";
import { loadRegistry, type Registry, type RegistryEntry } from "../station.ts";
import { writeJsonAtomic } from "./subscription.ts";

export const RUNTIME_VERSION = 1;
export interface RuntimeFile { version: number; stations: RegistryEntry[] }

export const runtimePath = (dataDir: string) => join(dataDir, "stations.json");
export const packJsonPath = (dataDir: string, key: string) => join(dataDir, "packs", `${key}.json`);
const KEY = /^[a-z0-9][a-z0-9-]{1,23}$/;

export function readRuntime(dataDir: string): RuntimeFile {
  const p = runtimePath(dataDir);
  if (!existsSync(p)) return { version: RUNTIME_VERSION, stations: [] };
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { version: RUNTIME_VERSION, stations: Array.isArray(j?.stations) ? j.stations : [] };
}

/** A program has a pack: baked (synth PACKS) or published at runtime. */
export const packExistsIn = (dataDir: string) => (program: string) => !!PACKS[program] || (KEY.test(program) && existsSync(packJsonPath(dataDir, program)));

/** The baked registry with the valid runtime entries merged over it; `skipped` says which were dropped and why. */
export function loadMerged(dataDir: string, baked: Registry = loadRegistry()) {
  return mergeRegistry(baked, readRuntime(dataDir), { packExists: packExistsIn(dataDir) });
}
export const loadMergedRegistry = (dataDir: string, baked?: Registry): Registry => loadMerged(dataDir, baked).registry;

/** Adds a runtime entry (refused when its key is baked or already there). */
export function addRuntimeEntry(dataDir: string, entry: RegistryEntry, baked: Registry = loadRegistry()) {
  const file = readRuntime(dataDir);
  if (baked.stations.some((s) => s.key === entry.key) || file.stations.some((s) => s.key === entry.key)) throw new Error(`station key "${entry.key}" is taken`);
  file.stations.push(entry);
  writeJsonAtomic(runtimePath(dataDir), file);
}

/** Sets fields of a runtime entry (status, program, paidUntil); returns the updated entry. */
export function updateRuntimeEntry(dataDir: string, key: string, fields: Partial<RegistryEntry>): RegistryEntry {
  const file = readRuntime(dataDir);
  const e = file.stations.find((s) => s.key === key);
  if (!e) throw new Error(`no runtime station "${key}"`);
  Object.assign(e, fields);
  writeJsonAtomic(runtimePath(dataDir), file);
  return e;
}

/** Publishes a gated pack (validated again here); the site and the bot load it from packs/<key>.json. */
export function publishPack(dataDir: string, pack: unknown): StationPack {
  const errors = validatePack(pack);
  if (errors.length) throw new Error(`pack does not validate: ${errors.slice(0, 5).join("; ")}`);
  const p = pack as StationPack;
  if (PACKS[p.key]) throw new Error(`pack "${p.key}" is baked; a runtime pack never replaces it`);
  writeJsonAtomic(packJsonPath(dataDir, p.key), p);
  return p;
}
