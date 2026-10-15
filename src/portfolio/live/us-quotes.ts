/** US STOCK QUOTES IN REAL TIME, KEYLESS: the price of a US share as the market has it now, so a listing (public-stocks.ts) — and a paper
 * account, which fills at it — is not fifteen minutes behind. Two sources, each through the fixed-host guard (public-markets.ts
 * PUBLIC_HOSTS); where neither answers in time, the caller says Cboe's delayed quote, which it asks AT THE SAME TIME, not after.
 *
 * What is read, and what it is (checked keyless from this machine on Wed 2026-10-14 between 16:30 and 17:50 UTC, 12:30–13:50 New York, in
 * the regular session):
 *   GET api.robinhood.com/rhj/prices                                ROBINHOOD's prices for its Stock Tokens, ALL of them in one answer (194
 *                       that day, 98.7 KB, 0.17–0.35 s at 17:49 UTC, 1.4 s once earlier): {quotes: [{tokenSymbol, bid, ask, currency,
 *                       isTradingHalt, generatedAt, dailyHigh, dailyLow, dailyTradingVolume, tokenBid, tokenAsk, …}]}. The record names the
 *                       share only by `tokenSymbol`, which is the TOKEN's symbol and NOT ALWAYS the share's ticker: 193 of the 194 matched
 *                       Cboe's symbol book by ticker and company (twelve also checked against Nasdaq's quote the same minute, each bid and
 *                       ask within a cent), but SATS is EchoStar's token (/rhj/assets: tokenName "EchoStar • Robinhood Token", isin
 *                       US2787681061) while EchoStar's share trades as ECHO — Nasdaq answers SATS "Symbol not exists.", Cboe's book lists
 *                       ECHO and not SATS, and Robinhood's SATS bid and ask (87.87/87.93 at 17:49 UTC) are ECHO's. So a Robinhood quote is
 *                       taken only for a ticker the caller says the market lists under that name (UsAsk.listed: Cboe's symbol book).
 *                       `bid` and `ask` are the UNDERLYING SHARE's quote, in dollars; `tokenBid` and `tokenAsk` are the token's (the share's
 *                       times the token's multiplier, 1.0011 for CRM that day) and are not read. `generatedAt` is the answer's own stamp,
 *                       ONE for all 194 quotes: Robinhood writes the whole answer about every fifteen seconds (16:51:47, 16:52:02, 16:52:17,
 *                       16:52:32 UTC that day; 17:49:28 and 17:49:43 later) and serves the same one in between, whether or not a quote in
 *                       it moved — it says the writer is running, not how old a quote is. So a share's quote is stamped with the
 *                       generatedAt of the FIRST answer in which its bid and ask stood as they stand now ("unchanged since"), never the
 *                       latest answer's: a book that stops moving ages, and is passed over after FRESH_MS. Since when a book has stood is
 *                       known only from an answer that saw it move: a book FIRST SEEN — after a restart, when nothing was read before — is
 *                       not taken until it moves while watched (it may have stood since the last session: Friday's book, read on Sunday
 *                       night), and one that moved across answers that were not read is stamped with the last answer read before them,
 *                       the earliest it may have moved (ROBINHOOD_NEXT_MS). A share Robinhood has halted
 *                       (`isTradingHalt` true) is left out. Only these 194 are quoted (no JPM, BRK.B, V, WMT or HOOD); a symbol asked one at
 *                       a time (/rhj/prices/{SYM}) is not asked here — the one answer serves them all. Robinhood's assets list (/rhj/assets)
 *                       marks 191 of them TRADABLE overnight (tradingCapabilities.overnight). Whether this answer's quotes keep moving in the
 *                       overnight session (20:00 to 04:00 New York), and from when in pre-market, was NOT watched: ROBINHOOD_OVERNIGHT says
 *                       what the account assumes
 *   GET api.nasdaq.com/api/quote/{SYM}/info?assetclass=stocks       NASDAQ's own quote page's data, sent with a desktop browser's
 *                       user-agent (without one, curl's HTTP/2 stream is reset — "INTERNAL_ERROR" — and HTTP/1.1 waits forever; Node's
 *                       own got 200 that day): {data: {symbol, companyName, exchange, marketStatus, primaryData: {lastSalePrice "$344.9472",
 *                       netChange "+3.6772", percentageChange "+1.08%", lastTradeTimestamp "Oct 14, 2026 12:33 PM ET", isRealTime true,
 *                       bidPrice "$344.85", askPrice "$344.89", bidSize, askSize, volume}, secondaryData}}: prices are strings with a "$"
 *                       and commas, the time is New York's to the minute. Eight asked at once answered in 0.3 s at 17:50 UTC. An ETF
 *                       answers only as assetclass=etf (SPY as "stocks" answered 200 with data null and status.rCode 400 "Symbol not
 *                       exists."), so a symbol is asked as a stock first — as an ETF first where the caller says it is likely one (its
 *                       company's name in Cboe's book: Nasdaq.hint) — then as the other, and the class that answered is remembered (an hour,
 *                       for at most a thousand symbols, shared by the quote and the chart); a symbol neither knows is not listed (kept ten
 *                       minutes). A dotted class share is written with its dot (BRK.B). Nasdaq's book (bidPrice, askPrice) is NASDAQ's own,
 *                       not the national best: where it is crossed (bid above ask) neither side is taken, only the last trade. OUTSIDE THE
 *                       REGULAR SESSION it was not watched live; archived answers of the same URL (web.archive.org, captured 2025-08-21 08:46,
 *                       2026-04-13 18:22, 2026-04-13 20:02 and 2026-04-14 00:52 and 01:56 New York, and weekends) show: marketStatus
 *                       "Pre-Market" or "After-Hours" with primaryData the extended session's last trade ("Aug 21, 2025 8:02 AM ET", "Apr 13,
 *                       2026 6:22 PM ET", isRealTime true, its bid and ask, and its change FROM THE LAST REGULAR CLOSE: AKAM $76.65 +0.59
 *                       beside a close of $76.06) and secondaryData that close ("Closed at Apr 13, 2026 4:00 PM ET", isRealTime false, the
 *                       change of the session before it); marketStatus "Closed" (from 20:00, overnight and at weekends) with primaryData
 *                       stamped by a DATE alone ("Apr 13, 2026"), isRealTime false, bid and ask "N/A", secondaryData null. So a quote is
 *                       taken only where it is real time and stamped to the minute, with primaryData's change (the change of the price
 *                       taken, from the last regular close before it); anything else is no quote. Its stamp is the last trade's, however
 *                       old: a share that has not traded in the session that is on keeps an older stamp, and the line says so
 *                       (public-stocks.ts usSessionWords). Nasdaq keeps no overnight session (its extended-trading page answers
 *                       markettype=overnight with rCode 400), so it is not asked overnight or while the market is closed
 *   GET api.nasdaq.com/api/quote/{SYM}/chart?assetclass=stocks      the last market day's minutes from 04:00, the pre-market and
 *                       after-hours ones too (512 points from 04:00 to 12:32 at 12:33 that day; archived: to 19:54 on a Friday, read on the
 *                       Sunday after): {data: {timeAsOf, lastSalePrice, previousClose, chart: [{x, y, z: {dateTime "4:00 AM ET", value}}],
 *                       volumeChart}}. `y` is ONE PRICE A MINUTE, not the minute's open, high, low and close; `volumeChart` is the same
 *                       price series again (checked 17:50 UTC: its last points equal chart's), so there is no volume. `x` is New York's
 *                       WALL-CLOCK time written as if it were UTC (x 1791950400000 = 2026-10-14T04:00Z is labelled "4:00 AM ET"), so it is
 *                       read back through fromEt. A lone sample far from both its neighbours while they agree is a stray print, not
 *                       where the price was (NVDA on 2026-10-14: 221.20 at 4:47 PM, 233.4137 at 4:48, 221.1941 at 4:49 — Robinhood and
 *                       Nasdaq's own quote never left 221): it is left out (withoutStrays), so one print neither stretches a chart nor
 *                       values a paper book
 *
 * The chain (usQuote), with ONE deadline (RT_WAIT_MS) for all of it: Robinhood's quote for a symbol it quotes and the caller says is listed
 * under that ticker, while its stamp is fresh (FRESH_MS) and the session is one it trades (pre-market, the regular session, after-hours — and
 * overnight while ROBINHOOD_OVERNIGHT says so); else Nasdaq's, in pre-market, the regular session and after-hours, for at most one batch
 * (NASDAQ_AT_ONCE) of the symbols asked, the first ones; else nothing, and the caller says Cboe's delayed quote. What has not answered by the
 * deadline is not waited for: its answer, when it comes, is kept for the next ask. One refusal of Nasdaq that says to wait (an edge's page, a
 * place rule, a 429, no answer) holds back every Nasdaq ask, every symbol, quote and chart, for as long as holdBackMs says. Every answer
 * carries the source's own stamp (`at`), how far behind it is (`delayMs`: 0 for both) and which it is in words (`from`); nothing is worked
 * out but Robinhood's price, the middle of its bid and ask. These are the websites' own unofficial endpoints, not a licensed feed: either may
 * change or refuse without notice, which is why the delayed fallback stays */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { fromEt, usPhaseAt } from "../account/calendar.ts";
