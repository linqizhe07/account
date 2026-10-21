/** CONNECT A KEY — one field on the Superagent (ui/brains.js brConnect) where the owner pastes an API key, and the account says whose it is,
 * checks it with that provider and names the model the desk would think with, before anything is signed or saved. Nothing here writes: the
 * key is saved by the owner's signed setBrainKey at POST /api/account/brain-key (brain-keys.ts, the same route and the same file as ever),
 * and the desk is switched by a signed setDesk change "brain".
 *
 *   1. WHOSE KEY (recogniseKey), by its shape alone, before it is sent anywhere — the shapes in KEY_KINDS, read on SHAPES_READ from the
 *      providers' own pages, the secret-scanning rules that match their keys (gitleaks, TruffleHog, GitHub's list, OpenRouter's list of
 *      secret formats) and each confirm call tried with a made-up key (the research beside this change). Refused there, in plain words that
 *      never repeat it: what a wallet holds (a private key's 64 hex characters, a recovery phrase), which is never sent anywhere; a key
 *      starred out as a dashboard shows it, or the example from a how-to (exampleKey, brain-key.ts); a key that is not 8 to 512 printable
 *      characters; a key that manages an account and runs no model (Anthropic's Admin API key, OpenAI's admin key); the sign-in token of a
 *      Claude subscription or a claude.ai session, which Anthropic's terms keep out of other apps; an Alibaba Model Studio key, whose address
 *      is the owner's own workspace and so cannot be guessed; another service's secret (Stripe, AWS, GitHub, Slack, a signed token, a key
 *      block); a model provider the desk's brain does not offer (Perplexity); and anything else, as a key it does not recognise.
 *   2. ASKED (detectBrain): the providers its shape fits, one at a time — each through its own brain's probe (desk.ts Brain.probe): the
 *      provider's list of models, the one call a model API answers without billing a token, at that provider's own address and no other
 *      (OpenRouter's list is public, so its key endpoint is asked first; xAI's key endpoint first too, since a new xAI key may call no model
 *      until it is allowed to). A key whose shape names one provider goes to that one alone. A plain "sk-" key with no other mark could be
 *      DeepSeek's, Moonshot's (Kimi), an older Alibaba one or OpenAI's without its mark: the real call settles it, DeepSeek first, then Kimi,
 *      then OpenAI, as the research's order has it — and every one asked sees the key (the page says so beside the field, before Connect is
 *      pressed). Only a refusal sends it on to the next: a provider that takes it ends the asking, and one that could not be reached, or
 *      answered anything else, ends it too — that key may be its own, and is not handed to another provider while that is unknown.
 *   3. THE MODEL (pickModel): the first of the provider's best that it lists for this key — Claude's own models (desk.ts BRAIN_MODELS, the
 *      only ones a desk may name for Claude), or the preset's best (brain-openai.ts OpenAIPreset.best, each provider's recommended model
 *      first) — else the first of its suggestions it lists, else the newest-looking chat model it lists (bestListed), said as that. A list
 *      with none of those is "no usable model", said with a few of the ids it does list.
 *   4. THE ANSWER (Detected): the provider, its label, the host the key goes to, the model, how many models it lists, the key's masked tail
 *      ("…ab12"), who was asked and what each said — never the key, never a piece of it: every word from a provider is scrubbed of it
 *      (brain-key.ts scrubbed), and a model id that holds a piece of it is dropped where it is read (the probes, and here once more).
 *
 * The route (server.ts POST /api/account/brain-detect) reads its own body as the key's own route does, answers what it cannot read with a
 * fixed sentence (DETECT_BODY_WORDS), logs nothing of it, asks for a browser's own headers as "Test the key" does, and checks one key at a
 * time. Every word below is English: the page shows it as it is.
 */
import { MODEL_ID, type Brain, type BrainProbe } from "./desk.ts";
import { exampleKey, holdsPieceOf, keyShaped, keyTail, scrubbed, starredKey } from "./brain-key.ts";

/** the day the shapes below were read from the providers' own pages and the secret-scanning rules (the research beside this change) */
export const SHAPES_READ = "2026-10-21";

