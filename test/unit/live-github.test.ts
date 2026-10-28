/** THE GITHUB SIGN-IN (live/github.ts, account/github-identity.ts) against a stand-in GitHub: the device flow as GitHub documents it — a
 * code, asked after at GitHub's pace (slow_down: five seconds more), pending, expired, denied, turned off, a network blip — who signed in
 * kept on disk (0600 in a 0700 folder, never through a link, no token and no email in it), the token in memory only, the hi in the thread
 * once from a machine and only in the account's own words. No request ever carries a secret: the device flow needs none. Nothing leaves
 * the process. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { forgetIdentity, GITHUB_FILE, keepHello, keepIdentity, readGitHubFile } from "../../src/portfolio/account/github-identity.ts";
import { DEVICE_URL, GITHUB_APP, githubConfig, GitHubSignIn, helloWords, pollDevice, postHello, startDevice, whoami } from "../../src/portfolio/live/github.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";

const homes: string[] = [];
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "gh-"));
  homes.push(h);
  return h;
};
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

const CONFIG = { clientId: "Iv23testclient0000000", repo: "linqizhe07/account", discussion: 7 };
const DEVICE = "dc_3584d83530557fdd1f46af8289938c8ef79f9dc5";
const TOKEN = "ghu_16C7e42F292c6912E7710c838347Ae178B4a";
const REFRESH = "ghr_1B4a2e77838347a7E420ce178F2E7c6912E169246c";
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });

type Poll = "pending" | "slow" | "token" | "expired" | "denied" | "disabled" | "blip" | "down";
/** GitHub as its docs say it answers: the code, each poll in turn as `polls` lists them (the last repeated), who the token is, the thread */
function fakeGitHub(o: { polls?: Poll[]; user?: Record<string, unknown>; thread?: Record<string, unknown> | null; discussions?: boolean; mutation?: () => HttpReply | Promise<HttpReply>; code?: Record<string, unknown> } = {}) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
  const polls = [...(o.polls ?? ["token"])];
  let codes = 0;
  const http: Http = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? "" });
    if (url === "https://github.com/login/device/code") return json(o.code ?? { device_code: `${DEVICE}${++codes}`, user_code: "WDJB-MJHT", verification_uri: DEVICE_URL, expires_in: 900, interval: 5 });
    if (url === "https://github.com/login/oauth/access_token") {
      const p = polls.length > 1 ? polls.shift()! : polls[0]!;
      if (p === "blip") throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      if (p === "down") return { status: 503, body: undefined, text: "unavailable" };
      if (p === "token") return json({ access_token: TOKEN, expires_in: 28_800, refresh_token: REFRESH, refresh_token_expires_in: 15_897_600, token_type: "bearer", scope: "" });
      const error = { pending: "authorization_pending", slow: "slow_down", expired: "expired_token", denied: "access_denied", disabled: "device_flow_disabled" }[p];
      return json({ error, error_description: "…", ...(p === "slow" ? { interval: 10 } : {}) });
    }
    if (url === "https://api.github.com/user") return json(o.user ?? { login: "octo-cat", id: 583231, name: "The Octocat", avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4", email: "octocat@github.example" });
    if (url === "https://api.github.com/graphql") {
      const q = String((JSON.parse(String(init.body)) as { query: string }).query);
      if (q.startsWith("query")) return json({ data: { repository: o.thread === null ? null : { hasDiscussionsEnabled: o.discussions ?? true, discussion: o.thread === undefined ? { id: "D_kwDOK", locked: false } : o.thread } } });
      return o.mutation ? o.mutation() : json({ data: { addDiscussionComment: { comment: { url: `https://github.com/${CONFIG.repo}/discussions/7#discussioncomment-1` } } } });
    }
    return { status: 599, body: undefined, text: "no network" };
  };
  return { http, calls, mutations: () => calls.filter((c) => c.url.endsWith("/graphql") && c.body.includes("mutation")).length };
}

