// Fetches the station eligibility numbers from free, keyless public sources (checked 2026-10-21):
//   market cap, liquidity  DexScreener /latest/dex/pairs/<chain>/<pool> (v4 pools are listed by poolId)
//   token age              earliest of: Blockscout contract creation tx, first Transfer log (full replay),
//                          DexScreener /token-pairs/v1 earliest pairCreatedAt, honeypot.is pair creation
//   holders                Blockscout /api/v2/tokens/<addr>/counters, else honeypot.is totalHolders,
//                          else GoPlus token_security holder_count (chains with `goplus`: Monad),
//                          else (chains with fullScan) a replay of every Transfer log over the public RPC
//   sell                   honeypot.is buy+sell simulation (Ethereum, Base, BNB); where it has none, automatic: an
//                          eth_call of a recent holder's transfer into the pool (a revert fails), then GoPlus
//                          token_security (honeypot, sell tax, owner sell blocks; no data = refused)
// Any source that fails leaves its metric null with a note; eligibility.ts turns null into "could not measure".
import { createPublicClient, defineChain, encodeFunctionData, erc20Abi, http, parseAbiItem, type PublicClient } from "viem";
import { earliest, goplusSell, holderBalances, parseBlockscoutCounters, parseDexPair, parseGoPlus, parseHoneypot, pickToken, RULES, type DexPair, type HoneypotResult, type Measured, type Measurements, type SellSim, type Transfer } from "./eligibility.ts";

export interface ChainInfo {
  name: string;
  /** DexScreener chain slug. */
  dex: string;
  rpcUrls: string[];
  /** Blockscout instance; base.blockscout.com and robinhoodchain.blockscout.com sit behind a Cloudflare challenge
   *  for some client IPs (seen 2026-10-21), so they are tried, and the next source is used when they refuse. */
  blockscout: string | null;
  /** honeypot.is serves this chain (Ethereum, Base, BNB; not Robinhood: "Invalid chain"). */
  honeypot: boolean;
  /** Uniswap v4 PoolManager: where a v4 sell sends the token. */
  poolManager: `0x${string}` | null;
  /** Young chain whose whole Transfer history is cheap to read: [0, head] in windows of this many blocks. */
  fullScanWindow: bigint | null;
  /** GoPlus token_security (keyless) serves this chain: holders where no Blockscout or honeypot.is does. */
  goplus?: boolean;
  /** Wrapped native token when the native currency is not ETH (Monad: WMON): a quote station-add.ts accepts. */
  wrappedNative?: `0x${string}`;
}

export const CHAINS: Record<number, ChainInfo> = {
  1: {
    name: "Ethereum", dex: "ethereum",
    rpcUrls: ["https://mainnet.gateway.tenderly.co", "https://ethereum-rpc.publicnode.com"],
    blockscout: "https://eth.blockscout.com", honeypot: true,
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90", fullScanWindow: null,
  },
  4663: {
    name: "Robinhood Chain", dex: "robinhood",
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    blockscout: "https://robinhoodchain.blockscout.com", honeypot: false,
    // The RPC keeps no historical state (no archive eth_getCode) but serves eth_getLogs over 10M-block ranges.
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951", fullScanWindow: 10_000_000n,
  },
  // v4 PoolManagers of Base and Arbitrum checked on chain 2026-10-21 (24,009 bytes of code each, same as Ethereum's).
  8453: {
    name: "Base", dex: "base",
    // mainnet.base.org answers eth_getLogs with "request limit reached"; Tenderly's gateway serves 1k-block ranges.
    rpcUrls: ["https://base.gateway.tenderly.co", "https://mainnet.base.org"],
    blockscout: "https://base.blockscout.com", honeypot: true,
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b", fullScanWindow: null,
  },
  42161: {
    name: "Arbitrum", dex: "arbitrum",
    rpcUrls: ["https://arbitrum.gateway.tenderly.co", "https://arb1.arbitrum.io/rpc"],
    // arbitrum.blockscout.com sits behind the same Cloudflare challenge; honeypot.is answers "Invalid chain", so the
    // sell is decided by GoPlus (no full Transfer replay on a chain this size).
    blockscout: "https://arbitrum.blockscout.com", honeypot: false,
    poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32", fullScanWindow: null,
  },
  // Monad (checked 2026-10-21): PoolManager 0x188d…9ea8e (24,009 bytes); most liquidity in nad.fun graduated pools
  // (Uniswap v3 and v2 events) quoted in WMON. No Blockscout; honeypot.is answers "Invalid chain"; GoPlus counts
  // holders and decides the sell. Tenderly serves 1k-block eth_getLogs, rpc.monad.xyz 100.
  143: {
    name: "Monad", dex: "monad",
    rpcUrls: ["https://monad.gateway.tenderly.co", "https://rpc.monad.xyz"],
    blockscout: null, honeypot: false,
    poolManager: "0x188d586ddcf52439676ca21a244753fa19f9ea8e", fullScanWindow: null, goplus: true,
    wrappedNative: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
  },
  56: { name: "BNB Chain", dex: "bsc", rpcUrls: ["https://bsc-dataseed.bnbchain.org"], blockscout: null, honeypot: true, poolManager: null, fullScanWindow: null },
};

