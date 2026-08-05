/**
 * The type-ahead floor must not be able to exceed the best result there is.
 *
 * `handleUiSearch` cut at `Math.max(100, top * 0.85)`. The absolute half of
 * that is a trap: a one-armed top hit scores 81.967 by construction on the
 * hybrid path — below 100 — so the floor landed ABOVE the best hit and the
 * filter returned an empty list. Not "fewer suggestions": none, silently, for
 * a query that did have results.
 *
 * Rare while the fusion curve was flat, common once `RRF_K` made deep hits
 * score what they are worth. Found by a reviewer grepping absolute score cuts,
 * not by the change that made it common — so it gets a test rather than a
 * comment.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/webui-search-floor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { handleUiSearch } from "../src/webui.js";

/** Enough of ServerResponse for the handler: status, headers, body. */
function fakeRes(): { res: never; body: () => unknown; status: () => number } {
  let status = 0;
  let payload = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    setHeader() {},
    end(chunk?: string) {
      payload = chunk ?? "";
    },
  };
  return {
    res: res as never,
    body: () => (payload ? JSON.parse(payload) : null),
    status: () => status,
  };
}

function memo(id: string, title: string, body: string): string {
  return `---\nid: ${id}\ntitle: ${title}\ntype: reference\nsummary: ${title}\ntopic_path: [t]\ntags: [t]\nscope: t\nrecall_when: []\ncreated: 2020-01-01\nupdated: 2020-01-01\n---\n\n${body}\n`;
}

test("a BM25-only result set still yields suggestions (floor cannot exceed the top hit)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "webui-floor-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "memories"), { recursive: true });
  await mkdir(join(dir, ".bastra"), { recursive: true });
  const settings = join(dir, "cli-settings.json");
  await writeFile(settings, JSON.stringify({ ui: { enabled: true } }));
  for (const [id, title] of [
    ["alpha-note", "backoff jitter for retries"],
    ["beta-note", "retry storm after an outage"],
    ["gamma-note", "unrelated flexbox note"],
  ] as const) {
    await writeFile(join(dir, "memories", `${id}.md`), memo(id, title, `${title} body text`));
  }

  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  t.after(() => {
    search.stop();
    return vault.stop();
  });

  // No EmbeddingIndex registered: recallHybrid falls back to BM25, whose scores
  // are a different space entirely — this is exactly the case where an absolute
  // floor of 100 is arbitrary.
  const { res, body, status } = fakeRes();
  await handleUiSearch(res, "/ui/search?q=backoff%20jitter", search, settings);
  assert.equal(status(), 200);
  const hits = (body() as { hits: { id: string }[] }).hits;
  assert.ok(hits.length > 0, "a query that matches a memory must return at least one suggestion");
  assert.equal(hits[0]!.id, "alpha-note");
});
