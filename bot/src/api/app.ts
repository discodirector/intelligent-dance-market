// The stations API (docs/STATIONS.md "Applications and payment"), plain node:http. Routes under /api/stations:
//   GET  /config                 prices, accepted stables per chain, genres, whether applications are open
//   POST /check                  {chainId, token, pool?} -> eligibility report (cached 10 min per token)
//   POST /apply                  {chainId, token, pool?, contact, vibe, genres?, plan: "setup"} -> quote (30 min)
//   POST /renew                  {key, months: 1|3} -> quote for a registry station
//   POST /pay                    {applicationId, chainId, txHash} -> verified on chain: paid, confirming or refused
//   GET  /application/:id        status for the form to poll (no contact, no vibe)
// Read-only on chain, no keys. Every dependency comes in through Deps, so test/api.test.ts runs it without a network.
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Registry } from "../station.ts";
import type { Report } from "../stations/eligibility.ts";
import { publishStatus, renewedUntil } from "../stations/subscription.ts";
import { DATA_GENRES, LIMITS, PAY_CHAINS, PRICES, RATE_LIMITS, STABLES, type ApiConfig, type RateBucket } from "./config.ts";
import type { CheckFn } from "./market.ts";
import { checkPayment, type ChainReader } from "./payments.ts";
import { pickTag, quoteFor, type Plan, type Quote } from "./pricing.ts";
import { RateLimiter } from "./ratelimit.ts";
import { stateOf, txKey, type Application, type Store } from "./store.ts";
import { applyReq, checkReq, Invalid, payReq, renewReq } from "./validate.ts";

