// Station eligibility (docs/STATIONS.md, Flow step 2): the rules, the verdict and the parsers of the public APIs the
// numbers come from. Pure: no network here (bot/src/stations/sources.ts fetches, bot/scripts/station-check.ts runs).
// Fail-closed: a rule that could not be measured never passes; it is "unmeasured" and the verdict is "unavailable".

/** Every threshold in one place. */
export const RULES = {
  minMarketCapUsd: 50_000,
  minHolders: 100,
  minLiquidityUsd: 20_000,
  minTokenAgeDays: 7,
  /** A sell that goes through but keeps more than this is a honeypot in all but name. */
  maxSellTaxPct: 10,
} as const;
export type Rules = { [K in keyof typeof RULES]: number };

export type RuleKey = "marketCap" | "holders" | "liquidity" | "tokenAge" | "sell";

/** One measured value: null = could not measure (the note says why). */
export interface Measured<T> {
  value: T | null;
  source: string;
  note?: string;
  /** Unmeasurable for a known, structural reason (e.g. no sell simulator on this chain): the owner may override. */
  manualReviewAllowed?: boolean;
}

/** full = a real buy+sell simulation; false = only part of it (a holder's transfer into the pool), not a sell. */
export interface SellSim { ok: boolean; full: boolean; sellTaxPct: number | null }

export interface Measurements {
  chainId: number;
  pool: string;
  token: string;
  symbol: string | null;
  marketCapUsd: Measured<number>;
  holders: Measured<number>;
  liquidityUsd: Measured<number>;
  /** Unix seconds of the earliest trace of the token (deploy, first transfer, first pool). */
  createdAt: Measured<number>;
  sell: Measured<SellSim>;
}

export type RuleStatus = "pass" | "fail" | "unmeasured";
export interface RuleResult {
  rule: RuleKey;
  status: RuleStatus;
  measured: string;
  threshold: string;
  source: string;
  reason: string | null;
  manualReviewAllowed: boolean;
}

export type Verdict = "pass" | "fail" | "unavailable";
export interface Report {
  chainId: number;
  pool: string;
  token: string;
  symbol: string | null;
  checkedAt: string;
  verdict: Verdict;
  /** Only with verdict "unavailable": every unmeasured rule allows the owner's manual review. */
  manualReviewAllowed: boolean;
  rules: RuleResult[];
  reasons: string[];
}

const usd = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const DAY = 86_400;

function unmeasured(rule: RuleKey, m: Measured<unknown>, threshold: string): RuleResult {
  return {
    rule, status: "unmeasured", measured: "could not measure", threshold, source: m.source,
    reason: `${rule}: could not measure${m.note ? ` (${m.note})` : ""}`, manualReviewAllowed: !!m.manualReviewAllowed,
  };
}

function atLeast(rule: RuleKey, m: Measured<number>, min: number, fmt: (v: number) => string, label: string): RuleResult {
  const threshold = `>= ${fmt(min)}`;
  if (m.value === null || !Number.isFinite(m.value)) return unmeasured(rule, m, threshold);
  const ok = m.value >= min;
  return {
    rule, status: ok ? "pass" : "fail", measured: fmt(m.value), threshold, source: m.source,
    reason: ok ? null : `${label} ${fmt(m.value)} is below ${fmt(min)}`, manualReviewAllowed: false,
  };
}

function sellRule(m: Measured<SellSim>, maxTax: number): RuleResult {
  const threshold = `sell succeeds, tax <= ${maxTax}%`;
  const s = m.value;
  if (s === null) return unmeasured("sell", m, threshold);
  const tax = s.sellTaxPct === null ? "" : `, tax ${s.sellTaxPct}%`;
  if (!s.ok) {
    return { rule: "sell", status: "fail", measured: `sell reverts${tax}`, threshold, source: m.source, reason: `simulated sell fails${m.note ? ` (${m.note})` : ""}`, manualReviewAllowed: false };
  }
  if (!s.full) {
    return {
      rule: "sell", status: "unmeasured", measured: "transfer into the pool succeeds (partial)", threshold, source: m.source,
      reason: `sell: could not measure a full sell${m.note ? ` (${m.note})` : ""}`, manualReviewAllowed: !!m.manualReviewAllowed,
    };
  }
  if (s.sellTaxPct !== null && s.sellTaxPct > maxTax) {
    return { rule: "sell", status: "fail", measured: `sell succeeds${tax}`, threshold, source: m.source, reason: `sell tax ${s.sellTaxPct}% is above ${maxTax}%`, manualReviewAllowed: false };
  }
  return { rule: "sell", status: "pass", measured: `sell succeeds${tax || ", tax unknown"}`, threshold, source: m.source, reason: null, manualReviewAllowed: false };
}

