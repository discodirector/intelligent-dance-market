// The "how" section (index.html #how) of an nft station (registry kind "nft", core nft.ts): the house text explains the
// $IDM hook's pool; a collection station says what it reads and how each event sounds, in the same layout (the pitch
// and the `cat spec/…` table). Credits has its own copy (its venues, Statements, BALANCE); any other collection a
// generic one. Static strings only: nothing from the chain or the registry reaches the markup. The house page (no
// station, or a pool station) is left exactly as index.html has it.
import type { Station } from "./stations";

type Row = [input: string, rule: string, sound: string];

const CREDITS_PITCH = `
  <p class="big">payments, printed, played.</p>
  <p>Credits by Jack Butcher on Ethereum, read straight from the chain: sales on OpenSea, CreditStrategy and Core, pages composed and sold in Statements, pages locked into BALANCE. Nothing off-chain.</p>
  <p>The sales run through the $IDM hook's rules (a 16-step, 4-track pattern and a bass line), replayed from the chain by every listener, and play Credits Techno, a dub techno program of ten styles.</p>`;

const CREDITS_ROWS: Row[] = [
  ["Credit sale", "OpenSea (Seaport listings and bids), CreditStrategy, Core · one note per item sold · an item flipped inside one tx counts once", "a step · <span class=\"g\">+</span> buy adds · <span class=\"r\">−</span> sell removes"],
  ["price", "vs the median of the last 127 sales: &lt;0.96× · &lt;1.06× · &lt;1.15× · ≥1.15×", "<b>HAT</b> · <b>GLITCH</b> · <b>SNARE</b> · <b>KICK</b>"],
  ["rating 80–800", "the Credit's score, as a percentile over the edition", "brightness and level of the plate stab · top 5% sing a melody note"],
  ["CMYK plates", "the Credit's 1–4 plates", "plates = notes in the stab · C left · M right · Y an octave up · K into the sub"],
  ["market cap", "median price × 77,114 Credits", "bass rhythm · filter and timbre · the whale line"],
  ["Statement compose", "80 Credits burned into a page · valued at 80 × the last price, never under the whale line", "<b class=\"a\">WHALE</b> · the harmony moves"],
  ["Statement sale", "a page sold on OpenSea or by Core · price ÷ 80 vs the Credits median, never under a kick, never a whale", "<b>KICK</b> at least · a full-chord stab with a long tail, opened by the price vs the recent pages'"],
  ["overprint", "a page burned onto another, the ink adds up · from the 7th overprint the paper is black", "a double strike a 16th apart and an echo throw · black paper: an octave down, the filter closed"],
  ["lock into BALANCE", "a page WITHDRAWN · its points paid out in BALANCE", "torn tag: sub drop, rumble, echo throw tinted by the ink"],
  ["BALANCE swaps", "the BALANCE/ETH Uniswap v4 pool · never a step, never the tempo", "quiet ornaments, coloured by the ink when one plate leads · at most one an 8th"],
  ["heat", "buy on a full grid (≥48 of 64 bits) + 1 · sell − 1 · 60 min silence → 0", "filter opens · rolls · riser · at 16 the track is complete: <b class=\"a\">DROP</b>"],
  ["tempo", "once per block of sales, from their rhythm", "inside dub techno's range"],
  ["4 pages", "64 notes a page · epoch = page / 4", "the next <b>STYLE</b> of Credits Techno"],
  ["silence", "10 / 30 / 60 min since the last sale", "thinning → sparse → drone"],
];

const NFT_PITCH = `
  <p class="big">every sale is a note.</p>
  <p>The collection's sales on Ethereum, read straight from the chain: its marketplace fills and its own contracts. Nothing off-chain.</p>
  <p>The sales run through the $IDM hook's rules (a 16-step, 4-track pattern and a bass line), replayed from the chain by every listener.</p>`;

const NFT_ROWS: Row[] = [
  ["sale", "one note per item sold", "a step · <span class=\"g\">+</span> buy adds · <span class=\"r\">−</span> sell removes"],
  ["price", "vs the median of the last 127 sales: &lt;0.96× · &lt;1.06× · &lt;1.15× · ≥1.15×", "<b>HAT</b> · <b>GLITCH</b> · <b>SNARE</b> · <b>KICK</b>"],
  ["market cap", "median price × the supply", "bass rhythm · filter and timbre · the whale line"],
  ["tempo", "once per block of sales, from their rhythm", "inside the genre's tempo range"],
  ["silence", "10 / 30 / 60 min since the last sale", "thinning → sparse → drone"],
];

/** Rewrites #how for an nft station; anything else keeps index.html's own (the house page is untouched). */
export function applyNftHow(station: Station | null | undefined) {
  if (station?.kind !== "nft") return;
  const how = document.getElementById("how");
  const pitch = how?.querySelector(".pitch");
  const head = how?.querySelector(".tt-head");
  const body = how?.querySelector("tbody");
  if (!how || !pitch || !head || !body) return;
  const credits = station.key === "credits";
  how.classList.add("how-nft");
  pitch.innerHTML = credits ? CREDITS_PITCH : NFT_PITCH;
  head.innerHTML = `&gt; cat spec/${credits ? "credits" : "collection"}.txt <span class="tt-rules">· rules v2 · off-chain</span>`;
  body.innerHTML = (credits ? CREDITS_ROWS : NFT_ROWS).map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join("");
}
