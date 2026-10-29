// Listeners' styles kept for later: shared lab links the team liked (lab-community.json), for a community shelf in the
// lab, a station's pack or a post. Each entry is a share code and is read like any link (lab-codec.ts decodeRecipe:
// parsed, clamped, rebuilt from the lab's presets): the JSON holds no style of its own, only the code and what we wrote
// about it. `by` is the listener's handle when we know it (empty: not credited yet). lab-community.test.ts checks every
// code decodes to its genre and name and builds a pack validatePack accepts.
import list from "./lab-community.json";
import { decodeRecipe } from "./lab-codec";
import { GENRES, type LabGenre } from "./lab-styles";

export interface CommunityPreset {
  /** Unique, kebab-case. */
  id: string;
  name: string;
  genre: LabGenre;
  /** The lab preset it started from. */
  from: string;
  by: string;
  /** YYYY-MM-DD. */
  added: string;
  note: string;
  /** The share code (theidm.fun/lab#s=<code>). */
  code: string;
}

export const COMMUNITY = list as readonly CommunityPreset[];

/** The approved ones at runtime (bot/src/lab/gallery.ts: /approve in the owner's Telegram), newest first. */
export const RUNTIME_URL = "/stations-data/community.json";
const RUNTIME_MAX = 100;

/**
 * Entries from untrusted JSON: each code decoded by the lab's codec; the name, genre and preset taken from the rebuilt
 * recipe, never from the file; `by` cut to a handle's characters, the note to 160 printable characters, the date to
 * YYYY-MM-DD. Anything else is dropped.
 */
export async function runtimeFrom(x: unknown): Promise<CommunityPreset[]> {
  const items = x && typeof x === "object" && Array.isArray((x as { presets?: unknown }).presets) ? ((x as { presets: unknown[] }).presets.slice(0, RUNTIME_MAX)) : [];
  const out: CommunityPreset[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const d = await decodeRecipe(o.code);
    if (!d.ok || typeof o.code !== "string") continue;
    const r = d.recipe;
    const id = typeof o.id === "string" && /^[a-z0-9-]{1,48}$/.test(o.id) ? o.id : null;
    if (!id) continue;
    const by = typeof o.by === "string" ? o.by.replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, 40) : "";
    const note = typeof o.note === "string" ? o.note.replace(/[^\x20-\x7e]+/g, "").slice(0, 160) : "";
    const added = typeof o.added === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.added) ? o.added : "";
    out.push({ id, name: r.name, genre: r.genre, from: r.preset, by, added, note: note || `${GENRES[r.genre].label}.`, code: o.code });
  }
  return out;
}

/** The runtime list, or none (no file yet, offline, a bad file). */
export async function loadRuntime(): Promise<CommunityPreset[]> {
  try {
    const res = await fetch(RUNTIME_URL, { cache: "no-cache" });
    if (!res.ok) return [];
    return await runtimeFrom(await res.json());
  } catch {
    return [];
  }
}
