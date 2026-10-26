// An NFT's on-chain art for the NFT screen (nftscreen.ts), from its tokenURI. No imports: the bot's tests run it too.

/** Larger is not an on-chain SVG token (Credits: ~5-7.5 KB; a Statement page ~70 KB, ~195 KB after seven overprints): refused. */
const MAX_URI = 512_000;

/**
 * The image of a tokenURI: a data:image/svg+xml URL, or null. Only a data:application/json URI is read, and only an
 * image that is itself a data:image/svg+xml URL (a base64 one strictly base64) is returned; the caller sets it as an
 * <img> src, never as markup.
 */
export function svgOfTokenUri(uri: string): string | null {
  if (typeof uri !== "string" || uri.length > MAX_URI) return null;
  const m = /^data:application\/json(;base64|;utf8|;charset=utf-8)?,/i.exec(uri);
  if (!m) return null;
  let text: string;
  try {
    const body = uri.slice(m[0].length);
    if (m[1]?.toLowerCase() === ";base64") text = new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)));
    else {
      // Statements' utf8 JSON is not percent-encoded: a stray "%" is text, not an escape.
      try {
        text = decodeURIComponent(body);
      } catch {
        text = body;
      }
    }
  } catch {
    return null;
  }
  let image: unknown;
  try {
    image = (JSON.parse(text) as { image?: unknown }).image;
  } catch {
    return null;
  }
  if (typeof image !== "string" || !/^data:image\/svg\+xml(;base64|;utf8|;charset=utf-8)?,/i.test(image)) return null;
  // A base64 body must be base64, nothing smuggled after it.
  if (/;base64,/i.test(image) && !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/i.test(image)) return null;
  return image;
}
