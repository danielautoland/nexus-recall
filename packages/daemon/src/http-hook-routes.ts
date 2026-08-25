/**
 * Handlers for the loopback-only hook endpoints /hook/recall (JSON + SSE) and
 * /hook/act — the highest-volume recall surface and its act-signal companion.
 * Routing stays in http.ts; the handler logic lives here.
 * Split out of http.ts (file-size convention).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  Vault,
  SearchIndex,
  RecallHit,
  RecallStage,
  StageListener,
} from "@bastra-recall/core";
import { fireAndForget, type Telemetry } from "./telemetry.js";
import { envBool, envInt } from "./env.js";
import { computeSalienceShadow } from "./salience-shadow.js";
import { computeTrustShadow, trustRankMode, usageForShadow } from "./trust-shadow.js";
import { toLeanHit, truncateSummary } from "./tool-handlers.js";
import { expandQuery, type BridgePool } from "./learned-recall/bridges.js";
import { type SupportedLanguage } from "./learned-recall/language.js";
import { isWeakResult, isNoHome } from "./weak-result.js";
import {
  MAX_BODY_BYTES,
  clampInt,
  openSseHeaders,
  readJsonBody,
  sendJson,
  writeSseEvent,
} from "./http-util.js";

// ─── /hook/act handler (#144) ────────────────────────────────────

export function handleHookAct(req: IncomingMessage, res: ServerResponse, telemetry: Telemetry): void {
  readJsonBody(req, MAX_BODY_BYTES)
    .then(async (body) => {
      const excerpt = typeof body.tool_input_excerpt === "string"
        ? body.tool_input_excerpt.slice(0, 4096)
        : "";
      if (!excerpt) {
        sendJson(res, 400, { error: "tool_input_excerpt is required" });
        return;
      }
      const toolName = typeof body.tool_name === "string" ? body.tool_name : null;
      const sessionId = typeof body.session_id === "string" ? body.session_id : null;
      const exitCode = typeof body.exit_code === "number" ? body.exit_code : null;

      const episodes = telemetry.matchLoadedMemories({
        tool_name: toolName,
        tool_input_excerpt: excerpt,
        session_id: sessionId,
        // High-frequency signal: only MATCHING episodes close; an unrelated
        // command must not kill an open episode with acted_on=false.
        closeOnMiss: false,
      });
      for (const episode of episodes) {
        fireAndForget(telemetry.logRecallEpisode(episode));
      }
      fireAndForget(
        telemetry.logHookAct({
          tool_name: toolName,
          excerpt_chars: excerpt.length,
          matched_episodes: episodes.length,
          exit_code: exitCode,
          // Claude-Session-id ins Event — ohne sie stempelt der Sink seine
          // Boot-UUID und der Transcript-Join ist unmöglich (Audit 2026-07-10).
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
      );
      sendJson(res, 200, { matched: episodes.length });
    })
    .catch(() => sendJson(res, 400, { error: "invalid JSON body" }));
}

// ─── /hook/recall handler ────────────────────────────────────────

const CONTENT_RECALL_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * #342: deadline for the dense arm on the HOOK path only — the surface with a
 * hard client-side budget (HOOK_TIMEOUT_MS, 600ms). Offline callers (bridge
 * harvest, doc2query self-test, the WebUI) keep waiting indefinitely; they have
 * no budget and want the better result.
 *
 * The number comes from the per-stage split measured on a real host, and it is
 * a bound on THIS STAGE, not on the call:
 *
 *   warm   bm25 15-24ms   vector  87-96ms   →  total 106-113ms
 *   cold   bm25 24ms      vector 668ms      →  total 694ms
 *
 * So 150ms clears every warm dense arm with ~55ms to spare, and caps the cold
 * one at 150 + ~25ms of BM25 ≈ 180ms. That keeps BOTH cases under the 200ms
 * ceiling #305 set — the warm path untouched at ~110ms, the cold path degraded
 * to BM25-only but arriving, instead of the whole call expiring silently and
 * the turn continuing as if there had been nothing to say.
 *
 * 0 disables the deadline (kill switch, pre-#342 behaviour). Every expiry is
 * visible as `degraded: "vector-arm-timeout"` on the recall telemetry, so a
 * machine where the warm arm genuinely needs longer shows up as a rate rather
 * than as quietly worse recall.
 *
 * Read per call, not once at module load, like BASTRA_HOOK_CONTENT_RECALL
 * below: a latency kill switch that needs a daemon restart to take effect is
 * not much of a kill switch.
 */
