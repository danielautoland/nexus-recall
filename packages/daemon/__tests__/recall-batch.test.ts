/**
 * Tests for #351 — recall batch mode: queries[] runs each phrasing through
 * the full single pipeline and merges by best original score.
 *
 * Run: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/recall-batch.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { Telemetry } from "../src/telemetry.js";
import { recallHandler, RecallArgs, type ToolDeps } from "../src/tool-handlers.js";
import { mergeBatchResults } from "../src/recall-batch.js";

function memoryMd(id: string, title: string, trigger: string): string {
  const ts = new Date().toISOString();
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "type: lesson",
    `summary: ${title}`,
    "topic_path:",
    "  - test",
    "tags:",
    "  - test",
    "scope: personal",
    "recall_when:",
    `  - ${trigger}`,
    `created: ${ts}`,
    `updated: ${ts}`,
    "---",
    "",
    `${title} body.`,
    "",
  ].join("\n");
}

test("recallHandler (#351): queries[] merges per-phrasing results, deduped by best score", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-batch-"));
  try {
    await writeFile(join(dir, "a.md"), memoryMd("panel-lesson", "NSPanel resignKey dismissal", "panel closes on resignKey observer"), "utf8");
    await writeFile(join(dir, "b.md"), memoryMd("scroll-lesson", "NSScrollView trailing inset", "scrollview trailing inset macos"), "utf8");
    const vault = new Vault(dir);
    await vault.init();
    const search = new SearchIndex(vault);
    search.start();
    const deps = { vault, search, telemetry: new Telemetry(), vaultPath: dir } as ToolDeps;

    const single = await recallHandler(deps, { query: "panel resignKey observer", min_score: 0 });
    assert.ok(single.hits.length > 0, "single-query path still works");

    const batched = await recallHandler(deps, {
      queries: ["panel resignKey observer", "scrollview trailing inset"],
      min_score: 0,
    });
    const ids = (batched.hits as { id: string }[]).map((h) => h.id);
    assert.ok(ids.includes("panel-lesson"), "first phrasing's hit present");
    assert.ok(ids.includes("scroll-lesson"), "second phrasing's hit present");
    assert.equal(new Set(ids).size, ids.length, "no duplicate ids after merge");
    assert.equal((batched as { query_count?: number }).query_count, 2);
    assert.ok(Array.isArray((batched as { recall_ids?: string[] }).recall_ids), "per-query recall_ids exposed");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("RecallArgs (#351): query XOR queries", () => {
  assert.equal(RecallArgs.safeParse({ queries: ["a phrase", "b phrase"] }).success, true);
  assert.equal(RecallArgs.safeParse({ queries: ["only one"] }).success, false, "min 2 phrasings");
  assert.equal(RecallArgs.safeParse({}).success, true, "schema allows absence — handler enforces presence");
});

test("mergeBatchResults: best score wins, weak_result only when ALL sub-results are weak", () => {
  const merged = mergeBatchResults(
    ["q1", "q2"],
    [
      { hits: [{ id: "x", score: 50 }], recall_id: "r1", weak_result: true },
      { hits: [{ id: "x", score: 120 }, { id: "y", score: 40 }], recall_id: "r2" },
    ],
    5,
  );
  assert.equal(merged.hits[0]!.id, "x");
  assert.equal(merged.hits[0]!.score, 120, "best original score kept — no re-fusion");
  assert.equal(merged.weak_result, undefined, "one anchored phrasing clears the batch");
  assert.deepEqual(merged.recall_ids, ["r1", "r2"]);

  const allWeak = mergeBatchResults(["q1", "q2"], [{ hits: [], weak_result: true, no_home: true }, { hits: [], weak_result: true, no_home: true }], 5);
  assert.equal(allWeak.weak_result, true);
  assert.equal(allWeak.no_home, true);
});
