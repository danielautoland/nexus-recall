/**
 * Unit tests for detectProject/detectProjectDetailed (#360-Folgefund C):
 * the old detectProject() returned SOME string for every non-empty path,
 * making a real repo-root match indistinguishable from a last-segment guess.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectProject, detectProjectDetailed } from "../src/topics.js";

test("detectProjectDetailed: root-match when a known repo-root segment precedes it", () => {
  const d = detectProjectDetailed("/Users/n0mad/Projekte/bastra-recall");
  assert.equal(d.raw, "bastra-recall");
  assert.equal(d.key, "bastra-recall");
  assert.equal(d.confidence, "root-match");
});

test("detectProjectDetailed: fallback when only the last segment is available", () => {
  // /Users/x/Projekte alone has no segment AFTER "Projekte" to match on —
  // this is the last-segment guess, not a root-match.
  const d = detectProjectDetailed("/Users/x/Projekte");
  assert.equal(d.raw, "Projekte");
  assert.equal(d.confidence, "fallback");
});

test("detectProjectDetailed: fallback for a path with no known root segment", () => {
  const d = detectProjectDetailed("/tmp/worktree/packages/core");
  assert.equal(d.raw, "core");
  assert.equal(d.key, "core");
  assert.equal(d.confidence, "fallback");
});

test("detectProjectDetailed: root-match still wins deeper in an unrelated-looking path", () => {
  const d = detectProjectDetailed("/srv/CarNexus/packages/daemon");
  // "CarNexus" precedes no known root segment here, so this is a fallback on
  // the last segment ("daemon") — the four examples from the bug report.
  assert.equal(d.raw, "daemon");
  assert.equal(d.confidence, "fallback");
});

test("detectProjectDetailed: none for an empty path", () => {
  assert.deepEqual(detectProjectDetailed(""), { raw: "", key: "", confidence: "none" });
});

test("detectProjectDetailed: key is normalized, raw keeps on-disk casing", () => {
  const d = detectProjectDetailed("/Users/x/Projekte/CarNexus");
  assert.equal(d.raw, "CarNexus");
  assert.equal(d.key, "carnexus");
  assert.equal(d.confidence, "root-match");
});

test("detectProject: thin wrapper still returns the raw name, null only for 'none'", () => {
  assert.equal(detectProject("/Users/n0mad/Projekte/bastra-recall"), "bastra-recall");
  assert.equal(detectProject("/Users/x/Projekte/CarNexus"), "CarNexus");
  assert.equal(detectProject(""), null);
});
