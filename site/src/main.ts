import "./style.css";
import { initialState, plateLetters, type State } from "@swarm-sequencer/core";
import { ERAS, epochOf, eraOf, FORM_BARS, genreKey, idleStage, programFor, NOTE_NAMES, sectionAt, stepDuration, styleOf, stylesAt, type Era, type Program, type SequencerState } from "@swarm-sequencer/synth";
import { LINKS, NATIVE_ETH, readSource } from "./config";
import { RULES, toSynth } from "./rules";
import { Audio } from "./audio";
import { sevenSeg } from "./sevenseg";
import { dropWalls, moduleWall, updateWalls } from "./wall";
import { WaveSky } from "./sky";
import { drawGrid, drawScope, drawSpectrum, Surface, type Flash } from "./visuals";
import { startLive } from "./data/live";
import { startVirtual } from "./data/virtual";
import { applySkin, applyTheme, chainOf, loadStatus, stationFor } from "./stations";
import { NftScreen } from "./nftscreen";
import { playerMode, type PlayerMode } from "./runtime";
import { EPOCH_PLAY, startReplay } from "./data/replay";
import { formatQuote, inkText, noteNftCues, type Feed, type SwapEvent } from "./data/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TRACKS = ["KICK", "SNARE", "HAT", "GLITCH"];
const source = readSource();
const net = source.net;
const explorer = source.kind === "replay" ? source.replay.explorer : net.explorer;
const rules = RULES[source.rules];
const v2 = rules.heatMax > 0;
document.body.classList.toggle("rules-v2", v2);
/** Registry entry for this pool (stations/registry.json); live, its theme recolours every LCD before the first frame. */
const station = stationFor(net);
if (station && source.kind === "live") {
  applyTheme(station.theme);
  applySkin(station);
}
/**
 * An nft station (kind "nft", core nft.ts): every input is one item sold, named on the feed ("BUY Credit #1234 ·
 * 0.0092 ETH · OpenSea"), and the NFT screen (nftscreen.ts) shows its art on the beat.
 */
const nftItem = station?.kind === "nft" ? station.ticker[0] + station.ticker.slice(1).toLowerCase() : null;
const nftScreen =
  station?.kind === "nft" && source.kind === "live"
    ? new NftScreen($("nft-screen"), net, station.token, nftItem!, { statements: station.nft?.statements, balance: station.nft?.balance })
    : null;
/**
 * A calibrated quote (not ETH: CHOG/MON, INFER/IMD): swaps reach the player valued in ETH (core swaps.ts), but the feed
 * shows them in the pool's own quote, named by the pool label.
 */
const perEth = source.kind === "live" && station?.calibration && Number(station.calibration.quotePerEth) !== 1 ? Number(station.calibration.quotePerEth) : 0;
const quoteName = perEth ? (station!.label.split("/")[1] ?? station!.quoteSymbol) : null;
const shownQuote = (e: SwapEvent) => (perEth ? e.quote * perEth : e.quote);
/**
 * What this station's page may do (runtime.ts playerMode, from the bot's status.json, stations.ts loadStatus):
 * "off-air" = the subscription ran out: the page still shows the state but never plays (PLAY waits for this answer,
 * at most the status read's 2.5 s, and refuses); "preview" = a pipeline station not listed yet, plays, labelled
 * PREVIEW. House stations always play; no status file = the registry, as before.
 */
const mode: Promise<PlayerMode> = station && !station.house && source.kind === "live"
  ? loadStatus().then((st) => playerMode(station, st?.[station.key]?.status))
  : Promise.resolve("live");
const offAir: Promise<boolean> = mode.then((m) => m === "off-air");

// ---------------------------------------------------------------- state
let state: State = initialState();
let clock: number | null = null; // virtual unix seconds in replay; null = wall clock
let block = 0;
let lastEpoch: number | null = null;
const events: SwapEvent[] = [];
const flashes: Flash[] = [];
const counts = { buys: 0, sells: 0, whales: 0 };
/**
 * What this page plays (synth program.ts): genre order and style lists for the player, the epoch lines, the rack and
 * the genre count. The house stations ($IDM, IMD/ETH) play the house program; a station from the registry plays its
 * pack's (synth stations/index.ts), and everything below follows it.
 */
