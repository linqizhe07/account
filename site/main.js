// Gravit — the page's own behaviour: dotted art, the two marquees, live quotes read by this browser from public APIs, recent merged
// pull requests from GitHub, the FAQ, the lightbox and the vision band's fade. No third-party script; what fails is simply not shown.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SVG = "http://www.w3.org/2000/svg";

/* ---------- dotted art (deterministic: the same picture every visit) ---------- */
const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const dot = (svg, x, y, r, o) => {
  const c = document.createElementNS(SVG, "circle");
  c.setAttribute("cx", x.toFixed(1));
  c.setAttribute("cy", y.toFixed(1));
  c.setAttribute("r", r.toFixed(2));
  c.setAttribute("fill", "#97fce3");
  c.setAttribute("fill-opacity", o.toFixed(2));
  svg.appendChild(c);
};
/** two bands of dots crossing the width, dense in the middle, like a current */
function wave(svg) {
  const rand = rng(7);
  for (let i = 0; i < 900; i++) {
    const x = rand() * 1440;
    const band = i % 2;
    const centre = 240 + (band ? 95 : -70) * Math.sin(x / 190 + band * 1.3) + (band ? -30 : 50);
    const spread = 46 + 70 * Math.abs(Math.sin(x / 260 + band));
    const y = centre + (rand() + rand() - 1) * spread;
    const near = 1 - Math.min(1, Math.abs(y - centre) / spread);
    dot(svg, x, y, 1.2 + rand() * 2.4 * near, 0.18 + near * 0.72 * (0.5 + rand() * 0.5));
  }
}
/** a square of dots whose size follows a soft radial field: the "builder codes" matrix */
function grid(svg) {
  const rand = rng(3);
  const n = 22;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = 20 + (i * 360) / (n - 1);
    const y = 20 + (j * 360) / (n - 1);
    const d = Math.hypot(x - 230, y - 170) / 230;
    const s = Math.max(0.6, 4.2 * Math.exp(-d * d * 1.6) + rand() * 0.8);
    dot(svg, x, y, s, 0.25 + Math.min(0.75, 1 - d) * 0.75);
  }
  svg.querySelectorAll("circle").forEach((c) => c.setAttribute("fill", "#03211c"));
}
/** the mark, as dots along its own path */
function glyph(svg) {
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M43 20v23c0 8-5 12-13 12M43 25a12 12 0 1 0 0 12");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
  const len = path.getTotalLength();
  const rand = rng(11);
  for (let i = 0; i < 70; i++) {
    const p = path.getPointAtLength((i / 70) * len);
    dot(svg, p.x + (rand() - 0.5) * 1.2, p.y + (rand() - 0.5) * 1.2, 1.1 + rand() * 0.9, 0.55 + rand() * 0.45);
  }
  path.remove();
}
for (const svg of $$("[data-art]")) ({ wave, grid, glyph })[svg.dataset.art]?.(svg);

/* ---------- marquees: content twice, one transform, speed from the measured width ---------- */
function marquee(el) {
  const track = $(".marquee-track", el);
  const size = () => {
    const half = track.scrollWidth / 2;
    track.style.setProperty("--dur", `${Math.max(20, half / 60)}s`);
  };
  const dup = () => {
    $$(".dup", track).forEach((n) => n.remove());
    for (const li of [...track.children]) {
      const c = li.cloneNode(true);
      c.classList.add("dup");
      c.setAttribute("aria-hidden", "true");
      track.appendChild(c);
    }
    size();
  };
  dup();
  if (!reduced) new ResizeObserver(size).observe(el);
  return { dup };
}
const marquees = new Map($$("[data-marquee]").map((el) => [el, marquee(el)]));

