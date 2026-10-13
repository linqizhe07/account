import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { fromEt } from "../../src/portfolio/account/calendar.ts";
import { PUBLIC_HOSTS, publicSources, type Listing } from "../../src/portfolio/live/public-markets.ts";
import { CBOE_DELAY_MS, cboeQuoteInSession, cboeTimeMs, US_SHARES, US_STOCKS_LINE, usStocksPublic } from "../../src/portfolio/live/public-stocks.ts";
import type { Candle } from "../../src/portfolio/live/trade.ts";
import { json, network } from "./live-public-markets-fixtures.ts";

/** US STOCKS WITHOUT A KEY (live/public-stocks.ts): Cboe's own delayed quotes, read through a stand-in network that answers the shapes Cboe
 * answered on 2026-10-13 (quotes, the symbol book, today's minutes, the daily closes). Nothing leaves the process. */
type Rec = Record<string, unknown>;
/** Tuesday 13 October 2026, 10:30 New York: the regular session is under way, and a quote fifteen minutes behind is from inside it */
const NOW = fromEt(2026, 10, 13, 10, 30);
const STAMP = "2026-10-13 14:30:46";
const quoteOf = (symbol: string, price: number, extra: Rec = {}) =>
  json({ timestamp: STAMP, data: { symbol, security_type: "stock", exchange_id: 2, current_price: price, price_change: 0.84, price_change_percent: 0.2464, bid: price - 0.05, ask: price + 0.06, bid_size: 1280, ask_size: 80, open: price + 2.9, high: price + 6.3, low: price - 0.7, close: price, prev_day_close: price - 0.84, volume: 6877536, iv30: 26.691, last_trade_time: "2026-10-13T10:15:44", tick: "up", ...extra }, symbol });
const NOT_LISTED = { status: 403, body: undefined, text: '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>' };
const BOOK = json({ timestamp: "2026-10-13 13:00:03", data: [{ name: "A", company_name: "Agilent Technologies Inc" }, { name: "A2RZ1", company_name: "Adjusted Interest Rate Russell 2000 Total Return Futures" }, { name: "AAPL", company_name: "Apple Inc" }, { name: "APP", company_name: "AppLovin Corp" }, { name: "NVDA", company_name: "NVIDIA Corp" }, { name: "BRK.B", company_name: "Berkshire Hathaway Inc" }, { name: "^SPX", company_name: "S&P 500 INDEX" }, { name: "SPY", company_name: "SPDR S&P 500 ETF Trust" }] });
const routes = (): Array<[string, ReturnType<typeof json> | ((url: string) => ReturnType<typeof json>)]> => [
  ["/quotes/AAPL.json", quoteOf("AAPL", 341.81)],
  ["/quotes/NVDA.json", quoteOf("NVDA", 180.5)],
  ["/quotes/APP.json", quoteOf("APP", 400)],
  ["/quotes/BRK.B.json", quoteOf("BRK.B", 520.11)],
  ["/quotes/_SPX.json", quoteOf("^SPX", 7810.31, { security_type: "index" })],
  ["/quotes/ZZZZ.json", NOT_LISTED],
  ["/charts/intraday/ZZZZ.json", NOT_LISTED],
  ["/symbol_book/symbol-book.json", BOOK],
  ["/charts/intraday/AAPL.json", json({ timestamp: STAMP, data: [{ datetime: "2026-10-13T09:31:00", price: { open: 344.665, high: 347.61, low: 344.665, close: 346.9699 }, volume: { stock_volume: 1637693 } }, { datetime: "2026-10-13T09:32:00", price: { open: 346.935, high: 347.2, low: 346.5, close: 346.8 }, volume: { stock_volume: 500000 } }, { datetime: "2026-10-13T09:36:00", price: { open: 346.8, high: 348.1, low: 346.1, close: 347.5 }, volume: { stock_volume: 400000 } }] })],
  ["/charts/historical/AAPL.json", json({ timestamp: "11:00:08", data: [{ date: "2004-01-02", volume: 2024993600, open: 0.39, high: 0.39, low: 0.38, close: 0.38 }, { date: "2026-10-09", volume: 50000000, open: 340, high: 342, low: 338, close: 341 }, { date: "2026-10-12", volume: 48000000, open: 341, high: 343, low: 339, close: 340.97 }] })],
];
const listings = async (o: { q?: string; limit: number }, net = network(routes()), clock = () => NOW) => {
  const got = await usStocksPublic({ http: net.http, clock }).listings(o);
  if (isRefusal(got)) throw new Error(`${got.code}: ${got.message}`);
  return got;
};

