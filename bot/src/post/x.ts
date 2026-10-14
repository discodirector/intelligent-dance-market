// Minimal X API v2 client: chunked media upload (v2 media endpoints) + create post.
// Auth: OAuth 1.0a user context (X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET),
// or an OAuth 2.0 user access token with media.write + tweet.write scopes (X_OAUTH2_USER_TOKEN).
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const API = process.env.X_API_BASE ?? "https://api.x.com";
const CHUNK = 4 * 1024 * 1024;

export interface XCreds {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
  oauth2UserToken?: string;
}

export function credsFromEnv(): XCreds {
  return {
    apiKey: process.env.X_API_KEY || undefined,
    apiSecret: process.env.X_API_SECRET || undefined,
    accessToken: process.env.X_ACCESS_TOKEN || undefined,
    accessSecret: process.env.X_ACCESS_SECRET || undefined,
    oauth2UserToken: process.env.X_OAUTH2_USER_TOKEN || undefined,
  };
}

export function hasCreds(c: XCreds) {
  return !!(c.oauth2UserToken || (c.apiKey && c.apiSecret && c.accessToken && c.accessSecret));
}

const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());

/** OAuth 1.0a header. Only query params are signed (JSON / multipart bodies are not part of the base string). */
export function oauth1Header(method: string, url: string, c: XCreds, nonce = randomBytes(16).toString("hex"), ts = Math.floor(Date.now() / 1000)) {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.apiKey!,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(ts),
    oauth_token: c.accessToken!,
    oauth_version: "1.0",
  };
  const params = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(u.origin + u.pathname), pct(params)].join("&");
  const key = `${pct(c.apiSecret!)}&${pct(c.accessSecret!)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.entries(oauth).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}

async function xfetch(c: XCreds, method: string, path: string, body?: { json?: unknown; form?: FormData }) {
  const url = API + path;
  const headers: Record<string, string> = {
    Authorization: c.oauth2UserToken ? `Bearer ${c.oauth2UserToken}` : oauth1Header(method, url, c),
  };
  let payload: BodyInit | undefined;
  if (body?.json !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body.json); }
  else if (body?.form) payload = body.form;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const reset = Number(res.headers.get("x-rate-limit-reset") ?? 0) * 1000 - Date.now();
      await new Promise((r) => setTimeout(r, Math.min(60_000, Math.max(2000 * 2 ** attempt, reset))));
      continue;
    }
    throw new Error(`X ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
}

export async function uploadVideo(c: XCreds, file: string): Promise<string> {
  const data = readFileSync(file);
  const init = await xfetch(c, "POST", "/2/media/upload/initialize", {
    json: { media_type: "video/mp4", total_bytes: data.length, media_category: "tweet_video" },
  });
  const id: string = init.data.id;
  for (let i = 0, seg = 0; i < data.length; i += CHUNK, seg++) {
    const form = new FormData();
    form.append("segment_index", String(seg));
    form.append("media", new Blob([data.subarray(i, i + CHUNK)], { type: "application/octet-stream" }), "chunk");
    await xfetch(c, "POST", `/2/media/upload/${id}/append`, { form });
  }
  let fin = await xfetch(c, "POST", `/2/media/upload/${id}/finalize`);
  let info = fin.data?.processing_info;
  while (info && (info.state === "pending" || info.state === "in_progress")) {
    await new Promise((r) => setTimeout(r, Math.max(1, info.check_after_secs ?? 3) * 1000));
    fin = await xfetch(c, "GET", `/2/media/upload?media_id=${id}&command=STATUS`);
    info = fin.data?.processing_info;
  }
  if (info?.state === "failed") throw new Error(`media processing failed: ${JSON.stringify(info)}`);
  return id;
}

export async function createPost(c: XCreds, text: string, mediaId?: string) {
  const res = await xfetch(c, "POST", "/2/tweets", { json: { text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) } });
  return res.data as { id: string; text: string };
}
