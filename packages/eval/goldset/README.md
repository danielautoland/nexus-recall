# goldset

Hand-written **held-out** queries: the fact asked in words the memory does not
contain. `absence-honesty.ts` and `pool-depth.ts` take them with `--cases`.

```jsonc
[{ "gold": "<memory id in the vault>", "query": "<how a person would actually ask>" }]
```

`held-out-paraphrases.example.json` runs against the bundled
`fixtures/eval-vault` (10 synthetic memories) — enough to see the harness work
end to end, not enough to be a result.

Real runs point at your own vault and your own cases file. Keep that file out of
the repo: the queries describe what is in your vault, which is exactly the thing
a personal memory vault is for not publishing. Numbers quoted anywhere public
should come from a public corpus instead — see `src/rrf-k-beir.ts`.

Writing them: describe the situation, not the note. If a query reuses the
memory's own `recall_when` wording the measurement is circular, and if it quotes
a sentence from the body it is a citation test that any literal search wins by
construction.
