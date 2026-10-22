// node --test sim/stream/live/rotation.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { autoRotation, mergedStations } from "./rotation.mjs";

const house = [{ key: "idm", house: true, status: "live" }, { key: "imd-eth", house: true, status: "live" }];
const st = (key, status = "live") => ({ key, status });
const plan = (r) => r.map(({ st, minutes }) => `${st.key} ${minutes}`);

test("house only without Station+ (or without status.json): 30 / 30", () => {
  const stations = [...house, st("infer")];
  assert.deepEqual(plan(autoRotation({ stations, status: null })), ["idm 30", "imd-eth 30"]);
  assert.deepEqual(plan(autoRotation({ stations, status: { infer: { status: "live" } } })), ["idm 30", "imd-eth 30"]);
});

test("Station+ stations 8 min each, the house shares the rest of the hour; split after each house station", () => {
  const stations = [...house, ...["a", "b", "c", "d", "e", "f"].map((k) => st(k)), st("plain")];
  const plus = (keys) => Object.fromEntries(keys.map((k) => [k, { status: "live", plus: true }]));
  assert.deepEqual(plan(autoRotation({ stations, status: plus(["a"]) })), ["idm 26", "a 8", "imd-eth 26"]);
  assert.deepEqual(plan(autoRotation({ stations, status: plus(["a", "b"]) })), ["idm 22", "a 8", "imd-eth 22", "b 8"]);
  const six = autoRotation({ stations, status: plus(["a", "b", "c", "d", "e", "f"]) });
  assert.deepEqual(plan(six), ["idm 6", "a 8", "b 8", "c 8", "imd-eth 6", "d 8", "e 8", "f 8"]);
  assert.equal(six.reduce((m, x) => m + x.minutes, 0), 60);
  // Never below the house minimum: the cycle runs longer instead.
  const nine = autoRotation({ stations: [...stations, st("g"), st("h"), st("i")], status: plus(["a", "b", "c", "d", "e", "f", "g", "h", "i"]) });
  assert.equal(nine[0].minutes, 5);
});

test("only live: an expired or paused Station+ drops out; a house station off the registry's live drops out", () => {
  const stations = [...house, st("a"), st("b", "paused")];
  const status = { a: { status: "expired", plus: true }, b: { status: "paused", plus: true } };
  assert.deepEqual(plan(autoRotation({ stations, status })), ["idm 30", "imd-eth 30"]);
});

test("runtime stations join after the baked ones, a baked key wins", () => {
  const merged = mergedStations({ stations: [...house, st("infer")] }, { stations: [st("chog"), { ...st("infer"), label: "dup" }, null] });
  assert.deepEqual(merged.map((s) => s.key), ["idm", "imd-eth", "infer", "chog"]);
  assert.equal(merged.find((s) => s.key === "infer").label, undefined);
  assert.deepEqual(mergedStations({ stations: house }, null).map((s) => s.key), ["idm", "imd-eth"]);
});
