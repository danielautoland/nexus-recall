/**
 * #240/A7, A8, B1, B2 — the served result must be the top-k of the ranking
 * function the code actually defines, in the score space the thresholds assume.
 *
 *  A7: multipliers (lifecycle, curator, doc damping, salience) ran AFTER the
 *      top-k cut, so a fresh hit at k+1 could never displace an expired one
 *      inside the top-k.
 *  A8: the vault/scope filter ran AFTER the provider's global top-k, so scoped
 *      queries silently lost eligible candidates; and vectors of deleted
 *      memories were never pruned.
 *  B1: an empty vector arm still went through RRF, producing a one-armed score
 *      space (rank 1 = 81.967, rank 20 = 62.5) in which the documented
 *      MUST_LOAD band of 100 is unreachable.
 *  B2: the hybrid cache returned before emitting any stage and survived the
 *      vector arm becoming available.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Vault } from "../src/vault.js";
import { SearchIndex } from "../src/search.js";
import { EmbeddingIndex, type EmbeddingProvider } from "../src/embeddings.js";

function memoryMd(
  id: string,
  opts: { updated?: string; type?: string; marker?: string; scope?: string } = {},
): string {
  const marker = opts.marker ?? "ANCHORWORD";
  return `---
id: ${id}
title: ${id} ${marker}
type: ${opts.type ?? "lesson"}
summary: ${marker} summary
topic_path: [t]
tags: [t]
scope: ${opts.scope ?? "t"}
recall_when: ["${marker}"]
created: 2020-01-01
updated: ${opts.updated ?? "2026-07-01"}
---

Body ${marker} ${id}.
`;
}

class StubProvider implements EmbeddingProvider {
  readonly id = "mock";
  readonly dim = 3;
  public failing = false;
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.failing) throw new Error("provider down");
    return texts.map(() => new Float32Array([1, 0, 0]));
  }
}

async function vaultWith(
  t: { after: (fn: () => unknown) => void },
  files: Record<string, string>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-ranking-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content, "utf8");
  }
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  t.after(async () => {
    search.stop();
    await vault.stop?.();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, vault, search };
}

test("A7: k=1 returns the true top-1 after lifecycle damping, not before", async (t) => {
  // Two equally-matching notes: one scores higher raw but is long expired
  // (multiplier 0.2), the other is fresh. With the cut before the multiplier,
  // k=1 served the expired one.
  const { search } = await vaultWith(t, {
    "expired.md": memoryMd("expired-hi", { updated: "2020-01-01", marker: "ANCHORWORD ANCHORWORD" }),
    "fresh.md": memoryMd("fresh-lo", { updated: "2026-07-01", marker: "ANCHORWORD" }),
  });

  const top10 = search.recall("ANCHORWORD", { k: 10 });
  const trueTop = top10[0].id;

  const top1 = search.recall("ANCHORWORD", { k: 1 });
  assert.equal(top1.length, 1);
  assert.equal(
    top1[0].id,
    trueTop,
    `k=1 must serve the same winner as k=10 (got ${top1[0].id}, true top ${trueTop})`,
  );
  assert.equal(trueTop, "fresh-lo", "the fresh note must win once damping is applied");
});

test("A7: doc damping is applied before the cut too", async (t) => {
  const { search } = await vaultWith(t, {
    "doc.md": memoryMd("doc-hi", { type: "doc", marker: "ANCHORWORD ANCHORWORD" }),
    "lesson.md": memoryMd("lesson-lo", { marker: "ANCHORWORD" }),
  });

  const trueTop = search.recall("ANCHORWORD", { k: 10 })[0].id;
  assert.equal(search.recall("ANCHORWORD", { k: 1 })[0].id, trueTop);
});

test("B1: an empty vector arm returns real BM25 scores, not one-armed RRF", async (t) => {
  const { dir, vault, search } = await vaultWith(t, {
    "a.md": memoryMd("note-a", { marker: "ANCHORWORD" }),
    "b.md": memoryMd("note-b", { marker: "ANCHORWORD" }),
  });

  const provider = new StubProvider();
  const emb = new EmbeddingIndex(vault, provider, path.join(dir, ".bastra", "embeddings.json"));
  await emb.start();
  search.useEmbeddings(emb);

  const pureBm25 = search.recall("ANCHORWORD", { k: 5 });
  provider.failing = true;
  const degraded = await search.recallHybrid("ANCHORWORD", { k: 5 });

  assert.equal(degraded[0].id, pureBm25[0].id);
  assert.equal(
    degraded[0].score,
    pureBm25[0].score,
    "a degraded recall must live in the BM25 score space the thresholds assume",
  );
  assert.equal(degraded[0].mode, "bm25");
  // The one-armed RRF ceiling was 5000/61 — anything at or below that for a
  // rank-1 hit means we are back in the broken space.
  assert.notEqual(Math.round(degraded[0].score * 1000), Math.round(81.967 * 1000));
});

test("B2: a hybrid cache hit still emits stages and the candidate pool", async (t) => {
  const { dir, vault, search } = await vaultWith(t, {
    "a.md": memoryMd("note-a", { marker: "ANCHORWORD" }),
  });
  const emb = new EmbeddingIndex(vault, new StubProvider(), path.join(dir, ".bastra", "e.json"));
  await emb.start();
  search.useEmbeddings(emb);

  await search.recallHybrid("ANCHORWORD", { k: 5 });

  const stages: string[] = [];
  let poolCalls = 0;
  await search.recallHybrid("ANCHORWORD", {
    k: 5,
    onStage: (s) => stages.push(s.name),
    onCandidatePool: () => {
      poolCalls++;
    },
  });

  assert.ok(stages.includes("cache.hit"), `cache.hit missing, saw ${JSON.stringify(stages)}`);
  assert.ok(stages.includes("done"), "done missing on a cache hit");
  assert.equal(poolCalls, 1, "the candidate pool must still reach the harvester");
});

test("B2: a result cached while the vector arm was empty does not survive recovery", async (t) => {
  const { dir, vault, search } = await vaultWith(t, {
    "a.md": memoryMd("note-a", { marker: "ANCHORWORD" }),
  });
  const provider = new StubProvider();
  provider.failing = true;
  const emb = new EmbeddingIndex(vault, provider, path.join(dir, ".bastra", "e.json"));
  await emb.start();
  search.useEmbeddings(emb);

  const degraded = await search.recallHybrid("ANCHORWORD", { k: 5 });
  assert.equal(degraded[0].mode, "bm25");

  // Provider recovers and the backfill lands — the same query must not keep
  // serving the degraded result for the rest of the cache TTL.
  provider.failing = false;
  await emb.embedMissing?.();
  await emb.flushQueue?.();

  const recovered = await search.recallHybrid("ANCHORWORD", { k: 5 });
  assert.equal(recovered[0].mode, "hybrid", "recovery must invalidate the degraded cache entry");
});

test("A8: orphan vectors are pruned at start", async (t) => {
  const { dir, vault } = await vaultWith(t, { "a.md": memoryMd("note-a") });

  const persistPath = path.join(dir, ".bastra", "embeddings.json");
  const emb1 = new EmbeddingIndex(vault, new StubProvider(), persistPath);
  await emb1.start();
  await emb1.flushQueue?.();
  emb1.stop();

  // A memory deleted while the daemon was down: the file is gone, but its
  // vector is still in the persisted index.
  await rm(path.join(dir, "a.md"));
  const vault2 = new Vault(dir);
  await vault2.init();
  const emb2 = new EmbeddingIndex(vault2, new StubProvider(), persistPath);
  await emb2.start();
  t.after(() => emb2.stop());

  assert.equal(emb2.size(), 0, "a vector without a memory must not survive start()");
  assert.equal(emb2.findSimilarById("note-a"), null);
});

test("A8: a scoped query is not truncated by the global vector cut", async (t) => {
  // One tiny scope drowned in a large one: with the filter running after a
  // fixed global top-k, the small scope loses candidates it should keep.
  const files: Record<string, string> = {};
  for (let i = 0; i < 150; i++) {
    files[`big-${i}.md`] = memoryMd(`big-${i}`, { scope: "big" });
  }
  for (let i = 0; i < 5; i++) {
    files[`small-${i}.md`] = memoryMd(`small-${i}`, { scope: "small" });
  }
  const { dir, vault, search } = await vaultWith(t, files);

  const emb = new EmbeddingIndex(vault, new StubProvider(), path.join(dir, ".bastra", "e.json"));
  await emb.start();
  await emb.flushQueue?.();
  search.useEmbeddings(emb);
  t.after(() => emb.stop());

  const hits = await search.recallHybrid("ANCHORWORD", { k: 5, scope: "small" });
  assert.equal(hits.length, 5, `expected all 5 in-scope memories, got ${hits.length}`);
  assert.ok(hits.every((h) => h.id.startsWith("small-")));
});
