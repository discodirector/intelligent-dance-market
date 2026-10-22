// Orders a station's style pack from the IMD swarm (docs/STATIONS.md "Ordering the sound"): the job body comes from
// bot/src/imd/styleJob.ts, the payment from bot/src/imd/paid.ts (the same flow as imd-launch.ts: hidden key prompt,
// typed "pay", nothing signed before it). Orders and job ids are kept per station in bot/.swarm-style/<key>.json
// (gitignored), so a rerun resumes an order instead of paying twice, and a revision continues the right job.
//
//   npx tsx bot/scripts/swarm-style.ts check  --key chog --genres liquid,acid --brief "<the owner's words>"
//                                             [--styles 2] [--repo https://github.com/o/r] [--commit <sha>]
//       builds the job.open body and runs the FREE POST /requests/check; prints the body and the blockers (--json: the
//       whole response). No key.
//   npx tsx bot/scripts/swarm-style.ts order  (same args) [--payer 0x...]       pays 0.5 IMD, opens the job
//   npx tsx bot/scripts/swarm-style.ts revise --key chog --notes "<what to change>"   job.continue, 0.5 IMD
//   npx tsx bot/scripts/swarm-style.ts status --key chog                         one read of the order and the job
//   npx tsx bot/scripts/swarm-style.ts fetch  --key chog                         waits for the job, takes the pack
//
// --commit defaults to the public repository's main (git ls-remote). fetch copies only
// packages/synth/src/stations/<key>.ts out of the delivered commit, onto the local branch station/<key> (created from
// HEAD, never main; uncommitted), then runs the gate (web/scripts/station-check-pack.mjs <key> --diff HEAD) and the
// A/B (web/scripts/station-ab.mjs <key>) and prints where the WAVs are.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API, api, checkRequest, newPaidState, payAndSubmit, pollOrder, printCheck, type PaidState } from "../src/imd/paid.ts";
import { PUBLIC_REPO, packPath, styleContinueBody, styleOpenBody, type StyleOrder } from "../src/imd/styleJob.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STATE_DIR = join(ROOT, "bot/.swarm-style");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DEFAULT_PAYER = "0x9eF17A987CB4a2355Ec2782785d79d3Db4B5fA8A".toLowerCase();
const JOB_DONE = new Set(["completed", "blocked", "failed", "cancelled", "superseded"]);

/** One paid job of a station: the first version (open) or a revision (continue). */
interface StyleJob {
  kind: "open" | "continue";
  orderId: string;
  token: string;
  jobId?: string;
  parentJobId?: string;
  baseCommit?: string;
  notes?: string;
  at: string;
}
/** bot/.swarm-style/<key>.json: who pays, the jobs in order, and the order being paid (resumed on a rerun). */
interface StationState {
  key: string;
  payer: string;
  jobs: StyleJob[];
  pending?: { kind: "open" | "continue"; paid: PaidState; parentJobId?: string; baseCommit?: string; notes?: string };
}

const statePath = (key: string) => join(STATE_DIR, `${key}.json`);
function load(key: string): StationState | undefined {
  return existsSync(statePath(key)) ? JSON.parse(readFileSync(statePath(key), "utf8")) : undefined;
}
function save(state: StationState) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(state.key), JSON.stringify(state, null, 2));
  chmodSync(statePath(state.key), 0o600);
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function orderArgs(): StyleOrder {
  const key = arg("key"), genres = arg("genres"), brief = arg("brief");
  if (!key || !genres || !brief) throw new Error('usage: swarm-style.ts check|order --key <station> --genres liquid,acid --brief "<vibe>" [--styles 2] [--repo <url>] [--commit <sha>]');
  const repoUrl = arg("repo") ?? PUBLIC_REPO;
  // The commit the job starts from: the public repository's main unless named.
  const baseCommit = (arg("commit") ?? git("ls-remote", repoUrl, "main").split(/\s/)[0]).toLowerCase();
  const styles = arg("styles");
  return { key, genres: genres.split(",").map((g) => g.trim()).filter(Boolean), brief, repoUrl, baseCommit, ...(styles ? { styles: Number(styles) } : {}) };
}

