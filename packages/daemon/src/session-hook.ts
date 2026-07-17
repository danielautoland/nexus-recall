#!/usr/bin/env node
/**
 * bastra-recall session-start hook — preloads the most relevant memorys for
 * a fresh Claude Code session as `additionalContext` so the model knows
 * who the user is, what project they're in, and what cross-project rules
 * apply, before the first user prompt arrives.
 *
 * Pipeline:
 *   stdin (JSON Claude-Code SessionStart payload)
 *     → detectProject(cwd)
 *     → 3 scope-filtered POSTs to 127.0.0.1:BASTRA_HTTP_PORT/hook/recall
 *         · scope=user-preference  k=3   query="session-start preferences"
 *         · scope=<project>        k=3   query="<project> active context"
 *         · scope=all-projects     k=2   query="cross-project working rules"
 *     → merge by score, drop dups, format as <session-context>…</session-context>
 *     → GET /hook/floors (#141/#142): floored memories as a <pinned-memories>
 *       block BEFORE the score-gated hints — push-by-state, never relevance-
 *       gated, never dropped by any dedup
 *     → stdout: {"hookSpecificOutput": { hookEventName, additionalContext }}
 *
 * Discipline mirrors hook.ts: hard wall-clock budget, fail-silent on every
 * error path, telemetry best-effort.
 */
import { detectProject } from "@bastra-recall/core";
import { HINT_FRAME_NOTE, stripFenceMarkers } from "@bastra-recall/core/scrub";
import { request } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { envFirst, envInt } from "./env.js";
import { effectiveUpdateMode, getDocsLanguage, getDocsMode } from "./settings.js";
import { formatDokuBlock } from "./doku-block.js";
import { defaultLogDir } from "./telemetry.js";
import { spawnStagedUpdate, stagedToday, markStagedToday } from "./update-check.js";
import { consumePendingSuggestions } from "./pending-suggestions.js";
import { formatPinnedBlock, dropPinnedFromRanked, type PinnedFloorLean } from "./pinned-block.js";
import { reportHinted } from "./hook-hinted.js";

const HOOK_TIMEOUT_MS = envInt("BASTRA_HOOK_TIMEOUT_MS", 500, "NEXUS_HOOK_TIMEOUT_MS");
const DEFAULT_PORT = 6723;
const HOOK_VERSION = "0.3.0";
const SCORE_FLOOR = 30;
const MUST_LOAD_SCORE = 100;
const TOTAL_HINTS_CAP = 7;

interface SessionPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: "startup" | "resume" | "clear" | "compact";
}

interface RecallHit {
  id: string;
  title: string;
  type: string;
  scope: string;
  summary: string;
  score: number;
}

interface RecallResponse {
  hits: RecallHit[];
  vault_size: number;
  latency_ms: number;
  recall_id: string;
}

interface UpdateAvailable {
  current: string;
  latest: string;
  html_url: string;
  published_at: string;
}

interface HealthResponse {
  ok: boolean;
  update_available: UpdateAvailable | null;
}

interface ConventionLean {
  id: string;
  title: string;
  summary: string;
  updated: string;
}

interface TaxonomyResponse {
  conventions: ConventionLean[];
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  const raw = await readStdin();
  let payload: SessionPayload;
  try {
    payload = JSON.parse(raw) as SessionPayload;
  } catch {
    return emitEmpty();
  }
  if (payload.hook_event_name !== "SessionStart") return emitEmpty();

  const project = detectProject(payload.cwd ?? process.cwd());
  const httpURL = envFirst("BASTRA_HTTP_URL", "NEXUS_HTTP_URL");
  const httpPort = envFirst("BASTRA_HTTP_PORT", "NEXUS_HTTP_PORT") ?? String(DEFAULT_PORT);
  const url = httpURL ?? `http://127.0.0.1:${httpPort}`;

