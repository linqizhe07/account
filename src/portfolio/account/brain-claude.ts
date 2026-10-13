/** THE HOUSE BRAIN: a Claude model through the Anthropic API, asked one structured question at a time by the desk (desk.ts). It reaches the
 * API the way the owner lets it: ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the service's environment, an `ant auth login` profile the
 * SDK finds by itself, or a key file in the home — <home>/credentials/anthropic/api-key.json, {"apiKey": "…"}, readable by the user
 * alone — which is how every other secret reaches this account (live/credentials.ts). Without any of them — or with a file that still
 * holds the example instead of a key — it is not ready, and says what would make it so; it never pretends to think.
 *
 * Each question is one request: a system prompt (the role and its charter), the data as text, and the answer constrained to the role's
 * JSON shape (structured outputs). Thinking is the model's own (adaptive, the default on these models); the depth is the desk's effort
 * setting. A decline (stop reason `refusal`), an answer cut by the token limit, or one that does not fit the shape is "no decision", said
 * so; a key the API rejects, a rate limit or an unreachable API is an error the desk writes in its room. The API's own token counts come
 * back with every answer, so the desk's cost line is counted, not guessed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { join } from "node:path";
import { isRefusal } from "../../core/errors.ts";
import { loadKeyFile, type KeyShape } from "../live/credentials.ts";
import { BRAIN_MODELS, DEFAULT_BRAIN, type Brain, type BrainAnswer, type BrainRequest, type BrainStatus } from "./desk.ts";

export const ANTHROPIC_KEY_REF = "credentials/anthropic/api-key.json";
export const ANTHROPIC_KEY_SHAPE: KeyShape = { required: ["apiKey"], example: '{"apiKey": "sk-ant-…"}' };

export interface ClaudeBrainOptions {
  home: string;
  env?: NodeJS.ProcessEnv | undefined;
  /** the SDK's client, for tests (a fake that answers parse()) */
  client?: Pick<Anthropic, "messages"> | undefined;
}

/** could be a key: not the example from the how-to, not a fragment of one — whether the API accepts it, only the API says */
const looksLikeKey = (k: string): boolean => k.length >= 20 && !/[\s…]|\.\.\./.test(k);

/** how the brain would reach the API now, without reaching it */
export function brainReach(o: ClaudeBrainOptions): { ok: true; how: string; apiKey?: string | undefined } | { ok: false; why: string } {
  const env = o.env ?? process.env;
  if (o.client) return { ok: true, how: "a client given to it" };
  if (env.ANTHROPIC_API_KEY) {
    if (!looksLikeKey(env.ANTHROPIC_API_KEY)) return { ok: false, why: "ANTHROPIC_API_KEY in the service's environment is the example or a fragment, not a key: set the key itself and restart the service" };
    return { ok: true, how: "ANTHROPIC_API_KEY in the service's environment" };
  }
  if (env.ANTHROPIC_AUTH_TOKEN) return { ok: true, how: "ANTHROPIC_AUTH_TOKEN in the service's environment" };
  const where = join(o.home, ANTHROPIC_KEY_REF);
  const file = loadKeyFile(o.home, ANTHROPIC_KEY_REF, ANTHROPIC_KEY_SHAPE, "anthropic");
  if (!isRefusal(file)) {
    if (!looksLikeKey(file.apiKey ?? "")) return { ok: false, why: `${where} holds the example, not a key: put your key there as ${ANTHROPIC_KEY_SHAPE.example} — the file is read again at every check, no restart needed` };
    return { ok: true, how: `the key file ${ANTHROPIC_KEY_REF}`, apiKey: file.apiKey };
  }
  // the file is there but cannot be used (its mode, not JSON, no "apiKey"): its own reason — which names no value from it
  if (!file.detail?.expected) return { ok: false, why: `the key file cannot be used: ${file.message}` };
  // an `ant auth login` profile is found by the SDK itself; it is not read here, so it is not promised here
  return { ok: false, why: `no key: put an Anthropic API key in ${where} as ${ANTHROPIC_KEY_SHAPE.example} (chmod 600), or start the service with ANTHROPIC_API_KEY set` };
}

export function claudeBrain(o: ClaudeBrainOptions): Brain {
  let client: Pick<Anthropic, "messages"> | undefined = o.client;
  let clientKey: string | undefined;
  const clientFor = (apiKey: string | undefined): Pick<Anthropic, "messages"> => {
    if (client && (o.client || clientKey === apiKey)) return client;
    clientKey = apiKey;
    client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    return client;
  };
  return {
    id: "claude",
    label: "Claude · Anthropic API",
    models: BRAIN_MODELS,
    ready(): BrainStatus {
      const r = brainReach(o);
      return r.ok ? { ok: true, model: DEFAULT_BRAIN.model, how: r.how } : { ok: false, model: DEFAULT_BRAIN.model, why: r.why };
    },
    async decide<T>(req: BrainRequest<T>): Promise<BrainAnswer<T>> {
      const reach = brainReach(o);
      if (!reach.ok) return { out: null, why: reach.why, usage: { inputTokens: 0, outputTokens: 0 } };
      const c = clientFor(reach.apiKey);
      try {
        const r = await c.messages.parse({
          model: req.brain.model,
          max_tokens: req.maxTokens ?? 1024,
          system: req.system,
          messages: [{ role: "user", content: req.input }],
          output_config: { format: zodOutputFormat(req.schema), effort: req.brain.effort },
        });
        const usage = { inputTokens: r.usage.input_tokens + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0), outputTokens: r.usage.output_tokens };
        if (r.stop_reason === "refusal") return { out: null, why: `the model declined to answer${r.stop_details && "category" in r.stop_details && r.stop_details.category ? ` (${String(r.stop_details.category)})` : ""}`, usage };
        if (r.stop_reason === "max_tokens") return { out: null, why: "the answer ran past its token limit", usage };
        const out = r.parsed_output;
        if (out === null || out === undefined) return { out: null, why: "the answer did not fit the shape asked for", usage };
        const parsed = req.schema.safeParse(out);
        return parsed.success ? { out: parsed.data, usage } : { out: null, why: "the answer did not fit the shape asked for", usage };
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new Error("the API did not accept the key");
        if (err instanceof Anthropic.RateLimitError) throw new Error("the API is rate-limiting this key: it is asked again next cycle");
        if (err instanceof Anthropic.APIConnectionError) throw new Error("the API could not be reached");
        if (err instanceof Anthropic.APIError) throw new Error(`the API answered ${err.status ?? "an error"}: ${String(err.message).slice(0, 160)}`);
        throw err;
      }
    },
  };
}
