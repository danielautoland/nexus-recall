/**
 * #240/A6 — `save_memory(overwrite=true)` is a PATCH, not a replace.
 *
 * A refresh sends only the fields it wants to change. Everything else has to
 * survive: before this, every agent overwrite silently reset `created`,
 * `sensitivity`, `confidence`, `source`, `valid_until`, `affects_files`, … to
 * their defaults — on the most frequent write path in the product (the skill
 * prescribes overwrite=true for updates). Several of those are not
 * regenerable, and `sensitivity: private → team` widened who may read the
 * memory.
 *
 * The counter-requirement is that deletion stays expressible: an explicitly
 * passed empty array/value must still win over the stored one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import matter from "gray-matter";
import { saveMemory } from "../src/save.js";
import type { SaveMemoryInput } from "../src/save.js";

/** The minimum a caller must send — everything else must be carried over. */
function minimalRefresh(over: Partial<SaveMemoryInput> = {}): SaveMemoryInput {
  return {
    title: "Deploy Runbook",
    type: "lesson",
    summary: "updated summary",
    topic_path: ["ops"],
    tags: ["deploy"],
    scope: "testproj",
    recall_when: ["when deploying"],
    body: "Updated body.",
    overwrite: true,
    ...over,
  } as SaveMemoryInput;
}

/** Seed a memory carrying every field a refresh could drop. */
async function seed(dir: string): Promise<string> {
  const file = path.join(dir, "memories", "projects", "testproj", "deploy-runbook.md");
  await saveMemory(dir, {
    title: "Deploy Runbook",
    type: "lesson",
    summary: "original summary",
    topic_path: ["ops"],
    tags: ["deploy"],
    scope: "testproj",
    recall_when: ["when deploying"],
    body: "Original body.",
    sensitivity: "private",
    confidence: 0.4,
    source: "manual-import",
    valid_until: "2030-01-01",
    expires_after_days: 365,
    last_reviewed_at: "2024-06-01",
    affects_files: ["src/deploy.ts"],
    issues: ["#42"],
    related_via: [{ id: "neighbour", reason: "cosine 0.900", score: 0.9 }],
    salience: 0.9,
    emotion: "frustration",
    recall_mode: "reflex",
    write_origin: "user-directed",
    aliases: ["Runbook"],
  } as SaveMemoryInput);

  // created + machine-owned fields are not settable through SaveMemoryInput —
  // stamp them the way the background passes do, so the test covers them too.
  const raw = await readFile(file, "utf8");
  const parsed = matter(raw);
  parsed.data.created = "2020-01-01";
  parsed.data.recall_when_expanded = ["how do I ship this"];
  parsed.data.recall_when_expanded_src = "sha-abc123";
  parsed.data.content_hash = "deadbeefcafe";
  parsed.data.content_size = 4096;
  await writeFile(file, matter.stringify(parsed.content, parsed.data), "utf8");
  return file;
}

test("overwrite without a field preserves it instead of resetting to the default", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-save-roundtrip-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = await seed(dir);

  await saveMemory(dir, minimalRefresh());
  const fm = matter(await readFile(file, "utf8")).data;

  // The field the whole product hangs on: creation time, not write time.
  assert.equal(fm.created, "2020-01-01", "created must survive a refresh");
  assert.notEqual(fm.updated, "2020-01-01", "updated must advance");

  // Confidentiality must never widen silently — this gates allow_private.
  assert.equal(fm.sensitivity, "private");

  assert.equal(fm.confidence, 0.4);
  assert.equal(fm.source, "manual-import");
  assert.equal(fm.valid_until, "2030-01-01");
  assert.equal(fm.expires_after_days, 365);
  assert.equal(fm.last_reviewed_at, "2024-06-01");
  assert.deepEqual(fm.affects_files, ["src/deploy.ts"]);
  assert.deepEqual(fm.issues, ["#42"]);
  assert.equal((fm.related_via as unknown[]).length, 1);

  // Machine-owned, unreachable through the tool schema — so a refresh could
  // never restore them by re-passing.
  assert.deepEqual(fm.recall_when_expanded, ["how do I ship this"]);
  assert.equal(fm.recall_when_expanded_src, "sha-abc123");
  assert.equal(fm.content_hash, "deadbeefcafe");
  assert.equal(fm.content_size, 4096);

  // The five that were already special-cased (#188/#158/#217) must keep working.
  assert.deepEqual(fm.aliases, ["Runbook"]);
  assert.equal(fm.write_origin, "user-directed");
  assert.equal(fm.salience, 0.9);
  assert.equal(fm.emotion, "frustration");
  assert.equal(fm.recall_mode, "reflex");

  // …while the fields the refresh DID send are applied.
  assert.equal(fm.summary, "updated summary");
});

test("an explicitly passed value still overrides the stored one", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-save-roundtrip-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = await seed(dir);

  await saveMemory(
    dir,
    minimalRefresh({
      sensitivity: "team",
      confidence: 1,
      affects_files: [],
      issues: [],
    }),
  );
  const fm = matter(await readFile(file, "utf8")).data;

  // Preserve-by-default must not become preserve-always: clearing stays possible.
  assert.equal(fm.sensitivity, "team");
  assert.equal(fm.confidence, 1);
  assert.deepEqual(fm.affects_files, []);
  assert.deepEqual(fm.issues, []);
});

test("a fresh save is unaffected — created is stamped, defaults apply", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-save-roundtrip-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const res = await saveMemory(dir, minimalRefresh({ overwrite: false }));
  const fm = matter(await readFile(res.file_path, "utf8")).data;

  assert.equal(res.created, true);
  assert.equal(fm.created, fm.updated, "a new memory is created and updated today");
  assert.equal(fm.sensitivity, "team", "default still applies without a predecessor");
  assert.equal(fm.confidence, 1);
});

test("the write is atomic and leaves no temp file behind", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-save-roundtrip-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = await seed(dir);

  // Overlapping writers must not publish a torn file — a fixed temp name per
  // process would let two writes interleave and rename the mix into place.
  await Promise.all([
    saveMemory(dir, minimalRefresh({ body: "A".repeat(5000) })),
    saveMemory(dir, minimalRefresh({ body: "B" })),
  ]);

  const raw = await readFile(file, "utf8");
  assert.doesNotThrow(() => matter(raw), "published file must always parse");
  const leftovers = (await readdir(path.dirname(file))).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "no temp files may survive");
});
