/**
 * Import P3 (#209) — collect locally existing instruction files as import
 * candidates. Rules files (CLAUDE.md, AGENTS.md, Cursor rules) are dense
 * with durable preferences, so `bastra import rules` offers them through
 * the same `import-review.md` gate as #208. Only list lines are taken:
 * rules files encode one rule per bullet, while prose paragraphs rarely
 * hold one reviewable fact per line — the session distills accepted items
 * with the user anyway (they often contain project-specific noise).
 */
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractCandidates } from "./import-review.js";

/** A rules file offered for import, with a short label for the CLI output. */
export interface RulesFile {
  path: string;
  label: string;
}

const CWD_CANDIDATES = ["CLAUDE.md", "AGENTS.md", ".cursorrules"];

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Instruction files that exist at `cwd` (project rules) and in the user's
 * home (`~/.claude/CLAUDE.md`, global rules). `.cursor/rules/` is a
 * directory of rule files — every regular file in it counts.
 */
export async function findRulesFiles(cwd: string, home: string = homedir()): Promise<RulesFile[]> {
  const out: RulesFile[] = [];
  for (const name of CWD_CANDIDATES) {
    const path = join(cwd, name);
    if (await isFile(path)) out.push({ path, label: name });
  }
  try {
    const rulesDir = join(cwd, ".cursor", "rules");
    for (const entry of (await readdir(rulesDir)).sort()) {
      const path = join(rulesDir, entry);
      if (await isFile(path)) out.push({ path, label: join(".cursor/rules", entry) });
    }
  } catch {
    // no .cursor/rules directory
  }
  const globalClaude = join(home, ".claude", "CLAUDE.md");
  if (await isFile(globalClaude)) out.push({ path: globalClaude, label: "~/.claude/CLAUDE.md" });
  return out;
}

const LIST_LINE_RE = /^\s*(?:[-*•]|\d+[.)])\s+\S/;

/**
 * Rules-file markdown → candidate facts: keep list lines only (bullets,
 * numbering — nested included), skip fenced code blocks, then run the
 * shared candidate pipeline (clean, cap, dedupe) from #208.
 */
export function extractRulesCandidates(content: string): string[] {
  const kept: string[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (LIST_LINE_RE.test(line)) kept.push(line.trim());
  }
  return extractCandidates(kept.join("\n"));
}
