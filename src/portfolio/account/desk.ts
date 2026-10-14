/** THE DESK: the account's own agents, hired on the page — for the owner who has no agent of their own to connect, as the paper account
 * is for the owner who has no venue to connect. Eight seats, a charter each, one room, one objective, the approval line, the routines; a
 * live view of the run (the equity, the open leads, the tape of closes, the biggest ones). Shaped after the "eight agents run my desk"
 * pattern (a coordinator that never trades, specialists that find, clear, enter, exit and watch, one message format with a lead id at
 * every stage, reversible work done alone and signing done on approval) and after a perps bot's live screen (LIVE hh:mm of the session, the
 * equity and its curve, the position with its entry and take-profit lines, the trade tape, the big closes).
 *
 * The rule that makes it the ACCOUNT's desk and not a bot beside it: every seat is an agent key let in by the owner (approveAgent), and a
 * seat that trades does so inside a trading limit the owner signed (approveSpend), through the same door as any outside agent — Guard: a
 * card the owner answers; Beast: inside the limit, at once. CHARTERS BECOME LIMITS: the roles that must never trade (Head, Search, Risk,
 * Flow, Sentiment) hold no trading limit, so the door refuses them an order whatever they decide; the roles that trade (Sniper, Exit,
 * Watch) are bounded by the limit's size per order, its budget and its venues, and by the objective's own rules this file keeps (the most at
 * risk per lead, the day's loss at which the floor halts). The words in a charter steer the brain; they are not authority.
 *
 * A seat is HOUSE — the account runs it, with a brain (a Claude model through the Anthropic API, brain-claude.ts, or any OpenAI-format chat endpoint — OpenAI, DeepSeek, a local server — brain-openai.ts; a scripted one in
 * tests) — or OUTSIDE: an agent of the owner's own (Claude Code over MCP, any program with a key) holding the seat: it reads the desk and
 * its charter (portfolio_desk) and says things in the room (portfolio_desk_say, a signed agentDeskSay). The two kinds are the same seat at
 * the door; the Flow and Sentiment seats are outside-only, since they need data the account does not have (a wallet-flow feed, a
 * sentiment feed) and the account never pretends to.
 *
 * What a cycle does (every `everyMin` minutes while the session runs, or when the owner asks for one): the leads' orders are read back
 * from the account (fills, cards answered); EXIT reviews the open leads — the plan closes a lead at its take-profit, its stop or its time
 * limit without asking anyone, the brain may close one early; SEARCH reads Markets (the account's own listing of what the desk's venue
 * trades, movers and the most traded) and names leads; RISK checks each one — the market open, a price and a book, the spread, the day's
 * loss room, the size (the least of the objective's risk per lead, the Sniper's limit per order and what is left of its budget) — and
 * clears or rejects it; SNIPER places each cleared lead as the account's agentLiveOrder; HEAD writes the cycle line, halts the floor when
 * the day's loss reaches the objective's line, and writes the evening report at the hour the objective names (and the weekly review on
 * Sundays). Every step is a message in the room with the lead's id. Nothing in the room is invented: the account's reads, the door's
 * answers, the brain's words (said to be the brain's).
 *
 * The brain's cost is counted from the API's own token counts at the model's listed price — or the price the owner gives for a model no
 * list carries; without one the tokens are counted, unpriced — and shown as an estimate; without a brain
 * (no key) the desk is hired, its seats stand, and the room says so each cycle — no lead is made up.
 *
 * Files: <home>/desk/desk.json (the desk: objective, seats, session, leads, equity points, reports, spend) and <home>/desk/room.jsonl
 * (the room, one message a line), the user's alone (0600), the first written whole each time (a temporary file, then a rename). The
 * seats' keys are in <home>/seats/desk-<role>.json (keystore.ts). The home is the trust boundary, as for the ledger.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { LedgerRowInput } from "../../agent/ledger.ts";
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import type { TabId } from "../live/categories.ts";
import type { Exploration, ExploreItem } from "../live/explore.ts";
import type { LiveOrder } from "./live-orders.ts";
import type { Market, Position } from "../live/trade.ts";
import type { AccountPage, Outcome } from "./exchange.ts";
import { seatKey } from "./keystore.ts";
import { signAgent, type Action, type AgentAction, type Envelope, type Hex, type SimKey } from "./sign.ts";
import type { AgentKey } from "./state.ts";

// ---- the roles -------------------------------------------------------------------------------------------------------------------

export const ROLES = ["head", "search", "risk", "sniper", "exit", "watch", "flow", "sentiment"] as const;
export type RoleId = (typeof ROLES)[number];

export interface Charter {
  /** what the role owns */
  owns: string;
  /** what good output looks like, as checkable criteria */
  good: string;
  /** what it must never do without asking */
  never: string;
}

export interface RoleSpec {
  id: RoleId;
  /** its name on the desk */
  name: string;
  /** its tag in the room */
  tag: string;
  /** the account can run it (a house seat); false: only an outside agent fills it, and why */
  house: boolean;
  outsideOnly?: string | undefined;
  /** it places orders: it needs a trading limit, and the owner is asked for one at hiring */
  trades: boolean;
  charter: Charter;
}

export const ROLE_SPECS: Record<RoleId, RoleSpec> = {
  head: { id: "head", name: "Head of desk", tag: "HEAD", house: true, trades: false, charter: { owns: "The weekly objective turned into each day's work, the funnel (scanned → cleared → confirmed → executed → closed), the morning status and the evening report, the halt when the day's loss reaches the line.", good: "A report that names numbers the account can show. One thing that worked and one change for tomorrow, each a sentence.", never: "Trade, sign, size a position, or widen a limit. It holds no key that can." } },
  search: { id: "search", name: "Search", tag: "SEARCH", house: true, trades: false, charter: { owns: "Leads: markets in the desk's universe worth a look, from what the account's own Markets listing shows now (movers, volume, what closes soon).", good: "At most three leads a cycle, each a symbol the venue lists, a side and a thesis in one sentence tied to a number the listing gave.", never: "Recommend a size or an entry. It holds no trading limit." } },
  risk: { id: "risk", name: "Risk", tag: "RISK", house: true, trades: false, charter: { owns: "Clearance: whether a lead may be entered, at what size, with what take-profit, stop and time limit.", good: "A verdict with the checks that decided it: the market open, a price and a book, the spread, the day's loss room, the size inside the objective's risk per lead and the Sniper's limit.", never: "Clear a lead the hard checks failed, or size above what the owner's limit allows. It holds no trading limit." } },
  sniper: { id: "sniper", name: "Sniper", tag: "SNIPER", house: true, trades: true, charter: { owns: "Entries: each cleared lead placed as one order at the desk's venue, at the size Risk cleared.", good: "An order that is exactly the clearance — the symbol, the side, the size — and the door's answer written in the room.", never: "Place anything Risk did not clear, or more than it cleared. In Guard every order waits for the owner on a card." } },
  exit: { id: "exit", name: "Exit", tag: "EXIT", house: true, trades: true, charter: { owns: "Open leads: the take-profit, the stop and the time limit of the plan, taken when the mark reaches them; closing a lead early when the thesis is gone.", good: "Each close named with its reason and the realised result, in the room.", never: "Add to a lead or average down. A close is an order through the door like any other." } },
  watch: { id: "watch", name: "Watch", tag: "WATCH", house: true, trades: true, charter: { owns: "Danger on open leads: the distance to liquidation, funding draining the margin, an event market closing, the venue not answering.", good: "A warning with the number that raised it; a close under the pre-approved rule when the number crosses the line.", never: "Open anything. It closes only what the desk holds." } },
  flow: { id: "flow", name: "Flow", tag: "FLOW", house: false, outsideOnly: "needs a feed of large and smart-money flows, which the account does not have: an agent of yours with that data fills this seat", trades: false, charter: { owns: "What large and informed money is doing in a lead's market: confirms, or stays quiet.", good: "A confirmation that names its source and its number.", never: "Size a position or recommend an entry." } },
  sentiment: { id: "sentiment", name: "Sentiment", tag: "SENTIMENT", house: false, outsideOnly: "needs a feed of social and news attention, which the account does not have: an agent of yours with that data fills this seat", trades: false, charter: { owns: "The attention a lead's market gets: news and social, by the hour.", good: "A reading with its source and a count; hype alone is never a confirmation.", never: "Treat attention as a reason to enter." } },
};

/** the name a house seat is let in under: plain text the account takes as an agent key's name */
export const seatName = (role: RoleId): string => `Desk ${ROLE_SPECS[role].name.replace(" of desk", "")}`;
/** the key file's name in <home>/seats */
export const seatFile = (role: RoleId): string => `desk-${role}`;

// ---- what the desk is made of ---------------------------------------------------------------------------------------------------

export const UNIVERSES: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "all", label: "Anything the venue lists" },
  { id: "crypto", label: "Crypto" },
  { id: "perps", label: "Perpetuals" },
  { id: "stocks", label: "Stocks" },
  { id: "rwas", label: "Tokenised assets" },
  { id: "predictions", label: "Prediction markets" },
];

export interface DeskObjective {
  /** the owner's words: what the desk is for this week */
  text: string;
  /** the one venue the desk trades (its id on the account); a paper account is the recommended first one */
  venue: string;
  /** which of Markets' tabs the leads come from */
  universe: TabId;
  /** the week's target, in percent of the equity the session started with */
  targetPct: number;
  /** the most one lead puts at risk, in percent of that equity (its size) */
  maxRiskPct: number;
  /** the day's loss at which the floor halts until the next day (New York), in percent of that equity */
  maxDailyLossPct: number;
  /** how long one session runs, in hours */
  hours: number;
  /** a cycle every this many minutes */
  everyMin: number;
  /** the evening report, New York wall clock, "21:00" */
  reportAt: string;
  /** the most leads open at once */
  maxOpen: number;
}

export interface BrainConfig {
  /** which brain thinks: the id of one the desk holds — "claude" (the Anthropic API, brain-claude.ts), "openai" (an OpenAI-format
   * endpoint, brain-openai.ts); a stand-in's "scripted" */
  provider: string;
  model: string;
  effort: "low" | "medium" | "high";
  /** the model's price per million tokens (in, out), the owner's number for a model the brain does not list — for the estimate */
  price?: { inUsd: number; outUsd: number } | undefined;
}

export interface DeskSeat {
  role: RoleId;
  kind: "house" | "outside";
  /** the agent key that holds the seat (a house seat's is the account's own, from keystore.ts) */
  address: Hex;
  /** its name on the account */
  name: string;
  charter: Charter;
  hiredAt: string;
}

export interface DeskSession {
  startedAt: string;
  /** the venue's equity when the session started, in dollars: what the run is measured from */
  startEquityUsd: number;
  hours: number;
  endsAt: string;
  pausedAt?: string | undefined;
  endedAt?: string | undefined;
  /** the floor halted: the day's loss reached the line; new leads wait until `until` */
  halted?: { at: string; why: string; until: string } | undefined;
  /** cycles run in this session */
  cycles: number;
}

export type LeadState = "scanned" | "rejected" | "cleared" | "confirmed" | "executed" | "closing" | "closed" | "refused";

