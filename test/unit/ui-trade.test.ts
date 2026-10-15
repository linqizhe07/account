/** The Trade pane's own logic (ui/trade.js) and the Hand-to-agent composer's (ui/intent.js), run as the page runs them — every page script in
 * account.html's order, in one global scope — over a stand-in for the browser: the six kinds (Crypto · Stocks · RWAs · Perps · Pre-IPO ·
 * Predictions) and which face a preset, a Markets row or a venue opens; which kinds the seg shows; an order's draft from the ticket's fields
 * (an event contract's prices typed in cents); where a market is listed, kept to the face's kind (yours ranked, yours that cannot with how
 * to fix it, public ones "Connect to trade"); each face's block; Advanced's one line; paying with a coin held (two steps); Under way's rows
 * (an agent's card → Review); what left the pane (tiles, the mode switch, Positions, Recent fills, Swap, Earn, Sell many). Then the same
 * drafts go through the real account's door on the stand-in account (test/standin): each is prepared, the owner's browser signs them, and
 * the account does what they say — a coin for a coin in two signatures, the second sized by what the first sale brought. Nothing leaves the
 * process. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createContext, runInContext, Script } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { malformed, signAgent, signDevice, simKey, type AgentAction, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { startStandin, type Standin } from "../standin/ui-standin.ts";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const html = readFileSync(join(PUBLIC, "account.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1] ?? "");
const source = (f: string) => readFileSync(join(PUBLIC, f), "utf8");

/** the page's scripts in a stand-in browser: elements take listeners and report nothing; the device key never answers, so nothing is drawn */
function page() {
  const element = (): Record<string, unknown> => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, hidden: false, value: "", textContent: "", innerHTML: "" });
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" }, setAttribute() {} }, hidden: false, activeElement: null },
    location: { hash: "", origin: "http://127.0.0.1:4821" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class {
      observe() {}
    },
    Event: class {
      constructor(readonly type: string) {}
    },
    addEventListener() {},
    dispatchEvent: () => true,
    scrollTo() {},
    indexedDB: { open: () => ({}) },
    fetch: () => new Promise(() => {}),
    /* a form's fields, as the drafts read them: { values } stands in for the form */
    FormData: class {
      constructor(private readonly f: { values?: Record<string, string> }) {}
      get(k: string) {
        return this.f.values?.[k] ?? null;
      }
      entries() {
        return Object.entries(this.f.values ?? {})[Symbol.iterator]();
      }
    },
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  for (const src of scripts) new Script(readFileSync(join(PUBLIC, src.replace(/^\//, "")), "utf8"), { filename: src }).runInContext(ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  /** a value out of the page, as plain data */
  const out = <T = any>(code: string): T => JSON.parse(run<string>(`JSON.stringify(${code})`)) as T;
  return { run, out, set: (name: string, value: unknown) => run(`${name} = ${JSON.stringify(value)}`), sandbox };
}
const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/* ---- a stand-in DOM for one ticket (ui/trade.js tkTicket), so what the owner sees in its panel can be read back ---- */
type Stub = Record<string, any>;
const camel = (s: string) => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** an element as the ticket uses one: each part it looks for is an element of its own, kept by its selector; its HTML is kept as written —
 * a select's options are read from it (and its value is only ever one of them, as a browser's is), and the buttons a list carries
 * (data-at, data-money…) are found in it, the same ones until it is written again, so a test presses what the ticket listens to; its
 * events bubble to its parent */
function stub(name = "", parent: Stub | null = null): Stub {
  const kids = new Map<string, Stub>();
  const on: Record<string, Array<(e: unknown) => void>> = {};
  const attrs: Record<string, string> = {};
  let html = "";
  let value = "";
  let found = new Map<string, Stub[]>();
  const el: Stub = {
    name,
    parent,
    kids,
    on,
    hidden: false,
    checked: false,
    disabled: false,
    textContent: "",
    placeholder: "",
    title: "",
    className: "",
    isConnected: true,
    dataset: {},
    style: {},
    options: [] as Stub[],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(t: string, f: (e: unknown) => void) {
      (on[t] ??= []).push(f);
    },
    removeEventListener() {},
    dispatchEvent(e: { type: string }) {
      const ev = { type: e.type, target: el, stopPropagation() {}, preventDefault() {} };
      for (let n: Stub | null = el; n; n = n.parent) for (const f of n.on[e.type] ?? []) f(ev);
      return true;
    },
    click() {
      el.dispatchEvent({ type: "click" });
    },
    setAttribute(k: string, v: unknown) {
      attrs[k] = String(v);
    },
    getAttribute: (k: string) => attrs[k] ?? null,
    removeAttribute(k: string) {
      delete attrs[k];
    },
    hasAttribute: (k: string) => k in attrs,
    querySelector(sel: string) {
      if (!kids.has(sel)) kids.set(sel, stub(sel, el));
      return kids.get(sel);
    },
    querySelectorAll(sel: string) {
      const m = /\[data-([a-z-]+)\]/.exec(sel);
      if (!m) return [];
      if (!found.has(sel)) found.set(sel, [...html.matchAll(new RegExp(`data-${m[1]}="([^"]*)"`, "g"))].map((x) => Object.assign(stub(sel, el), { dataset: { [camel(m[1]!)]: unesc(x[1]!) } })));
      return found.get(sel);
    },
    contains: () => false,
    focus() {},
    closest: () => null,
  };
  Object.defineProperty(el, "innerHTML", {
    get: () => html,
    set: (v: unknown) => {
      html = String(v);
      found = new Map();
      const opts = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)];
      if (!opts.length) return;
      el.options = opts.map(([, v2, t]) => ({ value: unesc(v2!), textContent: unesc(t!), disabled: false }));
      if (!el.options.some((o: Stub) => o.value === value)) value = el.options[0].value;
    },
  });
  Object.defineProperty(el, "value", {
    get: () => value,
    set: (v: unknown) => {
      const s = String(v);
      value = el.options.length && !el.options.some((o: Stub) => o.value === s) ? "" : s;
    },
  });
  return el;
}
const CHECKS = new Set(["reduceOnly", "tpsl", "postOnly", "extendedHours"]);
/** the page with a panel for the ticket: its form's fields by name (a checkbox in FormData only when ticked, as a browser sends it), the
 * account's reads answered from ANSWERS by path, nothing prepared at the account, no route moved, no terminal pane on the page */
function ticketPage() {
  const p = page();
  const form = stub("form");
  const named = new Map<string, Stub>();
  form.elements = new Proxy({}, { get: (_t, k) => (typeof k !== "string" ? undefined : named.get(k) ?? (named.set(k, Object.assign(stub(k, form), { name: k })), named.get(k))) });
  Object.defineProperty(form, "values", { get: () => Object.fromEntries([...named].filter(([k, e]) => !e.disabled && (!CHECKS.has(k) || e.checked)).map(([k, e]) => [k, CHECKS.has(k) ? "on" : e.value])) });
  form.elements.unit.innerHTML = '<option value="usd">Dollars</option><option value="qty">Units</option>';
  form.elements.orderType.innerHTML = '<option value="market">Market</option><option value="limit">Limit</option>';
  form.elements.trailBy.innerHTML = '<option value="percent">Percent</option><option value="price">Price</option>';
  form.elements.pct.value = "0";
  const panel = stub("panel");
  panel.kids.set("form", form);
  p.sandbox.PANEL = panel;
  p.sandbox.FORM = form;
  p.run(`document.getElementById = () => null; go = () => {}; var ASKED = []; var ANSWERS = {};
    api = async (path) => { ASKED.push(path); const k = Object.keys(ANSWERS).filter((x) => path.startsWith(x)).sort((a, b) => b.length - a.length)[0]; return k ? ANSWERS[k] : { ok: false, refusal: { message: "not answered in this test" } }; };
    Owner.prepare = async () => ({ status: 409, body: { refusal: { message: "nothing is prepared in this test" } } });`);
  return { ...p, panel, form, part: (sel: string): Stub => form.querySelector(sel), field: (name: string): Stub => form.elements[name] };
}

/* venues as /api/account gives them, cut to what the pane reads */
const venue = (id: string, name: string, more: Record<string, unknown> = {}) => ({ id, name, live: true, watchOnly: "live", usd: 100, holdings: [], ...more });
const EX = venue("ex", "Exchange", { trade: { can: true, what: "spot and perpetuals", kinds: ["spot", "perp"], positions: true, amend: true, leverage: true }, liveCan: { withdraw: true, ledgers: ["spot", "futures"], transfer: true, swap: true, receive: false, send: false } });
const PRED = venue("predict", "Predictions", { trade: { can: true, what: "event contracts", kinds: ["event"], positions: true } });
const WALLET = venue("wallet", "Wallet", { trade: { can: true, what: "tokens", kinds: ["token"] }, address: "0x1111111111111111111111111111111111111111", proven: "MetaMask" });
const READONLY = venue("okx", "OKX", { trade: { can: false, what: "spot", kinds: ["spot"] }, noTradeBecause: "this API key has no Trade permission" });
const HL = venue("hl", "Hyperliquid", { trade: { can: true, what: "perpetuals", kinds: ["perp"] } });
const pageOf = (venues: unknown[], writes = true) => ({ now: "2026-10-06T12:00:00.000Z", venues, keys: [], spend: [], cards: [], orders: [], payments: [], intents: [], asks: [], connectLive: { writes: { on: writes, capUsd: 250 }, options: [] } });
/* rows as /api/account/explore gives them, cut to what the pane reads */
const ROW = (kind: string, base: string, more: Record<string, unknown> = {}) => ({ key: `${kind}:${base}`, kind, name: base, base, price: 10, tabs: [], at: [{ venue: "ex", venueName: "Exchange", symbol: `${base}/USDT`, connected: true, canTrade: true, public: false, price: 10 }], ...more });
const ANTH = { key: "preipo:anthropic", kind: "perp", name: "Anthropic", base: "ANTHROPIC", category: "Pre-IPO", price: 2080, implied: { perPoint: 1e9, unit: "1 contract = 1/1,000,000,000 of the implied company valuation", usd: 2.08e12 }, group: { id: "preipo:anthropic", title: "Anthropic" }, issuer: "Anthropic", eligibility: "Anthropic, 29 June 2026: transfers of its shares it has not approved are void", tabs: ["all", "preipo"], at: [{ venue: "okx-preipo", venueName: "OKX", symbol: "ANTHROPIC/USDT:USDT", connected: false, canTrade: false, public: true, price: 214.5, implied: { perPoint: 1e10, unit: "OKX: 1/10,000,000,000 since its 30 June 2026 rebase", usd: 2.145e12 }, connectTo: "okx", connector: "live:exchange:okx" }, { venue: "ex", venueName: "Exchange", symbol: "ANTHROPIC/USDT:USDT", connected: true, canTrade: true, public: false, price: 2080, implied: { perPoint: 1e9, unit: "1 contract = 1/1,000,000,000 of the implied company valuation", usd: 2.08e12 } }] };

describe("the trade terminal (ui/terminal.js): the market bar's figures, its session words, its tabs", () => {
  const p = page();
  /* a stand-in for the bar: two parts that take HTML */
  const bar = () => p.run('var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) }; EL');

  it("names the market as a trader reads it: a perpetual as BASE-PERP, a share or a coin by its base, an event by its short name", () => {
    expect(p.out('[ttLabel(null), ttLabel({ kind: "perp", base: "BTC", name: "BTC perpetual" }), ttLabel({ kind: "coin", base: "ETH", name: "ETH" }), ttLabel({ kind: "stock", base: "AAPL", name: "Apple Inc" })]')).toEqual(["Pick a market", "BTC-PERP", "ETH", "AAPL"]);
  });

  it("says only what the venue's market and the row said: price, the day's change, volume, bid and ask, funding with its next payment, where the order goes", () => {
    p.set("A", pageOf([{ ...HL, paper: true, name: "Paper account" }]));
    bar();
    p.run('TT.item = { kind: "perp", base: "BTC", name: "BTC perpetual", changePct24h: -1.73, change24h: -1443, volumeUsd24h: 2794956106.72 }; TT.at = { venue: "hl", symbol: "BTC-PERP" }; TT.mk = { kind: "perp", base: "BTC", quote: "USDC", price: 81900, bid: 81899, ask: 81901, fundingRate: 0.0000125, nextFundingAt: "2026-10-06T13:00:00.000Z", maxLeverage: 40 }');
    p.run("ttStats(EL)");
    const html = p.out<string>("BOX.innerHTML");
    expect(html).toContain("81,900");
    expect(html).toContain("−1,443 / −1.73%");
    expect(html).toContain("Funding");
    expect(html).toContain("0.0013%");
    expect(html).toContain("81,899 · 81,901");
    expect(html).not.toContain("Session");
    expect(p.out<string>("TAGS.innerHTML")).toContain("40x");
    expect(p.out<string>("TAGS.innerHTML")).toContain('<span class="tag paper">Paper</span>');
    // nothing a source did not give: no volume, no change, no funding line
    p.run('TT.item = { kind: "stock", base: "AAPL", name: "Apple Inc" }; TT.mk = { kind: "stock", base: "AAPL", quote: "USD", price: 342.55, session: { open: false, phase: "after", phaseEndsAt: "2026-10-07T00:00:00.000Z", extendedHours: true }, quoteFrom: "Robinhood · real time" }');
    p.run("ttStats(EL)");
    const stock = p.out<string>("BOX.innerHTML");
    expect(stock).toContain("After-hours until 20:00");
    expect(stock).toContain("Robinhood · real time");
    expect(stock).not.toContain("24h volume");
    expect(stock).not.toContain("24h change");
    expect(stock).not.toContain("Funding");
  });

  it("says a stock's session in a few words: the phase and until when, open until the close, closed with when it opens", () => {
    expect(p.out('ttSessionWord({ open: true, closesAt: "2026-10-06T20:00:00.000Z" })')).toBe("Open until 16:00");
    expect(p.out('ttSessionWord({ open: false, phase: "overnight", phaseEndsAt: "2026-10-07T08:00:00.000Z" })')).toBe("Overnight until 04:00");
    expect(p.out('ttSessionWord({ open: false, phase: "closed", opensAt: "2026-10-09T13:30:00.000Z" })')).toBe("Closed · opens Fri 9 Oct 09:30");
  });

  it("shows the chart and the book of the market showing and no other: a new market drops the last one's place and figures; until an account is chosen for it, its public listing's; with neither, says so", () => {
    p.set("A", pageOf([EX]));
    p.run(`var MOUNTS = [];
      var TT_CH = { innerHTML: "" }; var TT_BKP = { innerHTML: "" };
      var PANE = { querySelector: (s) => (s === "[data-tt-chart]" ? TT_CH : s === "[data-tt-book]" ? TT_BKP : null) };
      document.getElementById = (id) => (id === "pane-trade" ? PANE : null);
      chMount = (el, o) => MOUNTS.push(["chart", o.venue, o.symbol]);
      bkMount = (el, o) => MOUNTS.push(["book", o.venue, o.symbol]);
      chRelease = () => MOUNTS.push(["release"]);
      bkRelease = () => {};
      ttPoll = () => {};
      TT.item = null; TT.at = null; TT.mk = null; TT.mounted = "";`);
    // a coin traded at the exchange connected: once the ticket chooses it, the chart and the book are that venue's
    p.run(`ttSetItem(${JSON.stringify(ROW("coin", "BTC"))}, "crypto"); ttSetMarket({ venue: "ex", symbol: "BTC/USDT" }, { kind: "coin", base: "BTC", quote: "USDT", priceStep: 0.1, price: 81900 })`);
    expect(p.out("MOUNTS.filter((m) => m[1] === 'ex')")).toEqual([["chart", "ex", "BTC/USDT"], ["book", "ex", "BTC/USDT"]]);
    // a share no account of yours trades, listed publicly: the last market's place and price are dropped at once, its public listing shows
    const nvda = { key: "stock:NVDA", kind: "stock", base: "NVDA", name: "NVIDIA", at: [{ venue: "cboe", venueName: "US stocks", symbol: "NVDA", public: true, connected: false, price: 221.09 }] };
    p.run(`MOUNTS.length = 0; ttSetItem(${JSON.stringify(nvda)}, "stocks")`);
    expect(p.out("[TT.at, TT.mk]")).toEqual([null, null]);
    expect(p.out("MOUNTS")).toEqual([["chart", "cboe", "NVDA"], ["book", "cboe", "NVDA"]]);
    // the same market again (the ticket read it anew): nothing is mounted twice
    p.run(`MOUNTS.length = 0; ttSetItem(${JSON.stringify(nvda)}, "stocks")`);
    expect(p.out("MOUNTS")).toEqual([]);
    // a market with no public listing and no account: the panels say so, nothing is read
    p.run(`MOUNTS.length = 0; ttSetItem({ key: "coin:ZZZ", kind: "coin", base: "ZZZ", name: "ZZZ", at: [] }, "crypto")`);
    expect(p.out("MOUNTS")).toEqual([["release"]]);
    expect(p.out<string>("TT_CH.innerHTML")).toContain("No chart is read for it here");
    expect(p.out<string>("TT_BKP.innerHTML")).toContain("No order book is read for it here");
    // nothing picked: the panels wait for a market
    p.run("ttSetItem(null)");
    expect(p.out<string>("TT_CH.innerHTML")).toContain("Pick a market");
  });

  it("offers HL's four tabs under the panels — Positions, Open orders (with how many are open in the lens), Trade history, Order history", () => {
    expect(p.out("TT_TABS.map((t) => t[1])")).toEqual(["Positions", "Open orders", "Trade history", "Order history"]);
    p.set("A", { ...pageOf([EX]), orders: [{ id: "ord-1", venue: "ex", status: "open" }, { id: "ord-2", venue: "ex", status: "filled" }] });
    expect(p.out("ttOpenCount()")).toBe(1);
  });

  it("calls a US stock's change what it is — the change since the last regular close, the day's — and a perpetual's or a coin's its 24 hours", () => {
    const q = page();
    q.set("A", pageOf([EX]));
    q.run('var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) }; TK.got = {};');
    // Monday 10:00 New York, the change since Friday's close: not a 24-hour figure
    q.run('TT.at = null; TT.mk = null; TT.item = { key: "stock:AAPL", kind: "stock", base: "AAPL", name: "Apple", price: 250, change24h: 2.5, changePct24h: 1.01 }; ttStats(EL)');
    const stock = q.out<string>("BOX.innerHTML + SAID.innerHTML");
    expect(stock).toContain("Day change");
    expect(stock).toContain("+2.5 / +1.01%");
    expect(stock).not.toContain("24h change");
    // the venue's market says it is a stock even where the row is another kind's
    q.run('TT.item = { key: "coin:AAPLX", kind: "coin", base: "AAPL", name: "Apple" }; TT.at = { venue: "alpaca", symbol: "AAPL" }; TT.mk = { kind: "stock", base: "AAPL", quote: "USD", price: 250, changePct24h: 1.01 }; ttStats(EL)');
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("Day change");
    q.run('TT.at = null; TT.mk = null; TT.item = { key: "perp:BTC", kind: "perp", base: "BTC", name: "BTC", price: 81900, changePct24h: -1.73 }; ttStats(EL)');
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("24h change");
    q.run('TT.item = { key: "coin:ETH", kind: "coin", base: "ETH", name: "ETH", price: 2500, changePct24h: 0.5 }; ttStats(EL)');
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("24h change");
  });

  it("keeps reading the bar's market while the owner is on another pane — so it is fresh on the way back — and says when a read failed instead of passing old figures off as live", async () => {
    const q = page();
    q.set("A", pageOf([EX]));
    q.run(`var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) };
      var TIMERS = []; setTimeout = (f) => { TIMERS.push(f); return TIMERS.length; }; clearTimeout = () => {};
      document.getElementById = (id) => (id === "pane-trade" ? EL : null);
      var ANSWER = { ok: true, market: { kind: "perp", base: "BTC", quote: "USDT", price: 82000 } }; var ASKED = []; api = async (path) => { ASKED.push(path); return ANSWER; };
      TK.got = {}; TT.item = { key: "perp:BTC", kind: "perp", base: "BTC", name: "BTC" }; TT.at = { venue: "ex", symbol: "BTC/USDT:USDT" }; TT.mk = { kind: "perp", base: "BTC", quote: "USDT", price: 81000 };
      ROUTE.tab = "markets"; ttPoll();`);
    // on Markets: the beat goes on, nothing is asked
    await q.run("TIMERS.shift()()");
    expect(q.out("ASKED")).toEqual([]);
    expect(q.out("TIMERS.length")).toBe(1);
    // back on Trade: the next beat reads it, and the bar says the venue's figure now
    q.run('ROUTE.tab = "trade"');
    await q.run("TIMERS.shift()()");
    expect(q.out("ASKED")).toEqual(["/api/account/market?venue=ex&symbol=BTC%2FUSDT%3AUSDT"]);
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("82,000");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("Not read again");
    // a read refused: the last figures stay, said with when they were read and the venue's own words
    q.run('ANSWER = { ok: false, refusal: { message: "Exchange did not answer in time" } }');
    await q.run("TIMERS.shift()()");
    const said = q.out<string>("BOX.innerHTML + SAID.innerHTML");
    expect(said).toContain("82,000");
    expect(said).toMatch(/Not read again since \d\d:\d\d New York: Exchange did not answer in time/);
    // said in the status strip at the terminal's foot (HL's footer), never squeezed into the bar's figures
    expect(q.out<string>("SAID.innerHTML")).toMatch(/^Not read again since/);
    expect(q.out<string>("BOX.innerHTML")).not.toContain("Not read again");
    // read again: the words go
    q.run('ANSWER = { ok: true, market: { kind: "perp", base: "BTC", quote: "USDT", price: 82100 } }');
    await q.run("TIMERS.shift()()");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("Not read again");
    // no account chosen for it: the bar's figures are the freshest markets read's, not the row as it was when it was picked
    q.run('TT.at = null; TT.mk = null; TT.item = { key: "coin:SOL", kind: "coin", base: "SOL", name: "SOL", price: 100, changePct24h: 1 }; TK.got = { crypto: { at: Date.now(), items: [{ key: "coin:SOL", kind: "coin", base: "SOL", name: "SOL", price: 120, changePct24h: 3 }] } }; ttStats(EL)');
    const fresh = q.out<string>("BOX.innerHTML + SAID.innerHTML");
    expect(fresh).toContain(">120<");
    expect(fresh).toContain("+3.00%");
    expect(fresh).not.toContain(">100<");
  });

  it("with no account chosen, reads the row of a market outside the busiest of its kind again on the bar's beat — a search, never the kind's own list — and says when that read failed", async () => {
    const q = page();
    q.set("A", pageOf([EX]));
    const busiest = [ROW("coin", "BTC")];
    const zro = (price: number, pct: number) => ({ key: "coin:ZRO", kind: "coin", name: "LayerZero", base: "ZRO", price, changePct24h: pct, at: [] });
    q.run(`var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) };
      var TIMERS = []; setTimeout = (f) => { TIMERS.push(f); return TIMERS.length; }; clearTimeout = () => {};
      document.getElementById = (id) => (id === "pane-trade" ? EL : null);
      chMount = () => {}; bkMount = () => {}; chRelease = () => {}; bkRelease = () => {};
      var ANSWER = { ok: true, items: [${JSON.stringify(zro(2.75, 4))}] }; var ASKED = []; api = async (path) => { ASKED.push(path); return ANSWER; };
      TK.got = { crypto: { at: Date.now(), items: ${JSON.stringify(busiest)} } }; TT.at = null; TT.mk = null; ROUTE.tab = "trade";`);
    // found by the picker's search: not one of the twelve busiest the page read for its kind
    q.run(`ttSetItem(${JSON.stringify(zro(2.4, 1))}, "crypto")`);
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain(">2.4<");
    expect(q.out("TIMERS.length")).toBe(1);
    await q.run("TIMERS.shift()()");
    expect(q.out("ASKED")).toEqual(["/api/account/explore?tab=crypto&q=ZRO&key=coin%3AZRO&limit=12"]);
    const fresh = q.out<string>("BOX.innerHTML + SAID.innerHTML");
    expect(fresh).toContain(">2.75<");
    expect(fresh).toContain("+4.00%");
    expect(fresh).not.toContain(">2.4<");
    // a search: the kind's own list is left as it was
    expect(q.out("TK.got.crypto.items.map((x) => x.key)")).toEqual(["coin:BTC"]);
    // a read refused: the last figures stay, said with when they were read and the source's own words
    q.run('ANSWER = { ok: false, refusal: { message: "the markets could not be read: Binance did not answer in time" } }');
    await q.run("TIMERS.shift()()");
    const said = q.out<string>("BOX.innerHTML + SAID.innerHTML");
    expect(said).toContain(">2.75<");
    expect(said).toMatch(/Not read again since \d\d:\d\d New York: the markets could not be read: Binance did not answer in time/);
    // read again and listed: the words go
    q.run(`ANSWER = { ok: true, items: [${JSON.stringify(zro(2.8, 5))}] }`);
    await q.run("TIMERS.shift()()");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain(">2.8<");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("Not read again");
    // while another pane shows the beat goes on and asks nothing
    q.run('ROUTE.tab = "markets"; ASKED.length = 0');
    await q.run("TIMERS.shift()()");
    expect([q.out("ASKED"), q.out("TIMERS.length")]).toEqual([[], 1]);
    // another market, never read since it was picked, whose read does not list it: said so, never with the last market's time
    q.run(`ROUTE.tab = "trade"; ANSWER = { ok: true, items: [] }; ttSetItem({ key: "coin:ABC", kind: "coin", name: "ABC", base: "ABC", price: 3, at: [] }, "crypto")`);
    await q.run("TIMERS.pop()()");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("Not read again since it was picked: the markets read did not list it");
    // no market: no beat
    q.run("TIMERS.length = 0; ttSetItem(null)");
    expect(q.out("TIMERS.length")).toBe(0);
  });

  it("searches an event's row again by the first words of its question a search may hold, and says no read failed of a row its kind's own read lists, fresh", async () => {
    const q = page();
    q.set("A", pageOf([PRED]));
    // 63 characters: longer than the account takes a search to be
    const title = "Will the Democrats win the House in the 2026 midterm elections?";
    expect(title.length).toBe(63);
    const ev = (price: number) => ({ key: "event:dem-house-2026", kind: "event", name: title, category: "Politics", price, tabs: [], at: [{ venue: "polymarket", venueName: "Polymarket", symbol: "DEM-HOUSE-2026:YES", public: true, connected: false, price }] });
    q.run(`var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) };
      var TIMERS = []; setTimeout = (f) => { TIMERS.push(f); return TIMERS.length; }; clearTimeout = () => {};
      document.getElementById = (id) => (id === "pane-trade" ? EL : null);
      chMount = () => {}; bkMount = () => {}; chRelease = () => {}; bkRelease = () => {};
      var ANSWER = { ok: true, items: [${JSON.stringify(ev(0.64))}] }; var ASKED = [];
      api = async (path) => { ASKED.push(path); const s = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("q") || ""; return s.length > 60 ? { ok: false, refusal: { message: "a search is at most 60 characters" } } : ANSWER; };
      TK.got = { predictions: { at: Date.now(), items: [${JSON.stringify(ev(0.62))}] } }; TT.at = null; TT.mk = null; ROUTE.tab = "trade";`);
    q.run(`ttSetItem(${JSON.stringify(ev(0.55))}, "predictions")`);
    await q.run("TIMERS.shift()()");
    // the beat asked the first whole words of the question, which still find its row (a row is found by a part of its name)
    const asked = new URLSearchParams(q.out<string[]>("ASKED")[0]!.split("?")[1]).get("q") ?? "";
    expect(asked.length).toBeLessThanOrEqual(60);
    expect(asked).toBe("Will the Democrats win the House in the 2026 midterm");
    expect(title.startsWith(asked)).toBe(true);
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("64¢");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("Not read again");
    // its read refused while the kind's own read, read since the beat's last, lists the row: its figures are that read's, fresh, and nothing
    // failed is said of them
    q.run(`TK.got = { predictions: { at: TT.readAt + 1, items: [${JSON.stringify(ev(0.62))}] } }; ANSWER = { ok: false, refusal: { message: "Polymarket did not answer in time" } }`);
    await q.run("TIMERS.shift()()");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("62¢");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("Not read again");
    // no read of its kind lists it: the figures are the beat's last, said with when they were read and the source's words
    q.run("TK.got = {}");
    await q.run("TIMERS.shift()()");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("64¢");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toMatch(/Not read again since \d\d:\d\d New York: Polymarket did not answer in time/);
  });

  it("keeps the beat's last figures, said as not read again, when its read fails and the kind's read that lists the row is older — as it stands while the account does not answer and the pane is not drawn again", async () => {
    const q = page();
    q.set("A", pageOf([EX]));
    const coin = (base: string, price: number) => ({ key: `coin:${base}`, kind: "coin", name: base, base, price, at: [] });
    q.run(`var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) };
      var TIMERS = []; setTimeout = (f) => { TIMERS.push(f); return TIMERS.length; }; clearTimeout = () => {};
      document.getElementById = (id) => (id === "pane-trade" ? EL : null);
      chMount = () => {}; bkMount = () => {}; chRelease = () => {}; bkRelease = () => {};
      var ANSWER = { ok: true, items: [${JSON.stringify(coin("ZRO", 2.75))}] }; api = async () => ANSWER;
      TK.got = { crypto: { at: Date.now() - 10 * 60_000, items: [${JSON.stringify(coin("ZRO", 2.4))}] } }; TT.at = null; TT.mk = null; ROUTE.tab = "trade";`);
    // the kind's read lists the row, read ten minutes ago; the beat reads it now
    q.run(`ttSetItem(${JSON.stringify(coin("ZRO", 2.5))}, "crypto")`);
    await q.run("TIMERS.shift()()");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain(">2.75<");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("Not read again");
    // the account stops answering: the beat's read fails, and the kind's read still lists the row, as it was ten minutes ago — the bar keeps
    // the beat's last figures and says since when, never the older ones as if fresh
    q.run('ANSWER = { ok: false, error: "Failed to fetch" }');
    await q.run("TIMERS.shift()()");
    const said = q.out<string>("BOX.innerHTML + SAID.innerHTML");
    expect(said).toContain(">2.75<");
    expect(said).not.toContain(">2.4<");
    // in the page's own words (the account not answering), never the browser's error as it was thrown, with how long the bar now waits
    expect(said).toMatch(/Not read again since \d\d:\d\d New York: the account is not answering\. Asking again every 10 s\./);
    expect(said).not.toContain("Failed to fetch");
    // another market, never read since it was picked, that only that old read lists: said so as well
    q.run(`TK.got = { crypto: { at: Date.now() - 10 * 60_000, items: [${JSON.stringify(coin("ABC", 3.5))}] } }; ttSetItem(${JSON.stringify(coin("ABC", 3))}, "crypto")`);
    await q.run("TIMERS.pop()()");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("Not read again since it was picked: the account is not answering. Asking again every 10 s.");
    // and the figures under those words are the row as it was picked (3), never that older read's (3.5)
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain(">3<");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain(">3.5<");
  });

  it("asks for the row by its key with the words, so an event's row is found though twelve busier questions share the first words a search may hold", async () => {
    const q = page();
    q.set("A", pageOf([PRED]));
    // the first words of the question a search may hold (the question is 63 characters), which twelve busier questions begin with too
    const head = "Will the Democrats win the House in the 2026 midterm";
    const ev = (key: string, name: string, price: number) => ({ key, kind: "event", name, category: "Politics", price, tabs: [], at: [{ venue: "polymarket", venueName: "Polymarket", symbol: `${key.slice(6).toUpperCase()}:YES`, public: true, connected: false, price }] });
    const mine = ev("event:dem-house-2026", `${head} elections?`, 0.64);
    const busier = Array.from({ length: 12 }, (_, i) => ev(`event:dem-house-2026-by-${i + 2}`, `${head} elections by ${i + 2} seats or more?`, 0.3));
    // the account's explore, as service.ts answers it: a search over 60 characters refused; the rows the words find, busiest first, cut to
    // the limit — with a key, only the row with that key, before the cut
    q.run(`var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) };
      var TIMERS = []; setTimeout = (f) => { TIMERS.push(f); return TIMERS.length; }; clearTimeout = () => {};
      document.getElementById = (id) => (id === "pane-trade" ? EL : null);
      chMount = () => {}; bkMount = () => {}; chRelease = () => {}; bkRelease = () => {};
      var ROWS = [...${JSON.stringify(busier)}, ${JSON.stringify(mine)}]; var ASKED = [];
      api = async (path) => { ASKED.push(path); const s = new URLSearchParams(path.slice(path.indexOf("?") + 1)); const words = s.get("q") || ""; if (words.length > 60) return { ok: false, refusal: { message: "a search is at most 60 characters" } }; const found = ROWS.filter((x) => x.name.includes(words)); return { ok: true, items: (s.get("key") ? found.filter((x) => x.key === s.get("key")) : found).slice(0, Number(s.get("limit"))) }; };
      TK.got = {}; TT.at = null; TT.mk = null; ROUTE.tab = "trade";`);
    q.run(`ttSetItem(${JSON.stringify(mine)}, "predictions")`);
    await q.run("TIMERS.shift()()");
    const asked = new URLSearchParams(q.out<string[]>("ASKED")[0]!.split("?")[1]);
    expect([asked.get("q"), asked.get("key")]).toEqual([head, "event:dem-house-2026"]);
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toContain("64¢");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("Not read again");
    // a row asked for is its own read: never taken for the kind's own list
    expect(q.out("TK.got")).toEqual({});
  });

  it("says when the venue's price is from beside its source once it is not the last minute or two's: a real-time source's last trade can be yesterday's", () => {
    const q = page();
    q.set("A", pageOf([EX]));
    q.run('var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) }; TK.got = {};');
    // pre-market: Nasdaq's real-time last trade is the day before's close
    q.run('TT.item = { key: "stock:AAPL", kind: "stock", base: "AAPL", name: "Apple" }; TT.at = { venue: "alpaca", symbol: "AAPL" }; TT.mk = { kind: "stock", base: "AAPL", quote: "USD", price: 250, quoteFrom: "Nasdaq · real time", quoteAt: new Date(Date.now() - 16 * 3_600_000).toISOString() }; ttStats(EL)');
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).toMatch(/Nasdaq · real time · last at \d\d:\d\d New York, \w{3} \d{1,2} \w{3}/);
    // a trade of the last minute or two: its source alone
    q.run("TT.mk.quoteAt = new Date(Date.now() - 30_000).toISOString(); ttStats(EL)");
    const recent = q.out<string>("BOX.innerHTML + SAID.innerHTML");
    expect(recent).toContain("Nasdaq · real time");
    expect(recent).not.toContain("last at");
    // no time given: its source alone
    q.run("delete TT.mk.quoteAt; ttStats(EL)");
    expect(q.out<string>("BOX.innerHTML + SAID.innerHTML")).not.toContain("last at");
  });

  it("names a contract market's book and trades in contracts where one contract is not one coin, as the venue counts them (and an event's in contracts)", () => {
    const q = page();
    q.set("A", pageOf([EX]));
    q.run(`var BASES = []; var PANE = { querySelector: () => ({ innerHTML: "" }) }; document.getElementById = (id) => (id === "pane-trade" ? PANE : null);
      chMount = () => {}; chRelease = () => {}; bkRelease = () => {}; bkMount = (el, o) => BASES.push(o.base); ttPoll = () => {}; TT.item = null; TT.at = null; TT.mk = null; TT.mounted = "";`);
    const okx = { key: "perp:BTC", kind: "perp", base: "BTC", name: "BTC", at: [] };
    q.run(`ttSetItem(${JSON.stringify(okx)}, "perps"); ttSetMarket({ venue: "okx", symbol: "BTC/USDT:USDT" }, { kind: "perp", base: "BTC", quote: "USDT", contractSize: 0.01 })`);
    q.run(`ttSetMarket({ venue: "hl", symbol: "BTC-PERP" }, { kind: "perp", base: "BTC", quote: "USDC", contractSize: 1 })`);
    q.run(`ttSetMarket({ venue: "ex", symbol: "BTC/USDT" }, { kind: "spot", base: "BTC", quote: "USDT" })`);
    q.run(`ttSetItem({ key: "ev:FED", kind: "event", name: "Fed", at: [] }, "predictions"); ttSetMarket({ venue: "predict", symbol: "FED:YES" }, { kind: "event", base: "FED", quote: "USD" })`);
    expect(q.out("BASES")).toEqual(["contracts", "BTC", "BTC", "contracts"]);
    expect(q.out('[tkSizeUnit({ kind: "perp", base: "BTC", contractSize: 0.01 }), tkSizeUnit({ kind: "future", base: "ETH", contractSize: 10 }), tkSizeUnit({ kind: "perp", base: "BTC" }), tkSizeUnit({ kind: "stock", base: "AAPL" }), tkSizeUnit({ kind: "event", base: "FED" })]')).toEqual(["contracts", "contracts", "BTC", "AAPL", "contracts"]);
  });

  it("says when a venue's positions could not be read — in its own words — and never that nothing is held while one is missing", async () => {
    const q = page();
    q.set("A", pageOf([EX, HL]));
    q.run(`var POSBOX = { innerHTML: "", isConnected: true, addEventListener() {} }; TT.tab = "positions";
      var ANSWER = { ok: true, positions: [], missing: [{ venue: "hl", venueName: "Hyperliquid", why: "Hyperliquid did not answer in time", code: "E_VENUE_UNREACHABLE", part: "positions" }] }; api = async () => ANSWER;`);
    q.run("ttPositions(POSBOX, true)");
    await settle();
    const html = q.out<string>("POSBOX.innerHTML");
    expect(html).toContain("<b>Hyperliquid</b> could not be read: Hyperliquid did not answer in time");
    expect(html).not.toContain("Nothing held in positions.");
    expect(html).toContain("Nothing held in positions at the venues that answered.");
    // what the others hold is listed, the one missing named under it
    q.run('ANSWER = { ...ANSWER, positions: [{ venue: "ex", venueName: "Exchange", symbol: "ETH/USDT:USDT", name: "ETH perpetual", kind: "perp", side: "long", qty: 1, usd: 2500 }] }; POSBOX.innerHTML = ""; ttPositions(POSBOX, true)');
    await settle();
    expect(q.out<string>("POSBOX.innerHTML")).toMatch(/ETH perpetual[\s\S]*could not be read: Hyperliquid did not answer in time/);
    // every venue read, nothing held: said so
    q.run('ANSWER = { ok: true, positions: [], missing: [] }; ttPositions(POSBOX, true)');
    await settle();
    expect(q.out<string>("POSBOX.innerHTML")).toContain("Nothing held in positions.");
  });

  it("keeps an agent's lens on Trade history and on the Open orders count, as Under way lists them; a paper line stays Paper after its account is gone", async () => {
    const q = page();
    q.set("A", { ...pageOf([EX, { ...HL, paper: true }]), keys: [{ address: "0xagent", name: "Bot" }], orders: [{ id: "o1", venue: "ex", status: "open" }, { id: "o2", venue: "ex", status: "open", agent: "0xAgent" }, { id: "o3", venue: "hl", status: "partial" }, { id: "o4", venue: "ex", status: "filled", agent: "0xagent" }] });
    q.run('view.lens = "agent:0xagent"');
    expect(q.out("ttOpenCount()")).toBe(1);
    q.run('view.lens = ""');
    expect(q.out("ttOpenCount()")).toBe(3);
    q.run('view.lens = "paper"');
    expect(q.out("ttOpenCount()")).toBe(1);
    const line = (id: string, account: string, more: Record<string, unknown> = {}) => ({ key: id, id, type: "trade", kind: "buy", account, accountName: account, description: `Buy 1 ${id}`, amountUsd: -10, status: "filled", by: "You", at: "2026-10-06T12:00:00.000Z", ...more });
    const lines = [line("MINE", "ex"), line("BOTS", "ex", { by: "Bot, inside its limit", agent: "0xagent", agentName: "Bot" }), line("GONE", "paper-gone", { paper: true })];
    q.run(`var HBOX = { innerHTML: "", isConnected: true }; TT.tab = "history"; api = async () => ({ ok: true, lines: ${JSON.stringify(lines)} })`);
    const shown = async (lens: string) => {
      q.run(`view.lens = ${JSON.stringify(lens)}; HBOX.innerHTML = ""; ttHistory(HBOX)`);
      await settle();
      const html = q.out<string>("HBOX.innerHTML");
      return ["MINE", "BOTS", "GONE"].filter((x) => html.includes(`<b>${x}</b>`));
    };
    expect(await shown("agent:0xagent")).toEqual(["BOTS"]);
    expect(await shown("real")).toEqual(["MINE", "BOTS"]);
    expect(await shown("paper")).toEqual(["GONE"]);
    expect(await shown("")).toEqual(["MINE", "BOTS", "GONE"]);
  });

  it("hears the market button, its panel and the tabs of a frame drawn again (after an error replaced the pane), and the page's Escape and outside click once", () => {
    const q = page();
    q.run(`var DOC = []; document.addEventListener = (t) => DOC.push(t);
      var part = () => { const p = { ls: [], hidden: true, addEventListener(t) { p.ls.push(t); }, setAttribute() {}, querySelector: () => null, contains: () => false }; return p; };
      var frame = () => { const f = { pop: part(), btn: part(), tabs: part() }; f.querySelector = (s) => (s === "[data-tt-pop]" ? f.pop : s === "[data-tt-pick]" ? f.btn : s === "[data-tt-tabs]" ? f.tabs : null); return f; };
      var F1 = frame(); var F2 = frame();
      var PANE = { cur: F1, querySelector(s) { return s === "[data-tp]" ? this.cur : this.cur.querySelector(s); } };
      ttWire(PANE); ttWire(PANE); PANE.cur = F2; ttWire(PANE);`);
    expect(q.out("[F1.btn.ls, F1.pop.ls, F1.tabs.ls]")).toEqual([["click"], ["click"], ["click"]]);
    expect(q.out("[F2.btn.ls, F2.pop.ls, F2.tabs.ls]")).toEqual([["click"], ["click"], ["click"]]);
    expect(q.out("DOC")).toEqual(["keydown", "click"]);
  });
});