/** Prints a check (body first when asked); returns the number of blockers. */
function report(check: any) {
  const blockers = printCheck(check);
  for (const s of check.suggestions ?? []) console.log(`  ? ${s.code ?? ""}${s.code ? ": " : ""}${s.detail ?? s.text ?? JSON.stringify(s)}`);
  if (check.project) console.log(`  project: ${JSON.stringify(check.project).slice(0, 600)}`);
  return blockers;
}

/** Pays the station's pending order (resuming it) and records the admitted job. */
async function payPending(state: StationState, action: "job.open" | "job.continue", input: unknown) {
  const pending = state.pending!;
  const order = await payAndSubmit({
    action, input, payer: state.payer, state: pending.paid, what: "the job",
    save: (paid) => { pending.paid = paid; save(state); },
  });
  if (!order) return;
  const settled = await pollOrder(order.orderId, order.token);
  admit(state, settled);
}

/** An admitted order becomes a job of the station; anything else stays pending (status/rerun shows it). */
function admit(state: StationState, settled: any) {
  const pending = state.pending;
  const result = settled?.admission?.result;
  if (!pending?.paid.orderId || settled?.status !== "admitted" || result?.kind !== "job") return false;
  state.jobs.push({
    kind: pending.kind, orderId: pending.paid.orderId, token: pending.paid.token, jobId: result.jobId,
    ...(pending.parentJobId ? { parentJobId: pending.parentJobId } : {}), ...(pending.baseCommit ? { baseCommit: pending.baseCommit } : {}),
    ...(pending.notes ? { notes: pending.notes } : {}), at: new Date().toISOString(),
  });
  delete state.pending;
  save(state);
  console.log(`job ${result.jobId}: ${API}/jobs/${result.jobId}`);
  return true;
}

async function check() {
  const body = styleOpenBody(orderArgs());
  console.log(JSON.stringify({ action: "job.open", input: body }, null, 2));
  console.log(`objective: ${body.objective.length} chars`);
  const res = await checkRequest("job.open", body);
  if (process.argv.includes("--json")) console.log(JSON.stringify(res, null, 2));
  if (report(res)) process.exit(1);
}

async function order() {
  const o = orderArgs();
  const body = styleOpenBody(o);
  if (report(await checkRequest("job.open", body))) process.exit(1);
  const payer = (arg("payer") ?? DEFAULT_PAYER).toLowerCase();
  const state = load(o.key) ?? { key: o.key, payer, jobs: [] };
  if (state.payer !== payer) throw new Error(`station ${o.key} is paid by ${state.payer} (bot/.swarm-style/${o.key}.json); not ${payer}`);
  if (state.jobs.length) throw new Error(`station ${o.key} already has job ${state.jobs.at(-1)!.jobId}; use revise (job.continue) or move its state file away`);
  if (state.pending && state.pending.kind !== "open") throw new Error(`a revision is pending for ${o.key}; run revise again to finish it`);
  // A rerun resumes the same order; a new requestKey is only taken when the body changed.
  if (state.pending && state.pending.baseCommit !== o.baseCommit) throw new Error(`pending order was quoted on ${state.pending.baseCommit}; pass --commit ${state.pending.baseCommit} to resume it`);
  state.pending ??= { kind: "open", paid: newPaidState(), baseCommit: o.baseCommit };
  save(state);
  await payPending(state, "job.open", body);
}

/** The job a revision continues: the project's newest job (project.head), as job.continue requires. */
async function headJob(state: StationState) {
  const last = state.jobs.at(-1);
  if (!last?.jobId) throw new Error(`station ${state.key} has no admitted job yet (order first, or status to pick up an admitted order)`);
  const job = (await api(`/jobs/${last.jobId}`)).json;
  return { job, head: (job.project?.head as string | undefined) ?? last.jobId };
}