/** how a provider is named in a sentence ("OpenAI refused it"), by its brain's id — the brain's label names it on a card */
export const WHO: Readonly<Record<string, string>> = {
  claude: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  xai: "xAI",
  meta: "Meta",
  moonshot: "Moonshot (Kimi)",
  qwen: "Alibaba Model Studio",
  openrouter: "OpenRouter",
  gemini: "Google",
  groq: "Groq",
  together: "Together AI",
};
const who = (id: string): string => WHO[id] ?? id;

/** why a pasted key was not connected, as the page groups it: what the key is (wallet · starred · example · shape · unrecognised ·
 * other-service · not-offered · needs-address · manages · subscription), what the provider said (refused · blocked · unreachable · error ·
 * no-model), and the account's own (busy · none-held: the desk holds none of the brains the key could be for) */
export type DetectCode = "wallet" | "starred" | "example" | "shape" | "unrecognised" | "other-service" | "not-offered" | "needs-address" | "manages" | "subscription" | "refused" | "blocked" | "unreachable" | "error" | "no-model" | "busy" | "none-held";

/** one provider asked, and what it answered — what happened in a phrase, and the provider's own words when it gave any — with no key in
 * them */
export interface Asked {
  provider: string;
  who: string;
  outcome: BrainProbe["outcome"];
  status?: number | undefined;
  words: string;
  said?: string | undefined;
}

export type Detected =
  | {
      ok: true;
      /** the brain's id (a setBrainKey's provider), its label, the provider as a sentence names it, and the host the key was checked at
       * and is sent to from then on (the provider's own) */
      provider: string;
      label: string;
      who: string;
      host?: string | undefined;
      /** the model the desk would think with, and its name as people say it (Claude's own, else the id) */
      model: string;
      modelName: string;
      /** how it was chosen: the provider's best ("best"), one of its suggestions ("suggested"), or the newest-looking chat model it lists */
      picked: "best" | "suggested" | "listed";
      /** how many models the provider lists for this key */
      listed: number;
      /** the key's masked tail: "…" and its last four characters (brain-key.ts keyTail) */
      tail: string;
      /** what the key looked like, in words ("an OpenAI key"), and every provider asked, in order */
      what: string;
      asked: Asked[];
    }
  | { ok: false; code: DetectCode; words: string; provider?: string | undefined; who?: string | undefined; what?: string | undefined; asked?: Asked[] | undefined };

// ---- 1. whose key, by its shape ----------------------------------------------------------------------------------------------------

/** One kind of key: its shape, what it is in words, and either the brains it may belong to (asked in this order) or why it is refused
 * before anything is sent */
interface KeyKind {
  re: RegExp;
  what: string;
  ask?: readonly string[] | undefined;
  refuse?: { code: DetectCode; words: string } | undefined;
}

const NOT_SENT = "It was not sent to any provider.";
const KEYS_WE_TAKE = "Anthropic (sk-ant-), OpenAI (sk-proj-), OpenRouter (sk-or-), xAI (xai-), Groq (gsk_), Google Gemini (AIza, AQ.), Meta (LLM_), DeepSeek and Kimi (sk-)";
const ELSEWHERE = `Keys the desk's brain can use: ${KEYS_WE_TAKE}.`;

