import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(webDir, "out", "eras");
const CEILING = 10 ** (-1 / 20);

function freePort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function pickPort() {
  for (const port of [4191, 4192, 4193, 4194]) {
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
    if (child.exitCode != null) throw new Error(`preview exited ${child.exitCode}\n${log}`);
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

function measureWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let dataOff = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      dataOff = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!dataSize) throw new Error("WAV has no data chunk");
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < dataSize; i += 2) {
    const sample = view.getInt16(dataOff + i, true);
    const amp = Math.abs(sample) / 32768;
    if (amp > peak) peak = amp;
    sum += amp * amp;
    n += 1;
  }
  const db = (amp) => (amp <= 1e-9 ? -120 : 20 * Math.log10(amp));
  return {
    peak,
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sum / n)),
    seconds: n / 2 / 44100,
  };
}

const port = await pickPort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(
  "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: webDir, stdio: ["ignore", "pipe", "pipe"] },
);

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling"],
});

try {
  await waitForHttp(`${base}/`, child);
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(`${base}/?mode=gallery`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.__renderEra === "function" && Array.isArray(window.__eraList), null, {
    timeout: 10000,
  });
  const eras = await page.evaluate(() => window.__eraList);
  if (!Array.isArray(eras) || eras.length < 8) throw new Error(`expected >= 8 eras, got ${eras?.length}`);

  const written = [];
  const hashes = new Set();
  for (const era of eras) {
    const check = era.id === eras[0].id;
    const clips = await page.evaluate(
      async ({ id, check }) => {
        const first = await window.__renderEra(id);
        if (!check) return { first, same: true };
        const second = await window.__renderEra(id);
        return { first, same: first === second };
      },
      { id: era.id, check },
    );
    if (!clips.same) throw new Error(`${era.id} render was not deterministic`);
    const raw = Buffer.from(clips.first, "base64");
    if (raw.subarray(0, 4).toString("ascii") !== "RIFF") throw new Error(`${era.id} is not a RIFF`);
    const levels = measureWav(raw);
    const file = path.join(outDir, `${era.id}.wav`);
    await writeFile(file, raw);
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
    if (hashes.has(hash)) throw new Error(`${era.id} WAV matches another era (${hash})`);
    hashes.add(hash);
    written.push({ id: era.id, name: era.name, file, hash, ...levels });
    console.log(
      `${era.id.padEnd(10)} ${era.name.padEnd(18)} peak ${levels.peakDb.toFixed(2)} dBFS  rms ${levels.rmsDb.toFixed(2)} dBFS  ${levels.seconds.toFixed(2)}s  ${hash}`,
    );
  }
  if (written.length < 8) throw new Error(`only wrote ${written.length} wavs`);
  const hot = written.filter((row) => row.peak > CEILING + 1e-6);
  if (hot.length) {
    throw new Error(`peak above -1 dBFS: ${hot.map((row) => `${row.id} ${row.peakDb.toFixed(2)}`).join(", ")}`);
  }
  const quiet = written.filter((row) => row.rmsDb < -45);
  if (quiet.length) throw new Error(`era nearly silent: ${quiet.map((row) => row.id).join(", ")}`);

  const replay = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const replayErrors = [];
  replay.on("pageerror", (err) => replayErrors.push(String(err)));
  await replay.goto(`${base}/?mode=replay&timeline=/timelines/imd-eth-7d.timeline.json`, {
    waitUntil: "domcontentloaded",
  });
  await replay.waitForFunction(() => (document.querySelector("#status")?.textContent ?? "").includes("states"), null, {
    timeout: 20000,
  });
  await replay.click("#fit");
  const speed = Number(await replay.inputValue("#speed"));
  if (!(speed > 100)) throw new Error(`fit 48s speed looks wrong: ${speed}`);
  await replay.click("#start");
  await replay.waitForFunction(() => window.__playerState?.().running === true, null, { timeout: 10000 });
  const seen = [];
  const started = Date.now();
  while (Date.now() - started < 49000) {
    const label = ((await replay.textContent("#epoch")) ?? "").trim();
    if (label && seen[seen.length - 1] !== label) seen.push(label);
    await replay.waitForTimeout(40);
  }
  console.log(`fit48 speed ${speed}`);
  console.log(`epochs ${seen.length}`);
  for (const label of seen) console.log(`  ${label}`);
  if (seen.length < 4) throw new Error(`fit 48s only showed ${seen.length} epoch labels`);
  if (replayErrors.length) throw new Error(`replay errors:\n${replayErrors.join("\n")}`);

  const tape = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  const tapeErrors = [];
  tape.on("pageerror", (err) => tapeErrors.push(String(err)));
  await tape.goto(
    `${base}/render.html?timeline=/timelines/imd-eth-7d.timeline.json&seconds=8&speed=${speed}`,
    { waitUntil: "domcontentloaded" },
  );
  await tape.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  const cross = await tape.evaluate(async () => {
    const a = await window.__renderAudio(8);
    const b = await window.__renderAudio(8);
    const frame = window.__frame;
    return { same: a === b, bytes: atob(a).length, frame };
  });
  console.log("crossfade", JSON.stringify({ same: cross.same, bytes: cross.bytes, frame: cross.frame }));
  if (!cross.same) throw new Error("sped-up tape render was not deterministic across an era change");
  if (tapeErrors.length) throw new Error(`tape render errors:\n${tapeErrors.join("\n")}`);
  if (errors.length) throw new Error(`gallery page errors:\n${errors.join("\n")}`);
  console.log(`wrote ${written.length} wavs to ${outDir}`);
} finally {
  await browser.close();
  child.kill("SIGTERM");
}
