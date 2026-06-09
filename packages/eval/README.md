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
