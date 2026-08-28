/**
 * #377 — die seltenen Schreibfehler hinterlassen jetzt eine Spur.
 *
 * Der Befund war nicht, dass etwas falsch lief, sondern dass nichts davon
 * sichtbar war: ein Rollback, der nicht durchkam, ein Audit-Append nach dem
 * Commit, ein Area-Konflikt. Der Halbzustand stand im TEXT einer
 * Fehlermeldung — und die ist nach dem nächsten Terminalfenster weg.
 *
 * Getestet wird deshalb genau das: Kommt bei den drei Fällen ein Ereignis an,
 * trägt es den richtigen Status — und trägt es KEINE Inhalte.
 *
 * Runner: node --import tsx --test packages/core/__tests__/mutation-incident.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "../src/audit-log.js";
import { auditedSave } from "../src/audit-save.js";
import { saveMemory } from "../src/save.js";
import { withAreaExclusive } from "../src/area-claim.js";
import { onMutationIncident, type MutationIncident } from "../src/mutation-incident.js";
import type { SaveMemoryInput } from "../src/save-schema.js";
import type { Vault } from "../src/vault.js";

function input(over: Partial<SaveMemoryInput> = {}): SaveMemoryInput {
  return {
    id: "m",
    title: "M",
    type: "lesson",
    summary: "geheime-zusammenfassung",
    body: "GEHEIMER-INHALT",
    topic_path: ["t"],
    tags: ["t"],
    recall_when: ["t"],
    scope: "proj",
    ...over,
  } as SaveMemoryInput;
}

/** Incidents einer Aktion einsammeln — und die Abmeldung nicht vergessen,
 *  sonst hört der Test auch bei allen folgenden mit. */
async function collect<T>(fn: () => Promise<T>): Promise<{ result: T; seen: MutationIncident[] }> {
  const seen: MutationIncident[] = [];
  const off = onMutationIncident((i) => seen.push(i));
  try {
    return { result: await fn(), seen };
  } finally {
    off();
  }
}

async function vault(t: { after: (fn: () => unknown) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bastra-incident-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("ein gescheitertes Audit-Append meldet audit_failed — die Mutation steht trotzdem", async (t) => {
  const root = await vault(t);
  const log = new AuditLog(root);
  // Ein VERZEICHNIS am Pfad des Ledgers: `appendFile` scheitert mit EISDIR.
  await mkdir(join(root, ".bastra", "audit-log.ndjson"), { recursive: true });
  const stub = {
    get: () => undefined,
    pathsFor: () => [],
    forgetFile: () => {},
    reindexFile: async () => {},
  } as unknown as Vault;

  const { result, seen } = await collect(() =>
    auditedSave({ vault: stub, auditLog: log, vaultRoot: root, input: input(), context: { actor: "user" } }),
  );

  assert.equal(result.audit, null, "kein Beleg geschrieben");
  const incident = seen.find((i) => i.status === "audit_failed");
  assert.ok(incident, `ein audit_failed-Incident muss ankommen, gesehen: ${JSON.stringify(seen)}`);
  assert.equal(incident.phase, "audit");
  assert.equal(incident.memory_id, "m");
  assert.ok(incident.operation_id.length > 0, "eine operation_id hält die Phasen zusammen");
});

test("ein Incident trägt keine Memory-Inhalte", async (t) => {
  const root = await vault(t);
  const log = new AuditLog(root);
  await mkdir(join(root, ".bastra", "audit-log.ndjson"), { recursive: true });
  const stub = {
    get: () => undefined,
    pathsFor: () => [],
    forgetFile: () => {},
    reindexFile: async () => {},
  } as unknown as Vault;

  const { seen } = await collect(() =>
    auditedSave({ vault: stub, auditLog: log, vaultRoot: root, input: input(), context: { actor: "user" } }),
  );

  // Das ist die Zusage des Issues, und sie ist die einzige, die man nicht
  // nachträglich reparieren kann: Was einmal im Log steht, steht dort.
  const dump = JSON.stringify(seen);
  assert.equal(dump.includes("GEHEIMER-INHALT"), false, "kein Body im Event");
  assert.equal(dump.includes("geheime-zusammenfassung"), false, "kein Frontmatter-Wert im Event");
  assert.equal(dump.includes(root), false, "kein absoluter Pfad im Event");
});

test("ein Area-Konflikt meldet sich, statt nur zu werfen", async (t) => {
  const root = await vault(t);
  await mkdir(join(root, "memories", "projects", "proj"), { recursive: true });

  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let ready!: () => void;
  const acquired = new Promise<void>((r) => (ready = r));
  const holding = withAreaExclusive(root, ["proj"], () => {
    ready();
    return held;
  });
  await acquired;

  const { seen } = await collect(async () => {
    await assert.rejects(() => withAreaExclusive(root, ["proj"], async () => undefined));
  });

  release();
  await holding;

  const conflict = seen.find((i) => i.status === "conflict");
  assert.ok(conflict, `ein conflict-Incident muss ankommen, gesehen: ${JSON.stringify(seen)}`);
  assert.equal(conflict.op, "area_exclusive");
  assert.equal(conflict.phase, "area-claim");
});

test("ein Re-File, dessen Trash scheitert, meldet den Ausgang statt still zu bleiben", async (t) => {
  const root = await vault(t);
  const first = await saveMemory(root, input());

  // Den Trash unbenutzbar machen: `.bastra/trash` als DATEI statt als Ordner.
  // Damit scheitert das `mkdir` in der Trash-Primitive deterministisch — der
  // Publish ist da schon durch, also greift genau der Rollback-Pfad, den #377
  // sichtbar machen soll. Kein Zeitfenster, keine Flakiness.
  await mkdir(join(root, ".bastra"), { recursive: true });
  await writeFile(join(root, ".bastra", "trash"), "kein Ordner", "utf8");

  const { seen } = await collect(async () => {
    await assert.rejects(() =>
      saveMemory(root, input({ overwrite: true, folder: "memories/people" })),
    );
  });

  const incident = seen.find((i) => i.op === "save_memory_refile");
  assert.ok(incident, `ein Re-File-Incident muss ankommen, gesehen: ${JSON.stringify(seen)}`);
  assert.ok(
    incident.status === "rolled_back" || incident.status === "partial",
    `der Status muss den Ausgang benennen, war: ${incident.status}`,
  );
  assert.equal(incident.phase, "refile-trash");
  assert.equal(incident.memory_id, "m");
  // Und der Rollback sagt, wie weit er kam — das ist der Unterschied zwischen
  // "nichts passiert" und "zwei Dateien mit einer id".
  assert.ok(incident.rollback === "complete" || incident.rollback === "none");
  assert.ok(first.file_path.length > 0);
});
