// Stress bench for SPEC §4.3: degenerate swap streams must still arrange into a sane groove.
//   npx tsx web/scripts/stress.ts          → checks + web/public/stress/*.timeline.json
// Then `node web/scripts/stress-render.mjs` renders each timeline to sim/stress/*.wav for listening.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arrange, encode, initialState, isOn, type SequencerState } from "../../packages/synth/src/index.ts";
import { mutate } from "../../packages/core/src/index.ts";

const E = 10n ** 18n;
const SIZE = { hat: E / 4n, glitch: 2n * E, snare: 10n * E, kick: 40n * E, whale: 160n * E };
type Swap = { isBuy: boolean; imdAmt: bigint; tick?: number };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const repeat = (n: number, s: Swap): Swap[] => Array.from({ length: n }, () => s);
const r = rng(7);
const SCENARIOS: Record<string, Swap[]> = {
  "50-small-buys": repeat(50, { isBuy: true, imdAmt: SIZE.hat }),
  "50-snare-buys": repeat(50, { isBuy: true, imdAmt: SIZE.snare }),
  "50-kick-buys": repeat(50, { isBuy: true, imdAmt: SIZE.kick }),
  "50-glitch-buys": repeat(50, { isBuy: true, imdAmt: SIZE.glitch }),
  "50-sells": repeat(50, { isBuy: false, imdAmt: SIZE.snare }),
  "whales-only": Array.from({ length: 20 }, (_, i) => ({ isBuy: i % 3 !== 2, imdAmt: SIZE.whale })),
  "same-tick-buys": repeat(50, { isBuy: true, imdAmt: SIZE.snare, tick: 1200 }),
  "mixed-random": Array.from({ length: 60 }, () => ({
    isBuy: r() < 0.6,
    imdAmt: [SIZE.hat, SIZE.glitch, SIZE.snare, SIZE.kick][Math.floor(r() * 4)],
  })),
};

const SPACING = 0.5; // playback seconds between swaps
const STEPS = 16;
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/stress");
mkdirSync(out, { recursive: true });

function rawCounts(s: SequencerState) {
  return [0, 1, 2, 3].map((t) => Array.from({ length: STEPS }, (_, i) => isOn(s.pattern, t, i)).filter(Boolean).length);
}

/** Rules a listener would notice. Returns violations for this state across the full 32-bar form. */
function check(s: SequencerState): string[] {
  const bad: string[] = [];
  for (let bar = 0; bar < 32; bar++) {
    const a = arrange(s, bar);
    const n = a.vel.map((row) => row.filter((v) => v > 0).length);
    if (n[0] > 6) bad.push(`kick ${n[0]} hits`);
    if (n[0] > 0 && a.vel[0][0] === 0) bad.push("kick without downbeat");
    if (n[1] > 0 && (a.vel[1][4] === 0 || a.vel[1][12] === 0)) bad.push("snare without backbeat");
    if (n[1] - (bar % 4 === 3 ? 3 : 0) > 6) bad.push(`snare ${n[1]} hits`);
    if (n[2] > 12) bad.push(`hat ${n[2]} hits`);
    if (n[3] > 3) bad.push(`glitch ${n[3]} hits`);
    let run = 0;
    for (let i = 0; i < STEPS * 2; i++) {
      const v = a.vel[1][i % STEPS];
      run = v >= 0.9 ? run + 1 : 0;
      if (run > 1) bad.push("two full snares in a row");
    }
    const notes = Array.from({ length: STEPS }, (_, i) => Number((a.bass >> BigInt(i * 4)) & 0xfn)).filter((d) => d > 0);
    if (notes.length > 6) bad.push(`bass ${notes.length} notes`);
  }
  return [...new Set(bad)];
}

let failures = 0;
for (const [name, swaps] of Object.entries(SCENARIOS)) {
  let state = initialState();
  let ts = 1_760_000_000;
  let block = 21_000_000n;
  const first = encode(state);
  const events: Record<string, unknown>[] = [
    { slot0: "0x" + first.slot0.toString(16), slot1: "0x" + first.slot1.toString(16), timestamp: 0, swapCount: 0 },
  ];
  const problems = new Set<string>();
  swaps.forEach((swap, i) => {
    ts += 6;
    block += 1n;
    const next = mutate(state, {
      isBuy: swap.isBuy,
      imdAmt: swap.imdAmt,
      tick: swap.tick ?? 600 + ((i * 397) % 2400),
      blockNumber: block,
      timestamp: ts,
    });
    state = next.state;
    for (const p of check(state)) problems.add(p);
    const e = next.event;
    events.push({
      slot0: "0x" + e.slot0.toString(16),
      slot1: "0x" + e.slot1.toString(16),
      timestamp: Number(((i + 1) * SPACING).toFixed(3)),
      track: e.track,
      step: e.step,
      on: e.on,
      bassNote: e.bassNote,
      isBuy: e.isBuy,
      imdAmount: e.imdAmount.toString(),
      tick: e.tick,
      swapCount: e.swapCount,
      ...(e.drop ? { drop: e.drop } : {}),
    });
  });
  writeFileSync(resolve(out, `${name}.timeline.json`), JSON.stringify(events) + "\n");
  const raw = rawCounts(state);
  const arr = arrange(state, 16).vel.map((row) => row.filter((v) => v > 0).length);
  const status = problems.size ? `FAIL ${[...problems].join(", ")}` : "ok";
  if (problems.size) failures++;
  console.log(`${name.padEnd(16)} raw k${raw[0]} s${raw[1]} h${raw[2]} g${raw[3]} → played k${arr[0]} s${arr[1]} h${arr[2]} g${arr[3]}  ${status}`);
}
console.log(failures ? `${failures} scenario(s) failed` : "all scenarios pass");
process.exit(failures ? 1 : 0);
