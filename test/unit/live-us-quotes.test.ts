import { describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { fromEt } from "../../src/portfolio/account/calendar.ts";
import { fixedHosts, PUBLIC_HOSTS } from "../../src/portfolio/live/public-markets.ts";
import { realHttp, type Http, type HttpReply } from "../../src/portfolio/live/types.ts";
import { FRESH_MS, NASDAQ_AT_ONCE, NASDAQ_FROM, NASDAQ_UA, nasdaqChart, nasdaqNumber, nasdaqQuote, nasdaqSource, nasdaqTimeMs, ROBINHOOD_FROM, ROBINHOOD_NEXT_MS, ROBINHOOD_OVERNIGHT, ROBINHOOD_PRICES, robinhoodQuotes, RT_WAIT_MS, usQuote, withoutStrays, type UsQuote, type UsQuotes } from "../../src/portfolio/live/us-quotes.ts";
import { json, network } from "./live-public-markets-fixtures.ts";

/** US STOCK QUOTES IN REAL TIME (live/us-quotes.ts), read through stand-in networks. The answers are the shapes the sources gave:
 *   · Robinhood GET /rhj/prices and Nasdaq GET /api/quote/{SYM}/info and /chart, live on Wed 2026-10-14 between 16:30 and 16:55 UTC (the
 *     regular session), trimmed to a few symbols and fields (Robinhood's `deployments`, Nasdaq's keyStats and notifications left out);
 *   · Nasdaq's info outside the regular session as web.archive.org captured it: AKAM in pre-market (2025-08-21 08:46 New York), AKA in
 *     after-hours (2026-04-13 18:22), ALX closed (2026-04-14 00:52);
 *   · an edge's 403 page in Akamai's shape and an HTTP/2 stream reset, which no source answered here today: stand-ins for a refusal;
 *   · SATS as Robinhood quoted it at 17:49 UTC (87.87/87.93: EchoStar's token; the share trades as ECHO) and Nasdaq answered it ("Symbol not
 *     exists.", both classes).
 * Nothing leaves the process. */
type Rec = Record<string, unknown>;
/** Wednesday 14 October 2026, 12:33 New York (EDT): the regular session */
const NOW = fromEt(2026, 10, 14, 12, 33) + 20_000;
const GENERATED = "2026-10-14T16:33:08.490956509Z";
/** one Robinhood record as /rhj/prices gave it: the share's bid and ask, the token's beside them (times the multiplier) */
const rh = (tokenSymbol: string, bid: string, ask: string, extra: Rec = {}): Rec => ({ tokenSymbol, bid, ask, currency: "USD", dailyTradingVolume: "2325834", isTradingHalt: false, generatedAt: GENERATED, dailyHigh: "240.11", dailyLow: "233.59", mintBurnTokenVolume: "0", mintBurnUsdVolume: "0", tokenBid: String(Number(bid) * 1.001148), tokenAsk: String(Number(ask) * 1.001148), ...extra });
const RH_ALL = (extra: Rec[] = [], generatedAt = GENERATED) => json({ quotes: [rh("CRM", "234.98", "235.12"), rh("AAPL", "344.36", "344.39"), rh("NVDA", "222.52", "222.55"), rh("SPY", "769.11", "769.14"), rh("HALT", "10.00", "10.10", { isTradingHalt: true }), rh("OTHER", "1", "2", { currency: "EUR" }), ...extra].map((q) => ({ ...q, generatedAt })) });
/** Robinhood's answer as it stood fifteen seconds before `r` (Robinhood writes one about every fifteen seconds): each book a cent lower, each
 * stamp fifteen seconds earlier. A book is taken only once it has been seen to move — one first seen may have stood since the last session —
 * so a reader that read this one first sees every book in `r` move */
const before = (r: HttpReply): HttpReply => {
  const cent = (v: unknown) => (Number(v) - 0.01).toFixed(2);
  const earlier = (v: unknown) => new Date(Date.parse(String(v).replace(/(\.\d{3})\d+/, "$1")) - 15_000).toISOString();
  return json({ quotes: ((r.body as { quotes: Rec[] }).quotes ?? []).map((x) => ({ ...x, bid: cent(x.bid), ask: cent(x.ask), generatedAt: earlier(x.generatedAt) })) });
};
/** a route for Robinhood's answer: as it stood fifteen seconds before (`before`) on the first ask, then `r` */
const seenMoving = (r: HttpReply) => {
  let asked = 0;
  return () => (asked++ === 0 ? before(r) : r);
};
/** a chain whose clock reads `at`, that read Robinhood's answer once fifteen seconds before (warm(): Robinhood alone, as a listing's first
 * step) — so each book a `seenMoving` route quotes has been seen to move. What that read asked is not counted in `sent` */
async function watching(net: { http: Http; sent?: unknown[] }, at: number): Promise<UsQuotes> {
  let t = at - 15_000;
  const q = usQuote({ http: net.http, clock: () => t });
  q.warm();
  await new Promise((go) => setTimeout(go, 0));
  net.sent?.splice(0);
  t = at;
  return q;
}
/** Robinhood's quotes as a reader reads them at `at` that read the answer before `reply` fifteen seconds earlier */
async function seenAt(reply: HttpReply, at = NOW): Promise<Map<string, UsQuote> | Refusal> {
  let now = at - 15_000;
  const answer = seenMoving(reply);
  const all = robinhoodQuotes({ http: async () => answer(), clock: () => now });
  await all();
  now = at;
  return all();
}
/** Nasdaq's info for AAPL, live at 12:33 New York */
const NQ_AAPL = json({ data: { symbol: "AAPL", companyName: "Apple Inc. Common Stock", stockType: "Common Stock", exchange: "NASDAQ-GS", isNasdaqListed: true, isNasdaq100: true, isHeld: false, primaryData: { lastSalePrice: "$344.9472", netChange: "+3.6772", percentageChange: "+1.08%", deltaIndicator: "up", lastTradeTimestamp: "Oct 14, 2026 12:33 PM ET", isRealTime: true, bidPrice: "$344.85", askPrice: "$344.89", bidSize: "20", askSize: "40", volume: "20,359,925.839302", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
const NQ_JPM = json({ data: { symbol: "JPM", companyName: "JP Morgan Chase & Co. Common Stock", stockType: "Common Stock", exchange: "NYSE", primaryData: { lastSalePrice: "$334.82", netChange: "+3.39", percentageChange: "+1.02%", deltaIndicator: "up", lastTradeTimestamp: "Oct 14, 2026 12:33 PM ET", isRealTime: true, bidPrice: "$334.80", askPrice: "$334.85", bidSize: "53", askSize: "30", volume: "4,564,263.548454", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** an ETF asked as a stock: 200, data null, "Symbol not exists." (SPY, live); and as an ETF */
const NQ_NONE = json({ data: null, message: null, status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: "Symbol not exists." }], developerMessage: null } });
const NQ_SPY_ETF = json({ data: { symbol: "SPY", companyName: "State Street SPDR S&P 500 ETF Trust", stockType: null, exchange: "PSE", primaryData: { lastSalePrice: "$769.14", netChange: "-8.87", percentageChange: "-1.14%", deltaIndicator: "down", lastTradeTimestamp: "Oct 14, 2026 12:32 PM ET", isRealTime: true, bidPrice: "$769.11", askPrice: "$769.13", bidSize: "120", askSize: "45", volume: "19,178,426.514928", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "ETF" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** archived: pre-market, after-hours, closed */
const NQ_AKAM_PRE = json({ data: { symbol: "AKAM", primaryData: { lastSalePrice: "$76.65", netChange: "+0.59", percentageChange: "+0.78%", deltaIndicator: "up", lastTradeTimestamp: "Aug 21, 2025 8:02 AM ET", isRealTime: true, bidPrice: "$75.00", askPrice: "$77.00", bidSize: "10", askSize: "83", volume: "91", currency: null }, secondaryData: { lastSalePrice: "$76.06", netChange: "-0.43", percentageChange: "-0.56%", deltaIndicator: "down", lastTradeTimestamp: "Closed at Aug 20, 2025 4:00 PM ET", isRealTime: false, bidPrice: "", askPrice: "", bidSize: "", askSize: "", volume: "", currency: null }, marketStatus: "Pre-Market", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
const NQ_AKA_AFTER = json({ data: { symbol: "AKA", primaryData: { lastSalePrice: "$9.87", netChange: "-0.47", percentageChange: "-4.55%", deltaIndicator: "down", lastTradeTimestamp: "Apr 13, 2026 6:22 PM ET", isRealTime: true, bidPrice: "$4.21", askPrice: "$11.40", bidSize: "200", askSize: "13", volume: "530.707642", currency: null }, secondaryData: { lastSalePrice: "$10.34", netChange: "-0.31", percentageChange: "-2.91%", deltaIndicator: "down", lastTradeTimestamp: "Closed at Apr 13, 2026 4:00 PM ET", isRealTime: false, bidPrice: "", askPrice: "", bidSize: "", askSize: "", volume: "", currency: null }, marketStatus: "After-Hours", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
const NQ_ALX_CLOSED = json({ data: { symbol: "ALX", primaryData: { lastSalePrice: "$243.88", netChange: "-3.52", percentageChange: "-1.42%", deltaIndicator: "down", lastTradeTimestamp: "Apr 13, 2026", isRealTime: false, bidPrice: "N/A", askPrice: "N/A", bidSize: "N/A", askSize: "N/A", volume: "52,620", currency: null }, secondaryData: null, marketStatus: "Closed", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** an edge's refusal page, in the shape Akamai serves one (a stand-in: Nasdaq did not refuse this machine today) */
const AKAMAI_403: HttpReply = { status: 403, body: undefined, text: '<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n \nYou don\'t have permission to access "http&#58;&#47;&#47;api&#46;nasdaq&#46;com&#47;api&#47;quote&#47;AAPL&#47;info&#63;" on this server.<P>\nReference&#32;&#35;18&#46;0\n</BODY>\n</HTML>\n' };
/** a stream reset, as Node's fetch throws it (a stand-in for the HTTP/2 INTERNAL_ERROR curl met) */
const h2Reset = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR"), { code: "ERR_HTTP2_STREAM_ERROR" }) });

const nq = (sym: string, cls = "stocks", what = "info") => `https://api.nasdaq.com/api/quote/${sym}/${what}?assetclass=${cls}`;

describe("Robinhood's one answer for every share it quotes", () => {
  it("one GET of /rhj/prices: each share by its ticker, at the SHARE's bid and ask (not the token's), the middle as the price, the answer's own stamp; a halted share and one not in dollars left out; kept ten seconds", async () => {
    let now = NOW - 15_000;
    const net = network([["/rhj/prices", seenMoving(RH_ALL())]]);
    const all = robinhoodQuotes({ http: net.http, clock: () => now });
    // the first answer read: every book first seen, none taken (see the next test)
    expect(await all()).toEqual(new Map());
    now = NOW;
    const got = (await all()) as Map<string, UsQuote>;
    expect(net.sent.map((s) => s.url)).toEqual([ROBINHOOD_PRICES, ROBINHOOD_PRICES]);
    expect([...got.keys()]).toEqual(["CRM", "AAPL", "NVDA", "SPY"]);
    expect(got.get("AAPL")).toEqual({ symbol: "AAPL", price: 344.375, bid: 344.36, ask: 344.39, at: Date.parse("2026-10-14T16:33:08.490Z"), delayMs: 0, from: ROBINHOOD_FROM });
    // no day's change: Robinhood gives none
    expect(got.get("CRM")!.change).toBeUndefined();
    // kept ten seconds, then asked again
    now += 9_000;
    await all();
    expect(net.sent).toHaveLength(2);
    now += 2_000;
    await all();
    expect(net.sent).toHaveLength(3);
    expect(PUBLIC_HOSTS).toContain("api.robinhood.com");
  });

  it("a share's stamp is the first answer in which its bid and ask stood as they stand — not the latest answer's, which Robinhood writes every fifteen seconds whether or not anything moved — so a book that stops moving ages", async () => {
    let now = NOW - 15_000;
    let answer = before(RH_ALL());
    const all = robinhoodQuotes({ http: async () => answer, clock: () => now });
    await all();
    now = NOW;
    answer = RH_ALL();
    const first = (await all()) as Map<string, UsQuote>;
    expect(first.get("AAPL")!.at).toBe(Date.parse("2026-10-14T16:33:08.490Z"));
    // fifteen seconds on: a new answer, AAPL's bid and ask as they were, NVDA's moved
    now += 15_000;
    const later = "2026-10-14T16:33:23.512345678Z";
    answer = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: later }), rh("NVDA", "222.53", "222.56", { generatedAt: later })] });
    const second = (await all()) as Map<string, UsQuote>;
    expect(second.get("AAPL")!.at).toBe(Date.parse("2026-10-14T16:33:08.490Z"));
    expect(second.get("NVDA")!.at).toBe(Date.parse("2026-10-14T16:33:23.512Z"));
    // AAPL's book still standing three minutes on: its stamp is three minutes old, and the chain passes it over (FRESH_MS)
    now += 180_000;
    const third = new Date(now).toISOString();
    answer = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: third }), rh("SATS", "87.87", "87.93", { generatedAt: third })] });
    expect(((await all()) as Map<string, UsQuote>).get("AAPL")!.at).toBe(Date.parse("2026-10-14T16:33:08.490Z"));
    // through the chain: AAPL's book standing still for three minutes is passed over (and Nasdaq, here, knows nothing)
    let t = NOW - 15_000;
    let reply = before(RH_ALL());
    const chain = usQuote({ http: async (url) => (url === ROBINHOOD_PRICES ? reply : NQ_NONE), clock: () => t });
    expect(await chain("AAPL", { listed: () => true })).toBeUndefined();
    t = NOW;
    reply = RH_ALL();
    expect((await chain("AAPL", { listed: () => true }))!.from).toBe(ROBINHOOD_FROM);
    t += 180_000;
    reply = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: new Date(t).toISOString() })] });
    expect(await chain("AAPL", { listed: () => true })).toBeUndefined();
  });

  it("a book first seen is not taken — after a restart, Friday's book read on Sunday night is no live quote — until it moves while watched; one that moved across answers not read is stamped with the last one read, and one older than an answer read says nothing", async () => {
    // Sunday 18 October 2026, 20:01 New York: the overnight session (Robinhood alone) has just begun; the service has just started, and
    // Robinhood's answer, written five seconds ago, carries AAPL's book as it stood at Friday's close
    const sunday = fromEt(2026, 10, 18, 20, 1);
    let t = sunday;
    let reply = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: new Date(t - 5_000).toISOString() })] });
    const net = network([["/rhj/prices", () => reply], ["api.nasdaq.com", NQ_NONE]]);
    const all = robinhoodQuotes({ http: net.http, clock: () => t });
    const chain = usQuote({ http: net.http, clock: () => t });
    const listed = () => true;
    expect(await all()).toEqual(new Map());
    expect(await chain("AAPL", { listed })).toBeUndefined();
    expect(net.sent.filter((s) => s.url === ROBINHOOD_PRICES)).toHaveLength(2);
    // the next answer, the book where it stood: still not known since when, still not taken
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(await all()).toEqual(new Map());
    expect(await chain("AAPL", { listed })).toBeUndefined();
    // the book moves while watched: from that answer on, Robinhood's real-time quote
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.40", "344.43", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(((await all()) as Map<string, UsQuote>).get("AAPL")!.at).toBe(t - 5_000);
    expect(await chain("AAPL", { listed })).toMatchObject({ from: ROBINHOOD_FROM, at: t - 5_000, bid: 344.4 });
    // nobody asks for ten minutes; the book moved once in that time, then stood: it may have moved just after the last answer read, so it
    // is stamped with that one — ten minutes old, not fresh — and the chain passes it over (Nasdaq keeps no overnight session)
    const lastRead = t - 5_000;
    t += 600_000;
    reply = json({ quotes: [rh("AAPL", "344.80", "344.83", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(600_000).toBeGreaterThan(ROBINHOOD_NEXT_MS);
    expect(((await all()) as Map<string, UsQuote>).get("AAPL")!.at).toBe(lastRead);
    expect(await chain("AAPL", { listed })).toBeUndefined();
    // moving again under watch, it is live again
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.81", "344.84", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(await chain("AAPL", { listed })).toMatchObject({ from: ROBINHOOD_FROM, at: t - 5_000 });
    // an answer older than one already read (a stale copy served late) says nothing of the book: left out, not stamped by it
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.10", "344.13", { generatedAt: new Date(t - 120_000).toISOString() })] });
    expect(await all()).toEqual(new Map());
  });

  it("a crossed or one-sided book is no price; Robinhood refusing this network, not answering, or answering with no quotes is a refusal, never an empty map", async () => {
    expect([...((await seenAt(json({ quotes: [rh("AAPL", "344.39", "344.36"), rh("NVDA", "0", "222.55"), rh("TSLA", "366.40", "366.45")] }))) as Map<string, UsQuote>).keys()]).toEqual(["TSLA"]);
    const blocked = network([["/rhj/prices", { status: 451, body: undefined, text: "unavailable for legal reasons" }]]);
    expect(((await robinhoodQuotes({ http: blocked.http, clock: () => NOW })()) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    const down: Http = async () => {
      throw h2Reset();
    };
    expect(((await robinhoodQuotes({ http: down, clock: () => NOW })()) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    const empty = network([["/rhj/prices", json({ quotes: [] })]]);
    const r = (await robinhoodQuotes({ http: empty.http, clock: () => NOW })()) as Refusal;
    expect(isRefusal(r)).toBe(true);
    expect(r.message).toContain("no quotes");
  });
});

describe("Nasdaq's quote", () => {
  it("reads the last trade, bid and ask from its strings, the stamp to the minute in New York, the day's change; sends a browser's user-agent", async () => {
    const sent: Array<{ url: string; headers: Record<string, string> }> = [];
    const http: Http = async (url, init = {}) => {
      sent.push({ url, headers: init.headers ?? {} });
      return url.includes("/AAPL/") ? NQ_AAPL : NQ_NONE;
    };
    const q = (await nasdaqQuote({ http, clock: () => NOW })("aapl")) as UsQuote;
    expect(q).toEqual({ symbol: "AAPL", price: 344.9472, bid: 344.85, ask: 344.89, at: fromEt(2026, 10, 14, 12, 33), delayMs: 0, from: NASDAQ_FROM, change: 3.6772, changePct: 1.08 });
    expect(sent).toEqual([{ url: nq("AAPL"), headers: { accept: "application/json", "user-agent": NASDAQ_UA } }]);
    expect(NASDAQ_UA).toMatch(/^Mozilla\/5\.0 .*Chrome\/[\d.]+ Safari\/[\d.]+$/);
    expect(PUBLIC_HOSTS).toContain("api.nasdaq.com");
    // its stamps and figures
    expect(nasdaqTimeMs("Oct 14, 2026 12:33 PM ET")).toBe(Date.parse("2026-10-14T16:33:00Z"));
    expect(nasdaqTimeMs("Dec 1, 2026 12:05 AM ET")).toBe(Date.parse("2026-12-01T05:05:00Z"));
    expect(nasdaqTimeMs("Apr 13, 2026")).toBeUndefined();
    expect(nasdaqTimeMs("Closed at Apr 13, 2026 4:00 PM ET")).toBeUndefined();
    expect([nasdaqNumber("$1,234.56"), nasdaqNumber("+3.6772"), nasdaqNumber("-1.14%"), nasdaqNumber("N/A"), nasdaqNumber(""), nasdaqNumber("$")]).toEqual([1234.56, 3.6772, -1.14, undefined, undefined, undefined]);
    // a crossed book (bid above ask: Nasdaq's own book, not the national best) gives neither side; the last trade stands
    const crossed = json({ data: { ...(NQ_AAPL.body as { data: Rec }).data, primaryData: { ...((NQ_AAPL.body as { data: Rec }).data.primaryData as Rec), bidPrice: "$344.95", askPrice: "$344.89" } } });
    const c = (await nasdaqQuote({ http: async () => crossed, clock: () => NOW })("AAPL")) as UsQuote;
    expect([c.price, c.bid, c.ask]).toEqual([344.9472, undefined, undefined]);
  });

  it("an ETF: asked as a stock first (200, data null), then as an ETF, and the class remembered; a symbol neither knows is not listed, and kept ten minutes", async () => {
    let now = NOW;
    const net = network([[nq("SPY", "etf"), NQ_SPY_ETF], [nq("SPY"), NQ_NONE], [nq("ZZZZ"), NQ_NONE], [nq("ZZZZ", "etf"), NQ_NONE]]);
    const quote = nasdaqQuote({ http: net.http, clock: () => now });
    expect(await quote("SPY")).toMatchObject({ symbol: "SPY", price: 769.14, bid: 769.11, ask: 769.13, at: fromEt(2026, 10, 14, 12, 32), change: -8.87, changePct: -1.14 });
    expect(net.sent.map((s) => s.url)).toEqual([nq("SPY"), nq("SPY", "etf")]);
    now += 11_000;
    await quote("SPY");
    // kept ten seconds, then asked again — as an ETF only
    expect(net.sent.map((s) => s.url).slice(2)).toEqual([nq("SPY", "etf")]);
    expect(await quote("ZZZZ")).toBeNull();
    now += 9 * 60_000;
    expect(await quote("ZZZZ")).toBeNull();
    expect(net.sent.filter((s) => s.url.includes("ZZZZ"))).toHaveLength(2);
    // a 404 as a stock is "not as a stock" too
    const four = network([[nq("QQQ"), json({ message: "not found" }, 404)], [nq("QQQ", "etf"), NQ_SPY_ETF]]);
    expect(await nasdaqQuote({ http: four.http, clock: () => NOW })("QQQ")).toMatchObject({ price: 769.14 });
  });

  it("one Nasdaq for the quote and the chart: the class one answered is the other's too; a symbol hinted as an ETF (its company's name) is asked as one first, and a wrong hint costs one ask", async () => {
    const chart = json({ data: { symbol: "SPY", chart: [{ x: 1791950400000, y: 769.1 }] } });
    const net = network([[nq("SPY", "etf"), NQ_SPY_ETF], [nq("SPY", "etf", "chart"), chart], [nq("O"), NQ_JPM], [nq("O", "etf"), NQ_NONE], ["api.nasdaq.com", NQ_NONE]]);
    const n = nasdaqSource({ http: net.http, clock: () => NOW });
    expect(await n.quote("SPY")).toMatchObject({ price: 769.14 });
    expect(await n.chart("SPY")).toHaveLength(1);
    // SPY as a stock once (the quote), then as an ETF only
    expect(net.sent.map((x) => x.url)).toEqual([nq("SPY"), nq("SPY", "etf"), nq("SPY", "etf", "chart")]);
    const hinted = network([[nq("QQQ", "etf"), NQ_SPY_ETF], ["api.nasdaq.com", NQ_NONE]]);
    const h = nasdaqSource({ http: hinted.http, clock: () => NOW });
    h.hint("QQQ", "etf");
    expect(await h.quote("QQQ")).toMatchObject({ price: 769.14 });
    expect(hinted.sent.map((x) => x.url)).toEqual([nq("QQQ", "etf")]);
    // a hint that was wrong (a "Trust" that is a company): asked as an ETF, then as a stock, and the stock remembered over the hint
    const wrong = nasdaqSource({ http: net.http, clock: () => NOW });
    wrong.hint("O", "etf");
    expect(await wrong.quote("O")).toMatchObject({ price: 334.82 });
    wrong.hint("O", "etf");
    await wrong.chart("O");
    expect(net.sent.map((x) => x.url).slice(3)).toEqual([nq("O", "etf"), nq("O"), nq("O", "stocks", "chart")]);
  });

  it("outside the regular session (archived answers): an extended session's last trade with its own stamp and primaryData's change — the change of that price from the last regular close, not the session before's — ; a closed market's answer, stamped by its date alone, is no quote", async () => {
    const pre = network([[nq("AKAM"), NQ_AKAM_PRE]]);
    // 76.65 less 0.59 is 76.06, the close secondaryData names; secondaryData's own change (-0.43) is the day before's, and is not taken
    expect(await nasdaqQuote({ http: pre.http, clock: () => fromEt(2025, 8, 21, 8, 46) })("AKAM")).toEqual({ symbol: "AKAM", price: 76.65, bid: 75, ask: 77, at: fromEt(2025, 8, 21, 8, 2), delayMs: 0, from: NASDAQ_FROM, change: 0.59, changePct: 0.78 });
    const after = network([[nq("AKA"), NQ_AKA_AFTER]]);
    // 9.87 less -0.47 is 10.34, that day's close
    expect(await nasdaqQuote({ http: after.http, clock: () => fromEt(2026, 4, 13, 18, 23) })("AKA")).toEqual({ symbol: "AKA", price: 9.87, bid: 4.21, ask: 11.4, at: fromEt(2026, 4, 13, 18, 22), delayMs: 0, from: NASDAQ_FROM, change: -0.47, changePct: -4.55 });
    const closed = network([[nq("ALX"), NQ_ALX_CLOSED]]);
    expect(await nasdaqQuote({ http: closed.http, clock: () => fromEt(2026, 4, 14, 0, 52) })("ALX")).toBeNull();
    // only one ask: Nasdaq knows it as a stock
    expect(closed.sent).toHaveLength(1);
  });

  it("Nasdaq refusing — an edge's 403 page, an HTTP/2 stream reset, a 4xx as both classes — is a refusal, and an edge's page is not asked again as an ETF", async () => {
    const edge = network([["api.nasdaq.com", AKAMAI_403]]);
    const r = (await nasdaqQuote({ http: edge.http, clock: () => NOW })("AAPL")) as Refusal;
    expect(r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(edge.sent).toHaveLength(1);
    let asked = 0;
    const reset: Http = async () => {
      asked++;
      throw h2Reset();
    };
    expect(((await nasdaqQuote({ http: reset, clock: () => NOW })("AAPL")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(asked).toBe(1);
    const forbidden = network([["api.nasdaq.com", json({ message: "forbidden" }, 403)]]);
    const f = (await nasdaqQuote({ http: forbidden.http, clock: () => NOW })("AAPL")) as Refusal;
    expect([f.code, forbidden.sent.length]).toEqual(["E_VENUE_REJECTED", 2]);
    expect(f.message).toContain("HTTP 403");
  });

  it("one refusal that says to wait holds back the WHOLE source — every symbol, the quote and the chart — for as long as holdBackMs says; one that does not (a plain 4xx) holds back nothing; clear() lets go", async () => {
    let now = NOW;
    let edge = true;
    const asked: string[] = [];
    const http: Http = async (url) => {
      asked.push(url);
      if (edge) return AKAMAI_403;
      return url.includes("/AAPL/") ? NQ_AAPL : NQ_JPM;
    };
    const n = nasdaqSource({ http, clock: () => now });
    expect(((await n.quote("AAPL")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    // JPM, and the chart: not asked
    expect(((await n.quote("JPM")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    expect(((await n.chart("TSLA")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    expect(asked).toHaveLength(1);
    // ten minutes on (an edge's page is held as a place rule is), asked again
    edge = false;
    now += 600_001;
    expect(await n.quote("JPM")).toMatchObject({ price: 334.82 });
    // no answer at all: twenty seconds for every symbol
    let down = true;
    const reset: Http = async (url) => {
      asked.push(url);
      if (down) throw h2Reset();
      return NQ_JPM;
    };
    const m = nasdaqSource({ http: reset, clock: () => now });
    const before = asked.length;
    expect(((await m.quote("AAPL")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(((await m.quote("V")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(asked.length - before).toBe(1);
    down = false;
    now += 20_001;
    expect(await m.quote("V")).toMatchObject({ price: 334.82 });
    // clear() lets go of a hold at once
    let refuse = true;
    const z = nasdaqSource({ http: async () => (refuse ? AKAMAI_403 : NQ_JPM), clock: () => NOW });
    await z.quote("AAPL");
    refuse = false;
    expect(isRefusal(await z.quote("V"))).toBe(true);
    z.clear();
    expect(await z.quote("V")).toMatchObject({ price: 334.82 });
    // a plain 4xx (a symbol Nasdaq answers 404 for, as a stock and as an ETF) holds back nothing
    const plain = network([[nq("ZZZZ"), json({ message: "not found" }, 404)], [nq("ZZZZ", "etf"), json({ message: "not found" }, 404)], [nq("JPM"), NQ_JPM]]);
    const p = nasdaqSource({ http: plain.http, clock: () => NOW });
    expect(((await p.quote("ZZZZ")) as Refusal).code).toBe("E_VENUE_REJECTED");
    expect(await p.quote("JPM")).toMatchObject({ price: 334.82 });
  });

  it("the chart: one point a minute from 04:00, x written as New York's wall-clock time and read back to the real instant", async () => {
    const chart = json({ data: { symbol: "AAPL", company: "Apple Inc. Common Stock", timeAsOf: "Oct 14, 2026 12:33 PM ET", lastSalePrice: "$344.8806", previousClose: "$341.27", chart: [{ z: { dateTime: "4:01 AM ET", value: "341.77" }, x: 1791950460000, y: 341.77 }, { z: { dateTime: "4:00 AM ET", value: "342.21" }, x: 1791950400000, y: 342.21 }, { z: { dateTime: "12:32 PM ET", value: "345.165" }, x: 1791981120000, y: 345.165 }, { x: "?", y: 1 }] } });
    const net = network([[nq("AAPL", "stocks", "chart"), chart], [nq("SPY", "stocks", "chart"), NQ_NONE], [nq("SPY", "etf", "chart"), chart]]);
    const read = nasdaqChart({ http: net.http, clock: () => NOW });
    const got = await read("AAPL");
    // 04:00 New York in EDT is 08:00 UTC, not 04:00
    expect(got).toEqual([
      { t: Date.parse("2026-10-14T08:00:00Z"), o: 342.21, h: 342.21, l: 342.21, c: 342.21 },
      { t: Date.parse("2026-10-14T08:01:00Z"), o: 341.77, h: 341.77, l: 341.77, c: 341.77 },
      { t: Date.parse("2026-10-14T16:32:00Z"), o: 345.165, h: 345.165, l: 345.165, c: 345.165 },
    ]);
    expect(await read("SPY")).toHaveLength(3);
    const none = network([["api.nasdaq.com", NQ_NONE]]);
    expect(await nasdaqChart({ http: none.http, clock: () => NOW })("ZZZZ")).toBeNull();
  });

  it("a lone stray print is left out — NVDA's 233.4137 at 4:48 PM between 221.20 and 221.1941 — while a move the next minute stays at is kept", async () => {
    const at = (m: number) => 1791950400000 + (12 * 60 + 44 + m) * 60_000; // 4:44 PM New York and on
    const ys = [221.3468, 221.29, 221.2, 233.4137, 221.1941, 221.202, 226.1, 226.3];
    const chart = json({ data: { symbol: "NVDA", chart: ys.map((y, i) => ({ x: at(i), y })) } });
    const net = network([[nq("NVDA", "stocks", "chart"), chart]]);
    const got = (await nasdaqChart({ http: net.http, clock: () => NOW })("NVDA")) as Array<{ c: number }>;
    expect(got.map((b) => b.c)).toEqual([221.3468, 221.29, 221.2, 221.1941, 221.202, 226.1, 226.3]);
    // the pure rule: a first or last sample has one neighbour only, and stays
    expect(withoutStrays([{ t: 1, o: 300, h: 300, l: 300, c: 300 }, { t: 2, o: 100, h: 100, l: 100, c: 100 }]).length).toBe(2);
  });
});

describe("the chain: Robinhood while fresh and listed under that ticker, else Nasdaq, else nothing — within one deadline", () => {
  /** the sources' answers; Robinhood's as it stood fifteen seconds before on its first ask (`seenMoving`: a chain reads it so in `watching`) */
  const routes = (rhAll: HttpReply = RH_ALL()): Array<[string, HttpReply | (() => HttpReply)]> => [["/rhj/prices", seenMoving(rhAll)], [nq("AAPL"), NQ_AAPL], [nq("JPM"), NQ_JPM], [nq("HALT"), NQ_JPM], [nq("SPY"), NQ_NONE], [nq("SPY", "etf"), NQ_SPY_ETF]];
  /** the tickers the market lists (Cboe's symbol book, in the caller): SATS is not one */
  const BOOK = new Set(["AAPL", "NVDA", "SPY", "CRM", "JPM", "HALT", "ECHO"]);
  const listed = (s: string) => BOOK.has(s);

  it("a share Robinhood quotes and the book lists is Robinhood's; one it does not quote (JPM), or has halted, is Nasdaq's; one neither has is nothing", async () => {
    const net = network([...routes(), ["api.nasdaq.com", NQ_NONE]]);
    const q = await watching(net, NOW);
    expect((await q("AAPL", { listed }))!.from).toBe(ROBINHOOD_FROM);
    expect(await q("JPM", { listed })).toMatchObject({ from: NASDAQ_FROM, price: 334.82 });
    expect((await q("HALT", { listed }))!.from).toBe(NASDAQ_FROM);
    expect(await q("ZZZZ", { listed })).toBeUndefined();
    // Robinhood once for all of it (kept), Nasdaq only for what Robinhood did not price
    expect(net.sent.filter((s) => s.url === ROBINHOOD_PRICES)).toHaveLength(1);
    expect(net.sent.some((s) => s.url.includes("/AAPL/"))).toBe(false);
  });

  it("Robinhood's token symbol is not always the share's ticker: SATS (EchoStar's token; the share is ECHO) is not taken where the book does not list it, and nothing of Robinhood's is taken with no book to check — Nasdaq, which knows the tickers, is asked", async () => {
    const sats = (at: string) => RH_ALL([rh("SATS", "87.87", "87.93")], at);
    const net = network([...routes(sats(GENERATED)), [nq("SATS"), NQ_NONE], [nq("SATS", "etf"), NQ_NONE]]);
    // SATS's book seen moving and fresh: only the ticker keeps it out
    const q = await watching(net, NOW);
    expect(await q("SATS", { listed })).toBeUndefined();
    expect(net.sent.map((s) => s.url).filter((u) => u.includes("nasdaq"))).toEqual([nq("SATS"), nq("SATS", "etf")]);
    // no book given: Robinhood's AAPL is not taken, Nasdaq's is
    expect(await q("AAPL")).toMatchObject({ from: NASDAQ_FROM, price: 344.9472 });
  });

  it("a Robinhood stamp older than two minutes is passed over for Nasdaq", async () => {
    const stale = new Date(NOW - FRESH_MS - 1_000).toISOString();
    const net = network(routes(RH_ALL([], stale)));
    const q = await watching(net, NOW);
    expect(await q("AAPL", { listed })).toMatchObject({ from: NASDAQ_FROM, price: 344.9472, at: fromEt(2026, 10, 14, 12, 33) });
    const fresh = network(routes(RH_ALL([], new Date(NOW - FRESH_MS + 5_000).toISOString())));
    expect((await (await watching(fresh, NOW))("AAPL", { listed }))!.from).toBe(ROBINHOOD_FROM);
  });

  it("Robinhood and Nasdaq both refusing (a 451, an edge's page, an HTTP/2 reset) is nothing — the caller says Cboe's delayed quote — never a refusal of the chain", async () => {
    const http: Http = async (url) => {
      if (url.includes("robinhood")) return { status: 451, body: undefined, text: "" };
      if (url.includes("/JPM/")) throw h2Reset();
      return AKAMAI_403;
    };
    const q = usQuote({ http, clock: () => NOW });
    expect(await q("AAPL", { listed })).toBeUndefined();
    expect(await q("JPM", { listed })).toBeUndefined();
    expect(await q.many(["AAPL", "JPM"], { listed })).toEqual(new Map());
  });

  it("many at once: one Robinhood answer, then Nasdaq for ONE batch — the first eight shares Robinhood did not price, all at once — and no more", async () => {
    let inFlight = 0;
    let most = 0;
    const asked: string[] = [];
    const rhAll = seenMoving(RH_ALL());
    const http: Http = async (url) => {
      asked.push(url);
      if (url === ROBINHOOD_PRICES) return rhAll();
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((go) => setTimeout(go, 5));
      inFlight--;
      return NQ_JPM;
    };
    const rest = Array.from({ length: 20 }, (_, i) => `X${String.fromCharCode(65 + i)}`);
    const got = await (await watching({ http, sent: asked }, NOW)).many(["AAPL", "NVDA", ...rest], { listed: () => true });
    expect(NASDAQ_AT_ONCE).toBe(8);
    expect(got.size).toBe(2 + NASDAQ_AT_ONCE);
    expect([got.get("AAPL")!.from, got.get("XA")!.from, got.has("XH"), got.has("XI")]).toEqual([ROBINHOOD_FROM, NASDAQ_FROM, true, false]);
    expect(asked.filter((u) => u === ROBINHOOD_PRICES)).toHaveLength(1);
    expect(asked.filter((u) => u.includes("api.nasdaq.com"))).toHaveLength(NASDAQ_AT_ONCE);
    expect(most).toBe(NASDAQ_AT_ONCE);
  });

  it("one deadline for all of it: what has not answered by RT_WAIT_MS is not waited for — its answer, when it comes, is kept for the next ask", async () => {
    expect(RT_WAIT_MS).toBe(1_500);
    // Nasdaq answers JPM at once and V a second late
    const rhAll = seenMoving(RH_ALL());
    const http: Http = async (url) => {
      if (url === ROBINHOOD_PRICES) return rhAll();
      if (url.includes("/V/")) await new Promise((go) => setTimeout(go, 300));
      return NQ_JPM;
    };
    const q = await watching({ http }, NOW);
    const t0 = Date.now();
    const got = await q.many(["AAPL", "JPM", "V"], { listed, waitMs: 100 });
    expect(Date.now() - t0).toBeLessThan(250);
    expect([...got.keys()].sort()).toEqual(["AAPL", "JPM"]);
    // the late answer is kept: the next ask has it at once
    await new Promise((go) => setTimeout(go, 300));
    const again = await q.many(["V"], { listed, waitMs: 100 });
    expect(again.get("V")).toMatchObject({ from: NASDAQ_FROM });
    // Robinhood hanging: nothing of it, and the chain still answers by the deadline
    const hang: Http = (url) => (url === ROBINHOOD_PRICES ? new Promise<HttpReply>(() => undefined) : Promise.resolve(NQ_JPM));
    const t1 = Date.now();
    expect(await usQuote({ http: hang, clock: () => NOW }).many(["AAPL"], { listed, waitMs: 100 })).toEqual(new Map());
    expect(Date.now() - t1).toBeLessThan(250);
  });

  it("by the session: Nasdaq in pre-market and after-hours; overnight Robinhood alone (ROBINHOOD_OVERNIGHT); closed, neither is asked", async () => {
    expect(ROBINHOOD_OVERNIGHT).toBe(true);
    // JPM's after-hours trade, as Nasdaq stamps one (6:22 PM ET, isRealTime true)
    const jpmAfter = json({ data: { ...(NQ_JPM.body as { data: Rec }).data, primaryData: { ...((NQ_JPM.body as { data: Rec }).data.primaryData as Rec), lastTradeTimestamp: "Oct 14, 2026 6:22 PM ET" }, marketStatus: "After-Hours" } });
    const at = (ms: number) => [["/rhj/prices", seenMoving(RH_ALL([], new Date(ms - 5_000).toISOString()))], [nq("AAPL"), NQ_AAPL], [nq("JPM"), jpmAfter]] as Array<[string, HttpReply | (() => HttpReply)]>;
    // after-hours, Wednesday 14 October 18:30: Robinhood's for AAPL, Nasdaq's for JPM
    const after = fromEt(2026, 10, 14, 18, 30);
    const a = network(at(after));
    const ga = await (await watching(a, after)).many(["AAPL", "JPM"], { listed });
    expect([ga.get("AAPL")?.from, ga.get("JPM")?.from, ga.get("JPM")?.at]).toEqual([ROBINHOOD_FROM, NASDAQ_FROM, fromEt(2026, 10, 14, 18, 22)]);
    // overnight, 22:00: Robinhood's for AAPL, and Nasdaq (which keeps no overnight session) is not asked
    const night = fromEt(2026, 10, 14, 22, 0);
    const n = network(at(night));
    const gn = await (await watching(n, night)).many(["AAPL", "JPM"], { listed });
    expect([gn.get("AAPL")?.from, gn.has("JPM")]).toEqual([ROBINHOOD_FROM, false]);
    expect(n.sent.map((s) => s.url)).toEqual([ROBINHOOD_PRICES]);
    // Saturday: nothing is asked
    const saturday = fromEt(2026, 10, 17, 12, 0);
    const s = network(at(saturday));
    const q = usQuote({ http: s.http, clock: () => saturday });
    q.warm();
    expect(await q.many(["AAPL", "JPM"], { listed })).toEqual(new Map());
    expect(s.sent).toHaveLength(0);
  });
});

describe("the network these sources are read through", () => {
  it("the fixed-host guard passes on a GET's method, headers and time limit only, and a body is kept to its first 2000 characters, whatever else a caller passes", async () => {
    const seen: unknown[] = [];
    const spy: Http = async (_url, init) => {
      seen.push(init);
      return json({ quotes: [] });
    };
    // options the Http type does not have
    const extra = { charset: "x", full: true } as unknown as Parameters<Http>[1];
    await fixedHosts(spy, PUBLIC_HOSTS, 2_500)(ROBINHOOD_PRICES, extra);
    expect(seen).toEqual([{ method: "GET", headers: { accept: "application/json" }, timeoutMs: 2_500 }]);
    vi.stubGlobal("fetch", async () => new Response("x".repeat(5_000), { status: 200 }));
    try {
      const r = await realHttp(ROBINHOOD_PRICES, extra);
      expect([r.status, r.text.length]).toEqual([200, 2_000]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
