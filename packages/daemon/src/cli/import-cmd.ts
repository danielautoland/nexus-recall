/**
 * `bastra import` (#208/#209/#211) — stage memories from other AI tools for
 * review. Four paths, one gate:
 *   <file|->    a memory list (ChatGPT/Claude/Gemini export, free text) —
 *               staged directly into `import-review.md`
 *   <file>      a conversations.json data export — queued locally, the AI
 *               session mines it chunk-wise via `bastra import mine`
 *   rules       local instruction files (CLAUDE.md, AGENTS.md, Cursor rules)
 *   mine|clear  work off / discard the conversation mining queue
 * Nothing is ever auto-saved: candidates wait in `import-review.md` until
 * the session distills them WITH the user.
 */
import { open, readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  extractCandidates,
  detectSource,
  stageImport,
  ConversationExportError,
  IMPORT_FILE,
  IMPORT_SOURCES,
  type ImportSource,
  type StageResult,
} from "../import-review.js";
import { findRulesFiles, extractRulesCandidates } from "../import-rules.js";
import { parseConversationExport, buildQueue, readNextChunk, clearQueue, queueStatus } from "../import-mining.js";
import { importVault } from "../import-vault.js";
import { resolveVault } from "./helpers.js";
import type { ParsedArgs } from "./types.js";

/** JSON.parse peak memory is a multiple of the input — refuse absurd files
 *  instead of OOM-killing the CLI. Real exports are tens of MB. */
const MAX_IMPORT_FILE_BYTES = 256 * 1024 * 1024;

async function readStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

export async function cmdImport(args: ParsedArgs): Promise<number> {
  if (args.surface === "rules") return cmdImportRules(args);
  if (args.surface === "vault") return cmdImportVault(args);
  if (args.surface === "mine") return cmdImportMine();
  if (args.surface === "clear") return cmdImportClear();

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
          "       bastra import rules    scan local rules files (CLAUDE.md, AGENTS.md,\n" +
          "                              .cursorrules, .cursor/rules/, ~/.claude/CLAUDE.md)\n" +
          "       bastra import mine     next chunk of a queued conversations.json export\n" +
          "       bastra import clear    discard the mining queue\n" +
          "  <file>  an exported memory list (one fact per line, or a JSON array of strings) —\n" +
          "          or a ChatGPT/Claude conversations.json data export (queued for mining)\n" +
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
      // Size-check and read on the SAME handle — a stat-then-read on the
      // path could be raced past the size cap via a file swap.
      const fh = await open(fileArg, "r");
      try {
        const info = await fh.stat();
        if (info.size > MAX_IMPORT_FILE_BYTES) {
          process.stderr.write(`error: ${fileArg} is ${Math.round(info.size / 1024 / 1024)} MB — too large to parse safely (max 256 MB)\n`);
          return 1;
        }
        raw = await fh.readFile({ encoding: "utf8" });
      } finally {
        await fh.close();
      }
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
    if (err instanceof ConversationExportError) return queueConversations(raw);
    throw err;
  }
  if (candidates.length === 0) {
    process.stdout.write("no candidates found — is this a memory list (one fact per line)?\n");
    return 1;
  }

  const source = detectSource(fileName, sourceOverride);
  const result = await stageImport(vault.path, source, candidates);
  printStaged(result, source);
  return 0;
}

function printStaged(result: StageResult, source: ImportSource): void {
  process.stdout.write(
    `✓ ${result.staged} candidate(s) staged in ${IMPORT_FILE} (source: ${source})` +
      (result.skippedDuplicates > 0 ? ` · ${result.skippedDuplicates} duplicate(s) skipped` : "") +
      `\n  ${result.openTotal} open in total — your next AI session will offer to distill them with you.\n` +
      `  Nothing is saved to the vault without your accept.\n`,
  );
}

/** #211: a conversations.json landed on the P1 path — queue it for mining. */
async function queueConversations(raw: string): Promise<number> {
  const parsed = parseConversationExport(raw);
  if (!parsed) {
    process.stderr.write(
      "error: unrecognized JSON shape — expected a memory list (JSON array of strings) " +
        "or a ChatGPT/Claude conversations.json data export\n",
    );
    return 2;
  }
  const result = await buildQueue(parsed.conversations);
  const st = await queueStatus();
  process.stdout.write(
    `✓ ${result.queued} conversation(s) queued for mining — ${result.messages} of YOUR messages kept, ` +
      `assistant turns dropped (source: ${parsed.source})\n` +
      `  Queue: ${result.queueFile} (${st.remaining} pending) — local only, never leaves this\n` +
      `  machine, deleted when mining completes. Discard anytime: bastra import clear\n` +
      `  In your AI session say "mine the imported chat history" — it combs the queue\n` +
      `  chunk-wise via \`bastra import mine\` and stages candidate facts for your review.\n`,
  );
  return 0;
}

