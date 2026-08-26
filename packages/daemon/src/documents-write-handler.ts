/**
 * Document-Hub WRITE Tools — `save_document`/`recategorize_document`/
 * `move_document`. Triage Issue #24:
 *
 * - Pro-Feature: Triage will diese hinter Lizenz-Gate. Bis das Pro-License-
 *   Service da ist (separates Issue), gaten wir mit env-Flag
 *   `BASTRA_DOCUMENT_WRITE=1` (Legacy: `NEXUS_DOCUMENT_WRITE`). Tool-Liste
 *   wird komplett ausgeblendet wenn das Flag fehlt — externe MCP-Caller
 *   sehen nur Read-Tools.
 *
 * - Cloud-Watcher-Mitigation: Schreib-Pfad reagiert NICHT auf chokidar
 *   (unzuverlässig auf GoogleDrive/iCloud). Stattdessen sofortiger
 *   `vault.reindexFile(sidecarPath)` nach jedem Write — analog zum
 *   `save_memory`-Pattern. Damit ist `save+find im selben Turn` zuverlässig.
 *   Triage-Acceptance: erfüllt.
 */
import {
  writeFile,
  readFile,
  mkdir,
  copyFile,
  unlink,
  stat,
  rename,
  access,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, basename, isAbsolute, resolve, sep } from "node:path";
import { z } from "zod";
import matter from "gray-matter";
import type { Vault } from "@bastra-recall/core";
import { readOccupant } from "@bastra-recall/core";
import {
  scanForInjection,
  injectionCategories,
  formatInjectionAdvisory,
} from "@bastra-recall/core";
import { truncateSummaryTo, SUMMARY_MAX } from "@bastra-recall/core";
import { scopeEquals } from "@bastra-recall/core/scope";

// ─── Argument schemas ───────────────────────────────────────────

const documentCategoryEnum = z.enum([
  "vertrag",
  "rechnung",
  "notiz",
  "code",
  "bild",
  "sonstiges",
]);

export const SaveDocumentArgs = z.object({
  /** Absoluter Pfad der Original-Datei (z.B. ~/Downloads/Vertrag.pdf). */
  original_path: z.string().min(1),
  /** Folder relativ zu `<vault>/documents/`. Leer-String = Root. */
  folder_path: z.string().default(""),
  title: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  category: documentCategoryEnum,
  /**
   * Wenn true bleibt die Originaldatei am Quellort, das Sidecar trägt nur
   * den Verweis. Default false: Datei wird in `<vault>/documents/<folder>`
   * kopiert.
   */
  linked_file: z.boolean().default(false),
  /** Optional: extrahierter Plain-Text-Body des Sidecars. */
  body: z.string().optional(),
  /**
   * Optional: 1-Satz-Summary. Default = title-based.
   * Kein `.max` hier (analog `save_memory`): eine über-lange Summary wird
   * beim Build codepoint-sicher an der Wortgrenze geclampt, nie rejected —
   * ein `too_big`-Error würde den Caller in einen Retry-Roundtrip zwingen.
   */
  summary: z.string().optional(),
  /** Optional: zusätzliche Recall-Trigger. Default = title + tags. */
  recall_when: z.array(z.string()).optional(),
  /** Default false: existierender Document-Eintrag wirft Fehler. */
  overwrite: z.boolean().default(false),
});

export const RecategorizeDocumentArgs = z.object({
  id: z.string().min(1),
  /** Neuer Folder-Pfad. Wenn gesetzt, wird `move_document`-Logik mitgemacht. */
  folder_path: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: documentCategoryEnum.optional(),
  /**
   * Phase 3.2: wenn das Sidecar extern editiert wurde, blockiert der Daemon
   * den Update. `force=true` überschreibt das Veto explizit.
   */
  force: z.boolean().optional(),
});

export const MoveDocumentArgs = z.object({
  id: z.string().min(1),
  folder_path: z.string().min(1),
});

// ─── Tool definitions ───────────────────────────────────────────

