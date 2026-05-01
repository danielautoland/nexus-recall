# nexus-recall

> A persistent teammate memory for Claude — across every Claude surface.

**Status:** 🟡 Pre-alpha — design phase, no code yet. See [PLAN.md](./PLAN.md).

---

## Why

Working with Claude over months means re-explaining the same things. CSS pitfalls Claude already learned in one project recur in the next. Stable preferences (*"give me a recommendation, not a 5-option menu"*) get forgotten between sessions. Project-specific facts get re-discovered every time.

Claude has memory features, but they're **passive**: a static index file at best, no proactive recall, no cross-surface continuity.

The cost isn't just frustration — it's that the user ends up thinking *for* Claude. *"Wait, didn't we solve this last week?"* That's the bug.

## What nexus-recall does

A persistent memory layer that:

- **Saves autonomously** — when a lesson is learned (frustration, repeated correction, durable preference, finalized decision), Claude writes it to the vault without being asked.
- **Recalls before acting** — not only when the user prompts. A `PreToolUse` hook fires when Claude is about to write code; relevant lessons surface *before* the mistake happens.
- **Works across surfaces** — one local daemon serves Claude Code, Claude Desktop, Claude.ai web/chat, Co-work. One vault, one source of truth.
- **Plain markdown, Obsidian-compatible** — the vault is a folder of `.md` files. Edit in Obsidian, in Claude, by hand.

## The single success metric

> **The user doesn't have to think for Claude anymore.**

If recurring mistakes still recur, if the user still has to re-state preferences each session — the project failed, regardless of how clean the architecture is.

## How it works

```
Vault (~/nexus-vault/, plain markdown + YAML frontmatter)
          │  watcher
          ▼
nexus-recall daemon (TypeScript, single local process)
  - SQLite + FTS5 index (graph relations + keyword search)
  - MCP tools: recall, load_memory, save_memory, list_memorys, link_memorys
  - Two transports:
      • stdio MCP   → Claude Code, Claude Desktop
      • HTTP MCP    → Claude.ai web (Custom Connector)
          │
          ▼
Hooks (per Claude Code session):
  - SessionStart      → preload preferences + project facts
  - UserPromptSubmit  → recall against the prompt
  - PreToolUse(Write) → recall against what Claude is about to write
  - Stop              → evaluate save-worthy moments
```

Details: [docs/architecture.md](./docs/architecture.md), [docs/memory-schema.md](./docs/memory-schema.md), [docs/triggers.md](./docs/triggers.md).

## Memory shape

Each memory is a markdown file with structured frontmatter:

```yaml
---
id: css-input-focus-ring-stacking
title: "Don't stack focus styles on inputs"
type: lesson
summary: "Stacking ring + outline + custom :focus on nested inputs causes double focus rings. Use single :focus-visible."
topic_path: [css, input, focus]
tags: [css, input, focus-ring, ui-bug]
scope: all-projects
recall_when:
  - creating new input component
  - writing input or form css
  - focus or accessibility styling
related: [css-effects-stacking-antipattern]
source: "carnexus, recurring lesson"
confidence: 0.95
---
```

The `recall_when` field is the bridge between save and recall: when saving, Claude declares the contexts under which future-Claude should be reminded. See [docs/memory-schema.md](./docs/memory-schema.md) for full field semantics and six example memorys covering `lesson`, `preference`, `project-fact`, `meta-working`, `decision`, `workflow`.

## Quickstart (planned, not yet implemented)

```bash
brew install danielautoland/tap/nexus-recall
nexus-recall init                  # creates vault, registers launchd daemon
nexus-recall doctor                # health check
# Add the MCP server to Claude Code / Desktop config (init prints the snippet)
```

## Roadmap

Milestone-based, not phase-based. Each gate is a hard pass/fail.

| Milestone | Scope | Pass criterion |
|---|---|---|
| **M0** | Eval harness on 20 real Q-A pairs | Recall@3 ≥ 0.7 with FTS5 alone |
| **M1** | Daemon + read path (recall, load_memory) | CSS lesson surfaces in real Claude Code session |
| **M2** | Save path + autonomous-save triggers | Strong-signal saves fire without user prompt; false-save < 10% |
| **M3** | PreToolUse hook + dogfood week | ≥ 1 concrete bug avoided; user says *"ich vergesse, dass es da ist"* |

Out of v0: embeddings (deferred to v0.5 only if M0 fails), codebase indexing, multi-device sync, web UI, team-sharing, SaaS. See [PLAN.md](./PLAN.md).

## License

MIT — see [LICENSE](./LICENSE).

Public docs and code on this branch are published under the open license; private notes (in `private/`, gitignored) are not.

## Status & contact

Pre-alpha. See [PLAN.md](./PLAN.md). Issues and discussions welcome — early feedback shapes the design.

Built by [@danielautoland](https://github.com/danielautoland).
