/* THE HEATMAP (Markets › Heatmap; after Finviz's map of the market): the US stock market's day as one picture. One tile a company's share,
   its AREA the company's market cap at the last close, its COLOUR the share's change from its last regular close — the Account's green up,
   its red down, grey where it stands or where Nasdaq did not price it, the deeper the colour the bigger the move up to the scale chosen
   (±1 · ±3 · ±5 percent, the owner's pick, kept in the address with the count: #/markets?tab=heatmap&n=500&scale=5). The tiles are packed
   by sector, each sector a band with its name and its own market-cap-weighted change; a sector's name zooms into it — its companies packed
   by industry — and "All sectors" zooms out. Read from GET /api/account/heatmap?n= (live/heatmap.ts: Nasdaq's stock screener for the
   companies, their sectors and their sizes; Nasdaq's real-time quotes, twenty a call, for the colours), asked again every half minute
   while the tab shows and the page is in view, so the colours follow the day; the layout is this file's own (hmSquarify: the largest first,
   each row of tiles laid along the shorter side of what is left, so every tile is as near square as the packing allows — Bruls, Huizing and
   van Wijk's squarified treemap) and is laid again only when the map's width changes.
   Every tile is a button: a hover or a key's focus says the company whole in the pane's hover card (its price, its change, its market cap,
   its industry, the quote's own time and source — or that Nasdaq did not price it), a click opens the market in the one drawer
   (ui/markets.js openMarket, by its stock key), where it is traded, watched, alerted on and read as every market is. The tiles are drawn
   through the pane's paint() keyed by ticker, so a fresh read recolours what stands and a resize moves it, with no tile torn down. Nothing
   here is a sample: a share Nasdaq did not price is grey and says so, and what Nasdaq would not answer is said in its own words. */

/* what the heatmap holds between draws: the last read ({ body, at }) and the last good one, the width the map was laid out for, the pane it
   listens on, its poll, the hover card */
const HM = { got: null, good: null, pending: false, width: 0, el: null, ro: null, roEl: null, timer: 0, peek: null, peekAt: null, peekShow: 0, peekHide: 0, redrawSoon: false };
/* the counts the page offers and the colour scales (percent at which a tile is fully coloured) */
const HM_COUNTS = [100, 250, 500];
const HM_SCALES = [1, 3, 5];
const HM_DEFAULT_N = 250;
const HM_DEFAULT_SCALE = 3;
/* a read is asked again this long after the last, while the tab shows (the account keeps its answer 15 s and each quote 45 s) */
const HM_POLL_MS = 30_000;
const HM_TTL = 25_000;
/* a sector band's name strip, and the gap between tiles, in px */
const HM_HEAD = 18;
const HM_GAP = 2;
/* the map's height from its width: wide screens a landscape, a phone a portrait */
const hmHeight = (w) => (w < 560 ? Math.round(w * 1.15) : Math.max(360, Math.min(820, Math.round(w * 0.56))));

/* the route's count, scale and sector, as the map reads them */
function hmParams(params) {
  const n = Number(params && params.n);
  const scale = Number(params && params.scale);
  const sector = String((params && params.sector) || "").trim().slice(0, 40);
  return { n: HM_COUNTS.includes(n) ? n : HM_DEFAULT_N, scale: HM_SCALES.includes(scale) ? scale : HM_DEFAULT_SCALE, sector };
}
const hmPath = (n) => `/api/account/heatmap?n=${n}`;
/* the tab is what shows: Markets, on the heatmap */
const hmShown = () => !!A && ROUTE.tab === "markets" && typeof mkParams === "function" && mkParams(ROUTE.params).tab === "heatmap";

/* one read: the last answer is kept with the last one that was not a refusal, so a failure never blanks the map */
function hmFetch(n) {
  if (HM.pending) return;
  HM.pending = true;
  api(hmPath(n)).then((body) => {
    HM.pending = false;
    const ok = !!body && body.ok !== false && Array.isArray(body.tiles);
    HM.got = { body, at: Date.now(), n };
    if (ok) HM.good = { body, at: Date.now(), n };
    if (hmShown() && typeof mkRedrawShown === "function") paneLater("markets", mkRedrawShown);
  });
}

