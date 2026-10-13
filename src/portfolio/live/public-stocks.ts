/** US STOCKS WITHOUT A KEY: Cboe's own delayed quotes, so the Markets screen's Stocks tab — and a paper account — have real US stock prices
 * before any broker is connected. Read-only: nothing is traded through this listing; a US stock trades at a connected broker (Alpaca,
 * Robinhood: "Connect to trade") or in a paper account, which fills at these quotes by its own declared rule (paper.ts).
 *
 * What is read, and what it is (cboe.com's own quote pages read the same files; checked keyless from this machine 2026-10-13, 14:00 UTC):
 *   GET cdn-api.cboe.com/api/global/delayed_quotes/quotes/{symbol}.json      one stock or ETF: {timestamp, data: {symbol, security_type
 *                       (stock | index), current_price, price_change, price_change_percent (both the DAY's, from prev_day_close), bid, ask,
 *                       bid_size, ask_size, open, high, low, close, prev_day_close, volume (shares), last_trade_time}}, about 520 bytes.
 *                       `timestamp` is when Cboe wrote the file, in UTC; `last_trade_time` is New York time with no zone written, FIFTEEN
 *                       MINUTES behind the market (14:00:46 UTC beside a last trade at 09:45:44 New York, which is 13:45 UTC): the delay is
 *                       Cboe's, said on every line (`readOnly`) and in the paper account's rule. A symbol Cboe does not list answers HTTP
 *                       403 from the store behind the CDN (an XML AccessDenied, not a refusal of this network): read as "not listed".
 *                       A dotted class share is written with its dot (BRK.B). cdn.cboe.com redirects here (HTTP 307) and is not asked:
 *                       the account follows no redirect
 *   GET …/symbol_book/symbol-book.json                                        every symbol Cboe quotes, {name, company_name} (35,748 that
 *                       day, 2.3 MB), kept ten minutes (LIST_MS) and read only for a search: a plain ticker (one to five letters, a class
 *                       letter after a dot) is a stock or an ETF; an index (^SPX) or a futures root is not offered
 *   GET …/charts/intraday/{symbol}.json                                       today's minutes, {datetime (New York), price: {open, high, low,
 *                       close}, volume: {stock_volume}}, folded into 5m and 1h bars; …/charts/historical/{symbol}.json every day since 2004
 *                       (600 KB, kept ten minutes), the last 300 for 1d bars
 * Only what Cboe's file says is carried: the price, the bid and ask, the day's change. Its volume is in shares, so no dollar volume is said
 * (nothing here is estimated). The trading session is the account's own US market calendar (account/calendar.ts), 09:30–16:00 New York on
 * market days: out of it the line says so and keeps the quote Cboe gives (the close); a broker may still take an order then and hold it.
 *
 * Every GET goes through the fixed-host guard (public-markets.ts PUBLIC_HOSTS); a 451, a 429, an edge's 403 page or no answer is Cboe's
 * answer for the whole listing, held back as any public source's is (holdBackMs). */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { etDate, fromEt, nextRegularSession, regularSession } from "../account/calendar.ts";
import { no } from "../refuse.ts";
import { fin, fixedHosts, has, keeper, LIST_MS, list, nonNeg, pos, PUBLIC_HOSTS, publicNo, rec, round, str, type Listing, type PublicDeps, type PublicSource } from "./public-markets.ts";
import { CANDLE_INTERVALS, type Candle, type CandleInterval, type MarketSession } from "./trade.ts";
import { realHttp, unreachable, type Http, type HttpReply } from "./types.ts";

