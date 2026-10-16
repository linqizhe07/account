/** The x402 rail (`chain:x402`): a token's use is a PAYMENT to the token's counterparty — an https origin — over x402 (or an MPP charge),
 * in USDC, from the agent wallet that is the token's instrument, signed by the account with that wallet's key (account/pay-real.ts) as
 * every agent payment is. The token stands where the payees limit would: no SpendApproval is read for it, and the agent wallet's own
 * float figure (which a real account never enforced) is not read either — the token's amount is the line. The chain holds one payment's
 * `to`, `value`, `validBefore` and nonce (EIP-3009) and nothing standing: the rail holds none of the token's lines.
 */
import { no } from "../../refuse.ts";
import { agentWalletVenue } from "../../live/agent-wallet.ts";
import type { AccountEngine, PayAction } from "../exchange.ts";
import type { SpendToken } from "../state.ts";
import { HOLDS_NOTHING, type TokenRail } from "./index.ts";

const MAX_BODY = 64_000;

/** what a use's request asks to pay for: the URL (at the token's origin), how it is asked, a POST's body */
export function payOfRequest(t: SpendToken, request: unknown): { url: string; method?: string | undefined; body?: string | undefined; contentType?: string | undefined } | string {
  const r = request as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || Array.isArray(r)) return "an x402 token's use carries what is paid for as `request`: {url, method?, body?, contentType?}";
  const extra = Object.keys(r).find((k) => !["url", "method", "body", "contentType"].includes(k));
  if (extra) return `"${extra}" is not part of a payment`;
  if (typeof r.url !== "string") return "the request names the URL of what is being paid for";
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return "the request's url is not a URL";
  }
  if (u.origin !== t.counterparty) return `the token pays ${t.counterparty}: ${u.origin} is another payee`;
  if (r.method !== undefined && r.method !== "GET" && r.method !== "POST") return "a payment asks with GET or POST";
  if (r.body !== undefined && (typeof r.body !== "string" || r.body.length > MAX_BODY)) return `a body is text, at most ${MAX_BODY / 1000} kB`;
  if (r.contentType !== undefined && (typeof r.contentType !== "string" || r.contentType.length > 100)) return "a content type is a short text";
  return { url: r.url, ...(r.method ? { method: r.method as string } : {}), ...(r.body !== undefined ? { body: r.body as string } : {}), ...(r.contentType ? { contentType: r.contentType as string } : {}) };
}

export function x402Rail(e: AccountEngine): TokenRail {
  return {
    kind: "chain:x402",
    usage: "proxy",
    enforces: HOLDS_NOTHING,
    name: () => "x402",
    testLabel: () => "Test · no network holds this limit; only the Account does",
    ready(t) {
      const sub = e.sub(t.instrument);
      if (!sub) return no("E_WALLET_ACCOUNT_UNKNOWN", { message: `there is no agent wallet "${t.instrument}": the token's instrument is not on the account` });
      if (sub.agent !== t.agent) return no("E_ACCOUNT_SOURCE", { message: `the agent wallet "${sub.name}" belongs to another agent key`, detail: { subAccount: sub.name } });
      if (!e.tokenPayer()?.payWithToken) return no("E_PAYEE_UNSUPPORTED", { message: "this account pays no one with real money: nothing is paid with a token" });
      if (e.host.policy().revoked.includes(agentWalletVenue(sub.name))) return no("E_WALLET_ACCOUNT_REVOKED", { venue: agentWalletVenue(sub.name), message: `the agent wallet "${sub.name}" is switched off for agents` });
      return null;
    },
    async issue(t) {
      const r = this.ready(t);
      return r ?? { providerRef: `agent-wallet:${t.instrument}` };
    },
    async use(ctx) {
      const t = ctx.token;
      const p = payOfRequest(t, ctx.request);
      if (typeof p === "string") return no("E_ACCOUNT_BAD_ACTION", { message: p });
      const payer = e.tokenPayer();
      if (!payer?.payWithToken) return no("E_PAYEE_UNSUPPORTED", { message: "this account pays no one with real money: nothing is paid with a token" });
      const action: PayAction = { type: "agentPay", url: p.url, maxAmount: (ctx.use.amountMicro / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""), fromSubAccount: t.instrument, ...(p.method && p.method !== "GET" ? { method: p.method } : {}), ...(p.body !== undefined ? { body: p.body } : {}), ...(p.contentType ? { contentType: p.contentType } : {}), nonce: ctx.action.nonce };
      return payer.payWithToken(action, { signer: ctx.who.signer, agent: ctx.who.agent, envelope: ctx.who.envelope, hash: ctx.who.hash }, { token: t, use: ctx.use, atOnce: ctx.atOnce, cardAction: ctx.action }, ctx.released);
    },
    async read(t) {
      return { spentMicro: t.mintedMicro, status: "active" };
    },
    async revoke() {
      return { ok: true };
    },
  };
}
