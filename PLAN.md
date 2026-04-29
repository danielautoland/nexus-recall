# Nexus-Recall — Persistent Memory & Codebase-Index für Claude Code

## Context

**Warum dieses Projekt:**
Am 2026-04-30 entstand ein Schadensbilder-PDF-Bug, weil Claude die V11-vs-Legacy-Schema-Coexistenz übersehen hatte — obwohl die `DAMAGE_CATEGORY`-Konstante direkt in der gelesenen Datei stand und Memorys zu V11 existierten. Symptom eines strukturellen Problems: **Claude Code's Memory-System ist passiv**. Es lädt eine statische Index-Liste (MEMORY.md) in den Kontext, surfact aber relevante Detail-Memorys nicht aktiv. Cross-Cutting-Concerns (Schema-Migrationen, Service-Aufrufer-Topologie) bleiben unsichtbar bis ein Bug auftritt.

**Marktlücke:**
- Cursor's Memory ist Cloud-only, intransparent, Lock-In
- Claude Code's Memory ist file-based aber rudimentär (kein Search, keine Codebase-Indizierung)
- Keine bestehende Lösung kombiniert: Markdown-First + Auto-Recall + Codebase-Topology + User-Owned-Data + Multi-Device

**Ziel:**
„Obsidian für Claude Code" — file-based Markdown-Vault als Source-of-Truth + proaktive 2-Stage-Suche + Codebase-Topology, lokal-first, monetarisierbar als Hosted-SaaS-Layer.

## Architektur (MVP)

```
┌─────────────────────────────────────────────────────────────┐
│  Vault (~/.claude/projects/<projectId>/memory/, plain MD)   │
│  - Memorys mit Strict-Frontmatter (title, tags, scope, ...) │
│  - Format kompatibel mit Logseq, Obsidian, plain Markdown   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  nexus-recall MCP-Server (Node.js / TypeScript)             │
│  Tools (exposed an Claude):                                 │
│    - recall(query)        → BM25-Search, Top-K + snippets   │
│    - loadMemory(id)       → vollständige Memory-Datei       │
│    - listMemories(filter) → tag-/scope-gefiltert            │
│    - saveMemory(payload)  → schreibt mit Schema-Validation  │
│  Storage: SQLite + FTS5 (Volltext-Index)                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  UserPromptSubmit-Hook (~200 chars Injektion pro Prompt)    │
│  - Macht BM25-Topic-Match auf User-Prompt                   │
│  - Injiziert: "Memorys zum Thema: [t1, t2, t3] — recall()"  │
│  - Claude entscheidet: Detail laden via recall(id) oder nicht│
└─────────────────────────────────────────────────────────────┘
```

### 2-Stage Lookup (Kern-Innovation für Token-Efficiency)

**Stage 1 (Hook, automatisch):** ~200 chars in Context. Antwortet nur „gibt's was zum Thema?". BM25 über Tags + Title + Summary.

**Stage 2 (Tool, on-demand):** `recall(id)` lädt volles Memory nur wenn Claude es aktiv anfordert. Anthropic Prompt-Caching greift bei wiederkehrenden Memorys → effektiv kostenlos.

**Token-Budget pro Prompt:**
- Stage 1: ~200 chars (constant, gecached)
- Stage 2: ~500-2000 chars (nur on-demand)

## Memory-Schema (Strict)

```yaml
---
title: "PDF export for damage images"              # Pflicht, sucht-relevant
type: "feedback" | "project" | "reference" | "decision"
tags: ["pdf-export", "schema-v2", "images"]        # Pflicht, BM25-Schlüssel
scope: ["project:myapp", "feature:image-export"]
summary: "v2 nutzt category='damage' statt damageImages — Pfade in unified images-Ordner"
created: "2026-04-30"
updated: "2026-04-30"
related: ["v2-vs-legacy-schemas", "memo-bailout-pattern"]
---

# Markdown-Body...
```

Validation beim `saveMemory` → konsistente Tags = verlässliche Suche.

## MVP — Phase 1 (1-2 Wochen)

**Scope:** nur Memory-Recall, keine Codebase-Indexierung. Schnellste Lösung für den Auto-Recall-Schmerz.

