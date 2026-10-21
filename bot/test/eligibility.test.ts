import { describe, expect, it } from "vitest";
import { earliest, evaluate, exitCode, holderBalances, parseBlockscoutCounters, parseDexPair, parseGoPlus, parseHoneypot, pickToken, RULES, type Measurements } from "../src/stations/eligibility.ts";

const NOW = 1_800_000_000;
const DAY = 86_400;

// A token that clears every rule with room to spare.
const good = (): Measurements => ({
  chainId: 1, pool: "0xpool", token: "0xtoken", symbol: "TKN",
  marketCapUsd: { value: 1_000_000, source: "dex" },
  holders: { value: 5_000, source: "blockscout" },
  liquidityUsd: { value: 200_000, source: "dex" },
  createdAt: { value: NOW - 30 * DAY, source: "blockscout" },
  sell: { value: { ok: true, full: true, sellTaxPct: 0 }, source: "honeypot.is" },
});

const rule = (r: ReturnType<typeof evaluate>, k: string) => r.rules.find((x) => x.rule === k)!;

describe("evaluate", () => {
  it("passes when every rule is met", () => {
    const r = evaluate(good(), NOW);
    expect(r.verdict).toBe("pass");
    expect(exitCode(r)).toBe(0);
    expect(r.reasons).toEqual([]);
    expect(r.rules.map((x) => x.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });

  it("thresholds are inclusive and each one fails on its own", () => {
    const m = good();
    m.marketCapUsd.value = RULES.minMarketCapUsd;
    m.holders.value = RULES.minHolders;
    m.liquidityUsd.value = RULES.minLiquidityUsd;
    m.createdAt.value = NOW - RULES.minTokenAgeDays * DAY;
    expect(evaluate(m, NOW).verdict).toBe("pass");
    const cases: [keyof Measurements, number, string][] = [
      ["marketCapUsd", RULES.minMarketCapUsd - 1, "marketCap"],
      ["holders", RULES.minHolders - 1, "holders"],
      ["liquidityUsd", RULES.minLiquidityUsd - 1, "liquidity"],
      ["createdAt", NOW - 6 * DAY, "tokenAge"],
    ];
    for (const [field, value, key] of cases) {
      const b = good();
      (b[field] as any).value = value;
      const r = evaluate(b, NOW);
      expect(r.verdict).toBe("fail");
      expect(exitCode(r)).toBe(1);
      expect(rule(r, key).status).toBe("fail");
      expect(r.reasons).toHaveLength(1);
    }
  });

  it("missing data never passes: unmeasured -> unavailable, exit 2", () => {
    const m = good();
    m.holders = { value: null, source: "blockscout", note: "Cloudflare challenge" };
    const r = evaluate(m, NOW);
    expect(r.verdict).toBe("unavailable");
    expect(exitCode(r)).toBe(2);
    expect(rule(r, "holders").status).toBe("unmeasured");
    expect(r.reasons[0]).toMatch(/could not measure.*Cloudflare/);
    expect(r.manualReviewAllowed).toBe(false);
  });

  it("a measured failure outranks missing data", () => {
    const m = good();
    m.holders.value = null;
    m.liquidityUsd.value = 1_000;
    expect(evaluate(m, NOW).verdict).toBe("fail");
  });

  it("sell: honeypot and high tax fail, partial simulation is unmeasured with manual review", () => {
    const hp = good();
    hp.sell.value = { ok: false, full: true, sellTaxPct: null };
    expect(evaluate(hp, NOW).verdict).toBe("fail");
    const tax = good();
    tax.sell.value = { ok: true, full: true, sellTaxPct: 25 };
    expect(rule(evaluate(tax, NOW), "sell").reason).toMatch(/25%/);
    const partial = good();
    partial.sell = { value: { ok: true, full: false, sellTaxPct: null }, source: "eth_call", manualReviewAllowed: true };
    const r = evaluate(partial, NOW);
    expect(r.verdict).toBe("unavailable");
    expect(r.manualReviewAllowed).toBe(true);
    const reverts = good();
    reverts.sell = { value: { ok: false, full: false, sellTaxPct: null }, source: "eth_call", manualReviewAllowed: true };
    expect(evaluate(reverts, NOW).verdict).toBe("fail");
  });

  it("manual review only when every unmeasured rule allows it", () => {
    const m = good();
    m.sell = { value: null, source: "none", note: "no simulator", manualReviewAllowed: true };
    expect(evaluate(m, NOW).manualReviewAllowed).toBe(true);
    m.holders.value = null;
    expect(evaluate(m, NOW).manualReviewAllowed).toBe(false);
  });
});

describe("parsers", () => {
  const dex = {
    chainId: "ethereum", pairAddress: "0x4158ABC", labels: ["v4"],
    baseToken: { address: "0xD34A", symbol: "IMD" }, quoteToken: { address: "0x0000000000000000000000000000000000000000", symbol: "ETH" },
    liquidity: { usd: 171126.71 }, fdv: 23817802, marketCap: 23825650, pairCreatedAt: 1788321875000,
  };

  it("DexScreener pair: market cap (never fdv), liquidity, creation in seconds", () => {
    const p = parseDexPair(dex)!;
    expect(p.pairAddress).toBe("0x4158abc");
    expect(p.marketCapUsd).toBe(23825650);
    expect(p.liquidityUsd).toBe(171126.71);
    expect(p.pairCreatedAt).toBe(1788321875);
    expect(parseDexPair({ ...dex, marketCap: undefined })!.marketCapUsd).toBeNull();
    expect(parseDexPair(undefined)).toBeNull();
  });

  it("token: base by default, either side when given, else an error", () => {
    const p = parseDexPair(dex)!;
    expect(pickToken(p).symbol).toBe("IMD");
    expect(pickToken(p, "0xd34a").symbol).toBe("IMD");
    expect(() => pickToken(p, "0x1234567890123456789012345678901234567890")).toThrow(/not in pool/);
  });

  it("Blockscout counters and honeypot.is", () => {
    expect(parseBlockscoutCounters({ transfers_count: "306361", token_holders_count: "4608" })).toBe(4608);
    expect(parseBlockscoutCounters({ message: "Not found" })).toBeNull();
    const ok = parseHoneypot({ token: { totalHolders: 4604 }, simulationSuccess: true, honeypotResult: { isHoneypot: false }, simulationResult: { sellTax: 0 }, pair: { pair: { name: "Uniswap V3: IMD-USDT" }, createdAtTimestamp: "1789228175" } });
    expect(ok).toEqual({ holders: 4604, sell: { ok: true, full: true, sellTaxPct: 0 }, pairCreatedAt: 1789228175, note: "on Uniswap V3: IMD-USDT" });
    expect(parseHoneypot({ simulationSuccess: true, honeypotResult: { isHoneypot: true, honeypotReason: "sell blocked" } }).sell!.ok).toBe(false);
    expect(parseHoneypot({ simulationSuccess: false, simulationError: "no pairs" })).toMatchObject({ sell: null, note: "no pairs" });
  });

  it("GoPlus token_security (Monad holders), keyed by the lowercased token", () => {
    // Shape of /api/v1/token_security/143 for CHOG, 2026-10-21 (trimmed).
    const j = { code: 1, message: "OK", result: { "0x350035555e10d9afaf1566aaebfced5ba6c27777": { holder_count: "33830", is_honeypot: "0", sell_tax: "0", token_symbol: "CHOG" } } };
    expect(parseGoPlus(j, "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777")).toEqual({ holders: 33830, flags: "is_honeypot 0, cannot_sell_all ?, sell_tax 0" });
    expect(parseGoPlus({ code: 1, result: {} }, "0x01")).toEqual({ holders: null, flags: null });
  });

  it("holders from a Transfer history skip zero, dead and emptied balances", () => {
    const Z = "0x0000000000000000000000000000000000000000";
    const D = "0x000000000000000000000000000000000000dEaD";
    const b = holderBalances([
      { from: Z, to: "0xA", value: 100n },
      { from: "0xa", to: "0xB", value: 40n },
      { from: "0xb", to: "0xC", value: 40n },
      { from: "0xA", to: D, value: 10n },
    ]);
    expect([...b.entries()]).toEqual([["0xa", 50n], ["0xc", 40n]]);
  });

  it("creation time: the earliest source wins, none = unmeasured", () => {
    expect(earliest([{ at: 300, source: "a" }, { at: null, source: "b" }, { at: 200, source: "c" }])).toEqual({ value: 200, source: "c" });
    expect(earliest([{ at: null, source: "a" }]).value).toBeNull();
  });
});
