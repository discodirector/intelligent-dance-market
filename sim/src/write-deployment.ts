// Builds contracts/deployments/sepolia.json (v1, IMD-quoted rehearsal) from a forge broadcast. The current
// script/DeploySepolia.s.sol deploys the v2 IDM/ETH pair: use write-deployment-v2.ts for it.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, getAddress } from "viem";
import { sepolia } from "viem/chains";
import { CONTRACTS, loadEnv } from "./env.ts";
import { hookAbi } from "./abi.ts";

const env = loadEnv();
const run = JSON.parse(readFileSync(CONTRACTS + "broadcast/DeploySepolia.s.sol/11155111/run-latest.json", "utf8"));
const client = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });

const txs = run.transactions as any[];
const receipts = run.receipts as any[];
const created = (name: string) => getAddress(txs.find((t) => t.transactionType.startsWith("CREATE") && t.contractName === name).contractAddress);
const token = created("SequencerToken");
const hook = created("SequencerHook");
const router = created("SimRouter");
const IMD = getAddress("0x44a1cd38474fb1748400e7deb5f8d786cce3f89a");
const MANAGER = getAddress("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");
const poolId = await client.readContract({ address: hook, abi: hookAbi, functionName: "poolId" });
const factory = await client.readContract({ address: hook, abi: hookAbi, functionName: "factory" });
const idmIs0 = BigInt(token) < BigInt(IMD);
const blocks = receipts.map((r) => Number(BigInt(r.blockNumber)));
const label = (t: any) => (t.transactionType.startsWith("CREATE") ? `create:${t.contractName}` : `${t.contractName ?? t.transaction.to}:${t.function ?? "call"}`);

const out = {
  chainId: 11155111,
  network: "sepolia",
  explorer: "https://sepolia.etherscan.io",
  poolManager: MANAGER,
  token,
  tokenSymbol: "IDM",
  hook,
  hookFlags: "0x3040",
  router,
  imd: IMD,
  deployer: getAddress(env.DEPLOYER_ADDRESS),
  factory,
  poolId,
  poolKey: { currency0: idmIs0 ? token : IMD, currency1: idmIs0 ? IMD : token, fee: 12500, tickSpacing: 60, hooks: hook },
  idmIsCurrency0: idmIs0,
  thresholds: { hat: "500000000000000000", glitch: "5000000000000000000", snare: "25000000000000000000", kick: "100000000000000000000" },
  openingPrice: "1 IDM = 0.001 IMD",
  liquidity: { range: "full (-887220..887220)", liquidity: "3162277660168379331998893", approx: "100,000 IMD + 100,000,000 IDM" },
  startBlock: Math.min(...blocks),
  txs: txs.map((t, i) => ({ step: label(t), hash: t.hash, block: blocks[i] })),
  verification: Object.fromEntries(
    [["SequencerToken", token], ["SequencerHook", hook], ["SimRouter", router]].map(([n, a]) => [
      n,
      { sourcify: `https://repo.sourcify.dev/11155111/${a}`, etherscan: `https://sepolia.etherscan.io/address/${a}#code` },
    ]),
  ),
  generatedAt: new Date().toISOString(),
};
// Keep the deployment being replaced under "previous" (one level; its own history is dropped).
const target = CONTRACTS + "deployments/sepolia.json";
let previous: unknown = undefined;
if (existsSync(target)) {
  const old = JSON.parse(readFileSync(target, "utf8"));
  if (old.hook && old.hook.toLowerCase() !== hook.toLowerCase()) {
    delete old.previous;
    previous = { ...old, supersededAt: new Date().toISOString(), note: "pre-drop/fill hook (no Drop event)" };
  } else previous = old.previous;
}
mkdirSync(CONTRACTS + "deployments", { recursive: true });
writeFileSync(target, JSON.stringify(previous ? { ...out, previous } : out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
