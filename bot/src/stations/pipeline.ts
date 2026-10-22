// The automatic station pipeline (docs/STATIONS.md "Automatic pipeline"): what happens to a paid application, one
// step at a time, persisted after every step in OUT_DIR/applications/<id>.pipeline.json (the API owns <id>.json; the
// worker owns the pipeline file). Every dependency (chain, swarm API, gate, registry, Telegram) comes in through
// PipelineDeps, so test/pipeline.test.ts drives it with fakes.
//
//   paid       -> registered  runtime registry entry, status pending, program "idm" (register.ts)
//   registered -> ordered     job.open paid from the hot wallet (paid.ts unattended); waits on low IMD or a missing
//                             Permit2 allowance (the owner is told once), never pays twice (below)
//   ordered    -> delivered   the job completed with a commit
//   delivered  -> preview     the gate passes: runtime pack published, entry status preview, program = its key
//              -> revising    first gate failure: ONE automatic job.continue with the gate's failing lines as notes
//              -> attention   second failure (or a job that ends without a delivery): the owner decides
//   revising   -> ordered     job.continue paid, the same way
//   preview    -> live        /live from the owner, or automatically AUTO_LIVE after the preview unless /hold
//   any        -> rejected    /reject: marked failed, the refund stays manual (the owner is told contact and amount)
//
// Never pays twice: a pay step keeps the order's PaidState (paid.ts: request token, requestKey, orderId), saved before
// the quote and once the order exists, and a `submitting` marker saved right before the payment is submitted. A
// restart resumes the same order; an order marked submitting that the API still shows "quoted" is never submitted
// again (the owner is told after SUBMIT_STUCK_MS). paid.ts itself returns an order past "quoted" without paying.
import { newPaidState, type PaidState } from "../imd/paid.ts";
import { styleContinueBody, styleOpenBody } from "../imd/styleJob.ts";
import type { Application } from "../api/store.ts";
import type { RegistryEntry } from "../station.ts";
import type { GateVerdict, Delivery } from "./gate.ts";
import { firstPaidUntil } from "./onboard.ts";

export type Stage = "paid" | "registered" | "ordered" | "delivered" | "revising" | "preview" | "live" | "attention" | "rejected";
export const TERMINAL: readonly Stage[] = ["live", "attention", "rejected"];

/** One paid swarm order (job.open or job.continue) and the job it became. */
export interface PayStep {
  paid: PaidState;
  /** The orderId whose payment was about to be submitted (saved before the submit). */
  submitting?: string;
  submittedAt?: string;
  jobId?: string;
}

export interface Pipeline {
  appId: string;
  stage: Stage;
  key?: string;
  /** The public repository's commit the first job starts from. */
  baseCommit?: string;
  open?: PayStep;
  revise?: PayStep & { notes: string; parentJobId: string };
  /** The job being waited on (open, then the revision). */
  jobId?: string;
  delivery?: Delivery;
  gateRuns: number;
  gateLines?: string[];
  previewAt?: string;
  hold?: boolean;
  liveAt?: string;
  /** Why the owner must look (stage attention), or why it was rejected. */
  reason?: string;
  /** What the step waits on, notified once: "low-imd", "approval". */
  waiting?: string;
  errors: number;
  lastError?: string;
  history: { at: string; stage: Stage; note: string }[];
}

export interface OrderView { status: string; jobId?: string }
export interface JobView {
  state: string;
  blockedReason?: string;
  /** The project's newest job: what job.continue must continue. */
  head?: string;
  /** This job's base commit (its project version). */
  base?: string;
  delivery?: { repoUrl?: string; commit?: string; failure?: unknown };
}

/** The IMD swarm, as the pipeline needs it (worker.ts: the real API through paid.ts). */
export interface Swarm {
  /** The hot wallet (lowercase): the payer of every job, the owner of every project. */
  payer: string;
  baseCommit(): Promise<string>;
  check(action: string, input: unknown): Promise<{ blockers?: { code?: string; detail?: string }[]; owner?: string }>;
  /** Pays (resuming `step.paid`); calls save() whenever the step changes; sets step.submitting before submitting. */
  pay(action: "job.open" | "job.continue", input: unknown, step: PayStep, save: () => void): Promise<{ orderId: string }>;
  order(step: PayStep): Promise<OrderView>;
  job(jobId: string): Promise<JobView>;
}

