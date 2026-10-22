// Render wall.html frame by frame into transparent PNGs.
// usage: node render.cjs <outDir> [scale=1.5] [from=0] [to=FRAMES]
//        STATION=<key> ...           theme + ticker of a stations/registry.json entry (default: the house $IDM look)
//        PLATE=1 node render.cjs <outDir>   only the NOW PLAYING plate -> <outDir>/plate.png
// Playwright is resolved from PLAYWRIGHT_DIR (default: the main checkout's node_modules); Chrome from CHROME.
//        REGISTRY=<file>               the registry to find STATION in (the loop builder passes baked + runtime)
const path = require("path");
const fs = require("fs");
const pwDir = process.env.PLAYWRIGHT_DIR || "/Users/0xdis/orca/projects/IMD_vibe/node_modules/playwright";
const { chromium } = require(pwDir);

(async () => {
  const out = process.argv[2];
  const scale = Number(process.argv[3] || 1.5);
  fs.mkdirSync(out, { recursive: true });
  // CHROME, else the Mac's Google Chrome when there is one, else Playwright's own Chromium (the stream host).
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const exe = process.env.CHROME || (fs.existsSync(mac) ? mac : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
  const quads = process.env.QUADS || path.join(__dirname, "..", "work", "quads.json");
  if (fs.existsSync(quads)) await page.addInitScript(`window.QUADS = ${fs.readFileSync(quads, "utf8")};`);
  if (process.env.STATION) {
    const reg = JSON.parse(fs.readFileSync(process.env.REGISTRY || path.join(__dirname, "..", "..", "..", "stations", "registry.json"), "utf8"));
    const s = reg.stations.find((x) => x.key === process.env.STATION);
    if (!s) throw new Error(`station ${process.env.STATION} not in the registry`);
    const st = { key: s.key, ticker: s.ticker, label: s.label, kind: s.kind, chain: reg.chains[String(s.chainId)].name, theme: s.theme };
    await page.addInitScript(`window.STATION = ${JSON.stringify(st)};`);
  }
  await page.goto("file://" + path.join(__dirname, "wall.html"));
  await page.evaluate(() => window.ready);
  if (process.env.PLATE) {
    await page.evaluate(() => window.renderPlate());
    await page.screenshot({ path: path.join(out, "plate.png"), omitBackground: true });
    console.log("plate done");
    await browser.close();
    return;
  }
  const total = await page.evaluate(() => window.FRAMES);
  const from = Number(process.argv[4] || 0), to = Number(process.argv[5] || total);
  for (let n = from; n < to; n++) {
    await page.evaluate((i) => window.renderAt(i), n);
    await page.screenshot({ path: path.join(out, `w${String(n).padStart(4, "0")}.png`), omitBackground: true });
    if (n % 100 === 0) process.stdout.write(`${n} `);
  }
  console.log("done");
  await browser.close();
})();
