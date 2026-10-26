// Credits ecosystem extras (docs/STATIONS.md "Statement sales, overprints, BALANCE swaps"): a page changing hands, a
// page overprinted onto another, and BALANCE's pool swaps as ornaments. Real data (fixtures/nft/credits-eco.json, built
// with readNftLogs / readNftPageLogs over the Tenderly gateway): Statement #211 sold to an OpenSea bid, the overprints
// that gave page #123 its first and its seventh overprint, seven swaps of the official BALANCE/ETH pool. On-chain
// values checked when the fixture was made: creditScoreOf(211) = 14,952.8973, creditScoreOf(123) = 264,387.7806,
// overprintsOf(123) = 7.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { encodeAbiParameters, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  checkpointProblem, decodeNftLogs, leadPlate, NFT_INK_LEAD, NFT_PAGE_FLOOR, NFT_PAGE_WINDOW, NFT_SIZE_REF, NFT_TOPICS, nftCarryFromJSON, nftCarryToJSON, nftConfigProblems,
  nftInkFilter, nftPoolFilter, nftPoolInkFilter, parseCreditTable, readNftLogs, readNftPageLogs, stationFingerprint, whaleWeiAtTick, type NftSource, type RawLog,
} from "../src/index.ts";

const table = parseCreditTable(gunzipSync(readFileSync(new URL("../data/credit-scores.bin.gz", import.meta.url))));
const j = JSON.parse(readFileSync(new URL("./fixtures/nft/credits-eco.json", import.meta.url), "utf8"));
const parse = (ls: any[]): RawLog[] => ls.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber), blockTimestamp: l.blockTimestamp ? BigInt(l.blockTimestamp) : null }));
const src: NftSource = j.source;
const sale = { logs: parse(j.sale.logs), pages: parse(j.sale.pages) };
const o1 = { logs: parse(j.overprint1.logs), pages: parse(j.overprint1.pages) };
const o7 = { logs: parse(j.overprint7.logs), pages: parse(j.overprint7.pages) };
const swaps = parse(j.swaps.logs);
const word = (v: bigint | string) => ("0x" + (typeof v === "bigint" ? v.toString(16) : v.slice(2).toLowerCase()).padStart(64, "0")) as Hex;
const BALANCE = src.balance!.toLowerCase();
const CORE = src.core!.toLowerCase();
const E = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;

