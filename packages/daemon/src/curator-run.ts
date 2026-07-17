/**
 * Curator run orchestration (#155/#156) — joins the usage sidecar (#154),
 * the floor registry (#141/#142) and the in-RAM vault into one deterministic
 * pass: decide staleness (curator.ts), persist state, push the score-only
 * demotion set into the search index, and project the human review surface
 * as REPORT.md into the vault (vault-report.ts).
 *
 * Also home of the loopback HTTP handlers (POST /curator/run, GET
 * /curator/state) so http.ts — already past the file-size comfort line —
 * only grows by routing lines.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { listFloors } from "./floors.js";
import { listSkills } from "./skills-registry.js";
import {
  applyDecision,
  decideStale,
  loadCuratorState,
  saveCuratorState,
  shouldRunCurator,
  type CuratorMemoryFacts,
  type CuratorState,
} from "./curator.js";
import { compactUsage, readUsage, type UsageAggregate } from "./usage-sidecar.js";
import {
  writeVaultHealthReport,
  type ReportConflictCluster,
  type ReportDanglingLink,
  type ReportFloorEntry,
  type ReportStaleCandidate,
  type VaultHealthData,
} from "./vault-report.js";

/** Floors older than this without a real affirm land in the report. */
const FLOOR_REVIEW_WEEKS = 4;

interface VaultLike {
  list(): Array<{ fm: Record<string, unknown>; body?: string }>;
  get(id: string): { fm: Record<string, unknown> } | undefined;
  size(): number;
}

