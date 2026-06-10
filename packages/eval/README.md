# @bastra-recall/eval — `recall_when` marginal-lift ablation

Offline counterpart to the online USE-rate (#69). Where the M0 baseline
(`scripts/eval.ts`) queries each memory with its **own** `recall_when` phrase —
an upper bound that's circular by construction — this harness measures how
**load-bearing** the trigger field actually is, under paraphrased queries.

## What it measures

Two BM25 indexes over the **same** vault, differing on exactly one dimension:

| arm | `recall_when` |
|---|---|
| **control** | stripped from the searchable fields |
| **treatment** | indexed at its production weight (core: `×5`) |

Every other field weight + search option is pinned to
[`core/src/search.ts`](../core/src/search.ts) (a drift-guard test fails if they
diverge). Queries are **paraphrases** of each memory's trigger — held out,
sharing as few literal tokens as is realistic — so we test whether a memory
still surfaces when a future session phrases the situation in its own words.

```
marginal-lift@k = Recall@k(treatment) − Recall@k(control)
```

A no-trigger **anti** slice records the median top-1 score on off-vault queries,
bounding false-positive surfacing — adding the trigger field must not inflate it.

## Run it

```bash
# bundled synthetic vault + cases (self-contained, CI-runnable)
npm run lift --workspace=@bastra-recall/eval
# or, from repo root:
npm run eval:lift

# tune
npm run lift -- --boost 5 --k 3

# against a real vault with your own paraphrases:
BASTRA_VAULT_PATH=/path/to/vault \
  npm run lift -- --cases my-cases.json --out lift.json
```

## ⚠️ The bundled number is a mechanism demo, not the headline

`fixtures/eval-vault` is a **tiny synthetic vault** (10 memories) whose only job
is to make the harness self-contained and reproducible. The lift it reports
shows the harness *computes correctly* — it is **not** evidence about the real
lift on a production vault. A citable number comes from running the ablation on
a real vault (e.g. the 59-memory vault behind the M0 baseline) with hand-written
paraphrases. Treat the synthetic figure as a smoke test, not a result.

## Simulated-user survival (`npm run personas`)

`marginal-lift` answers *"does the trigger field help?"* with one paraphrase
set. The companion harness asks the sharper, production-shaped question on the
**same** control/treatment indexes:

> `recall_when` is written at **save** time — a prediction of how a future
> session will phrase the situation. The query is formed at **recall** time, in
> that session's own words. **How much of the lift survives when the recall-time
> query drifts off the save-time prediction?**

We model the recall-time query distribution with **N simulated user personas**
(junior / senior / terse / verbose / non-native / concept-namer / …), each
phrasing every memory in its own voice. Each query gets a continuous overlap
score against the gold memory's `recall_when` tokens, then:

```
near  = query shares trigger vocabulary (overlap ≥ cut)   → prediction hit
far   = query uses different words      (overlap < cut)   → prediction missed
survival = marginal-lift@k(far) / marginal-lift@k(near)
```

`survival ≈ 1` → the trigger generalizes past its own wording (load-bearing).
`survival ≈ 0` → it only helps when you already used its words — i.e. the lift
sits closer to the circular M0 regime than to real recall. The report also
prints the **Recall@k envelope across personas** (the robustness spread) and a
**persona-diversity** number.

```bash
npm run personas --workspace=@bastra-recall/eval
npm run personas -- --k 3 --near 0.30
BASTRA_VAULT_PATH=/path/to/vault \
  npm run personas -- --personas my-personas.json --out survival.json
```

### Why simulated, not hand-written?

The issue thread asks for *hand-written* paraphrases, and that's the right
instinct for an **independent** probe. But for this product it is ecologically
backwards: **nobody hand-writes the memories** (the AI saves them) **or
hand-phrases the recall query** (the AI forms it). Production is model-mediated
on *both* ends, so simulated queries are the faithful test; hand-written ones
test a path that never happens. The retriever is lexical BM25 (no embedding
space), so the only contamination risk from LLM-authored queries is
**trigger-vocabulary leakage** — and the overlap score measures that directly,
per query. Two guards keep it honest (see `__tests__/persona-diversity.test.ts`):
the personas must be **distinct voices** (no mode collapse) and must **span the
near↔far axis** (the gradient is emergent, not hand-binned).

> Same caveat as above: the bundled `fixtures/personas.json` runs against the
> synthetic vault — a mechanism demo, not a headline. A citable survival number
> comes from real personas against a real vault.

## Cases format (`fixtures/cases.json`)

```jsonc
{
  "paraphrased": [
    { "id": "<memory id in the vault>", "label": "short handle",
      "paraphrases": ["query phrased in different words", "..."] }
  ],
  "anti": [
    { "query": "off-vault topic with no relevant memory", "note": "why" }
  ]
}
```

Unknown ids (a renamed/deleted memory) are reported and skipped, not counted as
misses.
