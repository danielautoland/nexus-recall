/**
 * The §18.2 component gates, measured on the gold set (#422).
 *
 * §18.2 lists seven "vorläufige Komponenten-Schaltgates für den
 * Evidenzentscheid". This module computes them; it does NOT decide whether they
 * pass. Two of the seven — "kein relevanter Recall@3-Verlust" and the same for
 * identifier queries — have no registered threshold, and `m1-tolerances.json`
 * is explicit about what inventing one would be worth: "an unmeasured tolerance
 * is a guess whether or not it sits in a versioned file". So the run reports
 * numbers, a later registration turns them into gates, and nothing here claims
 * a verdict.
 *
 * Three of the seven are INVARIANTS of the predicate rather than properties of
 * a corpus: a `required` must rest on a hard anchor or independent signals, a
 * derived cue must not carry one on its own, and neither must a graph hop. They
 * are unit-tested directly against `decideHit` in
 * `packages/eval/__tests__/evidence-gate-invariants.test.ts` — a test there
 * fails without a measurement run. What this module adds is the corpus side:
 * how often each invariant is even exercised, and by how much.
 *
 * The decision itself is never recomputed here. It comes from `decideHits` in
 * core, called the way the daemon calls it, so the measurement describes the
 * predicate that ships.
 */
import type { RecallDecisionHit } from "@bastra-recall/core";

/** What the gated arm produced for one case. Compact on purpose — a full
 *  `RecallEvidence` per hit would multiply the artifact by its nine fields. */
export interface CaseGateResult {
  /** 1-based rank of the first expected id among the hits the gate KEPT. */
  rank_expected: number;
  /** Same for expected ∪ acceptable. */
  rank_any: number;
  required: number;
  optional: number;
  no_answer: number;
  /**
   * `required` hits resting on neither an exact identifier nor full
   * `recall_when` coverage — they cleared the bar through the two-of-three
   * rule. §18.2 says required needs "harten Anker ODER unabhängige
   * Arm-Evidenz", and the predicate reads the second half more broadly than
   * "both arms agreed". Counted so the gap is visible rather than argued.
   */
  required_without_hard_anchor: number;
  /**
   * `required` hits with no hand-written trigger match and no exact identifier
   * — everything they have came from elsewhere (arm agreement, scope). The
   * §18.2 rule is that a DERIVED CUE alone must not produce `required`;
   * `recall_when_coverage` counts only hand-written triggers by construction,
   * so this is the population where that rule does any work.
   */
  required_without_trigger: number;
  /** `required` reached only via a graph hop. Structurally impossible — the
   *  predicate excludes `hop === "1-hop"` before it can say required (C-046).
   *  Counted anyway: a number other than zero is a defect in the predicate. */
  required_hop_only: number;
}

/**
 * Score one case's served pool through the gate.
 *
 * `served` and `decisions` are positionally aligned — `decideHits` maps the
 * list without reordering it, and the ranks below depend on that.
 */
export function gateCase(
  served: { id: string; hop?: string }[],
  decisions: RecallDecisionHit[],
  expected: Set<string>,
  any: Set<string>,
): CaseGateResult {
  const kept: string[] = [];
  const out: CaseGateResult = {
    rank_expected: 0,
    rank_any: 0,
    required: 0,
    optional: 0,
    no_answer: 0,
    required_without_hard_anchor: 0,
    required_without_trigger: 0,
    required_hop_only: 0,
  };

  decisions.forEach((d, i) => {
    out[d.decision]++;
    if (d.decision !== "no_answer") kept.push(d.id);
    if (d.decision !== "required") return;
    const e = d.evidence;
    if (!e.exact_identifier && e.recall_when_coverage < 1) out.required_without_hard_anchor++;
    if (!e.exact_identifier && e.recall_when_coverage === 0) out.required_without_trigger++;
    if (served[i]?.hop === "1-hop") out.required_hop_only++;
  });

  out.rank_expected = kept.findIndex((id) => expected.has(id)) + 1;
  out.rank_any = kept.findIndex((id) => any.has(id)) + 1;
  return out;
}

/** One row's worth of what the report needs. Mirrors `CaseResult`. */
export interface GateRow {
  no_answer: boolean;
  probe_group?: string;
  has_identifier: boolean;
  /** Ungated rank, as the run measured it. */
  rank_expected: number;
  gate?: CaseGateResult;
  /** The same case under the anchor variant — see {@link gateVariants}. */
  gate_no_body?: CaseGateResult;
}

