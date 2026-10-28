/** SIGNING IN WITH GITHUB before a paper account is opened, and the owner's hi in the project's thread — GitHub's device flow, read
 * 2026-10-21 (docs.github.com: "Generating a user access token for a GitHub App", "Authorizing OAuth apps" § device flow):
 *
 *   code     POST github.com/login/device/code {client_id}        → device_code, user_code, verification_uri, expires_in, interval
 *   approve  the user types user_code at github.com/login/device, in their own browser, signed in to GitHub there — never here
 *   token    POST github.com/login/oauth/access_token {client_id, device_code, grant_type}, every `interval` seconds, until it answers a
 *            token or authorization_pending · slow_down (5 s more) · expired_token · access_denied · device_flow_disabled
 *   who      GET api.github.com/user → login, id, name, avatar. Nothing else of it is read: never the email
 *   hello    GraphQL addDiscussionComment in the project's pinned thread — only on the owner's signature (account/exchange.ts
 *            githubHello), with words the account makes (helloWords), once from a machine
 *
 * Gravit is open source and runs on each user's machine, so it holds no secret: a GitHub App's device flow needs only its client id, which
 * is public. The app's one permission — Discussions, read and write, on the one repository it is installed on — is all a token from it can
 * do: nothing in the user's own repositories, nothing of their account beyond the public profile.
 *
 * The token lasts eight hours and stays in this process's memory — never on disk, in the ledger, a log line, a view or the page — and the
 * refresh token GitHub sends beside it is not kept. What is kept is who signed in (account/github-identity.ts), so a restart leaves them
 * signed in for opening paper accounts; saying hi after a restart asks for a new sign-in. Signing out here forgets both; the authorization
 * itself is GitHub's, and the user revokes it there (Settings → Applications → Authorized GitHub Apps): revoking one takes the app's secret,
 * which nothing here has.
 */
import { randomBytes } from "node:crypto";
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { avatarOf, cleanName, forgetIdentity, keepHello, keepIdentity, LOGIN, readGitHubFile, type GitHubFile, type GitHubIdentity } from "../account/github-identity.ts";
import { no } from "../refuse.ts";
import { networkNo, rateLimitedNo, unreachable, venueSaidNo, type Http, type HttpReply } from "./types.ts";

/** THE APP THIS BUILD SIGNS IN WITH. Its client id is public (GitHub's device flow needs no secret); empty, no sign-in is asked for and a
 * paper account opens as it always has. `discussion`: the number of the pinned thread in `repo` where the owner may say hi (0: none) */
export const GITHUB_APP = { clientId: "", repo: "linqizhe07/account", discussion: 0 };

export interface GitHubConfig {
  clientId: string;
  repo: string;
  /** the thread's number; 0: there is no thread to say hi in */
  discussion: number;
}

const CLIENT_ID = /^[A-Za-z0-9._-]{8,64}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** The sign-in this server asks for: the build's app (GITHUB_APP), or the one its environment names — PORTFOLIO_GITHUB_CLIENT_ID (empty:
 * none), PORTFOLIO_GITHUB_REPO, PORTFOLIO_GITHUB_DISCUSSION — for a fork with its own app. A value that is not one is said through `warn`
 * and the build's is used. Undefined: no client id, so no sign-in is asked for */
export function githubConfig(env: NodeJS.ProcessEnv = process.env, warn: (line: string) => void = () => undefined): GitHubConfig | undefined {
  const pick = <T>(name: string, fallback: T, read: (raw: string) => T | undefined): T => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const v = read(raw.trim());
    if (v === undefined) warn(`${name} is not one (${JSON.stringify(raw.slice(0, 40))}): the build's own is used`);
    return v ?? fallback;
  };
  const clientId = pick("PORTFOLIO_GITHUB_CLIENT_ID", GITHUB_APP.clientId, (s) => (s === "" || CLIENT_ID.test(s) ? s : undefined));
  if (!clientId) return undefined;
  const repo = pick("PORTFOLIO_GITHUB_REPO", GITHUB_APP.repo, (s) => (REPO.test(s) ? s : undefined));
  const discussion = pick("PORTFOLIO_GITHUB_DISCUSSION", GITHUB_APP.discussion, (s) => (/^\d{1,9}$/.test(s) ? Number(s) : undefined));
  return { clientId, repo, discussion };
}

