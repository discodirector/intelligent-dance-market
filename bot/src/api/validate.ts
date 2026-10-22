// Strict request validation for the stations API: every body is a plain object with only the known fields, each of
// the expected type and shape. A request that fails gets a 400 with the first problem; nothing else is read.
import { DATA_GENRES } from "./config.ts";
import type { Contact } from "./store.ts";

export class Invalid extends Error {}

type Body = Record<string, unknown>;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const POOL = /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const TX = /^0x[0-9a-fA-F]{64}$/;

function object(v: unknown, fields: string[]): Body {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Invalid("body: expected a JSON object");
  const extra = Object.keys(v).filter((k) => !fields.includes(k));
  if (extra.length) throw new Invalid(`unknown field: ${extra[0]}`);
  return v as Body;
}

function chain(v: unknown, allowed: number[], name = "chainId"): number {
  if (typeof v !== "number" || !Number.isInteger(v) || !allowed.includes(v)) throw new Invalid(`${name}: one of ${allowed.join(", ")}`);
  return v;
}

function address(v: unknown, name: string): `0x${string}` {
  if (typeof v !== "string" || !ADDRESS.test(v)) throw new Invalid(`${name}: a 0x address (40 hex digits)`);
  return v.toLowerCase() as `0x${string}`;
}

function pool(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !POOL.test(v)) throw new Invalid("pool: a pair address or a v4 pool id");
  return v.toLowerCase();
}

/** X: 1-15 of [A-Za-z0-9_]; Telegram: 5-32, starts with a letter; email: one @, a dotted domain, <= 254 chars. */
export function contact(v: unknown): Contact {
  const o = object(v, ["kind", "value"]);
  if (typeof o.value !== "string") throw new Invalid("contact.value: a string");
  const value = o.value.trim().replace(/^@/, "");
  switch (o.kind) {
    case "x":
      if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) throw new Invalid("contact: an X handle (1-15 letters, digits, _)");
      return { kind: "x", value };
    case "telegram":
      if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)) throw new Invalid("contact: a Telegram username (5-32 letters, digits, _)");
      return { kind: "telegram", value };
    case "email":
      if (value.length > 254 || !/^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/.test(value)) throw new Invalid("contact: an email address");
      return { kind: "email", value };
    default:
      throw new Invalid('contact.kind: "x", "telegram" or "email"');
  }
}

/** Free text, one paragraph: control characters out, whitespace collapsed, 1..max characters. */
export function vibe(v: unknown, max: number): string {
  if (typeof v !== "string") throw new Invalid("vibe: a string");
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) throw new Invalid("vibe: a few words on the sound");
  if ([...s].length > max) throw new Invalid(`vibe: at most ${max} characters`);
  return s;
}

/** None (the owner picks), or 2 or more distinct data genres (a pack names 2 or more). */
export function genres(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((g) => typeof g !== "string")) throw new Invalid("genres: a list of genre ids");
  const set = [...new Set(v as string[])];
  if (set.length !== v.length) throw new Invalid("genres: listed twice");
  const bad = set.find((g) => !(DATA_GENRES as readonly string[]).includes(g));
  if (bad !== undefined) throw new Invalid(`genres: one of ${DATA_GENRES.join(", ")}`);
  if (set.length === 1) throw new Invalid("genres: pick 2 or more, or none");
  return set;
}

export interface CheckReq { chainId: number; token: `0x${string}`; pool?: string }
export function checkReq(v: unknown, chains: number[]): CheckReq {
  const o = object(v, ["chainId", "token", "pool"]);
  return { chainId: chain(o.chainId, chains), token: address(o.token, "token"), pool: pool(o.pool) };
}

/** Station+ or not: absent = plain Station. */
function plus(v: unknown): boolean {
  if (v === undefined) return false;
  if (typeof v !== "boolean") throw new Invalid("plus: true (Station+) or false");
  return v;
}

function key(v: unknown): string {
  if (typeof v !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(v)) throw new Invalid("key: a station key");
  return v;
}

export interface ApplyReq extends CheckReq { contact: Contact; vibe: string; genres: string[]; plan: "setup"; plus: boolean }
export function applyReq(v: unknown, chains: number[], vibeMax: number): ApplyReq {
  const o = object(v, ["chainId", "token", "pool", "contact", "vibe", "genres", "plan", "plus"]);
  if (o.plan !== "setup") throw new Invalid('plan: "setup"');
  return { ...checkReq({ chainId: o.chainId, token: o.token, pool: o.pool }, chains), contact: contact(o.contact), vibe: vibe(o.vibe, vibeMax), genres: genres(o.genres), plan: "setup", plus: plus(o.plus) };
}

export interface RenewReq { key: string; months: 1 | 3; plus: boolean }
export function renewReq(v: unknown): RenewReq {
  const o = object(v, ["key", "months", "plus"]);
  const k = key(o.key);
  if (o.months !== 1 && o.months !== 3) throw new Invalid("months: 1 or 3");
  return { key: k, months: o.months, plus: plus(o.plus) };
}

export interface UpgradeReq { key: string }
export function upgradeReq(v: unknown): UpgradeReq {
  const o = object(v, ["key"]);
  return { key: key(o.key) };
}

export interface PayReq { applicationId: string; chainId: number; txHash: `0x${string}` }
export function payReq(v: unknown, chains: number[]): PayReq {
  const o = object(v, ["applicationId", "chainId", "txHash"]);
  if (typeof o.applicationId !== "string" || !/^[0-9a-f]{24}$/.test(o.applicationId)) throw new Invalid("applicationId: as returned by apply or renew");
  if (typeof o.txHash !== "string" || !TX.test(o.txHash)) throw new Invalid("txHash: 0x and 64 hex digits");
  return { applicationId: o.applicationId, chainId: chain(o.chainId, chains), txHash: o.txHash.toLowerCase() as `0x${string}` };
}
