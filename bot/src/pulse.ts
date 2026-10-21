// Pulse keeper: when the hook has been silent for >= 15 min, calls PulseTreasury.pulse() so the track keeps playing.
// pulse() is permissionless and the contract enforces every rule (idle, size, budget, no zero fill); the keeper only
// pays gas. Dry-run by default: it reads nextPulse() and logs what it would send.
//
// Env:
//   PULSE_TREASURY   treasury address (required; empty = keeper idles)
//   LIVE_RPC_URL     RPC of the launch chain (required)
//   LIVE_CHAIN_ID    default 4663 (Robinhood Chain)
//   PULSE_SEND       "true" to send transactions; anything else = dry run (default)
//   PULSE_KEY        hot-wallet private key, read ONLY from env and ONLY when PULSE_SEND=true; never logged
//   PULSE_TICK_SEC   poll interval, default 60
//   FEE_FACTORY      LaunchFactory that seeded the pool (Robinhood 0xa25b02a1e93903b790e6aaf7da1b8b8d50294645)
//   LAUNCH_NUMBER    the launch's launchNumber (GET /launches/:id); with FEE_FACTORY enables the fee harvest
//   HARVEST_HOURS    hours between claimFees calls, default 24
//   FEE_SPLITTER     FeeSplitter that receives the fee (setRequester target); split() runs right after each harvest
//   BURN_HOURS       hours between treasury.burn() calls (sends all its IDM to 0x…dEaD), default 24; 0 = off
//
// Harvest: the factory's claimFees(launchNumber) pays out the pool fee, and anyone may call it. After the owner's
// setRequester(launchNumber, treasury) the 1% launcher share is pushed to the treasury (its receive() takes ETH,
// IDM arrives by transfer), so the keeper calling it once a day keeps the pulse budget topped up. With FEE_SPLITTER
// the fee goes to the splitter instead, and split() right after the harvest sends half the ETH to the treasury, half
// to the team, and burns all the IDM. The selector
// was read from the factory's bytecode (its source is not verified): the call is simulated before it is sent.
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PULSE_IDLE_SEC } from "@swarm-sequencer/core";

export const FACTORY_ABI = parseAbi(["function claimFees(uint64 launchNumber)"]);
export const SPLITTER_ABI = parseAbi(["function split() returns (uint256 toTreasury, uint256 toTeam, uint256 burned)"]);

export const TREASURY_ABI = parseAbi([
  "function nextPulse() view returns (bool ready, uint256 amount, uint256 idleSec, uint8 heat)",
  "function pulse() returns (uint256 amountIn, uint256 amountOut)",
  "function burn()",
  "function idm() view returns (address)",
]);

const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface PulseConfig {
  treasury: `0x${string}`;
  rpcUrl: string;
  chainId: number;
  send: boolean;
  tickSec: number;
  harvest: { factory: `0x${string}`; launchNumber: bigint; everySec: number } | null;
  /** FeeSplitter to split() after each harvest; null = the fee goes straight to the treasury. */
  splitter: `0x${string}` | null;
  /** Seconds between burn() calls; 0 = off. */
  burnEverySec: number;
}

export interface NextPulse { ready: boolean; amount: bigint; idleSec: bigint; heat: number }

/** Config without the key: the key is read separately, at send time, and never stored in this object. */
export function pulseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PulseConfig | null {
  const treasury = env.PULSE_TREASURY as `0x${string}` | undefined;
  const rpcUrl = env.LIVE_RPC_URL;
  if (!treasury || !rpcUrl) return null;
  return {
    treasury,
    rpcUrl,
    chainId: Number(env.LIVE_CHAIN_ID ?? 4663),
    send: (env.PULSE_SEND ?? "").toLowerCase() === "true",
    tickSec: Number(env.PULSE_TICK_SEC ?? 60),
    // HARVEST_HOURS unset = 24 h; set but empty or 0 = harvest off (an empty value once meant "every 0 h").
    harvest:
      env.FEE_FACTORY && env.LAUNCH_NUMBER && Number(env.HARVEST_HOURS ?? 24) > 0
        ? { factory: env.FEE_FACTORY as `0x${string}`, launchNumber: BigInt(env.LAUNCH_NUMBER), everySec: Number(env.HARVEST_HOURS ?? 24) * 3600 }
        : null,
    splitter: (env.FEE_SPLITTER as `0x${string}` | undefined) || null,
    burnEverySec: Number(env.BURN_HOURS ?? 24) * 3600,
  };
}

