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
import { isMarkdownFile, isPathSafeComponent, mutateMemoryFile, readOccupant, slugify } from "@bastra-recall/core";
import { scopeEquals } from "@bastra-recall/core/scope";
import { sendJsonPlain } from "./webui.js";
import { getUiEnabled } from "./settings.js";

/** Folders under memories/ whose names the save-routing depends on. */
const RESERVED_TOP = new Set(["projects", "user", "all-projects", "taxonomy"]);

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

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
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
      reserved: RESERVED_TOP.has(name),
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
  const p = kind === "project" ? join(vaultRoot, "memories", "projects", name) : join(vaultRoot, "memories", name);
  // Belt-and-suspenders containment — name is validated, but re-check the join.
  if (!resolve(p).startsWith(resolve(vaultRoot) + sep)) {
    throw new Error(`refusing to touch a path outside the vault: ${p}`);
  }
  return p;
}

function assertEditable(kind: "project" | "top", name: string): void {
  if (!isPathSafeComponent(name)) {
    throw new Error(`invalid area name: ${JSON.stringify(name)}`);
  }
  if (kind === "top" && RESERVED_TOP.has(name)) {
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
async function rewriteScopes(dir: string, oldScope: string, newScope: string): Promise<number> {
  let rewritten = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      rewritten += await rewriteScopes(full, oldScope, newScope);
      continue;
    }
    if (!e.isFile() || !isMarkdownFile(e.name)) continue;
    // Codex-Befund 1: die Prüfung war „irgendein YAML-Feld `scope` vorhanden".
    // Nachgestellt: eine gewöhnliche Obsidian-Notiz mit `scope: carnexus` im
    // Projektordner wurde beim Rename umgeschrieben. Was der Vault nicht als
    // Memory indexieren würde, darf ein Rename nicht anfassen — dieselbe
    // Entscheidung wie im Save-Pfad, aus derselben Quelle.
    const occupant = readOccupant(full);
    if (occupant.kind !== "memory") continue;
    try {
      const outcome = await mutateMemoryFile(full, occupant.id, {
        frontmatter: (fm) => {
          const cur = fm.scope;
          if (typeof cur !== "string" || !scopeEquals(cur, oldScope)) return null;
          return { ...fm, scope: newScope };
        },
      });
      if (outcome.kind === "written") rewritten++;
    } catch {
      // unparseable file — leave it untouched rather than corrupt it
    }
  }
  return rewritten;
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

async function rewriteDocMetadata(dir: string, oldName: string, newName: string): Promise<number> {
  let touched = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
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
      });
      if (outcome.kind === "written") touched++;
    } catch {
      // unparseable file — leave it untouched rather than corrupt it
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
  const docsFrom = join(vaultRoot, "dokumentationen", name);
  const docsTo = join(vaultRoot, "dokumentationen", newName);
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
  if (kind === "project") {
    scopesRewritten = await rewriteScopes(to, name, newName);
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
      docsRetagged = await rewriteDocMetadata(docsTo, name, newName);
      scopesRewritten += await rewriteScopes(docsTo, name, newName);
    }
  }
  return { name: newName, scopesRewritten, docsFolderMoved, docsRetagged };
}

export interface DeleteResult {
  name: string;
  trashedTo: string;
  /** Wohin `dokumentationen/<projekt>` gewandert ist — undefined, wenn das
   *  Projekt kein Doku-Regal hatte. */
  docsTrashedTo?: string;
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
  for (const p of [dest, docsDest]) {
    if (!resolve(p).startsWith(resolve(trashRoot) + sep)) {
      throw new Error(`refusing to trash outside the trash folder: ${p}`);
    }
  }
  await mkdir(trashRoot, { recursive: true });
  await rename(from, dest);
  // Nebeneinander statt ineinander: der Trash-Ordner der Memories behält
  // seine Form (`<name>-<stamp>/<memory>.md`), damit ein Restore von Hand
  // nicht plötzlich eine Ebene tiefer suchen muss.
  let docsTrashedTo: string | undefined;
  if (kind === "project") {
    const docsFrom = join(vaultRoot, "dokumentationen", name);
    if (await isDir(docsFrom)) {
      await rename(docsFrom, docsDest);
      docsTrashedTo = docsDest;
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
