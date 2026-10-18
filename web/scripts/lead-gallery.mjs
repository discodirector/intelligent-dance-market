// Renders every era × lead patch in the full section to sim/stress/leads/*.wav (SPEC §4.5 listening bench).
//   node web/scripts/lead-gallery.mjs   (starts its own Vite dev server for TS sources)
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "sim/stress/leads");
mkdirSync(out, { recursive: true });
const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port: 5199, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5199/render.html?timeline=/demo-timeline.json");
const seconds = Number(process.argv[2] ?? 16);
const results = await page.evaluate(async ({ root, seconds }) => {
  const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
  const core = await import(`/@fs${root}/packages/core/src/index.ts`);
  /** 1 IMD-equivalent at the ETH calibration (1/400): 0.0025 ETH in wei. */
  const E = 10n ** 18n / 400n;
  let state = core.initialState();
  const sizes = [E / 4n, 2n * E, 10n * E, 40n * E];
  for (let i = 0; i < 60; i++) {
    state = core.mutate(state, { isBuy: (i * 7) % 10 < 6, quoteAmt: sizes[(i * 5) % 4], tick: 600 + ((i * 397) % 2400), blockNumber: 21000000n + BigInt(i), timestamp: 1760000000 + i * 6 }).state;
  }
  const done = [];
  const seen = new Set();
  for (const era of synth.ERAS) {
    for (let epoch = 0; epoch < 64; epoch++) {
      const patch = synth.leadPatch(era.id, epoch);
      const key = `${era.id}-${patch.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = { ...state, patternId: epoch * 4 };
      const buf = await synth.renderTimelineToBuffer([{ time: 0, state: s }], seconds, 44100, { eraId: era.id, barOffset: 16 });
      const again = await synth.renderTimelineToBuffer([{ time: 0, state: s }], 2, 44100, { eraId: era.id, barOffset: 16 });
      const first = await synth.renderTimelineToBuffer([{ time: 0, state: s }], 2, 44100, { eraId: era.id, barOffset: 16 });
      const same = synth.audioBufferToWavBase64(again) === synth.audioBufferToWavBase64(first);
      const ch = buf.getChannelData(0);
      let sum = 0, peak = 0;
      for (const v of ch) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      done.push({ key, name: patch.name, rms: 20 * Math.log10(Math.sqrt(sum / ch.length)), peak, same, wav: synth.audioBufferToWavBase64(buf) });
    }
  }
  return done;
}, { root, seconds });
for (const r of results) {
  writeFileSync(resolve(out, `${r.key}.wav`), Buffer.from(r.wav, "base64"));
  console.log(`${r.key.padEnd(20)} ${r.name.padEnd(18)} rms ${r.rms.toFixed(1)} dB  peak ${r.peak.toFixed(2)}  ${r.same ? "deterministic" : "NOT DETERMINISTIC"}`);
}
await browser.close();
await server.close();
