# Eval geometry

A pre-run discipline for the eval threads (#89/#102, #120/#121, #130, #129, #134,
#135). Across those threads the same bug recurred — *measuring the wrong region of
the data* — and it was almost always caught **after** a run. This note makes the
boundary a **pre-run object** so a regime slip reads as a visible category error
instead of a number that quietly goes wrong.

Origin: distilled from @zzallirog's measurement-geometry write-up (#137). Every
border below is a catch already made in the threads; the only thing added is
running the check *before* the eval, not after.

## The one rule

Every detector is one sentence: **"the signal must live in region R of axis A."**

Two corollaries stop being free once the rule is explicit:

- **Measuring the wrong thing = measuring a region your detector doesn't own.**
  This is the single recurring bug class.
- **The threshold *is* a region boundary** — read off the axis, not tuned. If you
  can't point at the line on an axis, it's invented.

## Two standing questions (run before any eval)

1. **Right region?** Name the axis, draw the cuts, shade the region the detector
   owns, and locate the test cases' gold. If the gold sits outside the shade,
   you're measuring the wrong thing — stop before the run.
2. **Is the pool drifting?** Is `P` (pool depth) stable across the run? Is
   `expansionsFor` mutating the expansion function globally — one mint re-ordering
   every query that shares a trigger term (the #129 P4 coupling)? A drifting pool
   moves the boundary every other detector is measured against.

## Axes & regions

### RANK axis — gold's first-stage rank

```
1 ─────── S ──────────── P ─────────────────► ∞
   NEAR   │  FAR-IN-POOL  │  FAR-OUT-OF-POOL
 (served) │  (reorder)    │  (transfer — what a bridge is FOR)
          S = serving cutoff       P = candidate-pool / #121 log depth
                                     = deepest rank a reranker can rescue
                                       (it only sees the pool)
```

Physical corollary: a reranker rescues gold **iff** `gold_rank ≤ P`. A pool
shallower than the gold it must rescue is empty by construction.

| Thread | Owns region | Border (the cut that keeps it honest) |
|---|---|---|
| #89 / #102 | NEAR — lift over a *no-trigger control* | The own-trigger 98.3% measures NEAR (the intervention fired and fetched its own target = presence, not lift). Border = the control arm. |
| #130 | the `S`/`P` boundary | Random distractors make the boundary trivially separable → inflated AUC (0.895 vs 0.838 dense-hard); realism of the boundary *is* the distractor hardness. Floor = the label-shuffle null. |
| #129 | **out-of-pool (`> P`) only** | A naive "far" set is mostly in-pool reorder `(S, P]`; on a real wiring run it ran ~62% reorder / 38% true `> P`. Average across both and the transfer the bridge is mandated to do (it crossed 0/5 golds on the `> P` slice, +277 mean Δrank) is masked by the reorder cases. Read `> P` only. |

### TIME axis — version lineage of one fact (#134)

Cut = **provenance of the query**: it must be independent of any version's surface
text. A query leaked from the fresh version measures keyword overlap, not
recall-by-time — and recency = fresh is true by construction.

### SET axis — the evidence set itself (#135)

Cut = **commit-time**: the candidate-pool log is hashed *before* any bridge is
scored on it. A harvester that shapes the log (drops near-fails) is otherwise
scored on a set its own harvest authored.

### EMBEDDER axis — score-shape is a property of the embedder's geometry

Cut = **eval-harness embedder vs production**. A predictor validated on one
embedder doesn't certify a gate that runs on another until it clears null under the
production embedder too (e.g. `gap`-AUC e5 0.838 → embeddinggemma 0.930 — both
clear null, but magnitude is not cross-embedder comparable, so trust the sign).

## One wire to check it works

Pick any past thread, draw its axis + cuts, locate the test cases' gold. If it's
outside the region that detector owns, that's the bug — found before the run, not
after.
