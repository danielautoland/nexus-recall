/**
 * Pins the Claude Code Stop save-eval hook default: ON since #48 (live-validated,
 * silent file-relay — no chat noise). A future refactor must not silently flip it
 * back to opt-in, and the --no-stop-hook opt-out must keep working.
 *
 * Run: npx tsx --test packages/daemon/__tests__/stop-hook-default.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseArgs } from "../src/cli/commands.js";

test("stop-hook: registered by default (no flag)", () => {
  assert.equal(parseArgs(["install", "all"]).withStopHook, true);
});

test("stop-hook: --no-stop-hook opts out", () => {
  assert.equal(parseArgs(["install", "all", "--no-stop-hook"]).withStopHook, false);
});

test("stop-hook: --with-stop-hook stays valid (compat — now the default)", () => {
  assert.equal(parseArgs(["install", "all", "--with-stop-hook"]).withStopHook, true);
});
