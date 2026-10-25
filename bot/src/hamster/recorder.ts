// Hamster telemetry recorder (Squeekchain, https://docs.squeekchain.com/developers/api/): the API keeps no history of
// the wheel's speed or start/stop, so this service polls it 24/7 and keeps an append-only log that later feeds replay
// and the 2-day history of the hamster DJ station, and measures how often /v1/status changes while the hamster runs.
//
//   status-YYYY-MM-DD.jsonl  (UTC day of rx) one line per changed /v1/status body, plus a heartbeat every 60 s:
//                            {"rx": <receive ms>, "etag": "…", "status": <raw body>}            content changed
//                            {"rx": …, "hb": true, "etag": "…", "status": <last body>}           unchanged for 60 s
//                            {"rx": …, "src": "status"|"events", "error": "…", "suppressed": n}  at most once a minute
//                            A body with "status": "unavailable" is recorded as is: it means unknown, never zero.
//                            Finished days are gzipped to status-YYYY-MM-DD.jsonl.gz (HAMSTER_GZIP=false keeps them).
//   events.jsonl             every /v1/events item once, deduplicated by id: {"rx": …, "event": <raw item>}
//   events-state.json        backfill progress (the only file that is rewritten, atomically)
//
// Change detection: /v1/status sends an ETag derived from its snapshot revision (generatedAt is not part of it), so a
// new ETag = new content; a 304 to If-None-Match = unchanged. Without an ETag the body minus generatedAt is compared.
// Events: newest-first pages; each poll rescans from the first page and stops at a page holding an already-seen id
// (so items indexed late inside the first page are still caught); on the first start the rest of the history is
// backfilled page by page at <= 2 requests per second, resumable from the saved cursor.
//
// Env:
//   HAMSTER_DIR            output directory (default /data/hamster; a host volume in docker-compose.yml)
//   HAMSTER_API            API base (default https://api.squeekchain.com/v1)
//   HAMSTER_STATUS_MS      /v1/status poll interval, default 1000 (the API recomputes it at most once a second)
//   HAMSTER_EVENTS_SEC     /v1/events poll interval, default 30
//   HAMSTER_HEARTBEAT_SEC  heartbeat line interval, default 60
//   HAMSTER_BACKFILL       "false" skips the history backfill (default on)
//   HAMSTER_GZIP           "false" keeps finished days uncompressed (default on)
import { closeSync, createReadStream, createWriteStream, existsSync, fdatasyncSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, unlinkSync, writeFileSync, writeSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { join } from "node:path";

export interface RecorderConfig {
  dir: string;
  api: string;
  statusMs: number;
  eventsSec: number;
  heartbeatSec: number;
  backfill: boolean;
  gzip: boolean;
}

export function recorderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RecorderConfig {
  return {
    dir: env.HAMSTER_DIR || "/data/hamster",
    api: (env.HAMSTER_API || "https://api.squeekchain.com/v1").replace(/\/+$/, ""),
    statusMs: Number(env.HAMSTER_STATUS_MS || 1000),
    eventsSec: Number(env.HAMSTER_EVENTS_SEC || 30),
    heartbeatSec: Number(env.HAMSTER_HEARTBEAT_SEC || 60),
    backfill: (env.HAMSTER_BACKFILL ?? "").toLowerCase() !== "false",
    gzip: (env.HAMSTER_GZIP ?? "").toLowerCase() !== "false",
  };
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[hamster]", ...a);
const TIMEOUT_MS = 5000;
const BACKFILL_GAP_MS = 500; // <= 2 requests per second (the events class allows 5)
const HEAD_MAX_PAGES = 50;

/** UTC calendar day of a ms epoch, YYYY-MM-DD. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------
// Status change detection (pure)

export type StatusResponse = { code: 200; etag: string | null; body: unknown } | { code: 304 };
export interface StatusLine { rx: number; hb?: true; etag: string | null; status: unknown }

/** Content key of a 200: the ETag, else a hash of the body without generatedAt (which changes on every snapshot). */
export function statusKey(etag: string | null, body: unknown): string {
  if (etag) return etag;
  const rest = body && typeof body === "object" ? { ...(body as Record<string, unknown>), generatedAt: undefined } : body;
  return "sha256:" + createHash("sha256").update(JSON.stringify(rest) ?? "null").digest("hex");
}

/** Decides which /v1/status responses become lines: every content change, plus a heartbeat after `heartbeatMs` of
 *  silence (repeating the last body, so every day file and every minute is self-contained). */
export class StatusTracker {
  lastKey: string | null = null;
  lastEtag: string | null = null;
  lastBody: unknown = undefined;
  lastWriteAt = 0;
  constructor(readonly heartbeatMs = 60_000) {}

  /** The ETag to send as If-None-Match. */
  get etag() { return this.lastEtag; }

  observe(rx: number, r: StatusResponse): StatusLine | null {
    if (r.code === 200) {
      const key = statusKey(r.etag, r.body);
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.lastEtag = r.etag;
        this.lastBody = r.body;
        this.lastWriteAt = rx;
        return { rx, etag: r.etag, status: r.body };
      }
    }
    if (this.lastBody !== undefined && rx - this.lastWriteAt >= this.heartbeatMs) {
      this.lastWriteAt = rx;
      return { rx, hb: true, etag: this.lastEtag, status: this.lastBody };
    }
    return null;
  }
}

/** At most one error line per `everyMs`; the rest are counted into the next line's `suppressed`. */
export class ErrorThrottle {
  private lastAt = -Infinity;
  private suppressed = 0;
  constructor(readonly everyMs = 60_000) {}
  take(rx: number, src: string, error: string): Record<string, unknown> | null {
    if (rx - this.lastAt < this.everyMs) return this.suppressed++, null;
    const line: Record<string, unknown> = { rx, src, error: error.slice(0, 500) };
    if (this.suppressed) line.suppressed = this.suppressed;
    this.lastAt = rx;
    this.suppressed = 0;
    return line;
  }
}

/** Exponential backoff with full jitter: random in [base*2^n / 2, base*2^n], capped; Retry-After wins when longer. */
export function backoffMs(failures: number, retryAfterSec: number | null = null, baseMs = 1000, maxMs = 120_000, rand = Math.random): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.min(failures, 20));
  const jittered = cap / 2 + rand() * (cap / 2);
  return Math.max(jittered, (retryAfterSec ?? 0) * 1000);
}

