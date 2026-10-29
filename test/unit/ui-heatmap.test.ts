import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

/** The heatmap (ui/heatmap.js) under the Markets pane (ui/markets.js), run as the page runs them — after ui/core.js, in one global scope
 * — in a stand-in browser: the squarified layout (areas as the market caps, inside the box, nowhere twice), the tone a change gives a
 * tile, what the pane draws from a heatmap read (the tab, the sector bands, the tiles, the legend, the crumb when zoomed), and that a tile
 * opens its market as every market opens. No server: the reads are answered here */
const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const NOW = Date.parse("2026-10-28T17:05:00.000Z");

const account = (over: Record<string, unknown> = {}) => ({ now: new Date(NOW).toISOString(), venues: [], connectLive: { home: "/home/x", writes: { on: true, capUsd: 250, turnOn: "npm run account" }, options: [] }, watch: [], cards: [], orders: [], intents: [], asks: [], keys: [], requests: [], dial: { revoked: [] }, health: {}, mode: "guard", ...over });
const tile = (symbol: string, name: string, sector: string, industry: string, capB: number, changePct?: number, price?: number) => ({ symbol, name, sector, industry, country: "United States", marketCap: capB * 1e9, ...(changePct !== undefined ? { price, change: Number(((price! * changePct) / 100).toFixed(2)), changePct, prevClose: price, quoteAt: "2026-10-28T17:03:53.361Z", quoteFrom: "Nasdaq · real time" } : {}) });
const TILES = [
  tile("NVDA", "NVIDIA Corporation", "Technology", "Semiconductors", 5252, -0.15, 217.615),
  tile("AAPL", "Apple Inc.", "Technology", "Computer Manufacturing", 5065, -0.45, 345.55),
  tile("GOOGL", "Alphabet Inc.", "Technology", "Computer Software: Programming Data Processing", 3920, 1.19, 324.4),
  tile("AMZN", "Amazon.com Inc.", "Consumer Discretionary", "Catalog/Specialty Distribution", 2700, 1.62, 257.2),
  tile("JPM", "JP Morgan Chase & Co.", "Finance", "Major Banks", 930, 1.32, 340.21),
  tile("XOM", "Exxon Mobil Corporation", "Energy", "Integrated oil Companies", 500),
];
const HEAT = (over: Record<string, unknown> = {}) => ({
  ok: true,
  readAt: new Date(NOW).toISOString(),
  n: 250,
  count: 6,
  universe: { from: "Nasdaq stock screener · market cap at the last close", readAt: new Date(NOW).toISOString(), listed: 5716 },
  quotes: { from: "Nasdaq · real time", keptMs: 45_000, priced: 5, at: "2026-10-28T17:03:53.361Z", oldest: "2026-10-28T17:03:53.361Z", marketStatus: "Market Open" },
  session: { open: true, closesAt: "2026-10-28T20:00:00.000Z", phase: "regular", phaseEndsAt: "2026-10-28T20:00:00.000Z", extendedHours: false },
  sectors: [{ name: "Technology", count: 3, marketCap: 14237e9, priced: 3, changePct: 0.12 }, { name: "Consumer Discretionary", count: 1, marketCap: 2700e9, priced: 1, changePct: 1.62 }, { name: "Finance", count: 1, marketCap: 930e9, priced: 1, changePct: 1.32 }, { name: "Energy", count: 1, marketCap: 500e9, priced: 0 }],
  tiles: TILES,
  notes: ["Sized by market cap at the last close, from Nasdaq's stock screener (5,716 shares of US-listed companies that day; preferred shares, notes, warrants, rights, units and blank-check companies left out). Coloured by each share's change from its last regular close, Nasdaq's own real-time quote, read 20 shares a call and kept 45 s; a share Nasdaq did not price is grey."],
  ...over,
});