  const queries: Array<{ scope: string; query: string; k: number }> = [
    { scope: "user-preference", query: "session-start preferences active context", k: 3 },
    { scope: "all-projects", query: "cross-project working rules", k: 2 },
  ];
  if (project) {
    queries.push({ scope: project, query: `${project} active context project-facts decisions`, k: 3 });
  }

  let status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error" = "ok";
  let errMsg: string | null = null;
  const responses: Array<{ scope: string; resp: RecallResponse | null }> = [];

  for (const q of queries) {
    const remainingMs = Math.max(60, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    try {
      const resp = await postRecall(
        url,
        { query: q.query, scope: q.scope, k: q.k, project, source: payload.source ?? null },
        remainingMs,
      );
      responses.push({ scope: q.scope, resp });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "EHOSTUNREACH") {
        status = "daemon-unreachable";
        responses.push({ scope: q.scope, resp: null });
        break; // no point hammering
      }
      if (e.message === "timeout") {
        status = "timeout";
      } else {
        status = "error";
        errMsg = e.message ?? String(err);
      }
      responses.push({ scope: q.scope, resp: null });
    }
  }

  // Merge: dedup by id, sort by score, cap total.
  const seen = new Set<string>();
  const merged: RecallHit[] = [];
  for (const r of responses) {
    if (!r.resp) continue;
    for (const h of r.resp.hits) {
      if (h.score < SCORE_FLOOR) continue;
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      merged.push(h);
    }
  }
  merged.sort((a, b) => b.score - a.score);