const program: Program = programFor(station?.program ?? "idm");
/** The genres this program ever plays: the rack shows only these. */
const programGenres = new Set(program.eras.flatMap((e) => e.ids));
const RACK = ERAS.filter((era) => programGenres.has(era.id));
const audio = new Audio(program);
let eraOverride: string | null = null;
/** Testnets and replays let a listener audition genres; the mainnet live view plays only what the chain picks. */
const canAudition = !(source.kind === "live" && net.mainnet);
const nowSec = () => clock ?? Date.now() / 1000;
const asSynth = (s: State): SequencerState => toSynth(s, rules);
let drops = 0;

// ---------------------------------------------------------------- terminal
const log = $<HTMLOListElement>("log");
const MAX_LINES = 400;
const short = (h: string) => `${h.slice(0, 4)}…${h.slice(-2)}`;
const hhmm = (ts: number) => {
  const d = new Date(ts * 1000);
  // UTC: one clock for every viewer and for the explorer.
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

function pushLine(li: HTMLLIElement) {
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.append(li);
  while (log.childElementCount > MAX_LINES) log.firstElementChild!.remove();
  if (stick) log.scrollTop = log.scrollHeight;
}

// Swaps sent by the pulse treasury (an automatic buy after 15 min of silence) are labelled, never passed off as trades.
const pulseTag = (e: SwapEvent) => (e.pulse ? ` <span class="tag pulse">PULSE · treasury buy</span>` : "");

/**
 * An nft station's sale as the feed says it: "BUY Credit #1234 · 0.0092 ETH · OpenSea · RATING 132 · CK", a compose
 * "COMPOSE · 80 Credits → page #563 · 0.74 ETH", a withdraw "LOCK · page #144 → 29,958 BALANCE · C24 M23 Y24 K27".
 * Everything comes from the decoder (digits, plate letters and a fixed venue name).
 */
function nftWhat(e: SwapEvent): string {
  const n = e.nft!;
  const amt = formatQuote(e.quote);
  if (n.via === "compose") return `<span class="sd">COMPOSE</span> · ${n.items ?? 80} ${nftItem}s → page #${n.id} · ${amt} ETH`;
  if (n.via === "withdraw") return `<span class="sd">LOCK</span> · page #${n.id} → ${(n.points ?? 0).toLocaleString("en-US")} ${n.venue}${n.ink ? ` · ${inkText(n.ink)}` : ""}`;
  const rating = n.rating !== undefined && n.mask ? ` · RATING ${Math.floor(n.rating / 10)} · ${plateLetters(n.mask)}` : "";
  return `<span class="sd">${e.isBuy ? "BUY " : "SELL"}</span> ${nftItem} #${n.id} · ${amt} ETH · ${n.venue}${rating}`;
}

function swapLine(e: SwapEvent) {
  const li = document.createElement("li");
  li.className = (e.whale ? "whale" : e.isBuy ? "buy" : "sell") + (e.pulse ? " pulse" : "");
  li.title = new Date(e.ts * 1000).toISOString();
  const side = e.isBuy ? "BUY " : "SELL";
  const amt = formatQuote(shownQuote(e)).padStart(8, " ");
  const tag = (e.whale ? ` <span class="tag">${e.isBuy ? "FILL" : "DROP"}</span>` : "") + pulseTag(e);
  const tx = e.tx ? `<a href="${explorer}/tx/${e.tx}" target="_blank" rel="noopener">${short(e.tx)}</a>` : "";
  const what = e.nft ? nftWhat(e) : `<span class="sd">${side}</span> ${amt} ${quoteName ?? e.quoteSymbol}`;
  li.innerHTML =
    `<span class="p">&gt;</span> <span class="t">${hhmm(e.ts)}</span>  ${what}  ` +
    `<span class="trk">${TRACKS[e.track].padEnd(6, " ")}</span> s${String(e.step + 1).padStart(2, "0")} <span class="pm">${e.on ? "+" : "−"}</span>${tag}  ${tx}  ` +
    `<a class="blk" href="${explorer}/block/${e.block}" target="_blank" rel="noopener">blk ${e.block}</a>`;
  pushLine(li);
}

// The player's own last-swap window: one line, the newest swap.
const tape = $<HTMLOListElement>("tape");
const TAPE_LINES = 1;
function tapeLine(html: string, cls: string) {
  const li = document.createElement("li");
  li.className = cls;
  li.innerHTML = html;
  if (tape.firstElementChild?.classList.contains("sys") && !tape.firstElementChild.classList.contains("track")) tape.firstElementChild.remove();
  tape.prepend(li);
  while (tape.childElementCount > TAPE_LINES) tape.lastElementChild!.remove();
}
function tapeSwap(e: SwapEvent) {
  const side = e.isBuy ? "BUY " : "SELL";
  const tag = (e.whale ? ` <span class="tag">${e.isBuy ? "FILL" : "DROP"}</span>` : "") + pulseTag(e);
  const tx = e.tx ? ` <a href="${explorer}/tx/${e.tx}" target="_blank" rel="noopener">${short(e.tx)}</a>` : "";
  const what = e.nft ? nftWhat(e) : `<span class="sd">${side}</span> ${formatQuote(shownQuote(e)).padStart(8, " ")} ${quoteName ?? e.quoteSymbol}`;
  tapeLine(
    `<span class="t">${hhmm(e.ts)}</span> ${what} ` +
      `<span class="trk">${TRACKS[e.track].padEnd(7, " ")}</span>s${String(e.step + 1).padStart(2, "0")} <span class="pm">${e.on ? "+" : "−"}</span>${tag}${tx}`,
    e.whale ? "whale" : e.isBuy ? "buy" : "sell",
  );
}

function systemLine(text: string, cls = "sys") {
  const li = document.createElement("li");
  li.className = cls;
  li.innerHTML = `<span class="p">#</span> ${text}`;
  pushLine(li);
}

// ---------------------------------------------------------------- feed
const panel = $("panel");
let panelFlashTimer = 0;

const feed: Feed = {
  onSwap(e, backfill) {
    events.push(e);
    if (events.length > 5000) events.splice(0, events.length - 5000);
    e.isBuy ? counts.buys++ : counts.sells++;
    if (e.whale) counts.whales++;
    const epoch = epochOf(e.state);
    if (lastEpoch !== null && epoch !== lastEpoch) systemLine(`EPOCH #${epoch} · ${eraOf(epoch, program).name.toUpperCase()}`, "sys epoch");
    lastEpoch = epoch;
    swapLine(e);
    tapeSwap(e);
    nftScreen?.push(e, !backfill);
    // The backfill replays history after onState showed the current hook state: never step the grid back.
    // (A replay restarts its tape at a lower swapCount, so only the backfill is guarded.)
    if (!backfill || e.state.swapCount >= state.swapCount) state = e.state;
    const tc = e.trackComplete;
    if (tc) {
      drops++;
      systemLine(`TRACK #${tc.trackNo} COMPLETE · ${tc.swaps} SWAPS`, "sys track");
      tapeLine(`TRACK #${tc.trackNo} COMPLETE · ${tc.swaps} SWAPS`, "sys track");
    }
    const now = performance.now();
    {
      flashes.push({ track: e.track, step: e.step, row: e.whale, color: e.whale ? "whale" : e.isBuy ? "buy" : "sell", at: backfill ? now - 400 : now });
      if (flashes.length > 24) flashes.shift();
    }
    if (!backfill) {
      if (audio.running) {
        audio.player!.setState(asSynth(state));
        if (e.whale) audio.player!.noteDrop({ track: e.track, fill: e.isBuy });
        if (tc) audio.player!.noteTrackDrop(asSynth(tc.held));
        noteNftCues(audio.player!, e);
      }
      if (tc) trackDrop(now);
      if (e.whale) {
        panel.classList.remove("hit");
        void panel.offsetWidth;
        panel.classList.add("hit");
        clearTimeout(panelFlashTimer);
        panelFlashTimer = window.setTimeout(() => panel.classList.remove("hit"), 900);
      }
    }
    updateCounts();
  },
  onState(s) {
    if (s.swapCount >= state.swapCount) state = s;
    if (lastEpoch === null) lastEpoch = epochOf(s);
    audio.player?.setState(asSynth(state));
  },
  onBlock(n) {
    block = n;
    $("sb-block").textContent = n.toLocaleString("en-US");
  },
  onStatus(text, ok) {
    $("net-status").textContent = text.toUpperCase();
    for (const id of ["net-dot", "sb-dot"]) $(id).classList.toggle("bad", !ok);
  },
  onClock(c) {
    clock = c;
    audio.player?.setClock(c);
  },
};

// v2 drop moment: the module and grid flash, every row lights, walls strobe, the background rings out.
const lcd = document.querySelector<HTMLElement>(".lcd-main")!;
let dropTimer = 0;
function trackDrop(now: number) {
  for (let track = 0; track < 4; track++) flashes.push({ track, step: 0, row: true, color: "whale", at: now });
  while (flashes.length > 24) flashes.shift();
  for (const el of [panel, lcd]) {
    el.classList.remove("drop");
    void el.offsetWidth;
    el.classList.add("drop");
  }
  clearTimeout(dropTimer);
  dropTimer = window.setTimeout(() => { panel.classList.remove("drop"); lcd.classList.remove("drop"); }, 1600);
  dropWalls();
  bg.drop();
}

function updateCounts() {
  $("c-swaps").textContent = String(events.length);
  $("c-buys").textContent = String(counts.buys);
  $("c-sells").textContent = String(counts.sells);
  $("c-whales").textContent = String(counts.whales);
  $("sb-swaps").textContent = String(state.swapCount);
}

// ---------------------------------------------------------------- readouts
const seg = {
  bpm: sevenSeg($("seg-bpm"), 3),
  key: sevenSeg($("seg-key"), 2),
  mode: sevenSeg($("seg-mode"), 3),
  swap: sevenSeg($("seg-swap"), 5),
  page: sevenSeg($("seg-page"), 3),
  epoch: sevenSeg($("seg-epoch"), 2),
  track: sevenSeg($("seg-track"), 3),
};
const heatSegs = $("heat-bar");
heatSegs.innerHTML = "<i></i>".repeat(RULES.v2.heatMax);
const heatLeds = [...heatSegs.children] as HTMLElement[];
/** KEY/MODE show what sounds: the genre's tonic for this epoch, minor when its note set has a minor third. */
function updateReadouts(bpm: number, era: Era) {
  const note = NOTE_NAMES[genreKey(era, epochOf(state))];
  seg.bpm(String(Math.round(bpm)));
  seg.key(note[0] + " ", note.includes("#") ? [0] : []);
  seg.mode(era.notes.includes(3) ? "min" : "---");
  seg.swap(String(state.swapCount % 100000));
  seg.page(String(state.patternId % 1000));
  seg.epoch(String(epochOf(state) % 100));
  if (v2) {
    seg.track(String(((state.trackNo ?? 0) + 1) % 1000));
    const heat = Math.min(rules.heatMax, state.heat ?? 0);
    heatLeds.forEach((b, i) => b.classList.toggle("on", i < heat));
    $("heat-label").textContent = `${String(heat).padStart(2, "0")}/${rules.heatMax}`;
  }
}

// ---------------------------------------------------------------- controls
const playBtn = $<HTMLButtonElement>("play");
async function setPlaying(on: boolean) {
  if (on && (await offAir)) return;
  if (on) {
    await audio.start(asSynth(state), clock);
    audio.player!.setEraOverride(eraOverride);
  } else audio.stop();
  playBtn.setAttribute("aria-pressed", String(on));
  playBtn.querySelector(".play-label")!.textContent = on ? "STOP" : "PLAY";
  document.body.classList.toggle("playing", on);
}
playBtn.addEventListener("click", () => {
  if (!audio.running) audio.unlock(); // in the gesture, before setPlaying's awaits (iOS)
  void setPlaying(!audio.running);
});

const knob = $("knob");
function setKnob(v: number) {
  audio.setVolume(v);
  const vv = audio.getVolume();
  knob.style.setProperty("--rot", `${-135 + vv * 270}deg`);
  knob.setAttribute("aria-valuenow", String(Math.round(vv * 100)));
}
setKnob(0.75);
let drag: { y: number; v: number } | null = null;
knob.addEventListener("pointerdown", (e) => {
  drag = { y: e.clientY, v: audio.getVolume() };
  knob.setPointerCapture(e.pointerId);
});
knob.addEventListener("pointermove", (e) => drag && setKnob(drag.v + (drag.y - e.clientY) / 160));
knob.addEventListener("pointerup", () => (drag = null));
knob.addEventListener("wheel", (e) => { e.preventDefault(); setKnob(audio.getVolume() - e.deltaY / 1000); }, { passive: false });
knob.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key === "ArrowRight") setKnob(audio.getVolume() + 0.05);
  if (e.key === "ArrowDown" || e.key === "ArrowLeft") setKnob(audio.getVolume() - 0.05);
});

