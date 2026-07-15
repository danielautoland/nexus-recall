/**
 * Vault map web UI (#207) — static file serving for /ui.
 *
 * Serves the self-contained viewer bundled in `packages/daemon/webui/`
 * (plain HTML/CSS/JS, vendored assets only, zero external requests). Opt-in:
 * gated per-request on the `ui.enabled` cli-setting, so
 * `bastra config set ui.enabled true|false` takes effect without a daemon
 * restart. Loopback-only by construction: the route sits outside /api/v1/*,
 * so http.ts's DNS-rebinding host gate already covers it.
 */
import { createReadStream } from "node:fs";
import { appendFile, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SearchIndex } from "@bastra-recall/core";
import { getUiEnabled } from "./settings.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** dist/webui.js → ../webui — the asset folder ships at the package root. */
export function resolveWebUiDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "webui");
}

// ─── vault care — annotations from the map, worked off in an AI session ────
//
// The map never edits memories. Instead the user flags them ("delete",
// "edit", "write this unwritten note", free note); each flag is appended to
// `vault-care.md` at the vault root — plain markdown with checkbox lines and
// wikilinks, readable by Obsidian, any AI session, and any viewer (#140).
// An AI session works the list off together with the user and ticks entries
// `[x]`; the map only shows unticked ones.

export const CARE_FILE = "vault-care.md";
export const CARE_KINDS = ["delete", "edit", "write", "note"] as const;
export type CareKind = (typeof CARE_KINDS)[number];

const CARE_HEADER = `# Vault Care

Flags from the vault map. In an AI session, say "let's work off the vault
care list" — go through the open entries together, apply them via the memory
tools, and tick them \`[x]\` here when done.

`;
const CARE_LINE_RE = /^- \[([ x])\] (\d{4}-\d{2}-\d{2}) · (\w+) · \[\[([^\]]+)\]\](?: — (.*))?$/;

export interface CareEntry {
  done: boolean;
  date: string;
  kind: string;
  id: string;
  note: string;
}

export function parseCareFile(content: string): CareEntry[] {
  const out: CareEntry[] = [];
  for (const line of content.split("\n")) {
    const m = CARE_LINE_RE.exec(line.trimEnd());
    if (m) out.push({ done: m[1] === "x", date: m[2], kind: m[3], id: m[4], note: m[5] ?? "" });
  }
  return out;
}

function sendJsonPlain(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

/** GET /ui/search?q=… — semantic recall for the map's search box. Hybrid
 *  (BM25 + embeddings when live), lean hits only, never private memories. */
export async function handleUiSearch(
  res: ServerResponse,
  url: string,
  search: SearchIndex,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
    return;
  }
  const q = new URL(url, "http://127.0.0.1").searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    sendJsonPlain(res, 200, { hits: [] });
    return;
  }
  try {
    const hits = await search.recallHybrid(q, { k: 8, allow_private: false });
    sendJsonPlain(res, 200, {
      hits: hits.map((h) => ({ id: h.id, title: h.title, type: h.type, score: h.score })),
    });
  } catch (err) {
    sendJsonPlain(res, 500, { error: (err as Error).message });
  }
}

// ─── vault image — the ring view's center emblem ────────────────────────────

const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const IMAGE_BASENAME = "vault-image";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

async function findVaultImage(vaultPath: string): Promise<{ file: string; type: string } | null> {
  for (const [type, ext] of Object.entries(IMAGE_TYPES)) {
    const file = join(vaultPath, IMAGE_BASENAME + ext);
    try {
      if ((await stat(file)).isFile()) return { file, type };
    } catch {
      /* next */
    }
  }
  return null;
}

/** GET /ui/vault-image — serve the emblem (404 = none set → monogram). */
export async function handleUiVaultImageGet(res: ServerResponse, vaultPath: string): Promise<void> {
  const found = await findVaultImage(vaultPath);
  if (!found) {
    sendJsonPlain(res, 404, { error: "no vault image" });
    return;
  }
  const st = await stat(found.file);
  res.writeHead(200, { "Content-Type": found.type, "Content-Length": st.size, "Cache-Control": "no-cache" });
  createReadStream(found.file)
    .on("error", () => res.destroy())
    .pipe(res);
}

/** POST /ui/vault-image — raw image body; stored as vault-image.<ext> at the
 *  vault root (open file, visible in Obsidian/Finder like everything else). */
