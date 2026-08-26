/**
 * Area management (#216) — create / rename / delete the vault's top-level
 * areas ("Überbereiche": individual projects under memories/projects/, and
 * user-defined top folders under memories/) from the map.
 *
 * Ground rules, from the vault's own physics:
 *   - An area IS a folder; memory ids are filenames and stay stable across
 *     renames — only paths (and, for project areas, the `scope:` frontmatter)
 *     change. related[]-links keep working by construction.
 *   - Delete is never destructive: the whole folder moves into the vault
 *     trash (`.bastra/trash/areas/<name>-<timestamp>/`), recoverable by hand.
 *   - Reserved system folders (projects, user, all-projects, taxonomy) route
 *     saves (save.ts subfolderFor) and are not editable.
 *   - After any bulk move the caller heals the index with ONE
 *     vault.reconcile() — drops run before adds there, so renames resolve
 *     cleanly. Never mix per-file reindexFile into a bulk move.
 */
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { assertInsideDir, assertInsideVault, assertOwnSubdir, isMarkdownFile, isPathSafeComponent, mutateMemoryFile, readOccupant, slugify } from "@bastra-recall/core";
import { normalizeScopeKey, scopeEquals } from "@bastra-recall/core/scope";
import { sendJsonPlain } from "./webui.js";
import { getUiEnabled } from "./settings.js";

/** Folders under memories/ whose names the save-routing depends on. */
const RESERVED_TOP = new Set(["projects", "user", "all-projects", "taxonomy"]);

/**
 * Reserviert-Sein ist eine Frage der Scope-Identität, nicht der Schreibweise.
 *
 * Der Vergleich lief exakt gegen den Ordnernamen. Auf case-insensitivem APFS
 * zeigt `memories/Projects` aber auf genau denselben Ordner wie
 * `memories/projects`: über den Namen `Projects` ging das reservierte
 * Projekt-Regal als editierbarer Top-Bereich durch und ließ sich vollständig
 * umbenennen. Dieselbe zentrale Faltung wie überall sonst, statt einer
 * eigenen Kopie.
 */
function isReservedTop(name: string): boolean {
  return RESERVED_TOP.has(normalizeScopeKey(name));
}

export interface AreaInfo {
  /** Folder name — for project areas this is the scope. */
  name: string;
  /** "project" = memories/projects/<name>, "top" = memories/<name>. */
  kind: "project" | "top";
  /** Markdown files in the area, recursive. */
  count: number;
  /** Reserved system areas are listed but not editable. */
  reserved: boolean;
}

/**
 * Liegt dort ein Verzeichnis?
 *
 * Codex-Gegenreview: Jeder `stat`-Fehler galt als „nein". Ein Doku-Regal, das
 * nur nicht LESBAR war, sah damit aus wie ein nicht vorhandenes — der Rename
 * meldete Erfolg, das Projekt war umbenannt, die Dokumentation blieb unter dem
 * alten Namen; das Delete meldete Erfolg, die Memories lagen im Trash, die
 * Dokumentation blieb aktiv. Nur ENOENT/ENOTDIR beweisen Abwesenheit, alles
 * andere ist eine offene Frage und muss die Operation anhalten.
 */
async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw new Error(
      `cannot tell whether ${p} exists (${code ?? String(err)}) — refusing to continue: ` +
        `treating it as absent would leave the area half moved.`,
    );
  }
}

async function countMarkdown(dir: string): Promise<number> {
  let n = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    if (e.isDirectory()) n += await countMarkdown(join(dir, e.name));
    else if (e.isFile() && isMarkdownFile(e.name)) n++;
  }
  return n;
}