export const documentWriteTools = [
  {
    name: "save_document",
    description:
      "Persist a new document into the user's vault: copy (or link) the " +
      "original file and write a sidecar with frontmatter for retrieval. " +
      "Pair with find_document/read_document afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        original_path: {
          type: "string",
          description: "Absolute path to the source file.",
        },
        folder_path: {
          type: "string",
          description:
            "Target folder relative to documents-root (e.g. 'Verträge/2026'). Empty = root.",
        },
        title: { type: "string", description: "Concise human-readable title." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "1–5 retrieval tags.",
        },
        category: {
          type: "string",
          enum: documentCategoryEnum.options,
          description: "Document category.",
        },
        linked_file: {
          type: "boolean",
          description: "If true, do not copy — keep original at source path.",
        },
        body: { type: "string", description: "Optional extracted plain-text." },
        summary: {
          type: "string",
          description: "Optional 1-sentence summary (<=400 chars).",
        },
        overwrite: {
          type: "boolean",
          description: "If true, replace existing document with same id.",
        },
      },
      required: ["original_path", "title", "tags", "category"],
    },
  },
  {
    name: "recategorize_document",
    description:
      "Update folder, title, tags or category of an existing document. " +
      "Refuses to overwrite externally edited sidecars unless force=true.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document id (slug)." },
        folder_path: {
          type: "string",
          description: "New folder relative to documents-root.",
        },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        category: { type: "string", enum: documentCategoryEnum.options },
        force: {
          type: "boolean",
          description:
            "If true, override the conflict-detection veto (use when the user explicitly accepts losing the external edit).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "move_document",
    description:
      "Move a document (original + sidecar) into a different folder. " +
      "The id stays stable; only paths and folder_path-frontmatter change.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document id (slug)." },
        folder_path: {
          type: "string",
          description: "Target folder relative to documents-root.",
        },
      },
      required: ["id", "folder_path"],
    },
  },
];

// ─── Helpers ────────────────────────────────────────────────────

const DOCUMENTS_ROOT = "documents";
const SLUG_MAX_LEN = 80;

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN);
  if (!slug) throw new Error(`cannot slugify: ${JSON.stringify(input)}`);
  return slug;
}