// ---- the layout --------------------------------------------------------------------------------------

/* the worst aspect ratio in a row of areas laid along a side of length `side` (Bruls et al.): 1 is square */
function hmWorst(row, area, side) {
  let mx = 0;
  let mn = Infinity;
  for (const a of row) {
    if (a > mx) mx = a;
    if (a < mn) mn = a;
  }
  const s2 = side * side;
  return Math.max((s2 * mx) / (area * area), (area * area) / (s2 * mn));
}
/** SQUARIFIED: `items` ({ v } each, the largest first) packed into the box (x, y, w, h), one rectangle an item in the items' order — { x, y,
 * w, h } in the box's units. Each row is laid along the shorter side of what is left, and an item joins the row while it keeps the row's
 * worst aspect ratio from getting worse; what cannot be laid (no area, no box) gets no rectangle */
function hmSquarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, it) => s + (it.v > 0 ? it.v : 0), 0);
  if (!(total > 0) || !(w > 0) || !(h > 0)) return out;
  const per = (w * h) / total;
  let X = x;
  let Y = y;
  let W = w;
  let H = h;
  let i = 0;
  while (i < items.length) {
    if (!(items[i].v > 0)) {
      i++;
      continue;
    }
    // a row along the shorter side: a column when what is left is wide, a row when it is tall
    const column = W >= H;
    const side = column ? H : W;
    let row = [];
    let rowArea = 0;
    let worst = Infinity;
    let j = i;
    while (j < items.length) {
      const a = items[j].v > 0 ? items[j].v * per : 0;
      if (!(a > 0)) {
        j++;
        continue;
      }
      const next = [...row, a];
      const wr = hmWorst(next, rowArea + a, side);
      if (wr > worst) break;
      row = next;
      rowArea += a;
      worst = wr;
      j++;
    }
    const thick = side > 0 ? rowArea / side : 0;
    let off = 0;
    let k = i;
    for (const a of row) {
      while (k < j && !(items[k].v > 0)) k++;
      const len = thick > 0 ? a / thick : 0;
      out[k] = column ? { x: X, y: Y + off, w: thick, h: len } : { x: X + off, y: Y, w: len, h: thick };
      off += len;
      k++;
    }
    if (column) {
      X += thick;
      W -= thick;
    } else {
      Y += thick;
      H -= thick;
    }
    i = j;
  }
  return out;
}
/** the map laid out: the tiles grouped by `groupOf` (their sector, or their industry inside one), the groups packed by their summed cap
 * and, inside each, the tiles by theirs — { groups: [{ name, x, y, w, h, head (its name strip is drawn), tiles: [{ t, x, y, w, h }] }] },
 * every box in px from the map's corner, the gaps taken off */
function hmLayout(tiles, groupOf, w, h) {
  const by = new Map();
  for (const t of tiles) {
    const name = groupOf(t) || "Other";
    if (!by.has(name)) by.set(name, { name, v: 0, tiles: [] });
    const g = by.get(name);
    g.v += t.marketCap > 0 ? t.marketCap : 0;
    g.tiles.push(t);
  }
  const groups = [...by.values()].sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
  const boxes = hmSquarify(groups, 0, 0, w, h);
  return {
    groups: groups.map((g, i) => {
      const b = boxes[i] || { x: 0, y: 0, w: 0, h: 0 };
      const head = b.h >= HM_HEAD + 12 && b.w >= 40;
      const inner = { x: HM_GAP / 2, y: (head ? HM_HEAD : 0) + HM_GAP / 2, w: Math.max(0, b.w - HM_GAP), h: Math.max(0, b.h - (head ? HM_HEAD : 0) - HM_GAP) };
      const sorted = [...g.tiles].sort((a, c) => c.marketCap - a.marketCap || a.symbol.localeCompare(c.symbol)).map((t) => ({ t, v: t.marketCap }));
      const tb = hmSquarify(sorted, inner.x, inner.y, inner.w, inner.h);
      return { name: g.name, x: b.x, y: b.y, w: b.w, h: b.h, head, tiles: sorted.map((s, k) => ({ t: s.t, ...(tb[k] || { x: 0, y: 0, w: 0, h: 0 }) })).filter((x) => x.w > 0 && x.h > 0) };
    }),
  };
}

