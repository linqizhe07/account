/** THE PAGE'S GITHUB SIGN-IN for a new paper account (ui/connect.js ghPanelHtml, tileSaysOwn; ui/trade.js tkOnboard), run as the page runs
 * it — every script in account.html's order, in one global scope — over a stand-in for the browser: signed out (the books kept here still
 * continue, no sign-in needed), a code waiting with GitHub's own page, signed in with the hi as a box LEFT UNTICKED and its exact words;
 * the paper tile and form stay open while the sign-in comes first; Trade's card sends a new paper account to the form. Nothing leaves the
 * process. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const html = readFileSync(join(PUBLIC, "account.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1] ?? "");

/** the page's scripts in a stand-in browser: elements take listeners and report nothing; nothing the page asks the server is answered */
function page() {
  const element = (): Record<string, unknown> => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, hidden: false, value: "", textContent: "", innerHTML: "" });
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" }, setAttribute() {} }, hidden: false, activeElement: null },
    location: { hash: "", origin: "http://127.0.0.1:4821" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class {
      observe() {}
    },
    Event: class {
      constructor(readonly type: string) {}
    },
    addEventListener() {},
    dispatchEvent: () => true,
    scrollTo() {},
    indexedDB: { open: () => ({}) },
    fetch: () => new Promise(() => {}),
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  for (const src of scripts) new Script(readFileSync(join(PUBLIC, src.replace(/^\//, "")), "utf8"), { filename: src }).runInContext(ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  const out = <T = any>(code: string): T => JSON.parse(run<string>(`JSON.stringify(${code})`)) as T;
  return { run, out, set: (name: string, value: unknown) => run(`${name} = ${JSON.stringify(value)}`) };
}

const THREAD = "https://github.com/linqizhe07/buyer-agent-demo/discussions/7";
const WORDS = "👋 @octo-cat started a paper account";
const panel = (p: ReturnType<typeof page>, g: unknown, books: unknown[] = []) => p.run<string>(`ghPanelHtml(${JSON.stringify(g)}, ${JSON.stringify(books)})`);

describe("the paper form's GitHub panel", () => {
  it("says nothing when the server asks for no sign-in", () => {
    const p = page();
    expect(panel(p, { ok: true, on: false })).toBe("");
    expect(panel(p, null)).toBe("");
  });
  it("signed out: one button, what it reads (never the email), and the books kept here to continue without it", () => {
    const p = page();
    const h = panel(p, { on: true, repo: "linqizhe07/buyer-agent-demo", thread: THREAD, hello: { can: false } }, [{ venue: "paper-momentum", name: "Momentum", cashUsd: 25000 }]);
    expect(h).toContain('data-gh="start"');
    expect(h).toContain("Sign in with GitHub to open a paper account");
    expect(h).toMatch(/username, name and avatar — never your email/);
    expect(h).toContain('data-gh-keep="paper-momentum"');
    expect(h).toContain("Continue “Momentum”");
    expect(h).not.toContain('type="checkbox"');
    const ended = panel(p, { on: true, repo: "x/y", ended: { id: "a", state: "failed", said: "The sign-in was cancelled on GitHub's page: nobody was signed in" } });
    expect(ended).toContain("cancelled on GitHub&#39;s page");
  });
  it("a code waiting: the code, GitHub's own page, and a new code", () => {
    const p = page();
    const h = panel(p, { on: true, repo: "x/y", waiting: { id: "w1", code: "WDJB-MJHT", verify: "https://github.com/login/device", expiresAt: Date.now() + 14 * 60_000 } });
    expect(h).toContain("WDJB-MJHT");
    expect(h).toContain('href="https://github.com/login/device"');
    expect(h).toContain('data-gh="again"');
    expect(h).toMatch(/Waiting for GitHub/);
  });
  it("signed in: who, Sign out, and the hi as a box left unticked with its exact words", () => {
    const p = page();
    const h = panel(p, { on: true, repo: "linqizhe07/buyer-agent-demo", thread: THREAD, signedIn: { login: "octo-cat", name: "The Octocat", at: "2026-10-21T08:00:00Z" }, hello: { words: WORDS, can: true } });
    expect(h).toContain("Signed in with GitHub as <b>@octo-cat</b>");
    expect(h).toContain('data-gh="out"');
    expect(h).toMatch(/<input type="checkbox" name="hello" \/>/);
    expect(h).not.toMatch(/name="hello"[^>]*checked/);
    expect(h).toContain(`“${WORDS}”`);
    expect(h).toContain(`href="${THREAD}"`);
    // said already: where, and no box
    const said = panel(p, { on: true, repo: "x/y", thread: THREAD, signedIn: { login: "octo-cat", at: "2026-10-21T08:00:00Z" }, hello: { can: false, said: { url: `${THREAD}#discussioncomment-42`, at: "2026-10-21T08:01:00Z" } } });
    expect(said).toContain(`${THREAD}#discussioncomment-42`);
    expect(said).not.toContain('type="checkbox"');
    // signed in from before a restart: no box, the way to a fresh sign-in
    const stale = panel(p, { on: true, repo: "x/y", thread: THREAD, signedIn: { login: "octo-cat", at: "2026-10-21T08:00:00Z" }, hello: { words: WORDS, can: false, why: "…" } });
    expect(stale).not.toContain('type="checkbox"');
    expect(stale).toContain("Sign in again");
  });
  it("escapes what GitHub said: a name is text", () => {
    const p = page();
    const h = panel(p, { on: true, repo: "x/y", signedIn: { login: "octo-cat", name: "<img src=x onerror=alert(1)>", at: "2026-10-21T08:00:00Z" } });
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img src=x");
  });
});

describe("the paper tile and form while a sign-in comes first", () => {
  it("stay open: live:paper's setup is the form's own GitHub sign-in, never a shut form — another venue's setup still shuts its own", () => {
    const p = page();
    p.run(`REACH.set("live:paper", { connector: "live:paper", state: "setup", said: "Sign in with GitHub first", at: "2026-10-21T08:00:00Z" })`);
    expect(p.out(`tileSaysOwn("live:paper")`)).toMatchObject({ word: "Sign in with GitHub", state: "github", shut: false });
    p.run(`REACH.set("live:metamask", { connector: "live:metamask", state: "setup", said: "mm is not signed in", at: "2026-10-21T08:00:00Z" })`);
    expect(p.out(`tileSaysOwn("live:metamask")`)).toMatchObject({ state: "setup", shut: true });
    p.set("GH", { on: true, repo: "x/y" });
    expect(p.run("ghGate()")).toBe(true);
    p.set("GH", { on: true, repo: "x/y", signedIn: { login: "octo-cat", at: "2026-10-21T08:00:00Z" } });
    expect(p.run("ghGate()")).toBe(false);
    p.set("GH", { on: false });
    expect(p.run("ghGate()")).toBe(false);
  });
});

describe("Trade's paper card", () => {
  const card = (gh: unknown) => {
    const p = page();
    p.set("A", { venues: [], connectLive: { writes: { on: true }, options: [{ kind: "paper", connector: "live:paper", needs: "none", label: "Paper account", example: "" }] } });
    p.set("GH", gh);
    p.run(`TK.ghAt = Date.now(); globalThis.__box = { hidden: false, isConnected: true, innerHTML: "", addEventListener() {}, querySelector: () => null, contains: () => false }; tkOnboard(globalThis.__box, true)`);
    return p.run<string>("globalThis.__box.innerHTML");
  };
  it("opens a paper account in place when no sign-in is asked for, and sends a new one to the form's GitHub sign-in when it is", () => {
    const open = card({ on: false });
    expect(open).toContain("Open a paper account");
    expect(open).toContain('name="usd"');
    const gated = card({ on: true, repo: "x/y" });
    expect(gated).toContain("Sign in with GitHub to open one");
    expect(gated).toContain("data-ob-github");
    expect(gated).not.toContain('name="usd"');
    expect(gated).toMatch(/a new one asks you to sign in with GitHub first/);
    expect(card({ on: true, repo: "x/y", signedIn: { login: "octo-cat", at: "2026-10-21T08:00:00Z" } })).toContain("Open a paper account");
  });
});
