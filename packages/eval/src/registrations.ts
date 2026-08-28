/**
 * Registration duties of M0 (#261; §18.1, §2.3, §29.1; C-029, C-040, C-057,
 * C-072, C-074).
 *
 * Two of M0's gate conditions are discipline rather than code:
 *
 *   - "keine Fremdzahl ohne Evidenzklasse und keine gemeinsame Rangliste aus
 *     Messungen mit unterschiedlichem Reader, Judge, Top-k oder Kontextbudget"
 *   - "eine registrierte Cue-Versuchsanlage (A oder B) liegt versioniert vor"
 *
 * Discipline that only lives in a document is discipline until the first
 * deadline. This module turns both into checks a program runs.
 *
 * On the ranking rule: `null` in the registry means the SOURCE does not state
 * the value — nineteen measurements were checked and three name all four
 * configuration quantities. So an unknown is not treated as "probably the
 * same". Two measurements are comparable only when all four are stated AND
 * equal, which is why the honest answer is almost always "these cannot be
 * ranked together".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REG_DIR = join(import.meta.dirname, "..", "registrations");

export const EVIDENCE_CLASSES = [
  "peer_reviewed",
  "preprint",
  "implemented_code",
  "vendor_benchmark",
  "project_self_measurement",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export interface ForeignFigure {
  id: string;
  system: string;
  claim: string;
  evidence_class: EvidenceClass;
  source: string;
  version: string;
  locus: string;
  retrieved: string;
  /** null = the source does not state it. Never estimated, never carried over. */
  reader: string | null;
  judge: string | null;
  top_k: string | null;
  context_budget: string | null;
  caveat?: string;
}

export interface RegistrationIssue {
  where: string;
  problem: string;
}

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(REG_DIR, file), "utf8")) as T;
}

export function loadForeignFigures(): ForeignFigure[] {
  return load<{ figures: ForeignFigure[] }>("foreign-figures.json").figures;
}

export function loadCueRegistration(): Record<string, unknown> {
  return load<Record<string, unknown>>("cue-experiment.json");
}

/** Citation fields §29.1 demands of every quoted foreign claim. */
const REQUIRED_FIELDS: Array<keyof ForeignFigure> = [
  "id", "system", "claim", "evidence_class", "source", "version", "locus", "retrieved",
];

/**
 * C-029 + C-040: no foreign figure without an evidence class and without its
 * citation fields. A missing measurement configuration is NOT an error — it is
 * a finding, and it must be recorded as `null` rather than left out, so the
 * comparability check below can see that it is unknown.
 */
export function checkForeignFigures(figures: ForeignFigure[] = loadForeignFigures()): RegistrationIssue[] {
  const issues: RegistrationIssue[] = [];
  const seen = new Set<string>();

  for (const f of figures) {
    const where = f.id ?? f.system ?? "<unnamed figure>";
    for (const field of REQUIRED_FIELDS) {
      if (typeof f[field] !== "string" || (f[field] as string).length === 0) {
        issues.push({ where, problem: `missing citation field \`${field}\` (§29.1)` });
      }
    }
    if (f.evidence_class && !EVIDENCE_CLASSES.includes(f.evidence_class)) {
      issues.push({ where, problem: `\`${f.evidence_class}\` is not one of the five evidence classes (§2.3)` });
    }
    for (const field of ["reader", "judge", "top_k", "context_budget"] as const) {
      if (!(field in f)) {
        issues.push({
          where,
          problem: `\`${field}\` is absent. State null when the source does not give it — an omitted field is indistinguishable from an unchecked one (§29.1)`,
        });
      }
    }
    if (seen.has(f.id)) issues.push({ where, problem: "duplicate id" });
    seen.add(f.id);
  }
  return issues;
}

/**
 * C-029: differing readers, judges, prompts, top-k, candidate pools, context
 * budgets and dataset versions forbid a shared ranking.
 *
 * Returns the reason two figures may not be ranked together, or null when they
 * may. Unknown counts as differing: a value the source never stated cannot be
 * asserted to match.
 */
export function rankingBlocker(a: ForeignFigure, b: ForeignFigure): string | null {
  for (const field of ["reader", "judge", "top_k", "context_budget"] as const) {
    const av = a[field];
    const bv = b[field];
    if (av === null || bv === null) {
      const which = av === null && bv === null ? "neither source states" : av === null ? `${a.id} does not state` : `${b.id} does not state`;
      return `${which} \`${field}\` — an unknown configuration cannot be asserted to match`;
    }
    if (av !== bv) return `\`${field}\` differs: ${a.id} has "${av}", ${b.id} has "${bv}"`;
  }
  return null;
}

/** Every pair that may not share a ranking, with the reason. */
export function rankingBlockers(figures: ForeignFigure[] = loadForeignFigures()): RegistrationIssue[] {
  const out: RegistrationIssue[] = [];
  for (let i = 0; i < figures.length; i++) {
    for (let j = i + 1; j < figures.length; j++) {
      const why = rankingBlocker(figures[i], figures[j]);
      if (why) out.push({ where: `${figures[i].id} vs ${figures[j].id}`, problem: why });
    }
  }
  return out;
}

export type CueStage = "structure_pending_decision" | "structure_registered" | "numbers_registered";

/**
 * C-072 + C-074: exactly two designs are admissible, the choice is registered
 * BEFORE the run, and design A carries two conditions with a contamination
 * guard and no interaction claim while only design B has eight cells.
 *
 * `requiredStage` is what the caller needs: the M0 gate wants the structure
 * registered, an M2 run additionally wants the numbers.
 */