/** Genres in the rotation at this epoch: the program's last genre-schedule entry in force, so the copy follows new genres. */
let shownGenres = -1;
function showGenreCount(epoch: number) {
  let ids = program.eras[0].ids;
  for (const entry of program.eras) if (entry.fromEpoch <= epoch) ids = entry.ids;
  if (ids.length === shownGenres) return;
  shownGenres = ids.length;
  for (const el of document.querySelectorAll(".n-genres")) el.textContent = String(ids.length);
}
showGenreCount(0);

// ---------------------------------------------------------------- eras rack
const rack = $("rack");
rack.innerHTML = RACK.map(
  (era) => `
  <article class="era" data-id="${era.id}">
    <div class="era-top"><span class="led"></span><span class="era-no">${String(era.index + 1).padStart(2, "0")}</span></div>
    <h3>${era.name}</h3>
    <dl>
      <dt>BASS</dt><dd>${era.bassMode}</dd><dt>PAD</dt><dd>${era.padMode}</dd>
      <dt>LEAD</dt><dd>${era.leadMode}</dd><dt>KIT</dt><dd>${era.snare}/${era.hat}</dd>
      <dt>SWING</dt><dd>${Math.round(era.swing * 100)}%</dd>
      <dt>STYLES</dt><dd class="styles" data-genre="${era.id}"></dd>
    </dl>
    ${canAudition ? `<button class="btn-sq audition" data-id="${era.id}">AUDITION</button>` : ""}
  </article>`,
).join("");
/**
 * The rack lists each genre's styles in force at the chain epoch (the program's style lists); redrawn when a list
 * changes. A station program naming fewer genres shows only those (RACK).
 */
