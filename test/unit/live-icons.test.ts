import { describe, expect, it } from "vitest";
import { ELBSTREAM_LOGOS, iconOf, venueImage } from "../../src/portfolio/live/icons.ts";
import { STOCK_TOKEN_ISSUER } from "../../src/portfolio/live/robinhood.ts";

/** A market's icon (live/icons.ts): the address of the logo a page shows beside its name, from where its owner publishes it — Elbstream's
 * logos for coins and tickers, a company's own website icon, a venue's own picture for an event. Nothing is fetched here: these are words. */

describe("a market's icon", () => {
  it("a coin and a coin's perpetual: Elbstream's logo for the coin; a share or a fund: Elbstream's for the ticker", () => {
    expect(iconOf({ key: "coin:BTC", kind: "coin", base: "BTC" })).toBe(`${ELBSTREAM_LOGOS}/crypto/BTC`);
    expect(iconOf({ key: "perp:WLD", kind: "perp", base: "wld" })).toBe(`${ELBSTREAM_LOGOS}/crypto/WLD`);
    expect(iconOf({ key: "coin:1INCH", kind: "coin", base: "1INCH" })).toBe(`${ELBSTREAM_LOGOS}/crypto/1INCH`);
    expect(iconOf({ key: "stock:AAPL", kind: "stock", base: "AAPL" })).toBe(`${ELBSTREAM_LOGOS}/symbol/AAPL`);
    expect(iconOf({ key: "stock:SPY", kind: "stock", base: "SPY" })).toBe(`${ELBSTREAM_LOGOS}/symbol/SPY`);
    expect(iconOf({ key: "stock:BRK.B", kind: "stock", base: "BRK.B" })).toBe(`${ELBSTREAM_LOGOS}/symbol/BRK.B`);
  });

  it("a tokenised share is its share's, by its issuer; a fund's token its own coin's; any other token none", () => {
    // Ondo's tokens are the ticker and "on", xStocks' the ticker and "x", Robinhood's the ticker (explore.ts upper-cases a row's base)
    expect(iconOf({ key: "rwa:NVDAON", kind: "rwa", base: "NVDAON", issuer: "Ondo Global Markets" })).toBe(`${ELBSTREAM_LOGOS}/symbol/NVDA`);
    expect(iconOf({ key: "rwa:TSLAX", kind: "rwa", base: "TSLAX", issuer: "Backed (xStocks)" })).toBe(`${ELBSTREAM_LOGOS}/symbol/TSLA`);
    expect(iconOf({ key: "rwa:AAPL", kind: "rwa", base: "AAPL", issuer: STOCK_TOKEN_ISSUER })).toBe(`${ELBSTREAM_LOGOS}/symbol/AAPL`);
    // a fund's token (Ondo Finance's, BlackRock's) is not a share: its own coin logo
    expect(iconOf({ key: "rwa:OUSG", kind: "rwa", base: "OUSG", issuer: "Ondo Finance" })).toBe(`${ELBSTREAM_LOGOS}/crypto/OUSG`);
    expect(iconOf({ key: "rwa:BUIDL", kind: "rwa", base: "BUIDL", issuer: "BlackRock, through Securitize" })).toBe(`${ELBSTREAM_LOGOS}/crypto/BUIDL`);
    // a token whose issuer says nothing of shares or funds has none: Elbstream's crypto TSLA is FTX's tokenised Tesla, not Tesla
    expect(iconOf({ key: "rwa:TSLA", kind: "rwa", base: "TSLA" })).toBeUndefined();
    expect(iconOf({ key: "rwa:USDY", kind: "rwa", base: "USDY", issuer: "Stand-in Issuer (not a real issuer)" })).toBeUndefined();
  });

  it("a pre-IPO company: its own website's icon; a company the account does not know has none", () => {
    expect(iconOf({ key: "preipo:anthropic", kind: "perp", base: "ANTHROPIC", group: { id: "preipo:anthropic" } })).toBe("https://www.google.com/s2/favicons?domain=anthropic.com&sz=128");
    expect(iconOf({ key: "preipo:moonshot", kind: "perp", base: "MOONSHOT", group: { id: "preipo:moonshot" } })).toBe("https://www.google.com/s2/favicons?domain=kimi.com&sz=128");
    // a venue's own pre-IPO label for a company not in the table: not the coin of the same letters
    expect(iconOf({ key: "preipo:stripe", kind: "perp", base: "STRIPE", group: { id: "preipo:stripe" } })).toBeUndefined();
  });

  it("an event: the venue's own picture, from its own host over https; else Kalshi's for the series its ticker starts with; else none", () => {
    const pm = "https://polymarket-upload.s3.us-east-2.amazonaws.com/democrats+2028+donkey.png";
    expect(iconOf({ key: `pm:0x${"ab".repeat(32)}`, kind: "event" }, pm)).toBe(pm);
    expect(iconOf({ key: "kalshi:KXFEDDECISION-26OCT-H0", kind: "event" })).toBe("https://kalshi-public-docs.s3.amazonaws.com/series-images-webp/KXFEDDECISION.webp");
    expect(iconOf({ key: "kalshi:KXIPOANTHROPIC-DATE-26DEC01", kind: "event" })).toBe("https://kalshi-public-docs.s3.amazonaws.com/series-images-webp/KXIPOANTHROPIC.webp");
    // a picture from anywhere else, or not over https, is not shown: Kalshi's own still is, for a Kalshi market
    expect(iconOf({ key: "pm:0xcd", kind: "event" }, "https://tracker.example/pixel.png")).toBeUndefined();
    expect(iconOf({ key: "pm:0xcd", kind: "event" }, "http://polymarket-upload.s3.us-east-2.amazonaws.com/x.png")).toBeUndefined();
    expect(iconOf({ key: "kalshi:KXCPI-26SEP-T0.6", kind: "event" }, "https://tracker.example/pixel.png")).toBe("https://kalshi-public-docs.s3.amazonaws.com/series-images-webp/KXCPI.webp");
    expect(iconOf({ key: "event:standin:SI-FEDCUT-DEC", kind: "event" })).toBeUndefined();
    expect(venueImage("not a url")).toBeUndefined();
  });

  it("puts nothing into an address that does not read as a symbol", () => {
    expect(iconOf({ key: "coin:X", kind: "coin", base: "BTC/../../x" })).toBeUndefined();
    expect(iconOf({ key: "stock:X", kind: "stock", base: "AAPL?x=1" })).toBeUndefined();
    expect(iconOf({ key: "coin:X", kind: "coin", base: "" })).toBeUndefined();
    expect(iconOf({ key: "kalshi:../x", kind: "event" })).toBeUndefined();
  });
});
