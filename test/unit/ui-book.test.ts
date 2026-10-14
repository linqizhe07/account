import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The order book panel's own logic (ui/book.js), run as the page runs it: a plain script in one global scope after ui/core.js, here in a vm
 * with a stand-in document and fetch. What is checked is what the owner reads and presses: the ladder's rows from a book (the offers above,
 * the best ask by the middle, the bids below, each with its running total and its bar's share), grouping that only adds up real sizes, the
 * spread row's words, a book with no depth said as that, an event contract in cents, a row pressed handing its price to the ticket, a
 * refusal in its own words, and an answer for a market no longer showing dropped */
const UI = fileURLToPath(new URL("../../src/portfolio/public/ui/", import.meta.url));
const FILES = ["core.js", "book.js"];

type Fetcher = (path: string) => Promise<unknown>;
/** a stand-in panel element: every part the panel looks for is an element of its own, kept by its selector, so what was drawn into it can
 * be read back; listeners are kept to be fired by hand */
function panel() {
  const parts = new Map<string, Record<string, unknown>>();
  const part = (): Record<string, unknown> => ({ innerHTML: "", hidden: false, value: "", dataset: {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null });
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const el = {
    innerHTML: "",
    isConnected: true as boolean,
    dataset: {},
    addEventListener(t: string, f: (e: unknown) => void) {
      (listeners[t] ??= []).push(f);
    },
    contains: () => true,
    querySelector(sel: string) {
      if (!parts.has(sel)) parts.set(sel, part());
      return parts.get(sel);
    },
    querySelectorAll: () => [],
  };
  const html = (sel: string) => String(parts.get(sel)?.innerHTML ?? "");
  const fire = (type: string, e: unknown) => (listeners[type] ?? []).forEach((f) => f(e));
  return { el, html, fire };
}

function page(fetcher?: Fetcher) {
  const asked: string[] = [];
  const element = (): Record<string, unknown> => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, hidden: false, innerHTML: "", textContent: "", value: "" });
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" } }, visibilityState: "visible" },
    location: { hash: "", origin: "http://127.0.0.1:4820" },
    history: { replaceState() {} },
    Owner: { role: "owner", kid: "k1", why: () => "" },
    addEventListener() {},
    dispatchEvent: () => true,
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    fetch: async (path: string) => {
      asked.push(path);
      if (!fetcher) return new Promise(() => {});
      const body = await fetcher(path);
      return { status: (body as { ok?: boolean })?.ok === false ? 409 : 200, statusText: "", json: async () => body };
    },
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  for (const f of FILES) new Script(readFileSync(`${UI}${f}`, "utf8"), { filename: f }).runInContext(ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  const fn = <T = unknown>(name: string) => run<(...a: unknown[]) => T>(name);
  return { run, fn, asked, sandbox };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
/** every panel mounted in a test is released after it, so no timer outlives it */
const mounted: Array<{ release: () => void }> = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.release();
});

const BTC = { bids: [[81768, 14.31819], [81767, 0.20924], [81766, 1.58891]], asks: [[81769, 6.21438], [81770, 0.03668], [81772, 0.01202]], at: "2026-10-14T17:30:00.000Z", from: "Hyperliquid", depth: "full" };

