// NFT sources (docs/STATIONS.md "NFT stations"): an ERC-721 collection's sales -> the rules input, one input per item
// sold, for a station that plays a collection instead of a pool (first: Credits by Jack Butcher). On-chain data only:
// the collection's Transfer logs say which items moved, and the venue logs of the same transactions say whether it was
// a sale, which side and at what price. Pure, like swaps.ts: callers read the logs over their own RPC (readNftLogs
// takes their eth_getLogs) and hand them to decodeNftLogs(). Site (data/virtual.ts) and bot (station.ts) share it.
//
// Venues, each a claim on one Transfer of the item it names (same transaction, same token id, matching direction):
//   Seaport (OpenSea)  OrderFulfilled. Credits in `offer` = a listing filled: the buyer took it, BUY at the order's
//                      ETH/WETH consideration / items. Credits in `consideration` = a bid or collection offer filled: the
//                      holder hit it, SELL at the order's ETH/WETH offer / items.
//   strategy           a TokenStrategy (CreditStrategy): NFTBoughtByProtocol = someone sold to the protocol's standing
//                      bid, SELL at purchasePrice; NFTSoldByProtocol = someone bought the protocol's relisting, BUY at price.
//   core               Credits Core: CreditBought = a holder sold to Core, SELL at cost; CreditSold / ListingBought =
//                      Core sold one / took a listing, BUY at price / cost.
//   statements         Statements.Composed: 80 Credits burned into a page. One BUY worth 80 x the last per-item price
//                      in the stream (refPrice before any sale), never under the whale line: a compose is a whale.
//   balance            BALANCE (the Statements' ERC-20) Withdrawn: a page locked into BALANCE, its holder paid the
//                      page's credit score in tokens. One SELL of the usual size (a deep event for the engine, not a
//                      whale), tagged with the points (amount / 1e18) and the CMYK split of the release (the InkMoved
//                      from BALANCE to the holder in the same transaction, as whole percent). Core locking a page
//                      emits its own StatementRedeemed beside the Withdrawn: only the Withdrawn is read, so one note.
// A Transfer two venues claim (Core's ListingBought fills a Seaport listing) is one sale: the ecosystem's claim wins,
// then a bid over a listing (a matched bid emits both shapes). A Transfer no venue claims (a gift, a wallet move,
// another market) is not a sale. An item that changes hands twice in one transaction (a router buys a listing and
// sells it to the strategy) is ONE sale: the first hop, the item leaving its holder at the market's price; the later
// hops are the buyer reselling inside the same transaction.
//
// Sound (owner-approved 2026-10-25), all from the stream itself, deterministic and carried across batches:
//   tick     from the MEDIAN of the last NFT_WINDOW item prices (this one included), floor(log_1.0001(1e27 / (median x
//            itemSupply))): the FDV the whale reads (core fdvWeiAtTick) is the collection's market cap in ETH, and a
//            bid/ask flip (~15%) no longer jumps the bass.
//   size     quoteAmt = SIZE_REF x (price / median of the previous NFT_WINDOW prices)^SIZE_POWER, under half the whale
//            line: dearer than usual climbs to snare and kick, cheaper falls to hat. holdSizeEma keeps the rules' size
//            EMA at its start (0.0125 ETH), so the tier is the price ratio alone, not "new vs the last few sizes" (a run
//            of equal prices would otherwise all read as usual). The price itself is in the tag (nft.price).
//   tempo    holdTempo on every item after the first of its block: the rules' interval EMA moves once per block of
//            sales, so a 50-item sweep is one beat of tempo, not fifty (core mutate MutationInput.holdTempo, set by
//            nothing but this decoder).
//   rating   with a rating table (credittable.ts, `opts.ratings`; Credits only): every sale's tag carries the Credit's
//            percentile, plates and score (nft.score / mask / rating). Tags only: the rules input is the same with or
//            without the table, so the state, the tracks and the checkpoints do not depend on it.
// Integers only, so every replay is bit-identical.
import { decodeEventLog, parseAbi, toEventSelector, type Hex } from "viem";
import { whaleWeiAtTick } from "./index.ts";
import type { CreditTable } from "./credittable.ts";
import { parseDecimal, tickAtRatio, type DecodedSwap, type RawLog } from "./swaps.ts";

