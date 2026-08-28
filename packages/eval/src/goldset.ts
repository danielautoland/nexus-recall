/**
 * The M0 gold set: schema, provenance and the two-step discipline (#262, §19).
 *
 * §19 puts one hard rule on how a gold case may come into existence:
 *
 *   "Beim Formulieren oder Auswählen der Query dürfen Body, Summary und
 *    `recall_when` des Ziel-Memorys nicht geöffnet werden. Die Zuordnung zum
 *    Gold-Memory erfolgt erst danach durch einen getrennten Label-Schritt."
 *
 * That is not paperwork. A paraphrase written while looking at the memory it is
 * supposed to retrieve is a paraphrase of the answer, and measuring retrieval
 * against it measures how well the index finds text derived from itself. The
 * repo's current `PARAPHRASED_CASES` are built exactly that way — their own
 * header says "3-5 paraphrases of its recall_when trigger" — so they cannot
 * serve as the M0 gold set no matter how good the numbers look.
 *
 * The two steps are therefore separate types, not two fields on one object:
 * a `StagedQuery` has provenance and no gold, a `GoldCase` adds the label and
 * the rationale. Nothing here can produce a GoldCase from a memory body,
 * because nothing here ever reads one.
 */
import { createHash } from "node:crypto";

/** §19: the five admissible independent query sources. */
export const ORIGIN_TYPES = [
  "session_transcript",
  "task_text",
  "issue_incident",
  "user_query",
  "second_person",
] as const;
export type OriginType = (typeof ORIGIN_TYPES)[number];

/** §19 expects the retrieval zone a case is expected to resolve in. */
export const ZONES = ["core", "orbit", "outer_orbit", "asteroid_belt"] as const;
export type Zone = (typeof ZONES)[number];

/** C-051/C-057: the two cue axes must stay independently measurable. */
export const CASE_KINDS = ["descriptive", "associative"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/**
 * Real recall traffic that is not a retrieval question.
 *
 * Diagnostic and noise-test runs leave events in the telemetry like any other
 * recall, so they get harvested like any other recall. They are worth keeping —
 * a nonsense string the engine must abstain on is a real test — but they must
 * not share a denominator with questions someone actually asked:
 *
 *   - `body-loss`      one investigation, several runs, one target memory. Four
 *                      ids would weight that memory four times.
 *   - `unique-n`       generator strings with a run counter (`… unique7`).
 *   - `gibberish-probe` keyboard mash and invented words, used to check that
 *                      retrieval abstains instead of reaching.
 *
 * A case carries a group or it does not; the field is optional, so every file
 * written before it existed stays valid and counts as a normal case.
 */
export const PROBE_GROUPS = ["body-loss", "unique-n", "gibberish-probe"] as const;
export type ProbeGroup = (typeof PROBE_GROUPS)[number];

/**
 * Step 1 — a query with its provenance and NO gold label.
 *
 * This is everything that may exist before a memory is opened.
 */
export interface StagedQuery {
  /** Stable id derived from the query text, so re-harvesting is idempotent. */
  id: string;
  query: string;
  origin_type: OriginType;
  /** How the query was independently obtained or formulated (§19). */
  authoring_mode: string;
  /** Privacy-preserving hash of the local origin reference (§19). Raw text stays private. */
  origin_ref_hash: string;
  /**
   * §19 wants German, English and mixed technical language covered.
   *
   * `neutral` is the fourth value the data forced: most hook queries are
   * keyword chains with no function words at all ("memory format schema json
   * yaml markdown frontmatter structure"). Filing those as `mixed` would put
   * 94% of a harvest into one bucket and make the language balance meaningless.
   * They are language-NEUTRAL, and saying so keeps `mixed` for queries that
   * genuinely carry both.
   */
  lang: "de" | "en" | "mixed" | "neutral";
  /** True when the query carries an exact identifier, path or symbol (§19). */
  has_identifier: boolean;
}

/**
 * Step 2 — the label, added afterwards by someone who may read the vault.
 *
 * Kept as a separate type so a staged query cannot silently become a gold case
 * by acquiring a field.
 */
export interface GoldLabel {
  staged_id: string;
  /** Empty when `no_answer` is true — that IS the expected result. */
  expected_ids: string[];
  /** Ids that would also be a correct answer (§19). */
  acceptable_alternatives: string[];
  expected_zone: Zone;
  no_answer: boolean;
  scope: string | null;
  /** Point in time / version view the case is asked against (§19). */
  time_view: string | null;
  /** How deep the retrieval may go to still count as a hit (§19). */
  allowed_retrieval_depth: number;
  /** Why this label is correct (§19). Free prose, and required. */
  rationale: string;
  kind: CaseKind;
  /** C-036: the answer is to NOT apply an existing memory. */
  correct_answer_is_non_application?: boolean;
  /**
   * Set when the query is a diagnostic or noise probe rather than a question
   * anyone asked. Absent on ordinary cases — see {@link PROBE_GROUPS}.
   */
  probe_group?: ProbeGroup;
  labelled_at: string;
  labelled_by: string;
}

export interface GoldCase extends StagedQuery, Omit<GoldLabel, "staged_id"> {}

export interface GoldIssue {
  where: string;
  problem: string;
}

export function stagedId(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 16);
}