// ---- the words and the colours -------------------------------------------------------------------------

/* a change in percent as the tile writes it: +1.12% · −0.45% · 0.00% (a minus sign, not a hyphen) */
function hmPct(n) {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
}
/* the tile's tone — up, down or flat — and how deep (0 to 1 of the scale) */
function hmTone(pct, scale) {
  if (pct === undefined || pct === null || !Number.isFinite(Number(pct))) return { cls: "flat", t: 0 };
  const v = Number(pct);
  if (Math.abs(v) < 0.005) return { cls: "flat", t: 0 };
  return { cls: v > 0 ? "up" : "down", t: Math.min(1, Math.abs(v) / scale) };
}
/* what fits on a tile of w × h: the ticker's size (0: nothing fits), and the change's under it (0: the ticker alone) — a tile tall and
   wide enough carries both, the ticker sized so that both fit */
function hmText(w, h, sym) {
  if (w < 24 || h < 13) return { sym: 0, chg: 0 };
  const both = h >= 28 && w >= 44;
  const fit = Math.min(w / (0.64 * sym.length + 0.9), h * (both ? 0.42 : 0.6));
  if (fit < 8.5) return { sym: 0, chg: 0 };
  const size = Math.max(9, Math.min(30, Math.floor(fit)));
  return { sym: size, chg: both ? Math.max(9, Math.min(14, Math.round(size * 0.68))) : 0 };
}
/* the sector's (industry's) name strip: its name and its cap-weighted change where it has one */
const hmGroupWords = (name, s) => `${esc(name)}${s && s.changePct !== undefined ? ` <span class="hm-grp-c ${s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : ""}">${esc(hmPct(s.changePct))}</span>` : ""}`;
/* what a tile says to a screen reader, and its hover card's words */
function hmLabel(t) {
  const move = t.changePct === undefined ? "not priced by Nasdaq just now" : t.changePct > 0 ? `up ${hmPct(t.changePct).slice(1)}` : t.changePct < 0 ? `down ${hmPct(t.changePct).slice(1)}` : "unchanged";
  return `${t.name}, ${t.symbol}, ${move}${t.price !== undefined ? `, ${usd(t.price)}` : ""}`;
}
function hmPeekHtml(t) {
  const cap = typeof mkValuation === "function" ? mkValuation(t.marketCap) : `$${Math.round(t.marketCap / 1e9)}B`;
  const when = t.quoteAt ? `${nyTime(t.quoteAt)} New York` : "";
  return `<div class="mk-peek-n">${esc(t.name)}</div><div class="mk-peek-k">${esc(t.symbol)} · ${esc(t.sector)}${t.industry ? ` · ${esc(t.industry)}` : ""}</div><div class="mk-peek-w">${t.price !== undefined ? `${usd(t.price)} ${chg(t.changePct)}${t.change !== undefined ? ` <span class="dim">${t.change > 0 ? "+" : t.change < 0 ? "−" : ""}${usd(Math.abs(t.change))} today</span>` : ""}` : "Not priced by Nasdaq just now"}</div><div class="mk-peek-i">Market cap ${esc(cap)} at the last close${t.country ? ` · ${esc(t.country)}` : ""}</div>${t.quoteFrom ? `<div class="mk-peek-f">${esc(t.quoteFrom)}${when ? ` · ${esc(when)}` : ""}</div>` : ""}`;
}