export interface NftSource {
  kind: "nft";
  /** The ERC-721 collection. */
  collection: Hex;
  /** Item supply for the FDV frame, fixed at registration (the registry's nft.itemSupply). */
  itemSupply: number;
  /** Per-item price (decimal ETH) a compose is valued at before the stream has seen a sale. */
  refPrice: string;
  /** Seaport deployments whose OrderFulfilled fills count (OpenSea: 1.6). */
  seaport?: Hex[];
  /** TokenStrategy (NFTBoughtByProtocol / NFTSoldByProtocol). */
  strategy?: Hex;
  /** Credits Core (CreditBought / CreditSold / ListingBought). */
  core?: Hex;
  /** Statements (Composed: 80 Credits burned into a page). */
  statements?: Hex;
  /** BALANCE, the Statements' ERC-20 (Withdrawn: a page locked, the holder paid its score; InkMoved: the CMYK split). */
  balance?: Hex;
  /** The offline rating table the station tags its sales with (credittable.ts): "credits". Tags only, not the rules. */
  ratings?: "credits";
  /** The chain's WETH: a Seaport amount in WETH counts as ETH. */
  weth: Hex;
  /** Never: the frame is itemSupply (a pool's calibration does not apply). Typed so `source.calibration` reads on either kind. */
  calibration?: undefined;
}

/** How a sale happened (the feed line and the NFT screen say it). */
export type NftVia = "listing" | "bid" | "strategy-buy" | "strategy-sell" | "core-buy" | "core-sell" | "core-listing" | "compose" | "withdraw";

/** What the station shows about an input besides the rules' fields. */
export interface NftTag {
  /** The Credit's token id (compose, withdraw: the page's statement id), decimal string. */
  id: string;
  via: NftVia;
  /** Display name of the venue: OpenSea, Seaport, CreditStrategy, Core, Statements, BALANCE. */
  venue: string;
  /** Compose only: items burned. */
  items?: number;
  /** The item's price, wei, decimal string (a compose: what it was valued at, 80 x the item price; a withdraw: "0"). */
  price: string;
  /** Rated sales (a rating table): the Credit's percentile in the edition by score, 0..255. */
  score?: number;
  /** Rated sales: its CMYK plates, 1..15 (bit0 C, bit1 M, bit2 Y, bit3 K). */
  mask?: number;
  /** Rated sales: its credit score in tenths of a point (1324 = 132.4). */
  rating?: number;
  /** Withdraw only: the BALANCE released, whole tokens (= the page's credit score in points). */
  points?: number;
  /** Withdraw only: the release's CMYK split, whole percent [c, m, y, k] (floor; absent when the tx has no InkMoved). */
  ink?: [number, number, number, number];
  /** Withdraw only: who locked the page (lowercase address). */
  holder?: string;
}

export interface DecodedSale extends DecodedSwap {
  nft: NftTag;
  /** Per-item price, wei (a compose: the item price it was valued at). */
  price: bigint;
  /** Not the first input of its block: the rules leave the tempo alone (core MutationInput.holdTempo). */
  holdTempo?: true;
  /** Always: the size is already relative to the recent median, the rules' size EMA stays put (MutationInput.holdSizeEma). */
  holdSizeEma: true;
}

/** What the decoder carries from one batch to the next (and the bot's checkpoint to the site). */
export interface NftCarry {
  /** wei, or null before the first sale. */
  lastPrice: bigint | null;
  /** The last NFT_WINDOW item prices, oldest first (the median's window). Absent = empty. */
  recent?: bigint[];
}

/**
 * Item prices the median reads (tick and size): long enough that a 50-item sweep at one price does not become "usual"
 * by itself, so bids and asks sit on either side of it.
 */
export const NFT_WINDOW = 127;
/** The size of an item at the median price: 0.0125 ETH, the rules' starting size EMA. */
export const NFT_SIZE_REF = 12_500_000_000_000_000n;
/**
 * How hard the price ratio drives the size: (price / median)^8 against the frozen size EMA (0.0125 ETH): under 0.957x
 * is a hat, over 1.055x a snare, over 1.145x a kick (the v2 relative tiers -8 / 10 / 25 sixteenths of an octave).
 */
export const NFT_SIZE_POWER = 8;

