// Station onboarding (docs/STATIONS.md "Onboarding"): one command from a token to its stations/registry.json entry.
// Resolves the main pool and its kind, runs the eligibility check, computes the calibration, picks a short genesis,
// a key and an LCD theme, and prints the entry and the registry diff. --write inserts it (status "pending": not on
// air until the owner listens and sets it live) and runs site/scripts/check-stations.mjs. Read-only otherwise: no keys.
//
//   npx tsx bot/scripts/station-add.ts --chain 1 --token 0x6982…1933
//   npx tsx bot/scripts/station-add.ts --chain 143 --token 0x3500…7777 --allow-manual --theme amber
//   npx tsx bot/scripts/station-add.ts --chain 1 --token 0xd34a…63b7 --supply 7091972 --key imd-calibrated
//   npx tsx bot/scripts/station-add.ts --set-status <key> live|paused|pending [--write]   (live, non-house, no paidUntil
//                                         yet: paidUntil = now + 1 month, the included first month)
//   npx tsx bot/scripts/station-add.ts --set-paid-until <key> 2026-12-31 [--write]
//
// --pool 0x.. (pair) | --pool-id 0x.. (v4): the pool; default the deepest ETH / WETH / native / WMON pair on
// DexScreener whose kind the chain confirms. --kind overrides the detected kind of a pair. --supply: total tokens
// across chains (a bridged token: its supply on this chain is only a part). --theme: a preset or #rrggbb (default:
// the first preset no station uses). --days N (default 7) or --genesis <block>: where the replay starts.
// --allow-manual: accept an "unavailable" eligibility verdict whose gaps all allow the owner's review (Monad: no
// sell simulator). --status pending|paused|live (default pending), --paid-until <date>, --program <key> (default idm).
// --write saves only after check-stations accepts the result (else the old file is put back).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POOL_KINDS, type PoolKind } from "@swarm-sequencer/core";
import type { Registry } from "../src/station.ts";
import { evaluate, formatReport } from "../src/stations/eligibility.ts";
import { firstPaidUntil, formatEntry, insertEntry, isPaidUntil, lineDiff, setField, STATUSES, type Hex, type Status } from "../src/stations/onboard.ts";
import { finishEntry, resolvePool, stationContext } from "../src/stations/register.ts";
import { CHAINS, measure } from "../src/stations/sources.ts";

