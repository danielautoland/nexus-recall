#!/usr/bin/env python3
"""
d2q_filter — candidate triage (the question #119 asks).

The triage question is not "is this a pretty query" but: **does it reach its
own document, and does it reach a foreign one first.** A candidate that leads
to a foreign document is WORSE than no candidate — it spends a result slot
and walks the human away.

CLASSES (by the rank of the candidate's OWN document over the full corpus):
  keep       own_rank <= KEEP        — the bridge works
  weak       own_rank >  KEEP        — cannot even reach its own doc, useless
  collision  top-1 = FOREIGN FILE    — actively harmful

⚠ EASY TO GET WRONG: collision is judged by FILE, not by section. A query
that lands on a neighbouring section of the SAME file put the human in the
right place — that is not a collision. Counting by section id inflates the
harm several-fold.

GUARDS:
  TEST-IN-PROD     the live index is read-only here; writes go to d2q.db only
  EMBED-CACHE      qvec table: a re-run does not re-embed (resume)
  EMPTY-IS-STATUS  a candidate without a vector is marked 'novec', it does
                   not vanish silently
  ONE EMBEDDER     must match the model that built the corpus embeddings
                   (asymmetric prefixes included), or the comparison is void
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

import numpy as np

SRC = Path(os.environ.get("D2Q_CORPUS_DB", Path.home() / "corpus.db"))
TABLE = os.environ.get("D2Q_CORPUS_TABLE", "wiki")
DST = Path(os.environ.get("D2Q_DB", Path(__file__).parent / "d2q.db"))
EMBED_URL = os.environ.get("D2Q_EMBED_URL", "http://localhost:11434/api/embed")
MODEL = os.environ.get("D2Q_EMBED_MODEL", "embeddinggemma")
QUERY_PREFIX = os.environ.get("D2Q_QUERY_PREFIX", "task: search result | query: ")
KEEP = 10


def embed_batch(texts, tries=5):
    # Batched /api/embed + retries: a single curl with timeout=60 killed the
    # run twice when the Ollama VRAM scheduler evicted the embedder under a
    # foreign chat-model load.
    import time
    import urllib.request
    body = json.dumps({"model": MODEL, "keep_alive": "30m",
                       "input": [QUERY_PREFIX + t[:2000] for t in texts]}).encode()
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                EMBED_URL, data=body,
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read())["embeddings"]
        except Exception as e:
            wait = 15 * (attempt + 1)
            print(f"  embed retry {attempt+1}/{tries} ({type(e).__name__}), "
                  f"waiting {wait}s", flush=True)
            time.sleep(wait)
    return None


def main():
    # ── corpus ───────────────────────────────────────────────────────────
    src = sqlite3.connect(SRC)
    wiki = src.execute(f"SELECT id, path, embedding FROM {TABLE} ORDER BY id").fetchall()
    src.close()
    ids = [r[0] for r in wiki]
    paths = [r[1] for r in wiki]
    idx_of = {rid: i for i, rid in enumerate(ids)}
    M = np.array([json.loads(r[2]) for r in wiki], dtype=np.float32)
    M /= (np.linalg.norm(M, axis=1, keepdims=True) + 1e-9)
    print(f"corpus: {M.shape[0]} sections × {M.shape[1]}d", flush=True)

    # ── candidates ───────────────────────────────────────────────────────
    dst = sqlite3.connect(DST, timeout=120)
    dst.execute("PRAGMA journal_mode=WAL")
    dst.execute("PRAGMA busy_timeout=120000")
    dst.execute("""CREATE TABLE IF NOT EXISTS qvec (
        q TEXT PRIMARY KEY, vec TEXT)""")
    dst.execute("""CREATE TABLE IF NOT EXISTS cand (
        q TEXT, src_id TEXT, model TEXT, temp REAL,
        own_rank INTEGER, own_sim REAL, top1_id TEXT, top1_path TEXT,
        verdict TEXT, PRIMARY KEY (q, src_id, model, temp))""")
    dst.commit()

    rows = dst.execute("SELECT id, model, temp, queries FROM exp WHERE status='ok'").fetchall()
    cands = []          # (q, src_id, model, temp)
    for rid, model, temp, qs in rows:
        seen = set()
        for q in json.loads(qs):
            k = q.strip().lower()
            if not k or k in seen:      # intra-doc dedup (mode-collapse)
                continue
            seen.add(k)
            cands.append((q.strip(), rid, model, temp))
    uniq = sorted({c[0] for c in cands})
    print(f"candidates: {len(cands)} (unique strings {len(uniq)})", flush=True)

    # ── embeddings with cache ────────────────────────────────────────────
    # empty vec = a past embed failure: retry it, do not count it as done
    have = {q for (q,) in dst.execute("SELECT q FROM qvec WHERE vec != ''")}
    todo = [q for q in uniq if q not in have]
    print(f"to embed: {len(todo)}", flush=True)
    B = 32
    for off in range(0, len(todo), B):
        chunk = todo[off:off + B]
        vs = embed_batch(chunk)
        if vs is None or len(vs) != len(chunk):
            # the batch failed even after retries — mark novec, never lose silently
            print(f"  batch {off} failed after retries, marking novec", flush=True)
            vs = [None] * len(chunk)
        for q, v in zip(chunk, vs):
            dst.execute("INSERT OR REPLACE INTO qvec VALUES (?,?)",
                        (q, json.dumps(v) if v else ""))
        dst.commit()
        if (off // B) % 5 == 0:
            print(f"  {min(off+B, len(todo))}/{len(todo)}", flush=True)

    vec = {q: (json.loads(v) if v else None)
           for q, v in dst.execute("SELECT q, vec FROM qvec")}

    # ── scoring ──────────────────────────────────────────────────────────
    usable = [q for q in uniq if vec.get(q)]
    Q = np.array([vec[q] for q in usable], dtype=np.float32)
    Q /= (np.linalg.norm(Q, axis=1, keepdims=True) + 1e-9)
    S = Q @ M.T                                   # (candidates × sections)
    order = np.argsort(-S, axis=1)
    pos_of = {q: i for i, q in enumerate(usable)}
    print(f"matrix {S.shape} computed", flush=True)

    stat = {"keep": 0, "weak": 0, "collision": 0, "novec": 0}
    for q, src_id, model, temp in cands:
        i = pos_of.get(q)
        if i is None:
            dst.execute("INSERT OR REPLACE INTO cand VALUES (?,?,?,?,?,?,?,?,?)",
                        (q, src_id, model, temp, None, None, None, None, "novec"))
            stat["novec"] += 1
            continue
        j = idx_of[src_id]
        row = order[i]
        own_rank = int(np.where(row == j)[0][0]) + 1
        t1 = int(row[0])
        # Collision by FILE, not by section: a neighbouring section of the
        # same file is a hit.
        collision = paths[t1] != paths[j]
        verdict = "collision" if (collision and own_rank > 1) else (
            "keep" if own_rank <= KEEP else "weak")
        stat[verdict] += 1
        dst.execute("INSERT OR REPLACE INTO cand VALUES (?,?,?,?,?,?,?,?,?)",
                    (q, src_id, model, temp, own_rank, float(S[i, j]),
                     ids[t1], paths[t1], verdict))
    dst.commit()

    print("\n=== TRIAGE ===")
    tot = sum(stat.values())
    for k, v in stat.items():
        print(f"  {k:10} {v:5}  {100*v/tot:5.1f}%")
    print("\n=== per arm ===")
    for m, t, kp, cl, wk, n in dst.execute("""
        SELECT model, temp,
               SUM(verdict='keep'), SUM(verdict='collision'),
               SUM(verdict='weak'), COUNT(*)
        FROM cand GROUP BY model, temp ORDER BY model, temp"""):
        print(f"  {m:22} t={t}  keep {100*kp/n:5.1f}%  "
              f"collision {100*cl/n:5.1f}%  weak {100*wk/n:5.1f}%  (n={n})")
    dst.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
