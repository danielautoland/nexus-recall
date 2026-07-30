import { writeFile, readFile, access, mkdir, unlink, rename } from "node:fs/promises";
import { join, dirname, resolve, sep } from "node:path";
import { z } from "zod";
import matter from "gray-matter";
import { MemoryTypeEnum, isPathSafeComponent, coerceAliases } from "./schema.js";
import { clampSummary, SUMMARY_MAX } from "./summary.js";

/**
 * Input contract for save_memory.
 * Mirrors FrontmatterSchema but only the fields a caller should set —
 * id, created and updated are auto-derived; `obsolete` and `superseded_by`
 * are written by separate flows, not by save.
 *
 * `replaces` is the exception (#164): it is how a caller declares "this
 * memory is the new version of that one". The counterpart stamp
 * (`superseded_by` on the predecessor) is applied by the daemon, which is the
 * layer that knows where the predecessor lives.
 */
export const SaveMemoryInput = z.object({
  title: z.string().min(1),
  type: MemoryTypeEnum,
  // No `.max` here on purpose: an over-long summary is clamped in
  // saveMemory() (with a non-fatal note in the result), never rejected —
  // a too_big error would force the caller into a wasteful retry roundtrip.
  summary: z.string().min(1),
  body: z.string().min(1),
  topic_path: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)).min(1),
  // scope becomes a directory segment (`memories/projects/<scope>/`) — reject
  // anything that could climb out of the vault.
  scope: z.string().min(1).refine(isPathSafeComponent, {
    message: "scope must not contain path separators, '..', or a leading dot",
  }),
  recall_when: z.array(z.string().min(1)).min(1),
  /**
   * #164 — id of the memory this one supersedes.
   *
   * Deliberately NOT the same thing as `archive_memory`: the predecessor stays
   * in the living vault and stays resolvable by its id. It is not moved to the
   * trash, not dropped from the index, and not marked `obsolete`. Per the V1→V2
   * architecture contract (C-059) historicity comes from the version status,
   * never from a change of location — a predecessor that is moved away is not
   * historical, it is gone, and old versions have to stay citable.
   */
  replaces: z.string().min(1).optional(),
  /** #235: optional anchor command that can prove this memory's claim.
   *  Stored and displayed only — nothing here ever runs it. */
  verify_cmd: z.string().min(1).optional(),
  related: z.array(z.string()).optional(),
  /**
   * Obsidian-Aliases (#188): Substrat-Plumbing, kein Agent-Knob — der Daemon
   * exponiert das Feld NICHT im MCP-Tool-Schema. Wird vom RelatedEnricher /
   * Documents-Flow gesetzt. Beim Overwrite ohne explizite aliases bleiben
   * die bestehenden File-Aliases erhalten (siehe saveMemory).
   */
  aliases: z.array(z.string()).optional(),
  /**
   * Memory-Graph (#30 / #49): LLM-detektierte Beziehungen. Optional —
   * normalerweise nicht beim manuellen save_memory gesetzt, sondern vom
   * Auto-Related-Detection-Background-Service via reindex_file persistiert.
   */
  related_via: z
    .array(
      z.object({
        id: z.string().min(1),
        reason: z.string().min(1),
        score: z.number().min(0).max(1),
      }),
    )
    .optional(),
  /**
   * Sensitivity-Level (#58). Optional, default „team" wenn nicht gesetzt.
   * Mac-App-UI macht den Per-Memory-Picker; Auto-Captures (Inbox-Watcher,
   * Share-Sheet) erben den Default.
   */
  sensitivity: z.enum(["private", "team", "public"]).optional(),
  /**
   * Write-Provenance (#158): `user-directed` wenn der Mensch das Speichern
   * explizit angeordnet hat („merk dir das") — solche Memories sind für
   * automatisierte Lifecycle-Pässe (Curator, Konsolidierung) unantastbar.
   * Weglassen = `agent-session` (autonomer Save im Sessionfluss).
   * `capture-review` stempelt der Post-Session-Capture-Pass (#157).
   */
  write_origin: z.enum(["user-directed", "agent-session", "capture-review"]).optional(),
  /**
   * Memory-Lifecycle (#74): optionale Ablauf-/Review-Felder. `stale_status`
   * wird vom Vault-Loader computet, ist hier aber akzeptiert damit die
   * Mac-App es explizit setzen kann (z.B. manuelles „obsolete").
   */
  valid_until: z.string().optional(),
  expires_after_days: z.number().int().positive().optional(),
  last_reviewed_at: z.string().optional(),
  stale_status: z.enum(["fresh", "aging", "stale", "expired"]).optional(),
  /**
   * Duplicate-Detection (#70): SHA-256-Hash + Größe der Original-Datei.
   * Nur bei `type: doc` Memories sinnvoll. Mac-App-DocumentsImporter
   * berechnet beide beim ersten Import.
   */
  content_hash: z.string().optional(),
  content_size: z.number().int().nonnegative().optional(),
  source: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  /**
   * Valenz + Reflex (#217). `salience`/`emotion` nur setzen, wenn eine
   * Capture-Regel feuert; `recall_mode: "reflex"` nur nach expliziter
   * User-Bestätigung. Bei Overwrite ohne Angabe bleiben Bestandswerte
   * erhalten (gleiche Regel wie write_origin).
   */
  salience: z.number().min(0).max(1).optional(),
  emotion: z.enum(["frustration", "success", "risk", "neutral"]).optional(),
  recall_mode: z.enum(["reflex", "deliberate"]).optional(),
  affects_files: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
  // id becomes the filename (`<id>.md`) — same path-safety bar as scope.
  // slugify() output always passes; only explicit caller-set ids can violate.
  id: z.string().min(1).refine(isPathSafeComponent, {
    message: "id must not contain path separators, '..', or a leading dot",
  }).optional(),
  /**
   * Selbstlernende Taxonomie (#64/#65): optionaler Ziel-Ordner relativ zum
   * Vault-Root (z.B. "memories/people"). Überschreibt das scope/type-Routing
   * von subfolderFor() — damit kann eine Taxonomie-Konvention neue physische
   * Strukturen im Vault etablieren, ohne dass core sie kennen muss. Der Vault
   * scannt rekursiv, jeder Ordner wird indexiert.
   */
  folder: z.string().min(1).refine(isPathSafeFolder, {
    message:
      "folder must be a relative path without '..', '\\', or dot-segments (e.g. \"memories/people\")",
  }).optional(),
  overwrite: z.boolean().optional(),
  // Bookmark-only fields
  url: z.string().optional(),
  categories: z.array(z.string()).optional(),
  read_status: z.enum(["unread", "read", "archived"]).optional(),
  og_image: z.string().optional(),
  saved_at: z.string().optional(),
  source_app: z.string().optional(),
});
export type SaveMemoryInput = z.infer<typeof SaveMemoryInput>;

