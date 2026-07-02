---
name: bastra-recall
description: Persistent external brain for Claude — documents (PDFs, contracts, scans with OCR), personal facts (appointments, decisions, items, amounts), AND code lessons / preferences / project topology. USE PROACTIVELY in three modes. (1) RECALL — whenever the user asks about anything from their past, vault, projects, or personal life, INCLUDING direct retrieval phrasings like "find...", "where is...", "when was...", "how much was...", "do I have a ...", "such mal meinen ...". Call bastra-recall (recall + find_document) BEFORE conversation_search, before web_search, before any other lookup tool. (2) CAPTURE — when the user expresses frustration about a recurring issue ("wieder", "schon wieder", "wie oft", emphatic caps), states an explicit durable rule ("immer X", "nie Y", "bei diesem Projekt …"), corrects a recurring tendency in your behavior, finalizes an architectural decision after weighing options, confirms a workflow ("lass uns das immer so machen"), or completes a coherent feature / multi-file refactor / sub-system milestone (save the file map as project-fact). (3) APPLY — at session start, before writing/editing code, before a new coding block in an area you haven't touched this session (recall the topology map first), and before giving multi-step plans. Tools: recall, load_memory, save_memory, find_document, read_document.
---

# bastra-recall — autonomous teammate memory

You have a persistent memory across sessions via the `bastra-recall` MCP server (tools: `recall`, `load_memory`, `save_memory`). Treat it as YOUR own long-term memory, not as a tool the user has to invoke.

The single success metric: **the user does not have to think for you anymore.** Recurring mistakes don't recur. Stable preferences don't get re-stated. Project facts don't get re-discovered.

**Reflex order — RECALL first.** Most of this document is about *capturing* (save signals, taxonomy, people, commons). That page-count is misleading: the highest-frequency, highest-cost failure is the opposite one — skipping recall and re-deriving what the vault already holds. So the first reflex on every turn is RECALL: before acting, before any other lookup tool, and before the save/convention machinery below. When you're unsure whether a recall is worth it, recall. The capture sections matter, but they never outrank getting the right memory in front of you first.

---

## When to RECALL — before acting, not only when prompted

Call `recall(query, k=5)` proactively in these moments:

| Moment | Query shape |
|---|---|
| **Session start** (once per session) | `"<project name> preferences user-preference active context"` — preloads durable context |
| **Before writing/editing a file** | `"writing <filetype> at <path>, contains <topics>"` — catches lessons before mistakes (e.g. CSS pitfalls, schema rules) |
| **Before a new coding block / plan in a feature area** | `"<project> <feature/area> current state files architecture"` — surfaces which files are relevant + what's already built (see Project topology below) |
| **Before a multi-step plan or recommendation** | `"giving plan/recommendation for <topic>"` — surfaces format preferences |
| **User asks for retrieval / lookup** ("find...", "where is...", "how much was...", "when did...", "do I have a...", "such mal meinen...") | the prompt itself + direct nouns — ALWAYS try `recall` and `find_document` **before** any other search tool (conversation_search, web_search) |
| **User prompt touches a stored topic** | the prompt itself, optionally with project context |
| **Before `save_memory`** | the title/topic — duplicate check |

`recall` is **step 1 of two**: it returns lean candidates (`id, title, type, scope, summary, score`) — no bodies. Spend the `summary` + `score` to decide, then call `load_memory(id)` as **step 2 only for the candidates you actually need**. Loading every hit defeats the point and burns context. (Need the debug fields — `matched_terms`, `mode`, `hop`, `topic_path`, stage timings? Pass `verbosity: "full"`.)

What to do with hits (interpret the score):

- **Score ≥ ~100 with `recall_when` or title match** → call `load_memory(id)` and apply the lesson **before** writing code or responding. Never ignore a `lesson` hit at this band.
- **Score 30–100** → read the summary; load only if directly relevant.
- **Below ~30** → noise; `recall` already drops it (default floor). Raise `min_score` to surface only high-confidence candidates.

Idempotent: don't reload a memory you've already loaded this turn.

### Tool priority for retrieval

When the user asks about anything personal, factual, historical, or document-shaped ("find my X", "where is my Y", "how much was Z", "when did I …", "do I have a …", "such mal meinen …"), try the vault **first**. Order:

1. **`bastra-recall:recall`** — memories, lessons, decisions, project facts, personal facts.
2. **`bastra-recall:find_document`** — PDFs, scans, OCR'd content (documents in the vault). Same two-step discipline as recall: `find_document` returns lean candidates; call **`read_document(id)`** as step 2 only for the hits you actually need — it returns the document's full text/OCR content.
3. **`conversation_search`** — chat history. Fallback only.
4. **`web_search`** — external info. Last resort for personal queries.

Skipping straight to `conversation_search` or `web_search` on a "find my …" query is the #1 failure mode this skill is meant to prevent. The vault is the canonical store; if it's there, `recall` / `find_document` will find it.

---

## When to SAVE — autonomous, no permission asked

