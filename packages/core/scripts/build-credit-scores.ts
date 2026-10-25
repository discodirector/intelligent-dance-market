// Builds packages/core/data/credit-scores.bin.gz (src/credittable.ts, format CRS1): every Credit's score percentile,
// CMYK plates and score, from the chain. Read-only RPC calls only.
//
//   npx tsx packages/core/scripts/build-credit-scores.ts [--rpc URL] [--logs cache.json] [--check 24]
//
// 1. Credits.Distributed(tokenId, to, seed, paidAt) over the whole distribution (eth_getLogs, adaptive chunks: the
//    Tenderly gateway answers at most 20,000 logs, so a refused range is split in two).
// 2. Each Credit's score through the CreditScore port (credit-score.ts), the plates from paidAt % 15 + 1.
// 3. Checks: Credit #1 = 1,324,012; `--check` random Credits against eth_call CreditScore.scoreOf(seed, paidAt) and
//    Credits.seedOf / timestampOf (the logs are the stored values). Any mismatch: exit 1, nothing written.
// 4. The table (plates, score in tenths) written gzipped; the percentile is ranked when it is read (credittable.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { encodeCreditTable, parseCreditTable } from "../src/credittable.ts";
import { scoreOf } from "./credit-score.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const RPC = arg("--rpc") ?? "https://mainnet.gateway.tenderly.co";
const CACHE = arg("--logs");
const CHECKS = Number(arg("--check") ?? 24);
const OUT = resolve(here, "../data/credit-scores.bin.gz");

/** Credits (ERC-721) and the pure CreditScore Statements.score() names. */
export const CREDITS = "0x97630aA70AB14ed9883B41dAfccBc11349723043";
export const CREDIT_SCORE = "0x817a9cffb4d6e7c206e745a4229001a472c1b7b7";
/** Credits' deployment block (first block with code). */
const DEPLOY = 26_037_292;
/** keccak256("Distributed(uint256,address,bytes21,uint64)"). */
const DISTRIBUTED = "0xd531eb90fd214f28c84ac8e9b86c5b3cbb798ceceb98046d1de96857d283cd0c";

async function rpc(method: string, params: unknown[]): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j: any = await r.json();
      if (j.error) throw Object.assign(new Error(JSON.stringify(j.error)), { rpc: j.error });
      return j.result;
    } catch (e: any) {
      if (e.rpc || attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
    }
  }
}
const hex = (n: number) => "0x" + n.toString(16);

interface Dist {
  id: number;
  seed: string;
  paidAt: string;
  block: number;
}

/** Every Distributed log in [from, to], halving a range the gateway refuses. */
async function distributed(from: number, to: number, out: Dist[]) {
  try {
    const logs: any[] = await rpc("eth_getLogs", [{ address: CREDITS, topics: [DISTRIBUTED], fromBlock: hex(from), toBlock: hex(to) }]);
    for (const l of logs) {
      const d = l.data.slice(2);
      out.push({ id: Number(BigInt(l.topics[1])), seed: "0x" + d.slice(0, 42), paidAt: BigInt("0x" + d.slice(64, 128)).toString(), block: parseInt(l.blockNumber, 16) });
    }
    if (logs.length) console.error(`  ${from}..${to}: ${logs.length} (total ${out.length})`);
  } catch (e: any) {
    if (!e.rpc || from === to) throw e;
    const mid = Math.floor((from + to) / 2);
    await distributed(from, mid, out);
    await distributed(mid + 1, to, out);
  }
}

const bytesOf = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

