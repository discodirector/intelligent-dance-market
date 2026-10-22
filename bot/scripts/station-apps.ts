// Station applications for the owner (docs/STATIONS.md "Applications and payment", "Automatic pipeline"): what the
// API wrote under OUT_DIR/applications/, with each paid application's pipeline stage (the stations worker's
// <id>.pipeline.json). Read-only except `approve`, the manual fallback when the worker is not running: it stamps
// approvedAt and prints the exact commands to run (registry entry, then the sound); it runs nothing itself.
//
//   npx tsx bot/scripts/station-apps.ts list [--all]        open and paid applications (--all: expired too)
//   npx tsx bot/scripts/station-apps.ts show <id>           everything, contact and vibe included
//   npx tsx bot/scripts/station-apps.ts approve <id>        the station-add and swarm-style commands for it
//   [--out <dir>]  default $OUT_DIR, else out/. On the VPS: docker compose exec api npx tsx scripts/station-apps.ts list
import { LIMITS, PAY_CHAINS } from "../src/api/config.ts";
import { stateOf, Store, type Application } from "../src/api/store.ts";
import type { Pipeline } from "../src/stations/pipeline.ts";
import { loadRegistry } from "../src/station.ts";
import { pickKey } from "../src/stations/onboard.ts";
import { CHAINS } from "../src/stations/sources.ts";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const [cmd, id] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
const store = new Store(arg("out") ?? process.env.OUT_DIR ?? "out");
const now = Date.now();
const usage = "usage: station-apps.ts list [--all] | show <id> | approve <id>   [--out <dir>]";

const usd = (a: Application) => `$${(a.quote.usd.totalCents / 100).toFixed(2)}`;
const what = (a: Application) => (a.kind === "setup" ? `${a.symbol ?? "?"} ${CHAINS[a.chainId!]?.name ?? a.chainId}${a.plus ? " station+" : ""}` : a.kind === "upgrade" ? `upgrade ${a.key} to station+` : `renew ${a.key} ${a.months} mo${a.plus ? " station+" : ""}`);
/** Single-quoted for a POSIX shell. */
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function get(): Application {
  const a = id ? store.get(id) : null;
  if (!a) {
    console.error(id ? `no application ${id} in ${store.dir}` : usage);
    process.exit(2);
  }
  return a;
}

if (cmd === "list") {
  const apps = store.list().filter((a) => argv.includes("--all") || stateOf(a, now, LIMITS.graceMs) !== "expired");
  if (!apps.length) console.log(`no applications in ${store.dir}${argv.includes("--all") ? "" : " (--all shows expired quotes too)"}`);
  for (const a of apps) {
    const state = stateOf(a, now, LIMITS.graceMs);
    const pay = a.payment ? ` · ${a.payment.symbol} on ${PAY_CHAINS[a.payment.chainId]?.name} ${a.payment.paidAt.slice(0, 16)}Z` : "";
    const p = store.pipeline<Pipeline>(a.id);
    const stage = p ? ` · pipeline ${p.stage}${p.key ? ` (${p.key})` : ""}${p.hold ? " hold" : ""}${p.waiting ? ` waiting ${p.waiting}` : ""}${p.errors ? ` ${p.errors} error(s): ${p.lastError}` : ""}${p.reason ? `: ${p.reason.split("\n")[0]}` : ""}` : "";
    console.log(`${a.id}  ${a.createdAt.slice(0, 16)}Z  ${state.padEnd(16)} ${usd(a).padStart(9)}  ${what(a)}${pay}${a.approvedAt ? " · approved" : ""}${stage}`);
  }
} else if (cmd === "show") {
  console.log(JSON.stringify({ ...get(), state: stateOf(get(), now, LIMITS.graceMs), pipeline: store.pipeline<Pipeline>(get().id) }, null, 2));
} else if (cmd === "approve") {
  const a = get();
  const state = stateOf(a, now, LIMITS.graceMs);
  if (a.kind !== "setup") {
    console.log(`${a.id} is a ${a.kind === "upgrade" ? "Station+ upgrade" : "renewal"} of ${a.key}: ${state === "paid" ? `paid, ${a.kind === "upgrade" ? `Station+ until ${a.plusUntil}` : `runs until ${a.paidUntil}`} (already in status.json)` : `not paid (${state})`}. Nothing to approve.`);
    process.exit(0);
  }
  if (state !== "paid") console.log(`WARNING: not paid (${state}). Approve only after the payment.\n`);
  const reg = loadRegistry();
  const key = pickKey(a.symbol ?? "token", CHAINS[a.chainId!].dex, reg.stations.map((s) => s.key));
  const pool = a.pool ? (a.pool.length === 66 ? ` --pool-id ${a.pool}` : ` --pool ${a.pool}`) : "";
  const genres = a.genres?.length ? a.genres.join(",") : "liquid,acid";
  const brief = sh(a.vibe ?? "");
  console.log(`${a.symbol} · ${CHAINS[a.chainId!].name} · ${a.token} · paid ${a.payment ? `${a.payment.symbol} tx ${a.payment.txHash}` : "no"}`);
  console.log(`contact: ${a.contact?.kind} ${a.contact?.value} · vibe: ${a.vibe}`);
  console.log(`
# 1. Registry entry (pending: not on air until it is heard; the paid month starts when it goes live, step 3):
npx tsx bot/scripts/station-add.ts --chain ${a.chainId} --token ${a.token}${pool} --key ${key}
#    the dry run above prints the entry; then the same with --write

# 2. The sound: the swarm's style pack (${a.genres?.length ? "the applicant's genres" : "no genres picked: liquid,acid by default"})
npx tsx bot/scripts/swarm-style.ts check --key ${key} --genres ${genres} --brief ${brief}
npx tsx bot/scripts/swarm-style.ts order --key ${key} --genres ${genres} --brief ${brief}
npx tsx bot/scripts/swarm-style.ts fetch --key ${key}

# 3. After listening at theidm.fun/?net=${key}: on air, paidUntil = now + 1 month (the included first month)
npx tsx bot/scripts/station-add.ts --set-status ${key} live --write`);
  a.approvedAt = new Date(now).toISOString();
  store.save(a);
} else {
  console.error(usage);
  process.exit(2);
}
