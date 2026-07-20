import MiniSearch from "minisearch";
import type { Memory } from "./schema.js";
import type { Vault, VaultEvent } from "./vault.js";
import type { EmbeddingIndex } from "./embeddings.js";
import { fuseRRF } from "./embeddings.js";
import type { RecallStage, StageListener } from "./recall-stages.js";
import { normalizeQuery, tokenizeWithIdentifiers } from "./query-normalize.js";

export interface RecallHit {
  id: string;
  title: string;
  type: string;
  scope: string;
  summary: string;
  topic_path: string[];
  score: number;
  matched_terms: string[];
  /** „bm25" | „vector" | „hybrid" — primärer Treffer-Modus für Telemetrie. */
  mode?: "bm25" | "vector" | "hybrid";
  /** „direct" | „1-hop" — bei Multi-Hop-Recall: ob das Memory ein direkter
   *  Match war oder ein Nachbar über `related_via`. UI kann das anders rendern. */
  hop?: "direct" | "1-hop";
  /** true wenn ein Query-Term auf dem HAND-geschriebenen `recall_when` matchte
   *  (nicht `recall_when_expanded`, nicht title/tags/topic/body). Signal für
   *  einen „deliberate" Treffer — der Autor hat genau diesen Kontext als Trigger
   *  deklariert. Genutzt vom Hook-Scope-Filter (#148), um starke, absichtliche
   *  Cross-Scope-Hits durchzulassen ohne den tag/topic-Noise (#110) zu öffnen. */
  matched_recall_when?: boolean;
  /** #230: RRF-Herkunft des Scores auf dem Hybrid-Pfad. Der `score` ist eine
   *  skalierte Rang-Summe, keine Content-Similarity — dieses Feld macht
   *  dekomponierbar, woraus die Zahl besteht. Nur auf dem Hybrid-Pfad gesetzt
   *  (das reine BM25-`recall()` lässt es weg); im lean-Response nicht enthalten,
   *  nur bei `verbosity: "full"`. */
  rrf?: {
    /** 1-basierter Rang im BM25-Arm, `null` wenn dieser Arm den Hit nicht führte. */
    rank_bm25: number | null;
    /** 1-basierter Rang im Vector-Arm, `null` wenn dieser Arm den Hit nicht führte. */
    rank_vector: number | null;
    /** Unskalierter RRF-Wert (Σ 1/(k+rank)) vor der ×5000-Skalierung, die `score` ergibt. */
    raw: number;
  };
}

/** Hat ein Query-Term auf dem hand-geschriebenen `recall_when_flat` gematcht?
 *  MiniSearch `match` ist `{ term: fields[] }`. `recall_when_expanded_flat`
 *  zählt bewusst NICHT — das ist doc2query-generiert, nicht vom Autor als
 *  Trigger deklariert (#148: nur „deliberate" Cross-Scope-Relevanz). */
function matchedRecallWhen(r: { match?: Record<string, string[]> }): boolean {
  const match = r.match;
  if (!match) return false;
  for (const fields of Object.values(match)) {
    if (fields.includes("recall_when_flat")) return true;
  }
  return false;
}

export interface RecallOptions {
  k?: number;
  scope?: string; // exact-match filter
  type?: string; // exact-match filter
  /**
   * Sensitivity-Filter (#58). Default `false` — externe MCP-Caller (Claude
   * Code, Cursor, etc.) sehen keine als `private` markierten Memories. Die
   * Mac-App ruft mit `allow_private: true` und sieht alles.
   */
  allow_private?: boolean;
  /**
   * Multi-Hop-Recall (#30 / #51). Default `0` — nur direkte BM25/Vector-Hits.
   * Bei `1`: nach den direkten Treffern werden deren `related_via`-Nachbarn
   * (1-Hop) eingehängt, mit reduziertem Score. UI kennzeichnet sie als
   * `hop: "1-hop"`.
   */
  expand_hops?: 0 | 1;
  /**
   * Stage-Event-Listener (#38). Wenn gesetzt, emittiert die Recall-
   * Pipeline pro Schritt einen Start- + Stop-Event (`query.parse`,
   * `bm25.search`, `vector.search`, `rrf.fuse`, `hops.expand`,
   * `staleness.rank`, `done`). Bei Query-Cache-Hits feuert zusätzlich
   * ein `cache.hit`-Event mit `meta.cache = "query"` — danach folgt
   * direkt `done`. Null-Overhead, wenn nicht gesetzt.
   */
  onStage?: StageListener;
  /**
   * #121: receives the DEEPER candidate pool (before the top-k slice / score floor),
   * so the "far slice" — relevant memories that ranked below the returned k or below
   * the floor and would otherwise be dropped from telemetry — becomes observable for
   * offline bridge harvesting. Null-overhead when unset.
   */
  onCandidatePool?: (pool: RecallHit[]) => void;
}

interface IndexDoc {
  id: string;
  title: string;
  summary: string;
  tags_flat: string;
  recall_when_flat: string;
  recall_when_expanded_flat: string;
  topic_path_flat: string;
  body: string;
  // not searched, just stored
  type: string;
  scope: string;
  topic_path: string[];
  obsolete: boolean;
  confidence: number;
  sensitivity: string;
}

