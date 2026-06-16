#!/usr/bin/env python3
"""
13_transfer_gate.py — the #129 stratified TRANSFER gate (Tier A: public mechanism validation).

daniel asked (in the #129 body, checkboxes "Refinement (per @zzallirog)") for a held-out gate that
certifies a harvested bridge lifts the OUT-OF-POOL slice — real transfer — not just reorders in-pool
far. A bridge is minted from in-pool far (Teacher 2 can only rescue what's already in the pool) but
*mandated* to serve out-of-pool far; a naive held-out far set is ~85% in-pool, so a reorder-only
bridge clears a naive far-lift gate while the residual it exists for is never measured.

09_roleprobe.py is the proto-gate: it builds a predictor-stratified held-out far set and shows a
reorder-only bridge passes a NAIVE gate (+total far-lift) but reads ~0 on the stratified out-of-pool
slice. This file COMPLETES it into a real gate by adding the three pieces 09 lacks:

  1. a POSITIVE control — a transfer bridge that actually pulls out-of-pool gold into the pool —
     so the gate is shown to PASS a good bridge, not only FAIL a bad one (discrimination needs both);
  2. a PAIRED, CONTINUOUS statistic — Delta-rank per out-of-pool case (gold rank with vs without the
     bridge), median + Wilcoxon signed-rank + fraction crossing into the pool. Paired kills the
     between-query variance that makes "52 out-of-pool cases" look hopeless; continuous extracts more
     signal per case than a binary recall@K on ~10 cases;
  3. SIGNIFICANCE + a negative control — Wilcoxon signed-rank over the non-zero Delta-ranks (the
     transfer effect is minority-concentrated, so the median over ALL oop cases is 0 by design; the
     test runs on the cases that moved), plus the reorder-only bridge as the empirical negative
     control (it touches only in-pool, so its oop Delta is 0). A permutation/firing null is a Tier-B
     instrument: it needs a real targeting signal (trigger-overlap firing) to permute — a modeled
     bridge fires at random, so the permutation is degenerate here and is omitted (Bellard).

HONEST SCOPE (load-bearing — read before quoting any number from this file):
  Tier A validates the gate LOGIC on MODELED bridges over REAL dense-hard ranks. It proves the readout
  (stratified out-of-pool paired Delta-rank) DISCRIMINATES transfer from reorder and survives the null.
  It does NOT prove that real minted bridges pass: the effective sample is (out-of-pool cases) INTER
  (queries a bridge actually fires on); the firing RULE is query-side (bridges.ts mintBridge:
  trigger_terms = distinctiveTerms(query) — code-checked origin/main, reproducible publicly), so what
  is vault-only is COVERAGE: the real harvested reaches + the #121 candidate-pool log = Tier B. Magnitudes here are ILLUSTRATIVE; what
  is validated is the discrimination + null behaviour. shape-not-magnitude — same split as the #130
  predictor: the exact number belongs to the production vault.

  No k-fold here on purpose: k-fold guards mint/eval leakage, which only exists when bridges are MINTED
  FROM DATA (Tier B, per-fold mint). Tier A models the bridges, so the statistic runs over the whole
  stratified out-of-pool slice — nothing to fold against. Adding folds would be machinery that does no
  work (Bellard).

  4. SENSITIVITY (--power) — the power curve + MDE: the smallest crossed-in fraction the gate can
     certify at 80% power on THIS slice's N. Turns "discriminates" (by-construction) into a calibrated
     "detects a bridge crossing >= X% of out-of-pool gold on N=k" — and exposes the cost of the
     predictor (its enriched tail has fewer cases, so a worse MDE than the true-label upper bound).

Reuses 08_predictor (the #130 predictor) to ESTIMATE in/out-of-pool labels for stratification — the
actual instrument daniel asked for; --true-labels gives the clean upper-bound demo (what 09 does).

Usage:
  python3 13_transfer_gate.py --synthetic
  python3 13_transfer_gate.py scores_dump.json
  python3 13_transfer_gate.py scores_dump.json --true-labels --pool 120
  python3 13_transfer_gate.py scores_dump.json --power   # sensitivity / MDE
"""
import argparse
import importlib
import math

import numpy as np

pred = importlib.import_module("08_predictor")  # digit-prefixed: not a normal import

VOICES = ["orig", "terse", "verbose", "typos", "emotional", "oblique"]
POOL = 120
K = 5            # recall@K reported alongside the rank stats (matches 09_roleprobe.K)
BOOST = 4        # in-pool reorder strength (matches 09_roleprobe.BOOST)
CORPUS_MISS = 5000  # deep rank assigned to a gold absent from the dump's full ranking (-1)
RNG = np.random.default_rng(42)


