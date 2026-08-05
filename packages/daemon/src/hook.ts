#!/usr/bin/env node
/**
 * bastra-recall hook CLI — bridges Claude Code's PreToolUse event into the
 * daemon's /hook/recall HTTP endpoint and emits a `<recall-hints>` block as
 * `additionalContext` so Claude reads it before the actual Write/Edit fires.
 *
 * Pipeline:
 *   stdin (JSON Claude-Code hook payload)
 *     → filter to PreToolUse on Write/Edit/MultiEdit/NotebookEdit
 *     → SKIP-GATE: extension/basename filter (#20) — drops .md outside docs/,
 *       issue/PR transient files, .txt/.log/.tmp, etc. — BEFORE any module
 *       load.
 *     → lazy-import `@bastra-recall/core` (#28) for detectTopics/Project etc.
 *     → POST 127.0.0.1:BASTRA_HTTP_PORT/hook/recall
 *     → per-session dedup (#32): drop hits shown >= 3 times within 4h
 *       (unless load_memory marker is newer than last show)
 *     → empty-streak backoff (#161): unconsumed injection streaks widen the
 *       cadence per source ("write-edit"); consumption resets it
 *     → format hits as <recall-hints>…</recall-hints>
 *     → stdout: {"hookSpecificOutput": { hookEventName, additionalContext }}
 *
 * Discipline:
 *   - Hard wall-clock budget: HOOK_TIMEOUT_MS. We MUST exit fast and
 *     never block Claude — any failure path emits `{}` and exits 0.
 *   - Skip-gate runs on pure stdlib so the cheap path stays < 30 ms.
 *   - Telemetry is best-effort and never blocks the response.
 */
import { request } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
// #152: subpath import loads ONLY the dependency-free scrub leaf — the full
// @bastra-recall/core stays lazy-imported (#28), the cheap skip-gate path is
// unaffected.
import { HINT_FRAME_NOTE, stripFenceMarkers } from "@bastra-recall/core/scrub";
import { envFirst, envInt } from "./env.js";
import { defaultLogDir } from "./telemetry.js";
import { shouldSkipPath, passesScopeFilter } from "./hook-skip.js";
import { requiredHeadline, unfusedHeadline, type RrfConstants } from "./band-wording.js";
import { reportHinted } from "./hook-hinted.js";
import {
  bumpShown,
  cleanupOldStates,
  decideBackoff,
  getLoadedMarkerMtime,
  loadSessionState,
  recordSourceEmit,
  recordSourceSuppressed,
  saveSessionState,
  shouldDropHit,
  wasEmitConsumed,
  type SessionState,
} from "./session-state.js";

// 600ms, not the original 250. Measured over 30 days of real use
// (`bastra logs --stats`): 12,966 PreToolUse calls, median 60ms, p90 225ms,
// p99 257ms — and 806 timeouts, 6.2% of all calls. The budget was sitting
// just under the p99, so one edit in sixteen silently lost its injection on
// the channel #244 measured as the effective one. A cache-miss recall costs
// ~190ms on a warm machine with ~600 memories; a bigger vault or a slower box
// needs more. The ceiling only costs anything when the daemon is actually
// slow — the median case is unaffected.
const HOOK_TIMEOUT_MS = envInt("BASTRA_HOOK_TIMEOUT_MS", 600, "NEXUS_HOOK_TIMEOUT_MS");
const DEFAULT_PORT = 6723;
const HOOK_VERSION = "0.3.0";
const SCORE_FLOOR = envInt("BASTRA_RECALL_FLOOR", 30); // mirror SKILL.md: <30 is noise
// Hits at/above this are non-negotiable loads. #9 Stage C: env-tunable so we
// can lift the REQUIRED band (e.g. to 130) from telemetry without a rebuild,
// but the default stays 100 until the data says to raise it.
const MUST_LOAD_SCORE = envInt("BASTRA_MUST_LOAD_SCORE", 100);
// #302: filled in at step 4, where `@bastra-recall/core` is loaded anyway. NOT
// a top-level import — #28 keeps core lazy so the skip-gate path never pays for
// it, and #305 shows how little headroom the hook budget has. Null until then;
// the wording degrades to a sentence that needs no rank. See band-wording.ts
// for what a cut selects and why the old headline was wrong.
let rrf: RrfConstants | null = null;
// #161: backoff source key — write-edit hints back off independently of the
// other hook sources (bash-tripwire, bash-fail, prompt-lookup, todo-plan).
const BACKOFF_SOURCE = "write-edit";

interface ClaudeHookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

