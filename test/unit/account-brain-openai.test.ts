import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonIn, jsonSchemaOf, OPENAI_KEY_REF, OPENAI_KEY_TEMPLATE, openaiBrain, openaiReach } from "../../src/portfolio/account/brain-openai.ts";
import { DECISIONS, type Brain, type BrainConfig } from "../../src/portfolio/account/desk.ts";

/** THE OPENAI-FORMAT BRAIN (account/brain-openai.ts): any chat-completions endpoint, reached as the owner says (a key file or the
 * environment), asked one structured question with the role's shape as a JSON schema; the request's dialect learned from the endpoint's
 * 400s and kept; every refusal and error in words that never carry the key; a cut-off, refused, filtered or ill-fitting answer is "no
 * decision". Nothing here reaches a network: the endpoint is a stand-in fetch. */

const KEY = "sk-test-not-a-real-key-0123456789abcdef";
const env = {} as NodeJS.ProcessEnv;
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
/** a home with the key file written as given (none: no file) */
const homeWith = (file?: string): string => {
  const home = mkdtempSync(join(tmpdir(), "brain-openai-"));
  homes.push(home);
  if (file !== undefined) {
    mkdirSync(join(home, "credentials", "openai"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, OPENAI_KEY_REF), file, { mode: 0o600 });
  }
  return home;
};
const DEEPSEEK = JSON.stringify({ apiKey: KEY, baseUrl: "https://api.deepseek.com/v1/", model: "deepseek-chat" });
const OPENAI = JSON.stringify({ apiKey: KEY });

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
/** a stand-in endpoint: answers in turn, each a status and a JSON body; every request recorded */
function endpoint(answers: Array<{ status: number; body: unknown }>, o: { throws?: Error | undefined } = {}) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url: String(url), headers, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    if (o.throws) throw o.throws;
    const a = answers.shift() ?? { status: 500, body: { error: { message: "no answer scripted" } } };
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const RISK = { verdict: "clear", why: "a tight spread", sizeUsd: 40, tpPct: 2, slPct: 1, maxHours: 12 };
const answer = (content: unknown, o: { finish?: string | undefined; usage?: Record<string, unknown> | undefined; message?: Record<string, unknown> | undefined } = {}) => ({ status: 200, body: { choices: [{ message: { content: typeof content === "string" || Array.isArray(content) ? content : JSON.stringify(content), ...(o.message ?? {}) }, finish_reason: o.finish ?? "stop" }], usage: o.usage ?? { prompt_tokens: 120, completion_tokens: 30 } } });
const err = (status: number, message: string) => ({ status, body: { error: { message, type: "invalid_request_error" } } });
const cfg = (model = "deepseek-chat", effort: BrainConfig["effort"] = "medium"): BrainConfig => ({ provider: "openai", model, effort });
const ask = (b: Brain, brain: BrainConfig = cfg()) => b.decide({ role: "risk", brain, system: "You are RISK.", input: "BTC/USDT · spread 0.02%", schema: DECISIONS.RiskOut, maxTokens: 512 });

