# nexus-recall

> Persistent memory & codebase-index for Claude Code.

**Status:** 🟡 Pre-alpha — currently in initial design / public planning phase. No code yet, see [PLAN.md](./PLAN.md).

---

## Why

Claude Code has a passive memory system: a markdown index gets loaded into every prompt, but **detail-memorys are never proactively surfaced**. Cross-cutting concerns (schema migrations, service-caller topology, deprecated patterns) stay invisible until a bug hits.

Real example from 2026-04-30: a PDF-export bug for `damageImages` slipped through, even though a memory `project_v11_vs_legacy_schemas.md` documented exactly the V11-vs-legacy schema coexistence that caused it. The memory existed. Claude didn't recall it actively.

`nexus-recall` fixes this with a **2-stage hierarchical lookup**:

1. **Stage 1 (automatic, ~200 chars / prompt):** A `UserPromptSubmit` hook runs BM25 search over your memory tags + titles. If anything matches, it injects a tiny preview ("memorys for topic 'X': [t1, t2, t3]") into the context.
2. **Stage 2 (on-demand):** Claude calls `recall(id)` to load the full memory only when it actually needs the detail.

Token-overhead per prompt stays tiny. Anthropic prompt-caching makes returning topics effectively free.

## Vision

**„Obsidian for Claude Code"** — file-based markdown vault as source-of-truth, hierarchical search, codebase-topology, local-first, optionally synced.

**Differentiation vs. existing tools:**

| | Cursor Memory | Claude Code (built-in) | nexus-recall |
|---|---|---|---|
| Format | Cloud-only, opaque | Plain markdown ✓ | Plain markdown ✓ |
| Active recall | ✓ | ✗ | ✓ |
| Codebase topology | partial | ✗ | ✓ (planned) |
| Multi-device sync | ✓ (Cloud-only) | ✗ | ✓ (your-choice + optional hosted) |
| Open source | ✗ | ✗ | ✓ MIT |
| Self-hostable | ✗ | n/a | ✓ |

## Architecture (MVP)

```
Vault (~/.claude/projects/<projectId>/memory/, plain Markdown)
                    │
                    ▼
nexus-recall MCP-Server (Node.js / TypeScript)
  Tools exposed to Claude:
    - recall(query)        → BM25 search, top-K with snippets
    - loadMemory(id)       → full memory by id
    - listMemories(filter) → filtered by tag / scope
    - saveMemory(payload)  → persist with schema validation
  Storage: SQLite + FTS5 (full-text index)
                    │
                    ▼
UserPromptSubmit-Hook (~200 chars context injection per prompt)
```

See [docs/architecture.md](./docs/architecture.md) for detail.

## Quickstart (planned, not yet implemented)

```bash
# Install
npm install -g nexus-recall

# Init in your project
cd ~/your/project
nexus-recall init

# Migrate existing Claude Code memorys to strict schema
nexus-recall migrate ~/.claude/projects/<your-project-id>/memory/

# That's it — Claude Code now uses recall automatically via plugin
```

## Memory schema (strict)

```yaml
---
title: "PDF export for damage images"
type: "feedback" | "project" | "reference" | "decision"
tags: ["pdf-export", "schema-v2", "images"]
scope: ["project:myapp", "feature:image-export"]
summary: "v2 uses category='damage' instead of damageImages — paths in unified images folder"
created: "2026-04-30"
updated: "2026-04-30"
related: ["v2-vs-legacy-schemas"]
---

# Markdown body...
```

See [docs/memory-schema.md](./docs/memory-schema.md).

## Roadmap

| Phase | Scope | Effort |
|---|---|---|
| **Phase 1 (MVP)** | Memory-recall MCP + UserPromptSubmit-hook + BM25 + schema-migration | 1-2 weeks |
| **Phase 2** | Codebase indexing: AST-parsing for JS/TS, topology-map | 2-3 weeks |
| **Phase 3** | Git-history + GitHub-issues as additional index sources | 1 week |
| **Phase 4** | Embeddings upgrade (local: bge-m3 / cloud: Voyage) | 1-2 weeks |
| **Phase 5** | Sync-layer (free: git/iCloud-friendly; premium: hosted) | 3-4 weeks |
| **Phase 6** | Web-UI, team-sharing, SaaS-tier | 4-6 weeks |
| **Phase 7** | Marketing site + hosted-tier launch | parallel |

## License

MIT — see [LICENSE](./LICENSE).

## Status & contact

Pre-alpha. See [PLAN.md](./PLAN.md) for the design. Issues + discussions welcome — early feedback shapes the architecture.

Built by [@danielautoland](https://github.com/danielautoland).