// ---------------------------------------------------------------------------------------------------------------
// Event dedupe (pure)

export interface RawEvent { id?: string; occurredAt?: string; recordedAt?: string; [k: string]: unknown }

export const eventId = (e: RawEvent) => (typeof e.id === "string" && e.id ? e.id : "sha256:" + createHash("sha256").update(JSON.stringify(e)).digest("hex"));
const eventMs = (e: RawEvent) => Date.parse(e.occurredAt ?? e.recordedAt ?? "") || 0;

/** The set of event ids already written. Ids older than `keepMs` behind the newest event are dropped once the
 *  backfill is done; the head scan never reaches that far back (it stops `overlapMs` behind the newest). */
export class EventLedger {
  readonly seen = new Map<string, number>();
  watermark = 0;
  constructor(readonly overlapMs = 6 * 3600_000, readonly keepMs = 7 * 86400_000) {}

  /** Rebuilds the set from events.jsonl lines (bad lines are skipped). */
  loadLine(line: string) {
    if (!line.trim()) return;
    try {
      const o = JSON.parse(line) as { event?: RawEvent };
      if (o.event) this.mark(o.event);
    } catch { /* torn last line after a crash */ }
  }

  private mark(e: RawEvent) {
    const ms = eventMs(e);
    this.seen.set(eventId(e), ms);
    if (ms > this.watermark) this.watermark = ms;
  }

