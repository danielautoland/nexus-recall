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
  bumpShown,
  decideBackoff,
  getLoadedMarkerMtime,
  loadSessionState,
  recordSourceEmit,
  recordSourceSuppressed,
  saveSessionState,
  shouldDropHit,
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

// 600ms — same reasoning as hook.ts. The lanes that actually recall sat at
// the old 250ms ceiling: retrieval median 222ms, the first assertion call
// 259ms and thus a timeout. The `none` lane's 4ms median hid this in any
// average, because it never recalls at all.
const HOOK_TIMEOUT_MS = envInt("BASTRA_HOOK_TIMEOUT_MS", 600, "NEXUS_HOOK_TIMEOUT_MS");
const DEFAULT_PORT = 6723;
const HOOK_VERSION = "0.2.0";
const SCORE_FLOOR = 50; // higher than PreToolUse: prompts rarely match recall_when exactly
export const MUST_LOAD_SCORE = 100;
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
  recall_id: string;  /** #249: no returned hit lexically anchors — the top score is rank-1-of-
   *  nothing. Absent means "not weak". */
  weak_result?: boolean;
}

/** #217 Reflex-Lane: lean hit vom /hook/reflex-Endpoint. */
export interface PromptReflexHit {
  id: string;
  title: string;
  type: string;
  scope: string;
  summary: string;
  matched_phrase: string;
}

interface ReflexResponse {
  hits: PromptReflexHit[];
  recall_id: string | null;
}

export type DetectedMode = "retrieval" | "assertion" | "none" | "generic";

// DE + EN retrieval triggers — match the spec in Issue #33.
const RETRIEVAL_DE = /^\s*(such|finde|wo (ist|sind)|wann (war|hatte)|wieviel|wie viel|was hab(e ich)?|was war)/i;
const RETRIEVAL_EN = /^\s*(find|search|where (is|are)|when (was|did)|how much|what (did|was))/i;

export function detectRetrieval(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return false;
  return RETRIEVAL_DE.test(trimmed) || RETRIEVAL_EN.test(trimmed);
}

// ─── assertion lane (#252) ───────────────────────────────────────────────────
//
// The PreToolUse lane is bound to a tool, so it reaches an agent that EDITS.
// Writing a sentence touches nothing: a draft reply, a changelog entry, an
// issue comment or an answer about project state makes factual claims and
// fires no hook — the claim comes out of model memory while the vault holds
// the measured answer. A finished sentence is not lexically distinguishable
// from an opinion, so the request is classified instead of the output: "draft
// a reply", "write the release notes", "what's the state of X" are all
// recognisable in the PROMPT, before the text exists.
//
// Deliberately narrow — two signals are required, never a bare verb, because
// a lane that fires on every declarative prompt is the noise that made the
// passive channel fail. Misses claims that only arise mid-draft; that is the
// known gap, tracked in #252 as the case for an outbound verification pass.

/** Composing an artefact for someone else. */
const COMPOSE_VERB =
  /\b(draft|write|compose|announce|reply|respond|publish|schreib\w*|verfass\w*|formulier\w*|entwirf|entwerfe|antworte\w*|beantworte|ver(ö|oe)ffentlich\w*)\b/i;

