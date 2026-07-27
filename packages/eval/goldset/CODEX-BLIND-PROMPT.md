# Blind query authoring — prompt for an independent second party (#262, §19)

Hand this to a **fresh** Codex session. Paste it as the whole task.

## Why a fresh session, and what it must not see

§19 of the architecture contract allows a gold query to be authored by an
independently working second party, and imposes one rule: whoever formulates
the query must not have the target memory's body, summary or `recall_when`
open. The gold assignment happens afterwards, by someone else.

A fresh model session satisfies that more strictly than a human colleague
would — it cannot peek. But only if it is genuinely fresh:

- **No vault access.** Not the memory files, not `recall`, not `find_document`,
  not the `bastra-recall` MCP server at all.
- **Not `docs/Evolutionsarchitektur V1 zu V2.md`.** It quotes memory ids and
  memory content verbatim; reading it would contaminate the batch.
- **Not a session that has already done vault work in this project.** Start a
  new one.

If the session has seen any of the above, the batch is void. Say so rather than
producing it anyway — a contaminated gold set is worse than a missing one,
because it looks like evidence.

---

## The prompt

> You are writing search queries for a retrieval benchmark. You will never see
> the documents being searched, and that is the point.
>
> **The system.** `bastra-recall` is a local-first persistent memory for AI
> coding agents. A developer works with an agent; along the way the agent saves
> short markdown notes — lessons learned, decisions taken, preferences stated,
> project facts, references. Later, the same or another agent searches those
> notes to avoid re-deriving what is already known.
>
> **What you may look at.** The public repository: source code under
> `packages/`, the GitHub issues, the README, `docs/architecture.md`,
> `docs/hooks.md`, `docs/memory-schema.md`. Nothing else. Specifically **do
> not** read `docs/Evolutionsarchitektur V1 zu V2.md` or anything under the
> user's vault, and do not call any `bastra-recall` tool.
>
> **Your task.** Write the search queries a developer or their agent would
> plausibly type while working on this project — the questions someone asks
> when they half-remember that something was decided, or hit a problem that
> smells familiar.
>
> Write **100 queries**, one per line, plain text. Use `#` at the start of a
> line to mark a section; those lines are ignored by the tooling.
>
> **Distribution.** Aim for roughly:
>
> - 30 **paraphrases**: a question about something the code or issues show this
>   project deals with, phrased the way a person types it — not the way the
>   codebase words it. Avoid the repo's own identifiers unless the query is
>   deliberately an exact-lookup case.
> - 15 **exact lookups**: a file path, a symbol, an issue number, a commit
>   prefix. `packages/core/src/search.ts`, `recallHybrid`, `#253`.
> - 12 **no-answer queries**: plausible for a developer, but about something
>   this project demonstrably does not deal with. Kubernetes operators,
>   Salesforce integrations, iOS push certificates. They must be realistic, not
>   absurd — the point is a query that *looks* answerable and is not.
> - 12 **hard distractors**: a query whose wording strongly suggests one area of
>   the system while the real subject is another. Two topics in this repo that
>   share vocabulary but not substance are the ideal shape.
> - 10 **associative**: the query resembles the target neither lexically nor
>   semantically, and only the situation connects them. "the thing that bit us
>   during the cloud sync week", "why we stopped trusting the numbers".
> - 8 **action-oriented**: an earlier rule, path, limit or safety constraint has
>   to enter the arguments of a tool call. "am I allowed to force-push here",
>   "which directory do temp files go in". Include 3 where the correct answer is
>   that **no** stored rule applies and the agent should just proceed.
> - 8 **time / version questions**: "what did we decide before the 0.8 release",
>   "was that still true in June".
> - 5 **cross-scope**: a question that spans two projects or asks about a
>   preference that holds everywhere rather than in one repo.
>
> **Language.** About 45 German, 45 English, 10 mixed German-English technical
> speech ("wie war das mit dem daemon restart handling"). Mixed is how people
> actually type in this project — do not sanitise it.
>
> **Length.** 4 to 15 words. Longer than a keyword, shorter than a sentence you
> would write in a document.
>
> **Do not** write queries that sound like issue titles or commit messages
> ("cli: add logs subcommand"). Those are work items, not searches. A query is
> what someone types into a search box when they want to *find* something.
>
> **Output.** Only the 100 lines plus `#` section markers. No preamble, no
> numbering, no explanation.
>
> **Finally**, in a separate paragraph after the list, state in one sentence
> what you actually looked at while writing them. That sentence becomes the
> `authoring_mode` field of the provenance record, so it must be true and
> specific.

---

## What to do with the result

Save the query lines (without the trailing paragraph) as a plain text file,
then:

```bash
npx tsx packages/eval/src/goldset-blind.ts \
  --in queries.txt \
  --out staged-blind.json \
  --origin second_person \
  --by "Codex (fresh session, no vault access)" \
  --mode "<the sentence Codex wrote about what it looked at>"
```

The tool stamps `origin_type`, `authoring_mode` and `origin_ref_hash`, refuses
a batch without `--by` and `--mode`, and writes an **unlabelled** staged file.
Assigning the gold ids is the separate step (`goldset-label.ts`), and it may
read the vault — by then the queries are already fixed.

## What this cannot enforce

Nothing here verifies that the session stayed clean. The provenance records who
authored the batch and what they say they looked at, so a reviewer can weigh
it; it does not prove it. That limit is the same one §19 accepts for a human
second person, and it is why `authoring_mode` is free text rather than a
checkbox.

One honest difference from a human colleague: a person who lived through the
incidents asks what actually got confusing at 2am. A model reading the repo can
only ask what the artifacts suggest. The batch is therefore weaker on the
associative and time-view categories than a colleague's would be — worth
knowing when the coverage report shows those buckets thin.
