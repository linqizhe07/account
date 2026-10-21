/** CONNECT A KEY on the page (ui/brains.js brConnect): the paste row at the top of the Brains sheet — and in the Superagent's setup
 * checklist — run as the page runs it: owner.js (the real device key, over a stand-in IndexedDB and Node's own Web Crypto), ui/core.js,
 * ui/brains.js and ui/desk.js in one global scope, in a vm whose fetch is the test's spy. What is checked is what the owner sees and what
 * leaves the page: one field (drawn as dots, no name, in no form) and Connect; the key sent to the account's check, then — after a yes that
 * shows the provider, the model, the key's tail and fingerprint and never the key — saved by the owner's signed setBrainKey and the desk
 * switched by setDesk; the key in exactly those two requests; and every way it can go wrong said in plain English. Every key here is made
 * up, built at run time. Nothing leaves the process. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { walletSecret } from "../../src/portfolio/account/brain-detect.ts";
import { exampleKey, starredKey } from "../../src/portfolio/account/brain-key.ts";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const source = (f: string) => readFileSync(join(PUBLIC, f), "utf8");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Call = { path: string; method: string; body: Any; raw: string };

/** made-up keys, put together at run time: OpenAI's mark (base64 of "OpenAI") and the rest */
const MARK = ["T3Bl", "bkFJ"].join("");
const KEY = `sk-${"proj"}-${"QZJWVKPRMTLHGFDQZJWVKPRMTLHGFD"}${MARK}${"WVKPRMTLHGFDQZJWVKPR7890"}`;

/** a stand-in IndexedDB, enough for owner.js to keep its device key */
const IDB = `(() => {
  const store = new Map();
  const req = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  return { open: () => req(() => ({ createObjectStore() {}, transaction: () => ({ objectStore: () => ({ get: (k) => req(() => store.get(k)), put: (v, k) => req(() => void store.set(k, v)) }) }) })) };
})()`;

/** the paste row as the sheet uses it, made in the page's own scope: its field, its message line, its buttons — and a form that records
 * what a pick puts into it */
const FAKE = `function asOwner() { Object.defineProperty(Owner, "role", { get: () => "owner", configurable: true }); }
function fakeInput(value) { return { value, disabled: false, dataset: {}, type: "text", focused: 0, focus() { this.focused++; } }; }
function fakeStrip(where, keyEl) {
  const msg = { className: "", textContent: "" };
  const buttons = [{ disabled: false, dataset: {} }, { disabled: false, dataset: {} }];
  return { dataset: { brConnect: where }, isConnected: true, msg, buttons, keyEl,
    querySelector(s) { if (s === '[data-br-msg="key"]') return msg; if (s === "[data-br-paste]") return keyEl; return null; },
    querySelectorAll(s) { return s === "[data-br-act]" ? buttons : []; } };
}
function fakeForm() {
  const set = [];
  return { set, querySelector: (s) => ({ set value(v) { set.push([s, v]); }, dispatchEvent() {} }) };
}`;

