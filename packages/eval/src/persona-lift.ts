#!/usr/bin/env tsx
/**
 * Simulated-user survival — recall_when lift under realistic query drift (#89).
 *
 * `marginal-lift.ts` answers "does the trigger field help?" with one paraphrase
 * set. This harness asks the sharper, production-shaped question on the SAME
 * control/treatment indexes:
 *
 *   recall_when is written at SAVE time — a prediction of how a future session
 *   will phrase the situation. The query is formed at RECALL time, in that
 *   session's own words. How much of the trigger's lift SURVIVES when the
 *   recall-time query drifts away from the save-time prediction?
 *
 * We model the recall-time query distribution with N simulated user personas
 * (junior/senior/terse/verbose/non-native/…), each phrasing every memory in
 * their own voice. Every query gets a continuous overlap score against the
 * gold memory's recall_when tokens, then we split:
 *
 *   near  = query shares trigger vocabulary (overlap ≥ cut)   — prediction hit
 *   far   = query uses different words (overlap < cut)        — prediction missed
 *   survival = marginal-lift@k(far) / marginal-lift@k(near)
 *
 * survival ≈ 1  -> recall_when generalizes past its own wording (load-bearing).
 * survival ≈ 0  -> the trigger only helps when you already used its words
 *                  (the lift is closer to the circular M0 regime than to real recall).
 *
 * Two integrity guards keep the envelope honest (see __tests__):
 *   - persona DIVERSITY: the N personas must be genuinely distinct voices, not
 *     one voice in N masks (mode collapse would fake a tight envelope).
 *   - overlap SPREAD: diverse users naturally span near↔far, so the gradient is
 *     emergent, not hand-binned.
 *
 * Why simulated, not hand-written paraphrases? In production NOBODY hand-writes
 * the memories (the AI saves them) OR hand-phrases the recall query (the AI
 * forms it). Both ends are model-mediated, so simulated queries are the
 * ecologically faithful test. The retriever is lexical BM25 (no embedding
 * space), so the only contamination risk is trigger-vocabulary leakage — which
 * the overlap score measures directly. See README for the full rationale.
 *
 * IMPORTANT — read before citing a number:
 *   The bundled `fixtures/personas.json` runs against the tiny SYNTHETIC
 *   eval-vault. It proves the harness computes; it is NOT a headline result.
 *   A citable survival number comes from a real vault:
 *     BASTRA_VAULT_PATH=/path npm run personas -- --personas my-personas.json
 *
 * Usage:
 *   npm run personas                          # bundled synthetic vault + personas
 *   npm run personas -- --k 3 --near 0.30     # tune @k and the near/far cut
 *   BASTRA_VAULT_PATH=/v npm run personas -- --personas p.json --out survival.json
 *
 * Exit code: 0 always (a measurement, not a pass/fail gate).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Vault } from "@bastra-recall/core";
import type { Memory } from "@bastra-recall/core";
import { buildIndex, rankOf, TREATMENT_RECALL_WHEN_BOOST } from "./index-config.js";

// ── Persona fixtures ───────────────────────────────────────────

interface PersonaFile {
  /** label -> (memory id -> the query that persona would type for it). */
  personas: Record<string, Record<string, string>>;
}

// ── CLI ────────────────────────────────────────────────────────

interface Args {
  vault: string;
  personas: string;
  out: string | null;
  boost: number;
  k: number;
  near: number;
}

const DEFAULT_VAULT = resolve(import.meta.dirname, "../fixtures/eval-vault");
const DEFAULT_PERSONAS = resolve(import.meta.dirname, "../fixtures/personas.json");

