---
id: debounce-vs-throttle
title: "Debounce to wait for settle, throttle to cap the rate"
type: lesson
summary: "Debounce delays a callback until input stops (good for search-as-you-type); throttle guarantees at most one call per interval (good for scroll/resize)."
topic_path: [javascript, events]
tags: [debounce, throttle, events, rate-limit]
scope: all-projects
recall_when:
  - search box fires too many requests while typing
  - scroll handler runs too often
  - limit how often a callback runs
recall_when_expanded:
  - delay firing until the user stops interacting
  - cap how frequently an expensive listener executes
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Pick debounce when you want the final value, throttle when you want a steady cadence.

## Why
They solve different problems: settle-after-quiet vs. fixed maximum frequency.

## How to apply
Debounce the input handler for a search field; throttle the scroll/resize listener.
