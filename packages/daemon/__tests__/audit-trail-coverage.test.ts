/**
 * #206 — the audit trail has to cover the path the agent actually writes
 * through.
 *
 * The append-only log and its wrappers existed since the Mac-app work, but
 * were wired into exactly one caller: `bridge.ts`. Every write over MCP or
 * REST — which is how the assistant writes — went past it. The one surface
 * that runs autonomously was the one with no record.
 *
 * Telemetry does not close that hole: it can be switched off and it is pruned
 * after 90 days. The audit log is append-only and permanent.
 *
 * These tests pin the coverage itself, not the format — a future write path
 * that forgets to record should fail here rather than be discovered later by
 * someone trying to reconstruct what happened.
 *
 * Runner: `tsx --test __tests__/audit-trail-coverage.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { Telemetry } from "../src/telemetry.js";
import { saveMemoryHandler, archiveMemoryHandler, type ToolDeps } from "../src/tool-handlers.js";
import { resetAuditLogCache } from "../src/audit-trail.js";

interface AuditLine {
  memory_id: string;
  operation: string;
  actor: string;
  actor_detail?: string;
  diff_before: Record<string, unknown> | null;
  diff_after: Record<string, unknown> | null;
  file_path?: string;
  reason?: string;
  session_id?: string;
  timestamp: string;
}

async function makeDeps(): Promise<{ deps: ToolDeps; vaultPath: string; cleanup: () => Promise<void> }> {
  resetAuditLogCache();
  const vaultPath = await mkdtemp(join(tmpdir(), "bastra-audit-"));
  const vault = new Vault(vaultPath);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const deps: ToolDeps = { vault, search, telemetry: new Telemetry(), vaultPath };
  return {
    deps,
    vaultPath,
    cleanup: async () => {
      search.stop();
      await vault.stop?.();
      resetAuditLogCache();
      await rm(vaultPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

async function auditEntries(vaultPath: string): Promise<AuditLine[]> {
  const raw = await readFile(join(vaultPath, ".bastra", "audit-log.ndjson"), "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as AuditLine);
}

const memo = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  type: "project-fact",
  summary: `Zusammenfassung für ${title}`,
  body: `Inhalt von ${title}.`,
  topic_path: ["test"],
  tags: ["test"],
  scope: "audittest",
  recall_when: [`wenn ${title} gebraucht wird`],
  ...extra,
});

test("#206: an MCP save is recorded — the path that had no trail at all", async () => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  try {
    const res = await saveMemoryHandler(deps, memo("Erster Eintrag"));
    const entries = await auditEntries(vaultPath);
    assert.equal(entries.length, 1, "exactly one entry per write");
    const e = entries[0];
    assert.equal(e.memory_id, res.id);
    assert.equal(e.operation, "create");
    assert.equal(e.actor, "assistant");
    assert.equal(e.actor_detail, "mcp:save_memory", "the surface must be identifiable");
    assert.equal(e.diff_before, null, "a create has no before-state");
    assert.ok(e.diff_after, "the after-state is what makes the entry reconstructable");
    assert.equal(e.file_path, res.file_path);
    assert.ok(e.session_id, "entries must correlate with the run that caused them");
    assert.ok(Date.parse(e.timestamp) > 0, "timestamp must be parseable");
  } finally {
    await cleanup();
  }
});

test("#206: an overwrite is an update and carries the previous state", async () => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  try {
    await saveMemoryHandler(deps, memo("Wird geändert"));
    await saveMemoryHandler(deps, memo("Wird geändert", { overwrite: true, body: "Neuer Inhalt." }));

    const entries = await auditEntries(vaultPath);
    assert.equal(entries.length, 2);
    const update = entries[1];
    assert.equal(update.operation, "update");
    assert.ok(update.diff_before, "an update without a before-state cannot be reconstructed");
    assert.equal(
      (update.diff_before as Record<string, unknown>).title,
      "Wird geändert",
      "the before-state must be the frontmatter as it actually was",
    );
  } finally {
    await cleanup();
  }
});

test("#206: archiving is recorded as a delete with the state it had", async () => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  try {
    const saved = await saveMemoryHandler(deps, memo("Wird archiviert"));
    await archiveMemoryHandler(deps, { id: saved.id });

    const entries = await auditEntries(vaultPath);
    const del = entries.find((e) => e.operation === "delete");
    assert.ok(del, "archiving takes a memory out of the index — that must leave a record");
    assert.equal(del!.memory_id, saved.id);
    assert.equal(del!.actor_detail, "mcp:archive_memory");
    assert.ok(del!.diff_before, "the state before archiving is the recoverable part");
    assert.equal(del!.diff_after, null);
  } finally {
    await cleanup();
  }
});

test("#206: a supersede reason reaches the log", async () => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  try {
    const old = await saveMemoryHandler(deps, memo("Alt"));
    const fresh = await saveMemoryHandler(deps, memo("Neu"));
    await archiveMemoryHandler(deps, { id: old.id, superseded_by: fresh.id });

    const del = (await auditEntries(vaultPath)).find((e) => e.operation === "delete");
    assert.ok(del);
    assert.match(del!.reason ?? "", new RegExp(fresh.id), "the successor belongs in the record");
  } finally {
    await cleanup();
  }
});

test("#206: the log is append-only — earlier entries are never rewritten", async () => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  try {
    await saveMemoryHandler(deps, memo("Eins"));
    const afterFirst = await auditEntries(vaultPath);
    await saveMemoryHandler(deps, memo("Zwei"));
    await saveMemoryHandler(deps, memo("Eins", { overwrite: true, body: "Geändert." }));
    const afterAll = await auditEntries(vaultPath);

    assert.equal(afterAll.length, 3);
    assert.deepEqual(afterAll[0], afterFirst[0], "the first entry must survive byte-identical");
  } finally {
    await cleanup();
  }
});

test("#206: a failing audit never costs the user their write", async () => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  try {
    // The audit log lives under .bastra/ — make that path un-writable by
    // occupying it with a file where a directory has to go.
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(vaultPath, ".bastra"), { recursive: true });
    await writeFile(join(vaultPath, ".bastra", "audit-log.ndjson"), "", "utf8");
    const { rm: rmOne } = await import("node:fs/promises");
    await rmOne(join(vaultPath, ".bastra", "audit-log.ndjson"));
    await mkdir(join(vaultPath, ".bastra", "audit-log.ndjson"), { recursive: true });

    const res = await saveMemoryHandler(deps, memo("Trotzdem gespeichert"));
    assert.ok(res.id, "the save must succeed even when the trail cannot be written");
    assert.ok(deps.vault.get(res.id), "and the memory must really be in the vault");
  } finally {
    await cleanup();
  }
});
