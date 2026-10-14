/* THE TRADE TERMINAL — the Trade pane laid out as a trading screen: the market bar on top (the market, its price, its 24 hours, its
   funding or its session), the chart on the left (ui/chart.js), the order book and the latest trades in the middle (ui/book.js), the order
   panel on the right (the ticket, ui/trade.js), and under them what is held, what is open and what was done. The market is picked from the
   bar: it opens the kinds and their lists (the picker, ui/trade.js) in a panel under it.

   It draws nothing of its own about a market that its sources did not say: the bar's figures are the market's as its venue lists it
   (GET /api/account/market, read again every five seconds while the pane is showing) and the row's from the markets read; a figure no
   source gave is not shown. Every button does what it says through the ticket, the book or the account's own door. */

/* the terminal's state: the market showing (its Markets row, where it is traded, the market as the venue lists it), the tab under the
   panels, the market the chart and the book were mounted on, and the bar's read timer */
const TT = { item: null, kind: "", at: null, mk: null, tab: "positions", mounted: "", timer: 0, seq: 0 };
const TT_TABS = [["positions", "Positions"], ["open", "Open orders"], ["history", "Trade history"]];
const TT_READ_MS = 5_000;

/** the pane's frame: the bar, the picker's panel (hidden), the three panels, the tabs under them */
function ttFrame() {
  return `<div class="tt" data-tp>
    <div class="tt-bar">
      <button type="button" class="tt-mkt" data-tt-pick aria-expanded="false" aria-controls="tt-pop"><span class="tt-av" data-tt-av></span><span class="tt-name" data-tt-name>Pick a market</span>${icon("chevron", "sm")}</button>
      <span class="tt-tags" data-tt-tags></span>
      <div class="tt-stats tab-nums" data-tt-stats></div>
      <span class="dim small tp-state" data-tp-state></span>
    </div>
    <div class="tt-pop panel" id="tt-pop" data-tt-pop hidden>
      <div data-tp-note></div>
      <div class="seg tk-seg" role="group" aria-label="Market kind" data-tp-kinds></div>
      <section class="tk-pick" data-tp-pick aria-labelledby="tp-pick-h"></section>
    </div>
    <div class="tt-grid">
      <section class="tt-chart" data-tt-chart aria-label="Chart"></section>
      <section class="tt-book" data-tt-book aria-label="Order book and trades"></section>
      <aside class="tt-order tk-panel" id="tk-panel" aria-label="Order"></aside>
    </div>
    <section class="tt-low" aria-label="Positions, open orders and trade history">
      <div class="tt-tabs" role="tablist" data-tt-tabs></div>
      <div class="tt-tab" data-tt-tab="positions"></div>
      <section class="tt-tab" data-tt-tab="open" data-tp-open aria-labelledby="tp-open-h" hidden></section>
      <div class="tt-tab" data-tt-tab="history" hidden></div>
    </section>
  </div>`;
}

/** the frame's buttons, heard once: the market button opens and closes the picker's panel (Escape and a click outside close it), the tabs */
function ttWire(el) {
  if (el.ttWired) return;
  el.ttWired = true;
  const pop = el.querySelector("[data-tt-pop]");
  const btn = el.querySelector("[data-tt-pick]");
  const setPop = (open) => {
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      const input = pop.querySelector("input[type='search']");
      if (input) setTimeout(() => input.focus({ preventScroll: true }), 0);
    }
  };
  TT.closePicker = () => setPop(false);
  btn.addEventListener("click", () => setPop(pop.hidden));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      setPop(false);
      btn.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (pop.hidden || !el.isConnected) return;
    const t = e.target;
    if (t && (pop.contains(t) || btn.contains(t))) return;
    setPop(false);
  });
  // a market picked in the panel closes it (the ticket opens on it: ttSetItem below)
  pop.addEventListener("click", (e) => {
    const row = e.target.closest && e.target.closest(".tk-list button[data-i]");
    if (row) setTimeout(() => setPop(false), 0);
  });
  const tabs = el.querySelector("[data-tt-tabs]");
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-tt-to]");
    if (!b || TT.tab === b.dataset.ttTo) return;
    TT.tab = b.dataset.ttTo;
    ttLow(el, owns());
  });
}

