// Per-IP fixed-window rate limits, in memory (one API process). A window holds `max` requests; the next one waits
// for the window to roll. Old windows are swept as the map grows, so a scan of many IPs cannot grow it without bound.

export interface Limit { max: number; windowMs: number }

export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();

  constructor(private readonly maxKeys = 50_000) {}

  /** true = allowed (and counted); false = over the limit. `retryAfterMs` of the last refusal is on the result. */
  take(bucket: string, ip: string, limit: Limit, now = Date.now()): { ok: boolean; retryAfterMs: number } {
    const k = `${bucket}|${ip}`;
    let w = this.hits.get(k);
    if (!w || now - w.start >= limit.windowMs) {
      if (this.hits.size >= this.maxKeys) this.sweep(now, limit.windowMs);
      w = { start: now, n: 0 };
      this.hits.set(k, w);
    }
    if (w.n >= limit.max) return { ok: false, retryAfterMs: w.start + limit.windowMs - now };
    w.n++;
    return { ok: true, retryAfterMs: 0 };
  }

  /** Drops windows older than `olderThanMs` (and, if still full, the oldest half). */
  private sweep(now: number, olderThanMs: number) {
    for (const [k, w] of this.hits) if (now - w.start >= olderThanMs) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) {
      const keys = [...this.hits.keys()];
      for (const k of keys.slice(0, keys.length >> 1)) this.hits.delete(k);
    }
  }

  get size() {
    return this.hits.size;
  }
}
