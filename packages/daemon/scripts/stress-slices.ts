/**
 * The three measurement slices of the stress harness (#2, #8).
 *
 * Split out of eval-stress.ts. Each runner takes a `Recaller` — it neither
 * knows nor cares which arm produced it — and returns a summary the harness
 * prints. The summary types are the contract between the two halves.
 */
import type { Vault } from "@bastra-recall/core";
import { seededShuffle, type Recaller } from "./stress-arm.js";
import { PARAPHRASED_CASES, type ParaphrasedCase } from "./stress-fixtures/paraphrased.js";
import { CROSS_MEMORY_CASES, type CrossMemoryCase } from "./stress-fixtures/cross-memory.js";
import { ANTI_HALLUCINATION_CASES } from "./stress-fixtures/anti-hallucination.js";

// ── Label-shuffle null (M0 gate, #261) ─────────────────────────
//
// The null hypothesis for every gold-labelled slice: keep the queries, keep
// the gold ids, break only the pairing between them. A harness that still
// scores well on permuted labels is not measuring retrieval — it is measuring
// the shape of the gold set, or leaking the answer through the query. The
// null is what makes a headline number readable: 45% means nothing until you
// know whether shuffled labels also score 45%.
//
// Seeded, so the null is reproducible; a null that moves per run cannot be
// cited next to the number it qualifies.

/** Reassigns gold ids across cases, keeping every query and every id in play. */
export function shuffleParaphrasedLabels(cases: readonly ParaphrasedCase[], seed: number): ParaphrasedCase[] {
  const ids = seededShuffle(cases.map((c) => c.id), seed);
  return cases.map((c, i) => ({ ...c, id: ids[i] }));
}

/** Same for the cross slice: the expected SETS move between queries intact. */
export function shuffleCrossLabels(cases: readonly CrossMemoryCase[], seed: number): CrossMemoryCase[] {
  const expected = seededShuffle(cases.map((c) => ({ expected: c.expected, oneHop: c.oneHop })), seed);
  return cases.map((c, i) => ({ ...c, expected: expected[i].expected, oneHop: expected[i].oneHop }));
}

// ── Slice 1: paraphrased ───────────────────────────────────────

export interface ParaphrasedResult {
  goldId: string;
  label: string;
  paraphrase: string;
  rank: number; // 0 = miss
  topId: string;
  topScore: number;
  goldScore: number; // 0 if not in top-10
}

export interface ParaphrasedSummary {
  total: number;
  unknownIds: string[];
  recallAt1: number;
  recallAt3: number;
  mrr: number;
  perMemory: Map<string, { hits: number; tests: number }>;
  rows: ParaphrasedResult[];
  pass: boolean;
}

export async function runParaphrased(
  vault: Vault,
  recall: Recaller,
  cases: readonly ParaphrasedCase[] = PARAPHRASED_CASES,
): Promise<ParaphrasedSummary> {
  const knownIds = new Set(vault.list().map((m) => m.fm.id));
  const unknownIds: string[] = [];
  const rows: ParaphrasedResult[] = [];
  const perMemory = new Map<string, { hits: number; tests: number }>();

  for (const c of cases) {
    if (!knownIds.has(c.id)) {
      unknownIds.push(c.id);
      continue;
    }
    const slot = perMemory.get(c.id) ?? { hits: 0, tests: 0 };
    for (const p of c.paraphrases) {
      const hits = await recall(p, { k: 10 });
      const rank = hits.findIndex((h) => h.id === c.id);
      const goldHit = hits[rank];
      rows.push({
        goldId: c.id,
        label: c.label,
        paraphrase: p,
        rank: rank === -1 ? 0 : rank + 1,
        topId: hits[0]?.id ?? "(none)",
        topScore: hits[0]?.score ?? 0,
        goldScore: goldHit?.score ?? 0,
      });
      slot.tests++;
      if (rank !== -1 && rank < 3) slot.hits++;
    }
    perMemory.set(c.id, slot);
  }

  const total = rows.length;
  const top1 = rows.filter((r) => r.rank === 1).length;
  const top3 = rows.filter((r) => r.rank >= 1 && r.rank <= 3).length;
  const mrr = total === 0
    ? 0
    : rows.reduce((acc, r) => acc + (r.rank > 0 ? 1 / r.rank : 0), 0) / total;

  const recallAt3 = total === 0 ? 0 : top3 / total;
  return {
    total,
    unknownIds,
    recallAt1: total === 0 ? 0 : top1 / total,
    recallAt3,
    mrr,
    perMemory,
    rows,
    pass: recallAt3 >= 0.7,
  };
}

// ── Slice 2: cross-memory ──────────────────────────────────────

