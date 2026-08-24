import { mkdir, appendFile, rename, readdir, stat, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";

/**
 * Audit-Log: jede Memory-Mutation wird als JSON-Zeile in
 * `<vault>/.bastra/audit-log.ndjson` festgehalten.
 *
 * Append-only — keine Datei wird je überschrieben oder gekürzt. Die
 * `.bastra/` Dotfolder wird vom Vault-Watcher ignoriert (siehe vault.ts),
 * deshalb kann sie sicher im Vault-Root liegen ohne Index-Pollution.
 *
 * Datenfluss:
 *   saveMemory / softDeleteMemory / restoreMemory  (Caller, z.B. bridge.ts)
 *       └─→  AuditLog.record(...)
 *               └─→  appendFile(.bastra/audit-log.ndjson)
 *
 * Lese-API (forMemory / since) lädt das ganze File und filtert in-memory.
 * Bei Vaults mit zigtausend Mutationen kann das später durch einen
 * Index ersetzt werden — für heute (low-volume) reicht NDJSON-Scan.
 */

export type AuditOperation = "create" | "update" | "delete" | "restore";

export type AuditActor = "user" | "assistant" | "system" | "import";

export interface AuditEntry {
  /** Eindeutige Audit-Eintrag-ID — `<timestamp-ms>-<rand>`. */
  id: string;
  memory_id: string;
  /** ISO-8601 timestamp mit Millisekunden. */
  timestamp: string;
  actor: AuditActor;
  /** Optional: User-/Session-/Tool-Bezeichner (z.B. Mac-App vs. Claude-Code-Hook). */
  actor_detail?: string;
  operation: AuditOperation;
  /** Frontmatter-Snapshot vor der Mutation (null bei `create`). */
  diff_before: Record<string, unknown> | null;
  /** Frontmatter-Snapshot nach der Mutation (null bei `delete`). */
  diff_after: Record<string, unknown> | null;
  /**
   * Original-Pfad der Memory-Datei. Bei `delete` der Pfad VOR dem Move in den
   * Trash — den wir beim Restore brauchen. Bei `create`/`update` der finale
   * Pfad nach Save.
   */
  file_path?: string;
  /** Pflicht für `assistant`-Mutationen — kurzer Klartext-Grund (1-2 Sätze). */
  reason?: string;
  /** Korreliert mit Telemetry-session-id (UUID v4). */
  session_id?: string;
}

const AUDIT_DIR = ".bastra";
const AUDIT_FILE = "audit-log.ndjson";

export class AuditLog {
  private cache: AuditEntry[] | null = null;
  /** `<mtimeMs>:<size>` der Datei, aus der `cache` stammt — siehe `readAll()`. */
  private cacheKey: string | null = null;

  constructor(public readonly vaultRoot: string) {}

  // ─── public API ───────────────────────────────────────────────

  /** Schreibt einen neuen Audit-Eintrag und invalidiert den Lese-Cache. */
  async record(input: Omit<AuditEntry, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: input.id ?? makeAuditID(),
      memory_id: input.memory_id,
      timestamp: input.timestamp ?? new Date().toISOString(),
      actor: input.actor,
      ...(input.actor_detail ? { actor_detail: input.actor_detail } : {}),
      operation: input.operation,
      diff_before: input.diff_before,
      diff_after: input.diff_after,
      ...(input.file_path ? { file_path: input.file_path } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.session_id ? { session_id: input.session_id } : {}),
    };

    const filePath = this.filePath();
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
    this.cache = null;
    this.cacheKey = null;
    return entry;
  }

  /**
   * Alle Einträge (sortiert nach Timestamp aufsteigend), lazy geladen.
   *
   * Das Ledger ist cross-process: Daemon, Bridge und CLI schreiben in
   * dieselbe Datei. Ein Cache, der nur an der Lebensdauer der Instanz hängt,
   * sieht fremde Appends nie — `lastDeleteFor()` findet dann einen Delete
   * nicht, der in der Datei steht, und ein einmal leer gelesenes Log bleibt
   * für den ganzen Prozess leer. Deshalb ist der Cache am Datei-Stand
   * (`mtimeMs` + `size`) gekeyt: ein `stat()` pro Read statt eines
   * Full-Reread, und bei unveränderter Datei trifft der Cache weiterhin.
   */
  async readAll(): Promise<AuditEntry[]> {
    const filePath = this.filePath();
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(filePath, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        // Nur ENOENT heißt „die Datei ist nicht da". Ein EIO-/EACCES-Blip auf
        // einem Netz- oder Cloud-Mount ist ein LESEFEHLER — dafür einen
        // gültigen Cache wegzuwerfen macht daraus ein falsches Ergebnis:
        // `lastDeleteFor()` gäbe undefined zurück und `auditedRestore` würfe
        // `no delete audit-entry found` für einen Delete, der in der Datei
        // steht. Warm weiterliefern; kalt ehrlich scheitern, statt ein
        // unlesbares Ledger als leeres auszugeben.
        if (this.cache) return this.cache;
        throw err;
      }
      // Datei (noch) nicht vorhanden — bewusst NICHT cachen, sonst bleibt
      // ein Create aus einem anderen Prozess dauerhaft unsichtbar.
      this.cache = null;
      this.cacheKey = null;
      return [];
    }
    // stat + read über denselben Filehandle statt getrennt über den Pfad —
    // ein Replace/Rename zwischen den beiden Schritten kann die Datei unter
    // uns nicht mehr wegziehen (TOCTOU).
    try {
      const st = await handle.stat();
      const key = `${st.mtimeMs}:${st.size}`;
      if (this.cache && this.cacheKey === key) return this.cache;
      const raw = await handle.readFile("utf8");
      const out: AuditEntry[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          out.push(JSON.parse(trimmed) as AuditEntry);
        } catch {
          // Korrupte Zeile ignorieren — append-only-Log darf nicht abbrechen.
        }
      }
      out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      this.cache = out;
      this.cacheKey = key;
      return out;
    } finally {
      await handle.close();
    }
  }

  /** Alle Einträge zu einer bestimmten Memory-ID, neueste zuerst. */
  async forMemory(memoryID: string): Promise<AuditEntry[]> {
    const all = await this.readAll();
    return all.filter((e) => e.memory_id === memoryID).reverse();
  }

  /** Einträge ab einem Timestamp, optional gefiltert nach actor/operation. */
  async since(
    sinceISO: string,
    filters: { actor?: AuditActor; operation?: AuditOperation } = {},
  ): Promise<AuditEntry[]> {
    const all = await this.readAll();
    return all
      .filter((e) => e.timestamp >= sinceISO)
      .filter((e) => !filters.actor || e.actor === filters.actor)
      .filter((e) => !filters.operation || e.operation === filters.operation)
      .reverse();
  }

  /** Letzter `delete`-Eintrag einer Memory — für Restore. */
  async lastDeleteFor(memoryID: string): Promise<AuditEntry | undefined> {
    const all = await this.forMemory(memoryID);
    return all.find((e) => e.operation === "delete");
  }

  // ─── internals ────────────────────────────────────────────────

  private filePath(): string {
    return join(this.vaultRoot, AUDIT_DIR, AUDIT_FILE);
  }
}