const hookVectorDeadlineMs = (): number => envInt("BASTRA_VECTOR_DEADLINE_MS", 150);

export function mergeHookRecallHits(
  first: RecallHit[],
  second: RecallHit[],
  limit: number,
): RecallHit[] {
  const byId = new Map<string, RecallHit>();
  for (const hit of [...first, ...second]) {
    const previous = byId.get(hit.id);
    if (!previous) {
      byId.set(hit.id, hit);
      continue;
    }
    const winner = hit.score > previous.score ? hit : previous;
    byId.set(hit.id, {
      ...winner,
      matched_terms: [...new Set([...previous.matched_terms, ...hit.matched_terms])],
      matched_recall_when: previous.matched_recall_when || hit.matched_recall_when,
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function handleHookRecall(
  req: IncomingMessage,
  res: ServerResponse,
  t0: number,
  vault: Vault,
  search: SearchIndex,
  telemetry: Telemetry,
  learnedBridges?: BridgePool | null,
  sharedRecallLang?: SupportedLanguage | null,
  embeddingDegraded?: () => boolean,
): void {
  // SSE-Branch (#38): wenn der Caller `Accept: text/event-stream`
  // sendet, streamen wir Stages live. Default-JSON-Response bleibt
  // BC-erhalten — alte Hook-CLIs und REST-Caller sehen keinen
  // Unterschied.
  const accept = String(req.headers.accept ?? "");
  const wantsSse = accept.includes("text/event-stream");

  readJsonBody(req, MAX_BODY_BYTES)
    .then(async (body) => {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) {
        if (wantsSse) {
          openSseHeaders(res);
          writeSseEvent(res, "error", { error: "query is required" });
          res.end();
        } else {
          sendJson(res, 400, { error: "query is required" });
        }
        return;
      }
      const k = clampInt(body.k, 1, 10, 3);
      const hookSessionId = typeof body.session_id === "string" ? body.session_id : null;
      const hookToolName = typeof body.tool_name === "string" ? body.tool_name : null;
      if (hookToolName === "UserPromptSubmit") {
        telemetry.rotateTurn(hookSessionId);
      }
      const scope = typeof body.scope === "string" ? body.scope : undefined;
      const type = typeof body.type === "string" ? body.type : undefined;
      // expand_hops: Hooks profitieren vom Multi-Hop-Recall sobald
      // related_via befüllt ist (über RelatedEnricher). Default 1 — der
      // Caller kann explizit 0 schicken um es zu deaktivieren.
      const expand_hops = body.expand_hops === 0 ? 0 : 1;
      // 20.08.: the caller may widen the dense arm's deadline. The 150ms
      // default is sized for the 600ms hook budget; the MCP forwarder reuses
      // this route with a waiting model behind it and was paying the hook's
      // deadline for nothing — 15 of 19 MCP recalls on 20.08. came back
      // BM25-only because a 3-query batch (#351) serialises on one Ollama.
      const vectorDeadlineMs = clampInt(body.vector_deadline_ms, 50, 10_000, hookVectorDeadlineMs());

      const stageTimings: NonNullable<Parameters<Telemetry["logHookRecall"]>[0]["recall_stages"]> = {};
      // #342: why the hit list came back one-armed, if it did. Recorded rather
      // than merely returned — #305's whole finding is that this lane fails
      // quietly, and a degradation nobody counts repeats that failure one level
      // up: recall gets worse and the only visible symptom is that it got
      // faster. `vector-arm-timeout` is the deadline firing, `vector-arm-empty`
      // the pre-existing case where the arm had nothing to say.
      let degradedReason: string | undefined;
      const collectStage = (s: RecallStage): void => {
        if (s.name === "done" && typeof s.meta?.degraded === "string") {
          degradedReason = s.meta.degraded;
        }
        if (s.name === "cache.hit") {
          stageTimings.cache_hit = true;
          return;
        }
        if (s.durationMs === undefined) return;
        switch (s.name) {
          case "query.parse": stageTimings.query_parse_ms = s.durationMs; break;
          case "bm25.search": stageTimings.bm25_search_ms = s.durationMs; break;
          case "vector.search": stageTimings.vector_search_ms = s.durationMs; break;
          case "rrf.fuse": stageTimings.rrf_fuse_ms = s.durationMs; break;
          case "hops.expand": stageTimings.hops_expand_ms = s.durationMs; break;
          case "staleness.rank": stageTimings.staleness_rank_ms = s.durationMs; break;
        }
      };

      if (wantsSse) {
        openSseHeaders(res);
      }

      const onStage: StageListener = (s: RecallStage) => {
        collectStage(s);
        if (wantsSse) {
          // Nur Stop- + cache.hit + done-Events streamen (Start-Events
          // wären für UI redundant). `done`-Event kommt unten als
          // separater finaler SSE-Event mit den hits[] — wir
          // unterdrücken den Stage-`done`, damit der finale Frame
          // nicht doppelt rendert.
          if (s.name === "done") return;
          if (s.durationMs === undefined && s.name !== "cache.hit") return;
          writeSseEvent(res, "stage", {
            name: s.name,
            durationMs: s.durationMs,
            meta: s.meta,
          });
        }
      };

      // Shared learned-recall (#120): widen the hook query with language-matched
      // bridge terms. No-op when the layer is off. This is the highest-volume
      // recall surface, so the bridge boost must reach it too — not just MCP recall.
      const expansion = expandQuery(query, learnedBridges, {
        configuredLang: sharedRecallLang ?? null,
      });
      // #121: capture the deeper candidate pool (incl. below-floor) for the far slice.
      let candidatePool: { id: string; score: number }[] = [];
      const onQueryCandidatePool = (pool: { id: string; score: number }[]): void => {
        candidatePool = pool.map((h) => ({ id: h.id, score: h.score }));
      };
      const tRecall0 = Date.now();
      // #165: VOR dem Recall festgehalten, damit der Flag den Recall
      // beschreibt, der tatsächlich serviert wird (siehe recallHandler).
      const embeddingDegradedAtRecall =
        search.hasEmbeddings() && (embeddingDegraded?.() ?? false);
      let hits = search.hasEmbeddings()
        ? await search.recallHybrid(expansion.query, {
            k,
            scope,
            type,
            expand_hops,
            onStage,
            onCandidatePool: onQueryCandidatePool,
            vector_deadline_ms: vectorDeadlineMs,
          })
        : search.recall(expansion.query, {
            k,
            scope,
            type,
            expand_hops,
            onStage,
            onCandidatePool: onQueryCandidatePool,
          });

      const contentQuery = typeof body.tool_input_excerpt === "string"
        ? body.tool_input_excerpt.trim().slice(0, 4096)
        : "";
      let contentRecall:
        | {
            hit_count: number;
            added_count: number;
            rescored_count: number;
            latency_ms: number;
            failed?: boolean;
          }
        | undefined;
      if (
        envBool("BASTRA_HOOK_CONTENT_RECALL", false)
        && CONTENT_RECALL_TOOLS.has(hookToolName ?? "")
        && contentQuery
        && contentQuery !== query
      ) {
        const contentRecallStarted = Date.now();
        try {
          const contentHits = search.hasEmbeddings()
            ? await search.recallHybrid(contentQuery, {
                k,
                scope,
                type,
                expand_hops,
                // Same deadline, not a remaining-budget split: by the time this
                // runs the query recall above has either warmed the model (so
                // this costs ~120ms) or is still loading it (so this expires
                // too and degrades the same way). Both are the right outcome.
                vector_deadline_ms: vectorDeadlineMs,
              })
            : search.recall(contentQuery, {
                k,
                scope,
                type,
                expand_hops,
              });
          const queryHitsById = new Map(hits.map((hit) => [hit.id, hit]));
          const contentHitsById = new Map(contentHits.map((hit) => [hit.id, hit]));
          const mergedHits = mergeHookRecallHits(hits, contentHits, k);
          contentRecall = {
            hit_count: contentHits.length,
            added_count: mergedHits.filter((hit) => !queryHitsById.has(hit.id)).length,
            rescored_count: mergedHits.filter((hit) => {
              const queryHit = queryHitsById.get(hit.id);
              const contentHit = contentHitsById.get(hit.id);
              return queryHit !== undefined
                && contentHit !== undefined
                && contentHit.score > queryHit.score;
            }).length,
            latency_ms: Date.now() - contentRecallStarted,
          };
          hits = mergedHits;
        } catch {
          contentRecall = {
            hit_count: 0,
            added_count: 0,
            rescored_count: 0,
            latency_ms: Date.now() - contentRecallStarted,
            failed: true,
          };
        }
      }
      const recallLatencyMs = Date.now() - tRecall0;
      const totalLatencyMs = Date.now() - t0;
      const recallId = telemetry.newRecallId();
      telemetry.recordHookHints(recallId, hits);

      const toolInputExcerpt = typeof body.tool_input_excerpt === "string"
        ? body.tool_input_excerpt.slice(0, 4096)
        : "";
      if (toolInputExcerpt) {
        for (const episode of telemetry.matchLoadedMemories({
          tool_name: hookToolName,
          tool_input_excerpt: toolInputExcerpt,
          session_id: hookSessionId,
        })) {
          fireAndForget(telemetry.logRecallEpisode(episode));
        }
      }

      // #249/#230: both honesty flags, computed ONCE for this recall and used by
      // the telemetry row and the payload alike. They were computed twice from
      // the same inputs before, which is how `no_home` came to be recorded on the
      // MCP path and nowhere here.
      // #342: a recall that fell back to one arm did not run RRF, whatever the
      // reason — breaker open (#165), deadline expired, or the arm returning
      // nothing. All three serve raw BM25, which is unbounded, so the 30/100
      // bands describe nothing and `unfused` has to say so (#302). Reading only
      // the breaker was already blind to `vector-arm-empty`; the deadline makes
      // that blind spot common instead of rare, which is why it is fixed here.
      const hybridActiveAtRecall =
        search.hasEmbeddings() && !embeddingDegradedAtRecall && degradedReason === undefined;
      const weakResult = isWeakResult(hits, hybridActiveAtRecall);
      const noHome = isNoHome(hits, hybridActiveAtRecall);

      fireAndForget(
        telemetry.logHookRecall({
          recall_id: recallId,
          query,
          // #363: die Claude-Session-id aus dem Hook-Payload ins Event — ohne
          // sie stempelt der Sink seine Boot-UUID und keine Auswertung auf
          // Recall-Ebene kann nach Session oder Turn gruppieren. Der Wert war
          // längst hier (oben als hookSessionId gelesen, für rotateTurn und
          // matchLoadedMemories genutzt), nur nicht am Event. Gleiche Form wie
          // logHookAct/logHookReflex: fehlt sie, bleibt die Boot-UUID.
          ...(hookSessionId ? { session_id: hookSessionId } : {}),
          // #351: batch width when this recall is one phrasing of a batch.
          query_count: typeof body.batch_of === "number" ? body.batch_of : undefined,
          topics: Array.isArray(body.topics)
            ? (body.topics as unknown[]).filter((t): t is string => typeof t === "string")
            : [],
          tool_name: hookToolName,
          project: typeof body.project === "string" ? body.project : null,
          k,
          scope: scope ?? null,
          type: type ?? null,
          vault_size: vault.size(),
          hit_count: hits.length,
          top_score: hits[0]?.score ?? null,
          hits: hits.map((h) => ({ id: h.id, score: h.score, type: h.type })),
          latency_ms_recall: recallLatencyMs,
          latency_ms_total: totalLatencyMs,
          recall_stages: stageTimings,
          bridge_expansion:
            expansion.lang && expansion.added.length > 0 ? { lang: expansion.lang, added: expansion.added } : undefined,
          candidate_pool: candidatePool.length > 0 ? candidatePool : undefined,
          content_recall: contentRecall,
          // #165: pre-recall festgehalten, siehe oben / recallHandler.
          embedding_degraded: embeddingDegradedAtRecall ? true : undefined,
          // #342: which arm dropped out, if one did.
          degraded_reason: degradedReason,
          // #217: would-be Salience-Reihenfolge (shadow-only).
          salience_shadow: computeSalienceShadow(
            hits,
            (id) => vault.get(id)?.fm as Record<string, unknown> | undefined,
          ),
          // #160: dieselbe Projektion für den Trust-Multiplikator. MUSS hier
          // stehen und nicht nur im MCP-Pfad: der Hook ist der häufigere
          // Aufrufer, und ein Shadow, der nur die Tool-Calls sieht, misst eine
          // Verteilung, die es so nicht gibt.
          trust_shadow:
            trustRankMode() === "shadow"
              ? computeTrustShadow(hits, (id) => usageForShadow(vault.root)[id])
              : undefined,
          // #249: recorded, not just returned. Without this the flag reads
          // zero in every stats run — not because recall is healthy, but
          // because nothing ever wrote it down.
          weak_result: weakResult || undefined,
          no_home: noHome || undefined,
        }),
      );

      // Lean projection (#50): the hook CLI only consumes lean fields, so we
      // never need to send matched_terms/mode/hop/topic_path over the wire.
      // Telemetry above already logged the full hits. #148: the hook scope
      // filter needs the one extra bit `matched_recall_when` (kept here only,
      // not in the shared toLeanHit — MCP recall stays the documented lean shape).
      // #249: the honesty flag has to reach THIS path above all. /hook/recall
      // writes <recall-hints> into the agent's context on every Bash and Edit,
      // and without the flag the formatters label pure noise as "Strong
      // matches" — the daemon computed the contradicting signal and simply did
      // not send it. Same computation as the MCP path, from the same module.
      // 20.08.: reflex-wired memories (recall_mode "reflex") from the deeper
      // candidate pool that the top-k cut left out. The prompt lane's semantic
      // reflex filter only ever saw `hits`; on 20.08. the wired convention sat
      // at pool rank 6 behind a k of 5 and never reached the agent. The pool is
      // the user's explicit wiring — two memories — so scanning it is cheap,
      // and the lane keeps every floor and dedup it already applies.
      const hitIds = new Set(hits.map((h) => h.id));
      const reflexHits = candidatePool.flatMap((c) => {
        if (hitIds.has(c.id)) return [];
        const mem = vault.get(c.id);
        if (mem?.fm.recall_mode !== "reflex") return [];
        return [{
          id: c.id,
          title: mem.fm.title,
          type: mem.fm.type,
          scope: mem.fm.scope,
          summary: truncateSummary(mem.fm.summary),
          score: c.score,
          matched_recall_when: false,
          recall_mode: "reflex" as const,
        }];
      });
      const payload = {
        // recall_mode rides along only when the user wired the memory as
        // reflex: the prompt lane's mode-"none" semantic filter keys on it
        // (19.08. incident — see prompt-lane.ts).
        hits: hits.map((h) => ({
          ...toLeanHit(h),
          matched_recall_when: h.matched_recall_when ?? false,
          // P0: Der Cross-Scope-Bypass in den Lanes braucht mehr als das Flag —
          // ein einzelnes häufiges Wort in einer fremden Triggerphrase ist
          // keine Absicht. Nur gesetzt, wenn überhaupt ein Trigger-Term traf.
          ...(h.anchor_strength ? { anchor_strength: h.anchor_strength } : {}),
          ...(vault.get(h.id)?.fm.recall_mode === "reflex" ? { recall_mode: "reflex" as const } : {}),
        })),
        ...(reflexHits.length > 0 ? { reflex_hits: reflexHits } : {}),
        vault_size: vault.size(),
        latency_ms: totalLatencyMs,
        recall_id: recallId,
        ...(weakResult ? { weak_result: true } : {}),
        // #230: the stricter half travels the same wire. A strict subset of
        // weak_result, so a consumer that only knows weak_result is unaffected.
        ...(noHome ? { no_home: true } : {}),
        // #302: whether RRF ran at all. Without a vector arm there is no
        // fusion and no ceiling — raw BM25 is unbounded (top hits into six
        // digits on a real vault), so the 30/100 cuts describe nothing there.
        // The formatter has to say so rather than band an unbounded scale.
        // Same shape as the flags above: present only when it has something
        // to say, computed once from the value the honesty flags already use.
        ...(hybridActiveAtRecall ? {} : { unfused: true }),
        // #342: name the reason on the wire too. `unfused` says the bands do
        // not apply; this says why, so a slow machine degrading on every call
        // is distinguishable from embeddings being off — from the response
        // alone, without correlating against the telemetry log.
        ...(degradedReason ? { degraded: degradedReason } : {}),
      };
      if (wantsSse) {
        writeSseEvent(res, "done", payload);
        res.end();
      } else {
        sendJson(res, 200, payload);
      }
    })
    .catch((err: Error) => {
      if (wantsSse && !res.headersSent) {
        openSseHeaders(res);
      }
      if (wantsSse) {
        writeSseEvent(res, "error", { error: err.message });
        res.end();
      } else {
        sendJson(res, 400, { error: err.message });
      }
    });
}
