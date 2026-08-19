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
// #305: subpath leafs, never the core barrel — measured +40ms of process
// start against +0.8ms for the three leafs, on a fresh spawn per event.
import { detectProject } from "@bastra-recall/core/topics";
import { RRF_K, RRF_SCALE } from "@bastra-recall/core/rrf";
import { requiredHeadline } from "./band-wording.js";
import { HINT_FRAME_NOTE, stripFenceMarkers } from "@bastra-recall/core/scrub";
import { request } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { envFirst, envInt } from "./env.js";
import { effectiveUpdateMode, getDocsLanguage, getDocsMode, getPrimaryLanguage } from "./settings.js";
import { formatDokuBlock } from "./doku-block.js";
import { defaultLogDir } from "./telemetry.js";
import { spawnStagedUpdate, stagedToday, markStagedToday } from "./update-check.js";
import { formatBlockedUpdate, readBlockedUpdate } from "./update-blocked.js";
import { pendingPatchNotice } from "./patch-registry.js";
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
  recall_id: string;  /** #249: no returned hit lexically anchors — the top score is rank-1-of-
   *  nothing. Absent means "not weak". */
  weak_result?: boolean;
  /** #230: stricter subset of weak_result — the fact has no home in this vault. */
  no_home?: boolean;
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
    const openCare = (await fetchOpenCounts(url, Math.min(150, remainingMs))).open;
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

  // Import review (#208) + mining queue (#211): candidates staged by
  // `bastra import`, and a queued conversations.json awaiting chunk-wise
  // mining. Standing instruction — the user never has to explain either
  // workflow to their agent.
  let importBlock = "";
  if (responses.some((r) => r.resp !== null)) {
    const remainingMs = Math.max(60, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    const imports = await fetchOpenCounts(url, Math.min(150, remainingMs), "/hook/import");
    const parts: string[] = [];
    if (imports.open > 0) {
      parts.push(
        `The vault has ${imports.open} open import candidate(s) in import-review.md (at the vault ` +
          `root) — memories exported from other AI tools (ChatGPT, Claude, Gemini, …), staged by ` +
          `\`bastra import\` and awaiting distillation. When the user asks to work off the import ` +
          `list (any phrasing), read that file and go through the open "- [ ]" entries TOGETHER ` +
          `with the user, in blocks: for each accepted candidate save a REAL memory via save_memory ` +
          `— proper type, concrete recall_when including an ask-trigger in the user's own ` +
          `vocabulary, dedupe against existing memories first, admission rules apply (capture fixes ` +
          `not failures, declarative facts not imperatives, skip stale artifacts) — and stamp ` +
          `write_origin: "capture-review". Tick finished lines to "- [x]"; tick rejected ones too, ` +
          `appending " — skipped". Never distill unprompted — but DO tell the user in your FIRST ` +
          `response of this session, once and in one sentence, that ${imports.open} import ` +
          `candidate(s) are waiting and that saying "work through my import review" starts the ` +
          `review (#311: the user has no other way of knowing). Do not repeat it unless asked.`,
      );
    }
    if (imports.queued > 0) {
      parts.push(
        `A conversations.json export with ${imports.queued} conversation(s) is queued for mining ` +
          `(\`bastra import\`, #211). When the user asks to mine the imported chat history (any ` +
          `phrasing), loop: run \`bastra import mine\` — it prints one chunk of the user's OWN ` +
          `messages — distill durable lessons, decisions and preferences into one-line candidate ` +
          `facts (skip one-off tasks, stale facts, code/log dumps), stage them by piping the lines ` +
          `to \`bastra import - <source>\` as the chunk footer shows, and continue until the queue ` +
          `is drained; then offer to distill import-review.md together. Mining stages candidates ` +
          `ONLY — never save_memory directly from mined chunks. Mention the queued export once in ` +
          `your FIRST response of this session (one sentence, alongside the open-candidate note ` +
          `if both exist); do not repeat it unless asked.`,
      );
    }
    if (parts.length > 0) {
      importBlock = `\n<import-review>\n` + parts.join("\n\n") + `\n</import-review>`;
    }
  }

  // Onboarding interview: a fresh vault (few memories, no marker) gets a
  // standing offer to seed itself — the session model interviews adaptively,
  // which no form can. Offered, never pushed.
  let onboardingBlock = "";
  if (responses.some((r) => r.resp !== null)) {
    const remainingMs = Math.max(60, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
    if (await fetchOnboardingNeeded(url, Math.min(150, remainingMs))) {
      onboardingBlock =
        `\n<vault-onboarding>\n` +
        `This vault is fresh and the onboarding interview hasn't run. Offer it ONCE at a natural ` +
        `moment (e.g. after the first task, or right away if the user seems to be exploring): a ` +
        `~5-minute interview that seeds the vault with who the user is. If they agree, interview ` +
        `adaptively — one question at a time, follow up where an answer is thin, let them skip ` +
        `anything: (1) what the memory will mainly hold — code & projects / company & decisions / ` +
        `personal life & knowledge / a mix; (2) how to address them — name, language, tone; ` +
        `(3) hard always/never rules; (4-6) persona follow-ups (developer: stack, active projects, ` +
        `workflow, coding conventions — file-size guide value in lines + which folder holds what · ` +
        `business: company & role, key people, what to prepare or watch · personal: ` +
        `day-to-day world, never-forget items, current goals · mixed: stack, role, world); ` +
        `(7) anything else, freeform. Save each answer immediately via save_memory — the user ` +
        `answered in person, so write_origin: "user-directed", concrete recall_when triggers ` +
        `including an ask-trigger in the user's own words. If they name a file-size guide value, ` +
        `ALSO run \`bastra config set size.guide <N>\` — the PreToolUse hook then enforces it ` +
        `deterministically. If you can tell the user's primary language (from how they answer, or ` +
        `an explicit "in <language>"), ALSO run \`bastra config set language.primary <code>\` ` +
        `(2-letter ISO code) so future memories get authored in it. When finished run \`bastra onboard done\`; ` +
        `if the user declines run \`bastra onboard skip\` and never bring it up again. Also mention ` +
        `\`bastra import\` if they have memories in other AI tools.\n` +
        `</vault-onboarding>`;
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
  //
  // #268: the staged run can REFUSE (locally modified files, a failed
  // attestation), and it is detached with stdio:"ignore" — so the announcement
  // below would be the only thing the user ever hears about an update that
  // never happened. A refusal is therefore recorded on disk and read back here
  // BEFORE anything is announced or spawned again.
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
        const blocked = await readBlockedUpdate();
        if (blocked) {
          // Correcting the record outranks everything else: while this stands,
          // claiming an update is being applied is exactly the false statement
          // the file exists to prevent. No re-spawn either — the recorded reason
          // is deterministic, so an unattended retry can only reproduce it.
          // `bastra update` is what clears the record (see cli/update.ts).
          updateBlock =
            `\n<bastra-update>\n` +
            `A new bastra-recall version is available: ${u.current} → ${u.latest}.\n` +
            `${formatBlockedUpdate(blocked)}\n` +
            `Release notes: ${u.html_url}\n` +
            `Tell the user the automatic update was held back for the reason above, and suggest ` +
            `they run \`bastra update\` to review and confirm it.\n` +
            `</bastra-update>`;
        } else if (mode === "auto" && isSessionStart && !(await stagedToday())) {
          spawnStagedUpdate();
          // The day throttle is spent even if the staged run ends up refusing,
          // and that is deliberate: the refusal reasons persist (the same dirty
          // files, the same failed signature), so releasing the throttle would
          // re-spawn an identical refusal at EVERY session start instead of
          // once a day — more detached processes, never a different outcome.
          // What was missing was never a retry, it was a report — and that is
          // the record read above, which then suppresses further attempts
          // entirely until an update really runs.
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

  // #269 — local patches the last update could not put back. Read from the
  // record the update path wrote, never probed here: this hook runs inside a
  // hard latency budget and `git apply --check` per patch is a process spawn per
  // patch. Unconditional (not gated on the daemon answering) because the finding
  // is about files on disk, and a silent reverted patch is exactly the failure
  // #268/#269 exist to make impossible.
  let patchBlock = "";
  try {
    const notice = pendingPatchNotice();
    if (notice) {
      patchBlock =
        `\n<local-patches>\n` +
        `${notice}\n` +
        `Tell the user this plainly at the start of the session — a local fix that silently ` +
        `stopped being applied is the case this surface exists for. Do not attempt to reapply ` +
        `or edit the patches yourself; report and let them decide.\n` +
        `</local-patches>`;
    }
  } catch {
    // Same posture as every other block here: a notice is never worth a failed hook.
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

  // Language-first recall (#231): if the user set a primary language at
  // onboarding, memories must be AUTHORED in it, not the hook's English default.
  // Local settings-read, no daemon roundtrip — same discipline as dokuBlock.
  let languageBlock = "";
  try {
    const lang = await getPrimaryLanguage();
    if (lang) {
      languageBlock =
        `\n<memory-language>\n` +
        `The user's primary language is "${lang}". Author memories — titles, summaries and ` +
        `recall_when triggers — in that language, keeping only genuinely-English technical terms ` +
        `(daemon, deploy, hook, …) as anchors. This keeps recall's lexical arm matching the ` +
        `user's own wording instead of an English template.\n` +
        `</memory-language>`;
    }
  } catch {
    // Language hint is best-effort — never block session start.
  }

  const extras = taxonomyBlock + languageBlock + careBlock + importBlock + onboardingBlock + updateBlock + patchBlock + pendingBlock + dokuBlock;
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
    // #249: three scope-filtered recalls feed this block. Weak only when EVERY
    // answered one is weak — a single lexically anchored scope means there is
    // real signal here, and framing the whole block as noise would hide it.
    const answered = responses.filter((r) => r.resp !== null);
    const allWeak = answered.length > 0 && answered.every((r) => r.resp!.weak_result === true);
    injected = pinnedHead + formatBlock(top, project, payload.source ?? null, allWeak) + extras;
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

function formatBlock(hits: RecallHit[], project: string | null, source: string | null, weak = false): string {
  const projAttr = project ? ` project="${escapeAttr(project)}"` : "";
  const srcAttr = source ? ` source="${escapeAttr(source)}"` : "";
  const head = `<session-context surface="claude-code"${projAttr}${srcAttr}>`;
  const tail = `</session-context>`;

  const required = hits.filter((h) => h.score >= MUST_LOAD_SCORE);
  const optional = hits.filter((h) => h.score < MUST_LOAD_SCORE);
  const sections: string[] = [];

  if (required.length > 0) {
    // #249: see hook.ts — the honesty flag decides how this block is framed.
    sections.push(
      weak
        ? `Ranked matches, but NONE anchors lexically (no trigger phrase, no title term matched) — on the hybrid path a high score is rank-1-of-nothing. Treat these as probably-not-relevant unless one obviously fits; do not load them just because they are listed.`
        : `${requiredHeadline(`the ${project ?? "current"} session`, MUST_LOAD_SCORE, { k: RRF_K, scale: RRF_SCALE })} ` +
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
    // #232: the gate carries the read-hint for its own reference file. Applying
    // a listed convention needs nothing extra; establishing a new one does, and
    // this block is the only moment that distinction is visible.
    `\nSaving into a recurring cluster that NO convention above covers is the ` +
    `establish case — read the skill's taxonomy.md before inventing a home for it.` +
    `\n</vault-taxonomy>`
  );
}

interface OpenCounts {
  open: number;
  /** Mining-queue depth (#211) — only /hook/import reports it, else 0. */
  queued: number;
}

/** Open-counts from a /hook/* endpoint (care, import) — same budget
 *  discipline as fetchTaxonomy. */
function fetchOpenCounts(baseUrl: string, timeoutMs: number, path = "/hook/care"): Promise<OpenCounts> {
  return new Promise((resolve_) => {
    let url: URL;
    try {
      url = new URL(path, baseUrl);
    } catch {
      resolve_({ open: 0, queued: 0 });
      return;
    }
    const req = request(
      { method: "GET", hostname: url.hostname, port: url.port || 80, path: url.pathname, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { open?: unknown; queued?: unknown };
            resolve_({
              open: typeof parsed.open === "number" ? parsed.open : 0,
              queued: typeof parsed.queued === "number" ? parsed.queued : 0,
            });
          } catch {
            resolve_({ open: 0, queued: 0 });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve_({ open: 0, queued: 0 }));
    req.end();
  });
}

/** GET /hook/onboarding → needed-flag. Same budget discipline; false on
 *  any error (an unreachable daemon must never nudge). */
function fetchOnboardingNeeded(baseUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve_) => {
    let url: URL;
    try {
      url = new URL("/hook/onboarding", baseUrl);
    } catch {
      resolve_(false);
      return;
    }
    const req = request(
      { method: "GET", hostname: url.hostname, port: url.port || 80, path: url.pathname, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { needed?: unknown };
            resolve_(parsed.needed === true);
          } catch {
            resolve_(false);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve_(false);
    });
    req.on("error", () => resolve_(false));
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
