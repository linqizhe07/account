import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { LedgerRow } from "../../src/agent/ledger.ts";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { cardHash, type Outcome } from "../../src/portfolio/account/exchange.ts";
import { MODE_RULES } from "../../src/portfolio/account/mode-rules.ts";
import { chainOf, malformed, ownerTypedData, shownFields, signAgent, signOwner, simKey, ZERO, type AgentAction, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { counterpartyProblem, emptyState, MAX_TOKEN_USES, TOKEN_OPEN, tokenProblem, type AccountState } from "../../src/portfolio/account/state.ts";
import { applyTokenSnapshot } from "../../src/portfolio/account/tokens.ts";
import { register, type LiveDeps } from "../../src/portfolio/live/index.ts";
import type { Listing, PublicSource } from "../../src/portfolio/live/public-markets.ts";
import type { LiveTrader, Market, OrderState } from "../../src/portfolio/live/trade.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** SPEND TOKENS (account/tokens.ts): one authorisation the owner signs for one agent on one rail, with its own lines and its own end.
 * Every transition of the state machine, the order of checks before a rail is asked, the free stop that only tightens, the token and its
 * counters back after a restart, the three labeling gaps closed — and the whole chain on the account's own paper account (live:paper):
 * the agent asks, the owner issues, the agent uses, the owner's card releases it, the agent says done. Nothing leaves the process. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const START = Date.parse("2026-10-16T15:00:00Z");
const owner = simKey("owner");
const cc = simKey("agent:claude-code");
const other = simKey("agent:other");

const PERP = (price: number, extra: Partial<Market> = {}): Market => ({ symbol: "ETH/USDT:USDT", name: "ETH perpetual", kind: "perp", base: "ETH", quote: "USDT", price, bid: price - 1, ask: price + 1, minQty: 0.01, qtyStep: 0.01, priceStep: 0.1, open: true, types: ["market", "limit"], tifs: ["gtc", "ioc"], reduceOnly: true, ...extra });
function traderOf(markets: Record<string, Market>): LiveTrader {
  const states = new Map<string, OrderState>();
  let n = 0;
  return {
    can: true,
    what: "perpetuals",
    async markets(q) {
      const Q = q.trim().toUpperCase();
      return Object.values(markets).filter((m) => !Q || m.symbol.toUpperCase().includes(Q) || m.base.toUpperCase().includes(Q)).map((m) => ({ ...m }));
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
      const s = { ...states.get(ref)!, status: "canceled" as const };
      states.set(ref, s);
      return s;
    },
    async status(ref) {
      return states.get(ref)!;
    },
  };
}
const REAL_T = traderOf({ [PERP(3000).symbol]: PERP(3000) });
const PAPER_T = traderOf({ [PERP(3000).symbol]: PERP(3000) });
register({ kind: "standin-tokens-real", label: "a real stand-in", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Real Ex", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDT", amount: 5000, usd: 5000 }], trader: REAL_T, readOnlyBecause: "a stand-in moves no money" } as never, first: [{ asset: "USDT", amount: 5000, usd: 5000 }], summary: "connected" };
} });
register({ kind: "standin-tokens-paper", label: "a paper stand-in", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Paper Ex", kind: "cex", reference: "standin", via: "a stand-in's test environment", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDC", amount: 5000, usd: 5000 }], trader: PAPER_T, readOnlyBecause: "a paper account: its balance is not money", paper: true } as never, first: [{ asset: "USDC", amount: 5000, usd: 5000 }], summary: "connected" };
} });

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

/** one run of the account: a clock the test moves, the owner seeded, the two stand-ins connected unless told not to */
async function boot(o: { home?: string; sources?: PublicSource[]; connect?: boolean; nonceFrom?: number; at?: number; cap?: number } = {}) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), "account-tokens-"));
  if (!o.home) homes.push(home);
  let n = o.nonceFrom ?? 0;
  let at = START + (o.at ?? 0);
  const liveDeps: Partial<LiveDeps> = { clock: () => 5_000_000 + (at - START), http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  // the agents' session runs through the test's days (the fixture's ends before them)
  const svc = await PortfolioService.create({ home, now: () => new Date(at).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: o.sources ?? [], liveWrites: { capUsd: o.cap ?? 100, pairingCode: "K7QX-M2PA" }, openness: { mode: "guard", sessionExpiresAt: new Date(START + 60 * DAY).toISOString() }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] } });
  await svc.restoring;
  const engine = svc.account!;
  const nonce = () => at + ++n;
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: nonce() } as OwnerAction));
  const ag = async (a: NoNonce<AgentAction>, key = cc, source: "sim" | "real" = "real") => svc.exchange(await signAgent(key, { ...a, nonce: nonce() } as AgentAction, source));
  if (o.connect !== false)
    for (const [venue, connector, label] of [["real", "live:standin-tokens-real", "Real Ex"], ["paper", "live:standin-tokens-paper", "Paper Ex"]] as const) {
      const r = await own({ type: "connectVenue", venue, connector, label, credentialRef: "" });
      if (isRefusal(r)) throw new Error(r.message);
    }
  /** what the page does: prepare, then sign exactly what came back */
  const prepared = async (draft: Record<string, unknown>) => {
    const p = await engine.prepare(draft);
    if (isRefusal(p)) return p;
    const { nonce: _n, ...rest } = p.action;
    return own(rest as NoNonce<OwnerAction>);
  };
  const token = (id: string) => engine.state.tokens.find((t) => t.id === id)!;
  const rows = () => readFileSync(svc.ledgerPath(), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x) as LedgerRow);
  return { svc, engine, home, own, ag, prepared, token, rows, nonce, tick: (ms: number) => (at += ms), now: () => at };
}
const code = (o: Outcome | Refusal | { ok: true; kind?: undefined }): string => (isRefusal(o) ? o.code : (o.kind ?? "ok"));
const ok = <T>(o: T | Refusal): T => {
  if (isRefusal(o)) throw new Error(`${o.code}: ${o.message}`);
  return o as T;
};
const letIn = (b: Awaited<ReturnType<typeof boot>>, key = cc, name = "Claude Code") => b.own({ type: "approveAgent", agentAddress: key.address, agentName: name, validUntil: START + 30 * DAY });
const ISSUE = (over: Partial<Extract<OwnerAction, { type: "issueSpendToken" }>> = {}): NoNonce<OwnerAction> => ({ type: "issueSpendToken", agent: cc.address, rail: "paper", instrument: "paper", counterparty: "ETH/USDT:USDT", maxAmount: "200", currency: "USD", perUseMax: "150", uses: 2, validUntil: START + 7 * DAY, atOnce: "", purpose: "rehearse small ETH buys", env: "test", ...over });
const USE = (over: Partial<Extract<AgentAction, { type: "agentUseToken" }>> = {}): NoNonce<AgentAction> => ({ type: "agentUseToken", token: "tok-0001", counterparty: "ETH/USDT:USDT", amount: "100", currency: "USD", request: JSON.stringify({ symbol: "ETH/USDT:USDT", side: "buy", orderType: "market", usd: 60 }), ...over });

