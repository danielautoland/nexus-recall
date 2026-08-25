/**
 * @bastra-recall/core — public API.
 *
 * Reusable building blocks shared by the daemon (MCP server) and the
 * Mac-app surface. No transport coupling lives here.
 */

export { Vault } from "./vault.js";
export type { VaultEvent, VaultListener } from "./vault.js";

export { SearchIndex, salienceRankCap } from "./search.js";
export type { RecallHit, RecallOptions } from "./search.js";

export {
  normalizeQuery,
  tokenizeWithIdentifiers,
  capAtWordBoundary,
  QUERY_MAX_CHARS,
} from "./query-normalize.js";
export {
  capBm25Query,
  BM25_QUERY_MAX_CHARS,
  BM25_QUERY_MAX_TERMS,
} from "./bm25-query-cap.js";
export type { DocFreqFn, Bm25QueryCap } from "./bm25-query-cap.js";

export type { RecallStage, StageListener } from "./recall-stages.js";
export { RECALL_STAGE_ORDER, progressIndexFor } from "./recall-stages.js";

export { pickPhrase, pickToolPhrase, banterModeFromEnv } from "./recall-banter.js";
export type { BanterMode, BanterLang } from "./recall-banter.js";

export { saveMemory, deleteMemoryFile } from "./save.js";
export type { DeleteMemoryResult } from "./save.js";
export { SaveMemoryInput, MemoryWriteConflictError, MEMORY_WRITE_CONFLICT } from "./save-schema.js";
export type { SaveMemoryResult, SaveMemoryCommitOptions } from "./save-schema.js";
export {
  slugify,
  extractWikilinks,
  stripAutoRelatedSection,
  stripCodeSpans,
  AUTO_RELATED_START,
  AUTO_RELATED_END,
} from "./save-text.js";
export { resolveMemoryTarget } from "./save-target.js";
export type { MemoryTarget, MemoryTargetInput } from "./save-target.js";

export {
  MemoryTypeEnum,
  FrontmatterSchema,
  parseMemory,
  parseMemoryWith,
  NotAMemoryFile,
  isPathSafeComponent,
} from "./schema.js";
export type { Memory, MemoryType, Frontmatter } from "./schema.js";

export { truncateSummaryTo, clampSummary, SUMMARY_MAX } from "./summary.js";

export { buildGraph, clusterKeyFor, groupKeyFor, subKeyFor } from "./graph.js";
export type { SkillRef } from "./graph.js";
export type { VaultGraph, GraphNode, GraphEdge, GraphCluster } from "./graph.js";
export { buildSemanticLayout } from "./graph-semantic.js";
export type { SemanticLayout } from "./graph-semantic.js";

export { scrubInjectedBlocks, containsInjectedBlock, INJECTED_BLOCK_TAGS } from "./scrub.js";
export type { ScrubResult, InjectedBlockTag } from "./scrub.js";

export { detectTopics, detectProject, extractContentExcerpt } from "./topics.js";
export type { ToolIntent, TopicResult } from "./topics.js";

export {
  AuditLog,
  trashPathFor,
  latestTrashPathFor,
  moveToTrash,
  restoreFromTrash,
} from "./audit-log.js";
export type { AuditEntry, AuditOperation, AuditActor } from "./audit-log.js";
export {
  CONFLICT_START,
  CONFLICT_END,
  hasUnresolvedConflict,
  renderConflictBlock,
  type ConflictClaim,
} from "./conflict.js";

export {
  AuditContext,
  auditedSave,
  auditedSoftDelete,
  auditedRestore,
} from "./audit-save.js";

export { assertLocalOrOptIn } from "./ollama-egress.js";

export {
  EmbeddingIndex,
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  fuseRRF,
  RRF_K,
  RRF_SCALE,
} from "./embeddings.js";
export type { EmbeddingProvider, EmbeddingHit, EmbedListener, EmbeddingRuntimeHealth } from "./embeddings.js";

export { EmbedCache, hashEmbedContent } from "./embed-cache.js";
export type { EmbedCacheEntry, EmbedCacheFile } from "./embed-cache.js";

export { RelatedEnricher } from "./related-enrich.js";
export type { RelatedEnricherOptions } from "./related-enrich.js";

export { TriggerExpander, buildExpandPrompt, parseExpansions, sourceHash } from "./trigger-expand.js";
export {
  scanForInjection,
  injectionCategories,
  formatInjectionAdvisory,
  MAX_FINDINGS as INJECTION_MAX_FINDINGS,
  type InjectionCategory,
  type InjectionFinding,
} from "./injection-scan.js";
export type { TriggerExpanderOptions, ChatFn, SelfTestFn } from "./trigger-expand.js";
