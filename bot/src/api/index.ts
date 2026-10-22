// Stations API service (docs/STATIONS.md "Applications and payment"): `npx tsx src/api/index.ts`, its own compose
// service from the bot's image. Env: STATION_PAY_TO (unset = 503 "applications not open"), STATIONS_OPEN=1,
// STATION_PRICE_TIER (launch|regular), API_PORT (8787), API_HOST (0.0.0.0 in the container; compose publishes it on
// the host's 127.0.0.1 only), API_ORIGINS, API_TRUST_PROXY, OUT_DIR, STATIONS_DATA_DIR. No keys: chain reads only.
import { createServer } from "node:http";
import { join } from "node:path";
import { loadRegistry } from "../station.ts";
import { loadMergedRegistry } from "../stations/runtime.ts";
import { CHAINS } from "../stations/sources.ts";
import { createHandler } from "./app.ts";
import { configFromEnv } from "./config.ts";
import { cachedCheck, cachedImdPrice } from "./market.ts";
import { rpcReader } from "./payments.ts";
import { Store } from "./store.ts";

const OUT = process.env.OUT_DIR ?? "out";
const STATIONS_DATA = process.env.STATIONS_DATA_DIR ?? join(OUT, "stations-data");
const PORT = Number(process.env.API_PORT ?? 8787);
const HOST = process.env.API_HOST ?? "127.0.0.1";

const config = configFromEnv();
const registry = loadRegistry();
const rpcUrls = (chainId: number) => {
  const c = registry.chains[String(chainId)];
  if (!c) throw new Error(`chain ${chainId} not in the registry`);
  return c.rpcUrls;
};
const handle = createHandler({
  config,
  store: new Store(OUT),
  // Baked + runtime stations (the pipeline adds them at runtime): a renewal or a duplicate check sees them at once.
  registry: () => loadMergedRegistry(STATIONS_DATA, registry),
  check: cachedCheck({ weth: (id) => registry.chains[String(id)]?.weth }),
  imdUsd: cachedImdPrice(),
  chain: rpcReader(rpcUrls),
  stationsDataDir: STATIONS_DATA,
  checkChains: Object.keys(registry.chains).map(Number).filter((id) => CHAINS[id]),
});

const server = createServer((req, res) => void handle(req, res));
server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => {
  const state = !config.payTo ? "closed (no STATION_PAY_TO)" : config.open ? `open, pay to ${config.payTo}` : `payments only (STATIONS_OPEN!=1), pay to ${config.payTo}`;
  console.log(new Date().toISOString(), "[api]", `listening on ${HOST}:${PORT}; ${state}; prices ${config.tier}; out=${OUT}`);
});
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.close(() => process.exit(0)));
