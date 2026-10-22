// The station registry's rules (docs/STATIONS.md "Registry"), one copy for every reader: site/scripts/check-stations.mjs
// checks the baked stations/registry.json before every build; the bot (stations/runtime.ts) and the site
// (site/src/stations.ts) check each entry of the runtime registry (OUT_DIR/stations-data/stations.json, added by the
// pipeline) the same way before merging it over the baked one. Plain JS, no imports: node, tsx and vite all load it.

export const SUPPORTED_CHAINS = ["1", "8453", "42161", "4663", "143"];
export const KINDS = ["hook", "v4", "v3", "pancake-v3", "v2", "aerodrome-v2"];
/** pending = added, not on air; preview = the pack is in, playable at ?net=<key> but not listed; live = on air. */
export const STATUSES = ["live", "paused", "pending", "preview"];
const NATIVE = "0x0000000000000000000000000000000000000000";

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isHex = (v, bytes) => typeof v === "string" && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(v);
const isColor = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const isUrl = (v) => typeof v === "string" && /^https:\/\/\S+$/.test(v);
export const isDate = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/.test(v) && Number.isFinite(Date.parse(v));
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** Problems of the top-level `chains` map, as "where: what" lines. */
export function chainsProblems(chains) {
  const errors = [];
  const fail = (where, msg) => errors.push(`${where}: ${msg}`);
  if (!chains || typeof chains !== "object") {
    fail("chains", "missing object");
    return errors;
  }
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
  return errors;
}

