// NFT sources (nft.ts) on real Credits transactions. The fixture is what the station reads at 11 blocks of Ethereum
// (readNftLogs over the Tenderly gateway: the collection's Transfers, the ecosystem's events, every Seaport fill of
// those blocks, other collections' included); the spot checks are the amounts the explorer shows for those txs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeNftLogs, fdvWeiAtTick, initialDropState, initialRelativeState, mutate, nftCarryFromJSON, nftCarryToJSON, nftConfigProblems, NFT_SIZE_REF, nftEcoFilter, nftSaleRanges, nftSeaportFilter,
  nftTick, nftTransferFilter, NFT_TOPICS, readNftLogs, stationFingerprint, V2_RULES, whaleWeiAtTick, type DecodedSale, type NftSource, type RawLog, type State,
} from "../src/index.ts";

const j = JSON.parse(readFileSync(new URL("./fixtures/nft/credits.json", import.meta.url), "utf8"));
const src: NftSource = j.source;
const logs: RawLog[] = j.logs.map((l: any) => ({ ...l, blockNumber: BigInt(l.blockNumber), blockTimestamp: l.blockTimestamp ? BigInt(l.blockTimestamp) : null }));
const E = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const eth = (w: bigint) => Number(w) / 1e18;
const of = (sales: DecodedSale[], tx: string) => sales.filter((s) => s.txHash.startsWith(tx));

