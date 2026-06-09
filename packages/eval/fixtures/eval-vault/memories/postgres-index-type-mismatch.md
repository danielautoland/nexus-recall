---
id: postgres-index-type-mismatch
title: "Planner skips an index when column types don't match"
type: lesson
summary: "If a predicate compares a column to a value of a different type (e.g. bigint column vs numeric literal), Postgres may not use the index; align the types or cast explicitly."
topic_path: [postgres, performance]
tags: [postgres, index, query-planner, sql]
scope: all-projects
recall_when:
  - query ignores the index I created
  - seq scan despite an index
  - why is my index not used
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Match the predicate's type to the indexed column's type.

## Why
A type mismatch forces a coercion that the planner cannot satisfy with the existing index, so it falls back to a scan.

## How to apply
Check `EXPLAIN`, then cast the literal/parameter to the column type (or fix the column type).
