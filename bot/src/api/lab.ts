// POST /api/lab/submit (lab/submissions.ts): a Style Lab style and its 20 s preview, for the owner to listen to. Stored
// only; the stations worker sends it to Telegram. Limits: 3 a client per hour, DAILY_MAX for everyone per UTC day, the
// body at most BODY_MAX. The same style twice is accepted once (the answer names the first).
import type { IncomingMessage, ServerResponse } from "node:http";
import { BODY_MAX, DAILY_MAX, LabStore, parseSubmission, Rejected } from "../lab/submissions.ts";
import { clientIp } from "./app.ts";
import { RateLimiter } from "./ratelimit.ts";

export const LAB_PREFIX = "/api/lab/";
const PER_CLIENT = { max: 3, windowMs: 3_600_000 };

export interface LabDeps {
  store: LabStore;
  trustProxy: boolean;
  origins: readonly string[];
  now?: () => Date;
  limiter?: RateLimiter;
  log?: (...a: unknown[]) => void;
}

export function createLabHandler(d: LabDeps) {
  const now = d.now ?? (() => new Date());
  const limiter = d.limiter ?? new RateLimiter();
  const log = d.log ?? ((...a: unknown[]) => console.log(new Date().toISOString(), "[api]", ...a));
  return async (req: IncomingMessage, res: ServerResponse) => {
    const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
    const origin = req.headers.origin;
    if (origin && d.origins.includes(origin)) {
      Object.assign(headers, { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" });
    }
    const send = (status: number, body?: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, headers);
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    try {
      const path = new URL(req.url ?? "/", "http://api.local").pathname;
      if (req.method === "OPTIONS") return send(204);
      if (path !== `${LAB_PREFIX}submit`) return send(404, { error: "not found" });
      if (req.method !== "POST") return send(405, { error: "method not allowed" });
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return send(415, { error: "Content-Type: application/json" });
      if (Number(req.headers["content-length"] ?? 0) > BODY_MAX) return send(413, { error: "too large" });
      const ip = clientIp(req, d.trustProxy);
      const t = now();
      const r = limiter.take("lab", ip, PER_CLIENT, t.getTime());
      if (!r.ok) {
        headers["retry-after"] = String(Math.ceil(r.retryAfterMs / 1000));
        return send(429, { error: "too many sends, retry later", retryAfterSec: Math.ceil(r.retryAfterMs / 1000) });
      }
      if (d.store.today(t) >= DAILY_MAX) return send(503, { error: "the lab takes no more styles today, retry tomorrow" });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > BODY_MAX) return send(413, { error: "too large" });
        chunks.push(c as Buffer);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(400, { error: "body: not JSON" });
      }
      const { sub, wav } = await parseSubmission(body);
      const dup = d.store.find(sub.code);
      if (dup) return send(200, { ok: true, id: dup, duplicate: true });
      const saved = d.store.add(sub, wav, t);
      log(`lab submission ${saved.id}: ${saved.genre}, ${saved.seconds} s`);
      return send(202, { ok: true, id: saved.id });
    } catch (e) {
      if (e instanceof Rejected) return send(422, { error: e.message });
      log("lab error:", (e as Error)?.stack ?? e);
      return send(500, { error: "internal error" });
    }
  };
}
