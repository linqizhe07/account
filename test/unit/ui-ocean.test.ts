/** The ocean (ui/ocean.js), the page's ground, run as the page runs it over a stand-in for the browser: a canvas whose 2D context records
 * what is drawn, animation frames handed out by the test at a display's rate, the stylesheet's colours as the tokens give them. It draws at
 * once, then a frame at the display's rate (a step of the world and a drawing each); under reduced motion it draws one still frame and asks
 * for no frame at all; it stops while the page is hidden; it reads its colours from the tokens and again when the background changes; it
 * reads the calm water's boxes four times a second at most; it never draws a shark behind a word — none under a pane, nothing at all under
 * a word on the open water, read from a stand-in page four times a second and at the next frame after a scroll, and under reduced motion
 * the still frame drawn again when the page moved; its sharks are half see-through; and released, it lets go of everything it listened
 * to. Without a canvas it is a handle that does nothing. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const OCEAN = readFileSync(join(PUBLIC, "ui/ocean.js"), "utf8");

/** Light's and Black's colours for the ocean, as ui/tokens.css writes them */
const LIGHT = { "--oc-ground": "#fcfcfb", "--oc-grid": "rgba(17, 17, 17, 0.05)", "--oc-shadow": "#e7e7e3", "--oc-lit": "#5d5d59", "--oc-ink": "#1b1b1a", "--oc-ink-on": "#f6f6f2", "--oc-sparkle": "#000000", "--oc-eye": "#8b8b86", "--oc-edge": "#85857f", "--oc-fish": "#2a2a27", "--oc-wake": "#8a8a85", "--oc-spark": "#00843d", "--oc-glints": "#e8912d #a855f7 #2cc4c9", "--oc-shark-opacity": "0.5" };
const BLACK = { ...LIGHT, "--oc-ground": "#000000", "--oc-grid": "rgba(255, 255, 255, 0.055)", "--oc-shadow": "#2e2e2e", "--oc-lit": "#cecece", "--oc-fish": "#e6eeff", "--oc-wake": "#6ee6ff" };

interface Rec {
  ops: Record<string, number>;
  fills: string[];
  /** told of each filled rectangle and each glyph copied onto a cell (device pixels), with the alpha it was drawn at */
  seen?: (kind: "rect" | "tile", x: number, y: number, w: number, h: number, alpha: number) => void;
}
/** a 2D context that records how many of each drawing call it was given, and the colour each fillRect was drawn in */
function context(rec: Rec) {
  const count = (op: string) => () => void (rec.ops[op] = (rec.ops[op] ?? 0) + 1);
  const ctx: Record<string, unknown> = { fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1 };
  for (const op of ["setTransform", "fillText", "clearRect", "beginPath", "moveTo", "lineTo", "stroke"]) ctx[op] = count(op);
  ctx.fillRect = (x: number, y: number, w: number, h: number) => {
    rec.ops.fillRect = (rec.ops.fillRect ?? 0) + 1;
    rec.fills.push(String(ctx.fillStyle));
    rec.seen?.("rect", x, y, w, h, Number(ctx.globalAlpha));
  };
  // a glyph is copied from the atlas onto its cell (nine arguments); the ground is copied whole (three)
  ctx.drawImage = (...a: number[]) => {
    rec.ops.drawImage = (rec.ops.drawImage ?? 0) + 1;
    if (a.length === 9) rec.seen?.("tile", a[5] ?? 0, a[6] ?? 0, a[7] ?? 0, a[8] ?? 0, Number(ctx.globalAlpha));
  };
  return ctx;
}