/* a market's name and logo as the bar says it */
const ttLabel = (x) => (!x ? "Pick a market" : x.kind === "event" ? tkName(x) : x.kind === "perp" && !tkPre(x) ? `${x.base || x.name}-PERP` : x.base || x.name);

/** the ticket picked a market (or put it back: null): the bar's name and logo */
function ttSetItem(item, kind) {
  const el = $("pane-trade");
  // another market: where the last one was traded, and its figures, are not this one's (ttSetMarket says where this one is, once chosen)
  if (!item || !TT.item || item.key !== TT.item.key) {
    TT.at = null;
    TT.mk = null;
  }
  TT.item = item || null;
  TT.kind = kind || TT.kind;
  if (!el) return;
  const name = el.querySelector("[data-tt-name]");
  if (name) setText(name, ttLabel(item));
  const av = el.querySelector("[data-tt-av]");
  if (av) paint(av, item ? avatar(item.kind === "event" ? String(item.category || "Event").slice(0, 4) : item.base || item.name, "sm", item.icon || "") : "");
  ttStats(el);
  // until an account is chosen for it, the chart and the book are its public listing's (or say why there are none)
  if (!TT.at) ttMount(el);
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
  // a price pressed in the book is the limit price in the ticket
  if (typeof bkMount === "function") bkMount(book, { ...base, base: mk.base, priceStep: mk.priceStep, onPrice: (p) => typeof TK.setLimit === "function" && TK.setLimit(p) });
  else paint(book, '<p class="empty tt-wait">The order book is not on this page.</p>');
}

/* the bar's market read again every five seconds while the pane is the one showing: its price, its 24 hours, its funding, its session */
function ttPoll() {
  clearTimeout(TT.timer);
  const at = TT.at;
  if (!at || !A) return;
  TT.timer = setTimeout(async () => {
    const el = $("pane-trade");
    if (!el || ROUTE.tab !== "trade" || document.hidden || !TT.at || TT.at.venue !== at.venue || TT.at.symbol !== at.symbol) return void (TT.at === at && ROUTE.tab === "trade" && ttPoll());
    const my = ++TT.seq;
    const b = await api(`/api/account/market?${new URLSearchParams({ venue: at.venue, symbol: at.symbol })}`, { ttl: 3_000 });
    if (my !== TT.seq || TT.at !== at) return;
    if (b && b.ok !== false && b.market) {
      TT.mk = b.market;
      ttStats(el);
    }
    ttPoll();
  }, TT_READ_MS);
}

/* a figure in the bar: its name over its value; only what a source said */
const ttStat = (name, value, cls = "") => (value === undefined || value === null || value === "" ? "" : `<div class="tt-st"><span class="tt-st-n">${esc(name)}</span><span class="tt-st-v ${cls}">${value}</span></div>`);
/* dollars traded, short: $1.9B · $120M · $880k (Markets' own formatter where it is) */
const ttVol = (n) => (typeof mkVol === "function" ? mkVol(n) : money(n));

/** the bar's figures: the price (the venue's, live), the 24 hours (the venue's own, else the markets read's), the volume, and what the
 * kind adds — a perpetual's funding and its most leverage, a stock's session, an event's close */
