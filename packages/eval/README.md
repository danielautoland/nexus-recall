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
test a path that never happens. The default retriever arm is lexical BM25 (no
embedding space), so the only contamination risk from LLM-authored queries is
**trigger-vocabulary leakage** — and the overlap score measures that directly,
per query. Since #103 the harness also runs a **hybrid arm** (production
`recallHybrid` with per-arm dense embeddings) and an **expanded arm** (BM25 +
write-time `recall_when_expanded`, #117) via `--arms lexical,hybrid,expanded`. Two guards keep it honest (see `__tests__/persona-diversity.test.ts`):
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

---

## Absence honesty (`src/absence-honesty.ts`)

Every MCP client is told to *"call recall before any other lookup tool"*. Against
`grep` that claim has two halves, and this harness measures the half that had no
number: **when the vault does not hold a fact, does recall say so?** `grep`
answers with exit code 1. A ranked list always has a first element, so recall has
to signal absence explicitly or the caller cannot tell a hit from a
rank-1-of-nothing.

Leave-one-out over a real vault, three arms on the same corpus:

| arm | query | gold | what it measures |
|---|---|---|---|
| **present** | the memory's own `recall_when` | in the vault | plumbing control — circular by construction, an upper bound |
| **absent** | the same trigger | **held out** | do `weak_result` / `no_home` fire? |
| **paraphrase** | `--cases` — the fact asked in words the memory does not contain | in the vault | retrieval vs a lexical baseline, and the false-positive cost of any anchor rule |

The paraphrase arm needs hand-written held-out queries. Without `--cases` it falls
back to a sentence lifted from the body — that is a **quotation**, which a literal
search wins by construction; treat the fallback as a plumbing check, never as a
result.

Two baselines stand in for "grep": **AND** (every content word in one file — the
`grep -q` signal) and **ranked** (top-k by distinct-term coverage — what an agent
does when the AND comes back empty).

```bash
BASTRA_VAULT_PATH=/path/to/vault \
  npx tsx src/absence-honesty.ts --n 40 --k 5 \
    --cases goldset/held-out-paraphrases.example.json --out honesty.json
```

Only memories that already carry a persisted vector are staged, so the dense leg
is identical across arms and no backfill runs mid-measurement. `--out` keeps the
per-hit `matched_terms` / RRF ranks, so a candidate anchor rule can be swept
offline without paying for the index rebuilds again.

## Pool depth (`src/pool-depth.ts`)

`absence-honesty` reports hit@5. That number cannot tell a **retrieval** failure
(the memory is nowhere near the top of either arm — nothing downstream can
rescue it) from a **ranking** failure (it is in the pool at depth 8 and only the
cut hides it). Different fixes, and only one of them is cheap.

One index, one pass, the gold's rank in the BM25 arm, the dense arm and the
fused list, measured to depth 50:

```bash
BASTRA_VAULT_PATH=/path/to/vault \
  npx tsx src/pool-depth.ts --cases goldset/held-out-paraphrases.example.json --depth 50 --out pool.json
```

The split it makes is the useful part: **the gold is in one arm's top-5 or the
other's** far more often than the fused list returns it. That gap is combination
loss — it is the cheap kind, and `--out` dumps both ranked lists so alternative
fusions can be swept without re-running the arms. That sweep is what pointed at
`RRF_K`; the number that justifies the change is on a public corpus, below.

## The fusion constant on a public corpus (`src/rrf-k-beir.ts`)

A measurement on your own vault can start an investigation but cannot end one:
nobody else can rerun it, and the vault it describes is the thing you are not
publishing. So the claim about `RRF_K` is settled on BEIR/NFCorpus instead —
3 633 documents, 323 judged test queries, graded relevance, real users' queries,
and a hard task by design.

```bash
# BEIR, CC BY-SA 4.0
curl -sLO https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/nfcorpus.zip && unzip -q nfcorpus.zip
npx tsx src/rrf-k-beir.ts --data ./nfcorpus --split test --paired 5,60
```

Production arms (real `SearchIndex`, real `EmbeddingIndex`), both arm lists
computed once per query and reused for every k, so only the combination moves:

| k | nDCG@10 | recall@10 | hit@5 |
|---:|---:|---:|---:|
| 1 | 0.3570 | 0.1796 | 66.9% |
| 3 | 0.3586 | 0.1794 | 66.6% |
| **5** | **0.3572** | **0.1789** | **66.9%** |
| 10 | 0.3570 | 0.1804 | 67.2% |
| 30 | 0.3497 | 0.1743 | 65.3% |
| 60 | 0.3494 | 0.1739 | 64.7% |
| 100 | 0.3490 | 0.1738 | 65.0% |

Paired per query, k=5 against k=60: **+0.0079 nDCG@10, 95% CI [0.0019, 0.0122],
p=0.0012** (10 k bootstrap resamples) — better on 88 queries, worse on 57. The
dev split, independent queries, agrees: **+0.0061, CI [0.0011, 0.0128],
p=0.0128**. 1–10 is a plateau, not a spike, so the exact value inside that band
is not load-bearing.

Small effect, honestly. What makes it worth the constant is that it is free,
it is significant on two independent splits, and the arithmetic behind it says
the shipped value was doing something nobody intended — see
`core/__tests__/rrf-damping.test.ts`.
