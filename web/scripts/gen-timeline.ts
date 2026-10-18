import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bassAt, encode, infoLine, initialState, isOn } from "../../packages/synth/src/index.ts";
import { mutate } from "../src/demo/mutate.ts";

const E = 10n ** 18n;
const amounts = [E / 4n, E / 2n - 1n, 2n * E, 4n * E, 10n * E, 18n * E, 40n * E, 70n * E];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x51ed01);
let state = initialState();
let chainTs = 1_700_000_000;
let block = 21_000_000n;
let play = 0;

const events: Record<string, unknown>[] = [];
const first = encode(state);
events.push({
  slot0: "0x" + first.slot0.toString(16),
  slot1: "0x" + first.slot1.toString(16),
  timestamp: 0,
  swapCount: 0,
});

for (let i = 0; i < 28; i++) {
  play += 1.05 + rnd() * 0.55;
  chainTs += 2 + Math.floor(rnd() * 28);
  const whale = i === 22;
  const input = {
    isBuy: rnd() < 0.66,
    imdAmt: whale ? 160n * E : (amounts[Math.floor(rnd() * amounts.length)] ?? E),
    tick: Math.floor(rnd() * 2800) - 400,
    blockNumber: block,
    timestamp: chainTs,
  };
  block += 1n + BigInt(Math.floor(rnd() * 2));
  const next = mutate(state, input);
  state = next.state;
  const event = next.event;
  events.push({
    slot0: "0x" + event.slot0.toString(16),
    slot1: "0x" + event.slot1.toString(16),
    timestamp: Number(play.toFixed(3)),
    track: event.track,
    step: event.step,
    on: event.on,
    bassNote: event.bassNote,
    isBuy: event.isBuy,
    imdAmount: event.imdAmount.toString(),
    tick: event.tick,
    swapCount: event.swapCount,
  });
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/demo-timeline.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(events, null, 2) + "\n");

let kicks = 0;
let snares = 0;
let hats = 0;
let glitches = 0;
let bass = 0;
for (let step = 0; step < 16; step++) {
  if (isOn(state.pattern, 0, step)) kicks += 1;
  if (isOn(state.pattern, 1, step)) snares += 1;
  if (isOn(state.pattern, 2, step)) hats += 1;
  if (isOn(state.pattern, 3, step)) glitches += 1;
  if (bassAt(state.bass, step) > 0) bass += 1;
}
console.log(`wrote ${events.length} events, span ${play.toFixed(2)}s`);
console.log(infoLine(state));
console.log(`hits k${kicks} s${snares} h${hats} g${glitches} bass${bass}`);
