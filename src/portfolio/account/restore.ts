/** The account after a restart: rebuilt from its own ledgers, so that an agent can call it at any time — not only between the owner's
 * pairing and the next time the process stops.
 *
 * Every run writes one ledger file. A run that continues the account says so in its first row (`run`), naming the file it continues; the
 * chain of files back to the run that started fresh IS the account. On start, the chain is read oldest first and the account is rebuilt
 * from it — never from a summary of it:
 *
 *   the owner's device       the pairing row carries the device's PUBLIC key; the first one is the owner, as it was
 *   owner instructions        every standing instruction the owner signed (an agent let in or revoked, a limit, an address-book entry, the
 *                             signers, a venue connected or disconnected, the dial opened) is VERIFIED AGAIN — its signature against the
 *                             owners as they stood at that point — and applied again, at the time it was taken. A row that does not verify
 *                             is skipped and said
 *   what a limit has used     the last `spend` row of each limit
 *   the owner's steering      the watchlist and the intents, replayed and verified again like the limits; on each intent, each
 *                             agent's latest report (and how many it made), its signature checked again
 *   what agents asked         each ask still waiting (a day at most), its agent's signature checked again, less the ones an owner's
 *                             action answered (its note row names them) or the owner declined (shown to the agent a day, as before);
 *                             the asks' ids and how often each key asked this hour, continued. The agents that knocked to be let in in
 *                             the last day, by their refusal rows — a knock is no signature, as before the restart
 *   the cards                 a card is its run's alone (what it showed the owner is not kept): one an earlier run left waiting is
 *                             handed back as LEFT, for the service to close on the ledger and say so to the agent that asked
 *   the dial                  the last snapshot; Beast only if the owner's signature that opened it is in the chain and nothing has
 *                             closed it since; a session that ended (every agent stopped, or ended by the owner) stays ended unless the
 *                             owner's signed new session comes after the end
 *   orders and payments       the last state written of each; the ones not finished are followed again — and so is money put into
 *                             or taken out of a venue's earn product (account/live-earn.ts) that the venue had not finished
 *   ids                       continued, so that ord-0007 means one order, whatever run placed it
 *
 * Venues are connected again from the same credential reference the owner signed (a key file in the home, an address, the mm session); a
 * wallet's proof is the signature it gave, checked again. Nothing is SENT on a restart: no order is placed and no money moves — what was
 * in flight is only asked about.
 *
 * A file that was not written as part of the chain (an older version of the account, a `--fresh` start) ends it: what was signed before it
 * is not brought back. A file whose hash chain breaks is read up to the break, and the restore stops there and says so.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { verifyMessage, type Hex } from "viem";
import { Ledger, type LedgerRow } from "../../agent/ledger.ts";
import { isRefusal } from "../../core/errors.ts";
import { DONE } from "../live/trade.ts";
import type { LiveEarn } from "./live-earn.ts";
import type { LiveOrder } from "./live-orders.ts";
import type { KeptAuthorisation } from "./pay-real.ts";
import type { Payment } from "./payments.ts";
import { DECLINED_SHOWN_MS, type AgentAsk, type DeclinedAsk } from "./exchange.ts";
import { actionHash, isAgentAction, isOwnerAction, isJwk, kidOf, malformed, signerOf, type AgentAction, type Envelope, type OwnerAction } from "./sign.ts";
import { agentStatus, applyOwner, applyReport, deviceKeys, FIRED_ALERTS_KEPT, isOwner, type AccountState, type ApplyOptions, type FiredAlert, type SpendApproval } from "./state.ts";

/** the first row of every run that continues the account */
export interface RunMark {
  v: 1;
  /** the file this run continues, or null when it started fresh */
  continues: string | null;
  fresh: boolean;
  /** the run's number: one more than the highest any earlier run of this home has. The newest run is the highest number, not the newest file
   * name, so a clock set back (a file named earlier than the one before it) does not leave runs out */
  n?: number | undefined;
}

