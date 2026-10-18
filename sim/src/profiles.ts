// Trade profiles. Amounts are in the pool's quote currency (18 decimals on-chain).
//   v1 (IMD-quoted hook): hat <0.5, glitch <5, snare <25, kick <100, whale >=100 IMD.
//   v2 (native ETH hook): launch-scale sizes. The whale cut scales with FDV (SPEC §3.1): ~0.04 ETH at the rehearsal's
//   opening FDV of 4 ETH, rising as buys lift the price. v2 classifies non-whales against the market's size EMA.
export interface Trade { profile: string; side: "buy" | "sell"; amount: number }
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

/** v1 profiles, in IMD. */
export const PROFILES: Record<string, Profile> = {
  calm: { describe: "small trades (hat/glitch), slow", defaultCount: 6, intervalMs: 20_000,
    next: (r) => ({ side: side(r, 0.5), amount: logUniform(r, 0.1, 3) }) },
  busy: { describe: "frequent mixed trades across hat..kick", defaultCount: 16, intervalMs: 2_000,
    next: (r) => ({ side: side(r, 0.55), amount: logUniform(r, 0.2, 60) }) },
  whale: { describe: "alternating >=100 IMD whales (Movement, root +7) and small fills", defaultCount: 8, intervalMs: 5_000,
    next: (r, i) => (i % 2 === 0 ? { side: side(r, 0.6), amount: round(100 + r() * 400) } : { side: side(r, 0.5), amount: logUniform(r, 0.5, 20) }) },
  selloff: { describe: "sustained sell pressure -> Phrygian then Locrian", defaultCount: 14, intervalMs: 2_000,
    next: (r) => ({ side: side(r, 0.08), amount: logUniform(r, 3, 80) }) },
  drops: { describe: "whale buys (Euclidean FILL) and sells (track DROP) with small fills between", defaultCount: 26, intervalMs: 4_000,
    next: (r, i) => (i % 2 === 0 ? { side: (i % 4 === 0 ? "buy" : "sell") as Trade["side"], amount: round(100 + r() * 300) } : { side: side(r, 0.5), amount: logUniform(r, 0.5, 30) }) },
  random: { describe: "mix of everything incl. occasional whale", defaultCount: 22, intervalMs: 3_000,
    next: (r) => ({ side: side(r, 0.5), amount: r() < 0.1 ? round(100 + r() * 300) : logUniform(r, 0.1, 90) }) },
};

const eth = (x: number) => Math.round(x * 1e6) / 1e6 || 0.0001;
const logUniformEth = (r: () => number, lo: number, hi: number) => eth(Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo))));

/** v2 profiles, in ETH (native). Whales (0.08-0.15 ETH, ~2-3x the threshold) stay inside a 1 ETH rehearsal pool. */
export const PROFILES_V2: Record<string, Profile> = {
  calm: { describe: "small trades, slow", defaultCount: 6, intervalMs: 20_000,
    next: (r) => ({ side: side(r, 0.5), amount: logUniformEth(r, 0.0003, 0.008) }) },
  busy: { describe: "frequent mixed trades below the whale", defaultCount: 16, intervalMs: 2_000,
    next: (r) => ({ side: side(r, 0.55), amount: logUniformEth(r, 0.0005, 0.03) }) },
  whale: { describe: "alternating 0.08-0.15 ETH whales (Movement + Drop) and small fills", defaultCount: 8, intervalMs: 5_000,
    next: (r, i) => (i % 2 === 0 ? { side: side(r, 0.6), amount: eth(0.08 + r() * 0.07) } : { side: side(r, 0.5), amount: logUniformEth(r, 0.001, 0.02) }) },
  selloff: { describe: "sustained sell pressure -> Phrygian then Locrian", defaultCount: 14, intervalMs: 2_000,
    next: (r) => ({ side: side(r, 0.08), amount: logUniformEth(r, 0.002, 0.03) }) },
  track: { describe: "steady small buys (85%) that saturate the grid until TrackComplete (~65-100 swaps)", defaultCount: 110, intervalMs: 3_000,
    next: (r) => ({ side: side(r, 0.85), amount: logUniformEth(r, 0.0005, 0.01) }) },
  random: { describe: "mix of everything incl. occasional whale", defaultCount: 22, intervalMs: 3_000,
    next: (r) => ({ side: side(r, 0.5), amount: r() < 0.1 ? eth(0.08 + r() * 0.07) : logUniformEth(r, 0.0003, 0.03) }) },
};

export const profilesFor = (net: "v1" | "v2") => (net === "v2" ? PROFILES_V2 : PROFILES);

export function plan(profile: string, count: number, seed: number, net: "v1" | "v2" = "v1"): Trade[] {
  const r = mulberry(seed);
  const p = profilesFor(net)[profile];
  return Array.from({ length: count }, (_, i) => ({ profile, ...p.next(r, i) }));
}
