#!/usr/bin/env python3
"""
08_predictor.py — out-of-pool predictor (P2-P4 of PLAN-oop-predictor.md).

Cheap, query-side predictor: from FIRST-STAGE score-shape + query IDF, predict whether a
far query's gold is IN the candidate pool (recall@pool membership) — BEFORE any reranker.
out-of-pool = the slice no reranker/teacher can reach (the #129 stratification target).

Pure numpy on purpose (Bellard): a logistic regression over ~9 features + ROC-AUC is ~40
lines; no sklearn/torch dependency, runs on stock macOS python3 + numpy. The GPU/corpus step
that produces the score dump is 08a_dump.py (run where e5-small + the MS MARCO subcorpus live).

INPUT (from 08a_dump.py): scores_dump.json
  [{qid, voice, top_scores:[float x K], gold_rank:int(1-based,-1 if not in top-K),
    q_mean_idf:float, q_max_idf:float}, ...]
LABEL: in_pool = 1 if 1 <= gold_rank <= POOL else 0.   (out-of-pool = the 0 class)

GATES (Feynman-floor; see PLAN):
  - group-CV by qid (the 6 voices of one query never leak across folds).
  - NULL control x20: shuffle labels -> CV-AUC null dist; real must beat ALL 20.
  - baseline floor: predictor must beat the BEST single feature; else report the feature (Bellard).

Usage:
  python3 08_predictor.py --synthetic            # self-test (no data needed)
  python3 08_predictor.py scores_dump.json       # real run
  python3 08_predictor.py scores_dump.json --pool 120
"""
import json, sys, argparse
import numpy as np

VOICES = ["orig", "terse", "verbose", "typos", "emotional", "oblique"]
RNG = np.random.default_rng(42)

# ---------- features (query-side, no gold needed) ----------
def shape_features(top_scores):
    s = np.asarray(top_scores, dtype=float)
    s = s[np.isfinite(s)]
    if s.size < 2:
        return np.zeros(7)
    srt = np.sort(s)[::-1]
    top1 = srt[0]
    margin = srt[0] - srt[1]
    mean = s.mean()
    std = s.std()
    gap = srt[0] - srt[-1]
    # softmax entropy over top-K (flat dist = no clear winner = likely hard/out-of-pool)
    z = srt - srt.max()
    p = np.exp(z); p /= p.sum()
    entropy = float(-(p * np.log(p + 1e-12)).sum())
    # decay slope: linear fit of sorted scores vs rank (steep = confident)
    x = np.arange(srt.size)
    slope = np.polyfit(x, srt, 1)[0]
    return np.array([top1, margin, mean, std, gap, entropy, slope])

FEATURE_NAMES = ["top1", "margin", "mean", "std", "gap", "entropy", "slope",
                 "q_mean_idf", "q_max_idf"]

def build_xy(records, pool):
    X, y, qids, voices = [], [], [], []
    for r in records:
        feats = np.concatenate([shape_features(r["top_scores"]),
                                [r.get("q_mean_idf", 0.0), r.get("q_max_idf", 0.0)]])
        gr = r.get("gold_rank", -1)
        in_pool = 1 if (gr is not None and 1 <= gr <= pool) else 0
        X.append(feats); y.append(in_pool); qids.append(r["qid"]); voices.append(r.get("voice"))
    return np.array(X), np.array(y), np.array(qids), np.array(voices)

# ---------- numpy logistic regression ----------
def standardize(Xtr, Xte):
    mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1.0
    return (Xtr - mu) / sd, (Xte - mu) / sd

def fit_logreg(X, y, l2=1.0, iters=400, lr=0.5):
    Xb = np.hstack([X, np.ones((X.shape[0], 1))])
    w = np.zeros(Xb.shape[1])
    n = len(y)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Xb @ w))
        g = Xb.T @ (p - y) / n
        g[:-1] += l2 * w[:-1] / n
        w -= lr * g
    return w

def predict_logreg(w, X):
    Xb = np.hstack([X, np.ones((X.shape[0], 1))])
    return 1 / (1 + np.exp(-Xb @ w))

# ---------- ROC-AUC (rank-based, Mann-Whitney) ----------
def auc(y, scores):
    y = np.asarray(y); scores = np.asarray(scores)
    npos = (y == 1).sum(); nneg = (y == 0).sum()
    if npos == 0 or nneg == 0:
        return float("nan")
    order = scores.argsort()
    ranks = np.empty(len(scores)); ranks[order] = np.arange(1, len(scores) + 1)
    # average ranks for ties
    _, inv, cnt = np.unique(scores, return_inverse=True, return_counts=True)
    sums = np.zeros(len(cnt)); np.add.at(sums, inv, ranks); avg = sums / cnt
    ranks = avg[inv]
    return float((ranks[y == 1].sum() - npos * (npos + 1) / 2) / (npos * nneg))

