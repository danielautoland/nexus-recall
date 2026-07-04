/**
 * Per-memory usage sidecar (#154) — durable aggregate of surfaced/loaded/
 * acted_on per memory id, under `<vault>/.bastra/usage/`.
 *
 * Why a sidecar: telemetry JSONL rotates and stats.ts re-scans raw logs; the
 * lifecycle passes (#155 staleness, #160 trust) need a stable per-memory
 * anchor. Frontmatter is off-limits for operational counters (user-authored
 * files stay byte-identical — the survival-by-id contract), so this rides the
 * vault's existing operational dot-dir (`.bastra/trash`, audit log).
 *
 * Format: append-only `events.jsonl` (one {id, kind, ts} per line) plus a
 * compacted `aggregate.json`. Append-only + periodic compaction instead of
 * mutable counters: merge-friendly for a future multi-device story and safe
 * under concurrent writers. Compaction rotates the events file (atomic
 * rename) before folding, so appends racing the compactor land in the fresh
 * file instead of being truncated away.
 *
 * Safety contract: every export is best-effort and never throws — a broken
 * sidecar must never break a tool call.
 */
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type UsageKind = "surfaced" | "loaded" | "acted_on";

export interface UsageEvent {
  id: string;
  kind: UsageKind;
  /** ISO timestamp. */
  ts: string;
}

export interface UsageEntry {
  surfaced: number;
  loaded: number;
  acted_on: number;
  last_surfaced_at?: string;
  last_loaded_at?: string;
  last_acted_on_at?: string;
}

export type UsageAggregate = Record<string, UsageEntry>;

const USAGE_DIR = join(".bastra", "usage");
const EVENTS_FILE = "events.jsonl";
const COMPACTING_FILE = "events.compacting.jsonl";
const AGGREGATE_FILE = "aggregate.json";

/** Compaction kicks in above this many pending event lines. */
export const COMPACT_THRESHOLD = 2000;

function usageDir(vaultRoot: string): string {
  return join(vaultRoot, USAGE_DIR);
}

/** Append usage events. Best-effort: swallows every error. */
export async function recordUsage(vaultRoot: string, events: UsageEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const dir = usageDir(vaultRoot);
    await mkdir(dir, { recursive: true });
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await appendFile(join(dir, EVENTS_FILE), lines, "utf8");
  } catch {
    /* never break the caller over telemetry */
  }
}

function emptyEntry(): UsageEntry {
  return { surfaced: 0, loaded: 0, acted_on: 0 };
}

function foldEvent(agg: UsageAggregate, e: UsageEvent): void {
  if (!e || typeof e.id !== "string" || e.id.length === 0) return;
  if (e.kind !== "surfaced" && e.kind !== "loaded" && e.kind !== "acted_on") return;
  const entry = (agg[e.id] ??= emptyEntry());
  entry[e.kind] += 1;
  const tsField = `last_${e.kind}_at` as const;
  // Events arrive roughly ordered, but a merge after compaction rotation may
  // replay older lines — keep the max, not the last seen.
  if (typeof e.ts === "string" && (!entry[tsField] || e.ts > entry[tsField]!)) {
    entry[tsField] = e.ts;
  }
}

async function readJsonlEvents(path: string): Promise<UsageEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const events: UsageEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line) as UsageEvent);
    } catch {
      /* torn/partial line (crash mid-append) — skip, never fail the read */
    }
  }
  return events;
}

/** Reserved key inside aggregate.json: fold bookkeeping, atomic with the
 *  data because it rides the same rename. Never surfaced to consumers. */
const META_KEY = "__meta";

interface AggregateMeta {
  last_fold_sig?: string;
}