import { no } from "../refuse.ts";
import { fin, fixedHosts, holdBackMs, isRec, keeper, LIST_MS, list, mid, pos, PUBLIC_HOSTS, publicNo, rec, str, type PublicDeps } from "./public-markets.ts";
import type { Candle } from "./trade.ts";
import { edgeRefused, realHttp, unreachable, type Http, type HttpReply } from "./types.ts";

export const ROBINHOOD_PRICES = "https://api.robinhood.com/rhj/prices";
export const NASDAQ_QUOTE = "https://api.nasdaq.com/api/quote";
/** a desktop browser's user-agent, which Nasdaq's quote API answers (see the top of this file) */
export const NASDAQ_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
/** the words a price from each source carries (Market.quoteFrom) */
export const ROBINHOOD_FROM = "Robinhood · real time";
export const NASDAQ_FROM = "Nasdaq · real time";
/** Robinhood's quotes are taken in the overnight session (20:00 to 04:00 New York, ahead of a market day) too. AN ASSUMPTION, NOT A
 * MEASUREMENT: its assets list says 191 of its Stock Tokens are tradable overnight, and its AAPL daily low on 2026-10-14 (340.29) lay a cent
 * below the lowest the earlier pass found anywhere else (340.30, the 13 October after-hours low) — a margin any one print could explain, so
 * it suggests an overnight session and does not show one. Nobody watched its bid and ask move after 20:00. Set false if they do not:
 * overnight a share then has no real-time price, and nothing is filled or offered in that session. A book that does not move ages out on its
 * own either way (a quote is stamped "unchanged since", FRESH_MS), and one first seen is not taken until it moves: a book frozen since the
 * last session is not taken for a live one, after a restart either */
