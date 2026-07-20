/**
 * Tests für das Produkt-Doku-Feature (docs.mode):
 *
 * - saveProductDocHandler: legt dokumentationen/<project>/doku-<project>-<area>.md
 *   an, update-in-place bei zweitem Call (stabile id, ein File pro Bereich),
 *   path-safety auf project, Auffindbarkeit über den Index (type=doc).
 * - formatDokuBlock: suggest- vs auto-Anweisung, Sprache + Projekt im Text.
 * - appendProductDocHint (stop-hook): hängt den Doku-Hinweis nur bei
 *   docs.mode != off und nur an die feature-completion-Suggestion.
 *
 * Runner: `node --import tsx --test packages/daemon/__tests__/product-docs.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { Telemetry } from "../src/telemetry.js";
import type { ToolDeps } from "../src/tool-handlers.js";
import { saveProductDocHandler } from "../src/product-doc-handler.js";
import { formatDokuBlock } from "../src/doku-block.js";
import { appendProductDocHint, type SaveSuggestion } from "../src/stop-hook.js";

async function makeDeps(): Promise<{ deps: ToolDeps; dir: string; close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-product-docs-"));
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const deps: ToolDeps = { vault, search, telemetry: new Telemetry(), vaultPath: dir };
  return {
    deps,
    dir,
    close: async () => {
      search.stop();
      await vault.stop?.();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

test("save_product_doc: creates the doc under dokumentationen/<project>/", async () => {
  const { deps, dir, close } = await makeDeps();
  try {
    const result = await saveProductDocHandler(deps, {
      project: "bastra",
      area: "User Guide",
      title: "Bastra — User-Guide",
      summary: "How to use the Bastra window mode.",
      body: "# User-Guide\n\nSo benutzt du die App.",
    });
    assert.equal(result.id, "doku-bastra-user-guide");
    assert.equal(result.created, true);
    assert.equal(result.updated, false);
    assert.equal(result.file_path, join(dir, "dokumentationen", "bastra", "doku-bastra-user-guide.md"));
    const content = await readFile(result.file_path, "utf8");
    assert.match(content, /type: doc/);
    assert.match(content, /So benutzt du die App/);

    // Auffindbar über die doc-Lane (find_document filtert type=doc).
    const hits = deps.search.recall("Bastra User-Guide", { type: "doc" });
    assert.equal(hits[0]?.id, "doku-bastra-user-guide");
  } finally {
    await close();
  }
});

test("save_product_doc: second call replaces in place — one file per area", async () => {
  const { deps, dir, close } = await makeDeps();
  try {
    const first = await saveProductDocHandler(deps, {
      project: "bastra",
      area: "recall-tab",
      title: "Bastra — Recall-Tab",
      summary: "Search across the vault.",
      body: "v1 body",
    });
    const second = await saveProductDocHandler(deps, {
      project: "bastra",
      area: "recall-tab",
      title: "Bastra — Recall-Tab",
      summary: "Search across the vault, now with pills.",
      body: "v2 body — replaces v1",
    });
    assert.equal(second.id, first.id);
    assert.equal(second.created, false);
    assert.equal(second.updated, true);

    const files = await readdir(join(dir, "dokumentationen", "bastra"));
    assert.deepEqual(files, ["doku-bastra-recall-tab.md"]);
    const content = await readFile(second.file_path, "utf8");
    assert.match(content, /v2 body — replaces v1/);
    assert.doesNotMatch(content, /v1 body/);
  } finally {
    await close();
  }
});

test("save_product_doc: rejects a path-escaping project", async () => {
  const { deps, close } = await makeDeps();
  try {
    await assert.rejects(
      saveProductDocHandler(deps, {
        project: "../escape",
        area: "x",
        title: "t",
        summary: "s",
        body: "b",
      }),
      /project/,
    );
  } finally {
    await close();
  }
});

test("formatDokuBlock: suggest proposes first, auto writes autonomously", () => {
  const suggest = formatDokuBlock("suggest", "de", "carnexus");
  assert.match(suggest, /<bastra-product-docs mode="suggest">/);
  assert.match(suggest, /save_product_doc/);
  assert.match(suggest, /dokumentationen\/carnexus\//);
  assert.match(suggest, /language "de"/);
  assert.match(suggest, /propose the doc update to the user first/);

  const auto = formatDokuBlock("auto", "en", "carnexus");
  assert.match(auto, /mode="auto"/);
  assert.match(auto, /update the doc autonomously/);
});

test("appendProductDocHint: only fires on feature-completion and only when on", () => {
  const fresh = (): SaveSuggestion[] => [
    { heuristic: "frustration-density", title: "f", type: "lesson", body: "frust." },
    { heuristic: "feature-completion", title: "fc", type: "project-fact", body: "commit landed." },
  ];

  const off = fresh();
  appendProductDocHint(off, "off");
  assert.equal(off[1].body, "commit landed.");

  const suggest = fresh();
  appendProductDocHint(suggest, "suggest");
  assert.match(suggest[1].body, /save_product_doc/);
  assert.match(suggest[1].body, /propose to the user first/);
  assert.equal(suggest[0].body, "frust.", "non-feature suggestions stay untouched");

  const auto = fresh();
  appendProductDocHint(auto, "auto");
  assert.match(auto[1].body, /docs\.mode=auto/);
  assert.doesNotMatch(auto[1].body, /propose to the user first/);
});