  // Floor-Registry (#141/#142): gepinnte Memories — push-by-state, bewusst
  // NICHT score-gated (gleiches Muster wie der Taxonomie-Block: dedizierter
  // Listen-Endpoint statt Recall-Suche; ein Constraint darf nicht am Floor
  // sterben, dessen Job es ist, präsent zu sein, wenn der Turn ihn nicht für
  // relevant hält). Dedup-Verifikation: der Session-Hook wendet KEINEN
  // session-state-Dedup an (shouldDropHit lebt ausschließlich im PreToolUse-
  // Hook, hook.ts) — gepinnte Einträge können hier also nie weggededupt
  // werden. Der einzige Dedup läuft in die GEGENrichtung: dropPinnedFromRanked
  // entfernt ranked-Duplikate, damit die Hint-Liste kein Budget doppelt auf
  // bereits garantierte Einträge ausgibt.
  let pinned: PinnedFloorLean[] = [];
  if (responses.some((r) => r.resp !== null)) {
    const remainingMs = Math.max(60, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    pinned = await fetchFloors(url, project, Math.min(150, remainingMs));
    // Ohne erkanntes Projekt injizieren nur globale (unscoped) Floors —
    // fremd-gescopte Einträge wären in einer projektlosen Session Rauschen.
    if (!project) pinned = pinned.filter((e) => !e.scope);
  }
  const pinnedBlock = formatPinnedBlock(pinned);
  const top = dropPinnedFromRanked(merged, pinned).slice(0, TOTAL_HINTS_CAP);

  // Taxonomie-Konventionen (#66): bindende, selbst-gelernte Struktur-Regeln
  // des Vaults. Dedizierter Listen-Endpoint statt Recall-Suche — Konventionen
  // konkurrieren nicht über Scores und dürfen nicht am Floor sterben.
  let conventions: ConventionLean[] = [];
  if (responses.some((r) => r.resp !== null)) {
    const remainingMs = Math.max(60, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    conventions = await fetchTaxonomy(url, Math.min(150, remainingMs));
  }
  const taxonomyBlock = formatTaxonomyBlock(conventions);

  // Vault-care (#207): open flags from the vault map. Injected as a standing
  // instruction so no user ever has to EXPLAIN the workflow to their agent —
  // the system carries it.
  let careBlock = "";
  if (responses.some((r) => r.resp !== null)) {
    const remainingMs = Math.max(60, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    const openCare = await fetchCareCount(url, Math.min(150, remainingMs));
    if (openCare > 0) {
      careBlock =
        `\n<vault-care>\n` +
        `The vault has ${openCare} open care flag(s) in vault-care.md (at the vault root) — ` +
        `notes the user flagged on the vault map for deletion, editing, writing, or with a remark. ` +
        `When the user asks to work off the vault care list (any phrasing), read that file and go ` +
        `through the open "- [ ]" entries TOGETHER with the user: load and show each memory first, ` +
        `propose the change, apply it via the memory tools only after their go — deletions always ` +
        `need explicit confirmation. Tick finished lines to "- [x]" in the file. Never apply flags ` +
        `unprompted; if vault maintenance comes up, mention the open count.\n` +
        `</vault-care>`;
    }
  }

  // Import review (#208): candidates staged by `bastra import` from other AI
  // tools' memories. Standing instruction — the user never has to explain
  // the distillation workflow to their agent.
  let importBlock = "";
  if (responses.some((r) => r.resp !== null)) {
    const remainingMs = Math.max(60, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    const openImports = await fetchCareCount(url, Math.min(150, remainingMs), "/hook/import");
    if (openImports > 0) {
      importBlock =
        `\n<import-review>\n` +
        `The vault has ${openImports} open import candidate(s) in import-review.md (at the vault ` +
        `root) — memories exported from other AI tools (ChatGPT, Claude, Gemini, …), staged by ` +
        `\`bastra import\` and awaiting distillation. When the user asks to work off the import ` +
        `list (any phrasing), read that file and go through the open "- [ ]" entries TOGETHER ` +
        `with the user, in blocks: for each accepted candidate save a REAL memory via save_memory ` +
        `— proper type, concrete recall_when including an ask-trigger in the user's own ` +
        `vocabulary, dedupe against existing memories first, admission rules apply (capture fixes ` +
        `not failures, declarative facts not imperatives, skip stale artifacts) — and stamp ` +
        `write_origin: "capture-review". Tick finished lines to "- [x]"; tick rejected ones too, ` +
        `appending " — skipped". Never distill unprompted; if onboarding or importing comes up, ` +
        `mention the open count.\n` +
        `</import-review>`;
    }
  }

  // Best-effort update probe — only when we already have a daemon reachable.
  // Strict budget: 200 ms; if nothing back, we just skip the block.
  //
  // Mode decides what happens when an update is available:
  //   · "auto"   → stage a detached file-swap (no daemon restart, so a running
  //                session is never disrupted) on a real session start
  //                (startup/resume — never mid-session via clear/compact),
  //                throttled to once/day, and tell the user it's being applied.
  //   · "notify" → just suggest `bastra update`.
  //   · "off"    → never reached (detection is disabled, so update_available
  //                is null).
  let updateBlock = "";
  if (responses.some((r) => r.resp !== null)) {
    const remainingMs = Math.max(80, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    const probeBudget = Math.min(200, remainingMs);
    try {
      const health = await probeHealth(url, probeBudget);
      if (health?.update_available) {
        const u = health.update_available;
        const mode = await effectiveUpdateMode();
        const isSessionStart = payload.source === "startup" || payload.source === "resume";
        if (mode === "auto" && isSessionStart && !(await stagedToday())) {
          spawnStagedUpdate();
          await markStagedToday();
          updateBlock =
            `\n<bastra-update>\n` +
            `bastra-recall is updating in the background: ${u.current} → ${u.latest}.\n` +
            `Files are being swapped now; the new code goes live on the next daemon ` +
            `restart (automatically after idle, or right away when the user restarts).\n` +
            `Tell the user: an update to ${u.latest} is being applied — restart Claude Code ` +
            `(and any open Claude Desktop / Cursor) when convenient to pick it up.\n` +
            `</bastra-update>`;
        } else {
          updateBlock =
            `\n<bastra-update>\n` +
            `A new bastra-recall version is available: ${u.current} → ${u.latest}.\n` +
            `Release notes: ${u.html_url}\n` +
            `Suggest the user run \`bastra update\` when convenient.\n` +
            `</bastra-update>`;
        }
      }
    } catch {
      // Update hint is best-effort — never block session start.
    }
  }

  // #48 Redesign: still abgelegte Stop-Hook-Vorschläge der LETZTEN Session
  // einsammeln (consume-once, max 7 Tage alt) — der Agent sieht sie als
  // additionalContext, der Chat bleibt sauber.
  let pendingBlock = "";
  try {
    const pending = await consumePendingSuggestions();
    if (pending.length > 0) {
      pendingBlock =
        `\n<pending-save-suggestions source="stop-hook">\n` +
        `From earlier session(s) — evaluate silently, save via bastra-recall:save_memory only what genuinely qualifies:\n` +
        pending.map((p) => p.blocks).join("\n") +
        `\n</pending-save-suggestions>`;
    }
  } catch {
    /* relay is best-effort */
  }

  // Produkt-Doku (docs.mode): Anweisung nur injizieren, wenn das Feature
  // eingeschaltet ist UND ein Projekt erkannt wurde (Doku ist per-project).
  // Settings-Read ist ein lokaler File-Read — kein Daemon-Roundtrip nötig.
  let dokuBlock = "";
  if (project) {
    try {
      const docsMode = await getDocsMode();
      if (docsMode !== "off") {
        dokuBlock = formatDokuBlock(docsMode, await getDocsLanguage(), project);
      }
    } catch {
      // Docs hint is best-effort — never block session start.
    }
  }

  const extras = taxonomyBlock + careBlock + importBlock + updateBlock + pendingBlock + dokuBlock;
  // #141/#142: der Pinned-Block steht VOR den score-gated Hints — die
  // garantierten Einträge zuerst, die relevanz-gerankte Liste dahinter.
  const pinnedHead = pinnedBlock === "" ? "" : pinnedBlock + "\n";
  // hint_tokens_est (#72): Token-Schätzung des injizierten Kontexts.
  let injected = "";
  if (top.length === 0 && pinnedBlock === "" && extras === "") {
    if (status === "ok") status = "no-hits";
    emitEmpty();
  } else if (top.length === 0) {
    // Only pinned entries, conventions and/or an update banner, no recall hits.
    injected = (pinnedBlock + extras).trimStart();
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: injected,
        },
      }),
    );
  } else {
    injected = pinnedHead + formatBlock(top, project, payload.source ?? null) + extras;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: injected,
        },
      }),
    );
  }

  await writeTelemetry({
    source: payload.source ?? null,
    project,
    queries: queries.length,
    daemon_url: url,
    daemon_reachable: responses.some((r) => r.resp !== null),
    hint_count: top.length,
    convention_count: conventions.length,
    pinned_count: pinned.length,
    top_score: top[0]?.score ?? null,
    latency_ms_total: Date.now() - startedAt,
    hint_tokens_est: Math.ceil(injected.length / 4),
    hinted_ids: top.map((h) => h.id),
    status,
    error: errMsg,
  });
  // Usage sidecar (#154): only what was ACTUALLY injected counts as surfaced.
  await reportHinted(url, top.map((h) => h.id));
}

