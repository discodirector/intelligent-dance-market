// Renders the relative-tier A/B timelines (from relative-ab.ts) to sim/stress/relative/<scenario>-{abs,rel}.wav.
//   npx tsx web/scripts/relative-ab.ts && node web/scripts/relative-render.mjs [seconds=24]
// Starts in the build (bar 12) so kick and snare are audible within the clip; era follows each state's epoch.
import { chromium } from "playwright";
import { createServer } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "sim/stress/relative");
const seconds = Number(process.argv[2] ?? 24);
const SCENARIOS = ["small-buys-varied", "mixed-market-varied", "imd-week", "50-small-buys"];
const MODELS = ["abs", "rel"];

const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port: 5198, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5198/render.html?timeline=/demo-timeline.json");
for (const scenario of SCENARIOS) {
  for (const model of MODELS) {
    const events = JSON.parse(readFileSync(resolve(out, `timelines/${scenario}-${model}.timeline.json`), "utf8"));
    const r = await page.evaluate(async ({ root, events, seconds }) => {
      const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
      const points = events.map((e) => ({ time: e.timestamp, state: synth.decode(e.slot0, e.slot1), ...(e.drop ? { drop: e.drop } : {}) }));
      const buf = await synth.renderTimelineToBuffer(points, seconds, 44100, { barOffset: 12 });
      const ch = buf.getChannelData(0);
      let sum = 0, peak = 0;
      for (const v of ch) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      return { rms: 20 * Math.log10(Math.sqrt(sum / ch.length)), peak, wav: synth.audioBufferToWavBase64(buf) };
    }, { root, events, seconds });
    const file = resolve(out, `${scenario}-${model}.wav`);
    writeFileSync(file, Buffer.from(r.wav, "base64"));
    console.log(`${scenario}-${model}`.padEnd(26), `rms ${r.rms.toFixed(1)} dB  peak ${r.peak.toFixed(2)}  →`, file);
  }
}
await browser.close();
await server.close();