/** Past this many Transfer logs the replay stops and holders stay unmeasured. */
const MAX_REPLAY_LOGS = 300_000;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 160);

/** GET JSON with a timeout and three tries; an HTML answer (Cloudflare challenge) is an error, not data. */
export async function fetchJson(url: string, tries = 3): Promise<any> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
      const text = await res.text();
      if (!text.trimStart().startsWith("{") && !text.trimStart().startsWith("[")) {
        throw new Error(`HTTP ${res.status}, not JSON${/challenge|Just a moment/i.test(text) ? " (Cloudflare challenge)" : ""}`);
      }
      const j = JSON.parse(text);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(j).slice(0, 120)}`);
      return j;
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(800 * 2 ** i);
    }
  }
  throw last;
}

function clientFor(chainId: number, c: ChainInfo): PublicClient {
  const chain = defineChain({ id: chainId, name: c.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: c.rpcUrls } } });
  return createPublicClient({ chain, transport: http(c.rpcUrls[0], { timeout: 30_000, retryCount: 2 }) }) as PublicClient;
}

export async function dexPair(c: ChainInfo, pool: string): Promise<DexPair> {
  const j = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${c.dex}/${pool}`);
  const raw = (j?.pairs ?? []).find((p: any) => String(p?.pairAddress).toLowerCase() === pool.toLowerCase());
  const pair = parseDexPair(raw);
  if (!pair) throw new Error(`pool ${pool} not found on DexScreener (${c.dex})`);
  return pair;
}

async function earliestPairTime(c: ChainInfo, token: string): Promise<number | null> {
  const j = await fetchJson(`https://api.dexscreener.com/token-pairs/v1/${c.dex}/${token}`);
  const times = (Array.isArray(j) ? j : []).map(parseDexPair).flatMap((p) => (p?.pairCreatedAt ? [p.pairCreatedAt] : []));
  return times.length ? Math.min(...times) : null;
}

