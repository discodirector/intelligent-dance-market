# Timeline format (`timeline.json`) — v1

Produced by `bot/replay` (`npm run replay -w @swarm-sequencer/bot`), consumed by `web/render.html?timeline=<url>`
(replay mode) and by the bot's render/caption steps. Owner: W3. If `web/RENDER.md` defines something
different, RENDER.md wins and the bot adapts.

## Files
- `timeline.json` — **a JSON array** of entries, chronological (block number, then log index).
  One entry per swap = the state **after** that swap's `mutate()`.
- `timeline.meta.json` — sidecar object with provenance and the **initial** state (state before entry 0).

A sample from real data is committed at `bot/data/imd-eth-7d.timeline.json` (+ `.meta.json`):
main IMD/ETH pool on Ethereum mainnet, last 7 days.

## Entry
```jsonc
{
  "i": 0,                       // index in the array
  "ts": 1791395483,             // block timestamp, unix seconds
  "blockNumber": 26142117,
  "txHash": "0x…", "logIndex": 389, "poolId": "0x…",   // provenance (optional)

  // mutate() input
  "isBuy": false,               // trader received IMD (replay) / SEQ (live hook)
  "imdAmt": "7770593536225464718",  // |IMD delta| in wei, decimal string (use BigInt)
  "imd": 7.770593,              // same in IMD, float, display only
  "tick": 56619,                // pool tick after the swap

  // mutation result — same fields as the `Mutated` event
  "track": 1,                   // 0 kick, 1 snare, 2 hat, 3 glitch
  "step": 1,                    // 0..15
  "on": false,                  // bit set (buy) or cleared (sell)
  "bassNote": 0,                // bass nibble at `step` after the swap (0 = rest)
  "whale": false,               // imdAmt >= T_KICK
  "movement": false,            // a Movement event was emitted (= whale)

  // full state after the swap
  "slot0": "0x…", "slot1": "0x…",          // packed, SPEC §3.2 (decode with packages/core)
  "state": {                               // decoded convenience copy
    "pattern": "0x10100101",               // uint64 hex, bit track*16+step
    "bass": "0x0",                         // uint64 hex, nibble per step
    "swapCount": 1, "lastTs": 1791395483, "bpm": 157, "root": 9, "mode": 1,
    "patternId": 0, "lastTick": 56619, "pressure": -1000, "intervalEma": 600, "releaseCount": 0
  }
}
```

## Meta
```jsonc
{
  "version": 1, "chainId": 1, "source": "uniswap-v4 PoolManager Swap logs, last 7d",
  "poolManager": "0x000000000004444c5dC75cB358380D2e3dE08A90",
  "poolIds": ["0x415829f7…"], "token": "0xD34a…63B7",
  "fromBlock": 26142117, "toBlock": 26192318, "fromTs": 1791395483, "toTs": 1791999587,
  "count": 2039, "generatedAt": "2026-10-15T…Z",
  "initial": { "slot0": "0x…", "slot1": "0x…", "state": { … } }
}
```

## Notes
- Thresholds are the SPEC §3.1 defaults (0.5 / 5 / 25 / 100 IMD).
- Replay starts from `initialState()` (SPEC §3.2), not from the live hook.
- Pools: default `--pools main` = POOL4 CappedBurnHook market
  `0x415829f72e9f54531c26eae76f107618540e898a45d6ae35959e143f5faca704`
  (hook `0xc6C965Bd164c483e87d0B550671798e9A3602840`, fee 1%, tickSpacing 60).
  `--pools eth` merges every ETH/IMD v4 pool (≈17k swaps/7d, most on hookless 1% pool `0xb07d64…`).
- Swap `amount0/amount1` are from the swapper's perspective (positive = received); with ETH as
  currency0, `isBuy = amount1 > 0`.
