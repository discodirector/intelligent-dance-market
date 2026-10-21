// Station registry (stations/registry.json, docs/STATIONS.md "Registry"), shared with the bot. The shape is checked
// by scripts/check-stations.mjs before every build; this module only types it and derives what the site needs.
import registry from "@stations/registry.json";
import { stationFingerprint, type Calibration, type PoolKind, type SwapSource } from "@swarm-sequencer/core";
import type { Network } from "./config";

export interface StationTheme {
  /** Lit LCD pixels / text. */
  phos: string;
  phosDim: string;
  /** Unlit LCD cells. */
  ghost: string;
  /** LCD glass. */
  lcd: string;
}

export interface Station {
  key: string;
  /** Pool name on cards, e.g. "$IDM", "IMD/ETH". */
  label: string;
  ticker: string;
  chainId: number;
  /** First = primary, the rest are fallbacks in order. Absent: the chain's rpcUrls. */
  rpcUrls?: string[];
  /** "hook" and "v4": the PoolManager emitting the Swap logs, and the pool's id. */
  poolManager?: `0x${string}`;
  poolId?: `0x${string}`;
  /** v3 and v2 kinds: the pool (pair) itself. */
  pool?: `0x${string}`;
  /** Every viewer's state starts here (the hook's deployment block for a hook station). */
  genesisBlock: number;
  token: `0x${string}`;
  /** Played stations: the pool's quote side, native (address 0, v4 only), the chain's WETH or a calibrated token. */
  quote?: `0x${string}`;
  /** Played stations: which side of the pool is the quote (v4 currency0/currency1, v2/v3 token0/token1). */
  ethSide?: 0 | 1;
  /** Frozen at registration: supply and quote mapped onto the rules' frame (core swaps.ts Calibration). */
  calibration?: Calibration;
  quoteSymbol: "ETH" | "IMD";
  /**
   * "hook": the $IDM hook pool, state on chain. Any other kind is a pool without the hook, played in the browser
   * (data/virtual.ts) from its Swap logs through core swaps.ts.
   */
  kind: "hook" | PoolKind;
  hook?: `0x${string}`;
  /** House stations (run by theidm) are listed first. */
  house?: boolean;
  theme: StationTheme;
  /** Style program key; "idm" = the house schedules. */
  program: string;
  status: "live" | "paused";
}

export interface Chain {
  name: string;
  explorer: string;
  explorerName: string;
  /** Public RPCs that answer the browser (CORS) and serve old eth_getLogs ranges, primary first. */
  rpcUrls: string[];
  /** Blocks per eth_getLogs request: the widest range the listed RPCs serve. */
  logChunk: number;
  weth: `0x${string}`;
  /** Uniswap v4 PoolManager. */
  poolManager?: `0x${string}`;
  /** Native currency when it is not ETH (Monad: MON). */
  nativeSymbol?: string;
}

const CHAINS = registry.chains as Record<string, Chain>;
export const STATIONS = registry.stations as Station[];

export const chainOf = (s: Station): Chain => CHAINS[String(s.chainId)];
export const rpcUrlsOf = (s: Station): string[] => s.rpcUrls ?? chainOf(s).rpcUrls;

/** Stations on air, house stations first, registry order otherwise. */
export const onAir = (): Station[] => STATIONS.filter((s) => s.status === "live").sort((a, b) => Number(!!b.house) - Number(!!a.house));

/** The registry entry for a network (a played station by key, else chain + pool id), or undefined (testnets, replays). */
export function stationFor(net: Network): Station | undefined {
  const played = net.virtual ? STATIONS.find((s) => s.key === net.key && s.chainId === net.chainId) : undefined;
  if (played || !net.poolId) return played;
  return STATIONS.find((s) => s.chainId === net.chainId && s.poolId?.toLowerCase() === net.poolId!.toLowerCase());
}

/** Player link for a station: the hook station is the bare player (config ACTIVE_NETWORK), the rest ?net=<key>. */
export const playerHref = (s: Station): string => (s.kind === "hook" ? "/" : `/?net=${s.key}`);

/** Where a played station's swaps come from (check-stations guarantees the fields its kind needs). */
export function swapSourceOf(s: Station): SwapSource {
  if (s.kind === "hook") throw new Error(`${s.key}: the hook station is read on chain, not replayed`);
  const src: SwapSource = s.kind === "v4"
    ? { kind: "v4", address: s.poolManager!, poolId: s.poolId!, ethSide: s.ethSide ?? 0 }
    : { kind: s.kind, address: s.pool!, ethSide: s.ethSide! };
  return s.calibration ? { ...src, calibration: s.calibration } : src;
}

/** Where the bot publishes station checkpoints (Caddy serves the bot's OUT_DIR/stations-data here, docs/STATIONS.md). */
export const CHECKPOINT_BASE = "/stations-data";

/** A station without the hook as a site Network: same rules (v2) as the hook, played by data/virtual.ts. */
export function stationNetwork(s: Station): Network {
  const chain = chainOf(s);
  const urls = rpcUrlsOf(s);
  return {
    key: s.key,
    mainnet: true,
    label: `${s.label} STATION`,
    chainId: s.chainId,
    rpcUrl: urls[0],
    rpcFallbacks: urls.length > 1 ? urls.slice(1) : undefined,
    explorer: chain.explorer,
    explorerName: chain.explorerName,
    hook: null,
    rules: "v2",
    token: s.token,
    // Native, the chain's WETH or a calibrated quote; amounts reach the player in ETH either way (core swaps.ts).
    quote: s.quote ?? "0x0000000000000000000000000000000000000000",
    quoteSymbol: s.quoteSymbol,
    poolManager: s.poolManager ?? null,
    poolId: s.poolId ?? null,
    startBlock: s.genesisBlock,
    launchedBy: `the $IDM hook's rules, played in your browser on ${s.ticker}'s own pool`,
    launchUrl: null,
    treasury: null,
    virtual: {
      source: swapSourceOf(s),
      genesisBlock: s.genesisBlock,
      logChunk: chain.logChunk,
      token: s.token,
      tokenSymbol: s.ticker,
      checkpoint: { url: `${CHECKPOINT_BASE}/${s.key}.checkpoint.json`, key: s.key, fingerprint: stationFingerprint(s.chainId, swapSourceOf(s), s.genesisBlock) },
    },
  };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");

/**
 * Recolours every LCD under `el` (canvases read the variables each frame, CSS through var()). On the root element
 * the whole page follows; on a card only that card.
 */
export function applyTheme(t: StationTheme, el: HTMLElement = document.documentElement) {
  el.style.setProperty("--phos", t.phos);
  el.style.setProperty("--phos-rgb", rgb(t.phos));
  el.style.setProperty("--phos-dim", t.phosDim);
  el.style.setProperty("--phos-ghost", t.ghost);
  el.style.setProperty("--lcd-bg", t.lcd);
}
