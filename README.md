# Intelligent Dance Market ($IDM)

**Every trade is a note.** A Uniswap v4 hook on the IDM/IMD pool (Robinhood Chain) whose on-chain state is a 16-step IDM sequencer: four drum tracks and a bass line. Every swap deterministically mutates the pattern — buys switch steps on, sells switch them off, trade size picks the track, market speed sets the tempo, buy/sell pressure sets the mode, and whales move the key around the circle of fifths.

Built for the Identity MD Hackathon and launched through the IMD swarm (`launch.open`, kind `univ4_hook`).

| Path | What |
|---|---|
| [`SPEC.md`](SPEC.md) | Full spec (RU); §3 is the canonical bit-level state model |
| [`contracts/`](contracts/) | `SequencerHook` (Foundry): no owner, no fees, no fund handling; 68 tests, ~32k gas per swap |
| [`spec/vectors.json`](spec/vectors.json) | 116 Foundry-generated test vectors shared by Solidity and TypeScript |
| [`swarm/BRIEF.md`](swarm/BRIEF.md) | Launch brief for the IMD swarm |
| [`packages/core/`](packages/core/) | TypeScript port of the mutation logic, parity-tested against the vectors |
| [`packages/synth/`](packages/synth/), [`web/`](web/) | WebAudio synth and live player |
| [`bot/`](bot/) | Replays real swaps, renders video, posts the track's state to X |