export interface SaveMemoryResult {
  id: string;
  file_path: string;
  created: boolean;
  /** Present only when the summary was auto-truncated to fit SUMMARY_MAX. */
  summary_note?: string;
}

const SLUG_MAX_LEN = 80;

/**
 * Folder-Werte sind legitim mehrsegmentig ("memories/people/extern") — kein
 * Charset-Verbot wie bei id/scope, aber jedes Segment muss harmlos sein:
 * kein "..", kein ".", kein führender Punkt, keine Backslashes/NUL, nicht
 * absolut. Der Containment-Assert in saveMemory() bleibt als zweite Schicht.
 */
function isPathSafeFolder(value: string): boolean {
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) {
    return false;
  }
  const segments = value.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  return segments.every((s) => s !== ".." && s !== "." && !s.startsWith("."));
}

/**
 * Marker-Kommentare, zwischen denen der RelatedEnricher die Auto-Wikilink-
 * Section im Body verwaltet. Obsidian rendert HTML-Kommentare als unsichtbar,
 * Wikilinks dazwischen werden aber als Edges im Graph erkannt — so kriegt
 * Obsidian unseren Auto-Graph, ohne dass die User-Notizen vermüllt werden.
 *
 * Die Konstanten sind hier (und nicht in related-enrich.ts), damit
 * `extractWikilinks()` die Section überspringen kann — sonst würde der
 * Save-Pfad die Auto-Wikilinks erneut in `related[]` spiegeln, was die
 * Trennung von Hand- und Auto-Links zerfließen ließe.
 */
