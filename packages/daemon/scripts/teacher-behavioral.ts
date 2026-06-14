/**
 * teacher-behavioral — #120 Teacher 1 (the free one, already on the wire).
 *
 * Reads telemetry and emits training signal by reading the runner's BEHAVIOR —
 * no model. Three outputs, straight off #120's spec:
 *
 *   anchor   — the TERMINAL pick: the memory the agent stopped on (after which
 *              it did NOT re-query). That is the one that paid out. We mint the
 *              far query → that memory. The WHOLE reformulation chain is
 *              harvested: a reach that lands on round r means rounds 1..r-1
 *              MISSED outright, so they are the FARTHEST proven paraphrases for
 *              that memory — weighted UP by how late the chain landed.
 *
 *   negative — a re-query: a reformulation issued AFTER a result is that result
 *              failing, on the record. Free negatives bare acted_on can't give.
 *
 *   flare    — "nothing fit": a chain that dies with no acted_on terminal means
 *              the agent GAVE UP. That must NOT mint an anchor (it would teach a
 *              door that opens on the wrong room). Zero the chain, raise a
 *              coverage alert instead (triage → #108).
 *
 * Honest edge (unchanged): "found it" is the RUNNER's word, not a verified
 * outcome — positive-biased everywhere except the chain's own re-query negatives.
 * A runner can be fooled; so can this.
 *
 * Usage:
 *   npx tsx packages/daemon/scripts/teacher-behavioral.ts --in events/ --out pairs.jsonl
 *   npx tsx packages/daemon/scripts/teacher-behavioral.ts            # summary, live logs
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

const argv = process.argv.slice(2);
const flag = (n: string): string | null => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const IN_DIR = flag("--in") ?? process.env.BASTRA_LOG_PATH ?? defaultLogDir();
const OUT = flag("--out");
/** Two consecutive hook_recalls in a session within this gap = one reformulation chain. */
const CHAIN_GAP_MS = Number(flag("--gap") ?? 120_000);

export interface AnyEvent {
  kind: string;
  ts: string;
  session_id?: string;
  recall_id?: string;
  query?: string;
  memory_id?: string;
  acted_on?: boolean;
  band?: string;
  surfaced_score?: number | null;
  [k: string]: unknown;
}

export type Signal =
  | { type: "anchor"; query: string; memory_id: string; round: number; chain_len: number; weight: number; recall_id: string; landed_round: number }
  | { type: "negative"; query: string; memory_id: string; round: number; chain_len: number; recall_id: string }
  | { type: "flare"; queries: string[]; chain_len: number; session_id: string; reason: "give_up" };

/**
 * Lateness weight for a chain anchor. The chain landed at `landedRound`
 * (1-based). A query at `round` (1-based, ≤ landedRound) that missed is the
 * dearer the earlier it sits relative to the landing: round 1 of a 3-round
 * chain is the farthest proven paraphrase. Terminal (round == landed) = 1.0.
 */
export function latenessWeight(round: number, landedRound: number): number {
  if (landedRound <= 1) return 1;
  // farther (smaller round) → heavier; linear ramp in [1 .. landedRound].
  return 1 + (landedRound - round) / (landedRound - 1);
}

