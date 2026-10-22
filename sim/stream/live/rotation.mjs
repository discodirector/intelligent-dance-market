// The IDM radio's automatic rotation (stream.mjs --stations auto, docs/STATIONS.md "Station+"): the house stations
// plus the Station+ stations, nothing else. Pure, so rotation.test.mjs checks the schedule.
//
// One cycle is an hour (--hour-minutes): each Station+ station plays --plus-minutes (default 8), the house stations
// share the rest equally, never less than --house-min-minutes each (with many Station+ stations the cycle runs
// longer than an hour instead). Order: each house station, then its share of the Station+ stations in registry order
// (the first house station takes the first half), so a Station+ station never waits more than about half an hour.
//   0 Station+: idm 30, imd-eth 30
//   1 Station+: idm 26, A 8, imd-eth 26
//   2 Station+: idm 22, A 8, imd-eth 22, B 8
//   6 Station+: idm 6, A 8, B 8, C 8, imd-eth 6, D 8, E 8, F 8

/** Baked registry stations, then the runtime ones (stations-data/stations.json) whose key is not baked. */
export function mergedStations(registry, runtime) {
  const baked = registry?.stations ?? [];
  const keys = new Set(baked.map((s) => s.key));
  const extra = (Array.isArray(runtime?.stations) ? runtime.stations : []).filter((s) => s && typeof s.key === "string" && !keys.has(s.key));
  return [...baked, ...extra];
}

/**
 * The cycle as [{ st, minutes }]: live house stations and live Station+ stations (status.json `plus: true`; without
 * a status file, none: the house alone). The hook station plays as `robinhood` (stream.mjs netOf).
 */
export function autoRotation({ stations, status, plusMinutes = 8, hourMinutes = 60, houseMinMinutes = 5 }) {
  const live = (s) => (status?.[s.key]?.status ?? s.status) === "live";
  const house = stations.filter((s) => s.house && live(s));
  const plus = stations.filter((s) => !s.house && live(s) && status?.[s.key]?.plus === true);
  if (!house.length) return plus.map((st) => ({ st, minutes: plusMinutes }));
  const houseMinutes = Math.max(houseMinMinutes, (hourMinutes - plusMinutes * plus.length) / house.length);
  const per = Math.ceil(plus.length / house.length);
  return house.flatMap((h, i) => [
    { st: h, minutes: houseMinutes },
    ...plus.slice(i * per, (i + 1) * per).map((st) => ({ st, minutes: plusMinutes })),
  ]);
}