async function blockscoutCreation(base: string, token: string): Promise<number | null> {
  const a = await fetchJson(`${base}/api/v2/addresses/${token}`);
  const hash = a?.creation_transaction_hash ?? a?.creation_tx_hash;
  if (!hash) return null;
  const tx = await fetchJson(`${base}/api/v2/transactions/${hash}`);
  const t = Date.parse(tx?.timestamp ?? "");
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

interface Replay { transfers: (Transfer & { block: bigint })[]; firstAt: number | null }

/** Every Transfer log of the token, [0, head], windows split on range errors. */
async function replayTransfers(client: PublicClient, token: `0x${string}`, window: bigint): Promise<Replay> {
  const head = await client.getBlockNumber();
  const out: (Transfer & { block: bigint })[] = [];
  const read = async (from: bigint, to: bigint): Promise<void> => {
    try {
      const logs = await client.getLogs({ address: token, event: TRANSFER, fromBlock: from, toBlock: to, strict: true });
      for (const l of logs) out.push({ from: l.args.from!, to: l.args.to!, value: l.args.value!, block: l.blockNumber });
    } catch (e) {
      if (to - from < 1_000n) throw e;
      const mid = from + (to - from) / 2n;
      await read(from, mid);
      await read(mid + 1n, to);
    }
    if (out.length > MAX_REPLAY_LOGS) throw new Error(`more than ${MAX_REPLAY_LOGS} Transfer logs`);
  };
  for (let from = 0n; from <= head; from += window) await read(from, from + window - 1n > head ? head : from + window - 1n);
  // Robinhood's RPC returns blockTimestamp 0x0 on logs, so the first block's time is read separately.
  const firstAt = out.length ? Number((await client.getBlock({ blockNumber: out[0].block })).timestamp) : null;
  return { transfers: out, firstAt };
}

/** A recent holder's transfer of a tenth of its balance into the pool, as eth_call: the token side of a sell. */
async function transferIntoPool(client: PublicClient, token: `0x${string}`, sink: `0x${string}`, replay: Replay, exclude: string[]): Promise<{ sim: SellSim; note: string } | null> {
  const bal = holderBalances(replay.transfers);
  const skip = new Set(exclude.map((a) => a.toLowerCase()));
  const tried: string[] = [];
  for (let i = replay.transfers.length - 1; i >= 0 && tried.length < 10; i--) {
    const who = replay.transfers[i].to.toLowerCase();
    if (skip.has(who) || tried.includes(who) || !(bal.get(who) ?? 0n)) continue;
    tried.push(who);
    // A plain wallet, like a seller; a contract holder (treasury, router, vault) may be whitelisted.
    if (await client.getCode({ address: who as `0x${string}` })) continue;
    const onChain = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who as `0x${string}`] });
    if (onChain === 0n) continue;
    const amount = onChain / 10n || onChain;
    try {
      await client.call({ account: who as `0x${string}`, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [sink, amount] }) });
      return { sim: { ok: true, full: false, sellTaxPct: null }, note: `${who} -> ${sink} transfer succeeds; no full sell simulator on this chain` };
    } catch (e) {
      return { sim: { ok: false, full: false, sellTaxPct: null }, note: `${who} -> ${sink} transfer reverts: ${errMsg(e)}` };
    }
  }
  return null;
}

