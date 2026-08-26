/**
 * The save orchestration: build the frontmatter, resolve the target, commit the
 * file, report what happened.
 *
 * Four neighbours carry what this used to hold inline — `save-schema.ts` (the
 * input contract), `save-text.ts` (slug and body helpers), `save-commit.ts`
 * (the id-level claim) and `save-target.ts` (where the file goes). They were
 * split out when this file passed 800 lines; nothing changed but the location.
 */
import { writeFile, mkdir, unlink, rename, link } from "node:fs/promises";
import { dirname } from "node:path";
import matter from "gray-matter";
import { coerceAliases } from "./schema.js";
import { clampSummary, SUMMARY_MAX } from "./summary.js";
import type {
  SaveMemoryInput,
  SaveMemoryResult,
  SaveMemoryCommitOptions,
} from "./save-schema.js";
import { extractWikilinks, todayISO, dedupe } from "./save-text.js";
import { fileExists, readTarget, acquireCommitClaim, writeConflict } from "./save-commit.js";
import { resolveMemoryTarget } from "./save-target.js";

/**
 * Build the .md content for a new memory and write it into the vault.
 * The vault watcher will pick it up and index it automatically.
 */
export async function saveMemory(
  vaultRoot: string,
  input: SaveMemoryInput,
  commit: SaveMemoryCommitOptions = {},
): Promise<SaveMemoryResult> {
  const { id, filePath, scope } = resolveMemoryTarget(vaultRoot, input);
  const observedTarget = await readTarget(filePath);
  const exists = observedTarget !== null;
  if (
    commit.expectedTarget !== undefined &&
    commit.expectedTarget !== observedTarget
  ) {
    throw writeConflict(id, filePath, "target changed after the caller inspected it");
  }
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
      // Copy, don't alias: gray-matter caches matter(content) by string, so the
      // object handed back here is shared with every other parse of identical
      // content. The Date coercion below writes into `prev` — without this copy
      // it would poison that cache entry and hand a later parser a string where
      // the file says Date. Same reasoning as related-enrich.ts:230 and
      // trigger-expand.ts:322.
      prev = { ...((matter(observedTarget).data as Record<string, unknown> | undefined) ?? {}) };
    } catch {
      // Corrupt frontmatter is replaced only after the raw file itself was
      // captured above; the commit comparison still protects that preimage.
    }
  }
  // YAML 1.1 hands a bare `created: 2026-05-01` back as a JS `Date`, and the
  // bare form is exactly what Obsidian Properties and a hand edit write. The
  // carry-over below tests for a string, so a Date failed every check: the
  // refresh restamped `created` to today and dropped `valid_until` /
  // `last_reviewed_at` from the file — the #240/A6 loss, reachable through the
  // vault's own editor. `schema.ts` already coerces on the read path; the write
  // path has to do the same before the type checks see the value.
  // `updated` fehlt hier bewusst: es wird nie aus `prev` gelesen, `updated: today`
  // stempelt es bei jedem Schreibvorgang neu.
  for (const key of ["created", "valid_until", "last_reviewed_at"]) {
    const value = prev[key];
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      prev[key] = value.toISOString().slice(0, 10);
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

  /** #360: union of the file's existing `siblings` and this save's
   *  `sibling_of`, order-stable, empty list omitted from the frontmatter. */
  const mergedSiblings = (): Record<string, unknown> => {
    const previous = kept<unknown[]>(prev.siblings, isArr) ?? [];
    const merged = [...new Set([...previous, ...(input.sibling_of ?? [])].filter(isStr))];
    return merged.length === 0 ? {} : { siblings: merged };
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
    // Immer identisch zum Ordner, den `resolveMemoryTarget` gewählt hat
    // (#360-D): kanonisch bei jedem normalen Save, im Bestandsfall die alte
    // Schreibweise — sonst zeigt das Frontmatter auf ein Regal, in dem die
    // Datei gar nicht liegt.
    scope,
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
    // #360: MERGED, not replaced — `optional()` would let a save that names one
    // sibling drop every earlier quittance, and the gate would then ask about a
    // pair the agent has already answered for.
    ...mergedSiblings(),
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
    // #240/A6 gilt auch hier: diese Felder wurden ausschließlich aus dem Input
    // gesetzt, ohne Blick auf den Bestand — ein Refresh, der nur `summary` oder
    // `read_status` schickt, warf url/og_image/categories/source_app aus dem
    // File. Dieselbe Patch-Semantik wie oben: Input gewinnt, sonst Bestand,
    // sonst bleibt das Feld weg.
    Object.assign(
      fm,
      optional("url", input.url, isStr),
      optional("categories", input.categories, isArr),
      optional("read_status", input.read_status, isStr),
      optional("og_image", input.og_image, isStr),
      optional("source_app", input.source_app, isStr),
    );
    // #240/A6 auch hier: `saved_at` ist die Erfassungszeit des Bookmarks (das
    // Bookmark-Pendant zu `created`), nicht die letzte Schreibzeit — niemand im
    // Stack leitet daraus Staleness ab. Ohne Carry-over restampte jedes
    // Overwrite den Importzeitpunkt des Bookmarks auf jetzt.
    fm.saved_at = input.saved_at ?? kept<string>(prev.saved_at, isStr) ?? new Date().toISOString();
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
  const commitLock = `${filePath}.bastra-write.lock`;
  await writeFile(tmp, content, "utf8");
  let lockAcquired = false;
  try {
    await acquireCommitClaim(commitLock, id, filePath);
    lockAcquired = true;

    // #285: compare the exact bytes seen before the candidate was built with
    // the bytes at commit time. The O_EXCL lock serializes every saveMemory
    // writer, including writers in another process; the comparison catches a
    // write that landed before this writer acquired the claim.
    const commitTarget = await readTarget(filePath);
    if (commitTarget !== observedTarget) {
      throw writeConflict(id, filePath, "target changed while the save was being prepared");
    }

    if (commitTarget === null) {
      // rename() replaces an existing destination. A hard link publishes the
      // completed temp inode atomically but fails with EEXIST if any writer
      // creates the target after the comparison.
      try {
        await link(tmp, filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
          throw writeConflict(id, filePath, "target was created during commit");
        }
        throw err;
      }
      await unlink(tmp);
    } else {
      await rename(tmp, filePath);
    }
  } finally {
    await unlink(tmp).catch(() => {});
    if (lockAcquired) await unlink(commitLock).catch(() => {});
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

