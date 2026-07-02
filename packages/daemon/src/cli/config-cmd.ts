/**
 * `bastra config get|set <key> [value]` — settings access from the CLI.
 *
 * Keys: update.mode, embedding.provider, ollama.autostart, docs.mode,
 * docs.language. The store is the OSS-owned ~/.bastra/cli-settings.json
 * (never the Pro-app's config.json). Browsing/editing memories stays in
 * the Pro app — this is flags only.
 */
import {
  DEFAULT_UPDATE_MODE,
  UPDATE_MODES,
  EMBEDDING_PROVIDERS,
  DOCS_MODES,
  DEFAULT_DOCS_MODE,
  getUpdateMode,
  setUpdateMode,
  getEmbeddingProvider,
  setEmbeddingProvider,
  getOllamaAutostart,
  setOllamaAutostart,
  getDocsMode,
  setDocsMode,
  getDocsLanguage,
  setDocsLanguage,
  isEmbeddingProviderName,
  isDocsMode,
  isDocsLanguage,
  settingsFilePath,
  type UpdateMode,
} from "../settings.js";
import type { ParsedArgs } from "./types.js";

const KNOWN_KEYS = ["update.mode", "embedding.provider", "ollama.autostart", "docs.mode", "docs.language"] as const;
type KnownKey = (typeof KNOWN_KEYS)[number];

function isKnownKey(k: string | null): k is KnownKey {
  return k !== null && (KNOWN_KEYS as readonly string[]).includes(k);
}

export async function cmdConfig(args: ParsedArgs): Promise<number> {
  // positional: ["config", action, key, value?]
  const action = args.positional[1] ?? null;
  const key = args.positional[2] ?? null;
  const value = args.positional[3] ?? null;

  if (action !== "get" && action !== "set") {
    process.stderr.write("usage: bastra config get <key> | bastra config set <key> <value>\n");
    process.stderr.write(`known keys: ${KNOWN_KEYS.join(", ")}\n`);
    return 2;
  }

  if (!isKnownKey(key)) {
    process.stderr.write(`error: unknown config key '${key ?? ""}'\n`);
    process.stderr.write(`known keys: ${KNOWN_KEYS.join(", ")}\n`);
    return 2;
  }

  return action === "get" ? cmdConfigGet(key) : cmdConfigSet(key, value);
}

async function cmdConfigGet(key: KnownKey): Promise<number> {
  switch (key) {
    case "update.mode":
      process.stdout.write(`${await getUpdateMode()}\n`);
      return 0;
    case "embedding.provider": {
      const p = await getEmbeddingProvider();
      process.stdout.write(`${p ?? "(unset — falls through to env / API-key, else BM25)"}\n`);
      const env = process.env.BASTRA_EMBEDDING_PROVIDER;
      if (env) process.stdout.write(`  note: BASTRA_EMBEDDING_PROVIDER=${env} (env) overrides this file at runtime\n`);
      return 0;
    }
    case "ollama.autostart":
      process.stdout.write(`${await getOllamaAutostart()}\n`);
      return 0;
    case "docs.mode":
      process.stdout.write(`${await getDocsMode()}\n`);
      return 0;
    case "docs.language":
      process.stdout.write(`${await getDocsLanguage()}\n`);
      return 0;
  }
}

async function cmdConfigSet(key: KnownKey, value: string | null): Promise<number> {
  switch (key) {
    case "update.mode": {
      if (value === null || !(UPDATE_MODES as readonly string[]).includes(value)) {
        process.stderr.write(
          `error: update.mode must be one of: ${UPDATE_MODES.join(" | ")} (default: ${DEFAULT_UPDATE_MODE})\n`,
        );
        return 2;
      }
      await setUpdateMode(value as UpdateMode);
      process.stdout.write(`✓ update.mode = ${value}\n  stored in ${settingsFilePath()}\n`);
      if (value === "auto") {
        process.stdout.write("  bastra will now stage updates at session start (no restart mid-session).\n");
      }
      return 0;
    }
    case "embedding.provider": {
      if (!isEmbeddingProviderName(value)) {
        process.stderr.write(`error: embedding.provider must be one of: ${EMBEDDING_PROVIDERS.join(" | ")}\n`);
        return 2;
      }
      await setEmbeddingProvider(value);
      process.stdout.write(`✓ embedding.provider = ${value}\n  stored in ${settingsFilePath()}\n`);
      const env = process.env.BASTRA_EMBEDDING_PROVIDER;
      if (env && env.toLowerCase() !== value) {
        process.stdout.write(
          `  ⚠ BASTRA_EMBEDDING_PROVIDER=${env} (env) is set and OVERRIDES this — unset it for the file to take effect.\n`,
        );
      }
      process.stdout.write("  restart the daemon to apply (activates on next boot).\n");
      if (value === "ollama") {
        process.stdout.write("  needs Ollama + the embeddinggemma model — run `bastra embeddings on` if not set up.\n");
      }
      return 0;
    }
    case "ollama.autostart": {
      const on = parseBool(value);
      if (on === null) {
        process.stderr.write("error: ollama.autostart must be one of: true | false (also on|off)\n");
        return 2;
      }
      await setOllamaAutostart(on);
      process.stdout.write(`✓ ollama.autostart = ${on}\n  stored in ${settingsFilePath()}\n`);
      return 0;
    }
    case "docs.mode": {
      if (!isDocsMode(value)) {
        process.stderr.write(
          `error: docs.mode must be one of: ${DOCS_MODES.join(" | ")} (default: ${DEFAULT_DOCS_MODE})\n`,
        );
        return 2;
      }
      await setDocsMode(value);
      process.stdout.write(`✓ docs.mode = ${value}\n  stored in ${settingsFilePath()}\n`);
      if (value !== "off") {
        process.stdout.write(
          `  product docs land in dokumentationen/<project>/ in your vault ` +
            `(${value === "auto" ? "written autonomously on feature completion" : "proposed first, written after you agree"}).\n`,
        );
      }
      return 0;
    }
    case "docs.language": {
      if (!isDocsLanguage(value)) {
        process.stderr.write("error: docs.language must be a short tag like 'en', 'de', 'pt-br'\n");
        return 2;
      }
      await setDocsLanguage(value);
      process.stdout.write(`✓ docs.language = ${value.trim().toLowerCase()}\n  stored in ${settingsFilePath()}\n`);
      return 0;
    }
  }
}

function parseBool(v: string | null): boolean | null {
  if (v === null) return null;
  const s = v.toLowerCase();
  if (["true", "on", "yes", "1"].includes(s)) return true;
  if (["false", "off", "no", "0"].includes(s)) return false;
  return null;
}