export interface PipelineDeps {
  now(): number;
  swarm: Swarm;
  /** Adds the runtime registry entry (status pending, program idm); returns it. */
  register(app: Application): Promise<RegistryEntry>;
  gate(key: string, delivery: Delivery): Promise<GateVerdict>;
  publishPack(pack: NonNullable<GateVerdict["pack"]>): void;
  setEntry(key: string, fields: Partial<RegistryEntry>): RegistryEntry;
  /** The hot wallet's IMD on Ethereum, wei. */
  imdBalance(): Promise<bigint>;
  notify(text: string): Promise<void>;
  save(p: Pipeline): void;
  /** Public site, for the preview link. */
  siteUrl: string;
  autoLiveMs: number;
  /** Below this the pipeline does not order (default 0.5 IMD). */
  minImdWei: bigint;
  /** Styles per genre the job asks for. */
  styles?: number;
}

export const SUBMIT_STUCK_MS = 30 * 60_000;
const ORDER_FAILED = new Set(["rejected", "failed", "refunded", "expired", "cancelled", "payment_failed"]);
const JOB_ENDED = new Set(["completed", "blocked", "failed", "cancelled", "superseded"]);

export const newPipeline = (appId: string): Pipeline => ({ appId, stage: "paid", gateRuns: 0, errors: 0, history: [] });

const label = (app: Application, p: Pipeline) => `${p.key ?? app.symbol ?? app.token} (${app.id.slice(0, 8)})`;
const usd = (app: Application) => `$${(app.quote.usd.totalCents / 100).toFixed(2)}`;

function to(p: Pipeline, stage: Stage, note: string, now: number) {
  p.stage = stage;
  p.history.push({ at: new Date(now).toISOString(), stage, note: note.slice(0, 300) });
  if (p.history.length > 50) p.history.splice(0, p.history.length - 50);
  delete p.waiting;
}

async function attention(p: Pipeline, app: Application, d: PipelineDeps, reason: string) {
  p.reason = reason.slice(0, 1500);
  to(p, "attention", reason, d.now());
  d.save(p);
  await d.notify(`NEEDS ATTENTION ${label(app, p)}: ${reason}\nThe pipeline stopped; nothing more is paid for it.`);
}

/** A pay step: resumes or starts the order; returns the admitted job id, or null while waiting. */
async function payStep(p: Pipeline, app: Application, d: PipelineDeps, step: PayStep, action: "job.open" | "job.continue", input: unknown): Promise<string | null | "stop"> {
  if (step.jobId) return step.jobId;
  if (step.paid.orderId) {
    const o = await d.swarm.order(step);
    if (o.status === "admitted") {
      if (!o.jobId) {
        await attention(p, app, d, `order ${step.paid.orderId} was admitted without a job`);
        return "stop";
      }
      step.jobId = o.jobId;
      d.save(p);
      return o.jobId;
    }
    if (ORDER_FAILED.has(o.status)) {
      await attention(p, app, d, `swarm order ${step.paid.orderId} ended "${o.status}"${step.submitting ? " after its payment was submitted: check the payment before anything else" : ""}`);
      return "stop";
    }
    if (o.status !== "quoted") return null; // paid / processing: wait for the admission
    if (step.submitting === step.paid.orderId) {
      // Submitted, yet still quoted: never submit again. Past SUBMIT_STUCK_MS the owner looks.
      if (step.submittedAt && d.now() - Date.parse(step.submittedAt) > SUBMIT_STUCK_MS) {
        await attention(p, app, d, `order ${step.paid.orderId} was submitted ${Math.round((d.now() - Date.parse(step.submittedAt)) / 60_000)} min ago and is still "quoted"; not paying again`);
        return "stop";
      }
      return null;
    }
  }
  // Before paying: enough IMD (else wait, the owner told once).
  const bal = await d.imdBalance();
  if (bal < d.minImdWei) {
    if (p.waiting !== "low-imd") {
      p.waiting = "low-imd";
      d.save(p);
      await d.notify(`LOW IMD: the hot wallet holds ${fmtImd(bal)} IMD, below ${fmtImd(d.minImdWei)}; ${label(app, p)} waits to order its sound. Top up IMD on Ethereum.`);
    }
    return null;
  }
  const check = await d.swarm.check(action, input);
  const blockers = check.blockers ?? [];
  if (blockers.length) {
    await attention(p, app, d, `the swarm's free check blocks ${action}: ${blockers.map((b) => `${b.code ?? "?"}: ${b.detail ?? ""}`).join("; ")}`);
    return "stop";
  }
  if (action === "job.continue" && check.owner && String(check.owner).toLowerCase() !== d.swarm.payer) {
    await attention(p, app, d, `the project's owner is ${check.owner}, not the hot wallet: a continuation would be refused after payment`);
    return "stop";
  }
  try {
    const before = step.paid.orderId;
    await d.swarm.pay(action, input, step, () => {
      if (step.submitting && !step.submittedAt) step.submittedAt = new Date(d.now()).toISOString();
      d.save(p);
    });
    if (!before) await d.notify(`ORDERED ${label(app, p)}: ${action} paid from the hot wallet, order ${step.paid.orderId}`);
    delete p.waiting;
    d.save(p);
  } catch (e) {
    const err = e as Error & { owner?: string };
    if (err.name === "NeedsApproval") {
      if (p.waiting !== "approval") {
        p.waiting = "approval";
        d.save(p);
        await d.notify(`PERMIT2 APPROVAL NEEDED (once): ${err.message}. ${label(app, p)} waits; it resumes by itself after the approve.`);
      }
      return null;
    }
    throw e;
  }
  return null;
}

