/* SPEND TOKENS on the page (account/tokens.ts): one authorisation the owner signs for one agent, on one rail, for one counterparty, with
   its own lines and its own end. Drawn under each agent in the Agents sheet (agents-mount.js) and under each account on Venues
   (portfolio.js), issued from a quoteDialog (the account prepares the exact fields, the owner signs them), stopped free (one, or all from
   the top bar: tightening only) and revoked signed. A token ask (an agent's portfolio_ask kind token) is granted from Waiting for you: the
   form opens with the agent's counterparty shown as proposed, never pre-filled. The Paper lens shows test tokens only, Real live ones. */

const TOKEN_STATUS_WORDS = { issuing: "Issuing", verify: "Waiting for you at the rail", active: "Active", used: "Used up", expired: "Expired", stopped: "Stopped", revoking: "Revoking", revoked: "Revoked" };
/* a token's standing as a chip: the one accent is active; stopped and revoking wait; the rest are over */
const tokenChip = (t) => {
  const s = t.lapsed && (t.status === "active" || t.status === "stopped") ? "expired" : t.status;
  const cls = s === "active" ? "up" : s === "stopped" || s === "revoking" ? "warn" : "";
  return `<span class="tag${cls ? ` ${cls}` : ""}">${esc(s === "expired" && t.lapsed ? "Ended" : TOKEN_STATUS_WORDS[s] || s)}</span>`;
};
/* a token can still be used, or stopped: it stands */
const tokenStands = (t) => (t.status === "active" || t.status === "issuing" || t.status === "verify") && !t.lapsed;
/* a token is over: used up, past its time, revoked. A stopped or revoking one is neither standing nor over: it waits for a revocation */
const tokenOver = (t) => t.status === "used" || t.status === "expired" || t.status === "revoked" || t.lapsed;
/* the tokens the lens shows: Paper the test ones, Real the live ones, a venue its instrument's, an agent its own */
function tokensIn(l = lensNow()) {
  const all = (A && A.tokens) || [];
  if (l.kind === "paper") return all.filter((t) => t.env === "test");
  if (l.kind === "real") return all.filter((t) => t.env === "live");
  if (l.kind === "venue") return all.filter((t) => t.instrument === l.id || (t.railKind === "chain:x402" && `agent-${slug(t.instrument)}` === l.id));
  if (l.kind === "agent") return all.filter((t) => String(t.agent).toLowerCase() === l.id.toLowerCase());
  return all;
}
/* where a token is for, in words: its counterparty at its instrument */
const tokenWhere = (t) => (t.railKind === "chain:x402" ? `pays ${t.counterparty} from ${t.instrumentName}` : `trades ${t.counterparty === "*" ? "any market" : t.counterparty} at ${t.instrumentName}`);

/** one token, as a line: its id and standing, where it is for, its lines and what is left, who holds those lines, and what the owner can do */
function tokenHtml(t, owner, { who = true } = {}) {
  const uses = t.uses === 0 ? `${t.usesMade} ${t.usesMade === 1 ? "use" : "uses"} made` : `${t.usesMade} of ${t.uses} ${t.uses === 1 ? "use" : "uses"}`;
  const waits = t.usesOpen ? ` · ${plural(t.usesOpen, "use")} waiting on a card` : "";
  const ends = t.status === "revoked" || t.status === "expired" || t.status === "used" || t.lapsed ? "" : ` · until ${nyDay(t.validUntil)}`;
  const honest = `<span class="tok-h${t.env === "live" ? " warn" : ""}">${esc(t.env === "test" ? t.testLabel || "Test · no network holds this limit; only the Account does" : `Live · ${t.honesty.text.charAt(0).toLowerCase()}${t.honesty.text.slice(1)}`)}</span>`;
  const acts = owner ? `${tokenStands(t) ? `<button type="button" class="link dim" data-tok-act="stop" data-token="${esc(t.id)}">Stop</button> · ` : ""}${t.status === "revoked" || t.status === "expired" || t.status === "used" ? "" : `<button type="button" class="link dim" data-tok-act="revoke" data-token="${esc(t.id)}">Revoke…</button>`}` : "";
  return `<div class="tok" data-k="${esc(t.id)}"><div class="tok-t"><span class="mono">${esc(t.id)}</span> ${tokenChip(t)}${t.paper ? ' <span class="tag paper">Paper</span>' : ""}${who ? ` <span class="dim small">${esc(t.agentName)}</span>` : ""}${t.atOnce ? ' <span class="dim small">· at once, no card</span>' : ""}</div><div class="tok-l small">${esc(tokenWhere(t))} · ${esc(fine(t.mintedUsd))} of ${esc(fine(t.maxUsd))} used${t.reservedUsd ? ` (${esc(fine(t.reservedUsd))} held)` : ""} · up to ${esc(fine(t.perUseUsd))} a use · ${esc(uses)}${esc(waits)}${esc(ends)}${t.reason && !tokenStands(t) ? ` · ${esc(t.reason)}` : ""}</div><div class="tok-l small"><i>“${esc(t.purpose)}”</i> ${honest}</div>${acts ? `<div class="tok-acts small">${acts}</div>` : ""}</div>`;
}