### STRONG signals — fire `save_memory` immediately, then 1-line ack

| Signal | German cue | Memory `type` |
|---|---|---|
| User-frustration about a recurring issue | "wieder", "schon wieder", "wie oft", CAPS | `lesson` |
| Explicit durable rule | "immer X", "nie Y", "bei diesem Projekt nutzen wir Z" | `preference` / `workflow` |
| Correction of a recurring tendency | "du denkst zu kompliziert bei CSS", "halt einfacher" | `meta-working` |
| Architectural decision finalized after weighing options | "ok, dann nehmen wir Drizzle" | `decision` |
| Workflow confirmation | "super, lass uns das immer so machen" | `workflow` |
| Bug fixed after >2 iterations with non-obvious root cause | — | `lesson` (capture the FAILED PATH too, not just the fix) |
| **Feature / coding block completion** (multi-file feature done, sub-system stabilized, refactor finalized, issue closed with code) | — | `project-fact` (see Project topology below) |
| **Substantive exchange with a person/contributor** (Discord / dev.to / GitHub thread — not one-liners or acks) | — | split: identity → `memories/people`, content → `project-fact` |

After a real back-and-forth with a contributor lands (not a trivial reply): memorize it autonomously on **two rails**. (1) **Identity** — update the person's canonical memo: one memory per handle, `folder: memories/people`, deduped with `[[wikilinks]]` (the People convention below). (2) **Content** — save the exchange's substance + any decisions as a `project-fact` (a project-scoped fact routes to `memories/projects/<project>/` by default) that links the person via `[[handle]]`. Before propagating any code claim a contributor makes, **verify it against HEAD** — never write an unverified assertion into memory.

### ANTI-signals — do NOT save

- One-off task descriptions ("baue mir bitte X") — that's a task, not a memory.
- Speculation, "maybe", tentative ideas.
- Anything derivable from code, git history, or CLAUDE.md.
- Sensitive personal data unless it's a stable preference.
- **When in doubt: do NOT save.** False saves erode trust faster than missed saves.

### Before saving

Always `recall()` with the title/topic first — if a near-duplicate exists, update it (`overwrite=true`) instead of creating a new one.

### Quality bars (every save)

- **Title** — short, specific, non-generic.
- **Summary** — one sentence with the gist; aim ~250–300 chars, core in the first 160 (the lean-recall snippet). Hard cap 400 — auto-truncated if over, never rejected, so keep it short.
- **Body** — lead with the rule/fact, then `**Why:**` (root cause / reason / incident) and `**How to apply:**` (when this kicks in). For lessons, capture the failure path **and** the fix.
- **`recall_when`** (CRITICAL — highest-weighted search field) — 2–4 *concrete* trigger phrases. *"about to write a Tailwind grid"* beats *"CSS questions"*. Without good `recall_when`, the memory is dead weight.

### After saving — ack format

Surface a single line, prefixed with `→`, then continue with the actual task:

```
→ saved: <title> (id: <id>)
```

Nothing more. The user can ignore, correct (*"nein, das war anders"* → update the memory), or delete.

---

## Project topology — feature state in memory

Beyond lessons and decisions, the vault also serves as a **living map of what was built when, in which files, by which decisions**. Every time a coherent piece of work lands (a feature complete, a refactor finalized, a sub-system stabilized), capture it as a `project-fact` memory — so future-you knows the layout without re-reading every file. This is the OSS-side foundation for codebase indexing: the vault carries the *what + where + why*; the actual code stays in git.

### When to save a topology / feature-state fact

After ANY of these events:

