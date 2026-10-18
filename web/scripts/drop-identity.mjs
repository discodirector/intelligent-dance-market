// Synth byte-identity check for the heat/drop path: with heat == 0 and no trackComplete cue the render must not change.
//   node web/scripts/drop-identity.mjs save   → renders the reference timelines, writes sim/stress/drop/identity.json
//   node web/scripts/drop-identity.mjs        → renders again and compares sample hashes against identity.json
// Timelines: two stress benches (absolute) and two accumulation A/B timelines (rel+acc), 16 s each from bar 12.
import { chromium } from "playwright";
import { createServer } from "vite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "sim/stress/drop");
mkdirSync(out, { recursive: true });
const ref = resolve(out, "identity.json");
const SAVE = process.argv[2] === "save";
const SECONDS = 16;
const TIMELINES = [
  "web/public/stress/mixed-random.timeline.json",
  "web/public/stress/whales-only.timeline.json",
  "sim/stress/accumulate/timelines/small-buys-varied-rel+acc.timeline.json",
  "sim/stress/accumulate/timelines/imd-week-rel+acc.timeline.json",
];

const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port: 5198, strictPort: true, fs: { allow: [root] } } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5198/render.html?timeline=/demo-timeline.json");
const hashes = {};
for (const file of TIMELINES) {
  const events = JSON.parse(readFileSync(resolve(root, file), "utf8"));
  const b64 = await page.evaluate(async ({ root, events, seconds }) => {
    const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
    const points = events.map((e) => ({ time: e.timestamp, state: synth.decode(e.slot0, e.slot1), ...(e.drop ? { drop: e.drop } : {}) }));
    const buf = await synth.renderTimelineToBuffer(points, seconds, 44100, { barOffset: 12 });
    return synth.audioBufferToWavBase64(buf);
  }, { root, events, seconds: SECONDS });
  hashes[file] = createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
}
await browser.close();
await server.close();

if (SAVE || !existsSync(ref)) {
  writeFileSync(ref, JSON.stringify(hashes, null, 1) + "\n");
  console.log("saved", ref);
  for (const [f, h] of Object.entries(hashes)) console.log(h.slice(0, 16), f);
} else {
  const want = JSON.parse(readFileSync(ref, "utf8"));
  let bad = 0;
  for (const [f, h] of Object.entries(hashes)) {
    const same = want[f] === h;
    if (!same) bad++;
    console.log(same ? "identical" : "DIFFERENT", h.slice(0, 16), f);
  }
  console.log(bad ? `${bad} render(s) changed` : "all renders byte-identical");
  process.exit(bad ? 1 : 0);
}
