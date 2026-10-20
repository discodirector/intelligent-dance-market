// Headless acceptance check: run against `npm run preview` (default http://127.0.0.1:4180).
//   node scripts/check.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:4180/";
const out = new URL("../screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const report = {};
const errors = [];

async function session(name, viewport, url, fn) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: name.includes("mobile") ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await fn(page);
  await ctx.close();
}

const swapLines = (p) => p.evaluate(() => document.querySelectorAll("#log li.buy, #log li.sell, #log li.whale").length);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const [name, viewport] of [["desktop-1440", { width: 1440, height: 900 }], ["mobile-390", { width: 390, height: 844 }]]) {
  await session(name, viewport, base, async (page) => {
    await page.waitForFunction(() => window.__site?.swaps() >= 82, null, { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const r = { swapsInTerminal: await swapLines(page), horizontalOverflowPx: await overflow(page) };
    await page.screenshot({ path: `${out}${name}.png`, fullPage: true });
    await page.screenshot({ path: `${out}${name}-fold.png` });
    if (name.startsWith("desktop")) {
      await page.click("#play");
      await page.waitForTimeout(2500);
      const samples = [];
      for (let i = 0; i < 5; i++) { samples.push(await page.evaluate(() => window.__site.level())); await page.waitForTimeout(300); }
      r.audio = samples;
      r.audioOk = samples.some((s) => s.running && s.dev > 2 && s.spec > 0);
      await page.screenshot({ path: `${out}${name}-playing.png` });
      // fps estimate while playing
      r.fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : res(n); }; requestAnimationFrame(f); }));
      await page.click('.audition[data-id="acid"]');
      await page.waitForTimeout(1200);
      r.auditionEra = await page.textContent("#era-name");
    }
    report[name] = r;
  });
}
await session("replay-1440", { width: 1440, height: 900 }, `${base}?replay=sepolia`, async (page) => {
  await page.waitForTimeout(6000);
  report.replay = { swapsInTerminal: await swapLines(page), epochLines: await page.evaluate(() => document.querySelectorAll("#log li.epoch").length) };
  await page.screenshot({ path: `${out}replay-desktop-1440-fold.png` });
});
await browser.close();
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
