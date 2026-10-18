// Renders each stress timeline to a WAV through render.html (SPEC §4.3 listening bench).
//   node web/scripts/stress-render.mjs [baseUrl=http://127.0.0.1:4173] [outDir=sim/stress] [seconds=32]
import { chromium } from "playwright";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.argv[2] ?? "http://127.0.0.1:4173";
const outDir = resolve(root, process.argv[3] ?? "sim/stress");
const seconds = Number(process.argv[4] ?? 32);
const names = readdirSync(resolve(root, "web/public/stress")).filter((f) => f.endsWith(".timeline.json"));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const file of names) {
  await page.goto(`${base}/render.html?timeline=/stress/${file}&seconds=${seconds}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 30_000 });
  const b64 = await page.evaluate((s) => window.__renderAudio(s), seconds);
  const out = resolve(outDir, file.replace(".timeline.json", ".wav"));
  writeFileSync(out, Buffer.from(b64, "base64"));
  console.log("wrote", out);
}
await browser.close();
