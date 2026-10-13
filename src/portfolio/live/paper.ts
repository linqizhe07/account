/** A PAPER ACCOUNT the account keeps itself (the connector live:paper): paper dollars, every market the public sources list, fills by the
 * account's own declared rule, a book in the home. Nothing to connect, so it is the account's way in for someone with no wallet, no
 * exchange account and no key: the first flight, with every door, limit, card and statement line the real thing has, and no money.
 *
 * What it is made of:
 *   prices    the public market data Markets reads without a key (public-markets.ts: the exchanges' tickers, Hyperliquid's perpetuals,
 *             Kalshi's, Polymarket's and Polymarket US's event contracts, Robinhood's Stock Tokens, xStocks at Gate and Ondo Stocks
 *             (public-rwa.ts), US stocks at Cboe's delayed quotes (public-stocks.ts), the pre-IPO perpetuals). A market is listed here under
 *             the symbol its source lists it by (`BTC/USD` from Kraken, `BTC-PERP` from Hyperliquid, `AAPL` from Cboe, a Kalshi ticker);
 *             where two sources list the same symbol, the first in the sources' order speaks for it (Cboe comes before Robinhood's Stock
 *             Tokens, so `NVDA` here is the share, not the token). A quote is the source's listing, at
 *             most as old as the service keeps a listing (twenty seconds) — and, for a US stock, fifteen minutes behind the market, which
 *             is Cboe's delay and said on the line
 *   fills     the account's OWN RULE, said everywhere it shows: a market order fills at once, whole, at the ask (a buy) or the bid (a sell),
 *             inside the worst price the account's door gave it; a limit order rests and fills at its limit when the quote crosses it,
 *             checked whenever the account looks at the account (a read, a poll of the order, the positions) — an IOC limit that does not
 *             cross is canceled; a fee of `feeBps` of the notional (0.10% unless the book says otherwise); no depth, no partial fills,
 *             no slippage past the quote. Nothing is reserved for a resting order: it is judged when it crosses, and rejected then if the
 *             paper money is not there. A US STOCK fills only while Cboe's delayed quote is from inside the regular session — 09:45 to
 *             16:15 New York on a market day (the session shifted by the delay) — so no fill is ever at a quote from outside it: out of
 *             that window no market order is taken (a limit order rests and waits for it), as a broker holds an order for the open
 *   holdings  a coin, a token, a share or an event contract bought is held and sold only as far as it is held (no shorting them); a
 *             PERPETUAL is a position, long or short, with ISOLATED margin at the leverage set for the market (1x unless set, up to the most
 *             the market's source shows): the notional over the leverage is put up as margin, the unrealised profit is marked at the quote,
 *             a close (reduce-only, or the opposite side up to the position) realises it; the side is never flipped by one order.
 *             FUNDING is paid or received out of the margin each whole hour the position stands, at the rate the source shows when the
 *             account looks (Hyperliquid's rate is hourly; another venue's is for its eight-hour interval, so an eighth of it an hour), on
 *             the notional at the mark, the long paying when the rate is above zero; a market whose source shows no rate pays none.
 *             LIQUIDATION: when the margin left — the margin put up, less the loss and the funding paid — falls to the maintenance margin,
 *             half the initial margin at the market's most leverage (the notional at the mark over twice that leverage), the position is
 *             closed at the mark, what is left of the margin after the fee goes back to cash, and the fill says "liquidated". At 1x a long
 *             cannot be liquidated; a short at 1x is, once the price has risen by a third (as at a venue that keeps that rule).
 *             An EVENT CONTRACT is marked at its price and, once its venue says the market has settled (public-markets.ts `settlement`),
 *             paid out at what its venue paid — $1 a contract to the side that won, nothing to the other — and taken off the book; a
 *             market that has closed and not settled is said to be waiting. A venue that does not say settlements never settles here
 *   the book  <home>/paper/<venue>/book.json, the user's alone (0600), rewritten atomically after every change: cash, holdings,
 *             positions (with their leverage and the funding paid), the leverage set per market, orders, the last 500 fills (a settlement
 *             and a liquidation are fills with a note), and each traded market's source. Connecting the same venue id again continues the
 *             book; another id is another account — several can be open at once, each its own venue on the account
 *
 * The source says `paper: true` (types.ts): its balance is not money, its orders are rehearsals the door holds to the owner's signature or
 * an agent's limit and not to the server's cap, Markets keeps its line after every real venue's, the comparison leaves it out.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRefusal, type Refusal } from "../../core/errors.ts";
import type { AssetClass } from "../accounts.ts";
import { no } from "../refuse.ts";
import type { Listing, PublicSource } from "./public-markets.ts";
import { cboeQuoteInSession, US_STOCKS_ID, usSession } from "./public-stocks.ts";
import { badOrder, CANDLE_INTERVALS, inDollars, onStep, pick, plain, type Candle, type CandleInterval, type LiveTrader, type Market, type MarketKind, type MarketStats, type OrderRequest, type OrderState, type OrderStatus, type Position, type Side } from "./trade.ts";
import { isStable, type LiveBalance, type LiveSource } from "./types.ts";

export const PAPER_DEFAULT_CASH = 10_000;
export const PAPER_MAX_CASH = 100_000_000;
export const PAPER_FEE_BPS = 10;
/** how long one source has to answer a listing */
const SOURCE_MS = 4_000;
const LIST_LIMIT = 40;
const FILLS_KEPT = 500;
const DEFAULT_QTY_STEP = 0.000001;
const HOUR = 3_600_000;
/** how often an event market the account holds is asked whether it has settled: every minute once past its close, every ten before it
 * (a market may settle early) */
const SETTLE_AFTER_CLOSE_MS = 60_000;
const SETTLE_BEFORE_CLOSE_MS = 600_000;
/** the sources whose funding rate is hourly (Hyperliquid's); another perpetual venue's rate is for an eight-hour interval */
const HOURLY_FUNDING = /^hyperliquid/;
const FUNDING_INTERVAL_HOURS = 8;

