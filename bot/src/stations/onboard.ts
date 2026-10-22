// Station onboarding (docs/STATIONS.md "Onboarding"): the pure parts of bot/scripts/station-add.ts. Picking the main
// pair, the key, the LCD theme, the registry entry, and the registry edits (insert, status, paidUntil) as text
// edits that leave every other byte of stations/registry.json as it was. No network here (pool.ts reads the chain).
import { POOL_KINDS, SWAP_EVENTS, type Calibration, type PoolKind } from "@swarm-sequencer/core";
import { toEventSelector } from "viem";
import { addMonths, isoSeconds } from "./subscription.ts";

export type Hex = `0x${string}`;
export type Status = "live" | "paused" | "pending" | "preview";
export const STATUSES: readonly Status[] = ["live", "paused", "pending", "preview"];

const NATIVE = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------- main pair

/** A DexScreener pair, reduced to what the pick reads (token-pairs/v1 items). */
export interface PairCandidate {
  pairAddress: string;
  dexId: string;
  labels: string[];
  base: string;
  quote: string;
  quoteSymbol: string;
  liquidityUsd: number;
}

export function parseCandidate(p: any): PairCandidate | null {
  if (!p || typeof p.pairAddress !== "string" || !p.baseToken?.address || !p.quoteToken?.address) return null;
  return {
    pairAddress: p.pairAddress.toLowerCase(),
    dexId: String(p.dexId ?? ""),
    labels: Array.isArray(p.labels) ? p.labels.map(String) : [],
    base: String(p.baseToken.address).toLowerCase(),
    quote: String(p.quoteToken.address).toLowerCase(),
    quoteSymbol: String(p.quoteToken.symbol ?? ""),
    liquidityUsd: Number(p.liquidity?.usd) || 0,
  };
}

/**
 * The token's pairs against ETH: native (address 0), the chain's WETH or its wrapped native (WMON), deepest first.
 * Only pool addresses (20 bytes) and v4 pool ids (32 bytes): DexScreener also lists Balancer ids and the like.
 */
export function ethPairs(pairs: PairCandidate[], token: string, quotes: string[]): PairCandidate[] {
  const t = token.toLowerCase();
  const ok = new Set([NATIVE, ...quotes.map((q) => q.toLowerCase())]);
  return pairs
    .filter((p) => /^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(p.pairAddress))
    .filter((p) => (p.base === t && ok.has(p.quote)) || (p.quote === t && ok.has(p.base)))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

/** Swap topic0 -> pool kind (core swaps.ts SWAP_EVENTS): how a pool's own events name its kind. */
export const KIND_BY_TOPIC: Record<string, PoolKind> = Object.fromEntries(
  POOL_KINDS.map((k) => [toEventSelector(SWAP_EVENTS[k]).toLowerCase(), k]),
);

/** v2/v3: the quote is the pool's other token; ethSide = its index (token0 is the lower address). */
export function sideOf(token: string, token0: string, token1: string): { quote: Hex; ethSide: 0 | 1 } {
  const [t, a, b] = [token, token0, token1].map((x) => x.toLowerCase());
  if (t !== a && t !== b) throw new Error(`token ${token} is not in the pool (token0 ${token0}, token1 ${token1})`);
  return t === a ? { quote: b as Hex, ethSide: 1 } : { quote: a as Hex, ethSide: 0 };
}

/** v4: currencies are sorted, native (address 0) first, so the quote's side follows from the two addresses. */
export const v4Side = (token: string, quote: string): 0 | 1 => (BigInt(quote) < BigInt(token) ? 0 : 1);

// ---------------------------------------------------------------- calibration inputs

/** "7091972" or "4.2e14"-free decimals ("1234.5") of a token amount -> raw units at `decimals`. Exact. */
export function parseTokenAmount(v: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v.replace(/_/g, ""));
  if (!m) throw new Error(`not a token amount: ${JSON.stringify(v)} (digits, optional decimals)`);
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) throw new Error(`${v}: more than ${decimals} decimals`);
  const raw = BigInt(m[1] + frac.padEnd(decimals, "0"));
  if (raw <= 0n) throw new Error(`${v}: must be > 0`);
  return raw;
}

/** round(log_1.0001(1e27 / supplyRaw)): the tick shift that makes the rules' FDV the token's (core Calibration). */
export function supplyTickOffset(supplyRaw: bigint): number {
  const bits = supplyRaw.toString(2).length;
  const ln = bits > 1000 ? Math.log(Number(supplyRaw >> BigInt(bits - 64))) + (bits - 64) * Math.LN2 : Math.log(Number(supplyRaw));
  return Math.round((Math.log(1e27) - ln) / Math.log(1.0001));
}

