// lab.html: the style lab (prototype). You design one style like a producer (lab-styles.ts: presets, knobs, macros and
// choices, each a real style data field), the market plays it: BUY / SELL / WHALE buttons or the auto market run trades
// through the v2 rules in the browser (core mutate, as data/virtual.ts does for a pool), and the live player plays the
// style as a one-style station program (lab-audio.ts). The lab holds a recipe, never a style: every change rebuilds
// the style from its preset (lab-styles.ts buildStyle). What a knob moves is read by the engine on every step, so most
// changes are heard at once; the mix and effects are built when a genre starts, so for those the lab swaps in a fresh
// player on the next downbeat. Instead of the market keys, a live station's feed can play it (the same feeds as
// listen.ts). The recipe rides in the URL hash (#s=, lab-codec.ts: parsed as hostile input); MATCH LOUDNESS measures
// the style as the pack gate does and corrects its trim (lab-loudness.ts), DOWNLOAD WAV writes the take (or 20 s of
// the style), and SEND FOR REVIEW sends the style and a 20 s preview to the IDM team (bot/src/api/lab.ts). Every value from a link or a listener reaches the page as
// textContent or an input's value, never as HTML.
import "./style.css";
import "./lab.css";
import { DEFAULT_DROP_RULES, type State } from "@swarm-sequencer/core";
import { audioBufferToWavBase64, PARTS, parsePackSource, programFromPack, sectionAt, validatePack, type GenreStyle, type Part, type Program, type SequencerState } from "@swarm-sequencer/synth";
import { LabAudio } from "./lab-audio";
import { cleanName, decodeRecipe, encodeRecipe, NAME_MAX, recipeFrom } from "./lab-codec";
import { COMMUNITY, loadRuntime, type CommunityPreset } from "./lab-community";
import { loudness, renderClip, TARGET_DB, TOLERANCE_DB } from "./lab-loudness";
import { renderTake as renderTakeAudio } from "./lab-render";
import { Market, randomSeed, stepTs, type Trade, type TradeResult } from "./lab-market";
import { choiceIndex, dequant, lanesOf, macroQuant, macroValue, quant, TAKE_BARS, TAKE_EVENTS, TakeRun, type Take } from "./lab-take";
import {
  ACID_DEGREES, ALL_MUTED, buildStyle, engineOf, GAIN_DB, CHORD_PALETTE, GENRE_LIST, GENRES, knobsFor, mutedParts, packOf, packSource, PART_LABELS, presetById, SILENT_PARTS, problems, recipeOf, riffStart, setPart, stepCode, stepNote, tame,
  type Draft, type LabGenre, type Recipe,
} from "./lab-styles";
import { NETWORKS } from "./config";
import { startHamster } from "./data/hamster";
import { startLive } from "./data/live";
import type { Feed } from "./data/types";
import { startVirtual } from "./data/virtual";
import { RULES, toSynth } from "./rules";
import { drawGrid, Surface, type Flash } from "./visuals";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rules = RULES.v2;

/** An element with text and attributes set through the DOM (no HTML parsing anywhere on this page). */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | number | boolean> = {}, ...kids: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.append(...kids);
  return el;
}

// ------------------------------------------------------------------------------------------------ market

/** The lab's market (lab-market.ts: seeded, on a virtual clock), or a station's state while following one. */
let market = new Market(randomSeed());
let fed: State | null = null;
let trades = 0;
/** The lab's step clock: the index of the next step the player schedules, since the market's (or the take's) start. */
let labStep = 0;
let autoOn = true;
const synthState = (): SequencerState => (fed ? toSynth(fed, RULES[NETWORKS[following!]?.rules ?? "v2"]) : market.synth);
const audio = new LabAudio(synthState);

/** The trades since the market's start, by step (the headless check compares a take's runs with it). */
let tradeLog: string[] = [];
/** A trade's sound and its line on the tape. */
function played(r: TradeResult) {
  trades += 1;
  tradeLog.push(`${labStep}:${r.kind}:${r.label}`);
  flashes.push({ track: r.track, step: r.step, row: r.whale, color: r.whale ? "whale" : r.kind === "buy" ? "buy" : "sell", at: performance.now() });
  const player = audio.deck?.player;
  if (player && audio.running) {
    player.setState(r.state);
    if (r.drop) player.noteDrop(r.drop);
    if (r.held) player.noteTrackDrop(r.held);
  }
  tape(r.kind, r.label);
}

/** A trade key pressed: it lands on the next step the player schedules (and a recording take keeps it). */
function trade(kind: Trade) {
  if (following || take.mode === "play") return;
  played(market.trade(kind, labStep));
  record(`t:${kind}`, 0);
}

/** A fresh market from a seed, the step clock back at 0. */
function resetMarket(seed: number) {
  market = new Market(seed);
  labStep = 0;
  trades = 0;
  tradeLog = [];
}

const tapeEl = $("tape");
function tape(kind: Trade, what: string) {
  const li = h("li", { class: kind.startsWith("whale") ? "whale" : kind, text: `${kind === "whale-sell" ? "WHALE SELL" : kind.toUpperCase()} · ${what}` });
  tapeEl.prepend(li);
  while (tapeEl.children.length > 5) tapeEl.lastElementChild!.remove();
}

// ------------------------------------------------------------------------------------------------ a real station

/** Who plays the style: the lab's own market, or a station's live feed (as listen.ts follows one). */
const SOURCES = [
  { id: "market", label: "The market keys (BUY / SELL / WHALE)" },
  { id: "squeekchain", label: "Squeekchain: a hamster's wheel, live" },
  { id: "imd-eth", label: "IMD/ETH: the pool's swaps, live" },
].filter((s) => s.id === "market" || NETWORKS[s.id]);
let following: string | null = null;
let stopFeed: (() => void) | null = null;

