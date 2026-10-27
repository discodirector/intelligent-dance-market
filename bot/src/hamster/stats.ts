// Stats over one day of the hamster recorder's log (recorder.ts): how often /v1/status really updates while the
// hamster runs, when he ran, how fast and how far.
//
//   npx tsx src/hamster/stats.ts                    today (UTC) in HAMSTER_DIR (default /data/hamster)
//   npx tsx src/hamster/stats.ts 2026-10-25         that day (status-2026-10-25.jsonl or .jsonl.gz)
//   npx tsx src/hamster/stats.ts path/to/file.jsonl[.gz] [--json]
//
// Samples are the distinct measurements (by measurement.observedAt) across status and heartbeat lines. A running period
// runs from the first sample with rpm > 0 to the first stopped one after it (or the last running sample when the file
// ends). coreStatus is not used for this: it is the mining core's state, ACTIVE only on some samples of a run.
// "km" sums the increases of measurement.distanceMm (a per-12:00-UTC-day counter: a drop is a reset, counted from 0).
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { utcDay } from "./recorder.ts";

export interface Sample {
  rx: number;
  observedMs: number;
  receivedMs: number | null;
  coreStatus: string;
  freshness: string;
  rpmMilli: number;
  speedMmPerSecond: number;
  distanceMm: number;
  work: bigint | null;
  epoch: string;
  blockHeight: bigint | null;
}

export interface Period { start: number; stop: number; open: boolean; samples: number }

export interface DayStats {
  lines: number;
  statusLines: number;
  heartbeats: number;
  errorLines: number;
  badLines: number;
  unavailable: number;
  samples: number;
  firstRx: number | null;
  lastRx: number | null;
  active: Period[];
  /** Seconds between consecutive distinct observedAt while running. */
  intervals: { n: number; min: number; median: number; p90: number; max: number } | null;
  /** rx - receivedAt of each new sample, seconds (how late the recorder saw it). */
  lag: { median: number; p90: number } | null;
  maxRpm: number;
  maxSpeedMmS: number;
  km: number;
  workUnits: bigint | null;
  blockHeight: { first: bigint; last: bigint; delta: bigint } | null;
}

const big = (v: unknown) => { try { return v === undefined || v === null ? null : BigInt(String(v)); } catch { return null; } };

/** One status/heartbeat line -> a sample, or null (errors, unavailable bodies, no measurement). */
export function sampleOf(o: { rx?: number; status?: any }): Sample | null {
  const m = o.status?.measurement;
  if (!m || typeof m.observedAt !== "string") return null;
  const observedMs = Date.parse(m.observedAt);
  if (!Number.isFinite(observedMs)) return null;
  const projected = o.status?.builder?.projected;
  return {
    rx: Number(o.rx) || 0,
    observedMs,
    receivedMs: m.receivedAt ? Date.parse(m.receivedAt) : null,
    coreStatus: String(m.coreStatus ?? "?"),
    freshness: String(m.freshness ?? "?"),
    rpmMilli: Number(m.rpmMilli) || 0,
    speedMmPerSecond: Number(m.speedMmPerSecond) || 0,
    distanceMm: Number(m.distanceMm) || 0,
    work: big(m.cumulativeWorkUnits),
    epoch: String(m.counterEpoch ?? ""),
    blockHeight: big(projected?.blockHeight),
  };
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];