function ttStats(el) {
  const box = el.querySelector("[data-tt-stats]");
  const tags = el.querySelector("[data-tt-tags]");
  if (!box) return;
  const x = TT.item;
  const m = TT.mk;
  if (!x) {
    paint(tags, "");
    return void paint(box, "");
  }
  const ev = x.kind === "event";
  const price = m ? (m.price ?? (m.bid !== undefined && m.ask !== undefined ? (m.bid + m.ask) / 2 : undefined)) : x.price;
  const pct = m && m.changePct24h !== undefined ? m.changePct24h : x.changePct24h;
  const abs = m && m.change24h !== undefined ? m.change24h : x.change24h;
  const vol = m && m.volumeUsd24h !== undefined ? m.volumeUsd24h : x.volumeUsd24h;
  const fmt = (n) => (ev ? tkCents(n) : px(n));
  const dir = pct === undefined ? "" : pct > 0 ? "up" : pct < 0 ? "down" : "";
  const change = pct !== undefined ? `${abs !== undefined ? `${abs > 0 ? "+" : abs < 0 ? "−" : ""}${esc(ev ? tkCents(Math.abs(abs)) : px(Math.abs(abs)))} / ` : ""}${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%` : "";
  const parts = [
    ttStat("Price", price !== undefined ? esc(fmt(price)) : "", "tt-px"),
    ttStat("24h change", change, dir),
    ttStat("24h volume", vol !== undefined ? esc(ttVol(vol)) : x.contracts24h !== undefined ? `${esc(String(x.contracts24h))} contracts` : ""),
  ];
  if (m && m.bid !== undefined && m.ask !== undefined && !ev) parts.push(ttStat("Bid · Ask", `${esc(px(m.bid))} · ${esc(px(m.ask))}`));
  if ((x.kind === "perp" || (m && m.kind === "perp")) && m && m.fundingRate !== undefined) parts.push(ttStat("Funding", `${(m.fundingRate * 100).toFixed(4)}%${m.nextFundingAt ? ` <span class="dim">· next ${esc(nyTime(m.nextFundingAt))}</span>` : ""}`, m.fundingRate > 0 ? "down" : m.fundingRate < 0 ? "up" : ""));
  if (m && m.session) parts.push(ttStat("Session", esc(ttSessionWord(m.session))));
  if (ev && x.closeTime) parts.push(ttStat("Closes", esc(`${nyDay(x.closeTime)} ${nyTime(x.closeTime)} New York`)));
  if (m && m.quoteFrom) parts.push(ttStat("Price from", esc(m.quoteFrom)));
  paint(box, parts.join(""));
  // where the order goes, and how far a perpetual may be levered there
  const v = TT.at ? A.venues.find((y) => y.id === TT.at.venue) : null;
  paint(tags, `${m && m.maxLeverage && m.maxLeverage > 1 ? `<span class="tag tt-lev">${esc(String(m.maxLeverage))}x</span>` : ""}${v ? `<span class="tt-where">${esc(v.name)}${v.paper ? ' <span class="tag paper">Paper</span>' : ""}</span>` : ""}`);
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
 * pane's Under way, ui/trade.js), what was traded (the statement's trades) */
function ttLow(el, owner) {
  const tabs = el.querySelector("[data-tt-tabs]");
  if (!tabs) return;
  paint(tabs, TT_TABS.map(([v, t]) => `<button type="button" role="tab" data-tt-to="${v}" aria-selected="${String(TT.tab === v)}">${esc(t)}${v === "open" && ttOpenCount() ? ` <span class="tt-n">${ttOpenCount()}</span>` : ""}</button>`).join(""));
  for (const t of el.querySelectorAll("[data-tt-tab]")) t.hidden = t.dataset.ttTab !== TT.tab;
  if (TT.tab === "positions") ttPositions(el.querySelector('[data-tt-tab="positions"]'), owner);
  else if (TT.tab === "open") tkDrawOpen(el.querySelector('[data-tt-tab="open"]'), owner);
  else ttHistory(el.querySelector('[data-tt-tab="history"]'));
}
/* the orders still open at the venues in the lens */
const ttOpenCount = () => (A && Array.isArray(A.orders) ? A.orders.filter((o) => !["filled", "canceled", "rejected", "expired"].includes(o.status) && tkVenueIn(o.venue, lensNow())).length : 0);

/* Positions: everything held at the venues in the lens that the venues list as positions — a perpetual, a share, a coin a paper account
   holds, an event contract — with its entry, its mark, what it is worth and its result; Close… is the close sheet (ui/trade.js openClose) */