export const fmtImd = (wei: bigint) => (Number(wei) / 1e18).toFixed(3);

/** One transition (or none while waiting). Returns true when the stage changed (the caller may step again). */
export async function advance(app: Application, p: Pipeline, d: PipelineDeps): Promise<boolean> {
  const from = p.stage;
  const now = d.now();
  switch (p.stage) {
    case "paid": {
      if (app.kind !== "setup" || !app.payment) return false;
      const entry = await d.register(app);
      p.key = entry.key;
      to(p, "registered", `runtime entry ${entry.key} (pending)`, now);
      d.save(p);
      await d.notify(`PAID ${label(app, p)}: ${usd(app)} in ${app.payment.symbol}; registered as ${entry.key} (pending). Ordering its sound next.`);
      break;
    }
    case "registered": {
      p.baseCommit ??= await d.swarm.baseCommit();
      p.open ??= { paid: newPaidState() };
      d.save(p);
      const body = styleOpenBody({ key: p.key!, genres: app.genres?.length ? app.genres : ["liquid", "acid"], brief: app.vibe ?? "", baseCommit: p.baseCommit, ...(d.styles ? { styles: d.styles } : {}) });
      const job = await payStep(p, app, d, p.open, "job.open", body);
      if (job && job !== "stop") {
        p.jobId = job;
        to(p, "ordered", `job ${job}`, now);
        d.save(p);
      }
      break;
    }
    case "revising": {
      const r = p.revise!;
      const body = styleContinueBody(p.key!, r.parentJobId, r.notes);
      const job = await payStep(p, app, d, r, "job.continue", body);
      if (job && job !== "stop") {
        p.jobId = job;
        delete p.delivery;
        to(p, "ordered", `revision job ${job}`, now);
        d.save(p);
      }
      break;
    }
    case "ordered": {
      const job = await d.swarm.job(p.jobId!);
      if (!JOB_ENDED.has(job.state)) return false;
      const commit = job.delivery?.commit, repoUrl = job.delivery?.repoUrl;
      if (job.state !== "completed" || !commit || !repoUrl) {
        if (job.state === "completed" && !commit && !job.delivery?.failure) return false; // delivery still landing
        await attention(p, app, d, `job ${p.jobId} ended "${job.state}"${job.blockedReason ? ` (${job.blockedReason})` : ""} without a delivered commit`);
        break;
      }
      p.delivery = { repoUrl, commit: String(commit).toLowerCase(), base: (job.base ?? p.baseCommit!).toLowerCase() };
      to(p, "delivered", `commit ${p.delivery.commit.slice(0, 10)}`, now);
      d.save(p);
      break;
    }
    case "delivered": {
      const verdict = await d.gate(p.key!, p.delivery!);
      p.gateRuns++;
      if (verdict.ok) {
        d.publishPack(verdict.pack!);
        d.setEntry(p.key!, { program: p.key!, status: "preview" });
        p.previewAt = new Date(now).toISOString();
        delete p.gateLines;
        to(p, "preview", "gate passed", now);
        d.save(p);
        const pack = verdict.pack!;
        const hours = Math.round(d.autoLiveMs / 3_600_000);
        await d.notify([
          `PREVIEW ${label(app, p)}: "${pack.name}" passed the gate.`,
          `Listen: ${d.siteUrl}/?net=${p.key}`,
          `Genres: ${pack.genres.join(", ")}`,
          ...(verdict.styles ?? []).map((s) => `  ${s}`),
          `Goes live automatically in ${hours} h unless /hold ${p.key}; /live ${p.key} now, /reject ${p.key} to stop.`,
        ].join("\n"));
        break;
      }
      p.gateLines = verdict.lines.slice(0, 20);
      if (!p.revise) {
        const head = (await d.swarm.job(p.jobId!)).head ?? p.jobId!;
        const notes = `The automatic gate failed; fix exactly these and keep everything else:\n${verdict.lines.slice(0, 12).join("\n")}`.slice(0, 1400);
        p.revise = { paid: newPaidState(), notes, parentJobId: head };
        to(p, "revising", "gate failed once: one automatic revision", now);
        d.save(p);
        await d.notify(`GATE FAILED ${label(app, p)} (1 of 2): ordering one automatic revision.\n${verdict.lines.slice(0, 8).join("\n")}`);
        break;
      }
      await attention(p, app, d, `the gate failed again after the revision:\n${verdict.lines.slice(0, 8).join("\n")}`);
      break;
    }
    case "preview": {
      if (p.hold) return false;
      if (now < Date.parse(p.previewAt!) + d.autoLiveMs) return false;
      await goLive(app, p, d, "automatically, no hold after the preview window");
      break;
    }
    default:
      return false;
  }
  return p.stage !== from;
}