/** the page's scripts in a stand-in browser: elements that take listeners, a clock fixed at NOW, reads answered by `answer` */
function page(answer: (path: string) => unknown) {
  const asked: string[] = [];
  // an element's parts are elements too (the drawer's body), so what opens one opens it
  const element = (): Record<string, unknown> => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => element(), classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, hidden: false, open: false, show() {}, showModal() {}, close() {}, value: "", textContent: "", innerHTML: "", appendChild() {}, closest: () => null, contains: () => false, isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) });
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a: ConstructorParameters<typeof Date>) {
      super(...((a.length ? a : [NOW]) as ConstructorParameters<typeof Date>));
    }
    static override now() {
      return NOW;
    }
  }
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: element, body: element(), documentElement: { dataset: {}, clientWidth: 1280, clientHeight: 800 }, hidden: false, activeElement: null },
    location: { hash: "#/markets?tab=heatmap", origin: "http://127.0.0.1:4820" },
    history: { replaceState() {} },
    Owner: { role: "owner", why: (r: { body?: { refusal?: { message?: string } } }) => r.body?.refusal?.message ?? "" },
    Event: class {
      constructor(readonly type: string) {}
    },
    addEventListener() {},
    dispatchEvent: () => true,
    innerWidth: 1280,
    innerHeight: 800,
    fetch: async (path: string) => {
      asked.push(path);
      const body = await answer(path);
      return { status: (body as { ok?: boolean })?.ok === false ? 409 : 200, statusText: "", json: async () => body };
    },
    console,
    URLSearchParams,
    Intl,
    Date: FixedDate,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  // the page's order: the contract, the connections, the holding's opener, the pane, then the map it draws
  for (const f of ["ui/core.js", "ui/connect.js", "ui/asset.js", "ui/markets.js", "ui/heatmap.js"]) new Script(readFileSync(join(PUBLIC, f), "utf8"), { filename: f }).runInContext(ctx);
  const run = <T = unknown>(code: string) => runInContext(code, ctx) as T;
  return { run, asked, set: (name: string, value: unknown) => run(`${name} = ${JSON.stringify(value)}`) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
/* a pane element, as the shell hands one over, a thousand px wide */
const PANE = 'var EL = { innerHTML: "", dataset: {}, addEventListener() {}, querySelectorAll: () => [], contains: () => false, clientWidth: 1000 }';
type Box = { x: number; y: number; w: number; h: number };
const area = (b: Box) => b.w * b.h;
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (b: Box, x: number, y: number, w: number, h: number) => b.x >= x - 1e-6 && b.y >= y - 1e-6 && b.x + b.w <= x + w + 1e-6 && b.y + b.h <= y + h + 1e-6;

describe("the layout (hmSquarify, hmLayout)", () => {
  it("packs areas as their values, each row along the shorter side, as the squarified treemap is defined — the paper's own example", () => {
    const p = page(() => ({}));
    // Bruls, Huizing and van Wijk: 6, 6, 4, 3, 2, 2, 1 in a 6 × 4 box
    const boxes = p.run<Box[]>("hmSquarify([6, 6, 4, 3, 2, 2, 1].map((v) => ({ v })), 0, 0, 6, 4)");
    expect(boxes).toHaveLength(7);
    expect(boxes[0]).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    expect(boxes[1]).toEqual({ x: 0, y: 2, w: 3, h: 2 });
    expect(boxes[2]!.x).toBeCloseTo(3, 6);
    expect(boxes[2]!.w).toBeCloseTo(4 / (7 / 3), 6);
    expect(boxes[2]!.h).toBeCloseTo(7 / 3, 6);
    expect(boxes[3]!.w).toBeCloseTo(3 / (7 / 3), 6);
    const total = boxes.reduce((s, b) => s + area(b), 0);
    expect(total).toBeCloseTo(24, 6);
    for (let i = 0; i < boxes.length; i++) {
      expect(inside(boxes[i]!, 0, 0, 6, 4), `box ${i}`).toBe(true);
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!), `${i} and ${j}`).toBeCloseTo(0, 6);
    }
    // an item with no value gets no box, and nothing when there is no box to fill
    expect(p.run<Box[]>("hmSquarify([{ v: 2 }, { v: 0 }, { v: 1 }], 0, 0, 3, 1)").map((b) => b && Number(area(b).toFixed(6)))).toEqual([2, undefined, 1]);
    expect(p.run<Box[]>("hmSquarify([{ v: 2 }], 0, 0, 0, 10)")).toEqual([]);
  });

  it("lays the sectors by their summed caps and the tiles inside each, under its name strip, every tile inside its sector and no two over each other", () => {
    const p = page(() => ({}));
    p.set("T", TILES);
    const laid = p.run<{ groups: Array<Box & { name: string; head: boolean; tiles: Array<Box & { t: { symbol: string } }> }> }>("hmLayout(T, (t) => t.sector, 1000, 560)");
    expect(laid.groups.map((g) => g.name)).toEqual(["Technology", "Consumer Discretionary", "Finance", "Energy"]);
    const total = laid.groups.reduce((s, g) => s + area(g), 0);
    expect(total).toBeCloseTo(1000 * 560, 3);
    // the largest sector takes the largest share of the map; its first tile is its largest company
    expect(area(laid.groups[0]!) / total).toBeCloseTo(14237 / 18367, 6);
    expect(laid.groups[0]!.tiles.map((x) => x.t.symbol)).toEqual(["NVDA", "AAPL", "GOOGL"]);
    for (const g of laid.groups) {
      expect(g.head).toBe(true);
      for (const x of g.tiles) {
        expect(inside(x, 0, 18, g.w, g.h - 18), `${x.t.symbol} in ${g.name}`).toBe(true);
        expect(x.w).toBeGreaterThan(0);
      }
      for (let i = 0; i < g.tiles.length; i++) for (let j = i + 1; j < g.tiles.length; j++) expect(overlap(g.tiles[i]!, g.tiles[j]!)).toBeCloseTo(0, 6);
    }
    // the two Alphabet classes beside each other, by cap: NVDA's tile is the larger
    expect(area(laid.groups[0]!.tiles[0]!)).toBeGreaterThan(area(laid.groups[0]!.tiles[2]!));
  });

  it("gives a tile its tone and depth from its change and the scale, and only the words that fit", () => {
    const p = page(() => ({}));
    expect(p.run("[hmTone(1.5, 3), hmTone(-4, 3), hmTone(0, 3), hmTone(0.002, 3), hmTone(undefined, 3), hmTone(2.5, 5)]")).toEqual([{ cls: "up", t: 0.5 }, { cls: "down", t: 1 }, { cls: "flat", t: 0 }, { cls: "flat", t: 0 }, { cls: "flat", t: 0 }, { cls: "up", t: 0.5 }]);
    expect(p.run('[hmPct(1.123), hmPct(-0.45), hmPct(0), hmPct(undefined)]')).toEqual(["+1.12%", "−0.45%", "0.00%", ""]);
    expect(p.run('[hmText(10, 10, "NVDA"), hmText(120, 60, "NVDA"), hmText(40, 20, "NVDA"), hmText(300, 200, "A"), hmText(30, 14, "GOOGL")]')).toEqual([{ sym: 0, chg: 0 }, { sym: 25, chg: 14 }, { sym: 11, chg: 0 }, { sym: 30, chg: 14 }, { sym: 0, chg: 0 }]);
    expect(p.run('hmLabel({ name: "NVIDIA Corporation", symbol: "NVDA", changePct: -0.15, price: 217.615 })')).toBe("NVIDIA Corporation, NVDA, down 0.15%, $217.62");
    expect(p.run('hmLabel({ name: "Exxon Mobil Corporation", symbol: "XOM" })')).toBe("Exxon Mobil Corporation, XOM, not priced by Nasdaq just now");
  });
});

