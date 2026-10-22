// The application form on /stations (docs/STATIONS.md "Applications and payment"), shown only in a build with
// VITE_STATIONS_APPLY=1 (stations.ts APPLY_OPEN). Talks to the bot's stations API (bot/src/api, same origin):
// eligibility on blur, then a quote (amounts per stablecoin and chain, the address to pay), then the tx hash, then the
// status. A renewal for a station already in the registry takes the same quote and payment steps.
import { DATA_GENRES, ERAS } from "@swarm-sequencer/synth";
import { API_BASE, CHAIN_LIST, statusOf, type Station, type StatusMap } from "./stations";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const POOL = /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const PAY_POLL_MS = 15_000;
const PAY_POLL_MAX = 60; // 15 minutes of "not mined" / "confirming"

interface Rule { rule: string; status: "pass" | "fail" | "unmeasured"; measured: string; threshold: string }
interface Report { verdict: "pass" | "fail" | "unavailable"; symbol: string | null; pool: string; reasons: string[]; rules: Rule[] }
interface Amount { chainId: number; chain: string; symbol: string; token: string; display: string; confirmations: number }
interface App {
  applicationId: string; kind: "setup" | "renew"; state: "awaiting-payment" | "confirming" | "paid" | "expired";
  expiresAt: string; payTo: string; symbol?: string | null; key?: string; months?: number; paidUntil?: string;
  quote: { totalUsd: string; usd: { feeUsd: number; imd?: { amount: number; priceUsd: number; usd: number } }; amounts: Amount[] };
  pendingTx?: { confirmations: number; required: number };
  payment?: { chainId: number; txHash: string; symbol: string; paidAt: string };
  code?: string; message?: string; error?: string;
}
interface Config { open: boolean; prices: { setupUsd: number; setupImd: number; monthUsd: number; threeMonthsUsd: number }; checkChains: number[]; vibeChars: number }

class ApiError extends Error {
  constructor(readonly status: number, readonly body: any) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

async function api<T>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(API_BASE + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new ApiError(res.status, j);
  return { status: res.status, body: j as T };
}

const chainName = (id: number) => CHAIN_LIST.find(([c]) => c === id)?.[1].name ?? String(id);
const explorer = (id: number) => CHAIN_LIST.find(([c]) => c === id)?.[1].explorer;
const genreName = (g: string) => ERAS.find((e) => e.id === g)?.name ?? g;
const usd = (v: number) => `$${v.toFixed(2).replace(/\.00$/, "")}`;

function copyButton(text: string): string {
  return `<button type="button" class="ap-copy" data-copy="${esc(text)}">COPY</button>`;
}

function wireCopy(root: HTMLElement) {
  root.addEventListener("click", async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(".ap-copy");
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy ?? "");
      b.textContent = "COPIED";
    } catch {
      b.textContent = "SELECT ↖";
    }
    window.setTimeout(() => (b.textContent = "COPY"), 1600);
  });
}

function reportTable(r: Report): string {
  const mark = (s: Rule["status"]) => (s === "pass" ? `<b class="ok">PASS</b>` : s === "fail" ? `<b class="bad">FAIL</b>` : `<b class="na">N/A</b>`);
  const verdict = r.verdict === "pass" ? "ELIGIBLE" : r.verdict === "fail" ? "NOT ELIGIBLE" : "NOT ELIGIBLE · COULD NOT VERIFY";
  return `<div class="table-term ap-report">
    <div class="tt-head">&gt; eligibility · ${esc(r.symbol ?? "token")} · <span class="${r.verdict === "pass" ? "ok" : r.verdict === "fail" ? "bad" : "na"}">${verdict}</span></div>
    <table><tbody>${r.rules.map((x) => `<tr><td>${esc(x.rule)}</td><td>${mark(x.status)} ${esc(x.measured)}<em>${esc(x.threshold)}</em></td></tr>`).join("")}</tbody></table>
    ${r.verdict !== "pass" && r.reasons.length ? `<p class="tt-note">${r.reasons.map(esc).join("<br>")}</p>` : ""}
    ${r.verdict === "unavailable" ? `<p class="tt-note">Every check is automatic: one that cannot be verified counts as not passed. A data source may answer later; checking again in a few minutes is fine.</p>` : ""}
  </div>`;
}

