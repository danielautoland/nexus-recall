/**
 * #240/A9, A10, B11 — three independent defects with one shape: an operation
 * reports success while its effect was silently lost or never happened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "@bastra-recall/core";
import { existsSync } from "node:fs";
import { addFloor, release, listFloors, MAX_FLOORS } from "../src/floors.js";
import { openDocument } from "../src/documents-handler.js";

// ─── A9: floor registry under concurrency ───────────────────────

async function floorsFile(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "bastra-floors-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "floors.json");
}

test("A9: parallel addFloor calls all persist", async (t) => {
  const path = await floorsFile(t);

  // The natural shape: a surface pins several memories for ONE decision.
  await Promise.all(
    Array.from({ length: MAX_FLOORS }, (_, i) =>
      addFloor({ memory_id: `mem-${i}`, condition: "decision-x", reason: "r" }, path),
    ),
  );

  const persisted = await listFloors(undefined, path);
  assert.equal(
    persisted.length,
    MAX_FLOORS,
    `expected ${MAX_FLOORS} floors, got ${persisted.length} — a lost floor is a silently dropped hard constraint`,
  );
});

test("A9: the cap is enforced against committed state, not a stale read", async (t) => {
  const path = await floorsFile(t);

  const results = await Promise.allSettled(
    Array.from({ length: MAX_FLOORS + 8 }, (_, i) =>
      addFloor({ memory_id: `mem-${i}`, condition: "c", reason: "r" }, path),
    ),
  );

  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal((await listFloors(undefined, path)).length, MAX_FLOORS);
  assert.equal(rejected.length, 8, "over-cap adds must be rejected, not silently dropped");
});

test("A9: a parallel release actually releases", async (t) => {
  const path = await floorsFile(t);
  for (let i = 0; i < 5; i++) {
    await addFloor({ memory_id: `keep-${i}`, condition: "gone", reason: "r" }, path);
  }

  await Promise.all([
    release("gone", path),
    addFloor({ memory_id: "new-1", condition: "stays", reason: "r" }, path),
  ]);

  const left = await listFloors(undefined, path);
  assert.ok(
    !left.some((e) => e.condition === "gone"),
    "released floors must not survive a concurrent add",
  );
  assert.ok(left.some((e) => e.memory_id === "new-1"), "the concurrent add must survive too");
});

// ─── A10: import ids are derived from source identity ───────────

test("A10: same basename in different source folders keeps stable ids on reimport", async (t) => {
  const { importVault } = await import("../src/import-vault.js");
  const root = await mkdtemp(join(tmpdir(), "bastra-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const src = join(root, "src");
  const target = join(root, "vault");
  await mkdir(join(src, "a"), { recursive: true });
  await mkdir(join(src, "b"), { recursive: true });
  await mkdir(target, { recursive: true });

  const note = (title: string) => `# ${title}\n\nSome body for ${title}.\n`;
  await writeFile(join(src, "a", "same.md"), note("Same A"), "utf8");
  await writeFile(join(src, "b", "same.md"), note("Same B"), "utf8");

  const idsFor = async () => {
    const vault = new Vault(target);
    await vault.init();
    const out = new Map<string, string>();
    for (const m of vault.list()) out.set(m.fm.id, m.fm.title);
    await vault.stop?.();
    return out;
  };

  await importVault(target, src, { label: "demo" });
  const before = await idsFor();
  assert.equal(before.size, 2, `expected two imported notes, got ${[...before.keys()]}`);

  // Remove one source file and reimport — the OTHER note's id must not move.
  await rm(join(src, "a", "same.md"));
  await importVault(target, src, { label: "demo" });
  const after = await idsFor();

  const bTitleBefore = [...before.entries()].find(([, t2]) => t2.includes("Same B"))?.[0];
  const bTitleAfter = [...after.entries()].find(([, t2]) => t2.includes("Same B"))?.[0];
  assert.ok(bTitleBefore && bTitleAfter, "the surviving note must still be present");
  assert.equal(
    bTitleAfter,
    bTitleBefore,
    "removing a sibling must not move the surviving note's id",
  );

  const titles = [...after.values()];
  assert.equal(
    new Set(titles).size,
    titles.length,
    `no content may end up duplicated under two ids: ${JSON.stringify(titles)}`,
  );
});

test("A10: a wikilink between nested imported notes resolves to a real id", async (t) => {
  // The A10 id change put the relative directory into the id, but every link
  // resolver still recomputed `slugify(label + basename)` — so a nested note
  // linking to a sibling produced a ghost on the very first import.
  const { importVault } = await import("../src/import-vault.js");
  const root = await mkdtemp(join(tmpdir(), "bastra-import-links-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const src = join(root, "src");
  const target = join(root, "vault");
  await mkdir(join(src, "a"), { recursive: true });
  await mkdir(target, { recursive: true });

  await writeFile(join(src, "a", "one.md"), "# One\n\nOne links to [[two]].\n", "utf8");
  await writeFile(join(src, "a", "two.md"), "# Two\n\nSecond note.\n", "utf8");

  const res = await importVault(target, src, { label: "demo" });

  const vault = new Vault(target);
  await vault.init();
  t.after(async () => {
    await vault.stop?.();
  });

  const ids = new Set(vault.list().map((m) => m.fm.id));
  const one = vault.list().find((m) => m.fm.title.includes("One"));
  assert.ok(one, "the linking note must have imported");

  const linked = [...(one.body.matchAll(/\[\[([^\]]+)\]\]/g))].map((m) => m[1]);
  assert.ok(linked.length > 0, "the wikilink must survive the import");
  for (const target of linked) {
    assert.ok(
      ids.has(target),
      `[[${target}]] must point at an imported id, have ${JSON.stringify([...ids])}`,
    );
  }
  assert.equal(res.skipped.length, 0);
});

test("A10: a pre-relDir node is retired instead of left as a duplicate", async (t) => {
  const { importVault, IMPORT_ROOT } = await import("../src/import-vault.js");
  const root = await mkdtemp(join(tmpdir(), "bastra-import-migrate-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const src = join(root, "src");
  const target = join(root, "vault");
  await mkdir(join(src, "a"), { recursive: true });
  const importFolder = join(target, IMPORT_ROOT, "demo");
  await mkdir(importFolder, { recursive: true });

  await writeFile(join(src, "a", "note.md"), "# Note\n\nA nested note.\n", "utf8");

  // Seed the identity a pre-#240 import would have written: no relDir.
  await writeFile(
    join(importFolder, "demo-note.md"),
    `---
id: demo-note
title: Note
type: reference
summary: the old identity
topic_path: [imported, demo]
tags: [imported]
scope: demo
recall_when: ["note"]
created: 2026-06-01
updated: 2026-06-01
---

A nested note.
`,
    "utf8",
  );

  const res = await importVault(target, src, { label: "demo" });

  const vault = new Vault(target);
  await vault.init();
  t.after(async () => {
    await vault.stop?.();
  });

  assert.deepEqual(
    res.migrated,
    [{ from: "demo-note", to: "demo-a-note" }],
    "the reimport must report which identity it retired",
  );
  assert.ok(vault.get("demo-a-note"), "the new identity must exist");
  assert.equal(vault.get("demo-note"), undefined, "the old node must not linger as a duplicate");
  // Retired, not destroyed.
  assert.ok(existsSync(join(target, ".bastra", "trash", "demo-note.md")));
});

// ─── B11: open_document tells the truth ─────────────────────────

test("B11: opening a document whose file is gone reports failure", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-open-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await writeFile(
    join(dir, "doc.md"),
    `---
id: doc-x
title: Doc X
type: doc
summary: s
topic_path: [d]
tags: [d]
scope: d
recall_when: ["doc x"]
original_path: ${join(dir, "definitely-missing.pdf")}
created: 2026-05-01
updated: 2026-05-01
---

body
`,
    "utf8",
  );
  const vault = new Vault(dir);
  await vault.init();
  t.after(async () => {
    await vault.stop?.();
  });

  const res = await openDocument(vault, { id: "doc-x" });
  assert.equal(res.ok, false, "a missing file must not be reported as opened");
  assert.match(res.message ?? "", /no longer exists/);
});