/** All five numbers for one pool. Throws only when the pool itself cannot be resolved. */
export async function measure(chainId: number, pool: string, tokenArg?: string): Promise<Measurements> {
  const c = CHAINS[chainId];
  if (!c) throw new Error(`chain ${chainId} not supported (known: ${Object.keys(CHAINS).join(", ")})`);
  const pair = await dexPair(c, pool);
  const tok = pickToken(pair, tokenArg);
  const token = tok.address as `0x${string}`;
  const dexSrc = `DexScreener pairs/${c.dex}/${pair.pairAddress}`;
  const notes: Record<string, string[]> = { holders: [], age: [], sell: [] };
  const attempt = async <T>(key: string, label: string, f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch (e) {
      notes[key].push(`${label}: ${errMsg(e)}`);
      return null;
    }
  };

  const [pairsAt, hp, bsHolders, bsCreated] = await Promise.all([
    attempt("age", "DexScreener token-pairs", () => earliestPairTime(c, token)),
    c.honeypot ? attempt("sell", "honeypot.is", async () => parseHoneypot(await fetchJson(`https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=${chainId}`))) : Promise.resolve(null as HoneypotResult | null),
    c.blockscout ? attempt("holders", "Blockscout counters", async () => parseBlockscoutCounters(await fetchJson(`${c.blockscout}/api/v2/tokens/${token}/counters`))) : Promise.resolve(null),
    c.blockscout ? attempt("age", "Blockscout creation", () => blockscoutCreation(c.blockscout!, token)) : Promise.resolve(null),
  ]);

  // Holders: Blockscout, then honeypot.is, then a full Transfer replay on chains where that is cheap.
  let holders: Measured<number> = { value: null, source: "none" };
  if (bsHolders !== null) holders = { value: bsHolders, source: `Blockscout ${c.blockscout}` };
  else if (hp?.holders != null) holders = { value: hp.holders, source: "honeypot.is totalHolders" };
  // GoPlus token_security, read at most once: holders (chains with `goplus`) and the automatic sell verdict.
  let goplusJson: Promise<any | null> | null = null;
  const goplus = (key: string) =>
    (goplusJson ??= attempt(key, "GoPlus token_security", () => fetchJson(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${token}`)));
  if (holders.value === null && c.goplus) {
    const g = await goplus("holders");
    const h = g ? parseGoPlus(g, token).holders : null;
    if (h != null) holders = { value: h, source: "GoPlus token_security holder_count" };
  }
  const client = c.fullScanWindow ? clientFor(chainId, c) : null;
  let replay: Replay | null = null;
  if (client && (holders.value === null || !c.honeypot)) {
    replay = await attempt("holders", "Transfer replay", () => replayTransfers(client, token, c.fullScanWindow!));
    if (replay && holders.value === null) holders = { value: holderBalances(replay.transfers).size, source: `Transfer-log replay over ${c.rpcUrls[0]}` };
  }
  if (holders.value === null) holders = { value: null, source: "Blockscout / honeypot.is / Transfer replay", note: notes.holders.join("; ") || "no holder source for this chain" };

  const createdAt = earliest([
    { at: bsCreated, source: "Blockscout creation tx" },
    { at: replay?.firstAt ?? null, source: "first Transfer log" },
    { at: pairsAt, source: "DexScreener earliest pairCreatedAt" },
    { at: hp?.pairCreatedAt ?? null, source: "honeypot.is pair creation" },
  ]);
  if (createdAt.value === null) createdAt.note = notes.age.join("; ") || createdAt.note;

  // Sell: honeypot.is's buy+sell simulation when it ran. Otherwise (no simulator on this chain, honeypot.is has no
  // such pair, or it failed) decided automatically, no owner step: a holder's transfer into the pool that reverts
  // fails at once (chains with the replay); else GoPlus token_security's static verdict (eligibility.ts goplusSell);
  // no GoPlus data -> unmeasured, refused ("could not verify sells automatically").
  let sell: Measured<SellSim> = { value: null, source: "none" };
  if (hp?.sell) sell = { value: hp.sell, source: "honeypot.is simulation", note: hp.note ?? undefined };
  else {
    const why = c.honeypot ? `honeypot.is: ${hp?.note ?? (notes.sell.join("; ") || "no simulation")}` : `no sell simulator for ${c.name}`;
    let partial: { sim: SellSim; note: string } | null = null;
    if (client && replay) {
      const sink = (pair.labels.includes("v4") ? c.poolManager : pair.pairAddress) as `0x${string}` | null;
      partial = sink ? await attempt("sell", "transfer simulation", () => transferIntoPool(client, token, sink, replay!, [sink, pair.pairAddress, token])) : null;
    }
    if (partial && !partial.sim.ok) sell = { value: partial.sim, source: "eth_call transfer into the pool", note: partial.note };
    else {
      const g = await goplus("sell");
      const verdict = g ? goplusSell(g, token, RULES.maxSellTaxPct) : null;
      const extra = partial ? `; ${partial.note}` : "";
      sell = verdict
        ? { value: verdict.sim, source: `GoPlus token_security${partial ? " + eth_call transfer into the pool" : ""}`, note: `${verdict.note} (${why})${extra}` }
        : { value: null, source: "GoPlus token_security", note: `could not verify sells automatically: ${why}; GoPlus has no usable data for this token${extra}` };
    }
  }

  return {
    chainId, pool: pair.pairAddress, token, symbol: tok.symbol || null,
    // DexScreener's marketCap is the base token's: a station for the quote side gets no number from this pair.
    marketCapUsd: tok === pair.base
      ? { value: pair.marketCapUsd, source: dexSrc, note: pair.marketCapUsd === null ? "DexScreener has no marketCap for this pair" : undefined }
      : { value: null, source: dexSrc, note: `${tok.symbol} is the pair's quote token; its marketCap is ${pair.base.symbol}'s` },
    liquidityUsd: { value: pair.liquidityUsd, source: dexSrc, note: pair.liquidityUsd === null ? "DexScreener has no liquidity.usd for this pair" : undefined },
    holders, createdAt, sell,
  };
}