/** the dial as a note row records it after it changed */
export interface DialSnapshot {
  mode: "guard" | "open";
  revoked: string[];
  reach: Record<string, string[]>;
  sessionExpiresAt?: string | undefined;
  /** the owner ended the agents' session: it stays ended until the owner signs a new one */
  ended?: boolean | undefined;
  /** the owner stopped every agent then (service.ts stopAgents): the session ended at that moment */
  stoppedAt?: string | undefined;
  /** the most leverage an agent may set */
  maxLeverage?: number | undefined;
  /** the most one order or movement may be worth, as the owner last signed it (setPolicy cap) */
  capUsd?: number | undefined;
}

/** a wallet's proof, as kept on the connection's row: the sentence the account wrote and the wallet's signature over it */
export interface KeptProof {
  address: Hex;
  wallet: string;
  at: number;
  message: string;
  signature: Hex;
}

export interface History {
  /** oldest first */
  files: string[];
  rows: LedgerRow[];
  /** the newest file of the chain: what the new run continues */
  last: string | null;
  broken?: { file: string; at: number } | undefined;
  /** the newest earlier file was not part of a chain (an older version, or no earlier run at all) */
  unchained: boolean;
  /** the highest run number any earlier run of this home took: the new run takes the next one */
  lastRun: number;
}

export const runOf = (row: LedgerRow | undefined): RunMark | undefined => {
  const r = (row?.detail as { run?: RunMark } | undefined)?.run;
  return row?.kind === "note" && r?.v === 1 ? r : undefined;
};

/** The chain this run continues: the newest earlier run of the account, and the runs it continues, back to the one that started fresh.
 * Files no account run wrote (a demo or a test in the same home, an older version of the account) are not part of it and are passed over;
 * a run names the file it continues, so a missing link ends the chain there. */
export function readHistory(dir: string, current: string, now: () => string): History {
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => /^ledger-.*\.jsonl$/.test(n) && join(dir, n) !== current).sort() : [];
  const kept: Array<{ name: string; rows: readonly LedgerRow[] }> = [];
  let broken: History["broken"];
  const read = (name: string) => new Ledger(join(dir, name), now);
  // the head: the run with the highest number (a run without one, from an older version, counts as 0); between equal numbers the newest name
  let next: string | null = null;
  let best = -1;
  let lastRun = 0;
  for (let i = names.length - 1; i >= 0; i--) {
    const run = runOf(read(names[i]!).all()[0]);
    if (!run) continue;
    const n = typeof run.n === "number" && Number.isInteger(run.n) && run.n > 0 ? run.n : 0;
    lastRun = Math.max(lastRun, n);
    if (n > best) {
      best = n;
      next = names[i]!;
    }
  }
  const unchained = next === null;
  const seen = new Set<string>();
  while (next !== null && names.includes(next) && !seen.has(next)) {
    seen.add(next);
    const name: string = next;
    const ledger = read(name);
    const rows = ledger.all();
    const run = runOf(rows[0])!;
    const chain = ledger.verifyChain();
    if (!chain.ok) {
      // what came before the break is the account's; what came after it is not trusted, and nothing older than it is read
      broken = { file: name, at: chain.at ?? 0 };
      kept.unshift({ name, rows: rows.filter((r) => r.seq < (chain.at ?? 0)) });
      break;
    }
    kept.unshift({ name, rows });
    if (run.fresh || run.continues === null) break;
    next = run.continues;
    if (!names.includes(next) || !runOf(read(next).all()[0])) {
      broken = { file: next, at: 0 };
      break;
    }
  }
  return { files: kept.map((k) => k.name), rows: kept.flatMap((k) => [...k.rows]), last: kept.at(-1)?.name ?? null, ...(broken ? { broken } : {}), unchained, lastRun };
}

export interface Connection {
  venue: string;
  connector: string;
  label: string;
  credentialRef: string;
  proof?: KeptProof | undefined;
  at: string;
}

