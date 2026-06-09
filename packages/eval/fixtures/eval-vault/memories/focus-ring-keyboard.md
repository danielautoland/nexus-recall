---
id: focus-ring-keyboard
title: "Keep a visible focus ring for keyboard users"
type: lesson
summary: "Don't blanket-remove `outline`; keyboard and assistive-tech users rely on a visible focus indicator. Use `:focus-visible` to style it instead of hiding it."
topic_path: [accessibility, ui]
tags: [a11y, focus, keyboard, outline]
scope: all-projects
recall_when:
  - removed outline and keyboard nav disappeared
  - tab navigation has no visible indicator
  - accessibility focus state missing
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Style focus, don't delete it; prefer `:focus-visible`.

## Why
Without a focus indicator, keyboard-only users can't tell where they are on the page.

## How to apply
Replace `outline: none` with a `:focus-visible` ring that has sufficient contrast.
