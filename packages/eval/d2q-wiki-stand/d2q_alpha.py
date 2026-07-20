#!/usr/bin/env python3
"""
d2q_alpha — the consequence the rescue run forces you to face: expansions fix
the hard class (the cross-lingual query) and TAX the easy one (queries bare
dense already ranks at 1 — a foreign boost can outbid an honest dense score).

One number answers the deploy question: does a discount on the boost channel
give the easy class back without losing the rescued hard one?

    score = max(dense, α · max_exp_sim)

The arm is fixed (D2Q_ALPHA_MODEL, an exp.model value, keep-triaged only).
The α sweep is exploratory — a handful of test queries is a direction,
not a constant to enshrine.
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
ARM_MODEL = os.environ.get("D2Q_ALPHA_MODEL", "gemma4:e4b|styled")
REAL_QUERY = os.environ.get("D2Q_REAL_QUERY", "")
REAL_TOPIC = os.environ.get("D2Q_REAL_TOPIC", "")
sys.path.insert(0, str(S))
from d2q_filter import embed_batch  # noqa: E402

gt = json.load(open(GT))
tests = []
for topic, t in gt["topics"].items():
    tests.append((t["ru"], "ru", t["gold"]))
    tests.append((t["en"], "en", t["gold"]))
if REAL_QUERY and REAL_TOPIC:
    tests.append((REAL_QUERY, "ru-real", gt["topics"][REAL_TOPIC]["gold"]))

db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows = db.execute("SELECT id, model, temp, queries FROM exp "
                  "WHERE status='ok' AND model=?", (ARM_MODEL,)).fetchall()
verd = {(q, sid, m, t): v for q, sid, m, t, v in
        db.execute("SELECT q, src_id, model, temp, verdict FROM cand")}
vec = {q: json.loads(v) for q, v in db.execute("SELECT q, vec FROM qvec WHERE vec != ''")}
universe = sorted({r[0] for r in
                   db.execute("SELECT DISTINCT id FROM exp WHERE status='ok'")})

src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
uni = set(universe)
sec = {i: (p, json.loads(e)) for i, p, e in src.execute(
    f"SELECT id, path, embedding FROM {TABLE}") if i in uni}
src.close()
ids = [i for i in universe if i in sec]
D = np.array([sec[i][1] for i in ids], dtype=np.float32)
D /= (np.linalg.norm(D, axis=1, keepdims=True) + 1e-9)
pos = {i: k for k, i in enumerate(ids)}

exp_of = {}
for sid, model, temp, qs in rows:
    for q in json.loads(qs):
        q = q.strip()
        if q in vec and verd.get((q, sid, model, temp)) == "keep":
            exp_of.setdefault(sid, []).append(q)

qv = embed_batch([t[0] for t in tests])
Q = np.array(qv, dtype=np.float32)
Q /= (np.linalg.norm(Q, axis=1, keepdims=True) + 1e-9)
base = Q @ D.T

# boost matrix: (tests × sections), max expansion similarity
boost = np.full_like(base, -1.0)
for i in ids:
    qs = exp_of.get(i, [])
    if not qs:
        continue
    V = np.array([vec[q] for q in qs], dtype=np.float32)
    V /= (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)
    boost[:, pos[i]] = (Q @ V.T).max(axis=1)


def agg(scores):
    out = {}
    for grp in ("ru", "en", "ru-real"):
        rr = []
        for ti, (qt, lang, gold) in enumerate(tests):
            if lang != grp:
                continue
            golds = [pos[g] for g in gold if g in pos]
            order = np.argsort(-scores[ti])
            rk = {j: r + 1 for r, j in enumerate(order)}
            rr.append(min(rk[j] for j in golds))
        if grp == "ru-real":
            out[grp] = f"rank {rr[0]}" if rr else "—"
        else:
            out[grp] = (f"r@10 {sum(r<=10 for r in rr)/len(rr):.2f} "
                        f"MRR {sum(1/r for r in rr)/len(rr):.3f}")
    return out


print(f"universe {len(ids)}, arm {ARM_MODEL}/keep")
print(f"{'α':>5}  {'RU':<22} {'EN':<22} real")
for a in (0.0, 0.80, 0.85, 0.90, 0.95, 1.0):
    r = agg(np.maximum(base, a * boost))
    print(f"{a:>5}  {r['ru']:<22} {r['en']:<22} {r['ru-real']}")
