import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

/** The chart (ui/chart.js), run as the page runs it: a plain script in one global scope after ui/core.js, here in a vm with a stand-in
 * document and fetch. What is checked is what the owner reads: round ticks on the price axis, the scales the candles are drawn with, the
 * readout's words, the time axis's labels, the last bar moved by a live price stamped inside its interval and by no other, a source's
 * refusal drawn in its own words with no axes, an empty history said quietly, an answer meant for another market or another bar size never
 * drawn, a pointer that moves only the crosshair and writes only the readout (whose box, laid over the plot, never changes a size: the
 * stylesheet is read for that, since a vm lays nothing out), nothing asked while the chart's pane is hidden, a live price that is no longer
 * the venue's word never laid over the source's close, a share's daily bar moved only in its regular session, and what release stops */
const UI = fileURLToPath(new URL("../../src/portfolio/public/ui/", import.meta.url));
// book.js after the chart, as account.html loads them: the chart asks it whether a read reached the account (bkUnanswered)
const FILES = ["core.js", "chart.js", "book.js"];

type Listener = (e: Record<string, unknown>) => void;
/** a stand-in element: what the chart writes into it (innerHTML through paint, attributes, classes, words) is kept to be read; its parts are
 * found by selector (each selector one stand-in, made on first ask); listeners are kept so a test can fire them */
interface Fake {
  sel: string;
  innerHTML: string;
  textContent: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  isConnected: boolean;
  clientWidth: number;
  clientHeight: number;
  attrs: Map<string, string>;
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean; toggle(c: string, on?: boolean): void };
  querySelector(s: string): Fake;
  querySelectorAll(): Fake[];
  addEventListener(t: string, fn: Listener): void;
  removeEventListener(t: string, fn: Listener): void;
  setAttribute(k: string, v: unknown): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  /** where set, the element's boxes (none: its pane is hidden); a stand-in without it counts as laid out */
  getClientRects?: () => unknown[];
  contains(): boolean;
  fire(type: string, e?: Record<string, unknown>): void;
  count(type: string): number;
}
function fake(sel = "root", size = { w: 640, h: 360 }): Fake {
  const kids = new Map<string, Fake>();
  const listeners = new Map<string, Set<Listener>>();
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const el: Fake = {
    sel,
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    isConnected: true,
    clientWidth: size.w,
    clientHeight: size.h,
    attrs,
    classes,
    classList: { add: (c) => void classes.add(c), remove: (c) => void classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => void ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)) },
    querySelector: (s) => {
      let k = kids.get(s);
      if (!k) kids.set(s, (k = fake(s, size)));
      return k;
    },
    querySelectorAll: () => [],
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn);
    },
    removeEventListener: (t, fn) => void listeners.get(t)?.delete(fn),
    setAttribute: (k, v) => void attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    removeAttribute: (k) => void attrs.delete(k),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: size.w, height: size.h }),
    contains: () => true,
    fire: (type, e = {}) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ preventDefault() {}, ...e });
    },
    count: (type) => listeners.get(type)?.size ?? 0,
  };
  return el;
}

/** a read's answer, by path: a body at once, or one the test hands over later (`later`). `ro`: a stand-in ResizeObserver whose callbacks
 * the test calls (the vm has none, so the chart falls back to the window's resize) */
type Answer = unknown | Promise<unknown>;
function page(answer: (path: string) => Answer = () => new Promise(() => {}), opts: { ro?: boolean } = {}) {
  const observers: Array<() => void> = [];
  const asked: string[] = [];
  const element = (): Record<string, unknown> => ({ addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, hidden: false, innerHTML: "", textContent: "", value: "" });
  const sandbox: Record<string, unknown> = {
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: element(), documentElement: { dataset: { theme: "cream" } } },
    location: { hash: "", origin: "http://127.0.0.1:4820" },
    history: { replaceState() {} },
    Event: class {
      constructor(readonly type: string) {}
    },
    addEventListener() {},
    dispatchEvent: () => true,
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    fetch: async (path: string) => {
      asked.push(path);
      const body = await answer(path);
      return { status: (body as { ok?: boolean })?.ok === false ? 409 : 200, statusText: "", json: async () => body };
    },
  };
  if (opts.ro)
    sandbox.ResizeObserver = class {
      constructor(fn: () => void) {
        observers.push(fn);
      }
      observe() {}
      disconnect() {}
    };
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  for (const f of FILES) new Script(readFileSync(`${UI}${f}`, "utf8"), { filename: f }).runInContext(ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  const el = fake();
  sandbox.EL = el;
  return { run, asked, el, sandbox, observers };
}
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
/** a read the test answers when it chooses */
function later() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** `n` hourly bars ending with the hour now running (its start `last`), each a little higher than the one before; volume on each */
function hourly(n: number, last = Math.floor(Date.now() / HOUR) * HOUR) {
  return Array.from({ length: n }, (_, k) => {
    const o = 83_000 + k * 10;
    return { t: last - (n - 1 - k) * HOUR, o, h: o + 40, l: o - 30, c: o + 12, v: 5 + k };
  });
}
const candles = (bars: unknown[], extra: Record<string, unknown> = {}) => ({ ok: true, venue: "okx", venueName: "OKX", symbol: "BTC/USDT", interval: "1h", candles: bars, ...extra });