export type PulseAction = { act: "wait"; reason: string } | { act: "pulse"; amount: bigint; idleSec: bigint; heat: number };

/** Pure decision from the contract's own view; mirrors pulse()'s revert conditions. */
export function decidePulse(n: NextPulse): PulseAction {
  if (n.idleSec < BigInt(PULSE_IDLE_SEC)) return { act: "wait", reason: `idle ${n.idleSec}s < ${PULSE_IDLE_SEC}s` };
  if (n.amount === 0n) return { act: "wait", reason: "no budget (1% of balance under the dust floor)" };
  if (!n.ready) return { act: "wait", reason: "not ready" };
  return { act: "pulse", amount: n.amount, idleSec: n.idleSec, heat: n.heat };
}

const eth = (wei: bigint) => `${Number(wei / 10n ** 9n) / 1e9} ETH`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[pulse]", ...a);

function chainFor(c: PulseConfig) {
  return defineChain({
    id: c.chainId,
    name: c.chainId === 4663 ? "Robinhood Chain" : `chain-${c.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
  });
}

export async function readNext(client: PublicClient, treasury: `0x${string}`): Promise<NextPulse> {
  const [ready, amount, idleSec, heat] = await client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: "nextPulse" });
  return { ready, amount, idleSec, heat: Number(heat) };
}

/** One keeper step. Returns the tx hash when it sent one. */
export async function pulseTick(c: PulseConfig, client: PublicClient, env: NodeJS.ProcessEnv = process.env): Promise<`0x${string}` | null> {
  const action = decidePulse(await readNext(client, c.treasury));
  if (action.act === "wait") return log(`wait: ${action.reason}`), null;
  const what = `pulse ${eth(action.amount)} after ${action.idleSec}s idle, heat ${action.heat}`;
  if (!c.send) return log(`DRY RUN would send ${what}`), null;
  const account = sendAccount(env);
  // Simulate first: a race with a real swap or another keeper reverts here (NotIdle) instead of on chain.
  const { request } = await client.simulateContract({ address: c.treasury, abi: TREASURY_ABI, functionName: "pulse", account });
  const wallet = createWalletClient({ account, chain: chainFor(c), transport: http(c.rpcUrl) });
  const hash = await send(client, wallet, request);
  log(`sent ${what} from ${account.address}: ${hash}`);
  const { status } = await client.waitForTransactionReceipt({ hash });
  if (status !== "success") log(`pulse ${hash} reverted on chain`);
  return hash;
}

/** Sends with the gas estimate + 30%. A pulse's swap can cross more ticks than when it was estimated, and a bare
 *  estimate once ran out of gas on chain (119,765 of 122,645). */
async function send(client: PublicClient, wallet: { writeContract: (r: any) => Promise<`0x${string}`> }, request: any) {
  const gas = ((await client.estimateContractGas(request)) * 13n) / 10n;
  return wallet.writeContract({ ...request, gas });
}

/** Reads PULSE_KEY at send time only; never stored or logged. */
function sendAccount(env: NodeJS.ProcessEnv) {
  const key = env.PULSE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("PULSE_SEND=true needs PULSE_KEY (0x + 64 hex) in env");
  return privateKeyToAccount(key as `0x${string}`);
}

/** Calls the factory's claimFees when `everySec` has passed since `lastAt` (unix s). Returns the new lastAt. */
export async function harvestTick(c: PulseConfig, client: PublicClient, lastAt: number, now = Date.now() / 1000, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const h = c.harvest;
  if (!h || now - lastAt < h.everySec) return lastAt;
  const what = `claimFees(${h.launchNumber}) on ${h.factory}`;
  if (!c.send) return log(`DRY RUN would call ${what}${c.splitter ? `, then split() on ${c.splitter}` : ""}`), now;
  const account = sendAccount(env);
  const { request } = await client.simulateContract({ address: h.factory, abi: FACTORY_ABI, functionName: "claimFees", args: [h.launchNumber], account });
  const wallet = createWalletClient({ account, chain: chainFor(c), transport: http(c.rpcUrl) });
  const hash = await send(client, wallet, request);
  log(`sent ${what} from ${account.address}: ${hash}`);
  if (c.splitter) {
    // split() only after the payout is mined, so it sees the fresh balances.
    await client.waitForTransactionReceipt({ hash });
    const sim = await client.simulateContract({ address: c.splitter, abi: SPLITTER_ABI, functionName: "split", account });
    const [toTreasury, toTeam, burned] = sim.result;
    log(`sent split on ${c.splitter}: ${eth(toTreasury)} to treasury, ${eth(toTeam)} to team, ${Number(burned / 10n ** 15n) / 1e3} IDM burned: ${await send(client, wallet, sim.request)}`);
  }
  return now;
}

/** Burns the treasury's IDM (bought by pulses plus the IDM half of the fee) every `burnEverySec`. Returns the new lastAt. */
export async function burnTick(c: PulseConfig, client: PublicClient, lastAt: number, now = Date.now() / 1000, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (!c.burnEverySec || now - lastAt < c.burnEverySec) return lastAt;
  const idm = await client.readContract({ address: c.treasury, abi: TREASURY_ABI, functionName: "idm" });
  const bal = await client.readContract({ address: idm, abi: ERC20_ABI, functionName: "balanceOf", args: [c.treasury] });
  if (bal === 0n) return log("burn: nothing to burn"), now;
  const what = `burn ${Number(bal / 10n ** 15n) / 1e3} IDM to 0x…dEaD`;
  if (!c.send) return log(`DRY RUN would ${what}`), now;
  const account = sendAccount(env);
  const { request } = await client.simulateContract({ address: c.treasury, abi: TREASURY_ABI, functionName: "burn", account });
  const wallet = createWalletClient({ account, chain: chainFor(c), transport: http(c.rpcUrl) });
  log(`sent ${what} from ${account.address}: ${await send(client, wallet, request)}`);
  return now;
}

async function main() {
  const c = pulseConfigFromEnv();
  if (!c) return log("PULSE_TREASURY or LIVE_RPC_URL unset: nothing to keep (treasury not deployed yet)");
  const client = createPublicClient({ chain: chainFor(c), transport: http(c.rpcUrl, { retryCount: 3 }) }) as PublicClient;
  log(`starting; treasury ${c.treasury}; chain ${c.chainId}; ${c.send ? "SENDING" : "dry run"}; tick ${c.tickSec}s`);
  if (c.harvest) log(`harvest: claimFees(${c.harvest.launchNumber}) every ${c.harvest.everySec / 3600} h`);
  let harvestedAt = 0;
  let burnedAt = 0;
  for (;;) {
    try { await pulseTick(c, client); } catch (e) { log("tick failed:", (e as Error).message); }
    try { harvestedAt = await harvestTick(c, client, harvestedAt); } catch (e) { harvestedAt = Date.now() / 1000; log("harvest failed:", (e as Error).message); }
    // After the harvest, so the IDM half of a fresh payout burns the same day.
    try { burnedAt = await burnTick(c, client, burnedAt); } catch (e) { burnedAt = Date.now() / 1000; log("burn failed:", (e as Error).message); }
    await new Promise((r) => setTimeout(r, c.tickSec * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
