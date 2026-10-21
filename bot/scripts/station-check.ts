// Station eligibility check (docs/STATIONS.md, Flow step 2): market cap, holders, pool liquidity, token age and a
// simulated sell, from free public APIs (bot/src/stations/sources.ts), judged by the rules in
// bot/src/stations/eligibility.ts. Read-only: no keys, no transactions.
//
//   npx tsx bot/scripts/station-check.ts --chain 1 --pool 0x4158…a704 [--token 0x…] [--json]
//
// --pool is a v4 poolId (32 bytes) or a v2/v3 pair address; without --token the pair's base token is checked.
// Exit code: 0 pass, 1 fail, 2 data unavailable (a rule could not be measured, or the pool could not be resolved).
import { evaluate, exitCode, formatReport } from "../src/stations/eligibility.ts";
import { measure } from "../src/stations/sources.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const json = process.argv.includes("--json");
const chainId = Number(arg("chain"));
const pool = arg("pool");
const token = arg("token");

if (!Number.isInteger(chainId) || !pool || !/^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(pool) || (token && !/^0x[0-9a-fA-F]{40}$/.test(token))) {
  console.error("usage: station-check.ts --chain <chainId> --pool <poolId|pairAddress> [--token 0x..] [--json]");
  process.exit(2);
}

try {
  const report = evaluate(await measure(chainId, pool, token), Math.floor(Date.now() / 1000));
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(exitCode(report));
} catch (e) {
  const reason = `could not resolve the pool: ${(e as Error)?.message ?? e}`;
  console.log(json ? JSON.stringify({ chainId, pool, verdict: "unavailable", manualReviewAllowed: false, rules: [], reasons: [reason] }, null, 2) : `verdict: UNAVAILABLE\n  - ${reason}`);
  process.exit(2);
}