describe("the chart's pure parts", () => {
  it("puts five to seven round ticks inside the range, each as its step writes it", () => {
    const p = page();
    expect(p.run("chNiceTicks(81556, 84103, 6)")).toEqual([82000, 82500, 83000, 83500, 84000]);
    expect(p.run("chNiceTicks(92, 208, 6)")).toEqual([100, 120, 140, 160, 180, 200]);
    for (const [lo, hi] of [[0.1234, 0.1299], [99.2, 100.4], [0.00001201, 0.00001288], [3120.5, 3188.25], [55, 62.5], [1, 1], [-3, 4]]) {
      const ticks = p.run<number[]>(`chNiceTicks(${lo}, ${hi}, 6)`);
      expect(ticks.length, `${lo}–${hi}`).toBeGreaterThanOrEqual(5);
      expect(ticks.length, `${lo}–${hi}`).toBeLessThanOrEqual(7);
      const step = ticks[1]! - ticks[0]!;
      // a round step: 1, 2, 2.5 or 5 times a power of ten
      const mant = Number((step / 10 ** Math.floor(Math.log10(step))).toPrecision(6));
      expect([1, 2, 2.5, 5]).toContain(mant);
      // evenly spaced, with no float tails
      for (let k = 1; k < ticks.length; k++) expect(Math.abs(ticks[k]! - ticks[k - 1]! - step)).toBeLessThan(step * 1e-9);
      for (const t of ticks) expect(String(t)).not.toMatch(/0000000|9999999/);
      // inside the range, or at most a step outside it where five did not fit inside
      if (lo !== hi) for (const t of ticks) expect(t >= lo! - step && t <= hi! + step).toBe(true);
    }
    // 4 ticks at 100, 8 at 50: the larger step, and the nearest round price just outside added on the nearer side
    expect(p.run("chNiceTicks(82941, 83359, 6)")).toEqual([82900, 83000, 83100, 83200, 83300]);
    // the scale opens to hold them, a quarter step beyond, so no label sits on the edge
    p.run("globalThis.SC0 = chScale([{ t: 0, o: 83000, h: 83330, l: 82970, c: 83100 }], 300, 300, 0)");
    expect(p.run("SC0.ticks.length")).toBeGreaterThanOrEqual(5);
    expect(p.run("SC0.lo < SC0.ticks[0] && SC0.hi > SC0.ticks[SC0.ticks.length - 1]")).toBe(true);
    expect(p.run("chNiceTicks(NaN, 3, 6)")).toEqual([]);
  });

  it("scales the newest bars that fit: right-aligned slots, an odd body, the price pane above the volume pane, volume on its own scale", () => {
    const p = page();
    const bars = Array.from({ length: 10 }, (_, k) => ({ t: k * HOUR, o: 120, h: k === 4 ? 200 : 150, l: k === 7 ? 100 : 110, c: 130, v: k }));
    p.run(`globalThis.SC = chScale(${JSON.stringify(bars)}, 200, 300, 60)`);
    const sc = (code: string) => p.run(`SC.${code}`);
    // 192 usable pixels, ten bars: each a 16-pixel slot (the most), the history sitting at the right
    expect(sc("from")).toBe(0);
    expect(sc("to")).toBe(10);
    expect(sc("slot")).toBe(16);
    expect(sc("bw")).toBe(11);
    expect(sc("cx(0)")).toBe(40);
    expect(sc("cx(9)")).toBe(184);
    expect(sc("at(184)")).toBe(9);
    expect(sc("at(41)")).toBe(0);
    expect(sc("at(-50)")).toBe(0);
    expect(sc("at(5000)")).toBe(9);
    // 100–200 opened 8% either side; the price pane ends above the volume pane and its gap
    expect(sc("lo")).toBe(92);
    expect(sc("hi")).toBe(208);
    expect(sc("bottom")).toBe(234);
    expect(sc("y(208)")).toBe(0);
    expect(sc("y(92)")).toBe(234);
    expect(sc("y(150)")).toBe(117);
    expect(sc("price(117)")).toBe(150);
    expect(sc("ticks")).toEqual([100, 120, 140, 160, 180, 200]);
    // volume: the highest shown is the pane's height less two; none is no bar
    expect(sc("volTop")).toBe(240);
    expect(sc("vh(9)")).toBe(58);
    expect(sc("vh(0)")).toBe(0);
    // no volume pane: the price pane is the whole height and no volume has a height
    expect(p.run(`chScale(${JSON.stringify(bars)}, 200, 300, 0).bottom`)).toBe(300);
    expect(p.run(`chScale(${JSON.stringify(bars)}, 200, 300, 0).vh(9)`)).toBe(0);
    // three hundred bars at 320 pixels: only the newest 62 are shown, and a spike in an older one does not stretch the range
    const many = Array.from({ length: 300 }, (_, k) => ({ t: k * HOUR, o: 100, h: k === 0 ? 10_000 : 101, l: 99, c: 100.5 }));
    p.run(`globalThis.SC2 = chScale(${JSON.stringify(many)}, 320, 300, 0)`);
    expect(p.run("SC2.from")).toBe(238);
    expect(p.run("SC2.n")).toBe(62);
    expect(p.run("SC2.hi")).toBeLessThan(102);
    expect(p.run("SC2.bw")).toBeGreaterThanOrEqual(1);
    expect(p.run("SC2.bw % 2")).toBe(1);
  });

  it("says a bar's open, high, low and close and its change from the close before, signed, in the market's own figures", () => {
    const p = page();
    expect(p.run("chReadout({ o: 83134, h: 84103, l: 81556, c: 81901 }, 83134, chFmt(0, false)).text")).toBe("O 83,134 H 84,103 L 81,556 C 81,901 −1,233.0 (−1.48%)");
    expect(p.run("chReadout({ o: 227.1, h: 228.4, l: 226.9, c: 228.12 }, 227.5, chFmt(2, false)).text")).toBe("O 227.10 H 228.40 L 226.90 C 228.12 +0.62 (+0.27%)");
    // the first bar has nothing before it: no change is said
    expect(p.run("chReadout({ o: 10, h: 11, l: 9, c: 10.5 }, null, chFmt(1, false)).text")).toBe("O 10.0 H 11.0 L 9.0 C 10.5");
    // an event contract's in cents
    expect(p.run("chReadout({ o: 61.5, h: 63, l: 60, c: 60.2 }, 61.5, chFmt(1, true)).text")).toBe("O 61.5¢ H 63.0¢ L 60.0¢ C 60.2¢ −1.3¢ (−2.11%)");
    // the html tints the figures by the bar's direction and the change by its sign; never colour alone (the sign is in the words)
    const html = p.run<string>("chReadout({ o: 83134, h: 84103, l: 81556, c: 81901 }, 83134, chFmt(0, false)).html");
    expect(html).toContain('<span class="ch-v down">81,901</span>');
    expect(html).toContain('<span class="ch-d down">−1,233.0 (−1.48%)</span>');
    expect(p.run("chReadout({ o: 1, h: 1, l: 1, c: 1 }, 1, chFmt(0, false)).text")).toBe("O 1 H 1 L 1 C 1 0.0 (0.00%)");
    // a change under a hundredth of a percent is not "0.00%"
    expect(p.run("chReadout({ o: 81499.99, h: 81511.93, l: 81499.99, c: 81503.78 }, 81499.99, chFmt(2, false)).text")).toBe("O 81,499.99 H 81,511.93 L 81,499.99 C 81,503.78 +3.79 (+0.0047%)");
    // a change too small for the figures is said to two significant figures, never a rounded zero with a sign
    expect(p.run("chReadout({ o: 100, h: 101, l: 99, c: 100.004 }, 100, chFmt(2, false)).text")).toBe("O 100.00 H 101.00 L 99.00 C 100.00 +0.004 (+0.004%)");
    expect(p.run("chReadout({ o: 100, h: 101, l: 99, c: 99.996 }, 100, chFmt(2, false)).text")).toBe("O 100.00 H 101.00 L 99.00 C 100.00 −0.004 (−0.004%)");
    expect(p.run("chReadout({ o: 50, h: 51, l: 49, c: 50.004 }, 50, chFmt(1, true)).text")).toBe("O 50.0¢ H 51.0¢ L 49.0¢ C 50.0¢ +0.004¢ (+0.008%)");
    // each key with its figure, and the change, one unit that does not break across lines
    expect(html).toContain('<span class="ch-kv"><span class="ch-k">O</span> <span class="ch-v down">83,134</span></span>');
  });

  it("carries the market's own precision: its price step's, else its bars' own held to five significant figures; cents for an event", () => {
    const p = page();
    expect(p.run('chDecimals([{ o: 83134.5, h: 83200, l: 83100, c: 83150.5 }], false)')).toBe(1);
    expect(p.run('chDecimals([{ o: 83134.51, h: 83200.123, l: 83100, c: 83150 }], false)')).toBe(2);
    expect(p.run('chDecimals([{ o: 227.52, h: 228, l: 227, c: 227.5 }], false)')).toBe(2);
    expect(p.run('chDecimals([{ o: 0.00001234, h: 0.00001301, l: 0.0000122, c: 0.00001288 }], false)')).toBe(8);
    expect(p.run('chDecimals([{ o: 1, h: 2, l: 1, c: 2 }], false, 0.01)')).toBe(2);
    expect(p.run('chDecimals([{ o: 61.5, h: 62, l: 60, c: 61 }], true)')).toBe(1);
    expect(p.run('chDecimals([], true, 0.01)')).toBe(0);
    expect(p.run('chDecimals([], true, 0.001)')).toBe(1);
    // a step of a cent never rounds the source's half cents away (Polymarket's prices-history: 66.5¢ on a market whose step is 0.01)
    expect(p.run('chDecimals([{ o: 65.5, h: 67.5, l: 65.5, c: 66.5 }], true, 0.01)')).toBe(1);
    expect(p.run('chDecimals([{ o: 66, h: 67, l: 65, c: 66 }], true, 0.01)')).toBe(0);
    // finer bars than the step: their own decimals (held to five significant figures); coarser bars: the step's
    expect(p.run('chDecimals([{ o: 1.234, h: 1.25, l: 1.2, c: 1.2345 }], false, 0.01)')).toBe(4);
    expect(p.run('chDecimals([{ o: 83134.517, h: 83200, l: 83100, c: 83150 }], false, 0.1)')).toBe(2);
    expect(p.run("chFmt(2, false)(1234.5)")).toBe("1,234.50");
    expect(p.run("chFmt(1, true)(62.5)")).toBe("62.5¢");
    expect(p.run("chFmt(2, false)(undefined)")).toBe("—");
  });

  it("labels the time axis by the bar size: HH:MM within a day and the date where one begins; a daily bar's own day", () => {
    const p = page();
    const t0 = Date.UTC(2026, 9, 14, 20);
    const bars = Array.from({ length: 9 }, (_, k) => ({ t: t0 + k * HOUR }));
    const got = p.run<Array<{ i: number; text: string; rank: number }>>(`chTimeLabels(${JSON.stringify(bars)}, "1h", "UTC")`);
    expect(got.map((l) => `${l.text}/${l.rank}`)).toEqual(["21:00/2", "22:00/1", "23:00/1", "15 Oct/4", "01:00/1", "02:00/1", "03:00/2", "04:00/1"]);
    // on 5m bars: the quarter hours are candidates, the full hour ranks above them
    const fives = Array.from({ length: 13 }, (_, k) => ({ t: Date.UTC(2026, 9, 14, 9) + k * 300_000 }));
    expect(p.run<Array<{ text: string; rank: number }>>(`chTimeLabels(${JSON.stringify(fives)}, "5m", "UTC")`).map((l) => `${l.text}/${l.rank}`)).toEqual(["09:15/0.5", "09:30/1", "09:45/0.5", "10:00/2"]);
    // daily bars at Universal midnight: each the day it starts; a new month ranks above the days
    const days = Array.from({ length: 4 }, (_, k) => ({ t: Date.UTC(2026, 8, 29) + k * DAY }));
    const d = p.run<Array<{ text: string; rank: number }>>(`chTimeLabels(${JSON.stringify(days)}, "1d", "UTC")`);
    expect(d.map((l) => l.text)).toEqual(["30 Sept", "1 Oct", "2 Oct"].map((x) => x.replace("Sept", p.run<string>('new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 8, 30)))'))));
    expect(d.find((l) => l.text === "1 Oct")!.rank).toBe(3);
    // a share's daily bars stamped at New York's open (13:30 Universal): the day in New York, whatever the viewer's clock
    const shares = [{ t: Date.UTC(2026, 9, 13, 13, 30) }, { t: Date.UTC(2026, 9, 14, 13, 30) }];
    expect(p.run<Array<{ text: string }>>(`chTimeLabels(${JSON.stringify(shares)}, "1d", "Asia/Tokyo")`).map((l) => l.text)).toEqual(["14 Oct"]);
    // the crosshair's time
    expect(p.run(`chWhen(${Date.UTC(2026, 9, 14, 13, 5)}, "1h", "UTC")`)).toBe("Wed 14 Oct 13:05");
    expect(p.run(`chWhen(${Date.UTC(2026, 9, 14)}, "1d", "Asia/Tokyo")`)).toBe("Wed 14 Oct 2026");
    // a daily bar from Hong Kong's (or Tokyo's) midnight in New York's winter is Hong Kong's day, not New York's morning before it; a
    // share's bar at New York's winter open is New York's day
    expect(p.run(`chWhen(${Date.UTC(2026, 0, 14, 16)}, "1d", "UTC")`)).toBe("Thu 15 Jan 2026");
    expect(p.run(`chWhen(${Date.UTC(2026, 6, 14, 16)}, "1d", "UTC")`)).toBe("Wed 15 Jul 2026");
    expect(p.run(`chWhen(${Date.UTC(2026, 0, 14, 15)}, "1d", "UTC")`)).toBe("Thu 15 Jan 2026");
    expect(p.run(`chWhen(${Date.UTC(2026, 0, 15, 14, 30)}, "1d", "Asia/Tokyo")`)).toBe("Thu 15 Jan 2026");
  });

  it("labels hourly bars on a clock half or three quarters of an hour off Universal Time: the bars' own round times, on that clock", () => {
    const p = page();
    const bars = Array.from({ length: 9 }, (_, k) => ({ t: Date.UTC(2026, 9, 14, 0) + k * HOUR }));
    // Kolkata (+5:30): the bars start at 05:30, 06:30 … — each still a candidate, ranked by its place among the bars' own hours
    expect(p.run<Array<{ text: string; rank: number }>>(`chTimeLabels(${JSON.stringify(bars)}, "1h", "Asia/Kolkata")`).map((l) => `${l.text}/${l.rank}`)).toEqual(["06:30/2.5", "07:30/1", "08:30/1", "09:30/2", "10:30/1", "11:30/1", "12:30/3", "13:30/1"]);
    for (const zone of ["Asia/Kathmandu", "Australia/Adelaide", "America/St_Johns"]) {
      const got = p.run<Array<{ text: string }>>(`chTimeLabels(${JSON.stringify(bars)}, "1h", ${JSON.stringify(zone)})`);
      // every bar after the first is a candidate (a time, or the date where a day begins): none left without a label
      expect(got.length, zone).toBe(8);
      expect(got.some((l) => /^\d\d:\d\d$/.test(l.text)), zone).toBe(true);
    }
    // a whole-hour clock is as before: New York's round hours
    expect(p.run<Array<{ text: string; rank: number }>>(`chTimeLabels(${JSON.stringify(bars)}, "1h", "America/New_York")`).map((l) => `${l.text}/${l.rank}`).slice(0, 3)).toEqual(["21:00/2", "22:00/1", "23:00/1"]);
    // 5m bars in Kolkata keep its own quarter hours
    const fives = Array.from({ length: 7 }, (_, k) => ({ t: Date.UTC(2026, 9, 14, 9) + k * 300_000 }));
    expect(p.run<Array<{ text: string; rank: number }>>(`chTimeLabels(${JSON.stringify(fives)}, "5m", "Asia/Kolkata")`).map((l) => `${l.text}/${l.rank}`)).toEqual(["14:45/0.5", "15:00/2.5"]);
  });

  it("takes a share's daily bar to the regular session only: the session the venue says, and the price's own time 09:30–16:00 New York", () => {
    const p = page();
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 14, h, m); // 14 Oct 2026: New York is four hours behind
    expect(p.run(`chRegular({ open: true, phase: "regular" }, ${at(14)})`)).toBe(true);
    expect(p.run(`chRegular({ open: true }, ${at(13, 30)})`)).toBe(true);
    expect(p.run(`chRegular({ open: true }, ${at(13, 29)})`)).toBe(false);
    expect(p.run(`chRegular({ open: true, phase: "regular" }, ${at(20)})`)).toBe(false);
    expect(p.run(`chRegular({ open: false, phase: "after" }, ${at(19)})`)).toBe(false);
    expect(p.run(`chRegular({ open: false, phase: "overnight" }, ${at(14)})`)).toBe(false);
    expect(p.run(`chRegular({ open: false }, ${at(14)})`)).toBe(false);
    expect(p.run(`chRegular(undefined, ${at(14)})`)).toBe(false);
  });

  it("keeps room under the plot's top edge for the readout laid over it: set by the layout's width, never by the bar under the pointer", () => {
    const p = page();
    // four keys with nine-character figures and the change: one line at 600 pixels, two at 300, three at 200
    expect(p.run("chReadoutLines(9, 600)")).toBe(1);
    expect(p.run("chReadoutLines(9, 300)")).toBe(2);
    expect(p.run("chReadoutLines(9, 200)")).toBe(3);
    // a narrow chart's smaller words: three keys a line at 220 pixels, so two lines
    expect(p.run("chReadoutLines(9, 220, true)")).toBe(2);
    const bars = Array.from({ length: 10 }, (_, k) => ({ t: k * HOUR, o: 120, h: 150, l: 110, c: 130 }));
    // without room: 110–150 opened 8%, the highest high 7% under the edge; with 40 pixels kept, the highest high sits at 40
    p.run(`globalThis.S0 = chScale(${JSON.stringify(bars)}, 200, 300, 0); globalThis.S1 = chScale(${JSON.stringify(bars)}, 200, 300, 0, 40)`);
    expect(p.run("S0.y(150)")).toBeLessThan(40);
    expect(Math.round(p.run<number>("S1.y(150)"))).toBe(40);
    // the foot stays where it was: the range opened upward only
    expect(p.run("S1.lo")).toBe(p.run("S0.lo"));
    expect(p.run("S1.y(S1.lo)")).toBeCloseTo(300, 9);
    expect(p.run("S1.price(S1.y(137.5))")).toBeCloseTo(137.5, 9);
    // room already there (a short pane's padding is more than it): nothing opens
    expect(p.run(`chScale(${JSON.stringify(bars)}, 200, 300, 0, 5).hi`)).toBe(p.run("S0.hi"));
  });

  it("moves the last bar with a live price only while the price's time is inside that bar's interval, and never makes a bar", () => {
    const p = page();
    p.run(`globalThis.B = [{ t: 0, o: 10, h: 12, l: 9, c: 11 }, { t: ${HOUR}, o: 11, h: 13, l: 10, c: 12 }]`);
    expect(p.run(`chApplyQuote(B, { price: 14, at: ${HOUR + 60_000} }, ${HOUR})`)).toBe(true);
    expect(p.run("B[1]")).toEqual({ t: HOUR, o: 11, h: 14, l: 10, c: 14 });
    expect(p.run(`chApplyQuote(B, { price: 9.5, at: ${HOUR + 120_000} }, ${HOUR})`)).toBe(true);
    expect(p.run("B[1]")).toEqual({ t: HOUR, o: 11, h: 14, l: 9.5, c: 9.5 });
    // a price stamped in the bar before, or after the last bar's end: nothing moves, no bar is added
    expect(p.run(`chApplyQuote(B, { price: 20, at: ${HOUR - 1} }, ${HOUR})`)).toBe(false);
    expect(p.run(`chApplyQuote(B, { price: 20, at: ${2 * HOUR} }, ${HOUR})`)).toBe(false);
    expect(p.run("B.length")).toBe(2);
    expect(p.run("B[1].c")).toBe(9.5);
    expect(p.run(`chApplyQuote([], { price: 20, at: 0 }, ${HOUR})`)).toBe(false);
  });
});