/** The carry as JSON (checkpoint, bot cache): wei as decimal strings. */
export const nftCarryToJSON = (c: NftCarry) => ({ lastPrice: c.lastPrice === null ? null : c.lastPrice.toString(), recent: (c.recent ?? []).map(String) });
export type NftCarryJSON = ReturnType<typeof nftCarryToJSON>;
/** And back; anything malformed reads as empty. */
export function nftCarryFromJSON(j: { lastPrice?: string | null; recent?: string[] } | null | undefined): NftCarry {
  const ok = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
  return { lastPrice: ok(j?.lastPrice) ? BigInt(j!.lastPrice!) : null, recent: Array.isArray(j?.recent) ? j!.recent!.filter(ok).map(BigInt).slice(-NFT_WINDOW) : [] };
}

/** Lower median of a list (sorted copy). */
function median(xs: readonly bigint[]): bigint {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[(s.length - 1) >> 1];
}

/** Items a Statements compose burns (Composed's uint256[80]). */
export const COMPOSE_ITEMS = 80;
/** OpenSea's fee recipient: a Seaport fill that pays it is an OpenSea sale. */
export const OPENSEA_FEE = "0x0000a26b00c1f0df003000390027140000faa719";
/** Seaport 1.6, the deployment OpenSea fills on every chain. */
export const SEAPORT_1_6: Hex = "0x0000000000000068F116a894984e2DB1123eB395";

export const NFT_EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "struct SpentItem { uint8 itemType; address token; uint256 identifier; uint256 amount; }",
  "struct ReceivedItem { uint8 itemType; address token; uint256 identifier; uint256 amount; address recipient; }",
  "event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, SpentItem[] offer, ReceivedItem[] consideration)",
  "event NFTBoughtByProtocol(uint256 indexed tokenId, uint256 purchasePrice, uint256 listPrice)",
  "event NFTSoldByProtocol(uint256 indexed tokenId, uint256 price, address buyer)",
  "event CreditBought(uint256 indexed id, address indexed from, uint256 cost, uint256 toArtist)",
  "event CreditSold(uint256 indexed id, address indexed buyer, uint256 price, uint256 toArtist, uint256 toOperator)",
  "event ListingBought(uint256 indexed id, address indexed adapter, address indexed caller, uint256 cost, uint256 paid, uint256 rate, uint256 toArtist)",
  "event Composed(uint256 indexed statementId, address indexed by, uint256[80] creditIds, uint8 format)",
  "event Withdrawn(uint256 indexed statementId, address indexed holder, uint256 amount)",
  "event InkMoved(address indexed from, address indexed to, uint256[4] ink)",
]);
type EventName = "Transfer" | "OrderFulfilled" | "NFTBoughtByProtocol" | "NFTSoldByProtocol" | "CreditBought" | "CreditSold" | "ListingBought" | "Composed" | "Withdrawn" | "InkMoved";
const ev = (name: EventName) => NFT_EVENTS.find((e) => e.type === "event" && e.name === name)!;
export const NFT_TOPICS = Object.fromEntries(
  (["Transfer", "OrderFulfilled", "NFTBoughtByProtocol", "NFTSoldByProtocol", "CreditBought", "CreditSold", "ListingBought", "Composed", "Withdrawn", "InkMoved"] as const).map((n) => [n, toEventSelector(ev(n) as never)]),
) as Record<EventName, Hex>;

const ZERO = "0x0000000000000000000000000000000000000000";
const lc = (a: string) => a.toLowerCase();
const addrTopic = (t: Hex | undefined) => (t ? "0x" + t.slice(26).toLowerCase() : "");
type Filter = { address: Hex | Hex[]; topics: (Hex | Hex[])[] };

/** The collection's Transfer logs: which items moved (read first, over the whole range). */
export const nftTransferFilter = (src: NftSource): Filter => ({ address: src.collection, topics: [NFT_TOPICS.Transfer] });

/** The ecosystem contracts' sale events (collection-only contracts: read over the whole range, like the Transfers). */
export function nftEcoFilter(src: NftSource): Filter | null {
  const address = [src.strategy, src.core, src.statements, src.balance].filter((a): a is Hex => !!a);
  if (!address.length) return null;
  const topics: Hex[] = [];
  if (src.strategy) topics.push(NFT_TOPICS.NFTBoughtByProtocol, NFT_TOPICS.NFTSoldByProtocol);
  if (src.core) topics.push(NFT_TOPICS.CreditBought, NFT_TOPICS.CreditSold, NFT_TOPICS.ListingBought);
  if (src.statements) topics.push(NFT_TOPICS.Composed);
  if (src.balance) topics.push(NFT_TOPICS.Withdrawn);
  return { address, topics: [topics] };
}

