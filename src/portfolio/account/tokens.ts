/** SPEND TOKENS: one authorisation the owner signs for one agent, on one rail, backed by one instrument of the owner's — the account's
 * own authorisation primitive, as the design doc 《Agent 支付的 token 化》 lays it out. The agent holds the token's ID and nothing else
 * (every rail of this version is proxy usage: the account runs the use with the owner's instrument); the token holds its own lines
 * (a counterparty, an amount, a most-per-use, a count of uses, an expiry) and its own end, apart from the standing limits (SpendApproval),
 * which a use never reads.
 *
 * The state machine (one for every rail):
 *
 *   issuing ──issue()──▶ active ──┬── used        the amount or the uses are used up (the last use, or the watch)
 *      │                          ├── expired     validUntil passed (the watch)
 *      └─▶ verify (a rail that    ├── stopped     the free stop: the page's Stop all tokens, POST /api/account/tokens/stop — only tightens,
 *          needs the owner's      │               and waits for a signed revocation to close the rail's side (none of these rails has one)
 *          own ceremony; none     └── revoking ──revoke()──▶ revoked   the owner's signed revokeSpendToken, the agent key ending, the
 *          of this version's)                                           instrument leaving the account: on the record first, the rail asked after
 *
 *   each use: minting (its amount held) ──▶ executed (a proxy use ran) ──▶ done (the agent's word) · settled (the rail's)
 *                                        └─▶ not-used (refused after the hold, or its card closed unanswered)
 *
 * Statuses move only here — in the door's serial line (a use, an issue, a revoke, a stop) and in the watch (tick, run from the server's
 * clock) — never in a read: a page read shows a token past its time as `lapsed` and leaves it to the watch. Every move is a ledger row of
 * kind "token" carrying the token's counters, which a restarted account reads back in order (account/restore.ts applyTokenSnapshot): a row
 * may tighten a token (stop, end) and never widen one. No row ever carries a credential.
 *
 * The order of checks before a rail is asked (the doc's §8), after the door's own (the shape, the signature, the key, the replay, the
 * nonce, the ten minutes, the taken row):
 *   2  the token is this agent's (not, and none: the same answer, E_MANDATE_NONE)
 *   3  it is active (waiting for the rail: E_MANDATE_NONE · used: E_MANDATE_BUDGET · past its time: E_MANDATE_EXPIRED · stopped, ending: E_MANDATE_NONE)
 *   4  the owner's signature on it still checks out against the owners now, field by field
 *   5  the agents' session stands; the rail is not shut to this agent; the instrument is on the account and its environment matches
 *   6  the counterparty the agent names is the token's, exactly (E_MANDATE_RECIPIENT)
 *   7  the currency is the token's; the amount is inside the most-per-use and what is left; a use is left (E_MANDATE_PER_ORDER_CAP, E_MANDATE_BUDGET)
 *   8  the rail is ready
 *   9  the use's record is written (minting, its amount held) — then the rail is asked, and only then
 *
 * Guard: a use waits for the owner on a card, unless the owner signed the token at once (`atOnce`); Beast: at once inside the token. The
 * server's cap still bounds every use of this version's tokens (the Account alone holds their lines), as it bounds every order.
 */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { isExpired } from "../openness.ts";
import { agentWalletVenue } from "../live/agent-wallet.ts";
import { memoryProblem } from "./memory.ts";
import type { AccountEngine, CardLike, Outcome } from "./exchange.ts";
import { micro, signerOf, unmicro, type Envelope, type Hex, type OwnerAction } from "./sign.ts";
import { agentStatus, applyOwner, deviceKeys, isOwner, railKindOf, tokenLeftMicro, TOKEN_OPEN, tokenProblem, USE_OPEN, type AccountState, type AgentKey, type SpendToken, type TokenStatus, type TokenUse, type UseStatus } from "./state.ts";
import { honestyOf, type AgentUseTokenAction, type Honesty, type TokenRail } from "./rails/index.ts";
import { paperRail } from "./rails/paper.ts";
import { tokenAsLimit, venueRail } from "./rails/venue.ts";
import { x402Rail } from "./rails/x402.ts";

export type RevokeTokenAction = Extract<OwnerAction, { type: "revokeSpendToken" }>;
type DoneAction = { use: string };

const MAX_REQUEST = 64_000;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const usd = (m: number) => `$${(m / 1e6).toFixed(2)}`;

/** what a token row carries: the token as the account counts it, never its signed envelope (that is on the issue's own row) */
export interface TokenSnapshot {
  id: string;
  status: TokenStatus;
  mintedMicro: number;
  usesMade: number;
  providerRef?: string | undefined;
  providerSpentMicro?: number | undefined;
  readAt?: string | undefined;
  revokedAt?: string | undefined;
  revokeConfirmed?: string | undefined;
  stoppedAt?: string | undefined;
  reason?: string | undefined;
  uses: TokenUse[];
}

