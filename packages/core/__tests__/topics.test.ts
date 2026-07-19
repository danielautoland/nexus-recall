/**
 * Tests for the PreToolUse recall-query builder (#231, language-first recall).
 *
 * The hook turns a Write/Edit intent into a recall() query. By DEFAULT that
 * query is now LANGUAGE-NEUTRAL: the file identifier (extension or basename)
 * plus deduped topic terms, no English filler verbs ("writing"/"editing") or
 * connectors ("involving"). On a non-English vault those template words spent
 * the lexical arm's vote on tokens the user's memories can't contain. The
 * signal lives in identifiers + topics, which are language-neutral already.
 *
 * Kill switch BASTRA_HOOK_QUERY=english restores the old action-verb template.
 *
 * Runner: node --import tsx --test packages/core/__tests__/topics.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTopics, extractContentExcerpt } from "../src/topics.js";

/** No English filler verb / connector may appear in the neutral query. */
const FILLER = /\b(writing|editing|involving)\b/;

function q(tool: string, file: string | null, content = "") {
  return detectTopics({ tool_name: tool, file_path: file, content_excerpt: content });
}

test("default query is language-neutral — no English filler verbs", () => {
  const r = q("Write", "/repo/src/components/Button.tsx", "useState()");
  assert.doesNotMatch(r.query, FILLER, `query must carry no filler: ${r.query}`);
  assert.ok(r.query.length > 0);
});

test("default query = fileLabel + deduped topics, stable order", () => {
  const r = q("Write", "/repo/src/components/Button.tsx", "useState()");
  // ext .tsx → react, tsx, component, ui; path components → (dupes); useState → react-hook, state
  assert.equal(r.query, "tsx react component ui react-hook state");
  // fileLabel "tsx" collapses with the ext topic "tsx" — appears exactly once
  assert.equal(r.query.split(" ").filter((t) => t === "tsx").length, 1);
});

test("default query no longer depends on tool_name (Write == Edit)", () => {
  const w = q("Write", "/repo/src/components/Button.tsx", "useState()");
  const e = q("Edit", "/repo/src/components/Button.tsx", "useState()");
  assert.equal(w.query, e.query);
});

test("default query is non-empty when topics are present", () => {
  const r = q("Edit", "/repo/db/schema.sql", "CREATE TABLE foo (id int)");
  assert.ok(r.topics.length > 0, "expected SQL topics");
  assert.ok(r.query.length > 0);
  assert.doesNotMatch(r.query, FILLER);
});

test("zero topics → query is the file identifier, still non-empty and neutral", () => {
  const r = q("Write", "/tmp/notes.xyz", "lorem ipsum dolor");
  assert.equal(r.topics.length, 0);
  assert.equal(r.query, "xyz"); // filetype identifier; no degenerate empty query
  assert.doesNotMatch(r.query, FILLER);
});

test("default query caps topic terms (bounded query length)", () => {
  const content = "<input/> <button/> useState() useEffect()";
  const r = q("Write", "/repo/src/forms/SignupForm.tsx", content);
  assert.ok(r.topics.length > 6, "test needs >6 detected topics to exercise the cap");
  const terms = r.query.split(" ");
  assert.ok(terms.length <= 7, `expected <=7 terms, got ${terms.length}: ${r.query}`);
});

test("BASTRA_HOOK_QUERY=english restores the old action-verb template", () => {
  const prev = process.env.BASTRA_HOOK_QUERY;
  try {
    process.env.BASTRA_HOOK_QUERY = "english";
    const w = q("Write", "/repo/src/components/Button.tsx", "useState()");
    assert.match(w.query, /^writing tsx involving /);
    const e = q("Edit", "/repo/src/components/Button.tsx", "useState()");
    assert.match(e.query, /^editing tsx involving /);
    // the old template DOES depend on tool_name (writing vs editing)
    assert.notEqual(w.query, e.query);

    // flag is case-insensitive
    process.env.BASTRA_HOOK_QUERY = "English";
    assert.match(q("Write", "/repo/a.ts", "").query, /^writing ts\b/);
  } finally {
    if (prev === undefined) delete process.env.BASTRA_HOOK_QUERY;
    else process.env.BASTRA_HOOK_QUERY = prev;
  }
});

test("unrelated BASTRA_HOOK_QUERY values keep the neutral default", () => {
  const prev = process.env.BASTRA_HOOK_QUERY;
  try {
    process.env.BASTRA_HOOK_QUERY = "de"; // not "english"
    const r = q("Write", "/repo/src/components/Button.tsx", "useState()");
    assert.doesNotMatch(r.query, FILLER);
  } finally {
    if (prev === undefined) delete process.env.BASTRA_HOOK_QUERY;
    else process.env.BASTRA_HOOK_QUERY = prev;
  }
});

test("extractContentExcerpt pulls Write content and caps length", () => {
  assert.equal(extractContentExcerpt("Write", { content: "hello" }), "hello");
  const big = "x".repeat(5000);
  assert.equal(extractContentExcerpt("Write", { content: big }, 100).length, 100);
});
