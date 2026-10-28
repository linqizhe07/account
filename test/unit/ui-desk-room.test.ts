/** The desk's room on the Agents page (ui/desk.js dkMsgHtml, dkFunnelHtml; ui/desk.css), run as the page runs it: plain scripts in one global
 * scope, in a vm with a stand-in for the browser. What is checked is what the owner reads: a seat's tint on its tag alone — never on the row
 * (Head's tint is the ink fill: on the row every Head line was a black box with its tag lost in it) — each line said for people where the
 * Superagent has the words for the room's protocol (ui/superagent.js sgPlain), the room's own line one pointer away, a report's lines kept,
 * and the funnel wrapping between steps, never after an arrow. Nothing leaves the process. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const source = (f: string) => readFileSync(join(PUBLIC, f), "utf8");

/** the page's scripts in a stand-in for the browser: core, brains and desk — and the Superagent's, which says the room's lines for people */
function page(files = ["ui/core.js", "ui/brains.js", "ui/desk.js", "ui/superagent.js"]) {
  const element = () => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, hidden: false, value: "", textContent: "", innerHTML: "" });
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" }, setAttribute() {} }, hidden: false, activeElement: null },
    location: { hash: "", origin: "http://127.0.0.1:4820" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Event: class {
      constructor(readonly type: string) {}
    },
    addEventListener() {},
    dispatchEvent: () => true,
    fetch: () => new Promise(() => {}),
    console,
    URL,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    Owner: { role: "owner", act: async () => ({ status: 200, body: { ok: true } }), why: () => "" },
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  for (const f of files) new Script(source(f), { filename: f }).runInContext(ctx);
  return <T = unknown>(code: string): T => runInContext(code, ctx) as T;
}

const at = "2026-10-21T16:57:00.000Z";
const line = (from: string, kind: string, text: string, more: Record<string, unknown> = {}) => JSON.stringify({ seq: 7, at, from, kind, text, ...more });

describe("the desk's room: each line on the panel, its seat's tint on its tag alone, said for people", () => {
  it("draws a Head line — the objective, the session report — as a plain row with a black HEAD tag, never a black row; a report keeps its lines", () => {
    const run = page();
    const report = "SESSION REPORT — Scanned: 0 · Cleared: 0\nPnL today: $0.00 · Session: $0.00 (+0.00%)\nBrain: 0 calls · about $0.00";
    const html = run<string>(`dkMsgHtml(${line("head", "report", report)}, [])`);
    // the row: only its kind; the seat's class on the tag
    expect(html).toMatch(/^<div class="dk-msg dk-k-report" data-k="7"><span class="dk-role dk-head">HEAD<\/span><span class="dk-text">/);
    expect(html).not.toMatch(/class="dk-msg[^"]*dk-head/);
    expect(html).toContain("SESSION REPORT — Scanned: 0 · Cleared: 0<br>PnL today: $0.00 · Session: $0.00 (+0.00%)<br>Brain: 0 calls · about $0.00");
    expect(html).toMatch(/<span class="dk-at dim">\d\d:\d\d<\/span><\/div>$/);
    // every seat the same: the tint on the tag
    for (const role of ["search", "risk", "sniper", "exit", "watch", "you", "account"]) {
      const h = run<string>(`dkMsgHtml(${line(role, "note", "a line")}, [])`);
      expect(h, role).toContain(`<span class="dk-role dk-${role}">`);
      expect(h, role).toMatch(/^<div class="dk-msg dk-k-note" /);
    }
  });

  it("says a line of the room's protocol for people, with the room's own line one pointer away — and a line already in words as it is", () => {
    const run = page();
    const raw = "LEAD L-0006 | AVAX/USD | long | AVAX keeps its momentum on volume | confidence 0.75 → RISK";
    const html = run<string>(`dkMsgHtml(${line("search", "lead", raw, { lead: "L-0006", brain: true })}, [])`);
    expect(html).toContain(`title="${raw.replace(/>/g, "&gt;")}"`);
    expect(html).toContain('<span class="dk-text"><span class="mono">L-0006</span> · long AVAX/USD — AVAX keeps its momentum on volume. Confidence 75%. Passed to Risk. <span class="dim small">· brain</span></span>');
    // a line the page has no other words for: shown as written, no pointer to the same words
    const plain = run<string>(`dkMsgHtml(${line("you", "note", "You paused the desk.")}, [])`);
    expect(plain).toContain('<span class="dk-text">You paused the desk.</span>');
    expect(plain).not.toContain("title=");
    // and every word escaped
    expect(run<string>(`dkMsgHtml(${line("head", "note", "<b>x</b>")}, [])`)).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("shows the room's own line where the Superagent's words are not on the page", () => {
    const run = page(["ui/core.js", "ui/brains.js", "ui/desk.js"]);
    const raw = "LEAD L-0006 | AVAX/USD | long | volume | confidence 0.75 → RISK";
    const html = run<string>(`dkMsgHtml(${line("search", "lead", raw)}, [])`);
    expect(html).toContain('<span class="dk-text">LEAD <span class="mono">L-0006</span> | AVAX/USD | long | volume | confidence 0.75 → RISK</span>');
    expect(html).not.toContain("title=");
  });

  it("keeps each of the funnel's arrows with the step after it, so it wraps between steps", () => {
    const run = page();
    const html = run<string>("dkFunnelHtml({ scanned: 9, cleared: 4, confirmed: 0, executed: 3, closed: 2, rejected: 5 })");
    expect(html).toBe('<div class="dk-funnel" aria-label="The funnel"><span class="dk-fn"><b>9</b> scanned</span><span class="dk-fn"><span class="dk-arrow" aria-hidden="true">→</span><b>4</b> cleared</span><span class="dk-fn"><span class="dk-arrow" aria-hidden="true">→</span><b>0</b> confirmed</span><span class="dk-fn"><span class="dk-arrow" aria-hidden="true">→</span><b>3</b> executed</span><span class="dk-fn"><span class="dk-arrow" aria-hidden="true">→</span><b>2</b> closed</span><span class="dk-fn">· 5 rejected</span></div>');
    // a step the read does not give is a zero, never "undefined"
    expect(run<string>("dkFunnelHtml({})")).not.toContain("undefined");
  });

  it("lays the room out on its own width: a line's row never takes a seat's fill, a step never breaks, the tag and time over the words in a narrow room", () => {
    const css = source("ui/desk.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => (css.match(new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`)) || [])[1] || "";
    expect(rule(".dk-room")).toContain("container-type: inline-size");
    expect(rule(".dk-fn")).toContain("white-space: nowrap");
    expect(rule(".dk-msg")).not.toMatch(/background|color:/);
    expect(rule(".dk-msg:hover")).toBe(" background: var(--hover); ");
    // the seats' tints are written for the tag; nothing pairs a row with a seat's class
    expect(css).not.toMatch(/\.dk-msg\.dk-(head|search|risk|sniper|exit|watch|flow|sentiment|you|account)/);
    expect(css).toMatch(/@container \(max-width: 479px\) \{\s*\.dk-msg \{ grid-template-columns: minmax\(0, 1fr\) auto; grid-template-areas: "tag at" "text text"; gap: 4px 8px; \}/);
    // and the page never puts a seat's class on a row again
    expect(source("ui/desk.js")).not.toMatch(/class="dk-msg dk-\$\{/);
  });
});
