// Attention layer listening render (docs/STATIONS.md "Attention layer (prototype)"). Every house style (GENRE_STYLES,
// one-style programs) for 9 s on the same 30 real swaps (entries 40..69 of bot/data/imd-eth-7d.timeline.json, one
// every 0.3 s) with the same wave of token mentions in every segment, and the same render without the mentions for A/B:
//   node web/scripts/attention-showcase.mjs
//     → sim/stations/attention/all-styles.wav                 (with ornaments)
//     → sim/stations/attention/all-styles-no-ornaments.wav    (the same segments without them)
//     → sim/stations/attention/all-styles.txt                 (segment start times, voices, ornament levels)
//   node web/scripts/attention-showcase.mjs --only wonky,drone/dark   (a subset, to sound-check; same files)
// Offline in Chromium like station-ab.mjs. Each segment is loudness-normalized by its no-ornament render (the same gain
// on both files, so A/B compares like with like) and faded in and out over 40 ms.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "sim/stations/attention");
mkdirSync(out, { recursive: true });
const SEGMENT_SEC = 9;
const SWAP_GAP_SEC = 0.3;
const BAR_OFFSET = 16; // the song form's full section: the ornaments have to sit under the whole band
const FADE_SEC = 0.04;
/** Mention wave, segment seconds; the 5.45 s mention is a smart one. */
const WAVE = [2.0, 3.1, 3.9, 4.4, 4.8, 5.1, 5.45, 5.9, 6.6, 7.5];
const SMART = 5.45;
const tape = JSON.parse(readFileSync(resolve(root, "bot/data/imd-eth-7d.timeline.json"), "utf8"));
const swaps = tape.slice(40, 70).map((e) => ({ slot0: e.slot0, slot1: e.slot1 }));
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > 0 ? process.argv[onlyArg + 1].split(",") : null;

