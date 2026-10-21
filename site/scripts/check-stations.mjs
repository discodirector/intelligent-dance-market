// Shape check for stations/registry.json (docs/STATIONS.md "Registry"). Runs before every build, so a bad entry
// fails `npm run build -w site` instead of a station page in the browser.
//   node scripts/check-stations.mjs [path]
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? new URL("../../stations/registry.json", import.meta.url).pathname;
const reg = JSON.parse(readFileSync(path, "utf8"));
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isHex = (v, bytes) => typeof v === "string" && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(v);
const isColor = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const isUrl = (v) => typeof v === "string" && /^https:\/\/\S+$/.test(v);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

// Coverage: these chains, these pool kinds (core swaps.ts); ETH or WETH pairs, or any quote token with a calibration
// (calibration.quotePerEth: WMON, stablecoins), which core swaps.ts converts to ETH at the frozen rate.
const SUPPORTED_CHAINS = ["1", "8453", "42161", "4663", "143"];
const KINDS = ["hook", "v4", "v3", "pancake-v3", "v2", "aerodrome-v2"];
const NATIVE = "0x0000000000000000000000000000000000000000";

const chains = reg.chains;
if (!chains || typeof chains !== "object") fail("chains", "missing object");
else
  for (const [id, c] of Object.entries(chains)) {
    if (!/^\d+$/.test(id)) fail(`chains.${id}`, "key must be a chain id");
    else if (!SUPPORTED_CHAINS.includes(id)) fail(`chains.${id}`, `not a supported chain (${SUPPORTED_CHAINS.join(", ")})`);
    if (!isStr(c?.name)) fail(`chains.${id}.name`, "missing");
    if (!isUrl(c?.explorer)) fail(`chains.${id}.explorer`, "not an https url");
    if (!isStr(c?.explorerName)) fail(`chains.${id}.explorerName`, "missing");
    if (!Array.isArray(c?.rpcUrls) || c.rpcUrls.length === 0 || !c.rpcUrls.every(isUrl)) fail(`chains.${id}.rpcUrls`, "must be https urls");
    // The widest eth_getLogs range the listed RPCs serve (Tenderly's Arbitrum gateway truncates silently past 250k).
    if (!Number.isInteger(c?.logChunk) || c.logChunk < 100) fail(`chains.${id}.logChunk`, "must be an integer >= 100");
    if (!isHex(c?.weth, 20)) fail(`chains.${id}.weth`, "not an address");
    if (c?.poolManager !== undefined && !isHex(c.poolManager, 20)) fail(`chains.${id}.poolManager`, "not an address");
    // Native currency when it is not ETH (Monad: MON): a native-quoted v4 pool then needs a calibration.
    if (c?.nativeSymbol !== undefined && !isStr(c.nativeSymbol)) fail(`chains.${id}.nativeSymbol`, "must be a symbol");
  }

// Mirrors core swaps.ts calibrationProblems (this script runs on plain node, without the TypeScript core).
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
function checkCalibration(at, c) {
  if (c === undefined) return;
  if (!c || typeof c !== "object" || Array.isArray(c)) return fail(at, "calibration must be an object");
  const { supplyTickOffset: o, quotePerEth: q, quoteDecimals: d, ...rest } = c;
  for (const k of Object.keys(rest)) fail(at, `calibration.${k}: unknown field`);
  if (o !== undefined && (!Number.isInteger(o) || Math.abs(o) > 887272)) fail(at, "calibration.supplyTickOffset must be an integer within ±887272");
  if (q !== undefined && (typeof q !== "string" || !DECIMAL.test(q) || !/[1-9]/.test(q))) fail(at, 'calibration.quotePerEth must be a positive decimal string, e.g. "41250.5"');
  if (d !== undefined && (!Number.isInteger(d) || d < 0 || d > 36)) fail(at, "calibration.quoteDecimals must be an integer 0..36");
  if (d !== undefined && q === undefined) fail(at, "calibration.quoteDecimals needs quotePerEth");
}

