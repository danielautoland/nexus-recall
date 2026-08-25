/**
 * Unit tests for hook-skip.ts (#20).
 *
 * The skip-matrix is the contract from issue #20: which paths the hook
 * must short-circuit on BEFORE loading core. Run with:
 *   npx tsx --test packages/daemon/__tests__/hook-skip.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { shouldSkipPath, isScopeCompatible, passesScopeFilter } from "../src/hook-skip.js";

interface MatrixRow {
  path: string;
  expected: boolean;
  why: string;
}

const MATRIX: MatrixRow[] = [
  // ── Source code → MUST NOT skip ───────────────────────────────
  { path: "src/foo.ts", expected: false, why: ".ts is source" },
  { path: "src/foo.tsx", expected: false, why: ".tsx is source" },
  { path: "/abs/path/foo.swift", expected: false, why: ".swift is source" },
  { path: "lib/bar.py", expected: false, why: ".py is source" },
  { path: "main.go", expected: false, why: ".go is source" },
  { path: "src/style.css", expected: false, why: ".css is source" },
  { path: "Cargo.toml", expected: false, why: ".toml config is source-ish" },

  // ── Markdown rules ────────────────────────────────────────────
  { path: "issue-1.md", expected: true, why: "issue- prefix is transient" },
  { path: "/repo/issue-2.md", expected: true, why: "issue- prefix is transient (abs)" },
  { path: "PLAN.md", expected: true, why: ".md outside docs/ skipped" },
  { path: "notes/random.md", expected: true, why: ".md outside docs/ skipped" },
  { path: "docs/architecture.md", expected: false, why: ".md inside docs/ kept" },
  { path: "docs/guides/onboarding.md", expected: false, why: "nested .md inside docs/ kept" },
  { path: "/repo/packages/foo/docs/x.md", expected: false, why: "docs/ anywhere in path keeps .md active" },
  { path: "/repo/Docs/style.md", expected: false, why: "case-insensitive docs/ match" },

  // ── Transient basenames ───────────────────────────────────────
  { path: "pr-123.md", expected: true, why: "pr- prefix" },
  { path: "CHANGELOG.md", expected: true, why: "CHANGELOG always skip" },
  { path: "docs/CHANGELOG.md", expected: true, why: "CHANGELOG even in docs/" },
  { path: "README.md", expected: true, why: "README always skip" },
  { path: "CONTRIBUTING.md", expected: true, why: "CONTRIBUTING always skip" },
  { path: "LICENSE", expected: true, why: "LICENSE basename" },
  { path: ".env", expected: true, why: ".env hidden file" },
  { path: ".env.local", expected: true, why: ".env.* hidden file" },

  // ── Hard-skip extensions ──────────────────────────────────────
  { path: "scratch.txt", expected: true, why: ".txt always skip" },
  { path: "deploy.log", expected: true, why: ".log always skip" },
  { path: "tmp.tmp", expected: true, why: ".tmp always skip" },
  { path: "build.cache", expected: true, why: ".cache always skip" },
  { path: "package-lock.lock", expected: true, why: ".lock always skip" },
  { path: "docs/intro.rst", expected: true, why: ".rst always skip" },

  // ── Defensive edge cases ──────────────────────────────────────
  { path: "", expected: true, why: "empty path → skip" },
  { path: "C:\\Windows\\path\\src\\foo.ts", expected: false, why: "windows separators normalized → .ts source" },
  { path: "C:\\Windows\\path\\docs\\x.md", expected: false, why: "windows-normalized .md in docs/" },
  { path: "C:\\Windows\\path\\notes\\x.md", expected: true, why: "windows-normalized .md outside docs/" },
];

test("shouldSkipPath: skip-matrix from issue #20", () => {
  for (const row of MATRIX) {
    const actual = shouldSkipPath(row.path);
    assert.equal(
      actual,
      row.expected,
      `path=${JSON.stringify(row.path)} expected=${row.expected} actual=${actual} (${row.why})`,
    );
  }
});

test("shouldSkipPath: cwd parameter is accepted but currently informational", () => {
  // Future-proofing — we don't want a regression where cwd changes behavior.
  assert.equal(shouldSkipPath("src/foo.ts", "/some/cwd"), false);
  assert.equal(shouldSkipPath("issue-1.md", "/some/cwd"), true);
});

// #297: a memory-shaped .md never skips, wherever it lives — the write must
// reach the daemon so the vault-location check can run there.
test("shouldSkipPath (#297): memory-shaped .md outside docs/ is NOT skipped", () => {
  const memoryContent = "---\nid: x\ntitle: X\ntype: lesson\n---\n\nBody.\n";
  // Write carries the content inline via tool_input
  assert.equal(shouldSkipPath("/tmp/some/notes/x.md", undefined, { content: memoryContent }), false);
  // quoted type value counts too
  assert.equal(shouldSkipPath("/tmp/x.md", undefined, { content: '---\ntype: "decision"\n---\n' }), false);
  // plain .md without memory frontmatter keeps skipping
  assert.equal(shouldSkipPath("/tmp/plan.md", undefined, { content: "# Plan\n- step 1\n" }), true);
  // unknown type value is not memory-shaped
  assert.equal(shouldSkipPath("/tmp/x.md", undefined, { content: "---\ntype: banana\n---\n" }), true);
  // Edit on a nonexistent file (no inline content, unreadable head) → fail-open skip
  assert.equal(shouldSkipPath("/nonexistent/dir/x.md", undefined, { old_string: "a", new_string: "b" }), true);
});

test("isScopeCompatible (#107): foreign project scopes are filtered, family/global scopes pass", () => {
  // Das beobachtete Problem: bastra-io-Hint bei einem bastra-recall-Edit.
  assert.equal(isScopeCompatible("bastra-io", "bastra-recall"), false);
  assert.equal(isScopeCompatible("carnexus", "bastra-recall"), false);
  // Eigener Scope + Scope-Familie über Präfix.
  assert.equal(isScopeCompatible("bastra-recall", "bastra-recall"), true);
  assert.equal(isScopeCompatible("bastra", "bastra-recall"), true);
  assert.equal(isScopeCompatible("bastra-recall", "bastra"), true);
  // Globale Scopes immer.
  assert.equal(isScopeCompatible("all-projects", "bastra-recall"), true);
  assert.equal(isScopeCompatible("user-preference", "bastra-recall"), true);
  assert.equal(isScopeCompatible("taxonomy", "bastra-recall"), true);
  // Ohne erkanntes Projekt oder ohne Scope: kein Filter.
  assert.equal(isScopeCompatible("bastra-io", null), true);
  assert.equal(isScopeCompatible("", "bastra-recall"), true);
});

test("passesScopeFilter (#148): strong, deliberate cross-scope hits pass; tag/topic noise stays filtered", () => {
  const MUST_LOAD = 100;
  const p = "bastra-recall";

  // Compatible scopes always pass, regardless of recall_when / score.
  assert.equal(passesScopeFilter({ scope: "bastra-recall", score: 40 }, p, MUST_LOAD), true);
  assert.equal(passesScopeFilter({ scope: "all-projects", score: 40 }, p, MUST_LOAD), true);
  assert.equal(passesScopeFilter({ scope: "bastra", score: 40 }, p, MUST_LOAD), true);

  // ── The #148 case: a foreign-scope hit that matched its hand-written
  //    recall_when in the REQUIRED band IS deliberate cross-project relevance.
  assert.equal(
    passesScopeFilter({ scope: "bastra-io", score: 150, matched_recall_when: true }, p, MUST_LOAD),
    true,
    "foreign scope + recall_when match + REQUIRED band → passes (the Discord #dev case)",
  );

  // ── The #110 noise case MUST stay filtered: a foreign-scope hit that scored
  //    high on tag/topic overlap WITHOUT a recall_when match (the bastra-io
  //    hit at 159 that disproved the original score-only bypass).
  assert.equal(
    passesScopeFilter({ scope: "bastra-io", score: 159, matched_recall_when: false }, p, MUST_LOAD),
    false,
    "foreign scope, high score, but no recall_when match → still filtered (#110)",
  );
  assert.equal(
    passesScopeFilter({ scope: "bastra-io", score: 159 }, p, MUST_LOAD),
    false,
    "missing matched_recall_when is treated as no-match → filtered",
  );

  // ── A recall_when match BELOW the REQUIRED band does not pass — deliberate
  //    but weak is still curation noise for a foreign project.
  assert.equal(
    passesScopeFilter({ scope: "bastra-io", score: 80, matched_recall_when: true }, p, MUST_LOAD),
    false,
    "recall_when match but below REQUIRED band → filtered",
  );
});

test("passesScopeFilter (P0): a weak anchor no longer buys a cross-scope pass", () => {
  const MUST_LOAD = 100;
  const p = "bastra-recall";
  const foreign = { scope: "some-other-project", score: 150, matched_recall_when: true };

  // Vor P0 reichte das Flag allein. Ein einzelnes häufiges Wort, das zufällig
  // in der Triggerphrase eines fremden Projekts steht, ist aber keine Absicht —
  // und der Bypass ist genau die Stelle, an der das teuer wird.
  assert.equal(
    passesScopeFilter({ ...foreign, anchor_strength: "weak" }, p, MUST_LOAD),
    false,
    "one common trigger term must not open a foreign scope",
  );
  assert.equal(
    passesScopeFilter({ ...foreign, anchor_strength: "strong" }, p, MUST_LOAD),
    true,
    "a rare identifier or two authored terms still pass — the #148 case is intact",
  );

  // Rückwärtskompatibilität: Eine Antwort ohne das Feld (älterer Daemon,
  // fremder Aufrufer) darf nicht STRENGER behandelt werden als vorher —
  // sonst verschwinden absichtliche Cross-Scope-Hits still.
  assert.equal(
    passesScopeFilter(foreign, p, MUST_LOAD),
    true,
    "an absent field keeps the pre-P0 behaviour",
  );

  // Und die Score-Bedingung bleibt eine UND-Bedingung.
  assert.equal(
    passesScopeFilter({ ...foreign, score: 40, anchor_strength: "strong" }, p, MUST_LOAD),
    false,
    "a strong anchor below the REQUIRED band still does not pass",
  );
});
