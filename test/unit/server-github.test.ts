/** THE GITHUB SIGN-IN'S ROUTES (server.ts): GET /api/account/github, POST …/start and …/signout, on a real server over a stand-in GitHub.
 * They answer the page only — a browser's own headers, behind the origin guard every route has — and nothing they say carries GitHub's
 * device code or a token; /api/account, which the agents' seat reads too, names nobody from GitHub. A server with no GitHub app says so.
 * Nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { simKey } from "../../src/portfolio/account/sign.ts";
import { DEVICE_URL } from "../../src/portfolio/live/github.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

const START = Date.parse("2026-10-21T15:00:00Z");
const owner = simKey("owner");
const DEVICE = "dc_server_test_device_code_0001";
const TOKEN = "ghu_server0test0token0000000000000000";
const homes: string[] = [];
const servers: PortfolioServerHandle[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const json = (body: unknown): HttpReply => ({ status: 200, body, text: JSON.stringify(body) });
const github: Http = async (url) => {
  if (url === "https://github.com/login/device/code") return json({ device_code: DEVICE, user_code: "WDJB-MJHT", verification_uri: DEVICE_URL, expires_in: 900, interval: 5 });
  if (url === "https://github.com/login/oauth/access_token") return json({ access_token: TOKEN, expires_in: 28_800, token_type: "bearer" });
  if (url === "https://api.github.com/user") return json({ login: "octo-cat", id: 583231, name: "The Octocat" });
  return { status: 599, body: undefined, text: "no network" };
};

async function boot(withGitHub = true) {
  const home = mkdtempSync(join(tmpdir(), "server-github-"));
  homes.push(home);
  const due: Array<() => void> = [];
  const service = await PortfolioService.create({
    home,
    now: () => new Date(START).toISOString(),
    venues: "frontline",
    real: true,
    liveDeps: { clock: () => START, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined },
    publicMarkets: [],
    liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" },
    account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] },
    ...(withGitHub ? { github: { clientId: "Iv23testclient0000000", repo: "linqizhe07/buyer-agent-demo", discussion: 7, http: github, schedule: (fn: () => void) => (due.push(fn), () => undefined) } } : {}),
  });
  const srv = await startPortfolioServer({ port: 0, service, snapshotMs: 0 });
  servers.push(srv);
  return { srv, service, due };
}
function send(url: string, path: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; text: string; body: any }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: o.method ?? "GET", headers: { "content-type": "application/json", ...(o.headers ?? {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => {
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
        resolve({ status: res.statusCode ?? 0, text, body });
      });
    });
    req.on("error", reject);
    req.end(o.body);
  });
}

describe("the GitHub sign-in's routes", () => {
  it("answer the page's own requests only, and never say GitHub's device code or the token", async () => {
    const { srv, due } = await boot();
    const page = { origin: srv.url, "sec-fetch-site": "same-origin" };
    const first = await send(srv.url, "/api/account/github");
    expect(first.body).toMatchObject({ ok: true, on: true, repo: "linqizhe07/buyer-agent-demo", thread: "https://github.com/linqizhe07/buyer-agent-demo/discussions/7" });
    expect(first.body.signedIn).toBeUndefined();
    // a program that sends no browser's headers starts nothing
    expect((await send(srv.url, "/api/account/github/start", { method: "POST", body: "{}" })).status).toBe(403);
    // another site's page: the origin guard refuses it before the route is reached
    expect((await send(srv.url, "/api/account/github/start", { method: "POST", body: "{}", headers: { origin: "https://evil.example" } })).status).toBe(403);
    const started = await send(srv.url, "/api/account/github/start", { method: "POST", body: "{}", headers: page });
    expect(started.status).toBe(200);
    expect(started.body.waiting).toMatchObject({ code: "WDJB-MJHT", verify: DEVICE_URL });
    expect(started.text).not.toContain(DEVICE);
    // GitHub's first check: signed in
    due.shift()!();
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    const signed = await send(srv.url, "/api/account/github");
    expect(signed.body.signedIn).toMatchObject({ login: "octo-cat", name: "The Octocat" });
    expect(signed.text).not.toContain(TOKEN);
    expect(signed.text).not.toContain(DEVICE);
    // the account's own view, which the agents' seat reads, names nobody from GitHub
    expect((await send(srv.url, "/api/account")).text).not.toMatch(/octo-cat|Octocat/);
    expect((await send(srv.url, "/api/account/github/signout", { method: "POST", body: "{}" })).status).toBe(403);
    const out = await send(srv.url, "/api/account/github/signout", { method: "POST", body: "{}", headers: page });
    expect(out.status).toBe(200);
    expect(out.body.signedIn).toBeUndefined();
  });

  it("say {on: false} on a server with no GitHub app, and start nothing there", async () => {
    const { srv } = await boot(false);
    expect((await send(srv.url, "/api/account/github")).body).toEqual({ ok: true, on: false });
    expect((await send(srv.url, "/api/account/github/start", { method: "POST", body: "{}", headers: { origin: srv.url, "sec-fetch-site": "same-origin" } })).status).toBe(404);
  });
});
