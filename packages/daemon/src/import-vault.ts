/**
 * Import P4 (#215) — ingest a whole folder of FOREIGN memory files into the
 * vault, deterministically, with NO per-item review. Unlike the P1–P3 paths
 * (which stage candidates in `import-review.md` for a human to distill), a
 * folder of already-structured memory files carries every field a memory
 * needs — so a known format maps straight through `saveMemory`, no gate.
 *
 * Two adapters, tried per file:
 *   - claude-code: Claude Code / "Anthropic standard" auto-memory. The format
 *     is NOT singular — some vaults write flat `type:`, others nested
 *     `metadata.type:`, some carry `[[wikilinks]]` in the body, others none,
 *     and ~10% of real files have no frontmatter at all. The adapter is
 *     deliberately tolerant of all of these.
 *   - generic-markdown: fallback for any other markdown note — title from the
 *     first H1 (or filename), summary from the first paragraph.
 *
 * Isolation: everything lands under `memories/imported/<label>/` with
 * label-namespaced ids, so (a) no existing memory is ever read or modified,
 * (b) ids can't collide with hand-authored memories, (c) the whole set is
 * delete-/re-importable atomically (one folder, one scope, one source tag).
 */
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import matter from "gray-matter";
import { saveMemory, slugify, type SaveMemoryInput } from "@bastra-recall/core";
import { sendJsonPlain } from "./webui.js";
import { getUiEnabled } from "./settings.js";

/** Claude Code memory `type` → recall memory type. Closed 4-value source enum
 *  (user|feedback|project|reference); unknown values fall back to reference. */
const CC_TYPE_MAP: Record<string, SaveMemoryInput["type"]> = {
  user: "user-preference",
  feedback: "meta-working",
  project: "project-fact",
  reference: "reference",
};

/** Reserved subtree for all folder imports — its own graph cluster, and the
 *  atomic unit for delete/re-import. Never a target of the normal scope/type
 *  routing, so it can't overlap a hand-authored memory's path. */
export const IMPORT_ROOT = "memories/imported";

const WIKILINK_RE = /\[\[([a-z0-9][a-z0-9_-]{0,79})\]\]/g;

export interface ImportVaultOptions {
  /** Namespace label for this batch; defaults to the source dir's basename.
   *  Becomes the subfolder, the scope, and the id prefix. */
  label?: string;
  /** Re-import in place instead of erroring on an existing id (default true —
   *  a folder import is idempotent by design). */
  overwrite?: boolean;
  /** Map + count without writing anything (default false). */
  dryRun?: boolean;
}

export interface ImportVaultSkip {
  path: string;
  reason: string;
}

export interface ImportVaultResult {
  sourceDir: string;
  label: string;
  folder: string;
  scope: string;
  scanned: number;
  imported: number;
  byAdapter: { claudeCode: number; generic: number };
  skipped: ImportVaultSkip[];
  ids: string[];
  dryRun: boolean;
}

// ── small pure helpers ───────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** `feedback_no_double_borders.md` → "feedback"; only the four CC prefixes. */
function typeFromFilename(fileBase: string): string | null {
  const m = /^(user|feedback|project|reference)[_-]/.exec(fileBase);
  return m ? m[1] : null;
}

/** filename/slug → a readable title ("no_double_borders" → "No double borders"). */
function deSlug(fileBase: string): string {
  const words = fileBase.replace(/[-_]+/g, " ").trim();
  if (!words) return fileBase;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** First `# H1` heading text, if the note leads with one. */
function firstH1(body: string): string | null {
  for (const line of body.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1];
    if (line.trim().length > 0 && !line.startsWith("#")) break;
  }
  return null;
}

/** First non-heading, non-empty paragraph, clamped — a stand-in summary when
 *  the source carries no description field. */
function firstParagraph(body: string): string | null {
  const blocks = body.split(/\n\s*\n/);
  for (const block of blocks) {
    const text = block.trim();
    if (!text || text.startsWith("#") || text.startsWith("---")) continue;
    const oneLine = text.replace(/\s+/g, " ");
    return oneLine.length > 300 ? oneLine.slice(0, 297) + "…" : oneLine;
  }
  return null;
}

/** Namespace every body `[[x]]` → `[[<label>-x]]` so intra-set links stay
 *  inside the imported set and can NEVER resolve onto a hand-authored memory
 *  with a bare-name id (the isolation guarantee). Links whose namespaced form
 *  exceeds the 80-char wikilink cap simply don't become edges — harmless. */
function namespaceWikilinks(body: string, label: string): string {
  return body.replace(WIKILINK_RE, (_full, id: string) => `[[${label}-${id}]]`);
}