function follow(id: string) {
  stopFeed?.();
  stopFeed = null;
  following = id === "market" ? null : id;
  if (following) stopTake();
  document.body.classList.toggle("following", !!following);
  // A station's feed plays with its song form; back on the market keys, the auto switch decides again.
  applyBar();
  if (!following) {
    fed = null;
    resetMarket(randomSeed());
    audio.setClock(stepTs(labStep));
    return;
  }
  const net = NETWORKS[id];
  const r = RULES[net.rules];
  const feed: Feed = {
    onSwap(e, backfill) {
      if (!backfill || !fed || e.state.swapCount >= fed.swapCount) fed = e.state;
      trades += 1;
      if (backfill || !audio.running) return;
      const player = audio.deck!.player;
      player.setState(toSynth(fed, r));
      if (e.whale) player.noteDrop({ track: e.track, fill: e.isBuy });
      if (e.trackComplete) player.noteTrackDrop(toSynth(e.trackComplete.held, r));
      flashes.push({ track: e.track, step: e.step, row: e.whale, color: e.whale ? "whale" : e.isBuy ? "buy" : "sell", at: performance.now() });
      tape(e.whale ? (e.isBuy ? "whale" : "whale-sell") : e.isBuy ? "buy" : "sell", e.hamster ? "the wheel" : `track ${e.track}`);
    },
    onState(s) {
      if (!fed || s.swapCount >= fed.swapCount) fed = s;
      audio.deck?.player.setState(toSynth(fed, r));
    },
    onBlock() {},
    onStatus(text, ok) {
      status(text.toLowerCase(), ok);
    },
    onClock(c) {
      audio.setClock(c);
    },
    onReset(s) {
      fed = s;
      audio.deck?.player.setState(toSynth(fed, r));
    },
  };
  fed = r.initial();
  if (net.hamster) {
    const c = startHamster(net, feed, net.hamster);
    stopFeed = () => c.stop();
  } else stopFeed = net.virtual ? startVirtual(net, feed) : startLive(net, feed);
}
// The source picker is hidden for now (lab.html has no #source): the market keys play. Following a station stays here
// for the headless check (__lab.follow) and for later.
const sourceEl = document.getElementById("source") as HTMLSelectElement | null;
sourceEl?.replaceChildren(...SOURCES.map((s) => h("option", { value: s.id, text: s.label })));
sourceEl?.addEventListener("change", () => follow(sourceEl.value));

// ------------------------------------------------------------------------------------------------ the style

let recipe: Recipe;
let draft: Draft;

const LAB_KEY = "lab-live";
/** The style as the one-style program the player plays (validated: throws on a broken style). */
const programOf = (d: Draft): Program => programFromPack({ ...packOf(d), key: LAB_KEY });
/** The style object inside a program: the engine reads it on every step. */
const styleList = (p: Program, g: LabGenre) => p.styles[0].styles[engineOf(g)] as GenreStyle[] | undefined;

/**
 * The per-step fields go straight into the playing (and the waiting) program: the style in its list is replaced by a
 * fresh one, so caches keyed on the style object (dub techno's voices) see the change too. What a running engine read
 * at its start (mix, fx, trim) it keeps: a swap brings those.
 */
function applyLive() {
  const next = styleList(programOf(draft), draft.genre)![0];
  for (const program of audio.programs) {
    const list = styleList(program, draft.genre);
    if (list) list[0] = next;
  }
}

let swapTimer = 0;
/** A change the engine only reads at a genre's start: a fresh player on the next downbeat (debounced while dragging). */
function swapSoon(ms = 260) {
  window.clearTimeout(swapTimer);
  // Recording or playing a take: the swap waits for the next downbeat at once, so a take lands the same every time
  // (several in one bar coalesce: one restart a bar at most).
  if (take.mode !== "idle") {
    if (!problems(draft).length) audio.swap(programOf(draft));
    return;
  }
  swapTimer = window.setTimeout(() => {
    if (problems(draft).length) return;
    audio.swap(programOf(draft));
  }, ms);
}

/** Rebuilds the style from the recipe and sends it where it goes. */
function rebuild(bar: boolean) {
  draft = buildStyle(recipe);
  // A gain knob moves the loudness guard (the style's trim): the engine glides to it on the next step, no swap.
  const errs = problems(draft);
  status(errs.length ? `not valid: ${errs[0]}` : "", !errs.length);
  if (errs.length) return;
  applyLive();
  if (bar) swapSoon();
  saveSoon();
}

function load(next: Recipe, swap: boolean) {
  if (take.mode !== "idle") stopTake();
  // A recipe with a take (a link) brings it; any other (a preset, a genre, RESET) leaves the take behind.
  take.current = next.take ?? null;
  takeBase = next.take ? clone(next) : null;
  if (takeBase) delete takeBase.take;
  // The parts on and off are the performance, not the style: a new preset or genre keeps them (a link brings its own).
  if (!next.take && next.mutes === undefined && recipe?.mutes) next.mutes = recipe.mutes;
  recipe = next;
  delete recipe.take;
  draft = buildStyle(recipe);
  render();
  const errs = problems(draft);
  status(errs.length ? `not valid: ${errs[0]}` : "", !errs.length);
  if (!errs.length && swap) swapSoon(0);
  saveSoon();
}

// ------------------------------------------------------------------------------------------------ UI

function render() {
  const g = GENRES[recipe.genre];
  $("genres").replaceChildren(
    ...GENRE_LIST.map((x) => h("button", { type: "button", role: "tab", "data-genre": x.id, "aria-selected": String(x.id === recipe.genre), text: x.label })),
  );
  $("preset").replaceChildren(...g.presets.map((p) => h("option", { value: p.id, selected: p.id === recipe.preset, text: p.label })));
  ($("name") as HTMLInputElement).value = recipe.name;

  $("macros").replaceChildren(
    ...g.macros.map((m) =>
      h(
        "label",
        { class: "macro" },
        h("span", { class: "ends" }, h("b", { text: m.left }), h("b", { text: m.right })),
        h("input", { type: "range", min: 0, max: 1, step: 0.01, "data-macro": m.key, "aria-label": `${m.left} to ${m.right}` }),
      ),
    ),
  );
  $("choices").replaceChildren(
    ...g.choices.map((c) =>
      h(
        "label",
        { class: "lab-field" },
        h("span", { class: "silk", text: c.label.toUpperCase() }),
        h("select", { "data-choice": c.key }, ...c.options(draft).map((o) => h("option", { value: o.id, text: o.label }))),
      ),
    ),
  );
  $("knobs").replaceChildren(
    ...knobsFor(draft).map((k) =>
      h(
        "label",
        { class: k.bar ? "lk bar" : "lk", "data-knob": k.key },
        h("span", { class: "lk-top" }, h("span", { class: "lk-name", text: k.label }), h("output")),
        h("input", { type: "range", min: k.min, max: k.max, step: k.step, "aria-label": k.label }),
      ),
    ),
  );
  refresh();
  renderTake();
}

// The riff editor (acid) and the chord picker (Ambient IDM): a riff of the lab's own, 16 steps of a 303 note (degree
// of the acid note set, octave, accent, slide), and a progression of 2..4 chords from the genre's palette.

/** The riff the editor shows: the recipe's own, else the riff the style plays (its first line). */
const editorRiff = () => recipe.riff ?? riffStart(recipe.choices.riff ?? GENRES.acid.choices[0].initial(presetById("acid", recipe.preset)!));