/** a stand-in page for the clear water: elements with the computed style the ocean reads and a box, text nodes with the boxes of their
 * lines (what a Range gives) */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Fake {
  nodeType: number;
  nextSibling: Fake | null;
  firstChild?: Fake | null;
  box?: Box;
  lines?: Box[];
  data?: string;
  cs?: Record<string, string>;
  reads?: number;
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
}
const STYLE = { display: "block", opacity: "1", visibility: "visible", backgroundColor: "rgba(0, 0, 0, 0)", backdropFilter: "none", overflowX: "visible", overflowY: "visible" };
const rectOf = (b: Box) => ({ ...b, right: b.left + b.width, bottom: b.top + b.height, x: b.left, y: b.top });
function el(box: Box, style: Partial<typeof STYLE>, kids: Fake[] = []): Fake {
  kids.forEach((k, i) => (k.nextSibling = kids[i + 1] ?? null));
  const e: Fake & { tagName: string; getBoundingClientRect: () => ReturnType<typeof rectOf> } = { nodeType: 1, tagName: "DIV", nextSibling: null, firstChild: kids[0] ?? null, box, cs: { ...STYLE, ...style }, reads: 0, scrollWidth: box.width, clientWidth: box.width, scrollHeight: box.height, clientHeight: box.height, getBoundingClientRect: () => rectOf(e.box as Box) };
  return e;
}
const text = (data: string, lines: Box[]): Fake => ({ nodeType: 3, data, lines, nextSibling: null });
/** a page as the ocean sees it at 1440 × 900: a glass pane down the left 600 px (95% white), and on the open water to its right a block
 * of fifteen lines of words, 700 to 1400 across and 300 to 600 down */
