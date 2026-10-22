// Quotes (docs/STATIONS.md "Applications and payment"): what an application or a renewal costs in USD and in each
// accepted stablecoin's units. Pure. Every amount carries a tag: the total in cents plus 0.00xyz (xyz = 1..999), unique
// among the open quotes, so a payment's exact value names its application and a mix-up of tx hashes cannot credit the
// wrong one (payments.ts). The tx hash still decides; the tag is the second key.
import { STABLES, type Prices, type Stable } from "./config.ts";

export type Plan = { kind: "setup" } | { kind: "renew"; months: 1 | 3 };

export interface UsdBreakdown {
  /** Service fee (setup) or the renewal price, USD. */
  feeUsd: number;
  /** Setup only: the swarm's cost in IMD, its USD price at the order time and the product (cents, rounded up). */
  imd?: { amount: number; priceUsd: number; usd: number };
  /** fee + IMD part, whole cents (rounded up). */
  totalCents: number;
}

export interface StableAmount {
  chainId: number;
  symbol: string;
  token: `0x${string}`;
  decimals: number;
  /** Base units, decimal string: totalCents and the tag. */
  amount: string;
  /** The same as a decimal number of tokens, exact, e.g. "81.37123". */
  display: string;
}

export interface Quote {
  plan: Plan;
  usd: UsdBreakdown;
  /** 1..999: the 0.00xyz added to the total. */
  tag: number;
  amounts: StableAmount[];
}

export const TAG_MAX = 999;

/** Cents of a USD value, rounded up (a float price never undercharges by a rounding). */
const centsUp = (usd: number) => Math.ceil(Math.round(usd * 1e6) / 1e4);

export function usdFor(plan: Plan, prices: Prices, imdUsd?: number): UsdBreakdown {
  if (plan.kind === "renew") {
    const fee = plan.months === 3 ? prices.threeMonthsUsd : prices.monthUsd;
    return { feeUsd: fee, totalCents: centsUp(fee) };
  }
  if (!(imdUsd !== undefined && Number.isFinite(imdUsd) && imdUsd > 0)) throw new Error("setup: no IMD price");
  const imdCents = centsUp(prices.setupImd * imdUsd);
  return {
    feeUsd: prices.setupUsd,
    imd: { amount: prices.setupImd, priceUsd: imdUsd, usd: imdCents / 100 },
    totalCents: centsUp(prices.setupUsd) + imdCents,
  };
}

/** totalCents + tag x 0.00001 USD in a token of `decimals` (>= 5) units. */
export function tagged(totalCents: number, tag: number, decimals: number): bigint {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error(`totalCents: ${totalCents}`);
  if (!Number.isInteger(tag) || tag < 1 || tag > TAG_MAX) throw new Error(`tag: ${tag}`);
  if (decimals < 5) throw new Error(`decimals ${decimals}: the tag needs 5`);
  return BigInt(totalCents) * 10n ** BigInt(decimals - 2) + BigInt(tag) * 10n ** BigInt(decimals - 5);
}

/** Base units as an exact decimal string, trailing zeros trimmed ("81370000" at 6 -> "81.37"). */
export function formatUnits(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** A tag no open quote holds (`rand` in [0, 1)); null when all 999 are taken. */
export function pickTag(taken: Iterable<number>, rand: () => number = Math.random): number | null {
  const used = new Set(taken);
  const free: number[] = [];
  for (let t = 1; t <= TAG_MAX; t++) if (!used.has(t)) free.push(t);
  return free.length ? free[Math.floor(rand() * free.length)] : null;
}

export function quoteFor(plan: Plan, prices: Prices, tag: number, imdUsd?: number, stables: Stable[] = STABLES): Quote {
  const usd = usdFor(plan, prices, imdUsd);
  return {
    plan, usd, tag,
    amounts: stables.map((s) => {
      const v = tagged(usd.totalCents, tag, s.decimals);
      return { chainId: s.chainId, symbol: s.symbol, token: s.address, decimals: s.decimals, amount: v.toString(), display: formatUnits(v, s.decimals) };
    }),
  };
}