function renderEditor() {
  const box = $("editor");
  if (recipe.genre === "acid") {
    const riff = editorRiff();
    const notes = riff.map(stepNote);
    const rows = [...ACID_DEGREES.keys()].reverse().map((d) =>
      h(
        "div",
        { class: "re-row" },
        h("span", { class: "re-label", text: ACID_DEGREES[d] }),
        ...notes.map((n, i) => h("button", { type: "button", class: `re-cell${n && n.degree === d ? " on" : ""}${i % 4 === 0 ? " beat" : ""}`, "data-step": i, "data-degree": d, "aria-label": `step ${i + 1} ${ACID_DEGREES[d]}` })),
      ),
    );
    const flag = (label: string, kind: string, on: (n: Record<string, number>) => string) =>
      h(
        "div",
        { class: "re-row flags" },
        h("span", { class: "re-label", text: label }),
        ...notes.map((n, i) => h("button", { type: "button", class: `re-flag${n ? "" : " off"}`, "data-step": i, "data-flag": kind, disabled: !n, text: n ? on(n) : "" })),
      );
    box.replaceChildren(
      h("span", { class: "silk", text: "RIFF · TAP THE STEPS" }),
      h(
        "div",
        { class: "re-grid" },
        ...rows,
        flag("oct", "octave", (n) => (n.octave > 0 ? "+" : n.octave < 0 ? "-" : "·")),
        flag("acc", "accent", (n) => (n.flags & 1 ? "A" : "·")),
        flag("slide", "slide", (n) => (n.flags & 2 ? "S" : "·")),
      ),
      h("p", { class: "re-note", text: notes.filter(Boolean).length < 4 ? "a riff needs 4 notes: until then the preset's plays" : "accent hits harder, slide glides into the next note" }),
    );
  } else if (recipe.genre === "ambientidm") {
    const prog = recipe.chords ?? [0, 1, 3, 4];
    const slot = (i: number) =>
      h(
        "select",
        { "data-slot": i, "aria-label": `chord ${i + 1}` },
        ...(i >= 2 ? [h("option", { value: "-1", text: "—" })] : []),
        ...CHORD_PALETTE.map((c, j) => h("option", { value: j, text: c.label, selected: prog[i] === j })),
      );
    const slots = [0, 1, 2, 3].map(slot);
    slots.forEach((s, i) => i >= prog.length && (s.value = "-1"));
    box.replaceChildren(h("span", { class: "silk", text: "CHORDS · FOUR BARS EACH" }), h("div", { class: "cp-slots" }, ...slots));
  } else box.replaceChildren();
}

$("editor").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-step]");
  if (!b || recipe.genre !== "acid") return;
  const riff = [...editorRiff()];
  const i = Number(b.dataset.step);
  const n = stepNote(riff[i]);
  if (b.dataset.degree !== undefined) {
    const d = Number(b.dataset.degree);
    riff[i] = n && n.degree === d ? 0 : stepCode({ degree: d, octave: n?.octave ?? 0, flags: n?.flags ?? 0 });
  } else if (n) {
    if (b.dataset.flag === "octave") n.octave = n.octave >= 1 ? -1 : n.octave + 1;
    if (b.dataset.flag === "accent") n.flags ^= 1;
    if (b.dataset.flag === "slide") n.flags ^= 2;
    riff[i] = stepCode(n);
  }
  recipe.riff = riff;
  recipe.choices.riff = "custom";
  rebuild(false);
  refresh();
});
$("editor").addEventListener("change", (e) => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-slot]");
  if (!sel || recipe.genre !== "ambientidm") return;
  const picks = [...document.querySelectorAll<HTMLSelectElement>("#editor select[data-slot]")].map((s) => Number(s.value)).filter((v) => v >= 0);
  if (picks.length < 2) return renderEditor();
  recipe.chords = picks;
  recipe.choices.chords = "custom";
  rebuild(false);
  refresh();
});

/** Every control shows the built style (the taste rules or a macro may have moved what a knob says). */
function refresh() {
  const g = GENRES[recipe.genre];
  for (const k of knobsFor(draft)) {
    const el = document.querySelector<HTMLElement>(`[data-knob="${k.key}"]`);
    if (!el) continue;
    const v = k.get(draft);
    el.querySelector("input")!.value = String(v);
    el.querySelector("output")!.textContent = k.fmt ? k.fmt(v) : String(v);
  }
  for (const m of g.macros) {
    const el = document.querySelector<HTMLInputElement>(`[data-macro="${m.key}"]`);
    if (el) el.value = String(recipe.macros[m.key] ?? m.get(draft));
  }
  const preset = presetById(recipe.genre, recipe.preset)!;
  for (const c of g.choices) {
    const el = document.querySelector<HTMLSelectElement>(`[data-choice="${c.key}"]`);
    if (el) el.value = recipe.choices[c.key] ?? c.initial(preset);
  }
  renderEditor();
  $("lcd-name").textContent = recipe.name;
  $("lcd-genre").textContent = `${g.label} · ${g.bases[draft.style.base]}`;
}

$("genres").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-genre]")?.dataset.genre;
  const g = GENRE_LIST.find((x) => x.id === id);
  if (g && g.id !== recipe.genre) load(recipeOf(g.presets[0]), true);
});
$("preset").addEventListener("change", (e) => {
  const p = presetById(recipe.genre, (e.target as HTMLSelectElement).value);
  if (p) load(recipeOf(p), true);
});
const nameEl = $("name") as HTMLInputElement;
nameEl.maxLength = NAME_MAX;
nameEl.addEventListener("input", () => {
  recipe.name = cleanName(nameEl.value);
  draft.style.name = recipe.name;
  $("lcd-name").textContent = recipe.name;
  saveSoon();
});
nameEl.addEventListener("change", () => (nameEl.value = recipe.name));
$("knobs").addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  const key = input.closest<HTMLElement>("[data-knob]")?.dataset.knob;
  const k = knobsFor(draft).find((x) => x.key === key);
  if (!k) return;
  k.set(draft, Number(input.value));
  // The taste rules decide with the knob that moved; the recipe keeps what they left.
  const moved = tame(draft, k.key);
  for (const key2 of [k.key, ...moved]) {
    const kk = knobsFor(draft).find((x) => x.key === key2);
    if (!kk) continue;
    recipe.knobs[key2] = Number(kk.get(draft).toFixed(6));
    // Recording: the value as the take will play it (a byte of the knob's range), so playback hears the same.
    if (take.mode === "rec") {
      const q = quant(recipe.genre, key2, recipe.knobs[key2]);
      recipe.knobs[key2] = dequant(recipe.genre, key2, q);
      record(`k:${key2}`, q);
    }
  }
  idleEdit();
  rebuild(!!k.bar);
  refresh();
});
$("macros").addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  const m = GENRES[recipe.genre].macros.find((x) => x.key === input.dataset.macro);
  if (!m) return;
  recipe.macros[m.key] = Number(input.value);
  for (const k of m.knobs) delete recipe.knobs[k];
  if (take.mode === "rec") {
    const q = macroQuant(recipe.macros[m.key]);
    recipe.macros[m.key] = macroValue(q);
    record(`m:${m.key}`, q);
  }
  idleEdit();
  rebuild(!!m.bar?.(draft));
  refresh();
});
$("choices").addEventListener("change", (e) => {
  const sel = e.target as HTMLSelectElement;
  const c = GENRES[recipe.genre].choices.find((x) => x.key === sel.dataset.choice);
  if (!c) return;
  recipe.choices[c.key] = sel.value;
  record(`c:${c.key}`, choiceIndex(recipe, c.key, sel.value));
  idleEdit();
  rebuild(false);
  refresh();
});