/* ---------- live quotes: each source on its own; a source that fails is not shown ---------- */
const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const pct = (last, open) => {
  const a = Number(last), b = Number(open);
  if (!(a > 0 && b > 0)) return null;
  return ((a - b) / b) * 100;
};
const get = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};
const SOURCES = [
  {
    venue: "Hyperliquid", every: 45,
    async read() {
      const mids = await get("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "allMids" }) });
      return ["BTC", "ETH", "SOL", "HYPE"].map((sym) => ({ sym, px: money(mids[sym]) })).filter((q) => q.px);
    },
  },
  {
    venue: "Kraken", every: 45,
    async read() {
      const r = await get("https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD");
      const pick = (key, sym) => {
        const t = r.result?.[key];
        return t ? { sym, px: money(t.c?.[0]), chg: pct(t.c?.[0], t.o) } : null;
      };
      return [pick("XXBTZUSD", "BTC"), pick("XETHZUSD", "ETH")].filter((q) => q && q.px);
    },
  },
  {
    venue: "Coinbase", every: 45,
    async read() {
      const out = [];
      for (const sym of ["BTC", "ETH"]) {
        const r = await get(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`);
        const px = money(r.data?.amount);
        if (px) out.push({ sym, px });
      }
      return out;
    },
  },
  {
    venue: "OKX", every: 45,
    async read() {
      const r = await get("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT");
      const t = r.data?.[0];
      return t ? [{ sym: "BTC", px: money(t.last), chg: pct(t.last, t.open24h) }].filter((q) => q.px) : [];
    },
  },
  {
    venue: "Polymarket", every: 120,
    async read() {
      const events = await get("https://gamma-api.polymarket.com/events?active=true&closed=false&archived=false&order=volume24hr&ascending=false&limit=2&exclude_tag_id=1");
      // an event is one question or a group of them (one market per candidate): the market shown is the one the crowd prices highest
      const yesOf = (m) => { try { return Number(JSON.parse(m?.outcomePrices ?? "[]")[0]); } catch { return NaN; } };
      return events.flatMap((e) => {
        const m = [...(e.markets ?? [])].filter((x) => Number.isFinite(yesOf(x))).sort((a, b) => yesOf(b) - yesOf(a))[0];
        const title = String(e.title ?? "").trim();
        if (!m || !title) return [];
        const who = (e.markets ?? []).length > 1 ? String(m.groupItemTitle ?? "").trim() : "";
        const label = who ? `${title} · ${who}` : title;
        return [{ sym: label.length > 52 ? label.slice(0, 51) + "…" : label, px: `${Math.round(yesOf(m) * 100)}¢ yes` }];
      });
    },
  },
];
const ticker = $("[data-ticker]");
const tickerTrack = $("[data-ticker-track]");
const quotes = new Map();
let lastRender = 0;
function renderTicker() {
  const items = [...quotes.values()].flat();
  if (items.length === 0) {
    ticker.hidden = true;
    return;
  }
  const seen = new Set();
  for (const q of items) {
    const key = `${q.venue}:${q.sym}`;
    seen.add(key);
    let li = $(`[data-key="${CSS.escape(key)}"]`, tickerTrack);
    if (!li) {
      li = document.createElement("li");
      li.className = "tick";
      li.dataset.key = key;
      li.innerHTML = `<span class="venue"></span><span class="sym"></span><span class="px"></span><span class="chg"></span>`;
      $(".venue", li).textContent = q.venue;
      $(".sym", li).textContent = q.sym;
      tickerTrack.appendChild(li);
    }
    $(".px", li).textContent = q.px;
    const chg = $(".chg", li);
    if (typeof q.chg === "number") {
      chg.textContent = `${q.chg >= 0 ? "+" : ""}${q.chg.toFixed(2)}%`;
      chg.className = `chg ${q.chg >= 0 ? "up" : "down"}`;
    } else chg.textContent = "";
    li.title = `${q.venue} · ${new Date().toLocaleTimeString()}`;
  }
  for (const li of $$("li:not(.dup)", tickerTrack)) if (!seen.has(li.dataset.key)) li.remove();
  // the duplicate half mirrors the first; rebuilt only when the set of items changed, so the animation does not restart on a price
  const dups = $$(".dup", tickerTrack);
  const firsts = $$("li:not(.dup)", tickerTrack);
  if (dups.length !== firsts.length || dups.some((d, i) => d.dataset.key !== firsts[i].dataset.key)) marquees.get(ticker.querySelector("[data-marquee]")).dup();
  else firsts.forEach((li, i) => { $(".px", dups[i]).textContent = $(".px", li).textContent; $(".chg", dups[i]).textContent = $(".chg", li).textContent; $(".chg", dups[i]).className = $(".chg", li).className; });
  const wasHidden = ticker.hidden;
  ticker.hidden = false;
  if (wasHidden) marquees.get(ticker.querySelector("[data-marquee]")).dup();
  lastRender = Date.now();
  $("[data-asof]").textContent = `as of ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
async function poll(src) {
  try {
    const got = await src.read();
    if (got.length) quotes.set(src.venue, got.map((q) => ({ ...q, venue: src.venue })));
    else quotes.delete(src.venue);
  } catch {
    quotes.delete(src.venue);
  }
  renderTicker();
}
const timers = [];
function startQuotes() {
  for (const src of SOURCES) {
    poll(src);
    timers.push(setInterval(() => !document.hidden && poll(src), src.every * 1000));
  }
}
if (ticker) startQuotes();
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastRender > 60_000) SOURCES.forEach(poll); });

/* ---------- progress: the merged pull requests, from GitHub; the committed copy first, the live list when GitHub answers ---------- */
const prs = $("[data-progress]");
const prNote = $("[data-progress-note]");
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
function renderPrs(list, note) {
  prs.replaceChildren(...list.slice(0, 5).map((p) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "pr";
    a.href = p.url;
    a.innerHTML = `<span class="n"></span><span class="d"></span><span class="t"></span><span class="arr">↗</span>`;
    $(".n", a).textContent = `#${p.number}`;
    $(".d", a).textContent = day(p.mergedAt);
    $(".t", a).textContent = p.title;
    li.appendChild(a);
    return li;
  }));
  prNote.textContent = note;
}
(async () => {
  if (!prs) return;
  try {
    const baked = await get("./data/progress.json");
    renderPrs(baked.merged, `As of ${baked.asOf}, from GitHub.`);
  } catch { /* nothing baked: the live list, or the link below */ }
  try {
    const key = "gravit.prs";
    const cached = JSON.parse(sessionStorage.getItem(key) || "null");
    let live = cached && Date.now() - cached.at < 600_000 ? cached.list : null;
    if (!live) {
      const r = await get("https://api.github.com/repos/linqizhe07/buyer-agent-demo/pulls?state=closed&sort=updated&direction=desc&per_page=10");
      live = r.filter((p) => p.merged_at).map((p) => ({ number: p.number, title: p.title, mergedAt: p.merged_at, url: p.html_url }));
      try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), list: live })); } catch { /* private window */ }
    }
    if (live.length) renderPrs(live, "Live from GitHub.");
  } catch { /* GitHub did not answer: the baked list stays */ }
})();

/* ---------- fade-in, lightbox ---------- */
if (!reduced && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.3 });
  $$(".fade").forEach((el) => io.observe(el));
} else $$(".fade").forEach((el) => el.classList.add("in"));
const zoom = $("#zoom");
for (const img of $$("[data-zoom]")) img.addEventListener("click", () => {
  const big = img.currentSrc?.includes("@2x") ? img.currentSrc : img.srcset?.split(",").map((s) => s.trim().split(" ")[0]).pop() || img.src;
  $("img", zoom).src = big;
  $("img", zoom).alt = img.alt;
  zoom.showModal();
});
$("[data-close]", zoom).addEventListener("click", () => zoom.close());
zoom.addEventListener("click", (e) => { if (e.target === zoom) zoom.close(); });
