---
id: timestamps-store-utc
title: "Persist timestamps in UTC, format only on display"
type: lesson
summary: "Store and compute in UTC; convert to a local zone only when rendering. Storing local time loses the offset and breaks across DST and regions."
topic_path: [time, data]
tags: [timezone, utc, datetime, dst]
scope: all-projects
recall_when:
  - times shift after deploy to another region
  - daylight saving breaks scheduling
  - wrong hour shown to users abroad
recall_when_expanded:
  - meeting times off by an hour after the clock change
  - normalize instants to one reference zone before saving
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
UTC at rest and in logic; local zone only at the presentation edge.

## Why
A naive local timestamp can't be compared or re-localized once the offset is gone.

## How to apply
Store `timestamptz`/epoch UTC, keep the user's zone separately, format with it on output.
