---
id: docker-manifest-before-source
title: "Copy the dependency manifest before source for cache reuse"
type: lesson
summary: "In a Dockerfile, COPY package.json + lockfile and install deps before COPYing the rest of the source, so editing code doesn't bust the dependency layer."
topic_path: [docker, build]
tags: [docker, layer-cache, dockerfile, build-speed]
scope: all-projects
recall_when:
  - docker reinstalls deps on every build
  - slow image rebuilds after a code change
  - layer cache keeps invalidating
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Order Dockerfile steps from least- to most-frequently changing.

## Why
A COPY of changed source invalidates every layer after it, including a dependency install placed below it.

## How to apply
COPY the manifest + lockfile, run install, then COPY the rest of the source.