/** …that leaves this machine. `#123` counts: naming an issue is outward. */
const OUTWARD_ARTIFACT =
  /(\B#\d+\b|\b(release[- ]?notes?|release-?notizen|changelog|(ä|ae)nderungsprotokoll|announcement|ank(ü|ue)ndigung|blog\w*|newsletter|readme|docs?|documentation|dokumentation|issue|pr|pull[- ]?requests?|comment|kommentar|reply|antwort|thread|discord|mail|e-?mail|posting|tweet|beitrag)\b)/i;

/** Asking for a state… */
const STATE_QUESTION =
  /\b(what'?s|what is|how (far|many|much|good)|status|state|wie (ist|weit|viele?|gut)|stand|wo stehen wir)\b/i;

/** …that this project has actually measured or recorded. */
const PROJECT_STATE_NOUN =
  /\b(measured?|measurement|benchmark|eval|recall@\w*|numbers?|metrics?|coverage|latency|ceiling|zahlen|gemessen|messung|kennzahl\w*|milestone|roadmap|release|version|tests?)\b/i;

/**
 * #252: does the prompt ask for an ASSERTION — outbound text, or a claim about
 * this project's measured state? Both end in sentences someone else reads, and
 * neither edits a file, so no other lane fires for them.
 */
export function detectAssertion(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return false;
  if (COMPOSE_VERB.test(trimmed) && OUTWARD_ARTIFACT.test(trimmed)) return true;
  return STATE_QUESTION.test(trimmed) && PROJECT_STATE_NOUN.test(trimmed);
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

/**
 * Score floor per detected mode. "generic" floors at MUST_LOAD_SCORE — only
 * very strong matches may interrupt arbitrary prompts. #161 corollary: every
 * hit surviving the generic floor sits in the REQUIRED band, so the
 * hasRequired bypass in decideBackoff makes suppression impossible there by
 * construction (asserted in prompt-hook.test.ts instead of special-casing).
 */
export function effectiveScoreFloor(mode: DetectedMode): number {
  return mode === "generic" ? MUST_LOAD_SCORE : SCORE_FLOOR;
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
  } else if (detectAssertion(prompt)) {
    // #252 — recalls where the default retrieval-only mode used to stay silent.
    detectedMode = "assertion";
  } else if (HOOK_MODE === "all") {
    detectedMode = "generic";
  } else {
    detectedMode = "none";
  }

  const project = detectProject(payload.cwd ?? process.cwd());
  const httpURL = envFirst("BASTRA_HTTP_URL", "NEXUS_HTTP_URL");
  const httpPort = envFirst("BASTRA_HTTP_PORT", "NEXUS_HTTP_PORT") ?? String(DEFAULT_PORT);
  const url = httpURL ?? `http://127.0.0.1:${httpPort}`;
  const remainingMs = Math.max(50, HOOK_TIMEOUT_MS - (Date.now() - startedAt));

  // #217 Reflex-Lane: feuert unabhängig vom Retrieval-Gate — auch bei
  // detectedMode "none". Parallel zum bedingten Recall, sonst sprengt die
  // Serialisierung das 250-ms-Budget. Fehler → still keine Reflex-Hits.
  const reflexPromise: Promise<ReflexResponse | null> = postReflex(
    url,
    { context: prompt, project, session_id: payload.session_id ?? null },
    remainingMs,
  ).catch(() => null);

  // For "generic" mode we only show top-tier hits, so request fewer (k=3).
  const k = detectedMode === "generic" ? 3 : 5;
  const effectiveFloor = effectiveScoreFloor(detectedMode);

  let resp: RecallResponse | null = null;
  let status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error" = "ok";
  let errMsg: string | null = null;
  if (detectedMode !== "none") {
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
  }
  const reflexResp = await reflexPromise;

  const filtered: RecallHit[] = [];
  if (resp && Array.isArray(resp.hits)) {
    for (const h of resp.hits) {
      if (h.score < effectiveFloor) continue;
      filtered.push(h);
    }
  }
  if (resp && filtered.length === 0) status = "no-hits";

  const sessionId = payload.session_id ?? "";
  const state = await loadSessionState(sessionId);

  // #217: Session-Dedup für Reflex-Hits (max 1×/4h pro Memory, wie hook.ts).
  // Danach id-Dedup gegen die Recall-Liste — Reflex ist das vom User
  // verdrahtete, stärkere Signal und behält den Hit.
  const rawReflexHits: PromptReflexHit[] = Array.isArray(reflexResp?.hits) ? reflexResp.hits : [];
  const reflexKept: PromptReflexHit[] = [];
  for (const h of rawReflexHits) {
    const loadedMtime = await getLoadedMarkerMtime(h.id);
    if (shouldDropHit(state.shown[h.id], loadedMtime)) continue;
    reflexKept.push(h);
  }
  const reflexIds = new Set(reflexKept.map((h) => h.id));
  const recallHits = filtered.filter((h) => !reflexIds.has(h.id));

  let backoffStreak = 0;
  let suppressed = false;
  let suppressedTokensEst = 0;
  let consumedForEmit = false;
  let recallBlock: string | null = null;
  if (recallHits.length > 0) {
    // #161 empty-streak backoff (see session-state.ts): unconsumed injection
    // streaks widen the cadence; any load of an emitted candidate resets.
    // REQUIRED-band hits bypass suppression (decideBackoff hasRequired), and
    // retrieval mode is exempt entirely — the user explicitly asked for a
    // lookup, answering it is never noise. Streak bookkeeping stays regular
    // either way; only consumption resets the streak. Reflex-Hits laufen
    // an diesem Backoff komplett vorbei (#217): vom User verdrahtet = nie Noise.
    const entry = state.sources?.[BACKOFF_SOURCE];
    consumedForEmit = await wasEmitConsumed(entry);
    const hasRequired = recallHits.some((h) => h.score >= MUST_LOAD_SCORE);
    const decision = decideBackoff(entry, consumedForEmit, hasRequired);
    backoffStreak = decision.streak;
    suppressed = detectedMode === "retrieval" ? false : decision.suppress;
    const block = formatHintBlock(recallHits, project, detectedMode, resp?.weak_result === true);
    if (suppressed) {
      // Suppressed drops only the recall block (#161); reflex still emits.
      suppressedTokensEst = Math.ceil(block.length / 4);
      recordSourceSuppressed(state, BACKOFF_SOURCE);
    } else {
      recallBlock = block;
    }
  }

  const reflexBlock = reflexKept.length > 0 ? formatReflexBlock(reflexKept, project) : null;
  const blocks = [reflexBlock, recallBlock].filter((b): b is string => b !== null);
  if (blocks.length === 0) {
    emitEmpty();
  } else {
    emitOnce(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: blocks.join("\n"),
        },
      }),
    );
  }

  // State-Bookkeeping in einem Save: Backoff-Streak nur für die
  // prompt-lookup-Lane, Reflex bucht nur die Session-Dedup.
  if (recallBlock) {
    recordSourceEmit(state, BACKOFF_SOURCE, recallHits.map((h) => h.id), consumedForEmit);
  }
  for (const h of reflexKept) bumpShown(state, h.id);
  if (recallHits.length > 0 || reflexKept.length > 0) {
    await saveSessionState(sessionId, state);
  }
  // Usage sidecar (#154): only what was ACTUALLY injected counts as surfaced.
  const injectedIds = [
    ...(reflexBlock ? reflexKept.map((h) => h.id) : []),
    ...(recallBlock ? recallHits.map((h) => h.id) : []),
  ];
  if (injectedIds.length > 0) {
    await reportHinted(url, injectedIds);
  }

  await writeTelemetry({
    detected_mode: detectedMode,
    prompt_chars: prompt.length,
    daemon_url: url,
    daemon_reachable: resp !== null || reflexResp !== null,
    hint_count: suppressed ? 0 : recallHits.length,
    reflex_hint_count: reflexKept.length,
    top_score: resp?.hits?.[0]?.score ?? null,
    latency_ms_total: Date.now() - startedAt,
    backoff_streak: backoffStreak,
    suppressed,
    suppressed_tokens_est: suppressedTokensEst,
    status: suppressed ? "suppressed" : status,
    error: errMsg,
  });
}

