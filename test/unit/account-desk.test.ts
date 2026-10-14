import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { brainReach, claudeBrain } from "../../src/portfolio/account/brain-claude.ts";
import { BRAIN_MODELS, deskPath, readRoom, ROLE_SPECS, ROLES, scriptedBrain, type Brain, type RoleId } from "../../src/portfolio/account/desk.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signAgent, signOwner, simKey, type AgentAction, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { register, type LiveDeps } from "../../src/portfolio/live/index.ts";
import { ceilTo, floorTo, type LiveTrader, type Market, type OrderRequest, type OrderState, type OrderType } from "../../src/portfolio/live/trade.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** THE DESK (account/desk.ts): the account's own agents. Every seat is an agent key the owner let in; a seat that trades does so inside
 * a limit the owner signed, through the same door as any agent — so a charter's "never trades" is enforced by the door, not by words. A
 * cycle finds leads, clears them, places them (a card in Guard, at once in Beast), the plan exits them; the room says every step with
 * the lead's id; the floor halts at the day's loss line; the report is written at its hour; a restart continues it; an outside agent
 * holds a seat with its own key; without a brain nothing is made up. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse("2026-10-12T15:00:00Z");
const REAL = 5_000_000;
const owner = simKey("owner");
const cc = simKey("agent:claude-code");
const codex = simKey("agent:codex");

const SPOT = (symbol: string, price: number): Market => ({ symbol, name: symbol, kind: "spot", base: symbol.split("/")[0]!, quote: "USDT", price, bid: price * 0.9995, ask: price * 1.0005, minQty: 0.0001, qtyStep: 0.0001, priceStep: 0.1, open: true, types: ["market", "limit"], volumeUsd24h: 2_000_000_000, changePct24h: 2.5 });

/** a stand-in exchange: market orders fill at once at the market's price; `markets` is mutable, so a test moves prices between cycles */
function traderOf(markets: Record<string, Market>): LiveTrader & { states: Map<string, OrderState>; placed: OrderRequest[] } {
  const states = new Map<string, OrderState>();
  const placed: OrderRequest[] = [];
  let n = 0;
  return {
    states,
    placed,
    can: true,
    what: "spot",
    async markets(q) {
      const Q = q.trim().toUpperCase();
      return Object.values(markets).filter((m) => !Q || m.symbol.toUpperCase().includes(Q)).map((m) => ({ ...m }));
    },
    async market(symbol) {
      return markets[symbol] ? { ...markets[symbol]! } : no("E_VENUE_REJECTED", { venue: "ex", message: `no market ${symbol}` });
    },
    async place(o) {
      placed.push(o);
      const ref = `o-${++n}`;
      const m = markets[o.symbol]!;
      // a market order fills at the book; so does a limit with extended hours (a marketable limit in the session that is on)
      const s: OrderState = o.type === "market" || o.extendedHours ? { ref, status: "filled", filledQty: o.qty, avgPrice: o.side === "buy" ? m.ask! : m.bid!, feeUsd: 0.01, native: {} } : { ref, status: "open", filledQty: 0, native: {} };
      states.set(ref, s);
      return s;
    },
    async cancel(ref) {
      return { ...states.get(ref)!, status: "canceled" };
    },
    async status(ref) {
      return states.get(ref)!;
    },
    async positions() {
      return [];
    },
  };
}

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

const code = (o: Outcome | Refusal): string => (isRefusal(o) ? o.code : o.kind);

interface Script {
  search?: (input: string) => unknown;
  risk?: (input: string) => unknown;
  exit?: (input: string) => unknown;
  head?: (input: string) => unknown;
}
/** a brain that finds BTC, clears it at $40 with a 2% take-profit and a 1% stop, holds, and writes two sentences */
const brainOf = (s: Script = {}): Brain =>
  scriptedBrain(({ role, input }) => {
    if (role === "search") return s.search ? s.search(input) : { leads: [{ symbol: "BTC/USDT", side: "buy", thesis: "BTC is up 2.5% on $2B of volume", confidence: 0.7 }], note: "" };
    if (role === "risk") return s.risk ? s.risk(input) : { verdict: "clear", why: "the spread is tight and the day has room", sizeUsd: 40, tpPct: 2, slPct: 1, maxHours: 12 };
    if (role === "exit") return s.exit ? s.exit(input) : { decisions: [] };
    if (role === "head") return s.head ? s.head(input) : { worked: "L-0001 was cleared and placed.", change: "Nothing yet." };
    return null;
  });
const noBrain: Brain = { id: "none", label: "no brain", models: [], ready: () => ({ ok: false, model: "none", why: "no key" }), decide: async () => ({ out: null, why: "no key", usage: { inputTokens: 0, outputTokens: 0 } }) };