const playBtn = $("play");
async function play(on: boolean) {
  if (on) {
    if (problems(draft).length) return;
    if (!following) audio.setClock(stepTs(labStep));
    applyBar();
    audio.startBar = 8;
    await audio.start(programOf(draft));
  } else {
    if (take.mode !== "idle") stopTake();
    audio.stop();
  }
  setPlaying(on && audio.running);
}
function setPlaying(playing: boolean) {
  document.body.classList.toggle("playing", playing);
  playBtn.setAttribute("aria-pressed", String(playing));
  playBtn.querySelector(".txt")!.textContent = playing ? "STOP" : "PLAY";
}
playBtn.addEventListener("click", () => {
  const on = !document.body.classList.contains("playing");
  if (on) audio.unlock();
  void play(on);
});
/** A trade button starts the music if it is not playing yet (the first tap is the gesture). */
function tradeButton(id: string, kind: Trade) {
  $(id).addEventListener("click", () => {
    if (!document.body.classList.contains("playing")) {
      audio.unlock();
      void play(true).then(() => trade(kind));
      return;
    }
    trade(kind);
  });
}
tradeButton("buy", "buy");
tradeButton("sell", "sell");
tradeButton("whale", "whale");
const autoEl = $("auto") as HTMLInputElement;
autoEl.addEventListener("change", () => {
  autoOn = autoEl.checked;
  if (autoOn) market.autoFrom(labStep);
  record("a:auto", autoOn ? 1 : 0);
  // Manual mode (auto off) drops the song form from the next downbeat, as a part switch lands.
  if (!audio.running || scheduled === 15) applyBar();
});

// ------------------------------------------------------------------------------------------------ the parts

// Every part on or off (engine.ts PARTS: the drum rows, the bass, the pads, the lead, the effects): a press is heard from
// the next downbeat, and a take records it. BLANK turns everything off: a track can start from nothing, then hats, then
// the kick. The style itself never changes, so an exported pack plays every part.
const partEls = PARTS.map((p, i) =>
  h("button", { type: "button", class: "part", "data-part": p, "data-key": i + 1, "aria-keyshortcuts": String(i + 1), "aria-pressed": "true", text: PART_LABELS[p] }),
);
$("parts").replaceChildren(...partEls);
function switchParts(parts: readonly Part[], on: boolean) {
  for (const p of parts) {
    if (!mutedParts(recipe).includes(p) === on) continue;
    setPart(recipe, p, on);
    record(`u:${p}`, on ? 1 : 0);
  }
  idleEdit();
  // Stopped, or the downbeat is the next step to schedule (a take holds this press for that bar): heard from it now.
  if (!audio.running || scheduled === 15) applyBar();
  renderParts();
  saveSoon();
}
$("parts").addEventListener("click", (e) => {
  const p = (e.target as HTMLElement).closest<HTMLElement>("[data-part]")?.dataset.part as Part | undefined;
  if (p) switchParts([p], mutedParts(recipe).includes(p));
});
// Keys 1-8 switch the parts in their order (the top row or the numpad), except while typing in a text field. A list
// (riff, chords, preset) keeps the focus after a pick: the keys still switch parts there, and never pick an option.
document.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement;
  if (el.closest("input[type=text], input[type=search], input[type=number], input:not([type]), textarea, [contenteditable]")) return;
  const n = /^(?:Digit|Numpad)([1-8])$/.exec(e.code)?.[1];
  if (!n) return;
  e.preventDefault();
  const p = PARTS[Number(n) - 1];
  switchParts([p], mutedParts(recipe).includes(p));
});
$("blank").addEventListener("click", () => switchParts(PARTS, false));
$("all-in").addEventListener("click", () => switchParts(PARTS, true));

/** Lit: on; dark: off; blinking: switched, waiting for the downbeat. */
function renderParts() {
  const want = mutedParts(recipe);
  const now = audio.mutes;
  const silent = SILENT_PARTS[recipe.preset] ?? [];
  partEls.forEach((el, i) => {
    const p = PARTS[i];
    el.classList.toggle("none", silent.includes(p));
    el.title = silent.includes(p) ? "this preset has no such part" : "";
    const off = want.includes(p);
    el.classList.toggle("off", off);
    el.classList.toggle("pending", audio.running && off !== now.includes(p));
    el.setAttribute("aria-pressed", String(!off));
  });
  ($("blank") as HTMLButtonElement).disabled = (recipe.mutes ?? 0) === ALL_MUTED;
  ($("all-in") as HTMLButtonElement).disabled = !recipe.mutes;
}

/**
 * What lands on a downbeat: the parts on and off, and the song form. With the auto market off the listener runs the
 * track (manual mode): no form, every bar plays as the full part, so a part switched on is heard at once and stays.
 */
function applyBar() {
  audio.setMutes(mutedParts(recipe));
  audio.setFormless(!following && !autoOn);
}

/** The pattern screen shows what is heard: a part that is off shows an empty row. */
const ROW_PARTS: Part[] = ["kick", "snare", "hat", "glitch"];
function heard(s: SequencerState): SequencerState {
  const off = audio.mutes;
  if (!off.length) return s;
  let pattern = s.pattern;
  ROW_PARTS.forEach((p, t) => {
    if (off.includes(p)) pattern &= ~(0xffffn << BigInt(t * 16));
  });
  return { ...s, pattern, bass: off.includes("bass") ? 0n : s.bass };
}

// ------------------------------------------------------------------------------------------------ the step clock

/**
 * Every scheduled step: the clock moves on, then for the next step the auto market's trade (from the seeded market)
 * and, playing a take, its events. A recording keeps whatever the listener does in between, stamped with that step.
 */
/** The bar step the player scheduled last: at 15, the next one is a downbeat. */
let scheduled = 0;
audio.onStep = (step) => {
  scheduled = step % 16;
  nextStep();
  // The parts switched on or off in this bar are heard from the downbeat the player schedules next.
  if (step % 16 === 15) applyBar();
};
function nextStep() {
  labStep += 1;
  if (following) return;
  audio.setClock(stepTs(labStep));
  if (take.mode === "play" && run) {
    if (labStep >= run.take.bars * 16) return endTake();
    const { trades: done, moved } = run.advance(labStep);
    for (const r of done) played(r);
    if (moved.length || run.auto !== autoOn) followRun(moved);
    return;
  }
  if (autoOn) {
    const kind = market.auto(labStep);
    if (kind) played(market.trade(kind, labStep));
  }
  if (take.mode === "rec" && labStep >= TAKE_BARS * 16) stopTake("take full: 64 bars");
}