describe("the Heatmap tab in the Markets pane", () => {
  it("is listed after Stocks (after every tab the account lists where there is no Stocks), and is a tab the pane knows", () => {
    const p = page(() => ({}));
    p.set("A", account());
    expect(p.run<string>('mkTabs({ tab: "heatmap", q: "" }, { tabs: [{ id: "all", label: "All" }, { id: "crypto", label: "Crypto" }, { id: "stocks", label: "Stocks" }, { id: "perps", label: "Perps" }] })').match(/data-tab="([a-z]*)"/g)).toEqual(['data-tab="all"', 'data-tab="crypto"', 'data-tab="stocks"', 'data-tab="heatmap"', 'data-tab="perps"']);
    expect(p.run<string>('mkTabs({ tab: "all", q: "" }, { tabs: [{ id: "all", label: "All" }, { id: "crypto", label: "Crypto" }] })').match(/data-tab="([a-z]*)"/g)).toEqual(['data-tab="all"', 'data-tab="crypto"', 'data-tab="heatmap"']);
    expect(p.run('mkParams({ tab: "heatmap" })')).toEqual({ tab: "heatmap", q: "", sort: "", bogus: false });
    // a search typed on the heatmap is a search of every market
    expect(p.run('mkParams({ tab: "heatmap", q: "nvda" })')).toEqual({ tab: "", q: "nvda", sort: "", bogus: true });
    expect(p.run('hmParams({ n: "500", scale: "5", sector: "Technology" })')).toEqual({ n: 500, scale: 5, sector: "Technology" });
    expect(p.run('hmParams({ n: "7", scale: "2" })')).toEqual({ n: 250, scale: 3, sector: "" });
  });

  it("draws the map from the read: the session line, the picks, the sector bands with their changes, every tile with its tone and words, the legend and the footer's notes", async () => {
    // a tile's market, read by name when it is opened, as the US stocks line lists it
    const nvda = { key: "stock:NVDA", kind: "stock", name: "NVIDIA Corporation", base: "NVDA", price: 217.6, changePct24h: -0.15, tabs: ["all", "stocks"], at: [{ venue: "cboe", venueName: "US stocks", symbol: "NVDA", connected: false, canTrade: false, public: true, price: 217.6, connectTo: "alpaca", connector: "live:alpaca" }] };
    const p = page((path) => (path.startsWith("/api/account/heatmap") ? HEAT() : path.startsWith("/api/account/explore?q=NVDA") ? { ok: true, asOf: new Date(NOW).toISOString(), tabs: [{ id: "all", label: "All", count: 1 }, { id: "stocks", label: "Stocks", count: 1 }], items: [nvda], movers: [], closing: [], mostTraded: [], missing: [], notes: [] } : {}));
    p.set("A", account());
    p.run(`ROUTE.tab = "markets"; ROUTE.params = { tab: "heatmap" }; ${PANE}`);
    p.run('renderMarkets({ el: EL, owner: true, lens: lensNow(), params: { tab: "heatmap" } })');
    // a skeleton the size the map will be, while the read is on its way
    expect(p.run<string>("EL.innerHTML")).toContain('class="hm-map hm-skel" data-hm-map');
    expect(p.asked).toContain("/api/account/heatmap?n=250");
    await settle();
    await settle();
    const html = p.run<string>("EL.innerHTML");
    expect(html).toContain('data-act="tab" data-tab="heatmap" data-fk="tab:heatmap" aria-pressed="true"');
    expect(html).toContain("<b>US stocks</b> · Open");
    expect(html).toContain("Nasdaq · real time · 13:03 New York · 5 of 6 priced");
    expect(html).toContain('data-act="hm-n" data-v="250" data-fk="hm-n:250" aria-pressed="true">Top 250</button>');
    expect(html).toContain('data-act="hm-scale" data-v="3" data-fk="hm-scale:3" aria-pressed="true">±3%</button>');
    expect(html).toContain('<div class="hm-map" data-hm-map data-hm-n="250" style="height:560px">');
    // the sector bands, each a button that zooms in, with its cap-weighted change
    expect(html).toContain('data-hm-act="zoom" data-hm-v="Technology" data-fk="hm-sector:Technology"');
    // the band's change is the page's own sum over the tiles it draws (the same rule as the account's `sectors`, and the industries' when zoomed)
    expect(html).toContain('aria-label="Technology, up 0.11%, 3 shares: zoom in">Technology <span class="hm-grp-c up">+0.11%</span></button>');
    expect(html).toContain('aria-label="Energy, 1 share: zoom in">Energy</button>');
    // the tiles: down, up, and grey where Nasdaq did not price the share
    expect(html).toMatch(/<button type="button" class="hm-tile down" data-hm-act="open" data-hm-sym="NVDA" data-k="NVDA" data-fk="hm:NVDA" style="left:[\d.]+px;top:[\d.]+px;width:[\d.]+px;height:[\d.]+px;--t:0\.05" aria-label="NVIDIA Corporation, NVDA, down 0\.15%, \$217\.62"><span class="hm-sym" style="font-size:\d+px">NVDA<\/span><span class="hm-chg" style="font-size:\d+px">−0\.15%<\/span><\/button>/);
    expect(html).toMatch(/class="hm-tile up" data-hm-act="open" data-hm-sym="GOOGL"[^>]*--t:0\.40"/);
    expect(html).toMatch(/class="hm-tile flat" data-hm-act="open" data-hm-sym="XOM"[^>]*--t:0\.00" aria-label="Exxon Mobil Corporation, XOM, not priced by Nasdaq just now"/);
    expect(html).toContain('<div class="hm-legend"><span>−3%</span>');
    expect(html).toContain("<span>+3%</span>");
    expect(html).toContain("Why these, and what's not shown");
    expect(html).toContain("Sized by market cap at the last close");
    // the owner's picks go into the address; a tile opens its market, read by name as any market is
    expect(p.run('hmAct({ dataset: { act: "hm-n", v: "500" } })')).toBe(true);
    expect(p.run('hmAct({ dataset: { act: "sort", v: "movers" } })')).toBe(false);
    p.run('hmClick({ target: { closest: (s) => (s === "[data-hm-act]" ? { dataset: { hmAct: "open", hmSym: "NVDA" }, disabled: false } : null) } })');
    await settle();
    await settle();
    expect(p.asked).toContain("/api/account/explore?q=NVDA&limit=200");
    expect(p.run("MKT.open && MKT.open.item.key")).toBe("stock:NVDA");
  });

  it("zooms into a sector: its companies by industry under a crumb back to all sectors, no band a button; the scale and the count from the address", async () => {
    const p = page((path) => (path.startsWith("/api/account/heatmap") ? HEAT({ n: 500 }) : {}));
    p.set("A", account());
    p.run(`ROUTE.tab = "markets"; ROUTE.params = { tab: "heatmap", sector: "Technology", n: "500", scale: "5" }; ${PANE}`);
    p.run('renderMarkets({ el: EL, owner: true, lens: lensNow(), params: ROUTE.params })');
    expect(p.asked).toContain("/api/account/heatmap?n=500");
    await settle();
    await settle();
    const html = p.run<string>("EL.innerHTML");
    expect(html).toContain('<p class="hm-crumb"><button type="button" class="link" data-hm-act="zoom" data-hm-v="" data-fk="hm-sector:">All sectors</button><span class="dim">›</span><b>Technology</b>');
    expect(html).toContain("3 shares of the top 500, by industry");
    expect(html).toContain('<div class="hm-grp" data-k="g:Semiconductors"');
    expect(html).toContain('<div class="hm-grp-h" style="width:');
    expect(html).not.toContain('data-hm-act="zoom" data-hm-v="Technology"');
    expect(html).not.toContain('data-hm-sym="AMZN"');
    // the scale ±5: a 1.19% rise is a quarter of the way
    expect(html).toMatch(/data-hm-sym="GOOGL"[^>]*--t:0\.24"/);
    expect(html).toContain('data-v="500" data-fk="hm-n:500" aria-pressed="true"');
    expect(html).toContain('<div class="hm-legend"><span>−5%</span>');
  });

  it("keeps the last map when a later read fails, and says so; says what Nasdaq would not answer in its own words", async () => {
    let fail = false;
    const p = page((path) => (path.startsWith("/api/account/heatmap") ? (fail ? { ok: false, refusal: { code: "E_VENUE_UNREACHABLE", message: "Nasdaq did not answer" } } : HEAT({ missing: { venue: "nasdaq", venueName: "Nasdaq", why: "Nasdaq asks to wait a minute: too many requests", code: "E_VENUE_RATE_LIMITED", said: "Too Many Requests", connected: false }, quotes: { from: "Nasdaq · real time", keptMs: 45_000, priced: 5 } })) : {}));
    p.set("A", account());
    p.run(`ROUTE.tab = "markets"; ROUTE.params = { tab: "heatmap" }; ${PANE}`);
    p.run('renderMarkets({ el: EL, owner: true, lens: lensNow(), params: { tab: "heatmap" } })');
    await settle();
    await settle();
    let html = p.run<string>("EL.innerHTML");
    expect(html).toContain("Not shown: <b>Nasdaq</b>: “Too Many Requests”");
    expect(html).toContain("Nasdaq · real time · 5 of 6 priced</span>");
    // the read gone stale and failing: the map stays, with a line that says when it was read
    fail = true;
    p.run("HM.got.at = Date.now() - 60000");
    p.run('renderMarkets({ el: EL, owner: true, lens: lensNow(), params: { tab: "heatmap" } })');
    await settle();
    await settle();
    html = p.run<string>("EL.innerHTML");
    expect(html).toContain('data-hm-sym="NVDA"');
    expect(html).toContain("Couldn't read the market again just now: Nasdaq did not answer. This is what was read at 13:05.");
  });
});