function page() {
  const words = text("Words on the open water", Array.from({ length: 15 }, (_, k) => ({ left: 700, top: 300 + 20 * k, width: 700, height: 20 })));
  const prose = el({ left: 700, top: 300, width: 700, height: 300 }, {}, [words]);
  const pane = el({ left: 0, top: 0, width: 600, height: 900 }, { backgroundColor: "rgba(255, 255, 255, 0.95)", backdropFilter: "blur(20px) saturate(1.1)" }, [text("On the glass", [{ left: 24, top: 24, width: 120, height: 18 }])]);
  return { body: el({ left: 0, top: 0, width: 1440, height: 900 }, {}, [pane, prose]), pane, prose, words };
}
/** a seeded Math.random (mulberry32), so two oceans swim the same way */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the ocean in a stand-in browser: `still` as the owner's motion setting, the tokens as the stylesheet's, a 1440 × 900 canvas at 2× */
function ocean(opts: { still?: boolean; tokens?: Record<string, string>; calm?: Array<{ left: number; top: number; width: number; height: number }>; body?: Fake; seed?: number } = {}) {
  const page: Rec = { ops: {}, fills: [] };
  const ground: Rec = { ops: {}, fills: [] };
  const made: Rec[] = [];
  let frames: Array<(t: number) => void> = [];
  const listeners: Array<{ on: string; type: string; added: boolean }> = [];
  const heard: Record<string, Array<(e?: unknown) => void>> = {};
  const target = (on: string) => ({
    addEventListener(type: string, fn: (e?: unknown) => void) {
      listeners.push({ on, type, added: true });
      (heard[`${on}:${type}`] ||= []).push(fn);
    },
    removeEventListener(type: string) {
      listeners.push({ on, type, added: false });
    },
  });
  let tokens = { ...(opts.tokens ?? LIGHT) };
  const motion = { matches: !!opts.still, ...target("motion") };
  let resized: (() => void) | null = null;
  let recoloured: (() => void) | null = null;
  let calmReads = 0;
  const intervals: Array<() => void> = [];
  const canvas = { width: 0, height: 0, getContext: () => context(page), getBoundingClientRect: () => ({ width: 1440, height: 900, left: 0, top: 0 }) };
  const documentElement = { ...target("html") };
  const sandbox: Record<string, unknown> = {
    document: {
      ...target("document"),
      hidden: false,
      documentElement,
      createElement: () => {
        const rec: Rec = made.length === 0 ? ground : { ops: {}, fills: [] };
        made.push(rec);
        return { width: 0, height: 0, getContext: () => context(rec) };
      },
      getElementById: (id: string) => (id === "ocean" ? canvas : null),
      querySelectorAll: (sel: string) => {
        if (sel !== "[data-ocean-calm]") return [];
        calmReads++;
        return (opts.calm ?? []).map((b) => ({ getBoundingClientRect: () => ({ ...b, right: b.left + b.width, bottom: b.top + b.height }) }));
      },
      fonts: { load: () => Promise.resolve() },
      body: opts.body,
      createRange: opts.body
        ? () => {
            let node: Fake | null = null;
            return { selectNodeContents: (n: Fake) => (node = n), getClientRects: () => (node?.lines ?? []).map(rectOf) };
          }
        : undefined,
    },
    getComputedStyle: (e?: Fake) => {
      if (e && e.cs) {
        e.reads = (e.reads ?? 0) + 1;
        return e.cs;
      }
      return { getPropertyValue: (name: string) => tokens[name as keyof typeof tokens] ?? "" };
    },
    setInterval: (fn: () => void) => intervals.push(fn),
    clearInterval: () => void intervals.splice(0),
    requestAnimationFrame: (fn: (t: number) => void) => (frames.push(fn), frames.length),
    cancelAnimationFrame: () => {
      frames = [];
    },
    ResizeObserver: class {
      constructor(fn: () => void) {
        resized = fn;
      }
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      constructor(fn: () => void) {
        recoloured = fn;
      }
      observe() {}
      disconnect() {}
    },
    performance: { now: () => performance.now() },
    devicePixelRatio: 2,
    STILL: motion,
    still: () => motion.matches,
    console,
    Math: opts.seed === undefined ? Math : Object.assign(Object.create(Math), { random: seeded(opts.seed) }),
    JSON,
    Promise,
  };
  Object.assign(sandbox, target("window"));
  const ctx = createContext(sandbox);
  sandbox.globalThis = runInContext("globalThis", ctx);
  new Script(OCEAN, { filename: "ui/ocean.js" }).runInContext(ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  let clock = 1000;
  /** n frames at a display's rate (60 a second), as the browser hands them out */
  const tick = (n: number, ms = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      const next = frames.shift();
      if (!next) return i;
      clock += ms;
      next(clock);
    }
    return n;
  };
  return {
    run,
    tick,
    page,
    ground,
    listeners,
    pending: () => frames.length,
    stats: () => run<Record<string, number | boolean | string[]>>("OCEAN.stats()"),
    fire: (on: string, type: string, e?: unknown) => (heard[`${on}:${type}`] ?? []).forEach((fn) => fn(e)),
    hide: (hidden: boolean) => ((sandbox.document as { hidden: boolean }).hidden = hidden),
    setMotion: (still: boolean) => (motion.matches = still),
    setTokens: (t: Record<string, string>) => (tokens = { ...t }),
    resize: () => resized && resized(),
    recolour: () => recoloured && recoloured(),
    calmReads: () => calmReads,
    /** the timers it set (under reduced motion, the clear water's twice-a-second read), run once each */
    runIntervals: () => intervals.slice().forEach((fn) => fn()),
    intervals: () => intervals.length,
  };
}

