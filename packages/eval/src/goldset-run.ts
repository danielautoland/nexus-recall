#!/usr/bin/env tsx
/**
 * The M0 baseline over the gold set (#262, §18.1).
 *
 * The stress harness in `packages/daemon/scripts/eval-stress.ts` measures the
 * repo fixtures — the very `PARAPHRASED_CASES` §19 rules out, because they are
 * paraphrases of the answer. Nothing consumed the gold set itself, so this is
 * the missing half: it takes the labelled cases and reports what retrieval does
 * on them.
 *
 * Every scoring rule is fixed by the label, not by this file:
 *
 *   - a hit is `expected_ids` in the ranking; `acceptable_alternatives` are
 *     scored separately, because §19 keeps the two apart on purpose;
 *   - how deep a hit still counts comes from the case's own
 *     `allowed_retrieval_depth`;
 *   - a `no_answer` case is correct when nothing clears the score floor;
 *   - a `probe_group` case is reported beside the set, never inside it.
 *
 * There is exactly one free constant here, `PRODUCTION_K`, and it is the k the
 * product actually uses. Widening it would change what damping and the re-sort
 * see, so the rank is measured at the production pool and nowhere else.
 *
 * Usage:
 *   BASTRA_VAULT_PATH=/path/to/vault npx tsx src/goldset-run.ts \
 *     --gold ~/.bastra/eval-goldset/gold-blind.json \
 *     --gold ~/.bastra/eval-goldset/gold-tel-1.json \
 *     --hybrid --out ~/.bastra/eval-runs/<dir>/results.json
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  EmbeddingIndex,
  OllamaEmbeddingProvider,
  SearchIndex,
  Vault,
  isWeakResult,
  hitTitleMatches,
  type RecallHit,
} from "@bastra-recall/core";
import { checkGoldCases, type GoldCase } from "./goldset.js";

/** The k the product serves. Ranks are measured here and nowhere else. */
const PRODUCTION_K = 10;
/** Documented default of BASTRA_RECALL_FLOOR — below it a hit is not shown. */
const SCORE_FLOOR = 30;
/** Bound on a cold-store backfill; a stuck provider must fail, not hang. */
const BACKFILL_TIMEOUT_MS = 15 * 60 * 1000;

type Recaller = (query: string) => Promise<RecallHit[]>;

/**
 * What the best-anchored served hit anchors ON.
 *
 * `weak_result` reports THAT nothing anchored; this reports WHAT anchored, and
 * the two are the same measurement from opposite ends: on the hybrid path with
 * a non-empty pool, `anchor === "none"` is exactly `weak_result === true`. The
 * baseline run measured 0/372 weak results on answerable cases and could not
 * say why — nothing recorded which of the two anchors was carrying them.
 */
export type AnchorSource = "recall_when" | "title" | "both" | "none";

/**
 * Walk the served list from the top and report the anchors of the FIRST hit
 * that anchors at all — the best-anchored hit, since the list is ranked.
 *
 * Uses `hitTitleMatches` from core, the same building block `isWeakResult` uses;
 * a second title-matching rule here would drift from the one that ships and the
 * two answers would stop being about the same predicate.
 *
 * An empty pool yields `"none"` while `isWeakResult` yields false — it reports
 * "answered with noise", and nothing served is not that. The distinction is
 * academic on this set (0 of 432 cases abstained) but the field must not claim
 * otherwise.
 */
function anchorOf(hits: RecallHit[]): AnchorSource {
  for (const h of hits) {
    const byRecallWhen = h.matched_recall_when === true;
    const byTitle = hitTitleMatches(h);
    if (byRecallWhen && byTitle) return "both";
    if (byRecallWhen) return "recall_when";
    if (byTitle) return "title";
  }
  return "none";
}

