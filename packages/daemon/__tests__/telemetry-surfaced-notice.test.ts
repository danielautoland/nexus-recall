/**
 * Tests für die "surfaced"-Notice (#221): recall UND hook_recall lassen ihre
 * Top-3-Treffer über den onRecalled-Hook aufleuchten — nicht nur das seltene
 * load_memory. Der Hook feuert VOR dem enabled-Gate (UI-Signal, nicht
 * Persistenz) und deckelt auf Top-3.
 *
 * Runner: `tsx --test __tests__/telemetry-surfaced-notice.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Telemetry } from "../src/telemetry.js";

const hit = (id: string, score: number) => ({ id, score, type: "memory" });

test("onRecalled fires with the top-3 recall hits (capped)", async () => {
  const telemetry = new Telemetry();
  const seen: string[][] = [];
  telemetry.onRecalled = (ids) => seen.push(ids);

  await telemetry.logRecall({
    recall_id: "r1",
    query: "q",
    k: 5,
    scope: null,
    type: null,
    vault_size: 10,
    hit_count: 5,
    top_score: 90,
    hits: [hit("a", 90), hit("b", 80), hit("c", 70), hit("d", 60), hit("e", 50)],
    latency_ms: 1,
    recall_stages: undefined,
    dropped_below_floor: 0,
  });

  assert.deepEqual(seen, [["a", "b", "c"]], "only the top-3 ids light up");
});

test("onRecalled fires on the hook_recall path too", async () => {
  const telemetry = new Telemetry();
  const seen: string[][] = [];
  telemetry.onRecalled = (ids) => seen.push(ids);

  await telemetry.logHookRecall({
    recall_id: "h1",
    query: "q",
    hits: [hit("x", 88), hit("y", 77)],
  });

  assert.deepEqual(seen, [["x", "y"]], "hook_recall surfaces its hits (< 3 = all)");
});

test("a throwing onRecalled never breaks the recall", async () => {
  const telemetry = new Telemetry();
  telemetry.onRecalled = () => {
    throw new Error("notice sink blew up");
  };
  await assert.doesNotReject(
    telemetry.logRecall({
      recall_id: "r2",
      query: "q",
      k: 1,
      scope: null,
      type: null,
      vault_size: 1,
      hit_count: 1,
      top_score: 90,
      hits: [hit("a", 90)],
      latency_ms: 1,
      recall_stages: undefined,
      dropped_below_floor: 0,
    }),
  );
});
