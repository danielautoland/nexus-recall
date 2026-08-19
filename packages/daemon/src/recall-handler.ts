/**
 * Recall handler — the read path of the memory tools (#50/#9/#230/#351).
 * Split out of tool-handlers.ts (file-size convention); tool-handlers
 * re-exports everything, so the existing import paths keep working.
 */
import { z } from "zod";
import { truncateSummaryTo, hasUnresolvedConflict, type StageListener, type RecallStage, type RecallHit } from "@bastra-recall/core";
import { envInt } from "./env.js";
import { fireAndForget } from "./telemetry.js";
import { isWeakResult, isNoHome } from "./weak-result.js";
import { computeSalienceShadow } from "./salience-shadow.js";
import { computeTrustShadow, trustRankMode, usageForShadow } from "./trust-shadow.js";
import { commonsRankFactor } from "./cli/commons.js";
import { expandQuery } from "./learned-recall/bridges.js";
import { mergeBatchResults, dedupeQueries, batchDuplicateNote } from "./recall-batch.js";
import type { ToolDeps } from "./tool-deps.js";

export const RecallArgs = z.object({
  query: z.string().min(1).optional(),
  /** #351 batch mode: 2-4 phrasings, one round trip. Exactly one of
   *  query/queries must be present (enforced below). */
  queries: z.array(z.string().min(1)).min(2).max(4).optional(),
  /** #351: set internally on batched sub-recalls so telemetry can count the
   *  batch width (query_count on the recall event). */
  batch_of: z.number().int().min(2).max(4).optional(),
  /** Internal, batch only: highest pairwise content-token overlap across the
   *  submitted queries — logged so "the model remixes instead of
   *  paraphrasing" (zzalli) stays measurable, not anecdotal. */
  batch_overlap: z.number().min(0).max(1).optional(),
  /** Internal, batch only: how many near-duplicate queries the guard
   *  collapsed before searching. */
  batch_collapsed: z.number().int().min(0).optional(),
  k: z.number().int().min(1).max(20).optional(),
  scope: z.string().optional(),
  type: z.string().optional(),
  /**
   * Sensitivity-Filter (#58). Default `false` — externe MCP-Caller (Claude
   * Code, Cursor, …) sehen nie `sensitivity: private` Memories. Die Bastra-
   * Mac-App ruft mit `allow_private: true` und sieht den vollen Vault.
   */
  allow_private: z.boolean().optional(),
  /**
   * Multi-Hop-Recall (#30 / #51). Default `0`. Bei `1` liefert der Server
   * zusätzlich zu den direkten Treffern deren 1-Hop-Nachbarn (Memories,
   * die per `related_via` verbunden sind), mit reduziertem Score und
   * `hop: "1-hop"` im Result. Höhere Hop-Tiefen werden aktuell nicht
   * unterstützt — der Wert ist auf 0 oder 1 begrenzt.
   */
  expand_hops: z.number().int().min(0).max(1).optional(),
  /**
   * Payload-Verbosity (#50). Default `"lean"` — pro Hit nur
   * `id, title, type, scope, summary, score`; `matched_terms`, `mode`,
   * `hop`, `topic_path` und der `stages`-Block fallen weg. Das Modell stockt
   * bei Bedarf via `load_memory` auf (Multistep-Validation). `"full"` liefert
   * alle Felder — für die Mac-App / Debug.
   */
  verbosity: z.enum(["lean", "full"]).optional(),
  /**
   * Score-Floor (#50 / #9). Default `BASTRA_RECALL_FLOOR` (30, spiegelt den
   * Hook + die SKILL.md-Linie „score < 30 = noise"). Hits darunter werden
   * gar nicht erst zurückgegeben, damit Tail-Rauschen keinen Context frisst.
   * Caller können enger ziehen.
   */
  min_score: z.number().min(0).optional(),
});

// ─── Recall ──────────────────────────────────────────────────────

export interface RecallResult {
  query: string;
  vault_size: number;
  hits: unknown[];
  recall_id: string;
  latency_ms: number;
  /** #230: Hybrid-only Ehrlichkeits-Signal. `true`, wenn KEIN zurückgegebener
   *  Hit lexikalisch anknüpft (weder `matched_recall_when` noch ein Titel-Match).
   *  Der Hybrid-Score ist eine Rang-Größe — ein Top-Hit trägt auch bei einer
   *  Nonsens-Query einen hohen Score (rank-1-of-nothing). Reine Information,
   *  filtert nichts. Fehlt (statt `false`), wenn nicht weak — hält lean schlank. */
  weak_result?: boolean;
  /** #230: strikte Teilmenge von `weak_result` — der Top-Hit lebt nur in EINEM
   *  Arm, die Form eines wirklich abwesenden Facts. Getrennt gehalten, weil es
   *  die höhere Konfidenz-Stufe ist; zusammengelegt ginge genau die
   *  Unterscheidung verloren, die den Wert ausmacht. */
  no_home?: boolean;
}

