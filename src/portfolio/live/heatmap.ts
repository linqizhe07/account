/** THE HEATMAP, KEYLESS (after Finviz's map of the market): the US stock market's day as one picture — the largest US-listed companies by
 * market cap, each a tile sized by that cap and coloured by its change from its last regular close, grouped by sector and industry — for
 * the Markets pane's Heatmap tab (ui/heatmap.js) and for an agent (portfolio_heatmap). Two of Nasdaq's own endpoints, each through the
 * fixed-host guard (public-markets.ts fixedHosts) and the account's one line for Nasdaq (history.ts hostLane: four GETs a second on the
 * whole, shared with the real-time quote chain), sent with a desktop browser's user-agent as the quote chain sends its (us-quotes.ts
 * NASDAQ_UA: without one Nasdaq resets the stream). Their shapes, as read keyless from this machine on Wed 2026-10-28, 13:02–13:10 New
 * York (the regular session):
 *   GET api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true      NASDAQ'S STOCK SCREENER, every US-listed
 *                       share in one answer (7,010 rows, 2.2 MB, 3.1 s that day): {data: {asOf: null, rows: [{symbol, name, lastsale
 *                       "$177.49", netchange "1.53", pctchange "0.87%", volume "2292271", marketCap "50039552296.00", country, ipoyear,
 *                       sector "Industrials", industry "Biotechnology: Laboratory Analytical Instruments", url}]}}. Its price and change
 *                       are THE LAST CLOSE'S, not the day's (at 13:02 New York NVDA's lastsale was $217.94 — the previous close, as the
 *                       watchlist's previousClosePrice said beside a real-time $217.615 — and the table variant's `asof` read "Last price
 *                       as of Oct 27, 2026"): so the screener SIZES the tiles (marketCap, as of that close) and names each company, its
 *                       sector and its industry, and never colours one. 5,716 rows carried a market cap and a sector; among them preferred
 *                       shares, notes, warrants, rights, SPAC units, blank-check companies and depositary fractions of a preferred (GOOGM,
 *                       "Depositary Shares representing a 1/20th Interest…") each listed with the issuer's whole market cap: isShare leaves
 *                       them out, so a tile is one share of one company (a dual-class company has two: GOOGL and GOOG, BRK/A and BRK/B — a
 *                       class is written with a slash there and with a dot here, BRK.B, as the account writes it everywhere else).
 *                       American Depositary Shares are kept: TSM, ASML and SKHY trade here. Kept UNIVERSE_KEEP_MS
 *   GET api.nasdaq.com/api/quote/watchlist?symbol=nvda|stocks&symbol=aapl|stocks…                 NASDAQ'S WATCHLIST QUOTE, at most TWENTY
 *                       symbols a call (a hundred asked answered the first twenty; 250 answered a 404 page, 500 a 400): {data: [{symbol,
 *                       companyName, lastSalePrice "$217.585", netChange "-0.355", percentageChange "-0.16%", deltaIndicator,
 *                       lastTradeTimestamp "Oct 28, 2026 1:03 PM ET", lastTradeTimestampDateTime "2026-10-28T13:03:53.3617664-04:00",
 *                       volume "35,393,642", assetClass, previousClosePrice 217.94, openingPrice 219.89, marketStatus "Market Open"}]}
 *                       — the same real-time last sale the quote chain reads one symbol at a time (/api/quote/{SYM}/info), with its change
 *                       FROM THE LAST REGULAR CLOSE (netChange and percentageChange are from previousClosePrice: in pre-market and
 *                       after-hours the extended session's last trade against yesterday's close, as the info endpoint's are; while the
 *                       market is closed the last session's close and its change, which the map then says it shows). Twenty symbols
 *                       answered in 0.3–3.7 s. A class share asked as brk/b is answered as BRK.B. Kept QUOTES_KEEP_MS in a session,
 *                       QUOTES_CLOSED_KEEP_MS while the market is closed; the `n` tiles are asked in ceil(n / 20) calls, each waiting its
 *                       turn in the account's Nasdaq line, and a tile Nasdaq did not price carries no change (grey on the map, said so)
 * A refusal of either — a 429, an edge's page, a place rule, no answer — is said in Nasdaq's own words (public-markets.ts publicNo) and
 * held as any public source's is (holdBackMs): the map keeps the quotes it has, each with its own stamp, and says what is not shown. These
 * are nasdaq.com's own unofficial endpoints, not a licensed feed: either may change or refuse without notice. Nothing here is estimated: a
 * share's change is Nasdaq's figure or none, a sector's change the market-cap-weighted mean of the changes its priced tiles carry. */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { usSessionFull } from "../account/calendar.ts";