/**
 * In-memory BM25 search over the vault.
 * Built on minisearch — handles ~thousands of memorys easily.
 * Field weights chosen so title + recall_when + tags > body.
 */
export class SearchIndex {
  private mini: MiniSearch<IndexDoc>;
  private detach?: () => void;
  private embeddings?: EmbeddingIndex;

  // Staleness-Cache (#29): `computeStaleness()` parsed Date-Strings und
  // rechnet Ratio-Logik — pro Recall × Hit-Count summiert sich das. Cache
  // ist memId → { touchTs, status, computedAt }. Invalidiert in `handle()`
  // bei change/remove, plus 12h-TTL gegen Tageswechsel (`aging → stale`
  // ohne Vault-Change).
  private stalenessCache = new Map<
    string,
    { touchTs: number; status: StaleStatus; computedAt: number }
  >();
  private static readonly STALENESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  // Curator-Demotions (#155): id-Set, vom Daemon nach jedem Curator-Pass
  // (und beim Boot aus dem State-File) gesetzt. Reiner Score-Mechanismus —
  // siehe CURATOR_DEMOTION_MULTIPLIER.
  private curatorDemotions = new Set<string>();

  /** Ersetzt das aktive Demotion-Set (score-only, #155). Leert den
   *  Query-Cache, damit die neue Gewichtung sofort greift. */
  setDemotions(ids: Iterable<string>): void {
    this.curatorDemotions = new Set(ids);
    this.queryCache.clear();
  }

  // Query-Cache (#30): MiniSearch tokenisiert die Query bei jedem
  // `recall()` neu. Hooks rufen häufig mit identischer Query auf
  // (detectTopics() ist deterministisch). LRU via Map-insertion-order,
  // hard cap 100 Einträge, TTL 30s. Vault-Change leert komplett.
  private queryCache = new Map<string, { hits: RecallHit[]; at: number }>();
  private static readonly QUERY_CACHE_MAX = 100;
  private static readonly QUERY_CACHE_TTL_MS = 30_000;