export const AUTO_RELATED_START = "<!-- bastra:auto-related:start -->";
export const AUTO_RELATED_END = "<!-- bastra:auto-related:end -->";

/** Entfernt die Auto-Related-Section (Heading-Zeile inklusive Markern bis
 *  zur End-Marker-Zeile inkl.) aus dem Body. Wenn keine Section da ist,
 *  unverändert zurück. */
export function stripAutoRelatedSection(body: string): string {
  const startIdx = body.indexOf(AUTO_RELATED_START);
  const endIdx = body.indexOf(AUTO_RELATED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return body;
  const lineStart = body.lastIndexOf("\n", startIdx) + 1;
  const afterEndNewline = body.indexOf("\n", endIdx + AUTO_RELATED_END.length);
  const cutEnd = afterEndNewline === -1 ? body.length : afterEndNewline + 1;
  return body.slice(0, lineStart) + body.slice(cutEnd);
}

/**
 * Blankt Code aus einem Markdown-Body: fenced Blöcke (``` / ~~~) und Inline-
 * Code (`…`). Zeilen bleiben erhalten (durch Leerzeichen ersetzt), damit
 * zeilenbasierte Heuristiken die Struktur nicht verlieren. Zweck: ein Body,
 * der ÜBER Wikilink-Syntax redet (`[[x]]` im Code-Beispiel), darf keine
 * Phantom-`related[]` erzeugen — genau zzallirogs Parser-Noise-Befund
 * (2026-07-18): 7 seiner „Ghosts" waren `[[x]]`/`[[slug]]` aus Prosa über
 * Links, nie echte Kanten.
 */
export function stripCodeSpans(body: string): string {
  let fenceChar: string | null = null;
  return body
    .split("\n")
    .map((line) => {
      const fm = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fenceChar !== null) {
        if (fm && fm[1][0] === fenceChar) fenceChar = null; // schließender Zaun
        return "";
      }
      if (fm) {
        fenceChar = fm[1][0]; // öffnender Zaun
        return "";
      }
      return line.replace(/`[^`]*`/g, " "); // Inline-Code
    })
    .join("\n");
}

/**
 * Extrahiert `[[memory-id]]`-Wikilinks aus einem Memory-Body. Slugs sind
 * `^[a-z0-9][a-z0-9_-]{0,79}$` (passt zur `slugify()`-Ausgabe). Ergebnis ist
 * dedupliziert, in der Reihenfolge des ersten Vorkommens.
 *
 * Die Auto-Related-Section und Code-Spans werden übersprungen — sonst floaten
 * Auto-Links bzw. Code-Beispiele in `related[]` rein.
 */
const WIKILINK_RE = /\[\[([a-z0-9][a-z0-9_-]{0,79})\]\]/g;
export function extractWikilinks(body: string): string[] {
  const scanned = stripCodeSpans(stripAutoRelatedSection(body));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of scanned.matchAll(WIKILINK_RE)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function slugify(input: string): string {
  const lower = input
    .toLowerCase()
    // Umlaut-Transliteration MUSS vor NFKD laufen: NFKD zerlegt ä→a+combining,
    // der Diacritic-Strip macht daraus ein nacktes "a", und ein späteres
    // .replace(/ä/) fände dann kein ä mehr (→ ä/ö/ü würden zu a/o/u verstümmelt).
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "");
  const slug = lower
    // `[^a-z0-9]` erased every non-Latin letter into a separator, so a
    // Cyrillic/CJK-only title collapsed to "" and threw. `\p{L}\p{N}` + `u`
    // keep letters of any script (UTF-8 filenames are fine); ASCII titles are
    // unaffected. Umlauts still transliterate above, before this runs.
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN);
  if (!slug) throw new Error(`cannot slugify: ${JSON.stringify(input)}`);
  return slug;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Subfolder routing inside the vault.
 *
 * Top-level layout (three siblings):
 *   memories/         lessons, decisions, preferences, project-facts,
 *                     workflows — anything the agent learned and wants
 *                     to recall later.
 *     ├── user/             scope = "user-preference"
 *     ├── all-projects/     scope = "all-projects"
 *     └── projects/<scope>/ everything else
 *
 *   bookmarks/        type = "bookmark" — saved URLs with url/og_image.
 *                     Kept as a sibling because bookmarks aren't really
 *                     "memories" and carry their own metadata shape.
 *
 *   dokumentationen/  type = "doc" — living per-project documentation
 *                     ("software wiki"). Routed to dokumentationen/<scope>/
 *                     so each project owns its docs.
 *
 * The vault scans recursively, so older flat `memorys/` files continue to
 * work until they are migrated.
 */
function subfolderFor(scope: string, type: string): string {
  if (type === "bookmark") return "bookmarks";
  if (type === "doc") return `dokumentationen/${scope}`;
  if (scope === "user-preference") return "memories/user";
  if (scope === "all-projects") return "memories/all-projects";
  // Reservierter Ort für selbst-etablierte Taxonomie-Konventionen (#65):
  // Regeln, die beschreiben, wie der Vault künftig strukturiert wird
  // ("Personen nach memories/people/, Tag person, …"). Die Hooks laden
  // diesen Scope bei Session-Start und injizieren ihn als Kontext.
  if (scope === "taxonomy") return "memories/taxonomy";
  return `memories/projects/${scope}`;
}

export type MemoryTargetInput = Pick<
  SaveMemoryInput,
  "title" | "type" | "scope" | "id" | "folder"
>;

export interface MemoryTarget {
  id: string;
  filePath: string;
}

/**
 * Resolve the exact file `saveMemory` will write.
 *
 * Callers that need a pre-write snapshot (for example the daemon audit trail)
 * must use the same routing and containment check as the writer instead of
 * duplicating `subfolderFor`. This is a routing primitive, not a second save
 * API: a path escape is a write failure and must throw rather than being
 * downgraded to "audit unavailable".
 */
export function resolveMemoryTarget(
  vaultRoot: string,
  input: MemoryTargetInput,
): MemoryTarget {
  const id = input.id ?? slugify(input.title);
  const subdir = input.folder ?? subfolderFor(input.scope, input.type);
  const filePath = join(vaultRoot, subdir, `${id}.md`);
  if (!resolve(filePath).startsWith(resolve(vaultRoot) + sep)) {
    throw new Error(`refusing to write outside the vault: ${filePath}`);
  }
  return { id, filePath };
}

/**
 * Build the .md content for a new memory and write it into the vault.
 * The vault watcher will pick it up and index it automatically.
 */
export async function saveMemory(
  vaultRoot: string,
  input: SaveMemoryInput,
): Promise<SaveMemoryResult> {
  const { id, filePath } = resolveMemoryTarget(vaultRoot, input);
  const exists = await fileExists(filePath);
  if (exists && !input.overwrite) {
    throw new Error(
      `memory already exists: ${id}. Pass overwrite=true to replace it, ` +
        `or pick a different title/id.`,
    );
  }

  // #240/A6: Overwrite ist ein PATCH, kein Replace. Ein Save schickt nur die
  // Felder, die er ändern will — alles andere muss den Refresh überleben.
  // Vorher wurde das Frontmatter aus dem Input neu gebaut, sodass jedes
  // Agent-Overwrite `created`, `sensitivity`, `confidence`, `source`,
  // `valid_until`, `affects_files`, … still auf Defaults zurücksetzte. Das
  // ist der häufigste Schreibvorgang überhaupt (der Skill schreibt Updates
  // per overwrite=true vor), und die Verluste sind teils nicht regenerierbar.
  //
  // Löschen bleibt ausdrückbar: `?? ` greift nur bei *fehlendem* Feld, ein
  // explizit übergebenes `[]` / null-Wert schlägt weiterhin durch.
  //
  // Historie der Einzelfall-Pflaster, die das hier ersetzt: #188 aliases,
  // #158 write_origin, #217 salience/emotion/recall_mode.
  // Best-effort: ein unlesbares File blockt den Save nicht.
  let prev: Record<string, unknown> = {};
  if (exists) {
    try {
      const existingRaw = await readFile(filePath, "utf8");
      prev = (matter(existingRaw).data as Record<string, unknown> | undefined) ?? {};
    } catch {
      // korrupt/parallel gelöscht → nichts zu erhalten
    }
  }
  /** Übernimmt den Bestandswert nur, wenn er den erwarteten Typ hat. */
  const kept = <T>(value: unknown, ok: (v: unknown) => boolean): T | undefined =>
    ok(value) ? (value as T) : undefined;
  const isStr = (v: unknown): boolean => typeof v === "string" && v.length > 0;
  const isNum = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
  const isArr = (v: unknown): boolean => Array.isArray(v);
  /**
   * Optionales Frontmatter-Feld: Input gewinnt, sonst der Bestandswert,
   * sonst bleibt das Feld ganz weg (kein `field: undefined` im YAML).
   */
  const optional = (
    key: string,
    value: unknown,
    ok: (v: unknown) => boolean,
  ): Record<string, unknown> => {
    const next = value ?? kept(prev[key], ok);
    return next == null ? {} : { [key]: next };
  };

  const aliases = input.aliases ?? coerceAliases(prev.aliases);
  const existingOrigin = kept<string>(prev.write_origin, isStr);
  const salience =
    input.salience ??
    kept<number>(prev.salience, (v) => isNum(v) && (v as number) >= 0 && (v as number) <= 1);
  const emotion =
    input.emotion ??
    kept<string>(prev.emotion, (v) =>
      ["frustration", "success", "risk", "neutral"].includes(v as string),
    );
  const recallMode =
    input.recall_mode ??
    kept<string>(prev.recall_mode, (v) => v === "reflex" || v === "deliberate");

  const today = todayISO();
  // Wikilinks aus dem Body in `related[]` spiegeln. Im OSS-Stack existiert
  // sonst keine Stelle, die `[[id]]`-Referenzen in Strukturdaten überführt
  // — Multi-Hop-Recall sähe sie nie. Reihenfolge: vom Caller mitgegebene
  // related zuerst, dann neue aus dem Body, dedupliziert.
  const bodyLinks = extractWikilinks(input.body);
  const mergedRelated = dedupe([
    ...(input.related ?? kept<string[]>(prev.related, isArr) ?? []),
    ...bodyLinks,
  ]).filter(
    (rel) => rel !== id, // self-link macht keinen Sinn
  );

  // Clamp instead of reject: an over-long summary is truncated at a word
  // boundary so the write always succeeds; the caller gets a non-fatal note.
  const { summary: clampedSummary, truncated: summaryTruncated } = clampSummary(input.summary);

  const fm: Record<string, unknown> = {
    id,
    title: input.title,
    type: input.type,
    summary: clampedSummary,
    topic_path: input.topic_path,
    tags: input.tags,
    scope: input.scope,
    recall_when: input.recall_when,
    related: mergedRelated,
    ...(aliases && aliases.length > 0 ? { aliases } : {}),
    related_via: input.related_via ?? kept(prev.related_via, isArr) ?? [],
    // sensitivity trägt das allow_private-Gate: ein stiller private→team-
    // Downgrade beim Text-Refresh würde das Memory für externe Caller öffnen.
    sensitivity: input.sensitivity ?? kept(prev.sensitivity, isStr) ?? "team",
    // #158: Provenance-Stempel — Bestands-Memories ohne Feld gelten als
    // agent-session (Backfill per Default-Semantik, kein Massen-Rewrite)
    write_origin: input.write_origin ?? existingOrigin ?? "agent-session",
    // Maschinell erzeugte Trigger-Expansion (#117): der Save baut das
    // Frontmatter neu, also fielen doc2query-Trigger bei jedem Overwrite raus
    // und mussten vom Background-Pass neu berechnet werden.
    // Nur aus dem Bestand: SaveMemoryInput kennt diese Felder nicht, sie
    // entstehen ausschließlich im Background-Pass (trigger-expand.ts).
    ...optional("recall_when_expanded", undefined, isArr),
    ...optional("recall_when_expanded_src", undefined, isStr),
    ...optional("valid_until", input.valid_until, isStr),
    ...optional("expires_after_days", input.expires_after_days, isNum),
    ...optional("last_reviewed_at", input.last_reviewed_at, isStr),
    ...optional("stale_status", input.stale_status, isStr),
    ...optional("content_hash", input.content_hash, isStr),
    ...optional("content_size", input.content_size, isNum),
    ...optional("source", input.source, isStr),
    // #164: the forward half of the supersession edge. The backward half
    // (`superseded_by` on the predecessor) is stamped by the daemon. Kept from
    // the previous file when absent, so re-saving a memory does not drop the
    // version link it already declared.
    ...optional("replaces", input.replaces, isStr),
    ...optional("verify_cmd", input.verify_cmd, isStr),
    ...optional("superseded_by", undefined, isStr),
    confidence: input.confidence ?? kept(prev.confidence, isNum) ?? 1,
    // #217: `!= null` statt truthy — salience 0 ist ein gültiger Wert.
    ...(salience != null ? { salience } : {}),
    ...(emotion != null ? { emotion } : {}),
    ...(recallMode != null ? { recall_mode: recallMode } : {}),
    // `created` ist die Entstehungszeit, nicht die letzte Schreibzeit — und
    // über SaveMemoryInput gar nicht setzbar. Vorher stand hier unbedingt
    // `today`, wodurch jedes Overwrite die Historie des Memorys löschte.
    created: kept<string>(prev.created, isStr) ?? today,
    updated: today,
    affects_files: input.affects_files ?? kept(prev.affects_files, isArr) ?? [],
    issues: input.issues ?? kept(prev.issues, isArr) ?? [],
  };

  // Bookmark-specific fields, only set when type === "bookmark" so memory
  // files don't get bookmark-shaped frontmatter pollution.
  if (input.type === "bookmark") {
    if (input.url) fm.url = input.url;
    if (input.categories) fm.categories = input.categories;
    if (input.read_status) fm.read_status = input.read_status;
    if (input.og_image) fm.og_image = input.og_image;
    if (input.source_app) fm.source_app = input.source_app;
    fm.saved_at = input.saved_at ?? new Date().toISOString();
  }

  const body = input.body.startsWith("\n") ? input.body : `\n${input.body}`;
  const content = matter.stringify(body, fm);

  await mkdir(dirname(filePath), { recursive: true });
  // Atomar via temp+rename — dieselbe Begründung wie in related-enrich.ts:241
  // ("ein direkter writeFile lässt das File kurzzeitig leer, live beobachtet").
  // Der Fix war dort gegen ein beobachtetes Datenverlust-Fenster eingebaut,
  // aber nie auf den häufigsten Writer zurückportiert. Der Temp-Name trägt
  // zusätzlich einen Zufallsanteil: ein fixer `.tmp-<pid>` kollidiert bei
  // überlappenden Schreibern desselben Prozesses (#240/B3) und veröffentlicht
  // per rename das Mischprodukt.
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return {
    id,
    file_path: filePath,
    created: !exists,
    ...(summaryTruncated
      ? {
          summary_note:
            `summary was auto-truncated to ${SUMMARY_MAX} chars; ` +
            `write it shorter next time (the full text lives in the body, not the summary).`,
        }
      : {}),
  };
}

export interface DeleteMemoryResult {
  id: string;
  file_path: string;
  deleted: boolean;
}

/**
 * Remove a memory file from disk by its absolute path. Caller resolves
 * the path through the vault index (so we don't have to guess where the
 * file lives — it could sit in any subfolder).
 */
export async function deleteMemoryFile(filePath: string, id: string): Promise<DeleteMemoryResult> {
  if (!(await fileExists(filePath))) {
    throw new Error(`memory file not found: ${filePath}`);
  }
  await unlink(filePath);
  return { id, file_path: filePath, deleted: true };
}