export interface Lead {
  /** L-0047 */
  id: string;
  at: string;
  updatedAt: string;
  venue: string;
  symbol: string;
  name: string;
  kind: string;
  side: "buy" | "sell";
  thesis: string;
  state: LeadState;
  /** why it was rejected or refused, in the words of whoever did */
  why?: string | undefined;
  /** the clearance: the size in dollars, the plan */
  sizeUsd?: number | undefined;
  tpPct?: number | undefined;
  slPct?: number | undefined;
  maxHours?: number | undefined;
  /** the entry order on the account, and the card it waited on */
  order?: string | undefined;
  card?: string | undefined;
  entry?: { price: number; qty: number; at: string; feeUsd: number; contractSize: number } | undefined;
  /** the exit order and its fill */
  exitOrder?: string | undefined;
  exitWhy?: string | undefined;
  exit?: { price: number; qty: number; at: string; feeUsd: number } | undefined;
  /** the realised result once closed, net of fees, and the return on the lead's size */
  pnlUsd?: number | undefined;
  roiPct?: number | undefined;
  /** the last mark the open lead was valued at */
  markPrice?: number | undefined;
  unrealizedUsd?: number | undefined;
  markAt?: string | undefined;
}

export type RoomKind = "cycle" | "lead" | "clearance" | "order" | "card" | "exit" | "warning" | "halt" | "report" | "review" | "note" | "refusal" | "you";

export interface RoomMessage {
  seq: number;
  at: string;
  /** who said it: a role, the owner (you), or the account itself */
  from: RoleId | "you" | "account";
  kind: RoomKind;
  lead?: string | undefined;
  text: string;
  refs?: { card?: string | undefined; order?: string | undefined; symbol?: string | undefined } | undefined;
  /** the brain said it (a house seat's words), as opposed to the account's own numbers */
  brain?: true | undefined;
}

export interface DeskReport {
  at: string;
  kind: "start" | "evening" | "weekly" | "end";
  text: string;
}

export interface DeskFile {
  v: 1;
  id: string;
  name: string;
  createdAt: string;
  objective: DeskObjective;
  brain: BrainConfig;
  seats: DeskSeat[];
  session?: DeskSession | undefined;
  leads: Lead[];
  /** [ms, equity in dollars] */
  equity: Array<[number, number]>;
  reports: DeskReport[];
  spend: { calls: number; inputTokens: number; outputTokens: number; usd: number; unpricedTokens?: number | undefined };
  counters: { lead: number; seq: number };
  /** the New York day the last evening report and weekly review were written for */
  reported?: string | undefined;
  reviewed?: string | undefined;
}

// ---- the brain ----------------------------------------------------------------------------------------------------------------

export interface BrainRequest<T> {
  role: RoleId;
  /** the model and effort the desk was hired with */
  brain: BrainConfig;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number | undefined;
}
export interface BrainAnswer<T> {
  /** the decision, or null when the model gave none (refused, ran out, or did not parse) */
  out: T | null;
  why?: string | undefined;
  usage: { inputTokens: number; outputTokens: number };
}
export interface BrainStatus {
  ok: boolean;
  model: string;
  /** how it is reached ("ANTHROPIC_API_KEY", "a key file") */
  how?: string | undefined;
  /** why not, and what would make it ready */
  why?: string | undefined;
}
export interface Brain {
  /** the provider's id, as a desk names it (BrainConfig.provider) */
  readonly id: string;
  /** for the hire form: "Claude · Anthropic API" */
  readonly label: string;
  /** the models it lists, with their prices; none listed means the owner names one and the endpoint decides */
  readonly models: ReadonlyArray<BrainModel>;
  ready(): BrainStatus;
  decide<T>(r: BrainRequest<T>): Promise<BrainAnswer<T>>;
}
export interface BrainModel {
  id: string;
  name: string;
  inUsd: number;
  outUsd: number;
}

/** a brain that answers from a script: tests and the stand-in (`id`, `label`, `models` and the tokens it claims are the test's) */
export function scriptedBrain(script: (r: { role: RoleId; input: string }) => unknown, model = "scripted", o: { id?: string | undefined; label?: string | undefined; models?: ReadonlyArray<BrainModel> | undefined; usage?: BrainAnswer<unknown>["usage"] | undefined } = {}): Brain {
  const usage = () => ({ ...(o.usage ?? { inputTokens: 0, outputTokens: 0 }) });
  return {
    id: o.id ?? "scripted",
    label: o.label ?? "a script",
    models: o.models ?? [],
    ready: () => ({ ok: true, model, how: "a script" }),
    async decide(r) {
      const raw = script({ role: r.role, input: r.input });
      const parsed = r.schema.safeParse(raw);
      return parsed.success ? { out: parsed.data, usage: usage() } : { out: null, why: "the script's answer did not fit", usage: usage() };
    },
  };
}

/** the Claude models a desk may think with, and their listed prices per million tokens (in, out), for the estimate the view shows */
export const BRAIN_MODELS: ReadonlyArray<BrainModel> = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", inUsd: 4, outUsd: 20 },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", inUsd: 2, outUsd: 10 },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", inUsd: 0.1, outUsd: 0.5 },
];
export const DEFAULT_BRAIN: BrainConfig = { provider: "claude", model: "claude-opus-5-5", effort: "medium" };
/** what a call cost: the owner's price for the model, else the brain's listed one; undefined when neither is known (the tokens are
 * still counted, as unpriced) */
export const costOf = (brain: BrainConfig, listed: ReadonlyArray<BrainModel>, inputTokens: number, outputTokens: number): number | undefined => {
  const p = brain.price ?? listed.find((x) => x.id === brain.model);
  return p ? (inputTokens * p.inUsd + outputTokens * p.outUsd) / 1e6 : undefined;
};

// ---- the decisions, as the brain gives them (structured outputs) ------------------------------------------------------------------

const SearchOut = z.object({ leads: z.array(z.object({ symbol: z.string(), side: z.enum(["buy", "sell"]), thesis: z.string(), confidence: z.number() })), note: z.string() });
const RiskOut = z.object({ verdict: z.enum(["clear", "reject"]), why: z.string(), sizeUsd: z.number(), tpPct: z.number(), slPct: z.number(), maxHours: z.number() });
const ExitOut = z.object({ decisions: z.array(z.object({ lead: z.string(), action: z.enum(["hold", "close"]), why: z.string() })) });
const ReportOut = z.object({ worked: z.string(), change: z.string() });
const ReviewOut = z.object({ roles: z.array(z.object({ role: z.string(), verdict: z.string() })), prune: z.string() });
export const DECISIONS = { SearchOut, RiskOut, ExitOut, ReportOut, ReviewOut };

// ---- what the desk needs from the account it lives in ----------------------------------------------------------------------------

export interface DeskWorld {
  home: string;
  now(): string;
  /** the real clock, ms */
  realNow(): number;
  mode(): "guard" | "open";
  page(): Promise<AccountPage | undefined>;
  explore(o: { tab?: string | undefined; sort?: string | undefined; limit?: number | undefined }): Promise<Exploration | Refusal>;
  market(venue: string, symbol: string): Promise<Market | Refusal>;
  positions(venue: string): Promise<Position[] | Refusal>;
  exchange(envelope: Envelope): Promise<Outcome>;
  nonce(): number;
  venueName(id: string): string;
  log(row: LedgerRowInput): void;
}

export interface DeskOptions {
  /** the brains the desk may think with: one, or several told apart by id (BrainConfig.provider) */
  brain: Brain | Brain[];
  /** the desk's own clock for its timers; tests call tick() and cycle() themselves */
  tickMs?: number | undefined;
}

// ---- limits of the file ------------------------------------------------------------------------------------------------------

export const DESK_ID = "desk";
export const MAX_LEADS = 400;
export const MAX_EQUITY_POINTS = 2000;
export const MAX_REPORTS = 60;
export const ROOM_KEPT = 3000;
export const ROOM_SHOWN = 160;
const TEXT_MAX = 400;
const CHARTER_MAX = 400;
const OBJECTIVE_TEXT = 200;
const MIN_CYCLE_MIN = 1;
const MAX_CYCLE_MIN = 240;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** the spread a lead may have, in percent of the price */
export const MAX_SPREAD_PCT = 0.6;
/** a lead's plan where the brain gives none, or one out of bounds */
const PLAN = { tpPct: 1.5, slPct: 0.8, maxHours: 12 };
const PLAN_BOUNDS = { tpPct: [0.2, 25], slPct: [0.2, 15], maxHours: [1, 168] } as const;

const r2 = (n: number) => Number(n.toFixed(2));
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const plainText = (s: unknown, max: number): string => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

/** New York wall clock, as the objective names its hours */
const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
export function ny(ms: number): { day: string; minutes: number; dow: number } {
  const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value])) as Record<string, string>;
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "") };
}
const minutesOf = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? clamp(Number(m[1]), 0, 23) * 60 + clamp(Number(m[2]), 0, 59) : 21 * 60;
};
/** the next New York midnight after `ms` */
const nextNyMidnight = (ms: number): number => {
  let t = ms + 60_000;
  const day = ny(ms).day;
  // walk forward to the first minute of the next New York day (a minute's resolution is enough for a halt)
  while (ny(t).day === day) t += 60_000;
  return t - (t % 60_000);
};

const bad = (message: string, detail: Record<string, unknown> = {}): Refusal => no("E_ACCOUNT_BAD_ACTION", { message, detail });

// ---- the store ----------------------------------------------------------------------------------------------------------------

export const deskPath = (home: string): string => join(home, "desk", "desk.json");
export const roomPath = (home: string): string => join(home, "desk", "room.jsonl");