function makeAuditID(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}-${r}`;
}

// ─── Trash-Folder helpers ─────────────────────────────────────────
//
// Soft-Delete: Memory-File wird nach `<vault>/.bastra/trash/<id>.md`
// verschoben. Der Watcher sieht ein "unlink" und entfernt aus dem Index.
// Restore kann die Datei aus dem Trash zurückmoven.

const TRASH_DIR = "trash";

export function trashPathFor(vaultRoot: string, id: string): string {
  const trashRoot = join(vaultRoot, AUDIT_DIR, TRASH_DIR);
  const dest = join(trashRoot, `${id}.md`);
  // The id comes from file frontmatter — a crafted `id: ../../x` must not
  // turn the soft-delete rename into a write outside the trash folder.
  if (!resolve(dest).startsWith(resolve(trashRoot) + sep)) {
    throw new Error(`refusing trash path outside the trash folder for id: ${id}`);
  }
  return dest;
}

/**
 * #240/A4: Trash-Ziele sind versioniert. `trashPathFor()` liefert immer
 * denselben Pfad, ein zweites Löschen derselben id überschrieb also die
 * ältere Trash-Version per rename — still und unwiederbringlich. Das
 * widerspricht der Zusage "recoverable — never a hard delete".
 *
 * Der Basis-Pfad `<id>.md` bleibt der erste Wurf (damit bestehende Trash-
 * Dateien und `lastDeleteFor()`-Lookups weiter funktionieren); jede weitere
 * Version bekommt einen Zeitstempel-Suffix.
 */
async function uniqueTrashPath(vaultRoot: string, id: string): Promise<string> {
  const base = trashPathFor(vaultRoot, id);
  if (!existsSync(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const versioned = base.replace(/\.md$/, `.${stamp}.md`);
  if (!existsSync(versioned)) return versioned;
  // Zwei Löschungen derselben id in derselben Millisekunde — Zähler dran.
  for (let n = 2; n < 1000; n++) {
    const candidate = base.replace(/\.md$/, `.${stamp}-${n}.md`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`could not find a free trash path for id: ${id}`);
}

/**
 * Das Suffix, das `uniqueTrashPath()` an den Basis-Pfad hängt:
 * `2026-08-23T16-20-37-857Z`, bei Kollision in derselben Millisekunde
 * zusätzlich `-<n>`.
 */
const TRASH_VERSION_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?$/;

/**
 * Neueste Trash-Fassung einer id. Nötig, seit `moveToTrash` versioniert:
 * der Basis-Pfad `<id>.md` ist dann die ÄLTESTE Fassung, und ein Restore,
 * der stur `trashPathFor()` nimmt, holte die falsche zurück.
 */
export async function latestTrashPathFor(
  vaultRoot: string,
  id: string,
): Promise<string | undefined> {
  const base = trashPathFor(vaultRoot, id);
  const trashRoot = dirname(base);
  let entries: string[];
  try {
    entries = await readdir(trashRoot);
  } catch {
    return undefined;
  }
  const baseName = `${id}.md`;
  const versionPrefix = `${id}.`;
  // Ein reines `startsWith(`${id}.`)` matcht über die id-Grenze hinweg: für
  // die id `foo` sah `foo.bar.md` wie eine Zeitstempel-Version von `foo` aus,
  // und ein Restore hätte den Trash-Stand von `foo.bar` auf `foo`s
  // Originalpfad zurückgeschrieben. Gepunktete ids entstehen zwar nie aus
  // `slugify()`, wohl aber aus hand- oder fremdgeschriebenem `id:`-
  // Frontmatter. Der Rest hinter der id muss deshalb exakt das von
  // `uniqueTrashPath()` erzeugte Stempel-Format tragen — über `slice()`
  // geprüft, damit die id selbst nicht escaped werden muss.
  const candidates = entries.filter((e) => {
    if (e === baseName) return true;
    if (!e.startsWith(versionPrefix) || !e.endsWith(".md")) return false;
    return TRASH_VERSION_STAMP.test(e.slice(versionPrefix.length, -".md".length));
  });
  if (candidates.length === 0) return undefined;
  const withTime = await Promise.all(
    candidates.map(async (name) => {
      const full = join(trashRoot, name);
      try {
        return { full, mtime: (await stat(full)).mtimeMs };
      } catch {
        return { full, mtime: -1 };
      }
    }),
  );
  withTime.sort((a, b) => b.mtime - a.mtime);
  return withTime[0].full;
}

export async function moveToTrash(
  vaultRoot: string,
  filePath: string,
  id: string,
): Promise<string> {
  const dest = await uniqueTrashPath(vaultRoot, id);
  await mkdir(dirname(dest), { recursive: true });
  await rename(filePath, dest);
  return dest;
}

export async function restoreFromTrash(
  vaultRoot: string,
  trashFile: string,
  destFile: string,
): Promise<void> {
  // #240/A4: ein blankes rename() überschrieb eine bereits wieder aktive
  // Datei am Zielpfad — beobachtet: eine laufende Bearbeitung wurde still
  // durch den Trash-Stand ersetzt. Restore darf niemals Daten vernichten;
  // der Konflikt gehört dem Caller gemeldet, nicht weggeschrieben.
  if (existsSync(destFile)) {
    throw new Error(
      `refusing to restore over an existing file: ${destFile}. ` +
        `Move or delete it first — restoring would overwrite the active version.`,
    );
  }
  await mkdir(dirname(destFile), { recursive: true });
  await rename(trashFile, destFile);
}