/** All areas: memories/<top> (minus projects) + memories/projects/<scope>. */
export async function listAreas(vaultRoot: string): Promise<AreaInfo[]> {
  const out: AreaInfo[] = [];
  const memRoot = join(vaultRoot, "memories");
  let tops: string[] = [];
  try {
    tops = (await readdir(memRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of tops.sort()) {
    if (name === "projects") continue;
    out.push({
      name,
      kind: "top",
      count: await countMarkdown(join(memRoot, name)),
      reserved: isReservedTop(name),
    });
  }
  const projRoot = join(memRoot, "projects");
  try {
    const projects = (await readdir(projRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
    for (const name of projects.sort()) {
      out.push({ name, kind: "project", count: await countMarkdown(join(projRoot, name)), reserved: false });
    }
  } catch {
    // no projects folder yet — fine
  }
  return out;
}

function areaPath(vaultRoot: string, kind: "project" | "top", name: string): string {
  const memRoot = join(vaultRoot, "memories");
  const parent = kind === "project" ? join(memRoot, "projects") : memRoot;
  const p = join(parent, name);
  // Belt-and-suspenders containment — name is validated, but re-check the join.
  if (!resolve(p).startsWith(resolve(vaultRoot) + sep)) {
    throw new Error(`refusing to touch a path outside the vault: ${p}`);
  }
  // Codex-Gegenreview (P0): Die Prüfung war rein lexikalisch. Ein
  // Projektordner, der als Symlink nach außen zeigt, ging glatt durch — und
  // `renameArea()` schrieb dann in fremden Dateien außerhalb des Vaults die
  // Scopes um.
  //
  // Sicherheitsrunde: Die Grenze ist nicht der Vault, sondern das ELTERNREGAL.
  // Ein Projektordner als Symlink auf `memories/people` oder auf
  // `dokumentationen/` verlässt den Vault nicht — er verlässt aber den Bereich,
  // den diese Area besitzt, und ein Rename schrieb dort fremde Scopes um oder
  // schob ein fremdes Regal in den Trash.
  assertInsideVault(vaultRoot, parent, "touch an area");
  assertInsideDir(parent, p, "touch an area", `${kind === "project" ? "memories/projects" : "memories"}`);
  return p;
}

/**
 * Das Doku-Regal einer Area — mit derselben Grenze wie das Memory-Regal.
 *
 * Sicherheitsrunde: Diese beiden Pfade wurden bisher nur zusammengesetzt.
 * `dokumentationen/<name>` als Symlink auf ein anderes Regal ließ den Rename
 * dort fremde Dokumente umschreiben und das Delete sie in den Trash schieben —
 * gemeldet als „die Area ist umgezogen".
 */
function docsShelfPath(vaultRoot: string, name: string): string {
  const parent = join(vaultRoot, "dokumentationen");
  const p = join(parent, name);
  assertInsideVault(vaultRoot, parent, "touch a docs shelf");
  assertInsideDir(parent, p, "touch a docs shelf", "dokumentationen");
  return p;
}

function assertEditable(kind: "project" | "top", name: string): void {
  if (!isPathSafeComponent(name)) {
    throw new Error(`invalid area name: ${JSON.stringify(name)}`);
  }
  if (kind === "top" && isReservedTop(name)) {
    throw new Error(`"${name}" is a reserved system area and cannot be changed`);
  }
}

/** New project area — an empty folder; it shows on the map once the first
 *  memory lands in it, and immediately in the areas manager. */
export async function createArea(vaultRoot: string, rawName: string): Promise<AreaInfo> {
  const name = slugify(rawName);
  assertEditable("project", name);
  const dir = areaPath(vaultRoot, "project", name);
  if (await isDir(dir)) throw new Error(`area already exists: ${name}`);
  await mkdir(dir, { recursive: true });
  return { name, kind: "project", count: 0, reserved: false };
}

/** Rewrite `scope:` in every memory frontmatter under dir (recursive) whose
 *  scope equals oldScope. Files without parseable frontmatter are skipped.
 *
 *  #360-Folgefund A: der Vergleich lief exakt (`!== oldScope`) — ein Ordner
 *  `carnexus` mit Frontmatter `scope: CarNexus` wurde verschoben, aber kein
 *  einziger Scope umgeschrieben (`scopesRewritten: 0`), und die Memories waren
 *  danach im eigenen Projekt fremd. Gefaltet über die zentrale
 *  Scope-Identität (`scopeEquals`) statt einer eigenen Kopie. */
async function rewriteScopes(
  vaultRoot: string,
  dir: string,
  oldScope: string,
  newScope: string,
  failed: string[],
): Promise<number> {
  let rewritten = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Codex-Gegenreview (P1): Ein unlesbarer Teilbaum galt als leerer
    // Teilbaum, und der Rename meldete Erfolg über Dateien, die er nie
    // gesehen hat. Was nicht gelesen werden konnte, wird gemeldet.
    failed.push(`${dir} (${(err as NodeJS.ErrnoException)?.code ?? String(err)})`);
    return 0;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      rewritten += await rewriteScopes(vaultRoot, full, oldScope, newScope, failed);
      continue;
    }
    if (!e.isFile() || !isMarkdownFile(e.name)) continue;
    // Codex-Befund 1: die Prüfung war „irgendein YAML-Feld `scope` vorhanden".
    // Nachgestellt: eine gewöhnliche Obsidian-Notiz mit `scope: carnexus` im
    // Projektordner wurde beim Rename umgeschrieben. Was der Vault nicht als
    // Memory indexieren würde, darf ein Rename nicht anfassen — dieselbe
    // Entscheidung wie im Save-Pfad, aus derselben Quelle.
    const occupant = readOccupant(full);
    // Codex-Gegenreview (P1): `unreadable` lief hier durch dieselbe Tür wie
    // „kein Memory". Ein Memory, das nicht gelesen werden konnte, behielt
    // damit still seinen alten Scope, lag danach aber im neuen Ordner — und
    // der Rename meldete Erfolg. Unlesbar ist nicht abwesend.
    if (occupant.kind === "unreadable") {
      failed.push(`${full} (${occupant.reason})`);
      continue;
    }
    if (occupant.kind !== "memory") continue;
    try {
      const outcome = await mutateMemoryFile(
        full,
        occupant.id,
        {
          frontmatter: (fm) => {
            const cur = fm.scope;
            if (typeof cur !== "string" || !scopeEquals(cur, oldScope)) return null;
            return { ...fm, scope: newScope };
          },
        },
        { vaultRoot },
      );
      // `noop` heißt „hier war nichts umzuschreiben" (ein fremdes Memory im
      // Ordner), `raced` und `identity-mismatch` heißen „mein Stempel liegt
      // NICHT drauf". Erst seit `mutateMemoryFile` die beiden trennt, ist das
      // hier ohne Hilfsflagge unterscheidbar.
      if (outcome.kind === "written") rewritten++;
      else if (outcome.kind !== "noop") failed.push(`${full} (${outcome.kind})`);
    } catch (err) {
      // Nicht schreibbar — melden statt still übergehen.
      failed.push(`${full} (${(err as Error).message})`);
    }
  }
  return rewritten;
}

/**
 * Nachprüfung nach dem Umschreiben: Behauptet im umgezogenen Regal noch
 * irgendeine Datei, zur ALTEN Area zu gehören?
 *
 * Codex-Gegenreview (P0): Ein Area-Rename und ein normaler Save waren nicht
 * gegeneinander serialisiert. Nachgestellt: `renameArea(alt → neu)` hatte ein
 * Memory bereits auf `scope: neu` umgeschrieben; danach lief ein gewöhnlicher
 * `saveMemory` derselben id, der noch die ALTE Area-Identität in der Hand
 * hatte. Beide meldeten Erfolg. Endzustand: Datei im neuen Regal, Frontmatter
 * wieder `scope: alt` — im Recall des neuen Projekts als fremd gefiltert, im
 * alten nicht auffindbar. Der id-Lock greift dabei korrekt; er sperrt nur EINE
 * Datei für die Dauer EINER Mutation, und ein Rename ist eine Operation über
 * ein ganzes Regal, die aus vielen solcher Mutationen besteht.
 *
 * ENTSCHEIDUNG (und ihre Grenze, ehrlich benannt): Zwei Wege waren denkbar.
 * Der eine ist eine Area-Marke im Vault (`.bastra/`), die einen laufenden
 * Rename anzeigt und die der Save-Pfad respektieren MÜSSTE — nur der schließt
 * das Fenster wirklich, und er ist nicht hier zu bauen, sondern in
 * `packages/core/src/save.ts`. Der andere, hier gebaute, ist diese
 * Nachprüfung: Nach allen Rewrites wird das umgezogene Regal noch einmal
 * gelesen, und was dort weiterhin den alten Namen trägt, lässt den Rename
 * scheitern und zurückrollen.
 *
 * Was das GARANTIERT: Ein Rename, der Erfolg meldet, hat das Regal zum
 * Zeitpunkt seiner letzten Lesung tatsächlich vollständig umgeschrieben — ein
 * dazwischengeratener Save wird erkannt, nicht verschwiegen, und der Vault
 * bleibt in EINEM der beiden konsistenten Zustände (alt oder neu).
 * Was es NICHT garantiert: Das Fenster ist nicht geschlossen, nur beobachtet.
 * Ein Save, der NACH der Nachprüfung mit der alten Area-Identität schreibt,
 * hinterlässt denselben Zustand wie zuvor — er wird nur von niemandem mehr
 * gesehen. Und die Nachprüfung selbst ist ein zweiter Durchgang: Kosten sind
 * ein weiterer Read je Memory des Regals.
 *
 * Gelesen wird unter demselben id-Lock wie jeder Writer — `frontmatter` gibt
 * immer `null` zurück, die Mutation ist also garantiert ein `noop` und fasst
 * keine Datei an; sie leiht sich nur den Lock und den EINEN Read.
 */
async function findStaleScopes(
  vaultRoot: string,
  dir: string,
  oldScope: string,
  stale: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Wer nicht hinsehen konnte, darf nicht „sauber" behaupten.
    stale.push(`${dir} (${(err as NodeJS.ErrnoException)?.code ?? String(err)})`);
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await findStaleScopes(vaultRoot, full, oldScope, stale);
      continue;
    }
    if (!e.isFile() || !isMarkdownFile(e.name)) continue;
    const occupant = readOccupant(full);
    if (occupant.kind === "unreadable") {
      stale.push(`${full} (${occupant.reason})`);
      continue;
    }
    if (occupant.kind !== "memory") continue;
    let found: string | undefined;
    const outcome = await mutateMemoryFile(
      full,
      occupant.id,
      {
        frontmatter: (fm) => {
          const cur = fm.scope;
          if (typeof cur === "string" && scopeEquals(cur, oldScope)) found = cur;
          return null;
        },
      },
      { vaultRoot },
    );
    // Fremde Scopes bleiben unangetastet — geprüft wird nur, ob der ALTE
    // Area-Name noch irgendwo steht. Ein Memory eines anderen Projekts im
    // Regal war schon vorher keins dieser Area und wird hier keins.
    if (found !== undefined) stale.push(`${full} (scope: ${found})`);
    else if (outcome.kind !== "noop") stale.push(`${full} (${outcome.kind})`);
  }
}

