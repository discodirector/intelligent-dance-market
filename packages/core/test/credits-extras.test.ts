// Credits extras (docs/STATIONS.md "Credit rating and plates", "BALANCE withdraws"): the offline rating table and its
// tags on sales, and BALANCE withdraws as inputs. Real data: the shipped table (data/credit-scores.bin.gz, built by
// scripts/build-credit-scores.ts and checked there against eth_call CreditScore.scoreOf), the sales fixture of
// nft.test.ts, and every Credits-ecosystem log of two withdraw transactions (a holder's and Core's).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CREDIT_TOP_PCT, decodeNftLogs, encodeCreditTable, nftCarryFromJSON, nftCarryToJSON, nftConfigProblems, nftEcoFilter, nftInkFilter, NFT_SIZE_REF, NFT_TOPICS,
  parseCreditTable, plateCount, plateLetters, readNftLogs, stationFingerprint, type NftSource, type RawLog,
} from "../src/index.ts";
import { scoreOf } from "../scripts/credit-score.ts";

const table = parseCreditTable(gunzipSync(readFileSync(new URL("../data/credit-scores.bin.gz", import.meta.url))));
const load = (name: string) => {
  const j = JSON.parse(readFileSync(new URL(`./fixtures/nft/${name}`, import.meta.url), "utf8"));
  return { j, logs: j.logs.map((l: any) => ({ ...l, blockNumber: BigInt(l.blockNumber), blockTimestamp: l.blockTimestamp ? BigInt(l.blockTimestamp) : null })) as RawLog[] };
};
const sales = load("credits.json");
const BALANCE = "0x3620540c994433D7B4a628C46d2ED5F92572eA07" as const;
const src: NftSource = { ...sales.j.source, balance: BALANCE, ratings: "credits" };
const bytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

describe("the Credit rating table", () => {
  it("covers the whole edition: Credits #1..#122154", () => {
    expect(table.firstId).toBe(1);
    expect(table.count).toBe(122_154);
    for (const id of [0, 122_155, -1, "x", "1.5"]) expect(table.get(id as never), String(id)).toBeNull();
  });

  it("Credit #1: 132.4 (scoreOf 1,324,012), plates C+K (paidAt % 15 + 1 = 9), rank ~113,257 of 122,154 -> pct 18", () => {
    expect(table.get(1)).toEqual({ pct: 18, mask: 9, score: 1324 });
    expect(table.get(1n)).toEqual(table.get("1"));
    expect(plateLetters(9)).toBe("CK");
    expect(plateCount(9)).toBe(2);
    expect(plateLetters(15)).toBe("CMYK");
  });

  it("matches eth_call CreditScore.scoreOf on Credits the build checked (tenths, truncated)", () => {
    const onchain: [number, number][] = [[122154, 6775911], [98017, 899155], [18506, 7935948], [86551, 6956000], [94819, 3159303], [35969, 980000], [4136, 838319]];
    for (const [id, score] of onchain) expect(table.get(id)!.score, `#${id}`).toBe(Math.floor(score / 1000));
  });

  it("the port of CreditScore: seed + payment second -> the contract's score and plates", () => {
    expect(scoreOf(bytes("0x4365374641725439364c6f50634e70797a325a416d"), 1786920623n)).toEqual({ score: 1_324_012, mask: 9 });
    expect(scoreOf(bytes("0x4366485152784862704e69414d78316d436e4c7272"), 1790031140n).score).toBe(899_155);
    expect(scoreOf(bytes("0x43664764476e6a38735a5052573832653773337a53"), 1789995607n).score).toBe(7_935_948);
    expect(scoreOf(bytes("0x436648566b66536772707a6b6d34646754766e4c58"), 1790035323n).score).toBe(6_775_911);
  });

  it("the percentile is the rank: never lower for a higher score, the top 5% at pct >= 243", () => {
    const rows = Array.from({ length: table.count }, (_, i) => table.get(i + 1)!);
    const byScore = [...rows].sort((a, b) => a.score - b.score);
    for (let i = 1; i < byScore.length; i++) expect(byScore[i].pct >= byScore[i - 1].pct).toBe(true);
    const top = rows.filter((r) => r.pct >= CREDIT_TOP_PCT).length / rows.length;
    expect(top).toBeGreaterThan(0.045);
    expect(top).toBeLessThan(0.055);
    expect(new Set(rows.map((r) => r.mask))).toEqual(new Set(Array.from({ length: 15 }, (_, i) => i + 1)));
  });

  it("encode -> parse round trip; anything else is refused", () => {
    const t = parseCreditTable(encodeCreditTable(7, [{ mask: 1, score: 800 }, { mask: 0, score: 0 }, { mask: 15, score: 8000 }]));
    expect(t.get(7)).toEqual({ pct: 0, mask: 1, score: 800 });
    expect(t.get(8)).toBeNull();
    expect(t.get(9)).toEqual({ pct: 128, mask: 15, score: 8000 });
    expect(() => parseCreditTable(new Uint8Array(16))).toThrow(/magic/);
  });
});