describe("the ladder", () => {
  it("draws the offers above (the best ask last, by the middle) and the bids below, each with its running total and its share of the deepest", () => {
    const p = page();
    const lad = p.fn<{ asks: Array<{ p: number; s: number; t: number; w: number }>; bids: Array<{ p: number; s: number; t: number; w: number }>; spread: { abs: number; pct: number } }>("bkLadder")(BTC, { rows: 3 });
    expect(lad.asks.map((r) => r.p)).toEqual([81772, 81770, 81769]);
    expect(lad.bids.map((r) => r.p)).toEqual([81768, 81767, 81766]);
    // running totals from the best outward
    expect(lad.asks.map((r) => r.t)).toEqual([6.26308, 6.25106, 6.21438]);
    expect(lad.bids.map((r) => r.t)).toEqual([14.31819, 14.52743, 16.11634]);
    // every bar's share is its running total over the deepest running total on either side: the bids' last is the whole width
    expect(lad.bids[2]!.w).toBe(1);
    expect(lad.asks[2]!.w).toBeCloseTo(6.21438 / 16.11634, 10);
    expect(lad.spread.abs).toBe(1);
    // fewer rows: the best ones
    expect(p.fn<{ asks: Array<{ p: number }> }>("bkLadder")(BTC, { rows: 1 }).asks.map((r) => r.p)).toEqual([81769]);
  });

  it("groups by flooring bids and ceiling asks to the group, adding up only the sizes the source gave", () => {
    const p = page();
    const group = p.fn<number[][]>("bkGroup");
    expect(group([[100.7, 1], [100.2, 2], [99.9, 3]], "bids", 1)).toEqual([[100, 3], [99, 3]]);
    expect(group([[100.8, 1], [101, 2], [101.3, 4]], "asks", 1)).toEqual([[101, 3], [102, 4]]);
    // a tenth-of-a-unit group, its prices without binary tails (3 × 0.1 is 0.30000000000000004 in binary), best first whatever came
    expect(group([[0.31, 1], [0.39, 2], [0.42, 3]], "bids", 0.1)).toEqual([[0.4, 3], [0.3, 3]]);
    // no group: the levels as they came
    expect(group([[100.7, 1]], "bids", 0)).toEqual([[100.7, 1]]);
    // the ladder grouped: the sum of every level in a row, and no row that the source did not fill
    const lad = p.fn<{ bids: Array<{ p: number; s: number }> }>("bkLadder")({ ...BTC, bids: [[81768, 1], [81761, 2], [81750, 4], [81689, 8]] }, { rows: 5, group: 10 });
    expect(lad.bids.map((r) => [r.p, r.s])).toEqual([[81760, 3], [81750, 4], [81680, 8]]);
    // the groupings a tick allows: 1x, 10x, 100x — an event contract's only under a dollar
    expect(p.fn("bkGroups")(0.1, "spot")).toEqual([1, 10, 100]);
    expect(p.fn("bkGroups")(0.01, "event")).toEqual([1, 10]);
    expect(p.fn("bkGroups")(undefined, "perp")).toEqual([]);
  });

  it("says the spread in the market's own figures and in percent of the middle; an event contract's in cents", () => {
    const p = page();
    const words = p.fn<string>("bkSpreadWords");
    expect(words(BTC, { priceStep: 1 })).toBe("Spread 1 · 0.0012%");
    expect(words({ bids: [[0.34, 2]], asks: [[0.35, 4]], depth: "full" }, { kind: "event", priceStep: 0.01 })).toBe("Spread 1¢ · 2.90%");
    expect(words({ bids: [[0.34, 2]], asks: [], depth: "full" }, { kind: "event", priceStep: 0.01 })).toBe("Spread — · one side of the book is empty");
    expect(p.fn("bkPrice")(0.625, { kind: "event", priceStep: 0.001 })).toBe("62.5¢");
    expect(p.fn("bkPrice")(0.62, { kind: "event", priceStep: 0.01 })).toBe("62¢");
    expect(p.fn("bkPrice")(81768, { priceStep: 0.1 })).toBe("81,768.0");
    expect(p.fn("bkPrice")(81768.5, {})).toBe("81,768.5");
  });

  it("says a book with no depth as that: its two rows, no size, and the quiet line naming whose quote it is", () => {
    const p = page();
    const top = { bids: [[189.98, null]], asks: [[190.02, null]], at: "2026-10-14T17:30:00.000Z", from: "Nasdaq · real time", depth: "top", topOnly: "none" };
    const at = Date.parse(top.at);
    const line = p.fn<string>("bkTopLine");
    expect(line(top, at + 2_000)).toBe("Best bid and ask only: Nasdaq · real time gives no depth");
    // a source with a book the account does not read is never said to have none
    expect(line({ ...top, from: "OKX", topOnly: "unread" }, at + 2_000)).toBe("Best bid and ask only: the account reads no depth from OKX");
    expect(line({ ...top, from: "OKX", topOnly: undefined }, at + 2_000)).toBe("Best bid and ask only: the account reads no depth from OKX");
    // a quote more than a few seconds old says when it is from (a listing is kept up to ninety): never taken for a live book
    const d = new Date(at);
    const two = (x: number) => String(x).padStart(2, "0");
    expect(line(top, at + 80_000)).toBe(`Best bid and ask only: Nasdaq · real time gives no depth · quoted at ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`);
    // a quote with no time of its own, from a list kept a while: how long, whatever its read time says
    expect(line({ ...top, from: "OKX", topOnly: "unread", upToMs: 90_000 }, at)).toBe("Best bid and ask only: the account reads no depth from OKX · from a list kept up to 90 s");
    const lad = p.fn<{ asks: Array<{ s: unknown; t: unknown; w: number }>; bids: unknown[]; top: boolean }>("bkLadder")(top, { rows: 12, group: 1 });
    // never grouped: the two prices are the source's own
    expect(lad.asks).toEqual([{ p: 190.02, s: null, t: null, w: 0 }]);
    expect(lad.bids).toEqual([{ p: 189.98, s: null, t: null, w: 0 }]);
    expect(p.fn("bkSize")(null)).toBe("—");
    expect(p.fn("bkTopLine")(BTC)).toBe("");
  });
});

