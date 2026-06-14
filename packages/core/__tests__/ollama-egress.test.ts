/**
 * Tests for src/ollama-egress.ts — the shared loopback/opt-in guard (#124/#125),
 * plus its enforcement on the embedding provider (the #125 gap).
 *
 * Run: npx tsx --test packages/core/__tests__/ollama-egress.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { assertLocalOrOptIn } from "../src/ollama-egress.js";
import { OllamaEmbeddingProvider } from "../src/embeddings.js";

function withoutOptIn(fn: () => void): void {
  const prev = process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
  delete process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
    else process.env.BASTRA_ALLOW_REMOTE_OLLAMA = prev;
  }
}

function withOptIn(fn: () => void): void {
  const prev = process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
  process.env.BASTRA_ALLOW_REMOTE_OLLAMA = "1";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
    else process.env.BASTRA_ALLOW_REMOTE_OLLAMA = prev;
  }
}

// ─── the guard itself (mirrors the reranker's #124 tests) ──────────

test("assertLocalOrOptIn allows loopback endpoints", () => {
  for (const u of ["http://localhost:11434", "http://127.0.0.1:11434", "http://[::1]:11434"]) {
    assert.doesNotThrow(() => assertLocalOrOptIn(u), `${u} should be allowed`);
  }
});

test("assertLocalOrOptIn refuses a non-loopback endpoint unless opted in", () => {
  withoutOptIn(() => {
    assert.throws(() => assertLocalOrOptIn("http://10.0.0.5:11434"), /non-loopback/);
  });
  withOptIn(() => {
    assert.doesNotThrow(() => assertLocalOrOptIn("http://10.0.0.5:11434"));
  });
});

test("assertLocalOrOptIn lets a malformed URL through (fetch reports it, behaviour unchanged)", () => {
  assert.doesNotThrow(() => assertLocalOrOptIn("not a url"));
});

// ─── the #125 gap: the embedding provider must enforce it too ──────

test("OllamaEmbeddingProvider: loopback baseURL (and the default) construct fine", () => {
  withoutOptIn(() => {
    assert.doesNotThrow(() => new OllamaEmbeddingProvider({}));
    assert.doesNotThrow(() => new OllamaEmbeddingProvider({ baseURL: "http://127.0.0.1:11434" }));
  });
});

test("OllamaEmbeddingProvider: a remote baseURL is refused unless opted in (#125)", () => {
  withoutOptIn(() => {
    assert.throws(() => new OllamaEmbeddingProvider({ baseURL: "http://10.0.0.5:11434" }), /non-loopback/);
  });
  withOptIn(() => {
    assert.doesNotThrow(() => new OllamaEmbeddingProvider({ baseURL: "http://10.0.0.5:11434" }));
  });
});
