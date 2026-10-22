// Runtime stations on the site (docs/STATIONS.md "Automatic pipeline"): the registry and the packs in the bundle are
// the baked ones; the pipeline adds stations at runtime under /stations-data (stations.json, packs/<key>.json). This
// module fetches them, validates every pack again (synth registerPack: validatePack) and every entry with the same
// rules as check-stations (stations/validate.mjs mergeRegistry: baked wins, invalid entries dropped), and decides
// what a station's page may do. Pure apart from the injected fetch: test/site-stations.test.ts (bot vitest) runs it.
import { packFor, registerPack } from "@swarm-sequencer/synth";
import { mergeRegistry } from "../../stations/validate.mjs";

export const RUNTIME_BASE = "/stations-data";
export const RUNTIME_TIMEOUT_MS = 2500;

type Entry = { key: string; program: string; status: string; house?: boolean };
type Reg<S> = { chains: unknown; stations: S[] };

async function json(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetchFn(url, { cache: "no-cache", signal: AbortSignal.timeout(timeoutMs) });
  // An SPA fallback page (HTML) is no data.
  if (!res.ok || !/json/.test(res.headers.get("content-type") ?? "")) return null;
  return res.json();
}

/**
 * The baked registry with the runtime stations merged in (their packs registered first). Missing, slow or broken
 * runtime files leave the baked registry as it is. `skipped` lists dropped entries (logged by the caller).
 */
export async function withRuntime<S extends Entry>(baked: Reg<S>, fetchFn: typeof fetch = fetch, base = RUNTIME_BASE, timeoutMs = RUNTIME_TIMEOUT_MS) {
  const runtime = (await json(fetchFn, `${base}/stations.json`, timeoutMs).catch(() => null)) as { stations?: unknown[] } | null;
  const list = Array.isArray(runtime?.stations) ? (runtime.stations as Partial<Entry>[]) : [];
  const programs = [...new Set(list.map((s) => s?.program).filter((p): p is string => typeof p === "string" && p !== "idm" && /^[a-z0-9][a-z0-9-]{1,23}$/.test(p) && !packFor(p)))];
  const packErrors: Record<string, string[]> = {};
  await Promise.all(programs.map(async (p) => {
    try {
      const pack = await json(fetchFn, `${base}/packs/${p}.json`, timeoutMs);
      const errors = pack ? registerPack(pack) : ["missing"];
      if (errors.length) packErrors[p] = errors;
    } catch (e) {
      packErrors[p] = [String(e)];
    }
  }));
  const merged = mergeRegistry(baked, runtime, { packExists: (p: string) => !!packFor(p) });
  return { ...merged, packErrors };
}

export type PlayerMode = "live" | "preview" | "off-air";

/**
 * What a station's player page does: "preview" plays, labelled PREVIEW (pipeline: the pack is in, not listed yet);
 * "off-air" never plays (an expired subscription); "live" plays (on air, and pending / paused stations too, which
 * the owner listens to at ?net=<key>). House stations always play.
 */
export function playerMode(s: Entry, runtimeStatus: string | undefined): PlayerMode {
  if (s.house) return "live";
  const status = runtimeStatus ?? s.status;
  if (status === "expired") return "off-air";
  if (status === "preview") return "preview";
  return "live";
}

/** Listed on /stations: live now (an expired, preview, pending or paused station is not). */
export const listed = (s: Entry, runtimeStatus: string | undefined) => s.status === "live" && (runtimeStatus ?? s.status) === "live";