import { no } from "../refuse.ts";
import { hostLane, type Pace } from "./history.ts";
import { fin, holdBackMs, isRec, list, publicNo, rec, str } from "./public-markets.ts";
import type { MarketSession } from "./trade.ts";
import { realHttp, unreachable, type Http, type HttpReply } from "./types.ts";
import { NASDAQ_UA, nasdaqTimeMs } from "./us-quotes.ts";

export const NASDAQ_HOSTS: readonly string[] = ["api.nasdaq.com"];
export const NASDAQ_SCREENER = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true";
export const NASDAQ_WATCHLIST = "https://api.nasdaq.com/api/quote/watchlist";
/** the most symbols one watchlist call answers (see the top of this file) */
export const WATCHLIST_AT_ONCE = 20;
/** how many tiles a map may show: the page offers these three, an agent any count up to the most */
export const HEATMAP_COUNTS: readonly number[] = [100, 250, 500];
export const HEATMAP_DEFAULT = 250;
export const HEATMAP_MAX = 500;
/** the screener's answer is the last close's: kept six hours, read again at most that often (and once after each close, as the clock
 * passes it) */
export const UNIVERSE_KEEP_MS = 6 * 3_600_000;
/** a share's quote is kept this long in a session (the page asks every half minute), and this long while the market is closed, when nothing
 * moves */
export const QUOTES_KEEP_MS = 45_000;
export const QUOTES_CLOSED_KEEP_MS = 600_000;
/** one GET of Nasdaq is allowed this long (the screener's 2 MB took 3 s) */
export const HEATMAP_TIMEOUT_MS = 12_000;
export const HEATMAP_VENUE = "nasdaq";
export const HEATMAP_NAME = "Nasdaq";
/** whose figures colour a tile, as the tile says it (Market.quoteFrom's words for the same quote) */
export const HEATMAP_FROM = "Nasdaq · real time";
/** whose figures size a tile */
export const HEATMAP_SIZED = "Nasdaq stock screener · market cap at the last close";
/** a ticker as the screener writes one: letters, a class letter after a slash (BRK/B) */
const SCREENER_TICKER = /^[A-Z]{1,5}(\/[A-Z])?$/;
/** a listing that is not one share of one company (see the top of this file): a preferred share or a depositary fraction of one, a note or
 * bond, a SPAC's warrant, right or unit, a mandatory-convertible or corporate unit. "American Depositary Shares" (an ADR) are shares */
const NOT_A_SHARE: readonly RegExp[] = [/\bpreferred\b/i, /\b(notes?|debentures?|bonds?)\b/i, /\bdue\s+\d{4}\b/i, /\bwarrants?\s*$/i, /\brights?\s*$/i, /\b(corporate|tangible equity|equity)\s+units?\b/i, /\bunits?\s*(each|consisting|$)/i, /(?<!american\s)depositary\s+shares?/i, /\b1\/\d+(st|nd|rd|th)?\s+interest\b/i];
/** what the screener appends to a company's name, taken off the tile: "Common Stock", "Class A Common Stock", "Ordinary Shares", "American
 * Depositary Shares (each representing…)", "Common Units Representing Limited Partner Interests", "(DE)" */
const NAME_TAIL = /\s*(?:\((?:DE|NEW|The)\)|\b(?:Class\s+[A-Z]\s+)?(?:Common\s+Stock|Common\s+Shares?|Ordinary\s+Shares?|Capital\s+Stock|Common\s+Units\b.*|(?:Sponsored\s+|Unsponsored\s+)?American\s+Depositary\s+Shares?\b.*|American\s+Depositary\s+Share\b.*|Depositary\s+Shares?\b.*)|\s*,)\s*$/i;