describe("the panel", () => {
  it("draws the book it read: rows in the market's precision, the spread row, an event contract in cents; a row pressed hands its price on", async () => {
    const book = { bids: [[0.34, 2.24], [0.33, 50004.76]], asks: [[0.35, 4095.99], [0.36, 288.5]], at: "2026-10-14T17:30:00.000Z", from: "Kalshi", depth: "full" };
    const p = page(async (path) => (path.startsWith("/api/account/book") ? { ok: true, venue: "kalshi", venueName: "Kalshi", symbol: "KXFED:YES", book } : { ok: true, trades: [] }));
    const { el, html, fire } = panel();
    const prices: number[] = [];
    p.fn("bkMount")(el, { venue: "kalshi", symbol: "KXFED:YES", kind: "event", quote: "USD", priceStep: 0.01, onPrice: (x: number) => prices.push(x) });
    mounted.push({ release: () => p.fn("bkRelease")(el) });
    await settle();
    await settle();
    expect(p.asked).toEqual(["/api/account/book?venue=kalshi&symbol=KXFED%3AYES&depth=20"]);
    const asks = html("[data-bk-asks]");
    // the worse ask first, the best (35¢) last — by the spread row
    expect(asks.indexOf("36¢")).toBeLessThan(asks.indexOf("35¢"));
    expect(asks).toContain('data-bk-px="0.35"');
    expect(html("[data-bk-bids]")).toContain("50,004.76");
    expect(html("[data-bk-mid]")).toContain("Spread 1¢ · 2.90%");
    expect(html("[data-bk-note]")).toBe("");
    // the frame: the two tabs, the grouping a 1¢ tick allows (1¢ and 10¢)
    expect(el.innerHTML).toContain(">Order book</button>");
    expect(el.innerHTML).toContain('<option value="10">10¢</option>');
    // a row pressed: its price, in dollars, to the ticket
    fire("click", { target: { closest: (sel: string) => (sel === "[data-bk-px]" ? { dataset: { bkPx: "0.35" } } : null) } });
    expect(prices).toEqual([0.35]);
  });

  it("shows the refusal's own words, escaped; a book with no depth with its quiet line", async () => {
    let answer: unknown = { ok: false, refusal: { code: "E_VENUE_GEOBLOCKED", message: "Binance does not serve this location <b>" } };
    const p = page(async () => answer);
    const { el, html } = panel();
    p.fn("bkMount")(el, { venue: "binance", symbol: "BTC/USDT", kind: "spot", quote: "USDT", priceStep: 0.01 });
    mounted.push({ release: () => p.fn("bkRelease")(el) });
    await settle();
    await settle();
    expect(html("[data-bk-mid]")).toContain("Binance does not serve this location &lt;b&gt;");
    expect(html("[data-bk-asks]")).toBe("");
    // the next mount, a stock with no depth
    answer = { ok: true, book: { bids: [[189.98, null]], asks: [[190.02, null]], at: new Date().toISOString(), from: "Nasdaq <i>", depth: "top", topOnly: "none" } };
    p.fn("bkMount")(el, { venue: "us-stocks", symbol: "AAPL", kind: "stock", quote: "USD", priceStep: 0.01 });
    await settle();
    await settle();
    expect(html("[data-bk-note]")).toBe("Best bid and ask only: Nasdaq &lt;i&gt; gives no depth");
    expect(html("[data-bk-asks]")).toContain("190.02");
    expect(html("[data-bk-asks]")).toContain('<span class="bk-s">—</span>');
  });

  it("drops an answer for a market no longer showing: the market switched before it came", async () => {
    const waiting = new Map<string, (b: unknown) => void>();
    const p = page((path) => new Promise((resolve) => waiting.set(path, resolve)));
    const { el, html } = panel();
    p.fn("bkMount")(el, { venue: "kraken", symbol: "BTC/USD", kind: "spot", quote: "USD", priceStep: 0.1 });
    p.fn("bkMount")(el, { venue: "kraken", symbol: "ETH/USD", kind: "spot", quote: "USD", priceStep: 0.01 });
    mounted.push({ release: () => p.fn("bkRelease")(el) });
    await settle();
    const eth = [...waiting.keys()].find((k) => k.includes("ETH"))!;
    const btc = [...waiting.keys()].find((k) => k.includes("BTC"))!;
    waiting.get(eth)!({ ok: true, book: { bids: [[2999.5, 1]], asks: [[3000.5, 2]], at: "2026-10-14T17:30:00.000Z", from: "Kraken", depth: "full" } });
    await settle();
    await settle();
    waiting.get(btc)!({ ok: true, book: BTC });
    await settle();
    await settle();
    expect(html("[data-bk-asks]")).toContain("3,000.50");
    expect(html("[data-bk-asks]")).not.toContain("81,769");
  });

  it("reads the trades when their tab is pressed: time, price coloured by the side that took it, size", async () => {
    const at = Date.parse("2026-10-14T17:29:13.000Z");
    const p = page(async (path) => (path.startsWith("/api/account/trades") ? { ok: true, trades: [{ price: 81769, size: 0.00431, side: "buy", at: new Date(at).toISOString() }, { price: 81768, size: 0.5, at: new Date(at - 1000).toISOString() }] } : { ok: true, book: BTC }));
    const { el, html, fire } = panel();
    p.fn("bkMount")(el, { venue: "hyperliquid", symbol: "BTC-PERP", kind: "perp", quote: "USDC" });
    mounted.push({ release: () => p.fn("bkRelease")(el) });
    fire("click", { target: { closest: (sel: string) => (sel === "[data-bk-tab]" ? { dataset: { bkTab: "trades" } } : null) } });
    await settle();
    await settle();
    expect(p.asked).toContain("/api/account/trades?venue=hyperliquid&symbol=BTC-PERP&limit=30");
    const tape = html("[data-bk-tape]");
    const d = new Date(at);
    const two = (x: number) => String(x).padStart(2, "0");
    expect(tape).toContain(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`);
    expect(tape).toContain('<span class="bk-p bk-buy">81,769<span class="sr"> bought</span></span>');
    // a trade whose source says no side: no colour, no word
    expect(tape).toContain('<span class="bk-p">81,768</span>');
  });

  it("reads nothing while the page is hidden or the panel is out of the document, and stops itself then", async () => {
    const p = page(async () => ({ ok: true, book: BTC }));
    (p.sandbox.document as { visibilityState: string }).visibilityState = "hidden";
    const { el } = panel();
    p.fn("bkMount")(el, { venue: "kraken", symbol: "BTC/USD", kind: "spot", quote: "USD", priceStep: 0.1 });
    mounted.push({ release: () => p.fn("bkRelease")(el) });
    await settle();
    expect(p.asked).toEqual([]);
    (p.sandbox.document as { visibilityState: string }).visibilityState = "visible";
    el.isConnected = false;
    p.fn("bkMount")(el, { venue: "kraken", symbol: "BTC/USD", kind: "spot", quote: "USD", priceStep: 0.1 });
    await settle();
    expect(p.asked).toEqual([]);
    // mounted before its element was placed, it waits; on its beat, still out of the document, it lets go of itself
    expect(p.fn<boolean>("(el) => BK.has(el)")(el)).toBe(true);
    expect(p.fn<boolean>("(el) => bkLive(el, BK.get(el))")(el)).toBe(false);
    expect(p.fn<boolean>("(el) => BK.has(el)")(el)).toBe(false);
  });
});

describe("what the review found", () => {
  it("marks the group at the far end of a side that may go on as only part of its range — at least that much, never the whole", () => {
    const p = page();
    const group = p.fn<unknown[][]>("bkGroup");
    // fifty bids of 1 each, 81768 down to 81719, grouped by 10: the last group (81710–81719) holds one level read, the rest never read
    const bids = Array.from({ length: 50 }, (_, i) => [81768 - i, 1]);
    expect(group(bids, "bids", 10, true)).toEqual([[81760, 9], [81750, 10], [81740, 10], [81730, 10], [81720, 10], [81710, 1, true]]);
    // a side the source sent whole: every group is whole
    expect(group(bids, "bids", 10, false).at(-1)).toEqual([81710, 1]);
    // the worst level on its group's own far edge (a bid at the group's floor): nothing unread can fall inside it
    expect(group(bids.slice(0, 49), "bids", 10, true).at(-1)).toEqual([81720, 10]);
    // the offers the other way: an ask is ceiled, its group's far edge is its top
    expect(group([[100.2, 1], [100.7, 2], [101.3, 4]], "asks", 1, true)).toEqual([[101, 3], [102, 4, true]]);
    expect(group([[100.2, 1], [100.7, 2], [102, 4]], "asks", 1, true)).toEqual([[101, 3], [102, 4]]);
    // the ladder: the book's own word on each side (more), the row and its running total "at least"
    const lad = p.fn<{ bids: Array<{ p: number; s: number; t: number; part?: boolean }>; asks: Array<{ part?: boolean }> }>("bkLadder")({ bids, asks: [[81769, 1]], at: "", from: "Hyperliquid", depth: "full", more: { bids: true, asks: false } }, { rows: 10, group: 10 });
    expect(lad.bids.at(-1)).toMatchObject({ p: 81710, s: 1, t: 50, part: true });
    expect(lad.bids.filter((r) => r.part).length).toBe(1);
    expect(lad.asks.some((r) => r.part)).toBe(false);
    // a book that does not say: taken as one that may go on
    expect(p.fn<{ bids: Array<{ part?: boolean }> }>("bkLadder")({ bids, asks: [], depth: "full" }, { rows: 10, group: 10 }).bids.at(-1)!.part).toBe(true);
    const row = p.fn<string>("bkRowHtml")(lad.bids.at(-1), "bid", { priceStep: 1 }, 10);
    expect(row).toContain('<span class="bk-s">≥ 1</span><span class="bk-t">≥ 50</span>');
    expect(row).toContain("only part of this range was read: at least this much rests here");
    expect(row).toContain("bk-part");
  });

  it("prints a price to its tick, but never to fewer decimals than the price itself has", () => {
    const p = page();
    const price = p.fn<string>("bkPrice");
    // a paper account says 0.01 for every event; Polymarket trades this one on a 0.001 tick: 99.9¢ is never shown as 100¢
    expect([0.999, 0.993, 0.991].map((x) => price(x, { kind: "event", priceStep: 0.01 }))).toEqual(["99.9¢", "99.3¢", "99.1¢"]);
    expect(price(0.62, { kind: "event", priceStep: 0.01 })).toBe("62¢");
    // no tick known: whole cents unless the price needs more
    expect(price(0.62, { kind: "event" })).toBe("62¢");
    expect(price(0.625, { kind: "event" })).toBe("62.5¢");
    // a fill's price as the Data API wrote it, to six decimals of a cent at most
    expect(price(0.3399999477, { kind: "event", priceStep: 0.01 })).toBe("33.999995¢");
    expect(price(81768.5, { priceStep: 1 })).toBe("81,768.5");
    expect(price(81768, { priceStep: 1 })).toBe("81,768");
    expect(price(1.23456789123, { priceStep: 0.01 })).toBe("1.23456789");
    // a grouped row on its group's grid
    expect(price(81760, { priceStep: 0.1 }, 10)).toBe("81,760");
  });

  it("says a tiny spread in plain figures, never in exponent notation", () => {
    const p = page();
    expect(p.fn("bkSpreadWords")({ bids: [[100000, 1]], asks: [[100000.0001, 1]], depth: "full" }, {})).toBe("Spread 0.0001 · 0.0000001%");
  });

  it("reads nothing while its pane is put aside (hidden, still in the document) — it waits — and reads again once the pane comes back", async () => {
    vi.useFakeTimers();
    try {
      const p = page(async () => ({ ok: true, book: BTC }));
      const { el } = panel();
      let rects: unknown[] = [];
      Object.assign(el, { getClientRects: () => rects });
      p.fn("bkMount")(el, { venue: "kraken", symbol: "BTC/USD", kind: "spot", quote: "USD", priceStep: 0.1 });
      await vi.advanceTimersByTimeAsync(60_000);
      // a minute on another pane: nothing asked, and the panel still mounted
      expect(p.asked).toEqual([]);
      expect(p.fn<boolean>("(el) => BK.has(el)")(el)).toBe(true);
      rects = [{ width: 300, height: 400 }];
      await vi.advanceTimersByTimeAsync(2_000);
      expect(p.asked).toEqual(["/api/account/book?venue=kraken&symbol=BTC%2FUSD&depth=20"]);
      p.fn("bkRelease")(el);
    } finally {
      vi.useRealTimers();
    }
  });
});
