// The NFT screen of an nft station (docs/STATIONS.md "NFT stations"): a small LCD on the drum machine that shows the
// item being traded now, its on-chain art. A sale is queued and shown on the next beat, so the screen switches in
// rhythm; with nothing new the last sale stays on the glass (the same one as the LAST SWAP line), so the screen only
// moves when the collection trades.
//
// The art is the collection's own tokenURI (Credits: data:application/json;base64 with a data:image/svg+xml;base64
// image, ~3 KB of SVG, an eth_call of ~0.6-0.9M gas, ~0.3-0.4 s on the public gateways). It is fetched only when the
// item is about to be shown, at most FETCH_LIMIT at a time, and cached. Only a data:image/svg+xml URL is accepted,
// and it is only ever an <img> src (an SVG image cannot run script); nothing from the token reaches the DOM as markup.
//
// Credits extras (core nft.ts tags): a rated sale wears a small "RATING 132 · CK" label on the glass; a BALANCE
// withdraw takes two beats, the locked page (Statements tokenURI, now in its WITHDRAWN format) then the holder's
// Balance artwork (LineageArtwork tokenURI of tokenIdOf(holder): the wallet's CMYK mixture), captioned with the
// points and the release's ink. A Statement sold shows the page (Statements tokenURI, utf8 JSON) labelled "PAGE #id ·
// points"; an overprint the base page after it, labelled "OVERPRINT #base ← #top". Same rules for the art: data SVG
// only, as an <img>; the label is text. Swaps in BALANCE's pool (ornaments) never reach the screen.
import { plateLetters } from "@swarm-sequencer/core";
import { createPublicClient, defineChain, fallback, http, parseAbi, type PublicClient } from "viem";
import type { Network } from "./config";
import { formatQuote, inkText, type SwapEvent } from "./data/types";
import { svgOfTokenUri } from "./tokenuri";

const ABI = parseAbi([
  "function tokenURI(uint256 id) view returns (string)",
  "function tokenIdOf(address wallet) view returns (uint256)",
  "function artwork() view returns (address)",
]);
/** Sales waiting for their beat; a sweep longer than this shows its last ones. */
const QUEUE = 8;
const FETCH_LIMIT = 2;
const CACHE = 256;

/** What a beat shows: a traded item, a locked page, or the wallet that locked it. */
type Kind = "item" | "page" | "wallet";

interface Shown {
  kind: Kind;
  id: string;
  e: SwapEvent;
}

/** The art's cache key: an overprint changes its base page's art, so it is read afresh (its tx in the key). */
const keyOf = (s: Shown) => `${s.kind}:${s.kind === "wallet" ? s.e.nft!.holder : s.id}${s.e.nft!.via === "overprint" ? `:${s.e.tx}` : ""}`;

export class NftScreen {
  private readonly client: PublicClient;
  private readonly cache = new Map<string, Promise<string | null>>();
  /** The settled ones, for a synchronous switch on the beat. */
  private readonly ready = new Map<string, string | null>();
  private readonly waiting: (() => void)[] = [];
  private inFlight = 0;
  private queue: Shown[] = [];
  private current: Shown | null = null;
  private history: Shown | null = null;
  private lastBeat = -1;
  private artwork: Promise<`0x${string}` | null> | null = null;
  private readonly img: HTMLImageElement;
  private readonly text: HTMLElement;
  private readonly cap: HTMLElement;
  private readonly tag: HTMLElement | null;