/** one tile: a company's share, sized by its market cap at the last close and coloured by Nasdaq's real-time change where Nasdaq priced it */
export interface HeatTile {
  /** the ticker as the account writes it (BRK.B) */
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  country?: string | undefined;
  /** dollars, at the last close (the screener's) */
  marketCap: number;
  /** Nasdaq's real-time last sale, where it priced the share */
  price?: number | undefined;
  /** the change from the last regular close, in dollars and in percent (Nasdaq's own figures) */
  change?: number | undefined;
  changePct?: number | undefined;
  prevClose?: number | undefined;
  /** the quote's own time, as Nasdaq stamps it (ISO 8601), where it stamps one */
  quoteAt?: string | undefined;
  /** whose quote it is, in words (HEATMAP_FROM); absent on a tile Nasdaq did not price */
  quoteFrom?: string | undefined;
  volume?: number | undefined;
}
/** a sector (or, within one, an industry) summed over the tiles in it */
export interface HeatSector {
  name: string;
  count: number;
  marketCap: number;
  /** how many of its tiles carry a quote */
  priced: number;
  /** the market-cap-weighted mean of its priced tiles' changes, in percent; absent where none is priced */
  changePct?: number | undefined;
}
/** what Nasdaq would not answer, in its own words, as Markets lists what is not shown (live/explore.ts ExploreMissing's shape) */
export interface HeatMissing {
  venue: string;
  venueName: string;
  why: string;
  code: string;
  said?: string | undefined;
  connected: false;
}
export interface Heatmap {
  /** when this answer was made (ISO 8601) */
  readAt: string;
  /** how many of the largest were asked for, and how many tiles there are (fewer where a sector is named, or the screener lists fewer) */
  n: number;
  count: number;
  /** only this sector's tiles among the n, where one was named */
  sector?: string | undefined;
  universe: { from: string; readAt: string; listed: number };
  quotes: { from: string; keptMs: number; priced: number; at?: string | undefined; oldest?: string | undefined; marketStatus?: string | undefined };
  /** the US stock market's session now, from the account's own calendar */
  session: MarketSession;
  sectors: HeatSector[];
  tiles: HeatTile[];
  missing?: HeatMissing | undefined;
  notes: string[];
}

/** a company's share as the screener lists it, read for the map */
export interface UniverseRow {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  country?: string | undefined;
  marketCap: number;
  /** the screener's own symbol (BRK/B), what the watchlist is asked */
  asked: string;
}

/** a Nasdaq figure: "$217.585", "+0.73%", "-0.355", "35,393,642" as a number; nothing for "N/A", "" or anything else */
export function heatNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = String(v ?? "").trim().replace(/^\$/, "").replace(/%$/, "").replace(/,/g, "");
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? fin(s) : undefined;
}
/** whether a screener row is one share of one company the map tiles (see NOT_A_SHARE) */
export function isShare(row: { symbol: string; name: string; industry: string; sector: string; marketCap: number }): boolean {
  if (!(row.marketCap > 0) || !row.sector || !SCREENER_TICKER.test(row.symbol)) return false;
  if (/blank\s+checks?/i.test(row.industry)) return false;
  return !NOT_A_SHARE.some((re) => re.test(row.name));
}
/** the company's name without the screener's description of the share */
export function companyName(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 3; i++) {
    const t = s.replace(NAME_TAIL, "").trim();
    if (t === s || !t) break;
    s = t;
  }
  return s || name.trim();
}
/** the screener's answer read into the map's universe: every share (isShare), the largest first, one row a symbol. A refusal where the
 * answer is not the screener's */
export function pickUniverse(body: unknown): UniverseRow[] | Refusal {
  const rows = list(rec(rec(body).data).rows);
  if (!isRec(body) || !isRec(rec(body).data) || !Array.isArray(rec(rec(body).data).rows)) return no("E_VENUE_REJECTED", { venue: HEATMAP_VENUE, message: `${HEATMAP_NAME} answered the screener in a way this could not read`, native: { status: 200 } });
  const seen = new Set<string>();
  const out: UniverseRow[] = [];
  for (const r of rows) {
    const x = rec(r);
    const asked = (str(x.symbol) ?? "").toUpperCase();
    const name = str(x.name) ?? "";
    const sector = str(x.sector) ?? "";
    const industry = str(x.industry) ?? "";
    const marketCap = heatNumber(x.marketCap) ?? 0;
    if (!isShare({ symbol: asked, name, industry, sector, marketCap })) continue;
    const symbol = asked.replace("/", ".");
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name: companyName(name), sector, industry, ...(str(x.country) ? { country: str(x.country) } : {}), marketCap, asked });
  }
  out.sort((a, b) => b.marketCap - a.marketCap || a.symbol.localeCompare(b.symbol));
  return out;
}

