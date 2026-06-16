/**
 * Tests für trigger-expand.ts (#117) — doc2query write-time trigger expansion.
 * Pure helpers (prompt/parse/hash) ohne Modell; expand()-Lifecycle mit
 * gestubbtem chat + selfTest gegen einen echten Temp-Vault.
 *
 * Runner: tsx --test packages/core/__tests__/trigger-expand.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Vault } from "../src/vault.js";
import type { EmbeddingIndex } from "../src/embeddings.js";
import type { Memory } from "../src/schema.js";
import {
  TriggerExpander,
  buildExpandPrompt,
  parseExpansions,
  sourceHash,
} from "../src/trigger-expand.js";

function memoryMd(id: string): string {
  return `---
id: ${id}
title: ${id} title
type: lesson
summary: summary of ${id}
topic_path: [t]
tags: [t]
scope: t
recall_when: ["original trigger"]
created: 2026-05-01
updated: 2026-05-01
---

body ${id}
`;
}

/** Minimal Memory for the pure-function tests (no vault needed). */
function fakeMemory(over: Partial<Memory["fm"]> = {}): Memory {
  return {
    fm: {
      id: "m",
      title: "NSPanel closes when sheet attaches",
      summary: "resignKey observer must respect attachedSheet",
      recall_when: ["nspanel resignkey", "panel closes"],
      ...over,
    },
    body: "b",
    filePath: "/tmp/m.md",
  } as unknown as Memory;
}

/** EmbeddingIndex stub — expand() only needs onEmbed for start(). */
function stubEmbeddings(): EmbeddingIndex {
  return {
    onEmbed(_l: (id: string) => void) {
      return () => {};
    },
  } as unknown as EmbeddingIndex;
}

async function vaultWith(ids: string[]): Promise<{ dir: string; vault: Vault }> {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-expand-"));
  for (const id of ids) await writeFile(path.join(dir, `${id}.md`), memoryMd(id));
  const vault = new Vault(dir);
  await vault.init();
  return { dir, vault };
}

// ── pure helpers ───────────────────────────────────────────────────

test("buildExpandPrompt carries title/summary/triggers and asks for reworded bilingual phrases", () => {
  const p = buildExpandPrompt(fakeMemory());
  assert.match(p, /NSPanel closes when sheet attaches/);
  assert.match(p, /resignKey observer must respect attachedSheet/);
  assert.match(p, /nspanel resignkey \| panel closes/);
  assert.match(p, /DIFFERENT words/);
  assert.match(p, /German and English/);
});

test("parseExpansions strips bullets/numbering and trims", () => {
  const raw = ["- why does my panel vanish", "2. fenster schließt sich", "* warum panel zu", "1) related concept"].join("\n");
  const out = parseExpansions(raw, [], 5);
  assert.deepEqual(out, ["why does my panel vanish", "fenster schließt sich", "warum panel zu", "related concept"]);
});

test("parseExpansions strips wrapping quotes", () => {
  assert.deepEqual(parseExpansions('"quoted phrase"\n`code phrase`', [], 5), ["quoted phrase", "code phrase"]);
});

test("parseExpansions dedupes against existing triggers and itself (case-insensitive)", () => {
  const raw = ["Original Trigger", "fresh one", "fresh one", "FRESH ONE"].join("\n");
  const out = parseExpansions(raw, ["original trigger"], 5);
  assert.deepEqual(out, ["fresh one"]);
});

test("parseExpansions drops empties + over-long lines and caps at max", () => {
  const raw = ["a", "", "   ", "x".repeat(200), "b", "c", "d"].join("\n");
  const out = parseExpansions(raw, [], 3);
  assert.deepEqual(out, ["a", "b", "c"]);
});

test("sourceHash is stable and changes when recall_when/title/summary change", () => {
  const base = sourceHash(fakeMemory());
  assert.equal(base, sourceHash(fakeMemory()), "same source → same hash");
  assert.notEqual(base, sourceHash(fakeMemory({ recall_when: ["different"] })));
  assert.notEqual(base, sourceHash(fakeMemory({ title: "other" })));
  assert.notEqual(base, sourceHash(fakeMemory({ summary: "other" })));
});

