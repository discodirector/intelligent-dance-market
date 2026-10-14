import { describe as suite, expect, it } from "vitest";
import { keccak256, encodePacked } from "viem";
import {
  decode,
  encode,
  initialState,
  mutate,
  stepHash,
  trackFor,
  modeFor,
  bassAt,
  isOn,
  type State,
} from "../src/index.ts";

const E18 = 10n ** 18n;
const base = { blockNumber: 21_000_000n, timestamp: 1_760_000_000 };

suite("encode/decode", () => {
  it("initial state packs per SPEC §3.2", () => {
    const { slot0, slot1 } = encode(initialState());
    expect(slot0 & ((1n << 64n) - 1n)).toBe(0x10100101n);
    expect((slot0 >> 200n) & 0xffffn).toBe(128n);
    expect((slot0 >> 216n) & 0xffn).toBe(9n);
    expect((slot1 >> 88n) & 0xffffffffn).toBe(600n);
  });

  it("round-trips extreme values incl. negative int24/int32", () => {
    const s: State = {
      pattern: (1n << 64n) - 1n,
      bass: 0xfedcba9876543210n,
      swapCount: 0xffffffff,
      lastTs: 2 ** 40 - 1,
      bpm: 170,
      root: 11,
      mode: 3,
      patternId: 0xffffffff,
      lastTick: -8388608,
      pressure: -2147483648,
      intervalEma: 3600,
      releaseCount: 7,
    };
    expect(decode(encode(s).slot0, encode(s).slot1)).toEqual(s);
    const t = { ...s, lastTick: 8388607, pressure: 2147483647 };
    expect(decode(encode(t).slot0, encode(t).slot1)).toEqual(t);
  });

  it("negative tick is two's complement in 24 bits", () => {
    const { slot1 } = encode({ ...initialState(), lastTick: -1 });
    expect((slot1 >> 32n) & 0xffffffn).toBe(0xffffffn);
    expect(slot1 >> 56n).toBe(600n << 32n);
  });
});

suite("helpers", () => {
  it("hash = keccak256(abi.encodePacked(uint32,int24,uint64))", () => {
    const manual = keccak256(
      ("0x" + "00000001" + "fffffe" + (21_000_000).toString(16).padStart(16, "0")) as `0x${string}`,
    );
    expect(stepHash(1, -2, 21_000_000n)).toBe(BigInt(manual));
    expect(BigInt(keccak256(encodePacked(["uint32", "int24", "uint64"], [1, -2, 21_000_000n])))).toBe(BigInt(manual));
  });

  it("track thresholds", () => {
    expect(trackFor(E18 / 2n - 1n)).toBe(2);
    expect(trackFor(E18 / 2n)).toBe(3);
    expect(trackFor(5n * E18 - 1n)).toBe(3);
    expect(trackFor(5n * E18)).toBe(1);
    expect(trackFor(25n * E18 - 1n)).toBe(1);
    expect(trackFor(25n * E18)).toBe(0);
    expect(trackFor(1000n * E18)).toBe(0);
  });

  it("mode thresholds", () => {
    expect(modeFor(8001)).toBe(2);
    expect(modeFor(8000)).toBe(0);
    expect(modeFor(0)).toBe(0);
    expect(modeFor(-1)).toBe(1);
    expect(modeFor(-8000)).toBe(1);
    expect(modeFor(-8001)).toBe(3);
  });
});