let rackStylesKey = "";
function rackStyles(epoch: number) {
  const lists = RACK.map((era) => stylesAt(era.id, epoch, program));
  const key = lists.map((l) => l.map((st) => st.id).join(",")).join("|");
  if (key === rackStylesKey) return;
  rackStylesKey = key;
  RACK.forEach((era, i) => {
    const dd = rack.querySelector<HTMLElement>(`.styles[data-genre="${era.id}"]`);
    if (dd) dd.innerHTML = lists[i].map((st) => `<span data-style="${st.id}">${st.name}</span>`).join(" · ");
  });
}
rackStyles(0);
rack.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".audition");
  if (!btn) return;
  if (!audio.running) audio.unlock(); // in the gesture (iOS)
  eraOverride = eraOverride === btn.dataset.id ? null : btn.dataset.id!;
  if (!audio.running) await setPlaying(true);
  audio.player!.setEraOverride(eraOverride);
});
if (!canAudition) {
  $("era-follow").remove();
  $("rack-note").textContent = "the market picks which one plays";
}
$("era-follow")?.addEventListener("click", () => {
  eraOverride = null;
  audio.player?.setEraOverride(null);
});

// ---------------------------------------------------------------- onchain panel
function ocRow(label: string, value: string, links: [string, string][] = []) {
  return `<div class="oc"><span class="oc-k">${label}</span><span class="oc-v">${value}</span><span class="oc-l">${links
    .map(([t, h]) => `<a href="${h}" target="_blank" rel="noopener">${t} ↗</a>`)
    .join("")}</span></div>`;
}
const addr = (a: string | null, kind: "address" | "token" = "address") =>
  a ? ([["explorer", `${net.explorer}/${kind}/${a}`]] as [string, string][]) : [];
