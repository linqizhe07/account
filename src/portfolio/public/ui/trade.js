/* Trade: take a position in a market. One ticket, six faces — the market kind is the module: Crypto · Stocks · RWAs · Perps · Pre-IPO ·
   Predictions, the same words in the same order as Markets. The pane holds the kind seg, a picker for the chosen kind (You hold · Recent ·
   Most traded) and what is under way; the panel on the right holds the ticket (or the composer, when a market is handed to an agent). An
   order is prepared by the account, shown in words with what is signed, and placed by the owner's signature; a venue that refuses says so
   in its own words. Also here: the ticket that changes an open order, a wallet sending what the account built for a DEX order, and the
   close of a position (Portfolio and the market drawer open it). Money already held — move, convert, earn, sell many — lives with the
   holdings (Portfolio: money.js, earn.js). */

// ---- an order in words, changing one, a wallet sending one -------------------------------

/* an event contract's price as a person reads it: cents, which is also the market's chance in percent (core cents: the same figure Markets
   shows is the one the ticket signs) */
const tkCents = cents;
/* a price typed on a ticket: an event contract's in cents (62 → 0.62) — a chance is between 0¢ and 100¢, so a figure outside that is no
   price ("", and the ticket says so); anything else as it was typed */
const tkPriceIn = (s, inCents) => {
  const t = String(s ?? "").trim();
  if (!inCents || t === "" || !Number.isFinite(Number(t))) return t;
  const n = Number(t);
  if (n < 0 || n > 100) return "";
  return String(Number((n / 100).toFixed(6)));
};
/* a figure typed in cents that is no chance: outside 0–100 */
const tkCentsBad = (s) => { const t = String(s ?? "").trim(); return t !== "" && Number.isFinite(Number(t)) && (Number(t) < 0 || Number(t) > 100); };
/* beside a prediction's prices under What you sign: the dollars the account signs, read back in the cents the owner typed */
function tkSignNotes(p, ev) {
  if (!ev || !p || !p.action) return null;
  const out = {};
  for (const k of ["limitPrice", "stopPrice"]) if (p.action[k] !== undefined && p.action[k] !== "" && Number.isFinite(Number(p.action[k]))) out[k] = `${k === "limitPrice" ? "limit" : "stop"} ${cents(p.action[k])} (${money(p.action[k])} a contract)`;
  return Object.keys(out).length ? out : null;
}

/** change an open order in place: a new size, limit or stop. The account values it afresh and shows what it would be worth; your signature changes it */
function openAmend(o) {
  if (!o) return;
  const limited = o.type === "limit" || o.type === "stop_limit";
  const stopped = o.type === "stop" || o.type === "stop_limit";
  const ev = o.kind === "event";
  const was = (n) => (ev ? String(Number((Number(n) * 100).toFixed(2))) : String(n));
  quoteDialog({
    title: `Change ${o.id}`,
    sub: esc(`${o.venueName} · ${o.side === "buy" ? "Buy" : "Sell"} ${qtyOf(o.qty)} ${ev ? "contracts" : o.base} · ${typeText(o)}. Leave a field empty to keep it.`),
    fields: `<div class="row">${field("Size", `<input name="qty" inputmode="decimal" placeholder="${esc(String(o.qty))}" autocomplete="off" />`)}${stopped ? field(ev ? "Stop (¢)" : "Stop price", `<input name="stopPrice" inputmode="decimal" placeholder="${esc(was(o.stopPrice))}" autocomplete="off" />`) : ""}${limited ? field(ev ? "Limit (¢)" : "Limit price", `<input name="limitPrice" inputmode="decimal" placeholder="${esc(was(o.limitPrice))}" autocomplete="off" />`) : ""}</div>`,
    draft: (form) => {
      const f = formFields(form);
      const d = { type: "liveAmend", venue: o.venue, order: o.id, qty: String(f.qty || "").trim(), limitPrice: tkPriceIn(f.limitPrice, ev), stopPrice: tkPriceIn(f.stopPrice, ev) };
      if (ev && (tkCentsBad(f.limitPrice) || tkCentsBad(f.stopPrice))) return "A price in cents is between 0 and 100: a contract pays $1.00 at most.";
      return d.qty || d.limitPrice || d.stopPrice ? d : "Type what changes.";
    },
    show: (p) => {
      const q = p.quote.order;
      return `<div class="big"><span>${esc(q.words)}</span><span>≈ ${money(q.notionalUsd)}</span></div><div class="path">${o.side === "buy" ? `costs at most ${money(q.maxUsd)}` : `worth about ${money(q.maxUsd)}`}</div>${q.paper ? '<div class="path tk-paper">Paper account: no real money changes hands.</div>' : ""}`;
    },
    signNotes: (p) => tkSignNotes(p, ev),
    done: (r) => (r.body.order ? `Changed: ${r.body.order.id} · ${r.body.order.note}` : ""),
    go: "Sign and change",
  });
}

/* Robinhood Chain, for a wallet that does not know it yet: the wallet shows it to the owner before adding it (chain 4663; its own RPC and
   the explorer Robinhood publishes for it, docs.robinhood.com/chain/connecting) */
const TK_ROBINHOOD_CHAIN = { chainId: "0x1237", chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.chain.robinhood.com/"], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"] };
/* a wallet's "I don't know that chain" (EIP-3085: 4902), as wallets wrap it */
const tkUnknownChain = (err) => !!err && (err.code === 4902 || (err.data && err.data.originalError && err.data.originalError.code === 4902));

/** the wallet on the transaction's chain: switched to it; a wallet that does not know Robinhood Chain is offered it first */
async function tkSwitchChain(w, chainIdHex) {
  try {
    await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (err) {
    if (!(tkUnknownChain(err) && String(chainIdHex).toLowerCase() === TK_ROBINHOOD_CHAIN.chainId)) throw new Error(`${w.info.name} did not switch to the right network: ${(err && err.message) || err}`);
    try {
      await w.provider.request({ method: "wallet_addEthereumChain", params: [TK_ROBINHOOD_CHAIN] });
      await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err2) {
      throw new Error(`${w.info.name} did not add Robinhood Chain: ${(err2 && err2.message) || err2}`);
    }
  }
}

/** a DEX order: the account built the transactions (an approval first, when one is needed); the wallet shows each one and sends it */
async function sendOrderFromWallet(o) {
  if (INFLIGHT.has(o.clientId)) throw new Error(`${o.id} is already waiting for your wallet: finish it there`);
  INFLIGHT.add(o.clientId);
  try {
    await sendOrderOnce(o);
  } finally {
    INFLIGHT.delete(o.clientId);
  }
}
async function sendOrderOnce(o) {
  // asked again first: an order taken back since this page last read it is not sent
  const now = ((await (await fetch("/api/account")).json()).orders || []).find((x) => x.id === o.id);
  if (!now || now.ref || !["pending"].includes(now.status)) throw new Error(`${o.id} is no longer waiting for your wallet (${now ? now.status : "gone"}): nothing was sent`);
  // the account already has a hash for it: that one is reported again, nothing new is sent
  if (now.reported) SENT.set(o.clientId, now.reported);
  const txs = now.walletTxs || [];
  if (!txs.length) return;
  const w = await walletFor(txs[0].from);
  const send = async (tx) => {
    await tkSwitchChain(w, tx.chainIdHex);
    return w.provider.request({ method: "eth_sendTransaction", params: [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value, ...(tx.gas ? { gas: tx.gas } : {}) }] });
  };
  let swap = txs[txs.length - 1];
  if (txs.length > 1 && !SENT.get(o.clientId)) {
    // the approval first, on chain before the swap; then the swap built again from a fresh quote, so a slow approval leaves no stale swap
    for (const tx of txs.slice(0, -1)) await mined(w, await send(tx));
    const fresh = await postJson("/api/account/live/order-requote", { order: o.id });
    if (fresh.status === 200 && fresh.body.order && fresh.body.order.walletTxs) swap = fresh.body.order.walletTxs[fresh.body.order.walletTxs.length - 1];
    else if (fresh.status !== 200 && !(fresh.body.refusal && /cannot build the swap again/.test(fresh.body.refusal.message))) throw new Error(Owner.why(fresh) || "the swap could not be built again");
  }
  // a swap the wallet already sent is reported again, never sent twice: the chain may simply not show it yet
  const hash = SENT.get(o.clientId) || (await send(swap));
  SENT.set(o.clientId, hash);
  const r = await postJson("/api/account/live/order-sent", { order: o.id, hash });
  if (r.status !== 200) throw new Error(`${Owner.why(r) || "the account could not take the transaction"}. Your wallet sent ${short(hash)}: “Report again” reports that same transaction, it does not send another`);
  SENT.delete(o.clientId);
  said = `${w.info.name} sent it: ${short(hash)}`;
}

/* what an order's size is counted in, by the kind of market (a coin's own name when it is "") */
const UNITS = { spot: "", perp: "contracts", future: "contracts", stock: "shares", crypto: "", event: "contracts", token: "" };

// ---- the six kinds ------------------------------------------------------------------------------

/* the six kinds, in the order Markets shows them (the server's TabIds): the word, the icon, the explore kinds its picker keeps, the market
   kinds a venue declares that put it here (accounts.ts tradeKinds; RWAs and Pre-IPO are told by the rows themselves), the side words, and
   what the picker's search suggests */
const TK_KINDS = [
  { id: "crypto", label: "Crypto", icon: "trade", explore: ["coin"], venue: ["spot", "crypto", "token"], side: ["Buy", "Sell"], hint: "Search BTC, ETH, a token…" },
  { id: "stocks", label: "Stocks", icon: "stock", explore: ["stock"], venue: ["stock"], side: ["Buy", "Sell"], hint: "Search AAPL, NVDA…" },
  { id: "rwas", label: "RWAs", icon: "rwa", explore: ["rwa"], venue: [], side: ["Buy", "Sell"], hint: "Search a tokenised stock or fund…" },
  { id: "perps", label: "Perps", icon: "perps", explore: ["perp"], venue: ["perp", "future"], side: ["Long", "Short"], hint: "Search BTC, ETH, SOL…" },
  { id: "preipo", label: "Pre-IPO", icon: "preipo", explore: ["perp"], venue: [], side: ["Long", "Short"], hint: "Search a company…" },
  { id: "predictions", label: "Predictions", icon: "prediction", explore: ["event"], venue: ["event"], side: ["Buy", "Sell"], hint: "Search the Fed, an election…" },
];
const TK_KIND_IDS = TK_KINDS.map((k) => k.id);
const tkKindSpec = (id) => TK_KINDS.find((k) => k.id === id) || TK_KINDS[0];
/* the market kinds a venue declares it trades */
const tkVenueKinds = (v) => (v.trade && v.trade.kinds) || [];
/* a perpetual on a private company's implied valuation, as its row or market says it (F5: category "Pre-IPO", `implied`, a company group) */
const tkPre = (x) => !!x && (x.category === "Pre-IPO" || !!x.implied || /^preipo:/.test(String((x.group && x.group.id) || "")));
/* the old names for a face: the tiles and ticket variants of the page before this one, a Markets row's kind, a market's kind */
const TK_KIND_ALIAS = { trade: "crypto", buy: "crypto", swap: "crypto", coin: "crypto", spot: "crypto", token: "crypto", stock: "stocks", stocks: "stocks", rwa: "rwas", rwas: "rwas", perp: "perps", future: "perps", perps: "perps", preipo: "preipo", "pre-ipo": "preipo", event: "predictions", prediction: "predictions", predictions: "predictions" };

/** which face a preset, a Markets row or a market belongs to: the kind named (one of the six, or an old name for one), else what the
 * thing is (a perpetual on a company's valuation is Pre-IPO whatever it is called), else what the venue named trades, else Crypto */
function tkKindOf(x = {}) {
  const pre = tkPre(x) || tkPre(x.item);
  const named = String(x.kind || x.variant || x.tile || (x.item && x.item.kind) || "").toLowerCase();
  const id = TK_KIND_IDS.includes(named) ? named : TK_KIND_ALIAS[named] || "";
  if (id === "perps" && pre) return "preipo";
  if (id) return id;
  if (pre) return "preipo";
  const v = x.venue && A ? A.venues.find((y) => y.id === x.venue) : null;
  const kinds = v ? tkVenueKinds(v) : [];
  if (kinds.length) for (const k of TK_KINDS) if (k.venue.length && kinds.every((m) => k.venue.includes(m))) return k.id;
  return "crypto";
}
/* a market's kind as the Markets rows name it */
const tkRowKind = (m) => (m.kind === "event" ? "event" : m.kind === "perp" || m.kind === "future" ? "perp" : m.kind === "stock" ? "stock" : m.category === "RWA" ? "rwa" : "coin");

/** the kinds the seg shows: one a connected venue (in the lens) declares, or one whose read has rows — connected venues' markets and the
 * public venues' listings alike ("Connect to trade" there); under a venue's lens, only rows that venue lists. A kind with nothing is not shown */
/* the accounts in the lens: every one, the real ones (Real money), the paper ones (Paper), or the one venue */
const tkMine = (L, lens) => (!lens || lens.kind === "all" || lens.kind === "agent" ? L : lens.kind === "venue" ? L.filter((v) => v.id === lens.id) : lens.kind === "paper" ? L.filter((v) => v.paper) : L.filter((v) => !v.paper));
/* a venue is in the lens */
const tkVenueIn = (id, lens) => (!lens || lens.kind === "all" || lens.kind === "agent" ? true : lens.kind === "venue" ? id === lens.id : lens.kind === "paper" ? paperVenue(id) : !paperVenue(id));
/* a row is in the lens: under a venue, listed by it; under Paper, by a paper account; under Real money, by a real account or a public venue */
const tkInLens = (x, lens) => {
  if (!lens || lens.kind === "all" || lens.kind === "agent") return true;
  const at = x.at || [];
  if (lens.kind === "venue") return at.some((a) => a.venue === lens.id && a.connected);
  if (lens.kind === "paper") return at.some((a) => a.paper || (a.connected && paperVenue(a.venue)));
  return at.some((a) => a.public || (a.connected && !a.paper && !paperVenue(a.venue)));
};
function tkKindsFor(venues, got, lens) {
  const here = (x) => tkInLens(x, lens);
  return TK_KINDS.filter((k) => venues.some((v) => tkVenueKinds(v).some((m) => k.venue.includes(m))) || ((got[k.id] && got[k.id].items) || []).some(here)).map((k) => k.id);
}

// ---- the pane: the kind seg, the picker, what is under way -------------------------------

/* the pane's own state: the kind chosen, a ticket asked for before the pane was drawn, which ticket is current (a ticket replaced by another
   writes nothing late), each kind's last read, the leverage the door just set (shown until the positions read agrees), a venue being
   connected from the ticket, and the route already opened */
const TK = { kind: "", pending: null, gen: 0, got: {}, lev: null, connecting: null, draftLooked: false, routed: "", drawnKind: "" };
const TK_LEGACY_TILE = { trade: "crypto", swap: "crypto", perps: "perps", predictions: "predictions" };
onRoute((tab, params) => {
  if (tab !== "trade") return;
  // the route names the kind (a seg press, a Markets row, a preset), or an old tile; earn and sell many live with the holdings now
  if (TK_KIND_IDS.includes(params.kind)) TK.kind = params.kind;
  else if (TK_LEGACY_TILE[params.tile]) TK.kind = TK_LEGACY_TILE[params.tile];
  if ((params.tile === "earn" || params.tile === "sellmany") && TK.routed !== `tile:${params.tile}`) {
    TK.routed = `tile:${params.tile}`;
    const open = params.tile === "earn" ? (typeof openEarn === "function" ? openEarn : null) : typeof openSellMany === "function" ? openSellMany : null;
    if (open) setTimeout(() => A && open({}), 0);
  }
  // a market in the route (#/trade?kind=perps&venue=ex&symbol=…): one ticket, once
  const sig = params.venue || params.symbol ? JSON.stringify([params.kind || "", params.venue || "", params.symbol || "", params.side || "", params.outcome || ""]) : "";
  if (sig && TK.routed !== sig) {
    TK.routed = sig;
    TK.pending = { kind: TK.kind, venue: params.venue || "", symbol: params.symbol || "", side: params.side || "", outcome: params.outcome || "" };
  } else if (!sig && !/^tile:/.test(TK.routed)) TK.routed = "";
});

/** the Trade pane: the head and a line of state, the kind seg (drawn by hand: its buttons carry icons), the picker for the kind chosen,
 * what is under way; the panel on the right keeps the ticket (or the composer) across redraws */
function renderTrade({ el, owner, lens, params }) {
  // the pane is a trading screen (ui/terminal.js): the market bar, the chart, the book and trades, the order panel, and the tabs under them
  if (!el.querySelector("[data-tp]")) {
    el.innerHTML = ttFrame();
    TT.mounted = "";
    TT.started = false;
    tkRest();
    if (!TK.pending) tkReopenDraft();
  }
  tkDrawPane(el, owner, lens);
  ttDraw(el, owner);
  // a venue connected from the ticket's "Connect to trade" is on the account now: the ticket offers it
  let redone = false;
  if (TK.connecting) {
    const c = TK.connecting;
    const fresh = A.venues.find((v) => v.live && !c.before.has(v.id));
    if (c.gen !== TK.gen) TK.connecting = null;
    else if (fresh) {
      TK.connecting = null;
      redone = true;
      c.redo(fresh.id);
    }
  }
  // the accounts that trade from here changed (one came back after a restart, one was connected elsewhere) while the ticket shows a market
  // none of them traded: it is looked up again, so an account that trades it now is offered (no venue picked: no order was drawn to lose)
  const traders = A.venues.filter((v) => v.live && v.trade && canTrade(v)).map((v) => v.id).sort().join(",");
  if (TK.tradersSeen !== undefined && TK.tradersSeen !== traders && !redone && !TK.connecting && typeof TK.refindIdle === "function") TK.refindIdle();
  TK.tradersSeen = traders;
  // what was asked for before the pane was drawn (a Markets row, a quick action, the route) opens now
  if (TK.pending) {
    const p = TK.pending;
    TK.pending = null;
    tkOpen(p);
  }
  // every read of the account comes through here (a fill included): the ticket's Available to trade and Current position follow it
  if (typeof TK.refreshAvail === "function") TK.refreshAvail();
  void params;
}

/* the pane's left column from what is known now: the state line, a note when nothing can be traded, the seg, the picker, Under way. Drawn
   again (each part through paint) when a kind's read lands */
function tkDrawPane(el, owner, lens) {
  const L = connected();
  const mine = tkMine(L, lens);
  const traders = mine.filter((v) => v.trade && canTrade(v));
  const kinds = tkKindsFor(mine, TK.got, lens);
  if (!kinds.includes(TK.kind)) TK.kind = kinds.includes(TK.drawnKind) ? TK.drawnKind : kinds[0] || "";
  const state = el.querySelector("[data-tp-state]");
  const stateText = !A.connectLive ? "" : !writesOn() ? "Read-only: prices show, nothing is placed from here" : traders.length ? `${traders.slice(0, 3).map((v) => v.name).join(", ")}${traders.length > 3 ? ` and ${traders.length - 3} more` : ""} trade from here` : "No account trades from here yet";
  if (state.textContent !== stateText) state.textContent = stateText;
  const note = el.querySelector("[data-tp-note]");
  paint(note, !A.connectLive ? '<p class="empty">This server has no way to connect accounts.</p>' : !L.length && writesOn() ? `<div class="callout"><b>Connect an account that trades</b><span class="dim">An exchange, a broker, a prediction market or your wallet. Until then the public venues' prices show below, each with Connect to trade.</span><div><button type="button" class="btn btn-primary" data-tp-connect${owner ? "" : " disabled"}>${icon("plug")}Connect an account</button></div></div>` : "");
  // heard once, on the note itself: what it draws is drawn again in place
  if (!note.tpHeard) {
    note.tpHeard = true;
    note.addEventListener("click", (e) => {
      const c = e.target.closest && e.target.closest("[data-tp-connect]");
      if (c && !c.disabled) openPicker();
    });
  }
  tkDrawKinds(el.querySelector("[data-tp-kinds]"), kinds);
  tkPicker(el.querySelector("[data-tp-pick]"), TK.kind, mine, lens);
  tkDrawOpen(el.querySelector("[data-tp-open]"), owner);
  // the picker's rows carry data-pairs and data-q spans: Markets' poll prices them in place while they are on screen
  if (typeof mkWatchPane === "function") mkWatchPane(el);
  tkReadKinds();
}
/* the pane drawn again from where it stands, after a read landed: only while it is the pane showing */
function tkRedraw() {
  const el = $("pane-trade");
  if (!A || ROUTE.tab !== "trade" || !el || !el.querySelector("[data-tp]")) return;
  tkDrawPane(el, owns(), lensNow());
  ttDraw(el, owns());
}

/* the seg, by hand (core seg() renumbers and escapes its labels; these carry icons): the kind pressed is the route's */
function tkDrawKinds(box, kinds) {
  const html = kinds.map((id) => { const k = tkKindSpec(id); return `<button type="button" data-kind="${esc(id)}" aria-pressed="${String(id === TK.kind)}" data-fk="kind:${esc(id)}">${icon(k.icon, "sm")}${esc(k.label)}</button>`; }).join("");
  box.hidden = !kinds.length;
  if (!paint(box, html)) for (const b of box.querySelectorAll("button[data-kind]")) b.setAttribute("aria-pressed", String(b.dataset.kind === TK.kind));
  // heard once, on the seg itself: its buttons are drawn again in place
  if (box.tkHeard) return;
  box.tkHeard = true;
  box.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-kind]");
    if (b && box.contains(b)) tkSetKind(b.dataset.kind);
  });
}
function tkSetKind(id) {
  if (!TK_KIND_IDS.includes(id) || id === TK.kind) return;
  TK.kind = id;
  go("trade", { kind: id }, { replace: true });
}

// ---- the picker: one kind's rows, to pick from (Markets is the browse) -------------------------

const TK_READ_MS = 15_000;
/** one kind's rows — the connected venues' markets and the public venues' listings, busiest first (GET /api/account/explore?tab=<kind>);
 * with `q`, those matching it; with `key`, the row with that key alone, asked for before the list is cut to its twelve (a row whose words
 * twelve busier rows share is still found). Only the kind's own read (neither asked) is kept as the kind's (TK.got): a search or a row
 * asked for is its own read, kept apart by its address. A refusal (a kind this server does not know yet) is an empty list and no toast:
 * the kind has no rows */
