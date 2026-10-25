import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { backoffMs, ErrorThrottle, EventLedger, gzipFinishedDays, JsonlAppender, statusKey, StatusTracker, utcDay, type RawEvent } from "../src/hamster/recorder.ts";
import { dayStats, formatStats, readDayLines } from "../src/hamster/stats.ts";

const T0 = Date.parse("2026-10-25T22:00:00Z");
const body = (o: { observedAt?: string; core?: string; rpm?: number; speed?: number; dist?: number; work?: string; height?: string; gen?: string } = {}) => ({
  schemaVersion: 1,
  generatedAt: o.gen ?? "2026-10-25T22:00:00.500Z",
  measurement: {
    freshness: "online", observedAt: o.observedAt ?? "2026-10-25T22:00:00.000Z", receivedAt: o.observedAt ?? "2026-10-25T22:00:00.000Z",
    staleAfterSeconds: 120, counterEpoch: "e1", cumulativeWorkUnits: o.work ?? "100", provenance: "hardware",
    coreStatus: o.core ?? "IDLE", rpmMilli: o.rpm ?? 0, speedMmPerSecond: o.speed ?? 0, distanceMm: o.dist ?? 0,
  },
  builder: { status: "available", projected: { blockHeight: o.height ?? "12357" } },
});

describe("hamster status change detection", () => {
  it("writes on a new ETag, skips the same one, heartbeats after 60 s, also on 304", () => {
    const t = new StatusTracker(60_000);
    expect(t.observe(T0, { code: 200, etag: '"a"', body: body() })).toMatchObject({ rx: T0, etag: '"a"' });
    expect(t.etag).toBe('"a"');
    expect(t.observe(T0 + 1000, { code: 200, etag: '"a"', body: body() })).toBeNull();
    expect(t.observe(T0 + 2000, { code: 304 })).toBeNull();
    const b2 = body({ observedAt: "2026-10-25T22:00:03.000Z", core: "ACTIVE" });
    const changed = t.observe(T0 + 3000, { code: 200, etag: '"b"', body: b2 })!;
    expect(changed.hb).toBeUndefined();
    expect(changed.status).toBe(b2);
    expect(t.observe(T0 + 62_000, { code: 304 })).toBeNull();
    const hb = t.observe(T0 + 63_000, { code: 304 })!;
    expect(hb).toMatchObject({ rx: T0 + 63_000, hb: true, etag: '"b"', status: b2 });
    expect(t.observe(T0 + 64_000, { code: 304 })).toBeNull();
  });

  it("without an ETag compares the body minus generatedAt", () => {
    expect(statusKey(null, body({ gen: "x" }))).toBe(statusKey(null, body({ gen: "y" })));
    expect(statusKey(null, body())).not.toBe(statusKey(null, body({ rpm: 1 })));
    const t = new StatusTracker();
    expect(t.observe(T0, { code: 200, etag: null, body: body({ gen: "x" }) })).not.toBeNull();
    expect(t.observe(T0 + 1000, { code: 200, etag: null, body: body({ gen: "y" }) })).toBeNull();
    expect(t.observe(T0 + 2000, { code: 200, etag: null, body: { status: "unavailable", reason: "no_measurement" } })).not.toBeNull();
  });

  it("throttles error lines to one a minute and counts the rest", () => {
    const e = new ErrorThrottle(60_000);
    expect(e.take(T0, "status", "boom")).toEqual({ rx: T0, src: "status", error: "boom" });
    expect(e.take(T0 + 1000, "status", "boom")).toBeNull();
    expect(e.take(T0 + 2000, "events", "boom")).toBeNull();
    expect(e.take(T0 + 60_000, "status", "boom")).toEqual({ rx: T0 + 60_000, src: "status", error: "boom", suppressed: 2 });
  });

  it("backs off exponentially with jitter, capped, honouring Retry-After", () => {
    expect(backoffMs(0, null, 1000, 60_000, () => 0)).toBe(500);
    expect(backoffMs(3, null, 1000, 60_000, () => 1)).toBe(8000);
    expect(backoffMs(30, null, 1000, 60_000, () => 1)).toBe(60_000);
    expect(backoffMs(0, 7, 1000, 60_000, () => 1)).toBe(7000);
  });
});

describe("hamster event dedupe", () => {
  const ev = (n: number, at: string): RawEvent => ({ id: `e${n}`, occurredAt: at, type: "system.settlement_completed" });

  it("accepts each id once and rebuilds the set from the log", () => {
    const l = new EventLedger();
    const page = [ev(3, "2026-10-25T03:00:00Z"), ev(2, "2026-10-25T02:00:00Z")];
    expect(l.accept(page).map((e) => e.id)).toEqual(["e3", "e2"]);
    expect(l.accept([ev(4, "2026-10-25T04:00:00Z"), ...page]).map((e) => e.id)).toEqual(["e4"]);
    expect(l.watermark).toBe(Date.parse("2026-10-25T04:00:00Z"));

    const lines = [JSON.stringify({ rx: 1, event: ev(2, "2026-10-25T02:00:00Z") }), '{"rx":2,"event":{"id":"e3"', "", JSON.stringify({ rx: 3, src: "events", error: "x" })];
    const r = new EventLedger();
    for (const line of lines) r.loadLine(line);
    expect([...r.seen.keys()]).toEqual(["e2"]);
    expect(r.accept(page).map((e) => e.id)).toEqual(["e3"]);
  });

  it("head scan goes on only while a whole page is new and within the overlap", () => {
    const l = new EventLedger(6 * 3600_000);
    const wm = Date.parse("2026-10-25T12:00:00Z");
    const page = [ev(1, "2026-10-25T11:00:00Z"), ev(2, "2026-10-25T10:00:00Z")];
    expect(l.continueHead(page, 2, wm)).toBe(true);
    expect(l.continueHead(page, 1, wm)).toBe(false); // reached a known id
    expect(l.continueHead([ev(3, "2026-10-25T05:00:00Z")], 1, wm)).toBe(false); // past the overlap
    expect(l.continueHead(page, 2, 0)).toBe(false); // first start: the backfill pages back
    expect(l.continueHead([], 0, wm)).toBe(false);
  });

  it("prunes ids far behind the newest", () => {
    const l = new EventLedger(3600_000, 86400_000);
    l.accept([ev(1, "2026-10-20T00:00:00Z"), ev(2, "2026-10-25T00:00:00Z")]);
    l.prune();
    expect([...l.seen.keys()]).toEqual(["e2"]);
  });
});