/** the hi, word for word: what the owner sees beside the box and signs, and what the thread gets */
export const helloWords = (login: string): string => `👋 @${login} started a paper account`;
/** the thread, on github.com */
export const threadUrl = (c: Pick<GitHubConfig, "repo" | "discussion">): string => `https://github.com/${c.repo}/discussions/${c.discussion}`;

/** what a connection to live:paper answers while nobody is signed in (live/reach.ts: setup) */
export const PAPER_SETUP_WORDS = "Sign in with GitHub first: opening a paper account asks for it (one kept on this machine continues without it)";
/** the door's refusal of a new paper account while nobody is signed in */
export const paperGateNo = (venue: string): Refusal => no("E_ACCOUNT_CREDENTIAL", { venue, message: "Opening a paper account asks you to sign in with GitHub first: sign in on the paper account's form, then open it. A paper account kept on this machine continues without it", detail: { github: "sign-in" } });

export const DEVICE_URL = "https://github.com/login/device";
const CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const GRAPHQL_URL = "https://api.github.com/graphql";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const UA = "Gravit-Account";
const TIMEOUT_MS = 8_000;
const VENUE = "github";
const NAME = "GitHub";
/** a code GitHub shows the user: two groups of letters and digits, "WDJB-MJHT" */
const USER_CODE = /^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})?$/;
const OPAQUE = /^[\x21-\x7e]{8,512}$/;
/** the longest a token is kept: GitHub's user tokens last eight hours */
const TOKEN_MS = 8 * 3_600_000;