export const ROBINHOOD_OVERNIGHT = true;
/** a quote older than this (by its own stamp) is not taken as real time */
export const FRESH_MS = 120_000;
/** the ONE deadline of the chain: a listing waits this long at most for the real-time sources, then says what answered. The callers allow a
 * source four seconds in all (paper.ts SOURCE_MS, explore.ts), the first search of a ticker waits up to 1.5 s for Cboe's symbol book before
 * it (public-stocks.ts), and Cboe's quotes are asked at the same time as this chain */
export const RT_WAIT_MS = 1_500;
/** Robinhood's one answer for every symbol is kept this long (it writes a new one about every fifteen seconds) */
const ROBINHOOD_MS = 10_000;
/** an answer read within this long of the one read before it follows it (Robinhood writes one about every fifteen seconds; read every ten
 * seconds at most, every other one may be missed): a book that moved between the two moved in that time. Across a longer gap — answers that
 * were not read, nobody asking — it may have moved at any time since the last one read */
export const ROBINHOOD_NEXT_MS = 30_000;
/** one Nasdaq quote is kept this long; a symbol Nasdaq does not know, ten minutes (LIST_MS) */
const NASDAQ_MS = 10_000;
const CHART_MS = 60_000;
/** Nasdaq is asked for at most this many symbols in one ask of the chain (one batch, all at once) */
export const NASDAQ_AT_ONCE = 8;
/** how long one request may take before it is given up as no answer (and the source held back twenty seconds: holdBackMs). No listing
 * waits for these: it waits RT_WAIT_MS at most, and an answer that comes after that is kept for the next ask — so a slow answer (Robinhood
 * took 1.4 s once) is not thrown away, and a hung one is let go well inside the callers' four seconds */
