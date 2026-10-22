/** The tower on the page (ui/agents-mount.js, ui/portfolio.js, ui/shell.js), run as the page runs them — every page script in
 * account.html's order, one global scope — over the stand-in browser the other ui-* tests use, with the elements kept by id: Stop all agents
 * where the agents are steered (Settings beside the session, the Agents sheet, Waiting for you), asked first, a free POST said done only when
 * the account took it; a session the owner stopped says when; and an agent's card said by this browser's own notification with the tab in
 * the background, where the owner asked for that. Nothing leaves the process. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const html = readFileSync(join(PUBLIC, "account.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1] ?? "");
const source = (src: string) => readFileSync(join(PUBLIC, src.replace(/^\//, "")), "utf8");

/** a browser's notifications as the page uses them: the permission (as the test sets it), the one ask, and every notification shown */
class FakeNotification {
  static permission = "default";
  static answer = "granted";
  static asked = 0;
  static shown: FakeNotification[] = [];
  closed = false;
  onclick: (() => void) | null = null;
  constructor(readonly title: string, readonly opts: { body?: string; tag?: string; requireInteraction?: boolean }) {
    FakeNotification.shown.push(this);
  }
  static async requestPermission() {
    FakeNotification.asked++;
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.answer;
  }
  close() {
    this.closed = true;
  }
}

/** the page's scripts in a stand-in browser: elements kept by id after the scripts loaded; `notifications` false: a browser without them */
function page(opts: { fetch?: (path: string, init?: { method?: string; body?: string }) => Promise<unknown>; notifications?: boolean } = {}) {
  const element = (): Record<string, unknown> => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, hidden: false, value: "", textContent: "", innerHTML: "", contains: () => false, open: false, title: "" });
  const kept: Record<string, Record<string, unknown>> = {};
  const store = new Map<string, string>();
  let started = false;
  FakeNotification.permission = "default";
  FakeNotification.answer = "granted";
  FakeNotification.asked = 0;
  FakeNotification.shown = [];
  const doc = { getElementById: (id: string) => (started ? (kept[id] ??= element()) : element()), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" }, setAttribute() {} }, hidden: false, visibilityState: "visible", focused: true, hasFocus() {
    return this.focused;
  }, activeElement: null, title: "" };
  const sandbox: Record<string, unknown> = {
    document: doc,
    location: { hash: "", origin: "http://127.0.0.1:4895" },
    history: { replaceState() {} },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) },
    MutationObserver: class {
      observe() {}
    },
    Event: class {
      constructor(readonly type: string) {}
    },
    addEventListener() {},
    dispatchEvent: () => true,
    scrollTo() {},
    focus() {},
    indexedDB: { open: () => ({}) },
    fetch: opts.fetch ?? (() => new Promise(() => {})),
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    ...(opts.notifications === false ? {} : { Notification: FakeNotification }),
  };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  for (const src of scripts) new Script(source(src), { filename: src }).runInContext(ctx);
  started = true;
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  // the sheet's frame, the reads, the toasts and the routes are not the browser's here: what they were asked is kept
  run("var SHEETS = []; openSheet = (html, o) => { SHEETS.push({ html, title: o && o.title }); return { addEventListener() {}, querySelector: () => null }; }; var LOADS = 0; load = async () => { LOADS++; }; renderWallets = () => {}; var TOASTS = []; toast = (c, k) => { TOASTS.push([c, k]); return null; }; var RENDERS = 0; render = () => { RENDERS++; }; var GONE = []; go = (tab, p) => { GONE.push([tab, p]); }");
  return { run, doc, store, out: <T = unknown>(code: string): T => JSON.parse(run<string>(`JSON.stringify(${code})`)) as T, set: (name: string, v: unknown) => run(`${name} = ${JSON.stringify(v)}`), el: (id: string) => kept[id] ?? {} };
}

