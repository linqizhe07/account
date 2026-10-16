/** SPEND TOKENS on the page (ui/spend-tokens.js, with the Agents sheet, the Venues page, the top bar and Waiting for you), run as the page
 * runs them — every page script in account.html's order, one global scope — over a stand-in browser that keeps what is drawn: each
 * agent's tokens with their lines and their honesty label, the lens narrowing them (Paper: test tokens; Real: live ones), Stop and Revoke
 * only for a browser that signs, Stop all tokens beside the mode, the issue form's exact draft, a token ask granted from the form with the
 * agent's counterparty proposed and never pre-filled. Nothing leaves the process. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { malformed, type OwnerAction } from "../../src/portfolio/account/sign.ts";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const html = readFileSync(join(PUBLIC, "account.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1] ?? "");
const source = (src: string) => readFileSync(join(PUBLIC, src.replace(/^\//, "")), "utf8");

/** the page's scripts in a stand-in browser: after the scripts loaded, every element is kept by its id; a form's fields stand in as { values } */
function page(opts: { fetch?: (path: string, init?: { method?: string; body?: string }) => Promise<unknown> } = {}) {
  const element = (): Record<string, unknown> => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, hidden: false, value: "", textContent: "", innerHTML: "", contains: () => false, open: false, title: "", disabled: false });
  const kept: Record<string, Record<string, unknown>> = {};
  let started = false;
  const sandbox: Record<string, unknown> = {
    // the agents' form is not drawn here (as in ui-agents.test.ts): the sheet's table is read, the form's fields are not
    document: { getElementById: (id: string) => (!started ? element() : id === "agent-form" ? null : (kept[id] ??= element())), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" }, setAttribute() {} }, hidden: false, activeElement: null, title: "" },
    location: { hash: "", origin: "http://127.0.0.1:4895" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
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
    fetch: opts.fetch ?? (() => new Promise(() => {})),
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    FormData: class {
      constructor(private readonly f: { values?: Record<string, string> }) {}
      get(k: string) {
        return this.f.values?.[k] ?? null;
      }
      getAll(k: string) {
        const v = this.f.values?.[k];
        return v === undefined ? [] : [v];
      }
    },
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  for (const src of scripts) new Script(source(src), { filename: src }).runInContext(ctx);
  started = true;
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  run('var SHEETS = []; openSheet = (html, o) => { SHEETS.push({ html, title: o && o.title, wide: !!(o && o.wide) }); return { addEventListener() {}, querySelector: () => null }; }; load = async () => {}; renderWallets = () => {}; var QD = null; quoteDialog = (o) => { QD = o; return { form: { elements: { place: { value: "paper:paper-1", addEventListener() {} }, counterparty: { placeholder: "", value: "" } }, querySelector: () => null, addEventListener() {}, dispatchEvent() {} } }; }; var ASKED = []; confirmSheet = async (text) => { ASKED.push(text); return true; }');
  return { run, out: <T = unknown>(code: string): T => JSON.parse(run<string>(`JSON.stringify(${code})`)) as T, set: (name: string, v: unknown) => run(`${name} = ${JSON.stringify(v)}`), el: (id: string) => kept[id] ?? {} };
}

const OWNER = 'Object.defineProperty(Owner, "role", { get: () => "owner", configurable: true })';
const LOOKER = 'Object.defineProperty(Owner, "role", { get: () => "pending", configurable: true })';
const CC = "0x3a087530887bd175ccc38828ee3776e5b6ea1ac6";
const NOW = "2026-10-16T15:00:00.000Z";
const token = (over: Record<string, unknown> = {}) => ({ id: "tok-0001", agent: CC, agentName: "Claude Code", rail: "paper", railKind: "paper", instrument: "paper-1", instrumentName: "Paper account", counterparty: "*", currency: "USD", maxUsd: 200, perUseUsd: 150, mintedUsd: 30, reservedUsd: 0, leftUsd: 170, uses: 2, usesMade: 1, usesOpen: 0, validUntil: "2026-10-23T15:00:00.000Z", atOnce: false, purpose: "rehearse small buys", env: "test", status: "active", lapsed: false, usage: "proxy", honesty: { tier: "account", text: "The Account alone holds this limit" }, testLabel: "Paper · Account paper book", paper: true, at: NOW, usesList: [], ...over });
const TOKENS = [token(), token({ id: "tok-0002", rail: "venue:ex", railKind: "venue", instrument: "ex", instrumentName: "Exchange", counterparty: "BTC/USDT", env: "live", status: "stopped", stoppedAt: NOW, reason: "stopped from the page", testLabel: undefined, paper: undefined, atOnce: true, purpose: "a live one" }), token({ id: "tok-0003", rail: "venue:ex", railKind: "venue", instrument: "ex", instrumentName: "Exchange", counterparty: "ETH/USDT", env: "live", status: "revoked", revokedAt: NOW, revokeConfirmed: NOW, reason: "done", testLabel: undefined, paper: undefined, purpose: "a revoked one" })];
const account = (extra: Record<string, unknown> = {}) => ({
  now: NOW,
  mode: "guard",
  liveUsd: 1000,
  venues: [{ id: "paper-1", name: "Paper account", live: true, paper: true, usd: 10000, holdings: [], trade: { can: true, kinds: ["spot"] } }, { id: "ex", name: "Exchange", live: true, usd: 1000, holdings: [], trade: { can: true, kinds: ["spot"] } }],
  keys: [{ address: CC, name: "Claude Code", code: "CC", status: "ok", validUntil: "2026-11-05T00:00:00.000Z", approvedAt: NOW }],
  spend: [],
  cards: [],
  asks: [],
  orders: [],
  payments: [],
  intents: [],
  watch: [],
  requests: [],
  subAccounts: [{ id: "sub-1", name: "Ops", agent: CC, agentName: "Claude Code", address: "0x90cd4774dfc70d05260f7a2b7ac44a3dc021cf5b", capUsd: 100, balanceUsd: 0 }],
  signers: { owners: [], pendingDevices: [], threshold: 1 },
  connectLive: { writes: { on: true, capUsd: 250 }, options: [] },
  dial: { sessionExpiresAt: "2026-11-05T00:00:00.000Z", sessionEnded: false, maxLeverage: 1, revoked: [] },
  health: {},
  tokens: TOKENS,
  ...extra,
});

describe("spend tokens under each agent (the Agents sheet)", () => {
  it("lists each key's tokens with their lines, their standing and who holds their lines; Stop for one that stands, Revoke until it is over, Issue for the key — only for a browser that signs", () => {
    const p = page();
    p.run(OWNER);
    p.set("A", account());
    p.run("renderAgents(connected(), true)");
    const sheet = String(p.el("agents").innerHTML);
    const row = sheet.slice(sheet.indexOf('<tr class="tok-row">'), sheet.indexOf("</tr>", sheet.indexOf('<tr class="tok-row">')));
    expect(row).toContain('<span class="mono">tok-0001</span> <span class="tag up">Active</span> <span class="tag paper">Paper</span>');
    expect(row).toContain("trades any market at Paper account · $30.00 of $200.00 used · up to $150.00 a use · 1 of 2 uses · until");
    expect(row).toContain('<span class="tok-h">Paper · Account paper book</span>');
    expect(row).toContain('data-tok-act="stop" data-token="tok-0001"');
    expect(row).toContain('data-tok-act="revoke" data-token="tok-0001"');
    // the live ones: the honesty label in the warning colour, a stopped one with Revoke and no Stop, a revoked one with neither, folded as ended
    expect(row).toContain('<span class="tag warn">Stopped</span>');
    expect(row).toContain('<span class="tok-h warn">Live · the Account alone holds this limit</span>');
    expect(row).toContain("· at once, no card");
    expect(row).not.toContain('data-tok-act="stop" data-token="tok-0002"');
    expect(row).toContain('data-tok-act="revoke" data-token="tok-0002"');
    expect(row).toContain('<details class="tok-over"><summary class="dim small">1 ended token</summary>');
    expect(row).not.toContain('data-token="tok-0003"');
    expect(row).toContain('data-tok-act="issue" data-agent="' + CC + '"');
    // an agent's own tokens only, no name repeated under its own row
    expect(row).not.toContain("Claude Code</span>");
    // a browser that only looks: the tokens, and no button
    p.run(LOOKER);
    p.run("renderAgents(connected(), false)");
    const look = String(p.el("agents").innerHTML);
    expect(look).toContain("tok-0001");
    expect(look).not.toContain("data-tok-act");
  });

  it("the lens narrows them: Paper shows test tokens, Real live ones, a venue its instrument's, an agent its own", () => {
    const p = page();
    p.set("A", account());
    expect(p.out<string[]>("tokensIn().map((t) => t.id)")).toEqual(["tok-0001", "tok-0002", "tok-0003"]);
    p.run('view.lens = "paper"');
    expect(p.out<string[]>("tokensIn().map((t) => t.id)")).toEqual(["tok-0001"]);
    p.run('view.lens = "real"');
    expect(p.out<string[]>("tokensIn().map((t) => t.id)")).toEqual(["tok-0002", "tok-0003"]);
    p.run('view.lens = "venue:ex"');
    expect(p.out<string[]>("tokensIn().map((t) => t.id)")).toEqual(["tok-0002", "tok-0003"]);
    p.run(`view.lens = "agent:${CC}"`);
    expect(p.out<number>("tokensIn().length")).toBe(3);
    p.run('view.lens = ""');
  });
});

describe("Stop all tokens, beside the mode", () => {
  it("shows while a token stands, with the count, for a browser that signs; hidden with none; a press asks first, then one free POST", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    const p = page({ fetch: async (path, init) => { posts.push({ path, body: JSON.parse(init?.body ?? "{}") }); return { status: 200, ok: true, json: async () => ({ ok: true, stopped: ["tok-0001"], already: [] }) }; } });
    p.run(OWNER);
    p.set("A", account());
    p.run("renderChrome(connected(), true)");
    expect([p.el("stop-tokens").hidden, p.el("stop-tokens").disabled, p.el("stop-tokens").textContent]).toEqual([false, false, "Stop all tokens · 1"]);
    p.run("renderChrome(connected(), false)");
    expect(p.el("stop-tokens").disabled).toBe(true);
    p.set("A", account({ tokens: [token({ status: "revoked" })] }));
    p.run("renderChrome(connected(), true)");
    expect(p.el("stop-tokens").hidden).toBe(true);
    p.set("A", account());
    await p.run<Promise<void>>('stopToken("*")');
    expect(p.out<string[]>("ASKED")).toHaveLength(1);
    expect(p.out<string[]>("ASKED")[0]).toMatch(/^Stop every spend token\?/);
    expect(posts).toEqual([{ path: "/api/account/tokens/stop", body: { token: "*" } }]);
    expect(p.out<string>("said")).toBe("Stopped 1 spend token: every use is refused from now on.");
    // one token: no question, the same POST
    await p.run<Promise<void>>('stopToken("tok-0001")');
    expect(p.out<string[]>("ASKED")).toHaveLength(1);
    expect(posts[1]).toEqual({ path: "/api/account/tokens/stop", body: { token: "tok-0001" } });
    // a revocation is signed, and asked first
    p.run('var OWNED = []; own = async (d) => { OWNED.push(d); return { status: 200, body: { ok: true } }; }');
    await p.run<Promise<void>>('revokeToken("tok-0001")');
    expect(p.out<string[]>("ASKED")[1]).toMatch(/^Revoke tok-0001 \(trades any market at Paper account\)\?/);
    expect(p.out("OWNED")).toEqual([{ type: "revokeSpendToken", token: "tok-0001", reason: "" }]);
    // the wiring: the shell's own button, the pane's one click handler, the sheet's buttons
    const shell = source("ui/shell.js");
    expect(shell).toContain('$("stop-tokens").addEventListener("click", () => A && typeof stopToken === "function" && stopToken("*"));');
    expect(source("ui/portfolio.js")).toContain('e.target.closest("button[data-tok-act]")');
    expect(source("ui/agents-mount.js")).toContain('wireTokens($("agents"))');
  });
});

describe("the issue form", () => {
  it("drafts exactly the issueSpendToken the account signs: the place picks the rail, the instrument, the environment and the currency; uses are a number; a use goes at once only when ticked", () => {
    const p = page();
    p.run(OWNER);
    p.set("A", account({ tokens: [] }));
    p.run(`openIssueToken({ agent: "${CC}", instrument: "paper-1" })`);
    expect(p.out<{ title: string; go: string }>("({ title: QD.title, go: QD.go })")).toEqual({ title: "Issue a spend token", go: "Sign the token" });
    const fields = p.out<string>("QD.fields");
    expect(fields).toContain('<option value="paper:paper-1" selected>Paper account · paper</option>');
    expect(fields).toContain('<option value="venue:ex">Exchange</option>');
    expect(fields).toContain('<option value="x402:Ops">Agent wallet · Ops (pay over x402)</option>');
    expect(fields).toContain('name="atOnce"');
    expect(fields).not.toContain('name="remember"');
    const draft = (values: Record<string, string>) => p.out<OwnerAction | string>(`QD.draft({ values: ${JSON.stringify(values)} })`);
    const base = { agent: CC, place: "paper:paper-1", counterparty: "*", max: "200", per: "150", uses: "2", days: "7", purpose: "rehearse small buys" };
    const d = draft(base) as Extract<OwnerAction, { type: "issueSpendToken" }>;
    expect(d).toMatchObject({ type: "issueSpendToken", agent: CC, rail: "paper", instrument: "paper-1", counterparty: "*", maxAmount: "200", currency: "USD", perUseMax: "150", uses: 2, atOnce: "", purpose: "rehearse small buys", env: "test" });
    expect(d.validUntil).toBe(Date.parse(NOW) + 7 * 86_400_000);
    expect(malformed({ ...d, nonce: 1 })).toBeNull();
    expect(draft({ ...base, place: "venue:ex", counterparty: "BTC/USDT", atOnce: "on" })).toMatchObject({ rail: "venue:ex", instrument: "ex", env: "live", currency: "USD", atOnce: "true" });
    expect(draft({ ...base, place: "x402:Ops", counterparty: "https://api.example.com", uses: "3" })).toMatchObject({ rail: "chain:x402", instrument: "Ops", env: "live", currency: "USDC", uses: 3 });
    // what the form refuses before the account is asked
    expect(draft({ ...base, counterparty: "" })).toBe("Type the markets it may trade, or * for any at a paper account.");
    expect(draft({ ...base, place: "x402:Ops", counterparty: "" })).toBe("Type the payee's https origin.");
    expect(draft({ ...base, per: "300" })).toBe("A use can't be more than the whole.");
    expect(draft({ ...base, uses: "25" })).toBe("Uses: a whole number, 0 to 20.");
    expect(draft({ ...base, purpose: " " })).toBe("Say what it is for.");
    // what is shown before signing: the account's words, the lines, the honesty label (warn when live), the cap
    const shown = p.out<string>(`QD.show({ action: ${JSON.stringify({ ...d, nonce: 1 })}, quote: { words: "a test token for Claude Code: trade any market at Paper account", token: { honesty: "Test · no network holds this limit; only the Account does", paper: true, capUsd: 250 } } })`);
    expect(shown).toContain("a test token for Claude Code: trade any market at Paper account");
    expect(shown).toContain("Up to <b>$150.00</b> a use, <b>$200.00</b> USD in all, 2 uses, until");
    expect(shown).toContain('<div class="path tok-h">Test · no network holds this limit; only the Account does · no single use goes over $250.00 on this server</div>');
    const live = p.out<string>(`QD.show({ action: ${JSON.stringify({ ...d, env: "live", rail: "venue:ex", instrument: "ex", atOnce: "true", nonce: 1 })}, quote: { words: "a live token", token: { honesty: "Live · the Account alone holds this limit", capUsd: 250 } } })`);
    expect(live).toContain('<div class="path tok-h warn">Live · the Account alone holds this limit');
    expect(live).toContain("a use goes without a card in Guard");
  });

  it("a token ask is granted from the form: the agent's counterparty is shown as proposed and never pre-filled; the purpose and the dollars start from its words; the memory tick is there", () => {
    const p = page();
    p.run(OWNER);
    const ask = { id: "ask-0001", agent: CC, agentName: "Claude Code", kind: "token", venue: "paper-1", usd: "300", text: "rehearse a BTC buy", counterparty: "*", at: NOW, expiresAt: "2026-10-17T15:00:00.000Z" };
    p.set("A", account({ tokens: [], asks: [ask] }));
    // Waiting for you says what it asks for, with the counterparty proposed, and offers Grant
    const waiting = p.out<string>("pfWaitingHtml(lensNow(), true)");
    expect(waiting).toContain("Asks for a spend token · $300.00 · at Paper account · for * (proposed)");
    expect(waiting).toContain('data-pf-act="grant" data-ask="ask-0001"');
    expect(p.out<boolean>("pfGrantable(A.asks[0])")).toBe(true);
    p.run("pfGrant(A.asks[0])");
    expect(p.out<string>("QD.sub")).toContain("Claude Code asked for a token: “rehearse a BTC buy” · $300.00");
    const fields = p.out<string>("QD.fields");
    expect(fields).toContain('name="counterparty" autocomplete="off" spellcheck="false" placeholder="BTC-PERP, ETH-PERP" value=""');
    expect(fields).toContain('Claude Code proposed <span class="mono">*</span> <button type="button" class="link" data-tok-take>Use it</button> — nothing is ticked for you.');
    expect(fields).toContain('name="max" inputmode="decimal" autocomplete="off" value="300"');
    expect(fields).toContain('name="purpose" maxlength="200" autocomplete="off" placeholder="What it is for, in your words" value="rehearse a BTC buy"');
    expect(fields).toContain('name="remember"');
    // a read-only server grants no token
    p.set("A", account({ tokens: [], asks: [ask], connectLive: { writes: { on: false }, options: [] } }));
    expect(p.out<boolean>("pfGrantable(A.asks[0])")).toBe(false);
  });
});

describe("spend tokens under each account (Venues)", () => {
  it("groups the lens's tokens by their instrument, each group with the way to issue one there; a browser that only looks gets no button", () => {
    const p = page();
    p.run(OWNER);
    p.set("A", account());
    const html = p.out<string>("pfTokensHtml(connected(), true)");
    expect(html).toContain('<h2 class="h2" id="pf-tokens-h">Spend tokens</h2>');
    expect(html).toContain("3 tokens here · one authorisation each, for one agent at one account, beside its limits · every one is held by the Account alone");
    const paper = html.slice(html.indexOf('data-k="paper-1"'), html.indexOf('data-k="ex"'));
    expect(paper).toContain("tok-0001");
    expect(paper).toContain('<span class="dim small">Claude Code</span>');
    expect(paper).toContain('data-tok-act="issue" data-agent="" data-instrument="paper-1"');
    const ex = html.slice(html.indexOf('data-k="ex"'));
    expect(ex).toContain("tok-0002");
    expect(ex).toContain("tok-0003");
    expect(ex).not.toContain("tok-0001");
    p.run('view.lens = "paper"');
    const only = p.out<string>("pfTokensHtml(connected(), true)");
    expect(only).toContain("1 token here");
    expect(only).not.toContain("tok-0002");
    p.run('view.lens = ""');
    expect(p.out<string>("pfTokensHtml(connected(), false)")).not.toContain("data-tok-act");
  });
});
