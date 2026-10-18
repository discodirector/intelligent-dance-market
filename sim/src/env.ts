// Loads contracts/deployments/sepolia.json (v1, IMD-quoted) or sepolia-v2.json (v2, native ETH) and the throwaway
// key from contracts/.env.sepolia (never logged).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CONTRACTS = fileURLToPath(new URL("../../contracts/", import.meta.url));

export function loadEnv(path = CONTRACTS + ".env.sepolia"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export interface Deployment {
  chainId: number;
  poolManager: `0x${string}`;
  token: `0x${string}`;
  hook: `0x${string}`;
  router: `0x${string}`;
  /** v1 record: the IMD test token the pool is quoted in. */
  imd?: `0x${string}`;
  /** v2 record: the quote currency (0x0 = native ETH). */
  quote?: `0x${string}`;
  quoteSymbol?: "ETH" | "IMD";
  /** v2 record: hook rules ("v2"); absent = v1. */
  rules?: "v1" | "v2";
  deployer: `0x${string}`;
  poolId: `0x${string}`;
  poolKey: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` };
  startBlock: number;
  /** v1: all four; v2: hat/glitch/snare only (the whale threshold scales with FDV). */
  thresholds: { hat: string; glitch: string; snare: string; kick?: string };
}

export type Net = "v1" | "v2";
export const deploymentPath = (net: Net) => CONTRACTS + (net === "v2" ? "deployments/sepolia-v2.json" : "deployments/sepolia.json");

export function loadDeployment(net: Net = "v1"): Deployment {
  const d = JSON.parse(readFileSync(deploymentPath(net), "utf8")) as Deployment;
  if (!d.hook) throw new Error(`${deploymentPath(net)} has no hook yet: deploy first (contracts/SEPOLIA-V2.md)`);
  return d;
}
