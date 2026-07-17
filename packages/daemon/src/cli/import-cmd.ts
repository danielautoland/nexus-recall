/**
 * `bastra import <file|-> [source]` (#208) — stage memories exported from
 * other AI tools for review. Parses a memory list (file or stdin paste),
 * writes candidates to `import-review.md` in the vault, and the next AI
 * session distills accepted ones into real memories with the user. Nothing
 * is auto-saved.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  extractCandidates,
  detectSource,
  stageImport,
  ConversationExportError,
  IMPORT_FILE,
  IMPORT_SOURCES,
} from "../import-review.js";
import { resolveVault } from "./helpers.js";
import type { ParsedArgs } from "./types.js";

async function readStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

export async function cmdImport(args: ParsedArgs): Promise<number> {
  const vault = await resolveVault({ dryRun: false, vaultPath: args.vaultPath });
  if ("error" in vault) {
    process.stderr.write(`${vault.error}\n`);
    return 1;
  }

  const fileArg = args.surface; // bastra import <file|-> [source]
  const sourceOverride = args.positional[2] ?? null;
  if (sourceOverride && !(IMPORT_SOURCES as readonly string[]).includes(sourceOverride)) {
    process.stderr.write(`error: unknown source '${sourceOverride}' — one of: ${IMPORT_SOURCES.join(", ")}\n`);
    return 2;
  }

  let raw: string;
  let fileName: string | null = null;
  if (!fileArg || fileArg === "-") {
    if (process.stdin.isTTY) {
      process.stderr.write(
        "usage: bastra import <file|-> [chatgpt|claude|gemini|text]\n" +
          "  <file>  an exported memory list (one fact per line, or a JSON array of strings)\n" +
          "  -       read the list from stdin (paste + Ctrl-D)\n\n" +
          "Where to get the list:\n" +
          "  ChatGPT  Settings → Personalization → Manage memories → copy\n" +
          "  Claude   Settings → memory text → copy\n" +
          "  Gemini   Settings → Saved Info → copy\n",
      );
      return 2;
    }
    raw = await readStdin();
  } else {
    try {
      raw = await readFile(fileArg, "utf8");
      fileName = basename(fileArg);
    } catch (err) {
      process.stderr.write(`error: cannot read ${fileArg}: ${(err as Error).message}\n`);
      return 1;
    }
  }

  let candidates: string[];
  try {
    candidates = extractCandidates(raw);
  } catch (err) {
    if (err instanceof ConversationExportError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
  if (candidates.length === 0) {
    process.stdout.write("no candidates found — is this a memory list (one fact per line)?\n");
    return 1;
  }

  const source = detectSource(fileName, sourceOverride);
  const result = await stageImport(vault.path, source, candidates);
  process.stdout.write(
    `✓ ${result.staged} candidate(s) staged in ${IMPORT_FILE} (source: ${source})` +
      (result.skippedDuplicates > 0 ? ` · ${result.skippedDuplicates} duplicate(s) skipped` : "") +
      `\n  ${result.openTotal} open in total — your next AI session will offer to distill them with you.\n` +
      `  Nothing is saved to the vault without your accept.\n`,
  );
  return 0;
}
