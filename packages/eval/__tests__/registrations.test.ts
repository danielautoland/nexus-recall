/**
 * The M0 registration duties, checked (#261; C-029, C-040, C-072, C-074).
 *
 * These two gate conditions are discipline, and discipline that only lives in
 * a document holds until the first deadline. The tests below are the reason it
 * holds afterwards.
 *
 * Run: npx tsx --test packages/eval/__tests__/registrations.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCueRegistration,
  checkForeignFigures,
  loadCueRegistration,
  loadForeignFigures,
  rankingBlocker,
  EVIDENCE_CLASSES,
  type ForeignFigure,
} from "../src/registrations.js";

const base: ForeignFigure = {
  id: "x", system: "X", claim: "1%", evidence_class: "peer_reviewed",
  source: "doi:10.0/x", version: "v1", locus: "Table 1", retrieved: "2026-07-25",
  reader: "gpt-4o", judge: "gpt-4o", top_k: "10", context_budget: "128k",
};

test("the committed foreign-figure registry passes its own rules", () => {
  const issues = checkForeignFigures();
  assert.deepEqual(issues, [], `registry violates §29.1: ${JSON.stringify(issues, null, 2)}`);

  const figures = loadForeignFigures();
  assert.ok(figures.length >= 19, "every measurement checked in §29.3 is carried");
  for (const f of figures) {
    assert.ok(EVIDENCE_CLASSES.includes(f.evidence_class), `${f.id} has a real evidence class`);
  }
});

test("a figure without an evidence class or a citation field is rejected", () => {
  const noClass = { ...base, evidence_class: "vibes" as unknown as ForeignFigure["evidence_class"] };
  assert.ok(checkForeignFigures([noClass]).some((i) => /evidence classes/.test(i.problem)));

  const noLocus = { ...base, locus: "" };
  assert.ok(checkForeignFigures([noLocus]).some((i) => /locus/.test(i.problem)));

  // An omitted configuration field is indistinguishable from an unchecked one,
  // so it is an error — while an explicit null is a finding and fine.
  const omitted = { ...base } as Partial<ForeignFigure>;
  delete omitted.judge;
  assert.ok(checkForeignFigures([omitted as ForeignFigure]).some((i) => /`judge` is absent/.test(i.problem)));
  assert.deepEqual(checkForeignFigures([{ ...base, judge: null }]), []);
});

test("unknown configuration blocks a shared ranking — it never counts as a match", () => {
  assert.equal(rankingBlocker(base, { ...base, id: "y" }), null, "fully stated and equal ranks together");

  assert.match(
    rankingBlocker(base, { ...base, id: "y", top_k: "200" }) ?? "",
    /`top_k` differs/,
    "Top 50 and Top 200 are two retrieval depths, not one ranking",
  );
  assert.match(
    rankingBlocker(base, { ...base, id: "y", judge: null }) ?? "",
    /does not state `judge`/,
    "an unstated judge cannot be asserted to match",
  );
});

test("the real registry is mostly unrankable, and that is the finding", () => {
  const figures = loadForeignFigures();
  const zep = figures.find((f) => f.id === "zep-locomo-longmemeval");
  const mem0 = figures.find((f) => f.id === "mem0-locomo");
  assert.ok(zep && mem0);

  assert.ok(rankingBlocker(zep, mem0), "the two headline vendor numbers may not share a ranking");

  // §29.3: of nineteen measurements, three name all four quantities. So almost
  // no pair is comparable — the check should say so rather than quietly allow it.
  const pairs = figures.length * (figures.length - 1) / 2;
  let blocked = 0;
  for (let i = 0; i < figures.length; i++) {
    for (let j = i + 1; j < figures.length; j++) if (rankingBlocker(figures[i], figures[j])) blocked++;
  }
  assert.ok(blocked / pairs > 0.9, `expected nearly every pair blocked, got ${blocked}/${pairs}`);
});

test("the committed cue registration satisfies the M0 gate and is honest about its stage", () => {
  const reg = loadCueRegistration();
  // Design A on descriptive/item with a selection/holdout split — the
  // product-owner decisions of 2026-07-26. The numbers still wait on the M0
  // baseline (§18.1), which is what the stage says.
  assert.equal(reg.status, "structure_registered");
  assert.equal(reg.design, "A");

  const a = (reg.admissible_designs as Record<string, Record<string, unknown>>).A;
  assert.deepEqual(a.fixed_cue_configuration, { descriptive_associative: "descriptive", item_scene: "item" });
  assert.equal((a.contamination_guard as Record<string, unknown>).mode, "selection_holdout_split");

  // M0's gate condition is met at this stage.
  assert.deepEqual(checkCueRegistration("structure_registered", reg), []);
  // An M2 run is not — the numbers and the split shares are still missing.
  assert.ok(checkCueRegistration("numbers_registered", reg).length > 0);

  // The parts that do NOT depend on the baseline are registered now, because
  // the point of pre-registration is that they are not chosen after the data.
  const fallback = reg.underpowered_fallback as Record<string, string>;
  assert.match(fallback.main_effect_missed, /not evaluable/);
  assert.match(fallback.interaction_missed, /explorative/);
});

test("a design that contradicts §18.3 is rejected even when fully filled in", () => {
  const wrongA = {
    status: "structure_registered",
    design: "A",
    admissible_designs: {
      A: {
        condition_count: 4,
        interaction_evaluated: true,
        fixed_cue_configuration: null,
        contamination_guard: { mode: "same_cases" },
      },
    },
  };
  const issues = checkCueRegistration("structure_registered", wrongA).map((i) => i.problem).join(" | ");
  assert.match(issues, /exactly two conditions/, "four cells belong to the cue-axis experiment, not to A");
  assert.match(issues, /may not evaluate interactions/);
  assert.match(issues, /selection\/holdout split or a nested evaluation/);
  assert.match(issues, /held-fixed cue configuration/);

  const wrongB = {
    status: "structure_registered",
    design: "B",
    admissible_designs: { B: { cell_count: 4 } },
  };
  assert.match(
    checkCueRegistration("structure_registered", wrongB).map((i) => i.problem).join(" | "),
    /eight cells/,
  );

  const noThird = { status: "structure_registered", design: "C", admissible_designs: {} };
  assert.match(
    checkCueRegistration("structure_registered", noThird).map((i) => i.problem).join(" | "),
    /no third design/,
  );
});

test("an M2 run additionally requires the numbers, separately for main effects and interaction", () => {
  const structureOnly = {
    status: "numbers_registered",
    design: "A",
    admissible_designs: {
      A: {
        condition_count: 2,
        interaction_evaluated: false,
        fixed_cue_configuration: { descriptive_associative: "descriptive", item_scene: "item" },
        contamination_guard: { mode: "selection_holdout_split" },
      },
    },
    power_assumption: { main_effects: { min_n: 120 }, interaction: { min_n: null } },
    evaluation_rule: null,
  };
  const issues = checkCueRegistration("numbers_registered", structureOnly).map((i) => i.problem).join(" | ");
  assert.match(issues, /minimum N is required/, "the interaction N is missing and the interaction needs the larger one");
  assert.match(issues, /not chosen after seeing the data/, "the evaluation rule is missing");
});

test("a named split is not a registered split until it is quantified", () => {
  const withSplit = (guard: Record<string, unknown>) => ({
    status: "numbers_registered",
    design: "A",
    admissible_designs: {
      A: {
        condition_count: 2,
        interaction_evaluated: false,
        fixed_cue_configuration: { descriptive_associative: "descriptive", item_scene: "item" },
        contamination_guard: { mode: "selection_holdout_split", ...guard },
      },
    },
    power_assumption: { main_effects: { min_n: 120 }, interaction: { min_n: 480 } },
    evaluation_rule: "paired comparison of Recall@3 on the holdout",
  });

  const unquantified = checkCueRegistration("numbers_registered", withSplit({})).map((i) => i.problem).join(" | ");
  assert.match(unquantified, /selection_share and holdout_share are part of the registration/);

  const lopsided = checkCueRegistration(
    "numbers_registered",
    withSplit({ selection_share: 0.3, holdout_share: 0.6, split_seed: 1 }),
  ).map((i) => i.problem).join(" | ");
  assert.match(lopsided, /must cover the case set exactly/, "a gap between the parts silently drops cases");

  const unseeded = checkCueRegistration(
    "numbers_registered",
    withSplit({ selection_share: 0.3, holdout_share: 0.7 }),
  ).map((i) => i.problem).join(" | ");
  assert.match(unseeded, /needs a seed/);

  assert.deepEqual(
    checkCueRegistration("numbers_registered", withSplit({ selection_share: 0.3, holdout_share: 0.7, split_seed: 20260726 })),
    [],
  );
});
