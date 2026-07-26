/**
 * The M0 gold set's two-step discipline (#262, §19).
 *
 * The rule these tests defend: a query is fixed BEFORE anyone opens the memory
 * it is supposed to retrieve. A paraphrase written while looking at its target
 * is a paraphrase of the answer, and measuring retrieval against it measures
 * how well the index finds text derived from itself.
 *
 * Run: npx tsx --test packages/eval/__tests__/goldset.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkLabels,
  checkStaged,
  coverage,
  detectLang,
  hasIdentifier,
  originRefHash,
  stagedId,
  type GoldCase,
  type GoldLabel,
  type StagedQuery,
} from "../src/goldset.js";
import { harvestFromEvents } from "../src/goldset-harvest.js";
import { mergeCases, templateFor } from "../src/goldset-label.js";
import { stageBlind } from "../src/goldset-blind.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const staged = (q: string, over: Partial<StagedQuery> = {}): StagedQuery => ({
  id: stagedId(q),
  query: q,
  origin_type: "user_query",
  authoring_mode: "verbatim from a real recall",
  origin_ref_hash: originRefHash("ref"),
  lang: detectLang(q),
  has_identifier: hasIdentifier(q),
  ...over,
});

const label = (id: string, over: Partial<GoldLabel> = {}): GoldLabel => ({
  staged_id: id,
  expected_ids: ["m1"],
  acceptable_alternatives: [],
  expected_zone: "orbit",
  no_answer: false,
  scope: null,
  time_view: null,
  allowed_retrieval_depth: 10,
  rationale: "m1 is the only memory stating this rule",
  kind: "descriptive",
  labelled_at: "2026-07-26",
  labelled_by: "Daniel",
  ...over,
});

test("a staged query carries provenance and no gold — the type cannot hold one", () => {
  const s = staged("wie war die regel für force pushes");
  assert.deepEqual(checkStaged([s]), []);
  // The gold is genuinely absent, not merely empty: there is no field for it.
  assert.equal("expected_ids" in s, false);
  assert.equal(s.id, stagedId(s.query), "the id is the query's hash, so re-harvesting is idempotent");
});

test("provenance is enforced, not decorative", () => {
  assert.ok(
    checkStaged([staged("q", { origin_type: "vibes" as unknown as StagedQuery["origin_type"] })])
      .some((i) => /five §19 sources/.test(i.problem)),
  );
  assert.ok(checkStaged([staged("q", { authoring_mode: "" })]).some((i) => /authoring_mode/.test(i.problem)));
  assert.ok(
    checkStaged([staged("q", { origin_ref_hash: "not-a-hash" })]).some((i) => /sha256/.test(i.problem)),
    "the reference must be hashed — raw local paths never travel (§19)",
  );

  const s = staged("q");
  assert.ok(
    checkStaged([s, { ...s }]).some((i) => /duplicate/.test(i.problem)),
    "the same query twice is one case, not two",
  );
});

test("a label that grades nothing, or contradicts itself, is rejected", () => {
  const s = staged("wie war die regel für force pushes");
  assert.deepEqual(checkLabels([label(s.id)], [s]), []);

  const bad = (over: Partial<GoldLabel>) => checkLabels([label(s.id, over)], [s]).map((i) => i.problem).join(" | ");
  assert.match(bad({ rationale: "" }), /rationale is mandatory/);
  assert.match(bad({ no_answer: true }), /no_answer case cannot expect ids/);
  assert.match(bad({ expected_ids: [] }), /grades nothing/);
  assert.match(bad({ allowed_retrieval_depth: 0 }), /positive integer/);
  assert.match(
    bad({ expected_ids: ["m1"], acceptable_alternatives: ["m1"] }),
    /both expected and merely acceptable/,
  );
  assert.match(
    checkLabels([label("no-such-query")], [s]).map((i) => i.problem).join(" | "),
    /the two steps drifted apart/,
    "a label pointing at nothing means the staged file changed under it",
  );
});

test("a no-answer case is a real case: no ids expected, and it still needs a rationale", () => {
  const s = staged("what did we decide about the kubernetes migration");
  const l = label(s.id, { no_answer: true, expected_ids: [], rationale: "nothing in the vault covers kubernetes" });
  assert.deepEqual(checkLabels([l], [s]), []);
});

test("language detection keeps `mixed` meaningful instead of swallowing keyword chains", () => {
  assert.equal(detectLang("wie war die regel für force pushes"), "de");
  assert.equal(detectLang("how should the daemon handle a restart"), "en");
  assert.equal(detectLang("wie ist das mit dem daemon restart handling and why"), "mixed");
  // The case that forced the fourth value: a hook-built keyword chain is not in
  // a language at all, and filing it as `mixed` put 94% of a real harvest into
  // one bucket.
  assert.equal(detectLang("memory format schema json yaml markdown frontmatter structure"), "neutral");
});

test("identifier detection finds the exact-lookup cases §19 asks for", () => {
  assert.ok(hasIdentifier("warum wirft packages/core/src/search.ts einen fehler"));
  assert.ok(hasIdentifier("was war der fix in #253"));
  assert.ok(hasIdentifier("recall-when-expanded boost drift"));
  assert.ok(hasIdentifier("commit 7a891d8 was war da"));
  assert.equal(hasIdentifier("wie war das mit dem pinnen"), false);
});

test("the harvester takes queries from telemetry and never a gold id", () => {
  const dir = mkdtempSync(join(tmpdir(), "goldset-harvest-"));
  const file = join(dir, "events-2026-07-26.jsonl");
  writeFileSync(
    file,
    [
      // A deliberate MCP recall and a hook-derived one map to different origins.
      JSON.stringify({ kind: "recall", query: "wie war die regel für force pushes", recall_id: "r1", ts: 1 }),
      JSON.stringify({ kind: "hook_recall", query: "daemon restart nach core-änderung", recall_id: "r2", ts: 2 }),
      // The event also records what the system answered. Carrying that over
      // would bias selection toward queries the system already handles.
      JSON.stringify({ kind: "recall", query: "pinning und floors lifecycle regeln", hits: ["m1", "m2"], ts: 3 }),
      JSON.stringify({ kind: "recall", query: "kurz", ts: 4 }),
      JSON.stringify({ kind: "recall", query: "wie war die regel für force pushes", ts: 5 }),
      JSON.stringify({ kind: "save", query: "not a recall", ts: 6 }),
      "{ not json",
    ].join("\n") + "\n",
    "utf8",
  );

  const r = harvestFromEvents([file], 100, 12);
  assert.equal(r.staged.length, 3, "two duplicates and one too-short query drop out");
  assert.equal(r.skippedDuplicate, 1);
  assert.equal(r.skippedShort, 1);
  assert.deepEqual(checkStaged(r.staged), []);

  for (const s of r.staged) {
    assert.equal("hits" in s, false, "the system's own answer never reaches the staged query");
    assert.equal("expected_ids" in s, false);
  }
  const origins = new Set(r.staged.map((s) => s.origin_type));
  assert.ok(origins.has("user_query") && origins.has("session_transcript"), "the event kind decides the origin");
});

test("the template offers every §19 field empty, so none is silently skipped", () => {
  const s = staged("wie war die regel für force pushes");
  const t = templateFor(s);
  assert.equal(t.staged_id, s.id);
  assert.equal(t.rationale, "", "empty and required — the checker refuses it until it is filled");
  assert.equal(t.labelled_by, "");
  assert.ok(checkLabels([t], [s]).some((i) => /rationale is mandatory/.test(i.problem)));
});

test("merging joins the two steps and the coverage names what is still missing", () => {
  const a = staged("wie war die regel für force pushes");
  const b = staged("what did we decide about the kubernetes migration");
  const cases = mergeCases(
    [a, b],
    [
      label(a.id, { kind: "descriptive" }),
      label(b.id, { kind: "associative", no_answer: true, expected_ids: [], rationale: "nothing covers it" }),
    ],
  );

  assert.equal(cases.length, 2);
  assert.equal(cases[0].query, a.query, "the query travels from step 1");
  assert.equal(cases[0].origin_type, "user_query", "and so does its provenance");
  assert.equal("staged_id" in cases[0], false, "the join key does not survive into the case");

  const cov = coverage(cases as GoldCase[]);
  assert.equal(cov.total, 2);
  assert.equal(cov.no_answer, 1);
  assert.equal(cov.by_kind.descriptive, 1);
  assert.equal(cov.by_kind.associative, 1);
  assert.equal(cov.non_application, 0, "C-036 cases are still missing, and the count says so");
});

test("the no-answer aid is derived from the engine's verdict and stays OUT of step 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "goldset-aid-"));
  const file = join(dir, "events-2026-07-26.jsonl");
  writeFileSync(
    file,
    [
      // Never answered: a genuine no-answer candidate.
      JSON.stringify({ kind: "recall", query: "was haben wir zu kubernetes entschieden", hit_count: 0, ts: 1 }),
      // Answered once, empty another time — NOT a candidate. Only the full
      // history shows that, which is why every occurrence is tracked.
      JSON.stringify({ kind: "recall", query: "wie war die regel für force pushes", hit_count: 0, ts: 2 }),
      JSON.stringify({ kind: "recall", query: "wie war die regel für force pushes", top_score: 140, ts: 3 }),
      // Above the floor throughout.
      JSON.stringify({ kind: "recall", query: "pinning und floors lifecycle regeln", top_score: 120, ts: 4 }),
    ].join("\n") + "\n",
    "utf8",
  );

  const r = harvestFromEvents([file], 100, 12);
  assert.deepEqual(
    r.noAnswerCandidates,
    [stagedId("was haben wir zu kubernetes entschieden")],
    "a query answered even once is not a no-answer candidate",
  );
  for (const s of r.staged) {
    assert.equal("no_answer" in s, false, "the engine's verdict never becomes a field on a staged query");
    assert.equal("no_answer_candidate" in s, false);
  }
});

test("the blind intake stamps who and how, and refuses a harvested origin", () => {
  const lines = [
    "# paraphrases",
    "wie war die regel für force pushes nochmal",
    "",
    "what did we decide about the kubernetes migration",
    "wie war die regel für force pushes nochmal",
  ];
  const staged = stageBlind(lines, "second_person", "Sali", "wrote them from memory, vault closed", "q.txt");

  assert.equal(staged.length, 2, "comments, blanks and the repeat drop out");
  assert.deepEqual(checkStaged(staged), []);
  assert.match(staged[0].authoring_mode, /vault closed/);
  assert.match(staged[0].authoring_mode, /authored by Sali/, "a blind batch is only as good as who vouches for it");
  assert.equal(staged[0].origin_type, "second_person");
  assert.equal(staged[0].lang, "de");
  assert.equal(staged[1].lang, "en", "the language balance a harvest cannot deliver comes from here");
});

test("hook-composed strings are not formulations and never reach the set", () => {
  const dir = mkdtempSync(join(tmpdir(), "goldset-tmpl-"));
  const file = join(dir, "events-2026-07-26.jsonl");
  writeFileSync(
    file,
    [
      // The PreToolUse hook composes these from file type + tags. Real traffic,
      // worth measuring — but nobody formulated them, and on the live logs they
      // were 112 of 400 staged queries.
      JSON.stringify({ kind: "hook_recall", query: "editing ts involving typescript, daemon, testing", ts: 1 }),
      JSON.stringify({ kind: "hook_recall", query: "writing css involving css, styles, flexbox, layout", ts: 2 }),
      JSON.stringify({ kind: "hook_recall", query: "CarNexus active context project-facts decisions", ts: 3 }),
      JSON.stringify({ kind: "hook_recall", query: "bastra-pro preferences user-preference active context", ts: 4 }),
      // A question somebody actually asked survives.
      JSON.stringify({ kind: "recall", query: "readabilityHandler subprocess pipe blocking read", ts: 5 }),
    ].join("\n") + "\n",
    "utf8",
  );

  const r = harvestFromEvents([file], 100, 12);
  assert.equal(r.skippedTemplate, 4);
  assert.deepEqual(
    r.staged.map((s) => s.query),
    ["readabilityHandler subprocess pipe blocking read"],
    "a quarter of the set being one machine sentence with the nouns swapped is not coverage",
  );
});
