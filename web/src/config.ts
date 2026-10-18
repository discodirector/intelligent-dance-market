/** Live mode defaults to Robinhood Chain (owner decision, chainId 4663). */
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER = "https://robinhoodchain.blockscout.com";

export type AppMode = "demo" | "replay" | "live" | "gallery";

export interface AppConfig {
  mode: AppMode;
  timelineUrl: string | null;
  seconds: number | null;
  speed: number;
  hookAddress: `0x${string}` | null;
  chainId: number;
  rpcUrl: string;
}

export function readConfig(search = window.location.search, pathname = window.location.pathname): AppConfig {
  const q = new URLSearchParams(search);
  const timelineUrl = q.get("timeline");
  const requested = q.get("mode");
  let mode: AppMode = "demo";
  if (requested === "live" || requested === "replay" || requested === "demo" || requested === "gallery") {
    mode = requested;
  }
  else if (timelineUrl || pathname.endsWith("/replay")) mode = "replay";

  const hook = q.get("hook") ?? "";
  const hookAddress = /^0x[0-9a-fA-F]{40}$/.test(hook) ? (hook as `0x${string}`) : null;
  const chainParsed = Number(q.get("chainId") ?? ROBINHOOD_CHAIN_ID);
  const speedParsed = Number(q.get("speed") ?? "1");
  const secondsParsed = q.get("seconds");
  const seconds = secondsParsed == null ? null : Number(secondsParsed);

  return {
    mode,
    timelineUrl,
    seconds: seconds != null && Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    speed: Number.isFinite(speedParsed) && speedParsed > 0 ? speedParsed : 1,
    hookAddress,
    chainId: Number.isFinite(chainParsed) && chainParsed > 0 ? chainParsed : ROBINHOOD_CHAIN_ID,
    rpcUrl: q.get("rpc") || ROBINHOOD_RPC,
  };
}