/** a token as the page, the agents' read and the statement see it */
export interface TokenView {
  id: string;
  agent: string;
  agentName: string;
  rail: string;
  railKind: string;
  instrument: string;
  instrumentName: string;
  counterparty: string;
  currency: string;
  maxUsd: number;
  perUseUsd: number;
  mintedUsd: number;
  reservedUsd: number;
  leftUsd: number;
  /** 0: as many as the amount allows */
  uses: number;
  usesMade: number;
  /** uses still open (a card waiting) */
  usesOpen: number;
  validUntil: string;
  atOnce: boolean;
  purpose: string;
  env: "test" | "live";
  status: TokenStatus;
  /** past its time, and the watch has not moved it yet: shown as ended */
  lapsed: boolean;
  usage: "proxy" | "credential";
  honesty: Honesty;
  /** a test token's label: whose test environment, why it is not real money */
  testLabel?: string | undefined;
  paper?: true | undefined;
  at: string;
  revokedAt?: string | undefined;
  stoppedAt?: string | undefined;
  revokeConfirmed?: string | undefined;
  reason?: string | undefined;
  usesList: TokenUse[];
}

/** how far along a status is: a row may move a token forward (tighten, end) and never back */
const RANK: Record<TokenStatus, number> = { issuing: 0, verify: 1, active: 2, stopped: 3, revoking: 3, used: 4, expired: 4, revoked: 5 };
const USE_RANK: Record<UseStatus, number> = { minting: 0, minted: 1, executed: 1, done: 2, settled: 2, "not-used": 2 };

/** A token's row read back after a restart (account/restore.ts): applied to the token as it stands then, in the row's own place in the
 * ledger's order. It may stop a token (anywhere: a stop needs no signature), confirm one the rail answered (issuing · verify → active), or
 * end one (used · expired · revoked, revoking); it may never make a stopped, ending or ended token active again. The counters are the
 * row's, as a limit's are its last spend row's (an order counted at its worst price settles for less: the last row says so); a use's
 * record only moves forward. A row for a token the chain does not hold is nothing */
export function applyTokenSnapshot(s: AccountState, snap: TokenSnapshot): AccountState {
  const t = s.tokens.find((x) => x.id === snap.id);
  if (!t) return s;
  const from = t.status;
  const to = snap.status;
  const forward = RANK[to] > RANK[from] || (to === "active" && (from === "issuing" || from === "verify")) || (to === "verify" && from === "issuing");
  const same = to === from;
  if (!forward && !same) return s;
  if (!TOKEN_OPEN.has(from) && !same) return s;
  const uses = new Map(t.usesList.map((u) => [u.id, u]));
  for (const u of snap.uses ?? []) {
    const was = uses.get(u.id);
    if (!was || USE_RANK[u.status] >= USE_RANK[was.status]) uses.set(u.id, { ...u });
  }
  const next: SpendToken = {
    ...t,
    status: to,
    mintedMicro: Math.max(0, Number(snap.mintedMicro) || 0),
    usesMade: Math.max(0, Number(snap.usesMade) || 0),
    usesList: [...uses.values()].sort((a, b) => a.n - b.n),
    ...(snap.providerRef !== undefined ? { providerRef: snap.providerRef } : {}),
    ...(snap.providerSpentMicro !== undefined ? { providerSpentMicro: snap.providerSpentMicro } : {}),
    ...(snap.readAt !== undefined ? { readAt: snap.readAt } : {}),
    ...(snap.revokedAt !== undefined ? { revokedAt: snap.revokedAt } : {}),
    ...(snap.revokeConfirmed !== undefined ? { revokeConfirmed: snap.revokeConfirmed } : {}),
    ...(snap.stoppedAt !== undefined ? { stoppedAt: snap.stoppedAt } : {}),
    ...(snap.reason !== undefined ? { reason: snap.reason } : {}),
  };
  return { ...s, tokens: s.tokens.map((x) => (x === t ? next : x)) };
}

/** the token a row carries, when it carries one */
export function tokenSnapshotOf(detail: unknown): TokenSnapshot | undefined {
  const d = detail as Partial<TokenSnapshot> | undefined;
  if (!d || typeof d.id !== "string" || typeof d.status !== "string" || !(d.status in RANK)) return undefined;
  return { id: d.id, status: d.status, mintedMicro: Number(d.mintedMicro) || 0, usesMade: Number(d.usesMade) || 0, uses: Array.isArray(d.uses) ? d.uses.filter((u): u is TokenUse => !!u && typeof u.id === "string" && typeof u.status === "string" && u.status in USE_RANK) : [], ...(typeof d.providerRef === "string" ? { providerRef: d.providerRef } : {}), ...(typeof d.providerSpentMicro === "number" ? { providerSpentMicro: d.providerSpentMicro } : {}), ...(typeof d.readAt === "string" ? { readAt: d.readAt } : {}), ...(typeof d.revokedAt === "string" ? { revokedAt: d.revokedAt } : {}), ...(typeof d.revokeConfirmed === "string" ? { revokeConfirmed: d.revokeConfirmed } : {}), ...(typeof d.stoppedAt === "string" ? { stoppedAt: d.stoppedAt } : {}), ...(typeof d.reason === "string" ? { reason: d.reason } : {}) };
}

export class SpendTokens {
  private readonly rails: Record<string, TokenRail>;
  constructor(private readonly e: AccountEngine) {
    this.rails = { paper: paperRail(e), venue: venueRail(e, "venue"), "chain:x402": x402Rail(e) };
  }

  rail(t: Pick<SpendToken, "rail">): TokenRail | undefined {
    const kind = railKindOf(t.rail);
    return kind ? this.rails[kind] : undefined;
  }