export interface RenameResult {
  name: string;
  scopesRewritten: number;
  docsFolderMoved: boolean;
  /** Produktdokumente, deren topic_path/Tags auf das neue Projekt gezogen
   *  wurden. Die id bleibt bewusst stehen — siehe {@link rewriteDocMetadata}. */
  docsRetagged: number;
}

/**
 * Produktdokumente tragen den Projektnamen nicht nur im Scope, sondern auch in
 * `topic_path[1]` und in den Tags. Die zieht ein Rename mit.
 *
 * Was er ausdrücklich NICHT mitzieht, ist die id (Codex-Gegenreview): Ein
 * Umbenennen von `doku-carnexus-area` nach `doku-new-project-area` bricht
 * jedes `related: [doku-carnexus-area]` und jeden `[[doku-carnexus-area]]` im
 * Vault — der Graph löst keine Aliase auf, es bliebe ein Geisterknoten, und
 * die Verbindung zum echten Dokument wäre weg. Es widerspräche auch der
 * Grundregel dieses Moduls, dass ids einen Rename überleben.
 *
 * Dass der nächste `save_product_doc`-Aufruf das Dokument trotzdem findet,
 * löst der Handler auf der anderen Seite: Er sucht zuerst über Scope + Area
 * im Index und leitet erst dann eine neue id ab. Die id ist damit ein
 * historischer Name, kein Schlüssel — genau wie bei jedem anderen Memory.
 */
