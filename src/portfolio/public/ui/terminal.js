/* THE TRADE TERMINAL — the Trade pane laid out as Hyperliquid lays its own trading screen (app.hyperliquid.xyz/trade, measured in the
   scratchpad's hl-reference.md): dark panels three pixels apart on a lighter ground — the market bar over the chart on the left (the
   market, its price, its 24 hours, its funding or its session), the order book and the latest trades beside them (ui/book.js), the order
   panel on the right (the ticket, ui/trade.js), and under them what is held, what is open, what filled and every order placed; at the very
   foot a thin status strip (which accounts trade from here, and a read of the bar's market that failed). The market is picked from the bar:
   it opens the kinds and their lists (the picker, ui/trade.js) in a popover laid over the panels, never pushing them down.

   Whether the owner trades here or watches the account's desk trade a paper account by itself is the topbar's switch (account.html
   #trade-mode, Regular · Superagent, shell.js): one switch for both panes, so this frame draws none of its own.

   The layout follows the terminal's own width, not the window's (container queries in terminal.css): three columns — the chart taking the
   rest, the book and the order panel the same width as each other — once the terminal is 1080 pixels wide; the chart over the order panel
   and the book side by side below that; and under 560 one column, the chart and the book sharing one panel behind three tabs (Chart ·
   Order book · Trades, as HL's phone layout has them) so the order panel follows directly. Both stay mounted; the tabs only hide one. At
   three columns the terminal fits the window as HL's does (ttFit): the grid sized from what sits outside it, the tables under it the rest,
   scrolling inside under their heads, the status strip at the window's foot — the page itself does not scroll at 1500 × 900. The bar's
   figures are shown whole or not at all (ttFitStats), and the tables' prices are written as their market writes them (ttFig).

   It draws nothing of its own about a market that its sources did not say: the bar's figures are the market's as its venue lists it
   (GET /api/account/market, read again every five seconds while the pane is showing — its beat goes on while another pane shows, asking
   nothing, so the figures are fresh again within a beat of coming back) and its row's — until an account is chosen for it, the row read
   again on the same beat; a figure no source gave is not shown, and a read that failed says so, with when the figures showing were read.
   Every button does what it says through the ticket, the book or the account's own door. */

/* the terminal's state: the market showing (its Markets row and that row as last read again, where it is traded, the market as the venue
   lists it, when that was last read, why the last read failed and how many reads in a row have — the beat waits longer after each: ttWaitMs),
   how many positions the last read listed (said on their tab), the tab under the panels, the market the chart and the book were mounted
   on, whether a market has shown on this frame or a ticket was opened on purpose (from then on nothing picks one by itself: ui/trade.js
   tkTicket says so as a ticket opens, tkReopenDraft while a kept ticket's market is read), and the bar's read timer */
const TT = { item: null, row: null, kind: "", at: null, mk: null, readAt: 0, said: "", fails: 0, posN: 0, tab: "positions", m: "chart", mounted: "", started: false, timer: 0, seq: 0 };
/* the tabs under the panels, as HL names its own: what is held, what rests on a book, what filled, and every order with what became of it */
const TT_TABS = [["positions", "Positions"], ["open", "Open orders"], ["history", "Trade history"], ["orders", "Order history"]];
/* the three tabs a narrow terminal shows the chart and the book behind (one panel), so the order panel follows the chart directly */
const TT_MTABS = [["chart", "Chart"], ["book", "Order book"], ["trades", "Trades"]];
const TT_READ_MS = 5_000;
/* a read of the bar's market that did not come back is asked again later each time it fails — ten seconds, then twenty, forty, at most a
   minute apart — and on the five-second beat again once one is answered: a stopped account is not asked every five seconds for as long as
   the page is open */
const TT_READ_MAX_MS = 60_000;

/** the pane's frame: the grid (the bar, the picker's popover — hidden, laid over the panels, next to its button in the order the keys
 * reach it — the narrow terminal's three tabs, the chart, the book, the order panel), the tabs under it, the status strip at its foot */
function ttFrame() {
  return `<div class="tt" data-tp data-tt-m="${esc(TT.m)}">
    <div class="tt-grid">
      <div class="tt-bar">
        <button type="button" class="tt-mkt" data-tt-pick aria-expanded="false" aria-controls="tt-pop"><span class="tt-av" data-tt-av></span><span class="tt-name" data-tt-name>Pick a market</span>${icon("chevron", "sm")}</button>
        <span class="tt-tags" data-tt-tags></span>
        <div class="tt-stats tab-nums" data-tt-stats></div>
      </div>
      <div class="tt-pop" id="tt-pop" data-tt-pop role="dialog" aria-label="Pick a market" hidden>
        <div data-tp-note></div>
        <div class="seg tk-seg" role="group" aria-label="Market kind" data-tp-kinds></div>
        <section class="tk-pick" data-tp-pick aria-labelledby="tp-pick-h"></section>
      </div>
      <div class="tt-mtabs" role="tablist" aria-label="Chart, order book or trades" data-tt-mtabs>${TT_MTABS.map(([v, t]) => `<button type="button" role="tab" data-tt-m="${v}" aria-selected="${String(TT.m === v)}">${esc(t)}</button>`).join("")}</div>
      <section class="tt-chart" data-tt-chart aria-label="Chart"></section>
      <section class="tt-book" data-tt-book aria-label="Order book and trades"></section>
      <aside class="tt-order tk-panel" id="tk-panel" aria-label="Order"></aside>
    </div>
    <section class="tt-low" aria-label="Positions, open orders, trade history and order history">
      <div class="tt-tabs" role="tablist" data-tt-tabs></div>
      <div class="tt-tab" data-tt-tab="positions"></div>
      <section class="tt-tab" data-tt-tab="open" data-tp-open aria-labelledby="tp-open-h" hidden></section>
      <div class="tt-tab" data-tt-tab="history" hidden></div>
      <div class="tt-tab" data-tt-tab="orders" hidden></div>
    </section>
    <div class="tt-foot"><span class="tp-state" data-tp-state></span><p class="tt-said" data-tt-said role="status"></p></div>
  </div>`;
}

/* the picker's panel and the market button of the frame on the page now: a frame drawn again (the pane redrawn after an error put its
   words there) is a new one, so they are looked up each time, never kept */
function ttPopParts() {
  const pane = $("pane-trade");
  const tp = pane && pane.querySelector("[data-tp]");
  const pop = tp && tp.querySelector("[data-tt-pop]");
  const btn = tp && tp.querySelector("[data-tt-pick]");
  return pop && btn ? { pop, btn } : null;
}
/* the picker's panel opened (its search takes the cursor) or closed */
function ttSetPop(open) {
  const x = ttPopParts();
  if (!x) return;
  x.pop.hidden = !open;
  x.btn.setAttribute("aria-expanded", String(open));
  if (open) {
    const input = x.pop.querySelector("input[type='search']");
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 0);
  }
}
TT.closePicker = () => ttSetPop(false);

