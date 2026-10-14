/* The ORDER BOOK and the LATEST TRADES: the Trade page's middle panel (ui/terminal.js mounts it beside the chart and the ticket). Two tabs:
   "Order book" — the ladder, the offers above and the bids below, the best of each nearest the middle, a spread row between them — and
   "Trades", the latest trades, newest first. What it shows is the market's own source, read by the account (GET /api/account/book and
   GET /api/account/trades; service.ts marketBook / marketTrades): a connected venue's own book, a paper account's market's public source, a
   venue not connected from its public data without a key. Nothing on it is made up: every row is a level the source sent, a grouped row is
   the sum of the real sizes inside it — and the group at the far end of a side the source may hold more of says "≥", only part of its range
   having been read — a bar behind a row is that row's own running total, and a source whose depth is not read (a US stock's public quote
   has none at all) is shown as exactly its best bid and best ask, with a quiet line saying which, and how old a quote is once it is more
   than a few seconds old. A price is printed to its tick, never to fewer decimals than it has. A read that fails shows the refusal's own
   words.

     bkMount(el, { venue, symbol, kind, quote, priceStep, base?, rows?, onPrice })
                   draws the panel into el for one market and keeps it fresh: the book read every two seconds while its tab shows, the
                   trades every four while theirs does, and neither while el is out of the document (it stops itself then), its pane is
                   put aside (shell.js `hidden`: it waits, and reads at once when the pane comes back) or the page is hidden. Mounting el again with another market switches cleanly: every read is tagged with the market it was asked for,
                   and an answer for a market no longer showing is dropped. `priceStep` (the market's own tick) sets the prices' precision
                   and the grouping offered (1×, 10×, 100× the tick); `kind: "event"` shows prices in cents. Pressing a row of the ladder
                   calls onPrice(price), the price in the market's quote (an event contract's in dollars: 0.62), which the ticket takes as
                   its limit price. `rows`: how many rows a side the ladder draws; without it, as many whole rows as the panel's height
                   holds (worked out when it is mounted and when its size changes, never as data arrives), so no row is ever cut
     bkRelease(el) stops it: its timers, and any answer still on its way is dropped
   The pure parts, for the tests and anything else that draws a book: bkGroup · bkLadder · bkSpread · bkSpreadWords · bkTopLine · bkPrice ·
   bkSize · bkClock · bkGroups. */

/** each mounted panel's state, by its element: the market, the tab, the grouping, what the last reads said, the timers */
const BK = new WeakMap();
/** the elements whose listeners are on already (one set per element, reading BK for the market showing) */
const BK_WIRED = new WeakSet();
/** how often each is read while it shows, how many rows a side the ladder draws, how many trades are asked */
const BK_BOOK_MS = 2000;
const BK_TRADES_MS = 4000;
const BK_ROWS = 9;
const BK_TRADES = 30;
/** a row's height, and what the book's pane holds besides its two halves — the head (37), the column heads (26), the spread row (28) and room
 * for the quiet line (30) — as book.css draws them: how many rows a side fit is worked out from these */
const BK_ROW_PX = 20;
const BK_CHROME_PX = 37 + 26 + 28 + 30;

// ---- the pure parts --------------------------------------------------------------------------------------------------------------------

/** the decimal places a step is written in (0.01 → 2, 0.5 → 1, 10 → 0); none known → undefined */
function bkDecimals(step) {
  // to twelve figures first: 0.07 × 100 is 7.000000000000001 in binary, and has no fifteen decimals
  const s = Number(Number(step).toPrecision(12));
  if (!(s > 0) || !Number.isFinite(s)) return undefined;
  const [m, e] = s.toExponential().split("e");
  return Math.max(0, (m.split(".")[1] || "").length - Number(e));
}

/** the groupings a market's tick allows: 1×, 10× and 100× it — an event contract's only while a group stays under a dollar (10¢ at most for
 * a 1¢ tick: a 100¢ row would be the whole book). None without a tick */
function bkGroups(step, kind) {
  const s = Number(step);
  if (!(s > 0) || !Number.isFinite(s)) return [];
  return [1, 10, 100].filter((k) => k === 1 || kind !== "event" || k * s < 1 - 1e-12);
}

