import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { liveOptions, openLive, type LiveDeps } from "../../src/portfolio/live/index.ts";
import { PAPER_DEFAULT_CASH, paperBookPath, paperSource, parsePaperCash, type PaperBook } from "../../src/portfolio/live/paper.ts";
import type { Listing, PublicSource } from "../../src/portfolio/live/public-markets.ts";
import type { LiveTrader, Market, OrderRequest, OrderState } from "../../src/portfolio/live/trade.ts";
import type { LiveBalance, LiveSource } from "../../src/portfolio/live/types.ts";

/** THE ACCOUNT'S OWN PAPER ACCOUNT (live/paper.ts): paper money, the markets the public sources list, fills by the account's own declared
 * rule, a book in the home. The public sources here are stand-ins that speak the real ones' shape (public-markets.ts PublicSource), with
 * prices the tests move; nothing reaches the network and no money exists anywhere. */
const NOW = 1791484300000;
let now = NOW;
const clock = () => now;
let n = 0;
const clientId = () => (++n).toString(16).padStart(32, "0");

type Row = Listing & { price: number; bid: number; ask: number };
const row = (symbol: string, kind: Market["kind"], base: string, quote: string, price: number, extra: Partial<Row> = {}): Row => ({ symbol, name: `${base} ${kind === "perp" ? "perpetual" : kind === "event" ? "contract" : "market"}`, kind, base, quote, price, bid: price - price * 0.0002, ask: price + price * 0.0002, open: true, types: [], volumeUsd24h: 1_000_000, changePct24h: 1.2, ...extra });
/** a stand-in public source: a list the test can reprice, a search by a few letters, and (where said) candles and events */
function source(id: string, name: string, kind: PublicSource["kind"], rows: Row[], extra: Partial<PublicSource> = {}): PublicSource & { rows: Row[] } {
  return {
    id,
    name,
    kind,
    connectTo: id,
    connector: `live:exchange:${id}`,
    rows,
    async listings(o) {
      const Q = (o.q ?? "").trim().toUpperCase();
      return (Q ? rows.filter((m) => m.symbol.toUpperCase().includes(Q) || m.base.toUpperCase().includes(Q)) : rows).slice(0, o.limit).map((m) => ({ ...m }));
    },
    ...extra,
  };
}
const reprice = (s: { rows: Row[] }, symbol: string, price: number, spread = 0.0002) => {
  const m = s.rows.find((x) => x.symbol === symbol)!;
  m.price = price;
  m.bid = price - price * spread;
  m.ask = price + price * spread;
};
const BARS = [{ t: NOW - 7_200_000, o: 59000, h: 60100, l: 58900, c: 60000, v: 12 }];
function sources() {
  const kraken = source("kraken", "Kraken", "exchange", [row("BTC/USD", "spot", "BTC", "USD", 60000, { volumeUsd24h: 2e9 }), row("ETH/USD", "spot", "ETH", "USD", 2000), row("DOGE/EUR", "spot", "DOGE", "EUR", 0.1), row("BTC/USD:USD-251226", "future", "BTC", "USD", 61000)], { candles: async (symbol) => (symbol === "BTC/USD" ? BARS : []) });
  const coinbase = source("coinbase", "Coinbase", "exchange", [row("BTC/USD", "spot", "BTC", "USD", 60100), row("SOL/USD", "spot", "SOL", "USD", 150)]);
  const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { fundingRate: 0.0000125 }), row("ETH-PERP", "perp", "ETH", "USDC", 2001)]);
  const fed = row("KXFED-25DEC-T4.00:YES", "event", "KXFED-25DEC-T4.00:YES", "USD", 0.62, { bid: 0.61, ask: 0.63, group: { id: "KXFED-25DEC-T4.00", title: "Fed cuts in December?" }, outcome: "YES", closeTime: new Date(NOW + 30 * 86_400_000).toISOString(), category: "Economics" });
  const kalshi = source("kalshi", "Kalshi", "events", [fed], { events: async () => [{ ...fed }] });
  const tokens = source("robinhood-stock-tokens", "Robinhood Stock Tokens", "tokens", [row("NVDA", "token", "NVDA", "USD", 180, { bid: 179.9, ask: 180.1 })]);
  return { all: [kraken, coinbase, hl, kalshi, tokens], kraken, coinbase, hl, kalshi, tokens };
}

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "paper-"));
  homes.push(h);
  return h;
};
const ok = <T>(x: T | Refusal): T => {
  if (isRefusal(x)) throw new Error(`expected an answer, got ${x.code}: ${x.message}`);
  return x;
};
const refusal = (x: unknown): Refusal => {
  if (!isRefusal(x)) throw new Error(`expected a refusal, got ${JSON.stringify(x)}`);
  return x;
};
async function open(h: string, venue = "paper-1", o: { label?: string; cash?: number; all?: PublicSource[] } = {}): Promise<{ t: LiveTrader; source: LiveSource; first: LiveBalance[]; s: ReturnType<typeof sources> }> {
  const s = sources();
  const opened = await paperSource({ home: h, venue, label: o.label ?? "", cashUsd: o.cash ?? PAPER_DEFAULT_CASH, sources: () => o.all ?? s.all, clock });
  if (isRefusal(opened)) throw new Error(`${opened.code}: ${opened.message}`);
  return { t: opened.source.trader!, source: opened.source, first: opened.first, s };
}
const order = (o: Partial<OrderRequest> = {}): OrderRequest => ({ symbol: "BTC/USD", side: "buy", type: "market", qty: 0.1, clientId: clientId(), ...o });
const cashOf = (first: LiveBalance[]) => first.find((b) => b.asset === "USD" && b.where === "paper money")!.usd!;
const book = (h: string, venue = "paper-1"): PaperBook => JSON.parse(readFileSync(paperBookPath(h, venue), "utf8")) as PaperBook;

