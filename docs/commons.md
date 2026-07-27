# Bastra Commons — shared recall (#119 / #120)

Bastra Commons is a **separate, opt-in, default-OFF, PR-gated public Git repo** of
community-proven engineering recipes — **never your private vault**. Reading it is
one-way and read-only; every contribution goes through a human-reviewed PR. There is
**no auto-egress**: nothing leaves your machine without an explicit, reviewed PR.

Default repo: `https://github.com/n0mad-ai/bastra-commons`. Default clone path:
`~/.bastra/commons` (override with `BASTRA_COMMONS_PATH`).

`BASTRA_COMMONS_REPO` points the clone and the contribution PR at a different
repo. It is **allowlisted** (#260): only `github.com/n0mad-ai/…` is accepted by
default, and anything else — a different host, a different owner, a local path,
an unparseable value — is refused before the clone and before the push, because
the contribution path opens a PR against exactly this target and would ship your
verification records there. To use another target on purpose, set
`BASTRA_ALLOW_REMOTE_COMMONS=1`; every clone and every submission then prints the
overridden target on one line, each time.

## How it plugs into recall

`bastra commons enable` git-clones (`--depth 1`) the repo and sets
`commons.enabled` in `~/.bastra/cli-settings.json`. On the next daemon boot the
clone is loaded **read-only** as a second BM25 index; its hits are fused into
`recall` under `scope: commons`, ranked **just below** your personal memories.

- Rank: `commonsRankFactor` = baseline `0.8`, raised by independent `works`
  (up to +0.15), lowered by `fails`, clamped to `[0.5, 0.95]`
  (`packages/daemon/src/cli/commons.ts:138`). A recipe can never outrank a
  personal hit, nor disappear entirely.
- On an **id collision**, the personal memory wins — the commons hit is dropped
  (`packages/daemon/src/tool-handlers.ts:244`).
- The daemon **NEVER writes** the clone. Opt-in, restart-to-apply, read-only.

Two shared layers live in the **same clone**, each with its own toggle:

| Layer | Path | Toggle | CLI |
|---|---|---|---|
| Recipes + verifications | `recipes/`, `verifications/` | `commons.enabled` | `bastra commons` |
| Bridges (shared learned-recall, #120) | `bridges/<lang>/*.json` | `sharedRecall.enabled` | `bastra bridges` |

Both default OFF; both require a daemon restart to take effect. `commons.enabled`
defaults to `false` (`settings.ts:235`); `sharedRecall.enabled` defaults to `false`
(`settings.ts:245`). Bridges live *inside* the Commons clone, so `bastra bridges
enable` only flips the toggle — you still need `bastra commons enable` to actually
clone the repo.

## What is shared

Three artifact kinds. **None carries private vault content** — no memory bodies,
and (for bridges) no memory ids.

### 1. Recipe — `recipes/<domain>/<slug>.md`

A markdown file with bastra-memory-compatible frontmatter so `recall` indexes it
without conversion:

```yaml
id: …
title: …
type: lesson
scope: commons
status: candidate | solution   # free-form label; the daemon does NOT compute it
topic_path: […]
tags: […]
recall_when: […]               # highest-weighted search field
summary: …
context:
  verified_in: "project (framework + version)"
verifications: []
```

Body sections: `Problem` / `Context` / `Failed paths` / `Solution (verified)` /
`Verified in`. Authored deliberately as a public engineering solution — **not**
extracted from your vault. Contributed by PR: CI checks schema, duplicates and
spam — humans never gatekeep truth, records do.

### 2. Verification record — `verifications/<recipe-id>/<verifierHash>.json`

The smallest evidence unit (`commons.ts:69`):

```json
{ "recipe_id": "…", "result": "works" | "fails",
  "environment": { "os": "…", "arch": "…", "node": "…", "note": null },
  "verifier": "…", "date": "YYYY-MM-DD" }
```

One record per verifier+recipe, overwritten on opinion change (history lives in
git log). Written by `bastra commons verify <recipe-id> works|fails ["env note"]`,
which best-effort auto-submits a Mini-PR (branch, commit, `push --force-with-lease`,
`gh pr create`); if git/gh fail, the record stays local and the path is printed for
a manual PR. What the daemon actually does with these records is **rank**, not
status: at boot it tallies `works`/`fails` per recipe (`loadVerificationCounts`)
and feeds them into `commonsRankFactor` (`commons.ts:138`) — more independent
`works` nudge a recipe up (max +0.15), `fails` nudge it down, always inside the
`[0.5, 0.95]` clamp so a recipe can never outrank a personal hit nor vanish. The
`status` field above is a Commons-repo-side label, not a daemon-computed tier;
nothing in the daemon reads it.

### 3. Bridge — `bridges/<lang>/*.json`

A language-tagged **vocabulary-expansion rule, NOT a memory** (`bridges.ts:33`):

```json
{ "id": "…", "lang": "de",
  "trigger_terms": ["…"], "expansion_terms": ["…"],
  "evidence": 1, "verifier": "…", "date": "…" }
```

`id` is a deterministic dedup hash of `lang` + sorted trigger + sorted expansion.
A bridge says: *"for a query in language L phrased with `trigger_terms`, also
search for `expansion_terms`"* — widening the BM25 surface so a far-worded query
reaches the memory the contributor proved it resolves to. The in-code privacy
contract (`bridges.ts:7`): **a bridge carries only term lists and a language —
never a memory id, body, or any vault content.** Language-partitioned: a bridge
fires only for a query detected as its language.

**Scope: the bridge layer is latin-alphabet only, by design.** Detection knows
two languages (`SUPPORTED_LANGUAGES = ["de", "en"]`,
`learned-recall/language.ts:20`) and `distinctiveTerms` tokenizes on
`/[^a-zäöüß0-9]+/i` (`learned-recall/bridges.ts:66`), so a query in Cyrillic,
Greek, CJK or any other non-latin script yields no trigger and no expansion
terms — nothing to mint from, nothing to fire. A mixed-language vault gets
bridges for its latin-query half and none for the rest. This affects **only**
vocabulary expansion: BM25 and `recall_when` index and match those queries
normally, so recall itself works — it just doesn't get the widening. Extending
the set means a stopword list per new language plus a tokenizer that keeps its
alphabet (#231).

Bridges are minted **locally and offline**, never on the recall hot path:
telemetry event log → `reconstructReaches` → `mintBridge` (query distinctive
terms = trigger; the resolved memory's distinctive terms not in the query =
expansion) → `writeBridges` into the clone. CLI: `bastra bridges mint [days]`
(in-band reaches) and `bastra bridges harvest [days]` (deep, local Ollama
reranker over the far slice). `bastra bridges contribute` is intentionally **not
yet wired** (depends on #121) and currently only prints that it will PR once
harvesting is wired.

## What stays private

Your personal memories never leave the machine — the clone is read-only and the
daemon never writes the synced repo. Before any bridge *could* be contributed,
`scrubBridge` (`bridges.ts:142`) drops every term that looks sensitive
(`LOOKS_SENSITIVE`, `bridges.ts:124`):

- any digit (`\d`) → ids, versions, dates, ticket numbers
- any path/email/url separator (`[/\\.@:]`)
- snake_case identifiers (`_`)
- hex hashes (`^[a-f0-9]{8,}$`)
- terms longer than `MAX_SHARE_TERM_LEN` (24)

If fewer than 1 trigger or fewer than `MIN_SHARE_TERMS` (2) expansion terms
survive, the bridge is **not shared** (returns `null`). By construction a bridge
already holds only lowercase distinctive terms (≥4 chars, stopwords filtered) plus
a language and an evidence count. Defense-in-depth on the **read** side too
(`bridges.ts:182`): the loader caps term length on the foreign clone so a hostile
bridge can't inject an oversized token into your query.

The local bridge pool and the contribution path are independent — toggling
`sharedRecall` off means neither the pool nor any contribution runs. Even enabled,
with no cloned `bridges/` dir the pool is empty and the layer is a deliberate
no-op (`expandQuery` returns the query untouched).

**The scrub is explicitly best-effort — the real guarantee is the PR review gate**
(`bridges.ts:18`): a human sees every contributed recipe, verification, and bridge.

## Pseudonymity

The verifier id is `sha256(git user.email).slice(0, 12)` (`commons.ts:100`), used
as the verification filename and the bridge `verifier`. Your real name appears only
in the PR; the hash just makes filenames deterministic (one record per
user+solution).

## CLI quick reference

```bash
bastra commons enable      # clone read-only + flip commons.enabled (restart daemon)
bastra commons update      # git pull --ff-only the clone
bastra commons disable     # flip toggle off (clone kept)
bastra commons status      # enabled-state + clone presence
bastra commons verify <recipe-id> works|fails ["env note"]   # record + best-effort PR

bastra bridges enable      # flip sharedRecall.enabled (needs commons cloned first)
bastra bridges language <tag|auto>   # query-language override (default: auto-detect)
bastra bridges mint [days] # mint bridges from in-band reaches
bastra bridges harvest [days]        # deep harvest via local reranker
bastra bridges status      # enabled-state, pool size per language, repo path
```

## Licensing

Recipe **texts**: CC BY 4.0 (reuse freely, credit authors). Code **snippets**
inside recipes: CC0 1.0 (paste into any codebase, no attribution).

## Key files

- `packages/daemon/src/cli/commons.ts` — enable/update/verify, rank factor, verifier id
- `packages/daemon/src/cli/bridges.ts` — bridges CLI (enable/mint/harvest/contribute)
- `packages/daemon/src/learned-recall/bridges.ts` — Bridge type, mint, scrub, pool
- `packages/daemon/src/learned-recall/harvest.ts` — reach reconstruction + harvest
- `packages/daemon/src/settings.ts` — `getCommonsEnabled` / `getSharedRecallEnabled`
- `packages/daemon/src/tool-handlers.ts:244` — recall fusion + id-collision rule