  private now(): number {
    return this.e.nowMs();
  }

  find(id: string): SpendToken | undefined {
    return this.e.state.tokens.find((t) => t.id === id);
  }

  /** the token after a change: the state is replaced, never written in place */
  private patch(id: string, f: (t: SpendToken) => SpendToken): SpendToken {
    let out: SpendToken | undefined;
    this.e.state = { ...this.e.state, tokens: this.e.state.tokens.map((t) => (t.id === id ? (out = f(t)) : t)) };
    return out!;
  }

  private patchUse(id: string, useId: string, f: (u: TokenUse) => TokenUse): SpendToken {
    const at = new Date(this.now()).toISOString();
    return this.patch(id, (t) => ({ ...t, usesList: t.usesList.map((u) => (u.id === useId ? { ...f(u), updatedAt: at } : u)) }));
  }

  snapshot(t: SpendToken): TokenSnapshot {
    return { id: t.id, status: t.status, mintedMicro: t.mintedMicro, usesMade: t.usesMade, ...(t.providerRef !== undefined ? { providerRef: t.providerRef } : {}), ...(t.providerSpentMicro !== undefined ? { providerSpentMicro: t.providerSpentMicro } : {}), ...(t.readAt !== undefined ? { readAt: t.readAt } : {}), ...(t.revokedAt !== undefined ? { revokedAt: t.revokedAt } : {}), ...(t.revokeConfirmed !== undefined ? { revokeConfirmed: t.revokeConfirmed } : {}), ...(t.stoppedAt !== undefined ? { stoppedAt: t.stoppedAt } : {}), ...(t.reason !== undefined ? { reason: t.reason } : {}), uses: t.usesList.map((u) => ({ ...u })) };
  }

  /** the venue a token's rows are filed under: the instrument's venue, or the agent wallet's */
  private venueOf(t: SpendToken): string {
    return railKindOf(t.rail) === "chain:x402" ? agentWalletVenue(t.instrument) : t.instrument;
  }

  /** one row of kind "token": the token's status and counters after a change, in words a person reads; never a credential */
  private log(t: SpendToken, outcome: string, reason: string, extra: { signer?: string | undefined; envelope?: Envelope | undefined; notionalUsd?: number | undefined; intentId?: string | undefined } = {}): void {
    this.e.host.log({ kind: "token", venue: this.venueOf(t), intentId: t.id, tool: "spendToken", outcome, reason: `${t.id} · ${reason}`, agent: slug(this.e.agentName(t.agent)), ...(extra.signer ? { signer: extra.signer } : {}), ...(extra.envelope ? { envelope: extra.envelope } : {}), ...(extra.notionalUsd !== undefined ? { notionalUsd: extra.notionalUsd } : {}), detail: this.snapshot(t) });
  }

  /** a token in words: for the issue's row and the owner's toast */
  words(t: SpendToken): string {
    const rail = this.rail(t);
    const where = rail?.name(t) ?? t.instrument;
    return `${t.env === "test" ? "test " : ""}token for ${this.e.agentName(t.agent)}: ${t.rail === "chain:x402" ? `pay ${t.counterparty} from the agent wallet "${t.instrument}"` : `trade ${t.counterparty === "*" ? "any market" : t.counterparty} at ${where}`} · up to ${unmicro(t.perUseMicro)} ${t.currency} a use · ${unmicro(t.maxMicro)} ${t.currency} in all · ${t.uses === 0 ? "as many uses as that allows" : `${t.uses} ${t.uses === 1 ? "use" : "uses"}`}${t.atOnce ? " · at once, no card" : ""} · until ${new Date(t.validUntil).toISOString().slice(0, 10)} · "${t.purpose}"`;
  }

  // ---- the owner's two actions, and the free stop -------------------------------------------------------------------------------

  /** what would be wrong with issuing this token, before it is shown and signed (the page's prepare) and before it is kept (the door):
   * its own shape, the agent key, the rail's readiness with the instrument as it is now */
  draftProblem(a: Extract<OwnerAction, { type: "issueSpendToken" }>): Refusal | null {
    const now = this.now();
    const wrong = tokenProblem(a, now);
    if (wrong) return no("E_ACCOUNT_BAD_ACTION", { message: wrong });
    // the owner's words on it are words: no key, secret, card number or address rides in them (the memory's own filter)
    const secret = memoryProblem(a.purpose);
    if (secret) return no("E_ACCOUNT_BAD_ACTION", { message: `a token's purpose is words, and this one ${secret}` });
    const agent = a.agent.toLowerCase() as Hex;
    if (agentStatus(this.e.state, agent, now) !== "ok") return no("E_ACCOUNT_BAD_ACTION", { message: "a token is for an agent key that is authorised now" });
    const rail = this.rail(a);
    if (!rail) return no("E_ACCOUNT_BAD_ACTION", { message: `"${a.rail}" is not a rail this account runs` });
    const draft: SpendToken = { id: "tok-draft", agent, rail: a.rail, instrument: a.instrument.trim(), counterparty: a.counterparty.trim(), maxMicro: micro(a.maxAmount), currency: a.currency.trim(), perUseMicro: micro(a.perUseMax), uses: a.uses, validUntil: a.validUntil, atOnce: a.atOnce === "true", purpose: a.purpose.trim(), env: a.env as SpendToken["env"], status: "issuing", usage: "proxy", mintedMicro: 0, reservedMicro: 0, usesMade: 0, envelope: { action: a, nonce: a.nonce, signature: { r: "0x", s: "0x", v: 27 } }, at: new Date(now).toISOString(), usesList: [] };
    return rail.ready(draft);
  }