const src = (a: string | null) => (a && net.sourcify ? ([["sourcify", `${net.sourcify}/${a}`]] as [string, string][]) : []);
$("oc-grid").innerHTML = [
  ocRow("CHAIN", `${net.label} · id ${net.chainId}`),
  net.virtual
    ? ocRow("HOOK", `none on this ${net.virtual.source.kind === "nft" ? "collection" : "pool"} · the $IDM rules run in your browser`)
    : ocRow("HOOK", net.hook ?? "pending launch", [...addr(net.hook), ...src(net.hook)]),
  ocRow(`${net.virtual?.source.kind === "nft" ? "COLLECTION" : "TOKEN"} $${net.virtual?.tokenSymbol ?? "IDM"}`, net.token ?? "pending launch", [...addr(net.token, "token"), ...src(net.token)]),
  net.quote === NATIVE_ETH
    ? ocRow("PAIRED WITH", net.virtual?.source.kind === "nft" ? "ETH (WETH bids included) · one note per item sold" : "native ETH")
    : ocRow(`PAIRED WITH $${quoteName ?? net.quoteSymbol}`, net.quote ?? "—", addr(net.quote, "token")),
  ...(net.virtual?.source.kind === "nft"
    ? (() => {
      const s = net.virtual.source;
      const venues: [string, `0x${string}` | undefined][] = [["SEAPORT (OPENSEA)", s.seaport?.[0]], ["CREDITSTRATEGY", s.strategy], ["CORE", s.core], ["STATEMENTS · COMPOSE", s.statements]];
      return venues.filter(([, a]) => a).map(([k, a]) => ocRow(k, a!, addr(a!)));
    })()
    : net.virtual && net.virtual.source.kind !== "v4"
    ? [ocRow("POOL", `${net.virtual.source.kind} · ${net.virtual.source.address}`, addr(net.virtual.source.address))]
    : [ocRow("POOL ID", net.poolId ?? "pending launch"), ocRow("POOL MANAGER", net.poolManager ?? "—", addr(net.poolManager))]),
  ocRow("LAUNCH", net.launchedBy, net.launchUrl ? [["job", net.launchUrl]] : [["imd.fun", LINKS.imd]]),
  ocRow("SOURCE", "discodirector/intelligent-dance-market", [["github", LINKS.github]]),
  ocRow("X", LINKS.x ?? "account soon", LINKS.x ? [["x.com", LINKS.x]] : []),
].join("");
$("onchain-sub").textContent =
  source.kind === "replay" ? `showing a replay · live contracts on ${net.label.toLowerCase()}` : `live on ${net.label.toLowerCase()}`;

