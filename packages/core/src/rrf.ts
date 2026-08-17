/**
 * The two RRF constants, in a leaf of their own.
 *
 * They used to live in `embeddings.ts` next to `fuseRRF`, which is where they
 * belong conceptually — but that module pulls the whole provider/cache stack,
 * and the constants are two numbers. Every hook CLI that only needs them to
 * word a band correctly (#302) was paying for the stack: measured, importing
 * `embeddings.js` costs ~12ms of process start against ~1ms for a dependency-
 * free leaf, on a lane whose whole budget is 200ms (#305).
 *
 * `embeddings.ts` re-exports both, so every existing import keeps working and
 * `fuseRRF` still sits beside the constants it uses.
 *
 * NOTE: nothing here may grow an import. The value of this file is that it has
 * none — a single dependency would put the stack back on the hot path.
 */

/**
 * RRF's damping constant. Was 60 — the TREC number, chosen for runs of a
 * thousand documents where rank 40 and rank 41 really are interchangeable. A
 * recall pool here is 5 to 50, and at k=60 the denominator swamps the rank: a
 * hit at rank 40 in both arms scores above a hit at rank 1 in one. That is the
 * arithmetic #302 wrote out, and it is a ranking cost as well as a banding one.
 *
 * Measured on a public corpus so the number is reproducible by anyone —
 * BEIR/NFCorpus, 323 judged test queries, production arms (real `SearchIndex`,
 * real `EmbeddingIndex`), both arm lists computed once and reused for every k
 * so nothing but the combination can move:
 *
 *   k      nDCG@10   recall@10   hit@5
 *   1       0.3570     0.1796     66.9%
 *   3       0.3586     0.1794     66.6%
 *   5       0.3572     0.1789     66.9%   ← this
 *   10      0.3570     0.1804     67.2%
 *   30      0.3497     0.1743     65.3%
 *   60      0.3494     0.1739     64.7%   ← shipped
 *   100     0.3490     0.1738     65.0%
 *
 * Paired per query, k=5 against k=60: mean ΔnDCG@10 **+0.0079, 95% CI
 * [0.0018, 0.0142], bootstrap p=0.0108, sign-flip permutation p=0.0111** —
 * better on 88 queries, worse on 57, unchanged on 178. The dev split does
 * NOT clear the same bar: +0.0061, CI [-0.0001, 0.0124], p=0.0526. One split
 * significant, one not, both positive. 1–10 is a plateau rather than a spike,
 * so the exact value inside that band is not load-bearing.
 * Rerun: `packages/eval/src/rrf-k-beir.ts`.
 *
 * On the same corpus the dense arm alone scores 0.3577 — marginally above
 * this fusion at k=5 (0.3572) and below it at k=3 (0.3586). The fusion is not
 * beating its own best arm here; what it is doing is beating the fusion it
 * shipped with, at every cut.
 *
 * ⚠️ This is NOT band-neutral. `RRF_SCALE` holds the two anchors, not the
 * curve between them: every intermediate score compresses, so the absolute
 * cuts downstream (30 / 50 / 100) see a different distribution. Measured on
 * the same corpus, served top-5, floor 50: REQUIRED 80.3% → 39.2%, OPTIONAL
 * 19.7% → 59.5%, dropped 0.0% → 1.3%. See #302 — that shift is roughly what
 * the issue asks for, but it is a consequence of this change, not something
 * it avoids.
 */
export const RRF_K = 5;

/**
 * Scale from the raw RRF sum to the published `score`.
 *
 * Pinned to k so the two ANCHORS do not move: rank 1 in both arms stays
 * 163.934, a one-armed rank 1 stays 81.967. At the previous k=60 this
 * expression is exactly the old ×5000.
 *
 * What it does NOT do — stated plainly because an earlier version of this
 * comment claimed otherwise — is hold the curve BETWEEN the anchors. It
 * cannot: a smaller k exists precisely to make the score fall off faster with
 * rank, and the anchors are the two points where rank is 1. A two-armed hit at
 * rank 20 was 125.0 and is now 39.3. Every absolute cut downstream
 * (`hook.ts` 30/100, `bash-fail-hook.ts` 50, `harvest.ts` 100, `webui.ts` 100,
 * `telemetry.ts` bandForScore) therefore sees a different distribution, and
 * a telemetry series over `band` is not comparable across this change.
 *
 * There is no constant that avoids this. Band occupancy is a property of the
 * rank distribution, and changing how rank is weighted is the point. Either
 * the cuts move with k or the occupancy does — see #302, whose question this
 * is.
 */
export const RRF_SCALE = (5000 * (RRF_K + 1)) / 61;