describe("the chart mounted", () => {
  it("draws the source's bars: candles, volume, both axes, the last price in a tag; the readout on the last bar; whose bars in the foot", async () => {
    const bars = hourly(30);
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(bars) : new Promise(() => {})));
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT", kind: "spot", quote: "USDT" })');
    await settle();
    expect(p.asked[0]).toBe("/api/account/candles?venue=okx&symbol=BTC%2FUSDT&interval=1h");
    const draw = p.el.querySelector(".ch-draw").innerHTML;
    expect(draw).toMatch(/^<svg class="ch-svg" width="640" height="360"/);
    // up candles and their volume (every bar here closes above its open), the grid, the axes' figures
    expect(draw).toMatch(/<path class="ch-cu" d="M\d+ \d+h1v\d+h-1Z/);
    expect(draw).toContain('<path class="ch-cd" d=""/>');
    expect(draw).toMatch(/<path class="ch-vu" d="M/);
    expect(draw).toMatch(/<text class="ch-ax" x="\d+" y="\d+">83,\d00<\/text>/);
    // the last price: a dashed line and its value in a tag, tinted by the last bar's direction
    const last = bars[bars.length - 1]!;
    expect(draw).toContain('class="ch-last up"');
    expect(draw).toContain(`<text class="ch-tagt"`);
    expect(draw).toContain(`>${last.c.toLocaleString("en-US")}</text></svg>`);
    expect(draw).toContain("BTC/USDT at OKX, 1h bars");
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toContain(`<span class="ch-v up">${last.c.toLocaleString("en-US")}</span>`);
    expect(p.el.querySelector(".ch-foot").innerHTML).toMatch(/^OKX · 1h bars · prices in USDT · /);
    // the crosshair is drawn once, hidden until a pointer is over the plot
    expect(p.el.querySelector(".ch-cross").innerHTML).toContain('<g class="ch-xv"');
    expect(p.el.querySelector(".ch-cross").classes.has("on")).toBe(false);
    // the buttons: 5m · 1h · 1D, 1h pressed
    expect(p.el.innerHTML).toContain('data-ch-iv="1h" aria-pressed="true"');
    expect(p.el.innerHTML).toContain('data-ch-iv="1d" aria-pressed="false" data-fk="ch-iv:1d">1D</button>');
    p.run("chRelease(EL)");
  });

  it("moves the last bar with a live price stamped inside its hour, and a price stamped in the hour before moves nothing", async () => {
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    const bars = hourly(24, start);
    const last = bars[bars.length - 1]!;
    const inside = page((path) => (path.startsWith("/api/account/candles") ? candles(bars) : { ok: true, quotes: [{ venue: "okx", symbol: "BTC/USDT", market: { price: last.h + 500, quoteAt: new Date(start + 1_000).toISOString() } }] }));
    inside.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT", kind: "spot" })');
    await settle();
    // the live price was asked as soon as the bars came, for this one market
    expect(inside.asked).toContain(`/api/account/quotes?pairs=${encodeURIComponent("okx|BTC/USDT")}`);
    expect(inside.run("CH.get(EL).bars.length")).toBe(24);
    expect(inside.run("CH.get(EL).bars.at(-1)")).toEqual({ ...last, c: last.h + 500, h: last.h + 500 });
    // the bar before is the source's, untouched; the tag and the readout say the new close
    expect(inside.run("CH.get(EL).bars.at(-2)")).toEqual(bars[22]);
    expect(inside.el.querySelector(".ch-draw").innerHTML).toContain(`>${(last.h + 500).toLocaleString("en-US")}</text></svg>`);
    expect(inside.el.querySelector(".ch-ohlc").innerHTML).toContain(`H</span> <span class="ch-v up">${(last.h + 500).toLocaleString("en-US")}`);
    inside.run("chRelease(EL)");

    const before = page((path) => (path.startsWith("/api/account/candles") ? candles(bars) : { ok: true, quotes: [{ venue: "okx", symbol: "BTC/USDT", market: { price: last.h + 500, quoteAt: new Date(start - 1_000).toISOString() } }] }));
    before.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT", kind: "spot" })');
    await settle();
    expect(before.asked.some((x) => x.startsWith("/api/account/quotes"))).toBe(true);
    expect(before.run("CH.get(EL).bars.at(-1)")).toEqual(last);
    expect(before.run("CH.get(EL).bars.length")).toBe(24);
    before.run("chRelease(EL)");
  });

  it("asks no live price for bars that ended long ago (a market closed since yesterday), and never adds a bar", async () => {
    const day = Math.floor(Date.now() / DAY) * DAY;
    const bars = Array.from({ length: 5 }, (_, k) => ({ t: day - (6 - k) * DAY, o: 100, h: 102, l: 99, c: 101 }));
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(bars, { interval: "1d" }) : { ok: true, quotes: [{ venue: "okx", symbol: "BTC/USDT", market: { price: 150 } }] }));
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT", kind: "spot", interval: "1d" })');
    await settle();
    expect(p.asked.some((x) => x.startsWith("/api/account/quotes"))).toBe(false);
    p.run("chQuote(CH.get(EL))");
    await settle();
    // asked by hand, its unstamped price is now: after the last bar's day, so it moves nothing
    expect(p.run("CH.get(EL).bars.length")).toBe(5);
    expect(p.run("CH.get(EL).bars.at(-1).c")).toBe(101);
    p.run("chRelease(EL)");
  });

  it("draws an event contract in cents: the axis, the tag and the readout; the live price too", async () => {
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    const bars = [
      { t: start - HOUR, o: 0.6, h: 0.63, l: 0.59, c: 0.615 },
      { t: start, o: 0.615, h: 0.62, l: 0.6, c: 0.61 },
    ];
    const p = page((path) => (path.startsWith("/api/account/candles") ? { ok: true, venue: "kalshi", venueName: "Kalshi", symbol: "KXFED:YES", interval: "1h", candles: bars } : { ok: true, quotes: [{ venue: "kalshi", symbol: "KXFED:YES", market: { price: 0.633 } }] }));
    p.run('chMount(EL, { venue: "kalshi", symbol: "KXFED:YES", kind: "event", quote: "USD", priceStep: 0.001 })');
    await settle();
    const draw = p.el.querySelector(".ch-draw").innerHTML;
    expect(draw).toMatch(/¢<\/text>/);
    // the live price (63.3¢, read now: inside the hour) moved the close and the high
    expect(p.run("CH.get(EL).bars.at(-1)")).toEqual({ t: start, o: 61.5, h: 63.3, l: 60, c: 63.3 });
    expect(draw).toContain(">63.3¢</text></svg>");
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toContain("61.5¢");
    expect(p.el.querySelector(".ch-foot").innerHTML).toContain("prices in cents");
    p.run("chRelease(EL)");
  });

  it("draws a source's refusal in its own words, escaped, with no axes and no crosshair; an empty history is a quiet line", async () => {
    const p = page(() => ({ ok: false, refusal: { code: "E_VENUE_RAIL_CLOSED", venue: "kalshi", message: "Kalshi publishes no price history for <b>this</b> market." } }));
    p.run('chMount(EL, { venue: "kalshi", symbol: "KXFED:YES", kind: "event" })');
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toBe('<p class="ch-msg ch-no">Kalshi publishes no price history for &lt;b&gt;this&lt;/b&gt; market.</p>');
    expect(p.el.querySelector(".ch-cross").innerHTML).toBe("");
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toBe("");
    expect(p.el.querySelector(".ch-foot").innerHTML).toBe("");
    // no live price is asked for a chart with no bars
    expect(p.asked.some((x) => x.startsWith("/api/account/quotes"))).toBe(false);
    p.run("chRelease(EL)");

    // a read that never reached the account (core api's { ok: false, error } with the browser's own words): said in the page's words,
    // never the browser's error as it was thrown, with how long the chart now waits before asking again
    const none = page(() => ({ ok: false, error: "fetch failed" }));
    none.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    expect(none.el.querySelector(".ch-draw").innerHTML).toBe('<p class="ch-msg ch-no">No price history: the account is not answering. Asking again every 2 s.</p>');
    none.run("chRelease(EL)");
    // an error the account wrote itself is its own words, said as they are
    const own = page(() => ({ ok: false, error: "The account hit an error answering this; it was recorded." }));
    own.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    expect(own.el.querySelector(".ch-draw").innerHTML).toBe('<p class="ch-msg ch-no">The account hit an error answering this; it was recorded. Asking again every 2 s.</p>');
    own.run("chRelease(EL)");

    const empty = page(() => candles([], { venueName: "OKX <x>" }));
    empty.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    expect(empty.el.querySelector(".ch-draw").innerHTML).toBe('<p class="ch-msg">No 1h bars from OKX &lt;x&gt; for BTC/USDT yet.</p>');
    expect(empty.el.querySelector(".ch-draw").innerHTML).not.toContain("<svg");
    empty.run("chRelease(EL)");
  });

  it("never draws an answer meant for another market or another bar size", async () => {
    const waits = new Map<string, ReturnType<typeof later>>();
    const p = page((path) => {
      if (!path.startsWith("/api/account/candles")) return new Promise(() => {});
      const w = later();
      waits.set(path, w);
      return w.promise;
    });
    const path = (venue: string, symbol: string, interval: string) => `/api/account/candles?${new URLSearchParams({ venue, symbol, interval })}`;
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    p.run('chMount(EL, { venue: "kraken", symbol: "ETH/USD" })');
    await settle(2);
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("Reading the 1h bars");
    waits.get(path("kraken", "ETH/USD", "1h"))!.resolve({ ok: true, venue: "kraken", venueName: "Kraken", symbol: "ETH/USD", interval: "1h", candles: hourly(5).map((b) => ({ ...b, o: 3100, h: 3120, l: 3090, c: 3110 })) });
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("ETH/USD at Kraken, 1h bars");
    // the first market's answer comes late: it is not drawn
    waits.get(path("okx", "BTC/USDT", "1h"))!.resolve(candles(hourly(5)));
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("ETH/USD at Kraken");
    expect(p.el.querySelector(".ch-draw").innerHTML).not.toContain("BTC/USDT");

    // another bar size pressed while the first is on its way: the buttons say it at once, and only its answer is drawn
    p.run('chMount(EL, { venue: "okx", symbol: "SOL/USDT", onInterval: (iv) => (globalThis.PICKED = iv) })');
    p.el.fire("click", { target: { closest: () => ({ dataset: { chIv: "5m" } }) } });
    expect(p.run("PICKED")).toBe("5m");
    expect(p.run("chInterval(EL)")).toBe("5m");
    expect(p.el.querySelector(".ch-ivs").innerHTML).toContain('data-ch-iv="5m" aria-pressed="true"');
    await settle(2);
    waits.get(path("okx", "SOL/USDT", "5m"))!.resolve({ ok: true, venue: "okx", venueName: "OKX", symbol: "SOL/USDT", interval: "5m", candles: hourly(5).map((b) => ({ ...b, o: 150, h: 151, l: 149, c: 150.5 })) });
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("SOL/USDT at OKX, 5m bars");
    waits.get(path("okx", "SOL/USDT", "1h"))!.resolve({ ok: true, venue: "okx", venueName: "OKX", symbol: "SOL/USDT", interval: "1h", candles: hourly(5) });
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("SOL/USDT at OKX, 5m bars");
    expect(p.run("CH.get(EL).bars[0].o")).toBe(150);
    p.run("chRelease(EL)");
  });

  it("draws nothing of a market or a bar size left behind even when its answer lands before the new one's", async () => {
    const waits = new Map<string, ReturnType<typeof later>>();
    const p = page((path) => {
      if (!path.startsWith("/api/account/candles")) return new Promise(() => {});
      const w = later();
      waits.set(path, w);
      return w.promise;
    });
    const path = (venue: string, symbol: string, interval: string) => `/api/account/candles?${new URLSearchParams({ venue, symbol, interval })}`;
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    p.run('chMount(EL, { venue: "kraken", symbol: "ETH/USD" })');
    await settle(2);
    // the first market's answer lands while the second's is still on its way: the panel keeps reading
    waits.get(path("okx", "BTC/USDT", "1h"))!.resolve(candles(hourly(5)));
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("Reading the 1h bars");
    expect(p.el.querySelector(".ch-draw").innerHTML).not.toContain("BTC/USDT");
    expect(p.run("CH.get(EL).bars")).toBe(null);
    waits.get(path("kraken", "ETH/USD", "1h"))!.resolve({ ok: true, venue: "kraken", venueName: "Kraken", symbol: "ETH/USD", interval: "1h", candles: hourly(5) });
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("ETH/USD at Kraken, 1h bars");

    // another bar size pressed; the bar size before's answer lands first: still reading the new one
    p.el.fire("click", { target: { closest: () => ({ dataset: { chIv: "1d" } }) } });
    p.el.fire("click", { target: { closest: () => ({ dataset: { chIv: "5m" } }) } });
    await settle(2);
    waits.get(path("kraken", "ETH/USD", "1d"))!.resolve({ ok: true, venue: "kraken", venueName: "Kraken", symbol: "ETH/USD", interval: "1d", candles: hourly(5) });
    await settle();
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("Reading the 5m bars");
    expect(p.run("CH.get(EL).bars")).toBe(null);
    p.run("chRelease(EL)");
  });

  it("moves only the crosshair with the pointer: the picture is not drawn again, the readout says the bar under it", async () => {
    const bars = hourly(30);
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(bars) : new Promise(() => {})));
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    const draw = p.el.querySelector(".ch-draw");
    const picture = draw.innerHTML;
    const plot = p.el.querySelector(".ch-plot");
    const cross = p.el.querySelector(".ch-cross");
    const i = p.run<number>("CH.get(EL).L.sc.at(300)");
    const x = p.run<number>(`CH.get(EL).L.sc.cx(${i})`);
    const frame = p.el.innerHTML;
    // every part the pointer and the keys draw into, recorded
    p.run("globalThis.PN = []; globalThis.P0 = paint; paint = (el, html) => (PN.push(el.sel), P0(el, html))");
    plot.fire("pointermove", { clientX: 300, clientY: 100 });
    expect(draw.innerHTML).toBe(picture);
    expect(cross.classes.has("on")).toBe(true);
    expect(cross.querySelector(".ch-xv").attrs.get("transform")).toBe(`translate(${x} 0)`);
    expect(cross.querySelector(".ch-xh").attrs.get("transform")).toBe("translate(0 100)");
    expect(cross.querySelector(".ch-xh").attrs.get("visibility")).toBe("visible");
    expect(cross.querySelector(".ch-xpr").attrs.get("y")).toBe("-9");
    expect(cross.querySelector(".ch-xpt").attrs.get("y")).toBe("4");
    // the price at the pointer in its tag, the bar's time in the other
    expect(cross.querySelector(".ch-xpt").textContent).toBe(p.run<string>("CH.get(EL).L.fmt(CH.get(EL).L.sc.price(100))"));
    expect(cross.querySelector(".ch-xtt").textContent).toBe(p.run<string>(`chWhen(${bars[i]!.t}, "1h")`));
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toContain(`<span class="ch-v up">${bars[i]!.o.toLocaleString("en-US")}</span>`);
    // at the price pane's top edge: the line where the pointer is, its tag kept whole inside the pane
    plot.fire("pointermove", { clientX: 300, clientY: 2 });
    expect(cross.querySelector(".ch-xh").attrs.get("transform")).toBe("translate(0 2)");
    expect(cross.querySelector(".ch-xpr").attrs.get("y")).toBe("-2");
    expect(cross.querySelector(".ch-xpt").attrs.get("y")).toBe("11");
    // over the volume pane: no price line
    plot.fire("pointermove", { clientX: 300, clientY: 330 });
    expect(cross.querySelector(".ch-xh").attrs.get("visibility")).toBe("hidden");
    expect(draw.innerHTML).toBe(picture);
    // the keys: ← reads the bar before the last
    plot.fire("keydown", { key: "ArrowLeft" });
    plot.fire("keydown", { key: "ArrowLeft" });
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toContain(`<span class="ch-v up">${bars[28]!.o.toLocaleString("en-US")}</span>`);
    // away: no crosshair, the readout on the last bar again
    plot.fire("pointerleave");
    expect(cross.classes.has("on")).toBe(false);
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toContain(`<span class="ch-v up">${bars[29]!.o.toLocaleString("en-US")}</span>`);
    expect(draw.innerHTML).toBe(picture);
    // the pointer and the keys wrote into the readout and nothing else: the frame, the head, the foot and the picture are as they were
    expect(new Set(p.run<string[]>("PN"))).toEqual(new Set([".ch-ohlc"]));
    expect(p.el.innerHTML).toBe(frame);
    p.run("chRelease(EL)");
  });

  it("stops on release: no timer, no listener, and an answer that lands afterwards changes nothing", async () => {
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    const bars = hourly(10, start);
    const quote = later();
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(bars) : quote.promise));
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    const plot = p.el.querySelector(".ch-plot");
    expect(plot.count("pointermove")).toBe(1);
    expect(p.el.count("click")).toBe(1);
    expect(p.run("CH.get(EL).timer")).toBeTruthy();
    p.run("globalThis.ST = CH.get(EL)");
    p.run("chRelease(EL)");
    expect(p.run("CH.has(EL)")).toBe(false);
    expect(p.run("ST.alive")).toBe(false);
    expect(p.run("ST.timer")).toBe(0);
    expect(plot.count("pointermove")).toBe(0);
    expect(plot.count("keydown")).toBe(0);
    expect(p.el.count("click")).toBe(0);
    const picture = p.el.querySelector(".ch-draw").innerHTML;
    quote.resolve({ ok: true, quotes: [{ venue: "okx", symbol: "BTC/USDT", market: { price: 99_999, quoteAt: new Date(start + 1_000).toISOString() } }] });
    await settle();
    expect(p.run("ST.bars.at(-1).c")).toBe(bars[9]!.c);
    expect(p.el.querySelector(".ch-draw").innerHTML).toBe(picture);
    // a tick that was already due finds nothing mounted and asks nothing
    const n = p.asked.length;
    p.run("chTick(ST)");
    await settle();
    expect(p.asked.length).toBe(n);
  });

  it("asks nothing while the page is hidden, and asks again at once when it shows", async () => {
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(hourly(10, start)) : { ok: true, quotes: [] }));
    const doc = p.sandbox.document as Record<string, unknown>;
    const heard: Array<() => void> = [];
    doc.addEventListener = (t: string, fn: () => void) => t === "visibilitychange" && heard.push(fn);
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    // each ask of the live price counted (the page keeps a quote three seconds, so the asks are counted, not the requests)
    p.run("globalThis.QN = 0; globalThis.Q0 = chQuote; chQuote = (s) => (QN++, Q0(s))");
    doc.visibilityState = "hidden";
    p.run("CH.get(EL).quoteWait = 0");
    p.run("clearTimeout(CH.get(EL).timer); chTick(CH.get(EL))");
    await settle();
    expect(p.run("QN")).toBe(0);
    expect(p.run("CH.get(EL).timer")).toBe(0);
    doc.visibilityState = "visible";
    for (const fn of heard) fn();
    await settle();
    expect(p.run("QN")).toBe(1);
    expect(p.run("CH.get(EL).timer")).toBeTruthy();
    p.run("chRelease(EL)");
  });

  it("lays the readout over the plot, out of the flow: the head and the foot are boxes of fixed height, so no word of it moves the plot", async () => {
    // a vm lays nothing out, so the stylesheet itself is read: the readout's box is absolute (its words never size anything), kept while
    // empty; the head and the foot have fixed heights and do not wrap
    const css = readFileSync(`${UI}chart.css`, "utf8");
    const rule = (sel: string) => new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
    expect(rule(".ch-ohlc")).toMatch(/position: absolute;/);
    expect(rule(".ch-ohlc")).toMatch(/pointer-events: none;/);
    expect(rule(".ch-ohlc:empty")).toMatch(/visibility: hidden;/);
    expect(css).not.toMatch(/\.ch-ohlc:empty \{[^}]*display: none/);
    expect(rule(".ch-head")).toMatch(/(^|[ ;])height: \d+px;/);
    expect(rule(".ch-head")).toMatch(/flex-wrap: nowrap;/);
    expect(rule(".ch-foot")).toMatch(/(^|[ ;])height: \d+px;/);
    expect(css).not.toMatch(/\.ch-foot:empty/);

    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(hourly(30)) : new Promise(() => {})));
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    // the frame: the head holds only the bar sizes; the readout is inside the plot, between the picture and the crosshair
    expect(p.el.innerHTML).toMatch(/<div class="ch-head"><div class="ch-ivs"[^>]*>(<button[^>]*>[^<]*<\/button>){3}<\/div><\/div><div class="ch-plot"[^>]*><div class="ch-draw"><\/div><div class="ch-ohlc"><\/div><div class="ch-cross"/);
    await settle();
    // its box as wide as the price pane, set by the layout; the price pane keeps room for it under the top edge
    const L = p.run<{ plotW: number; roomTop: number }>("({ plotW: CH.get(EL).L.plotW, roomTop: CH.get(EL).L.roomTop })");
    expect(p.el.querySelector(".ch-ohlc").style.width).toBe(`${L.plotW - 10}px`);
    expect(L.roomTop).toBeGreaterThan(15);
    const highest = Math.max(...hourly(30).map((b) => b.h));
    expect(p.run<number>(`CH.get(EL).L.sc.y(${highest})`)).toBeGreaterThanOrEqual(L.roomTop - 0.5);
    p.run("chRelease(EL)");
  });

  it("asks nothing while its pane is hidden (the plot has no boxes), and asks at once when the pane shows again", async () => {
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(hourly(10, start)) : { ok: true, quotes: [] }), { ro: true });
    const plot = p.el.querySelector(".ch-plot");
    let boxes: unknown[] = [];
    plot.getClientRects = () => boxes;
    const reads = () => p.asked.filter((x) => x.startsWith("/api/account/candles")).length;
    const quotes = () => p.asked.filter((x) => x.startsWith("/api/account/quotes")).length;
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    // the bars are read once (the picture is ready when the pane shows); no live price is asked
    expect(reads()).toBe(1);
    expect(quotes()).toBe(0);
    // ticks while hidden, the bars two minutes old: nothing asked, the clock kept
    p.run("API.clear(); CH.get(EL).readAt = Date.now() - 120000; clearTimeout(CH.get(EL).timer); chTick(CH.get(EL))");
    await settle();
    expect(reads()).toBe(1);
    expect(quotes()).toBe(0);
    expect(p.run("CH.get(EL).timer")).toBeTruthy();
    // the pane shows: the size observer sees boxes again, and the bars and the live price are asked at once
    boxes = [{}];
    for (const fn of p.observers) fn();
    await settle();
    expect(reads()).toBe(2);
    expect(quotes()).toBe(1);
    expect(p.run("CH.get(EL).timer")).toBeTruthy();
    p.run("chRelease(EL)");
  });

  it("never lays a live price the venue no longer gives, or one older than a read of the bars, over the source's own close", async () => {
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    const bars = hourly(10, start);
    const newer = bars.map((b, k) => (k === 9 ? { ...b, c: 81_999.99, h: Math.max(b.h, 81_999.99) } : b));
    const live = (price: number) => ({ ok: true, quotes: [{ venue: "okx", symbol: "BTC/USDT", market: { price, quoteAt: new Date(start + 1_000).toISOString() } }] });
    let q: unknown = live(81_111.11);
    let src = bars;
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(src) : q));
    p.run('chMount(EL, { venue: "okx", symbol: "BTC/USDT" })');
    await settle();
    const close = () => p.run<number>("CH.get(EL).bars.at(-1).c");
    expect(close()).toBe(81_111.11);
    // the bars read again while that price is fresh: it is laid over them (it is newer than any bar the account keeps)
    src = newer;
    p.run("API.clear(); chRead(CH.get(EL), false)");
    await settle();
    expect(close()).toBe(81_111.11);
    // the venue refuses the price: it is dropped, and the next read of the bars draws the source's own close
    q = { ok: true, quotes: [{ venue: "okx", symbol: "BTC/USDT", refusal: { code: "E_VENUE_REJECTED", message: "no quote just now" } }] };
    p.run("API.clear(); chQuote(CH.get(EL))");
    await settle();
    expect(p.run("CH.get(EL).quote")).toBe(null);
    p.run("API.clear(); chRead(CH.get(EL), false)");
    await settle();
    expect(close()).toBe(81_999.99);
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain(">81,999.99</text></svg>");
    // a price taken a minute before the bars were asked again, and none since: the source's close stands
    q = live(81_500);
    p.run("API.clear(); CH.get(EL).quoteWait = 0; chQuote(CH.get(EL))");
    await settle();
    expect(close()).toBe(81_500);
    p.run("CH.get(EL).quote.readAt = Date.now() - 60000; API.clear(); chRead(CH.get(EL), false)");
    await settle();
    expect(close()).toBe(81_999.99);
    p.run("chRelease(EL)");
  });

  it("reads the bars again once after the last bar's end, then once a minute — never every thirty seconds for a market whose last bar is old", async () => {
    // a clock the test moves (the page's own read cache follows it too)
    const day = Math.floor(Date.now() / DAY) * DAY;
    const old = Array.from({ length: 5 }, (_, k) => ({ t: day - (6 - k) * DAY, o: 100, h: 102, l: 99, c: 101 }));
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(old, { interval: "1d" }) : { ok: true, quotes: [] }));
    p.run("globalThis.NOW = Date.now(); Date.now = () => NOW");
    const reads = () => p.asked.filter((x) => x.startsWith("/api/account/candles")).length;
    p.run('chMount(EL, { venue: "kalshi", symbol: "KXFED:YES", kind: "event", interval: "1d" })');
    await settle();
    // the five-second clock stopped: the test moves time and polls itself
    p.run("clearTimeout(CH.get(EL).timer)");
    expect(reads()).toBe(1);
    // five minutes in thirty-second steps: read at each minute only (five), never at the half minutes
    for (let k = 0; k < 10; k++) {
      p.run("NOW += 30000; chPoll(CH.get(EL))");
      await settle();
    }
    expect(reads()).toBe(6);
    p.run("chRelease(EL)");

    // a bar that ends twenty seconds after the bars were read: read once more thirty seconds after its end, then a minute after that
    const q = page((path) => (path.startsWith("/api/account/candles") ? candles(fives, { interval: "5m" }) : { ok: true, quotes: [] }));
    q.run("globalThis.NOW = Date.now(); Date.now = () => NOW");
    const t0 = q.run<number>("NOW");
    const fives = Array.from({ length: 6 }, (_, k) => ({ t: t0 + 20_000 - (6 - k) * 300_000, o: 10, h: 11, l: 9, c: 10.5 }));
    const qreads = () => q.asked.filter((x) => x.startsWith("/api/account/candles")).length;
    q.run('chMount(EL, { venue: "okx", symbol: "SOL/USDT", interval: "5m" })');
    await settle();
    q.run("clearTimeout(CH.get(EL).timer)");
    const at: number[] = [];
    for (let k = 1; k <= 11; k++) {
      const n = qreads();
      q.run("NOW += 10000; chPoll(CH.get(EL))");
      await settle();
      if (qreads() > n) at.push(k * 10);
    }
    // the bar ended at +20 s: read again at +50 s (its end and thirty seconds), then at +110 s (a minute after that read)
    expect(at).toEqual([50, 110]);
    q.run("chRelease(EL)");
  });

  it("moves a share's daily bar only with a price from its regular session; its hourly bars with any", async () => {
    const d = new Date();
    let T = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13, 30);
    if (T > Date.now()) T -= DAY;
    const days = [{ t: T - DAY, o: 200, h: 205, l: 198, c: 204 }, { t: T, o: 204, h: 206, l: 203, c: 205 }];
    const close = async (session: unknown, quoteAt: number, interval = "1d", bars: unknown[] = days) => {
      const p = page((path) => (path.startsWith("/api/account/candles") ? candles(bars, { interval }) : { ok: true, quotes: [{ venue: "alpaca", symbol: "AAPL", market: { price: 210, quoteAt: new Date(quoteAt).toISOString(), ...(session ? { session } : {}) } }] }));
      p.run(`chMount(EL, { venue: "alpaca", symbol: "AAPL", kind: "stock", quote: "USD", interval: "${interval}" })`);
      await settle();
      const c = p.run<number>("CH.get(EL).bars.at(-1).c");
      p.run("chRelease(EL)");
      return c;
    };
    // in the regular session, an hour after New York's open (in summer and in winter alike): the daily bar takes it
    expect(await close({ open: true, phase: "regular" }, T + HOUR)).toBe(210);
    // after-hours, or a stamp outside 09:30–16:00 New York, or no session said: the source's daily bar as it drew it
    expect(await close({ open: false, phase: "after" }, T + 7 * HOUR)).toBe(205);
    expect(await close({ open: true, phase: "regular" }, T + 9 * HOUR)).toBe(205);
    expect(await close({ open: false, phase: "overnight", extendedHours: true }, T + 14 * HOUR)).toBe(205);
    expect(await close(undefined, T + HOUR)).toBe(205);
    // an hourly bar takes an after-hours price: it is that hour's
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    expect(await close({ open: false, phase: "after" }, start + 1_000, "1h", hourly(3, start))).toBe(210);
  });

  it("keeps the source's half cents on an event contract whose step is a cent, and names the source the bars are from", async () => {
    const start = Math.floor(Date.now() / HOUR) * HOUR;
    const bars = [
      { t: start - HOUR, o: 0.655, h: 0.675, l: 0.655, c: 0.665 },
      { t: start, o: 0.665, h: 0.675, l: 0.665, c: 0.665 },
    ];
    const p = page((path) => (path.startsWith("/api/account/candles") ? candles(bars, { venue: "paper-1", venueName: "Paper account · paper", from: "Polymarket" }) : { ok: true, quotes: [] }));
    p.run('chMount(EL, { venue: "paper-1", symbol: "fed-no-change:Yes", kind: "event", quote: "USD", priceStep: 0.01 })');
    await settle();
    expect(p.run("CH.get(EL).dec")).toBe(1);
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain(">66.5¢</text></svg>");
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toContain('O</span> <span class="ch-v up">66.5¢</span>');
    expect(p.el.querySelector(".ch-ohlc").innerHTML).toContain('H</span> <span class="ch-v up">67.5¢</span>');
    // whose bars: the source the account read for the paper account, not the paper account's own name
    expect(p.el.querySelector(".ch-foot").innerHTML).toMatch(/^Polymarket · 1h bars · prices in cents · /);
    p.run("chRelease(EL)");
  });

  it("asks a refused read of the bars again later and later — two seconds, doubling, at most a minute apart — each a read of its own, and once a minute once bars come", async () => {
    let refuse = true;
    const p = page((path) => (path.startsWith("/api/account/candles") ? (refuse ? { ok: false, refusal: { code: "E_VENUE_NOT_CONNECTED", message: "Momentum is not connected" } } : candles(hourly(30))) : { ok: true, quotes: [] }));
    p.run("globalThis.NOW = Date.now(); Date.now = () => NOW");
    const reads = () => p.asked.filter((x) => x.startsWith("/api/account/candles")).length;
    p.run('chMount(EL, { venue: "paper-momentum", symbol: "BTC/USD" })');
    await settle();
    p.run("clearTimeout(CH.get(EL).timer)");
    expect(reads()).toBe(1);
    expect(p.run<number>("CH.get(EL).wait")).toBe(2_000);
    // one-second steps for three minutes: read at +2, +6, +14, +30, +62, +122 (each wait doubled, at most a minute), then a minute apart —
    // each asked of the account, never the refusal the page kept
    const at: number[] = [];
    for (let k = 1; k <= 180; k++) {
      const n = reads();
      p.run("NOW += 1000; chPoll(CH.get(EL))");
      await settle(2);
      if (reads() > n) at.push(k);
    }
    expect(at).toEqual([2, 6, 14, 30, 62, 122]);
    expect(p.run<number>("CH.get(EL).wait")).toBe(60_000);
    // the source comes back: bars drawn, the wait gone, read once a minute again
    refuse = false;
    for (let k = 0; k < 60; k++) {
      p.run("NOW += 1000; chPoll(CH.get(EL))");
      await settle(2);
    }
    expect(p.run<number>("CH.get(EL).wait")).toBe(0);
    expect(p.el.querySelector(".ch-draw").innerHTML).toContain("<svg");
    p.run("chRelease(EL)");
  });
});
