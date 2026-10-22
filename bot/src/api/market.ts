// What the API reads from the market: the eligibility report for a token (stations/sources.ts measure, judged by
// stations/eligibility.ts) and the IMD price for the setup's IMD part. Both cached, both bounded in time: a check that
// hangs answers "unavailable, retry" instead of holding the request.
import { evaluate, type Report } from "../stations/eligibility.ts";
import { ethPairs, parseCandidate } from "../stations/onboard.ts";
import { CHAINS, fetchJson, measure } from "../stations/sources.ts";
import { IMD_TOKEN, LIMITS } from "./config.ts";

/** A report the API can always return: the pool could not be resolved, or the check ran out of time. */
export function unavailable(chainId: number, token: string, pool: string, reason: string, now = Date.now()): Report {
  return { chainId, pool, token, symbol: null, checkedAt: new Date(now).toISOString(), verdict: "unavailable", manualReviewAllowed: false, rules: [], reasons: [reason] };
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    }),
  ]);
}

/**
 * The token's main pool when none is given: the deepest pair against ETH / WETH / the wrapped native, else the
 * deepest pair of any kind (DexScreener token-pairs; 20-byte pairs and v4 pool ids only).
 */
export async function mainPool(chainId: number, token: string, weth: string | undefined): Promise<string> {
  const c = CHAINS[chainId];
  const pairs = ((await fetchJson(`https://api.dexscreener.com/token-pairs/v1/${c.dex}/${token}`)) as unknown[]).map(parseCandidate).flatMap((p) => (p ? [p] : []));
  const eth = ethPairs(pairs, token, [weth, c.wrappedNative].filter((x): x is string => !!x));
  if (eth.length) return eth[0].pairAddress;
  const t = token.toLowerCase();
  const any = pairs.filter((p) => /^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(p.pairAddress) && (p.base === t || p.quote === t)).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  if (!any.length) throw new Error(`no pool for ${token} on DexScreener (${c.dex})`);
  return any[0].pairAddress;
}

export type CheckFn = (chainId: number, token: string, pool?: string) => Promise<Report>;

/**
 * Eligibility with a cache per (chain, token, pool): a report for LIMITS.checkCacheMs, a failure for
 * checkErrorCacheMs; concurrent asks for the same token share one run.
 */
export function cachedCheck(opts: { weth: (chainId: number) => string | undefined; now?: () => number; run?: CheckFn } ): CheckFn {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; report: Report }>();
  const inflight = new Map<string, Promise<Report>>();
  const run: CheckFn = opts.run ?? (async (chainId, token, pool) => {
    let p = pool;
    try {
      p ??= await mainPool(chainId, token, opts.weth(chainId));
      return evaluate(await measure(chainId, p, token), Math.floor(now() / 1000));
    } catch (e) {
      return unavailable(chainId, token, p ?? "", `could not resolve the pool: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200)}`, now());
    }
  });
  return async (chainId, token, pool) => {
    const k = `${chainId}:${token.toLowerCase()}:${pool?.toLowerCase() ?? ""}`;
    const hit = cache.get(k);
    if (hit) {
      const ttl = hit.report.rules.length ? LIMITS.checkCacheMs : LIMITS.checkErrorCacheMs;
      if (now() - hit.at < ttl) return hit.report;
      cache.delete(k);
    }
    if (inflight.has(k)) return inflight.get(k)!;
    const p = withTimeout(run(chainId, token, pool), LIMITS.checkTimeoutMs, "the eligibility check")
      .catch((e) => unavailable(chainId, token, pool ?? "", `${(e as Error).message}; retry in a minute`, now()))
      .then((report) => {
        cache.set(k, { at: now(), report });
        if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
        return report;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  };
}

/** IMD in USD: the deepest IMD pair on DexScreener (Ethereum) with IMD as its base, cached. */
export function cachedImdPrice(opts: { now?: () => number; fetch?: () => Promise<number> } = {}): () => Promise<number> {
  const now = opts.now ?? Date.now;
  let last: { at: number; usd: number } | null = null;
  const read = opts.fetch ?? (async () => {
    const pairs = ((await fetchJson(`https://api.dexscreener.com/token-pairs/v1/ethereum/${IMD_TOKEN}`)) as any[])
      .filter((p) => String(p?.baseToken?.address).toLowerCase() === IMD_TOKEN && Number(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const v = Number(pairs[0]?.priceUsd);
    if (!(v > 0)) throw new Error("DexScreener: no IMD price");
    return v;
  });
  return async () => {
    if (last && now() - last.at < LIMITS.imdPriceCacheMs) return last.usd;
    const usd = await withTimeout(read(), 20_000, "the IMD price");
    last = { at: now(), usd };
    return usd;
  };
}
