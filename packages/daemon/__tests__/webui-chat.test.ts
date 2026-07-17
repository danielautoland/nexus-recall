/**
 * Tests für den Such-Copiloten der Vault-Map (#207):
 *   - parseQueries/parseAnswer — tolerantes Parsen kleiner lokaler Modelle
 *   - runSearchCopilot — Query-Fanout, Grounding, Modell-Auswahl vs. Fallback
 *
 * Runner: `tsx --test __tests__/webui-chat.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { parseQueries, parseAnswer, runSearchCopilot } from "../src/webui-chat.js";

test("parseQueries: strips bullets, dedupes, always leads with the raw message", () => {
  const q = parseQueries("- browser view\n2) Browser View\n* ring wheel drill\n{json}", "warum browser?");
  assert.equal(q[0], "warum browser?");
  assert.ok(q.includes("browser view"));
  assert.ok(q.includes("ring wheel drill"));
  assert.ok(!q.some((x) => x.includes("{")), "JSON-ish lines are not queries");
  assert.equal(new Set(q.map((x) => x.toLowerCase())).size, q.length, "deduped case-insensitively");
});

test("parseAnswer: strict JSON, fenced JSON, and garbage fallback", () => {
  const clean = parseAnswer('{"reply": "Found it.", "relevant": ["a1"]}');
  assert.deepEqual(clean, { reply: "Found it.", relevant: ["a1"], parsed: true });

  const fenced = parseAnswer('Sure! Here you go:\n```json\n{"reply": "Two hits.", "relevant": ["a1", "b2"]}\n```');
  assert.equal(fenced.parsed, true);
  assert.deepEqual(fenced.relevant, ["a1", "b2"]);

  const garbage = parseAnswer("I could not produce JSON but here is text.");
  assert.equal(garbage.parsed, false);
  assert.match(garbage.reply, /could not produce/);

  // truncated JSON (model stopped mid-output): the reply value must be
  // rescued — raw JSON prefix in the chat is the bug this pins
  const truncated = parseAnswer('{"reply": "Die Konventionen umfassen: Vier Schichten und die 500er-Richt');
  assert.equal(truncated.parsed, false);
  assert.equal(truncated.reply, "Die Konventionen umfassen: Vier Schichten und die 500er-Richt");
  assert.ok(!truncated.reply.includes('{"reply"'), "no raw JSON leaks to the chat");
});

function memoryMarkdown(id: string, title: string, body: string): string {
  const ts = new Date().toISOString();
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "type: reference",
    `summary: ${title}`,
    "topic_path:",
    "  - test",
    "tags:",
    "  - test",
    "scope: copilot-test",
    "recall_when:",
    `  - ${title}`,
    `created: ${ts}`,
    `updated: ${ts}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

test("runSearchCopilot: fans out queries, grounds the answer, honors the model's pick", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-copilot-test-"));
  const folder = join(dir, "memories", "knowledge");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "wheel.md"), memoryMarkdown("wheel", "Ring wheel browser", "Drill-down wheel for the vault map."));
  await writeFile(join(folder, "clouds.md"), memoryMarkdown("clouds", "Cloud force layout", "Physics clouds with anchors."));
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  try {
    const prompts: string[] = [];
    const chat = async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      // call 1: query expansion — steer toward the wheel note
      if (prompts.length === 1) return "ring wheel browser\ndrill-down wheel";
      // call 2: grounded answer picking exactly one id
      return '{"reply": "Du hast den Ring-Browser gebaut.", "relevant": ["wheel"]}';
    };
    const result = await runSearchCopilot("warum habe ich den browser gebaut?", [], { search, chat });
    assert.equal(result.reply, "Du hast den Ring-Browser gebaut.");
    assert.deepEqual(result.hits.map((h) => h.id), ["wheel"], "only the model-picked hit surfaces");
    assert.match(prompts[1], /Ring wheel browser/, "answer prompt carries the found notes");

    // unparseable second call → strongest hits fall back instead of nothing
    let n = 0;
    const flaky = async (): Promise<string> => (++n === 1 ? "ring wheel browser" : "no json today");
    const fallback = await runSearchCopilot("browser?", [], { search, chat: flaky });
    assert.ok(fallback.hits.length >= 1, "fallback surfaces top hits");
    assert.equal(fallback.reply, "no json today");
  } finally {
    search.stop();
    await vault.stop?.();
    await rm(dir, { recursive: true, force: true });
  }
});
