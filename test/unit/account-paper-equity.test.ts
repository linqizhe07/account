import { describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { paperCurve, paperRangeStart, type PaperHistory, type PaperVenueSeries } from "../../src/portfolio/account/paper-equity.ts";

/** The paper accounts' curve (account/paper-equity.ts): each account's points — the ones the service wrote winning over the ones told again
 * from its book — added up on the net worth curve's buckets; each account's change from where it stood at the range's start, or from what
 * it started with when it started inside it; the last point the figure now. Pure: no book, no network, the clock given */
const H = 3_600_000;
const NOW = Date.parse("2026-10-14T15:00:00Z");
const curve = (series: PaperVenueSeries[], range = "1d", venue?: string): PaperHistory => {
  const c = paperCurve(series, { range, now: NOW, ...(venue ? { venue } : {}) });
  if (isRefusal(c)) throw new Error(c.message);
  return c;
};
const at = (c: PaperHistory, ms: number) => c.points.find((p) => p.at === new Date(ms).toISOString())?.usd;

describe("the paper accounts' curve", () => {
  it("one account started inside the range: its start at what it started with, its told-again points on the buckets, the figure now last; its change since it started", () => {
    const created = NOW - 3 * H;
    const rebuilt = [{ at: created, usd: 10000 }, ...Array.from({ length: 36 }, (_, i) => ({ at: created + (i + 1) * 300_000, usd: 10000 + i }))];
    const c = curve([{ venue: "paper-1", name: "Paper account", startUsd: 10000, createdAt: created, rebuilt, nowUsd: 10050 }]);
    expect(c).toMatchObject({ range: "1d", bucket: "5m", paper: true, rebuilt: true, startUsd: 10000, sinceStartUsd: 50, changeUsd: 50, changePct: 0.5, first: new Date(created).toISOString() });
    expect(c.points[0]).toEqual({ at: new Date(created).toISOString(), usd: 10000 });
    expect(c.points[c.points.length - 1]).toEqual({ at: new Date(NOW).toISOString(), usd: 10050 });
    // nothing before it started
    expect(c.points.every((p) => Date.parse(p.at) >= created)).toBe(true);
    expect(at(c, created + 3_600_000)).toBe(10011);
  });

  it("the written points win where they stand; the told-again ones fill where the service was not looking", () => {
    const created = NOW - 6 * H;
    const rebuilt = Array.from({ length: 72 }, (_, i) => ({ at: created + (i + 1) * 300_000, usd: 1000 }));
    // the service wrote points from 2 hours ago on: 2000
    const recorded = Array.from({ length: 24 }, (_, i) => ({ at: NOW - 2 * H + i * 300_000, usd: 2000 }));
    const c = curve([{ venue: "paper-1", name: "P", startUsd: 1000, createdAt: created, rebuilt, recorded, nowUsd: 2000 }]);
    expect(at(c, NOW - 3 * H)).toBe(1000);
    expect(at(c, NOW - H)).toBe(2000);
    // a gap of an hour in the written points (the service was down): the told-again past stands in it
    const gappy = recorded.filter((p) => p.at < NOW - 1.5 * H || p.at > NOW - 0.5 * H);
    const g = curve([{ venue: "paper-1", name: "P", startUsd: 1000, createdAt: created, rebuilt, recorded: gappy, nowUsd: 2000 }]);
    expect(at(g, NOW - H)).toBe(1000);
  });

  it("several accounts add up; one started inside the range counts from its start, not as a gain; one with no book is its written points", () => {
    const old = { venue: "paper-1", name: "Old", startUsd: 10000, createdAt: NOW - 10 * 24 * H, rebuilt: [{ at: NOW - 30 * H, usd: 10100 }, { at: NOW - 23 * H, usd: 10200 }], nowUsd: 10300 };
    const fresh = { venue: "paper-2", name: "Fresh", startUsd: 5000, createdAt: NOW - 2 * H, rebuilt: [{ at: NOW - 2 * H, usd: 5000 }], nowUsd: 4900 };
    const venueOwn = { venue: "alpaca-paper", name: "Alpaca paper", recorded: [{ at: NOW - 20 * H, usd: 100000 }, { at: NOW - H, usd: 100500 }], nowUsd: 100600 };
    const c = curve([old, fresh, venueOwn]);
    // the day's change: the old one from where it stood a day ago (10,100), the fresh one from its 5,000, Alpaca's from its first point
    expect(c.changeUsd).toBe(10300 - 10100 + (4900 - 5000) + (100600 - 100000));
    // a venue's own paper account says nothing of what it started with: no start for all of them together
    expect(c.startUsd).toBeUndefined();
    expect(c.points[c.points.length - 1]!.usd).toBe(10300 + 4900 + 100600);
    // where the fresh one started, it stands at what it started with
    expect(at(c, NOW - 2 * H)).toBe(10200 + 5000 + 100000);
  });

  it("all of it starts at the earliest start; a range that is not one of the four is refused", () => {
    expect(paperRangeStart("all", NOW, [{ createdAt: NOW - 5 * H }, { recorded: [{ at: NOW - 9 * H, usd: 1 }] }])).toBe(NOW - 9 * H);
    expect(paperRangeStart("1w", NOW, [])).toBe(NOW - 7 * 24 * H);
    const c = curve([{ venue: "paper-1", name: "P", startUsd: 100, createdAt: NOW - 5 * H, rebuilt: [], nowUsd: 110 }], "all");
    expect(c.from).toBe(new Date(NOW - 5 * H).toISOString());
    expect(c.bucket).toBe("5m");
    expect(isRefusal(paperCurve([], { range: "3m", now: NOW }))).toBe(true);
  });

  it("says what the told-again past cannot know, and the markets it had no price for", () => {
    const c = curve([{ venue: "paper-1", name: "P", startUsd: 100, createdAt: NOW - H, rebuilt: [{ at: NOW - H, usd: 100 }, { at: NOW - 0.5 * H, usd: 101, partial: true }], nowUsd: 102, inexact: ["Funding before the account kept it is not in the curve."], missing: ["XYZ-PERP"] }]);
    expect(c).toMatchObject({ partial: true, inexact: ["Funding before the account kept it is not in the curve."], missing: ["XYZ-PERP"] });
  });
});
