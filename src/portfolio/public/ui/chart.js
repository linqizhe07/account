/* THE CHART — one market's price history as candles, the way a trading screen draws it: the bars its source keeps (GET /api/account/candles:
   a connected venue's own, or a public source's without a key), a volume pane under them where the bars carry volume, a price axis on the
   right and a time axis at the foot, a dashed line at the last price with its value in a tag on the axis, and a crosshair that reads any
   bar. One SVG drawn as one string, no library.

   NOTHING MADE UP. Every bar is the source's own: none is drawn between two it gave (a market closed overnight is simply the next bar), and
   a live price never makes one. The live price (GET /api/account/quotes, every five seconds while the chart is mounted, its pane is
   showing and the page is) moves the LAST bar only — its close, and its high or its low where the price passes them — and only while the
   price's own time (the quote's stamp where its source stamps one, else the moment it was read) is inside that bar's interval. A share's
   daily bar is its regular session's, so only a price from the regular session moves it (never an after-hours, overnight or pre-market
   one). A live price is laid over the bars only while it is fresh: one the venue then refused, or one read before a newer read of the bars,
   never stands in for the source's own close. Once the clock passes the last bar's end the bars are read again, and the source's next bar
   comes with them. A source that keeps no history says so in its own words in the panel, and nothing else is drawn there: no axes, no grid.

   Mounting (ui/terminal.js mounts it in the Trade pane's left panel)
     chMount(el, { venue, symbol, kind, quote, interval, priceStep, onInterval })
                    the chart drawn into el (its own frame inside: el keeps its classes): the bar sizes 5m · 1h · 1D (the account's
                    CANDLE_INTERVALS, live/trade.ts) over the plot, the plot with the OHLC readout laid over its top-left corner (as a trading
                    screen lays it: the readout's words never change the plot's size), a quiet line under it saying whose bars they are.
                    `venue` a venue id on the account or a public source's id (Markets names both; a paper account's id passes through to
                    its market's public source), `symbol` the market as that venue names it, `kind` the Market's kind ("event": prices in
                    cents), `quote` what it is priced in ("USDT"; a Market may be passed instead: its quote and priceStep are read),
                    `interval` "5m" | "1h" | "1d" (1h when not one of them), `priceStep` the market's own price step (its figures carry at
                    least that many decimals, and more where the bars are finer: a half cent stays a half cent), `onInterval(iv)` called
                    when the owner picks another bar size, so the page can keep the choice. Mounting again on the same el — another market,
                    another interval — releases the first: an answer meant for it is never drawn
     chRelease(el)  the polling, the listeners and the size observer stopped; what is drawn stays until the page draws over it
     chInterval(el) the bar size the chart on el shows ("" when none is mounted there)
   Pure, and what the tests read
     chNiceTicks(lo, hi, n) · chScale(bars, w, h, volH, top) · chTimeLabels(bars, interval, zone) · chReadout(bar, prevClose, fmt)
     · chReadoutLines(wide, width, small) · chFmt(dec, ev) · chDecimals(bars, ev, step) · chApplyQuote(bars, quote, intervalMs)
     · chRegular(session, at) · chWhen(t, interval, zone)

   Drawing. The plot is three layers in one box: the picture (.ch-draw: candles, volume, grid, axes, the last price; painted whole through
   paint(), so a redraw writes only what changed), the readout over its top-left corner (.ch-ohlc, laid over the plot: its box is out of
   the flow, so however long its words are, nothing around it moves; the price pane keeps room for it under the top edge) and the crosshair
   over both (.ch-cross: two lines and two tags, drawn once per size). A pointer moving over the plot only moves the crosshair — a
   transform, its tags' places and words — and writes the readout; it never draws the candles again, and nothing it writes changes a box's
   size. The arrow keys move it bar by bar when the plot has the focus (Home · End · Escape). The picture is drawn again when its box
   changes size (ResizeObserver; the window's resize where there is none), when the bars are read again, and when a live price moves the
   last bar. The head (the bar sizes) and the foot (whose bars) are boxes of fixed height, so the plot's height is set once by the panel.
   Colours only from ui/tokens.css (chart.css), so Cream and Black alike. */

/* the bar sizes the account keeps, as the buttons say them, and each one's length */
const CH_INTERVALS = [["5m", "5m"], ["1h", "1h"], ["1d", "1D"]];
const CH_MS = { "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 };
/* the live price asked every five seconds; the bars read again once a minute (the account keeps them a minute), and once more thirty
   seconds after the last bar's interval ended (the page keeps a read thirty seconds) where the bars in hand were read before then, so the
   source's next bar comes — once per bar's end: a market whose last bar ended long ago (a market closed since yesterday, a source whose
   bars are late) is read once a minute, never every thirty seconds. A live price the account refused is asked again a minute later. A
   price is asked for only while the last bar can still take it: until twenty minutes after its end (a delayed source's stamp may be that
   late) — a market closed since yesterday is not asked every five seconds for nothing. A live price is laid over a later read of the bars
   only while it is fresh: read within the last two asks, or after that read was asked */
const CH_POLL_MS = 5_000;
const CH_READ_MS = 60_000;
/* a read of the bars the account refused, with no bars standing (a venue not connected, a source that keeps no history): asked again two
   seconds later, then twice as long each refusal more, at most a minute apart (the minute the bars are read on anyway) — each a read of
   its own, never the refusal the page kept — so a source that comes back is drawn soon, and one that does not is not asked every few
   seconds for ever. Bars read reset it */
const CH_BACKOFF_MS = 2_000;
const CH_BACKOFF_MAX_MS = 60_000;
const CH_ENDED_MS = 30_000;
const CH_QUOTE_WAIT_MS = 60_000;
const CH_LATE_MS = 20 * 60_000;
const CH_FRESH_MS = 2 * CH_POLL_MS;
/* the picture's measures, in CSS pixels: a bar's slot at least 5 wide (the newest bars that fit are shown) and at most 16 (a short history
   sits at the right, as a trading screen puts it), a little room right of the newest bar, the time axis's height, the gap over the volume
   pane, the least room between two time labels */
const CH_MIN_SLOT = 5;
const CH_MAX_SLOT = 16;
const CH_PAD_R = 8;
const CH_TIME_H = 22;
const CH_VOL_GAP = 6;
const CH_LABEL_GAP = 56;
/* the readout laid over the plot: its line's height, a character's width and the gap between two units at its size — 12px, and 11px in a
   chart at most 480 pixels wide (chart.css's container query) — each a little wider than measured (6.4 and 5.85 pixels a character), so a
   little more room is kept than the words take; and its inset from the plot's corner */
const CH_LINE_H = 15;
const CH_CHAR_W = 6.6;
const CH_CHAR_W_SMALL = 6;
const CH_GAP = 8;
const CH_GAP_SMALL = 6;
const CH_SMALL_W = 480;
const CH_RO_TOP = 4;
const CH_RO_LEFT = 6;
/* the viewer's own clock: the time axis and the crosshair say times as the viewer reads them (a daily bar says the day it stands for) */
const CH_ZONE = (typeof YOUR_ZONE === "string" && YOUR_ZONE) || "UTC";
/* the charts mounted, by their element */
const CH = new Map();

// ---- pure: numbers ----------------------------------------------------------------------------------------------------------------

/** how many decimals a number is written with (0.25 → 2, 83134 → 0, 1e-7 → 7), read from its shortest form; at most 12 figures */
function chDecimalsOf(v) {
  if (!Number.isFinite(v)) return 0;
  const s = String(Number(Math.abs(v).toPrecision(12)));
  const e = /e-(\d+)$/.exec(s);
  if (e) return Number(e[1]) + (s.split("e")[0].split(".")[1] || "").length;
  return (s.split(".")[1] || "").length;
}

/** the decimals a market's figures carry: the more of two — its own price step's where it is known (an event contract's step is in
 * dollars, its figures in cents), and as many as its bars are written with, held to five significant figures of the largest (BTC at
 * 83,134.51 → 2 at the most, never fewer than two below that rule: a share's cents stay) and to a tenth of a cent for an event contract
 * (the page's own cents()). So a step of a cent never rounds a source's half cents away: Polymarket's 66.5¢ stays 66.5¢, not 67¢ */
function chDecimals(bars, ev, step) {
  let d = 0;
  let top = 0;
  for (const b of bars || []) {
    for (const v of [b.o, b.h, b.l, b.c]) {
      if (!Number.isFinite(v)) continue;
      d = Math.max(d, chDecimalsOf(v));
      top = Math.max(top, Math.abs(v));
    }
  }
  const sig = top > 0 ? Math.max(0, 4 - Math.floor(Math.log10(top))) : 2;
  const own = ev ? Math.min(d, 1) : Math.min(d, Math.max(sig, 2), 8);
  const st = Number(step);
  const bySt = Number.isFinite(st) && st > 0 ? Math.min(8, chDecimalsOf(ev ? st * 100 : st)) : 0;
  return Math.max(bySt, own);
}

/* one number formatter for each count of decimals, kept (making one costs more than using it, and the axis writes every bar's figures) */
const CH_NF = new Map();
function chNf(d) {
  let f = CH_NF.get(d);
  if (!f) CH_NF.set(d, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })));
  return f;
}

