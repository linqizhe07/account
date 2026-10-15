import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** The trading area wears Hyperliquid's face, Inter, and the account serves it itself: four files in public/fonts (regular and bold, latin
 * and latin-ext), taken from the @fontsource/inter package and never from Google Fonts. Each is served as the file it is, typed font/woff2
 * and kept a year (the names carry the version), and the licence that lets the account host it says whose it is */
const FONTS = fileURLToPath(new URL("../../src/portfolio/public/fonts/", import.meta.url));
const INTER = ["inter-v4-latin-400", "inter-v4-latin-700", "inter-v4-latin-ext-400", "inter-v4-latin-ext-700"];
const home = mkdtempSync(join(tmpdir(), "server-fonts-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("the trading area's face", () => {
  it("serves Inter's four files from the account itself, typed font/woff2 and kept a year, each a real WOFF2 file; the licence names Inter", async () => {
    const svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });
    const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
    try {
      for (const name of INTER) {
        const onDisk = readFileSync(join(FONTS, `${name}.woff2`));
        // a WOFF2 file starts with its signature: anything else here would be a page or a stub, not a face
        expect(onDisk.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
        const r = await fetch(`${srv.url}/fonts/${name}.woff2`);
        expect([r.status, r.headers.get("content-type"), r.headers.get("cache-control")], name).toEqual([200, "font/woff2", "public, max-age=31536000, immutable"]);
        expect(Buffer.from(await r.arrayBuffer()).equals(onDisk), name).toBe(true);
      }
      const licence = readFileSync(join(FONTS, "OFL.txt"), "utf8");
      expect(licence).toContain("three families");
      expect(licence).toContain("Inter (inter-v4-*.woff2)");
      expect(licence).toContain("Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)");
    } finally {
      await srv.close();
    }
  });
});
