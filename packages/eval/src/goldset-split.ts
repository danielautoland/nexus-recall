/**
 * The selection/holdout split for design A (§18.3; C-072, C-074).
 *
 * §18.3 forbids determining the held-fixed cue configuration on the same cases
 * the comparison then runs on. This produces the two parts that keeps them
 * apart — and it stratifies, because a seed alone is not a safeguard.
 *
 * The M0 baseline measured Recall@3 per gold file between 31.3% and 84.9%, a
 * standard deviation of 21.6pp, driven almost entirely by origin: the blind
 * batch of an independently working second person is far harder than hook
 * telemetry. An unstratified draw can therefore put most of the blind cases on
 * one side and move the comparison baseline further than the effect the
 * experiment is looking for — reproducibly so, which is worse than noisily.
 *
 * Registered in `registrations/cue-experiment.json`:
 * selection_share 0.30, holdout_share 0.70, split_seed 20260828,
 * stratify_by ["origin_type", "lang"].
 *
 * The CALLER chooses the pool, and that choice moves the numbers. Design A
 * holds the cue configuration at descriptive/item, so it passes the descriptive
 * cases and gets 109/256; passing every answerable case instead yields 112/260.
 * Both are correct splits of different pools — the registered min_n_per_condition
 * of 255 is measured against the first.
 */
import type { GoldCase } from "./goldset.js";

/** Deterministic 32-bit PRNG (mulberry32) — no dependency, same draw everywhere. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SplitOptions {
  /** Registered as 20260828. Fixed BEFORE the run — a seed chosen after seeing
   *  a split is not a safeguard but a selection. */
  seed: number;
  /** Registered as 0.30. The rest becomes the holdout. */
  selectionShare: number;
  /** Case fields the split balances on. Registered as origin_type + lang. */
  stratifyBy: readonly (keyof GoldCase)[];
}

export interface StratumReport {
  key: string;
  total: number;
  selection: number;
  holdout: number;
}

export interface SplitResult {
  selection: GoldCase[];
  holdout: GoldCase[];
  /** Per-stratum sizes, so a report can show the split actually balanced. */
  strata: StratumReport[];
  /** Cases dropped before splitting, with the reason. */
  excluded: { probes: number; no_answer: number };
}

const stratumKey = (c: GoldCase, by: readonly (keyof GoldCase)[]): string =>
  by.map((f) => String(c[f])).join("|");

/**
 * Splits the eligible gold cases into a selection part and a holdout.
 *
 * Excluded before anything else, and reported rather than silently dropped:
 *
 *   - probes (`probe_group`) — diagnostic and noise runs are not questions
 *     anyone asked and never share a denominator with them;
 *   - `no_answer` cases — design A compares two cue GENERATION paths on
 *     Recall@3, and a case with no expected id cannot contribute a rank.
 *
 * The draw is per stratum and deterministic: same seed, same input, byte-equal
 * output. Each stratum contributes `round(n × selectionShare)` cases, so the
 * proportions hold inside every stratum rather than only in the aggregate.
 */
export function splitGoldCases(cases: readonly GoldCase[], opts: SplitOptions): SplitResult {
  if (!(opts.selectionShare > 0 && opts.selectionShare < 1)) {
    throw new Error(`selectionShare must lie strictly between 0 and 1, got ${opts.selectionShare}`);
  }
  if (opts.stratifyBy.length === 0) {
    throw new Error("stratifyBy must name at least one field — an unstratified split is a lottery with a seed");
  }

  const probes = cases.filter((c) => c.probe_group).length;
  const noAnswer = cases.filter((c) => !c.probe_group && c.no_answer).length;
  const eligible = cases.filter((c) => !c.probe_group && !c.no_answer);

  const byStratum = new Map<string, GoldCase[]>();
  for (const c of eligible) {
    const k = stratumKey(c, opts.stratifyBy);
    const slot = byStratum.get(k);
    if (slot) slot.push(c);
    else byStratum.set(k, [c]);
  }

  const selection: GoldCase[] = [];
  const holdout: GoldCase[] = [];
  const strata: StratumReport[] = [];

  // Sorted so the iteration order does not depend on insertion order, and the
  // ids inside a stratum are sorted too: the same cases in a different file
  // order must produce the same split.
  for (const key of [...byStratum.keys()].sort()) {
    const group = [...(byStratum.get(key) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    // One generator per stratum, seeded from the run seed and the stratum name,
    // so adding a stratum cannot reshuffle the ones beside it.
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    const rnd = seededRandom(opts.seed ^ h);
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    const take = Math.round(group.length * opts.selectionShare);
    selection.push(...group.slice(0, take));
    holdout.push(...group.slice(take));
    strata.push({ key, total: group.length, selection: take, holdout: group.length - take });
  }

  return { selection, holdout, strata, excluded: { probes, no_answer: noAnswer } };
}