/** A plain decimal string (no exponent), `sig` significant digits: what the registry stores for quotePerEth. */
export function fmtDecimal(x: number, sig = 6): string {
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(x)));
  const s = x.toFixed(Math.min(digits, 18));
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * The entry's calibration: none for a 1e9 x 1e18 token against ETH (the identity), else the supply shift, plus
 * quotePerEth (and quoteDecimals when not 18) for a quote that is not ETH.
 */
export function calibrationFor(offset: number, quotePerEth: string | null, quoteDecimals = 18): Calibration | undefined {
  if (quotePerEth === null) return offset === 0 ? undefined : { supplyTickOffset: offset };
  return { supplyTickOffset: offset, quotePerEth, ...(quoteDecimals !== 18 ? { quoteDecimals } : {}) };
}

// ---------------------------------------------------------------- key, label

/** Lowercase slug of a symbol (registry keys: ^[a-z0-9][a-z0-9-]*$); "station" when nothing is left. */
export function slug(s: string): string {
  const out = s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || "station";
}

/** The key for a new station: the symbol's slug, else slug-<chain>, else slug-<chain>-2, -3… (never taken). */
export function pickKey(symbol: string, chainSlug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slug(symbol);
  if (!used.has(base)) return base;
  const withChain = `${base}-${slug(chainSlug)}`;
  if (!used.has(withChain)) return withChain;
  for (let i = 2; ; i++) if (!used.has(`${withChain}-${i}`)) return `${withChain}-${i}`;
}

/** Ticker for cards: the symbol in capitals, letters and digits only ("$PEPE" -> "PEPE"). */
export const tickerOf = (symbol: string): string => symbol.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase() || "TOKEN";

/** Card label: TOKEN/QUOTE with wrapped quotes unwrapped (WETH -> ETH, WMON -> MON). */
export const labelOf = (ticker: string, quoteSymbol: string): string =>
  `${ticker}/${quoteSymbol.replace(/^W(ETH|MON)$/i, "$1").toUpperCase()}`;

// ---------------------------------------------------------------- theme

export interface Theme { phos: string; phosDim: string; ghost: string; lcd: string }

/** The house themes, exact: green = $IDM, cyan = IMD/ETH. */
export const HOUSE_THEMES = {
  green: { phos: "#6cf595", phosDim: "#2f8f4f", ghost: "#0f2c19", lcd: "#06150c" },
  cyan: { phos: "#6fd8ff", phosDim: "#2a7f9c", ghost: "#0b2530", lcd: "#041218" },
} as const satisfies Record<string, Theme>;

/** Preset seeds; every one but the house two is derived (deriveTheme) at the house contrasts. */
export const PRESET_SEEDS: Record<string, string> = {
  green: HOUSE_THEMES.green.phos,
  cyan: HOUSE_THEMES.cyan.phos,
  blue: "#7aa2ff",
  violet: "#b18cff",
  magenta: "#ff5fd2",
  pink: "#ff8fb8",
  red: "#ff5a5a",
  orange: "#ff8c3a",
  amber: "#ffb000",
  yellow: "#f2e24b",
  lime: "#b6f23c",
};

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of #rrggbb. */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, >= 1. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hexOf(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

/** The lightest-needed colour of hue h, saturation s whose contrast against `bg` reaches `target` (binary search). */
function atContrast(h: number, s: number, bg: string, target: number): string {
  let lo = hslOf(bg)[2], hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(hexOf(h, s, mid), bg) < target) lo = mid;
    else hi = mid;
  }
  return hexOf(h, s, hi);
}

/**
 * The house contrasts (both house themes, against their LCD glass): phos ~11.7-13.5, phosDim ~4.2-4.6, ghost ~1.2.
 * A seed's phos is kept when it already sits in the phos band, else lifted or lowered to the band's middle.
 */
export const THEME_CONTRAST = { phos: [11, 15], phosDim: 4.4, ghost: 1.22 } as const;