/** Puts a preview on air: status live and the included first month from now (as station-add --set-status live). */
export async function goLive(app: Application, p: Pipeline, d: PipelineDeps, why: string) {
  if (p.stage !== "preview") throw new Error(`${p.key} is ${p.stage}, not preview`);
  const now = d.now();
  const entry = d.setEntry(p.key!, { status: "live" });
  const paidUntil = firstPaidUntil({ kind: entry.kind, house: entry.house, paidUntil: entry.paidUntil }, "live", now);
  if (paidUntil) d.setEntry(p.key!, { paidUntil });
  p.liveAt = new Date(now).toISOString();
  to(p, "live", why, now);
  d.save(p);
  await d.notify(`LIVE ${label(app, p)}: on air ${why}${paidUntil ? `; paid until ${paidUntil}` : ""}. ${d.siteUrl}/?net=${p.key}`);
}

/** /hold: no automatic go-live (any stage before live). */
export function hold(p: Pipeline): string {
  if (TERMINAL.includes(p.stage)) return `${p.key ?? p.appId} is ${p.stage}: nothing to hold`;
  p.hold = true;
  return `${p.key ?? p.appId} held at ${p.stage}: it will not go live by itself (/live ${p.key ?? ""} when ready)`;
}

/** /reject: marked failed, the station paused; the refund is manual. */
export async function reject(app: Application, p: Pipeline, d: PipelineDeps) {
  if (p.stage === "rejected") return;
  if (p.key) {
    try {
      d.setEntry(p.key, { status: "paused" });
    } catch {
      /* not registered yet */
    }
  }
  p.reason = "rejected by the owner";
  to(p, "rejected", "rejected by the owner", d.now());
  d.save(p);
  const pay = app.payment;
  await d.notify(
    `REJECTED ${label(app, p)}. Refund by hand: ${usd(app)} paid in ${pay?.symbol ?? "?"} on chain ${pay?.chainId ?? "?"} from ${pay?.from ?? "?"} (tx ${pay?.txHash ?? "?"}); contact ${app.contact?.kind ?? "?"} ${app.contact?.value ?? "?"}.`,
  );
}