suite("mutate", () => {
  it("buy sets bit and bass note; first swap uses intervalEma as dt", () => {
    const { state, event } = mutate(initialState(), { isBuy: true, imdAmt: E18, tick: -600, ...base });
    expect(state.swapCount).toBe(1);
    expect(event.track).toBe(3);
    expect(isOn(state.pattern, 3, event.step)).toBe(true);
    expect(bassAt(state.bass, event.step)).toBe(1 + (10 % 15));
    expect(event.bassNote).toBe(11);
    expect(state.intervalEma).toBe(600);
    expect(state.bpm).toBe(170 - Math.floor((600 * 80) / 3600));
    expect(state.pressure).toBe(1000);
    expect(state.mode).toBe(0);
    expect(state.lastTs).toBe(base.timestamp);
    expect(state.lastTick).toBe(-600);
    expect(encode(state)).toEqual({ slot0: event.slot0, slot1: event.slot1 });
  });

  it("sell clears bit; pressure goes negative -> Phrygian", () => {
    let s = initialState();
    const r = mutate(s, { isBuy: false, imdAmt: 30n * E18, tick: 100, ...base });
    s = r.state;
    expect(r.event.track).toBe(0);
    expect(isOn(s.pattern, 0, r.event.step)).toBe(false);
    expect(s.pressure).toBe(-1000);
    expect(s.mode).toBe(1);
  });

  it("pressure decay truncates toward zero like Solidity", () => {
    const s = { ...initialState(), pressure: -17 };
    expect(mutate(s, { isBuy: true, imdAmt: 1n, tick: 0, ...base }).state.pressure).toBe(-17 + 1 + 1000);
  });

  it("dt caps at EMA_CAP and bpm stays within bounds", () => {
    let s: State = { ...initialState(), swapCount: 5, lastTs: 1000, intervalEma: 3600 };
    const r = mutate(s, { isBuy: true, imdAmt: 1n, tick: 0, blockNumber: 1, timestamp: 10_000_000 });
    expect(r.state.intervalEma).toBe(3600);
    expect(r.state.bpm).toBe(90);
    s = { ...initialState(), swapCount: 5, lastTs: 1000, intervalEma: 0 };
    expect(mutate(s, { isBuy: true, imdAmt: 1n, tick: 0, blockNumber: 1, timestamp: 1000 }).state.bpm).toBe(170);
  });

  it("first swap is swapCount==0 regardless of lastTs; backwards clock gives dt=0", () => {
    const first = mutate({ ...initialState(), lastTs: 5 }, { isBuy: true, imdAmt: 1n, tick: 0, blockNumber: 1, timestamp: 99_999 });
    expect(first.state.intervalEma).toBe(600);
    const back = mutate({ ...initialState(), swapCount: 3, lastTs: 2000, intervalEma: 800 }, { isBuy: true, imdAmt: 1n, tick: 0, blockNumber: 1, timestamp: 1000 });
    expect(back.state.intervalEma).toBe(700);
  });

  it("counters wrap mod 2^32", () => {
    const s = { ...initialState(), swapCount: 0xffffffff, patternId: 0xffffffff };
    const r = mutate(s, { isBuy: true, imdAmt: 100n * E18, tick: 0, ...base });
    expect(r.state.swapCount).toBe(0);
    // whale +1 -> 0, then swapCount 0 % 64 == 0 -> page +1
    expect(r.state.patternId).toBe(1);
  });

  it("whale rotates root by a fifth and emits Movement", () => {
    const r = mutate(initialState(), { isBuy: true, imdAmt: 100n * E18, tick: 0, ...base });
    expect(r.event.whale).toBe(true);
    expect(r.state.root).toBe((9 + 7) % 12);
    expect(r.state.patternId).toBe(1);
    expect(r.event.movement).toEqual({ patternId: 1, root: 4, swapCount: 1 });
  });

  it("page turns every 64 swaps", () => {
    let s = initialState();
    for (let i = 0; i < 64; i++) {
      s = mutate(s, { isBuy: i % 2 === 0, imdAmt: E18, tick: i * 7 - 200, blockNumber: 100 + i, timestamp: 1000 + i * 12 }).state;
      expect(s.patternId).toBe(i === 63 ? 1 : 0);
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const s = initialState();
    const snap = { ...s };
    const a = mutate(s, { isBuy: true, imdAmt: 7n * E18, tick: 1234, ...base });
    const b = mutate(s, { isBuy: true, imdAmt: 7n * E18, tick: 1234, ...base });
    expect(a).toEqual(b);
    expect(s).toEqual(snap);
  });
});