// ------------------------------------------------------------------------------------------------ the take

/** The take: idle, armed (REC waits for the downbeat), recording or playing. */
const take: { mode: "idle" | "armed" | "rec" | "play"; current: Take | null } = { mode: "idle", current: null };
/** The recipe the take starts from (what its link carries next to it). */
let takeBase: Recipe | null = null;
/** The take being played (lab-take.ts TakeRun: the same stepping as the offline render). */
let run: TakeRun | null = null;

/** Recording: one event on the next step the player schedules (the last value of a control per step wins). */
function record(ctl: string, v: number) {
  const t = take.current;
  if (take.mode !== "rec" || !t || v < 0) return;
  const last = t.events[t.events.length - 1];
  if (last && last.step === labStep && last.ctl === ctl && !ctl.startsWith("t:")) last.v = v;
  else t.events.push({ step: labStep, ctl, v });
  if (t.events.length >= TAKE_EVENTS) stopTake(`take full: ${TAKE_EVENTS} moves`);
}

/** An edit while a take sits idle changes the knobs now (and the export), not the take: say so once. */
let idleNoted = false;
function idleEdit() {
  if (take.mode !== "idle" || !take.current || idleNoted) return;
  idleNoted = true;
  status("not in the take: PLAY TAKE starts from its own start; REC records a new one");
}

/** REC: a fresh market and a fresh player on the next downbeat (or now, when stopped), then every move is kept. */
async function startRec() {
  if (following) return status("follow the market keys to record a take", false);
  const seed = randomSeed();
  const begin = (bar: number) => {
    takeBase = clone(recipe);
    applyBar();
    resetMarket(seed);
    take.current = { seed, bar: ((bar % 32) + 32) % 32, bars: 1, auto: autoOn, events: [] };
    take.mode = "rec";
    audio.setClock(stepTs(0));
    renderTake();
  };
  if (!audio.running) {
    audio.unlock();
    begin(8);
    await play(true);
    return;
  }
  take.mode = "armed";
  renderTake();
  audio.swap(programOf(draft), begin);
}

/** Ends a recording (its length: the bars it reached) or a playback. */
function stopTake(note?: string) {
  const t = take.current;
  if (take.mode === "rec" && t) {
    t.bars = Math.max(1, Math.min(TAKE_BARS, Math.ceil(Math.max(1, labStep) / 16)));
    t.events = t.events.filter((e) => e.step < t.bars * 16);
    status(note ?? `take: ${t.bars} bars, ${t.events.length} moves`);
    saveSoon();
  } else if (take.mode === "play" && note) status(note);
  if (take.mode === "armed") take.current = take.current?.events.length ? take.current : null;
  take.mode = "idle";
  run = null;
  idleNoted = false;
  renderTake();
}

/** PLAY TAKE: the base recipe, the take's market, a fresh player on the take's first bar; the events from there. */
async function playTake() {
  const t = take.current;
  if (!t || !takeBase) return;
  if (following) return status("follow the market keys to play a take", false);
  if (take.mode !== "idle") stopTake();
  audio.unlock();
  run = new TakeRun(takeBase, t);
  recipe = run.recipe;
  market = run.market;
  labStep = 0;
  trades = 0;
  tradeLog = [];
  run.advance(0);
  autoOn = run.auto;
  autoEl.checked = autoOn;
  take.mode = "play";
  draft = buildStyle(recipe);
  render();
  applyBar();
  audio.setClock(stepTs(0));
  audio.startBar = t.bar;
  await audio.start(programOf(draft));
  setPlaying(true);
  renderTake();
}

/** The take moved controls: the style follows (bar fields swap on the next downbeat), the knobs move on screen. */
function followRun(moved: string[]) {
  autoOn = run!.auto;
  autoEl.checked = autoOn;
  if (!moved.length) return;
  const bar = moved.some((c) => {
    const [kind, key] = c.split(":");
    if (kind === "k") return !!GENRES[recipe.genre].knobs.find((k) => k.key === key)?.bar;
    if (kind === "m") return !!GENRES[recipe.genre].macros.find((m) => m.key === key)?.bar?.(draft);
    return false;
  });
  rebuild(bar);
  refresh();
}

function endTake() {
  stopTake("take played: the knobs stay where it left them");
}

function clearTake() {
  if (take.mode !== "idle") stopTake();
  take.current = null;
  takeBase = null;
  renderTake();
  saveSoon();
  status("take cleared");
}

/** Deletes one control's automation from the take (a lane's x). */
function clearLane(ctl: string) {
  const t = take.current;
  if (!t || take.mode !== "idle") return;
  t.events = t.events.filter((e) => e.ctl !== ctl);
  renderTake();
  saveSoon();
}

const recBtn = $("rec");
const takeBtn = $("take-play");
recBtn.addEventListener("click", () => {
  if (take.mode === "rec" || take.mode === "armed") stopTake();
  else void startRec();
});
takeBtn.addEventListener("click", () => {
  if (take.mode === "play") stopTake("take stopped");
  else void playTake();
});
$("take-clear").addEventListener("click", clearTake);
$("lanes-list").addEventListener("click", (e) => {
  const ctl = (e.target as HTMLElement).closest<HTMLElement>("[data-lane]")?.dataset.lane;
  if (ctl) clearLane(ctl);
});

/** The take's buttons, its lane chips and the knobs' automated marks. */
function renderTake() {
  const t = take.current;
  document.body.classList.toggle("recording", take.mode === "rec" || take.mode === "armed");
  document.body.classList.toggle("take-playing", take.mode === "play");
  recBtn.textContent = take.mode === "armed" ? "REC · NEXT BAR" : take.mode === "rec" ? "STOP REC" : "REC";
  takeBtn.textContent = take.mode === "play" ? "STOP TAKE" : "PLAY TAKE";
  $("render").title = t ? "The take, rendered offline" : "20 s of the style, rendered offline";
  (takeBtn as HTMLButtonElement).disabled = !t || take.mode === "rec" || take.mode === "armed";
  ($("take-clear") as HTMLButtonElement).disabled = !t || take.mode !== "idle";
  $("lanes").hidden = !t;
  const lanes = t ? lanesOf(t) : [];
  $("lanes-list").replaceChildren(...lanes.map((c) => h("button", { type: "button", class: "lane-chip", "data-lane": c, title: "delete this lane", text: `${laneName(c)} ×` })));
  for (const el of document.querySelectorAll<HTMLElement>("[data-knob]")) el.classList.toggle("automated", lanes.includes(`k:${el.dataset.knob}`));
  for (const el of document.querySelectorAll<HTMLElement>("[data-macro]")) el.closest(".macro")?.classList.toggle("automated", lanes.includes(`m:${el.dataset.macro}`));
}
const laneName = (ctl: string) => {
  const [kind, key] = ctl.split(":");
  const g = GENRES[recipe.genre];
  if (kind === "k") return g.knobs.find((k) => k.key === key)?.label ?? key;
  if (kind === "m") {
    const m = g.macros.find((x) => x.key === key);
    return m ? `${m.left}-${m.right}` : key;
  }
  if (kind === "u") return PART_LABELS[key as Part] ?? key;
  return g.choices.find((c) => c.key === key)?.label ?? key;
};

