// Station applications and payment (docs/STATIONS.md "Applications and payment"): every price, every accepted
// stablecoin and every limit in one place. Owner-approved prices: launch now, regular later
// (STATION_PRICE_TIER=regular). The IMD part of the setup pays the swarm and is priced at the order time.

export type Tier = "launch" | "regular";
export interface Prices {
  /** Setup, once: a service fee in USD plus the swarm's cost in IMD (first month included). */
  setupUsd: number;
  setupImd: number;
  /** Renewals: one month or three. */
  monthUsd: number;
  threeMonthsUsd: number;
}
export const PRICES: Record<Tier, Prices> = {
  launch: { setupUsd: 50, setupImd: 1.5, monthUsd: 30, threeMonthsUsd: 75 },
  regular: { setupUsd: 100, setupImd: 3, monthUsd: 50, threeMonthsUsd: 125 },
};

/** The IMD token (Ethereum): its USD price converts the setup's IMD part (DexScreener, deepest pair). */
export const IMD_TOKEN = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";

export interface Stable {
  chainId: number;
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  note?: string;
}

/**
 * Accepted stablecoins, each read on chain 2026-10-22 (symbol, name, decimals, totalSupply, code):
 *   Ethereum  USDC 0xA0b8…eB48 "USD Coin" 6 · USDT 0xdAC1…1ec7 "Tether USD" 6
 *   Base      USDC 0x8335…2913 "USD Coin" 6 (native, Circle) only; the bridged "Tether USD" 0xfde4…9bb2 is left out.
 *   Arbitrum  USDC 0xaf88…5831 "USD Coin" 6 (native, Circle) · USDT0 0xFd08…Cbb9 "USD₮0" 6 (Tether's OFT, the old
 *             Arbitrum USDT); bridged USDC.e 0xFF97…5CC8 is left out.
 *   Monad     USDC 0x7547…b603 "USDC" 6 (Circle's FiatToken proxy, ~$225M supply).
 *   Robinhood USDG 0x5fc5…d168 "Global Dollar" 6 (Paxos, ERC1967 proxy, ~$715M supply; read 2026-10-22). No USDC or
 *             USDT: the only "USDC" listed there (0x11D0…991e) is a meme token ("UpSideDownCat on robinhood", 18
 *             decimals, 1e9 supply).
 */
export const STABLES: Stable[] = [
  { chainId: 1, symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  { chainId: 1, symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  { chainId: 8453, symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { chainId: 42161, symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
  { chainId: 42161, symbol: "USDT0", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
  { chainId: 143, symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
  { chainId: 4663, symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
];

/** Chains payments are accepted on, with the confirmations a payment needs (~1-2 minutes each). */
export const PAY_CHAINS: Record<number, { name: string; confirmations: number }> = {
  1: { name: "Ethereum", confirmations: 6 },
  8453: { name: "Base", confirmations: 30 },
  42161: { name: "Arbitrum", confirmations: 120 },
  143: { name: "Monad", confirmations: 300 }, // ~0.3 s blocks
  4663: { name: "Robinhood Chain", confirmations: 900 }, // ~0.103 s blocks (measured over 10k blocks 2026-10-22)
};

/** The genres a pack can restyle (synth styledata.ts DATA_GENRES; test/api.test.ts keeps them equal). */
export const DATA_GENRES = ["liquid", "futuregarage", "triphop", "lofihouse", "acid", "dubtechno", "electro", "ambientidm", "drone"] as const;

export const LIMITS = {
  /** A quote holds this long; a payment mined up to `graceMs` later is still accepted. */
  quoteTtlMs: 30 * 60_000,
  graceMs: 15 * 60_000,
  /** A payment mined this long before its quote existed belongs to something else. */
  clockSkewMs: 2 * 60_000,
  /** Eligibility reports are cached per token. */
  checkCacheMs: 10 * 60_000,
  /** A failed or timed-out check is retried no sooner than this. */
  checkErrorCacheMs: 60_000,
  checkTimeoutMs: 90_000,
  imdPriceCacheMs: 5 * 60_000,
  bodyBytes: 8 * 1024,
  vibeChars: 300,
} as const;

/** Requests per IP per window, by route group. */
export const RATE_LIMITS = {
  all: { max: 120, windowMs: 60_000 },
  check: { max: 12, windowMs: 60_000 },
  quote: { max: 6, windowMs: 10 * 60_000 },
  pay: { max: 30, windowMs: 60_000 },
} as const;
export type RateBucket = keyof typeof RATE_LIMITS;

export interface ApiConfig {
  /** Receiving address; unset = applications not open (503). */
  payTo: `0x${string}` | null;
  /** STATIONS_OPEN=1: new applications and renewals are taken (payments and status always answer). */
  open: boolean;
  tier: Tier;
  /** Browser origins allowed by CORS (the site itself is same-origin behind Caddy). */
  origins: string[];
  /** Behind the host's reverse proxy: the client is the last X-Forwarded-For hop. */
  trustProxy: boolean;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const pay = env.STATION_PAY_TO?.trim();
  if (pay && !/^0x[0-9a-fA-F]{40}$/.test(pay)) throw new Error(`STATION_PAY_TO: not an address: ${pay}`);
  return {
    payTo: pay ? (pay.toLowerCase() as `0x${string}`) : null,
    open: env.STATIONS_OPEN === "1",
    tier: env.STATION_PRICE_TIER === "regular" ? "regular" : "launch",
    origins: (env.API_ORIGINS ?? "https://theidm.fun").split(",").map((s) => s.trim()).filter(Boolean),
    trustProxy: env.API_TRUST_PROXY !== "0",
  };
}
