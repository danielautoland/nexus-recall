/**
 * Offline bridge harvester (#120). Reconstructs (far query → acted-on memory) pairs
 * from the telemetry log and mints learned bridges from them — the "minting" half of
 * the shared learned-recall layer, run OFFLINE rather than on the recall hot path.
 *
 * Why offline: recall runs on a 500 ms hook budget, the positive acted_on signal is
 * sparse, and harvesting touches the vault to read a memory's vocabulary. Doing it at
 * write/idle time (a CLI command or a periodic job) keeps the query path untouched and
 * matches zzallirog's "harvest at write time, no query cost" point (#120).
 *
 * Honest scope: this reads only what telemetry already logs — in-band acted_on reaches
 * (the runner's word, positive-biased). The below-floor far slice stays invisible until
 * #121 logs it; this harvester picks up everything that is observable today.
 */
import { readdir, readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { detectLanguage } from "./language.js";
import { mintBridge, type Bridge } from "./bridges.js";

export interface TelemetryEvent {
  kind: string;
  ts: string;
  [k: string]: unknown;
}

/** A reconstructed reach: a recall query and the memory the agent acted on. */
export interface Reach {
  query: string;
  memoryId: string;
}

export function defaultLogDir(): string {
  return process.env.BASTRA_LOG_PATH ?? join(homedir(), ".bastra", "logs");
}

/** Read events-*.jsonl from a log dir, optionally limited to the last `days`. */
export async function readEventLog(logDir: string = defaultLogDir(), days: number | null = null): Promise<TelemetryEvent[]> {
  let files: string[];
  try {
    files = (await readdir(logDir)).filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  files.sort();
  const cutoff = days !== null ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const out: TelemetryEvent[] = [];
  for (const f of files) {
    const raw = await readFile(join(logDir, f), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as TelemetryEvent;
        if (cutoff && new Date(e.ts).getTime() < cutoff) continue;
        out.push(e);
      } catch {
        /* skip malformed line */
      }
    }
  }
  return out;
}

/**
 * Join recall/hook_recall (which carry the query) with recall_episode (which carries
 * the acted-on memory) by recall_id, yielding the (query → memory) reaches a bridge is
 * mined from. Only acted_on episodes count — the agent's terminal pick.
 */
export function reconstructReaches(events: TelemetryEvent[]): Reach[] {
  const queryByRecallId = new Map<string, string>();
  for (const e of events) {
    if ((e.kind === "hook_recall" || e.kind === "recall") && typeof e.recall_id === "string" && typeof e.query === "string") {
      queryByRecallId.set(e.recall_id, e.query);
    }
  }
  const reaches: Reach[] = [];
  for (const e of events) {
    if (e.kind === "recall_episode" && e.acted_on === true && typeof e.recall_id === "string" && typeof e.memory_id === "string") {
      const query = queryByRecallId.get(e.recall_id);
      if (query) reaches.push({ query, memoryId: e.memory_id });
    }
  }
  return reaches;
}

export interface HarvestResult {
  /** Minted bridges, deduped by id with evidence = how many reaches produced each. */
  bridges: Bridge[];
  /** Reaches seen / reaches that produced a usable (far enough, language-detected) bridge. */
  reaches: number;
  minted: number;
}

/**
 * Mint bridges from reaches. `getMemoryTerms(id)` supplies a memory's distinctive
 * vocabulary (the near terms); a bridge only forms when the query is far enough that
 * some of those terms are NOT already in the query (mintBridge enforces this). Repeated
 * reaches onto the same bridge accumulate evidence.
 */
export function harvestBridges(reaches: Reach[], getMemoryTerms: (memoryId: string) => string[], date?: string): HarvestResult {
  const byId = new Map<string, Bridge>();
  for (const r of reaches) {
    const terms = getMemoryTerms(r.memoryId);
    if (terms.length === 0) continue;
    const b = mintBridge(r.query, terms, detectLanguage(r.query).lang, date);
    if (!b) continue;
    const existing = byId.get(b.id);
    if (existing) existing.evidence += 1;
    else byId.set(b.id, b);
  }
  return { bridges: [...byId.values()], reaches: reaches.length, minted: byId.size };
}

/** Atomically write each bridge to <root>/bridges/<lang>/<id>.json. Returns count written. */
export async function writeBridges(rootDir: string, bridges: Bridge[]): Promise<number> {
  let written = 0;
  for (const b of bridges) {
    const dir = join(rootDir, "bridges", b.lang);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${b.id}.json`);
    const tmp = `${path}.tmp-${randomBytes(4).toString("hex")}`;
    await writeFile(tmp, JSON.stringify(b, null, 2) + "\n", "utf8");
    await rename(tmp, path);
    written++;
  }
  return written;
}

/** True when a bridges/ dir already exists under root (for status/CLI messaging). */
export function hasBridgeDir(rootDir: string): boolean {
  return existsSync(join(rootDir, "bridges"));
}