const ROBINHOOD_TIMEOUT_MS = 2_500;
const NASDAQ_TIMEOUT_MS = 2_500;
/** the class Nasdaq answered a symbol as is remembered this long, for at most this many symbols (the oldest let go first) */
const CLASS_MS = 3_600_000;
const CLASS_KEPT = 1_000;

/** one US share's quote from a real-time source */
export interface UsQuote {
  /** the share's ticker (AAPL, BRK.B) */
  symbol: string;
  /** the last trade (Nasdaq), or the middle of the bid and ask (Robinhood) */
  price?: number | undefined;
  bid?: number | undefined;
  ask?: number | undefined;
  /** the source's own stamp for it, in ms: for Robinhood, the generatedAt of the first answer in which this bid and ask stood ("unchanged
   * since") — of the last answer read before it, where it moved across answers that were not read; for Nasdaq, its lastTradeTimestamp (to
   * the minute) */
  at: number;
  /** how far behind the market the source is: 0 for both */
  delayMs: number;
  /** which source, in words (ROBINHOOD_FROM, NASDAQ_FROM) */
  from: string;
  /** the change of `price` from the last regular-session close before `at` — yesterday's close in pre-market and the regular session, today's
   * in after-hours — in dollars and in percent, where the source says it (Nasdaq's primaryData; Robinhood gives none) */
  change?: number | undefined;
  changePct?: number | undefined;
}

/** an ISO stamp in ms, nanoseconds and all ("2026-10-14T16:33:08.490956509Z", Robinhood's): the fraction is cut to milliseconds first */
function isoMs(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(t) ? t : undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Nasdaq's stamp, "Oct 14, 2026 12:33 PM ET" (New York, to the minute), in ms; nothing for a date alone ("Apr 13, 2026", a closed
 * market's) or anything else */
export function nasdaqTimeMs(v: unknown): number | undefined {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(String(v ?? "").trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1]!) + 1;
  const hour12 = Number(m[4]);
  if (month < 1 || hour12 < 1 || hour12 > 12) return undefined;
  return fromEt(Number(m[3]), month, Number(m[2]), (hour12 % 12) + (m[6] === "PM" ? 12 : 0), Number(m[5]));
}

/** a Nasdaq figure: "$1,234.56", "+3.6772", "-1.14%" as a number; nothing for "N/A", "" or anything else */
export function nasdaqNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = String(v ?? "").trim().replace(/^\$/, "").replace(/%$/, "").replace(/,/g, "");
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? fin(s) : undefined;
}

/** ROBINHOOD's one answer for every Stock Token's share (see the top of this file): its quotes by the token's symbol, kept ROBINHOOD_MS, each
 * stamped with the generatedAt of the first answer in which its bid and ask stood as they stand ("unchanged since"). A book first seen is
 * left out until it moves while watched: since when it has stood is not known. A halted share, one with no bid or no ask (or a crossed
 * book), and one not in dollars are left out. Robinhood refusing this network, or an answer with no quotes in it, is a refusal, never an
 * empty map */