# ---------- load: keep the TRUE deep rank (09.load drops it to None for out-of-pool) ----------
def load_deep(path, pool):
    import json
    recs = []
    for r in json.load(open(path)):
        if r.get("voice") == "orig":
            continue  # far = reworded voices only
        gr = r.get("gold_rank", -1)
        rank = gr if (gr is not None and gr > 0) else CORPUS_MISS
        recs.append({"qid": r["qid"], "voice": r.get("voice"), "rank": int(rank),
                     "in_pool": bool(1 <= rank <= pool),
                     "top_scores": r.get("top_scores", []),
                     "q_mean_idf": r.get("q_mean_idf", 0.0), "q_max_idf": r.get("q_max_idf", 0.0)})
    return recs


# ---------- modeled bridges (deep-rank aware; supersede 09.reorder_only's None-for-oop) ----------
def reorder_only(rank, in_pool, rng):
    """Negative control: reshuffles WITHIN the pool, out-of-pool gold is untouched -> Delta=0."""
    if in_pool:
        return max(1, rank // BOOST)
    return rank  # cannot reach what is not in the pool


def transfer_bridge(rank, in_pool, rng, p=0.5):
    """Positive control: with prob p a transfer bridge pulls an out-of-pool gold into the pool;
    in-pool gold is reordered like reorder_only. Models a bridge that genuinely transfers."""
    if in_pool:
        return max(1, rank // BOOST)
    if rng.random() < p:
        return int(rng.integers(1, POOL + 1))  # crossed into the pool
    return rank  # this firing missed


# ---------- paired Delta-rank statistic on the out-of-pool slice ----------
def _phi(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def wilcoxon_signed_rank(deltas):
    """One-sided (improvement = delta < 0). Normal approximation with tie-corrected ranks.
    Returns (z, p_one_sided) for H1: median delta < 0."""
    d = np.asarray([x for x in deltas if x != 0], dtype=float)
    n = d.size
    if n == 0:
        return 0.0, 1.0
    order = np.argsort(np.abs(d))
    ranks = np.empty(n)
    ranks[order] = np.arange(1, n + 1)
    # average ranks for ties in |d|
    _, inv, cnt = np.unique(np.abs(d), return_inverse=True, return_counts=True)
    sums = np.zeros(len(cnt))
    np.add.at(sums, inv, ranks)
    ranks = (sums / cnt)[inv]
    w_neg = ranks[d < 0].sum()   # rank mass of improvements
    mean_w = n * (n + 1) / 4.0
    sd_w = math.sqrt(n * (n + 1) * (2 * n + 1) / 24.0)
    if sd_w == 0:
        return 0.0, 1.0
    z = (w_neg - mean_w) / sd_w           # positive z => improvements dominate
    return z, 1.0 - _phi(z)               # small p => significant improvement


def oop_delta_stats(subset, bridge, rng, pool):
    """Paired Delta-rank over the OUT-OF-POOL slice of `subset` under `bridge`.
    The transfer effect lands on a MINORITY of oop cases, so the median over all cases is
    insensitive (>50% unmoved -> median 0). Headline numbers: crossed-in fraction
    (production-relevant — oop gold pulled into the pool) and Wilcoxon signed-rank p over the
    non-zero Delta-ranks (directional significance)."""
    oop = [s for s in subset if not s["in_pool"]]
    if not oop:
        return {"n_oop": 0, "mean_delta": 0.0, "median_delta": 0.0, "p_wilcoxon": 1.0,
                "frac_cross": 0.0, "recallK_lift": 0.0}
    before = np.array([s["rank"] for s in oop], dtype=float)
    after = np.array([bridge(s["rank"], s["in_pool"], rng) for s in oop], dtype=float)
    deltas = after - before                       # negative = lifted toward / into the pool
    _, p_wilcox = wilcoxon_signed_rank(deltas)
    return {"n_oop": len(oop), "mean_delta": float(deltas.mean()),
            "median_delta": float(np.median(deltas)), "p_wilcoxon": p_wilcox,
            "frac_cross": float((after <= pool).mean()),
            "recallK_lift": float((after <= K).mean() - (before <= K).mean())}


# ---------- stratification (by a label key, so it works on true OR predicted labels) ----------
def stratify(records, key, n, rng):
    ins = [r for r in records if r[key]]
    outs = [r for r in records if not r[key]]
    half = min(n // 2, len(ins), len(outs))
    if half == 0:
        idx = rng.choice(len(records), size=min(n, len(records)), replace=False)
        return [records[i] for i in idx]
    a = [ins[i] for i in rng.choice(len(ins), half, replace=False)]
    b = [outs[i] for i in rng.choice(len(outs), half, replace=False)]
    return a + b


def naive(records, n, rng):
    idx = rng.choice(len(records), size=min(n, len(records)), replace=False)
    return [records[i] for i in idx]


def add_predicted_probs(records, pool):
    """Reuse the #130 predictor (08): group-CV by qid, store P(in_pool) per record. We use the
    RANKING (where its AUC lives), not a base-rate-fragile 0.5 threshold — at a 7% out-of-pool
    base rate almost everything scores >0.5, so a threshold flags ~0 true out-of-pool.
    Build X/y here (not pred.build_xy — that keys on 'gold_rank'; our records carry deep 'rank')."""
    X = np.array([np.concatenate([pred.shape_features(r["top_scores"]),
                                  [r["q_mean_idf"], r["q_max_idf"]]]) for r in records])
    y = np.array([1 if r["in_pool"] else 0 for r in records])
    qids = np.array([r["qid"] for r in records])
    oof = pred.group_cv_scores(X, y, qids)
    for r, p in zip(records, oof):
        r["est_prob"] = float(p) if not np.isnan(p) else float(r["in_pool"])
    m = ~np.isnan(oof)
    return pred.auc(y[m], oof[m]) if m.sum() and len(set(y[m])) == 2 else float("nan")


def stratify_prob(records, n):
    """Predictor-built out-of-pool-enriched held-out set: the n records the #130 predictor ranks
    LOWEST on P(in_pool) — its 'dig here for out-of-pool' tail. No ground truth used; this is the
    production path daniel asked for. The true-oop rate of this tail vs the naive base rate is the
    enrichment the predictor actually buys (bounded by its AUC, not the 50% of the --true-labels demo)."""
    order = sorted(records, key=lambda r: r["est_prob"])
    return order[:min(n, len(order))]


# ---------- synthetic self-test (planted transfer signal; deep out-of-pool ranks) ----------
def synthetic(n_q=150, pool=POOL):
    recs = []
    for qi in range(n_q):
        for v in VOICES:
            if v == "orig":
                continue
            hard = {"terse": .12, "verbose": .15, "typos": .30, "emotional": .18, "oblique": .45}[v]
            out = RNG.random() < hard
            rank = int(RNG.integers(pool + 1, 3000)) if out else int(RNG.integers(1, pool + 1))
            # score-shape: out-of-pool = flatter top scores (so the predictor has something to learn)
            peak = RNG.normal(0.30 if out else 0.45, 0.18)
            base = RNG.normal(0.30, 0.08, size=pool)
            base[0] += peak
            base = np.sort(base)[::-1]
            idf = RNG.normal(6.2 if out else 5.4, 2.2)
            recs.append({"qid": f"q{qi}", "voice": v, "rank": rank,
                         "in_pool": (not out), "top_scores": base.tolist(),
                         "q_mean_idf": float(idf), "q_max_idf": float(idf + RNG.random())})
    return recs


def power_curve(strat, pool, ps=(0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50), trials=300):
    """Sensitivity of the gate on THIS out-of-pool slice (its N + real rank distribution): for each
    transfer strength p (prob an out-of-pool gold is pulled into the pool), what fraction of trials
    does the gate certify (crossed-in>0 AND Wilcoxon p<0.05 AND mean Δrank<0)? Gives the MDE — the
    smallest crossed-in fraction the gate can detect at 80% power. NOT a claim a bridge works; a clean
    injected effect characterizing the instrument — a real (noisier) bridge's power is at most this."""
    rows = []
    for p in ps:
        passes = 0
        crossed = []
        for t in range(trials):
            rng = np.random.default_rng(10_000 + t)  # independent draw per trial
            o = oop_delta_stats(strat, lambda r, ip, rg: transfer_bridge(r, ip, rg, p=p), rng, pool)
            crossed.append(o["frac_cross"])
            if o["frac_cross"] > 0 and o["p_wilcoxon"] < 0.05 and o["mean_delta"] < 0:
                passes += 1
        rows.append((p, passes / trials, float(np.mean(crossed))))
    return rows


def run(records, strat, pool, rng, n=200):
    nv = naive(records, n, rng)
    bridges = {"transfer (positive control)": transfer_bridge,
               "reorder-only (negative control)": reorder_only}
    out = {}
    for name, br in bridges.items():
        # naive read: total far-lift recall@K (what a naive gate keys on)
        nb = np.array([s["rank"] for s in nv], dtype=float)
        na = np.array([br(s["rank"], s["in_pool"], rng) for s in nv], dtype=float)
        total_lift = float((na <= K).mean() - (nb <= K).mean())
        out[name] = {"total_far_lift": total_lift, "oop": oop_delta_stats(strat, br, rng, pool)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", nargs="?", help="scores_dump_*.json from 08a_dump.py")
    ap.add_argument("--pool", type=int, default=POOL)
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--true-labels", action="store_true",
                    help="stratify by true in/out (clean upper bound); default uses the #130 predictor")
    ap.add_argument("--power", action="store_true",
                    help="report the gate's sensitivity (power curve + MDE) on this oop slice's N")
    a = ap.parse_args()

    if a.synthetic:
        print("[SELF-TEST on synthetic data — planted: out-of-pool = flat scores; transfer bridge p=0.5]")
        records = synthetic(pool=a.pool)
    else:
        if not a.dump:
            ap.error("give a scores_dump_*.json or --synthetic")
        records = load_deep(a.dump, a.pool)

    nat_oop = sum(1 for r in records if not r["in_pool"]) / len(records)
    print(f"far records: {len(records)}  out-of-pool cases: {sum(1 for r in records if not r['in_pool'])}"
          f"  (natural rate {nat_oop:.1%})  pool@{a.pool}\n")

    if a.true_labels:
        strat = stratify(records, "in_pool", 200, RNG)
        print("stratifying by TRUE in/out-of-pool labels (clean upper-bound demo)\n")
    else:
        auc = add_predicted_probs(records, a.pool)
        strat = stratify_prob(records, 200)
        print(f"stratifying by the #130 PREDICTOR's ranking (ROC-AUC {auc:.3f}, group-CV; "
              f"low P(in_pool) = likely out-of-pool)\n")

    out = run(records, strat, a.pool, RNG)
    strat_oop = sum(1 for s in strat if not s["in_pool"]) / len(strat)
    print(f"stratified held-out far: {len(strat)} cases, out-of-pool {strat_oop:.0%} "
          f"(was {nat_oop:.0%} naive)\n")

    print(f"{'bridge':32} {'total far-lift':>14} | {'oop n':>5} {'mean Δrank':>11} "
          f"{'crossed-in':>10} {'p(wilcox)':>9}")
    print("-" * 92)
    for name, r in out.items():
        o = r["oop"]
        print(f"{name:32} {r['total_far_lift']:+14.3f} | {o['n_oop']:5d} {o['mean_delta']:+11.0f} "
              f"{o['frac_cross']:10.2f} {o['p_wilcoxon']:9.3f}")

    t = out["transfer (positive control)"]["oop"]
    ro = out["reorder-only (negative control)"]["oop"]
    print("\n--- verdict (discrimination = PASS transfer AND FAIL reorder, both on the oop slice) ---")
    transfer_pass = (t["frac_cross"] > 0) and (t["p_wilcoxon"] < 0.05) and (t["mean_delta"] < 0)
    reorder_fail = (ro["frac_cross"] == 0.0) and (ro["p_wilcoxon"] > 0.05)
    print(f"  transfer PASSES oop gate:    {transfer_pass}  "
          f"(crossed-in {t['frac_cross']:.2f}, mean Δrank {t['mean_delta']:+.0f}, wilcoxon p {t['p_wilcoxon']:.3f})")
    print(f"  reorder-only FAILS oop gate: {reorder_fail}  "
          f"(crossed-in {ro['frac_cross']:.2f}, wilcoxon p {ro['p_wilcoxon']:.3f}) "
          f"— but its TOTAL far-lift {out['reorder-only (negative control)']['total_far_lift']:+.3f} "
          f"would PASS a naive gate")
    print(f"\n  GATE DISCRIMINATES (Tier A mechanism validated): {transfer_pass and reorder_fail}")
    print("  demotion (daniel's 'free'): a bridge with mean oop Δrank >= 0 IS the `fails` counterpart.")

    if a.power:
        n_oop = sum(1 for s in strat if not s["in_pool"])
        print(f"\n--- sensitivity (power) on this slice: {n_oop} out-of-pool cases ---")
        print(f"{'transfer p':>10} {'crossed-in':>11} {'detection@.05':>14}")
        print("-" * 37)
        curve = power_curve(strat, a.pool)
        mde = None
        for p, det, cross in curve:
            print(f"{p:10.2f} {cross:11.2f} {det:14.2f}")
            if mde is None and det >= 0.80:
                mde = cross
        if mde is not None:
            print(f"\n  MDE: the gate certifies a bridge crossing >= {mde:.0%} of out-of-pool gold "
                  f"at 80% power on N={n_oop}.")
        else:
            print(f"\n  UNDERPOWERED: even crossing {curve[-1][2]:.0%} of out-of-pool gold is detected "
                  f"<80% of the time on N={n_oop} — this slice is too small; widen the corpus (Tier B "
                  f"has the real N) before trusting a borderline gate verdict.")
        print("  (clean injected effect — a real, noisier bridge's power is AT MOST this.)")
    print("\nNOTE: Tier A = gate LOGIC on modeled bridges over real ranks. Real minted-bridge coverage/"
          "verdict = Tier B (real Teacher-2 mint + harvested reaches + #121 log coverage, production vault).")


if __name__ == "__main__":
    main()
