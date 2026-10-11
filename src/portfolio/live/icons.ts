/**
 * A MARKET'S ICON (Markets' rows and the one drawer): the logo shown beside a market's name, as the address of an image the PAGE loads itself
 * in an <img>. The account never fetches, keeps or serves these images: each comes from where its owner publishes it, and one that does not
 * load leaves the letter tile in its place.
 *
 *   a coin, a coin's perpetual       Elbstream's logo for the coin        https://api.elbstream.com/logos/crypto/BTC
 *   a share or a fund                Elbstream's logo for the ticker      https://api.elbstream.com/logos/symbol/AAPL
 *   a tokenised share                the share's: Ondo's NVDAon, xStocks' NVDAx and Robinhood's NVDA are NVDA's (by their issuers, dex.ts
 *                                    ISSUERS and robinhood.ts STOCK_TOKEN_ISSUER); a fund's token (Ondo's OUSG and USDY, BlackRock's BUIDL)
 *                                    its own coin logo; any other none — a share's ticker read as a coin's symbol can be another token's
 *                                    logo (Elbstream's crypto TSLA is FTX's tokenised Tesla)
 *   a pre-IPO company                the icon of the company's own website (preipo.ts `domain`), through Google's favicon service
 *   an event                         the venue's own picture: Polymarket's for the market or its event and Polymarket US's for the market
 *                                    (Listing `image`, from Polymarket's own host), Kalshi's for the series (its public bucket, by the series
 *                                    every Kalshi market ticker starts with)
 *
 * Elbstream's logos (elbstream.com/logos, read 2026-10-11) are free to show straight from its host in an <img>, with a link to elbstream.com
 * wherever one is shown — the page says "Logos by Elbstream" at 12pt — and keeping or serving them from elsewhere is not part of that plan, so
 * nothing is kept. Only a symbol that reads as one goes into an address, and a venue's picture only from the venue's own host, over https.
 */
import { PRE_IPO_COMPANIES, PRE_IPO_GROUP } from "./preipo.ts";
import { STOCK_TOKEN_ISSUER } from "./robinhood.ts";

export const ELBSTREAM_LOGOS = "https://api.elbstream.com/logos";
const KALSHI_IMAGES = "https://kalshi-public-docs.s3.amazonaws.com/series-images-webp";
const FAVICONS = "https://www.google.com/s2/favicons";
/** where a venue's own picture is taken from: Polymarket's host (Gamma's `icon`, the US gateway's `image`) */
const VENUE_IMAGE_HOSTS: ReadonlySet<string> = new Set(["polymarket-upload.s3.us-east-2.amazonaws.com"]);

/** a coin's symbol as one (BTC, 1INCH); a ticker as one (AAPL, BRK.B); a Kalshi series (KXFEDDECISION) */
const COIN = /^[A-Z0-9]{1,15}$/;
const TICKER = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z0-9]{1,3})?$/;
const SERIES = /^[A-Z][A-Z0-9]{1,40}$/;

/** the issuers whose tokens are funds, not shares (dex.ts ISSUERS): their tokens are shown by their own coin logos */
const FUND_ISSUER = /\bOndo Finance\b|\bBlackRock\b/;

const coinLogo = (symbol: string): string | undefined => (COIN.test(symbol) ? `${ELBSTREAM_LOGOS}/crypto/${symbol}` : undefined);
const tickerLogo = (ticker: string): string | undefined => (TICKER.test(ticker) ? `${ELBSTREAM_LOGOS}/symbol/${encodeURIComponent(ticker)}` : undefined);

/** the share a tokenised share tracks, by its issuer: Ondo's tokens are the ticker and "on", xStocks' the ticker and "x", Robinhood's the
 * ticker itself. Undefined for a token that is not a share */
function shareOf(base: string, issuer: string | undefined): string | undefined {
  if (!issuer) return undefined;
  if (issuer === STOCK_TOKEN_ISSUER) return base;
  if (/\bOndo Global Markets\b/.test(issuer)) return /^(.+)ON$/.exec(base)?.[1];
  if (/\bxStocks\b/.test(issuer)) return /^(.+)X$/.exec(base)?.[1];
  return undefined;
}

/** a venue's own picture, from its own host over https; anything else is not shown */
export function venueImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && VENUE_IMAGE_HOSTS.has(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** a market row's icon (see the top of this file): its key, kind and base as explore.ts makes them, its issuer, its company's group, and for
 * an event the venue's own picture where a listing carried one */
export function iconOf(i: { key: string; kind: string; base?: string | undefined; issuer?: string | undefined; group?: { id: string } | undefined }, image?: string): string | undefined {
  const base = String(i.base ?? "").trim().toUpperCase();
  if (i.kind === "event") {
    const own = venueImage(image);
    if (own) return own;
    const series = i.key.startsWith("kalshi:") ? i.key.slice("kalshi:".length).split("-")[0]!.toUpperCase() : "";
    return SERIES.test(series) ? `${KALSHI_IMAGES}/${series}.webp` : undefined;
  }
  if (i.group?.id.startsWith(PRE_IPO_GROUP)) {
    const company = PRE_IPO_COMPANIES.find((c) => `${PRE_IPO_GROUP}${c.slug}` === i.group!.id);
    return company ? `${FAVICONS}?domain=${encodeURIComponent(company.domain)}&sz=128` : undefined;
  }
  if (i.kind === "stock") return tickerLogo(base);
  if (i.kind === "rwa") {
    const share = shareOf(base, i.issuer);
    if (share) return tickerLogo(share);
    return i.issuer && FUND_ISSUER.test(i.issuer) ? coinLogo(base) : undefined;
  }
  if (i.kind === "coin" || i.kind === "perp") return coinLogo(base);
  return undefined;
}