/**
 * Die Produktdoku-Signatur, wie sie `findDocFor()` in product-doc-handler.ts
 * liest — dieselbe Frage, dieselbe Antwort: `type: doc`, Scope des Projekts,
 * und ein `topic_path` der Länge 3 in der Form `["doku", <projekt>, <area>]`.
 * Alles andere im Doku-Regal gehört jemand anderem.
 */
function isProductDocOf(data: Record<string, unknown>, projectName: string): boolean {
  if (data.type !== "doc") return false;
  if (typeof data.scope !== "string" || !scopeEquals(data.scope, projectName)) return false;
  const path = data.topic_path;
  if (!Array.isArray(path) || path.length !== 3) return false;
  if (path[0] !== "doku") return false;
  return typeof path[1] === "string" && scopeEquals(path[1], projectName);
}

async function rewriteDocMetadata(
  vaultRoot: string,
  dir: string,
  oldName: string,
  newName: string,
  failed: string[],
): Promise<number> {
  let touched = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    failed.push(`${dir} (${(err as NodeJS.ErrnoException)?.code ?? String(err)})`);
    return 0;
  }
  for (const e of entries) {
    if (!e.isFile() || !isMarkdownFile(e.name)) continue;
    const full = join(dir, e.name);
    // Codex-Befund 2: geprüft wurde weder `type: doc` noch die vollständige
    // Signatur. Nachgestellt: eine normale Notiz im Doku-Regal, die zufällig
    // `tags: [carnexus]` und `topic_path: [doku, carnexus, area]` trug, wurde
    // beim Rename umgeschrieben. Erste Hürde wie überall: Ist das überhaupt
    // ein Memory?
    const occupant = readOccupant(full);
    if (occupant.kind === "unreadable") {
      failed.push(`${full} (${occupant.reason})`);
      continue;
    }
    if (occupant.kind !== "memory") continue;
    try {
      const outcome = await mutateMemoryFile(full, occupant.id, {
        frontmatter: (fm) => {
          if (!isProductDocOf(fm, oldName)) return null;
          const next = { ...fm };
          let changed = false;
          // #360: gefaltet — ein Bestandsdokument kann `doku-CarNexus-…` heißen
          // und `topic_path: [doku, CarNexus, …]` tragen.
          if (Array.isArray(next.topic_path) && typeof next.topic_path[1] === "string" &&
              scopeEquals(next.topic_path[1] as string, oldName)) {
            const path = [...(next.topic_path as unknown[])];
            path[1] = newName;
            next.topic_path = path;
            changed = true;
          }
          if (Array.isArray(next.tags)) {
            const tags = (next.tags as unknown[]).map((t) =>
              typeof t === "string" && scopeEquals(t, oldName) ? newName : t,
            );
            if (tags.some((t, i) => t !== (next.tags as unknown[])[i])) {
              next.tags = tags;
              changed = true;
            }
          }
          return changed ? next : null;
        },
      }, { vaultRoot });
      if (outcome.kind === "written") touched++;
      else if (outcome.kind !== "noop") failed.push(`${full} (${outcome.kind})`);
    } catch (err) {
      failed.push(`${full} (${(err as Error).message})`);
    }
  }
  return touched;
}