describe("a paper account: opened with paper money, its book in the home", () => {
  it("opens with the default paper money, or the sum given; says paper in its name; keeps its book for the user alone", async () => {
    const h = home();
    const { source, first } = await open(h);
    expect(source.paper).toBe(true);
    expect(source.name).toBe("Paper account · paper");
    expect(source.via).toContain("the account's own book");
    expect(source.probe.note).toContain("a paper account: fills at the public quote by the account's own rule");
    expect(source.readOnlyBecause).toContain("paper money");
    expect(first).toEqual([{ asset: "USD", amount: 10000, usd: 10000, where: "paper money", class: "cash" }]);
    const path = paperBookPath(h, "paper-1");
    expect([existsSync(path), statSync(path).mode & 0o777]).toEqual([true, 0o600]);
    expect(book(h)).toMatchObject({ version: 1, id: "paper-1", cashUsd: 10000, startCashUsd: 10000, feeBps: 10 });
    const rich = await open(h, "paper-momentum", { label: "Momentum", cash: 25000 });
    expect([rich.source.name, cashOf(rich.first)]).toEqual(["Momentum · paper", 25000]);
    expect((await open(h, "paper-3", { label: "My paper book" })).source.name).toBe("My paper book");
  });

  it("the starting money as the owner writes it: empty is the default, dollars with or without $ and commas, nothing else", () => {
    expect(parsePaperCash("", "paper-1")).toBe(PAPER_DEFAULT_CASH);
    expect(parsePaperCash(" $25,000 ", "paper-1")).toBe(25000);
    expect(parsePaperCash("1500.50", "paper-1")).toBe(1500.5);
    expect(refusal(parsePaperCash("lots", "paper-1")).code).toBe("E_ACCOUNT_CREDENTIAL");
    expect(refusal(parsePaperCash("0", "paper-1")).code).toBe("E_ACCOUNT_CREDENTIAL");
    expect(refusal(parsePaperCash("200000000", "paper-1")).message).toContain("at most");
    expect(refusal(parsePaperCash("999999999999", "paper-1")).code).toBe("E_ACCOUNT_CREDENTIAL");
  });

  it("lists what the public sources list, in dollars, the first source speaking for a symbol two list; one market priced fresh, with the account's own steps and rule", async () => {
    const { t } = await open(home());
    const all = ok(await t.markets(""));
    expect(all.map((m) => m.symbol)).toEqual(["BTC/USD", "ETH/USD", "SOL/USD", "BTC-PERP", "ETH-PERP", "KXFED-25DEC-T4.00:YES", "NVDA"]);
    // Kraken's BTC/USD, not Coinbase's; no euro market, no dated future
    expect(all.find((m) => m.symbol === "BTC/USD")!.price).toBe(60000);
    expect(ok(await t.markets("BTC")).map((m) => m.symbol)).toEqual(["BTC/USD", "BTC-PERP"]);
    const btc = ok(await t.market("BTC/USD"));
    expect(btc).toMatchObject({ kind: "spot", base: "BTC", quote: "USD", price: 60000, bid: 59988, ask: 60012, open: true, minNotional: 1, qtyStep: 0.000001, types: ["market", "limit"], tifs: ["gtc", "ioc"], postOnly: false, sellsReduce: true });
    expect(btc.note).toContain("a paper account");
    expect(ok(await t.market("BTC-PERP"))).toMatchObject({ kind: "perp", reduceOnly: true, maxLeverage: 1, contractSize: 1, fundingRate: 0.0000125 });
    expect(ok(await t.market("KXFED-25DEC-T4.00:YES"))).toMatchObject({ kind: "event", minQty: 1, qtyStep: 1, priceStep: 0.01, bid: 0.61, ask: 0.63, outcome: "YES" });
    expect(refusal(await t.market("XYZ/USD")).code).toBe("E_VENUE_REJECTED");
  });
});

