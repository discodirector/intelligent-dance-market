// The style lab's share code (lab.ts: the URL hash #s=<code>). A link is hostile input: a crafted link someone
// shares, or text written to steer an AI agent if the style ever reaches a station's swarm. So the code carries no
// style, only a recipe in a closed schema (lab-styles.ts Recipe), and decoding parses rather than validates:
//   - size limits first: the code at most 2 KB, the inflated JSON at most 16 KB (reading stops past it: no deflate
//     bombs), objects of at most 48 keys, lists of at most 16, nesting two levels deep;
//   - a fresh recipe is built field by field from the genre's own lists: unknown keys are never read, numbers must be
//     finite and are clamped to their control's range, ids are looked up (an unknown one keeps the preset's);
//   - the name is NFKC-normalised, cut to letters, digits and . ' _ - and spaces, at most 24 characters.
// lab-styles.ts buildStyle then rebuilds the style from the preset and applies the taste rules. Format "2" + base64url
// of the deflated JSON; the v1 links of the first prototype (a whole style, "z" / "j") are refused.
import { ALL_MUTED, CHORD_PALETTE, clamp, GAIN_DB, GENRES, isGenre, presetById, type Recipe } from "./lab-styles";
import { takeFrom, takeJson } from "./lab-take";

/** A take (lab-take.ts) needs room: up to 512 events of a few bytes each. Still small enough to stop a bomb. */
export const CODE_MAX = 8192;
export const JSON_MAX = 49152;
const KEYS_MAX = 48;
const LIST_MAX = 16;
/** The take's event bytes (lab-take.ts TAKE_CHARS) are the longest string; everything else is looked up or cut. */
const STRING_MAX = 2800;
export const NAME_MAX = 24;

/** A name a listener typed: only letters, digits, space and . ' _ - survive; at most 24 characters; never empty. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "Untitled";
  const s = raw
    .slice(0, 256)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9 .'_-]+/g, "")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return s || "Untitled";
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const snap = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));

/** Nothing deeper, longer or bigger than the schema needs (two levels: the recipe, then knobs / macros / lists). */
function bounded(x: unknown, depth = 0): boolean {
  if (typeof x === "string") return x.length <= STRING_MAX;
  if (typeof x === "number" || typeof x === "boolean" || x === null) return true;
  if (depth >= 2) return false;
  if (Array.isArray(x)) return x.length <= LIST_MAX && x.every((v) => bounded(v, depth + 1));
  if (isObj(x)) {
    const keys = Object.keys(x);
    return keys.length <= KEYS_MAX && keys.every((k) => k.length <= 32 && bounded(x[k], depth + 1));
  }
  return false;
}

/**
 * A recipe from untrusted JSON: every field the schema names, looked up or clamped; null when it is not a lab code
 * at all (no known genre). Only the genre's own knob, macro and choice keys are read, so `__proto__`, `constructor`
 * or any other key in the input never reaches the result.
 */
export function recipeFrom(x: unknown): Recipe | null {
  if (!isObj(x) || !bounded(x) || !isGenre(x.g)) return null;
  const g = GENRES[x.g];
  const preset = presetById(g.id, x.p) ?? g.presets[0];
  const r: Recipe = { genre: g.id, preset: preset.id, name: cleanName(x.n), knobs: {}, macros: {}, choices: {} };
  const k = isObj(x.k) ? x.k : {};
  for (const knob of g.knobs) {
    const v = own(k, knob.key) ? k[knob.key] : undefined;
    if (finite(v)) r.knobs[knob.key] = clamp(snap(v, knob.step), knob.min, knob.max);
  }
  const m = isObj(x.m) ? x.m : {};
  for (const macro of g.macros) {
    const v = own(m, macro.key) ? m[macro.key] : undefined;
    if (finite(v)) r.macros[macro.key] = clamp(snap(v, 0.01), 0, 1);
  }
  const c = isObj(x.c) ? x.c : {};
  const draft = { genre: g.id, style: preset.style };
  for (const choice of g.choices) {
    const v = own(c, choice.key) ? c[choice.key] : undefined;
    if (typeof v === "string" && choice.options(draft).some((o) => o.id === v)) r.choices[choice.key] = v;
  }
  if (Array.isArray(x.r) && x.r.length === 16 && x.r.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 60)) r.riff = [...(x.r as number[])];
  if (Array.isArray(x.h) && x.h.length >= 2 && x.h.length <= 8 && x.h.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < CHORD_PALETTE.length)) {
    r.chords = [...(x.h as number[])];
  }
  if (finite(x.l)) r.gain = clamp(snap(x.l, 0.1), GAIN_DB[0], GAIN_DB[1]);
  if (Number.isInteger(x.u) && (x.u as number) > 0 && (x.u as number) <= ALL_MUTED) r.mutes = x.u as number;
  const take = own(x, "x") ? takeFrom(r, x.x) : undefined;
  if (take) r.take = take;
  return r;
}

/** The recipe as JSON: the schema's fields only. */
export function recipeJson(r: Recipe) {
  return {
    g: r.genre,
    b: presetById(r.genre, r.preset)?.style.base,
    p: r.preset,
    n: cleanName(r.name),
    k: r.knobs,
    m: r.macros,
    c: r.choices,
    ...(r.riff ? { r: r.riff } : {}),
    ...(r.chords ? { h: r.chords } : {}),
    ...(r.gain !== undefined ? { l: r.gain } : {}),
    ...(r.mutes ? { u: r.mutes } : {}),
    ...(r.take ? { x: takeJson(r.genre, r.take) } : {}),
  };
}

const b64u = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}
/** Inflates at most `cap` bytes: past it the stream is cancelled and the code refused. */
async function inflate(bytes: Uint8Array<ArrayBuffer>, cap: number): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > cap) {
      await reader.cancel().catch(() => {});
      throw new Error("too large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

export async function encodeRecipe(r: Recipe): Promise<string> {
  return `2${b64u(await deflate(new TextEncoder().encode(JSON.stringify(recipeJson(r)))))}`;
}

export type Decoded = { ok: true; recipe: Recipe } | { ok: false; why: "old" | "bad" };

/** A share code back to a recipe, or why not ("old": a v1 link of the first prototype; "bad": anything else). */
export async function decodeRecipe(code: unknown): Promise<Decoded> {
  if (typeof code !== "string" || code.length > CODE_MAX) return { ok: false, why: "bad" };
  if (/^[zj][A-Za-z0-9_-]+$/.test(code)) return { ok: false, why: "old" };
  if (!/^2[A-Za-z0-9_-]+$/.test(code)) return { ok: false, why: "bad" };
  try {
    const json = await inflate(unb64u(code.slice(1)), JSON_MAX);
    const recipe = recipeFrom(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)));
    return recipe ? { ok: true, recipe } : { ok: false, why: "bad" };
  } catch {
    return { ok: false, why: "bad" };
  }
}
