---
id: secrets-in-env
title: "Keep secrets in the environment, never commit them"
type: lesson
summary: "Credentials belong in environment variables or a secret manager, not in source. If one is committed, rotate it — removing the file doesn't erase it from history."
topic_path: [security, secrets]
tags: [secrets, env, credentials, rotation]
scope: all-projects
recall_when:
  - api key accidentally pushed to git
  - rotating a leaked token
  - where to put credentials safely
recall_when_expanded:
  - credential leaked into version control history
  - revoke and reissue a token that escaped
related: []
related_via: []
sensitivity: public
source: "synthetic eval fixture"
confidence: 0.85
created: 2026-05-01
updated: 2026-05-01
---

## Rule
Secrets live in env/secret manager; a committed secret is a compromised secret.

## Why
Git history retains the value even after deletion, so the only safe response is rotation.

## How to apply
Load from env, add the file to `.gitignore`, and rotate immediately if one leaks.