// ---- drawing -----------------------------------------------------------------------------------------

/* one tile, placed inside its group: a button keyed by its ticker, its colour as a custom property the stylesheet mixes (--t), its words
   sized to what fits */
function hmTileHtml(x, scale) {
  const t = x.t;
  const tone = hmTone(t.changePct, scale);
  const fit = hmText(x.w, x.h, t.symbol);
  const sym = fit.sym ? `<span class="hm-sym" style="font-size:${fit.sym}px">${esc(t.symbol)}</span>` : "";
  const c = fit.chg && t.changePct !== undefined ? `<span class="hm-chg" style="font-size:${fit.chg}px">${esc(hmPct(t.changePct))}</span>` : "";
  return `<button type="button" class="hm-tile ${tone.cls}" data-hm-act="open" data-hm-sym="${esc(t.symbol)}" data-k="${esc(t.symbol)}" data-fk="hm:${esc(t.symbol)}" style="left:${x.x.toFixed(1)}px;top:${x.y.toFixed(1)}px;width:${Math.max(0, x.w - HM_GAP).toFixed(1)}px;height:${Math.max(0, x.h - HM_GAP).toFixed(1)}px;--t:${tone.t.toFixed(2)}" aria-label="${esc(hmLabel(t))}">${sym}${c}</button>`;
}
/* one group: its box, its name strip (a button that zooms into a sector; a plain strip inside one), its tiles */
function hmGroupHtml(g, sums, scale, zoomed) {
  const s = sums.get(g.name);
  const words = hmGroupWords(g.name, s);
  const label = `${g.name}${s && s.changePct !== undefined ? `, ${s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : ""} ${hmPct(s.changePct).replace(/^[+−]/, "")}` : ""}, ${plural(g.tiles.length, "share")}`;
  const head = !g.head ? "" : zoomed ? `<div class="hm-grp-h" style="width:${Math.max(0, g.w - HM_GAP).toFixed(1)}px" title="${esc(label)}">${words}</div>` : `<button type="button" class="hm-grp-h" data-hm-act="zoom" data-hm-v="${esc(g.name)}" data-fk="hm-sector:${esc(g.name)}" style="width:${Math.max(0, g.w - HM_GAP).toFixed(1)}px" aria-label="${esc(label)}: zoom in">${words}</button>`;
  return `<div class="hm-grp" data-k="g:${esc(g.name)}" style="left:${g.x.toFixed(1)}px;top:${g.y.toFixed(1)}px;width:${g.w.toFixed(1)}px;height:${g.h.toFixed(1)}px" role="group" aria-label="${esc(g.name)}">${head}${g.tiles.map((x) => hmTileHtml(x, scale)).join("")}</div>`;
}
/* the colour scale under the map: seven swatches from −scale to +scale */
function hmLegendHtml(scale) {
  const steps = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1];
  const sw = steps.map((s) => `<span class="hm-sw ${s > 0 ? "up" : s < 0 ? "down" : "flat"}" style="--t:${Math.abs(s).toFixed(2)}" aria-hidden="true"></span>`).join("");
  return `<div class="hm-legend"><span>−${scale}%</span>${sw}<span>+${scale}%</span><span class="dim">change from the last regular close</span></div>`;
}
/* the line over the map: the US session (the Pulse's own line, from the read's session) and whose figures these are, as of when */
function hmLineHtml(body) {
  const sess = typeof mkSessionLine === "function" && body.session ? mkSessionLine([{ kind: "stock", session: body.session, at: [] }]) : "";
  const q = body.quotes || {};
  const at = q.at ? `${nyTime(q.at)} New York` : "";
  const from = `${esc(q.from || "Nasdaq")}${at ? ` · ${esc(at)}` : ""}${q.priced !== undefined && body.count ? ` · ${q.priced} of ${body.count} priced` : ""}`;
  return `<p class="mk-sess-line hm-line">${sess ? `${sess}<span class="dim"> · </span>` : ""}<span class="dim">${from}</span></p>`;
}
/** THE HEATMAP TAB (ui/markets.js draws it in the pane for tab=heatmap): the session line, the owner's picks, the crumb when zoomed, the
 * map, the legend; a skeleton until the first read, the last good read with a note when a later one failed */
