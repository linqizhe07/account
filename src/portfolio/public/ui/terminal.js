/* THE TRADE TERMINAL — the Trade pane laid out as a trading screen: the market bar on top (the market, its price, its 24 hours, its
   funding or its session), the chart on the left (ui/chart.js), the order book and the latest trades in the middle (ui/book.js), the order
   panel on the right (the ticket, ui/trade.js), and under them what is held, what is open and what was done. The market is picked from the
   bar: it opens the kinds and their lists (the picker, ui/trade.js) in a panel under it.

   It draws nothing of its own about a market that its sources did not say: the bar's figures are the market's as its venue lists it
   (GET /api/account/market, read again every five seconds while the pane is showing — its beat goes on while another pane shows, asking
   nothing, so the figures are fresh again within a beat of coming back) and its row's — until an account is chosen for it, the row read
   again on the same beat; a figure no source gave is not shown, and a read that failed says so, with when the figures showing were read.
   Every button does what it says through the ticket, the book or the account's own door. */

/* the terminal's state: the market showing (its Markets row and that row as last read again, where it is traded, the market as the venue
   lists it, when that was last read and why the last read failed), the tab under the panels, the market the chart and the book were mounted
   on, whether a market has shown on this frame or a ticket was opened on purpose (from then on nothing picks one by itself: ui/trade.js
   tkTicket says so as a ticket opens, tkReopenDraft while a kept ticket's market is read), and the bar's read timer */
const TT = { item: null, row: null, kind: "", at: null, mk: null, readAt: 0, said: "", tab: "positions", mounted: "", started: false, timer: 0, seq: 0 };
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
 * tabs — so a frame drawn again is heard as the first was; Escape and a click outside the panel close it, heard once on the page */
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
  if (TT.docHeard) return;
  TT.docHeard = true;
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
  }
  // the row the ticket gives is the one it has just read: a row read again before it is not kept over it
  TT.row = null;
  TT.item = item || null;
  TT.kind = kind || TT.kind;
  if (item) TT.started = true;
  if (!el) return;
  const name = el.querySelector("[data-tt-name]");
  if (name) setText(name, ttLabel(item));
  const av = el.querySelector("[data-tt-av]");
  if (av) paint(av, item ? avatar(item.kind === "event" ? String(item.category || "Event").slice(0, 4) : item.base || item.name, "sm", item.icon || "") : "");
  ttStats(el);
  // until an account is chosen for it, the chart and the book are its public listing's (or say why there are none), and the bar's figures
  // its row's, read again on the bar's beat (ttPoll); no market, no beat
  if (!TT.at) {
    ttMount(el);
    ttPoll();
  }
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
}

/* the bar's market read again every five seconds while the pane is the one showing: its price, its 24 hours, its funding, its session.
   Until an account is chosen for it, its row is read again instead — the markets read of its kind searched by its name as a search may hold
   it and asked for by its key (ui/trade.js tkQueryOf, tkReadKind: kept 15 s, its own read, so never taken for the kind's own list; the key
   finds the row though twelve busier ones share the first words of its question), the row with its key kept as TT.row — so a market outside
   the busiest of its kind (one found by the picker's search, one opened from Markets) is as fresh as one in that list. While another pane
   shows, or the page is hidden, the beat goes on and asks nothing, so the first beat back on Trade reads it again (the pane is only put
   aside, and nothing else would start the beat again for the market still showing). A read refused, or a markets read that did not list
   the row, keeps the figures showing, said with when they were read and the source's words (ttStats) */
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
      } else TT.said = refusalOf(b) || "the market could not be read";
    } else {
      const got = await tkReadKind(tkKindOf({ item }), tkQueryOf(item), item.key || "");
      if (my !== TT.seq || !same()) return;
      const row = got.refused ? null : (got.items || []).find((y) => y.key === item.key) || null;
      if (row) {
        TT.row = row;
        TT.readAt = Date.now();
        TT.said = "";
      } else TT.said = got.refused || "the markets read did not list it";
    }
    ttStats(el);
    ttPoll();
  }, TT_READ_MS);
}

