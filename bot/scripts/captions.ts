// Print template captions for the sample timeline (dev helper).
import { readFileSync } from "node:fs";
import { factsFromTimeline } from "../src/lib/facts.ts";
import { templateCaption } from "../src/caption/index.ts";
const tl = JSON.parse(readFileSync(new URL("../data/imd-eth-7d.timeline.json", import.meta.url), "utf8"));
for (const kind of ["teaser", "snapshot", "movement"] as const)
  console.log(`--- ${kind}\n${templateCaption(factsFromTimeline(tl, { kind, chain: "ethereum", pool: "IMD/ETH" }))}`);
