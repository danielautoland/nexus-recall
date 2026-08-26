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
import { assertInsideVault, sameFile } from "./file-identity.js";
import type { Located, MemoryLocator } from "./memory-locator.js";
import { access, readFile, rename } from "node:fs/promises";
import matter from "gray-matter";
import { readOccupant, occupantOfRaw, scanVaultForIdAsync } from "./memory-locator.js";
import { readTarget } from "./save-commit.js";
import { withIdClaim } from "./id-transaction.js";

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
 *   1. Vorherige Memory-Frontmatter von der PLATTE holen (für diff_before).
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
  // Den Locator des Vaults mitgeben, sonst scannt `saveMemory` das
  // Dateisystem, obwohl der Index in der Hand liegt — und sieht `ambiguous`
  // nicht, das nur der Vault kennt.
  const locator = vaultAsLocator(vault);
  const target = resolveMemoryTarget(vaultRoot, input, locator);
  const candidateID = target.id;
  // Codex-Gegenreview (P1): Das Vorbild kam aus dem VAULT-CACHE, während die
  // Mutation daneben längst autoritativ von der Platte arbeitet. Nachgestellt,
  // beide Male mit einem Audit, das die falsche Datei beschreibt:
  //
  //   - Nach der Vault-Initialisierung erschien ein Memory extern im Vault.
  //     `auditedSave` aktualisierte es korrekt, protokollierte aber
  //     `diff_before: null` — im Trail steht „neu angelegt", auf der Platte
  //     wurde überschrieben.
  //   - Ein geladenes Memory wurde extern geändert. Im Audit stand danach die
  //     ALTE Cache-Fassung, überschrieben wurde die neue.
  //
  // Das Vorbild muss also von derselben Quelle kommen wie die Mutation.
  const preimage = await readSavePreimage(vaultRoot, candidateID, target.filePath, input.folder);
  const diffBefore = preimage.fm;

  const result = await saveMemory(vaultRoot, input, {
    locator,
    // Der Riegel gegen die verbleibende Lücke: Der Claim liegt INNERHALB von
    // `saveMemory`, das Vorbild wird also davor gelesen. Zwischen Lesen und
    // Lock kann die Datei sich ändern. `expectedTarget` ist genau dafür da —
    // stimmt der Stand unter dem Lock nicht mehr mit dem überein, den wir
    // gerade protokolliert haben, bricht der Save mit einem Write-Conflict ab,
    // statt eine Mutation mit einem falschen Vorbild ins Log zu schreiben.
    // Lieber ein lauter Konflikt als ein leiser Trail-Fehler.
    ...(preimage.guardable ? { expectedTarget: preimage.raw } : {}),
  });

  // Das Re-Filing selbst erledigt `saveMemory` unter der ID-Transaktion —
  // hier bleibt nur, den Index nachzuziehen. Vorher stand das Aufräumen hier
  // (und noch einmal in `tool-handlers.ts`), also NACH der Freigabe des Locks:
  // ein Absturz dazwischen hinterließ zwei aktive Dateien mit einer id.
  if (result.refiled_from !== undefined) {
    vault.forgetFile(result.refiled_from);
  }

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
 *   1. Memory im Vault-Cache nachschlagen (nur als Pfad-Hinweis für den Claim).
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

  // Codex-Gegenreview (P0): Gelöscht wurde der Pfad, den der CACHE nannte, ohne
  // ihn noch einmal anzusehen. Nachgestellt: Der Vault lädt `x`, die Datei wird
  // extern durch eine gewöhnliche Notiz ersetzt, `auditedSoftDelete("x")`
  // verschiebt die fremde Notiz in den Trash — und das Audit behauptet, Memory
  // `x` sei gelöscht worden. Ein Löschen ist eine besitzverändernde Operation,
  // also gehört es unter denselben Claim wie ein Schreiben, mit derselben
  // autoritativen Auskunft.
  return withIdClaim(
    { vaultRoot, id: memoryID, filePath: memory.filePath, op: "soft_delete" },
    async (claim) => {
      const located = await claim.locate();
      if (located.kind !== "unique") {
        throw new Error(
          located.kind === "none"
            ? `cannot delete "${memoryID}": no file on disk holds it (the index is stale).`
            : `cannot delete "${memoryID}": the vault scan is not conclusive (${located.kind}) — ` +
              `fix that first, deleting now would move the wrong file.`,
        );
      }
      // Codex-Gegenreview (P1): Das Vorbild kam weiter aus dem Cache, obwohl
      // die Lokalisierung daneben schon autoritativ war. Nachgestellt: Ein
      // geladenes Memory wurde extern geändert und danach gelöscht — im Trash
      // lag die NEUE Fassung, im Audit stand die ALTE. Gelesen wird deshalb
      // die Datei, die gleich in den Trash wandert, unter demselben Claim.
      //
      // Fällt das Lesen aus (die Datei verschwand zwischen Scan und Read, oder
      // der Mount hakt), bleibt der Cache-Stand als schwächere Auskunft besser
      // als gar keine — die volle Wahrheit liegt dann ohnehin in der
      // Trash-Kopie, die `moveToTrash` gleich anlegt.
      const onDisk = await readFrontmatter(located.filePath);
      return commitSoftDelete({
        vault,
        auditLog,
        vaultRoot,
        memoryID,
        originalPath: located.filePath,
        diffBefore: onDisk ?? cloneFrontmatter(memory.fm),
        context,
      });
    },
  );
}

