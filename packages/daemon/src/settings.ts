/**
 * bastra-recall local CLI settings (#39: auto-update; #79: embedding provider).
 *
 * A small, OSS-owned settings file at ~/.bastra/cli-settings.json — deliberately
 * separate from ~/.bastra/config.json, which is owned by the Pro Mac-app and its
 * onboarding flow. We never touch that file; this one is ours.
 *
 * Keys:
 *   - update.mode      : "notify" (default) | "auto" | "off"  (see #39)
 *   - embedding.provider (optional): "ollama" | "openai" | "none"
 *       Written by `bastra install` after the user opts into Ollama, or by
 *       `bastra config set`. Absent = "no opinion" → the daemon falls through to
 *       env / API-key. This is the file half of the #79 fix.
 *   - ollama.autostart (optional): boolean (default true)
 *       Whether `bastra install` keeps a local `ollama serve` running at login.
 *   - docs.mode (optional): "off" (default) | "suggest" | "auto"
 *       Product-documentation capture: when a feature area is finished, the
 *       agent updates the per-project product doc in dokumentationen/<scope>/.
 *       "suggest" = propose first, "auto" = write without asking, "off" = the
 *       session hook injects no docs instruction at all.
 *   - docs.language (optional): doc language, e.g. "en" | "de" (default "en").
 *
 * The env var BASTRA_UPDATE_CHECK=off is a hard kill-switch over update.mode.
 * The env var BASTRA_EMBEDDING_PROVIDER wins over embedding.provider (the file).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export type UpdateMode = "notify" | "auto" | "off";
export const UPDATE_MODES: readonly UpdateMode[] = ["notify", "auto", "off"];
export const DEFAULT_UPDATE_MODE: UpdateMode = "notify";

// Named "...Name" to avoid colliding with core's `EmbeddingProvider` (the
// provider *class* interface). This is just the string id of the choice.
export type EmbeddingProviderName = "ollama" | "openai" | "none";
export const EMBEDDING_PROVIDERS: readonly EmbeddingProviderName[] = ["ollama", "openai", "none"];

export type DocsMode = "off" | "suggest" | "auto";
export const DOCS_MODES: readonly DocsMode[] = ["off", "suggest", "auto"];
export const DEFAULT_DOCS_MODE: DocsMode = "off";
export const DEFAULT_DOCS_LANGUAGE = "en";

export interface CliSettings {
  update: { mode: UpdateMode };
  // undefined = "no opinion" → daemon falls through to env / API-key.
  embedding?: { provider: EmbeddingProviderName };
  // undefined = unset → treated as default (true) by getOllamaAutostart.
  ollama?: { autostart: boolean };
  // undefined = no token issued yet → browser/REST clients that send an Origin
  // are rejected (secure by default). Created on demand by `bastra token`; the
  // daemon reads it at startup as the Bearer the bastra.io web app must present.
  api?: { token: string };
  // Bastra Commons (community recipe vault): undefined = disabled. Enabled via
  // `bastra commons enable`; the daemon then loads the cloned repo as a
  // read-only second BM25 index.
  commons?: { enabled: boolean };
  // Product-documentation capture: undefined = off. mode gates the session-hook
  // instruction ("suggest" proposes, "auto" writes without asking); language is
  // the language product docs are written in (free short tag, e.g. "de").
  docs?: { mode?: DocsMode; language?: string };
}

export function settingsFilePath(): string {
  return join(homedir(), ".bastra", "cli-settings.json");
}

function isUpdateMode(v: unknown): v is UpdateMode {
  return typeof v === "string" && (UPDATE_MODES as readonly string[]).includes(v);
}

export function isDocsMode(v: unknown): v is DocsMode {
  return typeof v === "string" && (DOCS_MODES as readonly string[]).includes(v);
}

/** Doc language is a free short tag ("en", "de", "pt-br") — not an enum. */
export function isDocsLanguage(v: unknown): v is string {
  return typeof v === "string" && /^[a-z]{2}(-[a-z]{2,4})?$/i.test(v.trim());
}

export function isEmbeddingProviderName(v: unknown): v is EmbeddingProviderName {
  return typeof v === "string" && (EMBEDDING_PROVIDERS as readonly string[]).includes(v);
}

/**
 * Reads stored settings. A missing file → silent defaults (normal: not created
 * yet). A *corrupt* file → loud warning + defaults, and we do NOT silently
 * revert (callers that write will repair it). Never throws.
 */