/** The verdict: any measured failure = "fail"; else any unmeasured rule = "unavailable"; else "pass". */
export function evaluate(m: Measurements, nowSec: number, rules: Rules = RULES): Report {
  const age: Measured<number> = {
    ...m.createdAt,
    value: m.createdAt.value === null ? null : (nowSec - m.createdAt.value) / DAY,
  };
  const results: RuleResult[] = [
    atLeast("marketCap", m.marketCapUsd, rules.minMarketCapUsd, usd, "market cap"),
    atLeast("holders", m.holders, rules.minHolders, (v) => Math.round(v).toLocaleString("en-US"), "holders"),
    atLeast("liquidity", m.liquidityUsd, rules.minLiquidityUsd, usd, "pool liquidity"),
    atLeast("tokenAge", age, rules.minTokenAgeDays, (v) => `${v.toFixed(1)} days`, "token age"),
    sellRule(m.sell, rules.maxSellTaxPct),
  ];
  const failed = results.some((r) => r.status === "fail");
  const missing = results.filter((r) => r.status === "unmeasured");
  const verdict: Verdict = failed ? "fail" : missing.length ? "unavailable" : "pass";
  return {
    chainId: m.chainId, pool: m.pool, token: m.token, symbol: m.symbol,
    checkedAt: new Date(nowSec * 1000).toISOString(),
    verdict,
    manualReviewAllowed: verdict === "unavailable" && missing.every((r) => r.manualReviewAllowed),
    rules: results,
    reasons: results.flatMap((r) => (r.reason ? [r.reason] : [])),
  };
}

/** 0 pass, 1 fail, 2 data unavailable. */
export const exitCode = (r: Report): 0 | 1 | 2 => (r.verdict === "pass" ? 0 : r.verdict === "fail" ? 1 : 2);

export function formatReport(r: Report): string {
  const head = `${r.symbol ?? "?"} ${r.token} · chain ${r.chainId} · pool ${r.pool}`;
  const rows = r.rules.map((x) => {
    const mark = x.status === "pass" ? "PASS" : x.status === "fail" ? "FAIL" : "N/A ";
    return `  ${mark}  ${x.rule.padEnd(10)} ${x.measured.padEnd(44)} ${x.threshold.padEnd(30)} [${x.source}]`;
  });
  const verdict = r.verdict.toUpperCase() + (r.manualReviewAllowed ? " (manual review allowed)" : "");
  return [head, ...rows, `verdict: ${verdict}`, ...r.reasons.map((s) => `  - ${s}`)].join("\n");
}

// ---- parsers (API JSON -> numbers) ----

