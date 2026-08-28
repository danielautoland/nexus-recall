import { test } from "node:test";
import assert from "node:assert/strict";
import { metricsFor, type CaseResult } from "../src/goldset-run.js";

const row = (over: Partial<CaseResult> = {}): CaseResult => ({
  id: "c1",
  query: "q",
  no_answer: false,
  kind: "descriptive",
  zone: "orbit",
  origin: "user_query",
  lang: "de",
  allowed_depth: 3,
  rank_expected: 1,
  rank_any: 1,
  top_id: "m1",
  top_score: 163.934,
  gold_score: 163.934,
  abstained: false,
  unknown_ids: [],
  top_mode: "hybrid",
  ...over,
});

test("rank 0 means the gold never surfaced and counts nowhere", () => {
  const m = metricsFor([row({ rank_expected: 0, rank_any: 0 })]);
  assert.equal(m.recall_at_1, 0);
  assert.equal(m.recall_at_10, 0);
  assert.equal(m.mrr, 0, "a miss contributes no reciprocal rank");
});

test("the allowed depth comes from the case, not from a global k", () => {
  // Same rank, different labels: one case allows depth 10, the other only 3.
  const deep = metricsFor([row({ rank_expected: 5, allowed_depth: 10 })]);
  const shallow = metricsFor([row({ rank_expected: 5, allowed_depth: 3 })]);
  assert.equal(deep.recall_at_allowed_depth, 1, "rank 5 is inside a depth of 10");
  assert.equal(shallow.recall_at_allowed_depth, 0, "and outside a depth of 3");
  assert.equal(deep.recall_at_3, shallow.recall_at_3, "while Recall@3 does not move with the label");
});

test("acceptable alternatives are scored apart from expected ids (§19)", () => {
  // The expected id is missing; only an acceptable one came back.
  const m = metricsFor([row({ rank_expected: 0, rank_any: 2 })]);
  assert.equal(m.recall_at_3, 0, "expected_ids is the strict metric");
  assert.equal(m.recall_at_3_incl_acceptable, 1, "and the lenient one is reported beside it, never merged");
});

test("MRR is the mean reciprocal rank over the slice", () => {
  const m = metricsFor([row({ rank_expected: 1 }), row({ rank_expected: 4 }), row({ rank_expected: 0 })]);
  assert.equal(m.mrr, Number(((1 + 0.25 + 0) / 3).toFixed(4)));
  assert.equal(m.n, 3);
});