function emitEmpty(): void {
  process.stdout.write("{}");
}

function formatBlock(hits: RecallHit[], project: string | null, source: string | null): string {
  const projAttr = project ? ` project="${escapeAttr(project)}"` : "";
  const srcAttr = source ? ` source="${escapeAttr(source)}"` : "";
  const head = `<session-context surface="claude-code"${projAttr}${srcAttr}>`;
  const tail = `</session-context>`;

  const required = hits.filter((h) => h.score >= MUST_LOAD_SCORE);
  const optional = hits.filter((h) => h.score < MUST_LOAD_SCORE);
  const sections: string[] = [];

  if (required.length > 0) {
    sections.push(
      `Strong matches (score ≥${MUST_LOAD_SCORE}) for ${project ?? "this"} session — ` +
        `load_memory(id) the ones relevant to what the user actually asks for. ` +
        `These are hints, not obligations: load only what fits, don't batch-load the list, ` +
        `and if the user requested a specific number or scope, honor that over this list.`,
    );
    for (const h of required) sections.push(formatHintLine(h));
  }

  if (optional.length > 0) {
    if (required.length > 0) sections.push("");
    sections.push(
      `OPTIONAL (score ${SCORE_FLOOR}–${MUST_LOAD_SCORE - 1}) — load only when the user prompt directly touches the topic:`,
    );
    for (const h of optional) sections.push(formatHintLine(h));
  }

  return [head, HINT_FRAME_NOTE, stripFenceMarkers(sections.join("\n")), tail].join("\n");
}

