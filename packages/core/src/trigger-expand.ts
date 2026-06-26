/**
 * Trigger-Expander — doc2query-style write-time trigger expansion (#117).
 *
 * The far-recall problem: `recall_when` only fires when a query reuses its
 * words. A reworded query weeks later misses on the lexical layer. A query-time
 * cross-encoder would fix it but blows the 500 ms hook budget. So we move the
 * work to write time: a local LLM paraphrases title/summary/recall_when into
 * *different* words and we index those at a lower BM25 weight. The query path
 * stays byte-identical — the cost is paid once, offline, per memory.
 *
 * Pipeline (mirrors RelatedEnricher so the two compose on the same vault):
 *   EmbeddingIndex.onEmbed(id)
 *     → source unchanged (hash match)? → no-op   [breaks the reindex→embed loop]
 *     → else: chat() generates paraphrases
 *     → self-test filter (Doc2Query--): keep only paraphrases that retrieve
 *       their own memory — drops hallucinations, keeps the valuable far ones
 *       (the self-test is semantic, injected by the daemon as recallHybrid)
 *     → rewrite frontmatter (recall_when_expanded + _src), reindexFile
 *
 * Loop-prevention: the reindex re-embeds and re-fires onEmbed, but the source
 * hash now matches, so the second pass is a no-op. No file write, no loop.
 *
 * Concurrency with RelatedEnricher: both subscribe to onEmbed and rewrite the
 * SAME file. rewriteFile re-reads the file fresh immediately before writing and
 * mutates ONLY its own fields — so neither clobbers the other's (related_via vs
 * recall_when_expanded survive each other). The LLM gen takes ~1-3 s, well after
 * the in-memory related write lands, so the fresh read sees it.
 */
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import type { Vault } from "./vault.js";
import type { EmbeddingIndex } from "./embeddings.js";
import type { Memory } from "./schema.js";

/** Injected chat function: prompt in, raw model reply out (same shape the
 *  learned-recall reranker uses, so the daemon can pass `ollamaChat`). */
export type ChatFn = (prompt: string) => Promise<string>;

/** Injected self-test: does `paraphrase` retrieve `memoryId` (i.e. is it
 *  on-topic, not a hallucination)? The daemon wires this to recallHybrid so the
 *  test is semantic — a low-lexical-overlap far paraphrase still passes. */
export type SelfTestFn = (paraphrase: string, memoryId: string) => Promise<boolean>;

export interface TriggerExpanderOptions {
  chat: ChatFn;
  /** Self-test filter. Omit to keep every parsed paraphrase (not recommended —
   *  hallucinated paraphrases measurably lower recall). */
  selfTest?: SelfTestFn;
  /** Max paraphrases to keep per memory after filtering. Default 5. */
  maxPhrases?: number;
  /** Single-writer gate (cross-process), same contract as RelatedEnricher:
   *  returns false → skip the write (another process owns expansion). */
  writeGate?: () => boolean | Promise<boolean>;
  /** Run a one-shot backfill sweep over un-expanded memories on start().
   *  Default true. */
  backfillOnStart?: boolean;
}

const DEFAULT_MAX_PHRASES = 5;
/** Drop generated phrases longer than this — a paraphrase is a short query,
 *  not a sentence; long lines are usually the model narrating, not a trigger. */
const MAX_PHRASE_LEN = 80;

export class TriggerExpander {
  private detach?: () => void;
  private readonly chat: ChatFn;
  private readonly selfTest?: SelfTestFn;
  private readonly maxPhrases: number;
  private readonly writeGate?: () => boolean | Promise<boolean>;
  private readonly backfillOnStart: boolean;
  /** Guards against re-entrant expansion of the same id (onEmbed can fire again
   *  mid-generation). */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly vault: Vault,
    private readonly embeddings: EmbeddingIndex,
    opts: TriggerExpanderOptions,
  ) {
    this.chat = opts.chat;
    this.selfTest = opts.selfTest;
    this.maxPhrases = opts.maxPhrases ?? DEFAULT_MAX_PHRASES;
    this.writeGate = opts.writeGate;
    this.backfillOnStart = opts.backfillOnStart ?? true;
  }

  start(): void {
    if (this.detach) return;
    this.detach = this.embeddings.onEmbed((id) => {
      // expand() can reject — the Ollama chat may time out / abort. Swallow it
      // here so a failed expansion never becomes an unhandled promise rejection
      // that crashes the whole daemon. (The backfill path has its own catch.)
      void this.expand(id).catch(() => {});
    });
    if (this.backfillOnStart) void this.backfill().catch(() => {});
  }

  stop(): void {
    this.detach?.();
    this.detach = undefined;
  }

  /**
   * One-shot sweep over memories whose source changed since their last
   * expansion (or were never expanded). Sequential — one LLM call at a time is
   * the natural throttle so the backfill doesn't hammer Ollama. Fire-and-forget
   * from start(); errors per memory are swallowed so one bad memory can't stall
   * the sweep.
   */
  async backfill(): Promise<number> {
    let expanded = 0;
    for (const m of this.vault.list()) {
      if (m.fm.obsolete === true) continue;
      if (sourceHash(m) === m.fm.recall_when_expanded_src) continue; // up to date
      try {
        const r = await this.expand(m.fm.id);
        if (r) expanded++;
      } catch {
        /* one memory's failure must not stall the whole sweep */
      }
    }
    return expanded;
  }

  /**
   * Generate, filter, and persist paraphrases for one memory. Returns the kept
   * phrases, or null when nothing was written (source unchanged, gated out, or
   * no phrase survived the self-test).
   */
  async expand(id: string): Promise<string[] | null> {
    const memory = this.vault.get(id);
    if (!memory) return null;

    const srcHash = sourceHash(memory);
    // Source unchanged since last expansion → nothing to do. This is also what
    // breaks the reindex→re-embed→onEmbed loop after we write.
    if (srcHash === memory.fm.recall_when_expanded_src) return null;

    if (this.inFlight.has(id)) return null;
    this.inFlight.add(id);
    try {
      const raw = await this.chat(buildExpandPrompt(memory));
      const candidates = parseExpansions(raw, memory.fm.recall_when, this.maxPhrases);

      const kept: string[] = [];
      for (const phrase of candidates) {
        if (this.selfTest && !(await this.selfTest(phrase, id))) continue;
        kept.push(phrase);
      }

      // Persist even when kept is empty: writing the src hash marks "we tried,
      // source is X" so we don't regenerate this same source on every embed.
      if (this.writeGate && !(await this.writeGate())) return null;
      await rewriteFile(memory.filePath, kept, srcHash);
      await this.vault.reindexFile(memory.filePath);
      return kept;
    } finally {
      this.inFlight.delete(id);
    }
  }
}

