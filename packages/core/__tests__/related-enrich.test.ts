import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Vault } from "../src/vault.js";
import type { EmbeddingIndex } from "../src/embeddings.js";
import { RelatedEnricher } from "../src/related-enrich.js";

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

/** Stub-Index: liefert für jede id dieselben, von außen mutierbaren Hits. */
function stubEmbeddings(hits: { id: string; score: number }[]) {
  const stub = {
    current: hits,
    findSimilarById(_id: string, _k: number) {
      return this.current;
    },
    onEmbed(_l: (id: string) => void) {
      return () => {};
    },
  };
  return { stub, index: stub as unknown as EmbeddingIndex };
}

async function vaultWith(ids: string[]): Promise<{ dir: string; vault: Vault }> {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-related-"));
  for (const id of ids) {
    await writeFile(path.join(dir, `${id}.md`), memoryMd(id));
  }
  const vault = new Vault(dir);
  await vault.init();
  return { dir, vault };
}

test("enrich schreibt Section + frontmatter, atomar ohne tmp-Leiche", async () => {
  const { dir, vault } = await vaultWith(["a", "b"]);
  try {
    const { index } = stubEmbeddings([{ id: "b", score: 0.85 }]);
    const enricher = new RelatedEnricher(vault, index);

    const written = await enricher.enrich("a");
    assert.ok(written);
    assert.equal(written.length, 1);

    const raw = await readFile(path.join(dir, "a.md"), "utf8");
    assert.match(raw, /- \[\[b\]\] \(cosine 0\.85\)/);
    assert.match(raw, /related_via:/);

    const leftovers = (await readdir(dir)).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("Cosine-Drift ≤ ε ist no-op — kein Write-Ping-Pong zwischen Prozessen", async () => {
  const { dir, vault } = await vaultWith(["a", "b"]);
  try {
    const { stub, index } = stubEmbeddings([{ id: "b", score: 0.804 }]);
    const enricher = new RelatedEnricher(vault, index);
    await enricher.enrich("a");
    const before = await readFile(path.join(dir, "a.md"), "utf8");
    assert.match(before, /\(cosine 0\.80\)/);

    // Zweiter Prozess sieht 0.806 → toFixed(2) kippt auf "0.81". Exakter
    // Vergleich würde rewriten; tolerant ist es äquivalent.
    stub.current = [{ id: "b", score: 0.806 }];
    const result = await enricher.enrich("a");
    assert.equal(result, null);
    assert.equal(await readFile(path.join(dir, "a.md"), "utf8"), before);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("Cosine-Drift > ε schreibt neu (echte Score-Änderung)", async () => {
  const { dir, vault } = await vaultWith(["a", "b"]);
  try {
    const { stub, index } = stubEmbeddings([{ id: "b", score: 0.8 }]);
    const enricher = new RelatedEnricher(vault, index);
    await enricher.enrich("a");

    stub.current = [{ id: "b", score: 0.9 }];
    const result = await enricher.enrich("a");
    assert.ok(result);
    const raw = await readFile(path.join(dir, "a.md"), "utf8");
    assert.match(raw, /\(cosine 0\.90\)/);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("writeGate=false unterdrückt den Write (Single-Writer)", async () => {
  const { dir, vault } = await vaultWith(["a", "b"]);
  try {
    const { index } = stubEmbeddings([{ id: "b", score: 0.85 }]);
    const enricher = new RelatedEnricher(vault, index, {
      writeGate: () => false,
    });
    const before = await readFile(path.join(dir, "a.md"), "utf8");

    const result = await enricher.enrich("a");
    assert.equal(result, null);
    assert.equal(await readFile(path.join(dir, "a.md"), "utf8"), before);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("Hysterese: bestehender Link überlebt bis threshold−ε, neuer braucht threshold", async () => {
  const { dir, vault } = await vaultWith(["a", "b", "c"]);
  try {
    const { stub, index } = stubEmbeddings([{ id: "b", score: 0.71 }]);
    const enricher = new RelatedEnricher(vault, index); // threshold 0.7
    await enricher.enrich("a");
    assert.match(await readFile(path.join(dir, "a.md"), "utf8"), /\[\[b\]\]/);

    // b rutscht knapp unter die Schwelle (0.695 ≥ 0.7−0.02 → bleibt),
    // c steht gleich hoch, war aber nie verlinkt → kommt nicht rein.
    stub.current = [
      { id: "b", score: 0.695 },
      { id: "c", score: 0.695 },
    ];
    await enricher.enrich("a");
    const raw = await readFile(path.join(dir, "a.md"), "utf8");
    assert.match(raw, /\[\[b\]\]/);
    assert.doesNotMatch(raw, /\[\[c\]\]/);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

/** Stub whose onEmbed hands the listener back, so a test can fire it. */
function firableEmbeddings(hits: { id: string; score: number }[]) {
  let listener: ((id: string) => void) | null = null;
  const stub = {
    findSimilarById(_id: string, _k: number) {
      return hits;
    },
    onEmbed(l: (id: string) => void) {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return { index: stub as unknown as EmbeddingIndex, fire: (id: string) => listener?.(id) };
}

test("a failing enrichment cannot take the process down", async () => {
  // Enrichment runs detached from the embed event, so a throw inside it has no
  // caller to reach: it surfaces as an unhandled rejection, and Node ends the
  // process for those. That happened for real — on a cloud-synced vault the
  // provider can delete the temp file before the atomic rename gets to it, and
  // every save that hit the race killed the daemon.
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-enrich-detached-"));
  const rejections: unknown[] = [];
  const onRejection = (err: unknown): void => {
    rejections.push(err);
  };
  process.on("unhandledRejection", onRejection);
  try {
    await writeFile(path.join(dir, "a.md"), memoryMd("a"), "utf8");
    await writeFile(path.join(dir, "b.md"), memoryMd("b"), "utf8");
    const vault = new Vault(dir);
    await vault.init();

    // The file disappears while the vault still has it indexed — the same shape
    // as the cloud-provider race, and enough to make the rewrite throw.
    await rm(path.join(dir, "a.md"));

    const { index, fire } = firableEmbeddings([{ id: "b", score: 0.9 }]);
    const enricher = new RelatedEnricher(vault, index);
    enricher.start();

    assert.doesNotThrow(() => fire("a"));
    // give the detached promise a chance to reject
    await new Promise((r) => setTimeout(r, 60));
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(rejections, [], "the detached enrichment must swallow its own failure");
    enricher.stop();
  } finally {
    process.off("unhandledRejection", onRejection);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
