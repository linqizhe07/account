/** THE HOUSE BRAIN: a Claude model through the Anthropic API, asked one structured question at a time by the desk (desk.ts). It reaches the
 * API the way the owner lets it: a key file in the home — <home>/credentials/anthropic/api-key.json, {"apiKey": "<the key>"}, readable by
 * the user alone, read again at every check, so a key put there needs no restart — which is how every other secret reaches this account
 * (live/credentials.ts); or, for an account started by hand, ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the service's environment, or
 * an `ant auth login` profile the SDK finds by itself. Without any of them — or with a file that still holds the empty template or an
 * example instead of a key — it is not ready, and says what would make it so (BrainFix, brain-key.ts: the file's path, a command that runs
 * as written, whether a restart is needed, one plain sentence); it never pretends to think.
 *
 * Each question is one request: a system prompt (the role and its charter), the data as text, and the answer constrained to the role's
 * JSON shape (structured outputs). Thinking is the model's own (adaptive, the default on these models); the depth is the desk's effort
 * setting. A decline (stop reason `refusal`), an answer cut by the token limit, or one that does not fit the shape is "no decision", said
 * so; a key the API rejects, a rate limit or an unreachable API is an error the desk writes in its room — the rejected key as its own kind
 * (E_BRAIN_KEY_REJECTED, carrying the fix), which the desk keeps as the brain's standing until a call is answered again. The API's own
 * token counts come back with every answer, so the desk's cost line is counted, not guessed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { isRefusal } from "../../core/errors.ts";
import { loadKeyFile, type KeyShape } from "../live/credentials.ts";
import { emptyField, envFix, exampleFix, fileProblem, keyFileAt, keyRejected, noKeyFix, rejectedFix, unusableFix } from "./brain-key.ts";
import { BRAIN_MODELS, DEFAULT_BRAIN, type Brain, type BrainAnswer, type BrainFix, type BrainRequest, type BrainStatus } from "./desk.ts";

export const ANTHROPIC_KEY_REF = "credentials/anthropic/api-key.json";
/** the file's empty template: the key goes between the quotes. It is what the make-the-file command writes, and the readiness check refuses
 * it as the example until a key is there */
export const ANTHROPIC_KEY_TEMPLATE = '{"apiKey": ""}';
export const ANTHROPIC_KEY_SHAPE: KeyShape = { required: ["apiKey"], example: ANTHROPIC_KEY_TEMPLATE };
/** where the key comes from, in a person's words (the fix's sentences say it) */
const WHERE_FROM = "it starts sk-ant-, from console.anthropic.com › API keys";

export interface ClaudeBrainOptions {
  home: string;
  env?: NodeJS.ProcessEnv | undefined;
  /** the SDK's client, for tests (a fake that answers parse()) */
  client?: Pick<Anthropic, "messages"> | undefined;
  /** the machine the commands in a fix are for (tests); this one's by default */
  platform?: NodeJS.Platform | undefined;
}

/** could be a key: not the example from the how-to, not a fragment of one — whether the API accepts it, only the API says */
const looksLikeKey = (k: string): boolean => k.length >= 20 && !/[\s…<>]|\.\.\./.test(k);

export type ClaudeReach = { ok: true; how: string; apiKey?: string | undefined; fromEnv?: string | undefined } | { ok: false; why: string; fix: BrainFix };

