/**
 * Tests for the #121 candidate-pool callback: recall exposes the DEEPER pool
 * (below the returned top-k) via opts.onCandidatePool, so the far slice — relevant
 * memories that ranked below k — is observable for offline bridge harvesting.
 *
 * Runner: node --import tsx --test packages/core/__tests__/recall-candidate-pool.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex, type RecallHit } from "../src/index.js";

function memo(id: string, title: string): string {
  const ts = new Date().toISOString();
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "type: reference",
    `summary: ${title}`,
    "topic_path:",
    "  - test",
    "tags:",
    "  - test",
    "scope: test-scope",
    "recall_when:",
    `  - ${title}`,
    `created: ${ts}`,
    `updated: ${ts}`,
    "---",
    "",
    `Body about ${title}.`,
    "",
  ].join("\n");
}

async function makeIndex(n: number): Promise<{ idx: SearchIndex; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-pool-test-"));
  // All memories share the term "alpha" so they all match; titles differ so they rank.
  for (let i = 0; i < n; i++) {
    await writeFile(join(dir, `m${i}.md`), memo(`m${i}`, `alpha topic ${i}`), "utf8");
  }
  const vault = new Vault(dir);
  await vault.init();
  const idx = new SearchIndex(vault);
  idx.start();
  return { idx, dir };
}

test("recall exposes a deeper candidate pool than the returned top-k", async () => {
  const { idx, dir } = await makeIndex(8);
  try {
    let pool: RecallHit[] = [];
    const hits = idx.recall("alpha", { k: 2, onCandidatePool: (p) => (pool = p) });
    assert.equal(hits.length, 2, "returns the requested top-k");
    assert.ok(pool.length > hits.length, `pool (${pool.length}) must be deeper than k (${hits.length})`);
    assert.equal(pool.length, 8, "pool reaches all 8 below-k candidates (HOP_SEED_POOL = max(k*4, 20))");
    // The returned hits are the head of the pool (same ids, same order).
    assert.deepEqual(hits.map((h) => h.id), pool.slice(0, 2).map((h) => h.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("onCandidatePool is null-overhead when unset (recall still works)", async () => {
  const { idx, dir } = await makeIndex(3);
  try {
    const hits = idx.recall("alpha", { k: 2 });
    assert.equal(hits.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