export async function handleUiVaultImagePost(
  req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
    return;
  }
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!ext) {
    sendJsonPlain(res, 415, { error: "image/png, image/jpeg or image/webp only" });
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_IMAGE_BYTES) {
      sendJsonPlain(res, 413, { error: "max 2 MB" });
      return;
    }
    chunks.push(chunk as Buffer);
  }
  if (size === 0) {
    sendJsonPlain(res, 400, { error: "empty body" });
    return;
  }
  try {
    // one emblem at a time — drop other extensions before writing
    for (const oldExt of Object.values(IMAGE_TYPES)) {
      if (oldExt !== ext) await unlink(join(vaultPath, IMAGE_BASENAME + oldExt)).catch(() => undefined);
    }
    await writeFile(join(vaultPath, IMAGE_BASENAME + ext), Buffer.concat(chunks));
    sendJsonPlain(res, 200, { ok: true });
  } catch (err) {
    sendJsonPlain(res, 500, { error: (err as Error).message });
  }
}

/** GET /hook/care — open-flag count for the session hook. Deliberately NOT
 *  gated on ui.enabled: the file may exist from earlier use or hand-editing,
 *  and the session instruction should surface either way. */
export async function handleHookCare(res: ServerResponse, vaultPath: string): Promise<void> {
  try {
    const content = await readFile(join(vaultPath, CARE_FILE), "utf8");
    const open = parseCareFile(content).filter((e) => !e.done).length;
    sendJsonPlain(res, 200, { open, file: CARE_FILE });
  } catch {
    sendJsonPlain(res, 200, { open: 0, file: CARE_FILE });
  }
}

/** GET /ui/annotations — the parsed care list. */
export async function handleUiAnnotations(
  res: ServerResponse,
  vaultPath: string,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
    return;
  }
  try {
    const content = await readFile(join(vaultPath, CARE_FILE), "utf8");
    sendJsonPlain(res, 200, { annotations: parseCareFile(content) });
  } catch {
    sendJsonPlain(res, 200, { annotations: [] }); // no file yet = empty list
  }
}

/** POST /ui/annotate {id, kind, note?} — append one care entry. */
export async function handleUiAnnotate(
  req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) {
      sendJsonPlain(res, 413, { error: "body too large" });
      return;
    }
  }
  let body: { id?: unknown; kind?: unknown; note?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    sendJsonPlain(res, 400, { error: "invalid json" });
    return;
  }
  const id = typeof body.id === "string" ? body.id.replace(/[[\]\n\r]/g, "").trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const note =
    typeof body.note === "string" ? body.note.replace(/[\n\r]+/g, " ").trim().slice(0, 500) : "";
  if (!id || !(CARE_KINDS as readonly string[]).includes(kind)) {
    sendJsonPlain(res, 400, { error: "need id and kind (delete|edit|write|note)" });
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const line = `- [ ] ${date} · ${kind} · [[${id}]]${note ? ` — ${note}` : ""}\n`;
  const file = join(vaultPath, CARE_FILE);
  try {
    try {
      await stat(file);
    } catch {
      await writeFile(file, CARE_HEADER, "utf8");
    }
    await appendFile(file, line, "utf8");
    sendJsonPlain(res, 200, { ok: true, entry: { done: false, date, kind, id, note } });
  } catch (err) {
    sendJsonPlain(res, 500, { error: (err as Error).message });
  }
}

function sendPlain(res: ServerResponse, status: number, msg: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(msg);
}

/** Handles GET /ui and GET /ui/* — call only after the host gate passed.
 *  `webUiDir`/`settingsPath` are injectable for tests only. */
export async function handleWebUi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  webUiDir: string = resolveWebUiDir(),
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendPlain(res, 404, "vault map UI is disabled — enable with: bastra config set ui.enabled true");
    return;
  }

  // /ui → /ui/ so relative asset paths in index.html resolve.
  if (url === "/ui") {
    res.writeHead(302, { Location: "/ui/" });
    res.end();
    return;
  }

  const pathname = decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
  const rel = pathname === "/ui/" ? "index.html" : pathname.slice("/ui/".length);

  // Traversal guard: the resolved target must stay inside the asset dir.
  const root = resolve(webUiDir);
  const target = resolve(root, normalize(rel));
  if (target !== root && !target.startsWith(root + sep)) {
    sendPlain(res, 403, "forbidden");
    return;
  }

  const type = CONTENT_TYPES[extname(target).toLowerCase()];
  if (type === undefined) {
    sendPlain(res, 404, "not found");
    return;
  }

  try {
    const st = await stat(target);
    if (!st.isFile()) {
      sendPlain(res, 404, "not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      // Short-lived cache: assets change with daemon updates, not per request.
      "Cache-Control": "max-age=60",
    });
    createReadStream(target)
      .on("error", () => res.destroy())
      .pipe(res);
  } catch {
    sendPlain(res, 404, "not found");
  }
}
