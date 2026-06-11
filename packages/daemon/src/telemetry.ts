import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { envFirst, envInt } from "./env.js";

/**
 * Migration-aware default log directory: prefer `~/.bastra/logs`, aber
 * solange das alte `~/.nexus-recall/logs` existiert und das neue noch
 * nicht, lesen wir aus dem alten weiter — damit Daniels existing
 * telemetry beim Migrationsfenster nicht orphan wird. Sobald die Mac-App
 * den `~/.nexus-recall/`-Folder nach `~/.bastra/` verschoben hat (siehe
 * Bastra.AppDelegate Migration), nimmt sich der daemon den neuen Pfad.
 */
function defaultLogDir(): string {
  const next = join(homedir(), ".bastra", "logs");
  const legacy = join(homedir(), ".nexus-recall", "logs");
  if (existsSync(next)) return next;
  if (existsSync(legacy)) return legacy;
  return next;
}

export type TelemetryEvent =
  | RecallEvent
  | LoadMemoryEvent
  | SaveMemoryEvent
  | HookRecallEvent
  | RecallEpisodeEvent
  | HookCallEvent
  | SessionHookCallEvent
  | OllamaLifecycleEvent;

interface BaseEvent {
  ts: string;
  session_id: string;
}

export interface RecallEvent extends BaseEvent {
  kind: "recall";
  recall_id: string;
  query: string;
  k: number | null;
  scope: string | null;
  type: string | null;
  vault_size: number;
  hit_count: number;
  top_score: number | null;
  hits: { id: string; score: number; type: string }[];
  latency_ms: number;
  /**
   * Pro-Stage-Timings (#38). Optional — alte Events ohne Stage-Emitter
   * haben das Feld nicht. `cache_hit: true` zeigt einen Query-Cache-Hit,
   * dann fehlen die übrigen Stage-Felder (außer query_parse_ms).
   */
  recall_stages?: {
    query_parse_ms?: number;
    bm25_search_ms?: number;
    vector_search_ms?: number;
    rrf_fuse_ms?: number;
    hops_expand_ms?: number;
    staleness_rank_ms?: number;
    cache_hit?: boolean;
  };
  /**
   * Anzahl Hits, die unter dem Score-Floor (#50 / #9) lagen und nicht
   * zurückgegeben wurden. Macht die Wirkung des Floors messbar. Optional —
   * alte Events ohne Floor-Logik haben das Feld nicht.
   */
  dropped_below_floor?: number;
}

export interface LoadMemoryEvent extends BaseEvent {
  kind: "load_memory";
  id: string;
  found: boolean;
  follows_recall: string | null;
  /** recall_id of a recent hook_recall whose hits[] contained this id, if any. */
  from_hook_recall: string | null;
  /** Rank (1-based) at which this id appeared in that hook_recall's hits[]. */
  hook_hint_rank: number | null;
}

export type RecallBand = "required" | "optional" | "below_floor";
export type TurnSource = "session" | "inferred";

export interface RecallEpisodeEvent extends BaseEvent {
  kind: "recall_episode";
  turn_id: string;
  turn_source: TurnSource;
  recall_id: string | null;
  memory_id: string;
  surfaced_score: number | null;
  band: RecallBand;
  loaded: boolean;
  acted_on: boolean;
  match_strength: number;
  tool_name: string | null;
}

export interface SaveMemoryEvent extends BaseEvent {
  kind: "save_memory";
  id: string;
  type: string;
  scope: string;
  title: string;
  tag_count: number;
  recall_when_count: number;
  body_chars: number;
  overwrite: boolean;
  created: boolean;
  follows_recall: string | null;
}

/** Recall served from the HTTP /hook/recall endpoint (server-side view). */
export interface HookRecallEvent extends BaseEvent {
  kind: "hook_recall";
  recall_id: string;
  query: string;
  topics: string[];
  tool_name: string | null;
  project: string | null;
  k: number;
  scope: string | null;
  type: string | null;
  vault_size: number;
  hit_count: number;
  top_score: number | null;
  hits: { id: string; score: number; type: string }[];
  latency_ms_recall: number;
  latency_ms_total: number;
  /** Pro-Stage-Timings (#38). Optional — alte Hook-Events ohne Stage-
   *  Emitter haben das Feld nicht. */
  recall_stages?: {
    query_parse_ms?: number;
    bm25_search_ms?: number;
    vector_search_ms?: number;
    rrf_fuse_ms?: number;
    hops_expand_ms?: number;
    staleness_rank_ms?: number;
    cache_hit?: boolean;
  };
}

/** Hook CLI invocation (client-side view: total wall-clock incl. network). */
export interface HookCallEvent extends BaseEvent {
  kind: "hook_call";
  tool_name: string;
  file_path: string | null;
  topics: string[];
  query_chars: number;
  daemon_url: string;
  daemon_reachable: boolean;
  hint_count: number;
  top_score: number | null;
  latency_ms_total: number;
  status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error";
  error: string | null;
}

/**
 * Ollama-Modell-Lifecycle (#109): prewarm (Boot-Wakeup) und idle-unload.
 * Aus den Paaren prewarm→unload lässt sich die RAM-Residenz des Embedding-
 * Modells schätzen — die Messgröße hinter dem #78-Energie-Design.
 */