/**
 * Pro-Stage-Dauern in ms (#38). Caller-agnostisch — sowohl der
 * MCP-Stdio-Handler als auch HTTP-SSE und der Telemetry-Pfad bekommen
 * dieselben Bucket-Namen. Wird in `recall_call`-JSONL-Logs als
 * `recall_stages` mitgeschrieben, um Bottlenecks zu identifizieren.
 */
export interface RecallStageTimings {
  query_parse_ms?: number;
  bm25_search_ms?: number;
  vector_search_ms?: number;
  rrf_fuse_ms?: number;
  hops_expand_ms?: number;
  staleness_rank_ms?: number;
  cache_hit?: boolean;
}

/** Stage-Namen → ms-Bucket in `RecallStageTimings`. `cache_hit` ist
 *  bewusst nicht hier — der ist ein boolean und wird separat gesetzt. */
type StageMsKey = "query_parse_ms" | "bm25_search_ms" | "vector_search_ms" | "rrf_fuse_ms" | "hops_expand_ms" | "staleness_rank_ms";

const STAGE_TO_TIMING_KEY: Partial<Record<RecallStage["name"], StageMsKey>> = {
  "query.parse": "query_parse_ms",
  "bm25.search": "bm25_search_ms",
  "vector.search": "vector_search_ms",
  "rrf.fuse": "rrf_fuse_ms",
  "hops.expand": "hops_expand_ms",
  "staleness.rank": "staleness_rank_ms",
};

/**
 * Sammelt Stage-Timings und fan-out zu einem optional externen Listener
 * (MCP-progress-notification oder HTTP-SSE). Der Caller bekommt die
 * Stage-Bucket-Map zurück, sobald `recall()` resolved ist — die Werte
 * landen dann in der Telemetrie.
 */
function makeStageCollector(forward?: StageListener): { listener: StageListener; timings: RecallStageTimings } {
  const timings: RecallStageTimings = {};
  const listener: StageListener = (stage: RecallStage) => {
    forward?.(stage);
    if (stage.name === "cache.hit") {
      timings.cache_hit = true;
      return;
    }
    if (stage.durationMs === undefined) return;
    const key = STAGE_TO_TIMING_KEY[stage.name];
    if (!key) return;
    // Stop-Events kommen nach Start-Events — durch das Überschreiben
    // (statt += ) bleibt der finale Wert die echte Dauer.
    timings[key] = stage.durationMs;
  };
  return { listener, timings };
}

/** Score-Floor (#50 / #9): Hits darunter sind Rauschen und werden nicht
 *  zurückgegeben. Spiegelt `SCORE_FLOOR` aus hook.ts + die SKILL.md-Linie. */
const RECALL_FLOOR = envInt("BASTRA_RECALL_FLOOR", 30);


/** Max-Länge der `summary` im lean-Modus (#50). Lang genug zum Validieren,
 *  kurz genug um Context zu sparen. `verbosity:"full"` umgeht das. */
const LEAN_SUMMARY_MAX = 160;

/** Kürzt auf max. `LEAN_SUMMARY_MAX` Zeichen an der letzten Wortgrenze und
 *  hängt „…" an. Nie mitten im Wort. Kürzere Summaries bleiben unverändert. */
export const truncateSummary = (summary: string): string =>
  truncateSummaryTo(summary, LEAN_SUMMARY_MAX);

/** Schlanke Pro-Hit-Projektion (#50): nur die Felder, die das Modell zum
 *  Validieren braucht. Dropt `matched_terms` (größter variabler Fresser),
 *  `mode`, `hop`, `topic_path` und kürzt `summary` auf einen Snippet.
 *  `verbosity:"full"` liefert alle Felder + volle summary. */
export function toLeanHit(hit: RecallHit): Pick<RecallHit, "id" | "title" | "type" | "scope" | "summary" | "score"> {
  return {
    id: hit.id,
    title: hit.title,
    type: hit.type,
    scope: hit.scope,
    summary: truncateSummary(hit.summary),
    score: hit.score,
  };
}