describe("US stocks, keyless, at Cboe's delayed quotes", () => {
  it("lists the well-known names first, each with Cboe's own price, bid, ask and day change, the session from the market calendar, and the delay said on the line; read-only, a broker to connect", async () => {
    const net = network(routes());
    const src = usStocksPublic({ http: net.http, clock: () => NOW });
    const got = (await src.listings({ limit: 2 })) as Listing[];
    expect(US_SHARES.slice(0, 2)).toEqual(["NVDA", "AAPL"]);
    expect(got.map((m) => m.symbol)).toEqual(["NVDA", "AAPL"]);
    expect(got[1]).toEqual({ symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 341.81, bid: 341.76, ask: 341.87, open: true, types: [], session: { open: true, closesAt: new Date(fromEt(2026, 10, 13, 16)).toISOString() }, change24h: 0.84, changePct24h: 0.2464, venueName: US_STOCKS_LINE });
    // nothing worked out from Cboe's figures: its volume is in shares, so no dollar volume
    expect(got[1]!.volumeUsd24h).toBeUndefined();
    // the symbol book for the names (kept ten minutes), then the two quotes, and nothing else
    expect(net.sent.map((s) => s.url)).toEqual(["https://cdn-api.cboe.com/api/global/delayed_quotes/symbol_book/symbol-book.json", "https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/NVDA.json", "https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/AAPL.json"]);
    expect(src).toMatchObject({ id: "cboe", name: "Cboe", kind: "stocks", connectTo: "alpaca", connector: "live:alpaca" });
    expect(src.readOnly).toContain("15 minutes behind the market");
    expect(src.notes!({})).toEqual(["US stocks: Cboe's own delayed quotes (15 minutes) for 2 well-known names · search any US stock or ETF by ticker or company."]);
    expect(src.notes!({}).every((n) => n.length < 160)).toBe(true);
    expect(PUBLIC_HOSTS).toContain("cdn-api.cboe.com");
    expect(publicSources().map((s) => s.id)).toContain("cboe");
    // a quote is kept a minute, the book ten: the same listing again asks nothing
    await src.listings({ limit: 2 });
    expect(net.sent).toHaveLength(3);
    // the book refusing leaves the well-known their tickers for names, and the quotes still answer
    const noBook = network([["/symbol_book/", { status: 500, body: undefined, text: "" }], ["/quotes/NVDA.json", quoteOf("NVDA", 180.5)], ["/quotes/AAPL.json", quoteOf("AAPL", 341.81)]]);
    expect(((await usStocksPublic({ http: noBook.http, clock: () => NOW }).listings({ limit: 2 })) as Listing[]).map((m) => m.name)).toEqual(["NVDA", "AAPL"]);
  });

  it("a search reads Cboe's symbol book: the ticker whole first, then its start, then the company's name; an index and a futures root are not stocks; a dotted class share is; a ticker the book lacks is still asked for, and one Cboe has no file for is not listed", async () => {
    const net = network(routes());
    const src = usStocksPublic({ http: net.http, clock: () => NOW });
    const app = (await src.listings({ q: "app", limit: 5 })) as Listing[];
    // APP whole, then Apple by its company name; the company's name comes with the quote
    expect(app.map((m) => [m.symbol, m.name])).toEqual([["APP", "AppLovin Corp"], ["AAPL", "Apple Inc"]]);
    expect(net.sent.filter((s) => s.url.includes("symbol_book"))).toHaveLength(1);
    // the same book serves the well-known list's names
    expect(((await src.listings({ limit: 2 })) as Listing[]).map((m) => m.name)).toEqual(["NVIDIA Corp", "Apple Inc"]);
    expect(((await src.listings({ q: "berk", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["BRK.B"]);
    // the book is kept ten minutes: one read for both searches
    expect(net.sent.filter((s) => s.url.includes("symbol_book"))).toHaveLength(1);
    // an index (^SPX) and a futures root (A2RZ1) are no stock: not asked for, not listed
    expect(await src.listings({ q: "A2RZ", limit: 5 })).toEqual([]);
    expect(await src.listings({ q: "^SPX", limit: 5 })).toEqual([]);
    expect(net.sent.some((s) => s.url.includes("_SPX") || s.url.includes("A2RZ1"))).toBe(false);
    // a ticker typed whole that the book does not carry is asked for all the same; Cboe's store answers AccessDenied, which is "not listed"
    expect(await src.listings({ q: "ZZZZ", limit: 5 })).toEqual([]);
    expect(net.sent.some((s) => s.url.endsWith("/quotes/ZZZZ.json"))).toBe(true);
    // a quote that is an index is not listed either
    const spx = network([["/quotes/SPY.json", quoteOf("SPY", 778.67, { security_type: "index" })], ["/symbol_book/", BOOK]]);
    expect(await usStocksPublic({ http: spx.http, clock: () => NOW }).listings({ q: "SPY", limit: 5 })).toEqual([]);
    expect(src.notes!({ q: "app" })).toEqual(["Cboe: its delayed quotes (15 minutes), for any US stock or ETF in its symbol book."]);
  });

  it("a plain ticker typed whole answers from its quote without waiting for a slow symbol book (the book finishes loading for the next search), so the first search of AAPL is the share and not a slower source's token", async () => {
    let bookAsked = 0;
    const slow = {
      http: async (url: string, init?: { timeoutMs?: number }) => {
        if (url.includes("symbol_book")) {
          bookAsked++;
          await new Promise((go) => setTimeout(go, 2_000));
          return BOOK;
        }
        return url.includes("/quotes/AAPL.json") ? quoteOf("AAPL", 341.81) : url.includes("/quotes/APP.json") ? quoteOf("APP", 400) : NOT_LISTED;
      },
    };
    const src = usStocksPublic({ http: slow.http, clock: () => NOW });
    const t0 = Date.now();
    const got = (await src.listings({ q: "aapl", limit: 5 })) as Listing[];
    expect(Date.now() - t0).toBeLessThan(1_900);
    expect(got.map((m) => [m.symbol, m.name])).toEqual([["AAPL", "AAPL"]]);
    // a search by a company's name has to wait for the book
    expect(((await src.listings({ q: "applovin", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["APP"]);
    // the book was loaded once, on its way during the first search, and kept
    expect(bookAsked).toBe(1);
    expect(((await src.listings({ q: "aapl", limit: 5 })) as Listing[]).map((m) => [m.symbol, m.name])).toEqual([["AAPL", "Apple Inc"]]);
  });

  it("out of the session the line says the market is closed and when it opens, and keeps Cboe's quote (the close); the delayed window is the session shifted by fifteen minutes", async () => {
    const night = fromEt(2026, 10, 13, 21, 0);
    const got = await listings({ limit: 1 }, network(routes()), () => night);
    expect(got[0]!.session).toEqual({ open: false, opensAt: new Date(fromEt(2026, 10, 14, 9, 30)).toISOString() });
    expect(got[0]!.note).toBe("the US stock market is closed: it opens Wed 14 Oct, 09:30 New York; Cboe's quote is from the close");
    expect(got[0]!.open).toBe(true);
    // the window: from 09:45 to 16:15 New York on a market day
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 9, 40))).toBe(false);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 9, 45))).toBe(true);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 16, 10))).toBe(true);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 16, 15))).toBe(false);
    expect(cboeQuoteInSession(fromEt(2026, 10, 17, 12, 0))).toBe(false);
    expect(CBOE_DELAY_MS).toBe(15 * 60_000);
    // Cboe's stamps are New York time with no zone written
    expect(cboeTimeMs("2026-10-13T09:45:44")).toBe(fromEt(2026, 10, 13, 9, 45) + 44_000);
    expect(cboeTimeMs("2026-10-13 09:45")).toBeUndefined();
  });

  it("price history: today's minutes folded into 5m and 1h bars, the daily closes for 1d (the last 300 since the start asked), the volume in shares", async () => {
    const net = network(routes());
    const src = usStocksPublic({ http: net.http, clock: () => NOW });
    const five = (await src.candles!("AAPL", "5m", NOW - 3_600_000)) as Candle[];
    expect(five).toEqual([
      { t: fromEt(2026, 10, 13, 9, 30), o: 344.665, h: 347.61, l: 344.665, c: 346.8, v: 2137693 },
      { t: fromEt(2026, 10, 13, 9, 35), o: 346.8, h: 348.1, l: 346.1, c: 347.5, v: 400000 },
    ]);
    // a bar that began before the start asked is not one of them (the exchanges' rule): the hour is asked from two hours back
    const hour = (await src.candles!("aapl", "1h", NOW - 2 * 3_600_000)) as Candle[];
    expect(hour).toEqual([{ t: fromEt(2026, 10, 13, 9, 0), o: 344.665, h: 348.1, l: 344.665, c: 347.5, v: 2537693 }]);
    const days = (await src.candles!("AAPL", "1d", fromEt(2026, 10, 1))) as Candle[];
    expect(days.map((b) => [b.t, b.c])).toEqual([[fromEt(2026, 10, 9, 9, 30), 341], [fromEt(2026, 10, 12, 9, 30), 340.97]]);
    // the minutes once, the days once: both kept
    await src.candles!("AAPL", "1h", NOW - 2 * 3_600_000);
    expect(net.sent.filter((s) => s.url.includes("/charts/")).map((s) => s.url.split("/charts/")[1])).toEqual(["intraday/AAPL.json", "historical/AAPL.json"]);
    expect((await src.candles!("^SPX", "1h", NOW - 3_600_000) as Refusal).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect((await src.candles!("ZZZZ", "1h", NOW - 3_600_000) as Refusal).message).toContain("keeps no history");
  });

  it("Cboe refusing this network — a 451, a 429, no answer — is its answer for the whole listing, held back as any public source's is; a refusal of one quote beside others answering leaves that line out", async () => {
    const blocked = network([["cdn-api.cboe.com", { status: 451, body: undefined, text: "unavailable for legal reasons" }]]);
    const src = usStocksPublic({ http: blocked.http, clock: () => NOW });
    const r = (await src.listings({ limit: 2 })) as Refusal;
    expect(r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(r.message).toContain("does not serve this location");
    // held ten minutes (the book's refusal and each quote's): the next listing asks nothing
    await src.listings({ limit: 2 });
    expect(blocked.sent).toHaveLength(3);
    const some = network([["/quotes/NVDA.json", { status: 500, body: undefined, text: "" }], ["/quotes/AAPL.json", quoteOf("AAPL", 341.81)]]);
    expect(((await usStocksPublic({ http: some.http, clock: () => NOW }).listings({ limit: 2 })) as Listing[]).map((m) => m.symbol)).toEqual(["AAPL"]);
  });
});