- A feature is functionally complete (PR-ready, works end-to-end).
- A multi-file refactor is done.
- A sub-system stabilized (e.g. „the daemon HTTP layer now owns auth + CORS + REST tools").
- An architectural decision was applied in code (after the `decision` memory is saved, add a `project-fact` describing where it landed).
- An issue is closed with code changes.

### What to save

Memory `type: project-fact`. Body should answer:

- **What** — one sentence what this feature/area does.
- **Where** — concrete file paths in `path/to/file.ts:42` format for key entry points.
- **How it connects** — which other features/files/memories it interacts with (use `[[memory-id]]` wikilinks).
- **Status** — when was it last touched, what's the current shape, what's deliberately not (yet) done.

Title shape: `<project> — <area>: <what was just landed>` (e.g. `bastra-recall — cli: install/uninstall/doctor/update for all surfaces`).

### When to recall topology

Before starting a new coding block, plan, or recommendation in an area you haven't touched in this session — and before quoting which files matter for a feature:

```
recall("<project> <area> files structure current state", k=5)
```

If `project-fact` hits come back with score ≥ 50, `load_memory` them. They tell you which files matter without grepping. If no hits exist for the area yet — it's an undocumented space; once you build something there, save the new map.

### Refresh, don't duplicate

When you complete the **next** version of a feature you already have a topology memory for, **update** the existing one with `overwrite=true` (same id). Don't create `feature-v2`, `feature-final`. Refresh the same node so the map stays current.

---

## Product docs — user-facing documentation (opt-in)

Separate from topology: the vault can also hold **product documentation** — living, user-facing docs ("how do I use this?") per project, in `dokumentationen/<project>/`. This is OFF by default; when the user enables it (`bastra config set docs.mode suggest|auto`), the session hook injects a `<bastra-product-docs>` block with the active instructions — follow that block.

The shape, in one breath: when a user-facing feature area is **completely finished**, create/update its doc via the `save_product_doc` tool — one doc per area, stable id, the body you send replaces the previous one (read the existing doc first, send the complete updated markdown). Written for the END USER: features, usage, tips, quirks — no code internals, no file paths. Developer state stays in `project-fact` memories.

No injected block = the feature is off = don't write product docs on your own.

---

## Self-learning taxonomy — let the vault grow its own structure

The vault can teach itself new categories on the free axes (`folder`,
`topic_path`, `tags`) — the closed `type` enum stays untouched. A **convention**
is a memory in the reserved scope `taxonomy` (tag `convention`) that fixes how a
recurring cluster is stored: its folder, topic_path shape, tags, and body shape.
Active conventions arrive at session start in a `<vault-taxonomy>` block.

### Apply (always)

Before saving into a recurring cluster (people, places, tools, …): check the
injected conventions — or `recall("taxonomy convention <cluster>")`. If one
covers the cluster, **follow it exactly** (its `folder`/`topic_path`/`tags`).
Never invent variant tags for a covered cluster; that fragments recall.

### Establish (when a cluster recurs without a home)

Establish a convention the moment a recurring cluster becomes clear — the same
ad-hoc cluster for the third time, a `<taxonomy-drift>` suggestion from the stop
hook, **or the conversation itself signalling a recurring domain** (the user
scans a stack of invoices → an `accounting`/`buchhaltung` home; introduces
several people → `people`; collects recipes, places, contracts → their own
homes). Don't wait for the look-alike memories to pile up unfiled: when the
context signals a recurring kind, create the home folder **proactively** and
file new items into it from the start. To establish one:

1. `save_memory` with `scope: "taxonomy"`, `type: "workflow"`, tags
   `["convention", "<cluster-key>"]`, body = the rule (folder, topic_path
   shape, tags, body shape, one worked example).
2. Apply it immediately to the memory you were about to save (use the
   `folder` arg so members get a real home, e.g. `memories/people`).
3. Re-file existing members: `save_memory` with `overwrite: true` + the
   convention's `folder` **moves** a memory (old file goes to the vault
   trash, recoverable). Split collection memos into one-memory-per-entity
   while you're at it, and link them with `[[wikilinks]]` instead of
   restating their story.

### People — one canonical memo per person, content links in by id

A person has exactly **one** canonical memo: `save_memory` with `folder:
memories/people`, `topic_path: [people, <handle>]`, `type: project-fact`, tag
`person`. Set `id: <handle>` explicitly — the body wikilinks below resolve
against the memory **id**, so the id must be the handle, not the slugified
title. Pass `folder` explicitly so it routes there regardless of active scope.
That memo holds **identity only**: handle, real name, role/relationship,
contacts/handles, first-seen, trust signals, a high-level interaction overview.

Content lives elsewhere. Technical conversations, decisions, measurements go
under the project's scope and link back with `[[<handle>]]` (which mirrors into
`related[]`) — they never restate who the person is.

A **second** person memo is justified only when the person holds a distinct
standing role across projects (architecture peer in one, partnership candidate
in another): the project memo links **up** to the canonical `memories/people`
memo via `[[<handle>]]` and carries only the project-specific relationship.
Identity stays in the one canonical memo.

Conventions are living rules: refresh with `overwrite=true`, never fork a
`-v2`. For bulk re-filing (>5 memories at once), tell the user what you're
about to move first.

---

## Commons — sharing memories beyond your vault (opt-in)

Bastra Commons is a separate, **opt-in, default-OFF**, PR-gated public Git repo of community-proven engineering recipes — **not** your private vault. `bastra commons enable` clones it read-only to `~/.bastra/commons`; the daemon then fuses its hits into `recall` under `scope: commons`, ranked just **below** your personal memories (on an id collision the personal hit wins). The daemon **never writes** the clone — all sharing is via reviewed PRs, never auto-egress.

Your memories never leave the machine. The only things ever shared are deliberately-authored recipes, your `works`/`fails` verification records, and (when enabled, `bastra bridges enable`) **scrubbed bridges** — language-tagged `trigger_terms → expansion_terms` lists that carry **no memory id, no body, no vault content**. The scrub drops digits, paths, emails, snake_case and hashes; the PR review gate is the real privacy guarantee.

Never `save_memory` into the commons and never treat a `scope: commons` recipe as your own state. Details: `docs/commons.md`.

---

## Tone with the user

- If you load a memory and apply it, you don't need to mention it unless asked. Just behave correctly. Silence is the best compliment to a working memory.
- Never ask permission for a strong-signal save — that defeats the purpose.
- Never narrate "I'm going to call recall now" — just call it.
