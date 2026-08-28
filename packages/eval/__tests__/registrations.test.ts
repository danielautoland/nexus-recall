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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

test("the committed cue registration carries the numbers and clears an M2 run", () => {
  const reg = loadCueRegistration();
  // Design A on descriptive/item with a selection/holdout split — the
  // product-owner decisions of 2026-07-26. The numbers followed on 2026-08-28,
  // once the M0 baseline had shown the spread of the metric (§18.1).
  assert.equal(reg.status, "numbers_registered");
  assert.equal(reg.design, "A");

  const a = (reg.admissible_designs as Record<string, Record<string, unknown>>).A;
  assert.deepEqual(a.fixed_cue_configuration, { descriptive_associative: "descriptive", item_scene: "item" });
  const guard = a.contamination_guard as Record<string, unknown>;
  assert.equal(guard.mode, "selection_holdout_split");
  assert.equal((guard.selection_share as number) + (guard.holdout_share as number), 1);
  assert.deepEqual(guard.stratify_by, ["origin_type", "lang"]);

  // Both gates pass now: the structure for M0, the numbers for M2.
  assert.deepEqual(checkCueRegistration("structure_registered", reg), []);
  assert.deepEqual(checkCueRegistration("numbers_registered", reg), []);

  // Design A is sized per condition and paired, so the holdout is the case
  // count for BOTH conditions rather than twice that.
  assert.equal(a.min_n_per_condition, 255);
  assert.equal(a.interaction_evaluated, false);

  // Every number has to be traceable to the run it came from — a registration
  // whose figures cannot be tied to an artifact cannot be checked later.
  const from = reg.numbers_derived_from as Record<string, unknown>;
  assert.match(String(from.run_artifact), /eval-runs/);
  assert.ok(String(from.git).length >= 40, "the measured commit is part of the record");

  // The parts that never depended on the baseline stay as they were.
  const fallback = reg.underpowered_fallback as Record<string, string>;
  assert.match(fallback.main_effect_missed, /not evaluable/);
  assert.match(fallback.interaction_missed, /explorative/);

  // The associative axis is the open blocker, and the file says so rather than
  // claiming the gold set is ready.
  const gold = reg.gold_set_requirement as Record<string, unknown>;
  assert.equal(gold.satisfied, false);
  const targets = gold.authoring_targets as Record<string, Record<string, number>>;
  assert.equal(targets.associative.minimum, 150);
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
        min_n_per_condition: 255,
        contamination_guard: { mode: "selection_holdout_split", stratify_by: ["origin_type"], ...guard },
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

  // A seed alone only makes an unbalanced split reproducible. Recall@3 per gold
  // file ranged 31.3%–84.9% in the M0 baseline, so an unstratified draw can move
  // the comparison baseline further than the effect under test.
  const unstratified = checkCueRegistration(
    "numbers_registered",
    withSplit({ selection_share: 0.3, holdout_share: 0.7, split_seed: 20260726, stratify_by: [] }),
  ).map((i) => i.problem).join(" | ");
  assert.match(unstratified, /what it stratifies by/);
});

test("the chosen design carries its own N — the power assumption is a different experiment", () => {
  // §18.1 asks for the per-condition/per-cell N in addition to the cue-axis
  // power assumption. Without this a registration reaches `numbers_registered`
  // while the one number the run is actually sized on is still open.
  const withoutPerCondition = {
    status: "numbers_registered",
    design: "A",
    admissible_designs: {
      A: {
        condition_count: 2,
        interaction_evaluated: false,
        fixed_cue_configuration: { descriptive_associative: "descriptive", item_scene: "item" },
        contamination_guard: {
          mode: "selection_holdout_split",
          selection_share: 0.3,
          holdout_share: 0.7,
          split_seed: 20260828,
          stratify_by: ["origin_type", "lang"],
        },
      },
    },
    power_assumption: { main_effects: { min_n: 213 }, interaction: { min_n: 852 } },
    evaluation_rule: "paired McNemar on the holdout",
  };
  assert.match(
    checkCueRegistration("numbers_registered", withoutPerCondition).map((i) => i.problem).join(" | "),
    /min_n_per_condition is required/,
    "a full power assumption does not size design A",
  );

  // Design B is sized per cell instead, and only its own field is demanded.
  const designB = {
    ...withoutPerCondition,
    design: "B",
    admissible_designs: { B: { cell_count: 8, min_n_per_cell: 852 } },
  };
  assert.deepEqual(checkCueRegistration("numbers_registered", designB), []);
});

test("the M1 tolerances are versioned, derived, and above their own noise band", () => {
  const tol = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "registrations", "m1-tolerances.json"), "utf8"),
  ) as Record<string, Record<string, unknown>>;

  // §26.1 makes the numeric M1 tolerances a release condition, and §18.1 puts
  // them after the baseline. A tolerance without a traceable run is a guess.
  assert.match(String(tol.derived_from.run_artifact), /eval-runs/);
  assert.ok(String(tol.derived_from.git).length >= 40);

  const rl = tol.relevant_loss as Record<string, unknown>;
  type Measurement = { value: number; wilson_95_ci: [number, number] };
  const measured = rl.measured as Measurement;
  const confirming = (rl.confirmed_by ?? []) as Measurement[];

  // The whole point of the derivation: a tolerance inside the confidence
  // interval fires on a clean re-run that changed nothing. That has to hold
  // against EVERY run on record, not only the one it was first derived from —
  // v3 exists because a later run moved the bound past the old tolerance.
  for (const m of [measured, ...confirming]) {
    assert.ok(
      (rl.tolerance as number) > m.wilson_95_ci[1],
      `tolerance ${String(rl.tolerance)} must sit above the upper bound ${m.wilson_95_ci[1]} of every recorded run`,
    );
    assert.ok(m.value > m.wilson_95_ci[0] && m.value < m.wilson_95_ci[1], "each point estimate lies inside its own interval");
  }
  assert.ok(confirming.length >= 1, "a raised tolerance names the runs that forced the raise");
  assert.deepEqual(rl.report_separately, ["origin_type"]);

  // False abstention is registered on weak_result, not on the score floor — the
  // floor could not fire on the hybrid path, so a tolerance on it was empty.
  const fa = tol.false_abstention as Record<string, unknown>;
  assert.equal(fa.mechanism, "weak_result");
  const faMeasured = fa.measured as { value: number; wilson_95_ci: [number, number] };
  assert.ok(
    (fa.tolerance as number) > faMeasured.wilson_95_ci[1],
    "the tolerance must sit above the upper bound of the measured interval, zero count or not",
  );
  assert.ok(String((fa.derived_from as Record<string, string>).run_artifact).includes("eval-runs"));

  // A tolerance on a predicate that never fires would be as empty as the floor
  // it replaced. The discriminance counts are what make it a real gate.
  const disc = fa.discriminance as Record<string, string>;
  assert.match(disc.gibberish_probes, /^[1-9]\d*\/\d+$/, "weak_result must fire on at least one nonsense probe");
  assert.equal(disc.answerable_cases, "0/372");

  // The abandoned mechanism stays on the record: it explains why the mechanism
  // was swapped rather than the number tuned.
  const sup = fa.supersedes as Record<string, string>;
  assert.equal(sup.previous_status, "not_registrable_on_the_current_mechanism");
  assert.match(sup.why_abandoned, /81\.967/, "the arithmetic that killed the floor is part of the record");
});
