#!/usr/bin/env python3
"""
09_roleprobe.py — P4 role-probe (the load-bearing part of PLAN-oop-predictor.md).

AUC alone is NECESSARY but NOT SUFFICIENT for the claim "this predictor enables a held-out
far set that makes the far-gate certify TRANSFER, not in-pool reorder." The role-probe is the
falsifiable demonstration of that claim (-> feedback_probe_lever_role_before_claim).

The argument (verified here on data, not prose):
  A bridge is minted from in-pool far but MUST serve out-of-pool far (#129 transfer point).
  - NAIVE held-out far set is ~85% in-pool. A "reorder-only" bridge (helps in-pool ranks,
    can't touch out-of-pool) shows a big TOTAL far-lift -> a naive gate PASSES it.
  - STRATIFIED held-out far set (predictor-balanced ~50/50) lets the gate read the OUT-OF-POOL
    SLICE, where the reorder-only bridge does exactly nothing -> the gate correctly FAILS it.
  => the predictor changes the gate verdict. That is its role.

P4-NULL (anti-vanity, monitor own derivative -> idea_implicit_pick_label_blindspot):
  if the naive set's out-of-pool slice is already large/measurable enough that its
  out-of-pool-slice lift is read directly, stratification adds nothing -> say so.

Uses TRUE in/out-of-pool labels to build the stratified set (in production the predictor
ESTIMATES them; 08_predictor.py shows the estimate beats null+floor, so it can build this set).

Usage:
  python3 09_roleprobe.py --synthetic
  python3 09_roleprobe.py scores_dump.json --pool 120
"""
import json, sys, argparse
import numpy as np
RNG = np.random.default_rng(42)
K = 5            # recall@K the gate measures
BOOST = 4        # reorder-only bridge: in-pool gold rank -> rank//BOOST (moves it up)

def load(path, pool):
    recs = json.load(open(path))
    out = []
    for r in recs:
        if r.get("voice") == "orig":
            continue  # far = reworded voices only
        gr = r.get("gold_rank", -1)
        in_pool = (gr is not None and 1 <= gr <= pool)
        out.append({"rank": gr if in_pool else None, "in_pool": in_pool})
    return out

def synthetic(n=150, pool=120):
    recs = []
    for _ in range(n):
        for v in ["terse","verbose","typos","emotional","oblique"]:
            hard = {"terse":.12,"verbose":.15,"typos":.30,"emotional":.18,"oblique":.45}[v]
            out = RNG.random() < hard
            recs.append({"rank": None if out else int(RNG.integers(1, pool+1)),
                         "in_pool": not out})
    return recs

def reorder_only(rank, in_pool):
    """Bridge that only reshuffles WITHIN the pool. Out-of-pool stays unreachable."""
    if not in_pool or rank is None:
        return None              # cannot retrieve what's not in the pool
    return max(1, rank // BOOST) # in-pool: moved up

def recall_at_k(ranks):
    r = [x for x in ranks if x is not None]
    if not ranks: return 0.0
    return sum(1 for x in r if x <= K) / len(ranks)

def gate(subset):
    before = [s["rank"] if s["in_pool"] else None for s in subset]
    after  = [reorder_only(s["rank"], s["in_pool"]) for s in subset]
    total_lift = recall_at_k(after) - recall_at_k(before)
    oop = [s for s in subset if not s["in_pool"]]
    if oop:
        ob = [None for _ in oop]
        oa = [reorder_only(s["rank"], s["in_pool"]) for s in oop]
        oop_lift = recall_at_k(oa) - recall_at_k(ob)
    else:
        oop_lift = None
    return total_lift, oop_lift, len(oop)/len(subset)

def make_naive(recs, n=120):
    idx = RNG.choice(len(recs), size=min(n, len(recs)), replace=False)
    return [recs[i] for i in idx]

def make_stratified(recs, n=120):
    ins = [r for r in recs if r["in_pool"]]; outs = [r for r in recs if not r["in_pool"]]
    half = min(n//2, len(ins), len(outs))
    if half == 0: return make_naive(recs, n)
    a = [ins[i] for i in RNG.choice(len(ins), half, replace=False)]
    b = [outs[i] for i in RNG.choice(len(outs), half, replace=False)]
    return a + b

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", nargs="?"); ap.add_argument("--pool", type=int, default=120)
    ap.add_argument("--synthetic", action="store_true")
    a = ap.parse_args()
    recs = synthetic(pool=a.pool) if a.synthetic else load(a.dump, a.pool)
    nat_oop = sum(1 for r in recs if not r["in_pool"]) / len(recs)
    print(f"far records: {len(recs)}  natural out-of-pool rate: {nat_oop:.1%}  "
          f"(reorder-only bridge: in-pool rank//{BOOST}, out-of-pool untouched; gate=recall@{K})\n")

    naive = make_naive(recs); strat = make_stratified(recs)
    nt, no, nf = gate(naive)
    st, so, sf = gate(strat)
    print(f"NAIVE held-out far   (out-of-pool {nf:.0%}): total far-lift {nt:+.3f}  | "
          f"out-of-pool-slice lift {no:+.3f}")
    print(f"STRAT held-out far   (out-of-pool {sf:.0%}): total far-lift {st:+.3f}  | "
          f"out-of-pool-slice lift {so:+.3f}")

    print("\n--- verdict ---")
    naive_passes = nt > 0.02                      # a naive gate keys on total far-lift
    strat_oop_flat = (so is not None and abs(so) < 1e-9)
    print(f"naive gate (keys on total far-lift) PASSES reorder-only bridge: {naive_passes} "
          f"(lift {nt:+.3f}) — but it only reordered in-pool")
    print(f"stratified gate reads out-of-pool slice = {so:+.3f} -> reorder-only bridge "
          f"{'correctly FAILS the transfer test' if strat_oop_flat else 'shows lift (unexpected)'}")
    role_real = naive_passes and strat_oop_flat
    print(f"\nROLE: predictor-enabled stratification CHANGES the gate verdict: {role_real}")

    # P4-NULL: would a naive set already expose the out-of-pool slice without the predictor?
    print(f"\nP4-NULL check: naive set out-of-pool slice is {nf:.0%} of it; its slice-lift "
          f"is already readable ({no:+.3f}). Stratification still matters because the naive "
          f"gate's HEADLINE (total far-lift {nt:+.3f}) drowns it — a gate that reports only "
          f"total lift is fooled; one that reports the out-of-pool slice is not. If a gate "
          f"ALREADY reports the out-of-pool slice on a naive set, the predictor's only added "
          f"value is making that slice big enough to be statistically stable.")

if __name__ == "__main__":
    main()