function makeDocId(folderPath: string, filename: string): string {
  const combined = folderPath ? `${folderPath}/${filename}` : filename;
  return `doc-${slugify(combined)}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isCloudMount(path: string): boolean {
  return /(CloudStorage|Dropbox|iCloud)/i.test(path);
}

function vaultRoot(vault: Vault): string {
  return vault.root;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Join a caller-supplied folder_path under the documents root and verify the
 * result stays inside it. folder_path is legitimately multi-segment
 * ("Rechnungen/2026"), so we can't ban separators — but `..` segments survive
 * join() unharmed, so a containment check is the only reliable gate against
 * mkdir/copyFile/rename landing outside the vault.
 */
function resolveDocsFolder(docsRoot: string, folderPath: string): string {
  const folder = folderPath ? join(docsRoot, folderPath) : docsRoot;
  const docsAbs = resolve(docsRoot);
  const folderAbs = resolve(folder);
  if (folderAbs !== docsAbs && !folderAbs.startsWith(docsAbs + sep)) {
    throw new Error(`folder_path escapes the documents folder: ${folderPath}`);
  }
  return folder;
}

/**
 * write-to-tmp + rename, so a crash mid-write never leaves a torn sidecar.
 *
 * Der Tempname trug nur die PID — zwei gleichzeitige Writes auf DASSELBE
 * Sidecar (derselbe Prozess, zwei Tool-Calls) benutzten damit dieselbe
 * Tempdatei: der erste rename zog sie weg, der zweite lief ins Leere
 * (ENOENT) und meldete einen Fehler für einen Write, der inhaltlich fertig
 * war. Pro Write ein eigener Name.
 */
async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

interface DocumentFrontmatter {
  id: string;
  title: string;
  type: "doc";
  aliases: string[];
  summary: string;
  topic_path: string[];
  tags: string[];
  scope: string;
  recall_when: string[];
  related: string[];
  confidence: number;
  created: string;
  updated: string;
  original_path: string;
  document_category: string;
  linked_file: boolean;
  folder_path: string;
  /** #147: Injection-Marker-Kategorien aus dem Capture-Scan. Nur gesetzt
   *  wenn der Scan anschlug — Review-Surfaces (Vault-Health) lesen es. */
  injection_flags?: string[];
}

/** Exported for tests (pure). */
export function buildFrontmatter(args: {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  category: string;
  recallWhen: string[];
  originalPath: string;
  linkedFile: boolean;
  folderPath: string;
  created: string;
  updated: string;
  /** Bestehende Aliases (User-editiert in Obsidian) — werden übernommen. */
  aliases?: string[];
  /** #147: Kategorien aus dem Capture-Injection-Scan. */
  injectionFlags?: string[];
}): DocumentFrontmatter {
  const topicPath: string[] = ["documents"];
  if (args.folderPath) {
    topicPath.push(...args.folderPath.split("/").filter(Boolean));
  } else {
    topicPath.push(args.category);
  }
  // Obsidian löst [[wikilinks]] gegen die `aliases`-Frontmatter-Liste auf
  // (Standard-Obsidian-Feature). Das Sidecar heißt nach dem Original-File
  // (`<file>.jpg.md`), nicht nach der id — ohne die id als Alias wären die
  // [[<doc-id>]]-Cross-Links des RelatedEnrichers in Obsidian unauflösbar
  // und ein Klick legt eine leere Stray-Note an (#188).
  const existingAliases = args.aliases ?? [];
  const aliases = existingAliases.includes(args.id)
    ? existingAliases
    : [...existingAliases, args.id];
  return {
    id: args.id,
    title: args.title,
    type: "doc",
    aliases,
    summary: args.summary,
    topic_path: topicPath,
    tags: args.tags,
    scope: "documents",
    recall_when: args.recallWhen,
    related: [],
    confidence: 1.0,
    created: args.created,
    updated: args.updated,
    original_path: args.originalPath,
    document_category: args.category,
    linked_file: args.linkedFile,
    folder_path: args.folderPath,
    ...(args.injectionFlags && args.injectionFlags.length > 0
      ? { injection_flags: args.injectionFlags }
      : {}),
  };
}

function renderSidecar(fm: DocumentFrontmatter, body: string): string {
  return matter.stringify(body, fm as unknown as Record<string, unknown>);
}

// ─── Identität: was darf ein Document-Write überhaupt anfassen ───

/**
 * Ein PRODUKTDOKUMENT aus `save_product_doc` — die lebende Nutzer-Doku unter
 * `dokumentationen/<projekt>/`. Sie trägt `type: doc` wie ein Sidecar, ist
 * aber ein völlig anderes Ding: kein Original-File, kein Documents-Ordner.
 * Ihre Signatur ist der topic_path `["doku", <projekt>, <area>]` (siehe
 * findDocFor in product-doc-handler.ts).
 */
export function isProductDoc(fm: unknown): boolean {
  const f = fm as { type?: unknown; topic_path?: unknown };
  if (f?.type !== "doc") return false;
  const path = f.topic_path;
  return Array.isArray(path) && path.length === 3 && path[0] === "doku";
}

/**
 * Ein Document-Hub-Sidecar — und nur das darf save/recategorize/move
 * überschreiben, verschieben oder umschreiben.
 *
 * `type === "doc"` allein war die Prüfung, und sie war zu weit: eine
 * Produktdoku ging damit glatt durch `recategorize_document` und kam als
 * Sidecar mit `scope: documents` wieder heraus — der Text blieb, das Dokument
 * war weg. Ein Sidecar muss deshalb seine VOLLE Signatur zeigen: den Scope,
 * unter dem der Hub schreibt, und die beiden Felder, über die es sein
 * Original wiederfindet. `expectedId` kommt dazu, wo der Aufrufer weiß,
 * welches Dokument an einem Pfad liegen müsste.
 */
export function isDocumentSidecar(fm: unknown, expectedId?: string): boolean {
  const f = fm as {
    id?: unknown;
    type?: unknown;
    scope?: unknown;
    original_path?: unknown;
    folder_path?: unknown;
  };
  if (f?.type !== "doc") return false;
  // Gefaltet über die zentrale Scope-Identität: ein von Hand auf
  // `scope: Documents` gesetztes Sidecar war sich mit `!==` selbst fremd —
  // der Hub verweigerte seinem eigenen Dokument Move und Recategorize.
  if (typeof f.scope !== "string" || !scopeEquals(f.scope, "documents"))
    return false;
  if (typeof f.original_path !== "string" || f.original_path.length === 0)
    return false;
  if (typeof f.folder_path !== "string") return false;
  if (isProductDoc(f)) return false;
  if (expectedId !== undefined && f.id !== expectedId) return false;
  return true;
}

/**
 * Das Frontmatter, wie es auf der Platte steht — nicht wie der Vault es
 * geparst hat. Genau die Felder, die das Schema wegnormalisiert oder gar
 * nicht kennt, sind die, die ein Metadaten-Patch nicht verlieren darf.
 */
async function readSidecarRaw(
  path: string,
): Promise<{ data: Record<string, unknown>; body: string }> {
  const parsed = matter(await readFile(path, "utf8"));
  return {
    data: { ...(parsed.data as Record<string, unknown>) },
    body: parsed.content,
  };
}

/**
 * Metadaten PATCHEN statt Frontmatter neu bauen.
 *
 * Der Rebuild kannte nur seine eigene Feldliste — alles andere fiel beim
 * Recategorize lautlos raus: die Graph-Kanten des Related-Enrichers
 * (`related`, `related_via`), das Sensitivity-Level, die Provenienz
 * (`source`) und eine von Hand heruntergesetzte `confidence`. Ein
 * Ordnerwechsel ist keine Neuerfassung; er ändert genau die Felder, die er
 * meint.
 */
function patchSidecarFrontmatter(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...existing, ...patch })) {
    // `undefined` im Patch heißt „Feld entfernen" — der einzige Weg, ein
    // Feld loszuwerden, dessen Wert der Call gerade neu bestimmt hat (die
    // Injection-Flags, wenn der Scan diesmal nichts mehr findet). Ohne die
    // Ausnahme würde js-yaml beim Dump über den undefined-Wert stolpern.
    if (value === undefined) continue;
    // YAML liefert `created: 2026-05-01` als Date zurück; ungefiltert
    // zurückgeschrieben würde daraus ein Zeitstempel mit Uhrzeit.
    out[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  return out;
}

function renderPatched(fm: Record<string, unknown>, body: string): string {
  return matter.stringify(body, fm);
}

/**
 * Was eine Metadaten-Operation tatsächlich ändern darf.
 *
 * `buildFrontmatter` ERFINDET Werte für Felder, über die ein Ordner- oder
 * Titelwechsel nichts weiß: `related: []`, `confidence: 1.0`, dazu Summary,
 * Trigger und `created` aus dem Vault-geparsten Stand. Nur die Felder, die
 * dieser Call meint, wandern in den Patch; alles andere bleibt, was auf der
 * Platte steht — und `related_via`, `sensitivity`, `source` und der Rest
 * werden gar nicht erst angefasst.
 */
function metadataPatch(
  existing: Record<string, unknown>,
  rebuilt: DocumentFrontmatter,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    id: rebuilt.id,
    title: rebuilt.title,
    type: rebuilt.type,
    aliases: rebuilt.aliases,
    topic_path: rebuilt.topic_path,
    tags: rebuilt.tags,
    scope: rebuilt.scope,
    updated: rebuilt.updated,
    original_path: rebuilt.original_path,
    document_category: rebuilt.document_category,
    linked_file: rebuilt.linked_file,
    folder_path: rebuilt.folder_path,
  };
  if (rebuilt.injection_flags) patch.injection_flags = rebuilt.injection_flags;
  // Pflichtfelder, die ein hand-editiertes Sidecar verloren haben kann: der
  // Vault repariert sie beim Indexieren, die Datei kennt sie dann nicht.
  for (const field of [
    "summary",
    "recall_when",
    "created",
    "confidence",
  ] as const) {
    if (existing[field] === undefined) patch[field] = rebuilt[field];
  }
  return patch;
}

/**
 * Was ein `save_document(overwrite: true)` gegenüber einem Ordnerwechsel
 * ZUSÄTZLICH meint.
 *
 * Ein Overwrite ist eine Neu-Erfassung derselben Datei, keine Neu-Anlage:
 * Titel, Tags, Kategorie, Summary, Trigger und die frisch gescannten
 * Injection-Flags kommen aus dem Call; `created`, `related`, `related_via`,
 * `sensitivity`, `source`, eine heruntergestufte `confidence` und ein von
 * Hand vergebener Alias gehören der Platte. Basis ist deshalb derselbe
 * {@link metadataPatch} wie bei Recategorize/Move — er lässt genau diese
 * Felder in Ruhe.
 */
function savePatch(
  existing: Record<string, unknown>,
  rebuilt: DocumentFrontmatter,
): Record<string, unknown> {
  const patch = metadataPatch(existing, rebuilt);
  // Anders als ein Ordnerwechsel bringt der Save beides mit (oder hat es
  // oben aus dem Bestand übernommen) — in jedem Fall der gemeinte Wert.
  patch.summary = rebuilt.summary;
  patch.recall_when = rebuilt.recall_when;
  // #147: Der Capture-Scan ist gerade über Titel, Summary und Body gelaufen.
  // Sein Ergebnis ersetzt das alte auch dann, wenn es leer ist — sonst bliebe
  // ein Flag stehen, dessen Anlass aus dem Dokument verschwunden ist.
  patch.injection_flags = rebuilt.injection_flags;
  return patch;
}

// ─── save_document ──────────────────────────────────────────────

export interface SaveDocumentResult {
  id: string;
  sidecar_path: string;
  original_path: string;
  reindexed: boolean;
  cloud_mount_warning?: string;
  /** #147: Capture-Scan-Advisory — geflaggt, nie geblockt. */
  injection_warning?: string;
}

export async function saveDocument(
  vault: Vault,
  args: z.infer<typeof SaveDocumentArgs>,
): Promise<SaveDocumentResult> {
  if (!isAbsolute(args.original_path)) {
    throw new Error(`original_path must be absolute: ${args.original_path}`);
  }
  // #240/A5.2: `stat` statt `access`. Ein Verzeichnis als Quelle kam bis
  // hierher durch, scheiterte erst beim copyFile — und da war die vorhandene
  // Zieldatei bereits gelöscht.
  let sourceStat;
  try {
    sourceStat = await stat(args.original_path);
  } catch {
    throw new Error(`source file not found: ${args.original_path}`);
  }
  if (!sourceStat.isFile()) {
    throw new Error(`source is not a regular file: ${args.original_path}`);
  }

  const root = vaultRoot(vault);
  const docsRoot = join(root, DOCUMENTS_ROOT);
  const folder = resolveDocsFolder(docsRoot, args.folder_path);
  await mkdir(folder, { recursive: true });

  const filename = basename(args.original_path);
  const docID = makeDocId(args.folder_path ?? "", filename);

  const sidecarPath = join(folder, `${filename}.md`);
  const originalDest = args.linked_file
    ? args.original_path
    : join(folder, filename);
  // #240/A5: PREFLIGHT — jede Kollision prüfen, BEVOR irgendetwas mutiert
  // wird. Vorher lief erst der Copy und danach der Sidecar-Check: ein
  // Sidecar-Konflikt meldete einen Fehler und ließ die Kopie trotzdem im
  // Vault zurück (halb ausgeführte Operation).
  if (
    !args.linked_file &&
    (await pathExists(originalDest)) &&
    !args.overwrite
  ) {
    throw new Error(`destination already exists: ${originalDest}`);
  }
  // Der Bestand auf der Platte, sobald ein eigenes Sidecar am Pfad liegt —
  // Grundlage des Metadaten-Patches weiter unten (siehe metadataPatch).
  let existing: { data: Record<string, unknown>; body: string } | undefined;
  const occupant = readOccupant(sidecarPath);
  if (occupant.kind !== "absent") {
    if (!args.overwrite) {
      throw new Error(`sidecar already exists: ${sidecarPath}`);
    }
    // `overwrite` heißt „ersetze MEIN Sidecar", nie „ersetze, was da liegt".
    // Eine handgeschriebene Obsidian-Notiz an `<original>.md` wurde vorher
    // vollständig überschrieben, weil allein der Pfad entschied.
    if (occupant.kind === "memory") existing = await readSidecarRaw(sidecarPath);
    if (occupant.kind === "foreign" || !isDocumentSidecar(existing?.data, docID)) {
      throw new Error(
        `refusing to overwrite ${sidecarPath}: not a document sidecar for ${docID}`,
      );
    }
  }
  // `a+b.pdf` und `a-b.pdf` slugifizieren auf DIESELBE id. Vorher entstanden
  // zwei Sidecars mit einer id, und der Vault-Index behielt nur eines davon —
  // das andere Dokument war still nicht mehr auffindbar.
  // `pathsFor` statt `get`: der Index führt pro id nur EINEN Pfad, die
  // wegen Duplikat quarantänisierten verschweigt er. Ein zweites Sidecar
  // mit derselben id an einem dritten Pfad kam damit an der Kollisions-
  // prüfung vorbei — und der Save auf das eine ließ das andere stehen.
  const holder = vault
    .pathsFor(docID)
    .find((p) => resolve(p) !== resolve(sidecarPath));
  if (holder) {
    throw new Error(`id ${docID} already belongs to ${holder}`);
  }

  if (!args.linked_file) {
    // #240/A5.1: Same-File-Erkennung. Liegt die Quelle bereits exakt am Ziel
    // (der Normalfall bei einem Metadaten-Refresh — buildFrontmatter schreibt
    // bei linked_file=false den IN-VAULT-Pfad als original_path zurück, und
    // der kommt beim nächsten Aufruf als original_path wieder rein), dann
    // löschte `unlink(originalDest)` die QUELLE und das folgende
    // copyFile(src, src) schlug mit ENOENT fehl. Die Datei war weg.
    if (resolve(args.original_path) === resolve(originalDest)) {
      // Nichts zu kopieren — die Datei ist schon da, wo sie hingehört.
    } else {
      // #240/A5.2: erst in eine eindeutige Tempdatei kopieren, dann atomar
      // über das Ziel ziehen. Vorher wurde das Ziel ZUERST gelöscht — schlug
      // der Copy danach fehl, war das alte Dokument unwiederbringlich weg.
      const tmpDest = `${originalDest}.tmp-${randomUUID()}`;
      try {
        await copyFile(args.original_path, tmpDest);
        await rename(tmpDest, originalDest);
      } catch (err) {
        await unlink(tmpDest).catch(() => {});
        throw err;
      }
    }
  }

  const existingSummary =
    typeof existing?.data.summary === "string" ? existing.data.summary : undefined;
  // Ein Refresh ohne `summary` MEINT die Summary nicht — der abgeleitete
  // Default (`kategorie: titel`) hätte eine von Hand geschriebene ersetzt.
  const summary = args.summary ?? existingSummary ?? `${args.category}: ${args.title}`;
  const recallWhen =
    args.recall_when ??
    (Array.isArray(existing?.data.recall_when)
      ? (existing.data.recall_when as string[])
      : undefined) ??
    [
      `find document ${args.title}`,
      args.tags.slice(0, 3).join(" "),
      `file ${basename(filename, "." + (filename.split(".").pop() ?? ""))}`,
    ].filter(Boolean);

  // #147: Dokument-Inhalt ist Third-Party-Content — der Capture-Scan flaggt
  // Injection-Marker (nie blocken: der Flag ist billig, ein verpasster
  // Marker nicht). Kategorien wandern ins Sidecar-Frontmatter, die Advisory
  // in die Tool-Response.
  const injectionFindings = scanForInjection(
    [args.title, summary, args.body ?? ""].join("\n"),
  );
  const injectionFlags = injectionCategories(injectionFindings);

  const today = todayISO();
  const fm = buildFrontmatter({
    id: docID,
    title: args.title,
    summary: truncateSummaryTo(summary, SUMMARY_MAX),
    tags: args.tags,
    category: args.category,
    recallWhen,
    originalPath: originalDest,
    linkedFile: args.linked_file,
    folderPath: args.folder_path ?? "",
    created: today,
    updated: today,
    // Ein in Obsidian von Hand vergebener Alias ist Nutzer-Eingabe; der
    // Rebuild kannte nur die id und warf ihn weg.
    aliases: existing?.data.aliases as string[] | undefined,
    injectionFlags: injectionFlags.length > 0 ? injectionFlags : undefined,
  });

  const body = args.body
    ? `> Sidecar für \`${originalDest}\`.\n\n## Extrahierter Inhalt\n\n${args.body}`
    : // Auch der Body ist Bestand: ein Refresh ohne `body` hat keinen Inhalt
      // zu melden, er hat den vorhandenen nicht zu löschen.
      (existing?.body.trim()
        ? existing.body
        : `> Sidecar für \`${originalDest}\`.\n\n_(Kein extrahierter Inhalt — vom Caller nicht mitgeliefert.)_`);

  // Beim Overwrite wird das bestehende Frontmatter GEPATCHT, nicht neu
  // gebaut. Der Rebuild verlor dieselben Felder, die er beim Recategorize
  // verlor — `created`, `related`, `related_via`, `sensitivity`, `source`,
  // eine heruntergestufte `confidence` —, nur hier zusätzlich noch über den
  // Weg, den der Hub seinen Callern selbst als Metadaten-Refresh anbietet.
  const content = existing
    ? renderPatched(
        patchSidecarFrontmatter(existing.data, savePatch(existing.data, fm)),
        body,
      )
    : renderSidecar(fm, body);
  await atomicWriteFile(sidecarPath, content);

  // Cloud-Watcher-Mitigation: synchroner reindex statt auf chokidar warten.
  await vault.reindexFile(sidecarPath);

  const cloudWarn = isCloudMount(root)
    ? "Vault is on a cloud-storage mount (Dropbox/GoogleDrive/iCloud) — using polling watcher; reindex done synchronously."
    : undefined;

  return {
    id: docID,
    sidecar_path: sidecarPath,
    original_path: originalDest,
    reindexed: true,
    cloud_mount_warning: cloudWarn,
    injection_warning: formatInjectionAdvisory(injectionFindings),
  };
}