  /** the owner's signed issue: the rail is asked whether it is ready first (nothing is kept for an instrument that is not there), then the
   * token is kept (state.ts) and the rail asked to issue it; active when it answers */
  async issue(a: Extract<OwnerAction, { type: "issueSpendToken" }>, envelope: Envelope, signer: string): Promise<Outcome> {
    const stop = this.draftProblem(a);
    if (stop) return stop;
    const next = applyOwner(this.e.state, a, envelope, this.now(), [], this.e.applyOptions());
    if (isRefusal(next)) return next;
    this.e.state = next;
    const made = next.tokens.find((t) => t.envelope === envelope)!;
    const summary = `spend ${this.words(made)}`;
    this.e.host.log({ kind: "action", venue: "*", tool: a.type, signer, envelope, outcome: "ok", reason: `${made.id} issued: ${summary}` });
    this.log(made, "issuing", "issued by the owner, the rail asked", { signer });
    const rail = this.rail(made)!;
    const r = await rail.issue(made);
    if (isRefusal(r)) {
      // kept, signed, and the rail would not take it: it ends here, on the record, and the signature is spent
      const ended = this.patch(made.id, (t) => ({ ...t, status: "revoked", revokedAt: new Date(this.now()).toISOString(), revokeConfirmed: new Date(this.now()).toISOString(), reason: `the rail would not issue it: ${r.message}` }));
      this.log(ended, "revoke-confirmed", `not issued: ${r.message}`);
      return r;
    }
    const active = this.patch(made.id, (t) => ({ ...t, status: "active", providerRef: r.providerRef, readAt: new Date(this.now()).toISOString() }));
    this.log(active, "active", `active · ${this.words(active)}`);
    return { ok: true, kind: "result", result: { token: this.viewOf(active, this.now()), summary: `${active.id} issued: ${summary}` } };
  }

  /** the owner's signed revocation: on the record as revoking first, then the rail asked; revoked when it answers (the watch asks again
   * until it does) */
  async revoke(a: RevokeTokenAction, envelope: Envelope, signer: string): Promise<Outcome> {
    const next = applyOwner(this.e.state, a, envelope, this.now(), [], this.e.applyOptions());
    if (isRefusal(next)) return next;
    this.e.state = next;
    const id = a.token.trim();
    const t = this.find(id)!;
    this.e.host.log({ kind: "action", venue: this.venueOf(t), tool: a.type, signer, envelope, outcome: "ok", reason: `${t.id} revoked by the owner${t.reason ? `: ${t.reason}` : ""}` });
    this.log(t, "revoke-sent", `revoking: the owner signed it${t.reason ? ` (${t.reason})` : ""}`, { signer });
    const done = await this.finishRevoke(t.id);
    return { ok: true, kind: "account", summary: `${t.id} ${done ? "revoked" : "revoking: the rail has not answered yet, it is asked again"}` };
  }

  /** the rail's side of a revocation; true once it answered */
  private async finishRevoke(id: string): Promise<boolean> {
    const t = this.find(id);
    if (!t || t.status !== "revoking") return t?.status === "revoked";
    const rail = this.rail(t);
    const r = rail ? await rail.revoke(t).catch((err: unknown) => no("E_VENUE_UNREACHABLE", { message: String((err as Error)?.message ?? err).slice(0, 160) })) : { ok: true as const };
    if (isRefusal(r)) {
      this.log(t, "revoke-sent", `the rail did not confirm the revocation yet: ${r.message}`);
      return false;
    }
    const at = new Date(this.now()).toISOString();
    const ended = this.patch(id, (x) => ({ ...x, status: "revoked", revokeConfirmed: at, revokedAt: x.revokedAt ?? at }));
    this.log(ended, "revoke-confirmed", "revoked: the rail confirmed it");
    return true;
  }

  /** The free stop: one token or every one, only tightening. A stopped token refuses every use from here, and waits for a signed revocation
   * (or the key's or the instrument's end) to close the rail's side too — which, on these rails, the watch does at once. `by` is who asked
   * (the page, a seat): no signature */
  stop(which: string, by = "the page"): { ok: true; stopped: string[]; already: string[] } | Refusal {
    const targets = which === "*" ? this.e.state.tokens.filter((t) => t.status === "issuing" || t.status === "verify" || t.status === "active") : [this.find(which)].filter((t): t is SpendToken => !!t);
    if (which !== "*" && !targets.length) return no("E_ACCOUNT_BAD_ACTION", { message: `there is no spend token "${which.slice(0, 40)}"` });
    const at = new Date(this.now()).toISOString();
    const stopped: string[] = [];
    const already: string[] = [];
    for (const t of targets) {
      if (t.status !== "issuing" && t.status !== "verify" && t.status !== "active") {
        already.push(t.id);
        continue;
      }
      const s = this.patch(t.id, (x) => ({ ...x, status: "stopped", stoppedAt: at, reason: `stopped from ${by}` }));
      this.log(s, "stopped", `stopped from ${by}: every use refused from here; a signed revocation closes it`);
      stopped.push(s.id);
    }
    return { ok: true, stopped, already };
  }

