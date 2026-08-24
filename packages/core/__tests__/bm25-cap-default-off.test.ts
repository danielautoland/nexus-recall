/**
 * BM25-Query-Cap: Default ist AUS (#362).
 *
 * Der Akzeptanztest (15 Probe-Queries, injektionsrelevante Ids markiert)
 * zeigt beim 200-Zeichen-Budget aus der #362-Messung 15/15 Queries mit
 * verlorenen injektionsrelevanten Ids (Ø 2,27); ein 2000-Zeichen-Budget
 * verbessert auf 12/15 identisch (Ø 0,47 verloren), reißt die Ship-Regel
 * aber ebenfalls (kein verlorener Id UND ≥90 % identische injizierbare
 * Sets). Deshalb landet die Mechanik (`bm25-query-cap.test.ts`) einsatz-
 * bereit, aber DEFAULT AUS — nur ein explizit gesetzter
 * `bm25_query_max_chars` aktiviert sie (`search.ts`, `bm25Query()`).
 *
 * Runner: node --import tsx --test packages/core/__tests__/bm25-cap-default-off.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BM25_QUERY_MAX_CHARS } from "../src/bm25-query-cap.js";
import { Vault } from "../src/vault.js";
import { SearchIndex } from "../src/search.js";
import type { RecallStage } from "../src/recall-stages.js";

function memoryMd(id: string, marker = "ANCHORWORD"): string {
  return `---
id: ${id}
title: ${id} ${marker}
type: lesson
summary: ${marker} summary
topic_path: [t]
tags: [t]
scope: t
recall_when: ["${marker}"]
created: 2020-01-01
updated: 2026-07-01
---

Body ${marker} ${id}.
`;
}

test("default is off — a long query reaches BM25 uncapped", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-bm25cap-default-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  await writeFile(path.join(dir, "a.md"), memoryMd("alpha"), "utf8");

  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  t.after(() => search.stop());

  const filler = "hallo kurz eine frage zu dem thema von gestern bitte anschauen sagen davon haeltst grundsaetzlich stelle code besprochen genau danach rest text nichts beitraegt ANCHORWORD";
  const longQuery = `${filler} ${filler} ${filler}`;
  assert.ok(longQuery.length > BM25_QUERY_MAX_CHARS, "fixture must exceed the #362 budget");

  const stops: RecallStage[] = [];
  search.recall(longQuery, {
    k: 5,
    onStage: (s: RecallStage) => {
      if (s.name === "bm25.search" && s.durationMs !== undefined) stops.push(s);
    },
  });

  const bm25Stop = stops[0];
  assert.equal(
    bm25Stop?.meta?.bm25_query_chars,
    bm25Stop?.meta?.query_chars,
    `no explicit bm25_query_max_chars must leave the query untouched — got ${bm25Stop?.meta?.bm25_query_chars} of ${bm25Stop?.meta?.query_chars} chars`,
  );
  assert.equal(
    bm25Stop?.meta?.bm25_query_chars,
    longQuery.length,
    "the BM25 arm must receive the full, uncapped query by default",
  );
});