export interface DexPair {
  chainSlug: string;
  pairAddress: string;
  labels: string[];
  base: { address: string; symbol: string };
  quote: { address: string; symbol: string };
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  /** Unix seconds. */
  pairCreatedAt: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** One DexScreener pair object (the `pairs[]` items of /latest/dex/pairs and /latest/dex/tokens). */
export function parseDexPair(p: any): DexPair | null {
  if (!p || typeof p.pairAddress !== "string" || !p.baseToken?.address) return null;
  const created = num(p.pairCreatedAt);
  return {
    chainSlug: String(p.chainId),
    pairAddress: p.pairAddress.toLowerCase(),
    labels: Array.isArray(p.labels) ? p.labels.map(String) : [],
    base: { address: String(p.baseToken.address).toLowerCase(), symbol: String(p.baseToken.symbol ?? "") },
    quote: { address: String(p.quoteToken?.address ?? "").toLowerCase(), symbol: String(p.quoteToken?.symbol ?? "") },
    // marketCap only, never fdv: fdv counts supply that is not circulating and would flatter the cap.
    marketCapUsd: num(p.marketCap),
    liquidityUsd: num(p.liquidity?.usd),
    pairCreatedAt: created === null ? null : Math.floor(created / 1000),
  };
}

/** The token the station is for: --token if given (must be one side of the pair), else the pair's base token. */
export function pickToken(pair: DexPair, token?: string): { address: string; symbol: string } {
  if (!token) return pair.base;
  const t = token.toLowerCase();
  if (pair.base.address === t) return pair.base;
  if (pair.quote.address === t) return pair.quote;
  throw new Error(`token ${token} is not in pool ${pair.pairAddress} (${pair.base.symbol}/${pair.quote.symbol})`);
}

/** Blockscout /api/v2/tokens/<addr>/counters -> holders. */
export function parseBlockscoutCounters(j: any): number | null {
  return num(j?.token_holders_count);
}

export interface HoneypotResult { holders: number | null; sell: SellSim | null; pairCreatedAt: number | null; note: string | null }

/** honeypot.is /v2/IsHoneypot: holders, the buy+sell simulation, the pair it simulated on. */
export function parseHoneypot(j: any): HoneypotResult {
  const holders = num(j?.token?.totalHolders);
  const pairCreatedAt = num(j?.pair?.createdAtTimestamp);
  const pairName = j?.pair?.pair?.name ? `on ${j.pair.pair.name}` : null;
  if (j?.simulationSuccess !== true) {
    // No simulation: no pair it can trade through, or the simulation itself failed. Not a verdict either way,
    // unless honeypot.is still calls it a honeypot.
    if (j?.honeypotResult?.isHoneypot === true) {
      return { holders, sell: { ok: false, full: true, sellTaxPct: null }, pairCreatedAt, note: j?.honeypotResult?.honeypotReason ?? "honeypot" };
    }
    return { holders, sell: null, pairCreatedAt, note: j?.simulationError ?? "honeypot.is ran no simulation" };
  }
  const honeypot = j?.honeypotResult?.isHoneypot === true;
  return {
    holders,
    sell: { ok: !honeypot, full: true, sellTaxPct: num(j?.simulationResult?.sellTax) },
    pairCreatedAt,
    note: honeypot ? (j?.honeypotResult?.honeypotReason ?? "honeypot") : pairName,
  };
}

/**
 * GoPlus /api/v1/token_security/<chain>?contract_addresses=<token> -> holders, plus its honeypot/tax flags as a note
 * for the reviewer (a static scan, not a simulated sell).
 */
export function parseGoPlus(j: any, token: string): { holders: number | null; flags: string | null } {
  const r = j?.result?.[token.toLowerCase()];
  if (!r) return { holders: null, flags: null };
  const f = (k: string) => (r[k] === undefined || r[k] === "" ? "?" : String(r[k]));
  return { holders: num(r.holder_count), flags: `is_honeypot ${f("is_honeypot")}, cannot_sell_all ${f("cannot_sell_all")}, sell_tax ${f("sell_tax")}` };
}

export interface Transfer { from: string; to: string; value: bigint }

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

/** Holders from a full Transfer history: addresses with a positive balance, minus the zero and dead addresses. */
export function holderBalances(transfers: Transfer[]): Map<string, bigint> {
  const bal = new Map<string, bigint>();
  for (const t of transfers) {
    const f = t.from.toLowerCase(), to = t.to.toLowerCase();
    if (f !== ZERO) bal.set(f, (bal.get(f) ?? 0n) - t.value);
    bal.set(to, (bal.get(to) ?? 0n) + t.value);
  }
  for (const [a, v] of bal) if (v <= 0n || a === ZERO || a === DEAD) bal.delete(a);
  return bal;
}

/** The earliest of several upper bounds on the token's creation time (each source is >= the true deploy time). */
export function earliest(cands: { at: number | null; source: string }[]): Measured<number> {
  const ok = cands.filter((c): c is { at: number; source: string } => c.at !== null && Number.isFinite(c.at) && c.at > 0);
  if (!ok.length) return { value: null, source: cands.map((c) => c.source).join(", ") || "none", note: "no creation time from any source" };
  const best = ok.reduce((a, b) => (b.at < a.at ? b : a));
  return { value: best.at, source: best.source };
}
