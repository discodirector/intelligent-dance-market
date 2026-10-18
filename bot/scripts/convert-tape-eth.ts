// Offline conversion of a legacy IMD-side tape to the ETH side of the same pool (no network).
//   npx tsx bot/scripts/convert-tape-eth.ts [in.json] [out.json] [--copy site/public/timelines/imd-week.json]
// The tape is one IMD/ETH v4 pool in log order and each entry carries its post-swap tick, so the previous entry's
// tick is this swap's pre-swap tick. Inside a liquidity range ETH = IMD / sqrt(P_pre * P_post), P = 1.0001^tick
// (IMD per ETH: ETH is currency0). The 1% pool fee is charged on the input side. This is an estimate (tick rounding,
// range crossings, hook fees); regenerate with `npm run replay -w bot` when network access is available.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTimeline, type RawSwap, type TimelineEntry, type TimelineMeta } from "../src/lib/timeline.ts";
import { isHookRules } from "../src/lib/hookRules.ts";

const POOL_FEE = 0.01; // POOL4 CappedBurnHook pool: fee 10000 pips

/** ETH wei for an IMD-side swap, from the pool ticks before and after it. */
export function ethFromImd(imdAmt: bigint, isBuy: boolean, tickPre: number, tickPost: number): bigint {
  const price = 1.0001 ** ((tickPre + tickPost) / 2); // IMD per ETH at the swap's average sqrt price
  // Buy: IMD out, ETH in (ETH includes the fee). Sell: IMD in (includes the fee), ETH out.
  const eth = isBuy ? Number(imdAmt) / price / (1 - POOL_FEE) : (Number(imdAmt) * (1 - POOL_FEE)) / price;
  return BigInt(Math.round(eth));
}

type Legacy = TimelineEntry & { imdAmt: string };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((a, i, all) => a !== "--copy" && all[i - 1] !== "--copy");
  const copyAt = process.argv.indexOf("--copy");
  const copy = copyAt >= 0 ? resolve(process.argv[copyAt + 1]) : undefined;
  const inPath = resolve(args[0] ?? "bot/data/imd-eth-7d.timeline.json");
  const outPath = resolve(args[1] ?? inPath);
  const metaIn = inPath.replace(/\.json$/, ".meta.json");
  const tape = JSON.parse(readFileSync(inPath, "utf8")) as Legacy[];
  if (tape.some((e) => e.imdAmt == null)) throw new Error("tape already has no imdAmt (converted?)");
  const meta = JSON.parse(readFileSync(metaIn, "utf8")) as TimelineMeta;
  const rules = meta.rules ?? "v1";
  if (!isHookRules(rules)) throw new Error(`bad rules ${rules}`);

  const swaps: RawSwap[] = tape.map((e, i) => {
    const prev = tape[i - 1];
    const pre = prev && prev.poolId === e.poolId ? prev.tick : e.tick;
    return {
      isBuy: e.isBuy,
      quoteAmt: ethFromImd(BigInt(e.imdAmt), e.isBuy, pre, e.tick),
      tick: e.tick,
      blockNumber: BigInt(e.blockNumber),
      timestamp: e.ts,
      txHash: e.txHash,
      logIndex: e.logIndex,
      poolId: e.poolId,
    };
  });
  const { entries, initial } = buildTimeline(swaps, undefined, rules);
  const out: TimelineMeta = {
    ...meta,
    quoteSymbol: "ETH",
    quoteNote:
      "ETH side estimated offline from the IMD amount and pre/post-swap ticks (1% fee on input); " +
      `converted ${new Date().toISOString()} from the IMD-side tape generated ${meta.generatedAt}. Regenerate with network.`,
    initial,
  };
  writeFileSync(outPath, JSON.stringify(entries));
  writeFileSync(outPath.replace(/\.json$/, ".meta.json"), JSON.stringify(out, null, 2) + "\n");
  if (copy) writeFileSync(copy, JSON.stringify(entries));
  const eth = entries.map((e) => e.quote);
  console.error(
    `converted ${entries.length} swaps: ETH median ${eth.slice().sort((a, b) => a - b)[eth.length >> 1].toFixed(5)}, ` +
      `max ${Math.max(...eth).toFixed(3)}, whales ${entries.filter((e) => e.whale).length} -> ${outPath}${copy ? ` + ${copy}` : ""}`,
  );
}
