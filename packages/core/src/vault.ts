import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import matter from "gray-matter";
import { type Memory, parseMemoryWith, NotAMemoryFile } from "./schema.js";

export type VaultEvent =
  | { kind: "add"; memory: Memory }
  | { kind: "change"; memory: Memory }
  | { kind: "remove"; id: string; filePath: string };

export type VaultListener = (e: VaultEvent) => void;

/**
 * A vault is a directory tree of .md files. Files with valid memory
 * frontmatter (recognized `type:` field) are loaded; everything else
 * (e.g. plain Obsidian notes living in the same folders) is silently
 * skipped. Sub-directories are walked recursively, dotfolders and
 * `node_modules` are excluded.
 *
 * This means the user can point the app at an Obsidian vault root and
 * organize memorys into nested topic folders if they want, without
 * giving up the ability to keep regular notes alongside.
 */
export class Vault {
  private memorys = new Map<string, Memory>(); // id → memory
  private filePathToId = new Map<string, string>(); // absolute path → id
  // per indexed file, remembered at read time — reconcile() compares against
  // these to spot in-place edits the cloud-mount watcher never reported (#199)
  private fileStats = new Map<string, { mtimeMs: number; size: number }>();
  private listeners = new Set<VaultListener>();
  private watcher?: FSWatcher;

  constructor(public readonly root: string) {}