function hmHtml(p, ctx) {
  const o = hmParams(ctx.params);
  if (!HM.got || HM.got.n !== o.n || (!HM.pending && Date.now() - HM.got.at > HM_TTL)) hmFetch(o.n);
  const good = HM.good && HM.good.n === o.n ? HM.good.body : HM.good ? HM.good.body : null;
  const failed = HM.got && HM.got.body && !(HM.got.body.ok !== false && Array.isArray(HM.got.body.tiles)) ? refusalOf(HM.got.body) || "the account did not answer" : "";
  const tools = `<div class="hm-tools">${mkSeg(HM_COUNTS.map((n) => [String(n), `Top ${n}`]), String(o.n), "hm-n", "How many companies")}${mkSeg(HM_SCALES.map((s) => [String(s), `±${s}%`]), String(o.scale), "hm-scale", "Colour scale")}</div>`;
  if (!good) {
    if (failed) return `<section class="hm" aria-label="Heatmap"><div class="hm-bar"><span></span>${tools}</div><div class="mk-fail"><div class="msg no">Couldn't read the market's map: ${esc(mkSaid(failed))}.</div><button type="button" class="btn btn-sm" data-act="retry" data-fk="retry">Try again</button></div></section>`;
    return `<section class="hm" aria-label="Heatmap" aria-busy="true"><div class="hm-bar"><span class="sr" role="status">Reading the market…</span>${tools}</div><div class="hm-map hm-skel" data-hm-map style="height:${hmHeight(HM.width || (ctx.el && ctx.el.clientWidth) || 1000)}px"><span class="skel" style="width:40%"></span></div></section>`;
  }
  const w = HM.width || (ctx.el && ctx.el.clientWidth) || 0;
  const h = hmHeight(w || 1000);
  const tiles = (good.tiles || []).filter((t) => t && t.marketCap > 0);
  const zoomed = o.sector ? tiles.some((t) => String(t.sector).toLowerCase() === o.sector.toLowerCase()) : false;
  const shown = zoomed ? tiles.filter((t) => String(t.sector).toLowerCase() === o.sector.toLowerCase()) : tiles;
  const sectorName = zoomed ? shown[0].sector : "";
  const groupOf = zoomed ? (t) => t.industry : (t) => t.sector;
  const sums = hmSums(shown, groupOf);
  const laid = w > 0 ? hmLayout(shown, groupOf, w, h) : { groups: [] };
  const crumb = zoomed ? `<p class="hm-crumb"><button type="button" class="link" data-hm-act="zoom" data-hm-v="" data-fk="hm-sector:">All sectors</button><span class="dim">›</span><b>${esc(sectorName)}</b>${hmGroupWords("", sums.get("*"))}<span class="dim">· ${plural(shown.length, "share")} of the top ${o.n}, by industry</span></p>` : "";
  const map = `<div class="hm-map" data-hm-map data-hm-n="${o.n}" style="height:${h}px"${w > 0 ? "" : ' aria-busy="true"'}>${laid.groups.map((g) => hmGroupHtml(g, sums, o.scale, zoomed)).join("")}</div>`;
  const stale = failed ? `<p class="mk-missing">Couldn't read the market again just now: ${esc(mkSaid(failed))}. This is what was read at ${esc(nyTime(new Date(HM.good.at).toISOString()))}.</p>` : "";
  return `<section class="hm" aria-label="Heatmap"><div class="hm-bar">${hmLineHtml(good)}${tools}</div>${crumb}${map}${hmLegendHtml(o.scale)}${stale}</section>`;
}
/* each group's cap-weighted change over its priced tiles, and the whole's under "*" */
function hmSums(tiles, groupOf) {
  const by = new Map();
  const add = (name, t) => {
    const s = by.get(name) || { cap: 0, w: 0, pricedCap: 0 };
    s.cap += t.marketCap;
    if (t.changePct !== undefined && t.changePct !== null) {
      s.w += t.marketCap * Number(t.changePct);
      s.pricedCap += t.marketCap;
    }
    by.set(name, s);
  };
  for (const t of tiles) {
    add(groupOf(t) || "Other", t);
    add("*", t);
  }
  const out = new Map();
  for (const [k, s] of by) out.set(k, { marketCap: s.cap, ...(s.pricedCap > 0 ? { changePct: Number((s.w / s.pricedCap).toFixed(2)) } : {}) });
  return out;
}
/* the footer's body for the heatmap tab (ui/markets.js mkFootHtml): the read's notes and what Nasdaq would not answer */
function hmFootBody() {
  const b = HM.good && HM.good.body;
  return b ? { notes: b.notes, missing: b.missing ? [b.missing] : [] } : null;
}

