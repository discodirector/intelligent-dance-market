import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const urlFlag = process.argv.indexOf("--url");
const given = urlFlag >= 0 ? process.argv[urlFlag + 1] : "";

function freePort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function pickPort() {
  for (const port of [4179, 4180, 4181, 4182]) {
    if (await freePort(port)) return port;
  }
  throw new Error("no free preview port");
}

async function waitForHttp(url, child) {
  const started = Date.now();
  let log = "";
  child.stdout?.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    log += chunk.toString();
  });
  while (Date.now() - started < 25000) {
    if (child.exitCode != null) {
      throw new Error(`preview exited ${child.exitCode}\n${log}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}\n${log}`);
}

const INFO = /^\d+ · [A-G]#?\/(Dorian|Phrygian|Lydian|Locrian) · swap #\d+ · page #\d+$/;

let child = null;
let base = given.replace(/\/$/, "");
if (!base) {
  const port = await pickPort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(
    "npx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: webDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitForHttp(`${base}/`, child);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling"],
});

try {
  const render = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  const errors = [];
  render.on("pageerror", (err) => errors.push(String(err)));
  render.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await render.goto(`${base}/render.html?timeline=/demo-timeline.json&seconds=2`, {
    waitUntil: "networkidle",
  });
  await render.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  const audio = await render.evaluate(async () => {
    await window.__render({ fps: 8, seconds: 0.4 });
    const a = await window.__renderAudio(1.5);
    const b = await window.__renderAudio(1.5);
    const bin = atob(a);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    let peak = 0;
    for (let i = 44; i + 1 < view.byteLength; i += 2) {
      const sample = Math.abs(view.getInt16(i, true)) / 32768;
      if (sample > peak) peak = sample;
    }
    return {
      same: a === b,
      head: bin.slice(0, 4),
      bytes: bin.length,
      peak,
      b64: a.length,
    };
  });
  const scripts = await render.evaluate(() => [...document.scripts].map((script) => script.src));
  console.log("base", base);
  console.log("scripts", scripts.join("\n"));
  if (errors.length) throw new Error(`render page errors:\n${errors.join("\n")}`);
  if (audio.head !== "RIFF") throw new Error(`WAV header ${audio.head}`);
  if (!audio.same) throw new Error(`renderAudio was not deterministic ${JSON.stringify(audio)}`);
  if (!(audio.peak > 0.05)) throw new Error(`audio peak too low (${audio.peak})`);

  const demo = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const demoErrors = [];
  demo.on("pageerror", (err) => demoErrors.push(String(err)));
  await demo.goto(`${base}/?mode=demo`, { waitUntil: "networkidle" });
  await demo.waitForFunction(() => typeof window.__playerState === "function", null, { timeout: 10000 });
  await demo.click("#start");
  await demo.waitForFunction(() => window.__playerState?.().running === true, null, { timeout: 10000 });
  await demo.waitForTimeout(700);
  const info = (await demo.textContent("#info"))?.trim() ?? "";
  const pixels = await demo.evaluate(() => {
    const node = document.querySelector("canvas");
    if (!node) return 0;
    const context = node.getContext("2d");
    if (!context) return 0;
    const { data } = context.getImageData(0, 0, node.width, node.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 32) {
      if (data[i] + data[i + 1] + data[i + 2] > 48) lit += 1;
    }
    return lit;
  });
  if (demoErrors.length) throw new Error(`demo page errors:\n${demoErrors.join("\n")}`);
  if (!INFO.test(info)) throw new Error(`info line mismatch: ${info}`);
  if (pixels < 50) throw new Error(`canvas looks blank (${pixels} lit samples)`);

  const real = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  const realErrors = [];
  real.on("pageerror", (err) => realErrors.push(String(err)));
  await real.goto(`${base}/render.html?timeline=/timelines/imd-eth-7d.timeline.json&seconds=1`, {
    waitUntil: "domcontentloaded",
  });
  await real.waitForFunction(() => window.__ready === true && window.__timelineCount === 2036, null, {
    timeout: 20000,
  });
  const realAudio = await real.evaluate(async () => {
    await window.__render({ fps: 5, seconds: 0.2 });
    const a = await window.__renderAudio(1);
    const b = await window.__renderAudio(1);
    return { same: a === b, head: atob(a).slice(0, 4), bytes: atob(a).length, count: window.__timelineCount };
  });
  if (realErrors.length) throw new Error(`real timeline errors:\n${realErrors.join("\n")}`);
  if (realAudio.head !== "RIFF" || !realAudio.same) {
    throw new Error(`real timeline audio failed ${JSON.stringify(realAudio)}`);
  }

  console.log(
    JSON.stringify(
      {
        base,
        render: { head: audio.head, bytes: audio.bytes, peak: Number(audio.peak.toFixed(4)), same: audio.same },
        realTimeline: realAudio,
        demo: { info, litSamples: pixels, running: true },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  if (child) child.kill("SIGTERM");
}
