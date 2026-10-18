// How different is one genre from one appearance to the next? Three instances of a genre, back to back.
//   node web/scripts/genre-variety.mjs [--only dubtechno,drone]   → sim/genres/variety/<genre>-*.wav
// Per genre, two files of three 20 s clips with 1 s of silence between them:
//   <genre>-3x.wav      realistic: each clip is a different epoch AND a different stretch of the imd-week tape
//                       (one per track drop), i.e. how the genre sounds when it comes back days later.
//   <genre>-epochs.wav  same tape stretch, only the epoch differs: what the per-instance hash alone changes
//                       (key, stab figure, acid set, metal sheet, motif, lead patch, tape wow).
//   --styles            instead: <genre>-styles.wav, one clip per style of the genre (styles.ts), in style
//                       order, each on a different tape stretch; also writes each clip as <genre>-<n>-<style>.wav.
// Epochs are real ones whose genre is this genre (eraOf), chosen so the three keys differ where the genre allows.
// Uses the timeline genre-sketches.mjs writes (runs web/scripts/genre-timeline.ts first). Idle stages off, as there.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, process.argv.includes("--styles") ? "sim/genres/styles" : "sim/genres/variety");
mkdirSync(out, { recursive: true });
execFileSync("npx", ["tsx", resolve(root, "web/scripts/genre-timeline.ts")], { cwd: root, stdio: "inherit" });
const tl = JSON.parse(readFileSync(resolve(root, "sim/genres/timelines/imd-week-v2.json"), "utf8"));
const CLIP_SEC = 20;
const LEAD = 10; // each clip opens 10 s before its track drop
const GAP_SEC = 1;
const BAR_OFFSET = 8;
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > 0 ? process.argv[onlyArg + 1].split(",") : ["dubtechno", "drone"];
const STYLES = process.argv.includes("--styles");

function slice(start, seconds) {
  const head = tl.points.filter((p) => p.time < start).at(-1);
  const inside = tl.points.filter((p) => p.time >= start && p.time < start + seconds);
  const rows = head ? [{ time: start, isBuy: head.isBuy, whale: false, track: head.track, state: head.state }, ...inside] : inside;
  return rows.map((p) => ({ ...p, time: p.time - start }));
}

const dropTimes = tl.points.filter((p) => p.held).map((p) => p.time);
if (dropTimes.length < 3) throw new Error(`need 3 track drops in the tape, have ${dropTimes.length}`);
const windows = dropTimes.slice(0, 3).map((t) => slice(Math.max(0, t - LEAD), CLIP_SEC));

