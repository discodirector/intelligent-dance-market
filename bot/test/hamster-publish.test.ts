// The hamster station's public file (publish.ts): the recorder's log followed, compacted, and decoding to exactly the
// same rules inputs as the full log (core hamster.ts), on the real night in core's fixture.
import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { decodeHamster, type HamsterSample } from "@swarm-sequencer/core";
import { LogFollower, publicEvent, publicEvents, writePublic } from "../src/hamster/publish.ts";
import { loadRegistry, updateHamsterStation } from "../src/station.ts";

const night = JSON.parse(readFileSync(new URL("../../packages/core/test/fixtures/hamster/night.json", import.meta.url), "utf8"));
const line = ([at, rpm, speed, dist]: [string, number, number, number], hb = false) =>
  JSON.stringify({ rx: Date.parse(at) + 700, ...(hb ? { hb: true } : {}), etag: "x", status: { measurement: { freshness: "online", observedAt: at, rpmMilli: rpm, speedMmPerSecond: speed, distanceMm: dist } } });
const all: HamsterSample[] = night.samples.map(([at, rpmMilli, speedMmPerSecond, distanceMm]: [string, number, number, number]) => ({ t: Date.parse(at), rpmMilli, speedMmPerSecond, distanceMm }));
const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

describe("hamster public file", () => {
  const dir = mkdtempSync(join(tmpdir(), "hamster-pub-"));
  const day1 = night.samples.filter((s: [string]) => s[0] < "2026-10-26");
  const day2 = night.samples.filter((s: [string]) => s[0] >= "2026-10-26");
  writeFileSync(join(dir, "status-2026-10-25.jsonl.gz"), gzipSync(day1.map((s: never) => line(s)).join("\n") + "\n"));
  // today: a heartbeat repeat, an error line and a half-written last line
  const today = day2.slice(0, 600).map((s: never) => line(s));
  writeFileSync(join(dir, "status-2026-10-26.jsonl"), [today[0], line(day2[0], true), JSON.stringify({ rx: 1, src: "status", error: "HTTP 403" }), ...today.slice(1)].join("\n") + "\n" + line(day2[600]).slice(0, 40));
  writeFileSync(join(dir, "events.jsonl"), night.events.map((e: unknown) => JSON.stringify({ rx: 1, event: e })).join("\n") + "\n");

  const f = new LogFollower(dir);

  it("decodes to the same inputs as the full log, from far fewer samples", () => {
    expect(f.poll()).toBe(true);
    // finish the half line and the rest of the night
    appendFileSync(join(dir, "status-2026-10-26.jsonl"), line(day2[600]).slice(40) + "\n" + day2.slice(601).map((s: never) => line(s)).join("\n") + "\n");
    expect(f.poll()).toBe(true);
    expect(f.poll()).toBe(false);
    const pub = f.snapshot(Date.parse("2026-10-26T06:00:00Z"));
    const samples = pub.samples.map(([t, rpmMilli, speedMmPerSecond, distanceMm]) => ({ t, rpmMilli, speedMmPerSecond, distanceMm }));
    expect(samples.length).toBeLessThan(all.length * 0.8);
    expect(json(decodeHamster(samples, pub.events).inputs)).toBe(json(decodeHamster(all, night.events).inputs));
    expect(pub.now).toMatchObject({ ...all[all.length - 1], freshness: "online" });
  });

  it("keeps milestones forever and cues for 48 h, with only the fields the decoder reads", () => {
    const later = f.snapshot(Date.parse("2026-10-30T00:00:00Z"));
    expect(later.events.length).toBe(4);
    expect(later.events.every((e) => e.type.startsWith("measurement."))).toBe(true);
    const settle = publicEvent({ id: "a", type: "system.settlement_completed", occurredAt: "2026-10-26T00:00:00Z", payload: { completedBlockCount: "2", cumulativeWork: "9" } });
    expect(settle).toEqual({ id: "a", type: "system.settlement_completed", occurredAt: "2026-10-26T00:00:00Z", payload: { completedBlockCount: "2" } });
    expect(publicEvent({ id: "b", type: "system.mining_checkpointed", occurredAt: "2026-10-26T00:00:00Z" })).toBeNull();
    expect(publicEvents([settle!], Date.parse("2026-10-28T00:00:01Z"))).toEqual([]);
    // the API's older feed is not the station's history
    const old = publicEvent({ id: "c", type: "measurement.distance_milestone", occurredAt: "2026-10-13T00:00:00Z", payload: {} })!;
    expect(publicEvents([old], Date.parse("2026-10-26T00:00:00Z"), Date.parse("2026-10-25T16:51:00Z"))).toEqual([]);
  });

  it("writes whole files", () => {
    const out = join(dir, "pub");
    writePublic(out, f.snapshot());
    expect(JSON.parse(readFileSync(join(out, "hamster.json"), "utf8")).key).toBe("hamster");
  });

  it("the bot's tape: the night's finished tracks, once, the wheel's tags kept", () => {
    const out = join(dir, "pub");
    writePublic(out, f.snapshot(Date.parse("2026-10-26T06:00:00Z")));
    const e = loadRegistry().stations.find((x) => x.kind === "hamster")!;
    const path = join(dir, "tape", "hamster.json");
    const a = updateHamsterStation(path, e, out);
    expect(a.finished.length).toBeGreaterThanOrEqual(2);
    expect(a.finished.length).toBeLessThanOrEqual(3);
    expect(a.entries.every((x) => x.hamster)).toBe(true);
    expect(a.entries.find((x) => x.hamster?.via === "run")!.quote).toBeGreaterThan(0.5);
    expect(updateHamsterStation(path, e, out).finished).toEqual([]);
  });
});