export interface Deps {
  config: ApiConfig;
  store: Store;
  /** The registry now: baked + runtime entries (stations/runtime.ts), read per request. */
  registry: () => Registry;
  check: CheckFn;
  imdUsd: () => Promise<number>;
  chain: ChainReader;
  /** Where status.json goes after a paid renewal (the bot's STATIONS_DATA_DIR). */
  stationsDataDir: string;
  /** Chains the eligibility check serves (registry chains with a data source). */
  checkChains: number[];
  now?: () => number;
  rand?: () => number;
  limiter?: RateLimiter;
  log?: (...a: unknown[]) => void;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const PREFIX = "/api/stations";

/** The client's address: the last X-Forwarded-For hop when behind the host's proxy, else the socket's. */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const xff = req.headers["x-forwarded-for"];
  const hops = (Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (trustProxy && hops.length ? hops[hops.length - 1] : req.socket.remoteAddress) ?? "?";
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Content-Type: application/json");
  if (Number(req.headers["content-length"] ?? 0) > limit) throw new HttpError(413, `body over ${limit} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, `body over ${limit} bytes`);
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body: not JSON");
  }
}

/** The report as the form shows it: verdict, the five rules, the reasons. */
const publicReport = (r: Report) => ({
  chainId: r.chainId, token: r.token, pool: r.pool, symbol: r.symbol, checkedAt: r.checkedAt, verdict: r.verdict,
  manualReviewAllowed: r.manualReviewAllowed, reasons: r.reasons,
  rules: r.rules.map((x) => ({ rule: x.rule, status: x.status, measured: x.measured, threshold: x.threshold, source: x.source })),
});

const chainName = (id: number) => PAY_CHAINS[id]?.name ?? String(id);

/** An application as the form polls it: no contact, no vibe. */
export function publicApp(a: Application, now: number) {
  return {
    applicationId: a.id, kind: a.kind, state: stateOf(a, now, LIMITS.graceMs),
    createdAt: a.createdAt, expiresAt: a.expiresAt, payTo: a.payTo,
    quote: publicQuote(a.quote),
    ...(a.kind === "setup" ? { chainId: a.chainId, token: a.token, symbol: a.symbol ?? null } : { key: a.key, months: a.months }),
    ...(a.pendingTx ? { pendingTx: a.pendingTx } : {}),
    ...(a.payment ? { payment: { chainId: a.payment.chainId, txHash: a.payment.txHash, symbol: a.payment.symbol, value: a.payment.value, paidAt: a.payment.paidAt } } : {}),
    ...(a.paidUntil ? { paidUntil: a.paidUntil } : {}),
  };
}

const publicQuote = (q: Quote) => ({
  usd: q.usd,
  totalUsd: (q.usd.totalCents / 100).toFixed(2),
  amounts: q.amounts.map((x) => ({ ...x, chain: chainName(x.chainId), confirmations: PAY_CHAINS[x.chainId]?.confirmations ?? 1 })),
});

export function createHandler(d: Deps) {
  const now = d.now ?? Date.now;
  const limiter = d.limiter ?? new RateLimiter();
  const log = d.log ?? ((...a: unknown[]) => console.log(new Date().toISOString(), "[api]", ...a));
  const payChains = Object.keys(PAY_CHAINS).map(Number);
  const prices = () => PRICES[d.config.tier];

  const limit = (bucket: RateBucket, ip: string) => {
    const r = limiter.take(bucket, ip, RATE_LIMITS[bucket], now());
    if (!r.ok) throw new HttpError(429, "too many requests, retry later", { retryAfterSec: Math.ceil(r.retryAfterMs / 1000) });
  };
  const requireOpen = () => {
    if (!d.config.payTo || !d.config.open) throw new HttpError(503, "applications not open");
  };
  const requirePayTo = () => {
    if (!d.config.payTo) throw new HttpError(503, "applications not open");
  };
  const valid = <T>(f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof Invalid) throw new HttpError(400, e.message);
      throw e;
    }
  };

  const openApps = (except?: string) => d.store.list().filter((a) => a.id !== except && !a.payment && stateOf(a, now(), LIMITS.graceMs) !== "expired");

  /** A new application with a fresh tag, written under the store's lock (two quotes never share a tag). */
  const createApp = (plan: Plan, fields: Partial<Application>, imdUsd?: number) =>
    d.store.exclusive(() => {
      const tag = pickTag(openApps().map((a) => a.quote.tag), d.rand);
      if (tag === null) throw new HttpError(503, "too many open quotes, retry in a few minutes");
      const t = now();
      const app: Application = {
        id: randomBytes(12).toString("hex"), kind: plan.kind, createdAt: new Date(t).toISOString(),
        expiresAt: new Date(t + LIMITS.quoteTtlMs).toISOString(), payTo: d.config.payTo!, quote: quoteFor(plan, prices(), tag, imdUsd), ...fields,
      };
      d.store.save(app);
      return app;
    });

  const routes: Record<string, (req: IncomingMessage, ip: string, arg?: string) => Promise<[number, unknown]>> = {
    "GET /config": async () => [200, {
      open: !!(d.config.payTo && d.config.open), tier: d.config.tier, prices: prices(), genres: DATA_GENRES, checkChains: d.checkChains,
      stables: STABLES.map((s) => ({ ...s, chain: chainName(s.chainId), confirmations: PAY_CHAINS[s.chainId].confirmations })),
      quoteMinutes: LIMITS.quoteTtlMs / 60_000, vibeChars: LIMITS.vibeChars,
    }],

    "POST /check": async (req, ip) => {
      requireOpen();
      limit("check", ip);
      const body = await readJson(req, LIMITS.bodyBytes);
      const r = valid(() => checkReq(body, d.checkChains));
      return [200, publicReport(await d.check(r.chainId, r.token, r.pool))];
    },

    "POST /apply": async (req, ip) => {
      requireOpen();
      limit("quote", ip);
      const body = await readJson(req, LIMITS.bodyBytes);
      const r = valid(() => applyReq(body, d.checkChains, LIMITS.vibeChars));
      const dup = d.registry().stations.find((s) => s.chainId === r.chainId && s.token.toLowerCase() === r.token);
      if (dup) throw new HttpError(409, `this token already has a station (${dup.key}): renew it instead`, { key: dup.key });
      const report = await d.check(r.chainId, r.token, r.pool);
      if (report.verdict === "fail") throw new HttpError(422, "not eligible", { report: publicReport(report) });
      // Automatic, no owner step: only PASS is quoted; a rule that could not be verified refuses like a failed one.
      if (report.verdict !== "pass") throw new HttpError(422, `could not verify eligibility automatically: ${report.reasons[0] ?? "retry later"}`, { report: publicReport(report) });
      const imdUsd = await d.imdUsd().catch((e) => {
        throw new HttpError(503, `IMD price unavailable, retry in a minute (${(e as Error).message})`);
      });
      const app = await createApp({ kind: "setup" }, {
        chainId: r.chainId, token: r.token, pool: report.pool || r.pool, symbol: report.symbol, contact: r.contact, vibe: r.vibe, genres: r.genres,
        eligibility: { verdict: report.verdict, reasons: report.reasons, checkedAt: report.checkedAt, pool: report.pool },
      }, imdUsd);
      log(`apply ${app.id} ${report.symbol ?? r.token} chain ${r.chainId} $${(app.quote.usd.totalCents / 100).toFixed(2)} tag ${app.quote.tag}`);
      return [201, { ...publicApp(app, now()), report: publicReport(report) }];
    },

    "POST /renew": async (req, ip) => {
      requireOpen();
      limit("quote", ip);
      const body = await readJson(req, LIMITS.bodyBytes);
      const r = valid(() => renewReq(body));
      const entry = d.registry().stations.find((s) => s.key === r.key);
      if (!entry) throw new HttpError(404, "no such station");
      if (entry.house) throw new HttpError(400, "house stations need no renewal");
      const app = await createApp({ kind: "renew", months: r.months }, { key: r.key, months: r.months });
      log(`renew ${app.id} ${r.key} ${r.months} month(s) $${(app.quote.usd.totalCents / 100).toFixed(2)} tag ${app.quote.tag}`);
      return [201, publicApp(app, now())];
    },

    "POST /pay": async (req, ip) => {
      requirePayTo();
      limit("pay", ip);
      const body = await readJson(req, LIMITS.bodyBytes);
      const r = valid(() => payReq(body, payChains));
      const app = d.store.get(r.applicationId);
      if (!app) throw new HttpError(404, "no such application");
      if (app.payment) {
        if (txKey(app.payment.chainId, app.payment.txHash) === txKey(r.chainId, r.txHash)) return [200, publicApp(app, now())];
        throw new HttpError(409, "this application is already paid");
      }
      const usedBy = d.store.usedTx()[txKey(r.chainId, r.txHash)];
      if (usedBy && usedBy !== app.id) throw new HttpError(409, "this transaction already paid another application");

      const receipt = await d.chain.receipt(r.chainId, r.txHash);
      if (!receipt) return [202, { ...publicApp(app, now()), code: "not-mined", message: `not found on ${chainName(r.chainId)} yet: retrying` }];
      const block = typeof receipt.blockNumber === "bigint" ? receipt.blockNumber : BigInt(receipt.blockNumber);
      const [blockTime, head] = await Promise.all([d.chain.blockTime(r.chainId, block), d.chain.head(r.chainId)]);
      const verdict = checkPayment({ app, chainId: r.chainId, receipt, blockTime, head, others: openApps(app.id) });

      if (!verdict.ok && verdict.code === "confirming") {
        const saved = await d.store.exclusive(() => {
          const a = d.store.get(app.id)!;
          if (a.payment) return a;
          a.pendingTx = { chainId: r.chainId, txHash: r.txHash, confirmations: verdict.confirmations, required: verdict.required };
          d.store.save(a);
          return a;
        });
        return [saved.payment ? 200 : 202, { ...publicApp(saved, now()), code: "confirming", message: verdict.error }];
      }
      if (!verdict.ok) throw new HttpError(422, verdict.error, { code: verdict.code });

      const paid = await d.store.exclusive(() => {
        const a = d.store.get(app.id)!;
        if (a.payment) {
          if (txKey(a.payment.chainId, a.payment.txHash) === txKey(r.chainId, r.txHash)) return a;
          throw new HttpError(409, "this application is already paid");
        }
        const other = d.store.usedTx()[txKey(r.chainId, r.txHash)];
        if (other && other !== a.id) throw new HttpError(409, "this transaction already paid another application");
        const t = verdict.transfer;
        d.store.markUsed(r.chainId, r.txHash, a.id);
        a.payment = {
          chainId: r.chainId, txHash: r.txHash, token: t.stable.address, symbol: t.stable.symbol, from: t.from, value: t.value.toString(),
          block: Number(block), blockTime, paidAt: new Date(now()).toISOString(),
        };
        delete a.pendingTx;
        if (a.kind === "renew") {
          const entry = d.registry().stations.find((s) => s.key === a.key);
          if (entry) {
            const subs = d.store.subscriptions();
            const paidUntil = renewedUntil(entry, subs[a.key!], a.months!, now());
            subs[a.key!] = { paidUntil, renewals: [...(subs[a.key!]?.renewals ?? []), { applicationId: a.id, months: a.months!, paidAt: a.payment.paidAt, txHash: r.txHash, chainId: r.chainId }] };
            d.store.saveSubscriptions(subs);
            a.paidUntil = paidUntil;
          }
        }
        d.store.save(a);
        return a;
      });
      if (paid.kind === "renew") {
        try {
          publishStatus(d.registry(), d.store.outDir, d.stationsDataDir, now());
        } catch (e) {
          log(`status.json not written (the bot rewrites it on its next tick): ${(e as Error).message}`);
        }
      }
      log(`paid ${paid.id} ${paid.kind}${paid.key ? ` ${paid.key}` : ""} ${paid.payment!.symbol} ${paid.payment!.value} chain ${r.chainId} tx ${r.txHash}`);
      return [200, publicApp(paid, now())];
    },

    "GET /application": async (_req, _ip, id) => {
      const app = id ? d.store.get(id) : null;
      if (!app) throw new HttpError(404, "no such application");
      return [200, publicApp(app, now())];
    },
  };

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
    };
    if (origin && d.config.origins.includes(origin)) {
      Object.assign(headers, {
        "access-control-allow-origin": origin, vary: "Origin",
        "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600",
      });
    }
    const send = (status: number, body: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, headers);
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://api.local");
      if (req.method === "OPTIONS") return send(204, undefined);
      const ip = clientIp(req, d.config.trustProxy);
      limit("all", ip);
      if (!url.pathname.startsWith(PREFIX + "/")) throw new HttpError(404, "not found");
      const path = url.pathname.slice(PREFIX.length);
      const m = /^\/application\/([^/]+)$/.exec(path);
      const route = routes[`${req.method} ${m ? "/application" : path}`];
      if (!route) {
        const known = m || ["/config", "/check", "/apply", "/renew", "/pay"].includes(path);
        throw new HttpError(known ? 405 : 404, known ? "method not allowed" : "not found");
      }
      const [status, body] = await route(req, ip, m?.[1]);
      send(status, body);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 429 && e.extra.retryAfterSec) headers["retry-after"] = String(e.extra.retryAfterSec);
        return send(e.status, { error: e.message, ...e.extra });
      }
      log("error:", (e as Error)?.stack ?? e);
      send(500, { error: "internal error" });
    }
  };
}
