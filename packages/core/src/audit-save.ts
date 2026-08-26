import { z } from "zod";
import { saveMemory } from "./save.js";
import { resolveMemoryTarget } from "./save-target.js";
import type { SaveMemoryInput, SaveMemoryResult } from "./save-schema.js";
import {
  AuditLog,
  type AuditEntry,
  moveToTrash,
  restoreFromTrash,
  latestTrashPathFor,
} from "./audit-log.js";
import type { Vault } from "./vault.js";
import { access, readFile, realpath, rename } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import matter from "gray-matter";
import { readOccupant } from "./memory-locator.js";

/**
 * Audit-Kontext, den jeder Caller (bridge.ts, index.ts) mitgibt — beschreibt
 * WER die Mutation veranlasst hat. Wird im Audit-Log gespeichert, geht aber
 * NICHT in die Memory-Frontmatter (saubere Trennung CRUD ↔ Audit).
 */
export const AuditContext = z.object({
  actor: z.enum(["user", "assistant", "system", "import"]),
  actor_detail: z.string().optional(),
  reason: z.string().optional(),
  session_id: z.string().optional(),
});
export type AuditContext = z.infer<typeof AuditContext>;

/**
 * Save mit Audit-Trail.
 *
 *   1. Vorherige Memory-Frontmatter holen (für diff_before).
 *   2. Validation: Assistant-Mutationen brauchen `reason` (1-2 Sätze).
 *   3. saveMemory ausführen.
 *   4. AuditLog.record() mit before/after.
 */
export async function auditedSave(args: {
  vault: Vault;
  auditLog: AuditLog;
  vaultRoot: string;
  input: SaveMemoryInput;
  context: AuditContext;
}): Promise<{ result: SaveMemoryResult; audit: AuditEntry }> {
  const { vault, auditLog, vaultRoot, input, context } = args;

  if (context.actor === "assistant" && !context.reason?.trim()) {
    throw new Error(
      "assistant mutations require a `reason` (1-2 sentences explaining the change).",
    );
  }

  // Bestehenden Zustand erfassen (vor dem Schreiben), damit diff_before
  // korrekt ist. Die id muss dabei genauso abgeleitet werden wie in
  // saveMemory selbst (#240/C6, gleiche Wurzel wie #239): auf dem Normalpfad
  // schickt der Caller nur den Titel, `input.id` ist undefined. Vorher wurde
  // deshalb JEDER slug-inferred Overwrite als `create` mit `diff_before: null`
  // auditiert — das Vorbild eines destruktiven Overwrites war damit weg und
  // die Mutation aus dem Trail nicht rekonstruierbar.
  // Codex-Gegenreview: `canonicalMemoryId` allein reichte hier nicht — eine
  // Bestands-Datei mit roher Groß-id wurde unter der kanonischen id gesucht
  // und nicht gefunden, also jeder Overwrite darauf als `create` mit
  // `diff_before: null` auditiert. `resolveMemoryTarget` kennt den
  // Bestandsschutz und nennt genau die id, die gleich geschrieben wird.
  const candidateID = resolveMemoryTarget(vaultRoot, input).id;
  const existing = vault.get(candidateID);
  const diffBefore = existing ? cloneFrontmatter(existing.fm) : null;

  const result = await saveMemory(vaultRoot, input);

  // diff_after: aus dem result-Pfad lesen — Vault-Watcher hatte vielleicht
  // noch keine Zeit zum Re-Indexen.
  const diffAfter = await readFrontmatter(result.file_path);

  const audit = await auditLog.record({
    memory_id: result.id,
    actor: context.actor,
    actor_detail: context.actor_detail,
    // Ground truth statt Vorab-Lookup: saveMemory prüft die Existenz am
    // tatsächlichen Zielpfad und meldet sie in `created` zurück.
    operation: result.created ? "create" : "update",
    diff_before: diffBefore,
    diff_after: diffAfter,
    file_path: result.file_path,
    reason: context.reason,
    session_id: context.session_id,
  });

  return { result, audit };
}

/**
 * Soft-Delete mit Audit-Trail.
 *
 *   1. Memory aus Vault-Cache holen (für diff_before + filePath).
 *   2. File nach <vault>/.bastra/trash/<id>.md verschieben.
 *   3. AuditLog.record() mit operation=delete.
 *
 * Hard-Delete (Forget-Tool, Block 2) hat einen eigenen Pfad und sollte den
 * Trash-Folder umgehen.
 */
export async function auditedSoftDelete(args: {
  vault: Vault;
  auditLog: AuditLog;
  vaultRoot: string;
  memoryID: string;
  context: AuditContext;
}): Promise<{ id: string; trashPath: string; audit: AuditEntry }> {
  const { vault, auditLog, vaultRoot, memoryID, context } = args;

  const memory = vault.get(memoryID);
  if (!memory) {
    throw new Error(`memory not found in vault: ${memoryID}`);
  }
  if (context.actor === "assistant" && !context.reason?.trim()) {
    throw new Error(
      "assistant deletes require a `reason` (1-2 sentences explaining the change).",
    );
  }

  const diffBefore = cloneFrontmatter(memory.fm);
  const originalPath = memory.filePath;
  const trashPath = await moveToTrash(vaultRoot, originalPath, memoryID);
  // Codex-Befund 5: Die Datei war weg, der Index-Eintrag blieb. Auf einem
  // Cloud-Mount pollt der Watcher (Intervall 1500ms) und bekommt den unlink
  // eines Provider-Mounts oft überhaupt nicht mit — bis zum nächsten Reconcile
  // oder Neustart lieferte der Recall damit ein Memory aus, das auf der Platte
  // schon im Trash lag. Weder der Bridge- noch der MCP-Pfad räumte auf; die
  // Eviction gehört deshalb hierher, in die Mutation selbst.
  vault.forgetFile(originalPath);

  const audit = await auditLog.record({
    memory_id: memoryID,
    actor: context.actor,
    actor_detail: context.actor_detail,
    operation: "delete",
    diff_before: diffBefore,
    diff_after: null,
    file_path: originalPath, // Wohin der Restore zurückmoven soll.
    reason: context.reason,
    session_id: context.session_id,
  });

  return { id: memoryID, trashPath, audit };
}

