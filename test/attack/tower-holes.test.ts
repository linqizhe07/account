import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Ledger } from "../../src/agent/ledger.ts";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { cardHash, RESTARTED_CARD, type CardLike, type Outcome } from "../../src/portfolio/account/exchange.ts";
import { signAgent, signOwner, simKey, type AgentAction, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { register, type LiveDeps } from "../../src/portfolio/live/index.ts";
import type { LiveTrader, Market, OrderState } from "../../src/portfolio/live/trade.ts";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** Holes in the tower, tried: undoing the owner's stop without the owner (a row written into the ledger, the stop route sent more), racing
 * the stop with an approval, and a card written into the ledger to be approved after a restart. Each is turned back. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-22T16:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
const owner = simKey("owner");
const cc = simKey("agent:claude-code");

const BTC: Market = { symbol: "BTC/USDT", name: "BTC/USDT", kind: "spot", base: "BTC", quote: "USDT", price: 60_000, bid: 59_990, ask: 60_010, minQty: 0.0001, qtyStep: 0.0001, priceStep: 0.1, open: true, types: ["market", "limit"] };
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
    const s: OrderState = { ref, status: "filled", filledQty: o.qty, avgPrice: 60_010, native: {} };
    venue.states.set(ref, s);
    return s;
  },
  async cancel(ref) {
    return { ...venue.states.get(ref)!, status: "canceled" as const };
  },
  async status(ref) {
    return venue.states.get(ref)!;
  },
};
register({ kind: "standin-tower-holes", label: "a venue that trades", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Stand-in", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDT", amount: 500, usd: 500 }], trader, readOnlyBecause: "the stand-in moves no money" }, first: [{ asset: "USDT", amount: 500, usd: 500 }], summary: "connected" };
} });

