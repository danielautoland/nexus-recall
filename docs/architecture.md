# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Vault Layer                                                │
│  Path: ~/.claude/projects/<projectId>/memory/               │
│  Format: plain Markdown with strict YAML frontmatter        │
│  Compatibility: Logseq, Obsidian, any markdown editor       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Index Layer                                                │
│  Storage: SQLite (FTS5 virtual table for BM25)              │
│  Path: ~/.claude/projects/<projectId>/.nexus-recall/        │
│         index.db                                            │
│  Update trigger: file-watcher on vault directory            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP Server (Node.js / TypeScript)                          │
│  - stdio transport (standard for Claude Code MCP)           │
│  - Exposed tools:                                           │
│      recall(query, k?, filter?)                             │
│      loadMemory(id)                                         │
│      listMemories(filter)                                   │
│      saveMemory(payload)                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Hook Layer                                                 │
│  - UserPromptSubmit hook (shell script)                     │
│  - Calls MCP tool: recall(<user prompt>, k=3)               │
│  - Formats Top-3 as ~200 chars context injection            │
└─────────────────────────────────────────────────────────────┘
```

## 2-Stage Lookup — design rationale

The single biggest concern with auto-recall systems is context-window bloat. If every prompt grows by 50KB of memory snippets, the conversation hits compaction in 5 turns and the user pays for redundant tokens.

**Stage 1 (Hook, always-on):**
- Runs at every `UserPromptSubmit` event
- Calls MCP `recall(<user prompt>, k=3)`
- Injects ~200 characters: just IDs + 1-line summaries + relevance scores
- Anthropic prompt-caching keeps repeated topics effectively free

**Stage 2 (Tool, on-demand):**
- Claude decides whether the previewed memorys are worth loading
- Calls `loadMemory(id)` for full content (typically 500-2000 chars)
- Only loaded when relevant — no waste

This mirrors how a human researcher works: skim the table of contents (Stage 1), then fetch only the chapters that matter (Stage 2).

## Why BM25 first, not embeddings

Embeddings are tempting (semantic understanding!) but expensive in MVP terms:

- Local model (bge-m3, ~500MB): adds 50-200ms per prompt, complicates install, RAM pressure
- Cloud API (Voyage, OpenAI): per-call cost, network dependency, privacy concern

BM25 over a strict tag schema gets us 80%+ of the value with 10% of the complexity. Phase-4 upgrade path keeps embeddings as an optional backend — users who need semantic search can opt in.

## File watcher and index updates

```
Vault file changes (create / update / delete)
    │
    ▼
chokidar watcher
    │
    ▼
Re-index single file (fast, ~10ms)
    │
    ▼
SQLite FTS5 update
```

No full re-index needed for incremental changes. On startup, the server compares file `mtime` to indexed timestamps and re-indexes diffs.

## Multi-project support

Each Claude Code project gets its own vault directory under `~/.claude/projects/<projectId>/memory/` and its own SQLite index under `.nexus-recall/`. The MCP server detects the active project from the working directory or an env variable injected by Claude Code.

## Sync (Phase 5, not in MVP)

The vault is plain markdown — by design, any sync mechanism that handles markdown files works:

- iCloud Drive / Dropbox / OneDrive: works out of the box (folder sits in synced dir)
- Syncthing: peer-to-peer file sync
- Git: vault as a repo, push/pull controlled by user
- Hosted Premium tier: dedicated E2E-encrypted sync service (planned)

Conflict resolution strategies are an open question — likely last-write-wins for MVP, CRDT-based later.

## Tech stack rationale

- **Node.js / TypeScript:** matches the Claude Code plugin ecosystem (all current MCP servers are Node), simplest distribution via NPM
- **SQLite + FTS5:** zero-dependency embedded DB, BM25 built-in, already battle-tested for full-text search
- **chokidar:** standard Node file watcher
- **Anthropic MCP SDK:** official MCP server framework
