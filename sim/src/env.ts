// Loads contracts/deployments/sepolia.json and the throwaway key from contracts/.env.sepolia (never logged).
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
  imd: `0x${string}`;
  deployer: `0x${string}`;
  poolId: `0x${string}`;
  poolKey: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` };
  startBlock: number;
  thresholds: { hat: string; glitch: string; snare: string; kick: string };
}

export function loadDeployment(path = CONTRACTS + "deployments/sepolia.json"): Deployment {
  return JSON.parse(readFileSync(path, "utf8"));
}
