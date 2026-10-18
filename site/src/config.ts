// Site configuration. Switching the live network (Sepolia rehearsal -> Robinhood launch) is a change here only.
// Sepolia reads the current record in contracts/deployments/sepolia.json: since 2026-10-15 that is the drop/fill hook
// 0xCE08276945E9513F12BdEada8f62c11aE0637040 (startBlock 11915695); the pre-drop hook is kept there under "previous".
import sepolia from "@deployments/sepolia.json";
import { isRulesVersion, type RulesVersion } from "./rules";

export interface Network {
  key: string;
  label: string; // status bar
  chainId: number;
  rpcUrl: string;
  explorer: string; // tx/address/block links
  explorerName: string;
  sourcify?: string; // repo.sourcify.dev base
  hook: `0x${string}` | null;
  /** Rules the hook runs: decides how slots are decoded and how the synth reads heat. */
  rules: RulesVersion;
  token: `0x${string}` | null;
  imd: `0x${string}` | null;
  poolManager: `0x${string}` | null;
  poolId: `0x${string}` | null;
  startBlock: number;
  launchedBy: string;
  launchUrl: string | null;
}

export const NETWORKS: Record<string, Network> = {
  sepolia: {
    key: "sepolia",
    label: "SEPOLIA",
    chainId: sepolia.chainId,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    explorerName: "Etherscan",
    sourcify: "https://repo.sourcify.dev/11155111",
    hook: sepolia.hook as `0x${string}`,
    rules: "v1", // 0xCE08…7040: fixed tiers, no heat
    token: sepolia.token as `0x${string}`,
    imd: sepolia.imd as `0x${string}`,
    poolManager: sepolia.poolManager as `0x${string}`,
    poolId: sepolia.poolId as `0x${string}`,
    startBlock: sepolia.startBlock,
    launchedBy: "self-deployed rehearsal · launch by the IMD swarm pending",
    launchUrl: null,
  },
  // ---- V2 HOOK PLACEHOLDER ------------------------------------------------------------------------------------
  // The v2 hook (relative tiers + accumulation + heat/drop) is not deployed yet. Fill in hook/pool/startBlock
  // when it is; until `hook` is set, ?net=sepolia-v2 falls back to the v1 network above (see readSource).
  "sepolia-v2": {
    key: "sepolia-v2",
    label: "SEPOLIA V2",
    chainId: sepolia.chainId,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    explorerName: "Etherscan",
    sourcify: "https://repo.sourcify.dev/11155111",
    hook: null, // TODO(v2): v2 hook address
    rules: "v2",
    token: null,
    imd: sepolia.imd as `0x${string}`,
    poolManager: sepolia.poolManager as `0x${string}`,
    poolId: null,
    startBlock: 0,
    launchedBy: "self-deployed rehearsal · v2 rules",
    launchUrl: null,
  },
  // Filled in at launch: hook/token/pool from the IMD swarm deployment on Robinhood Chain.
  robinhood: {
    key: "robinhood",
    label: "ROBINHOOD 4663",
    chainId: 4663,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    explorerName: "Blockscout",
    hook: null,
    rules: "v2", // planned launch rules; confirm against the deployed hook before filling in `hook`
    token: null,
    imd: "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127",
    poolManager: null,
    poolId: null,
    startBlock: 0,
    launchedBy: "launched by the IMD swarm · job id pending",
    launchUrl: null,
  },
};

/** Live network shown by default. */
export const ACTIVE_NETWORK = "sepolia";

export interface Replay {
  url: string;
  label: string;
  explorer: string;
  speed: number;
  /** Rules the tape's slot0/slot1 were recorded under. Another version re-simulates the tape from its inputs. */
  rules: RulesVersion;
}

export const REPLAYS: Record<string, Replay> = {
  // W3 bot tape: 7 days of the IMD/ETH POOL4 market on Ethereum mainnet, played ~12 min per loop.
  "imd-week": { url: "timelines/imd-week.json", label: "REPLAY · IMD/ETH MAINNET 7D", explorer: "https://etherscan.io", speed: 840, rules: "v1" },
};

export const LINKS = {
  github: "https://github.com/discodirector/intelligent-dance-market",
  x: null as string | null, // placeholder until the account exists
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
  const r = q.get("replay");
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
