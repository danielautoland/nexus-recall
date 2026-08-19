/**
 * #351: recall batch mode — several phrasings, ONE round trip.
 *
 * The model's ad-hoc call volume was the frequency half of #342 (zzalli:
 * blocking cost per turn ≈ calls × latency; the latency half shipped as the
 * vector deadline). Batching turns N proactive recalls into one tool call.
 *
 * Merge discipline: results interleave by the BEST original score per hit —
 * deliberately NOT re-fused into a new scale (RRF across queries), because
 * the tool description's 30/100 score bands are a contract the model acts
 * on; every returned score must remain a real single-query score.
 */

import { contentTokens } from "./save-similarity.js";

// ─── near-duplicate guard (zzalli's field report on #351) ───────────────────
// The design hope was 2-4 REAL paraphrases of one intent. What models send on
// a convoluted prompt is the opposite: every concept packed into query 1,
// then near-duplicate remixes of the same tokens. Those pay full search
// latency per sub-query and buy no fusion gain — so they are collapsed
// BEFORE searching, and the result carries a corrective note.

/** Two queries whose content-token Jaccard reaches this are the same intent
 *  in remixed words. Deliberately high: a GOOD paraphrase shares few content
 *  tokens (different vocabulary is the whole point of paraphrasing). */
export const BATCH_DUPLICATE_MIN = 0.6;

/** Jaccard overlap of the content-token sets (unicode-aware, umlaut-folded,
 *  stopword-free — same view the save-similarity lane compares with). */
export function queryOverlap(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

export interface BatchDedupe {
  /** Queries that actually run, in original order (first occurrence wins). */
  kept: string[];
  /** Near-duplicates that were collapsed away. */
  collapsed: string[];
  /** Highest pairwise overlap across ALL submitted queries — the telemetry
   *  measure for how paraphrase-shaped the model's batches really are. */
  max_overlap: number;
}

export function dedupeQueries(queries: string[]): BatchDedupe {
  const kept: string[] = [];
  const collapsed: string[] = [];
  let maxOverlap = 0;
  for (const q of queries) {
    let duplicate = false;
    for (const k of kept) {
      const overlap = queryOverlap(q, k);
      if (overlap > maxOverlap) maxOverlap = overlap;
      if (overlap >= BATCH_DUPLICATE_MIN) duplicate = true;
    }
    (duplicate ? collapsed : kept).push(q);
  }
  return { kept, collapsed, max_overlap: Math.round(maxOverlap * 100) / 100 };
}

/** The corrective note a collapsed batch carries back to the model. */
export function batchDuplicateNote(collapsedCount: number, total: number): string {
  return (
    `${collapsedCount} of ${total} queries were near-duplicates and were collapsed before searching. ` +
    `Each query in a batch must carry ONE distinct intent: a real paraphrase in different vocabulary, ` +
    `or a cleanly separated sub-question. Do not remix the same concepts into several queries.`
  );
}

export interface BatchSubResult {
  hits?: Array<{ id: string; score: number } & Record<string, unknown>>;
  vault_size?: number;
  recall_id?: string;
  weak_result?: boolean;
  no_home?: boolean;
}

export interface BatchMerged {
  query: string;
  query_count: number;
  vault_size: number | undefined;
  hits: Array<{ id: string; score: number } & Record<string, unknown>>;
  recall_id: string | undefined;
  recall_ids: string[];
  weak_result?: true;
  no_home?: true;
}

/** Dedupe by id keeping the best-scoring occurrence, resort, cut to k.
 *  weak_result/no_home only survive when EVERY sub-result carried them —
 *  one anchored phrasing is enough to make the batch answerable. */
export function mergeBatchResults(queries: string[], subs: BatchSubResult[], k: number): BatchMerged {
  const best = new Map<string, { id: string; score: number } & Record<string, unknown>>();
  const recallIds: string[] = [];
  let vaultSize: number | undefined;
  let weakAll = true;
  let noHomeAll = true;
  for (const s of subs) {
    if (typeof s.vault_size === "number") vaultSize = s.vault_size;
    if (typeof s.recall_id === "string") recallIds.push(s.recall_id);
    if (s.weak_result !== true) weakAll = false;
    if (s.no_home !== true) noHomeAll = false;
    for (const h of s.hits ?? []) {
      const existing = best.get(h.id);
      if (!existing || h.score > existing.score) best.set(h.id, h);
    }
  }
  const hits = [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  return {
    query: queries.join(" | "),
    query_count: queries.length,
    vault_size: vaultSize,
    hits,
    recall_id: recallIds[0],
    recall_ids: recallIds,
    ...(weakAll && subs.length > 0 ? { weak_result: true as const } : {}),
    ...(noHomeAll && subs.length > 0 ? { no_home: true as const } : {}),
  };
}