// Ein-Emit-Kontrakt: Claude Code parst stdout als EIN JSON-Dokument. Der
// unref'te Kill-Switch kann feuern, während main() nach dem Block-Emit noch
// saveSessionState/reportHinted awaitet — ohne Guard schriebe er ein zweites
// "{}" HINTER den Block und machte den Output unparsebar (Review-Finding #217).
let stdoutEmitted = false;
function emitOnce(payload: string): void {
  if (stdoutEmitted) return;
  stdoutEmitted = true;
  process.stdout.write(payload);
}

function emitEmpty(): void {
  emitOnce("{}");
}

function formatHintLine(h: RecallHit): string {
  const summary = h.summary.length > 220 ? h.summary.slice(0, 217) + "…" : h.summary;
  return `- ${h.id} (${h.type}, score ${Math.round(h.score)}): ${summary}`;
}

export function formatHintBlock(hits: RecallHit[], project: string | null, mode: DetectedMode, weak = false): string {
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
  } else if (mode === "assertion") {
    // #252: the failure mode is asserting a measured number from model memory
    // while the vault holds it. Naming the alternative — say you don't know —
    // matters as much as the candidates; a hint block alone invites a guess.
    sections.push(
      `The prompt asks for text that makes a CLAIM — outbound writing, or a statement about this project's measured state. ` +
        `Do NOT assert numbers, measurements, dates or project history from model memory. ` +
        `Check the candidates below (and recall again with the specific claim if none fits); ` +
        `if the vault does not answer it, write that you do not know instead of guessing. ` +
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
    // #249: a top score is high by construction on the hybrid path — calling it
    // "strong" when nothing lexically anchored presents noise as signal.
    sections.push(
      weak
        ? `Ranked matches, but NONE anchors lexically (no trigger phrase, no title term matched) — on the hybrid path a high score is rank-1-of-nothing. Treat these as probably-not-relevant unless one obviously fits; do not load them just because they are listed.`
        : `Strong matches (score >=${MUST_LOAD_SCORE}) for this prompt — ` +
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

/**
 * #217 Reflex-Block: eigener trigger="reflex"-Frame, damit das Modell die
 * Herkunft (vom User verdrahteter Trigger, kein Score-Ranking) erkennt.
 */
export function formatReflexBlock(hits: PromptReflexHit[], project: string | null): string {
  const projAttr = project ? ` project="${escapeAttr(project)}"` : "";
  const head = `<recall-hints surface="claude-code" trigger="reflex"${projAttr}>`;
  const sections: string[] = [
    `Reflex memories: the user wired these to fire when their trigger matches ` +
      `a prompt — this prompt matched. load_memory(id) before answering:`,
  ];
  for (const h of hits) {
    const summary = h.summary.length > 220 ? h.summary.slice(0, 217) + "…" : h.summary;
    sections.push(`- ${h.id} (${h.type}, trigger "${h.matched_phrase}"): ${summary}`);
  }
  return [head, HINT_FRAME_NOTE, stripFenceMarkers(sections.join("\n")), `</recall-hints>`].join("\n");
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
  return postJson<RecallResponse>(baseUrl, "/hook/recall", body, timeoutMs);
}

/** #217 Reflex-Lane: gleicher Loopback-POST, eigener Endpoint. */
function postReflex(
  baseUrl: string,
  body: { context: string; project: string | null; session_id: string | null },
  timeoutMs: number,
): Promise<ReflexResponse> {
  return postJson<ReflexResponse>(baseUrl, "/hook/reflex", body, timeoutMs);
}

function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(path, baseUrl);
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
            resolve(JSON.parse(data) as T);
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
  /** #217: Reflex-Hits, die nach Session-Dedup injiziert wurden. */
  reflex_hint_count?: number;
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