describe("the terminal fitted to the window, its bar's figures whole, its prices to the market's step, its beat backing off", () => {
  it("measures what sits above the terminal into --tt-top and the page's gutter under it into --tt-below, once per change, and nothing for a pane put aside", () => {
    const q = page();
    q.run(`var SET = []; var TOP = 59; var SHOWN = true;
      var MAIN = { tagName: "MAIN" };
      var TT_EL = { getBoundingClientRect: () => ({ top: TOP }), getClientRects: () => (SHOWN ? [{}] : []), closest: (s) => (s === ".main" ? MAIN : null), style: { setProperty: (k, v) => SET.push([k, v]) } };
      var PANE = { querySelector: (s) => (s === ".tt" ? TT_EL : null) };
      getComputedStyle = (el) => (el === MAIN ? { paddingBottom: "3px" } : {});
      window.scrollY = 3;`);
    q.run("ttFit(PANE)");
    // where the terminal starts in the page (its top in the window and the page's scroll), and the gutter under it
    expect(q.out("SET")).toEqual([["--tt-top", "62px"], ["--tt-below", "3px"]]);
    // the same again: nothing written, so nothing is laid out again
    q.run("ttFit(PANE)");
    expect(q.out("SET.length")).toBe(2);
    // a banner over it: the terminal starts lower, and the room it fits in is that much less
    q.run("TOP = 99; ttFit(PANE)");
    expect(q.out("SET.slice(2)")).toEqual([["--tt-top", "102px"], ["--tt-below", "3px"]]);
    // a pane put aside has no box: it is not measured (its top would read 0)
    q.run("SHOWN = false; TOP = 0; ttFit(PANE)");
    expect(q.out("SET.length")).toBe(4);
    // the stylesheet sizes the grid from that room: the window less what sits above it, under it, the status strip and the gutters, less
    // the tables' least height — never a fixed allowance for the window's chrome
    const css = source("ui/terminal.css");
    expect(css).toContain("--tt-room: calc(100dvh - var(--tt-top) - var(--tt-below) - var(--hl-h-footer) - 2 * var(--hl-gap))");
    expect(css).toContain("--tt-grid-h: clamp(520px, calc(var(--tt-room) - var(--tt-low-min)), 760px)");
    expect(css).toMatch(/\.tt-low \{ display: flex; flex-direction: column; height: max\(var\(--tt-low-min\), calc\(var\(--tt-room\) - var\(--tt-grid-h\)\)\);/);
    expect(css).not.toContain("100dvh - 226px");
  });

  it("shows the bar's figures whole: the least needed set aside, one at a time, until the rest fit — bid · ask first, the price never — and all of them back when there is room", () => {
    const q = page();
    q.set("A", pageOf([EX]));
    q.run(`var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) };
      TK.got = {}; TT.item = { key: "perp:BTC", kind: "perp", base: "BTC", name: "BTC perpetual", volumeUsd24h: 1.9e9, changePct24h: 2.3, change24h: 1405.1 }; TT.at = { venue: "ex", symbol: "BTC/USDT:USDT" }; TT.mk = { kind: "perp", base: "BTC", quote: "USDT", price: 62489.4, bid: 62486.2, ask: 62492.6, fundingRate: 0.0001 };
      ttStats(EL);`);
    // each figure carries its place in the order they are set aside; the price none (it always stays)
    const html = q.out<string>("BOX.innerHTML");
    const drop = (name: string) => (new RegExp(`data-k="st:${name}"(?: data-tt-drop="(\\d+)")?`).exec(html) ?? [])[1] ?? "";
    expect(drop("Price")).toBe("");
    expect(Number(drop("Bid · Ask"))).toBeGreaterThan(Number(drop("24h volume")));
    expect(Number(drop("24h volume"))).toBeGreaterThan(Number(drop("Funding")));
    expect(Number(drop("Funding"))).toBeGreaterThan(Number(drop("24h change")));
    // a strip as the browser lays it out: each figure its width, 32 between them, the room the bar leaves it
    q.run(`var mk = (name, w, drop) => ({ name, w, hidden: false, dataset: drop ? { ttDrop: String(drop) } : {} });
      var KIDS = [mk("Price", 60), mk("24h change", 110, 2), mk("24h volume", 70, 7), mk("Bid · Ask", 120, 8), mk("Funding", 90, 5)];
      var STRIP = { children: KIDS, clientWidth: 403, get scrollWidth() { const on = KIDS.filter((k) => !k.hidden); return on.reduce((t, k) => t + k.w, 0) + 32 * (on.length - 1); } };`);
    // 450 + 4 gaps of 32 = 578: bid · ask goes first (426 fits in 430)
    q.run("STRIP.clientWidth = 430; ttFitStats(STRIP)");
    expect(q.out("KIDS.filter((k) => k.hidden).map((k) => k.name)")).toEqual(["Bid · Ask"]);
    // in 403, the volume next (324)
    q.run("STRIP.clientWidth = 403; ttFitStats(STRIP)");
    expect(q.out("KIDS.filter((k) => k.hidden).map((k) => k.name)")).toEqual(["24h volume", "Bid · Ask"]);
    // a narrower bar: the funding too, then the change; the price stays even where it alone is all that fits
    q.run("STRIP.clientWidth = 100; ttFitStats(STRIP)");
    expect(q.out("KIDS.filter((k) => !k.hidden).map((k) => k.name)")).toEqual(["Price"]);
    // room again (the window widened): every figure comes back
    q.run("STRIP.clientWidth = 700; ttFitStats(STRIP)");
    expect(q.out("KIDS.filter((k) => k.hidden).length")).toBe(0);
    // a strip with no box (a pane put aside) is left as drawn: nothing set aside
    q.run("STRIP.clientWidth = 0; KIDS[3].hidden = false; ttFitStats(STRIP)");
    expect(q.out("KIDS.filter((k) => k.hidden).length")).toBe(0);
  });

  it("writes a price to its market's step where the page read the market, else to the decimals its venue quotes the market's other prices in, else six figures — never an average's tail — with the figure as it came on hover", () => {
    const q = page();
    const fig = (n: number, o: Record<string, unknown> = {}) => q.out<{ text: string; exact: string }>(`ttFig(${n}, ${JSON.stringify(o)})`);
    // a paper position's average entry, its mark quoted to a tenth: 62,548.9, the whole figure on hover
    expect(fig(62548.88617, { like: [62481.7, 40649.3] })).toEqual({ text: "62,548.9", exact: "62,548.88617" });
    // its market's step known (0.1): written to it, padded as the book pads a level
    expect(fig(62548.88617, { step: 0.1 })).toEqual({ text: "62,548.9", exact: "62,548.88617" });
    expect(fig(60520, { step: 0.1 })).toEqual({ text: "60,520.0", exact: "" });
    expect(fig(2456.735, { step: 0.01 })).toEqual({ text: "2,456.74", exact: "2,456.735" });
    // nothing to go by: six significant figures, never more decimals than the figure has
    expect(fig(62548.88617)).toEqual({ text: "62,548.9", exact: "62,548.88617" });
    expect(fig(0.000123456)).toEqual({ text: "0.000123456", exact: "" });
    expect(fig(13.786)).toEqual({ text: "13.786", exact: "" });
    // never fewer decimals than its siblings', never more than its own
    expect(fig(1977.67, { like: [2456.47] })).toEqual({ text: "1,977.67", exact: "" });
    expect(fig(1977.6, { like: [2456.473] })).toEqual({ text: "1,977.6", exact: "" });
    // a sibling on a round figure is a hint, not a cap: a mark that lands on 2,457 (or 0.1) does not take the entry's decimals with it
    expect(fig(2456.74, { like: [2457] })).toEqual({ text: "2,456.74", exact: "" });
    expect(fig(0.10234, { like: [0.1] })).toEqual({ text: "0.10234", exact: "" });
    expect(fig(Number.NaN)).toEqual({ text: "—", exact: "" });
  });

  it("writes the positions' entry, mark and liquidation prices as their market writes them: the step of a market read on the page, else the decimals of its mark", async () => {
    const q = page();
    q.set("A", pageOf([EX, { ...HL, id: "paper-momentum", name: "Momentum · paper", paper: true }]));
    const pos = [
      { venue: "paper-momentum", venueName: "Momentum · paper", paper: true, symbol: "BTC/USD", name: "BTC / USD", kind: "spot", side: "long", qty: 0.00094, usd: 58.73, entryPrice: 62548.88617, markPrice: 62481.7 },
      { venue: "ex", venueName: "Exchange", symbol: "ETH/USDT:USDT", name: "ETH perpetual", kind: "perp", side: "long", qty: 0.05, usd: 122.82, entryPrice: 2456.731234, markPrice: 2456.47, liquidationPrice: 1977.6712 },
    ];
    q.run(`var POSBOX = { innerHTML: "", isConnected: true, addEventListener() {} }; TT.tab = "positions"; var POS_ANSWER = { ok: true, positions: ${JSON.stringify(pos)}, missing: [] }; api = async () => POS_ANSWER;
      var TABBAR = { innerHTML: "" }; var FRAME = { querySelector: (s) => (s === "[data-tt-tabs]" ? TABBAR : null) }; document.getElementById = (id) => (id === "pane-trade" ? FRAME : null);`);
    q.run("ttPositions(POSBOX, true)");
    await settle();
    // how many are held, on the tab: a table that scrolls inside a short window still says how many rows it has
    expect(q.out<string>("TABBAR.innerHTML")).toContain('>Positions <span class="tt-n">2</span></button>');
    let html = q.out<string>("POSBOX.innerHTML");
    expect(html).toContain('<td class="r tt-c-entry" title="62,548.88617">62,548.9</td>');
    expect(html).not.toContain(">62,548.88617<");
    expect(html).toContain('<td class="r tt-c-mark"><span class="tt-k">Mark </span>62,481.7</td>');
    expect(html).toContain('<td class="r tt-c-entry" title="2,456.731234">2,456.73</td>');
    expect(html).toContain('<td class="r tt-c-liq" title="1,977.6712">1,977.67</td>');
    // the ETH perpetual's market read on this page (its step 0.1): its prices written to that step
    q.run(`API.set("/api/account/market?venue=ex&symbol=ETH%2FUSDT%3AUSDT", { at: Date.now(), body: { ok: true, market: { symbol: "ETH/USDT:USDT", priceStep: 0.1 } } }); POSBOX.innerHTML = ""; ttPositions(POSBOX, true)`);
    await settle();
    html = q.out<string>("POSBOX.innerHTML");
    expect(html).toContain('<td class="r tt-c-entry" title="2,456.731234">2,456.7</td>');
    expect(html).toContain('<td class="r tt-c-mark" title="2,456.47"><span class="tt-k">Mark </span>2,456.5</td>');
    // the account not answering: said in the page's words, never the browser's error
    q.run('POS_ANSWER = { ok: false, error: "Failed to fetch" }; ttPositions(POSBOX, true)');
    await settle();
    expect(q.out<string>("POSBOX.innerHTML")).toBe('<p class="msg no">The account is not answering.</p>');
  });

  it("writes the history tabs' prices as their market writes them, and reads a line's own figures written with thousands separators", () => {
    const q = page();
    q.set("A", { ...pageOf([EX]), orders: [{ id: "o1", clientId: "c1", venue: "ex", symbol: "BTC/USDT", name: "BTC / USDT", kind: "spot", side: "buy", type: "market", qty: 0.001, filledQty: 0.001, avgPrice: 62548.88617, price: 62540.5 }] });
    expect(q.out('ttPx(ttOrderRec({ key: "order:c1" }), 62548.88617)')).toBe('<span title="62,548.88617">62,548.9</span>');
    // a line read from its words alone, its figures grouped as the account may write them
    const r = q.out<Record<string, unknown>>('ttOrderRec({ key: "order:zz", kind: "buy", description: "Buy 0.5 BTC · BTC / USDT · limit 63,226.6 · at 63,226.6" })');
    expect(r.limit).toBe(63226.6);
    expect(r.avg).toBe(63226.6);
    expect(r.filled).toBe(0.5);
  });

  it("asks a bar's market that the account does not answer again later and later — ten seconds, doubling, at most a minute — says so in its own words, and goes back to five seconds once answered", async () => {
    const q = page();
    q.set("A", pageOf([EX]));
    q.run(`var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var SAID = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : s === "[data-tt-said]" ? SAID : null) };
      var TIMERS = []; setTimeout = (f, ms) => { TIMERS.push([f, ms]); return TIMERS.length; }; clearTimeout = () => {};
      document.getElementById = (id) => (id === "pane-trade" ? EL : null);
      var ANSWER = { ok: false, error: "Failed to fetch" }; api = async () => ANSWER;
      TK.got = {}; TT.item = { key: "perp:BTC", kind: "perp", base: "BTC", name: "BTC" }; TT.at = { venue: "ex", symbol: "BTC/USDT:USDT" }; TT.mk = { kind: "perp", base: "BTC", quote: "USDT", price: 81000 }; TT.readAt = Date.now(); TT.fails = 0;
      ROUTE.tab = "trade"; ttPoll();`);
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const [f, ms] = q.run<[() => Promise<void>, number]>("TIMERS.shift()");
      waits.push(ms);
      await f();
    }
    // the first beat on five seconds; then, the account not answering, ten, twenty, forty, then a minute apart
    expect(waits).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
    const said = q.out<string>("SAID.innerHTML");
    expect(said).toMatch(/^Not read again since \d\d:\d\d New York: the account is not answering\. Asking again every 60 s\.$/);
    expect(said).not.toContain("Failed to fetch");
    // the figures standing are the last read's
    expect(q.out<string>("BOX.innerHTML")).toContain("81,000");
    // answered: the words go, and the beat is five seconds again
    q.run('ANSWER = { ok: true, market: { kind: "perp", base: "BTC", quote: "USDT", price: 82000 } }');
    const [f] = q.run<[() => Promise<void>, number]>("TIMERS.shift()");
    await f();
    expect(q.out<string>("SAID.innerHTML")).toBe("");
    expect(q.out("TIMERS[0][1]")).toBe(5000);
    // a refusal is the account's own sentence, with how long until it is asked again
    q.run('ANSWER = { ok: false, refusal: { code: "E_VENUE_UNREACHABLE", message: "Exchange did not answer in time." } }');
    const [g] = q.run<[() => Promise<void>, number]>("TIMERS.shift()");
    await g();
    expect(q.out<string>("SAID.innerHTML")).toMatch(/: Exchange did not answer in time\. Asking again every 10 s\.$/);
  });
});