/** One side of a book grouped to `g` (a price: the tick times the grouping): each bid's price floored to the group and each ask's ceiled — so
 * a group's row never shows a better price than any level in it — and the sizes inside a group summed. The source's own levels, added up:
 * nothing made up. `g` not above 0: the levels as they are. Best first — the highest bid, the lowest ask — whatever order they came in.
 * `goesOn`: the side may hold levels past the worst one sent (OrderBook.more). Then the group holding that worst level is only PART of its
 * range — the levels further out in it were never read — unless that level sits on the group's far edge (a bid at the group's own floor, an
 * ask at its own ceiling), where nothing unread can fall inside: that row is marked as part (a third element, true), and its sum is what was
 * read of it, never the whole */
function bkGroup(levels, side, g, goesOn = false) {
  const rows = Array.isArray(levels) ? levels.filter((l) => Array.isArray(l) && Number(l[0]) > 0) : [];
  const best = (a, b) => (side === "bids" ? b[0] - a[0] : a[0] - b[0]);
  if (!(g > 0)) return rows.map((l) => [Number(l[0]), l[1] === null || l[1] === undefined ? null : Number(l[1])]).sort(best);
  const dec = bkDecimals(g) ?? 8;
  const out = [];
  const at = new Map();
  let worst;
  for (const [p, s] of rows) {
    const n = Number(p);
    if (worst === undefined || (side === "bids" ? n < worst : n > worst)) worst = n;
    const k = side === "bids" ? Math.floor(n / g + 1e-9) : Math.ceil(n / g - 1e-9);
    const price = Number((k * g).toFixed(dec));
    const size = s === null || s === undefined ? null : Number(s);
    if (!at.has(price)) {
      at.set(price, out.length);
      out.push([price, size]);
    } else {
      const row = out[at.get(price)];
      row[1] = row[1] === null || size === null ? (row[1] ?? size) : row[1] + size;
    }
  }
  out.sort(best);
  const last = out[out.length - 1];
  if (goesOn && last && Math.abs(last[0] - worst) > g * 1e-9) last.push(true);
  return out;
}

/** the spread between the best bid and the best ask as the source sent them (never between grouped rows): in the market's quote — to no
 * more decimals than the two prices have between them, so a difference of large numbers carries no binary tail (100000.0001 − 100000 is
 * 0.0001, not 0.0000999999974) — and in percent of their middle; nothing while either side is empty */
function bkSpread(book) {
  const bid = book && Array.isArray(book.bids) && book.bids[0] ? Number(book.bids[0][0]) : NaN;
  const ask = book && Array.isArray(book.asks) && book.asks[0] ? Number(book.asks[0][0]) : NaN;
  if (!(bid > 0) || !(ask > 0)) return null;
  const dec = Math.min(12, Math.max(bkDecimals(bid) ?? 12, bkDecimals(ask) ?? 12));
  const abs = Number((ask - bid).toFixed(dec));
  return { abs, pct: (abs / ((ask + bid) / 2)) * 100 };
}

/** a price as the market writes it: in cents for an event contract (62¢, 62.5¢ on a tenth-of-a-cent tick), else to the decimals of its tick
 * times the grouping — but never to fewer than the price itself needs: a level finer than the tick the market states (a 0.999 bid where a
 * paper account says 0.01, a Polymarket market on a 0.001 tick) is printed whole, never rounded to look like another price. Its own decimals
 * are counted with no binary tails, at most eight in dollars (six in cents). No tick known: an event contract's in whole cents unless the
 * price needs more, anything else as it came (core.js px) */