const ratio = (n: number, d: number): number => (d === 0 ? 0 : Number((n / d).toFixed(4)));
const hitAt = (rank: number, k: number): boolean => rank >= 1 && rank <= k;

export interface ComponentGateReport {
  /**
   * §18.2: "Anti-Query-Fehlinjektionen < 5 %" — the threshold IS registered.
   *
   * Read the population before the number. `gibberish-probe` holds two kinds:
   * keyboard mash with no real word in it, and invented strings that still
   * carry one ("xqzzy frobnicate wombat telemetry"). The predicate abstains on
   * the first kind and can reach `required` on the second, through the real
   * term. Whether the second kind is an anti-query at all is a definition
   * question §18.2 does not settle, and this field does not settle it either —
   * it reports the rate over everything labelled a nonsense probe.
   */
  anti_query_injection: { value: number; count: string; threshold: 0.05; within: boolean };
  /** §18.2: "kein relevanter Recall@3-Verlust gegenüber demselben ungegateten
   *  Retrieval-Arm". No registered threshold — reported, not judged. */
  recall_at_3: { ungated: number; gated: number; delta: number; n: number };
  /** §18.2: "kein relevanter Verlust bei Identifier-Queries". Same. */
  recall_at_3_identifier_queries: { ungated: number; gated: number; delta: number; n: number };
  /** §18.2: "Falsch-Abstention bleibt unter der in M0 festgelegten Toleranz"
   *  — 0.015 on `weak_result` in m1-tolerances v4. Here: answerable cases the
   *  gate left with nothing at all. */
  false_abstention: { value: number; count: string; tolerance: 0.015; within: boolean };
  /** The three invariants, as corpus counts. Non-zero is a finding. */
  invariants: {
    required_hop_only: number;
    required_without_trigger: number;
    required_without_hard_anchor: number;
    $comment: string;
  };
  decisions: { required: number; optional: number; no_answer: number };
  $comment: string;
}

/**
 * The seven §18.2 figures over a scored run.
 *
 * Denominators follow the run's own conventions: probes never enter the main
 * ones, and the anti-query rate is measured ON the probes, which is what they
 * are for.
 */
export function componentGates(rows: GateRow[]): ComponentGateReport {
  const gated = rows.filter((r) => r.gate);
  const answerable = gated.filter((r) => !r.probe_group && !r.no_answer);
  const identifierQueries = answerable.filter((r) => r.has_identifier);

  // An anti-query is a NONSENSE query — `gibberish-probe`, keyboard mash and
  // invented words, authored so retrieval has to abstain. The other two probe
  // groups are not anti-queries: `body-loss` and `unique-n` are diagnostic runs
  // with real targets, and counting them here would measure the wrong thing in
  // the friendlier direction.
  const antiQueries = gated.filter((r) => r.probe_group === "gibberish-probe");
  const injected = antiQueries.filter((r) => (r.gate?.required ?? 0) > 0).length;
  const injection = ratio(injected, antiQueries.length);

  const at3 = (rs: GateRow[]): { ungated: number; gated: number; delta: number; n: number } => {
    const u = ratio(rs.filter((r) => hitAt(r.rank_expected, 3)).length, rs.length);
    const g = ratio(rs.filter((r) => hitAt(r.gate?.rank_expected ?? 0, 3)).length, rs.length);
    return { ungated: u, gated: g, delta: Number((g - u).toFixed(4)), n: rs.length };
  };

  // The gate abstained on everything it was given, on a case that has an answer.
  const abstained = answerable.filter((r) => (r.gate?.required ?? 0) + (r.gate?.optional ?? 0) === 0).length;
  const falseAbstention = ratio(abstained, answerable.length);

  const sum = (pick: (g: CaseGateResult) => number): number =>
    gated.reduce((a, r) => a + (r.gate ? pick(r.gate) : 0), 0);

  return {
    anti_query_injection: {
      value: injection,
      count: `${injected}/${antiQueries.length}`,
      threshold: 0.05,
      within: injection < 0.05,
    },
    recall_at_3: at3(answerable),
    recall_at_3_identifier_queries: at3(identifierQueries),
    false_abstention: {
      value: falseAbstention,
      count: `${abstained}/${answerable.length}`,
      tolerance: 0.015,
      within: falseAbstention <= 0.015,
    },
    invariants: {
      required_hop_only: sum((g) => g.required_hop_only),
      required_without_trigger: sum((g) => g.required_without_trigger),
      required_without_hard_anchor: sum((g) => g.required_without_hard_anchor),
      $comment:
        "required_hop_only must be 0 — the predicate excludes a 1-hop hit before it can say required (C-046). "
        + "The other two are populations, not defects: they say how many `required` rest on the two-of-three "
        + "rule rather than on a hard anchor, which is where §18.2's 'harter Anker ODER unabhängige "
        + "Arm-Evidenz' is read more broadly than the words alone suggest.",
    },
    decisions: {
      required: sum((g) => g.required),
      optional: sum((g) => g.optional),
      no_answer: sum((g) => g.no_answer),
    },
    $comment:
      "MEASUREMENT, not a verdict. Two of the seven §18.2 gates ('kein relevanter Verlust') carry no registered "
      + "threshold, so `recall_at_3` and `recall_at_3_identifier_queries` report a delta and nothing else. "
      + "The two that do carry one report `within`. Deriving the missing thresholds is a separate, deliberate "
      + "step — see m1-tolerances.json on what an unmeasured tolerance is worth.",
  };
}

