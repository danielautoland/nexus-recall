/**
 * Tests for src/memory-location.ts (#297) — the write-time vault-location
 * check: memory-shaped .md outside the vault root gets a note, everything
 * else stays silent.
 *
 * Run: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/memory-location.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryLocationNote } from "../src/memory-location.js";

const MEMORY_MD = "---\nid: x\ntitle: X\ntype: lesson\n---\n\nBody.\n";

test("memoryLocationNote (#297): fires only for memory-shaped .md outside the root", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "bastra-loc-vault-"));
  const outside = await mkdtemp(join(tmpdir(), "bastra-loc-out-"));
  try {
    // Write with inline content, outside the root → note, naming the type
    const note = await memoryLocationNote(join(outside, "x.md"), { content: MEMORY_MD }, vaultRoot);
    assert.ok(note?.includes('type="lesson"'), `expected a lesson note, got ${note}`);
    assert.ok(note?.includes(vaultRoot), "the note names the configured root");

    // same shape INSIDE the root → silent
    assert.equal(await memoryLocationNote(join(vaultRoot, "x.md"), { content: MEMORY_MD }, vaultRoot), null);

    // plain .md outside → silent
    assert.equal(await memoryLocationNote(join(outside, "plan.md"), { content: "# Plan\n" }, vaultRoot), null);

    // non-.md → silent without any read
    assert.equal(await memoryLocationNote(join(outside, "x.ts"), { content: MEMORY_MD }, vaultRoot), null);

    // no vault root configured → silent
    assert.equal(await memoryLocationNote(join(outside, "x.md"), { content: MEMORY_MD }, null), null);

    // Edit (no inline content): head is read from the existing file
    const edited = join(outside, "existing.md");
    await writeFile(edited, MEMORY_MD, "utf8");
    const editNote = await memoryLocationNote(edited, { old_string: "a" }, vaultRoot);
    assert.ok(editNote?.includes("vault-location-check"), "edit path reads the file head");

    // Edit on a nonexistent file → fail-open silent
    assert.equal(await memoryLocationNote(join(outside, "gone.md"), { old_string: "a" }, vaultRoot), null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