/** the frame's buttons, heard once per frame — the market button opens and closes the picker's panel, a market picked in it closes it, the
 * tabs — so a frame drawn again is heard as the first was; Escape and a click outside the panel close it, heard once on the page. And the
 * sizes the frame is laid out from, watched: the bar's room for its figures (ttFitStats), the tab bars' (their sliding lines), and once for
 * the page the main column's (the fit to the window, ttFit) */
function ttWire(el) {
  const tp = el.querySelector("[data-tp]");
  if (!tp || tp.ttWired) return;
  tp.ttWired = true;
  const pop = tp.querySelector("[data-tt-pop]");
  const btn = tp.querySelector("[data-tt-pick]");
  btn.addEventListener("click", () => ttSetPop(pop.hidden));
  // a market picked in the panel closes it (the ticket opens on it: ttSetItem below)
  pop.addEventListener("click", (e) => {
    const row = e.target.closest && e.target.closest(".tk-list button[data-i]");
    if (row) setTimeout(() => ttSetPop(false), 0);
  });
  const tabs = tp.querySelector("[data-tt-tabs]");
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-tt-to]");
    if (!b || TT.tab === b.dataset.ttTo) return;
    TT.tab = b.dataset.ttTo;
    ttLow(el, owns());
  });
  // a narrow terminal's Chart · Order book · Trades (shown only under 560 pixels: terminal.css)
  const mtabs = tp.querySelector("[data-tt-mtabs]");
  if (mtabs) mtabs.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-tt-m]");
    if (b) ttShowM(tp, b.dataset.ttM);
  });
  // the bar's figures fitted again whenever the room for them changes (the window, the rail, the market's name): its own box watched
  const stats = tp.querySelector("[data-tt-stats]");
  if (stats && typeof ResizeObserver === "function") new ResizeObserver(() => ttFitStats(stats)).observe(stats);
  // the line under the tables' tab showing and the narrow terminal's (book.js bkSlideUnder) follows its tab when a bar's size changes (the
  // narrow tabs share the width; a phone turned) and once the page's own font has come (every tab's width changes with it)
  const under = () => {
    if (typeof bkSlideUnder !== "function") return;
    bkSlideUnder(tabs);
    if (mtabs) bkSlideUnder(mtabs);
    ttTypesUnder();
  };
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(under);
    ro.observe(tabs);
    if (mtabs) ro.observe(mtabs);
  }
  if (typeof document !== "undefined" && document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") document.fonts.ready.then(under);
  if (TT.docHeard) return;
  TT.docHeard = true;
  // the terminal fitted to the window again whenever the page's main column changes size — a banner coming or going over it, the window
  // resized — once for the page, on whichever frame is drawn then
  const main = typeof tp.closest === "function" ? tp.closest(".main") : null;
  // and the order panel's type tabs share its width, which follows the window's: the line under the type showing follows its tab
  if (main && typeof ResizeObserver === "function") new ResizeObserver(() => {
    ttFit($("pane-trade"));
    ttTypesUnder();
  }).observe(main);
  document.addEventListener("keydown", (e) => {
    const x = ttPopParts();
    if (e.key === "Escape" && x && !x.pop.hidden) {
      ttSetPop(false);
      x.btn.focus();
    }
  });
  document.addEventListener("click", (e) => {
    const x = ttPopParts();
    if (!x || x.pop.hidden) return;
    const t = e.target;
    if (t && (x.pop.contains(t) || x.btn.contains(t))) return;
    ttSetPop(false);
  });
}

/* the line under the order panel's type showing (ui/trade.js drawTypes, book.js bkSlideUnder), measured again: the panel's width changed */
function ttTypesUnder() {
  const pane = $("pane-trade");
  const types = pane && typeof pane.querySelector === "function" ? pane.querySelector(".tt-order [data-otabs]") : null;
  if (types && typeof bkSlideUnder === "function") bkSlideUnder(types, typeof TK_OTAB_ON === "string" ? TK_OTAB_ON : undefined);
}

/** THE FIT. At 1080 pixels wide and more the terminal fills the window as HL's does (terminal.css: the grid as tall as the window leaves it
 * once what sits outside it has its room, the tables what is left, the status strip at the window's foot). What sits above it — the topbar,
 * a banner the page shows over it, the gutters — is measured here into --tt-top, and the page's gutter under it into --tt-below: each time
 * the pane is drawn, and whenever the page's main column changes size (ttWire). A value is written only when it changed, so nothing is laid
 * out again for nothing; a pane put aside (no box) is not measured, and a page that cannot measure keeps the stylesheet's own (the topbar's
 * 56 and the gutters) */
function ttFit(el) {
  const tt = el && typeof el.querySelector === "function" ? el.querySelector(".tt") : null;
  if (!tt || typeof tt.getBoundingClientRect !== "function" || !tt.style || typeof tt.style.setProperty !== "function") return;
  if (typeof tt.getClientRects === "function" && !tt.getClientRects().length) return;
  const top = Math.max(0, Math.round(tt.getBoundingClientRect().top + (Number(window.scrollY) || 0)));
  const main = typeof tt.closest === "function" ? tt.closest(".main") : null;
  let below = 0;
  try {
    below = main && typeof getComputedStyle === "function" ? Math.round(parseFloat(getComputedStyle(main).paddingBottom) || 0) : 0;
  } catch {
    below = 0;
  }
  const want = `${top}|${below}`;
  if (tt.ttFitted === want) return;
  tt.ttFitted = want;
  tt.style.setProperty("--tt-top", `${top}px`);
  tt.style.setProperty("--tt-below", `${below}px`);
}

/** The bar's figures, as many as fit WHOLE: every figure is shown, then — while the strip is wider than its room — the least needed is set
 * aside (`hidden`), one at a time, until the rest fit: bid · ask first (the book beside it says them), then the volume, an event's close, the
 * funding, the session, where the price is from, the change. The price is never set aside. Each figure's place in that order is its
 * data-tt-drop (the higher, the sooner it goes; none: it stays). Run after every paint of the figures and whenever the strip's room changes
 * (ttWire), so a wider window brings them back. A strip with no box (a pane put aside, a page that cannot measure) is left as drawn */
function ttFitStats(box) {
  if (!box || !box.children || typeof box.scrollWidth !== "number") return;
  const all = [...box.children].filter((x) => x && x.dataset && x.dataset.ttDrop !== undefined);
  for (const x of all) if (x.hidden) x.hidden = false;
  if (!(box.clientWidth > 0)) return;
  all.sort((a, b) => Number(b.dataset.ttDrop) - Number(a.dataset.ttDrop));
  for (const x of all) {
    if (box.scrollWidth <= box.clientWidth + 1) break;
    x.hidden = true;
  }
}

/** a narrow terminal's panel shows the chart, the book or the trades: the frame says which (data-tt-m, read by terminal.css), and the book's
 * own tab follows — pressed through the book's own button (ui/book.js hears it), so its reads go on the tab showing and no other. The
 * chart and the book both stay mounted: the one hidden has no box, so it waits and asks nothing (chart.js chLaidOut, book.js bkLaidOut) */
