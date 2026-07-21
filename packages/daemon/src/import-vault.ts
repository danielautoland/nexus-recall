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
import { saveMemory, slugify, extractWikilinks, moveToTrash } from "@bastra-recall/core";
import { sendJsonPlain } from "./webui.js";
import { getUiEnabled } from "./settings.js";
import { escapeRe, linkKey, safeSlug, uniqueId } from "./import/identity.js";
import { harvestIndex, looksLikeIndexHub } from "./import/index-harvest.js";
import { looksLikeClaudeCode, mapFile, safeParse } from "./import/adapters.js";

/** Reserved subtree for all folder imports — its own graph cluster, and the
 *  atomic unit for delete/re-import. Never a target of the normal scope/type
 *  routing, so it can't overlap a hand-authored memory's path. */
export const IMPORT_ROOT = "memories/imported";

export interface ImportVaultOptions {
  /** Namespace label for this batch; defaults to the source dir's basename.
   *  Becomes the subfolder, the scope, and the id prefix. */
  label?: string;
  /** Re-import in place instead of erroring on an existing id (default true —
   *  a folder import is idempotent by design). */
  overwrite?: boolean;
  /** Map + count without writing anything (default false). */
  dryRun?: boolean;
  /** #220 (zzallirog): additional directory NAMES to skip anywhere in the
   *  tree (case-insensitive). Dotdirs, node_modules and `_archive`/`archive`
   *  are always skipped — retired notes must not compete with live ones for
   *  node identity. */
  exclude?: string[];
}

/** Always-skipped directory names (#220): archives hold retired copies of
 *  live notes — importing them mints `-2`/`-3` collision twins. */
const DEFAULT_EXCLUDED_DIRS = new Set(["_archive", "archive"]);

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
  /** #217: id of the synthetic curated-index node minted from the source
   *  index (MEMORY.md / hubs), or null when the source carried no index. */
  indexNode: string | null;
  /** #240/A10: nodes retired because the id scheme gained the relative source
   *  directory. Old file went to the vault trash, recoverable. */
  migrated: Array<{ from: string; to: string }>;
  dryRun: boolean;
}

// ── directory walk ───────────────────────────────────────────────────────────

/** Recursively collect `*.md` files under `dir`, skipping dotdirs and
 *  node_modules (same policy as the vault loader) and the `MEMORY.md` pointer
 *  index (it's a table of contents, not a memory). Returns absolute paths. */