describe("the ocean, the page's ground", () => {
  it("draws at once as the page loads, then a frame at the display's rate — a step of the world and a drawing each", () => {
    const o = ocean();
    // the first frame is drawn before any animation frame: the ground (copied), the sharks' blocks
    expect(o.page.ops.drawImage).toBeGreaterThan(0);
    expect(o.pending()).toBe(1);
    const drawn = o.page.ops.drawImage ?? 0;
    expect(o.tick(240)).toBe(240);
    expect(o.page.ops.drawImage).toBeGreaterThan(drawn + 240);
    const s = o.stats();
    expect(s.fps).toBe(60);
    expect(s.still).toBe(false);
    expect(s.sharks).toBe(4);
    expect(s.fish).toBe(282);
    // the grid's cells: a 170th of 1440 is 8 px, half again as tall, at 2× (180 × 75)
    expect(s.cells).toBe(13500);
    // this visit's kinds: four, none twice, each one the ocean knows (a whale shark, when there is one, is the biggest: drawn last)
    const kinds = s.kinds as unknown as string[];
    expect(kinds).toHaveLength(4);
    expect(new Set(kinds).size).toBe(4);
    for (const k of kinds) expect(o.run<string[]>("OC_KINDS"), k).toContain(k);
    if (kinds.includes("whale")) expect(kinds.at(-1)).toBe("whale");
    // one step and one drawing measured apiece
    expect(Number(s.stepMs)).toBeGreaterThan(0);
    expect(Number(s.drawMs)).toBeGreaterThan(0);
  });

  it("under reduced motion draws one still frame and asks for no frame at all; turned off, it starts to move", () => {
    const o = ocean({ still: true });
    expect(o.page.ops.drawImage).toBeGreaterThan(0);
    expect(o.pending()).toBe(0);
    expect(o.stats().still).toBe(true);
    o.setMotion(false);
    o.fire("motion", "change");
    expect(o.pending()).toBe(1);
    // and back on: the loop stops at once, the frame drawn still
    o.setMotion(true);
    o.fire("motion", "change");
    expect(o.pending()).toBe(0);
  });

  it("stops while the page is hidden and goes on when it shows again", () => {
    const o = ocean();
    o.tick(10);
    o.hide(true);
    o.fire("document", "visibilitychange");
    expect(o.pending()).toBe(0);
    o.hide(false);
    o.fire("document", "visibilitychange");
    expect(o.pending()).toBe(1);
  });

  it("draws its ground in the background's own colours, and again when the background changes (Light, Black, the trading area)", () => {
    const o = ocean({ tokens: LIGHT });
    expect(o.ground.fills[0]).toBe("rgba(252,252,251,1)");
    o.setTokens(BLACK);
    o.recolour();
    expect(o.ground.fills.at(-1)).toBe("rgba(0,0,0,1)");
    // the same colours again change nothing
    const n = o.ground.fills.length;
    o.recolour();
    expect(o.ground.fills.length).toBe(n);
  });

  it("reads the calm water's boxes four times a second at most, never every frame", () => {
    const o = ocean({ calm: [{ left: 400, top: 120, width: 800, height: 300 }] });
    o.tick(120);
    // two seconds of frames: about eight reads, not a hundred and twenty
    expect(o.calmReads()).toBeGreaterThanOrEqual(7);
    expect(o.calmReads()).toBeLessThanOrEqual(9);
  });

  it("released, stops and lets go of every listener it added", () => {
    const o = ocean();
    o.tick(5);
    o.run("OCEAN.release()");
    expect(o.pending()).toBe(0);
    const added = o.listeners.filter((l) => l.added).map((l) => `${l.on}:${l.type}`).sort();
    const removed = o.listeners.filter((l) => !l.added).map((l) => `${l.on}:${l.type}`).sort();
    expect(added.length).toBeGreaterThan(0);
    expect(removed).toEqual(added);
  });

  it("never draws a shark behind a word: under a pane (filled at least half way, or frosted) a shark swims on out of sight, under the words on the open water nothing is drawn at all — the same sharks, with no page over them, swim through both", () => {
    // device pixels at 2×: a cell is 16 × 24, a shark's block 14 × 22 (the gap a pixel each side), a fish's dash 8 × 2, a glyph a cell
    const underPane = (x: number) => x < 75 * 16;
    const underWords = (x: number, y: number) => x >= 87 * 16 && x < 176 * 16 && y >= 24 * 24 && y < 51 * 24;
    const block = (w: number, h: number) => w === 14 && h === 22;
    // no page over the water: within two seconds its sharks cross both places
    const free = ocean({ seed: 7 });
    const crossed = { pane: 0, words: 0 };
    free.page.seen = (kind, x, y, w, h) => {
      if (kind !== "rect" || !block(w, h)) return;
      if (underPane(x)) crossed.pane++;
      if (underWords(x, y)) crossed.words++;
    };
    free.tick(120);
    expect(crossed.pane).toBeGreaterThan(0);
    expect(crossed.words).toBeGreaterThan(0);
    // the same ocean (the same seed: drawing never moves the world) under the page
    const o = ocean({ seed: 7, body: page().body });
    const drawn = { pane: 0, words: 0, open: 0 };
    const alphas = { shark: new Set<number>(), fish: new Set<number>() };
    o.page.seen = (kind, x, y, w, h, alpha) => {
      if (underWords(x + w / 2, y + h / 2)) drawn.words++;
      if (kind !== "rect") return;
      if (block(w, h)) {
        if (underPane(x)) drawn.pane++;
        else drawn.open++;
        alphas.shark.add(alpha);
      } else if (h === 2) alphas.fish.add(alpha);
    };
    o.tick(120);
    expect(drawn.pane).toBe(0);
    expect(drawn.words).toBe(0);
    expect(drawn.open).toBeGreaterThan(0);
    // the sharks half see-through, as the tokens say; the fish as they always were
    expect([...alphas.shark]).toEqual([0.5]);
    expect([...alphas.fish]).toEqual([1]);
    // the clear water's cells: the pane's, whose middle it covers (75 × 75), and the words', every cell they touch with 4 px round (89 × 27)
    expect(o.run("OCEAN.stats().clear")).toEqual({ panes: 75 * 75, words: 89 * 27 });
    expect(Number(o.stats().clearMs)).toBeGreaterThan(0);
  });

  it("keeps clear the words that spill out of a pane onto the open water, and walks no pane that keeps its words inside", () => {
    // a card 400 wide whose price label runs 40 px past its right edge (its overflow shown), and a card that keeps everything inside
    const spill = text("$144.35", [{ left: 380, top: 100, width: 60, height: 16 }]);
    const card = el({ left: 0, top: 0, width: 400, height: 300 }, { backgroundColor: "rgba(255, 255, 255, 0.95)" }, [el({ left: 380, top: 100, width: 60, height: 16 }, {}, [spill])]);
    card.scrollWidth = 440;
    const tidy = el({ left: 0, top: 400, width: 400, height: 300 }, { backgroundColor: "rgba(255, 255, 255, 0.95)" }, [el({ left: 20, top: 420, width: 100, height: 16 }, {}, [text("Inside", [{ left: 20, top: 420, width: 100, height: 16 }])])]);
    const kept = el({ left: 0, top: 0, width: 1440, height: 900 }, {}, [card, tidy]);
    const o = ocean({ body: kept });
    // the cards' cells (50 × 25 each), and the label's with 4 px round it — 376 to 444 across (47 to 55) and 97 to 119 down (8 and 9),
    // 9 × 2, three columns of them still on the card
    expect(o.run("OCEAN.stats().clear")).toEqual({ panes: 50 * 25 * 2 - 3 * 2, words: 9 * 2 });
    // the tidy card's insides are never read
    expect(tidy.reads).toBe(1);
    expect((tidy.firstChild as Fake).reads ?? 0).toBe(0);
  });

  it("reads the clear water from the page four times a second, and again at the next frame once the page scrolls or changes its page — never every frame", () => {
    const { body, pane } = page();
    const o = ocean({ body });
    // read for the first frame, drawn as the page loads
    expect(pane.reads).toBe(1);
    o.tick(120);
    // two seconds of frames: about eight reads, not a hundred and twenty
    expect(pane.reads! - 1).toBeGreaterThanOrEqual(7);
    expect(pane.reads! - 1).toBeLessThanOrEqual(9);
    // a scroll (however many events) or a new page: one read, at the next frame drawn (past its budget the ocean draws every second
    // frame, so that may be the second)
    const next = () => o.tick(o.stats().lite ? 2 : 1);
    let before = pane.reads!;
    o.fire("document", "scroll");
    o.fire("document", "scroll");
    next();
    expect(pane.reads! - before).toBe(1);
    before = pane.reads!;
    o.fire("window", "hashchange");
    next();
    expect(pane.reads! - before).toBe(1);
  });

  it("under reduced motion draws the still frame again when the page has moved over it — twice a second, and at the next frame after a scroll — and not while nothing changed", () => {
    const { body, prose, words } = page();
    const o = ocean({ still: true, body });
    expect(o.intervals()).toBe(1);
    const drawn = o.page.ops.drawImage ?? 0;
    // nothing moved: read again, nothing drawn
    o.runIntervals();
    expect(o.page.ops.drawImage ?? 0).toBe(drawn);
    expect(o.run("OCEAN.stats().clear")).toEqual({ panes: 75 * 75, words: 89 * 27 });
    // the words scroll up 200 px: at the next frame the water is clear where they are now, and the still frame is drawn again
    prose.box = { ...prose.box!, top: 100 };
    words.lines = words.lines!.map((l) => ({ ...l, top: l.top - 200 }));
    o.fire("document", "scroll");
    expect(o.pending()).toBe(1);
    o.tick(1);
    expect(o.page.ops.drawImage ?? 0).toBeGreaterThan(drawn);
    expect(o.run("OCEAN.stats().clear")).toEqual({ panes: 75 * 75, words: 89 * 26 });
    expect(o.pending()).toBe(0);
    const again = o.page.ops.drawImage ?? 0;
    o.runIntervals();
    expect(o.page.ops.drawImage ?? 0).toBe(again);
    // motion turned on: the timer stops and the loop starts
    o.setMotion(false);
    o.fire("motion", "change");
    expect(o.intervals()).toBe(0);
    expect(o.pending()).toBe(1);
  });

  it("is a handle that does nothing where there is no canvas to draw on", () => {
    const o = ocean();
    expect(o.run("ocMount(null).stats()")).toBeNull();
    expect(o.run("ocMount({}).stats()")).toBeNull();
    expect(o.run("ocMount({ getContext: () => null }).stats()")).toBeNull();
  });
  it("swims the paper accounts' sharks: bonus(n) brings them in from an edge one at a time, kinds not in the water first, twelve at most; fewer swim out one at a time, one at least; under reduced motion the still frame is drawn with them at once", () => {
    // every kind but the whale shark in before any comes twice
    const r = ocean().run<string[]>("ocRoster(12)");
    expect(r).toHaveLength(12);
    expect(new Set(r.filter((k) => k !== "whale").slice(0, 8)).size).toBe(8);
    const o = ocean({ seed: 11 });
    expect(o.stats().sharks).toBe(4);
    // three more: one joins at the next step, then one every few seconds (four steps of the world a frame here)
    expect(o.run("OCEAN.bonus(3)")).toBe(7);
    o.tick(1);
    expect(o.stats().sharks).toBe(5);
    o.tick(120, 1000 / 15);
    expect(o.stats()).toMatchObject({ sharks: 7, bonus: 3, wanted: 7 });
    expect(new Set(o.stats().kinds as unknown as string[]).size).toBe(7);
    // fewer: each leaving one turns for an edge and is gone once past it, the next a few seconds after
    expect(o.run("OCEAN.bonus(1)")).toBe(5);
    let t = 0;
    while (Number(o.stats().sharks) > 5 && t < 600) t += o.tick(10, 1000 / 15);
    expect(o.stats().sharks).toBe(5);
    expect(t).toBeGreaterThan(30);
    // twelve at most and one at least, whatever is asked
    expect(o.run("[OCEAN.bonus(40), OCEAN.bonus(-40), OCEAN.bonus(Number.NaN), OCEAN.bonus(0)]")).toEqual([12, 1, 4, 4]);
    // under reduced motion: the still frame drawn again with them, at once
    const s = ocean({ still: true, seed: 5 });
    const drawn = s.page.ops.drawImage ?? 0;
    expect(s.run("OCEAN.bonus(2)")).toBe(6);
    expect(s.stats().sharks).toBe(6);
    expect(s.page.ops.drawImage).toBeGreaterThan(drawn);
    // asked the same again, nothing is drawn for it
    const again = s.page.ops.drawImage ?? 0;
    s.run("OCEAN.bonus(2)");
    expect(s.page.ops.drawImage).toBe(again);
  });
});
