// Listen: a station's sound alone, for someone else's stream or site (theidm.fun/listen.html?net=squeekchain).
// The same feed and live player as index.html for the same ?net=, so it plays exactly what the station page plays
// (the hamster's wheel, its sleep mode, a pool's swaps), without the module. It starts on its own where the browser
// lets it (OBS's browser source, a page that allows autoplay); elsewhere one tap on the bar starts it.
//   ?ui=0      no bar at all (a stream: the page is silent glass, only the sound)
//   ?vol=0.8   master volume 0..1 (default 0.75)
//   ?tap=1     the radio harness (bot/src/radio): the output tapped as PCM to window.__tapChunk (tap.ts)
import { initialState, type State } from "@swarm-sequencer/core";
import { eraOf, packFor, programFor, styleOf, withSleep, type SequencerState } from "@swarm-sequencer/synth";
import { Audio } from "./audio";
import { readSource } from "./config";
import { startHamster } from "./data/hamster";
import { startLive } from "./data/live";
import { noteNftCues, type Feed } from "./data/types";
import { startVirtual } from "./data/virtual";
import { RULES, toSynth } from "./rules";
import { playerMode } from "./runtime";
import { applyTheme, loadStatus, stationFor } from "./stations";
import { startTap } from "./tap";

const $ = (id: string) => document.getElementById(id)!;
const q = new URLSearchParams(location.search);
const source = readSource(`?${new URLSearchParams({ net: q.get("net") ?? "squeekchain" })}`);
const net = source.net;
const rules = RULES[source.rules];
const station = stationFor(net);
if (station) applyTheme(station.theme);
if (q.get("ui") === "0") document.body.classList.add("bare");

const awake = programFor(station?.program ?? "idm");
const sleepPack = net.hamster?.sleep ? (packFor(net.hamster.sleep) ?? null) : null;
const program = sleepPack ? withSleep(awake, sleepPack) : awake;
const audio = new Audio(awake, sleepPack);
const vol = Number(q.get("vol"));
if (vol >= 0 && vol <= 1 && q.has("vol")) audio.setVolume(vol);
/** Off air (a paid station whose subscription ran out): the page never plays, as the station page. */
const offAir = station && !station.house ? loadStatus().then((st) => playerMode(station, st?.[station.key]?.status) === "off-air") : Promise.resolve(false);

let state: State = initialState();
let clock: number | null = null;
const asSynth = (s: State): SequencerState => toSynth(s, rules);

const feed: Feed = {
  onSwap(e, backfill) {
    if (!backfill || e.state.swapCount >= state.swapCount) state = e.state;
    if (backfill || !audio.running) return;
    audio.player!.setState(asSynth(state));
    if (e.whale) audio.player!.noteDrop({ track: e.track, fill: e.isBuy });
    if (e.trackComplete) audio.player!.noteTrackDrop(asSynth(e.trackComplete.held));
    noteNftCues(audio.player!, e);
  },
  onState(s) {
    if (s.swapCount >= state.swapCount) state = s;
    audio.player?.setState(asSynth(state));
  },
  onBlock() {},
  onStatus(_text, ok) {
    document.body.classList.toggle("bad", !ok);
  },
  onClock(c) {
    clock = c;
    audio.player?.setClock(c);
  },
  onReset(s) {
    state = s;
    audio.player?.setState(asSynth(state));
  },
};

$("name").textContent = `${station?.label ?? net.label} radio`;
const bar = $("play") as HTMLButtonElement;
($("by") as HTMLAnchorElement).href = `https://theidm.fun/?net=${encodeURIComponent(q.get("net") ?? "squeekchain")}`;
async function play(on: boolean) {
  if (on && (await offAir)) return;
  if (on) await audio.start(asSynth(state), clock);
  else audio.stop();
  document.body.classList.toggle("playing", on && audio.ctx?.state === "running");
}
bar.addEventListener("click", () => {
  const on = !document.body.classList.contains("playing");
  if (on) audio.unlock(); // in the gesture (iOS)
  void play(on);
});

/** What the bar says: the genre playing, or the sleep slot's style while the hamster sleeps. */
function nowPlaying(): { asleep: boolean; genre: string; style: string } | null {
  const p = audio.player;
  if (!p?.running) return null;
  const sleep = p.getSleep();
  if (sleep) return { asleep: true, genre: sleep.era.name, style: styleOf(sleep.era, sleep.epoch, program).style.name };
  const { epoch } = p.getEra();
  const era = eraOf(epoch, program);
  return { asleep: false, genre: era.name, style: styleOf(era, epoch, program).style.name };
}
function label() {
  const n = nowPlaying();
  if (!n) return "tap to listen";
  return (n.asleep ? `asleep · ${n.style}` : n.style ? `${n.genre} · ${n.style}` : n.genre).toLowerCase();
}
setInterval(() => {
  const t = label();
  if ($("now").textContent !== t) $("now").textContent = t;
}, 1000);

if (net.hamster) startHamster(net, feed, net.hamster);
else if (net.virtual) startVirtual(net, feed);
else startLive(net, feed);

// Autoplay where allowed: OBS and pages that allow it get a running context at once and start; a browser that blocks
// it keeps the context suspended (its resume waits for a gesture), and the bar waits for a tap.
audio.unlock();
const tapTo = q.get("tap") === "1" ? (window as unknown as { __tapChunk?: (b64: string) => void }).__tapChunk : undefined;
let rate = 0;
setTimeout(async () => {
  if (audio.ctx?.state !== "running") return;
  await play(true);
  if (tapTo && audio.running) rate = await startTap(audio, tapTo);
}, 600);

// Hook for a headless check: is it playing, and how loud.
(window as unknown as { __listen: unknown }).__listen = {
  running: () => audio.running && audio.ctx?.state === "running",
  rate: () => rate,
  rms: () => audio.sample(),
  now: label,
  /** What plays now, for the radio's now-playing endpoint (bot/src/radio): null before the player starts. */
  info: nowPlaying,
};
