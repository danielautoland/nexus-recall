---
id: backoff-jitter
title: "Add jitter to exponential backoff"
type: lesson
summary: "Exponential backoff alone still lets many clients retry on the same schedule; add randomized jitter so recovery traffic spreads out instead of spiking."
topic_path: [reliability, retries]
tags: [backoff, jitter, retry, resilience]
scope: all-projects
recall_when:
  - thundering herd when a service recovers
  - all clients retry at the same instant
  - retries hammer the API in sync
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Randomize each retry delay within the backoff window.

## Why
Deterministic backoff keeps clients phase-locked, so they all hit the recovering service together.

## How to apply
Use full or decorrelated jitter on top of the exponential schedule.
