import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Ledger, type LedgerRow, type LedgerRowInput } from "../../src/agent/ledger.ts";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { cardHash, RESTARTED_CARD, STOPPED_CARD, type AgentAsk, type CardLike, type Outcome } from "../../src/portfolio/account/exchange.ts";
import type { LiveOrder } from "../../src/portfolio/account/live-orders.ts";
import { signAgent, signOwner, simKey, type AgentAction, type OwnerAction, type SimKey } from "../../src/portfolio/account/sign.ts";
import { register, type LiveDeps } from "../../src/portfolio/live/index.ts";
import type { LiveTrader, Market, OrderState } from "../../src/portfolio/live/trade.ts";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** THE TOWER: what the owner has over agents that act on their own. One move stops every agent at once — their session ends, Guard comes
 * on, the cards still waiting close and give back what they held, the desk pauses — and stays stopped across a restart until the owner
 * signs a new session. A restart no longer loses what waits for the owner: a card the earlier run left waiting is closed on the ledger
 * and says why to the agent that asked (a card is its run's alone), what agents asked comes back with each signature checked again, and so
 * do the agents that knocked to be let in. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-22T14:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
const owner = simKey("owner");
const cc = simKey("agent:claude-code");
const intruder = simKey("agent:intruder");
const gravit = simKey("agent:gravit");

const BTC: Market = { symbol: "BTC/USDT", name: "BTC/USDT", kind: "spot", base: "BTC", quote: "USDT", price: 60_000, bid: 59_990, ask: 60_010, minQty: 0.0001, qtyStep: 0.0001, priceStep: 0.1, open: true, types: ["market", "limit"] };
/** one venue that outlives the runs: a market order fills at once, a limit rests on the book */
const venue = { placed: 0, states: new Map<string, OrderState>() };
const trader: LiveTrader = {
  can: true,
  what: "spot",
  async markets() {
    return [BTC];
  },
  async market(symbol) {
    return symbol === BTC.symbol ? { ...BTC } : no("E_VENUE_REJECTED", { venue: "ex", message: `no market ${symbol}` });
  },
  async place(o) {
    const ref = `r-${++venue.placed}`;
    const s: OrderState = o.type === "market" ? { ref, status: "filled", filledQty: o.qty, avgPrice: 60_010, native: {} } : { ref, status: "open", filledQty: 0, native: {} };
    venue.states.set(ref, s);
    return s;
  },
  async cancel(ref) {
    const s = { ...venue.states.get(ref)!, status: "canceled" as const };
    venue.states.set(ref, s);
    return s;
  },
  async status(ref) {
    return venue.states.get(ref)!;
  },
};
register({ kind: "standin-tower", label: "a venue that trades", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Stand-in", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDT", amount: 500, usd: 500 }], trader, readOnlyBecause: "the stand-in moves no money" }, first: [{ asset: "USDT", amount: 500, usd: 500 }], summary: "connected" };
} });

const fresh = () => {
  const h = mkdtempSync(join(tmpdir(), "account-tower-"));
  homes.push(h);
  return h;
};

/** one run of the real account on `home`, `at` ms after the start, the owner an address given at start; its clock can be moved */
async function run(home: string, at = 0) {
  let t = START + at;
  let n = 0;
  const liveDeps: Partial<LiveDeps> = { clock: () => t, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(t).toISOString(), venues: "frontline", real: true, liveDeps, liveWrites: { capUsd: 1000, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa" as const, label: "owner", addedAt: new Date(START).toISOString() }] } });
  await svc.restoring;
  const engine = svc.account!;
  const nonce = () => t + ++n;
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: nonce() } as OwnerAction));
  const ag = async (a: NoNonce<AgentAction>, key: SimKey = cc) => svc.exchange(await signAgent(key, { ...a, nonce: nonce() } as AgentAction));
  const trade = () => engine.state.spends.find((s) => s.scope === "trade" && s.revokedAt === undefined && s.agent === cc.address.toLowerCase());
  const card = async (id: string) => (await svc.overview()).approvals.find((x) => x.id === id);
  return { svc, engine, own, ag, trade, card, page: () => engine.view(), pass: (ms: number) => void (t += ms) };
}

/** an account with the stand-in venue connected and Claude Code let in, with a limit to trade there */
async function account(home = fresh(), at = 0) {
  const x = await run(home, at);
  ok(await x.own({ type: "connectVenue", venue: "ex", connector: "live:standin-tower", label: "Ex", credentialRef: "" }));
  ok(await x.own({ type: "approveAgent", agentAddress: cc.address, agentName: "Claude Code", validUntil: START + 30 * DAY }));
  ok(await x.own({ type: "approveSpend", agent: cc.address, scope: "trade", allow: "ex", perPayment: "50", budget: "200", windowHours: 0, validUntil: START + 7 * DAY }));
  return x;
}

