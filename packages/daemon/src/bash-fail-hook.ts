#!/usr/bin/env node
/**
 * bastra-recall bash-fail-hook — PostToolUse hook for failed Bash commands.
 *
 * When a Bash command fails (non-zero exit), surface vault lessons that
 * describe similar failure modes so Claude can check them before retrying
 * or trying alternatives.
 *
 * Pipeline:
 *   stdin (Claude-Code hook payload, hook_event_name=PostToolUse, tool_name=Bash)
 *     → guard: exit_code !== 0, not 130 (Ctrl-C), not a bastra-recall-* invocation
 *     → throttle: max 1 fail-hook / 30s / session
 *     → extract error tail (last ~500 chars, prefer Error/error/Failed/fatal lines)
 *     → POST 127.0.0.1:BASTRA_HTTP_PORT/hook/recall (k=3, floor 50)
 *     → emit <recall-hints surface="claude-code" trigger="bash-fail">
 *
 * Discipline (mirrors hook.ts):
 *   - Any failure path emits `{}` and exits 0.
 *   - Never blocks the workflow — Claude already saw the failure.
 *   - Never loops on its own invocations.
 */
import { request } from "node:http";
import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
// #152: dependency-free scrub leaf only — keeps this hook's load path lean.
import { HINT_FRAME_NOTE, stripFenceMarkers } from "@bastra-recall/core/scrub";
import { envFirst, envInt } from "./env.js";
import { defaultLogDir } from "./telemetry.js";
import { reportHinted } from "./hook-hinted.js";
import {
  decideBackoff,
  loadSessionState,
  recordSourceEmit,
  recordSourceSuppressed,
  saveSessionState,
  wasEmitConsumed,
} from "./session-state.js";

const HOOK_TIMEOUT_MS = envInt("BASTRA_HOOK_TIMEOUT_MS", 500, "NEXUS_HOOK_TIMEOUT_MS");
const DEFAULT_PORT = 6723;
const HOOK_VERSION = "0.1.0";
const SCORE_FLOOR = 50;
// #161: hits at/above this are REQUIRED-band — they bypass backoff suppression
// (see decideBackoff). Mirrors the MUST_LOAD_SCORE default in the other hooks.
const MUST_LOAD_SCORE = 100;
const THROTTLE_WINDOW_MS = 30_000;
const THROTTLE_DIR = join(tmpdir(), "bastra-hook");
// #161: backoff source key — fail-hints back off independently.
const BACKOFF_SOURCE = "bash-fail";

interface ClaudeHookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
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