/* a figure in the bar: its name over its value; only what a source said */
const ttStat = (name, value, cls = "") => (value === undefined || value === null || value === "" ? "" : `<div class="tt-st"><span class="tt-st-n">${esc(name)}</span><span class="tt-st-v ${cls}">${value}</span></div>`);
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
    ttStat(stock ? "Day change" : "24h change", change, dir),
    ttStat("24h volume", vol !== undefined ? esc(ttVol(vol)) : x.contracts24h !== undefined ? `${esc(String(x.contracts24h))} contracts` : ""),
  ];
  if (m && m.bid !== undefined && m.ask !== undefined && !ev) parts.push(ttStat("Bid · Ask", `${esc(px(m.bid))} · ${esc(px(m.ask))}`));
  if ((x.kind === "perp" || (m && m.kind === "perp")) && m && m.fundingRate !== undefined) parts.push(ttStat("Funding", `${(m.fundingRate * 100).toFixed(4)}%${m.nextFundingAt ? ` <span class="dim">· next ${esc(nyTime(m.nextFundingAt))}</span>` : ""}`, m.fundingRate > 0 ? "down" : m.fundingRate < 0 ? "up" : ""));
  if (m && m.session) parts.push(ttStat("Session", esc(ttSessionWord(m.session))));
  if (ev && x.closeTime) parts.push(ttStat("Closes", esc(`${nyDay(x.closeTime)} ${nyTime(x.closeTime)} New York`)));
  // where the price is from, and — once it is not the last minute or two's — when it is from, as Markets says it (ui/markets.js
  // mkQuoteWords): "real time" is the source, not the price's age, and a real-time source's last trade in pre-market can be yesterday's
  if (m && m.quoteFrom) parts.push(ttStat("Price from", esc(typeof mkQuoteWords === "function" ? mkQuoteWords(m.quoteFrom, m.quoteAt) : m.quoteFrom)));
  // the venue's market (or, no account chosen, the row) not read on the last beat: the figures above are the last read's, and say since
  // when — or since the market was picked, before any beat read it — with the source's words. A row its kind's own fresh read lists is
  // shown from that read: nothing to say of it
  if (TT.said && (TT.at ? !!m : !fresh)) parts.push(`<p class="tt-said" role="status">${esc(`Not read again since ${TT.readAt ? `${nyTime(new Date(TT.readAt).toISOString())} New York` : "it was picked"}: ${TT.said}`)}</p>`);
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
/* the orders still open in the lens — the ones Under way lists (ui/trade.js tkOpenOrders: an agent's lens keeps that agent's) */
const ttOpenCount = () => (A && Array.isArray(A.orders) ? tkOpenOrders().length : 0);

/* Positions: everything held at the venues in the lens that the venues list as positions — a perpetual, a share, a coin a paper account
   holds, an event contract — with its entry, its mark, what it is worth and its result; Close… is the close sheet (ui/trade.js openClose).
   A venue whose positions could not be read is named under them with its own words (one that does not serve this network, in one quiet
   line); while one is missing, "nothing held" is said only of the venues that answered */