async function tkReadKind(kind, q = "", key = "") {
  const body = await api(`/api/account/explore?${new URLSearchParams({ tab: kind, ...(q ? { q } : {}), ...(key ? { key } : {}), limit: "12" })}`, { ttl: TK_READ_MS });
  const ok = !!body && body.ok !== false;
  const spec = tkKindSpec(kind);
  const items = ok ? (body.items || []).filter((x) => spec.explore.includes(x.kind) && (kind === "preipo" ? tkPre(x) : kind === "perps" ? !tkPre(x) : true)) : [];
  const got = { at: Date.now(), items, missing: ok ? (body.missing || []).filter((m) => m.said || m.code === "E_VENUE_GEOBLOCKED") : [], refused: ok ? "" : refusalOf(body) };
  if (!q && !key) TK.got[kind] = got;
  return got;
}
/* what a market's row is searched again by (the terminal's beat, ui/terminal.js ttPoll; the ticket's refind after "Connect to trade"): its
   base, else its name — an event's whole question, which may be longer than a search may be (the account refuses one over 60 characters:
   GET /api/account/explore), cut at the last word that fits. A row is found by a part of its name, so the first words of its question still
   find it; its key, asked with them, picks it out of the rows those words find */
const TK_Q_MAX = 60;
function tkQueryOf(item) {
  const words = String((item && (item.base || item.name)) || "").trim();
  if (words.length <= TK_Q_MAX) return words;
  const cut = words.slice(0, TK_Q_MAX + 1).replace(/\s+\S*$/, "").trim();
  return (cut || words).slice(0, TK_Q_MAX);
}
/* every kind read once in a while (each kept 15 s), the kind showing first: the seg shows a kind as soon as its rows are known */
const TK_READING = new Set();
function tkReadKinds() {
  const stale = (k) => !TK_READING.has(k) && (!TK.got[k] || Date.now() - TK.got[k].at > TK_READ_MS);
  const order = [TK.kind, ...TK_KIND_IDS.filter((k) => k !== TK.kind)].filter((k) => k && stale(k));
  if (!order.length) return;
  for (const k of order) TK_READING.add(k);
  // drawn as each lands — or, while the pane is still coming in, once it has (core paneLater)
  Promise.all(order.map((k) => tkReadKind(k).then(() => {
    TK_READING.delete(k);
    if (k === TK.kind) paneLater("trade", tkRedraw);
  }, () => TK_READING.delete(k)))).then(() => paneLater("trade", tkRedraw));
}

/* a logo's address as a market row carried it (live/icons.ts): https only, of a sane length — anything else is not kept or shown */
const tkLogoUrl = (u) => typeof u === "string" && u.length <= 500 && /^https:\/\/[^\s"'<>]+$/.test(u);
/* the market rows read for this page, every kind (TK.got): where a row that is not a market row (a holding, a position, a market picked
   before) finds its logo — the row with its key, the event row that lists its outcome's symbol, the row with its venue's line */
const tkLoaded = () => Object.values(TK.got || {}).flatMap((g) => (g && Array.isArray(g.items) ? g.items : []));
const tkKeyIcon = (key) => (key ? (tkLoaded().find((x) => x.key === key && tkLogoUrl(x.icon)) || {}).icon || "" : "");
const tkEventIcon = (symbol) => (tkLoaded().find((x) => x.kind === "event" && tkLogoUrl(x.icon) && (x.outcomes || []).some((o) => (o.at || []).some((a) => a.symbol === symbol))) || {}).icon || "";
const tkPairIcon = (pair) => (tkLoaded().find((x) => tkLogoUrl(x.icon) && (x.at || []).some((a) => `${a.venue}|${a.symbol}` === pair)) || {}).icon || "";
/* a market picked before: the logo kept with it, else its row's if that row is read now */
const tkRecentIcon = (r) => (tkLogoUrl(r.icon) ? r.icon : tkKeyIcon(r.key));

/* the picker's rows and ticket openings remember the last markets picked, per kind (this browser; nothing signed) */
const TK_RECENT = "account.recent";
function tkRecentAll() {
  try {
    const l = JSON.parse(localStorage.getItem(TK_RECENT) || "[]");
    return Array.isArray(l) ? l.filter((r) => r && typeof r === "object" && r.venue && r.symbol) : [];
  } catch {
    return [];
  }
}
const tkRecent = (kind) => tkRecentAll().filter((r) => r.kind === kind).slice(0, 12);
function tkRecentAdd(e) {
  try {
    localStorage.setItem(TK_RECENT, JSON.stringify([{ kind: e.kind, key: e.key || "", name: String(e.name || e.symbol).slice(0, 120), base: e.base || "", venue: e.venue, venueName: e.venueName || "", symbol: e.symbol, ...(tkLogoUrl(e.icon) ? { icon: e.icon } : {}), at: Date.now() }, ...tkRecentAll().filter((r) => !(r.venue === e.venue && r.symbol === e.symbol))].slice(0, 36)));
  } catch {
    // storage off: the list lives as long as the page does not
  }
}

/* an implied company valuation in a few figures ($2.08T): Markets' own formatter where it is, else dollars */
const tkValuation = (usd) => (typeof mkValuation === "function" ? mkValuation(usd) : money(usd));
/* a row's connected legs, "venue|symbol": what the Markets poller asks fresh prices for (its mkWatchPane watches this pane's rows) */
const tkPairs = (x) => [...new Set((x.at || []).filter((a) => a.connected).map((a) => `${a.venue}|${a.symbol}`))].slice(0, 4);
const tkNoMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** the picker for one kind: a search scoped to it, then You hold · Recent · Most traded (each a short list painted on its own). On a change
 * of kind the frame is drawn afresh and the lists cross-fade (opacity and a small rise; none under reduced motion) */
function tkPicker(sec, kind) {
  if (!kind) {
    delete sec.dataset.kind;
    return void paint(sec, `<div class="sec-head"><h2 class="h2" id="tp-pick-h">Markets</h2></div><p class="empty">${A.connectLive ? "Nothing to trade is listed yet: the venues are being read." : "This server lists no markets."}</p>`);
  }
  if (sec.dataset.kind === kind) return void tkPickLists(sec, kind);
  const k = tkKindSpec(kind);
  const draw = () => {
    sec.dataset.kind = kind;
    TK.drawnKind = kind;
    TK.pq = "";
    sec.innerHTML = `<div class="sec-head"><h2 class="h2" id="tp-pick-h">${esc(k.label)}</h2><form class="tk-pfind" role="search" data-live>${icon("search", "sm")}<label class="sr" for="tk-pq">Search ${esc(k.label)}</label><input type="search" id="tk-pq" name="q" placeholder="${esc(k.hint)}" autocomplete="off" spellcheck="false" /></form></div><div class="tk-pg" data-pg="hold"></div><div class="tk-pg" data-pg="recent"></div><div class="tk-pg" data-pg="top"></div><div data-pg="foot"></div>`;
    const form = sec.querySelector("form");
    form.addEventListener("submit", (e) => e.preventDefault());
    let timer = 0;
    form.elements.q.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = form.elements.q.value.trim();
        TK.pq = q;
        if (!q) return void tkPickLists(sec, kind);
        tkReadKind(kind, q).then((got) => sec.dataset.kind === kind && TK.pq === q && tkPickLists(sec, kind, got));
      }, 300);
    });
    tkPickLists(sec, kind);
    // the lists come in: one of two names, so a fresh animation runs each time (the same name set twice would not restart it)
    const a = sec.classList.contains("tk-in-a");
    sec.classList.toggle("tk-in-a", !a);
    sec.classList.toggle("tk-in-b", a);
  };
  if (!sec.dataset.kind || tkNoMotion()) return void draw();
  sec.classList.add("tk-out");
  clearTimeout(TK.fadeTimer);
  TK.fadeTimer = setTimeout(() => {
    sec.classList.remove("tk-out");
    draw();
  }, 120);
}

/* the three lists from what is known now: what is held of this kind, the last markets picked, the busiest rows (or the rows matching the
   search, in which case the first two stand aside) */
function tkPickLists(sec, kind, search) {
  // a search typed stands while the page refreshes: only its own answer redraws the lists
  if (TK.pq && !search) return;
  const lens = lensNow();
  const L = connected();
  const mine = tkMine(L, lens);
  const here = (x) => tkInLens(x, lens);
  const got = TK.got[kind];
  const q = search ? TK.pq : "";
  const g = (name) => sec.querySelector(`[data-pg="${name}"]`);
  g("hold").hidden = !!q;
  g("recent").hidden = !!q;
  if (!q) {
    tkHoldGroup(g("hold"), kind, mine);
    const rec = tkRecent(kind).filter((r) => tkVenueIn(r.venue, lens));
    tkGroup(g("recent"), "Recent", rec.map((r) => tkRecentRow(r, kind)), "");
  }
  const items = search ? search.items.filter(here).slice(0, 12) : got ? got.items.filter(here).slice(0, 6) : null;
  if (!items) tkGroup(g("top"), "Most traded", null, "");
  else tkGroup(g("top"), q ? `Results for “${q}”` : "Most traded", items.map((x) => tkItemRow(x, kind)), q ? `Nothing matches “${q}” under ${tkKindSpec(kind).label}.` : `Nothing is listed under ${tkKindSpec(kind).label}${lens.kind === "venue" ? ` at ${lens.name}` : ""} yet.`);
  // the venues that did not answer this read, or do not serve this network, are simply not among a row's "public venues": the ticket lists
  // what answers from here and says nothing of the rest (Markets' "Why these, and what's not shown" has their words, folded). The foot is
  // the logos' credit, while the lists show one of Elbstream's (tkGroup keeps it so as each list lands)
  creditFor(sec, g("foot"), "tk-credit");
}
/* one list: its name, its rows (each a button), or a skeleton while its rows are being read, or the words for none */
function tkGroup(el, title, rows, empty) {
  if (!el) return;
  const body = rows === null ? '<div class="skel-rows" aria-hidden="true"><span class="skel"></span><span class="skel" style="width:70%"></span></div>' : rows.length ? `<ul class="tk-list" role="list">${rows.map((r, i) => `<li data-k="${esc(r.fk)}"><button type="button" data-i="${i}" data-fk="${esc(r.fk)}"${r.pairs && r.pairs.length ? ` data-pairs="${esc(r.pairs.join(","))}"` : ""}${r.title ? ` title="${esc(r.title)}"` : ""}>${r.av}<span class="tk-rn"><b>${esc(r.name)}</b><span class="dim small">${esc(r.sub)}</span></span><span class="tk-rp">${r.right}</span></button></li>`).join("")}</ul>` : empty ? `<p class="empty">${esc(empty)}</p>` : "";
  el.hidden = !body;
  // the rows a click opens are the ones last drawn; heard once, on the list itself (its rows are kept in place by their key)
  el.tkRows = rows || [];
  paint(el, body ? `<div class="label tk-pg-h">${esc(title)}</div>${body}` : "");
  // a list that lands after the others (the positions, read apart) may be the first to show one of Elbstream's logos: its credit follows
  const sec = el.parentElement;
  const foot = sec && sec.querySelector(':scope > [data-pg="foot"]');
  if (foot) creditFor(sec, foot, "tk-credit");
  if (el.tkHeard) return;
  el.tkHeard = true;
  el.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-i]");
    const r = b && el.contains(b) ? el.tkRows[Number(b.dataset.i)] : null;
    if (r) r.open();
  });
}
/* a market's name in a list: an event's short name — its event's title and the market's own words (markets.js mkShort) — its whole question
   then in the row's title (tkTitle); anything else by its name */
const tkName = (x) => { const s = typeof mkShort === "function" ? mkShort(x) : { name: String(x.name || ""), opt: "" }; return s.opt ? `${s.name} · ${s.opt}` : s.name; };
const tkTitle = (x) => (tkName(x) !== x.name ? String(x.name || "") : "");
/* a row from the markets read: its name, where it is listed, its price ticking in place (data-q, as Markets' rows), the day's change — a
   pre-IPO company's row says the implied valuation first, an event's its lead outcome's price in cents */
function tkItemRow(x, kind) {
  const pair = tkPairs(x)[0] || "";
  const q = pair ? ` data-q="${esc(pair)}"` : "";
  const imp = kind === "preipo" ? x.implied || ((x.at || []).find((a) => a.implied) || {}).implied : null;
  const right = x.kind === "event" ? `<span class="tab-nums"${q} data-fmt="c">${esc(tkCents(x.price))}</span>${x.closeTime ? `<span class="dim small">${esc(typeof mkLeft === "function" ? mkLeft(Date.parse(x.closeTime) - Date.now()) : nyDay(x.closeTime))}</span>` : ""}` : imp && imp.usd ? `<span class="tab-nums">${esc(tkValuation(imp.usd))} <span class="tag">implied</span></span><span class="dim small tab-nums"${q} data-fmt="usd">${x.price ? `$${esc(px(x.price))}` : ""}</span>` : `<span class="tab-nums"${q} data-fmt="usd">${x.price ? `$${esc(px(x.price))}` : ""}</span>${chg(x.changePct24h)}`;
  return { fk: `pick:${x.key}`, pairs: tkPairs(x), av: avatar(x.kind === "event" ? String(x.category || "Event").slice(0, 4) : x.base || x.name, "sm", x.icon || ""), name: tkName(x), title: tkTitle(x), sub: [kind === "preipo" ? "Pre-IPO" : x.kind === "event" ? x.category || "" : "", tkWhereWords(x)].filter(Boolean).join(" · "), right, open: () => tkPickOpen(x, kind) };
}
/* a market picked before, from this browser's own list */
const tkRecentRow = (r, kind) => ({ fk: `recent:${r.venue}:${r.symbol}`, pairs: A.venues.some((v) => v.id === r.venue && v.live) ? [`${r.venue}|${r.symbol}`] : [], av: avatar(r.base || r.name, "sm", tkRecentIcon(r)), name: r.name, sub: `${r.venueName || nameOf(r.venue)} · ${nyDay(r.at)}`, right: "", open: () => tkOpen({ kind, venue: r.venue, symbol: r.symbol, side: "buy", key: r.key, base: r.base, name: r.name }) });
/* a row picked: the ticket on it, at the first of your accounts that trades it (none: the public venues say Connect to trade there) */
function tkPickOpen(x, kind) {
  const at = (x.at || []).find((a) => a.connected && a.canTrade !== false) || (x.at || []).find((a) => a.connected) || null;
  tkOpen({ kind, item: x, venue: at ? at.venue : "", symbol: at ? at.symbol : "", side: "buy" });
  tkShowPanel();
}

/* the classes of holding each face is about (core CLASS): coins, shares, tokens an issuer stands behind, event contracts; perpetuals are
   positions, read from the venues that list them */
const TK_HOLD_CLASS = { crypto: "crypto", stocks: "equity", rwas: "rwa", predictions: "event" };
/** You hold: what is held of this kind at the venues in the lens — by asset across venues for coins, shares, tokens and contracts; the open
 * positions for perpetuals (a pre-IPO one is a position on a pre-IPO row's market) */
function tkHoldGroup(el, kind, venues) {
  if (!el) return;
  const cls = TK_HOLD_CLASS[kind];
  if (cls) {
    const by = new Map();
    for (const v of venues) for (const h of v.holdings || []) {
      if (h.class !== cls || h.inTransit || !(h.amount > 0) || (cls === "crypto" && isDollar(h.asset))) continue;
      const e = by.get(h.asset) || { asset: h.asset, amount: 0, usd: 0, venues: [], icon: "" };
      if (!e.icon && typeof h.icon === "string") e.icon = h.icon;
      e.amount += h.amount;
      e.usd += Number(h.usd) || 0;
      if (!e.venues.some((x) => x.id === v.id)) e.venues.push({ id: v.id, name: v.name });
      by.set(h.asset, e);
    }
    const rows = [...by.values()].sort((a, b) => b.usd - a.usd).slice(0, 6).map((e) => ({ fk: `hold:${e.asset}`, pairs: [], av: avatar(e.asset.split(":")[0], "sm", e.icon || (cls === "event" ? tkEventIcon(e.asset) : "")), name: e.asset, sub: `${qtyOf(e.amount)}${cls === "event" ? " contracts" : ""} · ${e.venues.map((v) => v.name).join(", ")}`, right: `<span class="tab-nums">${money(e.usd)}</span>`, open: () => tkOpen(cls === "event" ? { kind, venue: e.venues[0].id, symbol: e.asset, side: "sell" } : { kind, venue: e.venues[0].id, base: e.asset, side: "buy" }) }));
    return void tkGroup(el, "You hold", rows, "");
  }
  // perpetuals: the positions read (kept ten seconds; another part's forget() drops it)
  const want = new Set(venues.map((v) => v.id));
  api("/api/account/positions", { ttl: 10_000 }).then((body) => {
    if (!el.isConnected || !A) return;
    const prePairs = new Set(((TK.got.preipo && TK.got.preipo.items) || []).flatMap((x) => (x.at || []).map((a) => `${a.venue}|${a.symbol}`)));
    const all = body && body.ok !== false ? body.positions || [] : [];
    const rows = all.filter((p) => want.has(p.venue) && p.qty > 0 && (p.kind === "perp" || p.kind === "future") && (kind === "preipo") === prePairs.has(`${p.venue}|${p.symbol}`)).slice(0, 6).map((p) => ({ fk: `pos:${p.venue}:${p.symbol}`, pairs: [`${p.venue}|${p.symbol}`], av: avatar(p.name.split(/[\s/]/)[0], "sm", p.icon || tkPairIcon(`${p.venue}|${p.symbol}`)), name: p.name, sub: `${p.side} ${qtyOf(p.qty)}${p.leverage ? ` · ${p.leverage}x` : ""} · ${p.venueName || nameOf(p.venue)}`, right: `<span class="tab-nums">${p.usd !== undefined ? money(p.usd) : ""}</span>${chg(p.unrealizedUsd, "$")}`, open: () => tkOpen({ kind, venue: p.venue, symbol: p.symbol, side: "buy" }) }));
    tkGroup(el, "You hold", rows, "");
  });
}

// ---- the panel: the ticket at rest, opened, kept, handed to an agent --------------------------

/* the panel at rest: the empty ticket for the kind showing. At rest nothing takes the focus, so the page keeps refreshing while it is watched */
function tkRest() {
  tkOpen({ kind: TK.kind, rest: true });
}
/* the panel's head: the kind's tag, a title, and a close that puts the panel back at rest */
const tkHead = (title, kind) => `<div class="tk-h"><div class="tk-h-l">${kind ? `<span class="tag tk-ktag" data-tk-kind>${esc(tkKindSpec(kind).label)}</span>` : ""}<h2 class="tk-title" data-tk-title>${esc(title)}</h2></div><button type="button" class="icon-btn" data-tk-close aria-label="Close the ticket">${icon("x")}</button></div>`;
const tkWireHead = (panel) => {
  const b = panel.querySelector("[data-tk-close]");
  if (b) b.addEventListener("click", () => {
    tkDraftKeep(null);
    tkOpen({ kind: TK.kind, rest: true });
  });
};

/* the ticket being typed, kept in this browser until it is placed or closed, so a reload does not lose it. Only the ticket's own fields:
   the kind, where, which market, which way, how much, what it is paid with, the order's type and prices — never anything signed */
const TK_DRAFT = "account.ticket";
const TK_DRAFT_FIELDS = ["kind", "venue", "venueName", "symbol", "side", "outcome", "key", "base", "name", "amount", "unit", "pay", "orderType", "limitPrice", "stopPrice", "tif"];
const TK_DRAFT_MS = 24 * 3_600_000;
function tkDraftRead() {
  try {
    const d = JSON.parse(localStorage.getItem(TK_DRAFT) || "null");
    if (!d || typeof d !== "object" || !d.venue || !d.symbol || !(Date.now() - Number(d.at) < TK_DRAFT_MS)) return null;
    // a draft of the page before this one named a ticket variant: it is a kind now
    if (!d.kind && d.variant) d.kind = TK_KIND_ALIAS[String(d.variant).toLowerCase()] || "";
    const out = Object.fromEntries(TK_DRAFT_FIELDS.filter((k) => d[k] !== undefined && d[k] !== "").map((k) => [k, String(d[k]).slice(0, 120)]));
    if (!TK_KIND_IDS.includes(out.kind)) return null;
    return out;
  } catch {
    return null;
  }
}
function tkDraftKeep(d) {
  try {
    if (d) localStorage.setItem(TK_DRAFT, JSON.stringify({ ...d, at: Date.now() }));
    else localStorage.removeItem(TK_DRAFT);
  } catch {
    // storage off (a private window): the draft lives as long as the page
  }
}
/** a draft kept from an earlier visit: opened again, at rest (nothing takes the focus), only if its venue is still connected and still
 * lists its market; otherwise dropped without a word. A ticket opened meanwhile wins. While its market is read, the frame is the draft's:
 * the terminal does not start on the busiest market of its own over it (ui/terminal.js ttDraw) — the pane is drawn as the draft's read is
 * on its way, and the kinds' reads are often in already (shell.js reads them ahead). A draft dropped with nothing else opened meanwhile
 * gives the frame back: the pane drawn again starts on the busiest market of its kind */
async function tkReopenDraft() {
  if (TK.draftLooked) return;
  TK.draftLooked = true;
  const d = tkDraftRead();
  if (!d) return void tkDraftKeep(null);
  const v = A.venues.find((x) => x.id === d.venue && x.live);
  if (!v || !canTrade(v)) return void tkDraftKeep(null);
  if (typeof TT === "object") TT.started = true;
  const gen = TK.gen;
  const body = await api(`/api/account/market?${new URLSearchParams({ venue: d.venue, symbol: d.symbol })}`, { ttl: 3_000 });
  if (!body || body.ok === false || !body.market) {
    tkDraftKeep(null);
    if (gen === TK.gen && typeof TT === "object" && !TT.item) {
      TT.started = false;
      paneLater("trade", tkRedraw);
    }
    return;
  }
  if (gen !== TK.gen || !$("tk-panel")) return;
  TK.kind = d.kind;
  tkOpen({ ...d, rest: true });
}

/** Open the order ticket. preset { kind (one of the six; an old variant or tile name is read too), venue, symbol, side, outcome, item (a
 * Markets row), base, amount, unit, orderType }. It lives in the Trade pane's panel: from another pane, the page goes there first, on the
 * market's kind */