async function main(): Promise<void> {
  const startedAt = Date.now();

  const raw = await readStdin();
  let payload: ClaudeHookPayload;
  try {
    payload = JSON.parse(raw) as ClaudeHookPayload;
  } catch {
    return emitEmpty();
  }

  if (payload.hook_event_name !== "PostToolUse") return emitEmpty();
  if (payload.tool_name !== "Bash") return emitEmpty();

  // Schema is in flux across Claude-Code versions: `tool_result` and
  // `tool_response` have both been observed. Accept either.
  const result = (payload.tool_result ?? payload.tool_response ?? {}) as Record<string, unknown>;
  const exitCode = readExitCode(result);
  // Aktuelle Claude-Code-Payloads tragen GAR KEIN Exit-Code-Feld mehr (nur
  // stdout/stderr/interrupted/…) — readExitCode() liefert dann null. Das
  // act-Signal muss trotzdem feuern (PostToolUse = Command lief); nur der
  // Fail-Hint unten braucht einen echten non-zero Code. Ein frühes
  // `exitCode === null → return` war ein Kill-Switch: 3-Tage-Audit 2026-07-10
  // fand 15 von ~7200 erwarteten act-Signalen (0,2 %).
  if (exitCode === 130) return emitEmpty(); // SIGINT — user Ctrl-C
  if (result.interrupted === true) return emitEmpty(); // Schema-Äquivalent von 130

  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  if (!command.trim()) return emitEmpty();

  // No loop on our own binaries — matcht das AUFGERUFENE Programm (Basename
  // pro Pipeline-/Subshell-Segment), nicht einen Substring: der frühere
  // Substring-Test traf auch jeden Pfad, der den Repo-Namen enthält
  // („…/Projekte/bastra-recall/…") und schluckte im Dogfood-Repo ~75 % der
  // Commands.
  if (invokesOwnBinary(command)) return emitEmpty();

  const httpURL = envFirst("BASTRA_HTTP_URL", "NEXUS_HTTP_URL");
  const httpPort = envFirst("BASTRA_HTTP_PORT", "NEXUS_HTTP_PORT") ?? String(DEFAULT_PORT);
  const url = httpURL ?? `http://127.0.0.1:${httpPort}`;

  // #144: act-signal for EVERY completed Bash command (success AND failure).
  // Telemetry-only — no recall, no injection, never throttled: the daemon
  // matches the command text against open loadedMemories episodes so
  // shell-driven applications of a memory can score acted_on. Failures are
  // swallowed; the signal must never delay the fail-recall below.
  await postAct(
    url,
    {
      tool_name: "Bash",
      tool_input_excerpt: command.slice(0, 1000),
      exit_code: exitCode,
      session_id: typeof payload.session_id === "string" ? payload.session_id : null,
    },
    Math.min(120, Math.max(50, HOOK_TIMEOUT_MS - (Date.now() - startedAt))),
  );

  // Success path ends here — the act-signal was the only job. The daemon-side
  // hook_act event is the telemetry record; no hint, no local log line.
  // exitCode === null: Command lief, aber das Payload trägt keinen Code —
  // ohne bekannten Fehler gibt es auch keinen Fail-Hint.
  if (exitCode === null || exitCode === 0) return emitEmpty();

  const sessionId = typeof payload.session_id === "string" ? payload.session_id : "default";
  if (await isThrottled(sessionId)) return emitEmpty();

  const errorContext = extractErrorContext(result);
  const commandHead = extractCommandHead(command);
  const errKeywords = extractErrorKeywords(errorContext);
  const query = `${commandHead} ${errKeywords}`.trim().slice(0, 300);

  const remainingMs = Math.max(50, HOOK_TIMEOUT_MS - (Date.now() - startedAt));

  let resp: RecallResponse | null = null;
  let status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error" = "ok";
  let errMsg: string | null = null;
  try {
    resp = await postRecall(
      url,
      { query, topics: ["bash", "failure"], project: null, tool_name: "Bash", k: 3 },
      remainingMs,
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "EHOSTUNREACH") {
      status = "daemon-unreachable";
    } else if (e.message === "timeout") {
      status = "timeout";
    } else {
      status = "error";
      errMsg = e.message ?? String(err);
    }
  }

  const hits: RecallHit[] = [];
  if (resp && Array.isArray(resp.hits)) {
    for (const h of resp.hits) {
      if (h.score >= SCORE_FLOOR) hits.push(h);
    }
  }
  if (resp && hits.length === 0) status = "no-hits";

  // No hits above floor → no value in interrupting Claude.
  let backoffStreak = 0;
  let suppressed = false;
  let suppressedTokensEst = 0;
  if (hits.length === 0) {
    emitEmpty();
  } else {
    // #161 empty-streak backoff (see session-state.ts): unconsumed injection
    // streaks widen the cadence; any load of an emitted candidate resets.
    // REQUIRED-band hits (score >= MUST_LOAD_SCORE) bypass suppression.
    const state = await loadSessionState(sessionId);
    const entry = state.sources?.[BACKOFF_SOURCE];
    const consumed = await wasEmitConsumed(entry);
    const hasRequired = hits.some((h) => h.score >= MUST_LOAD_SCORE);
    const decision = decideBackoff(entry, consumed, hasRequired);
    backoffStreak = decision.streak;
    suppressed = decision.suppress;
    const block = formatHintBlock(hits);
    if (suppressed) {
      // Suppressed emits {} like the no-hits path; the throttle stays
      // unmarked (nothing was emitted), the saved tokens go to telemetry.
      suppressedTokensEst = Math.ceil(block.length / 4);
      recordSourceSuppressed(state, BACKOFF_SOURCE);
      await saveSessionState(sessionId, state);
      emitEmpty();
    } else {
      // Mark throttle only when we actually emit — otherwise quiet calls
      // would burn the budget.
      await markThrottle(sessionId);
      // Usage sidecar (#154): only what was ACTUALLY injected counts as surfaced.
      await reportHinted(url, hits.map((h) => h.id));
      recordSourceEmit(state, BACKOFF_SOURCE, hits.map((h) => h.id), consumed);
      await saveSessionState(sessionId, state);
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: block,
          },
        }),
      );
    }
  }

  const totalMs = Date.now() - startedAt;
  await writeTelemetry({
    exit_code: exitCode,
    command_head: commandHead,
    daemon_url: url,
    daemon_reachable: resp !== null,
    hit_count: suppressed ? 0 : hits.length,
    top_score: resp?.hits?.[0]?.score ?? null,
    latency_ms_total: totalMs,
    backoff_streak: backoffStreak,
    suppressed,
    suppressed_tokens_est: suppressedTokensEst,
    status: suppressed ? "suppressed" : status,
    error: errMsg,
  });
}

