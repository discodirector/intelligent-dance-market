// Credit ratings (docs/STATIONS.md "Credit rating and plates"): an offline, immutable table of every Credit's score
// and plates, built once from the chain (scripts/build-credit-scores.ts: Credits.Distributed seeds and payment
// seconds through a port of CreditScore, checked against eth_call scoreOf). The rating is not in tokenURI and a pure
// call per sale is a request per note; the edition is sealed, so the table never changes. Pure: callers fetch the
// bytes (bot: fs + gunzip; site: lazy fetch + DecompressionStream) and hand them to parseCreditTable.
//
// Format "CRS2" (data/credit-scores.bin.gz, gzipped; planes, so gzip sees like bytes together):
//   magic "CRS2" · u32 LE first id · u32 LE count · mask[count] u8 · scoreHi[count] u8 · scoreLo[count] u8
//   mask   the Credit's CMYK plates (paidAt % 15 + 1): bit0 C, bit1 M, bit2 Y, bit3 K; 0 = no such Credit
//   score  CreditScore.scoreOf in tenths of a point, 800..8000 (Credit #1: 1324 = 132.4), split high / low byte
// The percentile is not stored (it is a function of the scores): parseCreditTable ranks the whole edition once,
//   pct = floor(256 x (Credits scoring strictly lower) / Credits), 0..255.

/** One Credit's rating. */
export interface CreditRating {
  /** Percentile by score over the whole edition, 0..255 (255 = the top 1/256). */
  pct: number;
  /** CMYK plates, 1..15: bit0 C, bit1 M, bit2 Y, bit3 K. */
  mask: number;
  /** Score in tenths of a point (800..8000). */
  score: number;
}

export interface CreditTable {
  firstId: number;
  /** Ids covered (firstId .. firstId + count - 1). */
  count: number;
  /** The Credit's rating, or null for an id outside the edition. */
  get(id: number | bigint | string): CreditRating | null;
}

const MAGIC = [0x43, 0x52, 0x53, 0x32]; // "CRS2"
/** Scores are tenths of a point under this. */
const SCORE_CAP = 1 << 16;

/** The table's bytes (uncompressed). `rows[i]` is Credit firstId + i ({mask, score}); a missing Credit has mask 0. */
export function encodeCreditTable(firstId: number, rows: readonly { mask: number; score: number }[]): Uint8Array {
  const n = rows.length;
  const out = new Uint8Array(12 + n * 3);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(4, firstId, true);
  dv.setUint32(8, n, true);
  rows.forEach((r, i) => {
    out[12 + i] = r.mask;
    out[12 + n + i] = r.score >> 8;
    out[12 + 2 * n + i] = r.score & 0xff;
  });
  return out;
}

/** Reads a CRS2 table (uncompressed bytes); throws on anything else. */
export function parseCreditTable(bytes: Uint8Array): CreditTable {
  if (bytes.length < 12 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("credit table: bad magic");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstId = dv.getUint32(4, true);
  const count = dv.getUint32(8, true);
  if (bytes.length !== 12 + count * 3) throw new Error(`credit table: ${bytes.length} bytes for ${count} Credits`);
  const mask = bytes.subarray(12, 12 + count);
  const hi = bytes.subarray(12 + count, 12 + 2 * count);
  const lo = bytes.subarray(12 + 2 * count, 12 + 3 * count);
  // Rank once: below[s] = Credits scoring strictly under s.
  const hist = new Uint32Array(SCORE_CAP + 1);
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (!mask[i]) continue;
    hist[((hi[i] << 8) | lo[i]) + 1]++;
    n++;
  }
  for (let s = 1; s <= SCORE_CAP; s++) hist[s] += hist[s - 1];
  return {
    firstId,
    count,
    get(id) {
      let i: number;
      try {
        i = Number(BigInt(id)) - firstId;
      } catch {
        return null;
      }
      if (!Number.isSafeInteger(i) || i < 0 || i >= count || !mask[i]) return null;
      const score = (hi[i] << 8) | lo[i];
      return { pct: Math.min(255, Math.floor((256 * hist[score]) / n)), mask: mask[i], score };
    },
  };
}

/** "CK", "CMYK": the plates of a mask in CMYK order. */
export const plateLetters = (mask: number): string => ["C", "M", "Y", "K"].filter((_, i) => (mask >> i) & 1).join("");

/** How many plates a mask prints (1..4). */
export const plateCount = (mask: number): number => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);

/** The percentile a Credit needs to be in the top ~5% (pct >= this: 13/256 of the edition). */
export const CREDIT_TOP_PCT = 243;
