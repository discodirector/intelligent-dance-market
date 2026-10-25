// The Credits station (registry kind "nft", core nft.ts) in the bot: the registry entry becomes a collection source,
// the cache reads it in pieces exactly like one read (the decoder's carry kept between reads), the checkpoint carries
// the carry and the items, and a gift station never expires.
import { readFileSync } from "node:fs";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { checkpointProblem, stationFingerprint, type NftSource } from "@swarm-sequencer/core";
import { registryProblems } from "../../stations/validate.mjs";
import { svgOfTokenUri } from "../../site/src/tokenuri.ts";
import { firstPaidUntil } from "../src/stations/onboard.ts";
import { buildStatus, expiring, stationStatus } from "../src/stations/subscription.ts";
import { checkpointOf, emptyCache, extendCache, loadRegistry, ratingsFor, readStationSwaps, stationFromEntry, type RegistryEntry } from "../src/station.ts";

/** A Credit's tag fields from the shipped rating table. */
const ratingOf = (id: string) => {
  const r = ratingsFor("credits")!.get(id)!;
  return { score: r.pct, mask: r.mask, rating: r.score };
};

const reg = loadRegistry();
const entry = reg.stations.find((s) => s.key === "credits")!;
// Real logs at 11 blocks (core test fixture): listings, bids, a sweep, CreditStrategy, Core, two composes.
const fx = JSON.parse(readFileSync(new URL("../../packages/core/test/fixtures/nft/credits.json", import.meta.url), "utf8"));
const hex = (n: bigint | number) => "0x" + BigInt(n).toString(16);
const toRpc = (logs: any[]) => logs.map((l: any) => ({ ...l, blockNumber: hex(BigInt(l.blockNumber)), logIndex: hex(l.logIndex), blockTimestamp: l.blockTimestamp ? hex(BigInt(l.blockTimestamp)) : undefined }));
const rpcLogs = toRpc(fx.logs);
// Two BALANCE withdraws (core test fixture): a holder's, and Core's with its StatementRedeemed.
const wx = JSON.parse(readFileSync(new URL("../../packages/core/test/fixtures/nft/credits-withdraw.json", import.meta.url), "utf8"));

/** A PublicClient that answers eth_getLogs from the fixture (address and topic filters, as an RPC would), counting calls. */
function fakeClient(calls: string[], logs: any[] = rpcLogs): PublicClient {
  return {
    request: async ({ params: [f] }: { method: string; params: [{ address: string | string[]; topics: (string | string[])[]; fromBlock: string; toBlock: string }] }) => {
      const addrs = [f.address].flat().map((a) => a.toLowerCase());
      const t0 = [f.topics[0]].flat();
      const t1 = f.topics[1] ? [f.topics[1]].flat() : null;
      calls.push(`${addrs.length > 1 ? "eco" : addrs[0].slice(0, 8)} ${Number(f.fromBlock)}-${Number(f.toBlock)}`);
      return logs.filter((l: any) => addrs.includes(l.address.toLowerCase()) && t0.includes(l.topics[0]) && (!t1 || t1.includes(l.topics[1])) && BigInt(l.blockNumber) >= BigInt(f.fromBlock) && BigInt(l.blockNumber) <= BigInt(f.toBlock));
    },
  } as unknown as PublicClient;
}

describe("the Credits registry entry", () => {
  it("passes the registry rules and becomes a collection source with the chain's WETH", () => {
    expect(registryProblems(reg)).toEqual([]);
    const st = stationFromEntry(entry, reg);
    const src = st.source as NftSource;
    expect(src).toEqual({ kind: "nft", collection: entry.token, ...entry.nft, weth: reg.chains["1"].weth });
    expect(src.itemSupply).toBe(77114);
    expect(JSON.parse(stationFingerprint(1, src, entry.genesisBlock))[1]).toBe("nft");
    expect(entry.status).toBe("pending");
    expect(entry.gift).toBe(true);
    expect(entry.paidUntil).toBeUndefined();
  });

  it("the rules refuse a broken nft entry", () => {
    const bad = (patch: Partial<RegistryEntry> & Record<string, unknown>) => registryProblems({ ...reg, stations: [{ ...entry, ...patch }] });
    expect(bad({ nft: undefined })).toEqual(["stations[0] (credits): nft must be an object"]);
    expect(bad({ pool: "0x0000000000000000000000000000000000000001" })).toEqual(["stations[0] (credits): an nft station has no pool"]);
    expect(bad({ quote: reg.chains["1"].weth })[0]).toMatch(/quote is native ETH/);
    expect(bad({ paidUntil: "2026-12-01" })).toEqual(["stations[0] (credits): a gift station has no paidUntil or plusUntil"]);
    expect(bad({ theme: { ...entry.theme!, panel: "white" } as any })).toEqual(["stations[0] (credits): theme.panel must be #rrggbb"]);
  });
});

