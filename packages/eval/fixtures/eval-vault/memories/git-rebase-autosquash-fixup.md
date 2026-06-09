---
id: git-rebase-autosquash-fixup
title: "Use fixup commits + autosquash for review fixes"
type: lesson
summary: "Address review comments with `git commit --fixup <sha>` then `git rebase -i --autosquash`, so corrections fold into the commit they belong to instead of piling up at the end."
topic_path: [git, workflow]
tags: [git, rebase, commits, review]
scope: all-projects
recall_when:
  - cleaning up commits before merge
  - squashing review feedback into the right commit
  - messy history before a PR
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Make a `--fixup` commit targeting the original, then autosquash on rebase.

## Why
Review fixes that sit as separate commits make the final history hard to read and bisect.

## How to apply
`git commit --fixup <sha>` while iterating, then `git rebase -i --autosquash <base>` before merging.