interface RecallHit {
  id: string;
  title: string;
  type: string;
  scope: string;
  summary: string;
  score: number;
  /** #148: matchte der Hit auf seinem hand-geschriebenen `recall_when`?
   *  Lässt starke, absichtliche Cross-Scope-Hits durch den #110-Filter. */
  matched_recall_when?: boolean;
}

interface RecallResponse {
  hits: RecallHit[];
  vault_size: number;
  latency_ms: number;
  recall_id: string;
  /** #249: no returned hit lexically anchors — the top score is rank-1-of-
   *  nothing. Absent means "not weak", so the flag is only ever present when
   *  it has something to say. */
  weak_result?: boolean;
  /** #230: stricter subset of weak_result — the fact has no home in this vault. */
  no_home?: boolean;
  /** #302: no vector arm, so no RRF ran and the score is raw BM25 — an
   *  unbounded scale with no ceiling. The band cuts describe nothing there. */
  unfused?: boolean;
}

type HookStatus =
  | "ok"
  | "no-hits"
  | "skipped"
  | "suppressed"
  | "daemon-unreachable"
  | "timeout"
  | "error";

const SUPPORTED_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

async function main(): Promise<void> {
  const startedAt = Date.now();

  // 1) Read stdin as JSON. If anything goes wrong: exit 0 with {}.
  const raw = await readStdin();
  let payload: ClaudeHookPayload;
  try {
    payload = JSON.parse(raw) as ClaudeHookPayload;
  } catch {
    return emitEmpty();
  }

  // 2) Only act on PreToolUse for file-mutating tools.
  if (payload.hook_event_name !== "PreToolUse") return emitEmpty();
  const toolName = payload.tool_name ?? "";
  if (!SUPPORTED_TOOLS.has(toolName)) return emitEmpty();

  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
  const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : null;
  if (!filePath) return emitEmpty();

  // 3) SKIP-GATE (#20 + #28): extension/basename filter on pure stdlib.
  //    Runs BEFORE any @bastra-recall/core import so the cheap path stays
  //    well under the budget.
  if (shouldSkipPath(filePath, payload.cwd)) {
    emitEmpty();
    await writeTelemetry({
      session_id: payload.session_id ?? null,
      tool_name: toolName,
      file_path: filePath,
      topics: [],
      query_chars: 0,
      daemon_url: "",
      daemon_reachable: false,
      hint_count: 0,
      required_count: 0,
      top_score: null,
      latency_ms_total: Date.now() - startedAt,
      dropped_dedup_count: 0,
      dropped_scope_count: 0,
      hint_tokens_est: 0,
      hinted_ids: [],
      backoff_streak: 0,
      suppressed: false,
      suppressed_tokens_est: 0,
      status: "skipped",
      error: null,
    });
    return;
  }

  // 3b) Deterministischer Dateigrößen-Check (Daniel 19.07.2026): die
  //     Größen-Konvention darf nicht am Memory-Abruf hängen — der Hook hält
  //     dem Agenten die Zeilenzahl bei jedem Write/Edit hin. Lokal, kein
  //     Daemon nötig; läuft deshalb VOR dem Recall-Call und wird in JEDEM
  //     Emit-Pfad mitgesendet (auch bei no-hits/suppressed/daemon-down).
  const { fileSizeNote } = await import("./file-size-check.js");
  // Same anchor the skip gate gets: the throwaway-directory rule must only see
  // directories INSIDE the project, never the ancestors it happens to live under.
  const sizeNote = await fileSizeNote(filePath, undefined, payload.cwd).catch(() => null);

  // 4) Now (and only now) load the expensive core utils — see #28.
  const { detectTopics, detectProject, extractContentExcerpt, RRF_K, RRF_SCALE } = await import(
    "@bastra-recall/core"
  );
  // #302: the fusion constants ride along on the import that already happens,
  // so the band wording can state the rank a cut selects instead of asserting
  // strength. Free here; a top-level import would not be.
  rrf = { k: RRF_K, scale: RRF_SCALE };

  const intent = {
    tool_name: toolName,
    file_path: filePath,
    content_excerpt: extractContentExcerpt(toolName, toolInput),
  };
  const topics = detectTopics(intent);
  const project = detectProject(payload.cwd ?? process.cwd());

  const httpURL = envFirst("BASTRA_HTTP_URL", "NEXUS_HTTP_URL");
  const httpPort = envFirst("BASTRA_HTTP_PORT", "NEXUS_HTTP_PORT") ?? String(DEFAULT_PORT);
  const url = httpURL ?? `http://127.0.0.1:${httpPort}`;
  const remainingMs = Math.max(50, HOOK_TIMEOUT_MS - (Date.now() - startedAt));

  // 5) Call daemon. Any failure → silent skip.
  let resp: RecallResponse | null = null;
  let status: HookStatus = "ok";
  let errMsg: string | null = null;
  try {
    resp = await postRecall(url, {
      query: topics.query,
      topics: topics.topics,
      project,
      tool_name: toolName,
      session_id: payload.session_id ?? null,
      tool_input_excerpt: intent.content_excerpt,
      k: 3,
    }, remainingMs);
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

  // 6) Score-floor filter + Scope-Hard-Filter (#107, #110, #148): Hints aus
  //    fremden Projekt-Scopes fliegen raus — seit #110 auch im REQUIRED-Band.
  //    Die ursprüngliche Ausnahme („starker recall_when-Match schlägt die
  //    Scope-Heuristik") war ein reiner Score-Bypass und wurde am Einführungstag
  //    widerlegt (bastra-io-Hint mit Score 159 über tag/topic-Overlap). #148
  //    bringt sie korrekt zurück: nur ein Hit, der auf seinem HAND-geschriebenen
  //    recall_when matchte UND im REQUIRED-Band sitzt, passiert cross-scope
  //    (siehe passesScopeFilter).
  const filteredHits: RecallHit[] = [];
  let droppedScopeCount = 0;
  if (resp && Array.isArray(resp.hits)) {
    for (const h of resp.hits) {
      if (h.score < SCORE_FLOOR) continue;
      if (!passesScopeFilter(h, project, MUST_LOAD_SCORE)) {
        droppedScopeCount++;
        continue;
      }
      filteredHits.push(h);
    }
  }

  // 7) Per-session dedup (#32). Load state, drop over-shown hits, bump
  //    counters for those we actually emit. Best-effort throughout — no
  //    error in this section ever blocks the response.
  const sessionId = payload.session_id ?? "";
  let sessionState: SessionState = { shown: {} };
  let dedupActive = false;
  if (sessionId) {
    sessionState = await loadSessionState(sessionId);
    dedupActive = true;
  }

  const survivingHits: RecallHit[] = [];
  let droppedDedupCount = 0;
  for (const h of filteredHits) {
    if (!dedupActive) {
      survivingHits.push(h);
      continue;
    }
    const entry = sessionState.shown[h.id];
    const loadedMtime = await getLoadedMarkerMtime(h.id);
    if (shouldDropHit(entry, loadedMtime)) {
      droppedDedupCount++;
      continue;
    }
    survivingHits.push(h);
  }

  const requiredHits: RecallHit[] = [];
  const optionalHits: RecallHit[] = [];
  for (const h of survivingHits) {
    if (h.score >= MUST_LOAD_SCORE) requiredHits.push(h);
    else optionalHits.push(h);
  }

  const totalHints = requiredHits.length + optionalHits.length;
  if (resp && totalHints === 0) status = "no-hits";

  const topScore = resp?.hits?.[0]?.score ?? null;

  // 7b) Empty-streak backoff (#161): if this source's recent injections went
  //     unconsumed (no load-marker newer than the emit), widen the cadence —
  //     skip the next min(streak, cap) would-be injections, then probe.
  //     REQUIRED-band hits (score >= MUST_LOAD_SCORE) bypass suppression —
  //     see decideBackoff. Best-effort: state errors fail open, emit normally.
  let backoffStreak = 0;
  let suppressed = false;
  let suppressedTokensEst = 0;
  let backoffConsumed = false;
  if (dedupActive && totalHints > 0) {
    const entry = sessionState.sources?.[BACKOFF_SOURCE];
    backoffConsumed = await wasEmitConsumed(entry);
    const decision = decideBackoff(entry, backoffConsumed, requiredHits.length > 0);
    backoffStreak = decision.streak;
    suppressed = decision.suppress;
    if (suppressed) status = "suppressed";
  }

  // 8) Emit Claude-Code hookSpecificOutput first — that's the hot path.
  // hint_tokens_est (#72): grobe Token-Schätzung (~4 chars/token) des
  // tatsächlich injizierten Blocks — die Kostenseite der net-context-ROI.
  let hintTokensEst = 0;
  let hintedIds: string[] = [];
  const emitContext = (context: string): void => {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: context,
        },
      }),
    );
  };
  if (totalHints === 0) {
    // no recall hints — the deterministic size note still goes out
    if (sizeNote) {
      emitContext(sizeNote);
      hintTokensEst = Math.ceil(sizeNote.length / 4);
    } else {
      emitEmpty();
    }
  } else if (suppressed) {
    // Suppression is a recall-noise valve — the size note is deterministic
    // convention enforcement and rides through it.
    if (sizeNote) {
      emitContext(sizeNote);
      hintTokensEst = Math.ceil(sizeNote.length / 4);
    } else {
      emitEmpty();
    }
    const block = formatHintBlock(requiredHits, optionalHits, project, resp?.weak_result === true, resp?.no_home === true, resp?.unfused === true);
    suppressedTokensEst = Math.ceil(block.length / 4);
    recordSourceSuppressed(sessionState, BACKOFF_SOURCE);
  } else {
    const hintsBlock = formatHintBlock(requiredHits, optionalHits, project, resp?.weak_result === true, resp?.no_home === true, resp?.unfused === true);
    const block = sizeNote ? `${sizeNote}\n${hintsBlock}` : hintsBlock;
    hintTokensEst = Math.ceil(block.length / 4);
    hintedIds = [...requiredHits, ...optionalHits].map((h) => h.id);
    emitContext(block);
    recordSourceEmit(sessionState, BACKOFF_SOURCE, hintedIds, backoffConsumed);
  }

  // 9) Bump shown-counts for everything we surfaced, then persist. When
  //    suppressed nothing was shown — only the backoff counter changed.
  if (dedupActive && survivingHits.length > 0) {
    if (!suppressed) {
      const now = Date.now();
      for (const h of survivingHits) bumpShown(sessionState, h.id, now);
    }
    await saveSessionState(sessionId, sessionState);
  }

  // 10) Opportunistic cleanup of stale session files. Only when we actually
  //     touched the state dir — keeps the cheap/skip path clean.
  if (dedupActive) {
    // fire-and-forget; never await failures
    void cleanupOldStates().catch(() => {});
  }

  const totalMs = Date.now() - startedAt;

  // 11) Telemetry — awaited so process.exit doesn't kill the appendFile.
  await writeTelemetry({
    session_id: sessionId || null,
    tool_name: toolName,
    file_path: filePath,
    topics: topics.topics,
    query_chars: topics.query.length,
    daemon_url: url,
    daemon_reachable: resp !== null,
    hint_count: suppressed ? 0 : totalHints,
    // Suppressed events zero ALL per-hit fields (like hint_count/hinted_ids).
    // With the REQUIRED-band bypass this is provably 0 anyway — defensive.
    required_count: suppressed ? 0 : requiredHits.length,
    top_score: topScore,
    latency_ms_total: totalMs,
    dropped_dedup_count: droppedDedupCount,
    dropped_scope_count: droppedScopeCount,
    hint_tokens_est: hintTokensEst,
    hinted_ids: hintedIds,
    backoff_streak: backoffStreak,
    suppressed,
    suppressed_tokens_est: suppressedTokensEst,
    status,
    error: errMsg,
  });
  // Usage sidecar (#154): only what was ACTUALLY injected counts as surfaced.
  await reportHinted(url, hintedIds);
}