/** a clock and a scheduler the test turns by hand: what the sign-in asked to run, and in how long */
function manual(start = Date.parse("2026-10-21T08:00:00Z")) {
  const clock = { t: start };
  const due: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const settle = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
  };
  return {
    clock,
    now: () => clock.t,
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true };
      due.push(t);
      return () => void (t.live = false);
    },
    /** the next turn that is still wanted, run after the time it asked for */
    async next(): Promise<number | undefined> {
      const i = due.findIndex((t) => t.live);
      if (i < 0) return undefined;
      const [t] = due.splice(i, 1);
      clock.t += t!.ms;
      t!.fn();
      await settle();
      return t!.ms;
    },
    waiting: () => due.filter((t) => t.live).length,
    settle,
  };
}
const refusal = (r: unknown): Refusal => {
  if (!isRefusal(r)) throw new Error(`expected a refusal, got ${JSON.stringify(r)}`);
  return r;
};

describe("which app a server signs in with", () => {
  it("is the build's (none until the owner names one), or the environment's; a value that is not one is said and the build's kept", () => {
    expect(GITHUB_APP.clientId).toBe("");
    expect(githubConfig({})).toBeUndefined();
    expect(githubConfig({ PORTFOLIO_GITHUB_CLIENT_ID: "Iv23li8abcdEFGH12345", PORTFOLIO_GITHUB_DISCUSSION: "12" })).toEqual({ clientId: "Iv23li8abcdEFGH12345", repo: "linqizhe07/account", discussion: 12 });
    // an empty value turns it off, whatever the build names
    expect(githubConfig({ PORTFOLIO_GITHUB_CLIENT_ID: "" })).toBeUndefined();
    const said: string[] = [];
    expect(githubConfig({ PORTFOLIO_GITHUB_CLIENT_ID: "Iv23li8abcdEFGH12345", PORTFOLIO_GITHUB_REPO: "not a repo", PORTFOLIO_GITHUB_DISCUSSION: "-3" }, (l) => said.push(l))).toEqual({ clientId: "Iv23li8abcdEFGH12345", repo: GITHUB_APP.repo, discussion: GITHUB_APP.discussion });
    expect(said.join("\n")).toMatch(/PORTFOLIO_GITHUB_REPO is not one[\s\S]*PORTFOLIO_GITHUB_DISCUSSION is not one/);
    expect(githubConfig({ PORTFOLIO_GITHUB_CLIENT_ID: "a b" }, (l) => said.push(l))).toBeUndefined();
  });
  it("says hi in exactly one sentence", () => {
    expect(helloWords("octo-cat")).toBe("👋 @octo-cat started a paper account");
  });
});