const ok = (o: Outcome | Refusal) => {
  if (isRefusal(o)) throw new Error(`${o.code}: ${o.message}`);
  return o;
};
const code = (o: Outcome | Refusal): string => (isRefusal(o) ? o.code : o.kind);
const refusalOf = (o: Outcome | Refusal): Refusal => {
  if (!isRefusal(o)) throw new Error(`expected a refusal, got ${o.kind}`);
  return o;
};
const cardOf = (o: Outcome | Refusal): CardLike => {
  if (isRefusal(o) || o.kind !== "card") throw new Error(`expected a card, got ${JSON.stringify(o).slice(0, 200)}`);
  return o.card;
};
const placed = (o: Outcome | Refusal): LiveOrder => {
  const x = ok(o);
  if (x.kind !== "order") throw new Error(`expected an order, got ${x.kind}`);
  return x.order;
};
const askOf = (o: Outcome | Refusal): AgentAsk => {
  const x = ok(o);
  if (x.kind !== "result") throw new Error(`expected a result, got ${x.kind}`);
  return (x.result as { ask: AgentAsk }).ask;
};
const order = (o: Partial<Extract<AgentAction, { type: "agentLiveOrder" }>> = {}) => ({ type: "agentLiveOrder" as const, venue: "ex", symbol: "BTC/USDT", side: "buy", orderType: "market", qty: "", usd: "30", limitPrice: "", ...o });
const resting = { orderType: "limit", usd: "", qty: "0.0005", limitPrice: "50000" };
const ask = (o: Partial<{ kind: string; venue: string; usd: string; text: string }> = {}) => ({ type: "agentAsk" as const, kind: "mode", venue: "", usd: "", text: "Beast for the afternoon", ...o });
/** every row of every ledger file in the home, oldest file first */
const ledgers = (home: string) => readdirSync(join(home, "portfolio")).filter((f) => f.startsWith("ledger-")).sort();
const rows = (home: string): LedgerRow[] => ledgers(home).flatMap((f) => readFileSync(join(home, "portfolio", f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerRow));
/** a row as a ledger takes it: without the place the ledger gives it (its number, time and hashes) */
const inputOf = (r: LedgerRow): LedgerRowInput => {
  const { v: _v, seq: _seq, ts: _ts, prev: _prev, hash: _hash, ...input } = r;
  return input;
};

describe("stopping every agent", () => {
  it("at once: the session ends, Beast goes back to Guard, a waiting card closes and gives back its share of the limit; reads go on; a write answers E_WALLET_AGENTS_STOPPED; the owner's new session lets them act again", async () => {
    const x = await account();
    // Guard: the agent's order waits on a card, which holds its share of the limit
    const c = cardOf(await x.ag(order()));
    expect(x.trade()!.reservedMicro).toBeGreaterThan(0);
    // Beast: a resting order placed at once
    ok(await x.own({ type: "setPolicy", change: "mode", value: "open" }));
    const left = placed(await x.ag(order(resting)));
    expect(left.status).toBe("open");

    const r = await x.svc.stopAgents();
    expect(r).toMatchObject({ ok: true, cards: 1, guard: true, desk: false, openOrders: 1 });
    expect(x.svc.policy()).toMatchObject({ mode: "guard", stoppedAt: r.stoppedAt, sessionExpiresAt: r.stoppedAt });
    // the card: closed, its share given back, its words kept for the agent that asked
    const closed = await x.card(c.id);
    expect([closed?.status, closed?.closedWhy, x.trade()!.reservedMicro]).toEqual(["rejected", STOPPED_CARD, 0]);
    // a write is refused in the stop's own words; reads go on; the agent may still take its own order off the book
    const refused = refusalOf(await x.ag(order()));
    expect([refused.code, refused.message]).toEqual(["E_WALLET_AGENTS_STOPPED", `the owner stopped every agent at ${r.stoppedAt}: every write stops, reads continue, until the owner signs a new session`]);
    expect((await x.page()).venues.map((v) => v.id)).toContain("ex");
    expect(placed(await x.ag({ type: "agentLiveCancel", venue: "ex", order: left.id })).status).toBe("canceled");
    // an owner answering the card late is told it was closed, and why
    const late = refusalOf(await x.own({ type: "approveCard", card: c.id, action: cardHash(c), decision: "approve" }));
    expect([late.code, late.message]).toEqual(["E_CARD_NOT_GRANTED", `${c.id} is closed: ${STOPPED_CARD}`]);
    // a second stop finds nothing more to close
    expect(await x.svc.stopAgents()).toMatchObject({ cards: 0, guard: false, openOrders: 0 });
    // starting them again is the owner's signature: a new session, in Guard
    ok(await x.own({ type: "setPolicy", change: "session", value: "30d" }));
    expect(x.svc.policy().stoppedAt).toBeUndefined();
    expect(code(await x.ag(order()))).toBe("card");
  });

  it("the stop is kept across a restart, until the owner signs a new session — which a restart keeps too", async () => {
    const home = fresh();
    const a = await account(home);
    const r = await a.svc.stopAgents();
    const note = rows(home).find((x) => x.kind === "note" && /^every agent stopped by the owner/.test(x.reason ?? ""));
    expect(note?.detail).toMatchObject({ dial: { mode: "guard", ended: true, stoppedAt: r.stoppedAt } });

    const b = await run(home, HOUR);
    expect(b.svc.policy()).toMatchObject({ mode: "guard", stoppedAt: r.stoppedAt });
    expect(refusalOf(await b.ag(order())).code).toBe("E_WALLET_AGENTS_STOPPED");
    ok(await b.own({ type: "setPolicy", change: "session", value: "30d" }));
    const c = await run(home, 2 * HOUR);
    expect(c.svc.policy().stoppedAt).toBeUndefined();
    expect(code(await c.ag(order()))).toBe("card");
  });

  it("over HTTP: POST /api/agents/stop takes no signature and says what it did; the page's dial says when; opening the dial stays the owner's signature", async () => {
    const x = await account();
    const srv = await startPortfolioServer({ port: 0, service: x.svc });
    try {
      const post = (path: string, body: unknown) => fetch(`${srv.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const res = await post("/api/agents/stop", {});
      const body = (await res.json()) as { ok: boolean; cards: number; guard: boolean; stoppedAt: string };
      expect([res.status, body.ok, body.cards, body.guard]).toEqual([200, true, 0, false]);
      const page = (await (await fetch(`${srv.url}/api/account`)).json()) as { dial: Record<string, unknown> };
      expect(page.dial).toMatchObject({ sessionEnded: true, stoppedAt: body.stoppedAt });
      // no unsigned caller undoes it: Beast is the owner's to sign
      expect((await post("/api/mode", { mode: "open" })).status).toBeGreaterThanOrEqual(400);
      expect(refusalOf(await x.ag(order())).code).toBe("E_WALLET_AGENTS_STOPPED");
    } finally {
      await srv.close();
    }
  });
});

describe("what waits for the owner, across a restart", () => {
  it("a card the earlier run left waiting closes on the ledger: the agent reads why with its card, the owner's late answer is told so, the limit is whole, the next card is a new id", async () => {
    const home = fresh();
    const a = await account(home);
    const c = cardOf(await a.ag(order()));
    const before = venue.placed;

    const b = await run(home, 10 * MIN);
    expect(b.svc.restored).toMatchObject({ cards: 1, skipped: [] });
    const closed = await b.card(c.id);
    expect([closed?.status, closed?.closedWhy, closed?.signer?.toLowerCase(), closed?.expiresAt]).toEqual(["rejected", RESTARTED_CARD, cc.address.toLowerCase(), c.expiresAt]);
    expect([b.trade()!.reservedMicro, b.trade()!.spentMicro]).toEqual([0, 0]);
    const late = refusalOf(await b.own({ type: "approveCard", card: c.id, action: cardHash(c), decision: "approve" }));
    expect([late.code, late.message, venue.placed]).toEqual(["E_CARD_NOT_GRANTED", `${c.id} is closed: ${RESTARTED_CARD}`, before]);
    const next = cardOf(await b.ag(order()));
    expect(next.id).not.toBe(c.id);
    // the ledger says it once: raised, then closed by the restart — and the third run closes only the card the second left waiting
    const c3 = await run(home, 20 * MIN);
    expect(c3.svc.restored).toMatchObject({ cards: 1 });
    expect(rows(home).filter((r) => r.kind === "card" && r.intentId === c.id).map((r) => [r.outcome, r.reason])).toEqual([["pending", c.reason], ["rejected", RESTARTED_CARD]]);
    expect((await c3.card(next.id))?.closedWhy).toBe(RESTARTED_CARD);
  });

  it("a card whose half hour ran out while the account was down closes as the expired card it was: an answer now is told it expired", async () => {
    const home = fresh();
    const a = await account(home);
    const c = cardOf(await a.ag(order()));
    const b = await run(home, 45 * MIN);
    expect((await b.card(c.id))?.closedWhy).toBe("The card expired before it was answered; nothing moved");
    expect(refusalOf(await b.own({ type: "approveCard", card: c.id, action: cardHash(c), decision: "approve" })).code).toBe("E_ACCOUNT_CARD_EXPIRED");
  });

  it("what agents asked comes back: the waiting ask under its id, not the one a limit answered, the declined one shown to its agent a day; the ids continue, and five an hour counts across the restart", async () => {
    const home = fresh();
    const a = await account(home);
    const limit = askOf(await a.ag(ask({ kind: "limit", venue: "ex", usd: "300", text: "more room at Ex" })));
    const lev = askOf(await a.ag(ask({ kind: "leverage", text: "3x on perps" })));
    const mode = askOf(await a.ag(ask()));
    expect([limit.id, lev.id, mode.id]).toEqual(["ask-0001", "ask-0002", "ask-0003"]);
    // a bigger limit at Ex answers the first; the owner declines the second
    ok(await a.own({ type: "approveSpend", agent: cc.address, scope: "trade", allow: "ex", perPayment: "50", budget: "300", windowHours: 0, validUntil: START + 7 * DAY }));
    ok(await a.own({ type: "answerAsk", ask: lev.id, decision: "decline" }));
    expect((await a.page()).asks.map((x) => x.id)).toEqual([mode.id]);

    const b = await run(home, 10 * MIN);
    expect(b.svc.restored).toMatchObject({ asks: 1, skipped: [] });
    const page = await b.page();
    expect(page.asks.map((x) => [x.id, x.kind, x.text, x.agentName])).toEqual([[mode.id, "mode", "Beast for the afternoon", "Claude Code"]]);
    expect(page.declinedAsks.map((x) => x.id)).toEqual([lev.id]);
    // three asked this hour before the restart: two more go, under the next ids, and the sixth waits for the hour
    expect(askOf(await b.ag(ask({ kind: "topup", usd: "20", text: "gas money" }))).id).toBe("ask-0004");
    expect(askOf(await b.ag(ask({ kind: "session", text: "a new session" }))).id).toBe("ask-0005");
    expect(refusalOf(await b.ag(ask({ kind: "limit", venue: "ex", usd: "400", text: "again" }))).code).toBe("E_ACCOUNT_LIMIT");
    // the ask that came back is answered as any other
    ok(await b.own({ type: "answerAsk", ask: mode.id, decision: "decline" }));
    // two days on, every ask has lapsed and no decline is shown any more
    const c = await run(home, 2 * DAY);
    const later = await c.page();
    expect([later.asks, later.declinedAsks]).toEqual([[], []]);
  });

  it("an ask forged into the ledger is not brought back: one signed by another key, or a genuine one copied in again with other words", async () => {
    const home = fresh();
    const a = await account(home);
    const real = askOf(await a.ag(ask({ text: "Beast please" })));
    const genuine = rows(home).find((r) => r.tool === "agentAsk" && r.outcome === "asked")!;
    const tamper = new Ledger(join(home, "portfolio", ledgers(home)[0]!), () => new Date(START + MIN).toISOString());
    // a key the account does not know signs it, and the row says it is Claude Code's
    const forged = { type: "agentAsk", kind: "limit", venue: "ex", usd: "9999", text: "raise my limit", nonce: START + 77 } as AgentAction;
    tamper.append({ kind: "action", venue: "ex", tool: "agentAsk", signer: cc.address.toLowerCase(), envelope: await signAgent(intruder, forged), outcome: "asked", reason: "forged", native: { ask: { ...real, id: "ask-0007", kind: "limit", venue: "ex", usd: "9999", text: "raise my limit" } } });
    // Claude Code's own signed ask, copied in again under another id with other words
    tamper.append({ ...inputOf(genuine), native: { ask: { ...real, id: "ask-0008", text: "the owner already said yes" } } });

    const b = await run(home, 10 * MIN);
    expect((await b.page()).asks.map((x) => [x.id, x.text])).toEqual([[real.id, "Beast please"]]);
    expect(b.svc.restored?.skipped).toEqual([
      "agentAsk of 2026-10-22T14:01:00.000Z: its signature does not check out against the agent key and the words the row names",
      "agentAsk of 2026-10-22T14:01:00.000Z: the same signed ask a second time, which is taken once",
    ]);
  });

  it("an agent that knocked to be let in still asks after a restart, under the name it gave; let in, it is not asked for again", async () => {
    const home = fresh();
    const a = await account(home);
    expect(refusalOf(await a.ag(ask({ kind: "letIn", text: "Gravit" }), gravit)).code).toBe("E_ACCOUNT_UNKNOWN_SIGNER");
    expect(a.engine.state.requests.map((r) => [r.address, r.name])).toEqual([[gravit.address.toLowerCase(), "Gravit"]]);

    const b = await run(home, 10 * MIN);
    expect(b.engine.state.requests.map((r) => [r.address, r.name])).toEqual([[gravit.address.toLowerCase(), "Gravit"]]);
    expect(b.svc.restored).toMatchObject({ knocks: 1 });
    ok(await b.own({ type: "approveAgent", agentAddress: gravit.address, agentName: "Gravit", validUntil: START + 30 * DAY }));
    const c = await run(home, 20 * MIN);
    expect(c.engine.state.requests).toEqual([]);
  });
});
