import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { comparable, compute, NUMBERS_FILE, ROOT, statAt, type SiteNumbers } from "../../scripts/site-numbers.ts";

/** the site shows only numbers computed from this repository: the committed file and every data-stat on the page must say what compute()
 * says today, or the page is stale (`npm run site:numbers`) */
describe("site numbers", () => {
  it("site/data/numbers.json says what the repository says", async () => {
    const file = JSON.parse(readFileSync(NUMBERS_FILE, "utf8")) as SiteNumbers;
    expect(comparable(file)).toEqual(comparable(await compute()));
  });

  it("every data-stat on the page is the computed number", async () => {
    const n = await compute();
    const html = readFileSync(join(ROOT, "site", "index.html"), "utf8");
    const stats = [...html.matchAll(/data-stat="([a-zA-Z.]+)"[^>]*>([^<]*)</g)];
    expect(stats.length).toBeGreaterThan(0);
    for (const [, key, text] of stats) {
      const want = statAt(n, key!);
      expect(typeof want, key).toBe("number");
      expect(text!.replace(/[^0-9]/g, ""), key).toBe(String(want));
    }
  });
});