/**
 * Rename an area folder. Project areas additionally get their memories'
 * `scope:` frontmatter rewritten (recall filters, hook scope-gate and save
 * routing all key on it) and a sibling `dokumentationen/<scope>` moves along.
 * Memory ids never change, so related[]-links survive by construction.
 */
export async function renameArea(
  vaultRoot: string,
  kind: "project" | "top",
  name: string,
  rawNewName: string,
): Promise<RenameResult> {
  assertEditable(kind, name);
  const newName = slugify(rawNewName);
  assertEditable(kind, newName);
  if (newName === name) throw new Error("new name equals the current name");
  const from = areaPath(vaultRoot, kind, name);
  const to = areaPath(vaultRoot, kind, newName);
  if (!(await isDir(from))) throw new Error(`area not found: ${name}`);
  if (await isDir(to)) throw new Error(`area already exists: ${newName}`);
  // dokumentationen/<scope> is the same area's docs shelf — keep it in step.
  const docsFrom = docsShelfPath(vaultRoot, name);
  const docsTo = docsShelfPath(vaultRoot, newName);
  // Codex-Befund 3: Existierten BEIDE Doku-Regale, verschob der Rename nur das
  // Projektregal, ließ `dokumentationen/<alt>` verwaist zurück, das fremde
  // `dokumentationen/<neu>` stehen — und meldete Erfolg. Die Kollision gehört
  // dem Aufrufer gemeldet, und zwar bevor irgendetwas bewegt ist: eine Area
  // zieht als Ganzes um oder gar nicht.
  if (kind === "project" && (await isDir(docsFrom)) && (await isDir(docsTo))) {
    throw new Error(
      `docs folder already exists: dokumentationen/${newName} — move or merge it first, ` +
        `renaming would leave dokumentationen/${name} behind.`,
    );
  }
  await rename(from, to);

  let scopesRewritten = 0;
  let docsFolderMoved = false;
  let docsRetagged = 0;
  // Codex-Gegenreview (P1): Ein unlesbares Memory im umziehenden Projekt wurde
  // nicht umgeschrieben, der Rename meldete trotzdem Erfolg — die Datei lag
  // danach im neuen Ordner und trug den alten Scope. Was nicht umgeschrieben
  // werden konnte, sammelt sich hier und lässt den Rename zurückrollen: eine
  // Area zieht ganz um oder gar nicht.
  const failed: string[] = [];
  try {
    if (kind === "project") {
      scopesRewritten = await rewriteScopes(vaultRoot, to, name, newName, failed);
      if (await isDir(docsFrom)) {
        await rename(docsFrom, docsTo);
        docsFolderMoved = true;
      }
      // #360-Folgefund B: der Doku-Ordner zog mit, seine Dokumente behielten
      // aber `scope: <alt>` — sie lagen danach im neuen Regal und wurden beim
      // Recall fürs neue Projekt als fremd gefiltert. Betrifft JEDEN Rename,
      // unabhängig von der Schreibweise. Zählt in dieselbe Summe: es sind
      // Scope-Rewrites derselben Area.
      if (await isDir(docsTo)) {
        // Reihenfolge: erst retaggen, dann Scopes. Die Produktdoku-Signatur
        // prüft `scope` gegen den ALTEN Namen — liefe der Scope-Rewrite zuerst,
        // erkennte `rewriteDocMetadata` kein einziges Dokument mehr wieder.
        docsRetagged = await rewriteDocMetadata(vaultRoot, docsTo, name, newName, failed);
        scopesRewritten += await rewriteScopes(vaultRoot, docsTo, name, newName, failed);
      }
    }
    if (failed.length > 0) {
      throw new Error(
        `${failed.length} Datei(en) im Projekt konnten nicht umgeschrieben werden: ` +
          `${failed.join("; ")}`,
      );
    }
    // Die Transaktionsgrenze, die dieser Operation fehlt — siehe
    // {@link findStaleScopes}: Der Rename glaubt sich fertig; nachgesehen wird
    // trotzdem, ob inzwischen wieder jemand den alten Namen hineingeschrieben
    // hat.
    if (kind === "project") {
      const stale: string[] = [];
      await findStaleScopes(vaultRoot, to, name, stale);
      if (await isDir(docsTo)) await findStaleScopes(vaultRoot, docsTo, name, stale);
      if (stale.length > 0) {
        throw new Error(
          `der Rename ist unvollständig: ${stale.length} Datei(en) im umgezogenen Regal ` +
            `tragen weiterhin die alte Area "${name}" — wahrscheinlich hat ein paralleler ` +
            `Save währenddessen mit der alten Area-Identität geschrieben: ${stale.join("; ")}`,
        );
      }
    }
  } catch (err) {
    throw await rollbackRename(
      { vaultRoot, kind, name, newName, from, to, docsFrom, docsTo, docsFolderMoved },
      err as Error,
    );
  }
  return { name: newName, scopesRewritten, docsFolderMoved, docsRetagged };
}