  /** an instrument left the account (a venue disconnected): the tokens on it end, on the record first */
  async instrumentGone(instrument: string, why: string): Promise<void> {
    const at = new Date(this.now()).toISOString();
    for (const t of this.e.state.tokens.filter((x) => x.instrument === instrument && railKindOf(x.rail) !== "chain:x402" && TOKEN_OPEN.has(x.status))) {
      const r = this.patch(t.id, (x) => ({ ...x, status: "revoking", revokedAt: at, reason: why }));
      this.log(r, "revoke-sent", `revoking: ${why}`);
      await this.finishRevoke(t.id);
    }
  }

  /** after an owner action that ended agent keys (approveAgent to the zero address): the tokens state.ts marked revoking get their rows and
   * their rail's answer */
  async afterKeys(before: readonly SpendToken[]): Promise<void> {
    for (const t of this.e.state.tokens) {
      const was = before.find((x) => x.id === t.id);
      if (!was || was.status === t.status || t.status !== "revoking") continue;
      this.log(t, "revoke-sent", `revoking: ${t.reason ?? "its agent key ended"}`);
      await this.finishRevoke(t.id);
    }
  }

  // ---- a use ------------------------------------------------------------------------------------------------------------------------

  /** is the token still the owner's? Its own signed envelope is checked against the account's CURRENT owners, field by field, every time it is used */
  async stillSigned(t: SpendToken): Promise<boolean> {
    const a = t.envelope.action;
    if (a.type !== "issueSpendToken") return false;
    if (a.agent.toLowerCase() !== t.agent || a.rail !== t.rail || a.instrument.trim() !== t.instrument || a.counterparty.trim() !== t.counterparty || micro(a.maxAmount) !== t.maxMicro || a.currency.trim() !== t.currency || micro(a.perUseMax) !== t.perUseMicro || a.uses !== t.uses || a.validUntil !== t.validUntil || (a.atOnce === "true") !== t.atOnce || a.env !== t.env || a.purpose.trim() !== t.purpose) return false;
    const signer = await signerOf(a, t.envelope.signature, deviceKeys(this.e.state));
    return signer !== null && isOwner(this.e.state, signer);
  }

  /** checks 2 to 8: the token this use may run on, or why not */
  private async standing(id: string, who: { signer: string }, a: Pick<AgentUseTokenAction, "counterparty" | "amount" | "currency">, released: boolean): Promise<{ t: SpendToken; rail: TokenRail; amount: number } | Refusal> {
    const now = this.now();
    const t = this.find(id.trim());
    // not this agent's, and none at all: one answer, so a key cannot tell which tokens exist
    if (!t || t.agent !== who.signer) return no("E_MANDATE_NONE", { message: `no spend token "${id.trim().slice(0, 40)}" of this agent's: the owner issues one on the account page (Agents), or portfolio_ask kind token asks for one`, detail: { token: id.trim().slice(0, 40) } });
    if (t.status === "issuing" || t.status === "verify") return no("E_MANDATE_NONE", { message: `${t.id} is not active yet: ${t.status === "verify" ? "it waits for the owner to confirm it at the rail" : "the rail has not confirmed it"}`, detail: { token: t.id, status: t.status } });
    if (t.status === "used") return no("E_MANDATE_BUDGET", { message: `${t.id} is used up: ${usd(t.mintedMicro)} of ${usd(t.maxMicro)} over ${t.usesMade} ${t.usesMade === 1 ? "use" : "uses"}`, detail: { token: t.id, status: t.status } });
    if (t.status === "expired" || now >= t.validUntil) return no("E_MANDATE_EXPIRED", { message: `${t.id} ended on ${new Date(t.validUntil).toISOString()}`, detail: { token: t.id, validUntil: new Date(t.validUntil).toISOString() } });
    if (t.status !== "active") return no("E_MANDATE_NONE", { message: `${t.id} was ${t.status === "stopped" ? "stopped" : "revoked"}${t.reason ? `: ${t.reason}` : ""}; nothing goes on it`, detail: { token: t.id, status: t.status } });
    if (!(await this.stillSigned(t))) return no("E_ACCOUNT_BAD_SIGNATURE", { message: "the token's own signature no longer checks out against the account's owners", detail: { token: t.id } });
    if (isExpired(this.e.host.now(), this.e.host.policy().sessionExpiresAt)) return no("E_WALLET_SESSION_EXPIRED", { message: "the agents' session has ended: every write stops, reads continue", detail: { sessionExpiresAt: this.e.host.policy().sessionExpiresAt } });
    const rail = this.rail(t);
    if (!rail) return no("E_ACCOUNT_BAD_ACTION", { message: `${t.id} is on a rail this account does not run (${t.rail})` });
    const ready = rail.ready(t);
    if (ready) return ready;
    if (a.counterparty !== t.counterparty) return no("E_MANDATE_RECIPIENT", { message: `${t.id} is for ${t.counterparty}, exactly: "${a.counterparty.slice(0, 120)}" is not it`, detail: { token: t.id, counterparty: t.counterparty } });
    if (a.currency !== t.currency) return no("E_ACCOUNT_BAD_ACTION", { message: `${t.id} is in ${t.currency}`, detail: { token: t.id, currency: t.currency } });
    const amount = micro(a.amount);
    if (Number.isNaN(amount) || !(amount > 0)) return no("E_ACCOUNT_BAD_ACTION", { message: "a use's amount is a plain decimal, more than zero" });
    if (amount > t.perUseMicro) return no("E_MANDATE_PER_ORDER_CAP", { message: `a use of ${usd(amount)} is more than the ${usd(t.perUseMicro)} a use ${t.id} allows`, detail: { token: t.id, perUse: t.perUseMicro / 1e6, amount: amount / 1e6 } });
    const left = tokenLeftMicro(t);
    if (amount > left) return no("E_MANDATE_BUDGET", { message: `${t.id} has ${usd(left)} left of ${usd(t.maxMicro)}; ${usd(amount)} is more than that`, detail: { token: t.id, left: left / 1e6, max: t.maxMicro / 1e6, minted: t.mintedMicro / 1e6, reserved: t.reservedMicro / 1e6, amount: amount / 1e6 } });
    // a card waiting counts as a use taken until it is answered (a released one is the use it already holds)
    const open = t.usesList.filter((u) => u.status === "minting").length - (released ? 1 : 0);
    if (t.uses > 0 && t.usesMade + Math.max(0, open) >= t.uses) return no("E_MANDATE_BUDGET", { message: `${t.id} has no use left: ${t.usesMade} of ${t.uses} made${open > 0 ? `, ${open} waiting` : ""}`, detail: { token: t.id, uses: t.uses, usesMade: t.usesMade } });
    return { t, rail, amount };
  }

