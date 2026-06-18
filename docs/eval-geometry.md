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

## Where signal is born (capability side)

The measurement axis has a dual: the same RANK regions, read for *where a training
label can be born* and *what can move a gold into the labelable region*. The two
sides are coupled, and the coupling is why the region error recurs.

**Where a label is born:**

- **Teacher 1 (behavioral)** labels what *surfaced and was acted on* (terminal
  selection = +, re-query = −). A give-up — gold never surfaced (`>P`) — is a
  *coverage flare, not a label*. → NEAR + FAR-IN-POOL.
- **Teacher 2 (offline cross-encoder)** reranks the *already-pooled* `hits[]`;
  rescues only what is in the pool. → FAR-IN-POOL (reorder). Doesn't crack
  zero-overlap.
- **No mechanism produces a label in `>P`.** You cannot certify a gold that recall
  never surfaced. Both teachers are blind out-of-pool — the capability root the
  measurement side has to police.

**What moves a gold into the pool (so it can be labeled / served):**

- **Index side** — enrich the anchor so the bi-encoder surfaces it: write-time
  doc2query paraphrase (#117) + real paraphrases harvested off the wire.
- **Query side** — bridges: expand the query with trigger terms. Minted from an
  in-pool `(S,P]` rescue but *mandated* to serve `>P` — the transfer the #129 gate
  must certify, not the reorder it was born from. (`>P` itself splits:
  surface/typos owned by the lexical arm vs oblique/semantic owned by
  anchor-enrichment + bridges — so measuring it needs the #130 stratifier, not a
  naive far set.)

**The duality (why the error recurs):** the label is born in-pool, so a naive
measurement *defaults* in-pool too — you mean `>P` and measure `(S,P]`. And the
structural tension it exposes: the bridge layer's training signal (in-pool
rescues) and its mandate (`>P` transfer) live in different regions, so the #129
gate certifies a transfer the training never directly optimized — which is exactly
why the gate, not the harvest, is the load-bearing part.

Credit: this capability map is from @zzallirog (#137).

## One wire to check it works

Pick any past thread, draw its axis + cuts, locate the test cases' gold. If it's
outside the region that detector owns, that's the bug — found before the run, not
after.
