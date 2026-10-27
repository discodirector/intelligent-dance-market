// The "how" section (index.html #how) of an nft or hamster station: the house text explains the $IDM hook's pool; a
// collection station (registry kind "nft", core nft.ts) and the hamster station (kind "hamster", core hamster.ts) say
// what they read and how each input sounds, in the same layout (the pitch and the `cat spec/…` table). Credits has its
// own copy (its venues, Statements, BALANCE); any other collection a generic one. Static strings only: nothing from
// the chain or the registry reaches the markup. The house page (no station, or a pool station) is left exactly as
// index.html has it.
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

const HAMSTER_PITCH = `
  <p class="big">every 30 m of wheel is a note.</p>
  <p>A real hamster's running wheel at Squeekchain, measured every few seconds by its sensor. We record it around the clock, so every listener hears the same night.</p>
  <p>The wheel runs through the $IDM hook's rules (a 16-step, 4-track pattern and a bass line). The station only listens: nothing here rewards the wheel turning. While the hamster sleeps, the station dreams in ambient.</p>`;

// Sizes: 0.0125 ETH x (speed / usual)^8 against the v2 tiers (0.7x, 1.5x, 3x the typical size) = 0.96x, 1.05x, 1.15x.
const HAMSTER_ROWS: Row[] = [
  ["run", "every 30 m of wheel distance", "a step · <span class=\"g\">+</span> a buy adds"],
  ["speed", "vs the hamster's usual (median of its last 127 running speeds): &lt;0.96× · &lt;1.05× · &lt;1.15× · ≥1.15×", "<b>HAT</b> · <b>GLITCH</b> · <b>SNARE</b> · <b>KICK</b>"],
  ["pace", "median of the last 12 running speeds", "the bass degree · it climbs as a run speeds up"],
  ["rhythm", "the gaps between notes", "a faster run, a faster track · inside the genre's tempo range"],
  ["stop", "the wheel stands still", "<span class=\"r\">−</span> a sell removes · the grid thins, the heat cools"],
  ["milestone", "Squeekchain's distance and speed records, daily distances, streaks", "<b class=\"a\">WHALE</b> · <b class=\"a\">MOVEMENT</b> · drop / fill"],
  ["heat", "a note on a full grid (≥48 of 64 bits) + 1 · a stop − 1 · 60 min without a note → 0", "filter opens · rolls · at 16 the track is complete: <b class=\"a\">DROP</b>"],
  ["4 pages", "64 notes a page · epoch = page / 4", "the next <b>GENRE</b>: acid, electro, UK garage, drum &amp; bass, lo-fi house · its next <b>STYLE</b>"],
  ["sleep", "10 min without a note", "ambient and drone on the frozen pattern · a new dream every 30 min · the next run wakes it"],
  ["Squeekchain events", "settlements, claims and merges on Sepolia", "quiet ornaments, never a note"],
  ["replay", "REPLAY LAST RUN on the wheel screen", "the last finished run again, at 1x"],
];

/** Rewrites #how for an nft or hamster station; anything else keeps index.html's own (the house page is untouched). */
export function applyStationHow(station: Station | null | undefined) {
  if (station?.kind === "hamster") return fill(HAMSTER_PITCH, "wheel", HAMSTER_ROWS);
  if (station?.kind !== "nft") return;
  const credits = station.key === "credits";
  fill(credits ? CREDITS_PITCH : NFT_PITCH, credits ? "credits" : "collection", credits ? CREDITS_ROWS : NFT_ROWS);
}

function fill(pitchHtml: string, spec: string, rows: Row[]) {
  const how = document.getElementById("how");
  const pitch = how?.querySelector(".pitch");
  const head = how?.querySelector(".tt-head");
  const body = how?.querySelector("tbody");
  if (!how || !pitch || !head || !body) return;
  how.classList.add("how-nft");
  pitch.innerHTML = pitchHtml;
  head.innerHTML = `&gt; cat spec/${spec}.txt <span class="tt-rules">· rules v2 · off-chain</span>`;
  body.innerHTML = rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join("");
}
