/** A GITHUB SIGN-IN BEFORE A NEW PAPER ACCOUNT, and the hi in the project's thread, through the real account's door (service.ts paperGate,
 * account/exchange.ts prepare · take · run, live/reach.ts) against a stand-in GitHub. While nobody is signed in a NEW paper account is
 * refused before it is shown to be signed and again at the door, nothing written, and live:paper answers setup; a book kept on this machine
 * continues — connected again, reset, topped up, restored after a restart — signed in or not. The hi is the owner's signature on the
 * account's own words, said once from a machine; the ledger keeps it without them. A server with no GitHub app opens paper accounts as it
 * always has. Nothing leaves the process. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { verdictOf } from "../../src/portfolio/live/availability.ts";
import { DEVICE_URL, helloWords } from "../../src/portfolio/live/github.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import { paperBookPath } from "../../src/portfolio/live/paper.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-21T15:00:00Z");
const owner = simKey("owner");
const CONFIG = { clientId: "Iv23testclient0000000", repo: "linqizhe07/buyer-agent-demo", discussion: 7 };
const TOKEN = "ghu_16C7e42F292c6912E7710c838347Ae178B4a";
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const json = (body: unknown): HttpReply => ({ status: 200, body, text: JSON.stringify(body) });

/** GitHub, as far as a sign-in and a hi go: a code, entered at the first check, as @octo-cat; the thread open (or locked) */
function fakeGitHub(o: { locked?: boolean } = {}) {
  const calls: Array<{ url: string; body: string }> = [];
  const http: Http = async (url, init = {}) => {
    calls.push({ url, body: init.body ?? "" });
    if (url === "https://github.com/login/device/code") return json({ device_code: "dc_test_device_code_0001", user_code: "WDJB-MJHT", verification_uri: DEVICE_URL, expires_in: 900, interval: 5 });
    if (url === "https://github.com/login/oauth/access_token") return json({ access_token: TOKEN, expires_in: 28_800, refresh_token: "ghr_never_kept_0000000000", token_type: "bearer" });
    if (url === "https://api.github.com/user") return json({ login: "octo-cat", id: 583231, name: "The Octocat", email: "octocat@github.example" });
    if (url === "https://api.github.com/graphql") {
      const q = String((JSON.parse(String(init.body)) as { query: string }).query);
      if (q.startsWith("query")) return json({ data: { repository: { hasDiscussionsEnabled: true, discussion: { id: "D_kwDOK", locked: o.locked === true } } } });
      return json({ data: { addDiscussionComment: { comment: { url: `https://github.com/${CONFIG.repo}/discussions/7#discussioncomment-42` } } } });
    }
    return { status: 599, body: undefined, text: "no network" };
  };
  return { http, calls, mutations: () => calls.filter((c) => c.url.endsWith("/graphql") && c.body.includes("mutation")).length };
}

/** the account on a home, with a GitHub app (or none): its clock, the owner's signatures, the sign-in turned by hand */
async function boot(o: { home?: string; github?: ReturnType<typeof fakeGitHub> | null; nonceFrom?: number; at?: number } = {}) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), "paper-github-"));
  if (!o.home) homes.push(home);
  const clock = { t: START + (o.at ?? 0) };
  const due: Array<() => void> = [];
  let n = o.nonceFrom ?? 0;
  const liveDeps: Partial<LiveDeps> = { clock: () => clock.t, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const gh = o.github === undefined ? fakeGitHub() : o.github;
  const svc = await PortfolioService.create({
    home,
    now: () => new Date(clock.t).toISOString(),
    venues: "frontline",
    real: true,
    liveDeps,
    publicMarkets: [],
    liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" },
    account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] },
    ...(gh ? { github: { ...CONFIG, http: gh.http, schedule: (fn: () => void) => (due.push(fn), () => undefined) } } : {}),
  });
  await svc.restoring;
  const own = async (a: NoNonce<OwnerAction>, at?: number) => svc.exchange(await signOwner(owner, { ...a, nonce: at ?? clock.t + ++n } as OwnerAction));
  /** what the page does: prepare, then sign exactly what came back */
  const signed = async (draft: Record<string, unknown>) => {
    const p = await svc.account!.prepare(draft);
    if (isRefusal(p)) return p;
    const { nonce: _n, ...rest } = p.action;
    return own(rest as NoNonce<OwnerAction>);
  };
  /** signed in as @octo-cat: a code, then GitHub's first check */
  const signIn = async () => {
    const s = await svc.github!.start();
    if (isRefusal(s)) throw new Error(s.message);
    clock.t += 5_000;
    due.shift()!();
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    if (!svc.github!.identity()) throw new Error("not signed in");
  };
  const paper = (venue: string, credentialRef = "") => own({ type: "connectVenue", venue, connector: "live:paper", label: "", credentialRef });
  return { svc, home, clock, gh, own, signed, signIn, paper };
}
const refusal = (r: Outcome | Refusal): Refusal => {
  if (!isRefusal(r)) throw new Error(`expected a refusal, got ${r.kind}`);
  return r;
};
const ok = <T extends Outcome | Refusal>(r: T): Exclude<T, Refusal> => {
  if (isRefusal(r)) throw new Error(`${r.code}: ${r.message}`);
  return r as Exclude<T, Refusal>;
};