const OWNER = 'Object.defineProperty(Owner, "role", { get: () => "owner", configurable: true })';
const LOOKER = 'Object.defineProperty(Owner, "role", { get: () => "pending", configurable: true })';
const KEY = { address: "0x510ee66f7e431b920aa58931396d674e03bec94f", name: "Claude Code", status: "ok", validUntil: "2026-11-05T00:00:00.000Z", code: "CC" };
const CARD = { id: "card-0001", flight: "PM-0001", usd: 24.49, reason: "Claude Code asks to buy 0.0004 BTC at Ex · market · about $24.00", hash: "0x00", kind: "agentLiveOrder", agent: KEY.address, agentName: "Claude Code", expiresAt: "2026-10-06T17:30:00.000Z", shown: [] };
const account = (extra: Record<string, unknown> = {}) => ({ now: "2026-10-06T17:00:00.000Z", mode: "guard", liveUsd: 1000, venues: [{ id: "ex", name: "Ex", live: true, usd: 1000, holdings: [], trade: { can: true, kinds: ["spot"] } }], keys: [KEY], spend: [], cards: [], asks: [], orders: [], payments: [], intents: [], watch: [], requests: [], subAccounts: [], signers: { owners: [], pendingDevices: [], threshold: 1 }, connectLive: { writes: { on: true, capUsd: 250 }, options: [] }, dial: { sessionExpiresAt: "2026-11-05T00:00:00.000Z", sessionEnded: false, maxLeverage: 1 }, health: {}, ...extra });
/** the dialog answered `yes` or Cancel; what it showed kept */
const answer = (p: ReturnType<typeof page>, v: "yes" | "") => p.run(`var ASKED = []; asking = async (html, read) => { ASKED.push(html); return read(${JSON.stringify(v)}); }`);