/** THE SHAPES, most particular first — the first that matches decides (read on SHAPES_READ; the research's notes give each source):
 *   Anthropic  sk-ant-api03-<93>AA, an API key (the docs say sk-ant-api…; gitleaks, TruffleHog); the newer personal and service-account
 *              keys' shape is not published, so any other sk-ant- key is asked about — sk-ant-api01- among them, which may also be a Claude
 *              Enterprise admin key (Anthropic's admin-keys page): only the call tells. Refused: sk-ant-admin01- (an Admin API key: members,
 *              workspaces, keys — no model), sk-ant-oat01- / sk-ant-ort01- (the token Claude Code makes from a Claude subscription:
 *              Anthropic's terms forbid other apps to collect or route it), sk-ant-sid01- (a claude.ai session, as unofficial tools show
 *              it: the same terms)
 *   OpenAI     sk-proj-, sk-svcacct- and the older sk- keys, all carrying "T3BlbkFJ" (base64 of "OpenAI") in every scanner's rule — a
 *              strong sign, never documented, so a plain sk- key without it is still asked of OpenAI last; sk-None- (reported, not
 *              documented). Refused: sk-admin- (an Admin API key, OpenAI's OpenAPI spec)
 *   DeepSeek   sk- and 32 lower-case letters and digits (TruffleHog; DeepSeek's docs give no shape) — Alibaba's older keys look the same,
 *              Kimi's shape is not published: a plain sk- key is asked of DeepSeek, then Kimi, then OpenAI
 *   Alibaba    sk-sp- (Token and Coding Plan keys) and sk-ws… (the upgraded keys), from Alibaba's own page — sk-sp- refused before anything
 *              is sent (its address is the owner's own workspace); sk-ws… only said when no one takes it, since two letters are too
 *              little to tell it from a DeepSeek or a Kimi key by
 *   OpenRouter sk-or-v1- and 64 hex (OpenRouter's own list of secret formats); its management keys look the same, and its key endpoint
 *              says which (is_management_key)
 *   xAI        xai- and 80 letters and digits (xAI's own example)
 *   Groq       gsk_ (Groq's example), 52 letters and digits after it (TruffleHog)
 *   Google     AIza and 35 key characters — any Google API key, which works for Gemini only once the Generative Language API is on for
 *              it — and AQ. (the auth keys AI Studio has made since 28 May 2026, by Google's staff on its forum)
 *   Meta       LLM_, a number, _ and the secret (dev.meta.ai's authentication page)
 *   Together   tgp_v1_ (seen in public code, not documented); its older keys' shape is not known — and 64 hex characters alone are
 *              REFUSED, never asked: that is also the shape of a wallet's private key
 *   Perplexity pplx- and 48 letters and digits (gitleaks): a provider the desk's brain does not offer — it ended support for the chat
 *              format the brain speaks (Sonar's Chat Completions) on 27 Sep 2026
 * and the other services' secrets brain-key.ts already knows (Stripe, AWS, GitHub, Slack, a signed token, a key block) */
