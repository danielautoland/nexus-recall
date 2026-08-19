/**
 * Shared learned-recall bridges (#120) — the data model + pool + query expansion.
 *
 * A BRIDGE is a language-tagged vocabulary-expansion rule, NOT a memory. It says:
 * "in language L, a query phrased with `trigger_terms` should also search for
 * `expansion_terms`." That is the whole privacy contract — a bridge carries only
 * term lists and a language, never a memory id, body, or any vault content. It is
 * the lexical floor of zzallirog's "drag far next to near" idea: instead of an
 * encoder learning the far↔near map, a bridge widens the BM25 surface so a
 * far-worded query reaches the memory the contributor already proved it resolves to.
 *
 * Pools are partitioned by language (product requirement): a German bridge only
 * ever fires for a query detected as German. Bridges are loaded read-only from a
 * git-synced clone (mirroring Bastra Commons) and never written there by the daemon.
 *
 * The shared/contribution path is privacy-sensitive: scrubBridge() is a best-effort
 * filter, and the real guarantee is the same PR review gate Commons uses. The local
 * pool (this machine only) and the contribution path are independent — toggle off
 * means neither runs.
 *
 * Wiring status (#120, staged): BridgePool.load + expandQuery are wired into recall.
 * mintBridge (harvest a bridge from a successful recall) and scrubBridge (contribute)
 * are implemented and tested but NOT yet wired into the live telemetry/contribution
 * loop — that step depends on #121 (the below-floor far slice is not logged yet). So
 * with the layer enabled but no cloned bridges repo, the pool is empty and the layer
 * is a deliberate no-op.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { capAtWordBoundary } from "@bastra-recall/core";
import { detectLanguage, isSupportedLanguage, type SupportedLanguage } from "./language.js";

export interface Bridge {
  /** Deterministic dedup key = hash(lang + sorted trigger + sorted expansion). */
  id: string;
  /** Language of the far query this bridge serves; selects which pool it lives in. */
  lang: SupportedLanguage;
  /** Distinctive tokens of the far query — at least one must appear for the bridge to fire. */
  trigger_terms: string[];
  /** Vocabulary the bridge adds to a matching query to broaden recall. */
  expansion_terms: string[];
  /** Independent confirmations (verify-loop evidence). 1 when freshly minted. */
  evidence: number;
  /** Pseudonymous contributor hash (Commons verifierId shape). Absent for local mints. */
  verifier?: string;
  date?: string;
}

// A distinctive term: ≥4 chars, not a stopword-ish filler, deduped. Mirrors the
// spirit of tool-handlers' distinctiveTokensForActedOn, kept independent to avoid
// a circular import. The point is to drop noise words so triggers/expansions are
// specific enough to be useful and safe-ish to share.
const MIN_TERM_LEN = 4;
const GENERIC_TERMS = new Set([
  "this", "that", "with", "from", "have", "should", "would", "could", "your",
  "what", "when", "where", "which", "about", "into", "code", "file", "files",
  "eine", "einen", "einem", "einer", "dann", "noch", "auch", "sehr", "wenn",
  "wieder", "schon", "nicht", "machen", "soll", "sollte", "werden", "diese",
  "dieser", "dieses", "beim", "dass", "weil",
]);

/** Extract deduped distinctive terms from a free-text string. */
/** Quality track (#353 addendum): ephemeral tokens — raw tool-call ids,
 *  chat snowflakes, commit shas, date fragments — can never recur in a
 *  future query. A bridge whose trigger carries one is a dead slot; an
 *  expansion carrying one is noise. zzalli measured ~1/3 of a fresh mint
 *  affected. Filtered at the term source, so trigger AND expansion (and the
 *  near-terms overlap check) all stay clean. */
export function isEphemeralTerm(t: string): boolean {
  if (/^\d{5,}$/.test(t)) return true; // snowflakes, timestamps, big counters
  if (/^(19|20)\d{2}$/.test(t)) return true; // bare years — ISO-date fragments
  if (/^(?=.*\d)[0-9a-f]{6,}$/.test(t)) return true; // hex ids: shas, uuid/tool-call segments
  if (/^(?=.*\d)[a-z0-9]{12,}$/.test(t)) return true; // long alnum ids (base36-ish)
  return false;
}