/**
 * Rollback nach einem gescheiterten Rename — der zweite Halt gegen die
 * geteilte Area.
 *
 * ENTSCHEIDUNG (warum Rollback und nicht „noch mehr Preflight"): Der
 * vorhandene Preflight deckt genau EINEN Grund ab, aus dem der Doku-Zug
 * scheitern kann (das Zielregal existiert schon). `rename()` scheitert aber
 * auch an Rechten, an einem gerade gehaltenen Handle, an EXDEV auf einem
 * gemounteten Vault, und an einer Datei, die am Zielpfad liegt statt eines
 * Ordners — isDir() sagt dazu nein, der rename trotzdem auch. Preflight kann
 * das prinzipiell nicht abschließen: zwischen Prüfung und Bewegung liegt
 * immer ein Fenster. Also wird das, was schon bewegt wurde, zurückbewegt —
 * inklusive der Scope- und Tag-Rewrites, die sonst mit dem neuen Namen im
 * alten Ordner zurückblieben.
 *
 * Scheitert der Rollback selbst, wird das nicht verschwiegen: die Meldung
 * nennt dann PFADGENAU, was in welchem Zustand liegen blieb. Ein „meldet
 * Erfolg, obwohl geteilt" gibt es auf keinem der beiden Wege.
 */