/** how the brain would reach the API now, without reaching it; when it cannot, why (a sentence) and the fix (brain-key.ts) */
export function brainReach(o: ClaudeBrainOptions): ClaudeReach {
  const env = o.env ?? process.env;
  const file = keyFileAt(o.home, ANTHROPIC_KEY_REF);
  if (o.client) return { ok: true, how: "a client given to it" };
  if (env.ANTHROPIC_API_KEY) {
    if (!looksLikeKey(env.ANTHROPIC_API_KEY))
      return { ok: false, why: "ANTHROPIC_API_KEY in the service's environment is the example or a fragment, not a key: set the key itself and restart the service", fix: envFix(file, `ANTHROPIC_API_KEY in the service's environment holds an example, not a key. Set your Anthropic API key there (${WHERE_FROM}) where the service is started, and restart it — or remove the variable and put the key in the file below instead, which needs no restart.`) };
    return { ok: true, how: "ANTHROPIC_API_KEY in the service's environment", fromEnv: "ANTHROPIC_API_KEY" };
  }
  if (env.ANTHROPIC_AUTH_TOKEN) return { ok: true, how: "ANTHROPIC_AUTH_TOKEN in the service's environment", fromEnv: "ANTHROPIC_AUTH_TOKEN" };
  const read = loadKeyFile(o.home, ANTHROPIC_KEY_REF, ANTHROPIC_KEY_SHAPE, "anthropic");
  const paste = `Paste your Anthropic API key (${WHERE_FROM}) between the quotes in the file below and save. It is read at the next cycle, no restart.`;
  if (!isRefusal(read)) {
    if (!looksLikeKey(read.apiKey ?? "")) return { ok: false, why: `${file} holds the example, not a key: put your key between the quotes of "apiKey" — the file is read again at every check, no restart needed`, fix: exampleFix(file, `The key file holds an example, not a key. ${paste}`, o.platform) };
    return { ok: true, how: `the key file ${ANTHROPIC_KEY_REF}`, apiKey: read.apiKey };
  }
  const problem = fileProblem(read);
  // an `ant auth login` profile is found by the SDK itself; it is not read here, so it is not promised here
  if (problem === "missing")
    return { ok: false, why: `no key: the brain reads an Anthropic API key from ${file}, which is not there yet; it is read again at every check, no restart needed (if you start the account by hand, ANTHROPIC_API_KEY in its environment works too)`, fix: noKeyFix(file, ANTHROPIC_KEY_TEMPLATE, `Run the command below: it makes the key file, readable by you alone, and opens it. ${paste}`, o.platform) };
  // the template made and left empty: "apiKey" is there with nothing in it — the example, not a broken file
  if (problem === "content" && emptyField(o.home, ANTHROPIC_KEY_REF, "apiKey")) return { ok: false, why: `${file} holds the example, not a key: put your key between the quotes of "apiKey" — the file is read again at every check, no restart needed`, fix: exampleFix(file, `The key file is there, but its key is empty. ${paste}`, o.platform) };
  // the file is there but cannot be used (its mode, not JSON, no "apiKey"): its own reason — which names no value from it
  const words = problem === "mode" ? "The key file can be read by other users of this machine, so the brain does not read it. Run the command below so only you can read it; the next cycle reads it, no restart." : problem === "content" ? `The key file is not what the brain reads: it should hold one line, ${ANTHROPIC_KEY_TEMPLATE}, with your Anthropic API key (${WHERE_FROM}) between the quotes. Open it with the command below, fix it and save; the next cycle reads it, no restart.` : `The key file cannot be used: ${read.message}`;
  return { ok: false, why: `the key file cannot be used: ${read.message}`, fix: unusableFix(file, problem, words, o.platform) };
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
      return r.ok ? { ok: true, model: DEFAULT_BRAIN.model, how: r.how } : { ok: false, model: DEFAULT_BRAIN.model, why: r.why, fix: r.fix };
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
        // a key the API refused is the brain's standing, not one bad cycle: thrown as its own kind with the fix (brain-key.ts), which the desk
        // keeps until a call is answered again
        if (err instanceof Anthropic.AuthenticationError) throw keyRejected("the API did not accept the key", "Anthropic", rejectedFix(keyFileAt(o.home, ANTHROPIC_KEY_REF), reach.fromEnv, "Anthropic", o.platform));
        if (err instanceof Anthropic.RateLimitError) throw new Error("the API is rate-limiting this key: it is asked again next cycle");
        if (err instanceof Anthropic.APIConnectionError) throw new Error("the API could not be reached");
        if (err instanceof Anthropic.APIError) throw new Error(`the API answered ${err.status ?? "an error"}: ${String(err.message).slice(0, 160)}`);
        throw err;
      }
    },
  };
}
