/**
 * Single source of truth for the user-facing "semantic recall: ON/OFF" line.
 *
 * Shared by index.ts (OSS daemon) and bridge.ts (Pro bridge) so the wording
 * never drifts between the two — the repo previously carried three near-copies
 * of the embedding-provider logic with divergent log strings. Importing one
 * helper makes "identical wording" compiler-enforced instead of a code-review
 * promise. (#79: the silent-success path is what hid disabled embeddings.)
 */
export type EmbeddingSource = "env" | "cli-settings" | "api-key" | "none";

export interface EmbeddingStatus {
  on: boolean;
  /** provider.id, e.g. "ollama-embeddinggemma" or "openai"; null when off. */
  providerId: string | null;
  source: EmbeddingSource;
}

/**
 * The line every embedding path logs — including success, so an enabled OR a
 * silently-disabled provider is always visible. `prefix` lets the bridge keep
 * its "[bastra-recall.bridge]" tag while the message stays identical.
 */
export function embeddingStatusLine(s: EmbeddingStatus, prefix = "[bastra-recall]"): string {
  if (s.on && s.providerId) {
    return `${prefix} semantic recall: ON via ${s.providerId} (source: ${s.source})`;
  }
  return `${prefix} semantic recall: OFF — BM25 keyword search only. Enable it: bastra install --ollama`;
}
