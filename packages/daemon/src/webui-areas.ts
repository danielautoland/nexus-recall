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
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import matter from "gray-matter";
import { isPathSafeComponent, slugify } from "@bastra-recall/core";
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
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) n++;
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
 *  scope equals oldScope. Files without parseable frontmatter are skipped. */
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
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
    try {
      const raw = await readFile(full, "utf8");
      const parsed = matter(raw);
      if ((parsed.data as Record<string, unknown>)?.scope !== oldScope) continue;
      (parsed.data as Record<string, unknown>).scope = newScope;
      const next = matter.stringify(parsed.content, parsed.data);
      const tmp = `${full}.tmp-${process.pid}`;
      await writeFile(tmp, next, "utf8");
      await rename(tmp, full);
      rewritten++;
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
  await rename(from, to);

  let scopesRewritten = 0;
  let docsFolderMoved = false;
  if (kind === "project") {
    scopesRewritten = await rewriteScopes(to, name, newName);
    // dokumentationen/<scope> is the same area's docs shelf — keep it in step.
    const docsFrom = join(vaultRoot, "dokumentationen", name);
    const docsTo = join(vaultRoot, "dokumentationen", newName);
    if ((await isDir(docsFrom)) && !(await isDir(docsTo))) {
      await rename(docsFrom, docsTo);
      docsFolderMoved = true;
    }
  }
  return { name: newName, scopesRewritten, docsFolderMoved };
}

export interface DeleteResult {
  name: string;
  trashedTo: string;
}

/** Move the whole area folder into the vault trash — recoverable, never rm. */
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
  if (!resolve(dest).startsWith(resolve(trashRoot) + sep)) {
    throw new Error(`refusing to trash outside the trash folder: ${dest}`);
  }
  await mkdir(trashRoot, { recursive: true });
  await rename(from, dest);
  return { name, trashedTo: dest };
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