/** gray-matter, but a throwing/unparseable YAML frontmatter (cyrillic
 *  guillemets, backslash escapes, …) degrades to "no frontmatter" instead of
 *  dropping the file — YAML-leniency lives in the importer, not the loader. */
function safeParse(raw: string): { data: Record<string, unknown>; content: string } {
  try {
    const { data, content } = matter(raw);
    return { data: (data ?? {}) as Record<string, unknown>, content };
  } catch {
    return { data: {}, content: raw };
  }
}

/** A CC memory file if it carries any of the format's marker fields — flat
 *  `type:`, nested `metadata.type:`, or a `name:`. Everything else is generic. */
function looksLikeClaudeCode(data: Record<string, unknown>): boolean {
  if (str(data.name) || str(data.type)) return true;
  const meta = data.metadata;
  return typeof meta === "object" && meta !== null && str((meta as Record<string, unknown>).type) !== null;
}

/**
 * Index-hub detection for frontmatter-less files (zzallirog field report,
 * 2026-07-17): hand-maintained index files (sectioned link lists pointing at
 * every note) must NOT become memory nodes — their stray inline wikilinks
 * inflate the ghost count while their real navigational payload (markdown
 * `[t](x.md)` links) isn't a semantic edge either way. Recognize, don't
 * parse: a file whose non-heading lines are mostly links is navigation.
 * Only ever applied to frontmatter-less files — declared frontmatter wins.
 */
function looksLikeIndexHub(body: string): boolean {
  const mdLinks = body.match(/\[[^\]]*\]\([^)\s]+\.md\)/g)?.length ?? 0;
  const wikiLinks = body.match(WIKILINK_RE)?.length ?? 0;
  const links = mdLinks + wikiLinks;
  if (links < 8) return false;
  const contentLines = body
    .split("\n")
    .filter((l) => l.trim().length > 0 && !/^\s*#/.test(l) && !/^\s*---\s*$/.test(l));
  return contentLines.length > 0 && links >= contentLines.length * 0.6;
}

/** Ensure a batch-unique id: on collision append -2, -3, … (deterministic). */
function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

// ── per-file mapping ─────────────────────────────────────────────────────────

type MapResult = { ok: true; input: SaveMemoryInput } | { ok: false; reason: string };

interface MapContext {
  label: string;
  folder: string;
  relDir: string;
  overwrite: boolean;
  used: Set<string>;
}

function buildInput(
  fields: { name: string; description: string; type: SaveMemoryInput["type"]; ccType: string; adapter: string },
  fileBase: string,
  body: string,
  ctx: MapContext,
): SaveMemoryInput {
  const { name, description, type, ccType, adapter } = fields;
  const id = uniqueId(slugify(`${ctx.label}-${fileBase}`), ctx.used);
  const relSegments = ctx.relDir ? ctx.relDir.split(sep).filter(Boolean).map((s) => s.trim()).filter(Boolean) : [];
  const topic_path = ["imported", ctx.label, ...relSegments];
  const tags = [...new Set(["imported", ctx.label, ccType].filter(Boolean))];
  const recall_when = [...new Set([description, deSlug(name), ccType].map((s) => s.trim()).filter(Boolean))];
  const safeBody = namespaceWikilinks(body.trim().length > 0 ? body : description || name, ctx.label);
  return {
    id,
    title: name,
    type,
    summary: description,
    body: safeBody,
    topic_path,
    tags,
    scope: ctx.label,
    recall_when,
    folder: ctx.folder,
    write_origin: "user-directed",
    overwrite: ctx.overwrite,
    source: `${adapter}:${ctx.label}`,
  };
}

function mapFile(fileBase: string, raw: string, ctx: MapContext): MapResult {
  const { data, content } = safeParse(raw);

  if (looksLikeClaudeCode(data)) {
    const meta = (typeof data.metadata === "object" && data.metadata !== null
      ? (data.metadata as Record<string, unknown>)
      : {});
    const ccType = str(data.type) ?? str(meta.type) ?? typeFromFilename(fileBase) ?? "reference";
    const type = CC_TYPE_MAP[ccType] ?? "reference";
    const name = str(data.name) ?? firstH1(content) ?? deSlug(fileBase);
    const description = str(data.description) ?? firstParagraph(content) ?? name;
    return { ok: true, input: buildInput({ name, description, type, ccType, adapter: "claude-code-memory" }, fileBase, content, ctx) };
  }

  // generic markdown — no recognizable memory frontmatter
  const name = firstH1(content) ?? deSlug(fileBase);
  const description = firstParagraph(content) ?? name;
  if (content.trim().length === 0 && !str(data.name)) {
    return { ok: false, reason: "empty file" };
  }
  if (looksLikeIndexHub(content)) {
    return { ok: false, reason: "index/navigation file (link hub) — not a memory" };
  }
  const ccType = typeFromFilename(fileBase) ?? "reference";
  const type = CC_TYPE_MAP[ccType] ?? "reference";
  return { ok: true, input: buildInput({ name, description, type, ccType, adapter: "markdown" }, fileBase, content, ctx) };
}

