#!/usr/bin/env node
/**
 * bastra-recall prompt hook — UserPromptSubmit reflex layer (Issue #33).
 *
 * Pipeline:
 *   stdin (JSON Claude-Code hook payload)
 *     -> filter to hook_event_name === "UserPromptSubmit"
 *     -> extract user prompt from payload.prompt / payload.user_message
 *     -> detect retrieval mode -> "retrieval" | "none" (default) | "generic" (env-opt-in)
 *     -> if retrieval/generic: POST 127.0.0.1:BASTRA_HTTP_PORT/hook/recall  (k=5, score-floor 50)
 *     -> emit <recall-hints surface="claude-code" trigger="prompt-lookup"> with
 *        explicit "use bastra-recall:recall BEFORE conversation_search" instruction
 *     -> otherwise: emit `{}`
 *
 * Why a separate file (not added to hook.ts):
 *   - hook.ts is under heavy refactor in a parallel PR; this hook ships as
 *     its own CLI entry (`bastra-recall-prompt-hook`) to avoid merge friction.
 *   - Helpers (postRecall/emitEmpty/telemetry/readStdin) are intentionally
 *     copied — not imported — for the same reason.
 */
import { detectProject } from "@bastra-recall/core";
import { HINT_FRAME_NOTE, stripFenceMarkers } from "@bastra-recall/core/scrub";
import { request } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { envFirst, envInt } from "./env.js";
import { defaultLogDir } from "./telemetry.js";
import { claudeSessionPid, sessionFeedPath, STATUSLINE_DIR } from "./statusline-session.js";
import { idleStatuslineState } from "./statusline-feed.js";
import { reportHinted } from "./hook-hinted.js";
import {
  decideBackoff,
  loadSessionState,
  recordSourceEmit,
  recordSourceSuppressed,
  saveSessionState,
  wasEmitConsumed,
} from "./session-state.js";

// Session-namespaced feed — same path the forwarder of THIS session writes
// (claude ancestor PID, since CC sends no session id — #41836).
const STATUSLINE_FEED_PATH = sessionFeedPath(claudeSessionPid());

/**
 * Reset the statusline feed to idle at the start of each user turn. MUST be
 * synchronous + instant (no network). Stamps a fresh `turn_id` (Date.now())
 * so the forwarder adopts the new turn exactly once — even if this idle marker
 * lands after the turn's recalls already counted up, the forwarder ignores a
 * turn_id it has already adopted (Issue #51, see statusline-feed.ts). Preserves
 * the previous vault_size; the forwarder refreshes it on the next recall-done.
 */
