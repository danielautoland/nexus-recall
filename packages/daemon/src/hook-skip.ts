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
import { closeSync, openSync, readSync } from "node:fs";

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

/** #297: the vault's known memory types — a leading frontmatter block whose
 *  `type:` carries one of these marks a memory-shaped .md. Mirrors
 *  core/schema.ts MemoryTypeEnum; kept as a copy because this module must
 *  stay stdlib-only (it runs in the hook client BEFORE @bastra-recall/core
 *  is ever loaded, see the header). */
const MEMORY_TYPE_VALUES = new Set([
  "lesson",
  "preference",
  "project-fact",
  "meta-working",
  "decision",
  "workflow",
  "reference",
  "user-preference",
  "doc",
]);

/** True when `head` opens with a frontmatter block carrying a recognized
 *  memory `type:` — the same recognition Vault's loader applies. */
export function isMemoryShapedMarkdown(head: string | null): boolean {
  if (!head || !head.startsWith("---")) return false;
  const end = head.indexOf("\n---", 3);
  const fm = end === -1 ? head : head.slice(0, end);
  const m = /^type:\s*["']?([\w-]+)["']?\s*$/m.exec(fm);
  return m !== null && MEMORY_TYPE_VALUES.has(m[1]!);
}

/** #297: head of the pending write for the memory-shape check. `Write`
 *  carries the new content inline; `Edit`/`MultiEdit` only carry edit
 *  strings, so the existing file's head is read (2KB, sync — this runs in
 *  a short-lived hook process). Fail-open: unreadable → null. */
export function pendingWriteHead(filePath: string, toolInput?: Record<string, unknown>): string | null {
  const content = toolInput?.content;
  if (typeof content === "string") return content.slice(0, 2048);
  try {
    const fd = openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(2048);
      const n = readSync(fd, buf, 0, buf.length, 0);
      return buf.toString("utf8", 0, n);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Returns `true` if the path should be skipped (no recall round-trip).
 * Returns `false` if the file is plausibly source code worth recalling for.
 *
 * `cwd` is currently informational only — kept in the signature so future
 * refinements (e.g. respect a project-level skip-list) don't have to break
 * the call sites.
 *
 * `toolInput` (#297) feeds the memory-shape exception: a `.md` outside
 * `docs/` normally skips, but a memory-shaped one (recognized `type:` in
 * frontmatter) must reach the daemon — that is the only place the
 * vault-location check can run. Looked at lazily, only on the branch that
 * would otherwise skip.
 */
export function shouldSkipPath(
  filePath: string,
  _cwd?: string,
  toolInput?: Record<string, unknown>,
): boolean {
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
  // #297 exception: a memory-shaped .md never skips, wherever it lives.
  if (ext === ".md") {
    const segments = norm.toLowerCase().split("/");
    const inDocs = segments.includes("docs");
    if (inDocs) return false;
    return !isMemoryShapedMarkdown(pendingWriteHead(filePath, toolInput));
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
  hit: {
    scope: string;
    score: number;
    matched_recall_when?: boolean;
    anchor_strength?: "strong" | "weak";
  },
  project: string | null,
  mustLoadScore: number,
): boolean {
  if (isScopeCompatible(hit.scope, project)) return true;
  // P0: Ein einzelnes häufiges Wort, das zufällig in einer fremden
  // Triggerphrase steht, ist keine Absichtserklärung — dafür verlangt der
  // Bypass jetzt einen TRAGFÄHIGEN Anker (zwei exakte Trigger-Terme oder einen
  // seltenen, siehe `anchorStrength` in core). Fehlt das Feld — ältere Antwort,
  // fremder Aufrufer —, bleibt es beim reinen Flag: Der Filter darf an einem
  // unbekannten Feld nicht strenger werden, als er es vorher war.
  if (hit.anchor_strength !== undefined && hit.anchor_strength !== "strong") return false;
  return hit.matched_recall_when === true && hit.score >= mustLoadScore;
}
