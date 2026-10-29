// The stations pipeline worker (docs/STATIONS.md "Automatic pipeline"): compose service `stations` (profile stations),
// `npx tsx src/stations/worker.ts`, env ../stations.env (chmod 600). Every WORKER_TICK_SEC it advances every paid
// application (stations/pipeline.ts), tells the owner about paid renewals and Station+ upgrades, Station+ slots
// filling up, rotation loops built on the stream host (OUT_DIR/stream/loops.json), expiring stations (the scheduler's
// reminders.json) and a low IMD balance, all on Telegram; the owner's commands come back by long polling, from
// TELEGRAM_CHAT_ID only. SWARM_KEY (the hot wallet that pays the swarm) is read from the environment once, held as a
// viem account, and never logged or sent anywhere but as signatures.
import { createPublicClient, erc20Abi, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { api, checkRequest, payAndSubmit, PERMIT2 } from "../imd/paid.ts";
import { PUBLIC_REPO } from "../imd/styleJob.ts";
import { IMD_TOKEN, LIMITS, plusSlotsFromEnv } from "../api/config.ts";
import { stateOf, Store, type Application } from "../api/store.ts";
import { plusSlots } from "./plus.ts";
import { loadRegistry, type RegistryEntry } from "../station.ts";
import { gateDelivery } from "./gate.ts";
import { advance, fmtImd, goLive, hold, newPipeline, reject, TERMINAL, type JobView, type Pipeline, type PipelineDeps, type Swarm } from "./pipeline.ts";
import { finishEntry, resolvePool, stationContext } from "./register.ts";
import { addRuntimeEntry, loadMergedRegistry, publishPack, readRuntime, updateRuntimeEntry } from "./runtime.ts";
import { writeJsonAtomic } from "./subscription.ts";
import { LabStore } from "../lab/submissions.ts";
import { notifyLab } from "../lab/notify.ts";
import { approve, listGallery, unapprove } from "../lab/gallery.ts";
import { loopText, ownerCommands, plusSlotsText, renewalText, telegram, type Command } from "./telegram.ts";

const env = process.env;
const OUT = env.OUT_DIR ?? "out";
const DATA = env.STATIONS_DATA_DIR ?? join(OUT, "stations-data");
const TICK_MS = Number(env.WORKER_TICK_SEC ?? 60) * 1000;
const SITE = (env.SITE_URL ?? "https://theidm.fun").replace(/\/$/, "");
const AUTO_LIVE_MS = Number(env.STATIONS_AUTO_LIVE_HOURS ?? 24) * 3_600_000;
const imdWei = (v: string | undefined, def: string) => BigInt(Math.round(Number(v ?? def) * 1e6)) * 10n ** 12n;
const MIN_IMD = imdWei(env.SWARM_MIN_IMD, "0.5");
const LOW_IMD = imdWei(env.SWARM_LOW_IMD, "2");
/** Errors in a row before an application goes to attention. */
const MAX_ERRORS = 10;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[stations]", ...a);

const key = env.SWARM_KEY?.trim();
if (!key || !/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
  console.error("SWARM_KEY missing or not a private key (64 hex): the pipeline cannot pay the swarm. Set it in stations.env.");
  process.exit(2);
}
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const payer = account.address.toLowerCase();
const tg = telegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, (l) => log(l));
const store = new Store(OUT);
const baked = loadRegistry();
const ethRpc = env.ETH_RPC_URL ?? baked.chains["1"].rpcUrls[0];
const eth = createPublicClient({ chain: mainnet, transport: http(ethRpc, { timeout: 30_000, retryCount: 2 }) });

