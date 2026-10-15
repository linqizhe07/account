/** WHERE A BRAIN'S KEY GOES, said so a person can do it: the fix the desk's standing carries when a brain is not ready (BrainFix, desk.ts),
 * shared by the Claude brain (brain-claude.ts) and the OpenAI-format one (brain-openai.ts).
 *
 * A brain reads its key from one file in the home, readable by the user alone, read again at every check — so a key put there needs no
 * restart. The fix names that file by its absolute path, says in one plain sentence what to do with it, and, where a command does it, gives
 * the command whole: run as it is written, it does the thing, with no value in it the owner must first replace. So a missing file is made
 * with an EMPTY template (the key's place is a pair of quotes with nothing between them, never a sample key that a pasted command would
 * leave behind looking like one) and opened in an editor, and the readiness checks refuse that empty template, and the old examples, as
 * "the example" — never as a key. A file other users can read is fixed with chmod; a file that is there but wrong is opened again. A key in
 * the service's environment is the one case no command fixes from here: the variable is set where the service is started, and a restart
 * is needed, which the fix says.
 *
 * Paths are single-quoted for the shell (a quote inside one closed, escaped and opened again), so a home with spaces or quotes in its name
 * still runs as written. On a Mac the editor is TextEdit (`open -e`); elsewhere the owner's $EDITOR, else nano.
 */
import { dirname, join, resolve } from "node:path";
import { readSecretFile } from "../live/credentials.ts";
import type { BrainFix } from "./desk.ts";

/** one argument, quoted for a POSIX shell: inside single quotes nothing is special but the quote itself */
export const shq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** the key file's absolute path */
export const keyFileAt = (home: string, ref: string): string => resolve(join(home, ref));

/** the command that opens the file in an editor: TextEdit on a Mac, the owner's editor elsewhere */
export function editCommand(file: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? `open -e ${shq(file)}` : `\${EDITOR:-nano} ${shq(file)}`;
}

/** The command that makes a missing key file: its folder, then the file holding the empty template, readable by the user alone (umask 077
 * inside a subshell, so the shell's own umask is left as it was), then opened in the editor. `template` is one line of JSON with empty
 * values and no single quote, printed by printf (its "\n" ends the line) */
export function createCommand(file: string, template: string, platform: NodeJS.Platform = process.platform): string {
  return `mkdir -p ${shq(dirname(file))} && (umask 077 && printf ${shq(`${template}\\n`)} > ${shq(file)}) && ${editCommand(file, platform)}`;
}

/** the fix for a key file that is not there: make it, then paste the key between the quotes */
export function noKeyFix(file: string, template: string, words: string, platform?: NodeJS.Platform): BrainFix {
  return { code: "no-key", file, command: createCommand(file, template, platform), restart: false, words };
}

/** the fix for a key file that holds the empty template or an example: open it and put the key in */
export function exampleFix(file: string, words: string, platform?: NodeJS.Platform): BrainFix {
  return { code: "example", file, command: editCommand(file, platform), restart: false, words };
}

/** The fix for a key file that is there but cannot be used. Its mode (other users can read it): chmod 600. Its content (not JSON, not one
 * object, a field missing): opened again. A link out of the home, or something that is not a file: no command from here, only words */
export function unusableFix(file: string, why: "mode" | "content" | "other", words: string, platform?: NodeJS.Platform): BrainFix {
  if (why === "mode") return { code: "unusable", file, command: `chmod 600 ${shq(file)}`, restart: false, words };
  if (why === "content") return { code: "unusable", file, command: editCommand(file, platform), restart: false, words };
  return { code: "unusable", file, restart: false, words };
}

/** the fix for a key in the service's environment that is the example: no command, a restart */
export function envFix(file: string, words: string): BrainFix {
  return { code: "env", file, restart: true, words };
}

/** The fix for a key the API refused. From the key file: open it and replace the key — the next cycle reads it, no restart. From the
 * service's environment: set a working key where the service is started and restart it (or take the variable away and use the file) */
export function rejectedFix(file: string, fromEnv: string | undefined, who: string, platform?: NodeJS.Platform): BrainFix {
  if (fromEnv) return { code: "rejected", file, restart: true, words: `${who} refused the key in ${fromEnv}, in the service's environment. Set a working key there and restart the service — or remove ${fromEnv} and put the key in the file below instead, which is read at the next cycle with no restart.` };
  return { code: "rejected", file, command: editCommand(file, platform), restart: false, words: `${who} refused the key in the file below. Open it, replace the key between the quotes with a working one and save: the next cycle reads it, no restart.` };
}

/** Which way a key file that loadKeyFile refused is wrong, from the refusal's own detail and words (live/credentials.ts readSecretFile and
 * loadKeyFile): "missing" (no file), "mode" (other users can read it), "content" (not JSON, not one object, a field missing or empty), or
 * "other" (a link out of the home, not a file) */
export function fileProblem(r: { message?: string | undefined; detail?: Record<string, unknown> | undefined }): "missing" | "mode" | "content" | "other" {
  const d = r.detail ?? {};
  if (d.expected !== undefined) return "missing";
  if (d.mode !== undefined) return "mode";
  if (Array.isArray(d.missing) || /is not JSON|should hold one JSON object/.test(r.message ?? "")) return "content";
  return "other";
}

/** a key file whose field is there and empty (the template as it was made): read only to tell that from a file that lacks the field, and
 * nothing from it is said */
export function emptyField(home: string, ref: string, field: string): boolean {
  const f = readSecretFile(home, ref, "brain", "");
  if ("ok" in f) return false;
  try {
    const j = JSON.parse(f.text) as Record<string, unknown>;
    return !!j && typeof j === "object" && typeof j[field] === "string" && (j[field] as string).trim() === "";
  } catch {
    return false;
  }
}

/** An error a brain throws when the API refused its key: the desk keeps it as the brain's fault until the next answered call (desk.ts
 * ask), so the standing says "not ready" with this fix instead of a healthy brain that never answers */
export const E_BRAIN_KEY_REJECTED = "E_BRAIN_KEY_REJECTED";
export interface BrainKeyRejected extends Error {
  code: typeof E_BRAIN_KEY_REJECTED;
  /** who refused it, as a person names them: "Anthropic", "api.deepseek.com" */
  who: string;
  fix: BrainFix;
}
export function keyRejected(message: string, who: string, fix: BrainFix): BrainKeyRejected {
  return Object.assign(new Error(message), { code: E_BRAIN_KEY_REJECTED as typeof E_BRAIN_KEY_REJECTED, who, fix });
}
export const isKeyRejected = (err: unknown): err is BrainKeyRejected => !!err && typeof err === "object" && (err as { code?: unknown }).code === E_BRAIN_KEY_REJECTED;