/**
 * BALANCE's releases: InkMoved FROM the BALANCE contract (a withdraw's payout; every other BALANCE transfer moves ink
 * too, ~12k a day, so the filter names the sender). Read over the whole range like the ecosystem events.
 */
export function nftInkFilter(src: NftSource): Filter | null {
  if (!src.balance) return null;
  return { address: src.balance, topics: [NFT_TOPICS.InkMoved, ("0x" + "0".repeat(24) + src.balance.slice(2).toLowerCase()) as Hex] };
}

/**
 * Seaport fills (every collection's, ~0.8 a block on Ethereum): read only at the blocks where the collection moved
 * (nftSaleRanges), since OrderFulfilled cannot be filtered by collection.
 */
export function nftSeaportFilter(src: NftSource): Filter | null {
  if (!src.seaport?.length) return null;
  return { address: src.seaport.length === 1 ? src.seaport[0] : src.seaport, topics: [NFT_TOPICS.OrderFulfilled] };
}

/**
 * Block ranges to read Seaport at: every block with a Transfer that is neither a mint nor a burn, neighbours merged
 * when at most `gap` blocks apart (a few foreign fills cost less than a request), a range at most `maxLen` blocks.
 * Credits, 2 days (2026-10-25): 496 sale blocks -> 412 ranges covering 545 blocks (gap 8 / 64: 263 ranges but twice
 * the foreign fills, ~3.3 MB of other collections' logs instead of ~1.7 MB).
 */
export function nftSaleRanges(transfers: readonly RawLog[], gap = 2, maxLen = 16): [bigint, bigint][] {
  const blocks = [...new Set(transfers.filter((l) => l.topics.length === 4 && l.topics[0]?.toLowerCase() === NFT_TOPICS.Transfer && addrTopic(l.topics[1]) !== ZERO && addrTopic(l.topics[2]) !== ZERO).map((l) => l.blockNumber))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: [bigint, bigint][] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && b - last[1] <= BigInt(gap) && b - last[0] < BigInt(maxLen)) last[1] = b;
    else out.push([b, b]);
  }
  return out;
}

/**
 * Every log a range of the collection needs, in requests the caller's `getLogs` serves (it does its own chunking):
 * the Transfers, the ecosystem events and BALANCE's releases over [from, to], then Seaport at the sale blocks,
 * `concurrency` at a time. Returns them unsorted; decodeNftLogs sorts. Request count: 2 (3 with `balance`) + one per
 * sale range.
 */
export async function readNftLogs(
  src: NftSource,
  from: bigint,
  to: bigint,
  getLogs: (filter: Filter, from: bigint, to: bigint) => Promise<RawLog[]>,
  opts: { concurrency?: number; gap?: number; maxLen?: number } = {},
): Promise<RawLog[]> {
  const eco = nftEcoFilter(src);
  const ink = nftInkFilter(src);
  const [transfers, ecoLogs, inkLogs] = await Promise.all([
    getLogs(nftTransferFilter(src), from, to),
    eco ? getLogs(eco, from, to) : Promise.resolve([]),
    ink ? getLogs(ink, from, to) : Promise.resolve([]),
  ]);
  const sea = nftSeaportFilter(src);
  const ranges = sea ? nftSaleRanges(transfers, opts.gap, opts.maxLen) : [];
  const fills: RawLog[][] = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      fills[i] = await getLogs(sea!, ranges[i][0], ranges[i][1]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, ranges.length) }, worker));
  return [...transfers, ...ecoLogs, ...inkLogs, ...fills.flat()];
}

interface Claim {
  id: bigint;
  via: Exclude<NftVia, "compose">;
  venue: string;
  isBuy: boolean;
  price: bigint;
  /** The Transfer it names: from / to (lowercase), empty = any. */
  from?: string;
  to?: string;
  /** 0 = ecosystem, 1 = Seaport bid, 2 = Seaport listing: the lower wins a Transfer two venues claim. */
  rank: number;
  used?: boolean;
}

const itemIsNft = (src: NftSource, it: { itemType: number; token: string }) => (it.itemType === 2 || it.itemType === 4) && lc(it.token) === lc(src.collection);
const itemIsEth = (src: NftSource, it: { itemType: number; token: string }) => it.itemType === 0 || (it.itemType === 1 && lc(it.token) === lc(src.weth));

