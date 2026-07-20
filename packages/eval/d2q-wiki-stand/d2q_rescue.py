#!/usr/bin/env python3
"""
d2q_rescue — does the doc2query bridge hold on held-out queries (A/B/C + null).

TEST QUERIES: a ground-truth file (D2Q_GT) authored independently of the
generators, plus an optional real user query (D2Q_REAL_QUERY, with
D2Q_REAL_TOPIC naming its gold topic). The generators never saw any of them.

UNIVERSE: only sections that HAVE expansions (distractor pool + gold).
Measuring over the full corpus would be unfair: sections without a boost
channel cannot compete, and gold would win by construction. Ranks are
comparable WITHIN the universe.

ARMS: baseline (bare dense) · A/B doc-seeded · C styled · null (each section
gets the expansions of a FOREIGN section, shift +7 — catches "any extra text
lifts the score"; a prior arc run lost 57% of a raw effect to this control).
Each arm ×2: all candidates / keep-triaged only.

SECTION SCORE = max(sim(q, section vector), max sim(q, its expansion vectors)).

LEAK AUDIT: max word-bigram Jaccard (test query ↔ expansions of its gold).
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

import numpy as np

S = Path(__file__).parent
SRC = Path(os.environ.get("D2Q_CORPUS_DB", Path.home() / "corpus.db"))
TABLE = os.environ.get("D2Q_CORPUS_TABLE", "wiki")
DB = Path(os.environ.get("D2Q_DB", S / "d2q.db"))
GT = Path(os.environ.get("D2Q_GT", S / "gt.json"))
KEEP_TOP = 10
REAL_QUERY = os.environ.get("D2Q_REAL_QUERY", "")
REAL_TOPIC = os.environ.get("D2Q_REAL_TOPIC", "")

sys.path.insert(0, str(S))
from d2q_filter import embed_batch  # noqa: E402  one embedder for everything


def bigrams(s):
    w = [t for t in "".join(c.lower() if c.isalnum() else " " for c in s).split() if t]
    return set(zip(w, w[1:])) if len(w) > 1 else {(w[0], "") for w in [w] if w} or set()


def main():
    gt = json.load(open(GT))
    tests = []  # (qtext, lang, topic, gold_ids)
    for topic, t in gt["topics"].items():
        tests.append((t["ru"], "ru", topic, t["gold"]))
        tests.append((t["en"], "en", topic, t["gold"]))
    if REAL_QUERY and REAL_TOPIC:
        tests.append((REAL_QUERY, "ru-real", REAL_TOPIC,
                      gt["topics"][REAL_TOPIC]["gold"]))

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    # expansions per section; model carries '|styled' for arm C
    rows = db.execute("SELECT id, model, temp, queries FROM exp WHERE status='ok'").fetchall()
    verd = {(q, sid, m, t): v for q, sid, m, t, v in
            db.execute("SELECT q, src_id, model, temp, verdict FROM cand")}
    vec = {q: json.loads(v) for q, v in db.execute("SELECT q, vec FROM qvec WHERE vec != ''")}

    # universe = sections having expansions from at least one arm
    universe = sorted({r[0] for r in rows})
    src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
    uni = set(universe)
    sec = {i: (p, json.loads(e)) for i, p, e in src.execute(
        f"SELECT id, path, embedding FROM {TABLE}") if i in uni}
    src.close()
    ids = [i for i in universe if i in sec]
    D = np.array([sec[i][1] for i in ids], dtype=np.float32)
    D /= (np.linalg.norm(D, axis=1, keepdims=True) + 1e-9)
    pos = {i: k for k, i in enumerate(ids)}
    print(f"universe: {len(ids)} sections (gold present: "
          f"{sum(1 for t in tests for g in t[3] if g in pos)}/{sum(len(t[3]) for t in tests)})",
          flush=True)

    # expansion strings per arm: arm -> id -> [(query, kept)]
    def arm_of(model):
        base = model.split(":", 1)[0].split("|")[0]
        return ("C_" + base) if model.endswith("|styled") else ("A_" + base)

    arms = {}
    for sid, model, temp, qs in rows:
        a = arm_of(model)
        for q in json.loads(qs):
            q = q.strip()
            if not q or q not in vec:
                continue
            kept = verd.get((q, sid, model, temp)) == "keep"
            arms.setdefault(a, {}).setdefault(sid, []).append((q, kept))

    # null arm: section i receives the expansions of ids[(pos[i]+7) % n]
    # from the first A-arm
    donor_name = sorted(a for a in arms if a.startswith("A_"))[0]
    donor = arms[donor_name]
    nul = {}
    for i in ids:
        d = ids[(pos[i] + 7) % len(ids)]
        nul[i] = donor.get(d, [])
    arms["null_shift7"] = nul

    # embed test queries — same embedder, same prefix
    qv = embed_batch([t[0] for t in tests])
    Q = np.array(qv, dtype=np.float32)
    Q /= (np.linalg.norm(Q, axis=1, keepdims=True) + 1e-9)
    base_sims = Q @ D.T                       # (tests × sections)

    def rank_of_gold(scores, gold):
        golds = [pos[g] for g in gold if g in pos]
        if not golds:
            return None
        order = np.argsort(-scores)
        rk = {j: r + 1 for r, j in enumerate(order)}
        return min(rk[j] for j in golds)

    def eval_arm(name, expmap, kept_only):
        out = []
        for ti, (qt, lang, topic, gold) in enumerate(tests):
            scores = base_sims[ti].copy()
            for i in ids:
                cand = [(q, k) for q, k in expmap.get(i, []) if (k or not kept_only)]
                if not cand:
                    continue
                V = np.array([vec[q] for q, _ in cand], dtype=np.float32)
                V /= (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)
                boost = float(np.max(V @ Q[ti]))
                scores[pos[i]] = max(scores[pos[i]], boost)
            out.append((lang, topic, rank_of_gold(scores, gold)))
        return out

    results = {"baseline": [(lang, topic, rank_of_gold(base_sims[ti], gold))
                            for ti, (qt, lang, topic, gold) in enumerate(tests)]}
    for a in sorted(arms):
        results[a + "/all"] = eval_arm(a, arms[a], kept_only=False)
        if a != "null_shift7":
            results[a + "/keep"] = eval_arm(a, arms[a], kept_only=True)

    def agg(rows_, langs):
        rr = [r for lang, _, r in rows_ if r and lang in langs]
        if not rr:
            return "—"
        resc = sum(r <= KEEP_TOP for r in rr) / len(rr)
        mrr = sum(1 / r for r in rr) / len(rr)
        med = sorted(rr)[len(rr) // 2]
        return f"rescue@10 {resc:.2f}  MRR {mrr:.3f}  median {med}"

    print("\n=== RESULT (universe of", len(ids), "sections) ===")
    for name, rows_ in results.items():
        print(f"\n{name}")
        print(f"  RU      {agg(rows_, {'ru'})}")
        print(f"  EN      {agg(rows_, {'en'})}")
        real = [r for lang, _, r in rows_ if lang == 'ru-real']
        if real:
            print(f"  REAL user query: rank {real[0]}")

    # leak audit
    print("\n=== LEAK AUDIT (bigram Jaccard, test ↔ its gold's expansions) ===")
    worst = []
    for qt, lang, topic, gold in tests:
        tb = bigrams(qt)
        best = 0.0
        for a, m in arms.items():
            if a == "null_shift7":
                continue
            for g in gold:
                for q, _ in m.get(g, []):
                    qb = bigrams(q)
                    if tb and qb:
                        j = len(tb & qb) / len(tb | qb)
                        best = max(best, j)
        worst.append((best, lang, topic, qt))
    for j, lang, topic, qt in sorted(worst, reverse=True)[:5]:
        print(f"  {j:.2f}  [{lang}] {topic}: {qt[:60]}")
    print(f"  median: {sorted(w[0] for w in worst)[len(worst)//2]:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