/** a block of tokens: a list, and the way to issue one (for an agent, or at an instrument) */
function tokensBlock(list, owner, { issueFor = {}, who = true, empty = "No spend token." } = {}) {
  const standing = list.filter((t) => !tokenOver(t));
  const over = list.filter(tokenOver);
  const issue = owner && A.connectLive && A.keys.some((k) => k.status === "ok") ? `<button type="button" class="link" data-tok-act="issue" data-agent="${esc(issueFor.agent || "")}" data-instrument="${esc(issueFor.instrument || "")}">Issue a spend token…</button>` : "";
  return `<div class="tok-list">${standing.map((t) => tokenHtml(t, owner, { who })).join("")}${over.length ? `<details class="tok-over"><summary class="dim small">${esc(plural(over.length, "ended token"))}</summary>${over.map((t) => tokenHtml(t, owner, { who })).join("")}</details>` : ""}${!list.length ? `<span class="dim small">${esc(empty)}</span>` : ""}${issue ? `<div class="tok-acts small">${issue}</div>` : ""}</div>`;
}

/** a token button pressed, wherever it is drawn: Stop (free), Revoke… (signed, asked first), Issue… (the form) */
function tokenAct(b) {
  const act = b.dataset.tokAct;
  if (act === "stop") return void stopToken(b.dataset.token);
  if (act === "revoke") return void revokeToken(b.dataset.token);
  if (act === "issue") return void openIssueToken({ agent: b.dataset.agent || "", instrument: b.dataset.instrument || "" });
}
/** the token buttons of a part drawn whole (the Agents sheet): each heard once it is drawn */
function wireTokens(root) {
  for (const b of root.querySelectorAll("button[data-tok-act]")) b.addEventListener("click", () => tokenAct(b));
}

/** the free stop: one token, or every one ("*"). Tightening only, so no signature; said done only when the account took it */
async function stopToken(id) {
  if (!A || !owns()) return;
  if (id === "*" && !(await confirmSheet("Stop every spend token? Every use is refused from then on. A stopped token is not revoked: revoke it, or let it run out.", { title: "Stop all tokens", yes: "Stop them all", no: "Keep them", danger: true }))) return;
  const r = await postJson("/api/account/tokens/stop", { token: id });
  if (refusedAt(r)) flash = Owner.why(r) || "Refused";
  else {
    const n = (r.body && r.body.stopped && r.body.stopped.length) || 0;
    said = id === "*" ? (n ? `Stopped ${plural(n, "spend token")}: every use is refused from now on.` : "No spend token was standing.") : n ? `${id} stopped: every use is refused from now on. Revoke it to end it.` : `${id} was not standing.`;
  }
  await load();
}
/** a revocation: signed, and asked first — it ends the token for good */
async function revokeToken(id) {
  if (!A || !owns()) return;
  const t = (A.tokens || []).find((x) => x.id === id);
  if (!t) return;
  if (await confirmSheet(`Revoke ${id} (${tokenWhere(t)})? It ends for good: nothing goes on it from then on, and ${t.agentName} would need a new one.`, { title: "Revoke a spend token", yes: "Revoke", no: "Keep it", danger: true })) own({ type: "revokeSpendToken", token: id, reason: "" });
}

/* the places a token can be for, as the form offers them: the paper accounts (a test token), the live venues that trade (a live token), the
   agent wallets (a live x402 token); each with the rail and the environment that go with it */
