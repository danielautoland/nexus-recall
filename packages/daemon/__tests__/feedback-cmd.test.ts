/**
 * Tests für `bastra feedback` (#17 Onboarding): Prefill-URL-Bau und die
 * No-Paths/No-Content-Garantie des Diagnose-Blocks.
 *
 * Runner: `tsx --test __tests__/feedback-cmd.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedbackUrl, formatDiagnostics, type DiagnosticsParts } from "../src/cli/feedback-cmd.js";

const parts: DiagnosticsParts = {
  version: "0.8.0",
  os: "darwin 25.5.0 (arm64)",
  node: "v24.16.0",
  embedding: "ollama-embeddinggemma",
  vaultSize: "472",
  daemon: "ok (v0.8.0)",
};

test("formatDiagnostics: exactly the six sanitized fields, no paths, no content", () => {
  const block = formatDiagnostics(parts);
  assert.equal(block.split("\n").length, 6, "fixed shape — nothing sneaks in");
  for (const key of ["version:", "os:", "node:", "embedding:", "vault_size:", "daemon:"]) {
    assert.ok(block.includes(key), `missing ${key}`);
  }
  assert.ok(!/\/Users\/|\/home\/|[A-Z]:\\/.test(block), "never a filesystem path");
});

test("buildFeedbackUrl: bug prefills the issue-form field ids, idea stays plain", () => {
  const bug = new URL(buildFeedbackUrl("bug", parts));
  assert.equal(bug.pathname, "/n0mad-ai/bastra-recall/issues/new");
  assert.equal(bug.searchParams.get("template"), "bug_report.yml");
  assert.equal(bug.searchParams.get("bastra-version"), "0.8.0");
  assert.equal(bug.searchParams.get("os"), "darwin 25.5.0 (arm64)");
  assert.equal(bug.searchParams.get("node"), "v24.16.0");
  assert.match(bug.searchParams.get("doctor-output") ?? "", /vault_size: 472/);

  const idea = new URL(buildFeedbackUrl("idea"));
  assert.equal(idea.searchParams.get("template"), "feature_request.yml");
  assert.equal([...idea.searchParams.keys()].length, 1, "idea form carries no diagnostics");
});
