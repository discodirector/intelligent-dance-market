// Genre sketches for listening: ~30 s of the REAL imd-week tape (re-simulated under core V2_RULES, as the site's
// ?replay=imd-week&rules=v2 does) per genre, plus a 45 s tour crossfading through every genre.
//   node web/scripts/genre-sketches.mjs        → sim/genres/<nn>-<genre>.wav, sim/genres/00-tour.wav, sim/genres/levels.json
// Runs web/scripts/genre-timeline.ts first (window choice: a busy stretch around a track drop, with whales).
// Timeline → synth points exactly like site/src/main.ts: setState per swap, whale → drop cue, trackComplete → trackDrop.
// Idle stages are OFF by default: at replay speed 840 a 10-26 min gap between real swaps lasts under 2 s of audio, so
// the idle thinning flickers hats/snares in and out and hides the genre. `--idle` keeps the virtual clock (as the site).
// `--only id,id` renders just those genres (no tour).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "sim/genres");
mkdirSync(out, { recursive: true });
execFileSync("npx", ["tsx", resolve(root, "web/scripts/genre-timeline.ts")], { cwd: root, stdio: "inherit" });
const tl = JSON.parse(readFileSync(resolve(out, "timelines/imd-week-v2.json"), "utf8"));
const SKETCH_SEC = tl.window.seconds;
const TOUR_SEC = 45;
const BAR_OFFSET = 8; // open in the build of the 32-bar form, so the groove is up within a few seconds
const IDLE = process.argv.includes("--idle");
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > 0 ? process.argv[onlyArg + 1].split(",") : null;

/** Points from `start` for `seconds`, rebased to 0, with the state in force at `start` as the first point. */
function slice(start, seconds) {
  const head = tl.points.filter((p) => p.time < start).at(-1);
  const inside = tl.points.filter((p) => p.time >= start && p.time < start + seconds);
  // The state in force at `start` opens the clip (no cue: its whale/drop already happened).
  const rows = head ? [{ time: start, now: head.now, isBuy: head.isBuy, whale: false, track: head.track, state: head.state }, ...inside] : inside;
  return rows.map((p) => ({ ...p, time: p.time - start }));
}

const sketch = slice(tl.window.start, SKETCH_SEC);
// The tour starts 15 s earlier so its 45 s still hold the drop.
const tour = slice(Math.max(0, tl.window.start - 15), TOUR_SEC);