# ---------- group K-fold by qid ----------
def group_cv_scores(X, y, qids, k=5):
    uq = np.array(sorted(set(qids))); RNG.shuffle(uq)
    folds = np.array_split(uq, k)
    oof = np.full(len(y), np.nan)
    for f in folds:
        te = np.isin(qids, f); tr = ~te
        if (y[tr] == 1).sum() == 0 or (y[tr] == 0).sum() == 0:
            continue
        Xtr, Xte = standardize(X[tr], X[te])
        w = fit_logreg(Xtr, y[tr])
        oof[te] = predict_logreg(w, Xte)
    return oof

# ---------- evaluation ----------
def evaluate(X, y, qids, voices, n_null=20):
    oof = group_cv_scores(X, y, qids)
    m = ~np.isnan(oof)
    real = auc(y[m], oof[m])
    # per-voice
    pv = {}
    for v in VOICES:
        vm = m & (voices == v)
        if vm.sum() and len(set(y[vm])) == 2:
            pv[v] = auc(y[vm], oof[vm])
    # null control: shuffle labels x N
    nulls = []
    for _ in range(n_null):
        yn = y.copy(); RNG.shuffle(yn)
        on = group_cv_scores(X, yn, qids)
        mm = ~np.isnan(on)
        nulls.append(auc(yn[mm], on[mm]))
    nulls = np.array(nulls)
    # single-feature baseline floor
    base = {}
    for i, name in enumerate(FEATURE_NAMES):
        a = auc(y[m], X[m, i])
        base[name] = max(a, 1 - a)  # feature may be anti-correlated
    best_feat = max(base, key=base.get)
    return {
        "auc": real, "per_voice": pv,
        "null_max": float(np.nanmax(nulls)), "null_mean": float(np.nanmean(nulls)),
        "beats_null": bool(real > np.nanmax(nulls)),
        "best_single_feature": best_feat, "best_single_auc": base[best_feat],
        "beats_baseline": bool(real > base[best_feat]),
        "feature_aucs": base,
        "n": int(m.sum()), "pos": int(y[m].sum()), "neg": int((y[m] == 0).sum()),
    }

# ---------- synthetic self-test ----------
def synthetic(n_q=150, pool=120):
    """Plant a real signal: out-of-pool queries have FLATTER score dist + HIGHER idf.
    oblique voice is hardest (more out-of-pool, weaker signal). Verifies the harness
    recovers AUC>null on real data AND reports ~chance when the signal is removed."""
    recs = []
    for qi in range(n_q):
        for v in VOICES:
            hard = {"orig":0.05,"terse":0.12,"verbose":0.15,"typos":0.30,
                    "emotional":0.18,"oblique":0.45}[v]
            out = RNG.random() < hard
            # REALISTIC: overlapping dists + noise; signal split across features so NO single
            # feature separates (peak weak-but-noisy AND idf weak-but-noisy; only jointly informative).
            peak = RNG.normal(0.30 if out else 0.45, 0.18)          # heavy overlap
            base = RNG.normal(0.30, 0.08, size=pool)
            base[0] += peak
            base = np.sort(base)[::-1]
            idf = RNG.normal(6.2 if out else 5.4, 2.2)              # weak, overlapping
            recs.append({"qid": f"q{qi}", "voice": v,
                         "top_scores": base.tolist(),
                         "gold_rank": (-1 if out else int(RNG.integers(1, pool + 1))),
                         "q_mean_idf": float(idf), "q_max_idf": float(idf + RNG.random())})
    return recs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", nargs="?", help="scores_dump.json from 08a_dump.py")
    ap.add_argument("--pool", type=int, default=120)
    ap.add_argument("--synthetic", action="store_true")
    a = ap.parse_args()
    if a.synthetic:
        print("[SELF-TEST on synthetic data — planted signal: out-of-pool = flat scores + high IDF]")
        recs = synthetic(pool=a.pool)
    else:
        if not a.dump:
            ap.error("give scores_dump.json or --synthetic")
        recs = json.load(open(a.dump))
    X, y, qids, voices = build_xy(recs, a.pool)
    r = evaluate(X, y, qids, voices)
    print(f"\nn={r['n']}  in-pool={r['pos']}  out-of-pool={r['neg']}  "
          f"(out-of-pool rate {r['neg']/r['n']:.1%})")
    print(f"\nROC-AUC (predict in-pool): {r['auc']:.3f}")
    print(f"per-voice: " + "  ".join(f"{v} {r['per_voice'][v]:.3f}" for v in VOICES if v in r['per_voice']))
    print(f"\nNULL (label-shuffle x20): max {r['null_max']:.3f}  mean {r['null_mean']:.3f}  "
          f"-> beats null: {r['beats_null']}")
    print(f"baseline floor: best single feature = '{r['best_single_feature']}' "
          f"AUC {r['best_single_auc']:.3f}  -> beats baseline: {r['beats_baseline']}")
    print("feature AUCs: " + "  ".join(f"{k} {v:.2f}" for k, v in
          sorted(r['feature_aucs'].items(), key=lambda x: -x[1])))
    # Feynman verdict
    ok = r["beats_null"] and r["beats_baseline"]
    print(f"\nVERDICT: {'SIGNAL (beats null AND single-feature floor)' if ok else 'NO real lift over floor — report the floor, not the model (Bellard)'}")

if __name__ == "__main__":
    main()
