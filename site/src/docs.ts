import "./style.css";
import "./docs.css";
import { ERA_SCHEDULE, ERAS } from "@swarm-sequencer/synth";
import { NETWORKS } from "./config";

// Genres in force now (the latest schedule entry), with each genre's tempo range: the list follows new genres.
const ids = ERA_SCHEDULE.at(-1)!.ids;
document.getElementById("genre-list")!.innerHTML = ids
  .map((id) => ERAS.find((e) => e.id === id)!)
  .map((era) => `<li><b>${era.name}</b><span>${era.bpm[0]}–${era.bpm[1]} bpm</span></li>`)
  .join("");

// Mainnet first; testnet rehearsals after it. A network without a hook says so instead of inventing an address.
const link = (net: (typeof NETWORKS)[string], addr: string) => `<a href="${net.explorer}/address/${addr}" target="_blank" rel="noopener"><code>${addr}</code></a>`;
const rows = (["robinhood", "sepolia-v2"] as const).map((key) => {
  const net = NETWORKS[key];
  if (!net) return "";
  const items: [string, string | null | undefined][] = [["Hook", net.hook], ["IDM token", net.token], ["Pulse treasury", net.treasury]];
  const body = net.hook
    ? items.map(([k, v]) => `<tr><td>${k}</td><td>${v ? link(net, v) : "not deployed yet"}</td></tr>`).join("")
    : `<tr><td colspan="2">launching through IMD; addresses appear here once deployed</td></tr>`;
  const title = key === "robinhood" ? "Robinhood Chain (4663) · IDM/ETH" : "Sepolia rehearsal · IDM/ETH";
  return `<h3>${title}</h3><table><tbody>${body}</tbody></table>`;
});
document.getElementById("contract-list")!.innerHTML = rows.join("");