describe("what is signed", () => {
  it("issueSpendToken signs every line of the token, chain text by environment; the agent's use and done are text fields, the request optional; an ask may carry a counterparty", () => {
    const live = { ...ISSUE({ env: "live", rail: "venue:real", instrument: "real" }), nonce: START } as OwnerAction;
    const test = { ...ISSUE(), nonce: START } as OwnerAction;
    expect(shownFields(live).map((f) => f.name)).toEqual(["agent", "rail", "instrument", "counterparty", "maxAmount", "currency", "perUseMax", "uses", "validUntil", "atOnce", "purpose", "env", "nonce"]);
    expect([chainOf(live), chainOf(test)]).toEqual(["Live · real money", "Paper · no real money"]);
    expect(ownerTypedData(live).message.accountChain).toBe("Live · real money");
    expect(ownerTypedData(live).primaryType).toBe("AccountToken:Issue");
    expect(malformed({ type: "revokeSpendToken", token: "tok-0001", reason: "", nonce: START })).toBeNull();
    expect(malformed({ ...USE(), nonce: START } as AgentAction)).toBeNull();
    expect(malformed({ type: "agentUseToken", token: "tok-0001", counterparty: "x", amount: "1", currency: "USD", nonce: START })).toBeNull();
    expect(malformed({ type: "agentUseToken", token: "tok-0001", counterparty: "x", amount: 1, currency: "USD", nonce: START } as never)).toBe('"amount" is text');
    expect(malformed({ type: "agentUseToken", token: "tok-0001", counterparty: "x", amount: "1", currency: "USD", extra: "1", nonce: START } as never)).toBe('"extra" is not part of "agentUseToken"');
    expect(malformed({ type: "agentTokenDone", use: "tok-0001/1", nonce: START })).toBeNull();
    expect(malformed({ type: "agentAsk", kind: "token", venue: "paper", usd: "", text: "", counterparty: "https://api.example.com", nonce: START })).toBeNull();
    expect(malformed({ type: "agentAsk", kind: "token", venue: "paper", usd: "", text: "", counterparty: 5, nonce: START } as never)).toBe('"counterparty" is text');
  });

  it("a token's shape is judged before anything is signed: its rail, its counterparty as the rail types it, its lines, its uses, its words, its time", () => {
    const now = START;
    expect(tokenProblem({ ...ISSUE() } as never, now)).toBeNull();
    expect(tokenProblem({ ...ISSUE({ rail: "card:crossmint" }) } as never, now)).toMatch(/rail is one of paper, venue, chain:x402/);
    expect(tokenProblem({ ...ISSUE({ rail: "venue:real", instrument: "paper", env: "live" }) } as never, now)).toBe("a venue token's instrument is the venue of its rail");
    expect(tokenProblem({ ...ISSUE({ perUseMax: "300" }) } as never, now)).toMatch(/no more than the token's amount/);
    expect(tokenProblem({ ...ISSUE({ uses: MAX_TOKEN_USES + 1 }) } as never, now)).toMatch(/1 to 20/);
    expect(tokenProblem({ ...ISSUE({ uses: 0 }) } as never, now)).toBeNull();
    expect(tokenProblem({ ...ISSUE({ rail: "chain:x402", instrument: "ops", counterparty: "https://api.example.com", currency: "USDC", env: "live", uses: 0 }) } as never, now)).toMatch(/says how many payments/);
    expect(tokenProblem({ ...ISSUE({ env: "live" }) } as never, now)).toBe("a paper token is a test token: its money is not real");
    expect(tokenProblem({ ...ISSUE({ currency: "USDC" }) } as never, now)).toMatch(/counts dollars \(USD\)/);
    expect(tokenProblem({ ...ISSUE({ purpose: "" }) } as never, now)).toMatch(/says what it is for/);
    expect(tokenProblem({ ...ISSUE({ purpose: "a​b" }) } as never, now)).toMatch(/plain text/);
    expect(tokenProblem({ ...ISSUE({ validUntil: START - 1 }) } as never, now)).toBe("a token ends in the future");
    expect(tokenProblem({ ...ISSUE({ validUntil: START + 40 * DAY }) } as never, now)).toMatch(/at most 30 days/);
    expect(tokenProblem({ ...ISSUE({ maxAmount: "200000" }) } as never, now)).toMatch(/at most 100,000/);
    // the counterparty is typed by the rail: markets at a venue ("*" on paper alone), an https origin on x402
    expect(counterpartyProblem("paper", "*")).toBeNull();
    expect(counterpartyProblem("venue:real", "*")).toMatch(/paper rail alone/);
    expect(counterpartyProblem("venue:real", "BTC/USDT, ETH/USDT")).toBeNull();
    expect(counterpartyProblem("chain:x402", "https://api.example.com")).toBeNull();
    expect(counterpartyProblem("chain:x402", "https://api.example.com/v1")).toMatch(/origin alone/);
    expect(counterpartyProblem("chain:x402", "http://api.example.com")).toMatch(/origin alone/);
    expect(counterpartyProblem("chain:x402", "api.example.com")).toMatch(/https origin/);
  });

  it("the Mode sheet's row: a use waits on a card in Guard unless the token says at once; Beast at once inside the token", () => {
    const row = MODE_RULES.find((r) => /spend token/i.test(r.door))!;
    expect(row).toBeDefined();
    expect(row.guard).toMatch(/card/i);
    expect(row.guard).toMatch(/at once/i);
    expect(row.beast).toMatch(/^At once/);
  });
});

describe("the state machine, on stand-in venues", () => {
  it("issue → active: the owner's signature alone, no trading limit read; a use in Beast runs at once, counts on the token, and the order says so", async () => {
    const b = await boot();
    ok(await letIn(b));
    expect(b.engine.state.spends).toEqual([]);
    // the page prepares it: the words, the honesty label, the signed text say test money
    const p = await b.engine.prepare({ ...ISSUE() } as Record<string, unknown>);
    if (isRefusal(p)) throw new Error(p.message);
    expect(p.accountChain).toBe("Paper · no real money");
    expect(p.quote?.words).toBe("a test token for Claude Code: trade ETH/USDT:USDT at Paper Ex");
    expect(p.quote?.token).toMatchObject({ honesty: "Test · no network holds this limit; only the Account does", paper: true, capUsd: 100 });
    const issued = ok(await b.prepared({ ...ISSUE() } as Record<string, unknown>));
    expect(issued.kind).toBe("result");
    const t = b.token("tok-0001");
    expect(t).toMatchObject({ status: "active", agent: cc.address, rail: "paper", instrument: "paper", counterparty: "ETH/USDT:USDT", maxMicro: 200_000_000, perUseMicro: 150_000_000, uses: 2, usesMade: 0, mintedMicro: 0, reservedMicro: 0, env: "test", usage: "proxy", providerRef: "paper:paper" });
    const page = (await b.svc.accountView())!;
    expect(page.tokens.map((x) => [x.id, x.status, x.leftUsd, x.honesty.text, x.testLabel, x.paper])).toEqual([["tok-0001", "active", 200, "The Account alone holds this limit", "Paper · Account paper book", true]]);
    ok(await b.own({ type: "setPolicy", change: "mode", value: "open" }));
    const used = ok(await b.ag(USE()));
    expect(used.kind).toBe("result");
    const r = (used as { result: { use: { id: string; status: string; executedUsd: number; ref: string }; token: { leftUsd: number; usesMade: number }; order: { id: string; token?: string; paper?: true; status: string } } }).result;
    expect(r.use).toMatchObject({ id: "tok-0001/1", status: "executed", ref: "ord-0001" });
    expect(r.order).toMatchObject({ id: "ord-0001", token: "tok-0001", paper: true, status: "filled" });
    // a market buy of $60 is counted at its worst price, then settled at what filled: the token's minted follows
    expect(r.token.usesMade).toBe(1);
    expect(r.token.leftUsd).toBeGreaterThan(130);
    expect(r.token.leftUsd).toBeLessThan(200);
    const line = b.svc.statement().find((l) => l.id === "ord-0001")!;
    expect(line.by).toBe("Claude Code, with token tok-0001");
    expect(line.description).toContain("· token tok-0001");
    expect(line.token).toBe("tok-0001");
    expect(line.paper).toBe(true);
    // its rows: issued, confirmed, the use held, counted (at its worst price, then at what filled: "settled" each time), executed
    const outcomes = b.rows().filter((x) => x.kind === "token" && x.intentId === "tok-0001").map((x) => x.outcome);
    expect(outcomes.slice(0, 3)).toEqual(["issuing", "active", "minting"]);
    expect(outcomes.at(-1)).toBe("executed");
    expect(outcomes.filter((x) => x === "settled").length).toBeGreaterThanOrEqual(1);
    expect(new Set(outcomes.slice(3, -1))).toEqual(new Set(["settled"]));
    // the agent says it is done; done twice is said once
    expect(code(await b.ag({ type: "agentTokenDone", use: "tok-0001/1" }))).toBe("account");
    expect(b.token("tok-0001").usesList[0]).toMatchObject({ status: "done" });
    expect(code(await b.ag({ type: "agentTokenDone", use: "tok-0001/1" }))).toBe("E_ACCOUNT_BAD_ACTION");
    // an order under a token is canceled, never changed in place
    const resting = ok(await b.ag(USE({ amount: "50", request: JSON.stringify({ symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "2000", qty: "0.01" }) })));
    expect(resting.kind).toBe("result");
    expect(code(await b.ag({ type: "agentLiveAmend", venue: "paper", order: "ord-0002", qty: "0.02", limitPrice: "", stopPrice: "" }))).toBe("E_ACCOUNT_BAD_ACTION");
    // two uses made: the token is used up
    expect(b.token("tok-0001").status).toBe("used");
    expect(code(await b.ag(USE()))).toBe("E_MANDATE_BUDGET");
    const canceled = ok(await b.ag({ type: "agentLiveCancel", venue: "paper", order: "ord-0002" }));
    expect(canceled.kind).toBe("order");
  });

  it("the order of checks before the rail: not this agent's and none at all answer alike; the status; the signature; the counterparty exactly; the currency; the lines; the uses", async () => {
    const b = await boot();
    ok(await letIn(b));
    ok(await letIn(b, other, "Other"));
    ok(await b.prepared({ ...ISSUE() } as Record<string, unknown>));
    ok(await b.own({ type: "setPolicy", change: "mode", value: "open" }));
    expect(code(await b.ag(USE(), other))).toBe("E_MANDATE_NONE");
    expect(code(await b.ag(USE({ token: "tok-0009" })))).toBe("E_MANDATE_NONE");
    const none = await b.ag(USE({ token: "tok-0009" }));
    const theirs = await b.ag(USE(), other);
    expect(isRefusal(none) && isRefusal(theirs) && none.message.replace("tok-0009", "tok-0001")).toBe(isRefusal(theirs) ? theirs.message : "");
    expect(code(await b.ag(USE({ counterparty: "ETH/USDT:USDT " })))).toBe("E_MANDATE_RECIPIENT");
    expect(code(await b.ag(USE({ currency: "USDC" })))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.ag(USE({ amount: "151" })))).toBe("E_MANDATE_PER_ORDER_CAP");
    expect(code(await b.ag(USE({ amount: "0" })))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.ag(USE({ request: "{" })))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.ag(USE({ request: JSON.stringify({ symbol: "BTC/USDT", side: "buy", usd: 10 }) })))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.ag(USE({ request: JSON.stringify({ symbol: "ETH/USDT:USDT", side: "buy", usd: 10, venue: "real" }) })))).toBe("E_ACCOUNT_BAD_ACTION");
    // the order may be worth at most what the use is for: a limit buy of 0.02 at 3,000 is worth $60
    expect(code(await b.ag(USE({ amount: "50", request: JSON.stringify({ symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: 3000, qty: 0.02 }) })))).toBe("E_ACCOUNT_REQUOTE");
    // nothing of that counted: every refusal came before the rail
    expect(b.token("tok-0001")).toMatchObject({ mintedMicro: 0, reservedMicro: 0, usesMade: 0 });
    // the account's own uses answer E_MANDATE_BUDGET for what is left
    ok(await b.ag(USE({ amount: "150", request: JSON.stringify({ symbol: "ETH/USDT:USDT", side: "buy", orderType: "market", usd: 140 }) })));
    expect(code(await b.ag(USE({ amount: "100" })))).toBe("E_MANDATE_BUDGET");
    // the signature on the token is checked again before every use: a token changed under it is not used
    b.engine.state = { ...b.engine.state, tokens: b.engine.state.tokens.map((t) => ({ ...t, maxMicro: 900_000_000, perUseMicro: 900_000_000 })) };
    expect(code(await b.ag(USE({ amount: "100" })))).toBe("E_ACCOUNT_BAD_SIGNATURE");
  });

  it("Guard: a use waits on a card that holds its worth on the token; the owner's yes releases exactly it; a reject or a card expired leaves it not-used; a token signed at once needs no card", async () => {
    const b = await boot();
    ok(await letIn(b));
    ok(await b.prepared({ ...ISSUE({ uses: 0 }) } as Record<string, unknown>));
    const asked = await b.ag(USE());
    if (isRefusal(asked) || asked.kind !== "card") throw new Error(`expected a card, got ${code(asked)}`);
    const card = b.engine.host.card(asked.card.id)!;
    expect(card.action?.type).toBe("agentUseToken");
    expect(card.approval).toBe("tok-0001");
    expect(card.reason).toMatch(/^Claude Code asks to PAPER · buy .* with tok-0001$/);
    expect((card.offer as { protocol: string }).protocol).toContain("with spend token tok-0001");
    // the card holds what it shows on the token; the use is minting with its card
    expect(b.token("tok-0001").reservedMicro).toBe(Math.round(card.usd * 1e6));
    expect(b.token("tok-0001").usesList[0]).toMatchObject({ id: "tok-0001/1", status: "minting", card: card.id });
    expect((await b.svc.accountView())!.tokens[0]).toMatchObject({ usesOpen: 1 });
    const released = ok(await b.own({ type: "approveCard", card: card.id, action: cardHash(card), decision: "approve" }));
    expect(released.kind).toBe("result");
    expect(b.token("tok-0001")).toMatchObject({ reservedMicro: 0, usesMade: 1 });
    expect(b.token("tok-0001").usesList[0]).toMatchObject({ status: "executed", ref: "ord-0001" });
    expect(b.engine.orders[0]).toMatchObject({ id: "ord-0001", token: "tok-0001", card: card.id });
    // rejected: not-used, nothing held
    const small = JSON.stringify({ symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: 1000, qty: 0.01 });
    const again = await b.ag(USE({ amount: "20", request: small }));
    if (isRefusal(again) || again.kind !== "card") throw new Error(`expected a card, got ${code(again)}`);
    const c2 = b.engine.host.card(again.card.id)!;
    ok(await b.own({ type: "approveCard", card: c2.id, action: cardHash(c2), decision: "reject" }));
    expect(b.token("tok-0001").usesList[1]).toMatchObject({ status: "not-used" });
    expect(b.token("tok-0001").reservedMicro).toBe(0);
    // expired unanswered: the same
    const third = await b.ag(USE({ amount: "20", request: small }));
    if (isRefusal(third) || third.kind !== "card") throw new Error(`expected a card, got ${code(third)}`);
    b.engine.expireCards(b.now() + 31 * 60_000);
    expect(b.token("tok-0001").usesList[2]).toMatchObject({ status: "not-used" });
    expect(b.token("tok-0001").reservedMicro).toBe(0);
    expect(b.token("tok-0001").usesMade).toBe(1);
    // a second token the owner signed at once: no card in Guard
    ok(await b.prepared({ ...ISSUE({ atOnce: "true", purpose: "at once" }) } as Record<string, unknown>));
    const atOnce = ok(await b.ag(USE({ token: "tok-0002" })));
    expect(atOnce.kind).toBe("result");
    expect(b.token("tok-0002").usesList[0]).toMatchObject({ status: "executed" });
    expect(b.rows().find((x) => x.kind === "action" && x.tool === "agentUseToken" && x.outcome === "accepted")?.reason).toMatch(/^Token tok-0002, at once:/);
  });

  it("the free stop only tightens: a stopped token refuses every use, stops once, is not made active again by any row, and a signed revocation ends it; Stop all stops the standing ones", async () => {
    const b = await boot();
    ok(await letIn(b));
    ok(await b.prepared({ ...ISSUE() } as Record<string, unknown>));
    ok(await b.prepared({ ...ISSUE({ purpose: "second" }) } as Record<string, unknown>));
    ok(await b.own({ type: "setPolicy", change: "mode", value: "open" }));
    expect(await b.svc.stopTokens("tok-0001")).toEqual({ ok: true, stopped: ["tok-0001"], already: [] });
    expect(b.token("tok-0001")).toMatchObject({ status: "stopped" });
    expect(code(await b.ag(USE()))).toBe("E_MANDATE_NONE");
    expect(await b.svc.stopTokens("tok-0001")).toEqual({ ok: true, stopped: [], already: ["tok-0001"] });
    expect(code(await b.svc.stopTokens("tok-0009"))).toBe("E_ACCOUNT_BAD_ACTION");
    // a row that would widen it is not taken back: active from stopped is refused by the restore's rule
    const widened = applyTokenSnapshot(b.engine.state, { id: "tok-0001", status: "active", mintedMicro: 0, usesMade: 0, uses: [] });
    expect(widened.tokens.find((t) => t.id === "tok-0001")!.status).toBe("stopped");
    // a signed revocation closes it; revoking twice is refused
    expect(code(await b.own({ type: "revokeSpendToken", token: "tok-0001", reason: "done with it" }))).toBe("account");
    expect(b.token("tok-0001")).toMatchObject({ status: "revoked", reason: "done with it" });
    expect(b.token("tok-0001").revokeConfirmed).toBeDefined();
    expect(code(await b.own({ type: "revokeSpendToken", token: "tok-0001", reason: "" }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.ag(USE()))).toBe("E_MANDATE_NONE");
    // Stop all: the standing one, and the ended one left as it is
    expect(await b.svc.stopTokens("*")).toEqual({ ok: true, stopped: ["tok-0002"], already: [] });
    expect(b.engine.state.tokens.map((t) => t.status)).toEqual(["revoked", "stopped"]);
    const outcomes = b.rows().filter((x) => x.kind === "token" && x.intentId === "tok-0001").map((x) => x.outcome);
    expect(outcomes).toEqual(["issuing", "active", "stopped", "revoke-sent", "revoke-confirmed"]);
  });

  it("the watch ends what has ended: past its time → expired (a use before the watch is refused as expired too); its key revoked → revoked; its venue disconnected → revoked; used up → used", async () => {
    const b = await boot();
    ok(await letIn(b));
    ok(await letIn(b, other, "Other"));
    ok(await b.own({ type: "setPolicy", change: "mode", value: "open" }));
    ok(await b.prepared({ ...ISSUE({ validUntil: START + HOUR }) } as Record<string, unknown>));
    ok(await b.prepared({ ...ISSUE({ agent: other.address, purpose: "the other's" }) } as Record<string, unknown>));
    ok(await b.prepared({ ...ISSUE({ rail: "venue:real", instrument: "real", env: "live", maxAmount: "90", perUseMax: "90", purpose: "real money, small" }) } as Record<string, unknown>));
    expect(b.engine.state.tokens.map((t) => [t.id, t.status, t.env])).toEqual([["tok-0001", "active", "test"], ["tok-0002", "active", "test"], ["tok-0003", "active", "live"]]);
    expect((await b.svc.accountView())!.tokens.find((t) => t.id === "tok-0003")!.honesty).toEqual({ tier: "account", text: "The Account alone holds this limit" });
    // the live token's use at the real venue is still under the server's cap
    expect(code(await b.ag(USE({ token: "tok-0003", amount: "90", request: JSON.stringify({ symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "3000", qty: "0.05" }) })))).toBe("E_ACCOUNT_LIMIT");
    // an hour on: the first token lapses; a use is refused before the watch moves it, and the page says so
    b.tick(HOUR + 1);
    expect(code(await b.ag(USE()))).toBe("E_MANDATE_EXPIRED");
    expect((await b.svc.accountView())!.tokens.find((t) => t.id === "tok-0001")).toMatchObject({ status: "active", lapsed: true });
    await b.svc.tickTokens();
    expect(b.token("tok-0001").status).toBe("expired");
    // the other's key revoked: its token ends with it, on the record first
    ok(await b.own({ type: "approveAgent", agentAddress: ZERO, agentName: "Other", validUntil: 0 }));
    expect(b.token("tok-0002")).toMatchObject({ status: "revoked", reason: 'its agent key "Other" was revoked' });
    // the real venue disconnected: its token ends
    ok(await b.own({ type: "disconnectVenue", venue: "real" }));
    expect(b.token("tok-0003")).toMatchObject({ status: "revoked", reason: "Real Ex was disconnected" });
    expect(code(await b.ag(USE({ token: "tok-0003" })))).toBe("E_MANDATE_NONE");
    // used up by the amount: a token of one use, used, is used
    ok(await b.prepared({ ...ISSUE({ uses: 1, validUntil: START + 7 * DAY }) } as Record<string, unknown>));
    ok(await b.ag(USE({ token: "tok-0004" })));
    expect(b.token("tok-0004").status).toBe("used");
    const outcomes = b.rows().filter((x) => x.kind === "token").map((x) => [x.intentId, x.outcome]);
    expect(outcomes).toContainEqual(["tok-0001", "expired"]);
    expect(outcomes).toContainEqual(["tok-0002", "revoke-sent"]);
    expect(outcomes).toContainEqual(["tok-0002", "revoke-confirmed"]);
    expect(outcomes).toContainEqual(["tok-0003", "revoke-confirmed"]);
    expect(outcomes).toContainEqual(["tok-0004", "used"]);
  });

  it("the token is one more thing the owner only signs: an agent key cannot issue, stop or revoke one; a key not let in, an expired key, a secret in the purpose, a venue not on the account are refused before anything is kept", async () => {
    const b = await boot();
    ok(await letIn(b));
    // an agent key signing the owner's typed data: refused as the owner's to sign
    expect(code(await b.svc.exchange(await signOwner(cc, { ...ISSUE(), nonce: b.nonce() } as OwnerAction)))).toBe("E_ACCOUNT_OWNER_ONLY");
    expect(code(await b.svc.exchange(await signOwner(cc, { type: "revokeSpendToken", token: "tok-0001", reason: "", nonce: b.nonce() })))).toBe("E_ACCOUNT_OWNER_ONLY");
    expect(code(await b.own({ ...ISSUE({ agent: other.address }) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.own({ ...ISSUE({ instrument: "nowhere", rail: "venue:nowhere", env: "live" }) }))).toBe("E_WALLET_ACCOUNT_UNKNOWN");
    expect(code(await b.own({ ...ISSUE({ rail: "venue:paper", env: "live" }) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.own({ ...ISSUE({ purpose: "the key is sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" }) }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await b.own({ ...ISSUE({ rail: "chain:x402", instrument: "ops", counterparty: "https://api.example.com", currency: "USDC", env: "live" }) }))).toBe("E_WALLET_ACCOUNT_UNKNOWN");
    expect(b.engine.state.tokens).toEqual([]);
    // nothing was taken: the ledger has no token row
    expect(b.rows().filter((x) => x.kind === "token")).toEqual([]);
  });
});

describe("after a restart", () => {
  it("brings the tokens back from their signed issues and their rows, in order: status, counters, uses; a stopped one stays stopped, a revoked one revoked, a use left waiting on a card comes back not-used; the ids continue", async () => {
    const a = await boot();
    ok(await letIn(a));
    ok(await a.prepared({ ...ISSUE({ uses: 3 }) } as Record<string, unknown>));
    ok(await a.prepared({ ...ISSUE({ purpose: "stopped one" }) } as Record<string, unknown>));
    ok(await a.prepared({ ...ISSUE({ purpose: "revoked one" }) } as Record<string, unknown>));
    ok(await a.prepared({ ...ISSUE({ purpose: "with a card waiting" }) } as Record<string, unknown>));
    ok(await a.own({ type: "setPolicy", change: "mode", value: "open" }));
    ok(await a.ag(USE()));
    ok(await a.svc.stopTokens("tok-0002"));
    ok(await a.own({ type: "revokeSpendToken", token: "tok-0003", reason: "" }));
    // Guard again (tightening: no signature), so the next use waits on a card
    a.svc.setMode("guard");
    const asked = await a.ag(USE({ token: "tok-0004" }));
    expect(code(asked)).toBe("card");
    const was = a.token("tok-0001");
    expect(was).toMatchObject({ usesMade: 1 });
    expect(was.mintedMicro).toBeGreaterThan(0);

    const b = await boot({ home: a.home, nonceFrom: 50, at: HOUR, connect: false });
    // three stand: the two active ones and the stopped one; the revoked one is over
    expect(b.svc.restored).toMatchObject({ state: "done", agents: 1, limits: 0, tokens: 3 });
    const back = b.engine.state.tokens;
    expect(back.map((t) => [t.id, t.status])).toEqual([["tok-0001", "active"], ["tok-0002", "stopped"], ["tok-0003", "revoked"], ["tok-0004", "active"]]);
    expect(back[0]).toMatchObject({ mintedMicro: was.mintedMicro, usesMade: 1, reservedMicro: 0, uses: 3, purpose: "rehearse small ETH buys" });
    expect(back[0]!.usesList.map((u) => [u.id, u.status, u.ref])).toEqual([["tok-0001/1", "executed", "ord-0001"]]);
    // the card is not brought back, so the use that waited on it is not-used, and holds nothing
    expect(back[3]!.usesList.map((u) => [u.id, u.status])).toEqual([["tok-0004/1", "not-used"]]);
    expect(back[3]!.reservedMicro).toBe(0);
    expect(b.engine.state.tokenSeq).toBe(4);
    // the account goes on: a use of the first token, a fifth token
    ok(await b.own({ type: "setPolicy", change: "mode", value: "open" }));
    ok(await b.ag(USE()));
    expect(b.token("tok-0001").usesMade).toBe(2);
    ok(await b.prepared({ ...ISSUE({ purpose: "fifth" }) } as Record<string, unknown>));
    expect(b.engine.state.tokens.at(-1)!.id).toBe("tok-0005");
    expect(code(await b.ag(USE({ token: "tok-0002" })))).toBe("E_MANDATE_NONE");
    expect(code(await b.ag(USE({ token: "tok-0003" })))).toBe("E_MANDATE_NONE");
  });
});

describe("the whole chain on the account's own paper account (live:paper)", () => {
  it("the agent asks for a token; the owner issues it, which answers the ask; the agent uses it (a card in Guard, the owner's yes places the order); the agent says done; a restart keeps the token and its counters", async () => {
    const btc: Listing = { symbol: "BTC/USD", name: "BTC market", kind: "spot", base: "BTC", quote: "USD", price: 60000, bid: 59990, ask: 60010, open: true, types: [], volumeUsd24h: 2e9 };
    const kraken: PublicSource = { id: "kraken", name: "Kraken", kind: "exchange", connectTo: "kraken", connector: "live:exchange:kraken", listings: async (q) => [btc].filter((m) => !q.q || m.base.includes(q.q.toUpperCase())) };
    const a = await boot({ sources: [kraken], connect: false });
    ok(await a.own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" }));
    ok(await letIn(a));
    // 1 · the agent asks, naming the paper account and what it would trade; the owner sees it waiting, with the counterparty proposed
    const asked = ok(await a.ag({ type: "agentAsk", kind: "token", venue: "paper-1", usd: "300", text: "rehearse a BTC buy", counterparty: "*" }));
    expect(asked.kind).toBe("result");
    expect((await a.svc.accountView())!.asks.map((x) => [x.kind, x.venue, x.counterparty, x.usd])).toEqual([["token", "paper-1", "*", "300"]]);
    expect(code(await a.ag({ type: "agentAsk", kind: "limit", venue: "", usd: "", text: "", counterparty: "*" }))).toBe("E_ACCOUNT_BAD_ACTION");
    expect(code(await a.ag({ type: "agentAsk", kind: "token", venue: "paper-1", usd: "", text: "" }))).toBe("E_ACCOUNT_BAD_ACTION");
    // 2 · the owner issues it from the page: prepare, sign exactly the fields shown; the ask closes
    const issue = { type: "issueSpendToken", agent: cc.address, rail: "paper", instrument: "paper-1", counterparty: "*", maxAmount: "300", currency: "USD", perUseMax: "250", uses: 2, validUntil: START + 7 * DAY, atOnce: "", purpose: "rehearse a BTC buy", env: "test" };
    const p = await a.engine.prepare(issue);
    if (isRefusal(p)) throw new Error(p.message);
    expect(p.shown.map((f) => f.name)).toContain("purpose");
    expect(p.accountChain).toBe("Paper · no real money");
    ok(await a.prepared(issue));
    expect((await a.svc.accountView())!.asks).toEqual([]);
    const page = (await a.svc.accountView())!;
    expect(page.tokens[0]).toMatchObject({ id: "tok-0001", status: "active", instrumentName: "Paper account", counterparty: "*", leftUsd: 300, paper: true, testLabel: "Paper · Account paper book" });
    // the agents' read: this key's tokens
    const agents = await a.svc.agents();
    if (isRefusal(agents)) throw new Error(agents.message);
    expect(agents.agents[0]!.tokens.map((t) => t.id)).toEqual(["tok-0001"]);
    // 3 · the agent uses it: Guard, so a card; the owner's yes places a $200 market buy at the public ask, paper money
    const use = await a.ag({ type: "agentUseToken", token: "tok-0001", counterparty: "*", amount: "250", currency: "USD", request: JSON.stringify({ symbol: "BTC/USD", side: "buy", orderType: "market", usd: 200 }) });
    if (isRefusal(use) || use.kind !== "card") throw new Error(`expected a card, got ${code(use)}`);
    const card = a.engine.host.card(use.card.id)!;
    expect(card.reason).toMatch(/^Claude Code asks to PAPER · buy .* BTC at Paper account .* with tok-0001$/);
    const released = ok(await a.own({ type: "approveCard", card: card.id, action: cardHash(card), decision: "approve" }));
    expect(released.kind).toBe("result");
    const order = a.engine.orders.find((o) => o.id === "ord-0001")!;
    expect(order).toMatchObject({ venue: "paper-1", token: "tok-0001", paper: true, status: "filled", avgPrice: 60010, card: card.id });
    const t = a.token("tok-0001");
    expect(t).toMatchObject({ usesMade: 1, reservedMicro: 0 });
    expect(t.mintedMicro / 1e6).toBeCloseTo(order.filledQty * 60010, 0);
    expect(a.svc.statement().find((l) => l.id === "ord-0001")).toMatchObject({ paper: true, token: "tok-0001", by: "Claude Code, with token tok-0001" });
    // 4 · the agent says done
    ok(await a.ag({ type: "agentTokenDone", use: "tok-0001/1" }));
    expect(a.token("tok-0001").usesList[0]!.status).toBe("done");
    // 5 · a restart: the token and its counters, the paper book, the order
    const b = await boot({ home: a.home, sources: [kraken], connect: false, nonceFrom: 50, at: HOUR });
    await b.svc.restoring;
    expect(b.svc.restored).toMatchObject({ state: "done", tokens: 1, venues: [{ venue: "paper-1", ok: true }] });
    expect(b.token("tok-0001")).toMatchObject({ status: "active", usesMade: 1, mintedMicro: t.mintedMicro });
    expect(b.token("tok-0001").usesList.map((u) => [u.id, u.status, u.ref])).toEqual([["tok-0001/1", "done", "ord-0001"]]);
    expect((await b.svc.accountView())!.tokens[0]).toMatchObject({ id: "tok-0001", usesMade: 1, uses: 2, leftUsd: Number(((300_000_000 - t.mintedMicro) / 1e6).toFixed(6)) });
    // the second use in Beast, which uses it up
    ok(await b.own({ type: "setPolicy", change: "mode", value: "open" }));
    const second = ok(await b.ag({ type: "agentUseToken", token: "tok-0001", counterparty: "*", amount: "90", currency: "USD", request: JSON.stringify({ symbol: "BTC/USD", side: "buy", orderType: "market", usd: 60 }) }));
    expect(second.kind).toBe("result");
    expect(b.token("tok-0001").status).toBe("used");
    expect(b.engine.orders.find((o) => o.id === "ord-0002")).toMatchObject({ token: "tok-0001", paper: true, status: "filled" });
  });
});

describe("the three labeling gaps", () => {
  it("an owner's order at a paper account is prepared as paper and signs 'Paper · no real money'; the same at a real venue signs 'Live · real money'; a paper-signed order at a real venue is refused", async () => {
    const b = await boot();
    const paper = await b.engine.prepare({ type: "liveOrder", venue: "paper", symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "2900", qty: "0.01" });
    if (isRefusal(paper)) throw new Error(paper.message);
    expect((paper.action as { paper?: string }).paper).toBe("true");
    expect(paper.accountChain).toBe("Paper · no real money");
    expect(paper.shown.map((f) => f.name)).toContain("paper");
    const real = await b.engine.prepare({ type: "liveOrder", venue: "real", symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "2900", qty: "0.01" });
    if (isRefusal(real)) throw new Error(real.message);
    expect((real.action as { paper?: string }).paper).toBeUndefined();
    expect(real.accountChain).toBe("Live · real money");
    expect(code(await b.prepared({ type: "liveOrder", venue: "paper", symbol: "ETH/USDT:USDT", side: "buy", orderType: "limit", limitPrice: "2900", qty: "0.01" }))).toBe("order");
    const { nonce: _n, ...fields } = real.action;
    expect(code(await b.own({ ...fields, paper: "true" } as NoNonce<OwnerAction>))).toBe("E_ACCOUNT_BAD_ACTION");
    // an order signed without the field at a paper account still goes: the stronger text holds there too
    const { nonce: _m, paper: _p, ...plain } = paper.action as Extract<OwnerAction, { type: "liveOrder" }>;
    expect(code(await b.own(plain as NoNonce<OwnerAction>))).toBe("order");
    // a close and a leverage change prepared at the paper account say paper too
    const close = await b.engine.prepare({ type: "liveClose", venue: "paper", symbol: "ETH/USDT:USDT", qty: "" });
    expect(isRefusal(close) ? close.code : (close.action as { paper?: string }).paper).toBe(isRefusal(close) ? close.code : "true");
  });

  it("an agent's signature says what it signs for: a seat on the real account signs 'real'; one made for the simulation is still taken, and its row says so", async () => {
    const b = await boot();
    ok(await letIn(b));
    const realSigned = await signAgent(cc, { type: "agentAsk", kind: "limit", venue: "", usd: "10", text: "", nonce: b.nonce() }, "real");
    expect(realSigned.source).toBe("real");
    expect(code(await b.svc.exchange(realSigned))).toBe("result");
    const simSigned = await signAgent(cc, { type: "agentAsk", kind: "mode", venue: "", usd: "", text: "", nonce: b.nonce() }, "sim");
    expect(simSigned.source).toBeUndefined();
    expect(code(await b.svc.exchange(simSigned))).toBe("result");
    const taken = b.rows().filter((x) => x.kind === "action" && x.outcome === "taken" && x.tool === "agentAsk");
    expect(taken).toHaveLength(2);
    expect(taken[0]!.reason).not.toMatch(/signed for the simulation/);
    expect(taken[1]!.reason).toMatch(/signed for the simulation, and this account is the real one/);
    expect(taken[1]!.detail).toEqual({ signedFor: "sim" });
    // a signature made for the real account does not recover under the simulation's label: the envelope's word is what verifies it
    expect(code(await b.svc.exchange({ ...realSigned, source: undefined, action: { ...realSigned.action, nonce: b.nonce() } as AgentAction, nonce: 0 }))).not.toBe("result");
  });

  it("the restore's rule for token rows: a status forward only, the counters as the last row says, a use's record forward only, a stop anywhere", () => {
    const s0: AccountState = { ...emptyState(), tokens: [{ id: "tok-0001", agent: cc.address, rail: "paper", instrument: "paper", counterparty: "*", maxMicro: 10e6, currency: "USD", perUseMicro: 5e6, uses: 2, validUntil: START + DAY, atOnce: false, purpose: "x", env: "test", status: "issuing", usage: "proxy", mintedMicro: 0, reservedMicro: 0, usesMade: 0, envelope: { action: { type: "revokeSpendToken", token: "", reason: "", nonce: 0 } as OwnerAction, nonce: 0, signature: { r: "0x", s: "0x", v: 27 } }, at: "", usesList: [] }] };
    const t = (s: AccountState) => s.tokens[0]!;
    const s1 = applyTokenSnapshot(s0, { id: "tok-0001", status: "active", mintedMicro: 0, usesMade: 0, uses: [], providerRef: "paper:paper" });
    expect([t(s1).status, t(s1).providerRef]).toEqual(["active", "paper:paper"]);
    const s2 = applyTokenSnapshot(s1, { id: "tok-0001", status: "active", mintedMicro: 3e6, usesMade: 1, uses: [{ id: "tok-0001/1", n: 1, status: "executed", counterparty: "*", amountMicro: 3e6, action: "0x" as never, at: "", updatedAt: "" }] });
    expect([t(s2).mintedMicro, t(s2).usesMade, t(s2).usesList.length]).toEqual([3e6, 1, 1]);
    // the counters are the row's (an order counted at its worst price settles for less); a use's record only forward
    const s3 = applyTokenSnapshot(s2, { id: "tok-0001", status: "active", mintedMicro: 1e6, usesMade: 1, uses: [{ id: "tok-0001/1", n: 1, status: "minting", counterparty: "*", amountMicro: 3e6, action: "0x" as never, at: "", updatedAt: "" }] });
    expect([t(s3).mintedMicro, t(s3).usesMade, t(s3).usesList[0]!.status]).toEqual([1e6, 1, "executed"]);
    const s4 = applyTokenSnapshot(s3, { id: "tok-0001", status: "stopped", mintedMicro: 3e6, usesMade: 1, uses: [] });
    expect(t(s4).status).toBe("stopped");
    expect(t(applyTokenSnapshot(s4, { id: "tok-0001", status: "active", mintedMicro: 3e6, usesMade: 1, uses: [] })).status).toBe("stopped");
    const s5 = applyTokenSnapshot(s4, { id: "tok-0001", status: "revoked", mintedMicro: 3e6, usesMade: 1, uses: [] });
    expect(t(s5).status).toBe("revoked");
    expect(t(applyTokenSnapshot(s5, { id: "tok-0001", status: "stopped", mintedMicro: 3e6, usesMade: 1, uses: [] })).status).toBe("revoked");
    expect(TOKEN_OPEN.has("revoked")).toBe(false);
    // a row for a token the chain does not hold is nothing
    expect(applyTokenSnapshot(s5, { id: "tok-0009", status: "active", mintedMicro: 0, usesMade: 0, uses: [] })).toEqual(s5);
  });
});
