# Memory Schema

## Frontmatter (required)

```yaml
---
title: "Short, descriptive title"               # required, search-relevant
type: "feedback" | "project" | "reference" | "decision"   # required
tags: ["tag1", "tag2", "tag3"]                  # required, BM25 keys
scope: ["project:name", "feature:area"]         # optional, filter scope
summary: "One-line description, ≤200 chars"     # required, used in Stage-1 preview
created: "YYYY-MM-DD"                           # required, auto-set
updated: "YYYY-MM-DD"                           # required, auto-updated
related: ["other-memory-id-1", "other-memory-id-2"]   # optional
---

# Body — full markdown content goes here
```

## Field semantics

### `title`
Short, descriptive headline. Will be used directly in Stage-1 preview output. Should answer: "What is this memory about?" in 5-10 words.

### `type`
One of:
- **`feedback`** — user preference / behavior guidance ("don't do X", "always Y")
- **`project`** — work-in-progress info, decisions, roadmaps, known issues
- **`reference`** — pointers to external systems, dashboards, doc URLs
- **`decision`** — architectural decision records (ADRs)

The type drives default ranking weights and UI grouping.

### `tags`
Lowercase kebab-case keywords. **Most important for BM25 matching.** Aim for 3-7 tags. Examples:
- Technology: `react`, `mongodb`, `pdf-export`
- Feature area: `image-export`, `auth`, `billing`
- Version: `v11`, `legacy`, `v2`
- Domain: `pricing`, `inventory`, `customer`

Avoid: full sentences, generic words like "code" or "issue".

### `scope`
Hierarchical filters. Used by `listMemories(filter)` and to limit search to a subset of memorys.
- `project:<name>` — limit to a specific project
- `feature:<name>` — feature within a project
- `team:<name>` — team-shared memorys (Phase 6)

A memory can have multiple scopes.

### `summary`
**One line, ≤200 chars.** This text appears in Stage-1 context injection — it's what Claude sees in its "table of contents". Make it information-dense:

✅ Good: `"V11 stores damage images as vehicleImages with category='damage' (path in vehicle-images folder), not in legacy damageImages array"`

❌ Bad: `"Notes about V11 image handling"`

### `created`, `updated`
ISO date strings (`YYYY-MM-DD`). Auto-set by `saveMemory`. Used for time-based filtering and decay (older memorys can be ranked lower).

### `related`
References to other memory IDs (filename without `.md`). Builds a knowledge graph — `recall()` can follow related links to surface connected memorys.

## Validation

`saveMemory(payload)` rejects memorys that:
- Lack any required field
- Have empty `tags` (need at least 1)
- Have `summary` > 200 chars
- Have invalid `type` value

The CLI's `nexus-recall lint` command checks all vault memorys for compliance.

## Migration from existing memorys

`nexus-recall migrate <path>` walks through existing markdown files (e.g., the current Claude Code memory directory) and:

1. Reads existing frontmatter (already mostly compatible)
2. Auto-suggests `tags` based on filename + heading + content
3. Auto-generates `summary` from first paragraph (or uses LLM if available)
4. Prompts user to confirm/edit each migration
5. Writes back with strict schema

Existing fields like `name`, `description`, `originSessionId` are preserved as-is in the body or in a `legacy:` block — no data loss.

## Example

```markdown
---
title: "v2 vs Legacy — image schema migration"
type: project
tags: ["schema-v2", "pdf-export", "schema-migration", "images"]
scope: ["project:myapp", "feature:image-export"]
summary: "v2 uses unified images array with category='damage' instead of separate damageImages — both sources must be combined in damage-related operations"
created: "2026-04-30"
updated: "2026-04-30"
related: ["app-topology-first", "memo-bailout-pattern"]
---

v2 has replaced the legacy form. Schema differences:

**Damage images:**
- Legacy: `formData.damageImages[]` — files in `damage-images/` folder
- v2: `formData.images[]` with `category='damage'` — files in unified `images/` folder

(... rest of memory content ...)
```