  /** the use's `request`, parsed; undefined when none */
  private requestOf(a: AgentUseTokenAction): unknown | Refusal {
    if (a.request === undefined || a.request === "") return undefined;
    if (a.request.length > MAX_REQUEST) return no("E_ACCOUNT_BAD_ACTION", { message: `a use's request is at most ${MAX_REQUEST / 1000} kB` });
    try {
      return JSON.parse(a.request) as unknown;
    } catch {
      return no("E_ACCOUNT_BAD_ACTION", { message: "a use's request is JSON" });
    }
  }

  /** An agent's use. Checks 2 to 8, the use's record written with its amount held (9), then the rail */
  async use(a: AgentUseTokenAction, who: { signer: string; agent: AgentKey; envelope: Envelope; hash: Hex }): Promise<Outcome> {
    const s = await this.standing(a.token, who, a, false);
    if (isRefusal(s)) return s;
    const request = this.requestOf(a);
    if (isRefusal(request)) return request;
    const { t, rail, amount } = s;
    const now = this.now();
    const at = new Date(now).toISOString();
    const n = t.usesList.length + 1;
    const use: TokenUse = { id: `${t.id}/${n}`, n, status: "minting", counterparty: a.counterparty, amountMicro: amount, action: who.hash, at, updatedAt: at };
    const held = this.patch(t.id, (x) => ({ ...x, reservedMicro: x.reservedMicro + amount, usesList: [...x.usesList, use] }));
    this.log(held, "minting", `${use.id} · ${usd(amount)} ${t.currency} at ${t.counterparty} · held`, { signer: who.signer, envelope: who.envelope, notionalUsd: amount / 1e6, intentId: use.id });
    const atOnce = this.e.host.policy().mode === "open" || t.atOnce;
    const out = await rail.use({ token: held, use, action: a, request, who, atOnce }).catch((err: unknown) => no("E_VENUE_REJECTED", { message: `the rail answered in a way the account could not read: ${String((err as Error)?.message ?? err).slice(0, 160)}` }));
    return this.after(t.id, use.id, amount, out, who.signer);
  }

  /** the owner answered a use's card: the token judged again as it stands (its hold given back by the door already), the rail asked */
  async release(card: CardLike, who: { signer: string; agent: AgentKey }): Promise<Outcome> {
    const a = card.action as AgentUseTokenAction;
    const s = await this.standing(a.token, who, a, true);
    if (isRefusal(s)) return s;
    const request = this.requestOf(a);
    if (isRefusal(request)) return request;
    const { t, rail, amount } = s;
    const use = t.usesList.find((u) => u.card === card.id && u.status === "minting");
    if (!use) return no("E_ACCOUNT_REQUOTE", { message: "this card's use is not known to this run of the account: the agent uses the token again" });
    const out = await rail.use({ token: t, use, action: a, request, who: { signer: who.signer, agent: who.agent, envelope: t.envelope, hash: card.actionHash ?? use.action }, released: card, atOnce: true }).catch((err: unknown) => no("E_VENUE_REJECTED", { message: `the rail answered in a way the account could not read: ${String((err as Error)?.message ?? err).slice(0, 160)}` }));
    return this.after(t.id, use.id, 0, out, who.signer, amount);
  }

