import type { StationPack } from "../pack.ts";
import acid from "./hamster-acid.ts";
import breaks from "./hamster-breaks.ts";
import dnb from "./hamster-dnb.ts";
import darkElectro from "./hamster-electro.ts";
import lofi from "./hamster-lofi.ts";
import ukg from "./hamster-ukg.ts";

// The Squeekchain station (docs/STATIONS.md "Hamster station"): a real hamster's wheel through the $IDM rules, one
// note per 30 m of wheel. Awake, one genre per epoch: acid (hamster-acid.ts), breakbeat and dark electro on electro
// (hamster-breaks.ts, hamster-electro.ts), late-90s UK garage on future garage (hamster-ukg.ts), drum & bass on liquid
// (hamster-dnb.ts) and lo-fi house (hamster-lofi.ts); asleep, hamster-sleep.ts (synth sleep.ts). One file per genre so
// each can be reworked alone; this one only puts them together (owner's picks of 2026-10-27: Wheelie out; Hull
// Breach, Hypnagogue and Zero Kelvin in; the late-90s UK garage in place of the first garage set; DnB and lo-fi
// house added).

export default {
  key: "hamster",
  name: "Squeekchain",
  genres: ["acid", "electro", "futuregarage", "liquid", "lofihouse"],
  styles: {
    acid: acid.styles.acid,
    electro: [
      ...breaks.styles.electro.filter((s) => s.id !== "hamster-wheelie"),
      ...darkElectro.styles.electro.filter((s) => s.id === "hamster-delectro-breach" || s.id === "hamster-delectro-hypno" || s.id === "hamster-delectro-kelvin"),
    ],
    futuregarage: ukg.styles.futuregarage.filter((s) => s.id.startsWith("hamster-ukg90-")),
    liquid: dnb.styles.liquid,
    lofihouse: lofi.styles.lofihouse,
  },
  patches: { ...darkElectro.patches, ...dnb.patches, ...lofi.patches },
} satisfies StationPack;
