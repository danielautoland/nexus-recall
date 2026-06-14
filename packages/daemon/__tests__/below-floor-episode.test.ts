import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Telemetry, countBelowFloor } from "../src/telemetry.js";

// #121 — the "one wire to check": a candidate that sat BELOW the score floor
// (the far slice) must still be able to produce a recall_episode with
// band="below_floor", acted_on=true, and a non-null surfaced_score once a
// later tool input proves it was the would-be terminal pick. If this fails,
// the far slice is invisible to training and the mechanism is wrong.
test("below-floor candidate yields an acted_on recall_episode (far slice is observable)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-below-floor-"));
  const prevPath = process.env.BASTRA_LOG_PATH;
  const prevTelemetry = process.env.BASTRA_TELEMETRY;
  process.env.BASTRA_LOG_PATH = dir;
  process.env.BASTRA_TELEMETRY = "on";

  try {
    const telemetry = new Telemetry();
    telemetry.rotateTurn("session-far");

    // A hook_recall pool where the gold memory ranked below floor (score 12 < 30).
    telemetry.recordHookHints("recall-far", [
      { id: "noise-1", score: 45 },
      { id: "noise-2", score: 28 },
      { id: "mem-far", score: 12 }, // the would-be terminal pick, below floor
    ]);

    // The agent reaches past the surfaced (floored) hints and loads mem-far anyway.
    const hint = telemetry.findHookHintFor("mem-far");
    assert.ok(hint, "below-floor candidate must be retrievable from hook hints");
    assert.equal(hint.rank, 3);
    assert.equal(hint.score, 12);

    // #121 — the primary far-slice stream: a load_memory of a below-floor pool member
    // must carry hook_hint_score on the wire, so the would-be terminal pick is observable
    // even though the hint was never surfaced (hook filters score<floor before showing).
    await telemetry.logLoadMemory({
      id: "mem-far",
      found: true,
      follows_recall: null,
      from_hook_recall: hint.recall_id,
      hook_hint_rank: hint.rank,
      hook_hint_score: hint.score,
    });

    telemetry.recordLoadedMemory({
      memory_id: "mem-far",
      distinctive_tokens: ["farsignal", "belowfloortoken", "thirdanchor"],
      hook_hint: { recall_id: hint.recall_id, score: hint.score },
      session_id: "session-far",
    });

    const episodes = telemetry.matchLoadedMemories({
      tool_name: "Write",
      tool_input_excerpt: "wire up farsignal and reconcile belowfloortoken paths",
      session_id: "session-far",
    });

    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].band, "below_floor");
    assert.equal(episodes[0].acted_on, true);
    assert.equal(episodes[0].surfaced_score, 12);
    assert.equal(episodes[0].recall_id, "recall-far");
    await telemetry.logRecallEpisode(episodes[0]);

    const today = new Date().toISOString().slice(0, 10);
    const raw = await readFile(join(dir, `events-${today}.jsonl`), "utf8");
    assert.match(raw, /"kind":"recall_episode"/);
    assert.match(raw, /"band":"below_floor"/);
    assert.match(raw, /"acted_on":true/);
    // the load stream carries the below-floor would-be pick (the queryable far slice)
    assert.match(raw, /"kind":"load_memory"[^\n]*"hook_hint_score":12/);
  } finally {
    if (prevPath === undefined) delete process.env.BASTRA_LOG_PATH;
    else process.env.BASTRA_LOG_PATH = prevPath;
    if (prevTelemetry === undefined) delete process.env.BASTRA_TELEMETRY;
    else process.env.BASTRA_TELEMETRY = prevTelemetry;
    await rm(dir, { recursive: true, force: true });
  }
});

test("countBelowFloor counts only sub-floor candidates in the pool", () => {
  const pool = [{ score: 120 }, { score: 30 }, { score: 29 }, { score: 5 }];
  assert.equal(countBelowFloor(pool), 2); // 29 and 5 are below the default floor of 30
});