export interface CaseResult {
  id: string;
  query: string;
  no_answer: boolean;
  probe_group?: string;
  kind: string;
  zone: string;
  origin: string;
  lang: string;
  allowed_depth: number;
  /** 1-based rank of the first expected id; 0 = not in the production pool. */
  rank_expected: number;
  /** Same for expected ∪ acceptable. */
  rank_any: number;
  top_id: string;
  top_score: number;
  /** Highest score of any expected id, 0 when it never surfaced. */
  gold_score: number;
  /** Nothing cleared the floor — the engine effectively abstained. */
  abstained: boolean;
  /**
   * No served hit anchors lexically — neither `matched_recall_when` nor a title
   * match. The registered follow-up for the M1 `false_abstention` tolerance
   * (registrations/m1-tolerances.json): the score floor cannot fire on the
   * hybrid path, so the abstention metric is pinned at zero, and this predicate
   * is what a future gate would be built on. Recorded, never scored — this run
   * is a measurement, not a gate.
   *
   * The same `isWeakResult` the daemon serves with, imported from core. A
   * second implementation here would be the drift its docstring warns about.
   */
  weak_result: boolean;
  /**
   * Which anchor carried the best-anchored served hit. Turns "weak_result never
   * fires on answerable cases" from an interpretation into a measurement: the
   * distribution over `recall_when` / `title` / `both` says what is holding the
   * anchor, and `none` is the weak result itself.
   */
  anchor: AnchorSource;
  /**
   * Gold ids the vault no longer holds. A gate failure, never a miss — and
   * since #432 the gate actually fires: {@link unknownGoldIds} stops the run
   * before anything is scored, so on a completed run this list is empty. It
   * stays in the row because that is where the evidence belongs.
   */
  unknown_ids: string[];
  /**
   * Which arm produced the top hit. The M0 gate is "no silent arm fallback":
   * a run labelled hybrid whose hits are all `bm25` is a mislabelled run, and
   * only the recorded mode can prove otherwise.
   */
  top_mode: string;
}

const hit = (r: CaseResult, k: number, any = false): boolean => {
  const rank = any ? r.rank_any : r.rank_expected;
  return rank >= 1 && rank <= k;
};

export interface SliceMetrics {
  n: number;
  recall_at_1: number;
  recall_at_3: number;
  recall_at_10: number;
  /** Hit inside the case's own allowed_retrieval_depth (capped at k=10). */
  recall_at_allowed_depth: number;
  /** Same, counting acceptable_alternatives as correct too. */
  recall_at_3_incl_acceptable: number;
  mrr: number;
}

const ratio = (n: number, d: number): number => (d === 0 ? 0 : Number((n / d).toFixed(4)));

export function metricsFor(rows: CaseResult[]): SliceMetrics {
  const n = rows.length;
  return {
    n,
    recall_at_1: ratio(rows.filter((r) => hit(r, 1)).length, n),
    recall_at_3: ratio(rows.filter((r) => hit(r, 3)).length, n),
    recall_at_10: ratio(rows.filter((r) => hit(r, PRODUCTION_K)).length, n),
    recall_at_allowed_depth: ratio(
      rows.filter((r) => hit(r, Math.min(r.allowed_depth, PRODUCTION_K))).length,
      n,
    ),
    recall_at_3_incl_acceptable: ratio(rows.filter((r) => hit(r, 3, true)).length, n),
    mrr: n === 0 ? 0 : Number((rows.reduce((a, r) => a + (r.rank_expected > 0 ? 1 / r.rank_expected : 0), 0) / n).toFixed(4)),
  };
}

function groupBy(rows: CaseResult[], key: (r: CaseResult) => string): Record<string, SliceMetrics> {
  const out: Record<string, CaseResult[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, metricsFor(v)]));
}