async function rollbackRename(
  a: {
    vaultRoot: string;
    kind: "project" | "top";
    name: string;
    newName: string;
    from: string;
    to: string;
    docsFrom: string;
    docsTo: string;
    docsFolderMoved: boolean;
  },
  cause: Error,
): Promise<Error> {
  const stuck: string[] = [];
  // Codex-Gegenreview (P1): Hier standen an beiden Aufrufen NEUE LEERE
  // `failed`-Arrays, die danach niemand mehr ansah. Nachgestellt: Ein Memory
  // blieb nach dem Rollback auf dem NEUEN Scope, der Ordner war zurückbenannt,
  // und die Meldung behauptete trotzdem „nothing was changed" — derselbe
  // geteilte Zustand wie auf dem Hinweg, nur auf dem Fehlerpfad und diesmal
  // verschwiegen. Der Rollback weiß genauso wenig wie der Hinweg, was er nicht
  // schreiben konnte; also sammelt er es und sagt es, pfadgenau wie `stuck`.
  const notRestored: string[] = [];
  if (a.docsFolderMoved) {
    try {
      // Gleiche Reihenfolge wie im Hinweg, nur mit vertauschten Namen: die
      // Produktdoku-Signatur prüft `scope`, der hier schon der neue ist.
      await rewriteDocMetadata(a.vaultRoot, a.docsTo, a.newName, a.name, notRestored);
      await rewriteScopes(a.vaultRoot, a.docsTo, a.newName, a.name, notRestored);
      await rename(a.docsTo, a.docsFrom);
    } catch {
      stuck.push(`dokumentationen/${a.newName} (sollte dokumentationen/${a.name} sein)`);
    }
  }
  try {
    if (a.kind === "project") await rewriteScopes(a.vaultRoot, a.to, a.newName, a.name, notRestored);
    await rename(a.to, a.from);
  } catch {
    stuck.push(`${a.to} (sollte ${a.from} sein)`);
  }
  if (stuck.length > 0 || notRestored.length > 0) {
    const detail: string[] = [];
    if (stuck.length > 0) detail.push(`Von Hand zu richten: ${stuck.join("; ")}`);
    if (notRestored.length > 0) {
      detail.push(
        `${notRestored.length} Datei(en) konnten nicht zurückgeschrieben werden und tragen ` +
          `womöglich noch "${a.newName}" in Scope oder Tags: ${notRestored.join("; ")}`,
      );
    }
    return new Error(
      `rename failed AND could not be fully undone: ${cause.message}. ${detail.join(". ")}.`,
    );
  }
  return new Error(`rename failed, nothing was changed: ${cause.message}`);
}

export interface DeleteResult {
  name: string;
  trashedTo: string;
  /** Wohin `dokumentationen/<projekt>` gewandert ist — undefined, wenn das
   *  Projekt kein Doku-Regal hatte. */
  docsTrashedTo?: string;
}

/**
 * Die Grenze des Area-Trash — dieselbe Kette wie beim Memory-Trash
 * (`trashPathFor()` in core/audit-log.ts).
 *
 * Codex-Gegenreview (Sicherheit): Hier stand eine SCHWÄCHERE Prüfung als dort
 * — ein lexikalisches `startsWith` auf den Trash-Ordner plus ein
 * `assertInsideVault` auf `.bastra/trash/areas`. Beides ist zu wenig:
 * `assertInsideVault` fragt nur, ob das Ziel IRGENDWO im Vault liegt. Ein
 * `.bastra -> memories` oder ein `.bastra/trash -> dokumentationen` verlässt
 * den Vault nicht und kam deshalb glatt durch — aus dem Löschen wurde ein
 * Verschieben in den AKTIVEN Bestand: die Area als „in den Trash gelegt"
 * gemeldet, ihre Memories weiterhin im Recall und in Obsidian sichtbar. Der
 * Trash ist eine eigene Grenze, nicht bloß ein Ordner im Vault; deshalb
 * dieselben vier Fragen wie beim Memory-Trash, jede an ihr eigenes
 * Elternverzeichnis: gehört `.bastra` dem Vault selbst (kein Symlink), liegt
 * `trash` in `.bastra`, liegt `areas` im Trash, liegt das Ziel in `areas`.
 */
function assertAreaTrashBoundary(vaultRoot: string, areasRoot: string, dests: string[]): void {
  const bastraDir = join(vaultRoot, ".bastra");
  const trashDir = join(bastraDir, "trash");
  assertOwnSubdir(vaultRoot, bastraDir, "trash an area");
  assertInsideDir(bastraDir, trashDir, "trash an area", "the .bastra folder");
  assertInsideDir(trashDir, areasRoot, "trash an area", "the trash folder");
  for (const dest of dests) {
    assertInsideDir(areasRoot, dest, "trash an area", "the area trash folder");
  }
}

/** Move the whole area folder into the vault trash — recoverable, never rm.
 *
 *  Codex-Befund 4: Delete nahm nur das Memory-Regal mit und ließ
 *  `dokumentationen/<projekt>` aktiv zurück. Rename und Delete meinten damit
 *  zwei verschiedene Dinge, wenn sie „Area" sagten — die Area verschwand aus
 *  der Karte, ihre Produktdokumente blieben im Recall.
 *
 *  ENTSCHEIDUNG: Das Doku-Regal wandert mit in den Trash. Rename zieht es
 *  schon immer mit; eine Area IST beides, und die Konsistenz ist hier
 *  gefahrlos zu haben, weil Delete nichts vernichtet — beide Regale liegen
 *  nebeneinander im Trash und sind von Hand zurückzuschieben. Der umgekehrte
 *  Weg (Rename lässt die Doku stehen) hätte den Recall dauerhaft mit
 *  Dokumenten eines Projekts versorgt, das es nicht mehr gibt.
 */