function openTicket(preset = {}) {
  if (!A) return;
  const kind = tkKindOf(preset || {});
  if (ROUTE.tab !== "trade" || !$("tk-panel")) {
    TK.pending = preset || {};
    TK.kind = kind;
    go("trade", { kind });
    return;
  }
  if (TK.kind !== kind) {
    TK.kind = kind;
    go("trade", { kind }, { replace: true });
  } else render();
  tkOpen(preset || {});
  tkShowPanel();
}

/* where the order panel sits under the chart (a terminal narrower than 1080 pixels: terminal.css lays it out by its own width, not the
   window's), it is brought into view when a market is picked, and only when it is out of view; beside the chart it is in view already */
function tkShowPanel() {
  const p = $("tk-panel");
  if (!p || !p.getBoundingClientRect) return;
  const r = p.getBoundingClientRect();
  if (r.top > window.innerHeight || r.bottom < 0) p.scrollIntoView({ behavior: tkNoMotion() ? "auto" : "smooth", block: "start" });
}

/* the composer in the panel, when the Trade pane is showing (intent.js asks this first): it carries the kind as a tag, nothing signed */
function tkHandInPanel(preset) {
  const panel = $("tk-panel");
  if (ROUTE.tab !== "trade" || !panel || typeof htaMount !== "function") return false;
  TK.gen++;
  const p = preset || {};
  htaMount(panel, { ...p, kind: p.kind === "earn" ? "earn" : tkKindOf(p) }, { close: () => tkOpen({ kind: TK.kind, rest: true }) });
  tkShowPanel();
  return true;
}

/** what a preset opens: the ticket on its kind. Earn and selling many are Portfolio's sheets now (earn.js): a preset in the old words goes
 * there when they are on the page, else the ticket rests */
function tkOpen(preset) {
  const panel = $("tk-panel");
  if (!panel || !A) return;
  const old = String(preset.variant || preset.tile || preset.kind || "");
  if (old === "earn" || old === "sellmany") {
    const open = old === "earn" ? (typeof openEarn === "function" ? openEarn : null) : typeof openSellMany === "function" ? openSellMany : null;
    if (open) return void open(preset);
    return void tkTicket(panel, TK.kind || "crypto", { rest: true });
  }
  tkTicket(panel, tkKindOf(preset), preset);
}

// ---- the ticket: one form, six faces -------------------------------------------------------------

const TK_TYPE_NAMES = { market: "Market", limit: "Limit", stop: "Stop", stop_limit: "Stop limit", trailing_stop: "Trailing stop" };
/* a number as a field takes it: no float tails, no exponent */
const tkPlain = (n) => { const t = Number(n).toFixed(10); return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t; };
/* down to a step: a sell never sells more than is held */
const tkFloor = (x, step) => (step > 0 ? Number((Math.floor(x / step + 1e-9) * step).toFixed(10)) : x);
const TK_TIF_NAMES = { gtc: "Until canceled", ioc: "Fill now, rest canceled", fok: "All now or nothing", day: "Today only" };
const TK_LIMITED = ["limit", "stop_limit"];
const TK_STOPPED = ["stop", "stop_limit"];

/** an order's draft from the ticket's fields: the market and side picked, the size in dollars or in the market's units, the limit and stop
 * (an event contract's typed in cents), the time in force and the flags the market takes */
function tkOrderDraft(f, { venue, symbol, side, event }) {
  const t = f.orderType || "market";
  const amount = String(f.amount || "").trim();
  const trail = String(f.trail || "").trim();
  // a bracket's exits, on a market or limit entry, with Take profit / Stop loss ticked: each only where it is typed
  const exits = (t === "market" || t === "limit") && !!f.tpsl;
  return { type: "liveOrder", venue, symbol, side, orderType: t, ...(f.unit === "qty" ? { qty: amount } : { usd: amount }), limitPrice: TK_LIMITED.includes(t) ? tkPriceIn(f.limitPrice, event) : "", stopPrice: TK_STOPPED.includes(t) ? tkPriceIn(f.stopPrice, event) : "", tif: f.tif || "", postOnly: t === "limit" && f.postOnly ? "true" : "", reduceOnly: f.reduceOnly ? "true" : "", extendedHours: t === "limit" && f.extendedHours ? "true" : "", trailPercent: t === "trailing_stop" && f.trailBy !== "price" ? trail : "", trailPrice: t === "trailing_stop" && f.trailBy === "price" ? trail : "", takeProfit: exits ? String(f.takeProfit || "").trim() : "", stopLoss: exits ? String(f.stopLoss || "").trim() : "" };
}

/* what a market's sizes are counted in where it trades — its order book, its trades, a position held in it: an event's contracts; a
   contract market's contracts where one contract is not one coin (OKX's BTC swap is 0.01 BTC a contract, and OKX counts its book, its trades
   and a position in contracts); else the coin or the share itself */
const tkSizeUnit = (m) => (!m ? "" : m.kind === "event" || (Number(m.contractSize) > 0 && Number(m.contractSize) !== 1) ? "contracts" : m.base || "");
/* the chain a wallet's holding is on: the first words of its note ("Base", "Ethereum · no price") */
const tkNoteChain = (note) => String(note || "").split(" · ")[0].trim().toLowerCase();
/* Hyperliquid's connections — to trade, its testnet's paper account, by address — whose lines are its ledgers, each named by its note
   (live/hyperliquid-trade.ts and live/address.ts balances): on an ordinary account the perps account ("perps · 400.00 withdrawable", or
   "perps" where Hyperliquid gave no withdrawable figure), each HIP-3 DEX's own perps account ("perps · <the DEX's name> (HIP-3) · …
   withdrawable", or without the figure) and spot ("spot", "spot · UBTC on …") are
   apart, and nothing moves between them for an order; under a unified account or portfolio margin the spot balances are the whole
   account ("spot and perps · unified account", "spot · one account with the perps (unified)") */
const TK_HL_CONNECTORS = ["live:hyperliquid-trade", "live:hyperliquid-paper", "live:hyperliquid"];
/* a Hyperliquid line is of the ledger market `m` is margined or paid from: a unified account's for every market; a HIP-3 perpetual's, its
   DEX's (the market's name says which: "NVDA perpetual on <the DEX's name> (HIP-3, xyz:NVDA)"); another perpetual's, the perps account's;
   a spot market's, the spot balances */
function tkHlLedger(h, m) {
  const note = String(h.note || "");
  if (/\bunified\b/.test(note)) return true;
  if (m.kind === "perp" || m.kind === "future") {
    const dex = /\bperpetual on (.+) \(HIP-3, [^)]*\)$/.exec(String(m.name || ""));
    // the withdrawable part is there only where Hyperliquid gave one: "perps" and "perps · <DEX> (HIP-3)" alone are the same ledgers
    return dex ? note === `perps · ${dex[1]} (HIP-3)` || note.startsWith(`perps · ${dex[1]} (HIP-3) · `) : /^perps(?:$| · -?[\d.]+ withdrawable\b)/.test(note);
  }
  return tkNoteChain(note) === "spot";
}

/** WHAT IS AVAILABLE TO TRADE at venue `v` in market `m`, from the account's read of the venue. Only what is at hand for an order there
 * counts: never money on its way, nothing lent out to earn, nothing waiting in an exchange's funding account (its note: "funding"), and
 * for a market on one chain (TOKEN/USDC@Base) nothing whose note names another chain; at Hyperliquid, nothing in a ledger the market is
 * not margined or paid from (tkHlLedger: an ordinary account's perps account, each HIP-3 DEX's and its spot balances are apart). Of that:
 * the dollars free to spend — its cash and stablecoins, each line's free part where the venue says how much of it is free (`freeUsd`: a
 * paper account's open perpetual is margin, none of it free; Hyperliquid's perps account is free only as far as it is withdrawable; a line
 * that does not say is free whole) — and what is held of the market: `held`, all of it (the position), and `qty`, the part a sell can sell
 * now — each line's free units where the venue says how many are (`freeAmount`: not locked in an order resting there), else all of it. A
 * perpetual's or an event's holding is its position as the venue's positions read gave it (`positions`); not read (null) it is no figure
 * at all, never a zero, with the venue's words for why (`unread`) when it said some. Paying with a coin held (`pay`: its asset and the
 * note of its line, as Pay with names it), what is there to pay with is that coin's free units (`coin`). At MetaMask a perpetual's dollars
 * are not known (null): it trades Hyperliquid's perpetuals through mm, margined in the Hyperliquid account, and the wallet's lines are its
 * chains' balances, none of which margins one; likewise an event there is Polymarket's, paid in pUSD from the Predict deposit wallet
 * (live/metamask.ts) — not from these lines (`marginAt` names where the money is) */
function tkAvail(v, m, { positions = null, unread = "", pay = null } = {}) {
  if (!v || !v.id || !m) return null;
  const perp = m.kind === "perp" || m.kind === "future";
  const marginAt = v.connector !== "live:metamask" ? "" : perp ? "Hyperliquid" : m.kind === "event" ? "Predict deposit" : "";
  const lines = Array.isArray(v.holdings) ? v.holdings.filter((h) => h && !h.inTransit) : null;
  const chain = m.kind === "token" && String(m.symbol || "").includes("@") ? String(m.symbol).split("@").pop().trim().toLowerCase() : "";
  // a note that names a chain names one the account knows (a paper account's note names its market, an exchange's its ledger)
  const chains = new Set([...networksOf(), ...bridgeChainsOf()].map((c) => String(c).toLowerCase()));
  // at Hyperliquid, only the market's own ledger (tkHlLedger): an ordinary account's spot dollars do not margin a perpetual, nor its perps
  // account pay for spot
  const hl = TK_HL_CONNECTORS.includes(v.connector);
  const atHand = (h) => { const where = tkNoteChain(h.note); return h.class !== "earn" && where !== "funding" && (!chain || where === chain || !chains.has(where)) && (!hl || tkHlLedger(h, m)); };
  const hand = lines ? lines.filter(atHand) : null;
  const free = (h) => (h.freeUsd !== undefined && h.freeUsd !== null ? Math.max(0, Math.min(num(h.usd), num(h.freeUsd))) : num(h.usd));
  const cash = marginAt ? null : hand ? Number(hand.filter((h) => h.class === "cash" || h.class === "stable").reduce((s, h) => s + free(h), 0).toFixed(2)) : num(v.cashUsd);
  // a line's units free to sell now: those the venue says are not locked in a resting order, else all of them
  const freeQty = (h) => (h.freeAmount !== undefined && h.freeAmount !== null ? Math.max(0, Math.min(num(h.amount), num(h.freeAmount))) : num(h.amount));
  const units = (L, part) => Number(L.reduce((s, h) => s + part(h), 0).toPrecision(12));
  let qty = 0;
  let held = 0;
  let side = "";
  if (perp || m.kind === "event") {
    const h = Array.isArray(positions) ? positions.find((x) => x.venue === v.id && x.symbol === m.symbol && x.qty > 0) || null : null;
    qty = Array.isArray(positions) ? (h ? h.qty : 0) : null;
    held = qty;
    side = h ? h.side : "";
  } else {
    const base = String(m.base || "").toUpperCase();
    const mine = (hand || []).filter((h) => String(h.asset).toUpperCase() === base && h.amount > 0);
    held = units(mine, (h) => num(h.amount));
    qty = units(mine, freeQty);
    side = held > 0 ? "long" : "";
  }
  // the coin paid with is the line Pay with named (payOptions: a coin held, by its asset and its note), sold on its own chain
  const coin = pay && pay.asset ? { asset: pay.asset, qty: units((lines || []).filter((h) => h.class === "crypto" && h.amount > 0 && String(h.asset).toUpperCase() === String(pay.asset).toUpperCase() && (h.note || "") === (pay.chain || "")), freeQty) } : null;
  return { cash, qty, held, side, perp, unread: qty === null ? String(unread || "") : "", coin, ...(marginAt ? { marginAt } : {}) };
}
/** the panel's two lines from what is available (tkAvail): Available to trade — the coin paid with, the holding for a sell, else the dollars,
 * a dash where they are not known (a perpetual margined in another account: a short line says which) — and Current position, a dash where
 * the venue's positions were not read (its words under them); and whether the percent slider has anything to size from */
function tkAvailWords(a, m, side, venueName = "") {
  if (!a || !m) return { html: "", slider: false };
  const unit = tkSizeUnit(m);
  const known = a.qty !== null && a.qty !== undefined;
  const selling = side === "sell" && !a.perp;
  // the position is all that is held; what a sell can take of it now (a.qty) may be less, the rest locked in orders resting at the venue
  const all = a.held !== undefined && a.held !== null ? a.held : a.qty;
  const pos = !known ? "—" : all > 0 ? `${a.perp ? `${a.side === "short" ? "Short" : "Long"} ` : ""}${qtyOf(all)} ${unit}` : `0 ${unit}`;
  const avail = a.coin ? `${qtyOf(a.coin.qty)} ${a.coin.asset}` : selling ? (known ? `${qtyOf(a.qty)} ${unit}` : "—") : a.cash === null || a.cash === undefined ? "—" : money(a.cash);
  const away = a.marginAt && !a.coin && !selling ? `<p class="dim small">${esc(a.marginAt === "Predict deposit" ? "Paid in pUSD from your Predict deposit wallet, not this wallet's balances: what is there is not read here." : `Margined in your ${a.marginAt} account, not this wallet's balances: what is free there is not read here.`)}</p>` : "";
  const no = a.unread ? `<p class="tk-avail-no">${esc(`Positions at ${venueName || "the venue"} could not be read: ${a.unread}`)}</p>` : "";
  const html = `<div><span class="dim">Available to trade</span><span class="tab-nums">${esc(avail)}</span></div>${away}<div><span class="dim">Current position</span><span class="tab-nums">${esc(pos)}</span></div>${no}`;
  return { html, slider: a.coin ? a.coin.qty > 0 : selling ? known && a.qty > 0 : a.cash > 0 };
}
/** what the percent slider writes for a share (0 to 1) of what is available: paying with a coin, how much of it is sold first (in its own
 * units, down to its market's step — `coinStep`); a sell, how much of the holding (down to the market's step — `qtyStep`); else dollars, down
 * to the cent. Nothing at 0 */
function tkPctFill(a, share, { sell = false, qtyStep = 0, coinStep = 0 } = {}) {
  const s = Math.max(0, Math.min(1, Number(share) || 0));
  if (a && a.coin) return { unit: "qty", amount: s > 0 && a.coin.qty > 0 ? tkPlain(tkFloor(a.coin.qty * s, Number(coinStep) || 0)) : "" };
  if (a && sell && !a.perp) return { unit: "qty", amount: s > 0 && a.qty > 0 ? tkPlain(tkFloor(a.qty * s, Number(qtyStep) || 0)) : "" };
  return { unit: "usd", amount: s > 0 && a && a.cash > 0 ? String(Math.floor(a.cash * s * 100) / 100) : "" };
}

/* the order type showing among the order panel's tabs: Market or Limit pressed, or Pro (a select) on — where its sliding line goes */
const TK_OTAB_ON = '[aria-selected="true"], .tk-pro.on';

/** THE TICKET. Find the market (at the connected venues and at the venues that publish prices without a key), pick where (the best price of
 * your accounts first; a venue not connected says "Connect to trade"), then the order as that market takes it: the side, the amount, what it
 * is paid with (a coin held: two steps), the type and its prices, the leverage (a perpetual), the rest under Advanced, and the face's own
 * block — what the owner should know of this kind of market before ordering. The account prepares the exact order; you see it in words and
 * what you sign; your signature places it */