const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port: 5198, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://127.0.0.1:5198/render.html?timeline=/demo-timeline.json");
  const result = await page.evaluate(
    async ({ root, sketch, tour, SKETCH_SEC, TOUR_SEC, BAR_OFFSET, IDLE, ONLY }) => {
      const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
      const toState = (s) => ({ ...s, pattern: BigInt(s.pattern), bass: BigInt(s.bass) });
      const toPoints = (rows, pid) =>
        rows.map((p) => {
          const state = toState(p.state);
          const fix = (s) => (pid ? { ...s, patternId: pid(p.time, s.patternId) } : s);
          return {
            time: p.time,
            ...(IDLE ? { now: p.now } : {}),
            state: fix(state),
            ...(p.whale ? { drop: { track: p.track, fill: p.isBuy } } : {}),
            ...(p.held ? { trackDrop: { held: fix(toState(p.held)) } } : {}),
          };
        });
      const measure = (buf) => {
        let peak = 0, sum = 0, n = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const ch = buf.getChannelData(c);
          for (let i = 0; i < ch.length; i++) {
            const v = Math.abs(ch[i]);
            if (v > peak) peak = v;
            sum += ch[i] * ch[i];
            n++;
          }
        }
        // Loudest 3 s window (RMS), a rough stand-in for short-term loudness.
        const ch = buf.getChannelData(0);
        const win = 3 * buf.sampleRate;
        let best = 0;
        for (let s = 0; s + win <= ch.length; s += buf.sampleRate / 2) {
          let acc = 0;
          for (let i = s; i < s + win; i++) acc += ch[i] * ch[i];
          best = Math.max(best, acc / win);
        }
        const db = (x) => (x <= 1e-12 ? -120 : 20 * Math.log10(x));
        return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), loudDb: db(Math.sqrt(best)) };
      };
      const points = toPoints(sketch);
      const drops = points.filter((p) => p.trackDrop).map((p) => +p.time.toFixed(2));
      const whales = points.filter((p) => p.drop).map((p) => +p.time.toFixed(2));
      const rows = [];
      for (const era of synth.ERAS) {
        if (ONLY && !ONLY.includes(era.id)) continue;
        const buf = await synth.renderTimelineToBuffer(points, SKETCH_SEC, 44100, { eraId: era.id, barOffset: BAR_OFFSET });
        const tempos = [...new Set(synth.planSteps(points, SKETCH_SEC, era.id).map((h) => h.tempo))].sort((a, b) => a - b);
        let same = true;
        if (rows.length === 0) {
          const again = await synth.renderTimelineToBuffer(points, SKETCH_SEC, 44100, { eraId: era.id, barOffset: BAR_OFFSET });
          const a = buf.getChannelData(0), b = again.getChannelData(0);
          for (let i = 0; i < a.length && same; i++) same = a[i] === b[i];
        }
        rows.push({ id: era.id, name: era.name, index: era.index, tempo: [tempos[0], tempos.at(-1)], same, ...measure(buf), wav: synth.audioBufferToWavBase64(buf) });
      }
      if (ONLY) return { rows, tourRow: null, drops, whales, swaps: points.length - 1 };
      // Tour: rewrite each point's patternId into an epoch whose genre is the k-th, k = segment of the tour.
      const epochFor = [];
      for (let e = 0; epochFor.filter((x) => x != null).length < synth.ERAS.length && e < 4096; e++) {
        const k = synth.eraOf(e).index;
        if (epochFor[k] == null) epochFor[k] = e;
      }
      const seg = TOUR_SEC / synth.ERAS.length;
      const tourPoints = toPoints(tour, (time, pid) => 4 * epochFor[Math.min(synth.ERAS.length - 1, Math.floor(time / seg))] + (pid % 4));
      // Segment boundaries need a point of their own so the genre switches on time even between swaps.
      for (let k = 1; k < synth.ERAS.length; k++) {
        const at = k * seg;
        const prev = [...tourPoints].reverse().find((p) => p.time <= at);
        if (prev) tourPoints.push({ time: at, ...(IDLE ? { now: prev.now } : {}), state: { ...prev.state, patternId: 4 * epochFor[k] + (prev.state.patternId % 4) } });
      }
      tourPoints.sort((a, b) => a.time - b.time);
      const tbuf = await synth.renderTimelineToBuffer(tourPoints, TOUR_SEC, 44100, { barOffset: BAR_OFFSET });
      // Determinism: the tour (one engine per genre, crossfaded) rendered twice must match sample for sample.
      const again = await synth.renderTimelineToBuffer(tourPoints, TOUR_SEC, 44100, { barOffset: BAR_OFFSET });
      const tourDiff = [];
      for (let c = 0; c < 2; c++) {
        const x = tbuf.getChannelData(c), y = again.getChannelData(c);
        let n = 0, first = -1, last = -1, max = 0;
        for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); if (d > 0) { n++; if (first < 0) first = i; last = i; max = Math.max(max, d); } }
        if (n) tourDiff.push(`ch${c}: ${n} samples ${(first / 44100).toFixed(2)}..${(last / 44100).toFixed(2)} s, max ${max.toExponential(1)}`);
      }
      const tourRow = { id: "tour", name: "Tour (all 8, crossfaded)", index: -1, ...measure(tbuf), wav: synth.audioBufferToWavBase64(tbuf), epochFor, same: tourDiff.length === 0, diff: tourDiff };
      return { rows, tourRow, drops, whales, swaps: points.length - 1 };
    },
    { root, sketch, tour, SKETCH_SEC, TOUR_SEC, BAR_OFFSET, IDLE, ONLY },
  );
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
  const levels = [];
  const write = (row, name) => {
    const raw = Buffer.from(row.wav, "base64");
    const file = resolve(out, name);
    writeFileSync(file, raw);
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
    const { wav, ...rest } = row;
    levels.push({ file: name, ...rest, hash });
    const tempo = row.tempo ? `  ${row.tempo[0]}-${row.tempo[1]} bpm` : "";
    console.log(`${name.padEnd(22)} peak ${row.peakDb.toFixed(2)} dBFS  rms ${row.rmsDb.toFixed(2)} dBFS  loudest-3s ${row.loudDb.toFixed(2)} dBFS${tempo}  ${hash}`);
  };
  console.log(`window: ${result.swaps} swaps; track drop at ${result.drops.join(", ") || "-"} s; whales at ${result.whales.join(", ") || "-"} s`);
  for (const row of result.rows) write(row, `${String(row.index + 1).padStart(2, "0")}-${row.id}.wav`);
  if (result.tourRow) write(result.tourRow, "00-tour.wav");
  if (!ONLY) writeFileSync(resolve(out, "levels.json"), JSON.stringify({ window: tl.window, idle: IDLE, drops: result.drops, whales: result.whales, levels }, null, 2));
  if (!result.rows[0].same) throw new Error("render was not deterministic");
  if (result.tourRow && !result.tourRow.same) throw new Error(`tour render was not deterministic: ${result.tourRow.diff.join("; ")}`);
  const hot = levels.filter((l) => l.peakDb > -1);
  if (hot.length) throw new Error(`peak above -1 dBFS: ${hot.map((l) => l.file).join(", ")}`);
} finally {
  await browser.close();
  await server.close();
}
