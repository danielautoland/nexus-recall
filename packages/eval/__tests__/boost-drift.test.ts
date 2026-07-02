import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BASE_BOOST,
  TREATMENT_RECALL_WHEN_BOOST,
  EXPANDED_RECALL_WHEN_BOOST,
} from "../src/index-config.js";

/**
 * Drift guard. The ablation mirrors core's field weights by hand (the
 * harness must be able to vary ONE knob, which means it can't just import
 * core's hardcoded boost map). This test fails if core's SearchIndex boosts
 * change without the mirror in index-config.ts being updated — so a stale
 * ablation can't quietly report a lift against the wrong baseline.
 */
const searchSrc = readFileSync(
  resolve(import.meta.dirname, "../../core/src/search.ts"),
  "utf8",
);

test("ablation field weights stay in sync with core SearchIndex", () => {
  const expected: Record<string, number> = {
    recall_when_flat: TREATMENT_RECALL_WHEN_BOOST,
    recall_when_expanded_flat: EXPANDED_RECALL_WHEN_BOOST,
    title: BASE_BOOST.title,
    tags_flat: BASE_BOOST.tags_flat,
    topic_path_flat: BASE_BOOST.topic_path_flat,
    summary: BASE_BOOST.summary,
    body: BASE_BOOST.body,
  };
  for (const [field, weight] of Object.entries(expected)) {
    assert.match(
      searchSrc,
      new RegExp(`${field}:\\s*${weight}\\b`),
      `core/src/search.ts should boost ${field} at ${weight} — update index-config.ts if core changed`,
    );
  }
});