  /** Marks a page's items and returns the ones not seen before, in page order. */
  accept(events: RawEvent[]): RawEvent[] {
    const fresh: RawEvent[] = [];
    for (const e of events) {
      if (this.seen.has(eventId(e))) continue;
      this.mark(e);
      fresh.push(e);
    }
    return fresh;
  }

  /** After a head-scan page: fetch the next one only when every item was new (a gap may remain) and the page has not
   *  gone `overlapMs` behind the newest event known before the scan. */
  continueHead(page: RawEvent[], freshCount: number, watermarkBefore: number): boolean {
    if (!page.length || freshCount < page.length) return false;
    if (!watermarkBefore) return false; // first ever start: the backfill takes over from page 2
    const oldest = Math.min(...page.map(eventMs));
    return oldest >= watermarkBefore - this.overlapMs;
  }

  prune() {
    const floor = this.watermark - this.keepMs;
    for (const [id, ms] of this.seen) if (ms < floor) this.seen.delete(id);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Append-only files

/** One JSON per line, O_APPEND, fdatasync after each write. A torn last line (crash mid-write) is closed with a
 *  newline before the next append, so it costs one unparsable line and never glues two records. */
export class JsonlAppender {
  private fd: number | null = null;
  constructor(readonly path: string) {}

  private open() {
    const fd = openSync(this.path, "a+");
    const size = fstatSync(fd).size;
    if (size > 0) {
      const b = Buffer.alloc(1);
      readSync(fd, b, 0, 1, size - 1);
      if (b[0] !== 0x0a) writeSync(fd, "\n");
    }
    this.fd = fd;
    return fd;
  }

  append(obj: unknown) {
    const fd = this.fd ?? this.open();
    writeSync(fd, JSON.stringify(obj) + "\n");
    fdatasyncSync(fd);
  }

  close() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

/** status-YYYY-MM-DD.jsonl by the UTC day of rx; on each new day the finished days are gzipped (if enabled). */
export class DayFiles {
  private day = "";
  private file: JsonlAppender | null = null;
  constructor(readonly dir: string, readonly gzip: boolean) {}

  append(line: { rx: number }) {
    const day = utcDay(line.rx);
    if (day !== this.day) {
      this.file?.close();
      this.day = day;
      this.file = new JsonlAppender(join(this.dir, `status-${day}.jsonl`));
      if (this.gzip) void gzipFinishedDays(this.dir, day).catch((e) => log("gzip failed:", (e as Error).message));
    }
    this.file!.append(line);
  }

  close() { this.file?.close(); }
}

/** Gzips every status-<day>.jsonl older than `today` into .jsonl.gz (via .tmp + rename), then removes the original. */
export async function gzipFinishedDays(dir: string, today: string) {
  for (const f of readdirSync(dir)) {
    const m = /^status-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if (!m || m[1] >= today) continue;
    const src = join(dir, f);
    const dst = src + ".gz";
    if (existsSync(dst)) continue; // never overwrite; a leftover original is left for a human to check
    await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dst + ".tmp"));
    renameSync(dst + ".tmp", dst);
    unlinkSync(src);
    log(`gzipped ${f}`);
  }
}

interface EventsState { backfill: { done: boolean; cursor: string | null; pages: number } }

function readState(path: string): EventsState {
  try { return JSON.parse(readFileSync(path, "utf8")) as EventsState; } catch { return { backfill: { done: false, cursor: null, pages: 0 } }; }
}
function writeState(path: string, s: EventsState) {
  writeFileSync(path + ".tmp", JSON.stringify(s));
  renameSync(path + ".tmp", path);
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP

export class HttpError extends Error {
  constructor(message: string, readonly retryAfterSec: number | null = null, readonly code = 0) { super(message); }
}

async function getJson(url: string, etag: string | null, signal: AbortSignal): Promise<{ code: 200; etag: string | null; body: unknown } | { code: 304 }> {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "idm-hamster-recorder/1 (+https://theidm.fun)" };
  if (etag) headers["if-none-match"] = etag;
  const res = await fetch(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
  if (res.status === 304) return { code: 304 };
  const text = await res.text();
  if (res.status !== 200) {
    const ra = Number(res.headers.get("retry-after"));
    throw new HttpError(`HTTP ${res.status} ${text.slice(0, 200)}`, Number.isFinite(ra) && ra > 0 ? ra : null, res.status);
  }
  try {
    return { code: 200, etag: res.headers.get("etag"), body: JSON.parse(text) };
  } catch {
    throw new HttpError(`bad JSON (${text.length} bytes): ${text.slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Service

export class Recorder {
  private stopping = false;
  private readonly abort = new AbortController();
  private readonly wakers = new Set<() => void>();
  readonly days: DayFiles;
  readonly events: JsonlAppender;
  readonly tracker: StatusTracker;
  readonly ledger = new EventLedger();
  private readonly errors = new ErrorThrottle();
  private readonly statePath: string;
  private state: EventsState;
  counts = { statusLines: 0, heartbeats: 0, events: 0, errors: 0 };

  constructor(readonly c: RecorderConfig) {
    mkdirSync(c.dir, { recursive: true });
    this.days = new DayFiles(c.dir, c.gzip);
    this.events = new JsonlAppender(join(c.dir, "events.jsonl"));
    this.tracker = new StatusTracker(c.heartbeatSec * 1000);
    this.statePath = join(c.dir, "events-state.json");
    this.state = readState(this.statePath);
  }

  /** Sleeps unless stopped; stop() wakes every sleeper at once. */
  private sleep(ms: number) {
    if (this.stopping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => { clearTimeout(t); this.wakers.delete(done); resolve(); };
      const t = setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.abort.abort();
    for (const w of [...this.wakers]) w();
  }

  private error(src: string, e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    const line = this.errors.take(Date.now(), src, msg);
    if (line) {
      log(`${src} error: ${msg}`);
      this.days.append(line as { rx: number });
      this.counts.errors++;
    }
  }

  async loadSeen() {
    const path = join(this.c.dir, "events.jsonl");
    if (existsSync(path)) {
      const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
      for await (const line of rl) this.ledger.loadLine(line);
    }
    if (this.state.backfill.done) this.ledger.prune();
    log(`events: ${this.ledger.seen.size} known ids; backfill ${this.state.backfill.done ? "done" : `pending (${this.state.backfill.pages} pages so far)`}`);
  }

  async statusLoop() {
    let failures = 0;
    while (!this.stopping) {
      const started = Date.now();
      try {
        const r = await getJson(`${this.c.api}/status`, this.tracker.etag, this.abort.signal);
        const rx = Date.now();
        const line = this.tracker.observe(rx, r);
        if (line) {
          this.days.append(line);
          line.hb ? this.counts.heartbeats++ : this.counts.statusLines++;
        }
        failures = 0;
        await this.sleep(Math.max(0, this.c.statusMs - (Date.now() - started)));
      } catch (e) {
        if (this.stopping) break;
        this.error("status", e);
        await this.sleep(backoffMs(failures++, (e as HttpError).retryAfterSec ?? null, this.c.statusMs, 60_000));
      }
    }
  }

  private writeEvents(fresh: RawEvent[]) {
    const rx = Date.now();
    // Pages are newest-first; append oldest-first so a page reads in time order.
    for (let i = fresh.length - 1; i >= 0; i--) this.events.append({ rx, event: fresh[i] });
    this.counts.events += fresh.length;
  }

  private async eventsPage(cursor: string | null): Promise<{ events: RawEvent[]; next: string | null }> {
    const q = `category=all&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await getJson(`${this.c.api}/events?${q}`, null, this.abort.signal);
    if (r.code !== 200) return { events: [], next: null };
    const b = r.body as { status?: string; reason?: string; events?: RawEvent[]; nextCursor?: string | null };
    if (b.status === "unavailable") throw new HttpError(`events unavailable: ${b.reason ?? "?"}`);
    if (!Array.isArray(b.events)) throw new HttpError("events: no events array");
    return { events: b.events, next: b.nextCursor ?? null };
  }

  /** One head scan: newest page, then older pages while every item is new. Returns page 1's nextCursor. */
  private async headScan(): Promise<string | null> {
    const before = this.ledger.watermark;
    let cursor: string | null = null;
    let firstNext: string | null = null;
    for (let page = 0; page < HEAD_MAX_PAGES && !this.stopping; page++) {
      const { events, next } = await this.eventsPage(cursor);
      if (page === 0) firstNext = next;
      const fresh = this.ledger.accept(events);
      this.writeEvents(fresh);
      if (!next || !this.ledger.continueHead(events, fresh.length, before)) break;
      cursor = next;
      await this.sleep(BACKFILL_GAP_MS);
    }
    return firstNext;
  }

  async eventsLoop() {
    let failures = 0;
    while (!this.stopping) {
      try {
        const firstNext = await this.headScan();
        if (this.c.backfill && !this.state.backfill.done) {
          if (!this.state.backfill.cursor && this.state.backfill.pages === 0) this.state.backfill.cursor = firstNext;
          await this.backfill();
        }
        failures = 0;
        await this.sleep(this.c.eventsSec * 1000);
      } catch (e) {
        if (this.stopping) break;
        this.error("events", e);
        const err = e as HttpError;
        // An unusable backfill cursor (400 invalid_cursor) restarts the backfill from the first page; ids dedupe it.
        if (err.code === 400 && /invalid_cursor/.test(err.message) && !this.state.backfill.done) {
          this.state.backfill = { done: false, cursor: null, pages: 0 };
          writeState(this.statePath, this.state);
        }
        await this.sleep(backoffMs(failures++, err.retryAfterSec ?? null, 5000, 300_000));
      }
    }
  }

  /** Pages back through the history from the saved cursor, saving the cursor after each page; at most `maxPages` per
   *  call, so the head scan keeps its 30 s rhythm during a long backfill. */
  private async backfill(maxPages = 40) {
    const b = this.state.backfill;
    for (let n = 0; n < maxPages && !this.stopping && b.cursor; n++) {
      await this.sleep(BACKFILL_GAP_MS);
      const { events, next } = await this.eventsPage(b.cursor);
      this.writeEvents(this.ledger.accept(events));
      b.cursor = next;
      b.pages++;
      writeState(this.statePath, this.state);
      if (b.pages % 10 === 0) log(`backfill: ${b.pages} pages, oldest ${events.at(-1)?.occurredAt ?? "?"}`);
    }
    if (!b.cursor && !this.stopping) {
      b.done = true;
      writeState(this.statePath, this.state);
      this.ledger.prune();
      log(`backfill done: ${b.pages} pages; ${this.counts.events} events written this run`);
    }
  }

  close() {
    this.days.close();
    this.events.close();
  }
}

async function main() {
  const c = recorderConfigFromEnv();
  const r = new Recorder(c);
  log(`starting; dir ${c.dir}; api ${c.api}; status every ${c.statusMs} ms; events every ${c.eventsSec} s; heartbeat ${c.heartbeatSec} s`);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { log(`${sig}: stopping`); r.stop(); });
  const stats = setInterval(() => log(`written: ${JSON.stringify(r.counts)}`), 600_000);
  if (c.gzip) await gzipFinishedDays(c.dir, utcDay(Date.now())).catch((e) => log("gzip failed:", (e as Error).message));
  await r.loadSeen();
  await Promise.all([r.statusLoop(), r.eventsLoop()]);
  clearInterval(stats);
  r.close();
  log(`stopped; written: ${JSON.stringify(r.counts)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    log("fatal:", (e as Error).stack ?? e);
    process.exit(1);
  });
}
