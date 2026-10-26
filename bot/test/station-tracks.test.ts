// Station track posts (stations/trackPosts.ts): the STATION_TRACKS list and its IMD_STATION alias, the state
// migration, no backlog when a station is first listed, per-station queueing, the cap, the Credits caption.
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../src/lib/timeline.ts";
import { decide, type PostRecord, type QueuedTrack, type SchedState } from "../src/rules.ts";
import {
  cashtags, IMD_ETH, migrateStationTracks, nftItemName, nftTrackCaption, postableTracks, queueStationTracks, STATION_TRACK_RULES,
  stationTrackKeys,
} from "../src/stations/trackPosts.ts";

const H = 3_600_000;
const T = Date.parse("2026-10-26T12:00:00Z");
/** A tape with these tracks finished (one TrackComplete each, block = 100 x trackNo) between plain swaps. */
const tape = (...done: number[]) =>
  done.flatMap((n) => [{ blockNumber: n * 100 - 1 }, { blockNumber: n * 100, trackComplete: { trackNo: n } }]) as unknown as TimelineEntry[];
const uncapped = new Set([IMD_ETH]);

describe("STATION_TRACKS", () => {
  it("parses a comma list of registry keys, trimmed, without repeats or blanks", () => {
    expect(stationTrackKeys({ STATION_TRACKS: "imd-eth, credits,,credits " })).toEqual(["imd-eth", "credits"]);
    expect(stationTrackKeys({})).toEqual([]);
    expect(stationTrackKeys({ STATION_TRACKS: "" })).toEqual([]);
  });
  it("IMD_STATION=1 still means imd-eth, alone or with the list", () => {
    expect(stationTrackKeys({ IMD_STATION: "1" })).toEqual(["imd-eth"]);
    expect(stationTrackKeys({ IMD_STATION: "1", STATION_TRACKS: "credits" })).toEqual(["imd-eth", "credits"]);
    expect(stationTrackKeys({ IMD_STATION: "1", STATION_TRACKS: "credits,imd-eth" })).toEqual(["imd-eth", "credits"]);
    expect(stationTrackKeys({ IMD_STATION: "0", STATION_TRACKS: "credits" })).toEqual(["credits"]);
  });
});

describe("state", () => {
  it("moves the old IMD/ETH counter into the map, so imd-eth posts nothing again", () => {
    const s: SchedState = { posts: [], stationLastTrackNo: 41, trackQueue: [] };
    expect(migrateStationTracks(s)).toEqual({ "imd-eth": 41 });
    expect(s.stationLastTrackNo).toBeUndefined();
    // Tracks up to 41 are already posted; only 42 joins.
    expect(queueStationTracks(s, IMD_ETH, tape(40, 41, 42))).toBe(1);
    expect(s.trackQueue).toEqual([{ trackNo: 42, block: 4200, station: "imd-eth" }]);
  });
  it("migrates once and never overwrites a newer map entry", () => {
    const s: SchedState = { posts: [], stationLastTrackNo: 5, stationTracks: { "imd-eth": 9 } };
    migrateStationTracks(s);
    expect(s.stationTracks).toEqual({ "imd-eth": 9 });
    migrateStationTracks(s);
    expect(s.stationTracks).toEqual({ "imd-eth": 9 });
  });
  it("a state from before the queue is fine", () => {
    const s: SchedState = { posts: [] };
    expect(migrateStationTracks(s)).toEqual({});
  });
});

describe("queueing", () => {
  it("a newly listed station posts no backlog: it starts from its newest finished track", () => {
    const s: SchedState = { posts: [], stationTracks: { "imd-eth": 3 } };
    expect(queueStationTracks(s, "credits", tape(1, 2, 3, 4, 5, 6, 7, 8))).toBe(0);
    expect(s.stationTracks!.credits).toBe(8);
    expect(s.trackQueue ?? []).toEqual([]);
    // Only what finishes afterwards is queued, once.
    expect(queueStationTracks(s, "credits", tape(6, 7, 8, 9))).toBe(1);
    expect(queueStationTracks(s, "credits", tape(6, 7, 8, 9))).toBe(0);
    expect(queueStationTracks(s, "credits", tape(9, 10, 11))).toBe(2);
    expect(s.trackQueue).toEqual([
      { trackNo: 9, block: 900, station: "credits" },
      { trackNo: 10, block: 1000, station: "credits" },
      { trackNo: 11, block: 1100, station: "credits" },
    ]);
  });
  it("a station with no finished track yet posts its first one", () => {
    const s: SchedState = { posts: [] };
    expect(queueStationTracks(s, "credits", tape())).toBe(0);
    expect(s.stationTracks!.credits).toBe(0);
    expect(queueStationTracks(s, "credits", tape(1))).toBe(1);
  });
  it("each station keeps its own count; items carry their station", () => {
    const s: SchedState = { posts: [], stationTracks: { "imd-eth": 12, credits: 8 }, trackQueue: [{ trackNo: 300, block: 1 }] };
    queueStationTracks(s, IMD_ETH, tape(12, 13));
    queueStationTracks(s, "credits", tape(8, 9));
    expect(s.stationTracks).toEqual({ "imd-eth": 13, credits: 9 });
    expect(s.trackQueue!.map((t) => [t.station ?? "idm", t.trackNo])).toEqual([["idm", 300], ["imd-eth", 13], ["credits", 9]]);
  });
});

