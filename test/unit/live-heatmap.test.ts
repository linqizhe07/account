import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { fromEt } from "../../src/portfolio/account/calendar.ts";
import { companyName, HEATMAP_DEFAULT, HEATMAP_FROM, HEATMAP_MAX, HEATMAP_SIZED, heatNumber, isShare, NASDAQ_HOSTS, NASDAQ_SCREENER, NASDAQ_WATCHLIST, pickQuotes, pickUniverse, QUOTES_CLOSED_KEEP_MS, QUOTES_KEEP_MS, UNIVERSE_KEEP_MS, UsHeatmap, WATCHLIST_AT_ONCE, type Heatmap } from "../../src/portfolio/live/heatmap.ts";
import { fixedHosts, publicNo } from "../../src/portfolio/live/public-markets.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";
import { NASDAQ_UA } from "../../src/portfolio/live/us-quotes.ts";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { BINANCE_451_BODY, json, type Rec } from "./live-public-markets-fixtures.ts";

/** THE HEATMAP, KEYLESS (live/heatmap.ts): the largest US-listed companies by market cap, sized by Nasdaq's stock screener and coloured by
 * Nasdaq's watchlist quote, read over a stand-in network that answers the shapes both gave on Wed 2026-10-28 (the regular session): the
 * universe picked and cleaned (what is a share, what the screener appends to a name), the quotes read twenty a call and kept, the sectors
 * summed, Nasdaq's refusals in its own words and held, the route behind the server. Nothing leaves the process. */