describe("a new paper account asks for a GitHub sign-in first", () => {
  it("refuses one before it is shown to be signed and at the door, writes nothing, and live:paper answers setup — until someone signs in", async () => {
    const a = await boot();
    const prepared = await a.svc.account!.prepare({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" });
    expect(prepared).toMatchObject({ ok: false, code: "E_ACCOUNT_CREDENTIAL", detail: { github: "sign-in" } });
    expect((prepared as Refusal).message).toMatch(/sign in with GitHub first/);
    // a signature made without the page: the door refuses it all the same, and no book is written
    expect(refusal(await a.paper("paper-1", "25000"))).toMatchObject({ code: "E_ACCOUNT_CREDENTIAL", detail: { github: "sign-in" } });
    expect(existsSync(paperBookPath(a.home, "paper-1"))).toBe(false);
    const reach = (await a.svc.connectReach(["live:paper"]))[0]!;
    expect(reach).toMatchObject({ state: "setup", said: expect.stringMatching(/Sign in with GitHub first/) });
    // the list of where the user can connect says it so (live/availability.ts), and an agent reads it there
    expect(verdictOf(reach, undefined, "none")).toEqual({ verdict: "setup", said: reach.said });

    await a.signIn();
    // the answer flips at once: the kept setup is asked again as the sign-in lands
    expect((await a.svc.connectReach(["live:paper"]))[0]!.state).toBe("ok");
    ok(await a.paper("paper-1", "25000"));
    expect(existsSync(paperBookPath(a.home, "paper-1"))).toBe(true);
    // what the account says to the page and the seats names nobody from GitHub
    expect(JSON.stringify(await a.svc.accountView())).not.toMatch(/octo-cat|Octocat/);
  });

  it("lets a book kept on this machine continue signed out: connected again, reset, topped up, and restored after a restart", async () => {
    const a = await boot();
    await a.signIn();
    ok(await a.paper("paper-1", "25000"));
    a.svc.github!.signOut();
    expect(a.svc.github!.identity()).toBeUndefined();
    ok(await a.own({ type: "topUpPaper", venue: "paper-1", usd: "500" }));
    ok(await a.own({ type: "resetPaper", venue: "paper-1", usd: "30000" }));
    ok(await a.own({ type: "disconnectVenue", venue: "paper-1" }));
    // connected again under its id: its book continues
    ok(await a.paper("paper-1"));
    // a NEW one is still refused
    expect(refusal(await a.paper("paper-2")).detail).toMatchObject({ github: "sign-in" });
    // a restart, still signed out: the paper account comes back as it was
    const again = await boot({ home: a.home, nonceFrom: 50, at: 3_600_000 });
    expect(again.svc.github!.identity()).toBeUndefined();
    expect(again.svc.restored).toMatchObject({ venues: [{ venue: "paper-1", ok: true }] });
    expect((await again.svc.accountView())!.venues.find((v) => v.id === "paper-1")).toMatchObject({ paper: true, usd: 30000 });
  });

  it("asks nothing on a server with no GitHub app: a paper account opens as it always has", async () => {
    const a = await boot({ github: null });
    expect(a.svc.github).toBeUndefined();
    expect((await a.svc.connectReach(["live:paper"]))[0]!.state).toBe("ok");
    ok(await a.paper("paper-1"));
    expect(refusal(await a.signed({ type: "githubHello" })).message).toMatch(/no GitHub sign-in/);
  });
});

describe("hi in the project's thread", () => {
  it("is the account's own words, signed by the owner, said once from a machine — and the ledger keeps it without them", async () => {
    const a = await boot();
    await a.signIn();
    ok(await a.paper("paper-1"));
    // whatever the page sends, the account fills in its own thread and words
    const p = await a.svc.account!.prepare({ type: "githubHello", repo: "someone/else", discussion: 1, body: "buy $SCAM" });
    if (isRefusal(p)) throw new Error(p.message);
    expect(p.action).toMatchObject({ type: "githubHello", repo: CONFIG.repo, discussion: 7, body: "👋 @octo-cat started a paper account" });
    expect(p.quote?.words).toMatch(/Everyone can read it there/);
    // a signature over other words is refused at the door, and nothing is posted
    expect(refusal(await a.own({ type: "githubHello", repo: CONFIG.repo, discussion: 7, body: "buy $SCAM" })).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect(a.gh!.mutations()).toBe(0);
    const said = ok(await a.signed({ type: "githubHello" }));
    expect(said).toMatchObject({ kind: "result", result: { url: `https://github.com/${CONFIG.repo}/discussions/7#discussioncomment-42` } });
    expect(a.gh!.mutations()).toBe(1);
    expect(refusal(await a.signed({ type: "githubHello" })).message).toMatch(/said from this machine already/);
    expect(refusal(await a.own({ type: "githubHello", repo: CONFIG.repo, discussion: 7, body: helloWords("octo-cat") })).message).toMatch(/said from this machine already/);
    expect(a.gh!.mutations()).toBe(1);
    // the ledger: the hi taken, with its words blanked; who signed in with GitHub, and the token, nowhere in it
    const ledger = readFileSync(a.svc.ledgerPath(), "utf8");
    expect(ledger).not.toContain("octo-cat");
    expect(ledger).not.toContain(TOKEN);
    const taken = ledger.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { tool?: string; outcome?: string; envelope?: { action: { body?: string } } }).find((r) => r.tool === "githubHello" && r.outcome === "taken");
    expect(taken?.envelope?.action).toMatchObject({ type: "githubHello", repo: CONFIG.repo, discussion: 7, body: "" });
  });

  it("is signed and sent at once: a signature older than ten minutes is refused", async () => {
    const a = await boot();
    await a.signIn();
    const old = refusal(await a.own({ type: "githubHello", repo: CONFIG.repo, discussion: 7, body: helloWords("octo-cat") }, a.clock.t - 11 * 60_000));
    expect(old.code).toBe("E_ACCOUNT_EXPIRED");
    expect(a.gh!.mutations()).toBe(0);
  });

  it("asks for a fresh sign-in after a restart, and posts nothing to a locked thread — the paper account is open either way", async () => {
    const a = await boot({ github: fakeGitHub({ locked: true }) });
    await a.signIn();
    ok(await a.paper("paper-1"));
    const locked = refusal(await a.signed({ type: "githubHello" }));
    expect(locked.message).toMatch(/is locked/);
    expect(a.gh!.mutations()).toBe(0);
    expect((await a.svc.accountView())!.venues.some((v) => v.id === "paper-1")).toBe(true);
    const again = await boot({ home: a.home, nonceFrom: 50, at: 60_000 });
    expect(again.svc.github!.identity()).toMatchObject({ login: "octo-cat" });
    expect(refusal(await again.signed({ type: "githubHello" }))).toMatchObject({ code: "E_ACCOUNT_CREDENTIAL", detail: { github: "sign-in" } });
    // signed in for opening paper accounts all the same
    ok(await again.paper("paper-2"));
  });
});