/** The lanes: one thin line per automated control over the take's bars, the trades as ticks, the playhead. */
const laneCanvas = $("lane-canvas") as HTMLCanvasElement;
function drawLanes() {
  const t = take.current;
  if (!t) return;
  const dpr = window.devicePixelRatio || 1;
  const w = laneCanvas.clientWidth;
  const lanes = lanesOf(t);
  const rowH = 12;
  const hgt = Math.max(28, (lanes.length + 1) * rowH + 6);
  if (laneCanvas.width !== Math.round(w * dpr) || laneCanvas.height !== Math.round(hgt * dpr)) {
    laneCanvas.width = Math.round(w * dpr);
    laneCanvas.height = Math.round(hgt * dpr);
    laneCanvas.style.height = `${hgt}px`;
  }
  const c = laneCanvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, hgt);
  const steps = (take.mode === "rec" ? Math.max(t.bars, Math.ceil(labStep / 16) + 1) : t.bars) * 16;
  const x = (step: number) => (step / steps) * w;
  const css = getComputedStyle(document.body);
  const phos = css.getPropertyValue("--phos").trim() || "#6cf595";
  const dim = css.getPropertyValue("--phos-dim").trim() || "#2f8f4f";
  c.strokeStyle = "rgba(108,245,149,0.12)";
  for (let b = 0; b <= steps / 16; b += 4) {
    c.beginPath();
    c.moveTo(x(b * 16) + 0.5, 0);
    c.lineTo(x(b * 16) + 0.5, hgt);
    c.stroke();
  }
  lanes.forEach((ctl, i) => {
    const top = 3 + i * rowH;
    const ev = t.events.filter((e) => e.ctl === ctl);
    const max = ctl.startsWith("c:") ? Math.max(1, ...ev.map((e) => e.v)) : ctl.startsWith("u:") ? 1 : 255;
    c.strokeStyle = phos;
    c.lineWidth = 1.2;
    c.beginPath();
    ev.forEach((e, j) => {
      const y = top + rowH - 3 - (e.v / max) * (rowH - 5);
      if (j === 0) c.moveTo(x(e.step), y);
      else c.lineTo(x(e.step), y);
      const end = ev[j + 1]?.step ?? steps;
      c.lineTo(x(end), y);
    });
    c.stroke();
  });
  c.fillStyle = dim;
  const tradeTop = 3 + lanes.length * rowH;
  for (const e of t.events) if (e.ctl.startsWith("t:")) c.fillRect(x(e.step), tradeTop + 2, 1.5, rowH - 6);
  if (take.mode === "play" || take.mode === "rec") {
    c.fillStyle = take.mode === "rec" ? "#ff5f52" : "#ffb53d";
    c.fillRect(Math.min(w - 2, x(labStep)), 0, 2, hgt);
  }
}



// ------------------------------------------------------------------------------------------------ the screen

// The player's own pattern screen (visuals.ts): step numbers, KCK/SNR/HAT/GLT and the bass row, lit cells at their
// velocity, dots for the raw bits the arrangement holds back, a flash where a trade lands.
const grid = new Surface($("grid") as HTMLCanvasElement);
const flashes: Flash[] = [];
let shown = { step: 0, bar: 0 };
const meter = $("meter");
// FILL and HEAT, as the hook counts them (core DEFAULT_DROP_RULES): from SAT_BITS hits a buy heats the grid, at heatMax
// the track drops. The mark on FILL is where full starts.
const SAT_BITS = DEFAULT_DROP_RULES.satBits;
const heatLeds = Array.from({ length: rules.heatMax }, () => h("i"));
$("heat-leds").replaceChildren(...heatLeds);
($("fill").parentElement!.querySelector(".sat") as HTMLElement).style.left = `${(SAT_BITS / 64) * 100}%`;
const popcount = (x: bigint) => {
  let n = 0;
  for (; x; x &= x - 1n) n++;
  return n;
};
function gauges() {
  const st = fed ?? market.state;
  const fill = popcount(BigInt.asUintN(64, st.pattern));
  const heat = Math.min(rules.heatMax, st.heat ?? 0);
  $("fill").style.width = `${(fill / 64) * 100}%`;
  $("fill").classList.toggle("full", fill >= SAT_BITS);
  $("fill-label").textContent = `${String(fill).padStart(2, "0")}/64`;
  heatLeds.forEach((el, i) => el.classList.toggle("on", i < heat));
  $("heat-label").textContent = `${String(heat).padStart(2, "0")}/${rules.heatMax}`;
}
let last = { rms: 0, peak: 0, centroid: 0 };

function frame() {
  const p = audio.deck?.player;
  const t = p && audio.running ? p.getTransport() : null;
  const now = performance.now();
  if (t) shown = { step: t.step, bar: t.bar };
  while (flashes.length && now - flashes[0].at > 1200) flashes.shift();
  drawGrid(grid, heard(synthState()), shown.step, shown.bar, t ? t.phase : 0, flashes, now);
  renderParts();
  gauges();
  // A player that has not reached its first step yet reports bar 0: keep showing the last one.
  if (t && (t.bar > 0 || t.phase > 0)) {
    $("lcd-bpm").textContent = `${Math.round(t.bpm)} BPM`;
    $("lcd-bar").textContent = `BAR ${String((t.bar % 32) + 1).padStart(2, "0")}/32`;
    $("lcd-section").textContent = audio.formless ? "manual" : sectionAt(t.bar).name;
  } else if (!t) $("lcd-section").textContent = "stopped";
  $("lcd-swaps").textContent =
    take.mode === "rec" ? `REC ${String(Math.floor(labStep / 16) + 1).padStart(2, "0")}/${TAKE_BARS}` : take.mode === "play" && run ? `TAKE ${String(Math.floor(labStep / 16) + 1).padStart(2, "0")}/${run.take.bars}` : `${trades} TRADE${trades === 1 ? "" : "S"}`;
  drawLanes();
  $("lcd-sync").classList.toggle("on", audio.pending);
  last = audio.running ? audio.sample() : { rms: 0, peak: 0, centroid: 0 };
  meter.style.transform = `scaleX(${Math.min(1, last.rms * 4)})`;
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------------------------------------ share / export

let saveTimer = 0;
function saveSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => history.replaceState(null, "", `#s=${await encodeRecipe(shareRecipe())}`), 300);
}
/** What a link carries: with a take, the take and the recipe it starts from; else the recipe as it stands. */
const shareRecipe = (): Recipe => (take.current && takeBase ? { ...takeBase, take: take.current } : recipe);

