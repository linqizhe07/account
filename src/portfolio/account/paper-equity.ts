/** The PAPER ACCOUNTS' CURVE: what the paper accounts were worth over the last day, week or month, or since they started — the page's
 * Paper book and an agent's `portfolio_history` with `paper`.
 *
 * Paper money is never on the net worth curve (account/networth.ts): it is not money. It has a curve of its own, told account by account
 * and then added up:
 *
 *   a paper account the account keeps itself (live:paper)   its BOOK is the account's own record, so its past is known, not guessed: every
 *                       fill is in it, and the prices between fills are the public sources' bars (live/paper-history.ts tells it again,
 *                       from the day it started with its paper money). Where the service also wrote a point for it (the paper log beside
 *                       the net worth log, every five minutes while it runs), the point it wrote wins: it is what the book said then,
 *                       funding and all. The told-again past fills what the service did not see — before the paper log existed, or while
 *                       the service was not running
 *   a venue's own paper account (Alpaca's paper, Hyperliquid's testnet)   no book here: its curve is the points the service wrote, from its
 *                       first one on, as the real curve is
 *
 * The CHANGE is each account's own, from where it stood at the range's start — or, an account started inside the range, from the paper
 * money it started with — to now, added up. Starting a paper account is not a gain: its curve starts at its starting money, and its change
 * is what it made or lost since. The last point of every account is its value now (the same read as the figure), so the curve ends where
 * the figure stands.
 */
import { no } from "../refuse.ts";
import type { Refusal } from "../../core/errors.ts";
import { bucketFor, NETWORTH_RANGES, type NetWorthBucket, type NetWorthEvent, type NetWorthHistory, type NetWorthRange } from "./networth.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SPAN_MS: Readonly<Record<Exclude<NetWorthRange, "all">, number>> = { "1d": DAY, "1w": 7 * DAY, "1m": 30 * DAY };
export const BUCKET_MS: Readonly<Record<NetWorthBucket, number>> = { "5m": 5 * MINUTE, "1h": HOUR, "1d": DAY };
/** a written point stands for the time after it this long: past it, with no newer point, the told-again past speaks */
const STANDS_MS = 20 * MINUTE;

export interface PaperPoint {
  at: number;
  usd: number;
  /** a price in it was not known at that instant (the last price the market traded at was used), or a venue's number was its last good one */
  partial?: true | undefined;
}

/** one paper account's series, as the service gathers it */
export interface PaperVenueSeries {
  venue: string;
  name: string;
  /** what it started with, and when: a paper account the account keeps itself says both (its book); a venue's own paper account neither */
  startUsd?: number | undefined;
  createdAt?: number | undefined;
  /** its past told again from its book (live/paper-history.ts), oldest first */
  rebuilt?: PaperPoint[] | undefined;
  /** the points the service wrote for it (the paper log), oldest first */
  recorded?: PaperPoint[] | undefined;
  /** what it is worth now: the figure's own read */
  nowUsd: number;
  /** what the told-again past cannot know, in words, and the markets it had no price for at some point */
  inexact?: string[] | undefined;
  missing?: string[] | undefined;
}

export interface PaperHistory extends NetWorthHistory {
  paper: true;
  /** the one paper account the curve is of, when asked for one */
  venue?: string | undefined;
  /** what the paper accounts in it started with, together, where every one of them says (a venue's own paper account does not) */
  startUsd?: number | undefined;
  /** what they made or lost since they started, together: now against what they started with */
  sinceStartUsd?: number | undefined;
  /** some of the curve is told again from a book (not only the points the service wrote) */
  rebuilt: boolean;
  /** what the told-again past cannot know, in words */
  inexact?: string[] | undefined;
  /** markets that had no price at some point of the curve (the last price they traded at stood for it) */
  missing?: string[] | undefined;
}

const r2 = (n: number): number => Number(n.toFixed(2)) || 0;
const iso = (ms: number): string => new Date(ms).toISOString();

/** where a range starts: a span back from now, or — all of it — the earliest start of the accounts in it */
export function paperRangeStart(range: NetWorthRange, now: number, series: ReadonlyArray<Pick<PaperVenueSeries, "createdAt" | "recorded" | "rebuilt">>): number {
  if (range !== "all") return now - SPAN_MS[range];
  const starts = series.map((s) => s.createdAt ?? s.recorded?.[0]?.at ?? s.rebuilt?.[0]?.at).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return starts.length ? Math.min(...starts) : now;
}

/** one account's points, the written ones first: a told-again point stands only where no written point stands (one written within the
 * last STANDS_MS before it), and the last point is the value now */