const KEY_KINDS: readonly KeyKind[] = [
  // Anthropic, the longer prefixes first, so that no sk-ant- key is taken for a plain sk- one
  { re: /^sk-ant-(?:oat|ort)\d{2}-/, what: "a Claude subscription's sign-in token", refuse: { code: "subscription", words: `This is the sign-in token of a Claude subscription (it starts sk-ant-oat), the kind Claude Code makes when you log in: it is not an API key, and Anthropic's terms keep it to Anthropic's own apps. Make an API key at platform.claude.com › Settings › API keys and paste that. ${NOT_SENT}` } },
  { re: /^sk-ant-admin\d{2}-/, what: "an Anthropic Admin API key", refuse: { code: "manages", words: `This is an Anthropic Admin API key (it starts sk-ant-admin): it manages an organization's members, workspaces and keys, and cannot run a model. Make an API key at platform.claude.com › Settings › API keys and paste that. ${NOT_SENT}` } },
  { re: /^sk-ant-sid\d{2}-/, what: "a claude.ai session", refuse: { code: "subscription", words: `This is a claude.ai session from a browser (it starts sk-ant-sid), not an API key: Anthropic's terms keep it out of other apps. Make an API key at platform.claude.com › Settings › API keys and paste that. ${NOT_SENT}` } },
  { re: /^sk-ant-[A-Za-z0-9_-]{20,}$/, what: "an Anthropic API key", ask: ["claude"] },
  // the prefixes one provider alone uses
  { re: /^sk-or-v\d+-[A-Za-z0-9]{20,}$/, what: "an OpenRouter key", ask: ["openrouter"] },
  { re: /^xai-[A-Za-z0-9_]{20,}$/, what: "an xAI key", ask: ["xai"] },
  { re: /^gsk_[A-Za-z0-9]{20,}$/, what: "a Groq key", ask: ["groq"] },
  { re: /^LLM_\d+_[\x21-\x7e]{8,}$/, what: "a Meta Model API key", ask: ["meta"] },
  { re: /^(?:AIza[0-9A-Za-z_-]{30,}|AQ\.[\x21-\x7e]{16,})$/, what: "a Google API key", ask: ["gemini"] },
  { re: /^tgp_v\d+_[A-Za-z0-9_-]{16,}$/, what: "a Together AI key", ask: ["together"] },
  { re: /^pplx-[A-Za-z0-9]{20,}$/, what: "a Perplexity key", refuse: { code: "not-offered", words: `This is a Perplexity key (it starts pplx-). The desk's brain does not connect to Perplexity: Perplexity ended its support for the chat format the brain speaks on 27 Sep 2026. ${NOT_SENT} ${ELSEWHERE}` } },
  { re: /^sk-sp-[A-Za-z0-9_-]{8,}$/, what: "an Alibaba Model Studio key", refuse: { code: "needs-address", words: `This is an Alibaba Model Studio (Qwen) key (it starts sk-sp-). Its address is your own workspace's, which the key does not tell: add it under Qwen in Brains, below, with your workspace's base URL. ${NOT_SENT}` } },
  // OpenAI: its admin key refused; its project, service-account and older keys by their prefix or the mark in them
  { re: /^sk-admin-/, what: "an OpenAI admin key", refuse: { code: "manages", words: `This is an OpenAI admin key (it starts sk-admin-): it manages an organization's projects, members and keys, and cannot run a model. Make a project key at platform.openai.com › API keys (it starts sk-proj-) and paste that. ${NOT_SENT}` } },
  { re: /^sk-(?:proj|svcacct|None)-[A-Za-z0-9_-]{20,}$/, what: "an OpenAI key", ask: ["openai"] },
  { re: /^sk-[A-Za-z0-9_-]*T3BlbkFJ[A-Za-z0-9_-]*$/, what: "an OpenAI key", ask: ["openai"] },
  // any other sk- key: DeepSeek's, Kimi's, an older Alibaba one, or OpenAI's without its mark — the real call settles it
  { re: /^sk-[A-Za-z0-9_-]{16,}$/, what: "a plain sk- key", ask: ["deepseek", "moonshot", "openai"] },
  // other services' secrets
  { re: /^(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}$/, what: "a Stripe key", refuse: { code: "other-service", words: `This is a Stripe key, not a model provider's. ${NOT_SENT} ${ELSEWHERE}` } },
  { re: /^AKIA[0-9A-Z]{16}$/, what: "an AWS access key", refuse: { code: "other-service", words: `This is an AWS access key, not a model provider's. ${NOT_SENT} ${ELSEWHERE}` } },
  { re: /^gh[pousr]_[A-Za-z0-9]{20,}$/, what: "a GitHub token", refuse: { code: "other-service", words: `This is a GitHub token, not a model provider's key. ${NOT_SENT} ${ELSEWHERE}` } },
  { re: /^xox[abprs]-[A-Za-z0-9-]{10,}$/, what: "a Slack token", refuse: { code: "other-service", words: `This is a Slack token, not a model provider's key. ${NOT_SENT} ${ELSEWHERE}` } },
  { re: /^eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*$/, what: "a signed token", refuse: { code: "other-service", words: `This is a signed token (a JWT), such as a website's sign-in, not a model provider's API key. ${NOT_SENT} ${ELSEWHERE}` } },
];

/** a key as the account takes one at all: printable ASCII, no space, 8 to 512 characters (brain-keys.ts KEY) */
const KEY = /^[\x21-\x7e]{8,512}$/;
/** what a wallet holds: a private key — 64 hex characters, with or without 0x — or a recovery phrase, twelve to twenty-four plain words */
const PRIVATE_KEY = /^(?:0x)?[0-9a-fA-F]{64}$/;
const RECOVERY_PHRASE = /^(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}$/;
/** whether some pasted text is what a wallet holds (a private key, a recovery phrase): never sent anywhere — the page asks the same of it
 * (ui/brains.js brWalletSecret) and never sends it to the account either */
export const walletSecret = (s: string): boolean => {
  const t = String(s ?? "").trim();
  return PRIVATE_KEY.test(t) || RECOVERY_PHRASE.test(t.toLowerCase());
};

