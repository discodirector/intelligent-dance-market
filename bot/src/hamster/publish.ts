// Hamster station data (docs/STATIONS.md "Hamster station"): follows the recorder's log (recorder.ts) and publishes
// what the site and the bot replay, one JSON file the web server hands out with the stations' checkpoints:
//
//   <HAMSTER_PUBLIC_DIR>/hamster.json   {"version": 1, "key": "hamster", "generatedAt": ms,
//                                        "samples": [[observedAt ms, rpmMilli, speedMmPerSecond, distanceMm], …],
//                                        "events": [{id, type, occurredAt, payload}, …],
//                                        "now": {t, rpmMilli, speedMmPerSecond, distanceMm, freshness} | null}
//
// samples: every distinct measurement that can change a decode (core hamster.ts): the wheel turning, the first still
// one after it, a change of the day counter, and the first of the log. Dropping the others (the still minutes, ~22 h a
// day) decodes to exactly the same inputs. events: every milestone since the first measurement (rules inputs: the
// station's history starts with our log, not with the API's older feed), the cue events (settlements, claims, merges,
// mints) of the last HAMSTER_CUE_HOURS. now: the newest measurement, still or not, for the wheel on screen.
// A separate process from the recorder (it only reads its files), so a fault here never stops the log.
//
// Env: HAMSTER_DIR (the recorder's, default /data/hamster), HAMSTER_PUBLIC_DIR (default /data/stations-data),
//      HAMSTER_PUBLISH_MS (default 3000).
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { hamsterSampleOf, type HamsterEvent, type HamsterSample } from "@swarm-sequencer/core";

export const HAMSTER_PUBLIC_VERSION = 1;
export const HAMSTER_CUE_HOURS = 48;
const MILESTONE = /^measurement\./;
const CUES = new Set(["system.settlement_completed", "player.rewards_claimed", "player.squeeks_merged", "player.squeek_minted"]);
/** The payload fields the decoder reads, per event type (the rest is dropped from the public file). */
const KEEP: Record<string, readonly string[]> = {
  "system.settlement_completed": ["completedBlockCount"],
  "player.rewards_claimed": ["amountBaseUnits"],
  "player.squeeks_merged": ["level"],
  "player.squeek_minted": [],
};

export type PublicSample = [number, number, number, number];
export interface HamsterNow extends HamsterSample { freshness: string }
export interface HamsterPublic {
  version: number;
  key: string;
  generatedAt: number;
  samples: PublicSample[];
  events: HamsterEvent[];
  now: HamsterNow | null;
}

/** Keeps the measurements a decode needs, in time order (see the header). */
export class SampleKeeper {
  readonly kept: PublicSample[] = [];
  private lastT = -Infinity;
  private prev: HamsterSample | null = null;
  now: HamsterNow | null = null;

  /** One recorder line; out-of-order or repeated measurements are ignored. */
  add(o: unknown) {
    const s = hamsterSampleOf(o as { status?: unknown });
    if (!s || s.t <= this.lastT) return;
    this.lastT = s.t;
    const m = (o as { status: { measurement: { freshness?: unknown } } }).status.measurement;
    this.now = { ...s, freshness: String(m.freshness ?? "?") };
    const p = this.prev;
    this.prev = s;
    if (!p || s.rpmMilli > 0 || p.rpmMilli > 0 || s.distanceMm !== p.distanceMm) this.kept.push([s.t, s.rpmMilli, s.speedMmPerSecond, s.distanceMm]);
  }
}

/** The public form of an event (null: not read by the station). */
export function publicEvent(e: { id?: unknown; type?: unknown; occurredAt?: unknown; payload?: unknown }): HamsterEvent | null {
  if (typeof e.id !== "string" || typeof e.type !== "string" || typeof e.occurredAt !== "string") return null;
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (MILESTONE.test(e.type)) return { id: e.id, type: e.type, occurredAt: e.occurredAt, payload: p };
  const keep = KEEP[e.type];
  if (!keep || !CUES.has(e.type)) return null;
  return { id: e.id, type: e.type, occurredAt: e.occurredAt, payload: Object.fromEntries(keep.map((k) => [k, p[k]])) };
}