async function listSourceMarkdown(dir: string, exclude: Set<string> = new Set()): Promise<string[]> {
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
        const name = e.name.toLowerCase();
        if (DEFAULT_EXCLUDED_DIRS.has(name) || exclude.has(name)) continue;
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

  const files = await listSourceMarkdown(
    sourceDir,
    new Set((options.exclude ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)),
  );
  const used = new Set<string>();
  const skipped: ImportVaultSkip[] = [];
  const ids: string[] = [];
  const byAdapter = { claudeCode: 0, generic: 0 };

  // Pass 0: read every file once — the inbound-veto and the index harvest both
  // need a view of the WHOLE set before any single file is mapped.
  const rawByFile = new Map<string, string>();
  for (const filePath of files) {
    try {
      rawByFile.set(filePath, await readFile(filePath, "utf8"));
    } catch (err) {
      skipped.push({ path: filePath, reason: `unreadable: ${(err as Error).message}` });
    }
  }

  // #240/A10 Pass 0: mint every final id from the SOURCE PATHS first, before
  // a single body is mapped. The ids carry the relative directory now, so
  // each resolver below has to look the target up here instead of
  // recomputing `slugify(label + basename)` — that recomputation resolved
  // nested files to ids that were never minted and turned every intra-set
  // link into a ghost. Deterministic: `files` is sorted, so a genuine
  // basename collision resolves to the same winner on every run.
  // ONE allocator for the whole batch (`used`): Pass 0 and the synthetic index
  // in Pass D must draw from the same set. A separate Pass-0 set left `used`
  // empty, so a source file literally named `index.md` minted `<label>-index`
  // here and the synthetic index picked the same id and overwrote it — the
  // source note's content was gone.
  const idByBase = new Map<string, string>();
  const idByPath = new Map<string, string>();
  for (const filePath of files) {
    const relDir = relative(sourceDir, filePath).split(sep).slice(0, -1).join(sep);
    const fileBase = basename(filePath, extname(filePath));
    const relSegments = relDir ? relDir.split(sep).filter(Boolean) : [];
    const id = uniqueId(slugify([label, ...relSegments, fileBase].join("-")), used);
    idByPath.set(filePath, id);
    // Keyed by the LINK form, not the raw basename: a body writes `[[two]]`
    // while the file is `Two.md`, so both sides have to pass through the same
    // normalization or the lookup misses and mints a ghost.
    const key = linkKey(fileBase);
    if (key && !idByBase.has(key)) idByBase.set(key, id);
  }

  // #240/A10 legacy migration — CONSERVATIVE (Weg A). Snapshot taken BEFORE
  // any write this run.
  //
  // A pre-A10 node carries no record of WHICH source path produced it — that
  // information never existed, which is the whole reason A10 was needed. Every
  // heuristic to map it back (suffix parsing, collision families) therefore
  // has a data-loss path; three re-audit rounds each found the next one. So a
  // legacy node is retired ONLY when the mapping is provably unambiguous:
  //   (1) its id EXACTLY equals the unsuffixed legacy id of a current basename,
  //   (2) that basename is a SINGLETON (no collision family this run),
  //   (3) no OTHER singleton basename could also explain the id as a `-<n>`
  //       collision suffix (that would be genuine ambiguity), and
  //   (4) — checked after the writes — its successor was actually written.
  // Everything else — collision families, ambiguous numeric endings, vanished
  // sources, skipped/failed imports — is left as a VISIBLE DUPLICATE. A
  // duplicate is recoverable; trashing the wrong node is not. The ambiguous
  // cases belong to a separate, manifest-backed `bastra migrate`, not to an
  // automatic pass that must never lose data.
  const currentIds = new Set(idByPath.values());
  // Collision families (count > 1) are never auto-migrated.
  const baseCount = new Map<string, number>();
  for (const p of idByPath.keys()) {
    const key = linkKey(basename(p, extname(p)));
    if (key) baseCount.set(key, (baseCount.get(key) ?? 0) + 1);
  }
  // Singleton basenames only: the exact unsuffixed legacy id the pre-A10
  // importer would have minted, and this run's successor for it.
  const exactLegacy = new Map<string, { to: string }>();
  const singletonLegacyIds: string[] = [];
  for (const p of idByPath.keys()) {
    const fileBase = basename(p, extname(p));
    const key = linkKey(fileBase);
    const legacy = safeSlug(`${label}-${fileBase}`);
    if (!key || !legacy || (baseCount.get(key) ?? 0) > 1) continue;
    const to = idByBase.get(key);
    if (to && !exactLegacy.has(legacy)) {
      exactLegacy.set(legacy, { to });
      singletonLegacyIds.push(legacy);
    }
  }
  const legacyCandidates: Array<{ id: string; path: string; to: string; body: string }> = [];
  try {
    for (const entry of await readdir(join(vaultRoot, folder))) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.slice(0, -3);
      if (currentIds.has(id)) continue;
      const exact = exactLegacy.get(id);
      if (!exact) continue; // no exact singleton match → not ours / vanished / family
      // Reject when another singleton could read this id as its `-<n>` suffix:
      // `demo-chapter-2` with both `chapter.md` and `chapter-2.md` present has
      // no provenance to break the tie, so leave it.
      const suffixRival = singletonLegacyIds.some(
        (l) => l !== id && new RegExp(`^${escapeRe(l)}-\\d+$`).test(id),
      );
      if (suffixRival) continue;
      // Capture the legacy body for the content-equality gate below.
      const raw = await readFile(join(vaultRoot, folder, entry), "utf8").catch(() => null);
      if (raw === null) continue;
      legacyCandidates.push({
        id,
        path: join(vaultRoot, folder, entry),
        to: exact.to,
        body: safeParse(raw).content.trim(),
      });
    }
  } catch {
    /* no import folder yet — nothing to migrate */
  }

  // Pass A: every namespaced id that SOME body links to — the inbound-veto set
  // (Finding #2). A hub OTHERS point at is a real target, not a throwaway index.
  /** #240/A10: pre-relDir nodes retired during this run (old id → new id). */
  const migrated: Array<{ from: string; to: string }> = [];
  const referenced = new Set<string>();
  for (const raw of rawByFile.values()) {
    const { content } = safeParse(raw);
    for (const x of extractWikilinks(content)) {
      const id = idByBase.get(linkKey(x) ?? x) ?? safeSlug(`${label}-${x}`);
      if (id) referenced.add(id);
    }
  }

  // Pass B: harvest the index/hubs into section + description structure
  // (Finding #5). The root MEMORY.md is read explicitly — the walker skips it —
  // plus any file recognized as a link hub inside the set.
  const indexSources: string[] = [];
  for (const name of ["MEMORY.md", "memory.md", "Memory.md"]) {
    try {
      indexSources.push(await readFile(join(sourceDir, name), "utf8"));
      break;
    } catch {
      /* no index by that name — try the next spelling */
    }
  }
  for (const raw of rawByFile.values()) {
    const { data, content } = safeParse(raw);
    if (!looksLikeClaudeCode(data) && looksLikeIndexHub(content)) indexSources.push(content);
  }
  const harvest = harvestIndex(indexSources);

  // Pass C: map + save. Remember each written successor's body so migration
  // can prove the legacy node's content survives before trashing it.
  const writtenBodyById = new Map<string, string>();
  for (const filePath of files) {
    const raw = rawByFile.get(filePath);
    if (raw === undefined) continue; // unreadable — already recorded in skipped
    const relDir = relative(sourceDir, filePath).split(sep).slice(0, -1).join(sep);
    const fileBase = basename(filePath, extname(filePath));
    const selfId = idByPath.get(filePath);
    if (selfId === undefined) continue; // not part of the minted set
    const mapped = mapFile(fileBase, raw, { label, folder, relDir, overwrite, used, referenced, harvest, idByBase, selfId });
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
    writtenBodyById.set(mapped.input.id as string, mapped.input.body.trim());
  }

  // Retire the snapshotted legacy nodes now that every current id is written.
  // Two gates, both required, both direct expressions of "never lose data":
  //   (a) the successor was actually written this run — `ids` holds every
  //       successful save (empty/unreadable source, mapping miss and failed
  //       saveMemory all `continue` before the push), so a missing successor
  //       means the replacement never landed.
  //   (b) the successor carries the SAME body as the legacy node. Without this,
  //       a legacy id that merely LOOKS like a current basename's pre-A10 form
  //       gets trashed even when it is really an orphaned A10 node of a removed
  //       source (adversary finding F1: `notes.md`+`sub/notes.md` imported,
  //       then `notes.md` removed → `demo-notes` holds the removed file's
  //       content, its "successor" `demo-sub-notes` holds different content).
  //       Trashing only on an exact content match makes retirement provably
  //       loss-free: what we trash is guaranteed active elsewhere. Bodies that
  //       differ only by later enrichment (auto-related section, re-namespaced
  //       links) simply do not match → left as a visible duplicate, which is
  //       the accepted conservative outcome. Trash, never a hard delete.
  const writtenIds = new Set(ids);
  if (!dryRun) {
    for (const cand of legacyCandidates) {
      if (!writtenIds.has(cand.to)) continue; // successor skipped/failed → keep
      if (writtenBodyById.get(cand.to) !== cand.body) continue; // content differs → keep
      try {
        await moveToTrash(vaultRoot, cand.path, cand.id);
        migrated.push({ from: cand.id, to: cand.to });
      } catch (err) {
        skipped.push({
          path: cand.path,
          reason: `could not retire the pre-#240 node '${cand.id}': ${(err as Error).message}`,
        });
      }
    }
  }

  // Pass D: the curated index as ONE navigation node (Finding #5). Native CC
  // memory keeps its only connective tissue in MEMORY.md; rather than discard
  // it, mint a single reference memory whose body wikilinks EACH imported file,
  // grouped by section. Links point only at ids that actually imported, so it
  // adds edges (the star that ties the islands together), never ghosts.
  let indexNode: string | null = null;
  if (!dryRun && harvest.size > 0 && ids.length > 0) {
    const importedIds = new Set(ids);
    const bySection = new Map<string, string[]>(); // section → wikilink ids, in index order
    for (const [fileBase, entry] of harvest) {
      const linkId = idByBase.get(linkKey(fileBase) ?? fileBase) ?? safeSlug(`${label}-${fileBase}`);
      if (!linkId || !importedIds.has(linkId)) continue;
      const sec = entry.section ?? "";
      const list = bySection.get(sec) ?? [];
      list.push(linkId);
      bySection.set(sec, list);
    }
    const lines: string[] = [];
    let linkCount = 0;
    for (const [sec, linkIds] of bySection) {
      if (sec) lines.push(`## ${sec}`);
      for (const linkId of linkIds) {
        lines.push(`- [[${linkId}]]`);
        linkCount++;
      }
      lines.push("");
    }
    if (linkCount > 0) {
      const id = uniqueId(slugify(`${label}-index`), used);
      const sectionCount = [...bySection.keys()].filter((s) => s.length > 0).length;
      try {
        await saveMemory(vaultRoot, {
          id,
          title: `${label} — Index`,
          type: "reference",
          summary: `Navigations-Index für den Import „${label}" (${linkCount} Notizen${sectionCount ? `, ${sectionCount} Bereiche` : ""}).`,
          body: `Kuratierter Index des importierten Ordners „${label}" — die Verbindungsstruktur aus dem Quell-Index.\n\n${lines.join("\n")}`,
          topic_path: ["imported", label],
          tags: [...new Set(["imported", label, "index"])],
          scope: label,
          recall_when: [`${label} index`, `${label} übersicht`],
          folder,
          write_origin: "user-directed",
          overwrite,
          source: `index:${label}`,
        });
        ids.push(id);
        indexNode = id;
      } catch {
        /* index node is best-effort — never fail the import over it */
      }
    }
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
    indexNode,
    migrated,
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
