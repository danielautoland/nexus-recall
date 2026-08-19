/**
 * Tests für die Monats-Journal-Projektion (#288) — Markdown aus dem Audit-Log.
 * Runner: `tsx --test __tests__/vault-journal.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "@bastra-recall/core";
import { renderMonthlyJournal, writeVaultJournal, JOURNAL_DIR } from "../src/vault-journal.js";

async function seededVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bastra-journal-"));
  const log = new AuditLog(root);
  await log.record({
    memory_id: "alpha",
    actor: "assistant",
    actor_detail: "claude-code",
    operation: "create",
    diff_before: null,
    diff_after: { id: "alpha" },
    reason: "first capture",
    timestamp: "2026-07-03T09:15:00.000Z",
  });
  await log.record({
    memory_id: "beta",
    actor: "user",
    operation: "update",
    diff_before: {},
    diff_after: {},
    timestamp: "2026-07-03T10:00:00.000Z",
  });
  await log.record({
    memory_id: "alpha",
    actor: "system",
    operation: "delete",
    diff_before: {},
    diff_after: null,
    timestamp: "2026-08-01T12:00:00.000Z",
  });
  return root;
}

test("one file per month, grouped by day, with wikilinks, actor and reason", async () => {
  const root = await seededVault();
  const written = await writeVaultJournal(root);
  assert.deepEqual(written.sort(), ["2026-07", "2026-08"]);

  const july = await readFile(join(root, JOURNAL_DIR, "2026-07.md"), "utf8");
  assert.match(july, /# Journal 2026-07/);
  assert.match(july, /## 2026-07-03/);
  assert.match(july, /\*\*create\*\* \[\[alpha\]\] \(assistant · claude-code\) — first capture/);
  assert.match(july, /\*\*update\*\* \[\[beta\]\] \(user\)/);
  assert.match(july, /2 writes this month/);
  assert.ok(!july.includes("[[alpha]] (system)"), "august entry stays out of july");

  const august = await readFile(join(root, JOURNAL_DIR, "2026-08.md"), "utf8");
  assert.match(august, /\*\*delete\*\* \[\[alpha\]\] \(system\)/);
});

test("journal files carry no memory frontmatter, so the vault loader skips them", async () => {
  const root = await seededVault();
  await writeVaultJournal(root);
  const july = await readFile(join(root, JOURNAL_DIR, "2026-07.md"), "utf8");
  assert.ok(!july.startsWith("---"), "a projection must never look like a memory file");
});

test("an unchanged month is not rewritten — the render is deterministic", async () => {
  const root = await seededVault();
  await writeVaultJournal(root);
  const second = await writeVaultJournal(root);
  assert.deepEqual(second, []);
});

test("a new entry re-projects only its month", async () => {
  const root = await seededVault();
  await writeVaultJournal(root);
  await new AuditLog(root).record({
    memory_id: "gamma",
    actor: "assistant",
    operation: "create",
    diff_before: null,
    diff_after: {},
    timestamp: "2026-08-15T08:00:00.000Z",
  });
  const written = await writeVaultJournal(root);
  assert.deepEqual(written, ["2026-08"]);
  const august = await readFile(join(root, JOURNAL_DIR, "2026-08.md"), "utf8");
  assert.match(august, /\[\[gamma\]\]/);
});

test("a pre-existing file without the journal anchor is never clobbered", async () => {
  const root = await seededVault();
  const dir = join(root, JOURNAL_DIR);
  await mkdir(dir, { recursive: true });
  const foreign = "# my own notes for july\n";
  await writeFile(join(dir, "2026-07.md"), foreign, "utf8");
  const written = await writeVaultJournal(root);
  assert.deepEqual(written, ["2026-08"], "only the unclaimed month is projected");
  assert.equal(await readFile(join(dir, "2026-07.md"), "utf8"), foreign);
});

test("an empty audit log projects nothing and creates no folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "bastra-journal-empty-"));
  assert.deepEqual(await writeVaultJournal(root), []);
  const entries = await readdir(root);
  assert.ok(!entries.includes(JOURNAL_DIR));
});

test("renderMonthlyJournal is pure — identical data renders byte-identical", async () => {
  const root = await seededVault();
  const entries = await new AuditLog(root).readAll();
  const july = entries.filter((e) => e.timestamp.startsWith("2026-07"));
  assert.equal(renderMonthlyJournal("2026-07", july), renderMonthlyJournal("2026-07", july));
});