function ttShowM(tp, v) {
  if (!TT_MTABS.some(([x]) => x === v)) return;
  TT.m = v;
  tp.dataset.ttM = v;
  for (const b of tp.querySelectorAll("[data-tt-mtabs] button[data-tt-m]")) b.setAttribute("aria-selected", String(b.dataset.ttM === v));
  if (typeof bkSlideUnder === "function") bkSlideUnder(tp.querySelector("[data-tt-mtabs]"));
  ttBookTab(tp);
}
/* the book's tab as the narrow terminal's tabs want it: Trades for Trades, the ladder otherwise — only once the narrow tabs are the ones
   showing (in a wide terminal the book keeps the tab the owner pressed on it) */
function ttBookTab(tp) {
  if (TT.m === "chart" || !tp) return;
  const want = TT.m === "trades" ? "trades" : "book";
  const mt = tp.querySelector("[data-tt-mtabs]");
  if (!mt || !mt.getClientRects || !mt.getClientRects().length) return;
  const b = tp.querySelector(`[data-tt-book] [data-bk-tab="${want}"]`);
  if (b && b.getAttribute("aria-selected") !== "true" && typeof b.click === "function") b.click();
}

/* a market's name and logo as the bar says it */
const ttLabel = (x) => (!x ? "Pick a market" : x.kind === "event" ? tkName(x) : x.kind === "perp" && !tkPre(x) ? `${x.base || x.name}-PERP` : x.base || x.name);

/** the ticket picked a market (or put it back: null): the bar's name and logo. Once a market has shown on this frame, nothing picks one by
 * itself again (ttDraw): a ticket the owner opened afterwards, on no market, stays as it was opened */
function ttSetItem(item, kind) {
  const el = $("pane-trade");
  // another market: where the last one was traded, its figures and when they were read are not this one's (ttSetMarket says where this one
  // is, once chosen)
  if (!item || !TT.item || item.key !== TT.item.key) {
    TT.at = null;
    TT.mk = null;
    TT.said = "";
    TT.readAt = 0;
    TT.fails = 0;
  }
  // the row the ticket gives is the one it has just read: a row read again before it is not kept over it
  TT.row = null;
  TT.item = item || null;
  TT.kind = kind || TT.kind;
  if (item) TT.started = true;
  if (!el) return;
  const name = el.querySelector("[data-tt-name]");
  if (name) setText(name, ttLabel(item));
  // a name too long for the bar (an event's question) is cut with an ellipsis there: the whole of it on hover
  if (name && "title" in name) name.title = item && item.name && item.name !== ttLabel(item) ? String(item.name) : ttLabel(item);
  const av = el.querySelector("[data-tt-av]");
  if (av) paint(av, item ? avatar(item.kind === "event" ? String(item.category || "Event").slice(0, 4) : item.base || item.name, "sm", ttIconOf(item)) : "");
  ttStats(el);
  // until an account is chosen for it, the chart and the book are its public listing's (or say why there are none), and the bar's figures
  // its row's, read again on the bar's beat (ttPoll); no market, no beat
  if (!TT.at) {
    ttMount(el);
    ttPoll();
  }
}

/* the logo the bar shows for a market: its row's own, else the logo of a row read on this page for the same coin (a perpetual's row comes
   without one; BTC-PERP is BTC's), found the way the picker's rows find theirs (ui/trade.js tkLoaded, tkLogoUrl) — else none, and the
   letters stand */
function ttIconOf(item) {
  if (!item) return "";
  if (typeof tkLogoUrl === "function" && tkLogoUrl(item.icon)) return item.icon;
  if (item.kind === "event" || !item.base || typeof tkLoaded !== "function") return "";
  const base = String(item.base).toUpperCase();
  return (tkLoaded().find((x) => x.kind !== "event" && String(x.base || "").toUpperCase() === base && tkLogoUrl(x.icon)) || {}).icon || "";
}

/* the public listing a market's chart and book are read from while no account of yours is chosen for it: the first public line that names
   its source and its symbol there (Markets' row; read without a key, as Markets reads it) */
const ttPublicAt = (x) => (x && Array.isArray(x.at) ? x.at.find((a) => a.public && a.venue && a.symbol) || null : null);

/** the ticket chose where the order goes and read the market there: the chart and the book follow it (mounted again only when the market
 * or the venue changed), and the bar's figures are its own */
function ttSetMarket(at, mk) {
  const el = $("pane-trade");
  TT.at = at ? { venue: at.venue, symbol: at.symbol, venueName: at.venueName || nameOf(at.venue) } : null;
  TT.mk = mk || null;
  // the ticket has just read it there
  TT.readAt = Date.now();
  TT.said = "";
  TT.fails = 0;
  if (!el) return;
  ttStats(el);
  ttMount(el);
  ttPoll();
}

/* the chart and the book on the market showing: mounted once per market, released when there is none */
function ttMount(el) {
  const chart = el.querySelector("[data-tt-chart]");
  const book = el.querySelector("[data-tt-book]");
  // where the order goes, once chosen; before that, the market's public listing — its source's figures, no account's
  const pub = !TT.at && TT.item ? ttPublicAt(TT.item) : null;
  const at = TT.at || pub;
  const mk = TT.at ? TT.mk : pub ? { kind: TT.item.kind, quote: pub.quote, base: TT.item.base } : null;
  const key = at && mk ? `${at.venue}|${at.symbol}` : TT.item ? `none|${TT.item.key}` : "";
  if (key === TT.mounted) return;
  TT.mounted = key;
  if (!at || !mk) {
    if (typeof chRelease === "function") chRelease(chart);
    if (typeof bkRelease === "function") bkRelease(book);
    paint(chart, `<p class="empty tt-wait">${TT.item ? "No chart is read for it here: choose where to trade it." : "Pick a market: its chart shows here."}</p>`);
    paint(book, `<p class="empty tt-wait">${TT.item ? "No order book is read for it here." : "Its order book and latest trades show here."}</p>`);
    return;
  }
  const base = { venue: at.venue, symbol: at.symbol, kind: mk.kind, quote: mk.quote };
  // the bar size the owner picked stays when the market changes
  if (typeof chMount === "function") chMount(chart, { ...base, priceStep: mk.priceStep, interval: TT.interval || "1h", onInterval: (iv) => (TT.interval = iv) });
  else paint(chart, '<p class="empty tt-wait">The chart is not on this page.</p>');
  // a price pressed in the book is the limit price in the ticket. The book's and the tape's sizes are named in what the venue counts them
  // in (ui/trade.js tkSizeUnit): a contract market's contracts where one is not one coin (OKX's BTC swap, 0.01 BTC each), an event's contracts
  if (typeof bkMount === "function") bkMount(book, { ...base, base: tkSizeUnit(mk), priceStep: mk.priceStep, onPrice: (p) => typeof TK.setLimit === "function" && TK.setLimit(p) });
  else paint(book, '<p class="empty tt-wait">The order book is not on this page.</p>');
  // a book mounted afresh opens on its ladder: a narrow terminal showing Trades turns it to its trades
  ttBookTab(el.querySelector("[data-tp]"));
}