**Deliverables:**
1. MCP-Server (`nexus-recall-mcp`, Node.js/TS, NPM-Package)
   - Tools: `recall(query)`, `loadMemory(id)`, `listMemories(filter)`, `saveMemory(payload)`
   - SQLite + FTS5 als Index, gespeichert unter `~/.claude/projects/<id>/.nexus-recall/index.db`
   - File-Watcher: re-indiziert bei Memory-Änderung
2. Plugin-Bundle für Claude Code Plugin-Marketplace
   - `hooks/hooks.json` mit `UserPromptSubmit` → Shell-Script
   - Stage-1-Skript: ruft MCP-Tool, formatiert Top-3 als Context-Injection
3. Schema-Migration-Tool: konvertiert existing Memorys aus `~/.claude/projects/<projectId>/memory/` ins Strict-Schema (Tags-Vorschläge via LLM, User-bestätigt)
4. CLI: `nexus-recall init/index/search/save` für manuelle Operationen

**Verification:**
- Test-Szenario: User-Prompt „Müssen wir den PDF-Export für Schadensbilder fixen?" → Stage-1 muss `project_v11_vs_legacy_schemas.md` als Top-Treffer liefern
- Mindestens 80% Recall@3 auf einem Test-Set von 20 Q-A-Paaren aus existierenden Memorys
- Token-Overhead pro Prompt: <300 chars (gemessen)
- Cold-Start Latenz: <50ms (Stage-1 Hook)

## Roadmap

| Phase | Scope | Aufwand |
|---|---|---|
| **Phase 1 (MVP)** | Memory-Recall MCP + UserPromptSubmit-Hook + BM25 + Schema-Migration | 1-2 Wochen |
| **Phase 2** | Codebase-Indexierung: AST-Parsing für JS/TS, Topology-Map (`topology(component)` Tool) | 2-3 Wochen |
| **Phase 3** | Git-History + GitHub-Issues als zusätzliche Index-Quellen | 1 Woche |
| **Phase 4** | Embeddings-Upgrade (lokal: bge-m3 / Cloud: Voyage), Hybrid-Search | 1-2 Wochen |
| **Phase 5** | Sync-Layer (Du-wählst-Sync gratis: Git/iCloud-kompatibel; Hosted-Sync premium) | 3-4 Wochen |
| **Phase 6** | Web-UI (View/Edit/Search), Team-Sharing, SaaS-Tier | 4-6 Wochen |
| **Phase 7** | Marketing-Site + Hosted-Tier-Launch | parallel |

## Monetarisierung

OSS-Core (MIT) plus optionaler Hosted-Tier. Konkrete Tier-Struktur und Preise werden separat festgelegt.

## Open Questions (für Issues nach Repo-Erstellung)

1. **Multi-Device-Privacy-Strategie:** wenn User 4 Geräte hat (Office/Home × Desktop/Laptop), wie wird der Sync-Konflikt gelöst? Last-write-wins, CRDT, manuelle Resolution?
2. **Embeddings-Provider** für Phase 4: lokales Modell (bge-m3, kein Cloud-Call) vs. Voyage/OpenAI (beste Qualität, aber Daten-Sicht)?
3. **Marketplace-Distribution:** Claude-Plugin-Marketplace direkt, eigener Marketplace, beides?
4. **Schema-Versioning:** wie handhaben wir Schema-Migrationen wenn Vault zwischen v1 und v2 wechselt?

## Critical Files (after Phase 1 build)

- `packages/mcp-server/src/index.ts` — MCP-Tool-Definitionen
- `packages/mcp-server/src/search/bm25.ts` — SQLite FTS5 Wrapper
- `packages/mcp-server/src/schema/validator.ts` — Frontmatter-Validation
- `packages/plugin/hooks/user-prompt-submit.sh` — Stage-1 Hook-Script
- `packages/plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json` — Plugin-Bundle
- `packages/cli/src/commands/{init,index,search,save,migrate}.ts` — CLI

## Erfolgs-Kriterium MVP

Wenn der MVP läuft, hätte Claude beim heutigen Schadensbild-Bug den Memory-Eintrag `project_v11_vs_legacy_schemas.md` automatisch in Stage-1 angezeigt bekommen (~200 chars: „Memorys zum Thema 'PDF-Export Schadensbilder': V11 vs Legacy-Schemas (relevance 0.92)") und über `recall(id)` aktiv geladen — bevor er den Bug-fix-Code schreibt. **Bug nicht entstanden.**