export interface PaperMarketRef {
  /** the public source that lists it (PublicSource.id) */
  source: string;
  kind: MarketKind;
  base: string;
  quote: string;
  name: string;
  /** the last quote read, for a mark when no fresh one is at hand */
  last?: { price?: number | undefined; bid?: number | undefined; ask?: number | undefined; at: number } | undefined;
  /** a perpetual: the most leverage its source showed when it was last read */
  maxLeverage?: number | undefined;
  /** an event contract: when its venue said it closes, and what its venue has said since — closed and not settled, or settled and paid */
  closeTime?: string | undefined;
  closed?: true | undefined;
  settled?: { payout: number; at: string } | undefined;
}
export interface PaperHolding {
  qty: number;
  /** what was paid for it, fees included */
  costUsd: number;
}
export interface PaperPosition {
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  /** the margin put up (the notional over the leverage), less the loss realised by nothing yet, less the funding paid */
  marginUsd: number;
  /** the leverage it was opened at (a book from before leverage: 1) */
  leverage?: number | undefined;
  /** the funding paid out of the margin so far (negative: received), and the hour it was last settled to, ms */
  fundingUsd?: number | undefined;
  fundedAt?: number | undefined;
}
export interface PaperOrder {
  ref: string;
  clientId: string;
  symbol: string;
  side: Side;
  type: "market" | "limit";
  qty: number;
  limitPrice?: number | undefined;
  worstPrice?: number | undefined;
  tif?: "gtc" | "ioc" | undefined;
  reduceOnly?: boolean | undefined;
  status: OrderStatus;
  filledQty: number;
  avgPrice?: number | undefined;
  feeUsd?: number | undefined;
  at: string;
  updatedAt: string;
  note?: string | undefined;
}
export interface PaperFill {
  ref: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  feeUsd: number;
  at: string;
  /** a perpetual reduced: what the close realised */
  realizedUsd?: number | undefined;
  /** a settlement or a liquidation: what happened, in words */
  note?: string | undefined;
}
export interface PaperBook {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  startCashUsd: number;
  feeBps: number;
  cashUsd: number;
  holdings: Record<string, PaperHolding>;
  positions: Record<string, PaperPosition>;
  orders: Record<string, PaperOrder>;
  fills: PaperFill[];
  markets: Record<string, PaperMarketRef>;
  /** the leverage set per perpetual market (1x where none is set) */
  leverage?: Record<string, number> | undefined;
  seq: number;
}

export interface PaperRequest {
  home: string;
  /** the venue id on the account: the book's own directory */
  venue: string;
  label: string;
  /** the paper money a NEW book starts with; a book that exists keeps its own */
  cashUsd: number;
  sources: () => PublicSource[];
  clock: () => number;
}

const round = (x: number, places: number): number => Number(x.toFixed(places));
const iso = (ms: number): string => new Date(ms).toISOString();
const usd = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 8 });
const pos = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const signed = (n: number): string => `${n < 0 ? "−" : "+"}${usd(Math.abs(n))}`;

/** the words the paper account's rule is said in, wherever it shows */
export const paperRule = (feeBps: number): string =>
  `a paper account: fills at the public quote by the account's own rule — a market order at the ask or the bid, a limit order when the quote crosses it, a ${(feeBps / 100).toFixed(2)}% fee, no depth, no partial fills; a US stock at Cboe's delayed quote (15 minutes behind), only from 09:45 to 16:15 New York; perpetuals with isolated margin at the leverage set (up to the market's most), funding each hour at the source's rate, liquidated at the mark when the margin left falls to half the initial margin at the market's most leverage; event contracts marked at their price and paid out when their venue settles them. Paper money: nothing here is real`;

/** the starting paper money, as the owner wrote it in the connection's reference: nothing for the default, else dollars ("25000",
 * "$25,000") */
export function parsePaperCash(reference: string, venue: string): number | Refusal {
  const raw = reference.trim().replace(/^\$/, "").replace(/,/g, "");
  if (raw === "") return PAPER_DEFAULT_CASH;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw) || !(Number(raw) > 0)) return no("E_ACCOUNT_CREDENTIAL", { venue, message: `a paper account's starting money is a number of dollars (10000, or $25,000), not "${reference.trim().slice(0, 40)}"; leave it empty for ${usd(PAPER_DEFAULT_CASH)}`, detail: { field: "credentialRef" } });
  const cash = Number(raw);
  if (cash > PAPER_MAX_CASH) return no("E_ACCOUNT_CREDENTIAL", { venue, message: `a paper account starts with at most ${usd(PAPER_MAX_CASH)}`, detail: { field: "credentialRef", max: PAPER_MAX_CASH } });
  return cash;
}

export const paperDir = (home: string, venue: string): string => join(home, "paper", venue);
export const paperBookPath = (home: string, venue: string): string => join(paperDir(home, venue), "book.json");

function loadBook(path: string): PaperBook | undefined {
  if (!existsSync(path)) return undefined;
  const b = JSON.parse(readFileSync(path, "utf8")) as PaperBook;
  if (b?.version !== 1 || typeof b.cashUsd !== "number") throw new Error(`${path} is not a paper book this account can read`);
  return { ...b, holdings: b.holdings ?? {}, positions: b.positions ?? {}, orders: b.orders ?? {}, fills: b.fills ?? [], markets: b.markets ?? {}, leverage: b.leverage ?? {} };
}

/** the book, rewritten whole and atomically, the user's alone */
function saveBook(path: string, b: PaperBook, now: number): void {
  b.updatedAt = iso(now);
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(b, null, 1), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** a call, or nothing when it is not back in time */
function inTime<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p.catch(() => undefined), new Promise<undefined>((go) => (t = setTimeout(() => go(undefined), ms)))]).finally(() => clearTimeout(t));
}

/** what the sources list: each asked at once and given its time; a market is listed by the first source that names its symbol, and only
 * when it is priced in dollars (a dated future is not offered) */
class Pricer {
  private readonly known = new Map<string, { source: string; m: Listing; at: number }>();
  constructor(private readonly sources: () => PublicSource[], private readonly clock: () => number) {}