/**
 * The two anchor readings, side by side (§10.3, the E decision).
 *
 * `hasExactIdentifier` searches the memory's TITLE, its `recall_when` and its
 * BODY. A query term shaped like an identifier that appears anywhere in flowing
 * prose therefore counts as a hard anchor, and a hard anchor alone carries
 * `required` — the A1 pattern of the divergence classification. Daniel's
 * decision is to narrow the anchor to title / recall_when / frontmatter, and to
 * put a number on it first.
 *
 * The counterfactual needs no second implementation and no change to the
 * predicate. `m.body` is read in exactly ONE place in `evidence-decision.ts`,
 * the identifier haystack; `temporalStatus` reads `obsolete`/`valid_until` and
 * `recallWhenCoverage` reads `recall_when`. So calling the SHIPPED `decideHits`
 * with a memory whose body is empty changes `exact_identifier` and nothing
 * else. The variant is therefore the real predicate answering a different
 * question, not a reimplementation of it that could drift.
 *
 * Both reports are computed by the same `componentGates`, so the seven figures
 * mean the same thing on both sides.
 */
export interface GateVariantReport {
  current: ComponentGateReport;
  anchor_without_body: ComponentGateReport;
  delta: {
    /** How many hits stop being a duty when the body no longer anchors. */
    required: number;
    /** …and where they go. */
    optional: number;
    no_answer: number;
    /** The two figures a narrowing could cost something. */
    recall_at_3_gated: number;
    false_abstention: number;
    /** The figure it is meant to buy. */
    anti_query_injection: number;
    $comment: string;
  };
  $comment: string;
}

export function gateVariants(rows: GateRow[]): GateVariantReport {
  const current = componentGates(rows);
  const withoutBody = componentGates(
    rows.map((r) => ({ ...r, gate: r.gate_no_body })),
  );
  const d = (a: number, b: number): number => Number((b - a).toFixed(4));
  return {
    current,
    anchor_without_body: withoutBody,
    delta: {
      required: withoutBody.decisions.required - current.decisions.required,
      optional: withoutBody.decisions.optional - current.decisions.optional,
      no_answer: withoutBody.decisions.no_answer - current.decisions.no_answer,
      recall_at_3_gated: d(current.recall_at_3.gated, withoutBody.recall_at_3.gated),
      false_abstention: d(current.false_abstention.value, withoutBody.false_abstention.value),
      anti_query_injection: d(current.anti_query_injection.value, withoutBody.anti_query_injection.value),
      $comment:
        "Negative means the variant is lower. A narrowed anchor should cost `required` and buy "
        + "`anti_query_injection`; what it must NOT cost is recall_at_3_gated and false_abstention, and "
        + "those two are the price this measurement exists to name.",
    },
    $comment:
      "MEASUREMENT of a counterfactual, taken before any change to the predicate (§10.3). `anchor_without_body` "
      + "is the shipped `decideHits` called with an empty memory body — the only field the identifier haystack "
      + "reads beyond title and recall_when. Nothing here changes what the daemon does.",
  };
}