function emitEmpty(): void {
  process.stdout.write("{}");
}

/** True, wenn ein Pipeline-/Subshell-Segment tatsächlich eines unserer
 *  Binaries aufruft (`bastra-recall`, `bastra-recall-*`) — geprüft am
 *  Basename des aufgerufenen Programms, damit Pfade, die den Repo-Namen nur
 *  ENTHALTEN, nicht matchen. `npx`/`node`-Wrapper, Flags und env-Prefixe
 *  werden übersprungen. */
export function invokesOwnBinary(command: string): boolean {
  for (const segment of command.split(/[|;&]+|\$\(|`/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    let program = "";
    for (const w of words) {
      if (w === "npx" || w === "node" || w.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
      program = w;
      break;
    }
    const base = program.split("/").pop() ?? "";
    if (/^bastra-recall(?:-[a-z-]+)?$/.test(base)) return true;
  }
  return false;
}

function readExitCode(result: Record<string, unknown>): number | null {
  for (const key of ["exit_code", "exitCode", "returncode", "return_code", "status"]) {
    const v = result[key];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function extractErrorContext(result: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["stderr", "error", "output", "stdout", "content"]) {
    const v = result[key];
    if (typeof v === "string") parts.push(v);
  }
  const joined = parts.join("\n");
  if (!joined) return "";
  // Last 500 chars first — that's where the real failure usually is.
  const tail = joined.slice(-500);
  // Pluck "interesting" lines if any.
  const interesting = tail
    .split(/\r?\n/)
    .filter((line) => /\b(?:Error|error|Failed|FAILED|failed|fatal|FATAL)\b/.test(line))
    .slice(-5)
    .join("\n");
  return interesting || tail;
}

/** First non-pipeline token of the command — usually the binary. */
function extractCommandHead(command: string): string {
  const firstClause = command.split(/[\n;&|]/)[0] ?? "";
  const tokens = firstClause.trim().split(/\s+/).slice(0, 3);
  return tokens.join(" ").slice(0, 80);
}

/** Pull a few alpha-tokens from the error context to seed the recall query. */
function extractErrorKeywords(ctx: string): string {
  if (!ctx) return "";
  const tokens = ctx.match(/[A-Za-z][A-Za-z_.-]{3,}/g) ?? [];
  // Dedup, keep order, cap.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out.join(" ");
}

function formatHintLine(h: RecallHit): string {
  const summary = h.summary.length > 220 ? h.summary.slice(0, 217) + "…" : h.summary;
  return `- ${h.id} (${h.type}, score ${Math.round(h.score)}): ${summary}`;
}

function formatHintBlock(hits: RecallHit[]): string {
  const head = `<recall-hints surface="claude-code" trigger="bash-fail">`;
  const tail = `</recall-hints>`;
  const lines: string[] = [];
  lines.push(
    `The Bash command above failed. These memories describe similar failure modes — check before re-running or trying alternatives.`,
  );
  for (const h of hits) lines.push(formatHintLine(h));
  return [head, HINT_FRAME_NOTE, stripFenceMarkers(lines.join("\n")), tail].join("\n");
}

function throttleFile(sessionId: string): string {
  // sanitize sessionId — keep alnum + dash, fall back if empty
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "default";
  return join(THROTTLE_DIR, `fail-throttle-${safe}.ts`);
}

async function isThrottled(sessionId: string): Promise<boolean> {
  try {
    const s = await stat(throttleFile(sessionId));
    return Date.now() - s.mtimeMs < THROTTLE_WINDOW_MS;
  } catch {
    return false;
  }
}

async function markThrottle(sessionId: string): Promise<void> {
  try {
    // mode 0700/0600: os.tmpdir() is world-writable on Linux — keep the
    // throttle dir/files owner-only to block symlink/TOCTOU races.
    await mkdir(THROTTLE_DIR, { recursive: true, mode: 0o700 });
    await writeFile(throttleFile(sessionId), String(Date.now()), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Best-effort; missing throttle is acceptable.
  }
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
  topics: string[];
  project: string | null;
  tool_name: string;
  k: number;
  scope?: string;
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
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as RecallResponse);
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

/** #144: fire the act-signal at /hook/act. Best-effort — resolves on any
 *  outcome (error, timeout, non-2xx); the act-signal must never break or
 *  delay the hook's main job. */
function postAct(
  baseUrl: string,
  // exit_code null = Command lief, aber das aktuelle Claude-Code-Payload
  // trägt kein Exit-Code-Feld — das act-Signal zählt trotzdem (#144-Audit).
  body: { tool_name: string; tool_input_excerpt: string; exit_code: number | null; session_id: string | null },
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL("/hook/act", baseUrl);
    } catch {
      resolve();
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
        res.resume(); // drain — response content is irrelevant
        res.on("end", () => resolve());
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.on("error", () => resolve());
    req.write(payload);
    req.end();
  });
}

interface BashFailHookTelemetry {
  exit_code: number;
  command_head: string;
  daemon_url: string;
  daemon_reachable: boolean;
  hit_count: number;
  top_score: number | null;
  latency_ms_total: number;
  /** #161: aufgelöster Streak der Backoff-Entscheidung dieses Events. */
  backoff_streak: number;
  /** #161: true, wenn der Backoff die Injektion unterdrückt hat. */
  suppressed: boolean;
  /** #161: Tokens des NICHT injizierten Blocks — die Sparseite der ROI. */
  suppressed_tokens_est: number;
  status: "ok" | "no-hits" | "suppressed" | "daemon-unreachable" | "timeout" | "error";
  error: string | null;
}

async function writeTelemetry(payload: BashFailHookTelemetry): Promise<void> {
  if ((envFirst("BASTRA_TELEMETRY", "NEXUS_TELEMETRY") ?? "on").toLowerCase() === "off") return;
  try {
    const logDir = envFirst("BASTRA_LOG_PATH", "NEXUS_LOG_PATH") ?? defaultLogDir();
    await mkdir(logDir, { recursive: true });
    const ts = new Date().toISOString();
    const event = {
      kind: "bash_fail_hook_call",
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

// Export for testing.
export {
  readExitCode,
  extractErrorContext,
  extractCommandHead,
  extractErrorKeywords,
  formatHintBlock,
  isThrottled,
  markThrottle,
  throttleFile,
  THROTTLE_WINDOW_MS,
};

const isMain = (() => {
  if (typeof process.argv[1] !== "string") return false;
  const argv1 = process.argv[1];
  return (
    argv1.endsWith("bash-fail-hook.js") ||
    argv1.endsWith("bash-fail-hook.ts") ||
    argv1.endsWith("bastra-recall-bash-fail-hook")
  );
})();

if (isMain) {
  // Kill-Switch NUR im Binary-Modus: er begrenzt die Hook-Laufzeit gegenüber
  // Claude Code. Auf Modul-Top-Level exitete er auch IMPORTEURE — der
  // Test-Runner starb nach ~2s mit exit 0 und übersprang still alle
  // restlichen Tests der Datei (Audit 2026-07-10).
  const killSwitch = setTimeout(() => {
    emitEmpty();
    process.exit(0);
  }, HOOK_TIMEOUT_MS + 50);
  killSwitch.unref();

  main()
    .then(() => process.exit(0))
    .catch(() => {
      emitEmpty();
      process.exit(0);
    });
}
