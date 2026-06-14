/**
 * far-slice-export — #121 checkbox 3.
 *
 * The far slice = queries whose right memory ranked BELOW the score floor (30)
 * yet was still loaded and acted on. Those are exactly the (far query → memory
 * that actually resolved it) pairs the #120 training loop trains against.
 *
 * This reads the wire (~/.bastra/logs/events-*.jsonl) and joins the three events
 * that, together, witness a below-floor would-be terminal pick:
 *
 *   hook_recall   — the candidate pool (retains below-floor hits[] server-side)
 *   load_memory   — which id the agent reached for (+ hook_hint_rank, from_hook_recall)
 *   recall_episode — band="below_floor" + acted_on + surfaced_score
 *
 * Usage:
 *   npx tsx packages/daemon/scripts/far-slice-export.ts                  # summary
 *   npx tsx packages/daemon/scripts/far-slice-export.ts --out far.jsonl  # + dataset
 *   npx tsx packages/daemon/scripts/far-slice-export.ts --days 30 --acted-only
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function defaultLogDir(): string {
  const next = join(homedir(), ".bastra", "logs");
  const legacy = join(homedir(), ".nexus-recall", "logs");
  if (existsSync(next)) return next;
  if (existsSync(legacy)) return legacy;
  return next;
}

const LOG_DIR =
  process.env.BASTRA_LOG_PATH ?? process.env.NEXUS_LOG_PATH ?? defaultLogDir();
const FLOOR = Number(process.env.BASTRA_RECALL_FLOOR ?? 30);

const argv = process.argv.slice(2);
function flagValue(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const OUT = flagValue("--out");
const daysRaw = flagValue("--days");
const DAYS = daysRaw ? parseInt(daysRaw, 10) : null;
const ACTED_ONLY = argv.includes("--acted-only");

interface AnyEvent {
  kind: string;
  ts: string;
  [k: string]: unknown;
}

/** One far-slice training row: a below-floor would-be terminal pick. */
interface FarSliceRow {
  far_query: string;
  memory_id: string;
  hook_hint_score: number | null;
  rank: number | null;
  acted_on: boolean;
  recall_id: string;
  topics: string[];
  project: string | null;
  ts: string;
}

async function loadEvents(): Promise<AnyEvent[]> {
  let files: string[];
  try {
    files = (await readdir(LOG_DIR)).filter(
      (f) => f.startsWith("events-") && f.endsWith(".jsonl"),
    );
  } catch {
    console.error(`no logs found at ${LOG_DIR}`);
    return [];
  }
  files.sort();
  const cutoff = DAYS !== null ? Date.now() - DAYS * 24 * 60 * 60 * 1000 : 0;
  const out: AnyEvent[] = [];
  for (const f of files) {
    const raw = await readFile(join(LOG_DIR, f), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as AnyEvent;
        if (cutoff && new Date(e.ts).getTime() < cutoff) continue;
        out.push(e);
      } catch {
        // skip malformed
      }
    }
  }
  return out;
}

function isBelowFloor(score: number | null): boolean {
  return score === null || score < FLOOR;
}

async function main(): Promise<number> {
  const events = await loadEvents();

  // hook_recall pool, keyed by recall_id — carries the far query + raw hits[].
  const recallById = new Map<string, AnyEvent>();
  let poolBelowFloorTail = 0; // "log the candidate pool" half: total below-floor hits logged
  for (const e of events) {
    if (e.kind === "hook_recall" && typeof e.recall_id === "string") {
      recallById.set(e.recall_id, e);
      if (typeof e.below_floor_count === "number") poolBelowFloorTail += e.below_floor_count;
      else if (Array.isArray(e.hits))
        poolBelowFloorTail += (e.hits as Array<{ score: number }>).filter(
          (h) => h.score < FLOOR,
        ).length;
    }
  }

  // acted_on enrichment: recall_episode is the (rare) behavioral witness. Keyed by
  // recall_id|memory_id. NOTE: below-floor hints are filtered before the agent sees
  // them, so episodes are NOT the primary far-slice stream — load_memory is.
  const actedKey = new Set<string>();
  for (const e of events) {
    if (e.kind === "recall_episode" && e.acted_on === true) {
      actedKey.add(`${e.recall_id ?? ""}|${e.memory_id ?? ""}`);
    }
  }

  // PRIMARY far-slice stream: load_memory events whose hook_hint_score sat BELOW floor.
  // That is a below-floor would-be terminal pick — observable here even though the hint
  // was never surfaced to the agent (the hook filters score<floor before showing). This
  // is the stream that actually populates; the earlier recall_episode join read a stream
  // that is empty by construction for the far slice.
  const rows: FarSliceRow[] = [];
  let loadsWithHint = 0;
  for (const e of events) {
    if (e.kind !== "load_memory") continue;
    const score = (e.hook_hint_score ?? null) as number | null;
    if (typeof e.from_hook_recall === "string") loadsWithHint++;
    if (!isBelowFloor(score) || typeof e.from_hook_recall !== "string") continue;

    const recall = recallById.get(e.from_hook_recall);
    const actedOn = actedKey.has(`${e.from_hook_recall}|${e.id}`);
    if (ACTED_ONLY && !actedOn) continue;
    rows.push({
      far_query: (recall?.query as string) ?? "",
      memory_id: (e.id ?? "") as string,
      hook_hint_score: score,
      rank: (e.hook_hint_rank ?? null) as number | null,
      acted_on: actedOn,
      recall_id: (e.from_hook_recall ?? "") as string,
      topics: Array.isArray(recall?.topics) ? (recall!.topics as string[]) : [],
      project: (recall?.project as string | null) ?? null,
      ts: e.ts,
    });
  }

  const actedRows = rows.filter((r) => r.acted_on);

  console.log(`# far-slice export (floor=${FLOOR}, dir=${LOG_DIR})`);
  console.log(`hook_recall pool below-floor tail (logged candidates): ${poolBelowFloorTail}`);
  console.log(`load_memory events carrying a hook hint:               ${loadsWithHint}`);
  console.log(`below-floor would-be terminal picks (far-slice rows):  ${rows.length}`);
  console.log(`  of which acted_on (enriched via episode):            ${actedRows.length}`);
  if (rows.length === 0) {
    console.log(
      "\n→ 0 far-slice rows. The candidate-pool tail above may still be >0 (the pool\n" +
        "  half is logged); 0 picks means no below-floor memory was loaded yet. Until the\n" +
        "  agent loads a below-floor memory, the would-be-pick half stays empty — the\n" +
        "  structural blind spot #121 is about. (See HANDOFF: full closure logs the pool\n" +
        "  tail proactively; this reports it + any picks the load stream does capture.)",
    );
  }

  if (OUT) {
    const payload = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
    await writeFile(OUT, payload, "utf8");
    console.log(`\n[far-slice] ${rows.length} rows written to ${OUT}`);
  }
  return 0;
}

main().then((code) => process.exit(code));