export type Recognised = { ok: true; what: string; ask: readonly string[] } | { ok: false; code: DetectCode; words: string; what?: string | undefined };

/** WHOSE KEY, by its shape alone: the brains to ask, in order — or why it is refused before it is sent anywhere. The words never repeat it */
export function recogniseKey(raw: string): Recognised {
  const key = String(raw ?? "").trim();
  if (walletSecret(key)) return { ok: false, code: "wallet", words: `That looks like what a wallet holds — a private key (64 hex characters) or a recovery phrase — not an API key. ${NOT_SENT} Never paste either into a page: whoever has one has the wallet. If it is an API key all the same (some older Together AI keys are 64 hex characters), add it under its provider in Brains, below.` };
  const shape = { ok: false as const, code: "shape" as const, words: `A key is 8 to 512 characters with no spaces, and this is not one: paste it again. ${NOT_SENT}` };
  if (starredKey(key)) return { ok: false, code: "starred", words: `That is a key as a dashboard shows it, with most of it hidden behind stars: it cannot be used. Copy the whole key where you make it (most providers show it once) and paste that. ${NOT_SENT}` };
  // a space inside is a paste gone wrong more often than an example: said as the shape
  if (/\s/.test(key)) return shape;
  if (exampleKey(key)) return { ok: false, code: "example", words: `That is the example from a how-to, not a key. Paste the key itself, as the provider gave it. ${NOT_SENT}` };
  if (!KEY.test(key)) return shape;
  if (/-----BEGIN /.test(key)) return { ok: false, code: "other-service", words: `This is a key block (a private key or a certificate), not a model provider's API key. ${NOT_SENT}` };
  for (const k of KEY_KINDS) {
    if (!k.re.test(key)) continue;
    if (k.refuse) return { ok: false, code: k.refuse.code, words: k.refuse.words, what: k.what };
    return { ok: true, what: k.what, ask: k.ask ?? [] };
  }
  return { ok: false, code: "unrecognised", words: `This key does not start the way the keys the desk's brain can use do — ${KEYS_WE_TAKE}. ${NOT_SENT} For another endpoint that speaks OpenAI's format, pick Custom endpoint in Brains, below.` };
}

// ---- 3. the model ------------------------------------------------------------------------------------------------------------------

/** not a model that answers a chat in text: embeddings, speech, images, video, moderation, reranking, guard models, search and computer-use
 * previews, and OpenAI's codex models (the Responses API's alone) */
const NOT_CHAT = /embed|whisper|tts|transcri|audio|realtime|speech|image|dall-e|sora|veo|imagen|lyria|moderation|rerank|guard|search|computer-use|codex|ocr|^aqa|babbage|davinci/i;
/** a model's version as its id says it: the first number in it once dates are out, a size in billions ("120b") left out */
const versionOf = (id: string): number => {
  const m = /(\d+(?:\.\d+)?)(?![\d.]*b(?:\b|-))/i.exec(id.replace(/\d{4}-?\d{2}-?\d{2}|-\d{4}(?=$|-)/g, ""));
  return m ? Number.parseFloat(m[1]!) : 0;
};
/** a model's tier as its name says it: the largest first, the smallest last */
const tierOf = (id: string): number => (/opus|ultra|max|large|-pro\b|pro$/i.test(id) ? 2 : /sonnet|medium|plus/i.test(id) ? 1 : /mini|small|flash|lite|nano|haiku|tiny/i.test(id) ? -1 : 0);
/** a model that is not yet the provider's settled one: a preview, an experiment, a beta, or one dated */
const unsettled = (id: string): boolean => /preview|exp|beta|alpha|\d{4}-?\d{2}-?\d{2}/i.test(id);

/** The newest-looking chat model of a list, for a provider that lists none of the models the account knows for it: the chat models alone
 * (NOT_CHAT out), the highest version first, then the larger tier, then a settled one before a preview or a dated one, then the shorter id
 * (an alias before its dated copies). Undefined for a list with no chat model */
export function bestListed(ids: readonly string[]): string | undefined {
  const chat = ids.filter((x) => !NOT_CHAT.test(x));
  return [...chat].sort((a, b) => versionOf(b) - versionOf(a) || tierOf(b) - tierOf(a) || Number(unsettled(a)) - Number(unsettled(b)) || a.length - b.length || a.localeCompare(b))[0];
}

