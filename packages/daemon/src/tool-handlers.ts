/**
 * Tool-Handler — pure logic, transport-agnostic.
 *
 * Jeder Handler nimmt {deps, args} und liefert ein plain JSON-Objekt zurück
 * (oder wirft Error mit Message). Wrapping ist Aufgabe der Caller:
 *   - index.ts wrappt für MCP-stdio (content/isError)
 *   - http.ts wrappt für REST (status code + JSON body)
 *
 * Damit teilen sich beide Pfade dieselbe Validierung, Telemetry und
 * Vault-Mutation — kein doppelter Code, kein Drift.
 */
import { relative, dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod";
import {
  saveMemory,
  slugify,
  moveToTrash,
  truncateSummaryTo,
  SaveMemoryInput,
  stripAutoRelatedSection,
  containsInjectedBlock,
  type Vault,
  type SearchIndex,
  type StageListener,
  type RecallStage,
  type RecallHit,
  scanForInjection,
  formatInjectionAdvisory,
} from "@bastra-recall/core";
import { Telemetry, fireAndForget } from "./telemetry.js";
import { computeSalienceShadow } from "./salience-shadow.js";
import { touchLoadedMarker } from "./session-state.js";
import { envInt } from "./env.js";
import { commonsRankFactor } from "./cli/commons.js";
import { expandQuery, type BridgePool } from "./learned-recall/bridges.js";
import { detectLanguage, type SupportedLanguage } from "./learned-recall/language.js";

export interface ToolDeps {
  vault: Vault;
  search: SearchIndex;
  telemetry: Telemetry;
  vaultPath: string;
  /** Read-only Bastra-Commons-Index (BM25-only), wenn `bastra commons enable`
   *  aktiv ist. Hits tragen scope "commons" aus ihrem Frontmatter — kein
   *  eigenes source-Feld nötig. */
  commonsSearch?: SearchIndex | null;
  /** works/fails-Zählung aus den Verification-Records pro Rezept-ID — die
   *  Evidenz, die das Fusion-Ranking hebt oder senkt (verify-Loop). */
  commonsVerifications?: Map<string, { works: number; fails: number }> | null;
  /** Read-only, language-partitioned learned-recall bridge pool (#120), present
   *  only when `bastra bridges enable` is active. Used to widen the recall query;
   *  null/absent = feature off, query untouched (local-first guarantee). */
  learnedBridges?: BridgePool | null;
  /** Optional query-language override for the bridge pool (sharedRecall.language);
   *  null/absent = auto-detect the query language per recall. */
  sharedRecallLang?: SupportedLanguage | null;
  /** #165: true while the embedding circuit breaker is open — hybrid recall
   *  is silently served BM25-only (no embed attempt). Recall telemetry flags
   *  those events as embedding_degraded. Absent = no breaker (embeddings off). */
  embeddingDegraded?: () => boolean;
  /** #231 (language-first recall): the user's primary authoring language
   *  (settings `language.primary`), resolved once at daemon startup like
   *  `sharedRecallLang`. When set and ≠ "en", scoreSaveQuality advises when a
   *  save's recall_when reads as English — author triggers in the user's
   *  language, keep English tech terms as anchors. Absent = no language signal
   *  (the check never fires). */
  primaryLanguage?: string;
}

// ─── Zod-Schemas ────────────────────────────────────────────────

export const RecallArgs = z.object({
  query: z.string().min(1),
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

export const LoadMemoryArgs = z.object({
  id: z.string().min(1),
  /** Spiegelt `RecallArgs.allow_private` — verhindert dass externe Clients
   *  Private-Memories per ID-Enumeration laden. Default `false`. */
  allow_private: z.boolean().optional(),
  /**
   * Payload-Verbosity (#50). Default `"lean"` — essenzielle Frontmatter
   * (id, title, type, scope, summary, topic_path, tags, recall_when,
   * related, created, updated) + body OHNE den Auto-Related-Block. `"full"`
   * liefert die komplette Frontmatter (related_via-Cosines, source,
   * confidence, …) + unbearbeiteten body — für die Mac-App / Debug.
   */
  verbosity: z.enum(["lean", "full"]).optional(),
});

export { SaveMemoryInput };

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

/** #230: Hat ein lexikalischer BM25-Treffer (`matched_terms`) im TITEL des Hits
 *  gematcht? `matched_terms` sagt nur, DASS ein Query-Term irgendwo im Dokument
 *  traf, nicht in welchem Feld — deshalb hier tolerant gegen den Titel-String
 *  geprüft (exaktes Token oder Präfix in beide Richtungen, um Stemming
 *  abzufangen). Tolerant by design: im Zweifel gilt der Hit als Titel-Match,
 *  damit `weak_result` konservativ bleibt und nicht fälschlich feuert. */
function hitTitleMatches(hit: RecallHit): boolean {
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

export async function recallHandler(
  deps: ToolDeps,
  rawArgs: unknown,
  options: { onStage?: StageListener } = {},
): Promise<RecallResult & { stages?: RecallStageTimings }> {
  const parsed = RecallArgs.safeParse(rawArgs);
  if (!parsed.success) throw new Error(parsed.error.message);

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
  const expansion = expandQuery(parsed.data.query, deps.learnedBridges, {
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
      .recall(parsed.data.query, { k: recallOpts.k, type: parsed.data.type })
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
  const weakResult =
    hybridActive && hits.length > 0 && !hits.some((h) => h.matched_recall_when === true || hitTitleMatches(h));

  // #217: would-be Salience-Reihenfolge (shadow-only, servierte Hits bleiben).
  const salienceShadow = computeSalienceShadow(
    hits,
    (id) => deps.vault.get(id)?.fm as Record<string, unknown> | undefined,
  );

  const recallId = deps.telemetry.newRecallId();
  fireAndForget(
    deps.telemetry.logRecall({
      recall_id: recallId,
      query: parsed.data.query,
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
      bridge_expansion:
        expansion.lang && expansion.added.length > 0 ? { lang: expansion.lang, added: expansion.added } : undefined,
      candidate_pool: candidatePool.length > 0 ? candidatePool : undefined,
      embedding_degraded: embeddingDegraded ? true : undefined,
      salience_shadow: salienceShadow,
    }),
  );

  // Prong 1 (#50): lean-by-default. `verbosity: "full"` liefert alle
  // Felder + den stages-Block (Mac-App / Debug).
  const full = parsed.data.verbosity === "full";
  return {
    query: parsed.data.query,
    vault_size: deps.vault.size(),
    hits: full ? hits : hits.map(toLeanHit),
    recall_id: recallId,
    latency_ms: latencyMs,
    // #230: nur setzen wenn true — Abwesenheit = nicht weak, hält lean schlank.
    ...(weakResult ? { weak_result: true } : {}),
    ...(full ? { stages: collector.timings } : {}),
  };
}

// ─── Load Memory ─────────────────────────────────────────────────

export interface LoadMemoryResult {
  id: string;
  frontmatter: Record<string, unknown>;
  body: string;
  file_path: string;
  /** Nur bei Commons-Rezepten: Evidenz-Zähler + verify-Aufforderung. */
  commons?: { works: number; fails: number; verify_hint: string };
}

/** Frontmatter-Felder, die das Modell zum Anwenden eines Memorys braucht.
 *  Debug-/Vault-Interna (related_via-Cosines, source, confidence,
 *  sensitivity, affects_files, issues, categories, valid_until) fallen im
 *  lean-Modus weg (#50). */
const LEAN_FRONTMATTER_KEYS = [
  "id",
  "title",
  "type",
  "scope",
  "summary",
  "topic_path",
  "tags",
  "recall_when",
  "related",
  "created",
  "updated",
  // #217: Valenz + Reflex — das Modell muss beim Anwenden/Promoten den
  // Ist-Zustand sehen (z.B. recall_mode vor einem Promotion-Confirm).
  "salience",
  "emotion",
  "recall_mode",
] as const;

/** Projiziert die volle Frontmatter auf die lean-Teilmenge. Unbekannte/
 *  fehlende Keys werden übersprungen. */
export function leanFrontmatter(fm: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of LEAN_FRONTMATTER_KEYS) {
    if (fm[key] !== undefined) out[key] = fm[key];
  }
  return out;
}

export async function loadMemoryHandler(
  deps: ToolDeps,
  rawArgs: unknown,
  // #74: echte CC-Session aus den Forwarder-Headern (HTTP-Pfad). Ohne sie
  // fällt recordLoadedMemory auf den zuletzt rotierten Turn zurück (inferred).
  ctx?: { sessionId?: string | null },
): Promise<LoadMemoryResult> {
  const parsed = LoadMemoryArgs.safeParse(rawArgs);
  if (!parsed.success) throw new Error(parsed.error.message);

  // Commons-Fallback: persönlicher Vault gewinnt; nur wenn die ID dort
  // nicht existiert, wird im read-only Commons-Index nachgeschlagen.
  const own = deps.search.loadFull(parsed.data.id);
  const m = own ?? deps.commonsSearch?.loadFull(parsed.data.id);
  const fromCommons = !own && m !== undefined;
  const hookHint = deps.telemetry.findHookHintFor(parsed.data.id);
  fireAndForget(
    deps.telemetry.logLoadMemory({
      id: parsed.data.id,
      found: !!m,
      follows_recall: deps.telemetry.recentRecallId(),
      from_hook_recall: hookHint?.recall_id ?? null,
      hook_hint_rank: hookHint?.rank ?? null,
    }),
  );

  if (!m) throw new Error(`memory not found: ${parsed.data.id}`);

  // Sensitivity-Filter (#58): externe Caller sehen Private-Memories
  // nicht — auch nicht über direkte ID-Lookups. Mac-App overridet mit
  // `allow_private: true`.
  const allowPrivate = parsed.data.allow_private ?? false;
  if (
    !allowPrivate &&
    (m.fm as { sensitivity?: string }).sensitivity === "private"
  ) {
    throw new Error(`memory not found: ${parsed.data.id}`);
  }

  const bodyForTelemetry = stripAutoRelatedSection(m.body);
  deps.telemetry.recordLoadedMemory({
    memory_id: parsed.data.id,
    distinctive_tokens: distinctiveTokensForActedOn(bodyForTelemetry),
    hook_hint: hookHint
      ? { recall_id: hookHint.recall_id, score: hookHint.score }
      : null,
    session_id: ctx?.sessionId ?? null,
  });

  // Reset-signal for the hook's per-session dedup (#32): touch a marker
  // file so the next hook invocation knows the agent has consumed this
  // memory and the dedup clock should restart.
  fireAndForget(touchLoadedMarker(parsed.data.id));

  // Lean-by-default (#50): essenzielle Frontmatter + body ohne den
  // Auto-Related-Block. `verbosity: "full"` liefert alles (Mac-App / Debug).
  const full = parsed.data.verbosity === "full";
  const fm = m.fm as unknown as Record<string, unknown>;
  // verify-Loop: ein Commons-Rezept, das geladen (und gleich angewendet)
  // wird, bringt seine Evidenz + die Aufforderung mit, das Ergebnis zu
  // verewigen — der Agent schließt den Kreis am Ort des Geschehens.
  const verifyBlock = fromCommons
    ? {
        commons: {
          ...(deps.commonsVerifications?.get(m.fm.id) ?? { works: 0, fails: 0 }),
          verify_hint: `After applying this recipe, record the outcome: bastra commons verify ${m.fm.id} works|fails ["env note"]`,
        },
      }
    : {};
  return {
    id: m.fm.id,
    frontmatter: full ? fm : leanFrontmatter(fm),
    body: full ? m.body : bodyForTelemetry,
    file_path: m.filePath,
    ...verifyBlock,
  };
}

// ─── Save Memory ─────────────────────────────────────────────────

export interface SaveQualityResult {
  /** 0-100 advisory score: higher means more specific, less duplicative triggers. */
  score: number;
  band: "low" | "medium" | "high";
  issues: string[];
  suggestions: string[];
  duplicate_candidates: Array<{ id: string; score: number; title: string }>;
  trigger_collisions: Array<{ trigger: string; count: number; examples: string[] }>;
}

export interface SaveMemoryResult {
  id: string;
  file_path: string;
  created: boolean;
  /** Advisory save-time quality signal for the agent; not persisted. */
  save_quality: SaveQualityResult;
  /** Present only when saveMemory auto-truncated an over-long summary. */
  summary_note?: string;
  /** #150: terminal success marker — tells the model not to re-issue the save. */
  note?: string;
}

export const GENERIC_TRIGGER_WORDS = new Set([
  "api",
  "app",
  "auth",
  "bug",
  "code",
  "css",
  "data",
  "db",
  "debug",
  "design",
  "docs",
  "error",
  "fix",
  "frontend",
  "ios",
  "js",
  "macos",
  "memory",
  "node",
  "python",
  "react",
  "refactor",
  "server",
  "swift",
  "test",
  "typescript",
  "ui",
  "ux",
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
}

const ACTED_ON_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "because",
  "been",
  "before",
  "between",
  "from",
  "have",
  "into",
  "that",
  "their",
  "then",
  "there",
  "this",
  "through",
  "with",
  "without",
  "would",
]);

export function distinctiveTokensForActedOn(text: string): string[] {
  return Array.from(
    new Set(
      words(text)
        .filter((token) => token.length >= 4)
        .filter((token) => !ACTED_ON_STOPWORDS.has(token))
        .filter((token) => !GENERIC_TRIGGER_WORDS.has(token)),
    ),
  ).slice(0, 200);
}

function triggerSpecificityIssue(trigger: string): string | undefined {
  const tokens = words(trigger);
  if (tokens.length <= 1) return `recall_when '${trigger}' is too short/generic`;
  if (tokens.length <= 2 && tokens.every((t) => GENERIC_TRIGGER_WORDS.has(t))) {
    return `recall_when '${trigger}' is only generic technology words`;
  }
  return undefined;
}

function buildSpecificTriggerSuggestion(input: SaveMemoryInput): string {
  const path = input.topic_path.join("/") || input.scope;
  const summaryTokens = words(input.summary)
    .filter((t) => !GENERIC_TRIGGER_WORDS.has(t))
    .slice(0, 5)
    .join(" ");
  const anchor = summaryTokens || input.title.toLowerCase();
  return `tighten recall_when around an action + anchor, e.g. 'about to ${input.type} in ${path}: ${anchor}'`;
}

// #159: admission rules — vault rot has a known shape. Negative capability
// claims harden into standing refusals that outlive the problem; imperative
// phrasing gets re-read as a directive in unrelated later contexts. Both are
// advisory-only flags, never blocks.
const NEGATIVE_CLAIM_RE =
  /\b(is broken|does ?n[o']?t work|not working|no longer works|never works|funktioniert nicht( mehr)?|ist kaputt|geht nicht( mehr)?)\b/i;
const FIX_MARKER_RE =
  /\b(fix(ed)?|lösung|solution|workaround|abhilfe|stattdessen|instead|how to apply)\b/i;
const IMPERATIVE_LEAD_RE =
  /^(always|never|don'?t|do not|avoid|remember to|ensure|immer|nie(mals)?|benutze|verwende|vermeide|nutze|stelle sicher)\b/i;

function scoreSaveQuality(deps: ToolDeps, input: SaveMemoryInput): SaveQualityResult {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const triggerIssues = input.recall_when
    .map(triggerSpecificityIssue)
    .filter((issue): issue is string => issue !== undefined);
  if (triggerIssues.length > 0) {
    issues.push(...triggerIssues);
    suggestions.push(buildSpecificTriggerSuggestion(input));
    score -= Math.min(55, triggerIssues.length * 25);
  }

  const genericTags = input.tags.filter((tag) => {
    const tokens = words(tag);
    return tokens.length === 1 && GENERIC_TRIGGER_WORDS.has(tokens[0]);
  });
  if (genericTags.length > 0) {
    issues.push(`generic tags: ${genericTags.join(", ")}`);
    suggestions.push("add at least one project/component/outcome tag so future matches are narrower");
    score -= Math.min(24, genericTags.length * 12);
  }

  // #159: 'X is broken / doesn't work' without a fix becomes a standing
  // refusal that keeps surfacing long after the problem was solved
  if (
    NEGATIVE_CLAIM_RE.test(`${input.title} ${input.summary}`) &&
    !FIX_MARKER_RE.test(`${input.summary} ${input.body}`)
  ) {
    issues.push("negative capability claim without a fix — hardens into a standing refusal");
    suggestions.push(
      "capture the FIX (install step, config, env var) instead of the failure as a constraint — or add the fix to the body",
    );
    score -= 12;
  }

  // #159: imperative lead reads as a directive when recalled in unrelated
  // contexts — declarative facts age better
  if (IMPERATIVE_LEAD_RE.test(input.title.trim()) || IMPERATIVE_LEAD_RE.test(input.summary.trim())) {
    issues.push("imperative phrasing — re-reads as a self-directive in unrelated later contexts");
    suggestions.push("state it as a declarative fact: 'User prefers …' / 'X requires Y', not 'Always/Never …'");
    score -= 8;
  }

  // #231 (language-first recall): the hook manufactures English queries on every
  // box, so on a non-English vault the highest-weighted field (recall_when)
  // structurally can't match English-authored triggers. If the user's primary
  // language is set and non-English but the joined triggers read as English,
  // nudge toward authoring in their language. Conservative by construction:
  // detectLanguage only fires on a confident "en" (it abstains on short /
  // code-shaped / ambiguous input and can only tell de/en apart, so e.g. a
  // Russian primary with Russian triggers abstains and never trips this),
  // advisory only — never a rejection. A false negative is cheaper here.
  const primaryLang = deps.primaryLanguage;
  if (primaryLang && primaryLang !== "en" && detectLanguage(input.recall_when.join(" ")).lang === "en") {
    issues.push(`recall_when reads as English but your primary language is '${primaryLang}'`);
    suggestions.push(
      `author triggers in '${primaryLang}', keeping only genuine English tech terms (daemon, deploy, hook, …) as cross-lingual anchors`,
    );
    score -= 8;
  }

  // #149: a complete hook/context block quoted in memory content is
  // conversation scaffolding, not memory — it re-enters the index via body
  // search and (title/summary) doc2query. Advisory only: save content is never
  // silently rewritten; the agent removes the block and re-saves.
  const injectedTags = Array.from(
    new Set([
      ...containsInjectedBlock(input.title),
      ...containsInjectedBlock(input.summary),
      ...containsInjectedBlock(input.body),
    ]),
  );
  if (injectedTags.length > 0) {
    issues.push(`injected context blocks in content: <${injectedTags.join(">, <")}>`);
    suggestions.push(
      "remove quoted hook/context blocks (<recall-hints>, <session-context>, <system-reminder>, …) — they are conversation scaffolding, not memory content",
    );
    score -= 20;
  }

  // #147: Injection-Marker im Save-Inhalt — advisory only, nie blocken (der
  // Flag ist billig, ein verpasster Marker nicht). Trifft vor allem Captures
  // von Third-Party-Content (Bridge, zitierte Dokumente); rein user-eigene
  // Memories triggern die Muster praktisch nie.
  const injectionFindings = scanForInjection([input.title, input.summary, input.body].join("\n"));
  const injectionAdvisory = formatInjectionAdvisory(injectionFindings);
  if (injectionAdvisory) {
    issues.push(injectionAdvisory);
    suggestions.push(
      "review the flagged spans — quoted third-party material keeps the flag as provenance; if it is your own phrasing, reword it",
    );
    score -= 15;
  }

  // #162: kurze, diskriminierende Felder (title, tags, recall_when) zuerst,
  // die potentiell lange summary zuletzt — falls der QUERY_MAX_CHARS-Cap
  // greift, fällt nur Summary-Schwanz weg, nie ein diskriminierender Term.
  const duplicateQuery = [input.title, ...input.tags, ...input.recall_when, input.summary].join(" ");
  const duplicateCandidates = deps.search
    .recall(duplicateQuery, { k: 5, scope: input.scope, type: input.type, allow_private: false })
    .filter((hit) => hit.id !== input.id)
    .filter((hit) => hit.score >= 20)
    .slice(0, 3)
    .map((hit) => ({ id: hit.id, score: hit.score, title: hit.title }));
  if (duplicateCandidates.length > 0) {
    issues.push(`possible duplicate: ${duplicateCandidates[0].id}`);
    suggestions.push(`consider load_memory('${duplicateCandidates[0].id}') and overwrite/update instead of creating a near-duplicate`);
    score -= Math.min(30, 12 + duplicateCandidates.length * 6);
  }

  const triggerCollisions = input.recall_when
    .map((trigger) => {
      // #108: ohne den Noise-Floor zählte das die rohe top-k-Liste — jeder
      // Trigger meldete "matches 20 memories" (k-Cap, keine Kollisionen).
      // Kollision = ein anderes Memory, das dieser Trigger ÜBER dem Floor
      // hochspülen würde, exakt wie recall() selbst filtert.
      const hits = deps.search
        .recall(trigger, { k: 20, scope: input.scope, type: input.type, allow_private: false })
        .filter((hit) => hit.id !== input.id)
        .filter((hit) => hit.score >= RECALL_FLOOR);
      return { trigger, count: hits.length, examples: hits.slice(0, 3).map((h) => h.id) };
    })
    .filter((collision) => collision.count >= 3);
  if (triggerCollisions.length > 0) {
    issues.push(`trigger collision: ${triggerCollisions[0].trigger} already matches ${triggerCollisions[0].count} memories`);
    suggestions.push("make high-collision triggers include a concrete action, subsystem, failure mode, or file family");
    score -= Math.min(30, triggerCollisions.length * 12);
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: clamped,
    band: clamped >= 80 ? "high" : clamped >= 50 ? "medium" : "low",
    issues,
    suggestions: Array.from(new Set(suggestions)),
    duplicate_candidates: duplicateCandidates,
    trigger_collisions: triggerCollisions,
  };
}

// ─── #150: anti-thrash — consecutive-failure cap on save_memory ─────────
// A repeatedly failing save (schema retry loop, path issue) must never eat
// the turn: after SAVE_FAILURE_CAP consecutive failures the error turns
// terminal ("STOP retrying") until a save succeeds or the window expires.
// Deliberately daemon-global rather than per-session: this is a local
// single-user daemon, the CC session id does not reach this handler, and the
// time window bounds any cross-session bleed.
export const SAVE_FAILURE_CAP = 3;
export const SAVE_FAILURE_WINDOW_MS = 10 * 60_000;
let saveFailureCount = 0;
let saveFailureLastAt = 0;

export function noteSaveFailure(now: number = Date.now()): number {
  if (now - saveFailureLastAt > SAVE_FAILURE_WINDOW_MS) saveFailureCount = 0;
  saveFailureLastAt = now;
  saveFailureCount += 1;
  return saveFailureCount;
}

export function resetSaveFailures(): void {
  saveFailureCount = 0;
  saveFailureLastAt = 0;
}

export async function saveMemoryHandler(
  deps: ToolDeps,
  rawArgs: unknown,
): Promise<SaveMemoryResult> {
  let result: SaveMemoryResult;
  try {
    result = await saveMemoryInner(deps, rawArgs);
  } catch (err) {
    const failures = noteSaveFailure();
    if (failures >= SAVE_FAILURE_CAP) {
      // No reset here: every further attempt stays terminal until a success
      // or the window expiry clears the streak.
      throw new Error(
        `save_memory failed ${failures} times in a row — STOP retrying this save. ` +
          `Continue with the user's actual task and report the failed save in your reply instead. ` +
          `(last error: ${(err as Error).message})`,
      );
    }
    throw err;
  }
  resetSaveFailures();
  // Terminal success marker: no state echo beyond the advisory — a re-issued
  // identical save is thrash, not diligence.
  return { ...result, note: "Save complete — do not repeat this save_memory call." };
}

async function saveMemoryInner(
  deps: ToolDeps,
  rawArgs: unknown,
): Promise<SaveMemoryResult> {
  const parsed = SaveMemoryInput.safeParse(rawArgs);
  if (!parsed.success) throw new Error(parsed.error.message);

  const saveQuality = scoreSaveQuality(deps, parsed.data);

  // Re-Filing (#64): Wenn die id schon indexiert ist, aber der neue Save sie
  // woanders ablegt (geänderte folder/scope-Konvention), würde saveMemory nur
  // den NEUEN Pfad auf Kollision prüfen — die alte Datei bliebe als Duplikat
  // mit derselben id liegen. Deshalb: ohne overwrite ablehnen, mit overwrite
  // die alte Datei in den Trash verschieben (recoverbar, kein Hard-Delete).
  const finalId = parsed.data.id ?? slugify(parsed.data.title);
  const previous = deps.vault.get(finalId);
  if (previous && !parsed.data.overwrite) {
    throw new Error(
      `memory already exists: ${finalId} (at ${previous.filePath}). ` +
        `Pass overwrite=true to replace it — a changed folder/scope moves the file.`,
    );
  }

  // In-place update: overwriting an existing memory WITHOUT an explicit folder
  // must keep it where it already lives. Otherwise the scope/type default
  // routing silently relocates it on any edit (and trashes the original) — e.g.
  // a memories/people/ memo updated without folder gets re-routed to
  // memories/projects/<scope>/. An explicit folder still moves it (#64 re-filing).
  // #188: Bestehende Obsidian-Aliases durchreichen — saveMemory erhält sie
  // sonst nur beim Same-Path-Overwrite; beim Re-Filing (neuer Ordner) liest
  // es den neuen Pfad und fände sie nicht. Kein Tool-Schema-Feld: aliases
  // ist Substrat-Plumbing, kein Agent-Knob.
  const base =
    previous && parsed.data.aliases === undefined
      ? { ...parsed.data, aliases: previous.fm.aliases }
      : parsed.data;
  const input =
    previous && !parsed.data.folder
      ? { ...base, folder: relative(deps.vaultPath, dirname(previous.filePath)) }
      : base;

  const result = await saveMemory(deps.vaultPath, input);
  if (previous && previous.filePath !== result.file_path) {
    try {
      await moveToTrash(deps.vaultPath, previous.filePath, finalId);
      deps.vault.forgetFile(previous.filePath);
    } catch (err) {
      // Alte Datei schon weg (extern gelöscht/verschoben) → nichts aufzuräumen.
      console.error(`[bastra-recall] re-file: could not trash old path: ${(err as Error).message}`);
    }
  }
  // Don't trust the watcher on cloud-storage mounts — force-index now
  // so a follow-up recall() in the same session sees the new memory.
  await deps.vault.reindexFile(result.file_path);
  fireAndForget(
    deps.telemetry.logSaveMemory({
      id: result.id,
      type: parsed.data.type,
      scope: parsed.data.scope,
      title: parsed.data.title,
      tag_count: parsed.data.tags.length,
      recall_when_count: parsed.data.recall_when.length,
      body_chars: parsed.data.body.length,
      overwrite: parsed.data.overwrite ?? false,
      created: result.created,
      follows_recall: deps.telemetry.recentRecallId(),
    }),
  );

  return { ...result, save_quality: saveQuality };
}

// ─── archive_memory (#217 Intake-Adoption) ──────────────────────

export const ArchiveMemoryArgs = z.object({
  id: z.string().min(1),
  superseded_by: z.string().optional(),
});

/**
 * Archiviert ein Memory in den Vault-Trash (recoverable, nie rm) — das
 * Abschluss-Primitiv der Intake-Adoption: nachdem ein importiertes Memory
 * ins Vollformat überführt wurde (neues Memory mit `source: migrated:…`),
 * räumt archive_memory das Original aus dem lebenden Vault. Gleiche
 * Trash-Mechanik wie das Re-Filing im Save-Pfad (moveToTrash + forgetFile).
 * `superseded_by` wird best-effort in die Trash-Kopie gestempelt, damit der
 * Trash-Ordner beim späteren Audit pro Datei zeigt, wohin adoptiert wurde.
 */
export async function archiveMemoryHandler(
  deps: ToolDeps,
  args: Record<string, unknown>,
): Promise<{ id: string; archived_to: string; superseded_by: string | null }> {
  const parsed = ArchiveMemoryArgs.safeParse(args);
  if (!parsed.success) {
    throw new Error(`invalid archive_memory args: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  }
  const { id, superseded_by } = parsed.data;
  const mem = deps.vault.get(id);
  if (!mem) {
    throw new Error(`unknown memory: ${id} — archive_memory only archives memories that exist in the vault.`);
  }
  const archivedTo = await moveToTrash(deps.vaultPath, mem.filePath, id);
  deps.vault.forgetFile(mem.filePath);
  if (superseded_by) {
    try {
      const raw = await readFile(archivedTo, "utf8");
      const { data, content } = matter(raw);
      const fm = { ...(data as Record<string, unknown>), obsolete: true, superseded_by };
      await writeFile(archivedTo, matter.stringify(content, fm), "utf8");
    } catch {
      /* Audit-Stempel ist best-effort — das Archiv selbst steht bereits. */
    }
  }
  return { id, archived_to: archivedTo, superseded_by: superseded_by ?? null };
}

// ─── MCP Tool-Definitionen ───────────────────────────────────────
// Single source of truth für die MCP-Tool-Liste (recall/load_memory/
// save_memory). Sowohl der embedded MCP-Server in index.ts als auch
// der HTTP-Forwarder mcp-forwarder.ts importieren das hier, damit Schema
// und Description nicht aus dem Sync geraten.

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** MCP tool annotations. readOnlyHint groups the read tools into the
   *  bulk-approvable "Read-only tools" permission category in clients like
   *  Claude Desktop — the one server-side lever against approval friction. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** Read tools: no vault mutation, safe to run unsupervised. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false } as const;

export const MEMORY_TOOL_DEFS: ToolDef[] = [
  {
    name: "recall",
    annotations: READ_ONLY,
    description:
      "Search the memory vault. Returns top-k matching memorys " +
      "(id, title, type, scope, summary, score). " +
      "\n\n" +
      "WHEN TO CALL (recall is part of acting, not a separate step):\n" +
      "- At session start (once): query for active-project + " +
      "user-preferences to load durable context.\n" +
      "- Before writing/editing a file: query with a description of " +
      "what you are about to write (e.g. 'creating React input with " +
      "focus styles'). This catches lessons before mistakes.\n" +
      "- Before giving a multi-step plan or recommendation: query for " +
      "preferences that shape format/scope.\n" +
      "- When the user's prompt touches a topic that may have a stored " +
      "lesson, decision, preference, or project-fact.\n" +
      "- Before save_memory: query to avoid creating a duplicate.\n" +
      "\n" +
      "WHAT TO DO WITH HITS:\n" +
      "- score >= ~100 with title/recall_when match: load_memory and " +
      "apply the lesson before acting.\n" +
      "- score 30-100: read the summary, load if directly relevant.\n" +
      "- score < 30: usually noise; skip unless the summary is a " +
      "perfect topic match.\n" +
      "Never ignore a `lesson` hit with strong recall_when match.\n" +
      "On the hybrid (BM25 + vector) path the score is a scaled rank sum, " +
      "not a similarity — a top hit is high by construction. When the " +
      "response carries top-level `weak_result: true`, no returned hit has " +
      "a recall_when or title match: the high scores are likely " +
      "rank-1-of-nothing, so prefer not to load them.\n" +
      "\n" +
      "recall returns lean CANDIDATES (no bodies). This is step 1 of a " +
      "two-step flow: call load_memory ONLY for the hits you actually " +
      "need — do not load every hit.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language query OR a description of what you are " +
            "about to do (e.g. 'creating new input component', " +
            "'about to give a multi-option plan').",
        },
        k: {
          type: "number",
          description: "Max results (default 5, range 1-20).",
        },
        scope: {
          type: "string",
          description:
            "Optional exact-match filter, e.g. 'carnexus', " +
            "'user-preference', 'all-projects'.",
        },
        type: {
          type: "string",
          description:
            "Optional exact-match filter on memory type, e.g. 'lesson', " +
            "'preference', 'project-fact'.",
        },
        verbosity: {
          type: "string",
          enum: ["lean", "full"],
          description:
            "'lean' (default) returns id, title, type, scope, summary, " +
            "score per hit. 'full' adds matched_terms, mode, hop, " +
            "topic_path and the stages timing block — for debugging / the " +
            "Mac-App. Leave unset to keep the context footprint small.",
        },
        min_score: {
          type: "number",
          description:
            "Drop hits below this score (default 30). On the hybrid " +
            "(BM25 + vector) path the score is a scaled reciprocal-rank " +
            "sum, not a content similarity: the bands describe how much " +
            "the two arms agree on rank (~164 = rank 1 in both arms, ~82 " +
            "= rank 1 in one arm only), so a top hit is high by " +
            "construction and the 30 floor practically only bites in " +
            "BM25-only mode (no embeddings). Raise it to require stronger " +
            "rank agreement; see the top-level `weak_result` flag for a " +
            "no-match signal.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "load_memory",
    annotations: READ_ONLY,
    description:
      "Load the content (frontmatter + body) of a single memory by id. " +
      "Step 2 of the recall flow — call this only for the candidates " +
      "recall() surfaced that you actually need. Returns essential " +
      "frontmatter + body by default; pass verbosity:'full' for the raw " +
      "frontmatter (related_via cosines, source, …).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Memory id (the slug, no .md extension).",
        },
        verbosity: {
          type: "string",
          enum: ["lean", "full"],
          description:
            "'lean' (default) returns essential frontmatter + body without " +
            "the auto-related block. 'full' returns the complete frontmatter " +
            "and raw body — for debugging / the Mac-App.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "save_memory",
    description:
      "Persist a new memory into the vault as a markdown file with YAML " +
      "frontmatter. This is YOUR long-term memory — save autonomously " +
      "when a memory-worthy moment occurs, do not wait to be asked.\n" +
      "\n" +
      "STRONG SIGNALS — save without confirmation, then 1-line ack:\n" +
      "- User expresses repetition/frustration about a recurring issue " +
      "  ('wieder', 'schon wieder', 'wie oft', emphatic caps) → lesson, " +
      "  emotion:'frustration', salience:0.8\n" +
      "- User states an explicit durable rule ('immer X', 'nie Y', 'bei " +
      "  diesem Projekt nutzen wir Z') → preference / workflow\n" +
      "- User corrects a recurring tendency in your behavior → " +
      "  meta-working\n" +
      "- An architectural decision is finalized after weighing options " +
      "  → decision\n" +
      "- User confirms a workflow ('lass uns das immer so machen') → " +
      "  workflow\n" +
      "- A bug got fixed after >2 iterations with non-obvious root " +
      "  cause → lesson (capture the FAILED PATH too, not just the fix), " +
      "  emotion:'success', salience:0.7\n" +
      "- User marks something as important ('das ist wichtig', 'merk dir " +
      "  das gut') → salience:0.9 on the memory you save\n" +
      "\n" +
      "VALENCE (#217): salience/emotion mark how emotionally charged the " +
      "capture moment was — high salience ages slower and may rank higher. " +
      "Set them ONLY when a capture rule above fires or the user marks " +
      "importance; never invent them. Omit both for routine saves.\n" +
      "\n" +
      "ANTI-SIGNALS — do NOT save:\n" +
      "- One-off task descriptions ('baue mir bitte X') — that's a " +
      "  task, not a memory\n" +
      "- Speculation, 'maybe' statements, tentative ideas\n" +
      "- Anything derivable from code/git/CLAUDE.md\n" +
      "- Sensitive personal data (unless a stable preference)\n" +
      "- When unsure: default to NOT saving. False saves erode trust.\n" +
      "\n" +
      "ADMISSION RULES — memories that were true once quietly poison " +
      "later behavior:\n" +
      "- NO negative capability claims ('X tool is broken', 'Y does not " +
      "  work') — they harden into standing refusals that outlive the " +
      "  problem. If something failed due to setup state, capture the FIX " +
      "  (install step, config, env var), never the failure as a constraint.\n" +
      "- NO stale-in-7-days artifacts: task progress, PR numbers, " +
      "  'phase N done' belong in git/issues, not in memory.\n" +
      "- Declarative facts, not self-directives: 'User prefers concise " +
      "  replies' ✓ — 'Always reply concisely' ✗. Imperative phrasing " +
      "  gets re-read as a directive in unrelated later contexts.\n" +
      "\n" +
      "BEFORE SAVING: call recall() with the title/topic to check for " +
      "an existing memory you should update (overwrite=true) instead " +
      "of creating a duplicate.\n" +
      "\n" +
      "QUALITY BARS:\n" +
      "- Title: short, specific, non-generic.\n" +
      "- Summary: one sentence, aim ~250-300 chars, core gist in the first " +
      "  160 (the lean-recall snippet). Hard cap 400 — over-long is " +
      "  auto-truncated at a word boundary, never rejected; still keep it short.\n" +
      "- Body: lead with the rule/fact, then **Why:** (root cause / " +
      "  reason / incident) and **How to apply:** (when this kicks in). " +
      "  For lessons, capture the failure path AND the fix.\n" +
      "- recall_when (CRITICAL — highest-weighted search field): 2-4 " +
      "  CONCRETE contexts/queries where future-you should be reminded. " +
      "  'about to write a Tailwind grid' beats 'CSS questions'. Without " +
      "  good recall_when, the memory is dead weight.\n" +
      "- Language: author title, summary and recall_when in the user's " +
      "  primary language (settings language.primary / the injected " +
      "  <memory-language> block); keep only genuine English tech terms " +
      "  (daemon, deploy, hook, …) as anchors — this mixed style carries " +
      "  cross-lingually.\n" +
      "\n" +
      "TAXONOMY CONVENTIONS (self-learning vault structure):\n" +
      "- The vault can teach itself new categories. A convention is a " +
      "  memory in the reserved scope 'taxonomy' that names a cluster " +
      "  and fixes its axes: folder, topic_path shape, tags, body shape.\n" +
      "- BEFORE saving into a recurring cluster (people, places, tools, " +
      "  …): recall('taxonomy convention <cluster>') — if a convention " +
      "  exists, FOLLOW it exactly (its folder/topic_path/tags), do not " +
      "  invent variant tags that fragment recall.\n" +
      "- When you notice the same ad-hoc cluster for the third time " +
      "  without a convention, establish one: save a memory with " +
      "  scope='taxonomy', tag 'convention', body = the rule (axes + " +
      "  folder + body shape + one example), then apply it. Use the " +
      "  `folder` arg so members get a real home (e.g. 'memories/people').\n" +
      "- Re-filing: overwrite=true with a new folder MOVES the memory " +
      "  (old file goes to the vault trash) — use this to migrate " +
      "  existing memories under a new convention.\n" +
      "\n" +
      "AFTER SAVING: surface a single-line ack to the user, prefixed " +
      "with `→`: `→ saved: <title> (id: <id>)`. Nothing more.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short, specific title (becomes the slug/id).",
        },
        type: {
          type: "string",
          enum: [
            "lesson",
            "preference",
            "project-fact",
            "meta-working",
            "decision",
            "workflow",
            "reference",
            "user-preference",
          ],
          description:
            "Memory type. Use 'lesson' for fixes/gotchas, 'preference' " +
            "for project-scoped style choices, 'user-preference' for " +
            "the human's cross-project preferences, 'project-fact' for " +
            "non-derivable project state, 'decision' for committed " +
            "design decisions, 'workflow' for recurring procedures.",
        },
        summary: {
          type: "string",
          description:
            "One sentence capturing the gist — appears in recall() hits. " +
            "Aim ~250-300 chars; put the core in the first 160 (shown in lean " +
            "recall). Over 400 is auto-truncated at a word boundary, never " +
            "rejected.",
        },
        body: {
          type: "string",
          description:
            "Full markdown body. Lead with the rule/fact, then explain " +
            "*why* (the reason/incident) and *how to apply* (when this " +
            "kicks in). Wikilinks like [[other-memory-id]] are supported.",
        },
        topic_path: {
          type: "array",
          items: { type: "string" },
          description:
            "Hierarchical topic path, e.g. ['bastra-recall','search','ranking'].",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Flat tags for filtering, at least one.",
        },
        scope: {
          type: "string",
          description:
            "Project/area this memory belongs to, e.g. 'bastra-recall', " +
            "'carnexus', 'user-preference', 'all-projects'. The scope " +
            "'taxonomy' is reserved for convention memories (self-learned " +
            "vault structure rules).",
        },
        folder: {
          type: "string",
          description:
            "Optional target folder relative to the vault root (e.g. " +
            "'memories/people'). Overrides the default scope/type routing — " +
            "use it when a taxonomy convention assigns this cluster a home. " +
            "With overwrite=true a changed folder MOVES the memory (old " +
            "file is trashed, recoverable).",
        },
        recall_when: {
          type: "array",
          items: { type: "string" },
          description:
            "Trigger phrases — situations where this memory should " +
            "surface. Highest-weighted search field. Be specific: " +
            "'about to write a Tailwind grid', not 'CSS questions'.",
        },
        related: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional ids of related memories. Hinweis: `[[id]]`-Wikilinks " +
            "im body werden automatisch ins related[] gespiegelt — du musst " +
            "sie hier nicht doppelt aufzählen.",
        },
        sensitivity: {
          type: "string",
          enum: ["private", "team", "public"],
          description:
            "Wer darf das Memory sehen? Default 'team' (lokale KI-Tools). " +
            "'private' = nur Mac-App (für externe Caller nicht sichtbar).",
        },
        valid_until: {
          type: "string",
          description:
            "Explizites Ablaufdatum (YYYY-MM-DD). Überschreibt expires_after_days.",
        },
        expires_after_days: {
          type: "number",
          description:
            "Tage nach 'updated', ab denen das Memory altert/expires. " +
            "Überschreibt den Type-Default (lesson=180, decision=365, …).",
        },
        last_reviewed_at: {
          type: "string",
          description:
            "ISO-Datum des letzten 'noch aktuell'-Checks. Resetet Staleness.",
        },
        affects_files: {
          type: "array",
          items: { type: "string" },
          description:
            "Optionale Liste von Repo-Pfaden, die diese Lesson/Decision betrifft.",
        },
        issues: {
          type: "array",
          items: { type: "string" },
          description:
            "Optionale Liste verknüpfter Issue-IDs (z.B. '#42').",
        },
        source: {
          type: "string",
          description:
            "Optional provenance, e.g. 'Daniel, 2026-05-01 after retro'.",
        },
        confidence: {
          type: "number",
          description:
            "0-1, default 1. Lower if the lesson is tentative.",
        },
        salience: {
          type: "number",
          description:
            "0-1 (#217): how emotionally charged the capture moment was. " +
            "Set ONLY when a capture rule fires (frustration 0.8, hard-won " +
            "fix 0.7, 'merk dir das gut' 0.9). High salience ages slower. " +
            "Omit for routine saves. On overwrite without this field, the " +
            "existing value is preserved.",
        },
        emotion: {
          type: "string",
          enum: ["frustration", "success", "risk", "neutral"],
          description:
            "Tone of the capture moment (#217): 'frustration' (recurring " +
            "pain), 'success' (hard-won fix), 'risk' (near-miss / danger), " +
            "'neutral'. Only alongside salience. On overwrite without this " +
            "field, the existing value is preserved.",
        },
        recall_mode: {
          type: "string",
          enum: ["reflex", "deliberate"],
          description:
            "#217: 'reflex' lets this memory self-inject (budgeted) when a " +
            "recall_when trigger hard-matches a prompt — set 'reflex' ONLY " +
            "after the user explicitly confirmed a promotion, never " +
            "autonomously. Absent = 'deliberate'. On overwrite without this " +
            "field, the existing value is preserved.",
        },
        id: {
          type: "string",
          description:
            "Optional explicit id/slug. Default: slugified title.",
        },
        overwrite: {
          type: "boolean",
          description:
            "If true, replace an existing memory with the same id. " +
            "Default false (errors on collision).",
        },
        write_origin: {
          type: "string",
          enum: ["user-directed", "agent-session", "capture-review"],
          description:
            "Provenance (#158): set 'user-directed' ONLY when the human " +
            "explicitly asked to remember this ('merk dir das') — such " +
            "memories are exempt from automated lifecycle passes (curator, " +
            "consolidation). Omit otherwise: 'agent-session' is the default " +
            "for autonomous saves. On overwrite without this field, the " +
            "existing provenance is preserved.",
        },
      },
      required: [
        "title",
        "type",
        "summary",
        "body",
        "topic_path",
        "tags",
        "scope",
        "recall_when",
      ],
    },
  },
  {
    name: "archive_memory",
    annotations: { readOnlyHint: false, destructiveHint: true },
    description:
      "Move a memory into the vault trash (recoverable — never a hard " +
      "delete). This is the closing step of INTAKE ADOPTION: after an " +
      "imported intake memory has been converted into a full-format memory " +
      "(save_memory with real type/scope/recall_when and source: " +
      "\"migrated:<label>:<original-id>\"), archive the original so the " +
      "intake area shrinks and the vault holds ONE canonical version. " +
      "Pass superseded_by with the new memory's id — it is stamped into " +
      "the archived copy so the adoption stays auditable from both sides. " +
      "Do NOT use this as a general delete: only archive intake originals " +
      "you just adopted, or a memory the user explicitly asked to retire.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Id of the memory to archive (the intake original).",
        },
        superseded_by: {
          type: "string",
          description:
            "Id of the full-format memory that replaces it — stamped into " +
            "the archived copy (obsolete: true, superseded_by) for audit.",
        },
      },
      required: ["id"],
    },
  },
];