function formatHintLine(h: RecallHit): string {
  const summary = h.summary.length > 220 ? h.summary.slice(0, 217) + "…" : h.summary;
  return `- ${h.id} (${h.type}/${h.scope}, score ${Math.round(h.score)}): ${summary}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

interface RecallRequestBody {
  query: string;
  scope?: string;
  k: number;
  project: string | null;
  source: string | null;
}

function postRecall(
  baseUrl: string,
  body: RecallRequestBody,
  timeoutMs: number,
): Promise<RecallResponse> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL("/hook/recall", baseUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": payload.byteLength.toString(),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw) as RecallResponse);
          } catch {
            reject(new Error("invalid JSON response from daemon"));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Konventions-Block (#66). Kompakt: Titel + Summary pro Konvention, dazu die
 * Anweisung, sie beim Speichern zu BEFOLGEN (Details via load_memory). Cap 6 —
 * mehr Konventionen heißt das Vault braucht eher eine Meta-Aufräumrunde als
 * mehr Kontext.
 */
function formatTaxonomyBlock(conventions: ConventionLean[]): string {
  if (conventions.length === 0) return "";
  // #152: anti-spoof strip only — deliberately NO reference-only note here,
  // conventions are meant to be BINDING instructions.
  const lines = conventions
    .slice(0, 6)
    .map((c) => stripFenceMarkers(`- [${c.id}] ${c.title}: ${c.summary}`));
  return (
    `\n<vault-taxonomy>\n` +
    `Self-learned vault conventions — BINDING when saving memories in these clusters. ` +
    `Follow the convention's folder/topic_path/tags exactly (load_memory(id) for the full rule) ` +
    `instead of inventing variant tags that fragment recall:\n` +
    lines.join("\n") +
    `\n</vault-taxonomy>`
  );
}

/** Open-count from a /hook/* endpoint (care, import) — same budget
 *  discipline as fetchTaxonomy. */
function fetchCareCount(baseUrl: string, timeoutMs: number, path = "/hook/care"): Promise<number> {
  return new Promise((resolve_) => {
    let url: URL;
    try {
      url = new URL(path, baseUrl);
    } catch {
      resolve_(0);
      return;
    }
    const req = request(
      { method: "GET", hostname: url.hostname, port: url.port || 80, path: url.pathname, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { open?: unknown };
            resolve_(typeof parsed.open === "number" ? parsed.open : 0);
          } catch {
            resolve_(0);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve_(0));
    req.end();
  });
}

function fetchTaxonomy(baseUrl: string, timeoutMs: number): Promise<ConventionLean[]> {
  return new Promise((resolve_) => {
    let url: URL;
    try {
      url = new URL("/hook/taxonomy", baseUrl);
    } catch {
      resolve_([]);
      return;
    }
    const req = request(
      {
        method: "GET",
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as TaxonomyResponse;
            if ((res.statusCode ?? 500) === 200 && Array.isArray(data.conventions)) {
              resolve_(data.conventions);
              return;
            }
          } catch { /* fallthrough */ }
          resolve_([]);
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve_([]);
    });
    req.on("error", () => resolve_([]));
    req.end();
  });
}

