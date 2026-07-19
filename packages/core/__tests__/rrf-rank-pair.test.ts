/**
 * Tests for the RRF rank pair exposed by `fuseRRF` (#230).
 *
 * The hybrid recall score is a RANK quantity, not a similarity: `fuseRRF` sums
 * `1/(k + rank)` across the BM25 and vector arms, and `recallHybrid` scales the
 * result by ×5000 into a BM25-looking range. This test pins that the fused entry
 * carries the per-arm rank pair (1-based, null when an arm did not return the
 * hit) alongside the raw RRF value, so a caller can decompose any score — and it
 * pins the two structural anchors from the field report: rank 1 in both arms is
 * the ceiling (≈163.934), rank 1 in one arm only is ≈81.967.
 *
 * Runner: node --import tsx --test packages/core/__tests__/rrf-rank-pair.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseRRF } from "../src/index.js";

const K = 60;
const rrf = (rank: number): number => 1 / (K + rank); // rank is 1-based

test("fuseRRF: 1-based rank pair per arm, null when an arm did not return the hit", () => {
  // bm25 order: a, b, c   |   vector order: b, x
  const fused = fuseRRF(["a", "b", "c"], ["b", "x"]);

  const a = fused.get("a")!;
  assert.equal(a.rank_bm25, 1, "a is first in the bm25 arm");
  assert.equal(a.rank_vector, null, "a is absent from the vector arm");
  assert.ok(Math.abs(a.score - rrf(1)) < 1e-12, "a score is a single-arm RRF value");

  const b = fused.get("b")!;
  assert.equal(b.rank_bm25, 2, "b is second in the bm25 arm");
  assert.equal(b.rank_vector, 1, "b is first in the vector arm");
  assert.ok(Math.abs(b.score - (rrf(2) + rrf(1))) < 1e-12, "b score sums both arms");

  const c = fused.get("c")!;
  assert.equal(c.rank_bm25, 3);
  assert.equal(c.rank_vector, null);

  const x = fused.get("x")!;
  assert.equal(x.rank_bm25, null, "x is absent from the bm25 arm");
  assert.equal(x.rank_vector, 2, "x is second in the vector arm");
});

test("fuseRRF: raw value is the sum that ×5000 turns into the reported score", () => {
  const fused = fuseRRF(["only"], ["only"]);
  const e = fused.get("only")!;
  // raw is the unscaled RRF sum; recallHybrid multiplies it by 5000 for `score`.
  assert.ok(Math.abs(e.score - 2 * rrf(1)) < 1e-12);
});

test("fuseRRF: structural anchors — rank1+rank1 ceiling ≈163.934, one-arm ≈81.967", () => {
  const both = fuseRRF(["top"], ["top"]).get("top")!;
  assert.ok(Math.abs(both.score * 5000 - 163.934) < 0.01, "rank 1 in both arms is the ceiling");

  const oneArm = fuseRRF(["solo"], []).get("solo")!;
  assert.equal(oneArm.rank_vector, null);
  assert.ok(Math.abs(oneArm.score * 5000 - 81.967) < 0.01, "rank 1 in a single arm sits near 82");
});