describe("Stop all agents", () => {
  it("sits beside the agents' session in Settings while it runs — offered to any browser here, Renew only to the owner's; a session the owner stopped says when, and only the owner starts a new one", () => {
    const p = page();
    p.run(OWNER);
    p.set("A", account());
    p.run("openSettings()");
    const dial = String(p.el("dial").innerHTML);
    expect(dial).toContain('<div class="btns"><button type="button" class="btn btn-sm btn-danger" id="session-stop">Stop all agents</button><button type="button" class="btn btn-sm" id="session-new">Renew for 30 days</button></div>');
    p.run(LOOKER);
    p.run("drawSettings()");
    expect(String(p.el("dial").innerHTML)).toContain('<div class="btns"><button type="button" class="btn btn-sm btn-danger" id="session-stop">Stop all agents</button></div>');
    // stopped: when, in New York's time; no second stop; a new session is the owner's
    p.run(OWNER);
    p.set("A", account({ dial: { sessionExpiresAt: "2026-10-06T16:30:00.000Z", sessionEnded: true, stoppedAt: "2026-10-06T16:30:00.000Z", maxLeverage: 1 } }));
    p.run("drawSettings()");
    const stopped = String(p.el("dial").innerHTML);
    expect(stopped).toContain("Stopped by you, Tue 6 Oct 12:30: agents can do nothing until you start a new session.");
    expect(stopped).not.toContain("session-stop");
    expect(stopped).toContain('id="session-new">Start a new one</button>');
  });

  it("asks first, saying what it does; Keep them running posts nothing; a yes is a free POST /api/agents/stop, said done in the account's own numbers — and a refusal is said as one", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    let reply: unknown = { ok: true, stoppedAt: "2026-10-06T17:00:00.000Z", cards: 2, desk: true, guard: true, openOrders: 1 };
    let status = 200;
    const p = page({ fetch: async (path, init) => {
      posts.push({ path, body: JSON.parse(init?.body ?? "{}") });
      return { status, ok: status < 400, json: async () => reply };
    } });
    p.run(LOOKER);
    p.set("A", account({ cards: [CARD, { ...CARD, id: "card-0002" }] }));
    answer(p, "");
    await p.run<Promise<void>>("stopAgentsAsk()");
    expect(posts).toEqual([]);
    const dialog = p.out<string[]>("ASKED")[0]!;
    expect(dialog).toContain('<h2 id="ask-title">Stop all agents?</h2>');
    expect(dialog).toContain("From this moment no agent can place, change or close an order, move money or pay — it can still cancel its own orders — and the 2 cards waiting for you are closed. Guard comes on and the desk pauses. Reads go on; keys, limits and the orders agents left at venues stay as they are. Starting them again is a new session, signed by you.");
    expect(dialog).toContain('<button type="submit" value="" class="btn">Keep them running</button><button type="submit" value="yes" class="btn btn-danger">Stop all agents</button>');
    answer(p, "yes");
    await p.run<Promise<void>>("stopAgentsAsk()");
    expect(posts).toEqual([{ path: "/api/agents/stop", body: {} }]);
    expect(p.out("[said, flash, LOADS]")).toEqual(["Every agent is stopped · 2 cards closed · Guard is on · the desk is paused. 1 order an agent placed is still open at its venue: Trade › Open orders cancels it.", "", 1]);
    // the account refused, or did not answer: nothing is said done
    p.run('said = ""');
    status = 500;
    reply = { ok: false, error: "the account is restarting" };
    await p.run<Promise<void>>("stopAgentsAsk()");
    expect(p.out("[said, flash]")).toEqual(["", "Not stopped: the account is restarting"]);
  });

  it("is in the Agents sheet while the session runs and an agent is let in, and on Waiting for you beside the count — with Notify me where this browser would show notifications", () => {
    const p = page();
    p.run(OWNER);
    p.set("A", account());
    p.run("renderAgents = () => {}; openAgents()");
    expect(p.out<Array<{ html: string }>>("SHEETS")[0]!.html).toContain('<h3 class="h2" id="agents-h">Agents</h3><div id="agents-stop"></div><div id="agents"></div>');
    expect(String(p.el("agents-stop").innerHTML)).toContain('<button type="button" class="btn btn-sm btn-danger" data-stop-agents>Stop all agents</button>');
    p.set("A", account({ keys: [] }));
    p.run("drawAgents()");
    expect(String(p.el("agents-stop").innerHTML)).toBe("");
    // Waiting for you: a card waits
    p.set("A", account({ cards: [CARD] }));
    const wait = p.run<string>('pfWaitingHtml({ kind: "all" }, true)');
    expect(wait).toContain('<h2 class="label warn-t" id="pf-wait-h">Waiting for you · 1</h2><div class="pf-wait-tools">');
    expect(wait).toMatch(/<button type="button" class="link dim" data-pf-act="notify-cards"[^>]*>Notify me<\/button><button type="button" class="btn btn-sm btn-danger" data-pf-act="stop-agents"[^>]*>Stop all agents<\/button>/);
    // already told, or the session over: neither offered
    p.run('localStorage.setItem("account.cards.notify", "1"); Notification.permission = "granted"');
    p.set("A", account({ cards: [CARD], dial: { sessionExpiresAt: "2026-10-06T16:30:00.000Z", sessionEnded: true, stoppedAt: "2026-10-06T16:30:00.000Z", maxLeverage: 1 } }));
    expect(p.run<string>('pfWaitingHtml({ kind: "all" }, true)')).not.toMatch(/notify-cards|stop-agents/);
    for (const [act, fn] of [["stop-agents", "stopAgentsAsk"], ["notify-cards", "shCardsTurnOn"]] as const) expect(source("ui/portfolio.js")).toContain(`case "${act}": return void (typeof ${fn} === "function" && ${fn}());`);
  });
});

