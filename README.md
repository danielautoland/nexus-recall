# nexus-recall

> A persistent teammate memory for Claude — across every Claude surface.

**Status:** 🟢 Early alpha — M0 (eval) and M1 (read path) done, M2 (save path) functional, M3 (PreToolUse hook) functional. Daemon runs locally, vault is live, hook injects `<recall-hints>` before every Write/Edit. Distribution and multi-surface are next. See [PLAN.md](./PLAN.md).

---

## Why

Working with Claude over months means re-explaining the same things. CSS pitfalls Claude already learned in one project recur in the next. Stable preferences (*"give me a recommendation, not a 5-option menu"*) get forgotten between sessions. Project-specific facts get re-discovered every time.

Claude has memory features, but they're **passive**: a static index file at best, no proactive recall, no cross-surface continuity.

The cost isn't just frustration — it's that the user ends up thinking *for* Claude. *"Wait, didn't we solve this last week?"* That's the bug.

## What nexus-recall does

A persistent memory layer that:

- **Saves autonomously** — when a lesson is learned (frustration, repeated correction, durable preference, finalized decision), Claude writes it to the vault without being asked. Trigger discipline is shipped as a Claude Code Skill (see [packages/skill/SKILL.md](./packages/skill/SKILL.md)).
- **Recalls before acting** — not only when the user prompts. The Skill instructs Claude to query the vault before writing code, before plans, and at session start; the highest-weighted search field is `recall_when`, declared at save time.
- **Works across surfaces** — one local daemon serves Claude Code via MCP today; Claude Desktop and Claude.ai web (Custom Connector) are on the roadmap.
- **Plain markdown, Obsidian-compatible** — the vault is a folder of `.md` files with YAML frontmatter. Edit in Obsidian, in Claude, by hand. Vaults on Google Drive / iCloud / Dropbox mounts are supported via automatic polling-mode in the file watcher.

## The single success metric

> **The user doesn't have to think for Claude anymore.**

If recurring mistakes still recur, if the user still has to re-state preferences each session — the project failed, regardless of how clean the architecture is.

## How it works

```
Vault (configurable, plain markdown + YAML frontmatter, Obsidian-compatible)
          │  chokidar (auto-polls on cloud-storage mounts)
          ▼
nexus-recall daemon (TypeScript / Node 20+, single local process)
  - In-memory BM25 index (MiniSearch) — recall_when×5, title×4, tags×3
  - MCP tools today: recall, load_memory, save_memory
  - Save path: validates frontmatter → writes file → force-reindexes
    (so a save and a recall in the same turn are consistent)
  - Transport: stdio MCP → Claude Code (Desktop + web on roadmap)
          │
          ▼
Claude Code Skill (packages/skill/SKILL.md)
  - "USE PROACTIVELY when …" trigger description
  - Carries the save/recall trigger discipline into every session
  - Single-file install, no settings.json edits
```

Hooks: a `PreToolUse` reflex hook ships with the daemon — Claude Code runs `nexus-recall-hook` before every `Write`/`Edit`/`MultiEdit`, which posts to the daemon's loopback HTTP endpoint and injects `<recall-hints>` as `additionalContext`. `SessionStart`, `UserPromptSubmit`, and `Stop` hooks are queued for v0.5 if the dogfood reveals gaps.

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

## Quickstart (current — manual; brew + init coming)

Pre-requisites: Node 20+, Claude Code, an Obsidian vault (or any folder for `.md` files).

```bash
git clone https://github.com/danielautoland/nexus-recall.git
cd nexus-recall/packages/daemon
npm install
npm run build
```

Add the MCP server to Claude Code (`~/.claude.json`):

```json
"nexus-recall": {
  "command": "node",
  "args": ["/abs/path/to/nexus-recall/packages/daemon/dist/index.js"],
  "env": {
    "NEXUS_VAULT_PATH": "/abs/path/to/your/vault/memorys"
  }
}
```

Activate the Skill (save/recall trigger discipline) and the PreToolUse hook (reflex recall before each Write/Edit):

```bash
bash packages/skill/install.sh        # copies SKILL.md → ~/.claude/skills/nexus-recall/
bash packages/skill/install-hook.sh   # registers PreToolUse hook in ~/.claude/settings.json
```

Then **restart Claude Code** — Skills and hooks are read at startup. The hook posts to `http://127.0.0.1:6723/hook/recall` (port configurable via `NEXUS_HTTP_PORT`); if no daemon is reachable it silently no-ops, so an unloaded MCP server never blocks Claude.

Re-run `install.sh` whenever `SKILL.md` changes; re-run `install-hook.sh` only if the hook binary path moves. To remove the hook again: `bash packages/skill/install-hook.sh --uninstall`.

A Homebrew tap and `nexus-recall init` are tracked as roadmap issues.

## Roadmap

Milestone-based, not phase-based. Each gate is a hard pass/fail.

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Recall-quality eval on real vault | ✅ **Done** — Recall@1 98.3%, Recall@3 100%, MRR 0.992 across 59 memorys (own-trigger baseline). BM25 + `recall_when`-boost is sufficient; embeddings deferred. |
| **M1** | Daemon + read path (`recall`, `load_memory`) | ✅ **Done** — MCP server live, watcher works on cloud-storage mounts. |
| **M2** | Save path + autonomous-save triggers | 🟡 **Functional** — `save_memory` MCP tool live with force-reindex. Trigger discipline shipped as a Skill. False-save / missed-save metrics not yet collected. |
| **M0.5** | Stress-test recall (paraphrased / cross-memory / anti-hallucination) | ⏳ Open — see issues. |
| **M3** | Reflex layer: hooks for `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `Stop` | 🟡 **Functional (PreToolUse only)** — `nexus-recall-hook` ships and posts to daemon's `/hook/recall`. Other hooks queued for v0.5 once dogfood data is in. |
| **Distribution** | Homebrew tap, `nexus-recall init`, npm package | ⏳ Open. |
| **Multi-surface** | HTTP transport for Claude.ai web (Custom Connector) | ⏳ Open. |

Out of v0: embeddings (deferred to v0.5 only if M0.5 fails), codebase indexing, multi-device sync, web UI, team-sharing, SaaS. See [PLAN.md](./PLAN.md).

## License

MIT — see [LICENSE](./LICENSE).

Public docs and code on this branch are published under the open license; private notes (in `private/`, gitignored) are not.

## Status & contact

Pre-alpha. See [PLAN.md](./PLAN.md). Issues and discussions welcome — early feedback shapes the design.

Built by [@danielautoland](https://github.com/danielautoland).