function parseArgs(argv: string[]): Args {
  const args: Args = {
    vault: process.env.BASTRA_VAULT_PATH ?? DEFAULT_VAULT,
    personas: DEFAULT_PERSONAS,
    out: null,
    boost: TREATMENT_RECALL_WHEN_BOOST,
    k: 3,
    near: 0.3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") args.vault = req(argv[++i], "--vault");
    else if (a === "--personas") args.personas = req(argv[++i], "--personas");
    else if (a === "--out") args.out = req(argv[++i], "--out");
    else if (a === "--boost") args.boost = num(argv[++i], "--boost");
    else if (a === "--k") args.k = num(argv[++i], "--k");
    else if (a === "--near") args.near = num(argv[++i], "--near");
    else if (a === "-h" || a === "--help") {
      console.log(
        "persona-lift — simulated-user survival of recall_when\n" +
          "  --vault <path>     vault to index (or BASTRA_VAULT_PATH)\n" +
          "  --personas <path>  personas JSON ({personas:{label:{id:query}}})\n" +
          "  --boost <n>        treatment recall_when weight (default 5)\n" +
          "  --k <n>            Recall@k (default 3)\n" +
          "  --near <0..1>      query↔trigger overlap cut for near/far (default 0.30)\n" +
          "  --out <path>       also write a JSON report",
      );
      process.exit(0);
    } else throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

function req(v: string | undefined, flag: string): string {
  if (!v) throw new Error(`${flag} needs a value`);
  return v;
}
function num(v: string | undefined, flag: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${flag} must be a number`);
  return n;
}

// ── Tokenisation (matches the overlap gate; lexical, BM25-relevant) ──

const STOP = new Set(
  ("a an the to of in on at for and or but with without when how why is are be it its " +
    "into as my me i you your their them they not no than instead while per after before " +
    "does do that this so what which").split(" "),
);
function toks(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t && t.length > 1 && !STOP.has(t)),
  );
}
/** Fraction of the query's content tokens that occur in the trigger tokens. */
function coverage(query: string, trigger: Set<string>): number {
  const q = toks(query);
  if (q.size === 0) return 0;
  let hit = 0;
  for (const t of q) if (trigger.has(t)) hit++;
  return hit / q.size;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Recall counters ────────────────────────────────────────────

interface Run {
  hitK: number;
  hit1: number;
  total: number;
}
const emptyRun = (): Run => ({ hitK: 0, hit1: 0, total: 0 });
function record(run: Run, rank: number, k: number): void {
  run.total++;
  if (rank === 1) run.hit1++;
  if (rank >= 1 && rank <= k) run.hitK++;
}
const recallK = (r: Run): number => (r.total ? r.hitK / r.total : 0);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const signed = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`;

// ── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const file = JSON.parse(readFileSync(args.personas, "utf8")) as PersonaFile;

  const vault = new Vault(args.vault);
  const { loaded, skipped } = await vault.init();
  for (const s of skipped) console.error(`  skipped ${s.path}: ${s.err}`);
  const memories: Memory[] = vault.list().filter((m) => !m.fm.obsolete);
  const known = new Set(memories.map((m) => m.fm.id));
  const triggerToks = new Map<string, Set<string>>();
  for (const m of memories) {
    const t = new Set<string>();
    for (const phrase of m.fm.recall_when) for (const tok of toks(phrase)) t.add(tok);
    triggerToks.set(m.fm.id, t);
  }

  const control = buildIndex(memories, { kind: "control" });
  const treatment = buildIndex(memories, { kind: "treatment", boost: args.boost });

  const overallC = emptyRun(), overallT = emptyRun();
  const nearC = emptyRun(), nearT = emptyRun();
  const farC = emptyRun(), farT = emptyRun();
  const perPersonaT = new Map<string, Run>();
  const unknownIds = new Set<string>();
  let totalQueries = 0;

  for (const [label, byMemory] of Object.entries(file.personas)) {
    const pRun = emptyRun();
    for (const [id, query] of Object.entries(byMemory)) {
      if (!known.has(id)) {
        unknownIds.add(id);
        continue;
      }
      totalQueries++;
      const cRank = rankOf(control.search(query), id);
      const tRank = rankOf(treatment.search(query), id);
      const cov = coverage(query, triggerToks.get(id) ?? new Set());
      const isNear = cov >= args.near;
      record(overallC, cRank, args.k);
      record(overallT, tRank, args.k);
      record(isNear ? nearC : farC, cRank, args.k);
      record(isNear ? nearT : farT, tRank, args.k);
      record(pRun, tRank, args.k);
    }
    perPersonaT.set(label, pRun);
  }

  const liftAll = recallK(overallT) - recallK(overallC);
  const liftNear = recallK(nearT) - recallK(nearC);
  const liftFar = recallK(farT) - recallK(farC);
  const survival = liftNear > 0 ? liftFar / liftNear : NaN;

  // persona-diversity sanity (mean pairwise query Jaccard across shared ids)
  const labels = Object.keys(file.personas);
  const pairSims: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const A = file.personas[labels[i]], B = file.personas[labels[j]];
      const ids = Object.keys(A).filter((id) => id in B);
      if (!ids.length) continue;
      const s = ids.reduce((acc, id) => acc + jaccard(toks(A[id]), toks(B[id])), 0) / ids.length;
      pairSims.push(s);
    }
  }
  const meanSim = pairSims.length ? pairSims.reduce((a, b) => a + b, 0) / pairSims.length : 0;

  // ── report ──
  const L: string[] = [];
  L.push("# recall_when — Simulated-User Survival\n");
  L.push(
    `Vault: **${loaded}** memorys  ·  personas: **${labels.length}**  ·  ` +
      `queries: **${totalQueries}**  ·  boost: **×${args.boost}**  ·  k = **${args.k}**  ·  ` +
      `near/far cut: **${args.near}**\n`,
  );

  L.push("## Lift by recall-time vocabulary drift\n");
  L.push("| query↔trigger | n | control R@" + args.k + " | treatment R@" + args.k + " | marginal lift |");
  L.push("|---|---|---|---|---|");
  L.push(`| **all** | ${overallT.total} | ${pct(recallK(overallC))} | ${pct(recallK(overallT))} | **${signed(liftAll)}** |`);
  L.push(`| near (≥${args.near}) | ${nearT.total} | ${pct(recallK(nearC))} | ${pct(recallK(nearT))} | ${signed(liftNear)} |`);
  L.push(`| far (<${args.near}) | ${farT.total} | ${pct(recallK(farC))} | ${pct(recallK(farT))} | ${signed(liftFar)} |`);
  L.push("");
  L.push(
    `**survival = lift(far) / lift(near) = ${Number.isFinite(survival) ? survival.toFixed(2) : "n/a"}** — ` +
      `the fraction of recall_when's benefit that holds when the recall-time query ` +
      `drifts off the save-time trigger wording.\n`,
  );

  L.push("## Robustness envelope across user personas\n");
  L.push(`Recall@${args.k} (treatment) per simulated user — the spread is the envelope:\n`);
  L.push("| persona | queries | Recall@" + args.k + " |");
  L.push("|---|---|---|");
  const persRecalls: number[] = [];
  for (const [label, r] of perPersonaT) {
    persRecalls.push(recallK(r));
    L.push(`| ${label} | ${r.total} | ${pct(recallK(r))} |`);
  }
  if (persRecalls.length) {
    L.push("");
    L.push(
      `Envelope: **${pct(Math.min(...persRecalls))} – ${pct(Math.max(...persRecalls))}** ` +
        `across ${persRecalls.length} user styles.\n`,
    );
  }

  L.push("## Persona-diversity check\n");
  L.push(
    `Mean pairwise query similarity (token Jaccard): **${meanSim.toFixed(3)}** ` +
      `(${meanSim < 0.35 ? "diverse — envelope is honest" : "HIGH — personas may be mode-collapsed; envelope suspect"}).\n`,
  );

  if (unknownIds.size) {
    L.push(`> ⚠️ ${unknownIds.size} id(s) not in vault (skipped): ${[...unknownIds].join(", ")}\n`);
  }

  const report = L.join("\n");
  console.log(report);

  if (args.out) {
    const json = {
      vault: args.vault,
      vaultSize: loaded,
      boost: args.boost,
      k: args.k,
      nearCut: args.near,
      queries: totalQueries,
      liftAll,
      liftNear,
      liftFar,
      survival,
      personaRecall: Object.fromEntries([...perPersonaT].map(([l, r]) => [l, recallK(r)])),
      meanPairwiseSimilarity: meanSim,
      unknownIds: [...unknownIds],
    };
    writeFileSync(args.out, JSON.stringify(json, null, 2));
    console.error(`\n[persona-lift] JSON written to ${args.out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