export async function recallHandler(
  deps: ToolDeps,
  rawArgs: unknown,
  options: { onStage?: StageListener } = {},
): Promise<RecallResult & { stages?: RecallStageTimings }> {
  const parsed = RecallArgs.safeParse(rawArgs);
  if (!parsed.success) throw new Error(parsed.error.message);

  // #351 batch mode: run each phrasing through the full single pipeline
  // (own recall_id + telemetry — the reach-join and bridge minting key on
  // per-query events), then merge by best original score (recall-batch.ts).
  if (parsed.data.queries) {
    if (parsed.data.query) throw new Error("pass query OR queries, not both");
    const { queries, ...rest } = parsed.data;
    // zzalli's #351 field report: on convoluted prompts models send concept
    // remixes instead of paraphrases. Near-duplicates are collapsed BEFORE
    // searching (they pay latency and buy no fusion gain); the note teaches.
    const { kept, collapsed, max_overlap } = dedupeQueries(queries);
    const subs = await Promise.all(
      kept.map((q) =>
        recallHandler(deps, {
          ...rest,
          query: q,
          batch_of: queries.length,
          batch_overlap: max_overlap,
          batch_collapsed: collapsed.length,
        }),
      ),
    );
    const merged = mergeBatchResults(
      kept,
      subs as Parameters<typeof mergeBatchResults>[1],
      parsed.data.k ?? 5,
    );
    return {
      ...merged,
      query_count: queries.length,
      recall_id: merged.recall_id ?? "",
      vault_size: merged.vault_size ?? deps.vault.size(),
      latency_ms: subs.reduce((m, s) => Math.max(m, s.latency_ms ?? 0), 0),
      ...(collapsed.length > 0
        ? { queries_collapsed: collapsed.length, note: batchDuplicateNote(collapsed.length, queries.length) }
        : {}),
    };
  }
  const query = parsed.data.query;
  if (!query) throw new Error("query or queries required");

  const t0 = Date.now();
  const collector = makeStageCollector(options.onStage);
  // #121: capture the deeper candidate pool (incl. below-floor) for the far slice.
  let candidatePool: { id: string; score: number }[] = [];
  const recallOpts = {
    k: parsed.data.k,
    scope: parsed.data.scope,
    type: parsed.data.type,
    allow_private: parsed.data.allow_private ?? false,
    expand_hops: parsed.data.expand_hops as 0 | 1 | undefined,
    onStage: collector.listener,
    onCandidatePool: (pool: RecallHit[]) => {
      candidatePool = pool.map((h) => ({ id: h.id, score: h.score }));
    },
  };
  // Shared learned-recall (#120): widen the query with language-matched bridge
  // expansion terms before searching. No-op when the layer is off (null pool) or
  // the query language abstains. Telemetry below still logs the ORIGINAL query;
  // the expansion is recorded separately so its effect is measurable.
  const expansion = expandQuery(query, deps.learnedBridges, {
    configuredLang: deps.sharedRecallLang ?? null,
  });
  // #165: VOR dem Recall ausgewertet — der Flag muss den Recall beschreiben,
  // der gleich serviert wird. Post-Recall könnte ein parallel fehlschlagender
  // Backfill-Batch den Breaker öffnen und einen gesunden Hybrid-Recall
  // fälschlich als degraded loggen (bzw. ein Probe-Erfolg das Umgekehrte).
  const embeddingDegraded = deps.search.hasEmbeddings() && (deps.embeddingDegraded?.() ?? false);
  let rawHits = deps.search.hasEmbeddings()
    ? await deps.search.recallHybrid(expansion.query, recallOpts)
    : deps.search.recall(expansion.query, recallOpts);

  // Bastra Commons (read-only Zusatz-Index): zweite BM25-Runde, gedämpft
  // fusioniert. Bei ID-Kollision gewinnt das persönliche Memory. Ein
  // expliziter scope-Filter (außer "commons") überspringt die Fusion.
  if (deps.commonsSearch && (!parsed.data.scope || parsed.data.scope === "commons")) {
    const commonsHits = deps.commonsSearch
      .recall(query, { k: recallOpts.k, type: parsed.data.type })
      .map((h) => {
        const v = deps.commonsVerifications?.get(h.id) ?? { works: 0, fails: 0 };
        return { ...h, score: h.score * commonsRankFactor(v.works, v.fails) };
      });
    const ownIds = new Set(rawHits.map((h) => h.id));
    rawHits = [...rawHits, ...commonsHits.filter((h) => !ownIds.has(h.id))]
      .sort((a, b) => b.score - a.score)
      .slice(0, recallOpts.k ?? 5);
  }
  const latencyMs = Date.now() - t0;

  // Prong 3 (#50 / #9): Sub-Floor-Rauschen gar nicht erst zurückgeben.
  const floor = parsed.data.min_score ?? RECALL_FLOOR;
  const hits = rawHits.filter((h) => h.score >= floor);
  const droppedBelowFloor = rawHits.length - hits.length;

  // #230: No-answer-Signal. Der Hybrid-Score ist eine skalierte Rang-Summe —
  // ein Top-Hit trägt auch bei einer Nonsens-Query einen hohen Score, weil eine
  // Liste immer ein erstes Element hat. Konservativ: feuert nur, wenn der volle
  // Hybrid-Pfad lief (beide Arme — nicht der Breaker-degradierte BM25-Fallback)
  // UND KEIN zurückgegebener Hit lexikalisch anknüpft (weder recall_when- noch
  // Titel-Match). Rein informativ, filtert nichts.
  const hybridActive = deps.search.hasEmbeddings() && !embeddingDegraded;
  const weakResult = isWeakResult(hits, hybridActive);
  // #230: the stricter claim — not just "nothing anchored" but "this fact has
  // no home here". Strict subset of weakResult, so it can only ever narrow it.
  const noHome = isNoHome(hits, hybridActive);

  // #217: would-be Salience-Reihenfolge (shadow-only, servierte Hits bleiben).
  const salienceShadow = computeSalienceShadow(
    hits,
    (id) => deps.vault.get(id)?.fm as Record<string, unknown> | undefined,
  );

  const recallId = deps.telemetry.newRecallId();
  // #160: would-be order under the usage-driven trust multiplier. Reads the
  // cached aggregate synchronously and refreshes it in the background, so the
  // telemetry event is written exactly as promptly as before — see
  // `usageForShadow` for why awaiting the read here would be the worse trade.
  const trustShadow =
    trustRankMode() === "shadow"
      ? computeTrustShadow(hits, (id) => usageForShadow(deps.vaultPath)[id])
      : undefined;

  fireAndForget(
    deps.telemetry.logRecall({
        recall_id: recallId,
        query: query,
        // #351: batch width when this recall is one phrasing of a batch.
        query_count: parsed.data.batch_of,
        batch_overlap: parsed.data.batch_overlap,
        batch_collapsed: parsed.data.batch_collapsed,
        k: parsed.data.k ?? null,
        scope: parsed.data.scope ?? null,
        type: parsed.data.type ?? null,
        vault_size: deps.vault.size(),
        hit_count: hits.length,
        top_score: hits[0]?.score ?? null,
        hits: hits.map((h) => ({ id: h.id, score: h.score, type: h.type })),
        latency_ms: latencyMs,
        recall_stages: collector.timings,
        dropped_below_floor: droppedBelowFloor,
        // #249: the flag has to be recorded on every path, not only returned.
        weak_result: weakResult || undefined,
        no_home: noHome || undefined,
        bridge_expansion:
          expansion.lang && expansion.added.length > 0
            ? { lang: expansion.lang, added: expansion.added }
            : undefined,
        candidate_pool: candidatePool.length > 0 ? candidatePool : undefined,
        embedding_degraded: embeddingDegraded ? true : undefined,
        salience_shadow: salienceShadow,
        trust_shadow: trustShadow,
    }),
  );

  // Prong 1 (#50): lean-by-default. `verbosity: "full"` liefert alle
  // Felder + den stages-Block (Mac-App / Debug).
  const full = parsed.data.verbosity === "full";
  // #205: ein Hit auf ein Memory mit ungelöstem Konflikt-Block trägt das
  // Flag — das Modell kann „der Vault widerspricht sich hier" sagen, statt
  // selbstbewusst eine Seite zu servieren. Nur gesetzt wenn true (lean).
  const flagConflict = (h: { id: string }): unknown =>
    hasUnresolvedConflict(deps.vault.get(h.id)?.body) ? { ...h, conflict: true } : h;
  return {
    query: query,
    vault_size: deps.vault.size(),
    hits: (full ? hits : hits.map(toLeanHit)).map(flagConflict),
    recall_id: recallId,
    latency_ms: latencyMs,
    // #230: nur setzen wenn true — Abwesenheit = nicht weak, hält lean schlank.
    ...(weakResult ? { weak_result: true } : {}),
    ...(noHome ? { no_home: true } : {}),
    ...(full ? { stages: collector.timings } : {}),
  };
}