/** one share's quote as the watchlist gives it */
export interface HeatQuote {
  price: number;
  change?: number | undefined;
  changePct?: number | undefined;
  prevClose?: number | undefined;
  volume?: number | undefined;
  /** the trade's own time (ms), where Nasdaq stamps one to the second or the minute */
  at?: number | undefined;
  marketStatus?: string | undefined;
}
/** the watchlist's answer read into quotes by symbol (as the account writes it): a row without a price is no quote */
export function pickQuotes(body: unknown): Map<string, HeatQuote> {
  const out = new Map<string, HeatQuote>();
  for (const r of list(rec(body).data)) {
    const x = rec(r);
    const symbol = (str(x.symbol) ?? "").toUpperCase().replace("/", ".");
    const price = heatNumber(x.lastSalePrice);
    if (!symbol || price === undefined || !(price > 0)) continue;
    const stamp = str(x.lastTradeTimestampDateTime);
    // seven figures of a second are more than a Date reads: the first three are kept
    const fromStamp = stamp ? Date.parse(stamp.replace(/(\.\d{3})\d+/, "$1")) : NaN;
    const at = Number.isFinite(fromStamp) ? fromStamp : nasdaqTimeMs(x.lastTradeTimestamp);
    const change = heatNumber(x.netChange);
    const changePct = heatNumber(x.percentageChange);
    const prevClose = heatNumber(x.previousClosePrice);
    const volume = heatNumber(x.volume);
    out.set(symbol, { price, ...(change !== undefined ? { change } : {}), ...(changePct !== undefined ? { changePct } : {}), ...(prevClose !== undefined && prevClose > 0 ? { prevClose } : {}), ...(volume !== undefined ? { volume } : {}), ...(at !== undefined ? { at } : {}), ...(str(x.marketStatus) ? { marketStatus: str(x.marketStatus) } : {}) });
  }
  return out;
}

export interface UsHeatmapDeps {
  /** the network, behind the fixed-host guard for Nasdaq's host (the service puts it there); the real one by default */
  http?: Http | undefined;
  clock?: (() => number) | undefined;
  /** the line each GET of Nasdaq waits in: the process's own (hostLane) by default; none in a test */
  pace?: Pace | undefined;
  userAgent?: string | undefined;
}

/** the reader: the universe kept, each share's quote kept by its own age, one refusal of Nasdaq held as the source said */
export class UsHeatmap {
  private readonly http: Http;
  private readonly clock: () => number;
  private readonly pace: Pace;
  private readonly headers: Record<string, string>;
  private universe: { at: number; rows: UniverseRow[] } | undefined;
  private universeAsk: Promise<UniverseRow[] | Refusal> | undefined;
  /** each share's last quote, with when Nasdaq was last asked about it — a share the answer left out keeps its last quote (its tile says
   * the quote's own time) under the new ask, so it is asked again with the next stale batch, not with every read */
  private readonly quotes = new Map<string, { at: number; q?: HeatQuote | undefined }>();
  private readonly asking = new Map<string, Promise<Refusal | undefined>>();
  private held: { until: number; refusal: Refusal } | undefined;

  constructor(deps: UsHeatmapDeps = {}) {
    this.http = deps.http ?? realHttp;
    this.clock = deps.clock ?? Date.now;
    this.pace = deps.pace ?? hostLane;
    this.headers = { "user-agent": deps.userAgent ?? NASDAQ_UA, accept: "application/json" };
  }

