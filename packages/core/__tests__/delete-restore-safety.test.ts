/**
 * Codex-Befunde 5 und 6: Delete und Restore in audit-save.ts.
 *
 *   5. `auditedSoftDelete` verschob die Datei, ließ den Index-Eintrag aber
 *      stehen. Auf einem Cloud-Mount (Polling-Watcher, Intervall 1500ms, bei
 *      Provider-Mounts oft gar kein Event) blieb das gelöschte Memory bis zum
 *      nächsten Reconcile oder Neustart recallbar — es wurde ausgeliefert,
 *      obwohl es auf der Platte im Trash lag. Der Bridge-Pfad räumte ebenfalls
 *      nicht auf; die Eviction gehört deshalb in die Mutation selbst.
 *   6. `auditedRestore` schrieb an JEDEN `destFilePath`, den der Caller nannte
 *      — auch in ein Geschwisterverzeichnis NEBEN dem Vault. Und es prüfte
 *      nicht, ob die zurückgeholte Datei überhaupt die angeforderte Memory ist.
 *
 * Runner: node --import tsx --test packages/core/__tests__/delete-restore-safety.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Vault, AuditLog, auditedSoftDelete, auditedRestore, auditedSave, saveMemory } from "../src/index.js";

function memoryMarkdown(id: string): string {
  const now = new Date().toISOString();
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    "type: lesson",
    "summary: s",
    "topic_path:",
    "  - test",
    "tags:",
    "  - test",
    "scope: test-scope",
    "recall_when:",
    "  - probe",
    `created: ${now}`,
    `updated: ${now}`,
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
}

async function makeVault(prefix: string): Promise<{ root: string; vault: Vault; auditLog: AuditLog }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(root, "doomed.md"), memoryMarkdown("doomed"), "utf8");
  const vault = new Vault(root);
  await vault.init();
  return { root, vault, auditLog: new AuditLog(root) };
}

test("auditedSoftDelete evicts the memory from the index itself — no waiting for the watcher", async () => {
  const { root, vault, auditLog } = await makeVault("bastra-del-");
  try {
    assert.ok(vault.get("doomed"), "control: indexed before the delete");
    await auditedSoftDelete({
      vault,
      auditLog,
      vaultRoot: root,
      memoryID: "doomed",
      context: { actor: "user" },
    });
    // Kein forgetFile() vom Caller: die Mutation muss selbst aufräumen, sonst
    // liefert der Recall auf einem Cloud-Mount weiter ein gelöschtes Memory.
    assert.equal(
      vault.get("doomed"),
      undefined,
      "delete must drop the index entry, not wait for a cloud-unreliable unlink event",
    );
  } finally {
    await vault.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("auditedRestore refuses a destination outside the vault", async () => {
  const { root, vault, auditLog } = await makeVault("bastra-restore-");
  const outside = join(dirname(root), `${"escape-"}${process.pid}`);
  try {
    await auditedSoftDelete({
      vault, auditLog, vaultRoot: root, memoryID: "doomed", context: { actor: "user" },
    });
    await mkdir(outside, { recursive: true });
    await assert.rejects(
      auditedRestore({
        auditLog,
        vaultRoot: root,
        memoryID: "doomed",
        destFilePath: join(outside, "doomed.md"),
        context: { actor: "user" },
      }),
      /outside the vault/,
      "a sibling directory next to the vault is not a restore target",
    );
    assert.deepEqual(await readdir(outside), [], "nothing was written outside the vault");
  } finally {
    await vault.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(outside, { recursive: true, force: true });
  }
});

test("auditedRestore is not fooled by a symlink that points out of the vault", async () => {
  const { root, vault, auditLog } = await makeVault("bastra-restore-link-");
  const outside = await mkdtemp(join(tmpdir(), "bastra-outside-"));
  try {
    await auditedSoftDelete({
      vault, auditLog, vaultRoot: root, memoryID: "doomed", context: { actor: "user" },
    });
    // Cloud-Mounts sind oft genau das: ein Symlink im Vault, der woanders
    // hinzeigt. Eine rein textuelle Präfix-Prüfung ginge hier durch.
    await symlink(outside, join(root, "elsewhere"));
    await assert.rejects(
      auditedRestore({
        auditLog,
        vaultRoot: root,
        memoryID: "doomed",
        destFilePath: join(root, "elsewhere", "doomed.md"),
        context: { actor: "user" },
      }),
      /outside the vault/,
    );
    assert.deepEqual(await readdir(outside), [], "the symlink target stayed empty");
  } finally {
    await vault.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(outside, { recursive: true, force: true });
  }
});

test("auditedRestore rejects a trash file that is not the requested memory", async () => {
  const { root, vault, auditLog } = await makeVault("bastra-restore-swap-");
  try {
    await auditedSoftDelete({
      vault, auditLog, vaultRoot: root, memoryID: "doomed", context: { actor: "user" },
    });
    // Jemand hat den Trash von Hand angefasst (oder ein Sync-Konflikt hat
    // ihn ersetzt): unter `doomed.md` liegt jetzt ein FREMDES Memory.
    const trashFile = join(root, ".bastra", "trash", "doomed.md");
    await writeFile(trashFile, memoryMarkdown("someone-else"), "utf8");
    await assert.rejects(
      auditedRestore({
        auditLog, vaultRoot: root, memoryID: "doomed", context: { actor: "user" },
      }),
      /does not hold memory/,
    );
    // Und der Vault hat nichts Falsches an den Originalpfad bekommen.
    const inVault = (await readdir(root)).filter((n) => n.endsWith(".md"));
    assert.deepEqual(inVault, [], "no foreign memory landed at the original path");
  } finally {
    await vault.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

/**
 * Codex-Gegenreview: Der Restore prüfte nur seinen ZIELPFAD. Existiert
 * dieselbe id inzwischen in einem anderen Regal — weil das Memory nach dem
 * Löschen neu angelegt oder re-filed wurde —, landete die alte Version
 * daneben, und danach waren ZWEI aktive Dateien mit einer id im Vault.
 */