/** what a brain prefers for a pasted key, best first: Claude's own models (the only ones a desk may name for it), or the preset's best,
 * then its suggestions */
export interface Preference {
  best: readonly string[];
  suggested: readonly string[];
  /** only the models in `best` may be named (Claude: a desk names one of its listed models or none) */
  only?: boolean | undefined;
}

/** The model a pasted key is connected with: the first of `best` the provider lists for it, else the first of `suggested`, else — unless
 * only the listed ones may be named — the newest-looking chat model it lists. Compared without case, and given as the provider lists it */
export function pickModel(listed: readonly string[], pref: Preference): { model: string; picked: "best" | "suggested" | "listed" } | undefined {
  const find = (want: string) => listed.find((x) => x.toLowerCase() === want.toLowerCase());
  for (const m of pref.best) {
    const hit = find(m);
    if (hit) return { model: hit, picked: "best" };
  }
  if (pref.only) return undefined;
  for (const m of pref.suggested) {
    const hit = find(m);
    if (hit) return { model: hit, picked: "suggested" };
  }
  const any = bestListed(listed);
  return any ? { model: any, picked: "listed" } : undefined;
}

/** what a brain prefers: Claude's listed models (BRAIN_MODELS, best first — a desk names no other), or what its preset says: its best (the
 * caller's: brains.ts presetBest), then its suggestions (the brain's about()) */
export function preferenceOf(brain: Brain, best: readonly string[] = []): Preference {
  if (brain.models.length) return { best: brain.models.map((m) => m.id), suggested: [], only: true };
  return { best, suggested: brain.about?.().suggested?.models ?? [] };
}

// ---- 2. asked -----------------------------------------------------------------------------------------------------------------------

export interface DetectOptions {
  /** each brain's best models, by id (brains.ts presetBest) */
  best?: ((provider: string) => readonly string[]) | undefined;
  /** the host a brain's pasted key is checked at and sent to, by id (brains.ts presetHost): said on the page before the owner signs */
  host?: ((provider: string) => string) | undefined;
}

/** a few ids of a list, said in a sentence ("a, b and 3 more") — each already checked to look like a model's name and to hold no piece of the
 * key */
const fewOf = (ids: readonly string[]): string => (ids.length <= 3 ? ids.join(", ") : `${ids.slice(0, 3).join(", ")} and ${ids.length - 3} more`);

/** the providers named in a sentence: "OpenAI", "OpenAI and DeepSeek", "OpenAI, DeepSeek and Moonshot (Kimi)" */
const andList = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** WHOSE KEY, ASKED: recognised by its shape, then each provider its shape fits asked in turn through its own brain's probe — the next one
 * only after a refusal — until one takes it; the model picked from what that one lists. Never throws, and never says the key: every
 * provider's word is scrubbed of it once more here, whatever the probe did */