// ---------------------------------------------------------------- source switch + walls
// The header's STATIONS button opens the station list; the station on air here is named on the panel itself.
// On a ?replay= URL a LIVE button leads back to live.
const switchLink = $<HTMLAnchorElement>("src-switch");
if (source.kind === "live") {
  $("station-tag").hidden = false;
  $("station-name").textContent = station ? `$${station.ticker}` : net.label;
  $("station-chain").textContent = (station ? chainOf(station).name : net.label).toUpperCase();
  // Preview: labelled. Off air (offAir above): marked, the way back linked, PLAY disabled; the panel keeps following
  // the pool.
  void mode.then((m) => {
    if (m === "preview") $("station-tag").querySelector(".silk")!.textContent = "PREVIEW";
    if (m !== "off-air" || !station) return;
    $("station-tag").querySelector(".silk")!.textContent = "OFF AIR";
    $("station-tag").insertAdjacentHTML("beforeend", `<a class="off" href="/stations?renew=${encodeURIComponent(station.key)}#apply" title="Off air: the subscription ran out">RENEW ▸</a>`);
    playBtn.disabled = true;
    playBtn.title = "Off air: the subscription ran out";
    playBtn.querySelector(".play-label")!.textContent = "OFF AIR";
    document.body.classList.add("off-air");
  });
}
if (source.kind === "replay") {
  switchLink.hidden = false;
  switchLink.textContent = `LIVE ${net.label}`;
  switchLink.href = `${location.pathname}?net=${net.key}`;
  $("src-label").textContent = source.replay.label + (v2 ? " · RULES V2" : "");
} else $("src-label").textContent = `LIVE · ${net.label}` + (v2 ? " · RULES V2" : "");
$("sb-net").textContent = source.kind === "replay" ? "REPLAY" : net.label;
// Desktop: the hero is one fixed-size device (CSS .stage), never rescaled by script, so browser zoom behaves
// normally. The walls get exactly as many rows as the module is tall, so both end flush with it.
let wallRows = 0;
function fitWalls() {
  const rows = Math.max(4, Math.round(($("panel").offsetHeight + 4) / 74));
  if (rows === wallRows) return;
  wallRows = rows;
  moduleWall($("wall-left"), rows, 7);
  moduleWall($("wall-right"), rows, 11);
}
fitWalls();
new ResizeObserver(fitWalls).observe($("panel"));