export async function readSettings(path: string = settingsFilePath()): Promise<CliSettings> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { update: { mode: DEFAULT_UPDATE_MODE } };
  }
  if (raw.trim() === "") return { update: { mode: DEFAULT_UPDATE_MODE } };

  let data: { update?: { mode?: unknown }; embedding?: { provider?: unknown }; ollama?: { autostart?: unknown }; api?: { token?: unknown }; commons?: { enabled?: unknown }; docs?: { mode?: unknown; language?: unknown } };
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Corrupt is not normal — surface it instead of silently masking the user's
    // real settings behind defaults (that silence was an #79-class footgun).
    process.stderr.write(
      `[bastra-recall] cli-settings.json is corrupt (${(e as Error).message}) — using defaults. Fix or delete ${path}\n`,
    );
    return { update: { mode: DEFAULT_UPDATE_MODE } };
  }

  const settings: CliSettings = {
    update: { mode: isUpdateMode(data?.update?.mode) ? data.update.mode : DEFAULT_UPDATE_MODE },
  };
  // Preserve + validate the optional blocks. Invalid → drop to undefined (NOT a
  // synthesized "none"), so the daemon's fall-through precedence still applies.
  const embProvider = data?.embedding?.provider;
  if (isEmbeddingProviderName(embProvider)) {
    settings.embedding = { provider: embProvider };
  } else if (data?.embedding !== undefined) {
    process.stderr.write(
      `[bastra-recall] cli-settings.json: ignoring invalid embedding.provider ${JSON.stringify(embProvider)}\n`,
    );
  }
  if (typeof data?.ollama?.autostart === "boolean") {
    settings.ollama = { autostart: data.ollama.autostart };
  }
  if (typeof data?.api?.token === "string" && data.api.token.length > 0) {
    settings.api = { token: data.api.token };
  }
  if (typeof data?.commons?.enabled === "boolean") {
    settings.commons = { enabled: data.commons.enabled };
  }
  if (data?.docs !== undefined) {
    // Invalid values drop to undefined (= defaults), same policy as embedding.
    const docs: { mode?: DocsMode; language?: string } = {};
    if (isDocsMode(data.docs.mode)) docs.mode = data.docs.mode;
    else if (data.docs.mode !== undefined) {
      process.stderr.write(
        `[bastra-recall] cli-settings.json: ignoring invalid docs.mode ${JSON.stringify(data.docs.mode)}\n`,
      );
    }
    if (isDocsLanguage(data.docs.language)) docs.language = data.docs.language.trim().toLowerCase();
    else if (data.docs.language !== undefined) {
      process.stderr.write(
        `[bastra-recall] cli-settings.json: ignoring invalid docs.language ${JSON.stringify(data.docs.language)}\n`,
      );
    }
    if (docs.mode !== undefined || docs.language !== undefined) settings.docs = docs;
  }
  return settings;
}

/** Atomic tmp+rename. Random suffix (not just pid — PIDs recycle on macOS). */
async function writeSettings(next: CliSettings, path: string): Promise<void> {
  // Owner-only perms regardless of umask, matching the repo's temp-file
  // hardening (commit 3af0cc8) — forward-safe if a secret ever lands here.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/** The stored update mode (env-agnostic). */
export async function getUpdateMode(path?: string): Promise<UpdateMode> {
  return (await readSettings(path)).update.mode;
}

/**
 * The effective mode after applying the env kill-switch: if BASTRA_UPDATE_CHECK
 * is set to a falsy value, the mode is forced to "off" regardless of the file.
 */
export async function effectiveUpdateMode(path?: string): Promise<UpdateMode> {
  const env = (process.env.BASTRA_UPDATE_CHECK ?? "").toLowerCase();
  if (env === "off" || env === "0" || env === "false" || env === "no") return "off";
  return getUpdateMode(path);
}

/** Persists a new update mode atomically, merging into existing settings. */
export async function setUpdateMode(mode: UpdateMode, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  await writeSettings({ ...current, update: { ...current.update, mode } }, path);
}

/** The stored embedding provider, or undefined when unset (no opinion). */
export async function getEmbeddingProvider(path?: string): Promise<EmbeddingProviderName | undefined> {
  return (await readSettings(path)).embedding?.provider;
}

/** Persists the embedding provider atomically, merging into existing settings. */
export async function setEmbeddingProvider(provider: EmbeddingProviderName, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  await writeSettings({ ...current, embedding: { provider } }, path);
}

/** Whether Ollama should be kept running at login. Default true (if you use ollama, you want it up). */
export async function getOllamaAutostart(path?: string): Promise<boolean> {
  return (await readSettings(path)).ollama?.autostart ?? true;
}

/** Persists the Ollama autostart preference atomically. */
export async function setOllamaAutostart(on: boolean, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  await writeSettings({ ...current, ollama: { autostart: on } }, path);
}

/** The stored REST API token, or undefined when none has been issued. */
export async function getApiToken(path?: string): Promise<string | undefined> {
  return (await readSettings(path)).api?.token;
}

/** Persists an explicit API token atomically (merging into existing settings). */
/** Bastra Commons enabled? Default false (opt-in). */
export async function getCommonsEnabled(path?: string): Promise<boolean> {
  return (await readSettings(path)).commons?.enabled ?? false;
}

export async function setCommonsEnabled(on: boolean, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  await writeSettings({ ...current, commons: { enabled: on } }, path);
}

/** Product-docs capture mode. Default "off" (opt-in). */
export async function getDocsMode(path?: string): Promise<DocsMode> {
  return (await readSettings(path)).docs?.mode ?? DEFAULT_DOCS_MODE;
}

export async function setDocsMode(mode: DocsMode, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  await writeSettings({ ...current, docs: { ...current.docs, mode } }, path);
}

/** Language product docs are written in. Default "en". */
export async function getDocsLanguage(path?: string): Promise<string> {
  return (await readSettings(path)).docs?.language ?? DEFAULT_DOCS_LANGUAGE;
}

export async function setDocsLanguage(language: string, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  await writeSettings({ ...current, docs: { ...current.docs, language: language.trim().toLowerCase() } }, path);
}

export async function setApiToken(token: string, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  await writeSettings({ ...current, api: { token } }, path);
}

/**
 * Returns the stored API token, minting + persisting one on first use. 256-bit,
 * base64url (URL-safe, no padding). `rotate` forces a fresh token, invalidating
 * the old one. The file is written 0600 (see writeSettings).
 */
export async function ensureApiToken(
  opts: { rotate?: boolean } = {},
  path: string = settingsFilePath(),
): Promise<string> {
  const current = await readSettings(path);
  if (!opts.rotate && current.api?.token) return current.api.token;
  const token = randomBytes(32).toString("base64url");
  await writeSettings({ ...current, api: { token } }, path);
  return token;
}