describe("Statement sales: a page changing hands is one big note", () => {
  const r = decodeNftLogs(src, sale.logs, undefined, { ratings: table, pages: sale.pages });

  it("Statement #211 hit an OpenSea bid: one SELL at the bid, tagged as a page, its points from the 80 Credits' ratings", () => {
    expect(r.sales).toHaveLength(1);
    const [s] = r.sales;
    expect(s.isBuy).toBe(false);
    expect(s.nft).toMatchObject({ id: "211", via: "statement-bid", venue: "OpenSea", kind: "statement", price: E(0.502).toString(), overprints: 0 });
    // creditScoreOf(211) = 14,952.9; the table holds truncated tenths: at most ~8 points under for 80 Credits.
    expect(s.nft.points!).toBeLessThanOrEqual(14_952);
    expect(s.nft.points!).toBeGreaterThan(14_952 - 9);
    expect(s.nft.score).toBeUndefined();
  });

  it("sized against the Credits (price / 80 vs their median): at least a kick, never a whale; the Credits' window untouched", () => {
    const [s] = r.sales;
    expect(s.quoteAmt).toBeGreaterThanOrEqual(NFT_PAGE_FLOOR);
    expect(NFT_PAGE_FLOOR).toBe(3n * NFT_SIZE_REF);
    expect(s.quoteAmt < whaleWeiAtTick(s.tick)).toBe(true);
    // No Credit sale yet: the page is priced against 80 x refPrice (0.8 ETH): 0.502 -> 62%.
    expect(s.nft.rel).toBe(62);
    expect(r.carry.lastPrice).toBeNull();
    expect(r.carry.recent).toEqual([]);
    expect(r.carry.pages).toEqual([E(0.502)]);
    const big = decodeNftLogs(src, sale.logs, { lastPrice: E(0.004), recent: [E(0.004)] }).sales[0];
    // 0.502 / 80 = 0.00628, 1.57x a 0.004 median: (1.57)^8 x 0.0125 ETH, capped under half the whale line.
    expect(big.quoteAmt).toBe(whaleWeiAtTick(big.tick) / 2n);
  });

  it("the page window: rel against the recent pages' median, kept across batches", () => {
    const carry = { lastPrice: null, recent: [], pages: [E(1), E(1), E(0.25)] };
    const s = decodeNftLogs(src, sale.logs, carry).sales[0];
    expect(s.nft.rel).toBe(50);
    const many = { lastPrice: null, recent: [], pages: Array.from({ length: 40 }, () => E(1)) };
    expect(decodeNftLogs(src, sale.logs, many).carry.pages).toHaveLength(NFT_PAGE_WINDOW);
  });

  it("not sales: a page sent to BALANCE or to Core (a lock), a mint, a move with no price (no venue claims it)", () => {
    const transfer = sale.logs.find((l) => l.topics[0] === NFT_TOPICS.Transfer)!;
    const withTo = (to: string) => sale.logs.map((l) => (l === transfer ? { ...l, topics: [l.topics[0], l.topics[1], word(to), l.topics[3]] } : l));
    expect(decodeNftLogs(src, withTo(BALANCE)).sales).toEqual([]);
    expect(decodeNftLogs(src, withTo(CORE)).sales).toEqual([]);
    expect(decodeNftLogs(src, sale.logs.map((l) => (l === transfer ? { ...l, topics: [l.topics[0], word(0n), l.topics[2], l.topics[3]] } : l))).sales).toEqual([]);
    expect(decodeNftLogs(src, [transfer]).sales).toEqual([]);
    // Without the Statements in the source, the page is not an item at all.
    expect(decodeNftLogs({ ...src, statements: undefined }, sale.logs).sales).toEqual([]);
  });

  it("Core's StatementSoldTo: Core selling a page it holds is a BUY at its price", () => {
    const buyer = "0x00000000000000000000000000000000000000b0";
    const tx = "0x" + "ab".repeat(32);
    const at = (i: number, l: Omit<RawLog, "blockNumber" | "logIndex" | "transactionHash">): RawLog => ({ ...l, blockNumber: 26_260_000n, logIndex: i, transactionHash: tx as Hex });
    const logs = [
      at(1, { address: src.statements, topics: [NFT_TOPICS.Transfer, word(CORE), word(buyer), word(77n)], data: "0x" }),
      at(2, { address: src.core, topics: [NFT_TOPICS.StatementSoldTo, word(77n), word(buyer)], data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [E(0.9), 0n, 0n, 0n]) }),
    ];
    const [s, ...rest] = decodeNftLogs(src, logs).sales;
    expect(rest).toEqual([]);
    expect(s.isBuy).toBe(true);
    expect(s.nft).toMatchObject({ id: "77", via: "core-statement", venue: "Core", kind: "statement", price: E(0.9).toString() });
  });

  it("tags only: with or without the page history and the table, the same rules input", () => {
    const bare = decodeNftLogs(src, sale.logs);
    const pick = (x: typeof bare) => x.sales.map((s) => [s.isBuy, s.quoteAmt, s.tick, s.holdTempo ?? false]);
    expect(pick(bare)).toEqual(pick(r));
    expect(bare.carry).toEqual(r.carry);
    expect(bare.sales[0].nft.points).toBeUndefined();
    expect(bare.sales[0].nft.overprints).toBeUndefined();
    // History without a table: the count, no points.
    expect(decodeNftLogs(src, sale.logs, undefined, { pages: sale.pages }).sales[0].nft).toMatchObject({ overprints: 0 });
    expect(decodeNftLogs(src, sale.logs, undefined, { pages: sale.pages }).sales[0].nft.points).toBeUndefined();
  });
});