// ─── recategorize_document ──────────────────────────────────────

export async function recategorizeDocument(
  vault: Vault,
  args: z.infer<typeof RecategorizeDocumentArgs> & { force?: boolean },
): Promise<{ id: string; sidecar_path: string; reindexed: boolean }> {
  const m = vault.get(args.id);
  if (!m) {
    throw new Error(`document not found: ${args.id}`);
  }
  // `type === "doc"` allein reichte, und damit fiel eine PRODUKTDOKU in
  // diesen Pfad: sie kam als Document-Hub-Sidecar mit `scope: documents`
  // wieder heraus, der Text blieb, das Dokument war weg.
  if (!isDocumentSidecar(m.fm)) {
    throw new Error(`not a document sidecar: ${args.id}`);
  }
  // Phase 3.2 Conflict-Detection: wenn das Sidecar zwischen letztem
  // Vault-Read und jetzt extern editiert wurde, refusen wir den Update —
  // sonst überschreiben wir User-Edits aus Obsidian. Caller kann mit
  // `force: true` über das Veto gehen.
  if (!args.force) {
    try {
      const st = await stat(m.filePath);
      if (st.mtimeMs > m.mtime) {
        throw new Error(
          `sidecar was edited externally (mtime ${new Date(st.mtimeMs).toISOString()} > vault ${new Date(m.mtime).toISOString()}). Pass force=true to overwrite.`,
        );
      }
    } catch (err) {
      if ((err as Error).message.startsWith("sidecar was edited")) throw err;
      // stat-Fehler (File weg etc.) → durchlaufen, write-Logik wird erneut prüfen.
    }
  }
  const fm = m.fm as typeof m.fm & {
    original_path?: string;
    document_category?: string;
    folder_path?: string;
    linked_file?: boolean;
    aliases?: string[];
    injection_flags?: string[];
  };

  // Wenn Folder geändert: erst move (verschiebt Files + Sidecar). Sonst nur
  // Sidecar-Frontmatter aktualisieren.
  let sidecarPath = m.filePath;
  let originalPath = fm.original_path ?? m.filePath.replace(/\.md$/, "");
  let folderPath = fm.folder_path ?? "";

  if (args.folder_path !== undefined && args.folder_path !== folderPath) {
    const moved = await moveDocumentFiles(vault, {
      sidecarPath,
      originalPath,
      currentFolderPath: folderPath,
      newFolderPath: args.folder_path,
      linkedFile: fm.linked_file ?? false,
    });
    // #240/A3: the OLD sidecar path must leave the index before the new one
    // enters it. Without this both paths point at the same id; the next
    // reconcile (60 s, or any /vault/count) removes the old path and takes
    // the current memory with it — the document went silently unfindable
    // until a daemon restart. Same fix pattern as tool-handlers.ts:839.
    if (moved.newSidecarPath !== sidecarPath) vault.forgetFile(sidecarPath);
    sidecarPath = moved.newSidecarPath;
    originalPath = moved.newOriginalPath;
    folderPath = args.folder_path;
  }

  const category = args.category ?? fm.document_category ?? "sonstiges";
  // Nur die Felder anfassen, die dieser Call meint. Der frühere Rebuild aus
  // buildFrontmatter warf alles weg, was nicht in seiner Feldliste stand.
  const raw = await readSidecarRaw(sidecarPath);
  const rebuilt = buildFrontmatter({
    id: m.fm.id,
    title: args.title ?? m.fm.title,
    summary: m.fm.summary,
    tags: args.tags ?? m.fm.tags,
    category,
    recallWhen: m.fm.recall_when,
    originalPath,
    linkedFile: fm.linked_file ?? false,
    folderPath,
    created: m.fm.created,
    updated: todayISO(),
    aliases: (raw.data.aliases as string[] | undefined) ?? fm.aliases,
    // #147: Capture-Flags überleben den Patch — Metadaten-Ops ändern nie die
    // Provenienz-Bewertung des Inhalts.
    injectionFlags:
      (raw.data.injection_flags as string[] | undefined) ?? fm.injection_flags,
  });
  const updated = patchSidecarFrontmatter(
    raw.data,
    metadataPatch(raw.data, rebuilt),
  );

  await atomicWriteFile(sidecarPath, renderPatched(updated, raw.body));
  await vault.reindexFile(sidecarPath);

  return { id: m.fm.id, sidecar_path: sidecarPath, reindexed: true };
}

