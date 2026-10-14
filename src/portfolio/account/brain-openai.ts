/** AN OPENAI-FORMAT BRAIN: any endpoint that speaks OpenAI's chat-completions format — OpenAI itself, DeepSeek, Moonshot, Qwen, xAI,
 * OpenRouter, a vLLM or Ollama on this machine — asked the one structured question at a time the desk asks (desk.ts), the same as the
 * Claude brain (brain-claude.ts). The owner says where and with what: OPENAI_API_KEY (with OPENAI_BASE_URL and OPENAI_MODEL) in the
 * service's environment, or the key file <home>/credentials/openai/api-key.json — {"apiKey": "…", "baseUrl": "…/v1", "model": "…"} —
 * readable by the user alone, read again at every check. The base URL defaults to OpenAI's; the model on the hire form wins over the
 * file's; the price is the owner's number on the form (no list of other people's prices is kept here: the tokens are counted either way).
 *
 * Endpoints differ in what they take: OpenAI's own wants max_completion_tokens and takes reasoning_effort and a JSON schema; many others
 * know only max_tokens, or json_object. The brain starts from what the base URL suggests and, when the endpoint answers 400, changes the
 * field the answer names (unnamed: the next untried one) and asks again — three tries at most, nothing billed for a refused request, and
 * the dialect that worked is kept for the next question. The answer is checked against the role's shape (zod); a cut-off answer, a content
 * filter, a refusal or JSON that does not fit is "no decision", said so. A key the endpoint rejects, an out balance, a rate limit, a model
 * it does not serve or an endpoint that cannot be reached is an error the desk writes in its room — the endpoint's own words, never the key.
 */
import { join } from "node:path";
import { z } from "zod";
import { isRefusal } from "../../core/errors.ts";
import { loadKeyFile, type KeyShape } from "../live/credentials.ts";
import type { Brain, BrainAnswer, BrainRequest, BrainStatus } from "./desk.ts";

export const OPENAI_KEY_REF = "credentials/openai/api-key.json";
export const OPENAI_KEY_SHAPE: KeyShape = { required: ["apiKey"], optional: ["baseUrl", "model"], example: '{"apiKey": "sk-…", "baseUrl": "https://api.openai.com/v1", "model": "<the model, as the endpoint names it>"}' };
export const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
export const OPENAI_LABEL = "OpenAI-format endpoint";
/** a reasoning model thinks inside the completion limit: this much room above the answer's own */
const REASONING_ROOM = 8192;

export interface OpenAIBrainOptions {
  home: string;
  env?: NodeJS.ProcessEnv | undefined;
  /** fetch, for tests */
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

export type OpenAIReach = { ok: true; how: string; apiKey: string; baseUrl: string; model: string } | { ok: false; why: string };

/** could be a key: not the example from the how-to, not a fragment — a local endpoint may take any word, so nothing more is assumed */
const looksLikeKey = (k: string): boolean => k.length >= 8 && !/[\s…]|\.\.\./.test(k);

const baseOf = (s: string | undefined): { ok: true; url: string } | { ok: false; why: string } => {
  const raw = (s ?? "").trim() || OPENAI_DEFAULT_BASE;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, why: `is not a URL: "${raw.slice(0, 80)}"` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, why: `is not an http(s) URL: "${raw.slice(0, 80)}"` };
  if (u.search || u.hash) return { ok: false, why: "is the endpoint's base (…/v1), without a query" };
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
};
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** how the brain would reach the endpoint now, without reaching it */
export function openaiReach(o: OpenAIBrainOptions): OpenAIReach {
  const env = o.env ?? process.env;
  if (env.OPENAI_API_KEY) {
    if (!looksLikeKey(env.OPENAI_API_KEY)) return { ok: false, why: "OPENAI_API_KEY in the service's environment is the example or a fragment, not a key: set the key itself and restart the service" };
    const base = baseOf(env.OPENAI_BASE_URL);
    if (!base.ok) return { ok: false, why: `OPENAI_BASE_URL in the service's environment ${base.why}` };
    return { ok: true, how: `OPENAI_API_KEY in the service's environment · ${hostOf(base.url)}`, apiKey: env.OPENAI_API_KEY, baseUrl: base.url, model: (env.OPENAI_MODEL ?? "").trim() };
  }
  const where = join(o.home, OPENAI_KEY_REF);
  const file = loadKeyFile(o.home, OPENAI_KEY_REF, OPENAI_KEY_SHAPE, "openai");
  if (!isRefusal(file)) {
    const apiKey = file.apiKey ?? "";
    if (!looksLikeKey(apiKey)) return { ok: false, why: `${where} holds the example, not a key: put your key there as ${OPENAI_KEY_SHAPE.example} — the file is read again at every check, no restart needed` };
    const base = baseOf(file.baseUrl);
    if (!base.ok) return { ok: false, why: `"baseUrl" in ${where} ${base.why}` };
    return { ok: true, how: `the key file ${OPENAI_KEY_REF} · ${hostOf(base.url)}`, apiKey, baseUrl: base.url, model: (file.model ?? "").trim() };
  }
  // the file is there but cannot be used (its mode, not JSON, no "apiKey"): its own reason — which names no value from it
  if (!file.detail?.expected) return { ok: false, why: `the key file cannot be used: ${file.message}` };
  return { ok: false, why: `no key: put a key for an OpenAI-format endpoint in ${where} as ${OPENAI_KEY_SHAPE.example} (chmod 600), or start the service with OPENAI_API_KEY (and OPENAI_BASE_URL, OPENAI_MODEL) set` };
}

