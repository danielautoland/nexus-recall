import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Vault } from "../src/vault.js";

function memoryMd(id: string): string {
  return `---
id: ${id}
title: Title ${id}
type: lesson
summary: summary for ${id}
topic_path: [test]
tags: [test]
scope: test
recall_when: ["when ${id}"]
created: 2026-05-01
updated: 2026-05-01
---

Body of ${id}.
`;
}

async function freshVault(ids: string[]): Promise<{ dir: string; vault: Vault }> {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-vault-reconcile-"));
  for (const id of ids) await writeFile(path.join(dir, `${id}.md`), memoryMd(id), "utf8");
  const vault = new Vault(dir);
  await vault.init();
  // No startWatching() — so external disk changes stay invisible until reconcile,
  // exactly the cloud-mount drift this method exists to fix.
  return { dir, vault };
}

test("reconcile: picks up a file added externally (watcher missed)", async () => {
  const { dir, vault } = await freshVault(["a", "b", "c"]);
  try {
    assert.equal(vault.size(), 3);
    await writeFile(path.join(dir, "d.md"), memoryMd("d"), "utf8"); // external add
    assert.equal(vault.size(), 3, "size still stale before reconcile");
    assert.equal(await vault.reconcile(), 4);
    assert.equal(vault.size(), 4);
    assert.ok(vault.get("d"), "newly added memory is now in the index");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile: drops an index entry whose file was deleted", async () => {
  const { dir, vault } = await freshVault(["a", "b", "c"]);
  try {
    await rm(path.join(dir, "b.md")); // external delete
    assert.equal(vault.size(), 3, "size still stale before reconcile");
    assert.equal(await vault.reconcile(), 2);
    assert.equal(vault.get("b"), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile: ignores non-memory .md files", async () => {
  const { dir, vault } = await freshVault(["a", "b"]);
  try {
    await writeFile(path.join(dir, "note.md"), "# Just an Obsidian note\n\nno frontmatter.\n", "utf8");
    assert.equal(await vault.reconcile(), 2, "plain note is not counted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile: no changes → count stable", async () => {
  const { dir, vault } = await freshVault(["a", "b", "c"]);
  try {
    assert.equal(await vault.reconcile(), 3);
    assert.equal(await vault.reconcile(), 3, "idempotent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