export const CBOE = "https://cdn-api.cboe.com/api/global/delayed_quotes";
/** how far behind the market Cboe's delayed quote is */
export const CBOE_DELAY_MS = 15 * 60_000;
/** the stocks and ETFs shown before anything is typed */
export const US_SHARES: readonly string[] = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "SPY", "QQQ", "AMD", "NFLX", "COIN", "HOOD", "MSTR", "PLTR", "BRK.B", "JPM", "V", "LLY", "UNH", "XOM", "WMT", "COST"];
export const US_STOCKS_ID = "cboe";
export const US_STOCKS_NAME = "Cboe";
/** the line's name, with the delay in it */
export const US_STOCKS_LINE = "Cboe · 15 min delayed";
export const US_STOCKS_READ_ONLY = "Cboe's own delayed quotes, 15 minutes behind the market: a US stock trades at a connected broker (Alpaca, Robinhood), or in a paper account";
/** a plain ticker: one to five letters, a class letter after a dot (BRK.B) */
const TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;
/** Cboe writes a new quote file about once a minute: a quote is kept that long */
const PRICE_MS = 60_000;
/** how long a search for a plain ticker waits for the symbol book before answering from the quote alone */
const BOOK_WAIT_MS = 1_500;
const HISTORY_MS = 60_000;
const TIMEOUT_MS = 8_000;
const BARS = 300;
const BAR_MS: Record<CandleInterval, number> = { "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 };
/** the store behind Cboe's CDN answering for a symbol it has no file for */
const NOT_LISTED = /<Code>\s*AccessDenied\s*<\/Code>/;

interface Quote {
  symbol: string;
  price?: number | undefined;
  bid?: number | undefined;
  ask?: number | undefined;
  change?: number | undefined;
  changePct?: number | undefined;
  /** the last trade, as Cboe stamps it (New York time), in ms */
  lastTradeMs?: number | undefined;
}
interface BookEntry {
  symbol: string;
  company: string;
}

/** "2026-10-13T09:45:44" (New York, as Cboe writes it) in ms; nothing for anything else */
export function cboeTimeMs(v: unknown): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(v ?? ""));
  if (!m) return undefined;
  return fromEt(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) + Number(m[6] ?? 0) * 1000;
}

/** whether a quote fifteen minutes behind the market is from inside the regular session now: true from 09:45 to 16:15 New York on a market
 * day. A paper account fills a US stock only then (paper.ts) */
export const cboeQuoteInSession = (nowMs: number): boolean => nextRegularSession(nowMs - CBOE_DELAY_MS).open;

/** the US stock market's session now, from the account's own calendar, as a market carries it */
export const usSession = (nowMs: number): MarketSession => regularSession(nowMs);

/** the words a line carries while the market is out of its session */
export function usClosedWords(session: MarketSession): string {
  const opens = session.opensAt ? Date.parse(session.opensAt) : NaN;
  return `the US stock market is closed${Number.isFinite(opens) ? `: it opens ${etDate(opens)}, 09:30 New York` : ""}; Cboe's quote is from the close`;
}

/** a few minutes' bars (`t` ms, oldest first) folded into bars of `step` ms */
function foldBars(bars: Candle[], step: number): Candle[] {
  const out = new Map<number, Candle>();
  for (const b of [...bars].sort((a, c) => a.t - c.t)) {
    const at = Math.floor(b.t / step) * step;
    const x = out.get(at);
    if (!x) out.set(at, { t: at, o: b.o, h: b.h, l: b.l, c: b.c, ...(b.v !== undefined ? { v: b.v } : {}) });
    else {
      x.h = Math.max(x.h, b.h);
      x.l = Math.min(x.l, b.l);
      x.c = b.c;
      if (b.v !== undefined) x.v = round((x.v ?? 0) + b.v, 2);
    }
  }
  return [...out.values()];
}