export function distinctiveTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-zäöüß0-9]+/i)) {
    if (raw.length < MIN_TERM_LEN) continue;
    if (GENERIC_TERMS.has(raw)) continue;
    if (isEphemeralTerm(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

/** Stable id so the same bridge from two contributors dedupes to one file. */
export function bridgeId(lang: string, trigger: string[], expansion: string[]): string {
  const norm = (xs: string[]): string => [...new Set(xs.map((x) => x.toLowerCase()))].sort().join(" ");
  return createHash("sha256").update(`${lang}\n${norm(trigger)}\n${norm(expansion)}`).digest("hex").slice(0, 16);
}

// ─── Minting (local: a successful far recall → a bridge) ─────────────────────

const MAX_TRIGGER_TERMS = 8;
const MAX_EXPANSION_TERMS = 10;

/**
 * Build a bridge from a successful recall: the far query's distinctive terms become
 * the trigger, and the resolved memory's distinctive terms (those NOT already in the
 * query) become the expansion — the near vocabulary the far query failed to use.
 * Returns null when there is no usable signal or the language could not be detected
 * (no language → no pool to put it in).
 */
export function mintBridge(
  query: string,
  memoryTerms: string[],
  lang: SupportedLanguage | null = detectLanguage(query).lang,
  date?: string,
): Bridge | null {
  if (!lang) return null;
  const trigger = distinctiveTerms(query).slice(0, MAX_TRIGGER_TERMS);
  if (trigger.length === 0) return null;
  const triggerSet = new Set(trigger);
  const expansion = memoryTerms
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= MIN_TERM_LEN && !GENERIC_TERMS.has(t) && !triggerSet.has(t))
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, MAX_EXPANSION_TERMS);
  if (expansion.length === 0) return null;
  return {
    id: bridgeId(lang, trigger, expansion),
    lang,
    trigger_terms: trigger,
    expansion_terms: expansion,
    evidence: 1,
    ...(date ? { date } : {}),
  };
}

// ─── Scrub (contribution: best-effort privacy filter before a bridge leaves) ──

// Terms that look like identifiers, paths, secrets, or proper-noun-ish leakage are
// dropped before a bridge can be contributed. This is BEST-EFFORT — the real
// guarantee is the PR review gate (a human sees every contributed bridge), same as
// Commons. We never auto-egress; this only shapes what a deliberate contribution
// would carry.
const LOOKS_SENSITIVE = [
  /\d/, // any digit → ids, versions, dates, ticket numbers
  /[/\\.@:]/, // path/email/url separators
  /_/, // snake_case identifiers
  /^[a-f0-9]{8,}$/i, // hex hashes
];
const MIN_SHARE_TERMS = 2;
const MAX_SHARE_TERM_LEN = 24;

function scrubTerms(terms: string[]): string[] {
  return terms.filter((t) => t.length <= MAX_SHARE_TERM_LEN && !LOOKS_SENSITIVE.some((re) => re.test(t)));
}

/**
 * Best-effort scrub of a bridge for contribution. Returns null when too little
 * survives to be a useful, safe bridge — that bridge simply is not shared. The
 * surviving bridge still passes through PR review before it is authoritative.
 */
export function scrubBridge(b: Bridge): Bridge | null {
  const trigger = scrubTerms(b.trigger_terms);
  const expansion = scrubTerms(b.expansion_terms);
  if (trigger.length < 1 || expansion.length < MIN_SHARE_TERMS) return null;
  return { ...b, id: bridgeId(b.lang, trigger, expansion), trigger_terms: trigger, expansion_terms: expansion };
}

// ─── Pool (read-only, language-partitioned, loaded from a clone) ─────────────

const MAX_QUERY_EXPANSION = 12; // cap how much a single query can be widened

// #162: the base query is capped BEFORE expansion terms are appended, so the
// appended terms always survive core's downstream QUERY_MAX_CHARS (8000)
// defense cap — otherwise a long base pushes the tail-appended expansions
// past the cap and telemetry claims an expansion that was silently dropped.
// 4000 base + ≤12 terms of ≤24 chars stays far below the core cap.
const MAX_BASE_QUERY_CHARS = 4000;

/**
 * A language-partitioned, read-only set of bridges. Built once at daemon boot from
 * <root>/bridges/<lang>/*.json (mirroring the Commons recipes layout). Never written.
 */
export class BridgePool {
  private constructor(private readonly byLang: Map<SupportedLanguage, Bridge[]>) {}

  static empty(): BridgePool {
    return new BridgePool(new Map());
  }

  /** Load <root>/bridges/<lang>/*.json into per-language buckets. Defensive: skips
   *  corrupt files and unknown languages, never throws. */
  static load(rootDir: string): BridgePool {
    const byLang = new Map<SupportedLanguage, Bridge[]>();
    const base = join(rootDir, "bridges");
    try {
      for (const langDir of readdirSync(base, { withFileTypes: true })) {
        if (!langDir.isDirectory() || !isSupportedLanguage(langDir.name)) continue;
        const lang = langDir.name;
        const bucket: Bridge[] = [];
        for (const f of readdirSync(join(base, lang))) {
          if (!f.endsWith(".json")) continue;
          try {
            const b = JSON.parse(readFileSync(join(base, lang, f), "utf8")) as Bridge;
            if (!isValidBridge(b) || b.lang !== lang) continue;
            // Defense-in-depth: a cloned repo is foreign input. Cap term length so
            // no oversized token from a hostile bridge ever reaches the search query
            // (the contribution path scrubs; the load path must not trust more).
            const trigger = b.trigger_terms.filter((t) => t.length <= MAX_SHARE_TERM_LEN);
            const expansion = b.expansion_terms.filter((t) => t.length <= MAX_SHARE_TERM_LEN);
            if (trigger.length === 0 || expansion.length === 0) continue;
            bucket.push({ ...b, trigger_terms: trigger, expansion_terms: expansion });
          } catch {
            /* skip corrupt bridge */
          }
        }
        // Sort once by descending evidence here so the recall hot path (expansionsFor)
        // can iterate directly without re-sorting on every query.
        if (bucket.length > 0) {
          bucket.sort((a, c) => c.evidence - a.evidence);
          byLang.set(lang, bucket);
        }
      }
    } catch {
      /* no bridges dir yet → empty pool */
    }
    return new BridgePool(byLang);
  }

  size(lang?: SupportedLanguage): number {
    if (lang) return this.byLang.get(lang)?.length ?? 0;
    let n = 0;
    for (const b of this.byLang.values()) n += b.length;
    return n;
  }

  languages(): SupportedLanguage[] {
    return [...this.byLang.keys()];
  }

  /**
   * Collect expansion terms from every bridge in `lang` whose trigger overlaps the
   * query. Higher-evidence bridges contribute first; result is deduped, excludes
   * terms already in the query, and is capped. Pure — no detection here.
   */
  expansionsFor(query: string, lang: SupportedLanguage): string[] {
    const bridges = this.byLang.get(lang);
    if (!bridges || bridges.length === 0) return [];
    const queryTerms = new Set(distinctiveTerms(query));
    if (queryTerms.size === 0) return [];
    const added = new Set<string>();
    for (const b of bridges) {
      // bucket is pre-sorted by descending evidence at load time
      if (!b.trigger_terms.some((t) => queryTerms.has(t))) continue;
      for (const e of b.expansion_terms) {
        if (!queryTerms.has(e)) added.add(e);
        if (added.size >= MAX_QUERY_EXPANSION) break;
      }
      if (added.size >= MAX_QUERY_EXPANSION) break;
    }
    return [...added];
  }
}

function isValidBridge(b: unknown): b is Bridge {
  const x = b as Bridge;
  return (
    !!x &&
    typeof x.id === "string" &&
    isSupportedLanguage(x.lang) &&
    Array.isArray(x.trigger_terms) &&
    x.trigger_terms.every((t) => typeof t === "string") &&
    Array.isArray(x.expansion_terms) &&
    x.expansion_terms.every((t) => typeof t === "string") &&
    typeof x.evidence === "number"
  );
}

// ─── Query expansion (the recall-time integration helper) ────────────────────

export interface ExpansionResult {
  /** The query to actually run — original (base capped at MAX_BASE_QUERY_CHARS
   *  when expansions fire), plus any bridge expansion terms appended. */
  query: string;
  /** The language the bridge layer routed on (null = abstained, no expansion). */
  lang: SupportedLanguage | null;
  /** The expansion terms that were appended (empty when none fired). */
  added: string[];
}

/**
 * The single recall-time entry point used by both the MCP recall handler and the
 * hook recall path. Detects the query language (or uses a configured override),
 * consults ONLY the matching language pool, and returns the (possibly widened)
 * query. Local-first/no-op safety: a null pool or an abstained/unsupported language
 * returns the query untouched.
 */
export function expandQuery(
  query: string,
  pool: BridgePool | null | undefined,
  opts: { configuredLang?: SupportedLanguage | null } = {},
): ExpansionResult {
  if (!pool) return { query, lang: null, added: [] };
  const lang = opts.configuredLang ?? detectLanguage(query).lang;
  if (!lang) return { query, lang: null, added: [] };
  const added = pool.expansionsFor(query, lang);
  if (added.length === 0) return { query, lang, added: [] };
  // Trigger-Matching (expansionsFor) sah die VOLLE Query; nur die Basis des
  // zusammengesetzten Suchstrings wird gedeckelt (Wortgrenze, nie im Token),
  // damit die Expansions strukturell vor dem Core-Cap sicher sind (#162).
  const base = capAtWordBoundary(query, MAX_BASE_QUERY_CHARS);
  return { query: `${base} ${added.join(" ")}`, lang, added };
}