export function checkCueRegistration(
  requiredStage: CueStage = "structure_registered",
  reg: Record<string, unknown> = loadCueRegistration(),
): RegistrationIssue[] {
  const issues: RegistrationIssue[] = [];
  const at = (k: string): unknown => reg[k];
  const stage = at("status") as CueStage;
  const order: CueStage[] = ["structure_pending_decision", "structure_registered", "numbers_registered"];

  if (!order.includes(stage)) {
    issues.push({ where: "status", problem: `unknown status \`${String(stage)}\`` });
    return issues;
  }
  if (order.indexOf(stage) < order.indexOf(requiredStage)) {
    issues.push({
      where: "status",
      problem: `registration is at \`${stage}\`, but \`${requiredStage}\` is required — the design must be registered before the run (§18.3)`,
    });
  }

  const design = at("design");
  if (order.indexOf(stage) >= order.indexOf("structure_registered")) {
    if (design !== "A" && design !== "B") {
      issues.push({ where: "design", problem: "must be \"A\" or \"B\" — there is no third design (§18.3)" });
    }
    const admissible = at("admissible_designs") as Record<string, Record<string, unknown>> | undefined;
    const chosen = admissible?.[String(design)];
    if (chosen) {
      if (design === "A") {
        if (chosen.condition_count !== 2) {
          issues.push({ where: "design A", problem: "design A has exactly two conditions, not four cells (C-074)" });
        }
        if (chosen.interaction_evaluated !== false) {
          issues.push({ where: "design A", problem: "design A may not evaluate interactions (C-074)" });
        }
        const guard = chosen.contamination_guard as Record<string, unknown> | undefined;
        const permitted = ["selection_holdout_split", "nested_evaluation"];
        if (!guard || !permitted.includes(String(guard.mode))) {
          issues.push({
            where: "design A",
            problem: "the fixed cue configuration must not be chosen on the cases the comparison then runs on — register a selection/holdout split or a nested evaluation (§18.3)",
          });
        }
        if (chosen.fixed_cue_configuration == null) {
          issues.push({ where: "design A", problem: "the held-fixed cue configuration is part of the registration (§18.3)" });
        }
      }
      if (design === "B" && chosen.cell_count !== 8) {
        issues.push({ where: "design B", problem: "design B is a fully crossed 2x2x2 — eight cells (C-074)" });
      }
    }
  }

  if (stage === "numbers_registered") {
    const power = at("power_assumption") as Record<string, Record<string, unknown>> | undefined;
    for (const arm of ["main_effects", "interaction"] as const) {
      if (power?.[arm]?.min_n == null) {
        issues.push({
          where: `power_assumption.${arm}`,
          problem: "a minimum N is required, stated separately for main effects and interaction (§18.1)",
        });
      }
    }
    if (at("evaluation_rule") == null) {
      issues.push({ where: "evaluation_rule", problem: "fixed before the run, so the analysis is not chosen after seeing the data (§18.3)" });
    }

    // §18.1: "In beiden Fällen werden Bedingungs- beziehungsweise Zellstruktur,
    // Mindest-N je Bedingung oder Zelle und Auswertungsregel vorab festgelegt."
    // The power assumption above governs the 2x2 cue-AXIS experiment; the
    // generation-path experiment carries its own N, and without it the
    // registration would reach `numbers_registered` while the one number the
    // chosen design actually runs on is still open.
    const chosenNow = (at("admissible_designs") as Record<string, Record<string, unknown>> | undefined)?.[String(design)];
    const perUnit = design === "A" ? "min_n_per_condition" : "min_n_per_cell";
    if (chosenNow && typeof chosenNow[perUnit] !== "number") {
      issues.push({
        where: `design ${String(design)}`,
        problem: `${perUnit} is required before the run — the power assumption covers the cue-axis experiment, not this design (§18.1)`,
      });
    }

    // §18.3: "Die Aufteilung beziehungsweise das Verschachtelungsschema ist
    // Teil der Registrierung." A split named but not quantified is not a
    // registered split — it leaves the one number that decides how much of the
    // gold set the comparison ever sees open until someone picks it, which is
    // the contamination the guard exists to prevent.
    const admissible = at("admissible_designs") as Record<string, Record<string, unknown>> | undefined;
    const guard = admissible?.[String(design)]?.contamination_guard as Record<string, unknown> | undefined;
    if (guard?.mode === "selection_holdout_split") {
      const sel = guard.selection_share;
      const hold = guard.holdout_share;
      if (typeof sel !== "number" || typeof hold !== "number") {
        issues.push({ where: "contamination_guard", problem: "selection_share and holdout_share are part of the registration (§18.3)" });
      } else if (Math.abs(sel + hold - 1) > 1e-9) {
        issues.push({ where: "contamination_guard", problem: `shares must cover the case set exactly: ${sel} + ${hold} != 1` });
      }
      if (guard.split_seed == null) {
        issues.push({ where: "contamination_guard", problem: "the split needs a seed, or it is not the same split on the next run" });
      }
      // A seed alone only makes an UNBALANCED split reproducible. The M0
      // baseline measured Recall@3 per gold file between 31.3% and 84.9% — a
      // standard deviation of 21.6pp, driven by origin. A plain random split
      // can therefore move the comparison baseline by more than the effect the
      // experiment looks for, and reproducibly so.
      if (!Array.isArray(guard.stratify_by) || guard.stratify_by.length === 0) {
        issues.push({
          where: "contamination_guard",
          problem: "the split must name what it stratifies by — a seed makes an unbalanced split reproducible, not balanced",
        });
      }
    }
  }
  return issues;
}