/** US stocks and ETFs at Cboe's delayed quotes, keyless (see the top of this file) */
export function usStocksPublic(deps: PublicDeps = {}): PublicSource {
  const id = US_STOCKS_ID;
  const name = US_STOCKS_NAME;
  const clock = deps.clock ?? Date.now;
  const http = fixedHosts(deps.http ?? realHttp, PUBLIC_HOSTS, deps.timeoutMs ?? TIMEOUT_MS);
  const quotes = keeper<Quote | null>(clock, PRICE_MS);
  const book = keeper<BookEntry[]>(clock, LIST_MS);
  const minutes = keeper<Candle[]>(clock, HISTORY_MS);
  const days = keeper<Candle[]>(clock, LIST_MS);
  const ask = async (url: string): Promise<HttpReply | Refusal> => {
    try {
      return await http(url);
    } catch (err) {
      return unreachable(id, name, err);
    }
  };
  /** one symbol's quote: Cboe's figures, nothing worked out from them; null where Cboe has no file for the symbol */
  const quote = (symbol: string): Promise<Quote | null | Refusal> =>
    quotes(symbol, async () => {
      const r = await ask(`${CBOE}/quotes/${encodeURIComponent(symbol)}.json`);
      if (isRefusal(r)) return r;
      if (r.status === 403 && NOT_LISTED.test(r.text)) return null;
      if (r.status !== 200 || r.body === undefined) return publicNo(id, name, r);
      const d = rec(rec(r.body).data);
      if (str(d.security_type)?.toLowerCase() !== "stock") return null;
      return { symbol, price: pos(d.current_price), bid: pos(d.bid), ask: pos(d.ask), change: fin(d.price_change), changePct: fin(d.price_change_percent), lastTradeMs: cboeTimeMs(d.last_trade_time) };
    });
  /** every plain ticker Cboe quotes, with its company, kept ten minutes */
  const symbols = (): Promise<BookEntry[] | Refusal> =>
    book("book", async () => {
      const r = await ask(`${CBOE}/symbol_book/symbol-book.json`);
      if (isRefusal(r)) return r;
      if (r.status !== 200 || r.body === undefined) return publicNo(id, name, r);
      const out: BookEntry[] = [];
      for (const x of list(rec(r.body).data)) {
        const sym = str(rec(x).name)?.toUpperCase();
        if (!sym || !TICKER.test(sym)) continue;
        out.push({ symbol: sym, company: str(rec(x).company_name) ?? sym });
      }
      return out;
    });
  // how much of the list a listing with nothing searched for shows, for the sentence under it
  let shown: { of: number; total: number } | undefined;
  const listing = (q: Quote, company: string | undefined, now: number): Listing => {
    const session = usSession(now);
    return {
      symbol: q.symbol,
      name: company ?? q.symbol,
      kind: "stock",
      base: q.symbol,
      quote: "USD",
      ...(q.price !== undefined ? { price: q.price } : {}),
      ...(q.bid !== undefined ? { bid: q.bid } : {}),
      ...(q.ask !== undefined ? { ask: q.ask } : {}),
      // a broker takes a stock order at any hour and holds it for the open: the session, not `open`, says whether the market is in session
      open: true,
      types: [],
      session,
      ...(session.open ? {} : { note: usClosedWords(session) }),
      ...(q.change !== undefined ? { change24h: q.change } : {}),
      ...(q.changePct !== undefined ? { changePct24h: q.changePct } : {}),
      venueName: US_STOCKS_LINE,
    };
  };
  return {
    id,
    name,
    kind: "stocks",
    connectTo: "alpaca",
    connector: "live:alpaca",
    readOnly: US_STOCKS_READ_ONLY,
    reset: () => {
      quotes.clear();
      book.clear();
      minutes.clear();
      days.clear();
    },
    async listings(o) {
      const Q = (o.q ?? "").trim().toUpperCase();
      const limit = Math.max(1, o.limit);
      let pool: BookEntry[];
      let all: BookEntry[] | undefined;
      if (Q) {
        // a search: the symbol book, by the ticker first (whole, then its start), then the company's name. A plain ticker typed whole is
        // asked for directly as well, and does not wait for the book past BOOK_WAIT_MS: the book is 2.3 MB and its first read takes
        // longer than the Markets read allows a source, so the first search of "AAPL" answers from the quote alone while the book
        // finishes loading for the next one (the keeper keeps it on its way)
        const ticker = TICKER.test(Q);
        const got = ticker ? await Promise.race([symbols(), new Promise<undefined>((go) => setTimeout(() => go(undefined), BOOK_WAIT_MS))]) : await symbols();
        if (isRefusal(got) && !ticker) return got;
        if (got && !isRefusal(got)) all = got;
        const score = (e: BookEntry): number => (e.symbol === Q ? 3 : e.symbol.startsWith(Q) ? 2 : has(Q, e.company) ? 1 : 0);
        pool = (all ?? [])
          .map((e) => ({ e, s: score(e) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.e.symbol.length - b.e.symbol.length || a.e.symbol.localeCompare(b.e.symbol))
          .slice(0, limit)
          .map((x) => x.e);
        // a ticker typed whole that the book does not carry (or that the book has not yet answered for) is still asked for
        if (ticker && !pool.some((e) => e.symbol === Q)) pool = [{ symbol: Q, company: Q }, ...pool].slice(0, limit);
      } else {
        pool = US_SHARES.slice(0, limit).map((s) => ({ symbol: s, company: s }));
        // the well-known few carry their company's name from the book too (kept ten minutes); the book refusing leaves them their tickers
        const got = await symbols();
        if (!isRefusal(got)) all = got;
      }
      const names = new Map((all ?? []).map((e) => [e.symbol, e.company]));
      // eight at a time, as the Stock Tokens are read
      const got = new Map<string, Quote>();
      let refused: Refusal | undefined;
      for (let i = 0; i < pool.length; i += 8)
        await Promise.all(
          pool.slice(i, i + 8).map(async (e) => {
            const q = await quote(e.symbol);
            if (isRefusal(q)) refused ??= q;
            else if (q) got.set(e.symbol, q);
          }),
        );
      // every quote refused (a place rule, an edge, a ban, no answer): that is Cboe's answer, not a list with no prices
      if (!got.size && refused) return refused;
      const now = clock();
      const out = pool.filter((e) => got.has(e.symbol)).map((e) => listing(got.get(e.symbol)!, names.get(e.symbol) ?? (e.company !== e.symbol ? e.company : undefined), now));
      if (!Q) shown = { of: out.length, total: US_SHARES.length };
      return out;
    },
    notes: (o) => (o.q?.trim() ? [`${name}: its delayed quotes (15 minutes), for any US stock or ETF in its symbol book.`] : [`US stocks: Cboe's own delayed quotes (15 minutes) for ${shown?.of ?? US_SHARES.length} well-known names · search any US stock or ETF by ticker or company.`]),
    /** price history, keyless (see the top of this file): today's minutes folded into 5m and 1h bars, the daily closes for 1d */
    async candles(symbol, interval, sinceMs) {
      const now = clock();
      if (!(CANDLE_INTERVALS as readonly string[]).includes(interval)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: `price history comes in bars of ${CANDLE_INTERVALS.join(", ")}, not "${String(interval).slice(0, 12)}"` });
      if (!(Number.isFinite(sinceMs) && sinceMs >= 0 && sinceMs < now)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: "price history starts before now" });
      const sym = symbol.trim().toUpperCase();
      if (!TICKER.test(sym)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: `a US stock here is its ticker (AAPL, BRK.B), not "${symbol.slice(0, 40)}"` });
      if (interval === "1d") {
        const bars = await days(sym, async () => {
          const r = await ask(`${CBOE}/charts/historical/${encodeURIComponent(sym)}.json`);
          if (isRefusal(r)) return r;
          if (r.status === 403 && NOT_LISTED.test(r.text)) return no("E_VENUE_REJECTED", { venue: id, message: `${name} keeps no history of ${sym}` });
          if (r.status !== 200 || r.body === undefined) return publicNo(id, name, r);
          const out: Candle[] = [];
          for (const x of list(rec(r.body).data).map(rec)) {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x.date ?? ""));
            const [o, h, l, c, v] = [pos(x.open), pos(x.high), pos(x.low), pos(x.close), nonNeg(x.volume)];
            if (!m || o === undefined || h === undefined || l === undefined || c === undefined) continue;
            // a day's bar at its session's open, New York
            out.push({ t: fromEt(Number(m[1]), Number(m[2]), Number(m[3]), 9, 30), o, h, l, c, ...(v !== undefined ? { v } : {}) });
          }
          return out.sort((a, b) => a.t - b.t);
        });
        if (isRefusal(bars)) return bars;
        return bars.filter((b) => b.t >= sinceMs).slice(-BARS);
      }
      const bars = await minutes(sym, async () => {
        const r = await ask(`${CBOE}/charts/intraday/${encodeURIComponent(sym)}.json`);
        if (isRefusal(r)) return r;
        if (r.status === 403 && NOT_LISTED.test(r.text)) return no("E_VENUE_REJECTED", { venue: id, message: `${name} keeps no history of ${sym}` });
        if (r.status !== 200 || r.body === undefined) return publicNo(id, name, r);
        const out: Candle[] = [];
        for (const x of list(rec(r.body).data).map(rec)) {
          const t = cboeTimeMs(x.datetime);
          const p = rec(x.price);
          const [o, h, l, c, v] = [pos(p.open), pos(p.high), pos(p.low), pos(p.close), nonNeg(rec(x.volume).stock_volume)];
          if (t === undefined || o === undefined || h === undefined || l === undefined || c === undefined) continue;
          out.push({ t, o, h, l, c, ...(v !== undefined ? { v } : {}) });
        }
        return out;
      });
      if (isRefusal(bars)) return bars;
      return foldBars(bars, BAR_MS[interval]).filter((b) => b.t >= sinceMs).slice(-BARS);
    },
  };
}