  constructor(
    private readonly el: HTMLElement,
    net: Network,
    private readonly collection: `0x${string}`,
    private readonly item: string,
    /** Credits: the Statements (a locked page's art) and BALANCE (its artwork() names the wallets' Balance art). */
    private readonly extra: { statements?: `0x${string}`; balance?: `0x${string}` } = {},
  ) {
    const urls = [net.rpcUrl, ...(net.rpcFallbacks ?? [])];
    const chain = defineChain({ id: net.chainId, name: net.label, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: urls } } });
    const transport = urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1, batch: true }))) : http(urls[0], { retryCount: 2, batch: true });
    this.client = createPublicClient({ chain, transport }) as PublicClient;
    this.img = el.querySelector("img")!;
    this.text = el.querySelector(".nft-text")!;
    this.cap = el.querySelector(".nft-cap")!;
    this.tag = el.querySelector(".nft-tag");
    el.hidden = false;
    document.body.classList.add("has-nft-screen");
  }

  /** Every sale, in order; `live` = not the history: it gets a beat of its own. */
  push(e: SwapEvent, live: boolean) {
    if (!e.nft) return;
    const n = e.nft;
    const withdraw = n.via === "withdraw";
    // A withdraw shows the page, then the wallet (when the station knows where the art is); a page sold or overprinted
    // shows the page.
    const shows: Shown[] = withdraw
      ? [
          ...(this.extra.statements ? [{ kind: "page" as const, id: n.id, e }] : []),
          ...(this.extra.balance && n.holder ? [{ kind: "wallet" as const, id: n.id, e }] : []),
        ]
      : n.kind === "statement" || n.via === "overprint"
        ? this.extra.statements ? [{ kind: "page" as const, id: n.id, e }] : []
        : [{ kind: "item", id: n.id, e }];
    if (!shows.length) return;
    if (!live) {
      // The history only sets the glass: its newest sale is shown at the next beat and stays until a new one.
      this.history = shows[shows.length - 1];
      return;
    }
    this.queue.push(...shows);
    if (this.queue.length > QUEUE) this.queue.splice(0, this.queue.length - QUEUE);
    // Lazy: the next ones to show start loading now.
    for (const q of this.queue.slice(0, FETCH_LIMIT)) void this.art(q);
  }

  /** The transport's position in 16ths since its start (main.ts frame): the screen switches on beats. */
  tick(sixteenth: number) {
    const beat = Math.floor(sixteenth / 4);
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    const next = this.queue.shift() ?? (this.current ? undefined : this.history ?? undefined);
    if (!next) return;
    this.show(next);
    if (this.queue[0]) void this.art(this.queue[0]);
  }

  /** The glass's small label: text only (digits and plate letters from the decoder). */
  private label(text: string | null) {
    if (!this.tag) return;
    this.tag.hidden = !text;
    this.tag.textContent = text ?? "";
  }

  private show(s: Shown) {
    this.current = s;
    const { e } = s;
    const n = e.nft!;
    this.el.classList.toggle("buy", e.isBuy && !e.whale);
    this.el.classList.toggle("sell", !e.isBuy && n.via !== "withdraw");
    this.el.classList.toggle("whale", e.whale);
    this.el.classList.toggle("lock", n.via === "withdraw" || n.via === "overprint");
    if (n.via === "compose") {
      this.img.hidden = true;
      this.text.hidden = false;
      this.label(null);
      this.text.textContent = `COMPOSE\n${n.items ?? 80} → PAGE\n#${n.id}`;
      this.cap.textContent = `WHALE ${formatQuote(e.quote)} ETH\n${n.venue.toUpperCase()}`;
      return;
    }
    let alt: string;
    let fallbackText: string;
    if (s.kind === "page" && n.via === "overprint") {
      this.cap.textContent = `OVERPRINT #${n.id}${n.overprints !== undefined ? ` · ${n.overprints}×` : ""}\n${n.points !== undefined ? `${n.points.toLocaleString("en-US")} PTS` : n.venue.toUpperCase()}`;
      this.label(`OVERPRINT #${n.id} ← #${n.top}`);
      alt = `Statement #${n.id}`;
      fallbackText = `OVER\nPRINT\n#${n.id}`;
    } else if (s.kind === "page" && n.kind === "statement") {
      this.cap.textContent = `PAGE #${n.id} ${e.isBuy ? "BUY" : "SELL"}\n${formatQuote(e.quote)} ETH · ${n.venue.toUpperCase()}`;
      this.label(`PAGE #${n.id}${n.points !== undefined ? ` · ${n.points.toLocaleString("en-US")}` : ""}`);
      alt = `Statement #${n.id}`;
      fallbackText = `PAGE\n#${n.id}`;
    } else if (s.kind === "page") {
      this.cap.textContent = `LOCK PAGE #${n.id}\n${(n.points ?? 0).toLocaleString("en-US")} ${n.venue}`;
      this.label("WITHDRAWN");
      alt = `Statement #${n.id}`;
      fallbackText = `LOCK\nPAGE\n#${n.id}`;
    } else if (s.kind === "wallet") {
      this.cap.textContent = `WALLET ${n.holder!.slice(0, 6)}…${n.holder!.slice(-4)}\n${n.ink ? inkText(n.ink) : n.venue}`;
      this.label(n.ink ? inkText(n.ink) : null);
      alt = `Balance of ${n.holder}`;
      fallbackText = `+${(n.points ?? 0).toLocaleString("en-US")}\n${n.venue}`;
    } else {
      this.cap.textContent = `#${n.id} ${e.isBuy ? "BUY" : "SELL"}\n${formatQuote(e.quote)} ETH · ${n.venue.toUpperCase()}`;
      this.label(n.rating !== undefined && n.mask ? `RATING ${Math.floor(n.rating / 10)} · ${plateLetters(n.mask)}` : null);
      alt = `${this.item} #${n.id}`;
      fallbackText = `#${n.id}`;
    }
    this.el.title = alt;
    const paint = (url: string | null) => {
      if (this.current !== s) return;
      this.img.hidden = !url;
      this.text.hidden = !!url;
      if (url) {
        if (this.img.src !== url) this.img.src = url;
        this.img.alt = alt;
      } else this.text.textContent = fallbackText;
    };
    // Art already in: at once, on the beat. Else the number on the glass until it lands.
    const key = keyOf(s);
    if (this.ready.has(key)) paint(this.ready.get(key)!);
    else {
      paint(null);
      void this.art(s).then(paint);
    }
  }

  /** The tokenURI behind a shown thing: the item, the locked page, or the holder's Balance artwork. */
  private async uri(s: Shown): Promise<string> {
    if (s.kind === "item") return this.client.readContract({ address: this.collection, abi: ABI, functionName: "tokenURI", args: [BigInt(s.id)] });
    if (s.kind === "page") return this.client.readContract({ address: this.extra.statements!, abi: ABI, functionName: "tokenURI", args: [BigInt(s.id)] });
    this.artwork ??= this.client.readContract({ address: this.extra.balance!, abi: ABI, functionName: "artwork" }).catch(() => null);
    const art = await this.artwork;
    if (!art) throw new Error("no artwork contract");
    const id = await this.client.readContract({ address: art, abi: ABI, functionName: "tokenIdOf", args: [s.e.nft!.holder as `0x${string}`] });
    return this.client.readContract({ address: art, abi: ABI, functionName: "tokenURI", args: [id] });
  }

  /** The art (cached; FETCH_LIMIT reads at a time), null when there is none (burned, not a data SVG, RPC failed). */
  private art(s: Shown): Promise<string | null> {
    const key = keyOf(s);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = this.slot().then(async (release) => {
      let url: string | null = null;
      try {
        url = svgOfTokenUri(await this.uri(s));
      } catch {
        // Burned (the token is gone) or the RPC failed: no art, the number stays on the glass.
      } finally {
        release();
      }
      this.ready.set(key, url);
      return url;
    });
    this.cache.set(key, p);
    if (this.cache.size > CACHE) {
      const old = this.cache.keys().next().value!;
      this.cache.delete(old);
      this.ready.delete(old);
    }
    return p;
  }

  private slot(): Promise<() => void> {
    const release = () => {
      this.inFlight--;
      this.waiting.shift()?.();
    };
    if (this.inFlight < FETCH_LIMIT) {
      this.inFlight++;
      return Promise.resolve(release);
    }
    return new Promise((res) => this.waiting.push(() => {
      this.inFlight++;
      res(release);
    }));
  }
}