/** `[[target]]` / `[[target|label]]` / `[[target#heading]]` in a body. */
const BODY_WIKILINK_RE = /\[\[([^\]|#\n]+)/g;

export interface CuratorRunDeps {
  vaultRoot: string;
  vault: VaultLike;
  /** SearchIndex.setDemotions — the engine side of the score-only demotion. */
  setDemotions: (ids: Iterable<string>) => void;
}

export interface CuratorRunResult {
  ran: boolean;
  skipped?: "interval" | "busy";
  /** "acting" persisted demotions; "review-first" wrote only report +
   *  last_run_at (the very first pass never demotes — a human gets a full
   *  interval to read REPORT.md before anything acts); "dry-run" persisted
   *  nothing at all. */
  mode: "acting" | "review-first" | "dry-run";
  dryRun: boolean;
  demoted: string[];
  reactivated: string[];
  /** Would-be demotions still inside the observation window (report-only). */
  pendingObservation: string[];
  staleTotal: number;
  reportWritten: boolean;
  /** Set when the pass failed internally (never thrown — see contract). */
  error?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function collectFacts(vault: VaultLike, flooredIds: Set<string>): CuratorMemoryFacts[] {
  const facts: CuratorMemoryFacts[] = [];
  for (const mem of vault.list()) {
    const id = str(mem.fm.id);
    if (!id) continue;
    facts.push({
      id,
      created: str(mem.fm.created),
      floored: flooredIds.has(id),
      // No pin source exists beyond floors today — the class stays explicit
      // so future sources slot in.
      pinned: false,
      // Protected classes (review find 2026-07-03): documents have no
      // engagement path (read_document records no usage — they would demote
      // deterministically AND stack with DOC_TYPE_DAMPING to 0.25); taxonomy
      // conventions are injected via <vault-taxonomy>, not load_memory, so
      // they are equally engagement-blind. user-directed memories (#158) are
      // untouchable for automated lifecycle passes by definition.
      protected:
        mem.fm.type === "doc" ||
        mem.fm.scope === "taxonomy" ||
        mem.fm.write_origin === "user-directed",
    });
  }
  return facts;
}

// ─── report data collection ──────────────────────────────────────────────────

function collectStaleCandidates(
  vault: VaultLike,
  state: CuratorState,
  usage: UsageAggregate,
): ReportStaleCandidate[] {
  return Object.entries(state.stale)
    .map(([id, entry]) => ({
      id,
      title: str(vault.get(id)?.fm.title),
      usage: usage[id],
      entry,
    }))
    .sort((a, b) => (b.usage?.surfaced ?? 0) - (a.usage?.surfaced ?? 0));
}

async function collectFloorReview(vault: VaultLike, nowMs: number): Promise<ReportFloorEntry[]> {
  const floors = await listFloors();
  const out: ReportFloorEntry[] = [];
  for (const f of floors) {
    const affirmedMs = Date.parse(f.last_affirmed);
    if (!Number.isFinite(affirmedMs)) continue;
    const weeks = Math.floor((nowMs - affirmedMs) / (7 * 86_400_000));
    if (weeks < FLOOR_REVIEW_WEEKS) continue;
    out.push({
      memory_id: f.memory_id,
      title: str(vault.get(f.memory_id)?.fm.title),
      reason: f.reason,
      floored_at: f.floored_at,
      last_affirmed: f.last_affirmed,
      affirmed_by: f.affirmed_by,
      why: f.why,
      weeksSinceAffirm: weeks,
      neverReaffirmed: f.last_affirmed === f.floored_at,
    });
  }
  return out.sort((a, b) => b.weeksSinceAffirm - a.weeksSinceAffirm);
}

function collectConflictsAndDangling(vault: VaultLike, skillIds: Set<string> = new Set()): {
  conflicts: ReportConflictCluster[];
  dangling: ReportDanglingLink[];
} {
  const members = vault.list();
  const ids = new Set<string>();
  for (const m of members) {
    const id = str(m.fm.id);
    if (id) ids.add(id);
  }

  const byTopic = new Map<string, string[]>();
  const dangling: ReportDanglingLink[] = [];
  for (const m of members) {
    const id = str(m.fm.id);
    if (!id || m.fm.obsolete === true) continue;

    const tp = Array.isArray(m.fm.topic_path) ? (m.fm.topic_path as string[]) : [];
    if (tp.length > 0) {
      const key = tp.join("\u0000");
      const bucket = byTopic.get(key) ?? [];
      bucket.push(id);
      byTopic.set(key, bucket);
    }

    const targets = new Set<string>();
    if (Array.isArray(m.fm.related)) for (const r of m.fm.related) if (typeof r === "string") targets.add(r);
    if (Array.isArray(m.fm.related_via)) {
      for (const rv of m.fm.related_via as Array<{ id?: unknown }>) {
        if (rv && typeof rv.id === "string") targets.add(rv.id);
      }
    }
    // Body wikilinks too: save_memory mirrors them into related[], but
    // Obsidian hand-edits never pass through the save path (review find
    // 2026-07-03) — without this the section reads "all clean" wrongly.
    if (typeof m.body === "string") {
      for (const match of m.body.matchAll(BODY_WIKILINK_RE)) {
        const t = match[1]?.trim();
        if (t) targets.add(t);
      }
    }
    for (const t of targets) {
      // Declared skills (#215) live on another surface by design — a link to
      // one is a reference, not a dangling link to fix.
      if (!ids.has(t) && !skillIds.has(t)) dangling.push({ fromId: id, target: t });
    }
  }

  const conflicts: ReportConflictCluster[] = [];
  for (const [key, memberIds] of byTopic) {
    if (memberIds.length >= 2) conflicts.push({ topicPath: key.split("\u0000"), memberIds: memberIds.sort() });
  }
  conflicts.sort((a, b) => b.memberIds.length - a.memberIds.length);
  return { conflicts, dangling };
}

/** #147: captures whose sidecar carries injection_flags from the ingest scan. */
function collectFlaggedCaptures(vault: VaultLike): Array<{ id: string; title?: string; flags: string[] }> {
  const out: Array<{ id: string; title?: string; flags: string[] }> = [];
  for (const m of vault.list()) {
    const id = str(m.fm.id);
    const flags = Array.isArray(m.fm.injection_flags)
      ? (m.fm.injection_flags as unknown[]).filter((f): f is string => typeof f === "string")
      : [];
    if (id && flags.length > 0) out.push({ id, title: str(m.fm.title), flags });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 0-byte .md files anywhere in the vault (dotfolders excluded) — typically
 * Obsidian's auto-created empty notes from clicking an unresolved wikilink
 * (e.g. a bastra doc-id link; real-vault find 2026-07-04). Best-effort:
 * returns [] on any error.
 */
async function collectEmptyFiles(vaultRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(vaultRoot, { recursive: true, withFileTypes: true });
    const empty: string[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const rel = relative(vaultRoot, join(e.parentPath, e.name));
      if (rel.split(sep).some((part) => part.startsWith("."))) continue;
      try {
        if ((await stat(join(vaultRoot, rel))).size === 0) empty.push(rel);
      } catch {
        /* raced deletion — skip */
      }
    }
    return empty.sort();
  } catch {
    return [];
  }
}

// ─── the pass ────────────────────────────────────────────────────────────────

/**
 * One curator pass. `force` skips the interval/idle gate (manual trigger),
 * `dryRun` decides + reports but persists nothing and demotes nothing —
 * REPORT.md then shows what WOULD happen (the #156 review-first default for
 * a first run on a real vault).
 */
export async function runCuratorPass(
  deps: CuratorRunDeps,
  opts: { force?: boolean; dryRun?: boolean; lastActivityMs?: number; nowMs?: number } = {},
): Promise<CuratorRunResult> {
  // Never-throws contract: a broken curator must never take the daemon down
  // (the 15-min tick has no business crashing MCP service).
  try {
    return await runCuratorPassInner(deps, opts);
  } catch (err) {
    return {
      ran: false,
      mode: opts.dryRun ? "dry-run" : "acting",
      dryRun: opts.dryRun ?? false,
      demoted: [],
      reactivated: [],
      pendingObservation: [],
      staleTotal: 0,
      reportWritten: false,
      error: (err as Error)?.message ?? String(err),
    };
  }
}

async function runCuratorPassInner(
  deps: CuratorRunDeps,
  opts: { force?: boolean; dryRun?: boolean; lastActivityMs?: number; nowMs?: number },
): Promise<CuratorRunResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const state = await loadCuratorState(deps.vaultRoot);
  const dryRun = opts.dryRun ?? false;

  if (!opts.force) {
    if (!shouldRunCurator({ nowMs, lastRunAt: state.last_run_at, lastActivityMs: opts.lastActivityMs })) {
      const busy =
        opts.lastActivityMs !== undefined && nowMs - opts.lastActivityMs < 10 * 60 * 1000;
      return {
        ran: false,
        skipped: busy ? "busy" : "interval",
        mode: dryRun ? "dry-run" : "acting",
        dryRun,
        demoted: [],
        reactivated: [],
        pendingObservation: [],
        staleTotal: Object.keys(state.stale).length,
        reportWritten: false,
      };
    }
  }

  await compactUsage(deps.vaultRoot);
  const usage = await readUsage(deps.vaultRoot);
  const floors = await listFloors();
  const facts = collectFacts(deps.vault, new Set(floors.map((f) => f.memory_id)));

  // Observation epoch: demotions need a full engagement window of sidecar
  // data ("no engagement in 30d" is unobservable from 7 days of records).
  // Stamped on the first persisting pass; a legacy state without it counts
  // as immature this run and matures from now on.
  const nowIso = new Date(nowMs).toISOString();
  const observedSince = state.observed_since ?? nowIso;
  const observedSinceMs = Date.parse(observedSince);

  const decision = decideStale({
    nowMs,
    facts,
    usage,
    currentStale: state.stale,
    observedSinceMs: Number.isFinite(observedSinceMs) ? observedSinceMs : undefined,
  });
  const nextState = applyDecision({ ...state, observed_since: observedSince }, decision, nowIso);

  // Review-first (#155 acceptance: "first run … manual review of the report"):
  // the very first non-dry pass writes REPORT.md and starts the interval
  // clock but demotes NOTHING — a human gets a full interval to review
  // before the curator ever acts.
  const firstEverRun = !state.last_run_at;
  const mode: CuratorRunResult["mode"] = dryRun ? "dry-run" : firstEverRun ? "review-first" : "acting";
  if (mode === "acting") {
    await saveCuratorState(deps.vaultRoot, nextState);
    deps.setDemotions(Object.keys(nextState.stale));
  } else if (mode === "review-first") {
    await saveCuratorState(deps.vaultRoot, { ...state, observed_since: observedSince, last_run_at: nowIso });
  }

  const data: VaultHealthData = {
    generatedAt: nowIso,
    vaultSize: deps.vault.size(),
    stale: collectStaleCandidates(deps.vault, nextState, usage),
    pending: Object.entries(decision.pendingObservation).map(([id, reason]) => ({
      id,
      title: str(deps.vault.get(id)?.fm.title),
      usage: usage[id],
      reason,
    })),
    floors: await collectFloorReview(deps.vault, nowMs),
    ...collectConflictsAndDangling(deps.vault, new Set((await listSkills()).map((s) => s.id))),
    emptyFiles: await collectEmptyFiles(deps.vaultRoot),
    flagged: collectFlaggedCaptures(deps.vault),
    ...(mode !== "acting" ? { pendingReview: true } : {}),
  };
  const reportWritten = await writeVaultHealthReport(deps.vaultRoot, data);

  return {
    ran: true,
    mode,
    dryRun,
    demoted: Object.keys(decision.demote),
    reactivated: decision.reactivate,
    pendingObservation: Object.keys(decision.pendingObservation),
    staleTotal: mode === "acting" ? Object.keys(nextState.stale).length : Object.keys(state.stale).length,
    reportWritten,
  };
}

// ─── loopback HTTP handlers (routed from http.ts) ────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

/** GET /curator/state — last run + active demotions (loopback, read-only). */
export function handleCuratorState(_req: IncomingMessage, res: ServerResponse, deps: CuratorRunDeps): void {
  loadCuratorState(deps.vaultRoot)
    .then((state) => sendJson(res, 200, {
      last_run_at: state.last_run_at ?? null,
      stale_count: Object.keys(state.stale).length,
      stale: state.stale,
    }))
    .catch(() => sendJson(res, 200, { last_run_at: null, stale_count: 0, stale: {} }));
}

/**
 * POST /curator/run {force?, dryRun?} — manual trigger (loopback). Defaults
 * to dryRun:true: a hand-triggered run is a review request, not consent to
 * demote — the periodic pass is the acting path.
 */
/**
 * HTTP boundary sanitizer (CodeQL js/stack-trace-exposure, alert #23):
 * runCuratorPass is never-throw and carries the exception detail in
 * `result.error` — useful for the daemon log (index.ts tick), but it must
 * not reach an HTTP response. Loopback-only today; the hygiene rule holds
 * regardless of audience. Exported for tests.
 */
export function sanitizeRunResultForHttp(
  result: CuratorRunResult,
): { status: number; body: CuratorRunResult } {
  if (!result.error) return { status: 200, body: result };
  return { status: 500, body: { ...result, error: "curator run failed — see daemon log" } };
}

export function handleCuratorRun(req: IncomingMessage, res: ServerResponse, deps: CuratorRunDeps): void {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
  req.on("end", () => {
    let body: { force?: boolean; dryRun?: boolean } = {};
    try { body = raw.trim() ? JSON.parse(raw) : {}; } catch { /* defaults */ }
    runCuratorPass(deps, { force: body.force ?? true, dryRun: body.dryRun ?? true })
      .then((result) => {
        if (result.error) console.error(`[bastra-recall] /curator/run failed: ${result.error}`);
        const { status, body: payload } = sanitizeRunResultForHttp(result);
        sendJson(res, status, payload);
      })
      .catch(() => {
        // Unreachable by contract (runCuratorPass never throws) — and
        // deliberately detail-free if it ever happens anyway.
        sendJson(res, 500, { error: "curator run failed — see daemon log" });
      });
  });
}