  constructor(private readonly vault: Vault) {
    this.mini = new MiniSearch<IndexDoc>({
      // #162: Identifier-erhaltender Tokenizer (Dual-Emission: `my-app.config.ts`
      // + `my app config ts`). Gilt für Index- UND Query-Seite — MiniSearch fällt
      // ohne `searchOptions.tokenize` auf diese Funktion zurück; KEIN separates
      // searchOptions.tokenize setzen, sonst bricht die Symmetrie (query-normalize.ts).
      tokenize: tokenizeWithIdentifiers,
      fields: [
        "title",
        "summary",
        "tags_flat",
        "recall_when_flat",
        "recall_when_expanded_flat",
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
        "sensitivity",
      ],
      searchOptions: {
        boost: {
          // recall_when is authored exactly for triggering — highest weight.
          recall_when_flat: 5,
          title: 4,
          tags_flat: 3,
          // doc2query paraphrases (#117): machine-generated, so weighted below
          // the hand-written triggers and tags but above plain body — they widen
          // far recall without outranking the author's own words.
          recall_when_expanded_flat: 2,
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

  /** Optionalen Embedding-Index registrieren — recallHybrid nutzt ihn,
   *  recall (sync) bleibt BM25-only für Backwards-Compat. */
  useEmbeddings(idx: EmbeddingIndex | undefined): void {
    this.embeddings = idx;
  }

  hasEmbeddings(): boolean {
    return this.embeddings !== undefined;
  }

  recall(query: string, opts: RecallOptions = {}): RecallHit[] {
    // #162: Query-Hygiene für ALLE Caller (MCP-Recall, Hooks, Bridge, Dedup) —
    // Längen-Cap, Whitespace-Kollaps, dangling Operatoren. Vor dem Cache-Key,
    // damit äquivalente Queries denselben Eintrag teilen.
    query = normalizeQuery(query);
    const k = opts.k ?? 5;
    const stage = new StageEmitter(opts.onStage);
    const recallStart = Date.now();

    const tParse = stage.start("query.parse");
    if (!query.trim()) {
      stage.end("query.parse", tParse);
      stage.emit("done", recallStart, { hit_count: 0, vault_size: this.mini.documentCount, total_ms: 0 });
      return [];
    }
    stage.end("query.parse", tParse);

    // Query-Cache (#30) — bei Hit komplett überspringen, inkl. Hop-
    // Expansion und Staleness-Reranking. Cache speichert das finale
    // RecallHit[], nicht den BM25-Roh-Output.
    const cacheKey = `recall|${query}|${JSON.stringify(opts)}`;
    const cached = this.lookupQueryCache(cacheKey);
    if (cached) {
      stage.emit("cache.hit", recallStart, { cache: "query", hit_count: cached.length });
      stage.emit("done", recallStart, {
        hit_count: cached.length,
        vault_size: this.mini.documentCount,
        total_ms: Date.now() - recallStart,
        cached: true,
      });
      return cached;
    }

    const tBm = stage.start("bm25.search");
    const raw = this.mini.search(query);
    stage.end("bm25.search", tBm, { raw_hit_count: raw.length });

    const filtered = raw.filter((r) => {
      if (!passesRecallFilters(r, opts)) return false;
      return true;
    });

    const ranked = this.rankBm25(filtered, k, opts, stage);

    this.storeQueryCache(cacheKey, ranked);

    stage.emit("done", recallStart, {
      hit_count: ranked.length,
      vault_size: this.mini.documentCount,
      total_ms: Date.now() - recallStart,
    });
    return ranked;
  }

  /**
   * BM25 hit construction → candidate pool → damping/re-sort → top-k → hops.
   *
   * Factored out so `recallHybrid` can degrade to the BM25 result WITHOUT
   * re-entering the public `recall()` (#240/B2 follow-up): that recursion
   * opened a second StageEmitter on the same callback, so `bm25.search` was
   * emitted twice, MCP progress jumped backwards from stage 4 to 1, telemetry
   * buckets overwrote each other, and a warm inner cache reported the whole
   * hybrid attempt as `cache.hit` while `onCandidatePool` fired zero times.
   * The caller owns `query.parse`, `bm25.search`, `done` and the cache.
   */
  private rankBm25(
    filtered: ReturnType<MiniSearch<IndexDoc>["search"]>,
    k: number,
    opts: RecallOptions,
    stage: StageEmitter,
  ): RecallHit[] {
    // Pool-Size für Hop-Seeds: max(k*4, 20). Multi-Hop soll Nachbarn auch
    // für Hits sehen, die knapp unter dem k-Cut liegen — sonst gehen die
    // related_via-Kanten der Positionen 6–20 verloren.
    const HOP_SEED_POOL = Math.max(k * 4, 20);
    const directFull: RecallHit[] = filtered.slice(0, HOP_SEED_POOL).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      type: r.type as string,
      scope: r.scope as string,
      summary: r.summary as string,
      topic_path: r.topic_path as string[],
      score: round(r.score),
      matched_terms: r.terms ?? [],
      matched_recall_when: matchedRecallWhen(r),
      mode: "bm25" as const,
      hop: "direct" as const,
    }));
    // #121: expose the deeper pool (incl. below-floor candidates) before slicing to k.
    opts.onCandidatePool?.(directFull);

    // #240/A7: apply the lifecycle/curator/doc/salience multipliers to the
    // FULL candidate pool and re-sort BEFORE cutting to k. Cutting first meant
    // a fresh hit at position k+1 could never displace an expired, demoted or
    // doc-damped hit inside the top-k — so the served top-k was not the top-k
    // of the ranking function the code actually defines. Fires whenever two
    // candidates sit within the damping factor of each other (<5× expired,
    // <2× doc/curator), which is the normal case for near-duplicate notes.
    // applyStaleness mutates scores in place, so the damping runs on a CLONE:
    // `directFull` keeps its raw scores for the hop seeds below. Damping the
    // seeds first compounded the multiplier — a neighbour behind an expired
    // seed was multiplied twice (0.2 × 0.2), dropping a fresh neighbour to 4%
    // of its raw score and below downstream floors.
    const tStale = stage.start("staleness.rank");
    const rankedFull = this.applyStaleness(directFull.map((h) => ({ ...h })), opts);
    const direct = rankedFull.slice(0, k);
    stage.end("staleness.rank", tStale, { reranked_count: direct.length });

    let ranked: RecallHit[];
    if (opts.expand_hops === 1) {
      const tHops = stage.start("hops.expand");
      // Seeded from the RAW pool; each neighbour is damped exactly once, by
      // its own multiplier.
      const neighbors = this.applyStaleness(
        this.collectOneHopNeighbors(directFull, opts, new Set(direct.map((h) => h.id))),
        opts,
      ).slice(0, k);
      stage.end("hops.expand", tHops, { hop_count: neighbors.length });
      ranked = [...direct, ...neighbors];
    } else {
      ranked = direct;
    }
    return ranked;
  }

  /** Hybrid-Recall: BM25 + Vector via Reciprocal-Rank-Fusion. Wenn kein
   *  EmbeddingIndex registriert ist — oder der Vektor-Arm nichts liefert
   *  (#240/B1) — fällt auf reines BM25 (sync) zurück.
   *
   *  Der finale Score ist `RRF * 5000` (siehe :39 und die Skalierung unten),
   *  NICHT die hier früher behaupteten `* 1000`. Wichtig für jeden, der
   *  Schwellen darauf setzt: der Wert ist eine skalierte Rang-Summe, keine
   *  Ähnlichkeit — Rang 1 in beiden Armen ergibt die Obergrenze 163.934
   *  (#230). */
  async recallHybrid(query: string, opts: RecallOptions = {}): Promise<RecallHit[]> {
    if (!this.embeddings) return this.recall(query, opts);
    // #162: gleiche Query-Hygiene wie in recall() — auch der Vector-Arm
    // profitiert vom Längen-Cap (idempotent, deshalb kein Doppel-Schaden
    // beim BM25-Fallback oben).
    query = normalizeQuery(query);
    const k = opts.k ?? 5;
    const stage = new StageEmitter(opts.onStage);
    const recallStart = Date.now();

    const tParse = stage.start("query.parse");
    if (!query.trim()) {
      stage.end("query.parse", tParse);
      stage.emit("done", recallStart, { hit_count: 0, vault_size: this.mini.documentCount, total_ms: 0 });
      return [];
    }
    stage.end("query.parse", tParse);

    // Query-Cache (#30) — eigener Key-Prefix damit BM25-only und Hybrid
    // sich nicht gegenseitig überschreiben (gleicher Query-String,
    // anderes Ranking-Ergebnis).
    // #240/B2: the cache key must carry the vector generation. Otherwise a
    // result computed while the vector arm was unavailable (provider down, or
    // simply the boot-window backfill still running) survives recovery for
    // the full TTL — and the boot window is exactly when session-start hooks
    // inject. Callbacks vanish from JSON.stringify, so they never varied the
    // key; the generation does.
    const cacheKey = `hybrid|${this.embeddings.size()}|${query}|${JSON.stringify(opts)}`;
    const cached = this.lookupQueryCache(cacheKey);
    if (cached) {
      // #240/B2: the sync path emits cache.hit + done on a hit; this one
      // returned before any emission, so SSE progress and the candidate-pool
      // harvest silently saw nothing.
      stage.emit("cache.hit", recallStart, { cache: "query", hit_count: cached.length });
      opts.onCandidatePool?.(cached);
      stage.emit("done", recallStart, {
        hit_count: cached.length,
        vault_size: this.mini.documentCount,
        total_ms: Date.now() - recallStart,
        cached: true,
      });
      return cached;
    }

    // BM25 — top 50 für RRF-Pool.
    const tBm = stage.start("bm25.search");
    const bm25 = this.mini.search(query).filter((r) => passesRecallFilters(r, opts));
    const bm25Top = bm25.slice(0, 50);
    stage.end("bm25.search", tBm, { raw_hit_count: bm25.length });

    // Vector — top 50 für RRF-Pool, plus type/scope/sensitivity-Filter über vault.
    const tVec = stage.start("vector.search");
    // #240/A8: ask for a deeper pool when a filter is active. The vault/scope/
    // type/private filter below runs AFTER the provider's global top-k, so a
    // fixed 100 silently truncated eligible candidates for every scoped query
    // — measured on a real 514-memory vault: 95.3% of scoped queries lost
    // in-scope candidates, and the smallest scopes lost a third of theirs.
    const filtered = opts.scope != null || opts.type != null || !opts.allow_private;
    const vec = await this.embeddings.search(query, filtered ? 1000 : 100);
    const vectorTop = vec
      .map((h) => ({ hit: h, mem: this.vault.get(h.id) }))
      .filter(({ mem }) => {
        if (!mem) return false;
        if (mem.fm.obsolete === true) return false;
        if (opts.scope && mem.fm.scope !== opts.scope) return false;
        if (opts.type && mem.fm.type !== opts.type) return false;
        if (
          !opts.allow_private &&
          (mem.fm as { sensitivity?: string }).sensitivity === "private"
        ) {
          return false;
        }
        return true;
      })
      .slice(0, 50);
    stage.end("vector.search", tVec, { vector_hit_count: vectorTop.length });

    // #240/B1: an empty vector arm is NOT "degraded to BM25" — running RRF
    // on one arm produced a different score space, not the BM25 one. A
    // one-armed rank-1 hit scores 5000/61 = 81.967 and rank 20 scores 62.5,
    // so every hit collapses into the 62–82 band: the floor stops
    // discriminating and the documented MUST_LOAD band (100) becomes
    // structurally unreachable exactly when the provider is down. Fall back
    // to the real BM25 path so scores mean what the thresholds assume.
    if (vectorTop.length === 0) {
      // Reuse the BM25 results this call already computed — no recursion into
      // the public pipeline, so the stage sequence stays monotonic and emits
      // exactly one `done` and one candidate-pool callback.
      const bm25Only = this.rankBm25(bm25, k, opts, stage);
      this.storeQueryCache(cacheKey, bm25Only);
      stage.emit("done", recallStart, {
        hit_count: bm25Only.length,
        vault_size: this.mini.documentCount,
        total_ms: Date.now() - recallStart,
        degraded: "vector-arm-empty",
      });
      return bm25Only;
    }

    const tFuse = stage.start("rrf.fuse");
    const bm25Ids = bm25Top.map((r) => r.id as string);
    const vectorIds = vectorTop.map(({ hit }) => hit.id);
    const fused = fuseRRF(bm25Ids, vectorIds);

    // Lookup-Maps für die finale Hit-Konstruktion.
    const bm25Lookup = new Map(bm25Top.map((r) => [r.id as string, r]));
    const vectorLookup = new Map(vectorTop.map((v) => [v.hit.id, v]));

    const sorted = Array.from(fused.entries()).sort((a, b) => b[1].score - a[1].score);
    // Größerer Pool für Hop-Seeds (siehe recall()-Kommentar).
    const HOP_SEED_POOL = Math.max(k * 4, 20);
    const outFull: RecallHit[] = [];
    for (const [id, entry] of sorted) {
      if (outFull.length >= HOP_SEED_POOL) break;
      const bm = bm25Lookup.get(id);
      const v = vectorLookup.get(id);
      const mem = v?.mem ?? this.vault.get(id);
      if (!mem) continue;
      const fm = mem.fm;
      const inBoth = bm !== undefined && v !== undefined;
      outFull.push({
        id: fm.id,
        title: fm.title,
        type: fm.type,
        scope: fm.scope,
        summary: fm.summary,
        topic_path: fm.topic_path,
        // RRF-Score skaliert auf BM25-vergleichbare Range. Klassisch sind
        // BM25-Scores ~5–500, RRF ist 0.005–0.04 → *5000 mappt grob.
        score: round(entry.score * 5000),
        matched_terms: bm?.terms ?? [],
        // #148: vom BM25-Arm; ein reiner Vektor-Treffer (kein `bm`) ist kein
        // lexikalisches recall_when-Match → false.
        matched_recall_when: bm ? matchedRecallWhen(bm) : false,
        mode: inBoth ? "hybrid" : bm ? "bm25" : "vector",
        hop: "direct" as const,
        // #230: Rang-Herkunft des skalierten Scores durchreichen (nur Hybrid).
        rrf: { rank_bm25: entry.rank_bm25, rank_vector: entry.rank_vector, raw: entry.score },
      });
    }
    stage.end("rrf.fuse", tFuse, { fused_count: outFull.length });

    // #121: expose the deeper pool (incl. below-floor candidates) before slicing to k.
    opts.onCandidatePool?.(outFull);

    // #240/A7: same ordering fix as the BM25 path — multipliers and re-sort
    // over the full pool, THEN cut to k. Damping runs on a clone so `outFull`
    // keeps raw scores for the hop seeds (see the BM25 path for why).
    const tStale = stage.start("staleness.rank");
    const rankedFull = this.applyStaleness(outFull.map((h) => ({ ...h })), opts);
    const out = rankedFull.slice(0, k);
    stage.end("staleness.rank", tStale, { reranked_count: out.length });

    let ranked: RecallHit[];
    if (opts.expand_hops === 1) {
      const tHops = stage.start("hops.expand");
      const neighbors = this.applyStaleness(
        this.collectOneHopNeighbors(outFull, opts, new Set(out.map((h) => h.id))),
        opts,
      ).slice(0, k);
      stage.end("hops.expand", tHops, { hop_count: neighbors.length });
      ranked = [...out, ...neighbors];
    } else {
      ranked = out;
    }

    this.storeQueryCache(cacheKey, ranked);

    stage.emit("done", recallStart, {
      hit_count: ranked.length,
      vault_size: this.mini.documentCount,
      total_ms: Date.now() - recallStart,
    });
    return ranked;
  }

  /**
   * Multi-Hop-Expansion (#30 / #51): sammelt `related_via.id`-Nachbarn aus
   * den Seed-Hits (typischerweise top-20 aus dem BM25/Hybrid-Pool, nicht nur
   * top-k — sonst gehen Nachbarn von Position 6–20 verloren), filtert sie
   * (obsolete / scope / type / sensitivity / dedup gegen `exclude`), und
   * liefert sie mit reduziertem Score sortiert zurück. Score-Reduktion:
   * `seed.score * 0.5 * link.score` (heuristisch — Nachbarn sollen nie über
   * direkte Treffer ranken). Wenn ein Nachbar mehrfach gefunden wird, gewinnt
   * der höchste Score.
   */
  private collectOneHopNeighbors(
    seeds: RecallHit[],
    opts: RecallOptions,
    exclude: Set<string>,
  ): RecallHit[] {
    if (seeds.length === 0) return [];
    const best = new Map<string, RecallHit>();
    for (const seed of seeds) {
      const mem = this.vault.get(seed.id);
      const related = (mem?.fm as { related_via?: { id: string; reason: string; score: number }[] })
        ?.related_via;
      if (!related?.length) continue;
      for (const link of related) {
        if (exclude.has(link.id)) continue;
        const neigh = this.vault.get(link.id);
        if (!neigh) continue;
        if (neigh.fm.obsolete === true) continue;
        if (opts.scope && neigh.fm.scope !== opts.scope) continue;
        if (opts.type && neigh.fm.type !== opts.type) continue;
        if (
          !opts.allow_private &&
          (neigh.fm as { sensitivity?: string }).sensitivity === "private"
        ) {
          continue;
        }
        const score = round(seed.score * 0.5 * link.score);
        const prior = best.get(link.id);
        if (prior && prior.score >= score) continue;
        best.set(link.id, {
          id: neigh.fm.id,
          title: neigh.fm.title,
          type: neigh.fm.type,
          scope: neigh.fm.scope,
          summary: neigh.fm.summary,
          topic_path: neigh.fm.topic_path,
          score,
          matched_terms: [],
          mode: seed.mode,
          hop: "1-hop" as const,
        });
      }
    }
    return Array.from(best.values()).sort((a, b) => b.score - a.score);
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
      // Staleness-Cache invalidieren (#29) — memId genügt.
      this.stalenessCache.delete(e.id);
      // Query-Cache komplett leeren (#30) — selektive Invalidierung wäre
      // ein eigenes Ranking-Problem und Vault-Changes sind selten.
      this.queryCache.clear();
      try {
        this.mini.discard(e.id);
      } catch {
        // not indexed; ignore
      }
      return;
    }
    if (e.kind === "change") {
      this.stalenessCache.delete(e.memory.fm.id);
      this.queryCache.clear();
      try {
        this.mini.discard(e.memory.fm.id);
      } catch {
        // first time; treat as add
      }
    } else if (e.kind === "add") {
      // Neue Memory könnte BM25-Ranking aller bestehenden Queries
      // verändern → Query-Cache leeren. Staleness wird ohnehin lazy
      // beim nächsten Recall berechnet.
      this.queryCache.clear();
    }
    this.indexOne(e.memory);
  }

  /**
   * Staleness-Reranking mit Per-Memory-Cache (#29). Cache-Key ist die
   * memId — invalidiert in `handle()` bei change/remove. Zusätzlich
   * 12h-TTL gegen Tageswechsel-Flips (`aging → stale` ohne Vault-Change).
   *
   * Behält die Sortier-Semantik von `applyStalenessMultiplier`: Direct-
   * vs 1-hop-Hits bleiben getrennt sortiert.
   *
   * Doc-Dämpfung: type="doc" (Document-Sidecars + Produkt-Doku) wird im
   * Default-Recall (kein expliziter type-Filter) gedämpft — lange Doc-Bodies
   * sollen Lessons/Decisions nicht verdrängen. `find_document` und jeder
   * Recall mit type:"doc" ranken ungedämpft (das ist die dedizierte Lane).
   */
  private applyStaleness(hits: RecallHit[], opts: RecallOptions = {}, now: Date = new Date()): RecallHit[] {
    const nowMs = now.getTime();
    for (const h of hits) {
      const fm = this.vault.get(h.id)?.fm as Record<string, unknown> | undefined;
      if (!fm) continue;
      const touchTs = computeTouchTs(fm);
      let entry = this.stalenessCache.get(h.id);
      const ttlExpired =
        entry != null && nowMs - entry.computedAt > SearchIndex.STALENESS_CACHE_TTL_MS;
      if (!entry || entry.touchTs !== touchTs || ttlExpired) {
        const status = computeStaleness(fm, now);
        entry = { touchTs, status, computedAt: nowMs };
        this.stalenessCache.set(h.id, entry);
      }
      let mult = STALE_MULTIPLIERS[entry.status];
      if (this.curatorDemotions.has(h.id)) mult *= CURATOR_DEMOTION_MULTIPLIER;
      if (!opts.type && h.type === "doc") mult *= DOC_TYPE_DAMPING;
      // #217: Salience boostet nur im Live-Modus (default: shadow-only im
      // Daemon). Prozess-statisch schalten — nie pro Request. Case-insensitiv
      // wie salienceRankMode() im Daemon — sonst schaltet "LIVE" beide Lanes
      // still aus (Review-Finding).
      if ((process.env.BASTRA_SALIENCE_RANK ?? "").toLowerCase() === "live") {
        const sal =
          typeof fm.salience === "number" ? Math.min(Math.max(fm.salience, 0), 1) : 0;
        if (sal > 0) mult *= 1 + sal * salienceRankCap();
      }
      if (mult !== 1.0) h.score = round(h.score * mult);
    }
    const direct = hits.filter((h) => h.hop !== "1-hop");
    const hops = hits.filter((h) => h.hop === "1-hop");
    direct.sort((a, b) => b.score - a.score);
    hops.sort((a, b) => b.score - a.score);
    return [...direct, ...hops];
  }

  /**
   * LRU-Lookup für `queryCache` (#30). Bei Hit wird der Eintrag
   * re-inserted, damit die Map-insertion-order ihn als „recently used"
   * sieht. TTL 30s — frische Edits sollen den Cache nicht zu lange
   * dominieren, auch wenn der Watcher nicht feuert.
   */
  private lookupQueryCache(key: string): RecallHit[] | undefined {
    const cached = this.queryCache.get(key);
    if (!cached) return undefined;
    if (Date.now() - cached.at > SearchIndex.QUERY_CACHE_TTL_MS) {
      this.queryCache.delete(key);
      return undefined;
    }
    // LRU-Bump: löschen + neu setzen, damit Map-iteration den Eintrag
    // als jüngsten sieht.
    this.queryCache.delete(key);
    this.queryCache.set(key, cached);
    // Defensive Kopie — Caller könnte das Array mutieren (sortieren,
    // pushen). Cache-Werte bleiben damit stabil über Calls hinweg.
    return cached.hits.map((h) => ({ ...h }));
  }

  private storeQueryCache(key: string, hits: RecallHit[]): void {
    if (this.queryCache.size >= SearchIndex.QUERY_CACHE_MAX) {
      // Oldest first — Map preserved insertion order.
      const oldest = this.queryCache.keys().next().value;
      if (oldest !== undefined) this.queryCache.delete(oldest);
    }
    // Tiefen-Kopie der Hits, gleicher Grund wie in lookupQueryCache.
    this.queryCache.set(key, {
      hits: hits.map((h) => ({ ...h })),
      at: Date.now(),
    });
  }

  private indexOne(m: Memory): void {
    const fm = m.fm;
    const doc: IndexDoc = {
      id: fm.id,
      title: fm.title,
      summary: fm.summary,
      tags_flat: fm.tags.join(" "),
      recall_when_flat: fm.recall_when.join(" \n "),
      recall_when_expanded_flat: (fm.recall_when_expanded ?? []).join(" \n "),
      topic_path_flat: fm.topic_path.join(" "),
      body: m.body,
      type: fm.type,
      scope: fm.scope,
      topic_path: fm.topic_path,
      obsolete: fm.obsolete === true,
      confidence: fm.confidence ?? 1,
      // Default ist "team" (kommt aus dem zod-Schema), aber alte Files
      // ohne das Feld werden hier zu "team" defaultet damit der Filter
      // konsistent ist.
      sensitivity: (fm as { sensitivity?: string }).sensitivity ?? "team",
    };
    this.mini.add(doc);
  }
}

/**
 * Standard-Filter für BM25-Roh-Treffer: obsolete-Maskierung, scope/type-
 * Exact-Match, und der neue Sensitivity-Filter (#58). Wird sowohl von
 * `recall` als auch von `recallHybrid` aufgerufen, damit der Filter an
 * einer Stelle gepflegt wird. `r` ist ein MiniSearch-`SearchResult`, das
 * via `storeFields` die gespeicherten Doc-Properties als beliebige
 * Keys mit-trägt — daher das `Record<string, unknown>`-Typing hier.
 */
function passesRecallFilters(
  r: Record<string, unknown>,
  opts: RecallOptions,
): boolean {
  if (r.obsolete) return false;
  if (opts.scope && r.scope !== opts.scope) return false;
  if (opts.type && r.type !== opts.type) return false;
  if (!opts.allow_private && r.sensitivity === "private") return false;
  return true;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// MARK: - Stage-Event-Emitter (#38)

/**
 * Hilfsklasse für Stage-Events in `recall` / `recallHybrid`. Hält den
 * optionalen Listener und liefert `start()`/`end()`/`emit()`. Bei
 * fehlendem Listener sind alle Methoden no-op und allokationsfrei
 * (kein `Date.now()` ohne Bedarf). Die Klasse lebt nur in `search.ts`,
 * weil sie tight an die Stage-Sequenz gekoppelt ist — die public Types
 * stehen in `recall-stages.ts`.
 */
class StageEmitter {
  constructor(private readonly listener?: StageListener) {}

  /** Start-Event feuern. Liefert den Start-Timestamp, der unverändert
   *  an `end()` zurückgegeben wird (so muss der Caller kein lokales
   *  `const t = Date.now()` aufmachen). */
  start(name: RecallStage["name"], meta?: Record<string, unknown>): number {
    if (!this.listener) return 0;
    const t = Date.now();
    this.listener({ name, startedAtMs: t, meta });
    return t;
  }

  /** Stop-Event feuern. `startedAt` ist der Rückgabewert von `start()`. */
  end(name: RecallStage["name"], startedAt: number, meta?: Record<string, unknown>): void {
    if (!this.listener) return;
    const dur = Date.now() - startedAt;
    this.listener({ name, startedAtMs: startedAt, durationMs: dur, meta });
  }

  /** One-shot-Event (kein separates Stop) — für `cache.hit`, `done`,
   *  `error`. `startedAtMs` ist der „Recall-Start" (für `done`) oder
   *  der Event-Zeitpunkt selbst. */
  emit(name: RecallStage["name"], startedAtMs: number, meta?: Record<string, unknown>): void {
    if (!this.listener) return;
    this.listener({ name, startedAtMs, durationMs: Date.now() - startedAtMs, meta });
  }
}

// MARK: - Lifecycle-Reranking (#74)

/**
 * Default-Verfallszeit pro Memory-Type. Identisch zu
 * `Sources/Bastra/MemoryLifecycle.swift:defaultExpirationDays` — bei
 * Änderungen beide Stellen mitziehen.
 * `null` = Type altert nie automatisch (Bookmarks, Documents,
 * Preferences, References).
 */
const DEFAULT_EXPIRATION_DAYS: Record<string, number | null> = {
  lesson: 180,
  decision: 365,
  "project-fact": 90,
  "meta-working": 365,
  workflow: 180,
  preference: null,
  "user-preference": null,
  reference: null,
  bookmark: null,
  doc: null,
};

const AGING_THRESHOLD_FRACTION = 0.75;

/**
 * Score-Multiplier basierend auf der Staleness (#74). Wird nach allen
 * anderen Filtern in `recall`/`recallHybrid` auf den finalen Hit-Score
 * angewandt — stale Memories ranken niedriger, expired noch niedriger.
 */
export type StaleStatus = "fresh" | "aging" | "stale" | "expired";

const STALE_MULTIPLIERS: Record<StaleStatus, number> = {
  fresh: 1.0,
  aging: 0.85,
  stale: 0.5,
  expired: 0.2,
};

/**
 * Curator-Demotion (#155): Score-Faktor für Memories, die der deterministische
 * Staleness-Pass demotet hat (surfaced-but-never-acted-on). Gleiche Liga wie
 * "stale": auffindbar, aber hinter engagierten Memories. Score-only per
 * survival-by-id-Vertrag (#146) — load_memory, Citations und die Datei selbst
 * bleiben unberührt; die Engine trägt nur den Mechanismus (setDemotions),
 * die Curation-Entscheidung lebt im Daemon.
 */
export const CURATOR_DEMOTION_MULTIPLIER = 0.5;

/**
 * Dämpfung für type="doc"-Hits im Default-Recall (kein expliziter type-
 * Filter). Docs altern nie (DEFAULT_EXPIRATION_DAYS: null) UND haben lange
 * Bodies — ohne Dämpfung würden Produkt-Doku und Document-Sidecars Lessons
 * aus den Top-k drängen. 0.5 = gleiche Liga wie "stale": auffindbar, aber
 * hinter frischen Memories. Mit type:"doc" (= find_document) volle Scores.
 */
export const DOC_TYPE_DAMPING = 0.5;

/**
 * #217 Valenz: begrenzter Salience-Multiplikator (1 + salience × CAP).
 * Default ist SHADOW-only — der Daemon loggt die would-be-Reihenfolge
 * (salience-shadow.ts), live wird erst via BASTRA_SALIENCE_RANK=live nach
 * Lift-Nachweis geschaltet (Disziplin wie #160). Env wird pro Aufruf
 * gelesen (testfreundlich), darf aber nie pro Request umgeschaltet werden —
 * der Query-Cache cached das post-staleness-Ranking.
 */
export function salienceRankCap(): number {
  const raw = Number(process.env.BASTRA_SALIENCE_RANK_CAP ?? "0.25");
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.25;
}

export function computeStaleness(
  fm: Record<string, unknown>,
  now: Date = new Date(),
): StaleStatus {
  const updated = parseDateValue(fm.updated);
  const lastReviewed = parseDateValue(fm.last_reviewed_at);
  const touch = Math.max(updated ?? 0, lastReviewed ?? 0);

  const validUntil = parseDateValue(fm.valid_until);
  if (validUntil != null) {
    if (now.getTime() >= validUntil) return "expired";
    const total = validUntil - touch;
    const elapsed = now.getTime() - touch;
    if (total > 0 && elapsed / total >= AGING_THRESHOLD_FRACTION) {
      return "aging";
    }
    return "fresh";
  }

  const type = String(fm.type ?? "");
  const userOverride =
    typeof fm.expires_after_days === "number" ? (fm.expires_after_days as number) : null;
  const typeDefault =
    type in DEFAULT_EXPIRATION_DAYS ? DEFAULT_EXPIRATION_DAYS[type] : null;
  let days = userOverride ?? typeDefault;
  if (days == null || days <= 0) return "fresh";

  // #217 Valenz: hohe Salience altert langsamer — emotional aufgeladene
  // Memories verblassen zuletzt. salience 1 = doppelte Lebensdauer.
  // `valid_until` bleibt unberührt (explizites User-Datum gewinnt).
  const salience =
    typeof fm.salience === "number" ? Math.min(Math.max(fm.salience, 0), 1) : 0;
  if (salience > 0) days = days * (1 + salience);

  if (touch <= 0) return "fresh";
  const secondsSinceTouch = (now.getTime() - touch) / 1000;
  const staleSeconds = days * 86400;
  if (secondsSinceTouch <= 0) return "fresh";
  const ratio = secondsSinceTouch / staleSeconds;
  if (ratio >= 1.5) return "expired";
  if (ratio >= 1.0) return "stale";
  if (ratio >= AGING_THRESHOLD_FRACTION) return "aging";
  return "fresh";
}

function parseDateValue(raw: unknown): number | null {
  if (raw == null) return null;
  // YAML kann `2026-05-12` als Date entlocken — wir akzeptieren beides.
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "string" && raw.length > 0) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * „Touch-Timestamp" einer Memory: jüngeres aus `updated` und
 * `last_reviewed_at`. Wird vom Staleness-Cache (#29) als Identitäts-
 * Stempel benutzt — ändert sich der touchTs, wird der Cache-Eintrag
 * neu berechnet, auch ohne Vault-Event (z.B. wenn die Mac-App die
 * Frontmatter direkt patcht).
 */
function computeTouchTs(fm: Record<string, unknown>): number {
  const updated = parseDateValue(fm.updated) ?? 0;
  const lastReviewed = parseDateValue(fm.last_reviewed_at) ?? 0;
  return Math.max(updated, lastReviewed);
}

/**
 * Wendet den Staleness-Multiplier auf einen Hit-Score an. Daemon nutzt
 * die `vault.get(id).fm` als Quelle für das Frontmatter — die Computation
 * läuft lazy beim Recall (kein File-Write).
 */
export function applyStalenessMultiplier(
  hits: RecallHit[],
  resolveFrontmatter: (id: string) => Record<string, unknown> | undefined,
  now: Date = new Date(),
): RecallHit[] {
  for (const h of hits) {
    const fm = resolveFrontmatter(h.id);
    if (!fm) continue;
    const status = computeStaleness(fm, now);
    const mult = STALE_MULTIPLIERS[status];
    if (mult !== 1.0) {
      h.score = round(h.score * mult);
    }
  }
  // Re-sort nach möglicher Score-Anpassung. Direct-Hits vor 1-hop-Hits
  // bleiben aber Gruppe — wir sortieren INNERHALB jeder Gruppe.
  const direct = hits.filter((h) => h.hop !== "1-hop");
  const hops = hits.filter((h) => h.hop === "1-hop");
  direct.sort((a, b) => b.score - a.score);
  hops.sort((a, b) => b.score - a.score);
  return [...direct, ...hops];
}