async function revise() {
  const key = arg("key"), notes = arg("notes");
  if (!key || !notes) throw new Error('usage: swarm-style.ts revise --key <station> --notes "<what to change>"');
  const state = load(key);
  if (!state) throw new Error(`no order for ${key} (bot/.swarm-style/${key}.json)`);
  if (arg("payer") && arg("payer")!.toLowerCase() !== state.payer) throw new Error(`only ${state.payer}, the wallet that paid, can continue ${key}`);
  if (state.pending && state.pending.kind !== "continue") throw new Error(`the first order of ${key} is still pending; run order again to finish it`);
  const { head } = await headJob(state);
  if (state.pending && state.pending.parentJobId !== head) throw new Error(`pending revision continues ${state.pending.parentJobId}, but the project's head is now ${head}`);
  const body = styleContinueBody(key, head, state.pending?.notes ?? notes);
  if (state.pending?.notes && state.pending.notes !== notes) console.log(`resuming the pending revision with its own notes: ${state.pending.notes}`);
  console.log(JSON.stringify({ action: "job.continue", input: body }, null, 2));
  const res = await checkRequest("job.continue", body);
  if (report(res)) process.exit(1);
  // A continuation paid from any other wallet is refused after the payment, and the payment is spent.
  if (res.owner && String(res.owner).toLowerCase() !== state.payer) throw new Error(`the project's owner is ${res.owner}, not ${state.payer}; nothing was paid`);
  state.pending ??= { kind: "continue", paid: newPaidState(), parentJobId: head, notes };
  save(state);
  await payPending(state, "job.continue", body);
}

/** Picks up a pending order that was admitted since; returns the station's newest job id. */
async function resolveJob(key: string) {
  const state = load(key);
  if (!state) throw new Error(`no order for ${key} (bot/.swarm-style/${key}.json)`);
  if (state.pending?.paid.orderId) {
    const j = (await api(`/requests/${state.pending.paid.orderId}`, { token: state.pending.paid.token })).json;
    console.log(`pending ${state.pending.kind} order ${state.pending.paid.orderId}: ${j.status ?? j.order?.status ?? JSON.stringify(j).slice(0, 200)}`);
    admit(state, j);
  }
  const jobId = state.jobs.at(-1)?.jobId;
  if (!jobId) throw new Error(`station ${key} has no admitted job yet`);
  return { state, jobId };
}

function showJob(job: any) {
  console.log(`job ${job.id}: ${job.state}${job.blockedReason ? ` (${job.blockedReason})` : ""}, paid by ${job.paidBy ?? "nobody"}`);
  if (job.project) console.log(`  project ${job.project.id}: head ${job.project.head}, running ${job.project.running ?? "none"}, ${job.project.versions?.length ?? 0} version(s)`);
  if (job.delivery) console.log(`  delivered ${job.delivery.repoUrl} @ ${job.delivery.commit}${job.delivery.pullRequestUrl ? ` (${job.delivery.pullRequestUrl})` : ""}`);
}

async function status() {
  const key = arg("key");
  if (!key) throw new Error("usage: swarm-style.ts status --key <station>");
  const { jobId } = await resolveJob(key);
  showJob((await api(`/jobs/${jobId}`)).json);
}

