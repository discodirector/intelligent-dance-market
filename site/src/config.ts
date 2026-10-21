// Site configuration. Switching the live network (Sepolia rehearsal -> Robinhood launch) is a change here only.
// Sepolia reads the current record in contracts/deployments/sepolia.json: since 2026-10-15 that is the drop/fill hook
// 0xCE08276945E9513F12BdEada8f62c11aE0637040 (startBlock 11915695); the pre-drop hook is kept there under "previous".
import sepolia from "@deployments/sepolia.json";
import sepoliaV2 from "@deployments/sepolia-v2.json";
import { isRulesVersion, type RulesVersion } from "./rules";
import type { VirtualPool } from "./data/virtual";
import { STATIONS, stationNetwork } from "./stations";

export interface Network {
  key: string;
  label: string; // status bar
  chainId: number;
  rpcUrl: string;
  /** Mainnet live view: the market alone picks the genre, so the rack shows it but offers no audition. */
  mainnet?: boolean;
  /** Tried when rpcUrl fails, in order (viem fallback). */
  rpcFallbacks?: string[];
  explorer: string; // tx/address/block links
  explorerName: string;
  sourcify?: string; // repo.sourcify.dev base
  hook: `0x${string}` | null;
  /** Rules the hook runs: decides how slots are decoded and how the synth reads heat. */
  rules: RulesVersion;
  token: `0x${string}` | null;
  /** Paired currency: native ETH (address 0) for the launch hook; IMD for the v1 Sepolia rehearsal. */
  quote: `0x${string}` | null;
  quoteSymbol: "ETH" | "IMD";
  poolManager: `0x${string}` | null;
  poolId: `0x${string}` | null;
  startBlock: number;
  launchedBy: string;
  launchUrl: string | null;
  /** PulseTreasury (contracts/TREASURY-RUNBOOK.md): its swaps are labelled PULSE. null until deployed. */
  treasury: `0x${string}` | null;
  /** A station without the hook: this pool's swaps run through the v2 rules in the browser (data/virtual.ts). */
  virtual?: VirtualPool;
}

/** Native ETH as a v4 currency. */
export const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as const;

