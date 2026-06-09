import MiniSearch from "minisearch";
import type { Memory } from "@bastra-recall/core";

/**
 * Field-weight map mirrored by hand from @bastra-recall/core `SearchIndex`
 * (packages/core/src/search.ts -> searchOptions.boost). The ONLY knob this
 * harness varies between control and treatment is the `recall_when` field, so
 * the two indexes differ on exactly one dimension and nothing else. If the
 * boosts in core ever change, update them here too — there is a guard test
 * that fails if the two drift apart.
 */
export const BASE_BOOST = {
  title: 4,
  tags_flat: 3,
  topic_path_flat: 2,
  summary: 2,
  body: 1,
} as const;

/** core's production weight for the dedicated trigger field. */
export const TREATMENT_RECALL_WHEN_BOOST = 5;

/** Search options pinned to core so the ablation is apples-to-apples. */
const SEARCH_OPTIONS = {
  fuzzy: 0.2,
  prefix: true,
  combineWith: "OR" as const,
};

interface IndexDoc {
  id: string;
  title: string;
  summary: string;
  tags_flat: string;
  recall_when_flat: string;
  topic_path_flat: string;
  body: string;
}

/** Flatten a Memory into the BM25 doc, mirroring core `indexOne()`. */
function toDoc(m: Memory): IndexDoc {
  const fm = m.fm;
  return {
    id: fm.id,
    title: fm.title,
    summary: fm.summary,
    tags_flat: fm.tags.join(" "),
    recall_when_flat: fm.recall_when.join(" \n "),
    topic_path_flat: fm.topic_path.join(" "),
    body: m.body,
  };
}

export type Arm =
  | { kind: "control" } // recall_when removed from the searchable fields
  | { kind: "treatment"; boost: number }; // recall_when indexed at `boost`

/**
 * Build a BM25 index over `memories`.
 *
 * - control:   `recall_when` is NOT a searchable field at all (stripped). A
 *   query term that lives only in recall_when cannot retrieve the doc.
 * - treatment: `recall_when` indexed and boosted at `boost` (core uses 5),
 *   every other field weight identical to control.
 *
 * Stripping the field outright (rather than zero-weighting it) avoids the
 * MiniSearch quirk where a boost of 0 still lets the doc surface at score 0.
 */
export function buildIndex(memories: Memory[], arm: Arm): MiniSearch<IndexDoc> {
  const fields = ["title", "summary", "tags_flat", "topic_path_flat", "body"];
  const boost: Record<string, number> = { ...BASE_BOOST };
  if (arm.kind === "treatment") {
    fields.push("recall_when_flat");
    boost.recall_when_flat = arm.boost;
  }

  const mini = new MiniSearch<IndexDoc>({
    fields,
    storeFields: ["id"],
    searchOptions: { boost, ...SEARCH_OPTIONS },
  });
  mini.addAll(memories.map(toDoc));
  return mini;
}

/** 1-based rank of `goldId` in results; 0 means not found. */
export function rankOf(results: { id: string }[], goldId: string): number {
  const i = results.findIndex((r) => r.id === goldId);
  return i === -1 ? 0 : i + 1;
}

/** Top-1 raw score (or 0 if nothing matched) — used by the anti-trigger slice. */
export function topScore(results: { score: number }[]): number {
  return results.length > 0 ? results[0].score : 0;
}