export interface Rebuilt {
  state: AccountState;
  dial: DialSnapshot | undefined;
  /** the venues to connect again, in the order they were first connected */
  connections: Connection[];
  /** orders and payments not finished when the last run stopped */
  orders: LiveOrder[];
  payments: Array<Payment & { run: string }>;
  /** money put into or taken out of earn products that the venue had not finished */
  earns: LiveEarn[];
  /** the highest id of each kind the chain has used */
  ids: { order: number; payment: number; card: number; earn: number };
  /** the price alerts that fired in earlier runs, newest first (account/state.ts FiredAlert): the page and the agents still see them */
  fired: FiredAlert[];
  /** authorisations a payee still held, not yet used or lapsed (account/pay-real.ts) */
  authorisations: KeptAuthorisation[];
  /** what was not brought back, and why */
  skipped: string[];
  owner: boolean;
  /** cards an earlier run raised and left waiting, oldest first: the service closes each as the account restarts */
  cards: LeftCard[];
  /** what agents asked that still waits, and what the owner declined in the last day (account/exchange.ts adoptAsks) */
  asks: { waiting: AgentAsk[]; declined: DeclinedAsk[]; replaced: Array<[string, string]>; times: Array<[string, number[]]>; seq: number };
}

/** a card an earlier run left waiting, as its row raised it (the newer rows say who asked, until when, and what it was for) */
export interface LeftCard {
  id: string;
  venue: string;
  reason: string;
  usd: number;
  at: string;
  tool?: string | undefined;
  agent?: string | undefined;
  signer?: string | undefined;
  expiresAt?: string | undefined;
  /** what the card was about, as the account held it: AskReason and Intent, read back as they were written */
  why?: string | undefined;
  intent?: Record<string, unknown> | undefined;
}

/** an agent's knocks kept after a restart: as many as the account keeps waiting (exchange.ts), from the last day */
const KNOCKS_KEPT = 8;
const KNOCKS_BACK_MS = 86_400_000;
/** the asks' own window for "five an hour" */
const ASK_HOUR_MS = 3_600_000;

/** the signer ids a convertToMultiSigUser names (its JSON's authorizedUsers), or none when it cannot be read */
const namedIn = (signers: string): string[] => {
  try {
    const users = (JSON.parse(signers) as { authorizedUsers?: unknown }).authorizedUsers;
    return Array.isArray(users) ? users.map(String) : [];
  } catch {
    return [];
  }
};

/** a standing instruction the owner signs, which the restore applies again */
const STANDING = new Set(["approveAgent", "approveSpend", "setDestination", "convertToMultiSigUser", "signOut", "createSubAccount", "setWatch", "setAlert", "setIntent"]);
const num = (id: unknown, prefix: string): number => {
  const m = typeof id === "string" ? new RegExp(`^${prefix}-(\\d+)$`).exec(id) : null;
  return m ? Number(m[1]) : 0;
};

/** Everything the restore can rebuild without asking a venue: who the owner is, who the agents are and what they may do, the dial, the ids,
 * and what was in flight. Signatures are checked again here. */
