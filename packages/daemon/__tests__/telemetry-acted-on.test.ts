import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Telemetry } from "../src/telemetry.js";

test("recall_episode closes a loaded memory with acted_on=true without logging raw tokens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-acted-on-"));
  const prevPath = process.env.BASTRA_LOG_PATH;
  const prevTelemetry = process.env.BASTRA_TELEMETRY;
  process.env.BASTRA_LOG_PATH = dir;
  process.env.BASTRA_TELEMETRY = "on";

  try {
    const telemetry = new Telemetry();
    telemetry.rotateTurn("session-a");
    telemetry.recordLoadedMemory({
      memory_id: "mem-a",
      distinctive_tokens: ["secretbanana", "privateraisin", "thirdanchor"],
      hook_hint: { recall_id: "recall-a", score: 125 },
      session_id: "session-a",
    });

    const episodes = telemetry.matchLoadedMemories({
      tool_name: "Write",
      tool_input_excerpt: "Apply the secretbanana migration and preserve privateraisin semantics.",
      session_id: "session-a",
    });

    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].acted_on, true);
    assert.equal(episodes[0].match_strength, 2);
    assert.equal(episodes[0].band, "required");
    await telemetry.logRecallEpisode(episodes[0]);

    const today = new Date().toISOString().slice(0, 10);
    const raw = await readFile(join(dir, `events-${today}.jsonl`), "utf8");
    assert.match(raw, /"kind":"recall_episode"/);
    assert.doesNotMatch(raw, /secretbanana|privateraisin/);
  } finally {
    if (prevPath === undefined) delete process.env.BASTRA_LOG_PATH;
    else process.env.BASTRA_LOG_PATH = prevPath;
    if (prevTelemetry === undefined) delete process.env.BASTRA_TELEMETRY;
    else process.env.BASTRA_TELEMETRY = prevTelemetry;
    await rm(dir, { recursive: true, force: true });
  }
});

test("recall_episode closes disjoint follow-up edits with acted_on=false", () => {
  const telemetry = new Telemetry();
  telemetry.rotateTurn("session-b");
  telemetry.recordLoadedMemory({
    memory_id: "mem-b",
    distinctive_tokens: ["quartzledger", "violetbridge"],
    hook_hint: { recall_id: "recall-b", score: 70 },
    session_id: "session-b",
  });

  const episodes = telemetry.matchLoadedMemories({
    tool_name: "Edit",
    tool_input_excerpt: "Change the button label and update unrelated copy.",
    session_id: "session-b",
  });

  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].acted_on, false);
  assert.equal(episodes[0].match_strength, 0);
  assert.equal(episodes[0].band, "optional");

  const second = telemetry.matchLoadedMemories({
    tool_name: "Edit",
    tool_input_excerpt: "quartzledger violetbridge",
    session_id: "session-b",
  });
  assert.equal(second.length, 0);
});
