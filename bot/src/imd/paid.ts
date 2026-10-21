// The IMD paid-request flow (https://imd.fun/docs#paid), shared by the scripts that pay the swarm from the payer's own
// terminal (bot/scripts/imd-launch.ts, bot/scripts/swarm-style.ts): free check -> quote -> 402 challenge -> Permit2
// payment + EIP-712 quote approval -> submit -> poll until admitted.
//
// The payer key is read from a hidden prompt (or IMD_PAYER_KEY) and never printed. Nothing is signed or sent before
// an explicit confirmation: one for the Permit2 approve (if the allowance is short), one typed "pay" for the payment.
// The caller keeps the request token and order id (PaidState) in a gitignored file, so a rerun resumes the same order
// instead of paying twice.
import { randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, http, sha256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";

export const API = process.env.IMD_API ?? "https://api.imd.fun";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// canonical JSON: sorted keys, no whitespace (the docs' paymentHash encoding)
export const canon = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);

export async function api(path: string, init: RequestInit & { token?: string; body?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, { ...init, headers });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

/** Hidden prompt: echoes nothing while the key is typed or pasted. */
// Raw-mode read with no echo: newer Node readline redraws the line and wipes a muted prompt.
export async function secret(question: string) {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("no terminal for the hidden key prompt; set IMD_PAYER_KEY instead");
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  const v = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(buf));
        if (ch === "\u0003") return done(() => reject(new Error("cancelled")));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else if (ch >= " ") buf += ch;
      }
    };
    const done = (f: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      f();
    };
    stdin.on("data", onData);
  });
  return v.trim();
}
export async function ask(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const v = await rl.question(question);
  rl.close();
  return v.trim();
}

export const seconds = (t: number | string) => (Number(t) > 1e12 ? Math.floor(Number(t) / 1000) : Number(t));
const TERMINAL = new Set(["admitted", "rejected", "failed", "refunded", "expired", "cancelled", "payment_failed"]);

/** The free POST /requests/check: what a quote would say (blockers, suggestions, plan, facts), nothing held. */
export async function checkRequest(action: string, input: unknown) {
  const check = await api("/requests/check", { method: "POST", body: JSON.stringify({ action, input }) });
  if (check.status !== 200) throw new Error(`check ${check.status}: ${JSON.stringify(check.json).slice(0, 400)}`);
  return check.json;
}

/** Prints a check's verdict, plan, stated facts and blockers; returns the number of blockers. */
export function printCheck(check: any) {
  const blockers = check.blockers ?? [];
  console.log(`check: ${blockers.length ? "BLOCKED" : "ok"}; plan: ${(check.plan ?? []).map((s: { short?: string; title: string }) => s.short || s.title).join(" > ")}`);
  for (const f of check.facts ?? []) if (f.state === "fixed" || f.state === "stated") console.log(`  · ${f.label}`);
  for (const b of blockers) console.log(`  ✗ ${b.code}: ${b.detail}`);
  return blockers.length;
}

/** What a rerun needs to resume an order: the client's request token, the quote's requestKey, the order once quoted. */
export interface PaidState {
  token: string;
  requestKey: string;
  orderId?: string;
}
export const newPaidState = (): PaidState => ({ token: randomBytes(32).toString("hex"), requestKey: randomUUID() });

export interface PayOptions {
  action: string;
  input: unknown;
  /** The wallet that must pay (lowercase); a key for another address is refused before anything is sent. */
  payer: string;
  /** The order being paid, resumed when it has an orderId. */
  state: PaidState;
  /** Persists the state (called before the quote and once the order exists). */
  save: (state: PaidState) => void;
  /** What the payment opens, for the "pay" prompt: "the launch", "the job". */
  what: string;
}

/**
 * Pays for and submits one paid action. Returns the order to follow (`pollOrder`), or undefined when the payer
 * declined a prompt. An earlier order that is past "quoted" is returned as is, without paying again.
 */
