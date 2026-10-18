import "./style.css";
import { initialState, type State } from "@swarm-sequencer/core";
import { ERA_SCHEDULE, ERAS, epochOf, eraOf, FORM_BARS, genreKey, idleStage, NOTE_NAMES, sectionAt, stepDuration, styleOf, stylesAt, type Era, type SequencerState } from "@swarm-sequencer/synth";
import { LINKS, NATIVE_ETH, NETWORKS, readSource } from "./config";
import { RULES, toSynth } from "./rules";
import { Audio } from "./audio";
import { sevenSeg } from "./sevenseg";
import { dropWalls, moduleWall, updateWalls } from "./wall";
import { WaveSky } from "./sky";
import { drawGrid, drawScope, drawSpectrum, Surface, type Flash } from "./visuals";
import { startLive } from "./data/live";
import { EPOCH_PLAY, startReplay } from "./data/replay";
import { formatQuote, type Feed, type SwapEvent } from "./data/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TRACKS = ["KICK", "SNARE", "HAT", "GLITCH"];
const source = readSource();
const net = source.net;
const explorer = source.kind === "replay" ? source.replay.explorer : net.explorer;
const rules = RULES[source.rules];
const v2 = rules.heatMax > 0;
document.body.classList.toggle("rules-v2", v2);

// ---------------------------------------------------------------- state
let state: State = initialState();
let clock: number | null = null; // virtual unix seconds in replay; null = wall clock
let block = 0;
let lastEpoch: number | null = null;
const events: SwapEvent[] = [];
const flashes: Flash[] = [];
const counts = { buys: 0, sells: 0, whales: 0 };
const audio = new Audio();
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
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function pushLine(li: HTMLLIElement) {
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.append(li);
  while (log.childElementCount > MAX_LINES) log.firstElementChild!.remove();
  if (stick) log.scrollTop = log.scrollHeight;
}

// Swaps sent by the pulse treasury (an automatic buy after 15 min of silence) are labelled, never passed off as trades.
const pulseTag = (e: SwapEvent) => (e.pulse ? ` <span class="tag pulse">PULSE · treasury buy</span>` : "");