function bkPrice(p, o, g) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "—";
  const step = Number(o && o.priceStep) > 0 ? Number(o.priceStep) * (g || 1) : undefined;
  const own = (x) => (x === 0 ? 0 : (bkDecimals(Math.abs(x)) ?? 0));
  if (o && o.kind === "event") {
    const c = n * 100;
    const dec = Math.min(6, Math.max(step !== undefined ? (bkDecimals(step * 100) ?? 0) : 0, own(c)));
    return `${c.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}¢`;
  }
  if (step === undefined) return px(n);
  const dec = Math.min(8, Math.max(bkDecimals(step) ?? 0, own(n)));
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** a size in the units an order is sized in there, as the source gave it — to eight decimals, with no binary tails (a sum of sizes is held
 * to twelve figures) — never cut to fit; none given: a dash */
function bkSize(s) {
  if (s === null || s === undefined || s === "") return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  return Number(n.toPrecision(12)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** a moment on the viewer's own clock, HH:MM:SS */
function bkClock(iso) {
  const ms = typeof iso === "number" ? iso : Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const two = (x) => String(x).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** The ladder from one book: at most `rows` rows a side, grouped to `group` (a price; 0: not grouped) by bkGroup — a group at the far end of
 * a side that may go on marked `part` — each with its running total from the best outward and its bar's share — the running total over the largest running total drawn on either side, so the two sides compare. The offers
 * come in the order they are drawn (the worst at the top, the best ask last, nearest the middle); the bids best first. A book of depth "top"
 * is never grouped: its two prices are the source's best bid and ask, as they are */
function bkLadder(book, { rows = BK_ROWS, group = 0 } = {}) {
  const top = !!book && book.depth === "top";
  const g = top ? 0 : group;
  // a side may go on past what was sent unless the source said it sent everything (OrderBook.more); not said: taken as may go on
  const more = (side) => !(book && book.more && book.more[side] === false);
  const asks = bkGroup(book && book.asks, "asks", g, more("asks")).slice(0, rows);
  const bids = bkGroup(book && book.bids, "bids", g, more("bids")).slice(0, rows);
  // a row that is only part of its range (bkGroup) is the last of its side: its size, and the running total through it, are "at least"
  const run = (side) => {
    let t = 0;
    let known = true;
    return side.map(([p, s, part]) => {
      if (s === null || s === undefined) known = false;
      else t += s;
      return { p, s, t: known ? Number(t.toPrecision(12)) : null, ...(part ? { part: true } : {}) };
    });
  };
  const a = run(asks);
  const b = run(bids);
  const most = Math.max(0, ...[...a, ...b].map((r) => (r.t === null ? 0 : r.t)));
  const share = (r) => (r.t !== null && most > 0 ? r.t / most : 0);
  return { asks: a.map((r) => ({ ...r, w: share(r) })).reverse(), bids: b.map((r) => ({ ...r, w: share(r) })), spread: bkSpread(book), top };
}

/** the spread row's words: "Spread 1.0 · 0.0012%" (an event contract's in cents); a dash while a side is empty */
function bkSpreadWords(book, o) {
  const s = bkSpread(book);
  if (!s) return book && ((book.bids || []).length || (book.asks || []).length) ? "Spread — · one side of the book is empty" : "Spread —";
  // two figures that count below one percent, never in exponent notation (a spread of a ten-millionth of a percent is "0.0000001%")
  const pct = Math.abs(s.pct) >= 1 ? s.pct.toFixed(2) : s.pct.toLocaleString("en-US", { maximumSignificantDigits: 2, useGrouping: false });
  return `Spread ${bkPrice(s.abs, o, 1)} · ${pct}%`;
}

/** a top-of-book quote older than this has its time said in the quiet line */
const BK_OLD_MS = 5000;
/** The quiet line under a book of its best bid and ask only: whose quote it is, in its own name, and why that is all — the source gives no
 * depth at all (OrderBook.topOnly "none": a US stock's public quote), or the account does not read the depth it has ("unread", or not said:
 * an exchange's pre-IPO contract, a venue connected whose book is not read) — and how old it is: the time it is from, once that is more
 * than a few seconds ago, or, for a quote with no time of its own taken from a list kept a while, how long that list is kept. An old
 * quote is never taken for a live book */
function bkTopLine(book, now = Date.now()) {
  if (!book || book.depth !== "top") return "";
  const from = book.from || "its source";
  const why = book.topOnly === "none" ? `${from} gives no depth` : `the account reads no depth from ${from}`;
  // a quote with no time of its own, from a list kept a while (OrderBook.upToMs): how old it may be; else its own time, once it is old
  const upTo = Number(book.upToMs);
  const at = Date.parse(String(book.at || ""));
  const old = upTo > BK_OLD_MS ? ` · from a list kept up to ${Math.round(upTo / 1000)} s` : Number.isFinite(at) && now - at > BK_OLD_MS ? ` · quoted at ${bkClock(at)}` : "";
  return `Best bid and ask only: ${why}${old}`;
}

// ---- drawing ----------------------------------------------------------------------------------------------------------------------------

/** the panel's frame for one market: its head (the tabs, the grouping), the book's pane and the trades' pane — drawn once per market; the
 * parts inside are drawn as the reads come. Keyed by the market, so another market's frame replaces it whole */
function bkFrame(st) {
  const o = st.o;
  const groups = bkGroups(o.priceStep, o.kind);
  const unit = o.kind === "event" ? "" : o.quote ? ` (${esc(o.quote)})` : "";
  const size = o.base ? ` (${esc(o.base)})` : "";
  const select = groups.length > 1 ? `<label class="bk-gw"><span class="sr">Group prices by</span><select class="bk-group" data-bk-group>${groups.map((k) => `<option value="${k}"${k === st.group ? " selected" : ""}>${esc(bkPrice(k * Number(o.priceStep), o, k))}</option>`).join("")}</select></label>` : "";
  return `<div class="bk" data-k="bk:${esc(st.key)}">
<div class="bk-head"><div class="bk-tabs" role="tablist" aria-label="Order book or trades"><button type="button" role="tab" class="bk-tab" data-bk-tab="book" aria-selected="true">Order book</button><button type="button" role="tab" class="bk-tab" data-bk-tab="trades" aria-selected="false">Trades</button></div>${select}</div>
<div class="bk-pane" data-bk-pane="book" role="tabpanel"><div class="bk-cols" aria-hidden="true"><span>Price${unit}</span><span>Size${size}</span><span>Total${size}</span></div><div class="bk-asks" data-bk-asks></div><div class="bk-mid" data-bk-mid><span class="bk-wait">Reading the book…</span></div><div class="bk-bids" data-bk-bids></div><p class="bk-note" data-bk-note></p></div>
<div class="bk-pane" data-bk-pane="trades" role="tabpanel" hidden><div class="bk-cols" aria-hidden="true"><span>Price${unit}</span><span>Size${size}</span><span>Time</span></div><div class="bk-tape" data-bk-tape><p class="bk-wait">Reading the trades…</p></div></div>
</div>`;
}

/** one row of the ladder: its bar (its running total's share), its price, its size, its running total; a button that hands its price on */
function bkRowHtml(r, side, o, g) {
  const p = bkPrice(r.p, o, g);
  const w = Math.max(0, Math.min(1, r.w || 0));
  // a row that is only part of its range: its size and its running total are what was read of it, at least that much ("≥"), and it says so
  const least = r.part ? "≥\u2009" : "";
  const title = r.part ? `Use ${p} as the limit price · only part of this range was read: at least this much rests here` : `Use ${p} as the limit price`;
  return `<div class="bk-row bk-${side}${r.part ? " bk-part" : ""}" role="button" tabindex="0" data-k="${side}:${esc(String(r.p))}${r.part ? ":part" : ""}" data-bk-px="${esc(String(r.p))}" title="${esc(title)}"><span class="bk-bar" style="transform:scaleX(${Number(w.toFixed(4))})"></span><span class="bk-p">${esc(p)}</span><span class="bk-s">${least}${esc(bkSize(r.s))}</span><span class="bk-t">${least}${esc(bkSize(r.t))}</span></div>`;
}

/** the book's pane drawn from what the last read said: the ladder, the spread row, the quiet line — or the refusal's words in the middle */
function bkDrawBook(el, st) {
  const part = (sel) => el.querySelector(sel);
  const asks = part("[data-bk-asks]");
  const bids = part("[data-bk-bids]");
  const mid = part("[data-bk-mid]");
  const note = part("[data-bk-note]");
  if (st.bookNo) {
    paint(asks, "");
    paint(bids, "");
    paint(mid, `<span class="${st.bookNo.quiet ? "bk-wait" : "bk-no"}" role="status">${esc(st.bookNo.words)}</span>`);
    paint(note, "");
    return;
  }
  const book = st.book;
  if (!book) return;
  // grouped only above 1× the tick: at 1× every level shows at its own price, as the source sent it
  const g = book.depth === "top" ? 1 : st.group;
  const step = Number(st.o.priceStep);
  const lad = bkLadder(book, { rows: st.rows, group: g > 1 && step > 0 ? Number((g * step).toPrecision(12)) : 0 });
  const shown = g;
  paint(asks, lad.asks.map((r) => bkRowHtml(r, "ask", st.o, shown)).join(""));
  paint(bids, lad.bids.map((r) => bkRowHtml(r, "bid", st.o, shown)).join(""));
  paint(mid, !lad.asks.length && !lad.bids.length ? '<span class="bk-wait">No orders on the book just now</span>' : `<span class="bk-spread">${esc(bkSpreadWords(book, st.o))}</span>`);
  paint(note, esc(bkTopLine(book)));
  bkGroupShown(el, st);
}

/** the trades' pane: time, price (coloured by the side that took it, where the source says, with the side in words for a screen reader),
 * size — or the refusal's words */
function bkDrawTrades(el, st) {
  const tape = el.querySelector("[data-bk-tape]");
  if (st.tradesNo) return void paint(tape, `<p class="${st.tradesNo.quiet ? "bk-wait" : "bk-no"}" role="status">${esc(st.tradesNo.words)}</p>`);
  if (!st.trades) return;
  if (!st.trades.length) return void paint(tape, '<p class="bk-wait">No trades just now</p>');
  paint(
    tape,
    st.trades
      .map((t, i) => {
        const side = t.side === "buy" ? "buy" : t.side === "sell" ? "sell" : "";
        return `<div class="bk-trow" data-k="t${i}"><span class="bk-p${side ? ` bk-${side}` : ""}">${esc(bkPrice(t.price, st.o, 1))}${side ? `<span class="sr"> ${side === "buy" ? "bought" : "sold"}</span>` : ""}</span><span class="bk-s">${esc(bkSize(t.size))}</span><span class="bk-t">${esc(bkClock(t.at))}</span></div>`;
      })
      .join(""),
  );
}

/** the tab showing, on the tabs and the panes (set directly: the frame is not drawn again for it) */
function bkShowTab(el, st) {
  for (const b of el.querySelectorAll("[data-bk-tab]")) b.setAttribute("aria-selected", String(b.dataset.bkTab === st.tab));
  for (const p of el.querySelectorAll("[data-bk-pane]")) p.hidden = p.dataset.bkPane !== st.tab;
  bkGroupShown(el, st);
}

/** the grouping is the book's: it stands aside while the trades show, and for a book of its best bid and ask only (nothing to group) */
function bkGroupShown(el, st) {
  const gw = el.querySelector(".bk-gw");
  if (gw) gw.hidden = st.tab !== "book" || !!(st.book && st.book.depth === "top");
}

/** a refusal's words in the panel: a source that publishes no book or no trades (E_VENUE_RAIL_CLOSED) said quietly, as a fact of the
 * source; any other refusal — a place rule, no answer — in the warning colour */
function bkSaid(body, fallback) {
  const words = refusalOf(body) || fallback;
  const quiet = !!(body && body.refusal && body.refusal.code === "E_VENUE_RAIL_CLOSED");
  return { words, quiet };
}

// ---- reading -----------------------------------------------------------------------------------------------------------------------------

/** How many rows a side fit the panel: the ladder's halves are drawn a whole number of rows high (book.css, --bk-n), the panel's own box
 * fills its place without its rows pushing it taller, so the count follows the place and never the data. Rows the caller gave stand. True
 * when the count changed */
function bkFit(el, st) {
  if (st.fixed) return false;
  // only in a column of a flexbox (the terminal's .tt-book), where the panel takes its place's height and adds none of its own: anywhere
  // else its height would be its rows', and fitting rows to it would only ever shrink them
  let host = null;
  try {
    host = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  } catch {
    host = null;
  }
  if (!host || !String(host.display).includes("flex") || !String(host.flexDirection).startsWith("column")) return false;
  const root = el.querySelector(".bk");
  const h = root ? Number(root.clientHeight) : NaN;
  if (!(h > 0)) return false;
  const n = Math.max(3, Math.min(25, Math.floor((h - BK_CHROME_PX) / (2 * BK_ROW_PX))));
  if (root.style && typeof root.style.setProperty === "function") root.style.setProperty("--bk-n", String(n));
  if (n === st.rows) return false;
  st.rows = n;
  return true;
}

/** the panel is laid out: it has a box on the page. A pane the page has put aside (shell.js hides a pane with `hidden` when the owner moves
 * to another, and keeps it in the document) has none, and neither has anything inside it — as chart.js chLaidOut asks. An element that
 * cannot say is taken as laid out */
function bkLaidOut(el) {
  return typeof el.getClientRects !== "function" || el.getClientRects().length > 0;
}

/** the panel may read now: it is the one mounted for its market, in the document, laid out (its pane not put aside) and the page shows. A
 * panel found out of the document on one of its beats has been taken off the page: it stops itself (`letGo`; not while it is being
 * mounted, which may come before its element is placed). A panel in a pane put aside only waits: its beats go on, asking nothing, and it
 * reads again once its pane comes back */
function bkLive(el, st, letGo = true) {
  if (!st.alive || BK.get(el) !== st) return false;
  if (el.isConnected === false) {
    if (letGo) bkRelease(el);
    return false;
  }
  if (!bkLaidOut(el)) return false;
  return !(typeof document !== "undefined" && document.visibilityState === "hidden");
}

/** one read of the book for the market this state is for: an answer that comes back after the panel moved to another market (or was
 * released), or after a later read already drew, is dropped */
async function bkReadBook(el, st) {
  const ask = ++st.bookAsked;
  const depth = st.group > 1 ? 50 : 20;
  const body = await api(`/api/account/book?${new URLSearchParams({ venue: st.o.venue, symbol: st.o.symbol, depth: String(depth) })}`);
  if (BK.get(el) !== st || !st.alive || ask < st.bookDrawn) return;
  st.bookDrawn = ask;
  if (body && body.ok && body.book) {
    st.book = body.book;
    st.bookNo = null;
  } else {
    st.book = null;
    st.bookNo = bkSaid(body, "The book could not be read just now");
  }
  bkDrawBook(el, st);
}

/** one read of the latest trades, on the same terms */
async function bkReadTrades(el, st) {
  const ask = ++st.tradesAsked;
  const body = await api(`/api/account/trades?${new URLSearchParams({ venue: st.o.venue, symbol: st.o.symbol, limit: String(BK_TRADES) })}`);
  if (BK.get(el) !== st || !st.alive || ask < st.tradesDrawn) return;
  st.tradesDrawn = ask;
  if (body && body.ok && Array.isArray(body.trades)) {
    st.trades = body.trades;
    st.tradesNo = null;
  } else {
    st.trades = null;
    st.tradesNo = bkSaid(body, "The trades could not be read just now");
  }
  bkDrawTrades(el, st);
}

/** the next read of `what` in `ms`, while the panel lives; a read only while its tab shows and the page is visible */
function bkLoop(el, st, what, ms) {
  const tick = () => {
    if (!st.alive || BK.get(el) !== st) return;
    if (bkLive(el, st) && st.tab === what) void (what === "book" ? bkReadBook(el, st) : bkReadTrades(el, st)).catch(() => undefined);
    if (st.alive) st.timers[what] = setTimeout(tick, ms);
  };
  st.timers[what] = setTimeout(tick, ms);
}

/** the panel's listeners, once per element: a tab pressed, the grouping changed, a row of the ladder pressed (or Enter / Space on it) */
function bkWire(el) {
  if (BK_WIRED.has(el) || typeof el.addEventListener !== "function") return;
  BK_WIRED.add(el);
  const press = (target) => {
    const st = BK.get(el);
    if (!st || !target || typeof target.closest !== "function") return false;
    const tab = target.closest("[data-bk-tab]");
    if (tab && el.contains(tab)) {
      const want = tab.dataset.bkTab === "trades" ? "trades" : "book";
      if (want !== st.tab) {
        st.tab = want;
        bkShowTab(el, st);
        // the tab coming in is read at once, then on its own beat
        void (want === "book" ? bkReadBook(el, st) : bkReadTrades(el, st)).catch(() => undefined);
      }
      return true;
    }
    const row = target.closest("[data-bk-px]");
    if (row && el.contains(row)) {
      const p = Number(row.dataset.bkPx);
      if (p > 0 && typeof st.o.onPrice === "function") st.o.onPrice(p);
      return true;
    }
    return false;
  };
  el.addEventListener("click", (e) => void press(e.target));
  el.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.dataset && e.target.dataset.bkPx !== undefined && press(e.target)) e.preventDefault();
  });
  el.addEventListener("change", (e) => {
    const st = BK.get(el);
    const sel = e.target;
    if (!st || !sel || !sel.matches || !sel.matches("[data-bk-group]")) return;
    const k = Number(sel.value);
    st.group = k >= 1 ? k : 1;
    bkDrawBook(el, st);
    void bkReadBook(el, st).catch(() => undefined);
  });
}