  /** what the rail answered, on the use's record: not-used (refused), still minting (a card), or executed — and the token used up when
   * it is. `heldMicro` is what the use held while the rail ran, given back here; `worthMicro` what the use was for */
  private after(id: string, useId: string, heldMicro: number, out: Outcome, signer: string, worthMicro = heldMicro): Outcome {
    const before = this.find(id)!;
    const give = (x: SpendToken) => ({ ...x, reservedMicro: Math.max(0, x.reservedMicro - heldMicro) });
    if (isRefusal(out)) {
      const t = this.patchUse(id, useId, (u) => ({ ...u, status: "not-used", note: out.message }));
      const freed = this.patch(id, give);
      this.log(freed, "not-used", `${useId} · refused: ${out.message}`, { signer, intentId: useId });
      void t;
      return out;
    }
    if (out.kind === "card") {
      // the card holds the use's worth on the token itself (the door's hold): what minting held is given back
      this.patchUse(id, useId, (u) => ({ ...u, card: out.card.id }));
      const t = this.patch(id, give);
      this.log(t, "minting", `${useId} · waits for the owner on ${out.card.id}`, { signer, intentId: useId });
      return out;
    }
    const ref = out.kind === "order" ? out.order.id : out.kind === "payment" ? out.payment.id : undefined;
    // what the use came to is what the rail counted on the token while it ran
    const executed = Math.max(0, this.find(id)!.mintedMicro - before.mintedMicro);
    this.patchUse(id, useId, (u) => ({ ...u, status: "executed", executedMicro: executed, ...(ref ? { ref } : {}) }));
    const t = this.patch(id, (x) => ({ ...give(x), usesMade: x.usesMade + 1 }));
    const left = tokenLeftMicro(t);
    const open = t.usesList.some((u) => u.status === "minting");
    const exhausted = (t.uses > 0 && t.usesMade >= t.uses) || (left === 0 && !open);
    const ended = exhausted ? this.patch(id, (x) => ({ ...x, status: "used", reason: "used up" })) : t;
    this.log(ended, exhausted ? "used" : "executed", `${useId} · executed${ref ? ` · ${ref}` : ""} · ${usd(executed)} counted · ${usd(tokenLeftMicro(ended))} left${exhausted ? " · used up" : ""}`, { signer, notionalUsd: worthMicro / 1e6, intentId: useId });
    const use = ended.usesList.find((u) => u.id === useId)!;
    return { ok: true, kind: "result", result: { use: { id: use.id, status: use.status, amountUsd: use.amountMicro / 1e6, executedUsd: executed / 1e6, ...(ref ? { ref } : {}) }, token: { id: ended.id, status: ended.status, leftUsd: tokenLeftMicro(ended) / 1e6, usesMade: ended.usesMade, uses: ended.uses }, ...(out.kind === "order" ? { order: out.order } : out.kind === "payment" ? { payment: out.payment, ...("data" in out && out.data !== undefined ? { data: out.data } : {}) } : { outcome: out }) }, ...("flight" in out && out.flight ? { flight: out.flight } : {}) };
  }

  /** the agent says a use is finished: its record closes */
  done(a: DoneAction, who: { signer: string; agent: AgentKey; envelope: Envelope }): Outcome {
    const useId = a.use.trim();
    const t = this.find(useId.split("/")[0] ?? "");
    const use = t?.usesList.find((u) => u.id === useId);
    if (!t || !use || t.agent !== who.signer) return no("E_ACCOUNT_BAD_ACTION", { message: `no use "${useId.slice(0, 40)}" of this agent's`, detail: { use: useId.slice(0, 40) } });
    if (use.status === "minting") return no("E_ACCOUNT_BAD_ACTION", { message: `${use.id} has not run yet${use.card ? ` (it waits on ${use.card})` : ""}: there is nothing to finish`, detail: { use: use.id, status: use.status } });
    if (!USE_OPEN.has(use.status)) return no("E_ACCOUNT_BAD_ACTION", { message: `${use.id} is ${use.status} already`, detail: { use: use.id, status: use.status } });
    const next = this.patchUse(t.id, useId, (u) => ({ ...u, status: "done" }));
    this.log(next, "done", `${useId} · done, the agent says`, { signer: who.signer, envelope: who.envelope, intentId: useId });
    return { ok: true, kind: "account", summary: `${useId} done` };
  }

  /** a use's card closed without running it (expired, rejected): the use is not-used. The door gave the card's hold back already */
  cardClosed(card: CardLike, how: "expired" | "rejected"): void {
    if (card.action?.type !== "agentUseToken") return;
    const t = this.find(card.action.token.trim());
    const use = t?.usesList.find((u) => u.card === card.id && u.status === "minting");
    if (!t || !use) return;
    const next = this.patchUse(t.id, use.id, (u) => ({ ...u, status: "not-used", note: how === "expired" ? "the card expired before it was answered" : "the owner rejected it" }));
    this.log(next, "not-used", `${use.id} · ${how === "expired" ? "its card expired unanswered" : "its card was rejected"}`, { intentId: use.id });
  }

  /** The counters of a token as the order door reads a limit (account/live-orders.ts counts an order on `approval`, through the engine's
   * patchSpend): what a limit calls spent is the token's minted, what it holds is the token's reserved. A change of minted is a row: the
   * use's real cost once the order is done */
  patchAsLimit(id: string, f: (s: ReturnType<typeof tokenAsLimit>) => ReturnType<typeof tokenAsLimit>): void {
    const t = this.find(id);
    if (!t) return;
    const after = f(tokenAsLimit(t));
    const minted = Math.max(0, Math.round(after.spentMicro));
    const reserved = Math.max(0, Math.round(after.reservedMicro));
    if (minted === t.mintedMicro && reserved === t.reservedMicro) return;
    const next = this.patch(id, (x) => ({ ...x, mintedMicro: minted, reservedMicro: reserved }));
    if (minted !== t.mintedMicro) this.log(next, "settled", `${usd(minted)} counted on it now (${minted > t.mintedMicro ? "more" : "less"} than the ${usd(t.mintedMicro)} before) · ${usd(tokenLeftMicro(next))} left`);
  }

