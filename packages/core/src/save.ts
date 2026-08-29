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
import { MemoryWriteConflictError } from "./save-schema.js";
import { extractWikilinks, todayISO, dedupe } from "./save-text.js";
import { fileExists, readTarget, writeConflict } from "./save-commit.js";
import { withIdClaim, type IdClaim } from "./id-transaction.js";
import { sameFile } from "./file-identity.js";
import { normalizeScopeKey } from "./scope.js";
import { resolveMemoryTarget } from "./save-target.js";
import { moveToTrashUnderClaim } from "./audit-log.js";
import { areaKeyForPath, assertAreaWritable, withAreaShared } from "./area-claim.js";
import { newOperationId, reportMutationIncident } from "./mutation-incident.js";
import { readOccupant, scanVaultForId, vaultRelative, type Located } from "./memory-locator.js";

/**
 * Die Frontmatter-Felder, die DIESER Save-Pfad selbst verwaltet (C-084,
 * entschieden am 29.08.2026).
 *
 * Der Save baut das Frontmatter aus einer festen Feldliste NEU, statt das
 * bestehende zu patchen — jeder Key, den er nicht kennt, fiel deshalb bei jedem
 * Overwrite weg. Für einen Vault, der in Obsidian liegt, heißt das: `aliases`
 * aus dem Properties-Panel, `cssclasses`, ein Dataview-Feld, ein Tag-Plugin —
 * alles einmal in der App gesetzt und beim nächsten Save des Agenten still
 * verloren. Seit dieser Entscheidung überleben fremde Keys ein Overwrite
 * unverändert.
 *
 * DIE LISTE IST DIE KOLLISIONSREGEL: Was hier steht, gehört dem Save-Pfad —
 * er setzt es aus Input und Bestand nach seinen eigenen Regeln, und ein
 * gleichnamiger Wert aus der alten Datei kann ihn nicht überstimmen. Bekannt
 * schlägt fremd. Alles andere wird unverändert durchgereicht.
 *
 * Sie enthält deshalb AUCH die Felder, die der Save bewusst WEGLÄSST: Die
 * Bookmark-Felder (`url`, `read_status`, …) werden nur bei `type: "bookmark"`
 * geschrieben, damit ein Memory kein bookmark-förmiges Frontmatter bekommt.
 * Stünden sie nicht hier, machte ein Typwechsel bookmark→reference sie zu
 * „fremden" Keys und trüge sie genau in die Datei zurück, aus der sie
 * herausgehalten werden sollen.
 *
 * Wer ein Feld ergänzt, das der Save schreibt, trägt es hier ein. Vergisst er
 * es, wird das Feld als fremd behandelt und aus dem Bestand zurückgeholt —
 * `save-unknown-keys.test.ts` prüft genau diesen Fall für die Felder, bei denen
 * das Weglassen Absicht ist.
 */
export const SAVE_MANAGED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  // Kernfelder, bei jedem Save geschrieben
  "id",
  "title",
  "type",
  "summary",
  "topic_path",
  "tags",
  "scope",
  "recall_when",
  "related",
  "aliases",
  "related_via",
  "sensitivity",
  "write_origin",
  "confidence",
  "created",
  "updated",
  "affects_files",
  "issues",
  // Optionale Felder: Input gewinnt, sonst Bestand, sonst weg
  "recall_when_expanded",
  "recall_when_expanded_src",
  "valid_until",
  "expires_after_days",
  "last_reviewed_at",
  "stale_status",
  "content_hash",
  "content_size",
  "source",
  "replaces",
  "siblings",
  "verify_cmd",
  "superseded_by",
  "salience",
  "emotion",
  "recall_mode",
  // Bookmark-Felder — nur bei `type: "bookmark"` gesetzt, siehe oben
  "url",
  "categories",
  "read_status",
  "og_image",
  "source_app",
  "saved_at",
]);

/**
 * Build the .md content for a new memory and write it into the vault.
 * The vault watcher will pick it up and index it automatically.
 */