const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port: Number(process.env.RENDER_PORT ?? 5199), strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(`http://127.0.0.1:${process.env.RENDER_PORT ?? 5199}/render.html?timeline=/demo-timeline.json`);
  const result = await page.evaluate(
    async ({ root, windows, CLIP_SEC, GAP_SEC, BAR_OFFSET, ONLY, STYLES }) => {
      const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
      const toState = (s) => ({ ...s, pattern: BigInt(s.pattern), bass: BigInt(s.bass) });
      // patternId pinned to one epoch for the whole clip, so the clip is one instance.
      const toPoints = (rows, epoch) => {
        const pin = (s) => ({ ...s, patternId: 4 * epoch + (s.patternId % 4) });
        return rows.map((p) => ({
          time: p.time,
          state: pin(toState(p.state)),
          ...(p.whale ? { drop: { track: p.track, fill: p.isBuy } } : {}),
          ...(p.held ? { trackDrop: { held: pin(toState(p.held)) } } : {}),
        }));
      };
      const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const files = [];
      for (const id of ONLY) {
        const era = synth.eraById(id);
        // Real epochs of this genre, preferring a new key each time.
        const epochs = [];
        const keys = new Set();
        for (let e = 0; e < 8192 && epochs.length < 3; e++) {
          if (synth.eraOf(e).id !== id) continue;
          const k = synth.genreKey(era, e);
          if (keys.has(k) && keys.size < era.keys.length) continue;
          keys.add(k);
          epochs.push(e);
        }
        const render = async (clips) => {
          const bufs = [];
          for (const c of clips) bufs.push(await synth.renderTimelineToBuffer(toPoints(c.rows, c.epoch), CLIP_SEC, 44100, { eraId: id, barOffset: BAR_OFFSET }));
          const sr = 44100, gap = GAP_SEC * sr;
          const len = bufs.reduce((n, b) => n + b.length, 0) + gap * (bufs.length - 1);
          const all = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
          let at = 0;
          for (const b of bufs) {
            for (let ch = 0; ch < 2; ch++) all.getChannelData(ch).set(b.getChannelData(Math.min(ch, b.numberOfChannels - 1)), at);
            at += b.length + gap;
          }
          let peak = 0;
          for (let ch = 0; ch < 2; ch++) for (const v of all.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
          // Loudest 3 s window (RMS), as genre-sketches.mjs: genres sit near -14.3 dBFS there.
          const ch0 = all.getChannelData(0), win = 3 * sr;
          let best = 0;
          for (let s = 0; s + win <= ch0.length; s += sr / 2) {
            let acc = 0;
            for (let i = s; i < s + win; i++) acc += ch0[i] * ch0[i];
            best = Math.max(best, acc / win);
          }
          return { wav: synth.audioBufferToWavBase64(all), peakDb: 20 * Math.log10(Math.max(peak, 1e-12)), loudDb: 10 * Math.log10(Math.max(best, 1e-12)) };
        };
        if (STYLES) {
          const styles = synth.GENRE_STYLES[id];
          const picks = styles.map((st, s) => {
            let e = 0;
            while (e < 100000 && !(synth.eraOf(e).id === id && synth.styleOf(era, e).index === s)) e++;
            if (e >= 100000) for (e = 0; synth.styleOf(era, e).index !== s; e++);
            return { epoch: e, style: st, rows: windows[s % windows.length] };
          });
          for (const [s, p] of picks.entries()) {
            const one = await render([p]);
            files.push({ name: `${id}-${s + 1}-${p.style.id}.wav`, info: [{ epoch: p.epoch, key: NAMES[synth.genreKey(era, p.epoch)], style: p.style.name }], ...one });
          }
          const info = picks.map((p) => ({ epoch: p.epoch, key: NAMES[synth.genreKey(era, p.epoch)], style: p.style.name }));
          files.push({ name: `${id}-styles.wav`, info, ...(await render(picks)) });
          continue;
        }
        const info = epochs.map((e, i) => {
          const tempos = [...new Set(synth.planSteps(toPoints(windows[i], e), CLIP_SEC, id).map((h) => h.tempo))].sort((a, b) => a - b);
          return { epoch: e, key: NAMES[synth.genreKey(era, e)], tempo: [tempos[0], tempos.at(-1)] };
        });
        files.push({ name: `${id}-3x.wav`, info, ...(await render(epochs.map((e, i) => ({ epoch: e, rows: windows[i] })))) });
        files.push({ name: `${id}-epochs.wav`, info: info.map((x) => ({ epoch: x.epoch, key: x.key })), ...(await render(epochs.map((e) => ({ epoch: e, rows: windows[0] })))) });
      }
      return files;
    },
    { root, windows, CLIP_SEC, GAP_SEC, BAR_OFFSET, ONLY, STYLES },
  );
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
  for (const f of result) {
    writeFileSync(resolve(out, f.name), Buffer.from(f.wav, "base64"));
    const clips = f.info.map((x, i) => `${"ABCDEFGH"[i]}: ${x.style ? `${x.style} · ` : ""}epoch ${x.epoch} ${x.key}${x.tempo ? ` ${x.tempo[0]}-${x.tempo[1]} bpm` : ""}`).join(" | ");
    console.log(`${f.name.padEnd(22)} peak ${f.peakDb.toFixed(2)} dBFS  loudest-3s ${f.loudDb.toFixed(2)} dBFS  ${clips}`);
  }
} finally {
  await browser.close();
  await server.close();
}
