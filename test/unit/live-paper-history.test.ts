import { describe, expect, it } from "vitest";
import { rebuildEquity, REBUILD_MAX_POINTS, replayPaperBook, type PriceSeries } from "../../src/portfolio/live/paper-history.ts";
import type { PaperBook, PaperFill, PaperMarketRef, PaperOrder } from "../../src/portfolio/live/paper.ts";
import type { Candle } from "../../src/portfolio/live/trade.ts";

/** A PAPER ACCOUNT'S PAST, told again from its own book (live/paper-history.ts): the book's orders replayed from its starting money, what
 * it held valued at the public sources' bars between the fills. The first book is the user's real paper-1 as it stands (its three market
 * buys at Kraken, 2026-10-13/14); the rest are made up to walk each rule — a sell and a re-buy, an event settled, a perpetual opened, reduced
 * and liquidated, a symbol with no bars, ranges that start before the book, the live value as the last point, and
 * 5m, 1h and 1d bars mixed. Nothing here reads a file or the network: the bars are stand-ins. */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ms = (s: string): number => Date.parse(s);
const iso = (n: number): string => new Date(n).toISOString();
const round6 = (x: number): number => Number(x.toFixed(6));

const market = (kind: PaperMarketRef["kind"], base: string, quote = "USD", extra: Partial<PaperMarketRef> = {}): PaperMarketRef => ({ source: kind === "perp" ? "hyperliquid" : "kraken", kind, base, quote, name: `${base}/${quote}`, ...extra });
/** a filled order as fill() leaves it: the fee is the book's 0.10% of the notional, to the sixth place, unless said */
const order = (ref: string, symbol: string, side: "buy" | "sell", qty: number, price: number, at: string | number, extra: Partial<PaperOrder> = {}): PaperOrder => {
  const when = typeof at === "number" ? iso(at) : at;
  return { ref, clientId: `client-${ref}`, symbol, side, type: "market", qty, status: "filled", filledQty: qty, avgPrice: price, feeUsd: round6(qty * price * 0.001), at: when, updatedAt: when, ...extra };
};
const bookOf = (o: Partial<PaperBook> & Pick<PaperBook, "createdAt" | "orders" | "markets">): PaperBook => ({
  version: 1,
  id: "paper-test",
  name: "Paper account · paper",
  updatedAt: o.createdAt,
  startCashUsd: 10_000,
  feeBps: 10,
  cashUsd: 10_000,
  holdings: {},
  positions: {},
  fills: [],
  leverage: {},
  seq: Object.keys(o.orders).length,
  ...o,
});
/** bars of one interval from `from`, one close each (open = high = low = close) */
const bars = (from: number, every: number, closes: number[]): Candle[] => closes.map((c, i) => ({ t: from + i * every, o: c, h: c, l: c, c }));
const flat = (from: number, to: number, every: number, close: number): Candle[] => bars(from, every, Array.from({ length: Math.floor((to - from) / every) + 1 }, () => close));
const valueAt = (r: { points: Array<{ at: number; usd: number; partial?: true }> }, at: number) => r.points.find((p) => p.at === at);

// ── the user's real book: paper-1, ~/.buyer-agent-demo/paper/paper-1/book.json as read on 2026-10-14: its times,
// prices, fees, cash and holdings to the digit; its order client ids and its three fills left out (a dollar market's replay reads neither) ──
const CREATED = "2026-10-13T15:58:58.808Z";
const realBook = (): PaperBook =>
  bookOf({
    id: "paper-1",
    createdAt: CREATED,
    updatedAt: "2026-10-14T15:29:37.936Z",
    startCashUsd: 10_000,
    feeBps: 10,
    cashUsd: 7281.699231,
    holdings: { "BTC/USD": { qty: 0.030172, costUsd: 2472.958566 }, "ETH/USD": { qty: 0.098031, costUsd: 245.342203 } },
    orders: {
      p1: order("p1", "BTC/USD", "buy", 0.000235, 83339.6, "2026-10-13T16:34:43.479Z"),
      p2: order("p2", "ETH/USD", "buy", 0.098031, 2500.2, "2026-10-13T18:04:59.263Z"),
      p3: order("p3", "BTC/USD", "buy", 0.029937, 81868.7, "2026-10-14T15:29:37.935Z"),
    },
    markets: { "BTC/USD": market("spot", "BTC"), "ETH/USD": market("spot", "ETH") },
    seq: 3,
  });