function tokenPlaces(agent) {
  const L = connected();
  const paper = L.filter((v) => v.paper && v.trade && v.trade.can !== false).map((v) => ({ value: `paper:${v.id}`, label: `${v.name} · paper`, rail: "paper", instrument: v.id, env: "test", currency: "USD" }));
  const live = L.filter((v) => !v.paper && canTrade(v)).map((v) => ({ value: `venue:${v.id}`, label: v.name, rail: `venue:${v.id}`, instrument: v.id, env: "live", currency: "USD" }));
  const wallets = (A.subAccounts || []).filter((s) => !agent || String(s.agent).toLowerCase() === String(agent).toLowerCase()).map((s) => ({ value: `x402:${s.name}`, label: `Agent wallet · ${s.name} (pay over x402)`, rail: "chain:x402", instrument: s.name, env: "live", currency: "USDC" }));
  return [...paper, ...live, ...wallets];
}

/** The issue form: prepare → show → sign, as every owner action. The counterparty an agent proposed (a token ask) is shown beside the
 * field, never in it: the owner types or takes it. `remember` (only from an ask) keeps the purpose in the agent's memory, as the owner's
 * words, on the owner's tick alone */
function openIssueToken({ agent = "", instrument = "", counterparty = "", usd = "", purpose = "", ask = null } = {}) {
  const keys = A.keys.filter((k) => k.status === "ok");
  if (!keys.length) return void toast("Let an agent in first: a token is issued to an agent.", "no");
  if (!writesOn()) return void toast("This server was started read-only: nothing is placed or paid, so no token is issued.", "no");
  const who = keys.find((k) => k.address === String(agent).toLowerCase()) || keys[0];
  const places = tokenPlaces(who.address);
  if (!places.length) return void toast("Nothing here takes a token: connect an account that trades, or a paper account.", "no");
  const start = places.find((p) => p.instrument === instrument) || places[0];
  const cap = (A.connectLive && A.connectLive.writes && A.connectLive.writes.capUsd) || 0;
  const max = Number(usd) > 0 ? Number(usd) : 50;
  const per = Math.min(cap || max, max);
  const proposed = ask && ask.counterparty ? `<p class="dim small tok-proposed">${esc(ask.agentName)} proposed <span class="mono">${esc(ask.counterparty)}</span> <button type="button" class="link" data-tok-take>Use it</button> — nothing is ticked for you.</p>` : "";
  const q = quoteDialog({
    title: "Issue a spend token",
    sub: ask ? `${esc(ask.agentName)} asked for a token: “${esc(ask.text || "")}”${ask.usd ? ` · ${esc(money(Number(ask.usd)))}` : ""}. One authorisation of its own: a counterparty, an amount, a most-per-use, a count, an end. It reads none of the agent's limits.` : "One authorisation of its own for one agent: where, for what counterparty, how much in all and a use, how many uses, until when. It reads none of the agent's limits, and the agent holds only its id.",
    fields: `<div class="row2">${field("Agent", select("agent", keys.map((k) => [k.address, k.name]), who.address))}${field("Where", select("place", places.map((p) => [p.value, p.label]), start.value))}</div>${field('<span data-tok-cp-label>Markets (comma-separated symbols, or * for any at a paper account)</span>', `<input name="counterparty" autocomplete="off" spellcheck="false" placeholder="BTC-PERP, ETH-PERP" value="${esc(counterparty)}" />`)}${proposed}<div class="row2">${field("In all ($)", `<input name="max" inputmode="decimal" autocomplete="off" value="${esc(String(max))}" />`)}${field("A use up to ($)", `<input name="per" inputmode="decimal" autocomplete="off" value="${esc(String(per))}" />`)}</div><div class="row2">${field("Uses", `<input name="uses" inputmode="numeric" autocomplete="off" value="1" />`)}${field("For", select("days", [["1", "1 day"], ["7", "7 days"], ["30", "30 days"]], "7"))}</div>${field("Purpose", `<input name="purpose" maxlength="200" autocomplete="off" placeholder="What it is for, in your words" value="${esc(purpose)}" />`)}<label class="chk1"><input type="checkbox" name="atOnce" /> At once in Guard: a use goes without a card</label>${ask ? '<label class="chk1"><input type="checkbox" name="remember" /> Remember this purpose in the agent\'s memory, as your words</label>' : ""}<p class="dim small">Uses: 1 to 20; 0 is as many as the amount allows (a venue or paper token). Each use is still held to the server's cap${cap ? ` (${esc(money(cap))})` : ""} and to your mode.</p>`,
    go: "Sign the token",
    draft(form) {
      const f = new FormData(form);
      const place = places.find((p) => p.value === String(f.get("place")));
      if (!place) return "Pick where the token is for.";
      const cp = String(f.get("counterparty") || "").trim();
      const m = String(f.get("max") || "").trim();
      const p = String(f.get("per") || "").trim();
      const u = String(f.get("uses") || "").trim();
      const text = String(f.get("purpose") || "").trim();
      if (!cp) return place.rail === "chain:x402" ? "Type the payee's https origin." : "Type the markets it may trade, or * for any at a paper account.";
      if (!(Number(m) > 0) || !(Number(p) > 0)) return "Type how much in all, and how much a use may be.";
      if (Number(p) > Number(m)) return "A use can't be more than the whole.";
      if (!/^\d{1,2}$/.test(u) || Number(u) > 20) return "Uses: a whole number, 0 to 20.";
      if (!text) return "Say what it is for.";
      return { type: "issueSpendToken", agent: String(f.get("agent")), rail: place.rail, instrument: place.instrument, counterparty: cp, maxAmount: m, currency: place.currency, perUseMax: p, uses: Number(u), validUntil: nowMs() + Number(f.get("days")) * DAY, atOnce: f.get("atOnce") ? "true" : "", purpose: text, env: place.env };
    },
    show(p) {
      const a = p.action;
      const t = (p.quote && p.quote.token) || {};
      return `<div class="big"><span>${esc((p.quote && p.quote.words) || "a spend token")}</span></div><div class="path">Up to <b>${esc(money(Number(a.perUseMax)))}</b> a use, <b>${esc(money(Number(a.maxAmount)))}</b> ${esc(a.currency)} in all, ${a.uses === 0 ? "as many uses as that allows" : esc(plural(a.uses, "use"))}, until ${esc(nyDay(a.validUntil))}${a.atOnce === "true" ? " · a use goes without a card in Guard" : ""}.</div><div class="path tok-h${a.env === "live" ? " warn" : ""}">${esc(t.honesty || "")}${t.capUsd ? ` · no single use goes over ${esc(money(Number(t.capUsd)))} on this server` : ""}</div>`;
    },
    async done(r, p) {
      const form = q.form;
      const remember = form && form.elements.remember && form.elements.remember.checked;
      if (remember) await own({ type: "setMemory", scope: p.action.agent, id: "", topic: "rules", text: p.action.purpose }, () => forget("/api/account/memory"));
      const id = r.body && r.body.result && r.body.result.token && r.body.result.token.id;
      return `${id ? `${id} issued` : "Token issued"} for ${keyName(p.action.agent)}.`;
    },
  });
  // the field's own words follow the place: markets at a venue, an origin on x402; the proposed counterparty is taken on a click
  const form = q.form;
  const relabel = () => {
    const place = places.find((p) => p.value === form.elements.place.value) || start;
    const label = form.querySelector("[data-tok-cp-label]");
    if (label) label.textContent = place.rail === "chain:x402" ? "Payee (its https origin)" : "Markets (comma-separated symbols, or * for any at a paper account)";
    form.elements.counterparty.placeholder = place.rail === "chain:x402" ? "https://api.example.com" : "BTC-PERP, ETH-PERP";
  };
  form.elements.place.addEventListener("change", relabel);
  relabel();
  const take = form.querySelector("[data-tok-take]");
  if (take) take.addEventListener("click", () => { form.elements.counterparty.value = ask.counterparty; form.dispatchEvent(new Event("input")); });
  return q;
}

/** a token ask granted from Waiting for you: the form, with what the agent asked shown — the venue it named is the place, its counterparty
 * proposed, its dollars the amount, its words the purpose */
function openIssueFromAsk(a) {
  if (!a) return;
  const venue = a.venue && connected().find((v) => v.id === a.venue);
  openIssueToken({ agent: a.agent, instrument: venue ? venue.id : "", usd: a.usd || "", purpose: a.text || "", ask: a });
}
