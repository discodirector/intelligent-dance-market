// Sepolia swap simulator for the self-deployed SequencerHook pools.
//   npm run sim -- --profile busy --count 40 --interval 20s [--seed 7] [--dry]       # v1: IDM/IMD hook (sepolia.json)
//   npm run sim -- --net v2 --profile track                                           # v2: IDM/ETH hook (sepolia-v2.json)
//   npm run sim -- --profile smoke            # all profiles in sequence (calm, busy, whale, selloff, random)
// Every swap: tx hash, decoded Mutated event (packages/core decode) and a parity check that the on-chain
// slot0/slot1 equal packages/core mutate() applied to the previous on-chain state.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, decodeEventLog, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { decode, encode, ETH_THRESHOLDS, mutate, MODE_NAMES, NOTE_NAMES, TRACK_NAMES, V2_RULES, V2_SLOTS, type State, type Thresholds } from "@swarm-sequencer/core";
import { loadDeployment, loadEnv, type Net } from "./env.ts";
import { erc20Abi, hookAbi, routerAbi } from "./abi.ts";
import { plan, profilesFor, type Trade } from "./profiles.ts";

const MIN_SQRT = 4295128739n + 1n;
const MAX_SQRT = 1461446703485210103287273052203988822378723970342n - 1n;

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
function parseInterval(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!m) throw new Error(`bad --interval ${s}`);
  return Number(m[1]) * (m[2] === "ms" ? 1 : m[2] === "m" ? 60_000 : 1000);
}
const hex = (v: bigint) => "0x" + v.toString(16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const net = (arg("net", "v1") as Net);
if (net !== "v1" && net !== "v2") throw new Error("--net must be v1 or v2");
const v2 = net === "v2";
const PROFILES = profilesFor(net);
if (process.argv.includes("--dry")) {
  // Plan only: needs no key, RPC or deployment record.
  const profile = arg("profile", "random")!;
  if (!PROFILES[profile]) throw new Error(`unknown profile ${profile}; one of ${Object.keys(PROFILES).join(", ")}`);
  const trades = plan(profile, Number(arg("count", String(PROFILES[profile].defaultCount))), Number(arg("seed", "1")), net);
  const buys = trades.filter((t) => t.side === "buy").reduce((n, t) => n + t.amount, 0);
  const sells = trades.filter((t) => t.side === "sell").reduce((n, t) => n + t.amount, 0);
  console.table(trades);
  console.log(`[sim] ${net} ${profile}: ${trades.length} swaps · buys pay ${buys.toFixed(4)} · sells receive ${sells.toFixed(4)} (${net === "v2" ? "ETH" : "IMD"})`);
  process.exit(0);
}
const env = loadEnv();
const dep = loadDeployment(net);
// v1: IMD test token (ERC20); v2: native ETH, always currency0.
const native = v2 && BigInt(dep.quote ?? 0) === 0n;
const SYM = dep.quoteSymbol ?? (v2 ? "ETH" : "IMD");
const slotOpts = v2 ? V2_SLOTS : undefined;
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== dep.deployer.toLowerCase()) throw new Error("key does not match deployments/sepolia.json deployer");
const transport = http(env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { retryCount: 4, timeout: 60_000 });
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account });
const thresholds: Thresholds = {
  hat: BigInt(dep.thresholds.hat),
  glitch: BigInt(dep.thresholds.glitch),
  snare: BigInt(dep.thresholds.snare),
  // v1 hook: its constructor kick. v2: unused, the whale threshold comes from the tick (V2_RULES.fdvWhale).
  kick: BigInt(dep.thresholds.kick ?? ETH_THRESHOLDS.kick),
};
const quoteAddr = (native ? "0x0000000000000000000000000000000000000000" : (dep.quote ?? dep.imd)!) as `0x${string}`;
const quoteIs0 = dep.poolKey.currency0.toLowerCase() === quoteAddr.toLowerCase();

async function readState(blockNumber?: bigint): Promise<State> {
  const [s0, s1] = await pub.readContract({ address: dep.hook, abi: hookAbi, functionName: "raw", blockNumber });
  return decode(s0, s1, slotOpts);
}

