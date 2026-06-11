import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Vault } from "../src/vault.js";
import { EmbeddingIndex, type EmbeddingProvider } from "../src/embeddings.js";

function memoryMd(id: string): string {
  return `---
id: ${id}
title: ${id}
type: lesson
summary: s
topic_path: [t]
tags: [t]
scope: t
recall_when: ["w"]
created: 2026-05-01
updated: 2026-05-01
---

body ${id}
`;
}

/** Provider that can be flipped into failure mode mid-run — simulates the
 *  #92 scenario: model deleted / Ollama server died AFTER daemon boot. */
class FlakyProvider implements EmbeddingProvider {
  readonly id = "mock-flaky";
  readonly dim = 4;
  public failing = false;

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.failing) throw new Error("Ollama embed HTTP 404: model not found");
    return texts.map((_, i) => new Float32Array([1, 0, 0, i]));
  }
}

test("runtimeHealth (#92): ok after success, degraded after provider failure, recovers on next success", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-embed-health-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "m1.md"), memoryMd("m1"));
    const vault = new Vault(dir);
    await vault.init();

    const provider = new FlakyProvider();
    const idx = new EmbeddingIndex(vault, provider, path.join(dir, ".bastra", "embeddings.json"));
    await idx.start();
    const deadline = Date.now() + 5_000;
    while (idx.size() < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(idx.size(), 1, "backfill should embed the memory");

    // 1. healthy after a successful batch
    let h = idx.runtimeHealth();
    assert.equal(h.ok, true);
    assert.equal(h.lastError, null);
    assert.ok(h.lastOkAt !== null, "lastOkAt should be stamped");

    // 2. provider dies at runtime → search degrades to [] AND health flips
    provider.failing = true;
    const hits = await idx.search("anything");
    assert.deepEqual(hits, [], "search swallows the error and returns []");
    h = idx.runtimeHealth();
    assert.equal(h.ok, false, "health must report degraded after a failed call");
    assert.match(h.lastError ?? "", /model not found/);
    assert.ok(h.lastErrorAt !== null);

    // 3. provider recovers → next successful call clears the error
    provider.failing = false;
    await idx.search("anything");
    h = idx.runtimeHealth();
    assert.equal(h.ok, true, "health must recover on the next successful call");
    assert.equal(h.lastError, null);

    idx.stop();
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