/** 5m bars at Kraken's shape, flat so the arithmetic can be done by hand: BTC at 82,000 and ETH at 2,450, the last closing 15:35 */
const realBars = (): PriceSeries[] => [
  { symbol: "BTC/USD", interval: "5m", candles: flat(ms("2026-10-13T15:55:00Z"), ms("2026-10-14T15:30:00Z"), 5 * MIN, 82_000) },
  { symbol: "ETH/USD", interval: "5m", candles: flat(ms("2026-10-13T15:55:00Z"), ms("2026-10-14T15:30:00Z"), 5 * MIN, 2_450) },
];

describe("a paper account's past, told again from its own book", () => {
  it("replays the user's real book to the cent of its own cash: three buys from $10,000 leave $7,281.699231", () => {
    const r = replayPaperBook(realBook());
    expect(Math.abs(r.cashUsd - 7281.699231)).toBeLessThanOrEqual(1e-6);
    expect(r.held["BTC/USD"]).toBeCloseTo(0.030172, 12);
    expect(r.held["ETH/USD"]).toBeCloseTo(0.098031, 12);
    expect(r.positions).toEqual({});
    // up to a moment: only what had filled by then
    const before = replayPaperBook(realBook(), ms("2026-10-13T17:00:00Z"));
    expect(Math.abs(before.cashUsd - (10_000 - 0.000235 * 83339.6 - round6(0.000235 * 83339.6 * 0.001)))).toBeLessThanOrEqual(1e-6);
    expect(Object.keys(before.held)).toEqual(["BTC/USD"]);
  });

  it("draws the real book's last day every 5 minutes from its start, valued at the bars, with nothing it cannot know", () => {
    const r = rebuildEquity(realBook(), realBars(), { fromMs: ms("2026-10-13T15:35:00Z"), toMs: ms("2026-10-14T15:35:00Z"), stepMs: 5 * MIN });
    expect(r.createdAt).toBe(ms(CREATED));
    expect(r.startUsd).toBe(10_000);
    // the start, then 16:00 … 15:35 the next day
    expect(r.points).toHaveLength(1 + 284);
    expect(r.points[0]).toEqual({ at: ms(CREATED), usd: 10_000 });
    expect(r.points[1]).toEqual({ at: ms("2026-10-13T16:00:00Z"), usd: 10_000 });
    expect(valueAt(r, ms("2026-10-13T16:30:00Z"))?.usd).toBe(10_000);
    // after p1: 9,980.395609 of cash and 0.000235 BTC at 82,000
    expect(valueAt(r, ms("2026-10-13T16:35:00Z"))?.usd).toBe(9999.67);
    // after p2: and 0.098031 ETH at 2,450
    expect(valueAt(r, ms("2026-10-13T18:05:00Z"))?.usd).toBe(9994.5);
    expect(valueAt(r, ms("2026-10-14T15:25:00Z"))?.usd).toBe(9994.5);
    // after p3 (15:29:37): 7,281.699231 + 0.030172 × 82,000 + 0.098031 × 2,450
    expect(valueAt(r, ms("2026-10-14T15:30:00Z"))?.usd).toBe(9995.98);
    expect(r.points.at(-1)).toEqual({ at: ms("2026-10-14T15:35:00Z"), usd: 9995.98 });
    expect(r.points.every((p) => !p.partial)).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.inexact).toEqual([]);
  });

  it("replays a sell and a re-buy in the order they filled, whatever order the book lists them in, and leaves out what never filled", () => {
    const C = ms("2026-10-01T00:00:00Z");
    const book = bookOf({
      createdAt: iso(C),
      cashUsd: 9144.95,
      holdings: { "ETH/USD": { qty: 0.5, costUsd: 950.95 } },
      orders: {
        p3: order("p3", "ETH/USD", "buy", 0.5, 1900, C + 5 * HOUR),
        p4: { ...order("p4", "ETH/USD", "buy", 1, 1500, C + 4 * HOUR, { type: "limit", limitPrice: 1500 }), status: "canceled", filledQty: 0, avgPrice: undefined, feeUsd: undefined },
        p1: order("p1", "ETH/USD", "buy", 1, 2000, C + HOUR),
        p2: order("p2", "ETH/USD", "sell", 1, 2100, C + 3 * HOUR),
      },
      markets: { "ETH/USD": market("spot", "ETH") },
    });
    const series: PriceSeries[] = [{ symbol: "ETH/USD", interval: "1h", candles: bars(C, HOUR, [2000, 2040, 2050, 2100, 1900, 1950, 1960, 1970]) }];
    const r = rebuildEquity(book, series, { fromMs: C, toMs: C + 8 * HOUR, stepMs: HOUR });
    expect(r.points.map((p) => p.usd)).toEqual([10_000, 9998, 10_038, 10_095.9, 10_095.9, 10_094.95, 10_119.95, 10_124.95, 10_129.95]);
    expect(r.points.map((p) => p.at)).toEqual(Array.from({ length: 9 }, (_, i) => C + i * HOUR));
    const end = replayPaperBook(book);
    expect(end.cashUsd).toBeCloseTo(9144.95, 6);
    expect(end.held).toEqual({ "ETH/USD": 0.5 });
    expect(r.inexact).toEqual([]);
  });

  it("pays out an event contract at its settlement, and holds its last bar's price while its venue sends no more bars", () => {
    const C = ms("2026-10-02T00:00:00Z");
    const sym = "KXFEDDECISION-26DEC-H0:Yes";
    const book = bookOf({
      createdAt: iso(C),
      startCashUsd: 1000,
      cashUsd: 1059.96,
      orders: {
        p1: order("p1", sym, "buy", 100, 0.4, C + 30 * MIN),
        p2: order("p2", sym, "sell", 100, 1, C + 3.5 * HOUR, { clientId: "settlement-2", feeUsd: 0, note: "settled by Kalshi: $1.00 a contract to this side, which won, $100.00 for 100" }),
      },
      markets: { [sym]: market("event", sym, "USD", { source: "kalshi", settled: { payout: 1, at: iso(C + 3.4 * HOUR) } }) },
    });
    // the venue's bars end with the one that closed at 2h; the contract is still held at 3h, at that bar's price, and not partial
    const r = rebuildEquity(book, [{ symbol: sym, interval: "1h", candles: bars(C, HOUR, [0.4, 0.55]) }], { fromMs: C, toMs: C + 5 * HOUR, stepMs: HOUR });
    expect(r.points.map((p) => p.usd)).toEqual([1000, 999.96, 1014.96, 1014.96, 1059.96, 1059.96]);
    expect(valueAt(r, C + 3 * HOUR)).toEqual({ at: C + 3 * HOUR, usd: 1014.96 }); // 959.96 + 100 × 0.55
    expect(r.missing).toEqual([]);
    expect(replayPaperBook(book)).toEqual({ cashUsd: 1059.96, held: {}, positions: {} });
    expect(r.inexact).toEqual([]);
  });

  it("values an event contract at what its venue paid from the venue's own settlement time, before the account wrote the payout", () => {
    const C = ms("2026-10-02T00:00:00Z");
    const sym = "KXFEDDECISION-26DEC-H0:Yes";
    // Kalshi settled it at 03:00 (its settlement_ts); the account looked again, and paid it out, only at 30:00
    const book = bookOf({
      createdAt: iso(C),
      startCashUsd: 1000,
      cashUsd: 1059.94,
      orders: {
        p1: order("p1", sym, "buy", 100, 0.4, C + 30 * MIN, { feeUsd: 0.06 }),
        p2: order("p2", sym, "sell", 100, 1, C + 30 * HOUR, { clientId: "settlement-2", feeUsd: 0 }),
      },
      markets: { [sym]: market("event", sym, "USD", { source: "kalshi", settled: { payout: 1, at: iso(C + 3 * HOUR) } }) },
    });
    const r = rebuildEquity(book, [{ symbol: sym, interval: "1h", candles: bars(C, HOUR, [0.4, 0.6]) }], { fromMs: C, toMs: C + 31 * HOUR, stepMs: 3 * HOUR });
    // 0h: the start; 3h: settled at that very moment, 100 × $1; 6h … 30h: the same, at $1 a contract and then as cash
    expect(valueAt(r, C + 3 * HOUR)?.usd).toBe(1059.94);
    for (let h = 6; h <= 30; h += 3) expect(valueAt(r, C + h * HOUR)).toEqual({ at: C + h * HOUR, usd: 1059.94 });
    expect(r.inexact).toEqual([]);
    // before the venue settled it: its last bar (0.6, the bar that closed at 2h)
    const before = rebuildEquity(book, [{ symbol: sym, interval: "1h", candles: bars(C, HOUR, [0.4, 0.6]) }], { fromMs: C, toMs: C + 2 * HOUR, stepMs: HOUR });
    expect(before.points.map((p) => p.usd)).toEqual([1000, 999.94, 1019.94]);
  });

  describe("a perpetual: opened, partly reduced, liquidated", () => {
    const C = ms("2026-10-03T00:00:00Z");
    const perpBook = (extra: Partial<PaperBook> = {}): PaperBook =>
      bookOf({
        createdAt: iso(C),
        startCashUsd: 1000,
        cashUsd: 979.82,
        orders: {
          p1: order("p1", "BTC-PERP", "buy", 1, 100, C + 10 * MIN),
          p2: order("p2", "BTC-PERP", "sell", 0.4, 110, C + 2 * HOUR + 10 * MIN),
          p3: order("p3", "BTC-PERP", "sell", 0.6, 60, C + 4 * HOUR + 10 * MIN, { clientId: "liquidation-3", reduceOnly: true, note: "liquidated at the mark (60)" }),
        },
        markets: { "BTC-PERP": market("perp", "BTC", "USD", { maxLeverage: 40 }) },
        ...extra,
      });
    const series: PriceSeries[] = [{ symbol: "BTC-PERP", interval: "1h", candles: bars(C, HOUR, [100, 105, 110, 108, 70, 60]) }];

    it("counts the margin as cash: opening costs the fee, reducing realises, the liquidation is a reduce at its price", () => {
      const r = rebuildEquity(perpBook(), series, { fromMs: C, toMs: C + 6 * HOUR, stepMs: HOUR });
      // 1h: long 1 at 100, marked 100; 2h: marked 105; 3h: 0.4 closed at 110 (+4), 0.6 marked 110; 4h: marked 108; 5h, 6h: liquidated at 60
      expect(r.points.map((p) => p.usd)).toEqual([1000, 999.9, 1004.9, 1009.86, 1008.66, 979.82, 979.82]);
      expect(replayPaperBook(perpBook())).toEqual({ cashUsd: 979.82, held: {}, positions: {} });
      // what the replay cannot know: a liquidation's loss past the margin. The book kept no funding list (a book from before it), but its
      // cash agrees with the replay to the cent, so no funding is missing from the curve, and none is said
      expect(r.inexact).toHaveLength(1);
      expect(r.inexact[0]).toContain("BTC-PERP was liquidated (p3, 2026-10-03T04:10:00.000Z)");
      expect(r.inexact[0]).toContain("past the position's margin");
      expect(r.missing).toEqual([]);
    });

    it("takes the funding the book kept out of the cash at its time, and then says nothing about funding", () => {
      const book = perpBook({ cashUsd: 979.02, funding: [{ at: iso(C + HOUR + 10 * MIN), symbol: "BTC-PERP", usd: 0.5 }, { at: iso(C + 2 * HOUR + 5 * MIN), symbol: "BTC-PERP", usd: 0.3 }] });
      const r = rebuildEquity(book, series, { fromMs: C, toMs: C + 6 * HOUR, stepMs: HOUR });
      expect(r.points.map((p) => p.usd)).toEqual([1000, 999.9, 1004.4, 1009.06, 1007.86, 979.02, 979.02]);
      expect(r.inexact).toHaveLength(1);
      expect(r.inexact[0]).toContain("BTC-PERP was liquidated (p3");
    });

    it("says how far the replay ends from the book's own cash when they differ (a loss the book capped at the margin)", () => {
      const r = rebuildEquity(perpBook({ cashUsd: 990 }), series, { fromMs: C, toMs: C + 6 * HOUR, stepMs: HOUR });
      expect(r.inexact).toContain(
        "the replay ends with $979.82 in cash and margin, the book with $990.00: $10.18 the replay cannot place in time (funding paid or received before the account kept it hour by hour, a liquidation's loss past its margin, or a fill the book no longer has), so the curve before now is below the book by up to that",
      );
    });

    it("keeps a short's sign and an added position's average entry as fill() does, and counts an open position's margin in the check", () => {
      // SOL: short 1 at 100, then 1 more at 120 — short 2 from 110, 220 of margin at 1x still put up; ETH: short 2 at 50, bought back at 40
      const book = bookOf({
        createdAt: iso(C),
        startCashUsd: 1000,
        // the book's cash leaves the open margin out: 1000 − the fees (0.1, 0.12, 0.1, 0.08) + 20 realised − 220 of margin
        cashUsd: round6(1000 - 0.1 - 0.12 - 0.1 - 0.08 + 20 - 220),
        positions: { "SOL-PERP": { side: "short", qty: 2, entryPrice: 110, marginUsd: 220, leverage: 1, fundingUsd: 0, fundedAt: C + 10 * MIN } },
        orders: {
          p1: order("p1", "SOL-PERP", "sell", 1, 100, C + 10 * MIN),
          p2: order("p2", "SOL-PERP", "sell", 1, 120, C + 20 * MIN),
          p3: order("p3", "ETH-PERP", "sell", 2, 50, C + 30 * MIN),
          p4: order("p4", "ETH-PERP", "buy", 2, 40, C + 90 * MIN),
        },
        markets: { "SOL-PERP": market("perp", "SOL"), "ETH-PERP": market("perp", "ETH") },
      });
      const end = replayPaperBook(book);
      expect(end.positions).toEqual({ "SOL-PERP": { side: "short", qty: 2, entryPrice: 110 } });
      expect(end.cashUsd).toBeCloseTo(1019.6, 6);
      const series2: PriceSeries[] = [
        { symbol: "SOL-PERP", interval: "1h", candles: bars(C, HOUR, [105, 100]) },
        { symbol: "ETH-PERP", interval: "1h", candles: bars(C, HOUR, [45, 40]) },
      ];
      const r = rebuildEquity(book, series2, { fromMs: C, toMs: C + 2 * HOUR, stepMs: HOUR });
      // 1h: 999.68 of cash, SOL short 2 from 110 marked 105 (+10), ETH short 2 from 50 marked 45 (+10); 2h: ETH closed (+20 − 0.08), SOL
      // marked 100 (+20)
      expect(r.points.map((p) => p.usd)).toEqual([1000, 1019.68, 1039.6]);
      // the margin still put up is counted with the book's cash, so the check finds nothing; the open position's own figure says it has paid
      // no funding, so there is none to miss
      expect(r.inexact).toEqual([]);
    });

    it("says nothing of funding where none is missing: a position closed in the hour, a new book's opened twenty minutes ago, one held three hours at a source with no rate", () => {
      const closed = bookOf({
        createdAt: iso(C),
        startCashUsd: 1000,
        cashUsd: round6(1000 - 0.1 + 6 - 0.106),
        orders: { p1: order("p1", "BTC-PERP", "buy", 1, 100, C + 10 * MIN), p2: order("p2", "BTC-PERP", "sell", 1, 106, C + 50 * MIN) },
        markets: { "BTC-PERP": market("perp", "BTC") },
      });
      const r = rebuildEquity(closed, series, { fromMs: C, toMs: C + 2 * HOUR, stepMs: HOUR });
      expect(r.points.map((p) => p.usd)).toEqual([1000, 1005.79, 1005.79]);
      expect(r.inexact).toEqual([]);
      // open, long 1 at 100 with 100 of margin at 1x: the book's cash is 1000 − 100 − 0.1, and its own figure says no funding paid yet
      const open = (opened: number, extra: Partial<PaperBook> = {}): PaperBook =>
        bookOf({
          createdAt: iso(C),
          startCashUsd: 1000,
          cashUsd: 899.9,
          positions: { "BTC-PERP": { side: "long", qty: 1, entryPrice: 100, marginUsd: 100, leverage: 1, fundingUsd: 0, fundedAt: opened } },
          orders: { p1: order("p1", "BTC-PERP", "buy", 1, 100, opened) },
          markets: { "BTC-PERP": market("perp", "BTC") },
          ...extra,
        });
      // a brand-new book (it keeps a funding list from its first moment, empty yet), looked at twenty minutes after the position opened
      expect(rebuildEquity(open(C + 40 * MIN, { funding: [] }), series, { fromMs: C, toMs: C + HOUR, stepMs: HOUR }).inexact).toEqual([]);
      // a book from before the list, its position held three hours at a source that shows no funding rate: nothing was paid
      const held = open(C + 10 * MIN);
      expect(held.funding).toBeUndefined();
      expect(rebuildEquity(held, series, { fromMs: C, toMs: C + 3 * HOUR + 10 * MIN, stepMs: HOUR }).inexact).toEqual([]);
    });

    it("says the funding an open position paid that the book's list does not have, from the position's own figure, and only that much", () => {
      // a first position opened and closed (its 0.20 of funding listed); a second opened at 4h, which has paid 1.20 by its own figure, only
      // 0.50 of it in the list (the account began keeping the list in between)
      const book = bookOf({
        createdAt: iso(C),
        startCashUsd: 1000,
        // 1000 − 0.1 − 0.2 (funding, out of the margin) − 0.1 (closed at 100, nothing realised) − 0.1 − 100 of margin put up
        cashUsd: 899.5,
        positions: { "BTC-PERP": { side: "long", qty: 1, entryPrice: 100, marginUsd: 98.8, leverage: 1, fundingUsd: 1.2, fundedAt: C + 7 * HOUR } },
        orders: {
          p1: order("p1", "BTC-PERP", "buy", 1, 100, C + 10 * MIN),
          p2: order("p2", "BTC-PERP", "sell", 1, 100, C + 3 * HOUR),
          p3: order("p3", "BTC-PERP", "buy", 1, 100, C + 4 * HOUR),
        },
        markets: { "BTC-PERP": market("perp", "BTC") },
        funding: [{ at: iso(C + HOUR + 10 * MIN), symbol: "BTC-PERP", usd: 0.2 }, { at: iso(C + 7 * HOUR), symbol: "BTC-PERP", usd: 0.5 }],
      });
      const r = rebuildEquity(book, [{ symbol: "BTC-PERP", interval: "1h", candles: flat(C, C + 8 * HOUR, HOUR, 100) }], { fromMs: C, toMs: C + 8 * HOUR, stepMs: HOUR });
      expect(r.points.at(-1)?.usd).toBe(999);
      // the 0.70 is exactly the gap between the replay's cash and the book's: said once, as funding, and the cash check says nothing more
      expect(r.inexact).toEqual([
        "BTC-PERP's open position has funding of $1.20 paid by the book's own figure and $0.50 paid in its list hour by hour (the rest was settled before the account kept the list): the $0.70 between them is not in the curve, so before now it sits above the book by up to that",
      ]);
    });

    it("finds funding paid before the list in the cash check when the positions are closed, and names funding first, with its size", () => {
      // a book from before the list: long 1 at 100 for five hours, 0.80 of funding paid out of its margin, closed at 100
      const book = bookOf({
        createdAt: iso(C),
        startCashUsd: 1000,
        cashUsd: round6(1000 - 0.1 - 0.8 - 0.1),
        orders: { p1: order("p1", "BTC-PERP", "buy", 1, 100, C + 10 * MIN), p2: order("p2", "BTC-PERP", "sell", 1, 100, C + 5 * HOUR + 10 * MIN) },
        markets: { "BTC-PERP": market("perp", "BTC") },
      });
      const r = rebuildEquity(book, series, { fromMs: C, toMs: C + 6 * HOUR, stepMs: HOUR });
      expect(r.inexact).toEqual([
        "the replay ends with $999.80 in cash and margin, the book with $999.00: $0.80 the replay cannot place in time (funding paid or received before the account kept it hour by hour or a fill the book no longer has), so the curve before now is above the book by up to that",
      ]);
    });

    it("says when the replay ends on the other side of a perpetual from the book", () => {
      const book = bookOf({
        createdAt: iso(C),
        startCashUsd: 1000,
        cashUsd: 899.9,
        positions: { "SOL-PERP": { side: "short", qty: 1, entryPrice: 100, marginUsd: 100, leverage: 1, fundingUsd: 0, fundedAt: C + 10 * MIN } },
        orders: { p1: order("p1", "SOL-PERP", "buy", 1, 100, C + 10 * MIN) },
        markets: { "SOL-PERP": market("perp", "SOL") },
      });
      const r = rebuildEquity(book, [{ symbol: "SOL-PERP", interval: "1h", candles: bars(C, HOUR, [100, 110]) }], { fromMs: C, toMs: C + 2 * HOUR, stepMs: HOUR });
      expect(r.inexact).toEqual(["the replay ends long 1 SOL-PERP and the book short: a fill is missing from one of them or on the other side, so the curve's unrealised profit on it has the wrong sign"]);
    });
  });

  it("leaves out a fill in a market that is not priced in dollars, and says so", () => {
    const C = ms("2026-10-06T00:00:00Z");
    const b = bookOf({ createdAt: iso(C), orders: { p1: order("p1", "XYZ/EUR", "buy", 1, 100, C + HOUR, { feeUsd: 0.1 }) }, markets: { "XYZ/EUR": market("spot", "XYZ", "EUR") } });
    const r = rebuildEquity(b, [], { fromMs: C, toMs: C + 2 * HOUR, stepMs: HOUR });
    expect(r.points.every((p) => p.usd === b.startCashUsd)).toBe(true);
    expect(r.inexact.some((x) => x.includes("p1 (XYZ/EUR) is priced in EUR, not dollars, so it is left out of the curve"))).toBe(true);
  });

  it("values a symbol with no bars at the last price the account traded it at, marks those points partial and names it missing", () => {
    const C = ms("2026-10-06T00:00:00Z");
    const book = bookOf({
      createdAt: iso(C),
      cashUsd: 9499.5,
      holdings: { TSLAX: { qty: 2, costUsd: 500.5 } },
      orders: { p1: order("p1", "TSLAX", "buy", 2, 250, C + 90 * MIN, { feeUsd: 0.5 }) },
      markets: { TSLAX: market("token", "TSLAX", "USD", { source: "xstocks" }) },
    });
    const r = rebuildEquity(book, [{ symbol: "BTC/USD", interval: "1h", candles: bars(C, HOUR, [1, 2, 3]) }], { fromMs: C, toMs: C + 3 * HOUR, stepMs: HOUR });
    expect(r.points).toEqual([
      { at: C, usd: 10_000 },
      { at: C + HOUR, usd: 10_000 },
      { at: C + 2 * HOUR, usd: 9999.5, partial: true },
      { at: C + 3 * HOUR, usd: 9999.5, partial: true },
    ]);
    expect(r.missing).toEqual(["TSLAX"]);
    expect(r.inexact).toEqual(["no price bar was at hand for TSLAX at some points: there it is valued at the last price this account traded it at, and those points are marked partial"]);
  });

  it("never draws a point before the book started: a range from before starts at its start, one wholly before is empty", () => {
    const created = ms(CREATED);
    const r = rebuildEquity(realBook(), realBars(), { fromMs: created - 3 * DAY, toMs: created + 3 * HOUR, stepMs: HOUR });
    expect(r.points.map((p) => p.at)).toEqual([created, ms("2026-10-13T16:00:00Z"), ms("2026-10-13T17:00:00Z"), ms("2026-10-13T18:00:00Z")]);
    expect(r.points[0]!.usd).toBe(10_000);
    expect(r.points.every((p) => p.at >= created)).toBe(true);
    expect(rebuildEquity(realBook(), realBars(), { fromMs: created - 3 * DAY, toMs: created - 1, stepMs: HOUR, nowUsd: 9987.56 }).points).toEqual([]);
    // a range that starts after the book: no start point, the grid from the range's start
    const later = rebuildEquity(realBook(), realBars(), { fromMs: ms("2026-10-14T00:00:00Z"), toMs: ms("2026-10-14T02:00:00Z"), stepMs: HOUR });
    expect(later.points.map((p) => p.at)).toEqual([ms("2026-10-14T00:00:00Z"), ms("2026-10-14T01:00:00Z"), ms("2026-10-14T02:00:00Z")]);
  });

  it("ends on the live value when it is given: a point of its own at the range's end, or in place of the grid's last", () => {
    const from = ms("2026-10-14T15:00:00Z");
    const off = rebuildEquity(realBook(), realBars(), { fromMs: from, toMs: ms("2026-10-14T15:37:12Z"), stepMs: 5 * MIN, nowUsd: 9987.564 });
    expect(off.points.at(-1)).toEqual({ at: ms("2026-10-14T15:37:12Z"), usd: 9987.56 });
    expect(off.points.at(-2)).toEqual({ at: ms("2026-10-14T15:35:00Z"), usd: 9995.98 });
    const on = rebuildEquity(realBook(), realBars(), { fromMs: from, toMs: ms("2026-10-14T15:35:00Z"), stepMs: 5 * MIN, nowUsd: 9987.564 });
    const without = rebuildEquity(realBook(), realBars(), { fromMs: from, toMs: ms("2026-10-14T15:35:00Z"), stepMs: 5 * MIN });
    expect(on.points).toHaveLength(without.points.length);
    expect(on.points.at(-1)).toEqual({ at: ms("2026-10-14T15:35:00Z"), usd: 9987.56 });
    expect(on.points.slice(0, -1)).toEqual(without.points.slice(0, -1));
  });

  it("takes the latest bar known from 5m, 1h and 1d mixed: the finer where two closed together, a coarser one that closed later", () => {
    const D = ms("2026-10-10T00:00:00Z");
    const book = bookOf({
      createdAt: iso(D - 2 * DAY),
      startCashUsd: 1000,
      cashUsd: 895,
      holdings: { "SOL/USD": { qty: 1, costUsd: 105 } },
      orders: { p1: order("p1", "SOL/USD", "buy", 1, 105, D - DAY + 30 * MIN, { feeUsd: 0 }) },
      markets: { "SOL/USD": market("spot", "SOL") },
    });
    const series: PriceSeries[] = [
      { symbol: "SOL/USD", interval: "1d", candles: bars(D - 2 * DAY, DAY, [100, 110, 120]) },
      { symbol: "SOL/USD", interval: "5m", candles: bars(D + 10 * HOUR, 5 * MIN, Array.from({ length: 24 }, (_, j) => 300 + j)) },
      { symbol: "SOL/USD", interval: "1h", candles: bars(D, HOUR, Array.from({ length: 13 }, (_, i) => 200 + i)) },
    ];
    const r = rebuildEquity(book, series, { fromMs: D - DAY, toMs: D + 14 * HOUR, stepMs: HOUR });
    const at = (h: number) => valueAt(r, D + h * HOUR)?.usd;
    expect(at(-24)).toBe(1000); // nothing held yet
    expect(at(-23)).toBe(995); // the 1d bar that closed at D − 1d
    expect(at(0)).toBe(1005); // the 1d bar that closed at D; no 1h bar has closed yet
    expect(at(1)).toBe(1095); // the first 1h bar
    expect(at(10)).toBe(1104); // the 5m bar that started at 10:00 has not closed
    expect(at(11)).toBe(1206); // the 1h and the 5m both closed at 11:00: the 5m's
    expect(at(12)).toBe(1218);
    expect(at(13)).toBe(1107); // the 5m bars end at 12:00; the 1h bar that closed at 13:00 is the latest known
    expect(at(14)).toBe(1107); // the 1d bar that started at D closes at D + 1d
    expect(r.points.every((p) => !p.partial)).toBe(true);
    expect(r.inexact).toEqual([]);
  });

  it("knows a bar's close only when its series says it closed: a daily bar stamped at the open closes at the session's end", () => {
    const C = ms("2026-10-12T00:00:00Z");
    const book = bookOf({
      createdAt: iso(C),
      cashUsd: 7500,
      holdings: { AAPL: { qty: 10, costUsd: 2500 } },
      orders: { p1: order("p1", "AAPL", "buy", 10, 250, "2026-10-12T14:00:00.000Z", { feeUsd: 0 }) },
      markets: { AAPL: market("stock", "AAPL", "USD", { source: "cboe" }) },
    });
    const candles = [
      { t: ms("2026-10-12T13:30:00Z"), o: 250, h: 253, l: 249, c: 252 },
      { t: ms("2026-10-13T13:30:00Z"), o: 252, h: 256, l: 251, c: 255 },
    ];
    const r = rebuildEquity(book, [{ symbol: "AAPL", interval: "1d", candles, closeAt: (c) => c.t + 6.5 * HOUR }], { fromMs: C, toMs: ms("2026-10-13T21:00:00Z"), stepMs: HOUR });
    expect(valueAt(r, ms("2026-10-12T19:00:00Z"))).toEqual({ at: ms("2026-10-12T19:00:00Z"), usd: 10_000, partial: true });
    expect(valueAt(r, ms("2026-10-12T20:00:00Z"))).toEqual({ at: ms("2026-10-12T20:00:00Z"), usd: 10_020 });
    expect(valueAt(r, ms("2026-10-13T19:00:00Z"))?.usd).toBe(10_020);
    expect(valueAt(r, ms("2026-10-13T20:00:00Z"))?.usd).toBe(10_050);
    expect(r.missing).toEqual(["AAPL"]);
  });

  it("refuses a step that is not a positive number of milliseconds, a range that ends before it starts, and a grid of more points than one curve draws", () => {
    const created = ms(CREATED);
    expect(() => rebuildEquity(realBook(), [], { fromMs: created, toMs: created + DAY, stepMs: 0 })).toThrow(RangeError);
    // with the live value too: no point at the end of a range that does not exist
    expect(() => rebuildEquity(realBook(), [], { fromMs: created + 5 * HOUR, toMs: created + 2 * HOUR, stepMs: HOUR, nowUsd: 999 })).toThrow(RangeError);
    expect(() => rebuildEquity(realBook(), [], { fromMs: created, toMs: created + (REBUILD_MAX_POINTS + 10) * MIN, stepMs: MIN })).toThrow(RangeError);
  });
});