async function attachHybrid(vault: Vault, search: SearchIndex, vaultPath: string): Promise<{
  label: string; vectors: number; cleanup: () => Promise<void>;
}> {
  const provider = new OllamaEmbeddingProvider({
    baseURL: process.env.BASTRA_OLLAMA_URL ?? "http://localhost:11434",
    model: process.env.BASTRA_EMBEDDING_MODEL ?? "embeddinggemma",
    keepAlive: "10m",
  });
  const tmpRoot = await mkdtemp(join(tmpdir(), "bastra-goldset-hybrid-"));
  const persistPath = join(tmpRoot, "embeddings.json");
  const cleanup = (): Promise<void> => rm(tmpRoot, { recursive: true, force: true });

  // A measurement must not mutate what it measures: work on a COPY of the
  // production store, never the store itself.
  let hadStore = false;
  try {
    await copyFile(join(vaultPath, ".bastra", "embeddings.json"), persistPath);
    hadStore = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") { await cleanup(); throw e; }
  }
  // Probe first: EmbeddingIndex.start() swallows provider failures and retries,
  // so an unreachable provider would surface as a fifteen-minute hang.
  try {
    await provider.embed(["probe"]);
  } catch (e) {
    await cleanup();
    throw new Error(`--hybrid: embedding provider unreachable: ${(e as Error).message}`);
  }

  const emb = new EmbeddingIndex(vault, provider, persistPath);
  await emb.start();
  const want = vault.size();
  const atStart = emb.size();
  const deadline = Date.now() + BACKFILL_TIMEOUT_MS;
  let loaded = atStart;
  while (loaded < want && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const now = emb.size();
    if (now !== loaded) console.error(`[goldset-run] embedding ${now}/${want}…`);
    loaded = now;
  }
  if (loaded < want) {
    emb.stop(); await cleanup();
    throw new Error(`--hybrid: only ${loaded}/${want} memories carry a vector — a partial arm is not a measurement.`);
  }
  search.useEmbeddings(emb);
  if (!search.hasEmbeddings()) {
    emb.stop(); await cleanup();
    throw new Error("--hybrid: useEmbeddings() did not take effect — refusing to report BM25 as hybrid.");
  }
  return {
    label: `Hybrid (BM25 + Vector RRF) · ${provider.id} · store ${hadStore ? "copied from vault" : "embedded fresh"}`
      + (loaded > atStart ? ` · ${loaded - atStart} backfilled` : ""),
    vectors: loaded,
    cleanup: async () => { emb.stop(); await cleanup(); },
  };
}

/** Deterministic PRNG (mulberry32) so the control arm does not move between runs. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The floor every real arm must clear: a random ranking of real ids. Without
 * it a Recall@3 has no scale — nobody can say whether it is retrieval or the
 * shape of the gold set.
 */
function controlRecaller(ids: string[], seed: number): Recaller {
  let n = 0;
  return async (_q) => {
    const rnd = seededRandom(seed + n++);
    const pool = [...ids];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, PRODUCTION_K).map((id, i) => ({ id, score: 100 - i } as RecallHit));
  };
}