function writePrivate(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function readDesk(home: string): DeskFile | undefined {
  const p = deskPath(home);
  if (!existsSync(p)) return undefined;
  try {
    const f = JSON.parse(readFileSync(p, "utf8")) as DeskFile;
    // a desk hired before brains were a choice thought with Claude
    if (f.brain && !f.brain.provider) f.brain = { ...f.brain, provider: "claude" };
    return f && f.v === 1 && f.id === DESK_ID && f.objective && Array.isArray(f.seats) ? f : undefined;
  } catch {
    return undefined;
  }
}

export function readRoom(home: string, last = ROOM_SHOWN): RoomMessage[] {
  const p = roomPath(home);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: RoomMessage[] = [];
  for (const l of lines.slice(-last)) {
    try {
      out.push(JSON.parse(l) as RoomMessage);
    } catch {
      // a half-written line at the end of a file the process died on: skipped
    }
  }
  return out;
}

// ---- the desk ------------------------------------------------------------------------------------------------------------------

/** the view the page and a seat read */
export interface DeskView {
  id: string;
  name: string;
  createdAt: string;
  objective: DeskObjective;
  brain: BrainStatus & { provider: string; label: string; effort: string; price?: BrainConfig["price"]; spend: DeskFile["spend"] };
  seats: Array<DeskSeat & { status: "ok" | "not let in" | "expired" | "revoked"; limit?: { perOrderUsd: number; leftUsd: number; budgetUsd: number; venues: string[] } | undefined; cards: number }>;
  session?: (DeskSession & { state: "live" | "paused" | "halted" | "ended"; elapsedMs: number; remainingMs: number }) | undefined;
  equity: { nowUsd: number; startUsd: number; changeUsd: number; changePct: number; mult: number; points: Array<[number, number]> };
  target: { pct: number; progressPct: number; reachedUsd: number; targetUsd: number };
  funnel: { scanned: number; cleared: number; confirmed: number; executed: number; closed: number; rejected: number };
  today: { pnlUsd: number; wins: number; losses: number; scanned: number; cleared: number; executed: number; closed: number; lossRoomUsd: number };
  open: Lead[];
  recent: Lead[];
  tape: { wins: number; losses: number; winRatePct: number; avgWinPct: number; avgLossPct: number; closes: Array<{ id: string; symbol: string; pnlUsd: number; roiPct: number; at: string }> };
  big: Array<{ id: string; symbol: string; side: string; pnlUsd: number; roiPct: number; at: string }>;
  room: RoomMessage[];
  routines: { everyMin: number; nextCycleAt?: string | undefined; reportAt: string; nextReportAt: string; weeklyAt: string; lastReport?: DeskReport | undefined };
  reports: DeskReport[];
  cards: Array<{ id: string; lead?: string | undefined; reason: string; usd: number }>;
  /** the venue's row on the account now: its equity, whether it is a paper account */
  venue: { id: string; name: string; usd: number; paper: boolean; connected: boolean };
}

export interface DeskCatalog {
  roles: RoleSpec[];
  /** a house seat's key address, by role (made on first ask, in the home) */
  seats: Partial<Record<RoleId, Hex>>;
  /** the brain the form starts from: the hired one, else the first that is ready */
  brain: BrainStatus & { provider: string; label: string; models: ReadonlyArray<BrainModel>; effort: string };
  /** every brain the desk may think with, each with its standing and the models it lists */
  brains: Array<BrainStatus & { id: string; label: string; models: ReadonlyArray<BrainModel> }>;
  universes: typeof UNIVERSES;
  defaults: Omit<DeskObjective, "venue" | "text">;
  hired: boolean;
}

interface Who {
  signer: string;
  agent?: AgentKey | undefined;
}

export class Desk {
  private file: DeskFile | undefined;
  private running = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastEquityAt = 0;
  private lastCycleAt = 0;
  private lastNoBrainSaid = "";

  constructor(private readonly world: DeskWorld, private readonly opts: DeskOptions) {
    this.file = readDesk(world.home);
  }

  /** the brains the desk may think with, told apart by id */
  get brains(): Brain[] {
    return Array.isArray(this.opts.brain) ? this.opts.brain : [this.opts.brain];
  }
  /** the one that thinks: the hired desk's (the first, until a desk is hired) */
  get brain(): Brain {
    const want = this.file?.brain.provider;
    return this.brains.find((b) => b.id === want) ?? this.brains[0]!;
  }

  hired(): boolean {
    return this.file !== undefined;
  }

  /** the house seat's key for a role: made in the home on first use */
  seatKeyOf(role: RoleId): SimKey | Refusal {
    return seatKey(this.world.home, seatFile(role));
  }

  // ---- the owner's instructions and a seat's words (through the door: exchange.ts) ----

  async apply(action: Extract<Action, { type: "setDesk" | "agentDeskSay" }>, who: Who): Promise<Outcome> {
    if (action.type === "agentDeskSay") return this.say(action, who);
    if (action.desk !== DESK_ID) return bad(`this account keeps one desk, "${DESK_ID}"`);
    let value: unknown;
    try {
      value = action.value === "" ? {} : JSON.parse(action.value);
    } catch {
      return bad("the desk's value is JSON");
    }
    const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
    switch (action.change) {
      case "hire":
        return this.hire(v);
      case "objective":
        return this.objective(v);
      case "charter":
        return this.charter(v);
      case "seat":
        return this.seat(v);
      case "pause":
      case "resume":
      case "end":
        return this.session(action.change);
      case "cycle": {
        if (!this.file) return bad("no desk is hired");
        this.room("you", "note", "You asked for a cycle now.");
        await this.cycle("you asked");
        return { ok: true, kind: "account", summary: "a cycle ran" };
      }
      case "brain":
        return this.brainChange(v);
      case "report": {
        if (!this.file) return bad("no desk is hired");
        await this.report("evening", true);
        return { ok: true, kind: "account", summary: "the report was written" };
      }
      default:
        return bad(`"${action.change}" is not a change the desk takes: hire · objective · brain · charter · seat · pause · resume · end · cycle · report`);
    }
  }

  private parseObjective(v: Record<string, unknown>, base?: DeskObjective): DeskObjective | Refusal {
    const text = plainText(v.text ?? base?.text, OBJECTIVE_TEXT);
    const venue = plainText(v.venue ?? base?.venue, 40);
    if (!text) return bad("an objective is a sentence: what the desk is for this week");
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(venue)) return bad("the objective names the one venue the desk trades, by its id on the account");
    const universe = String(v.universe ?? base?.universe ?? "all") as TabId;
    if (!UNIVERSES.some((u) => u.id === universe)) return bad(`a universe is one of ${UNIVERSES.map((u) => u.id).join(", ")}`);
    const n = (k: keyof Omit<DeskObjective, "text" | "venue" | "universe" | "reportAt">, lo: number, hi: number, d: number): number => {
      const x = v[k] === undefined ? (base?.[k] ?? d) : Number(v[k]);
      return Number.isFinite(x) ? clamp(x, lo, hi) : d;
    };
    const reportAt = /^\d{1,2}:\d{2}$/.test(String(v.reportAt ?? "")) ? String(v.reportAt) : (base?.reportAt ?? "21:00");
    return { text, venue, universe, targetPct: n("targetPct", 0.1, 100, 3), maxRiskPct: n("maxRiskPct", 0.1, 50, 1), maxDailyLossPct: n("maxDailyLossPct", 0.1, 50, 5), hours: n("hours", 1, 24 * 14, 22), everyMin: n("everyMin", MIN_CYCLE_MIN, MAX_CYCLE_MIN, 15), reportAt, maxOpen: Math.round(n("maxOpen", 1, 10, 3)) };
  }

  private parseCharter(v: unknown, base: Charter): Charter {
    const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { owns: plainText(c.owns, CHARTER_MAX) || base.owns, good: plainText(c.good, CHARTER_MAX) || base.good, never: plainText(c.never, CHARTER_MAX) || base.never };
  }

  /** the brain, as the owner names it: a provider the desk holds; a model it lists, or — for one that lists none — the model's name as
   * the endpoint knows it; the effort; the owner's price (null clears it) */
  private parseBrain(v: unknown, base: BrainConfig): BrainConfig | Refusal {
    const b = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const ids = this.brains.map((x) => x.id);
    const provider = ids.includes(String(b.provider)) ? String(b.provider) : ids.includes(base.provider) ? base.provider : ids[0]!;
    const brain = this.brains.find((x) => x.id === provider)!;
    const same = base.provider === provider;
    let model: string;
    if (brain.models.length) {
      const named = b.model === undefined || b.model === "" ? undefined : String(b.model);
      if (named !== undefined && !brain.models.some((m) => m.id === named)) return bad(`${brain.label} lists ${brain.models.map((m) => m.id).join(", ")}: "${named.slice(0, 40)}" is not one of them`);
      model = named ?? (same && brain.models.some((m) => m.id === base.model) ? base.model : brain.models[0]!.id);
    } else {
      const named = plainText(b.model, 80);
      model = /^[A-Za-z0-9][\w.\-:/]{0,79}$/.test(named) ? named : same && base.model ? base.model : brain.ready().model;
      if (!model) return bad(`${brain.label}: name the model, as the endpoint names it (or "model" in its key file)`);
    }
    const effort = b.effort === "low" || b.effort === "medium" || b.effort === "high" ? b.effort : base.effort;
    let price: BrainConfig["price"];
    if (b.price === null) price = undefined;
    else if (b.price && typeof b.price === "object") {
      const { inUsd, outUsd } = b.price as Record<string, unknown>;
      const i = Number(inUsd);
      const o = Number(outUsd);
      if (!(Number.isFinite(i) && i >= 0 && Number.isFinite(o) && o >= 0)) return bad("a price is dollars per million tokens, in and out, zero or more");
      price = { inUsd: i, outUsd: o };
    } else price = same && base.model === model ? base.price : undefined;
    return { provider, model, effort, ...(price ? { price } : {}) };
  }

  /** the brain, changed: which one thinks, the model, the effort, the owner's price */
  private brainChange(v: Record<string, unknown>): Outcome {
    if (!this.file) return bad("no desk is hired");
    const b = this.parseBrain(v, this.file.brain);
    if (isRefusal(b)) return b;
    this.file.brain = b;
    this.save();
    const st = this.brain.ready();
    this.room("you", "you", `You changed the brain: ${this.brain.label} · ${b.model} · ${b.effort} effort${b.price ? ` · $${b.price.inUsd}/$${b.price.outUsd} per M tokens` : ""}${st.ok ? "" : ` — not ready: ${st.why ?? "no key"}`}.`);
    return { ok: true, kind: "account", summary: `the desk thinks with ${b.model} (${this.brain.label})` };
  }

  /** hire: the objective, the brain, the seats. The seats' keys are the owner's to let in (approveAgent) and to give limits (approveSpend),
   * which the page signs beside this; the desk reads their standing from the account at every cycle */
  private async hire(v: Record<string, unknown>): Promise<Outcome> {
    if (this.file && this.file.session && !this.file.session.endedAt) return bad("a desk is hired and its session runs: end it first (end), or change its objective (objective)");
    const objective = this.parseObjective((v.objective && typeof v.objective === "object" && !Array.isArray(v.objective) ? v.objective : {}) as Record<string, unknown>);
    if (isRefusal(objective)) return objective;
    const page = await this.world.page();
    const venue = page?.venues.find((x) => x.id === objective.venue);
    if (!venue || !venue.live) return bad(`"${objective.venue}" is not a venue connected on the account`);
    if (!venue.trade || venue.trade.can === false) return bad(`${venue.name} does not trade from here: the desk trades one venue that does (a paper account, or an exchange whose key may trade)`);
    const roles = Array.isArray(v.roles) ? (v.roles as unknown[]) : [];
    const seats: DeskSeat[] = [];
    const now = this.world.now();
    for (const r of roles) {
      const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const role = String(x.role ?? "") as RoleId;
      const spec = ROLE_SPECS[role];
      if (!spec) return bad(`"${String(x.role)}" is not a role: ${ROLES.join(", ")}`);
      if (seats.some((s) => s.role === role)) return bad(`the ${spec.name} seat is named twice`);
      const kind = x.kind === "outside" ? "outside" : "house";
      if (kind === "house" && !spec.house) return bad(`the ${spec.name} seat ${spec.outsideOnly}`);
      let address: Hex;
      let name: string;
      if (kind === "house") {
        const k = this.seatKeyOf(role);
        if (isRefusal(k)) return k;
        address = k.address as Hex;
        name = seatName(role);
      } else {
        const a = String(x.address ?? "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(a)) return bad(`an outside seat names the agent key that fills it (0x…): the ${spec.name} seat does not`);
        address = a as Hex;
        name = plainText(x.name, 32) || page?.keys.find((k) => k.address === a)?.name || spec.name;
      }
      seats.push({ role, kind, address, name, charter: this.parseCharter(x.charter, spec.charter), hiredAt: now });
    }
    if (!seats.length) return bad("a desk has at least one seat");
    if (!seats.some((s) => s.role === "head")) return bad("hire the Head of desk first: it never trades, and it runs the room");
    const brain = this.parseBrain(v.brain, DEFAULT_BRAIN);
    if (isRefusal(brain)) return brain;
    const name = plainText(v.name, 40) || "The desk";
    const was = this.file;
    this.file = { v: 1, id: DESK_ID, name, createdAt: now, objective, brain, seats, leads: was?.leads.slice(-MAX_LEADS) ?? [], equity: [], reports: was?.reports.slice(-MAX_REPORTS) ?? [], spend: was?.spend ?? { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }, counters: was?.counters ?? { lead: 0, seq: 0 } };
    this.file.session = this.newSession(venue.usd, now, objective.hours);
    this.save();
    this.room("you", "you", `You hired ${name}: ${seats.map((s) => ROLE_SPECS[s.role].tag).join(" · ")}. Objective: “${objective.text}” at ${venue.name} · target ${pct(objective.targetPct)} · at most ${objective.maxRiskPct}% a lead · halt at -${objective.maxDailyLossPct}% in a day · a cycle every ${objective.everyMin} min for ${objective.hours} h.`);
    await this.report("start");
    return { ok: true, kind: "account", summary: `desk hired: ${seats.length} seat${seats.length === 1 ? "" : "s"} at ${venue.name}, a session of ${objective.hours} h from ${usd(venue.usd)}` };
  }

  private newSession(startEquityUsd: number, now: string, hours: number): DeskSession {
    const start = Date.parse(now);
    return { startedAt: now, startEquityUsd: r2(startEquityUsd), hours, endsAt: new Date(start + hours * HOUR).toISOString(), cycles: 0 };
  }

  private async objective(v: Record<string, unknown>): Promise<Outcome> {
    if (!this.file) return bad("no desk is hired");
    const o = this.parseObjective(v, this.file.objective);
    if (isRefusal(o)) return o;
    if (o.venue !== this.file.objective.venue) {
      const page = await this.world.page();
      const venue = page?.venues.find((x) => x.id === o.venue);
      if (!venue || !venue.live) return bad(`"${o.venue}" is not a venue connected on the account`);
      if (this.file.leads.some((l) => l.state === "executed" || l.state === "confirmed" || l.state === "closing")) return bad("the desk has open leads at its venue: close them, or end the session, before it moves venue");
    }
    this.file.objective = o;
    if (v.brain !== undefined) {
      const b = this.parseBrain(v.brain, this.file.brain);
      if (isRefusal(b)) return b;
      this.file.brain = b;
    }
    this.save();
    this.room("you", "you", `You changed the objective: “${o.text}” · target ${pct(o.targetPct)} · at most ${o.maxRiskPct}% a lead · halt at -${o.maxDailyLossPct}% · every ${o.everyMin} min · report ${o.reportAt}.`);
    return { ok: true, kind: "account", summary: "the desk's objective changed" };
  }

  private charter(v: Record<string, unknown>): Outcome {
    if (!this.file) return bad("no desk is hired");
    const seat = this.file.seats.find((s) => s.role === v.role);
    if (!seat) return bad(`no seat on the desk is "${String(v.role)}"`);
    seat.charter = this.parseCharter(v, seat.charter);
    this.save();
    this.room("you", "you", `You changed the ${ROLE_SPECS[seat.role].tag} charter.`);
    return { ok: true, kind: "account", summary: `the ${ROLE_SPECS[seat.role].name} charter changed` };
  }

  /** a seat filled, or filled by another key: a house seat by the account's own key, an outside one by the key the owner names (which the
   * owner lets in and, for a trading role, gives a limit) — or left empty (`kind` "none") */
  private async seat(v: Record<string, unknown>): Promise<Outcome> {
    if (!this.file) return bad("no desk is hired");
    const role = String(v.role ?? "") as RoleId;
    const spec = ROLE_SPECS[role];
    if (!spec) return bad(`"${String(v.role)}" is not a role: ${ROLES.join(", ")}`);
    if (v.kind === "none") {
      if (role === "head") return bad("the Head of desk stays: end the desk instead");
      this.file.seats = this.file.seats.filter((s) => s.role !== role);
      this.save();
      this.room("you", "you", `You left the ${spec.tag} seat empty.`);
      return { ok: true, kind: "account", summary: `the ${spec.name} seat is empty` };
    }
    const kind = v.kind === "outside" ? "outside" : "house";
    if (kind === "house" && !spec.house) return bad(`the ${spec.name} seat ${spec.outsideOnly}`);
    let address: Hex;
    let name: string;
    if (kind === "house") {
      const k = this.seatKeyOf(role);
      if (isRefusal(k)) return k;
      address = k.address as Hex;
      name = seatName(role);
    } else {
      const a = String(v.address ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(a)) return bad("an outside seat names the agent key that fills it (0x…)");
      address = a as Hex;
      // the key's name on the account, when the owner has let it in
      const page = await this.world.page();
      name = plainText(v.name, 32) || page?.keys.find((k) => k.address === a)?.name || spec.name;
    }
    const was = this.file.seats.find((s) => s.role === role);
    const seat: DeskSeat = { role, kind, address, name, charter: this.parseCharter(v.charter, was?.charter ?? spec.charter), hiredAt: this.world.now() };
    this.file.seats = was ? this.file.seats.map((s) => (s.role === role ? seat : s)) : [...this.file.seats, seat];
    this.save();
    this.room("you", "you", `You filled the ${spec.tag} seat ${kind === "house" ? "from the house" : `with ${name} (${address.slice(0, 8)}…)`}.`);
    return { ok: true, kind: "account", summary: `the ${spec.name} seat is filled ${kind === "house" ? "from the house" : `by ${name}`}` };
  }

  private async session(change: "pause" | "resume" | "end"): Promise<Outcome> {
    if (!this.file) return bad("no desk is hired");
    const s = this.file.session;
    const now = this.world.now();
    if (change === "pause") {
      if (!s || s.endedAt) return bad("no session runs");
      if (s.pausedAt) return bad("the session is paused already");
      s.pausedAt = now;
      this.save();
      this.room("you", "you", "You paused the desk: no cycle runs until you resume it. Open leads keep their plan when it does.");
      return { ok: true, kind: "account", summary: "the desk is paused" };
    }
    if (change === "end") {
      if (!s || s.endedAt) return bad("no session runs");
      s.endedAt = now;
      this.save();
      await this.report("end");
      return { ok: true, kind: "account", summary: "the session ended" };
    }
    if (s && !s.endedAt && s.pausedAt) {
      delete s.pausedAt;
      this.save();
      this.room("you", "you", "You resumed the desk.");
      return { ok: true, kind: "account", summary: "the desk runs again" };
    }
    if (s && !s.endedAt) return bad("the session runs already");
    const page = await this.world.page();
    const venue = page?.venues.find((x) => x.id === this.file!.objective.venue);
    if (!venue || !venue.live) return bad(`${this.world.venueName(this.file.objective.venue)} is not connected: connect it, then start a session`);
    this.file.session = this.newSession(venue.usd, now, this.file.objective.hours);
    this.file.equity = [];
    this.save();
    this.room("you", "you", `You started a new session of ${this.file.objective.hours} h from ${usd(venue.usd)}.`);
    await this.report("start");
    return { ok: true, kind: "account", summary: `a new session of ${this.file.objective.hours} h` };
  }

  /** an outside seat's words in the room, under its key */
  private say(a: Extract<AgentAction, { type: "agentDeskSay" }>, who: Who): Outcome {
    if (!this.file) return bad("no desk is hired");
    const seat = this.file.seats.find((s) => s.address === who.signer.toLowerCase());
    if (!seat) return no("E_ACCOUNT_OWNER_ONLY", { message: "this key holds no seat on the desk: the owner fills a seat with it under Agents › Desk", detail: { signer: who.signer } });
    const kind: RoomKind = a.kind === "lead" || a.kind === "clearance" || a.kind === "report" || a.kind === "warning" ? a.kind : "note";
    const text = plainText(a.text, TEXT_MAX);
    if (!text) return bad("say something: the words are the message");
    const lead = /^L-\d{4,}$/.test(a.lead) ? a.lead : undefined;
    if (lead && !this.file.leads.some((l) => l.id === lead)) return bad(`no lead on the desk is ${lead}`);
    this.room(seat.role, kind, text, { lead });
    return { ok: true, kind: "account", summary: `${ROLE_SPECS[seat.role].tag} said it in the room` };
  }

  // ---- the room, the file ----

  private room(from: RoomMessage["from"], kind: RoomKind, text: string, extra: { lead?: string | undefined; refs?: RoomMessage["refs"]; brain?: true | undefined } = {}): RoomMessage {
    const f = this.file;
    const seq = f ? ++f.counters.seq : 0;
    const m: RoomMessage = { seq, at: this.world.now(), from, kind, text: text.slice(0, 600), ...(extra.lead ? { lead: extra.lead } : {}), ...(extra.refs ? { refs: extra.refs } : {}), ...(extra.brain ? { brain: true as const } : {}) };
    const p = roomPath(this.world.home);
    mkdirSync(join(p, ".."), { recursive: true, mode: 0o700 });
    const exists = existsSync(p);
    writeFileSync(p, `${JSON.stringify(m)}\n`, { flag: "a", mode: 0o600 });
    if (!exists) chmodSync(p, 0o600);
    // a room that grew past what is kept is cut to its last part, once in a while
    if (seq % 500 === 0) {
      const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
      if (lines.length > ROOM_KEPT) writePrivate(p, `${lines.slice(-ROOM_KEPT).join("\n")}\n`);
    }
    if (f) this.save();
    return m;
  }

  private save(): void {
    if (!this.file) return;
    if (this.file.leads.length > MAX_LEADS) this.file.leads = this.file.leads.slice(-MAX_LEADS);
    if (this.file.reports.length > MAX_REPORTS) this.file.reports = this.file.reports.slice(-MAX_REPORTS);
    writePrivate(deskPath(this.world.home), `${JSON.stringify(this.file, null, 1)}\n`);
  }

  // ---- the clock ----

  /** the desk's own timers (the real server): a tick every `tickMs` (30 s) */
  start(): () => void {
    const every = this.opts.tickMs ?? 30_000;
    if (every > 0 && !this.timer) {
      this.timer = setInterval(() => void this.tick().catch((err: unknown) => console.error(`desk tick: ${String((err as Error)?.message ?? err).slice(0, 300)}`)), every);
      this.timer.unref?.();
    }
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
    };
  }

  /** what the clock does: the leads' orders read back, an equity point, a cycle when one is due, the report at its hour, the session's end */
  async tick(): Promise<void> {
    const f = this.file;
    if (!f || !f.session || f.session.endedAt || this.running) return;
    this.running = true;
    try {
      const nowMs = Date.parse(this.world.now());
      const s = f.session;
      if (s.halted && nowMs >= Date.parse(s.halted.until)) {
        delete s.halted;
        this.save();
        this.room("head", "note", "A new day in New York: the floor is open again.");
      }
      if (nowMs >= Date.parse(s.endsAt)) {
        s.endedAt = this.world.now();
        this.save();
        await this.report("end");
        return;
      }
      await this.followOrders();
      if (nowMs - this.lastEquityAt >= 60_000) await this.markEquity();
      const nyNow = ny(nowMs);
      const at = minutesOf(f.objective.reportAt);
      if (nyNow.minutes >= at && f.reported !== nyNow.day) await this.report("evening");
      if (nyNow.dow === 0 && nyNow.minutes >= at && f.reviewed !== nyNow.day) await this.review();
      if (!s.pausedAt && nowMs - this.lastCycleAt >= f.objective.everyMin * 60_000) await this.cycleNow("the clock");
    } finally {
      this.running = false;
    }
  }

  /** one cycle, now (the owner asked, or a test) */
  async cycle(why = "asked"): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.followOrders();
      await this.cycleNow(why);
    } finally {
      this.running = false;
    }
  }

  // ---- the cycle ----

  private async cycleNow(why: string): Promise<void> {
    const f = this.file;
    if (!f || !f.session || f.session.endedAt) return;
    this.lastCycleAt = Date.parse(this.world.now());
    f.session.cycles++;
    const page = await this.world.page();
    if (!page) return;
    const venue = page.venues.find((v) => v.id === f.objective.venue);
    const standing = this.standing(page);
    const seatOk = (role: RoleId) => standing.get(role)?.status === "ok";
    const n = f.session.cycles;
    const brain = this.brain.ready();
    // the Exit's plan runs whether or not a brain thinks: a take-profit, a stop and a time limit are numbers
    const exits = await this.exits(page, venue, brain.ok && seatOk("exit"));
    await this.markEquity();
    const halted = this.checkHalt();
    const open = this.openLeads().length;
    if (!venue || !venue.live) {
      this.room("head", "cycle", `Cycle ${n} (${why}): ${this.world.venueName(f.objective.venue)} is not connected, so nothing is scanned.`);
      return;
    }
    if (!brain.ok) {
      // said once an hour, not every cycle
      const key = `${ny(Date.parse(this.world.now())).day}-${Math.floor(Date.parse(this.world.now()) / HOUR)}`;
      if (this.lastNoBrainSaid !== key) {
        this.lastNoBrainSaid = key;
        this.room("account", "note", `Cycle ${n}: the house seats have no brain to think with (${brain.why ?? "no key"}). The plan's exits still run; no lead is made up.`);
      }
      return;
    }
    if (halted || f.session.halted) {
      this.room("head", "cycle", `Cycle ${n} (${why}): the floor is halted until ${this.when(f.session.halted?.until)} — ${exits} exit${exits === 1 ? "" : "s"} reviewed, no new lead.`);
      return;
    }
    if (f.session.pausedAt) return;
    if (open >= f.objective.maxOpen) {
      this.room("head", "cycle", `Cycle ${n} (${why}): ${open} lead${open === 1 ? "" : "s"} open, the most the objective allows — nothing new scanned.`);
      return;
    }
    const sniper = standing.get("sniper");
    if (!f.seats.some((s) => s.role === "search")) {
      this.room("head", "cycle", `Cycle ${n} (${why}): no Search seat, so no lead is scanned.`);
      return;
    }
    if (!sniper || sniper.status !== "ok") {
      this.room("head", "cycle", `Cycle ${n} (${why}): the Sniper seat is ${sniper ? sniper.status : "empty"}: nothing would be placed, so nothing is scanned. Let it in under Agents.`);
      return;
    }
    if (!sniper.limit || !sniper.limit.venues.includes(venue.id)) {
      this.room("head", "cycle", `Cycle ${n} (${why}): the Sniper has no trading limit at ${venue.name}: the door would refuse its orders, so nothing is scanned. Give it one under Agents.`);
      return;
    }
    const leads = await this.search(venue, page);
    if (!leads.length) {
      this.room("head", "cycle", `Cycle ${n} (${why}): scanned, nothing worth a lead this time.`);
      return;
    }
    let placed = 0;
    for (const lead of leads) {
      const cleared = await this.clear(lead, venue, sniper.limit, page);
      if (!cleared) continue;
      if (this.openLeads().length >= f.objective.maxOpen) {
        this.room("risk", "clearance", `${lead.id} cleared, but the desk is at its most open leads: it waits for the next cycle.`, { lead: lead.id });
        continue;
      }
      if (await this.enter(lead, venue)) placed++;
    }
    this.room("head", "cycle", `Cycle ${n} (${why}): ${leads.length} lead${leads.length === 1 ? "" : "s"} scanned, ${leads.filter((l) => l.state !== "rejected").length} cleared, ${placed} placed, ${this.openLeads().length} open.`);
  }

  /** each seat's standing on the account: let in, its trading limit at the desk's venue, its cards waiting */
  private standing(page: AccountPage): Map<RoleId, { status: "ok" | "not let in" | "expired" | "revoked"; limit?: { perOrderUsd: number; leftUsd: number; budgetUsd: number; venues: string[] } | undefined; cards: number }> {
    const out = new Map<RoleId, { status: "ok" | "not let in" | "expired" | "revoked"; limit?: { perOrderUsd: number; leftUsd: number; budgetUsd: number; venues: string[] } | undefined; cards: number }>();
    for (const s of this.file?.seats ?? []) {
      const keys = page.keys.filter((k) => k.address === s.address).sort((a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt));
      const key = keys[0];
      const status = !key ? "not let in" : key.status === "ok" ? "ok" : key.status === "expired" ? "expired" : "revoked";
      const spend = page.spend.find((x) => x.agent === s.address && x.scope === "trade" && !x.expired && x.budgetUsd > 0);
      const limit = spend ? { perOrderUsd: spend.perPaymentUsd, leftUsd: r2(Math.max(0, spend.budgetUsd - spend.spentUsd - spend.reservedUsd)), budgetUsd: spend.budgetUsd, venues: spend.allow } : undefined;
      out.set(s.role, { status, limit, cards: page.cards.filter((c) => c.agent === s.address).length });
    }
    return out;
  }

  private openLeads(): Lead[] {
    return (this.file?.leads ?? []).filter((l) => l.state === "executed" || l.state === "confirmed" || l.state === "closing");
  }

  // ---- Search ----

  private async search(venue: AccountPage["venues"][number], page: AccountPage): Promise<Lead[]> {
    const f = this.file!;
    const tab = f.objective.universe === "all" ? undefined : f.objective.universe;
    const x = await this.world.explore({ ...(tab ? { tab } : {}), limit: 60 });
    if (isRefusal(x)) {
      this.room("search", "note", `Markets did not answer: ${x.message}`);
      return [];
    }
    // what the desk's venue lists, as a row the listing gives a price for
    const atVenue = (i: ExploreItem) => i.at.find((a) => a.venue === venue.id && a.price !== undefined);
    const rows = [...x.items, ...x.movers, ...x.mostTraded].filter((i, k, all) => all.findIndex((j) => j.key === i.key) === k).map((i) => ({ i, a: atVenue(i) })).filter((r): r is { i: ExploreItem; a: NonNullable<ReturnType<typeof atVenue>> } => r.a !== undefined && r.a.open !== false).slice(0, 40);
    const scannedCount = rows.length;
    if (!rows.length) {
      this.room("search", "note", `${venue.name} lists nothing in the ${UNIVERSES.find((u) => u.id === f.objective.universe)?.label ?? f.objective.universe} universe right now.`);
      return [];
    }
    const held = new Set(this.openLeads().map((l) => l.symbol));
    const table = rows.map(({ i, a }) => ({ symbol: a.symbol, name: i.name, kind: i.kind, price: a.price, bid: a.bid, ask: a.ask, changePct24h: i.changePct24h, volumeUsd24h: i.volumeUsd24h, ...(i.fundingRate !== undefined ? { fundingRate: i.fundingRate } : {}), ...(i.closeTime ? { closeTime: i.closeTime } : {}), ...(held.has(a.symbol) ? { heldByDesk: true } : {}) }));
    const seat = f.seats.find((s) => s.role === "search")!;
    const ans = await this.think("search", seat.charter, `The desk's venue: ${venue.name}${venue.paper ? " (a paper account: paper money, real public prices)" : ""}. Objective: ${JSON.stringify(f.objective)}. Open leads: ${JSON.stringify(this.openLeads().map((l) => ({ id: l.id, symbol: l.symbol, side: l.side })))}. Markets now (the account's own listing): ${JSON.stringify(table)}. Name at most three leads, each a symbol from the table, a side (sell opens a short: only on a perpetual), a one-sentence thesis tied to a number in the table, and your confidence 0 to 1. An empty list is a fine answer.`, SearchOut, 1200);
    const found: Lead[] = [];
    const now = this.world.now();
    for (const c of ans?.leads.slice(0, 3) ?? []) {
      const row = rows.find((r) => r.a.symbol === c.symbol);
      if (!row) {
        this.room("search", "note", `Named ${c.symbol}, which the table does not list: dropped.`, { brain: true });
        continue;
      }
      if (held.has(c.symbol)) continue;
      const id = `L-${String(++f.counters.lead).padStart(4, "0")}`;
      const lead: Lead = { id, at: now, updatedAt: now, venue: venue.id, symbol: c.symbol, name: row.i.name, kind: row.i.kind, side: c.side, thesis: plainText(c.thesis, 240), state: "scanned" };
      f.leads.push(lead);
      found.push(lead);
      this.room("search", "lead", `LEAD ${id} | ${c.symbol} | ${c.side === "buy" ? "long" : "short"} | ${lead.thesis} | confidence ${clamp(c.confidence, 0, 1).toFixed(2)} → RISK`, { lead: id, refs: { symbol: c.symbol }, brain: true });
    }
    if (ans?.note) this.room("search", "note", plainText(ans.note, TEXT_MAX), { brain: true });
    if (!found.length) this.room("search", "note", `Scanned ${scannedCount} market${scannedCount === 1 ? "" : "s"} at ${venue.name}: no lead.`, { brain: true });
    this.save();
    return found;
  }

  // ---- Risk ----

  private async clear(lead: Lead, venue: AccountPage["venues"][number], limit: { perOrderUsd: number; leftUsd: number; budgetUsd: number; venues: string[] }, page: AccountPage): Promise<boolean> {
    const f = this.file!;
    const s = f.session!;
    const reject = (why: string) => {
      lead.state = "rejected";
      lead.why = why;
      lead.updatedAt = this.world.now();
      this.room("risk", "clearance", `RISK CLEARANCE ${lead.id} | ${why} | Verdict: REJECT`, { lead: lead.id });
      this.save();
      return false;
    };
    const m = await this.world.market(venue.id, lead.symbol);
    if (isRefusal(m)) return reject(`the venue did not price ${lead.symbol}: ${m.message}`);
    if (!m.open) return reject(`${lead.symbol} is not open for orders now${m.note ? ` (${m.note})` : ""}`);
    const price = m.price ?? (m.bid !== undefined && m.ask !== undefined ? (m.bid + m.ask) / 2 : undefined);
    if (price === undefined || !(price > 0)) return reject(`no price for ${lead.symbol}`);
    if (lead.side === "sell" && m.kind !== "perp") return reject(`a sell opens a short only on a perpetual; ${lead.symbol} is ${m.kind}`);
    const spread = m.bid !== undefined && m.ask !== undefined && m.bid > 0 ? ((m.ask - m.bid) / price) * 100 : undefined;
    if (spread !== undefined && spread > MAX_SPREAD_PCT) return reject(`spread ${spread.toFixed(2)}% is over ${MAX_SPREAD_PCT}%`);
    const today = this.todayNumbers();
    const lossRoom = s.startEquityUsd * (f.objective.maxDailyLossPct / 100) + Math.min(0, today.pnlUsd);
    if (lossRoom <= 0) return reject(`no room left in the day's loss line (${usd(today.pnlUsd)} today)`);
    const maxSize = r2(Math.min(s.startEquityUsd * (f.objective.maxRiskPct / 100), limit.perOrderUsd, limit.leftUsd));
    if (!(maxSize > 0)) return reject(`nothing left of the Sniper's limit (${usd(limit.leftUsd)} of ${usd(limit.budgetUsd)})`);
    if (m.minNotional !== undefined && maxSize < m.minNotional) return reject(`the most this lead may be (${usd(maxSize)}) is under the venue's smallest order (${usd(m.minNotional)})`);
    const checks = `market open · price ${price} · spread ${spread === undefined ? "n/a" : `${spread.toFixed(2)}%`} · volume ${m.volumeUsd24h === undefined ? "n/a" : usd(m.volumeUsd24h)} · day's loss room ${usd(lossRoom)} · size up to ${usd(maxSize)}`;
    const seat = f.seats.find((x) => x.role === "risk");
    let plan = { ...PLAN, sizeUsd: maxSize, why: "the hard checks passed; no Risk seat, so the plan is the default" };
    if (seat) {
      const ans = await this.think("risk", seat.charter, `Lead ${lead.id}: ${JSON.stringify({ symbol: lead.symbol, side: lead.side, kind: m.kind, thesis: lead.thesis, price, bid: m.bid, ask: m.ask, spreadPct: spread, volumeUsd24h: m.volumeUsd24h, changePct24h: m.changePct24h, fundingRate: m.fundingRate, closeTime: m.closeTime, maxLeverage: m.maxLeverage })}. Hard checks (all passed): ${checks}. Objective: ${JSON.stringify(f.objective)}. Today: ${JSON.stringify(today)}. Open leads: ${JSON.stringify(this.openLeads().map((l) => ({ id: l.id, symbol: l.symbol, side: l.side, sizeUsd: l.sizeUsd })))}. Decide: clear or reject, why in one sentence, the size in dollars (at most ${maxSize}), the take-profit and stop in percent from the entry, and the time limit in hours.`, RiskOut, 600);
      if (!ans) return reject("the Risk seat gave no verdict");
      if (ans.verdict !== "clear") return reject(plainText(ans.why, 200) || "rejected by Risk");
      plan = { sizeUsd: r2(clamp(ans.sizeUsd, 0, maxSize)), tpPct: clamp(ans.tpPct || PLAN.tpPct, ...PLAN_BOUNDS.tpPct), slPct: clamp(ans.slPct || PLAN.slPct, ...PLAN_BOUNDS.slPct), maxHours: clamp(ans.maxHours || PLAN.maxHours, ...PLAN_BOUNDS.maxHours), why: plainText(ans.why, 200) };
      if (!(plan.sizeUsd > 0)) return reject("Risk cleared it at no size");
    }
    lead.state = "cleared";
    lead.sizeUsd = plan.sizeUsd;
    lead.tpPct = plan.tpPct;
    lead.slPct = plan.slPct;
    lead.maxHours = plan.maxHours;
    lead.updatedAt = this.world.now();
    this.room("risk", "clearance", `RISK CLEARANCE ${lead.id} | ${checks} | ${plan.why} | size ${usd(plan.sizeUsd)} · TP +${plan.tpPct}% · SL -${plan.slPct}% · ${plan.maxHours} h | Verdict: CLEAR → SNIPER`, { lead: lead.id, brain: !!seat || undefined });
    this.save();
    void page;
    return true;
  }

  /** the day's numbers, New York */
  private todayNumbers(): DeskView["today"] {
    const f = this.file!;
    const day = ny(Date.parse(this.world.now())).day;
    const today = f.leads.filter((l) => ny(Date.parse(l.at)).day === day);
    const closedToday = f.leads.filter((l) => l.state === "closed" && l.exit && ny(Date.parse(l.exit.at)).day === day);
    const realised = closedToday.reduce((s, l) => s + (l.pnlUsd ?? 0), 0);
    const unrealised = this.openLeads().reduce((s, l) => s + (l.unrealizedUsd ?? 0), 0);
    const pnlUsd = r2(realised + unrealised);
    const s = f.session;
    const lossRoomUsd = s ? r2(Math.max(0, s.startEquityUsd * (f.objective.maxDailyLossPct / 100) + Math.min(0, pnlUsd))) : 0;
    return { pnlUsd, wins: closedToday.filter((l) => (l.pnlUsd ?? 0) > 0).length, losses: closedToday.filter((l) => (l.pnlUsd ?? 0) <= 0).length, scanned: today.length, cleared: today.filter((l) => l.state !== "scanned" && l.state !== "rejected").length, executed: today.filter((l) => l.entry).length, closed: closedToday.length, lossRoomUsd };
  }

  // ---- Sniper ----

  private async enter(lead: Lead, venue: AccountPage["venues"][number]): Promise<boolean> {
    const f = this.file!;
    const key = this.seatKeyOf("sniper");
    const seat = f.seats.find((s) => s.role === "sniper");
    if (!seat || seat.kind !== "house" || isRefusal(key)) {
      this.room("sniper", "note", `${lead.id}: the Sniper seat is ${seat?.kind === "outside" ? "an outside agent's: it places the entry itself" : "not the house's"}; nothing placed from here.`, { lead: lead.id });
      return false;
    }
    const action = { type: "agentLiveOrder" as const, venue: venue.id, symbol: lead.symbol, side: lead.side, orderType: "market", qty: "", usd: String(lead.sizeUsd ?? 0), limitPrice: "", nonce: this.world.nonce() };
    const out = await this.world.exchange(await signAgent(key, action));
    const now = this.world.now();
    lead.updatedAt = now;
    if (isRefusal(out)) {
      lead.state = "refused";
      lead.why = `${out.code}: ${out.message}`;
      this.room("sniper", "refusal", `${lead.id}: the door refused the entry — ${out.message}`, { lead: lead.id });
      this.save();
      return false;
    }
    if (out.kind === "card") {
      lead.state = "confirmed";
      lead.card = out.card.id;
      this.room("sniper", "card", `${lead.id}: ${lead.side === "buy" ? "buy" : "sell"} ${usd(lead.sizeUsd ?? 0)} of ${lead.symbol} waits for you on ${out.card.id} (Guard).`, { lead: lead.id, refs: { card: out.card.id, symbol: lead.symbol } });
      this.save();
      return true;
    }
    if (out.kind === "order") {
      this.tookOrder(lead, out.order);
      this.room("sniper", "order", `${lead.id}: ${out.order.status === "filled" ? `filled ${out.order.filledQty} ${out.order.base} at ${out.order.avgPrice ?? out.order.price}` : `placed ${out.order.id} (${out.order.status})`} at ${venue.name} (Beast, inside the limit).`, { lead: lead.id, refs: { order: out.order.id, symbol: lead.symbol } });
      this.save();
      return true;
    }
    this.room("sniper", "note", `${lead.id}: the door answered ${out.kind}.`, { lead: lead.id });
    return false;
  }

  /** an order of the desk's, as the account has it now: the lead follows it */
  private tookOrder(lead: Lead, o: LiveOrder): void {
    lead.order = o.id;
    lead.state = "executed";
    // the desk keeps one clock, the account's: a fill is dated when the desk saw it
    if (o.filledQty > 0 && o.avgPrice !== undefined && !lead.entry) lead.entry = { price: o.avgPrice, qty: o.filledQty, at: this.world.now(), feeUsd: o.feeUsd ?? 0, contractSize: o.contractSize ?? 1 };
    else if (o.filledQty > 0 && o.avgPrice !== undefined && lead.entry) lead.entry = { ...lead.entry, price: o.avgPrice, qty: o.filledQty, feeUsd: o.feeUsd ?? lead.entry.feeUsd };
    if (["canceled", "rejected", "expired"].includes(o.status) && !(o.filledQty > 0)) {
      lead.state = "refused";
      lead.why = `the entry order ended ${o.status}${o.note ? `: ${o.note}` : ""}`;
    }
    lead.updatedAt = this.world.now();
  }

  /** the leads' orders read back from the account: entries filled, cards answered, exits filled */
  private async followOrders(): Promise<void> {
    const f = this.file;
    if (!f) return;
    const live = f.leads.filter((l) => l.state === "confirmed" || l.state === "executed" || l.state === "closing");
    if (!live.length) return;
    const page = await this.world.page();
    if (!page) return;
    let changed = false;
    for (const lead of live) {
      if (lead.state === "confirmed" && lead.card) {
        const o = page.orders.find((x) => x.card === lead.card);
        if (o) {
          const was = lead.state;
          this.tookOrder(lead, o);
          changed = true;
          if (was === "confirmed") this.room("you", "order", `You approved ${lead.card}: ${lead.id} ${o.status === "filled" ? `filled at ${o.avgPrice ?? o.price}` : `placed (${o.status})`}.`, { lead: lead.id, refs: { order: o.id, card: lead.card } });
        } else if (!page.cards.some((c) => c.id === lead.card)) {
          lead.state = "refused";
          lead.why = `you did not approve ${lead.card} (rejected, or it expired)`;
          lead.updatedAt = this.world.now();
          changed = true;
          this.room("you", "card", `${lead.card} was not approved: ${lead.id} is off the desk.`, { lead: lead.id, refs: { card: lead.card } });
        }
        continue;
      }
      if (lead.state === "executed" && lead.order) {
        const o = page.orders.find((x) => x.id === lead.order);
        if (o && (o.filledQty !== (lead.entry?.qty ?? 0) || ["canceled", "rejected", "expired"].includes(o.status))) {
          const had = lead.entry !== undefined;
          this.tookOrder(lead, o);
          changed = true;
          if (!had && lead.entry) this.room("sniper", "order", `${lead.id}: filled ${lead.entry.qty} at ${lead.entry.price}.`, { lead: lead.id, refs: { order: o.id } });
          if ((lead.state as LeadState) === "refused") this.room("sniper", "refusal", `${lead.id}: ${lead.why}`, { lead: lead.id, refs: { order: o.id } });
        }
        continue;
      }
      if (lead.state === "closing" && lead.exitOrder) {
        const o = page.orders.find((x) => x.id === lead.exitOrder);
        if (!o) continue;
        if (o.filledQty > 0 && o.avgPrice !== undefined && (o.status === "filled" || o.filledQty >= (lead.entry?.qty ?? 0))) {
          this.closed(lead, o.avgPrice, o.filledQty, o.feeUsd ?? 0);
          changed = true;
        } else if (["canceled", "rejected", "expired"].includes(o.status) && !(o.filledQty > 0)) {
          lead.state = "executed";
          delete lead.exitOrder;
          lead.updatedAt = this.world.now();
          changed = true;
          this.room("exit", "note", `${lead.id}: the close ended ${o.status}; the lead stays open.`, { lead: lead.id, refs: { order: o.id } });
        }
      }
    }
    if (changed) this.save();
  }

  private closed(lead: Lead, price: number, qty: number, feeUsd: number): void {
    const e = lead.entry;
    const dir = lead.side === "buy" ? 1 : -1;
    const q = Math.min(qty, e?.qty ?? qty);
    const gross = e ? dir * (price - e.price) * q * (e.contractSize ?? 1) : 0;
    const pnl = r2(gross - feeUsd - (e?.feeUsd ?? 0));
    lead.exit = { price, qty: q, at: this.world.now(), feeUsd };
    lead.pnlUsd = pnl;
    lead.roiPct = lead.sizeUsd ? r2((pnl / lead.sizeUsd) * 100) : 0;
    lead.state = "closed";
    delete lead.unrealizedUsd;
    lead.updatedAt = this.world.now();
    this.room("exit", "exit", `${lead.id} closed: ${lead.exitWhy ?? "closed"} · ${q} ${lead.symbol} at ${price} · ${usd(pnl)} (${pct(lead.roiPct)} on ${usd(lead.sizeUsd ?? 0)})`, { lead: lead.id, refs: { order: lead.exitOrder, symbol: lead.symbol } });
  }

  // ---- Exit and Watch ----

  /** the open leads marked, the plan applied (take-profit, stop, time), danger watched, the brain asked about the rest. Returns how many
   * were reviewed */
  private async exits(page: AccountPage, venue: AccountPage["venues"][number] | undefined, askBrain: boolean): Promise<number> {
    const f = this.file!;
    const open = f.leads.filter((l) => l.state === "executed" && l.entry);
    if (!open.length || !venue) return 0;
    const positions = await this.world.positions(venue.id);
    const pos = isRefusal(positions) ? [] : positions;
    const nowMs = Date.parse(this.world.now());
    const toClose: Array<{ lead: Lead; why: string; from: RoleId }> = [];
    for (const lead of open) {
      const e = lead.entry!;
      const p = pos.find((x) => x.symbol === lead.symbol);
      let mark = p?.markPrice;
      if (mark === undefined) {
        const m = await this.world.market(venue.id, lead.symbol);
        if (!isRefusal(m)) mark = m.price ?? (lead.side === "buy" ? m.bid : m.ask);
      }
      if (mark === undefined) {
        this.room("watch", "warning", `${lead.id}: no mark for ${lead.symbol} — the venue did not price it this cycle.`, { lead: lead.id });
        continue;
      }
      const dir = lead.side === "buy" ? 1 : -1;
      const movePct = (dir * (mark - e.price) * 100) / e.price;
      const unrealised = p && p.unrealizedUsd !== undefined && Math.abs(p.qty - e.qty) < 1e-9 ? p.unrealizedUsd : dir * (mark - e.price) * e.qty * (e.contractSize ?? 1);
      lead.markPrice = mark;
      lead.unrealizedUsd = r2(unrealised);
      lead.markAt = this.world.now();
      const hours = (nowMs - Date.parse(e.at)) / HOUR;
      if (lead.tpPct !== undefined && movePct >= lead.tpPct) toClose.push({ lead, why: `TP HIT at ${mark} (${pct(movePct)})`, from: "exit" });
      else if (lead.slPct !== undefined && movePct <= -lead.slPct) toClose.push({ lead, why: `stop at ${mark} (${pct(movePct)})`, from: "exit" });
      else if (lead.maxHours !== undefined && hours >= lead.maxHours) toClose.push({ lead, why: `time limit: ${Math.round(hours)} h open (${pct(movePct)})`, from: "exit" });
      else if (p?.liquidationPrice !== undefined && p.liquidationPrice > 0) {
        const dist = (Math.abs(mark - p.liquidationPrice) / mark) * 100;
        if (dist < 3) toClose.push({ lead, why: `liquidation ${dist.toFixed(1)}% away at ${p.liquidationPrice}`, from: "watch" });
      }
    }
    const rest = open.filter((l) => !toClose.some((c) => c.lead === l) && l.markPrice !== undefined);
    if (askBrain && rest.length) {
      const seat = f.seats.find((s) => s.role === "exit");
      if (seat) {
        const ans = await this.think("exit", seat.charter, `Open leads at ${venue.name}: ${JSON.stringify(rest.map((l) => ({ id: l.id, symbol: l.symbol, side: l.side, thesis: l.thesis, entry: l.entry!.price, mark: l.markPrice, unrealizedUsd: l.unrealizedUsd, movePct: r2((((l.side === "buy" ? 1 : -1) * (l.markPrice! - l.entry!.price)) / l.entry!.price) * 100), plan: { tpPct: l.tpPct, slPct: l.slPct, maxHours: l.maxHours }, hoursOpen: r2((nowMs - Date.parse(l.entry!.at)) / HOUR) })))}. The plan closes each at its take-profit, stop or time limit by itself. For each lead: hold, or close now with a reason (the thesis is gone, the market changed). Never add to one.`, ExitOut, 600);
        for (const d of ans?.decisions ?? []) {
          const lead = rest.find((l) => l.id === d.lead);
          if (lead && d.action === "close") toClose.push({ lead, why: `${plainText(d.why, 160) || "closed early"} (Exit)`, from: "exit" });
          else if (lead && d.why) this.room("exit", "note", `${lead.id}: hold — ${plainText(d.why, 160)}`, { lead: lead.id, brain: true });
        }
      }
    }
    for (const c of toClose) await this.close(c.lead, venue, c.why, c.from);
    this.save();
    return open.length;
  }

  private async close(lead: Lead, venue: AccountPage["venues"][number], why: string, from: RoleId): Promise<void> {
    const f = this.file!;
    const seat = f.seats.find((s) => s.role === from) ?? f.seats.find((s) => s.role === "exit");
    const key = seat && seat.kind === "house" ? this.seatKeyOf(seat.role) : undefined;
    if (!seat || !key || isRefusal(key)) {
      this.room(from, "warning", `${lead.id}: ${why} — no house seat to close it from here.`, { lead: lead.id });
      return;
    }
    const e = lead.entry!;
    const perp = lead.kind === "perp";
    const action: AgentAction = perp
      ? { type: "agentLiveClose", venue: venue.id, symbol: lead.symbol, qty: "", nonce: this.world.nonce() }
      : { type: "agentLiveOrder", venue: venue.id, symbol: lead.symbol, side: lead.side === "buy" ? "sell" : "buy", orderType: "market", qty: String(e.qty), usd: "", limitPrice: "", nonce: this.world.nonce() };
    const out = await this.world.exchange(await signAgent(key, action));
    lead.exitWhy = why;
    lead.updatedAt = this.world.now();
    if (isRefusal(out)) {
      this.room(seat.role, "refusal", `${lead.id}: ${why} — the door refused the close: ${out.message}`, { lead: lead.id });
      return;
    }
    if (out.kind === "card") {
      lead.state = "closing";
      lead.exitOrder = undefined;
      lead.card = out.card.id;
      this.room(seat.role, "card", `${lead.id}: ${why} — the close waits for you on ${out.card.id} (Guard).`, { lead: lead.id, refs: { card: out.card.id } });
      return;
    }
    if (out.kind === "order") {
      lead.state = "closing";
      lead.exitOrder = out.order.id;
      if (out.order.filledQty > 0 && out.order.avgPrice !== undefined && out.order.status === "filled") this.closed(lead, out.order.avgPrice, out.order.filledQty, out.order.feeUsd ?? 0);
      else this.room(seat.role, "exit", `${lead.id}: ${why} — closing (${out.order.id}, ${out.order.status}).`, { lead: lead.id, refs: { order: out.order.id } });
    }
  }

  // ---- the equity, the halt ----

  private async markEquity(): Promise<void> {
    const f = this.file;
    if (!f || !f.session) return;
    this.lastEquityAt = Date.parse(this.world.now());
    const eq = this.equityNow();
    const last = f.equity[f.equity.length - 1];
    if (!last || last[1] !== eq || this.lastEquityAt - last[0] >= 5 * 60_000) {
      f.equity.push([this.lastEquityAt, eq]);
      if (f.equity.length > MAX_EQUITY_POINTS) f.equity = f.equity.filter((_, i) => i % 2 === 0 || i >= f.equity.length - 100);
      this.save();
    }
  }

  private equityNow(): number {
    const f = this.file!;
    const s = f.session!;
    const since = Date.parse(s.startedAt);
    const realised = f.leads.filter((l) => l.state === "closed" && l.exit && Date.parse(l.exit.at) >= since).reduce((x, l) => x + (l.pnlUsd ?? 0), 0);
    const unrealised = this.openLeads().reduce((x, l) => x + (l.unrealizedUsd ?? 0), 0);
    return r2(s.startEquityUsd + realised + unrealised);
  }

  private checkHalt(): boolean {
    const f = this.file!;
    const s = f.session!;
    if (s.halted) return true;
    const today = this.todayNumbers();
    const line = -s.startEquityUsd * (f.objective.maxDailyLossPct / 100);
    if (today.pnlUsd > line) return false;
    const until = new Date(nextNyMidnight(Date.parse(this.world.now()))).toISOString();
    s.halted = { at: this.world.now(), why: `the day's loss reached ${usd(today.pnlUsd)} (the line is ${usd(line)})`, until };
    this.save();
    this.room("head", "halt", `HALT: ${s.halted.why}. No new lead until ${this.when(until)}; open leads keep their plan.`);
    return true;
  }

  private when(iso: string | undefined): string {
    if (!iso) return "—";
    const ms = Date.parse(iso);
    const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value])) as Record<string, string>;
    return `${p.weekday} ${p.hour}:${p.minute} New York`;
  }

  // ---- the Head: reports and the review ----

  private async report(kind: DeskReport["kind"], force = false): Promise<void> {
    const f = this.file;
    if (!f) return;
    const now = this.world.now();
    const t = this.todayNumbers();
    const eq = f.session ? this.equityNow() : 0;
    const open = this.openLeads();
    const funnel = this.funnel();
    const closedAll = f.leads.filter((l) => l.state === "closed");
    const best = [...closedAll].sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0];
    const worst = [...closedAll].sort((a, b) => (a.pnlUsd ?? 0) - (b.pnlUsd ?? 0))[0];
    let text: string;
    if (kind === "start") text = `MORNING STATUS — Session of ${f.objective.hours} h from ${usd(f.session?.startEquityUsd ?? 0)} at ${this.world.venueName(f.objective.venue)}. Objective: “${f.objective.text}”. Target ${pct(f.objective.targetPct)} · at most ${f.objective.maxRiskPct}% a lead · halt at -${f.objective.maxDailyLossPct}% in a day · a cycle every ${f.objective.everyMin} min · report at ${f.objective.reportAt} New York. Seats: ${f.seats.map((s) => ROLE_SPECS[s.role].tag).join(" · ")}.`;
    else {
      const head = kind === "end" ? "SESSION REPORT" : kind === "weekly" ? "WEEKLY REVIEW" : "EVENING REPORT";
      const lines = [`${head} — Scanned: ${t.scanned} · Cleared: ${t.cleared} · Executed: ${t.executed} · Closed today: ${t.closed} · Open now: ${open.length}`, `PnL today: ${usd(t.pnlUsd)} · Session: ${usd(eq - (f.session?.startEquityUsd ?? eq))} (${pct(f.session && f.session.startEquityUsd ? ((eq - f.session.startEquityUsd) / f.session.startEquityUsd) * 100 : 0)}) · Win rate: ${t.wins + t.losses ? Math.round((t.wins / (t.wins + t.losses)) * 100) : 0}% (${t.wins}W ${t.losses}L)`, `Funnel (session): ${funnel.scanned} scanned → ${funnel.cleared} cleared → ${funnel.confirmed} confirmed → ${funnel.executed} executed → ${funnel.closed} closed · ${funnel.rejected} rejected`, best ? `Best: ${best.symbol} ${usd(best.pnlUsd ?? 0)}` : "", worst && worst !== best ? `Worst: ${worst.symbol} ${usd(worst.pnlUsd ?? 0)}` : "", `Brain: ${f.spend.calls} calls · about ${usd(f.spend.usd)}`].filter(Boolean);
      const seat = f.seats.find((s) => s.role === "head");
      if (seat && this.brain.ready().ok && (force || t.scanned + t.closed > 0)) {
        const ans = await this.think("head", seat.charter, `Write the two sentences of the ${head.toLowerCase()} from these numbers only: ${JSON.stringify({ today: t, open: open.map((l) => ({ id: l.id, symbol: l.symbol, unrealizedUsd: l.unrealizedUsd })), closedToday: closedAll.filter((l) => l.exit && ny(Date.parse(l.exit.at)).day === ny(Date.parse(now)).day).map((l) => ({ id: l.id, symbol: l.symbol, pnlUsd: l.pnlUsd, why: l.exitWhy })), rejectedToday: f.leads.filter((l) => l.state === "rejected" && ny(Date.parse(l.at)).day === ny(Date.parse(now)).day).map((l) => ({ id: l.id, symbol: l.symbol, why: l.why })), objective: f.objective })}. "worked": one thing that worked today, named by lead id. "change": one change for tomorrow. Plain sentences, no numbers the input does not have.`, ReportOut, 400);
        if (ans) lines.push(`One thing that worked: ${plainText(ans.worked, 240)}`, `One change for tomorrow: ${plainText(ans.change, 240)}`);
      }
      text = lines.join("\n");
    }
    f.reports.push({ at: now, kind, text });
    if (kind === "evening") f.reported = ny(Date.parse(now)).day;
    this.save();
    this.room("head", "report", text);
  }

  private async review(): Promise<void> {
    const f = this.file;
    if (!f) return;
    const now = this.world.now();
    f.reviewed = ny(Date.parse(now)).day;
    const week = f.leads.filter((l) => Date.parse(l.at) >= Date.parse(now) - 7 * DAY);
    const closed = week.filter((l) => l.state === "closed");
    const refused = week.filter((l) => l.state === "refused").length;
    const days = this.daysWithoutRefusal();
    const lines = [`WEEKLY REVIEW — ${week.length} leads this week · ${closed.length} closed · ${closed.filter((l) => (l.pnlUsd ?? 0) > 0).length} won · ${usd(closed.reduce((s, l) => s + (l.pnlUsd ?? 0), 0))} · ${refused} refused at the door · days without a refusal: ${days}`];
    const seat = f.seats.find((s) => s.role === "head");
    if (seat && this.brain.ready().ok) {
      const ans = await this.think("head", seat.charter, `The week's leads: ${JSON.stringify(week.map((l) => ({ id: l.id, symbol: l.symbol, state: l.state, why: l.why, pnlUsd: l.pnlUsd, exitWhy: l.exitWhy })))}. Seats: ${f.seats.map((s) => s.role).join(", ")}. For each seat, one sentence on how it did this week; then "prune": the one thing to stop doing. Numbers only from the input.`, ReviewOut, 600);
      if (ans) lines.push(...ans.roles.map((r) => `${String(r.role).toUpperCase()}: ${plainText(r.verdict, 200)}`), `Prune: ${plainText(ans.prune, 200)}`);
    }
    const text = lines.join("\n");
    f.reports.push({ at: now, kind: "weekly", text });
    this.save();
    this.room("head", "review", text);
  }

  /** whole New York days since the door last refused a lead's order, counted from the session's start */
  private daysWithoutRefusal(): number {
    const f = this.file!;
    const since = f.session ? Date.parse(f.session.startedAt) : Date.parse(f.createdAt);
    const last = f.leads.filter((l) => l.state === "refused").map((l) => Date.parse(l.updatedAt)).sort((a, b) => b - a)[0];
    return Math.floor((Date.parse(this.world.now()) - Math.max(since, last ?? 0)) / DAY);
  }

  private funnel(): DeskView["funnel"] {
    const f = this.file;
    const since = f?.session ? Date.parse(f.session.startedAt) : 0;
    const leads = (f?.leads ?? []).filter((l) => Date.parse(l.at) >= since);
    const past = (states: LeadState[]) => leads.filter((l) => states.includes(l.state)).length;
    return { scanned: leads.length, cleared: past(["cleared", "confirmed", "executed", "closing", "closed", "refused"]), confirmed: past(["confirmed", "executed", "closing", "closed"]), executed: leads.filter((l) => l.entry).length, closed: past(["closed"]), rejected: past(["rejected"]) };
  }

  // ---- the brain, asked ----

  private async think<T>(role: RoleId, charter: Charter, input: string, schema: z.ZodType<T>, maxTokens: number): Promise<T | null> {
    const f = this.file!;
    const spec = ROLE_SPECS[role];
    const system = `You are ${spec.tag}, the ${spec.name} on a trading desk that an account runs for its owner. The account enforces every limit: a seat trades only with a key the owner let in and inside a limit the owner signed, in Guard every order waits for the owner on a card. Your charter — owns: ${charter.owns} Good output: ${charter.good} Never: ${charter.never} The desk's objective this week: "${f.objective.text}". Decide only from the data given; name no number the data does not have; answer in the JSON shape asked for and nothing else.`;
    try {
      const a = await this.brain.decide({ role, brain: f.brain, system, input, schema, maxTokens });
      f.spend.calls++;
      f.spend.inputTokens += a.usage.inputTokens;
      f.spend.outputTokens += a.usage.outputTokens;
      const cost = costOf(f.brain, this.brain.models, a.usage.inputTokens, a.usage.outputTokens);
      if (cost === undefined) f.spend.unpricedTokens = (f.spend.unpricedTokens ?? 0) + a.usage.inputTokens + a.usage.outputTokens;
      else f.spend.usd += cost;
      if (!a.out && a.why) this.room(role, "note", `No decision: ${plainText(a.why, 200)}`);
      return a.out;
    } catch (err) {
      this.room(role, "note", `The brain did not answer: ${plainText((err as Error)?.message ?? err, 200)}`);
      return null;
    }
  }

  // ---- what the page and a seat read ----

  async view(): Promise<DeskView | undefined> {
    const f = this.file;
    if (!f) return undefined;
    const page = await this.world.page();
    const nowMs = Date.parse(this.world.now());
    const standing = page ? this.standing(page) : new Map<RoleId, { status: "ok" | "not let in" | "expired" | "revoked"; limit?: { perOrderUsd: number; leftUsd: number; budgetUsd: number; venues: string[] } | undefined; cards: number }>();
    const s = f.session;
    const state = !s || s.endedAt ? "ended" : s.halted ? "halted" : s.pausedAt ? "paused" : "live";
    const start = s?.startEquityUsd ?? 0;
    const now = s ? this.equityNow() : 0;
    const change = r2(now - start);
    const closed = f.leads.filter((l) => l.state === "closed" && l.exit && (!s || Date.parse(l.exit.at) >= Date.parse(s.startedAt)));
    const wins = closed.filter((l) => (l.pnlUsd ?? 0) > 0);
    const losses = closed.filter((l) => (l.pnlUsd ?? 0) <= 0);
    const avg = (xs: Lead[]) => (xs.length ? r2(xs.reduce((a, l) => a + (l.roiPct ?? 0), 0) / xs.length) : 0);
    const targetUsd = r2(start * (f.objective.targetPct / 100));
    const venueRow = page?.venues.find((v) => v.id === f.objective.venue);
    const cards = (page?.cards ?? []).filter((c) => f.seats.some((x) => x.address === c.agent)).map((c) => ({ id: c.id, lead: f.leads.find((l) => l.card === c.id)?.id, reason: c.reason, usd: c.usd }));
    const at = minutesOf(f.objective.reportAt);
    const nyNow = ny(nowMs);
    const reportMs = (() => {
      let t = nowMs - (nowMs % 60_000);
      // the next moment the New York clock reads reportAt
      for (let i = 0; i < 2 * 24 * 60; i++, t += 60_000) if (ny(t).minutes === at && (ny(t).day !== nyNow.day || nyNow.minutes < at)) return t;
      return t;
    })();
    const weeklyMs = (() => {
      let t = reportMs;
      for (let i = 0; i < 8; i++, t += DAY) if (ny(t).dow === 0) return t;
      return t;
    })();
    const brain = this.brain.ready();
    return {
      id: f.id,
      name: f.name,
      createdAt: f.createdAt,
      objective: f.objective,
      brain: { ...brain, provider: f.brain.provider, label: this.brain.label, model: f.brain.model, effort: f.brain.effort, ...(f.brain.price ? { price: f.brain.price } : {}), spend: { ...f.spend, usd: r2(f.spend.usd) } },
      seats: f.seats.map((x) => ({ ...x, status: standing.get(x.role)?.status ?? "not let in", limit: standing.get(x.role)?.limit, cards: standing.get(x.role)?.cards ?? 0 })),
      ...(s ? { session: { ...s, state, elapsedMs: Math.max(0, Math.min(nowMs, Date.parse(s.endedAt ?? s.endsAt)) - Date.parse(s.startedAt)), remainingMs: Math.max(0, Date.parse(s.endsAt) - nowMs) } } : {}),
      equity: { nowUsd: now, startUsd: start, changeUsd: change, changePct: start ? r2((change / start) * 100) : 0, mult: start ? Number((now / start).toFixed(3)) : 1, points: f.equity },
      target: { pct: f.objective.targetPct, progressPct: targetUsd > 0 ? r2(clamp((change / targetUsd) * 100, -100, 100)) : 0, reachedUsd: change, targetUsd },
      funnel: this.funnel(),
      today: this.todayNumbers(),
      open: this.openLeads(),
      recent: [...f.leads].reverse().filter((l) => l.state !== "executed" && l.state !== "confirmed" && l.state !== "closing").slice(0, 40),
      tape: { wins: wins.length, losses: losses.length, winRatePct: closed.length ? Math.round((wins.length / closed.length) * 100) : 0, avgWinPct: avg(wins), avgLossPct: avg(losses), closes: closed.slice(-60).map((l) => ({ id: l.id, symbol: l.symbol, pnlUsd: l.pnlUsd ?? 0, roiPct: l.roiPct ?? 0, at: l.exit!.at })) },
      big: [...closed].sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0)).slice(0, 5).map((l) => ({ id: l.id, symbol: l.symbol, side: l.side, pnlUsd: l.pnlUsd ?? 0, roiPct: l.roiPct ?? 0, at: l.exit!.at })),
      room: readRoom(this.world.home),
      routines: { everyMin: f.objective.everyMin, ...(s && state === "live" ? { nextCycleAt: new Date(Math.max(nowMs, this.lastCycleAt + f.objective.everyMin * 60_000)).toISOString() } : {}), reportAt: f.objective.reportAt, nextReportAt: new Date(reportMs).toISOString(), weeklyAt: new Date(weeklyMs).toISOString(), lastReport: f.reports[f.reports.length - 1] },
      reports: f.reports.slice(-10),
      cards,
      venue: { id: f.objective.venue, name: venueRow?.name ?? this.world.venueName(f.objective.venue), usd: venueRow?.usd ?? 0, paper: venueRow?.paper === true, connected: venueRow?.live === true },
    };
  }

  /** what hiring offers: the roles with their charters, the house seats' keys, the brain's standing */
  catalog(): DeskCatalog {
    const seats: Partial<Record<RoleId, Hex>> = {};
    for (const r of ROLES) {
      if (!ROLE_SPECS[r].house) continue;
      const k = this.seatKeyOf(r);
      if (!isRefusal(k)) seats[r] = k.address as Hex;
    }
    const b = this.file?.brain;
    const brains = this.brains.map((x) => ({ ...x.ready(), id: x.id, label: x.label, models: x.models }));
    const pick = b ? this.brain : (this.brains.find((x) => x.ready().ok) ?? this.brains[0]!);
    const st = pick.ready();
    return { roles: ROLES.map((r) => ROLE_SPECS[r]), seats, brain: { ...st, provider: pick.id, label: pick.label, model: b && b.provider === pick.id ? b.model : st.model || pick.models[0]?.id || "", models: pick.models, effort: b?.effort ?? DEFAULT_BRAIN.effort }, brains, universes: UNIVERSES, defaults: { universe: "all", targetPct: 3, maxRiskPct: 1, maxDailyLossPct: 5, hours: 22, everyMin: 15, reportAt: "21:00", maxOpen: 3 }, hired: this.file !== undefined };
  }

  /** the desk as a seat reads it (portfolio_desk): the seat's own charter, the objective, the funnel, the room's last lines */
  async forSeat(address: string): Promise<Record<string, unknown> | Refusal> {
    const f = this.file;
    if (!f) return no("E_ACCOUNT_BAD_ACTION", { message: "no desk is hired on this account" });
    const seat = f.seats.find((s) => s.address === address.toLowerCase());
    const v = await this.view();
    if (!v) return no("E_ACCOUNT_BAD_ACTION", { message: "no desk is hired on this account" });
    return { desk: v.name, objective: v.objective, session: v.session ? { state: v.session.state, startedAt: v.session.startedAt, endsAt: v.session.endsAt, halted: v.session.halted } : undefined, yourSeat: seat ? { role: seat.role, name: ROLE_SPECS[seat.role].name, charter: seat.charter, trades: ROLE_SPECS[seat.role].trades } : null, seats: f.seats.map((s) => ({ role: s.role, kind: s.kind, name: s.name })), funnel: v.funnel, today: v.today, open: v.open.map((l) => ({ id: l.id, symbol: l.symbol, side: l.side, sizeUsd: l.sizeUsd, entry: l.entry?.price, mark: l.markPrice, unrealizedUsd: l.unrealizedUsd, plan: { tpPct: l.tpPct, slPct: l.slPct, maxHours: l.maxHours } })), room: v.room.slice(-40).map((m) => ({ seq: m.seq, at: m.at, from: m.from, kind: m.kind, lead: m.lead, text: m.text })) };
  }
}