function ttPositions(box, owner) {
  if (!box) return;
  api("/api/account/positions", { ttl: 10_000 }).then((b) => {
    if (!box.isConnected || TT.tab !== "positions") return;
    if (!b || b.ok === false) return void paint(box, `<p class="msg no">${esc(refusalOf(b) || "The positions could not be read.")}</p>`);
    const lens = lensNow();
    const list = (b.positions || []).filter((p) => p.qty > 0 && tkVenueIn(p.venue, lens));
    if (!list.length) return void paint(box, `<p class="empty">Nothing held in positions${lens.kind === "all" ? "" : " here"}.</p>`);
    const closable = (p) => { const v = connected().find((x) => x.id === p.venue); return owner && writesOn() && !!v && canTrade(v) && !!v.trade && !!v.trade.positions; };
    const at = (p, n) => (n === undefined || n === null ? "—" : esc(p.kind === "event" ? cents(n) : px(n)));
    const rows = list.map((p, i) => `<tr><td><b>${esc(p.name)}</b>${p.paper ? ' <span class="tag paper">Paper</span>' : ""}<span class="why">${esc(p.venueName || nameOf(p.venue))}</span></td><td class="r ${p.side === "short" ? "down" : "up"}">${esc(p.side === "short" ? "Short" : "Long")} ${esc(qtyOf(p.qty))}${p.leverage && p.leverage > 1 ? ` · ${esc(String(p.leverage))}x` : ""}</td><td class="r">${p.usd !== undefined ? money(p.usd) : "—"}</td><td class="r">${at(p, p.entryPrice)}</td><td class="r">${at(p, p.markPrice)}</td><td class="r">${chg(p.unrealizedUsd, "$")}</td><td class="r">${p.liquidationPrice ? esc(px(p.liquidationPrice)) : '<span class="flat">—</span>'}</td><td class="r">${closable(p) ? `<button type="button" class="btn btn-sm" data-tt-close="${i}">${p.kind === "perp" || p.kind === "future" ? "Close…" : "Sell…"}</button>` : ""}</td></tr>`).join("");
    paint(box, `<div class="t-wrap"><table class="t tt-t"><thead><tr><th>Market</th><th class="r">Size</th><th class="r">Value</th><th class="r">Entry</th><th class="r">Mark</th><th class="r">P&amp;L</th><th class="r">Liq.</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`);
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

/* Trade history: the statement's trades at the venues in the lens, newest first — what filled, at what, for how much, and who placed it */
function ttHistory(box) {
  if (!box) return;
  api("/api/account/statement", { ttl: 10_000 }).then((b) => {
    if (!box.isConnected || TT.tab !== "history") return;
    if (!b || b.ok === false) return void paint(box, `<p class="msg no">${esc(refusalOf(b) || "The statement could not be read.")}</p>`);
    const lens = lensNow();
    const lines = (b.lines || []).filter((l) => l.type === "trade" && tkVenueIn(l.account, lens)).slice(0, 40);
    if (!lines.length) return void paint(box, '<p class="empty">No trades yet.</p>');
    paint(box, `<div class="t-wrap"><table class="t tt-t"><thead><tr><th>Time</th><th>Order</th><th>Status</th><th class="r">Amount</th><th class="r">Fee</th><th>By</th></tr></thead><tbody>${lines.map((l) => `<tr><td class="tab-nums">${esc(nyDay(l.updatedAt || l.at))} ${esc(nyTime(l.updatedAt || l.at))}</td><td><span class="${l.kind === "sell" ? "down" : "up"}">${esc(l.kind === "sell" ? "Sell" : "Buy")}</span> ${esc(l.description.replace(/^(Buy|Sell) /, ""))}<span class="why">${esc(l.accountName)}${l.paper ? " · paper" : ""}</span></td><td>${esc(l.status)}</td><td class="r">${chg(l.amountUsd, "$")}</td><td class="r">${l.feeUsd !== undefined ? fine(l.feeUsd) : "—"}</td><td>${esc(l.by || "")}</td></tr>`).join("")}</tbody></table></div>`);
  });
}

/** the pane drawn: the bar's figures and the tabs under the panels; a market to start from when nothing is picked yet — the busiest of
 * the kind showing, at the first account that trades it (nothing takes the focus) */
function ttDraw(el, owner) {
  ttWire(el);
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
