// Headless check for the rules versions: run against `npm run preview` (default http://127.0.0.1:4180).
// Writes only screenshots/v2-*.png (never the tracked check.mjs shots).
//   node scripts/check-v2.mjs [baseUrl] [--bot-timeline path/to/v2-window.json]
//   v2-window.json: a v2 timeline window around a drop (bot: buildTimeline(..., "v2") + trackWindow).
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const base = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "http://127.0.0.1:4180/";
const botTimeline = flag("--bot-timeline");
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

const ui = (p) =>
  p.evaluate(() => ({
    rules: window.__site.rules(),
    bodyV2: document.body.classList.contains("rules-v2"),
    heatVisible: getComputedStyle(document.querySelector(".heat")).display !== "none",
    trackVisible: getComputedStyle(document.querySelector("#seg-track").parentElement).display !== "none",
    heat: window.__site.heat(),
    trackNo: window.__site.trackNo(),
    drops: window.__site.drops(),
    trackLines: [...document.querySelectorAll("#log li.track")].map((li) => li.textContent.replace(/^#\s*/, "")),
    swaps: window.__site.swaps(),
    srcLabel: document.querySelector("#src-label").textContent,
  }));

// v1 live: the deployed hook, unchanged.
await session("v1-live", { width: 1440, height: 900 }, base, async (page) => {
  await page.waitForFunction(() => window.__site?.swaps() >= 10, null, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(800);
  report.v1Live = await ui(page);
  await page.screenshot({ path: `${out}v2-v1-live-fold.png` });
});

// v1: the Sepolia tape re-simulated under v1 rules, no heat.
await session("v1-replay", { width: 1440, height: 900 }, `${base}?replay=sepolia&rules=v1`, async (page) => {
  await page.waitForTimeout(5000);
  report.v1Replay = await ui(page);
  await page.screenshot({ path: `${out}v2-v1-replay-fold.png` });
});

// v2: the recorded Sepolia tape, sped up so TRACK #1 (swap 70) comes in seconds.
await session("v2-replay", { width: 1440, height: 900 }, `${base}?replay=sepolia&speed=200`, async (page) => {
  await page.click("#play");
  const heat = [];
  let shotHeat = false;
  for (let i = 0; i < 200; i++) {
    const s = await page.evaluate(() => ({ heat: window.__site.heat(), drops: window.__site.drops(), swaps: window.__site.swaps() }));
    heat.push(s.heat);
    if (!shotHeat && s.heat >= 8 && s.drops === 0) { shotHeat = true; await page.screenshot({ path: `${out}v2-heat-rising-fold.png` }); }
    if (s.drops >= 1) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}v2-drop-moment-fold.png` });
  const r = await ui(page);
  r.heatSamples = heat.filter((h, i) => i === 0 || h !== heat[i - 1]);
  r.heatRose = Math.max(...heat) >= 8;
  r.dropClass = await page.evaluate(() => document.querySelector("#panel").classList.contains("drop"));
  r.audio = await page.evaluate(() => window.__site.level());
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}v2-after-drop-fold.png` });
  await page.screenshot({ path: `${out}v2-replay-desktop-1440.png`, fullPage: true });
  report.v2Replay = r;
});

await session("v2-mobile", { width: 390, height: 844 }, `${base}?replay=sepolia&speed=200`, async (page) => {
  await page.waitForFunction(() => window.__site.drops() >= 1, null, { timeout: 60_000 }).catch(() => {});
  report.v2Mobile = { ...(await ui(page)), horizontalOverflowPx: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) };
  await page.screenshot({ path: `${out}v2-mobile-390-fold.png` });
});

// ?net=sepolia-v2 has no hook yet: falls back to the v1 sepolia hook.
await session("v2-net-fallback", { width: 1440, height: 900 }, `${base}?net=sepolia-v2`, async (page) => {
  await page.waitForTimeout(1500);
  report.v2NetFallback = { rules: await page.evaluate(() => window.__site.rules()), srcLabel: await page.textContent("#src-label") };
});

// Bot render page with a v2 window: frame just after the drop.
if (botTimeline) {
  const timeline = JSON.parse(readFileSync(botTimeline, "utf8"));
  await session("v2-bot", { width: 1080, height: 1080 }, `${base}bot.html`, async (page) => {
    await page.waitForFunction(() => typeof window.__setup === "function");
    const info = await page.evaluate((t) => window.__setup({ timeline: t, width: 1080, height: 1080, fps: 30, seconds: 32, title: "IDM/ETH · V2 PREVIEW", subtitle: "TRACK COMPLETE" }), timeline);
    const at = timeline.findIndex((e) => e.trackComplete);
    const frame = Math.round(((0.25 + (at / timeline.length) * (32 - 0.85)) + 0.3) * 30);
    await page.evaluate((f) => window.__frame(f), frame);
    report.v2Bot = {
      info,
      frame,
      bodyV2: await page.evaluate(() => document.body.classList.contains("rules-v2")),
      trackLines: await page.evaluate(() => [...document.querySelectorAll("#log li.track")].map((li) => li.textContent)),
      heatLabel: await page.textContent("#heat-label"),
    };
    await page.screenshot({ path: `${out}v2-bot-1080.png` });
    await page.evaluate((f) => window.__frame(f), frame - 45);
    report.v2Bot.heatBefore = await page.textContent("#heat-label");
    await page.screenshot({ path: `${out}v2-bot-1080-before-drop.png` });
  });
}

await browser.close();
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
