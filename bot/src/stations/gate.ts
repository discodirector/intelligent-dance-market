// The pipeline's gate on a delivered style pack (docs/STATIONS.md "Automatic pipeline"), inside the bot's container:
// no git, TypeScript or Vite there, so the checks of web/scripts/station-check-pack.mjs are done this way:
//   only the pack file changed  GitHub's compare API on the delivery repository, base commit ... delivered commit;
//   the pack                    raw file at the delivered commit, read as DATA (synth parsePackSource: an object
//                               literal, never imported or evaluated), its key must be the station's;
//   validates                   synth validatePack;
//   renders and measures        web/gate.html (built into web/dist, the same web/src/gate.ts the checkout runs) in
//                               Chromium: 3 epochs per style, loudness, peak, silence, determinism.
// The house history cannot change: a runtime pack is data loaded at runtime, it touches no synth code (the checkout's
// gate still runs tsc and the house tests on the swarm's side).
import { chromium } from "playwright";
import { parsePackSource, validatePack, type StationPack } from "@swarm-sequencer/synth";
import { packPath } from "../imd/styleJob.ts";
import { serveDev, serveStatic } from "../release/index.ts";

export interface GateVerdict {
  ok: boolean;
  /** Human lines: every failure (empty when ok), also the notes of an automatic revision. */
  lines: string[];
  /** The pack, parsed and validated (only when ok). */
  pack?: StationPack;
  /** A per-style summary for the preview notice (genre/style: name). */
  styles?: string[];
}

export interface Delivery { repoUrl: string; commit: string; base: string }

/** owner/repo of a GitHub https url (the swarm delivers to GitHub: job body `github: true`). */
export function githubRepo(url: string): { owner: string; repo: string } {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error(`not a GitHub repository url: ${url}`);
  return { owner: m[1], repo: m[2] };
}

/** The delivered pack's source and the files the delivered commit changed against the job's base. */
export async function fetchDelivered(d: Delivery, key: string, fetchFn: typeof fetch = fetch): Promise<{ source: string; changed: string[] }> {
  const { owner, repo } = githubRepo(d.repoUrl);
  if (!/^[0-9a-f]{40}$/.test(d.commit) || !/^[0-9a-f]{40}$/.test(d.base)) throw new Error("delivery: commit and base must be 40-hex shas");
  const headers = { accept: "application/vnd.github+json", "user-agent": "theidm-stations" };
  const cmp = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/compare/${d.base}...${d.commit}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!cmp.ok) throw new Error(`GitHub compare ${d.base.slice(0, 10)}...${d.commit.slice(0, 10)}: HTTP ${cmp.status}`);
  const j = (await cmp.json()) as { files?: { filename: string }[]; status?: string };
  const changed = (j.files ?? []).map((f) => f.filename);
  const raw = await fetchFn(`https://raw.githubusercontent.com/${owner}/${repo}/${d.commit}/${packPath(key)}`, { signal: AbortSignal.timeout(30_000) });
  if (raw.status === 404) return { source: "", changed };
  if (!raw.ok) throw new Error(`raw ${packPath(key)}: HTTP ${raw.status}`);
  const source = await raw.text();
  if (source.length > 200_000) throw new Error(`${packPath(key)} is ${source.length} bytes: too large for a pack`);
  return { source, changed };
}

/** The data checks: only the pack changed, it parses as data, its key is the station's, it validates. */
export function checkSource(key: string, source: string, changed: string[]): GateVerdict {
  const file = packPath(key);
  const lines: string[] = [];
  const extra = changed.filter((f) => f !== file);
  if (!changed.includes(file)) lines.push(`the delivered commit does not change ${file}`);
  if (extra.length) lines.push(`only ${file} may change; the delivery also changes: ${extra.slice(0, 8).join(", ")}`);
  if (!source) lines.push(`the delivered commit has no ${file}`);
  if (lines.length) return { ok: false, lines };
  let pack: unknown;
  try {
    pack = parsePackSource(source);
  } catch (e) {
    return { ok: false, lines: [`${file} is not plain data: ${(e as Error).message}`] };
  }
  const errors = validatePack(pack);
  if (errors.length) return { ok: false, lines: errors.map((e) => `pack: ${e}`) };
  if ((pack as StationPack).key !== key) return { ok: false, lines: [`pack key "${(pack as StationPack).key}" is not the station's "${key}"`] };
  return { ok: true, lines: [], pack: pack as StationPack };
}

type Rendered = { errors: string[]; failures: string[]; rows: { genre: string; style: string; name: string }[] };

/**
 * Renders and judges a parsed pack in Chromium: web/gate.html from the built web (RENDER_WEB_DIR, the image), else
 * the web's Vite dev server (a checkout).
 */
export async function renderGate(pack: StationPack, webDir = process.env.RENDER_WEB_DIR): Promise<Rendered> {
  const srv = webDir ? await serveStatic(webDir, {}) : await serveDev("web", {});
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(`${srv.base}/gate.html`, { waitUntil: "load" });
    await page.waitForFunction(() => (window as { __gateReady?: boolean }).__gateReady === true, null, { timeout: 60_000 });
    const result = (await page.evaluate((p) => (window as unknown as { __gatePack: (p: unknown) => Promise<Rendered> }).__gatePack(p), pack as unknown)) as Rendered;
    if (errors.length) throw new Error(`gate page errors: ${errors.join("; ").slice(0, 500)}`);
    return result;
  } finally {
    await browser.close();
    await srv.close();
  }
}

/** The whole gate on a delivery. Infrastructure errors (GitHub, Chromium) throw: the caller retries later. */
export async function gateDelivery(key: string, d: Delivery, deps: { fetchFn?: typeof fetch; render?: (pack: StationPack) => Promise<Rendered> } = {}): Promise<GateVerdict> {
  const { source, changed } = await fetchDelivered(d, key, deps.fetchFn);
  const data = checkSource(key, source, changed);
  if (!data.ok) return data;
  const r = await (deps.render ?? renderGate)(data.pack!);
  const lines = [...r.errors.map((e) => `pack: ${e}`), ...r.failures.filter((f) => !f.startsWith("pack: "))];
  return lines.length ? { ok: false, lines } : { ok: true, lines: [], pack: data.pack, styles: r.rows.map((x) => `${x.genre}/${x.style}: ${x.name}`) };
}
