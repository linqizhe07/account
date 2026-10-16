/** THE RAILS a spend token runs on (account/tokens.ts): one issuer adapter per rail, behind one interface.
 *
 * A rail is where a token's authority is held and used: the account's own paper account, a venue connected live, paying over x402 from
 * an agent wallet. Each adapter answers four calls — issue, use, read, revoke — and says in one constant (`enforces`) which of the four
 * lines of a token the rail itself holds: the amount, the counterparty, the expiry, the revocation (and whether a use is single-use). The
 * page's honesty label is made from that constant and nothing else (`honestyOf`): what a rail does not hold, the Account alone holds.
 *
 * Every rail of this version is PROXY usage: the agent holds the token's id, the account runs the use with the owner's own instrument,
 * and no rail holds any line of its own — so every token here is "The Account alone holds this limit". A rail that holds lines of its
 * own (a chain's delegation, a card network's intent) is a later version's adapter behind the same interface.
 */
import type { Refusal } from "../../../core/errors.ts";
import type { CardLike, Outcome } from "../exchange.ts";
import type { AgentAction, Envelope, Hex } from "../sign.ts";
import type { AgentKey, SpendToken, TokenRailKind, TokenUse } from "../state.ts";

export type AgentUseTokenAction = Extract<AgentAction, { type: "agentUseToken" }>;

/** which lines of a token the rail itself enforces: an agent cannot pass what the rail holds, whatever the account does */
export interface RailEnforces {
  amount: boolean;
  counterparty: boolean;
  expiry: boolean;
  revoke: boolean;
  singleUse: boolean;
}

/** what one use brings to a rail */
export interface UseContext {
  token: SpendToken;
  /** the use's record, written (minting) before the rail is called */
  use: TokenUse;
  action: AgentUseTokenAction;
  /** the use's `request`, parsed (undefined when none was given) */
  request: unknown;
  who: { signer: string; agent: AgentKey; envelope: Envelope; hash: Hex };
  /** the card the owner answered, when the use is released by one */
  released?: CardLike | undefined;
  /** the use goes without a card: Beast, or the owner signed the token at once */
  atOnce: boolean;
}

export interface TokenRail {
  kind: TokenRailKind;
  /** a name for the rail in a sentence: "the paper account", "OKX", "x402" */
  name(token: SpendToken): string;
  usage: "proxy";
  enforces: RailEnforces;
  /** the words a test token on this rail carries on every row: whose test environment, why it is not real money */
  testLabel(token: SpendToken): string;
  /** the instrument stands on the account, the environment matches, nothing is closed to this agent: asked before the token is issued
   * and before every use (the account's check 5) */
  ready(token: SpendToken): Refusal | null;
  /** mint the token at the rail: here, nothing to mint — the instrument's id is the reference */
  issue(token: SpendToken): Promise<{ providerRef: string } | Refusal>;
  /** run one use with the owner's instrument */
  use(ctx: UseContext): Promise<Outcome>;
  /** what the rail says the token has spent, and whether it still stands there (these rails keep nothing: the account's own count) */
  read(token: SpendToken): Promise<{ spentMicro?: number | undefined; status?: "active" | "revoked" | undefined } | Refusal>;
  /** close the token at the rail: nothing to close here, so it is closed by answering so */
  revoke(token: SpendToken): Promise<{ ok: true } | Refusal>;
}

/** the honesty label every token carries, from the rail's own constant: which lines someone other than the Account holds */
export type HonestyTier = "rail" | "balance" | "account";
export interface Honesty {
  tier: HonestyTier;
  text: string;
}
export const ACCOUNT_ONLY = "The Account alone holds this limit";

export function honestyOf(rail: Pick<TokenRail, "enforces"> & { name?: ((t: SpendToken) => string) | undefined }, token: SpendToken): Honesty {
  const e = rail.enforces;
  if (token.env === "live" && e.amount && e.counterparty && e.expiry && e.revoke) return { tier: "rail", text: `Held by ${rail.name?.(token) ?? "the rail"}` };
  if (token.env === "live" && e.counterparty && e.expiry && e.revoke && !e.amount) return { tier: "balance", text: "Venue-locked · the sub-account balance is the cap" };
  return { tier: "account", text: ACCOUNT_ONLY };
}

/** the four lines no rail of this version holds */
export const HOLDS_NOTHING: RailEnforces = { amount: false, counterparty: false, expiry: false, revoke: false, singleUse: false };
