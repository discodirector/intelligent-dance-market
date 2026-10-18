import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { decode, type SequencerState } from "@swarm-sequencer/synth";
import { ROBINHOOD_EXPLORER, type AppConfig } from "../config";
import type { AppliedSwap } from "./demo";

const abi = parseAbi([
  "function raw() view returns (uint256 slot0, uint256 slot1)",
  "event Mutated(address indexed sender, uint32 indexed swapCount, uint8 track, uint8 step, bool on, uint8 bassNote, bool isBuy, uint128 imdAmount, int24 tick, uint256 slot0, uint256 slot1)",
]);

export interface LiveHooks {
  onState: (state: SequencerState, flash?: AppliedSwap) => void;
  onStatus: (text: string) => void;
}

function chainFor(cfg: AppConfig) {
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainId === 4663 ? "Robinhood Chain" : `chain ${cfg.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: {
      default: {
        name: "Blockscout",
        url: cfg.chainId === 4663 ? ROBINHOOD_EXPLORER : "https://robinhoodchain.blockscout.com",
      },
    },
  });
}

/** Reads `raw()` and follows `Mutated`. Hook address comes from config or `?hook=`. */
export function startLive(cfg: AppConfig, hooks: LiveHooks): () => void {
  if (!cfg.hookAddress) {
    hooks.onStatus(`live · chain ${cfg.chainId} · set ?hook=0x… (Robinhood RPC ${cfg.rpcUrl})`);
    return () => {};
  }
  const client = createPublicClient({ chain: chainFor(cfg), transport: http(cfg.rpcUrl) });
  const address = cfg.hookAddress;
  let closed = false;
  hooks.onStatus(`live · chain ${cfg.chainId} · connecting`);

  void client
    .readContract({ address, abi, functionName: "raw" })
    .then((raw) => {
      if (closed) return;
      const [slot0, slot1] = raw;
      hooks.onState(decode(slot0, slot1));
      hooks.onStatus(`live · chain ${cfg.chainId} · ${address.slice(0, 6)}…${address.slice(-4)}`);
    })
    .catch((err: unknown) => {
      if (closed) return;
      hooks.onStatus(`live · raw() failed · ${err instanceof Error ? err.message : String(err)}`);
    });

  const unwatch = client.watchContractEvent({
    address,
    abi,
    eventName: "Mutated",
    onLogs(logs) {
      if (closed) return;
      for (const log of logs) {
        const args = log.args;
        if (args.slot0 == null || args.slot1 == null) continue;
        const track = Number(args.track ?? 0);
        const amount = BigInt(args.imdAmount ?? 0);
        const whale = amount >= 100n * 10n ** 18n;
        hooks.onState(decode(args.slot0, args.slot1), {
          track,
          step: Number(args.step ?? 0),
          bass: Boolean(args.isBuy) || Number(args.bassNote ?? 0) === 0,
          row: whale,
          drop: whale ? { track, fill: Boolean(args.isBuy) } : undefined,
        });
      }
    },
    onError(err) {
      if (!closed) hooks.onStatus(`live · watch · ${err.message}`);
    },
  });

  return () => {
    closed = true;
    unwatch();
  };
}