/** The collection's claims of one OrderFulfilled (listing or bid; an order with Credits on both sides is a swap: none). */
function seaportClaims(src: NftSource, l: RawLog): Claim[] {
  const { args } = decodeEventLog({ abi: [ev("OrderFulfilled")], data: l.data, topics: l.topics as [Hex, ...Hex[]] }) as unknown as {
    args: { offerer: Hex; recipient: Hex; offer: readonly { itemType: number; token: Hex; identifier: bigint; amount: bigint }[]; consideration: readonly { itemType: number; token: Hex; identifier: bigint; amount: bigint; recipient: Hex }[] };
  };
  const inOffer = args.offer.filter((it) => itemIsNft(src, it));
  const inCons = args.consideration.filter((it) => itemIsNft(src, it));
  if (inOffer.length && inCons.length) return [];
  const venue = args.consideration.some((it) => lc(it.recipient) === OPENSEA_FEE) ? "OpenSea" : "Seaport";
  if (inOffer.length) {
    const total = args.consideration.filter((it) => itemIsEth(src, it)).reduce((a, it) => a + it.amount, 0n);
    const price = total / BigInt(inOffer.length);
    return inOffer.map((it) => ({ id: it.identifier, via: "listing", venue, isBuy: true, price, from: lc(args.offerer), rank: 2 }));
  }
  if (inCons.length) {
    const total = args.offer.filter((it) => itemIsEth(src, it)).reduce((a, it) => a + it.amount, 0n);
    const price = total / BigInt(inCons.length);
    return inCons.map((it) => ({ id: it.identifier, via: "bid", venue, isBuy: false, price, to: lc(it.recipient), rank: 1 }));
  }
  return [];
}

/** An ecosystem contract's claim (strategy or Core), or null for an event that is not one of its sales. */
function ecoClaim(src: NftSource, l: RawLog, topic: string): Claim | null {
  const a = lc(l.address ?? "");
  const decode = (name: EventName) => decodeEventLog({ abi: [ev(name)], data: l.data, topics: l.topics as [Hex, ...Hex[]] }).args as unknown as Record<string, bigint & Hex>;
  if (src.strategy && a === lc(src.strategy)) {
    const strategy = lc(src.strategy);
    if (topic === NFT_TOPICS.NFTBoughtByProtocol) {
      const e = decode("NFTBoughtByProtocol");
      return { id: e.tokenId, via: "strategy-sell", venue: "CreditStrategy", isBuy: false, price: e.purchasePrice, to: strategy, rank: 0 };
    }
    if (topic === NFT_TOPICS.NFTSoldByProtocol) {
      const e = decode("NFTSoldByProtocol");
      return { id: e.tokenId, via: "strategy-buy", venue: "CreditStrategy", isBuy: true, price: e.price, from: strategy, rank: 0 };
    }
  }
  if (src.core && a === lc(src.core)) {
    const core = lc(src.core);
    if (topic === NFT_TOPICS.CreditBought) {
      const e = decode("CreditBought");
      return { id: e.id, via: "core-sell", venue: "Core", isBuy: false, price: e.cost, from: lc(e.from), to: core, rank: 0 };
    }
    if (topic === NFT_TOPICS.CreditSold) {
      const e = decode("CreditSold");
      return { id: e.id, via: "core-buy", venue: "Core", isBuy: true, price: e.price, from: core, to: lc(e.buyer), rank: 0 };
    }
    if (topic === NFT_TOPICS.ListingBought) {
      const e = decode("ListingBought");
      return { id: e.id, via: "core-listing", venue: "Core", isBuy: true, price: e.cost, to: core, rank: 0 };
    }
  }
  return null;
}

/** The FDV-frame tick of a per-item price (see the header). */
export const nftTick = (src: NftSource, price: bigint): number => tickAtRatio(10n ** 27n, price * BigInt(src.itemSupply));

/** refPrice in wei. */
export const nftRefPriceWei = (src: NftSource): bigint => {
  const { num, den } = parseDecimal(src.refPrice);
  return (num * 10n ** 18n) / den;
};

/**
 * Decodes a batch of a collection's logs (readNftLogs: whole blocks, any order) into rules inputs, one per item sold,
 * ordered by block, log index (the Transfer's; a compose: its Composed; a withdraw: its Withdrawn) and token id. `carry`
 * is the previous batch's (null price at genesis); the returned one goes to the next batch, so a split read decodes
 * exactly like one read. `opts.ratings`: the source's rating table (credittable.ts), when loaded: sales are tagged.
 */
