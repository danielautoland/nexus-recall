/**
 * #240/A4 — soft-delete and restore must never destroy data.
 *
 * `trashPathFor()` returns one fixed path per id, so trashing the same id
 * twice replaced the first trashed version via `rename()` — silently and
 * unrecoverably, against the documented "recoverable — never a hard delete".
 * `restoreFromTrash()` was likewise a bare rename and would overwrite a file
 * that had become active again at the destination.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  moveToTrash,
  restoreFromTrash,
  trashPathFor,
  latestTrashPathFor,
} from "../src/audit-log.js";

async function vaultWith(t: { after: (fn: () => unknown) => void }, content: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-trash-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "victim.md");
  await writeFile(file, content, "utf8");
  return { dir, file };
}

test("trashing the same id twice keeps both versions", async (t) => {
  const { dir, file } = await vaultWith(t, "VERSION-ONE");

  const firstTrash = await moveToTrash(dir, file, "victim");
  assert.equal(await readFile(firstTrash, "utf8"), "VERSION-ONE");

  await writeFile(file, "VERSION-TWO", "utf8");
  const secondTrash = await moveToTrash(dir, file, "victim");

  assert.notEqual(firstTrash, secondTrash, "the second trash must not reuse the path");
  assert.equal(await readFile(firstTrash, "utf8"), "VERSION-ONE", "v1 must survive");
  assert.equal(await readFile(secondTrash, "utf8"), "VERSION-TWO");

  const trashed = await readdir(path.dirname(firstTrash));
  assert.equal(trashed.length, 2, `expected two trash entries, got ${JSON.stringify(trashed)}`);
});

test("the first trash keeps the base path, so existing lookups still resolve", async (t) => {
  const { dir, file } = await vaultWith(t, "ONLY");

  const dest = await moveToTrash(dir, file, "victim");
  assert.equal(dest, trashPathFor(dir, "victim"));
});

test("latestTrashPathFor returns the newest version, not the base path", async (t) => {
  const { dir, file } = await vaultWith(t, "VERSION-ONE");
  await moveToTrash(dir, file, "victim");

  await writeFile(file, "VERSION-TWO", "utf8");
  const second = await moveToTrash(dir, file, "victim");

  const latest = await latestTrashPathFor(dir, "victim");
  assert.equal(latest, second);
  assert.equal(await readFile(latest!, "utf8"), "VERSION-TWO");
});

test("latestTrashPathFor returns undefined when nothing was trashed", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-trash-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.equal(await latestTrashPathFor(dir, "never-existed"), undefined);
});

test("restore refuses to overwrite an active file at the destination", async (t) => {
  const { dir, file } = await vaultWith(t, "TRASHED");
  const trashed = await moveToTrash(dir, file, "victim");

  // The id got recreated after the delete — a common shape (archive, then
  // save a fresh memory under the same title).
  await writeFile(file, "ACTIVE-EDIT-DO-NOT-LOSE", "utf8");

  await assert.rejects(
    () => restoreFromTrash(dir, trashed, file),
    /refusing to restore over an existing file/,
  );
  assert.equal(
    await readFile(file, "utf8"),
    "ACTIVE-EDIT-DO-NOT-LOSE",
    "the active version must be untouched",
  );
  assert.equal(await readFile(trashed, "utf8"), "TRASHED", "the trashed copy stays recoverable");
});

test("restore into a free destination still works", async (t) => {
  const { dir, file } = await vaultWith(t, "TRASHED");
  const trashed = await moveToTrash(dir, file, "victim");

  const dest = path.join(dir, "memories", "projects", "x", "victim.md");
  await restoreFromTrash(dir, trashed, dest);

  assert.equal(await readFile(dest, "utf8"), "TRASHED");
});

test("a crafted id cannot escape the trash folder", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-trash-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "sub"), { recursive: true });

  assert.throws(() => trashPathFor(dir, "../../escape"), /refusing trash path/);
});