// ── directory walk ───────────────────────────────────────────────────────────

/** Recursively collect `*.md` files under `dir`, skipping dotdirs and
 *  node_modules (same policy as the vault loader) and the `MEMORY.md` pointer
 *  index (it's a table of contents, not a memory). Returns absolute paths. */
async function listSourceMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === "node_modules" || (e.name.startsWith(".") && e.name.length > 1)) continue;
      const full = join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && extname(e.name).toLowerCase() === ".md" && e.name.toLowerCase() !== "memory.md") {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

// ── orchestration ────────────────────────────────────────────────────────────

/**
 * Import every markdown memory file under `sourceDir` into the vault at
 * `vaultRoot`, isolated under `memories/imported/<label>/`. Deterministic,
 * gate-free, idempotent (stable ids + overwrite). Never reads or writes any
 * file outside the import subtree.
 */
export async function importVault(
  vaultRoot: string,
  sourceDir: string,
  options: ImportVaultOptions = {},
): Promise<ImportVaultResult> {
  const info = await stat(sourceDir).catch(() => null);
  if (!info || !info.isDirectory()) {
    throw new Error(`not a directory: ${sourceDir}`);
  }
  // Self-Ingest-Guard (zzallirog field report, 2026-07-18): Quelle und Vault
  // dürfen sich NICHT überlappen. `import vault <vault>` schrieb eine
  // komplette slugifizierte Kopie des Vaults in den Vault selbst — der Daemon
  // scoped sauber und versteckt es, aber jedes andere Tool auf dem geteilten
  // Ordner (Atlas, Indexer, grep) sieht ein Halb-Echo-Korpus. Für Nutzer,
  // deren Memory-Verzeichnis DER Vault ist, gilt: die Files sind bereits
  // nativ indexiert — Import ist für FREMDE Ordner. realpath, damit Symlinks
  // (~, Cloud-Mounts) die Prüfung nicht umgehen.
  const srcReal = await realpath(sourceDir).catch(() => resolve(sourceDir));
  const vaultReal = await realpath(vaultRoot).catch(() => resolve(vaultRoot));
  const within = (child: string, parent: string): boolean =>
    child === parent || child.startsWith(parent + sep);
  if (within(srcReal, vaultReal) || within(vaultReal, srcReal)) {
    throw new Error(
      `import source (${srcReal}) overlaps the vault (${vaultReal}) — refusing to self-ingest. ` +
        `The vault indexes its own files natively; importing it into itself would write a duplicate ` +
        `slugified copy under ${IMPORT_ROOT}/. Point "import vault" at a folder OUTSIDE the vault ` +
        `(or copy the notes out first).`,
    );
  }
  const label = slugify(options.label ?? (basename(sourceDir) || "import"));
  const overwrite = options.overwrite ?? true;
  const dryRun = options.dryRun ?? false;
  const folder = `${IMPORT_ROOT}/${label}`;

  const files = await listSourceMarkdown(sourceDir);
  const used = new Set<string>();
  const skipped: ImportVaultSkip[] = [];
  const ids: string[] = [];
  const byAdapter = { claudeCode: 0, generic: 0 };

  for (const filePath of files) {
    const relDir = relative(sourceDir, filePath).split(sep).slice(0, -1).join(sep);
    const fileBase = basename(filePath, extname(filePath));
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      skipped.push({ path: filePath, reason: `unreadable: ${(err as Error).message}` });
      continue;
    }
    const mapped = mapFile(fileBase, raw, { label, folder, relDir, overwrite, used });
    if (!mapped.ok) {
      skipped.push({ path: filePath, reason: mapped.reason });
      continue;
    }
    if (mapped.input.source?.startsWith("claude-code-memory")) byAdapter.claudeCode++;
    else byAdapter.generic++;
    if (!dryRun) {
      try {
        await saveMemory(vaultRoot, mapped.input);
      } catch (err) {
        skipped.push({ path: filePath, reason: `save failed: ${(err as Error).message}` });
        continue;
      }
    }
    ids.push(mapped.input.id as string);
  }

  if (!dryRun && ids.length > 0) {
    // Fix-Leiter Stufe 3 (zzallirog): ein Marker im Import-Subtree, damit
    // FREMDE Tools auf dem geteilten Ordner (Atlas, Indexer, grep) das Set
    // als maschinell erzeugte Kopie erkennen und überspringen können. Kein
    // .md — der Vault-Loader ignoriert die Datei.
    try {
      const markerDir = join(vaultRoot, folder);
      await mkdir(markerDir, { recursive: true });
      await writeFile(
        join(markerDir, ".bastra-imported"),
        JSON.stringify(
          {
            tool: "bastra-recall import vault",
            label,
            source: srcReal,
            imported: ids.length,
            at: new Date().toISOString(),
            note: "Machine-imported copy of an external folder — safe for external tools to skip.",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    } catch {
      /* marker is best-effort — never fail an import over it */
    }
  }

  return {
    sourceDir,
    label,
    folder,
    scope: label,
    scanned: files.length,
    imported: ids.length,
    byAdapter,
    skipped,
    ids,
    dryRun,
  };
}

export interface FsBrowseEntry {
  name: string;
  path: string;
  /** Number of markdown files directly inside — a quick "is this a vault?" cue. */
  md: number;
}

/**
 * Subdirectories of `dir`, for the map's folder picker. Directories only —
 * never file names, never file contents. Dot-directories are included (the
 * common import source `~/.claude/projects/<x>/memory` lives behind one) but
 * sorted after the visible ones; node_modules is dropped.
 */
export async function listSubdirs(dir: string): Promise<{ path: string; parent: string | null; dirs: FsBrowseEntry[] }> {
  const abs = resolve(dir);
  const entries = await readdir(abs, { withFileTypes: true });
  const dirs: FsBrowseEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "node_modules") continue;
    const full = join(abs, e.name);
    let md = 0;
    try {
      md = (await readdir(full)).filter((n) => n.toLowerCase().endsWith(".md")).length;
    } catch {
      // unreadable subdir — still listed, just without the count
    }
    dirs.push({ name: e.name, path: full, md });
  }
  dirs.sort((a, b) => {
    const da = a.name.startsWith(".") ? 1 : 0;
    const db = b.name.startsWith(".") ? 1 : 0;
    return da - db || a.name.localeCompare(b.name);
  });
  const parent = dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, dirs };
}