/**
 * Restore aus dem Trash.
 *
 *   1. Letzten `delete`-Audit-Eintrag der Memory finden.
 *   2. Trash-File ermitteln.
 *   3. Original-Pfad rekonstruieren aus diff_before.
 *   4. File zurückmoven.
 *   5. Audit-Eintrag operation=restore mit diff_before=null/diff_after=alt.
 */
export async function auditedRestore(args: {
  auditLog: AuditLog;
  vaultRoot: string;
  memoryID: string;
  /** Optional: bestimmten Original-Pfad erzwingen (Power-User). */
  destFilePath?: string;
  context: AuditContext;
}): Promise<{ id: string; restoredTo: string; audit: AuditEntry }> {
  const { auditLog, vaultRoot, memoryID, destFilePath, context } = args;

  const lastDelete = await auditLog.lastDeleteFor(memoryID);
  if (!lastDelete) {
    throw new Error(`no delete audit-entry found for memory: ${memoryID}`);
  }

  // Neueste Fassung, nicht den Basis-Pfad: seit #240/A4 versioniert
  // moveToTrash, damit ein zweites Löschen die erste Trash-Version nicht
  // still überschreibt — `<id>.md` ist dann die älteste, nicht die jüngste.
  const trashFile = await latestTrashPathFor(vaultRoot, memoryID);
  if (!trashFile || !(await fileExists(trashFile))) {
    throw new Error(`trashed file missing for memory: ${memoryID}`);
  }

  // Zielpfad: vom Caller bevorzugt, sonst aus dem letzten Delete-Audit-Eintrag.
  const dest = destFilePath ?? lastDelete.file_path;
  if (!dest) {
    throw new Error(
      `restore needs an explicit destFilePath — the original path is missing in the audit-log.`,
    );
  }

  // Codex-Befund 6a: `destFilePath` kam ungeprüft vom Caller — ein Restore in
  // ein Geschwisterverzeichnis NEBEN dem Vault funktionierte. Geprüft wird
  // über realpath, nicht über den Textpfad: Cloud-Mounts liegen im Vault
  // regelmäßig als Symlink, und `~/vault/elsewhere/x.md` kann irgendwo hin
  // zeigen, während der String brav mit dem Vault-Pfad beginnt.
  await assertInsideVault(vaultRoot, dest);

  await restoreFromTrash(vaultRoot, trashFile, dest);

  // Codex-Befund 6b: Was zurückkam, wurde nie gegen die angeforderte id
  // geprüft. Ein von Hand angefasster oder per Sync-Konflikt ersetzter
  // Trash-Stand landete damit unter fremdem Namen am Originalpfad — und der
  // Reindex direkt danach hätte ihn als diese Memory in den Index gehoben.
  const occupant = readOccupant(dest);
  if (occupant.kind !== "memory" || occupant.id !== memoryID) {
    // Zurückrollen, statt die falsche Datei im Vault liegen zu lassen.
    await rename(dest, trashFile).catch(() => {});
    const found = occupant.kind === "memory" ? `"${occupant.id}"` : "no memory at all";
    throw new Error(
      `the trashed file for "${memoryID}" does not hold memory "${memoryID}" (found ${found}) — ` +
        `restore aborted, the trash file is untouched.`,
    );
  }

  const audit = await auditLog.record({
    memory_id: memoryID,
    actor: context.actor,
    actor_detail: context.actor_detail,
    operation: "restore",
    diff_before: null,
    diff_after: lastDelete.diff_before,
    file_path: dest,
    reason: context.reason,
    session_id: context.session_id,
  });

  return { id: memoryID, restoredTo: dest, audit };
}

// ─── helpers ────────────────────────────────────────────────────

/**
 * Der Zielpfad muss REAL im Vault liegen. Der Pfad selbst existiert beim
 * Restore noch nicht, also wird der tiefste bereits existierende Vorfahre
 * aufgelöst und der Rest wieder angehängt — so hilft ein Symlink auf halbem
 * Weg nicht mehr aus dem Vault heraus.
 */
async function assertInsideVault(vaultRoot: string, dest: string): Promise<void> {
  const vaultReal = await realpath(vaultRoot);
  const destReal = await realpathOfNearestExisting(dest);
  if (destReal !== vaultReal && !destReal.startsWith(vaultReal + sep)) {
    throw new Error(
      `refusing to restore outside the vault: ${dest} resolves to ${destReal}, ` +
        `which is not inside ${vaultReal}.`,
    );
  }
}

async function realpathOfNearestExisting(p: string): Promise<string> {
  const tail: string[] = [];
  let probe = resolve(p);
  for (;;) {
    let real: string | undefined;
    try {
      real = await realpath(probe);
    } catch {
      real = undefined;
    }
    if (real !== undefined) return tail.length === 0 ? real : join(real, ...tail);
    const parent = dirname(probe);
    // Bei der Wurzel angekommen, ohne dass irgendetwas existierte.
    if (parent === probe) return resolve(p);
    tail.unshift(basename(probe));
    probe = parent;
  }
}


function cloneFrontmatter(fm: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
}

async function readFrontmatter(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = matter(raw);
    return parsed.data as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
