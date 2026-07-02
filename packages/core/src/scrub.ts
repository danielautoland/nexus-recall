/**
 * Injected-context scrubbing (#149) — the single inventory of block markers
 * that bastra's own hooks (and the Claude Code harness) inject into
 * conversations, plus helpers to strip complete blocks from text before it
 * re-enters an ingest path (stop-hook transcript heuristics, doc2query prompt
 * input) or to flag them at save time (save_quality advisory).
 *
 * Only a COMPLETE paired block (`<tag …>` … `</tag>`) counts as injected
 * context. A bare mention of a tag name — e.g. a memory documenting the hook
 * format itself — is deliberately left untouched, so memories ABOUT bastra's
 * own hooks stay writable.
 *
 * Why this exists: recalled context that gets quoted in a turn can otherwise
 * be re-captured as new memory content and re-indexed by doc2query — a
 * recursive pollution loop that skews trigger vocabulary and the heuristics'
 * file-token scans.
 *
 * Leaf module by design (like summary.ts): dependency-free, importable from
 * both core and daemon without creating import cycles.
 */

/**
 * Block tags treated as injected conversation scaffolding. First the blocks
 * bastra's hooks emit (see the hook sources in packages/daemon/src), then the
 * Claude Code harness blocks that appear inside transcripts.
 */
export const INJECTED_BLOCK_TAGS = [
  // bastra hook output
  "recall-hints",
  "session-context",
  "vault-taxonomy",
  "bastra-update",
  "pending-save-suggestions",
  "bastra-product-docs",
  "save-eval",
  "taxonomy-drift",
  // Claude Code harness injections
  "system-reminder",
  "command-name",
  "local-command-caveat",
] as const;

export type InjectedBlockTag = (typeof INJECTED_BLOCK_TAGS)[number];

/**
 * Fresh regex per call — a shared global-flagged RegExp carries lastIndex
 * state across calls, which is a classic source of skipped matches. The
 * construction cost is negligible at this call volume (≤ ~30 turns × 11 tags
 * per stop-hook run).
 */
function blockRe(tag: string): RegExp {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g");
}

export interface ScrubResult {
  text: string;
  /** Tags whose complete blocks were removed (deduped, inventory order). */
  removed: InjectedBlockTag[];
}

/**
 * Remove every complete injected block from `text`. Runs of 3+ newlines left
 * behind by removed blocks are collapsed to a blank line; everything else is
 * preserved verbatim. Idempotent.
 */
export function scrubInjectedBlocks(text: string): ScrubResult {
  const removed: InjectedBlockTag[] = [];
  let out = text;
  for (const tag of INJECTED_BLOCK_TAGS) {
    // Quick reject before paying for the regex — most texts carry no marker.
    if (!out.includes(`<${tag}`)) continue;
    const next = out.replace(blockRe(tag), "");
    if (next !== out) {
      removed.push(tag);
      out = next;
    }
  }
  if (removed.length > 0) out = out.replace(/\n{3,}/g, "\n\n");
  return { text: out, removed };
}

/**
 * Detect complete injected blocks without rewriting — for advisory paths
 * (save_quality) where content must never be silently modified.
 */
export function containsInjectedBlock(text: string): InjectedBlockTag[] {
  const found: InjectedBlockTag[] = [];
  for (const tag of INJECTED_BLOCK_TAGS) {
    if (!text.includes(`<${tag}`)) continue;
    if (blockRe(tag).test(text)) found.push(tag);
  }
  return found;
}