export function decodeNftLogs(
  src: NftSource,
  logs: readonly RawLog[],
  carry: NftCarry = { lastPrice: null },
  opts: { ratings?: CreditTable | null } = {},
): { sales: DecodedSale[]; carry: NftCarry } {
  const byTx = new Map<string, RawLog[]>();
  for (const l of logs) {
    const k = lc(l.transactionHash);
    if (!byTx.has(k)) byTx.set(k, []);
    byTx.get(k)!.push(l);
  }
  const collection = lc(src.collection);
  const seaports = new Set((src.seaport ?? []).map(lc));
  const balance = src.balance ? lc(src.balance) : null;
  const out: (Omit<DecodedSale, "tick" | "quoteAmt" | "nft" | "holdTempo" | "holdSizeEma"> & { nft: Omit<NftTag, "price">; compose?: true; withdraw?: true })[] = [];
  for (const txLogs of byTx.values()) {
    /** Items this transaction already sold: a later hop of the same item is the buyer reselling, not a new sale. */
    const sold = new Set<bigint>();
    const sorted = [...txLogs].sort((a, b) => a.logIndex - b.logIndex);
    if (!sorted.some((l) => lc(l.address ?? "") === collection || (balance !== null && lc(l.address ?? "") === balance))) continue;
    const claims: Claim[] = [];
    for (const l of sorted) {
      const a = lc(l.address ?? "");
      const topic = l.topics[0]?.toLowerCase() ?? "";
      if (seaports.has(a) && topic === NFT_TOPICS.OrderFulfilled) claims.push(...seaportClaims(src, l));
      else if (a !== collection) {
        const c = ecoClaim(src, l, topic);
        if (c) claims.push(c);
      }
    }
    const ts = (l: RawLog) => (l.blockTimestamp ? Number(l.blockTimestamp) : undefined);
    for (const l of sorted) {
      const a = lc(l.address ?? "");
      const topic = l.topics[0]?.toLowerCase() ?? "";
      if (balance !== null && a === balance && topic === NFT_TOPICS.Withdrawn && l.topics.length === 3) {
        const holder = addrTopic(l.topics[2]);
        const amount = BigInt(l.data.slice(0, 66));
        // The release: the last InkMoved from BALANCE to the holder before the Withdrawn (same tx).
        let ink: NftTag["ink"];
        for (const m of sorted) {
          if (m.logIndex >= l.logIndex) break;
          if (lc(m.address ?? "") !== balance || m.topics[0]?.toLowerCase() !== NFT_TOPICS.InkMoved || addrTopic(m.topics[1]) !== balance || addrTopic(m.topics[2]) !== holder) continue;
          const parts = [0, 1, 2, 3].map((k) => BigInt("0x" + m.data.slice(2 + 64 * k, 66 + 64 * k)));
          const sum = parts.reduce((x, y) => x + y, 0n);
          if (sum > 0n) ink = parts.map((x) => Number((x * 100n) / sum)) as [number, number, number, number];
        }
        out.push({
          isBuy: false, price: 0n, blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash, timestamp: ts(l) || undefined,
          nft: { id: BigInt(l.topics[1]!).toString(), via: "withdraw", venue: "BALANCE", points: Number(amount / 10n ** 18n), holder, ...(ink ? { ink } : {}) },
          withdraw: true,
        });
        continue;
      }
      if (src.statements && a === lc(src.statements) && topic === NFT_TOPICS.Composed) {
        out.push({
          isBuy: true, price: 0n, blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash, timestamp: ts(l) || undefined,
          nft: { id: BigInt(l.topics[1]!).toString(), via: "compose", venue: "Statements", items: COMPOSE_ITEMS }, compose: true,
        });
        continue;
      }
      if (a !== collection || topic !== NFT_TOPICS.Transfer || l.topics.length !== 4) continue;
      const from = addrTopic(l.topics[1]), to = addrTopic(l.topics[2]);
      if (from === ZERO || to === ZERO) continue;
      const id = BigInt(l.topics[3]!);
      const fits = (c: Claim) => !c.used && c.id === id && (!c.from || c.from === from) && (!c.to || c.to === to);
      const hits = claims.filter(fits).sort((x, y) => x.rank - y.rank);
      if (!hits.length) continue;
      const win = hits[0];
      // The winner and every Seaport claim on the same Transfer are spent (a fill the ecosystem event already tells).
      for (const h of hits) if (h === win || h.rank > 0) h.used = true;
      if (win.price <= 0n || sold.has(id)) continue;
      sold.add(id);
      const r = opts.ratings?.get(id);
      out.push({
        isBuy: win.isBuy, price: win.price, blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash, timestamp: ts(l) || undefined,
        nft: { id: id.toString(), via: win.via, venue: win.venue, ...(r ? { score: r.pct, mask: r.mask, rating: r.score } : {}) },
      });
    }
  }
  out.sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex !== b.logIndex ? a.logIndex - b.logIndex : BigInt(a.nft.id) < BigInt(b.nft.id) ? -1 : 1));
  let last = carry.lastPrice;
  const recent = [...(carry.recent ?? [])].slice(-NFT_WINDOW);
  const ref = nftRefPriceWei(src);
  const sales: DecodedSale[] = [];
  let prevBlock: bigint | null = null;
  for (const o of out) {
    const { compose, withdraw, ...rest } = o;
    // The tempo moves once per block of sales (a batch holds whole blocks, so the first of a block is always seen).
    const hold = prevBlock === o.blockNumber ? { holdTempo: true as const } : {};
    prevBlock = o.blockNumber;
    if (withdraw) {
      // A lock: the usual size at the current median's tick; the price window is left alone.
      const price = last ?? ref;
      const tick = nftTick(src, recent.length ? median(recent) : price);
      sales.push({ ...rest, ...hold, holdSizeEma: true, nft: { ...rest.nft, price: "0" }, price, tick, quoteAmt: NFT_SIZE_REF });
      continue;
    }
    if (compose) {
      const price = last ?? ref;
      const tick = nftTick(src, recent.length ? median(recent) : price);
      const value = price * BigInt(COMPOSE_ITEMS);
      const whale = whaleWeiAtTick(tick);
      sales.push({ ...rest, ...hold, holdSizeEma: true, nft: { ...rest.nft, price: value.toString() }, price, tick, quoteAmt: value > whale ? value : whale });
      continue;
    }
    const p = o.price;
    // Size against the window before this sale; the tick from the window with it.
    const usual = recent.length ? median(recent) : ref;
    recent.push(p);
    if (recent.length > NFT_WINDOW) recent.shift();
    last = p;
    const tick = nftTick(src, median(recent));
    const k = BigInt(NFT_SIZE_POWER);
    const cap = whaleWeiAtTick(tick) / 2n;
    let size = (NFT_SIZE_REF * p ** k) / usual ** k;
    if (size > cap) size = cap;
    if (size < 1n) size = 1n;
    sales.push({ ...rest, ...hold, holdSizeEma: true, nft: { ...rest.nft, price: p.toString() }, tick, quoteAmt: size });
  }
  return { sales, carry: { lastPrice: last, recent } };
}