/** The page's scripts in a stand-in for the browser, fetch answered by `answer` and every call kept */
function page(answer: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const element = (): Any => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, hidden: false, value: "", textContent: "", innerHTML: "" });
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" }, setAttribute() {} }, hidden: false, activeElement: null },
    location: { hash: "", origin: "http://127.0.0.1:4903" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    Event: class {
      readonly bubbles: boolean;
      constructor(
        readonly type: string,
        init: { bubbles?: boolean } = {},
      ) {
        this.bubbles = !!init.bubbles;
      }
    },
    addEventListener() {},
    dispatchEvent: () => true,
    fetch: async (path: string, init: { method?: string; body?: string } = {}) => {
      const raw = String(init.body ?? "");
      const c: Call = { path, method: init.method ?? "GET", body: raw ? JSON.parse(raw) : undefined, raw };
      calls.push(c);
      const a = answer(c);
      return { status: a.status, statusText: "", json: async () => a.body };
    },
    crypto: globalThis.crypto,
    TextEncoder,
    URL,
    btoa,
    queueMicrotask,
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  sandbox.indexedDB = runInContext(IDB, ctx);
  for (const f of ["owner.js", "ui/core.js", "ui/brains.js", "ui/desk.js"]) new Script(source(f), { filename: f }).runInContext(ctx);
  runInContext(FAKE, ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  const out = <T = Any>(code: string): T => JSON.parse(run<string>(`JSON.stringify(${code})`)) as T;
  return { run, out, calls };
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};

/** what /api/account/prepare answers for a draft: the action with its nonce, and the fields shown to sign */
const prepared = (draft: Record<string, unknown>) => {
  const action = { ...draft, nonce: 1_760_000_000_009 };
  return { ok: true, action, primaryType: "AccountBrain:SetKey", domain: { name: "Account", version: "1", chainId: 1337 }, accountChain: "local", shown: Object.entries(action).map(([name, value]) => ({ name, value: String(value) })) };
};
const ALL = ["low", "medium", "high"];
/** a catalog as the account gives it: OpenAI (no key yet), Claude (a key from the environment), DeepSeek */
const CATALOG = {
  ok: true,
  brains: [
    { id: "claude", label: "Claude · Anthropic API", kind: "model-api", format: "anthropic", ok: true, how: "the Anthropic API", model: "claude-opus-5-5", models: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", inUsd: 4, outUsd: 20 }], baseUrl: "https://api.anthropic.com", efforts: ALL, envWins: "ANTHROPIC_API_KEY", keyFrom: "env", tail: "…ab12", keyFile: "credentials/brains/claude.json" },
    { id: "openai", label: "OpenAI API", kind: "model-api", format: "openai", ok: false, why: "no key", baseUrl: "https://api.openai.com/v1", keyFrom: "none", keyFile: "credentials/brains/openai.json", models: [], efforts: ALL, suggested: { models: ["gpt-6-astra", "gpt-6.1-sol"], source: "https://developers.openai.com/api/docs/models", checked: "2026-10-15", prices: { "gpt-6-astra": { inUsd: 10, outUsd: 50 } } } },
    { id: "deepseek", label: "DeepSeek", kind: "model-api", format: "openai", ok: true, how: "the key file", baseUrl: "https://api.deepseek.com", tail: "…c0de", keyFrom: "file", keyFile: "credentials/brains/deepseek.json", model: "deepseek-flash", models: [], efforts: ["low", "high"] },
  ],
};
/** the account's answer to the check, for OpenAI's key */
const FOUND = { ok: true, provider: "openai", label: "OpenAI API", who: "OpenAI", host: "api.openai.com", model: "gpt-6-astra", modelName: "gpt-6-astra", picked: "best", listed: 87, tail: "…7890", what: "an OpenAI key", asked: [{ provider: "openai", who: "OpenAI", outcome: "taken", status: 200, words: "api.openai.com accepted the key and lists 87 models" }] };
/** the account, answering the paste row's requests as it does */
function account(o: { found?: unknown; saved?: unknown; savedStatus?: number } = {}) {
  return (c: Call) => {
    if (c.path === "/api/account/brain-detect") return { status: 200, body: o.found ?? FOUND };
    if (c.path === "/api/account/prepare") return { status: 200, body: prepared(c.body.draft) };
    if (c.path === "/api/account/brain-key") return { status: o.savedStatus ?? 200, body: o.saved ?? { ok: true, provider: "openai", fingerprint: "00000000", tail: "…7890", standing: { ok: true, model: "gpt-6-astra" } } };
    if (c.path === "/api/account/desk/catalog") return { status: 200, body: CATALOG };
    return { status: 200, body: { ok: true } };
  };
}
/** a page with the account's answers, its owner signing, the yes recorded (and answered `yes`), and the desk's setDesk recorded */
function connectPage(o: Parameters<typeof account>[0] & { yes?: boolean; deskAnswer?: unknown } = {}) {
  const p = page(account(o));
  p.run(`asOwner(); BR.catalog = ${JSON.stringify(CATALOG)}; var ASKED = []; asking = async (h, read) => (ASKED.push(h), read(${o.yes === false ? '""' : '"yes"'})); var DRAFTS = []; own = async (d) => (DRAFTS.push(d), ${JSON.stringify(o.deskAnswer ?? { status: 200, body: { ok: true, kind: "account" } })}); var AFTER = 0; var DESK = { desk: () => true, cur: () => ({ provider: "deepseek", model: "deepseek-flash", effort: "low" }), after: () => void AFTER++ };`);
  return p;
}
const typed = (p: ReturnType<typeof page>, key: string, where = "sheet") => p.run(`var KEYEL = fakeInput(${JSON.stringify(key)}); var STRIP = fakeStrip(${JSON.stringify(where)}, KEYEL)`);

describe("the paste row", () => {
  it("one field and Connect, no provider to pick: the field drawn as dots with no name, in no form, nothing that remembers or completes it — and what happens said before Connect is pressed", () => {
    const p = page(() => ({ status: 200, body: {} }));
    p.run("asOwner()");
    const html = p.run<string>(`brPasteHtml("sheet", { desk: () => true })`);
    expect(html).toMatch(/^<section class="br-connect" data-br-connect="sheet" aria-labelledby="br-paste-sheet-h">/);
    expect(html).toContain('<h3 class="label" id="br-paste-sheet-h">Paste an API key</h3>');
    const input = /<input [^>]*>/.exec(html)![0];
    expect(input).toContain('type="text" data-br-paste');
    for (const a of ['autocomplete="off"', 'spellcheck="false"', 'autocapitalize="off"', 'autocorrect="off"', 'data-lpignore="true"', "data-1p-ignore", "data-bwignore", 'data-form-type="other"']) expect(input).toContain(a);
    expect(input).not.toMatch(/\bname=|\bvalue=|type="password"/);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<select");
    expect(html).toContain('<button type="button" class="btn btn-sm btn-primary" data-br-act="connect">Connect</button>');
    expect(html).toContain("It is checked with its provider first (their list of models, which costs nothing), then you sign to switch the desk to the best model it can use. A plain sk- key may be checked with DeepSeek, Kimi and OpenAI in turn: each one asked sees it.");
    expect(html).toContain('<div class="br-inuse-w" data-br-p="inuse"></div>');
    // in the Superagent's setup: under the checklist's own heading, in its own buttons' look, the pick going into the setup's form
    const setup = p.run<string>(`brPasteHtml("setup", { form: () => null }, "sg-btn sg-btn-p sg-btn-s")`);
    expect(setup).not.toContain("<h3");
    expect(setup).toContain('aria-label="Paste an API key"');
    expect(setup).toContain('<button type="button" class="sg-btn sg-btn-p sg-btn-s" data-br-act="connect">Connect</button>');
    expect(setup).toContain("then you sign to pick its best model for the desk.");
    expect(setup).not.toContain("data-br-p=");
    // a browser that cannot sign sees it, and cannot use it
    p.run(`Object.defineProperty(Owner, "role", { get: () => "pending", configurable: true })`);
    expect(p.run<string>(`brPasteHtml("sheet", {})`)).toContain('disabled title="This browser can look but not sign"');
  });

  it("under it, the brain in use: who, the model, the key's masked tail and where it is read from, with Replace key — and Remove key only for a key saved here", () => {
    const p = page(() => ({ status: 200, body: {} }));
    p.run("asOwner()");
    const file = p.run<string>(`brInUseHtml(${JSON.stringify(CATALOG)}, { provider: "deepseek", model: "deepseek-flash" })`);
    expect(file).toContain('<span class="br-st" data-s="ok"><i aria-hidden="true"></i>In use</span><span class="br-inuse-t"><b>DeepSeek</b> · deepseek-flash · key <span class="br-nw">…c0de</span></span>');
    expect(file).toContain('data-br-act="replace">Replace key</button>');
    expect(file).toContain('data-br-act="remove" data-br-for="deepseek">Remove key</button>');
    const env = p.run<string>(`brInUseHtml(${JSON.stringify(CATALOG)}, { provider: "claude", model: "claude-opus-5-5" })`);
    expect(env).toContain("<b>Claude · Anthropic API</b> · Claude Opus 5.5 · key <span class=\"br-nw\">…ab12</span> (from the account&#39;s environment)");
    expect(env).not.toContain("Remove key");
    const none = p.run<string>(`brInUseHtml(${JSON.stringify(CATALOG)}, { provider: "openai", model: "gpt-6-astra" }, true)`);
    expect(none).toContain(">Picked · not ready</span>");
    expect(none).toContain("<b>OpenAI API</b> · gpt-6-astra · no key yet");
    expect(none).not.toContain("Replace key");
    expect(p.run(`brInUseHtml(${JSON.stringify(CATALOG)}, null)`)).toBe("");
  });
});

describe("Connect", () => {
  it("checks the key with the account, asks a yes that shows all it signs, signs setBrainKey with the key beside it and setDesk for the desk — the key in exactly two requests, the field emptied, the result said", async () => {
    const p = connectPage();
    typed(p, `  ${KEY}\n`);
    await p.run("brConnect(STRIP, DESK)");
    await settle();
    const paths = p.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.slice(0, 3)).toEqual(["POST /api/account/brain-detect", "POST /api/account/prepare", "POST /api/account/brain-key"]);
    expect(paths).not.toContain("POST /api/exchange");
    // the key in exactly two requests — the check and the save — and in nothing else that left the page
    const holding = p.calls.filter((c) => c.raw.includes(KEY)).map((c) => c.path);
    expect(holding).toEqual(["/api/account/brain-detect", "/api/account/brain-key"]);
    expect(p.calls[0]!.body).toEqual({ apiKey: KEY });
    const save = p.calls.find((c) => c.path === "/api/account/brain-key")!;
    expect(Object.keys(save.body).sort()).toEqual(["apiKey", "envelope"]);
    expect(JSON.stringify(save.body.envelope)).not.toContain(KEY);
    // the draft: the provider and the model the check named, the provider's own address (""), the key's hash and salt — never the key
    const draft = p.calls[1]!.body.draft;
    expect(Object.keys(draft)).toEqual(["type", "provider", "baseUrl", "model", "keyHash", "salt"]);
    expect([draft.type, draft.provider, draft.baseUrl, draft.model]).toEqual(["setBrainKey", "openai", "", "gpt-6-astra"]);
    expect(draft.keyHash).toBe(createHash("sha256").update(Buffer.from(draft.salt, "hex")).update(KEY, "utf8").digest("hex"));
    expect(save.body.envelope.action).toEqual({ ...draft, nonce: 1_760_000_000_009 });
    // the desk switched by the owner's own signature: the provider, the model, the effort the desk has where the provider takes it
    expect(p.out("DRAFTS")).toEqual([{ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: "openai", model: "gpt-6-astra", effort: "low" }) }]);
    // the yes showed what is signed — the provider, the model and why that one, the key's tail and fingerprint, the desk — never the key
    const ask = p.out<string[]>("ASKED")[0]!;
    expect(ask).toContain('<h2 id="ask-title">Connect OpenAI?</h2>');
    expect(ask).toContain("OpenAI took the key and lists 87 models for it. Your device signs two things, never the key:");
    expect(ask).toContain("<dt>Provider</dt><dd>OpenAI API</dd>");
    expect(ask).toContain("<dt>Model</dt><dd>gpt-6-astra · the best it lists for this key · $10/$50 per M tokens by OpenAI&#39;s page (read 2026-10-15)</dd>");
    expect(ask).toContain(`<dt>Key</dt><dd>…7890 · fingerprint ${draft.keyHash.slice(0, 8)}</dd>`);
    expect(ask).toContain("<dt>The desk</dt><dd>thinks with OpenAI API · gpt-6-astra, from its next call</dd>");
    expect(ask).toContain("and sends it to api.openai.com only. Its calls are billed to your key at OpenAI.");
    expect(ask).not.toContain(KEY);
    expect(ask).not.toContain(KEY.slice(8, 24));
    // the field is empty, the line says what is true now, the opener told
    expect(p.run("KEYEL.value")).toBe("");
    expect(p.out("[STRIP.msg.className, STRIP.msg.textContent]")).toEqual(["msg ok", "Connected · OpenAI API · gpt-6-astra · key …7890. The desk thinks with it from its next call."]);
    expect(p.run("AFTER")).toBe(1);
    expect(p.out("[BR.pick, BR.cur]")).toEqual(["openai", { provider: "openai", model: "gpt-6-astra", effort: "low" }]);
    // nothing of the key kept on the page
    expect(p.run<string>("JSON.stringify(BR)")).not.toContain(KEY.slice(8, 24));
  });

  it("several providers asked (a plain sk- key): the yes says what each said", async () => {
    const found = { ...FOUND, provider: "deepseek", label: "DeepSeek", who: "DeepSeek", host: "api.deepseek.com", model: "deepseek-v4-pro", modelName: "deepseek-v4-pro", listed: 2, asked: [{ provider: "deepseek", who: "DeepSeek", outcome: "taken", status: 200, words: "" }] };
    const twice = { ...found, provider: "deepseek", asked: [{ provider: "openai", who: "OpenAI", outcome: "refused", status: 401, words: "" }, { provider: "deepseek", who: "DeepSeek", outcome: "taken", status: 200, words: "" }] };
    const p = connectPage({ found: twice, saved: { ok: true, provider: "deepseek", tail: "…7890" } });
    typed(p, KEY);
    await p.run("brConnect(STRIP, DESK)");
    await settle();
    const ask = p.out<string[]>("ASKED")[0]!;
    expect(ask).toContain("<p class=\"dim small\">OpenAI: refused it (401) · DeepSeek: took it.</p>");
    // DeepSeek takes low and high: the desk's low is kept
    expect(JSON.parse(p.out<Any[]>("DRAFTS")[0].value)).toEqual({ provider: "deepseek", model: "deepseek-v4-pro", effort: "low" });
    expect(found.asked).toHaveLength(1);
  });

  it("every way it can go wrong, said in plain English, with nothing signed: a key it does not recognise, refused by the provider, no answer in time, no usable model", async () => {
    for (const words of [
      "This key does not start the way the keys the desk's brain can use do — Anthropic (sk-ant-), OpenAI (sk-proj-)… It was not sent to any provider.",
      "OpenAI refused this key (401): it may be mistyped, cut short or revoked. It said: “Incorrect API key provided.” Nothing was saved.",
      "Could not reach OpenAI: no answer from api.openai.com in time. Check this machine's internet connection and try again. Nothing was saved.",
      "OpenAI took the key, but lists no model the desk can think with (it lists text-embedding-3-small, whisper-1). Nothing was saved.",
    ]) {
      const p = connectPage({ found: { ok: false, code: "x", words } });
      typed(p, KEY);
      await p.run("brConnect(STRIP, DESK)");
      await settle();
      expect(p.out("[STRIP.msg.className, STRIP.msg.textContent]")).toEqual(["msg no", words]);
      expect(p.calls.map((c) => c.path)).toEqual(["/api/account/brain-detect"]);
      expect(p.out("[ASKED.length, DRAFTS.length]")).toEqual([0, 0]);
      expect(p.run("KEYEL.value")).toBe("");
    }
    // one at a time, and an account that does not answer
    const busy = connectPage();
    busy.run(`fetch = async () => ({ status: 429, json: async () => ({ ok: false, code: "busy", words: "A key is being checked already: wait for its answer." }) })`);
    typed(busy, KEY);
    await busy.run("brConnect(STRIP, DESK)");
    expect(busy.run("STRIP.msg.textContent")).toBe("A key is being checked already: wait for its answer.");
  });

  it("what is never a key is refused before anything leaves the page: the example from a how-to, a key starred out, a wallet's private key or recovery phrase, a key with a space, nothing at all", async () => {
    const said = async (key: string) => {
      const p = connectPage();
      typed(p, key);
      await p.run("brConnect(STRIP, DESK)");
      expect(p.calls, key).toEqual([]);
      expect(p.run("KEYEL.value")).toBe("");
      return p.out<[string, string]>("[STRIP.msg.className, STRIP.msg.textContent]");
    };
    expect(await said("sk-ant-...")).toEqual(["msg no", "That is the example from a how-to, not a key: paste the key itself, as the provider gave it. It was not sent anywhere."]);
    expect(await said("sk-proj-****abcd")).toEqual(["msg no", "That is a key as a dashboard shows it, with most of it hidden behind stars: copy the whole key where you make it (most providers show it once). It was not sent anywhere."]);
    const wallet = ["msg no", "That looks like what a wallet holds — a private key (64 hex characters) or a recovery phrase — not an API key. It was not sent anywhere. Never paste either into a page: whoever has one has the wallet."];
    expect(await said(`0x${"4f".repeat(32)}`)).toEqual(wallet);
    expect(await said("abandon wallet garden river silent orbit cable frost lunar pepper magnet tiger")).toEqual(wallet);
    expect(await said("sk-QZJW VKPR-1234")).toEqual(["msg no", "A key is 8 to 512 characters with no spaces: paste it again. It was not sent anywhere."]);
    expect(await said("short")).toEqual(["msg no", "A key is 8 to 512 characters with no spaces: paste it again. It was not sent anywhere."]);
    expect(await said("   ")).toEqual(["msg no", "Paste a key first."]);
  });

  it("a no to the yes sends nothing more; a browser that cannot sign sends nothing at all", async () => {
    const p = connectPage({ yes: false });
    typed(p, KEY);
    await p.run("brConnect(STRIP, DESK)");
    await settle();
    expect(p.calls.map((c) => c.path)).toEqual(["/api/account/brain-detect"]);
    expect(p.out("[STRIP.msg.className, STRIP.msg.textContent]")).toEqual(["msg", "Nothing was signed or saved. The field is empty: paste the key again to connect it."]);
    expect(p.out("DRAFTS")).toEqual([]);
    const q = connectPage();
    q.run(`Object.defineProperty(Owner, "role", { get: () => "pending", configurable: true })`);
    typed(q, KEY);
    await q.run("brConnect(STRIP, DESK)");
    expect(q.calls).toEqual([]);
    expect(q.run("STRIP.msg.textContent")).toBe("This browser can look but not sign.");
  });

  it("with no desk hired, from the setup: the key saved and its provider and best model put into the setup's form for Start — no setDesk", async () => {
    const p = connectPage();
    p.run(`var FORM = fakeForm(); var SETUP = { form: () => FORM, desk: () => false, after: () => void AFTER++ }`);
    typed(p, KEY, "setup");
    await p.run("brConnect(STRIP, SETUP)");
    await settle();
    expect(p.calls.filter((c) => c.raw.includes(KEY)).map((c) => c.path)).toEqual(["/api/account/brain-detect", "/api/account/brain-key"]);
    expect(p.out("DRAFTS")).toEqual([]);
    expect(p.out("FORM.set")).toEqual([['[name="provider"]', "openai"], ['[name="model-openai"]', "gpt-6-astra"], ['[name="effort"]', "medium"], ['[name="in-openai"]', ""], ['[name="out-openai"]', ""]]);
    expect(p.run("STRIP.msg.textContent")).toBe("Connected · OpenAI API · gpt-6-astra · key …7890. Picked for the desk: Start signs it.");
    // the setup's row keeps what it said when the checklist is drawn again
    expect(p.run<string>(`brPasteHtml("setup", SETUP)`)).toContain('<div class="msg ok" data-br-msg="key" role="status">Connected · OpenAI API · gpt-6-astra · key …7890. Picked for the desk: Start signs it.</div>');
    expect(p.out("ASKED")[0]).toContain("<dt>The setup</dt><dd>picks OpenAI API · gpt-6-astra, for Start to sign</dd>");
    expect(p.out("ASKED")[0]).toContain("Your device signs this, never the key:");
  });

  it("what the account says after: a variable in its environment still used before the key; a desk that would not switch — each said, never as done", async () => {
    const env = connectPage({ saved: { ok: true, provider: "openai", tail: "…7890", envWins: "OPENAI_API_KEY" } });
    typed(env, KEY);
    await env.run("brConnect(STRIP, DESK)");
    await settle();
    expect(env.run("STRIP.msg.textContent")).toBe("Connected · OpenAI API · gpt-6-astra · key …7890. The desk thinks with it from its next call. OPENAI_API_KEY in the account's environment is still used before it.");
    const stuck = connectPage({ deskAnswer: { status: 409, body: { ok: false, refusal: { message: "no desk is hired" } } } });
    typed(stuck, KEY);
    await stuck.run("brConnect(STRIP, DESK)");
    await settle();
    expect(stuck.out("[STRIP.msg.className, STRIP.msg.textContent]")).toEqual(["msg no", "Connected · OpenAI API · gpt-6-astra · key …7890. The desk still thinks with its brain before: no desk is hired. Use this brain, below, switches it."]);
    const refused = connectPage({ savedStatus: 409, saved: { ok: false, refusal: { message: "signed 12 min ago: a brain's key is set within 10 minutes of signing it — sign again" } } });
    typed(refused, KEY);
    await refused.run("brConnect(STRIP, DESK)");
    await settle();
    expect(refused.out("[STRIP.msg.className, STRIP.msg.textContent]")).toEqual(["msg no", "signed 12 min ago: a brain's key is set within 10 minutes of signing it — sign again"]);
    expect(refused.out("DRAFTS")).toEqual([]);
  });

  it("an answer naming a brain the page does not offer, or a model that is not one, is not acted on", async () => {
    for (const found of [{ ...FOUND, provider: "nope" }, { ...FOUND, model: `sk-${"QZJWVKPRMTLHGFDQZJWVKPRMTLHGFD"}` }, { ...FOUND, provider: "../x" }]) {
      const p = connectPage({ found });
      typed(p, KEY);
      await p.run("brConnect(STRIP, DESK)");
      await settle();
      expect(p.calls.map((c) => c.path)).toEqual(["/api/account/brain-detect"]);
      expect(p.run("STRIP.msg.textContent")).toBe("The account named a brain this page does not offer: open Brains again and try once more. Nothing was saved.");
    }
  });

  it("Replace key puts the field in focus and says what to do; Remove key takes the in-use provider's key file away after the form's own yes", async () => {
    const p = connectPage();
    p.run(`var ASKEDR = []; confirmSheet = async (t, o) => (ASKEDR.push(o.title), true); BR.ctx = { cur: () => ({ provider: "deepseek", model: "deepseek-flash" }) }`);
    typed(p, "");
    p.run(`brConnectAct("replace", STRIP)`);
    expect(p.run("KEYEL.focused")).toBe(1);
    expect(p.run("STRIP.msg.textContent")).toBe("Paste the new key above, then Connect: the key in use stays until you sign the new one.");
    await p.run(`brConnectAct("remove", STRIP)`);
    await settle();
    expect(p.out("ASKEDR")).toEqual(["Remove the key"]);
    expect(p.out("DRAFTS")).toEqual([{ type: "setBrainKey", provider: "deepseek", baseUrl: "", model: "", keyHash: "", salt: "" }]);
  });

  it("a key left typed in the paste field is wiped when the sheet closes or the page is put away, as a provider's key field is", () => {
    const p = page(() => ({ status: 200, body: {} }));
    p.run(`var WA = fakeInput("${KEY}"); var WB = fakeInput("${KEY}"); document.querySelectorAll = (s) => (s.includes("[data-br-paste]") ? [WA, WB] : []); brWipeKeys()`);
    expect(p.out("[WA.value, WB.value]")).toEqual(["", ""]);
  });
});