export async function saveMemory(
  vaultRoot: string,
  input: SaveMemoryInput,
  commit: SaveMemoryCommitOptions = {},
): Promise<SaveMemoryResult> {
  const locator = commit.locator ?? { locate: (wanted: string) => scanVaultForId(vaultRoot, wanted) };
  // Der injizierte Locator macht hier nur noch das ROUTING: In welchem Regal
  // und in welcher Schreibweise liegt diese id, damit ein Bestands-Memory
  // nicht plötzlich woanders auftaucht. Die verbindliche Frage — gehört die
  // id schon jemandem? — stellt die Transaktion unten, und zwar an die Platte.
  const { id, filePath, scope, existingPath } = resolveMemoryTarget(vaultRoot, input, locator);
  // REIHENFOLGE: Area-Claim VOR ID-Claim, überall im Vault dieselbe.
  //
  // Codex-Gegenreview Runde 10 (P0-1): Der Grabstein wurde bisher mitten im
  // Save gelesen und danach noch geparst, gebaut, geschrieben und umbenannt.
  // Nachgestellt: Zwischen der Prüfung und dem Publish lief ein kompletter
  // Area-Rename durch — der Save veröffentlichte trotzdem im alten Regal, und
  // danach existierten beide. Der SHARED Area-Claim hält das Regal über den
  // GESAMTEN Publish; er schließt Saves untereinander nicht aus (die ändern das
  // Regal nicht), nur gegen Create/Rename/Delete.
  //
  // Codex-Abschlussprüfung (P0-2): Gesperrt wurde der SCOPE. Das physische Ziel
  // kann durch `folder` aber ein ganz anderes Regal sein — bestätigt mit einem
  // gehaltenen `people`-Lock und `saveMemory({ scope: "carnexus", folder:
  // "memories/people" })`, das glatt durchlief. Der Schlüssel kommt deshalb aus
  // dem AUFGELÖSTEN Pfad. Beim Re-Filing sind es zwei Regale: das Ziel und die
  // Quelle, die gleich getrasht wird.
  //
  // Restfenster, bewusst offen: Findet der autoritative Scan unter dem ID-Claim
  // eine Quelle, die die Routing-Auskunft nicht kannte (veralteter Index), ist
  // deren Regal hier nicht mitgesperrt. Es früher zu wissen hieße, den
  // Vaultscan VOR den Area-Claim zu ziehen — und damit die Auskunft, um die es
  // geht, wieder ohne Sperre zu erheben.
  return withAreaShared(vaultRoot, [areaKeyForPath(vaultRoot, filePath), existingPath !== undefined ? areaKeyForPath(vaultRoot, existingPath) : null], () =>
    withIdClaim({ vaultRoot, id, filePath, op: input.overwrite ? "save_memory_update" : "save_memory_create" }, (claim) =>
      commitMemory(vaultRoot, input, commit, { id, filePath, scope }, claim),
    ),
  );
}

/**
 * Wohnt diese id bereits woanders im Vault?
 *
 * `located` kommt aus der ID-Transaktion und damit von der PLATTE. Vorher
 * fragte diese Prüfung den injizierten Locator — im Daemon also den geladenen
 * Vault-Index. Stammte der aus einem anderen Prozess und war veraltet, meldete
 * er `none`, obwohl die id längst irgendwo lebte, und zwei Saves derselben id
 * in verschiedene Regale gelangen beide. Ein Lock um eine falsche Antwort
 * herum serialisiert nur den Fehler.
 */