// ---- the request's dialect, learned from the endpoint's answers -------------------------------------------------------------------

interface Dialect {
  limit: "max_completion_tokens" | "max_tokens";
  effort: boolean;
  json: "schema" | "object";
}
const KNOBS = ["effort", "limit", "json"] as const;
type Knob = (typeof KNOBS)[number];

const guessDialect = (baseUrl: string): Dialect => ({ limit: hostOf(baseUrl) === "api.openai.com" ? "max_completion_tokens" : "max_tokens", effort: true, json: "schema" });
/** which of the fields a 400 names — the one to change */
const knobNamed = (message: string): Knob | undefined => {
  const m = message.toLowerCase();
  if (/reasoning_effort|reasoning\.effort|\beffort\b/.test(m)) return "effort";
  if (/max_completion_tokens|max_tokens/.test(m)) return "limit";
  if (/response_format|json_schema|json schema|\bschema\b|json_object/.test(m)) return "json";
  return undefined;
};
const flip = (d: Dialect, k: Knob): Dialect => (k === "effort" ? { ...d, effort: !d.effort } : k === "limit" ? { ...d, limit: d.limit === "max_tokens" ? "max_completion_tokens" : "max_tokens" } : { ...d, json: d.json === "schema" ? "object" : "schema" });

/** the role's shape as a JSON schema the endpoint can hold the answer to. OpenAI's strict mode wants every property required and no
 * additional ones, and knows no bounds (minimum, pattern…): the bounds are dropped here — the answer is checked against the zod shape
 * anyway — and strict is asked only when every property is required */
