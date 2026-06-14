/**
 * Tests for src/learned-recall/reranker.ts — prompt build + answer parse (no live model).
 *
 * Run: npx tsx --test packages/daemon/__tests__/learned-recall-reranker.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { assertLocalOrOptIn, buildRerankPrompt, parseRerankAnswer, rerank, type RerankCandidate } from "../src/learned-recall/reranker.js";

const CANDS: RerankCandidate[] = [
  { id: "a", text: "css flexbox note" },
  { id: "b", text: "NSPanel resignKey observer" },
  { id: "c", text: "ollama cpu load" },
];

test("buildRerankPrompt numbers candidates and includes the query", () => {
  const p = buildRerankPrompt("warum schließt das Panel", CANDS);
  assert.ok(p.includes('"warum schließt das Panel"'));
  assert.ok(p.includes("1. css flexbox note"));
  assert.ok(p.includes("2. NSPanel resignKey observer"));
  assert.ok(p.includes("3. ollama cpu load"));
  assert.ok(/number \(1-3\)/.test(p));
});

test("parseRerankAnswer extracts a valid 1-based index", () => {
  assert.equal(parseRerankAnswer("2", 3), 2);
  assert.equal(parseRerankAnswer("The best is 3.", 3), 3);
  assert.equal(parseRerankAnswer("Answer: 1", 3), 1);
});

test("parseRerankAnswer returns null for 0, out-of-range, or no number", () => {
  assert.equal(parseRerankAnswer("0", 3), null);
  assert.equal(parseRerankAnswer("none fit", 3), null);
  assert.equal(parseRerankAnswer("5", 3), null);
  assert.equal(parseRerankAnswer("", 3), null);
});

test("rerank returns the chosen id and its 1-based rank", async () => {
  const r = await rerank("q", CANDS, async () => "2");
  assert.equal(r.bestId, "b");
  assert.equal(r.chosenRank, 2);
});

test("rerank returns null bestId when the model picks none", async () => {
  const r = await rerank("q", CANDS, async () => "0");
  assert.equal(r.bestId, null);
  assert.equal(r.chosenRank, null);
});

test("rerank handles an empty candidate list without calling the model", async () => {
  let called = 0;
  const r = await rerank("q", [], async () => { called++; return "1"; });
  assert.equal(called, 0);
  assert.equal(r.bestId, null);
});

test("assertLocalOrOptIn allows loopback endpoints", () => {
  for (const u of ["http://localhost:11434", "http://127.0.0.1:11434", "http://[::1]:11434"]) {
    assert.doesNotThrow(() => assertLocalOrOptIn(u), `${u} should be allowed`);
  }
});

test("assertLocalOrOptIn refuses a non-loopback endpoint unless opted in", () => {
  const prev = process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
  delete process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
  try {
    assert.throws(() => assertLocalOrOptIn("http://10.0.0.5:11434"), /non-loopback/);
    process.env.BASTRA_ALLOW_REMOTE_OLLAMA = "1";
    assert.doesNotThrow(() => assertLocalOrOptIn("http://10.0.0.5:11434"));
  } finally {
    if (prev === undefined) delete process.env.BASTRA_ALLOW_REMOTE_OLLAMA;
    else process.env.BASTRA_ALLOW_REMOTE_OLLAMA = prev;
  }
});

test("assertLocalOrOptIn lets a malformed URL through (fetch reports it, behaviour unchanged)", () => {
  assert.doesNotThrow(() => assertLocalOrOptIn("not a url"));
});