export function robinhoodQuotes(deps: PublicDeps = {}): (() => Promise<Map<string, UsQuote> | Refusal>) & { clear(): void } {
  const id = "robinhood";
  const name = "Robinhood";
  const clock = deps.clock ?? Date.now;
  const http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, Math.min(deps.timeoutMs ?? ROBINHOOD_TIMEOUT_MS, ROBINHOOD_TIMEOUT_MS));
  const kept = keeper<Map<string, UsQuote>>(clock, ROBINHOOD_MS);
  // each symbol's bid and ask as last seen, since which answer they have stood so (`at`: not known for a book not yet seen to move), and
  // the last answer they were seen in (`saw`) — at most the ~200 Robinhood quotes
  const since = new Map<string, { bid: number; ask: number; at: number | undefined; saw: number }>();
  const all = () =>
    kept("all", async () => {
      let r: HttpReply;
      try {
        r = await http(ROBINHOOD_PRICES);
      } catch (err) {
        return unreachable(id, name, err);
      }
      if (r.status !== 200 || r.body === undefined) return publicNo(id, name, r);
      const quotes = list(rec(r.body).quotes).map(rec);
      if (!quotes.length) return no("E_VENUE_REJECTED", { venue: id, message: `${name} answered with no quotes`, native: { status: r.status } });
      const out = new Map<string, UsQuote>();
      for (const x of quotes) {
        const symbol = str(x.tokenSymbol)?.toUpperCase();
        if (!symbol || x.isTradingHalt === true || str(x.currency) !== "USD") continue;
        const bid = pos(x.bid);
        const ask = pos(x.ask);
        const price = mid(bid, ask);
        const written = isoMs(x.generatedAt);
        if (price === undefined || bid === undefined || ask === undefined || written === undefined) continue;
        const seen = since.get(symbol);
        // an answer older than one already read says nothing new of this book
        if (seen && written < seen.saw) continue;
        // since when this book has stood: unchanged, since when it stood before; moved since the answer read just before, this answer;
        // moved across answers not read, the last one read (the earliest it may have moved: a book that moved once in the gap and froze is
        // not fresh); first seen, not known — it may have stood since the last session — and not taken until it moves while watched
        const at = !seen ? undefined : seen.bid === bid && seen.ask === ask ? seen.at : written - seen.saw <= ROBINHOOD_NEXT_MS ? written : seen.saw;
        since.set(symbol, { bid, ask, at, saw: written });
        if (at !== undefined) out.set(symbol, { symbol, price, bid, ask, at, delayMs: 0, from: ROBINHOOD_FROM });
      }
      return out;
    });
  return Object.assign(all, { clear: kept.clear });
}

export type AssetClass = "stocks" | "etf";

/** NASDAQ as one source (see the top of this file): its quote and its chart, sharing what is known of each symbol's class and one hold on
 * the whole source after a refusal that says to wait */
export interface Nasdaq {
  /** one share's quote, or null where Nasdaq does not know the symbol or has no real-time quote for it now */
  quote(symbol: string): Promise<UsQuote | null | Refusal>;
  /** one share's minutes, or null where Nasdaq does not know the symbol or keeps no minutes for it */
  chart(symbol: string): Promise<Candle[] | null | Refusal>;
  /** what the caller knows of a symbol's class before Nasdaq is asked (an ETF by its company's name in Cboe's book): asked as that class
   * first. What Nasdaq answered is never overwritten by a hint */
  hint(symbol: string, cls: AssetClass): void;
  /** let go of the refusals held (the whole source's and each symbol's) */
  clear(): void;
}