if (!Array.isArray(reg.stations) || reg.stations.length === 0) fail("stations", "missing or empty array");
const keys = new Set();
for (const [i, s] of (reg.stations ?? []).entries()) {
  const at = `stations[${i}]${s?.key ? ` (${s.key})` : ""}`;
  if (typeof s?.key !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(s.key)) fail(at, "key must be a lowercase slug");
  else if (keys.has(s.key)) fail(at, "duplicate key");
  else keys.add(s.key);
  for (const f of ["label", "ticker", "program"]) if (!isStr(s[f])) fail(at, `${f} missing`);
  const chain = chains?.[String(s.chainId)];
  if (!Number.isInteger(s.chainId) || !chain) fail(at, `chainId ${s.chainId} not in chains (supported: ${SUPPORTED_CHAINS.join(", ")})`);
  // Optional per station; the chain's rpcUrls otherwise.
  if (s.rpcUrls !== undefined && (!Array.isArray(s.rpcUrls) || s.rpcUrls.length === 0 || !s.rpcUrls.every(isUrl))) fail(at, "rpcUrls must be https urls");
  if (!Number.isInteger(s.genesisBlock) || s.genesisBlock <= 0) fail(at, "genesisBlock must be a positive integer");
  if (!isHex(s.token, 20)) fail(at, "token not an address");
  const known = KINDS.includes(s.kind);
  if (!known) fail(at, `kind "${s.kind}" unknown (${KINDS.join(", ")})`);
  // Where the swaps come from: v4 = PoolManager + poolId, the other kinds = the pool's own address.
  if (s.kind === "hook" || s.kind === "v4") {
    if (!isHex(s.poolManager, 20)) fail(at, "poolManager not an address");
    else if (chain?.poolManager && !same(s.poolManager, chain.poolManager)) fail(at, `poolManager is not ${chain.name}'s v4 PoolManager ${chain.poolManager}`);
    if (!isHex(s.poolId, 32)) fail(at, "poolId not bytes32");
    if (s.pool !== undefined) fail(at, `a ${s.kind} station has poolManager + poolId, not pool`);
  } else if (known) {
    if (!isHex(s.pool, 20)) fail(at, `a ${s.kind} station needs its pool address`);
    if (s.poolManager !== undefined || s.poolId !== undefined) fail(at, `a ${s.kind} station has pool, not poolManager/poolId`);
  }
  if (s.kind === "hook" && !isHex(s.hook, 20)) fail(at, "a hook station needs its hook address");
  if (!["ETH", "IMD"].includes(s.quoteSymbol)) fail(at, `quoteSymbol "${s.quoteSymbol}" unknown`);
  // Played stations (all but the hook, whose state is on chain): ETH or WETH pairs, or another quote with
  // calibration.quotePerEth. The quote side is resolved on chain when the entry is added (bot/scripts/station-probe.ts
  // prints it), never guessed at runtime. quoteSymbol stays "ETH": the unit the rules (and the player) read.
  if (s.calibration !== undefined && s.kind === "hook") fail(at, "the hook station is read on chain: no calibration");
  checkCalibration(at, s.calibration);
  if (known && s.kind !== "hook") {
    if (s.quoteSymbol !== "ETH") fail(at, "played stations count in ETH: quoteSymbol must be ETH (a calibrated quote is converted)");
    const native = same(s.quote, NATIVE);
    const calibrated = typeof s.calibration?.quotePerEth === "string";
    const nativeSymbol = chain?.nativeSymbol ?? "ETH";
    if (!isHex(s.quote, 20)) fail(at, "quote (the pool's quote side: native 0x0, the chain's WETH, or a calibrated token) not an address");
    else if (native && s.kind !== "v4") fail(at, `native ${nativeSymbol} trades in v4 pools only; a ${s.kind} pool pairs a wrapped token`);
    else if (native && nativeSymbol !== "ETH" && !calibrated) fail(at, `native ${nativeSymbol} is not ETH: needs calibration.quotePerEth`);
    else if (!native && !same(s.quote, chain?.weth) && !calibrated)
      fail(at, `quote ${s.quote} is not ETH or ${chain?.name ?? "the chain"}'s WETH: another quote token needs calibration.quotePerEth`);
    if (s.ethSide !== 0 && s.ethSide !== 1) fail(at, "ethSide must be 0 or 1 (the pool's quote side: currency0/token0 or currency1/token1)");
    // Native ETH (address 0) always sorts first; otherwise token0 is the lower address.
    else if (native && s.ethSide !== 0) fail(at, "the native currency is always currency0: ethSide must be 0");
    else if (!native && isHex(s.quote, 20) && isHex(s.token, 20) && (BigInt(s.quote) < BigInt(s.token)) !== (s.ethSide === 0))
      fail(at, `ethSide ${s.ethSide} contradicts the address order (token0 is the lower address)`);
  }
  for (const t of ["phos", "phosDim", "ghost", "lcd"]) if (!isColor(s.theme?.[t])) fail(at, `theme.${t} must be #rrggbb`);
  if (!["live", "paused"].includes(s.status)) fail(at, `status "${s.status}" unknown`);
  if (s.house !== undefined && typeof s.house !== "boolean") fail(at, "house must be a boolean");
}

if (errors.length) {
  console.error(`stations/registry.json: ${errors.length} problem(s)\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`stations/registry.json: ${reg.stations.length} stations ok`);