async function readAggregateRaw(vaultRoot: string): Promise<{ agg: UsageAggregate; meta: AggregateMeta }> {
  try {
    const raw = await readFile(join(usageDir(vaultRoot), AGGREGATE_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { [META_KEY]: meta, ...agg } = parsed as UsageAggregate & { [META_KEY]?: AggregateMeta };
      return { agg: agg as UsageAggregate, meta: (meta as AggregateMeta) ?? {} };
    }
  } catch {
    /* missing or corrupt aggregate = start empty (events still count) */
  }
  return { agg: {}, meta: {} };
}


/**
 * Current per-memory usage: compacted aggregate + every not-yet-compacted
 * event folded on top. Read-only; never throws (worst case: {}).
 */
export async function readUsage(vaultRoot: string): Promise<UsageAggregate> {
  try {
    const { agg, meta } = await readAggregateRaw(vaultRoot);
    const dir = usageDir(vaultRoot);
    // A crashed compaction may have left a rotated file behind. Two cases:
    // rotated-but-unfolded (count it — not in the aggregate yet) vs
    // folded-but-not-removed (skip it — the fold signature in the aggregate
    // proves it is already counted).
    try {
      const raw = await readFile(join(dir, COMPACTING_FILE), "utf8");
      const sig = createHash("sha1").update(raw).digest("hex");
      if (meta.last_fold_sig !== sig) {
        for (const line of raw.split("\n")) {
          if (line.trim() === "") continue;
          try {
            foldEvent(agg, JSON.parse(line) as UsageEvent);
          } catch {
            /* torn line */
          }
        }
      }
    } catch {
      /* no rotated file */
    }
    for (const e of await readJsonlEvents(join(dir, EVENTS_FILE))) foldEvent(agg, e);
    return agg;
  } catch {
    return {};
  }
}

/**
 * Fold one rotated file into the aggregate, persist atomically, drop it.
 * Idempotent under crash-replay: the aggregate carries the signature of the
 * last folded rotation (atomic with the data — same rename). A crash between
 * "aggregate persisted" and "rotated file removed" would otherwise
 * double-count the whole rotation on the next run.
 */
async function foldRotatedFile(vaultRoot: string): Promise<number> {
  const dir = usageDir(vaultRoot);
  const compacting = join(dir, COMPACTING_FILE);
  let raw: string;
  try {
    raw = await readFile(compacting, "utf8");
  } catch {
    return 0; // nothing rotated
  }
  const sig = createHash("sha1").update(raw).digest("hex");
  const { agg, meta } = await readAggregateRaw(vaultRoot);
  if (meta.last_fold_sig === sig) {
    // Already folded by a run that crashed before cleanup — just finish it.
    await rm(compacting, { force: true });
    return 0;
  }
  const events: UsageEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line) as UsageEvent);
    } catch {
      /* torn line — skip */
    }
  }
  if (events.length === 0) {
    await rm(compacting, { force: true });
    return 0;
  }
  for (const e of events) foldEvent(agg, e);
  const tmp = join(dir, `${AGGREGATE_FILE}.tmp-${process.pid}`);
  await writeFile(tmp, JSON.stringify({ ...agg, [META_KEY]: { last_fold_sig: sig } }, null, 2) + "\n", "utf8");
  await rename(tmp, join(dir, AGGREGATE_FILE));
  // Aggregate (incl. fold signature) is durable — the rotated input may go.
  await rm(compacting, { force: true });
  return events.length;
}

/**
 * Fold pending events into aggregate.json: recover → rotate → fold.
 *
 * 1. Recovery: a rotated file left by a crashed run (renamed but not yet
 *    folded) is folded and persisted FIRST — a plain rename in step 2 would
 *    silently overwrite it (POSIX rename replaces the target).
 * 2. Rotate: events.jsonl → events.compacting.jsonl (atomic; concurrent
 *    appenders start a fresh events.jsonl, nothing is truncated away).
 * 3. Fold the rotated file, write the aggregate atomically, drop the input.
 *
 * A crash between 2 and 3 is safe: the rotated file survives, readUsage
 * still counts it, and the next run's recovery step folds it. Returns the
 * number of folded events; never throws.
 */
export async function compactUsage(vaultRoot: string): Promise<number> {
  // In-process serialization: the daemon is the only compactor (timer, HTTP
  // trigger, curator pass all live here) — concurrent invocations would race
  // the rotate/fold steps, so they queue instead (review find 2026-07-03).
  const run = compactionChain.then(() => compactUsageSerialized(vaultRoot));
  compactionChain = run.catch(() => 0).then(() => undefined);
  return run;
}

let compactionChain: Promise<void> = Promise.resolve();

async function compactUsageSerialized(vaultRoot: string): Promise<number> {
  try {
    const dir = usageDir(vaultRoot);
    let folded = await foldRotatedFile(vaultRoot);
    try {
      await rename(join(dir, EVENTS_FILE), join(dir, COMPACTING_FILE));
    } catch {
      return folded; // no events file = nothing new
    }
    folded += await foldRotatedFile(vaultRoot);
    return folded;
  } catch {
    return 0;
  }
}

/** Opportunistic compaction when the pending event file has grown. */
export async function maybeCompactUsage(vaultRoot: string): Promise<void> {
  try {
    const s = await stat(join(usageDir(vaultRoot), EVENTS_FILE));
    // ~60 bytes/line → threshold in bytes, cheaper than counting lines.
    if (s.size > COMPACT_THRESHOLD * 60) await compactUsage(vaultRoot);
  } catch {
    /* no events file or unreadable — nothing to do */
  }
}