function ttPositions(box, owner) {
  if (!box) return;
  api("/api/account/positions", { ttl: 10_000 }).then((b) => {
    if (!box.isConnected || TT.tab !== "positions") return;
    if (!b || b.ok === false) return void paint(box, `<p class="msg no">${esc(refusalOf(b) || "The positions could not be read.")}</p>`);
    const lens = lensNow();
    const list = (b.positions || []).filter((p) => p.qty > 0 && tkVenueIn(p.venue, lens));
    const miss = (b.missing || []).filter((m) => tkVenueIn(m.venue, lens));
    const failed = miss.filter((m) => !awayMiss(m));
    const missing = `${awayLine(miss.filter(awayMiss), { cls: "small dim tt-miss" })}${failed.length ? `<ul class="tt-miss">${failed.map((m) => `<li><b>${esc(m.venueName || nameOf(m.venue))}</b> could not be read: ${esc(m.why || "no answer")}</li>`).join("")}</ul>` : ""}`;
    if (!list.length) return void paint(box, `<p class="empty">${miss.length ? "Nothing held in positions at the venues that answered." : `Nothing held in positions${lens.kind === "all" ? "" : " here"}.`}</p>${missing}`);
    const closable = (p) => { const v = connected().find((x) => x.id === p.venue); return owner && writesOn() && !!v && canTrade(v) && !!v.trade && !!v.trade.positions; };
    const at = (p, n) => (n === undefined || n === null ? "—" : esc(p.kind === "event" ? cents(n) : px(n)));
    const rows = list.map((p, i) => `<tr><td><b>${esc(p.name)}</b>${p.paper ? ' <span class="tag paper">Paper</span>' : ""}<span class="why">${esc(p.venueName || nameOf(p.venue))}</span></td><td class="r ${p.side === "short" ? "down" : "up"}">${esc(p.side === "short" ? "Short" : "Long")} ${esc(qtyOf(p.qty))}${p.leverage && p.leverage > 1 ? ` · ${esc(String(p.leverage))}x` : ""}</td><td class="r">${p.usd !== undefined ? money(p.usd) : "—"}</td><td class="r">${at(p, p.entryPrice)}</td><td class="r">${at(p, p.markPrice)}</td><td class="r">${chg(p.unrealizedUsd, "$")}</td><td class="r">${p.liquidationPrice ? esc(px(p.liquidationPrice)) : '<span class="flat">—</span>'}</td><td class="r">${closable(p) ? `<button type="button" class="btn btn-sm" data-tt-close="${i}">${p.kind === "perp" || p.kind === "future" ? "Close…" : "Sell…"}</button>` : ""}</td></tr>`).join("");
    paint(box, `<div class="t-wrap"><table class="t tt-t"><thead><tr><th>Market</th><th class="r">Size</th><th class="r">Value</th><th class="r">Entry</th><th class="r">Mark</th><th class="r">P&amp;L</th><th class="r">Liq.</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${missing}`);
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

/* Trade history: the statement's trades in the lens, newest first — what filled, at what, for how much, and who placed it. Real money or
   Paper by the line's own word (a paper account closed since is still Paper), one venue by its account, an agent's lens that agent's */
function ttHistory(box) {
  if (!box) return;
  api("/api/account/statement", { ttl: 10_000 }).then((b) => {
    if (!box.isConnected || TT.tab !== "history") return;
    if (!b || b.ok === false) return void paint(box, `<p class="msg no">${esc(refusalOf(b) || "The statement could not be read.")}</p>`);
    const lens = lensNow();
    const here = (l) => (lens.kind === "real" ? !l.paper : lens.kind === "paper" ? !!l.paper : inLens(l.account, l.agent));
    const lines = (b.lines || []).filter((l) => l.type === "trade" && here(l)).slice(0, 40);
    if (!lines.length) return void paint(box, '<p class="empty">No trades yet.</p>');
    paint(box, `<div class="t-wrap"><table class="t tt-t"><thead><tr><th>Time</th><th>Order</th><th>Status</th><th class="r">Amount</th><th class="r">Fee</th><th>By</th></tr></thead><tbody>${lines.map((l) => `<tr><td class="tab-nums">${esc(nyDay(l.updatedAt || l.at))} ${esc(nyTime(l.updatedAt || l.at))}</td><td><span class="${l.kind === "sell" ? "down" : "up"}">${esc(l.kind === "sell" ? "Sell" : "Buy")}</span> ${esc(l.description.replace(/^(Buy|Sell) /, ""))}<span class="why">${esc(l.accountName)}${l.paper ? " · paper" : ""}</span></td><td>${esc(l.status)}</td><td class="r">${chg(l.amountUsd, "$")}</td><td class="r">${l.feeUsd !== undefined ? fine(l.feeUsd) : "—"}</td><td>${esc(l.by || "")}</td></tr>`).join("")}</tbody></table></div>`);
  });
}

/** the pane drawn: the bar's figures and the tabs under the panels; a market to start from while nothing has shown on this frame yet and
 * no ticket was opened on purpose — the busiest of the kind showing, at the first account that trades it (nothing takes the focus). After
 * that nothing is picked by itself: a ticket the owner opened on no market (the "t" key, a venue's Trade, Change) is left as it is */
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