let registered = false;
async function boot(o: { home?: string; brain?: Brain | Brain[]; prices?: Record<string, Market>; at?: number; cap?: number } = {}) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), "account-desk-"));
  if (!o.home) homes.push(home);
  const markets = o.prices ?? { "BTC/USDT": SPOT("BTC/USDT", 60_000), "ETH/USDT": SPOT("ETH/USDT", 3_000) };
  const trader = traderOf(markets);
  if (!registered) {
    registered = true;
    register({ kind: "standin-desk", label: "a desk stand-in", needs: "key-file", example: "", venues: [], async open(req) {
      return { source: { name: req.label || "Ex", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDT", amount: 5000, usd: 5000 }], trader: TRADER.t, readOnlyBecause: "a stand-in moves no money" } as never, first: [{ asset: "USDT", amount: 5000, usd: 5000 }], summary: "connected" };
    } });
  }
  TRADER.t = trader;
  let n = 0;
  // the real clock and the account's clock move together: `advance` pushes both, so kept reads (markets, prices) expire as they would
  let skew = o.at ?? 0;
  const liveDeps: Partial<LiveDeps> = { clock: () => REAL + skew, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(START + skew).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: [], liveWrites: { capUsd: o.cap ?? 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] }, desk: { brain: o.brain ?? brainOf(), tickMs: 0 } });
  await svc.restoring;
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: START + skew + ++n } as OwnerAction));
  const as = async (key: ReturnType<typeof simKey>, a: NoNonce<AgentAction>) => svc.exchange(await signAgent(key, { ...a, nonce: START + skew + ++n } as AgentAction));
  const desk = svc.desk!;
  if (!o.home) {
    const r = await own({ type: "connectVenue", venue: "ex", connector: "live:standin-desk", label: "Ex", credentialRef: "" });
    if (isRefusal(r)) throw new Error(r.message);
  }
  const advance = (ms: number) => void (skew += ms);
  /** the owner lets a house seat in, as the page does at hiring */
  const letIn = async (role: RoleId) => {
    const k = desk.seatKeyOf(role);
    if (isRefusal(k)) throw new Error(k.message);
    const r = await own({ type: "approveAgent", agentAddress: k.address as `0x${string}`, agentName: `Desk ${ROLE_SPECS[role].name.replace(" of desk", "")}`, validUntil: START + skew + 30 * DAY });
    if (isRefusal(r)) throw new Error(`${role}: ${r.message}`);
    return k;
  };
  const limit = async (role: RoleId, per = "100", budget = "500") => {
    const k = desk.seatKeyOf(role);
    if (isRefusal(k)) throw new Error(k.message);
    const r = await own({ type: "approveSpend", agent: k.address as `0x${string}`, scope: "trade", allow: "ex", perPayment: per, budget, windowHours: 0, validUntil: START + skew + 7 * DAY });
    if (isRefusal(r)) throw new Error(`${role} limit: ${r.message}`);
  };
  const hire = async (objective: Record<string, unknown> = {}, roles: RoleId[] = ["head", "search", "risk", "sniper", "exit"], brain: Record<string, unknown> = { model: "claude-opus-5-5", effort: "medium" }) => {
    for (const r of roles) await letIn(r);
    for (const r of roles) if (ROLE_SPECS[r].trades) await limit(r);
    const r = await own({ type: "setDesk", desk: "desk", change: "hire", value: JSON.stringify({ name: "Test desk", objective: { text: "Small, careful entries on majors", venue: "ex", universe: "all", targetPct: 3, maxRiskPct: 1, maxDailyLossPct: 5, hours: 22, everyMin: 15, reportAt: "21:00", ...objective }, brain, roles: roles.map((role) => ({ role, kind: "house" })) }) });
    if (isRefusal(r)) console.log(`hire refused: ${r.code} · ${r.message}`);
    return r;
  };
  return { svc, desk, home, own, as, advance, letIn, limit, hire, markets, trader };
}
const TRADER: { t: LiveTrader } = { t: traderOf({}) };