describe("fills by the account's own rule", () => {
  it("a market buy fills whole at the ask with the fee, the holding is marked at the price; a sell sells only what is held, at the bid", async () => {
    const h = home();
    const { t, source, s } = await open(h);
    const bought = ok(await t.place(order({ qty: 0.1 })));
    expect(bought).toMatchObject({ status: "filled", filledQty: 0.1, avgPrice: 60012, feeUsd: 6.0012 });
    expect(book(h).cashUsd).toBeCloseTo(10000 - 6001.2 - 6.0012, 4);
    const read = await source.read();
    expect(read.find((b) => b.asset === "BTC")).toMatchObject({ amount: 0.1, usd: 6000, class: "crypto" });
    expect(cashOf(read)).toBeCloseTo(3992.8, 2);
    expect(refusal(await t.place(order({ side: "sell", qty: 0.2 }))).code).toBe("E_VENUE_INSUFFICIENT");
    reprice(s.kraken, "BTC/USD", 61000);
    const sold = ok(await t.place(order({ side: "sell", qty: 0.1 })));
    expect(sold).toMatchObject({ status: "filled", avgPrice: 60987.8 });
    expect(book(h).holdings).toEqual({});
    expect(book(h).cashUsd).toBeCloseTo(3992.7988 + 6098.78 - 6.09878, 3);
    // the same client id again is the same order, not a second fill
    expect(ok(await t.place({ ...order({ qty: 0.1 }), clientId: (bought.native as { order: string }).order === "p1" ? book(h).orders.p1!.clientId : "" }))).toMatchObject({ ref: "p1", status: "filled" });
  });

  it("the worst price the door gives a market order holds: a quote past it fills nothing", async () => {
    const h = home();
    const { t } = await open(h);
    const r = refusal(await t.place(order({ qty: 0.1, worstPrice: 60000 })));
    expect(r.code).toBe("E_VENUE_REJECTED");
    expect(r.message).toContain("past the worst price");
    expect(book(h).cashUsd).toBe(10000);
    expect(ok(await t.place(order({ qty: 0.1, worstPrice: 60012 }))).status).toBe("filled");
  });

  it("a limit order rests, fills at its limit when the quote crosses it — judged when the account looks — an IOC limit that does not cross is canceled, and a resting order can be taken off", async () => {
    const h = home();
    const { t, s } = await open(h);
    const resting = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(resting).toMatchObject({ status: "open", filledQty: 0 });
    expect(ok(await t.status(resting.ref, "BTC/USD")).status).toBe("open");
    reprice(s.kraken, "BTC/USD", 58980);
    now += 30_000;
    expect(ok(await t.status(resting.ref, "BTC/USD"))).toMatchObject({ status: "filled", avgPrice: 59000, filledQty: 0.1, feeUsd: 5.9 });
    expect(book(h).holdings["BTC/USD"]).toMatchObject({ qty: 0.1 });
    const ioc = ok(await t.place(order({ side: "sell", type: "limit", limitPrice: 70000, qty: 0.1, tif: "ioc" })));
    expect(ioc.status).toBe("canceled");
    expect(book(h).holdings["BTC/USD"]!.qty).toBe(0.1);
    const crossing = ok(await t.place(order({ side: "sell", type: "limit", limitPrice: 58000, qty: 0.05 })));
    expect(crossing).toMatchObject({ status: "filled", avgPrice: 58000 });
    const open2 = ok(await t.place(order({ type: "limit", limitPrice: 50000, qty: 0.1 })));
    expect(ok(await t.cancel(open2.ref, "BTC/USD")).status).toBe("canceled");
    expect(refusal(await t.cancel("p99", "BTC/USD")).code).toBe("E_ACCOUNT_ORDER_UNKNOWN");
    // nothing is reserved for a resting order: one that crosses with the paper money gone is rejected then, in words
    const big = ok(await t.place(order({ type: "limit", limitPrice: 58900, qty: 1 })));
    expect(big.status).toBe("open");
    reprice(s.kraken, "BTC/USD", 58800);
    now += 30_000;
    const judged = ok(await t.status(big.ref, "BTC/USD"));
    expect(judged.status).toBe("rejected");
    expect((judged.native as { note: string }).note).toContain("not enough paper money");
  });

  it("refuses what it does not take, in words, before anything moves: stops, post-only, fill-or-kill, reduce-only on spot, a size off the step, a market no source prices", async () => {
    const h = home();
    const { t } = await open(h);
    expect(refusal(await t.place(order({ type: "stop", stopPrice: 50000 }))).code).toBe("E_VENUE_ORDER_INVALID");
    expect(refusal(await t.place(order({ type: "limit", limitPrice: 50000, postOnly: true }))).message).toContain("post-only");
    expect(refusal(await t.place(order({ tif: "fok" }))).message).toContain("gtc and ioc");
    expect(refusal(await t.place(order({ reduceOnly: true }))).message).toContain("reduce-only is for a perpetual");
    expect(refusal(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 1.5 }))).message).toContain("steps of 1");
    expect(refusal(await t.place(order({ symbol: "XYZ/USD" }))).code).toBe("E_VENUE_REJECTED");
    expect(book(h).cashUsd).toBe(10000);
  });

  it("perpetuals at 1x: the notional is the margin, the position is marked at the quote, a reduce-only close realises it, a flip is refused, a short is a short", async () => {
    const h = home();
    const { t, source, s } = await open(h);
    const opened = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    expect(opened).toMatchObject({ status: "filled", avgPrice: 60017.001 });
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ side: "long", qty: 0.1, entryPrice: 60017.001, marginUsd: 6001.7001 });
    reprice(s.hl, "BTC-PERP", 62000);
    const pos = ok(await t.positions!());
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ symbol: "BTC-PERP", side: "long", qty: 0.1, entryPrice: 60017.001, markPrice: 62000, usd: 6200, leverage: 1 });
    expect(pos[0]!.unrealizedUsd).toBeCloseTo(198.2999, 3);
    const margin = (await source.read()).find((b) => b.where?.startsWith("paper margin"))!;
    expect(margin.usd).toBeCloseTo(6001.7 + 198.3, 1);
    expect(refusal(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.2 }))).message).toContain("flip the side");
    expect(refusal(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.2, reduceOnly: true }))).message).toContain("more than");
    expect(refusal(await t.place(order({ symbol: "ETH-PERP", side: "sell", qty: 1, reduceOnly: true }))).message).toContain("no long position");
    const half = ok(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.05, reduceOnly: true })));
    expect(half.status).toBe("filled");
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ qty: 0.05 });
    expect(book(h).fills.at(-1)!.realizedUsd).toBeCloseTo((61987.6 - 60017.001) * 0.05, 3);
    ok(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.05 })));
    expect(book(h).positions).toEqual({});
    const short = ok(await t.place(order({ symbol: "ETH-PERP", side: "sell", qty: 1 })));
    expect(short.status).toBe("filled");
    expect(book(h).positions["ETH-PERP"]).toMatchObject({ side: "short", qty: 1 });
    reprice(s.hl, "ETH-PERP", 1900);
    expect(ok(await t.positions!())[0]!.unrealizedUsd).toBeCloseTo(2000.5998 - 1900, 3);
    expect(refusal(await t.place(order({ symbol: "BTC-PERP", qty: 100 }))).code).toBe("E_VENUE_INSUFFICIENT");
  });

  it("event contracts: whole contracts at the ask, held and marked at the price, never settled", async () => {
    const h = home();
    const { t, source } = await open(h);
    const got = ok(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 10 })));
    expect(got).toMatchObject({ status: "filled", avgPrice: 0.63, feeUsd: 0.0063 });
    const line = (await source.read()).find((b) => b.class === "event")!;
    expect(line).toMatchObject({ asset: "KXFED-25DEC-T4.00:YES", amount: 10, usd: 6.2 });
    expect(line.where).toContain("Fed cuts");
  });

  it("stats, price history and events come from the market's own source; a source with no history says so", async () => {
    const { t } = await open(home());
    expect(ok(await t.stats!(["BTC/USD"])).get("BTC/USD")).toMatchObject({ price: 60000, changePct24h: 1.2 });
    expect(ok(await t.candles!("BTC/USD", "1h", NOW - 86_400_000))).toEqual(BARS);
    expect(refusal(await t.candles!("KXFED-25DEC-T4.00:YES", "1h", NOW - 86_400_000)).code).toBe("E_VENUE_RAIL_CLOSED");
    expect(ok(await t.events!({ limit: 10 })).map((m) => [m.symbol, m.kind])).toEqual([["KXFED-25DEC-T4.00:YES", "event"]]);
  });
});