describe("the Credits station in the bot cache", () => {
  const st = { ...stationFromEntry(entry, reg), genesisBlock: 26_241_000n };
  const blocks = [...new Set(fx.logs.map((l: any) => Number(l.blockNumber)))].sort((a: any, b: any) => a - b) as number[];
  const head = blocks.at(-1)!;

  async function readIn(cuts: number[]) {
    const c = emptyCache(st);
    let from = Number(st.genesisBlock);
    for (const to of [...cuts, head]) {
      const carry = { ...c.nft! };
      const swaps = await readStationSwaps(st, BigInt(from), BigInt(to), [fakeClient([])], carry);
      c.nft = carry;
      extendCache(c, swaps, to);
      from = to + 1;
    }
    return JSON.parse(JSON.stringify(c));
  }

  it("one read: every sale an entry with its item and venue, the composes whales", async () => {
    const calls: string[] = [];
    const swaps = await readStationSwaps(st, st.genesisBlock, BigInt(head), [fakeClient(calls)], { lastPrice: null, recent: [] });
    expect(swaps.length).toBe(19);
    expect(swaps.filter((s) => s.nft!.via === "compose").length).toBe(2);
    expect(swaps.every((s) => s.timestamp > 1_790_000_000 && s.poolId === undefined)).toBe(true);
    // Transfers and the ecosystem once over the range, then Seaport at the sale blocks only.
    expect(calls.filter((c) => c.startsWith("0x97630a")).length).toBe(1);
    expect(calls.filter((c) => c.startsWith("eco")).length).toBe(1);
    // BALANCE's releases (InkMoved from BALANCE): one more request over the range.
    expect(calls.filter((c) => c.startsWith("0x362054")).length).toBe(1);
    expect(calls.filter((c) => c.startsWith("0x000000")).length).toBeLessThanOrEqual(blocks.length);
    const c = emptyCache(st);
    extendCache(c, swaps, head);
    expect(c.entries.filter((e) => e.whale).map((e) => e.nft!.via)).toEqual(["compose", "compose"]);
    // The registry names the rating table: every Credit sale carries its percentile, plates and score.
    expect(c.entries[0].nft).toEqual({ id: "95250", via: "listing", venue: "OpenSea", price: "35000000000000000", ...ratingOf("95250") });
    expect(c.entries.filter((e) => e.nft!.via !== "compose").every((e) => e.nft!.score !== undefined && e.nft!.mask! > 0)).toBe(true);
    expect(c.entries[0].quote).toBe(0.035);
    // The tempo moves once per block: the second item of a block holds it.
    expect(swaps.filter((s) => s.holdTempo).length).toBe(8);
  });

  it("read in pieces with the carry = one read (a compose right after a cut is valued the same)", async () => {
    const whole = await readIn([]);
    for (const k of [1, 3, 6, 9]) expect(await readIn([blocks[k] - 1, blocks[k]])).toEqual(whole);
    expect(whole.nft.lastPrice).toBe("3144799385046438");
  });

  it("the checkpoint carries the decoder's carry and the items; the site refuses one without the carry", async () => {
    const c = await readIn([blocks[4]]);
    const cp = JSON.parse(JSON.stringify(checkpointOf(st, c)));
    const want = { key: "credits", fingerprint: stationFingerprint(1, st.source, st.genesisBlock), genesisBlock: Number(st.genesisBlock), nft: true };
    expect(checkpointProblem(cp, want)).toBeNull();
    expect(cp.nft.lastPrice).toBe("3144799385046438");
    expect(cp.nft.recent.length).toBe(17);
    expect(cp.recent.at(-1).nft).toEqual({ id: "46817", via: "core-buy", venue: "Core", price: "3144799385046438", ...ratingOf("46817") });
    expect(checkpointProblem({ ...cp, nft: undefined }, want)).toBe("nft carry missing");
  });
});