// ---- the pane: its listeners, its width, its poll ---------------------------------------------------------

/** after the pane is painted with the heatmap tab (ui/markets.js renderMarkets): the pane's listeners once, the map's width watched (laid
 * out again when it changes), the poll started */
function hmMount(root) {
  if (!root) return;
  if (HM.el !== root) {
    root.addEventListener("click", hmClick);
    root.addEventListener("pointerover", hmOver);
    root.addEventListener("pointerout", hmOut);
    root.addEventListener("focusin", hmFocus);
    root.addEventListener("focusout", hmOut);
    HM.el = root;
  }
  const map = typeof root.querySelector === "function" ? root.querySelector("[data-hm-map]") : null;
  if (map) {
    const w = map.clientWidth || 0;
    if (w && Math.abs(w - HM.width) > 1) {
      HM.width = w;
      hmRedrawSoon();
    }
    if (typeof ResizeObserver === "function" && HM.roEl !== map) {
      if (HM.ro) HM.ro.disconnect();
      HM.ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1];
        const nw = e && e.contentRect ? Math.round(e.contentRect.width) : map.clientWidth;
        if (nw && Math.abs(nw - HM.width) > 1) {
          HM.width = nw;
          hmRedrawSoon();
        }
      });
      HM.ro.observe(map);
      HM.roEl = map;
    }
  }
  hmStart();
}
/* laid out again in the next frame, once, however many changes asked for it */
function hmRedrawSoon() {
  if (HM.redrawSoon) return;
  HM.redrawSoon = true;
  nextFrame(() => {
    HM.redrawSoon = false;
    if (hmShown() && typeof mkRedrawShown === "function") mkRedrawShown();
  });
}
/* the map's own buttons: a tile opens its market, a sector's name zooms in, "All sectors" out, the picks go into the address */
function hmClick(e) {
  const t = e.target;
  const b = t && t.closest && t.closest("[data-hm-act]");
  if (!b || b.disabled) return;
  hmPeekHide();
  switch (b.dataset.hmAct) {
    case "open": return void (typeof openMarket === "function" && openMarket(`stock:${b.dataset.hmSym}`));
    case "zoom": return void go("markets", { ...ROUTE.params, sector: b.dataset.hmV || "" });
    default: return;
  }
}
/** the owner's picks (ui/markets.js mkPaneClick hands this the seg buttons it does not know): the count and the colour scale, kept in the
 * address; true when it was one of the map's */