function emitEmpty(): void {
  process.stdout.write("{}");
}

function formatHintLine(h: RecallHit): string {
  // Truncate summary to keep total payload small.
  const summary = h.summary.length > 220 ? h.summary.slice(0, 217) + "…" : h.summary;
  return `- ${h.id} (${h.type}, score ${Math.round(h.score)}): ${summary}`;
}

export function formatHintBlock(
  required: RecallHit[],
  optional: RecallHit[],
  project: string | null,
  weak = false,
  noHome = false,
  unfused = false,
): string {
  const projAttr = project ? ` project="${escapeAttr(project)}"` : "";
  const head = `<recall-hints surface="claude-code"${projAttr}>`;
  const tail = `</recall-hints>`;
  const sections: string[] = [];

  if (required.length > 0) {
    // #249: on the hybrid path a top score is high BY CONSTRUCTION — a list
    // always has a first element. Calling that "strong" when nothing lexically
    // anchored is the defect this issue is about: the daemon knows, and used to
    // keep it to itself. Annotated rather than omitted, so the agent still sees
    // that a lookup happened and came up empty instead of silently getting less.
    sections.push(
      noHome
        ? `A lookup ran for what you're about to do and this vault has NO memory of ` +
          `it — nothing anchored lexically, and the ranking found no near neighbour ` +
          `either. The lines below are the least-bad rows of an empty result. Treat ` +
          `this as "not written down yet", not as weak evidence, and do not load them.`
        : weak
        ? `Ranked matches for what you're about to do — but NONE of them anchors ` +
          `lexically (no trigger phrase, no title term matched). On the hybrid path a ` +
          `high score is rank-1-of-nothing, so treat these as "probably not relevant" ` +
          `unless one obviously fits. Do not load them just because they are listed.`
        : unfused
        ? `${unfusedHeadline("what you're about to do")} ` +
          `load_memory(id) the ones that bear on this edit.`
        : `${requiredHeadline("what you're about to do", MUST_LOAD_SCORE, rrf)} ` +
          `load_memory(id) the ones that bear on this edit. ` +
          `Hints, not obligations: load only what fits, don't batch-load the list.`,
    );
    for (const h of required) sections.push(formatHintLine(h));
  }

  if (optional.length > 0) {
    if (required.length > 0) sections.push("");
    sections.push(
      unfused
        ? `FURTHER DOWN the same lexical ranking — load only if the title/summary directly relates to the pending change:`
        : // #302: the honest reading of this band. Either one path only — such
          // a hit can never clear MUST_LOAD however well it ranks, since it
          // scores half of a two-armed hit at the same rank — or both paths,
          // but further down than the REQUIRED band demands.
          `OPTIONAL — found by ONE search path only, or by both but ranked lower. ` +
          `Load only if the title/summary directly relates to the pending change:`,
    );
    for (const h of optional) sections.push(formatHintLine(h));
  }

  // #152: reference-only frame + anti-spoof — vault-derived text (titles,
  // summaries) must not carry marker fragments that break out of the block.
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
  topics: string[];
  project: string | null;
  tool_name: string;
  session_id: string | null;
  tool_input_excerpt: string;
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

interface HookCallTelemetry {
  session_id: string | null;
  tool_name: string;
  file_path: string | null;
  topics: string[];
  query_chars: number;
  daemon_url: string;
  daemon_reachable: boolean;
  hint_count: number;
  required_count: number;
  top_score: number | null;
  latency_ms_total: number;
  dropped_dedup_count: number;
  dropped_scope_count: number;
  /** Geschätzte Tokens des injizierten <recall-hints>-Blocks (#72). */
  hint_tokens_est: number;
  /** IDs, die tatsächlich emittiert wurden (#72 context-tax per memory). */
  hinted_ids: string[];
  /** #161: aufgelöster Streak der Backoff-Entscheidung dieses Events. */
  backoff_streak: number;
  /** #161: true, wenn der Backoff die Injektion unterdrückt hat. */
  suppressed: boolean;
  /** #161: Tokens des NICHT injizierten Blocks — die Sparseite der ROI. */
  suppressed_tokens_est: number;
  status: HookStatus;
  error: string | null;
}

async function writeTelemetry(payload: HookCallTelemetry): Promise<void> {
  if ((envFirst("BASTRA_TELEMETRY", "NEXUS_TELEMETRY") ?? "on").toLowerCase() === "off") return;
  try {
    const logDir = envFirst("BASTRA_LOG_PATH", "NEXUS_LOG_PATH") ?? defaultLogDir();
    await mkdir(logDir, { recursive: true });
    const ts = new Date().toISOString();
    // The session_id from the Claude payload is now real session state —
    // fall back to a synthetic UUID only if no payload session was given.
    const { session_id: payloadSessionId, ...rest } = payload;
    const event = {
      kind: "hook_call",
      ts,
      session_id: payloadSessionId ?? randomUUID(),
      hook_version: HOOK_VERSION,
      ...rest,
    };
    const file = join(logDir, `events-${ts.slice(0, 10)}.jsonl`);
    await appendFile(file, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // Telemetry must never break the hook.
  }
}

// Same guard bash-fail-hook.ts carries, and for the reason written down there:
// on module top level the kill-switch and the exit fire for IMPORTERS too, so
// the test runner dies with exit 0 after a couple of seconds and silently skips
// everything after it. This file only became importable with #302 (the band
// wording needs a test), so the hazard is new here.
// Exact basename, not endsWith: this file is plain "hook.js", and every
// sibling entrypoint (session-hook.js, prompt-hook.js, bash-fail-hook.js, …)
// ends with that string. A suffix test would make THIS main() run inside those
// processes.
const isMain = (() => {
  const argv1 = process.argv[1];
  if (typeof argv1 !== "string") return false;
  const base = argv1.split(/[\\/]/).pop() ?? "";
  return base === "hook.js" || base === "hook.ts" || base === "bastra-recall-hook";
})();

if (isMain) {
  // Global hard cap: even if main() somehow stalls, we exit fast.
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