test("restore verweigert, wenn die id inzwischen woanders lebt", async () => {
  const { root: vaultRoot, vault, auditLog } = await makeVault("bastra-restore-live-");
  try {
    await saveMemory(vaultRoot, {
      id: "wiederkehrer",
      title: "T",
      type: "reference",
      summary: "s",
      body: "ERSTE FASSUNG",
      topic_path: ["t"],
      tags: ["t"],
      scope: "proj",
      recall_when: ["t"],
    });
    await vault.reconcile?.();
    await auditedSoftDelete({
      vault,
      auditLog,
      vaultRoot,
      memoryID: "wiederkehrer",
      context: { actor: "user", actor_detail: "test" },
    });

    // Dasselbe Memory kommt zurück — aber in einem anderen Regal.
    await saveMemory(vaultRoot, {
      id: "wiederkehrer",
      title: "T",
      type: "reference",
      summary: "s",
      body: "ZWEITE FASSUNG",
      topic_path: ["t"],
      tags: ["t"],
      scope: "proj",
      recall_when: ["t"],
      folder: "memories/people",
    });
    await vault.reconcile?.();

    // OHNE `vault`. Codex-Gegenreview (P0): Der optionale Index war die
    // einzige Quelle der Besitzprüfung — ließ ein Caller ihn weg, entfiel sie
    // vollständig, und der Restore legte die alte Fassung neben die neue.
    // Jetzt fragt der Restore die Platte, und die weiß es ohne Index.
    await assert.rejects(
      auditedRestore({
        auditLog,
        vaultRoot,
        memoryID: "wiederkehrer",
        context: { actor: "user", actor_detail: "test" },
      }),
      /already live at/,
    );
    assert.equal(vault.pathsFor("wiederkehrer").length, 1, "es bleibt bei einer aktiven Datei");
  } finally {
    await vault.stop?.();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

/**
 * Codex-Gegenreview: `auditedSave` — der Bridge- und Import-Pfad — kannte das
 * Re-Filing aus #64 nicht. Ein `overwrite` mit geändertem `folder` schrieb die
 * neue Datei und ließ die alte liegen; danach trugen zwei Dateien dieselbe id.
 * `tool-handlers.ts` räumt an seiner Stelle längst auf, hier fehlte es.
 */
test("auditedSave räumt beim Re-Filing die alte Datei weg", async () => {
  const { root, vault, auditLog } = await makeVault("bastra-refile-");
  try {
    const input = {
      id: "wanderer",
      title: "T",
      type: "reference" as const,
      summary: "s",
      body: "ALT",
      topic_path: ["t"],
      tags: ["t"],
      scope: "proj",
      recall_when: ["t"],
    };
    await saveMemory(root, input);
    await vault.reconcile?.();
    const before = vault.pathsFor("wanderer");
    assert.equal(before.length, 1);

    const { result } = await auditedSave({
      vault,
      auditLog,
      vaultRoot: root,
      input: { ...input, body: "NEU", folder: "memories/people", overwrite: true },
      context: { actor: "user", actor_detail: "test", reason: "re-file" },
    });

    assert.notEqual(result.file_path, before[0], "die Datei ist umgezogen");
    await vault.reconcile?.();
    assert.deepEqual(
      vault.pathsFor("wanderer"),
      [result.file_path],
      "nur noch eine Datei trägt die id",
    );
  } finally {
    await vault.stop?.();
    await rm(root, { recursive: true, force: true });
  }
});
