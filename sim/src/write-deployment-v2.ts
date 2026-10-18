// Builds contracts/deployments/sepolia-v2.json (IDM/ETH v2 rehearsal) from the forge broadcast of
// script/DeploySepolia.s.sol. The v1 IMD-quoted record in sepolia.json stays untouched.
//   npm run write-deployment-v2        (after the broadcast; reads the hook's poolId/factory over RPC)
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http } from "viem";
import { sepolia } from "viem/chains";
import { ETH_THRESHOLDS, WHALE_C, WHALE_K, WHALE_MAX_WEI, WHALE_MIN_WEI } from "@swarm-sequencer/core";
import { CONTRACTS, deploymentPath, loadEnv } from "./env.ts";
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
const ETH = "0x0000000000000000000000000000000000000000";
const MANAGER = getAddress("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");
const poolId = await client.readContract({ address: hook, abi: hookAbi, functionName: "poolId" });
const factory = await client.readContract({ address: hook, abi: hookAbi, functionName: "factory" });
const blocks = receipts.map((r) => Number(BigInt(r.blockNumber)));
const label = (t: any) => (t.transactionType.startsWith("CREATE") ? `create:${t.contractName}` : `${t.contractName ?? t.transaction.to}:${t.function ?? "call"}`);
const gas = receipts.reduce((n, r) => n + BigInt(r.gasUsed), 0n);
const cost = receipts.reduce((n, r) => n + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice ?? 0), 0n);

const out = {
  chainId: 11155111,
  network: "sepolia",
  rules: "v2",
  explorer: "https://sepolia.etherscan.io",
  poolManager: MANAGER,
  token,
  tokenSymbol: "IDM",
  hook,
  hookFlags: "0x3040",
  router,
  quote: ETH,
  quoteSymbol: "ETH",
  deployer: getAddress(env.DEPLOYER_ADDRESS),
  factory,
  poolId,
  poolKey: { currency0: ETH, currency1: token, fee: 12500, tickSpacing: 60, hooks: hook },
  idmIsCurrency0: false,
  // hat/glitch/snare are constructor arguments; the whale threshold scales with FDV (SPEC §3.1), no kick argument.
  thresholds: { hat: ETH_THRESHOLDS.hat.toString(), glitch: ETH_THRESHOLDS.glitch.toString(), snare: ETH_THRESHOLDS.snare.toString() },
  whale: { rule: "K * sqrt(FDV wei) from the post-swap tick, clamped", k: WHALE_K.toString(), c: WHALE_C.toString(), min: WHALE_MIN_WEI.toString(), max: WHALE_MAX_WEI.toString() },
  openingPrice: "1 IDM = 0.000000004 ETH (250,000,000 IDM per ETH, FDV 4 ETH, whale ~0.04 ETH)",
  liquidity: { range: "full (-887220..887220)", liquidity: "15811388300841896659994", approx: "1 ETH + 250,000,000 IDM" },
  startBlock: Math.min(...blocks),
  deployGas: gas.toString(),
  deployCostWei: cost.toString(),
  txs: txs.map((t, i) => ({ step: label(t), hash: t.hash, block: blocks[i] })),
  verification: Object.fromEntries(
    [["SequencerToken", token], ["SequencerHook", hook], ["SimRouter", router]].map(([n, a]) => [
      n,
      { sourcify: `https://repo.sourcify.dev/11155111/${a}`, etherscan: `https://sepolia.etherscan.io/address/${a}#code` },
    ]),
  ),
  generatedAt: new Date().toISOString(),
};
writeFileSync(deploymentPath("v2"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
