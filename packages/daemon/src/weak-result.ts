/**
 * #230 / #249 — the "nothing really matched" signal, shared by every recall path.
 *
 * On the hybrid path the score is a RANK quantity, not a similarity: a list
 * always has a first element, so a nonsense query still produces a top hit at
 * 130+. `weak_result` is the flag that says the high score is rank-1-of-nothing
 * rather than a real match.
 *
 * It lived inside `recallHandler` and therefore only ever reached the MCP path.
 * `/hook/recall` — the path that writes `<recall-hints>` into an agent's context
 * on every Bash and Edit — never formed it, so the hint blocks labelled
 * everything above the threshold as "Strong matches" including pure noise. In a
 * live session that meant the same handful of unrelated memories surfaced at
 * 150-160 for every `rm -rf` and every file edit.
 *
 * Extracted here so both paths compute the same thing from the same code. A
 * second implementation would have drifted, and the two paths disagreeing about
 * what "weak" means is worse than neither having it.
 */
import type { RecallHit } from "@bastra-recall/core";

/**
 * Did a lexical BM25 match (`matched_terms`) land in the hit's TITLE?
 *
 * `matched_terms` only says that a query term hit the document somewhere, not
 * in which field — so this checks the title string tolerantly (exact token, or
 * a prefix in either direction to absorb stemming). Tolerant by design: when in
 * doubt the hit counts as a title match, which keeps `weak_result` conservative
 * and stops it from firing falsely.
 */
export function hitTitleMatches(hit: RecallHit): boolean {
  if (!hit.matched_terms || hit.matched_terms.length === 0) return false;
  const titleTokens = hit.title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return hit.matched_terms.some((term) => {
    const t = term.toLowerCase();
    return titleTokens.some((tok) => tok === t || tok.startsWith(t) || t.startsWith(tok));
  });
}

/**
 * True when the hybrid path returned hits but none of them lexically anchors —
 * no `recall_when` match and no title match.
 *
 * Conservative on purpose: it only fires when the FULL hybrid path ran (both
 * arms, not the breaker-degraded BM25 fallback), because in BM25-only mode the
 * score is a genuine BM25 quantity and the floor already does this job. Purely
 * informational — it filters nothing.
 */
export function isWeakResult(hits: RecallHit[], hybridActive: boolean): boolean {
  return (
    hybridActive &&
    hits.length > 0 &&
    !hits.some((h) => h.matched_recall_when === true || hitTitleMatches(h))
  );
}
