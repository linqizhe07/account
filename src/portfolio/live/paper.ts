/** A PAPER ACCOUNT the account keeps itself (the connector live:paper): paper dollars, every market the public sources list, fills by the
 * account's own declared rule, a book in the home. Nothing to connect, so it is the account's way in for someone with no wallet, no
 * exchange account and no key: the first flight, with every door, limit, card and statement line the real thing has, and no money. It is
 * the account's own paper broker, as Alpaca's paper account is Alpaca's: US shares in every session the public quotes cover — pre-market,
 * the regular session, after-hours, overnight — coins and perpetuals around the clock, event contracts until they settle.
 *
 * What it is made of:
 *   prices    the public market data Markets reads without a key (public-markets.ts: the exchanges' tickers, Hyperliquid's perpetuals,
 *             Kalshi's, Polymarket's and Polymarket US's event contracts, Robinhood's Stock Tokens, xStocks at Gate and Ondo Stocks
 *             (public-rwa.ts), US stocks (public-stocks.ts: real-time quotes where a public source gives them, Cboe's delayed file
 *             behind them), the pre-IPO perpetuals). A market is listed here under the symbol its source lists it by (`BTC/USD` from
 *             Kraken, `BTC-PERP` from Hyperliquid, `AAPL`, a Kalshi ticker); where two sources list the same symbol, the first in the sources' order speaks for it (the US stock line comes
 *             before Robinhood's Stock Tokens, so `NVDA` here is the share, not the token). A quote is the source's listing, at most as
 *             old as the service keeps a listing (twenty seconds), and a stock's carries its own time and its source's delay. A market the
 *             book has traded is its source's alone: when that source does not answer, the market has no quote, and no other source's
 *             market of the same symbol stands in for it
 *   orders    market, limit, stop (a market order once the price reaches the stop), stop-limit (a limit order once it does) and trailing
 *             stop (a stop a percent or a price behind the best price since it was placed, moving with it) — an event contract takes
 *             market and limit orders only; a time in force of good-till-canceled, immediate-or-cancel or fill-or-kill (the same thing
 *             here: nothing fills in part), and for a stock DAY, which ends with the market's session (the regular one's close, or the
 *             extended one's for an order sent for extended hours), a stock's default; and a BRACKET: an entry with its exits, a
 *             take-profit limit and a stop-loss stop placed the moment it fills, the one that fills canceling the other. Exits go with
 *             their position: canceled once it is closed, sold, liquidated or settled (on a perpetual, every reduce-only order with them),
 *             and one larger than what is left closes what is left
 *   fills     the account's OWN RULE, said everywhere it shows: a market order fills at once, whole, at the ask (a buy) or the bid (a sell),
 *             inside the worst price the account's door gave it; a limit order that crosses the quote when it is placed fills at once at the
 *             quote (where that is better than its limit), one that rests fills at its limit when the quote reaches it (a bracket's
 *             take-profit beyond its entry's fill rests from the moment it is placed; a stock's rest lasts the session it rested in, and
 *             no further) — and one that never rested (past the quote the moment
 *             it was changed, triggered, placed as a bracket's exit after a gap, or let back into its session or out of a halt) takes the
 *             quote as one crossing when placed does; a stop triggers when the bid (a sell) or the ask (a buy) reaches
 *             it. A market its source says takes no orders now (a halt, a contract no longer active) fills nothing. Resting orders are judged
 *             whenever the account looks — a read, a poll, the positions, and the service's own look every few seconds — at the quote of
 *             that moment: no depth, no partial fills, no slippage past the quote, no queue. Nothing is reserved for a resting order: it is
 *             judged when it fills, and rejected then if the paper money (or the holding) is not there.
 *             A STOCK fills only at a quote stamped inside a session the order trades in, while its market is in that session as its
 *             source sees it: the regular session for every order; pre-market, after-hours and overnight (New York) for a limit order sent
 *             for extended hours where the market's session takes one. A quote older than its source's delay and QUOTE_GRACE_MS fills
 *             nothing. A market order out of the session is QUEUED for it (as a broker holds
 *             one for the open) — one sent immediate-or-cancel is canceled instead; stops on a stock are watched in the regular session
 *             only. Charges: a US share none (no commission, as a broker charges none); everything else `feeBps` of the notional (0.10%)
 *   holdings  a coin, a token, a share or an event contract bought is held and sold only as far as it is held (no shorting them, no
 *             margin on them). A PERPETUAL is a position, long or short, with ISOLATED margin at
 *             the leverage set for the market (1x unless set, up to the most the market's source shows): the notional over the leverage
 *             is put up as margin, the unrealised profit is marked at the quote, a close (reduce-only, or the opposite side up to the
 *             position) realises it; the side is never flipped by one order. The margin is all a position can lose: a close past it gives
 *             nothing back and takes nothing from the cash, and a part closed past its own share of the margin takes the rest of its loss
 *             out of the margin of what is left. Each look marks the perpetuals before it judges the orders.
 *             FUNDING is paid or received out of the margin each whole hour the position stands, at the rate the source shows when the
 *             account looks, or when an order fills on the position before it moves it (Hyperliquid's rate is hourly; another venue's is
 *             for its eight-hour interval, so an eighth of it an hour), on
 *             the notional at the mark, the long paying when the rate is above zero; a market whose source shows no rate pays none.
 *             LIQUIDATION: when the margin left — the margin put up, less the loss and the funding paid — falls to the maintenance margin,
 *             half the initial margin at the market's most leverage (the notional at the mark over twice that leverage), the position is
 *             closed at the mark, what is left of the margin after the fee goes back to cash, and the fill says "liquidated". At 1x a long
 *             cannot be liquidated; a short at 1x is, once the price has risen by a third (as at a venue that keeps that rule).
 *             An EVENT CONTRACT is marked at its price and, once its venue says the market has settled (public-markets.ts `settlement`),
 *             paid out at what its venue paid — $1 a contract to the side that won, nothing to the other — and taken off the book; a
 *             market that has closed and not settled is said to be waiting. A venue that does not say settlements never settles here
 *   the book  <home>/paper/<venue>/book.json, the user's alone (0600), rewritten atomically after every change: cash, holdings (with
 *             what they cost), positions (with their leverage and the funding paid), the leverage set per market, every order (never
 *             pruned: the book's past is told again from them, paper-history.ts), the last 500 fills (a settlement, a liquidation and a
 *             bracket's exit are fills with a note), the funding settled hour by hour, and each traded market's source. Connecting the
 *             same venue id again continues the book; another id is another account — several can be open at once, each its own venue
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
import { usClock } from "../account/calendar.ts";
import { CBOE_DELAY_MS, cboeQuoteInSession, US_STOCKS_ID, usSession } from "./public-stocks.ts";
import { badOrder, CANDLE_INTERVALS, inDollars, onStep, pick, plain, type Candle, type CandleInterval, type LiveTrader, type Market, type MarketKind, type MarketStats, type OrderRequest, type OrderState, type OrderStatus, type OrderType, type Position, type SessionPhase, type Side, type TimeInForce } from "./trade.ts";
import { isStable, type LiveBalance, type LiveSource } from "./types.ts";

export const PAPER_DEFAULT_CASH = 10_000;
export const PAPER_MAX_CASH = 100_000_000;
export const PAPER_FEE_BPS = 10;
/** how long one source has to answer a listing */
const SOURCE_MS = 4_000;
const LIST_LIMIT = 40;
const FILLS_KEPT = 500;
/** the funding settlements kept in the book, hour by hour: a year of one position */
const FUNDING_KEPT = 10_000;
const DEFAULT_QTY_STEP = 0.000001;
const HOUR = 3_600_000;
/** how often an event market the account holds is asked whether it has settled: every minute once past its close, every ten before it
 * (a market may settle early) */
const SETTLE_AFTER_CLOSE_MS = 60_000;
const SETTLE_BEFORE_CLOSE_MS = 600_000;
/** the sources whose funding rate is hourly (Hyperliquid's); another perpetual venue's rate is for an eight-hour interval */
const HOURLY_FUNDING = /^hyperliquid/;
/** how much older than its source's own delay a stock's quote may be and still fill: a quote that stopped moving (a halt, a feed gone
 * quiet, the last trade of a session hours ago) fills nothing. A last-trade stamp of a quiet share can be minutes old in session */