function tkTicket(panel, kind0, preset) {
  const gen = ++TK.gen;
  let kind = TK_KIND_IDS.includes(kind0) ? kind0 : "crypto";
  const owner = owns();
  const LOOK = !writesOn() ? "This server was started read-only: it places no orders" : owner ? "" : "This browser only looks: pair it to sign";
  panel.innerHTML = `${tkHead("Pick a market", kind)}<form class="tk-form" novalidate autocomplete="off">
    <div class="tk-find" data-find data-live><label class="fld">Market<input type="search" name="q" placeholder="${esc(tkKindSpec(kind).hint)}" spellcheck="false" autocomplete="off" /></label><div class="tk-res" data-res></div></div>
    <div class="tk-picked" data-picked hidden></div>
    <div class="tk-credit-w" data-credit></div>
    <div class="tk-out" data-outcomes hidden></div>
    <div class="tk-where-w" data-where-w hidden><div class="label">Where</div><div class="tk-where" data-where></div></div>
    <div class="tk-kb" data-kb hidden></div>
    <div class="tk-stack" data-body hidden>
      <div class="tk-lev" data-lev hidden></div>
      <div class="tk-otabs" data-otabs role="tablist" aria-label="Order type"></div>
      <label class="fld tk-otype" hidden>Order<select name="orderType"><option value="market">Market</option><option value="limit">Limit</option></select></label>
      <div class="tk-side" data-side></div>
      <div class="tk-avail" data-avail></div>
      <div class="row2" data-limit-row hidden><label class="fld" data-limit hidden><span data-limit-l>Limit price</span><input name="limitPrice" inputmode="decimal" autocomplete="off" /></label></div>
      <div class="row2"><label class="fld">Size<input name="amount" inputmode="decimal" placeholder="" autocomplete="off" /></label><label class="fld"><span data-unit-l>In</span><select name="unit"><option value="usd">Dollars</option><option value="qty">Units</option></select></label></div>
      <div class="tk-pct" data-pct hidden><input type="range" name="pct" min="0" max="100" step="1" value="0" aria-label="Share of what is available" /><span class="tab-nums" data-pct-v>0%</span></div>
      <div class="row2" data-pay-w hidden><label class="fld">Pay with<select name="pay"></select></label><span class="dim small tk-pay-n" data-pay-n></span></div>
      <div class="tk-flags"><label class="chk1" data-reduce hidden><input type="checkbox" name="reduceOnly" /> Reduce only</label><label class="chk1" data-tpsl hidden><input type="checkbox" name="tpsl" /> Take profit / Stop loss</label></div>
      <div class="row2" data-stop hidden><label class="fld"><span data-stop-l>Stop price</span><input name="stopPrice" inputmode="decimal" autocomplete="off" /></label></div>
      <div class="row2" data-trail hidden><label class="fld">Trail by<input name="trail" inputmode="decimal" placeholder="2" autocomplete="off" /></label><label class="fld"><span>In</span><select name="trailBy"><option value="percent">Percent</option><option value="price">Price</option></select></label></div>
      <div class="row2" data-exits hidden><label class="fld">Take profit<input name="takeProfit" inputmode="decimal" placeholder="Optional" autocomplete="off" /></label><label class="fld">Stop loss<input name="stopLoss" inputmode="decimal" placeholder="Optional" autocomplete="off" /></label></div>
      <details class="tk-adv" data-adv hidden><summary><span class="tk-adv-t">Advanced</span><span class="tk-adv-s" data-adv-sum></span>${icon("chevron", "sm")}</summary><div class="tk-adv-b"><div class="tk-more" data-more hidden><span data-tif></span><label class="chk1" data-post hidden><input type="checkbox" name="postOnly" /> Post-only</label><label class="chk1" data-eh hidden><input type="checkbox" name="extendedHours" /> Extended hours</label></div></div></details>
      <button type="submit" class="btn btn-primary btn-block" data-go disabled${LOOK ? ` title="${esc(LOOK)}"` : ""}>Sign and place</button>
      <div class="quote real" data-q><span class="dim">Type an amount.</span></div>
      <div data-sign></div>
      <div class="msg" data-msg role="status"></div>
    </div>
    <button type="button" class="btn btn-block" data-hand>${icon("agent")}Hand to agent instead</button>
  </form>`;
  tkWireHead(panel);
  const form = panel.querySelector("form");
  const q = (sel) => form.querySelector(sel);
  const live = () => gen === TK.gen && form.isConnected;
  const res = q("[data-res]");
  const msg = q("[data-msg]");
  const btn = q("[data-go]");
  const box = q("[data-q]");
  const sign = q("[data-sign]");
  const kb = q("[data-kb]");
  // the quote, what is signed and the kind block are written through paint: a refresh never takes the focus from What you sign
  const show = (html) => paint(box, html);
  const signed = (html) => paint(sign, html);
  const say = (text, state = "") => {
    msg.className = `msg${text && state ? ` ${state}` : ""}`;
    msg.textContent = text || "";
  };
  let item = null;
  let picked = null;
  let outcome = preset.outcome || "";
  let side = preset.side === "sell" ? "sell" : "buy";
  let mk = null;
  let prepared = null;
  let ranked = null;
  let seq = 0;
  let stopLeft = () => {};
  let presetUsed = false;
  // the extended-hours switch is set on for a market whose session takes one, until the owner touches it
  let ehTouched = false;
  form.addEventListener("change", (e) => {
    if (e.target && e.target.name === "extendedHours") ehTouched = true;
  });
  // paying with a coin held (Crypto, a buy): the two-step plan and, once its sale went, the buy waiting for the fill
  let pay = "";
  let payPlan = null;
  let second = null;
  let payMarkets = [];
  // the positions read at the venue picked (a perpetual's, an event's): null until read, and when the venue's could not be read — then
  // `posNo` holds its words
  let positions = null;
  let posNo = "";
  const spec = () => tkKindSpec(kind);
  const longShort = () => kind === "perps" || kind === "preipo";
  /* the face follows the market: a row of another kind than the ticket was opened on moves the seg and the words */
  const setKind = (k) => {
    if (k === kind) return;
    kind = k;
    const tag = panel.querySelector("[data-tk-kind]");
    if (tag) tag.textContent = spec().label;
    form.elements.q.placeholder = spec().hint;
    if (TK.kind !== k) {
      TK.kind = k;
      go("trade", { kind: k }, { replace: true });
    }
  };
  q("[data-side]").innerHTML = seg([["buy", "Buy"], ["sell", "Sell"]], side, (v) => {
    side = v;
    drawAvail();
    panelTitle();
    drawOutcomes();
    if (item && item.kind === "event") drawWhere(picked);
    payShape();
    rank();
    keep();
    drawKind();
    later(0);
  }, { label: "Buy or sell" });

  // ---- finding the market ----
  let sseq = 0;
  const search = async () => {
    const text = form.elements.q.value.trim();
    const my = ++sseq;
    res.innerHTML = '<p class="dim small">Searching your accounts and the public venues…</p>';
    const got = await tkReadKind(kind, text || "");
    if (!live() || my !== sseq) return;
    let items = got.items;
    // the venue the ticket was opened for comes first
    if (preset.venue) items = [...items.filter((x) => x.at.some((a) => a.venue === preset.venue)), ...items.filter((x) => !x.at.some((a) => a.venue === preset.venue))];
    items = items.slice(0, 8);
    // the count is read out once the search has landed; the list itself is not read out keystroke by keystroke
    res.innerHTML = `<p class="sr" role="status">${text ? `${plural(items.length, "market")} for ${esc(text)}` : ""}</p>${items.length ? `<ul class="tk-list" role="list">${items.map((x, i) => `<li><button type="button" data-i="${i}"${tkTitle(x) ? ` title="${esc(tkTitle(x))}"` : ""}>${avatar(x.kind === "event" ? String(x.category || "Event").slice(0, 4) : x.base || x.name, "sm", x.icon || "")}<span class="tk-rn"><b>${esc(tkName(x))}</b><span class="dim small">${esc(tkWhereWords(x))}</span></span><span class="tk-rp"><span class="tab-nums">${x.kind === "event" ? esc(tkCents(x.price)) : tkPre(x) && x.implied && x.implied.usd ? esc(tkValuation(x.implied.usd)) : x.price ? `$${esc(px(x.price))}` : ""}</span>${x.kind === "event" || tkPre(x) ? "" : chg(x.changePct24h)}</span></button></li>`).join("")}</ul>` : `<p class="empty">${got.refused ? `${esc(spec().label)} can't be read here yet.` : text ? `Nothing matches “${esc(text)}” under ${esc(spec().label)} at your accounts or the public venues.` : "Type to find a market."}</p>`}`;
    for (const b of res.querySelectorAll("button[data-i]")) b.addEventListener("click", () => pick(items[Number(b.dataset.i)]));
    credit();
  };
  /* the logos' credit: under the search's results while they show, under the market picked once it is */
  const credit = () => {
    const pk = q("[data-picked]");
    creditFor(pk && !pk.hidden ? pk : res, q("[data-credit]"), "tk-credit");
  };
  let findTimer = 0;
  form.elements.q.addEventListener("input", () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(search, 300);
  });

  /* a row picked: its name and price; its outcomes (an event); where it is listed, ranked; the face's block from the row itself */
  const pick = (x, at) => {
    item = x;
    setKind(tkKindOf({ item: x }));
    if (typeof ttSetItem === "function") ttSetItem(x, kind);
    q("[data-find]").hidden = true;
    const pk = q("[data-picked]");
    pk.hidden = false;
    const imp = tkPre(x) ? x.implied || ((x.at || []).find((a) => a.implied) || {}).implied : null;
    pk.innerHTML = `${avatar(x.kind === "event" ? String(x.category || "Event").slice(0, 4) : x.base || x.name, "", x.icon || "")}<span class="tk-rn"${tkTitle(x) ? ` title="${esc(tkTitle(x))}"` : ""}><b>${esc(tkName(x))}</b><span class="dim small">${esc([tkPre(x) ? "Pre-IPO" : x.category, x.closeTime ? `closes ${nyDay(x.closeTime)} ${nyTime(x.closeTime)} New York` : "", x.kind === "perp" && !tkPre(x) && x.fundingRate !== undefined ? `funding ${(x.fundingRate * 100).toFixed(4)}%` : ""].filter(Boolean).join(" · "))}</span></span>${x.kind === "event" ? "" : `<span class="tk-rp"><span class="tab-nums">${imp && imp.usd ? `${esc(tkValuation(imp.usd))} implied` : x.price ? `$${esc(px(x.price))}` : ""}</span>${chg(x.changePct24h)}</span>`}<button type="button" class="link" data-change>Change</button>`;
    pk.querySelector("[data-change]").addEventListener("click", () => {
      tkDraftKeep(null);
      if (typeof ttSetItem === "function") ttSetItem(null);
      item = null;
      picked = null;
      mk = null;
      pk.hidden = true;
      q("[data-outcomes]").hidden = true;
      q("[data-where-w]").hidden = true;
      q("[data-body]").hidden = true;
      kb.hidden = true;
      q("[data-find]").hidden = false;
      panel.querySelector("[data-tk-title]").textContent = "Pick a market";
      form.elements.q.focus();
      search();
    });
    credit();
    drawOutcomes();
    panelTitle();
    ranked = null;
    drawWhere(at);
    drawKind();
    if (["coin", "stock", "rwa"].includes(x.kind) && x.base) rank();
    if (kind === "stocks" || kind === "rwas") cross();
  };
  const panelTitle = () => {
    const t = panel.querySelector("[data-tk-title]");
    if (!item) return;
    t.textContent = item.kind === "event" ? `${side === "sell" ? "Sell" : "Buy"} ${outcome || item.name}` : `${longShort() ? (side === "sell" ? "Short" : "Long") : side === "sell" ? "Sell" : "Buy"} ${item.base || item.name}`;
    for (const b of q("[data-side]").querySelectorAll("button[data-v]")) b.textContent = longShort() ? (b.dataset.v === "sell" ? "Short" : "Long") : b.dataset.v === "sell" ? "Sell" : "Buy";
  };
  const drawOutcomes = () => {
    const box2 = q("[data-outcomes]");
    const outs = item && item.kind === "event" ? item.outcomes || [] : [];
    box2.hidden = !outs.length;
    if (!outs.length) return void (box2.innerHTML = "");
    if (!outcome || !outs.some((o) => o.label.toUpperCase() === outcome.toUpperCase())) outcome = outs[0].label;
    box2.innerHTML = outs.slice(0, 6).map((o, i) => `<button type="button" class="${i === 0 ? "yes" : i === 1 && outs.length === 2 ? "no-btn" : "yes tk-oth"}" data-out="${esc(o.label)}" aria-pressed="${String(o.label.toUpperCase() === outcome.toUpperCase())}">${esc(o.label)} ${esc(tkCents(side === "sell" ? o.bid ?? o.price : o.ask ?? o.price))}</button>`).join("");
    for (const b of box2.querySelectorAll("button[data-out]")) b.addEventListener("click", () => {
      outcome = b.dataset.out;
      for (const x of box2.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      panelTitle();
      drawWhere(picked);
      if (picked) choose(picked).then(keep);
    });
  };
  /* the symbol an outcome trades under at a venue */
  const symbolAt = (a) => {
    if (!item || item.kind !== "event") return a.symbol;
    const o = (item.outcomes || []).find((x) => x.label.toUpperCase() === outcome.toUpperCase());
    const there = o && o.at.find((x) => x.venue === a.venue);
    return there ? there.symbol : a.symbol;
  };
  /* where it is listed: your accounts that trade it (the best price first, when the venues were compared), the ones that cannot (in their
     words), and the venues not connected that publish it ("Connect to trade"); a pre-IPO venue says its implied valuation and unit */
  const drawWhere = (prefer) => {
    if (!item) return;
    const box2 = q("[data-where]");
    const w = q("[data-where-w]");
    const rows = tkWhereRows(item, ranked, kind);
    // a venue that lets this network only close what is held takes a sell, not a buy: for a buy it is that state, in a word
    if (side === "buy") for (const r of rows) if (r.state === "able" && r.closeOnly) Object.assign(r, { state: "off", why: "Close only here: what you hold there can be sold", how: "" });
    if (item.kind === "event") {
      const o = (item.outcomes || []).find((x) => x.label.toUpperCase() === outcome.toUpperCase());
      for (const r of rows) if (o && r.state !== "public") r.price = side === "sell" ? o.bid ?? o.price : o.ask ?? o.price;
    }
    w.hidden = !rows.length && !rows.away;
    const none = !rows.some((r) => r.state === "able");
    // a tokenised asset's issuer speaks once, in the face's block: a venue line repeating the same words says only that it takes no order
    const iss = typeof mkIssuer === "function" ? mkIssuer(item) : null;
    const saidByIssuer = (t) => !!iss && !!t && !!iss.eligibility && (t.includes(iss.eligibility) || iss.eligibility.includes(t));
    for (const r of rows) {
      if (saidByIssuer(r.note)) r.note = "";
      if (saidByIssuer(r.why)) r.why = `${r.venueName} takes no order for it: the issuer's terms`;
    }
    const priceOf = (r) => (r.implied && r.implied.usd ? `${esc(tkValuation(r.implied.usd))} implied` : r.price ? esc(item.kind === "event" ? tkCents(r.price) : `$${px(r.price)}`) : "");
    // a pre-IPO company's venues: the unit sentence most of them share is said once, in the face's block; a line says its own only where it
    // differs (OKX's ANTHROPIC and OPENAI swaps, $1 for $10,000,000,000)
    const units = rows.map((r) => (r.implied && r.implied.unit) || "").filter(Boolean);
    const commonUnit = units.sort((a, b) => units.filter((u) => u === b).length - units.filter((u) => u === a).length)[0] || "";
    const unitOf = (r) => (r.implied && r.implied.unit && r.implied.unit !== commonUnit ? `<span class="why">${esc(r.implied.unit)}</span>` : "");
    const nobody = rows.length > 0 && rows.every((r) => r.state === "public" && r.refuses);
    // real money or paper: a switch between the two kinds of account that trade it (both there), and a band that says which the order
    // picked is for — the one thing to see before signing. With the switch there, only the accounts of the kind it is on are listed (a
    // paper account under Paper, a real one — and the public venues to connect — under Real money), so the list never mixes the two
    const ableRows = rows.filter((r) => r.state === "able");
    const hasReal = ableRows.some((r) => !r.paper);
    const hasPaper = ableRows.some((r) => r.paper);
    const pickedRow = picked ? ableRows.find((r) => r.venue === picked.venue) : null;
    const both = hasReal && hasPaper;
    const onPaper = pickedRow ? !!pickedRow.paper : lensNow().kind === "paper";
    const listed = (r) => !both || (r.state === "public" ? !onPaper : !!r.paper === onPaper);
    const money = `<div class="tk-money-row" data-money-row>${both ? `<div class="seg tk-money-seg" role="group" aria-label="Real money or paper"><button type="button" data-money="real" aria-pressed="${String(!!pickedRow && !pickedRow.paper)}">Real money</button><button type="button" data-money="paper" aria-pressed="${String(!!pickedRow && !!pickedRow.paper)}">Paper</button></div>` : ""}<span data-money-band>${tkMoneyBand(pickedRow)}</span></div>`;
    // the public venues that list it are folded under one line when an account of yours trades it: the order panel stays the order's
    const fold = !none && rows.some((r) => r.state === "public");
    const pubCount = rows.filter((r) => r.state === "public").length;
    // a venue's terms that exclude where the user is: their word in the line, the venue's whole sentence folded under it (opened on purpose,
    // never laid out beside the price)
    const terms = (r) => (r.terms ? `<span class="why"><b>${esc(r.terms.word)}</b></span>${r.terms.said ? `<details class="tk-terms"><summary>Its terms</summary><p>${esc(r.terms.said)}</p></details>` : ""}` : "");
    const pubRow = (r, i, note) => `<div class="tk-at pub"><span><b>${esc(r.venueName)}</b> <span class="tag">Public</span>${r.refuses ? `<span class="why" title="${esc(r.refuses.said || "")}"><b>${esc(r.refuses.word)}</b></span>` : r.terms ? terms(r) : note && !r.connector && r.note ? `<span class="why">${esc(r.note)}</span>` : ""}${unitOf(r)}</span><span class="tk-at-r">${priceOf(r) ? `<span class="tab-nums">${priceOf(r)}</span>${r.connector ? '<span class="tk-sep"> · </span>' : ""}` : ""}${r.connector ? `<button type="button" class="link" data-connect="${i}">Connect to trade</button>` : ""}</span></div>`;
    box2.innerHTML = `${ableRows.length ? money : ""}${!rows.length ? '<p class="dim small">No venue that lists it serves this network.</p>' : none ? `<p class="dim small">${rows.some((r) => r.state === "public" && r.connector) ? "None of your accounts trades it yet: connect one where it is listed." : nobody ? "None of the venues that list it would take you from where you are." : "None of your accounts can trade it now."}</p>` : ""}${rows.map((r, i) => {
      if ((fold && r.state === "public") || !listed(r)) return "";
      // a venue that takes the user only in part (close-only) or wants something here first: its word, its whole sentence on hover
      if (r.state === "public") return pubRow(r, i, true);
      // a paper account's own name, without the "paper" its tag says already ("Momentum · paper" → "Momentum" with its Paper tag)
      const name = r.paper ? tkPaperless(r.venueName) : r.venueName;
      if (r.state === "off") return `<div class="tk-at off"><span><b>${esc(name)}</b>${r.paper ? ' <span class="tag paper">Paper</span>' : ""}<span class="why">${esc(r.why)}${r.how ? ` ${esc(r.how)}` : ""}</span></span></div>`;
      return `<button type="button" class="tk-at" data-at="${i}" aria-pressed="${String(!!picked && picked.venue === r.venue)}"><span><b>${esc(name)}</b>${r.paper ? ' <span class="tag paper" title="A paper account: no real money">Paper</span>' : ""}${r.best ? ' <span class="tag up">Best</span>' : ""}${r.closed ? ' <span class="tag">Closed</span>' : ""}${r.note ? `<span class="why tk-at-note" title="${esc(r.note)}">${esc(r.note)}</span>` : ""}${unitOf(r)}</span><span class="tab-nums tk-at-r">${priceOf(r)}${r.worse ? `<span class="why">${esc(Math.abs(r.worse).toFixed(2))}% ${r.worse > 0 ? "worse" : "better, check"}</span>` : ""}</span></button>`;
    }).join("")}${fold && !onPaper ? `<details class="tk-pubs"><summary>${esc(pubCount === 1 ? "1 other venue lists it" : `${pubCount} other venues list it`)} <span class="dim">· connect one to trade there</span></summary>${rows.map((r, i) => (r.state !== "public" ? "" : pubRow(r, i, false))).join("")}</details>` : ""}`;
    for (const b of box2.querySelectorAll("button[data-at]")) b.addEventListener("click", () => choose(rows[Number(b.dataset.at)]));
    // the switch: the best (else the first) account of that kind, the form kept as it is; the list then shows that kind's accounts
    for (const b of box2.querySelectorAll("button[data-money]")) b.addEventListener("click", () => {
      const want = b.dataset.money === "paper";
      const r = ableRows.find((x) => !!x.paper === want && x.best) || ableRows.find((x) => !!x.paper === want);
      if (!r) return;
      choose(r);
      drawWhere(r);
      // the switch is drawn again with the list: the key stays on the side just pressed
      const again = q(`[data-where] button[data-money="${want ? "paper" : "real"}"]`);
      if (again && typeof again.focus === "function") again.focus({ preventScroll: true });
    });
    for (const b of box2.querySelectorAll("button[data-connect]")) b.addEventListener("click", () => {
      // once the venue is connected (the next read of the account shows it), this market is looked up again so it is offered there
      TK.connecting = { gen, before: new Set(A.venues.filter((v) => v.live).map((v) => v.id)), redo: (id) => live() && refind(id) };
      tkConnectTo(rows[Number(b.dataset.connect)]);
    });
    const able = rows.filter((r) => r.state === "able");
    if (!picked || !able.some((r) => r.venue === picked.venue)) {
      // the lens decides which kind is picked first: a paper account under Paper, a real one under Real money (and otherwise too)
      const lens = lensNow();
      const wanted = (r) => (lens.kind === "paper" ? !!r.paper : !r.paper);
      const first = (prefer && able.find((r) => r.venue === prefer.venue && (!prefer.symbol || r.symbol === prefer.symbol))) || (preset.venue && able.find((r) => r.venue === preset.venue)) || able.find((r) => wanted(r) && r.best) || able.find(wanted) || able.find((r) => r.best) || able[0];
      if (first) choose(first);
      else {
        picked = null;
        q("[data-body]").hidden = true;
      }
    }
  };
  /* after "Connect to trade": the market read again — what was kept of it at the venues and in the public listings is dropped — so the
     venue just connected is where it trades, picked; a market it does not list stays as it was, its places read again. Its row is searched
     by the words a search may hold (an event's question cut to them: tkQueryOf) and asked for by its key */
  const refind = async (venue) => {
    for (const k of [...API.keys()]) if (/^\/api\/account\/(explore|compare|market)\?/.test(k)) API.delete(k);
    if (!item) return void search();
    const was = item;
    const got = await tkReadKind(kind, tkQueryOf(was), was.key || "");
    if (!live() || item !== was) return;
    const again = got.items.find((x) => x.key === was.key);
    if (again) return void pick(again, { venue });
    ranked = null;
    drawWhere(picked);
    rank();
  };
  TK.refindIdle = () => {
    if (live() && item && !picked) void refind();
  };
  /* the same thing at your other accounts, by the price this order would take there: the best is one click away. Coins, shares and tokens
     only — a perpetual's venues are not one market, and a pre-IPO contract's prices differ by unit */
  let rseq = 0;
  const rank = async () => {
    if (!item || !["crypto", "stocks", "rwas"].includes(kind) || !["coin", "stock", "rwa"].includes(item.kind) || !item.base) return;
    const my = ++rseq;
    const f = formFields(form);
    const usd = f.unit === "usd" && Number(f.amount) > 0 ? String(Number(f.amount)) : "";
    const body = await api(`/api/account/compare?${new URLSearchParams({ base: item.base, side, ...(usd ? { usd } : {}), asset: kind === "stocks" ? "stock" : "crypto" })}`, { ttl: 10_000 });
    if (!live() || my !== rseq || !body || body.ok === false) return;
    ranked = body.rows || [];
    panelTitle();
    drawWhere(picked);
  };

  // ---- the order, as the market takes it ----
  const unitName = (m) => (m.kind === "event" ? "Contracts" : m.kind === "stock" && m.qtyStep === 1 ? "Shares (whole)" : UNITS[m.kind] ? UNITS[m.kind][0].toUpperCase() + UNITS[m.kind].slice(1) : m.base);
  const venueOf = () => (picked ? A.venues.find((x) => x.id === picked.venue) || {} : {});
  const choose = async (r) => {
    picked = { venue: r.venue, symbol: symbolAt(r), venueName: r.venueName };
    const rows = tkWhereRows(item, ranked, kind);
    for (const b of q("[data-where]").querySelectorAll("button[data-at]")) {
      const row = rows[Number(b.dataset.at)];
      b.setAttribute("aria-pressed", String(!!row && row.venue === picked.venue));
    }
    const pickedRow = rows.find((x) => x.venue === picked.venue && x.state === "able");
    for (const b of q("[data-where]").querySelectorAll("button[data-money]")) b.setAttribute("aria-pressed", String((b.dataset.money === "paper") === !!(pickedRow && pickedRow.paper)));
    const band = q("[data-money-band]");
    if (band) band.innerHTML = tkMoneyBand(pickedRow);
    q("[data-body]").hidden = false;
    tkRecentAdd({ kind, key: item.key, name: item.name, base: item.base, venue: picked.venue, venueName: picked.venueName, symbol: picked.symbol, icon: item.icon });
    const want = picked;
    const body = await api(`/api/account/market?${new URLSearchParams({ venue: want.venue, symbol: want.symbol })}`, { ttl: 3_000 });
    if (!live() || picked !== want) return;
    if (!body || body.ok === false) {
      mk = null;
      show(`<div class="msg no">${esc(refusalOf(body) || "No such market there.")}</div>`);
      return;
    }
    fit(body.market);
    later(0);
  };
  /* the market as the venue lists it: which order types, times in force and flags it takes — the ticket offers those and nothing else;
     the Advanced line says what is set, else the venue's own rule */
  const shape = () => {
    const t = form.elements.orderType.value;
    const ev = !!mk && mk.kind === "event";
    q("[data-limit]").hidden = !TK_LIMITED.includes(t);
    q("[data-limit-row]").hidden = !TK_LIMITED.includes(t);
    // Take profit / Stop loss: offered on a market or limit entry where the market takes exits; its two prices show once it is ticked
    const brackets = !!(mk && mk.brackets && (t === "market" || t === "limit"));
    q("[data-tpsl]").hidden = !brackets;
    if (!brackets) form.elements.tpsl.checked = false;
    drawTypes();
    q("[data-stop]").hidden = !TK_STOPPED.includes(t);
    q("[data-limit-l]").textContent = ev ? "Limit (¢)" : "Limit price";
    q("[data-stop-l]").textContent = ev ? "Stop (¢)" : "Stop price";
    q("[data-trail]").hidden = t !== "trailing_stop";
    q("[data-exits]").hidden = !(brackets && form.elements.tpsl.checked);
    q("[data-post]").hidden = !(mk && mk.postOnly && t === "limit");
    q("[data-eh]").hidden = !(mk && mk.session && mk.session.extendedHours && t === "limit");
    // the times in force this order type takes here (a venue may take "Today only" for a stop and not for a limit); the select's options
    // are rewritten only when they differ, so one open under the pointer stays open
    const sel = q("[data-tif] select");
    if (mk && sel) {
      const allowed = (mk.tifsByType && mk.tifsByType[t]) || mk.tifs || [];
      setOptions(sel, [["", "The venue's default"], ...allowed.map((x) => [x, TK_TIF_NAMES[x] || x])], allowed.includes(sel.value) ? sel.value : "");
    }
    // Advanced's line in a few letters (TIF and its code, as HL writes it), the whole rule on hover: never a sentence cut mid-word
    const sum = q("[data-adv-sum]");
    const f = formFields(form);
    const words = mk ? tkAdvSummary(mk, f) : "";
    const short = mk ? tkAdvShort(mk, f) : "";
    paint(sum, short ? `<abbr class="tk-tif" title="Time in force">TIF</abbr> ${esc(short)}` : "");
    if (sum.title !== words) sum.title = words;
  };
  /* what is held at this venue's markets (perpetuals, event contracts), read again at most every ten seconds: the face's block, the
     leverage line and the position line say it. A venue the read could not reach (`missing`, in its own words), or a read refused whole,
     gives no positions at all — nothing is said held or not held there, and the panel says why */
  const readPositions = (m) => {
    api("/api/account/positions", { ttl: 10_000 }).then((b) => {
      if (!live() || mk !== m) return;
      const read = !!b && b.ok !== false;
      const miss = read ? (b.missing || []).find((x) => picked && x.venue === picked.venue) : null;
      positions = read && !miss ? b.positions || [] : null;
      posNo = !read ? refusalOf(b) || "no answer" : miss ? miss.why || "no answer" : "";
      levLine();
      drawKind();
      drawAvail();
    });
  };
  const held = () => (positions || []).find((x) => picked && x.venue === picked.venue && mk && x.symbol === mk.symbol && x.qty > 0) || null;
  /* the leverage this market is at now, as far as the venue has said: what the door just set (the venue confirmed it), else the position
     held there; nothing said (no position, nothing set from here): unknown — no figure is shown that the venue did not give */
  const levNow = () => {
    const set = TK.lev && picked && mk && TK.lev.venue === picked.venue && TK.lev.symbol === mk.symbol ? TK.lev : null;
    const h = held();
    return set ? { leverage: Number(set.leverage), marginMode: set.marginMode || "" } : h && h.leverage ? { leverage: Number(h.leverage), marginMode: h.marginMode || "" } : null;
  };
  /* the two buttons at the panel's head and the field under them: the margin mode where the venue said one, and the leverage now ("3x"),
     else "Leverage"; the field takes the leverage now while the owner has not typed another; Set leverage… waits for a whole number
     between 1 and the market's most that differs from it */
  let levShown = "";
  const levPills = () => {
    const box2 = q("[data-lev-pills]");
    if (!box2) return;
    const now = levNow();
    const ed = q("[data-lev-ed]");
    const open = !!ed && !ed.hidden;
    const mode = now && now.marginMode ? now.marginMode.charAt(0).toUpperCase() + now.marginMode.slice(1) : "";
    paint(box2, `${mode ? `<button type="button" class="btn tk-lev-pill" data-lev-open data-fk="lev-mode" aria-controls="tk-lev-ed" aria-expanded="${open}" title="Margin mode at ${esc(picked ? picked.venueName || nameOf(picked.venue) : "the venue")}">${esc(mode)}</button>` : ""}<button type="button" class="btn tk-lev-pill" data-lev-open data-fk="lev-now" aria-controls="tk-lev-ed" aria-expanded="${open}"${now ? ` aria-label="Leverage ${esc(String(now.leverage))}x: change it"` : ""}>${now ? `${esc(String(now.leverage))}x` : "Leverage"}</button>`);
    const input = form.elements.leverage;
    const shown = now ? String(now.leverage) : "";
    if (input && document.activeElement !== input && (input.value === "" || input.value === levShown)) input.value = shown;
    levShown = shown;
    levReady();
  };
  const levReady = () => {
    const b = q("[data-lev-prep]");
    const input = form.elements.leverage;
    if (!b || !input || !mk) return;
    const n = Number(String(input.value || "").trim());
    const now = levNow();
    const mode = form.elements.marginMode ? form.elements.marginMode.value : "";
    const ok = /^\d{1,3}$/.test(String(input.value || "").trim()) && n >= 1 && (!mk.maxLeverage || n <= mk.maxLeverage) && (!now || n !== now.leverage || (!!mode && mode !== now.marginMode));
    b.disabled = !ok || !owns();
  };
  q("[data-lev]").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-lev-open]");
    if (!b) return;
    const ed = q("[data-lev-ed]");
    if (!ed) return;
    ed.hidden = !ed.hidden;
    levPills();
    if (!ed.hidden && form.elements.leverage) form.elements.leverage.focus({ preventScroll: true });
  });
  /* a perpetual's leverage line, when the venue does not set it from here: as set at the venue, and what is held at */
  const levLine = () => {
    levPills();
    const ro = q("[data-lev-ro]");
    if (!ro) return;
    const h = held();
    const t = `As set at the venue${h && h.leverage ? ` · held ${esc(String(h.leverage))}x${h.marginMode ? `, ${esc(h.marginMode)}` : ""}` : positions ? " · nothing held here yet" : ""}.`;
    if (ro.innerHTML !== t) ro.innerHTML = t;
  };
  const fit = (m) => {
    mk = m;
    const v = venueOf();
    // the order types and times in force as the venue lists them for this market: set without rebuilding a select the owner has open
    const types = m.types && m.types.length ? m.types : ["market"];
    const keepType = form.elements.orderType.value;
    setOptions(form.elements.orderType, types.map((t) => [t, TK_TYPE_NAMES[t] || t]), types.includes(preset.orderType) && !presetUsed ? preset.orderType : types.includes(keepType) ? keepType : types[0]);
    const tifBox = q("[data-tif]");
    if (!(m.tifs && m.tifs.length)) tifBox.innerHTML = "";
    else {
      if (!tifBox.querySelector("select")) tifBox.innerHTML = '<label class="fld">Time in force<select name="tif"></select></label>';
      const tifSel = tifBox.querySelector("select");
      setOptions(tifSel, [["", "The venue's default"], ...m.tifs.map((t) => [t, TK_TIF_NAMES[t] || t])], presetUsed ? tifSel.value : preset.tif || "");
    }
    // a flag this market does not take is not only hidden but unticked: a box ticked at another venue is never sent from out of sight
    q("[data-reduce]").hidden = !m.reduceOnly;
    if (!m.reduceOnly) form.elements.reduceOnly.checked = false;
    if (!m.postOnly) form.elements.postOnly.checked = false;
    // outside the regular session, where the venue trades the session that is on, a limit goes with extended hours unless the owner says not
    const takesEh = !!(m.session && m.session.extendedHours);
    if (!takesEh) form.elements.extendedHours.checked = false;
    else if (!ehTouched) form.elements.extendedHours.checked = true;
    const more = q("[data-more]");
    more.hidden = !(m.tifs && m.tifs.length) && !m.postOnly && !takesEh;
    // Advanced is folded and holds only what the market takes; a market that takes none of it has no Advanced
    q("[data-adv]").hidden = more.hidden;
    if (!pay || isDollar(pay)) form.elements.unit.options[1].textContent = unitName(m);
    if (m.price) form.elements.limitPrice.placeholder = m.kind === "event" ? String(Number((m.price * 100).toFixed(1))) : String(Number(Number(m.price).toPrecision(10)));
    if (!presetUsed) {
      // what the ticket was opened with, once
      if (preset.amount) form.elements.amount.value = String(preset.amount);
      if (preset.unit === "qty" || preset.unit === "usd") form.elements.unit.value = preset.unit;
      if (preset.limitPrice) form.elements.limitPrice.value = String(preset.limitPrice);
      if (preset.stopPrice) form.elements.stopPrice.value = String(preset.stopPrice);
      if (preset.pay) pay = String(preset.pay);
      presetUsed = true;
    }
    // a perpetual's leverage: the primary control of a perp, so in view — set from here with its own signature where the venue lets it,
    // else as the venue has it. No figure is suggested that the venue did not give; a margin mode only where the venue sets one (marginModes)
    const perp = m.kind === "perp" || m.kind === "future";
    const lev = q("[data-lev]");
    lev.hidden = !(perp && (kind === "perps" || kind === "preipo"));
    if (!lev.hidden) {
      if (v.trade && v.trade.leverage) {
        const given = Array.isArray(m.marginModes) ? m.marginModes : Array.isArray(v.trade.marginModes) ? v.trade.marginModes : [];
        const modes = given.filter((x) => typeof x === "string" && x);
        // HL's two buttons at the panel's head — the margin mode (where the venue says it) and the leverage now — open the editor under
        // them: the field (the leverage now in it, once known), the margin mode where the venue sets one, and Set leverage…, signed apart
        lev.innerHTML = `<div class="tk-lev-pills" data-lev-pills></div><div class="tk-lev-ed" id="tk-lev-ed" data-lev-ed hidden><div class="row2"><label class="fld">Leverage<input name="leverage" inputmode="numeric" placeholder="${m.maxLeverage ? `1 to ${esc(String(m.maxLeverage))}` : "a whole number"}" /></label>${modes.length ? `<label class="fld">Margin${select("marginMode", [["", "As it is"], ...modes.map((x) => [x, x.charAt(0).toUpperCase() + x.slice(1)])])}</label>` : ""}</div><div class="tk-lev-go"><button type="button" class="btn btn-sm" data-lev-prep disabled>Set leverage…</button><span class="dim small">Changing leverage is signed on its own, before the order.</span></div><div data-lev-sign></div></div>`;
        tkLeverage(lev, picked, m, live, () => {
          drawKind();
          levPills();
        });
      } else lev.innerHTML = `<div class="label">Leverage</div><div class="dim small" data-lev-ro></div>`;
    } else lev.innerHTML = "";
    // the positions read are this venue's from here: none said until its read lands
    positions = null;
    posNo = "";
    if (perp || m.kind === "event") readPositions(m);
    payLoad(m);
    if (kind === "rwas" && !chains) loadChains();
    levLine();
    drawKind();
    shape();
    drawAvail();
    // the terminal's chart, book and bar follow the market and where the order goes
    if (typeof ttSetMarket === "function") ttSetMarket(picked, m);
  };

  /* ORDER TYPE as tabs: Market and Limit where the market takes them, the rest (stop, stop-limit, trailing stop) under Pro — the select
     the account reads stays the one source of the type */
  const drawTypes = () => {
    const box2 = q("[data-otabs]");
    const sel = form.elements.orderType;
    const types = [...sel.options].map((o) => o.value);
    const t = sel.value;
    const pro = types.filter((x) => x !== "market" && x !== "limit");
    const html = `${["market", "limit"].filter((x) => types.includes(x)).map((x) => `<button type="button" role="tab" data-otype="${x}" aria-selected="${String(t === x)}">${esc(TK_TYPE_NAMES[x])}</button>`).join("")}${pro.length ? `<label class="tk-pro${pro.includes(t) ? " on" : ""}"><span class="sr">More order types</span><select data-pro>${[["", "Pro"], ...pro.map((x) => [x, TK_TYPE_NAMES[x] || x])].map(([v, w]) => `<option value="${v}"${v === (pro.includes(t) ? t : "") ? " selected" : ""}>${esc(w)}</option>`).join("")}</select></label>` : ""}`;
    paint(box2, html);
    // the line under the type showing slides to it in the terminal's order panel (book.js bkSlideUnder, trade.css): Pro is a select, marked on
    if (typeof bkSlideUnder === "function") bkSlideUnder(box2, TK_OTAB_ON);
  };
  q("[data-otabs]").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-otype]");
    if (!b || form.elements.orderType.value === b.dataset.otype) return;
    form.elements.orderType.value = b.dataset.otype;
    form.elements.orderType.dispatchEvent(new Event("change", { bubbles: true }));
  });
  q("[data-otabs]").addEventListener("change", (e) => {
    const sel = e.target.closest && e.target.closest("select[data-pro]");
    if (!sel || !sel.value) return;
    e.stopPropagation();
    form.elements.orderType.value = sel.value;
    form.elements.orderType.dispatchEvent(new Event("change", { bubbles: true }));
  });

  /* WHAT IS AVAILABLE (tkAvail): the dollars free at the venue the order goes to (what a buy, or a perpetual's margin, is paid from), what
     is held of this market there that can be sold now (a sell sells only that), and — a buy paid with a coin held — that coin; the percent
     slider sizes the order from it (tkPctFill) */
  const availOf = () => tkAvail(venueOf(), mk, { positions, unread: posNo, pay: side === "buy" ? payCoin() : null });
  const drawAvail = () => {
    const w = tkAvailWords(availOf(), mk, side, picked ? picked.venueName || nameOf(picked.venue) : "");
    paint(q("[data-avail]"), w.html);
    q("[data-pct]").hidden = !w.slider;
  };
  /* the step a pay coin is sold in: its own dollar market's at the venue (the plan's first leg) */
  const payStep = () => {
    const plan = payCoin() ? payPlanNow() : null;
    return plan && plan.market ? Number(plan.market.qtyStep) || 0 : 0;
  };
  /* the slider's track filled to its share (trade.css reads --tk-pct) */
  const pctFill = (v) => {
    const st = form.elements.pct && form.elements.pct.style;
    if (st && typeof st.setProperty === "function") st.setProperty("--tk-pct", `${v}%`);
  };
  form.elements.pct.addEventListener("input", () => {
    const a = availOf();
    setText(q("[data-pct-v]"), `${form.elements.pct.value}%`);
    pctFill(form.elements.pct.value);
    if (!a) return;
    const fill = tkPctFill(a, Number(form.elements.pct.value) / 100, { sell: side === "sell", qtyStep: mk.qtyStep, coinStep: a.coin ? payStep() : 0 });
    form.elements.unit.value = fill.unit;
    form.elements.amount.value = fill.amount;
    form.elements.amount.dispatchEvent(new Event("input", { bubbles: true }));
  });
  /* the account read again (a fill, the page's refresh): what is available and the position held drawn from that read — the positions
     asked again, kept at most ten seconds (a placed order drops them: the submit below) */
  TK.refreshAvail = () => {
    if (!live() || !mk) return;
    if (mk.kind === "perp" || mk.kind === "future" || mk.kind === "event") readPositions(mk);
    else drawAvail();
  };
  /* a price pressed in the order book: the order becomes a limit at it (where the market takes limits) */
  TK.setLimit = (p) => {
    if (!live() || !mk || !(p > 0)) return;
    const types = [...form.elements.orderType.options].map((o) => o.value);
    if (!types.includes("limit")) return;
    if (!TK_LIMITED.includes(form.elements.orderType.value)) form.elements.orderType.value = "limit";
    form.elements.limitPrice.value = mk.kind === "event" ? String(Number((p * 100).toFixed(2))) : tkPlain(p);
    shape();
    keep();
    later(0);
  };

  // ---- Pay with (Crypto, a buy): the venue's dollars for it first, then coins held there — a coin is two steps, two signatures ----
  let payVenue = "";
  const payLoad = async (m) => {
    const v = venueOf();
    const show2 = kind === "crypto" && side === "buy" && !!item && !!item.base && !!v.id;
    if (!show2) return void payShape();
    if (payVenue !== `${v.id}|${item.base}`) {
      payVenue = `${v.id}|${item.base}`;
      payMarkets = [];
      const body = await api(`/api/account/markets?${new URLSearchParams({ venue: v.id, q: item.base })}`, { ttl: 60_000 });
      if (!live() || mk !== m) return;
      payMarkets = (body && body.markets) || [];
    }
    payShape();
  };
  /* the choices: the dollars this coin is listed against at the venue, then the coins held there that have a dollar market (sold first).
     The row shows only when there is a choice to make */
  const payOptions = () => {
    const v = venueOf();
    if (kind !== "crypto" || side !== "buy" || !item || !item.base || !mk) return [];
    const base = String(item.base).toUpperCase();
    const spotLike = (x) => ["spot", "token", "crypto"].includes(x.kind) && x.open !== false;
    const dollars = [...new Set(payMarkets.filter((x) => spotLike(x) && String(x.base).toUpperCase() === base && isDollar(x.quote)).map((x) => String(x.quote).toUpperCase()))];
    if (!dollars.includes(String(mk.quote).toUpperCase()) && isDollar(mk.quote)) dollars.unshift(String(mk.quote).toUpperCase());
    const coins = (v.holdings || []).filter((h) => h.class === "crypto" && h.amount > 0 && !h.inTransit && !isDollar(h.asset) && String(h.asset).toUpperCase() !== base).map((h) => ({ value: `${h.asset}|${h.note || ""}`, label: `${h.asset}${h.note ? ` · ${h.note}` : ""} — ${qtyOf(h.amount)} held` }));
    return [...dollars.map((d) => ({ value: d, label: d })), ...coins];
  };
  const payCoin = () => (pay && !isDollar(pay.split("|")[0]) ? { asset: pay.split("|")[0], chain: pay.split("|")[1] || "" } : null);
  const payShape = () => {
    const w = q("[data-pay-w]");
    const opts = payOptions();
    w.hidden = opts.length < 2;
    const sel = form.elements.pay;
    if (!w.hidden) {
      if (!pay || !opts.some((o) => o.value === pay)) pay = mk && isDollar(mk.quote) ? String(mk.quote).toUpperCase() : opts[0].value;
      setOptions(sel, opts.map((o) => [o.value, o.label]), pay);
    } else pay = "";
    const coin = payCoin();
    // paying with a coin: the amount is how much of that coin is sold, so the units are its own
    const u = form.elements.unit;
    if (coin) {
      setOptions(u, [["qty", coin.asset]], "qty");
      q("[data-unit-l]").textContent = "Sell";
    } else {
      setOptions(u, [["usd", "Dollars"], ["qty", mk ? unitName(mk) : "Units"]], u.value === "qty" ? "qty" : "usd");
      q("[data-unit-l]").textContent = "In";
    }
    const n = q("[data-pay-n]");
    n.textContent = coin ? "Two steps, two signatures." : "";
    // what there is to pay with follows: the venue's dollars, or the coin held
    drawAvail();
  };
  /* a pay coin's plan from the fields: its sale for the dollar both markets share, then the buy with what that brings (tkSwapPlan) */
  const payPlanNow = () => {
    const coin = payCoin();
    if (!coin || !item || !picked) return null;
    const v = venueOf();
    return tkSwapPlan({ venue: picked.venue, from: coin.asset, to: item.base, amount: form.elements.amount.value, markets: payMarkets, chain: tkVenueKinds(v).includes("token") ? coin.chain : "" });
  };
  /* a coin's own markets, when the first read (the base's) did not list them: looked up once */
  const payMore = async (asset) => {
    if (!picked || payMarkets.some((x) => String(x.base).toUpperCase() === String(asset).toUpperCase())) return;
    const body = await api(`/api/account/markets?${new URLSearchParams({ venue: picked.venue, q: asset })}`, { ttl: 60_000 });
    if (!live() || !body || !body.markets) return;
    payMarkets = [...payMarkets, ...body.markets.filter((x) => !payMarkets.some((y) => y.symbol === x.symbol))];
  };

  // ---- the face's block: what the owner should know of this kind of market before ordering ----
  let chains = null;
  let cross = () => {};
  const drawKind = () => {
    const f = formFields(form);
    const html = tkKindBlock(kind, mk, picked ? tkWhereRows(item, ranked, kind).find((r) => r.venue === picked.venue) || picked : null, item, { side, outcome, amount: f.amount, unit: f.unit, leverage: f.leverage, held: held(), positions, chains, prepared, pay: payCoin() });
    kb.hidden = !html;
    paint(kb, html);
  };
  // the block's chain and its line to the sibling kind, heard on the block (drawn again in place)
  kb.addEventListener("change", (e) => {
    const sel = e.target.closest && e.target.closest("select[name='chain']");
    if (!sel) return;
    const row = (chains || []).find((c) => c.symbol === sel.value);
    if (row && picked) choose({ venue: picked.venue, venueName: picked.venueName, symbol: row.symbol });
  });
  kb.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button[data-cross-kind]");
    if (!b) return;
    const x = TK.cross && TK.cross.item;
    if (x) tkOpen({ kind: b.dataset.crossKind, item: x, side });
  });
  /* a tokenised asset's chains: the wallet's own markets for it (TOKEN/USDC@Chain), read once a venue is picked */
  const loadChains = async () => {
    if (kind !== "rwas" || !picked || !item || !item.base) return;
    const want = picked.venue;
    const body = await api(`/api/account/markets?${new URLSearchParams({ venue: want, q: item.base })}`, { ttl: 60_000 });
    if (!live() || !picked || picked.venue !== want) return;
    chains = ((body && body.markets) || []).filter((x) => x.kind === "token" && String(x.base).toUpperCase() === String(item.base).toUpperCase() && x.symbol.includes("@")).map((x) => ({ symbol: x.symbol, chain: x.symbol.split("@").pop(), quote: x.quote }));
    drawKind();
  };
  /* the one line to the sibling kind: a stock as a token (RWAs), a token as shares (Stocks) — found once, from the markets read */
  cross = async () => {
    TK.cross = null;
    if (!item || !item.base || !["stocks", "rwas"].includes(kind)) return;
    const other = kind === "stocks" ? "rwas" : "stocks";
    const was = item;
    const got = await tkReadKind(other, item.base);
    if (!live() || item !== was) return;
    const x = got.items.find((y) => String(y.base || "").toUpperCase() === String(was.base).toUpperCase());
    if (x) TK.cross = { kind: other, item: x };
    drawKind();
  };

  // ---- the quote, what is signed, the signature ----
  const draft = () => tkOrderDraft(formFields(form), { venue: picked.venue, symbol: picked.symbol, side, event: !!mk && mk.kind === "event" });
  // the signature's minutes, on the page's one clock (core everySecond): false stops it; a change is written in the clock's frame
  const left = () => {
    const el = box.querySelector("[data-left]");
    if (!live() || !prepared || !el) return false;
    const ms = prepared.action.deadline - Date.now();
    if (ms <= 0) return void requote(true);
    // how long the order as prepared stands: signed before then, it goes as shown; after, it is prepared again from the fields
    const t = `Ready to sign for ${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
    if (el.textContent !== t) return () => setText(el, t);
  };
  const leftNow = () => {
    const w = left();
    if (typeof w === "function") w();
  };
  // an event's close, counted down in the face's block on the same clock: one text node a second, only when its words change
  everySecond(() => {
    if (!live()) return false;
    const el = kb.querySelector("[data-tk-close]");
    if (!el) return;
    const t = typeof mkLeft === "function" ? mkLeft(Date.parse(el.dataset.tkClose) - Date.now()) : "";
    if (t && el.textContent !== t) return () => setText(el, t);
  });
  /* the order prepared again from the fields: not when nothing changed and its ten minutes have a while to run; what is signed stays open
     if it was. Paying with a coin: the sale prepared, the buy estimated from what it would bring now */
  let asked = "";
  const requote = async (force = false) => {
    if (!live() || !picked || !mk || second) return;
    payPlan = payPlanNow();
    const two = !!(payPlan && payPlan.mode === "two");
    const d = two ? payPlan.legs[0] : draft();
    const key = JSON.stringify([d, two]);
    if (!force && prepared && key === asked && prepared.action.deadline - Date.now() > 30_000) return;
    const open = !!sign.querySelector("details[open]");
    const my = ++seq;
    prepared = null;
    asked = key;
    btn.disabled = true;
    btn.title = LOOK;
    btn.textContent = tkSignWord(venueOf());
    signed("");
    stopLeft();
    drawKind();
    // a tokenised asset its issuer has closed or keeps from being swapped: the issuer's words, and no button that would only be refused
    const shut = tkShut(item, mk);
    if (shut) {
      show(`<div class="msg no">${esc(shut)}</div>`);
      btn.title = shut;
      return;
    }
    if (payPlan && !payPlan.mode) return void show(`<div class="msg no">${esc(payPlan.why)}</div>`);
    const amount = Number(two ? payPlan.legs[0].qty : d.qty || d.usd);
    // a prediction's limit or stop typed in cents is a chance: outside 0–100 it is no price, and the ticket says so instead of asking
    const typed = formFields(form);
    const noChance = mk.kind === "event" && ((TK_LIMITED.includes(d.orderType) && tkCentsBad(typed.limitPrice)) || (TK_STOPPED.includes(d.orderType) && tkCentsBad(typed.stopPrice)));
    const noTrail = !two && d.orderType === "trailing_stop" && !(Number(d.trailPercent || d.trailPrice) > 0);
    if (noChance || !(amount > 0) || noTrail || (!two && TK_LIMITED.includes(d.orderType) && !(Number(d.limitPrice) > 0)) || (!two && TK_STOPPED.includes(d.orderType) && !(Number(d.stopPrice) > 0))) {
      show(`<div class="big"><span>${esc(mk.name)}</span><span>${mk.kind === "event" ? esc(tkCents(mk.price)) : mk.price ? `${esc(px(mk.price))} ${esc(mk.quote)}` : "no price"}</span></div><div class="path">${two ? `${esc(tkSwapHow(payPlan))} ` : ""}${noChance ? "A price in cents is between 0 and 100: a contract pays $1.00 at most." : !(amount > 0) ? "Type an amount." : noTrail ? "Type how far the stop trails: a percent or a price." : TK_LIMITED.includes(d.orderType) && !(Number(d.limitPrice) > 0) ? "Type the limit price." : "Type the stop price."}</div>`);
      return;
    }
    // below the smallest order the venue takes (its own rules, as the market read gave them): said at once, nothing asked of the account
    const small = two ? "" : tkTooSmall(mk, d, picked.venueName || nameOf(picked.venue));
    if (small) return void show(`<div class="msg no">${esc(small)}</div>`);
    show(`<span class="dim">Asking ${esc(picked.venueName || nameOf(picked.venue))}…</span>`);
    const r = await Owner.prepare(d);
    if (!live() || my !== seq) return;
    if (r.status !== 200) return void show(`<div class="msg no">${esc(Owner.why(r) || "Refused")}</div>${tkHowToFix(picked.venue, r)}`);
    let thenWords = "";
    if (two) {
      // the buy as it would be if the sale brought what it is worth now: an estimate; it is prepared again, and signed, once the sale fills
      const est = Math.floor(Number(r.body.quote.order.notionalUsd) * 100) / 100;
      const r2 = await Owner.prepare({ ...payPlan.legs[1], usd: String(est) });
      if (!live() || my !== seq) return;
      thenWords = `<div class="path"><b>2 · then</b> ${r2.status === 200 ? `${esc(r2.body.quote.order.words)}, with about ${money(est)} of ${esc(payPlan.via)}: sized by what the sale brings, prepared and signed once it has filled.` : `buy ${esc(item.base)}: ${esc(Owner.why(r2) || "refused")}`}</div>`;
    }
    prepared = r.body;
    const now = levNow();
    show(`${two ? '<div class="path"><b>Two steps, two signatures.</b> 1 · first</div>' : ""}${tkOrderWords(prepared, two ? payPlan.market : mk, { lev: now ? now.leverage : 0 })}${thenWords}<div class="left-t" data-left></div>`);
    signed(whatYouSign(prepared, { open, notes: tkSignNotes(prepared, mk.kind === "event") }));
    btn.textContent = two ? "Sign the sale (1 of 2)" : tkSignWord(venueOf());
    btn.disabled = !owns() || !writesOn();
    drawKind();
    pctOf(prepared);
    leftNow();
    stopLeft = everySecond(left);
  };
  /* the slider follows the order prepared: its share of what is available (tkPctFill's other way round — dollars of the cash for a buy or a
     perpetual, units of the holding for a sell), unless the owner has the slider in hand, which the order then follows */
  const pctOf = (prep) => {
    const el = form.elements.pct;
    if (!el || document.activeElement === el || !prep || !prep.quote || !prep.quote.order) return;
    const a = availOf();
    if (!a) return;
    const sell = side === "sell" && !(a.perp);
    const of = a.coin ? null : sell ? (a.qty > 0 ? Number(prep.action.qty) / a.qty : null) : a.cash > 0 ? Number(prep.quote.order.notionalUsd) / a.cash : null;
    if (of === null || !Number.isFinite(of)) return;
    const v = String(Math.max(0, Math.min(100, Math.round(of * 100))));
    if (el.value !== v) el.value = v;
    setText(q("[data-pct-v]"), `${v}%`);
    pctFill(v);
  };
  const later = debounce(requote);
  /* the buy of a two-step, from what the sale brought: prepared, shown, signed on its own */
  const prepSecond = async () => {
    if (!live() || !second) return;
    btn.disabled = true;
    signed("");
    const done = `<div class="path"><b>1 · done</b> ${esc(saidOf({ kind: "order", order: second.sold }))} — it brought ${money(second.usd)}.</div>`;
    show(`${done}<span class="dim">Asking ${esc(picked.venueName || nameOf(picked.venue))} for the buy…</span>`);
    const r = await Owner.prepare({ type: "liveOrder", venue: picked.venue, symbol: second.then.symbol, side: "buy", orderType: "market", usd: String(second.usd), limitPrice: "", stopPrice: "", tif: "", postOnly: "", reduceOnly: "" });
    if (!live() || !second) return;
    if (r.status !== 200) return void show(`${done}<div class="msg no">${esc(Owner.why(r) || "Refused")}</div>`);
    prepared = r.body;
    show(`${done}<div class="path"><b>2 · now</b></div>${tkOrderWords(prepared, second.then)}<div class="left-t" data-left></div>`);
    signed(whatYouSign(prepared, { open: true }));
    btn.textContent = "Sign the buy (2 of 2)";
    btn.disabled = !owns();
    stopLeft();
    leftNow();
    stopLeft = everySecond(left);
  };

  /* what is typed is kept in this browser (tkDraftKeep) while there is an amount or a price in it; placing it, or closing the ticket, drops it */
  const keep = () => {
    if (!item || !picked || !mk) return;
    const f = formFields(form);
    if (!String(f.amount || "").trim() && !String(f.limitPrice || "").trim()) return void tkDraftKeep(null);
    tkDraftKeep({ kind, venue: picked.venue, venueName: picked.venueName || "", symbol: picked.symbol, side, outcome, key: item.key, base: item.base || "", name: item.name, amount: f.amount || "", unit: f.unit || "", pay, orderType: f.orderType || "", limitPrice: f.limitPrice || "", stopPrice: f.stopPrice || "", tif: f.tif || "" });
  };
  let rankTimer = 0;
  form.addEventListener("input", (e) => {
    const n = e.target && e.target.name;
    // the leverage typed is set on its own (Set leverage…): it changes nothing the account prepares for the order
    if (n === "leverage" || n === "marginMode") return void levReady();
    if (n === "q" || n === "chain") return;
    keep();
    if (n === "amount" || n === "unit") {
      clearTimeout(rankTimer);
      rankTimer = setTimeout(rank, 600);
    }
    later();
  });
  form.addEventListener("change", async (e) => {
    const n = e.target && e.target.name;
    if (n === "leverage" || n === "marginMode") return void levReady();
    if (n === "q" || n === "chain") return;
    if (n === "pay") {
      pay = form.elements.pay.value;
      const coin = payCoin();
      if (coin) await payMore(coin.asset);
      else if (mk && item && String(mk.quote).toUpperCase() !== pay) {
        // another dollar: the same coin's market against it, at the same venue
        const row = payMarkets.find((x) => String(x.base).toUpperCase() === String(item.base).toUpperCase() && String(x.quote).toUpperCase() === pay);
        if (row && picked) {
          payShape();
          keep();
          return void choose({ venue: picked.venue, venueName: picked.venueName, symbol: row.symbol });
        }
      }
      if (!live()) return;
      payShape();
    }
    keep();
    shape();
    later(0);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!prepared || busy || !owns()) return;
    const p = prepared;
    const two = !!(payPlan && payPlan.mode === "two") && !second;
    const leg2 = !!second;
    btn.disabled = true;
    say(`Placing it at ${nameOf(p.action.venue)}…`, "wait");
    busy = true;
    document.body.classList.add("busy");
    let r;
    try {
      r = await Owner.submit(p);
    } finally {
      busy = false;
      document.body.classList.remove("busy");
    }
    if (!live()) return void load();
    if (refusedAt(r)) {
      say(Owner.why(r) || "Refused", "no");
      return void (leg2 ? prepSecond() : requote(true));
    }
    prepared = null;
    // the order is placed: the positions kept are the ones before it, so the next read (the panel's position line) asks the venues afresh
    forget("/api/account/positions");
    let o = r.body.kind === "order" ? r.body.order : null;
    let words = saidOf(r.body);
    let bad = false;
    if (o && o.walletTxs && !o.ref) {
      try {
        say("Waiting for your wallet…", "wait");
        await sendOrderFromWallet(o);
        words = said || words;
      } catch (err) {
        words = `${String((err && err.message) || err).slice(0, 200)}. It waits under Under way: “Send from wallet…”`;
        bad = true;
      }
    }
    if (two && !bad) {
      // the sale went: the buy waits for it to fill, then is prepared from what it brought and shown before its own signature
      for (const el of form.querySelectorAll("input, select")) el.disabled = true;
      say(`${words}. Waiting for the sale to fill…`, "wait");
      o = await tkFilled(o, live);
      if (!live()) return;
      for (const el of form.querySelectorAll("input, select")) el.disabled = false;
      if (!o || !["filled", "partial"].includes(o.status) || !(o.filledQty > 0)) {
        flash = `${o ? `${o.id} is ${o.status}` : "The sale has not filled yet"}: the buy waits. It is under Under way; buy again once it fills.`;
        say(flash, "no");
        return void load();
      }
      second = { then: payPlan.then, usd: tkProceeds(o), sold: o };
      say("", "");
      await load();
      if (live()) prepSecond();
      return;
    }
    if (leg2) {
      words = `Swapped: ${words}`;
      second = null;
    }
    if (bad) flash = words;
    else said = words;
    form.elements.amount.value = "";
    tkDraftKeep(null);
    say(words, bad ? "no" : "ok");
    await load();
    if (live()) requote(true);
  });
  q("[data-hand]").addEventListener("click", () => {
    const f = formFields(form);
    openHandToAgent({ kind, venue: picked ? picked.venue : preset.venue || "", symbol: picked ? picked.symbol : "", side, outcome: item && item.kind === "event" ? outcome : "", usd: f.unit === "usd" ? String(f.amount || "").trim() : "" });
  });

  // ---- what the ticket was opened with ----
  // a ticket the owner opened (not the panel at rest) — or one at rest on a market (a draft reopened, the terminal's own start) — is left
  // as it was opened: the terminal does not start on a market of its own over it (ui/terminal.js ttDraw). Said as it opens, before its
  // market is looked up: a kind's read landing meanwhile would otherwise start on the busiest and replace it
  if ((!preset.rest || preset.item || preset.venue) && typeof TT === "object") TT.started = true;
  // a ticket on no market (the "t" key, a venue's Trade, a market not found): the terminal's bar, chart and book let go of the last one, so
  // nothing shows a market the panel is not on (a price pressed in the book would have no ticket to go to)
  const onNone = () => {
    if (typeof ttSetItem === "function") ttSetItem(null);
  };
  if (preset.item && typeof preset.item === "object") pick(preset.item, preset.venue ? { venue: preset.venue, symbol: preset.symbol } : undefined);
  else if (preset.venue && preset.symbol) tkPresetItem(preset).then((x) => live() && (x ? pick(x, { venue: preset.venue, symbol: preset.symbol }) : onNone()));
  else if (preset.venue && preset.base) tkPresetByBase(preset, kind).then((x) => {
    if (!live()) return;
    if (x) pick(x, { venue: preset.venue });
    else {
      onNone();
      form.elements.q.value = String(preset.base);
      search();
    }
  });
  else {
    onNone();
    if (preset.symbol) form.elements.q.value = String(preset.symbol);
    search();
    // opened on purpose (the "t" key, a row): the cursor goes to the search; the panel at rest takes no focus
    if (!preset.symbol && !preset.venue && !preset.rest) setTimeout(() => live() && form.elements.q.focus({ preventScroll: true }), 0);
  }
}

/* a Markets row's venues, in a few words */
const tkWhereWords = (x) => {
  const conn = (x.at || []).filter((a) => a.connected);
  const pub = (x.at || []).filter((a) => a.public);
  return [conn.length ? conn.map((a) => a.venueName).join(", ") : "", pub.length ? `${plural(pub.length, "public venue")}` : ""].filter(Boolean).join(" · ") || "—";
};

/* a compared venue (compare.ts rowOf) is of the face it is shown on: a coin's Where never a perpetual standing in for it, a stock's never
   an RWA token of the same name (`category` tells a token an issuer stands behind from a coin) */
function tkOfFace(r, face) {
  const k = r.kind;
  if (!k) return true;
  if (face === "stocks") return k === "stock";
  if (face === "rwas") return k === "token" && (r.category === undefined || r.category === "RWA");
  if (face === "crypto") return ["spot", "crypto", "token"].includes(k) && r.category !== "RWA";
  if (face === "perps" || face === "preipo") return k === "perp" || k === "future";
  if (face === "predictions") return k === "event";
  return true;
}

/** where a row is listed, as the ticket shows it: your accounts that can trade it (ranked by `compare` rows where the venues were compared —
 * the best first — kept to the face's kind), the ones that cannot (with their words and how to fix it), the venues that publish it without
 * a key ("Connect to trade"; a read-only server offers no connection: the line is a price). A pre-IPO venue carries its implied valuation
 * and unit, which differ by venue */
/* the band above the venues: which kind of account the order picked is for — PAPER (no real money) or REAL MONEY — and at which venue */
const tkMoneyBand = (r) => (!r ? "" : r.paper ? `<span class="tk-money paper" title="A paper account: no real money changes hands">PAPER · no real money · ${esc(tkPaperless(r.venueName))}</span>` : `<span class="tk-money real" title="A real account: real money">REAL MONEY · ${esc(r.venueName)}</span>`);
/* a paper account's name without the word its Paper tag already says: "Momentum · paper" is "Momentum" beside the tag. A name that is only
   that word stays as it is */
const tkPaperless = (name) => String(name || "").replace(/\s*[·-]\s*paper\s*$/i, "") || String(name || "");
/* the sign button's word: PAPER on it at a paper account, so the last thing before signing says which money this is */
const tkSignWord = (v) => (v && v.paper ? "Sign and place · PAPER" : "Sign and place");
function tkWhereRows(item, ranked, kind = "") {
  if (!item) return [];
  const face = kind || tkKindOf({ item });
  const rows = [];
  // the venues that list it and do not serve this network: not listed, only counted (`rows.away`), so the ticket can say that none serves
  let away = 0;
  const seen = new Set();
  for (const r of ranked || []) {
    if (!tkOfFace(r, face)) continue;
    const v = A.venues.find((x) => x.id === r.venue);
    if (!v) continue;
    seen.add(r.venue);
    if (!servedHere(v)) {
      away++;
      continue;
    }
    const able = canTrade(v) && r.canTrade !== false;
    rows.push(able ? { state: "able", ...(v.closeOnly ? { closeOnly: true } : {}), ...(v.paper ? { paper: true } : {}), venue: r.venue, venueName: r.venueName, symbol: r.symbol, price: r.price, best: !!r.best, closed: !r.open, worse: r.best ? 0 : r.worse, note: r.ready === false && r.open ? r.note || "" : "" } : { state: "off", ...(v.paper ? { paper: true } : {}), venue: r.venue, venueName: r.venueName, why: tkWhyNot(v), how: tkHow(v) });
  }
  // a public line is a price; it offers its connection only where none of your accounts trades the thing (a connected venue whose key may;
  // a paper account — by its leg or by the account's own row for the venue — rehearses, it does not trade the thing)
  const paperAt = (a) => !!(a.paper || (A.venues.find((v) => v.id === a.venue) || {}).paper);
  const tradedHere = (item.at || []).some((a) => a.connected && !paperAt(a) && a.canTrade !== false);
  for (const a of item.at || []) {
    if (a.public) {
      if (a.connectTo && A.venues.some((v) => v.id === a.connectTo && v.live)) continue;
      // a venue that would refuse the user from where they are (core VENUES) offers no connection; one that does not serve this network, or
      // offers no way in, is not listed at all — the list is what serves the user
      const no = typeof venueRefuses === "function" ? venueRefuses(a.connector) : null;
      if (no && (no.verdict === "not-served" || no.verdict === "closed")) {
        away++;
        continue;
      }
      // its own terms exclude where the user is: said beside the connection, which stays (the venue's sign-up decides)
      const terms = !no && typeof venueTermsSay === "function" ? venueTermsSay(a.connector) : null;
      rows.push({ state: "public", venue: a.venue, venueName: a.venueName, symbol: a.symbol, price: a.price, ...(a.implied ? { implied: a.implied } : {}), connector: tradedHere || !writesOn() || no ? "" : a.connector, connectTo: a.connectTo, note: a.note || "", ...(no ? { refuses: no } : {}), ...(terms ? { terms } : {}) });
      continue;
    }
    if (seen.has(a.venue)) continue;
    const v = A.venues.find((x) => x.id === a.venue);
    if (!v) continue;
    seen.add(a.venue);
    if (!servedHere(v)) {
      away++;
      continue;
    }
    const able = canTrade(v) && a.canTrade !== false;
    rows.push(able ? { state: "able", ...(v.closeOnly || a.closeOnly ? { closeOnly: true } : {}), ...(v.paper || a.paper ? { paper: true } : {}), venue: a.venue, venueName: a.venueName, symbol: a.symbol, price: a.price, ...(a.implied ? { implied: a.implied } : {}), closed: a.open === false, note: a.note || "" } : { state: "off", ...(v.paper || a.paper ? { paper: true } : {}), venue: a.venue, venueName: a.venueName, why: a.note || tkWhyNot(v), how: tkHow(v) });
  }
  // your accounts first (a paper account after the real ones — before them when the page is on Paper), then the ones that cannot, then
  // the public prices
  const order = { able: 0, off: 1, public: 2 };
  const paperFirst = lensNow().kind === "paper" ? -1 : 1;
  return Object.assign(rows.sort((x, y) => order[x.state] - order[y.state] || paperFirst * (Number(!!x.paper) - Number(!!y.paper))), { away });
}
/* why a venue that offers something cannot do it now, in its own words where it gave some */
const tkWhyNot = (v) => v.noTradeBecause || (v.trade && v.trade.can === false ? "this key can't trade" : watched(v) ? "a watched address: nothing is traded from it" : "orders are not placed here");
/* a tokenised asset that takes no order now — its issuer closed it, or keeps it from being swapped (no order types) — in the issuer's words;
   "" for anything else, and for one that is open */
function tkShut(item, m) {
  if (!m || !((item && item.kind === "rwa") || m.issuer)) return "";
  const none = Array.isArray(m.types) && !m.types.length;
  if (m.open !== false && !none) return "";
  const iss = typeof mkIssuer === "function" && item ? mkIssuer(item) : null;
  const words = String(m.note || "").trim().replace(/[.\s]+$/, "") || (iss && iss.eligibility) || m.eligibility || "the issuer takes no order for it now";
  return `${none ? "No order for it here" : "Closed now"}${m.issuer ? ` · ${m.issuer}` : ""}: ${words}.`;
}
/* what to change at the venue so that its key trades */
const tkHow = (v) => (v.trade && v.trade.can === false && /^[a-z]/.test(v.id) && !v.address ? `${keyHowFor(v)} Then connect it again.` : "");
/* a refusal that says the key may not trade, with what to change at the venue */
function tkHowToFix(venue, r) {
  const v = A.venues.find((x) => x.id === venue);
  const code = r && r.body && r.body.refusal && r.body.refusal.code;
  if (!v || !/PERMISSION|KEY|SCOPE/.test(String(code || ""))) return "";
  return `<div class="path">${esc(keyHowFor(v))} Then connect it again.</div>`;
}

/** an order the account prepared, in words — HL's summary under its button: a headline (the side as the ticket's toggle says it, Long or
 * Short on a perpetual; the size; about what it is worth), then label · value rows from the prepared order itself — its value, the margin it
 * needs at the leverage the venue holds the market at (`lev`, where the venue said one: tkTicket levNow), the most a market buy may cost,
 * the worst price it may fill at — then how it goes, its flags and the venue's note. Every figure is the prepared order's, so nothing here
 * can disagree with what is signed. An event contract's in cents, with what it pays */
function tkOrderWords(p, m, { lev = 0 } = {}) {
  const a = p.action;
  const q = p.quote.order;
  const ev = q.kind === "event";
  const perp = q.kind === "perp" || q.kind === "future";
  const unit = UNITS[q.kind] || q.base;
  const at = (n) => (ev ? tkCents(n) : `${px(n)} ${q.quote}`);
  const trail = a.trailPercent ? `${a.trailPercent}%` : a.trailPrice ? at(a.trailPrice) : "";
  const how = a.orderType === "stop" ? `when the price reaches ${esc(at(a.stopPrice))}, at market` : a.orderType === "stop_limit" ? `when the price reaches ${esc(at(a.stopPrice))}, a limit at ${esc(at(a.limitPrice))}` : a.orderType === "trailing_stop" ? `at market once the price ${a.side === "sell" ? "falls" : "rises"} ${esc(trail)} from its ${a.side === "sell" ? "highest" : "lowest"} since now` : `at ${esc(at(a.limitPrice || q.price))}`;
  const exits = [a.takeProfit ? `take profit at ${at(a.takeProfit)}` : "", a.stopLoss ? `stop loss at ${at(a.stopLoss)}` : ""].filter(Boolean).join(", ");
  const flags = [a.tif ? TK_TIF_NAMES[a.tif] : "", a.postOnly ? "post-only" : "", a.reduceOnly ? "reduce-only" : "", a.extendedHours ? "extended hours" : "", exits ? `then ${exits} (one cancels the other)` : ""].filter(Boolean).join(" · ");
  const n = Number(a.qty);
  const what = ev ? `${m && m.outcome ? m.outcome : q.name}` : unit === q.base ? q.base : `${unit} · ${q.base}`;
  const sideWord = perp ? (a.side === "sell" ? "Short" : "Long") : a.side === "buy" ? "Buy" : "Sell";
  const value = Number(q.notionalUsd);
  const atMarket = a.orderType === "market" || a.orderType === "stop" || a.orderType === "trailing_stop";
  const rows = [
    ["Order value", money(value)],
    perp && lev > 0 && value > 0 ? ["Margin required", `${money(value / lev)} at ${esc(String(lev))}x`] : null,
    atMarket && a.side === "buy" && Number(q.maxUsd) > value ? ["Most it may cost", money(q.maxUsd)] : null,
    atMarket && q.worstPrice !== undefined ? ["Fills no worse than", esc(at(q.worstPrice))] : null,
  ].filter(Boolean);
  return `<div class="big"><span>${esc(sideWord)} ${esc(a.qty)} ${esc(ev ? `contracts · ${what}` : what)}</span><span>≈ ${money(value)}</span></div><dl class="tk-qrows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl><div class="path">${esc(q.name)} ${how}</div>${ev && a.side === "buy" && n > 0 ? `<div class="path"><b>Pays ${money(n)}</b> if it happens (the most it can pay) · costs about ${money(value)}</div>` : ""}${ev && a.side === "sell" && n > 0 ? `<div class="path">You get about ${money(value)} for ${esc(plural(n, "contract"))} now, instead of $1.00 each if it happens.</div>` : ""}${flags ? `<div class="path">${esc(flags)}</div>` : ""}${q.note ? `<details class="path tk-qnote"><summary>How it fills here</summary>${esc(q.note)}</details>` : ""}`;
}

