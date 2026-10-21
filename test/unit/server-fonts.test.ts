import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** The page's two faces are served by the account itself, never from Google Fonts: Inter — the neo-grotesque every word and figure is set
 * in, one variable file a script (its weights and optical sizes), from the @fontsource-variable/inter package — and Geist Mono — the ocean's
 * glyphs, hashes and what is signed, 400, 500 and 600 in latin and latin-ext, from @fontsource/geist-mono. Each is served as the file it is,
 * typed font/woff2 and kept a year (the names carry the version), and the licence that lets the account host them says whose they are. The
 * faces they replaced (Manrope, Inter's older static files, IBM Plex Mono) are gone from the folder and are not served */
const FONTS = fileURLToPath(new URL("../../src/portfolio/public/fonts/", import.meta.url));
const INTER = ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "greek-ext", "vietnamese"].map((s) => `inter-v5-${s}`);
const GEIST = ["geist-mono-v5-latin-400", "geist-mono-v5-latin-500", "geist-mono-v5-latin-600", "geist-mono-v5-latin-ext-400", "geist-mono-v5-latin-ext-500", "geist-mono-v5-latin-ext-600"];
const home = mkdtempSync(join(tmpdir(), "server-fonts-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("the page's faces", () => {
  it("serves Inter's seven files and Geist Mono's six from the account itself, typed font/woff2 and kept a year, each a real WOFF2 file; the licence names both", async () => {
    const svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });
    const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
    try {
      for (const name of [...INTER, ...GEIST]) {
        const onDisk = readFileSync(join(FONTS, `${name}.woff2`));
        // a WOFF2 file starts with its signature: anything else here would be a page or a stub, not a face
        expect(onDisk.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
        const r = await fetch(`${srv.url}/fonts/${name}.woff2`);
        expect([r.status, r.headers.get("content-type"), r.headers.get("cache-control")], name).toEqual([200, "font/woff2", "public, max-age=31536000, immutable"]);
        expect(Buffer.from(await r.arrayBuffer()).equals(onDisk), name).toBe(true);
      }
      for (const gone of ["manrope-v20-latin", "inter-v4-latin-400", "plex-mono-400-v20-latin"]) expect((await fetch(`${srv.url}/fonts/${gone}.woff2`)).status, gone).toBe(404);
      const licence = readFileSync(join(FONTS, "OFL.txt"), "utf8");
      expect(licence).toContain("two families");
      expect(licence).toContain("Inter (inter-v5-*.woff2)");
      expect(licence).toContain("Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)");
      expect(licence).toContain("Geist Mono (geist-mono-v5-*.woff2)");
      expect(licence).toContain("Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git)");
      expect(licence).not.toMatch(/Manrope|IBM Plex/);
    } finally {
      await srv.close();
    }
  });
});
