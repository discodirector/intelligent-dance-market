// One-time X authorization for the posting account (bot/README.md "X account").
//
// The app (and its API credits) belongs to one developer account, while the bot posts as another account. The
// console's "Generate" button only issues an access token for the app owner, so the posting account authorizes
// the app with the OAuth 1.0a PIN flow instead:
//   1. request_token with oauth_callback=oob
//   2. the posting account opens the printed link in a browser where it is logged in, authorizes, gets a PIN
//   3. access_token with that PIN -> access token + secret for the posting account
//   4. the four keys are written straight into the bot's .env on the VPS over ssh and the bot is restarted.
// Secrets are never printed: run it in your own terminal, not in a shared or logged session.
//
//   npx tsx bot/scripts/x-auth.ts [--account theidmfun] [--host root@138.201.92.157] [--env /opt/swarm-sequencer/.env]
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const API = process.env.X_API_BASE ?? "https://api.x.com";
const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const ACCOUNT = arg("account", "theidmfun").replace(/^@/, "").toLowerCase();
const HOST = arg("host", "root@138.201.92.157");
const ENV_PATH = arg("env", "/opt/swarm-sequencer/.env");
const BOT_DIR = arg("bot-dir", "/opt/swarm-sequencer/bot");

const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());

/** OAuth 1.0a HMAC-SHA1 signature over the method, URL and every oauth_* and query/body parameter. */
export function oauthSignature(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret = "") {
  const norm = Object.entries(params)
    .map(([k, v]) => [pct(k), pct(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(norm)].join("&");
  return createHmac("sha1", `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest("base64");
}

async function oauthPost(path: string, consumer: { key: string; secret: string }, extra: Record<string, string>, token?: { key: string; secret: string }) {
  const url = API + path;
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumer.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(token ? { oauth_token: token.key } : {}),
    ...extra,
  };
  oauth.oauth_signature = oauthSignature("POST", url, oauth, consumer.secret, token?.secret);
  const header = "OAuth " + Object.entries(oauth).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
  const res = await fetch(url, { method: "POST", headers: { Authorization: header } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return Object.fromEntries(new URLSearchParams(text));
}

/** Replaces (or appends) KEY=value lines; other lines stay as they are. */
export function setEnvLines(env: string, values: Record<string, string>): string {
  const lines = env.split("\n");
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${k}=${v}`);
  }
  return lines.join("\n");
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`X authorization: the app's owner pays the API credits, @${ACCOUNT} will post.\n`);
  const key = process.env.X_API_KEY || (await rl.question("API Key (Consumer Key): ")).trim();
  const secret = process.env.X_API_SECRET || (await rl.question("API Key Secret (Consumer Secret): ")).trim();
  if (!key || !secret) throw new Error("API Key and API Key Secret are required");
  const consumer = { key, secret };

  const req = await oauthPost("/oauth/request_token", consumer, { oauth_callback: "oob" });
  if (req.oauth_callback_confirmed !== "true") throw new Error("X did not confirm the PIN (oob) callback");
  console.log(`\n1. Open this link in a browser where you are logged in as @${ACCOUNT} (not the developer account):`);
  console.log(`   ${API}/oauth/authorize?oauth_token=${req.oauth_token}`);
  console.log("2. Click \"Authorize app\" and copy the PIN it shows.\n");
  const pin = (await rl.question("PIN: ")).trim();
  rl.close();

  const acc = await oauthPost("/oauth/access_token", consumer, { oauth_verifier: pin }, { key: req.oauth_token, secret: req.oauth_token_secret });
  const who = (acc.screen_name ?? "").toLowerCase();
  if (who !== ACCOUNT) throw new Error(`authorized as @${acc.screen_name}, expected @${ACCOUNT}: log in as @${ACCOUNT} and run again (nothing was written)`);
  console.log(`\nAuthorized as @${acc.screen_name}.`);

  // Write the keys into the VPS .env without printing them; the secrets travel only inside the ssh stdin.
  const current = execFileSync("ssh", ["-o", "BatchMode=yes", HOST, `cat ${ENV_PATH}`], { encoding: "utf8" });
  const next = setEnvLines(current, {
    X_API_KEY: key,
    X_API_SECRET: secret,
    X_ACCESS_TOKEN: acc.oauth_token,
    X_ACCESS_SECRET: acc.oauth_token_secret,
    X_OAUTH2_USER_TOKEN: "",
  });
  execFileSync("ssh", ["-o", "BatchMode=yes", HOST, `umask 077 && cat > ${ENV_PATH}.new && mv ${ENV_PATH}.new ${ENV_PATH}`], { input: next });
  execFileSync("ssh", ["-o", "BatchMode=yes", HOST, `cd ${BOT_DIR} && docker compose up -d bot`], { stdio: "ignore" });
  const dry = /^DRY_RUN=(.*)$/m.exec(next)?.[1] ?? "true";
  console.log(`Keys written to ${HOST}:${ENV_PATH} and the bot restarted (DRY_RUN=${dry}, so nothing is posted yet).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