function hmAct(b) {
  const act = b && b.dataset && b.dataset.act;
  if (act === "hm-n") return void go("markets", { ...ROUTE.params, n: b.dataset.v === String(HM_DEFAULT_N) ? "" : b.dataset.v }, { replace: true }), true;
  if (act === "hm-scale") return void go("markets", { ...ROUTE.params, scale: b.dataset.v === String(HM_DEFAULT_SCALE) ? "" : b.dataset.v }, { replace: true }), true;
  return false;
}
/* the poll: the read again every half minute while the tab shows and the page is in view */
function hmStart() {
  if (HM.timer) return;
  HM.timer = setInterval(hmTick, HM_POLL_MS);
}
function hmStop() {
  if (HM.timer) clearInterval(HM.timer);
  HM.timer = 0;
  hmPeekHide();
}
function hmTick() {
  if (document.hidden || !hmShown()) return;
  hmFetch(hmParams(ROUTE.params).n);
}
onRoute((tab, params) => {
  if (tab === "markets" && typeof mkParams === "function" && mkParams(params).tab === "heatmap") hmStart();
  else hmStop();
});
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hmShown() && HM.got && Date.now() - HM.got.at > HM_TTL) hmFetch(hmParams(ROUTE.params).n);
  });
}

// ---- the hover card ------------------------------------------------------------------------------------

/* one card for the map (#hm-peek, the Markets pane's card look), beside the tile a pointer rests on or a key reached, under it or above it
   where the window ends first; it takes no click and goes when the pointer leaves, the page scrolls or Escape is pressed */
const HM_PEEK_MS = 250;
function hmPeekEl() {
  if (HM.peek && HM.peek.isConnected) return HM.peek;
  const el = document.createElement("div");
  el.id = "hm-peek";
  el.className = "mk-peek hm-peek";
  el.setAttribute("aria-hidden", "true");
  el.hidden = true;
  document.body.appendChild(el);
  if (!HM.peekWired) {
    HM.peekWired = true;
    addEventListener("scroll", hmPeekHide, { capture: true, passive: true });
    addEventListener("keydown", (e) => e.key === "Escape" && hmPeekHide());
  }
  return (HM.peek = el);
}
const hmTileOf = (t) => (t && t.closest ? t.closest("[data-hm-sym]") : null);
const hmTileData = (btn) => {
  const b = HM.good && HM.good.body;
  const sym = btn && btn.dataset ? btn.dataset.hmSym : "";
  return b && sym ? (b.tiles || []).find((t) => t && t.symbol === sym) || null : null;
};
function hmOver(e) {
  if (e.pointerType === "touch") return;
  const a = hmTileOf(e.target);
  if (a) hmPeekAim(a, false);
}
function hmFocus(e) {
  const a = hmTileOf(e.target);
  if (a && a === e.target && a.matches && a.matches(":focus-visible")) hmPeekAim(a, true);
}
function hmPeekAim(a, now) {
  clearTimeout(HM.peekHide);
  if (HM.peekAt === a && HM.peek && !HM.peek.hidden) return;
  clearTimeout(HM.peekShow);
  HM.peekShow = setTimeout(() => hmPeekShow(a), now || (HM.peek && !HM.peek.hidden) ? 0 : HM_PEEK_MS);
}
function hmOut(e) {
  const a = hmTileOf(e.target);
  if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
  clearTimeout(HM.peekShow);
  clearTimeout(HM.peekHide);
  HM.peekHide = setTimeout(hmPeekHide, 80);
}
function hmPeekShow(a) {
  const t = a && a.isConnected ? hmTileData(a) : null;
  if (!t) return void hmPeekHide();
  const el = hmPeekEl();
  el.innerHTML = hmPeekHtml(t);
  HM.peekAt = a;
  el.hidden = false;
  const box = a.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const below = box.bottom + 6 + h <= vh - 8 || box.top - 6 - h < 8;
  el.style.left = `${Math.round(Math.max(8, Math.min(box.left, vw - w - 8)))}px`;
  el.style.top = `${Math.round(below ? box.bottom + 6 : box.top - 6 - h)}px`;
}
function hmPeekHide() {
  clearTimeout(HM.peekShow);
  clearTimeout(HM.peekHide);
  HM.peekAt = null;
  const el = HM.peek;
  if (!el || el.hidden) return;
  el.hidden = true;
  el.innerHTML = "";
}