let statusTimer = 0;
function status(text: string, ok = true) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("bad", !ok);
  window.clearTimeout(statusTimer);
  if (text && ok) statusTimer = window.setTimeout(() => (el.textContent = ""), 5000);
}

/** The export's own check: the file parses as data (the gate's parser) and the pack passes validatePack. */
function exportCheck(text: string): string[] {
  try {
    return validatePack(parsePackSource(text));
  } catch (err) {
    return [(err as Error).message];
  }
}

$("share").addEventListener("click", async () => {
  history.replaceState(null, "", `#s=${await encodeRecipe(shareRecipe())}`);
  // A phone's share sheet where there is one; else the clipboard.
  if (navigator.share && matchMedia("(hover: none)").matches) {
    try {
      await navigator.share({ title: `${recipe.name} · IDM Style Lab`, url: location.href });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(location.href);
    status("link copied: opening it plays this style");
  } catch {
    status("copy the address bar: it holds this style");
  }
});
const contactEl = $("contact") as HTMLInputElement;
try {
  contactEl.value = localStorage.getItem("lab-contact") ?? "";
} catch {
  /* no storage: the field starts empty */
}
contactEl.addEventListener("change", () => {
  contactEl.value = contactEl.value.replace(/[^A-Za-z0-9_.@-]+/g, "").slice(0, 40);
  try {
    localStorage.setItem("lab-contact", contactEl.value);
  } catch {
    /* no storage */
  }
});
/**
 * SEND FOR REVIEW: the loudness matched as the gate wants, the pack checked, then the style's code (with the take, so
 * the team can open it) and a 20 s preview of the style go to the API, which checks them again and only stores them.
 */
$("submit").addEventListener("click", async () => {
  if (matched !== (await encodeRecipe(recipe)) && (await matchLoudness()) === undefined) return;
  const errs = exportCheck(packSource(draft));
  if (errs.length) return status(`not sent: ${errs[0]}`, false);
  await busy("rendering a 20 s preview…", async () => {
    const buf = await renderClip(packOf(draft), 0, 20);
    status("sending…");
    const res = await fetch("/api/lab/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: await encodeRecipe(shareRecipe()), wav: audioBufferToWavBase64(buf), contact: contactEl.value }),
    });
    const j = (await res.json().catch(() => ({}))) as { duplicate?: boolean; error?: string; retryAfterSec?: number };
    if (res.status === 202) status(`sent: "${recipe.name}" is with the IDM team. Thank you`);
    else if (res.ok && j.duplicate) status("this style was sent already");
    else if (res.status === 429) status(`too many sends: try again in ${Math.max(1, Math.ceil((j.retryAfterSec ?? 60) / 60))} min`, false);
    else status(`not sent: ${j.error ?? `error ${res.status}`}`, false);
  });
});
/** Runs a slow job with the out buttons held. */
async function busy<T>(label: string, job: () => Promise<T>): Promise<T | undefined> {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".out-btn")];
  buttons.forEach((b) => (b.disabled = true));
  status(label);
  try {
    return await job();
  } catch (err) {
    status(`failed: ${(err as Error).message}`, false);
    return undefined;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/** The recipe whose loudness was last matched (its share code). */
let matched = "";
/**
 * MATCH LOUDNESS: renders the style as the gate does (three 20 s stretches of the tape), moves the loudness correction by
 * the distance to the gate's target, and checks once more. The correction can go down 12 dB and up 2 (GAIN_DB).
 */
async function matchLoudness(): Promise<number | undefined> {
  return busy("measuring loudness as the gate does…", async () => {
    let m = await loudness(packOf(draft));
    for (let pass = 0; pass < 2 && Math.abs(m.loudDb - TARGET_DB) > 0.4; pass++) {
      const want = Math.max(GAIN_DB[0], Math.min(GAIN_DB[1], (recipe.gain ?? 0) + TARGET_DB - m.loudDb));
      if (Math.abs(want - (recipe.gain ?? 0)) < 0.05) break;
      recipe.gain = Number(want.toFixed(1));
      rebuild(true);
      m = await loudness(packOf(draft));
    }
    matched = await encodeRecipe(recipe);
    const ok = Math.abs(m.loudDb - TARGET_DB) <= TOLERANCE_DB;
    status(`loudness ${m.loudDb.toFixed(1)} dBFS (gate: ${TARGET_DB} ±${TOLERANCE_DB}) · correction ${(recipe.gain ?? 0).toFixed(1)} dB${ok ? "" : " · at the limit"}`, ok);
    return m.loudDb;
  });
}

/** The audio to render: the take with its moves and trades (lab-render.ts), or 20 s of the style on the gate's tape. */
async function renderNow(): Promise<AudioBuffer> {
  if (take.current && takeBase) return renderTakeAudio(takeBase, take.current, (d) => status(`rendering the take… ${Math.round(d * 100)}%`));
  return renderClip(packOf(draft), 0, 20, mutedParts(recipe), !autoOn);
}
/** RENDER: the take (or 20 s of the style) offline, as a WAV file. */
$("render").addEventListener("click", () =>
  void busy(take.current ? "rendering the take…" : "rendering 20 s…", async () => {
    const buf = await renderNow();
    const a = h("a", { download: `${packOf(draft).key}${take.current ? "-take" : ""}.wav` });
    a.href = URL.createObjectURL(new Blob([Uint8Array.from(atob(audioBufferToWavBase64(buf)), (c) => c.charCodeAt(0))], { type: "audio/wav" }));
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status(take.current ? `${a.download}: the take, ${buf.duration.toFixed(1)} s` : `${a.download}: 20 s from bar 8 on a stretch of the imd-week tape`);
  }),
);

$("reset").addEventListener("click", () => load(recipeOf(presetById(recipe.genre, recipe.preset)!), true));

// ------------------------------------------------------------------------------------------------ community

// The kept listeners' tracks (lab-community.ts): PLAY loads one into the lab and plays it (its take, when it has one),
// OPEN IN LAB loads it to work on, SHARE gives its link. A code is decoded like any link; names are text, never HTML.
const SITE = "https://theidm.fun";
let communityOn: string | null = null;
/** The shelf: the approved ones (newest first), then the baked ones; one card per code. */
let shelf: readonly CommunityPreset[] = COMMUNITY;
const cardOf = (p: CommunityPreset) =>
  h(
    "li",
    { class: "cm-card", "data-cm": p.id },
    h("div", { class: "cm-top" }, h("span", { class: "cm-genre", text: GENRES[p.genre]?.label ?? p.genre }), h("span", { class: "cm-by", text: p.by ? `by @${p.by.replace(/^@/, "")}` : "by a listener" })),
    h("h3", { text: p.name }),
    h("p", { class: "cm-note", text: p.note }),
    h(
      "div",
      { class: "cm-actions" },
      h("button", { type: "button", class: "cm-play", "data-act": "play", "aria-label": `Play ${p.name}`, text: "▶ PLAY" }),
      h("button", { type: "button", "data-act": "open", text: "OPEN IN LAB" }),
      h("button", { type: "button", "data-act": "share", text: "SHARE" }),
    ),
  );
$("community-list").replaceChildren(...shelf.map(cardOf));
void loadRuntime().then((live) => {
  if (!live.length) return;
  // A code on both lists keeps the baked card (its note and credit were written by hand).
  const seen = new Set(COMMUNITY.map((p) => p.code));
  shelf = [...live.filter((p) => !seen.has(p.code) && !!seen.add(p.code)), ...COMMUNITY];
  $("community-list").replaceChildren(...shelf.map(cardOf));
  renderCommunity();
});
function renderCommunity() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-cm]")) {
    const on = el.dataset.cm === communityOn && document.body.classList.contains("playing");
    el.classList.toggle("on", on);
    el.querySelector(".cm-play")!.textContent = on ? "■ STOP" : "▶ PLAY";
  }
}
async function openCommunity(p: CommunityPreset, andPlay: boolean) {
  const d = await decodeRecipe(p.code);
  if (!d.ok) return status(`${p.name}: this track does not open`, false);
  if (andPlay) audio.unlock();
  const t = d.recipe.take;
  // Its own parts, not the ones switched off here (load keeps those for a preset change).
  d.recipe.mutes ??= 0;
  load(d.recipe, audio.running);
  $("shared").hidden = false;
  history.replaceState(null, "", `#s=${p.code}`);
  communityOn = p.id;
  status(`${p.name}${p.by ? ` by @${p.by.replace(/^@/, "")}` : ""}${t ? ` · a take of ${t.bars} bars` : ""}`);
  if (andPlay) {
    if (t) await playTake();
    else if (!audio.running) await play(true);
  } else document.querySelector(".lab-device")?.scrollIntoView({ behavior: "smooth", block: "start" });
  renderCommunity();
}
$("community-list").addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
  const id = btn?.closest<HTMLElement>("[data-cm]")?.dataset.cm;
  const p = shelf.find((x) => x.id === id);
  if (!btn || !p) return;
  const act = btn.dataset.act;
  if (act === "play") {
    if (communityOn === p.id && document.body.classList.contains("playing")) {
      await play(false);
      renderCommunity();
      return;
    }
    await openCommunity(p, true);
  } else if (act === "open") await openCommunity(p, false);
  else if (act === "share") {
    const url = `${SITE}/lab#s=${p.code}`;
    if (navigator.share && matchMedia("(hover: none)").matches) {
      try {
        await navigator.share({ title: `${p.name} · IDM Style Lab`, url });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "COPIED";
      window.setTimeout(() => (btn.textContent = "SHARE"), 1400);
    } catch {
      status(url);
    }
  }
});
new MutationObserver(renderCommunity).observe(document.body, { attributes: true, attributeFilter: ["class"] });