// Mirrors core swaps.ts calibrationProblems (this module runs on plain node, without the TypeScript core).
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
function calibrationProblems(c) {
  if (c === undefined) return [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["calibration must be an object"];
  const out = [];
  const { supplyTickOffset: o, quotePerEth: q, quoteDecimals: d, ...rest } = c;
  for (const k of Object.keys(rest)) out.push(`calibration.${k}: unknown field`);
  if (o !== undefined && (!Number.isInteger(o) || Math.abs(o) > 887272)) out.push("calibration.supplyTickOffset must be an integer within ±887272");
  if (q !== undefined && (typeof q !== "string" || !DECIMAL.test(q) || !/[1-9]/.test(q))) out.push('calibration.quotePerEth must be a positive decimal string, e.g. "41250.5"');
  if (d !== undefined && (!Number.isInteger(d) || d < 0 || d > 36)) out.push("calibration.quoteDecimals must be an integer 0..36");
  if (d !== undefined && q === undefined) out.push("calibration.quoteDecimals needs quotePerEth");
  return out;
}

/**
 * Problems of one station entry against the chains, as plain messages. `packExists(program)` says whether a
 * program other than "idm" has a pack (baked file, or a runtime pack).
 */
export function stationProblems(s, chains, { packExists = () => true } = {}) {
  const errors = [];
  const fail = (msg) => errors.push(msg);
  if (!s || typeof s !== "object") return ["not an object"];
  if (typeof s.key !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(s.key)) fail("key must be a lowercase slug");
  for (const f of ["label", "ticker", "program"]) if (!isStr(s[f])) fail(`${f} missing`);
  // "idm" = the house schedules; any other program is a pack (packages/synth/src/stations, or a runtime pack).
  if (isStr(s.program) && s.program !== "idm" && (!/^[a-z0-9-]+$/.test(s.program) || !packExists(s.program)))
    fail(`program "${s.program}" has no pack`);
  const chain = chains?.[String(s.chainId)];
  if (!Number.isInteger(s.chainId) || !chain) fail(`chainId ${s.chainId} not in chains (supported: ${SUPPORTED_CHAINS.join(", ")})`);
  // Optional per station; the chain's rpcUrls otherwise.
  if (s.rpcUrls !== undefined && (!Array.isArray(s.rpcUrls) || s.rpcUrls.length === 0 || !s.rpcUrls.every(isUrl))) fail("rpcUrls must be https urls");
  if (!Number.isInteger(s.genesisBlock) || s.genesisBlock <= 0) fail("genesisBlock must be a positive integer");
  if (!isHex(s.token, 20)) fail("token not an address");
  const known = KINDS.includes(s.kind);
  if (!known) fail(`kind "${s.kind}" unknown (${KINDS.join(", ")})`);
  // Where the swaps come from: v4 = PoolManager + poolId, the other kinds = the pool's own address.
  if (s.kind === "hook" || s.kind === "v4") {
    if (!isHex(s.poolManager, 20)) fail("poolManager not an address");
    else if (chain?.poolManager && !same(s.poolManager, chain.poolManager)) fail(`poolManager is not ${chain.name}'s v4 PoolManager ${chain.poolManager}`);
    if (!isHex(s.poolId, 32)) fail("poolId not bytes32");
    if (s.pool !== undefined) fail(`a ${s.kind} station has poolManager + poolId, not pool`);
  } else if (known) {
    if (!isHex(s.pool, 20)) fail(`a ${s.kind} station needs its pool address`);
    if (s.poolManager !== undefined || s.poolId !== undefined) fail(`a ${s.kind} station has pool, not poolManager/poolId`);
  }
  if (s.kind === "hook" && !isHex(s.hook, 20)) fail("a hook station needs its hook address");
  if (!["ETH", "IMD"].includes(s.quoteSymbol)) fail(`quoteSymbol "${s.quoteSymbol}" unknown`);
  // Played stations (all but the hook, whose state is on chain): ETH or WETH pairs, or another quote with
  // calibration.quotePerEth. The quote side is resolved on chain when the entry is added (bot/scripts/station-probe.ts
  // prints it), never guessed at runtime. quoteSymbol stays "ETH": the unit the rules (and the player) read.
  if (s.calibration !== undefined && s.kind === "hook") fail("the hook station is read on chain: no calibration");
  errors.push(...calibrationProblems(s.calibration));
  if (known && s.kind !== "hook") {
    if (s.quoteSymbol !== "ETH") fail("played stations count in ETH: quoteSymbol must be ETH (a calibrated quote is converted)");
    const native = same(s.quote, NATIVE);
    const calibrated = typeof s.calibration?.quotePerEth === "string";
    const nativeSymbol = chain?.nativeSymbol ?? "ETH";
    if (!isHex(s.quote, 20)) fail("quote (the pool's quote side: native 0x0, the chain's WETH, or a calibrated token) not an address");
    else if (native && s.kind !== "v4") fail(`native ${nativeSymbol} trades in v4 pools only; a ${s.kind} pool pairs a wrapped token`);
    else if (native && nativeSymbol !== "ETH" && !calibrated) fail(`native ${nativeSymbol} is not ETH: needs calibration.quotePerEth`);
    else if (!native && !same(s.quote, chain?.weth) && !calibrated)
      fail(`quote ${s.quote} is not ETH or ${chain?.name ?? "the chain"}'s WETH: another quote token needs calibration.quotePerEth`);
    if (s.ethSide !== 0 && s.ethSide !== 1) fail("ethSide must be 0 or 1 (the pool's quote side: currency0/token0 or currency1/token1)");
    // Native ETH (address 0) always sorts first; otherwise token0 is the lower address.
    else if (native && s.ethSide !== 0) fail("the native currency is always currency0: ethSide must be 0");
    else if (!native && isHex(s.quote, 20) && isHex(s.token, 20) && (BigInt(s.quote) < BigInt(s.token)) !== (s.ethSide === 0))
      fail(`ethSide ${s.ethSide} contradicts the address order (token0 is the lower address)`);
  }
  for (const t of ["phos", "phosDim", "ghost", "lcd"]) if (!isColor(s.theme?.[t])) fail(`theme.${t} must be #rrggbb`);
  if (!STATUSES.includes(s.status)) fail(`status "${s.status}" unknown (${STATUSES.join(", ")})`);
  // The subscription's end (bot stations/subscription.ts): past it a live station is off air.
  if (s.paidUntil !== undefined && !isDate(s.paidUntil)) fail("paidUntil must be YYYY-MM-DD or an ISO timestamp in UTC");
  // Station+ end (docs/STATIONS.md "Station+"), same format; paid Station+ renewals push it further at runtime.
  if (s.plusUntil !== undefined && !isDate(s.plusUntil)) fail("plusUntil must be YYYY-MM-DD or an ISO timestamp in UTC");
  if (s.house !== undefined && typeof s.house !== "boolean") fail("house must be a boolean");
  return errors;
}

/** Every problem of a whole registry ({ chains, stations }), as "where: what" lines. */
export function registryProblems(reg, opts = {}) {
  const errors = chainsProblems(reg?.chains);
  if (!Array.isArray(reg?.stations) || reg.stations.length === 0) errors.push("stations: missing or empty array");
  const keys = new Set();
  for (const [i, s] of (reg?.stations ?? []).entries()) {
    const at = `stations[${i}]${s?.key ? ` (${s.key})` : ""}`;
    if (typeof s?.key === "string" && keys.has(s.key)) errors.push(`${at}: duplicate key`);
    keys.add(s?.key);
    for (const msg of stationProblems(s, reg?.chains, opts)) errors.push(`${at}: ${msg}`);
  }
  return errors;
}

/** The pool a played station hears, "<chainId>:<pool or poolId>" lowercased (two stations never share one). */
const poolOf = (s) => `${s?.chainId}:${String(s?.poolId ?? s?.pool ?? "").toLowerCase()}`;

/**
 * The baked registry with the runtime entries ({ stations: [...] }, the pipeline's file) appended. A runtime entry is
 * dropped (and listed in `skipped` with why) when it breaks a rule, reuses a key or a pool of the baked registry
 * (baked wins) or of an earlier runtime entry, or is a house or hook station (only theidm adds those, by hand).
 * Chains come from the baked registry only.
 */
export function mergeRegistry(baked, runtime, opts = {}) {
  const skipped = [];
  const stations = [...baked.stations];
  const keys = new Set(stations.map((s) => s.key));
  const pools = new Set(stations.filter((s) => s.kind !== "hook").map(poolOf));
  const list = Array.isArray(runtime?.stations) ? runtime.stations : [];
  for (const s of list) {
    const key = typeof s?.key === "string" ? s.key : "?";
    const why = stationProblems(s, baked.chains, opts);
    if (s?.house) why.push("house stations are baked only");
    if (s?.kind === "hook") why.push("hook stations are baked only");
    if (keys.has(key)) why.push(`key "${key}" is taken`);
    else if (pools.has(poolOf(s))) why.push("its pool already has a station");
    if (why.length) {
      skipped.push({ key, reasons: why });
      continue;
    }
    stations.push(s);
    keys.add(key);
    pools.add(poolOf(s));
  }
  return { registry: { ...baked, stations }, skipped };
}