describe("cap", () => {
  const q: QueuedTrack[] = [
    { trackNo: 9, block: 1, station: "credits" },
    { trackNo: 301, block: 2 },
    { trackNo: 13, block: 3, station: "imd-eth" },
    { trackNo: 10, block: 4, station: "credits" },
  ];
  const credits = (...hoursAgo: number[]): PostRecord[] => hoursAgo.map((h) => ({ at: T - h * H, kind: "track", station: "credits" }));

  it("queue order; a capped station waits while the hook and house stations post", () => {
    expect(postableTracks(q, [], T, uncapped).map((t) => t.trackNo)).toEqual([9, 301, 13, 10]);
    // Three Credits posts in 24 h: its tracks wait, the others do not.
    expect(postableTracks(q, credits(3, 8, 20), T, uncapped).map((t) => t.trackNo)).toEqual([301, 13]);
    // Older than 24 h no longer counts.
    expect(postableTracks(q, credits(3, 8, 25), T, uncapped).map((t) => t.trackNo)).toEqual([9, 301, 13, 10]);
  });
  it("two posts of a capped station are at least 2 h apart", () => {
    expect(STATION_TRACK_RULES).toEqual({ perDay: 3, gapMs: 2 * H });
    expect(postableTracks(q, credits(1.5), T, uncapped).map((t) => t.trackNo)).toEqual([301, 13]);
    expect(postableTracks(q, credits(2), T, uncapped).map((t) => t.trackNo)).toEqual([9, 301, 13, 10]);
  });
  it("hook and house track posts never count against a station", () => {
    const posts: PostRecord[] = Array.from({ length: 10 }, (_, i) => ({ at: T - i * H, kind: "track" as const, ...(i % 2 ? { station: "imd-eth" } : {}) }));
    expect(postableTracks(q, posts, T, uncapped).map((t) => t.trackNo)).toEqual([9, 301, 13, 10]);
  });
  it("held tracks (notBefore) still wait", () => {
    expect(postableTracks([{ trackNo: 9, block: 1, station: "credits", notBefore: T + H }], [], T, uncapped)).toEqual([]);
  });
  it("only postable tracks make a track post; the daily cap holds for all", () => {
    const capped: QueuedTrack[] = [{ trackNo: 9, block: 1, station: "credits" }];
    const s: SchedState = { posts: credits(1, 4, 7), trackQueue: capped, lastBlock: 1 };
    const newTracks = postableTracks(s.trackQueue, s.posts, T, uncapped).length;
    expect(newTracks).toBe(0);
    expect(decide(T, s, { live: true, newMovements: 0, newTracks })).not.toBe("track");
    const full: SchedState = { posts: Array.from({ length: 24 }, (_, i) => ({ at: T - i * 0.5 * H, kind: "track" as const })) };
    expect(decide(T, full, { live: true, newMovements: 0, newTracks: 5 })).toBeNull();
  });
});

describe("Credits caption", () => {
  const c9 = nftTrackCaption({ label: "CREDITS", key: "credits", trackNo: 9, count: 214, genre: "Dub Techno", style: "Void" });
  it("names the station, sales, genre · style and the link; lowercase", () => {
    expect(c9).toBe(
      "track #9 finished on the credits station: 214 sales, dub techno · void.\n" +
        "every credits sale is a note, played through the $IDM rules.\n" +
        "https://theidm.fun/?net=credits",
    );
  });
  it("one cashtag at most, never $CREDIT, no handle, no swaps/pool/hook", () => {
    for (const text of [c9, nftTrackCaption({ label: "CREDITS", key: "credits", trackNo: 10, count: 49, site: "https://theidm.fun/" })]) {
      expect(cashtags(text).length).toBeLessThanOrEqual(1);
      expect(cashtags(text)).toEqual(["$IDM"]);
      expect(text).not.toMatch(/\$CREDIT/i);
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/swap|pool|hook/);
      expect(text).toBe(text.toLowerCase().replace("$idm", "$IDM"));
    }
  });
  it("the item name as the site says it", () => {
    expect(nftItemName("CREDIT")).toBe("Credit");
  });
});