const FORM = { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": UA };
const api = (token: string): Record<string, string> => ({ accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": UA, "x-github-api-version": "2022-11-28" });
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const whole = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

/** a sign-in that GitHub no longer takes (expired, or revoked by the user): signing in again is the way */
const endedNo = (): Refusal => no("E_ACCOUNT_CREDENTIAL", { venue: VENUE, message: "GitHub no longer takes this sign-in (it lasts 8 hours, and can be revoked on GitHub): sign in with GitHub again", detail: { github: "sign-in" } });

/** what GitHub's device flow says when it says no, in the account's words (its error codes: docs.github.com § device flow) */
const OAUTH_WORDS: Record<string, string> = {
  device_flow_disabled: "GitHub says this app's device sign-in is turned off: the app's owner turns on Device Flow in its settings on GitHub",
  incorrect_client_credentials: "GitHub does not know this build's app (its client id): the sign-in cannot start",
  incorrect_device_code: "GitHub does not know this sign-in's code any more: get a new code",
  unsupported_grant_type: "GitHub did not take the sign-in's request as a device sign-in",
  access_denied: "The sign-in was cancelled on GitHub's page: nobody was signed in",
  expired_token: "The code expired before it was entered: get a new code",
};
const oauthNo = (error: string, status: number): Refusal => no(error === "incorrect_client_credentials" ? "E_ACCOUNT_CREDENTIAL" : "E_VENUE_REJECTED", { venue: VENUE, message: OAUTH_WORDS[error] ?? `GitHub refused the sign-in (${error.replace(/[^a-z_]/g, "").slice(0, 40)})`, native: { status, error: error.slice(0, 60) } });

/** an answer that is not the one asked for, in the account's words: a sign-in GitHub no longer takes, a rate limit (GitHub's secondary
 * limits answer 403), GitHub not answering, or its no */
function githubNo(r: HttpReply, secrets: Array<string | undefined>): Refusal {
  if (r.status === 401) return endedNo();
  if ((r.status === 403 || r.status === 429) && /rate limit/i.test(r.text)) return rateLimitedNo(VENUE, NAME, r.retryAfterMs, { status: r.status });
  // GitHub's own words are not kept: a refusal lands in the ledger, and they may name who is signed in
  if (r.status === 403) return no("E_VENUE_REJECTED", { venue: VENUE, message: "GitHub refused: this sign-in may not do that (HTTP 403)", native: { status: 403 } });
  return venueSaidNo(VENUE, NAME, r.status, r.text, secrets, r);
}

/** one request to GitHub: its answer, or why there was none (the network's own refusal, said as the network's) */
async function ask(http: Http, url: string, init: Parameters<Http>[1], secrets: Array<string | undefined>): Promise<HttpReply | Refusal> {
  let r: HttpReply;
  try {
    r = await http(url, { ...init, timeoutMs: TIMEOUT_MS });
  } catch (err) {
    return unreachable(VENUE, NAME, err, secrets);
  }
  return networkNo(VENUE, NAME, r, { status: r.status }) ?? (r.status >= 500 ? no("E_VENUE_UNREACHABLE", { venue: VENUE, message: "GitHub did not answer just now", native: { status: r.status } }) : r);
}

export interface DeviceCode {
  /** GitHub's handle for this sign-in: never leaves this process */
  deviceCode: string;
  /** what the user types at github.com/login/device */
  userCode: string;
  expiresInS: number;
  intervalS: number;
}

/** a new code to sign in with */
export async function startDevice(http: Http, clientId: string): Promise<DeviceCode | Refusal> {
  const r = await ask(http, CODE_URL, { method: "POST", headers: FORM, body: new URLSearchParams({ client_id: clientId }).toString() }, []);
  if (isRefusal(r)) return r;
  const b = obj(r.body);
  if (typeof b.error === "string") return oauthNo(b.error, r.status);
  const userCode = typeof b.user_code === "string" ? b.user_code.toUpperCase() : "";
  // a code to type somewhere else than GitHub's own page is not GitHub's answer
  if (r.status !== 200 || typeof b.device_code !== "string" || !OPAQUE.test(b.device_code) || !USER_CODE.test(userCode) || b.verification_uri !== DEVICE_URL) {
    if (r.status !== 200) return githubNo(r, []);
    return no("E_VENUE_REJECTED", { venue: VENUE, message: "GitHub answered the request for a sign-in code with something that is not one", native: { status: r.status } });
  }
  return { deviceCode: b.device_code, userCode, expiresInS: whole(b.expires_in, 60, 1800, 900), intervalS: whole(b.interval, 1, 60, 5) };
}

export type DevicePoll =
  | { kind: "token"; token: string; expiresInS: number }
  | { kind: "pending" }
  /** asked too often: wait 5 s more each time from now on (or as long as GitHub says) */
  | { kind: "slow"; intervalS: number | undefined }
  | { kind: "expired" }
  | { kind: "denied" }
  /** GitHub's no to this sign-in: it ends */
  | { kind: "refused"; refusal: Refusal }
  /** no answer just now (the network, a rate limit, GitHub down): asked again at the next turn, or after as long as GitHub asked */
  | { kind: "quiet"; refusal: Refusal; waitMs?: number | undefined };

/** has the user entered the code yet: one question to GitHub */
export async function pollDevice(http: Http, clientId: string, deviceCode: string): Promise<DevicePoll> {
  const r = await ask(http, TOKEN_URL, { method: "POST", headers: FORM, body: new URLSearchParams({ client_id: clientId, device_code: deviceCode, grant_type: GRANT }).toString() }, [deviceCode]);
  if (isRefusal(r)) return r.code === "E_VENUE_UNREACHABLE" ? { kind: "quiet", refusal: r, waitMs: untilOf(r) } : { kind: "refused", refusal: r };
  const b = obj(r.body);
  const error = typeof b.error === "string" ? b.error : "";
  if (error === "authorization_pending") return { kind: "pending" };
  if (error === "slow_down") return { kind: "slow", intervalS: typeof b.interval === "number" ? whole(b.interval, 1, 120, 10) : undefined };
  if (error === "expired_token") return { kind: "expired" };
  if (error === "access_denied") return { kind: "denied" };
  if (error) return { kind: "refused", refusal: oauthNo(error, r.status) };
  // the refresh token beside it is never read
  if (r.status === 200 && typeof b.access_token === "string" && OPAQUE.test(b.access_token)) return { kind: "token", token: b.access_token, expiresInS: whole(b.expires_in, 60, TOKEN_MS / 1000, TOKEN_MS / 1000) };
  if (r.status !== 200) return { kind: "refused", refusal: githubNo(r, [deviceCode]) };
  return { kind: "refused", refusal: no("E_VENUE_REJECTED", { venue: VENUE, message: "GitHub answered the sign-in with something that is not a token", native: { status: r.status } }) };
}
const untilOf = (r: Refusal): number | undefined => {
  const until = (r.native as { until?: unknown } | undefined)?.until;
  return typeof until === "number" ? Math.max(0, until - Date.now()) : undefined;
};

/** who the token is: login, id, name and avatar — read from the public profile GitHub answers, and nothing else of it */
export async function whoami(http: Http, token: string): Promise<Omit<GitHubIdentity, "at"> | Refusal> {
  const r = await ask(http, USER_URL, { headers: api(token) }, [token]);
  if (isRefusal(r)) return r;
  if (r.status !== 200) return githubNo(r, [token]);
  const b = obj(r.body);
  if (typeof b.login !== "string" || !LOGIN.test(b.login) || !Number.isSafeInteger(b.id) || (b.id as number) <= 0) return no("E_VENUE_REJECTED", { venue: VENUE, message: "GitHub's answer about who signed in is not one this can read", native: { status: r.status } });
  const name = cleanName(b.name);
  const avatarUrl = avatarOf(b.avatar_url);
  return { login: b.login, id: b.id as number, ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
}

/** GraphQL's own refusals (its `errors[].type`), in the account's words */
function graphNo(e: Record<string, unknown>, c: Pick<GitHubConfig, "repo" | "discussion">): Refusal {
  const type = typeof e.type === "string" ? e.type.replace(/[^A-Z_]/g, "").slice(0, 40) : "";
  // its type only: GitHub's words are not kept (a refusal lands in the ledger, and they may name who is signed in)
  const native = { type };
  if (type === "RATE_LIMITED") return rateLimitedNo(VENUE, NAME, undefined, native);
  if (type === "FORBIDDEN" || type === "INSUFFICIENT_SCOPES") return no("E_VENUE_REJECTED", { venue: VENUE, message: `GitHub refused: this sign-in may not comment in ${c.repo} (the app must be installed there, with access to its Discussions). Nothing was posted`, native });
  if (type === "NOT_FOUND") return no("E_VENUE_REJECTED", { venue: VENUE, message: `GitHub does not find ${c.repo} or its discussion #${c.discussion}. Nothing was posted`, native });
  return no("E_VENUE_REJECTED", { venue: VENUE, message: `GitHub refused the comment${type ? ` (${type})` : ""}. Nothing was posted`, native });
}

async function graphql(http: Http, token: string, query: string, variables: Record<string, unknown>, c: Pick<GitHubConfig, "repo" | "discussion">): Promise<Record<string, unknown> | Refusal> {
  const r = await ask(http, GRAPHQL_URL, { method: "POST", headers: { ...api(token), "content-type": "application/json" }, body: JSON.stringify({ query, variables }) }, [token]);
  if (isRefusal(r)) return r;
  const b = obj(r.body);
  const errors = Array.isArray(b.errors) ? b.errors : [];
  if (r.status === 200 && errors.length) return graphNo(obj(errors[0]), c);
  if (r.status !== 200) return githubNo(r, [token]);
  return obj(b.data);
}

/** Say hi in the thread: the thread checked first (Discussions on, the discussion there, not locked), then one comment. Answers the
 * comment's address — or, when GitHub took it and did not say where, the thread's: it was posted, and is never posted twice for that */
export async function postHello(http: Http, token: string, c: Pick<GitHubConfig, "repo" | "discussion">, body: string): Promise<{ url: string } | Refusal> {
  const [owner, name] = c.repo.split("/");
  const q = await graphql(http, token, "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){hasDiscussionsEnabled discussion(number:$number){id locked}}}", { owner, name, number: c.discussion }, c);
  if (isRefusal(q)) return q;
  const repo = q.repository === null || q.repository === undefined ? undefined : obj(q.repository);
  if (!repo) return no("E_VENUE_REJECTED", { venue: VENUE, message: `GitHub does not show ${c.repo} to this sign-in. Nothing was posted` });
  if (repo.hasDiscussionsEnabled !== true) return no("E_VENUE_REJECTED", { venue: VENUE, message: `Discussions are turned off in ${c.repo}. Nothing was posted` });
  const d = obj(repo.discussion);
  if (typeof d.id !== "string" || !d.id) return no("E_VENUE_REJECTED", { venue: VENUE, message: `There is no discussion #${c.discussion} in ${c.repo}. Nothing was posted` });
  if (d.locked === true) return no("E_VENUE_REJECTED", { venue: VENUE, message: `The thread ${c.repo}#${c.discussion} is locked. Nothing was posted` });
  let r: HttpReply;
  try {
    r = await http(GRAPHQL_URL, { method: "POST", headers: { ...api(token), "content-type": "application/json" }, body: JSON.stringify({ query: "mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{url}}}", variables: { id: d.id, body } }), timeoutMs: TIMEOUT_MS });
  } catch (err) {
    // the comment may have been posted before the answer was lost: said so, so it is looked for before it is said again
    const u = unreachable(VENUE, NAME, err, [token]);
    return no("E_VENUE_UNREACHABLE", { venue: VENUE, message: `GitHub did not answer in time: the comment may or may not be in the thread. Look at ${threadUrl(c)} before saying hi again`, ...(u.native !== undefined ? { native: u.native } : {}) });
  }
  const net = networkNo(VENUE, NAME, r, { status: r.status });
  if (net) return net;
  const b = obj(r.body);
  const errors = Array.isArray(b.errors) ? b.errors : [];
  if (r.status === 200 && errors.length) return graphNo(obj(errors[0]), c);
  if (r.status !== 200) return githubNo(r, [token]);
  const url = obj(obj(obj(b.data).addDiscussionComment).comment).url;
  return { url: typeof url === "string" && url.startsWith(`${threadUrl(c)}#`) && url.length <= 300 ? url : threadUrl(c) };
}

// ---- the sign-in, as this server keeps it ------------------------------------------------------------------------------------------

interface Waiting {
  /** the page's handle for it: random, and nothing GitHub knows */
  id: string;
  deviceCode: string;
  userCode: string;
  at: number;
  expiresAt: number;
  intervalMs: number;
  /** GitHub answered a token and who it is did not come back yet: asked again at the next turn, the token kept until then */
  token?: { value: string; expiresInS: number } | undefined;
  cancel?: (() => void) | undefined;
}

/** what the page is shown: who is signed in, a code waiting to be entered, how the last one ended, and the hi. Never a token, never
 * GitHub's device code */
export interface GitHubView {
  on: true;
  repo: string;
  /** the thread hi goes to, when there is one */
  thread?: string | undefined;
  signedIn?: { login: string; name?: string | undefined; avatarUrl?: string | undefined; at: string } | undefined;
  waiting?: { id: string; code: string; verify: string; expiresAt: number } | undefined;
  /** how the last code ended when nobody signed in with it: until the next one */
  ended?: { id: string; state: "failed" | "expired"; said: string } | undefined;
  /** the hi: its words for who is signed in, whether it can be said now (and why not), and where it was said */
  hello?: { words?: string | undefined; can: boolean; why?: string | undefined; said?: { url: string; at: string } | undefined } | undefined;
}

export interface GitHubSignInOptions {
  home: string;
  config: GitHubConfig;
  http: Http;
  clock: () => number;
  /** someone signed in or out, a code came or ended, hi was said */
  onChange?: (() => void) | undefined;
  /** run `fn` in `ms` (a test's own clock); answers how to cancel it. A timer that keeps nothing alive, by default */
  schedule?: ((fn: () => void, ms: number) => () => void) | undefined;
}

/** a new code at most this often, however many times "Get a new code" is pressed */
const NEW_CODE_MS = 10_000;

const later = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return () => clearTimeout(t);
};

/** THE GITHUB SIGN-IN of this server: one code waiting at a time, shared by every browser of the owner's; GitHub asked from here at its
 * own pace until the code is entered, refused or expired; the token in memory; who signed in on disk */
export class GitHubSignIn {
  private waiting: Waiting | undefined;
  private ended: GitHubView["ended"];
  private starting: Promise<GitHubView | Refusal> | undefined;
  private token: { value: string; until: number; login: string } | undefined;
  private saying = false;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(private readonly o: GitHubSignInOptions) {
    this.schedule = o.schedule ?? later;
  }

  get config(): GitHubConfig {
    return this.o.config;
  }

  /** who is signed in on this machine, as kept */
  identity(): GitHubIdentity | undefined {
    return readGitHubFile(this.o.home).identity;
  }

  /** what a connection to live:paper answers now: nothing while someone is signed in */
  paperSetup(): string | undefined {
    return this.identity() ? undefined : PAPER_SETUP_WORDS;
  }

  view(): GitHubView {
    const f = readGitHubFile(this.o.home);
    const w = this.waiting && this.waiting.expiresAt > this.o.clock() ? this.waiting : undefined;
    const c = this.o.config;
    const who = f.identity;
    return {
      on: true,
      repo: c.repo,
      ...(c.discussion ? { thread: threadUrl(c) } : {}),
      ...(who ? { signedIn: { login: who.login, ...(who.name ? { name: who.name } : {}), ...(who.avatarUrl ? { avatarUrl: who.avatarUrl } : {}), at: who.at } } : {}),
      ...(w ? { waiting: { id: w.id, code: w.userCode, verify: DEVICE_URL, expiresAt: w.expiresAt } } : {}),
      ...(this.ended ? { ended: this.ended } : {}),
      ...(c.discussion ? { hello: this.helloState(f) } : {}),
    };
  }

  private helloState(f: GitHubFile): NonNullable<GitHubView["hello"]> {
    if (f.hello) return { can: false, said: f.hello };
    if (!f.identity) return { can: false, why: "Sign in with GitHub first" };
    const words = helloWords(f.identity.login);
    if (!this.liveToken(f.identity.login)) return { words, can: false, why: "Saying hi asks for a fresh sign-in: sign in with GitHub again (a sign-in from before the account restarted, or older than 8 hours, cannot post)" };
    return { words, can: true };
  }

  private liveToken(login: string): string | undefined {
    const t = this.token;
    return t && t.login === login && t.until > this.o.clock() ? t.value : undefined;
  }

  /** a code to enter at GitHub: the one waiting, while it lasts — or, `again`, a new one (at most every 10 s) */
  start(again = false): Promise<GitHubView | Refusal> {
    const now = this.o.clock();
    const w = this.waiting;
    if (w && w.expiresAt > now && (!again || now - w.at < NEW_CODE_MS)) return Promise.resolve(this.view());
    this.starting ??= (async () => {
      const d = await startDevice(this.o.http, this.o.config.clientId);
      if (isRefusal(d)) return d;
      this.stopWaiting();
      const at = this.o.clock();
      const made: Waiting = { id: randomBytes(18).toString("base64url"), deviceCode: d.deviceCode, userCode: d.userCode, at, expiresAt: at + d.expiresInS * 1000, intervalMs: d.intervalS * 1000 };
      this.waiting = made;
      this.ended = undefined;
      this.next(made, made.intervalMs);
      this.o.onChange?.();
      return this.view();
    })().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private next(w: Waiting, ms: number): void {
    // a turn that throws (a file that could not be written) ends this code, said as that
    w.cancel = this.schedule(() => void this.turn(w).catch((err: unknown) => this.end(w, "failed", `the sign-in stopped: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`)), ms);
  }

  /** one turn of asking GitHub whether the code was entered */
  private async turn(w: Waiting): Promise<void> {
    if (this.waiting !== w) return;
    if (this.o.clock() >= w.expiresAt) return this.end(w, "expired", OAUTH_WORDS.expired_token!);
    if (!w.token) {
      const p = await pollDevice(this.o.http, this.o.config.clientId, w.deviceCode);
      if (this.waiting !== w) return;
      if (p.kind === "pending") return this.next(w, w.intervalMs);
      if (p.kind === "slow") {
        w.intervalMs = Math.max(w.intervalMs + 5000, (p.intervalS ?? 0) * 1000);
        return this.next(w, w.intervalMs);
      }
      if (p.kind === "quiet") return this.next(w, Math.max(w.intervalMs, Math.min(p.waitMs ?? 0, 60_000)));
      if (p.kind === "expired") return this.end(w, "expired", OAUTH_WORDS.expired_token!);
      if (p.kind === "denied") return this.end(w, "failed", OAUTH_WORDS.access_denied!);
      if (p.kind === "refused") return this.end(w, "failed", p.refusal.message);
      w.token = { value: p.token, expiresInS: p.expiresInS };
    }
    const who = await whoami(this.o.http, w.token.value);
    if (this.waiting !== w) return;
    if (isRefusal(who)) {
      if (who.code === "E_VENUE_UNREACHABLE") return this.next(w, w.intervalMs);
      return this.end(w, "failed", who.message);
    }
    const kept = keepIdentity(this.o.home, { ...who, at: new Date(this.o.clock()).toISOString() });
    if (isRefusal(kept)) return this.end(w, "failed", kept.message);
    this.token = { value: w.token.value, until: this.o.clock() + Math.min(w.token.expiresInS * 1000, TOKEN_MS), login: who.login };
    this.waiting = undefined;
    this.o.onChange?.();
  }

  private end(w: Waiting, state: "failed" | "expired", said: string): void {
    w.cancel?.();
    if (this.waiting === w) this.waiting = undefined;
    this.ended = { id: w.id, state, said };
    this.o.onChange?.();
  }

  private stopWaiting(): void {
    this.waiting?.cancel?.();
    this.waiting = undefined;
  }

  /** signed out here: the code waiting dropped, the token forgotten, who it was taken off this machine — where hi was said stays */
  signOut(): GitHubView | Refusal {
    this.stopWaiting();
    this.token = undefined;
    this.ended = undefined;
    if (this.identity()) {
      const r = forgetIdentity(this.o.home);
      if (isRefusal(r)) return r;
    }
    this.o.onChange?.();
    return this.view();
  }

  /** the hi as the owner would sign it — its thread and its words the account's own — or why it cannot be said now */
  helloDraft(): { repo: string; discussion: number; body: string } | Refusal {
    const c = this.o.config;
    if (!c.discussion) return no("E_ACCOUNT_BAD_ACTION", { message: "this build names no thread to say hi in" });
    const f = readGitHubFile(this.o.home);
    if (f.hello) return no("E_ACCOUNT_BAD_ACTION", { message: `hi was said from this machine already: ${f.hello.url}`, detail: { said: f.hello.url } });
    const h = this.helloState(f);
    if (!f.identity || !h.can) return no("E_ACCOUNT_CREDENTIAL", { venue: VENUE, message: h.why ?? "Sign in with GitHub first", detail: { github: "sign-in" } });
    return { repo: c.repo, discussion: c.discussion, body: helloWords(f.identity.login) };
  }

  /** say hi, as signed: only the draft's own thread and words, once from this machine, with the token of who is signed in */
  async hello(a: { repo: string; discussion: number; body: string }): Promise<{ url: string } | Refusal> {
    const d = this.helloDraft();
    if (isRefusal(d)) return d;
    if (a.repo !== d.repo || a.discussion !== d.discussion || a.body !== d.body) return no("E_ACCOUNT_BAD_ACTION", { message: "the hi signed is not the one this account says: its thread and its words are the account's own. Prepare it again" });
    const who = this.identity();
    const token = who ? this.liveToken(who.login) : undefined;
    if (!who || !token) return no("E_ACCOUNT_CREDENTIAL", { venue: VENUE, message: "Sign in with GitHub again to say hi", detail: { github: "sign-in" } });
    if (this.saying) return no("E_ACCOUNT_BAD_ACTION", { message: "hi is being said already" });
    this.saying = true;
    try {
      const r = await postHello(this.o.http, token, this.o.config, d.body);
      if (isRefusal(r)) {
        // a token GitHub no longer takes is forgotten: the next hi asks for a new sign-in
        if (r.code === "E_ACCOUNT_CREDENTIAL") this.token = undefined;
        return r;
      }
      // posted: where is kept, so it is never said again from here (a file that cannot be written does not unsay it)
      try {
        keepHello(this.o.home, { url: r.url, at: new Date(this.o.clock()).toISOString() });
      } catch {
        // said all the same: the answer is where
      }
      this.o.onChange?.();
      return r;
    } finally {
      this.saying = false;
    }
  }

  /** the server stops: nothing more is asked of GitHub */
  stop(): void {
    this.stopWaiting();
  }
}
