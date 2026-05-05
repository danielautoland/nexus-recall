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
  private listeners = new Set<VaultListener>();
  private watcher?: FSWatcher;

  constructor(public readonly root: string) {}

  async init(): Promise<{ loaded: number; skipped: { path: string; err: string }[] }> {
    const files = await this.listMarkdownFiles();
    const skipped: { path: string; err: string }[] = [];
    for (const f of files) {
      try {
        const m = await this.read(f);
        this.memorys.set(m.fm.id, m);
        this.filePathToId.set(f, m.fm.id);
      } catch (err) {
        // Plain notes (no memory `type:`) are not errors — just not ours.
        if (err instanceof NotAMemoryFile) continue;
        skipped.push({ path: f, err: (err as Error).message });
      }
    }
    return { loaded: this.memorys.size, skipped };
  }

  /** Start watching the vault tree (recursive). Emits add/change/remove. */
  startWatching(): void {
    if (this.watcher) return;
    // fsevents/kqueue do not fire reliably for files written *into* a
    // GoogleDrive/iCloud/Dropbox provider mount. Force polling on those.
    const isCloudMount = /(CloudStorage|Dropbox|iCloud)/i.test(this.root);
    this.watcher = chokidar.watch(`${this.root}/**/*.md`, {
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
    this.watcher.on("add", (p) => void this.handleAddOrChange(p, "add"));
    this.watcher.on("change", (p) => void this.handleAddOrChange(p, "change"));
    this.watcher.on("unlink", (p) => this.handleRemove(p));
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

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
  }

  on(listener: VaultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    return parseMemoryWith(
      (input) => matter(input),
      raw,
      filePath,
      st.mtimeMs,
    );
  }

  private async handleAddOrChange(
    filePath: string,
    kind: "add" | "change",
  ): Promise<void> {
    try {
      const m = await this.read(filePath);
      // If id changed (rare), drop the old mapping
      const oldId = this.filePathToId.get(filePath);
      if (oldId && oldId !== m.fm.id) {
        this.memorys.delete(oldId);
      }
      this.memorys.set(m.fm.id, m);
      this.filePathToId.set(filePath, m.fm.id);
      this.emit({ kind, memory: m });
    } catch (err) {
      // Silent on plain notes; loud only on actual schema breakage.
      if (err instanceof NotAMemoryFile) return;
      console.error(
        `[vault] ${kind} skipped (${basename(filePath)}): ${(err as Error).message}`,
      );
    }
  }

  private handleRemove(filePath: string): void {
    const id = this.filePathToId.get(filePath);
    if (!id) return;
    this.memorys.delete(id);
    this.filePathToId.delete(filePath);
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