/* the bar's market read again every five seconds while the pane is the one showing: its price, its 24 hours, its funding, its session.
   Until an account is chosen for it, its row is read again instead — the markets read of its kind searched by its name as a search may hold
   it and asked for by its key (ui/trade.js tkQueryOf, tkReadKind: kept 15 s, its own read, so never taken for the kind's own list; the key
   finds the row though twelve busier ones share the first words of its question), the row with its key kept as TT.row — so a market outside
   the busiest of its kind (one found by the picker's search, one opened from Markets) is as fresh as one in that list. While another pane
   shows, or the page is hidden, the beat goes on and asks nothing, so the first beat back on Trade reads it again (the pane is only put
   aside, and nothing else would start the beat again for the market still showing). A read refused, or a markets read that did not list
   the row, keeps the figures showing, said with when they were read and the source's words (ttStats) — the account not answering at all
   (a stopped service, a dropped connection) in the page's own words, never the browser's error as it was thrown. A read refused or not
   answered is asked again later each time (TT_READ_MAX_MS: ten seconds, doubling, at most a minute), the beat back to five seconds once
   one is answered */
function ttPoll() {
  clearTimeout(TT.timer);
  const at = TT.at;
  const item = at ? null : TT.item;
  if ((!at && !item) || !A) return;
  // still the market this beat was set for: the same place chosen, or still none chosen for the same row
  const same = () => (at ? TT.at === at : !TT.at && TT.item === item);
  TT.timer = setTimeout(async () => {
    const el = $("pane-trade");
    if (!el || ROUTE.tab !== "trade" || document.hidden || !same()) return void (same() && ttPoll());
    const my = ++TT.seq;
    if (at) {
      const b = await api(`/api/account/market?${new URLSearchParams({ venue: at.venue, symbol: at.symbol })}`, { ttl: 3_000 });
      if (my !== TT.seq || !same()) return;
      if (b && b.ok !== false && b.market) {
        TT.mk = b.market;
        TT.readAt = Date.now();
        TT.said = "";
        TT.fails = 0;
      } else {
        TT.fails++;
        TT.said = ttWhyNot(b, "the market could not be read");
      }
    } else {
      const got = await tkReadKind(tkKindOf({ item }), tkQueryOf(item), item.key || "");
      if (my !== TT.seq || !same()) return;
      const row = got.refused ? null : (got.items || []).find((y) => y.key === item.key) || null;
      if (row) {
        TT.row = row;
        TT.readAt = Date.now();
        TT.said = "";
        TT.fails = 0;
      } else if (got.refused) {
        TT.fails++;
        TT.said = ttWhyNot(got.refused, "the markets read was refused");
      } else {
        // the account answered, and its read of the kind did not list the row: said, and asked again on the beat as before
        TT.fails = 0;
        TT.said = "the markets read did not list it";
      }
    }
    ttStats(el);
    ttPoll();
  }, ttWaitMs());
}
/* a read that failed under a table, as one sentence: ttWhyNot's words, capital first, a full stop at the end */
const ttSentence = (b, fallback) => {
  const w = ttWhyNot(b, fallback).replace(/[.\s]+$/, "");
  return `${w.charAt(0).toUpperCase()}${w.slice(1)}.`;
};
/* the beat's next wait: five seconds while the bar's reads are answered; after reads refused or not answered in a row, ten, twenty, forty,
   then a minute */
const ttWaitMs = () => (TT.fails > 0 ? Math.min(TT_READ_MAX_MS, TT_READ_MS * 2 ** TT.fails) : TT_READ_MS);
/* why a read came back with no figures, as one phrase: the account not answering it at all (book.js bkUnanswered: no body, or the
   browser's own error for a request that never reached the account) in the page's words, else the refusal's own (a body, or the words a
   read already took from one), else `fallback` */
function ttWhyNot(b, fallback) {
  const unanswered = typeof bkUnanswered === "function" ? bkUnanswered(b) : !b;
  if (unanswered) return "the account is not answering";
  return (typeof b === "string" ? b.trim() : refusalOf(b)) || fallback;
}

/* a figure in the bar: its name over its value; only what a source said. A name that explains itself on hover (`title`) is underlined
   dashed, as HL marks every label that has a tooltip; the others are plain. `drop`: its place among the figures set aside when they do not
   all fit (TT_DROP, ttFitStats); none, it always stays */
const ttStat = (name, value, cls = "", title = "", drop = 0) => (value === undefined || value === null || value === "" ? "" : `<div class="tt-st" data-k="st:${esc(name)}"${drop ? ` data-tt-drop="${drop}"` : ""}><span class="tt-st-n"${title ? ` title="${esc(title)}"` : ""}>${esc(name)}</span><span class="tt-st-v${cls ? ` ${cls}` : ""}">${value}</span></div>`);
/* which of the bar's figures go first when they do not all fit (the higher, the sooner): bid · ask (the book beside the chart says them),
   then the volume, an event's close, the funding, the session, where the price is from, the change. The price never goes */
const TT_DROP = { bidask: 8, volume: 7, closes: 6, funding: 5, session: 4, from: 3, change: 2 };
/* what a perpetual's funding is, on its label: the venue's rate for each funding period, and who pays whom by its sign */
const TT_FUNDING_SAYS = "The venue's funding rate for each period: when it is above zero, longs pay shorts; below zero, shorts pay longs.";
/* dollars traded, short: $1.9B · $120M · $880k (Markets' own formatter where it is) */
const ttVol = (n) => (typeof mkVol === "function" ? mkVol(n) : money(n));

/** the bar's figures: the price (the venue's, live), the change (the venue's own, else the markets read's) — a US stock's is the day's,
 * from its last regular close (public-stocks.ts), so it is called the day's change, never a 24-hour one — the volume, and what the kind
 * adds: a perpetual's funding and its most leverage, a stock's session, an event's close; and where the venue's price is from, with when
 * once it is not the last minute or two's. With no account chosen for it, the row's figures are its row as the bar's beat last read it
 * again (TT.row, ttPoll: every five seconds while Trade shows, the read kept fifteen), else the freshest read of its kind's busiest that
 * lists it, never the row as it was when it was picked once either has it — and when the beat's last read failed, the kind's read where
 * it lists the row and is fresh (read after the beat last read it, and no older than a page that answers keeps it). A read that failed —
 * the venue's market, or the row with no fresh read of its kind listing it — is said under the figures, with when they were read */
