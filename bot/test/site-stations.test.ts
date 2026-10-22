// The site's runtime stations (site/src/runtime.ts): merge, packs validated on load, preview / live / expired.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packFor, parsePackSource, programFor } from "@swarm-sequencer/synth";
import { listed, playerMode, withRuntime } from "../../site/src/runtime.ts";

const BAKED = JSON.parse(readFileSync(new URL("../../stations/registry.json", import.meta.url), "utf8"));
const EXAMPLE = parsePackSource(readFileSync(new URL("../../packages/synth/src/stations/example.ts", import.meta.url), "utf8")) as Record<string, unknown>;

const entry = (over: Record<string, unknown> = {}) => ({
  key: "site-chog", label: "CHOG/MON", ticker: "CHOG", chainId: 143, kind: "v3", pool: "0x116e7d070f1888b81e1e0324f56d6746b2d7d8f1",
  genesisBlock: 1000, token: "0x350035555e10d9afaf1566aaebfced5ba6c27777", quote: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a", ethSide: 1,
  quoteSymbol: "ETH", calibration: { supplyTickOffset: 0, quotePerEth: "111372" },
  theme: { phos: "#ffb53d", phosDim: "#a0701f", ghost: "#2e2008", lcd: "#140d02" }, program: "site-chog", status: "preview", ...over,
});

/** A fake /stations-data: path -> JSON body (or a status / HTML). */
function server(files: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchFn = (async (url: string) => {
    asked.push(String(url));
    const body = files[String(url)];
    if (body === undefined) return new Response("<!doctype html><title>spa</title>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchFn, asked };
}

describe("site runtime stations", () => {
  it("merges a runtime station once its pack is fetched, validated and registered", async () => {
    const pack = { ...EXAMPLE, key: "site-chog", name: "Site Chog" };
    const { fetchFn, asked } = server({ "/stations-data/stations.json": { version: 1, stations: [entry()] }, "/stations-data/packs/site-chog.json": pack });
    const r = await withRuntime(BAKED, fetchFn);
    expect(r.registry.stations.map((s: { key: string }) => s.key)).toEqual([...BAKED.stations.map((s: { key: string }) => s.key), "site-chog"]);
    expect(asked).toEqual(["/stations-data/stations.json", "/stations-data/packs/site-chog.json"]);
    expect(packFor("site-chog")).toBeDefined();
    expect(programFor("site-chog").key).toBe("site-chog");
  });

  it("refuses an invalid pack (and so its station); a baked key wins; no file or an SPA page = baked only", async () => {
    const { fetchFn } = server({
      "/stations-data/stations.json": { stations: [entry({ key: "bad-pack", program: "bad-pack", pool: "0x" + "2".repeat(40) }), entry({ key: "infer", program: "idm" })] },
      "/stations-data/packs/bad-pack.json": { ...EXAMPLE, key: "bad-pack", genres: ["techno"] },
    });
    const r = await withRuntime(BAKED, fetchFn);
    expect(r.registry.stations).toHaveLength(BAKED.stations.length);
    expect(r.packErrors["bad-pack"].length).toBeGreaterThan(0);
    expect(r.skipped.map((s: { key: string }) => s.key)).toEqual(["bad-pack", "infer"]);
    expect((await withRuntime(BAKED, server({}).fetchFn)).registry.stations).toHaveLength(BAKED.stations.length);
    const down = (async () => { throw new Error("timeout"); }) as typeof fetch;
    expect((await withRuntime(BAKED, down)).registry.stations).toHaveLength(BAKED.stations.length);
  });

  it("preview plays labelled and is not listed; expired never plays and is not listed; house always plays", () => {
    const s = { key: "x", program: "x", status: "live" };
    expect([playerMode(s, "live"), listed(s, "live")]).toEqual(["live", true]);
    expect([playerMode({ ...s, status: "preview" }, undefined), listed({ ...s, status: "preview" }, undefined)]).toEqual(["preview", false]);
    expect([playerMode(s, "expired"), listed(s, "expired")]).toEqual(["off-air", false]);
    expect(playerMode({ ...s, status: "pending" }, "pending")).toBe("live");
    expect(playerMode({ ...s, house: true }, "expired")).toBe("live");
    expect(listed(s, undefined)).toBe(true);
  });
});