export async function detectBrain(raw: string, brains: ReadonlyArray<Brain>, o: DetectOptions = {}): Promise<Detected> {
  const key = String(raw ?? "").trim();
  const r = recogniseKey(key);
  if (!r.ok) return { ok: false, code: r.code, words: r.words, ...(r.what ? { what: r.what } : {}) };
  const held = r.ask.map((id) => brains.find((b) => b.id === id)).filter((b): b is Brain & { probe: NonNullable<Brain["probe"]> } => !!b && typeof b.probe === "function");
  if (!held.length) return { ok: false, code: "none-held", what: r.what, words: `This looks like ${r.what}, but this account's desk offers no brain for ${andList(r.ask.map(who))}. ${NOT_SENT}` };
  const asked: Asked[] = [];
  for (const b of held) {
    let p: BrainProbe;
    try {
      p = await b.probe(key);
    } catch (err) {
      p = { outcome: "error", words: String((err as Error)?.message ?? err) };
    }
    const said = p.said ? clean(p.said, key).slice(0, 160) : "";
    asked.push({ provider: b.id, who: who(b.id), outcome: p.outcome, ...(p.status !== undefined ? { status: p.status } : {}), words: clean(p.words, key), ...(said ? { said } : {}) });
    if (p.outcome === "refused" && p.kind === "manages") return { ok: false, code: "manages", provider: b.id, who: who(b.id), what: r.what, asked, words: `${who(b.id)} says this is a key that manages an account and cannot run a model. Make a normal API key with ${who(b.id)} and paste that. Nothing was saved.` };
    if (p.outcome === "refused" && p.kind === "blocked") return { ok: false, code: "blocked", provider: b.id, who: who(b.id), what: r.what, asked, words: `${who(b.id)} took the key, but ${clean(p.words, key)}. Nothing was saved.` };
    // only a refusal sends the key on to the next provider its shape fits: one that could not be reached, or that answered anything else,
    // may be the key's own provider, and the key is not handed to another while that is not known
    if (p.outcome === "refused") continue;
    if (p.outcome !== "taken") break;
    const models = (p.models ?? []).filter((x) => MODEL_ID.test(x) && !keyShaped(x) && !holdsPieceOf(x, key));
    const pick = pickModel(models, preferenceOf(b, o.best?.(b.id) ?? []));
    if (!pick) {
      const knows = b.models.length ? ` — none of ${andList(b.models.map((m) => m.name))}, the models the desk thinks with there` : "";
      return { ok: false, code: "no-model", provider: b.id, who: who(b.id), what: r.what, asked, words: `${who(b.id)} took the key, but lists no model the desk can think with${knows}${models.length ? ` (it lists ${fewOf(models)})` : " (it lists none)"}. Nothing was saved.` };
    }
    const named = b.models.find((m) => m.id === pick.model);
    const host = o.host?.(b.id) ?? "";
    return { ok: true, provider: b.id, label: b.label, who: who(b.id), ...(host ? { host } : {}), model: pick.model, modelName: named ? named.name : pick.model, picked: pick.picked, listed: models.length, tail: keyTail(key) ?? "…", what: r.what, asked };
  }
  return { ok: false, ...settle(asked, r.what, key, held.map((b) => b.id)) };
}

/** a provider's words once more scrubbed of the key and every piece of it, and short */
const clean = (words: string, key: string): string => scrubbed(String(words ?? ""), key).slice(0, 200);

/** What may make sense of a refusal, by who refused it and what the key looks like — words that never hold the key (only its prefix,
 * which the provider's own pages print): an Anthropic key that is an Enterprise admin key, or that reaches several workspaces; an OpenAI key
 * restricted from the list of models; a Google key whose project or restrictions keep it from Gemini, or one of the newer AQ. keys Google's
 * list turns away for now; a Kimi key from another region; an Alibaba key in a plain sk- key's shape */
function hintFor(a: Asked, key: string): string {
  const said = a.said ?? "";
  if (a.provider === "claude" && /anthropic-workspace-id/i.test(said)) return " A key that reaches more than one workspace must be told which one, which this account does not do: make a key for one workspace.";
  if (a.provider === "claude" && key.startsWith("sk-ant-api01-")) return " If it was made in claude.ai's organization settings, it is a Claude Enterprise admin key, which manages the organization and cannot run a model: make an API key at platform.claude.com › Settings › API keys.";
  if (a.provider === "openai" && a.status === 403) return " A 403 can also be a restricted key that may not read the list of models: allow it Models (read) and Model capabilities (write) in its permissions, or make one with All.";
  if (a.provider === "gemini" && key.startsWith("AQ.")) return " Google's newer AI Studio keys (they start AQ.) are turned away by its list of models in October 2026 while Google looks into it; a key restricted to the Generative Language API may work where this does not.";
  if (a.provider === "gemini") return " A Google key works for Gemini only when the Generative Language API is on for its project — and, since 19 Jun 2026, only when the key is restricted to it.";
  if (a.provider === "moonshot") return " A Kimi key works only on the platform it was made on: this account asks platform.kimi.ai's (api.moonshot.ai).";
  if (a.provider === "meta" && a.status === 403) return " Meta answers 403 to a key that may not use a model or a feature.";
  return "";
}

