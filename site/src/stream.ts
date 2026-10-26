// Stream audio source: the site's feed + live player without the UI, for the YouTube radio (sim/stream/live).
// Plays what index.html plays for the same URL params; the master output is tapped as 16-bit PCM.
import { initialState, type State } from "@swarm-sequencer/core";
import { programFor, type SequencerState } from "@swarm-sequencer/synth";
import { readSource } from "./config";
import { RULES, toSynth } from "./rules";
import { Audio } from "./audio";
import { startLive } from "./data/live";
import { startVirtual } from "./data/virtual";
import { startReplay } from "./data/replay";
import { inkCueOf, noteNftCues, type Feed } from "./data/types";
import { chainOf, stationFor } from "./stations";

type TapSink = (b64: string) => void;
const w = window as unknown as { __tapChunk?: TapSink; __stream?: unknown };

const source = readSource();
const net = source.net;
const rules = RULES[source.rules];
const asSynth = (s: State): SequencerState => toSynth(s, rules);
// Same program (genres + styles) as the station's page on the site: house for $IDM and IMD/ETH, the pack otherwise.
const station = stationFor(net);
const program = programFor(station?.program ?? "idm");
const q = new URLSearchParams(location.search);
const gain = Number(q.get("gain") ?? "0.75");

let state: State = initialState();
let clock: number | null = null;
let status = "starting";
let ok = true;
let swaps = 0;
let drops = 0;
let chunks = 0;
const audio = new Audio(program);

const feed: Feed = {
  onSwap(e, backfill) {
    swaps++;
    if (!backfill || e.state.swapCount >= state.swapCount) state = e.state;
    const tc = e.trackComplete;
    if (tc) drops++;
    if (!backfill && audio.running) {
      audio.player!.setState(asSynth(state));
      if (e.whale) audio.player!.noteDrop({ track: e.track, fill: e.isBuy });
      if (tc) audio.player!.noteTrackDrop(asSynth(tc.held));
      noteNftCues(audio.player!, e);
    }
  },
  onOrnament(o, backfill) {
    if (!backfill && audio.running) audio.player!.noteInk(inkCueOf(o));
  },
  onState(s) {
    if (s.swapCount >= state.swapCount) state = s;
    audio.player?.setState(asSynth(state));
  },
  onBlock() {},
  onStatus(text, good) {
    status = text;
    ok = good;
  },
  onClock(c) {
    clock = c;
    audio.player?.setClock(c);
  },
};

// AudioWorklet tap: interleaved s16le, posted every 4800 frames (100 ms at 48 kHz; the rate is the device's).
const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.n = 0; this.buf = new Int16Array(4800 * 2); }
  process(inputs) {
    const ch = inputs[0];
    const L = ch && ch[0], R = (ch && ch[1]) || L;
    const frames = L ? L.length : 128;
    for (let i = 0; i < frames; i++) {
      const l = L ? L[i] : 0, r = R ? R[i] : 0;
      this.buf[this.n * 2] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
      this.buf[this.n * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
      if (++this.n === 4800) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(4800 * 2); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("idm-tap", Tap);`;

function toB64(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function boot() {
  await audio.start(asSynth(state), clock);
  audio.setVolume(gain);
  const ctx = audio.ctx!;
  if (ctx.sampleRate !== 48000) console.warn(`AudioContext runs at ${ctx.sampleRate} Hz, the harness expects 48000`);
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: "application/javascript" })));
  const tap = new AudioWorkletNode(ctx, "idm-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
  // audio.ts shadows ctx.destination with its master gain; the tap (silent output) must reach the real
  // destination to be pulled, never the master (that would feed back).
  const realDest = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "destination")!.get!.call(ctx) as AudioDestinationNode;
  audio.analyser!.connect(tap); // master -> analyser -> real destination, and -> tap
  tap.connect(realDest);
  tap.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    chunks++;
    w.__tapChunk?.(toB64(e.data));
  };
  if (source.kind === "replay") void startReplay(source.replay.url, source.speed, source.replay.label, feed, rules, source.resim, source.replay.epochPlay);
  else if (net.virtual) startVirtual(net, feed);
  else startLive(net, feed);
}

w.__stream = {
  station: () =>
    station
      ? { key: station.key, ticker: station.ticker, label: station.label, kind: station.kind, chain: chainOf(station).name, theme: station.theme, program: station.program }
      : null,
  info: () => ({ net: net.label, station: station?.key ?? null, kind: source.kind, rules: rules.version, status, ok, swaps, drops, chunks, running: audio.running, rate: audio.ctx?.sampleRate ?? 0, swapCount: state.swapCount }),
};
boot().catch((e) => {
  status = `boot failed: ${(e as Error).message}`;
  ok = false;
});
