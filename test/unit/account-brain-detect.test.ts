import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import type { ClaudeClient, ClaudeClientOptions } from "../../src/portfolio/account/brain-claude.ts";
import { bestListed, DETECT_BODY_WORDS, detectBrain, parseDetectBody, pickModel, recogniseKey, walletSecret, type Detected } from "../../src/portfolio/account/brain-detect.ts";
import { exampleKey, starredKey } from "../../src/portfolio/account/brain-key.ts";
import { BODY_WORDS, checkBeforeDoor, keyHashOf, newSalt, type SetBrainKey } from "../../src/portfolio/account/brain-keys.ts";
import { BRAIN_PRESETS, brainProviders, presetBest, presetHost } from "../../src/portfolio/account/brains.ts";
import { deskPath, ROLE_SPECS, roomPath, type Brain, type BrainProbe, type RoleId } from "../../src/portfolio/account/desk.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { register } from "../../src/portfolio/live/index.ts";
import type { LiveTrader, Market, OrderState } from "../../src/portfolio/live/trade.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** CONNECT A KEY (account/brain-detect.ts): one field on the Superagent where the owner pastes ANY provider's key. The account tells whose it
 * is by its shape, checks it with that provider (its list of models, which bills nothing, at the provider's own address), names the model
 * the desk would think with — and writes nothing; the key is then saved the way it always was, by the owner's signed setBrainKey at
 * /api/account/brain-key, and the desk switched by a signed setDesk. The providers' HTTP is stood in for here (a fetch and an Anthropic
 * client of the test's), so every key below is made up — built at run time from a fixed seed, never written out in this file — and nothing
 * leaves the process. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const homes: string[] = [];
const servers: PortfolioServerHandle[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const owner = simKey("owner");
const agent = simKey("agent:brain-detect");
const stranger = simKey("agent:stranger-detect");
let n = 0;
const nonce = () => Date.now() + ++n;

// ---- made-up keys: letters and digits from a fixed seed, in each provider's shape --------------------------------------------------

/** a made-up run of key characters (no "x", so none reads as a placeholder's x-run) */
function body(len: number, seed: number, alphabet = "abcdefghijkmnopqrstuvwyzABCDEFGHJKLMNPQRSTUVWYZ23456789"): string {
  let s = seed >>> 0;
  let out = "";
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out += alphabet[(s >>> 8) % alphabet.length];
  }
  return out;
}
const hex = (len: number, seed: number) => body(len, seed, "0123456789abcdef");
/** OpenAI's mark, base64 of "OpenAI", put together here rather than written out */
const MARK = ["T3Bl", "bkFJ"].join("");
const K = {
  anthropic: `sk-ant-${"api03"}-${body(93, 1)}AA`,
  anthropicEnterprise: `sk-ant-${"api01"}-${body(93, 2)}AA`,
  anthropicAdmin: `sk-ant-${"admin01"}-${body(93, 3)}AA`,
  claudeOauth: `sk-ant-${"oat01"}-${body(90, 4)}`,
  claudeSession: `sk-ant-${"sid01"}-${body(90, 5)}`,
  openaiProject: `sk-${"proj"}-${body(74, 6)}${MARK}${body(74, 7)}`,
  openaiService: `sk-${"svcacct"}-${body(58, 8)}${MARK}${body(58, 9)}`,
  openaiLegacy: `sk-${body(20, 10)}${MARK}${body(20, 11)}`,
  openaiAdmin: `sk-${"admin"}-${body(58, 12)}${MARK}${body(58, 13)}`,
  deepseek: `sk-${hex(32, 14)}`,
  plainSk: `sk-${body(48, 15)}`,
  openrouter: `sk-${"or"}-v1-${hex(64, 16)}`,
  xai: `${"xai"}-${body(80, 17)}`,
  groq: `${"gsk"}_${body(52, 18)}`,
  gemini: `${"AIza"}Sy${body(33, 19)}`,
  geminiAuth: `${"AQ"}.${body(60, 20)}`,
  meta: `${"LLM"}_1607358788850350_${body(40, 21)}`,
  together: `${"tgp"}_v1_${body(43, 22)}`,
  perplexity: `${"pplx"}-${body(48, 23)}`,
  alibabaPlan: `sk-${"sp"}-${body(32, 24)}`,
};
const ALL_KEYS = Object.values(K);

// ---- the providers' HTTP, stood in for ---------------------------------------------------------------------------------------------

type Answer = { status: number; body?: unknown; text?: string } | "down" | "slow" | "redirect" | "hang";
interface Call {
  url: string;
  auth: string;
  redirect: string | undefined;
}
/** A fetch for the OpenAI-format brains: every request kept (its URL, its bearer, its redirect mode) and answered by `answer` — a status and a
 * body, no answer at all ("down"), none in time ("slow", as AbortSignal.timeout says it), a redirect refused, or one that waits until
 * released ("hang") */
function providerHttp(answer: (url: URL, key: string) => Answer) {
  const calls: Call[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    calls.push({ url: url.toString(), auth, redirect: init?.redirect });
    const a = answer(url, auth.replace(/^Bearer /, ""));
    if (a === "hang") {
      await held;
      return new Response(JSON.stringify({ object: "list", data: [{ id: "gpt-6-astra" }] }), { status: 200 });
    }
    if (a === "down") throw new TypeError("fetch failed");
    if (a === "slow") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (a === "redirect") throw Object.assign(new TypeError("fetch failed"), { cause: { message: "unexpected redirect" } });
    return new Response(a.text ?? JSON.stringify(a.body ?? {}), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls, release: () => release() };
}
const list = (...ids: string[]) => ({ status: 200, body: { object: "list", data: ids.map((id) => ({ id, object: "model" })) } });
const hostIs = (u: URL, h: string) => u.host === h;

/** Anthropic's client, stood in for: the keys clients were made with, and the list of models answered for each */
function claudeHttp(answer: (key: string) => { ids: string[] } | { status: number; message: string } | "down" | "slow") {
  const made: string[] = [];
  const newClaudeClient = (c: ClaudeClientOptions): ClaudeClient => {
    made.push(String(c.apiKey));
    const list = async () => {
      const a = answer(String(c.apiKey));
      if (a === "down") throw new Anthropic.APIConnectionError({ message: "Connection error." });
      if (a === "slow") throw new Anthropic.APIConnectionTimeoutError();
      if ("status" in a) throw Anthropic.APIError.generate(a.status, { type: "error", error: { type: a.status === 401 ? "authentication_error" : "invalid_request_error", message: a.message } }, undefined, new Headers());
      return { data: a.ids.map((id) => ({ id, type: "model" })), has_more: false };
    };
    return { messages: { parse: (async () => Promise.reject(new Error("not asked here"))) as never }, models: { list: list as never } };
  };
  return { newClaudeClient, made };
}

/** every preset's real brain, as the account makes them (brains.ts), over the stood-in HTTP and an empty environment */
function realBrains(home: string, http = providerHttp(() => ({ status: 401, body: { error: { message: "Incorrect API key provided" } } })), claude = claudeHttp(() => ({ status: 401, message: "invalid x-api-key" }))): Brain[] {
  return brainProviders(home, { env: {}, fetch: http.fetch, newClaudeClient: claude.newClaudeClient });
}
const freshHome = () => {
  const h = mkdtempSync(join(tmpdir(), "brain-detect-"));
  homes.push(h);
  return h;
};
const detect = (key: string, brains: Brain[]) => detectBrain(key, brains, { best: presetBest, host: presetHost });
/** nothing of the key in any of it: not the key, not its last eight, not its first sixteen */
const keyless = (text: string, key: string) => {
  expect(text).not.toContain(key);
  expect(text).not.toContain(key.slice(-8));
  expect(text).not.toContain(key.slice(0, 16));
};

// ---- 1. whose key, by its shape ------------------------------------------------------------------------------------------------------

describe("whose key, by its shape alone (recogniseKey)", () => {
  it("names the provider each prefix belongs to — and asks of no one a key whose prefix names one", () => {
    const asks = (k: string) => {
      const r = recogniseKey(k);
      return r.ok ? r.ask : r.code;
    };
    expect(asks(K.anthropic)).toEqual(["claude"]);
    // an sk-ant-api01- key may be a Claude Enterprise admin key: only the call tells, so it is asked about too
    expect(asks(K.anthropicEnterprise)).toEqual(["claude"]);
    expect(asks(K.openaiProject)).toEqual(["openai"]);
    expect(asks(K.openaiService)).toEqual(["openai"]);
    expect(asks(K.openaiLegacy)).toEqual(["openai"]);
    expect(asks(K.openrouter)).toEqual(["openrouter"]);
    expect(asks(K.xai)).toEqual(["xai"]);
    expect(asks(K.groq)).toEqual(["groq"]);
    expect(asks(K.gemini)).toEqual(["gemini"]);
    expect(asks(K.geminiAuth)).toEqual(["gemini"]);
    expect(asks(K.meta)).toEqual(["meta"]);
    expect(asks(K.together)).toEqual(["together"]);
    // with a space before and a line break after, as a paste brings it
    expect(asks(`  ${K.groq}\n`)).toEqual(["groq"]);
  });

  it("a plain sk- key — DeepSeek's shape, or any other with no mark of its own — is for the real call to settle: DeepSeek, then Kimi, then OpenAI", () => {
    for (const k of [K.deepseek, K.plainSk, `sk-${body(40, 99)}`, `sk-${"ws"}${body(60, 98)}`]) {
      const r = recogniseKey(k);
      expect(r).toMatchObject({ ok: true, ask: ["deepseek", "moonshot", "openai"] });
    }
  });

  it("refuses before anything is sent, in words that never repeat it: keys that manage an account, a Claude subscription's tokens, an Alibaba plan key, Perplexity, another service's secret", () => {
    const refused = (k: string) => {
      const r = recogniseKey(k);
      expect(r.ok, k.slice(0, 12)).toBe(false);
      if (r.ok) throw new Error("taken");
      keyless(r.words, k);
      return [r.code, r.words] as const;
    };
    expect(refused(K.anthropicAdmin)).toEqual(["manages", expect.stringContaining("Anthropic Admin API key (it starts sk-ant-admin): it manages an organization's members, workspaces and keys, and cannot run a model")]);
    expect(refused(K.openaiAdmin)).toEqual(["manages", expect.stringContaining("OpenAI admin key (it starts sk-admin-)")]);
    expect(refused(K.claudeOauth)).toEqual(["subscription", expect.stringContaining("Anthropic's terms keep it to Anthropic's own apps")]);
    expect(refused(K.claudeSession)).toEqual(["subscription", expect.stringContaining("claude.ai session")]);
    expect(refused(K.alibabaPlan)).toEqual(["needs-address", expect.stringContaining("add it under Qwen in Brains, below, with your workspace's base URL")]);
    expect(refused(K.perplexity)).toEqual(["not-offered", expect.stringContaining("Perplexity ended its support for the chat format the brain speaks on 27 Sep 2026")]);
    for (const k of [`sk_${"live"}_${body(24, 30)}`, `AKIA${body(16, 31, "ABCDEFGHIJKLMNOPQRSTUVWYZ234567")}`, `ghp_${body(36, 32)}`, `xoxb-${body(24, 33)}`, `eyJ${body(20, 34)}.${body(30, 35)}.${body(20, 36)}`]) expect(refused(k)[0]).toBe("other-service");
    expect(refused(`-----BEGIN PRIVATE KEY-----${body(20, 37)}`)[0]).not.toBe("unrecognised");
    // every "it was not sent" said so
    expect(refused(K.anthropicAdmin)[1]).toContain("It was not sent to any provider.");
  });

  it("what a wallet holds — a private key's 64 hex characters (with or without 0x), a recovery phrase — is never sent anywhere", () => {
    const words = ["abandon", "wallet", "garden", "river", "silent", "orbit", "cable", "frost", "lunar", "pepper", "magnet", "tiger"];
    for (const k of [hex(64, 40), `0x${hex(64, 41)}`, `0x${hex(64, 42).toUpperCase()}`, words.join(" "), [...words, ...words].join(" ")]) {
      expect(walletSecret(k), k.slice(0, 10)).toBe(true);
      const r = recogniseKey(k);
      expect(r).toMatchObject({ ok: false, code: "wallet" });
      if (!r.ok) {
        expect(r.words).toContain("Never paste either into a page: whoever has one has the wallet.");
        keyless(r.words, k);
      }
    }
    // a key that only holds hex is not a wallet's: DeepSeek's sk- and 32 hex, OpenRouter's 64 hex after its prefix
    expect(walletSecret(K.deepseek)).toBe(false);
    expect(walletSecret(K.openrouter)).toBe(false);
  });

  it("the example from a how-to, or a key starred out as a dashboard shows it, is never a key: refused at once — the readiness checks' old examples among them", () => {
    // a space inside is said as the shape: a paste gone wrong more often than an example
    expect(recogniseKey("<your key>")).toMatchObject({ ok: false, code: "shape" });
    for (const k of ["sk-ant-...", "sk-...", "sk-proj-…", "<your-key>", "{API_KEY}", "[key]", "sk-xxxxxxxxxxxxxxxx", "sk-ant-api03-XXXXXXXXXXXXXXXX", `AIza${"X".repeat(35)}`, "YOUR_API_KEY", "your-api-key-here", "api_key_here", "paste-your-key", "changeme-0000000000", "LLM_1607358788850350_nx9.....LJY"]) {
      expect(exampleKey(k), k).toBe(true);
      expect(recogniseKey(k), k).toMatchObject({ ok: false, code: "example" });
    }
    for (const k of ["sk-proj-****abcd", "sk-…****…wxyz", "••••••••3f9a"]) {
      expect(starredKey(k), k).toBe(true);
      expect(recogniseKey(k)).toMatchObject({ ok: false, code: "starred", words: expect.stringContaining("hidden behind stars") });
    }
    // no made-up key of a real shape is taken for an example, and the stand-in's and the tests' own keys are not either
    for (const k of [...ALL_KEYS, "sk-test-set-QZJXWVKPRMTLHGFD-setYQZW", "sk-made-up-for-tests-0000-abcd-7890", "token-abc123", "sk-by-hand-0000000000000000"]) expect(exampleKey(k), k.slice(0, 12)).toBe(false);
  });

  it("anything else is a key it does not recognise — said with the keys it does take — and what is not 8 to 512 printable characters is not a key at all", () => {
    const r = recogniseKey(`hello-${body(30, 50)}`);
    expect(r).toMatchObject({ ok: false, code: "unrecognised" });
    if (!r.ok) {
      expect(r.words).toContain("Anthropic (sk-ant-), OpenAI (sk-proj-), OpenRouter (sk-or-), xAI (xai-), Groq (gsk_), Google Gemini (AIza, AQ.), Meta (LLM_), DeepSeek and Kimi (sk-)");
      expect(r.words).toContain("pick Custom endpoint in Brains");
    }
    expect(recogniseKey("abc")).toMatchObject({ ok: false, code: "shape" });
    expect(recogniseKey(`sk-${"é".repeat(20)}`)).toMatchObject({ ok: false, code: "shape" });
  });
});

// ---- 3. the model ----------------------------------------------------------------------------------------------------------------------

describe("the model a key is connected with (pickModel, bestListed)", () => {
  it("the provider's best first, as it lists it; then a suggestion; then the newest-looking chat model it lists; Claude only from the desk's own", () => {
    expect(pickModel(["gpt-6-luna", "gpt-6.1-sol", "GPT-6-ASTRA"], { best: ["gpt-6-astra", "gpt-6.1-sol"], suggested: [] })).toEqual({ model: "GPT-6-ASTRA", picked: "best" });
    expect(pickModel(["kimi-k2.6", "moonshot-v1-8k"], { best: ["kimi-k3"], suggested: ["kimi-k2.6"] })).toEqual({ model: "kimi-k2.6", picked: "suggested" });
    expect(pickModel(["text-embedding-3-small", "whisper-1", "gpt-7-nova", "gpt-7-nova-2027-01-01", "tts-1"], { best: ["gpt-6-astra"], suggested: [] })).toEqual({ model: "gpt-7-nova", picked: "listed" });
    expect(pickModel(["claude-3-haiku"], { best: ["claude-opus-5-5"], suggested: [], only: true })).toBeUndefined();
    expect(pickModel(["text-embedding-3-small", "dall-e-3", "omni-moderation-latest"], { best: [], suggested: [] })).toBeUndefined();
    // newest first, then the larger tier, then a settled one before a preview, sizes in billions never read as versions
    expect(bestListed(["gemini-3.8-flash", "gemini-4-argon-preview", "gemini-4-argon", "gemini-4-flash-lite"])).toBe("gemini-4-argon");
    expect(bestListed(["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile"])).toBe("qwen/qwen3.8-27b");
    expect(bestListed(["deepseek-flash", "deepseek-v4-pro"])).toBe("deepseek-v4-pro");
  });

  it("each model API's best names the provider's recommended model first, read the day this was built", () => {
    expect(presetBest("openai")[0]).toBe("gpt-6-astra");
    expect(presetBest("deepseek")[0]).toBe("deepseek-v4-pro");
    expect(presetBest("xai")[0]).toBe("grok-4.7");
    expect(presetBest("meta")[0]).toBe("muse-spark-1.3");
    expect(presetBest("moonshot")[0]).toBe("kimi-k3");
    expect(presetBest("gemini")[0]).toBe("gemini-4-argon");
    expect(presetBest("groq")[0]).toBe("openai/gpt-oss-120b");
    expect(presetBest("together")[0]).toBe("moonshotai/Kimi-K3");
    expect(presetBest("openrouter")[0]).toBe("openai/gpt-6-astra");
    // Claude's order is its own listed models; a preset with no address of its own has none, and no host to send a key to
    expect(presetBest("claude")).toEqual([]);
    expect([presetHost("claude"), presetHost("openai"), presetHost("qwen"), presetHost("custom")]).toEqual(["api.anthropic.com", "api.openai.com", "", ""]);
    for (const p of BRAIN_PRESETS) if (p.format === "openai" && p.kind === "model-api" && p.defaultBase) expect(p.best?.length, p.id).toBeGreaterThan(0);
  });
});

// ---- 2. asked: the probes, over the stood-in HTTP ------------------------------------------------------------------------------------

describe("the probes: the provider's own list of models, asked with the pasted key at the provider's own address", () => {
  it("OpenAI: GET api.openai.com/v1/models with the key as a bearer and redirects refused — never the base URL the environment or a key file names", async () => {
    const http = providerHttp((u, key) => (hostIs(u, "api.openai.com") && key === K.openaiProject ? list("gpt-6-luna", "gpt-6-astra", "text-embedding-3-small") : { status: 401, body: {} }));
    const brains = brainProviders(freshHome(), { env: { OPENAI_BASE_URL: "https://proxy.example.com/v1", OPENAI_API_KEY: `sk-${body(40, 60)}` }, fetch: http.fetch });
    const r = await detect(K.openaiProject, brains);
    expect(r).toMatchObject({ ok: true, provider: "openai", label: "OpenAI API", who: "OpenAI", host: "api.openai.com", model: "gpt-6-astra", modelName: "gpt-6-astra", picked: "best", listed: 3, tail: `…${K.openaiProject.slice(-4)}`, what: "an OpenAI key" });
    expect(http.calls).toEqual([{ url: "https://api.openai.com/v1/models", auth: `Bearer ${K.openaiProject}`, redirect: "error" }]);
    keyless(JSON.stringify(r), K.openaiProject);
  });

  it("a plain sk- key is asked of DeepSeek, then Kimi, then OpenAI — the next only after a refusal; the first that takes it ends the asking", async () => {
    const http = providerHttp((u, key) => (hostIs(u, "api.moonshot.ai") && key === K.plainSk ? list("kimi-k2.6", "kimi-k3") : { status: 401, body: { error: { message: "Authentication Fails, Your api key is invalid" } } }));
    const r = await detect(K.plainSk, realBrains(freshHome(), http));
    expect(r).toMatchObject({ ok: true, provider: "moonshot", model: "kimi-k3", who: "Moonshot (Kimi)", host: "api.moonshot.ai", asked: [{ provider: "deepseek", outcome: "refused", status: 401 }, { provider: "moonshot", outcome: "taken", status: 200 }] });
    // OpenAI never saw it: Kimi took it first
    expect(http.calls.map((c) => new URL(c.url).host)).toEqual(["api.deepseek.com", "api.moonshot.ai"]);
  });

  it("all three refuse: said by name, with the Alibaba hint for a key in its shape; nothing in the answer holds the key, though a provider echoed it", async () => {
    // an endpoint that says the key back, whole and cut: scrubbed before anything reads it
    const http = providerHttp((_u, key) => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${key}. Yours ends ${key.slice(-12)}` } } }));
    const r = await detect(K.deepseek, realBrains(freshHome(), http));
    expect(r).toMatchObject({ ok: false, code: "refused" });
    if (r.ok) throw new Error("taken");
    expect(r.words).toBe("None of the providers that issue keys like this one took it: DeepSeek (401), Moonshot (Kimi) (401) and OpenAI (401) refused it. It may be mistyped, cut short or revoked. If it is an Alibaba Model Studio (Qwen) key — they look the same — add it under Qwen in Brains, below, with your workspace's base URL. Nothing was saved.");
    expect(r.asked?.map((a) => a.provider)).toEqual(["deepseek", "moonshot", "openai"]);
    keyless(JSON.stringify(r), K.deepseek);
  });

  it("one that cannot be reached ends the asking — the key is not handed to the next while it may be that one's — and says so", async () => {
    const http = providerHttp((u) => (hostIs(u, "api.deepseek.com") ? "slow" : list("kimi-k3")));
    const r = await detect(K.plainSk, realBrains(freshHome(), http));
    expect(r).toMatchObject({ ok: false, code: "unreachable", words: "Could not reach DeepSeek: no answer from api.deepseek.com in time. Check this machine's internet connection and try again. It was not sent on to Moonshot (Kimi) and OpenAI while that is not known. Nothing was saved." });
    expect(http.calls).toHaveLength(1);
    // no answer at all, and a redirect, are said as what they are
    const down = await detect(K.groq, realBrains(freshHome(), providerHttp(() => "down")));
    expect(down).toMatchObject({ ok: false, code: "unreachable", words: expect.stringContaining("Could not reach Groq: no answer from api.groq.com.") });
    const moved = await detect(K.groq, realBrains(freshHome(), providerHttp(() => "redirect")));
    expect(moved).toMatchObject({ ok: false, code: "unreachable", words: expect.stringContaining("api.groq.com answered with a redirect, which the account does not follow") });
  });

  it("a refusal is said in the provider's own words, scrubbed — with what may make sense of it: a restricted OpenAI key, a Google key's project, a Kimi key's region", async () => {
    const said = async (key: string, status: number, message: string) => {
      const r = await detect(key, realBrains(freshHome(), providerHttp(() => ({ status, body: { error: { message } } }))));
      if (r.ok) throw new Error("taken");
      keyless(JSON.stringify(r), key);
      return r.words;
    };
    // OpenAI's own masked echo of the key: the piece that is the key's own ("sk-proj-") masked too
    expect(await said(K.openaiProject, 401, "Incorrect API key provided: sk-proj-********abcd")).toBe("OpenAI refused this key (401): it may be mistyped, cut short or revoked. It said: “Incorrect API key provided: …********abcd.” Nothing was saved.");
    expect(await said(K.openaiProject, 403, "The API credential does not have permission to list models.")).toContain("A 403 can also be a restricted key that may not read the list of models: allow it Models (read) and Model capabilities (write) in its permissions, or make one with All.");
    // xAI and Gemini's layer answer a bad key with a 400 that says so: a refusal, as a 401 is
    expect(await said(K.xai, 400, "Incorrect API key provided. You can obtain an API key from https://console.x.ai.")).toContain("xAI refused this key (400)");
    expect(await said(K.gemini, 400, "Please pass a valid API key")).toContain("Google refused this key (400): it may be mistyped, cut short or revoked. It said: “Please pass a valid API key.” A Google key works for Gemini only when the Generative Language API is on for its project");
    expect(await said(K.geminiAuth, 401, "Request had invalid authentication credentials.")).toContain("Google's newer AI Studio keys (they start AQ.) are turned away by its list of models in October 2026");
    expect(await said(K.meta, 401, "Unauthorized")).toBe("Meta refused this key (401): it may be mistyped, cut short or revoked. It said: “Unauthorized.” Nothing was saved.");
    // a rate limit, a provider in trouble: not a refusal, and nothing sent on
    expect(await said(K.groq, 429, "Rate limit reached")).toBe("Groq answered 429 when asked for its list of models. It said: “Rate limit reached.” It is limiting how often it is asked: try again in a minute. Nothing was saved.");
    expect(await said(K.groq, 503, "Service unavailable")).toContain("It may be having trouble: try again in a few minutes.");
  });

  it("OpenRouter: its list of models is public, so its key endpoint is asked first — a management key refused; Gemini's \"models/\" ids and Together's bare list read as the chat endpoint names them", async () => {
    const or = providerHttp((u, key) => (u.pathname.endsWith("/key") ? (key === K.openrouter ? { status: 200, body: { data: { label: "sk-or-v1-…", is_management_key: false } } } : { status: 401, body: { error: { message: "User not found." } } }) : list("meta/muse-spark-1.3", "openai/gpt-6-astra", "anthropic/claude-opus-5.5")));
    expect(await detect(K.openrouter, realBrains(freshHome(), or))).toMatchObject({ ok: true, provider: "openrouter", model: "openai/gpt-6-astra" });
    expect(or.calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/v1/key", "/api/v1/models"]);
    const mgmt = providerHttp((u) => (u.pathname.endsWith("/key") ? { status: 200, body: { data: { is_management_key: true } } } : list("openai/gpt-6-astra")));
    expect(await detect(K.openrouter, realBrains(freshHome(), mgmt))).toMatchObject({ ok: false, code: "manages", words: "OpenRouter says this is a key that manages an account and cannot run a model. Make a normal API key with OpenRouter and paste that. Nothing was saved." });
    expect(mgmt.calls).toHaveLength(1);
    const old = providerHttp((u) => (u.pathname.endsWith("/key") ? { status: 200, body: { data: { is_provisioning_key: true } } } : list("x")));
    expect(await detect(K.openrouter, realBrains(freshHome(), old))).toMatchObject({ ok: false, code: "manages" });
    const g = providerHttp(() => list("models/gemini-3.8-flash", "models/gemini-4-argon", "models/text-embedding-004"));
    expect(await detect(K.gemini, realBrains(freshHome(), g))).toMatchObject({ ok: true, provider: "gemini", model: "gemini-4-argon", host: "generativelanguage.googleapis.com" });
    expect(g.calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
    const t = providerHttp(() => ({ status: 200, body: [{ id: "zai-org/GLM-5.3", type: "chat" }, { id: "moonshotai/Kimi-K3", type: "chat" }] }));
    expect(await detect(K.together, realBrains(freshHome(), t))).toMatchObject({ ok: true, provider: "together", model: "moonshotai/Kimi-K3", listed: 2 });
  });

  it("xAI: its key endpoint asked first — a key that is blocked, or whose access list allows nothing yet, is said so; one that allows something goes on to the list", async () => {
    const xai = (key: Record<string, unknown>) => providerHttp((u) => (u.pathname.endsWith("/api-key") ? { status: 200, body: key } : list("grok-4.6", "grok-4.7")));
    const empty = xai({ acls: [], api_key_blocked: false, api_key_disabled: false, team_blocked: false });
    expect(await detect(K.xai, realBrains(freshHome(), empty))).toMatchObject({ ok: false, code: "blocked", words: "xAI took the key, but it may call no model yet: its access list allows nothing. At console.x.ai › API Keys, allow it the chat endpoint and the models (or everything), then paste it again. Nothing was saved." });
    expect(empty.calls).toHaveLength(1);
    expect(await detect(K.xai, realBrains(freshHome(), xai({ acls: ["api-key:endpoint:*", "api-key:model:*"], api_key_blocked: true })))).toMatchObject({ ok: false, code: "blocked", words: expect.stringContaining("says the key is blocked or turned off") });
    const fine = xai({ acls: ["api-key:endpoint:*", "api-key:model:*"], api_key_blocked: false, api_key_disabled: false, team_blocked: false });
    expect(await detect(K.xai, realBrains(freshHome(), fine))).toMatchObject({ ok: true, provider: "xai", model: "grok-4.7", host: "api.x.ai" });
    expect(fine.calls.map((c) => c.url)).toEqual(["https://api.x.ai/v1/api-key", "https://api.x.ai/v1/models"]);
  });

  it("Anthropic: a client made for the pasted key alone, at api.anthropic.com — Claude's own models only; an Enterprise admin key or a key across workspaces said so", async () => {
    const claude = claudeHttp((key) => (key === K.anthropic ? { ids: ["claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5"] } : key === K.anthropicEnterprise ? { status: 401, message: "invalid x-api-key" } : { status: 400, message: "anthropic-workspace-id is required when authenticating with an identity-linked API key" }));
    const brains = realBrains(freshHome(), undefined, claude);
    expect(await detect(K.anthropic, brains)).toMatchObject({ ok: true, provider: "claude", label: "Claude · Anthropic API", model: "claude-opus-5-5", modelName: "Claude Opus 5.5", picked: "best", host: "api.anthropic.com" });
    const ent = await detect(K.anthropicEnterprise, brains);
    expect(ent).toMatchObject({ ok: false, code: "refused", words: expect.stringContaining("If it was made in claude.ai's organization settings, it is a Claude Enterprise admin key") });
    const ws = await detect(`sk-ant-${"api03"}-${body(93, 70)}AA`, brains);
    expect(ws).toMatchObject({ ok: false, code: "error", words: expect.stringContaining("make a key for one workspace") });
    expect(claude.made).toEqual([K.anthropic, K.anthropicEnterprise, expect.stringMatching(/^sk-ant-api03-/)]);
    // a key that lists none of the desk's Claude models: no usable model, said with what it does list
    const old = claudeHttp(() => ({ ids: ["claude-3-haiku-20240307"] }));
    expect(await detect(K.anthropic, realBrains(freshHome(), undefined, old))).toMatchObject({ ok: false, code: "no-model", words: "Anthropic took the key, but lists no model the desk can think with — none of Claude Opus 5.5, Claude Sonnet 5.5 and Claude Haiku 5.5, the models the desk thinks with there (it lists claude-3-haiku-20240307). Nothing was saved." });
    // no network, none in time
    expect(await detect(K.anthropic, realBrains(freshHome(), undefined, claudeHttp(() => "slow")))).toMatchObject({ ok: false, code: "unreachable", words: expect.stringContaining("Could not reach Anthropic: no answer from api.anthropic.com in time.") });
  });

  it("a key the provider takes but that lists no model the desk can think with: no usable model, a few of the ids it does list said", async () => {
    const http = providerHttp(() => list("text-embedding-3-small", "whisper-1", "tts-1", "dall-e-3", "omni-moderation-latest"));
    expect(await detect(K.openaiProject, realBrains(freshHome(), http))).toMatchObject({ ok: false, code: "no-model", words: "OpenAI took the key, but lists no model the desk can think with (it lists text-embedding-3-small, whisper-1, tts-1 and 2 more). Nothing was saved." });
    const none = providerHttp(() => list());
    expect(await detect(K.groq, realBrains(freshHome(), none))).toMatchObject({ ok: false, code: "no-model", words: expect.stringContaining("(it lists none)") });
  });

  it("an id that holds a piece of the key is dropped where it is read; a desk that holds none of the brains a key could be for says so, asking no one", async () => {
    const http = providerHttp((_u, key) => list(`ft:${key.slice(10, 30)}`, "gpt-6-luna"));
    const r = await detect(K.openaiProject, realBrains(freshHome(), http));
    expect(r).toMatchObject({ ok: true, model: "gpt-6-luna", listed: 1 });
    keyless(JSON.stringify(r), K.openaiProject);
    const only: Brain[] = [{ id: "scripted", label: "a script", models: [], ready: () => ({ ok: true, model: "x" }), decide: async () => ({ out: null, usage: { inputTokens: 0, outputTokens: 0 } }) }];
    expect(await detect(K.groq, only)).toMatchObject({ ok: false, code: "none-held", words: "This looks like a Groq key, but this account's desk offers no brain for Groq. It was not sent to any provider." });
  });

  it("a probe that throws, or one that says the key back in its words, never puts it in the answer", async () => {
    const leaky: Brain = { id: "groq", label: "Groq", models: [], ready: () => ({ ok: false, model: "", why: "" }), decide: async () => ({ out: null, usage: { inputTokens: 0, outputTokens: 0 } }), probe: async (key: string): Promise<BrainProbe> => ({ outcome: "refused", status: 401, words: `refused ${key}`, said: `bad key ${key.slice(4, 30)}` }) };
    const r = await detect(K.groq, [leaky]);
    keyless(JSON.stringify(r), K.groq);
    const thrower: Brain = { ...leaky, probe: async (key: string) => Promise.reject(new Error(`boom ${key}`)) };
    keyless(JSON.stringify(await detect(K.groq, [thrower])), K.groq);
  });
});

// ---- the route, and the whole of Connect over a real server --------------------------------------------------------------------------

const BTC: Market = { symbol: "BTC/USDT", name: "BTC/USDT", kind: "spot", base: "BTC", quote: "USDT", price: 60_000, bid: 59_990, ask: 60_010, minQty: 0.0001, qtyStep: 0.0001, priceStep: 0.1, open: true, types: ["market", "limit"] };
const trader: LiveTrader = {
  can: true,
  what: "spot",
  markets: async () => [{ ...BTC }],
  market: async (symbol) => (symbol === BTC.symbol ? { ...BTC } : no("E_VENUE_REJECTED", { venue: "ex", message: "no such market" })),
  place: async () => ({ ref: "o-1", status: "open", filledQty: 0, native: {} }) as OrderState,
  cancel: async () => ({ ref: "o-1", status: "canceled", filledQty: 0, native: {} }) as OrderState,
  status: async () => ({ ref: "o-1", status: "open", filledQty: 0, native: {} }) as OrderState,
  positions: async () => [],
};
register({ kind: "standin-brain-detect", label: "a venue for the desk", needs: "key-file", example: "", venues: [], async open(req) {
  return { source: { name: req.label || "Ex", kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [{ asset: "USDT", amount: 5000, usd: 5000 }], trader, readOnlyBecause: "a stand-in moves no money" } as never, first: [{ asset: "USDT", amount: 5000, usd: 5000 }], summary: "connected" };
} });

/** a real account over the stood-in HTTP: every preset's real brain, a desk hired with the script where `hire` says so */
async function boot(o: { http?: ReturnType<typeof providerHttp>; claude?: ReturnType<typeof claudeHttp>; hire?: boolean } = {}) {
  const home = freshHome();
  const http = o.http ?? providerHttp((u, key) => (key.includes(MARK) && hostIs(u, "api.openai.com") ? list("gpt-6-luna", "gpt-6-astra") : { status: 401, body: { error: { message: "Incorrect API key provided" } } }));
  const brains = brainProviders(home, { env: {}, fetch: http.fetch, newClaudeClient: (o.claude ?? claudeHttp(() => ({ status: 401, message: "invalid x-api-key" }))).newClaudeClient });
  const svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PB" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: brains, tickMs: 0, env: {} } });
  await svc.restoring;
  const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  servers.push(srv);
  const own = async (a: NoNonce<OwnerAction>, signer = owner) => svc.exchange(await signOwner(signer, { ...a, nonce: nonce() } as OwnerAction));
  if (o.hire) {
    const c = await own({ type: "connectVenue", venue: "ex", connector: "live:standin-brain-detect", label: "Ex", credentialRef: "" });
    if (isRefusal(c)) throw new Error(c.message);
    const roles: RoleId[] = ["head", "search", "risk", "sniper", "exit"];
    for (const role of roles) {
      const k = svc.desk!.seatKeyOf(role);
      if (isRefusal(k)) throw new Error(k.message);
      const r = await own({ type: "approveAgent", agentAddress: k.address, agentName: `Desk ${role}`, validUntil: Date.now() + 30 * 86_400_000 });
      if (isRefusal(r)) throw new Error(r.message);
      if (ROLE_SPECS[role].trades) await own({ type: "approveSpend", agent: k.address, scope: "trade", allow: "ex", perPayment: "100", budget: "500", windowHours: 0, validUntil: Date.now() + 7 * 86_400_000 });
    }
    // the desk thinks with DeepSeek first (no key yet): Connect then moves it to the key's provider
    const h = await own({ type: "setDesk", desk: "desk", change: "hire", value: JSON.stringify({ name: "Connect desk", objective: { text: "Small entries on majors", venue: "ex", universe: "all", targetPct: 3, maxRiskPct: 1, maxDailyLossPct: 5, hours: 22, everyMin: 15, reportAt: "21:00" }, brain: { provider: "deepseek", model: "deepseek-flash", effort: "low" }, roles: roles.map((role) => ({ role, kind: "house" })) }) });
    if (isRefusal(h)) throw new Error(`hire: ${h.message}`);
  }
  return { home, svc, srv, own, http };
}

/** one request as a page — or a program — sends it */
function send(url: string, path: string, o: { headers?: Record<string, string> | undefined; body?: string | undefined } = {}): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: "POST", headers: { "content-type": "application/json", ...(o.headers ?? {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}
/** the browser's own header, as the page's fetch carries it */
const PAGE = { "sec-fetch-site": "same-origin" };
const checkKey = (url: string, apiKey: string, headers: Record<string, string> = PAGE) => send(url, "/api/account/brain-detect", { body: JSON.stringify({ apiKey }), headers });
const keyFile = (home: string, id: string) => join(home, "credentials", "brains", `${id}.json`);
const ledgerText = (home: string) => readdirSync(join(home, "portfolio")).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(home, "portfolio", f), "utf8")).join("\n");
/** a setBrainKey signed as the page signs it (the key's fingerprint with a fresh salt), the key beside the envelope */
async function signedKey(o: { provider: string; key: string; model: string; signer?: typeof owner }) {
  const salt = newSalt();
  const action: SetBrainKey = { type: "setBrainKey", provider: o.provider, baseUrl: "", model: o.model, keyHash: keyHashOf(salt, o.key), salt, nonce: nonce() };
  const envelope = await signOwner(o.signer ?? owner, action);
  return { action, envelope, body: JSON.stringify({ envelope, apiKey: o.key }) };
}

/** everything said on the console while a test runs */
let said: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  said = [];
  const catchAll = (...args: unknown[]) => void said.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  spies = (["error", "log", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(catchAll));
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
});

describe("POST /api/account/brain-detect", () => {
  it("says whose a key is, the model, the host and the masked tail — never the key back; writes nothing: no key file, nothing in the ledger, the room or the console", async () => {
    const { home, srv, http } = await boot({ hire: true });
    const r = await checkKey(srv.url, K.openaiProject);
    expect(r.status).toBe(200);
    const a = JSON.parse(r.text) as Detected;
    expect(a).toMatchObject({ ok: true, provider: "openai", model: "gpt-6-astra", host: "api.openai.com", tail: `…${K.openaiProject.slice(-4)}`, listed: 2 });
    keyless(r.text, K.openaiProject);
    expect(http.calls.map((c) => c.url)).toEqual(["https://api.openai.com/v1/models"]);
    expect(existsSync(join(home, "credentials", "brains"))).toBe(false);
    for (const text of [ledgerText(home), readFileSync(roomPath(home), "utf8"), readFileSync(deskPath(home), "utf8"), said.join("\n")]) keyless(text, K.openaiProject);
  });

  it("refuses an example key (sk-ant-...), a starred one or a wallet's private key at once — no provider asked — and every answer is a plain sentence without the key", async () => {
    const { srv, http } = await boot();
    for (const [key, code] of [["sk-ant-...", "example"], ["sk-proj-****abcd", "starred"], [`0x${hex(64, 80)}`, "wallet"], [K.anthropicAdmin, "manages"], [K.claudeOauth, "subscription"], [`hello-${body(30, 81)}`, "unrecognised"]] as const) {
      const r = await checkKey(srv.url, key);
      expect(r.status, key.slice(0, 10)).toBe(200);
      expect(JSON.parse(r.text)).toMatchObject({ ok: false, code });
      if (key.length > 12) keyless(r.text, key);
    }
    expect(http.calls).toEqual([]);
  });

  it("asks for a browser's own headers, takes JSON alone (at most 4 KB, {apiKey} and nothing else) and answers what it cannot read with one fixed sentence — never the key, never logged", async () => {
    const { srv, http } = await boot();
    const key = K.openaiProject;
    const bare = await send(srv.url, "/api/account/brain-detect", { body: JSON.stringify({ apiKey: key }) });
    expect(bare.status).toBe(403);
    expect(JSON.parse(bare.text)).toEqual({ ok: false, error: DETECT_BODY_WORDS.browser });
    const text = await send(srv.url, "/api/account/brain-detect", { body: `apiKey=${key}`, headers: { ...PAGE, "content-type": "text/plain" } });
    expect(text.status).toBe(415);
    const big = await send(srv.url, "/api/account/brain-detect", { body: JSON.stringify({ apiKey: key.repeat(40) }), headers: PAGE });
    expect(big.status).toBe(413);
    // unquoted, so that a JSON parser would stop at the key and quote it
    const broken = await send(srv.url, "/api/account/brain-detect", { body: `{"apiKey": ${key}}`, headers: PAGE });
    expect([broken.status, JSON.parse(broken.text)]).toEqual([400, { ok: false, error: DETECT_BODY_WORDS.malformed }]);
    const extra = await send(srv.url, "/api/account/brain-detect", { body: JSON.stringify({ apiKey: key, provider: "openai" }), headers: PAGE });
    expect(extra.status).toBe(400);
    // every spelling express routes to it reads its own body too
    const spelled = await send(srv.url, "/api/account/Brain-Detect/", { body: `{"apiKey": ${key}}`, headers: PAGE });
    expect(spelled.status).toBe(400);
    // another site's page is turned away before its body is read
    const foreign = await send(srv.url, "/api/account/brain-detect", { body: JSON.stringify({ apiKey: key }), headers: { origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    for (const r of [bare, text, big, broken, extra, spelled, foreign]) keyless(r.text, key);
    keyless(said.join("\n"), key);
    expect(http.calls).toEqual([]);
    expect(parseDetectBody(Buffer.from('{"apiKey": 5}'))).toEqual({ ok: false, status: 400, error: DETECT_BODY_WORDS.malformed });
  });

  it("checks one key at a time: a second while the first is out is told to wait (429), and none is held after", async () => {
    const http = providerHttp(() => "hang");
    const { srv } = await boot({ http });
    const first = checkKey(srv.url, K.openaiProject);
    await new Promise((r) => setTimeout(r, 50));
    const second = await checkKey(srv.url, K.groq);
    expect([second.status, JSON.parse(second.text)]).toEqual([429, { ok: false, code: "busy", words: DETECT_BODY_WORDS.busy }]);
    http.release();
    expect((await first).status).toBe(200);
    expect((await checkKey(srv.url, K.openaiProject)).status).toBe(200);
  });
});

describe("Connect, end to end: checked, then saved and switched by the owner's own signatures", () => {
  it("the key the check named is saved by setBrainKey (0600, the model with it, the tail and fingerprint answered) and the desk switched by setDesk — the key in no answer, ledger, room or log", async () => {
    const { home, svc, srv, own } = await boot({ hire: true });
    expect(svc.desk!.catalog().brain.provider).toBe("deepseek");
    const found = JSON.parse((await checkKey(srv.url, K.openaiProject)).text) as Extract<Detected, { ok: true }>;
    const { body: signed, action } = await signedKey({ provider: found.provider, key: K.openaiProject, model: found.model });
    const saved = await send(srv.url, "/api/account/brain-key", { body: signed, headers: PAGE });
    expect(saved.status).toBe(200);
    expect(JSON.parse(saved.text)).toMatchObject({ ok: true, provider: "openai", fingerprint: action.keyHash.slice(0, 8), tail: found.tail, standing: { ok: true, model: "gpt-6-astra" } });
    keyless(saved.text, K.openaiProject);
    expect(JSON.parse(readFileSync(keyFile(home, "openai"), "utf8"))).toEqual({ apiKey: K.openaiProject, model: "gpt-6-astra" });
    expect((statSync(keyFile(home, "openai")).mode & 0o777).toString(8)).toBe("600");
    // the desk switched, by the owner's own signature
    const sw = await own({ type: "setDesk", desk: "desk", change: "brain", value: JSON.stringify({ provider: found.provider, model: found.model, effort: "medium" }) });
    expect(isRefusal(sw)).toBe(false);
    expect(svc.desk!.catalog().brain).toMatchObject({ provider: "openai", model: "gpt-6-astra", ok: true });
    expect(svc.desk!.catalog().brains.find((b) => b.id === "openai")).toMatchObject({ ok: true, tail: found.tail, keyFrom: "file" });
    for (const text of [ledgerText(home), readFileSync(roomPath(home), "utf8"), readFileSync(deskPath(home), "utf8"), said.join("\n")]) keyless(text, K.openaiProject);
    expect(svc.brainKeys.size).toBe(0);
  });

  it("refuses unauthorised writes: a setBrainKey an agent signs, or a key the account does not know — nothing written", async () => {
    const { home, srv, own } = await boot();
    expect(isRefusal(await own({ type: "approveAgent", agentAddress: agent.address, agentName: "Helper", validUntil: Date.now() + 86_400_000 }))).toBe(false);
    const asAgent = await signedKey({ provider: "openai", key: K.openaiProject, model: "gpt-6-astra", signer: agent });
    const a = await send(srv.url, "/api/account/brain-key", { body: asAgent.body, headers: PAGE });
    expect([a.status, JSON.parse(a.text).refusal.code]).toEqual([409, "E_ACCOUNT_OWNER_ONLY"]);
    const asStranger = await signedKey({ provider: "openai", key: K.openaiProject, model: "gpt-6-astra", signer: stranger });
    const s = await send(srv.url, "/api/account/brain-key", { body: asStranger.body, headers: PAGE });
    expect(s.status).toBe(401);
    // and no signature at all: the key alone is not taken
    const none = await send(srv.url, "/api/account/brain-key", { body: JSON.stringify({ apiKey: K.openaiProject }), headers: PAGE });
    expect(none.status).toBe(400);
    expect(existsSync(keyFile(home, "openai"))).toBe(false);
    for (const r of [a, s, none]) keyless(r.text, K.openaiProject);
  });

  it("refuses the example from a how-to at the key's own route too (sk-ant-...): before the door, nothing staged or written, the signature not spent", async () => {
    const { home, svc, srv } = await boot();
    for (const key of ["sk-ant-...", "sk-proj-****abcd", "YOUR_API_KEY"]) {
      const { body: signed, action } = await signedKey({ provider: "claude", key, model: "claude-opus-5-5" });
      expect(checkBeforeDoor(action, key)).toEqual({ status: 400, error: BODY_WORDS.example });
      const r = await send(srv.url, "/api/account/brain-key", { body: signed, headers: PAGE });
      expect([r.status, JSON.parse(r.text)]).toEqual([400, { ok: false, error: BODY_WORDS.example }]);
    }
    expect(existsSync(keyFile(home, "claude"))).toBe(false);
    expect(ledgerText(home)).not.toContain("setBrainKey");
    expect(svc.brainKeys.size).toBe(0);
  });
});