function assertIdIsNotClaimedElsewhere(
  vaultRoot: string,
  id: string,
  filePath: string,
  overwrite: boolean,
  located: Located,
): void {
  // Ein Scan mit blindem Fleck darf nicht als „die id ist frei" durchgehen:
  // Hinter dem Ordner, den er nicht öffnen konnte, kann dasselbe Memory
  // liegen, und der Save legte daneben ein zweites File mit derselben id an —
  // genau der stille Defekt aus #240/A2.3, nur ohne dass ihn jemand sieht.
  if (located.kind === "incomplete") {
    throw new Error(
      `cannot verify where memory '${id}' lives: the vault scan could not read ` +
        `${located.unreadable.map((p) => vaultRelative(vaultRoot, p)).join(", ")}. ` +
        `Fix the permissions before saving — writing now could create a second file with the same id.`,
    );
  }
  // Ein `ambiguous` ist ein Vault-Defekt (#240/A2.3), keine Wahlmöglichkeit:
  // Der Index nimmt still eine der Dateien, und ein Save, der die andere
  // trifft, lässt die Kopie unverändert stehen. Lieber laut abbrechen.
  if (located.kind === "ambiguous") {
    throw new Error(
      `memory '${id}' exists in more than one file: ` +
        `${located.filePaths.map((p) => vaultRelative(vaultRoot, p)).join(", ")}. ` +
        `Remove or rename all but one before saving — the index silently loads only one of them.`,
    );
  }
  // Dieselbe id an einem ANDEREN Ort ist eine Kollision, kein freier Platz.
  // Ohne diese Prüfung legten zwei Saves derselben id in zwei `folder`-Regalen
  // beide erfolgreich eine Datei an, und nach dem nächsten Neustart lud der
  // Vault nur die alphabetisch erste.
  //
  // Mit `overwrite` ist es dagegen ein bewusstes Re-Filing (#64): Der Caller
  // benennt DIESES Memory und einen neuen Ort dafür. Das Aufräumen der alten
  // Datei liegt bei ihm — `tool-handlers.ts` trasht sie, sobald der Pfad sich
  // geändert hat, und warnt, wenn das misslingt.
  //
  // `sameFile` statt Stringvergleich: Auf einem case-insensitiven Dateisystem
  // ist der Fund unter anderer Schreibweise DIESELBE Datei, keine Kollision.
  if (!overwrite && located.kind === "unique" && !sameFile(located.filePath, filePath)) {
    throw new Error(
      `memory already exists: ${id} (at ${vaultRelative(vaultRoot, located.filePath)}). ` +
        `Saving it to ${vaultRelative(vaultRoot, filePath)} would create a second file with the ` +
        `same id — pass the existing folder, or pick a different id.`,
    );
  }
}

/**
 * Der Rumpf des Saves — vollständig UNTER der ID-Transaktion.
 *
 * Alles hier drin, von der ersten Prüfung bis zum Rename, sieht denselben
 * Vault: kein anderer Writer kann in der Zwischenzeit dieselbe id belegen.
 * Vorher lief die Prüfung vor dem Lock und der Commit darin, und dazwischen
 * lag genau das Fenster, in dem zwei Saves derselben id zwei Dateien anlegten.
 */
