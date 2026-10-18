// Renders the heat -> drop A/B timelines (from drop-ab.ts) to sim/stress/drop/*.wav.
//   npx tsx web/scripts/drop-ab.ts && node web/scripts/drop-render.mjs
// Drop timelines carry heatMax: the synth decodes heat (slot1 bits 168..175) and each trackComplete becomes a
// trackDrop cue holding the finished track until the next downbeat. Starts in the build (bar 12); era follows the epoch.
// Cadence timelines also carry `now` (virtual unix seconds, time-compressed): the synth runs its idle stages and the
// heat effects fade with them. `noheat` renders the same timeline decoded without heat, for comparison.
import { chromium } from "playwright";
import { createServer } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "sim/stress/drop");
const windows = JSON.parse(readFileSync(resolve(out, "timelines/windows.json"), "utf8"));
const RENDERS = [
  { scenario: "small-buys-varied", model: "rel+acc+drop", seconds: windows["small-buys-varied"].seconds + 4 },
  { scenario: "small-buys-varied", model: "rel+acc", seconds: windows["small-buys-varied"].seconds + 4 },
  { scenario: "imd-week", model: "rel+acc+drop", seconds: 24 },
  { scenario: "imd-week", model: "rel+acc", seconds: 24 },
  { scenario: "cadence-5m", model: "rel+acc+drop", seconds: windows["cadence-5m"].seconds },
  { scenario: "cadence-30m-lull", model: "rel+acc+drop", seconds: windows["cadence-30m-lull"].seconds },
  { scenario: "cadence-30m-lull", model: "rel+acc+drop", seconds: windows["cadence-30m-lull"].seconds, noheat: true },
];

const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port: 5197, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5197/render.html?timeline=/demo-timeline.json");
for (const { scenario, model, seconds, noheat } of RENDERS) {
  const tl = JSON.parse(readFileSync(resolve(out, `timelines/${scenario}-${model}.timeline.json`), "utf8"));
  const r = await page.evaluate(async ({ root, tl, seconds, noheat }) => {
    const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
    const opts = tl.heatMax && !noheat ? { heatMax: tl.heatMax } : undefined;
    const points = tl.events.map((e) => ({
      time: e.timestamp,
      ...(e.now ? { now: e.now } : {}),
      state: synth.decode(e.slot0, e.slot1, opts),
      ...(e.drop ? { drop: e.drop } : {}),
      ...(e.trackComplete ? { trackDrop: { held: synth.decode(e.trackComplete.slot0, e.trackComplete.slot1, opts) } } : {}),
    }));
    const buf = await synth.renderTimelineToBuffer(points, seconds, 44100, { barOffset: 12 });
    const ch = buf.getChannelData(0);
    let sum = 0, peak = 0;
    for (const v of ch) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    // High band (one-pole high-pass ~3 kHz) RMS per 4 s window: where the riser and rolls live.
    const hi = [];
    const a = Math.exp((-2 * Math.PI * 3000) / buf.sampleRate);
    let lp = 0, acc = 0, cnt = 0;
    const win = 4 * buf.sampleRate;
    for (let i = 0; i < ch.length; i++) {
      lp = (1 - a) * ch[i] + a * lp;
      const h = ch[i] - lp;
      acc += h * h; cnt++;
      if (cnt === win) { hi.push(Math.round(10 * Math.log10(acc / cnt + 1e-12))); acc = 0; cnt = 0; }
    }
    const drops = points.filter((p) => p.trackDrop).map((p) => p.time.toFixed(1));
    const heat = points.map((p) => p.state.heat ?? 0);
    const firstHot = points.find((p) => (p.state.heat ?? 0) > 0);
    return {
      rms: 20 * Math.log10(Math.sqrt(sum / ch.length)), peak, drops, maxHeat: Math.max(...heat), firstHot: firstHot ? firstHot.time.toFixed(1) : null,
      wav: synth.audioBufferToWavBase64(buf),
      hi,
      swaps: points.map((p) => p.time.toFixed(1)),
    };
  }, { root, tl, seconds, noheat });
  const file = resolve(out, `${scenario}-${model}${noheat ? "-noheat" : ""}.wav`);
  writeFileSync(file, Buffer.from(r.wav, "base64"));
  const cue = r.drops.length ? `  drops at ${r.drops.join(", ")} s` : "";
  const hot = r.firstHot ? `  heat > 0 from ${r.firstHot} s, max ${r.maxHeat.toFixed(2)}` : "";
  console.log(`${scenario}-${model}${noheat ? "-noheat" : ""}`.padEnd(40), `${seconds} s  rms ${r.rms.toFixed(1)} dB  peak ${r.peak.toFixed(2)}${hot}${cue}  →`, file);
  if (scenario.startsWith("cadence")) console.log("".padEnd(40), `swaps at ${r.swaps.join(" ")} s; high band dB per 4 s: ${r.hi.join(" ")}`);
}
await browser.close();
await server.close();
