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
