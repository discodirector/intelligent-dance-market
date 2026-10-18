// Trade profiles. Amounts are IMD (18 decimals on-chain); thresholds: hat <0.5, glitch <5, snare <25, kick <100, whale >=100.
export interface Trade { profile: string; side: "buy" | "sell"; imd: number }
export interface Profile { describe: string; defaultCount: number; intervalMs: number; next: (r: () => number, i: number) => Omit<Trade, "profile"> }

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (x: number) => Math.round(x * 100) / 100 || 0.1;
const logUniform = (r: () => number, lo: number, hi: number) => round(Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo))));
const side = (r: () => number, pBuy: number) => (r() < pBuy ? "buy" : "sell") as Trade["side"];

export const PROFILES: Record<string, Profile> = {
  calm: { describe: "small trades (hat/glitch), slow", defaultCount: 6, intervalMs: 20_000,
    next: (r) => ({ side: side(r, 0.5), imd: logUniform(r, 0.1, 3) }) },
  busy: { describe: "frequent mixed trades across hat..kick", defaultCount: 16, intervalMs: 2_000,
    next: (r) => ({ side: side(r, 0.55), imd: logUniform(r, 0.2, 60) }) },
  whale: { describe: "alternating >=100 IMD whales (Movement, root +7) and small fills", defaultCount: 8, intervalMs: 5_000,
    next: (r, i) => (i % 2 === 0 ? { side: side(r, 0.6), imd: round(100 + r() * 400) } : { side: side(r, 0.5), imd: logUniform(r, 0.5, 20) }) },
  selloff: { describe: "sustained sell pressure -> Phrygian then Locrian", defaultCount: 14, intervalMs: 2_000,
    next: (r) => ({ side: side(r, 0.08), imd: logUniform(r, 3, 80) }) },
  drops: { describe: "whale buys (Euclidean FILL) and sells (track DROP) with small fills between", defaultCount: 26, intervalMs: 4_000,
    next: (r, i) => (i % 2 === 0 ? { side: (i % 4 === 0 ? "buy" : "sell") as Trade["side"], imd: round(100 + r() * 300) } : { side: side(r, 0.5), imd: logUniform(r, 0.5, 30) }) },
  random: { describe: "mix of everything incl. occasional whale", defaultCount: 22, intervalMs: 3_000,
    next: (r) => ({ side: side(r, 0.5), imd: r() < 0.1 ? round(100 + r() * 300) : logUniform(r, 0.1, 90) }) },
};

export function plan(profile: string, count: number, seed: number): Trade[] {
  const r = mulberry(seed);
  return Array.from({ length: count }, (_, i) => ({ profile, ...PROFILES[profile].next(r, i) }));
}