/** Stable short hash of the fields a paraphrase is derived from. Changes iff
 *  the author edits title/summary/recall_when — which is exactly when the
 *  expansion is stale and must be regenerated. */
export function sourceHash(m: Memory): string {
  const src = JSON.stringify([m.fm.title, m.fm.summary, m.fm.recall_when]);
  return createHash("sha256").update(src).digest("hex").slice(0, 16);
}

/** Build the doc2query prompt: ask for short, reworded search phrases in the
 *  vault's bilingual register, deliberately avoiding the existing trigger words. */
export function buildExpandPrompt(m: Memory): string {
  return [
    "A user saved this personal memory. Write 3-5 alternative search queries they",
    "might type WEEKS LATER to find it again, using DIFFERENT words than the memory",
    "itself (synonyms, the problem described by its symptom or effect, related",
    "concepts).",
    "",
    "Rules:",
    "- Each line is a natural phrase a person would actually type into a search box,",
    '  like "why does my panel close by itself" or "fenster schließt sich von',
    '  selbst" — NOT a slug, tag, id, filename, or hyphen-chain like "panel-close-fix".',
    "- Use ONLY concepts that appear in the memory below. Never invent product names,",
    "  companies, people, dates, or files that are not in it.",
    "- Mix German and English naturally (the vault is bilingual).",
    "- One query per line. No numbering, no quotes, no commentary, no headings.",
    "",
    `Title: ${m.fm.title}`,
    `Summary: ${m.fm.summary}`,
    `Existing triggers: ${m.fm.recall_when.join(" | ")}`,
  ].join("\n");
}

/**
 * A slug/tag/id/filename chain — a single whitespace-free token glued by 2+
 * delimiters, or by mixed delimiters. The prompt forbids these ("NOT a slug ...
 * like panel-close-fix"), but a small local model emits them anyway, and a
 * length filter can't catch them (a slug is short). They poison the BM25 index
 * with noise terms, so they're dropped structurally rather than trusted to the
 * prompt.
 *
 * Deliberately keeps real single-token search terms: a clean word ("fenster"),
 * a 2-segment term ("z-index", "min-width", "ci/cd"), a version ("gpt-4"). Only
 * 3+-segment or mixed-delimiter glue reads as a slug. (A phrase with any
 * whitespace is a real query and never a slug.)
 */
export function isSlugChain(phrase: string): boolean {
  if (/\s/.test(phrase)) return false;
  const delims = phrase.match(/[-_/.]/g) ?? [];
  return delims.length >= 2 || new Set(delims).size >= 2;
}

/**
 * Parse the model's reply into clean phrases: split on lines, strip bullets/
 * numbering/quotes, drop empties, over-long lines, and slug-chains (see
 * isSlugChain), dedupe (case-insensitive) against each other AND the existing
 * triggers (a paraphrase that just repeats a trigger is dead weight), cap at
 * `max`.
 */
export function parseExpansions(raw: string, existing: string[], max: number): string[] {
  const seen = new Set(existing.map((t) => t.trim().toLowerCase()));
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const phrase = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "") // bullet / "1." / "1)"
      .replace(/^["'`]|["'`]$/g, "") // wrapping quotes
      .trim();
    if (!phrase || phrase.length > MAX_PHRASE_LEN || isSlugChain(phrase)) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Rewrite the memory file's frontmatter with the expanded triggers + source
 * hash, preserving body and every other field. Re-reads the file FRESH right
 * before writing (not the cached Memory) so a concurrent RelatedEnricher write
 * isn't clobbered. Atomic via temp+rename, same as RelatedEnricher.
 */
async function rewriteFile(filePath: string, expanded: string[], srcHash: string): Promise<void> {
  const raw = await readFile(filePath, "utf8");
  const parsed = matter(raw);
  // Copy, don't mutate parsed.data: gray-matter caches matter(content) by
  // string, so mutating the parsed object in place poisons that cache entry —
  // any later parse of identical content would inherit our fields.
  const fm = { ...(parsed.data as Record<string, unknown>) };
  fm.recall_when_expanded = expanded;
  fm.recall_when_expanded_src = srcHash;
  const next = matter.stringify(
    parsed.content.startsWith("\n") ? parsed.content : `\n${parsed.content}`,
    fm,
  );
  const tmp = `${filePath}.${process.pid}.expand.tmp`;
  await writeFile(tmp, next, "utf8");
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