describe("BALANCE withdraws in the bot cache", () => {
  const st = { ...stationFromEntry(entry, reg), genesisBlock: 26_245_000n };
  it("two locks, two entries (Core's StatementRedeemed is not a second); the tags reach the checkpoint", async () => {
    const calls: string[] = [];
    const swaps = await readStationSwaps(st, st.genesisBlock, 26_270_498n, [fakeClient(calls, toRpc(wx.logs))], { lastPrice: null, recent: [] });
    expect(swaps.map((s) => [s.nft!.via, s.nft!.id, s.nft!.points, s.isBuy])).toEqual([["withdraw", "348", 50227, false], ["withdraw", "144", 29958, false]]);
    const c = emptyCache(st);
    extendCache(c, swaps, 26_270_498);
    expect(c.entries.some((e) => e.whale)).toBe(false);
    const cp = JSON.parse(JSON.stringify(checkpointOf(st, c)));
    expect(cp.recent.at(-1).nft).toEqual({ id: "144", via: "withdraw", venue: "BALANCE", points: 29958, holder: "0x035c0995a1e2b93fbf49310636959745573c1a62", ink: [24, 23, 24, 27], price: "0" });
  });

  it("the rating table loads from core's data (null for a station that names none)", () => {
    expect(ratingsFor("credits")!.get(1)).toEqual({ pct: 18, mask: 9, score: 1324 });
    expect(ratingsFor(undefined)).toBeNull();
    expect(ratingsFor("nope")).toBeNull();
  });
});

describe("the NFT screen's art (site tokenuri.ts): only a data:image/svg+xml image is taken from a tokenURI", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" shape-rendering="crispEdges"><rect width="320" height="320" fill="#ffffff"/><rect x="080" y="080" width="020" height="020" fill="#e4007c"/></svg>`;
  const uri = (json: unknown) => `data:application/json;base64,${b64(JSON.stringify(json))}`;

  it("Credits' shape: base64 JSON with a base64 SVG", () => {
    const img = `data:image/svg+xml;base64,${b64(svg)}`;
    expect(svgOfTokenUri(uri({ name: "Credit #1", image: img }))).toBe(img);
    expect(svgOfTokenUri(`data:application/json;utf8,${encodeURIComponent(JSON.stringify({ image: img }))}`)).toBe(img);
  });

  it("anything else is refused", () => {
    for (const image of ["https://example.com/a.svg", "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", `data:image/svg+xml;base64,${b64(svg)}"><script>`, 42, undefined])
      expect(svgOfTokenUri(uri({ image })), String(image)).toBeNull();
    expect(svgOfTokenUri("ipfs://Qm")).toBeNull();
    expect(svgOfTokenUri("data:application/json;base64,!!!")).toBeNull();
    expect(svgOfTokenUri(uri({ image: `data:image/svg+xml;base64,${"A".repeat(100_000)}` }))).toBeNull();
  });
});

describe("a gift station", () => {
  const T = Date.parse("2026-12-01T00:00:00Z");
  const live = { ...entry, status: "live" as const };

  it("never expires, is never Station+, never reminded, and going live adds no paidUntil", () => {
    expect(stationStatus(live, { paidUntil: "2026-11-01", plusUntil: "2026-12-30", renewals: [] }, T)).toEqual({ status: "live", paidUntil: "2026-11-01" });
    expect(stationStatus(live, undefined, T)).toEqual({ status: "live" });
    expect(expiring({ ...reg, stations: [live] }, buildStatus({ ...reg, stations: [live] }, { credits: { paidUntil: "2026-11-30", renewals: [] } }, T), T)).toEqual([]);
    expect(firstPaidUntil(entry, "live", T)).toBeNull();
    expect(firstPaidUntil({ ...entry, gift: undefined }, "live", T)).not.toBeNull();
  });
});