const fresh = () => {
  const h = mkdtempSync(join(tmpdir(), "tower-holes-"));
  homes.push(h);
  return h;
};
async function run(home: string, at = 0) {
  const t = START + at;
  let n = 0;
  const liveDeps: Partial<LiveDeps> = { clock: () => t, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(t).toISOString(), venues: "frontline", real: true, liveDeps, liveWrites: { capUsd: 1000, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa" as const, label: "owner", addedAt: new Date(START).toISOString() }] } });
  await svc.restoring;
  const nonce = () => t + ++n;
  const sign = (a: NoNonce<OwnerAction>) => signOwner(owner, { ...a, nonce: nonce() } as OwnerAction);
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await sign(a));
  const ag = async (a: NoNonce<AgentAction>) => svc.exchange(await signAgent(cc, { ...a, nonce: nonce() } as AgentAction));
  const trade = () => svc.account!.state.spends.find((s) => s.scope === "trade" && s.revokedAt === undefined);
  return { svc, sign, own, ag, trade, card: async (id: string) => (await svc.overview()).approvals.find((x) => x.id === id) };
}
async function account(home = fresh()) {
  const x = await run(home);
  ok(await x.own({ type: "connectVenue", venue: "ex", connector: "live:standin-tower-holes", label: "Ex", credentialRef: "" }));
  ok(await x.own({ type: "approveAgent", agentAddress: cc.address, agentName: "Claude Code", validUntil: START + 30 * DAY }));
  ok(await x.own({ type: "approveSpend", agent: cc.address, scope: "trade", allow: "ex", perPayment: "50", budget: "200", windowHours: 0, validUntil: START + 7 * DAY }));
  return x;
}
const ok = (o: Outcome | Refusal) => {
  if (isRefusal(o)) throw new Error(`${o.code}: ${o.message}`);
  return o;
};
const codeOf = (o: Outcome | Refusal): string => (isRefusal(o) ? o.code : o.kind);
const cardOf = (o: Outcome | Refusal): CardLike => {
  if (isRefusal(o) || o.kind !== "card") throw new Error(`expected a card, got ${JSON.stringify(o).slice(0, 200)}`);
  return o.card;
};
const order = { type: "agentLiveOrder" as const, venue: "ex", symbol: "BTC/USDT", side: "buy", orderType: "market", qty: "", usd: "30", limitPrice: "" };
const ledgerFile = (home: string) => join(home, "portfolio", readdirSync(join(home, "portfolio")).filter((f) => f.startsWith("ledger-")).sort()[0]!);

describe("undoing the owner's stop without the owner", () => {
  it("a dial row written into the ledger after the stop, saying the session is open, does not open it after a restart: only the owner's signed new session does", async () => {
    const home = fresh();
    const a = await account(home);
    const stop = await a.svc.stopAgents();
    // a program running as the user appends rows that hash correctly: the session open for a year, and the same with `ended` claimed
    const tamper = new Ledger(ledgerFile(home), () => new Date(START + MIN).toISOString());
    tamper.append({ kind: "note", venue: "*", reason: "a new session", detail: { dial: { mode: "guard", revoked: [], reach: {}, sessionExpiresAt: new Date(START + 365 * DAY).toISOString() } } });
    tamper.append({ kind: "note", venue: "*", reason: "a new session", detail: { dial: { mode: "guard", revoked: [], reach: {}, sessionExpiresAt: new Date(START + 365 * DAY).toISOString(), ended: true } } });

    const b = await run(home, HOUR);
    expect(b.svc.policy()).toMatchObject({ sessionExpiresAt: stop.stoppedAt, stoppedAt: stop.stoppedAt });
    expect(codeOf(await b.ag(order))).toBe("E_WALLET_AGENTS_STOPPED");
    expect(b.svc.restored?.skipped).toContain("the agents' session was ended, and the owner's signature that opened it again is not in the chain: it stays ended");
    // the owner's signature opens it, and a restart keeps that
    ok(await b.own({ type: "setPolicy", change: "session", value: "30d" }));
    const c = await run(home, 2 * HOUR);
    expect([c.svc.policy().stoppedAt, c.svc.restored?.skipped]).toEqual([undefined, []]);
    expect(codeOf(await c.ag(order))).toBe("card");
  });

  it("the stop route takes nothing else from its caller: sent a session or a mode, it only stops", async () => {
    const x = await account();
    const srv = await startPortfolioServer({ port: 0, service: x.svc });
    try {
      const res = await fetch(`${srv.url}/api/agents/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "open", session: "30d", sessionExpiresAt: new Date(START + 365 * DAY).toISOString() }) });
      expect(res.status).toBe(200);
      expect(x.svc.policy()).toMatchObject({ mode: "guard" });
      expect(Date.parse(x.svc.policy().sessionExpiresAt)).toBeLessThanOrEqual(START);
    } finally {
      await srv.close();
    }
  });
});

describe("racing the stop", () => {
  it("the owner's yes already at the door when every agent is stopped: its release checks again and is refused — nothing placed, nothing it held lost, one close", async () => {
    const x = await account();
    const c = cardOf(await x.ag(order));
    const before = venue.placed;
    const envelope = await x.sign({ type: "approveCard", card: c.id, action: cardHash(c), decision: "approve" });
    const [answered, stopped] = await Promise.all([x.svc.exchange(envelope), x.svc.stopAgents()]);
    // the session ended before the release ran its checks again: the yes no longer passes, and the stop had no card left to close
    expect(codeOf(answered)).toBe("E_WALLET_AGENTS_STOPPED");
    expect([venue.placed, stopped.cards, x.trade()!.reservedMicro, x.trade()!.spentMicro]).toEqual([before, 0, 0, 0]);
    const closed = await x.card(c.id);
    expect([closed?.status, closed?.closedWhy]).toEqual(["approved", `Approved, but it no longer passes: the owner stopped every agent at ${stopped.stoppedAt}: every write stops, reads continue, until the owner signs a new session`]);
  });

  it("the stop first, the yes after it: the card was closed by the stop, and the yes is told so", async () => {
    const x = await account();
    const c = cardOf(await x.ag(order));
    const before = venue.placed;
    const envelope = await x.sign({ type: "approveCard", card: c.id, action: cardHash(c), decision: "approve" });
    const stopped = await x.svc.stopAgents();
    const answered = await x.svc.exchange(envelope);
    expect([codeOf(answered), (answered as Refusal).message]).toEqual(["E_CARD_NOT_GRANTED", `${c.id} is closed: You stopped every agent before it was answered; nothing moved`]);
    expect([venue.placed, stopped.cards, x.trade()!.reservedMicro]).toEqual([before, 1, 0]);
  });
});

describe("a card written into the ledger", () => {
  it("is never offered to the owner after a restart: a card left waiting is only ever closed, and no answer releases it", async () => {
    const home = fresh();
    await account(home);
    const tamper = new Ledger(ledgerFile(home), () => new Date(START + MIN).toISOString());
    tamper.append({ kind: "card", venue: "ex", intentId: "card-0099", tool: "agentLiveOrder", outcome: "pending", reason: "Claude Code asks to buy BTC", notionalUsd: 50, signer: cc.address.toLowerCase(), detail: { card: { expiresAt: new Date(START + 30 * DAY).toISOString(), why: "live", intent: { kind: "order", asset: "BTC", amount: 50 } } } });
    const before = venue.placed;
    const b = await run(home, 10 * MIN);
    const c = await b.card("card-0099");
    expect([c?.status, c?.closedWhy]).toEqual(["rejected", RESTARTED_CARD]);
    expect((await b.svc.accountView())?.cards ?? []).toEqual([]);
    expect(codeOf(await b.own({ type: "approveCard", card: "card-0099", action: `0x${"00".repeat(32)}`, decision: "approve" }))).toBe("E_CARD_NOT_GRANTED");
    expect(venue.placed).toBe(before);
  });
});