/** Milestones from `from` (the first measurement), cues of the last HAMSTER_CUE_HOURS before `now`, in time order. */
export function publicEvents(all: Iterable<HamsterEvent>, now: number, from = -Infinity): HamsterEvent[] {
  const floor = now - HAMSTER_CUE_HOURS * 3_600_000;
  return [...all]
    .filter((e) => Date.parse(e.occurredAt) >= from && (MILESTONE.test(e.type) || Date.parse(e.occurredAt) >= floor))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

const DAY_FILE = /^status-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;

/** Reads a file from `offset` to its end; returns the complete lines and the offset after the last one. */
function readFrom(path: string, offset: number): { lines: string[]; offset: number } {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return { lines: [], offset: size < offset ? 0 : offset };
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const text = buf.toString("utf8");
    const end = text.lastIndexOf("\n");
    if (end < 0) return { lines: [], offset };
    return { lines: text.slice(0, end).split("\n"), offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
  } finally {
    closeSync(fd);
  }
}

const parse = (l: string): unknown => { try { return l.trim() ? JSON.parse(l) : null; } catch { return null; } };

/** Follows the recorder's directory: day files in order (a finished day's .gz once), today's and events.jsonl tailed. */
export class LogFollower {
  readonly keeper = new SampleKeeper();
  readonly events = new Map<string, HamsterEvent>();
  private readonly offsets = new Map<string, number>();
  private readonly doneDays = new Set<string>();

  constructor(readonly dir: string) {}

  /** Reads what is new; true when anything was. */
  poll(): boolean {
    let changed = false;
    if (!existsSync(this.dir)) return false;
    const days = readdirSync(this.dir).map((f) => DAY_FILE.exec(f)).filter((m): m is RegExpExecArray => !!m)
      .sort((a, b) => a[1].localeCompare(b[1]) || (a[2] ? -1 : 1));
    for (const m of days) {
      const [file, day, gz] = m;
      if (this.doneDays.has(day)) continue;
      const path = join(this.dir, file);
      if (gz) {
        // A finished day: whole, once (its .jsonl, if it was being tailed, is gone and carried the same lines).
        const before = this.keeper.kept.length;
        for (const l of gunzipSync(readFileSync(path)).toString("utf8").split("\n")) this.keeper.add(parse(l));
        this.doneDays.add(day);
        changed ||= this.keeper.kept.length !== before;
        continue;
      }
      const r = readFrom(path, this.offsets.get(file) ?? 0);
      this.offsets.set(file, r.offset);
      for (const l of r.lines) this.keeper.add(parse(l));
      changed ||= r.lines.length > 0;
    }
    const ev = join(this.dir, "events.jsonl");
    if (existsSync(ev)) {
      const r = readFrom(ev, this.offsets.get("events.jsonl") ?? 0);
      this.offsets.set("events.jsonl", r.offset);
      for (const l of r.lines) {
        const e = publicEvent(((parse(l) ?? {}) as { event?: object }).event ?? {});
        if (e && !this.events.has(e.id)) {
          this.events.set(e.id, e);
          changed = true;
        }
      }
    }
    return changed;
  }

  snapshot(now = Date.now()): HamsterPublic {
    return { version: HAMSTER_PUBLIC_VERSION, key: "hamster", generatedAt: now, samples: this.keeper.kept, events: publicEvents(this.events.values(), now, this.keeper.kept[0]?.[0] ?? Infinity), now: this.keeper.now };
  }
}

/** Writes whole, then renames: a reader never sees half a file. */
export function writePublic(dir: string, data: HamsterPublic) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "hamster.json");
  writeFileSync(path + ".tmp", JSON.stringify(data));
  renameSync(path + ".tmp", path);
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[hamster-publish]", ...a);

async function main() {
  const dir = process.env.HAMSTER_DIR || "/data/hamster";
  const out = process.env.HAMSTER_PUBLIC_DIR || "/data/stations-data";
  const every = Number(process.env.HAMSTER_PUBLISH_MS || 3000);
  const f = new LogFollower(dir);
  let stopping = false;
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { stopping = true; });
  log(`starting; reading ${dir}, writing ${out}/hamster.json every ${every} ms when new`);
  let lastWrite = 0;
  while (!stopping) {
    try {
      // The cue window moves even when nothing is new: rewrite at least once a minute.
      if (f.poll() || Date.now() - lastWrite > 60_000) {
        writePublic(out, f.snapshot());
        lastWrite = Date.now();
      }
    } catch (e) {
      log("error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, every));
  }
  log("stopped");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    log("fatal:", (e as Error).stack ?? e);
    process.exit(1);
  });
}