  async listAll(q: string, limit: number): Promise<Array<{ source: PublicSource; m: Listing }>> {
    const all = this.sources();
    const answers = await Promise.all(all.map((s) => inTime(s.listings({ ...(q ? { q } : {}), limit }), SOURCE_MS)));
    const out: Array<{ source: PublicSource; m: Listing }> = [];
    const seen = new Set<string>();
    answers.forEach((a, i) => {
      if (!Array.isArray(a)) return;
      const source = all[i]!;
      for (const m of a) {
        if (!m || typeof m.symbol !== "string" || seen.has(m.symbol) || !this.offered(m)) continue;
        seen.add(m.symbol);
        this.known.set(m.symbol, { source: source.id, m, at: this.clock() });
        out.push({ source, m });
      }
    });
    return out;
  }

  async events(o: { category?: string | undefined; closingWithinMs?: number | undefined; limit: number }): Promise<Array<{ source: PublicSource; m: Listing }>> {
    const all = this.sources().filter((s) => s.events);
    const answers = await Promise.all(all.map((s) => inTime(s.events!(o), SOURCE_MS)));
    const out: Array<{ source: PublicSource; m: Listing }> = [];
    const seen = new Set<string>();
    answers.forEach((a, i) => {
      if (!Array.isArray(a)) return;
      for (const m of a) {
        if (!m || typeof m.symbol !== "string" || seen.has(m.symbol) || !this.offered(m)) continue;
        seen.add(m.symbol);
        this.known.set(m.symbol, { source: all[i]!.id, m, at: this.clock() });
        out.push({ source: all[i]!, m });
      }
    });
    return out;
  }

  private offered(m: Listing): boolean {
    return inDollars(String(m.quote ?? "")) && m.kind !== "future";
  }

  /** the source a symbol was last listed by, if any (for a settlement asked of it after its listing has gone) */
  sourceOf(id: string): PublicSource | undefined {
    return this.sources().find((s) => s.id === id);
  }

  /** a market's listing, asked of its source now (the service keeps a listing twenty seconds, so that is how old a quote can be): from its
   * own source by its base, then by its symbol, then its source's own few; then of every source. A market no source names now is not
   * found. What is remembered here is which source lists a symbol, never a price */
  async find(symbol: string, ref: PaperMarketRef | undefined): Promise<{ source: PublicSource; m: Listing; at: number } | undefined> {
    const k = this.known.get(symbol);
    const source = this.sourceOf(ref?.source ?? k?.source ?? "");
    const base = ref?.base ?? k?.m.base ?? symbol.split(/[/:@-]/)[0] ?? symbol;
    const tries: Array<() => Promise<Listing[] | Refusal | undefined>> = source
      ? [() => inTime(source.listings({ q: base, limit: LIST_LIMIT }), SOURCE_MS), () => inTime(source.listings({ q: symbol, limit: LIST_LIMIT }), SOURCE_MS), () => inTime(source.listings({ limit: 60 }), SOURCE_MS)]
      : [];
    for (const t of tries) {
      const a = await t();
      const m = Array.isArray(a) ? a.find((x) => x?.symbol === symbol) : undefined;
      if (m && this.offered(m)) {
        const at = this.clock();
        this.known.set(symbol, { source: source!.id, m, at });
        return { source: source!, m, at };
      }
    }
    for (const q of [base, symbol]) {
      const got = (await this.listAll(q, LIST_LIMIT)).find((x) => x.m.symbol === symbol);
      if (got) return { ...got, at: this.clock() };
    }
    return undefined;
  }
}

const classOf = (kind: MarketKind, base: string): AssetClass => (kind === "event" ? "event" : kind === "token" ? "rwa" : kind === "stock" ? "equity" : isStable(base) ? "stable" : "crypto");

/** a perpetual's liquidation price under the rule above (the maintenance margin is the notional at the mark over twice the market's most
 * leverage): the mark at which the margin left equals it. None where it cannot be reached (a long whose margin covers the whole notional) */
export function liquidationPriceOf(p: Pick<PaperPosition, "side" | "qty" | "entryPrice" | "marginUsd">, maxLeverage: number): number | undefined {
  const k = 1 / (2 * Math.max(1, maxLeverage));
  if (!(p.qty > 0)) return undefined;
  const px = p.side === "long" ? (p.entryPrice * p.qty - p.marginUsd) / (p.qty * (1 - k)) : (p.entryPrice * p.qty + p.marginUsd) / (p.qty * (1 + k));
  return px > 0 ? round(px, 6) : undefined;
}

