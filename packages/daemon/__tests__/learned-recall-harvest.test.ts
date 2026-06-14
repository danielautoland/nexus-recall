/**
 * Tests for src/learned-recall/harvest.ts — reconstruct reaches + mint bridges offline.
 *
 * Run: npx tsx --test packages/daemon/__tests__/learned-recall-harvest.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  reconstructReaches,
  harvestBridges,
  type TelemetryEvent,
} from "../src/learned-recall/harvest.js";

function ev(kind: string, fields: Record<string, unknown>): TelemetryEvent {
  return { kind, ts: "2026-06-14T00:00:00.000Z", ...fields };
}

test("reconstructReaches joins query (hook_recall/recall) to acted-on memory by recall_id", () => {
  const events = [
    ev("hook_recall", { recall_id: "r1", query: "warum schließt sich das Panel" }),
    ev("recall", { recall_id: "r2", query: "wie speichere ich das Feld" }),
    ev("recall_episode", { recall_id: "r1", memory_id: "nspanel-lesson", acted_on: true }),
    ev("recall_episode", { recall_id: "r2", memory_id: "save-lesson", acted_on: false }), // not acted on
    ev("recall_episode", { recall_id: "rX", memory_id: "orphan", acted_on: true }), // no matching query
  ];
  const reaches = reconstructReaches(events);
  assert.equal(reaches.length, 1, "only the acted_on episode with a known query counts");
  assert.deepEqual(reaches[0], { query: "warum schließt sich das Panel", memoryId: "nspanel-lesson" });
});

test("harvestBridges mints from reaches, using non-overlapping memory terms as expansion", () => {
  const reaches = [{ query: "warum schließt sich das Panel beim Dialog", memoryId: "m1" }];
  const terms: Record<string, string[]> = { m1: ["nspanel", "resignkey", "observer", "panel"] };
  const { bridges, minted } = harvestBridges(reaches, (id) => terms[id] ?? []);
  assert.equal(minted, 1);
  const b = bridges[0];
  assert.equal(b.lang, "de");
  assert.ok(b.trigger_terms.includes("panel"));
  assert.ok(b.expansion_terms.includes("resignkey"));
  assert.ok(b.expansion_terms.includes("observer"));
  assert.ok(!b.expansion_terms.includes("panel"), "a term in the query is not also an expansion");
  assert.equal(b.evidence, 1);
});

test("harvestBridges accumulates evidence when the same bridge is reached repeatedly", () => {
  const reaches = [
    { query: "warum schließt sich das Panel beim Dialog", memoryId: "m1" },
    { query: "warum schließt sich das Panel beim Dialog", memoryId: "m1" },
    { query: "warum schließt sich das Panel beim Dialog", memoryId: "m1" },
  ];
  const { bridges, minted } = harvestBridges(reaches, () => ["nspanel", "resignkey", "observer"]);
  assert.equal(minted, 1, "identical reaches dedupe to one bridge");
  assert.equal(bridges[0].evidence, 3, "evidence counts the reaches");
});

test("harvestBridges skips reaches with no language signal or no usable expansion", () => {
  const reaches = [
    { query: "NSPanel resignKey Observer", memoryId: "m1" }, // code-shaped → language abstains
    { query: "warum schließt das Panel", memoryId: "m2" }, // memory terms all already in query → no expansion
  ];
  const terms: Record<string, string[]> = { m1: ["foo", "bar"], m2: ["panel", "schließt"] };
  const { minted } = harvestBridges(reaches, (id) => terms[id] ?? []);
  assert.equal(minted, 0);
});

test("harvestBridges skips a memory with no terms (e.g. deleted memory)", () => {
  const reaches = [{ query: "warum schließt sich das Panel", memoryId: "gone" }];
  const { minted } = harvestBridges(reaches, () => []);
  assert.equal(minted, 0);
});