  /** the map: the `n` largest companies (HEATMAP_DEFAULT; at most HEATMAP_MAX), their quotes read where not kept, grouped and summed; only
   * one sector's tiles among them where `sector` is named (its name as the screener writes it, without regard to case) */
  async read(o: { n?: number | undefined; sector?: string | undefined } = {}): Promise<Heatmap | Refusal> {
    const n = Math.min(HEATMAP_MAX, Math.max(1, Math.floor(o.n ?? HEATMAP_DEFAULT)));
    const rows = await this.universeNow();
    if (isRefusal(rows)) return rows;
    const now = this.clock();
    const session = usSessionFull(now, false);
    const keptMs = session.phase === "closed" || session.phase === "overnight" ? QUOTES_CLOSED_KEEP_MS : QUOTES_KEEP_MS;
    const top = rows.slice(0, n);
    const stale = top.filter((r) => {
      const k = this.quotes.get(r.symbol);
      return !k || now - k.at >= keptMs;
    });
    const refused = await this.askQuotes(stale);
    const wanted = o.sector?.trim().toLowerCase();
    const chosen = wanted ? top.filter((r) => r.sector.toLowerCase() === wanted) : top;
    const tiles: HeatTile[] = chosen.map((r) => {
      const k = this.quotes.get(r.symbol);
      const q = k?.q;
      return {
        symbol: r.symbol,
        name: r.name,
        sector: r.sector,
        industry: r.industry,
        ...(r.country ? { country: r.country } : {}),
        marketCap: r.marketCap,
        ...(q
          ? {
              price: q.price,
              ...(q.change !== undefined ? { change: q.change } : {}),
              ...(q.changePct !== undefined ? { changePct: q.changePct } : {}),
              ...(q.prevClose !== undefined ? { prevClose: q.prevClose } : {}),
              ...(q.at !== undefined ? { quoteAt: new Date(q.at).toISOString() } : {}),
              quoteFrom: HEATMAP_FROM,
              ...(q.volume !== undefined ? { volume: q.volume } : {}),
            }
          : {}),
      };
    });
    const priced = tiles.filter((t) => t.changePct !== undefined);
    const stamps = tiles.flatMap((t) => (t.quoteAt ? [Date.parse(t.quoteAt)] : [])).filter((x) => Number.isFinite(x));
    const marketStatus = chosen.map((r) => this.quotes.get(r.symbol)?.q?.marketStatus).find((x): x is string => !!x);
    const sectors = sumBy(tiles, (t) => (wanted ? t.industry : t.sector));
    const notes = [
      `Sized by market cap at the last close, from Nasdaq's stock screener (${rows.length.toLocaleString("en-US")} shares of US-listed companies that day; preferred shares, notes, warrants, rights, units and blank-check companies left out). Coloured by each share's change from its last regular close, Nasdaq's own real-time quote, read ${WATCHLIST_AT_ONCE} shares a call and kept ${Math.round(keptMs / 1000)} s; a share Nasdaq did not price is grey.`,
      ...(session.phase === "closed" || session.phase === "overnight" ? ["The market is closed: the colours are the last session's."] : session.phase === "pre" || session.phase === "after" ? [`The ${session.phase === "pre" ? "pre-market" : "after-hours"} session is on: a change is the extended session's last trade against the last regular close.`] : []),
    ];
    const missing = refused ?? (this.held && this.held.until > now ? this.held.refusal : undefined);
    return {
      readAt: new Date(now).toISOString(),
      n,
      count: tiles.length,
      ...(wanted ? { sector: chosen[0]?.sector ?? o.sector!.trim() } : {}),
      universe: { from: HEATMAP_SIZED, readAt: new Date(this.universe!.at).toISOString(), listed: rows.length },
      quotes: { from: HEATMAP_FROM, keptMs, priced: priced.length, ...(stamps.length ? { at: new Date(Math.max(...stamps)).toISOString(), oldest: new Date(Math.min(...stamps)).toISOString() } : {}), ...(marketStatus ? { marketStatus } : {}) },
      session,
      sectors,
      tiles,
      ...(missing ? { missing: missingOf(missing) } : {}),
      notes,
    };
  }

  /** the universe, kept: the screener read once and again after UNIVERSE_KEEP_MS (one read at a time); a refusal where it was never read,
   * else what was read before, still the last close's */
  private universeNow(): Promise<UniverseRow[] | Refusal> {
    const now = this.clock();
    if (this.universe && now - this.universe.at < UNIVERSE_KEEP_MS) return Promise.resolve(this.universe.rows);
    if (this.universeAsk) return this.universeAsk;
    const ask = this.readUniverse().then(
      (r) => {
        this.universeAsk = undefined;
        if (isRefusal(r)) {
          this.hold(r);
          return this.universe ? this.universe.rows : r;
        }
        this.universe = { at: this.clock(), rows: r };
        return r;
      },
      (err: unknown) => {
        this.universeAsk = undefined;
        const r = unreachable(HEATMAP_VENUE, HEATMAP_NAME, err);
        this.hold(r);
        return this.universe ? this.universe.rows : r;
      },
    );
    this.universeAsk = ask;
    return ask;
  }
  private async readUniverse(): Promise<UniverseRow[] | Refusal> {
    const held = this.holding();
    if (held) return held;
    await this.pace("nasdaq");
    const r = await this.http(NASDAQ_SCREENER, { headers: this.headers, timeoutMs: HEATMAP_TIMEOUT_MS });
    if (r.status !== 200 || r.body === undefined) return publicNo(HEATMAP_VENUE, HEATMAP_NAME, r);
    return pickUniverse(r.body);
  }

