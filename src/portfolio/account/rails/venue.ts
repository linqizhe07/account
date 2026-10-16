/** The VENUE rail (`venue:<id>`), and the PAPER rail (`paper`) over it: a token's use is an ORDER at the token's instrument — a venue
 * connected live, or the account's own paper account — run through the same door every agent order goes through (account/live-orders.ts
 * agent(): the switch, the market, the size, the price, the server's cap at a real venue, the venue's own answer), with the token standing
 * where the trading limit would: no SpendApproval is read for it. Its markets are the token's counterparty (a list, or `*` on paper); the
 * use's `amount` is the most the order may be worth. Guard: a card, unless the owner signed the token at once; Beast: at once inside the
 * token. The rail holds nothing of its own: the venue has no key that carries a token's lines.
 */
import { isRefusal, type Refusal } from "../../../core/errors.ts";
import { no } from "../../refuse.ts";
import type { AccountEngine, Outcome } from "../exchange.ts";
import { micro, seatOrderAction, type SeatOrder } from "../sign.ts";
import { tokenMarkets, type SpendApproval, type SpendToken } from "../state.ts";
import { HOLDS_NOTHING, type TokenRail, type UseContext } from "./index.ts";

/** the token as the order door reads a limit: its own lines, its own counters, the owner's own signature on it */
export function tokenAsLimit(t: SpendToken): SpendApproval {
  return { id: t.id, agent: t.agent, scope: "trade", allow: [t.instrument], perPaymentMicro: t.perUseMicro, budgetMicro: t.maxMicro, windowHours: 0, validUntil: t.validUntil, spentMicro: t.mintedMicro, reservedMicro: t.reservedMicro, last: {}, payTo: {}, envelope: t.envelope, at: t.at };
}

const ORDER_KEYS = new Set(["symbol", "side", "orderType", "qty", "usd", "limitPrice", "stopPrice", "tif", "postOnly", "reduceOnly", "extendedHours", "trailPercent", "trailPrice", "takeProfit", "stopLoss"]);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+(\.\d{1,12})?$/.test(v.trim()) ? Number(v) : undefined);

/** the order a use's request asks for, at the token's instrument, in the shape a seat's tools take (sign.ts SeatOrder), or what is wrong */
export function orderOfRequest(t: SpendToken, request: unknown): SeatOrder | string {
  const r = request as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || Array.isArray(r)) return "a venue or paper token's use carries the order as `request`: {symbol, side, qty or usd, orderType?, limitPrice?, …}";
  const extra = Object.keys(r).find((k) => !ORDER_KEYS.has(k) && k !== "venue");
  if (extra) return `"${extra}" is not part of an order`;
  if (r.venue !== undefined && r.venue !== t.instrument) return `the token is for ${t.instrument}: an order elsewhere is not its to place`;
  if (typeof r.symbol !== "string" || !r.symbol.trim()) return "the order names its market (symbol)";
  if (r.side !== "buy" && r.side !== "sell") return "the order's side is buy or sell";
  const markets = tokenMarkets(t.counterparty);
  if (markets !== "*" && !markets.includes(r.symbol.trim())) return `the token covers ${markets.join(", ")}: ${r.symbol.trim()} is not one of its markets`;
  const type = r.orderType === undefined ? "market" : r.orderType;
  if (!["market", "limit", "stop", "stop_limit", "trailing_stop"].includes(String(type))) return "an order is a market, limit, stop, stop_limit or trailing_stop order";
  const bools = ["postOnly", "reduceOnly", "extendedHours"] as const;
  for (const k of bools) if (r[k] !== undefined && typeof r[k] !== "boolean") return `${k} is true or false`;
  const nums = ["qty", "usd", "limitPrice", "stopPrice", "trailPercent", "trailPrice", "takeProfit", "stopLoss"] as const;
  for (const k of nums) if (r[k] !== undefined && num(r[k]) === undefined) return `${k} is a number`;
  if (r.tif !== undefined && !["gtc", "ioc", "fok", "day"].includes(String(r.tif))) return "a time in force is gtc, ioc, fok or day";
  const pick = (k: (typeof nums)[number]) => (r[k] !== undefined ? { [k]: num(r[k]) } : {});
  return { venue: t.instrument, symbol: r.symbol.trim(), side: r.side, orderType: type as SeatOrder["orderType"], ...pick("qty"), ...pick("usd"), ...pick("limitPrice"), ...pick("stopPrice"), ...pick("trailPercent"), ...pick("trailPrice"), ...pick("takeProfit"), ...pick("stopLoss"), ...(r.tif !== undefined ? { tif: r.tif as SeatOrder["tif"] } : {}), ...(r.postOnly === true ? { postOnly: true } : {}), ...(r.reduceOnly === true ? { reduceOnly: true } : {}), ...(r.extendedHours === true ? { extendedHours: true } : {}) };
}

