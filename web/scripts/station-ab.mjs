// Style pack A/B for listening (docs/STATIONS.md "Gate": the owner listens). For every style of a pack, 20 s of its
// house base, then 20 s of the station style, on the same epoch (same key) and the same tape stretch as the gate's
// first clip:
//   node web/scripts/station-ab.mjs <key>
//     → sim/stations/<key>/ab-house-vs-pack.wav   (base, style, base, style, ... in pack order)
//     → sim/stations/<key>/<key>-<n>-styles.wav    (each of the n station styles, 20 s, in pack order)
// Offline in Chromium like station-check-pack.mjs; 15 ms fades at every seam so the cuts do not click.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const key = process.argv[2];
if (!key || key.startsWith("-")) {
  console.error("usage: node web/scripts/station-ab.mjs <key>");
  process.exit(2);
}
const out = resolve(root, "sim/stations", key);
mkdirSync(out, { recursive: true });
const CLIP_SEC = 20;
const BAR_OFFSET = 8;
const { windows } = JSON.parse(readFileSync(resolve(root, "web/scripts/station-gate-windows.json"), "utf8"));

const port = Number(process.env.RENDER_PORT ?? 5198);
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
    async ({ root, key, window, CLIP_SEC, BAR_OFFSET }) => {
      const synth = await import(`/@fs${root}/packages/synth/src/index.ts`);
      const pack = (await import(`/@fs${root}/packages/synth/src/stations/${key}.ts`)).default;
      const program = synth.programFromPack(pack);
      const toState = (s) => ({ ...s, pattern: BigInt(s.pattern), bass: BigInt(s.bass) });
      const toPoints = (epoch) => {
        const pin = (s) => ({ ...s, patternId: 4 * epoch + (s.patternId % 4) });
        return window.map((p) => ({
          time: p.time,
          state: pin(toState(p.state)),
          ...(p.whale ? { drop: { track: p.track, fill: p.isBuy } } : {}),
          ...(p.held ? { trackDrop: { held: pin(toState(p.held)) } } : {}),
        }));
      };
      const ab = [];
      const styles = [];
      const sides = [];
      for (const genre of pack.genres) {
        const era = synth.eraById(genre);
        for (const style of pack.styles[genre]) {
          let epoch = 0;
          while (!(synth.eraOf(epoch, program).id === genre && synth.styleOf(era, epoch, program).style.id === style.id)) epoch++;
          // The house base alone, pinned to the same epoch: same tonic, same tape, only the style differs.
          const house = synth.styleById(era, style.base).style;
          const pinned = { key: "ab-house", eras: [{ fromEpoch: 0, ids: [genre] }], styles: [{ fromEpoch: 0, styles: { [genre]: [house] } }] };
          const points = toPoints(epoch);
          const a = await synth.renderTimelineToBuffer(points, CLIP_SEC, 44100, { eraId: genre, barOffset: BAR_OFFSET, program: pinned });
          const b = await synth.renderTimelineToBuffer(points, CLIP_SEC, 44100, { eraId: genre, barOffset: BAR_OFFSET, program });
          ab.push(a, b);
          styles.push(b);
          sides.push(`${genre}/${style.id} (base ${style.base}, epoch ${epoch})`);
        }
      }
      // One buffer from many, each clip faded in and out over 15 ms.
      const join = (clips) => {
        const sr = clips[0].sampleRate;
        const fade = Math.round(sr * 0.015);
        const total = clips.reduce((n, c) => n + c.length, 0);
        const all = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: sr });
        for (let ch = 0; ch < 2; ch++) {
          const dst = all.getChannelData(ch);
          let at = 0;
          for (const clip of clips) {
            const src = clip.getChannelData(Math.min(ch, clip.numberOfChannels - 1));
            for (let i = 0; i < clip.length; i++) {
              const g = Math.min(1, i / fade, (clip.length - 1 - i) / fade);
              dst[at + i] = src[i] * g;
            }
            at += clip.length;
          }
        }
        return synth.audioBufferToWavBase64(all);
      };
      return { sides, ab: join(ab), styles: join(styles) };
    },
    { root, key, window: windows[0], CLIP_SEC, BAR_OFFSET },
  );
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await server.close();
}

const abFile = resolve(out, "ab-house-vs-pack.wav");
const stylesFile = resolve(out, `${key}-${result.sides.length}-styles.wav`);
writeFileSync(abFile, Buffer.from(result.ab, "base64"));
writeFileSync(stylesFile, Buffer.from(result.styles, "base64"));
console.log(`A/B, ${CLIP_SEC} s house base then ${CLIP_SEC} s station style:`);
result.sides.forEach((s, i) => console.log(`  ${String(i * 2 * CLIP_SEC).padStart(4)} s  ${s}`));
console.log(`wrote ${abFile}\nwrote ${stylesFile}`);
