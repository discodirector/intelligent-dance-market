// Shape check for stations/registry.json (docs/STATIONS.md "Registry"). Runs before every build, so a bad entry
// fails `npm run build -w site` instead of a station page in the browser. The rules are stations/validate.mjs, the
// same ones the bot and the site apply to the runtime registry (OUT_DIR/stations-data/stations.json).
//   node scripts/check-stations.mjs [path]
import { existsSync, readFileSync } from "node:fs";
import { registryProblems } from "../../stations/validate.mjs";

const path = process.argv[2] ?? new URL("../../stations/registry.json", import.meta.url).pathname;
const reg = JSON.parse(readFileSync(path, "utf8"));
// A baked station's program is a pack file in packages/synth/src/stations (listed in its index.ts).
const packExists = (program) => existsSync(new URL(`../../packages/synth/src/stations/${program}.ts`, import.meta.url).pathname);
const errors = registryProblems(reg, { packExists });

if (errors.length) {
  console.error(`stations/registry.json: ${errors.length} problem(s)\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`stations/registry.json: ${reg.stations.length} stations ok`);