/** THE SMALLEST ORDER, judged before the account is asked: a market or limit order's size against the market's own rules as its venue
 * lists them (minQty, qtyStep, minNotional) — a size in dollars turned into units at the price it would be valued at (its limit, else the
 * ask for a buy and the bid for a sell, else the last price), down to the step, as the account turns it. Below the smallest the venue takes,
 * its words — what the venue takes, and about what that is worth — so the ticket says so at once instead of asking the account for a
 * refusal it knows. Anything it cannot judge (a stop, no price, no rule) is "": the account judges it as before */
function tkTooSmall(m, d, venueName = "") {
  if (!m || !d || !["market", "limit"].includes(d.orderType)) return "";
  const byQty = d.qty !== undefined && d.qty !== "";
  const size = Number(byQty ? d.qty : d.usd);
  if (!(size > 0)) return "";
  const price = d.orderType === "limit" && Number(d.limitPrice) > 0 ? Number(d.limitPrice) : Number((d.side === "sell" ? m.bid : m.ask) ?? m.price);
  if (!(price > 0)) return "";
  const each = price * (Number(m.contractSize) > 0 ? Number(m.contractSize) : 1);
  const step = Number(m.qtyStep) > 0 ? Number(m.qtyStep) : 0;
  const qty = byQty ? size : tkFloor(size / each, step);
  const least = Math.max(Number(m.minQty) > 0 ? Number(m.minQty) : 0, byQty ? 0 : step);
  const where = venueName || "the venue";
  const unit = m.kind === "event" ? "contracts" : tkSizeUnit(m) || m.base || "";
  if (least > 0 && qty < least - 1e-12) return `The smallest order ${where} takes here is ${qtyOf(least)}${unit ? ` ${unit}` : ""} (about ${money(least * each)}).`;
  if (Number(m.minNotional) > 0 && qty * each < Number(m.minNotional) - 1e-9) return `The smallest order ${where} takes here is worth ${money(m.minNotional)}.`;
  return "";
}