/** NASDAQ's quote and chart for US shares (see the top of this file) */
export function nasdaqSource(deps: PublicDeps = {}): Nasdaq {
  const id = "nasdaq";
  const name = "Nasdaq";
  const clock = deps.clock ?? Date.now;
  const http: Http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, Math.min(deps.timeoutMs ?? NASDAQ_TIMEOUT_MS, NASDAQ_TIMEOUT_MS));
  // the class each symbol answered as (`sure`) or is likely to be (a hint), kept CLASS_MS, at most CLASS_KEPT symbols
  const classes = new Map<string, { cls: AssetClass; sure: boolean; until: number }>();
  const classOf = (symbol: string) => {
    const c = classes.get(symbol);
    if (c && clock() >= c.until) classes.delete(symbol);
    return c && clock() < c.until ? c : undefined;
  };
  const setClass = (symbol: string, cls: AssetClass, sure: boolean) => {
    classes.delete(symbol);
    classes.set(symbol, { cls, sure, until: clock() + CLASS_MS });
    if (classes.size > CLASS_KEPT) classes.delete(classes.keys().next().value!);
  };
  // the hold on the whole source: one refusal that says to wait holds back every ask until then
  let held: { until: number; r: Refusal } | undefined;
  const hold = (r: Refusal): Refusal => {
    const ms = holdBackMs(r);
    if (ms > 0) held = { until: clock() + ms, r };
    return r;
  };
  type Once = { data: Record<string, unknown> | null } | { other: HttpReply } | Refusal;
  const once = async (path: string, symbol: string, cls: AssetClass): Promise<Once> => {
    if (held && clock() < held.until) return held.r;
    let r: HttpReply;
    try {
      r = await http(`${NASDAQ_QUOTE}/${encodeURIComponent(symbol)}/${path}?assetclass=${cls}`, { headers: { "user-agent": NASDAQ_UA } });
    } catch (err) {
      return hold(unreachable(id, name, err));
    }
    if (r.status === 200 && r.body !== undefined) {
      const data = rec(r.body).data;
      return { data: isRec(data) ? data : null };
    }
    if (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 451 && !edgeRefused(r.status, r.text)) return { other: r };
    return hold(publicNo(id, name, r));
  };
  /** Nasdaq's `data` for one symbol from one of its pages (info, chart): asked as the class it answered as before, or else as a stock then
   * an ETF (an ETF first where hinted), where Nasdaq does not answer the first (a 200 with data null, or a 4xx that is not a wait, a place
   * rule or an edge's page). Null where Nasdaq said it has no data; where every class asked answered a 4xx, Nasdaq's refusal */
  const data = async (path: "info" | "chart", symbol: string): Promise<Record<string, unknown> | null | Refusal> => {
    const c = classOf(symbol);
    const order: AssetClass[] = c?.sure ? [c.cls] : c?.cls === "etf" ? ["etf", "stocks"] : ["stocks", "etf"];
    let refused: HttpReply | undefined;
    let none = false;
    for (const cls of order) {
      const got = await once(path, symbol, cls);
      if (isRefusal(got)) return got;
      if ("other" in got) refused ??= got.other;
      else if (got.data === null) none = true;
      else {
        setClass(symbol, cls, true);
        return got.data;
      }
    }
    return none || !refused ? null : publicNo(id, name, refused);
  };
  // a symbol Nasdaq does not know is kept ten minutes; an answer, NASDAQ_MS
  const quotes = keeper<{ q: UsQuote | null; listed: boolean }>(clock, (a) => (a.listed ? NASDAQ_MS : LIST_MS));
  const charts = keeper<Candle[] | null>(clock, (a) => (a === null ? LIST_MS : CHART_MS));
  return {
    /** primaryData's last trade, bid and ask where Nasdaq says it is real time and stamps it to the minute — the book only where it is not
     * crossed — and primaryData's change, the change of that price from the last regular close before it */
    async quote(symbol) {
      const sym = symbol.trim().toUpperCase();
      const got = await quotes(sym, async () => {
        const d = await data("info", sym);
        if (isRefusal(d)) return d;
        if (d === null) return { q: null, listed: false };
        const p = rec(d.primaryData);
        const at = nasdaqTimeMs(p.lastTradeTimestamp);
        const price = nasdaqNumber(p.lastSalePrice);
        if (p.isRealTime !== true || at === undefined || price === undefined || price <= 0) return { q: null, listed: true };
        const bid = nasdaqNumber(p.bidPrice);
        const ask = nasdaqNumber(p.askPrice);
        const crossed = bid !== undefined && ask !== undefined && bid > ask;
        const change = nasdaqNumber(p.netChange);
        const changePct = nasdaqNumber(p.percentageChange);
        return {
          q: { symbol: sym, price, ...(!crossed && bid !== undefined && bid > 0 ? { bid } : {}), ...(!crossed && ask !== undefined && ask > 0 ? { ask } : {}), at, delayMs: 0, from: NASDAQ_FROM, ...(change !== undefined ? { change } : {}), ...(changePct !== undefined ? { changePct } : {}) },
          listed: true,
        };
      });
      return isRefusal(got) ? got : got.q;
    },
    /** the minutes, oldest first, as one-minute bars at the minute's price — open, high, low and close the same, no volume: SAMPLES, not
     * the minute's range — each at its real instant (`x` read back from New York's wall-clock time) */
    chart(symbol) {
      const sym = symbol.trim().toUpperCase();
      return charts(sym, async () => {
        const d = await data("chart", sym);
        if (isRefusal(d) || d === null) return d;
        const out: Candle[] = [];
        for (const x of list(d.chart).map(rec)) {
          const wall = fin(x.x);
          const y = pos(x.y);
          if (wall === undefined || y === undefined) continue;
          const w = new Date(wall);
          const t = fromEt(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes());
          out.push({ t, o: y, h: y, l: y, c: y });
        }
        return out.length ? withoutStrays(out.sort((a, b) => a.t - b.t)) : null;
      });
    },
    hint(symbol, cls) {
      const sym = symbol.trim().toUpperCase();
      if (!classOf(sym)) setClass(sym, cls, false);
    },
    clear() {
      held = undefined;
      quotes.clear();
      charts.clear();
    },
  };
}

