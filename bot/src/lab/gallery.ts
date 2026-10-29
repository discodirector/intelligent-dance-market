// The Style Lab's community gallery at runtime: the owner approves a submission from Telegram (/approve <code>) and it
// joins <stations-data>/community.json, which the site serves at /stations-data/community.json and the lab's Community
// shelf reads next to the baked list (site/src/lab-community.json). /unapprove takes one out again. No deploy.
// An entry is rebuilt from the stored, already checked submission: the code re-decoded by the lab's own codec, the
// name from the rebuilt recipe, the contact cut to a handle. The site decodes every code again before it shows it.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeRecipe } from "../../../site/src/lab-codec.ts";
import { GENRES, presetById } from "../../../site/src/lab-styles.ts";
import { cleanContact, type LabStore } from "./submissions.ts";

export const GALLERY_FILE = "community.json";
/** The shelf's length: the newest stay. */
export const GALLERY_MAX = 100;

export interface GalleryEntry {
  id: string;
  name: string;
  genre: string;
  from: string;
  by: string;
  added: string;
  note: string;
  code: string;
}
interface GalleryFile {
  updatedAt: string;
  presets: GalleryEntry[];
}

export function readGallery(dir: string): GalleryFile {
  const path = join(dir, GALLERY_FILE);
  if (!existsSync(path)) return { updatedAt: new Date(0).toISOString(), presets: [] };
  return JSON.parse(readFileSync(path, "utf8")) as GalleryFile;
}

function writeGallery(dir: string, presets: GalleryEntry[], now: Date) {
  const path = join(dir, GALLERY_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ updatedAt: now.toISOString(), presets } satisfies GalleryFile, null, 2));
  renameSync(`${path}.tmp`, path);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "track";

/** /approve: the submission whose id ends in `code` joins the gallery (newest first). Returns the owner's reply. */
export async function approve(store: LabStore, dir: string, code: string, now: Date): Promise<string> {
  const sub = store.all().find((s) => s.id.endsWith(`-${code}`));
  if (!sub) return `no lab submission ${code}`;
  const g = readGallery(dir);
  if (g.presets.some((p) => p.id.endsWith(`-${code}`))) return `"${sub.name}" is in the gallery already`;
  const d = await decodeRecipe(sub.code);
  if (!d.ok) return `${code}: the style does not decode`;
  const r = d.recipe;
  const by = cleanContact(sub.contact)?.replace(/^@+/, "") ?? "";
  const preset = presetById(r.genre, r.preset)?.label ?? r.preset;
  const entry: GalleryEntry = {
    id: `${slug(r.name)}-${code}`,
    name: r.name,
    genre: r.genre,
    from: r.preset,
    by,
    added: now.toISOString().slice(0, 10),
    note: `${GENRES[r.genre].label}, from ${preset}${r.take ? `, a take of ${r.take.bars} bars` : ""}.`,
    code: sub.code,
  };
  writeGallery(dir, [entry, ...g.presets].slice(0, GALLERY_MAX), now);
  return `"${r.name}"${by ? ` by @${by}` : ""} is in the gallery: theidm.fun/lab#community`;
}

/** /unapprove: out of the gallery again. */
export function unapprove(dir: string, code: string, now: Date): string {
  const g = readGallery(dir);
  const left = g.presets.filter((p) => !p.id.endsWith(`-${code}`));
  if (left.length === g.presets.length) return `${code} is not in the gallery`;
  writeGallery(dir, left, now);
  return `${code} is out of the gallery`;
}

/** /gallery: what is on the shelf. */
export function listGallery(dir: string): string {
  const g = readGallery(dir).presets;
  if (!g.length) return "the gallery is empty (the baked tracks in the site stay)";
  return [`${g.length} approved:`, ...g.slice(0, 30).map((p) => `${p.id.slice(-12)} · ${p.name}${p.by ? ` by @${p.by}` : ""} · ${p.added}`)].join("\n");
}