/** a ticket opened on one market at one venue: the row it would be on Markets, with its outcomes (an event) and the other places it is
 * listed; a pre-IPO market's row carries the company, the implied valuation and the issuer's words */
async function tkPresetItem(preset) {
  const v = A.venues.find((x) => x.id === preset.venue);
  const body = await api(`/api/account/market?${new URLSearchParams({ venue: preset.venue, symbol: preset.symbol })}`, { ttl: 3_000 });
  if (!body || body.ok === false) {
    toast(refusalOf(body) || `${(v && v.name) || preset.venue} lists no ${preset.symbol}`, "no");
    return null;
  }
  const m = body.market;
  const kind = tkRowKind(m);
  const at = [{ venue: preset.venue, venueName: (v && v.name) || preset.venue, symbol: m.symbol, connected: true, canTrade: v && v.trade ? v.trade.can : false, public: false, price: m.price, open: m.open, ...(m.implied ? { implied: { ...m.implied, usd: m.implied.usd || (m.price && m.implied.perPoint ? m.price * m.implied.perPoint : undefined) } } : {}), ...(m.issuer ? { issuer: m.issuer } : {}), ...(m.eligibility ? { eligibility: m.eligibility } : {}) }];
  const pre = tkPre(m);
  const x = { key: pre && m.group ? m.group.id : `${kind}:${m.base}`, kind, name: kind === "event" && m.group ? m.group.title : pre && m.group ? m.group.title : m.kind === "perp" ? m.name : m.base, base: kind === "event" ? undefined : m.base, price: m.price, changePct24h: m.changePct24h, closeTime: m.closeTime, category: m.category, fundingRate: m.fundingRate, ...(m.group ? { group: m.group } : {}), ...(at[0].implied ? { implied: at[0].implied } : {}), ...(m.issuer ? { issuer: m.issuer } : {}), ...(m.eligibility ? { eligibility: m.eligibility } : {}), tabs: [], at };
  if (kind === "event" && m.group) {
    // its other outcomes, as the venue lists them under the same question
    const sib = await api(`/api/account/markets?${new URLSearchParams({ venue: preset.venue, q: m.group.id })}`, { ttl: 30_000 });
    const outs = ((sib && sib.markets) || []).filter((s) => s.group && s.group.id === m.group.id);
    x.outcomes = (outs.length ? outs : [m]).map((s) => ({ label: s.outcome || s.name, price: s.price, bid: s.bid, ask: s.ask, at: [{ venue: preset.venue, symbol: s.symbol }] }));
    if (!preset.outcome) preset.outcome = m.outcome || "";
    return x;
  }
  if (kind !== "event" && m.base) {
    // where else it is listed: the public venues that publish it ("Connect to trade") and your other accounts
    const got = await tkReadKind(tkKindOf({ item: x }), m.base);
    const row = got.items.find((r) => r.kind === kind && (r.base || "").toUpperCase() === String(m.base).toUpperCase());
    if (row) x.at = [...at, ...row.at.filter((a) => a.venue !== preset.venue)];
  }
  return x;
}
/** a ticket opened on something held (You hold): the row of its kind that names the asset, listed at the venue holding it */
async function tkPresetByBase(preset, kind) {
  const got = await tkReadKind(kind, preset.base);
  const same = (x) => String(x.base || x.name || "").toUpperCase() === String(preset.base).toUpperCase();
  return got.items.find((x) => same(x) && (x.at || []).some((a) => a.venue === preset.venue && a.connected)) || got.items.find(same) || null;
}