function ttStats(el) {
  const box = el.querySelector("[data-tt-stats]");
  const tags = el.querySelector("[data-tt-tags]");
  if (!box) return;
  const x0 = TT.item;
  const row = x0 && TT.row && TT.row.key === x0.key ? TT.row : null;
  // the kind's own read that lists it (TK.got), and whether that read is fresh: newer than the beat's last read of the row, and no older
  // than a page that answers keeps one (each kind read again once fifteen seconds old, as the pane is drawn; the page drawn again every
  // twenty, shell.js REFRESH_MS). While the account does not answer, or a sheet is open, the pane is not drawn and the kinds' reads stand
  // still: their rows are older than the beat's last figures then, however they list the row
  const kindRead = x0 && x0.key ? Object.values(TK.got || {}).find((g) => g && Array.isArray(g.items) && g.items.some((y) => y.key === x0.key)) || null : null;
  const loaded = kindRead ? kindRead.items.find((y) => y.key === x0.key) : null;
  const fresh = !!kindRead && kindRead.at > TT.readAt && Date.now() - kindRead.at <= TK_READ_MS + REFRESH_MS;
  // the row read again for it while no account is chosen — unless that beat's last read failed and the kind's own read lists it, fresh;
  // a beat that failed with no fresh kind read shows its own last row, else the row as picked, never an older kind read under words that
  // say "since it was picked"; once an account is chosen, that beat has stopped and the kind's own read may be the fresher
  const x = !TT.at && (row || TT.said) && !(TT.said && fresh) ? row || x0 : loaded || row || x0;
  const m = TT.mk;
  if (!x) {
    paint(tags, "");
    paint(el.querySelector("[data-tt-said]"), "");
    return void paint(box, "");
  }
  const ev = x.kind === "event";
  const stock = x.kind === "stock" || (!!m && m.kind === "stock");
  const price = m ? (m.price ?? (m.bid !== undefined && m.ask !== undefined ? (m.bid + m.ask) / 2 : undefined)) : x.price;
  const pct = m && m.changePct24h !== undefined ? m.changePct24h : x.changePct24h;
  const abs = m && m.change24h !== undefined ? m.change24h : x.change24h;
  const vol = m && m.volumeUsd24h !== undefined ? m.volumeUsd24h : x.volumeUsd24h;
  const fmt = (n) => (ev ? tkCents(n) : px(n));
  const dir = pct === undefined ? "" : pct > 0 ? "up" : pct < 0 ? "down" : "";
  const change = pct !== undefined ? `${abs !== undefined ? `${abs > 0 ? "+" : abs < 0 ? "−" : ""}${esc(ev ? tkCents(Math.abs(abs)) : px(Math.abs(abs)))} / ` : ""}${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%` : "";
  const parts = [
    ttStat("Price", price !== undefined ? esc(fmt(price)) : "", "tt-px"),
    ttStat(stock ? "Day change" : "24h change", change, dir, "", TT_DROP.change),
    ttStat("24h volume", vol !== undefined ? esc(ttVol(vol)) : x.contracts24h !== undefined ? `${esc(String(x.contracts24h))} contracts` : "", "", "", TT_DROP.volume),
  ];
  if (m && m.bid !== undefined && m.ask !== undefined && !ev) parts.push(ttStat("Bid · Ask", `${esc(px(m.bid))} · ${esc(px(m.ask))}`, "", "", TT_DROP.bidask));
  // funding as HL colours it: a positive rate in the accent, a negative one in the down colour, the next payment's time in the text colour
  if ((x.kind === "perp" || (m && m.kind === "perp")) && m && m.fundingRate !== undefined) parts.push(ttStat("Funding", `<span class="${m.fundingRate > 0 ? "acc" : m.fundingRate < 0 ? "down" : ""}">${(m.fundingRate * 100).toFixed(4)}%</span>${m.nextFundingAt ? ` <span class="tt-next">· next ${esc(nyTime(m.nextFundingAt))}</span>` : ""}`, "", TT_FUNDING_SAYS, TT_DROP.funding));
  if (m && m.session) parts.push(ttStat("Session", esc(ttSessionWord(m.session)), "", "", TT_DROP.session));
  if (ev && x.closeTime) parts.push(ttStat("Closes", esc(`${nyDay(x.closeTime)} ${nyTime(x.closeTime)} New York`), "", "", TT_DROP.closes));
  // where the price is from, and — once it is not the last minute or two's — when it is from, as Markets says it (ui/markets.js
  // mkQuoteWords): "real time" is the source, not the price's age, and a real-time source's last trade in pre-market can be yesterday's
  if (m && m.quoteFrom) parts.push(ttStat("Price from", esc(typeof mkQuoteWords === "function" ? mkQuoteWords(m.quoteFrom, m.quoteAt) : m.quoteFrom), "", "", TT_DROP.from));
  paint(box, parts.join(""));
  ttFitStats(box);
  // the venue's market (or, no account chosen, the row) not read on the last beat: the figures above are the last read's, and the status
  // strip at the terminal's foot says since when — or since the market was picked, before any beat read it — with the source's words. A row
  // its kind's own fresh read lists is shown from that read: nothing to say of it
  // A read refused or not answered says, too, how long the bar now waits between asks (ttWaitMs)
  const again = TT.fails > 0 ? `. Asking again every ${Math.round(ttWaitMs() / 1000)} s.` : "";
  paint(el.querySelector("[data-tt-said]"), TT.said && (TT.at ? !!m : !fresh) ? esc(`Not read again since ${TT.readAt ? `${nyTime(new Date(TT.readAt).toISOString())} New York` : "it was picked"}: ${TT.said.replace(/[.\s]+$/, "")}${again}`) : "");
  // where the order goes, and how far a perpetual may be levered there. Who trades — the owner here, or the account's desk on a paper
  // account — is the topbar's Regular · Superagent switch (account.html #trade-mode), never a control of this bar
  const v = TT.at ? A.venues.find((y) => y.id === TT.at.venue) : null;
  paint(tags, `${m && m.maxLeverage && m.maxLeverage > 1 ? `<span class="tag tt-lev">${esc(String(m.maxLeverage))}x</span>` : ""}${v ? `<span class="tt-where">${esc(v.paper ? tkPaperless(v.name) : v.name)}${v.paper ? ' <span class="tag paper">Paper</span>' : ""}</span>` : ""}`);
}
/* a stock's session in a word or two: what is on now and until when, New York time */
function ttSessionWord(s) {
  const ph = s.phase && s.phase !== "regular" && s.phase !== "closed" ? s.phase : "";
  const until = s.phaseEndsAt ? ` until ${nyTime(s.phaseEndsAt)}` : "";
  if (ph) return `${{ pre: "Pre-market", after: "After-hours", overnight: "Overnight" }[ph] || ph}${until}`;
  if (s.open) return `Open${s.closesAt ? ` until ${nyTime(s.closesAt)}` : ""}`;
  return `Closed${s.opensAt ? ` · opens ${nyDay(s.opensAt)} ${nyTime(s.opensAt)}` : ""}`;
}