async function main() {
  let dist: Dist[];
  if (CACHE && existsSync(CACHE)) dist = JSON.parse(readFileSync(CACHE, "utf8"));
  else {
    const head = parseInt(await rpc("eth_blockNumber", []), 16);
    dist = [];
    // Windows of 50k blocks, each split further when refused.
    for (let b = DEPLOY; b <= head; b += 50_000) await distributed(b, Math.min(head, b + 49_999), dist);
    if (CACHE) writeFileSync(CACHE, JSON.stringify(dist));
  }
  const byId = new Map<number, Dist>();
  for (const d of dist) {
    if (byId.has(d.id)) throw new Error(`Credit #${d.id} distributed twice`);
    byId.set(d.id, d);
  }
  const ids = [...byId.keys()].sort((a, b) => a - b);
  const firstId = ids[0];
  const count = ids[ids.length - 1] - firstId + 1;
  console.error(`${byId.size} Credits distributed, ids ${firstId}..${ids[ids.length - 1]} (${count - byId.size} gaps)`);

  const scores = new Map<number, { score: number; mask: number }>();
  for (const id of ids) {
    const d = byId.get(id)!;
    scores.set(id, scoreOf(bytesOf(d.seed), BigInt(d.paidAt)));
  }

  // Checks against the chain.
  const one = scores.get(1);
  if (!one || one.score !== 1_324_012) throw new Error(`Credit #1 scores ${one?.score}, the contract says 1,324,012`);
  let seed = 0x5eed;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const pick = new Set<number>([1, ids[ids.length - 1]]);
  while (pick.size < CHECKS) pick.add(ids[Math.floor(rand() * ids.length)]);
  for (const id of pick) {
    const d = byId.get(id)!;
    const word = (n: bigint) => n.toString(16).padStart(64, "0");
    const seedWord = d.seed.slice(2).padEnd(64, "0");
    const onchain = BigInt(await rpc("eth_call", [{ to: CREDIT_SCORE, data: "0x8c08f632" + seedWord + word(BigInt(d.paidAt)) }, "latest"]));
    const storedSeed = (await rpc("eth_call", [{ to: CREDITS, data: "0x82829f74" + word(BigInt(id)) }, "latest"])).slice(0, 44);
    const storedTs = BigInt(await rpc("eth_call", [{ to: CREDITS, data: "0x2d9c77e1" + word(BigInt(id)) }, "latest"]));
    const mine = scores.get(id)!.score;
    const ok = Number(onchain) === mine && storedSeed.toLowerCase() === d.seed.toLowerCase() && storedTs === BigInt(d.paidAt);
    console.error(`  check #${id}: port ${mine}, scoreOf ${onchain}, seed ${storedSeed === d.seed ? "=" : "!="}, paidAt ${storedTs === BigInt(d.paidAt) ? "=" : "!="} ${ok ? "OK" : "MISMATCH"}`);
    if (!ok) throw new Error(`Credit #${id}: mismatch`);
  }

  // The table: plates and the score in tenths (truncated: 132.4012 -> 1324); the percentile is ranked at parse time.
  const rows = Array.from({ length: count }, (_, i) => {
    const s = scores.get(firstId + i);
    return s ? { mask: s.mask, score: Math.floor(s.score / 1000) } : { mask: 0, score: 0 };
  });
  const raw = encodeCreditTable(firstId, rows);
  const gz = gzipSync(raw, { level: 9 });
  const back = parseCreditTable(raw);
  // The exact-score percentile, for comparison with the table's (tenths: ties inside a tenth share a place).
  const sorted = ids.map((id) => scores.get(id)!.score).sort((x, y) => x - y);
  const below = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] < v) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const N = sorted.length;
  let off = 0;
  for (const id of ids) {
    const exact = Math.min(255, Math.floor((256 * below(scores.get(id)!.score)) / N));
    if (back.get(id)!.pct !== exact) off++;
  }
  const r1 = back.get(1)!;
  console.error(`Credit #1: score ${r1.score / 10}, pct ${r1.pct}, plates mask ${r1.mask}, rank ${N - below(one.score + 1) + 1}..${N - below(one.score)} of ${N} from the top`);
  const top = ids.filter((id) => back.get(id)!.pct >= 243).length;
  console.error(`pct differs from the exact-score rank on ${off} Credits; pct >= 243 (top ~5%): ${top}; table ${raw.length} bytes, gzipped ${gz.length}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gz);
  console.error(`wrote ${OUT}`);
}

await main();
