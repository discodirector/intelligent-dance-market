// stations.html: every station on air (stations/registry.json), house stations first, then Station+ (status.json).
// Each card is a small LCD in the station's own colours with what it plays now. No audio here: LISTEN opens the player
// on that station, so only one station plays at a time.
import "./style.css";
import "./stations.css";
import { createPublicClient, defineChain, fallback, http, parseAbi, type PublicClient } from "viem";
import type { State } from "@swarm-sequencer/core";
import { epochOf, eraOf, isOn, programFor, styleOf, type Program } from "@swarm-sequencer/synth";
import { NETWORKS } from "./config";
import { startVirtual } from "./data/virtual";
import { decodeSlots, RULES, toSynth } from "./rules";
import { WaveSky, type SkyAudio } from "./sky";
import { API_BASE, APPLY_OPEN, applyTheme, chainOf, isPlus, loadStatus, onAir, playerHref, rpcUrlsOf, STATIONS, type Station } from "./stations";
import { mountApply } from "./stations-apply";

const HOOK_POLL_MS = 15_000;
const raw = parseAbi(["function raw() view returns (uint256 slot0, uint256 slot1)"]);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

interface Card {
  /** What this station plays (its registry program): names the genre · style on the card. */
  program: Program;
  el: HTMLElement;
  now: HTMLElement;
  meta: HTMLElement;
  cells: HTMLElement[];
  dot: HTMLElement;
}

function card(s: Station, i: number, plus: boolean): Card {
  const chain = chainOf(s);
  const el = document.createElement("article");
  el.className = "st";
  // The card's own variables: its LCD, LED and button glow in the station's colours, the page stays as it is.
  applyTheme(s.theme, el);
  const pool = s.kind === "hook" ? "v4 pool · $IDM hook" : s.kind === "nft" ? "ERC-721 · every sale a note, the rules run in the browser" : `${s.kind} pool · no hook, the rules run in the browser`;
  el.innerHTML = `
    <div class="st-top"><span class="silk">STATION ${String(i + 1).padStart(2, "0")}${s.house ? " · HOUSE" : plus ? " · STATION+" : ""}</span><span class="led"></span></div>
    <div class="st-lcd">
      <div class="st-name">$${esc(s.ticker)}</div>
      <div class="st-cells" aria-hidden="true">${"<i></i>".repeat(64)}</div>
      <div class="st-now">TUNING…</div>
      <div class="st-meta">&nbsp;</div>
    </div>
    <dl>
      <dt>CHAIN</dt><dd>${esc(chain.name)}</dd>
      <dt>TOKEN</dt><dd><a href="${chain.explorer}/token/${s.token}" target="_blank" rel="noopener">$${esc(s.ticker)} ↗</a></dd>
      <dt>POOL</dt><dd>${esc(pool)}</dd>
    </dl>
    <div class="st-foot"><span class="st-air"><span class="dot" aria-hidden="true"></span>ON AIR</span><a class="btn-sq" href="${playerHref(s)}">LISTEN ▸</a></div>`;
  const q = (sel: string) => el.querySelector<HTMLElement>(sel)!;
  return { el, program: programFor(s.program), now: q(".st-now"), meta: q(".st-meta"), cells: [...el.querySelectorAll<HTMLElement>(".st-cells i")], dot: q(".dot") };
}

/** Genre · style the player picks for this state (the station's program), the track in progress and the pattern. */
function show(c: Card, s: State) {
  const epoch = epochOf(s);
  const era = eraOf(epoch, c.program);
  c.now.textContent = `${era.name} · ${styleOf(era, epoch, c.program).style.name}`.toUpperCase();
  c.meta.textContent = `TRACK #${(s.trackNo ?? 0) + 1} · ${s.swapCount} SWAPS`;
  // 4 x 16 cells, track by track (kick, snare, hat, glitch): the raw pattern bits (the player grid's dots, not its
  // arranged bar), so no bar clock is needed here.
  c.cells.forEach((cell, k) => cell.classList.toggle("on", isOn(s.pattern, k >> 4, k & 15)));
  c.dot.classList.remove("bad");
  if (c === cards[0]) skyState = s;
}

function fail(c: Card, text: string) {
  c.meta.textContent = text;
  c.dot.classList.add("bad");
}

function client(s: Station): PublicClient {
  const chain = defineChain({ id: s.chainId, name: chainOf(s).name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: rpcUrlsOf(s) } } });
  const urls = rpcUrlsOf(s);
  const transport = urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1 }))) : http(urls[0], { retryCount: 2 });
  return createPublicClient({ chain, transport }) as PublicClient;
}