export function jsonSchemaOf(schema: z.ZodType): { schema: Record<string, unknown>; strict: boolean } {
  const js = z.toJSONSchema(schema as z.ZodType, { unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  let strict = true;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return void n.forEach(walk);
    const o = n as Record<string, unknown>;
    for (const k of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "multipleOf"]) delete o[k];
    if (o.type === "object" && o.properties && typeof o.properties === "object") {
      const keys = Object.keys(o.properties as object);
      const req = Array.isArray(o.required) ? (o.required as unknown[]) : [];
      if (keys.some((k) => !req.includes(k))) strict = false;
      o.additionalProperties = false;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(js);
  return { schema: js, strict };
}

const ZERO = { inputTokens: 0, outputTokens: 0 };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const plain = (s: string): string => s.replace(/\s+/g, " ").trim();
/** the endpoint's words, with anything key-shaped masked (an endpoint may echo part of a key back) */
const scrubbed = (s: string, apiKey: string): string => plain(s).split(apiKey).join("…").replace(/\b(sk|key|token)[-_][A-Za-z0-9*_-]{6,}/gi, "$1-…");
/** the JSON object in an answer: as it is, or inside a ``` fence, or the first { … last } */
export const jsonIn = (text: string): unknown => {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    /* not whole JSON */
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {
      /* not JSON either */
    }
  }
  return undefined;
};

interface Answered {
  status: number;
  json: unknown;
  message: string;
}

export function openaiBrain(o: OpenAIBrainOptions): Brain {
  let dialect: Dialect | undefined;
  let dialectAt = "";
  const post = async (reach: Extract<OpenAIReach, { ok: true }>, body: Record<string, unknown>): Promise<Answered> => {
    const f = o.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${reach.baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${reach.apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? 120_000) });
    } catch (err) {
      throw new Error(`the endpoint ${hostOf(reach.baseUrl)} could not be reached${(err as Error)?.name === "TimeoutError" ? " in time" : ""}`);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const e = (json && typeof json === "object" ? (json as { error?: unknown }).error : undefined) as { message?: unknown } | string | undefined;
    const raw = typeof e === "string" ? e : e && typeof e === "object" && typeof e.message === "string" ? e.message : res.ok ? "" : text;
    return { status: res.status, json, message: scrubbed(raw, reach.apiKey).slice(0, 160) };
  };
  const wordsFor = (r: Answered, reach: Extract<OpenAIReach, { ok: true }>, model: string): string => {
    const host = hostOf(reach.baseUrl);
    const said = r.message ? `: ${r.message}` : "";
    if (r.status === 401 || r.status === 403) return `the endpoint ${host} did not accept the key`;
    if (r.status === 402) return `the endpoint ${host} says the balance is out${said}`;
    if (r.status === 404) return `nothing answers at ${host}/chat/completions for "${model}": the base URL's path, or the model's name${said}`;
    if (r.status === 429) return `the endpoint ${host} is rate-limiting this key${said} — it is asked again next cycle`;
    return `the endpoint ${host} answered ${r.status}${said}`;
  };
  const read = <T>(j: unknown, schema: z.ZodType<T>): BrainAnswer<T> => {
    const a = (j && typeof j === "object" ? j : {}) as { choices?: Array<{ message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    const usage = { inputTokens: num(a.usage?.prompt_tokens), outputTokens: num(a.usage?.completion_tokens) };
    const c = Array.isArray(a.choices) ? a.choices[0] : undefined;
    if (!c) return { out: null, why: "the endpoint answered without a choice", usage };
    const m = c.message ?? {};
    if (typeof m.refusal === "string" && m.refusal) return { out: null, why: `the model declined to answer: ${plain(m.refusal).slice(0, 160)}`, usage };
    if (c.finish_reason === "length") return { out: null, why: "the answer ran past its token limit", usage };
    if (c.finish_reason === "content_filter") return { out: null, why: "the endpoint's content filter stopped the answer", usage };
    const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("") : "";
    const raw = jsonIn(text);
    if (raw === undefined) return { out: null, why: "the answer was not JSON", usage };
    const parsed = schema.safeParse(raw);
    return parsed.success ? { out: parsed.data, usage } : { out: null, why: "the answer did not fit the shape asked for", usage };
  };
  return {
    id: "openai",
    label: OPENAI_LABEL,
    models: [],
    ready(): BrainStatus {
      const r = openaiReach(o);
      return r.ok ? { ok: true, model: r.model, how: r.how } : { ok: false, model: "", why: r.why };
    },
    async decide<T>(req: BrainRequest<T>): Promise<BrainAnswer<T>> {
      const reach = openaiReach(o);
      if (!reach.ok) return { out: null, why: reach.why, usage: ZERO };
      const model = req.brain.model.trim() || reach.model;
      if (!model) return { out: null, why: 'no model is named: the model on the hire form, or "model" in the key file', usage: ZERO };
      if (dialectAt !== reach.baseUrl) {
        dialect = undefined;
        dialectAt = reach.baseUrl;
      }
      const { schema, strict } = jsonSchemaOf(req.schema);
      const system = `${req.system}\nAnswer with one JSON object and nothing else, in this shape: ${JSON.stringify(schema)}`;
      const limit = req.maxTokens ?? 1024;
      let d = dialect ?? guessDialect(reach.baseUrl);
      const tried = new Set<Knob>();
      for (;;) {
        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: req.input },
          ],
          [d.limit]: d.effort ? limit + REASONING_ROOM : limit,
          ...(d.effort ? { reasoning_effort: req.brain.effort } : {}),
          response_format: d.json === "schema" ? { type: "json_schema", json_schema: { name: "decision", schema, strict } } : { type: "json_object" },
        };
        const r = await post(reach, body);
        if (r.status === 400 && tried.size < KNOBS.length) {
          const named = knobNamed(r.message);
          const k = named && !tried.has(named) ? named : KNOBS.find((x) => !tried.has(x));
          if (k) {
            tried.add(k);
            d = flip(d, k);
            continue;
          }
        }
        if (r.status < 200 || r.status >= 300) throw new Error(wordsFor(r, reach, model));
        dialect = d;
        return read(r.json, req.schema);
      }
    },
  };
}