/** No provider took it: why, in a few plain sentences — a provider that could not be reached (then the key is not known to be refused, and
 * was not sent on), any other answer (a rate limit, a provider in trouble), or the refusals — with the provider's own words where it gave
 * any, and what to try. "Nothing was saved": nothing was */
function settle(asked: readonly Asked[], what: string, key: string, all: readonly string[]): { code: DetectCode; words: string; provider?: string | undefined; who?: string | undefined; what: string; asked: Asked[] } {
  const last = asked[asked.length - 1]!;
  const one = asked.length === 1 ? last : undefined;
  const base = { what, asked: [...asked], ...(one ? { provider: one.provider, who: one.who } : {}) };
  const quote = (a: Asked) => (a.said ? ` It said: “${a.said.replace(/[.\s]+$/, "")}.”` : "");
  const before = asked.filter((a) => a.outcome === "refused");
  const earlier = before.length ? ` ${andList(before.map((a) => a.who))} refused it first.` : "";
  const notAsked = all.slice(asked.length).map(who);
  const held = notAsked.length ? ` It was not sent on to ${andList(notAsked)} while that is not known.` : "";
  if (last.outcome === "unreachable") return { ...base, code: "unreachable", words: `Could not reach ${last.who}: ${last.words}. Check this machine's internet connection and try again.${earlier}${held} Nothing was saved.` };
  if (last.outcome === "error") {
    const tip = last.status === 429 ? " It is limiting how often it is asked: try again in a minute." : last.status !== undefined && last.status >= 500 ? " It may be having trouble: try again in a few minutes." : hintFor(last, key);
    return { ...base, code: "error", words: `${last.who} answered ${last.status ?? "with an error"} when asked for its list of models.${quote(last)}${tip}${earlier}${held} Nothing was saved.` };
  }
  if (one) return { ...base, code: "refused", words: `${one.who} refused this key${one.status ? ` (${one.status})` : ""}: it may be mistyped, cut short or revoked.${quote(one)}${hintFor(one, key)} Nothing was saved.` };
  const alibaba = /^sk-(?:ws|[a-z0-9]{32}$)/.test(key) ? " If it is an Alibaba Model Studio (Qwen) key — they look the same — add it under Qwen in Brains, below, with your workspace's base URL." : "";
  return { ...base, code: "refused", words: `None of the providers that issue keys like this one took it: ${andList(asked.map((a) => `${a.who}${a.status ? ` (${a.status})` : ""}`))} refused it. It may be mistyped, cut short or revoked.${alibaba} Nothing was saved.` };
}

// ---- the route's body ----------------------------------------------------------------------------------------------------------------

/** the route that checks a pasted key, and whether a request's path is that route as express matches it (case and a trailing slash aside —
 * the server's JSON parser skips every spelling of it, as it does the key's own route) */
export const BRAIN_DETECT_PATH = "/api/account/brain-detect";
export const isBrainDetectPath = (path: string): boolean => path.toLowerCase().replace(/\/+$/, "") === BRAIN_DETECT_PATH;

/** the fixed sentences the route answers a body it cannot take with — none repeats anything that was sent */
export const DETECT_BODY_WORDS = {
  malformed: "This route takes one JSON object, {apiKey}: what was sent is not that, and it was not kept.",
  type: "This route takes application/json, sent as it is (no content encoding).",
  large: "This route takes at most 4096 bytes: what was sent is larger, and it was not kept.",
  browser: "A key is checked from the account's own page: a request without a browser's headers is not taken.",
  busy: "A key is being checked already: wait for its answer.",
} as const;

/** Read the route's body: one JSON object, {apiKey: a string}, and nothing else — anything else is answered with a fixed sentence (the
 * parser's own message quotes what it could not read, and that is the key). The bytes are zeroed once read */
export function parseDetectBody(raw: Buffer): { ok: true; apiKey: string } | { ok: false; status: number; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: DETECT_BODY_WORDS.malformed };
  } finally {
    raw.fill(0);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, status: 400, error: DETECT_BODY_WORDS.malformed };
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((k) => k !== "apiKey") || typeof body.apiKey !== "string") return { ok: false, status: 400, error: DETECT_BODY_WORDS.malformed };
  return { ok: true, apiKey: body.apiKey };
}