async function ensureQuote(needed: bigint) {
  if (native) {
    const bal = await pub.getBalance({ address: account.address });
    if (bal < needed + parseEther("0.01")) throw new Error(`wallet has ${formatEther(bal)} ETH, needs ${formatEther(needed)} + gas`);
    return;
  }
  const bal = await pub.readContract({ address: quoteAddr, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (bal >= needed) return;
  const amount = needed - bal + parseEther("10000");
  const tx = await wallet.writeContract({ address: quoteAddr, abi: erc20Abi, functionName: "mint", args: [account.address, amount] });
  await pub.waitForTransactionReceipt({ hash: tx });
  console.log(`  minted ${formatEther(amount)} test IMD (${tx})`);
}

const describeState = (s: State) =>
  `bpm ${s.bpm} · ${NOTE_NAMES[s.root]} ${MODE_NAMES[s.mode]} · swap #${s.swapCount} · page #${s.patternId} · pressure ${s.pressure}` +
  (v2 ? ` · heat ${s.heat}/16 · track #${s.trackNo} · sizeLogEma ${s.sizeLogEma}` : "");

interface SwapRecord {
  n: number;
  profile: string;
  side: "buy" | "sell";
  /** Requested quote amount (IMD on v1, ETH on v2). */
  quoteRequested: string;
  txHash: Hex;
  block: number;
  timestamp: number;
  gasUsed: string;
  event?: Record<string, unknown>;
  movement?: { patternId: number; root: number; swapCount: number };
  drop?: { track: number; fill: boolean; mask: number; maskBits: string };
  trackComplete?: { trackNo: number; patternId: number; root: number; swapCount: number };
  state?: Record<string, unknown>;
  expected?: { slot0: string; slot1: string };
  actual?: { slot0: string; slot1: string };
  parity: "match" | "mismatch" | "error";
  notes?: string[];
}

async function execute(t: Trade, n: number, prev: State): Promise<{ rec: SwapRecord; next: State }> {
  const amt = parseEther(t.amount.toString());
  const isBuy = t.side === "buy";
  if (isBuy) await ensureQuote(amt);
  // buy  = pay exact quote in  -> receive IDM  (input currency = quote; native ETH goes as msg.value)
  // sell = pay IDM, receive exact quote out     (input currency = IDM)
  const zeroForOne = isBuy ? quoteIs0 : !quoteIs0;
  const amountSpecified = isBuy ? -amt : amt;
  const txHash = await wallet.writeContract({
    address: dep.router,
    abi: routerAbi,
    functionName: "swap",
    args: [dep.poolKey, zeroForOne, amountSpecified, zeroForOne ? MIN_SQRT : MAX_SQRT],
    value: native && isBuy ? amt : 0n,
    // The hook's step comes from a hash over block.number, so the path (scan, Accumulated, TrackComplete) and its gas
    // differ between the block an estimate ran on and the block that mines it: ~9k spread on a ~175k swap. An exact
    // estimate ran out of gas 6 times in the first Sepolia v2 run; unused gas is refunded.
    gas: 300_000n,
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
  const block = await pub.getBlock({ blockNumber: rcpt.blockNumber });
  const rec: SwapRecord = {
    n, profile: t.profile, side: t.side, quoteRequested: t.amount.toString(), txHash,
    block: Number(rcpt.blockNumber), timestamp: Number(block.timestamp), gasUsed: rcpt.gasUsed.toString(), parity: "error",
  };
  if (rcpt.status !== "success") { rec.notes = ["tx reverted"]; return { rec, next: prev }; }

  let ev: any;
  for (const log of rcpt.logs) {
    if (log.address.toLowerCase() !== dep.hook.toLowerCase()) continue;
    const d = decodeEventLog({ abi: hookAbi, data: log.data, topics: log.topics });
    if (d.eventName === "Mutated") ev = d.args;
    if (d.eventName === "Movement") rec.movement = { patternId: d.args.patternId, root: d.args.root, swapCount: d.args.swapCount };
    if (d.eventName === "Drop")
      rec.drop = { track: d.args.track, fill: d.args.fill, mask: d.args.mask, maskBits: d.args.mask.toString(2).padStart(16, "0") };
    if (d.eventName === "TrackComplete")
      rec.trackComplete = { trackNo: d.args.trackNo, patternId: d.args.patternId, root: d.args.root, swapCount: d.args.swapCount };
  }
  if (!ev) { rec.notes = ["no Mutated event"]; return { rec, next: prev }; }

  const notes: string[] = [];
  // Another actor may have swapped in between: resync from the state at the previous block's end is not enough
  // (same-block ordering), so require a contiguous swapCount and otherwise rebase on the event stream.
  if (ev.swapCount !== ((prev.swapCount + 1) >>> 0)) {
    notes.push(`swapCount gap (${prev.swapCount} -> ${ev.swapCount}); rebased on previous Mutated log`);
    const logs = await pub.getContractEvents({ address: dep.hook, abi: hookAbi, eventName: "Mutated", args: { swapCount: (ev.swapCount - 1) >>> 0 }, fromBlock: BigInt(dep.startBlock) });
    const p = logs.at(-1)?.args;
    if (p) prev = decode(p.slot0!, p.slot1!, slotOpts);
  }
  if (ev.isBuy !== isBuy) notes.push(`isBuy on-chain ${ev.isBuy} != intended ${isBuy}`);
  if (ev.quoteAmount !== amt) notes.push(`quoteAmount ${ev.quoteAmount} != requested ${amt}`);

  const { state: exp, event: expEv } = mutate(
    prev,
    { isBuy: ev.isBuy, quoteAmt: ev.quoteAmount, tick: ev.tick, blockNumber: rcpt.blockNumber, timestamp: block.timestamp },
    thresholds,
    v2 ? { ...V2_RULES, fdvWhale: { quoteIs0 } } : undefined,
  );
  const expected = encode(exp, slotOpts);
  const [s0, s1] = await pub.readContract({ address: dep.hook, abi: hookAbi, functionName: "raw", blockNumber: rcpt.blockNumber });
  const slotsOk = expected.slot0 === ev.slot0 && expected.slot1 === ev.slot1;
  const eventOk = expEv.track === ev.track && expEv.step === ev.step && expEv.bassNote === ev.bassNote && expEv.on === ev.on;
  const movementOk = !!expEv.movement === !!rec.movement && (!rec.movement || (expEv.movement!.root === rec.movement.root && expEv.movement!.swapCount === rec.movement.swapCount));
  const rawOk = s0 === ev.slot0 && s1 === ev.slot1; // raw() at block end (valid when ours is the block's last swap)
  if (!eventOk) notes.push("event fields differ from mutate()");
  if (!movementOk) notes.push("Movement differs from mutate()");
  const dropOk =
    !!expEv.drop === !!rec.drop &&
    (!rec.drop || (expEv.drop!.track === rec.drop.track && expEv.drop!.fill === rec.drop.fill && expEv.drop!.mask === rec.drop.mask));
  if (!dropOk) notes.push(`Drop differs from mutate() (expected ${JSON.stringify(expEv.drop ?? null)})`);
  if (!rawOk) notes.push("raw() at block != event slots (later swap in same block?)");
  const tcOk =
    !!expEv.trackComplete === !!rec.trackComplete &&
    (!rec.trackComplete || (expEv.trackComplete!.trackNo === rec.trackComplete.trackNo && expEv.trackComplete!.root === rec.trackComplete.root));
  if (!tcOk) notes.push(`TrackComplete differs from mutate() (expected ${expEv.trackComplete ? `#${expEv.trackComplete.trackNo}` : "none"})`);

  const st = decode(ev.slot0, ev.slot1, slotOpts);
  rec.event = {
    sender: ev.sender, swapCount: ev.swapCount, track: TRACK_NAMES[ev.track], step: ev.step, on: ev.on, bassNote: ev.bassNote,
    isBuy: ev.isBuy, quoteAmount: `${formatEther(ev.quoteAmount)} ${SYM}`, tick: ev.tick,
  };
  rec.state = { ...st, pattern: hex(st.pattern), bass: hex(st.bass) };
  rec.expected = { slot0: hex(expected.slot0), slot1: hex(expected.slot1) };
  rec.actual = { slot0: hex(ev.slot0), slot1: hex(ev.slot1) };
  rec.parity = slotsOk && eventOk && movementOk && dropOk && tcOk ? "match" : "mismatch";
  if (notes.length) rec.notes = notes;
  return { rec, next: st };
}

async function main() {
  const profile = arg("profile", "random")!;
  const names = profile === "smoke" ? ["calm", "busy", "whale", "selloff", "random"] : [profile];
  for (const p of names) if (!PROFILES[p]) throw new Error(`unknown profile ${p}; one of ${Object.keys(PROFILES).join(", ")}, smoke`);
  const count = arg("count") ? Number(arg("count")) : undefined;
  const seed = Number(arg("seed", String(Date.now() % 1e9)));
  const trades = names.flatMap((p, i) => plan(p, profile === "smoke" ? (count ?? PROFILES[p].defaultCount) : count ?? PROFILES[p].defaultCount, seed + i, net));
  const interval = arg("interval");

  console.log(`[sim] sepolia ${net} hook ${dep.hook} pool ${dep.poolId} · quote ${SYM}${native ? " (native)" : ""}`);
  console.log(`[sim] wallet ${account.address} · ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
  console.log(`[sim] profile ${profile} · ${trades.length} swaps · seed ${seed}`);

  let state = await readState();
  console.log(`[sim] start: ${describeState(state)}`);
  const started = new Date();
  const records: SwapRecord[] = [];
  const runsDir = fileURLToPath(new URL("../runs/", import.meta.url));
  mkdirSync(runsDir, { recursive: true });
  const file = runsDir + started.toISOString().replace(/[:.]/g, "-") + ".json";
  const save = () => {
    const matched = records.filter((r) => r.parity === "match").length;
    writeFileSync(file, JSON.stringify({
      startedAt: started.toISOString(), finishedAt: new Date().toISOString(), profile, seed, chainId: 11155111,
      net, quote: SYM, hook: dep.hook, poolId: dep.poolId, router: dep.router, wallet: account.address,
      summary: {
        swaps: records.length, matched, mismatched: records.filter((r) => r.parity === "mismatch").length,
        errors: records.filter((r) => r.parity === "error").length,
        whales: records.filter((r) => r.movement).length,
        fills: records.filter((r) => r.drop?.fill).length,
        drops: records.filter((r) => r.drop && !r.drop.fill).length,
        tracksCompleted: records.filter((r) => r.trackComplete).length,
        gasUsed: records.reduce((n, r) => n + BigInt(r.gasUsed), 0n).toString(),
        pagesCrossed: records.length ? (records.at(-1)!.state?.patternId as number ?? 0) - (records[0].state?.patternId as number ?? 0) : 0,
        finalState: records.at(-1)?.state,
      },
      swaps: records,
    }, null, 2) + "\n");
  };

  for (const [i, t] of trades.entries()) {
    try {
      const { rec, next } = await execute(t, i + 1, state);
      records.push(rec);
      state = next;
      const e = rec.event as any;
      console.log(
        `#${String(i + 1).padStart(3)} ${t.profile.padEnd(7)} ${t.side.padEnd(4)} ${t.amount.toString().padStart(8)} ${SYM}  ${rec.txHash}` +
          (e ? `\n      Mutated swap #${e.swapCount} ${e.track}[${e.step}] ${e.on ? "on" : "off"} bass ${e.bassNote} tick ${e.tick}` : "") +
          (rec.movement ? `  MOVEMENT root→${NOTE_NAMES[rec.movement.root]} page #${rec.movement.patternId}` : "") +
          (rec.drop ? `  ${rec.drop.fill ? "FILL" : "DROP"} ${TRACK_NAMES[rec.drop.track]} ${rec.drop.maskBits}` : "") +
          (rec.trackComplete ? `  TRACK #${rec.trackComplete.trackNo} COMPLETE` : "") +
          `\n      ${describeState(state)}  parity: ${rec.parity.toUpperCase()}${rec.notes ? "  (" + rec.notes.join("; ") + ")" : ""}`,
      );
    } catch (err) {
      console.error(`#${i + 1} failed: ${(err as Error).message.split("\n")[0]}`);
      records.push({ n: i + 1, profile: t.profile, side: t.side, quoteRequested: t.amount.toString(), txHash: "0x", block: 0, timestamp: 0, gasUsed: "0", parity: "error", notes: [(err as Error).message.slice(0, 300)] });
      state = await readState();
    }
    save();
    const wait = interval ? parseInterval(interval) : PROFILES[t.profile].intervalMs;
    if (i < trades.length - 1 && wait > 0) await sleep(wait);
  }
  save();
  const m = records.filter((r) => r.parity === "match").length;
  console.log(`[sim] done: ${records.length} swaps, parity ${m}/${records.length} matched -> ${file}`);
  if (m !== records.length) process.exitCode = 1;
}

await main();