describe("the six kinds, as the page runs them", () => {
  const p = page();

  it("names the six faces in Markets' order, each with its icon, and tells which face a preset, a Markets row, a market or a venue opens", () => {
    expect(p.out("TK_KINDS.map((k) => k.id)")).toEqual(["crypto", "stocks", "rwas", "perps", "preipo", "predictions"]);
    expect(p.out("TK_KINDS.map((k) => k.icon)")).toEqual(["trade", "stock", "rwa", "perps", "preipo", "prediction"]);
    // a Markets row's kind, a market's kind, the old tile and variant names, the six words themselves
    expect(p.out('[{ kind: "coin" }, { kind: "stock" }, { kind: "rwa" }, { kind: "perp" }, { kind: "event" }, { kind: "token" }, { kind: "spot" }, { kind: "future" }].map(tkKindOf)')).toEqual(["crypto", "stocks", "rwas", "perps", "predictions", "crypto", "crypto", "perps"]);
    expect(p.out('[{ variant: "trade" }, { variant: "perps" }, { variant: "predictions" }, { tile: "swap" }, { kind: "stocks" }, { kind: "preipo" }, {}].map(tkKindOf)')).toEqual(["crypto", "perps", "predictions", "crypto", "stocks", "preipo", "crypto"]);
    // a perpetual on a company's implied valuation is Pre-IPO, whatever it is called
    expect(p.out(`[tkKindOf({ kind: "perp", category: "Pre-IPO" }), tkKindOf({ item: ${JSON.stringify(ANTH)} }), tkKindOf({ kind: "perps", implied: { usd: 1 } }), tkKindOf({ item: { kind: "perp", group: { id: "preipo:openai" } } })]`)).toEqual(["preipo", "preipo", "preipo", "preipo"]);
    // a venue named without a kind: what that venue trades; one that trades several kinds opens Crypto
    p.set("A", pageOf([EX, PRED, HL]));
    expect(p.out('[tkKindOf({ venue: "predict" }), tkKindOf({ venue: "hl" }), tkKindOf({ venue: "ex" })]')).toEqual(["predictions", "perps", "crypto"]);
    // the variant words the page before this one used map to kinds (no alias function remains)
    expect(p.out('[tkKindOf({ venue: "predict", kind: "event" }), tkKindOf({ variant: "swap", venue: "predict" }), tkKindOf({ variant: "perps" }), tkKindOf({ tile: "predictions" }), tkKindOf({})]')).toEqual(["predictions", "crypto", "perps", "predictions", "crypto"]);
    expect(p.out("typeof tkVariantOf")).toBe("undefined");
  });

  it("shows a kind when a connected venue trades it or a read of it has rows — and hides one with nothing; a venue's lens hides public-only kinds", () => {
    p.set("A", pageOf([EX, PRED, WALLET]));
    expect(p.out("tkKindsFor(connected(), {}, lensNow())")).toEqual(["crypto", "perps", "predictions"]);
    const got = { rwas: { items: [ROW("rwa", "NVDA", { at: [{ venue: "wallet", venueName: "Wallet", symbol: "NVDA/USDG@Robinhood Chain", connected: true, canTrade: true, public: false }] })] }, stocks: { items: [ROW("stock", "AAPL", { at: [{ venue: "alpaca-public", venueName: "Alpaca", symbol: "AAPL", connected: false, canTrade: false, public: true }] })] }, preipo: { items: [ANTH] } };
    expect(p.out(`tkKindsFor(connected(), ${JSON.stringify(got)}, lensNow())`)).toEqual(["crypto", "stocks", "rwas", "perps", "preipo", "predictions"]);
    // under a venue's lens: that venue's kinds and the rows it lists; Stocks (public only) and Pre-IPO (the exchange's row) part ways
    expect(p.out(`tkKindsFor([${JSON.stringify(EX)}], ${JSON.stringify(got)}, { kind: "venue", id: "ex", name: "Exchange" })`)).toEqual(["crypto", "perps", "preipo"]);
    // a read-only server still shows the kinds: prices show, the sign button says why nothing is placed
    p.set("A", pageOf([EX, PRED], false));
    expect(p.out("tkKindsFor(connected(), {}, lensNow())")).toEqual(["crypto", "perps", "predictions"]);
    // the pane is one seg + a picker + Under way: no tiles, no mode switch, no Positions, no Recent fills, no Swap/Earn/Sell many panels
    for (const gone of ["TK_TILES", "tkTilesFor", "tkTile", "tkRefusal", "tkSetMode", "TK_VARIANTS", "tkDrawPositions", "tkDrawFills", "tkSwap", "tkSwapHow2", "tkStableSwap", "tkSellMany", "tkSellDraft", "tkLegName", "tkEarn", "tkEarnList", "tkEarnDraft", "tkRate", "tkInVenue", "renderOpen"]) expect(p.run(`typeof ${gone}`), gone).toBe("undefined");
    expect(p.out("Object.keys(TK).sort()")).not.toEqual(expect.arrayContaining(["mode", "pos", "tileDone", "legs"]));
    const src = source("ui/trade.js");
    for (const words of ["Do it myself", "account.tradeMode", "Recent fills", "Your words to agents", "Earning now", "data-tp-pos", "data-tp-fills", "data-tp-intents", "Up to ${money(cap)}"]) expect(src, words).not.toContain(words);
    // the seg is drawn by hand (icons on its buttons) and never collides with core seg()'s click delegation
    expect(src).toContain('data-kind="${esc(id)}" aria-pressed=');
    expect(src).not.toMatch(/class="seg tk-seg"[^>]*data-seg/);
    // `later` lives inside the functions that debounce, never at the top level (ui-fixes forbids it)
    expect(src).not.toMatch(/^(const|function) later\b/m);
  });

  it("drafts an order from the ticket: in dollars or in the market's units, an event contract's limit typed in cents, only the flags the type takes", () => {
    expect(p.out('tkOrderDraft({ amount: " 50 ", unit: "usd", orderType: "market" }, { venue: "ex", symbol: "BTC/USDT", side: "buy", event: false })')).toEqual({ type: "liveOrder", venue: "ex", symbol: "BTC/USDT", side: "buy", orderType: "market", usd: "50", limitPrice: "", stopPrice: "", tif: "", postOnly: "", reduceOnly: "", extendedHours: "", trailPercent: "", trailPrice: "", takeProfit: "", stopLoss: "" });
    // a trailing stop trails by a percent or a price; a market or limit entry carries its exits where typed
    expect(p.out('tkOrderDraft({ amount: "1", unit: "qty", orderType: "trailing_stop", trail: "3", trailBy: "percent", takeProfit: "99" }, { venue: "paper-1", symbol: "AAPL", side: "sell", event: false })')).toMatchObject({ orderType: "trailing_stop", trailPercent: "3", trailPrice: "", takeProfit: "" });
    expect(p.out('tkOrderDraft({ amount: "1", unit: "qty", orderType: "trailing_stop", trail: "2.5", trailBy: "price" }, { venue: "paper-1", symbol: "AAPL", side: "sell", event: false })')).toMatchObject({ trailPercent: "", trailPrice: "2.5" });
    expect(p.out('tkOrderDraft({ amount: "10", unit: "qty", orderType: "limit", limitPrice: "420", tpsl: "on", takeProfit: " 460 ", stopLoss: "400" }, { venue: "paper-1", symbol: "MSFT", side: "buy", event: false })')).toMatchObject({ takeProfit: "460", stopLoss: "400" });
    // the exits go only with Take profit / Stop loss ticked
    expect(p.out('tkOrderDraft({ amount: "10", unit: "qty", orderType: "limit", limitPrice: "420", takeProfit: "460", stopLoss: "400" }, { venue: "paper-1", symbol: "MSFT", side: "buy", event: false })')).toMatchObject({ takeProfit: "", stopLoss: "" });
    expect(p.out('tkOrderDraft({ amount: "26", unit: "qty", orderType: "limit", limitPrice: "38", postOnly: "on", tif: "gtc" }, { venue: "predict", symbol: "SI-FEDCUT-DEC:NO", side: "buy", event: true })')).toMatchObject({ qty: "26", limitPrice: "0.38", postOnly: "true", tif: "gtc" });
    // a stop has no limit and is never post-only; reduce-only rides along where ticked
    expect(p.out('tkOrderDraft({ amount: "0.01", unit: "qty", orderType: "stop", limitPrice: "9", stopPrice: "60000", postOnly: "on", reduceOnly: "on" }, { venue: "ex", symbol: "BTC/USDT:USDT", side: "sell", event: false })')).toMatchObject({ limitPrice: "", stopPrice: "60000", postOnly: "", reduceOnly: "true" });
    expect(p.out('[tkPriceIn("62", true), tkPriceIn("62", false), tkPriceIn("", true), tkCents(0.625), tkCents(undefined)]')).toEqual(["0.62", "62", "", "62.5¢", "—"]);
  });

  it("lists where a market is, kept to the face's kind: yours that trade it (best first), yours that cannot with what to change, public venues to connect — not one already connected, none on a read-only server", () => {
    p.set("A", pageOf([EX, WALLET, READONLY]));
    const item = { kind: "coin", base: "BTC", at: [{ venue: "okx", venueName: "OKX", symbol: "BTC/USDT", connected: true, canTrade: false }, { venue: "kraken-public", venueName: "Kraken", symbol: "BTC/USD", connected: false, canTrade: false, public: true, price: 62000, connectTo: "kraken", connector: "live:exchange:kraken" }, { venue: "wallet", venueName: "Wallet", symbol: "cbBTC/USDC@Base", connected: true, canTrade: true, price: 62100 }] };
    const ranked = [{ venue: "ex", venueName: "Exchange", symbol: "BTC/USDT", kind: "spot", price: 61990, best: true, open: true, canTrade: true, ready: true }, { venue: "wallet", venueName: "Wallet", symbol: "cbBTC/USDC@Base", kind: "token", price: 62100, worse: 0.18, open: true, canTrade: true, ready: true }];
    const rows = p.out<Array<Record<string, unknown>>>(`tkWhereRows(${JSON.stringify(item)}, ${JSON.stringify(ranked)})`);
    expect(rows.map((r) => [r.state, r.venue])).toEqual([["able", "ex"], ["able", "wallet"], ["off", "okx"], ["public", "kraken-public"]]);
    expect(rows[0]).toMatchObject({ best: true, price: 61990 });
    expect(rows[2]).toMatchObject({ why: "this API key has no Trade permission", how: expect.stringMatching(/Trade.*Then connect it again\./) });
    // a perpetual standing in for the coin, or an RWA token of the same name, is not one of a coin's places (compare rows carry their kind)
    const mixed = [...ranked, { venue: "ex", venueName: "Exchange", symbol: "BTC/USDT:USDT", kind: "perp", price: 61995, open: true, canTrade: true, ready: true }, { venue: "wallet", venueName: "Wallet", symbol: "BTCx/USDC@Base", kind: "token", category: "RWA", price: 62050, open: true, canTrade: true, ready: true }];
    expect(p.out<Array<{ symbol?: string }>>(`tkWhereRows(${JSON.stringify(item)}, ${JSON.stringify(mixed)}, "crypto")`).map((r) => r.symbol)).toEqual(["BTC/USDT", "cbBTC/USDC@Base", undefined, "BTC/USD"]);
    // a stock's places are brokers: an RWA token of the same name is a line to RWAs, not a place to buy shares
    const nvda = { kind: "stock", base: "NVDA", at: [{ venue: "alpaca", venueName: "Alpaca", symbol: "NVDA", connected: true, canTrade: true, price: 180 }] };
    const stockRanked = [{ venue: "alpaca", venueName: "Alpaca", symbol: "NVDA", kind: "stock", price: 180, best: true, open: true, canTrade: true, ready: true }, { venue: "wallet", venueName: "Wallet", symbol: "NVDA/USDG@Robinhood Chain", kind: "token", category: "RWA", price: 181, open: true, canTrade: true, ready: true }];
    p.set("A", pageOf([EX, WALLET, venue("alpaca", "Alpaca", { trade: { can: true, what: "US stocks", kinds: ["stock"] } })]));
    expect(p.out<Array<{ venue: string }>>(`tkWhereRows(${JSON.stringify(nvda)}, ${JSON.stringify(stockRanked)}, "stocks")`).map((r) => r.venue)).toEqual(["alpaca"]);
    expect(p.out("[tkOfFace({ kind: 'token', category: 'RWA' }, 'rwas'), tkOfFace({ kind: 'token' }, 'rwas'), tkOfFace({ kind: 'token', category: 'RWA' }, 'crypto'), tkOfFace({ kind: 'perp' }, 'preipo'), tkOfFace({}, 'stocks')]")).toEqual([true, true, false, true, true]);
    // a pre-IPO venue carries its implied valuation and its unit (they differ by venue); the public one is a price while a connected venue
    // trades the row, and a connection to make when none does
    p.set("A", pageOf([EX]));
    const pre = p.out<Array<Record<string, any>>>(`tkWhereRows(${JSON.stringify(ANTH)}, null, "preipo")`);
    expect(pre.map((r) => [r.state, r.venue])).toEqual([["able", "ex"], ["public", "okx-preipo"]]);
    expect(pre[0]!.implied).toMatchObject({ usd: 2.08e12 });
    expect(pre[1]!.implied.unit).toMatch(/OKX: 1\/10,000,000,000/);
    expect(pre[1]!.connector).toBe("");
    p.set("A", pageOf([PRED]));
    expect(p.out<Array<Record<string, any>>>(`tkWhereRows(${JSON.stringify({ ...ANTH, at: [ANTH.at[0]] })}, null, "preipo")`)).toEqual([expect.objectContaining({ state: "public", venue: "okx-preipo", connector: "live:exchange:okx" })]);
    // OKX's own terms exclude where the user is: said beside the connection, which stays (shown, never enforced — its sign-up decides)
    p.run(`VENUES.set("live:exchange:okx", { connector: "live:exchange:okx", name: "OKX", verdict: "terms-exclude", said: "its terms exclude where you are (https://www.okx.com/help/terms-of-service, read 2026-10-08)" })`);
    const told = p.out<Array<Record<string, any>>>(`tkWhereRows(${JSON.stringify({ ...ANTH, at: [ANTH.at[0]] })}, null, "preipo")`);
    expect(told).toEqual([expect.objectContaining({ state: "public", venue: "okx-preipo", connector: "live:exchange:okx", terms: expect.objectContaining({ word: "Its terms exclude where you are" }) })]);
    // where OKX does not serve this network at all, it is not listed: the list is what serves the user, and it counts what it left out
    p.run(`VENUES.set("live:exchange:okx", { connector: "live:exchange:okx", name: "OKX", verdict: "not-served", said: "OKX does not serve this location" })`);
    const shut = p.run<{ rows: unknown[]; away: number }>(`(() => { const r = tkWhereRows(${JSON.stringify({ ...ANTH, at: [ANTH.at[0]] })}, null, "preipo"); return { rows: [...r], away: r.away }; })()`);
    expect(shut).toEqual({ rows: [], away: 1 });
    // close-only (a venue that takes the user only to close) stays, in a word, with no connection offered
    p.run(`VENUES.set("live:exchange:okx", { connector: "live:exchange:okx", name: "OKX", verdict: "close-only", said: "OKX lets this location close positions, not open new ones" })`);
    const closing = p.out<Array<Record<string, any>>>(`tkWhereRows(${JSON.stringify({ ...ANTH, at: [ANTH.at[0]] })}, null, "preipo")`);
    expect(closing).toEqual([expect.objectContaining({ state: "public", venue: "okx-preipo", connector: "", refuses: expect.objectContaining({ word: "Close only here" }) })]);
    // a connected venue that does not serve this network now is not listed either
    p.set("A", pageOf([{ ...EX, notServed: { said: "Exchange does not serve this location" } }, WALLET, READONLY]));
    const away = p.run<{ venues: string[]; away: number }>(`(() => { const r = tkWhereRows(${JSON.stringify(item)}, ${JSON.stringify(ranked)}); return { venues: r.map((x) => x.venue), away: r.away }; })()`);
    expect(away).toEqual({ venues: ["wallet", "okx", "kraken-public"], away: 1 });
    // a connected close-only venue stays listed for what it takes (a sell), marked so the ticket says its state for a buy
    p.set("A", pageOf([{ ...EX, closeOnly: { said: "Exchange lets this location close positions, not open new ones" } }, WALLET, READONLY]));
    expect(p.out<Array<{ venue: string; closeOnly?: boolean }>>(`tkWhereRows(${JSON.stringify(item)}, ${JSON.stringify(ranked)})`).find((r) => r.venue === "ex")).toMatchObject({ state: "able", closeOnly: true });
    p.run(`VENUES.clear()`);
    // the public listing of a venue the owner has since connected is not offered again
    p.set("A", pageOf([EX, venue("kraken", "Kraken", { trade: { can: true, kinds: ["spot"] } })]));
    expect(p.out<Array<{ state: string }>>(`tkWhereRows(${JSON.stringify(item)}, [])`).map((r) => r.state)).not.toContain("public");
    // a read-only server: the public line is a price, there is nothing to connect for
    p.set("A", pageOf([EX], false));
    expect(p.out<Array<{ state: string; connector?: string }>>(`tkWhereRows(${JSON.stringify(item)}, [])`).find((r) => r.state === "public")?.connector).toBe("");
    // Connect to trade opens the connection the row names, through connect.js's own door (connectVia); one this server does not offer says so
    p.set("A", { ...pageOf([EX]), connectLive: { writes: { on: true, capUsd: 250 }, options: [{ kind: "exchange", connector: "live:exchange", needs: "key-file", venues: ["kraken"] }, { kind: "kalshi", connector: "live:kalshi", needs: "key-file" }] } });
    p.run('Object.defineProperty(Owner, "role", { get: () => "owner", configurable: true }); var CONNECTED = []; openConnect = (o, opts) => CONNECTED.push([o.kind, opts.exchange, opts.name]); var TOASTS = []; toast = (t) => TOASTS.push(t)');
    p.run('tkConnectTo({ connector: "live:exchange:kraken", venueName: "Kraken" }); tkConnectTo({ connector: "live:kalshi", venueName: "Kalshi" }); tkConnectTo({ venueName: "Nowhere" })');
    expect(p.out("CONNECTED")).toEqual([["exchange", "kraken", "Kraken"], ["kalshi", "", "Kalshi"]]);
    expect(p.out("TOASTS")).toEqual(["Nowhere can't be connected from this server."]);
  });

  it("says each face's own block from the market, the place and the row: hours and whole shares, the issuer once, a perpetual's facts and margin, a pre-IPO valuation and notice, an event's payout", () => {
    p.set("A", pageOf([EX, WALLET]));
    p.run("TK.cross = null");
    const kb = (kind: string, m: unknown, at: unknown, item: unknown, c: unknown = {}) => p.run<string>(`tkKindBlock(${JSON.stringify(kind)}, ${JSON.stringify(m)}, ${JSON.stringify(at)}, ${JSON.stringify(item)}, ${JSON.stringify(c)})`);
    // Stocks: the session from the venue's own clock (or the market calendar), never from `open` — at night a real broker's stock is still
    // open (Alpaca holds an order for the open) — then the venue's note verbatim; whole shares where the step is one
    const held = "the US stock market is closed: Alpaca holds an order and sends it when the market opens (2026-10-07 09:30 New York time). Until then no market order is placed here: it would fill at the opening price, which can be well away from this one. A limit, stop or stop-limit order waits for the open with its limit";
    const night = { symbol: "AAPL", kind: "stock", base: "AAPL", quote: "USD", open: true, session: { open: false, opensAt: "2026-10-07T13:30:00.000Z", closesAt: "2026-10-07T20:00:00.000Z" }, note: held, qtyStep: 1, types: ["limit", "stop", "stop_limit"] };
    const aapl = kb("stocks", night, null, null);
    expect(aapl).toContain(`<div><b>Closed</b> · opens Wed 7 Oct, 09:30 New York · ${held}</div>`);
    expect(aapl).not.toContain("Open now");
    expect(aapl).toContain("Whole shares only here.");
    // in session: open now, and when it closes, in New York time (an early close as the venue's clock says it)
    const day = kb("stocks", { ...night, session: { open: true, opensAt: "2026-10-07T13:30:00.000Z", closesAt: "2026-10-06T20:00:00.000Z" }, note: undefined, qtyStep: 0.001, types: ["market", "limit"] }, null, null);
    expect(day).toContain("<div><b>Open now</b> · closes 16:00 New York</div>");
    expect(day).not.toContain("Whole shares only here.");
    expect(kb("stocks", { ...night, session: { open: true, closesAt: "2026-11-27T18:00:00.000Z" }, note: undefined }, null, null)).toContain("<b>Open now</b> · closes 13:00 New York");
    // no session said (Alpaca's clock did not answer): no Open or Closed word at all, only the venue's own words
    const words = "Alpaca's market clock did not answer, so no market order is placed here: outside market hours Alpaca holds an order until the market opens, and a market order would fill at the opening price";
    const unknown = kb("stocks", { ...night, session: undefined, note: words }, null, null);
    expect(unknown).toContain(`<div>${words.replace(/'/g, "&#39;")}</div>`);
    expect(unknown).not.toMatch(/Open now|<b>Closed/);
    expect(kb("stocks", { ...night, session: undefined, note: undefined, qtyStep: 1 }, null, null)).toBe("<div>Whole shares only here.</div>");
    // a stock the venue takes no order in now (halted) says so with the venue's words, whatever the session
    const halted = kb("stocks", { ...night, open: false, session: { open: true, closesAt: "2026-10-06T20:00:00.000Z" }, note: "AAPL is halted at Robinhood: news pending" }, null, null);
    expect(halted).toContain("<div><b>Closed now.</b> AAPL is halted at Robinhood: news pending</div>");
    expect(halted).not.toContain("Open now");
    expect(halted.match(/halted at Robinhood/g)).toHaveLength(1);
    // RWAs: the issuer's words once, the pay token and the chain, the route's own line
    const ousg = kb("rwas", { symbol: "OUSG/USDC@Ethereum", kind: "token", base: "OUSG", quote: "USDC", open: true, note: "LI.FI: 0.25% fee, 0.5% slippage, gas paid by the wallet", types: ["market"] }, null, { kind: "rwa", base: "OUSG", issuer: "Ondo Finance", eligibility: "OUSG moves only between wallets Ondo has approved", at: [] });
    expect(ousg).toContain("Issued by <b>Ondo Finance</b>.");
    expect(ousg).toContain("OUSG moves only between wallets Ondo has approved");
    expect(ousg).toContain("Paid in <b>USDC</b> on Ethereum.");
    expect(ousg).toContain("LI.FI: 0.25% fee, 0.5% slippage, gas paid by the wallet");
    expect((ousg.match(/Ondo Finance/g) ?? []).length).toBe(1);
    // with chains to choose from, a Chain field
    expect(kb("rwas", { symbol: "OUSG/USDC@Ethereum", kind: "token", base: "OUSG", quote: "USDC", open: true, types: ["market"] }, null, null, { chains: [{ symbol: "OUSG/USDC@Ethereum", chain: "Ethereum", quote: "USDC" }, { symbol: "OUSG/USDG@Robinhood Chain", chain: "Robinhood Chain", quote: "USDG" }] })).toContain('<select name="chain">');
    // Perps: mark, funding and its next payment, the leverage the venue takes, the margin the amount needs, what is held
    const perp = { symbol: "ETH/USDT:USDT", kind: "perp", base: "ETH", quote: "USDT", price: 2500, open: true, fundingRate: 0.0001, nextFundingAt: "2026-10-06T16:00:00.000Z", maxLeverage: 20, types: ["market", "limit"] };
    const facts = kb("perps", perp, { venue: "ex", venueName: "Exchange" }, null, { amount: "100", unit: "usd", leverage: "5", held: { side: "long", qty: 0.05, leverage: 5, liquidationPrice: 2100, entryPrice: 2480 }, positions: [] });
    expect(facts).toContain("Mark 2,500 USDT");
    expect(facts).toContain("Funding 0.0100% a period, next paid 12:00 New York · up to 20x here.");
    // the margin is the quote's, from the order prepared (tkOrderWords), never from the amount typed: a step may round the order down
    expect(facts).not.toContain("Margin");
    expect(facts).toContain("You hold long 0.05 at 5x · liquidation at 2,100 · entry 2,480.");
    expect(kb("perps", perp, { venue: "ex", venueName: "Exchange" }, null, { positions: [] })).toContain("Nothing held here yet");
    // Pre-IPO: from the row alone when no market is picked — the valuation, the unit, the conversion, the company's notice, what it is not
    const pre = kb("preipo", null, null, ANTH, {});
    // Markets' own figure for a valuation (mkValuation), the same one its rows show
    expect(pre).toContain("Implied valuation ≈ $2.08T");
    expect(pre).toContain("a contract 2,080");
    expect(pre).toContain("1 contract = 1/1,000,000,000 of the implied company valuation");
    expect(pre).toContain("Becomes a stock perpetual at the IPO; the venue rebases when the share count is public.");
    expect(pre).toContain("Anthropic, 29 June 2026: transfers of its shares it has not approved are void");
    // the company's own words, labelled as such — the venue writes the contract, so nothing here says the company issues it
    expect(pre).toContain("<b>What the company says</b>");
    expect(pre).not.toContain("Issued by");
    expect(pre).toContain("This is a contract on a valuation, not a share.");
    // …and with the venue's market, the venue's own implied figure and the perpetual's facts too
    const preAt = kb("preipo", { symbol: "ANTHROPIC/USDT:USDT", kind: "perp", base: "ANTHROPIC", quote: "USDT", price: 2080, open: true, maxLeverage: 20, types: ["market"] }, ANTH.at[1], ANTH, { positions: [] });
    expect(preAt).toContain("a contract 2,080 USDT");
    expect(preAt).toContain("Up to 20x here.");
    // Predictions: the payout line from the amount, the close counted down, sells only what you hold
    const fed = { symbol: "SI-FEDCUT-DEC:YES", kind: "event", base: "SI-FEDCUT-DEC", quote: "USD", price: 0.62, ask: 0.62, bid: 0.6, outcome: "Yes", open: true, closeTime: "2026-12-10T19:00:00.000Z", sellsReduce: true, types: ["market", "limit"] };
    const pay = kb("predictions", fed, null, null, { side: "buy", outcome: "Yes", amount: "10", unit: "usd", held: { qty: 50 }, positions: [] });
    expect(pay).toContain("<b>16 contracts pay $16.00</b> if Yes · cost ≈ $9.92 · the market gives it 62%");
    expect(pay).toContain('data-tk-close="2026-12-10T19:00:00.000Z"');
    expect(pay).toContain("Sells only what you hold · 50 held.");
    expect(kb("predictions", fed, null, null, { side: "buy", outcome: "Yes", positions: [] })).toContain("<b>Yes</b> at 62¢ — the market gives it 62%. Each contract pays $1.00 if it happens, nothing if not.");
    // Crypto at a wallet: the venue's own line (route, slippage, gas); paid with a coin held: the two steps said
    expect(kb("crypto", { symbol: "WETH/USDC@Base", kind: "token", base: "WETH", quote: "USDC", open: true, bid: 2499, ask: 2501, note: "Route by LI.FI · 0.3% slippage · gas ≈ $0.02", types: ["market"] }, null, null, { pay: { asset: "cbBTC" } })).toMatch(/Route by LI\.FI[\s\S]*Paid with <b>cbBTC<\/b>: sold first, then WETH bought/);
  });

  it("a session outside the regular one — pre-market, after-hours, overnight — is said with when it ends, on New York's clock and the viewer's own, and whether a limit with extended hours trades now; the ticket drafts the flag only for a limit", () => {
    const line = (s: unknown) => p.run<string>(`tkSessionLine(${JSON.stringify(s)})`);
    const words = (s: unknown) => p.run<string>(`mkSessionWhen(${JSON.stringify(s)})`);
    const night = { open: false, opensAt: "2026-10-14T13:30:00.000Z", closesAt: "2026-10-14T20:00:00.000Z", phase: "overnight", phaseEndsAt: "2026-10-14T08:00:00.000Z", extendedHours: true };
    // the page's own zone is New York's here (the stand-in browser), so no "your time" follows
    expect(p.run<string>("YOUR_ZONE")).toBeDefined();
    expect(line(night).replace(/ \([^)]* your time\)/g, "")).toBe("<b>Overnight session</b> · until 04:00 New York · a limit order with extended hours trades now · regular session opens Wed 14 Oct, 09:30 New York");
    expect(line({ ...night, phase: "pre", phaseEndsAt: "2026-10-14T13:30:00.000Z" }).replace(/ \([^)]* your time\)/g, "")).toBe("<b>Pre-market</b> · until 09:30 New York · a limit order with extended hours trades now · regular session opens Wed 14 Oct, 09:30 New York");
    expect(line({ ...night, phase: "after", phaseEndsAt: "2026-10-15T00:00:00.000Z", extendedHours: false }).replace(/ \([^)]* your time\)/g, "")).toBe("<b>After-hours</b> · until 20:00 New York · orders wait for the regular session · regular session opens Wed 14 Oct, 09:30 New York");
    expect(line({ open: false, opensAt: "2026-10-19T13:30:00.000Z", phase: "closed" }).replace(/ \([^)]* your time\)/g, "")).toBe("<b>Closed</b> · opens Mon 19 Oct, 09:30 New York");
    expect(line({ open: true, closesAt: "2026-10-14T20:00:00.000Z", phase: "regular", extendedHours: false }).replace(/ \([^)]* your time\)/g, "")).toBe("<b>Open now</b> · closes 16:00 New York");
    expect(words(night).replace(/ \([^)]* your time\)/g, "")).toBe("overnight session until 04:00 New York · a limit order with extended hours trades now");
    expect(words({ open: false, opensAt: "2026-10-19T13:30:00.000Z" })).toMatch(/^opens Mon 19 Oct, 09:30 New York/);
    // the viewer's own clock, by zone: Hong Kong's afternoon for New York's 04:00, Singapore's evening for 09:30, the next day's morning for 20:00
    const your = (iso: string, zone: string) => p.run<string>(`yourTime(${JSON.stringify(iso)}, ${JSON.stringify(zone)})`);
    expect(your("2026-10-14T08:00:00.000Z", "Asia/Hong_Kong")).toBe(" (16:00 your time)");
    expect(your("2026-10-14T13:30:00.000Z", "Asia/Singapore")).toBe(" (21:30 your time)");
    expect(your("2026-10-15T00:00:00.000Z", "Asia/Hong_Kong")).toBe(" (Thu 08:00 your time)");
    expect(your("2026-10-14T08:00:00.000Z", "America/New_York")).toBe("");
    expect(your("2026-10-14T08:00:00.000Z", "America/Los_Angeles")).toBe(" (01:00 your time)");
    // Advanced's line: the flag when set, "possible" when the market's session takes it
    const adv = (m: unknown, f: unknown) => p.run<string>(`tkAdvSummary(${JSON.stringify(m)}, ${JSON.stringify(f)})`);
    expect(adv({ tifs: ["day", "gtc"], session: { extendedHours: true } }, { orderType: "limit", extendedHours: "on" })).toBe("extended hours");
    expect(adv({ tifs: ["day", "gtc"], session: { extendedHours: true } }, { orderType: "limit", tif: "day", extendedHours: "on" })).toBe("Today only · extended hours");
    expect(adv({ tifs: ["day", "gtc"], session: { extendedHours: true } }, { orderType: "limit" })).toBe("The venue's default · today only · until canceled · extended hours possible");
    expect(adv({ session: { extendedHours: true } }, { orderType: "stop" })).toBe("The venue's default time in force");
    // the draft carries the flag for a limit only
    const draft = (f: unknown) => p.out(`tkOrderDraft(${JSON.stringify(f)}, { venue: "alpaca-paper", symbol: "AAPL", side: "buy", event: false })`);
    expect(draft({ amount: "20", unit: "usd", orderType: "limit", limitPrice: "201", tif: "day", extendedHours: "on" })).toMatchObject({ orderType: "limit", limitPrice: "201", tif: "day", extendedHours: "true" });
    expect(draft({ amount: "20", unit: "usd", orderType: "stop_limit", limitPrice: "201", stopPrice: "199", extendedHours: "on" })).toMatchObject({ orderType: "stop_limit", extendedHours: "" });
  });

  it("speaks the venue's rule on Advanced's one line — what is set, else what the market takes — never invented", () => {
    const adv = (m: unknown, f: unknown) => p.run<string>(`tkAdvSummary(${JSON.stringify(m)}, ${JSON.stringify(f)})`);
    // Kalshi: a market order fills now or is cancelled
    expect(adv({ tifs: ["ioc", "fok", "gtc"], tifsByType: { market: ["ioc", "fok"] } }, { orderType: "market" })).toBe("A market order here fills now or is cancelled (ioc/fok)");
    // Polymarket: never rests until cancelled
    expect(adv({ tifs: ["fok", "day"] }, { orderType: "limit" })).toBe("Never rests until cancelled here: all now or nothing or today only");
    // mm Hyperliquid: nothing to set from here
    expect(adv({}, { orderType: "limit" })).toBe("The venue's defaults: no time in force, post-only or reduce-only is set from here");
    // an exchange: the default and what it takes; once something is set, that
    expect(adv({ tifs: ["gtc", "day"], postOnly: true, reduceOnly: true }, { orderType: "limit" })).toBe("The venue's default · until canceled · today only · post-only possible · reduce-only possible");
    expect(adv({ tifs: ["gtc", "day"], postOnly: true }, { orderType: "limit", tif: "gtc", postOnly: "on" })).toBe("Until canceled · post-only");
    // the disclosure is folded and holds exactly the time in force and the flags; the leverage of a perpetual stays in view above it
    const src = source("ui/trade.js");
    const details = src.indexOf('<details class="tk-adv" data-adv hidden>');
    expect(details).toBeGreaterThan(0);
    const inside = src.slice(details, src.indexOf("</details>", details));
    for (const f of ["data-more", "data-tif", 'name="postOnly"', "data-adv-sum"]) expect(inside, f).toContain(f);
    expect(inside).not.toContain("data-lev");
    // reduce only and take profit / stop loss sit in view, under the size, as a trading screen holds them
    expect(inside).not.toContain('name="reduceOnly"');
    expect(src.indexOf('name="reduceOnly"')).toBeLessThan(details);
    expect(src.indexOf('name="tpsl"')).toBeLessThan(details);
    expect(src.indexOf('<div class="tk-lev" data-lev hidden>')).toBeLessThan(details);
    expect(src).toContain('q("[data-adv]").hidden = more.hidden;');
    // the quote and what is signed are written through paint: a refresh never takes the focus from What you sign
    expect(src).toContain("const show = (html) => paint(box, html);");
    expect(src).toContain("const signed = (html) => paint(sign, html);");
  });

  it("plans paying with a coin held: a dollar for a coin or back in one order, a coin for a coin in two through the dollar both share; one dollar for another is a Move", () => {
    const markets = [{ symbol: "WETH/USDC@Base", kind: "token", base: "WETH", quote: "USDC", open: true }, { symbol: "cbBTC/USDC@Base", kind: "token", base: "cbBTC", quote: "USDC", open: true }, { symbol: "USDY/USDC@Ethereum", kind: "token", base: "USDY", quote: "USDC", open: true }, { symbol: "BTC/USDT", kind: "spot", base: "BTC", quote: "USDT", open: true }, { symbol: "SOL/USDT", kind: "spot", base: "SOL", quote: "USDT", open: true }];
    const plan = (o: Record<string, unknown>) => p.out<any>(`tkSwapPlan(${JSON.stringify({ markets, ...o })})`);
    expect(plan({ venue: "ex", from: "USDC", to: "USDT", amount: "50" })).toMatchObject({ mode: "", why: expect.stringMatching(/Move › Swap stablecoins/) });
    expect(plan({ venue: "wallet", from: "USDC", to: "WETH", amount: "25", chain: "Base" }).legs).toEqual([{ type: "liveOrder", venue: "wallet", symbol: "WETH/USDC@Base", side: "buy", orderType: "market", usd: "25", limitPrice: "", stopPrice: "", tif: "", postOnly: "", reduceOnly: "" }]);
    expect(plan({ venue: "wallet", from: "WETH", to: "USDC", amount: "0.1", chain: "Base" }).legs[0]).toMatchObject({ symbol: "WETH/USDC@Base", side: "sell", qty: "0.1" });
    // a coin held on one chain is sold there, and only a coin listed against the same dollar on that chain can be bought with it
    const two = plan({ venue: "wallet", from: "WETH", to: "cbBTC", amount: "0.1", chain: "Base" });
    expect(two).toMatchObject({ mode: "two", from: "WETH", to: "CBBTC", via: "USDC", legs: [{ symbol: "WETH/USDC@Base", side: "sell", qty: "0.1" }, { symbol: "cbBTC/USDC@Base", side: "buy", usd: "" }] });
    expect(p.run(`tkSwapHow(${JSON.stringify(two)})`)).toBe("Two orders: sells WETH for USDC (WETH/USDC@Base), then buys CBBTC with what that brings (cbBTC/USDC@Base) — two signatures.");
    expect(plan({ venue: "wallet", from: "WETH", to: "USDY", amount: "0.1", chain: "Base" })).toMatchObject({ mode: "", why: expect.stringMatching(/USDY isn't listed against USDC/) });
    expect(plan({ venue: "ex", from: "BTC", to: "SOL", amount: "0.001" })).toMatchObject({ mode: "two", via: "USDT" });
    expect(plan({ venue: "ex", from: "USDC", to: "BTC", amount: "10" })).toMatchObject({ mode: "", why: "BTC isn't listed against USDC here (it trades against USDT)." });
    expect(plan({ venue: "ex", from: "BTC", to: "BTC" }).why).toBe("Pick two different assets.");
    // what the sale brought, less its fee, down to the cent: what the second leg spends
    expect(p.out("tkProceeds({ filledQty: 0.001, avgPrice: 62523.2, feeUsd: 0.04 })")).toBe(62.48);
    expect(p.out("tkProceeds({ filledQty: 0, price: 10 })")).toBe(0);
    // the ticket's own words for the two steps and its buttons
    const src = source("ui/trade.js");
    for (const words of ["Two steps, two signatures.", "Sign the sale (1 of 2)", "Sign the buy (2 of 2)", "tkFilled(o, live)", "tkProceeds(o)"]) expect(src, words).toContain(words);
  });

  it("Under way: an agent's card is a status row whose one action is Review (answered under Portfolio); an order has Change, Cancel, Send from wallet…", () => {
    p.set("A", pageOf([EX, WALLET]));
    const card = { id: "card-7", kind: "order", reason: "Buy about $120 of ETH", agentName: "Claude Code", expiresAt: "2026-10-06T12:29:00.000Z", shown: [{ name: "venue", value: "ex" }] };
    const acts = p.run<string>(`tkOpenActs({ c: ${JSON.stringify(card)} })`);
    expect(acts).toContain('data-review="card-7"');
    expect(acts).not.toMatch(/Approve|Reject|data-card/);
    expect(p.run<string>(`tkOpenStatus({ c: ${JSON.stringify(card)} })`)).toContain("Waiting for you");
    expect(p.run<string>(`tkOpenWhat({ c: ${JSON.stringify(card)} })`)).toContain("Buy about $120 of ETH");
    const order = { id: "ord-9", venue: "ex", venueName: "Exchange", side: "buy", qty: 0.5, base: "SOL", type: "limit", limitPrice: 140, status: "open", clientId: "c9" };
    const oacts = p.run<string>(`tkOpenActs({ o: ${JSON.stringify(order)} })`);
    expect(oacts).toContain('data-amend="ord-9"');
    expect(oacts).toContain('data-cancel="ord-9"');
    expect(p.run<string>(`tkOpenActs({ o: ${JSON.stringify({ ...order, venue: "wallet", venueName: "Wallet", walletTxs: [{}], ref: "" })} })`)).toContain("Send from wallet…");
    // an order the account stopped following (the owner's cancel asked while its venue refused this network): Not followed, its note on
    // hover, never Open; no Change, and Cancel stays (it sends the owner's cancel again)
    const gone = { ...order, unfollowed: true, note: "Exchange refuses this network, so the account can neither cancel it nor see it fill: it stopped following it. Cancel it at Exchange" };
    expect(p.run<string>(`tkOpenStatus({ o: ${JSON.stringify(gone)} })`)).toBe(`<span class="tp-st dim" title="${gone.note}">Not followed</span>`);
    const goneActs = p.run<string>(`tkOpenActs({ o: ${JSON.stringify(gone)} })`);
    expect(goneActs).not.toContain("data-amend");
    expect(goneActs).toContain('data-cancel="ord-9"');
    expect(p.run<string>(`tkOpenStatus({ o: ${JSON.stringify(order)} })`)).toBe('<span class="tp-st">Open</span>');
    const src = source("ui/trade.js");
    expect(src).toContain('if (d.review) return void go("portfolio", { card: d.review });');
    expect(src).not.toContain('type: "approveCard"');
    // drawn through paint (in place: the focused button keeps its focus), its buttons heard once, on the section itself; the empty words
    // say where a card is answered
    const body = src.slice(src.indexOf("function tkDrawOpen"), src.indexOf("function tkOpenWhat"));
    expect(body).toContain("paint(sec, html);");
    expect(body).toMatch(/if \(sec\.tkHeard\) return;\s*sec\.tkHeard = true;\s*sec\.addEventListener\("click"/);
    expect(body).toContain("data-cancel-all");
  });

  it("drafts the owner's words to an agent and, when asked, its trading limit for them — exactly the fields the door signs; the composer suggests by the six kinds", () => {
    const now = Date.parse("2026-10-06T12:00:00.000Z");
    const d = p.out<any>(`htaDrafts({ agent: "0xABCDEF0000000000000000000000000000000001", venue: "ex", symbol: " ETH/USDT ", side: "sell", usd: "100", text: "  Sell about $100 of ETH under $2,300  ", days: "7", withLimit: true, perOrder: "", budget: "200" }, ${now})`);
    expect(d.intent).toEqual({ type: "setIntent", id: "", agent: "0xabcdef0000000000000000000000000000000001", venue: "ex", symbol: "ETH/USDT", side: "sell", usd: "100", text: "Sell about $100 of ETH under $2,300", validUntil: now + 7 * 86_400_000 });
    // per order left empty: the whole budget is one order's most
    expect(d.limit).toEqual({ type: "approveSpend", agent: "0xabcdef0000000000000000000000000000000001", scope: "trade", allow: "ex", perPayment: "200", budget: "200", windowHours: 0, validUntil: now + 7 * 86_400_000 });
    // every agent: no limit (a limit is one agent's); no venue: every venue; words cut at 200; a side that is neither is left to the agent
    const all = p.out<any>(`htaDrafts({ agent: "*", side: "hold", text: ${JSON.stringify("x".repeat(260))}, withLimit: true, budget: "50" }, ${now})`);
    expect([all.limit, all.intent.agent, all.intent.side, all.intent.text.length]).toEqual([null, "*", "", 200]);
    expect(p.out<any>(`htaDrafts({ agent: "0xabcdef0000000000000000000000000000000001", text: "go", withLimit: true, budget: "50" }, ${now})`).limit.allow).toBe("*");
    // handing over earning gives an earn limit, not a trading one — at the venue named, or the venues that earn; never every account
    expect(p.out<any>(`htaDrafts({ agent: "0xabcdef0000000000000000000000000000000001", venue: "okx", text: "keep USDC earning", withLimit: true, budget: "50", scope: "earn" }, ${now})`).limit).toMatchObject({ scope: "earn", allow: "okx" });
    expect(p.out<any>(`htaDrafts({ agent: "0xabcdef0000000000000000000000000000000001", text: "keep USDC earning", withLimit: true, budget: "50", scope: "earn", earnAt: "okx,mm" }, ${now})`).limit).toMatchObject({ scope: "earn", allow: "okx,mm" });
    expect(p.out<any>(`htaDrafts({ agent: "0xabcdef0000000000000000000000000000000001", text: "keep USDC earning", withLimit: true, budget: "50", scope: "earn" }, ${now})`).limit).toBeNull();
    // words being changed keep the end of the limit given with them: both end at that moment
    const kept = p.out<any>(`htaDrafts({ id: "intent-0002", agent: "0xabcdef0000000000000000000000000000000001", text: "slower", days: "1", until: ${now + 5 * 86_400_000}, withLimit: true, budget: "50" }, ${now})`);
    expect([kept.intent.validUntil, kept.limit.validUntil]).toEqual([now + 5 * 86_400_000, now + 5 * 86_400_000]);
    // what the door signs, field for field, once the account adds its nonce
    for (const a of [d.intent, d.limit, { type: "setIntent", id: "intent-0001", agent: "*", venue: "", symbol: "", side: "", usd: "", text: "", validUntil: 0 }]) expect(malformed({ ...a, nonce: now } as OwnerAction), a.type).toBeNull();
    // the composer: a hint for each of the six kinds and for earning; a kind tag; the sheet variant lists no intents (Portfolio does)
    expect(p.out("Object.keys(HTA_HINT)")).toEqual(["crypto", "stocks", "rwas", "perps", "preipo", "predictions", "earn"]);
    expect(p.out('[htaKindWord("perps"), htaKindWord("earn"), htaKindWord("")]')).toEqual(["Perps", "Earn", ""]);
    const intent = source("ui/intent.js");
    expect(intent).not.toContain("Your words to agents");
    expect(intent).not.toMatch(/Conservative|Aggressive/);
    expect(intent).toContain("openSheet('<div data-hta></div>'");
    expect(intent).toContain("openTicket({ ...(kind !== \"earn\" ? { kind } : {}),");
    expect(p.run("typeof htaIntents")).toBe("function");
  });
});

describe("what the ticket says is available to trade, and the slider that sizes from it", () => {
  const p = page();
  p.set("A", pageOf([EX]));
  const av = (v: unknown, m: unknown, o: unknown = {}) => p.out<any>(`tkAvail(${JSON.stringify(v)}, ${JSON.stringify(m)}, ${JSON.stringify(o)})`);

  it("counts only the dollars free to spend: not a paper perpetual's margin and result, not Hyperliquid's margin in use", () => {
    // $10,000 of paper, $5,000 of it the margin of an open BTC perpetual: $5,000 is there to trade with
    const paper = venue("paper-1", "Paper", { paper: true, cashUsd: 10000, holdings: [{ asset: "USD", amount: 5000, usd: 5000, class: "cash", note: "paper money" }, { asset: "USD", amount: 5000, usd: 5000, class: "cash", note: "paper margin · long 0.1 BTC-PERP · 5x", freeUsd: 0 }] });
    expect(av(paper, { kind: "coin", symbol: "ETH/USD", base: "ETH" }).cash).toBe(5000);
    expect(av(paper, { kind: "perp", symbol: "ETH-PERP", base: "ETH" }, { positions: [] }).cash).toBe(5000);
    // Hyperliquid's perps account: worth $1,000, $400 of it withdrawable; and $50 on its spot side, another ledger than a perpetual's
    const hl = venue("hl", "Hyperliquid", { connector: "live:hyperliquid-trade", cashUsd: 1050, holdings: [{ asset: "USDC", amount: 1000, usd: 1000, class: "stable", note: "perps · 400.00 withdrawable", freeUsd: 400 }, { asset: "USDC", amount: 50, usd: 50, class: "stable", note: "spot" }] });
    expect(av(hl, { kind: "perp", symbol: "BTC/USDC:USDC", name: "BTC/USDC perpetual", base: "BTC" }, { positions: [] }).cash).toBe(400);
    // money on its way is not there yet, nor is an exchange's funding account's (an order is paid from its trading account)
    expect(av(venue("ex", "Exchange", { holdings: [{ asset: "USDT", amount: 300, usd: 300, class: "stable", note: "spot" }, { asset: "USDT", amount: 200, usd: 200, class: "stable", inTransit: true }, { asset: "USDT", amount: 700, usd: 700, class: "stable", note: "funding" }] }), { kind: "spot", symbol: "BTC/USDT", base: "BTC" }).cash).toBe(300);
    // a wallet's market on one chain is paid from that chain's dollars
    const wallet = venue("wallet", "Wallet", { holdings: [{ asset: "USDC", amount: 100, usd: 100, class: "stable", note: "Base" }, { asset: "USDC", amount: 500, usd: 500, class: "stable", note: "Arbitrum" }] });
    expect(av(wallet, { kind: "token", symbol: "WETH/USDC@Base", base: "WETH" }).cash).toBe(100);
  });

  it("counts at Hyperliquid only the ledger the market is margined or paid from — an ordinary account's perps, each HIP-3 DEX's and spot are apart — and a unified account's for every market", () => {
    // an ordinary account: the perps account worth $1,000, $400 of it withdrawable; $500 of USDC and 10 HYPE on spot; $300 in a HIP-3 DEX's
    // own perps account, $120 of it withdrawable (live/hyperliquid-trade.ts balances, through the account's holdings)
    const lines = [
      { asset: "USDC", amount: 1000, usd: 1000, class: "stable", note: "perps · 400.00 withdrawable", freeUsd: 400 },
      { asset: "USDC", amount: 500, usd: 500, class: "stable", note: "spot" },
      { asset: "USDC", amount: 300, usd: 300, class: "stable", note: "perps · XYZ (HIP-3) · 120.00 withdrawable", freeUsd: 120 },
      { asset: "HYPE", amount: 10, usd: 400, class: "crypto", note: "spot" },
    ];
    const hl = venue("hl", "Hyperliquid", { connector: "live:hyperliquid-trade", cashUsd: 1800, holdings: lines });
    const btcPerp = { kind: "perp", symbol: "BTC/USDC:USDC", name: "BTC/USDC perpetual", base: "BTC" };
    const nvdaPerp = { kind: "perp", symbol: "XYZ-NVDA/USDC:USDC", name: "NVDA perpetual on XYZ (HIP-3, xyz:NVDA)", base: "NVDA" };
    const hypeSpot = { kind: "spot", symbol: "HYPE/USDC", name: "HYPE/USDC spot", base: "HYPE" };
    // a BTC perpetual is margined from the perps account alone: $400 withdrawable, not $900 with the spot dollars Hyperliquid would refuse
    expect(av(hl, btcPerp, { positions: [] }).cash).toBe(400);
    // a HIP-3 perpetual from its own DEX's account
    expect(av(hl, nvdaPerp, { positions: [] }).cash).toBe(120);
    // spot is paid from spot, and what a sell sells is held there
    const spot = av(hl, hypeSpot);
    expect([spot.cash, spot.qty]).toEqual([500, 10]);
    // its testnet's paper account keeps the same ledgers
    expect(av({ ...hl, connector: "live:hyperliquid-paper" }, btcPerp, { positions: [] }).cash).toBe(400);
    // a unified account: the spot balances are the whole account, a perpetual's margin and spot's dollars alike ($600 of $800 free)
    const uni = venue("hl", "Hyperliquid", { connector: "live:hyperliquid-trade", holdings: [{ asset: "USDC", amount: 800, usd: 800, class: "stable", note: "spot and perps · unified account", freeUsd: 600 }, { asset: "HYPE", amount: 10, usd: 400, class: "crypto", note: "spot and perps · unified account" }] });
    expect(av(uni, btcPerp, { positions: [] }).cash).toBe(600);
    expect(av(uni, nvdaPerp, { positions: [] }).cash).toBe(600);
    expect([av(uni, hypeSpot).cash, av(uni, hypeSpot).qty]).toEqual([600, 10]);
    // another venue's lines are counted as before, whatever their notes say
    expect(av({ ...hl, connector: "live:exchange:okx" }, btcPerp, { positions: [] }).cash).toBe(1020);
    // where Hyperliquid gave no withdrawable figure the note is the ledger's name alone, and the line (all of it free) is still that ledger
    const bare = venue("hl", "Hyperliquid", { connector: "live:hyperliquid-trade", holdings: [{ asset: "USDC", amount: 1000, usd: 1000, class: "stable", note: "perps" }, { asset: "USDC", amount: 500, usd: 500, class: "stable", note: "spot" }, { asset: "USDC", amount: 300, usd: 300, class: "stable", note: "perps · XYZ (HIP-3)" }] });
    expect(av(bare, btcPerp, { positions: [] }).cash).toBe(1000);
    expect(av(bare, nvdaPerp, { positions: [] }).cash).toBe(300);
    expect(av(bare, hypeSpot).cash).toBe(500);
  });

  it("counts no wallet line for a perpetual at MetaMask — Hyperliquid's, margined in the Hyperliquid account — says where its margin is, and gives nothing to slide; its token markets are still paid from their chain's dollars", () => {
    // a MetaMask wallet with $1,000 of USDC on Base and nothing read of its Hyperliquid account (adapters/metamask.ts: chain balances only)
    const mm = venue("mm", "MetaMask", { connector: "live:metamask", cashUsd: 1000, holdings: [{ asset: "USDC", amount: 1000, usd: 1000, class: "stable", note: "Base" }] });
    const perp = { kind: "perp", symbol: "BTC-PERP", name: "BTC perpetual on Hyperliquid", base: "BTC", quote: "USDC" };
    const a = av(mm, perp, { positions: [] });
    expect([a.cash, a.marginAt]).toEqual([null, "Hyperliquid"]);
    for (const side of ["buy", "sell"]) {
      const words = p.out<{ html: string; slider: boolean }>(`tkAvailWords(${JSON.stringify(a)}, ${JSON.stringify(perp)}, ${JSON.stringify(side)}, "MetaMask")`);
      expect(words.slider).toBe(false);
      expect(words.html).not.toContain("$1,000");
      expect(words.html).toContain('<span class="dim">Available to trade</span><span class="tab-nums">—</span>');
      expect(words.html).toContain("Margined in your Hyperliquid account, not this wallet&#39;s balances");
      // the position is the venue's positions read, as anywhere
      expect(words.html).toContain('<span class="dim">Current position</span><span class="tab-nums">0 BTC</span>');
    }
    expect(p.out(`tkPctFill(${JSON.stringify(a)}, 0.5)`)).toEqual({ unit: "usd", amount: "" });
    // the same wallet's token market on Base is paid from Base's dollars
    const token = av(mm, { kind: "token", symbol: "WETH/USDC@Base", base: "WETH" });
    expect([token.cash, token.marginAt]).toEqual([1000, undefined]);
    expect(p.out<{ html: string }>(`tkAvailWords(${JSON.stringify(token)}, { kind: "token", base: "WETH" }, "buy", "MetaMask")`).html).not.toContain("Margined in");
    // an event there is Polymarket's, paid in pUSD from the Predict deposit wallet (live/metamask.ts): no wallet line pays for it either
    const event = { kind: "event", symbol: "dem-house-2026:Yes", name: "Democrats win the House?", quote: "USD" };
    const e = av(mm, event, { positions: [] });
    expect([e.cash, e.marginAt]).toEqual([null, "Predict deposit"]);
    const ew = p.out<{ html: string; slider: boolean }>(`tkAvailWords(${JSON.stringify(e)}, ${JSON.stringify(event)}, "buy", "MetaMask")`);
    expect(ew.slider).toBe(false);
    expect(ew.html).not.toContain("$1,000");
    expect(ew.html).toContain("Paid in pUSD from your Predict deposit wallet, not this wallet&#39;s balances");
  });

  it("counts as held to sell only what can be sold there now: not what is lent out to earn, not a funding account's, not another chain's", () => {
    const ex = venue("ex", "Exchange", { holdings: [{ asset: "BTC", amount: 0.5, usd: 41000, class: "crypto", note: "spot" }, { asset: "BTC", amount: 1, usd: 82000, class: "earn", note: "Simple Earn" }, { asset: "BTC", amount: 0.2, usd: 16400, class: "crypto", note: "funding" }, { asset: "BTC", amount: 0.1, usd: 8200, class: "crypto", note: "spot", inTransit: true }] });
    expect(av(ex, { kind: "spot", symbol: "BTC/USDT", base: "BTC" }).qty).toBe(0.5);
    const wallet = venue("wallet", "Wallet", { holdings: [{ asset: "ETH", amount: 1, usd: 2500, class: "crypto", note: "Base" }, { asset: "ETH", amount: 2, usd: 5000, class: "crypto", note: "Arbitrum" }, { asset: "ETH", amount: 3, usd: 7500, class: "crypto", note: "Ethereum · no price" }] });
    expect(av(wallet, { kind: "token", symbol: "ETH/USDC@Base", base: "ETH" }).qty).toBe(1);
    expect(av(wallet, { kind: "token", symbol: "ETH/USDC@Ethereum", base: "ETH" }).qty).toBe(3);
    // a note that names no chain (a paper account's names its market) keeps its line: a paper token is sold where it is held
    const paper = venue("paper-1", "Paper", { paper: true, holdings: [{ asset: "OUSG", amount: 4, usd: 440, class: "rwa", note: "paper · OUSG/USDC@Ethereum from Ondo" }] });
    expect(av(paper, { kind: "token", symbol: "OUSG/USDC@Ethereum", base: "OUSG" }).qty).toBe(4);
  });

  it("sells only the units free now — a holding's part locked in an order resting at the venue is held, not available — and spends only the dollars free", () => {
    // 1 BTC held, 0.4 of it in a sell limit resting there; $300 of USDT all held for a buy limit resting there; $100 that says nothing: all free
    const ex = venue("ex", "Exchange", { holdings: [{ asset: "BTC", amount: 1, usd: 82000, class: "crypto", note: "spot", freeAmount: 0.6 }, { asset: "USDT", amount: 300, usd: 300, class: "stable", note: "spot", freeUsd: 0 }, { asset: "USDT", amount: 100, usd: 100, class: "stable", note: "spot" }, { asset: "ETH", amount: 2, usd: 5000, class: "crypto", note: "spot", freeAmount: 0.5 }] });
    const btc = { kind: "spot", symbol: "BTC/USDT", base: "BTC" };
    const a = av(ex, btc);
    expect([a.qty, a.held, a.cash]).toEqual([0.6, 1, 100]);
    const sell = p.out<{ html: string; slider: boolean }>(`tkAvailWords(${JSON.stringify(a)}, ${JSON.stringify(btc)}, "sell", "Exchange")`);
    expect(sell.html).toContain('<span class="dim">Available to trade</span><span class="tab-nums">0.6 BTC</span>');
    expect(sell.html).toContain('<span class="dim">Current position</span><span class="tab-nums">1 BTC</span>');
    expect(p.out(`tkPctFill(${JSON.stringify(a)}, 1, { sell: true, qtyStep: 0.00001 })`)).toEqual({ unit: "qty", amount: "0.6" });
    // a coin paid with is sold from its free units too
    expect(av(ex, btc, { pay: { asset: "ETH", chain: "spot" } }).coin).toEqual({ asset: "ETH", qty: 0.5 });
    // all of it locked: held, nothing to sell, nothing to slide
    const locked = av(venue("ex", "Exchange", { holdings: [{ asset: "BTC", amount: 1, usd: 82000, class: "crypto", freeAmount: 0 }] }), btc);
    expect([locked.qty, locked.held]).toEqual([0, 1]);
    expect(p.out<{ slider: boolean }>(`tkAvailWords(${JSON.stringify(locked)}, ${JSON.stringify(btc)}, "sell", "Exchange")`).slider).toBe(false);
  });

  it("gives no position where the venue's positions were not read — a dash and the venue's words, never a zero — and nothing to slide for a sell", () => {
    const ex = venue("ex", "Exchange", { holdings: [{ asset: "USDT", amount: 1000, usd: 1000, class: "stable" }] });
    const unread = av(ex, { kind: "event", symbol: "FED:YES", base: "FED" }, { positions: null, unread: "Exchange did not answer in time" });
    expect([unread.qty, unread.unread]).toEqual([null, "Exchange did not answer in time"]);
    const words = p.out<{ html: string; slider: boolean }>(`tkAvailWords(${JSON.stringify(unread)}, { kind: "event", base: "FED" }, "sell", "Exchange")`);
    expect(words.slider).toBe(false);
    expect(words.html).toContain("<span class=\"tab-nums\">—</span>");
    expect(words.html).not.toContain("0 contracts");
    expect(words.html).toContain("Positions at Exchange could not be read: Exchange did not answer in time");
    // read, and nothing held: a zero is what the venue said
    const read = av(ex, { kind: "perp", symbol: "BTC/USDT:USDT", base: "BTC" }, { positions: [] });
    expect(p.out<{ html: string }>(`tkAvailWords(${JSON.stringify(read)}, { kind: "perp", base: "BTC" }, "buy", "Exchange")`).html).toContain("0 BTC");
    // a contract market counted in contracts where one is not one coin (OKX's BTC swap, 0.01 BTC a contract)
    const okx = av(ex, { kind: "perp", symbol: "BTC/USDT:USDT", base: "BTC", contractSize: 0.01 }, { positions: [{ venue: "ex", symbol: "BTC/USDT:USDT", qty: 5, side: "long" }] });
    expect(p.out<{ html: string }>(`tkAvailWords(${JSON.stringify(okx)}, { kind: "perp", base: "BTC", contractSize: 0.01 }, "buy", "OKX")`).html).toContain("Long 5 contracts");
  });

  it("sizes from what is there: dollars for a buy, the holding for a sell, and — paying with a coin held — that coin, in its own units", () => {
    const ex = venue("ex", "Exchange", { holdings: [{ asset: "USDT", amount: 1000, usd: 1000, class: "stable" }, { asset: "ETH", amount: 2, usd: 5000, class: "crypto" }, { asset: "BTC", amount: 0.5, usd: 41000, class: "crypto" }] });
    const coin = av(ex, { kind: "spot", symbol: "BTC/USDT", base: "BTC" }, { pay: { asset: "ETH", chain: "" } });
    expect(coin.coin).toEqual({ asset: "ETH", qty: 2 });
    expect(p.out<{ html: string; slider: boolean }>(`tkAvailWords(${JSON.stringify(coin)}, { kind: "spot", base: "BTC" }, "buy", "Exchange")`)).toMatchObject({ slider: true, html: expect.stringContaining("2 ETH") });
    expect(p.out(`tkPctFill(${JSON.stringify(coin)}, 0.5, { coinStep: 0.0001 })`)).toEqual({ unit: "qty", amount: "1" });
    expect(p.out(`tkPctFill(${JSON.stringify(coin)}, 0.333, { coinStep: 0.0001 })`)).toEqual({ unit: "qty", amount: "0.666" });
    const plain = av(ex, { kind: "spot", symbol: "BTC/USDT", base: "BTC" });
    expect(p.out(`tkPctFill(${JSON.stringify(plain)}, 0.5)`)).toEqual({ unit: "usd", amount: "500" });
    expect(p.out(`tkPctFill(${JSON.stringify(plain)}, 0.5, { sell: true, qtyStep: 0.001 })`)).toEqual({ unit: "qty", amount: "0.25" });
    expect(p.out(`tkPctFill(${JSON.stringify(plain)}, 0)`)).toEqual({ unit: "usd", amount: "" });
  });
});

describe("the ticket in its panel, as the owner uses it", () => {
  const BTCP = { key: "perp:BTC", kind: "perp", name: "BTC perpetual", base: "BTC", price: 82000, tabs: [], at: [{ venue: "ex", venueName: "Exchange", symbol: "BTC/USDT:USDT", connected: true, canTrade: true, public: false, price: 82000 }, { venue: "hl", venueName: "Hyperliquid", symbol: "BTC-PERP", connected: true, canTrade: true, public: false, price: 82010 }] };
  const PERP_EX = { symbol: "BTC/USDT:USDT", name: "BTC perpetual", kind: "perp", base: "BTC", quote: "USDT", price: 82000, open: true, types: ["market", "limit"], reduceOnly: true, postOnly: true, tifs: ["gtc"], contractSize: 1 };
  const PERP_HL = { symbol: "BTC-PERP", name: "BTC perpetual", kind: "perp", base: "BTC", quote: "USDC", price: 82010, open: true, types: ["market", "limit"], contractSize: 1 };
  const open = async (t: ReturnType<typeof ticketPage>, kind: string, preset: Record<string, unknown>) => {
    t.set("ITEM", preset.item);
    t.run(`TK.kind = ${JSON.stringify(kind)}; tkTicket(PANEL, ${JSON.stringify(kind)}, { ...${JSON.stringify({ ...preset, item: undefined })}, item: ITEM })`);
    await settle();
  };
  const avail = (t: ReturnType<typeof ticketPage>) => String(t.part("[data-avail]").innerHTML);

  it("unticks Reduce only (and Post-only) when the order moves to a venue whose market takes none, so neither is sent from a hidden box", async () => {
    const t = ticketPage();
    t.set("A", pageOf([EX, HL]));
    t.run(`ANSWERS["/api/account/market?venue=ex"] = { ok: true, market: ${JSON.stringify(PERP_EX)} }; ANSWERS["/api/account/market?venue=hl"] = { ok: true, market: ${JSON.stringify(PERP_HL)} }; ANSWERS["/api/account/positions"] = { ok: true, positions: [], missing: [] };`);
    await open(t, "perps", { item: BTCP, venue: "ex", symbol: "BTC/USDT:USDT", side: "buy" });
    expect(t.part("[data-reduce]").hidden).toBe(false);
    t.field("reduceOnly").checked = true;
    t.field("postOnly").checked = true;
    t.field("orderType").value = "limit";
    expect(t.out("tkOrderDraft(formFields(FORM), { venue: 'ex', symbol: 'BTC/USDT:USDT', side: 'buy', event: false })")).toMatchObject({ reduceOnly: "true", postOnly: "true" });
    // Hyperliquid's line in Where: its market takes neither
    const i = t.out<number>("tkWhereRows(ITEM, null, 'perps').findIndex((r) => r.venue === 'hl')");
    t.part("[data-where]").querySelectorAll("button[data-at]").find((b: Stub) => b.dataset.at === String(i)).click();
    await settle();
    expect(t.part("[data-reduce]").hidden).toBe(true);
    expect([t.field("reduceOnly").checked, t.field("postOnly").checked]).toEqual([false, false]);
    expect(t.out("tkOrderDraft(formFields(FORM), { venue: 'hl', symbol: 'BTC-PERP', side: 'buy', event: false })")).toMatchObject({ orderType: "limit", reduceOnly: "", postOnly: "" });
  });

  it("draws what is available and the position held again when the account is read again (a fill), not only when the market is picked", async () => {
    const t = ticketPage();
    const ex = (usd: number) => ({ ...EX, cashUsd: usd, holdings: [{ asset: "USDT", amount: usd, usd, class: "stable" }] });
    t.set("A", pageOf([ex(1000), HL]));
    t.run(`ANSWERS["/api/account/market?venue=ex"] = { ok: true, market: ${JSON.stringify(PERP_EX)} }; ANSWERS["/api/account/positions"] = { ok: true, positions: [], missing: [] };`);
    await open(t, "perps", { item: BTCP, venue: "ex", symbol: "BTC/USDT:USDT", side: "buy" });
    expect(avail(t)).toContain("$1,000.00");
    expect(avail(t)).toContain("0 BTC");
    // the order filled: the account's next read has less cash, the venue's positions the new one
    t.set("A", pageOf([ex(900), HL]));
    t.run('ANSWERS["/api/account/positions"] = { ok: true, positions: [{ venue: "ex", symbol: "BTC/USDT:USDT", kind: "perp", qty: 0.5, side: "long" }], missing: [] }; TK.refreshAvail()');
    await settle();
    expect(avail(t)).toContain("$900.00");
    expect(avail(t)).toContain("Long 0.5 BTC");
    // every read of the account reaches it: the pane asks the ticket on each render
    const q = page();
    q.set("A", pageOf([EX]));
    q.run("tkDrawPane = () => {}; ttDraw = () => {}; var N = 0; TK.refreshAvail = () => N++; renderTrade({ el: { querySelector: () => ({}) }, owner: true, lens: lensNow(), params: {} })");
    expect(q.out("N")).toBe(1);
    // a placed order drops the positions kept, so the read after it is the venue's new one
    const submit = source("ui/trade.js").slice(source("ui/trade.js").indexOf('form.addEventListener("submit"'));
    expect(submit.slice(0, submit.indexOf("await load()"))).toContain('forget("/api/account/positions")');
  });

  it("shows no position where the venue's positions could not be read — its words instead — and says nothing of what is held there", async () => {
    const t = ticketPage();
    t.set("A", pageOf([{ ...EX, cashUsd: 1000, holdings: [{ asset: "USDT", amount: 1000, usd: 1000, class: "stable" }] }, HL]));
    t.run(`ANSWERS["/api/account/market?venue=ex"] = { ok: true, market: ${JSON.stringify(PERP_EX)} }; ANSWERS["/api/account/positions"] = { ok: true, positions: [], missing: [{ venue: "ex", venueName: "Exchange", why: "Exchange did not answer in time", code: "E_VENUE_UNREACHABLE", part: "positions" }] };`);
    await open(t, "perps", { item: BTCP, venue: "ex", symbol: "BTC/USDT:USDT", side: "buy" });
    expect(avail(t)).not.toContain("0 BTC");
    expect(avail(t)).toContain("Positions at Exchange could not be read: Exchange did not answer in time");
    expect(String(t.part("[data-kb]").innerHTML)).not.toContain("Nothing held here yet");
  });

  it("sizes a buy paid with a coin held in that coin: the slider writes how much of it is sold, never dollars into the coin's amount", async () => {
    const t = ticketPage();
    t.set("A", pageOf([{ ...EX, cashUsd: 1000, holdings: [{ asset: "USDT", amount: 1000, usd: 1000, class: "stable" }, { asset: "ETH", amount: 2, usd: 5000, class: "crypto" }] }]));
    const markets = [{ symbol: "BTC/USDT", kind: "spot", base: "BTC", quote: "USDT", open: true, qtyStep: 0.00001 }, { symbol: "ETH/USDT", kind: "spot", base: "ETH", quote: "USDT", open: true, qtyStep: 0.0001 }];
    t.run(`ANSWERS["/api/account/market?venue=ex"] = { ok: true, market: { symbol: "BTC/USDT", name: "BTC", kind: "spot", base: "BTC", quote: "USDT", price: 82000, open: true, types: ["market"], qtyStep: 0.00001 } }; ANSWERS["/api/account/markets"] = { ok: true, markets: ${JSON.stringify(markets)} };`);
    await open(t, "crypto", { item: ROW("coin", "BTC"), venue: "ex", symbol: "BTC/USDT", side: "buy" });
    expect(avail(t)).toContain("$1,000.00");
    t.field("pay").value = "ETH|";
    t.field("pay").dispatchEvent({ type: "change" });
    await settle();
    expect(t.field("unit").options.map((o: Stub) => o.value)).toEqual(["qty"]);
    expect(avail(t)).toContain("2 ETH");
    t.field("pct").value = "50";
    t.field("pct").dispatchEvent({ type: "input" });
    expect([t.field("unit").value, t.field("amount").value]).toEqual(["qty", "1"]);
  });

  it("looks the market up again once an account that trades it is there (after Connect to trade) by the words a search may hold and its key — an event's long question cut to them — and picks that account", async () => {
    const t = ticketPage();
    t.set("A", pageOf([PRED]));
    // 63 characters: longer than the account takes a search to be
    const title = "Will the Democrats win the House in the 2026 midterm elections?";
    expect(title.length).toBe(63);
    const before = { key: "event:dem-house-2026", kind: "event", name: title, category: "Politics", price: 0.62, tabs: [], at: [{ venue: "polymarket", venueName: "Polymarket", symbol: "DEM-HOUSE-2026:YES", public: true, connected: false, price: 0.62, connector: "live:polymarket" }] };
    // read again: an account of yours lists it now
    const again = { ...before, at: [{ venue: "predict", venueName: "Predictions", symbol: "DEM-HOUSE-2026:YES", connected: true, canTrade: true, public: false, price: 0.62 }] };
    t.run(`var AGAIN = ${JSON.stringify(again)};
      api = async (path) => { ASKED.push(path); if (!path.startsWith("/api/account/explore?")) return { ok: false, refusal: { message: "not answered in this test" } }; const words = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("q") || ""; return words.length > 60 ? { ok: false, refusal: { message: "a search is at most 60 characters" } } : { ok: true, items: [AGAIN] }; };`);
    await open(t, "predictions", { item: before, side: "buy" });
    // only a public venue lists it: nowhere to place it yet
    expect(t.part("[data-body]").hidden).toBe(true);
    t.run("ASKED.length = 0; TK.refindIdle()");
    await settle();
    const asked = new URLSearchParams(t.out<string[]>("ASKED").find((x) => x.startsWith("/api/account/explore?"))!.split("?")[1]);
    expect((asked.get("q") ?? "").length).toBeLessThanOrEqual(60);
    expect(asked.get("q")).toBe("Will the Democrats win the House in the 2026 midterm");
    expect(asked.get("key")).toBe("event:dem-house-2026");
    // found again: the account that trades it now is picked, and its market read there
    expect(t.part("[data-body]").hidden).toBe(false);
    expect(t.out<string[]>("ASKED")).toContain("/api/account/market?venue=predict&symbol=DEM-HOUSE-2026%3AYES");
  });

  it("opened with no market (the 't' key, a venue's Trade) shows its search, and the bar, chart and book let go of the last market", () => {
    const t = ticketPage();
    t.set("A", pageOf([EX]));
    t.run('var SET = []; ttSetItem = (x) => SET.push(x); TK.kind = "crypto"; tkTicket(PANEL, "crypto", {}); tkTicket(PANEL, "crypto", { venue: "ex" })');
    expect(t.out("SET")).toEqual([null, null]);
    expect(t.part("[data-find]").hidden).toBe(false);
    // the terminal sets aside the ticket's own head and its picked row (the bar names the market) — never its search, nor the composer's close
    const css = source("ui/terminal.css");
    expect(css).not.toMatch(/\.tt-order \.tk-find[^{]*\{[^}]*display: none/);
    expect(css).toContain(".tt-order .tk-h:has([data-tk-close])");
  });

  it("starts on the busiest market by itself only while none has shown on the frame and the owner opened nothing: a ticket opened on no market afterwards stays as it was opened", () => {
    const t = ticketPage();
    t.set("A", pageOf([EX]));
    t.run(`var OPENED = []; tkOpen = (x) => OPENED.push(x); chRelease = () => {}; bkRelease = () => {};
      var PANE = { querySelector: (s) => (s === "[data-tp]" ? null : { innerHTML: "" }), querySelectorAll: () => [] };
      TK.kind = "crypto"; TK.pending = null;
      var FRAME = () => { TT.started = false; TT.item = null; TT.at = null; OPENED.length = 0; TK.got = { crypto: { at: Date.now(), items: [${JSON.stringify(ROW("coin", "BTC"))}] } }; };`);
    // a new frame, the panel at rest on no market: the pane starts on the busiest of the kind, at rest
    t.run('FRAME(); tkTicket(PANEL, "crypto", { kind: "crypto", rest: true }); ttDraw(PANE, true)');
    expect(t.out("OPENED.map((x) => [x.item.key, x.rest])")).toEqual([["coin:BTC", true]]);
    // the frame's first market came from a Markets row; then the owner pressed "t": the ticket on no market is not replaced
    t.run(`FRAME(); ttSetItem(${JSON.stringify(ROW("coin", "ETH"))}, "crypto"); tkTicket(PANEL, "crypto", {}); ttDraw(PANE, true)`);
    expect(t.out("[OPENED, TT.item]")).toEqual([[], null]);
    // a market has shown, then the ticket is closed back to rest: nothing is picked by itself either
    t.run(`FRAME(); ttSetItem(${JSON.stringify(ROW("coin", "ETH"))}, "crypto"); tkTicket(PANEL, "crypto", { kind: "crypto", rest: true }); ttDraw(PANE, true)`);
    expect(t.out("OPENED")).toEqual([]);
    // nothing shown yet, the owner pressed "t" (or a venue's Trade) first: their ticket stays
    t.run('FRAME(); tkTicket(PANEL, "crypto", {}); ttDraw(PANE, true)');
    expect(t.out("OPENED")).toEqual([]);
    t.run('FRAME(); tkTicket(PANEL, "crypto", { venue: "ex" }); ttDraw(PANE, true)');
    expect(t.out("OPENED")).toEqual([]);
  });

  it("leaves a ticket the owner opened on a market still being looked up as it was opened: a kind's read landing meanwhile starts nothing over it", () => {
    const t = ticketPage();
    t.set("A", pageOf([EX]));
    t.run(`var OPENED = []; tkOpen = (x) => OPENED.push(x); chRelease = () => {}; bkRelease = () => {};
      var PANE = { querySelector: (s) => (s === "[data-tp]" ? null : { innerHTML: "" }), querySelectorAll: () => [] };
      TK.kind = "crypto"; TK.pending = null;
      // the venue's market is still being read: its answer does not come in this test
      var ANSWERED = api; api = (path) => (path.startsWith("/api/account/market?") ? new Promise(() => {}) : ANSWERED(path));
      var FRAME = () => { TT.started = false; TT.item = null; TT.at = null; OPENED.length = 0; TK.got = {}; };
      var LANDS = () => { TK.got = { crypto: { at: Date.now(), items: [${JSON.stringify(ROW("coin", "BTC"))}] } }; };`);
    // a new frame at rest, then Markets' Buy (a venue and its symbol, no row), looked up; the kind's read lands and the pane is drawn
    t.run('FRAME(); tkTicket(PANEL, "crypto", { kind: "crypto", rest: true }); tkTicket(PANEL, "crypto", { kind: "crypto", venue: "ex", symbol: "ETH/USDT", side: "buy" }); LANDS(); ttDraw(PANE, true)');
    expect(t.out("OPENED")).toEqual([]);
    // a ticket kept in this browser, opened again at rest on its market: the same
    t.run('FRAME(); tkTicket(PANEL, "crypto", { kind: "crypto", rest: true }); tkTicket(PANEL, "crypto", { kind: "crypto", venue: "ex", symbol: "ETH/USDT", side: "buy", amount: "25", rest: true }); LANDS(); ttDraw(PANE, true)');
    expect(t.out("OPENED")).toEqual([]);
    // the panel at rest on no market, on a new frame: the pane still starts on the busiest of the kind
    t.run('FRAME(); tkTicket(PANEL, "crypto", { kind: "crypto", rest: true }); LANDS(); ttDraw(PANE, true)');
    expect(t.out("OPENED.map((x) => [x.item.key, x.rest])")).toEqual([["coin:BTC", true]]);
  });
});

describe("the trading area in Hyperliquid's grammar: what the terminal and the ticket say", () => {
  /* a statement line as /api/account/statement gives one, cut to what the history tabs read */
  const line = (id: string, more: Record<string, unknown> = {}) => ({ key: `order:${id}`, id, type: "trade", kind: "buy", account: "ex", accountName: "Exchange", description: `Buy 1 ${id}`, amountUsd: 0, status: "open", by: "You", at: "2026-10-06T12:00:00.000Z", updatedAt: "2026-10-06T12:00:00.000Z", ...more });

  it("draws no Manual · Superagent switch of its own: the topbar's Regular · Superagent is the one way between the two", () => {
    const src = source("ui/terminal.js");
    expect(src).not.toContain("ttWhoTrades");
    expect(src).not.toContain("sg-switch");
    expect(src).not.toMatch(/hashOf\("superagent"/);
    const q = page();
    expect(q.run<string>("ttFrame()")).not.toContain("Superagent");
  });

  it("frames the panels as HL does: the bar inside the grid over the chart, the picker a popover beside its button, three tabs for a narrow terminal, a status strip at the foot", () => {
    const q = page();
    const f = q.run<string>("ttFrame()");
    // the grid's first part is the bar; the popover comes next (the keys reach it right after its button), not in the flow above the grid
    expect(f.indexOf('class="tt-grid"')).toBeLessThan(f.indexOf('class="tt-bar"'));
    expect(f.indexOf('class="tt-bar"')).toBeLessThan(f.indexOf('data-tt-pop'));
    expect(f.indexOf("data-tt-pop")).toBeLessThan(f.indexOf("data-tt-chart"));
    expect(f).not.toMatch(/class="tt-pop panel"/);
    expect(f).toMatch(/data-tt-mtabs>(<button[^>]*role="tab"[^>]*>(Chart|Order book|Trades)<\/button>){3}/);
    // the line of state and the said line live in the strip at the foot, not in the bar
    const bar = f.slice(f.indexOf('class="tt-bar"'), f.indexOf("data-tt-pop"));
    expect(bar).not.toContain("data-tp-state");
    expect(f.slice(f.indexOf('class="tt-foot"'))).toMatch(/data-tp-state[\s\S]*data-tt-said/);
    expect(f).toContain('data-tt-tab="orders"');
  });

  it("colours a perpetual's funding as HL does — positive in the accent, negative down — and marks the label that explains itself", () => {
    const q = page();
    q.set("A", pageOf([HL]));
    q.run('var BOX = { innerHTML: "" }; var TAGS = { innerHTML: "" }; var EL = { querySelector: (s) => (s === "[data-tt-stats]" ? BOX : s === "[data-tt-tags]" ? TAGS : null) }; TK.got = {};');
    q.run('TT.item = { kind: "perp", base: "BTC", name: "BTC perpetual" }; TT.at = { venue: "hl", symbol: "BTC-PERP" }; TT.mk = { kind: "perp", base: "BTC", quote: "USDC", price: 81900, fundingRate: 0.0000125 }; ttStats(EL)');
    const up = q.out<string>("BOX.innerHTML");
    expect(up).toContain('<span class="acc">0.0013%</span>');
    expect(up).toMatch(/<span class="tt-st-n" title="[^"]+">Funding<\/span>/);
    expect(up).not.toMatch(/<span class="tt-st-n" title[^>]*>Price</);
    q.run('TT.mk = { ...TT.mk, fundingRate: -0.0001 }; ttStats(EL)');
    expect(q.out<string>("BOX.innerHTML")).toContain('<span class="down">-0.0100%</span>');
    // a paper account's name in the bar without the word its tag says
    q.set("A", pageOf([{ ...HL, id: "paper-momentum", name: "Momentum · paper", paper: true }]));
    q.run('TT.at = { venue: "paper-momentum", symbol: "BTC-PERP" }; ttStats(EL)');
    expect(q.out<string>("TAGS.innerHTML")).toContain('<span class="tt-where">Momentum <span class="tag paper">Paper</span></span>');
  });

  it("Trade history lists what filled only, in HL's columns, by the market's name — never an open, waiting or canceled order, a raw symbol, or a buy's cost painted as a loss", async () => {
    const q = page();
    q.set("A", { ...pageOf([EX]), orders: [{ id: "ord-0006", clientId: "c6", venue: "predict", venueName: "Predictions", name: "Will the Fed cut rates? · Yes", base: "SI-FEDCUT-DEC:YES", kind: "event", side: "buy", type: "market", qty: 50, filledQty: 50, avgPrice: 0.63, status: "filled", at: "2026-10-06T12:00:00.000Z" }] });
    const lines = [
      line("c6", { id: "ord-0006", account: "predict", accountName: "Predictions", description: "Buy 50 SI-FEDCUT-DEC:YES · Will the Fed cut rates? · Yes · market · at 0.63", amountUsd: -31.5, worthUsd: 31.5, feeUsd: 0.2205, status: "filled" }),
      line("c5", { id: "ord-0005", description: "Buy 0.05 ETH · ETH perpetual · market · at 2456.74", amountUsd: -122.84, worthUsd: 122.84, feeUsd: 0.0737, status: "filled" }),
      line("c3", { id: "ord-0003", kind: "sell", description: "Sell 0.002 BTC · BTC / USDT · limit 63226.6", worthUsd: 126.45 }),
      line("c8", { id: "ord-0008", description: "Buy 0.001 BTC · BTC / USDT · limit 59352.9", worthUsd: 59.35, status: "canceled" }),
      line("c9", { id: "ord-0009", account: "broker", accountName: "Broker", description: "Buy 0.25 SPY · SPDR S&P 500 ETF Trust · limit 660.07", worthUsd: 165.02, status: "pending" }),
    ];
    q.run(`var HBOX = { innerHTML: "", isConnected: true }; api = async () => ({ ok: true, lines: ${JSON.stringify(lines)} })`);
    q.run('TT.tab = "history"; ttHistory(HBOX)');
    await settle();
    const fills = q.out<string>("HBOX.innerHTML");
    expect(fills).toMatch(/<th>Time<\/th><th>Market<\/th><th>Direction<\/th><th class="r">Price<\/th><th class="r">Size<\/th><th class="r">Trade value<\/th><th class="r">Fee<\/th><th>By<\/th>/);
    expect(fills).toContain("<b>Will the Fed cut rates? · Yes</b>");
    expect(fills).toContain("<b>ETH perpetual</b>");
    expect(fills).not.toContain("SI-FEDCUT-DEC:YES</b>");
    // the account's own order where the page has it: an event's price in cents; from the line's words otherwise
    expect(fills).toContain(">63¢<");
    expect(fills).toContain(">2,456.74<");
    expect(fills).toContain(">$122.84<");
    expect(fills).not.toContain("BTC / USDT");
    expect(fills).not.toContain("SPDR");
    expect(fills).not.toMatch(/class="[^"]*down[^"]*">[^<]*\$122/);
    // every order, with what became of it in words
    q.run('TT.tab = "orders"; HBOX.innerHTML = ""; ttOrders(HBOX)');
    await settle();
    const all = q.out<string>("HBOX.innerHTML");
    for (const w of ["Filled", "Open", "Canceled", "Waiting at Broker", "SPDR S&amp;P 500 ETF Trust", "BTC / USDT", ">Limit<", ">63,226.6<", ">Market<"]) expect(all, w).toContain(w);
    expect(q.out("ttOrderRec({ key: 'order:x', kind: 'sell', description: 'Sell 0.5 SOL · SOL / USDT · stop at 137.83, limit 136 · 0.2 of 0.5 filled' })")).toMatchObject({ name: "SOL / USDT", side: "sell", type: "stop_limit", qty: 0.5, filled: 0.2, stop: 137.83, limit: 136 });
  });

  it("Open orders: HL's columns, the market by its name, the account's id on hover, Cancel all heading the buttons", () => {
    const q = page();
    q.run('Object.defineProperty(Owner, "role", { get: () => "owner", configurable: true })');
    const o = (id: string, more: Record<string, unknown> = {}) => ({ id, clientId: id, venue: "ex", venueName: "Exchange", name: "SOL / USDT", base: "SOL", symbol: "SOL/USDT", kind: "spot", side: "buy", type: "limit", qty: 0.707, filledQty: 0, limitPrice: 141.44, usd: 100, status: "open", at: "2026-10-06T12:00:00.000Z", ...more });
    q.set("A", { ...pageOf([EX]), cards: [], payments: [], orders: [o("ord-0010"), o("ord-0004", { side: "sell", type: "stop", qty: 0.6, limitPrice: undefined, stopPrice: 137.83, usd: 82.7 })] });
    q.run('var SEC = { innerHTML: "", isConnected: true, addEventListener() {}, contains: () => false }; tkDrawOpen(SEC, true)');
    const html = q.out<string>("SEC.innerHTML");
    expect(html).toMatch(/<th>Time<\/th><th>Type<\/th><th>Market<\/th><th>Direction<\/th><th class="r">Size<\/th><th class="r">Original size<\/th><th class="r">Order value<\/th><th class="r">Price<\/th><th>Reduce only<\/th><th>Trigger<\/th>/);
    expect(html).toContain('title="ord-0010 · Exchange"');
    expect(html).toContain("Falls to 137.83");
    expect(html).toContain(">141.44<");
    expect(html).toMatch(/<th class="r"><button type="button" class="link" data-cancel-all[^>]*>Cancel all 2<\/button><\/th>/);
    q.set("A", { ...pageOf([EX]), cards: [], payments: [], orders: [] });
    q.run("tkDrawOpen(SEC, true)");
    expect(q.out<string>("SEC.innerHTML")).toContain('<p class="empty">No open orders yet.</p>');
  });

  it("says the smallest order the venue takes before asking the account, in its words, and asks nothing for it", () => {
    const q = page();
    const m = { kind: "perp", base: "BTC", name: "BTC perpetual", price: 62000, ask: 62010, bid: 61990, qtyStep: 0.001, minQty: 0.001, contractSize: 1 };
    const small = (d: Record<string, unknown>, mk: Record<string, unknown> = m) => q.run<string>(`tkTooSmall(${JSON.stringify(mk)}, ${JSON.stringify({ orderType: "market", side: "buy", ...d })}, "Exchange")`);
    expect(small({ usd: "25" })).toBe("The smallest order Exchange takes here is 0.001 BTC (about $62.01).");
    expect(small({ usd: "100" })).toBe("");
    expect(small({ qty: "0.0005" })).toBe("The smallest order Exchange takes here is 0.001 BTC (about $62.01).");
    expect(small({ usd: "100", orderType: "limit", limitPrice: "200000" })).toBe("The smallest order Exchange takes here is 0.001 BTC (about $200.00).");
    expect(small({ usd: "20" }, { ...m, minQty: undefined, qtyStep: 0.0001, minNotional: 50 })).toBe("The smallest order Exchange takes here is worth $50.00.");
    // a stop, no price, nothing typed: the account judges it
    expect(small({ usd: "1", orderType: "stop" })).toBe("");
    expect(small({ usd: "1" }, { ...m, price: undefined, ask: undefined, bid: undefined })).toBe("");
    expect(small({ usd: "" })).toBe("");
  });

  it("sums the order prepared under the button in label · value rows from the prepared order itself — Long or Short on a perpetual, its margin at the leverage held", () => {
    const q = page();
    const prep = { action: { side: "buy", qty: "0.001", orderType: "market" }, quote: { order: { kind: "perp", base: "BTC", quote: "USDT", name: "BTC perpetual", price: 62650, notionalUsd: 62.65, maxUsd: 63.9, worstPrice: 63903 } } };
    const words = q.run<string>(`tkOrderWords(${JSON.stringify(prep)}, null, { lev: 3 })`);
    expect(words).toContain("<span>Long 0.001 contracts · BTC</span><span>≈ $62.65</span>");
    expect(words).toContain("<dt>Order value</dt><dd>$62.65</dd>");
    expect(words).toContain("<dt>Margin required</dt><dd>$20.88 at 3x</dd>");
    expect(words).toContain("<dt>Most it may cost</dt><dd>$63.90</dd>");
    expect(q.run<string>(`tkOrderWords(${JSON.stringify({ ...prep, action: { ...prep.action, side: "sell" } })}, null, {})`)).toContain("<span>Short 0.001 contracts · BTC</span>");
    // no leverage the venue said: no margin row, never one worked out from a guess
    expect(q.run<string>(`tkOrderWords(${JSON.stringify(prep)}, null, {})`)).not.toContain("Margin required");
    const src = source("ui/trade.js");
    expect(src).toContain("Ready to sign for ");
    expect(src).not.toContain("Your signature is good for");
    // the size field shows no figure that reads as typed, and the button sits above the summary in the page's own order (no CSS order)
    expect(src).toContain('<input name="amount" inputmode="decimal" placeholder="" autocomplete="off" />');
    expect(src.indexOf("data-go disabled")).toBeLessThan(src.indexOf('<div class="quote real" data-q>'));
    // the leverage sits first, before the order types, in the page's own order: the keys meet it where the eye does
    expect(src.indexOf('<div class="tk-lev" data-lev hidden>')).toBeLessThan(src.indexOf('<div class="tk-otabs" data-otabs'));
    expect(source("ui/terminal.css")).not.toMatch(/\.tk-lev\s*\{\s*order:/);
  });

  it("writes Advanced's line in a few letters, the whole rule on hover — never a sentence cut mid-word", () => {
    const q = page();
    const short = (m: unknown, f: unknown) => q.run<string>(`tkAdvShort(${JSON.stringify(m)}, ${JSON.stringify(f)})`);
    expect(short({ tifs: ["gtc", "day"], postOnly: true }, { orderType: "limit" })).toBe("Default");
    expect(short({ tifs: ["gtc", "day"], postOnly: true }, { orderType: "limit", tif: "gtc", postOnly: "on" })).toBe("GTC · Post-only");
    expect(short({ tifs: ["ioc", "fok", "gtc"], tifsByType: { market: ["ioc", "fok"] } }, { orderType: "market" })).toBe("IOC/FOK");
    expect(source("ui/trade.js")).toContain('<abbr class="tk-tif" title="Time in force">TIF</abbr>');
  });
});

describe("the ticket's leverage and its places, in HL's grammar", () => {
  const PERP_EX = { symbol: "BTC/USDT:USDT", name: "BTC perpetual", kind: "perp", base: "BTC", quote: "USDT", price: 82000, open: true, types: ["market", "limit"], contractSize: 1, maxLeverage: 50 };
  const BTCP = { key: "perp:BTC", kind: "perp", name: "BTC perpetual", base: "BTC", price: 82000, tabs: [], at: [{ venue: "ex", venueName: "Exchange", symbol: "BTC/USDT:USDT", connected: true, canTrade: true, public: false, price: 82000 }] };
  const open = async (t: ReturnType<typeof ticketPage>, kind: string, preset: Record<string, unknown>) => {
    t.set("ITEM", preset.item);
    t.run(`TK.kind = ${JSON.stringify(kind)}; tkTicket(PANEL, ${JSON.stringify(kind)}, { ...${JSON.stringify({ ...preset, item: undefined })}, item: ITEM })`);
    await settle();
  };

  it("shows the leverage held as HL's button (3x, Cross where the venue says it), the field holding it, and Set leverage… only for another whole number up to the market's most", async () => {
    const t = ticketPage();
    t.run('Object.defineProperty(Owner, "role", { get: () => "owner", configurable: true })');
    t.set("A", pageOf([{ ...EX, cashUsd: 1000 }]));
    t.run(`ANSWERS["/api/account/market?venue=ex"] = { ok: true, market: ${JSON.stringify(PERP_EX)} }; ANSWERS["/api/account/positions"] = { ok: true, positions: [{ venue: "ex", symbol: "BTC/USDT:USDT", kind: "perp", qty: 0.01, side: "long", leverage: 3, marginMode: "cross" }], missing: [] };`);
    await open(t, "perps", { item: BTCP, venue: "ex", symbol: "BTC/USDT:USDT", side: "buy" });
    const pills = String(t.part("[data-lev-pills]").innerHTML);
    expect(pills).toContain(">Cross</button>");
    expect(pills).toContain(">3x</button>");
    expect(t.field("leverage").value).toBe("3");
    const ready = (v: string) => {
      t.field("leverage").value = v;
      t.field("leverage").dispatchEvent({ type: "input" });
      return !t.part("[data-lev-prep]").disabled;
    };
    expect(ready("3")).toBe(false);
    expect(ready("5")).toBe(true);
    expect(ready("51")).toBe(false);
    expect(ready("0")).toBe(false);
    expect(ready("2.5")).toBe(false);
    // nothing held and nothing set from here: no figure the venue did not give
    t.run('ANSWERS["/api/account/positions"] = { ok: true, positions: [], missing: [] }');
    await open(t, "perps", { item: BTCP, venue: "ex", symbol: "BTC/USDT:USDT", side: "buy" });
    expect(String(t.part("[data-lev-pills]").innerHTML)).toMatch(/>Leverage<\/button>$/);
  });

  it("lists only the accounts of the kind the Real money | Paper switch is on, names a paper account without the word its tag says, and folds one public venue under '1 other venue lists it'", async () => {
    const t = ticketPage();
    const PAPER = venue("paper-momentum", "Momentum · paper", { paper: true, trade: { can: true, what: "paper", kinds: ["spot"] } });
    t.set("A", pageOf([EX, PAPER]));
    const item = { key: "coin:BTC", kind: "coin", name: "BTC", base: "BTC", price: 62000, tabs: [], at: [{ venue: "ex", venueName: "Exchange", symbol: "BTC/USDT", connected: true, canTrade: true, public: false, price: 62000 }, { venue: "paper-momentum", venueName: "Momentum · paper", symbol: "BTC/USD", connected: true, canTrade: true, public: false, paper: true, price: 62010 }, { venue: "kraken-public", venueName: "Kraken", symbol: "BTC/USD", connected: false, canTrade: false, public: true, price: 62005, connectTo: "kraken", connector: "live:exchange:kraken" }] };
    t.run(`ANSWERS["/api/account/market"] = { ok: true, market: { symbol: "BTC/USDT", name: "BTC", kind: "spot", base: "BTC", quote: "USDT", price: 62000, open: true, types: ["market"] } }; ANSWERS["/api/account/compare"] = { ok: false };`);
    await open(t, "crypto", { item, venue: "ex", symbol: "BTC/USDT", side: "buy" });
    const real = String(t.part("[data-where]").innerHTML);
    expect(real).toContain("<b>Exchange</b>");
    expect(real).not.toContain("Momentum");
    expect(real).toContain("1 other venue lists it");
    expect(real).not.toContain("venue list it");
    // the switch to Paper: the paper account, by its own name beside its tag, and no public venue to connect
    t.part("[data-where]").querySelectorAll("button[data-money]").find((b: Stub) => b.dataset.money === "paper").click();
    await settle();
    const paper = String(t.part("[data-where]").innerHTML);
    expect(paper).toContain('<b>Momentum</b> <span class="tag paper"');
    expect(paper).not.toContain("<b>Exchange</b>");
    expect(paper).not.toContain("other venue");
  });
});

describe("the ticket at rest leaves the page refreshing", () => {
  it("opens the resting ticket on the kind showing without taking the focus, and its search counts as the page's own (data-live), so a cursor in it does not stop the refresh", () => {
    const p = page();
    p.set("A", pageOf([EX]));
    // what the panel is asked to open, captured: at rest, after its close, and on purpose (the shell's own route and render are stubbed:
    // this stand-in browser has no panes to draw)
    p.run("ROUTE.tab = 'trade'; TK.kind = 'crypto'; render = () => {}; routed = () => {}; OPENED = []; tkTicket = (panel, kind, preset) => OPENED.push([kind, preset]);");
    p.run("tkRest()");
    p.run("openTicket({})");
    p.run("openTicket({ kind: 'perp', venue: 'ex', symbol: 'ETH/USDT:USDT' })");
    expect(p.out("OPENED")).toEqual([["crypto", { kind: "crypto", rest: true }], ["crypto", {}], ["perps", { kind: "perp", venue: "ex", symbol: "ETH/USDT:USDT" }]]);
    // a ticket of another kind moves the seg to it
    expect(p.run("TK.kind")).toBe("perps");
    // off the Trade pane, the ticket waits and the page goes to Trade on the market's kind
    p.run("ROUTE.tab = 'portfolio'; var WENT = []; go = (tab, params) => WENT.push([tab, params]); openTicket({ kind: 'event', venue: 'predict', symbol: 'X' })");
    expect(p.out("[WENT, TK.pending]")).toEqual([[["trade", { kind: "predictions" }]], { kind: "event", venue: "predict", symbol: "X" }]);
    // the shell keeps refreshing while focus is inside [data-live]: the ticket's search and the picker's are marked so
    const src = source("ui/trade.js");
    expect(src).toContain('<div class="tk-find" data-find data-live>');
    expect(src).toContain('<form class="tk-pfind" role="search" data-live>');
    expect(src).toContain("if (!preset.symbol && !preset.venue && !preset.rest) setTimeout(() => live() && form.elements.q.focus(");
    // its close puts the panel back at rest on the kind showing, and drops the ticket kept in this browser
    expect(src).toContain('b.addEventListener("click", () => {\n    tkDraftKeep(null);\n    tkOpen({ kind: TK.kind, rest: true });');
    // earn and selling many are Portfolio's sheets now: an old preset goes there when they are on the page
    p.run("ROUTE.tab = 'trade'; var SHEETS = []; openEarn = (x) => SHEETS.push(['earn', x]); openSellMany = (x) => SHEETS.push(['sellmany', x]); OPENED = []; tkOpen({ variant: 'earn', venue: 'ex' }); tkOpen({ tile: 'sellmany' })");
    expect(p.out("[SHEETS, OPENED]")).toEqual([[["earn", { variant: "earn", venue: "ex" }], ["sellmany", { tile: "sellmany" }]], []]);
  });
});

describe("closing a position, from whichever pane", () => {
  const POS = { venue: "ex", venueName: "Exchange", symbol: "BTC/USDT:USDT", name: "BTC perpetual", kind: "perp", side: "long", qty: 0.5, usd: 31000, markPrice: 62000, unrealizedUsd: 120 };
  const prep = (close?: Record<string, unknown>) => ({ action: { type: "liveClose", venue: "ex", symbol: "BTC/USDT:USDT", qty: "" }, quote: { words: "close", ...(close ? { close } : {}) } });

  it("says what the prepared close is worth at the worst price it may fill at, and refuses one over the cap before the sign button — with a part that fits one click away; inside the cap, no standing cap sentence", () => {
    const p = page();
    p.set("A", pageOf([EX]));
    p.run("var QD = null; quoteDialog = (o) => { QD = o; return { form: { addEventListener() {}, elements: {} }, requote() {} }; }");
    p.run(`openClose(${JSON.stringify(POS)})`);
    expect(p.run("QD.title")).toBe("Close BTC perpetual");
    expect(p.run("QD.go")).toBe("Sign and close");
    // over the cap: the worth, the worst price, and the refusal before the sign button (block), with the part that fits
    const over = prep({ worthUsd: 30900, capUsd: 250, overCap: true, side: "sell", qty: 0.5, worstPrice: 61800 });
    const words = p.run<string>(`QD.show(${JSON.stringify(over)})`);
    expect(words).toContain("Sell 0.5");
    expect(words).toContain("≈ $30,900.00");
    expect(words).toContain("filled no worse than 61,800");
    expect(words).toContain("One order may be worth up to $250.00 on this server.");
    // 0.5 × $250 × 0.98 / $30,900, to the millionth
    expect(words).toContain('data-close-part="0.003964"');
    expect(p.run(`QD.block(${JSON.stringify(over)})`)).toBe("Worth about $30,900.00: more than the $250.00 one order may be on this server, so the account would refuse it. Close part of it.");
    // in the account's own words, where it gave them
    expect(p.run(`QD.block(${JSON.stringify(prep({ worthUsd: 30900, capUsd: 250, overCap: true, side: "sell", qty: 0.5, why: "$30,900.00 is more than the most one order may be on this server ($250.00): close part of it, or start the server with a higher --live-cap" }))})`)).toBe("$30,900.00 is more than the most one order may be on this server ($250.00): close part of it, or start the server with a higher --live-cap.");
    // inside the cap: nothing refused, and the cap not said (it belongs to the block message and Settings)
    const inside = prep({ worthUsd: 198.2, capUsd: 250, overCap: false, side: "sell", qty: 0.0032, worstPrice: 61500 });
    expect(p.run(`QD.block(${JSON.stringify(inside)})`)).toBe("");
    expect(p.run<string>(`QD.show(${JSON.stringify(inside)})`)).not.toContain("$250.00");
    // a short is bought back
    expect(p.run<string>(`QD.show(${JSON.stringify(prep({ worthUsd: 100, capUsd: 250, overCap: false, side: "buy", qty: 1, worstPrice: 101 }))})`)).toContain("Buy back 1");
    // an account that does not say what a close is worth: shown as before, and nothing refused here (the door still holds it to the cap)
    expect(p.run(`QD.block(${JSON.stringify(prep())})`)).toBe("");
    expect(p.run<string>(`QD.show(${JSON.stringify(prep())})`)).toContain("≈ $31,000.00");
    // the draft: all of it, or the part typed
    expect(p.out('QD.draft({ values: { qty: "" } })')).toEqual({ type: "liveClose", venue: "ex", symbol: "BTC/USDT:USDT", qty: "" });
    expect(p.out('QD.draft({ values: { qty: "0.003964" } })')).toMatchObject({ qty: "0.003964" });
    // the part offered is in the market's own steps of a size, and none when even the smallest order it takes is over the cap
    expect(p.run("tkClosePart(0.01, 624.89, 250, false, { step: 0.001 })")).toBe(0.003);
    expect(p.run("tkClosePart(0.01, 624.89, 250, false, { step: 0.001, min: 0.005 })")).toBe(0);
    expect(p.run("tkClosePart(3, 300, 250, false, { step: 0.5 })")).toBe(2);
    // an event contract is sold, in whole contracts
    p.run(`openClose(${JSON.stringify({ ...POS, kind: "event", name: "Fed cut · Yes", symbol: "FED:YES", qty: 900 })})`);
    expect(p.run("QD.go")).toBe("Sign and sell");
    expect(p.run<string>(`QD.show(${JSON.stringify(prep({ worthUsd: 540, capUsd: 250, overCap: true, side: "sell", qty: 900, worstPrice: 0.6 }))})`)).toContain('data-close-part="408"');
  });

  it("is the one close every pane opens: Portfolio's and the market drawer's go through it, and the sheet holds the sign button off while a refusal stands", () => {
    expect(source("ui/portfolio.js")).toContain("if (p && typeof openClose === \"function\") openClose(p);");
    // the one drawer (markets.js; asset.js opens it by key) closes through the same door
    expect(source("ui/markets.js") + source("ui/asset.js")).toMatch(/typeof openClose === "function"/);
    const core = source("ui/core.js");
    expect(core).toContain("btn.disabled = !owns() || !!no;");
    expect(core).toContain("if (!prepared || busy || !stop.hidden) return;");
  });
});

describe("a ticket kept in this browser", () => {
  const DRAFT = { kind: "crypto", venue: "ex", venueName: "Exchange", symbol: "BTC/USDT", side: "buy", key: "coin:BTC", base: "BTC", name: "Bitcoin", amount: "25", unit: "usd", orderType: "limit", limitPrice: "60000" };
  const kept = () => {
    const p = page();
    p.set("A", pageOf([EX, PRED]));
    p.run("var STORE = {}; localStorage.getItem = (k) => (k in STORE ? STORE[k] : null); localStorage.setItem = (k, v) => { STORE[k] = String(v); }; localStorage.removeItem = (k) => { delete STORE[k]; }");
    p.run('var OPENED = []; tkOpen = (preset) => OPENED.push(preset); var ASKED = []; var MARKET = { ok: true, market: { symbol: "BTC/USDT", open: true } }; api = async (path) => { ASKED.push(path); return MARKET; }');
    return p;
  };
  const again = async (p: ReturnType<typeof page>) => {
    p.run("TK.draftLooked = false");
    await p.run("tkReopenDraft()");
  };

  it("opens again, at rest and on its kind, while its venue is connected and still lists its market", async () => {
    const p = kept();
    p.run(`tkDraftKeep(${JSON.stringify(DRAFT)})`);
    expect(p.out("Object.keys(JSON.parse(STORE['account.ticket'])).sort()")).toEqual([...Object.keys(DRAFT), "at"].sort());
    await again(p);
    expect(p.out("ASKED")).toEqual(["/api/account/market?venue=ex&symbol=BTC%2FUSDT"]);
    expect(p.out("OPENED")).toEqual([{ ...DRAFT, rest: true }]);
    expect(p.run("TK.kind")).toBe("crypto");
    // looked at once a visit
    await p.run("tkReopenDraft()");
    expect(p.out("OPENED.length")).toBe(1);
    // a draft of the page before this one named a ticket variant: it opens on the kind that variant was
    p.run(`OPENED = []; STORE['account.ticket'] = JSON.stringify({ ...${JSON.stringify({ ...DRAFT, kind: undefined, variant: "perps", symbol: "ETH/USDT:USDT" })}, at: Date.now() })`);
    await again(p);
    expect(p.out("OPENED[0].kind")).toBe("perps");
  });

  it("is dropped without a word when its venue is gone, its market is gone, it is a day old, or it was never a ticket", async () => {
    const p = kept();
    const dropped = async (setup: string) => {
      p.run(`tkDraftKeep(${JSON.stringify(DRAFT)}); OPENED = []; ${setup}`);
      await again(p);
      return [p.out("OPENED.length"), p.out("'account.ticket' in STORE")];
    };
    // the venue disconnected
    expect(await dropped(`A = ${JSON.stringify(pageOf([PRED]))}`)).toEqual([0, false]);
    // connected, but its key can no longer trade
    expect(await dropped(`A = ${JSON.stringify(pageOf([{ ...EX, trade: { can: false, what: "spot and perpetuals", kinds: ["spot", "perp"] } }]))}`)).toEqual([0, false]);
    p.set("A", pageOf([EX, PRED]));
    // the venue no longer lists it
    expect(await dropped('MARKET = { ok: false, refusal: { code: "E_VENUE_NO_MARKET", message: "Exchange lists no BTC/USDT" } }')).toEqual([0, false]);
    p.run('MARKET = { ok: true, market: { symbol: "BTC/USDT" } }');
    // a day old
    expect(await dropped("STORE['account.ticket'] = JSON.stringify({ ...JSON.parse(STORE['account.ticket']), at: Date.now() - 25 * 3600000 })")).toEqual([0, false]);
    // not a ticket the page keeps: an earn draft of the page before this one, no kind at all, not JSON
    expect(await dropped(`STORE['account.ticket'] = JSON.stringify({ ...${JSON.stringify({ ...DRAFT, kind: undefined })}, variant: "earn", at: Date.now() })`)).toEqual([0, false]);
    expect(await dropped(`STORE['account.ticket'] = JSON.stringify({ ...${JSON.stringify({ ...DRAFT, kind: "nothing" })}, at: Date.now() })`)).toEqual([0, false]);
    expect(await dropped("STORE['account.ticket'] = '{not json'")).toEqual([0, false]);
  });

  it("holds the pane's own start while its market is read — the pane drawn meanwhile with the kinds' reads already in starts nothing over it — and, dropped, gives the pane back to start on the busiest", async () => {
    const p = kept();
    // a new frame as renderTrade opens one: the panel at rest, the draft looked at, the pane drawn — the busiest crypto row read already
    // (shell.js reads the kinds ahead); the venue's market answers a tick later
    p.run(`tkOpen = (preset) => { TK.gen++; OPENED.push(preset); }; chRelease = () => {}; bkRelease = () => {}; tkDrawPane = () => {};
      var PANE = { querySelector: (s) => (s === "[data-tp]" ? { ttWired: true } : { innerHTML: "" }), querySelectorAll: () => [] };
      document.getElementById = (id) => (id === "pane-trade" ? PANE : { id });
      ROUTE.tab = "trade"; TK.kind = "crypto"; TK.pending = null;
      var LOOK = null;
      var FRAME = () => { TT.started = false; TT.item = null; TT.at = null; OPENED = []; TK.draftLooked = false; TK.got = { crypto: { at: Date.now(), items: [${JSON.stringify(ROW("coin", "ETH"))}] } }; };
      var NEW_FRAME = () => { FRAME(); tkDraftKeep(${JSON.stringify(DRAFT)}); tkRest(); LOOK = tkReopenDraft(); ttDraw(PANE, true); };`);
    p.run("NEW_FRAME()");
    expect(p.out("OPENED")).toEqual([{ kind: "crypto", rest: true }]);
    await p.run("LOOK");
    // only the draft opens, at rest
    expect(p.out("OPENED")).toEqual([{ kind: "crypto", rest: true }, { ...DRAFT, rest: true }]);
    // its market gone instead: the draft is dropped, and the pane starts on the busiest of its kind after all
    p.run('MARKET = { ok: false, refusal: { code: "E_VENUE_NO_MARKET", message: "Exchange lists no BTC/USDT" } }; NEW_FRAME()');
    await p.run("LOOK");
    expect(p.out("OPENED.map((x) => [x.item ? x.item.key : '', !!x.rest])")).toEqual([["", true], ["coin:ETH", true]]);
    expect(p.out("'account.ticket' in STORE")).toBe(false);
  });

  it("gives way to a ticket opened meanwhile, and is kept for later; storage that is off opens nothing and breaks nothing; the markets picked are remembered per kind", async () => {
    const p = kept();
    p.run(`tkDraftKeep(${JSON.stringify(DRAFT)}); api = async (path) => { TK.gen++; return MARKET; }`);
    await again(p);
    expect([p.out("OPENED.length"), p.out("'account.ticket' in STORE")]).toEqual([0, true]);
    // Recent: the last markets picked, per kind, newest first, one entry a market
    p.run('tkRecentAdd({ kind: "crypto", key: "coin:BTC", name: "Bitcoin", base: "BTC", venue: "ex", venueName: "Exchange", symbol: "BTC/USDT" }); tkRecentAdd({ kind: "perps", key: "perp:ETH", name: "ETH perpetual", base: "ETH", venue: "ex", venueName: "Exchange", symbol: "ETH/USDT:USDT" }); tkRecentAdd({ kind: "crypto", key: "coin:SOL", name: "Solana", base: "SOL", venue: "ex", venueName: "Exchange", symbol: "SOL/USDT" }); tkRecentAdd({ kind: "crypto", key: "coin:BTC", name: "Bitcoin", base: "BTC", venue: "ex", venueName: "Exchange", symbol: "BTC/USDT" })');
    expect(p.out('tkRecent("crypto").map((r) => r.symbol)')).toEqual(["BTC/USDT", "SOL/USDT"]);
    expect(p.out('tkRecent("perps").map((r) => r.symbol)')).toEqual(["ETH/USDT:USDT"]);
    p.run("localStorage.getItem = () => { throw new Error('storage is off'); }; localStorage.removeItem = () => { throw new Error('storage is off'); }");
    await again(p);
    expect(p.out("OPENED.length")).toBe(0);
    expect(p.out('tkRecent("crypto")')).toEqual([]);
  });
});

describe("each tile's real logo, as Markets shows it (live/icons.ts), with Elbstream's credit wherever one of its logos is shown", () => {
  const ELB = "https://api.elbstream.com/logos";
  const KALSHI_FED = "https://assets.kalshi.com/series-images-webp/KXFEDDECISION.webp";
  const PM_PIC = "https://polymarket-upload.s3.us-east-2.amazonaws.com/fed-decision.jpg";
  const BTC = ROW("coin", "BTC", { icon: `${ELB}/crypto/BTC` });
  const SOL = ROW("perp", "SOL", { icon: `${ELB}/crypto/SOL`, at: [{ venue: "hl", venueName: "Hyperliquid", symbol: "SOL-PERP", connected: true, canTrade: true, public: false }] });
  const FED = { key: "pm:0xfed", kind: "event", name: "Fed decision in October? · 25 bps cut", category: "Economics", price: 0.4, tabs: [], icon: PM_PIC, at: [{ venue: "polymarket", venueName: "Polymarket", symbol: "fed-decision-in-october:Yes", connected: false, canTrade: false, public: true }], outcomes: [{ label: "Yes", at: [{ venue: "polymarket", symbol: "fed-decision-in-october:Yes" }] }, { label: "No", at: [{ venue: "polymarket", symbol: "fed-decision-in-october:No" }] }] };

  it("a market row's tile carries its logo over its letters; one with none keeps its letters", () => {
    const p = page();
    p.set("A", pageOf([EX, PRED, HL]));
    const tile = p.out<string>(`tkItemRow(${JSON.stringify(BTC)}, "crypto").av`);
    expect(tile).toContain('<img class="av-im" src="https://api.elbstream.com/logos/crypto/BTC"');
    expect(tile).toContain('referrerpolicy="no-referrer"');
    expect(tile).toContain(">BTC<");
    const bare = p.out<string>(`tkItemRow(${JSON.stringify(ROW("coin", "ZZZ"))}, "crypto").av`);
    expect(bare).not.toContain("<img");
    // the ticket's search row and the market picked use the row's own logo too (the same avatar, the row's icon)
    expect(source("ui/trade.js")).toContain('x.base || x.name, "sm", x.icon || "")}<span class="tk-rn"><b>');
    expect(source("ui/trade.js")).toContain('x.base || x.name, "", x.icon || "")}<span class="tk-rn"');
  });

  it("a market picked before keeps the logo it had; an older one finds its row's by its key; nothing but an https address is kept or shown", () => {
    const p = page();
    p.set("A", pageOf([EX, PRED, HL]));
    p.run("var STORE = {}; localStorage.getItem = (k) => (k in STORE ? STORE[k] : null); localStorage.setItem = (k, v) => { STORE[k] = String(v); };");
    p.run(`tkRecentAdd({ kind: "crypto", key: "coin:ETH", name: "ETH", base: "ETH", venue: "ex", venueName: "Exchange", symbol: "ETH/USDT", icon: "${ELB}/crypto/ETH" })`);
    p.run(`tkRecentAdd({ kind: "crypto", key: "coin:XRP", name: "XRP", base: "XRP", venue: "ex", venueName: "Exchange", symbol: "XRP/USDT", icon: "javascript:alert(1)" })`);
    const kept = p.out<Array<{ key: string; icon?: string }>>("tkRecent('crypto')");
    expect(kept.find((r) => r.key === "coin:ETH")?.icon).toBe(`${ELB}/crypto/ETH`);
    expect(kept.find((r) => r.key === "coin:XRP")).not.toHaveProperty("icon");
    expect(p.out<string>("tkRecentRow(tkRecent('crypto').find((r) => r.key === 'coin:ETH'), 'crypto').av")).toContain(`src="${ELB}/crypto/ETH"`);
    // one kept before logos were (or with an address not kept): its row's logo once that row is read, else its letters
    const old = { kind: "crypto", key: "coin:BTC", name: "BTC", base: "BTC", venue: "ex", symbol: "BTC/USDT", at: 1 };
    expect(p.out<string>(`tkRecentRow(${JSON.stringify(old)}, "crypto").av`)).not.toContain("<img");
    p.set("TK.got", { crypto: { at: Date.now(), items: [BTC] } });
    expect(p.out<string>(`tkRecentRow(${JSON.stringify(old)}, "crypto").av`)).toContain(`src="${ELB}/crypto/BTC"`);
    expect(p.out<string>(`tkRecentRow(${JSON.stringify({ ...old, icon: "http://tracker.example/p.png" })}, "crypto").av`)).toContain(`src="${ELB}/crypto/BTC"`);
  });

  it("a holding or a position that is not a market row finds its logo in the rows read: an event by its outcome's symbol, a position by its venue's line", () => {
    const p = page();
    p.set("A", pageOf([EX, PRED, HL]));
    p.set("TK.got", { perps: { at: Date.now(), items: [SOL] }, predictions: { at: Date.now(), items: [FED] } });
    // the NO side of the question held at a paper account is the same symbol the public line lists
    expect(p.out("tkEventIcon('fed-decision-in-october:No')")).toBe(PM_PIC);
    expect(p.out("tkEventIcon('some-other-market:Yes')")).toBe("");
    expect(p.out("tkPairIcon('hl|SOL-PERP')")).toBe(`${ELB}/crypto/SOL`);
    expect(p.out("tkPairIcon('hl|ETH-PERP')")).toBe("");
    // the holding's own logo, as the account gives it (exchange.ts → live/icons.ts holdingIcon), comes first: the hold rows read h.icon
    expect(source("ui/trade.js")).toContain('e.icon || (cls === "event" ? tkEventIcon(e.asset) : "")');
    expect(source("ui/trade.js")).toContain("p.icon || tkPairIcon(`${p.venue}|${p.symbol}`)");
  });

  it("credits Elbstream wherever one of its logos stands, and only then: a venue's own picture asks for none", () => {
    const p = page();
    const credit = '<p class="logo-credit tk-credit"><a href="https://elbstream.com" target="_blank" rel="noopener noreferrer">Logos by Elbstream</a></p>';
    expect(p.out(`logoCredit(["${ELB}/crypto/BTC", "${PM_PIC}"], "tk-credit")`)).toBe(credit);
    expect(p.out(`logoCredit(["${PM_PIC}", "${KALSHI_FED}", "", null], "tk-credit")`)).toBe("");
    // a logo that did not load is not one shown
    p.run(`ICON_MISS.add("${ELB}/crypto/BTC")`);
    expect(p.out(`logoCredit(["${ELB}/crypto/BTC"], "tk-credit")`)).toBe("");
    // the picker's foot and the ticket each carry it (painted from what their tiles show)
    expect(source("ui/trade.js")).toContain('creditFor(sec, g("foot"), "tk-credit")');
    expect(source("ui/trade.js")).toContain('<div class="tk-credit-w" data-credit></div>');
    expect(source("ui/trade.css")).toContain(".tk-credit");
    expect(source("ui/shell.css")).toMatch(/\.logo-credit \{[^}]*font-size: 12pt/);
  });
});

describe("a tokenised asset in the ticket", () => {
  it("shows the issuer's words where its issuer closed it or keeps it from being swapped, instead of a button that would only be refused", () => {
    const p = page();
    p.set("A", pageOf([WALLET]));
    const ousg = { kind: "rwa", base: "OUSG", at: [{ venue: "wallet", venueName: "Wallet", symbol: "OUSG/USDC@Ethereum", connected: true, canTrade: false, issuer: "Ondo Finance", eligibility: "OUSG moves only between wallets Ondo has approved" }] };
    expect(p.run(`tkShut(${JSON.stringify(ousg)}, { open: false, types: [], issuer: "Ondo Finance", note: "OUSG on Ethereum: transfers only between wallets the issuer approved." })`)).toBe("No order for it here · Ondo Finance: OUSG on Ethereum: transfers only between wallets the issuer approved.");
    // paused by its issuer, with no words of the venue's: the issuer's own
    expect(p.run(`tkShut(${JSON.stringify(ousg)}, { open: false, types: ["market"], issuer: "Ondo Finance" })`)).toBe("Closed now · Ondo Finance: OUSG moves only between wallets Ondo has approved.");
    // open, or not a tokenised asset: nothing is held back here
    expect(p.run(`tkShut(${JSON.stringify(ousg)}, { open: true, types: ["market"], issuer: "Ondo Finance" })`)).toBe("");
    expect(p.run('tkShut({ kind: "stock", at: [] }, { open: false, types: ["limit"] })')).toBe("");
  });
});

describe("the same drafts through the real account's door, on the stand-in account", () => {
  let s: Standin;
  const p = page();
  const browser = simKey("device:ui-trade-test-browser");
  const get = async (path: string): Promise<{ status: number; body: any }> => {
    const r = await fetch(`${s.url}${path}`);
    return { status: r.status, body: await r.json() };
  };
  const post = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {
    const r = await fetch(`${s.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  /** as the page does: the account prepares the draft, the browser signs exactly what was prepared, the door takes it */
  const act = async (draft: Record<string, unknown>) => {
    const prep = await post("/api/account/prepare", { draft });
    expect(prep.status, JSON.stringify(prep.body)).toBe(200);
    const action = prep.body.action as OwnerAction;
    return post("/api/exchange", { action, nonce: action.nonce, signature: signDevice(browser, action) });
  };

  beforeAll(async () => {
    s = await startStandin({ port: 0, tickMs: 0, agentMs: 0 });
    const paired = await post("/api/account/pair", { jwk: browser.jwk, label: "this browser", code: s.code });
    expect(paired.body).toMatchObject({ ok: true, role: "owner" });
  }, 60_000);
  afterAll(async () => {
    await s?.close();
  });

  it("shows the kinds the stand-in's venues and public listings really have, each kind's rows read as the picker reads them", async () => {
    const { body } = await get("/api/account");
    p.set("A", body);
    const got: Record<string, unknown> = {};
    for (const kind of ["crypto", "stocks", "rwas", "perps", "preipo", "predictions"]) {
      const r = await get(`/api/account/explore?tab=${kind}&limit=12`);
      // a kind this server does not know yet answers with a refusal: the picker reads it as an empty list, without a toast
      got[kind] = { at: Date.now(), items: r.status === 200 ? r.body.items : [], missing: [] };
    }
    const kinds = p.out<string[]>(`tkKindsFor(connected(), ${JSON.stringify(got)}, lensNow())`);
    for (const k of ["crypto", "perps", "predictions"]) expect(kinds).toContain(k);
    // the Pre-IPO face lists the company's row — its implied valuation, the stand-in venue's Trade and the public venue's Connect to trade
    const pre = (got.preipo as { items: Array<Record<string, any>> }).items.filter((x) => p.run(`tkPre(${JSON.stringify(x)})`));
    if (pre.length) {
      expect(kinds).toContain("preipo");
      const rows = p.out<Array<{ state: string; implied?: { usd: number } }>>(`tkWhereRows(${JSON.stringify(pre[0])}, null, "preipo")`);
      expect(rows.some((r) => r.state === "able")).toBe(true);
      expect(p.run<string>(`tkKindBlock("preipo", null, null, ${JSON.stringify(pre[0])}, {})`)).toContain("Implied valuation ≈");
      // a pre-IPO row never shows under Perps
      expect((got.perps as { items: Array<{ key: string }> }).items.some((x) => x.key === pre[0]!.key)).toBe(false);
    }
  });

  it("places the ticket's order — an event contract's limit typed in cents rests at the venue at that price", async () => {
    const draft = p.out<Record<string, unknown>>('tkOrderDraft({ amount: "10", unit: "usd", orderType: "limit", limitPrice: "30" }, { venue: "predict", symbol: "SI-FEDCUT-DEC:NO", side: "buy", event: true })');
    const r = await act(draft);
    expect(r.status).toBe(200);
    expect(r.body.order).toMatchObject({ venue: "predict", symbol: "SI-FEDCUT-DEC:NO", type: "limit", limitPrice: 0.3, status: "open" });
  });

  it("pays with a coin held in two signatures: the sale, then the buy sized by what the sale brought", async () => {
    const markets = (await get("/api/account/markets?venue=ex&q=")).body.markets;
    const plan = p.out<any>(`tkSwapPlan(${JSON.stringify({ venue: "ex", from: "BTC", to: "SOL", amount: "0.001", markets })})`);
    expect(plan.mode).toBe("two");
    const sold = await act(plan.legs[0]);
    expect(sold.body.order).toMatchObject({ side: "sell", status: "filled" });
    const usd = p.out<number>(`tkProceeds(${JSON.stringify(sold.body.order)})`);
    expect(usd).toBeGreaterThan(50);
    const bought = await act({ ...plan.legs[1], usd: String(usd) });
    expect(bought.body.order).toMatchObject({ symbol: "SOL/USDT", side: "buy", status: "filled" });
    expect(bought.body.order.qty * bought.body.order.avgPrice).toBeLessThanOrEqual(usd + 0.01);
  });

  it("prepares a position's close at the door and reads it as the close sheet does: its worth against this server's cap, or as before on an account that does not say", async () => {
    const { body } = await get("/api/account/positions");
    const pos = body.positions.find((x: { venue: string; kind: string; qty: number }) => x.venue === "ex" && x.kind === "perp" && x.qty > 0);
    expect(pos).toBeTruthy();
    const prep = await post("/api/account/prepare", { draft: { type: "liveClose", venue: pos.venue, symbol: pos.symbol, qty: "" } });
    const c = p.out<{ worthUsd: number; capUsd: number; overCap: boolean } | null>(`tkCloseQuote(${JSON.stringify(prep.body)})`);
    if (prep.status === 200 && c) {
      expect(c.worthUsd).toBeGreaterThan(0);
      expect(c.overCap).toBe(c.worthUsd > c.capUsd);
      expect(p.out<string>(`tkCloseBlock(${JSON.stringify(prep.body)})`) !== "").toBe(c.overCap);
    } else expect(p.out(`tkCloseBlock(${JSON.stringify(prep.body)})`)).toBe("");
  });

  it("hands words to the agent with a limit for them: the intent stands, the limit replaces the agent's, and withdrawing ends the intent", async () => {
    const page0 = (await get("/api/account")).body;
    const d = p.out<any>(`htaDrafts({ agent: ${JSON.stringify(s.agent.address)}, venue: "ex", symbol: "ETH/USDT", side: "sell", usd: "100", text: "Sell about $100 of ETH under $2,300", days: "3", withLimit: true, perOrder: "50", budget: "200" }, ${Date.parse(page0.now)})`);
    expect((await act(d.intent)).status).toBe(200);
    expect((await act(d.limit)).status).toBe(200);
    const after = (await get("/api/account")).body;
    const it = after.intents.find((x: { text: string }) => x.text === "Sell about $100 of ETH under $2,300");
    expect(it).toMatchObject({ agentName: "Claude Code", venue: "ex", side: "sell", usd: "100" });
    expect(after.spend.filter((x: { scope: string; agent: string }) => x.scope === "trade" && x.agent === s.agent.address)).toEqual([expect.objectContaining({ allow: ["ex"], perPaymentUsd: 50, budgetUsd: 200 })]);
    expect((await act({ type: "setIntent", id: it.id, agent: it.agent, venue: "", symbol: "", side: "", usd: "", text: "", validUntil: 0 })).status).toBe(200);
    expect((await get("/api/account")).body.intents.some((x: { id: string }) => x.id === it.id)).toBe(false);
  });

  it("withdrawing words a limit was given with ends the limit too, so the agent can place nothing after; words being changed keep the limit's end", async () => {
    const AG = JSON.stringify(s.agent.address);
    const now0 = Date.parse((await get("/api/account")).body.now);
    const d = p.out<any>(`htaDrafts({ agent: ${AG}, venue: "ex", symbol: "SOL/USDT", side: "buy", usd: "100", text: "Buy a little SOL", days: "7", withLimit: true, perOrder: "60", budget: "120" }, ${now0})`);
    expect((await act(d.intent)).status).toBe(200);
    expect((await act(d.limit)).status).toBe(200);
    const read = async () => {
      const a = (await get("/api/account")).body;
      p.set("A", a);
      return a;
    };
    let a = await read();
    const it0 = a.intents.find((x: { text: string }) => x.text === "Buy a little SOL");
    expect(p.out(`htaLimitOf(${JSON.stringify(it0)})`)).toMatchObject({ scope: "trade", allow: ["ex"], perPaymentUsd: 60, budgetUsd: 120 });
    // the words changed: their end stays the limit's, so the two still end together
    const changed = p.out<any>(`htaDrafts({ id: ${JSON.stringify(it0.id)}, agent: ${AG}, venue: "ex", text: "Buy a little SOL, slowly", days: "1", until: ${Date.parse(it0.validUntil)} }, ${now0})`);
    expect((await act(changed.intent)).status).toBe(200);
    a = await read();
    const it1 = a.intents.find((x: { id: string }) => x.id === it0.id);
    expect([it1.text, it1.validUntil]).toEqual(["Buy a little SOL, slowly", it0.validUntil]);
    // Withdraw signs the words away, then the limit given with them
    const drafts = p.out<Array<Record<string, unknown>>>(`htaWithdrawDrafts(${JSON.stringify(it1)}, ${now0})`);
    expect(drafts.map((x) => x.type)).toEqual(["setIntent", "approveSpend"]);
    expect(drafts[1]).toMatchObject({ agent: s.agent.address, scope: "trade", allow: "ex", perPayment: "0", budget: "0" });
    for (const x of drafts) expect((await act(x)).status).toBe(200);
    a = await read();
    expect(a.intents.some((x: { id: string }) => x.id === it0.id)).toBe(false);
    expect(a.spend.filter((x: { scope: string; agent: string }) => x.scope === "trade" && x.agent === s.agent.address)).toEqual([]);
    // even in Beast the agent now places nothing: its authority ended with the words
    expect((await act({ type: "setPolicy", change: "mode", value: "open" })).status).toBe(200);
    const order = await s.svc.exchange(await signAgent(s.agent, { type: "agentLiveOrder", venue: "ex", symbol: "SOL/USDT", side: "buy", orderType: "market", qty: "", usd: "50", limitPrice: "", nonce: Date.now() } as AgentAction));
    expect((order as { code?: string }).code).toBe("E_MANDATE_NONE");
    // words that came with no limit withdraw alone
    expect(p.out(`htaWithdrawDrafts({ id: "intent-9", agent: "*", validUntil: "2026-10-09T00:00:00.000Z" }, ${now0}).length`)).toBe(1);
  });
});