export function dayStats(lines: string[]): DayStats {
  const s: DayStats = {
    lines: 0, statusLines: 0, heartbeats: 0, errorLines: 0, badLines: 0, unavailable: 0, samples: 0, firstRx: null, lastRx: null,
    active: [], intervals: null, lag: null, maxRpm: 0, maxSpeedMmS: 0, km: 0, workUnits: null, blockHeight: null,
  };
  const byObserved = new Map<number, Sample>();
  const lags: number[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    s.lines++;
    let o: any;
    try { o = JSON.parse(raw); } catch { s.badLines++; continue; }
    if (typeof o.rx === "number") {
      s.firstRx = s.firstRx === null ? o.rx : Math.min(s.firstRx, o.rx);
      s.lastRx = s.lastRx === null ? o.rx : Math.max(s.lastRx, o.rx);
    }
    if (o.error !== undefined) { s.errorLines++; continue; }
    if (o.status === undefined) continue;
    o.hb ? s.heartbeats++ : s.statusLines++;
    if (o.status?.status === "unavailable") s.unavailable++;
    const x = sampleOf(o);
    if (!x || byObserved.has(x.observedMs)) continue;
    byObserved.set(x.observedMs, x);
    if (!o.hb && x.receivedMs !== null) lags.push((x.rx - x.receivedMs) / 1000);
  }
  const samples = [...byObserved.values()].sort((a, b) => a.observedMs - b.observedMs);
  s.samples = samples.length;
  if (!samples.length) return s;

  const gaps: number[] = [];
  let cur: Period | null = null;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    s.maxRpm = Math.max(s.maxRpm, x.rpmMilli / 1000);
    s.maxSpeedMmS = Math.max(s.maxSpeedMmS, x.speedMmPerSecond);
    const prev = samples[i - 1];
    if (x.rpmMilli > 0) {
      if (!cur) s.active.push((cur = { start: x.observedMs, stop: x.observedMs, open: true, samples: 0 }));
      cur.stop = x.observedMs;
      cur.samples++;
      if (prev && prev.rpmMilli > 0) gaps.push((x.observedMs - prev.observedMs) / 1000);
    } else if (cur) {
      cur.stop = x.observedMs;
      cur.open = false;
      cur = null;
    }
    if (prev) s.km += (x.distanceMm >= prev.distanceMm ? x.distanceMm - prev.distanceMm : x.distanceMm) / 1e6;
  }
  if (gaps.length) {
    const g = gaps.sort((a, b) => a - b);
    s.intervals = { n: g.length, min: g[0], median: quantile(g, 0.5), p90: quantile(g, 0.9), max: g[g.length - 1] };
  }
  if (lags.length) {
    const l = lags.sort((a, b) => a - b);
    s.lag = { median: quantile(l, 0.5), p90: quantile(l, 0.9) };
  }
  // Work: sum of increases within one counter epoch (a new epoch restarts the counter).
  let work = 0n;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.work !== null && b.work !== null && a.epoch === b.epoch && b.work > a.work) work += b.work - a.work;
  }
  s.workUnits = work;
  const heights = samples.map((x) => x.blockHeight).filter((h): h is bigint => h !== null);
  if (heights.length) s.blockHeight = { first: heights[0], last: heights[heights.length - 1], delta: heights[heights.length - 1] - heights[0] };
  return s;
}

const hms = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const dur = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`; };

export function formatStats(s: DayStats, label = ""): string {
  const out: string[] = [];
  out.push(`hamster log ${label}`.trim());
  out.push(`lines ${s.lines} (status ${s.statusLines}, heartbeat ${s.heartbeats}, error ${s.errorLines}, bad ${s.badLines}, unavailable ${s.unavailable})`);
  if (s.firstRx !== null) out.push(`rx ${new Date(s.firstRx).toISOString()} .. ${new Date(s.lastRx!).toISOString()}`);
  out.push(`distinct measurements (observedAt) ${s.samples}`);
  const total = s.active.reduce((t, p) => t + (p.stop - p.start), 0);
  out.push(`running periods ${s.active.length}, total ${dur(total)}`);
  for (const p of s.active.slice(0, 60)) out.push(`  ${hms(p.start)} - ${hms(p.stop)}${p.open ? " (still running)" : ""}  ${dur(p.stop - p.start)}, ${p.samples} samples`);
  if (s.active.length > 60) out.push(`  … ${s.active.length - 60} more`);
  const i = s.intervals;
  out.push(i ? `observedAt interval while running (s): n ${i.n}, min ${i.min.toFixed(2)}, median ${i.median.toFixed(2)}, p90 ${i.p90.toFixed(2)}, max ${i.max.toFixed(2)}` : "observedAt interval while running: no data (no consecutive running samples)");
  if (s.lag) out.push(`seen after receivedAt (s): median ${s.lag.median.toFixed(2)}, p90 ${s.lag.p90.toFixed(2)}`);
  out.push(`max rpm ${s.maxRpm.toFixed(1)}, max speed ${s.maxSpeedMmS} mm/s (${(s.maxSpeedMmS * 0.0036).toFixed(2)} km/h)`);
  out.push(`distance ${s.km.toFixed(3)} km, work units +${s.workUnits ?? 0n}`);
  out.push(s.blockHeight ? `projected block height ${s.blockHeight.first} -> ${s.blockHeight.last} (+${s.blockHeight.delta})` : "projected block height: no data");
  return out.join("\n");
}

/** A day (YYYY-MM-DD, in `dir`) or a path; .gz is unpacked. */
export function readDayLines(arg: string | undefined, dir: string): { path: string; lines: string[] } {
  const day = arg ?? utcDay(Date.now());
  const candidates = /^\d{4}-\d{2}-\d{2}$/.test(day) ? [join(dir, `status-${day}.jsonl`), join(dir, `status-${day}.jsonl.gz`)] : [day];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`no log for ${day}: tried ${candidates.join(", ")}`);
  const buf = readFileSync(path);
  return { path, lines: (path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8").split("\n") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const { path, lines } = readDayLines(args.find((a) => !a.startsWith("--")), process.env.HAMSTER_DIR || "/data/hamster");
  const s = dayStats(lines);
  console.log(json ? JSON.stringify(s, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) : formatStats(s, path));
}