/** Rating tables a station can name (nft.ratings): credittable.ts tables shipped in core's data/. */
export const NFT_RATINGS = ["credits"] as const;

/** Problems of a registry entry's `nft` block (validate.mjs mirrors it for plain node). */
export function nftConfigProblems(n: unknown): string[] {
  if (!n || typeof n !== "object" || Array.isArray(n)) return ["nft must be an object"];
  const out: string[] = [];
  const { itemSupply, refPrice, seaport, strategy, core, statements, balance, ratings, ...rest } = n as Record<string, unknown>;
  const isAddr = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
  for (const k of Object.keys(rest)) out.push(`nft.${k}: unknown field`);
  if (!Number.isSafeInteger(itemSupply) || (itemSupply as number) <= 0) out.push("nft.itemSupply must be a positive integer");
  if (typeof refPrice !== "string" || !/^\d+(\.\d+)?$/.test(refPrice) || !/[1-9]/.test(refPrice)) out.push('nft.refPrice must be a positive decimal string (ETH), e.g. "0.01"');
  if (seaport !== undefined && (!Array.isArray(seaport) || !seaport.length || !seaport.every(isAddr))) out.push("nft.seaport must be a list of addresses");
  for (const [k, v] of Object.entries({ strategy, core, statements, balance })) if (v !== undefined && !isAddr(v)) out.push(`nft.${k} must be an address`);
  if (ratings !== undefined && !NFT_RATINGS.includes(ratings as never)) out.push(`nft.ratings must be one of ${NFT_RATINGS.join(", ")}`);
  if (seaport === undefined && strategy === undefined && core === undefined) out.push("nft needs a venue: seaport, strategy or core");
  return out;
}