describe("the desk is hired", () => {
  it("what hiring offers: eight roles with charters, a key for each house seat, the brain's standing", async () => {
    const { desk } = await boot();
    const c = desk.catalog();
    expect(c.roles.map((r) => r.id)).toEqual([...ROLES]);
    expect(c.roles.filter((r) => !r.house).map((r) => r.id)).toEqual(["flow", "sentiment"]);
    expect(Object.keys(c.seats).sort()).toEqual(["exit", "head", "risk", "search", "sniper", "watch"]);
    expect(c.brain.ok).toBe(true);
    expect(c.hired).toBe(false);
    for (const r of c.roles) expect(r.charter.never.length).toBeGreaterThan(10);
  });

  it("hired: seats let in by signature, the desk file the user's alone, a session live from the venue's equity, the room's first lines", async () => {
    const { desk, hire, home, svc } = await boot();
    const r = await hire();
    expect(code(r)).toBe("account");
    expect((statSync(deskPath(home)).mode & 0o777).toString(8)).toBe("600");
    const v = (await desk.view())!;
    expect(v.session?.state).toBe("live");
    expect(v.equity.startUsd).toBe(5000);
    expect(v.seats.map((s) => [s.role, s.kind, s.status])).toEqual([["head", "house", "ok"], ["search", "house", "ok"], ["risk", "house", "ok"], ["sniper", "house", "ok"], ["exit", "house", "ok"]]);
    expect(v.seats.find((s) => s.role === "sniper")?.limit).toMatchObject({ perOrderUsd: 100, budgetUsd: 500, venues: ["ex"] });
    expect(v.seats.find((s) => s.role === "search")?.limit).toBeUndefined();
    const room = readRoom(home);
    expect(room[0]?.from).toBe("you");
    expect(room[0]?.text).toContain("You hired Test desk");
    expect(room[1]).toMatchObject({ from: "head", kind: "report" });
    expect(room[1]?.text).toMatch(/^MORNING STATUS/);
    // the ledger has the signed hire, in the owner's name
    const rows = readFileSync(svc.ledgerPath(), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x) as { tool?: string; outcome?: string; reason?: string });
    expect(rows.find((x) => x.tool === "setDesk" && x.outcome === "ok")?.reason).toContain("desk hired: 5 seats at Ex");
  });

  it("refuses a desk without a Head, at a venue not connected, with a role that is not one", async () => {
    const { own, letIn } = await boot();
    await letIn("search");
    const base = { type: "setDesk" as const, desk: "desk", change: "hire" };
    const value = (o: Record<string, unknown>) => JSON.stringify({ objective: { text: "x", venue: "ex" }, roles: [{ role: "search", kind: "house" }], ...o });
    expect(code(await own({ ...base, value: value({}) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await own({ ...base, value: value({ objective: { text: "x", venue: "nowhere" }, roles: [{ role: "head", kind: "house" }] }) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await own({ ...base, value: value({ roles: [{ role: "head", kind: "house" }, { role: "janitor", kind: "house" }] }) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await own({ ...base, value: value({ roles: [{ role: "head", kind: "house" }, { role: "flow", kind: "house" }] }) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await own({ ...base, value: "not json" }))).toBe("E_ACCOUNT_BAD_ACTION");
  });
});

describe("a cycle", () => {
  it("Guard: a lead found, cleared, placed as a card the owner answers; approved, it fills and the lead is executed", async () => {
    const { desk, hire, svc, own, home, advance } = await boot();
    await hire();
    await desk.cycle("test");
    const room = readRoom(home).map((m) => `${m.from}:${m.kind}:${m.text}`);
    expect(room.find((x) => x.startsWith("search:lead:"))).toContain("LEAD L-0001 | BTC/USDT | long |");
    expect(room.find((x) => x.startsWith("risk:clearance:"))).toContain("Verdict: CLEAR → SNIPER");
    expect(room.find((x) => x.startsWith("sniper:card:"))).toMatch(/L-0001: buy \$40\.00 of BTC\/USDT waits for you on card-\d+ \(Guard\)/);
    expect(room.find((x) => x.startsWith("head:cycle:"))).toContain("1 lead scanned, 1 cleared, 1 placed");
    let v = (await desk.view())!;
    expect(v.open.map((l) => [l.id, l.state, l.sizeUsd, l.tpPct, l.slPct])).toEqual([["L-0001", "confirmed", 40, 2, 1]]);
    expect(v.cards).toHaveLength(1);
    expect(v.cards[0]?.lead).toBe("L-0001");
    expect(v.funnel).toMatchObject({ scanned: 1, cleared: 1, confirmed: 1, executed: 0 });
    // the owner's yes: the card's hash signed, the order placed in the Sniper's name
    const page = (await svc.accountView())!;
    const card = page.cards[0]!;
    const sniper = desk.seatKeyOf("sniper");
    if (isRefusal(sniper)) throw new Error(sniper.message);
    expect(card.agent).toBe(sniper.address);
    const yes = await own({ type: "approveCard", card: card.id, action: card.hash, decision: "approve" });
    expect(code(yes)).toBe("order");
    advance(60_000);
    await desk.tick();
    v = (await desk.view())!;
    expect(v.open.map((l) => [l.id, l.state, l.entry?.qty !== undefined, l.order])).toEqual([["L-0001", "executed", true, "ord-0001"]]);
    expect(readRoom(home).some((m) => m.from === "you" && m.kind === "order" && m.text.includes("You approved"))).toBe(true);
    expect(v.funnel.executed).toBe(1);
    // the statement line says who: the Sniper, approved by you
    expect(svc.statement().find((l) => l.id === "ord-0001")?.by).toBe("Desk Sniper, approved by you");
  });

  it("charters become limits: a seat that must not trade holds no trading limit, so the door refuses it an order whatever it decides", async () => {
    const { desk, hire, as } = await boot();
    await hire();
    const search = desk.seatKeyOf("search");
    const head = desk.seatKeyOf("head");
    if (isRefusal(search) || isRefusal(head)) throw new Error("no key");
    const order = { type: "agentLiveOrder" as const, venue: "ex", symbol: "BTC/USDT", side: "buy", orderType: "market", qty: "", usd: "20", limitPrice: "" };
    expect(code(await as(search, order))).toBe("E_MANDATE_NONE");
    expect(code(await as(head, order))).toBe("E_MANDATE_NONE");
    expect(code(await as(head, { type: "agentLiveClose", venue: "ex", symbol: "BTC/USDT", qty: "" }))).toBe("E_MANDATE_NONE");
  });

  it("Beast: placed at once inside the limit; the plan takes the profit when the mark reaches it, and the tape and the equity say so", async () => {
    const { desk, hire, own, markets, advance, home } = await boot();
    await hire();
    await own({ type: "setPolicy", change: "mode", value: "open" });
    await desk.cycle("test");
    let v = (await desk.view())!;
    expect(v.open.map((l) => [l.id, l.state, l.order])).toEqual([["L-0001", "executed", "ord-0001"]]);
    expect(readRoom(home).find((m) => m.from === "sniper" && m.kind === "order")?.text).toMatch(/L-0001: filled .* at .* \(Beast, inside the limit\)/);
    const entry = v.open[0]!.entry!;
    expect(entry.qty).toBeGreaterThan(0);
    // the market moves 3%: past the 2% take-profit
    markets["BTC/USDT"] = SPOT("BTC/USDT", 61_800);
    advance(2 * 60_000);
    await desk.cycle("test");
    v = (await desk.view())!;
    // the cycle goes on after the exits: the next lead is L-0002, the ids never repeat
    expect(v.open.map((l) => l.id)).toEqual(["L-0002"]);
    const closed = v.recent.find((l) => l.id === "L-0001")!;
    expect(closed.state).toBe("closed");
    expect(closed.exitWhy).toMatch(/^TP HIT at 61800/);
    expect(closed.pnlUsd!).toBeGreaterThan(0.5);
    expect(closed.roiPct!).toBeGreaterThan(1);
    expect(v.tape).toMatchObject({ wins: 1, losses: 0, winRatePct: 100 });
    expect(v.big[0]).toMatchObject({ id: "L-0001", symbol: "BTC/USDT" });
    expect(v.equity.nowUsd).toBeCloseTo(5000 + closed.pnlUsd!, 2);
    expect(v.equity.changeUsd).toBeCloseTo(closed.pnlUsd!, 2);
    expect(v.target.progressPct).toBeGreaterThan(0);
    expect(readRoom(home).find((m) => m.from === "exit" && m.kind === "exit")?.text).toContain("L-0001 closed: TP HIT");
    expect(closed.exit?.at).toBe("2026-10-12T15:02:00.000Z");
  });

  it("Risk's hard checks reject before the brain is asked: a closed market, a wide spread, a short on spot", async () => {
    const wide = SPOT("ETH/USDT", 3_000);
    wide.bid = 2_950;
    wide.ask = 3_050;
    const shut = SPOT("SOL/USDT", 150);
    shut.open = false;
    let asked = 0;
    const brain = brainOf({ search: () => ({ leads: [{ symbol: "ETH/USDT", side: "buy", thesis: "wide", confidence: 0.5 }, { symbol: "SOL/USDT", side: "buy", thesis: "shut", confidence: 0.5 }, { symbol: "BTC/USDT", side: "sell", thesis: "short", confidence: 0.5 }], note: "" }), risk: () => (asked++, { verdict: "clear", why: "x", sizeUsd: 40, tpPct: 2, slPct: 1, maxHours: 12 }) });
    const { desk, hire, home } = await boot({ brain, prices: { "BTC/USDT": SPOT("BTC/USDT", 60_000), "ETH/USDT": wide, "SOL/USDT": shut } });
    await hire();
    await desk.cycle("test");
    const v = (await desk.view())!;
    expect(asked).toBe(0);
    // a market that takes no orders is not in the table Search reads, so a lead named on it is dropped before Risk sees it
    expect(v.recent.map((l) => [l.symbol, l.state])).toEqual([["BTC/USDT", "rejected"], ["ETH/USDT", "rejected"]]);
    const room = readRoom(home);
    expect(room.find((m) => m.from === "search" && m.kind === "note")?.text).toBe("Named SOL/USDT, which the table does not list: dropped.");
    const why = room.filter((m) => m.kind === "clearance").map((m) => m.text);
    expect(why.find((x) => x.includes("L-0001"))).toContain("spread");
    expect(why.find((x) => x.includes("L-0002"))).toContain("short only on a perpetual");
  });

  it("a size is the least of the objective's risk per lead, the Sniper's limit per order and what is left of its budget", async () => {
    let seen = "";
    const brain = brainOf({ risk: (input) => ((seen = input), { verdict: "clear", why: "x", sizeUsd: 9999, tpPct: 2, slPct: 1, maxHours: 12 }) });
    const { desk, hire, own } = await boot({ brain });
    await hire({ maxRiskPct: 4 });
    await own({ type: "setPolicy", change: "mode", value: "open" });
    await desk.cycle("test");
    const v = (await desk.view())!;
    // 4% of $5,000 is $200; the Sniper's limit is $100 an order: the brain's $9,999 is held to $100
    expect(seen).toContain("size up to $100.00");
    expect(v.open[0]?.sizeUsd).toBe(100);
  });
});

describe("the floor, the clock, the words", () => {
  it("halts at the day's loss line: the stop closes the lead, the Head halts the floor until the next New York day, and no lead is scanned meanwhile", async () => {
    const brain = brainOf({ risk: () => ({ verdict: "clear", why: "x", sizeUsd: 250, tpPct: 2, slPct: 1, maxHours: 12 }) });
    const { desk, hire, own, markets, advance, home, limit } = await boot({ brain, cap: 1000 });
    await hire({ maxRiskPct: 5, maxDailyLossPct: 0.5, hours: 72 });
    // a lead of $250 needs the server's cap, the Sniper's limit and the Exit's limit to allow it
    await limit("sniper", "300", "1000");
    await limit("exit", "300", "1000");
    await own({ type: "setPolicy", change: "mode", value: "open" });
    await desk.cycle("test");
    expect((await desk.view())!.open).toHaveLength(1);
    markets["BTC/USDT"] = SPOT("BTC/USDT", 52_800);
    advance(2 * 60_000);
    await desk.cycle("test");
    let v = (await desk.view())!;
    expect(v.session?.state).toBe("halted");
    expect(v.session?.halted?.why).toMatch(/the day's loss reached -\$\d+\.\d\d \(the line is -\$25\.00\)/);
    expect(v.open).toEqual([]);
    expect(v.tape.losses).toBe(1);
    expect(readRoom(home).find((m) => m.kind === "halt")?.text).toMatch(/^HALT: the day's loss reached/);
    advance(60_000);
    await desk.cycle("test");
    v = (await desk.view())!;
    expect(v.funnel.scanned).toBe(1);
    expect(readRoom(home).at(-1)?.text).toMatch(/the floor is halted until/);
    // the next New York day: open again
    advance(DAY);
    await desk.tick();
    expect((await desk.view())!.session?.state).toBe("live");
    expect(readRoom(home).some((m) => m.text.includes("the floor is open again"))).toBe(true);
  });

  it("the evening report at its hour, once a day, from the day's numbers; the weekly review on Sunday; the session's end", async () => {
    const { desk, hire, advance, home, own } = await boot();
    await hire({ hours: 24 * 8 });
    await own({ type: "setPolicy", change: "mode", value: "open" });
    await desk.cycle("test");
    // 11:00 New York at the start: 21:05 is ten hours and five minutes on
    advance(10 * HOUR + 5 * 60_000);
    await desk.tick();
    let v = (await desk.view())!;
    expect(v.reports.map((r) => r.kind)).toEqual(["start", "evening"]);
    expect(v.reports[1]?.text).toMatch(/^EVENING REPORT — Scanned: 1 · Cleared: 1 · Executed: 1 · Closed today: 0 · Open now: 1/);
    expect(v.reports[1]?.text).toContain("One thing that worked: L-0001 was cleared and placed.");
    advance(60_000);
    await desk.tick();
    expect((await desk.view())!.reports.filter((r) => r.kind === "evening")).toHaveLength(1);
    // Sunday 18 October 2026, 21:10 New York
    advance(Date.parse("2026-10-19T01:10:00Z") - (START + 10 * HOUR + 6 * 60_000));
    await desk.tick();
    v = (await desk.view())!;
    expect(v.reports.map((r) => r.kind)).toContain("weekly");
    expect(v.reports.find((r) => r.kind === "weekly")?.text).toMatch(/^WEEKLY REVIEW — /);
    expect(v.session?.state).toBe("live");
    // the session ran its hours: ended, with its report
    advance(2 * DAY);
    await desk.tick();
    v = (await desk.view())!;
    expect(v.session?.state).toBe("ended");
    expect(v.reports.at(-1)?.kind).toBe("end");
    expect(readRoom(home).at(-1)?.text).toMatch(/^SESSION REPORT/);
  });

  it("pause, resume, end: a paused desk runs no cycle; after the end a resume starts a new session from the venue's equity now", async () => {
    const { desk, hire, own } = await boot();
    await hire();
    const set = (change: string) => own({ type: "setDesk", desk: "desk", change, value: "" });
    expect(code(await set("pause"))).toBe("account");
    await desk.cycle("test");
    expect((await desk.view())!.funnel.scanned).toBe(0);
    expect(code(await set("pause"))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await set("resume"))).toBe("account");
    await desk.cycle("test");
    expect((await desk.view())!.funnel.scanned).toBe(1);
    expect(code(await set("end"))).toBe("account");
    expect((await desk.view())!.session?.state).toBe("ended");
    expect(code(await set("resume"))).toBe("account");
    const v = (await desk.view())!;
    expect(v.session?.state).toBe("live");
    expect(v.session?.cycles).toBe(0);
  });

  it("the objective and a charter change by signature; the venue cannot move with a lead open", async () => {
    const { desk, hire, own } = await boot();
    await hire();
    await own({ type: "setPolicy", change: "mode", value: "open" });
    await desk.cycle("test");
    expect(code(await own({ type: "setDesk", desk: "desk", change: "objective", value: JSON.stringify({ text: "Majors only, smaller", maxRiskPct: 0.5, venue: "elsewhere" }) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await own({ type: "setDesk", desk: "desk", change: "objective", value: JSON.stringify({ text: "Majors only, smaller", maxRiskPct: 0.5 }) }))).toBe("account");
    expect(code(await own({ type: "setDesk", desk: "desk", change: "charter", value: JSON.stringify({ role: "risk", never: "Clear anything on a Friday." }) }))).toBe("account");
    const v = (await desk.view())!;
    expect(v.objective).toMatchObject({ text: "Majors only, smaller", maxRiskPct: 0.5, venue: "ex" });
    expect(v.seats.find((s) => s.role === "risk")?.charter.never).toBe("Clear anything on a Friday.");
    expect(v.seats.find((s) => s.role === "risk")?.charter.owns).toBe(ROLE_SPECS.risk.charter.owns);
  });

  it("outside the regular session, where the venue trades the session that is on, the Sniper's entry and the Exit's close go as day limits with extended hours", async () => {
    const night = (price: number): Market => ({ ...SPOT("AAPL", price), kind: "stock", types: ["limit", "stop", "stop_limit"] as OrderType[], tifs: ["day", "gtc"], session: { open: false, opensAt: "2026-10-13T13:30:00.000Z", phase: "overnight", phaseEndsAt: "2026-10-13T08:00:00.000Z", extendedHours: true } });
    const brain = brainOf({ search: () => ({ leads: [{ symbol: "AAPL", side: "buy", thesis: "overnight momentum", confidence: 0.7 }], note: "" }) });
    const { desk, hire, own, markets, advance, home, trader } = await boot({ brain, prices: { AAPL: night(200) } });
    await hire();
    await own({ type: "setPolicy", change: "mode", value: "open" });
    await desk.cycle("test");
    let v = (await desk.view())!;
    expect(v.open.map((l) => [l.id, l.state])).toEqual([["L-0001", "executed"]]);
    const entryLimit = ceilTo(markets.AAPL!.ask! * 1.005, 0.1);
    expect(trader.placed[0]).toMatchObject({ symbol: "AAPL", side: "buy", type: "limit", tif: "day", extendedHours: true, limitPrice: entryLimit });
    expect(readRoom(home).some((m) => m.from === "sniper" && m.text.includes(`the regular session is closed (overnight session): the entry goes as a day limit at ${entryLimit} with extended hours`))).toBe(true);
    expect(readRoom(home).find((m) => m.from === "risk" && m.kind === "clearance")?.text).toContain("market open (overnight session, extended hours)");
    // the mark reaches the take-profit: the close goes the same way, a sell a little under the bid
    markets.AAPL = night(206);
    advance(2 * 60_000);
    await desk.cycle("test");
    const exitLimit = floorTo(markets.AAPL.bid! * 0.995, 0.1);
    expect(trader.placed[1]).toMatchObject({ symbol: "AAPL", side: "sell", type: "limit", tif: "day", extendedHours: true, limitPrice: exitLimit });
    expect(readRoom(home).some((m) => m.text.includes(`the close goes as a day limit at ${exitLimit} with extended hours`))).toBe(true);
    // in the regular session the entry is a market order, as before
    markets.AAPL = { ...night(200), types: ["market", "limit"], session: { open: true, phase: "regular", extendedHours: false } };
    advance(60 * 60_000);
    await desk.cycle("test");
    expect(trader.placed.at(-1)).toMatchObject({ symbol: "AAPL", side: "buy", type: "market" });
    expect(trader.placed.at(-1)).not.toHaveProperty("extendedHours");
    v = (await desk.view())!;
    expect(v.open.map((l) => l.state)).toEqual(["executed"]);
  });

  it("without a brain nothing is made up: the room says so, the plan's exits still run, no lead appears", async () => {
    const { desk, hire, home } = await boot({ brain: noBrain });
    await hire();
    await desk.cycle("test");
    const v = (await desk.view())!;
    expect(v.brain.ok).toBe(false);
    expect(v.funnel.scanned).toBe(0);
    expect(readRoom(home).at(-1)?.text).toMatch(/no brain to think with \(no key\)/);
  });

  it("the brain is a choice: brains told apart by id, the hired one answers, the owner's price or the listed one is counted, none is said so, a change is a signature", async () => {
    const usage = { inputTokens: 100_000, outputTokens: 10_000 };
    const claude = scriptedBrain(() => ({ leads: [], note: "claude here" }), "claude-opus-5-5", { id: "claude", label: "Claude · Anthropic API", models: BRAIN_MODELS, usage });
    const open = scriptedBrain(() => ({ leads: [], note: "deepseek here" }), "", { id: "openai", label: "OpenAI-format endpoint", usage });
    const { desk, hire, own, home } = await boot({ brain: [claude, open], prices: { "BTC/USDT": SPOT("BTC/USDT", 60_000) } });
    const c = desk.catalog();
    expect(c.brains.map((b) => [b.id, b.label, b.ok, b.models.length])).toEqual([["claude", "Claude · Anthropic API", true, 3], ["openai", "OpenAI-format endpoint", true, 0]]);
    expect(c.brain.provider).toBe("claude");
    // the OpenAI-format brain lists no models: the hire names one, or is refused
    const refused = await hire({}, ["head", "search", "risk", "sniper"], { provider: "openai", effort: "low" });
    expect(isRefusal(refused) && refused.message).toMatch(/name the model, as the endpoint names it/);
    const r = await hire({}, ["head", "search", "risk", "sniper"], { provider: "openai", model: "deepseek-chat", effort: "low", price: { inUsd: 0.27, outUsd: 1.1 } });
    expect(isRefusal(r)).toBe(false);
    await desk.cycle("test");
    let v = (await desk.view())!;
    expect(v.brain).toMatchObject({ ok: true, provider: "openai", label: "OpenAI-format endpoint", model: "deepseek-chat", effort: "low", price: { inUsd: 0.27, outUsd: 1.1 } });
    expect(readRoom(home).some((m) => m.text.includes("deepseek here"))).toBe(true);
    expect(v.brain.spend.calls).toBe(1);
    expect(v.brain.spend.usd).toBeCloseTo(0.04, 6); // (100k × 0.27 + 10k × 1.1) / 1M = 0.038, shown to the cent
    expect(desk.catalog().brain.provider).toBe("openai");
    // changed by signature to the other brain and a model it lists: priced at the listed price
    const ch = await own({ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "high" }) });
    expect(isRefusal(ch)).toBe(false);
    expect(readRoom(home).at(-1)?.text).toMatch(/^You changed the brain: Claude · Anthropic API · claude-haiku-5-5 · high effort\.$/);
    await desk.cycle("test");
    v = (await desk.view())!;
    expect(v.brain).toMatchObject({ provider: "claude", model: "claude-haiku-5-5", effort: "high" });
    expect(v.brain.price).toBeUndefined();
    expect(readRoom(home).some((m) => m.text.includes("claude here"))).toBe(true);
    expect(v.brain.spend.usd).toBeCloseTo(0.05, 6); // + (100k × 0.1 + 10k × 0.5) / 1M = 0.015 → 0.053
    // a model nobody prices: the tokens are counted, unpriced, and the view says so
    const un = await own({ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "openai", model: "kimi-k2", effort: "medium" }) });
    expect(isRefusal(un)).toBe(false);
    await desk.cycle("test");
    v = (await desk.view())!;
    expect(v.brain.spend.unpricedTokens).toBe(110_000);
    expect(v.brain.spend.usd).toBeCloseTo(0.05, 6);
    // a brain that lists its models refuses one it does not list; a price is two numbers
    const no = await own({ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "claude", model: "gpt-5" }) });
    expect(isRefusal(no) && no.message).toMatch(/Claude · Anthropic API lists claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5: "gpt-5" is not one of them/);
    const bad = await own({ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "openai", model: "kimi-k2", price: { inUsd: -1, outUsd: "x" } }) });
    expect(isRefusal(bad) && bad.message).toMatch(/a price is dollars per million tokens/);
    // a desk file from before brains were a choice is read as Claude's
    const file = JSON.parse(readFileSync(deskPath(home), "utf8"));
    delete file.brain.provider;
    writeFileSync(deskPath(home), JSON.stringify(file));
    const { desk: again } = await boot({ home, brain: [claude, open], prices: { "BTC/USDT": SPOT("BTC/USDT", 60_000) } });
    expect((await again.view())!.brain.provider).toBe("claude");
  });

  it("the house brain's standing is honest: no file, the example left in the file, a file it cannot use, a key — and never a value", () => {
    const home = mkdtempSync(join(tmpdir(), "account-brain-"));
    const dir = join(home, "credentials", "anthropic");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "api-key.json");
    const env = {} as NodeJS.ProcessEnv;
    const KEY = "sk-ant-api03-TEST-not-a-real-key-0123456789";
    expect(brainReach({ home, env })).toMatchObject({ ok: false, why: expect.stringMatching(/^no key: put an Anthropic API key in .*api-key\.json as/) });
    // the how-to's example, copied as it is: not a key, and the standing says so instead of "ready"
    writeFileSync(file, '{"apiKey": "sk-ant-..."}', { mode: 0o600 });
    expect(brainReach({ home, env })).toMatchObject({ ok: false, why: expect.stringMatching(/api-key\.json holds the example, not a key: put your key there .* no restart needed/) });
    writeFileSync(file, '{"apiKey": "sk-ant-…"}');
    expect(brainReach({ home, env })).toMatchObject({ ok: false, why: expect.stringMatching(/holds the example, not a key/) });
    writeFileSync(file, '{"secret": "x"}');
    expect(brainReach({ home, env })).toMatchObject({ ok: false, why: expect.stringMatching(/^the key file cannot be used: .*missing "apiKey"/) });
    writeFileSync(file, `{"apiKey": "${KEY}"}`);
    expect(brainReach({ home, env })).toMatchObject({ ok: true, how: "the key file credentials/anthropic/api-key.json" });
    expect(claudeBrain({ home, env }).ready()).toMatchObject({ ok: true, model: "claude-opus-5-5" });
    chmodSync(file, 0o644);
    const open = brainReach({ home, env });
    expect(open).toMatchObject({ ok: false, why: expect.stringMatching(/^the key file cannot be used: .*chmod 600/) });
    expect(JSON.stringify(open)).not.toContain(KEY);
    // the environment: the example is refused there too; a key is taken
    expect(brainReach({ home, env: { ANTHROPIC_API_KEY: "sk-ant-..." } as NodeJS.ProcessEnv })).toMatchObject({ ok: false, why: expect.stringMatching(/^ANTHROPIC_API_KEY .* not a key/) });
    const fromEnv = claudeBrain({ home, env: { ANTHROPIC_API_KEY: KEY } as NodeJS.ProcessEnv }).ready();
    expect(fromEnv).toMatchObject({ ok: true, how: "ANTHROPIC_API_KEY in the service's environment" });
    expect(JSON.stringify(fromEnv)).not.toContain(KEY);
    rmSync(home, { recursive: true, force: true });
  });

  it("an outside agent holds a seat with its own key and speaks in the room; a key without a seat is refused", async () => {
    const { desk, hire, own, as, home } = await boot();
    await hire();
    await own({ type: "approveAgent", agentAddress: cc.address as `0x${string}`, agentName: "Claude Code", validUntil: START + 30 * DAY });
    await own({ type: "approveAgent", agentAddress: codex.address as `0x${string}`, agentName: "Codex", validUntil: START + 30 * DAY });
    expect(code(await own({ type: "setDesk", desk: "desk", change: "seat", value: JSON.stringify({ role: "flow", kind: "outside", address: cc.address }) }))).toBe("account");
    expect(code(await as(cc, { type: "agentDeskSay", lead: "", kind: "note", text: "FLOW online: watching the top wallets." }))).toBe("account");
    expect(code(await as(codex, { type: "agentDeskSay", lead: "", kind: "note", text: "hello" }))).toBe("E_ACCOUNT_OWNER_ONLY");
    expect(code(await as(cc, { type: "agentDeskSay", lead: "L-9999", kind: "note", text: "about nothing" }))).toBe("E_ACCOUNT_BAD_ACTION");
    const last = readRoom(home).at(-1)!;
    expect(last).toMatchObject({ from: "flow", kind: "note", text: "FLOW online: watching the top wallets." });
    const v = (await desk.view())!;
    expect(v.seats.find((s) => s.role === "flow")).toMatchObject({ kind: "outside", address: cc.address, name: "Claude Code", status: "ok" });
    // what the seat reads of the desk: its charter, the objective, the room
    const mine = await desk.forSeat(cc.address);
    if (isRefusal(mine)) throw new Error(mine.message);
    expect((mine.yourSeat as { role: string }).role).toBe("flow");
    expect((mine.room as unknown[]).length).toBeGreaterThan(2);
    const none = await desk.forSeat(codex.address);
    if (isRefusal(none)) throw new Error(none.message);
    expect(none.yourSeat).toBeNull();
  });

  it("a restart continues the desk: the file, the seats (let in again from the ledger), the leads, the room", async () => {
    const first = await boot();
    await first.hire();
    await first.own({ type: "setPolicy", change: "mode", value: "open" });
    await first.desk.cycle("test");
    const before = (await first.desk.view())!;
    expect(before.open).toHaveLength(1);
    const again = await boot({ home: first.home, at: 10 * 60_000 });
    expect(again.desk.hired()).toBe(true);
    const v = (await again.desk.view())!;
    expect(v.name).toBe("Test desk");
    expect(v.seats.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(v.seats.find((s) => s.role === "sniper")?.limit?.budgetUsd).toBe(500);
    expect(v.open.map((l) => l.id)).toEqual(["L-0001"]);
    expect(v.room.length).toBe(before.room.length);
    expect(v.session?.state).toBe("live");
  });
});

describe("the cap is the owner's to change", () => {
  it("setPolicy cap: signed up or down, in force at once for every order, and brought back by a restart from the signature alone", async () => {
    const first = await boot();
    const { svc, own, home } = first;
    let page = (await svc.accountView())!;
    expect(page.connectLive?.writes?.capUsd).toBe(100);
    // an owner's order of $300 is over a $100 cap; signed up to $500, it is placed
    const big = { type: "liveOrder" as const, venue: "ex", symbol: "BTC/USDT", side: "buy", orderType: "market", qty: "0.005" };
    const p1 = await svc.account!.prepare(big);
    expect(isRefusal(p1) && p1.code).toBe("E_ACCOUNT_LIMIT");
    expect(code(await own({ type: "setPolicy", change: "cap", value: "500" }))).toBe("account");
    page = (await svc.accountView())!;
    expect(page.connectLive?.writes?.capUsd).toBe(500);
    const p2 = await svc.account!.prepare(big);
    if (isRefusal(p2)) throw new Error(p2.message);
    expect(p2.quote?.order?.capUsd).toBe(500);
    // not a number, nothing, below zero: refused
    for (const value of ["", "abc", "-5", "0", "1.234"]) expect(code(await own({ type: "setPolicy", change: "cap", value }))).toBe("E_ACCOUNT_BAD_ACTION");
    // lowered again by signature
    expect(code(await own({ type: "setPolicy", change: "cap", value: "40" }))).toBe("account");
    expect((await svc.accountView())!.connectLive?.writes?.capUsd).toBe(40);
    // a restart with the server's own --live-cap of 100 brings back the last signed figure
    const again = await boot({ home, at: 10 * 60_000 });
    expect((await again.svc.accountView())!.connectLive?.writes?.capUsd).toBe(40);
    expect(again.svc.restored?.skipped ?? []).toEqual([]);
  });
});