  // ---- the watch ----------------------------------------------------------------------------------------------------------------------

  /** The watch: run from the server's clock (service.ts watchTokens), in the door's serial line, never from a read. Ends what has ended:
   * past its time → expired; used up → used; its key ended → revoking; revoking → the rail asked again; issuing → the rail asked again */
  async tick(): Promise<void> {
    const now = this.now();
    const at = new Date(now).toISOString();
    for (const t of [...this.e.state.tokens]) {
      if (!TOKEN_OPEN.has(t.status)) continue;
      const key = agentStatus(this.e.state, t.agent, now);
      if (t.status !== "revoking" && now >= t.validUntil) {
        const x = this.patch(t.id, (y) => ({ ...y, status: "expired", reason: "its time ran out" }));
        this.log(x, "expired", `expired at ${new Date(t.validUntil).toISOString()}`);
        continue;
      }
      if (t.status !== "revoking" && key !== "ok") {
        const x = this.patch(t.id, (y) => ({ ...y, status: "revoking", revokedAt: at, reason: `its agent key ${key === "expired" ? "expired" : "was revoked"}` }));
        this.log(x, "revoke-sent", `revoking: ${x.reason}`);
        await this.finishRevoke(t.id);
        continue;
      }
      if (t.status === "revoking") {
        await this.finishRevoke(t.id);
        continue;
      }
      if (t.status === "active") {
        const open = t.usesList.some((u) => u.status === "minting");
        if (!open && ((t.uses > 0 && t.usesMade >= t.uses) || tokenLeftMicro(t) === 0)) {
          const x = this.patch(t.id, (y) => ({ ...y, status: "used", reason: "used up" }));
          this.log(x, "used", "used up");
        }
        continue;
      }
      if (t.status === "issuing") {
        const rail = this.rail(t);
        const r = rail ? await rail.issue(t).catch((err: unknown) => no("E_VENUE_UNREACHABLE", { message: String((err as Error)?.message ?? err).slice(0, 160) })) : no("E_ACCOUNT_BAD_ACTION", { message: `no rail "${t.rail}"` });
        if (isRefusal(r)) continue;
        const x = this.patch(t.id, (y) => ({ ...y, status: "active", providerRef: r.providerRef, readAt: at }));
        this.log(x, "active", `active · ${this.words(x)}`);
      }
    }
  }

  // ---- what is shown -------------------------------------------------------------------------------------------------------------------

  viewOf(t: SpendToken, now: number): TokenView {
    const rail = this.rail(t);
    const kind = railKindOf(t.rail) ?? "";
    const money = this.e.host.liveMoney?.();
    const venue = kind === "chain:x402" ? undefined : money?.venue(t.instrument);
    const paper = t.env === "test";
    return {
      id: t.id,
      agent: t.agent,
      agentName: this.e.agentName(t.agent),
      rail: t.rail,
      railKind: kind,
      instrument: t.instrument,
      instrumentName: kind === "chain:x402" ? `Agent wallet · ${t.instrument}` : (venue?.name ?? t.instrument),
      counterparty: t.counterparty,
      currency: t.currency,
      maxUsd: t.maxMicro / 1e6,
      perUseUsd: t.perUseMicro / 1e6,
      mintedUsd: t.mintedMicro / 1e6,
      reservedUsd: t.reservedMicro / 1e6,
      leftUsd: tokenLeftMicro(t) / 1e6,
      uses: t.uses,
      usesMade: t.usesMade,
      usesOpen: t.usesList.filter((u) => u.status === "minting").length,
      validUntil: new Date(t.validUntil).toISOString(),
      atOnce: t.atOnce,
      purpose: t.purpose,
      env: t.env,
      status: t.status,
      lapsed: TOKEN_OPEN.has(t.status) && t.status !== "revoking" && now >= t.validUntil,
      usage: t.usage,
      honesty: rail ? honestyOf(rail, t) : { tier: "account", text: "The Account alone holds this limit" },
      ...(paper && rail ? { testLabel: rail.testLabel(t) } : {}),
      ...(paper ? { paper: true as const } : {}),
      at: t.at,
      ...(t.revokedAt ? { revokedAt: t.revokedAt } : {}),
      ...(t.stoppedAt ? { stoppedAt: t.stoppedAt } : {}),
      ...(t.revokeConfirmed ? { revokeConfirmed: t.revokeConfirmed } : {}),
      ...(t.reason ? { reason: t.reason } : {}),
      usesList: t.usesList.map((u) => ({ ...u })),
    };
  }

  /** every token, newest first; `agent` keeps one key's */
  view(now: number, agent?: string): TokenView[] {
    const a = agent?.toLowerCase();
    return this.e.state.tokens.filter((t) => !a || t.agent === a).map((t) => this.viewOf(t, now)).reverse();
  }
}
