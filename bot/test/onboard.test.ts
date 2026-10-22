import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEntry, calibrationFor, contrast, defaultPreset, deriveTheme, ethPairs, firstPaidUntil, fmtDecimal, HOUSE_THEMES, insertEntry,
  isPaidUntil, KIND_BY_TOPIC, labelOf, lineDiff, luminance, parseTokenAmount, pickKey, PRESET_SEEDS, setField, sideOf,
  slug, supplyTickOffset, THEME_CONTRAST, themeFor, tickerOf, v4Side, type PairCandidate,
} from "../src/stations/onboard.ts";

const REGISTRY = readFileSync(new URL("../../stations/registry.json", import.meta.url), "utf8");
const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const NATIVE = "0x0000000000000000000000000000000000000000";

describe("theme", () => {
  it("house presets are the house themes, exact", () => {
    expect(themeFor("green")).toEqual(HOUSE_THEMES.green);
    expect(themeFor("cyan")).toEqual(HOUSE_THEMES.cyan);
  });

  it("the house themes sit in the contrast bands the derivation targets", () => {
    for (const t of Object.values(HOUSE_THEMES)) {
      expect(contrast(t.phos, t.lcd)).toBeGreaterThanOrEqual(THEME_CONTRAST.phos[0]);
      expect(contrast(t.phosDim, t.lcd)).toBeGreaterThan(4);
      expect(contrast(t.ghost, t.lcd)).toBeLessThan(1.3);
    }
  });

  it("any seed (every 15° of hue, light and dark, presets, grey) gets the house contrasts", () => {
    const hsl = (h: number, s: number, l: number) => {
      const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
      const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
      return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
    };
    const seeds = [...Object.values(PRESET_SEEDS), "#808080", "#ffffff", "#000000"];
    for (let h = 0; h < 360; h += 15) seeds.push(hsl(h, 1, 0.5), hsl(h, 0.7, 0.2), hsl(h, 0.9, 0.85));
    for (const seed of seeds) {
      const t = deriveTheme(seed);
      for (const c of Object.values(t)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      const p = contrast(t.phos, t.lcd), d = contrast(t.phosDim, t.lcd), g = contrast(t.ghost, t.lcd);
      expect(p, seed).toBeGreaterThanOrEqual(THEME_CONTRAST.phos[0]);
      expect(p, seed).toBeLessThanOrEqual(THEME_CONTRAST.phos[1]);
      expect(d, seed).toBeGreaterThanOrEqual(4.2);
      expect(d, seed).toBeLessThanOrEqual(4.8);
      expect(g, seed).toBeGreaterThanOrEqual(1.15);
      expect(g, seed).toBeLessThanOrEqual(1.35);
      // Dark glass like the house ones (luminance 0.005-0.006).
      expect(luminance(t.lcd), seed).toBeLessThan(0.01);
    }
  });

  it("keeps a seed already in the phos band, lifts a dark one", () => {
    expect(deriveTheme("#6cf595").phos).toBe("#6cf595");
    const t = deriveTheme("#203080");
    expect(t.phos).not.toBe("#203080");
    expect(contrast(t.phos, t.lcd)).toBeGreaterThan(11);
  });

  it("accepts presets and hex, refuses the rest; the default skips house and used presets", () => {
    expect(themeFor("#FFB000")).toEqual(deriveTheme("#ffb000"));
    expect(themeFor("ffb000")).toEqual(deriveTheme("#ffb000"));
    expect(themeFor("amber")).toEqual(deriveTheme(PRESET_SEEDS.amber));
    expect(() => themeFor("plaid")).toThrow(/preset/);
    expect(defaultPreset([HOUSE_THEMES.green, HOUSE_THEMES.cyan])).toBe("blue");
    expect(defaultPreset([HOUSE_THEMES.green, themeFor("blue")])).toBe("violet");
  });
});

describe("key, ticker, label", () => {
  it("slugs symbols", () => {
    expect(slug("PEPE")).toBe("pepe");
    expect(slug("$CHOG")).toBe("chog");
    expect(slug("Pepe 2.0")).toBe("pepe-2-0");
    expect(slug("  --IMD--  ")).toBe("imd");
    expect(slug("Pokémon")).toBe("pokemon");
    expect(slug("🐸")).toBe("station");
  });

  it("picks a free key: the slug, then slug-chain, then numbered", () => {
    expect(pickKey("PEPE", "ethereum", ["idm", "imd-eth"])).toBe("pepe");
    expect(pickKey("IMD", "ethereum", ["idm", "imd"])).toBe("imd-ethereum");
    expect(pickKey("IMD", "ethereum", ["imd", "imd-ethereum", "imd-ethereum-2"])).toBe("imd-ethereum-3");
  });

  it("ticker and label", () => {
    expect(tickerOf("$pepe")).toBe("PEPE");
    expect(tickerOf("chog")).toBe("CHOG");
    expect(labelOf("PEPE", "WETH")).toBe("PEPE/ETH");
    expect(labelOf("CHOG", "WMON")).toBe("CHOG/MON");
    expect(labelOf("IMD", "ETH")).toBe("IMD/ETH");
    expect(labelOf("X", "USDC")).toBe("X/USDC");
  });
});

describe("pool facts", () => {
  const pair = (pairAddress: string, base: string, quote: string, liquidityUsd: number): PairCandidate =>
    ({ pairAddress, dexId: "uniswap", labels: [], base, quote, quoteSymbol: "?", liquidityUsd });

  it("keeps ETH-side pairs (native, WETH, wrapped native), deepest first, pool addresses and ids only", () => {
    const v2 = "0x" + "a".repeat(40), v3 = "0x" + "b".repeat(40), v4 = "0x" + "c".repeat(64), usdc = "0x" + "d".repeat(40);
    const got = ethPairs([
      pair(v3, PEPE, WETH, 2_000_000),
      pair(usdc, PEPE, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 9_000_000),
      pair(v2, PEPE, WETH, 30_000_000),
      pair(v4, PEPE, NATIVE, 200_000),
      pair(`${v2}-${v3}`, PEPE, WETH, 99_000_000),
      pair("0x" + "e".repeat(40), WETH, PEPE, 5_000_000),
    ], PEPE.toUpperCase().replace("0X", "0x"), [WETH]);
    expect(got.map((p) => p.pairAddress)).toEqual([v2, "0x" + "e".repeat(40), v3, v4]);
  });

  it("names the kind from the Swap topic", () => {
    expect(KIND_BY_TOPIC["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"]).toBe("v3");
    expect(KIND_BY_TOPIC["0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"]).toBe("v2");
    expect(new Set(Object.values(KIND_BY_TOPIC)).size).toBe(5);
  });

  it("sides: v2/v3 from token0/token1, v4 from the sorted currencies", () => {
    expect(sideOf(PEPE, PEPE, WETH)).toEqual({ quote: WETH, ethSide: 1 });
    expect(sideOf(WETH.toUpperCase().replace("0X", "0x"), PEPE, WETH)).toEqual({ quote: PEPE, ethSide: 0 });
    expect(() => sideOf(NATIVE, PEPE, WETH)).toThrow(/not in the pool/);
    expect(v4Side(PEPE, NATIVE)).toBe(0);
    expect(v4Side(PEPE, WETH)).toBe(1);
  });
});

describe("calibration inputs", () => {
  it("parses token amounts exactly", () => {
    expect(parseTokenAmount("7091972", 18)).toBe(7_091_972n * 10n ** 18n);
    expect(parseTokenAmount("1_000.5", 6)).toBe(1_000_500_000n);
    expect(() => parseTokenAmount("1e9", 18)).toThrow();
    expect(() => parseTokenAmount("0.0000001", 6)).toThrow(/decimals/);
    expect(() => parseTokenAmount("0", 18)).toThrow(/> 0/);
  });

  it("supply offsets: 0 for 1e9 x 1e18, PEPE's about -129,500, bridged IMD's from its total supply", () => {
    expect(supplyTickOffset(10n ** 27n)).toBe(0);
    expect(supplyTickOffset(420_690_000_000_000n * 10n ** 18n)).toBe(-129503);
    expect(supplyTickOffset(7_091_972n * 10n ** 18n)).toBe(Math.round(Math.log(1e27 / 7.091972e24) / Math.log(1.0001)));
  });

  it("calibration block: none for the identity, else the probe's shape", () => {
    expect(calibrationFor(0, null)).toBeUndefined();
    expect(calibrationFor(-129503, null)).toEqual({ supplyTickOffset: -129503 });
    expect(calibrationFor(0, "111372")).toEqual({ supplyTickOffset: 0, quotePerEth: "111372" });
    expect(calibrationFor(5, "4012.5", 6)).toEqual({ supplyTickOffset: 5, quotePerEth: "4012.5", quoteDecimals: 6 });
    expect(fmtDecimal(111372.4321)).toBe("111372");
    expect(fmtDecimal(0.000123456789)).toBe("0.000123457");
  });
});

const input = () => ({
  key: "pepe", label: "PEPE/ETH", ticker: "PEPE", chainId: 1, kind: "v2" as const,
  pool: "0xA43fe16908251ee70EF74718545e4FE6C5cCEc9f" as const, genesisBlock: 24_000_000,
  token: PEPE as `0x${string}`, quote: WETH as `0x${string}`, ethSide: 1 as const,
  calibration: { supplyTickOffset: -129503 }, theme: themeFor("amber"),
});

describe("entry", () => {
  it("builds a pending entry in the registry's field order", () => {
    const e = buildEntry(input());
    expect(Object.keys(e)).toEqual(["key", "label", "ticker", "chainId", "pool", "genesisBlock", "token", "quote", "ethSide", "quoteSymbol", "kind", "calibration", "theme", "program", "status"]);
    expect(e.pool).toBe("0xa43fe16908251ee70ef74718545e4fe6c5ccec9f");
    expect(e.status).toBe("pending");
    expect(e.program).toBe("idm");
    expect(e.quoteSymbol).toBe("ETH");
  });

  it("v4: poolManager + poolId, no calibration when it is the identity", () => {
    const e = buildEntry({ ...input(), kind: "v4", pool: ("0x" + "ab".repeat(32)) as `0x${string}`, poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90", quote: NATIVE as `0x${string}`, ethSide: 0, calibration: undefined, paidUntil: "2026-12-31" });
    expect(Object.keys(e).slice(4, 6)).toEqual(["poolManager", "poolId"]);
    expect(e).not.toHaveProperty("pool");
    expect(e).not.toHaveProperty("calibration");
    expect(e.paidUntil).toBe("2026-12-31");
    expect(() => buildEntry({ ...input(), kind: "v4" })).toThrow(/PoolManager/);
  });

  it("paidUntil: a date or a UTC timestamp", () => {
    expect(isPaidUntil("2026-12-31")).toBe(true);
    expect(isPaidUntil("2026-12-31T00:00:00Z")).toBe(true);
    expect(isPaidUntil("2026-13-40")).toBe(false);
    expect(isPaidUntil("31.12.2026")).toBe(false);
    expect(isPaidUntil("2026-12-31T00:00:00+02:00")).toBe(false);
  });
});

describe("registry edits", () => {
  it("insertion appends the entry and leaves every other byte as it was", () => {
    const entry = buildEntry(input());
    const out = insertEntry(REGISTRY, entry);
    const close = REGISTRY.lastIndexOf("}", REGISTRY.lastIndexOf("]")) + 1;
    expect(out.startsWith(REGISTRY.slice(0, close))).toBe(true);
    expect(out.endsWith(REGISTRY.slice(close))).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.stations.at(-1)).toEqual(entry);
    expect(parsed.stations.slice(0, -1)).toEqual(JSON.parse(REGISTRY).stations);
    // In the house style: one field per line, the theme on one line.
    expect(out).toContain(`    {\n      "key": "pepe",\n`);
    expect(out).toMatch(/\n {6}"theme": \{ "phos": "#[0-9a-f]{6}", "phosDim": .*\},\n/);
  });

  it("insertion into an empty stations array", () => {
    const empty = '{\n  "chains": {},\n  "stations": [\n  ]\n}\n';
    const out = insertEntry(empty, { key: "a", n: 1 });
    expect(JSON.parse(out).stations).toEqual([{ key: "a", n: 1 }]);
    expect(out.endsWith("  ]\n}\n")).toBe(true);
  });

  it("setField changes one line of one entry, or adds the field last", () => {
    const withPepe = insertEntry(REGISTRY, buildEntry(input()));
    const live = setField(withPepe, "pepe", "status", "live");
    expect(lineDiff(withPepe, live).split("\n").filter((l) => /^[-+] /.test(l))).toEqual(['-       "status": "pending"', '+       "status": "live"']);
    const paid = setField(live, "pepe", "paidUntil", "2026-12-31");
    expect(JSON.parse(paid).stations.at(-1).paidUntil).toBe("2026-12-31");
    expect(paid.startsWith(live.slice(0, live.lastIndexOf('"status": "live"')))).toBe(true);
    const again = setField(paid, "pepe", "paidUntil", "2027-01-31");
    expect(JSON.parse(again).stations.at(-1).paidUntil).toBe("2027-01-31");
    // Another station's status stays: the same value elsewhere is not touched.
    const paused = setField(REGISTRY, "idm", "status", "paused");
    const before = JSON.parse(REGISTRY).stations.map((s: any) => (s.key === "idm" ? "paused" : s.status));
    expect(JSON.parse(paused).stations.map((s: any) => s.status)).toEqual(before);
    expect(() => setField(REGISTRY, "nope", "status", "live")).toThrow(/no station/);
  });

  it("lineDiff shows the changed lines with context", () => {
    expect(lineDiff("a\nb\nc", "a\nb\nc")).toBe("(no change)");
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toBe("@@ -1,3 +1,3 @@\n  a\n- b\n+ B\n  c");
  });
});

describe("first month on air", () => {
  const T = Date.parse("2026-10-22T09:30:00Z");
  it("live, not house, no paidUntil yet -> now + 1 month; otherwise untouched", () => {
    expect(firstPaidUntil({ kind: "v4" }, "live", T)).toBe("2026-11-22T09:30:00Z");
    expect(isPaidUntil(firstPaidUntil({ kind: "v2" }, "live", T))).toBe(true);
    expect(firstPaidUntil({ kind: "v4", paidUntil: "2026-11-22" }, "live", T)).toBeNull();
    expect(firstPaidUntil({ kind: "v4", house: true }, "live", T)).toBeNull();
    expect(firstPaidUntil({ kind: "hook" }, "live", T)).toBeNull();
    expect(firstPaidUntil({ kind: "v4" }, "paused", T)).toBeNull();
  });
});