export async function payAndSubmit({ action, input, payer, state, save, what }: PayOptions): Promise<{ orderId: string; token: string } | undefined> {
  const caps = (await api("/requests/capabilities")).json;
  const pay = caps.actions.find((a: { action: string }) => a.action === action).payment;
  if (pay.network !== "eip155:1") throw new Error(`payment network is ${pay.network}; this script pays on Ethereum mainnet only`);
  const amount = BigInt(pay.amount);

  const key = (process.env.IMD_PAYER_KEY || (await secret(`Private key of the payer ${payer} (hidden): `))) as Hex;
  const account = privateKeyToAccount(key.startsWith("0x") ? key : (`0x${key}` as Hex));
  if (account.address.toLowerCase() !== payer) throw new Error(`that key is ${account.address}, expected ${payer} (nothing was sent)`);

  const transport = http(process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com");
  const pub = createPublicClient({ chain: mainnet, transport });
  const wallet = createWalletClient({ account, chain: mainnet, transport });
  const [eth, bal, allowance] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: pay.asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    pub.readContract({ address: pay.asset, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] }),
  ]);
  console.log(`payer ${account.address}: ${formatEther(eth)} ETH, ${formatEther(bal)} IMD, Permit2 allowance ${formatEther(allowance)} IMD; price ${formatEther(amount)} IMD`);
  if (bal < amount) throw new Error("not enough IMD on Ethereum");

  // Permit2 needs an ERC-20 allowance; approve exactly the price, not an unlimited amount.
  if (allowance < amount) {
    if ((await ask(`Send approve(Permit2, ${formatEther(amount)} IMD) on Ethereum? [y/N] `)).toLowerCase() !== "y") return;
    const hash = await wallet.writeContract({ address: pay.asset, abi: erc20Abi, functionName: "approve", args: [PERMIT2, amount] });
    console.log(`approve tx ${hash}`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("approve reverted");
  }

  // Resume an earlier order when there is one; otherwise quote a new one.
  let order: any;
  if (state.orderId) {
    order = (await api(`/requests/${state.orderId}`, { token: state.token })).json;
    order = order.order ?? order;
    console.log(`earlier order ${state.orderId}: ${order.status}`);
    if (order.status === "quoted" && seconds(order.quote.expiresAt) - 60 < Date.now() / 1000) order = undefined;
    else if (order.status !== "quoted") return { orderId: state.orderId, token: state.token };
    if (!order) {
      state.requestKey = randomUUID();
      delete state.orderId;
    }
  }
  if (!order) {
    save(state);
    const q = await api("/requests/quote", { method: "POST", token: state.token, body: JSON.stringify({ requestKey: state.requestKey, action, input }) });
    if (q.status !== 201 && q.status !== 200) throw new Error(`quote ${q.status}: ${JSON.stringify(q.json).slice(0, 400)}`);
    order = q.json.order;
    state.orderId = order.id;
    save(state);
  }
  const qt = order.quote;
  const left = seconds(qt.expiresAt) - Math.floor(Date.now() / 1000);
  console.log(`order ${order.id}: ${formatEther(BigInt(qt.payment.amount))} IMD to ${qt.payment.payTo}, quote expires in ${left}s`);
  if (BigInt(qt.payment.amount) !== amount || qt.payment.asset.toLowerCase() !== pay.asset.toLowerCase()) throw new Error("quote payment differs from capabilities");
  if ((await ask(`Type "pay" to sign the ${formatEther(amount)} IMD payment and submit ${what}: `)) !== "pay") return;

  const url = `/requests/${order.id}/submit`;
  const ch = await api(url, { method: "POST", token: state.token });
  if (ch.status !== 402) throw new Error(`challenge ${ch.status}: ${JSON.stringify(ch.json).slice(0, 400)}`);
  const req = ch.json.accepts[0];
  // x402 only pays known stablecoins by default: allow exactly this asset at exactly the quoted amount.
  const client = x402Client.fromConfig({
    schemes: [{ network: req.network, client: new ExactEvmScheme(account) }],
    spendControls: { allowedAssets: [{ network: pay.network, asset: pay.asset, maxAmountPerPayment: pay.amount }] },
  });
  const { extensions: _ext, ...generated } = await client.createPaymentPayload({ x402Version: 2, resource: ch.json.resource, accepts: [req] } as any);
  const payment = JSON.parse(JSON.stringify({ ...generated, accepted: req }));
  const q = ch.json.quote;
  if (Number(payment.payload.permit2Authorization.deadline) >= seconds(q.expiresAt)) throw new Error("permit deadline falls after the quote expiry; rerun to get a fresh quote");
  const quoteSignature = await account.signTypedData({
    domain: { name: "IdentityMD Paid Action", version: "1", chainId: Number(q.payment.network.slice(7)) },
    primaryType: "QuoteApproval",
    types: { QuoteApproval: [
      { name: "resource", type: "string" }, { name: "requesterScopeHash", type: "bytes32" }, { name: "quoteId", type: "string" },
      { name: "quoteHash", type: "bytes32" }, { name: "paymentHash", type: "bytes32" }, { name: "action", type: "string" },
      { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "payTo", type: "address" }, { name: "expiresAt", type: "uint256" },
    ] },
    message: {
      resource: ch.json.resourceUrl, requesterScopeHash: `0x${ch.json.requesterScopeHash}`, quoteId: q.id, quoteHash: `0x${q.quoteHash}`,
      paymentHash: sha256(stringToBytes(canon(payment))), action: q.action, asset: q.payment.asset, amount: BigInt(q.payment.amount),
      payTo: q.payment.payTo, expiresAt: BigInt(q.expiresAt),
    },
  });

  // Same bytes on a retry never charge twice.
  const headers = { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) };
  const body = JSON.stringify({ quoteSignature });
  let sub = await api(url, { method: "POST", token: state.token, headers, body });
  if (sub.status >= 500) sub = await api(url, { method: "POST", token: state.token, headers, body });
  console.log(`submit ${sub.status}: ${JSON.stringify(sub.json).slice(0, 300)}`);
  if (sub.status !== 200 && sub.status !== 202) process.exit(1);
  return { orderId: order.id, token: state.token };
}

/**
 * Polls GET /requests/:id every 10 s until the order settles; returns its last {status, order, payment, admission}.
 * The settled status is the response's own `status` (admitted ...); `order.status` stops at "paid".
 */
export async function pollOrder(id: string, token: string) {
  for (let last = ""; ; await new Promise((r) => setTimeout(r, 10_000))) {
    const j = (await api(`/requests/${id}`, { token })).json;
    const status = j.status ?? j.order?.status;
    if (status !== last) console.log(`[${new Date().toISOString().slice(11, 19)}] ${id}: ${(last = status)}`);
    if (TERMINAL.has(status)) {
      console.log(JSON.stringify(j.admission ?? j, null, 2).slice(0, 2000));
      return j;
    }
  }
}
