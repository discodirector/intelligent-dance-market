// Style Lab submissions (site/lab.html SEND FOR REVIEW): a listener sends a style and a 20 s preview WAV to the IDM team.
// The stations API takes them (api/lab.ts: POST /api/lab/submit) and only stores them; the stations worker, which holds
// the Telegram token, tells the owner (notifyLab). Nothing here plays, publishes or airs anything: the owner listens.
//
// Everything in a submission is hostile input. The share code is parsed by the lab's own codec (site/src/lab-codec.ts:
// size caps, a closed schema, clamped knobs, a sanitised name), the style is rebuilt from the lab's presets and must
// pass validatePack, the WAV must be a short 16-bit PCM file, and the contact is cut to a handle's characters. What is
// stored is what was rebuilt (the code re-encoded), never the bytes that came in.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validatePack } from "@swarm-sequencer/synth";
import { decodeRecipe, encodeRecipe } from "../../../site/src/lab-codec.ts";
import { buildStyle, GENRES, packOf, packSource, presetById } from "../../../site/src/lab-styles.ts";

/** The preview: at most 25 s of 44.1 / 48 kHz stereo 16-bit PCM (about 4.6 MB). */
export const WAV_MAX_SEC = 25;
export const WAV_MAX_BYTES = 44 + 48_000 * 4 * WAV_MAX_SEC;
/** The request: the code (8 KB) and the WAV as base64. */
export const BODY_MAX = Math.ceil((WAV_MAX_BYTES * 4) / 3) + 16_384;
/** All listeners together, per UTC day: past it the API answers 503 until tomorrow. */
export const DAILY_MAX = 40;
export const CONTACT_MAX = 40;

export interface Submission {
  id: string;
  at: string;
  name: string;
  genre: string;
  preset: string;
  /** The rebuilt recipe's share code (opens it in the lab: theidm.fun/lab#s=<code>). */
  code: string;
  contact?: string;
  seconds: number;
  notifiedAt?: string;
}

export class Rejected extends Error {}

/** A handle or a chat name: letters, digits and _ . @ - only, at most CONTACT_MAX; empty means none. */
export function cleanContact(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.normalize("NFKC").replace(/[^A-Za-z0-9_.@-]+/g, "").slice(0, CONTACT_MAX);
  return s || undefined;
}

/** The WAV's length in seconds, or why it is refused: RIFF/WAVE, PCM, 16-bit, 1-2 channels, 22.05-48 kHz, short. */
export function wavSeconds(b: Buffer): number {
  if (b.length < 44 || b.length > WAV_MAX_BYTES) throw new Rejected("preview: not a short WAV");
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Rejected("preview: not a WAV");
  let at = 12;
  let fmt: { channels: number; rate: number; bits: number } | null = null;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= b.length) {
      if (b.readUInt16LE(body) !== 1) throw new Rejected("preview: not PCM");
      fmt = { channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!fmt || fmt.bits !== 16 || fmt.channels < 1 || fmt.channels > 2 || fmt.rate < 22_050 || fmt.rate > 48_000) throw new Rejected("preview: not 16-bit PCM");
      const sec = Math.min(size, b.length - body) / (fmt.rate * fmt.channels * 2);
      if (sec < 1 || sec > WAV_MAX_SEC) throw new Rejected(`preview: 1 to ${WAV_MAX_SEC} s`);
      return Math.round(sec * 10) / 10;
    }
    at = body + size + (size & 1);
  }
  throw new Rejected("preview: no audio");
}

/** The submission a request carries, rebuilt and checked; the WAV checked. Throws Rejected with the reason. */
export async function parseSubmission(body: unknown): Promise<{ sub: Omit<Submission, "id" | "at">; wav: Buffer }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Rejected("body: an object");
  const o = body as Record<string, unknown>;
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const decoded = await decodeRecipe(own("code"));
  if (!decoded.ok) throw new Rejected("code: not a lab style");
  const recipe = decoded.recipe;
  const pack = packOf(buildStyle(recipe));
  const errs = validatePack(pack);
  if (errs.length) throw new Rejected(`style: ${errs[0]}`);
  const b64 = own("wav");
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > Math.ceil((WAV_MAX_BYTES * 4) / 3) + 4) throw new Rejected("preview: base64 WAV");
  const wav = Buffer.from(b64, "base64");
  const seconds = wavSeconds(wav);
  const contact = cleanContact(own("contact"));
  return {
    sub: {
      name: recipe.name,
      genre: GENRES[recipe.genre].label,
      preset: presetById(recipe.genre, recipe.preset)?.label ?? recipe.preset,
      code: await encodeRecipe(recipe),
      ...(contact ? { contact } : {}),
      seconds,
    },
    wav,
  };
}

/** The pack source the owner gets with a submission (the lab's export: the name marked as data). */
export async function sourceOf(code: string): Promise<{ file: string; text: string }> {
  const d = await decodeRecipe(code);
  if (!d.ok) throw new Rejected("code: not a lab style");
  const draft = buildStyle(d.recipe);
  return { file: `${packOf(draft).key}.ts`, text: packSource(draft) };
}

/** Submissions on disk: <dir>/<id>.json and <id>.wav, written whole (a temp file renamed). */
export class LabStore {
  constructor(readonly dir: string) {}

  private ensure() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  /** Today's count (UTC), for the daily cap. */
  today(now: Date): number {
    if (!existsSync(this.dir)) return 0;
    const day = now.toISOString().slice(0, 10).replace(/-/g, "");
    return readdirSync(this.dir).filter((f) => f.startsWith(day) && f.endsWith(".json")).length;
  }

  /** The same style sent again: the id of the earlier one. */
  find(code: string): string | null {
    const h = hash(code);
    if (!existsSync(this.dir)) return null;
    return readdirSync(this.dir).find((f) => f.endsWith(`-${h}.json`))?.slice(0, -5) ?? null;
  }

  add(sub: Omit<Submission, "id" | "at">, wav: Buffer, now: Date): Submission {
    this.ensure();
    const id = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}-${hash(sub.code)}`;
    const full: Submission = { id, at: now.toISOString(), ...sub };
    writeAtomic(join(this.dir, `${id}.wav`), wav);
    writeAtomic(join(this.dir, `${id}.json`), JSON.stringify(full, null, 2));
    return full;
  }

  all(): Submission[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Submission);
  }

  pending(): Submission[] {
    return this.all().filter((s) => !s.notifiedAt);
  }

  wavPath(id: string) {
    return join(this.dir, `${id}.wav`);
  }

  markNotified(s: Submission, now: Date) {
    writeAtomic(join(this.dir, `${s.id}.json`), JSON.stringify({ ...s, notifiedAt: now.toISOString() }, null, 2));
  }
}

const hash = (code: string) => createHash("sha256").update(code).digest("hex").slice(0, 12);

function writeAtomic(path: string, data: string | Buffer) {
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}
