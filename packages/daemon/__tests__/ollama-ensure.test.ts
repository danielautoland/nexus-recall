import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureOllama } from "../src/cli/ollama.js";

// These cover the paths that must NEVER spawn a subprocess or download
// anything — the safety guards. We deliberately do not test the acting path
// (it would shell out to brew/ollama).

test("ensureOllama: --no-ollama skips, no detection, no mutation", async () => {
  const r = await ensureOllama({ dryRun: false, mode: "skip" });
  assert.equal(r.status, "skipped");
  assert.equal(r.activated, false);
});

test("ensureOllama: env BASTRA_EMBEDDING_PROVIDER=none blocks setup before any download", async () => {
  const prev = process.env.BASTRA_EMBEDDING_PROVIDER;
  process.env.BASTRA_EMBEDDING_PROVIDER = "none";
  try {
    // mode "auto" would otherwise act — the env guard must short-circuit first.
    const r = await ensureOllama({ dryRun: false, mode: "auto" });
    assert.equal(r.status, "env-override");
    assert.equal(r.activated, false);
  } finally {
    if (prev === undefined) delete process.env.BASTRA_EMBEDDING_PROVIDER;
    else process.env.BASTRA_EMBEDDING_PROVIDER = prev;
  }
});
