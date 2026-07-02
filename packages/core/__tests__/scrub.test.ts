/**
 * Tests für scrub.ts (#149) — injected-context scrubbing.
 * Nur komplette paired Blöcke werden entfernt; bare mentions (Memories, die
 * die Hook-Formate selbst dokumentieren) bleiben unangetastet.
 *
 * Runner: tsx --test packages/core/__tests__/scrub.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  scrubInjectedBlocks,
  containsInjectedBlock,
  INJECTED_BLOCK_TAGS,
} from "../src/scrub.js";

function block(tag: string, attrs = "", body = "quoted scaffolding"): string {
  return `<${tag}${attrs}>\n${body}\n</${tag}>`;
}

test("scrub removes a complete block for every inventoried tag", () => {
  for (const tag of INJECTED_BLOCK_TAGS) {
    const input = `before\n${block(tag)}\nafter`;
    const { text, removed } = scrubInjectedBlocks(input);
    assert.ok(!text.includes(`<${tag}`), `block <${tag}> should be gone`);
    assert.match(text, /before/);
    assert.match(text, /after/);
    assert.deepEqual(removed, [tag]);
  }
});

test("scrub removes blocks with attributes in the open tag", () => {
  const input = `x ${block("recall-hints", ' surface="claude-code" trigger="bash-destructive"')} y`;
  const { text, removed } = scrubInjectedBlocks(input);
  assert.ok(!text.includes("recall-hints"));
  assert.deepEqual(removed, ["recall-hints"]);
});

test("scrub removes multiple blocks of mixed families mid-text", () => {
  const input = [
    "user typed this",
    block("session-context", ' surface="claude-code" project="x"', "- hint a: packages/a.ts"),
    "more prose",
    block("system-reminder", "", "As you answer..."),
    block("save-eval", "", "suggestion body"),
    "tail",
  ].join("\n");
  const { text, removed } = scrubInjectedBlocks(input);
  assert.match(text, /user typed this/);
  assert.match(text, /more prose/);
  assert.match(text, /tail/);
  assert.ok(!text.includes("packages/a.ts"), "content inside blocks must not survive");
  assert.deepEqual(removed, ["session-context", "save-eval", "system-reminder"]);
});

test("bare tag mentions survive — memories documenting the hook format stay intact", () => {
  const input = "Der Stop-Hook emittiert <save-eval>-Blöcke; der Session-Hook <vault-taxonomy>.";
  const { text, removed } = scrubInjectedBlocks(input);
  assert.equal(text, input);
  assert.deepEqual(removed, []);
  assert.deepEqual(containsInjectedBlock(input), []);
});

test("unterminated block (no close tag) is left untouched", () => {
  const input = "<recall-hints surface=\"claude-code\">\n- dangling hint without close";
  const { text, removed } = scrubInjectedBlocks(input);
  assert.equal(text, input);
  assert.deepEqual(removed, []);
});

test("scrub is idempotent and collapses leftover blank runs", () => {
  const input = `a\n\n${block("bastra-update")}\n\nb`;
  const once = scrubInjectedBlocks(input);
  assert.ok(!/\n{3,}/.test(once.text), "no 3+ newline runs after scrub");
  const twice = scrubInjectedBlocks(once.text);
  assert.equal(twice.text, once.text);
  assert.deepEqual(twice.removed, []);
});

test("containsInjectedBlock reports complete blocks without rewriting", () => {
  const input = `t ${block("pending-save-suggestions", ' source="stop-hook"')} t`;
  assert.deepEqual(containsInjectedBlock(input), ["pending-save-suggestions"]);
});