describe("the device flow, request by request", () => {
  it("asks for a code with the client id alone, and takes only GitHub's own answer for one", async () => {
    const gh = fakeGitHub();
    const d = await startDevice(gh.http, CONFIG.clientId);
    expect(d).toEqual({ deviceCode: `${DEVICE}1`, userCode: "WDJB-MJHT", expiresInS: 900, intervalS: 5 });
    expect(gh.calls[0]).toMatchObject({ method: "POST", body: `client_id=${CONFIG.clientId}` });
    expect(gh.calls[0]!.headers.accept).toBe("application/json");
    // a code to be typed somewhere else than GitHub's own page is not GitHub's answer
    expect(refusal(await startDevice(fakeGitHub({ code: { device_code: DEVICE, user_code: "WDJB-MJHT", verification_uri: "https://github.example/login/device", expires_in: 900, interval: 5 } }).http, CONFIG.clientId)).code).toBe("E_VENUE_REJECTED");
    expect(refusal(await startDevice(fakeGitHub({ code: { device_code: DEVICE, user_code: "<b>hi</b>", verification_uri: DEVICE_URL } }).http, CONFIG.clientId)).code).toBe("E_VENUE_REJECTED");
    const off = refusal(await startDevice(fakeGitHub({ code: { error: "device_flow_disabled" } }).http, CONFIG.clientId));
    expect(off.message).toMatch(/Device Flow/);
    expect(refusal(await startDevice(fakeGitHub({ code: { error: "incorrect_client_credentials" } }).http, CONFIG.clientId)).code).toBe("E_ACCOUNT_CREDENTIAL");
  });
  it("polls with the device code and the grant, reads each answer GitHub documents, and never keeps the refresh token", async () => {
    const ask = async (p: Poll) => pollDevice(fakeGitHub({ polls: [p] }).http, CONFIG.clientId, DEVICE);
    expect(await ask("pending")).toEqual({ kind: "pending" });
    expect(await ask("slow")).toEqual({ kind: "slow", intervalS: 10 });
    expect(await ask("expired")).toEqual({ kind: "expired" });
    expect(await ask("denied")).toEqual({ kind: "denied" });
    expect((await ask("disabled")).kind).toBe("refused");
    expect((await ask("blip")).kind).toBe("quiet");
    expect((await ask("down")).kind).toBe("quiet");
    const got = await ask("token");
    expect(got).toEqual({ kind: "token", token: TOKEN, expiresInS: 28_800 });
    expect(JSON.stringify(got)).not.toContain(REFRESH);
    const gh = fakeGitHub({ polls: ["pending"] });
    await pollDevice(gh.http, CONFIG.clientId, DEVICE);
    expect(new URLSearchParams(gh.calls[0]!.body).get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
    // the device flow needs no secret, and none is ever sent
    expect(gh.calls[0]!.body).not.toMatch(/secret/i);
  });
  it("reads who the token is — login, id, name, avatar — and nothing else; an avatar from elsewhere is no avatar", async () => {
    const who = await whoami(fakeGitHub().http, TOKEN);
    expect(who).toEqual({ login: "octo-cat", id: 583231, name: "The Octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4" });
    expect(JSON.stringify(who)).not.toMatch(/octocat@/);
    expect(await whoami(fakeGitHub({ user: { login: "octo-cat", id: 1, name: "‮evil\u0007", avatar_url: "https://tracker.example/a.png" } }).http, TOKEN)).toEqual({ login: "octo-cat", id: 1, name: "evil" });
    expect(refusal(await whoami(fakeGitHub({ user: { login: "o](javascript:x)", id: 1 } }).http, TOKEN)).code).toBe("E_VENUE_REJECTED");
    const ended = refusal(await whoami(async () => ({ status: 401, body: { message: "Bad credentials" }, text: '{"message":"Bad credentials"}' }), TOKEN));
    expect(ended).toMatchObject({ code: "E_ACCOUNT_CREDENTIAL", detail: { github: "sign-in" } });
  });
  it("checks the thread before saying anything in it, and posts nothing to one that is off, missing or locked", async () => {
    for (const [o, words] of [
      [{ discussions: false }, /Discussions are turned off/],
      [{ thread: null }, /does not show linqizhe07\/account/],
      [{ thread: {} }, /no discussion #7/],
      [{ thread: { id: "D_x", locked: true } }, /is locked/],
    ] as const) {
      const gh = fakeGitHub(o as Parameters<typeof fakeGitHub>[0]);
      expect(refusal(await postHello(gh.http, TOKEN, CONFIG, helloWords("octo-cat"))).message).toMatch(words);
      expect(gh.mutations()).toBe(0);
    }
    const forbidden = fakeGitHub({ mutation: () => json({ errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration (octo-cat)" }] }) });
    const no = refusal(await postHello(forbidden.http, TOKEN, CONFIG, helloWords("octo-cat")));
    expect(no.message).toMatch(/may not comment in linqizhe07\/account/);
    // GitHub's own words are not kept: they may name who is signed in, and a refusal lands in the ledger
    expect(JSON.stringify(no)).not.toContain("octo-cat");
    const gh = fakeGitHub();
    expect(await postHello(gh.http, TOKEN, CONFIG, helloWords("octo-cat"))).toEqual({ url: `https://github.com/${CONFIG.repo}/discussions/7#discussioncomment-1` });
    const sent = JSON.parse(gh.calls.at(-1)!.body) as { variables: { id: string; body: string } };
    expect(sent.variables).toEqual({ id: "D_kwDOK", body: "👋 @octo-cat started a paper account" });
    expect(gh.calls.at(-1)!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    // taken, and where it is not said: the thread's address — posted once, never twice for that
    expect(await postHello(fakeGitHub({ mutation: () => json({ data: { addDiscussionComment: { comment: {} } } }) }).http, TOKEN, CONFIG, "x")).toEqual({ url: `https://github.com/${CONFIG.repo}/discussions/7` });
    // an answer lost on the way: said as maybe posted, so it is looked for before it is said again
    const lost = refusal(await postHello(fakeGitHub({ mutation: () => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })) }).http, TOKEN, CONFIG, "x"));
    expect(lost.message).toMatch(/may or may not be in the thread/);
  });
});

describe("the sign-in as a server keeps it", () => {
  const make = (h: string, gh: ReturnType<typeof fakeGitHub>, m: ReturnType<typeof manual>, changes: string[] = []) => new GitHubSignIn({ home: h, config: CONFIG, http: gh.http, clock: m.now, schedule: m.schedule, onChange: () => changes.push("changed") });

  it("waits at GitHub's pace, keeps who signed in on disk and the token in memory, and says hi once in the account's own words", async () => {
    const h = home();
    const gh = fakeGitHub({ polls: ["pending", "slow", "blip", "token"] });
    const m = manual();
    const changes: string[] = [];
    const s = make(h, gh, m, changes);
    expect(s.view()).toMatchObject({ on: true, repo: CONFIG.repo, thread: `https://github.com/${CONFIG.repo}/discussions/7`, hello: { can: false } });
    expect(s.paperSetup()).toMatch(/Sign in with GitHub first/);
    const started = await s.start();
    if (isRefusal(started)) throw new Error(started.message);
    expect(started.waiting).toMatchObject({ code: "WDJB-MJHT", verify: DEVICE_URL });
    // GitHub's device code never leaves the server
    expect(JSON.stringify(started)).not.toContain(DEVICE);
    expect(await m.next()).toBe(5_000); // pending
    expect(await m.next()).toBe(5_000); // slow_down: from now on 10 s (GitHub's own interval said, at least 5 s more)
    expect(await m.next()).toBe(10_000); // a network blip: asked again at the same pace
    expect(await m.next()).toBe(10_000); // the token
    expect(m.waiting()).toBe(0);
    const v = s.view();
    expect(v.signedIn).toMatchObject({ login: "octo-cat", name: "The Octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4" });
    expect(v.waiting).toBeUndefined();
    expect(v.hello).toEqual({ words: "👋 @octo-cat started a paper account", can: true });
    expect(s.paperSetup()).toBeUndefined();
    expect(changes.length).toBeGreaterThanOrEqual(2);
    // on disk: who, never the token, never the email; the user's alone
    const file = join(h, GITHUB_FILE);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(REFRESH);
    expect(text).not.toMatch(/@github\.example|email/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(h, "github")).mode & 0o777).toBe(0o700);
    // the hi: only the account's own words, in the build's own thread
    expect(s.helloDraft()).toEqual({ repo: CONFIG.repo, discussion: 7, body: "👋 @octo-cat started a paper account" });
    expect(refusal(await s.hello({ repo: CONFIG.repo, discussion: 7, body: "👋 @octo-cat started a paper account — buy $SCAM" })).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect(refusal(await s.hello({ repo: "someone/else", discussion: 7, body: "👋 @octo-cat started a paper account" })).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect(gh.mutations()).toBe(0);
    expect(await s.hello({ repo: CONFIG.repo, discussion: 7, body: "👋 @octo-cat started a paper account" })).toEqual({ url: `https://github.com/${CONFIG.repo}/discussions/7#discussioncomment-1` });
    expect(gh.mutations()).toBe(1);
    // once from a machine: signed out and in again, it is still said
    expect(refusal(s.helloDraft()).message).toMatch(/said from this machine already/);
    s.signOut();
    expect(readGitHubFile(h)).toEqual({ v: 1, hello: { url: `https://github.com/${CONFIG.repo}/discussions/7#discussioncomment-1`, at: expect.any(String) } });
    expect(s.view().signedIn).toBeUndefined();
    expect(s.view().hello).toMatchObject({ can: false, said: { url: expect.stringContaining("#discussioncomment-1") } });
  });

  it("after a restart: still signed in for opening paper accounts, and a hi asks for a new sign-in (the token was in memory only)", async () => {
    const h = home();
    const gh = fakeGitHub();
    const m = manual();
    const s = make(h, gh, m);
    await s.start();
    await m.next();
    expect(s.view().hello?.can).toBe(true);
    s.stop();
    const again = make(h, gh, manual());
    expect(again.identity()).toMatchObject({ login: "octo-cat" });
    expect(again.paperSetup()).toBeUndefined();
    expect(again.view().hello).toMatchObject({ can: false, words: "👋 @octo-cat started a paper account", why: expect.stringMatching(/sign in with GitHub again/) });
    expect(refusal(again.helloDraft())).toMatchObject({ code: "E_ACCOUNT_CREDENTIAL", detail: { github: "sign-in" } });
    // a code waiting when the server stopped is gone with it: nothing waits after the restart
    expect(again.view().waiting).toBeUndefined();
  });

  it("shares one code between browsers, makes a new one at most every ten seconds, and ends a code that expired, was refused or turned off", async () => {
    const gh = fakeGitHub({ polls: ["pending"] });
    const m = manual();
    const s = make(home(), gh, m);
    const [a, b] = await Promise.all([s.start(), s.start()]);
    expect(gh.calls.filter((c) => c.url.endsWith("/device/code")).length).toBe(1);
    expect((a as { waiting: { id: string } }).waiting.id).toBe((b as { waiting: { id: string } }).waiting.id);
    expect(((await s.start(true)) as { waiting: { id: string } }).waiting.id).toBe((a as { waiting: { id: string } }).waiting.id);
    m.clock.t += 10_000;
    const fresh = (await s.start(true)) as { waiting: { id: string } };
    expect(fresh.waiting.id).not.toBe((a as { waiting: { id: string } }).waiting.id);
    // the old code's turn is let go: only the new one is asked after
    expect(m.waiting()).toBe(1);
    // expired: the clock past the code's fifteen minutes
    m.clock.t += 900_000;
    await m.next();
    expect(s.view().ended).toMatchObject({ state: "expired", said: expect.stringMatching(/expired/) });
    expect(s.view().waiting).toBeUndefined();

    for (const [p, words] of [["denied", /cancelled on GitHub's page/], ["disabled", /Device Flow/], ["expired", /expired/]] as const) {
      const mm = manual();
      const s2 = make(home(), fakeGitHub({ polls: [p] }), mm);
      await s2.start();
      await mm.next();
      expect(s2.view().ended?.said).toMatch(words);
      expect(s2.identity()).toBeUndefined();
    }
  });

  it("a sign-in that GitHub refuses after the code — who it is unreadable — signs no one in", async () => {
    const m = manual();
    const s = make(home(), fakeGitHub({ user: { login: "", id: 0 } }), m);
    await s.start();
    await m.next();
    expect(s.identity()).toBeUndefined();
    expect(s.view().ended?.state).toBe("failed");
  });
});

describe("who signed in, on disk", () => {
  it("is nobody when the file is loose, not this shape, or a link — and is never written through a link", () => {
    const h = home();
    expect(readGitHubFile(h)).toEqual({ v: 1 });
    const who = { login: "octo-cat", id: 1, at: "2026-10-21T08:00:00.000Z" };
    expect(keepIdentity(h, who)).toEqual({ ok: true });
    expect(readGitHubFile(h).identity).toEqual(who);
    chmodSync(join(h, GITHUB_FILE), 0o644);
    expect(readGitHubFile(h)).toEqual({ v: 1 });
    chmodSync(join(h, GITHUB_FILE), 0o600);
    writeFileSync(join(h, GITHUB_FILE), JSON.stringify({ v: 1, identity: { login: "x y", id: 1, at: "2026-10-21T08:00:00Z" }, token: TOKEN }), { mode: 0o600 });
    expect(readGitHubFile(h)).toEqual({ v: 1 });
    // a link where the file should be: not followed, not replaced
    const h2 = home();
    mkdirSync(join(h2, "github"), { mode: 0o700 });
    const outside = join(home(), "elsewhere.json");
    writeFileSync(outside, "{}", { mode: 0o600 });
    symlinkSync(outside, join(h2, GITHUB_FILE));
    expect(refusal(keepIdentity(h2, who)).message).toMatch(/is a link/);
    expect(readFileSync(outside, "utf8")).toBe("{}");
    expect(readGitHubFile(h2)).toEqual({ v: 1 });
    // a folder that is a link: refused too
    const h3 = home();
    symlinkSync(home(), join(h3, "github"));
    expect(refusal(keepIdentity(h3, who)).message).toMatch(/is a link/);
  });
  it("keeps where hi was said when they sign out", () => {
    const h = home();
    keepIdentity(h, { login: "octo-cat", id: 1, at: "2026-10-21T08:00:00.000Z" });
    keepHello(h, { url: "https://github.com/linqizhe07/account/discussions/7#discussioncomment-9", at: "2026-10-21T08:01:00.000Z" });
    forgetIdentity(h);
    expect(readGitHubFile(h)).toEqual({ v: 1, hello: { url: "https://github.com/linqizhe07/account/discussions/7#discussioncomment-9", at: "2026-10-21T08:01:00.000Z" } });
    expect(existsSync(join(h, GITHUB_FILE))).toBe(true);
  });
});