  async init(): Promise<{ loaded: number; skipped: { path: string; err: string }[] }> {
    // Reihenfolge stabil halten: nach Pfad sortieren bevor wir parallel laden.
    // So bleibt die Map-Iterationsordnung deterministisch (Maps iterieren in
    // Insertion-Order; wir setzen die Ergebnisse in Pfad-Sortierreihenfolge).
    const files = (await this.listMarkdownFiles()).slice().sort();
    const skipped: { path: string; err: string }[] = [];
    const BATCH = 32;
    type Loaded = { kind: "ok"; file: string; memory: Memory };
    type Skipped = { kind: "skip" };
    type Failed = { kind: "fail"; file: string; err: string };
    const results: (Loaded | Skipped | Failed)[] = new Array(files.length);
    for (let i = 0; i < files.length; i += BATCH) {
      const chunk = files.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        chunk.map((f) => this.read(f)),
      );
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        const f = chunk[j];
        if (s.status === "fulfilled") {
          results[i + j] = { kind: "ok", file: f, memory: s.value };
        } else {
          const err = s.reason;
          if (err instanceof NotAMemoryFile) {
            results[i + j] = { kind: "skip" };
          } else {
            const msg = (err as Error).message ?? String(err);
            console.warn(`[vault] init skipped (${basename(f)}): ${msg}`);
            results[i + j] = { kind: "fail", file: f, err: msg };
          }
        }
      }
    }
    // Insertion in Pfad-Sortierreihenfolge → deterministische Map-Iteration.
    for (const r of results) {
      if (!r || r.kind !== "ok") {
        if (r && r.kind === "fail") skipped.push({ path: r.file, err: r.err });
        continue;
      }
      // #240/A2.3: two files carrying the same id must never both point at
      // one map entry. Cloud-sync conflict copies ("Alpha (1).md") are the
      // common source. Before, init silently kept whichever file sorted last
      // and reported `loaded: 1`; cleaning up the copy then took the winner
      // with it. First path wins deterministically, the rest are quarantined
      // out of the index and reported.
      const claimed = this.memorys.get(r.memory.fm.id);
      if (claimed) {
        skipped.push({
          path: r.file,
          err:
            `duplicate id '${r.memory.fm.id}' — already claimed by ${claimed.filePath}. ` +
            `Not indexed. Give one of the two files a different id (a cloud-sync ` +
            `conflict copy is the usual cause).`,
        });
        continue;
      }
      this.memorys.set(r.memory.fm.id, r.memory);
      this.filePathToId.set(r.file, r.memory.fm.id);
    }
    return { loaded: this.memorys.size, skipped };
  }

  /** Start watching the vault tree (recursive). Emits add/change/remove. */
  startWatching(): void {
    if (this.watcher) return;
    // fsevents/kqueue do not fire reliably for files written *into* a
    // GoogleDrive/iCloud/Dropbox provider mount. Force polling on those.
    const isCloudMount = /(CloudStorage|Dropbox|iCloud)/i.test(this.root);
    // #242: watch the DIRECTORY, never a glob. chokidar removed glob support
    // in v4 — `${root}/**/*.md` is taken as a literal path, so the watcher
    // silently watches nothing and emits no events and no error. The .md
    // filter moved into the handlers on purpose: `ignored` also sees
    // directories, and filtering those by extension would stop the traversal.
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      usePolling: isCloudMount,
      interval: isCloudMount ? 1500 : undefined,
      ignored: (path: string) => {
        // Skip dotfolders (.obsidian, .git, .trash, …) and node_modules
        const segments = path.split(/[/\\]/);
        return segments.some(
          (s) => (s.startsWith(".") && s.length > 1) || s === "node_modules",
        );
      },
    });
    const isMarkdown = (p: string): boolean => p.toLowerCase().endsWith(".md");
    this.watcher.on("add", (p) => {
      if (isMarkdown(p)) void this.handleAddOrChange(p, "add");
    });
    this.watcher.on("change", (p) => {
      if (isMarkdown(p)) void this.handleAddOrChange(p, "change");
    });
    this.watcher.on("unlink", (p) => {
      if (isMarkdown(p)) this.handleRemove(p);
    });
    // #242: FSWatcher is an EventEmitter — an unhandled "error" event kills
    // the process (no uncaughtException handler anywhere in core/daemon).
    // A watcher failure must degrade to the periodic reconcile, not take the
    // daemon down: EMFILE is reachable for a launchd-spawned daemon at the
    // macOS default of 256 descriptors.
    this.watcher.on("error", (err) => {
      console.error(
        `[vault] watcher error — falling back to periodic reconcile: ${(err as Error).message}`,
      );
    });
  }

  /**
   * Force re-read of a single file and emit an add/change event.
   * Use after a known write (e.g. save_memory) so callers don't have to
   * wait for the watcher — which is unreliable on cloud-storage mounts.
   */
  async reindexFile(filePath: string): Promise<void> {
    const existing = this.filePathToId.has(filePath);
    await this.handleAddOrChange(filePath, existing ? "change" : "add");
  }

  /**
   * Reconcile the in-memory index against what's actually on disk and return
   * the corrected count. Walks the tree (stat-level, cheap), *reads* files
   * that aren't indexed yet, drops index entries whose file vanished — and
   * re-reads indexed files whose mtime/size drifted from the values stamped
   * at index time (in-place edits by external processes, #199).
   *
   * Needed because the fs watcher is unreliable on cloud-storage mounts
   * (GoogleDrive/iCloud/Dropbox): adds, deletes/moves, and especially in-place
   * edits done by another process — the Mac app, Obsidian, a second machine —
   * get missed, so the index drifts from reality. Callers that need a
   * trustworthy state (e.g. the `bastra` status panel) call this on demand;
   * it is not on any hot path.
   */
  async reconcile(): Promise<number> {
    const BATCH = 32;
    const onDisk = new Set(await this.listMarkdownFiles());
    // Drop index entries whose file is gone (missed unlink/move).
    for (const filePath of [...this.filePathToId.keys()]) {
      if (!onDisk.has(filePath)) this.handleRemove(filePath);
    }
    // Read files not yet indexed (handleAddOrChange silently skips non-memory).
    const toAdd = [...onDisk].filter((p) => !this.filePathToId.has(p));
    for (let i = 0; i < toAdd.length; i += BATCH) {
      await Promise.all(
        toAdd.slice(i, i + BATCH).map((p) => this.handleAddOrChange(p, "add")),
      );
    }
    // Heal in-place edits: stat-compare every indexed file against the values
    // remembered at read time; on drift, re-read. Freshly added files above
    // were just stamped, so they cost one matching stat and nothing more.
    const indexed = [...this.filePathToId.keys()];
    for (let i = 0; i < indexed.length; i += BATCH) {
      await Promise.all(
        indexed.slice(i, i + BATCH).map(async (p) => {
          try {
            const st = await stat(p);
            const known = this.fileStats.get(p);
            if (!known || known.mtimeMs !== st.mtimeMs || known.size !== st.size) {
              await this.reindexFile(p);
            }
          } catch {
            /* vanished between walk and stat — the next reconcile drops it */
          }
        }),
      );
    }
    return this.memorys.size;
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
  }

  on(listener: VaultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Drop a file's index entry without touching disk — for callers that moved
   * or trashed the file themselves (e.g. a convention-driven re-file on save)
   * and can't wait for the cloud-unreliable watcher to notice the unlink.
   */
  forgetFile(filePath: string): void {
    this.handleRemove(filePath);
  }

  list(): Memory[] {
    return [...this.memorys.values()];
  }

  get(id: string): Memory | undefined {
    return this.memorys.get(id);
  }

  size(): number {
    return this.memorys.size;
  }

  // ─── internals ───────────────────────────────────────────────

  private async listMarkdownFiles(): Promise<string[]> {
    const out: string[] = [];
    await this.walkDir(this.root, out);
    return out;
  }

  private async walkDir(dir: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree → ignore
    }
    for (const e of entries) {
      // Skip noise that almost never holds memorys
      if (e.name.startsWith(".") && e.name.length > 1) continue;
      if (e.name === "node_modules") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await this.walkDir(full, out);
      } else if (e.isFile() && extname(e.name) === ".md") {
        out.push(full);
      }
    }
  }

  private async read(filePath: string): Promise<Memory> {
    const [raw, st] = await Promise.all([
      readFile(filePath, "utf8"),
      stat(filePath),
    ]);
    const m = parseMemoryWith(
      (input) => matter(input),
      raw,
      filePath,
      st.mtimeMs,
    );
    // only stamped for real memories (parse throws on plain notes) — the
    // drift check in reconcile() runs over indexed files exclusively
    this.fileStats.set(filePath, { mtimeMs: st.mtimeMs, size: st.size });
    return m;
  }

  private async handleAddOrChange(
    filePath: string,
    kind: "add" | "change",
  ): Promise<void> {
    try {
      const m = await this.read(filePath);
      // #240/A2.1: If the id changed, the vault dropped the old mapping but
      // emitted only `change(new)` — so SearchIndex and EmbeddingIndex never
      // learned the old id must go. The stale entry outlived reconcile() and
      // recall kept returning an id that load_memory could no longer resolve.
      // Emit the removal first so every downstream index sees both halves.
      const oldId = this.filePathToId.get(filePath);
      if (oldId && oldId !== m.fm.id) {
        this.memorys.delete(oldId);
        this.emit({ kind: "remove", id: oldId, filePath });
      }
      this.memorys.set(m.fm.id, m);
      this.filePathToId.set(filePath, m.fm.id);
      this.emit({ kind, memory: m });
    } catch (err) {
      // #240/A2.2: A file that stopped being a memory — turned into a plain
      // note, or its YAML broke during an Obsidian edit — used to leave the
      // LAST VALID node in the index forever. Recall then served pre-edit
      // content as current. Drop the node and say so; the file stays on disk
      // and is re-indexed as soon as it parses again.
      const staleId = this.filePathToId.get(filePath);
      if (staleId) {
        this.memorys.delete(staleId);
        this.filePathToId.delete(filePath);
        this.fileStats.delete(filePath);
        this.emit({ kind: "remove", id: staleId, filePath });
        console.error(
          `[vault] ${basename(filePath)} no longer parses as a memory — ` +
            `dropped '${staleId}' from the index until it is valid again` +
            (err instanceof NotAMemoryFile ? "" : `: ${(err as Error).message}`),
        );
        return;
      }
      // Silent on plain notes; loud only on actual schema breakage.
      if (err instanceof NotAMemoryFile) return;
      console.error(
        `[vault] ${kind} skipped (${basename(filePath)}): ${(err as Error).message}`,
      );
    }
  }

  private handleRemove(filePath: string): void {
    this.fileStats.delete(filePath);
    const id = this.filePathToId.get(filePath);
    if (!id) return;
    this.filePathToId.delete(filePath);
    // #240/A2.3: only drop the memory if THIS path still owns the id. Two
    // files can carry the same id (cloud-sync conflict copies, a re-file
    // whose trash step failed). Removing the shadowed one used to delete the
    // winner from the index while its file sat untouched on disk — the
    // memory vanished from recall and only a daemon restart brought it back.
    const owner = this.memorys.get(id);
    if (owner && owner.filePath !== filePath) return;
    this.memorys.delete(id);
    this.emit({ kind: "remove", id, filePath });
  }

  private emit(e: VaultEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (err) {
        console.error("[vault] listener error:", err);
      }
    }
  }
}