/** Hook station: the state is on chain, one view call per poll. */
function tuneHook(c: Card, s: Station) {
  const pc = client(s);
  const poll = async () => {
    try {
      const [s0, s1] = await pc.readContract({ address: s.hook!, abi: raw, functionName: "raw" });
      show(c, decodeSlots(s0, s1, RULES.v2));
    } catch (err) {
      fail(c, "RPC ERROR · RETRYING");
      console.warn(err);
    }
    window.setTimeout(poll, HOOK_POLL_MS);
  };
  void poll();
}

/**
 * Hookless station: the same replay the player runs (data/virtual.ts), silent, from the bot's checkpoint when there is
 * one (else from the genesis block); then it follows new blocks. Started only when the card scrolls into view.
 */
function tuneVirtual(c: Card, s: Station) {
  const net = NETWORKS[s.key];
  if (!net?.virtual) return fail(c, "NOT PLAYABLE YET");
  let state: State | null = null;
  let live = false;
  let n = 0;
  c.meta.textContent = "REPLAYING THE POOL…";
  startVirtual(net, {
    onSwap(e) {
      state = e.state;
      n++;
      if (live) show(c, state);
      else if (n % 20 === 0) c.meta.textContent = `${n} SWAPS REPLAYED…`;
    },
    onState(st) {
      if (live || n === 0) state = st;
    },
    onBlock() {},
    onClock() {},
    onStatus(text, ok) {
      if (!ok) return fail(c, "RPC ERROR · RETRYING");
      if (text.endsWith("· live")) {
        live = true;
        if (state) show(c, state);
      }
    },
  });
}

// On air = the registry's live stations minus the expired subscriptions in the bot's status.json (registry alone when
// the file is missing or slow), so the list waits for that one small read before it renders.
const status = await loadStatus();
const stations = onAir(status);
const grid = document.getElementById("st-grid")!;
document.getElementById("st-count")!.textContent = `${stations.length} station${stations.length === 1 ? "" : "s"} · house first, then station+`;
if (APPLY_OPEN) mountApply(document.getElementById("st-apply-form")!, STATIONS.filter((s) => !s.house && !s.gift && s.kind !== "hook"), status);
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    seen.unobserve(e.target);
    const i = cards.findIndex((c) => c.el === e.target);
    const s = stations[i];
    if (s.kind === "hook") tuneHook(cards[i], s);
    else tuneVirtual(cards[i], s);
  }
});
const cards = stations.map((s, i) => card(s, i, isPlus(s, status)));
for (const c of cards) {
  grid.append(c.el);
  seen.observe(c.el);
}

// The player's background, silent: the dithered field drifts with the first station's pattern and bass line.
const sky = new WaveSky(document.getElementById("bg-floor") as HTMLCanvasElement, { ink: [5, 6, 5], bone: [30, 29, 24] });
const silence: SkyAudio = { running: false, timeData: new Uint8Array(0), freqData: new Uint8Array(0), ctx: null };
let skyState: State = RULES.v2.initial();
let skyLast = 0;
requestAnimationFrame(function tick(now) {
  if (now - skyLast > 32) {
    skyLast = now;
    sky.frame(now, toSynth(skyState, RULES.v2), silence);
  }
  requestAnimationFrame(tick);
});

// Price table: STATION / STATION+ tabs (one table each, the other hidden).
const planTabs = [...document.querySelectorAll<HTMLButtonElement>(".st-plan-tabs [role=tab]")];
for (const tab of planTabs) {
  tab.addEventListener("click", () => {
    for (const t of planTabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      document.getElementById(t.getAttribute("aria-controls")!)!.hidden = !on;
    }
  });
}

// Station+ places left (API /config): "ONLY 6 PLACES · 4 LEFT", or FULL. Without the API the badge keeps its text.
void fetch(`${API_BASE}/config`).then((r) => (r.ok ? r.json() : null)).then((cfg: { plus?: { slots: number; left: number } } | null) => {
  const badge = document.getElementById("st-slots");
  if (!badge || !cfg?.plus) return;
  const { slots, left } = cfg.plus;
  badge.classList.toggle("full", left <= 0);
  badge.lastChild!.textContent = left <= 0 ? `ALL ${slots} PLACES TAKEN` : `ONLY ${slots} PLACES · ${left} LEFT`;
}).catch(() => {});