/** Four LCD colours from one #rrggbb: its hue on dark glass, at the house themes' contrasts. */
export function deriveTheme(seed: string): Theme {
  if (!/^#[0-9a-fA-F]{6}$/.test(seed)) throw new Error(`theme: not #rrggbb: ${seed}`);
  const [h, s0] = hslOf(seed.toLowerCase());
  const s = s0; // a grey seed (s 0) gives a grey theme, on purpose
  // Glass at the house lightness (~5%), the hue's own saturation capped like the house glasses (0.56-0.71).
  const lcd = hexOf(h, Math.min(s, 0.65), 0.054);
  const ghost = atContrast(h, Math.min(s, 0.55), lcd, THEME_CONTRAST.ghost);
  const phosDim = atContrast(h, Math.min(s, 0.55), lcd, THEME_CONTRAST.phosDim);
  const c = contrast(seed, lcd);
  const [lo, hi] = THEME_CONTRAST.phos;
  const phos = c >= lo && c <= hi ? seed.toLowerCase() : atContrast(h, Math.max(s, s > 0 ? 0.85 : 0), lcd, (lo + hi) / 2 - 0.5);
  return { phos, phosDim, ghost, lcd };
}

/** --theme: a preset name or a #rrggbb seed. House presets are exact; the rest derived. */
export function themeFor(arg: string): Theme {
  const a = arg.trim().toLowerCase();
  if (a in HOUSE_THEMES) return { ...HOUSE_THEMES[a as keyof typeof HOUSE_THEMES] };
  if (a in PRESET_SEEDS) return deriveTheme(PRESET_SEEDS[a]);
  if (/^#?[0-9a-f]{6}$/.test(a)) return deriveTheme(a.startsWith("#") ? a : `#${a}`);
  throw new Error(`--theme: a preset (${Object.keys(PRESET_SEEDS).join(", ")}) or #rrggbb, not ${arg}`);
}

/** No --theme: the first non-house preset whose phos no station uses yet (then the first non-house one). */
export function defaultPreset(used: Theme[]): string {
  const taken = new Set(used.map((t) => t.phos.toLowerCase()));
  const names = Object.keys(PRESET_SEEDS).filter((n) => !(n in HOUSE_THEMES));
  return names.find((n) => !taken.has(themeFor(n).phos)) ?? names[0];
}

// ---------------------------------------------------------------- entry

export interface EntryInput {
  key: string;
  label: string;
  ticker: string;
  chainId: number;
  kind: PoolKind;
  /** v4: the PoolManager + poolId; other kinds: the pool. */
  poolManager?: Hex;
  pool: Hex;
  genesisBlock: number;
  token: Hex;
  quote: Hex;
  ethSide: 0 | 1;
  calibration?: Calibration;
  theme: Theme;
  program?: string;
  status?: Status;
  paidUntil?: string;
}

/** A registry entry in the field order of the existing played entries (imd-eth), addresses lowercase. */
export function buildEntry(i: EntryInput): Record<string, unknown> {
  if (i.kind === "v4" && !i.poolManager) throw new Error("a v4 entry needs its PoolManager");
  const lc = (a: string) => a.toLowerCase();
  return {
    key: i.key,
    label: i.label,
    ticker: i.ticker,
    chainId: i.chainId,
    ...(i.kind === "v4" ? { poolManager: i.poolManager, poolId: lc(i.pool) } : { pool: lc(i.pool) }),
    genesisBlock: i.genesisBlock,
    token: lc(i.token),
    quote: lc(i.quote),
    ethSide: i.ethSide,
    quoteSymbol: "ETH",
    kind: i.kind,
    ...(i.calibration ? { calibration: i.calibration } : {}),
    theme: { phos: i.theme.phos, phosDim: i.theme.phosDim, ghost: i.theme.ghost, lcd: i.theme.lcd },
    program: i.program ?? "idm",
    status: i.status ?? "pending",
    ...(i.paidUntil ? { paidUntil: i.paidUntil } : {}),
  };
}

/** paidUntil: a date (YYYY-MM-DD) or an ISO timestamp in UTC; informational (status stays the switch). */
export const isPaidUntil = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/.test(v) && Number.isFinite(Date.parse(v));

// ---------------------------------------------------------------- registry text edits

/** One entry in the registry's style: a field per line, objects and arrays on one line. */
export function formatEntry(e: Record<string, unknown>, indent = "    "): string {
  const inline = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(inline).join(", ")}]`
    : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`
    : JSON.stringify(v);
  const rows = Object.entries(e).map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${inline(v)}`);
  return `${indent}{\n${rows.join(",\n")}\n${indent}}`;
}

/** Index of the bracket that closes the one at `open` (JSON text: strings skipped). */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") if (--depth === 0) return i;
  }
  throw new Error("registry: unbalanced brackets");
}

/** Appends an entry at the end of "stations": every byte before and after the insertion stays as it was. */
export function insertEntry(text: string, entry: Record<string, unknown>): string {
  const at = text.indexOf('"stations"');
  if (at < 0) throw new Error('registry: no "stations" array');
  const open = text.indexOf("[", at);
  const close = closing(text, open);
  // The last entry's closing brace (or the empty array's bracket): the new entry goes right after it.
  let end = close - 1;
  while (/\s/.test(text[end])) end--;
  const last = text[end] === "}" ? end : -1;
  const lineStart = text.lastIndexOf("\n", close) + 1;
  const indent = text.slice(lineStart, close).replace(/\S.*$/, "") + "  ";
  const block = formatEntry(entry, indent);
  const out = last >= 0
    ? text.slice(0, last + 1) + ",\n" + block + text.slice(last + 1)
    : text.slice(0, open + 1) + "\n" + block + "\n" + text.slice(lineStart, close) + text.slice(close);
  verify(text, out, (s) => [...s, entry]);
  return out;
}

/** The text span [start, end] of the station object with this key. */
function entrySpan(text: string, key: string): [number, number] {
  const open = text.indexOf("[", text.indexOf('"stations"'));
  const close = closing(text, open);
  for (let i = open + 1; i < close; i++) {
    if (text[i] !== "{") continue;
    const end = closing(text, i);
    if ((JSON.parse(text.slice(i, end + 1)) as { key?: string }).key === key) return [i, end];
    i = end;
  }
  throw new Error(`registry: no station "${key}"`);
}

/**
 * Sets one top-level string field of one station (status, paidUntil): replaced in place when present, else added
 * as the entry's last field. Every byte outside that line stays.
 */
export function setField(text: string, key: string, field: string, value: string): string {
  const [start, end] = entrySpan(text, key);
  const obj = text.slice(start, end + 1);
  const re = new RegExp(`("${field}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
  let next: string;
  if (re.test(obj)) next = obj.replace(re, (_m, head) => `${head}${JSON.stringify(value)}`);
  else {
    let last = obj.length - 2;
    while (/\s/.test(obj[last])) last--;
    const indent = /\n([ \t]+)"/.exec(obj)?.[1] ?? "      ";
    next = obj.slice(0, last + 1) + `,\n${indent}${JSON.stringify(field)}: ${JSON.stringify(value)}` + obj.slice(last + 1);
  }
  const out = text.slice(0, start) + next + text.slice(end + 1);
  verify(text, out, (s) => s.map((e: any) => (e.key === key ? { ...e, [field]: value } : e)));
  return out;
}

/**
 * The included first month starts when a station goes on air: setting a non-house station live with no paidUntil yet
 * gives it now + 1 month (ISO timestamp, UTC). null = leave paidUntil as it is (house, or already set: renewals extend
 * from the current end).
 */
export function firstPaidUntil(e: { house?: boolean; kind: string; paidUntil?: string }, status: Status, now: number): string | null {
  if (status !== "live" || e.house || e.kind === "hook" || e.paidUntil) return null;
  return isoSeconds(addMonths(now, 1));
}

/** The edit must parse and change exactly what it says (the chains and every other station untouched). */
function verify(before: string, after: string, expect: (stations: any[]) => any[]) {
  const a = JSON.parse(before), b = JSON.parse(after);
  const want = { ...a, stations: expect(a.stations) };
  if (JSON.stringify(b) !== JSON.stringify(want)) throw new Error("registry edit changed more than intended");
}

/** A line diff of two texts (one changed region: common head and tail kept as context), for the dry run. */
export function lineDiff(a: string, b: string, context = 3): string {
  const x = a.split("\n"), y = b.split("\n");
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  if (head === x.length && head === y.length) return "(no change)";
  const from = Math.max(0, head - context);
  const out = [`@@ -${from + 1},${x.length - tail - from + Math.min(context, tail)} +${from + 1},${y.length - tail - from + Math.min(context, tail)} @@`];
  for (let i = from; i < head; i++) out.push(`  ${x[i]}`);
  for (let i = head; i < x.length - tail; i++) out.push(`- ${x[i]}`);
  for (let i = head; i < y.length - tail; i++) out.push(`+ ${y[i]}`);
  for (let i = x.length - tail; i < Math.min(x.length, x.length - tail + context); i++) out.push(`  ${x[i]}`);
  return out.join("\n");
}