/** the tabs under the panels, drawn from what is known now: what is held (positions, at the venues in the lens), the orders open (the
 * pane's Under way, ui/trade.js), what filled and every order placed (the statement's trades) */
function ttLow(el, owner) {
  if (!ttTabs(el)) return;
  for (const t of el.querySelectorAll("[data-tt-tab]")) t.hidden = t.dataset.ttTab !== TT.tab;
  if (TT.tab === "positions") ttPositions(el.querySelector('[data-tt-tab="positions"]'), owner);
  else if (TT.tab === "open") tkDrawOpen(el.querySelector('[data-tt-tab="open"]'), owner);
  else if (TT.tab === "orders") ttOrders(el.querySelector('[data-tt-tab="orders"]'));
  else ttHistory(el.querySelector('[data-tt-tab="history"]'));
}
/* the tab bar under the panels: each tab with how many it holds where that is known — the orders open in the lens, and the positions as
   last read (TT.posN, set as Positions draws them): a table that scrolls inside a short window still says how many rows it has. False when
   the frame has no tab bar */
function ttTabs(el) {
  const tabs = el && typeof el.querySelector === "function" ? el.querySelector("[data-tt-tabs]") : null;
  if (!tabs) return false;
  const n = (v) => (v === "open" ? ttOpenCount() : v === "positions" ? TT.posN || 0 : 0);
  paint(tabs, TT_TABS.map(([v, t]) => `<button type="button" role="tab" data-tt-to="${v}" aria-selected="${String(TT.tab === v)}">${esc(t)}${n(v) ? ` <span class="tt-n">${n(v)}</span>` : ""}</button>`).join(""));
  // the line under the tab showing slides to it (book.js bkSlideUnder: HL's tab bars)
  if (typeof bkSlideUnder === "function") bkSlideUnder(tabs);
  return true;
}
/* the orders still open in the lens — the ones Under way lists (ui/trade.js tkOpenOrders: an agent's lens keeps that agent's) */
const ttOpenCount = () => (A && Array.isArray(A.orders) ? tkOpenOrders().length : 0);

/* ---- a price written as its market writes it ------------------------------------------------------------------------------------- */
/** the decimal places a figure is written in, with no binary tail (62,481.70000001 counts 1, 0.1 + 0.2 counts 1); not a figure: undefined */
function ttDecimals(x) {
  const n = Number(x);
  if (x === undefined || x === null || x === "" || !Number.isFinite(n)) return undefined;
  if (n === 0) return 0;
  const [m, e] = Number(n.toPrecision(10)).toExponential().split("e");
  return Math.max(0, (m.split(".")[1] || "").length - Number(e));
}
/** a market's own price step where this page has read that market: the one showing (TT.mk, where the order goes), else its last read kept
 * by the page (core api: the ticket, the bar and the close sheet read a market at the one path, GET /api/account/market?venue=&symbol=).
 * Nothing is asked for it here: a market not read on this page has no step known (undefined) */
function ttStepOf(venue, symbol) {
  if (!venue || !symbol) return undefined;
  if (TT.at && TT.mk && TT.at.venue === venue && TT.at.symbol === symbol && Number(TT.mk.priceStep) > 0) return Number(TT.mk.priceStep);
  const hit = typeof API !== "undefined" && API && typeof API.get === "function" ? API.get(`/api/account/market?${new URLSearchParams({ venue, symbol })}`) : null;
  const m = hit && hit.body && hit.body.ok !== false ? hit.body.market : null;
  return m && Number(m.priceStep) > 0 ? Number(m.priceStep) : undefined;
}
/** A PRICE AS ITS MARKET WRITES IT, grouped en-US — the positions, the two history tabs: to the decimals of the market's own price step
 * where it is known (an average of fills, 62,548.88617 on a 0.1 step, reads 62,548.9; a price on its step is written to it, as the book
 * writes its levels: 60,520.0); with no step known, to the decimals the venue writes the same market's own prices in (`like`: the mark, the
 * liquidation price, a limit — never more than the figure has); with neither, six significant figures. No tail no venue quotes is printed.
 * Returns the words and, when they round the figure, the figure as it came (core px) for the hover, so nothing is hidden: { text, exact } */
function ttFig(n, { step, like = [] } = {}) {
  const v = Number(n);
  if (n === undefined || n === null || n === "" || !Number.isFinite(v)) return { text: "—", exact: "" };
  const own = ttDecimals(v) ?? 0;
  let dec;
  let pad = false;
  if (Number(step) > 0) {
    dec = Math.min(8, ttDecimals(step) ?? 0);
    pad = true;
  } else {
    const seen = like.map(ttDecimals).filter((d) => d !== undefined);
    // what the other figures of the market show is a hint, never a cap: a mark that lands on a round figure (62,498) drops its
    // trailing zeros, and the entry beside it must not lose its decimals with it (and flicker back on the next read) — so a figure keeps
    // at least six significant figures of its own, up to the decimals it has
    const sig = Math.max(0, 6 - (Math.floor(Math.log10(Math.abs(v) || 1)) + 1));
    dec = Math.min(own, seen.length ? Math.max(sig, ...seen) : sig);
  }
  return { text: v.toLocaleString("en-US", { minimumFractionDigits: pad ? dec : 0, maximumFractionDigits: dec }), exact: dec < own ? px(v) : "" };
}
/* Positions: everything held at the venues in the lens that the venues list as positions — a perpetual, a share, a coin a paper account
   holds, an event contract — with its entry, its mark, what it is worth and its result, in HL's columns (Market · Size · Position value ·
   Entry price · Mark price · PNL · Liq. price); the venue it is held at beside its name, quieter. Close… is the close sheet (ui/trade.js
   openClose). Each cell carries its column's class, so a narrow terminal lays a position out on two lines (terminal.css): the market and its
   result, then its size and mark with the button. A venue whose positions could not be read is named under them with its own words (one
   that does not serve this network, in one quiet line); while one is missing, "nothing held" is said only of the venues that answered */
