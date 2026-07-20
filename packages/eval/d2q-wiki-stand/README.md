# d2q-wiki-stand — doc2query bridge for a colloquial-RU/UA user over an EN corpus

The class this stand exists for: a query like "сенсы мышки какой она была"
against an English config note. Zero shared tokens with the corpus — dense
misses deep, BM25 scores flat 0.00. No reranker fixes an empty pool, so the
only lever that physically builds the bridge is writing the user's register
*into* the document: doc2query with local models.

Numbers from the private run live in the #119 comment thread. This directory
is the mechanism, runnable on any corpus with the same shape.

## Pipeline (order matters)

```
d2q_gen.py <model>        # arm A/B: doc-seeded expansions, floating temperature
d2q_styled.py <model>     # arm C: doc-seeded, few-shot conditioned on the
                          #        owner's real replies (voice donor file)
d2q_filter.py             # candidate triage (#119's question): does the query
                          #   reach its own doc, does it reach a foreign one first
d2q_rescue.py             # held-out A/B/C vs baseline vs foreign-seed null
d2q_alpha.py              # discounted boost channel: score = max(dense, α·exp)
```

## Expects

- a SQLite corpus table `(id, path, line, doc, heading, embed_text, embedding)`
  — set `D2Q_CORPUS_DB` / `D2Q_CORPUS_TABLE`;
- Ollama for generation (`D2Q_GEN_URL`) and embeddings (`D2Q_EMBED_URL`,
  `D2Q_EMBED_MODEL` — must match the model that built the corpus embeddings,
  asymmetric prefixes and all);
- for arm C: a JSONL voice-donor file (`D2Q_VOICES`), lines of
  `{"surface": "<verbatim user reply>", "acted_on": true}` — only replies that
  actually triggered something, selection by effect, not by availability;
- for the held-out stages: a ground-truth file (`D2Q_GT`) of
  `{"topics": {<name>: {"gold": [section-ids], "ru": "...", "en": "..."}}}`,
  authored independently of the generators. Not shipped here — it encodes a
  private corpus. Build your own; queries must avoid the target's vocabulary.

The generation prompts are deliberately Russian: the point is producing the
user's register, not correct literary queries. Both local models used here
(gemma4:e4b, qwen3:8b) are reasoning models — `think: false` or the whole
token budget dies in the thinking field with an empty response.

## Design notes carried in the scripts

- test writes go to a separate `d2q.db`, never into the live index;
- expansions are generated for a distractor pool, not only for gold —
  otherwise gold wins by text volume, not by meaning;
- collision is judged by FILE, not by section: landing on a neighbouring
  section of the right file is a hit, counting it as collision inflates harm;
- the null arm (foreign expansions, shift +7) is not optional — it is the
  difference between "content lifts" and "any extra text lifts";
- empty model output is a status, not a missing row; `done_reason: length`
  is not an answer;
- single-request curl embedding with a short timeout dies the moment the
  Ollama VRAM scheduler evicts your embedder for someone's chat model —
  batch `/api/embed`, retries with backoff, `keep_alive`.
