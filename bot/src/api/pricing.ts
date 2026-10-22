// Quotes (docs/STATIONS.md "Applications and payment"): what an application or a renewal costs in USD and in each
// accepted stablecoin's units. Pure. Every amount carries a tag: the total in cents plus 0.00xyz (xyz = 1..999), unique
// among the open quotes, so a payment's exact value names its application and a mix-up of tx hashes cannot credit the
// wrong one (payments.ts). The tx hash still decides; the tag is the second key.
import { STABLES, type Prices, type Stable } from "./config.ts";

/**
 * What is bought. `plus`: Station+ (docs/STATIONS.md "Station+"). A setup with plus pays the first month's difference
 * on top; a Station+ renewal of a station whose Station+ ends before its paid end also pays those `upgradeDays`
 * (prorated, below); an upgrade pays only the prorated difference for `days`.
 */
export type Plan =
  | { kind: "setup"; plus?: boolean }
  | { kind: "renew"; months: 1 | 3; plus?: boolean; upgradeDays?: number }
  | { kind: "upgrade"; days: number };

export interface UsdBreakdown {
  /** Service fee (setup), the renewal price, or the upgrade's prorated difference, USD. */
  feeUsd: number;
  /** Setup only: the swarm's cost in IMD, its USD price at the order time and the product (cents, rounded up). */
  imd?: { amount: number; priceUsd: number; usd: number };
  /** Setup as Station+: the first month's difference (plusMonthUsd - monthUsd). */
  plusUsd?: number;
  /** Station+ for the rest of a paid period: whole days at (plusMonthUsd - monthUsd) / 30 a day, cents rounded up. */
  upgrade?: { days: number; usd: number };
  /** Every part, whole cents (each rounded up). */
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

/** Days in the month the upgrade's day rate divides by. */
export const PRORATE_DAYS = 30;

/** Station+ for `days` of a period already paid as Station: (plusMonthUsd - monthUsd) x days / 30, cents rounded up. */
export function upgradeUsd(days: number, prices: Prices): number {
  if (!Number.isInteger(days) || days < 1) throw new Error(`upgrade days: ${days}`);
  return centsUp(((prices.plusMonthUsd - prices.monthUsd) * days) / PRORATE_DAYS) / 100;
}

export function usdFor(plan: Plan, prices: Prices, imdUsd?: number): UsdBreakdown {
  if (plan.kind === "upgrade") {
    const usd = upgradeUsd(plan.days, prices);
    return { feeUsd: usd, upgrade: { days: plan.days, usd }, totalCents: centsUp(usd) };
  }
  if (plan.kind === "renew") {
    const fee = plan.plus
      ? (plan.months === 3 ? prices.plusThreeMonthsUsd : prices.plusMonthUsd)
      : (plan.months === 3 ? prices.threeMonthsUsd : prices.monthUsd);
    const up = plan.plus && plan.upgradeDays ? { days: plan.upgradeDays, usd: upgradeUsd(plan.upgradeDays, prices) } : undefined;
    return { feeUsd: fee, ...(up ? { upgrade: up } : {}), totalCents: centsUp(fee) + (up ? centsUp(up.usd) : 0) };
  }
  if (!(imdUsd !== undefined && Number.isFinite(imdUsd) && imdUsd > 0)) throw new Error("setup: no IMD price");
  const imdCents = centsUp(prices.setupImd * imdUsd);
  const plusUsd = plan.plus ? prices.plusMonthUsd - prices.monthUsd : 0;
  return {
    feeUsd: prices.setupUsd,
    imd: { amount: prices.setupImd, priceUsd: imdUsd, usd: imdCents / 100 },
    ...(plan.plus ? { plusUsd } : {}),
    totalCents: centsUp(prices.setupUsd) + imdCents + centsUp(plusUsd),
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
