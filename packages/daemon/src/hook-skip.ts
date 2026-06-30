/**
 * hook-skip — fast path/extension filter for the PreToolUse hook.
 *
 * Goal: cheaply decide "is this Write/Edit even worth a recall round-trip?"
 * BEFORE we load `@bastra-recall/core` or hit the daemon. Pure stdlib, no
 * deps — kept in its own module so hook.ts can stay tight and so the
 * matrix is unit-testable in isolation.
 *
 * Heuristic (see issue #20):
 *   - Skip extensions: .txt, .rst, .log, .tmp, .cache, .lock — never source.
 *   - Skip .md OUTSIDE of any `docs/` segment. Docs writes can legitimately
 *     benefit from prior context, everything else (issue bodies, scratch
 *     notes, plan files) is transient.
 *   - Skip transient basenames: issue-*, pr-*, CHANGELOG*, README*,
 *     CONTRIBUTING*, LICENSE*, .env*.
 */
import * as path from "node:path";

const SKIP_EXTENSIONS = new Set<string>([
  ".txt",
  ".rst",
  ".log",
  ".tmp",
  ".cache",
  ".lock",
]);

const SKIP_BASENAME_PATTERNS: RegExp[] = [
  /^issue-/i,
  /^pr-/i,
  /^CHANGELOG/i,
  /^README/i,
  /^CONTRIBUTING/i,
  /^LICENSE/i,
  /^\.env/,
];

/**
 * Returns `true` if the path should be skipped (no recall round-trip).
 * Returns `false` if the file is plausibly source code worth recalling for.
 *
 * `cwd` is currently informational only — kept in the signature so future
 * refinements (e.g. respect a project-level skip-list) don't have to break
 * the call sites.
 */
export function shouldSkipPath(filePath: string, _cwd?: string): boolean {
  if (!filePath) return true;
  const norm = filePath.replace(/\\/g, "/");
  const ext = path.extname(norm).toLowerCase();
  const base = path.basename(norm);

  // Hard-skip basenames — transient or non-code regardless of extension.
  for (const rx of SKIP_BASENAME_PATTERNS) {
    if (rx.test(base)) return true;
  }

  // Hard-skip extensions.
  if (SKIP_EXTENSIONS.has(ext)) return true;

  // .md is conditional: keep ACTIVE if anywhere in the path is a `docs/`
  // segment (case-insensitive). Otherwise skip — issue bodies, ad-hoc
  // plans, scratch notes don't benefit from a project-wide recall.
  if (ext === ".md") {
    const segments = norm.toLowerCase().split("/");
    const inDocs = segments.includes("docs");
    return !inDocs;
  }

  return false;
}

/** Scopes, die in JEDEM Projekt-Kontext relevant sein können. "commons" =
 *  Bastra-Commons-Rezepte (projektunabhängiges Lösungswissen). */
const GLOBAL_SCOPES = new Set(["all-projects", "user-preference", "taxonomy", "commons"]);

/**
 * Scope-Hard-Filter für Recall-Hints (#107, #110): bei erkanntem Projekt
 * fliegen Hints aus FREMDEN Projekt-Scopes raus (z.B. bastra-io-CSS-Hints
 * bei einem bastra-recall-Daemon-Edit) statt nur schlechter zu ranken —
 * seit #110 in ALLEN Score-Bändern (auch REQUIRED; ein Score ≥100 aus einem
 * fremden Projekt ist trotzdem Noise, live belegt mit 159). Kompatibel sind
 * der Projekt-Scope selbst, globale Scopes und die Scope-Familie über ein
 * Präfix-Verhältnis ("bastra" deckt "bastra-recall", nicht aber "bastra-io"
 * vs "bastra-recall").
 */
export function isScopeCompatible(scope: string, project: string | null): boolean {
  if (!project || !scope) return true;
  if (GLOBAL_SCOPES.has(scope)) return true;
  if (scope === project) return true;
  return project.startsWith(scope + "-") || scope.startsWith(project + "-");
}

/**
 * Scope-Filter-Entscheidung pro Hint (#148): lässt einen starken, ABSICHTLICHEN
 * Cross-Scope-Hit durch die #110-Hard-Filter, ohne den tag/topic-Noise-Fall
 * wieder zu öffnen.
 *
 * Kompatible Scopes passieren immer (`isScopeCompatible`). Ein FREMDER
 * Projekt-Scope passiert nur, wenn beides gilt:
 *   - der Hit matchte auf seinem HAND-geschriebenen `recall_when`
 *     (`matched_recall_when` — deliberate Cross-Project-Relevanz, nicht bloß
 *     thematische tag/topic-Überlappung), UND
 *   - er sitzt im REQUIRED-Band (`score ≥ mustLoadScore`).
 *
 * Warum nicht Score allein: der ursprüngliche #107-Bypass ließ jeden Hit mit
 * `score ≥ 100` durch, in der Annahme „hoher Score ≈ starker recall_when-Match".
 * Das wurde am Einführungstag widerlegt (#110) — ein bastra-io-Hint kam mit
 * Score 159 über reinen tag/topic-Overlap durch. Das echte
 * `matched_recall_when`-Signal trennt die beiden Fälle: der 159er-Noise-Hit
 * hätte es nie gesetzt, der absichtliche Cross-Scope-Treffer schon.
 */
export function passesScopeFilter(
  hit: { scope: string; score: number; matched_recall_when?: boolean },
  project: string | null,
  mustLoadScore: number,
): boolean {
  if (isScopeCompatible(hit.scope, project)) return true;
  return hit.matched_recall_when === true && hit.score >= mustLoadScore;
}