describe("hamster files", () => {
  it("appends whole lines and closes a torn last line first", () => {
    const dir = mkdtempSync(join(tmpdir(), "hamster-"));
    const p = join(dir, "events.jsonl");
    writeFileSync(p, '{"rx":1}\n{"rx":2,"ev');
    const a = new JsonlAppender(p);
    a.append({ rx: 3 });
    a.append({ rx: 4 });
    a.close();
    expect(readFileSync(p, "utf8")).toBe('{"rx":1}\n{"rx":2,"ev\n{"rx":3}\n{"rx":4}\n');
  });

  it("gzips finished days only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hamster-"));
    writeFileSync(join(dir, "status-2026-10-24.jsonl"), '{"rx":1}\n');
    writeFileSync(join(dir, "status-2026-10-25.jsonl"), '{"rx":2}\n');
    await gzipFinishedDays(dir, "2026-10-25");
    expect(existsSync(join(dir, "status-2026-10-24.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "status-2026-10-25.jsonl"))).toBe(true);
    expect(readDayLines("2026-10-24", dir).lines[0]).toBe('{"rx":1}');
    expect(utcDay(T0)).toBe("2026-10-25");
  });
});

describe("hamster stats", () => {
  const line = (rx: number, b: unknown, hb = false) => JSON.stringify(hb ? { rx, hb: true, etag: "x", status: b } : { rx, etag: "x", status: b });
  const at = (s: number) => new Date(T0 + s * 1000).toISOString();
  const lines = [
    line(T0 + 500, body({ observedAt: at(0), core: "IDLE", dist: 1_000_000, height: "100" })),
    line(T0 + 60_500, body({ observedAt: at(0), core: "IDLE", dist: 1_000_000, height: "100" }), true), // heartbeat, same sample
    line(T0 + 61_500, body({ observedAt: at(61), core: "ACTIVE", rpm: 50_000, speed: 700, dist: 1_200_000, work: "110", height: "101" })),
    line(T0 + 63_500, body({ observedAt: at(63), core: "ACTIVE", rpm: 80_500, speed: 1200, dist: 1_500_000, work: "130", height: "102" })),
    "not json",
    JSON.stringify({ rx: T0 + 64_000, src: "status", error: "HTTP 503" }),
    line(T0 + 68_500, body({ observedAt: at(68), core: "ACTIVE", rpm: 60_000, speed: 900, dist: 2_000_000, work: "150", height: "104" })),
    line(T0 + 70_500, body({ observedAt: at(70), core: "IDLE", dist: 2_100_000, work: "151", height: "104" })),
    line(T0 + 80_500, body({ observedAt: at(80), core: "ACTIVE", rpm: 10_000, speed: 100, dist: 50_000, work: "152", height: "105" })), // day reset
    JSON.stringify({ rx: T0 + 90_000, status: { status: "unavailable", reason: "no_measurement" } }),
  ];

  it("counts lines, finds ACTIVE periods, intervals, maxima, distance and blocks", () => {
    const s = dayStats(lines);
    expect(s).toMatchObject({ lines: 10, statusLines: 7, heartbeats: 1, errorLines: 1, badLines: 1, unavailable: 1, samples: 6 });
    expect(s.active).toEqual([
      { start: T0 + 61_000, stop: T0 + 70_000, open: false, samples: 3 },
      { start: T0 + 80_000, stop: T0 + 80_000, open: true, samples: 1 },
    ]);
    expect(s.intervals).toEqual({ n: 2, min: 2, median: 5, p90: 5, max: 5 });
    expect(s.maxRpm).toBe(80.5);
    expect(s.maxSpeedMmS).toBe(1200);
    expect(s.km).toBeCloseTo(1.1 + 0.05, 6);
    expect(s.workUnits).toBe(52n);
    expect(s.blockHeight).toEqual({ first: 100n, last: 105n, delta: 5n });
    expect(s.lag!.median).toBeCloseTo(0.5, 6);
    const text = formatStats(s);
    expect(text).toContain("ACTIVE periods 2");
    expect(text).toContain("22:01:01 - 22:01:10");
    expect(text).toContain("median 5.00");
  });

  it("reads a gzipped day", () => {
    const dir = mkdtempSync(join(tmpdir(), "hamster-"));
    writeFileSync(join(dir, "status-2026-10-25.jsonl.gz"), gzipSync(lines.join("\n") + "\n"));
    expect(dayStats(readDayLines("2026-10-25", dir).lines).samples).toBe(6);
  });
});