export interface OllamaLifecycleEvent extends BaseEvent {
  kind: "ollama_lifecycle";
  action: "prewarm" | "unload";
  model: string;
  ok: boolean;
  /** Beim unload: Alter des letzten erfolgreichen Embeds (ms); sonst null. */
  last_embed_age_ms: number | null;
  /** Provider-Calls (query + backfill batches) seit Daemon-Boot. */
  embed_calls_since_boot: number | null;
}

/**
 * SessionStart hook CLI invocation. Fires once per Claude Code session
 * (also after /clear, /resume, and auto-compact via the `source` field).
 * Logged client-side because the session hook makes 2-3 sub-recalls and
 * we want one row per session, not per scope.
 */
export interface SessionHookCallEvent extends BaseEvent {
  kind: "session_hook_call";
  source: string | null;
  project: string | null;
  queries: number;
  daemon_url: string;
  daemon_reachable: boolean;
  hint_count: number;
  top_score: number | null;
  latency_ms_total: number;
  status: "ok" | "no-hits" | "daemon-unreachable" | "timeout" | "error";
  error: string | null;
}

const RECALL_FOLLOWUP_WINDOW_MS = 5 * 60 * 1000;
/**
 * Window during which a load_memory call is treated as a follow-up to a
 * hook_recall hint. A bit longer than the MCP recall→save window because
 * the user has to actually read the hint, decide it's relevant, and ask
 * Claude to load the memory — that round-trip can take a few minutes.
 */
const HOOK_HINT_WINDOW_MS = 10 * 60 * 1000;

interface HookHintTrace {
  recall_id: string;
  rank: number;
  score: number | null;
  ts: number;
}

interface TurnTrace {
  turn_id: string;
  session_id: string;
  started_at: number;
}

interface LoadedMemoryTrace {
  memory_id: string;
  distinctive_tokens: Set<string>;
  turn_id: string;
  turn_source: TurnSource;
  recall_id: string | null;
  surfaced_score: number | null;
  band: RecallBand;
  ts: number;
  closed: boolean;
}

const ACTED_ON_WINDOW_MS = envInt("BASTRA_ACTED_ON_WINDOW_MS", 180_000);
const SCORE_FLOOR = envInt("BASTRA_RECALL_FLOOR", 30);
const MUST_LOAD_SCORE = envInt("BASTRA_MUST_LOAD_SCORE", 100);

function bandForScore(score: number | null): RecallBand {
  if (score === null) return "below_floor";
  if (score >= MUST_LOAD_SCORE) return "required";
  if (score >= SCORE_FLOOR) return "optional";
  return "below_floor";
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []);
}

export class Telemetry {
  private readonly enabled: boolean;
  private readonly logDir: string;
  private readonly sessionId: string;
  private lastRecall: { id: string; ts: number } | null = null;
  /** Map<memory_id, most-recent HookHintTrace>. Older traces are evicted lazily. */
  private hookHints = new Map<string, HookHintTrace>();
  private turns = new Map<string, TurnTrace>();
  private latestTurn: TurnTrace | null = null;
  private loadedMemories: LoadedMemoryTrace[] = [];
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.enabled =
      (envFirst("BASTRA_TELEMETRY", "NEXUS_TELEMETRY") ?? "on").toLowerCase() !== "off";
    // Log-Pfad bleibt bei `~/.nexus-recall/logs` bis zur User-Data-Migration
    // (Daniel hat existing logs, die wir nicht orphanen wollen).
    this.logDir =
      envFirst("BASTRA_LOG_PATH", "NEXUS_LOG_PATH") ??
      defaultLogDir();
    this.sessionId = randomUUID();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  newRecallId(): string {
    const id = randomUUID();
    this.lastRecall = { id, ts: Date.now() };
    return id;
  }

  /** Returns the most recent recall_id if it's still within the follow-up window. */
  recentRecallId(): string | null {
    if (!this.lastRecall) return null;
    if (Date.now() - this.lastRecall.ts > RECALL_FOLLOWUP_WINDOW_MS) return null;
    return this.lastRecall.id;
  }