function swapLine(e: SwapEvent) {
  const li = document.createElement("li");
  li.className = (e.whale ? "whale" : e.isBuy ? "buy" : "sell") + (e.pulse ? " pulse" : "");
  li.title = new Date(e.ts * 1000).toISOString();
  const side = e.isBuy ? "BUY " : "SELL";
  const amt = formatQuote(e.quote).padStart(8, " ");
  const tag = (e.whale ? ` <span class="tag">${e.isBuy ? "FILL" : "DROP"}</span>` : "") + pulseTag(e);
  const tx = e.tx ? `<a href="${explorer}/tx/${e.tx}" target="_blank" rel="noopener">${short(e.tx)}</a>` : "";
  li.innerHTML =
    `<span class="p">&gt;</span> <span class="t">${hhmm(e.ts)}</span>  <span class="sd">${side}</span> ${amt} ${e.quoteSymbol}  ` +
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
  tapeLine(
    `<span class="t">${hhmm(e.ts)}</span> <span class="sd">${side}</span> ${formatQuote(e.quote).padStart(8, " ")} ${e.quoteSymbol} ` +
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
    if (lastEpoch !== null && epoch !== lastEpoch) systemLine(`EPOCH #${epoch} · ${eraOf(epoch).name.toUpperCase()}`, "sys epoch");
    lastEpoch = epoch;
    swapLine(e);
    tapeSwap(e);
    state = e.state;
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
  if (on) {
    await audio.start(asSynth(state), clock);
    audio.player!.setEraOverride(eraOverride);
  } else audio.stop();
  playBtn.setAttribute("aria-pressed", String(on));
  playBtn.querySelector(".play-label")!.textContent = on ? "STOP" : "PLAY";
  document.body.classList.toggle("playing", on);
}
playBtn.addEventListener("click", () => void setPlaying(!audio.running));

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

/** Genres in the rotation at this epoch: the last ERA_SCHEDULE entry already in force, so the copy follows new genres. */
let shownGenres = -1;
function showGenreCount(epoch: number) {
  let ids = ERA_SCHEDULE[0].ids;
  for (const entry of ERA_SCHEDULE) if (entry.fromEpoch <= epoch) ids = entry.ids;
  if (ids.length === shownGenres) return;
  shownGenres = ids.length;
  for (const el of document.querySelectorAll(".n-genres")) el.textContent = String(ids.length);
}
showGenreCount(0);

// ---------------------------------------------------------------- eras rack
const rack = $("rack");
rack.innerHTML = ERAS.map(
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
/** The rack lists each genre's styles in force at the chain epoch (STYLE_SCHEDULE); redrawn when a list changes. */
let rackStylesKey = "";
function rackStyles(epoch: number) {
  const lists = ERAS.map((era) => stylesAt(era.id, epoch));
  const key = lists.map((l) => l.map((st) => st.id).join(",")).join("|");
  if (key === rackStylesKey) return;
  rackStylesKey = key;
  ERAS.forEach((era, i) => {
    const dd = rack.querySelector<HTMLElement>(`.styles[data-genre="${era.id}"]`);
    if (dd) dd.innerHTML = lists[i].map((st) => `<span data-style="${st.id}">${st.name}</span>`).join(" · ");
  });
}
rackStyles(0);
rack.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".audition");
  if (!btn) return;
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
  ocRow("HOOK", net.hook ?? "pending launch", [...addr(net.hook), ...src(net.hook)]),
  ocRow("TOKEN $IDM", net.token ?? "pending launch", [...addr(net.token, "token"), ...src(net.token)]),
  net.quote === NATIVE_ETH
    ? ocRow("PAIRED WITH", "native ETH")
    : ocRow(`PAIRED WITH $${net.quoteSymbol}`, net.quote ?? "—", addr(net.quote, "token")),
  ocRow("POOL ID", net.poolId ?? "pending launch"),
  ocRow("POOL MANAGER", net.poolManager ?? "—", addr(net.poolManager)),
  ocRow("LAUNCH", net.launchedBy, net.launchUrl ? [["job", net.launchUrl]] : [["imd.fun", LINKS.imd]]),
  ocRow("SOURCE", "discodirector/intelligent-dance-market", [["github", LINKS.github]]),
  ocRow("X", LINKS.x ?? "account soon", LINKS.x ? [["x.com", LINKS.x]] : []),
].join("");
$("onchain-sub").textContent =
  source.kind === "replay" ? `showing a replay · live contracts on ${net.label.toLowerCase()}` : `live on ${net.label.toLowerCase()} · switch to ${NETWORKS.robinhood.label.toLowerCase()} at launch`;

// ---------------------------------------------------------------- source switch + walls
const switchLink = $<HTMLAnchorElement>("src-switch");
if (source.kind === "replay") {
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
    const era = audio.running ? audio.player!.getEra() : { ...eraOf(epochOf(state)), epoch: epochOf(state), fading: false };
    const shown = eraOverride ? ERAS.find((e) => e.id === eraOverride)! : era;
    updateReadouts(bpm, ERAS.find((e) => e.id === shown.id)!);
    // The style the engine plays: an audition keeps the chain epoch, so styleOf picks exactly as the engine does.
    const style = styleOf(ERAS.find((e) => e.id === shown.id)!, era.epoch).style;
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
  (source.kind === "replay" ? `${source.replay.label} · ${EPOCH_PLAY[0]}–${EPOCH_PLAY[1]} s per genre` : `${net.label} · hook ${net.hook ? short(net.hook) : "pending"}`) +
    (v2 ? ` · rules v2${source.kind === "replay" && source.resim ? " (re-simulated)" : ""}` : ""),
);
requestAnimationFrame(frame);
if (source.kind === "replay") {
  startReplay(source.replay.url, source.speed, source.replay.label, feed, rules, source.resim).catch((e) => feed.onStatus(`replay failed: ${e.message}`, false));
} else startLive(net, feed);

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