const QUOTE_GRACE_MS = 15 * 60_000;

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
  type: OrderType;
  qty: number;
  limitPrice?: number | undefined;
  worstPrice?: number | undefined;
  /** a stop or a stop-limit: where it triggers; a trailing stop: where it triggers now (it moves with `hwm`) */
  stopPrice?: number | undefined;
  /** a trailing stop: its trail, in percent or in the market's quote, and the best price since it was placed (the highest for a sell, the
   * lowest for a buy) */
  trailPercent?: number | undefined;
  trailPrice?: number | undefined;
  hwm?: number | undefined;
  /** a stop that has triggered: from then on it is the market (or limit) order it became */
  triggeredAt?: string | undefined;
  /** a limit (or a stop-limit that has triggered) that has RESTED: judged at a quote that could fill it and did not reach it. From then on
   * it is the book's maker and fills at its own price when the quote reaches it; one that never rested — past the quote the moment it was
   * placed, changed or triggered, or let back into its session — takes the quote where that is better than its limit. Its market out of
   * session, or taking no orders, it rests no more; a quote that only stopped moving while the market is in session leaves it resting. A
   * bracket's take-profit beyond its entry's fill rests from birth */
  rested?: true | undefined;
  /** a stock's rest: the end of the session it rested in (the regular close, or for an order sent for extended hours the end of
   * after-hours, on its market's own clock, no line's delay in it). A rest is that session's alone: once the market as a quote sees it (the
   * quote's line's delay behind) is past it — whether or not a look fell between the close and the next open — it rests no more, and a
   * quote already past its limit at the open takes the quote. None for a market that never closes */
  restedTill?: string | undefined;
  tif?: TimeInForce | undefined;
  /** a DAY order: when its session ends, and it with it */
  expiresAt?: string | undefined;
  reduceOnly?: boolean | undefined;
  /** a limit order sent for the extended session (a US stock's pre-market, after-hours, overnight) */
  extendedHours?: boolean | undefined;
  /** an entry with exits (a bracket): the take-profit limit and the stop-loss stop placed once it fills, and their refs once placed */
  takeProfit?: number | undefined;
  stopLoss?: number | undefined;
  children?: string[] | undefined;
  /** an exit of a bracket: its entry, and the other exit (the one that fills cancels the other) */
  parent?: string | undefined;
  oco?: string | undefined;
  status: OrderStatus;
  filledQty: number;
  avgPrice?: number | undefined;
  feeUsd?: number | undefined;
  /** when it filled */
  filledAt?: string | undefined;
  /** a perpetual's close (or its liquidation) whose loss, with the fee, went past the position's own margin: the part isolated margin did
   * not take, so the cash moved by that much less than the price says (paper-history.ts can add it back). A liquidation always says it: 0,
   * nothing past the margin — so the book's past tells a liquidation the margin covered from one written before the figure was (none) */
  lossPastMarginUsd?: number | undefined;
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
  /** the funding each perpetual paid (above zero) or received (below) out of its margin, hour by hour as it was settled — the last
   * FUNDING_KEPT — so the book's past can be told again exactly (paper-history.ts). A book from before it has none */
  funding?: Array<{ at: string; symbol: string; usd: number }> | undefined;
  seq: number;
}

/** a quote as the paper account reads it: its source, its listing and when it was read */
type Quoted = { source: PublicSource; m: Listing; at: number };

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
  `a paper account: fills at the public quote by the account's own rule — a market order at the ask or the bid, a limit order when the quote crosses it (at the quote when it crosses at once, at its limit once it rested), a stop when the price reaches it; no depth, no partial fills; a stock only at a quote from inside its session — the regular session, or for a limit order sent for extended hours the pre-market, after-hours or overnight session where it is offered — a market order out of the session queued for it; US shares no commission, everything else a ${(feeBps / 100).toFixed(2)}% fee; perpetuals with isolated margin at the leverage set (up to the market's most), funding each hour at the source's rate, liquidated at the mark when the margin left falls to half the initial margin at the market's most leverage; event contracts marked at their price and paid out when their venue settles them. Paper money: nothing here is real`;

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

