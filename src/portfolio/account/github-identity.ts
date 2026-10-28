/** WHO SIGNED IN WITH GITHUB on this machine (live/github.ts), kept so that a restart leaves them signed in for opening paper accounts:
 *
 *   <home>/github/identity.json   {"v":1, "identity"?: {"login", "id", "name"?, "avatarUrl"?, "at"}, "hello"?: {"url", "at"}}
 *
 * The user's alone (0600, in a 0700 folder), written whole — a fresh temporary file, flushed, renamed over the old one — and never through
 * a link, as a brain's key file is (brain-keys.ts writeBrainKey); read through the same checks as every key file (live/credentials.ts
 * readSecretFile). No token is in it: GitHub's token lives in the process's memory only. No email is in it: none is read.
 * `hello`: where the owner said hi in the project's thread. It stays when they sign out: hi is said once from a machine.
 * A file that is not this shape is no one signed in.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeSync, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { readSecretFile } from "../live/credentials.ts";
import { no } from "../refuse.ts";

export interface GitHubIdentity {
  login: string;
  id: number;
  name?: string | undefined;
  avatarUrl?: string | undefined;
  /** when they signed in (ISO) */
  at: string;
}
export interface GitHubHelloSaid {
  /** the comment, on github.com */
  url: string;
  at: string;
}
export interface GitHubFile {
  v: 1;
  identity?: GitHubIdentity | undefined;
  hello?: GitHubHelloSaid | undefined;
}

/** where it lives in the home */
export const GITHUB_FILE = "github/identity.json";

/** a GitHub login as GitHub makes them: letters, digits and hyphens, not starting with a hyphen (an enterprise's managed users add an
 * underscore and a short code). Nothing else can stand after the @ of the hello, so nothing in it can be read as more than a name */
export const LOGIN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** a name as the page shows it: no control or direction characters, eighty at most */
export const cleanName = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "").trim().slice(0, 80) : "");

/** an avatar's address, only from GitHub's own avatar host, over https: anything else is no avatar */
export function avatarOf(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 300) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "avatars.githubusercontent.com" && !u.username && !u.password && !u.port ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const isoAt = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));

function identityOf(x: unknown): GitHubIdentity | undefined {
  const o = obj(x);
  if (typeof o.login !== "string" || !LOGIN.test(o.login) || !Number.isSafeInteger(o.id) || (o.id as number) <= 0 || !isoAt(o.at)) return undefined;
  const name = cleanName(o.name);
  const avatarUrl = avatarOf(o.avatarUrl);
  return { login: o.login, id: o.id as number, ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}), at: o.at };
}
function helloOf(x: unknown): GitHubHelloSaid | undefined {
  const o = obj(x);
  return typeof o.url === "string" && o.url.length <= 300 && o.url.startsWith("https://github.com/") && isoAt(o.at) ? { url: o.url, at: o.at } : undefined;
}

/** what the file says: who is signed in and where hi was said, each only when it reads as one — a missing, unreadable or loose file (not
 * 0600, a link out of the home) is nobody */
export function readGitHubFile(home: string): GitHubFile {
  const f = readSecretFile(home, GITHUB_FILE, "github", "");
  if ("ok" in f) return { v: 1 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(f.text);
  } catch {
    return { v: 1 };
  }
  const o = obj(parsed);
  if (o.v !== 1) return { v: 1 };
  const identity = identityOf(o.identity);
  const hello = helloOf(o.hello);
  return { v: 1, ...(identity ? { identity } : {}), ...(hello ? { hello } : {}) };
}

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
const lstatOf = (p: string): Stats | undefined => {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
};

/** the folder, made if it is not there: only the user may open it (0700, set again each time), and it may not be a link */
function githubDir(home: string): string | Refusal {
  const root = realpathSync(resolve(home));
  const dir = join(root, "github");
  const st = lstatOf(dir);
  if (st?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: "github", message: "github in the home is a link: who signed in is not written through one. Make it a plain folder and sign in again" });
  if (st && !st.isDirectory()) return no("E_ACCOUNT_CREDENTIAL", { venue: "github", message: "github in the home is not a folder: who signed in cannot be written there" });
  if (!st) mkdirSync(dir, { mode: 0o700 });
  chmodSync(dir, 0o700);
  if (!inside(root, realpathSync(dir))) return no("E_ACCOUNT_CREDENTIAL", { venue: "github", message: "the github folder leads out of the home: who signed in is not written" });
  return dir;
}

/** write the file whole: a fresh temporary file beside it ("wx", 0600), flushed, renamed over the old one; a link where the file should be
 * is refused, never followed or replaced */
export function writeGitHubFile(home: string, file: GitHubFile): { ok: true } | Refusal {
  const dir = githubDir(home);
  if (isRefusal(dir)) return dir;
  const path = join(dir, "identity.json");
  const st = lstatOf(path);
  if (st?.isSymbolicLink()) return no("E_ACCOUNT_CREDENTIAL", { venue: "github", message: `${GITHUB_FILE} is a link: it is not followed and not replaced. Remove it and sign in again` });
  if (st && !st.isFile()) return no("E_ACCOUNT_CREDENTIAL", { venue: "github", message: `${GITHUB_FILE} is not a file` });
  const text = `${JSON.stringify({ v: 1, ...(file.identity ? { identity: file.identity } : {}), ...(file.hello ? { hello: file.hello } : {}) })}\n`;
  const tmp = join(dir, `.identity.json.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  // the folder's entry for the renamed file, flushed too where the system allows it
  try {
    const d = openSync(dir, "r");
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  } catch {
    // a folder that cannot be flushed on this system: the file itself was
  }
  return { ok: true };
}

/** who signed in, kept beside where hi was said */
export const keepIdentity = (home: string, identity: GitHubIdentity): { ok: true } | Refusal => writeGitHubFile(home, { ...readGitHubFile(home), identity });
/** signed out: who it was is gone; where hi was said stays */
export function forgetIdentity(home: string): { ok: true } | Refusal {
  const { hello } = readGitHubFile(home);
  return writeGitHubFile(home, { v: 1, ...(hello ? { hello } : {}) });
}
/** hi said: where, kept with who is signed in */
export const keepHello = (home: string, hello: GitHubHelloSaid): { ok: true } | Refusal => writeGitHubFile(home, { ...readGitHubFile(home), hello });