const argv = process.argv.slice(2);
const arg = (name: string, n = 1) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + n] : undefined;
};
const flag = (name: string) => argv.includes(`--${name}`);
function die(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

// --registry <path>: another copy (a scratch file to try --write on); default stations/registry.json.
const REGISTRY = arg("registry") ?? fileURLToPath(new URL("../../stations/registry.json", import.meta.url));
const CHECK = fileURLToPath(new URL("../../site/scripts/check-stations.mjs", import.meta.url));
const write = flag("write");
const before = readFileSync(REGISTRY, "utf8");
const reg = JSON.parse(before) as Registry;

/** Prints the diff; with --write saves and runs check-stations, restoring the old file if the check fails. */
function commit(after: string) {
  console.log(`\nstations/registry.json:\n${lineDiff(before, after)}`);
  if (!write) return console.log("\ndry run: nothing written (--write to apply)");
  writeFileSync(REGISTRY, after);
  const r = spawnSync(process.execPath, [CHECK, REGISTRY], { stdio: "inherit" });
  if (r.status !== 0) {
    writeFileSync(REGISTRY, before);
    die("check-stations refused the edit: registry restored", 1);
  }
  console.log("written");
}

// ---------------------------------------------------------------- status / paidUntil
const setStatus = arg("set-status");
const setPaid = arg("set-paid-until");
if (setStatus || setPaid) {
  const key = (setStatus ?? setPaid)!;
  const value = arg(setStatus ? "set-status" : "set-paid-until", 2);
  if (!reg.stations.some((s) => s.key === key)) die(`no station "${key}" (${reg.stations.map((s) => s.key).join(", ")})`);
  if (setStatus && !STATUSES.includes(value as Status)) die(`--set-status ${key} ${STATUSES.join("|")}`);
  if (setPaid && !isPaidUntil(value)) die(`--set-paid-until ${key} <YYYY-MM-DD | ISO timestamp in UTC>`);
  const entry = reg.stations.find((s) => s.key === key)!;
  if (setStatus && value === "live" && entry.kind !== "hook") {
    console.log(`${key} goes on air: listen first (theidm.fun/?net=${key}).`);
  }
  let after = setField(before, key, setStatus ? "status" : "paidUntil", value!);
  // The included first month starts on air (docs/STATIONS.md "Subscription"): only when no paidUntil is set yet.
  const first = setStatus ? firstPaidUntil(entry, value as Status, Date.now()) : null;
  if (first) {
    after = setField(after, key, "paidUntil", first);
    console.log(`${key}: first month starts now, paidUntil ${first}`);
  }
  commit(after);
  process.exit(0);
}

// ---------------------------------------------------------------- inputs
const chainId = Number(arg("chain"));
const token = arg("token")?.toLowerCase() as Hex | undefined;
const poolArg = (arg("pool") ?? arg("pool-id"))?.toLowerCase() as Hex | undefined;
const kindArg = arg("kind") as PoolKind | undefined;
const usage = "usage: station-add.ts --chain <id> --token 0x.. [--pool 0x..|--pool-id 0x..] [--kind k] [--key slug] [--supply N] [--theme preset|#hex] [--days 7|--genesis block] [--status pending] [--paid-until date] [--allow-manual] [--write]";
if (!reg.chains[String(chainId)] || !CHAINS[chainId]) die(`--chain: one of ${Object.keys(reg.chains).filter((id) => CHAINS[Number(id)]).join(", ")}\n${usage}`);
if (!token || !/^0x[0-9a-f]{40}$/.test(token)) die(`--token: an address\n${usage}`);
if (poolArg && !/^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(poolArg)) die("--pool: a pair address, --pool-id: a v4 pool id");
if (kindArg && !POOL_KINDS.includes(kindArg)) die(`--kind: one of ${POOL_KINDS.join(", ")}`);
const status = (arg("status") ?? "pending") as Status;
if (!STATUSES.includes(status)) die(`--status: ${STATUSES.join("|")}`);
const paidUntil = arg("paid-until");
if (paidUntil !== undefined && !isPaidUntil(paidUntil)) die("--paid-until: YYYY-MM-DD or an ISO timestamp in UTC");

// Pool, calibration, genesis, key and theme: bot/src/stations/register.ts (shared with the pipeline worker).
const fail = (e: unknown): never => die(String((e as Error)?.message ?? e), /^refused/.test(String((e as Error)?.message)) ? 1 : 2);
const ctx = await stationContext(reg, chainId, token).catch(fail);
const picked = await resolvePool(ctx, poolArg, kindArg).catch((e) => (write || !/^refused/.test(String(e?.message)) ? fail(e) : (console.log(`WARNING: ${e.message} (--write refuses a duplicate)`), null)));
if (!picked) process.exit(1);

// ---------------------------------------------------------------- eligibility
console.log("\neligibility:");
let report;
try {
  report = evaluate(await measure(chainId, picked.pool, token), Math.floor(Date.now() / 1000));
} catch (e) {
  die(`eligibility: could not resolve the pool: ${(e as Error)?.message ?? e}`);
}
console.log(formatReport(report));
if (report.verdict === "fail") die("refused: eligibility FAIL", 1);
if (report.verdict === "unavailable") {
  if (!report.manualReviewAllowed) die("refused: eligibility UNAVAILABLE (a rule could not be measured; retry later)", 2);
  if (!flag("allow-manual")) die("refused: eligibility UNAVAILABLE, manual review allowed: listen, check by hand, then rerun with --allow-manual", 2);
  console.log("accepted for the owner's manual review (--allow-manual)");
}

// ---------------------------------------------------------------- calibration, genesis, key, theme
console.log("");
const entry = await finishEntry(ctx, picked, {
  supply: arg("supply"), days: arg("days") ? Number(arg("days")) : undefined, genesis: arg("genesis") ? Number(arg("genesis")) : undefined,
  key: arg("key"), theme: arg("theme"), status, paidUntil, program: arg("program"),
}).catch(fail);
console.log(`\nentry:\n${formatEntry(entry, "")}`);

commit(insertEntry(before, entry));