export function mountApply(root: HTMLElement, renewable: Station[], status: StatusMap | null) {
  document.getElementById("st-apply-soon")?.setAttribute("hidden", "");
  root.hidden = false;
  root.innerHTML = `<p class="ap-msg">Loading the application form…</p>`;
  void api<Config>("/config").then(({ body: cfg }) => {
    if (!cfg.open) {
      root.innerHTML = `<p class="st-cta">Applications are closed right now. Follow <a href="https://x.com/theidmfun" target="_blank" rel="noopener">@theidmfun</a></p>`;
      return;
    }
    build(root, cfg, renewable, status);
  }).catch(() => {
    root.innerHTML = `<p class="st-cta">Applications are unavailable right now. Follow <a href="https://x.com/theidmfun" target="_blank" rel="noopener">@theidmfun</a></p>`;
  });
}

function build(root: HTMLElement, cfg: Config, renewable: Station[], status: StatusMap | null) {
  const p = cfg.prices;
  const chains = CHAIN_LIST.filter(([id]) => cfg.checkChains.includes(id));
  const renewKey = new URLSearchParams(location.search).get("renew");
  root.innerHTML = `
  <div class="ap">
    <div class="ap-tabs" role="tablist">
      <button type="button" role="tab" data-mode="new" aria-selected="true">NEW STATION</button>
      <button type="button" role="tab" data-mode="renew" aria-selected="false">RENEW</button>
    </div>
    <form class="ap-form" id="ap-new" novalidate>
      <label>CHAIN<select name="chainId">${chains.map(([id, c]) => `<option value="${id}">${esc(c.name)}</option>`).join("")}</select></label>
      <label>TOKEN<input name="token" placeholder="0x… token address" autocomplete="off" spellcheck="false" inputmode="text" required /></label>
      <label>POOL <span>optional · pair address or v4 pool id; default: the deepest pool</span><input name="pool" placeholder="0x…" autocomplete="off" spellcheck="false" /></label>
      <div class="ap-check" aria-live="polite"></div>
      <label>CONTACT<span class="ap-row"><select name="contactKind"><option value="x">X</option><option value="telegram">Telegram</option><option value="email">Email</option></select><input name="contact" placeholder="@handle" autocomplete="off" required /></span></label>
      <label>VIBE <span class="ap-count">0/${cfg.vibeChars}</span><textarea name="vibe" rows="3" maxlength="${cfg.vibeChars}" placeholder="What should the station sound like? A few words for the swarm." required></textarea></label>
      <fieldset class="ap-genres"><legend>GENRES <span>optional · pick 2 to 5, or leave them to the owner</span></legend>
        ${DATA_GENRES.map((g) => `<label><input type="checkbox" name="genre" value="${g}" /> ${esc(genreName(g))}</label>`).join("")}
      </fieldset>
      <p class="ap-price">Setup: <b>${usd(p.setupUsd)} + ${p.setupImd} IMD</b> at the current IMD price, paid in stablecoins (USDC, USDT, USDT0, USDG) · first month included from the day it goes on air.</p>
      <button type="submit" class="btn-sq">GET A QUOTE ▸</button>
      <p class="ap-msg ap-out" aria-live="polite"></p>
    </form>
    <form class="ap-form" id="ap-renew" hidden novalidate>
      ${renewable.length ? `
      <label>STATION<select name="key">${renewable.map((s) => `<option value="${esc(s.key)}"${s.key === renewKey ? " selected" : ""}>$${esc(s.ticker)} · ${esc(chainName(s.chainId))}${statusOf(s, status) === "expired" ? " · off air" : ""}${status?.[s.key]?.paidUntil ? ` · paid until ${esc(status[s.key].paidUntil!.slice(0, 10))}` : ""}</option>`).join("")}</select></label>
      <fieldset class="ap-months"><legend>RENEW FOR</legend>
        <label><input type="radio" name="months" value="1" checked /> 1 month · <b>${usd(p.monthUsd)}</b></label>
        <label><input type="radio" name="months" value="3" /> 3 months · <b>${usd(p.threeMonthsUsd)}</b></label>
      </fieldset>
      <p class="ap-price">From the current end, or from today if the station is off air. No new setup.</p>
      <button type="submit" class="btn-sq">GET A QUOTE ▸</button>` : `<p class="ap-msg">No station to renew yet.</p>`}
      <p class="ap-msg ap-out" aria-live="polite"></p>
    </form>
    <div class="ap-quote" hidden aria-live="polite"></div>
  </div>`;

  const q = <T extends HTMLElement>(sel: string, el: ParentNode = root) => el.querySelector<T>(sel)!;
  const fNew = q<HTMLFormElement>("#ap-new"), fRenew = q<HTMLFormElement>("#ap-renew"), quoteEl = q<HTMLElement>(".ap-quote");
  wireCopy(root);

  // ---- tabs
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".ap-tabs button")];
  const mode = (m: string) => {
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.mode === m));
    fNew.hidden = m !== "new" || !quoteEl.hidden;
    fRenew.hidden = m !== "renew" || !quoteEl.hidden;
  };
  for (const t of tabs) t.addEventListener("click", () => mode(t.dataset.mode!));
  if (renewKey) mode("renew");

  // ---- eligibility on blur
  const check = q<HTMLElement>(".ap-check", fNew);
  let lastCheck = "";
  const runCheck = async () => {
    const chainId = Number(fNew.chainId.value), token = fNew.token.value.trim(), pool = fNew.pool.value.trim();
    if (!ADDRESS.test(token) || (pool && !POOL.test(pool))) {
      check.innerHTML = token ? `<p class="ap-msg bad">${!ADDRESS.test(token) ? "Token: a 0x address, 40 hex digits." : "Pool: a pair address or a v4 pool id."}</p>` : "";
      return;
    }
    const k = `${chainId}:${token}:${pool}`.toLowerCase();
    if (k === lastCheck) return;
    lastCheck = k;
    check.innerHTML = `<p class="ap-msg">CHECKING ${esc(chainName(chainId).toUpperCase())}… market cap, holders, liquidity, age and a simulated sell (up to a minute)</p>`;
    try {
      const { body } = await api<Report>("/check", { chainId, token, ...(pool ? { pool } : {}) });
      if (k === lastCheck) check.innerHTML = reportTable(body);
    } catch (e) {
      lastCheck = "";
      check.innerHTML = `<p class="ap-msg bad">${esc((e as Error).message)}</p>`;
    }
  };
  for (const n of ["token", "pool"]) (fNew.elements.namedItem(n) as HTMLInputElement).addEventListener("blur", () => void runCheck());
  fNew.chainId.addEventListener("change", () => void runCheck());
  const vibe = fNew.vibe as HTMLTextAreaElement, count = q<HTMLElement>(".ap-count", fNew);
  vibe.addEventListener("input", () => (count.textContent = `${[...vibe.value].length}/${cfg.vibeChars}`));
  fNew.contactKind.addEventListener("change", () => {
    (fNew.contact as HTMLInputElement).placeholder = fNew.contactKind.value === "email" ? "name@example.com" : "@handle";
  });

  // ---- quote requests
  const submit = async (form: HTMLFormElement, path: string, body: unknown) => {
    const msg = q<HTMLElement>(".ap-out", form), btn = q<HTMLButtonElement>("button[type=submit]", form);
    btn.disabled = true;
    msg.className = "ap-msg ap-out";
    msg.textContent = path === "/apply" ? "CHECKING THE TOKEN AND PRICING THE IMD PART…" : "PRICING…";
    try {
      const { body: app } = await api<App & { report?: Report }>(path, body);
      if (app.report) check.innerHTML = reportTable(app.report);
      msg.textContent = "";
      showQuote(app);
    } catch (e) {
      const b = (e as ApiError).body;
      if (b?.report) check.innerHTML = reportTable(b.report);
      msg.className = "ap-msg ap-out bad";
      msg.textContent = (e as Error).message + (b?.retryAfterSec ? ` (retry in ${b.retryAfterSec} s)` : "");
    } finally {
      btn.disabled = false;
    }
  };

  fNew.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const msg = q<HTMLElement>(".ap-out", fNew);
    const token = fNew.token.value.trim(), pool = fNew.pool.value.trim(), contact = fNew.contact.value.trim(), text = vibe.value.trim();
    const genres = [...fNew.querySelectorAll<HTMLInputElement>("input[name=genre]:checked")].map((x) => x.value);
    const problem = !ADDRESS.test(token) ? "Token: a 0x address." : pool && !POOL.test(pool) ? "Pool: a pair address or a v4 pool id." : !contact ? "Contact: an X handle, a Telegram username or an email." : !text ? "Vibe: a few words on the sound." : genres.length === 1 ? "Genres: pick 2 to 5, or none." : "";
    if (problem) {
      msg.className = "ap-msg ap-out bad";
      msg.textContent = problem;
      return;
    }
    void submit(fNew, "/apply", {
      chainId: Number(fNew.chainId.value), token, ...(pool ? { pool } : {}), contact: { kind: fNew.contactKind.value, value: contact },
      vibe: text, ...(genres.length ? { genres } : {}), plan: "setup",
    });
  });
  fRenew.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(fRenew, "/renew", { key: fRenew.key.value, months: Number((fRenew.querySelector("input[name=months]:checked") as HTMLInputElement).value) });
  });

  // ---- quote, payment, status
  let timer = 0;
  function showQuote(app: App) {
    fNew.hidden = fRenew.hidden = true;
    quoteEl.hidden = false;
    const payChains = [...new Set(app.quote.amounts.map((a) => a.chainId))];
    const what = app.kind === "setup" ? `$${esc(app.symbol ?? "TOKEN")} station · setup` : `$${esc(app.key)} · renew ${app.months} month${app.months === 1 ? "" : "s"}`;
    const u = app.quote.usd;
    quoteEl.innerHTML = `
      <div class="table-term big">
        <div class="tt-head">&gt; quote · ${what} · <span class="ap-left"></span></div>
        <table><tbody>
          <tr><td>${app.kind === "setup" ? "setup fee" : "subscription"}</td><td><b>${usd(u.feeUsd)}</b></td></tr>
          ${u.imd ? `<tr><td>swarm</td><td><b>${u.imd.amount} IMD</b> × $${u.imd.priceUsd.toPrecision(4)} = <b>${usd(u.imd.usd)}</b><em>IMD at its current price; the IMD part pays the swarm</em></td></tr>` : ""}
          <tr><td>total</td><td><b>$${esc(app.quote.totalUsd)}</b><em>plus a few millionths that name this quote</em></td></tr>
        </tbody></table>
      </div>
      <div class="table-term ap-pay">
        <div class="tt-head">&gt; pay to · one transfer, exactly one of these amounts</div>
        <p class="ap-addr"><code>${esc(app.payTo)}</code>${copyButton(app.payTo)}</p>
        <table><tbody>${app.quote.amounts.map((a) => `<tr><td>${esc(a.chain)} · ${esc(a.symbol)}</td><td><b>${esc(a.display)}</b> ${copyButton(a.display)}<em>${esc(a.token)}</em></td></tr>`).join("")}</tbody></table>
        <p class="tt-note">Send the exact amount (every digit), from any wallet, before the quote expires. Exchanges that round amounts or batch withdrawals may not work. Then paste the transaction hash below.</p>
      </div>
      <form class="ap-form ap-tx" novalidate>
        <label>PAID ON<select name="chainId">${payChains.map((id) => `<option value="${id}">${esc(chainName(id))}</option>`).join("")}</select></label>
        <label>TRANSACTION HASH<input name="txHash" placeholder="0x… 64 hex digits" autocomplete="off" spellcheck="false" /></label>
        <button type="submit" class="btn-sq">CONFIRM PAYMENT ▸</button>
        <p class="ap-msg ap-state" aria-live="polite"></p>
      </form>
      <p class="ap-id">Application <code>${esc(app.applicationId)}</code>${copyButton(app.applicationId)} · keep it to ask about this payment.</p>`;
    const left = q<HTMLElement>(".ap-left", quoteEl), txForm = q<HTMLFormElement>(".ap-tx", quoteEl), state = q<HTMLElement>(".ap-state", quoteEl);
    const end = Date.parse(app.expiresAt);
    window.clearInterval(timer);
    const tick = () => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      left.textContent = s ? `expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "expired · a transfer already sent still counts for 15 minutes";
    };
    tick();
    timer = window.setInterval(tick, 1000);

    let polls = 0, pollTimer = 0;
    const pay = async (chainId: number, txHash: string) => {
      window.clearTimeout(pollTimer);
      const btn = q<HTMLButtonElement>("button", txForm);
      btn.disabled = true;
      try {
        const { status, body } = await api<App>("/pay", { applicationId: app.applicationId, chainId, txHash });
        if (status === 200) return paid(body);
        state.className = "ap-msg ap-state";
        state.textContent = body.code === "not-mined" ? `NOT FOUND ON ${chainName(chainId).toUpperCase()} YET · CHECKING AGAIN…` : `CONFIRMING · ${body.pendingTx?.confirmations ?? 0}/${body.pendingTx?.required ?? "?"} BLOCKS…`;
        if (++polls < PAY_POLL_MAX) pollTimer = window.setTimeout(() => void pay(chainId, txHash), PAY_POLL_MS);
        else state.textContent = "Still not confirmed. Submit the hash again later; the quote waits for it.";
      } catch (e) {
        state.className = "ap-msg ap-state bad";
        state.textContent = (e as Error).message;
      } finally {
        btn.disabled = false;
      }
    };
    txForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const txHash = txForm.txHash.value.trim();
      if (!TX.test(txHash)) {
        state.className = "ap-msg ap-state bad";
        state.textContent = "Transaction hash: 0x and 64 hex digits.";
        return;
      }
      polls = 0;
      state.className = "ap-msg ap-state";
      state.textContent = "CHECKING THE TRANSACTION…";
      void pay(Number(txForm.chainId.value), txHash);
    });

    function paid(a: App) {
      window.clearInterval(timer);
      const ex = a.payment ? explorer(a.payment.chainId) : undefined;
      const tx = a.payment ? (ex ? `<a href="${esc(ex)}/tx/${esc(a.payment.txHash)}" target="_blank" rel="noopener">${esc(a.payment.symbol)} on ${esc(chainName(a.payment.chainId))} ↗</a>` : esc(a.payment.symbol)) : "";
      left.textContent = "PAID";
      txForm.hidden = true;
      const next = a.kind === "renew"
        ? `The station is paid until <b>${esc(a.paidUntil?.slice(0, 10) ?? "?")}</b>. An off-air station is back within minutes.`
        : "Next: the IMD swarm writes the station's sound, the owner listens, and the station goes on air; the first month starts then. The contact given hears back at each step.";
      q<HTMLElement>(".ap-id", quoteEl).insertAdjacentHTML("beforebegin", `<div class="table-term ap-done"><div class="tt-head">&gt; status · <span class="ok">PAID</span> · ${tx}</div><p class="tt-note">${next}</p></div>`);
    }
  }
}