/** #209: stage local rules files through the same review gate. */
async function cmdImportRules(args: ParsedArgs): Promise<number> {
  const vault = await resolveVault({ dryRun: false, vaultPath: args.vaultPath });
  if ("error" in vault) {
    process.stderr.write(`${vault.error}\n`);
    return 1;
  }
  const files = await findRulesFiles(process.cwd());
  if (files.length === 0) {
    process.stdout.write(
      "no rules files found — looked for CLAUDE.md, AGENTS.md, .cursorrules and .cursor/rules/ " +
        "here, and ~/.claude/CLAUDE.md\n",
    );
    return 1;
  }
  const all: string[] = [];
  for (const f of files) {
    let count = 0;
    try {
      const candidates = extractRulesCandidates(await readFile(f.path, "utf8"));
      all.push(...candidates);
      count = candidates.length;
    } catch {
      // unreadable file — reported as 0 candidates
    }
    process.stdout.write(`  ${f.label} — ${count} candidate(s)\n`);
  }
  if (all.length === 0) {
    process.stdout.write("no list lines found — candidates are taken from bullet/numbered lines only\n");
    return 1;
  }
  const result = await stageImport(vault.path, "rules", all);
  printStaged(result, "rules");
  return 0;
}

/**
 * #215: import a whole folder of foreign memory files (Claude Code memory
 * dir, or any markdown notes) directly — no review gate. Lands in its own
 * isolated `memories/imported/<label>/` subtree; nothing existing is touched.
 *   bastra import vault <dir> [label] [--dry-run]
 */
async function cmdImportVault(args: ParsedArgs): Promise<number> {
  const dir = args.positional[2];
  if (!dir) {
    process.stderr.write(
      "usage: bastra import vault <dir> [label] [--dry-run]\n" +
        "  imports a folder of memory files (e.g. a Claude Code memory dir) into\n" +
        "  memories/imported/<label>/ — deterministic, no per-item review.\n" +
        "  label   namespace for this batch (default: the folder's name)\n",
    );
    return 2;
  }
  const vault = await resolveVault({ dryRun: false, vaultPath: args.vaultPath });
  if ("error" in vault) {
    process.stderr.write(`${vault.error}\n`);
    return 1;
  }
  const label = args.positional[3];
  let result;
  try {
    result = await importVault(vault.path, dir, { label, dryRun: args.dryRun });
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }
  const verb = result.dryRun ? "would import" : "imported";
  process.stdout.write(
    `✓ ${verb} ${result.imported}/${result.scanned} file(s) → ${result.folder}/ ` +
      `(scope: ${result.scope})\n` +
      `  ${result.byAdapter.claudeCode} via Claude-Code adapter · ${result.byAdapter.generic} generic markdown` +
      (result.skipped.length > 0 ? ` · ${result.skipped.length} skipped` : "") +
      `\n`,
  );
  for (const s of result.skipped.slice(0, 10)) {
    process.stdout.write(`  · skipped ${basename(s.path)}: ${s.reason}\n`);
  }
  if (result.skipped.length > 10) {
    process.stdout.write(`  · …and ${result.skipped.length - 10} more\n`);
  }
  if (!result.dryRun && result.imported > 0) {
    process.stdout.write(
      `  the running daemon indexes them automatically; delete the whole set anytime\n` +
        `  by removing the ${result.folder}/ folder.\n`,
    );
  }
  return 0;
}

/** #211: print the next mining chunk for the AI session to distill. */
async function cmdImportMine(): Promise<number> {
  const chunk = await readNextChunk();
  if (!chunk) {
    process.stdout.write(
      "mining queue is empty — queue a data export first: bastra import <path/to/conversations.json>\n",
    );
    return 0;
  }
  process.stdout.write(
    `── import mining · ${chunk.conversations} conversation(s) in this chunk · ${chunk.remaining} remaining ──\n\n` +
      chunk.body +
      `\n\n── end of chunk ──\n` +
      `USER messages only, newest conversations first. Distill durable lessons, decisions and\n` +
      `preferences (skip one-off tasks, stale facts, code/log dumps) into one-line candidate\n` +
      `facts, then stage them for review:\n` +
      `  printf '%s\\n' "fact one" "fact two" | bastra import - ${chunk.source}\n` +
      (chunk.remaining > 0
        ? "Then run `bastra import mine` for the next chunk.\n"
        : "Queue drained — the staged candidates are distilled with the user via import-review.md.\n"),
  );
  return 0;
}

async function cmdImportClear(): Promise<number> {
  const st = await queueStatus();
  await clearQueue();
  process.stdout.write(
    st.remaining > 0
      ? `✓ mining queue cleared — ${st.remaining} pending conversation(s) discarded\n`
      : "mining queue is already empty\n",
  );
  return 0;
}