/** how far a sample is from both its neighbours to be a stray print, and how near they are to each other (a share's own moves, however
 * quick, keep the next minute near the new price: only a print the price at once left again goes) */
export const STRAY_OFF = 0.02;
export const STRAY_AGREE = 0.005;
/** the samples (oldest first) without a lone one more than STRAY_OFF from both neighbours while they are within STRAY_AGREE of each other */
export function withoutStrays(xs: Candle[]): Candle[] {
  const off = (x: number, y: number): number => Math.abs(x - y) / y;
  return xs.filter((b, i) => {
    const a = xs[i - 1];
    const c = xs[i + 1];
    return !a || !c || !(off(a.c, c.c) <= STRAY_AGREE && off(b.c, a.c) > STRAY_OFF && off(b.c, c.c) > STRAY_OFF);
  });
}

/** one share's quote from NASDAQ's info alone (Nasdaq.quote) */
export function nasdaqQuote(deps: PublicDeps = {}): ((symbol: string) => Promise<UsQuote | null | Refusal>) & { clear(): void } {
  const n = nasdaqSource(deps);
  return Object.assign((symbol: string) => n.quote(symbol), { clear: n.clear });
}

/** one share's minutes from NASDAQ's chart alone (Nasdaq.chart) */
export function nasdaqChart(deps: PublicDeps = {}): ((symbol: string) => Promise<Candle[] | null | Refusal>) & { clear(): void } {
  const n = nasdaqSource(deps);
  return Object.assign((symbol: string) => n.chart(symbol), { clear: n.clear });
}

