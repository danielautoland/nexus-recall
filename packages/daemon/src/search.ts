import MiniSearch from "minisearch";
import type { Memory } from "./schema.js";
import type { Vault, VaultEvent } from "./vault.js";

export interface RecallHit {
  id: string;
  title: string;
  type: string;
  scope: string;
  summary: string;
  topic_path: string[];
  score: number;
  matched_terms: string[];
}

export interface RecallOptions {
  k?: number;
  scope?: string; // exact-match filter
  type?: string; // exact-match filter
}

interface IndexDoc {
  id: string;
  title: string;
  summary: string;
  tags_flat: string;
  recall_when_flat: string;
  topic_path_flat: string;
  body: string;
  // not searched, just stored
  type: string;
  scope: string;
  topic_path: string[];
  obsolete: boolean;
  confidence: number;
}

/**
 * In-memory BM25 search over the vault.
 * Built on minisearch — handles ~thousands of memorys easily.
 * Field weights chosen so title + recall_when + tags > body.
 */
export class SearchIndex {
  private mini: MiniSearch<IndexDoc>;
  private detach?: () => void;

  constructor(private readonly vault: Vault) {
    this.mini = new MiniSearch<IndexDoc>({
      fields: [
        "title",
        "summary",
        "tags_flat",
        "recall_when_flat",
        "topic_path_flat",
        "body",
      ],
      storeFields: [
        "id",
        "title",
        "type",
        "scope",
        "summary",
        "topic_path",
        "obsolete",
        "confidence",
      ],
      searchOptions: {
        boost: {
          // recall_when is authored exactly for triggering — highest weight.
          recall_when_flat: 5,
          title: 4,
          tags_flat: 3,
          topic_path_flat: 2,
          summary: 2,
          body: 1,
        },
        fuzzy: 0.2,
        prefix: true,
        combineWith: "OR",
      },
    });
  }

  /** Initial population from the vault, then subscribe to changes. */
  start(): void {
    for (const m of this.vault.list()) this.indexOne(m);
    this.detach = this.vault.on((e) => this.handle(e));
  }

  stop(): void {
    this.detach?.();
    this.detach = undefined;
  }

  recall(query: string, opts: RecallOptions = {}): RecallHit[] {
    const k = opts.k ?? 5;
    if (!query.trim()) return [];
    const raw = this.mini.search(query);

    const filtered = raw.filter((r) => {
      // hide obsolete by default
      if (r.obsolete) return false;
      if (opts.scope && r.scope !== opts.scope) return false;
      if (opts.type && r.type !== opts.type) return false;
      return true;
    });

    return filtered.slice(0, k).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      type: r.type as string,
      scope: r.scope as string,
      summary: r.summary as string,
      topic_path: r.topic_path as string[],
      score: round(r.score),
      matched_terms: r.terms ?? [],
    }));
  }

  loadFull(id: string): Memory | undefined {
    return this.vault.get(id);
  }

  size(): number {
    return this.mini.documentCount;
  }

  // ─── internals ───────────────────────────────────────────────

  private handle(e: VaultEvent): void {
    if (e.kind === "remove") {
      try {
        this.mini.discard(e.id);
      } catch {
        // not indexed; ignore
      }
      return;
    }
    if (e.kind === "change") {
      try {
        this.mini.discard(e.memory.fm.id);
      } catch {
        // first time; treat as add
      }
    }
    this.indexOne(e.memory);
  }

  private indexOne(m: Memory): void {
    const fm = m.fm;
    const doc: IndexDoc = {
      id: fm.id,
      title: fm.title,
      summary: fm.summary,
      tags_flat: fm.tags.join(" "),
      recall_when_flat: fm.recall_when.join(" \n "),
      topic_path_flat: fm.topic_path.join(" "),
      body: m.body,
      type: fm.type,
      scope: fm.scope,
      topic_path: fm.topic_path,
      obsolete: fm.obsolete === true,
      confidence: fm.confidence ?? 1,
    };
    this.mini.add(doc);
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
