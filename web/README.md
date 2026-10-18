# web

Player for [Intelligent Dance Market](https://github.com/discodirector/intelligent-dance-market) ($IDM). Every trade is a note. The pool is IDM/ETH (native ETH) on Robinhood Chain 4663. Package names stay `@swarm-sequencer/*`.

```
npm install
npm -w web run dev
npm -w web run build
node web/scripts/smoke.mjs
```

Modes (query on `/`):

- `/?mode=demo` — local swaps through `src/demo/mutate.ts` (temporary SPEC §3.3 port; replace with `@swarm-sequencer/core`)
- `/?mode=replay&timeline=/demo-timeline.json` — or just `?timeline=`. Speed scales playback (`fit 48s` compresses a long tape). `timeline` alone also selects replay. The W3 7-day tape is at `/timelines/imd-eth-7d.timeline.json`. `/?mode=replay&timeline=/idle-test.timeline.json&speed=200` plays the idle stages (15 min, 45 min, 2 h) and a whale buy/sell in about a minute.
- `/?mode=live&hook=0x…&chainId=4663&rpc=https://rpc.mainnet.chain.robinhood.com` — viem reads `raw()` and watches `Mutated`. Default chain is Robinhood Chain 4663.
- `/?mode=gallery` — ten genre buttons. One pattern, forced genre, so you can A/B Dub Techno, Electro, Acid, Ambient IDM, Ambient Drone, Liquid DnB, Future Garage, Trip-hop, Lofi House, and Wonky. `node web/scripts/era-gallery.mjs` writes a 12s WAV of each into `web/out/eras/`.

Press **start audio** (or space) before the context will sound. The info line is `bpm · root/mode · swap #N · page #M`. Under it, `EPOCH #n · <era name>`. Epoch is `floor(patternId / 4)`. The era is `eraOf(epoch)` from `@swarm-sequencer/synth`, unless gallery is forcing one. The epoch line flashes while the era crossfades (one bar).

`render.html` is the headless capture page. See [RENDER.md](./RENDER.md).
