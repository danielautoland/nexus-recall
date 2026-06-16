# Out-of-pool predictor + stratified transfer-gate

An opt-in eval harness for the verification contract in #129, with the #130 out-of-pool predictor as
the stratifier. Pure Python + numpy, no dependency on the core, nothing wired into recall — you run it
against a score dump and it tells you whether a bridge earns promotion.

## Why a *stratified* gate

A bridge is minted from in-pool far: `harvestFarBridges` reranks only what's already in `entry.pool`,
so Teacher 2 can only rescue a candidate that the pool already contained. But a bridge is *mandated to
serve* out-of-pool far — the residual the candidate generator missed. A naively-drawn held-out far set
is ~94% in-pool, so a bridge can clear a "far lift" gate by reordering in-pool far while the
out-of-pool residual it exists for is never measured. The gate has to certify **transfer**, not
in-pool reorder.

The predictor builds the held-out set deliberately: it scores each far query on its first-stage
score-shape (top-k entropy / std / score-gap) + query IDF and predicts whether the gold is in-pool,
so you can oversample genuine out-of-pool cases. Then the gate reads the **out-of-pool slice only**.

## Scripts

- `08_predictor.py` — the out-of-pool predictor (#130). Logistic regression over score-shape + IDF,
  group-CV by qid, null-controlled (label shuffle ×20), reported against the best single-feature floor.
- `09_roleprobe.py` — shows the stratification *changes the verdict*: a reorder-only bridge clears a
  naive far-lift gate but reads ~0 on the stratified out-of-pool slice.
- `13_transfer_gate.py` — the gate. Builds the predictor-stratified held-out set, then for each
  out-of-pool case measures the gold's rank with vs without a bridge — a paired Δrank, scored as the
  crossed-into-pool fraction plus a Wilcoxon over the non-zero deltas. `--power` reports the MDE.

All three carry a `--synthetic` self-test that runs with no data.

## Input

The scripts read a `scores_dump.json` — one record per (query, voice):

```json
{"qid": "...", "voice": "oblique", "top_scores": [<first-stage scores, descending>],
 "gold_rank": 137, "q_mean_idf": 4.08, "q_max_idf": 6.63}
```

`gold_rank` is 1-based over the full ranking (so out-of-pool = `gold_rank > pool`). `top_scores` is the
first-stage similarity distribution the predictor reads. Generate it however your stack produces
first-stage rankings; the eval downstream is pure numpy.

## Run

```
python3 08_predictor.py scores_dump.json            # the stratifier (ROC-AUC, null, floor)
python3 13_transfer_gate.py scores_dump.json --power # the gate + sensitivity
python3 13_transfer_gate.py --synthetic              # self-test, no data
```

## What a run shows (public MS MARCO, seed 42, dense-hard)

```
predictor ROC-AUC 0.804 (group-CV); stratified far out-of-pool 7% -> 16%
bridge                       total far-lift |  oop n  mean Δrank  crossed-in  p(wilcox)
transfer (positive control)         +0.165  |    33      -234        0.39       0.001   PASS
reorder-only (negative control)     +0.165  |    33        +0        0.00       1.000   FAIL
MDE: certifies a bridge crossing >= 19% of the out-of-pool slice at 80% power on N=33.
```

The reorder-only bridge posts the same healthy *total* far-lift a naive gate would pass — and the
stratified out-of-pool readout correctly fails it. Demotion falls out for free: a bridge with median
out-of-pool Δrank ≥ 0 is the `fails` counterpart.

## Scope

This validates the gate's *logic*, not real bridges. The positive control is a modeled transfer
bridge (it crosses out-of-pool gold in by construction), so what's shown is that the readout
discriminates transfer from reorder and survives the null — not that any harvested bridge transfers.
It runs on a public MS MARCO proxy (e5-small dense ⊕ a lexical arm), so trust the direction, not the
magnitude. And the out-of-pool N is small (~52 on the full far set, ~33 in the predictor's tail), so
the MDE is ~10–19%; below that a verdict is underpowered. The promote/demote call on real harvested
bridges belongs to a run on the production vault, with real reaches and the #121 candidate-pool log.

## Notes from building it

Three choices that aren't obvious until the implementation bites:

1. The out-of-pool readout can't be a plain recall@k or its median — transfer hits a minority of the
   slice, so more than half the cases are unmoved and a median sits at 0 even for a real bridge. The
   paired Δrank (crossed-in fraction + Wilcoxon over the non-zero deltas) separates them.
2. Stratify by the predictor's *ranking*, not a 0.5 threshold — at a ~6% out-of-pool base rate almost
   everything scores in-pool, so a threshold flags nearly nothing. The low-probability tail (where the
   AUC lives) is what enriches the held-out set.
3. Report the MDE alongside the verdict — at small N a pass/fail can be underpowered noise, and the
   power curve makes that explicit.

Refs: #130 · #129 · #128 · #120 · #121 · #102 · #89.