/** Connect to trade: the one short form for the connection the row names (connect.js connectVia), opened straight away */
function tkConnectTo(a) {
  if (!owns()) return void toast("This browser only looks: pair it to connect an account.", "no");
  if (!connectVia(a.connector, { name: a.venueName })) toast(`${a.venueName} can't be connected from this server.`, "no");
}

/** Advanced ▸ is folded, so its one line says what is set — else the venue's own rule for this order type, from what the market lists
 * (its times in force, per type where they differ; whether a limit may be post-only or an order reduce-only), never invented */
function tkAdvSummary(m, f = {}) {
  const t = f.orderType || "market";
  const eh = !!(m.session && m.session.extendedHours);
  const set = [f.tif ? TK_TIF_NAMES[f.tif] || f.tif : "", t === "limit" && f.postOnly ? "post-only" : "", f.reduceOnly ? "reduce-only" : "", t === "limit" && eh && f.extendedHours ? "extended hours" : ""].filter(Boolean);
  if (set.length) return set.join(" · ");
  const allowed = (m.tifsByType && m.tifsByType[t]) || m.tifs || [];
  const word = (x) => (TK_TIF_NAMES[x] || x).toLowerCase();
  if (!allowed.length && !m.postOnly && !m.reduceOnly && !eh) return "The venue's defaults: no time in force, post-only or reduce-only is set from here";
  if (allowed.length && allowed.every((x) => x === "ioc" || x === "fok")) return `A ${(TK_TYPE_NAMES[t] || t).toLowerCase()} order here fills now or is cancelled (${allowed.join("/")})`;
  if (allowed.length && !allowed.includes("gtc")) return `Never rests until cancelled here: ${allowed.map(word).join(" or ")}`;
  return `${allowed.length ? `The venue's default · ${allowed.map(word).join(" · ")}` : "The venue's default time in force"}${m.postOnly && t === "limit" ? " · post-only possible" : ""}${m.reduceOnly ? " · reduce-only possible" : ""}${eh && t === "limit" ? " · extended hours possible" : ""}`;
}

/** Advanced's line in a few letters, as HL writes its own ("TIF GTC"): the time in force set, by its code (GTC, IOC, FOK, DAY) — else, where
 * every time in force this order type takes here fills now, those (IOC/FOK) — else "Default", the venue's own — and a flag that is set.
 * The whole rule in words (tkAdvSummary) is its title, so nothing is cut to fit */
function tkAdvShort(m, f = {}) {
  const t = f.orderType || "market";
  const allowed = (m.tifsByType && m.tifsByType[t]) || m.tifs || [];
  const tif = f.tif ? String(f.tif).toUpperCase() : allowed.length && allowed.every((x) => x === "ioc" || x === "fok") ? allowed.map((x) => String(x).toUpperCase()).join("/") : "Default";
  const eh = !!(m.session && m.session.extendedHours);
  return [tif, t === "limit" && f.postOnly ? "Post-only" : "", t === "limit" && eh && f.extendedHours ? "Extended hours" : ""].filter(Boolean).join(" · ");
}

/* a stock market's session as the face says it — open now and when it closes, or closed and when it opens — from the venue's own clock or
   the market calendar it sends its orders by (the market's `session`), never from `open`: a stock out of its session may still take an
   order, which the venue holds for the open. "" where the venue said no session */
function tkSessionLine(s) {
  if (!s || typeof s.open !== "boolean") return "";
  const at = s.open ? s.closesAt : s.opensAt;
  const when = at && Number.isFinite(Date.parse(at)) ? at : "";
  // a session the venue trades outside the regular one (Alpaca's pre-market, after-hours, overnight): what is on, until when, and whether a
  // limit order with extended hours trades in it now — on New York's clock and the viewer's own
  const ph = s.phase && s.phase !== "regular" && s.phase !== "closed" ? s.phase : "";
  if (ph) {
    const ends = s.phaseEndsAt && Number.isFinite(Date.parse(s.phaseEndsAt)) ? s.phaseEndsAt : "";
    const name = { pre: "Pre-market", after: "After-hours", overnight: "Overnight session" }[ph] || ph;
    return `<b>${esc(name)}</b>${ends ? ` · until ${esc(nyTime(ends))} New York${esc(yourTime(ends))}` : ""}${s.extendedHours ? " · a limit order with extended hours trades now" : " · orders wait for the regular session"}${when ? ` · regular session opens ${esc(nyDay(when))}, ${esc(nyTime(when))} New York${esc(yourTime(when))}` : ""}`;
  }
  return s.open ? `<b>Open now</b>${when ? ` · closes ${esc(nyTime(when))} New York${esc(yourTime(when))}` : ""}` : `<b>Closed</b>${when ? ` · opens ${esc(nyDay(when))}, ${esc(nyTime(when))} New York${esc(yourTime(when))}` : ""}`;
}

/* the one line to the sibling kind, when the ticket found one: a stock as a token (RWAs), a token as shares (Stocks) */
const tkCrossLine = (kind) => {
  const x = TK.cross;
  if (!x || !x.item || x.kind === kind) return "";
  const it = x.item;
  return x.kind === "rwas" ? `Also as a token: ${esc(it.name)}${it.price ? ` $${esc(px(it.price))}` : ""} → <button type="button" class="link" data-cross-kind="rwas">RWAs</button>` : `Also as shares: ${esc(it.name)}${it.price ? ` $${esc(px(it.price))}` : ""} → <button type="button" class="link" data-cross-kind="stocks">Stocks</button>`;
};

/** THE FACE'S BLOCK: what the owner should know of this kind of market before ordering, from the market as the venue lists it (`m`), the
 * place picked (`at`: a Where row), the Markets row (`item`) and the ticket's state (`c`: side, outcome, amount, unit, leverage typed, the
 * position held, the positions read, the chains read, what it is paid with). A pre-IPO row speaks from the row itself when no market is
 * picked (no key connected): the valuation, the unit, the conversion and the company's own notice are the row's */
function tkKindBlock(kind, m, at, item, c = {}) {
  const L = [];
  const said = (t) => esc(String(t || "").trim());
  const pre = kind === "preipo";
  if (!m && !(pre && item)) return "";
  if (m && !m.open) L.push(`<b>Closed now.</b>${m.note ? ` ${said(m.note)}` : ""}`);
  if (kind === "crypto") {
    if (m.bid || m.ask) L.push(`Bid ${esc(px(m.bid))} · ask ${esc(px(m.ask))} ${esc(m.quote)}${m.changePct24h !== undefined ? ` · 24h ${chg(m.changePct24h)}` : ""}`);
    // a wallet's route, its slippage and gas in the venue's own words; an exchange says nothing more
    if (m.open && m.note) L.push(said(m.note));
    if (c.pay) L.push(`Paid with <b>${esc(c.pay.asset)}</b>: sold first, then ${esc(m.base)} bought with what it brings — two orders, two signatures.`);
  } else if (kind === "stocks") {
    // the session (when the venue keeps one), then the venue's own words verbatim; no session said: its words alone. A stock that takes no
    // order now says so in the line above
    if (m.open) L.push([tkSessionLine(m.session), m.note ? said(m.note) : ""].filter(Boolean).join(" · "));
    if (m.qtyStep === 1) L.push("Whole shares only here.");
    if (m.bid || m.ask) L.push(`Bid ${esc(px(m.bid))} · ask ${esc(px(m.ask))} ${esc(m.quote)}`);
    L.push(tkCrossLine(kind));
  } else if (kind === "rwas") {
    const iss = (item && item.issuer) || m.issuer || "";
    const el = (item && item.eligibility) || m.eligibility || "";
    if (iss || el) L.push(`<div class="tk-iss">${iss ? `Issued by <b>${esc(iss)}</b>.` : ""}${el ? ` <span class="dim">${esc(el)}</span>` : ""}</div>`);
    const chain = String(m.symbol || "").split("@")[1] || "";
    const chains = c.chains && c.chains.length > 1 ? `<label class="fld tk-chain">Chain${select("chain", c.chains.map((x) => [x.symbol, `${x.chain} · ${x.quote}`]), m.symbol)}</label>` : "";
    L.push(`Paid in <b>${esc(m.quote)}</b>${chain && !chains ? ` on ${esc(chain)}` : ""}.${chains}`);
    // the route's own line: its fee, slippage and gas, and whom it excludes
    if (m.open && m.note) L.push(said(m.note));
    L.push(tkCrossLine(kind));
  } else if (kind === "perps" || pre) {
    const imp = pre ? (at && at.implied) || (item && item.implied) || (m && m.implied) || null : null;
    if (pre) {
      const usd = imp ? imp.usd || (m && m.price && imp.perPoint ? m.price * imp.perPoint : undefined) : undefined;
      L.push(`<b>Implied valuation ≈ ${usd ? esc(tkValuation(usd)) : "—"}</b>${m && m.price ? ` · a contract ${esc(px(m.price))} ${esc(m.quote)}` : item && item.price ? ` · a contract ${esc(px(item.price))}` : ""}`);
      if (imp && imp.unit) L.push(said(imp.unit));
      L.push("Becomes a stock perpetual at the IPO; the venue rebases when the share count is public.");
    }
    if (m) {
      if (m.price && !pre) L.push(`Mark ${esc(px(m.price))} ${esc(m.quote)}${m.changePct24h !== undefined ? ` · 24h ${chg(m.changePct24h)}` : ""}`);
      if (m.fundingRate !== undefined) L.push(`Funding ${esc((m.fundingRate * 100).toFixed(4))}% a period${m.nextFundingAt ? `, next paid ${esc(nyTime(m.nextFundingAt))} New York` : ""}${m.maxLeverage ? ` · up to ${esc(String(m.maxLeverage))}x here` : ""}.`);
      else if (m.maxLeverage) L.push(`Up to ${esc(String(m.maxLeverage))}x here.`);
      // the margin an order needs is the quote's (tkOrderWords: Margin required), worked out from the order the account prepared — never
      // from the amount typed, which a market's step may round down
      // the leverage the door just set here is shown as the venue confirmed it, until the venue's positions read says the same
      const h = c.held || null;
      const set = TK.lev && at && TK.lev.venue === at.venue && TK.lev.symbol === m.symbol ? TK.lev : null;
      if (set && h && h.leverage !== undefined && String(h.leverage) === String(set.leverage)) TK.lev = null;
      if (set && !(h && String(h.leverage) === String(set.leverage))) L.push(`Leverage ${esc(String(set.leverage))}x${set.marginMode ? `, ${esc(set.marginMode)}` : ""} — set now, as ${esc(at.venueName || nameOf(at.venue))} confirmed${h && h.leverage !== undefined ? `; its positions read still says ${esc(String(h.leverage))}x` : ""}.`);
      if (h) L.push(`You hold ${esc(h.side)} ${esc(qtyOf(h.qty))}${h.leverage ? ` at ${esc(String(h.leverage))}x` : ""}${h.liquidationPrice ? ` · liquidation at ${esc(px(h.liquidationPrice))}` : ""}${h.entryPrice ? ` · entry ${esc(px(h.entryPrice))}` : ""}.`);
      else if (c.positions) L.push("Nothing held here yet: the venue names a liquidation price once a position is open.");
      if (m.open && m.note) L.push(said(m.note));
    }
    if (pre) {
      const el = (item && item.eligibility) || (m && m.eligibility) || "";
      if (el) L.push(`<div class="tk-iss"><b>What the company says</b> <span class="dim">${esc(el)}</span></div>`);
      L.push("This is a contract on a valuation, not a share.");
    }
  } else if (kind === "predictions") {
    const p = c.side === "sell" ? m.bid ?? m.price : m.ask ?? m.price;
    const out = m.outcome || c.outcome || "this outcome";
    const n = Number(c.amount) > 0 ? (c.unit === "qty" ? Number(c.amount) : p ? Math.floor(Number(c.amount) / p) : 0) : 0;
    L.push(n > 0 && c.side !== "sell" ? `<b>${esc(qtyOf(n))} contracts pay ${money(n)}</b> if ${esc(out)} · cost ≈ ${money(n * (p || 0))} · the market gives it ${p ? `${Math.round(p * 100)}%` : "no price"}` : `<b>${esc(out)}</b> at ${esc(tkCents(p))} — the market gives it ${p ? `${Math.round(p * 100)}%` : "no price"}. Each contract pays $1.00 if it happens, nothing if not.`);
    const close = m.closeTime || (item && item.closeTime);
    if (close) L.push(`<span data-tk-close="${esc(close)}">${esc(typeof mkLeft === "function" ? mkLeft(Date.parse(close) - Date.now()) : "Closes")}</span> · ${esc(nyDay(close))} ${esc(nyTime(close))} New York`);
    if (m.sellsReduce) L.push(`Sells only what you hold${c.held ? ` · ${esc(qtyOf(c.held.qty))} held` : c.positions ? " · none held" : ""}.`);
    if (m.open && m.note) L.push(said(m.note));
  }
  return L.filter(Boolean).map((l) => `<div>${l}</div>`).join("");
}

/** a perpetual's leverage from the ticket: prepared, shown field by field, then its own signature; `after` runs once the venue confirmed */
function tkLeverage(box, at, m, live, after) {
  const out = box.querySelector("[data-lev-sign]");
  box.querySelector("[data-lev-prep]").addEventListener("click", async () => {
    const lev = String(box.querySelector('input[name="leverage"]').value || "").trim();
    const modeSel = box.querySelector('select[name="marginMode"]');
    const mode = modeSel ? modeSel.value : "";
    if (!/^\d{1,3}$/.test(lev) || !(Number(lev) >= 1)) return void (out.innerHTML = '<div class="msg no">Leverage is a whole number, 1 or more.</div>');
    out.innerHTML = '<span class="dim small">Asking…</span>';
    const r = await Owner.prepare({ type: "liveLeverage", venue: at.venue, symbol: m.symbol, leverage: lev, marginMode: mode });
    if (!live()) return;
    if (r.status !== 200) return void (out.innerHTML = `<div class="msg no">${esc(Owner.why(r) || "Refused")}</div>`);
    const p = r.body;
    out.innerHTML = `<div class="path">${esc(m.name)}: ${esc(lev)}x${mode ? `, ${esc(mode)}` : ""} at ${esc(at.venueName || nameOf(at.venue))}.</div>${whatYouSign(p, { open: true })}<button type="button" class="btn btn-sm" data-lev-go${owns() ? "" : " disabled"}>Sign leverage</button>`;
    out.querySelector("[data-lev-go]").addEventListener("click", async (e) => {
      e.target.disabled = true;
      const s = await Owner.submit(p);
      if (!live()) return;
      const res = s.body && s.body.result;
      if (!refusedAt(s)) {
        // what the door set is shown in the face's block as the venue confirmed it, until the positions read — asked afresh, not from what
        // was kept — says the same
        TK.lev = { venue: at.venue, symbol: m.symbol, leverage: (res && res.leverage) || lev, marginMode: (res && res.marginMode) || mode || "" };
        forget("/api/account/positions");
        if (after) after();
      }
      out.innerHTML = refusedAt(s) ? `<div class="msg no">${esc(Owner.why(s) || "Refused")}</div>` : `<div class="msg ok">${esc(m.name)}: ${esc(String((res && res.leverage) || lev))}x${res && res.marginMode ? `, ${esc(res.marginMode)}` : ""}</div>`;
    });
  });
}

// ---- under way ---------------------------------------------------------------------------------

/* the orders on a book or on their way to one, in the lens (an agent's lens: that agent's): Under way's rows, and the Open orders tab's count
   (ui/terminal.js), one list for both */
