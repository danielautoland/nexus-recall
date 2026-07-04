/**
 * Issue #188: neue Doc-Sidecars tragen ab Write-Time ihre eigene doc-id als
 * Obsidian-Alias (`aliases: [<id>]`), damit `[[<doc-id>]]`-Wikilinks in
 * Obsidian aufs Sidecar auflösen statt eine leere Stray-Note anzulegen.
 *
 * Run: npx tsx --test packages/daemon/__tests__/documents-alias.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { Vault } from "@bastra-recall/core";

import { saveDocument, buildFrontmatter } from "../src/documents-write-handler.js";

test("saveDocument schreibt aliases: [<doc-id>] ins Sidecar-Frontmatter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-doc-save-"));
  try {
    const source = join(dir, "PHOTO-2026-01-27.jpg");
    await writeFile(source, "fake-jpg-bytes");
    const vaultDir = join(dir, "vault");
    const vault = new Vault(vaultDir);
    await vault.init();

    const result = await saveDocument(vault, {
      original_path: source,
      folder_path: "Inbox",
      title: "Photo",
      tags: ["foto"],
      category: "bild",
      linked_file: false,
      overwrite: false,
    });

    const fm = matter(await readFile(result.sidecar_path, "utf8")).data as {
      id: string;
      aliases?: string[];
    };
    assert.equal(fm.id, result.id);
    assert.deepEqual(fm.aliases, [result.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildFrontmatter übernimmt bestehende Aliases und hängt die id nur einmal an", () => {
  const base = {
    id: "doc-inbox-photo-jpg",
    title: "Photo",
    summary: "s",
    tags: ["foto"],
    category: "bild",
    recallWhen: ["find photo"],
    originalPath: "/v/documents/Inbox/photo.jpg",
    linkedFile: false,
    folderPath: "Inbox",
    created: "2026-05-01",
    updated: "2026-05-01",
  };

  // User-Alias aus Obsidian überlebt recategorize/move.
  const withUser = buildFrontmatter({ ...base, aliases: ["Foto Mai"] });
  assert.deepEqual(withUser.aliases, ["Foto Mai", "doc-inbox-photo-jpg"]);

  // Bereits vorhandene id wird nicht dupliziert.
  const withId = buildFrontmatter({ ...base, aliases: ["doc-inbox-photo-jpg"] });
  assert.deepEqual(withId.aliases, ["doc-inbox-photo-jpg"]);

  // Ohne Bestand: genau die eigene id.
  const fresh = buildFrontmatter(base);
  assert.deepEqual(fresh.aliases, ["doc-inbox-photo-jpg"]);
});