export async function deleteArea(
  vaultRoot: string,
  kind: "project" | "top",
  name: string,
): Promise<DeleteResult> {
  assertEditable(kind, name);
  const from = areaPath(vaultRoot, kind, name);
  if (!(await isDir(from))) throw new Error(`area not found: ${name}`);
  const trashRoot = join(vaultRoot, ".bastra", "trash", "areas");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const dest = join(trashRoot, `${name}-${stamp}`);
  const docsDest = join(trashRoot, `${name}-${stamp}-dokumentationen`);
  // VOR dem mkdir: `recursive: true` folgt einem umgebogenen `.bastra` und
  // legt den Trash dort an, bevor irgendeine Prüfung ihn zu sehen bekommt.
  assertAreaTrashBoundary(vaultRoot, trashRoot, [dest, docsDest]);
  await mkdir(trashRoot, { recursive: true });
  // Und danach noch einmal: zwischen Prüfung und mkdir liegt ein await, und
  // erst jetzt existieren die Ordner, deren Realpfad wirklich zählt.
  assertAreaTrashBoundary(vaultRoot, trashRoot, [dest, docsDest]);
  await rename(from, dest);
  // Nebeneinander statt ineinander: der Trash-Ordner der Memories behält
  // seine Form (`<name>-<stamp>/<memory>.md`), damit ein Restore von Hand
  // nicht plötzlich eine Ebene tiefer suchen muss.
  let docsTrashedTo: string | undefined;
  if (kind === "project") {
    const docsFrom = docsShelfPath(vaultRoot, name);
    if (await isDir(docsFrom)) {
      try {
        await rename(docsFrom, docsDest);
        docsTrashedTo = docsDest;
      } catch (err) {
        // Codex-Gegenreview (P1): Scheiterte der Doku-Zug, blieb ein halber
        // Zustand zurück — Memories im Trash, Dokumente aktiv. Eine Area ist
        // beides; sie geht ganz oder gar nicht. Dieselbe Entscheidung wie
        // beim Rename, siehe `rollbackRename`.
        try {
          await rename(dest, from);
        } catch {
          throw new Error(
            `delete failed AND could not be fully undone: ${(err as Error).message}. ` +
              `Von Hand zu richten: ${dest} (sollte ${from} sein).`,
          );
        }
        throw new Error(
          `delete failed, nothing was changed: ${(err as Error).message}`,
        );
      }
    }
  }
  return { name, trashedTo: dest, docsTrashedTo };
}

/**
 * GET/POST /ui/areas — the map's areas manager. GET lists; POST mutates:
 *   { action: "create", name }
 *   { action: "rename", kind, name, newName }
 *   { action: "delete", kind, name }
 * ui-gated + loopback-only like the rest of /ui. `onChanged` runs after a
 * successful mutation (the http layer passes vault.reconcile — the one
 * correct healing call after a bulk folder move).
 */
export async function handleUiAreas(
  req: IncomingMessage,
  res: ServerResponse,
  vaultRoot: string,
  onChanged?: () => Promise<unknown>,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
    return;
  }
  if (req.method === "GET") {
    sendJsonPlain(res, 200, { areas: await listAreas(vaultRoot) });
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) {
      sendJsonPlain(res, 413, { error: "body too large" });
      return;
    }
  }
  let body: { action?: unknown; kind?: unknown; name?: unknown; newName?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    sendJsonPlain(res, 400, { error: "invalid JSON body" });
    return;
  }
  const kind = body.kind === "top" ? "top" : "project";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  try {
    let payload: unknown;
    if (body.action === "create") {
      payload = await createArea(vaultRoot, name);
    } else if (body.action === "rename") {
      const newName = typeof body.newName === "string" ? body.newName.trim() : "";
      if (!newName) throw new Error("newName is required");
      payload = await renameArea(vaultRoot, kind, name, newName);
    } else if (body.action === "delete") {
      payload = await deleteArea(vaultRoot, kind, name);
    } else {
      sendJsonPlain(res, 400, { error: "action must be create, rename or delete" });
      return;
    }
    if (onChanged) await onChanged().catch(() => {});
    sendJsonPlain(res, 200, { ok: true, result: payload });
  } catch (err) {
    sendJsonPlain(res, 400, { error: (err as Error).message });
  }
}