  /**
   * Record the rank-ordered hits returned by a hook_recall so that a later
   * load_memory(id) can report whether (and where) the id was hinted to the
   * user. Most-recent hint wins on collision.
   */
  recordHookHints(recall_id: string, hits: Array<{ id: string; score?: number }>): void {
    const ts = Date.now();
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (!hit) continue;
      this.hookHints.set(hit.id, {
        recall_id,
        rank: i + 1,
        score: typeof hit.score === "number" ? hit.score : null,
        ts,
      });
    }
  }

  /**
   * Returns the recall_id + rank if this id was hinted in the last
   * HOOK_HINT_WINDOW_MS. Lazy-evicts the entry on miss.
   */
  findHookHintFor(id: string): { recall_id: string; rank: number; score: number | null } | null {
    const t = this.hookHints.get(id);
    if (!t) return null;
    if (Date.now() - t.ts > HOOK_HINT_WINDOW_MS) {
      this.hookHints.delete(id);
      return null;
    }
    return { recall_id: t.recall_id, rank: t.rank, score: t.score };
  }

  rotateTurn(sessionId: string | null): string | null {
    if (!sessionId) return null;
    const trace: TurnTrace = {
      turn_id: randomUUID(),
      session_id: sessionId,
      started_at: Date.now(),
    };
    this.turns.set(sessionId, trace);
    this.latestTurn = trace;
    return trace.turn_id;
  }

  private currentTurn(sessionId: string | null): { turn_id: string; turn_source: TurnSource } {
    if (sessionId) {
      const exact = this.turns.get(sessionId);
      if (exact) return { turn_id: exact.turn_id, turn_source: "session" };
    }
    if (this.latestTurn) return { turn_id: this.latestTurn.turn_id, turn_source: "inferred" };
    const fallback = randomUUID();
    this.latestTurn = { turn_id: fallback, session_id: "", started_at: Date.now() };
    return { turn_id: fallback, turn_source: "inferred" };
  }

  recordLoadedMemory(payload: {
    memory_id: string;
    distinctive_tokens: string[];
    hook_hint: { recall_id: string; score: number | null } | null;
    session_id?: string | null;
  }): void {
    const tokens = new Set(payload.distinctive_tokens);
    if (tokens.size === 0) return;
    const turn = this.currentTurn(payload.session_id ?? null);
    const now = Date.now();
    this.loadedMemories = this.loadedMemories.filter(
      (entry) => !entry.closed && now - entry.ts <= ACTED_ON_WINDOW_MS,
    );
    this.loadedMemories.push({
      memory_id: payload.memory_id,
      distinctive_tokens: tokens,
      turn_id: turn.turn_id,
      turn_source: turn.turn_source,
      recall_id: payload.hook_hint?.recall_id ?? null,
      surfaced_score: payload.hook_hint?.score ?? null,
      band: bandForScore(payload.hook_hint?.score ?? null),
      ts: now,
      closed: false,
    });
  }

  matchLoadedMemories(payload: {
    tool_name: string | null;
    tool_input_excerpt: string;
    session_id?: string | null;
  }): Omit<RecallEpisodeEvent, "kind" | "ts" | "session_id">[] {
    const now = Date.now();
    const current = this.currentTurn(payload.session_id ?? null);
    const inputTokens = tokenize(payload.tool_input_excerpt);
    const episodes: Omit<RecallEpisodeEvent, "kind" | "ts" | "session_id">[] = [];

    for (const entry of this.loadedMemories) {
      if (entry.closed) continue;
      if (now - entry.ts > ACTED_ON_WINDOW_MS) {
        entry.closed = true;
        continue;
      }
      if (entry.turn_source === "session" && entry.turn_id !== current.turn_id) continue;

      let matchStrength = 0;
      for (const token of entry.distinctive_tokens) {
        if (inputTokens.has(token)) matchStrength++;
      }
      entry.closed = true;
      episodes.push({
        turn_id: entry.turn_id,
        turn_source: entry.turn_source,
        recall_id: entry.recall_id,
        memory_id: entry.memory_id,
        surfaced_score: entry.surfaced_score,
        band: entry.band,
        loaded: true,
        acted_on: matchStrength >= 2,
        match_strength: matchStrength,
        tool_name: payload.tool_name,
      });
    }

    this.loadedMemories = this.loadedMemories.filter(
      (entry) => !entry.closed && now - entry.ts <= ACTED_ON_WINDOW_MS,
    );
    return episodes;
  }

  async logRecallEpisode(
    payload: Omit<RecallEpisodeEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "recall_episode",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logRecall(payload: Omit<RecallEvent, "kind" | "ts" | "session_id">): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "recall",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logLoadMemory(
    payload: Omit<LoadMemoryEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "load_memory",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logSaveMemory(
    payload: Omit<SaveMemoryEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "save_memory",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logHookRecall(
    payload: Omit<HookRecallEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "hook_recall",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logHookCall(
    payload: Omit<HookCallEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "hook_call",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logOllamaLifecycle(
    payload: Omit<OllamaLifecycleEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "ollama_lifecycle",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  private async ensureDir(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = mkdir(this.logDir, { recursive: true }).then(() => undefined);
    }
    await this.initPromise;
  }

  private async write(event: TelemetryEvent): Promise<void> {
    try {
      await this.ensureDir();
      const day = event.ts.slice(0, 10);
      const file = join(this.logDir, `events-${day}.jsonl`);
      await appendFile(file, JSON.stringify(event) + "\n", "utf8");
    } catch (err) {
      // Telemetry must never break a tool call.
      console.error(`[bastra-recall] telemetry write failed: ${(err as Error).message}`);
    }
  }
}

export function fireAndForget(p: Promise<unknown>): void {
  p.catch((err) => {
    console.error(`[bastra-recall] telemetry: ${(err as Error).message}`);
  });
}

export function logDirFor(): string {
  return envFirst("BASTRA_LOG_PATH", "NEXUS_LOG_PATH") ?? defaultLogDir();
}

export { defaultLogDir };

// Re-export so consumers can build paths if needed.
export { dirname };
