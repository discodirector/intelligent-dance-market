// IMD pools on Ethereum mainnet Uniswap v4 (found via PoolManager Initialize logs, 2026-10-15).
export const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90" as const;
export const IMD_TOKEN = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" as const;
export const V4_DEPLOY_BLOCK = 21688329n;

/** Main IMD/ETH market: POOL4 CappedBurnHook 0xc6C965Bd164c483e87d0B550671798e9A3602840, fee 1%, tickSpacing 60. */
export const MAIN_POOL_ID = "0x415829f72e9f54531c26eae76f107618540e898a45d6ae35959e143f5faca704" as const;

export interface PoolKeyInfo {
  id: `0x${string}`;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  block: bigint;
}
