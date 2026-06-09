---
id: money-not-float
title: "Never store money as a binary float"
type: lesson
summary: "Represent money as integer minor units or a decimal type; binary floating point cannot represent most decimal fractions exactly, so sums drift."
topic_path: [data, money]
tags: [money, decimal, float, precision]
scope: all-projects
recall_when:
  - rounding errors adding prices
  - 0.1 plus 0.2 problem in totals
  - cents off by one in invoices
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Store amounts as integer cents or a fixed-precision decimal.

## Why
IEEE-754 doubles round most base-10 fractions, and the error accumulates across additions.

## How to apply
Use a decimal type in the DB and integer minor units in code; only convert to a display string at the edge.