export interface CrossResult {
  query: string;
  expected: string[];
  found: string[]; // ids in top-k order
  missing: string[];
  oneHopExpected: string[];
  oneHopFound: string[];
  oneHopMissing: string[];
  topScore: number;
  pass: boolean;
}

export interface CrossSummary {
  total: number;
  passed: number;
  rows: CrossResult[];
  recallAtK: number;
  pass: boolean;
}

export async function runCrossMemory(
  vault: Vault,
  recall: Recaller,
  cases: readonly CrossMemoryCase[] = CROSS_MEMORY_CASES,
): Promise<CrossSummary> {
  const knownIds = new Set(vault.list().map((m) => m.fm.id));
  const rows: CrossResult[] = [];

  for (const c of cases) {
    const validExpected = c.expected.filter((id) => knownIds.has(id));
    const validOneHop = (c.oneHop ?? []).filter((id) => knownIds.has(id));
    const k = Math.max(4, validExpected.length);

    const directHits = await recall(c.query, { k });
    const foundDirect = directHits.map((h) => h.id);
    const missing = validExpected.filter((id) => !foundDirect.includes(id));

    let oneHopFound: string[] = [];
    if (validOneHop.length > 0) {
      const hopHits = await recall(c.query, { k, expand_hops: 1 });
      const hopIds = hopHits.map((h) => h.id);
      oneHopFound = validOneHop.filter((id) => hopIds.includes(id));
    }
    const oneHopMissing = validOneHop.filter((id) => !oneHopFound.includes(id));

    const pass = missing.length === 0 && oneHopMissing.length === 0;
    rows.push({
      query: c.query,
      expected: validExpected,
      found: foundDirect,
      missing,
      oneHopExpected: validOneHop,
      oneHopFound,
      oneHopMissing,
      topScore: directHits[0]?.score ?? 0,
      pass,
    });
  }

  const passed = rows.filter((r) => r.pass).length;
  const totalExpected = rows.reduce(
    (acc, r) => acc + r.expected.length + r.oneHopExpected.length,
    0,
  );
  const totalFound = rows.reduce(
    (acc, r) =>
      acc +
      (r.expected.length - r.missing.length) +
      (r.oneHopExpected.length - r.oneHopMissing.length),
    0,
  );
  const recallAtK = totalExpected === 0 ? 0 : totalFound / totalExpected;
  return {
    total: rows.length,
    passed,
    rows,
    recallAtK,
    pass: passed === rows.length,
  };
}

// ── Slice 3: anti-hallucination ────────────────────────────────

export interface AntiResult {
  query: string;
  topScore: number;
  topId: string;
  note: string;
  underCutoff: boolean;
}

export interface AntiSummary {
  total: number;
  underCutoff: number;
  cutoff: number;
  median: number;
  rows: AntiResult[];
  histogram: Map<string, number>;
  pass: boolean;
}

export async function runAntiHallucination(
  vault: Vault,
  recall: Recaller,
  cutoff: number,
): Promise<AntiSummary> {
  const rows: AntiResult[] = [];
  for (const c of ANTI_HALLUCINATION_CASES) {
    const hits = await recall(c.query, { k: 3 });
    const top = hits[0];
    const topScore = top?.score ?? 0;
    rows.push({
      query: c.query,
      topScore,
      topId: top?.id ?? "(none)",
      note: c.note ?? "",
      underCutoff: topScore < cutoff,
    });
  }

  const sortedScores = [...rows.map((r) => r.topScore)].sort((a, b) => a - b);
  const median = sortedScores.length === 0
    ? 0
    : sortedScores[Math.floor(sortedScores.length / 2)] ?? 0;

  // Bucket histogram: 0-30, 30-60, 60-100, 100-150, >=150.
  const histogram = new Map<string, number>([
    ["0-30", 0],
    ["30-60", 0],
    ["60-100", 0],
    ["100-150", 0],
    [">=150", 0],
  ]);
  for (const r of rows) {
    if (r.topScore < 30) histogram.set("0-30", (histogram.get("0-30") ?? 0) + 1);
    else if (r.topScore < 60)
      histogram.set("30-60", (histogram.get("30-60") ?? 0) + 1);
    else if (r.topScore < 100)
      histogram.set("60-100", (histogram.get("60-100") ?? 0) + 1);
    else if (r.topScore < 150)
      histogram.set("100-150", (histogram.get("100-150") ?? 0) + 1);
    else histogram.set(">=150", (histogram.get(">=150") ?? 0) + 1);
  }

  const underCutoff = rows.filter((r) => r.underCutoff).length;
  // Pass when the *median* is under the cutoff. Individual outliers are
  // expected with BM25 + fuzzy + prefix matching on short generic tokens.
  return {
    total: rows.length,
    underCutoff,
    cutoff,
    median,
    rows,
    histogram,
    pass: median < cutoff,
  };
}
