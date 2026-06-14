import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSignals,
  latenessWeight,
  type AnyEvent,
} from "../scripts/teacher-behavioral.ts";

// Build a 3-round reformulation chain in one session that lands on round 3.
// round 1 → loads mem-wrong, re-queried past (negative)
// round 2 → no episode (pure miss)
// round 3 → loads mem-gold, acted_on (terminal pick)
function chainEvents(): AnyEvent[] {
  const sid = "s1";
  return [
    { kind: "hook_recall", ts: "2026-06-14T10:00:00.000Z", session_id: sid, recall_id: "r1", query: "q round one" },
    { kind: "recall_episode", ts: "2026-06-14T10:00:05.000Z", session_id: sid, recall_id: "r1", memory_id: "mem-wrong", acted_on: false, band: "optional" },
    { kind: "hook_recall", ts: "2026-06-14T10:00:20.000Z", session_id: sid, recall_id: "r2", query: "q round two" },
    { kind: "hook_recall", ts: "2026-06-14T10:00:40.000Z", session_id: sid, recall_id: "r3", query: "q round three" },
    { kind: "recall_episode", ts: "2026-06-14T10:00:45.000Z", session_id: sid, recall_id: "r3", memory_id: "mem-gold", acted_on: true, band: "below_floor", surfaced_score: 18 },
  ];
}

test("terminal pick anchors the whole chain, weighted by lateness", () => {
  const sigs = extractSignals(chainEvents());
  const anchors = sigs.filter((s) => s.type === "anchor");
  // rounds 1,2,3 all anchor to the terminal memory (mem-gold)
  assert.equal(anchors.length, 3);
  for (const a of anchors) assert.equal(a.memory_id, "mem-gold");
  const r1 = anchors.find((a) => a.round === 1)!;
  const r3 = anchors.find((a) => a.round === 3)!;
  // round 1 (farthest proven paraphrase) outweighs the terminal query
  assert.ok(r1.weight > r3.weight, "earlier miss must weigh more than the landing");
  assert.equal(r3.weight, 1);
});

test("re-query mints an on-the-record negative for the rejected memory", () => {
  const sigs = extractSignals(chainEvents());
  const negs = sigs.filter((s) => s.type === "negative");
  assert.equal(negs.length, 1);
  assert.equal(negs[0].memory_id, "mem-wrong");
  assert.equal(negs[0].query, "q round one");
});

test("a give-up chain raises a flare and mints NO anchor", () => {
  const sid = "s2";
  const events: AnyEvent[] = [
    { kind: "hook_recall", ts: "2026-06-14T11:00:00.000Z", session_id: sid, recall_id: "g1", query: "give up one" },
    { kind: "recall_episode", ts: "2026-06-14T11:00:05.000Z", session_id: sid, recall_id: "g1", memory_id: "m1", acted_on: false },
    { kind: "hook_recall", ts: "2026-06-14T11:00:20.000Z", session_id: sid, recall_id: "g2", query: "give up two" },
    { kind: "recall_episode", ts: "2026-06-14T11:00:25.000Z", session_id: sid, recall_id: "g2", memory_id: "m2", acted_on: false },
  ];
  const sigs = extractSignals(events);
  assert.equal(sigs.filter((s) => s.type === "anchor").length, 0);
  const flares = sigs.filter((s) => s.type === "flare");
  assert.equal(flares.length, 1);
  assert.equal(flares[0].type === "flare" && flares[0].chain_len, 2);
});

test("a gap longer than CHAIN_GAP_MS splits chains so they don't bleed together", () => {
  const sid = "s3";
  const events: AnyEvent[] = [
    { kind: "hook_recall", ts: "2026-06-14T12:00:00.000Z", session_id: sid, recall_id: "a1", query: "first task" },
    { kind: "recall_episode", ts: "2026-06-14T12:00:03.000Z", session_id: sid, recall_id: "a1", memory_id: "mA", acted_on: true },
    // 10 minutes later — a separate task, not a reformulation of the first
    { kind: "hook_recall", ts: "2026-06-14T12:10:00.000Z", session_id: sid, recall_id: "b1", query: "second task" },
    { kind: "recall_episode", ts: "2026-06-14T12:10:03.000Z", session_id: sid, recall_id: "b1", memory_id: "mB", acted_on: true },
  ];
  const sigs = extractSignals(events);
  const anchors = sigs.filter((s) => s.type === "anchor");
  // two independent landings, each a 1-round chain → 2 anchors, no cross-binding
  assert.equal(anchors.length, 2);
  assert.deepEqual(new Set(anchors.map((a) => a.memory_id)), new Set(["mA", "mB"]));
});

test("latenessWeight: terminal=1, single-round=1, earlier rounds heavier", () => {
  assert.equal(latenessWeight(1, 1), 1);
  assert.equal(latenessWeight(3, 3), 1);
  assert.equal(latenessWeight(1, 3), 2); // farthest of a 3-round chain
  assert.ok(latenessWeight(2, 3) < latenessWeight(1, 3));
});