// ---------------------------------------------------------------- render loop
const grid = new Surface($<HTMLCanvasElement>("grid"));
const scope = new Surface($<HTMLCanvasElement>("scope"));
const spectrum = new Surface($<HTMLCanvasElement>("spectrum"));
// The page background: a flat dithered field over the whole viewport, fed by the same audio.
const bg = new WaveSky($<HTMLCanvasElement>("bg-floor"), { ink: [5, 6, 5], bone: [30, 29, 24] });
let bgLast = 0;
const vu = $("vu");
vu.innerHTML = "<i></i>".repeat(12);
const vuBars = [...vu.children] as HTMLElement[];
const idleLis = [...$("idle-leds").children] as HTMLElement[];
const t0 = performance.now();
let lastSlow = 0;
let level = 0;

function frame(now: number) {
  let step: number, phase: number, bpm: number, bar: number;
  if (audio.running) {
    const tv = audio.player!.getTransport();
    step = tv.step;
    bar = tv.bar;
    phase = tv.phase;
    bpm = tv.bpm;
  } else {
    const d = stepDuration(state.bpm);
    const t = (now - t0) / 1000 / d;
    step = Math.floor(t) % 16;
    bar = Math.floor(t / 16);
    phase = t % 1;
    bpm = state.bpm;
  }
  while (flashes.length && now - flashes[0].at > 1200) flashes.shift();
  drawGrid(grid, asSynth(state), step, bar, phase, flashes, now);
  nftScreen?.tick(bar * 16 + step);

  const rms = audio.sample();
  level = Math.max(rms * 3, level * 0.9);
  drawScope(scope, audio.running ? audio.timeData : null);
  drawSpectrum(spectrum, audio.running ? audio.freqData : null, audio.ctx?.sampleRate ?? 44100);
  const lit = Math.round(Math.min(1, level) * vuBars.length);
  vuBars.forEach((b, i) => b.classList.toggle("on", i < lit));

  if (now - bgLast > 32) {
    bgLast = now;
    bg.frame(now, asSynth(state), audio);
  }

  if (now - lastSlow > 66) {
    lastSlow = now;
    updateWalls((now - t0) / 1000, level, step, audio.running ? audio.freqData : null);
    const era = audio.running ? audio.player!.getEra() : { ...eraOf(epochOf(state), program), epoch: epochOf(state), fading: false };
    const shown = eraOverride ? ERAS.find((e) => e.id === eraOverride)! : era;
    updateReadouts(bpm, ERAS.find((e) => e.id === shown.id)!);
    // The style the engine plays: an audition keeps the chain epoch, so styleOf picks exactly as the engine does.
    const style = styleOf(ERAS.find((e) => e.id === shown.id)!, era.epoch, program).style;
    rackStyles(era.epoch);
    $("era-name").textContent = shown.name.toUpperCase();
    const part = audio.running ? ` · ${sectionAt(bar).name.toUpperCase()} ${(bar % FORM_BARS) + 1}/${FORM_BARS}` : "";
    const styleTag = `STYLE ${style.name.toUpperCase()} · `;
    $("era-sub").textContent = eraOverride ? `${styleTag}AUDITION · CHAIN EPOCH ${epochOf(state)}${part}` : `${styleTag}EPOCH ${epochOf(state)}${era.fading ? " · CROSSFADE" : ""}${part || " · FOLLOWING CHAIN"}`;
    for (const el of rack.children) {
      const id = (el as HTMLElement).dataset.id;
      el.classList.toggle("current", id === era.id && !eraOverride);
      el.classList.toggle("audition-on", id === eraOverride);
      for (const s of el.querySelectorAll<HTMLElement>("[data-style]")) s.classList.toggle("on", id === shown.id && s.dataset.style === style.id);
    }
    const idle = idleStage(state, nowSec());
    const order = ["full", "thinning", "sparse", "drone"];
    idleLis.forEach((li) => li.classList.toggle("on", order.indexOf(li.dataset.stage!) <= order.indexOf(idle.stage)));
    $("idle-label").textContent = state.lastTs ? idle.label : "NO SWAPS YET";
    $("sb-bpm").textContent = String(Math.round(bpm));
    $("sb-epoch").textContent = String(epochOf(state));
    showGenreCount(epochOf(state));
    $("sb-era").textContent = `${shown.name} · ${style.name}`;
    sparkline();
  }
  requestAnimationFrame(frame);
}