interface FloorsResponse {
  floors: PinnedFloorLean[];
}

/**
 * Floor-Registry-Fetch (#141/#142). Gleiche Disziplin wie fetchTaxonomy:
 * fail-silent, ein GET, hartes Timeout — der Daemon joint id→title/summary
 * bereits serverseitig (/hook/floors), die Hook-CLI bleibt dumm. Mit Projekt
 * wird scope=<project> angefragt (Daemon liefert scoped + unscoped).
 */
function fetchFloors(baseUrl: string, project: string | null, timeoutMs: number): Promise<PinnedFloorLean[]> {
  return new Promise((resolve_) => {
    let url: URL;
    try {
      url = new URL("/hook/floors", baseUrl);
      if (project) url.searchParams.set("scope", project);
    } catch {
      resolve_([]);
      return;
    }
    const req = request(
      {
        method: "GET",
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as FloorsResponse;
            if ((res.statusCode ?? 500) === 200 && Array.isArray(data.floors)) {
              resolve_(data.floors);
              return;
            }
          } catch { /* fallthrough */ }
          resolve_([]);
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve_([]);
    });
    req.on("error", () => resolve_([]));
    req.end();
  });
}

function probeHealth(baseUrl: string, timeoutMs: number): Promise<HealthResponse | null> {
  return new Promise((resolve_) => {
    let url: URL;
    try {
      url = new URL("/health", baseUrl);
    } catch {
      resolve_(null);
      return;
    }
    const req = request(
      {
        method: "GET",
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HealthResponse;
            if ((res.statusCode ?? 500) === 200 && data && data.ok) {
              resolve_(data);
              return;
            }
          } catch { /* fallthrough */ }
          resolve_(null);
        });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve_(null); });
    req.on("error", () => resolve_(null));
    req.end();
  });
}

// spawnStagedUpdate / stagedToday / markStagedToday wohnen seit #81 in
// update-check.ts — der Daemon-Self-Update-Pfad teilt denselben Tages-
// Throttle, damit Hook und Daemon nicht am selben Tag doppelt stagen.

interface SessionHookTelemetry {
  source: string | null;
  project: string | null;
  queries: number;
  daemon_url: string;
  daemon_reachable: boolean;
  hint_count: number;
  convention_count: number;
  /** Gepinnte Floor-Einträge im <pinned-memories>-Block (#141/#142). */
  pinned_count: number;
  top_score: number | null;
  latency_ms_total: number;
  /** Geschätzte Tokens des injizierten Session-Kontexts (#72). */
  hint_tokens_est: number;
  hinted_ids: string[];
  status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error";
  error: string | null;
}

async function writeTelemetry(payload: SessionHookTelemetry): Promise<void> {
  if ((envFirst("BASTRA_TELEMETRY", "NEXUS_TELEMETRY") ?? "on").toLowerCase() === "off") return;
  try {
    const logDir = envFirst("BASTRA_LOG_PATH", "NEXUS_LOG_PATH") ?? defaultLogDir();
    await mkdir(logDir, { recursive: true });
    const ts = new Date().toISOString();
    const event = {
      kind: "session_hook_call",
      ts,
      session_id: randomUUID(),
      hook_version: HOOK_VERSION,
      ...payload,
    };
    const file = join(logDir, `events-${ts.slice(0, 10)}.jsonl`);
    await appendFile(file, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // Telemetry must never break the hook.
  }
}

const killSwitch = setTimeout(() => {
  emitEmpty();
  process.exit(0);
}, HOOK_TIMEOUT_MS + 100);
killSwitch.unref();

main()
  .then(() => process.exit(0))
  .catch(() => {
    emitEmpty();
    process.exit(0);
  });