/** a price as the chart writes it: `dec` decimals with the thousands grouped, an event contract's in cents (62.5¢); a change (`delta`) is
 * written as its size, with at least one decimal (the readout puts its sign before it) */
function chFmt(dec, ev) {
  const d0 = Math.max(0, Math.min(12, Number(dec) || 0));
  return (n, delta = false) => {
    if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    const d = delta ? Math.max(d0, 1) : d0;
    const s = chNf(d).format(Math.abs(v));
    return `${!delta && v < 0 && Number(s.replace(/,/g, "")) !== 0 ? "−" : ""}${s}${ev ? "¢" : ""}`;
  };
}

/** a volume, short: 950 · 12.3K · 4.56M · 1.2B */
function chCompact(v) {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  const at = (n, unit) => `${Number(n.toPrecision(3))}${unit}`;
  return a >= 1e9 ? at(v / 1e9, "B") : a >= 1e6 ? at(v / 1e6, "M") : a >= 1e3 ? at(v / 1e3, "K") : a >= 1 ? String(Number(v.toFixed(2))) : String(Number(v.toPrecision(3)));
}

/** FIVE TO SEVEN ROUND TICKS for the range lo–hi: a step of 1, 2, 2.5 or 5 times a power of ten, the one that puts five to seven ticks
 * inside the range (the count nearest `n` among those; the larger step when two come as near). Some ranges have no such step — 4 ticks at
 * one step, 8 at the next (100 and 50 over 82,941–83,359) — and then the larger step is taken and the nearest round prices just outside the
 * range are added, one at a time on the nearer side, until there are five: the caller's scale opens to hold them (chScale). Each tick as the
 * step writes it (no float tails). An empty range is opened by a hundredth of its value either side; a range that is not one gives none */
function chNiceTicks(lo, hi, n = 6) {
  let a = Number(lo);
  let b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  if (a > b) [a, b] = [b, a];
  if (a === b) {
    const d = Math.abs(a) * 0.01 || 1;
    a -= d;
    b += d;
  }
  const want = Math.max(2, Math.round(Number(n) || 6));
  const p = Math.floor(Math.log10((b - a) / (want - 1)));
  let best = null;
  for (const e of [p - 1, p, p + 1]) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** e;
      const count = Math.floor(b / step + 1e-9) - Math.ceil(a / step - 1e-9) + 1;
      // five to seven inside first; else fewer (made five below) before more
      const score = count >= 5 && count <= 7 ? Math.abs(count - want) : count < 5 ? 100 + (5 - count) : 200 + (count - 7);
      if (!best || score < best.score || (score === best.score && step > best.step)) best = { score, step, m, e };
    }
  }
  if (!best) return [];
  const { step } = best;
  const dec = Math.min(20, Math.max(0, -best.e + (best.m === 2.5 ? 1 : 0)));
  let first = Math.ceil(a / step - 1e-9);
  let last = Math.floor(b / step + 1e-9);
  while (last - first + 1 < 5) {
    if (a - (first - 1) * step <= (last + 1) * step - b) first--;
    else last++;
  }
  return Array.from({ length: last - first + 1 }, (_, k) => Number(((first + k) * step).toFixed(dec)));
}

/** THE SCALES of the picture, for `bars` (oldest first) in a plot `w` wide and `h` high whose lowest `volH` pixels are the volume pane
 * (0: no volume pane). The newest bars that fit at CH_MIN_SLOT each are shown — `from` to `to` (exclusive) — each in a slot of `slot`
 * pixels (at most CH_MAX_SLOT, so a short history sits at the right), its body `bw` wide (odd, so the 1px wick is its middle). The price
 * range is the shown bars' lowest low to highest high, opened 8% either side — and further where five round ticks needed one just outside
 * it (chNiceTicks), to a quarter step past it; `ticks` are those; `bottom` is the price pane's foot (above the volume pane and its gap).
 * `top` pixels under the pane's top edge are kept clear of the bars (the readout is laid over them): where the highest high would sit
 * higher, the range opens upward until it sits there (at most two fifths of the pane). Returns the functions the drawing and the crosshair
 * share: cx(i) a bar's middle column, at(x) the bar under a column, y(p) a price's row, price(y) the price at a row, vh(v) a volume's
 * height in its own pane (the highest shown is the pane's height less two) */