function merged(s: PaperVenueSeries, now: number): PaperPoint[] {
  const rec = [...(s.recorded ?? [])].filter((p) => p.at <= now).sort((a, b) => a.at - b.at);
  const covered = (t: number): boolean => {
    // the newest written point at or before t
    let lo = 0;
    let hi = rec.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rec[mid]!.at <= t) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best >= 0 && t - rec[best]!.at <= STANDS_MS;
  };
  const re = (s.rebuilt ?? []).filter((p) => p.at < now && !covered(p.at));
  const out = [...rec, ...re].sort((a, b) => a.at - b.at);
  out.push({ at: now, usd: s.nowUsd });
  return out;
}

/** the value at t: the newest point at or before it */
function valueAt(points: readonly PaperPoint[], t: number): PaperPoint | undefined {
  let lo = 0;
  let hi = points.length - 1;
  let best: PaperPoint | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.at <= t) {
      best = points[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** The paper accounts' curve over `range` (1d, 1w, 1m, all) as of `now`: one point per bucket (the buckets of the net worth curve), each
 * account's start inside the range a point of its own, and the last point now. `events`: the paper accounts' connections in the log */
export function paperCurve(series: readonly PaperVenueSeries[], o: { range: string; now: number; events?: readonly NetWorthEvent[] | undefined; venue?: string | undefined }): PaperHistory | Refusal {
  if (!(NETWORTH_RANGES as readonly string[]).includes(o.range)) return no("E_ACCOUNT_BAD_ACTION", { message: `a net worth range is one of ${NETWORTH_RANGES.join(", ")}: not "${o.range}"`, detail: { ranges: NETWORTH_RANGES } });
  const range = o.range as NetWorthRange;
  const now = o.now;
  const startMs = paperRangeStart(range, now, series);
  const bucket = bucketFor(range, now - startMs);
  const step = BUCKET_MS[bucket];
  const accounts = series.map((s) => {
    const points = merged(s, now);
    const begins = s.createdAt ?? points[0]?.at ?? now;
    return { s, points, begins };
  });
  // the instants drawn: the buckets' ends, every account's start inside the range, and now
  const times = new Set<number>();
  for (let t = Math.ceil(startMs / step) * step; t < now; t += step) times.add(t);
  for (const a of accounts) if (a.begins >= startMs && a.begins <= now) times.add(a.begins);
  if (range !== "all" && accounts.some((a) => a.begins < startMs)) times.add(startMs);
  times.add(now);
  const points = [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      let usd = 0;
      let partial = false;
      let any = false;
      for (const a of accounts) {
        if (a.begins > t) continue;
        // an account started at t stands at what it started with
        const p = a.begins === t && a.s.startUsd !== undefined ? { at: t, usd: a.s.startUsd } : valueAt(a.points, t);
        if (!p) continue;
        any = true;
        usd += p.usd;
        if (p.partial) partial = true;
      }
      return any ? { at: iso(t), usd: r2(usd), ...(partial ? { partial: true as const } : {}) } : undefined;
    })
    .filter((p): p is NonNullable<typeof p> => !!p);
  // the change: each account from where it stood at the start (or from what it started with, started since) to now
  let change = 0;
  let base = 0;
  let counted = 0;
  for (const a of accounts) {
    const from = a.begins >= startMs ? (a.s.startUsd !== undefined ? a.s.startUsd : a.points[0]?.usd) : valueAt(a.points, startMs)?.usd;
    if (from === undefined) continue;
    change += a.s.nowUsd - from;
    base += from;
    counted++;
  }
  const allStarted = series.length > 0 && series.every((s) => s.startUsd !== undefined);
  const startUsd = allStarted ? r2(series.reduce((x, s) => x + s.startUsd!, 0)) : undefined;
  const inexact = [...new Set(series.flatMap((s) => s.inexact ?? []))];
  const missing = [...new Set(series.flatMap((s) => s.missing ?? []))];
  const first = accounts.map((a) => a.begins).filter((x) => Number.isFinite(x));
  const events = (o.events ?? []).filter((e) => {
    const ms = Date.parse(e.at);
    return ms >= startMs && ms <= now;
  });
  return {
    range,
    from: iso(startMs),
    bucket,
    points,
    ...(first.length ? { first: iso(Math.min(...first)) } : {}),
    events,
    changeUsd: points.length >= 2 && counted ? r2(change) : 0,
    ...(points.length >= 2 && base > 0 ? { changePct: r2((change / base) * 100) } : {}),
    ...(points.some((p) => p.partial) ? { partial: true as const } : {}),
    paper: true,
    ...(o.venue ? { venue: o.venue } : {}),
    ...(startUsd !== undefined ? { startUsd, sinceStartUsd: r2(series.reduce((x, s) => x + s.nowUsd, 0) - startUsd) } : {}),
    rebuilt: series.some((s) => (s.rebuilt?.length ?? 0) > 0),
    ...(inexact.length ? { inexact } : {}),
    ...(missing.length ? { missing } : {}),
  };
}