describe("rated sales: the tags, never the rules input", () => {
  const plain = decodeNftLogs(sales.j.source, sales.logs);
  const rated = decodeNftLogs(src, sales.logs, undefined, { ratings: table });

  it("every sale of a Credit carries its percentile, plates and score; a compose (a page) none", () => {
    for (const s of rated.sales) {
      if (s.nft.via === "compose") {
        expect(s.nft.score).toBeUndefined();
        continue;
      }
      const r = table.get(s.nft.id)!;
      expect(s.nft).toMatchObject({ score: r.pct, mask: r.mask, rating: r.score });
    }
    expect(rated.sales.filter((s) => s.nft.score !== undefined).length).toBe(17);
  });

  it("without the table the sales are exactly as before; with it the inputs are the same", () => {
    const strip = (s: (typeof rated.sales)[number]) => {
      const { score, mask, rating, ...nft } = s.nft;
      return { ...s, nft };
    };
    expect(rated.sales.map(strip)).toEqual(plain.sales);
    expect(plain.sales.every((s) => s.nft.score === undefined && s.nft.mask === undefined)).toBe(true);
    expect(rated.carry).toEqual(plain.carry);
  });
});

describe("BALANCE withdraws", () => {
  const w = load("credits-withdraw.json");
  const { sales: out } = decodeNftLogs(src, w.logs);

  it("a holder locks Statement #144: one SELL of the usual size, 29,958 points, the release's ink", () => {
    const s = out.find((x) => x.txHash.startsWith("0x37c1390a"))!;
    expect(s.nft).toEqual({ id: "144", via: "withdraw", venue: "BALANCE", points: 29958, holder: "0x035c0995a1e2b93fbf49310636959745573c1a62", ink: [24, 23, 24, 27], price: "0" });
    expect(s.isBuy).toBe(false);
    expect(s.quoteAmt).toBe(NFT_SIZE_REF);
    expect(s.logIndex).toBe(24);
  });

  it("Core locking a page (its StatementRedeemed beside BALANCE's Withdrawn) is ONE input", () => {
    const core = out.filter((x) => x.txHash.startsWith("0x5ced9876"));
    expect(core.map((x) => [x.nft.via, x.nft.id, x.nft.points])).toEqual([["withdraw", "348", 50227]]);
    expect(core[0].nft.ink).toEqual([24, 24, 29, 21]);
    expect(w.logs.some((l) => l.topics[0] === "0x8376a47aff0747a7a85ec2d85652ead30c582561a05fa4abb4d52504fe2e806f")).toBe(true);
    expect(out.length).toBe(2);
  });

  it("deterministic: any log order, any batch split", () => {
    const shuffled = [...w.logs].reverse();
    expect(decodeNftLogs(src, shuffled).sales).toEqual(out);
    const cut = 26_250_000n;
    const a = decodeNftLogs(src, w.logs.filter((l) => l.blockNumber < cut));
    const b = decodeNftLogs(src, w.logs.filter((l) => l.blockNumber >= cut), a.carry);
    expect([...a.sales, ...b.sales]).toEqual(out);
  });

  it("without the ink log the withdraw still plays (no ink); a source without balance ignores it", () => {
    const noInk = decodeNftLogs(src, w.logs.filter((l) => l.topics[0] !== NFT_TOPICS.InkMoved)).sales;
    expect(noInk.map((x) => x.nft.ink)).toEqual([undefined, undefined]);
    expect(noInk.map((x) => x.nft.points)).toEqual([50227, 29958]);
    expect(decodeNftLogs(sales.j.source, w.logs).sales).toEqual([]);
  });

  it("read: Withdrawn with the ecosystem events, InkMoved only from BALANCE (one more request)", async () => {
    expect(nftEcoFilter(src)!.topics[0]).toContain(NFT_TOPICS.Withdrawn);
    expect((nftEcoFilter(src)!.address as string[]).includes(BALANCE)).toBe(true);
    expect(nftInkFilter(src)).toEqual({ address: BALANCE, topics: [NFT_TOPICS.InkMoved, "0x0000000000000000000000003620540c994433d7b4a628c46d2ed5f92572ea07"] });
    expect(nftInkFilter(sales.j.source)).toBeNull();
    const reqs: string[] = [];
    await readNftLogs(src, 1n, 2n, async (f) => {
      reqs.push(JSON.stringify(f.topics));
      return [];
    });
    expect(reqs.length).toBe(3);
  });

  it("the fingerprint names BALANCE only when the source has it", () => {
    expect(stationFingerprint(1, src, 1)).not.toBe(stationFingerprint(1, sales.j.source, 1));
    // 11 fields, + "pages" (the fixture source has the Statements: page sales and overprints are inputs).
    expect(JSON.parse(stationFingerprint(1, sales.j.source, 1))).toHaveLength(12);
    expect(JSON.parse(stationFingerprint(1, { ...sales.j.source, statements: undefined }, 1))).toHaveLength(11);
    expect(stationFingerprint(1, { ...src, ratings: undefined }, 1)).toBe(stationFingerprint(1, src, 1));
  });
});