async function scoreCases(
  cases: GoldCase[],
  recall: Recaller,
  knownIds: Set<string>,
  /** Whether THIS recaller is the full hybrid path — `isWeakResult` is defined
   *  only there (in BM25-only mode the score is a real BM25 quantity and the
   *  floor already does the job). False for the random control. */
  hybridActive: boolean,
): Promise<CaseResult[]> {
  const rows: CaseResult[] = [];
  for (const c of cases) {
    const unknown = [...c.expected_ids, ...c.acceptable_alternatives].filter((i) => !knownIds.has(i));
    const hits = await recall(c.query);
    const above = hits.filter((h) => h.score >= SCORE_FLOOR);
    const exp = new Set(c.expected_ids);
    const any = new Set([...c.expected_ids, ...c.acceptable_alternatives]);
    const rExp = above.findIndex((h) => exp.has(h.id));
    const rAny = above.findIndex((h) => any.has(h.id));
    rows.push({
      id: c.id,
      query: c.query,
      no_answer: c.no_answer,
      ...(c.probe_group ? { probe_group: c.probe_group } : {}),
      kind: c.kind,
      zone: c.expected_zone,
      origin: c.origin_type,
      lang: c.lang,
      allowed_depth: c.allowed_retrieval_depth,
      rank_expected: rExp + 1,
      rank_any: rAny + 1,
      top_id: above[0]?.id ?? "(none)",
      top_score: above[0]?.score ?? 0,
      gold_score: rExp === -1 ? 0 : above[rExp].score,
      abstained: above.length === 0,
      // On the SERVED pool, like the daemon: `above` is what clears the floor,
      // and `abstained` is measured on the same list two lines up.
      weak_result: isWeakResult(above, hybridActive),
      anchor: anchorOf(above),
      unknown_ids: unknown,
      top_mode: above[0]?.mode ?? "(none)",
    });
  }
  return rows;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The gold schema this runner grades. Another version is a different dataset. */
export const GOLD_SCHEMA_VERSION = 1;

/**
 * Read the gold files and refuse anything the measurement cannot stand on.
 *
 * The runner used to cast the parsed JSON straight to `GoldCase[]` and check
 * duplicate ids and nothing else (#434). But a run grades the FILE, not its
 * creation history: a case edited after the authoring pipeline signed it off,
 * a truthy typo in `probe_group` — which silently drops the case out of the
 * main denominator — or a file from another schema would all have been measured
 * as if they had passed §19. `checkGoldCases` is the authoring pipeline's own
 * rule set, applied here on purpose so the two cannot drift.
 */
export function loadGoldFiles(paths: string[]): { cases: GoldCase[]; sources: Record<string, number> } {
  const cases: GoldCase[] = [];
  const sources: Record<string, number> = {};
  for (const p of paths) {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { schema_version?: number; cases?: GoldCase[] };
    if (parsed.schema_version !== GOLD_SCHEMA_VERSION) {
      throw new Error(
        `${p}: gold schema_version ${JSON.stringify(parsed.schema_version)} — this runner grades version ${GOLD_SCHEMA_VERSION}`,
      );
    }
    if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) throw new Error(`${p}: holds no cases`);
    // The source map keys by file name and two directories can hold the same
    // one; overwriting an entry would understate the dataset in the artifact.
    const name = basename(p);
    if (name in sources) {
      throw new Error(`two gold files are named \`${name}\` — the source map cannot tell them apart`);
    }
    sources[name] = parsed.cases.length;
    cases.push(...parsed.cases);
  }
  const issues = checkGoldCases(cases);
  if (issues.length) {
    for (const i of issues) console.error(`[goldset-run] gold ${i.where}: ${i.problem}`);
    throw new Error(
      `${issues.length} gold case(s) violate §19 — a run grades the file, not its history`
        + ` (first: ${issues[0].where}: ${issues[0].problem})`,
    );
  }
  return { cases, sources };
}

/**
 * Gold ids the vault no longer holds, deduplicated and sorted (#432).
 *
 * `CaseResult.unknown_ids` always called a missing gold id a gate failure and
 * never a miss, but the runner scored the case anyway: the expected id got rank
 * 0, the row entered every aggregate, and the command exited successfully with
 * depressed recall. Collected before anything is scored, so the caller can stop
 * instead of publishing a stale label as a retrieval result.
 */
export function unknownGoldIds(cases: GoldCase[], knownIds: ReadonlySet<string>): string[] {
  const missing = new Set<string>();
  for (const c of cases) {
    for (const id of [...c.expected_ids, ...c.acceptable_alternatives]) {
      if (!knownIds.has(id)) missing.add(id);
    }
  }
  return [...missing].sort();
}

/**
 * The dataset identity a run is cited by (#430).
 *
 * Hashing the source map and the sorted case ids let two materially different
 * evaluations share one identity: rewriting a query or relabelling a case while
 * keeping its id produced the same hash. So the hash covers everything that
 * decides WHAT is measured — the query, both id lists, the no-answer and probe
 * classification, the allowed depth and every reporting axis — and nothing that
 * only records who wrote the label down. Sorted by id, so file order cannot
 * move it.
 */