// ---------------------------------------------------------------- the swarm, through paid.ts
const swarm: Swarm = {
  payer,
  async baseCommit() {
    const { owner, repo } = { owner: PUBLIC_REPO.split("/")[3], repo: PUBLIC_REPO.split("/")[4] };
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/main`, { headers: { accept: "application/vnd.github+json", "user-agent": "theidm-stations" }, signal: AbortSignal.timeout(30_000) });
    const j = (await res.json()) as { sha?: string };
    if (!res.ok || !/^[0-9a-f]{40}$/.test(j.sha ?? "")) throw new Error(`GitHub: main of ${PUBLIC_REPO}: HTTP ${res.status}`);
    return j.sha!;
  },
  check: (action, input) => checkRequest(action, input),
  async pay(action, input, step, save) {
    const r = await payAndSubmit({
      action, input, payer, state: step.paid, what: "the job",
      save: (paid) => { step.paid = paid; save(); },
      onSubmit: (orderId) => { step.submitting = orderId; save(); },
      unattended: {
        account, rpcUrl: ethRpc, log: (l) => log(l),
        approve: env.SWARM_AUTO_APPROVE === "1" ? "auto" : "never",
        approveAmount: imdWei(env.SWARM_APPROVE_IMD, "5"),
        minEthWei: BigInt(Math.round(Number(env.SWARM_MIN_ETH ?? "0.002") * 1e9)) * 10n ** 9n,
      },
    });
    if (!r) throw new Error("payment not made");
    return r;
  },
  async order(step) {
    const j = (await api(`/requests/${step.paid.orderId}`, { token: step.paid.token })).json;
    const result = j?.admission?.result;
    return { status: String(j?.status ?? j?.order?.status ?? "unknown"), ...(result?.kind === "job" ? { jobId: String(result.jobId) } : {}) };
  },
  async job(jobId) {
    const job = (await api(`/jobs/${jobId}`)).json;
    const view: JobView = { state: String(job?.state ?? "unknown"), blockedReason: job?.blockedReason, head: job?.project?.head };
    view.base = (job?.project?.versions ?? []).find((v: { jobId: string }) => v.jobId === jobId)?.baseCommit;
    if (view.state === "completed") view.delivery = (await api(`/jobs/${jobId}/result`)).json?.delivery ?? job?.delivery;
    return view;
  },
};

const imdBalance = () => eth.readContract({ address: IMD_TOKEN as Hex, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

// ---------------------------------------------------------------- registry, gate, pack
async function register(app: Application): Promise<RegistryEntry> {
  // Idempotent: a restart after the entry was written finds it again (same chain and token).
  const existing = readRuntime(DATA).stations.find((s) => s.chainId === app.chainId && s.token.toLowerCase() === app.token);
  if (existing) return existing;
  const reg = loadMergedRegistry(DATA, baked);
  const ctx = await stationContext(reg, app.chainId!, app.token!, (l) => log(l));
  const picked = await resolvePool(ctx, app.pool as Hex | undefined);
  // A short first replay: 7 days of history, 1 on Monad (its RPCs serve 1k-block log ranges).
  const entry = (await finishEntry(ctx, picked, { days: app.chainId === 143 ? 1 : 7, status: "pending" })) as unknown as RegistryEntry;
  addRuntimeEntry(DATA, entry, baked);
  return entry;
}

const deps: PipelineDeps = {
  now: () => Date.now(),
  swarm,
  register,
  gate: (k, d) => gateDelivery(k, d),
  publishPack: (pack) => void publishPack(DATA, pack),
  setEntry: (k, fields) => updateRuntimeEntry(DATA, k, fields),
  imdBalance,
  notify: (t) => tg.send(t),
  save: (p) => store.savePipeline(p),
  siteUrl: SITE,
  autoLiveMs: AUTO_LIVE_MS,
  minImdWei: MIN_IMD,
  ...(env.SWARM_STYLES ? { styles: Number(env.SWARM_STYLES) } : {}),
};

// ---------------------------------------------------------------- worker state
interface WorkerState {
  telegramOffset: number;
  lowImdDay?: string;
  remindersDay?: string;
  renewalsNotified: string[];
  /** Station+ slots all taken, as last told. */
  plusFull?: boolean;
  /** Rotation loop events told: key -> the event's time. */
  loopsNotified?: Record<string, string>;
}
const STATE = join(OUT, "applications", "worker.json");
const labStore = new LabStore(join(OUT, "lab-submissions"));
function loadState(): WorkerState {
  try {
    return { renewalsNotified: [], telegramOffset: 0, ...JSON.parse(readFileSync(STATE, "utf8")) };
  } catch {
    return { telegramOffset: 0, renewalsNotified: [] };
  }
}
const saveState = (s: WorkerState) => writeJsonAtomic(STATE, s);

/** Ticks and commands never interleave: one lock for both. */
let chain: Promise<unknown> = Promise.resolve();
const locked = <T>(f: () => Promise<T>): Promise<T> => {
  const run = chain.then(f, f);
  chain = run.catch(() => undefined);
  return run;
};

const pipelineOf = (app: Application): Pipeline => store.pipeline<Pipeline>(app.id) ?? newPipeline(app.id);
const paidSetups = () => store.list().filter((a) => a.kind === "setup" && a.payment);
const PLUS_MAX = plusSlotsFromEnv(env);
/** The API's count (it reads the same files; STATION_PLUS_SLOTS should match api.env). */
const plusSlotsNow = () => plusSlots({
  reg: loadMergedRegistry(DATA, baked), subs: store.subscriptions(), apps: store.list(), now: Date.now(), max: PLUS_MAX,
  stage: (id) => store.pipeline<Pipeline>(id)?.stage,
});

async function tick() {
  const state = loadState();
  // Paid applications through the pipeline.
  for (const app of paidSetups()) {
    const p = pipelineOf(app);
    if (TERMINAL.includes(p.stage)) continue;
    try {
      for (let i = 0; i < 8 && (await advance(app, p, deps)); i++);
      if (p.errors) {
        p.errors = 0;
        delete p.lastError;
        store.savePipeline(p);
      }
    } catch (e) {
      p.errors++;
      p.lastError = String((e as Error)?.message ?? e).slice(0, 500);
      store.savePipeline(p);
      log(`${app.id} ${p.stage}: ${p.lastError}`);
      if (p.errors === 1 || p.errors % 5 === 0) await tg.send(`ERROR ${p.key ?? app.symbol ?? app.id} at ${p.stage} (${p.errors} in a row): ${p.lastError}`);
      if (p.errors >= MAX_ERRORS) {
        p.reason = `${MAX_ERRORS} errors in a row at ${p.stage}: ${p.lastError}`;
        p.stage = "attention";
        p.history.push({ at: new Date().toISOString(), stage: "attention", note: p.reason.slice(0, 300) });
        store.savePipeline(p);
        await tg.send(`NEEDS ATTENTION ${p.key ?? app.id}: ${p.reason}`);
      }
    }
  }
  // Paid renewals and Station+ upgrades: told once.
  for (const a of store.list().filter((x) => (x.kind === "renew" || x.kind === "upgrade") && x.payment && !state.renewalsNotified.includes(x.id))) {
    await tg.send(renewalText(a));
    state.renewalsNotified = [...state.renewalsNotified, a.id].slice(-500);
  }
  // Station+ slots: told when they fill up (new Station+ quotes are refused from then) and when one frees again.
  try {
    const s = plusSlotsNow();
    const full = s.max > 0 && s.left === 0;
    if (full !== !!state.plusFull) {
      state.plusFull = full;
      await tg.send(plusSlotsText(full, s));
    }
  } catch (e) {
    log("station+ slots:", (e as Error).message);
  }
  // Rotation loops of Station+ stations, built on the stream host (sim/stream/live/build-loops.mjs): told once each.
  try {
    const loops = JSON.parse(readFileSync(join(OUT, "stream", "loops.json"), "utf8")) as Record<string, { state: "built" | "failed"; at: string; error?: string }>;
    state.loopsNotified ??= {};
    for (const [k, l] of Object.entries(loops)) {
      if (state.loopsNotified[k] === l.at) continue;
      state.loopsNotified[k] = l.at;
      await tg.send(loopText(k, l));
    }
  } catch {
    /* no loops built yet (the stream host writes them) */
  }
  // Expiring stations: the scheduler's daily reminders.json, forwarded once a day.
  try {
    const r = JSON.parse(readFileSync(join(OUT, "applications", "reminders.json"), "utf8")) as { checkedOn: string; stations: { key: string; paidUntil: string; daysLeft: number; status: string }[] };
    if (r.checkedOn !== state.remindersDay) {
      state.remindersDay = r.checkedOn;
      if (r.stations.length) await tg.send(`SUBSCRIPTIONS ending within 3 days:\n${r.stations.map((s) => `  ${s.key}: ${s.status === "expired" ? "EXPIRED" : `${s.daysLeft} d`} (paid until ${s.paidUntil})`).join("\n")}`);
    }
  } catch {
    /* no reminders yet (the scheduler writes them) */
  }
  // Low IMD: once a day.
  const today = new Date().toISOString().slice(0, 10);
  if (state.lowImdDay !== today) {
    const bal = await imdBalance().catch(() => null);
    if (bal !== null && bal < LOW_IMD) {
      state.lowImdDay = today;
      await tg.send(`LOW IMD: the hot wallet ${account.address} holds ${fmtImd(bal)} IMD (warning below ${fmtImd(LOW_IMD)}; ordering stops below ${fmtImd(MIN_IMD)}). Top up IMD on Ethereum.`);
    }
  }
  saveState(state);
}

// ---------------------------------------------------------------- owner commands
const HELP = "/status · /balance · /live <key> · /hold <key> · /reject <key> · lab: /approve <code> · /unapprove <code> · /gallery";
function findByKey(k: string): { app: Application; p: Pipeline } | null {
  for (const app of paidSetups()) {
    const p = store.pipeline<Pipeline>(app.id);
    if (p?.key === k) return { app, p };
  }
  return null;
}

async function command(c: Command): Promise<string> {
  if (c.cmd === "help") return HELP;
  if (c.cmd === "balance") {
    const [imd, ethWei, allowance] = await Promise.all([
      imdBalance(), eth.getBalance({ address: account.address }),
      eth.readContract({ address: IMD_TOKEN as Hex, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] }),
    ]);
    return `hot wallet ${account.address}: ${fmtImd(imd)} IMD, ${Number(formatEther(ethWei)).toFixed(5)} ETH, Permit2 allowance ${fmtImd(allowance)} IMD`;
  }
  if (c.cmd === "status") {
    const lines = paidSetups().map((app) => {
      const p = store.pipeline<Pipeline>(app.id);
      return `${p?.key ?? app.symbol ?? app.id.slice(0, 8)}: ${p?.stage ?? "paid"}${p?.hold ? " (hold)" : ""}${p?.waiting ? ` waiting ${p.waiting}` : ""}${p?.errors ? ` ${p.errors} error(s)` : ""}`;
    });
    const open = store.list().filter((a) => !a.payment && stateOf(a, Date.now(), LIMITS.graceMs) !== "expired").length;
    const s = plusSlotsNow();
    const plus = `Station+: ${s.used} of ${s.max} slots${s.active.length ? ` (on air: ${s.active.join(", ")})` : ""}`;
    return [`${lines.length} paid application(s), ${open} open quote(s)`, plus, ...lines.slice(-30)].join("\n");
  }
  // Style Lab gallery (lab/gallery.ts): out/stations-data/community.json, served to the site.
  if (c.cmd === "approve") return approve(labStore, DATA, c.code, new Date());
  if (c.cmd === "unapprove") return unapprove(DATA, c.code, new Date());
  if (c.cmd === "gallery") return listGallery(DATA);
  if (!("key" in c)) return HELP;
  const found = findByKey(c.key);
  if (!found) return `no pipeline station "${c.key}"`;
  const { app, p } = found;
  if (c.cmd === "hold") {
    const msg = hold(p);
    store.savePipeline(p);
    return msg;
  }
  if (c.cmd === "live") {
    if (p.stage !== "preview") return `${c.key} is ${p.stage}: only a preview goes live`;
    await goLive(app, p, deps, "on the owner's command");
    return `${c.key} is live`;
  }
  await reject(app, p, deps);
  return `${c.key} rejected`;
}

async function pollTelegram() {
  if (!tg.enabled) return log("Telegram not configured (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID): notifications go to the log only, no commands");
  for (;;) {
    try {
      const state = loadState();
      const updates = await tg.updates(state.telegramOffset, 50);
      if (!updates.length) continue;
      for (const { command: c, text } of ownerCommands(updates, env.TELEGRAM_CHAT_ID!)) {
        if (!c) {
          if (text.startsWith("/")) await tg.send(`unknown command. ${HELP}`);
          continue;
        }
        const reply = await locked(() => command(c)).catch((e) => `error: ${(e as Error).message}`);
        await tg.send(reply);
      }
      const s = loadState();
      s.telegramOffset = Math.max(...updates.map((u) => u.update_id)) + 1;
      saveState(s);
    } catch (e) {
      log("telegram poll:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

log(`starting; hot wallet ${account.address}; tick ${TICK_MS / 1000} s; auto-live after ${AUTO_LIVE_MS / 3_600_000} h; out=${OUT}`);
await tg.send(`stations worker started; hot wallet ${account.address}`);
void pollTelegram();
for (;;) {
  await locked(tick).catch((e) => log("tick failed:", (e as Error)?.stack ?? e));
  // Style Lab submissions the API stored (lab/notify.ts): to the owner's chat.
  await notifyLab({ store: labStore, tg, site: SITE, log }).catch((e) => log("lab notify failed:", (e as Error)?.message ?? e));
  await new Promise((r) => setTimeout(r, TICK_MS));
}