// ------------------------------------------------------------------------------------------------ start

const hash = /^#s=(.*)$/.exec(location.hash)?.[1];
const shared = hash !== undefined ? await decodeRecipe(hash) : null;
if (shared?.ok) {
  const t = shared.recipe.take;
  load(shared.recipe, false);
  if (t) {
    take.current = t;
    renderTake();
    status(`a shared take: ${t.bars} bars, ${t.events.length} moves · PLAY TAKE`);
  }
  $("shared").hidden = false;
} else {
  load(recipeOf(GENRES.acid.presets[0]), false);
  if (shared) status(shared.why === "old" ? "this link is from an older lab: opened the first preset" : "this link is not a lab style: opened the first preset", false);
}
follow("market");
requestAnimationFrame(frame);

// Hook for a headless check: is it playing, how loud and how bright, the knobs, the share code, the export.
(window as unknown as { __lab: unknown }).__lab = {
  running: () => audio.running,
  level: () => (audio.running ? audio.sample() : last),
  swaps: () => audio.swaps,
  pending: () => audio.pending,
  trades: () => trades,
  recipe: () => clone(recipe),
  style: () => clone(draft),
  set(key: string, v: number) {
    const input = document.querySelector<HTMLInputElement>(`[data-knob="${key}"] input`);
    if (!input) throw new Error(`no knob ${key}`);
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return knobsFor(draft).find((x) => x.key === key)!.get(draft);
  },
  macro(key: string, v: number) {
    const input = document.querySelector<HTMLInputElement>(`[data-macro="${key}"]`)!;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  },
  choose(key: string, id: string) {
    const sel = document.querySelector<HTMLSelectElement>(`[data-choice="${key}"]`)!;
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  },
  code: () => encodeRecipe(shareRecipe()),
  take: () => clone({ mode: take.mode, take: take.current, base: takeBase, step: labStep }),
  tradeLog: () => [...tradeLog],
  knobsNow: () => clone(recipe.knobs),
  rec: () => recBtn.click(),
  playTake: () => playTake(),
  stopTake: () => stopTake(),
  trade: (kind: Trade) => trade(kind),
  follow: (id: string) => {
    if (sourceEl) sourceEl.value = id;
    follow(id);
  },
  matchLoudness,
  renderWav: async () => {
    const t0 = performance.now();
    const buf = await renderNow();
    const bytes = Uint8Array.from(atob(audioBufferToWavBase64(buf)), (c) => c.charCodeAt(0));
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    let peak = 0;
    for (const v of buf.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
    return { seconds: buf.duration, wavBytes: bytes.length, sha: sha.slice(0, 16), peak, ms: Math.round(performance.now() - t0) };
  },
  genres: () =>
    GENRE_LIST.map((g) => ({
      id: g.id,
      presets: g.presets.map((p) => ({ id: p.id })),
      knobs: g.knobs.map((k) => ({ key: k.key, min: k.min, max: k.max })),
      macros: g.macros.map((m) => ({ key: m.key })),
    })),
  /** The gate's loudness of any recipe JSON (lab-codec.ts schema), rebuilt as a link would be. */
  async measure(json: unknown, stretches = 3) {
    const r = recipeFrom(json);
    return r ? loudness(packOf(buildStyle(r)), stretches) : null;
  },
  exportText: () => packSource(draft),
  exportErrors: () => exportCheck(packSource(draft)),
};
