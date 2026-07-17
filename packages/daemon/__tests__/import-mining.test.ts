/**
 * Tests für das conversations.json-Mining (#211):
 *   - parseConversationExport — ChatGPT-mapping-Tree + Claude-chat_messages,
 *     nur User-Messages, neueste Conversation zuerst
 *   - buildQueue / queueStatus / readNextChunk / clearQueue — lokale Queue,
 *     Cursor-Fortschritt, Chunk-Budget, Cleanup nach dem letzten Chunk
 *
 * Runner: `tsx --test __tests__/import-mining.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseConversationExport,
  buildQueue,
  queueStatus,
  readNextChunk,
  clearQueue,
  QUEUE_FILE,
  type ConversationRecord,
} from "../src/import-mining.js";

test("parseConversationExport: ChatGPT mapping tree — user turns only, in time order, newest conversation first", () => {
  const raw = JSON.stringify([
    {
      title: "older chat",
      create_time: 1700000000,
      mapping: {
        root: { message: null },
        m1: {
          message: {
            author: { role: "user" },
            create_time: 1700000010,
            content: { content_type: "text", parts: ["How do I configure the daemon port for local testing?"] },
          },
        },
        m2: {
          message: {
            author: { role: "assistant" },
            create_time: 1700000020,
            content: { content_type: "text", parts: ["Assistant turns must never appear in the queue"] },
          },
        },
      },
    },
    {
      title: "newer chat",
      create_time: 1750000000,
      mapping: {
        a: {
          message: {
            author: { role: "user" },
            create_time: 1750000030,
            content: { content_type: "text", parts: ["Second message comes after the first one chronologically"] },
          },
        },
        b: {
          message: {
            author: { role: "user" },
            create_time: 1750000010,
            content: { content_type: "multimodal_text", parts: [{ asset: "img" }, "I prefer dark mode in every tool I use daily"] },
          },
        },
        c: {
          message: {
            author: { role: "user" },
            create_time: 1750000020,
            content: { content_type: "text", parts: ["ok"] }, // too short → dropped
          },
        },
      },
    },
  ]);
  const parsed = parseConversationExport(raw);
  assert.ok(parsed);
  assert.equal(parsed.source, "chatgpt");
  assert.equal(parsed.conversations.length, 2);
  assert.equal(parsed.conversations[0].title, "newer chat");
  assert.deepEqual(parsed.conversations[0].messages, [
    "I prefer dark mode in every tool I use daily",
    "Second message comes after the first one chronologically",
  ]);
  assert.equal(parsed.conversations[1].title, "older chat");
  assert.equal(parsed.conversations[1].messages.length, 1);
});

test("parseConversationExport: Claude chat_messages — human only, content-array fallback, ISO date", () => {
  const raw = JSON.stringify([
    {
      name: "vault planning",
      created_at: "2026-01-05T10:00:00Z",
      chat_messages: [
        { sender: "human", text: "Let us keep the daemon on port 6723 for every install" },
        { sender: "assistant", text: "Noted — 6723 it is, I will pin that for you." },
        { sender: "human", text: "", content: [{ type: "text", text: "Also: never auto-save memories without my accept" }] },
      ],
    },
  ]);
  const parsed = parseConversationExport(raw);
  assert.ok(parsed);
  assert.equal(parsed.source, "claude");
  assert.equal(parsed.conversations[0].date, "2026-01-05");
  assert.deepEqual(parsed.conversations[0].messages, [
    "Let us keep the daemon on port 6723 for every install",
    "Also: never auto-save memories without my accept",
  ]);
});

test("parseConversationExport: memory lists and broken JSON are not exports", () => {
  assert.equal(parseConversationExport(JSON.stringify(["a plain memory list entry"])), null);
  assert.equal(parseConversationExport("{ not json"), null);
  assert.equal(parseConversationExport("[]"), null);
});

function rec(title: string, date: string, msgChars: number, msgs: number): ConversationRecord {
  return { source: "chatgpt", title, date, messages: Array.from({ length: msgs }, () => "m".repeat(msgChars)) };
}

test("queue roundtrip: build → status → one chunk drains it → files cleaned up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-mine-"));
  try {
    await buildQueue([rec("small a", "2026-01-01", 100, 3), rec("small b", "2026-01-02", 100, 2)], dir);
    assert.deepEqual(await queueStatus(dir), { total: 2, remaining: 2 });

    const chunk = await readNextChunk(dir);
    assert.ok(chunk);
    assert.equal(chunk.conversations, 2);
    assert.equal(chunk.remaining, 0);
    assert.equal(chunk.source, "chatgpt");
    assert.match(chunk.body, /### 2026-01-01 · small a \(chatgpt\)/);

    // drained → queue files removed, next call reports empty
    await assert.rejects(access(join(dir, QUEUE_FILE)));
    assert.equal(await readNextChunk(dir), null);
    assert.deepEqual(await queueStatus(dir), { total: 0, remaining: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("chunk budget: a big conversation gets its own chunk, cursor advances across calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-mine-big-"));
  try {
    // ~9.5k chars each → any two exceed the 16k budget → three chunks
    const big = [rec("c1", "2026-03-03", 1900, 5), rec("c2", "2026-03-02", 1900, 5), rec("c3", "2026-03-01", 1900, 5)];
    await buildQueue(big, dir);

    const first = await readNextChunk(dir);
    assert.ok(first);
    assert.equal(first.conversations, 1);
    assert.equal(first.remaining, 2);
    assert.deepEqual(await queueStatus(dir), { total: 3, remaining: 2 });

    const second = await readNextChunk(dir);
    assert.ok(second);
    assert.equal(second.conversations, 1);
    assert.equal(second.remaining, 1);

    const third = await readNextChunk(dir);
    assert.ok(third);
    assert.equal(third.remaining, 0);
    assert.equal(await readNextChunk(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildQueue appends to an existing queue without resetting the cursor; clearQueue discards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-mine-append-"));
  try {
    await buildQueue([rec("c1", "2026-03-03", 1900, 5), rec("c2", "2026-03-02", 1900, 5)], dir);
    const first = await readNextChunk(dir); // cursor → 1
    assert.ok(first);
    assert.equal(first.remaining, 1);

    await buildQueue([rec("c3", "2026-03-01", 100, 2)], dir);
    assert.deepEqual(await queueStatus(dir), { total: 3, remaining: 2 });

    await clearQueue(dir);
    assert.deepEqual(await queueStatus(dir), { total: 0, remaining: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