function ttPositions(box, owner) {
  if (!box) return;
  api("/api/account/positions", { ttl: 10_000 }).then((b) => {
    if (!box.isConnected || TT.tab !== "positions") return;
    if (!b || b.ok === false) return void paint(box, `<p class="msg no">${esc(ttSentence(b, "the positions could not be read"))}</p>`);
    const lens = lensNow();
    const list = (b.positions || []).filter((p) => p.qty > 0 && tkVenueIn(p.venue, lens));
    // how many, on the tab (ttTabs): drawn again only when it changed
    if ((TT.posN || 0) !== list.length) {
      TT.posN = list.length;
      ttTabs($("pane-trade"));
    }
    const miss = (b.missing || []).filter((m) => tkVenueIn(m.venue, lens));
    const failed = miss.filter((m) => !awayMiss(m));
    const missing = `${awayLine(miss.filter(awayMiss), { cls: "small dim tt-miss" })}${failed.length ? `<ul class="tt-miss">${failed.map((m) => `<li><b>${esc(m.venueName || nameOf(m.venue))}</b> could not be read: ${esc(m.why || "no answer")}</li>`).join("")}</ul>` : ""}`;
    if (!list.length) return void paint(box, `<p class="empty">${miss.length ? "Nothing held in positions at the venues that answered." : `Nothing held in positions${lens.kind === "all" ? "" : " here"}.`}</p>${missing}`);
    const closable = (p) => { const v = connected().find((x) => x.id === p.venue); return owner && writesOn() && !!v && canTrade(v) && !!v.trade && !!v.trade.positions; };
    // each price as its market writes it (ttFig): to its step where this page read the market, else to the decimals its mark is quoted in
    // (the venue's own price; a liquidation price is worked out, so it is no guide) — an average entry is never printed to five decimals no
    // venue quotes. An event's in cents
    const fig = (p, n, cls, pre = "") => {
      if (n === undefined || n === null || n === "") return `<td class="${cls}">${pre}—</td>`;
      if (p.kind === "event") return `<td class="${cls}">${pre}${esc(cents(n))}</td>`;
      const f = ttFig(n, { step: ttStepOf(p.venue, p.symbol), like: [p.markPrice] });
      return `<td class="${cls}"${f.exact ? ` title="${esc(f.exact)}"` : ""}>${pre}${esc(f.text)}</td>`;
    };
    const rows = list.map((p, i) => `<tr><td class="tt-c-mkt"><b>${esc(p.name)}</b>${p.paper ? ' <span class="tag paper">Paper</span>' : ""}<span class="why">${esc(p.paper ? tkPaperless(p.venueName || nameOf(p.venue)) : p.venueName || nameOf(p.venue))}</span></td><td class="r tt-c-size ${p.side === "short" ? "down" : "up"}">${esc(p.side === "short" ? "Short" : "Long")} ${esc(qtyOf(p.qty))}${p.leverage && p.leverage > 1 ? ` · ${esc(String(p.leverage))}x` : ""}</td><td class="r tt-c-val">${p.usd !== undefined ? money(p.usd) : "—"}</td>${fig(p, p.entryPrice, "r tt-c-entry")}${fig(p, p.markPrice, "r tt-c-mark", '<span class="tt-k">Mark </span>')}<td class="r tt-c-pnl">${chg(p.unrealizedUsd, "$")}</td>${p.liquidationPrice ? fig(p, p.liquidationPrice, "r tt-c-liq") : '<td class="r tt-c-liq"><span class="flat">—</span></td>'}<td class="r tt-c-act">${closable(p) ? `<button type="button" class="btn btn-sm" data-tt-close="${i}">${p.kind === "perp" || p.kind === "future" ? "Close…" : "Sell…"}</button>` : ""}</td></tr>`).join("");
    paint(box, `<div class="t-wrap"><table class="t tt-t tt-pos"><thead><tr><th>Market</th><th class="r">Size</th><th class="r">Position value</th><th class="r">Entry price</th><th class="r">Mark price</th><th class="r">PNL</th><th class="r">Liq. price</th><th class="r"><span class="sr">Close</span></th></tr></thead><tbody>${rows}</tbody></table></div>${missing}`);
    box.ttList = list;
    if (box.ttHeard) return;
    box.ttHeard = true;
    box.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("button[data-tt-close]");
      const p = btn && box.ttList ? box.ttList[Number(btn.dataset.ttClose)] : null;
      if (p && typeof openClose === "function") openClose(p);
    });
  });
}

/* an order of the statement as the two history tabs read it: from the account's own order where this page has it (A.orders, joined by
   the client id the line is keyed by — the market's name, its side, kind and type, its size, what filled and at what price, its limit and
   stop) — else from the line's own words, which the account writes in one fixed shape (account/statement.ts orderLine: "Buy 0.5 SOL ·
   SOL / USDT · limit 142.44 · at 141.9 · 0.2 of 0.5 filled"), read back part by part; a part that is not there is no figure (a dash),
   never a guess. An event contract read from the words alone is priced in dollars, as its line writes it */
const TT_TYPE_OF = [[/^market$/, "market"], [/^limit /, "limit"], [/^stop at .*, limit /, "stop_limit"], [/^stop at /, "stop"], [/^trailing stop /, "trailing_stop"]];
function ttOrderRec(l) {
  const o = A && Array.isArray(A.orders) ? A.orders.find((x) => x && x.clientId && l.key === `order:${x.clientId}`) : null;
  if (o) return { name: o.name || o.base, side: o.side, ev: o.kind === "event", type: o.type, qty: o.qty, filled: o.filledQty || 0, avg: o.avgPrice, limit: o.limitPrice, stop: o.stopPrice, reduceOnly: !!o.reduceOnly, venue: o.venue, symbol: o.symbol, like: [o.limitPrice, o.stopPrice, o.price] };
  const parts = String(l.description || "").split(" · ");
  const head = /^(Buy|Sell) (-?[\d.,]+) (.+)$/.exec(parts[0] || "");
  const ti = parts.findIndex((x, i) => i > 0 && TT_TYPE_OF.some(([re]) => re.test(x)));
  const typeWords = ti > 0 ? parts[ti] : "";
  const type = typeWords ? TT_TYPE_OF.find(([re]) => re.test(typeWords))[1] : "";
  const fig = (t) => (t === undefined ? undefined : Number(String(t).replace(/,/g, "")));
  const at = parts.map((x) => /^at (-?[\d.,]+)$/.exec(x)).find(Boolean);
  const part = parts.map((x) => /^([\d.,]+) of [\d.,]+ filled$/.exec(x)).find(Boolean);
  const qty = head ? fig(head[2]) : undefined;
  const filled = part ? fig(part[1]) : at ? qty : 0;
  const limit = fig((/limit (-?[\d.,]+)$/.exec(typeWords) || [])[1]);
  const stop = fig((/^stop at (-?[\d.,]+)/.exec(typeWords) || [])[1]);
  return { name: ti > 1 ? parts.slice(1, ti).join(" · ") : head ? head[3] : String(l.description || ""), side: l.kind === "sell" ? "sell" : "buy", ev: false, type, qty, filled, avg: at ? fig(at[1]) : undefined, limit, stop, reduceOnly: false, venue: "", symbol: "", like: [limit, stop] };
}
/* a statement line in the lens: Real money or Paper by the line's own word (a paper account closed since is still Paper), one venue by its
   account, an agent's lens that agent's */
function ttLinesHere(b) {
  const lens = lensNow();
  const here = (l) => (lens.kind === "real" ? !l.paper : lens.kind === "paper" ? !!l.paper : inLens(l.account, l.agent));
  return (b.lines || []).filter((l) => l.type === "trade" && here(l));
}
/* the cells the two history tabs share: when (New York), the market by its name — with Paper, the venue beside it quieter, and the
   account's id for the order on hover — and the side, coloured as HL colours a direction, in its word */