/** Der schreibende Teil des Löschens — unter dem Claim, auf dem autoritativ
 *  ermittelten Pfad. */
async function commitSoftDelete(a: {
  vault: Vault;
  auditLog: AuditLog;
  vaultRoot: string;
  memoryID: string;
  originalPath: string;
  diffBefore: Record<string, unknown>;
  context: AuditContext;
}): Promise<{ id: string; trashPath: string; audit: AuditEntry }> {
  const { vault, auditLog, vaultRoot, memoryID, originalPath, diffBefore, context } = a;
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
  /** Nur noch für Aufrufer, die den Index danach selbst auffrischen wollen —
   *  die BESITZPRÜFUNG hängt nicht mehr daran. Codex-Gegenreview (P0): Fehlte
   *  der Vault, wurde sie vollständig übersprungen, und ein Restore legte
   *  neben einem inzwischen wieder aktiven Memory derselben id eine zweite
   *  Datei an. Ein optionaler Sicherheitsgurt ist kein Sicherheitsgurt. */
  vault?: Vault;
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
  assertInsideVault(vaultRoot, dest, "restore");

  // Ab hier unter der ID-Transaktion: Besitzprüfung und Veröffentlichung
  // sehen denselben Vault, und kein anderer Writer kann die id dazwischen
  // belegen.
  return withIdClaim({ vaultRoot, id: memoryID, filePath: dest, op: "restore" }, async (claim) => {
    // Codex-Gegenreview: Geprüft wurde nur der ZIELPFAD, und die Frage „lebt
    // diese id inzwischen woanders?" hing an einem optionalen Index. Beides
    // ersetzt der autoritative Plattenscan unter dem Lock: Ein prozessübergreifend
    // veralteter Index konnte `none` melden, während die id längst wieder lebte.
    const located = await claim.locate();
    if (located.kind === "incomplete") {
      throw new Error(
        `cannot restore "${memoryID}": the vault scan could not read ` +
          `${located.unreadable.join(", ")} — restoring now could create a second file ` +
          `with the same id. Fix the permissions first.`,
      );
    }
    const live = located.kind === "unique"
      ? [located.filePath]
      : located.kind === "ambiguous"
        ? located.filePaths
        : [];
    const stillElsewhere = live.filter((p) => !sameFile(p, dest));
    if (stillElsewhere.length > 0) {
      throw new Error(
        `cannot restore "${memoryID}": it is already live at ${stillElsewhere.join(", ")}. ` +
          `Restoring would put a second file with the same id into the vault — archive or move ` +
          `the existing one first, or restore to that exact path to replace it.`,
      );
    }

    return publishRestore({ auditLog, vaultRoot, memoryID, trashFile, dest, lastDelete, context });
  });
}

/** Der Teil des Restores, der schreibt — abgetrennt, damit die Prüfungen oben
 *  lesbar bleiben und der Rumpf vollständig unter dem Claim steht. */
