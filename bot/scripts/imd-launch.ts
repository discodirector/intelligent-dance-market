// Pays for and submits the IMD launch.open request (swarm/BRIEF.md "Launch request shape") from the payer's own
// terminal. Follows the reference client in https://imd.fun/docs: free check -> quote -> 402 challenge -> Permit2
// payment + EIP-712 quote approval -> submit -> poll until admitted.
//
// The payment flow is bot/src/imd/paid.ts. The payer key is read from a hidden prompt (or IMD_PAYER_KEY) and never
// printed. Nothing is signed or sent before an explicit confirmation: one for the Permit2 approve (if the allowance is
// short), one typed "pay" for the payment.
// The request token and order id are kept in bot/.imd-launch.json (gitignored), so a rerun resumes the same order
// instead of paying twice.
//
//   npx tsx bot/scripts/imd-launch.ts --check                       free check only, no key
//   npx tsx bot/scripts/imd-launch.ts [--payer 0x...] [--repo https://github.com/o/r --commit <sha>]
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRequest, newPaidState, payAndSubmit, pollOrder, printCheck, type PaidState } from "../src/imd/paid.ts";

const ACTION = "launch.open";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STATE = join(ROOT, "bot/.imd-launch.json");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PAYER = (arg("payer") ?? "0x9eF17A987CB4a2355Ec2782785d79d3Db4B5fA8A").toLowerCase();

/** The launch body: the JSON block under "## Launch request shape" in swarm/BRIEF.md, plus an optional imported repo. */
function launchInput() {
  const brief = readFileSync(join(ROOT, "swarm/BRIEF.md"), "utf8");
  const m = /## Launch request shape[\s\S]*?```json\n([\s\S]*?)```/.exec(brief);
  if (!m) throw new Error("no launch request block in swarm/BRIEF.md");
  const input = JSON.parse(m[1]);
  const repo = arg("repo"), commit = arg("commit");
  if (repo || commit) {
    if (!repo || !commit) throw new Error("--repo and --commit go together");
    Object.assign(input, { repoUrl: repo, baseCommit: commit });
  }
  return input;
}

async function main() {
  const input = launchInput();
  console.log(`launch.open: ${input.onchain} on chain ${input.chainId}, pairWith ${input.pairWith}, economics ${JSON.stringify(input.economics)}${input.repoUrl ? `, repo ${input.repoUrl}@${input.baseCommit}` : ""}`);

  const blockers = printCheck(await checkRequest(ACTION, input));
  if (blockers) process.exit(1);
  if (process.argv.includes("--check")) return;

  // Resume an earlier order when there is one (payAndSubmit quotes a new one otherwise).
  const state: PaidState = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : newPaidState();
  const save = (s: PaidState) => { writeFileSync(STATE, JSON.stringify(s, null, 2)); chmodSync(STATE, 0o600); };
  const order = await payAndSubmit({ action: ACTION, input, payer: PAYER, state, save, what: "the launch" });
  if (order) await pollOrder(order.orderId, order.token);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
