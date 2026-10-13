import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { byAsset } from "../../src/portfolio/account/holdings.ts";
import { networthPath } from "../../src/portfolio/account/networth.ts";
import { signAgent, signOwner, simKey, type AgentAction, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { register, type LiveDeps } from "../../src/portfolio/live/index.ts";
import type { LiveTrader, Market, OrderState, Position } from "../../src/portfolio/live/trade.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** A PAPER ACCOUNT on the account (LiveSource.paper): a venue's own test environment beside a real one, both stand-ins that speak the
 * trader's shape. What the account does with it: its row says paper and its balance is not money (not in the totals, the holdings, the
 * net worth curve); an order there goes through the same door — the owner's signature or an agent's limit, the mode — and not through the
 * server's real-money cap; its orders and statement lines say paper; Markets keeps its line after the real venue's and never takes a row's
 * price from it; the comparison leaves it out; its positions say paper. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const DAY = 86_400_000;
const START = Date.parse("2026-10-12T15:00:00Z");
const REAL = 5_000_000;
const owner = simKey("owner");
const cc = simKey("agent:claude-code");

const PERP = (price: number, extra: Partial<Market> = {}): Market => ({ symbol: "ETH/USDT:USDT", name: "ETH perpetual", kind: "perp", base: "ETH", quote: "USDT", price, bid: price - 1, ask: price + 1, minQty: 0.01, qtyStep: 0.01, priceStep: 0.1, open: true, types: ["market", "limit"], tifs: ["gtc", "ioc"], reduceOnly: true, volumeUsd24h: 1_000_000_000, changePct24h: 1.5, ...extra });
/** a perpetual only the paper venue lists */
const XYZ: Market = { ...PERP(42), symbol: "XYZ/USDT:USDT", name: "XYZ perpetual", base: "XYZ", volumeUsd24h: 7 };

function traderOf(markets: Record<string, Market>, positions: Position[]): LiveTrader {
  const states = new Map<string, OrderState>();
  let n = 0;
  return {
    can: true,
    what: "perpetuals",
    async markets(q) {
      const all = Object.values(markets);
      const Q = q.trim().toUpperCase();
      return (Q ? all.filter((m) => m.symbol.toUpperCase().includes(Q) || m.base.toUpperCase().includes(Q)) : all).map((m) => ({ ...m }));
    },
    async market(symbol) {
      return markets[symbol] ? { ...markets[symbol]! } : no("E_VENUE_REJECTED", { venue: "standin", message: `no market ${symbol}` });
    },
    async place(o) {
      const ref = `o-${++n}`;
      const s: OrderState = o.type === "market" ? { ref, status: "filled", filledQty: o.qty, avgPrice: markets[o.symbol]?.price ?? 0, native: {} } : { ref, status: "open", filledQty: 0, native: {} };
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
      return positions.map((p) => ({ ...p }));
    },
  };
}
const REAL_T = traderOf({ [PERP(3000).symbol]: PERP(3000) }, [{ symbol: "ETH/USDT:USDT", name: "ETH perpetual", kind: "perp", side: "long", qty: 0.5, entryPrice: 2900, markPrice: 3000, usd: 1500, unrealizedUsd: 50, native: {} }]);
const PAPER_T = traderOf({ [PERP(3100).symbol]: PERP(3100), [XYZ.symbol]: XYZ }, [{ symbol: "ETH/USDT:USDT", name: "ETH perpetual", kind: "perp", side: "short", qty: 2, entryPrice: 3200, markPrice: 3100, usd: 6200, unrealizedUsd: 200, native: {} }]);

register({ kind: "standin-paper-real", label: "a real stand-in", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Real Ex", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDT", amount: 5000, usd: 5000 }], trader: REAL_T, readOnlyBecause: "a stand-in moves no money" } as never, first: [{ asset: "USDT", amount: 5000, usd: 5000 }], summary: "connected" };
} });
register({ kind: "standin-paper-paper", label: "a paper stand-in", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Paper Ex", kind: "cex", reference: "standin", via: "a stand-in's test environment", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDC", amount: 5000, usd: 5000 }], trader: PAPER_T, readOnlyBecause: "a paper account: its balance is not money", paper: true } as never, first: [{ asset: "USDC", amount: 5000, usd: 5000 }], summary: "connected" };
} });

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