/** Open a paper account — the book in the home, continued when it exists, started with `cashUsd` when it does not — and its trader */
export async function paperSource(req: PaperRequest): Promise<{ source: LiveSource; first: LiveBalance[] } | Refusal> {
  const venue = req.venue;
  const path = paperBookPath(req.home, venue);
  const now = req.clock();
  let book: PaperBook | undefined;
  try {
    book = loadBook(path);
  } catch (err) {
    return no("E_ACCOUNT_CREDENTIAL", { venue, message: `the paper account's book could not be read: ${String((err as Error)?.message ?? err).slice(0, 160)}`, detail: { path } });
  }
  // a paper account says so in its name, whatever the owner called it
  const label = req.label.trim();
  const name = `${label || "Paper account"}${/paper/i.test(label) ? "" : " · paper"}`;
  if (!book) {
    book = { version: 1, id: venue, name, createdAt: iso(now), updatedAt: iso(now), startCashUsd: req.cashUsd, feeBps: PAPER_FEE_BPS, cashUsd: req.cashUsd, holdings: {}, positions: {}, orders: {}, fills: [], markets: {}, leverage: {}, seq: 0 };
  } else if (label) book.name = name;
  const b = book;
  try {
    saveBook(path, b, now);
  } catch (err) {
    return no("E_ACCOUNT_CREDENTIAL", { venue, message: `the paper account's book could not be written: ${String((err as Error)?.message ?? err).slice(0, 160)}`, detail: { path } });
  }
  const pricer = new Pricer(req.sources, req.clock);
  const rule = paperRule(b.feeBps);
  const save = () => saveBook(path, b, req.clock());
  /** when each held event market was last asked whether it had settled */
  const settleAsked = new Map<string, number>();

  // an event contract is named by its question and its outcome, as the holdings row says it
  const nameOf = (m: Listing): string => (m.kind === "event" && m.group?.title ? `${m.group.title} · ${m.outcome ?? m.name}` : m.name);
  const refOf = (source: PublicSource, m: Listing): PaperMarketRef => {
    const was = b.markets[m.symbol];
    return { source: source.id, kind: m.kind, base: m.base, quote: m.quote, name: nameOf(m), ...(was?.last ? { last: was.last } : {}), ...(pos(m.maxLeverage) !== undefined ? { maxLeverage: m.maxLeverage } : was?.maxLeverage ? { maxLeverage: was.maxLeverage } : {}), ...(m.closeTime ? { closeTime: m.closeTime } : was?.closeTime ? { closeTime: was.closeTime } : {}), ...(was?.closed ? { closed: true } : {}), ...(was?.settled ? { settled: was.settled } : {}) };
  };
  /** a US stock's window: Cboe's delayed quote is from inside the regular session — the only time a stock fills here */
  const stockWindow = (source: PublicSource, m: Listing, at: number): boolean => (source.id === US_STOCKS_ID ? cboeQuoteInSession(at) : (m.session?.open ?? true));
  /** the leverage a market is set to, held to the most its source shows */
  const levOf = (symbol: string, max: number): number => Math.max(1, Math.min(max, Math.floor(b.leverage?.[symbol] ?? 1)));
  /** a market as the paper account trades it: the source's own figures, the account's own steps and rule */
  const marketOf = (source: PublicSource, m: Listing): Market => {
    const perp = m.kind === "perp";
    const event = m.kind === "event";
    const stock = m.kind === "stock";
    const ownNote = typeof m.note === "string" && m.note ? ` · ${m.note}` : "";
    const { symbol, name: mname, kind, base, quote, price, bid, ask, open, changePct24h, change24h, volumeUsd24h, contracts24h, closeTime, category, group, outcome, fundingRate, nextFundingAt, implied, issuer, eligibility, session, pastEnd: _p, ...rest } = m as Listing & { pastEnd?: unknown };
    void rest;
    const at = req.clock();
    const inWindow = stock ? stockWindow(source, m, at) : true;
    const maxLeverage = perp ? Math.max(1, Math.floor(pos(m.maxLeverage) ?? 1)) : undefined;
    const stockSession = stock ? (session ?? usSession(at)) : undefined;
    const stockNote = stock && !inWindow ? ` · no market order now: a US stock fills here only from 09:45 to 16:15 New York on a market day, when Cboe's delayed quote is from inside the session; a limit order rests and waits for it` : "";
    return {
      symbol,
      name: mname,
      kind,
      base,
      quote,
      ...(pos(price) !== undefined ? { price } : {}),
      ...(pos(bid) !== undefined ? { bid } : {}),
      ...(pos(ask) !== undefined ? { ask } : {}),
      minQty: event ? 1 : (pos(m.minQty) ?? DEFAULT_QTY_STEP),
      qtyStep: event ? 1 : (pos(m.qtyStep) ?? DEFAULT_QTY_STEP),
      ...(event ? { priceStep: 0.01 } : pos(m.priceStep) !== undefined ? { priceStep: m.priceStep } : {}),
      minNotional: 1,
      open: open !== false,
      note: `${rule}${ownNote}${stockNote}`,
      types: inWindow ? ["market", "limit"] : ["limit"],
      tifs: ["gtc", "ioc"],
      tifsByType: { market: ["ioc"] },
      postOnly: false,
      ...(perp ? { reduceOnly: true, contractSize: 1, maxLeverage, marginModes: ["isolated"] } : { sellsReduce: true }),
      ...(changePct24h !== undefined ? { changePct24h } : {}),
      ...(change24h !== undefined ? { change24h } : {}),
      ...(volumeUsd24h !== undefined ? { volumeUsd24h } : {}),
      ...(contracts24h !== undefined ? { contracts24h } : {}),
      ...(closeTime ? { closeTime } : {}),
      ...(category ? { category } : {}),
      ...(group ? { group } : {}),
      ...(outcome ? { outcome } : {}),
      ...(fundingRate !== undefined ? { fundingRate } : {}),
      ...(nextFundingAt ? { nextFundingAt } : {}),
      ...(implied ? { implied } : {}),
      ...(issuer ? { issuer } : {}),
      ...(eligibility ? { eligibility } : {}),
      ...(stockSession ? { session: stockSession } : session ? { session } : {}),
    };
  };

  /** a quote for a market the book knows or the sources list: the listing's price, bid and ask, and how old it is */
  const quote = async (symbol: string): Promise<{ source: PublicSource; m: Listing; at: number } | undefined> => {
    const got = await pricer.find(symbol, b.markets[symbol]);
    if (got) {
      const ref = b.markets[symbol];
      const last = { ...(pos(got.m.price) !== undefined ? { price: got.m.price } : {}), ...(pos(got.m.bid) !== undefined ? { bid: got.m.bid } : {}), ...(pos(got.m.ask) !== undefined ? { ask: got.m.ask } : {}), at: got.at };
      if (ref) {
        ref.last = last;
        if (pos(got.m.maxLeverage) !== undefined) ref.maxLeverage = got.m.maxLeverage;
        if (got.m.closeTime) ref.closeTime = got.m.closeTime;
      }
    }
    return got;
  };

  const stateOf = (o: PaperOrder): OrderState => ({ ref: o.ref, status: o.status, filledQty: o.filledQty, ...(o.avgPrice !== undefined ? { avgPrice: o.avgPrice } : {}), ...(o.feeUsd !== undefined ? { feeUsd: o.feeUsd } : {}), native: { paper: true, book: b.id, order: o.ref, ...(o.note ? { note: o.note } : {}) } });
  const reject = (message: string): Refusal => no("E_VENUE_REJECTED", { venue, message: `${b.name}: ${message}` });
  const record = (f: PaperFill): void => {
    b.fills.push(f);
    if (b.fills.length > FILLS_KEPT) b.fills.splice(0, b.fills.length - FILLS_KEPT);
  };

  /** the fill itself: money, holdings or the position moved by the account's rule, or why the paper money is not there */
  const fill = (o: PaperOrder, px: number, now: number): Refusal | undefined => {
    const ref = b.markets[o.symbol]!;
    const notional = round(o.qty * px, 8);
    const fee = round((notional * b.feeBps) / 10_000, 6);
    let realized: number | undefined;
    if (ref.kind === "perp") {
      const p = b.positions[o.symbol];
      const opposite = !!p && ((p.side === "long" && o.side === "sell") || (p.side === "short" && o.side === "buy"));
      if (o.reduceOnly && !opposite) return reject(`reduce-only: no ${o.side === "sell" ? "long" : "short"} position in ${o.symbol} to reduce`);
      if (opposite && p) {
        if (o.qty > p.qty + 1e-12) return reject(o.reduceOnly ? `reduce-only: ${qtyText(o.qty)} is more than the ${qtyText(p.qty)} held` : `${qtyText(o.qty)} is more than the ${p.side} position of ${qtyText(p.qty)}: it would flip the side — close the position first, then open the other way`);
        const part = o.qty / p.qty;
        const margin = round(p.marginUsd * part, 6);
        realized = round((p.side === "long" ? px - p.entryPrice : p.entryPrice - px) * o.qty, 6);
        b.cashUsd = round(b.cashUsd + margin + realized - fee, 6);
        if (o.qty >= p.qty - 1e-12) delete b.positions[o.symbol];
        else {
          p.qty = round(p.qty - o.qty, 12);
          p.marginUsd = round(p.marginUsd - margin, 6);
        }
      } else {
        const lev = p?.leverage ?? levOf(o.symbol, ref.maxLeverage ?? 1);
        const margin = round(notional / lev, 6);
        if (b.cashUsd + 1e-9 < margin + fee) return no("E_VENUE_INSUFFICIENT", { venue, message: `${b.name}: not enough paper money — ${usd(margin + fee)} needed as margin and fee at ${lev}x, ${usd(b.cashUsd)} there` });
        b.cashUsd = round(b.cashUsd - margin - fee, 6);
        if (p) {
          p.entryPrice = round((p.entryPrice * p.qty + px * o.qty) / (p.qty + o.qty), 10);
          p.qty = round(p.qty + o.qty, 12);
          p.marginUsd = round(p.marginUsd + margin, 6);
        } else b.positions[o.symbol] = { side: o.side === "buy" ? "long" : "short", qty: o.qty, entryPrice: px, marginUsd: margin, leverage: lev, fundingUsd: 0, fundedAt: now };
      }
    } else if (o.side === "buy") {
      if (b.cashUsd + 1e-9 < notional + fee) return no("E_VENUE_INSUFFICIENT", { venue, message: `${b.name}: not enough paper money — ${usd(notional + fee)} needed, ${usd(b.cashUsd)} there` });
      b.cashUsd = round(b.cashUsd - notional - fee, 6);
      const h = b.holdings[o.symbol] ?? { qty: 0, costUsd: 0 };
      h.qty = round(h.qty + o.qty, 12);
      h.costUsd = round(h.costUsd + notional + fee, 6);
      b.holdings[o.symbol] = h;
    } else {
      const h = b.holdings[o.symbol];
      if (!h || h.qty + 1e-12 < o.qty) return no("E_VENUE_INSUFFICIENT", { venue, message: `${b.name}: a sell sells only what the paper account holds — ${qtyText(h?.qty ?? 0)} ${ref.base} held, ${qtyText(o.qty)} asked` });
      b.cashUsd = round(b.cashUsd + notional - fee, 6);
      const part = o.qty / h.qty;
      h.costUsd = round(h.costUsd * (1 - part), 6);
      h.qty = round(h.qty - o.qty, 12);
      if (h.qty <= 1e-12) delete b.holdings[o.symbol];
    }
    o.status = "filled";
    o.filledQty = o.qty;
    o.avgPrice = px;
    o.feeUsd = fee;
    o.updatedAt = iso(now);
    record({ ref: o.ref, symbol: o.symbol, side: o.side, qty: o.qty, price: px, feeUsd: fee, at: iso(now), ...(realized !== undefined ? { realizedUsd: realized } : {}) });
    return undefined;
  };

  /** a resting limit order, judged against a fresh quote: filled at its limit when the quote crosses it, rejected when the paper money is
   * not there then, left as it is otherwise. A US stock's is judged only inside its window. True when the book changed */
  const tryFill = async (o: PaperOrder): Promise<boolean> => {
    if (o.status !== "open" || o.type !== "limit" || o.limitPrice === undefined) return false;
    const q = await quote(o.symbol);
    if (!q) return false;
    if (q.m.kind === "stock" && !stockWindow(q.source, q.m, q.at)) return false;
    const px = o.side === "buy" ? (pos(q.m.ask) ?? pos(q.m.price)) : (pos(q.m.bid) ?? pos(q.m.price));
    if (px === undefined) return false;
    const crossed = o.side === "buy" ? px <= o.limitPrice : px >= o.limitPrice;
    if (!crossed) return false;
    const now = req.clock();
    const r = fill(o, o.limitPrice, now);
    if (r) {
      o.status = "rejected";
      o.note = r.message;
      o.updatedAt = iso(now);
    }
    return true;
  };

  /** the funding rate of a perpetual's quote per hour: Hyperliquid's as it is, another venue's an eighth of its interval's */
  const hourlyFunding = (source: PublicSource, m: Listing): number | undefined => {
    const r = m.fundingRate;
    if (typeof r !== "number" || !Number.isFinite(r)) return undefined;
    return HOURLY_FUNDING.test(source.id) ? r : r / FUNDING_INTERVAL_HOURS;
  };
  /** every perpetual position marked: the funding of each whole hour since it was last settled paid out of the margin, and the position
   * liquidated at the mark when the margin left has fallen to the maintenance margin. True when the book changed */
  const markPerps = async (now: number): Promise<boolean> => {
    let changed = false;
    for (const [symbol, p] of Object.entries(b.positions)) {
      const ref = b.markets[symbol];
      const q = await quote(symbol);
      const mark = pos(q?.m.price) ?? ref?.last?.price;
      if (mark === undefined) continue;
      const notional = mark * p.qty;
      const rate = q ? hourlyFunding(q.source, q.m) : undefined;
      const fundedAt = p.fundedAt ?? now;
      const hours = Math.floor((now - fundedAt) / HOUR);
      if (hours > 0) {
        if (rate !== undefined && rate !== 0) {
          // the long pays when the rate is above zero, the short receives; the other way round below zero
          const paid = round(notional * rate * hours * (p.side === "long" ? 1 : -1), 6);
          p.marginUsd = round(p.marginUsd - paid, 6);
          p.fundingUsd = round((p.fundingUsd ?? 0) + paid, 6);
        }
        p.fundedAt = fundedAt + hours * HOUR;
        changed = true;
      }
      const maxLeverage = Math.max(1, ref?.maxLeverage ?? pos(q?.m.maxLeverage) ?? 1);
      const pnl = (p.side === "long" ? mark - p.entryPrice : p.entryPrice - mark) * p.qty;
      const left = p.marginUsd + pnl;
      const maintenance = notional / (2 * maxLeverage);
      if (left <= maintenance + 1e-9) {
        const fee = round((notional * b.feeBps) / 10_000, 6);
        const back = round(Math.max(0, left - fee), 6);
        b.cashUsd = round(b.cashUsd + back, 6);
        const o: PaperOrder = { ref: `p${++b.seq}`, clientId: `liquidation-${b.seq}`, symbol, side: p.side === "long" ? "sell" : "buy", type: "market", qty: p.qty, reduceOnly: true, status: "filled", filledQty: p.qty, avgPrice: mark, feeUsd: fee, at: iso(now), updatedAt: iso(now), note: `liquidated at the mark (${plain(mark)}): the margin left (${usd(left)}) fell to the maintenance margin (${usd(maintenance)}); ${usd(back)} went back to cash` };
        b.orders[o.ref] = o;
        record({ ref: o.ref, symbol, side: o.side, qty: p.qty, price: mark, feeUsd: fee, at: iso(now), realizedUsd: round(pnl, 6), note: o.note });
        delete b.positions[symbol];
        changed = true;
      }
    }
    return changed;
  };

  /** every event contract held: once its venue says the market has settled, paid out at what the venue paid and taken off the book; a
   * market closed and not settled is marked so. Asked at most every minute past the market's close, every ten minutes before it (a market
   * may settle early). True when the book changed */
  const settleEvents = async (now: number): Promise<boolean> => {
    let changed = false;
    for (const [symbol, h] of Object.entries(b.holdings)) {
      const ref = b.markets[symbol];
      if (!ref || ref.kind !== "event" || !(h.qty > 0)) continue;
      const source = pricer.sourceOf(ref.source);
      if (!source?.settlement) continue;
      const closeMs = ref.closeTime ? Date.parse(ref.closeTime) : NaN;
      const every = Number.isFinite(closeMs) && now < closeMs ? SETTLE_BEFORE_CLOSE_MS : SETTLE_AFTER_CLOSE_MS;
      const asked = settleAsked.get(symbol);
      if (asked !== undefined && now - asked < every) continue;
      settleAsked.set(symbol, now);
      const s = await inTime(source.settlement(symbol), SOURCE_MS);
      if (!s || isRefusal(s)) continue;
      if (!s.settled) {
        if (s.closed && !ref.closed) {
          ref.closed = true;
          changed = true;
        }
        continue;
      }
      const paid = round(h.qty * s.payout, 6);
      b.cashUsd = round(b.cashUsd + paid, 6);
      const o: PaperOrder = { ref: `p${++b.seq}`, clientId: `settlement-${b.seq}`, symbol, side: "sell", type: "market", qty: h.qty, status: "filled", filledQty: h.qty, avgPrice: s.payout, feeUsd: 0, at: iso(now), updatedAt: iso(now), note: `settled by ${source.name}: ${usd(s.payout)} a contract${s.payout >= 1 ? " to this side, which won" : s.payout <= 0 ? " — this side lost" : ""}, ${usd(paid)} for ${qtyText(h.qty)}` };
      b.orders[o.ref] = o;
      record({ ref: o.ref, symbol, side: "sell", qty: h.qty, price: s.payout, feeUsd: 0, at: iso(now), realizedUsd: round(paid - h.costUsd, 6), note: o.note });
      ref.settled = { payout: s.payout, at: s.at ?? iso(now) };
      delete ref.closed;
      delete b.holdings[symbol];
      changed = true;
    }
    return changed;
  };

  let settling: Promise<void> | undefined;
  /** every resting order judged, every position marked and every held contract's settlement asked, once at a time: a second look while one
   * is under way waits for it */
  const settle = (): Promise<void> => {
    if (settling) return settling;
    const run = (async () => {
      let changed = false;
      for (const o of Object.values(b.orders)) changed = (await tryFill(o)) || changed;
      const now = req.clock();
      changed = (await markPerps(now)) || changed;
      changed = (await settleEvents(now)) || changed;
      if (changed) save();
    })();
    settling = run.finally(() => {
      settling = undefined;
    });
    return settling;
  };

  const read = async (): Promise<LiveBalance[]> => {
    await settle();
    const out: LiveBalance[] = [{ asset: "USD", amount: round(b.cashUsd, 2), usd: round(b.cashUsd, 2), where: "paper money", class: "cash" }];
    for (const [symbol, h] of Object.entries(b.holdings)) {
      const ref = b.markets[symbol];
      if (!ref || !(h.qty > 0)) continue;
      const q = await quote(symbol);
      const price = pos(q?.m.price) ?? pos(q?.m.bid) ?? ref.last?.price ?? ref.last?.bid;
      const asset = ref.kind === "event" ? symbol : ref.base;
      const from = q ? (q.m.venueName ?? q.source.name) : ref.source;
      const state = ref.kind === "event" && ref.closed ? " · closed, waiting for its settlement" : "";
      out.push({ asset, amount: h.qty, ...(price !== undefined ? { usd: round(h.qty * price, 2) } : {}), where: `paper · ${ref.kind === "event" ? ref.name : `${symbol} from ${from}`}${state}`, class: classOf(ref.kind, ref.base) });
    }
    for (const [symbol, p] of Object.entries(b.positions)) {
      const ref = b.markets[symbol];
      const q = await quote(symbol);
      const mark = pos(q?.m.price) ?? ref?.last?.price;
      const pnl = mark !== undefined ? round((p.side === "long" ? mark - p.entryPrice : p.entryPrice - mark) * p.qty, 2) : 0;
      const worth = round(p.marginUsd + pnl, 2);
      const funding = p.fundingUsd ? ` · ${signed(-p.fundingUsd)} funding` : "";
      out.push({ asset: "USD", amount: worth, usd: worth, where: `paper margin · ${p.side} ${qtyText(p.qty)} ${symbol} · ${p.leverage ?? 1}x${mark !== undefined ? ` · ${signed(pnl)} unrealised` : " · unmarked"}${funding}`, class: "cash" });
    }
    return out;
  };

  const trader: LiveTrader = {
    can: true,
    what: "paper trading in the public markets: US stocks, coins, perpetuals with leverage, tokenised shares, event contracts",
    kinds: ["spot", "perp", "event", "token", "stock"],

    /** the markets to start from: what every source lists before anything is typed (each source's own few, as Markets reads them), the
     * sources in turn — a coin, a perpetual, a stock, a token, a contract … — so every market Markets shows carries this account's line;
     * a query: every match */
    async markets(q) {
      const Q = q.trim();
      const got = await pricer.listAll(Q, LIST_LIMIT);
      // a query: every match, the market whose symbol or base IS the words first (AAPL the share before "aapl-close-above-350…:Yes")
      if (Q) {
        const exact = (m: Market): number => (m.symbol.toUpperCase() === Q.toUpperCase() || m.base.toUpperCase() === Q.toUpperCase() ? 0 : 1);
        return pick(got.map(({ source, m }) => marketOf(source, m)), Q).sort((a, b) => exact(a) - exact(b));
      }
      const bySource = new Map<string, Array<{ source: PublicSource; m: Listing }>>();
      for (const x of got) bySource.set(x.source.id, [...(bySource.get(x.source.id) ?? []), x]);
      const lists = [...bySource.values()];
      const out: Market[] = [];
      for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(marketOf(l[i]!.source, l[i]!.m));
      return out;
    },

    async market(symbol) {
      const q = await quote(symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source lists ${symbol.slice(0, 60)} just now, so it has no price here` });
      return marketOf(q.source, q.m);
    },

    async place(o: OrderRequest) {
      const was = Object.values(b.orders).find((x) => x.clientId === o.clientId);
      if (was) return stateOf(was);
      if (o.type !== "market" && o.type !== "limit") return badOrder(venue, b.name, `it takes market and limit orders, not ${String(o.type).replace("_", "-")} orders`);
      if (o.stopPrice !== undefined) return badOrder(venue, b.name, "a stop price belongs to a stop order, which a paper account does not take");
      if (o.postOnly) return badOrder(venue, b.name, "post-only is not offered: a paper account has no book to rest on");
      if (o.tif !== undefined && o.tif !== "gtc" && o.tif !== "ioc") return badOrder(venue, b.name, `it takes gtc and ioc, not ${o.tif}`);
      if (!(Number.isFinite(o.qty) && o.qty > 0)) return badOrder(venue, b.name, "a size is more than zero");
      if (o.type === "limit" ? !(o.limitPrice !== undefined && o.limitPrice > 0) : o.limitPrice !== undefined) return badOrder(venue, b.name, o.type === "limit" ? "a limit order has a limit price" : "a market order has no limit price");
      const q = await quote(o.symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source prices ${o.symbol.slice(0, 60)} just now, so nothing is filled` });
      const m = marketOf(q.source, q.m);
      if (!m.open) return no("E_VENUE_MARKET_CLOSED", { venue, message: `${b.name}: ${m.name} takes no orders now${q.m.note ? ` (${q.m.note})` : ""}` });
      if (!onStep(o.qty, m.qtyStep)) return badOrder(venue, b.name, `a size in ${m.name} moves in steps of ${plain(m.qtyStep ?? 1)}`, { qty: o.qty, qtyStep: m.qtyStep });
      if (o.reduceOnly && m.kind !== "perp") return badOrder(venue, b.name, `reduce-only is for a perpetual: ${m.name} sells only what is held`);
      const inWindow = m.kind === "stock" ? stockWindow(q.source, q.m, q.at) : true;
      if (o.type === "market" && !inWindow) return no("E_VENUE_MARKET_CLOSED", { venue, message: `${b.name}: no market order in ${m.name} now — a US stock fills here only from 09:45 to 16:15 New York on a market day, when Cboe's delayed quote is from inside the session; a limit order rests and waits for it` });
      b.markets[o.symbol] = { ...refOf(q.source, q.m), last: { ...(pos(q.m.price) !== undefined ? { price: q.m.price } : {}), ...(pos(q.m.bid) !== undefined ? { bid: q.m.bid } : {}), ...(pos(q.m.ask) !== undefined ? { ask: q.m.ask } : {}), at: q.at } };
      const now = req.clock();
      const order: PaperOrder = { ref: `p${++b.seq}`, clientId: o.clientId, symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, ...(o.limitPrice !== undefined ? { limitPrice: o.limitPrice } : {}), ...(o.worstPrice !== undefined ? { worstPrice: o.worstPrice } : {}), ...(o.tif ? { tif: o.tif } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}), status: "open", filledQty: 0, at: iso(now), updatedAt: iso(now) };
      const quoted = o.side === "buy" ? (pos(q.m.ask) ?? pos(q.m.price)) : (pos(q.m.bid) ?? pos(q.m.price));
      if (quoted === undefined) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: ${m.name} shows no ${o.side === "buy" ? "ask" : "bid"} just now` });
      if (o.type === "market") {
        // the account's worst price holds here as a marketable limit does: a quote past it fills nothing
        if (o.worstPrice !== undefined && (o.side === "buy" ? quoted > o.worstPrice + 1e-12 : quoted < o.worstPrice - 1e-12)) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: the quote (${plain(quoted)}) is past the worst price the order allows (${plain(o.worstPrice)}): nothing was filled`, detail: { quoted, worstPrice: o.worstPrice } });
        const r = fill(order, quoted, now);
        if (r) return r;
        b.orders[order.ref] = order;
        save();
        return stateOf(order);
      }
      const crossed = inWindow && (o.side === "buy" ? quoted <= o.limitPrice! : quoted >= o.limitPrice!);
      if (crossed) {
        const r = fill(order, o.limitPrice!, now);
        if (r) return r;
      } else if (o.tif === "ioc") {
        order.status = "canceled";
        order.note = inWindow ? "ioc: the quote did not cross the limit, nothing filled" : "ioc: out of the stock's window, nothing filled";
      } else if (!inWindow) order.note = "resting until 09:45 New York on a market day, when a US stock is judged here";
      b.orders[order.ref] = order;
      save();
      return stateOf(order);
    },

    async cancel(ref) {
      const o = b.orders[ref];
      if (!o) return no("E_ACCOUNT_ORDER_UNKNOWN", { venue, message: `${b.name} has no order ${ref}`, detail: { order: ref } });
      if (o.status === "open") {
        o.status = "canceled";
        o.updatedAt = iso(req.clock());
        save();
      }
      return stateOf(o);
    },

    async status(ref) {
      const o = b.orders[ref];
      if (!o) return no("E_ACCOUNT_ORDER_UNKNOWN", { venue, message: `${b.name} has no order ${ref}`, detail: { order: ref } });
      await settle();
      return stateOf(o);
    },

    async positions() {
      await settle();
      const out: Position[] = [];
      for (const [symbol, p] of Object.entries(b.positions)) {
        const ref = b.markets[symbol];
        const q = await quote(symbol);
        const mark = pos(q?.m.price) ?? ref?.last?.price;
        const pnl = mark !== undefined ? round((p.side === "long" ? mark - p.entryPrice : p.entryPrice - mark) * p.qty, 6) : undefined;
        const maxLeverage = Math.max(1, ref?.maxLeverage ?? pos(q?.m.maxLeverage) ?? 1);
        const liq = liquidationPriceOf(p, maxLeverage);
        out.push({ symbol, name: ref?.name ?? symbol, kind: "perp", side: p.side, qty: p.qty, entryPrice: p.entryPrice, ...(mark !== undefined ? { markPrice: mark, usd: round(p.qty * mark, 2) } : {}), ...(pnl !== undefined ? { unrealizedUsd: pnl } : {}), leverage: p.leverage ?? 1, marginMode: "isolated", ...(liq !== undefined ? { liquidationPrice: liq } : {}), native: { paper: true, book: b.id, marginUsd: p.marginUsd, fundingUsd: p.fundingUsd ?? 0, maxLeverage } });
      }
      return out;
    },

    /** a perpetual's leverage, isolated: set for the market, and — where a position is open — its margin moved to the new leverage's
     * initial margin (more margin taken from cash, or given back to it) */
    async setLeverage(symbol, leverage, marginMode) {
      if (marginMode === "cross") return badOrder(venue, b.name, "a paper account keeps isolated margin: each position's own margin, and nothing more, is at risk");
      if (!(Number.isInteger(leverage) && leverage >= 1)) return badOrder(venue, b.name, "leverage is a whole number, 1 or more");
      const q = await quote(symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source lists ${symbol.slice(0, 60)} just now` });
      const m = marketOf(q.source, q.m);
      if (m.kind !== "perp") return badOrder(venue, b.name, `leverage is set on a perpetual: ${m.name} is ${m.kind}`);
      const max = m.maxLeverage ?? 1;
      if (leverage > max) return no("E_VENUE_ORDER_INVALID", { venue, message: `${b.name}: ${m.name} takes at most ${max}x (what its source shows)`, detail: { maxLeverage: max } });
      const p = b.positions[symbol];
      if (p) {
        const was = p.leverage ?? 1;
        const delta = round((p.entryPrice * p.qty) / leverage - (p.entryPrice * p.qty) / was, 6);
        if (delta > 0 && b.cashUsd + 1e-9 < delta) return no("E_VENUE_INSUFFICIENT", { venue, message: `${b.name}: ${leverage}x on the open position needs ${usd(delta)} more margin, ${usd(b.cashUsd)} there` });
        b.cashUsd = round(b.cashUsd - delta, 6);
        p.marginUsd = round(p.marginUsd + delta, 6);
        p.leverage = leverage;
      }
      b.markets[symbol] = refOf(q.source, q.m);
      b.leverage = { ...(b.leverage ?? {}), [symbol]: leverage };
      save();
      return { leverage, marginMode: "isolated", native: { paper: true, book: b.id, symbol, leverage, maxLeverage: max, ...(p ? { marginUsd: p.marginUsd } : {}) } };
    },

    async stats(symbols) {
      const out = new Map<string, MarketStats>();
      for (const s of symbols ?? Object.keys(b.markets)) {
        const q = await quote(s);
        if (q) out.set(s, { price: q.m.price, changePct24h: q.m.changePct24h, change24h: q.m.change24h, volumeUsd24h: q.m.volumeUsd24h });
      }
      return out;
    },

    async events(o) {
      return (await pricer.events(o)).map(({ source, m }) => marketOf(source, m));
    },

    async candles(symbol, interval, sinceMs) {
      if (!CANDLE_INTERVALS.includes(interval)) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: price history comes in bars of 5m, 1h and 1d` });
      const q = await quote(symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source lists ${symbol.slice(0, 60)} just now` });
      if (!q.source.candles) return no("E_VENUE_RAIL_CLOSED", { venue, message: `${b.name}: ${q.source.name} keeps no price history the account can read` });
      const bars = await q.source.candles(symbol, interval, sinceMs);
      return isRefusal(bars) ? bars : (bars as Candle[]);
    },
  };

  let first: LiveBalance[];
  try {
    first = await read();
  } catch (err) {
    return no("E_VENUE_UNREACHABLE", { venue, message: `${b.name}: its holdings could not be priced just now: ${String((err as Error)?.message ?? err).slice(0, 160)}` });
  }
  const source: LiveSource = {
    name: b.name,
    kind: "cex",
    reference: `paper/${venue}/book.json`,
    via: "Paper account · the account's own book, priced at the public quotes Markets reads without a key",
    probe: { can: ["read", "trade"], note: `${rule} · started with ${usd(b.startCashUsd)} of paper money on ${b.createdAt.slice(0, 10)}`, native: { paper: true, book: path, startCashUsd: b.startCashUsd, feeBps: b.feeBps, createdAt: b.createdAt } },
    read,
    readOnlyBecause: "paper money: nothing moves in or out of a paper account",
    trader,
    paper: true,
  };
  return { source, first };
}