async function commitMemory(
  vaultRoot: string,
  input: SaveMemoryInput,
  commit: SaveMemoryCommitOptions,
  target: { id: string; filePath: string; scope: string },
  claim: IdClaim,
): Promise<SaveMemoryResult> {
  const { id, filePath: filePath0, scope } = target;
  // EINE autoritative Auskunft für die gesamte Transaktion: Sie beantwortet
  // die Kollisionsfrage, sie bestimmt das ZIEL, und sie sagt, welche Datei
  // beim Re-Filing die Vorlage ist.
  const located = await claim.locate();

  // Codex-Gegenreview (P0): Der Zielpfad kam aus dem injizierten Locator, also
  // im Daemon aus dem Vault-Index — und der darf veraltet sein. War die Datei
  // extern von `memories/projects/p/` nach `memories/people/` gezogen, routete
  // der Save weiter auf den alten Pfad, und die autoritative Auskunft las die
  // Abweichung als bewusstes Re-Filing: Am Ende lagen zwei aktive Dateien mit
  // einer id.
  //
  // Die Unterscheidung, die vorher fehlte: Ein vom Index ABGELEITETER Ordner
  // ist kein Re-File-Auftrag. Nur ein ausdrücklich übergebener `folder` ist
  // einer. Ohne ihn gewinnt deshalb die Platte — sie weiß, wo das Memory
  // wirklich liegt.
  const filePath =
    input.folder === undefined && located.kind === "unique" && !sameFile(located.filePath, filePath0)
      ? located.filePath
      : filePath0;

  assertIdIsNotClaimedElsewhere(vaultRoot, id, filePath, input.overwrite === true, located);

  // Gehört der Zielscope überhaupt noch einer lebenden Area? Ein Grabstein
  // unter `.bastra/areas/` sagt: Dieser Regalname ist umgezogen oder gelöscht.
  // Nachgestellt (siehe area-claim.ts): Ein Save mit dem ALTEN Scope kam nach
  // dem Rename an und legte das gerade weggezogene Regal einfach neu an —
  // danach existierten beide. Die Prüfung steht UNTER dem Claim und vor jedem
  // Schreibvorgang: Der Grabstein ist ein Fakt auf der Platte, also wird er
  // gelesen wie die autoritative Auskunft daneben.
  await assertAreaWritable(vaultRoot, scope);
  // Und dasselbe für das Regal, in das wirklich geschrieben wird: Ein
  // ausdrücklicher `folder` kann auf ein ANDERES Projektregal zeigen als der
  // Scope, und dessen Grabstein blieb dann ungelesen (dieselbe Klasse wie
  // P0-2, nur auf der Grabstein-Achse statt auf der Lock-Achse).
  const shelf = areaKeyForPath(vaultRoot, filePath);
  if (shelf !== null && shelf !== normalizeScopeKey(scope)) {
    await assertAreaWritable(vaultRoot, shelf);
  }

  const observedTarget = await readTarget(filePath);
  const exists = observedTarget !== null;

  // Wer am Ziel liegt, entscheidet, ob überhaupt geschrieben werden darf.
  // Vorher galt „belegt = das ist mein Memory", und daraus wurden drei
  // Datenverlust-Pfade: eine gewöhnliche Obsidian-Notiz am kanonischen
  // Zielpfad wurde bei `overwrite: true` ersetzt, ein FREMDES Memory am
  // selben Pfad wurde überschrieben und dabei auf die neue id umgeschrieben,
  // und eine Notiz mit einem zufälligen YAML-Feld `id` galt als Memory.
  // `overwrite` ist die Erlaubnis, DIESES Memory zu ersetzen — nie die,
  // irgendeine Datei zu ersetzen.
  if (exists) {
    const occupant = readOccupant(filePath);
    // Unlesbar ist nicht frei: Wer die Datei nicht lesen kann, kann auch nicht
    // behaupten, sie gehöre ihm. Ohne diesen Zweig war eine gewöhnliche Notiz
    // mit Dateimodus 000 ungeschützt — die Prüfung sah `absent`.
    if (occupant.kind === "unreadable") {
      throw new Error(
        `refusing to overwrite ${vaultRelative(vaultRoot, filePath)}: the file exists but ` +
          `cannot be read (${occupant.reason}), so it cannot be shown to be memory '${id}'. ` +
          `Fix its permissions, or move it out of the way.`,
      );
    }
    if (occupant.kind === "foreign") {
      throw new Error(
        `refusing to overwrite ${vaultRelative(vaultRoot, filePath)}: it is not a memory ` +
          `(no valid memory frontmatter). Pick a different id, or move that file out of the way.`,
      );
    }
    if (occupant.kind === "memory" && occupant.id !== id) {
      throw new Error(
        `refusing to overwrite ${vaultRelative(vaultRoot, filePath)}: it holds memory ` +
          `'${occupant.id}', not '${id}'. Two memories cannot share one file.`,
      );
    }
  }

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
  //
  // Und die Vorlage ist die QUELLE, nicht das Ziel. Codex-Gegenreview (P0):
  // Beim Re-Filing in ein anderes Regal existiert das Ziel noch gar nicht,
  // also war `prev` leer — und ein Verschieben löschte still genau die Felder,
  // die der Patch oben schützen soll. Nachgestellt an einem Memory mit
  // `created: 2020`, `related`, `related_via`, `sensitivity: private`,
  // `source` und `confidence: 0.4`: danach stand `created` auf heute, die
  // Beziehungen waren leer, `sensitivity` auf `team`, `source` weg,
  // `confidence` auf 1. Die Basis kommt deshalb aus derselben autoritativen
  // Auskunft, unter derselben Transaktion — nicht aus nachkopierten
  // Einzelfeldern in den Aufrufern.
  const refiledFrom =
    input.overwrite && located.kind === "unique" && !sameFile(located.filePath, filePath)
      ? located.filePath
      : null;
  // Fail-closed: Ist die Vorlage unlesbar, wird nicht „ohne sie" geschrieben —
  // das wäre exakt der Metadatenverlust, den dieser Zweig verhindert.
  // `readTarget` wirft auf allem außer ENOENT.
  const baseRaw = refiledFrom !== null ? await readTarget(refiledFrom) : observedTarget;
  let prev: Record<string, unknown> = {};
  if (baseRaw !== null) {
    try {
      // Copy, don't alias: gray-matter caches matter(content) by string, so the
      // object handed back here is shared with every other parse of identical
      // content. The Date coercion below writes into `prev` — without this copy
      // it would poison that cache entry and hand a later parser a string where
      // the file says Date. Same reasoning as related-enrich.ts:230 and
      // trigger-expand.ts:322.
      prev = { ...((matter(baseRaw).data as Record<string, unknown> | undefined) ?? {}) };
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
  // Codex-Gegenreview (P1): Das Audit-Vorbild bildeten die AUFRUFER selbst —
  // aus dem Vault-Cache, aus dem Zielpfad oder aus einem zweiten Vaultscan
  // neben der Mutation. Nachgestellt: Bei einem audit-behafteten Re-File
  // meldete `diff_before` Version 1, während der Save tatsächlich Version 0.4
  // (die Quelldatei) als Vorlage benutzt hat, und `saveMemoryWithAuditTrail`
  // schrieb bei einem normalen Re-File `operation: update` mit
  // `diff_before: null`. Die Mutation kennt ihr Vorbild aber genau — sie hat
  // es gerade unter dem Claim gelesen. Also gibt sie es heraus, statt es
  // rekonstruieren zu lassen. Das spart nebenbei den zweiten Vaultscan.
  const auditBefore = baseRaw === null ? null : cloneForAudit(prev);

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

  // C-084: Was der Save-Pfad nicht kennt, gehört ihm auch nicht — es überlebt
  // das Overwrite unverändert. Steht am ENDE, nachdem `fm` fertig ist: Die
  // Prüfung gegen `SAVE_MANAGED_FRONTMATTER_KEYS` entscheidet die Kollision
  // (bekannt schlägt fremd), `key in fm` fängt zusätzlich ein verwaltetes Feld
  // ab, das jemand in `fm` ergänzt und in der Liste vergessen hat.
  //
  // Die Werte werden NICHT geprüft oder normalisiert. Ein fremdes Feld hat für
  // uns keine Semantik — es zu validieren hieße, sie ihm zuzuschreiben, und
  // eine Reparatur nach unseren Regeln wäre für den Besitzer des Feldes eine
  // stille Änderung. Bei einer Neuanlage (`prev` leer) passiert hier nichts.
  for (const [key, value] of Object.entries(prev)) {
    if (SAVE_MANAGED_FRONTMATTER_KEYS.has(key)) continue;
    if (key in fm) continue;
    fm[key] = value;
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
    // #285: compare the exact bytes seen before the candidate was built with
    // the bytes at commit time. Die ID-Transaktion serialisiert jeden Writer,
    // der diese id beansprucht — auch in einem anderen Prozess; der Vergleich
    // fängt einen Schreibvorgang, der VOR dem Claim gelandet ist.
    const commitTarget = await readTarget(filePath);
    if (commitTarget !== observedTarget) {
      throw writeConflict(id, filePath, "target changed while the save was being prepared");
    }

    // Codex-Gegenreview (P0): Beim Re-Filing war die QUELLE die Patch-Vorlage
    // (`baseRaw`), aber verglichen wurde vor dem Publish nur das ZIEL — und
    // getrasht wurde die Quelle danach ungeprüft. Der id-Lock hilft dagegen
    // nicht: Ein externer Writer (Obsidian, Cloud-Sync) kennt ihn nicht.
    // Nachgestellt: Re-File beginnt auf `source: before-external`, während die
    // fertige Tempdatei geschrieben wird ersetzt eine externe Bearbeitung die
    // Quelle durch `source: after-external`, das Re-File meldet Erfolg — und
    // das aktive Memory trägt danach `before-external`, die neuere Fassung
    // liegt nur noch im Trash. Wiederherstellbar, aber aus dem aktiven Bestand
    // still verschwunden.
    //
    // Der Vergleich steht VOR dem Publish, nicht vor dem Trash: Danach wäre
    // das neue Ziel schon veröffentlicht und der Konflikt nur noch per
    // Rollback zurückzunehmen. So ist nichts geschrieben und nichts getrasht.
    if (refiledFrom !== null) {
      const commitSource = await readTarget(refiledFrom);
      if (commitSource !== baseRaw) {
        throw writeConflict(
          id,
          refiledFrom,
          "the source file changed while the re-file was being prepared",
        );
      }
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
  }

  // Das Re-Filing ist erst hier zu Ende: Die neue Datei steht, die ALTE muss
  // weg. Codex-Gegenreview (P0): Dieses Aufräumen lag in den Aufrufern
  // (`tool-handlers.ts`, `auditedSave`) und lief NACH der Freigabe des
  // id-Locks — ein direkter `saveMemory(overwrite, folder)` räumte gar nicht
  // auf und meldete obendrein `created: true`, und ein Absturz dazwischen
  // hinterließ zwei aktive Dateien mit einer id. Ein Umzug ist eine
  // Operation, also gehört er ganz unter denselben Claim.
  if (refiledFrom !== null) {
    try {
      // Codex-Gegenreview (P0): Die Quelle wurde VOR dem Publish gegen
      // `baseRaw` geprüft und danach ungeprüft weggeräumt. Eine externe
      // Änderung, die genau dazwischen eintraf — also sobald das neue Ziel
      // sichtbar wurde —, ging still verloren. Nachgestellt:
      //
      //   outcome: fulfilled, sourceExists: false,
      //   activeHasBastra: true, activeHasExternal: false,
      //   trashHasExternal: true
      //
      // Die alte Fassung stand aktiv im Vault, die neuere lag nur noch im
      // Trash — wiederherstellbar, aber aus dem Bestand verschwunden, und der
      // Save meldete Erfolg. Prüfung und Rename liegen deshalb beieinander,
      // in `moveToTrashUnderClaim`. Bei Abweichung wird der Ziel-Publish
      // zurückgenommen und die Quelle bleibt aktiv: Ein Write-Conflict, den
      // der Aufrufer wiederholen kann, statt eines stillen Verlusts.
      await moveToTrashUnderClaim(vaultRoot, refiledFrom, claim, baseRaw);
    } catch (err) {
      // Die Quelle steht noch, das neue Ziel auch — das wären zwei aktive
      // Dateien mit einer id. Also zurück, so weit es geht: Ein Ziel, das wir
      // gerade erst angelegt haben, wird entfernt; ein überschriebenes bekommt
      // seine Vorbilder-Bytes zurück.
      const undone = await rollbackPublish(filePath, observedTarget);
      // #377: Genau hier entsteht der einzige Zustand dieser Funktion, den ein
      // Mensch anfassen muss — zwei aktive Dateien mit einer id. Der Aufrufer
      // erfährt ihn als Fehlermeldung, aber niemand sonst; ohne Incident ist
      // er nach dem nächsten Terminalfenster verschwunden.
      reportMutationIncident({
        operation_id: newOperationId(),
        op: "save_memory_refile",
        status: undone ? "rolled_back" : "partial",
        phase: "refile-trash",
        memory_id: id,
        rollback: undone ? "complete" : "none",
        detail: err instanceof MemoryWriteConflictError ? "source changed" : "trash failed",
      });
      // Der Grund zählt für den Aufrufer: „jemand hat die Quelle geändert" ist
      // wiederholbar, „der Trash ist kaputt" nicht. Ein Konflikt bleibt
      // deshalb ein Konflikt (`MEMORY_WRITE_CONFLICT`) — aber nur, wenn das
      // Rollback wirklich alles zurückgenommen hat; sonst steht ein
      // Doppelzustand im Vault, und den darf keine Retry-Logik übersehen.
      if (undone && err instanceof MemoryWriteConflictError) throw err;
      throw new Error(
        `re-file aborted: ${vaultRelative(vaultRoot, refiledFrom)} could not be trashed ` +
          `(${(err as Error).message}). ` +
          (undone
            ? `Nothing was changed.`
            : `AND ${vaultRelative(vaultRoot, filePath)} could not be rolled back — both files ` +
              `now carry id '${id}'. Remove or fix one of them by hand.`),
      );
    }
  }

  return {
    id,
    file_path: filePath,
    // Ein Umzug erschafft nichts. Vorher meldete er `created: true`, weil das
    // ZIEL neu war — der Aufrufer konnte einen Move nicht von einem Neuanlegen
    // unterscheiden.
    created: !exists && refiledFrom === null,
    // Vor- und Nachbild, beide unter DIESEM Claim entstanden: das Vorbild aus
    // der Datei, die wirklich die Vorlage war (beim Re-File die Quelle, nicht
    // das Ziel), das Nachbild aus dem Frontmatter, das eben geschrieben wurde.
    audit_before: auditBefore,
    audit_after: cloneForAudit(fm),
    ...(refiledFrom !== null ? { refiled_from: refiledFrom } : {}),
    ...(summaryTruncated
      ? {
          summary_note:
            `summary was auto-truncated to ${SUMMARY_MAX} chars; ` +
            `write it shorter next time (the full text lives in the body, not the summary).`,
        }
      : {}),
  };
}

/**
 * Ein Frontmatter-Abbild fürs Audit — TIEF kopiert.
 *
 * Codex-Gegenreview (P1): gray-matter cached `matter(content)` je Input-String
 * und gibt allen Parsern desselben Inhalts DASSELBE `data`-Objekt zurück. Wer
 * es einfach durchreicht, hält über mehrere `await`s hinweg einen fremden
 * Cache-Eintrag: Der Reviewer konnte ein bereits gebildetes `diff_before`
 * NACHTRÄGLICH verändern, indem ein zweiter Parser den Eintrag mutierte.
 * Dieselbe Falle wie in related-enrich.ts:230 und trigger-expand.ts:322 — hier
 * aber über den JSON-Umweg, weil das Abbild ohnehin als JSON im Ledger landet
 * (Dates werden dabei zu ISO-Strings, genau wie beim Schreiben des Logs).
 */
function cloneForAudit(fm: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
}

/**
 * Ein gerade veröffentlichtes Ziel zurücknehmen. `true`, wenn der Zustand von
 * vor dem Commit wiederhergestellt ist.
 *
 * `preimage === null` heißt „das Ziel gab es nicht" — dann ist Entfernen die
 * Rücknahme. Sonst müssen die alten Bytes zurück, und zwar atomar: Ein halb
 * geschriebenes Rollback wäre schlimmer als gar keins.
 */
async function rollbackPublish(filePath: string, preimage: string | null): Promise<boolean> {
  try {
    if (preimage === null) {
      await unlink(filePath);
      return true;
    }
    const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.undo`;
    await writeFile(tmp, preimage, "utf8");
    await rename(tmp, filePath);
    return true;
  } catch {
    return false;
  }
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
 *
 * Codex-Gegenreview (P0): Dieser Writer war öffentlich exportiert und lief an
 * der ID-Transaktion vorbei — ein blindes `unlink` auf einen Pfad, den ein
 * (möglicherweise veralteter) Index geliefert hat. Zwei Löcher in einem:
 * Erstens sah er keinen parallelen Save derselben id, zweitens ist ein Pfad
 * kein Identitätsbeweis — liegt dort inzwischen ein ANDERES Memory oder eine
 * gewöhnliche Notiz, löschte er die. `vaultRoot` ist deshalb Pflicht, der
 * Claim gilt für die id, und gelöscht wird nur, was unter dem Lock erkennbar
 * DIESES Memory ist.
 */
export async function deleteMemoryFile(
  filePath: string,
  id: string,
  opts: { vaultRoot: string },
): Promise<DeleteMemoryResult> {
  return withIdClaim(
    { vaultRoot: opts.vaultRoot, id, filePath, op: "delete_memory_file" },
    async () => {
      if (!(await fileExists(filePath))) {
        throw new Error(`memory file not found: ${filePath}`);
      }
      const occupant = readOccupant(filePath);
      if (occupant.kind !== "memory" || occupant.id !== id) {
        throw new Error(
          `refusing to delete ${vaultRelative(opts.vaultRoot, filePath)}: it does not hold ` +
            `memory '${id}' (found ${occupant.kind === "memory" ? `'${occupant.id}'` : occupant.kind}). ` +
            `Re-resolve the path — a stale index entry must not delete a foreign file.`,
        );
      }
      await unlink(filePath);
      return { id, file_path: filePath, deleted: true };
    },
  );
}