export function loadBook(path: string): PaperBook | undefined {
  if (!existsSync(path)) return undefined;
  const b = JSON.parse(readFileSync(path, "utf8")) as PaperBook;
  if (b?.version !== 1 || typeof b.cashUsd !== "number") throw new Error(`${path} is not a paper book this account can read`);
  // a name written before a paper account's name was said once ("Paper account · paper") reads as it would be written now
  const name = typeof b.name === "string" ? b.name.replace(/^(.*paper.*) · paper$/i, "$1") : b.name;
  return { ...b, name, holdings: b.holdings ?? {}, positions: b.positions ?? {}, orders: b.orders ?? {}, fills: b.fills ?? [], markets: b.markets ?? {}, leverage: b.leverage ?? {} };
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

  /** which source a symbol is remembered by. Two sources may name the same symbol (the US share NVDA and Robinhood's Stock Token NVDA):
   * the one first in the account's own order keeps it, whichever answered last, so a source that was slow to answer once (the share's line
   * at startup) takes its symbol back when it answers, and the other never takes it from it again — a market asked by that symbol is the
   * same market every time */
  private remember(symbol: string, source: string, m: Listing): void {
    const was = this.known.get(symbol);
    if (was && was.source !== source) {
      const order = this.sources().map((s) => s.id);
      const [mine, theirs] = [order.indexOf(source), order.indexOf(was.source)];
      if (theirs !== -1 && (mine === -1 || theirs < mine)) return;
    }
    this.known.set(symbol, { source, m, at: this.clock() });
  }

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
        this.remember(m.symbol, source.id, m);
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
        this.remember(m.symbol, all[i]!.id, m);
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
   * own source by its base, then by its symbol, then its source's own few. A market whose source is known (the book's, or the one that
   * listed it) and still read is that source's alone: when it does not answer, or lists it no more, the market has no quote now — another
   * source's market of the same symbol (Robinhood's Stock Token NVDA for the share NVDA) never stands in for it. Only a market with no such
   * source is asked of every source, and one the book holds only as the kind it holds. A market no source names now is not found. What
   * is remembered here is which source lists a symbol, never a price */
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
    if (source) return undefined;
    for (const q of [base, symbol]) {
      const got = (await this.listAll(q, LIST_LIMIT)).find((x) => x.m.symbol === symbol && (!ref || x.m.kind === ref.kind));
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
  const name = `${label || "Paper account"}${/paper/i.test(label || "Paper account") ? "" : " · paper"}`;
  if (!book) {
    book = { version: 1, id: venue, name, createdAt: iso(now), updatedAt: iso(now), startCashUsd: req.cashUsd, feeBps: PAPER_FEE_BPS, cashUsd: req.cashUsd, holdings: {}, positions: {}, orders: {}, fills: [], markets: {}, leverage: {}, funding: [], seq: 0 };
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
  /** the leverage a market is set to, held to the most its source shows */
  const levOf = (symbol: string, max: number): number => Math.max(1, Math.min(max, Math.floor(b.leverage?.[symbol] ?? 1)));

  /** how far behind the market a stock's quote is, as the line that answered says: a line that keeps the market's clock and stamps its
   * quotes, its own delay for this quote (the US line answers with a real-time quote where one is given, and Cboe's fifteen minutes behind
   * where it is not, so it is the quote's, not the line's once and for all); the old delayed line without a stamp, Cboe's fifteen minutes;
   * anything else, none */
  const delayOf = (q: Quoted): number => (q.source.sessions && Number.isFinite(Date.parse(q.m.quoteAt ?? "")) ? Math.max(0, q.m.delayMs ?? 0) : q.source.id === US_STOCKS_ID ? CBOE_DELAY_MS : 0);
  /** A STOCK'S SESSION, as its quote tells it: the phase the quote's own time is in, and the phase the market is in now as its source sees
   * it (its delay behind, delayOf). A quote older than its source's delay and QUOTE_GRACE_MS is in no phase: a quote that stopped moving
   * fills nothing. A source that stamps no time is judged by its session now — and the old delayed line (Cboe without a stamp) by its window */
  const stockPhases = (q: Quoted, at: number): { quote: SessionPhase; now: SessionPhase } => {
    const clock = q.source.sessions;
    const stamped = q.m.quoteAt ? Date.parse(q.m.quoteAt) : NaN;
    if (clock && Number.isFinite(stamped)) {
      const delay = delayOf(q);
      const nowPhase = clock.phaseAt(at - delay);
      return { quote: at - stamped > delay + QUOTE_GRACE_MS ? "closed" : clock.phaseAt(stamped), now: nowPhase };
    }
    if (q.source.id === US_STOCKS_ID) {
      const open = cboeQuoteInSession(at);
      return { quote: open ? "regular" : "closed", now: open ? "regular" : "closed" };
    }
    const s = q.m.session;
    const p: SessionPhase = s?.phase ?? (s ? (s.open ? "regular" : "closed") : "regular");
    return { quote: p, now: p };
  };
  /** an order trades in a phase: the regular session always; pre-market, after-hours and overnight only a limit order sent for extended
   * hours, where the market's session takes one now */
  const tradesIn = (phase: SessionPhase, o: Pick<PaperOrder, "type" | "extendedHours">, m: Listing): boolean => phase === "regular" || (o.type === "limit" && o.extendedHours === true && m.session?.extendedHours === true && (phase === "pre" || phase === "after" || phase === "overnight"));
  /** whether the quote can fill this order now: anything but a stock any time its market takes orders; a stock when both its quote and its
   * market are in a phase the order trades in */
  const canFillNow = (o: Pick<PaperOrder, "type" | "extendedHours">, q: Quoted, at: number): boolean => {
    if (q.m.kind !== "stock") return true;
    const ph = stockPhases(q, at);
    return tradesIn(ph.quote, o, q.m) && tradesIn(ph.now, o, q.m);
  };
  /** whether the market's own session takes this order now, as its source sees it, whatever the quote's own stamp says: a quote that
   * stopped moving, or is stamped in another phase, fills nothing, but the market is still in a session the order trades in — a resting
   * limit is still on the book */
  const sessionTakes = (o: Pick<PaperOrder, "type" | "extendedHours">, q: Quoted, at: number): boolean => q.m.kind !== "stock" || tradesIn(stockPhases(q, at).now, o, q.m);
  /** a stop, or a trailing stop, is watched only in the regular session for a stock (as a broker's are) */
  const canTriggerNow = (q: Quoted, at: number): boolean => {
    if (q.m.kind !== "stock") return true;
    const ph = stockPhases(q, at);
    return ph.quote === "regular" && ph.now === "regular";
  };
  /** the end of the session a stock's REST belongs to: its market's trading day — the regular close, or for an order sent for extended
   * hours the end of after-hours — the session the market is in as the quote it rested at sees it (its delay behind, delayOf), and its end
   * on the market's own clock, no line's delay in it: each later quote is weighed against it by where the market is as that quote sees it
   * (judge), so a rest earned on a real-time quote is still the session's when a quote fifteen minutes behind answers after the close.
   * Nothing for a market that never closes */
  const restEnd = (o: Pick<PaperOrder, "extendedHours">, q: Quoted, at: number): string | undefined => {
    if (q.m.kind !== "stock") return undefined;
    const clock = q.source.sessions ?? (q.source.id === US_STOCKS_ID ? usClock : undefined);
    if (!clock) return undefined;
    return iso(clock.dayEndAt(at - delayOf(q), o.extendedHours === true));
  };
  /** an order RESTS from now, judged at a quote that could fill it and did not reach it: the book's maker, filled at its own price when the
   * quote reaches it — a stock's within the session it rested in (restEnd) */
  const rest = (o: PaperOrder, q: Quoted, at: number): void => {
    o.rested = true;
    const till = restEnd(o, q, at);
    if (till) o.restedTill = till;
    else delete o.restedTill;
  };

  /** a market as the paper account trades it: the source's own figures, the account's own steps and rule */
  const marketOf = (source: PublicSource, m: Listing): Market => {
    const perp = m.kind === "perp";
    const event = m.kind === "event";
    const stock = m.kind === "stock";
    const ownNote = typeof m.note === "string" && m.note ? ` · ${m.note}` : "";
    const { symbol, name: mname, kind, base, quote, price, bid, ask, open, changePct24h, change24h, volumeUsd24h, contracts24h, closeTime, category, group, outcome, fundingRate, nextFundingAt, implied, issuer, eligibility, session, quoteAt, delayMs, quoteFrom, pastEnd: _p, ...rest } = m as Listing & { pastEnd?: unknown };
    void rest;
    const at = req.clock();
    const stockSession = stock ? (session ?? usSession(at)) : undefined;
    const inSession = stock ? canFillNow({ type: "market" }, { source, m, at }, at) : true;
    const stockNote = stock && !inSession ? ` · the regular session is not on now: a market order waits for it (queued for the open), a limit order rests${m.session?.extendedHours ? " — or trades now, sent for extended hours" : ""}` : "";
    // what the paper account takes here: stops and trailing stops everywhere but an event contract; DAY orders where the market keeps a
    // session (a stock), good-till-canceled everywhere
    const types: OrderType[] = event ? ["market", "limit"] : ["market", "limit", "stop", "stop_limit", "trailing_stop"];
    const tifs: TimeInForce[] = stock ? ["day", "gtc", "ioc", "fok"] : ["gtc", "ioc", "fok"];
    const tifsByType: Partial<Record<OrderType, TimeInForce[]>> = stock ? { stop: ["day", "gtc"], stop_limit: ["day", "gtc"], trailing_stop: ["day", "gtc"] } : { market: ["ioc", "fok"], stop: ["gtc"], stop_limit: ["gtc"], trailing_stop: ["gtc"] };
    const step = event ? 1 : (pos(m.qtyStep) ?? DEFAULT_QTY_STEP);
    return {
      symbol,
      name: mname,
      kind,
      base,
      quote,
      ...(pos(price) !== undefined ? { price } : {}),
      ...(pos(bid) !== undefined ? { bid } : {}),
      ...(pos(ask) !== undefined ? { ask } : {}),
      minQty: event ? 1 : (pos(m.minQty) ?? step),
      qtyStep: step,
      ...(event ? { priceStep: 0.01 } : pos(m.priceStep) !== undefined ? { priceStep: m.priceStep } : {}),
      minNotional: 1,
      open: open !== false,
      note: `${rule}${ownNote}${stockNote}`,
      types,
      tifs,
      tifsByType,
      postOnly: false,
      brackets: !event,
      ...(perp ? { reduceOnly: true, contractSize: 1, maxLeverage: Math.max(1, Math.floor(pos(m.maxLeverage) ?? 1)), marginModes: ["isolated"] } : { sellsReduce: true }),
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
      ...(quoteAt ? { quoteAt } : {}),
      ...(delayMs !== undefined ? { delayMs } : {}),
      ...(quoteFrom ? { quoteFrom } : {}),
    };
  };

  /** a quote for a market the book knows or the sources list: the listing's price, bid and ask, and how old it is */
  const quote = async (symbol: string): Promise<Quoted | undefined> => {
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

  const stateOf = (o: PaperOrder): OrderState => {
    const legs = (o.children ?? []).map((r) => b.orders[r]).filter((x): x is PaperOrder => !!x);
    return { ref: o.ref, status: o.status, filledQty: o.filledQty, ...(o.avgPrice !== undefined ? { avgPrice: o.avgPrice } : {}), ...(o.feeUsd !== undefined ? { feeUsd: o.feeUsd } : {}), native: { paper: true, book: b.id, order: o.ref, type: o.type, ...(o.stopPrice !== undefined ? { stopPrice: o.stopPrice } : {}), ...(o.triggeredAt ? { triggeredAt: o.triggeredAt } : {}), ...(o.expiresAt ? { expiresAt: o.expiresAt } : {}), ...(o.note ? { note: o.note } : {}), ...(legs.length ? { legs: legs.map((l) => ({ ref: l.ref, clientId: l.clientId, at: l.at, type: l.type, side: l.side, qty: l.qty, status: l.status, filledQty: l.filledQty, ...(l.feeUsd !== undefined ? { feeUsd: l.feeUsd } : {}), ...(l.limitPrice !== undefined ? { limitPrice: l.limitPrice } : {}), ...(l.stopPrice !== undefined ? { stopPrice: l.stopPrice } : {}), ...(l.avgPrice !== undefined ? { avgPrice: l.avgPrice } : {}), ...(l.filledAt ? { filledAt: l.filledAt } : {}), ...(l.note ? { note: l.note } : {}) })) } : {}) } };
  };
  const reject = (message: string): Refusal => no("E_VENUE_REJECTED", { venue, message: `${b.name}: ${message}` });
  const record = (f: PaperFill): void => {
    b.fills.push(f);
    if (b.fills.length > FILLS_KEPT) b.fills.splice(0, b.fills.length - FILLS_KEPT);
  };
  /** what a fill pays in charges, in dollars: a US share nothing (no commission, as a broker charges none), anything else the book's fee */
  const chargesOf = (ref: PaperMarketRef, notional: number): number => (ref.kind === "stock" ? 0 : round((notional * b.feeBps) / 10_000, 6));

  /** A POSITION'S EXITS GO WITH IT: once a perpetual position or a holding is gone — closed, sold, liquidated — every exit still open in its
   * market is canceled: a bracket's take-profit and stop-loss and, on a perpetual, any reduce-only order. Nothing is left for them to
   * close, and left standing one would close the next position opened in the market. `side`: only the exits on that side (a holding's
   * are sells; the buy-back of a sell's bracket needs no holding) */
  const cancelExits = (symbol: string, side: Side | undefined, note: string, at: number): void => {
    for (const x of Object.values(b.orders)) if (x.symbol === symbol && x.status === "open" && (x.parent || x.reduceOnly) && (!side || x.side === side)) Object.assign(x, { status: "canceled", note, updatedAt: iso(at) });
  };

  /** the fill itself: money, holdings or the position moved by the account's rule, or why the paper money is not there. `q` is the quote it
   * fills at: a perpetual's funding owed is settled at it before the position moves */
  const fill = (o: PaperOrder, px: number, at: number, q: Quoted): Refusal | undefined => {
    const ref = b.markets[o.symbol]!;
    // a bracket's exit closes what is left of its position and never more: one larger than what is held now (the position reduced, or part
    // of the holding sold, since it was placed) is trimmed to it, as a venue's reduce-only order is
    if (o.parent) {
      const p = b.positions[o.symbol];
      const left = ref.kind === "perp" ? (p && (p.side === "long" ? "sell" : "buy") === o.side ? p.qty : undefined) : o.side === "sell" ? b.holdings[o.symbol]?.qty : undefined;
      if (left !== undefined && left > 0 && o.qty > left + 1e-12) o.qty = left;
    }
    const notional = round(o.qty * px, 8);
    const fee = chargesOf(ref, notional);
    let realized: number | undefined;
    /** the position or the holding this fill closed whole, and a perpetual's position this fill reduced rather than opened or added to */
    let gone = false;
    let reduced = false;
    /** a part closed at a loss past its own share of the margin: what the margin of the rest of the position took of it */
    let fromRest = 0;
    if (ref.kind === "perp") {
      const p = b.positions[o.symbol];
      const opposite = !!p && ((p.side === "long" && o.side === "sell") || (p.side === "short" && o.side === "buy"));
      if (o.reduceOnly && !opposite) return reject(`reduce-only: no ${o.side === "sell" ? "long" : "short"} position in ${o.symbol} to reduce`);
      if (opposite && p) {
        if (o.qty > p.qty + 1e-12) return reject(o.reduceOnly ? `reduce-only: ${qtyText(o.qty)} is more than the ${qtyText(p.qty)} held` : `${qtyText(o.qty)} is more than the ${p.side} position of ${qtyText(p.qty)}: it would flip the side — close the position first, then open the other way`);
        // the funding of every whole hour it stood is paid before the close takes its margin: a close by hand, or an exit judged while the
        // look's own quote did not come back, never drops the hours owed
        payFunding(o.symbol, p, q, at);
        reduced = true;
        const part = o.qty / p.qty;
        const margin = round(p.marginUsd * part, 6);
        realized = round((p.side === "long" ? px - p.entryPrice : p.entryPrice - px) * o.qty, 6);
        // isolated margin: the position's own margin, and nothing more, is lost — a close past it (a stop after a gap, the owner's close of a
        // position the look has not liquidated yet) gives nothing back and takes nothing from the cash; what it did not take is written on
        // the order, so the book's past can be told again exactly
        const back = margin + realized - fee;
        let lost = back < 0 ? round(-back, 6) : 0;
        b.cashUsd = round(b.cashUsd + Math.max(0, back), 6);
        if (o.qty >= p.qty - 1e-12) {
          delete b.positions[o.symbol];
          gone = true;
        } else {
          // a part closed past its own share of the margin: the margin is the whole position's, so the rest of that loss comes out of the
          // margin of what is left first — a remainder whose margin is gone is liquidated at the next look — and only what is past all of it
          // is lost to isolated margin
          fromRest = round(Math.min(lost, Math.max(0, p.marginUsd - margin)), 6);
          lost = round(lost - fromRest, 6);
          p.qty = round(p.qty - o.qty, 12);
          p.marginUsd = round(p.marginUsd - margin - fromRest, 6);
        }
        if (lost > 0) o.lossPastMarginUsd = lost;
      } else {
        const lev = p?.leverage ?? levOf(o.symbol, ref.maxLeverage ?? 1);
        const margin = round(notional / lev, 6);
        if (b.cashUsd + 1e-9 < margin + fee) return no("E_VENUE_INSUFFICIENT", { venue, message: `${b.name}: not enough paper money — ${usd(margin + fee)} needed as margin and fee at ${lev}x, ${usd(b.cashUsd)} there` });
        // added to: the hours it stood are paid at the size it stood at, before it grows
        if (p) payFunding(o.symbol, p, q, at);
        b.cashUsd = round(b.cashUsd - margin - fee, 6);
        if (p) {
          p.entryPrice = round((p.entryPrice * p.qty + px * o.qty) / (p.qty + o.qty), 10);
          p.qty = round(p.qty + o.qty, 12);
          p.marginUsd = round(p.marginUsd + margin, 6);
        } else b.positions[o.symbol] = { side: o.side === "buy" ? "long" : "short", qty: o.qty, entryPrice: px, marginUsd: margin, leverage: lev, fundingUsd: 0, fundedAt: at };
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
      realized = round(notional - fee - h.costUsd * part, 6);
      h.costUsd = round(h.costUsd * (1 - part), 6);
      h.qty = round(h.qty - o.qty, 12);
      if (h.qty <= 1e-12) {
        delete b.holdings[o.symbol];
        gone = true;
      }
    }
    const when = iso(at);
    o.status = "filled";
    o.filledQty = o.qty;
    o.avgPrice = px;
    o.feeUsd = fee;
    o.filledAt = when;
    o.updatedAt = when;
    // what went past this part's share of the margin is what the rest of the margin took and what went past all of it, both said
    const lossPast = o.lossPastMarginUsd ?? 0;
    const past = fromRest > 0
      ? `isolated margin: the loss went ${usd(fromRest + lossPast)} past this part's share of the margin: ${usd(fromRest)} of it taken from the margin of what is left${lossPast > 0 ? `, and ${usd(lossPast)} past all of it — only the margin was lost` : ""}`
      : lossPast > 0 ? `isolated margin: the loss went ${usd(lossPast)} past the position's margin, and only the margin was lost` : "";
    if (past) o.note = past;
    const said = [o.parent ? `${o.type === "limit" ? "take-profit" : "stop-loss"} of ${o.parent}` : "", past].filter(Boolean).join(" · ");
    record({ ref: o.ref, symbol: o.symbol, side: o.side, qty: o.qty, price: px, feeUsd: fee, at: when, ...(realized !== undefined && ref.kind === "perp" ? { realizedUsd: realized } : {}), ...(said ? { note: said } : {}) });
    // one exit of a bracket filled: the other is no longer needed
    if (o.oco) {
      const sib = b.orders[o.oco];
      if (sib && (sib.status === "open" || sib.status === "pending")) {
        sib.status = "canceled";
        sib.note = `canceled: the other exit of ${o.parent ?? "its bracket"} (${o.ref}) filled`;
        sib.updatedAt = when;
      }
    }
    if (gone) cancelExits(o.symbol, ref.kind === "perp" ? undefined : "sell", ref.kind === "perp" ? `canceled: the position it was to close is closed (${o.ref})` : `canceled: what it was to sell is sold (${o.ref})`, at);
    // an entry with exits: the exits go on the book now, for what filled, the one that fills canceling the other — unless, on a perpetual,
    // it reduced the position on the other side instead of opening one: there is nothing of its own for them to close
    if (o.takeProfit !== undefined || o.stopLoss !== undefined) {
      if (reduced) o.note = [past, `its exits were not placed: it reduced the ${o.side === "sell" ? "long" : "short"} position open in ${o.symbol} rather than opening one, so there is nothing of its own for them to close`].filter(Boolean).join(" · ");
      else placeExits(o, px, at, q);
    }
    return undefined;
  };

  /** a bracket's exits, placed the moment its entry fills at `px`: a limit the other way at the take-profit, a stop the other way at the
   * stop-loss, each knowing the other (the one that fills cancels the other); good till canceled, never for extended hours; a perpetual's
   * reduce-only. A take-profit beyond the fill price (above a buy's, below a sell's) is out of the quote's reach when it is placed — a buy
   * filled at the ask or under it, and its take-profit sells at the bid — so it RESTS from birth: a quote that passes through it before
   * the next look fills it at its limit — a stock's within the session its entry filled in (restEnd). One at the fill price or past it (an
   * entry filled at the open after a gap) never rested, and takes the quote. `q` is the quote the entry filled at */
  const placeExits = (o: PaperOrder, px: number, at: number, q: Quoted): void => {
    const ref = b.markets[o.symbol];
    const side: Side = o.side === "buy" ? "sell" : "buy";
    const beyond = (price: number): boolean => (o.side === "buy" ? price > px + 1e-12 : price < px - 1e-12);
    // exits are never for extended hours: a stock's take-profit rests to its regular close
    const till = restEnd({}, q, at);
    const leg = (kind: "tp" | "sl", type: "limit" | "stop", price: number): PaperOrder => ({ ref: `p${++b.seq}`, clientId: `${o.clientId}-${kind}`, symbol: o.symbol, side, type, qty: o.filledQty, ...(type === "limit" ? { limitPrice: price, ...(beyond(price) ? { rested: true as const, ...(till ? { restedTill: till } : {}) } : {}) } : { stopPrice: price }), tif: "gtc", ...(ref?.kind === "perp" ? { reduceOnly: true } : {}), status: "open", filledQty: 0, parent: o.ref, at: iso(at), updatedAt: iso(at) });
    const legs: PaperOrder[] = [];
    if (o.takeProfit !== undefined) legs.push(leg("tp", "limit", o.takeProfit));
    if (o.stopLoss !== undefined) legs.push(leg("sl", "stop", o.stopLoss));
    if (legs.length === 2) {
      legs[0]!.oco = legs[1]!.ref;
      legs[1]!.oco = legs[0]!.ref;
    }
    for (const l of legs) b.orders[l.ref] = l;
    o.children = legs.map((l) => l.ref);
  };

  /** the price a fill is at: the ask for a buy, the bid for a sell (the last price where the source shows no book) */
  const sideQuote = (side: Side, m: Listing): number | undefined => (side === "buy" ? (pos(m.ask) ?? pos(m.price)) : (pos(m.bid) ?? pos(m.price)));
  /** a quote that has passed the order's worst price (a market order's bound from the account's door) */
  const pastWorst = (o: PaperOrder, px: number): boolean => o.worstPrice !== undefined && (o.side === "buy" ? px > o.worstPrice + 1e-12 : px < o.worstPrice - 1e-12);
  /** fill it at px, or mark it rejected with why the paper money was not there */
  const fillOrReject = (o: PaperOrder, px: number, at: number, q: Quoted): void => {
    const r = fill(o, px, at, q);
    if (r) {
      o.status = "rejected";
      o.note = r.message;
      o.updatedAt = iso(at);
      // a bracket's exit that could not fill takes the other with it: they stood together
      if (o.oco) {
        const sib = b.orders[o.oco];
        if (sib && sib.status === "open") {
          sib.status = "canceled";
          sib.note = `canceled: the other exit (${o.ref}) could not fill`;
          sib.updatedAt = iso(at);
        }
      }
    }
  };

  /** an order whose market does not take it now — out of the session the order trades in, or taking no orders — rests no more: when its
   * market takes it again, a quote already past its limit fills it at that quote, as the open (or a halt's end) fills a broker's resting
   * limit. A quote that only stopped moving (a stale stamp, the market still in session) ends no rest; the end of the session it rested in
   * (restedTill) does. True when that changed it */
  const unrest = (o: PaperOrder): boolean => {
    if (!o.rested) return false;
    delete o.rested;
    delete o.restedTill;
    return true;
  };

  /** an order's day over at `t` (its expiresAt reached): expired, its bracket sibling canceled with it. True */
  const expire = (o: PaperOrder, t: number): boolean => {
    o.status = "expired";
    o.note = `${o.tif === "day" ? "a day order" : "it"} expired at the end of its session (${o.expiresAt})${o.note ? ` · ${o.note}` : ""}`;
    o.updatedAt = iso(t);
    if (o.oco) {
      const sib = b.orders[o.oco];
      if (sib && sib.status === "open") {
        sib.status = "canceled";
        sib.note = `canceled: the other exit (${o.ref}) expired`;
        sib.updatedAt = iso(t);
      }
    }
    return true;
  };

  /** ONE OPEN ORDER JUDGED against a fresh quote — its day over, its trailing stop moved, its stop triggered, its price crossed — by the
   * account's rule (the top of this file). Its day is judged at `at`, the moment it was asked about, and again at the moment its quote is
   * back (a session that ended while the quote was asked ends the order, never fills it after its own end); everything else at that moment.
   * The order is looked at again then: the owner may have canceled it, an amend changed it, or another judgement filled it while the quote
   * was asked, and what the owner was told stands. True when the book changed */
  const judge = async (o: PaperOrder, at: number): Promise<boolean> => {
    if (o.status !== "open") return false;
    if (o.expiresAt && at >= Date.parse(o.expiresAt)) return expire(o, at);
    const q = await quote(o.symbol);
    if (!q) return false;
    if (o.status !== "open") return false;
    // the moment the quote is back: everything from here on — the end of a rest, a trigger, a fill — is at it, never at the moment the quote
    // was asked. The owner may have filled an order meanwhile (an add to the position this order closes): what this one does comes after it
    // on the book, so its past, told again in time order, is the book's own
    const now = req.clock();
    if (o.expiresAt && now >= Date.parse(o.expiresAt)) return expire(o, now);
    // a rest is the session's it was earned in: once the market as this quote sees it (its line's delay behind, delayOf) is past that
    // session's end it rests no more, whether or not a look fell between the close and the open (the Mac asleep overnight, the source
    // silent out of hours) — the next session's quote past its limit takes the quote
    let changed = o.restedTill !== undefined && now - delayOf(q) >= Date.parse(o.restedTill) ? unrest(o) : false;
    // a market its source says takes no orders now (a halted token, a contract no longer active, a pair with its trading off) fills
    // nothing, triggers nothing, moves no trail — as the account takes no new order in it
    if (q.m.open === false) return unrest(o) || changed;
    // a stop not yet triggered: watched (in the regular session for a stock), its trail moved, triggered when the price reaches it
    if ((o.type === "stop" || o.type === "stop_limit" || o.type === "trailing_stop") && !o.triggeredAt) {
      if (!canTriggerNow(q, now)) return changed;
      const watch = o.side === "sell" ? (pos(q.m.bid) ?? pos(q.m.price)) : (pos(q.m.ask) ?? pos(q.m.price));
      if (watch === undefined) return changed;
      if (o.type === "trailing_stop") {
        const best = o.hwm === undefined ? watch : o.side === "sell" ? Math.max(o.hwm, watch) : Math.min(o.hwm, watch);
        const stop = trailStop(o.side, best, o);
        if (best !== o.hwm || stop !== o.stopPrice) {
          o.hwm = best;
          o.stopPrice = stop;
          changed = true;
        }
      }
      if (o.stopPrice === undefined) return changed;
      const reached = o.side === "sell" ? watch <= o.stopPrice + 1e-12 : watch >= o.stopPrice - 1e-12;
      if (!reached) return changed;
      o.triggeredAt = iso(now);
      o.updatedAt = iso(now);
      changed = true;
    }
    const as: Pick<PaperOrder, "type" | "extendedHours"> = o.type === "limit" || o.type === "stop_limit" ? { type: "limit", extendedHours: o.extendedHours } : { type: "market" };
    if (!canFillNow(as, q, now)) return (!sessionTakes(as, q, now) && unrest(o)) || changed;
    const px = sideQuote(o.side, q.m);
    if (px === undefined) return changed;
    if (o.type === "limit" || o.type === "stop_limit") {
      if (o.limitPrice === undefined) return changed;
      const crossed = o.side === "buy" ? px <= o.limitPrice + 1e-12 : px >= o.limitPrice - 1e-12;
      if (!crossed) {
        // a quote that could fill it and does not reach it: it rests from now, the book's maker
        if (!o.rested) {
          rest(o, q, now);
          changed = true;
        }
        return changed;
      }
      // a limit that rested fills at its own price when the quote reaches it. One that never rested — past the quote the moment it was
      // placed (a bracket's take-profit after a gap), changed (an amend), triggered (a stop-limit) or let back into its session — crosses
      // at once, so it takes the quote where that is better than its limit, as a limit crossing when it is placed does
      fillOrReject(o, o.rested ? o.limitPrice : o.side === "buy" ? Math.min(px, o.limitPrice) : Math.max(px, o.limitPrice), now, q);
      return true;
    }
    // a market order queued for the session, or a stop that triggered: at the quote, inside the worst price its door gave it — past it, it
    // waits there as a limit would
    if (pastWorst(o, px)) {
      const note = `waiting: the quote (${plain(px)}) is past the worst price the order allows (${plain(o.worstPrice!)})`;
      if (o.note !== note) {
        o.note = note;
        o.updatedAt = iso(now);
        return true;
      }
      return changed;
    }
    fillOrReject(o, px, now, q);
    return true;
  };

  /** the funding rate of a perpetual's quote per hour: Hyperliquid's as it is, another venue's an eighth of its interval's */
  const hourlyFunding = (source: PublicSource, m: Listing): number | undefined => {
    const r = m.fundingRate;
    if (typeof r !== "number" || !Number.isFinite(r)) return undefined;
    return HOURLY_FUNDING.test(source.id) ? r : r / FUNDING_INTERVAL_HOURS;
  };
  /** A POSITION'S FUNDING settled: each whole hour since it was last settled, the notional at the mark times the source's hourly rate, paid
   * out of the margin. Only at a quote that is the source's answer (`q`) — a source that did not answer in time has said no rate, and the
   * hours wait for a quote that has it. Every look settles it (markPerps), and so does every fill on the position before it moves it (fill):
   * a close by hand, or an exit judged at a quote the look's own did not have, never takes the position off with hours unpaid. True when the
   * book changed */
  const payFunding = (symbol: string, p: PaperPosition, q: Quoted | undefined, at: number): boolean => {
    if (!q) return false;
    const mark = pos(q.m.price) ?? b.markets[symbol]?.last?.price;
    if (mark === undefined) return false;
    const fundedAt = p.fundedAt ?? at;
    const hours = Math.floor((at - fundedAt) / HOUR);
    if (hours <= 0) return false;
    const rate = hourlyFunding(q.source, q.m);
    if (rate !== undefined && rate !== 0) {
      // the long pays when the rate is above zero, the short receives; the other way round below zero
      const notional = mark * p.qty;
      const paid = round(notional * rate * hours * (p.side === "long" ? 1 : -1), 6);
      p.marginUsd = round(p.marginUsd - paid, 6);
      p.fundingUsd = round((p.fundingUsd ?? 0) + paid, 6);
      // written down as it is settled, so the book's past can be told again exactly (paper-history.ts)
      (b.funding ??= []).push({ at: iso(fundedAt + hours * HOUR), symbol, usd: paid });
      if (b.funding.length > FUNDING_KEPT) b.funding.splice(0, b.funding.length - FUNDING_KEPT);
    }
    p.fundedAt = fundedAt + hours * HOUR;
    return true;
  };
  /** every perpetual position marked: its funding settled (payFunding), and the position liquidated at the mark when the margin left has
   * fallen to the maintenance margin. A position the owner closed (or closed and opened again) while its quote was asked is not this one:
   * it is left to the next look. One the owner added to or closed part of meanwhile is the same position, grown or shrunk: it is marked
   * as it stands when its quote is back, at that moment — so its funding and its liquidation come after the owner's order on the book, never
   * before it. True when the book changed */
  const markPerps = async (): Promise<boolean> => {
    let changed = false;
    for (const [symbol, p] of Object.entries(b.positions)) {
      const q = await quote(symbol);
      if (b.positions[symbol] !== p) continue;
      const at = req.clock();
      const ref = b.markets[symbol];
      const mark = pos(q?.m.price) ?? ref?.last?.price;
      if (mark === undefined) continue;
      const notional = mark * p.qty;
      if (payFunding(symbol, p, q, at)) changed = true;
      const maxLeverage = Math.max(1, ref?.maxLeverage ?? pos(q?.m.maxLeverage) ?? 1);
      const pnl = (p.side === "long" ? mark - p.entryPrice : p.entryPrice - mark) * p.qty;
      const left = p.marginUsd + pnl;
      const maintenance = notional / (2 * maxLeverage);
      if (left <= maintenance + 1e-9) {
        const fee = round((notional * b.feeBps) / 10_000, 6);
        const back = round(Math.max(0, left - fee), 6);
        b.cashUsd = round(b.cashUsd + back, 6);
        const o: PaperOrder = { ref: `p${++b.seq}`, clientId: `liquidation-${b.seq}`, symbol, side: p.side === "long" ? "sell" : "buy", type: "market", qty: p.qty, reduceOnly: true, status: "filled", filledQty: p.qty, avgPrice: mark, feeUsd: fee, lossPastMarginUsd: round(Math.max(0, fee - left), 6), at: iso(at), updatedAt: iso(at), filledAt: iso(at), note: `liquidated at the mark (${plain(mark)}): the margin left (${usd(left)}) fell to the maintenance margin (${usd(maintenance)}); ${usd(back)} went back to cash` };
        b.orders[o.ref] = o;
        record({ ref: o.ref, symbol, side: o.side, qty: p.qty, price: mark, feeUsd: fee, at: iso(at), realizedUsd: round(pnl, 6), note: o.note });
        delete b.positions[symbol];
        // its exits have nothing left to close
        cancelExits(symbol, undefined, `canceled: the position was liquidated (${o.ref})`, at);
        changed = true;
      }
    }
    return changed;
  };

  /** every event contract held: once its venue says the market has settled, paid out at what the venue paid and taken off the book; a
   * market closed and not settled is marked so. Asked at most every minute past the market's close, every ten minutes before it (a market
   * may settle early). A holding sold whole (or sold and bought again) while its venue was asked is not the one asked about: what is held
   * now is asked about at the next look. True when the book changed */
  const settleEvents = async (at: number): Promise<boolean> => {
    let changed = false;
    for (const [symbol, h] of Object.entries(b.holdings)) {
      const ref = b.markets[symbol];
      if (!ref || ref.kind !== "event" || !(h.qty > 0)) continue;
      const source = pricer.sourceOf(ref.source);
      if (!source?.settlement) continue;
      const closeMs = ref.closeTime ? Date.parse(ref.closeTime) : NaN;
      const every = Number.isFinite(closeMs) && at < closeMs ? SETTLE_BEFORE_CLOSE_MS : SETTLE_AFTER_CLOSE_MS;
      const asked = settleAsked.get(symbol);
      if (asked !== undefined && at - asked < every) continue;
      settleAsked.set(symbol, at);
      const s = await inTime(source.settlement(symbol), SOURCE_MS);
      if (b.holdings[symbol] !== h) {
        settleAsked.delete(symbol);
        continue;
      }
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
      const o: PaperOrder = { ref: `p${++b.seq}`, clientId: `settlement-${b.seq}`, symbol, side: "sell", type: "market", qty: h.qty, status: "filled", filledQty: h.qty, avgPrice: s.payout, feeUsd: 0, at: iso(at), updatedAt: iso(at), filledAt: iso(at), note: `settled by ${source.name}: ${usd(s.payout)} a contract${s.payout >= 1 ? " to this side, which won" : s.payout <= 0 ? " — this side lost" : ""}, ${usd(paid)} for ${qtyText(h.qty)}` };
      b.orders[o.ref] = o;
      record({ ref: o.ref, symbol, side: "sell", qty: h.qty, price: s.payout, feeUsd: 0, at: iso(at), realizedUsd: round(paid - h.costUsd, 6), note: o.note });
      ref.settled = { payout: s.payout, at: s.at ?? iso(at) };
      delete ref.closed;
      delete b.holdings[symbol];
      // its exits have nothing left to sell
      for (const x of Object.values(b.orders)) if (x.symbol === symbol && x.status === "open") Object.assign(x, { status: "canceled", note: `canceled: the market settled (${o.ref})`, updatedAt: iso(at) });
      changed = true;
    }
    return changed;
  };

  let settling: Promise<boolean> | undefined;
  /** every position marked, every open order judged and every held contract's settlement asked, once at a time: a second look while one is
   * under way waits for it. True when the book changed */
  const settle = (): Promise<boolean> => {
    if (settling) return settling;
    const run = (async () => {
      let changed = false;
      // the perpetuals first: the funding of the hours each stood is paid before an order in this look closes it, and a gap past a
      // position's liquidation price is the liquidation the rule says (its exits canceled with it), not a stop-loss filled below it
      changed = (await markPerps()) || changed;
      // in the order they were placed, so an entry's exits are judged after it (an exit placed by this look waits for the next)
      const open = Object.values(b.orders).filter((o) => o.status === "open").sort((x, y) => Number(x.ref.slice(1)) - Number(y.ref.slice(1)));
      for (const o of open) changed = (await judge(o, req.clock())) || changed;
      changed = (await settleEvents(req.clock())) || changed;
      if (changed) save();
      return changed;
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
      const from = q ? (q.m.quoteFrom ?? q.m.venueName ?? q.source.name) : ref.source;
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
      // an open perpetual's margin and its unrealised result: counted in what the account is worth, and none of it free to spend — it is
      // the position's until the position is closed
      out.push({ asset: "USD", amount: worth, usd: worth, freeUsd: 0, where: `paper margin · ${p.side} ${qtyText(p.qty)} ${symbol} · ${p.leverage ?? 1}x${mark !== undefined ? ` · ${signed(pnl)} unrealised` : " · unmarked"}${funding}`, class: "cash" });
    }
    return out;
  };

  /** an order as the request says it, checked against the market as the paper account takes it: a refusal, or nothing */
  const checkOrder = (o: OrderRequest, m: Market): Refusal | undefined => {
    if (!m.types.includes(o.type)) return badOrder(venue, b.name, `${m.name} takes ${m.types.join(", ").replace(/_/g, "-")} orders here, not ${String(o.type).replace(/_/g, "-")} orders`);
    if (o.postOnly) return badOrder(venue, b.name, "post-only is not offered: a paper account has no book to rest on");
    if (o.tif !== undefined) {
      const tifs = m.tifsByType?.[o.type] ?? m.tifs ?? [];
      if (!tifs.includes(o.tif)) return badOrder(venue, b.name, `a ${o.type.replace(/_/g, "-")} order in ${m.name} takes ${tifs.join(", ")}, not ${o.tif}`);
    }
    if (!(Number.isFinite(o.qty) && o.qty > 0)) return badOrder(venue, b.name, "a size is more than zero");
    const limited = o.type === "limit" || o.type === "stop_limit";
    const stopped = o.type === "stop" || o.type === "stop_limit";
    if (limited ? !(o.limitPrice !== undefined && o.limitPrice > 0) : o.limitPrice !== undefined) return badOrder(venue, b.name, limited ? `a ${o.type.replace(/_/g, "-")} order has a limit price` : `a ${o.type.replace(/_/g, "-")} order has no limit price`);
    if (stopped ? !(o.stopPrice !== undefined && o.stopPrice > 0) : o.stopPrice !== undefined) return badOrder(venue, b.name, stopped ? `a ${o.type.replace(/_/g, "-")} order has a stop price` : `a stop price belongs to a stop order, not a ${o.type.replace(/_/g, "-")} order`);
    const trail = o.trailPercent !== undefined || o.trailPrice !== undefined;
    if (o.type === "trailing_stop") {
      if ((o.trailPercent === undefined) === (o.trailPrice === undefined)) return badOrder(venue, b.name, "a trailing stop trails by a percent or by a price: one of the two");
      if (o.trailPercent !== undefined && !(o.trailPercent > 0 && o.trailPercent < 100)) return badOrder(venue, b.name, "a trailing stop's percent is more than 0 and less than 100");
      if (o.trailPrice !== undefined && !(o.trailPrice > 0)) return badOrder(venue, b.name, "a trailing stop's price is more than zero");
    } else if (trail) return badOrder(venue, b.name, "a trail belongs to a trailing stop");
    if (o.extendedHours && !(o.type === "limit" && m.kind === "stock" && m.session?.extendedHours)) return badOrder(venue, b.name, o.type !== "limit" ? "extended hours take a limit order only" : `${m.name} takes no extended-hours order now`);
    if (o.extendedHours && o.tif !== undefined && o.tif !== "day" && o.tif !== "gtc") return badOrder(venue, b.name, "an extended-hours order is good for the day or till canceled");
    if (!onStep(o.qty, m.qtyStep)) return badOrder(venue, b.name, `a size in ${m.name} moves in steps of ${plain(m.qtyStep ?? 1)}`, { qty: o.qty, qtyStep: m.qtyStep });
    for (const [what, p] of [["limit", o.limitPrice], ["stop", o.stopPrice], ["take-profit", o.takeProfit], ["stop-loss", o.stopLoss]] as const) {
      if (p !== undefined && !onStep(p, m.priceStep)) return badOrder(venue, b.name, `${m.name} moves in steps of ${plain(m.priceStep!)}: a ${what} price of ${plain(p)} is between steps`, { price: p, priceStep: m.priceStep });
    }
    if (o.reduceOnly && m.kind !== "perp") return badOrder(venue, b.name, `reduce-only is for a perpetual: ${m.name} sells only what is held`);
    if (o.takeProfit !== undefined || o.stopLoss !== undefined) {
      if (!m.brackets) return badOrder(venue, b.name, `${m.name} takes no exits on an entry here`);
      if (o.type !== "market" && o.type !== "limit") return badOrder(venue, b.name, "a bracket's entry is a market or a limit order");
      if (o.reduceOnly) return badOrder(venue, b.name, "a reduce-only order is an exit already: it carries no exits of its own");
      if (o.tif === "ioc" || o.tif === "fok") return badOrder(venue, b.name, "a bracket's entry is good for the day or till canceled");
      if (o.extendedHours) return badOrder(venue, b.name, "a bracket is for the regular session");
      // each exit is judged against the entry's fill that is worst for it, as the account's door judges them: the take-profit against the
      // limit itself (a market order's: the book), the stop-loss against where the entry fills — a limit that crosses the book fills at
      // the book, better than its limit (a buy limited at 70,000 with the ask at 60,010 fills at 60,010: a stop-loss at 65,000 would sell
      // at once)
      const up = o.side === "buy";
      const atBook = up ? (pos(m.ask) ?? pos(m.price)) : (pos(m.bid) ?? pos(m.price));
      const ref = o.type === "limit" ? o.limitPrice! : atBook;
      const slRef = o.type === "limit" && atBook !== undefined ? (up ? Math.min(o.limitPrice!, atBook) : Math.max(o.limitPrice!, atBook)) : ref;
      if (ref !== undefined && o.takeProfit !== undefined && (up ? o.takeProfit <= ref : o.takeProfit >= ref)) return badOrder(venue, b.name, `the take-profit (${plain(o.takeProfit)}) must be ${up ? "above" : "below"} the entry (${plain(ref)}) for a ${o.side}`);
      if (slRef !== undefined && o.stopLoss !== undefined && (up ? o.stopLoss >= slRef : o.stopLoss <= slRef)) return badOrder(venue, b.name, `the stop-loss (${plain(o.stopLoss)}) must be ${up ? "below" : "above"} the entry (${plain(slRef)}) for a ${o.side}${slRef !== ref ? `: a ${o.side} limited at ${plain(ref!)} crosses the book and fills there, at ${plain(slRef)}` : ""}`);
    }
    return undefined;
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
      const q = await quote(o.symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source prices ${o.symbol.slice(0, 60)} just now, so nothing is filled` });
      const m = marketOf(q.source, q.m);
      if (!m.open) return no("E_VENUE_MARKET_CLOSED", { venue, message: `${b.name}: ${m.name} takes no orders now${q.m.note ? ` (${q.m.note})` : ""}` });
      const bad = checkOrder(o, m);
      if (bad) return bad;
      const at = req.clock();
      b.markets[o.symbol] = { ...refOf(q.source, q.m), last: { ...(pos(q.m.price) !== undefined ? { price: q.m.price } : {}), ...(pos(q.m.bid) !== undefined ? { bid: q.m.bid } : {}), ...(pos(q.m.ask) !== undefined ? { ask: q.m.ask } : {}), at: q.at } };
      const stock = m.kind === "stock";
      // how long it stands: a day order (a stock's default for anything that rests) to the end of its session — the regular one's, or the
      // extended one's for an order sent for extended hours — as the market's own clock says
      const tif = o.tif ?? (stock && o.type !== "limit" ? "day" : undefined);
      const clock = q.source.sessions ?? (q.source.id === US_STOCKS_ID ? usClock : undefined);
      const dayEnd = tif === "day" && clock ? clock.dayEndAt(at, o.extendedHours === true) : undefined;
      const order: PaperOrder = {
        ref: `p${++b.seq}`,
        clientId: o.clientId,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        qty: o.qty,
        ...(o.limitPrice !== undefined ? { limitPrice: o.limitPrice } : {}),
        ...(o.worstPrice !== undefined ? { worstPrice: o.worstPrice } : {}),
        ...(o.stopPrice !== undefined ? { stopPrice: o.stopPrice } : {}),
        ...(o.trailPercent !== undefined ? { trailPercent: o.trailPercent } : {}),
        ...(o.trailPrice !== undefined ? { trailPrice: o.trailPrice } : {}),
        ...(tif ? { tif } : {}),
        ...(dayEnd !== undefined ? { expiresAt: iso(dayEnd) } : {}),
        ...(o.reduceOnly ? { reduceOnly: true } : {}),
        ...(o.extendedHours ? { extendedHours: true } : {}),
        ...(o.takeProfit !== undefined ? { takeProfit: o.takeProfit } : {}),
        ...(o.stopLoss !== undefined ? { stopLoss: o.stopLoss } : {}),
        status: "open",
        filledQty: 0,
        at: iso(at),
        updatedAt: iso(at),
      };
      // a trailing stop starts from the price now: its stop is the trail behind it
      if (o.type === "trailing_stop") {
        const watch = o.side === "sell" ? (pos(q.m.bid) ?? pos(q.m.price)) : (pos(q.m.ask) ?? pos(q.m.price));
        if (watch === undefined) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: ${m.name} shows no price just now to trail from` });
        order.hwm = watch;
        order.stopPrice = trailStop(o.side, watch, order);
      }
      const px = sideQuote(o.side, q.m);
      if (px === undefined) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: ${m.name} shows no ${o.side === "buy" ? "ask" : "bid"} just now` });
      const fillable = canFillNow(o.type === "limit" ? { type: "limit", extendedHours: o.extendedHours === true } : { type: "market" }, q, at);
      const atOnce = o.tif === "ioc" || o.tif === "fok";
      if (o.type === "market") {
        if (fillable) {
          // the account's worst price holds here as a marketable limit does: a quote past it fills nothing
          if (pastWorst(order, px)) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: the quote (${plain(px)}) is past the worst price the order allows (${plain(o.worstPrice!)}): nothing was filled`, detail: { quoted: px, worstPrice: o.worstPrice } });
          const r = fill(order, px, at, q);
          if (r) return r;
          b.orders[order.ref] = order;
          save();
          return stateOf(order);
        }
        // out of the session: queued for it, as a broker holds a market order for the open — unless it was to fill at once
        if (atOnce) {
          order.status = "canceled";
          order.note = `${o.tif}: ${m.name} is not in session now, nothing filled`;
        } else order.note = `queued for the open: ${m.name} fills when its session is on`;
        b.orders[order.ref] = order;
        save();
        return stateOf(order);
      }
      if (o.type === "limit") {
        const crossed = fillable && (o.side === "buy" ? px <= o.limitPrice! + 1e-12 : px >= o.limitPrice! - 1e-12);
        if (crossed) {
          // at the quote where it is better than the limit
          const r = fill(order, o.side === "buy" ? Math.min(px, o.limitPrice!) : Math.max(px, o.limitPrice!), at, q);
          if (r) return r;
        } else if (atOnce) {
          order.status = "canceled";
          order.note = fillable ? `${o.tif}: the quote did not cross the limit, nothing filled` : `${o.tif}: ${m.name} is not in session now, nothing filled`;
        } else if (!fillable) order.note = `resting until ${m.name}'s session is on`;
        // placed at a quote that could fill it and does not reach it: it rests from now, filled at its own price when the quote comes to it
        else rest(order, q, at);
        b.orders[order.ref] = order;
        save();
        return stateOf(order);
      }
      // a stop or a trailing stop: on the book, watched from now; one sent to fill at once is judged at once
      b.orders[order.ref] = order;
      if (atOnce) {
        await judge(order, at);
        if (order.status === "open") {
          order.status = "canceled";
          order.note = `${o.tif}: it did not trigger at once, nothing filled`;
        }
      }
      save();
      return stateOf(order);
    },

    async cancel(ref) {
      const o = b.orders[ref];
      if (!o) return no("E_ACCOUNT_ORDER_UNKNOWN", { venue, message: `${b.name} has no order ${ref}`, detail: { order: ref } });
      const at = iso(req.clock());
      if (o.status === "open") {
        o.status = "canceled";
        o.updatedAt = at;
        // one exit of a bracket canceled takes the other with it (one cancels the other)
        if (o.oco) {
          const sib = b.orders[o.oco];
          if (sib && sib.status === "open") Object.assign(sib, { status: "canceled", note: `canceled with ${o.ref}`, updatedAt: at });
        }
        save();
      } else if (o.status === "filled" && o.children?.length) {
        // an entry that filled: canceling it cancels what is left of its exits
        let any = false;
        for (const r of o.children) {
          const c = b.orders[r];
          if (c && c.status === "open") {
            Object.assign(c, { status: "canceled", note: `canceled with its entry ${o.ref}`, updatedAt: at });
            any = true;
          }
        }
        if (any) save();
      }
      return stateOf(o);
    },

    async status(ref) {
      const o = b.orders[ref];
      if (!o) return no("E_ACCOUNT_ORDER_UNKNOWN", { venue, message: `${b.name} has no order ${ref}`, detail: { order: ref } });
      await settle();
      return stateOf(o);
    },

    /** an open order changed in place: its size, its limit, its stop (a trailing stop's trail is set when it is placed). It is looked at
     * again once its quote is back — a look may have filled it, or the owner canceled it, meanwhile — and changed only if it is still open.
     * A bracketed entry keeps its exits, checked again against the entry as changed. A new limit is a new price on the book: it rests again
     * only once a quote that could fill it does not reach it */
    async amend(ref, _symbol, change) {
      const o = b.orders[ref];
      if (!o) return no("E_ACCOUNT_ORDER_UNKNOWN", { venue, message: `${b.name} has no order ${ref}`, detail: { order: ref } });
      if (o.status !== "open") return badOrder(venue, b.name, `order ${ref} is ${o.status}: only an open order is changed`);
      const q = await quote(o.symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source lists ${o.symbol.slice(0, 60)} just now` });
      if (o.status !== "open") return badOrder(venue, b.name, `order ${ref} is ${o.status}: only an open order is changed`);
      const m = marketOf(q.source, q.m);
      if (change.limitPrice !== undefined && o.type !== "limit" && o.type !== "stop_limit") return badOrder(venue, b.name, `a ${o.type.replace(/_/g, "-")} order has no limit price to change`);
      if (change.stopPrice !== undefined && o.type !== "stop" && o.type !== "stop_limit") return badOrder(venue, b.name, o.type === "trailing_stop" ? "a trailing stop's stop follows the price: it is not set by hand" : `a ${o.type} order has no stop price to change`);
      if (change.stopPrice !== undefined && o.triggeredAt) return badOrder(venue, b.name, `order ${ref} has triggered already: its stop is behind it`);
      const next = { qty: change.qty ?? o.qty, limitPrice: change.limitPrice ?? o.limitPrice, stopPrice: change.stopPrice ?? o.stopPrice };
      const bad = checkOrder({ symbol: o.symbol, side: o.side, type: o.type, qty: next.qty, clientId: o.clientId, ...(next.limitPrice !== undefined && (o.type === "limit" || o.type === "stop_limit") ? { limitPrice: next.limitPrice } : {}), ...(next.stopPrice !== undefined && o.type !== "trailing_stop" && o.type !== "limit" && o.type !== "market" ? { stopPrice: next.stopPrice } : {}), ...(o.type === "trailing_stop" ? (o.trailPercent !== undefined ? { trailPercent: o.trailPercent } : { trailPrice: o.trailPrice }) : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}), ...(o.takeProfit !== undefined ? { takeProfit: o.takeProfit } : {}), ...(o.stopLoss !== undefined ? { stopLoss: o.stopLoss } : {}) }, m);
      if (bad) return bad;
      o.qty = next.qty;
      if (change.limitPrice !== undefined) {
        o.limitPrice = change.limitPrice;
        unrest(o);
      }
      if (change.stopPrice !== undefined) o.stopPrice = change.stopPrice;
      o.updatedAt = iso(req.clock());
      await judge(o, req.clock());
      save();
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
      // what is held — coins, shares, tokens, contracts — with what the book paid for it: the book's own cost, so a paper holding's result
      // is the book's, fills the account did not place (a bracket's exit, a settlement) and all
      for (const [symbol, h] of Object.entries(b.holdings)) {
        const ref = b.markets[symbol];
        if (!ref || !(h.qty > 0)) continue;
        const q = await quote(symbol);
        const mark = pos(q?.m.price) ?? pos(q?.m.bid) ?? ref.last?.price;
        const worth = mark !== undefined ? round(h.qty * mark, 2) : undefined;
        // its entry: what was paid a unit, fees in it
        out.push({ symbol, name: ref.name, kind: ref.kind, side: "long", qty: h.qty, entryPrice: round(h.costUsd / h.qty, 10), ...(mark !== undefined ? { markPrice: mark } : {}), ...(worth !== undefined ? { usd: worth, unrealizedUsd: round(worth - h.costUsd, 2) } : {}), costUsd: round(h.costUsd, 6), native: { paper: true, book: b.id } });
      }
      return out;
    },

    /** a position closed at the market: a perpetual reduced, a holding sold — queued for the session where a stock is out of it */
    async close(symbol, qty, clientId) {
      const p = b.positions[symbol];
      const h = b.holdings[symbol];
      if (!p && !h) return no("E_VENUE_REJECTED", { venue, message: `${b.name} holds nothing in ${symbol.slice(0, 60)}` });
      const side: Side = p ? (p.side === "long" ? "sell" : "buy") : "sell";
      const held = p ? p.qty : h!.qty;
      return trader.place({ symbol, side, type: "market", qty: Math.min(qty, held), clientId, ...(p ? { reduceOnly: true } : {}) });
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

    /** the public source a market's bars and book are read from, by its name */
    async pricesFrom(symbol) {
      const q = await quote(symbol);
      return q ? (q.m.venueName ?? q.source.name) : b.markets[symbol]?.source;
    },

    /** the market's order book, as its public source gives it — the book a paper order is judged against is that source's price, and this
     * is the same source's depth. A source the account reads no book from says so with `detail.book: "none"`, so the account shows the best
     * bid and ask the market carries, as that (service.ts marketBook) — and `detail.topOnly` says whether that is all the source has (US
     * stocks' public quotes: "none") or the source has a book the account does not read ("unread": an exchange's pre-IPO contract) */
    async book(symbol, depth) {
      const q = await quote(symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source lists ${symbol.slice(0, 60)} just now` });
      if (!q.source.book) return no("E_VENUE_RAIL_CLOSED", { venue, message: `${b.name}: ${q.source.kind === "stocks" ? `${q.source.name} publishes no order book` : `the account reads no order book from ${q.source.name}`}`, detail: { book: "none", topOnly: q.source.kind === "stocks" ? "none" : "unread" } });
      return q.source.book(symbol, depth);
    },

    /** the market's latest trades, as its public source gives them */
    async trades(symbol, limit) {
      const q = await quote(symbol);
      if (!q) return no("E_VENUE_REJECTED", { venue, message: `${b.name}: no public source lists ${symbol.slice(0, 60)} just now` });
      if (!q.source.trades) return no("E_VENUE_RAIL_CLOSED", { venue, message: `${b.name}: ${q.source.name} publishes no trades` });
      return q.source.trades(symbol, limit);
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
    // the account's own look at the book, between the page's reads: resting orders judged, stops watched, exits placed, days ended, funding
    // paid, positions liquidated (service.ts watches every paper account this way)
    settle: async () => (Object.values(b.orders).some((o) => o.status === "open") || Object.keys(b.positions).length || Object.values(b.markets).some((r) => r.kind === "event") ? settle() : false),
  };
  return { source, first };
}

/** a trailing stop's stop, `best` being the best price since it was placed (the highest for a sell, the lowest for a buy) */
function trailStop(side: Side, best: number, o: Pick<PaperOrder, "trailPercent" | "trailPrice">): number {
  const by = o.trailPercent !== undefined ? (best * o.trailPercent) / 100 : (o.trailPrice ?? 0);
  return round(side === "sell" ? best - by : best + by, 10);
}
