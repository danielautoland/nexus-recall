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
    await rm(dir, { recursive: true, force: true });
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
    await rm(dir, { recursive: true, force: true });
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
    await rm(dir, { recursive: true, force: true });
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
    await rm(dir, { recursive: true, force: true });
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
    await rm(dir, { recursive: true, force: true });
  }
});