export const NETWORKS: Record<string, Network> = {
  // Stations without the hook (stations/registry.json, every kind but "hook": v4, v3, v2 and forks): ?net=<key> plays
  // the pool's swaps through the v2 rules in the browser from the entry's genesis block (data/virtual.ts). First:
  // IMD/ETH on Ethereum (2026-10-21, asked for by IMD's founder, genesis ~7 days before). Spread first, so the
  // networks below win a key clash.
  ...Object.fromEntries(STATIONS.filter((s) => s.kind !== "hook").map((s) => [s.key, stationNetwork(s)])),
  sepolia: {
    key: "sepolia",
    label: "SEPOLIA",
    chainId: sepolia.chainId,
    // publicnode prunes logs older than a few days ("pruned history unavailable"), so the backfill reads Tenderly's
    // public gateway (40k-block ranges, CORS *); publicnode stays as the fallback.
    rpcUrl: "https://sepolia.gateway.tenderly.co",
    rpcFallbacks: ["https://ethereum-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.etherscan.io",
    explorerName: "Etherscan",
    sourcify: "https://repo.sourcify.dev/11155111",
    hook: sepolia.hook as `0x${string}`,
    rules: "v1", // 0xCE08…7040: fixed tiers, no heat, IMD-quoted
    token: sepolia.token as `0x${string}`,
    quote: sepolia.imd as `0x${string}`,
    quoteSymbol: "IMD",
    poolManager: sepolia.poolManager as `0x${string}`,
    poolId: sepolia.poolId as `0x${string}`,
    startBlock: sepolia.startBlock,
    launchedBy: "self-deployed rehearsal · launch by the IMD swarm pending",
    launchUrl: null,
    treasury: null,
  },
  // ---- V2 REHEARSAL (IDM/ETH) -----------------------------------------------------------------------------------
  // Read from contracts/deployments/sepolia-v2.json, written by sim's write-deployment-v2 after the rehearsal
  // (contracts/SEPOLIA-V2.md). Until it has a hook, ?net=sepolia-v2 falls back to the v1 network above.
  "sepolia-v2": {
    key: "sepolia-v2",
    label: "SEPOLIA V2",
    chainId: sepolia.chainId,
    // publicnode prunes logs older than a few days ("pruned history unavailable"), so the backfill reads Tenderly's
    // public gateway (40k-block ranges, CORS *); publicnode stays as the fallback.
    rpcUrl: "https://sepolia.gateway.tenderly.co",
    rpcFallbacks: ["https://ethereum-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.etherscan.io",
    explorerName: "Etherscan",
    sourcify: "https://repo.sourcify.dev/11155111",
    hook: sepoliaV2.hook as `0x${string}` | null,
    rules: "v2",
    token: sepoliaV2.token as `0x${string}` | null,
    quote: NATIVE_ETH, // contracts/script/DeploySepolia.s.sol rehearses the native ETH pair
    quoteSymbol: "ETH",
    poolManager: sepolia.poolManager as `0x${string}`,
    poolId: sepoliaV2.poolId as `0x${string}` | null,
    startBlock: sepoliaV2.startBlock,
    launchedBy: "self-deployed rehearsal · v2 rules",
    launchUrl: null,
    // PulseTreasury rehearsal (contracts/TREASURY-RUNBOOK.md), deployed 2026-10-18 with the then 45-minute window.
    treasury: "0xbBb7357f7a97Ed73E717924a617ccB6a2aB49e80",
  },
  // IMD launch #2303 (2026-10-20): hook/token/pool deployed by the IMD swarm on Robinhood Chain (pairWith "eth"),
  // one tx at block 93576944; source identity-md-launches/launch-2303-review-launch-token-named@7935131.
  robinhood: {
    key: "robinhood",
    mainnet: true,
    label: "ROBINHOOD 4663",
    chainId: 4663,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    explorerName: "Blockscout",
    hook: "0x4ebe25e5b6493194a58ac8b62bb13b38156f7040",
    rules: "v2", // the delivered SequencerState.sol is byte-identical to ours (v2 rules)
    token: "0x4fe9f3823791c8b187b81ab8b7398d793fed28f6",
    quote: NATIVE_ETH,
    quoteSymbol: "ETH",
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
    poolId: "0x519387822812b11873eb51242f9dc80632d98144742b4ed0feea792af777d94b",
    startBlock: 93576944,
    launchedBy: "launched by the IMD swarm · launch #2303",
    launchUrl: "https://explorer.imd.fun/jobs/18ac1075-a6ce-4487-83f3-17e3d795c1f1",
    // PulseTreasury 8cb07cf (open price limit), deployed 2026-10-20 with FeeSplitter 0x1651…123A in front of it.
    treasury: "0xab64b47daa0f68e50bdf776e73b4245d78575a6c",
  },
};

/** Live network shown by default. */
export const ACTIVE_NETWORK = "robinhood";
/** Replay a bare URL opens until launch (the live hook has no market yet); null = live. At launch: null + robinhood. */
export const DEFAULT_REPLAY: string | null = null;

export interface Replay {
  url: string;
  label: string;
  explorer: string;
  speed: number;
  /** Rules the tape's slot0/slot1 were recorded under. Another version re-simulates the tape from its inputs. */
  rules: RulesVersion;
  /** Seconds each genre (epoch) plays; default EPOCH_PLAY (data/replay.ts). */
  epochPlay?: readonly [number, number];
}

export const REPLAYS: Record<string, Replay> = {
  // Sepolia v2 rehearsal (2026-10-18/19): 117 swaps on the v2 hook, TRACK #1 at swap 70. One epoch, ~37 real minutes
  // played in ~3.7 min per loop.
  sepolia: { url: "timelines/sepolia-rehearsal.json", label: "REPLAY · SEPOLIA REHEARSAL", explorer: "https://sepolia.etherscan.io", speed: 10, rules: "v2", epochPlay: [180, 240] },
};

export const LINKS = {
  github: "https://github.com/discodirector/intelligent-dance-market",
  x: "https://x.com/theidmfun" as string | null,
  imd: "https://imd.fun",
};

/** `rules` is the version the page decodes/simulates with; `resim` = a replay re-simulated under other rules. */
export type Source =
  | { kind: "live"; net: Network; rules: RulesVersion }
  | { kind: "replay"; id: string; replay: Replay; net: Network; rules: RulesVersion; resim: boolean; speed: number };

/** A network whose hook is not deployed yet falls back to its v1 sibling (`sepolia-v2` -> `sepolia`). */
function resolveNetwork(key: string | null): Network {
  const net = NETWORKS[key ?? ACTIVE_NETWORK] ?? NETWORKS[ACTIVE_NETWORK];
  if (net.rules === "v2" && !net.hook && net.key.endsWith("-v2")) return NETWORKS[net.key.slice(0, -3)] ?? NETWORKS[ACTIVE_NETWORK];
  return net;
}

export function readSource(search = location.search): Source {
  const q = new URLSearchParams(search);
  const net = resolveNetwork(q.get("net"));
  const r = q.get("replay") ?? (q.has("net") || q.has("live") ? null : DEFAULT_REPLAY);
  if (r && REPLAYS[r]) {
    const replay = REPLAYS[r];
    // Dev preview: ?replay=imd-week&rules=v2 re-simulates the tape under v2 (heat, drops). &speed=N overrides playback speed.
    const want = q.get("rules");
    const rules = isRulesVersion(want) ? want : replay.rules;
    const speed = Number(q.get("speed"));
    return { kind: "replay", id: r, replay, net, rules, resim: rules !== replay.rules, speed: speed > 0 ? speed : replay.speed };
  }
  // Live: the hook decides; ?rules= is ignored.
  return { kind: "live", net, rules: net.rules };
}