describe("the book", () => {
  it("is continued when the same venue is opened again — cash, holdings, resting orders, markets — and another venue is another book", async () => {
    const h = home();
    const a = await open(h, "paper-a", { label: "Alpha", cash: 5000 });
    ok(await a.t.place(order({ qty: 0.01 })));
    const resting = ok(await a.t.place(order({ type: "limit", limitPrice: 50000, qty: 0.01 })));
    const again = await open(h, "paper-a", { label: "Alpha", cash: 99 });
    expect(again.source.name).toBe("Alpha · paper");
    expect(cashOf(again.first)).toBeCloseTo(5000 - 600.12 - 0.60012, 2);
    expect(again.first.find((b) => b.asset === "BTC")).toMatchObject({ amount: 0.01 });
    expect(ok(await again.t.status(resting.ref, "BTC/USD")).status).toBe("open");
    const b = await open(h, "paper-b", { cash: 99 });
    expect(cashOf(b.first)).toBe(99);
    expect([existsSync(paperBookPath(h, "paper-a")), existsSync(paperBookPath(h, "paper-b"))]).toEqual([true, true]);
  });

  it("through the account's own table: live:paper needs nothing, takes a name and a sum, and is paper", async () => {
    const h = home();
    const s = sources();
    expect(liveOptions(h).options.find((o) => o.kind === "paper")).toMatchObject({ connector: "live:paper", needs: "none", venues: [] });
    const deps = { home: h, clock, publicSources: () => s.all, http: async () => ({ status: 599, body: undefined, text: "" }), proofs: {}, price: async () => undefined, mm: async () => ({}) } as unknown as LiveDeps;
    const opened = await openLive({ venue: "paper-momentum", connector: "live:paper", label: "Momentum", reference: " $25,000 " }, deps);
    if (isRefusal(opened)) throw new Error(opened.message);
    expect(opened.source).toMatchObject({ paper: true, name: "Momentum · paper", reference: "paper/paper-momentum/book.json" });
    expect(opened.first).toEqual([{ asset: "USD", amount: 25000, usd: 25000, where: "paper money", class: "cash" }]);
    expect(opened.summary).toContain("started with $25,000.00 of paper money");
    expect(refusal(await openLive({ venue: "paper-2", connector: "live:paper", label: "", reference: "a lot" }, deps)).code).toBe("E_ACCOUNT_CREDENTIAL");
    const state: OrderState | Refusal = await opened.source.trader!.place(order({ qty: 0.01 }));
    expect(ok(state).status).toBe("filled");
  });
});
