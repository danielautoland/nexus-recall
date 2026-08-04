/**
 * What `RRF_K` actually buys, pinned as behaviour rather than as a number.
 *
 * The damping constant decides how much a rank is worth against mere presence
 * in both arms. At the TREC default of 60 the denominator swamps the rank on
 * pools this size: a memory sitting at rank 20 in BOTH arms outranked a memory
 * at rank 1 in one. #302 wrote that arithmetic out for the score bands; it is a
 * ranking cost too, and the fusion sweep in
 * `packages/eval/src/pool-depth.ts` measured it — hit@3 21→25 and hit@5 22→26
 * over 37 held-out paraphrases, from nothing but this constant.
 *
 * Runner: node --import tsx --test packages/core/__tests__/rrf-damping.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseRRF, RRF_K } from "../src/index.js";

/** bm25 arm: `solo` first, `pair` at rank 20. vector arm: `pair` at rank 20. */
function twoArmsWithADeepPair(): { bm25: string[]; vector: string[] } {
  const filler = (p: string): string[] => Array.from({ length: 18 }, (_, i) => `${p}${i}`);
  return {
    bm25: ["solo", ...filler("b"), "pair"],
    vector: [...filler("v"), "x", "pair"],
  };
}

test("a rank-1 hit in one arm beats a rank-20 hit in both", () => {
  const { bm25, vector } = twoArmsWithADeepPair();
  const fused = fuseRRF(bm25, vector);
  const solo = fused.get("solo")!;
  const pair = fused.get("pair")!;

  assert.equal(solo.rank_bm25, 1);
  assert.equal(solo.rank_vector, null);
  assert.equal(pair.rank_bm25, 20);
  assert.equal(pair.rank_vector, 20);

  assert.ok(
    solo.score > pair.score,
    `rank 1 in one arm (${solo.score}) must outrank rank 20 in both (${pair.score}) — ` +
      "otherwise the fusion is scoring arm agreement, not relevance",
  );
});

test("the TREC default is what inverted it — same lists, k=60", () => {
  const { bm25, vector } = twoArmsWithADeepPair();
  const old = fuseRRF(bm25, vector, 60);
  assert.ok(
    old.get("pair")!.score > old.get("solo")!.score,
    "documents the regression this constant fixes: at k=60 the deep pair wins",
  );
});

test("RRF_K stays small enough for the pools recall actually returns", () => {
  // k has to be commensurate with the pool. Hooks ask for 3-10 hits and the
  // deepest caller asks for 50; a k above that band reproduces the inversion
  // above no matter what the two arms found.
  assert.ok(RRF_K >= 1 && RRF_K <= 20, `RRF_K=${RRF_K} is outside the measured band`);
});