const tkOpenOrders = () => (A.orders || []).filter((o) => isLive(o) && inLens(o.venue, o.agent));
/* cards for trading the owner answers (under Portfolio › Waiting for you): an agent's order, its change, its close, money it puts to earn */
const tkTradeCard = (c) => /order|amend|close|earn|trade/i.test(String(c.kind || ""));
const tkCardVenue = (c) => ((c.shown || []).find((f) => f.name === "venue") || {}).value || "";

/** Under way — the terminal's Open orders tab: the orders on a book or waiting for a wallet in HL's columns (Time · Type · Market ·
 * Direction · Size · Original size · Order value · Price · Reduce only · Trigger, then the state, who placed it and its buttons: Change,
 * Cancel, Send from wallet), the account's id for each order on hover; Cancel all heads the buttons' column, as HL's Cancel All does. Under
 * that table, what else is under way — an agent's card (a status row whose one action is Review: it is answered under Portfolio, the one
 * place), money on its way, money going in or out of earn — in the lens. Drawn again only when it changed, the focused button (by its
 * data-fk) focused again: core paint */
function tkDrawOpen(sec, owner) {
  const orders = tkOpenOrders();
  const cards = A.cards.filter((c) => tkTradeCard(c) && inLens(tkCardVenue(c), c.agent));
  const pays = A.payments.filter((p) => p.live && ["pending", "authorized"].includes(p.status) && inLens(p.from, p.agent));
  const earns = (A.earns || []).filter((x) => x.status === "pending" && inLens(x.venue, x.agent));
  const cancellable = orders.filter((o) => !(o.walletTxs && !o.ref) && !o.canceling);
  const rows = [...cards.map((c) => ({ c })), ...pays.map((p) => ({ p })), ...earns.map((x) => ({ x }))];
  // where it is and who placed it: one line under what it is
  const whereOf = (r) => (r.c ? nameOf(tkCardVenue(r.c)) || "—" : r.o ? r.o.venueName : r.p ? nameOf(r.p.from) : r.x.venueName);
  const who = (r) => (r.c ? r.c.agentName || "An agent" : byOf(r.o || r.p || r.x));
  const byLine = (r) => { const b = who(r); return `by ${b === "You" || b === "An agent" ? b.toLowerCase() : b}`; };
  const all = owner && cancellable.length > 1 ? `<button type="button" class="link" data-cancel-all data-fk="cancel-all">Cancel all ${cancellable.length}</button>` : "";
  const ordersHtml = orders.length ? `<div class="t-wrap"><table class="t tt-t tk-open-t"><thead><tr><th>Time</th><th>Type</th><th>Market</th><th>Direction</th><th class="r">Size</th><th class="r">Original size</th><th class="r">Order value</th><th class="r">Price</th><th>Reduce only</th><th>Trigger</th><th>Status</th><th>By</th><th class="r">${all || '<span class="sr">Actions</span>'}</th></tr></thead><tbody>${orders.map((o) => tkOpenRow(o, owner)).join("")}</tbody></table></div>` : '<p class="empty">No open orders yet.</p>';
  const rest = rows.length ? `<h3 class="label tk-open-also">Also under way</h3>${table([
    { label: "What", cell: (r) => `${tkOpenWhat(r)}<span class="why tp-wb">${esc(whereOf(r))} · ${esc(byLine(r))}</span>` },
    { label: "Status", cell: (r) => tkOpenStatus(r) },
    { label: "", r: true, cell: (r) => (r.c || owner ? tkOpenActs(r) : "") },
  ], rows)}` : "";
  const html = `<h2 class="sr" id="tp-open-h">Open orders</h2>${ordersHtml}${rest}`;
  // what Cancel all takes off, as last drawn; the rows' buttons are heard once, on the section (they are drawn again in place)
  sec.tkCancellable = cancellable;
  paint(sec, html);
  if (sec.tkHeard) return;
  sec.tkHeard = true;
  sec.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("button");
    if (!b || !sec.contains(b) || b.disabled) return;
    const d = b.dataset;
    // an agent's card is answered under Portfolio › Waiting for you: Review goes there, to that card
    if (d.review) return void go("portfolio", { card: d.review });
    if (d.amend) return void openAmend(A.orders.find((x) => x.id === d.amend));
    // an agent's order comes off the book after a yes; the owner's own with one click (core cancelOrder)
    if (d.cancel) return void cancelOrder(A.orders.find((x) => x.id === d.cancel));
    if (d.orderSend) return void thenLoad(() => sendOrderFromWallet(A.orders.find((x) => x.id === d.orderSend)))(b);
    if (d.walletSend) return void thenLoad(async () => {
      const p = A.payments.find((x) => x.id === d.walletSend);
      const nat = p && p.legs[0].native;
      if (nat && nat.walletTx) await sendFromWallet(p, nat.walletTx, nat.walletTxs);
    })(b);
    if (!b.hasAttribute("data-cancel-all")) return;
    const all = sec.tkCancellable || [];
    if (!(await confirmSheet(`Cancel all ${all.length} open orders${lensNow().kind === "all" ? "" : ` in ${lensNow().name}`}? Each comes off its venue's book, one signature each.`, { title: "Cancel every open order", yes: `Cancel ${all.length} orders`, no: "Keep them", danger: true }))) return;
    for (const o of all) await own({ type: "liveCancel", venue: o.venue, order: o.id });
  });
}
/** one open order as a row of HL's Open orders: when it was placed (New York), its type, the market by its name (the venue beside it,
 * quieter; the account's id and the venue on hover — never the raw symbol), the side in its word and colour, what is left of it and what it
 * was, what it is worth, its limit (Market for one at market; an event's in cents), whether it only reduces, what triggers it, its state,
 * who placed it, and its buttons */
function tkOpenRow(o, owner) {
  const ev = o.kind === "event";
  const at = (n) => (n === undefined || n === null ? "—" : esc(ev ? tkCents(n) : px(n)));
  const left = Math.max(0, Number(o.qty) - Number(o.filledQty || 0));
  const unit = ev || o.contractSize ? " contracts" : "";
  const trigger = o.type === "stop" || o.type === "stop_limit" ? `${o.side === "buy" ? "Rises to" : "Falls to"} ${at(o.stopPrice)}` : o.type === "trailing_stop" ? `Trails ${o.trailPercent !== undefined ? esc(`${o.trailPercent}%`) : at(o.trailPrice)}` : "—";
  const r = { o };
  return `<tr><td class="tab-nums nw">${esc(nyDay(o.at))} ${esc(nyTime(o.at))}</td><td class="nw">${esc(TK_TYPE_NAMES[o.type] || o.type || "—")}</td><td class="tt-c-mkt" title="${esc(`${o.id} · ${o.venueName}`)}"><b>${esc(o.name || o.base)}</b>${o.paper ? ' <span class="tag paper">Paper</span>' : ""}<span class="why">${esc(o.venueName)}</span></td><td class="${o.side === "sell" ? "down" : "up"}">${o.side === "sell" ? "Sell" : "Buy"}</td><td class="r">${esc(qtyOf(left))}${unit}</td><td class="r">${esc(qtyOf(o.qty))}${unit}</td><td class="r">${o.usd !== undefined ? money(o.usd) : "—"}</td><td class="r">${o.limitPrice !== undefined ? at(o.limitPrice) : "Market"}</td><td>${o.reduceOnly ? "Yes" : "No"}</td><td class="nw">${trigger}</td><td>${tkOpenStatus(r)}</td><td>${esc(byOf(o))}</td><td class="r">${owner ? tkOpenActs(r) : ""}</td></tr>`;
}
function tkOpenWhat(r) {
  if (r.c) return `${esc(r.c.reason)}<details class="inl"><summary>details</summary><pre class="tk-pre">${esc((r.c.shown || []).map((f) => `${f.name}: ${f.value}`).join("\n"))}</pre></details>`;
  if (r.o) {
    const o = r.o;
    const ev = o.kind === "event";
    return `${o.side === "buy" ? "Buy" : "Sell"} ${esc(qtyOf(o.qty))} ${esc(ev ? "contracts" : o.contractSize ? "contracts" : o.base)} · ${esc(ev ? (o.type === "limit" ? `limit ${tkCents(o.limitPrice)}` : "market") : typeText(o))}<span class="why">${esc([o.name, o.filledQty ? `${qtyOf(o.filledQty)} filled` : "", o.id].filter(Boolean).join(" · "))}</span>`;
  }
  if (r.p) return `${esc(typeof whatOf === "function" ? whatOf(r.p) : `${r.p.kind} ${r.p.id}`)}<span class="why">${esc([money(r.p.amountUsd), r.p.note, r.p.id].filter(Boolean).join(" · "))}</span>`;
  const x = r.x;
  return `${x.kind === "withdraw" ? "Take out of" : "Put into"} ${esc(x.productName)} · ${esc(x.all ? "all" : qtyOf(x.amount))} ${esc(x.asset)}<span class="why">${esc([money(x.usd), x.note, x.id].filter(Boolean).join(" · "))}</span>`;
}
function tkOpenStatus(r) {
  if (r.c) return `<span class="tp-st warn-t">Waiting for you</span>${r.c.expiresAt ? `<span class="why">answer by ${esc(nyTime(r.c.expiresAt))}</span>` : ""}`;
  if (r.o) {
    const o = r.o;
    // an order the account stopped following (the owner's cancel asked while its venue refused this network, or was not connected): a
    // state, its note on hover. The account sends that cancel again once the venue answers this network
    if (o.unfollowed && !o.canceling) return `<span class="tp-st dim"${o.note ? ` title="${esc(o.note)}"` : ""}>Not followed</span>`;
    const note = o.note ? `<span class="why">${esc(o.note)}</span>` : "";
    if (o.canceling) return `<span class="tp-st dim">Canceling</span>${note}`;
    if (o.walletTxs && !o.ref) return `<span class="tp-st warn-t">Waiting for your wallet</span>${note}`;
    return `${o.status === "partial" ? '<span class="tp-st">Part filled</span>' : o.status === "pending" ? '<span class="tp-st dim">On the way</span>' : '<span class="tp-st">Open</span>'}${note}`;
  }
  if (r.p) return r.p.status === "authorized" ? '<span class="tp-st warn-t">Waiting for your wallet</span>' : '<span class="tp-st dim">On the way</span>';
  return '<span class="tp-st dim">On the way</span>';
}
/* a row's buttons, each named (data-fk) so a redraw gives the focused one its focus back; a card's one button is Review */
function tkOpenActs(r) {
  if (r.c) return `<div class="acts"><button type="button" class="btn btn-sm" data-review="${esc(r.c.id)}" data-fk="review:${esc(r.c.id)}">Review</button></div>`;
  if (r.o) {
    const o = r.o;
    const waiting = o.walletTxs && !o.ref;
    // an order not followed is not changed (Cancel stays: it sends the owner's cancel again)
    const amendable = !waiting && !o.canceling && !o.unfollowed && ((A.venues.find((x) => x.id === o.venue) || {}).trade || {}).amend;
    return `<div class="acts">${waiting ? `<button type="button" class="btn btn-sm" data-order-send="${esc(o.id)}" data-fk="send:${esc(o.id)}"${INFLIGHT.has(o.clientId) ? " disabled" : ""}>${o.reported ? "Report again" : "Send from wallet…"}</button>` : ""}${amendable ? `<button type="button" class="btn btn-sm" data-amend="${esc(o.id)}" data-fk="amend:${esc(o.id)}">Change</button>` : ""}${o.canceling ? "" : `<button type="button" class="btn btn-sm" data-cancel="${esc(o.id)}" data-venue="${esc(o.venue)}" data-fk="cancel:${esc(o.id)}">Cancel</button>`}</div>`;
  }
  if (r.p && r.p.status === "authorized") return `<div class="acts"><button type="button" class="btn btn-sm" data-wallet-send="${esc(r.p.id)}" data-fk="send:${esc(r.p.id)}"${INFLIGHT.has(`${r.p.id}@${r.p.at}`) ? " disabled" : ""}>${r.p.live && r.p.live.reported ? "Report again" : "Send from wallet…"}</button></div>`;
  return "";
}

// ---- closing a position (Portfolio › Positions and the market drawer open it) -----------------------

/* what the account says closing would be, as it prepared it: its worth at the worst price it may fill at, this server's cap for an order and
   whether it is over it, the side and the size. An account that does not say it gives null, and the close is shown as before */
const tkCloseQuote = (prep) => {
  const q = prep && prep.quote;
  const c = q && (q.close || q);
  return c && Number.isFinite(Number(c.worthUsd)) ? c : null;
};
/* the most of it one order may close on this server: the size scaled to the cap, a little under it (the price moves), in the market's own
   steps of a size (contracts whole); nothing when even the smallest order the venue takes would be over it */
function tkClosePart(qty, worthUsd, capUsd, whole, { step = 0, min = 0 } = {}) {
  if (!(qty > 0) || !(worthUsd > 0) || !(capUsd > 0)) return 0;
  const n = (Number(qty) * capUsd * 0.98) / worthUsd;
  const part = step > 0 ? Number((Math.floor(n / step + 1e-9) * step).toPrecision(12)) : whole ? Math.floor(n) : Math.floor(n * 1e6) / 1e6;
  return part > 0 && !(min > 0 && part < min) ? part : 0;
}
/* the close in words: the side and size, what it is worth at the worst price it may fill at — and, over this server's cap, the cap and a
   part that fits (the cap is said only there: the block message). `rules` the market's steps of a size, when read */
function tkCloseWords(prep, p, rules = {}) {
  const ev = p.kind === "event";
  const c = tkCloseQuote(prep);
  const pxOf = (n) => (ev ? tkCents(n) : px(n));
  const pnl = p.unrealizedUsd !== undefined ? ` · ${p.unrealizedUsd >= 0 ? "up" : "down"} ${money(Math.abs(p.unrealizedUsd))} now` : "";
  if (!c) return `<div class="big"><span>${esc(prep.action.qty ? `${p.side === "long" ? "Sell" : "Buy back"} ${prep.action.qty}` : `All ${qtyOf(p.qty)}`)}</span><span>${p.usd !== undefined ? `≈ ${money(prep.action.qty ? (p.usd * Number(prep.action.qty)) / p.qty : p.usd)}` : ""}</span></div><div class="path">${esc(p.name)} at ${esc(p.venueName || nameOf(p.venue))}, at market${pnl}</div>`;
  const n = c.qty !== undefined && c.qty !== "" ? Number(c.qty) : prep.action.qty ? Number(prep.action.qty) : p.qty;
  const part = c.overCap ? tkClosePart(n, Number(c.worthUsd), Number(c.capUsd), ev, rules) : 0;
  return `<div class="big"><span>${esc(c.side === "buy" ? "Buy back" : "Sell")} ${esc(qtyOf(n))}${ev ? " contracts" : ""}</span><span>≈ ${esc(money(c.worthUsd))}</span></div><div class="path">${esc(p.name)} at ${esc(p.venueName || nameOf(p.venue))}, at market${c.worstPrice !== undefined ? `, filled no worse than ${esc(pxOf(c.worstPrice))}` : ""}${esc(pnl)}</div>${c.capUsd && c.overCap ? `<div class="path">One order may be worth up to ${esc(money(c.capUsd))} on this server.${part > 0 ? ` Close part of it instead: <button type="button" class="link" data-close-part="${esc(String(part))}">${esc(qtyOf(part))}${ev ? " contracts" : ""}</button>.` : ""}</div>` : ""}`;
}
/* a close the account would refuse: worth more than this server lets one order be — in the account's words where it gave them. Said before
   the sign button, which stays off */
function tkCloseBlock(prep) {
  const c = tkCloseQuote(prep);
  if (!c || !c.overCap) return "";
  return c.why ? `${String(c.why).charAt(0).toUpperCase()}${String(c.why).slice(1)}.`.replace(/\.\.$/, ".") : `Worth about ${money(c.worthUsd)}: more than the ${money(c.capUsd)} one order may be on this server, so the account would refuse it. Close part of it.`;
}

/** CLOSE A POSITION, all of it or some — from Portfolio's Positions or the market drawer: the account prepares the close and says what it
 * is worth at the worst price it may fill at; one worth more than this server's cap for an order is refused here, before the sign button,
 * which stays off and says why (and a part that fits is one click away). What you sign is shown; your signature closes it */
function openClose(p) {
  if (!p) return;
  const ev = p.kind === "event";
  const sells = ev || p.kind === "stock";
  // the market's steps of a size, so a part offered is one the venue takes
  const rules = {};
  const q = quoteDialog({
    title: `${sells ? "Sell" : "Close"} ${p.name}`,
    sub: esc(`${p.venueName || nameOf(p.venue)} · ${p.side} ${qtyOf(p.qty)}${ev ? " contracts" : ""}${p.markPrice ? ` · now ${ev ? tkCents(p.markPrice) : px(p.markPrice)}` : ""}. At market: ${p.side === "short" ? "bought back" : "sold"}, and only ever down to nothing.`),
    fields: field("How much", `<input name="qty" inputmode="decimal" placeholder="All ${esc(qtyOf(p.qty))}" autocomplete="off" />`),
    draft: (form) => ({ type: "liveClose", venue: p.venue, symbol: p.symbol, qty: String(new FormData(form).get("qty") || "").trim() }),
    show: (prep) => tkCloseWords(prep, p, rules),
    block: (prep) => tkCloseBlock(prep),
    // what is held is read again everywhere it is shown, rather than kept
    done: () => {
      for (const path of ["/api/account/positions", "/api/account/holdings", "/api/account/asset"]) forget(path);
      return "";
    },
    go: sells ? "Sign and sell" : "Sign and close",
  });
  q.form.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-close-part]");
    if (!b) return;
    q.form.elements.qty.value = b.dataset.closePart;
    q.requote();
  });
  api(`/api/account/market?${new URLSearchParams({ venue: p.venue, symbol: p.symbol })}`, { ttl: 30_000 }).then((b) => {
    const m = b && b.ok !== false && b.market;
    if (!m || !q.form.isConnected) return;
    Object.assign(rules, { step: Number(m.qtyStep) || 0, min: Number(m.minQty) || 0 });
    if (tkCloseQuote(q.prepared) && tkCloseQuote(q.prepared).overCap) q.requote();
  });
}

// ---- paying with a coin held: two orders through the dollar both markets share -------------------

/* the stablecoins and cash a plan reads as dollars: the account's own list (core isDollar) */
const tkDollar = (asset) => isDollar(asset);
/** How buying `to` with `from` goes at one venue, from what it lists: a dollar into a coin (`buy`) or a coin into a dollar (`sell`), one
 * order; a coin into another coin (`two`): sold for the dollar both markets share, then bought with what the sale brought — two orders, two
 * signatures. One dollar for another is not a trade here: Move owns it ("Swap stablecoins", a liveMove swap). `markets` are the venue's
 * (GET /markets), `chain` the chain the coin is held on (a wallet) */
function tkSwapPlan({ venue, from, to, amount, markets, chain = "" }) {
  const F = String(from || "").toUpperCase();
  const T = String(to || "").toUpperCase();
  const amt = String(amount || "").trim();
  if (!F || !T) return { mode: "", why: "Pick what to pay with and what to buy." };
  if (F === T) return { mode: "", why: "Pick two different assets." };
  const onChain = (m) => !chain || !m.symbol.includes("@") || m.symbol.endsWith(`@${chain}`);
  const spotLike = (m) => ["spot", "token", "crypto"].includes(m.kind) && m.open !== false;
  const find = (base, quote) => (markets || []).find((m) => spotLike(m) && String(m.base).toUpperCase() === base && (!quote ? tkDollar(m.quote) : String(m.quote).toUpperCase() === quote) && onChain(m));
  if (tkDollar(F) && tkDollar(T)) return { mode: "", why: "One dollar for another is a move, not a trade: Move › Swap stablecoins, under Portfolio." };
  const order = (m, side, size) => ({ type: "liveOrder", venue, symbol: m.symbol, side, orderType: "market", ...size, limitPrice: "", stopPrice: "", tif: "", postOnly: "", reduceOnly: "" });
  if (tkDollar(F)) {
    const m = find(T, F);
    return m ? { mode: "buy", from: F, to: T, legs: [order(m, "buy", { usd: amt })], market: m } : { mode: "", why: `${T} isn't listed against ${F} here${find(T) ? ` (it trades against ${find(T).quote})` : ""}.` };
  }
  if (tkDollar(T)) {
    const m = find(F, T);
    return m ? { mode: "sell", from: F, to: T, legs: [order(m, "sell", { qty: amt })], market: m } : { mode: "", why: `${F} isn't listed against ${T} here${find(F) ? ` (it trades against ${find(F).quote})` : ""}.` };
  }
  const first = find(F);
  if (!first) return { mode: "", why: `${F} has no dollar market here.` };
  const second = find(T, String(first.quote).toUpperCase());
  if (!second) return { mode: "", why: `${T} isn't listed against ${first.quote} here, so it can't be bought with what selling ${F} brings.` };
  return { mode: "two", from: F, to: T, legs: [order(first, "sell", { qty: amt }), order(second, "buy", { usd: "" })], market: first, then: second, via: first.quote };
}
/* a two-step plan in words, before an amount */
const tkSwapHow = (plan) => (plan.mode === "two" ? `Two orders: sells ${plan.from} for ${plan.via} (${plan.market.symbol}), then buys ${plan.to} with what that brings (${plan.then.symbol}) — two signatures.` : plan.mode === "buy" ? `Buys ${plan.to} with ${plan.from} at market (${plan.market.symbol}).` : plan.mode === "sell" ? `Sells ${plan.from} for ${plan.to} at market (${plan.market.symbol}).` : plan.why || "");
/* what a filled sale brought, in its quote currency, less its fee, down to the cent: what the second leg spends */
const tkProceeds = (o) => Math.floor(Math.max(0, Number(o.filledQty || 0) * Number(o.avgPrice || o.price || 0) - Number(o.feeUsd || 0)) * 100) / 100;
/** a sale's fill, asked of the account every two seconds for up to a minute and a half */
async function tkFilled(o, live) {
  const until = Date.now() + 90_000;
  let now = o;
  while (live() && Date.now() < until) {
    if (now && ["filled", "canceled", "rejected", "expired"].includes(now.status)) return now;
    await new Promise((res) => setTimeout(res, 2000));
    const page = await fetch("/api/account").then((x) => x.json()).catch(() => null);
    now = page ? (page.orders || []).find((x) => x.id === o.id) || now : now;
  }
  return now;
}