export function datasetHash(sources: Record<string, number>, cases: GoldCase[]): string {
  const names = Object.keys(sources).sort().map((n) => `${n}:${sources[n]}`).join(",");
  const canonical = [...cases]
    .sort((a, b) => a.id.localeCompare(b.id))
    // JSON, not a joined string: a query may carry the separator itself, and
    // two different datasets must not be able to collide by punctuation.
    .map((c) => JSON.stringify([
      c.id,
      c.query,
      [...c.expected_ids].sort().join(","),
      [...c.acceptable_alternatives].sort().join(","),
      String(c.no_answer),
      c.probe_group ?? "",
      String(c.allowed_retrieval_depth),
      c.kind,
      c.expected_zone,
      c.origin_type,
      c.lang,
      String(c.has_identifier),
      c.scope ?? "",
      c.time_view ?? "",
      String(c.correct_answer_is_non_application ?? false),
    ]))
    .join("\n");
  return sha256(`${names}\n${canonical}`);
}

/**
 * §18.1 wants every run citable: code, git, vault, model, config and dataset
 * hash, next to the raw output and the command line. A run whose artifact
 * depends on an uncommitted helper is not reproducible, so this lives here.
 */
function gitState(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return "not-a-git-checkout";
  }
}

function hashCode(): string {
  const here = import.meta.dirname;
  return sha256(["goldset-run.ts", "goldset.ts"]
    .map((f) => readFileSync(join(here, f), "utf8"))
    .join("\n"));
}