/**
 * Hashes a local origin reference. The raw reference — a transcript path, a log
 * line, a session id — stays on the machine; only this hash travels (§19).
 */
export function originRefHash(reference: string): string {
  return createHash("sha256").update(reference).digest("hex");
}

const DE_MARKERS = /\b(der|die|das|und|nicht|wie|warum|beim|nach|für|mit|von|ist|wird|soll)\b/i;
const EN_MARKERS = /\b(the|and|not|how|why|when|with|from|is|are|should|does)\b/i;

export function detectLang(query: string): StagedQuery["lang"] {
  const de = DE_MARKERS.test(query);
  const en = EN_MARKERS.test(query);
  if (de && en) return "mixed";
  if (de) return "de";
  if (en) return "en";
  // Neither language's function words appear: a technical token chain that is
  // not in a language at all. Guessing here would be the difference between a
  // usable language balance and a single 94% bucket.
  return "neutral";
}

/** An exact identifier, path, symbol or issue reference (§19). */
export function hasIdentifier(query: string): boolean {
  return (
    /[A-Za-z0-9_-]+\.(ts|tsx|js|json|md|swift|py|rs|go|ya?ml)\b/.test(query) ||
    /\b[a-z]+[A-Z][A-Za-z]*\(/.test(query) ||
    /\b[a-z0-9]+([-_][a-z0-9]+){2,}\b/.test(query) ||
    /#\d+/.test(query) ||
    /\b[a-f0-9]{7,40}\b/.test(query) ||
    /packages\//.test(query)
  );
}

export function checkStaged(rows: StagedQuery[]): GoldIssue[] {
  const issues: GoldIssue[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const where = r.id || r.query.slice(0, 40);
    if (!r.query?.trim()) issues.push({ where, problem: "empty query" });
    if (r.id !== stagedId(r.query)) {
      issues.push({ where, problem: "id is not the hash of the query — re-harvesting would duplicate it" });
    }
    if (!ORIGIN_TYPES.includes(r.origin_type)) {
      issues.push({ where, problem: `origin_type \`${r.origin_type}\` is not one of the five §19 sources` });
    }
    if (!r.authoring_mode?.trim()) issues.push({ where, problem: "authoring_mode is mandatory (§19)" });
    if (!/^[a-f0-9]{64}$/.test(r.origin_ref_hash ?? "")) {
      issues.push({ where, problem: "origin_ref_hash must be a sha256 hex digest (§19)" });
    }
    if (seen.has(r.id)) issues.push({ where, problem: "duplicate staged id" });
    seen.add(r.id);
  }
  return issues;
}

export function checkLabels(labels: GoldLabel[], staged: StagedQuery[]): GoldIssue[] {
  const issues: GoldIssue[] = [];
  const stagedIds = new Set(staged.map((s) => s.id));
  for (const l of labels) {
    const where = l.staged_id;
    if (!stagedIds.has(l.staged_id)) {
      issues.push({ where, problem: "label refers to no staged query — the two steps drifted apart" });
    }
    if (!l.rationale?.trim()) {
      issues.push({ where, problem: "rationale is mandatory (§19) — a label nobody can check is not a label" });
    }
    if (l.no_answer && l.expected_ids.length > 0) {
      issues.push({ where, problem: "a no_answer case cannot expect ids" });
    }
    if (!l.no_answer && l.expected_ids.length === 0) {
      issues.push({ where, problem: "expected_ids is empty but no_answer is false — the case grades nothing" });
    }
    if (!ZONES.includes(l.expected_zone)) issues.push({ where, problem: `unknown zone \`${l.expected_zone}\`` });
    if (!CASE_KINDS.includes(l.kind)) issues.push({ where, problem: `unknown kind \`${l.kind}\`` });
    // Absent is the normal case. Present but unknown is a typo, and a typo here
    // silently moves a case out of the main denominator.
    if (l.probe_group !== undefined && !PROBE_GROUPS.includes(l.probe_group)) {
      issues.push({ where, problem: `unknown probe_group \`${l.probe_group}\` — expected one of ${PROBE_GROUPS.join(", ")}` });
    }
    if (!Number.isInteger(l.allowed_retrieval_depth) || l.allowed_retrieval_depth < 1) {
      issues.push({ where, problem: "allowed_retrieval_depth must be a positive integer (§19)" });
    }
    const overlap = l.expected_ids.filter((id) => l.acceptable_alternatives.includes(id));
    if (overlap.length) {
      issues.push({ where, problem: `${overlap.join(", ")} is both expected and merely acceptable` });
    }
  }
  return issues;
}

/**
 * The same two check sets, applied to a FINISHED gold file (#434).
 *
 * A `GoldCase` is a staged query plus its label, so both existing checks apply
 * unchanged — that is the point. The measurement entry point must grade the
 * file rather than trust its creation history (a case can be hand-edited after
 * the authoring pipeline signed it off), and a second rule set written for the
 * runner would drift from the one the authoring step enforces.
 */
export function checkGoldCases(cases: GoldCase[]): GoldIssue[] {
  const labels = cases.map((c) => ({ ...c, staged_id: c.id }));
  return [...checkStaged(cases), ...checkLabels(labels, cases)];
}

/**
 * Coverage §19 demands the set report, so a gap is visible before the run.
 *
 * Every field below counts the MAIN denominator — cases without a
 * `probe_group`. Probes are reported beside it in `probes`/`by_probe_group`,
 * never inside it: a nonsense string does not make the set's no-answer share
 * look healthier, and four runs of one diagnostic do not make it look bigger.
 * On a file written before probe groups existed nothing carries one, so
 * `total` equals `total_with_probes` and every number is what it always was.
 */
export interface GoldCoverage {
  total: number;
  by_origin: Record<string, number>;
  by_lang: Record<string, number>;
  by_kind: Record<string, number>;
  with_identifier: number;
  no_answer: number;
  non_application: number;
  cross_scope: number;
  /** Cases carrying a `probe_group`, excluded from every field above. */
  probes: number;
  by_probe_group: Record<string, number>;
  /** `total + probes` — the raw case count, for reconciling against a file. */
  total_with_probes: number;
}

export function coverage(cases: GoldCase[]): GoldCoverage {
  const bump = (r: Record<string, number>, k: string): void => { r[k] = (r[k] ?? 0) + 1; };
  const out: GoldCoverage = {
    total: 0,
    by_origin: {}, by_lang: {}, by_kind: {},
    with_identifier: 0, no_answer: 0, non_application: 0, cross_scope: 0,
    probes: 0, by_probe_group: {}, total_with_probes: cases.length,
  };
  for (const c of cases) {
    if (c.probe_group) {
      out.probes++;
      bump(out.by_probe_group, c.probe_group);
      continue;
    }
    out.total++;
    bump(out.by_origin, c.origin_type);
    bump(out.by_lang, c.lang);
    bump(out.by_kind, c.kind);
    if (c.has_identifier) out.with_identifier++;
    if (c.no_answer) out.no_answer++;
    if (c.correct_answer_is_non_application) out.non_application++;
    if (c.scope === null) out.cross_scope++;
  }
  return out;
}