/** what a caller of the chain says with its ask */
export interface UsAsk {
  /** whether the market lists a share under this very ticker (Cboe's symbol book): Robinhood's quote is taken only for a symbol this says
   * yes to, since Robinhood names a share by its token's symbol and that is not always the share's ticker (SATS is EchoStar's token; the
   * share is ECHO). Not given — no book to check against — Robinhood's quote is taken for none, and Nasdaq, which knows the tickers, is asked */
  listed?: ((symbol: string) => boolean) | undefined;
  /** how long the chain is waited for, RT_WAIT_MS unless said */
  waitMs?: number | undefined;
}

/** the chain over both (usQuote) */
export interface UsQuotes {
  /** one share's real-time quote, or nothing (the caller says Cboe's delayed one) */
  (symbol: string, ask?: UsAsk): Promise<UsQuote | undefined>;
  /** many at once, within RT_WAIT_MS: Robinhood's one answer for the ones `listed` allows, then Nasdaq for the first NASDAQ_AT_ONCE of the
   * rest; a symbol neither priced in time is not in the map */
  many(symbols: readonly string[], ask?: UsAsk): Promise<Map<string, UsQuote>>;
  /** start reading Robinhood's answer where the session is one it is taken in, so a caller with something else to wait for first (Cboe's
   * symbol book) does not wait for it after: the answer is kept, and the next ask takes it */
  warm(): void;
  /** let go of the refusals each source holds */
  clear(): void;
}

/** US shares in real time (see the top of this file): Robinhood's quote where it is fresh, listed under that ticker and its session is on,
 * else Nasdaq's in pre-market, the regular session and after-hours, else nothing — all of it within one deadline. A source that refuses is
 * passed over, never the answer for the chain. `nasdaq` is the Nasdaq source to ask, shared with the caller's chart where it has one */
export function usQuote(deps: PublicDeps = {}, nasdaq: Nasdaq = nasdaqSource(deps)): UsQuotes {
  const clock = deps.clock ?? Date.now;
  const robinhood = robinhoodQuotes(deps);
  const sessions = (now: number) => {
    const phase = usPhaseAt(now);
    const day = phase === "pre" || phase === "regular" || phase === "after";
    return { robinhood: day || (phase === "overnight" && ROBINHOOD_OVERNIGHT), nasdaq: day };
  };
  const fresh = (q: UsQuote, now: number) => now - q.at < FRESH_MS && q.at - now < FRESH_MS;
  const many = async (symbols: readonly string[], ask: UsAsk = {}): Promise<Map<string, UsQuote>> => {
    const on = sessions(clock());
    const want = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const out = new Map<string, UsQuote>();
    if (!want.length || (!on.robinhood && !on.nasdaq)) return out;
    const listed = ask.listed;
    const chain = async () => {
      if (on.robinhood && listed) {
        const all = await robinhood();
        const now = clock();
        if (!isRefusal(all))
          for (const s of want) {
            const q = all.get(s);
            if (q && listed(s) && fresh(q, now)) out.set(s, q);
          }
      }
      if (on.nasdaq)
        await Promise.all(
          want
            .filter((s) => !out.has(s))
            .slice(0, NASDAQ_AT_ONCE)
            .map(async (s) => {
              const q = await nasdaq.quote(s);
              if (q && !isRefusal(q)) out.set(s, q);
            }),
        );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([chain().catch(() => undefined), new Promise<void>((go) => (timer = setTimeout(go, Math.max(0, ask.waitMs ?? RT_WAIT_MS))))]);
    clearTimeout(timer);
    // what answered by the deadline: an answer still on its way is kept by its source for the next ask, never added to this one
    return new Map(out);
  };
  const one = async (symbol: string, ask?: UsAsk): Promise<UsQuote | undefined> => (await many([symbol], ask)).get(symbol.trim().toUpperCase());
  return Object.assign(one, {
    many,
    warm: () => {
      if (sessions(clock()).robinhood) void robinhood().catch(() => undefined);
    },
    clear: () => {
      robinhood.clear();
      nasdaq.clear();
    },
  });
}
