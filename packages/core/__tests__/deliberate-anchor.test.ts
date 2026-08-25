/**
 * `matched_recall_when` ist eine Aussage über AUTOR-ABSICHT, nicht über
 * lexikalische Nähe (P0 aus docs/recall-performance-handoff.md).
 *
 * Daran hängen zwei Freigaben: der Cross-Scope-Bypass (`hook-skip.ts`) und die
 * Unterdrückung von `weak_result` (`weak-result.ts`). Vor dem Fix reichte ein
 * Fuzzy- oder Prefix-Treffer, um beide zu öffnen — gemessen an `obsidan` und
 * `tripwir` gegen den echten Vault.
 *
 * Runner: node --import tsx --test packages/core/__tests__/deliberate-anchor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../src/vault.js";
import { SearchIndex } from "../src/search.js";

async function vaultWith(entries: { id: string; recall_when: string[]; body?: string }[]) {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-anchor-"));
  for (const e of entries) {
    await writeFile(
      path.join(dir, `${e.id}.md`),
      `---
id: ${e.id}
title: ${e.id}
type: lesson
summary: summary of ${e.id}
topic_path: [t]
tags: [t]
scope: t
recall_when: [${e.recall_when.map((r) => JSON.stringify(r)).join(", ")}]
created: 2020-01-01
updated: 2026-07-01
---

${e.body ?? `body of ${e.id}`}
`,
      "utf8",
    );
  }
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  return { dir, vault, search };
}

test("a fuzzy neighbour does not claim authored intent", async (t) => {
  const { dir, search } = await vaultWith([
    { id: "sand-theme", recall_when: ["sand theme umstellen"] },
    { id: "filler", recall_when: ["etwas ganz anderes"] },
  ]);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  // Ein Edit entfernt von "sand", steht aber nirgends in einem recall_when.
  const hits = search.recall("sadn", { k: 5 });
  const sand = hits.find((h) => h.id === "sand-theme");
  if (sand) {
    assert.equal(
      sand.matched_recall_when,
      false,
      "a fuzzy hit must not set the deliberate anchor — it is intent, not proximity",
    );
  }
});

test("a prefix hit does not claim authored intent", async (t) => {
  const { dir, search } = await vaultWith([
    { id: "tripwire-memo", recall_when: ["tripwire auswerten"] },
  ]);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const hits = search.recall("tripwir", { k: 5 });
  const hit = hits.find((h) => h.id === "tripwire-memo");
  assert.ok(hit, "precondition: the prefix must still RETRIEVE the memory");
  assert.equal(
    hit.matched_recall_when,
    false,
    "a prefix hit retrieves, but it does not declare intent",
  );
});

test("the exact authored word still sets the anchor", async (t) => {
  const { dir, search } = await vaultWith([
    { id: "tripwire-memo", recall_when: ["tripwire auswerten"] },
  ]);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const hit = search.recall("tripwire", { k: 5 }).find((h) => h.id === "tripwire-memo");
  assert.ok(hit, "precondition: the exact term must retrieve the memory");
  assert.equal(hit.matched_recall_when, true, "an exact authored term IS the anchor");
});

test("case does not decide intent", async (t) => {
  const { dir, search } = await vaultWith([
    { id: "memo", recall_when: ["Tripwire auswerten"] },
  ]);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  // Index und Query werden beide gefaltet; ein großgeschriebener Query-Term
  // muss seinen eigenen Dokumentterm finden, sonst wäre der Anker von der
  // Schreibweise abhängig statt von der Absicht.
  const hit = search.recall("TRIPWIRE", { k: 5 }).find((h) => h.id === "memo");
  assert.ok(hit, "precondition: the memory must be retrieved");
  assert.equal(hit.matched_recall_when, true, "the anchor must survive case folding");
});

test("a term matching only the body is not an anchor", async (t) => {
  const { dir, search } = await vaultWith([
    { id: "memo", recall_when: ["ganz anderer trigger"], body: "hier steht kanarienvogel im body" },
  ]);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const hit = search.recall("kanarienvogel", { k: 5 }).find((h) => h.id === "memo");
  assert.ok(hit, "precondition: the body term must retrieve the memory");
  assert.equal(hit.matched_recall_when, false, "the body is not a declared trigger");
});
