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

/**
 * P0 Punkt 6: Der Cross-Scope-Bypass darf nicht an einem einzelnen
 * Allerweltswort hängen. `anchor_strength` trennt „ein häufiges Wort stand
 * zufällig in einer fremden Triggerphrase" von echter Absicht.
 */
test("one common trigger term is a weak anchor", async (t) => {
  // "arbeit" steht in vielen Triggern — hohe document frequency, also für sich
  // kein Beleg, dass dieses Memory gemeint war.
  const entries = Array.from({ length: 60 }, (_, i) => ({
    id: `memo-${i}`,
    recall_when: [`arbeit an sache ${i}`],
  }));
  const { dir, search } = await vaultWith(entries);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const hit = search.recall("arbeit", { k: 5 })[0];
  assert.ok(hit, "precondition: the common term must retrieve something");
  assert.equal(hit.matched_recall_when, true, "it IS an exact trigger match");
  assert.equal(hit.anchor_strength, "weak", "but one common word does not carry intent");
});

test("a rare trigger term carries intent on its own", async (t) => {
  const entries = [
    { id: "rare-memo", recall_when: ["nshostingcontroller sizingoptions setzen"] },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `noise-${i}`, recall_when: [`arbeit ${i}`] })),
  ];
  const { dir, search } = await vaultWith(entries);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const hit = search.recall("nshostingcontroller", { k: 5 }).find((h) => h.id === "rare-memo");
  assert.ok(hit, "precondition: the rare identifier must retrieve the memory");
  assert.equal(hit.anchor_strength, "strong", "a rare identifier speaks for itself");
});

test("two exact trigger terms carry intent even when each is common", async (t) => {
  const entries = [
    { id: "target", recall_when: ["arbeit an datei"] },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `a-${i}`, recall_when: [`arbeit ${i}`] })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `d-${i}`, recall_when: [`datei ${i}`] })),
  ];
  const { dir, search } = await vaultWith(entries);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const hit = search.recall("arbeit datei", { k: 5 }).find((h) => h.id === "target");
  assert.ok(hit, "precondition: the memory must be retrieved");
  assert.equal(hit.anchor_strength, "strong", "two authored terms together are the declaration");
});

test("no trigger match leaves the strength unset", async (t) => {
  const { dir, search } = await vaultWith([
    { id: "memo", recall_when: ["ganz anderer trigger"], body: "kanarienvogel" },
  ]);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const hit = search.recall("kanarienvogel", { k: 5 }).find((h) => h.id === "memo");
  assert.ok(hit);
  assert.equal(hit.anchor_strength, undefined, "absent, not 'weak' — nothing anchored at all");
});
