/**
 * file-size-check (PreToolUse-Hook) — die Datei-Größen-Konvention wird
 * deterministisch gemessen statt erinnert. Runner:
 * tsx --test __tests__/file-size-check.test.ts
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { thresholdsFor, formatSizeNote, fileSizeNote } from "../src/file-size-check.js";

afterEach(() => {
  delete process.env.BASTRA_SIZE_CHECK;
  delete process.env.BASTRA_SIZE_GUIDE;
  delete process.env.BASTRA_SIZE_CRITICAL;
});

test("thresholds: code files 500/800, test files 700/1000, non-code exempt", () => {
  assert.deepEqual(thresholdsFor("/x/app.js"), { guide: 500, critical: 800 });
  assert.deepEqual(thresholdsFor("/x/view.tsx"), { guide: 500, critical: 800 });
  assert.deepEqual(thresholdsFor("/x/__tests__/foo.test.ts"), { guide: 700, critical: 1000 });
  assert.equal(thresholdsFor("/x/README.md"), null);
  assert.equal(thresholdsFor("/x/package-lock.json"), null);
});

test("env override moves the guide value (onboarding hook), tests stay fixed", () => {
  process.env.BASTRA_SIZE_GUIDE = "300";
  assert.deepEqual(thresholdsFor("/x/app.js"), { guide: 300, critical: 800 });
  assert.deepEqual(thresholdsFor("/x/a.test.ts"), { guide: 700, critical: 1000 });
});

test("note fires from ~90% of guide, escalates past critical, silent below", () => {
  const t = { guide: 500, critical: 800 };
  assert.equal(formatSizeNote("/x/app.js", 200, t), null);
  assert.equal(formatSizeNote("/x/app.js", 449, t), null);
  const nearNote = formatSizeNote("/x/app.js", 460, t);
  assert.ok(nearNote?.includes('level="guide"') && nearNote.includes('lines="460"'));
  const critNote = formatSizeNote("/x/app.js", 950, t);
  assert.ok(critNote?.includes('level="critical"') && critNote.includes("propose a coherent module split"));
});

test("fileSizeNote measures real files; new files and kill-switch stay silent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-size-"));
  try {
    const big = join(dir, "big.js");
    await writeFile(big, Array.from({ length: 900 }, (_, i) => `// line ${i}`).join("\n"), "utf8");
    const note = await fileSizeNote(big);
    assert.ok(note?.includes('level="critical"'), "900-line js file must warn");

    assert.equal(await fileSizeNote(join(dir, "does-not-exist.js")), null, "new file → silent");

    process.env.BASTRA_SIZE_CHECK = "off";
    assert.equal(await fileSizeNote(big), null, "kill-switch silences the check");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