describe("decodeNftLogs on real Credits sales", () => {
  const { sales, carry } = decodeNftLogs(src, logs);
  const price = (s: DecodedSale) => BigInt(s.nft.price);

  it("a listing filled on OpenSea: one BUY at what the buyer paid (seller + fee)", () => {
    const [s, ...rest] = of(sales, "0xbb569c6d8a");
    expect(rest).toEqual([]);
    expect(s.nft).toEqual({ id: "55550", via: "listing", venue: "OpenSea", price: E(0.01065).toString() });
    expect(s.isBuy).toBe(true);
    expect(s.price).toBe(E(0.01065));
    expect(s.timestamp).toBeGreaterThan(1_790_000_000);
  });

  it("a sweep of three listings: three BUYs in the Transfers' order, the tempo moved by the first only", () => {
    const sw = of(sales, "0xd84526c3f9");
    expect(sw.map((s) => s.nft.id)).toEqual(["54367", "45927", "47594"]);
    expect(sw.every((s) => s.isBuy && s.nft.via === "listing")).toBe(true);
    expect(sw.map((s) => s.logIndex)).toEqual([214, 215, 216]);
    expect(eth(sw.reduce((a, s) => a + price(s), 0n))).toBeCloseTo(0.032987, 5);
    expect(sw.map((s) => s.holdTempo ?? false)).toEqual([false, true, true]);
  });

  it("two bids accepted: two SELLs at the bidder's WETH", () => {
    const b = of(sales, "0xf2c6f9edea");
    expect(b.map((s) => [s.nft.id, s.isBuy, s.nft.via, s.nft.venue])).toEqual([["20890", false, "bid", "OpenSea"], ["37910", false, "bid", "OpenSea"]]);
    expect(b.every((s) => s.price === E(0.0101))).toBe(true);
  });

  it("a router buys a floor listing and sells it to CreditStrategy in one tx: ONE note, the OpenSea BUY at the listing", () => {
    const t = of(sales, "0xe655209293");
    expect(t.map((s) => [s.nft.via, s.isBuy, s.nft.id])).toEqual([["listing", true, "110626"]]);
    expect(t[0].price).toBe(E(0.0108));
  });

  it("a Credit leaving CreditStrategy and coming back (or going on to Core) in one tx: one note, the first hop", () => {
    expect(of(sales, "0x7e6e18b8e2").map((s) => [s.nft.via, s.isBuy])).toEqual([["strategy-buy", true]]);
    expect(eth(of(sales, "0x7e6e18b8e2")[0].price)).toBeCloseTo(0.0123204, 6);
    expect(of(sales, "0x9816eb21b3").map((s) => [s.nft.via, s.isBuy, eth(s.price)])).toEqual([["strategy-buy", true, 0.03]]);
  });

  it("Core: CreditBought is a SELL, CreditSold a BUY, ListingBought one BUY (its Seaport fill is the same sale)", () => {
    expect(of(sales, "0x818c686426").map((s) => [s.nft.via, s.isBuy, s.nft.id])).toEqual([["core-sell", false, "118263"]]);
    expect(eth(of(sales, "0x818c686426")[0].price)).toBeCloseTo(0.0143833, 6);
    expect(of(sales, "0xbdb9441e4c").map((s) => [s.nft.via, s.isBuy, s.nft.id])).toEqual([["core-buy", true, "109607"], ["core-buy", true, "46817"]]);
    const lb = of(sales, "0x69d9f5599d");
    expect(lb.map((s) => [s.nft.via, s.isBuy, s.nft.venue])).toEqual([["core-listing", true, "Core"]]);
    expect(eth(lb[0].price)).toBeCloseTo(0.0166, 5);
  });

  it("a compose (80 Credits burned into a page) is one BUY of 80 x the last price, a whale; Core's own Composed is not a second", () => {
    for (const tx of ["0xe4c11e95e9", "0x503a271dee"]) {
      const c = of(sales, tx);
      expect(c.length, tx).toBe(1);
      expect(c[0].nft.via).toBe("compose");
      expect(c[0].nft.items).toBe(80);
      expect(c[0].isBuy).toBe(true);
      const prev = sales[sales.indexOf(c[0]) - 1];
      expect(c[0].price).toBe(prev.price);
      expect(c[0].quoteAmt).toBe(prev.price * 80n);
      expect(c[0].nft.price).toBe((prev.price * 80n).toString());
      expect(c[0].quoteAmt >= whaleWeiAtTick(c[0].tick)).toBe(true);
    }
    expect(of(sales, "0xe4c11e95e9")[0].nft.id).toBe("563");
  });

  it("other collections' Seaport fills in the same blocks are ignored; burns are no sales", () => {
    const fills = logs.filter((l) => l.topics[0] === NFT_TOPICS.OrderFulfilled);
    const credits = fills.filter((l) => l.data.toLowerCase().includes(src.collection.slice(2).toLowerCase()));
    expect(fills.length - credits.length).toBeGreaterThan(5);
    expect(sales.filter((s) => s.nft.via !== "compose").length).toBe(17);
    expect(sales.length).toBe(19);
  });

  it("tick from the median of the recent prices; size from the price against the median before it; never a whale", () => {
    const window: bigint[] = [];
    const med = (xs: bigint[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[(xs.length - 1) >> 1];
    for (const s of sales) {
      if (s.nft.via === "compose") continue;
      const usual = window.length ? med(window) : 10n ** 16n;
      window.push(s.price);
      expect(s.tick).toBe(nftTick(src, med(window)));
      expect(eth(fdvWeiAtTick(s.tick)) / (eth(med(window)) * src.itemSupply)).toBeCloseTo(1, 3);
      const want = (NFT_SIZE_REF * s.price ** 8n) / usual ** 8n;
      expect(s.quoteAmt).toBe(want < whaleWeiAtTick(s.tick) / 2n ? want : whaleWeiAtTick(s.tick) / 2n);
      expect(s.quoteAmt < whaleWeiAtTick(s.tick)).toBe(true);
      expect(s.holdSizeEma).toBe(true);
    }
    expect(carry.lastPrice).toBe(sales.filter((s) => s.nft.via !== "compose").at(-1)!.price);
    expect(carry.recent).toEqual(window);
  });

  it("any log order, and any split at a block boundary with the carry (also through its JSON), decode the same", () => {
    const rev = decodeNftLogs(src, [...logs].reverse());
    expect(rev.sales).toEqual(sales);
    const blocks = [...new Set(logs.map((l) => l.blockNumber))].sort((a, b) => (a < b ? -1 : 1));
    for (const cut of blocks.slice(1)) {
      const a = decodeNftLogs(src, logs.filter((l) => l.blockNumber < cut));
      const b = decodeNftLogs(src, logs.filter((l) => l.blockNumber >= cut), nftCarryFromJSON(JSON.parse(JSON.stringify(nftCarryToJSON(a.carry)))));
      expect([...a.sales, ...b.sales]).toEqual(sales);
    }
  });

  it("before any sale a compose is valued at refPrice", () => {
    const compose = logs.filter((l) => l.transactionHash.startsWith("0xe4c11e95e9"));
    const { sales: c } = decodeNftLogs(src, compose);
    expect(c.length).toBe(1);
    expect(c[0].price).toBe(10n ** 16n);
    expect(c[0].quoteAmt >= 80n * 10n ** 16n).toBe(true);
  });

  it("through the v2 rules only the composes drop; held items leave the tempo and the size EMA alone", () => {
    let st: State = initialDropState(initialRelativeState());
    const whales: string[] = [];
    for (const s of sales) {
      const r = mutate(st, { isBuy: s.isBuy, quoteAmt: s.quoteAmt, tick: s.tick, blockNumber: s.blockNumber, timestamp: s.timestamp!, holdTempo: s.holdTempo, holdSizeEma: s.holdSizeEma }, undefined, V2_RULES);
      if (r.event.whale) whales.push(s.nft.via);
      if (s.holdTempo) expect([r.state.intervalEma, r.state.bpm]).toEqual([st.intervalEma, st.bpm]);
      expect(r.state.sizeLogEma).toBe(st.sizeLogEma);
      st = r.state;
    }
    expect(whales).toEqual(["compose", "compose"]);
  });

  it("the flags change nothing when absent: the same input with holdTempo / holdSizeEma false or undefined is the hook's rules", () => {
    const s0 = initialDropState(initialRelativeState());
    const a = mutate(s0, { isBuy: true, quoteAmt: 10n ** 16n, tick: 100, blockNumber: 1n, timestamp: 1000 }, undefined, V2_RULES);
    const b = mutate(a.state, { isBuy: false, quoteAmt: 10n ** 15n, tick: 120, blockNumber: 1n, timestamp: 1000 }, undefined, V2_RULES);
    const b2 = mutate(a.state, { isBuy: false, quoteAmt: 10n ** 15n, tick: 120, blockNumber: 1n, timestamp: 1000, holdTempo: false, holdSizeEma: false }, undefined, V2_RULES);
    expect(b2).toEqual(b);
    const held = mutate(a.state, { isBuy: false, quoteAmt: 10n ** 15n, tick: 120, blockNumber: 1n, timestamp: 1000, holdTempo: true, holdSizeEma: true }, undefined, V2_RULES);
    expect([held.state.intervalEma, held.state.bpm, held.state.sizeLogEma]).toEqual([a.state.intervalEma, a.state.bpm, a.state.sizeLogEma]);
    expect(b.state.intervalEma).not.toBe(a.state.intervalEma);
  });
});

describe("NFT source plumbing", () => {
  it("filters: Transfers by collection, the ecosystem by its events, Seaport by OrderFulfilled", () => {
    expect(nftTransferFilter(src)).toEqual({ address: src.collection, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] });
    expect(nftEcoFilter(src)!.address).toEqual([src.strategy, src.core, src.statements]);
    expect(nftEcoFilter(src)!.topics[0]).toHaveLength(6);
    expect(nftEcoFilter({ ...src, strategy: undefined, core: undefined, statements: undefined })).toBeNull();
    expect(nftSeaportFilter(src)).toEqual({ address: src.seaport![0], topics: ["0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31"] });
  });

  it("sale ranges: blocks with a non-mint, non-burn Transfer, neighbours merged", () => {
    const t = (b: number, from = "0x01", to = "0x02"): RawLog => ({
      topics: [NFT_TOPICS.Transfer, `0x${from.slice(2).padStart(64, "0")}`, `0x${to.slice(2).padStart(64, "0")}`, `0x${"1".padStart(64, "0")}`],
      data: "0x", blockNumber: BigInt(b), logIndex: 0, transactionHash: "0x00",
    });
    expect(nftSaleRanges([t(100), t(104), t(130), t(131, "0x00"), t(140, "0x01", "0x00"), t(200)], 8, 64)).toEqual([[100n, 104n], [130n, 130n], [200n, 200n]]);
    expect(nftSaleRanges([t(1), t(5), t(9)], 8, 6)).toEqual([[1n, 5n], [9n, 9n]]);
  });

  it("readNftLogs: Transfers and the ecosystem over the range, Seaport only at the sale blocks", async () => {
    const asked: string[] = [];
    const got = await readNftLogs(src, 26247700n, 26247900n, async (f, from, to) => {
      asked.push(`${Array.isArray(f.address) ? "eco" : f.address === src.collection ? "transfers" : "seaport"} ${from}-${to}`);
      return logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to && (f.topics[0] as string[]).concat(f.topics[0] as string).includes(l.topics[0]!) && [f.address].flat().map((a) => a.toLowerCase()).includes(l.address!.toLowerCase()));
    });
    expect(asked.slice(0, 2).sort()).toEqual(["eco 26247700-26247900", "transfers 26247700-26247900"]);
    expect(asked.slice(2).sort()).toEqual(["seaport 26247721-26247721", "seaport 26247763-26247763", "seaport 26247844-26247844"]);
    expect(decodeNftLogs(src, got).sales.length).toBe(7);
  });

  it("fingerprint: its own shape, any venue or the supply frame changes it, pools unchanged", () => {
    const fp = stationFingerprint(1, src, 26255000);
    expect(JSON.parse(fp).slice(0, 2)).toEqual([1, "nft"]);
    expect(stationFingerprint(1, { ...src, collection: src.collection.toUpperCase().replace("0X", "0x") as `0x${string}` }, 26255000)).toBe(fp);
    expect(stationFingerprint(1, { ...src, core: undefined }, 26255000)).not.toBe(fp);
    expect(stationFingerprint(1, { ...src, itemSupply: 77115 }, 26255000)).not.toBe(fp);
    expect(stationFingerprint(1, { ...src, refPrice: "0.02" }, 26255000)).not.toBe(fp);
    expect(stationFingerprint(1, { kind: "v3", address: "0x1", ethSide: 1 }, 5)).toBe('[1,"v3","0x1",null,1,null,5]');
  });

  it("nftTick is the floor tick of 1e27 / (price x supply)", () => {
    expect(nftTick(src, 10n ** 16n)).toBe(nftTick(src, 10n ** 16n + 1n));
    expect(eth(fdvWeiAtTick(nftTick(src, 10n ** 16n)))).toBeCloseTo(771.14, 0);
  });

  it("nftConfigProblems", () => {
    const ok = { itemSupply: 77114, refPrice: "0.01", seaport: [src.seaport![0]], strategy: src.strategy, core: src.core, statements: src.statements };
    expect(nftConfigProblems(ok)).toEqual([]);
    expect(nftConfigProblems({ ...ok, itemSupply: 0 })).toHaveLength(1);
    expect(nftConfigProblems({ ...ok, refPrice: "0" })).toHaveLength(1);
    expect(nftConfigProblems({ ...ok, extra: 1 })).toEqual(["nft.extra: unknown field"]);
    expect(nftConfigProblems({ itemSupply: 1, refPrice: "1", statements: src.statements })).toEqual(["nft needs a venue: seaport, strategy or core"]);
    expect(nftConfigProblems(null)).toEqual(["nft must be an object"]);
  });
});