describe("overprints: a rare double strike, counted from the pages' own history", () => {
  it("#48 onto #123: one BUY of the usual size, the base's count after it 4 (1 + #48's own 3: #56 onto #48, #126 and #97 onto #56)", () => {
    const r = decodeNftLogs(src, o1.logs, undefined, { ratings: table, pages: o1.pages });
    expect(r.sales).toHaveLength(1);
    const [s] = r.sales;
    expect(s.isBuy).toBe(true);
    expect(s.quoteAmt).toBe(NFT_SIZE_REF);
    expect(s.nft).toMatchObject({ id: "123", via: "overprint", venue: "Statements", top: "48", overprints: 4, price: "0" });
    // The top page's burn (a Transfer to zero) is not a sale.
    expect(r.carry).toEqual({ lastPrice: null, recent: [] });
  });

  it("#117 onto #123: its seventh overprint (black paper), points = the contract's creditScoreOf(123) within the table's rounding", () => {
    const [s] = decodeNftLogs(src, o7.logs, undefined, { ratings: table, pages: o7.pages }).sales;
    expect(s.nft).toMatchObject({ id: "123", top: "117", overprints: 7 });
    // 8 pages x 80 Credits, truncated tenths: at most 64 points under 264,387.8.
    expect(s.nft.points!).toBeLessThanOrEqual(264_387);
    expect(s.nft.points!).toBeGreaterThan(264_387 - 65);
  });

  it("readNftPageLogs asks for the sold and overprinted pages, then the pages burned onto them, until none is new", async () => {
    const chain = [...o7.pages, ...o1.pages];
    const asked: string[][] = [];
    const got = await readNftPageLogs(src, o7.logs, 26_115_833n, async (f, from, to) => {
      expect(from).toBe(BigInt(src.statementsFrom!));
      expect(f.topics[0]).toEqual([NFT_TOPICS.Composed, NFT_TOPICS.Overprinted]);
      const ids = (f.topics[1] as string[]).map((t) => BigInt(t).toString());
      asked.push(ids);
      return chain.filter((l) => ids.includes(BigInt(l.topics[1]!).toString()) && l.blockNumber <= to);
    });
    expect(asked[0]).toEqual(["117", "123"]);
    expect(asked.flat()).toEqual(expect.arrayContaining(["48", "56", "97", "124", "125", "126"]));
    const [s] = decodeNftLogs(src, o7.logs, undefined, { ratings: table, pages: got }).sales;
    expect(s.nft.overprints).toBe(7);
    // Nothing to look up (a batch of Credit sales only, or no statementsFrom): no request.
    let calls = 0;
    expect(await readNftPageLogs(src, [], 1n, async () => (calls++, []))).toEqual([]);
    expect(await readNftPageLogs({ ...src, statementsFrom: undefined }, o7.logs, 1n, async () => (calls++, []))).toEqual([]);
    expect(calls).toBe(0);
  });

  it("the same with the history split anywhere: counts look only at what happened before the event", () => {
    const later = [...o7.pages, ...o1.pages];
    const [a] = decodeNftLogs(src, o1.logs, undefined, { pages: later }).sales;
    expect(a.nft.overprints).toBe(4);
  });
});

describe("BALANCE swaps: ornaments, never rules inputs", () => {
  const r = decodeNftLogs(src, swaps);

  it("seven swaps of the official pool, in chain order, with the ink of their own transaction", () => {
    expect(r.sales).toEqual([]);
    expect(r.ornaments).toHaveLength(7);
    const keys = r.ornaments.map((o) => [o.blockNumber, o.logIndex]);
    expect(keys).toEqual([...keys].sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : (a[1] as number) - (b[1] as number))));
    expect(r.ornaments.filter((o) => o.isBuy).length).toBe(4);
    expect(r.ornaments.filter((o) => !o.isBuy).length).toBe(3);
    for (const o of r.ornaments) {
      expect(o.kind).toBe("balance-swap");
      expect(BigInt(o.amount) > 0n && BigInt(o.eth) > 0n).toBe(true);
      expect(o.ink!.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(96);
      expect(o.plate).toBe(leadPlate(o.ink!));
    }
  });

  it("another pool on the same PoolManager (a clone) plays nothing; no balancePool, no ornaments", () => {
    const clone = swaps.map((l) => (l.topics[0] === NFT_TOPICS.Swap ? { ...l, topics: [l.topics[0], word(1n), ...l.topics.slice(2)] } : l));
    expect(decodeNftLogs(src, clone).ornaments).toEqual([]);
    expect(decodeNftLogs({ ...src, balancePool: undefined }, swaps).ornaments).toEqual([]);
  });

  it("they change nothing else: Credit and page sales, their carry and tags are the same with or without them", () => {
    const base = [...sale.logs, ...o1.logs];
    const a = decodeNftLogs(src, base, undefined, { pages: [...sale.pages, ...o1.pages] });
    const b = decodeNftLogs(src, [...swaps, ...base], undefined, { pages: [...sale.pages, ...o1.pages] });
    expect(b.sales).toEqual(a.sales);
    expect(b.carry).toEqual(a.carry);
    expect(b.ornaments).toHaveLength(7);
  });

  it("the plate: only an ink that leads by NFT_INK_LEAD points has one (BALANCE's ink is mostly an even mix)", () => {
    expect(NFT_INK_LEAD).toBe(2);
    expect(leadPlate([24, 24, 25, 26])).toBeUndefined();
    expect(leadPlate([30, 24, 22, 24])).toBe(0);
    expect(leadPlate([20, 20, 40, 20])).toBe(2);
    expect(leadPlate([0, 0, 0, 100])).toBe(3);
  });

  it("filters: the pool's Swaps by poolId, the ink out of the PoolManager with the releases, the ink into it apart", () => {
    const pm = src.balancePool!.poolManager;
    expect(nftPoolFilter(src)).toEqual({ address: pm, topics: [NFT_TOPICS.Swap, src.balancePool!.poolId.toLowerCase()] });
    expect(nftPoolInkFilter(src)).toEqual({ address: src.balance, topics: [NFT_TOPICS.InkMoved, null, word(pm)] });
    expect(nftInkFilter(src)!.topics[1]).toEqual([word(BALANCE), word(pm)]);
    expect(nftInkFilter(src, false)!.topics[1]).toBe(word(BALANCE));
    expect(nftPoolFilter({ ...src, balancePool: undefined })).toBeNull();
  });

  it("readNftLogs: two more requests with the ornaments, none without (the bot's path)", async () => {
    const count = async (ornaments: boolean) => {
      let n = 0;
      await readNftLogs(src, 1n, 2n, async () => (n++, []), { ornaments });
      return n;
    };
    expect(await count(true)).toBe((await count(false)) + 2);
  });
});

