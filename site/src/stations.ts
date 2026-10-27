// Station registry (stations/registry.json, docs/STATIONS.md "Registry"), shared with the bot. The shape is checked
// by scripts/check-stations.mjs before every build; this module only types it and derives what the site needs.
import registry from "@stations/registry.json";
import { stationFingerprint, type Calibration, type PoolKind, type StationSource, type SwapSource } from "@swarm-sequencer/core";
import type { Network } from "./config";
import { withRuntime } from "./runtime";

export interface StationTheme {
  /** Lit LCD pixels / text. */
  phos: string;
  phosDim: string;
  /** Unlit LCD cells. */
  ghost: string;
  /** LCD glass. */
  lcd: string;
  /** Optional skin of the player page (applyTheme on the root): the faceplate, and the sell / whale accents. */
  panel?: string;
  sell?: string;
  whale?: string;
}

/** kind "nft": the collection is the entry's `token`; the supply frame and the venues (core nft.ts NftSource). */
export interface StationNft {
  itemSupply: number;
  refPrice: string;
  seaport?: `0x${string}`[];
  strategy?: `0x${string}`;
  core?: `0x${string}`;
  statements?: `0x${string}`;
  /** BALANCE (the Statements' ERC-20): its withdraws are deep events (core nft.ts). */
  balance?: `0x${string}`;
  /** The offline rating table its sales are tagged with (core credittable.ts), loaded only by this station. */
  ratings?: "credits";
  /** The Statements' first block: a sold or overprinted page's history is read from here (core readNftPageLogs). */
  statementsFrom?: number;
  /** BALANCE's official pool (Uniswap v4): its swaps are quiet ornaments, never notes of the groove (core nft.ts). */
  balancePool?: { poolManager: `0x${string}`; poolId: `0x${string}` };
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
   * (data/virtual.ts) from its Swap logs through core swaps.ts; "nft" a collection's sales through core nft.ts;
   * "hamster" a hamster's wheel (Squeekchain) through core hamster.ts, from our recorder's file (data/hamster.ts).
   */
  kind: "hook" | PoolKind | "nft" | "hamster";
  hook?: `0x${string}`;
  nft?: StationNft;
  /** kind "hamster": the published night (bot hamster/publish.ts) and the sleep pack (synth sleep.ts). */
  hamster?: { data: string; sleep?: string; tag?: string };
  /** House stations (run by theidm) are listed first. */
  house?: boolean;
  /** A gift: on air without a subscription, never expires (docs/STATIONS.md "Gift stations"). */
  gift?: boolean;
  theme: StationTheme;
  /** Style program key; "idm" = the house schedules. */
  program: string;
  /**
   * Only "live" is on air (/stations); "pending" = added, waiting for its sound; "preview" = its pack is in, playable at
   * ?net=<key> (labelled PREVIEW), not listed until it goes live.
   */
  status: "live" | "paused" | "pending" | "preview";
  /** Subscription end (ISO date), informational: status stays the switch. */
  paidUntil?: string;
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
/**
 * The baked registry plus the stations the pipeline added at runtime (runtime.ts: /stations-data/stations.json and
 * their packs, validated like check-stations; baked wins; 2.5 s at most, then the baked registry alone). Every page
 * that imports this module (and config.ts, built from it) waits for that one read.
 */
const merged = await withRuntime({ chains: CHAINS, stations: registry.stations as Station[] });
if (merged.skipped.length) console.warn("runtime stations skipped:", merged.skipped);
if (Object.keys(merged.packErrors).length) console.warn("runtime packs refused:", merged.packErrors);
export const STATIONS: Station[] = merged.registry.stations;

export const chainOf = (s: Station): Chain => CHAINS[String(s.chainId)];
/** Registry chains by id: [id, chain], registry order. */
export const CHAIN_LIST: [number, Chain][] = Object.entries(CHAINS).map(([id, c]) => [Number(id), c]);
export const rpcUrlsOf = (s: Station): string[] => s.rpcUrls ?? chainOf(s).rpcUrls;

/**
 * The bot's runtime status (OUT_DIR/stations-data/status.json, bot stations/subscription.ts): the registry's status
 * with paid renewals merged in; a live station whose subscription ran out is "expired" (off air, keeps its sound).
 */
export type RuntimeStatus = Station["status"] | "expired";
/** `plus`: Station+ now (docs/STATIONS.md "Station+"), with its end; absent = a plain station. */
export type StatusMap = Record<string, { status: RuntimeStatus; paidUntil?: string; plus?: true; plusUntil?: string }>;
export const STATUS_URL = "/stations-data/status.json";

/**
 * Fetches status.json; null when missing, unreadable (an SPA fallback page included), malformed or slow: the caller
 * falls back to the registry, as before subscriptions.
 */
export async function loadStatus(timeoutMs = 2500): Promise<StatusMap | null> {
  try {
    const res = await fetch(STATUS_URL, { cache: "no-cache", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !/json/.test(res.headers.get("content-type") ?? "")) return null;
    const j = (await res.json()) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const ok = ["live", "paused", "pending", "preview", "expired"];
    const out: StatusMap = {};
    for (const [k, v] of Object.entries(j as Record<string, { status?: unknown; paidUntil?: unknown; plus?: unknown; plusUntil?: unknown }>)) {
      if (!v || typeof v.status !== "string" || !ok.includes(v.status)) continue;
      out[k] = {
        status: v.status as RuntimeStatus,
        ...(typeof v.paidUntil === "string" ? { paidUntil: v.paidUntil } : {}),
        ...(v.plus === true ? { plus: true as const, ...(typeof v.plusUntil === "string" ? { plusUntil: v.plusUntil } : {}) } : {}),
      };
    }
    return out;
  } catch {
    return null;
  }
}

/** A station's status now: the runtime file's when it names the station, else the registry's. */
export const statusOf = (s: Station, status: StatusMap | null): RuntimeStatus => status?.[s.key]?.status ?? s.status;

/** A station's name on screen: a token's cashtag ($IDM), a collection's own name (CREDITS: an NFT has no cashtag). */
export const stationName = (s: Station): string => (s.kind === "nft" || s.kind === "hamster" ? s.label : `$${s.ticker}`);

/** Station+ now (status.json; without it, none): listed right after the house and gift stations. */
export const isPlus = (s: Station, status: StatusMap | null): boolean => !s.house && status?.[s.key]?.plus === true;

/** Stations on air: house stations first, then gifts, then Station+, registry order otherwise; an expired subscription is off air. */
export const onAir = (status: StatusMap | null = null): Station[] => {
  const rank = (s: Station) => (s.house ? 0 : s.gift ? 1 : isPlus(s, status) ? 2 : 3);
  return STATIONS.filter((s) => s.status === "live" && statusOf(s, status) === "live").sort((a, b) => rank(a) - rank(b));
};

/**
 * Applications on /stations (stations-apply.ts): off until the owner builds with VITE_STATIONS_APPLY=1; until then
 * the page says "Applications open soon". The API is same-origin (Caddy proxies /api/* to the bot's API service).
 */
export const APPLY_OPEN = import.meta.env.VITE_STATIONS_APPLY === "1";
export const API_BASE = (import.meta.env.VITE_STATIONS_API ?? "") + "/api/stations";

/** The registry entry for a network (a played station by key, else chain + pool id), or undefined (testnets, replays). */
export function stationFor(net: Network): Station | undefined {
  const played = net.virtual || net.hamster ? STATIONS.find((s) => s.key === net.key && s.chainId === net.chainId) : undefined;
  if (played || !net.poolId) return played;
  return STATIONS.find((s) => s.chainId === net.chainId && s.poolId?.toLowerCase() === net.poolId!.toLowerCase());
}

/** Player link for a station: the hook station is the bare player (config ACTIVE_NETWORK), the rest ?net=<key>. */
export const playerHref = (s: Station): string => (s.kind === "hook" ? "/" : `/?net=${s.key}`);

/**
 * Where a played station's swaps come from (check-stations guarantees the fields its kind needs): its pool, or for an
 * "nft" station its collection, venues and supply frame (core nft.ts), with the chain's WETH.
 */
export function swapSourceOf(s: Station): StationSource {
  if (s.kind === "hook") throw new Error(`${s.key}: the hook station is read on chain, not replayed`);
  if (s.kind === "nft") return { kind: "nft", collection: s.token, ...s.nft!, weth: chainOf(s).weth };
  if (s.kind === "hamster") throw new Error(`${s.key}: a hamster station reads its published night, not logs`);
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
  if (s.kind === "hamster") {
    return {
      key: s.key,
      mainnet: true,
      label: `${s.label} STATION`,
      chainId: s.chainId,
      rpcUrl: urls[0],
      explorer: chain.explorer,
      explorerName: chain.explorerName,
      hook: null,
      rules: "v2",
      token: s.token,
      quote: s.quote ?? "0x0000000000000000000000000000000000000000",
      quoteSymbol: s.quoteSymbol,
      poolManager: null,
      poolId: null,
      startBlock: s.genesisBlock,
      launchedBy: "the $IDM hook's rules, played in your browser on a real hamster's wheel, one note per 30 m",
      launchUrl: null,
      treasury: null,
      hamster: { url: s.hamster!.data, ...(s.hamster!.sleep ? { sleep: s.hamster!.sleep } : {}) },
    };
  }
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
    launchedBy: s.kind === "nft"
      ? `the $IDM hook's rules, played in your browser on every ${s.label.toLowerCase()} sale, one note per item`
      : `the $IDM hook's rules, played in your browser on ${s.ticker}'s own pool`,
    launchUrl: null,
    treasury: null,
    virtual: {
      source: swapSourceOf(s),
      genesisBlock: s.genesisBlock,
      logChunk: chain.logChunk,
      token: s.token,
      tokenSymbol: s.kind === "nft" ? s.label : s.ticker,
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

/** a mixed toward black by `k` (0..1), as #rrggbb: the faceplate's shades from its one colour. */
const shade = (hex: string, k: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, "0")).join("");

/**
 * The station's skin on the player page only (main.ts; cards keep the house faceplate): the faceplate colour and its
 * shades, the sell and whale accents, and `body.skin-<key>` for anything CSS adds (style.css).
 */
export function applySkin(s: Station, el: HTMLElement = document.documentElement) {
  const t = s.theme;
  if (t.panel) {
    el.style.setProperty("--bone", t.panel);
    el.style.setProperty("--bone-2", shade(t.panel, 0.05));
    el.style.setProperty("--bone-3", shade(t.panel, 0.12));
  }
  if (t.sell) el.style.setProperty("--sell", t.sell);
  if (t.whale) el.style.setProperty("--amber", t.whale);
  if (t.panel || t.sell || t.whale) document.body.classList.add(`skin-${s.key}`);
}