/** Draw the panel into `el` for one market and keep it fresh (see the top of this file). Mounting the same element again — another market,
 * the same one — starts afresh: what was on its way for the market before is dropped */
function bkMount(el, o) {
  if (!el || !o || !o.venue || !o.symbol) return;
  bkRelease(el);
  const fixed = Number.isInteger(o.rows) && o.rows > 0 && o.rows <= 50;
  const st = { key: `${o.venue}|${o.symbol}`, o, rows: fixed ? o.rows : BK_ROWS, fixed, tab: "book", group: 1, book: null, bookNo: null, trades: null, tradesNo: null, bookAsked: 0, bookDrawn: 0, tradesAsked: 0, tradesDrawn: 0, timers: {}, alive: true, watch: null };
  BK.set(el, st);
  paint(el, bkFrame(st));
  bkShowTab(el, st);
  // the rows a side: the caller's, else as many as the panel holds — and again whenever its size changes, the book drawn again from what
  // was read (nothing is asked for it)
  const root = el.querySelector(".bk");
  if (fixed && root && root.style && typeof root.style.setProperty === "function") root.style.setProperty("--bk-n", String(st.rows));
  bkFit(el, st);
  // its size watched: the rows refitted, and — its pane coming back after being put aside (its box from none to some) — the tab showing
  // read at once, not on its next beat
  st.shown = bkLaidOut(el);
  if (typeof ResizeObserver === "function") {
    st.watch = new ResizeObserver(() => {
      if (BK.get(el) !== st) return;
      if (bkFit(el, st)) bkDrawBook(el, st);
      const was = st.shown;
      st.shown = bkLaidOut(el);
      if (st.shown && !was && bkLive(el, st)) void (st.tab === "book" ? bkReadBook(el, st) : bkReadTrades(el, st)).catch(() => undefined);
    });
    st.watch.observe(el);
  }
  const sel = el.querySelector("[data-bk-group]");
  if (sel) sel.value = "1";
  bkWire(el);
  if (bkLive(el, st, false)) void bkReadBook(el, st).catch(() => undefined);
  bkLoop(el, st, "book", BK_BOOK_MS);
  bkLoop(el, st, "trades", BK_TRADES_MS);
}

/** Stop the panel in `el`: its timers, and whatever is on its way is dropped. What it drew stays until something else is drawn there */
function bkRelease(el) {
  const st = el ? BK.get(el) : undefined;
  if (!st) return;
  st.alive = false;
  for (const t of Object.values(st.timers)) clearTimeout(t);
  if (st.watch) st.watch.disconnect();
  BK.delete(el);
}