async function publishRestore(a: {
  auditLog: AuditLog;
  vaultRoot: string;
  memoryID: string;
  trashFile: string;
  dest: string;
  lastDelete: AuditEntry;
  context: AuditContext;
}): Promise<{ id: string; restoredTo: string; audit: AuditEntry }> {
  const { auditLog, vaultRoot, memoryID, trashFile, dest, lastDelete, context } = a;
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
 * Das Vorbild eines Saves — von der PLATTE, aus derselben Datei, die
 * `saveMemory` gleich anfassen wird.
 *
 * Warum nicht der Vault-Index: Er darf prozessübergreifend veraltet sein, und
 * genau daraus entstanden die beiden Fehl-Audits oben. Die Frage „welche Datei
 * trägt diese id" beantwortet deshalb derselbe Scan, den auch die
 * ID-Transaktion stellt.
 *
 * Welche Datei das Vorbild ist, folgt Zug um Zug den Regeln in `commitMemory`:
 *
 *   - Sagt der Scan `unique`, ist DIESE Datei die Vorlage. Ohne ausdrücklichen
 *     `folder` routet der Save ohnehin dorthin (die Platte gewinnt gegen einen
 *     abgeleiteten Pfad); mit `folder` ist sie die Re-Filing-Quelle, aus der
 *     `saveMemory` sein `prev`-Frontmatter patcht.
 *   - Sagt er nichts (`none`), bleibt der aufgelöste Zielpfad. Liegt dort
 *     nichts, ist das Vorbild `null` — und `result.created` bestätigt es.
 *   - `ambiguous`/`incomplete` sind Vault-Defekte; `saveMemory` bricht darauf
 *     ab, hier wird nur nichts behauptet.
 *
 * Preis: ein zweiter vaultweiter Scan je audit-behaftetem Save, zusätzlich zu
 * dem unter dem Lock. Das ist der Betrag, den ein Audit kostet, der die Datei
 * beschreibt, die wirklich mutiert wurde; billiger geht es erst, wenn
 * `saveMemory` sein unter dem Claim gelesenes Vorbild selbst zurückgibt (siehe
 * `guardable`).
 */
async function readSavePreimage(
  vaultRoot: string,
  id: string,
  resolvedPath: string,
  folder: string | undefined,
): Promise<{
  path: string;
  raw: string | null;
  fm: Record<string, unknown> | null;
  /** Deckt sich das Vorbild mit dem ZIELPFAD des Saves? Nur dann lässt sich
   *  `expectedTarget` als Riegel benutzen: Es prüft das Ziel, nicht die
   *  Re-Filing-Quelle. Beim ausdrücklichen Umzug in ein anderes Regal bleibt
   *  deshalb ein Restfenster — die Quelle kann sich zwischen diesem Lesen und
   *  dem Claim ändern. Vollständig schließen ließe es sich nur in `save.ts`. */
  guardable: boolean;
}> {
  const located = await scanVaultForIdAsync(vaultRoot, id);
  const onDisk = located.kind === "unique" ? located.filePath : null;
  const path = onDisk ?? resolvedPath;
  // `readTarget` statt eines eigenen Reads: dieselbe Fail-closed-Semantik wie
  // im Save (nur ENOENT heißt „nichts da", alles andere wirft) und exakt die
  // Bytes, gegen die `expectedTarget` gleich verglichen wird.
  const raw = await readTarget(path);
  // Die Identität aus DENSELBEN Bytes ableiten, aus denen auch das Vorbild
  // kommt: Eine fremde Notiz am Zielpfad ist kein Vorbild dieses Memories
  // (`saveMemory` lehnt sie ohnehin ab), und ihr Frontmatter im Audit wäre eine
  // Behauptung über eine Datei, die nie zu dieser id gehörte.
  const isThisMemory =
    raw !== null && (() => {
      const occupant = occupantOfRaw(raw, path);
      return occupant.kind === "memory" && occupant.id === id;
    })();
  const targetPath = folder === undefined ? path : resolvedPath;
  return {
    path,
    raw,
    fm: isThisMemory ? ((matter(raw!).data as Record<string, unknown>) ?? null) : null,
    guardable: sameFile(path, targetPath),
  };
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

/** Der Vault als {@link MemoryLocator} — inklusive der Dateien, die er wegen
 *  derselben id quarantäniert hat. `get()` allein verschweigt sie, und ein
 *  Save auf die eine ließe die andere unverändert stehen (#240/A2.3). */
function vaultAsLocator(vault: Vault): MemoryLocator {
  return {
    locate(id: string): Located {
      const paths = vault.pathsFor(id);
      if (paths.length === 0) return { kind: "none" };
      if (paths.length === 1) return { kind: "unique", filePath: paths[0] };
      return { kind: "ambiguous", filePaths: paths };
    },
  };
}