function resetStatuslineFeed(ccSessionId: string | null): void {
  try {
    let vaultSize = 0;
    try {
      const prev = JSON.parse(readFileSync(STATUSLINE_FEED_PATH, "utf8")) as {
        vault_size?: number;
      };
      vaultSize = prev.vault_size ?? 0;
    } catch {
      // no prior file — vault_size stays 0 until first recall populates it
    }
    // cc_session_id (#74): der Hook ist die einzige Stelle, die die echte
    // Claude-Code session_id kennt — über den Feed erreicht sie den Forwarder.
    const state = idleStatuslineState(Date.now(), vaultSize, ccSessionId);
    mkdirSync(STATUSLINE_DIR, { recursive: true });
    const tmp = `${STATUSLINE_FEED_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, STATUSLINE_FEED_PATH);
  } catch {
    // statusline reset is non-essential — never break the prompt hook
  }
}

const HOOK_TIMEOUT_MS = envInt("BASTRA_HOOK_TIMEOUT_MS", 250, "NEXUS_HOOK_TIMEOUT_MS");
const DEFAULT_PORT = 6723;
const HOOK_VERSION = "0.2.0";
const SCORE_FLOOR = 50; // higher than PreToolUse: prompts rarely match recall_when exactly
const MUST_LOAD_SCORE = 100;
// #161: backoff source key — prompt-lookup hints back off independently.
const BACKOFF_SOURCE = "prompt-lookup";

/** "retrieval-only" (default) or "all" (also recall on non-lookup prompts, score-gated to MUST_LOAD_SCORE). */
type PromptHookMode = "retrieval-only" | "all";
const HOOK_MODE: PromptHookMode =
  (envFirst("BASTRA_PROMPT_HOOK_MODE") as PromptHookMode | undefined) ?? "retrieval-only";

export interface ClaudeHookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  /** primary surface in Claude Code docs */
  prompt?: string;
  /** legacy / alternative key seen in some Claude-Code payload variants */
  user_message?: string;
}

export interface RecallHit {
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

export type DetectedMode = "retrieval" | "none" | "generic";

// DE + EN retrieval triggers — match the spec in Issue #33.
const RETRIEVAL_DE = /^\s*(such|finde|wo (ist|sind)|wann (war|hatte)|wieviel|wie viel|was hab(e ich)?|was war)/i;
const RETRIEVAL_EN = /^\s*(find|search|where (is|are)|when (was|did)|how much|what (did|was))/i;

export function detectRetrieval(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return false;
  return RETRIEVAL_DE.test(trimmed) || RETRIEVAL_EN.test(trimmed);
}

// #151: trivial-prompt gate. Bare acks, one-worders and slash-command
// invocations cannot act on recalled context — injecting there is pure
// context tax (and with BASTRA_PROMPT_HOOK_MODE=all the hook otherwise fires
// on EVERY prompt). Deterministic DE+EN check, runs before any recall work.
const TRIVIAL_ACKS = new Set([
  // EN
  "ok", "okay", "k", "kk", "yes", "yep", "yeah", "no", "nope", "thx",
  "thanks", "thank you", "cool", "nice", "great", "perfect", "go",
  "continue", "proceed", "stop", "wait", "done", "sure",
  // DE
  "ja", "jo", "jep", "nein", "ne", "nö", "danke", "super", "top", "passt",
  "perfekt", "weiter", "mach", "mach weiter", "los", "gut", "genau",
  "richtig", "stimmt", "erledigt", "fertig",
]);

// A typed slash command: "/name" or "/name args". The first token must not
// contain a second "/" so absolute paths ("/Users/… bitte lesen") never gate.
const SLASH_COMMAND_RE = /^\/[a-z0-9][a-z0-9_-]*(?:\s|$)/i;

export function isTrivialPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return true;
  // Slash-command invocations — typed directly, or already expanded by
  // Claude Code into <command-name>/<local-command-*> blocks. The retrieval
  // regex would otherwise match phrases inside the expanded command/skill
  // body instead of user intent.
  if (SLASH_COMMAND_RE.test(trimmed) && !trimmed.includes("\n")) return true;
  if (trimmed.includes("<command-name>") || trimmed.startsWith("<local-command-")) return true;
  // Bare ack / one-worder (trailing punctuation tolerated).
  const bare = trimmed.toLowerCase().replace(/[\s!.?…]+$/u, "");
  if (TRIVIAL_ACKS.has(bare)) return true;
  if (bare.length <= 2) return true;
  return false;
}

export function extractPrompt(payload: ClaudeHookPayload): string | null {
  const raw =
    typeof payload.prompt === "string"
      ? payload.prompt
      : typeof payload.user_message === "string"
        ? payload.user_message
        : null;
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
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

  if (payload.hook_event_name !== "UserPromptSubmit") return emitEmpty();

  // New user turn → reset statusline counters to idle (synchronous, instant).
  resetStatuslineFeed(payload.session_id ?? null);

  const prompt = extractPrompt(payload);
  if (!prompt) return emitEmpty();

  // #151: gate before any recall work — the saved tokens surface in stats
  // via status:"gated" + gated:true.
  if (isTrivialPrompt(prompt)) {
    emitEmpty();
    await writeTelemetry({
      detected_mode: "none",
      gated: true,
      prompt_chars: prompt.length,
      daemon_url: null,
      daemon_reachable: false,
      hint_count: 0,
      top_score: null,
      latency_ms_total: Date.now() - startedAt,
      status: "gated",
      error: null,
    });
    return;
  }

  const isRetrieval = detectRetrieval(prompt);
  let detectedMode: DetectedMode;
  if (isRetrieval) {
    detectedMode = "retrieval";
  } else if (HOOK_MODE === "all") {
    detectedMode = "generic";
  } else {
    detectedMode = "none";
  }

  if (detectedMode === "none") {
    emitEmpty();
    await writeTelemetry({
      detected_mode: "none",
      prompt_chars: prompt.length,
      daemon_url: null,
      daemon_reachable: false,
      hint_count: 0,
      top_score: null,
      latency_ms_total: Date.now() - startedAt,
      status: "ok",
      error: null,
    });
    return;
  }

  const project = detectProject(payload.cwd ?? process.cwd());
  const httpURL = envFirst("BASTRA_HTTP_URL", "NEXUS_HTTP_URL");
  const httpPort = envFirst("BASTRA_HTTP_PORT", "NEXUS_HTTP_PORT") ?? String(DEFAULT_PORT);
  const url = httpURL ?? `http://127.0.0.1:${httpPort}`;
  const remainingMs = Math.max(50, HOOK_TIMEOUT_MS - (Date.now() - startedAt));

  // For "generic" mode we only show top-tier hits, so request fewer (k=3).
  const k = detectedMode === "retrieval" ? 5 : 3;
  // In "generic" mode bump the score floor to MUST_LOAD_SCORE — only show
  // very strong matches to avoid noise on every single prompt.
  const effectiveFloor = detectedMode === "generic" ? MUST_LOAD_SCORE : SCORE_FLOOR;

  let resp: RecallResponse | null = null;
  let status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error" = "ok";
  let errMsg: string | null = null;
  try {
    resp = await postRecall(
      url,
      { query: prompt, project, k, tool_name: "UserPromptSubmit", session_id: payload.session_id ?? null },
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

  const filtered: RecallHit[] = [];
  if (resp && Array.isArray(resp.hits)) {
    for (const h of resp.hits) {
      if (h.score < effectiveFloor) continue;
      filtered.push(h);
    }
  }
  if (resp && filtered.length === 0) status = "no-hits";

  let backoffStreak = 0;
  let suppressed = false;
  let suppressedTokensEst = 0;
  if (filtered.length === 0) {
    emitEmpty();
  } else {
    // #161 empty-streak backoff (see session-state.ts): unconsumed injection
    // streaks widen the cadence; any load of an emitted candidate resets.
    const sessionId = payload.session_id ?? "";
    const state = await loadSessionState(sessionId);
    const entry = state.sources?.[BACKOFF_SOURCE];
    const consumed = await wasEmitConsumed(entry);
    const decision = decideBackoff(entry, consumed);
    backoffStreak = decision.streak;
    suppressed = decision.suppress;
    const block = formatHintBlock(filtered, project, detectedMode);
    if (suppressed) {
      // Suppressed emits {} exactly like the empty path (#161).
      suppressedTokensEst = Math.ceil(block.length / 4);
      recordSourceSuppressed(state, BACKOFF_SOURCE);
      await saveSessionState(sessionId, state);
      emitEmpty();
    } else {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: block,
          },
        }),
      );
      recordSourceEmit(state, BACKOFF_SOURCE, filtered.map((h) => h.id), consumed);
      await saveSessionState(sessionId, state);
      // Usage sidecar (#154): only what was ACTUALLY injected counts as surfaced.
      await reportHinted(url, filtered.map((h) => h.id));
    }
  }

  await writeTelemetry({
    detected_mode: detectedMode,
    prompt_chars: prompt.length,
    daemon_url: url,
    daemon_reachable: resp !== null,
    hint_count: suppressed ? 0 : filtered.length,
    top_score: resp?.hits?.[0]?.score ?? null,
    latency_ms_total: Date.now() - startedAt,
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

function formatHintLine(h: RecallHit): string {
  const summary = h.summary.length > 220 ? h.summary.slice(0, 217) + "…" : h.summary;
  return `- ${h.id} (${h.type}, score ${Math.round(h.score)}): ${summary}`;
}

export function formatHintBlock(hits: RecallHit[], project: string | null, mode: DetectedMode): string {
  const projAttr = project ? ` project="${escapeAttr(project)}"` : "";
  const head = `<recall-hints surface="claude-code" trigger="prompt-lookup"${projAttr}>`;
  const tail = `</recall-hints>`;

  const required = hits.filter((h) => h.score >= MUST_LOAD_SCORE);
  const optional = hits.filter((h) => h.score < MUST_LOAD_SCORE);
  const sections: string[] = [];

  if (mode === "retrieval") {
    sections.push(
      `The user prompt looks like a LOOKUP / retrieval query. ` +
        `Use bastra-recall:recall (and find_document if pdf-likely) BEFORE conversation_search / web_search. ` +
        `Pre-recalled candidates for this prompt:`,
    );
  } else {
    sections.push(
      `Pre-recall surfaced strong matches (score >=${MUST_LOAD_SCORE}) for this prompt. ` +
        `Load them via bastra-recall:load_memory before answering.`,
    );
  }

  if (required.length > 0) {
    sections.push("");
    sections.push(
      `Strong matches (score >=${MUST_LOAD_SCORE}) for this prompt — ` +
        `load_memory(id) the relevant ones before responding ` +
        `(hints, not obligations; honor an explicit count or scope from the user):`,
    );
    for (const h of required) sections.push(formatHintLine(h));
  }

  if (optional.length > 0) {
    if (required.length > 0) sections.push("");
    sections.push(
      `OPTIONAL (score ${SCORE_FLOOR}–${MUST_LOAD_SCORE - 1}) — load only if title/summary directly relates:`,
    );
    for (const h of optional) sections.push(formatHintLine(h));
  }

  return [head, HINT_FRAME_NOTE, stripFenceMarkers(sections.join("\n")), tail].join("\n");
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
  project: string | null;
  k: number;
  tool_name: string;
  session_id: string | null;
  scope?: string;
  type?: string;
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
          const data = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as RecallResponse);
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

interface PromptHookTelemetry {
  detected_mode: DetectedMode;
  /** #151: true when the trivial-prompt gate suppressed injection. */
  gated?: boolean;
  prompt_chars: number;
  daemon_url: string | null;
  daemon_reachable: boolean;
  hint_count: number;
  top_score: number | null;
  latency_ms_total: number;
  /** #161: resolved streak of this event's backoff decision. */
  backoff_streak?: number;
  /** #161: true when the empty-streak backoff suppressed the injection. */
  suppressed?: boolean;
  /** #161: est. tokens of the NOT-injected block — the savings side of ROI. */
  suppressed_tokens_est?: number;
  status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error" | "gated" | "suppressed";
  error: string | null;
}

async function writeTelemetry(payload: PromptHookTelemetry): Promise<void> {
  if ((envFirst("BASTRA_TELEMETRY", "NEXUS_TELEMETRY") ?? "on").toLowerCase() === "off") return;
  try {
    const logDir = envFirst("BASTRA_LOG_PATH", "NEXUS_LOG_PATH") ?? defaultLogDir();
    await mkdir(logDir, { recursive: true });
    const ts = new Date().toISOString();
    const event = {
      kind: "prompt_hook_call",
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

// Only run the CLI when invoked directly (filename match), not when imported by tests.
const argv1 = process.argv[1] ?? "";
const isCliEntry = argv1.endsWith("prompt-hook.js") || argv1.endsWith("prompt-hook.ts");

if (isCliEntry) {
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