const port = Number(process.env.RENDER_PORT ?? 5199);
const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port, strictPort: true, fs: { strict: false } } });
await server.listen();
const browser = await chromium.launch();
let result;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(`http://127.0.0.1:${port}/render.html?timeline=/demo-timeline.json`);
  result = await page.evaluate(
    async ({ root, swaps, SEGMENT_SEC, SWAP_GAP_SEC, BAR_OFFSET, FADE_SEC, WAVE, SMART, ONLY }) => {
      const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
      const points = swaps.map((s, k) => ({ time: k * SWAP_GAP_SEC, state: synth.decode(s.slot0, s.slot1) }));
      const ornaments = WAVE.map((time) => ({ time, ...(time === SMART ? { smart: true } : {}) }));
      const segments = [];
      for (const [genre, styles] of Object.entries(synth.GENRE_STYLES)) {
        for (const style of styles) {
          if (ONLY && !ONLY.includes(genre) && !ONLY.includes(`${genre}/${style.id}`)) continue;
          const program = { key: `attention-${genre}-${style.id}`, eras: [{ fromEpoch: 0, ids: [genre] }], styles: [{ fromEpoch: 0, styles: { [genre]: [style] } }] };
          const opts = { eraId: genre, barOffset: BAR_OFFSET, program };
          const a = await synth.renderTimelineToBuffer(points, SEGMENT_SEC, 44100, { ...opts, ornaments });
          const b = await synth.renderTimelineToBuffer(points, SEGMENT_SEC, 44100, opts);
          segments.push({ genre, style: style.id, name: style.name, voice: synth.ORNAMENT_PLAN[genre][style.id].voice, a, b });
        }
      }
      const sr = segments[0].a.sampleRate;
      const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      const rms = (buf, from = 0, to = buf.length) => {
        let sum = 0;
        for (let ch = 0; ch < 2; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = from; i < to; i++) sum += d[i] * d[i];
        }
        return Math.sqrt(sum / (2 * Math.max(1, to - from)));
      };
      const peak = (buf) => {
        let p = 0;
        for (let ch = 0; ch < 2; ch++) for (const x of buf.getChannelData(ch)) p = Math.max(p, Math.abs(x));
        return p;
      };
      // Loudness target: the segments' no-ornament RMS normalized to -18 dBFS, capped so no peak passes -1 dBFS.
      const TARGET = 10 ** (-18 / 20);
      const rows = [];
      for (const s of segments) {
        const level = rms(s.b);
        s.gain = Math.min(TARGET / Math.max(1e-6, level), 0.89 / Math.max(1e-6, peak(s.a), peak(s.b)));
        // Ornament level: the A - B difference (what the mentions added) from the first mention on, against the track.
        const from = Math.floor(WAVE[0] * sr);
        let diff = 0;
        let diffPeak = 0;
        for (let ch = 0; ch < 2; ch++) {
          const da = s.a.getChannelData(ch);
          const dbb = s.b.getChannelData(ch);
          for (let i = from; i < s.a.length; i++) {
            const x = da[i] - dbb[i];
            diff += x * x;
            diffPeak = Math.max(diffPeak, Math.abs(x));
          }
        }
        const diffRms = Math.sqrt(diff / (2 * (s.a.length - from)));
        // Lift: how much louder the mention stretch is with the ornaments (robust to the master drive, which makes the
        // difference above more than the ornaments alone where a genre drives its master hard).
        const lift = db(rms(s.a, from)) - db(rms(s.b, from));
        rows.push({ genre: s.genre, style: s.style, name: s.name, voice: s.voice, ornamentRmsDb: db(diffRms) - db(rms(s.b, from)), ornamentPeakDb: db(diffPeak) - db(peak(s.b)), lift });
      }
      const join = (pick) => {
        const fade = Math.round(sr * FADE_SEC);
        const total = segments.reduce((n, s) => n + s[pick].length, 0);
        const all = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: sr });
        for (let ch = 0; ch < 2; ch++) {
          const dst = all.getChannelData(ch);
          let at = 0;
          for (const s of segments) {
            const clip = s[pick];
            const src = clip.getChannelData(Math.min(ch, clip.numberOfChannels - 1));
            for (let i = 0; i < clip.length; i++) dst[at + i] = src[i] * s.gain * Math.min(1, i / fade, (clip.length - 1 - i) / fade);
            at += clip.length;
          }
        }
        return synth.audioBufferToWavBase64(all);
      };
      return { rows, starts: segments.map((_, i) => i * SEGMENT_SEC), withOrnaments: join("a"), without: join("b") };
    },
    { root, swaps, SEGMENT_SEC, SWAP_GAP_SEC, BAR_OFFSET, FADE_SEC, WAVE, SMART, ONLY },
  );
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await server.close();
}

const name = ONLY ? "subset" : "all-styles";
const withFile = resolve(out, `${name}.wav`);
const withoutFile = resolve(out, `${name}-no-ornaments.wav`);
const indexFile = resolve(out, `${name}.txt`);
writeFileSync(withFile, Buffer.from(result.withOrnaments, "base64"));
writeFileSync(withoutFile, Buffer.from(result.without, "base64"));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const lines = [
  `Attention layer showcase: ${result.rows.length} house styles x ${SEGMENT_SEC} s, swaps 40..69 of imd-eth-7d (one every ${SWAP_GAP_SEC} s), song-form bar ${BAR_OFFSET}.`,
  `Mentions in every segment at ${WAVE.map((t) => (t === SMART ? `${t} (smart)` : t)).join(", ")} s. Same per-segment gain in both files (RMS -18 dBFS of the no-ornament render).`,
  `From ${WAVE[0]} s on: ornament = what the mentions added (with minus without), RMS and peak against the track's own;`,
  "lift = how much louder that stretch is with them.",
  "",
  "start   genre/style                         voice              ornament RMS  ornament peak   lift",
  ...result.rows.map((r, i) => {
    const at = result.starts[i];
    return `${mmss(at)} ${String(at).padStart(4)}s  ${`${r.genre}/${r.style} (${r.name})`.padEnd(36)}${r.voice.padEnd(19)}${r.ornamentRmsDb.toFixed(1).padStart(8)} dB${r.ornamentPeakDb.toFixed(1).padStart(10)} dB${r.lift.toFixed(2).padStart(7)} dB`;
  }),
];
writeFileSync(indexFile, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
console.log(`\nwrote ${withFile}\nwrote ${withoutFile}\nwrote ${indexFile}`);
