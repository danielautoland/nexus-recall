/**
 * A single imported batch must not collapse into one cluster.
 *
 * #217 gives each batch its own cluster (`<label> (import)`), which keeps two
 * imports apart — but with one batch there is nothing to keep apart and the
 * blob returns. `import vault` writes every file flat into
 * `memories/imported/<label>/`, so the folder axis carries no information for
 * those notes; the importer records the source hierarchy in `topic_path`
 * (["imported", <label>, …rel]). clusterKeyFor/subKeyFor read that, the same
 * way `projects` is unpacked so a single blob doesn't swallow the map. The
 * " (import)" suffix stays on either path, so the collision guard holds.
 *
 * Runner: `tsx --test __tests__/graph-import-cluster.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { clusterKeyFor, subKeyFor } from "../src/graph.js";
import type { Memory } from "../src/schema.js";

const ROOT = "/vault";

function mem(relPath: string, topic_path: string[], scope = "batch"): Memory {
  return {
    fm: { id: "x", title: "x", type: "reference", scope, topic_path, tags: [] },
    filePath: join(ROOT, relPath),
  } as unknown as Memory;
}

test("imported note takes its cluster from the source subfolder", () => {
  const m = mem("memories/imported/batch/note.md", ["imported", "batch", "recipes"]);
  assert.equal(clusterKeyFor(m, ROOT), "recipes (import)");
});

test("imported note flat in the source falls back to the batch label", () => {
  const m = mem("memories/imported/batch/note.md", ["imported", "batch"]);
  assert.equal(clusterKeyFor(m, ROOT), "batch (import)");
});

test("second source level becomes the sub-area", () => {
  const m = mem("memories/imported/batch/note.md", ["imported", "batch", "recipes", "drafts"]);
  assert.equal(clusterKeyFor(m, ROOT), "recipes (import)");
  assert.equal(subKeyFor(m, ROOT), "drafts");
});

test("flat imported note has no sub-area", () => {
  const m = mem("memories/imported/batch/note.md", ["imported", "batch"]);
  assert.equal(subKeyFor(m, ROOT), "general");
});

test("a topic_path not written by the importer is left alone", () => {
  // Hand-authored note that merely happens to live in the imported folder:
  // no "imported" head, so the label stays the cluster.
  const m = mem("memories/imported/batch/note.md", ["personal", "notes"]);
  assert.equal(clusterKeyFor(m, ROOT), "batch (import)");
  assert.equal(subKeyFor(m, ROOT), "general");
});

test("the (import) suffix never collides with a real cluster of the same name", () => {
  const imported = mem("memories/imported/batch/note.md", ["imported", "batch", "acme"]);
  const real = mem("memories/projects/acme/plan.md", ["projects", "acme"]);
  assert.notEqual(clusterKeyFor(imported, ROOT), clusterKeyFor(real, ROOT));
});

test("non-imported clusters are unchanged", () => {
  const proj = mem("memories/projects/acme/plan.md", ["projects", "acme"]);
  assert.equal(clusterKeyFor(proj, ROOT), "acme");
  const user = mem("memories/user/profile.md", ["user"]);
  assert.equal(clusterKeyFor(user, ROOT), "user");
});