async function fetchPack() {
  const key = arg("key");
  if (!key) throw new Error("usage: swarm-style.ts fetch --key <station>");
  const { jobId } = await resolveJob(key);
  const file = packPath(key);

  // Wait for the job to finish and its delivery to land.
  let job: any, result: any;
  for (let last = ""; ; await new Promise((r) => setTimeout(r, 30_000))) {
    job = (await api(`/jobs/${jobId}`)).json;
    const now = `${job.state}${job.delivery?.commit ? " delivered" : ""}`;
    if (now !== last) console.log(`[${new Date().toISOString().slice(11, 19)}] ${jobId}: ${(last = now)}`);
    if (!JOB_DONE.has(job.state)) continue;
    result = (await api(`/jobs/${jobId}/result`)).json;
    if (job.state !== "completed" || result.delivery?.commit || result.delivery?.failure) break;
  }
  showJob(job);
  const delivery = result.delivery ?? {};
  if (job.state !== "completed" || !delivery.repoUrl || !delivery.commit) {
    console.log(`no delivered commit: ${JSON.stringify({ state: job.state, blockedReason: job.blockedReason, delivery, source: result.source }, null, 2).slice(0, 1500)}`);
    process.exit(1);
  }
  const commit = String(delivery.commit);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`delivered commit ${commit} is not a sha`);

  // The working tree: no tracked changes but the pack (untracked dev files are fine), on station/<key> (never main).
  const dirty = git("status", "--porcelain", "--untracked-files=no").split("\n").filter(Boolean).filter((l) => l.slice(3) !== file);
  if (dirty.length) throw new Error(`the working tree has other changes; commit or move them first:\n${dirty.slice(0, 10).join("\n")}`);
  const branch = `station/${key}`;
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== branch) {
    const exists = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: ROOT }).status === 0;
    git("switch", ...(exists ? [branch] : ["-c", branch]));
    console.log(`${exists ? "switched to" : "created"} branch ${branch}`);
  }

  // Only the pack leaves the delivered commit; anything else it changed is reported, not taken.
  console.log(`fetching ${delivery.repoUrl} ${commit}`);
  git("fetch", "--no-tags", "--quiet", delivery.repoUrl, commit);
  const base = (job.project?.versions ?? []).find((v: { jobId: string }) => v.jobId === jobId)?.baseCommit;
  if (base) {
    try {
      const changed = git("diff", "--name-only", base, commit).split("\n").filter(Boolean);
      const extra = changed.filter((f) => f !== file);
      console.log(`delivered commit changes ${changed.length} file(s) against ${base.slice(0, 10)}${extra.length ? `; NOT taken: ${extra.slice(0, 10).join(", ")}` : ""}`);
    } catch {
      console.log(`(cannot diff against the job's base ${base.slice(0, 10)}: not in this clone)`);
    }
  }
  let pack: string;
  try {
    pack = git("show", `${commit}:${file}`);
  } catch {
    throw new Error(`the delivered commit has no ${file}`);
  }
  mkdirSync(dirname(join(ROOT, file)), { recursive: true });
  writeFileSync(join(ROOT, file), `${pack}\n`);
  console.log(`wrote ${file} (${pack.length} chars) from ${commit.slice(0, 10)} on ${branch}, uncommitted`);

  // The gate, then the A/B for listening.
  const node = (script: string, ...args: string[]) => spawnSync(process.execPath, [join(ROOT, script), key, ...args], { cwd: ROOT, stdio: "inherit" }).status;
  const gate = node("web/scripts/station-check-pack.mjs", "--diff", "HEAD");
  const ab = node("web/scripts/station-ab.mjs");
  const out = join(ROOT, "sim/stations", key);
  console.log(`\ngate: ${gate === 0 ? "PASS" : "FAIL"}; A/B: ${ab === 0 ? "written" : "FAILED"}`);
  if (existsSync(out)) {
    console.log(`WAVs in ${out}:`);
    for (const f of readdirSync(out).filter((f) => f.endsWith(".wav")).sort()) console.log(`  ${f}`);
    console.log(`listen first: ${join(out, "ab-house-vs-pack.wav")} (house base, then the station style, 20 s each)`);
  }
  if (gate !== 0 || ab !== 0) process.exit(1);
}

const COMMANDS: Record<string, () => Promise<void>> = { check, order, revise, status, fetch: fetchPack };
const command = COMMANDS[process.argv[2]];
if (!command) {
  console.error("usage: swarm-style.ts check|order|revise|status|fetch --key <station> ... (see the header of this file)");
  process.exit(2);
}
command().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