describe("checkpoint carry and tags", () => {
  it("an old carry (before ratings and withdraws) reads as before; the carry round-trips", () => {
    const old = { lastPrice: "3144799385046438", recent: ["1", "2"] };
    expect(nftCarryToJSON(nftCarryFromJSON(old))).toEqual(old);
    expect(nftCarryFromJSON({ lastPrice: null })).toEqual({ lastPrice: null, recent: [] });
  });

  it("the new tags survive JSON (the checkpoint's recent swaps) unchanged", () => {
    const { sales: out } = decodeNftLogs(src, [...load("credits-withdraw.json").logs, ...sales.logs], undefined, { ratings: table });
    const tags = out.map((s) => s.nft);
    expect(JSON.parse(JSON.stringify(tags))).toEqual(tags);
    expect(tags.some((t) => t.via === "withdraw" && t.ink)).toBe(true);
    expect(tags.some((t) => t.score !== undefined)).toBe(true);
  });
});

describe("registry nft block", () => {
  it("balance must be an address, ratings a known table", () => {
    const base = { itemSupply: 77114, refPrice: "0.01", core: "0xcdb1889ae12074d750CD9B8531B692015465e0dD" };
    expect(nftConfigProblems({ ...base, balance: BALANCE, ratings: "credits" })).toEqual([]);
    expect(nftConfigProblems({ ...base, balance: "0x12" })).toEqual(["nft.balance must be an address"]);
    expect(nftConfigProblems({ ...base, ratings: "punks" })).toEqual(["nft.ratings must be one of credits"]);
  });
});