  /** the stale shares' quotes asked of the watchlist, WATCHLIST_AT_ONCE a call, every call at once (each waits its turn in the Nasdaq line)
   * — none while a refusal of Nasdaq is held. The first refusal among the calls, if any: held, and said; the other calls' quotes are kept */
  private async askQuotes(stale: UniverseRow[]): Promise<Refusal | undefined> {
    if (!stale.length) return undefined;
    const held = this.holding();
    if (held) return held;
    const batches: UniverseRow[][] = [];
    for (let i = 0; i < stale.length; i += WATCHLIST_AT_ONCE) batches.push(stale.slice(i, i + WATCHLIST_AT_ONCE));
    const answers = await Promise.all(batches.map((b) => this.askBatch(b)));
    return answers.find((x): x is Refusal => x !== undefined);
  }
  private askBatch(batch: UniverseRow[]): Promise<Refusal | undefined> {
    const key = batch.map((r) => r.symbol).join(",");
    const going = this.asking.get(key);
    if (going) return going;
    const ask = this.readBatch(batch).finally(() => this.asking.delete(key));
    this.asking.set(key, ask);
    return ask;
  }
  private async readBatch(batch: UniverseRow[]): Promise<Refusal | undefined> {
    const url = `${NASDAQ_WATCHLIST}?${batch.map((r) => `symbol=${encodeURIComponent(`${r.asked.toLowerCase()}|stocks`)}`).join("&")}`;
    let r: HttpReply;
    try {
      await this.pace("nasdaq");
      r = await this.http(url, { headers: this.headers, timeoutMs: HEATMAP_TIMEOUT_MS });
    } catch (err: unknown) {
      const refusal = unreachable(HEATMAP_VENUE, HEATMAP_NAME, err);
      this.hold(refusal);
      return refusal;
    }
    if (r.status !== 200 || r.body === undefined) {
      const refusal = publicNo(HEATMAP_VENUE, HEATMAP_NAME, r);
      this.hold(refusal);
      return refusal;
    }
    const got = pickQuotes(r.body);
    const at = this.clock();
    for (const row of batch) this.quotes.set(row.symbol, { at, q: got.get(row.symbol) ?? this.quotes.get(row.symbol)?.q });
    return undefined;
  }

  /** a refusal that says to wait, kept until when it said (holdBackMs); one that does not holds nothing. The held refusal handed back by
   * holding() is the same one: it never holds itself again */
  private hold(r: Refusal): void {
    if (this.held && this.held.refusal === r) return;
    const ms = holdBackMs(r, this.clock());
    if (ms > 0) this.held = { until: this.clock() + ms, refusal: r };
  }
  private holding(): Refusal | undefined {
    if (this.held && this.held.until > this.clock()) return this.held.refusal;
    this.held = undefined;
    return undefined;
  }
}

/** the tiles summed by a name (their sector, or their industry), the largest sum first */
function sumBy(tiles: HeatTile[], nameOf: (t: HeatTile) => string): HeatSector[] {
  const by = new Map<string, { cap: number; count: number; priced: number; weighted: number; pricedCap: number }>();
  for (const t of tiles) {
    const name = nameOf(t) || "Other";
    const s = by.get(name) ?? { cap: 0, count: 0, priced: 0, weighted: 0, pricedCap: 0 };
    s.cap += t.marketCap;
    s.count += 1;
    if (t.changePct !== undefined) {
      s.priced += 1;
      s.weighted += t.marketCap * t.changePct;
      s.pricedCap += t.marketCap;
    }
    by.set(name, s);
  }
  return [...by.entries()].map(([name, s]) => ({ name, count: s.count, marketCap: s.cap, priced: s.priced, ...(s.pricedCap > 0 ? { changePct: Number((s.weighted / s.pricedCap).toFixed(2)) } : {}) })).sort((a, b) => b.marketCap - a.marketCap || a.name.localeCompare(b.name));
}
/** a refusal of Nasdaq as the map lists what is not shown */
function missingOf(r: Refusal): HeatMissing {
  const said = (r.native as { said?: unknown } | undefined)?.said;
  return { venue: HEATMAP_VENUE, venueName: HEATMAP_NAME, why: r.message, code: r.code, ...(typeof said === "string" && said ? { said } : {}), connected: false };
}
