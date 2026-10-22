// Style pack gate (docs/STATIONS.md "Style pack", packages/synth/src/stations/README.md). Run by the swarm job and
// again here before the owner listens:
//   node web/scripts/station-check-pack.mjs <key> [--diff <git ref>]   → sim/stations/<key>/<genre>-<style>-e<epoch>.wav
// Checks, in order (exit 1 on any fail):
//   1. the pack validates (pack.ts validatePack: ids, bases, data shapes and ranges);
//   2. the synth typechecks with the pack in it, and the house history tests pass (eras FROZEN_SHA256, styles);
//   3. with --diff <ref>: the only file changed against <ref> is packages/synth/src/stations/<key>.ts;
//   4. every style renders 3 epochs of its genre in the station's program (20 s each, on three stretches of the
//      imd-week tape, opening 10 s before a track drop, as genre-variety.mjs), and per style:
//        loudness  median loudest-3s (RMS, as genre-sketches.mjs) within ±1 dB of -14.3 dBFS (the house level);
//        peak      under -0.5 dBFS on every clip (no clipping);
//        silence   no stretch under -50 dBFS (50 ms RMS) longer than 2 bars at the clip's slowest tempo;
//        determinism  every clip renders twice to the same SHA-256.
// Idle stages off, as in the sketches.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const key = process.argv[2];
if (!key || key.startsWith("-")) {
  console.error("usage: node web/scripts/station-check-pack.mjs <key> [--diff <git ref>]");
  process.exit(2);
}
const diffArg = process.argv.indexOf("--diff");
const DIFF_REF = diffArg > 0 ? process.argv[diffArg + 1] : null;
const packFile = `packages/synth/src/stations/${key}.ts`;
const out = resolve(root, "sim/stations", key);
mkdirSync(out, { recursive: true });

const TARGET_DB = -14.3;
const LOUD_TOL_DB = 1;
const PEAK_MAX_DB = -0.5;
const SILENCE_BARS = 2;
// The render and the thresholds' judgement live in web/src/gate.ts (GATE); these name them for the summary line.

const failures = [];
const step = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const run = (cmd, args, cwd = root) => {
  try {
    execFileSync(cmd, args, { cwd, stdio: "pipe" });
    return { ok: true, out: "" };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() };
  }
};

// 2. Types and the house history. The pack is a .ts file in packages/synth/src, so the synth's tsc covers it.
const tsc = run(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "-p", "packages/synth"]);
step("types compile (tsc -p packages/synth)", tsc.ok);
if (!tsc.ok) console.log(tsc.out.split("\n").slice(0, 20).join("\n"));
const vitest = resolve(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const house = run(process.execPath, [vitest, "run", "test/eras.test.ts", "test/styles.test.ts"], resolve(root, "packages/synth"));
step("house history unchanged (eras FROZEN_SHA256, styles)", house.ok);
if (!house.ok) console.log(house.out.split("\n").slice(-30).join("\n"));

// 3. Only the pack file changed.
if (DIFF_REF) {
  const files = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).split("\n").filter(Boolean);
  let extra;
  try {
    extra = [...files(["diff", "--name-only", DIFF_REF]), ...files(["ls-files", "--others", "--exclude-standard", "--", "packages", "web/scripts"])].filter((f) => f !== packFile);
  } catch {
    extra = [`git diff ${DIFF_REF} failed`];
  }
  step(`only ${packFile} changed against ${DIFF_REF}`, extra.length === 0, extra.length ? `also: ${extra.slice(0, 8).join(", ")}` : "");
}

// 4. Offline renders, in Chromium (the same engine the site plays).
// The three tape stretches are a fixed fixture (station-gate-windows.json: the imd-week tape under V2_RULES, as
// genre-timeline.ts made it, 20 s from 10 s before each of the first three track drops), so every pack is measured
// on the same input as the house styles were.
const { windows } = JSON.parse(readFileSync(resolve(root, "web/scripts/station-gate-windows.json"), "utf8"));

const port = Number(process.env.RENDER_PORT ?? 5197);
const server = await createServer({ root: resolve(root, "web"), logLevel: "error", server: { port, strictPort: true, fs: { strict: false } } });
await server.listen();
const browser = await chromium.launch();
let result;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(`http://127.0.0.1:${port}/render.html?timeline=/demo-timeline.json`);
  // The render and the judgement are web/src/gate.ts, shared with the pipeline's built gate page (web/gate.html).
  result = await page.evaluate(
    async ({ root, key, windows }) => {
      let pack;
      try {
        pack = (await import(`/@fs${root}/packages/synth/src/stations/${key}.ts`)).default;
      } catch (err) {
        return { errors: [`cannot load stations/${key}.ts: ${err}`], rows: [], failures: [] };
      }
      const { gatePack } = await import(`/@fs${root}/web/src/gate.ts`);
      return gatePack(pack, windows, { wav: true });
    },
    { root, key, windows },
  );
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await server.close();
}

step(`pack validates (${packFile})`, result.errors.length === 0, result.errors.length ? `${result.errors.length} problem(s):` : "");
for (const err of result.errors) console.log(`      ${err}`);
if (result.errors.length === 0) {
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pad = (s, n) => String(s).padEnd(n);
  console.log("");
  console.log(`${pad("genre/style", 28)}${pad("base", 11)}${pad("epochs", 22)}${pad("loudest-3s med (min..max)", 30)}${pad("peak", 10)}${pad("silence", 10)}${pad("det", 5)}result`);
  for (const row of result.rows) {
    const loud = row.clips.map((c) => c.loudDb).sort((a, b) => a - b);
    if (row.bad.length) failures.push(`${row.genre}/${row.style}: ${row.bad.join(", ")}`);
    console.log(
      `${pad(`${row.genre}/${row.style}`, 28)}${pad(row.base, 11)}${pad(row.clips.map((c) => `${c.epoch}${NAMES[c.key]}`).join(" "), 22)}` +
        `${pad(`${row.median.toFixed(2)} (${loud[0].toFixed(2)}..${loud.at(-1).toFixed(2)})`, 30)}${pad(row.peak.toFixed(2), 10)}` +
        `${pad(`${row.silence.toFixed(2)} bar`, 10)}${pad(row.det ? "yes" : "NO", 5)}${row.bad.length ? `FAIL ${row.bad.join(", ")}` : "PASS"}`,
    );
    for (const c of row.clips) writeFileSync(resolve(out, `${row.genre}-${row.style}-e${c.epoch}.wav`), Buffer.from(c.wav, "base64"));
  }
  console.log(`\nloudness target ${TARGET_DB} ±${LOUD_TOL_DB} dBFS, peak <= ${PEAK_MAX_DB} dBFS, silence <= ${SILENCE_BARS} bars`);
  console.log(`wrote ${result.rows.reduce((n, r) => n + r.clips.length, 0)} clips to ${out}`);
}
console.log(failures.length ? `\nFAIL: ${failures.join("; ")}` : "\nPASS: the pack is ready for the owner to listen");
process.exit(failures.length ? 1 : 0);