/** Wednesday 28 October 2026, 13:05 New York (EDT): the regular session */
const NOW = fromEt(2026, 10, 28, 13, 5);
/** one screener row as the download gives it: the last close's price and change, the market cap as a plain string */
const row = (symbol: string, name: string, sector: string, industry: string, capB: number, extra: Rec = {}): Rec => ({ symbol, name, lastsale: "$217.94", netchange: "1.94", pctchange: "0.898%", volume: "35374432", marketCap: capB > 0 ? `${Math.round(capB * 1e9)}.00` : "0.00", country: "United States", ipoyear: "1999", industry, sector, url: `/market-activity/stocks/${symbol.toLowerCase()}`, ...extra });
const NAMED: Rec[] = [
  row("NVDA", "NVIDIA Corporation Common Stock", "Technology", "Semiconductors", 5252),
  row("AAPL", "Apple Inc. Common Stock", "Technology", "Computer Manufacturing", 5065),
  row("MSFT", "Microsoft Corporation Common Stock", "Technology", "Computer Software: Prepackaged Software", 3945),
  row("GOOGL", "Alphabet Inc. Class A Common Stock", "Technology", "Computer Software: Programming Data Processing", 3920),
  row("GOOG", "Alphabet Inc. Class C Capital Stock", "Technology", "Computer Software: Programming Data Processing", 3874),
  row("AMZN", "Amazon.com Inc. Common Stock", "Consumer Discretionary", "Catalog/Specialty Distribution", 2700),
  row("TSM", "Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares", "Technology", "Semiconductors", 2200, { country: "Taiwan" }),
  row("BRK/B", "Berkshire Hathaway Inc.", "Finance", "Property-Casualty Insurers", 1198),
  row("LLY", "Eli Lilly and Company Common Stock", "Health Care", "Biotechnology: Pharmaceutical Preparations", 1195),
  row("BRK/A", "Berkshire Hathaway Inc.", "Finance", "Property-Casualty Insurers", 1191),
  row("JPM", "JP Morgan Chase & Co. Common Stock", "Finance", "Major Banks", 930),
  row("XOM", "Exxon Mobil Corporation Common Stock", "Energy", "Integrated oil Companies", 500),
  row("UNH", "UnitedHealth Group Incorporated Common Stock (DE)", "Health Care", "Medical Specialities", 368),
  row("SHEL", "Shell PLC American Depositary Shares (each representing two (2) Ordinary Shares) ", "Energy", "Oil & Gas Production", 289, { country: "Netherlands" }),
  row("MPLX", "MPLX LP Common Units Representing Limited Partner Interests", "Energy", "Natural Gas Distribution", 59),
  // not one share of one company: each listed with its issuer's whole market cap, or none
  row("GOOGM", "Alphabet Inc. Depositary Shares representing a 1/20th Interest in a Share of Series A Preferred Stock", "Technology", "Computer Software: Programming Data Processing", 565),
  row("TBB", "AT&T Inc. 5.350% Global Notes due 2066", "Telecommunications", "Telecommunications Equipment", 126),
  row("STRF", "Strategy Inc 10.00% Series A Perpetual Strife Preferred Stock", "Technology", "Computer Software: Prepackaged Software", 42),
  row("SOMN", "Southern Company (The) 2025 Series A Corporate Units", "Utilities", "Electric Utilities: Central", 55),
  row("BTSGU", "BrightSpring Health Services Inc. Tangible Equity Unit", "Health Care", "Medical/Nursing Services", 38),
  row("AACIW", "Armada Acquisition Corp. III Warrant", "Finance", "Blank Checks", 0),
  row("AACPR", "Apogee Acquisition Corp Rights", "Finance", "Blank Checks", 0.1),
  row("AACI", "Armada Acquisition Corp. III Class A Ordinary Share", "Finance", "Blank Checks", 0.4),
  row("AACU", "Apogee Acquisition Corp Units, each consisting of one Class A Ordinary Share and one-half of one Right", "Finance", "Blank Checks", 0.3),
  row("NOSEC", "Nameless Holdings Common Stock", "", "", 12),
  row("ZERO", "Zero Cap Inc. Common Stock", "Industrials", "Aluminum", 0),
  row("A2RZ1", "Adjusted Interest Rate Russell 2000 Total Return Futures", "Finance", "Finance", 1),
];
/** sixty smaller shares (FAA, FAB, … FCH), so a map of more than twenty is asked in several calls */
const FILL_SYMS: string[] = Array.from({ length: 60 }, (_, i) => `F${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
const FILLER: Rec[] = FILL_SYMS.map((sym, i) => row(sym, `Filler ${i + 1} Inc. Common Stock`, i % 2 ? "Finance" : "Industrials", i % 2 ? "Major Banks" : "Industrial Machinery/Components", 50 - i * 0.5));
const SCREENER = (rows: Rec[] = [...NAMED, ...FILLER]) => json({ data: { asOf: null, headers: { symbol: "Symbol" }, rows }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** the real-time quotes the watchlist answers: [last sale, change, change %, previous close] — XOM is left out, as a share Nasdaq did not
 * price just now */
const QUOTES: Record<string, [number, number, number, number]> = {
  NVDA: [217.615, -0.325, -0.15, 217.94],
  AAPL: [345.55, -1.55, -0.45, 347.1],
  MSFT: [531.33, -1.27, -0.24, 532.6],
  GOOGL: [324.4, 3.82, 1.19, 320.58],
  GOOG: [319.5, 2.67, 0.84, 316.83],
  AMZN: [257.2, 4.1, 1.62, 253.1],
  TSM: [449.7, 12.83, 2.94, 436.87],
  "BRK.B": [537.5, -5.49, -1.01, 542.99],
  LLY: [1284.7, 2.79, 0.22, 1281.91],
  "BRK.A": [798_500, -11_606, -1.43, 810_106],
  JPM: [340.21, 4.42, 1.32, 335.79],
  UNH: [371.9, 3.5, 0.95, 368.4],
  SHEL: [74.1, -0.3, -0.4, 74.4],
  MPLX: [52.3, 0.26, 0.5, 52.04],
};
const STAMP = "2026-10-28T13:03:53.3617664-04:00";
const quoteRow = (symbol: string, q: [number, number, number, number]): Rec => ({ symbol, companyName: `${symbol} Common Stock`, lastSalePrice: `$${q[0]}`, netChange: `${q[1] > 0 ? "+" : ""}${q[1]}`, percentageChange: `${q[2] > 0 ? "+" : ""}${q[2].toFixed(2)}%`, deltaIndicator: q[1] < 0 ? "down" : "up", lastTradeTimestamp: "Oct 28, 2026 1:03 PM ET", lastTradeTimestampDateTime: STAMP, volume: "35,393,642", assetClass: "STOCKS", previousClosePrice: q[3], openingPrice: q[3] + 1, marketStatus: "Market Open" });
/** the symbols a watchlist URL asks, as the account writes them */
const askedIn = (url: string): string[] => [...new URL(url).searchParams.getAll("symbol")].map((s) => s.replace(/\|stocks$/, "").toUpperCase().replace("/", "."));
/** the watchlist's answer to a URL: the known quotes, a filler share priced flat at $10 up a percent */
const watchlist = (url: string): HttpReply => json({ data: askedIn(url).flatMap((s) => (QUOTES[s] ? [quoteRow(s, QUOTES[s])] : FILL_SYMS.includes(s) ? [quoteRow(s, [10.1, 0.1, 1, 10])] : [])), message: null, status: { rCode: 200 } });

/** a stand-in Nasdaq: GETs answered by URL, each kept with its headers; `screener` and `quotes` may be changed between reads */
function nasdaq(opts: { screener?: HttpReply | (() => HttpReply); quotes?: (url: string) => HttpReply } = {}) {
  const sent: Array<{ url: string; headers: Record<string, string> }> = [];
  const state = { screener: opts.screener ?? SCREENER(), quotes: opts.quotes ?? watchlist };
  const http: Http = async (url, init = {}) => {
    sent.push({ url, headers: init.headers ?? {} });
    if (url.startsWith(NASDAQ_SCREENER)) return typeof state.screener === "function" ? state.screener() : state.screener;
    if (url.startsWith(NASDAQ_WATCHLIST)) return state.quotes(url);
    return json({ error: "not found" }, 404);
  };
  const calls = (of: string) => sent.filter((s) => s.url.startsWith(of));
  return { http, sent, state, calls };
}
/** a reader over the stand-in, behind the same fixed-host guard the service puts it behind, its clock the test's, no line to wait in */
function reader(net: { http: Http }, clock: () => number) {
  const paced: string[] = [];
  const r = new UsHeatmap({ http: fixedHosts(net.http, NASDAQ_HOSTS, 8_000), clock, pace: async (host) => void paced.push(host) });
  return { r, paced };
}
const ok = (x: Heatmap | Refusal): Heatmap => {
  if (isRefusal(x)) throw new Error(`${x.code}: ${x.message}`);
  return x;
};
const refusal = (x: Heatmap | Refusal): Refusal => {
  if (!isRefusal(x)) throw new Error(`expected a refusal, got a map of ${x.count}`);
  return x;
};

describe("the universe picked from Nasdaq's screener (pickUniverse)", () => {
  const rows = pickUniverse(SCREENER().body);
  const u = isRefusal(rows) ? [] : rows;

  it("keeps one share of one company — an ADR, a dual class, an MLP's common units — the largest first, and leaves out what is not one", () => {
    expect(u.slice(0, 15).map((r) => r.symbol)).toEqual(["NVDA", "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "TSM", "BRK.B", "LLY", "BRK.A", "JPM", "XOM", "UNH", "SHEL", "MPLX"]);
    expect(u.length).toBe(15 + 60);
    for (const gone of ["GOOGM", "TBB", "STRF", "SOMN", "BTSGU", "AACIW", "AACPR", "AACI", "AACU", "NOSEC", "ZERO", "A2RZ1"]) expect(u.some((r) => r.symbol === gone), gone).toBe(false);
  });

  it("writes a class share with a dot and asks the watchlist for it as the screener writes it, with the company's name alone, its sector, industry and country", () => {
    const brk = u.find((r) => r.symbol === "BRK.B")!;
    expect(brk).toEqual({ symbol: "BRK.B", name: "Berkshire Hathaway Inc.", sector: "Finance", industry: "Property-Casualty Insurers", country: "United States", marketCap: 1198e9, asked: "BRK/B" });
    expect(u.find((r) => r.symbol === "TSM")).toMatchObject({ name: "Taiwan Semiconductor Manufacturing Company Ltd.", country: "Taiwan", sector: "Technology" });
    expect(u.map((r) => [r.symbol, r.name]).slice(0, 6)).toEqual([["NVDA", "NVIDIA Corporation"], ["AAPL", "Apple Inc."], ["MSFT", "Microsoft Corporation"], ["GOOGL", "Alphabet Inc."], ["GOOG", "Alphabet Inc."], ["AMZN", "Amazon.com Inc."]]);
    expect([u.find((r) => r.symbol === "UNH")!.name, u.find((r) => r.symbol === "SHEL")!.name, u.find((r) => r.symbol === "MPLX")!.name]).toEqual(["UnitedHealth Group Incorporated", "Shell PLC", "MPLX LP"]);
  });

  it("names what is a share and what is not, and reads Nasdaq's figures", () => {
    const share = (name: string, industry = "Semiconductors", marketCap = 1e9, symbol = "ABC") => isShare({ symbol, name, industry, sector: "Technology", marketCap });
    expect(share("NVIDIA Corporation Common Stock")).toBe(true);
    expect(share("Arm Holdings plc American Depositary Shares")).toBe(true);
    expect(share("MPLX LP Common Units Representing Limited Partner Interests")).toBe(true);
    expect(share("Alphabet Inc. Depositary Shares representing a 1/20th Interest in a Share of Series A Preferred Stock")).toBe(false);
    expect(share("Bruker Corporation 6.375% Mandatory Convertible Preferred Stock Series A")).toBe(false);
    expect(share("AT&T Inc. 5.350% Global Notes due 2066")).toBe(false);
    expect(share("Armada Acquisition Corp. III Warrant")).toBe(false);
    expect(share("Apogee Acquisition Corp Rights")).toBe(false);
    expect(share("Apogee Acquisition Corp Units, each consisting of one Class A Ordinary Share and one-half of one Right")).toBe(false);
    expect(share("PPL Corporation Corporate Units")).toBe(false);
    expect(share("Some Acquisition Corp Class A Ordinary Shares", "Blank Checks")).toBe(false);
    expect(share("Zero Cap Inc. Common Stock", "Aluminum", 0)).toBe(false);
    expect(share("Adjusted Interest Rate Russell 2000 Total Return Futures", "Finance", 1e9, "A2RZ1")).toBe(false);
    expect([companyName("Apple Inc. Common Stock"), companyName("Alphabet Inc. Class C Capital Stock"), companyName("Sony Group Corporation American Depositary Shares  "), companyName("Nokia Corporation Sponsored American Depositary Shares"), companyName("Agilent Technologies Inc. Common Stock")]).toEqual(["Apple Inc.", "Alphabet Inc.", "Sony Group Corporation", "Nokia Corporation", "Agilent Technologies Inc."]);
    expect([heatNumber("$217.585"), heatNumber("+0.73%"), heatNumber("-0.355"), heatNumber("35,393,642"), heatNumber(217.94), heatNumber("N/A"), heatNumber(""), heatNumber(undefined)]).toEqual([217.585, 0.73, -0.355, 35_393_642, 217.94, undefined, undefined, undefined]);
    expect(isRefusal(pickUniverse({ data: { rows: "no" } }))).toBe(true);
    expect(isRefusal(pickUniverse("<html>"))).toBe(true);
  });

  it("reads the watchlist's quotes by symbol, the trade's own time to the millisecond, and no quote for a row without a price", () => {
    const q = pickQuotes({ data: [quoteRow("NVDA", QUOTES.NVDA!), { symbol: "brk/b", lastSalePrice: "$537.50", netChange: "-5.49", percentageChange: "-1.01%", lastTradeTimestamp: "Oct 28, 2026 1:03 PM ET" }, { symbol: "ZZZZ", lastSalePrice: "N/A", netChange: "N/A" }, { symbol: "", lastSalePrice: "$1" }] });
    expect([...q.keys()]).toEqual(["NVDA", "BRK.B"]);
    expect(q.get("NVDA")).toEqual({ price: 217.615, change: -0.325, changePct: -0.15, prevClose: 217.94, volume: 35_393_642, at: Date.parse("2026-10-28T17:03:53.361Z"), marketStatus: "Market Open" });
    // the minute stamp alone, read as New York's
    expect(q.get("BRK.B")).toEqual({ price: 537.5, change: -5.49, changePct: -1.01, at: fromEt(2026, 10, 28, 13, 3) });
  });
});

describe("the map read (UsHeatmap)", () => {
  it("sizes the n largest by the screener, colours them by the watchlist's real-time change, sums the sectors, and says whose figures these are", async () => {
    const net = nasdaq();
    const { r, paced } = reader(net, () => NOW);
    const m = ok(await r.read({ n: 12 }));
    expect([m.n, m.count, m.readAt]).toEqual([12, 12, new Date(NOW).toISOString()]);
    expect(m.tiles.map((t) => t.symbol)).toEqual(["NVDA", "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "TSM", "BRK.B", "LLY", "BRK.A", "JPM", "XOM"]);
    expect(m.tiles[0]).toEqual({ symbol: "NVDA", name: "NVIDIA Corporation", sector: "Technology", industry: "Semiconductors", country: "United States", marketCap: 5252e9, price: 217.615, change: -0.325, changePct: -0.15, prevClose: 217.94, quoteAt: "2026-10-28T17:03:53.361Z", quoteFrom: HEATMAP_FROM, volume: 35_393_642 });
    // a share Nasdaq did not price carries no quote and no change: grey on the map, and said so
    expect(m.tiles[11]).toEqual({ symbol: "XOM", name: "Exxon Mobil Corporation", sector: "Energy", industry: "Integrated oil Companies", country: "United States", marketCap: 500e9 });
    expect(m.quotes).toEqual({ from: HEATMAP_FROM, keptMs: QUOTES_KEEP_MS, priced: 11, at: "2026-10-28T17:03:53.361Z", oldest: "2026-10-28T17:03:53.361Z", marketStatus: "Market Open" });
    expect(m.universe).toEqual({ from: HEATMAP_SIZED, readAt: new Date(NOW).toISOString(), listed: 75 });
    expect([m.session.open, m.session.phase]).toEqual([true, "regular"]);
    // the sectors, the largest first, each the market-cap-weighted mean of its priced tiles' changes
    expect(m.sectors.map((s) => s.name)).toEqual(["Technology", "Finance", "Consumer Discretionary", "Health Care", "Energy"]);
    const tech = m.tiles.filter((t) => t.sector === "Technology");
    const weighted = Number((tech.reduce((s, t) => s + t.marketCap * t.changePct!, 0) / tech.reduce((s, t) => s + t.marketCap, 0)).toFixed(2));
    expect(m.sectors[0]).toEqual({ name: "Technology", count: 6, marketCap: tech.reduce((s, t) => s + t.marketCap, 0), priced: 6, changePct: weighted });
    expect(m.sectors[4]).toEqual({ name: "Energy", count: 1, marketCap: 500e9, priced: 0 });
    expect(m.missing).toBeUndefined();
    expect(m.notes[0]).toMatch(/^Sized by market cap at the last close, from Nasdaq's stock screener \(75 shares/);
    expect(m.notes.length).toBe(1);
    // one GET of the screener and one of the watchlist, each waiting its turn in the Nasdaq line, each sent as a browser sends it
    expect(net.sent.map((s) => s.url.split("?")[0])).toEqual([NASDAQ_SCREENER.split("?")[0], NASDAQ_WATCHLIST]);
    expect(paced).toEqual(["nasdaq", "nasdaq"]);
    for (const s of net.sent) expect(s.headers["user-agent"]).toBe(NASDAQ_UA);
    expect(askedIn(net.sent[1]!.url)).toEqual(m.tiles.map((t) => t.symbol));
    expect(net.sent[1]!.url).toContain("symbol=brk%2Fb%7Cstocks");
  });

  it("asks the watchlist twenty shares a call, keeps each quote 45 s in a session and the screener six hours, and reads a sector among the n by industry", async () => {
    const net = nasdaq();
    let t = NOW;
    const { r } = reader(net, () => t);
    const m = ok(await r.read({ n: 45 }));
    expect(m.count).toBe(45);
    expect(net.calls(NASDAQ_WATCHLIST).map((c) => askedIn(c.url).length)).toEqual([WATCHLIST_AT_ONCE, WATCHLIST_AT_ONCE, 5]);
    // kept: nothing is asked again within the keep
    t = NOW + QUOTES_KEEP_MS - 1_000;
    ok(await r.read({ n: 45 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(3);
    expect(net.calls(NASDAQ_SCREENER).length).toBe(1);
    // fewer asked: nothing more is read; more asked: only the shares not kept
    ok(await r.read({ n: 10 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(3);
    ok(await r.read({ n: 50 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(4);
    expect(askedIn(net.calls(NASDAQ_WATCHLIST)[3]!.url)).toEqual(FILL_SYMS.slice(30, 35));
    // the keep past: every share asked again, in three calls; the screener still not
    t = NOW + QUOTES_KEEP_MS + 1;
    ok(await r.read({ n: 45 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(7);
    expect(net.calls(NASDAQ_SCREENER).length).toBe(1);
    t = NOW + UNIVERSE_KEEP_MS + 1;
    ok(await r.read({ n: 45 }));
    expect(net.calls(NASDAQ_SCREENER).length).toBe(2);
    // one sector among the n: its tiles only, summed by industry; a sector none of the n is in is an empty map that says the sector
    const fin = ok(await r.read({ n: 45, sector: "finance" }));
    expect(fin.sector).toBe("Finance");
    expect(fin.tiles.map((x) => x.symbol).slice(0, 3)).toEqual(["BRK.B", "BRK.A", "JPM"]);
    expect(fin.tiles.every((x) => x.sector === "Finance")).toBe(true);
    expect(fin.count).toBe(fin.tiles.length);
    expect(fin.sectors.map((s) => s.name)).toEqual(["Property-Casualty Insurers", "Major Banks"]);
    expect(fin.sectors[0]).toMatchObject({ name: "Property-Casualty Insurers", count: 2, priced: 2 });
    const none = ok(await r.read({ n: 45, sector: "Utilities" }));
    expect([none.count, none.tiles, none.sectors, none.sector]).toEqual([0, [], [], "Utilities"]);
    // the count is held to the most, and the default is the default
    expect(ok(await r.read({ n: 10_000 })).n).toBe(HEATMAP_MAX);
    expect(ok(await r.read()).n).toBe(HEATMAP_DEFAULT);
  });

  it("keeps a quote ten minutes while the market is closed, and says the colours are the last session's", async () => {
    const net = nasdaq();
    // Saturday 31 October 2026, 11:00 New York
    let t = fromEt(2026, 10, 31, 11, 0);
    const { r } = reader(net, () => t);
    const m = ok(await r.read({ n: 5 }));
    expect([m.session.open, m.session.phase, m.quotes.keptMs]).toEqual([false, "closed", QUOTES_CLOSED_KEEP_MS]);
    expect(m.notes[1]).toBe("The market is closed: the colours are the last session's.");
    t += QUOTES_KEEP_MS * 3;
    ok(await r.read({ n: 5 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(1);
    t += QUOTES_CLOSED_KEEP_MS;
    ok(await r.read({ n: 5 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(2);
    // pre-market: the extended session's trade against the last regular close, said so
    t = fromEt(2026, 10, 29, 8, 0);
    const pre = ok(await r.read({ n: 5 }));
    expect([pre.session.phase, pre.notes[1]]).toEqual(["pre", "The pre-market session is on: a change is the extended session's last trade against the last regular close."]);
  });

  it("says a refusal of the watchlist in Nasdaq's own words, holds it as the source said, and keeps the quotes it has with their own stamps", async () => {
    const net = nasdaq();
    let t = NOW;
    // a refusal's own wait is stamped by the process's clock (public-markets.ts): that clock is the test's here
    const clock = vi.spyOn(Date, "now").mockImplementation(() => t);
    const { r } = reader(net, () => t);
    ok(await r.read({ n: 25 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(2);
    // the next read, a minute on: the first call rate-limited, the second answered
    t = NOW + 60_000;
    let n = 0;
    // a 429 that names no wait: held the minute the refusal's own sentence says
    const limited: HttpReply = { status: 429, body: undefined, text: "Too Many Requests" };
    net.state.quotes = (url) => (n++ === 0 ? limited : watchlist(url));
    const m = ok(await r.read({ n: 25 }));
    const said = publicNo("nasdaq", "Nasdaq", limited);
    expect(m.missing).toMatchObject({ venue: "nasdaq", venueName: "Nasdaq", code: said.code, said: "Too Many Requests", connected: false });
    expect(m.missing?.why).toContain("Nasdaq");
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(4);
    // the refused batch's shares keep the quotes of the first read, stamped as they were; the answered batch's are fresh
    expect(m.tiles[0]!.quoteAt).toBe("2026-10-28T17:03:53.361Z");
    expect(m.quotes.priced).toBe(24);
    // held: within the wait Nasdaq asked for, nothing is asked, and the map says so still
    t = NOW + 80_000;
    const held = ok(await r.read({ n: 25 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(4);
    expect(held.missing?.code).toBe(said.code);
    // the minute past: every share stale by then (the refused batch's since the first read, the other's since its own), asked again in two
    // calls and answered; nothing missing. XOM is still a share Nasdaq does not price
    t = NOW + 60_000 + 60_000 + 1;
    const again = ok(await r.read({ n: 25 }));
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(6);
    expect(askedIn(net.calls(NASDAQ_WATCHLIST)[4]!.url)).toHaveLength(20);
    expect(again.missing).toBeUndefined();
    expect(again.quotes.priced).toBe(24);
    clock.mockRestore();
  });

  it("answers the screener's refusal as the map's own where nothing was read before — a place rule in Nasdaq's words, held ten minutes — and the last universe where one was", async () => {
    const net = nasdaq({ screener: { status: 451, body: undefined, text: BINANCE_451_BODY } });
    let t = NOW;
    const { r } = reader(net, () => t);
    const no = refusal(await r.read({ n: 5 }));
    expect(no.code).toBe("E_VENUE_GEOBLOCKED");
    expect(no.message).toBe("Nasdaq does not serve this location: that is its own rule, and the account does not look for a way around it");
    t = NOW + 60_000;
    refusal(await r.read({ n: 5 }));
    expect(net.calls(NASDAQ_SCREENER).length).toBe(1);
    expect(net.calls(NASDAQ_WATCHLIST).length).toBe(0);
    // the hold past, the screener answers: a map
    t = NOW + 600_001;
    net.state.screener = SCREENER();
    expect(ok(await r.read({ n: 5 })).count).toBe(5);
    // six hours on the screener refuses again: the universe read before serves, and the refusal is said as what is not shown
    t = NOW + 600_001 + UNIVERSE_KEEP_MS + 1;
    net.state.screener = { status: 503, body: undefined, text: "Service Unavailable" };
    const old = ok(await r.read({ n: 5 }));
    expect(old.count).toBe(5);
    expect(old.missing).toMatchObject({ venueName: "Nasdaq", code: "E_VENUE_UNREACHABLE" });
    // a network that throws is no answer either
    net.state.screener = () => {
      throw new Error("socket hang up");
    };
    t += 3 * 60_000;
    expect(ok(await r.read({ n: 5 })).missing).toMatchObject({ code: "E_VENUE_UNREACHABLE" });
  });
});

describe("the route (GET /api/account/heatmap)", () => {
  const home = mkdtempSync(join(tmpdir(), "heatmap-route-"));
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("answers the map behind the server's guard, refuses a count that is not one, and keeps one sector", async () => {
    const net = nasdaq();
    const svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: net.http, price: async () => undefined }, publicMarkets: [] });
    const srv = await startPortfolioServer({ port: 0, service: svc });
    const get = async (path: string, headers: Record<string, string> = {}) => {
      const r = await fetch(`${srv.url}${path}`, { headers });
      return { status: r.status, body: (await r.json()) as Rec };
    };
    try {
      const a = await get("/api/account/heatmap?n=3");
      expect(a.status).toBe(200);
      expect((a.body.tiles as Rec[]).map((x) => x.symbol)).toEqual(["NVDA", "AAPL", "MSFT"]);
      expect(a.body.quotes).toMatchObject({ from: HEATMAP_FROM, priced: 3 });
      const d = await get("/api/account/heatmap");
      expect((d.body as { n: number }).n).toBe(HEATMAP_DEFAULT);
      const s = await get("/api/account/heatmap?n=12&sector=Finance");
      expect((s.body.tiles as Rec[]).map((x) => x.symbol)).toEqual(["BRK.B", "BRK.A", "JPM"]);
      expect(s.body.sector).toBe("Finance");
      expect((await get("/api/account/heatmap?n=abc")).status).toBe(400);
      expect((await get("/api/account/heatmap?n=0")).status).toBe(409);
      expect((await get("/api/account/heatmap?n=501")).status).toBe(409);
      expect((await get("/api/account/heatmap?n=3", { origin: "https://evil.example" })).status).toBe(403);
      // the same question within fifteen seconds is answered from what was found: three shares, then the 72 not yet kept in four calls, then
      // nothing (the sector's twelve are kept, XOM — unpriced — among them, asked again only with the next stale batch)
      await get("/api/account/heatmap?n=3");
      expect(net.calls(NASDAQ_WATCHLIST).map((c) => askedIn(c.url).length), "the watchlist calls").toEqual([3, 20, 20, 20, 12]);
    } finally {
      await srv.close();
    }
  });
});