// ─── move_document ──────────────────────────────────────────────

export async function moveDocument(
  vault: Vault,
  args: z.infer<typeof MoveDocumentArgs>,
): Promise<{
  id: string;
  sidecar_path: string;
  original_path: string;
  reindexed: boolean;
}> {
  const m = vault.get(args.id);
  if (!m) {
    throw new Error(`document not found: ${args.id}`);
  }
  // Wie im Recategorize: eine Produktdoku ist kein Sidecar und wird hier
  // weder verschoben noch umgeschrieben.
  if (!isDocumentSidecar(m.fm)) {
    throw new Error(`not a document sidecar: ${args.id}`);
  }
  const fm = m.fm as typeof m.fm & {
    original_path?: string;
    folder_path?: string;
    linked_file?: boolean;
    aliases?: string[];
  };

  const moved = await moveDocumentFiles(vault, {
    sidecarPath: m.filePath,
    originalPath: fm.original_path ?? m.filePath.replace(/\.md$/, ""),
    currentFolderPath: fm.folder_path ?? "",
    newFolderPath: args.folder_path,
    linkedFile: fm.linked_file ?? false,
  });
  // #240/A3: drop the old path from the index before the new one is read —
  // otherwise both paths carry the same id and the next reconcile deletes
  // the moved document.
  if (moved.newSidecarPath !== m.filePath) vault.forgetFile(m.filePath);

  // Frontmatter im neuen Sidecar patchen — ein Move ändert Pfade, sonst
  // nichts. Der frühere Rebuild verlor dabei `related`, `related_via`,
  // `sensitivity`, `source` und eine gepflegte `confidence`.
  const raw = await readSidecarRaw(moved.newSidecarPath);
  const rebuilt = buildFrontmatter({
    id: m.fm.id,
    title: m.fm.title,
    summary: m.fm.summary,
    tags: m.fm.tags,
    category:
      (fm as { document_category?: string }).document_category ?? "sonstiges",
    recallWhen: m.fm.recall_when,
    originalPath: moved.newOriginalPath,
    linkedFile: fm.linked_file ?? false,
    folderPath: args.folder_path,
    created: m.fm.created,
    updated: todayISO(),
    aliases: (raw.data.aliases as string[] | undefined) ?? fm.aliases,
    // #147: Capture-Flags überleben den Patch — Metadaten-Ops ändern nie die
    // Provenienz-Bewertung des Inhalts.
    injectionFlags:
      (raw.data.injection_flags as string[] | undefined) ?? fm.injection_flags,
  });
  const updated = patchSidecarFrontmatter(
    raw.data,
    metadataPatch(raw.data, rebuilt),
  );
  await atomicWriteFile(moved.newSidecarPath, renderPatched(updated, raw.body));
  await vault.reindexFile(moved.newSidecarPath);

  return {
    id: m.fm.id,
    sidecar_path: moved.newSidecarPath,
    original_path: moved.newOriginalPath,
    reindexed: true,
  };
}