export async function rebuild(rows: readonly LedgerRow[], base: AccountState, opts: ApplyOptions & { codeRequired?: boolean | undefined; /** the moment the account restarts (ms): a price alert that lapsed by then is not brought back */ nowMs?: number | undefined } = {}): Promise<Rebuilt> {
  let s = base;
  const skipped: string[] = [];
  const connections = new Map<string, Connection>();
  const used = new Map<string, Pick<SpendApproval, "spentMicro" | "last" | "payTo" | "renewedAt">>();
  const orders = new Map<string, LiveOrder>();
  const payments = new Map<string, Payment & { run: string }>();
  const earns = new Map<string, LiveEarn>();
  const ids = { order: 0, payment: 0, card: 0, earn: 0 };
  let dial: DialSnapshot | undefined;
  // the price alerts that fired, newest first (their note rows), as many as the page keeps
  const fired: FiredAlert[] = [];
  // Beast needs the owner's signature: the row of the last verified `setPolicy mode open`, and of the last snapshot that said Guard
  let openedAt = -1;
  let closedAt = -1;
  // an ended session (every agent stopped, or the session ended) opens again only by the owner's signed new session: the first ended
  // snapshot after the last one the owner signed, if any, holds — whatever a later row says
  let endedSince: { sessionExpiresAt?: string | undefined; stoppedAt?: string | undefined } | undefined;
  // devices that asked to sign, by their pairing rows: a key is taken from here only for a signed change of signers that names it
  const asked = new Map<string, { jwk: { kty: "EC"; crv: "P-256"; x: string; y: string }; label?: string | undefined }>();
  // authorisations a payee held, by nonce, until a later row says they were used or lapsed
  const kept = new Map<string, KeptAuthorisation>();
  // each signed instruction once: a row copied in again is not taken again
  const applied = new Set<string>();
  // the most leverage the owner has signed for agents (1x until then): a dial row says what it was set to, a signature says it may be that much
  let signedLeverage = 1;
  let signedCap: number | undefined;
  // the cards raised and not closed since, by id (ids are the account's, continued across runs)
  const cards = new Map<string, LeftCard>();
  // what agents asked, in the order asked; the declines; which ask took which one's place; when each key asked
  let asks: AgentAsk[] = [];
  const declined: DeclinedAsk[] = [];
  const replaced = new Map<string, string>();
  const askedAt = new Map<string, number[]>();
  let askSeq = 0;
  // agents that knocked to be let in: the key, the name it asked under, when
  const knocks = new Map<string, { address: Hex; name: string; at: string }>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const at = Date.parse(row.ts);
    const resolved = (row.detail as { resolved?: unknown } | undefined)?.resolved;
    if (typeof resolved === "string") kept.delete(resolved);
    if (row.kind === "payment" && row.tool === "authorisation outstanding") {
      const k = (row.detail as { kept?: KeptAuthorisation } | undefined)?.kept;
      if (k && typeof k.nonce === "string" && Number.isFinite(k.validBefore) && typeof k.spendId === "string" && Number.isInteger(k.offer?.amountMicro) && k.offer.amountMicro > 0) kept.set(k.nonce, k);
      continue;
    }
    // the owner's first device: its public key, as the pairing row recorded it
    if (row.kind === "action" && row.tool === "account_pair") {
      const n = row.native as { jwk?: unknown; label?: unknown; pending?: unknown } | undefined;
      if (n?.pending === true) {
        if (isJwk(n.jwk) && row.signer === `device:${kidOf(n.jwk)}`) asked.set(row.signer, { jwk: { kty: "EC", crv: "P-256", x: n.jwk.x, y: n.jwk.y }, ...(typeof n.label === "string" && n.label.trim() ? { label: n.label.trim().slice(0, 40) } : {}) });
        continue;
      }
      // an owner who paired without the code is not taken by a run that asks for one (a read-only run let the first browser in): it pairs again
      if (s.owners.length === 0 && n && isJwk(n.jwk) && row.signer === `device:${kidOf(n.jwk)}` && opts.codeRequired && (n as { code?: unknown }).code !== true) {
        skipped.push(`the owner's device of ${row.ts} paired without a pairing code: it pairs again with the code this run printed`);
        continue;
      }
      if (s.owners.length === 0 && n && isJwk(n.jwk) && row.signer === `device:${kidOf(n.jwk)}`) {
        s = { ...s, owners: [{ id: row.signer, kind: "device", label: typeof n.label === "string" ? n.label : "this browser", jwk: { kty: "EC", crv: "P-256", x: n.jwk.x, y: n.jwk.y }, addedAt: row.ts }] };
      }
      continue;
    }
    // AN AGENT'S ASK: its row carries the ask and the agent's signed envelope. Brought back when the signature is that key's, the key
    // stood then, and the words are the ones signed; the same signed ask copied in again counts once
    if (row.kind === "action" && row.tool === "agentAsk" && row.outcome === "asked") {
      const n = row.native as { ask?: AgentAsk; replaces?: unknown } | undefined;
      const env = row.envelope as Envelope | undefined;
      const a = env?.action as Extract<AgentAction, { type: "agentAsk" }> | undefined;
      const ask = n?.ask;
      if (!ask || !a || a.type !== "agentAsk" || typeof ask.id !== "string") continue;
      askSeq = Math.max(askSeq, num(ask.id, "ask"));
      const digest = `${row.signer ?? ""}:${actionHash(a)}`;
      if (applied.has(digest)) {
        skipped.push(`agentAsk of ${row.ts}: the same signed ask a second time, which is taken once`);
        continue;
      }
      const who = malformed(a) ? null : await signerOf(a, env!.signature).catch(() => null);
      const same = who !== null && who === row.signer && who.toLowerCase() === String(ask.agent).toLowerCase() && a.kind === ask.kind && a.venue === ask.venue && a.usd === ask.usd && a.text.trim() === ask.text;
      if (!same || agentStatus(s, who, at) !== "ok") {
        skipped.push(`agentAsk of ${row.ts}: its signature does not check out against the agent key and the words the row names`);
        continue;
      }
      applied.add(digest);
      const was = typeof n?.replaces === "string" ? n.replaces : undefined;
      if (was) replaced.set(was, ask.id);
      asks = [...asks.filter((x) => x.id !== was && !(x.agent === ask.agent && x.kind === ask.kind && x.venue === ask.venue)), ask];
      askedAt.set(ask.agent, [...(askedAt.get(ask.agent) ?? []), at]);
      continue;
    }
    // an agent that knocked: a write from a key the account does not know (its refusal row). Only an agent's instruction knocks
    if (row.kind === "account-refusal" && row.code === "E_ACCOUNT_UNKNOWN_SIGNER" && typeof row.signer === "string" && /^0x[0-9a-fA-F]{40}$/.test(row.signer) && isAgentAction({ type: row.tool ?? "" })) {
      const asked = (row.detail as { asked?: unknown } | undefined)?.asked;
      const had = knocks.get(row.signer);
      knocks.set(row.signer, { address: row.signer as Hex, name: typeof asked === "string" && asked ? asked.slice(0, 32) : (had?.name ?? ""), at: had?.at ?? row.ts });
      continue;
    }
    if (row.kind === "action" && row.outcome === "ok" && row.envelope) {
      const env = row.envelope as Envelope;
      const a = env.action;
      if (a && a.type === "agentReport" && isAgentAction(a)) {
        // an agent's report on an intent: its own signature, the key standing then, the intent open then and addressed to it
        const report = a as Extract<AgentAction, { type: "agentReport" }>;
        const digest = `${row.signer ?? ""}:${actionHash(report)}`;
        if (applied.has(digest)) {
          skipped.push(`agentReport of ${row.ts}: the same signed report a second time, which is taken once`);
          continue;
        }
        const who = malformed(report) ? null : await signerOf(report, env.signature).catch(() => null);
        if (!who || who !== row.signer) {
          skipped.push(`agentReport of ${row.ts}: its signature does not check out against the key the row names`);
          continue;
        }
        const next = applyReport(s, report, who, at);
        if (isRefusal(next)) skipped.push(`agentReport of ${row.ts}: ${next.message}`);
        else {
          applied.add(digest);
          s = next;
        }
        continue;
      }
      if (!a || typeof a.type !== "string" || !isOwnerAction(a)) continue;
      const digest = actionHash(a);
      if (applied.has(digest)) {
        skipped.push(`${a.type} of ${row.ts}: the same signed instruction a second time, which is taken once`);
        continue;
      }
      // the signature, against the owners as they stood when it was taken
      const signer = await signerOf(a, env.signature, deviceKeys(s)).catch(() => null);
      const signers = new Set<string>();
      if (signer && isOwner(s, signer)) signers.add(signer);
      for (const extra of env.cosignatures ?? []) {
        const who = await signerOf(a, extra, deviceKeys(s)).catch(() => null);
        if (who && isOwner(s, who)) signers.add(who);
      }
      if (!signers.size || signers.size < s.threshold) {
        skipped.push(`${a.type} of ${row.ts}: its signature does not check out against the account's owners`);
        continue;
      }
      applied.add(digest);
      const action = a as OwnerAction;
      // a browser signs only itself out (the door took it only so): a row that says otherwise is not taken now either
      if (action.type === "signOut" && action.device !== signer) {
        skipped.push(`signOut of ${row.ts}: it names another device than the one that signed it`);
        continue;
      }
      if (STANDING.has(action.type)) {
        // a change of signers names devices by id: the ones that had asked to sign are taken as waiting, with the keys their rows recorded
        let from = s;
        if (action.type === "convertToMultiSigUser") {
          const waiting = namedIn(action.signers).filter((id) => asked.has(id) && !isOwner(s, id) && !s.pendingDevices.some((d) => `device:${d.kid}` === id));
          if (waiting.length) from = { ...s, pendingDevices: [...s.pendingDevices, ...waiting.map((id) => ({ kid: id.slice("device:".length), jwk: asked.get(id)!.jwk, at: row.ts, ...(asked.get(id)!.label ? { label: asked.get(id)!.label } : {}) }))] };
        }
        const allow = (row.native as { allow?: unknown } | undefined)?.allow;
        const here = action.type === "approveSpend" ? (Array.isArray(allow) ? allow.map(String) : [...connections.keys()]) : [];
        const next = applyOwner(from, action, env, at, here, opts);
        if (isRefusal(next)) {
          skipped.push(`${action.type} of ${row.ts}: ${next.message}`);
          // it took an id when it was first taken (its row says it went through): the ids after it stay the ones they were given, so the
          // limits, and what was spent and placed under them, keep their names
          if (action.type === "approveSpend" || action.type === "createSubAccount" || (action.type === "setIntent" && action.id === "" && action.validUntil !== 0) || (action.type === "setAlert" && action.id === "" && action.on === "true")) s = { ...s, seq: s.seq + 1 };
        } else s = next;
      } else if (action.type === "setPolicy") {
        if (action.change === "mode" && action.value === "open") openedAt = i;
        if (action.change === "session") endedSince = undefined;
        if (action.change === "maxLeverage" && /^\d{1,3}$/.test(action.value) && Number(action.value) >= 1) signedLeverage = Number(action.value);
        // the most one order or movement may be worth: the owner's last signed figure stands, whichever way it went
        if (action.change === "cap" && /^\d{1,7}(\.\d{1,2})?$/.test(action.value) && Number(action.value) > 0) signedCap = Number(action.value);
      } else if (action.type === "connectVenue") {
        const proof = (row.native as { proof?: KeptProof } | undefined)?.proof;
        connections.delete(action.venue);
        connections.set(action.venue, { venue: action.venue, connector: action.connector, label: action.label, credentialRef: action.credentialRef, ...(proof ? { proof } : {}), at: row.ts });
      } else if (action.type === "disconnectVenue") connections.delete(action.venue);
      else if (action.type === "answerAsk" && action.decision === "decline") {
        // the owner declined it: closed, and shown to the agent that asked for a day, as before the restart
        const ask = asks.find((x) => x.id === action.ask.trim());
        if (ask) {
          asks = asks.filter((x) => x !== ask);
          declined.push({ ...ask, declinedAt: row.ts });
        }
      }
      continue;
    }
    if (row.kind === "note") {
      // asks an owner's action answered (exchange.ts answered names them): closed
      const answered = (row.detail as { asksAnswered?: unknown } | undefined)?.asksAnswered;
      if (Array.isArray(answered)) {
        const ids = new Set(answered.map(String));
        asks = asks.filter((x) => !ids.has(x.id));
        continue;
      }
      // a price alert that fired (service.ts lookAtAlerts wrote the row): it leaves the alerts standing, and stays among the fired ones the
      // page and the agents see — the newest first
      const f = (row.detail as { alertFired?: FiredAlert } | undefined)?.alertFired;
      if (f && typeof f.id === "string") {
        s = { ...s, alerts: s.alerts.filter((x) => x.id !== f.id) };
        fired.unshift(f);
        if (fired.length > FIRED_ALERTS_KEPT) fired.length = FIRED_ALERTS_KEPT;
        continue;
      }
      const d = (row.detail as { dial?: DialSnapshot } | undefined)?.dial;
      if (d && (d.mode === "open" || d.mode === "guard")) {
        dial = { mode: d.mode, revoked: Array.isArray(d.revoked) ? d.revoked.map(String) : [], reach: d.reach && typeof d.reach === "object" ? d.reach : {}, ...(typeof d.sessionExpiresAt === "string" ? { sessionExpiresAt: d.sessionExpiresAt } : {}), ...(d.ended === true ? { ended: true } : {}), ...(d.ended === true && typeof d.stoppedAt === "string" ? { stoppedAt: d.stoppedAt } : {}), ...(typeof d.maxLeverage === "number" && d.maxLeverage >= 1 ? { maxLeverage: d.maxLeverage } : {}) };
        if (d.mode === "guard") closedAt = i;
        if (d.ended === true && !endedSince) endedSince = { sessionExpiresAt: typeof d.sessionExpiresAt === "string" ? d.sessionExpiresAt : undefined, stoppedAt: typeof d.stoppedAt === "string" ? d.stoppedAt : undefined };
      }
      continue;
    }
    if (row.kind === "spend" && row.intentId && row.detail) {
      const d = row.detail as Partial<SpendApproval>;
      if (typeof d.spentMicro === "number" && d.spentMicro >= 0) used.set(row.intentId, { spentMicro: d.spentMicro, last: d.last ?? {}, payTo: d.payTo ?? {}, ...(typeof d.renewedAt === "number" && Number.isFinite(d.renewedAt) ? { renewedAt: d.renewedAt } : {}) });
      continue;
    }
    if (row.kind === "card") {
      ids.card = Math.max(ids.card, num(row.intentId, "card"));
      // raised: waiting until a row closes it (approved, rejected, expired — every close is a row)
      if (typeof row.intentId === "string" && row.outcome === "pending") {
        const c = (row.detail as { card?: { expiresAt?: unknown; why?: unknown; intent?: unknown } } | undefined)?.card;
        cards.set(row.intentId, { id: row.intentId, venue: row.venue, reason: row.reason ?? "", usd: Number(row.notionalUsd) || 0, at: row.ts, ...(row.tool ? { tool: row.tool } : {}), ...(row.agent ? { agent: row.agent } : {}), ...(typeof row.signer === "string" ? { signer: row.signer } : {}), ...(typeof c?.expiresAt === "string" ? { expiresAt: c.expiresAt } : {}), ...(typeof c?.why === "string" ? { why: c.why } : {}), ...(c?.intent && typeof c.intent === "object" ? { intent: c.intent as Record<string, unknown> } : {}) });
      } else if (typeof row.intentId === "string") cards.delete(row.intentId);
      continue;
    }
    if (row.kind === "statement") {
      const n = row.native as { order?: LiveOrder; payment?: Payment; run?: string; earn?: LiveEarn } | undefined;
      if (n?.earn?.clientId && typeof n.earn.id === "string") {
        earns.set(n.earn.clientId, n.earn);
        ids.earn = Math.max(ids.earn, num(n.earn.id, "earn"));
      }
      if (n?.order?.clientId) {
        orders.set(n.order.clientId, n.order);
        ids.order = Math.max(ids.order, num(n.order.id, "ord"));
      }
      if (n?.payment?.id && n.run) {
        payments.set(`${n.run}:${n.payment.id}`, { ...n.payment, run: n.run });
        ids.payment = Math.max(ids.payment, num(n.payment.id, "pay"));
      }
      const l = row.detail as { id?: string } | undefined;
      ids.order = Math.max(ids.order, num(l?.id, "ord"));
      ids.payment = Math.max(ids.payment, num(l?.id, "pay"));
    }
  }

  // what each limit had used: its spending, the last time each destination was refilled, the address each payee was pinned at
  s = { ...s, spends: s.spends.map((x) => (used.has(x.id) ? { ...x, ...used.get(x.id)! } : x)) };
  if (dial?.maxLeverage !== undefined && dial.maxLeverage > signedLeverage) {
    skipped.push(`the agents' leverage cap was ${dial.maxLeverage}x, and the owner's signature for more than ${signedLeverage}x is not in the chain: it is ${signedLeverage}x`);
    dial = { ...dial, maxLeverage: signedLeverage };
  }
  if (endedSince && dial) {
    const until = endedSince.sessionExpiresAt;
    const later = until !== undefined && (dial.sessionExpiresAt === undefined || Date.parse(dial.sessionExpiresAt) > Date.parse(until));
    if (!dial.ended || later) skipped.push("the agents' session was ended, and the owner's signature that opened it again is not in the chain: it stays ended");
    dial = { ...dial, ...(later ? { sessionExpiresAt: until } : {}), ended: true, ...(endedSince.stoppedAt ? { stoppedAt: endedSince.stoppedAt } : {}) };
  }
  if (dial?.mode === "open" && !(openedAt >= 0 && openedAt > closedAt)) {
    dial = { ...dial, mode: "guard" };
    skipped.push("the dial was open, and the owner's signature that opened it is not in the chain: it starts Guard");
  }
  // the cap comes back only from the owner's signature, never from a snapshot alone
  if (signedCap !== undefined) dial = { ...(dial ?? { mode: "guard", revoked: [], reach: {} }), capUsd: signedCap };
  // an order the account stopped following (account/live-orders.ts: canceled while its venue was not connected) is not followed again —
  // save one whose owner's cancel waits to be sent again once its venue answers this network
  const unfinishedOrder = (o: LiveOrder) => (!o.unfollowed || o.cancelWanted === true) && (!DONE.has(o.status) || (!!o.walletTxs && !o.ref && o.status === "pending"));
  const unfinishedPayment = (p: Payment) => !!p.live && (p.status === "pending" || (p.status === "authorized" && !p.live.expired));
  // a price alert that lapsed while the account was down is gone, like one that lapses while it runs
  const nowMs = opts.nowMs;
  if (nowMs !== undefined && Number.isFinite(nowMs)) s = { ...s, alerts: s.alerts.filter((x) => nowMs < Date.parse(x.expiresAt)) };
  // what agents asked, as it stands at the restart: an ask that lapsed, or whose key was revoked since, is gone, as it would have gone in
  // the run; a decline is shown its day; "five an hour" counts this hour's asks
  const at = nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : Date.now();
  const back: Rebuilt["asks"] = {
    waiting: asks.filter((x) => at < Date.parse(x.expiresAt) && agentStatus(s, x.agent, at) !== "revoked"),
    declined: declined.filter((x) => at - Date.parse(x.declinedAt) < DECLINED_SHOWN_MS),
    replaced: [...replaced.entries()],
    times: [...askedAt.entries()].map(([k, t]) => [k, t.filter((x) => at - x < ASK_HOUR_MS)] as [string, number[]]).filter(([, t]) => t.length > 0),
    seq: askSeq,
  };
  // the knocks of the last day from keys that are not on the account now (let in, revoked or an owner's), the newest kept
  const known = (a: string) => s.agents.some((k) => k.address.toLowerCase() === a.toLowerCase()) || isOwner(s, a);
  const requests = [...knocks.values()].filter((k) => at - Date.parse(k.at) < KNOCKS_BACK_MS && !known(k.address)).slice(-KNOCKS_KEPT);
  if (requests.length) s = { ...s, requests: [...s.requests.filter((r) => !requests.some((k) => k.address.toLowerCase() === r.address.toLowerCase())), ...requests].slice(-KNOCKS_KEPT) };
  return { state: s, dial, authorisations: [...kept.values()], connections: [...connections.values()], orders: [...orders.values()].filter(unfinishedOrder), payments: [...payments.values()].filter(unfinishedPayment), earns: [...earns.values()].filter((e) => e.status === "pending"), ids, fired, skipped, owner: s.owners.length > 0, cards: [...cards.values()], asks: back };
}

/** a wallet's proof kept on its connection row, checked again: the wallet's signature over the sentence, naming the address */
export async function proofHolds(p: KeptProof | undefined): Promise<boolean> {
  if (!p || typeof p.message !== "string" || typeof p.signature !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(String(p.address))) return false;
  if (!p.message.includes(p.address)) return false;
  try {
    return await verifyMessage({ address: p.address, message: p.message, signature: p.signature });
  } catch {
    return false;
  }
}

export const fileName = (path: string): string => basename(path);