let sparkKey = "";
function sparkline() {
  const end = nowSec();
  const buckets = new Array(48).fill(0);
  for (const e of events) {
    const age = end - e.ts;
    if (age >= 0 && age < 86400) buckets[47 - Math.floor(age / 1800)]++;
  }
  const key = buckets.join(",");
  if (key === sparkKey) return;
  sparkKey = key;
  const max = Math.max(1, ...buckets);
  $("sb-spark").innerHTML = buckets
    .map((v, i) => `<rect x="${i * 2.5}" y="${14 - Math.max(v ? 2 : 0.6, (v / max) * 14)}" width="1.6" height="${Math.max(v ? 2 : 0.6, (v / max) * 14)}"/>`)
    .join("");
}

// ---------------------------------------------------------------- boot
systemLine(
  (source.kind === "replay" ? `${source.replay.label} · ${EPOCH_PLAY[0]}–${EPOCH_PLAY[1]} s per genre` : net.virtual && station ? `${net.label} · ${station.label} ${station.kind === "nft" ? "collection" : "pool"} on ${chainOf(station).name}${station.kind === "nft" ? " · one note per item sold" : ""} · no hook, the $IDM rules run here` : `${net.label} · hook ${net.hook ? short(net.hook) : "pending"}`) +
    (v2 ? ` · rules v2${source.kind === "replay" && source.resim ? " (re-simulated)" : ""}` : ""),
);
requestAnimationFrame(frame);
if (source.kind === "replay") {
  startReplay(source.replay.url, source.speed, source.replay.label, feed, rules, source.resim, source.replay.epochPlay).catch((e) => feed.onStatus(`replay failed: ${e.message}`, false));
} else if (net.virtual) startVirtual(net, feed);
else startLive(net, feed);

// Hooks for the headless check (scripts/check.mjs).
(window as unknown as { __site: unknown }).__site = {
  audio,
  swaps: () => events.length,
  rules: () => rules.version,
  heat: () => state.heat ?? null,
  trackNo: () => state.trackNo ?? null,
  drops: () => drops,
  play: () => setPlaying(true),
  level: () => {
    audio.sample();
    let dev = 0;
    for (const v of audio.timeData) dev = Math.max(dev, Math.abs(v - 128));
    const spec = audio.freqData.reduce((a, b) => a + b, 0);
    return { dev, spec, running: audio.running };
  },
};