/** Core, pure so it can be unit-tested on hand-built event fixtures. */
export function extractSignals(events: AnyEvent[]): Signal[] {
  // index episodes by recall_id (a recall may resolve to a terminal memory).
  const episodeByRecall = new Map<string, AnyEvent>();
  for (const e of events) {
    if (e.kind === "recall_episode" && e.recall_id) {
      // keep the acted_on one if several share a recall_id
      const prev = episodeByRecall.get(e.recall_id);
      if (!prev || (e.acted_on && !prev.acted_on)) episodeByRecall.set(e.recall_id, e);
    }
  }

  // group hook_recalls by session, ordered by ts.
  const bySession = new Map<string, AnyEvent[]>();
  for (const e of events) {
    if (e.kind !== "hook_recall") continue;
    const sid = e.session_id ?? "";
    (bySession.get(sid) ?? bySession.set(sid, []).get(sid)!).push(e);
  }

  const signals: Signal[] = [];
  for (const [sid, recallsUnsorted] of bySession) {
    const recalls = [...recallsUnsorted].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    // split into reformulation chains by the gap window.
    let chain: AnyEvent[] = [];
    const flushChain = () => {
      if (chain.length === 0) return;
      const c = chain;
      chain = [];
      // does any recall in the chain have an acted_on terminal?
      const episodes = c.map((r) => episodeByRecall.get(r.recall_id ?? ""));
      const landedIdx = episodes.findIndex((ep) => ep?.acted_on === true);
      if (landedIdx === -1) {
        // give-up: no terminal pick → flare, no anchor.
        signals.push({
          type: "flare",
          queries: c.map((r) => r.query ?? ""),
          chain_len: c.length,
          session_id: sid,
          reason: "give_up",
        });
        return;
      }
      const landedRound = landedIdx + 1;
      const terminalMem = episodes[landedIdx]!.memory_id ?? "";
      // whole-chain harvest up to and including the landing round → anchors for
      // the terminal memory, weighted by lateness.
      for (let i = 0; i <= landedIdx; i++) {
        signals.push({
          type: "anchor",
          query: c[i].query ?? "",
          memory_id: terminalMem,
          round: i + 1,
          chain_len: c.length,
          weight: latenessWeight(i + 1, landedRound),
          recall_id: c[i].recall_id ?? "",
          landed_round: landedRound,
        });
      }
      // every PRE-landing recall whose own episode loaded a DIFFERENT memory that
      // then got re-queried past = an on-the-record negative.
      for (let i = 0; i < landedIdx; i++) {
        const ep = episodes[i];
        if (ep && ep.memory_id && ep.memory_id !== terminalMem) {
          signals.push({
            type: "negative",
            query: c[i].query ?? "",
            memory_id: ep.memory_id,
            round: i + 1,
            chain_len: c.length,
            recall_id: c[i].recall_id ?? "",
          });
        }
      }
    };

    let lastTs = 0;
    for (const r of recalls) {
      const ts = new Date(r.ts).getTime();
      if (chain.length && ts - lastTs > CHAIN_GAP_MS) flushChain();
      chain.push(r);
      lastTs = ts;
    }
    flushChain();
  }
  return signals;
}

async function loadEvents(dir: string): Promise<AnyEvent[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  files.sort();
  const out: AnyEvent[] = [];
  for (const f of files) {
    const raw = await readFile(join(dir, f), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AnyEvent);
      } catch {
        // skip malformed
      }
    }
  }
  return out;
}

async function main(): Promise<number> {
  const events = await loadEvents(IN_DIR);
  const signals = extractSignals(events);
  const anchors = signals.filter((s) => s.type === "anchor");
  const negatives = signals.filter((s) => s.type === "negative");
  const flares = signals.filter((s) => s.type === "flare");

  console.log(`# teacher-behavioral (dir=${IN_DIR})`);
  console.log(`events:    ${events.length}`);
  console.log(`anchors:   ${anchors.length}  (far query → terminal pick, lateness-weighted)`);
  console.log(`negatives: ${negatives.length}  (re-query = result failed, on the record)`);
  console.log(`flares:    ${flares.length}  (give-up chains → coverage alert, NOT anchors → #108)`);
  if (events.length === 0) {
    console.log("\n→ no events. The wire has not fired; nothing to teach yet.");
  }

  if (OUT) {
    await writeFile(OUT, signals.map((s) => JSON.stringify(s)).join("\n") + (signals.length ? "\n" : ""), "utf8");
    console.log(`\n[teacher-behavioral] ${signals.length} signals written to ${OUT}`);
  }
  return 0;
}

// Run only as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c));
}