const ttWhen = (l) => `<td class="tab-nums nw">${esc(nyDay(l.updatedAt || l.at))} ${esc(nyTime(l.updatedAt || l.at))}</td>`;
const ttMarketCell = (l, r) => `<td class="tt-c-mkt" title="${esc(`${l.id} · ${l.accountName}`)}"><b>${esc(r.name)}</b>${l.paper ? ' <span class="tag paper">Paper</span>' : ""}<span class="why">${esc(l.paper ? tkPaperless(l.accountName) : l.accountName)}</span></td>`;
const ttSideCell = (r) => `<td class="${r.side === "sell" ? "down" : "up"}">${r.side === "sell" ? "Sell" : "Buy"}</td>`;
/* a price in the two history tabs, as its market writes it (ttFig: its step where this page read the market, else the decimals of the
   order's own limit, stop and the price it was valued at), an event's in cents; the figure as it came on hover where the words round it */
const ttPx = (r, n) => {
  if (n === undefined || n === null || n === "" || !Number.isFinite(Number(n))) return "—";
  if (r.ev) return esc(cents(n));
  const f = ttFig(n, { step: ttStepOf(r.venue, r.symbol), like: r.like || [] });
  return f.exact ? `<span title="${esc(f.exact)}">${esc(f.text)}</span>` : esc(f.text);
};

/* Trade history: what FILLED, newest first — fills only, never an order that is open, waiting or was canceled with nothing filled — in HL's
   columns: Time · Market · Direction · Price · Size · Trade value · Fee · By. A fill's value is neither up nor down (money changed hands
   for a thing); colour is kept for the side's word */
function ttHistory(box) {
  if (!box) return;
  api("/api/account/statement", { ttl: 10_000 }).then((b) => {
    if (!box.isConnected || TT.tab !== "history") return;
    if (!b || b.ok === false) return void paint(box, `<p class="msg no">${esc(ttSentence(b, "the statement could not be read"))}</p>`);
    const lines = ttLinesHere(b).filter((l) => Math.abs(Number(l.amountUsd) || 0) > 0 || /^(filled|partial)$/.test(String(l.status))).slice(0, 40);
    if (!lines.length) return void paint(box, '<p class="empty">No trades yet.</p>');
    const rows = lines.map((l) => {
      const r = ttOrderRec(l);
      return `<tr>${ttWhen(l)}${ttMarketCell(l, r)}${ttSideCell(r)}<td class="r">${ttPx(r, r.avg)}</td><td class="r">${r.filled ? esc(qtyOf(r.filled)) : "—"}</td><td class="r">${money(Math.abs(Number(l.amountUsd) || 0))}</td><td class="r">${l.feeUsd !== undefined ? fine(l.feeUsd) : "—"}</td><td>${esc(l.by || "")}</td></tr>`;
    }).join("");
    paint(box, `<div class="t-wrap"><table class="t tt-t"><thead><tr><th>Time</th><th>Market</th><th>Direction</th><th class="r">Price</th><th class="r">Size</th><th class="r">Trade value</th><th class="r">Fee</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  });
}

/* an order's state in words, as its line has it: what filled, what rests, what waits at its venue or for the owner's wallet, what was
   canceled, refused or ran out, what the account stopped following */
function ttStatusWords(l) {
  const s = String(l.status || "");
  const known = { filled: "Filled", partial: "Part filled", open: "Open", canceled: "Canceled", cancelled: "Canceled", rejected: "Rejected", expired: "Expired", "waiting for wallet": "Waiting for your wallet", "not followed": "Not followed", "not followed since a restart": "Not followed since a restart" };
  if (s === "pending") return `Waiting at ${l.accountName || nameOf(l.account)}`;
  return known[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");
}

/* Order history: every order placed, newest first, whatever became of it, in HL's columns: Time · Type · Market · Direction · Size ·
   Filled · Order value · Price · Status · By. Price is the limit an order rests at (Market for one at market; a stop's trigger in Type) */
function ttOrders(box) {
  if (!box) return;
  api("/api/account/statement", { ttl: 10_000 }).then((b) => {
    if (!box.isConnected || TT.tab !== "orders") return;
    if (!b || b.ok === false) return void paint(box, `<p class="msg no">${esc(ttSentence(b, "the statement could not be read"))}</p>`);
    const lines = ttLinesHere(b).slice(0, 60);
    if (!lines.length) return void paint(box, '<p class="empty">No orders yet.</p>');
    const rows = lines.map((l) => {
      const r = ttOrderRec(l);
      const type = `${TK_TYPE_NAMES[r.type] || "—"}${r.stop !== undefined && (r.type === "stop" || r.type === "stop_limit") ? ` at ${ttPx(r, r.stop)}` : ""}`;
      const price = r.limit !== undefined ? ttPx(r, r.limit) : r.type === "market" || r.type === "stop" || r.type === "trailing_stop" ? "Market" : "—";
      const st = String(l.status || "");
      return `<tr>${ttWhen(l)}<td class="nw">${type}</td>${ttMarketCell(l, r)}${ttSideCell(r)}<td class="r">${r.qty !== undefined ? esc(qtyOf(r.qty)) : "—"}</td><td class="r">${r.filled ? esc(qtyOf(r.filled)) : "0"}</td><td class="r">${l.worthUsd !== undefined ? money(l.worthUsd) : "—"}</td><td class="r">${price}</td><td class="nw tt-st-${/^(filled|partial|open)$/.test(st) ? "on" : /^(pending|waiting for wallet)$/.test(st) ? "wait" : "off"}">${esc(ttStatusWords(l))}</td><td>${esc(l.by || "")}</td></tr>`;
    }).join("");
    paint(box, `<div class="t-wrap"><table class="t tt-t"><thead><tr><th>Time</th><th>Type</th><th>Market</th><th>Direction</th><th class="r">Size</th><th class="r">Filled</th><th class="r">Order value</th><th class="r">Price</th><th>Status</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  });
}

/** the pane drawn: the bar's figures and the tabs under the panels; a market to start from while nothing has shown on this frame yet and
 * no ticket was opened on purpose — the busiest of the kind showing, at the first account that trades it (nothing takes the focus). After
 * that nothing is picked by itself: a ticket the owner opened on no market (the "t" key, a venue's Trade, Change) is left as it is */
function ttDraw(el, owner) {
  ttWire(el);
  ttFit(el);
  ttStats(el);
  ttLow(el, owner);
  if (!TT.item && !TT.started && TK.kind && TK.got[TK.kind] && (TK.got[TK.kind].items || []).length && !TK.pending) {
    const first = TK.got[TK.kind].items.find((x) => tkInLens(x, lensNow()));
    if (first) {
      TT.started = true;
      const at = (first.at || []).find((a) => a.connected && a.canTrade !== false) || (first.at || []).find((a) => a.connected) || null;
      tkOpen({ kind: TK.kind, item: first, venue: at ? at.venue : "", symbol: at ? at.symbol : "", side: "buy", rest: true });
    }
  }
  if (!TT.item) ttMount(el);
}