async function boot(o: { writes?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "account-paper-"));
  homes.push(home);
  let n = 0;
  const liveDeps: Partial<LiveDeps> = { clock: () => REAL, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(START).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: [], ...(o.writes === false ? {} : { liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" } }), account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] } });
  const engine = svc.account!;
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
  const ag = async (a: NoNonce<AgentAction>) => svc.exchange(await signAgent(cc, { ...a, nonce: START + ++n } as AgentAction));
  for (const [venue, connector, label] of [["real", "live:standin-paper-real", "Real Ex"], ["paper", "live:standin-paper-paper", "Paper Ex"]] as const) {
    const r = await own({ type: "connectVenue", venue, connector, label, credentialRef: "" });
    if (isRefusal(r)) throw new Error(r.message);
  }
  /** what the page does: prepare, then sign exactly what came back */
  const order = async (venue: string, draft: Record<string, unknown>) => {
    const p = await engine.prepare({ type: "liveOrder", venue, ...draft });
    if (isRefusal(p)) return p;
    const { nonce: _n, ...rest } = p.action as Extract<OwnerAction, { type: "liveOrder" }>;
    return own(rest as NoNonce<OwnerAction>);
  };
  return { svc, engine, home, own, ag, order };
}
const code = (o: Outcome | Refusal): string => (isRefusal(o) ? o.code : o.kind);

describe("a paper account beside a real one", () => {
  it("its row says paper; its balance is not in the totals, the holdings or the ready cash", async () => {
    const { svc } = await boot();
    const page = (await svc.accountView())!;
    const real = page.venues.find((v) => v.id === "real")!;
    const paper = page.venues.find((v) => v.id === "paper")!;
    expect([real.live, real.paper, paper.live, paper.paper]).toEqual([true, undefined, true, true]);
    expect(paper.name).toBe("Paper Ex");
    expect([real.usd, paper.usd]).toEqual([5000, 5000]);
    expect([page.totalUsd, page.liveUsd]).toEqual([5000, 5000]);
    const held = byAsset(page.venues, { writes: true });
    expect(held.rows.map((r) => [r.key, r.usd])).toEqual([["stable:USDT", 5000]]);
    expect(held.money.readyUsd).toBe(5000);
  });

  it("the owner's order: held to the owner's signature and the venue as any order is, and not to the server's cap; the order, its quote and its statement line say paper", async () => {
    const { svc, engine, order } = await boot();
    // $2,900 against a cap of $100: refused at the real venue, placed at the paper one
    const big = { symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "2900", qty: "1" };
    expect(code(await order("real", big))).toBe("E_ACCOUNT_LIMIT");
    const p = await engine.prepare({ type: "liveOrder", venue: "paper", ...big });
    if (isRefusal(p)) throw new Error(p.message);
    expect(p.quote?.order).toMatchObject({ paper: true, notionalUsd: 2900, capUsd: 100 });
    expect(p.quote?.order?.words).toMatch(/^PAPER · buy 1 ETH at Paper Ex/);
    const placed = await order("paper", big);
    if (isRefusal(placed) || placed.kind !== "order") throw new Error(`expected an order, got ${code(placed)}`);
    expect(placed.order).toMatchObject({ venue: "paper", paper: true, status: "open", usd: 2900 });
    expect(engine.orders[0]!.paper).toBe(true);
    const line = svc.statement().find((l) => l.id === placed.order.id)!;
    expect(line).toMatchObject({ type: "trade", kind: "buy", account: "paper", paper: true });
    // the ledger's row for it says paper, never real money
    const rows = readFileSync(svc.ledgerPath(), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x) as { kind?: string; reason?: string });
    const logged = rows.find((r) => r.kind === "order" && (r.reason ?? "").includes(placed.order.id))!;
    expect(logged.reason).toContain(" · paper · PAPER · buy 1 ETH at Paper Ex");
    expect(logged.reason).not.toContain("real money");
    // a close at the paper venue is prepared without a cap on it
    const close = await engine.trade.prepareClose({ venue: "paper", symbol: "ETH/USDT:USDT" });
    if (isRefusal(close)) throw new Error(close.message);
    expect(close.quote).toMatchObject({ paper: true, overCap: false, capUsd: 100 });
    expect(close.quote.worthUsd).toBeGreaterThan(100);
  });

  it("an agent's order: its trading limit and the mode hold as anywhere — a limit too small refuses it, inside the limit Guard raises a card that says paper", async () => {
    const { engine, own, ag } = await boot();
    await own({ type: "approveAgent", agentAddress: cc.address, agentName: "Claude Code", validUntil: START + 30 * DAY });
    await own({ type: "approveSpend", agent: cc.address, scope: "trade", allow: "paper", perPayment: "50", budget: "100", windowHours: 0, validUntil: START + 7 * DAY });
    const big = { type: "agentLiveOrder" as const, venue: "paper", symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "2900", qty: "1", usd: "" };
    expect(code(await ag(big))).toBe("E_MANDATE_PER_ORDER_CAP");
    await own({ type: "approveSpend", agent: cc.address, scope: "trade", allow: "paper", perPayment: "5000", budget: "5000", windowHours: 0, validUntil: START + 7 * DAY });
    const asked = await ag(big);
    if (isRefusal(asked) || asked.kind !== "card") throw new Error(`expected a card, got ${code(asked)}`);
    const card = engine.host.card(asked.card.id)!;
    expect(card.reason).toMatch(/^Claude Code asks to PAPER · buy 1 ETH at Paper Ex/);
    expect((card.offer as { protocol: string }).protocol).toMatch(/^paper order \(no real money\)/);
  });

  it("read-only server: a paper order is still an order this server does not place", async () => {
    const { engine } = await boot({ writes: false });
    const p = await engine.prepare({ type: "liveOrder", venue: "paper", symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "2900", qty: "0.01" });
    expect(isRefusal(p) && p.code).toBe("E_WALLET_LIVE_WRITES_OFF");
  });

  it("Markets: the paper line comes after the real venue's and sets no price; a thing only the paper account lists is a row that says paper; the comparison leaves the paper account out", async () => {
    const { svc } = await boot();
    const eth = await svc.explore({ q: "ETH" });
    if (isRefusal(eth)) throw new Error(eth.message);
    const row = eth.items.find((i) => i.key === "perp:ETH")!;
    expect(row.paper).toBeUndefined();
    expect(row.price).toBe(3000);
    expect(row.changeFrom?.venue).toBe("real");
    expect(row.volumeUsd24h).toBe(1_000_000_000);
    expect(row.at.map((a) => [a.venue, a.connected, a.paper ?? false, a.price])).toEqual([["real", true, false, 3000], ["paper", true, true, 3100]]);
    const xyz = await svc.explore({ q: "XYZ" });
    if (isRefusal(xyz)) throw new Error(xyz.message);
    const only = xyz.items.find((i) => i.key === "perp:XYZ")!;
    expect(only).toMatchObject({ paper: true, price: 42 });
    expect(only.volumeUsd24h).toBeUndefined();
    expect(only.at.map((a) => [a.venue, a.paper])).toEqual([["paper", true]]);
    const cmp = await svc.liveCompare("ETH", "buy");
    if (isRefusal(cmp)) throw new Error(cmp.message);
    expect(cmp.rows.map((r) => r.venue)).toEqual(["real"]);
    expect(cmp.missing.map((m) => m.venue)).not.toContain("paper");
  });

  it("positions say paper; the net worth curve counts the real venue alone", async () => {
    const { svc, home } = await boot();
    const all = await svc.allPositions();
    if (isRefusal(all)) throw new Error(all.message);
    expect(all.positions.map((p) => [p.venue, p.side, p.paper ?? false])).toEqual([["real", "long", false], ["paper", "short", true]]);
    const taken = await svc.snapshot();
    expect(taken && !isRefusal(taken) && taken.written).toBe(true);
    const points = readFileSync(networthPath(home), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x) as { usd: number; byVenue: Record<string, number> });
    const last = points[points.length - 1]!;
    expect([last.usd, last.byVenue]).toEqual([5000, { real: 5000 }]);
  });
});