// ── expand() lifecycle ─────────────────────────────────────────────

test("expand writes recall_when_expanded + _src to frontmatter, atomically", async () => {
  const { dir, vault } = await vaultWith(["a"]);
  try {
    const expander = new TriggerExpander(vault, stubEmbeddings(), {
      chat: async () => "why does it break\nwarum geht es kaputt",
      backfillOnStart: false,
    });
    const kept = await expander.expand("a");
    assert.deepEqual(kept, ["why does it break", "warum geht es kaputt"]);

    const raw = await readFile(path.join(dir, "a.md"), "utf8");
    assert.match(raw, /recall_when_expanded:/);
    assert.match(raw, /why does it break/);
    assert.match(raw, /recall_when_expanded_src:/);
    assert.match(raw, /body a/, "body preserved");

    const leftovers = (await readdir(dir)).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftovers, [], "no tmp leftovers");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selfTest filters out paraphrases that don't retrieve their own memory", async () => {
  const { dir, vault } = await vaultWith(["a"]);
  try {
    const expander = new TriggerExpander(vault, stubEmbeddings(), {
      chat: async () => "keep me\ndrop me\nkeep this too",
      selfTest: async (phrase) => phrase.startsWith("keep"),
      backfillOnStart: false,
    });
    const kept = await expander.expand("a");
    assert.deepEqual(kept, ["keep me", "keep this too"]);
    const raw = await readFile(path.join(dir, "a.md"), "utf8");
    assert.doesNotMatch(raw, /drop me/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("expand is a no-op on the second pass — source unchanged breaks the loop", async () => {
  const { dir, vault } = await vaultWith(["a"]);
  try {
    let chatCalls = 0;
    const expander = new TriggerExpander(vault, stubEmbeddings(), {
      chat: async () => { chatCalls++; return "phrase one"; },
      backfillOnStart: false,
    });
    await expander.expand("a"); // writes _src
    const second = await expander.expand("a"); // src now matches → skip
    assert.equal(second, null);
    assert.equal(chatCalls, 1, "model not called again when source is unchanged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeGate=false suppresses the write (single-writer)", async () => {
  const { dir, vault } = await vaultWith(["a"]);
  try {
    const before = await readFile(path.join(dir, "a.md"), "utf8");
    const expander = new TriggerExpander(vault, stubEmbeddings(), {
      chat: async () => "phrase one",
      writeGate: () => false,
      backfillOnStart: false,
    });
    const result = await expander.expand("a");
    assert.equal(result, null);
    assert.equal(await readFile(path.join(dir, "a.md"), "utf8"), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("start: a rejecting expand via onEmbed is swallowed (crash guard, fix A)", async () => {
  // Without the .catch on `void this.expand(id)`, a chat that throws (Ollama
  // timeout/abort) becomes an unhandled rejection — node:test would fail the
  // test, just as it crashed the daemon. The .catch must absorb it.
  const { dir, vault } = await vaultWith(["a"]);
  try {
    let fire: ((id: string) => void) | null = null;
    const emb = { onEmbed(l: (id: string) => void) { fire = l; return () => {}; } } as unknown as EmbeddingIndex;
    const expander = new TriggerExpander(vault, emb, {
      chat: async () => { throw new Error("ollama aborted"); },
      backfillOnStart: false,
    });
    expander.start();
    assert.ok(fire, "onEmbed listener registered");
    fire!("a"); // triggers expand → chat throws → must be swallowed, not unhandled
    await new Promise((r) => setTimeout(r, 20)); // let the rejection settle
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("backfill expands every un-expanded memory, then is idempotent", async () => {
  const { dir, vault } = await vaultWith(["a", "b", "c"]);
  try {
    const expander = new TriggerExpander(vault, stubEmbeddings(), {
      chat: async () => "reworded phrase",
      backfillOnStart: false,
    });
    const first = await expander.backfill();
    assert.equal(first, 3, "all three expanded");
    const second = await expander.backfill();
    assert.equal(second, 0, "nothing left to expand (src hashes match)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