describe("how the brain reaches the endpoint", () => {
  it("no file, the example left in it, a file it cannot use, a bad base URL, a key — and never a value; the environment too", () => {
    const none = homeWith();
    const file = join(none, OPENAI_KEY_REF);
    // no file: the fix makes it with the EMPTY template, readable by the user alone, and opens it — a command that runs as written, with no
    // value in it to replace first; the environment is mentioned only for an account started by hand
    const missing = openaiReach({ home: none, env, platform: "darwin" });
    expect(missing).toMatchObject({ ok: false, why: expect.stringMatching(/^no key: the brain reads a key for an OpenAI-format endpoint from .*api-key\.json, which is not there yet; .*no restart needed \(if you start the account by hand, OPENAI_API_KEY/) });
    expect(!missing.ok && missing.fix).toEqual({ code: "no-key", file, restart: false, words: expect.stringMatching(/^Run the command below: it makes the key file, readable by you alone, and opens it\. .* no restart\.$/), command: `mkdir -p '${join(none, "credentials", "openai")}' && (umask 077 && printf '${OPENAI_KEY_TEMPLATE}\\n' > '${file}') && open -e '${file}'` });
    expect(OPENAI_KEY_TEMPLATE).toBe('{"apiKey": "", "baseUrl": "https://api.openai.com/v1", "model": ""}');
    // elsewhere than a Mac: the owner's editor
    const linux = openaiReach({ home: none, env, platform: "linux" });
    expect(!linux.ok && linux.fix.command).toMatch(/ && \$\{EDITOR:-nano\} '.*api-key\.json'$/);
    // the template as it was made, still empty: the example, opened again
    const template = homeWith(OPENAI_KEY_TEMPLATE);
    const empty = openaiReach({ home: template, env, platform: "darwin" });
    expect(empty).toMatchObject({ ok: false, why: expect.stringMatching(/api-key\.json holds the example, not a key: .* no restart needed/), fix: { code: "example", command: `open -e '${join(template, OPENAI_KEY_REF)}'`, restart: false } });
    const example = homeWith('{"apiKey": "sk-…", "baseUrl": "https://api.openai.com/v1", "model": "<the model, as the endpoint names it>"}');
    expect(openaiReach({ home: example, env })).toMatchObject({ ok: false, why: expect.stringMatching(/api-key\.json holds the example, not a key: .* no restart needed/), fix: { code: "example" } });
    // a real key with the old how-to's placeholder model: the model is the example, never sent as a model's name — even beside the form's
    const placeholder = homeWith(JSON.stringify({ apiKey: KEY, model: "<the model, as the endpoint names it>" }));
    expect(openaiReach({ home: placeholder, env })).toMatchObject({ ok: false, why: expect.stringMatching(/^the key file's model is the example: name the model's name as the endpoint names it/), fix: { code: "example" } });
    expect(openaiReach({ home: placeholder, env }, "gpt-5")).toMatchObject({ ok: false, fix: { code: "example" } });
    const noField = homeWith('{"secret": "x"}');
    expect(openaiReach({ home: noField, env, platform: "darwin" })).toMatchObject({ ok: false, why: expect.stringMatching(/^the key file cannot be used: .*missing "apiKey"/), fix: { code: "unusable", command: expect.stringMatching(/^open -e '/), restart: false } });
    const ftp = homeWith(JSON.stringify({ apiKey: KEY, baseUrl: "ftp://x" }));
    expect(openaiReach({ home: ftp, env })).toMatchObject({ ok: false, why: expect.stringMatching(/^"baseUrl" in .* is not an http\(s\) URL/) });
    const query = homeWith(JSON.stringify({ apiKey: KEY, baseUrl: "https://x.example/v1?k=1" }));
    expect(openaiReach({ home: query, env })).toMatchObject({ ok: false, why: expect.stringMatching(/without a query/) });
    const deepseek = homeWith(DEEPSEEK);
    const r = openaiReach({ home: deepseek, env });
    expect(r).toMatchObject({ ok: true, how: "the key file credentials/openai/api-key.json · api.deepseek.com", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" });
    const b = openaiBrain({ home: deepseek, env });
    expect(b.id).toBe("openai");
    expect(b.models).toEqual([]);
    expect(b.ready()).toEqual({ ok: true, model: "deepseek-chat", how: "the key file credentials/openai/api-key.json · api.deepseek.com" });
    expect(JSON.stringify(b.ready())).not.toContain(KEY);
    // OpenAI's own, by default: the file's base URL left out. A file that names no model is ready only beside a desk whose form names one
    expect(openaiReach({ home: homeWith(OPENAI), env }, "gpt-5")).toMatchObject({ ok: true, baseUrl: "https://api.openai.com/v1", model: "gpt-5", how: expect.stringMatching(/· api.openai.com$/) });
    expect(openaiBrain({ home: homeWith(OPENAI), env }).ready("gpt-5")).toMatchObject({ ok: true, model: "gpt-5" });
    expect(openaiBrain({ home: homeWith(OPENAI), env }).ready()).toMatchObject({ ok: false, fix: { code: "example" } });
    chmodSync(join(deepseek, OPENAI_KEY_REF), 0o644);
    const loose = openaiReach({ home: deepseek, env });
    expect(loose).toMatchObject({ ok: false, why: expect.stringMatching(/^the key file cannot be used: .*chmod 600/), fix: { code: "unusable", command: `chmod 600 '${join(deepseek, OPENAI_KEY_REF)}'`, restart: false } });
    expect(JSON.stringify(loose)).not.toContain(KEY);
    // the environment: the example refused, a key taken with its base URL and model, a local endpoint allowed
    const envExample = openaiReach({ home: none, env: { OPENAI_API_KEY: "sk-..." } as NodeJS.ProcessEnv });
    expect(envExample).toMatchObject({ ok: false, why: expect.stringMatching(/^OPENAI_API_KEY .* not a key/), fix: { code: "env", file, restart: true } });
    // no command fixes the environment from here: it is set where the service is started
    expect(!envExample.ok && envExample.fix.command).toBeUndefined();
    expect(openaiReach({ home: none, env: { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: "http://localhost:11434/v1", OPENAI_MODEL: "qwen3:8b" } as NodeJS.ProcessEnv })).toMatchObject({ ok: true, how: "OPENAI_API_KEY in the service's environment · localhost:11434", baseUrl: "http://localhost:11434/v1", model: "qwen3:8b" });
    expect(openaiReach({ home: none, env: { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: "not a url" } as NodeJS.ProcessEnv })).toMatchObject({ ok: false, why: expect.stringMatching(/^OPENAI_BASE_URL in the service's environment is not a URL/) });
  });
});

describe("the question, asked", () => {
  it("at OpenAI's own endpoint: the key as a bearer, max_completion_tokens with room to reason, the effort, the shape as a strict JSON schema; the answer checked and counted", async () => {
    const ep = endpoint([answer(RISK)]);
    const b = openaiBrain({ home: homeWith(OPENAI), env, fetch: ep.fetch });
    const a = await ask(b, cfg("gpt-5", "high"));
    expect(a).toEqual({ out: RISK, usage: { inputTokens: 120, outputTokens: 30 } });
    expect(ep.calls).toHaveLength(1);
    const c = ep.calls[0]!;
    expect(c.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(c.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(c.body.model).toBe("gpt-5");
    expect(c.body.max_completion_tokens).toBe(512 + 8192);
    expect(c.body.max_tokens).toBeUndefined();
    expect(c.body.reasoning_effort).toBe("high");
    const rf = c.body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema.additionalProperties).toBe(false);
    expect(rf.json_schema.schema.required).toEqual(["verdict", "why", "sizeUsd", "tpPct", "slPct", "maxHours"]);
    expect(rf.json_schema.schema.$schema).toBeUndefined();
    const msgs = c.body.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toMatchObject({ role: "system", content: expect.stringMatching(/^You are RISK\.\nAnswer with one JSON object and nothing else, in this shape: \{/) });
    expect(msgs[1]).toEqual({ role: "user", content: "BTC/USDT · spread 0.02%" });
  });

  it("elsewhere: max_tokens first; a 400 naming a field changes that field and asks again, the dialect it lands on kept for the next question", async () => {
    const ep = endpoint([err(400, "Unrecognized request argument supplied: reasoning_effort"), err(400, "response_format of type json_schema is not supported"), answer(RISK), answer(RISK)]);
    const b = openaiBrain({ home: homeWith(DEEPSEEK), env, fetch: ep.fetch });
    const a = await ask(b);
    expect(a.out).toEqual(RISK);
    expect(ep.calls).toHaveLength(3);
    expect(ep.calls[0]!.body).toMatchObject({ model: "deepseek-chat", max_tokens: 512 + 8192, reasoning_effort: "medium", response_format: { type: "json_schema" } });
    expect(ep.calls[1]!.body).toMatchObject({ max_tokens: 512, response_format: { type: "json_schema" } });
    expect(ep.calls[1]!.body.reasoning_effort).toBeUndefined();
    expect(ep.calls[2]!.body).toMatchObject({ max_tokens: 512, response_format: { type: "json_object" } });
    expect(ep.calls[2]!.body.reasoning_effort).toBeUndefined();
    // the next question goes straight in the learned dialect
    await ask(b);
    expect(ep.calls).toHaveLength(4);
    expect(ep.calls[3]!.body).toMatchObject({ max_tokens: 512, response_format: { type: "json_object" } });
    expect(ep.calls[3]!.body.reasoning_effort).toBeUndefined();
    // "Use max_completion_tokens instead" names the limit's field
    const ep2 = endpoint([err(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."), answer(RISK)]);
    const b2 = openaiBrain({ home: homeWith(DEEPSEEK), env, fetch: ep2.fetch });
    expect((await ask(b2)).out).toEqual(RISK);
    expect(ep2.calls[1]!.body.max_completion_tokens).toBe(512 + 8192);
    expect(ep2.calls[1]!.body.max_tokens).toBeUndefined();
  });

  it("a 400 naming nothing tries each field once, then gives the endpoint's words; the model, the key, the balance, the rate, the path, the server, the network — each said, the key never", async () => {
    const dead = endpoint([err(400, "Model Not Exist"), err(400, "Model Not Exist"), err(400, "Model Not Exist"), err(400, "Model Not Exist")]);
    const b = openaiBrain({ home: homeWith(DEEPSEEK), env, fetch: dead.fetch });
    await expect(ask(b)).rejects.toThrow("the endpoint api.deepseek.com answered 400: Model Not Exist");
    expect(dead.calls).toHaveLength(4);
    const at = (answers: Array<{ status: number; body: unknown }>) => ask(openaiBrain({ home: homeWith(OPENAI), env, fetch: endpoint(answers).fetch }));
    await expect(at([err(401, `Incorrect API key provided: ${KEY}. You can find your API key at…`)])).rejects.toThrow(/^the endpoint api.openai.com did not accept the key$/);
    // a refused key is its own kind: the desk keeps it as the brain's standing, with the fix (the file opened again, no restart)
    const refused = await at([err(401, "Incorrect API key provided")]).catch((e: unknown) => e as { code?: string; who?: string; fix?: { code: string; restart: boolean; command?: string } });
    expect(refused).toMatchObject({ code: "E_BRAIN_KEY_REJECTED", who: "api.openai.com", fix: { code: "rejected", restart: false, command: expect.stringMatching(/api-key\.json'$/) } });
    await expect(at([err(402, "Insufficient Balance")])).rejects.toThrow("the endpoint api.openai.com says the balance is out: Insufficient Balance");
    await expect(at([err(404, `The model \`deepseek-chat\` does not exist`)])).rejects.toThrow('nothing answers at api.openai.com/chat/completions for "deepseek-chat": the base URL\'s path, or the model\'s name: The model `deepseek-chat` does not exist');
    await expect(at([err(429, "Rate limit reached")])).rejects.toThrow("the endpoint api.openai.com is rate-limiting this key: Rate limit reached — it is asked again next cycle");
    await expect(at([err(503, "Service Unavailable")])).rejects.toThrow("the endpoint api.openai.com answered 503: Service Unavailable");
    await expect(at([{ status: 502, body: "<html>bad gateway</html>" }])).rejects.toThrow("the endpoint api.openai.com answered 502");
    // an endpoint that echoes the key back in an error: masked
    await expect(at([err(500, `boom ${KEY} boom sk-abc123456789 key_abcdefgh`)])).rejects.toThrow("the endpoint api.openai.com answered 500: boom … boom sk-… key-…");
    const down = endpoint([], { throws: Object.assign(new Error("fetch failed"), { name: "TypeError" }) });
    await expect(ask(openaiBrain({ home: homeWith(DEEPSEEK), env, fetch: down.fetch }))).rejects.toThrow("the endpoint api.deepseek.com could not be reached");
    const slow = endpoint([], { throws: Object.assign(new Error("timeout"), { name: "TimeoutError" }) });
    await expect(ask(openaiBrain({ home: homeWith(DEEPSEEK), env, fetch: slow.fetch }))).rejects.toThrow("the endpoint api.deepseek.com could not be reached in time");
  });

  it("no decision, said so: cut off, refused, filtered, not JSON, the wrong shape; JSON in a fence or in prose or in parts is read; no key and no model are no decision too", async () => {
    const at = (a: { status: number; body: unknown }, brain = cfg()) => ask(openaiBrain({ home: homeWith(DEEPSEEK), env, fetch: endpoint([a]).fetch }), brain);
    expect(await at(answer("", { finish: "length" }))).toMatchObject({ out: null, why: "the answer ran past its token limit" });
    expect(await at(answer(null, { message: { refusal: "I cannot help with that." } }))).toMatchObject({ out: null, why: "the model declined to answer: I cannot help with that." });
    expect(await at(answer("", { finish: "content_filter" }))).toMatchObject({ out: null, why: "the endpoint's content filter stopped the answer" });
    expect(await at(answer("Sure! Here is my view: it is tight."))).toMatchObject({ out: null, why: "the answer was not JSON" });
    expect(await at(answer({ verdict: "maybe" }))).toMatchObject({ out: null, why: "the answer did not fit the shape asked for" });
    expect(await at({ status: 200, body: { choices: [] } })).toMatchObject({ out: null, why: "the endpoint answered without a choice", usage: { inputTokens: 0, outputTokens: 0 } });
    expect((await at(answer("```json\n" + JSON.stringify(RISK) + "\n```"))).out).toEqual(RISK);
    expect((await at(answer("Here you go: " + JSON.stringify(RISK) + " — done."))).out).toEqual(RISK);
    expect((await at(answer([{ type: "text", text: JSON.stringify(RISK).slice(0, 20) }, { type: "text", text: JSON.stringify(RISK).slice(20) }]))).out).toEqual(RISK);
    const usage = (await at(answer(RISK, { usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 900 } } }))).usage;
    expect(usage).toEqual({ inputTokens: 1000, outputTokens: 50 });
    // no model named anywhere (the file's, the form's): the file's model is the example, and no request goes out
    const ep = endpoint([answer(RISK)]);
    expect(await ask(openaiBrain({ home: homeWith(OPENAI), env, fetch: ep.fetch }), cfg(""))).toMatchObject({ out: null, why: expect.stringMatching(/^the key file's model is the example/) });
    expect(ep.calls).toHaveLength(0);
    // the environment with no model and a form that names none: no model is named
    const epEnv = endpoint([answer(RISK)]);
    expect(await ask(openaiBrain({ home: homeWith(), env: { OPENAI_API_KEY: KEY } as NodeJS.ProcessEnv, fetch: epEnv.fetch }), cfg(""))).toMatchObject({ out: null, why: expect.stringMatching(/^no model is named/) });
    expect(epEnv.calls).toHaveLength(0);
    // the file's model stands in for a blank one on the form
    const ep2 = endpoint([answer(RISK)]);
    expect((await ask(openaiBrain({ home: homeWith(DEEPSEEK), env, fetch: ep2.fetch }), cfg(""))).out).toEqual(RISK);
    expect(ep2.calls[0]!.body.model).toBe("deepseek-chat");
    // no key: no request either
    const ep3 = endpoint([answer(RISK)]);
    expect(await ask(openaiBrain({ home: homeWith(), env, fetch: ep3.fetch }))).toMatchObject({ out: null, why: expect.stringMatching(/^no key/) });
    expect(ep3.calls).toHaveLength(0);
  });

  it("the shape as a JSON schema: strict when every property is required, bounds dropped (the zod shape checks them), nothing of zod's own", () => {
    for (const s of Object.values(DECISIONS)) {
      const { schema, strict } = jsonSchemaOf(s);
      expect(strict).toBe(true);
      expect(schema.$schema).toBeUndefined();
      expect(schema.additionalProperties).toBe(false);
    }
    const loose = jsonSchemaOf(z.object({ a: z.string().optional(), n: z.number().min(0).max(1), list: z.array(z.string()).min(1) }));
    expect(loose.strict).toBe(false);
    expect(JSON.stringify(loose.schema)).not.toMatch(/minimum|maximum|minItems/);
    expect(jsonIn('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(jsonIn('text {"a": {"b": 2}} more')).toEqual({ a: { b: 2 } });
    expect(jsonIn("nothing here")).toBeUndefined();
  });
});