interface Args { gold: string[]; out: string; hybrid: boolean; seed: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { gold: [], out: "", hybrid: false, seed: 20260828 };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--gold") a.gold.push(argv[++i] ?? "");
    else if (f === "--out") a.out = argv[++i] ?? "";
    else if (f === "--hybrid") a.hybrid = true;
    else if (f === "--seed") a.seed = Number(argv[++i]);
    else throw new Error(`unknown flag: ${f}`);
  }
  if (!a.gold.length) throw new Error("--gold is required (repeatable)");
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const vaultPath = process.env.BASTRA_VAULT_PATH;
  if (!vaultPath) throw new Error("BASTRA_VAULT_PATH is required");

  const { cases, sources } = loadGoldFiles(args.gold);

  const vault = new Vault(vaultPath);
  await vault.init();
  const search = new SearchIndex(vault);
  // Without start() the lexical index holds zero documents: BM25 returns
  // nothing, the fusion runs one-armed on vectors, and the run reports itself
  // as hybrid anyway. That is the silent arm fallback the M0 gate forbids, so
  // the document count is asserted below rather than trusted.
  search.start();
  if (search.size() !== vault.size()) {
    throw new Error(`lexical index holds ${search.size()} of ${vault.size()} memories — the BM25 arm would be blind.`);
  }
  const knownIds = new Set(vault.list().map((m) => String(m.fm.id)));
  // A gold id the vault no longer holds is a stale label, and scoring it would
  // report the staleness as a retrieval miss (#432). Stop before the measurement
  // rather than publish a depressed number under a successful exit code.
  const unknown = unknownGoldIds(cases, knownIds);
  if (unknown.length) {
    throw new Error(
      `${unknown.length} gold id(s) are not in the vault — a gate failure, never a miss: ${unknown.join(", ")}`,
    );
  }

  let armLabel = "BM25 only";
  let cleanup: (() => Promise<void>) | null = null;
  let vectors = 0;
  if (args.hybrid) {
    const arm = await attachHybrid(vault, search, vaultPath);
    armLabel = arm.label; vectors = arm.vectors; cleanup = arm.cleanup;
  }

  // Never report BM25 under a hybrid label: the hybrid path is taken only when
  // the vector arm is actually attached, and --hybrid aborts above if it is not.
  const recaller: Recaller = search.hasEmbeddings()
    ? (q) => search.recallHybrid(q, { k: PRODUCTION_K })
    : async (q) => search.recall(q, { k: PRODUCTION_K });

  const hybridActive = search.hasEmbeddings();
  const started = Date.now();
  const main = await scoreCases(cases, recaller, knownIds, hybridActive);
  const mainMs = Date.now() - started;
  const control = await scoreCases(cases, controlRecaller([...knownIds], args.seed), knownIds, false);
  await cleanup?.();

  // Split the set the way §19 asks for it. Probes never enter the denominator.
  const probes = main.filter((r) => r.probe_group);
  const real = main.filter((r) => !r.probe_group);
  const answerable = real.filter((r) => !r.no_answer);
  const noAnswer = real.filter((r) => r.no_answer);
  const ctrlAnswerable = control.filter((r) => !r.probe_group && !r.no_answer);

  const results = {
    schema_version: 1,
    run_date: new Date().toISOString(),
    arm: armLabel,
    vectors,
    production_k: PRODUCTION_K,
    score_floor: SCORE_FLOOR,
    seed: args.seed,
    sources,
    counts: {
      cases_in_files: main.length,
      probes: probes.length,
      main_denominator: real.length,
      answerable: answerable.length,
      no_answer: noAnswer.length,
    },
    unknown_gold_ids: [...new Set(real.flatMap((r) => r.unknown_ids))],
    answerable: metricsFor(answerable),
    control_arm: metricsFor(ctrlAnswerable),
    by_kind: groupBy(answerable, (r) => r.kind),
    by_zone: groupBy(answerable, (r) => r.zone),
    by_origin: groupBy(answerable, (r) => r.origin),
    by_lang: groupBy(answerable, (r) => r.lang),
    probe_arm: {
      by_group: groupBy(probes, (r) => r.probe_group ?? "-"),
      abstained: probes.filter((r) => r.abstained).length,
      n: probes.length,
    },
    abstention: {
      // Raw counts. No tolerance verdict here — M1 owns that (§18.2).
      no_answer_cases: noAnswer.length,
      correctly_abstained: noAnswer.filter((r) => r.abstained).length,
      answered_anyway: noAnswer.filter((r) => !r.abstained).length,
      answerable_cases: answerable.length,
      false_abstention: answerable.filter((r) => r.abstained).length,
      relevant_loss: answerable.filter((r) => r.rank_expected === 0).length,
    },
    arm_modes: main.reduce<Record<string, number>>((a, r) => {
      a[r.top_mode] = (a[r.top_mode] ?? 0) + 1;
      return a;
    }, {}),
    duration_ms: { main_arm: mainMs },
    rows: main,
  };

  const manifest = {
    run_date: results.run_date,
    vault_path: vaultPath,
    vault_size: vault.size(),
    provider: armLabel,
    command: `BASTRA_VAULT_PATH=<vault> npx tsx src/goldset-run.ts ${process.argv.slice(2).join(" ")}`,
    seed: args.seed,
    hashes: {
      code: hashCode(),
      git: gitState(),
      vault: sha256(vault.list().map((m) => `${String(m.fm.id)} ${String(m.fm.updated ?? "")}`).sort().join("\n")),
      model: sha256(armLabel),
      config: sha256(JSON.stringify({ k: PRODUCTION_K, floor: SCORE_FLOOR, hybrid: args.hybrid })),
      dataset: datasetHash(sources, cases),
    },
  };
  const day = manifest.run_date.slice(0, 10);
  const short = sha256(JSON.stringify(manifest.hashes) + manifest.run_date).slice(0, 12);
  const dir = join(process.env.BASTRA_EVAL_RUNS_DIR ?? join(homedir(), ".bastra", "eval-runs"), `${day}-${short}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const lines = [
    `[goldset-run] ${real.length} cases (+${probes.length} probes) · arm: ${armLabel}`,
    `[goldset-run] answerable: ${JSON.stringify(results.answerable)}`,
    `[goldset-run] control:    ${JSON.stringify(results.control_arm)}`,
    `[goldset-run] abstention: ${JSON.stringify(results.abstention)}`,
  ];
  for (const l of lines) console.error(l);

  const w = (name: string, body: string): void =>
    writeFileSync(join(dir, name), body, { mode: 0o600 });
  w("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  w("results.json", JSON.stringify(results, null, 2) + "\n");
  w("stdout.txt", "");
  w("stderr.txt", lines.join("\n") + "\n");
  w("command.txt", manifest.command + "\n");
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(results, null, 2) + "\n", { mode: 0o600 });
  }
  console.error(`[goldset-run] run artifact: ${dir}`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((e: Error) => {
    console.error(`[goldset-run] FATAL: ${e.message}`);
    process.exit(1);
  });
}
