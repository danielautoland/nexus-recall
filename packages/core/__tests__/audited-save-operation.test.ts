/**
 * #240/C6 — auditedSave must classify a slug-inferred overwrite as `update`.
 *
 * It looked the predecessor up via `input.id` only, but the effective id is
 * `input.id ?? slugify(input.title)` and was derived later, inside saveMemory.
 * On the normal path (agent sends a title, no id) the lookup therefore found
 * nothing, and a destructive overwrite was recorded as `create` with
 * `diff_before: null` — the pre-image was gone and the mutation could not be
 * reconstructed from the audit trail. Same root cause as #239.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Vault } from "../src/vault.js";
import { AuditLog } from "../src/audit-log.js";
import { auditedSave } from "../src/audit-save.js";
import type { SaveMemoryInput } from "../src/save.js";

const INPUT = {
  title: "Deploy Runbook",
  type: "lesson",
  summary: "How to roll back a deploy.",
  topic_path: ["ops"],
  tags: ["deploy"],
  scope: "audittest",
  recall_when: ["when rolling back a deploy"],
  body: "Body v1.",
} as SaveMemoryInput;

async function harness(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-audited-save-"));
  const vault = new Vault(dir);
  await vault.init();
  const auditLog = new AuditLog(dir);
  t.after(async () => {
    await vault.stop?.();
    await rm(dir, { recursive: true, force: true });
  });
  const save = async (input: SaveMemoryInput) => {
    const out = await auditedSave({
      vault,
      auditLog,
      vaultRoot: dir,
      input,
      context: { actor: "assistant", reason: "test mutation" },
    });
    await vault.reindexFile(out.result.file_path);
    return out;
  };
  return { save };
}

test("a slug-inferred overwrite is audited as update, with the pre-image kept", async (t) => {
  const { save } = await harness(t);

  const first = await save(INPUT);
  assert.equal(first.audit.operation, "create");
  assert.equal(first.audit.diff_before, null);

  const second = await save({ ...INPUT, body: "Body v2.", overwrite: true });
  assert.equal(second.result.created, false, "the file already existed");
  assert.equal(
    second.audit.operation,
    "update",
    "a destructive overwrite must not be recorded as a creation",
  );
  assert.ok(
    second.audit.diff_before,
    "the overwritten state must be reconstructable from the trail",
  );
  assert.equal(
    (second.audit.diff_before as Record<string, unknown>).id,
    first.result.id,
  );
});

test("an explicit id still classifies correctly", async (t) => {
  const { save } = await harness(t);

  await save({ ...INPUT, id: "explicit-runbook" });
  const second = await save({ ...INPUT, id: "explicit-runbook", overwrite: true });

  assert.equal(second.audit.operation, "update");
  assert.ok(second.audit.diff_before);
});