describe("an agent's card, with the tab in the background", () => {
  const raised = { id: "card-0001", venue: "ex", outcome: "pending", at: "2026-10-06T17:00:00.000Z", reason: CARD.reason, usd: 24.49, expiresAt: "2026-10-06T17:30:00.000Z", agentName: "Claude Code" };

  it("is the browser's own notification where the owner asked for it: who asks, what, how much, until when; clicking it opens the card; an answer takes it away; with the page in front, nothing", () => {
    const p = page();
    // not asked for in this browser: nothing, whatever the permission
    FakeNotification.permission = "granted";
    p.run(`shCardNote(${JSON.stringify(raised)})`);
    expect(FakeNotification.shown).toHaveLength(0);
    p.store.set("account.cards.notify", "1");
    // the page in front and focused: the page shows the card itself
    p.run(`shCardNote(${JSON.stringify(raised)})`);
    expect(FakeNotification.shown).toHaveLength(0);
    // in the background
    p.doc.visibilityState = "hidden";
    p.doc.focused = false;
    p.run(`shCardNote(${JSON.stringify(raised)})`);
    expect(FakeNotification.shown.map((n) => [n.title, n.opts])).toEqual([["Claude Code is waiting for you", { body: `${CARD.reason} · $24.49 · answer by 13:30`, tag: "card-card-0001", requireInteraction: true }]]);
    FakeNotification.shown[0]!.onclick?.();
    expect(p.out("GONE")).toEqual([["portfolio", { card: "card-0001" }]]);
    expect(FakeNotification.shown[0]!.closed).toBe(true);
    // a second card, answered before it was clicked: its notification goes
    p.run(`shCardNote(${JSON.stringify({ ...raised, id: "card-0002" })})`);
    p.run('shCardNote({ id: "card-0002", venue: "ex", outcome: "approved", at: "2026-10-06T17:01:00.000Z" })');
    expect(FakeNotification.shown[1]!.closed).toBe(true);
    // what waits without a card (an ask, a knock) and the stop say nothing here
    p.run('shCardNote({ waits: "ask", venue: "ex", at: "2026-10-06T17:02:00.000Z" }); shCardNote({ stopped: "2026-10-06T17:02:00.000Z", at: "2026-10-06T17:02:00.000Z" })');
    expect(FakeNotification.shown).toHaveLength(2);
    expect(source("ui/shell.js")).toMatch(/shOn\("card", \(e\) => \{\s*shCardNote\(e\);\s*shSoon\(\);\s*\}\);/);
  });

  it("is turned on in Settings, or from Notify me: the browser's permission asked once; a browser that gives none leaves it off and says so; one that blocks it, or shows none, is told so with no switch", async () => {
    const p = page();
    p.run(OWNER);
    p.set("A", account());
    p.run("openSettings()");
    expect(p.el("set-cards-note").textContent).toBe("This browser tells you when an agent's card waits for you, with the tab in the background. A card nobody answers in 30 minutes expires.");
    expect(String(p.el("set-cards").innerHTML)).toMatch(/aria-label="Cards in the background"[^>]*><button type="button" data-v="on" aria-pressed="false">On<\/button><button type="button" data-v="off" aria-pressed="true">Off<\/button>/);
    // a no from the browser: still off, and said
    FakeNotification.answer = "denied";
    await p.run<Promise<void>>("shCardsTurnOn()");
    expect([FakeNotification.asked, p.store.get("account.cards.notify"), p.out("TOASTS")]).toEqual([1, undefined, [["This browser gave no permission for notifications: a card is still said on this page.", "info"]]]);
    p.run("drawSettings()");
    expect(p.el("set-cards-note").textContent).toBe("This browser's settings block notifications from this page: a card is said on this page.");
    expect(String(p.el("set-cards").innerHTML)).toBe("");
    // a yes: on, kept in this browser; turned off, every notification shown goes
    FakeNotification.permission = "default";
    FakeNotification.answer = "granted";
    await p.run<Promise<void>>("shCardsTurnOn()");
    expect([p.store.get("account.cards.notify"), p.run<boolean>("shCardsOn()")]).toEqual(["1", true]);
    p.run("drawSettings()");
    expect(String(p.el("set-cards").innerHTML)).toContain('data-v="on" aria-pressed="true">On</button>');
    p.run("shCardsTurnOff()");
    expect([p.store.get("account.cards.notify"), p.run<boolean>("shCardsOn()")]).toEqual([undefined, false]);
    // a browser that shows none
    const q = page({ notifications: false });
    q.run(OWNER);
    q.set("A", account());
    q.run("openSettings()");
    expect([q.el("set-cards-note").textContent, String(q.el("set-cards").innerHTML)]).toEqual(["This browser shows no notifications: a card is said on this page.", ""]);
  });
});
