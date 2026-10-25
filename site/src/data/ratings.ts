// A collection station's rating table (core credittable.ts; registry nft.ratings), fetched only by that station: the
// file is a hashed asset next to the bundle (~230 KB gzipped), never in the main bundle. Missing or unreadable: null,
// and the sales play untagged (the rules input is the same either way).
import { parseCreditTable, type CreditTable } from "@swarm-sequencer/core";

const URLS: Record<string, () => Promise<string>> = {
  credits: () => import("../../../packages/core/data/credit-scores.bin.gz?url").then((m) => m.default),
};
const TIMEOUT_MS = 15_000;
const loading = new Map<string, Promise<CreditTable | null>>();

/** Gunzips unless the server already did (a gzip stream starts 1f 8b). */
async function inflate(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function loadRatings(name: string | undefined): Promise<CreditTable | null> {
  if (!name || !URLS[name]) return Promise.resolve(null);
  if (!loading.has(name)) {
    loading.set(
      name,
      (async () => {
        try {
          const res = await fetch(await URLS[name](), { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return parseCreditTable(await inflate(await res.arrayBuffer()));
        } catch (err) {
          console.warn(`ratings ${name}: ${(err as Error).message}; sales untagged`);
          return null;
        }
      })(),
    );
  }
  return loading.get(name)!;
}
