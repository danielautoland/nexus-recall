---
id: css-flexbox-min-width-zero
title: "Flex children overflow until you set min-width:0"
type: lesson
summary: "A flex item defaults to min-width:auto, so its content can push the container wider than intended; set min-width:0 (or min-height:0) to let it shrink and truncate."
topic_path: [css, flexbox]
tags: [css, flexbox, overflow, layout]
scope: all-projects
recall_when:
  - text not truncating inside a flex row
  - child stretches container instead of ellipsis
  - overflow ignored in flex layout
recall_when_expanded:
  - long label refuses to clip inside a flexible column
  - content forces its box wider than the layout allows
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Add `min-width: 0` to a flex child that should be allowed to shrink.

## Why
The implicit `min-width: auto` keeps the item at least as wide as its content, defeating `overflow: hidden`.

## How to apply
Set `min-width: 0` on the flex item (and `overflow: hidden; text-overflow: ellipsis` on the text).