function chScale(bars, w, h, volH = 0, top = 0) {
  const list = bars || [];
  const len = list.length;
  const usable = Math.max(1, w - CH_PAD_R);
  const n = Math.min(len, Math.max(1, Math.floor(usable / CH_MIN_SLOT)));
  const from = len - n;
  const to = len;
  const slot = n ? Math.min(CH_MAX_SLOT, usable / n) : CH_MAX_SLOT;
  const x0 = usable - n * slot;
  const bw0 = Math.max(1, Math.floor(slot * 0.7));
  const bw = bw0 % 2 === 0 ? bw0 - 1 : bw0;
  const cx = (i) => Math.floor(x0 + (i - from + 0.5) * slot);
  const at = (x) => Math.min(to - 1, Math.max(from, from + Math.floor((x - x0) / slot)));
  let lo = Infinity;
  let hi = -Infinity;
  let vmax = 0;
  for (let i = from; i < to; i++) {
    const b = list[i];
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
    if (Number.isFinite(b.v) && b.v > vmax) vmax = b.v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  const high = hi;
  if (hi === lo) {
    const d = Math.abs(hi) * 0.01 || 1;
    lo -= d;
    hi += d;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  // where five round ticks needed one just outside the range, the range opens to it and a quarter step more (its label is not on the edge)
  const ticks = chNiceTicks(lo, hi, 6);
  const st = ticks.length > 1 ? ticks[1] - ticks[0] : 0;
  if (ticks.length && ticks[0] < lo) lo = ticks[0] - st / 4;
  if (ticks.length && ticks[ticks.length - 1] > hi) hi = ticks[ticks.length - 1] + st / 4;
  const vH = Math.max(0, volH || 0);
  const bottom = Math.max(1, h - (vH > 0 ? vH + CH_VOL_GAP : 0));
  // the room kept for the readout: the highest high no higher than `top` pixels under the edge (the range opened upward to it)
  const r = Math.min(0.4, Math.max(0, Number(top) || 0) / bottom);
  if (r > 0 && ((hi - high) / (hi - lo)) * bottom < r * bottom) hi = (high - lo * r) / (1 - r);
  const y = (p) => ((hi - p) / (hi - lo)) * bottom;
  const price = (yy) => hi - (yy / bottom) * (hi - lo);
  const vh = (v) => (vmax > 0 && vH > 0 && Number.isFinite(v) && v > 0 ? Math.max(1, (v / vmax) * (vH - 2)) : 0);
  return { from, to, n, slot, bw, x0, cx, at, lo, hi, bottom, y, price, volTop: h - vH, volH: vH, vmax, vh, ticks };
}

// ---- pure: times ------------------------------------------------------------------------------------------------------------------

/* an instant's parts on a clock: year, short month, day, weekday, hour and minute (00–23), and its day as a key. One formatter a zone, kept */
const CH_CLOCKS = new Map();
function chParts(t, zone) {
  let f = CH_CLOCKS.get(zone);
  if (!f) {
    const opts = { year: "numeric", month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    try {
      f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: zone });
    } catch {
      f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" });
    }
    CH_CLOCKS.set(zone, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  const hh = p.hour === "24" ? "00" : p.hour;
  return { y: p.year, mo: p.month, d: String(Number(p.day)), wd: p.weekday, hh, mm: p.minute, day: `${p.year}-${p.month}-${p.day}` };
}
/* THE DAY A DAILY BAR STANDS FOR: the date where its start is in the morning in Universal Time (the exchanges' and Hyperliquid's bars start
   at its midnight; a share's at New York's, which is still that date there); else the date of the city whose own anchor the start is —
   New York's open, 09:30 (a share's bar stamped at the open, Cboe's) or its midnight, then Hong Kong's midnight, then Tokyo's (and
   Seoul's) — each matched exactly, so a bar from Hong Kong's midnight is never taken for New York's morning in winter; else the date in
   Universal Time */
const CH_DAY_ANCHORS = [["America/New_York", ["09:30", "00:00"]], ["Asia/Hong_Kong", ["00:00"]], ["Asia/Tokyo", ["00:00"]]];
function chDayOf(t) {
  const u = chParts(t, "UTC");
  if (Number(u.hh) < 12) return u;
  for (const [z, at] of CH_DAY_ANCHORS) {
    const p = chParts(t, z);
    if (at.includes(`${p.hh}:${p.mm}`)) return p;
  }
  return u;
}
/** a bar's time as the crosshair says it: "Tue 14 Oct 13:05" on the viewer's clock, a daily bar's day "Tue 14 Oct 2026" */
function chWhen(t, interval, zone = CH_ZONE) {
  if (!Number.isFinite(t)) return "—";
  if (interval === "1d") {
    const p = chDayOf(t);
    return `${p.wd} ${p.d} ${p.mo} ${p.y}`;
  }
  const p = chParts(t, zone);
  return `${p.wd} ${p.d} ${p.mo} ${p.hh}:${p.mm}`;
}

/* how much a time of day stands out, by bar size: the minutes of the day it is a multiple of, and its rank (a new day ranks above all) */
const CH_MARKS = {
  "5m": [[360, 3], [180, 2.5], [60, 2], [30, 1], [15, 0.5]],
  "1h": [[720, 3], [360, 2.5], [180, 2], [60, 1]],
};
/** THE TIME AXIS'S CANDIDATES for `bars`: each bar that starts something worth a label, with its words and rank — on 5m and 1h bars its
 * time HH:MM on the viewer's clock (`zone`) where the time of day is round (a quarter hour on 5m, an hour on 1h; six hours rank above
 * three, three above one), and the day and month ("15 Oct") where a new day begins (ranked above any time); on daily bars the day and month
 * of the day each bar stands for, a new month ranked above a Monday, a new year above both. A clock half or three quarters of an hour off
 * Universal Time (Kolkata, Kathmandu, Adelaide) never sees an hourly bar start on its whole hour, so there the round times are counted from
 * the bars' own minute (10:30, 11:30 … in Kolkata), still written on that clock. The first bar has no label (nothing before it to mark a
 * change from). The drawing keeps the highest ranked that fit (chThin) */
function chTimeLabels(bars, interval, zone = CH_ZONE) {
  const out = [];
  const list = bars || [];
  const marks = CH_MARKS[interval] || CH_MARKS["1h"];
  const unit = marks[marks.length - 1][0];
  const DAY_MIN = 1440;
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const t = list[i].t;
    if (!Number.isFinite(t)) continue;
    const p = interval === "1d" ? chDayOf(t) : chParts(t, zone);
    if (prev) {
      if (interval === "1d") {
        if (p.day !== prev.day) {
          const rank = p.y !== prev.y ? 4 : p.mo !== prev.mo ? 3 : p.wd === "Mon" ? 2 : 1;
          out.push({ i, t, text: `${p.d} ${p.mo}`, rank });
        }
      } else if (p.day !== prev.day) out.push({ i, t, text: `${p.d} ${p.mo}`, rank: 4 });
      else {
        const m = Number(p.hh) * 60 + Number(p.mm);
        // the clock's offset from Universal Time in minutes, and the part of it that is not a whole number of the bar size's round unit
        const utc = Math.floor((((t % CH_MS["1d"]) + CH_MS["1d"]) % CH_MS["1d"]) / 60_000);
        const shift = (((m - utc) % DAY_MIN) + DAY_MIN) % DAY_MIN % unit;
        const at = (m - shift + DAY_MIN) % DAY_MIN;
        const mark = marks.find(([k]) => at % k === 0);
        if (mark) out.push({ i, t, text: `${p.hh}:${p.mm}`, rank: mark[1] });
      }
    }
    prev = p;
  }
  return out;
}
/* the labels that fit: the highest ranked first (the earlier of two alike), each at least `gap` pixels from every one kept and inside the
   plot; in their order along the axis */
function chThin(labels, cx, w, gap = CH_LABEL_GAP) {
  const kept = [];
  const order = [...labels].sort((a, b) => b.rank - a.rank || a.i - b.i);
  for (const l of order) {
    const x = cx(l.i);
    if (x < gap / 2 || x > w - gap / 2) continue;
    if (kept.every((k) => Math.abs(k.x - x) >= gap)) kept.push({ ...l, x });
  }
  return kept.sort((a, b) => a.x - b.x);
}

// ---- pure: the readout and the live price -------------------------------------------------------------------------------------------

/* a small number as its two significant figures, in plain decimals (0.004, never 4e-3) */
const chTwoSig = (v) => {
  const n = Number(Math.abs(v).toPrecision(2));
  return n.toFixed(Math.min(20, chDecimalsOf(n)));
};

/** THE READOUT for one bar: "O 83,134 H 84,103 L 81,556 C 81,901 −1,233.0 (−1.48%)" — its open, high, low and close in `fmt` (chFmt), then
 * its change from the close before it (`prevClose`; none for the first bar) in the same figures and in percent, signed (+ or −: never the
 * colour alone). A change too small for the market's figures (0.004 on two decimals) is said to two significant figures, as the percent
 * is — never a rounded zero with a sign on it ("+0.00"). Returns { text, html }: the html keeps each key with its figure (and the change
 * whole) in one unit that never breaks across lines, and tints the four figures by the bar's direction and the change by its own */
function chReadout(bar, prevClose, fmt) {
  if (!bar) return { text: "", html: "" };
  const f = typeof fmt === "function" ? fmt : chFmt(2, false);
  const dir = bar.c >= bar.o ? "up" : "down";
  const parts = [["O", bar.o], ["H", bar.h], ["L", bar.l], ["C", bar.c]];
  let text = parts.map(([k, v]) => `${k} ${f(v)}`).join(" ");
  let html = parts.map(([k, v]) => `<span class="ch-kv"><span class="ch-k">${k}</span> <span class="ch-v ${dir}">${esc(f(v))}</span></span>`).join(" ");
  const pc = prevClose === null || prevClose === undefined ? NaN : Number(prevClose);
  if (Number.isFinite(pc)) {
    const d = Number((bar.c - pc).toPrecision(12));
    const sign = d > 0 ? "+" : d < 0 ? "−" : "";
    // a change under a hundredth of a percent is said to two significant figures (+3.79 on 81,500 is +0.0047%, never "+0.00%")
    const pa = Math.abs((d / pc) * 100);
    const pct = pc !== 0 ? ` (${sign}${pa > 0 && pa < 0.01 ? chTwoSig(pa) : pa.toFixed(2)}%)` : "";
    let size = f(Math.abs(d), true);
    if (d !== 0 && !/[1-9]/.test(size)) size = size.replace(/[\d.,]+/, chTwoSig(d));
    const words = `${sign}${size}${pct}`;
    text += ` ${words}`;
    html += ` <span class="ch-d${d > 0 ? " up" : d < 0 ? " down" : ""}">${esc(words)}</span>`;
  }
  return { text, html };
}

/** how many lines the readout takes laid over a plot `width` pixels wide, at most: four keys with figures `wide` characters long and the
 * change after them (its figures, its sign and its percent: the widest it can be), each a unit that does not break, packed as the words
 * wrap with the gap between two. `small`: the narrow chart's smaller words. An estimate on the wide side, so the room kept under the plot's
 * top edge holds the readout of any bar shown — the room is set per layout, never by the bar the pointer is on */
function chReadoutLines(wide, width, small = false) {
  const cw = small ? CH_CHAR_W_SMALL : CH_CHAR_W;
  const gap = small ? CH_GAP_SMALL : CH_GAP;
  const kv = (wide + 2) * cw;
  const units = [kv, kv, kv, kv, (wide + 13) * cw];
  const room = Math.max(40, width - CH_RO_LEFT - 4);
  let lines = 1;
  let x = 0;
  for (const u of units) {
    if (x > 0 && x + gap + u > room) {
      lines++;
      x = 0;
    }
    x += (x > 0 ? gap : 0) + u;
  }
  return lines;
}

/** A LIVE PRICE ON THE LAST BAR: `quote` { price, at } (at in ms) moves the last of `bars` — its close, and its high or low where the price
 * passes them — only when `at` is inside that bar's interval [t, t + intervalMs). Never a new bar. True when the bar changed */
function chApplyQuote(bars, quote, intervalMs) {
  const last = bars && bars.length ? bars[bars.length - 1] : null;
  if (!last || !quote || !Number.isFinite(quote.price) || !Number.isFinite(quote.at) || !Number.isFinite(intervalMs)) return false;
  if (quote.at < last.t || quote.at >= last.t + intervalMs) return false;
  const p = quote.price;
  if (last.c === p && last.h >= p && last.l <= p) return false;
  last.c = p;
  if (p > last.h) last.h = p;
  if (p < last.l) last.l = p;
  return true;
}

/** A SHARE'S DAILY BAR TAKES ONLY THE REGULAR SESSION'S PRICE. Its source's daily bar is the regular session's open, high, low and close
 * (Cboe's stamped at the 09:30 open, Alpaca's at New York's midnight), and its day [t, t + 24 h) also holds the after-hours, the overnight
 * and the next pre-market, whose prices are no part of it. So a live price moves it only while the market's session (`session`, as the
 * venue says it: Market.session) is the regular one — phase "regular", or open with no phase — and the price's own time (`at`, ms) is inside
 * 09:30–16:00 New York. Where the venue says no session, the source's bar is left as it drew it */
function chRegular(session, at) {
  if (!session || typeof session !== "object") return false;
  if (!(session.phase === "regular" || (session.open === true && !session.phase))) return false;
  if (!Number.isFinite(at)) return false;
  const p = chParts(at, "America/New_York");
  const m = Number(p.hh) * 60 + Number(p.mm);
  return m >= 570 && m < 960;
}

// ---- mounting -----------------------------------------------------------------------------------------------------------------------

/* the page is hidden (another tab, a minimised window): nothing is asked */
const chHidden = () => typeof document !== "undefined" && (document.visibilityState === "hidden" || document.hidden === true);
/* the plot is laid out: false while its pane is not the one showing (shell.js hides a pane with `hidden`, so el stays in the document
   while the owner is on Portfolio or Markets) — then nothing is asked either */
const chLaidOut = (s) => {
  const plot = s.parts && s.parts.plot;
  return !plot || typeof plot.getClientRects !== "function" || plot.getClientRects().length > 0;
};
/* a chart's state is the one mounted on its element, still mounted */
const chLive = (s) => s.alive && CH.get(s.el) === s;
/* a bar size's words on its button */
const chIvWord = (iv) => (CH_INTERVALS.find(([v]) => v === iv) || [iv, iv])[1];
/* the viewer's clock in words, for the foot: "Hong Kong time", "UTC" */
const chZoneWords = (zone = CH_ZONE) => (zone === "UTC" || zone === "Etc/UTC" ? "UTC" : `${String(zone).split("/").pop().replace(/_/g, " ")} time`);

/** the chart drawn into el on one market (see the head of this file). Mounting again on el releases what was mounted there first */
function chMount(el, opts = {}) {
  if (!el) return;
  chRelease(el);
  const m = opts.quote && typeof opts.quote === "object" ? opts.quote : null;
  const kind = String(opts.kind || (m && m.kind) || "");
  const s = {
    el,
    venue: String(opts.venue || "").trim(),
    symbol: String(opts.symbol || "").trim(),
    kind,
    ev: kind === "event",
    cur: m ? String(m.quote || "") : String(opts.quote || ""),
    step: opts.priceStep !== undefined ? Number(opts.priceStep) : m ? Number(m.priceStep) : NaN,
    onInterval: typeof opts.onInterval === "function" ? opts.onInterval : null,
    interval: CH_MS[opts.interval] ? opts.interval : "1h",
    alive: true,
    // how long after a refused read with no bars the next one waits (0: bars stand, or nothing refused yet)
    wait: 0,
    // the reads: how many were asked (the latest answer is the one drawn), one on its way, when the last landed
    reads: 0,
    reading: false,
    readAt: 0,
    // what the source said: its bars (null until it answered with some), its refusal's words, its name, the figures' decimals
    bars: null,
    said: "",
    venueName: "",
    dec: 2,
    labels: null,
    // the latest live price { price, at, readAt } (readAt: when the page had it), and when one may be asked again after a refusal
    quote: null,
    quoteWait: 0,
    timer: 0,
    ro: null,
    off: [],
    // the plot laid out when last looked (its pane showing): the size observer asks at once when it comes back
    shown: true,
    // the layout the picture was drawn with, the crosshair's parts, where the pointer or the keys put it
    L: null,
    x: null,
    hover: null,
    queued: false,
    drawQueued: false,
  };
  CH.set(el, s);
  paint(el, chShell(s));
  const q = (sel) => el.querySelector(sel);
  s.parts = { ivs: q(".ch-ivs"), ohlc: q(".ch-ohlc"), plot: q(".ch-plot"), draw: q(".ch-draw"), cross: q(".ch-cross"), foot: q(".ch-foot") };
  if (!s.parts.plot || !s.parts.draw) return;
  if (!s.venue || !s.symbol) return void paint(s.parts.draw, '<p class="ch-msg">No market to chart.</p>');
  s.shown = chLaidOut(s);
  chWire(s);
  chRead(s, true);
  s.timer = setTimeout(() => chTick(s), CH_POLL_MS);
}

/** what was mounted on el stopped: its timer, its listeners, its size observer. The drawing stays until the page draws over it */
function chRelease(el) {
  const s = el ? CH.get(el) : null;
  if (!s) return;
  CH.delete(el);
  s.alive = false;
  clearTimeout(s.timer);
  s.timer = 0;
  for (const off of s.off) off();
  s.off = [];
  if (s.ro) s.ro.disconnect();
  s.ro = null;
}

/** the bar size the chart on el shows; "" where none is mounted */
function chInterval(el) {
  const s = el ? CH.get(el) : null;
  return s ? s.interval : "";
}

/* the frame: the head (the bar sizes, a box of fixed height), the plot (the picture, the readout laid over its corner, the crosshair over
   both), the foot (a box of fixed height). The readout is inside the plot and out of the flow: its words never change a box's size */
function chShell(s) {
  return `<div class="ch" data-k="ch:${esc(s.venue)}|${esc(s.symbol)}"><div class="ch-head"><div class="ch-ivs" role="group" aria-label="Bars of">${chIvButtons(s)}</div></div><div class="ch-plot" tabindex="0" role="group" aria-label="${esc(`Price chart of ${s.symbol}: point at a bar, or use the arrow keys, to read it`)}"><div class="ch-draw"></div><div class="ch-ohlc"></div><div class="ch-cross" aria-hidden="true"></div></div><p class="ch-foot"></p></div>`;
}
const chIvButtons = (s) => CH_INTERVALS.map(([v, w]) => `<button type="button" class="ch-iv" data-ch-iv="${v}" aria-pressed="${v === s.interval}" data-fk="ch-iv:${v}">${w}</button>`).join("");

/* a listener kept with the chart, so release takes it away */
function chOn(s, target, type, fn, opts) {
  if (!target || typeof target.addEventListener !== "function") return;
  target.addEventListener(type, fn, opts);
  s.off.push(() => typeof target.removeEventListener === "function" && target.removeEventListener(type, fn, opts));
}

/* the chart's listeners, each heard once on its own part: a bar size pressed, the pointer and the keys on the plot, the plot's size (and
   its pane shown again: the size observer sees the plot laid out once more and asks at once), the page shown again */
function chWire(s) {
  const P = s.parts;
  chOn(s, s.el, "click", (e) => {
    const b = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-ch-iv]") : null;
    if (!b || (typeof s.el.contains === "function" && !s.el.contains(b))) return;
    chSetInterval(s, b.dataset.chIv);
  });
  const point = (e) => {
    const r = P.plot.getBoundingClientRect();
    s.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    chSoonShow(s);
  };
  chOn(s, P.plot, "pointermove", point);
  chOn(s, P.plot, "pointerdown", point);
  chOn(s, P.plot, "pointerleave", () => chLeave(s));
  chOn(s, P.plot, "keydown", (e) => chKey(s, e));
  chOn(s, P.plot, "blur", () => s.hover && s.hover.back !== undefined && chLeave(s));
  if (typeof ResizeObserver === "function") {
    s.ro = new ResizeObserver(() => {
      if (!chLive(s)) return;
      const was = s.shown;
      s.shown = chLaidOut(s);
      // the pane came back: the bars and the live price asked now, not at the next tick
      if (s.shown && !was && !chHidden()) {
        clearTimeout(s.timer);
        chTick(s);
      }
      chSoon(s);
    });
    s.ro.observe(P.plot);
  } else if (typeof addEventListener === "function") chOn(s, globalThis, "resize", () => chSoon(s));
  if (typeof document !== "undefined") chOn(s, document, "visibilitychange", () => !chHidden() && chLive(s) && !s.timer && chTick(s));
}

/* another bar size: the buttons say it at once, the bars of the one before are taken away (never drawn under the new one's button), and
   its bars are read */
function chSetInterval(s, iv) {
  if (!chLive(s) || !CH_MS[iv] || iv === s.interval) return;
  s.interval = iv;
  paint(s.parts.ivs, chIvButtons(s));
  if (s.onInterval) s.onInterval(iv);
  chRead(s, true);
}

/* THE BARS READ (kept thirty seconds by the page): `fresh` — a new mount or another bar size — takes away what was drawn first, the live
   price taken for the bars before included (the new bars wait for a price read for them). Only the latest read's answer is drawn, and
   only while the chart is still mounted on its element at that bar size */
function chRead(s, fresh) {
  const n = ++s.reads;
  const iv = s.interval;
  const asked = Date.now();
  s.reading = true;
  if (fresh) {
    s.bars = null;
    s.said = "";
    s.venueName = "";
    s.labels = null;
    s.hover = null;
    s.quote = null;
    s.wait = 0;
    chDraw(s);
  }
  // after a refusal with no bars, the read is asked of the account again, not answered from the refusal the page kept
  const path = `/api/account/candles?${new URLSearchParams({ venue: s.venue, symbol: s.symbol, interval: iv })}`;
  if (!fresh && !s.bars && s.wait && typeof forget === "function") forget(path);
  return api(path, { ttl: 30_000 }).then((b) => {
    if (!chLive(s) || n !== s.reads || iv !== s.interval) return;
    s.reading = false;
    s.readAt = Date.now();
    chTake(s, b, asked);
    chDraw(s);
    // the last bar brought to the live price at once, not five seconds later (only while the plot is showing)
    if (fresh && !chHidden() && chLaidOut(s)) chPoll(s);
  });
}

/* what a read said, taken: the source's bars (a copy: the read the page keeps is not changed by a live price), oldest first, only whole
   ones (a bar without its four prices is left out, never filled in), an event contract's in cents, and whose they are — the source the
   account read (`from`, where the answer names it: a paper account's bars are its market's public source's), else the venue's name. The
   live price taken before is laid over them only while it is fresh — read within the last two asks, or after this read was asked
   (`asked`, ms): an older one never stands in for the source's own close. A refusal is kept in its words — unless bars of this size
   already stand: a later read that failed does not take the source's bars away. A read that never reached the account (a stopped
   service, a dropped connection: book.js bkUnanswered) is said in the page's own words, never the browser's error as it was thrown; and
   either says how long the chart now waits before asking again (s.wait) */
function chTake(s, b, asked = 0) {
  if (b && b.ok !== false && Array.isArray(b.candles)) {
    const k = s.ev ? 100 : 1;
    const at = (v) => (k === 1 ? Number(v) : Number((Number(v) * k).toFixed(6)));
    const whole = (x) => x && [x.t, x.o, x.h, x.l, x.c].every((v) => v !== null && v !== "" && Number.isFinite(Number(v)));
    s.bars = b.candles
      .filter(whole)
      .map((x) => ({ t: Number(x.t), o: at(x.o), h: at(x.h), l: at(x.l), c: at(x.c), ...(x.v !== undefined && x.v !== null && Number.isFinite(Number(x.v)) ? { v: Number(x.v) } : {}) }))
      .sort((a, c) => a.t - c.t);
    s.said = "";
    const from = typeof b.from === "string" && b.from.trim() ? b.from.trim() : "";
    s.venueName = String(from || b.venueName || s.venueName || s.venue);
    s.labels = null;
    const q = s.quote;
    if (q && (q.readAt >= asked || Date.now() - q.readAt <= CH_FRESH_MS)) chApplyQuote(s.bars, q, CH_MS[s.interval]);
    s.dec = chDecimals(s.bars, s.ev, s.step);
    s.wait = 0;
    return;
  }
  if (s.bars) return;
  s.wait = Math.min(CH_BACKOFF_MAX_MS, Math.max(CH_BACKOFF_MS, s.wait * 2));
  const unanswered = typeof bkUnanswered === "function" ? bkUnanswered(b) : !b;
  const words = unanswered ? "" : String(refusalOf(b) || "").trim().replace(/[.\s]+$/, "");
  // a source's own fact (it keeps no history: E_VENUE_RAIL_CLOSED) is said alone; anything else with how long until it is asked again
  const quiet = !!(b && b.refusal && b.refusal.code === "E_VENUE_RAIL_CLOSED");
  const again = quiet ? "" : ` Asking again every ${Math.round(s.wait / 1000)} s.`;
  s.said = `${words ? `${words}.` : "No price history: the account is not answering."}${again}`;
}

/* every five seconds while mounted, in the document, its pane showing and the page showing (the page shown again asks at once; the pane
   shown again too, through the size observer). While the pane is hidden the clock keeps time and asks nothing */
function chTick(s) {
  s.timer = 0;
  if (!chLive(s)) return;
  if (s.el.isConnected === false) return void chRelease(s.el);
  if (chHidden()) return;
  s.shown = chLaidOut(s);
  if (s.shown) chPoll(s);
  s.timer = setTimeout(() => chTick(s), CH_POLL_MS);
}
/* one round: the bars read again when they are a minute old, and once thirty seconds after the last bar's interval ended where the bars in
   hand were read before then (so once per bar's end: the read that follows was read after it); the live price asked while the last bar
   can still take it */
function chPoll(s) {
  if (!chLive(s)) return;
  const now = Date.now();
  const last = s.bars && s.bars.length ? s.bars[s.bars.length - 1] : null;
  const end = last ? last.t + CH_MS[s.interval] : 0;
  const ended = !!last && now >= end + CH_ENDED_MS && s.readAt < end + CH_ENDED_MS && now - s.readAt >= CH_ENDED_MS;
  // bars in hand: once a minute; a refusal and no bars: after the refusal's own wait (two seconds, doubling, at most a minute)
  const every = !s.bars && s.wait ? s.wait : CH_READ_MS;
  if (!s.reading && s.readAt && (now - s.readAt >= every || ended)) chRead(s, false);
  if (last && now >= s.quoteWait && now < end + CH_LATE_MS) chQuote(s);
}
/* THE LIVE PRICE (GET /api/account/quotes, kept three seconds by the page, so the market bar and the book asking the same share it): its
   time is the quote's own stamp where the source stamps one, else the moment it was read. It moves the last bar only inside that bar's
   interval (chApplyQuote) — a share's daily bar only in its regular session (chRegular); a price older than one already taken is not
   taken; a refusal drops the price taken before (it is no longer the venue's word) and waits a minute before the next ask. A price with
   finer figures than the bars carries its decimals to the axis (chDecimals) */
function chQuote(s) {
  const iv = s.interval;
  return api(`/api/account/quotes?pairs=${encodeURIComponent(`${s.venue}|${s.symbol}`)}`, { ttl: 3_000 }).then((b) => {
    if (!chLive(s) || s.interval !== iv) return;
    const row = b && b.ok !== false && Array.isArray(b.quotes) ? b.quotes.find((x) => x && x.venue === s.venue && x.symbol === s.symbol) : null;
    const m = row && !row.refusal ? row.market : null;
    const price = !m || m.price === undefined || m.price === null || m.price === "" ? NaN : Number(m.price);
    if (!Number.isFinite(price)) {
      s.quote = null;
      s.quoteWait = Date.now() + CH_QUOTE_WAIT_MS;
      return;
    }
    const stamped = Date.parse(String(m.quoteAt || ""));
    const quote = { price: s.ev ? Number((price * 100).toFixed(6)) : price, at: Number.isFinite(stamped) ? stamped : Date.now(), readAt: Date.now() };
    if (s.kind === "stock" && iv === "1d" && !chRegular(m.session, quote.at)) return;
    if (s.quote && quote.at < s.quote.at) return;
    s.quote = quote;
    if (s.bars && chApplyQuote(s.bars, quote, CH_MS[s.interval])) {
      s.dec = chDecimals(s.bars, s.ev, s.step);
      chDraw(s);
    }
  });
}

// ---- drawing ------------------------------------------------------------------------------------------------------------------------

/* drawn again once, in the next frame, however often its size changed */
function chSoon(s) {
  if (s.drawQueued) return;
  s.drawQueued = true;
  nextFrame(() => {
    s.drawQueued = false;
    if (chLive(s)) chDraw(s);
  });
}

/** THE PANEL as it stands: reading · the source's refusal in its words · no bars yet · the picture. The picture needs its box laid out:
 * until it is (a pane still coming in), nothing is drawn and the size observer draws it */
function chDraw(s) {
  const P = s.parts;
  const word = chIvWord(s.interval);
  const quiet = (html) => {
    s.L = null;
    s.x = null;
    paint(P.ohlc, "");
    paint(P.cross, "");
    if (P.cross.classList) P.cross.classList.remove("on");
    paint(P.foot, "");
    paint(P.draw, html);
  };
  if (!s.bars) return void quiet(s.said ? `<p class="ch-msg ch-no">${esc(s.said)}</p>` : `<p class="ch-msg ch-wait" aria-busy="true">Reading the ${esc(word)} bars…</p>`);
  if (!s.bars.length) return void quiet(`<p class="ch-msg">${esc(`No ${word} bars from ${s.venueName} for ${s.symbol} yet.`)}</p>`);
  const W = Math.floor(P.plot.clientWidth || 0);
  const H = Math.floor(P.plot.clientHeight || 0);
  if (W < 60 || H < 80) return;
  const L = chLayout(s, W, H);
  s.L = L;
  paint(P.draw, chSvg(s, L));
  // the readout's box: over the price pane's corner, as wide as the pane (its words wrap inside it; nothing outside it moves)
  if (P.ohlc.style) P.ohlc.style.width = `${Math.max(40, L.plotW - CH_RO_LEFT - 4)}px`;
  if (paint(P.cross, chCrossSvg(L)) || !s.x) {
    const c = (sel) => P.cross.querySelector(sel);
    s.x = { v: c(".ch-xv"), h: c(".ch-xh"), pt: c(".ch-xpt"), pr: c(".ch-xpr"), tt: c(".ch-xtt"), tr: c(".ch-xtr") };
  }
  paint(P.foot, esc(chFoot(s)));
  if (s.hover) chShow(s);
  else chReadoutAt(s, s.bars.length - 1);
}

/* whose bars (the source the account read them from), what size, whose clock */
function chFoot(s) {
  const parts = [s.venueName, `${chIvWord(s.interval)} bars`];
  if (s.cur && !s.ev) parts.push(`prices in ${s.cur}`);
  if (s.ev) parts.push("prices in cents");
  parts.push(s.interval === "1d" ? "each bar's own day" : chZoneWords());
  return parts.join(" · ");
}

/* the picture's layout at W × H: the figures' format, the volume pane where the bars carry volume (18% of the plot, 28–96 pixels), the price
   axis as wide as its longest figure, the room under the top edge the readout is laid over (as many lines as the longest readout of these
   bars takes at this width: set by the layout, never by the bar the pointer is on), the scales, the time labels that fit */
function chLayout(s, W, H) {
  const bars = s.bars;
  const fmt = chFmt(s.dec, s.ev);
  const plotH = Math.max(40, H - CH_TIME_H);
  const hasVol = bars.some((b) => Number.isFinite(b.v) && b.v > 0);
  const volH = hasVol ? Math.max(28, Math.min(96, Math.round(plotH * 0.18))) : 0;
  let wide = 0;
  for (const b of bars) wide = Math.max(wide, fmt(b.h).length, fmt(b.l).length);
  const axisW = Math.max(44, Math.min(120, Math.ceil((wide + 1) * 6.6 + 12)));
  const plotW = Math.max(20, W - axisW);
  const roomTop = CH_RO_TOP + chReadoutLines(wide, plotW, W <= CH_SMALL_W) * CH_LINE_H + 3;
  const sc = chScale(bars, plotW, plotH, volH, roomTop);
  const tickFmt = chFmt(sc.ticks.reduce((d, t) => Math.max(d, chDecimalsOf(t)), 0), s.ev);
  if (!s.labels) s.labels = chTimeLabels(bars, s.interval);
  const labels = chThin(s.labels.filter((l) => l.i >= sc.from && l.i < sc.to), sc.cx, plotW);
  return { W, H, plotW, plotH, axisW, volH, roomTop, sc, fmt, tickFmt, labels };
}

/** THE PICTURE as one SVG string: the grid at the round prices and the labelled times, the volume pane (its bars tinted by direction, its
 * own scale: the highest volume shown, on the axis), the candles (a 1px wick from high to low, a body from open to close at least 1px high,
 * up when the close is at or above the open), the axes' edges and labels, and the dashed line at the last price with its value in a tag on
 * the axis tinted by the last bar's direction */
function chSvg(s, L) {
  const { sc, plotW, plotH, axisW, W, H, fmt, tickFmt, labels } = L;
  const B = s.bars;
  const half = (sc.bw - 1) / 2;
  let cu = "";
  let cd = "";
  let vu = "";
  let vd = "";
  for (let i = sc.from; i < sc.to; i++) {
    const b = B[i];
    const up = b.c >= b.o;
    const x = sc.cx(i);
    const yh = Math.round(sc.y(b.h));
    const yl = Math.round(sc.y(b.l));
    const yo = Math.round(sc.y(b.o));
    const yc = Math.round(sc.y(b.c));
    const top = Math.min(yo, yc);
    const shape = `M${x} ${yh}h1v${Math.max(1, yl - yh)}h-1ZM${x - half} ${top}h${sc.bw}v${Math.max(1, Math.abs(yo - yc))}h${-sc.bw}Z`;
    if (up) cu += shape;
    else cd += shape;
    const vh = Math.round(sc.vh(b.v));
    if (vh > 0) {
      const bar = `M${x - half} ${plotH - vh}h${sc.bw}v${vh}h${-sc.bw}Z`;
      if (up) vu += bar;
      else vd += bar;
    }
  }
  const last = B[B.length - 1];
  const lastDir = last.c >= last.o ? "up" : "down";
  const ly = Math.min(plotH - 9, Math.max(9, Math.round(sc.y(last.c))));
  const lyIn = Math.round(sc.y(last.c));
  // the round prices: a grid line each, a label each on the axis unless the last price's tag stands there
  let grid = "";
  let axis = "";
  for (const t of sc.ticks) {
    const y = Math.round(sc.y(t));
    if (y < 4 || y > sc.bottom - 2) continue;
    grid += `M0 ${y + 0.5}H${plotW}`;
    if (Math.abs(y - ly) >= 14) axis += `<text class="ch-ax" x="${plotW + 6}" y="${y + 4}">${esc(tickFmt(t))}</text>`;
  }
  for (const l of labels) {
    grid += `M${l.x + 0.5} 0V${plotH}`;
    axis += `<text class="ch-ax" x="${l.x + 0.5}" y="${plotH + 15}" text-anchor="middle">${esc(l.text)}</text>`;
  }
  // the volume pane's own scale: its top is the highest volume shown
  const vol = sc.volH > 0 && sc.vmax > 0 ? `<path class="ch-sep" d="M0 ${sc.volTop - CH_VOL_GAP / 2 + 0.5}H${plotW}"/><path class="ch-vu" d="${vu}"/><path class="ch-vd" d="${vd}"/><text class="ch-ax ch-vax" x="${plotW + 6}" y="${sc.volTop + 9}">${esc(chCompact(sc.vmax))}</text>` : "";
  const lows = [];
  const highs = [];
  for (let i = sc.from; i < sc.to; i++) {
    lows.push(B[i].l);
    highs.push(B[i].h);
  }
  const label = `${s.symbol} at ${s.venueName}, ${chIvWord(s.interval)} bars: last ${fmt(last.c)}; low ${fmt(Math.min(...lows))} and high ${fmt(Math.max(...highs))} over the ${sc.n} bars shown`;
  const lastLine = lyIn >= 0 && lyIn <= sc.bottom ? `<path class="ch-last ${lastDir}" d="M0 ${lyIn + 0.5}H${plotW}"/>` : "";
  return `<svg class="ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" focusable="false"><path class="ch-grid" d="${grid}"/>${vol}<g class="ch-cs"><path class="ch-cu" d="${cu}"/><path class="ch-cd" d="${cd}"/></g><path class="ch-edge" d="M${plotW + 0.5} 0V${plotH}M0 ${plotH + 0.5}H${W}"/>${axis}${lastLine}<rect class="ch-tagr ${lastDir}" x="${plotW + 1}" y="${ly - 9}" width="${axisW - 1}" height="18" rx="3"/><text class="ch-tagt" x="${plotW + 6}" y="${ly + 4}">${esc(fmt(last.c))}</text></svg>`;
}

/* the crosshair, drawn once per layout: a vertical line with the time's tag on the time axis, a horizontal one with the price's tag on the
   price axis. Moved by a transform; its tags' places and words set in place */
function chCrossSvg(L) {
  return `<svg class="ch-xs" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" focusable="false"><g class="ch-xv" transform="translate(0 0)"><line class="ch-xl" x1="0.5" y1="0" x2="0.5" y2="${L.plotH}"/><rect class="ch-xb ch-xtr" x="0" y="${L.plotH + 2}" width="0" height="18" rx="3"/><text class="ch-xw ch-xtt" x="0" y="${L.plotH + 15}" text-anchor="middle"></text></g><g class="ch-xh" transform="translate(0 0)"><line class="ch-xl" x1="0" y1="0.5" x2="${L.plotW}" y2="0.5"/><rect class="ch-xb ch-xpr" x="${L.plotW + 1}" y="-9" width="${L.axisW - 1}" height="18" rx="3"/><text class="ch-xw ch-xpt" x="${L.plotW + 6}" y="4"></text></g></svg>`;
}

/* the readout says one bar: the one under the pointer, else the last */
function chReadoutAt(s, i) {
  const L = s.L;
  if (!L || !s.bars || !s.bars[i]) return void paint(s.parts.ohlc, "");
  const prev = i > 0 ? s.bars[i - 1].c : null;
  paint(s.parts.ohlc, chReadout(s.bars[i], prev, L.fmt).html);
}

/* a pointer move's crosshair, once a frame */
function chSoonShow(s) {
  if (s.queued) return;
  s.queued = true;
  nextFrame(() => {
    s.queued = false;
    if (chLive(s)) chShow(s);
  });
}

/** THE CROSSHAIR where the pointer is (or the keys put it): the vertical line on the middle of the bar under it with that bar's time in a
 * tag on the time axis (kept inside the plot), the horizontal line at the pointer with the price there in a tag on the price axis (the tag
 * kept whole inside the price pane near its edges) — hidden over the volume pane and the time axis — and the readout saying that bar.
 * Only transforms, attributes and words: the picture is not drawn again, and no box changes its size */
function chShow(s) {
  const L = s.L;
  const X = s.x;
  const h = s.hover;
  if (!L || !X || !h || !s.bars || !s.bars.length || !X.v || !X.h) return;
  const sc = L.sc;
  const i = h.back !== undefined ? Math.max(sc.from, sc.to - 1 - h.back) : sc.at(Math.min(h.x, L.plotW));
  const bar = s.bars[i];
  const x = sc.cx(i);
  X.v.setAttribute("transform", `translate(${x} 0)`);
  const when = chWhen(bar.t, s.interval);
  const tw = Math.ceil(when.length * 6.4 + 14);
  const left = Math.round(Math.max(-x, Math.min(L.plotW - x - tw, -tw / 2)));
  if (X.tr) {
    X.tr.setAttribute("x", String(left));
    X.tr.setAttribute("width", String(tw));
  }
  if (X.tt) {
    X.tt.setAttribute("x", String(left + tw / 2));
    setText(X.tt, when);
  }
  const y = h.back !== undefined ? sc.y(bar.c) : h.y;
  if (Number.isFinite(y) && y >= 0 && y <= sc.bottom) {
    const yy = Math.round(y);
    X.h.setAttribute("transform", `translate(0 ${yy})`);
    X.h.setAttribute("visibility", "visible");
    // the line where the pointer is; its tag kept whole inside the price pane, as the last price's is
    const dy = Math.min(Math.max(9, sc.bottom - 9), Math.max(9, yy)) - yy;
    if (X.pr) X.pr.setAttribute("y", String(dy - 9));
    if (X.pt) {
      X.pt.setAttribute("y", String(dy + 4));
      setText(X.pt, L.fmt(sc.price(yy)));
    }
  } else X.h.setAttribute("visibility", "hidden");
  if (s.parts.cross.classList) s.parts.cross.classList.add("on");
  chReadoutAt(s, i);
}

/* the pointer left (or the keys let go): no crosshair, the readout back on the last bar */
function chLeave(s) {
  s.hover = null;
  if (s.parts.cross.classList) s.parts.cross.classList.remove("on");
  if (s.bars && s.bars.length) chReadoutAt(s, s.bars.length - 1);
}

/* the keys on the plot: ← and → a bar at a time, Home the oldest shown, End the newest, Escape away */
function chKey(s, e) {
  const L = s.L;
  if (!L) return;
  const max = L.sc.to - L.sc.from - 1;
  const back = s.hover && s.hover.back !== undefined ? s.hover.back : -1;
  const to = { ArrowLeft: Math.min(max, back + 1), ArrowRight: Math.max(0, back - 1), Home: max, End: 0 }[e.key];
  if (e.key === "Escape") return void (s.hover && chLeave(s));
  if (to === undefined) return;
  if (typeof e.preventDefault === "function") e.preventDefault();
  s.hover = { back: to };
  chShow(s);
}