/**
 * GET /ui/fs?path=<abs> — the folder picker's data source. Directory names
 * only, loopback + ui-gated like the rest of /ui (same trust boundary as the
 * import itself, which reads arbitrary local folders). Defaults to $HOME.
 */
export async function handleUiFsBrowse(
  req: IncomingMessage,
  res: ServerResponse,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
    return;
  }
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  const raw = u.searchParams.get("path");
  const dir = raw && raw.trim().length > 0 ? raw.trim() : homedir();
  if (!isAbsolute(dir)) {
    sendJsonPlain(res, 400, { error: "path must be absolute" });
    return;
  }
  try {
    sendJsonPlain(res, 200, await listSubdirs(dir));
  } catch (err) {
    sendJsonPlain(res, 400, { error: (err as Error).message });
  }
}

/**
 * POST /ui/import-vault — the map's folder-import: the user picks a local
 * folder (the loopback daemon has local file access) and it imports
 * through the same `importVault` core as the CLI. Unlike /ui/import (staging
 * only), this writes directly — but only into the isolated import subtree.
 * ui-gated + loopback-only like the rest of /ui. `onIndexed` reconciles the
 * vault so the new nodes show up on the map immediately.
 */
export async function handleUiImportVault(
  req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
  onIndexed?: () => Promise<unknown>,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
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
  let body: { dir?: unknown; label?: unknown; dryRun?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    sendJsonPlain(res, 400, { error: "invalid JSON body" });
    return;
  }
  const dir = typeof body.dir === "string" ? body.dir.trim() : "";
  if (!dir) {
    sendJsonPlain(res, 400, { error: "dir required — the path to a folder of memory files" });
    return;
  }
  const label = typeof body.label === "string" && body.label.trim().length > 0 ? body.label.trim() : undefined;
  let result: ImportVaultResult;
  try {
    result = await importVault(vaultPath, dir, { label, dryRun: body.dryRun === true });
  } catch (err) {
    sendJsonPlain(res, 400, { error: (err as Error).message });
    return;
  }
  if (!result.dryRun && result.imported > 0 && onIndexed) {
    await onIndexed().catch(() => {});
  }
  sendJsonPlain(res, 200, {
    imported: result.imported,
    scanned: result.scanned,
    folder: result.folder,
    scope: result.scope,
    by_adapter: result.byAdapter,
    skipped: result.skipped.length,
    dry_run: result.dryRun,
  });
}
