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
import { chmod, mkdtemp, readFile, writeFile, rm, mkdir, readdir, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  moveToTrashUnderClaim,
  restoreFromTrashUnderClaim,
  trashPathFor,
  latestTrashPathFor,
} from "../src/audit-log.js";
import type { IdClaim } from "../src/id-transaction.js";

/**
 * Die Trash-Primitiven verlangen seit der Codex-Gegenreview einen `IdClaim` —
 * die id kommt aus ihm, und wer ihn hat, hält den Lock. Diese Tests prüfen die
 * Pfad- und Rename-Mechanik, nicht die Transaktion; ein Stellvertreter-Claim
 * reicht dafür.
 */
const claimFor = (id: string): IdClaim => ({ id, locate: async () => ({ kind: "none" }) });
const moveToTrash = (vaultRoot: string, filePath: string, id: string) =>
  moveToTrashUnderClaim(vaultRoot, filePath, claimFor(id));
const restoreFromTrash = (vaultRoot: string, trashFile: string, destFile: string) =>
  restoreFromTrashUnderClaim(vaultRoot, trashFile, destFile, claimFor("restore-test"));

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

/**
 * #365/11 — `latestTrashPathFor` matched by prefix, so a dotted neighbour id
 * looked like a timestamp version. For the id `foo`, `foo.bar.md` was a
 * candidate, and a restore of `foo` could put `foo.bar`s trashed content on
 * `foo`s original path. Dotted ids never come out of `slugify()`, but they do
 * come out of hand-written or imported `id:` frontmatter, which
 * `isPathSafeComponent` lets through.
 */

test("a dotted neighbour id is not mistaken for a trashed version", async (t) => {
  const { dir, file } = await vaultWith(t, "NEIGHBOUR");
  await moveToTrash(dir, file, "foo.bar");

  assert.equal(
    await latestTrashPathFor(dir, "foo"),
    undefined,
    "`foo` was never trashed — `foo.bar.md` must not stand in for it",
  );
});

test("the newest neighbour never outranks the id's own trashed file", async (t) => {
  const { dir, file } = await vaultWith(t, "OWN");
  const own = await moveToTrash(dir, file, "foo");

  await writeFile(file, "NEIGHBOUR", "utf8");
  await moveToTrash(dir, file, "foo.bar");

  // Make the neighbour strictly newer, so a prefix match would prefer it.
  const past = new Date(Date.now() - 60_000);
  await utimes(own, past, past);

  const latest = await latestTrashPathFor(dir, "foo");
  assert.equal(latest, own);
  assert.equal(await readFile(latest!, "utf8"), "OWN");
});

test("a dotted id still finds its own timestamped versions", async (t) => {
  const { dir, file } = await vaultWith(t, "VERSION-ONE");
  await moveToTrash(dir, file, "foo.bar");

  await writeFile(file, "VERSION-TWO", "utf8");
  const second = await moveToTrash(dir, file, "foo.bar");

  const latest = await latestTrashPathFor(dir, "foo.bar");
  assert.equal(latest, second);
  assert.equal(await readFile(latest!, "utf8"), "VERSION-TWO");
});

test("an unrelated file in the trash folder is never a candidate", async (t) => {
  const { dir, file } = await vaultWith(t, "OWN");
  const own = await moveToTrash(dir, file, "victim");

  // Neither a version stamp nor the base name — e.g. a stray editor artefact.
  await writeFile(path.join(path.dirname(own), "victim.backup.md"), "STRAY", "utf8");

  assert.equal(await latestTrashPathFor(dir, "victim"), own);
});

/**
 * Codex-Gegenreview: Der Restore erzeugt erst den Hardlink am Zielpfad und
 * entfernt danach den Trash-Link. Scheitert dieses `unlink` — ein nicht
 * beschreibbares Trash-Verzeichnis reicht —, meldete er einen Fehler, während
 * BEIDE Dateien existierten: die aktive und die im Trash, mit derselben id.
 * Ein Fehlschlag muss den Zustand von vorher hinterlassen.
 */
test("scheitert das Aufräumen des Trash-Links, bleibt keine halbe Wiederherstellung zurück", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-restore-halfway-"));
  const trashDir = path.join(dir, ".bastra", "trash");
  const trashed = path.join(trashDir, "m.md");
  const dest = path.join(dir, "m.md");
  try {
    await mkdir(trashDir, { recursive: true });
    await writeFile(trashed, "---\nid: m\ntype: lesson\n---\n\nBody.\n", "utf8");
    // Das Verzeichnis nicht beschreibbar: der Hardlink ans Ziel gelingt, das
    // Entfernen des Trash-Eintrags nicht.
    await chmod(trashDir, 0o500);

    await assert.rejects(restoreFromTrash(dir, trashed, dest));
    assert.equal(existsSync(dest), false, "kein zweiter aktiver Link darf zurückbleiben");
    assert.equal(existsSync(trashed), true, "die Trash-Fassung bleibt unangetastet");
  } finally {
    await chmod(trashDir, 0o700).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