export function venueRail(e: AccountEngine, kind: "venue" | "paper"): TokenRail {
  const money = () => e.host.liveMoney?.();
  const venueOf = (t: SpendToken) => money()?.venue(t.instrument);
  return {
    kind,
    usage: "proxy",
    enforces: HOLDS_NOTHING,
    name: (t) => venueOf(t)?.name ?? t.instrument,
    testLabel: (t) => (kind === "paper" ? "Paper · Account paper book" : `Test · ${venueOf(t)?.name ?? t.instrument} · the venue's test environment, no real money`),
    ready(t) {
      const m = money();
      if (!m) return no("E_ACCOUNT_BAD_ACTION", { message: "this account has no venues connected live" });
      const v = m.venue(t.instrument);
      if (!v) return no("E_WALLET_ACCOUNT_UNKNOWN", { venue: t.instrument, message: `"${t.instrument}" is not a venue connected live: the token's instrument is not on the account` });
      if (kind === "paper" && v.paper !== true) return no("E_ACCOUNT_BAD_ACTION", { venue: v.id, message: `${v.name} is real money: a paper token is for a paper account` });
      if ((v.paper === true) !== (t.env === "test")) return no("E_ACCOUNT_BAD_ACTION", { venue: v.id, message: v.paper ? `${v.name} is a paper account: a token for it is a test token` : `${v.name} is real money: a token for it is a live token` });
      if (!v.trader) return no("E_VENUE_RAIL_CLOSED", { venue: v.id, message: `${v.name}: ${v.noTradeBecause ?? "no orders are placed here from the account"}` });
      if (e.host.policy().revoked.includes(v.id)) return no("E_WALLET_ACCOUNT_REVOKED", { venue: v.id, message: `${v.name} is switched off for agents: reads only`, detail: { revoked: e.host.policy().revoked } });
      return null;
    },
    async issue(t) {
      const r = this.ready(t);
      return r ?? { providerRef: `${kind}:${t.instrument}` };
    },
    async use(ctx) {
      const t = ctx.token;
      const o = orderOfRequest(t, ctx.request);
      if (typeof o === "string") return no("E_ACCOUNT_BAD_ACTION", { message: o });
      const action = seatOrderAction(o);
      if (typeof action === "string") return no("E_ACCOUNT_BAD_ACTION", { message: action });
      const order = { ...action, nonce: ctx.action.nonce };
      // the token as the door's limit: what this use itself holds while it runs (minting) is not held against it — a card's own hold, or
      // the order's count, takes its place through the door
      const limit = { ...tokenAsLimit(t), reservedMicro: Math.max(0, t.reservedMicro - (ctx.released ? 0 : ctx.use.amountMicro)) };
      const opts = { limit, token: t.id, atOnce: ctx.atOnce, worthMicro: ctx.use.amountMicro, cardAction: ctx.action, order };
      return ctx.released ? e.trade.release(ctx.released, { signer: ctx.who.signer, agent: ctx.who.agent }, opts) : e.trade.agent(order, ctx.who, opts);
    },
    async read(t) {
      // the venue keeps no count of its own for a token: what the account counted is the count
      return { spentMicro: t.mintedMicro, status: "active" };
    },
    async revoke() {
      return { ok: true };
    },
  };
}

/** a use's outcome as the agent reads it: what the order became */
export const orderRef = (out: Outcome): { ref?: string | undefined; id?: string | undefined } => (isRefusal(out) || out.kind !== "order" ? {} : { id: out.order.id, ...(out.order.ref ? { ref: out.order.ref } : {}) });

export const isRefusalOf = (x: unknown): x is Refusal => isRefusal(x);
export { micro };