describe("the page's checks are the account's own", () => {
  it("what is only an example, a key starred out and what a wallet holds: the page answers as the account does, sample for sample", () => {
    const p = page(() => ({ status: 200, body: {} }));
    const samples = ["sk-ant-...", "sk-…", "<your key>", "{API_KEY}", "[key]", "sk-xxxxxxxxxxxx", "sk-ant-api03-XXXXXXXXXXXXXXXXXX", `AIza${"X".repeat(35)}`, "YOUR_API_KEY", "your-api-key-here", "api_key_here", "paste-your-key", "changeme-0000000000", "sk-proj-****abcd", "••••3f9a", "token-abc123", KEY, "sk-test-set-QZJWVKPRMTLHGFD-setYQZW", `0x${"4f".repeat(32)}`, "4f".repeat(32), "abandon wallet garden river silent orbit cable frost lunar pepper magnet tiger", "abandon wallet garden", `sk-${"0123456789abcdef".repeat(2)}`, "LLM_1607358788850350_nx9.....LJY"];
    for (const s of samples) {
      expect(p.run(`brExampleKey(${JSON.stringify(s)})`), s).toBe(exampleKey(s));
      expect(p.run(`brStarredKey(${JSON.stringify(s)})`), s).toBe(starredKey(s));
      expect(p.run(`brWalletSecret(${JSON.stringify(s)})`), s).toBe(walletSecret(s));
    }
  });
});