describe("carry, checkpoint, registry", () => {
  it("the page window round-trips; old JSON (no pages) reads as before and writes as before", () => {
    const c = { lastPrice: E(0.004), recent: [E(0.004)], pages: [E(0.5), E(0.7)] };
    const json = nftCarryToJSON(c);
    expect(json.pages).toEqual([E(0.5).toString(), E(0.7).toString()]);
    expect(nftCarryFromJSON(JSON.parse(JSON.stringify(json)))).toEqual(c);
    const old = { lastPrice: "4000000000000000", recent: ["4000000000000000"] };
    expect(nftCarryFromJSON(old)).toEqual({ lastPrice: E(0.004), recent: [E(0.004)] });
    expect(nftCarryToJSON(nftCarryFromJSON(old))).toEqual(old);
    expect(nftCarryFromJSON({ ...old, pages: ["x", "5"] }).pages).toEqual([5n]);
  });

  it("checkpoints accept the page window and refuse a malformed one", () => {
    const fp = stationFingerprint(1, src, 26255150);
    const cp = { version: 1, key: "credits", fingerprint: fp, block: 26_260_000, slot0: "0x1", slot1: "0x0", swapCount: 0, trackNo: 0, trackStartSwap: 0, generatedAt: "", recent: [] };
    const want = { key: "credits", fingerprint: fp, genesisBlock: 26255150, nft: true };
    const nft = { lastPrice: null, recent: [] };
    // (slots "0x1"/"0x0" may decode to another count; only the nft carry's verdicts are compared here)
    const verdict = (n: unknown) => checkpointProblem({ ...cp, nft: n }, want);
    expect(verdict({ ...nft, pages: ["1"] })).toBe(verdict(nft));
    expect(verdict({ ...nft, pages: ["x"] })).toBe("nft carry pages malformed");
  });

  it("registry: statementsFrom and balancePool are checked; neither changes the stream's fingerprint", () => {
    const n = { itemSupply: 77114, refPrice: "0.01", seaport: src.seaport, strategy: src.strategy, core: src.core, statements: src.statements, balance: src.balance, ratings: "credits", statementsFrom: 26100993, balancePool: src.balancePool };
    expect(nftConfigProblems(n)).toEqual([]);
    expect(nftConfigProblems({ ...n, statementsFrom: 0 })).toEqual(["nft.statementsFrom must be a positive block number"]);
    expect(nftConfigProblems({ ...n, statements: undefined })).toContain("nft.statementsFrom needs statements");
    expect(nftConfigProblems({ ...n, balancePool: { poolManager: src.balancePool!.poolManager, poolId: "0x12" } })).toEqual(["nft.balancePool.poolId must be a bytes32 hex"]);
    expect(nftConfigProblems({ ...n, balancePool: { ...src.balancePool, fee: 3000 } })).toEqual(["nft.balancePool.fee: unknown field"]);
    expect(nftConfigProblems({ ...n, balance: undefined })).toContain("nft.balancePool needs balance");
    const fp = stationFingerprint(1, src, 1);
    expect(stationFingerprint(1, { ...src, balancePool: undefined, statementsFrom: undefined }, 1)).toBe(fp);
    expect(JSON.parse(fp).at(-1)).toBe("pages");
  });
});