async function moveDocumentFiles(
  vault: Vault,
  args: {
    sidecarPath: string;
    originalPath: string;
    currentFolderPath: string;
    newFolderPath: string;
    linkedFile: boolean;
  },
): Promise<{ newSidecarPath: string; newOriginalPath: string }> {
  const root = vaultRoot(vault);
  const docsRoot = join(root, DOCUMENTS_ROOT);
  const targetFolder = resolveDocsFolder(docsRoot, args.newFolderPath);
  await mkdir(targetFolder, { recursive: true });

  const sidecarFilename = basename(args.sidecarPath);
  const originalFilename = basename(args.originalPath);

  const newSidecarPath = join(targetFolder, sidecarFilename);
  const newOriginalPath = args.linkedFile
    ? args.originalPath
    : join(targetFolder, originalFilename);

  // #240/A5.3: BEIDE Ziele prüfen, bevor das erste umbenannt wird. Vorher
  // wanderte das Original erfolgreich ans Ziel und erst danach kollidierte
  // der Sidecar — Ergebnis war ein gemeldeter Fehler bei halb ausgeführtem
  // Move: Original im Zielordner, Sidecar in der Quelle, Frontmatter und
  // Platte widersprachen sich.
  const movesOriginal =
    !args.linkedFile && newOriginalPath !== args.originalPath;
  const movesSidecar = newSidecarPath !== args.sidecarPath;
  if (movesOriginal && (await pathExists(newOriginalPath))) {
    throw new Error(`target original already exists: ${newOriginalPath}`);
  }
  if (movesSidecar && (await pathExists(newSidecarPath))) {
    throw new Error(`target sidecar already exists: ${newSidecarPath}`);
  }

  if (movesOriginal) await rename(args.originalPath, newOriginalPath);
  if (movesSidecar) {
    try {
      await rename(args.sidecarPath, newSidecarPath);
    } catch (err) {
      // Der Sidecar-Move ist der zweite Schritt: schlägt er fehl (ENOSPC,
      // EACCES, Cloud-Mount-Stall), das Original zurückrollen, damit kein
      // Split-State zurückbleibt.
      if (movesOriginal) {
        await rename(newOriginalPath, args.originalPath).catch(() => {});
      }
      throw err;
    }
  }

  return { newSidecarPath, newOriginalPath };
}

// ─── Conflict-Detection (Phase 3.2 — basic mtime-Check) ─────────

/**
 * Vergleicht die mtime des Original-Files mit der Cache-mtime im Vault.
 * Wenn die Datei seit dem letzten Vault-Read jünger ist, signalisieren wir
 * einen Conflict — der Caller (UI) entscheidet ob er trotzdem überschreibt.
 */
export async function detectExternalEdit(
  vault: Vault,
  id: string,
): Promise<{ conflict: boolean; reason?: string }> {
  const m = vault.get(id);
  if (!m) return { conflict: false };
  const fm = m.fm as typeof m.fm & { original_path?: string };
  const target = fm.original_path ?? m.filePath;
  let st;
  try {
    st = await stat(target);
  } catch {
    return { conflict: false }; // File weg → kein Konflikt, nur Fehler-Pfad
  }
  if (st.mtimeMs > m.mtime) {
    return {
      conflict: true,
      reason: `file changed externally at ${new Date(st.mtimeMs).toISOString()} (vault mtime ${new Date(m.mtime).toISOString()})`,
    };
  }
  return { conflict: false };
}
