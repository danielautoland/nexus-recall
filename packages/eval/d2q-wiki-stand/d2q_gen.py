#!/usr/bin/env python3
"""
d2q_gen — doc-seeded doc2query expansions (arms A/B of the stand).

Guards, each against a failure mode caught live:

  TEST-IN-PROD        writes to a separate d2q.db, never touches the live index.
  POOL-NOT-JUST-GOLD  expansions are generated for the whole pool, not only for
                      gold docs: otherwise gold wins by text volume, not meaning.
  EMPTY-IS-NOT-ABSENCE  an empty model reply is written as status='empty', not
                      as a missing row — a summary must not lie by silence.
  RC-IS-NOT-EFFECT    done_reason is kept: 'length' = truncated, that is NOT
                      an answer.
  reasoning models    think=False is mandatory, or the whole budget goes to
                      the thinking field (measured: gemma4:e4b and qwen3:8b
                      are both reasoning models).
  RESUMABLE           INSERT OR IGNORE + commit per row: an abort loses nothing.

Usage: d2q_gen.py <model> [--pool N] [--limit N] [--ids ids.json]
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

GEN_URL = os.environ.get("D2Q_GEN_URL", "http://localhost:11434/api/chat")
SRC = Path(os.environ.get("D2Q_CORPUS_DB", Path.home() / "corpus.db"))
TABLE = os.environ.get("D2Q_CORPUS_TABLE", "wiki")
DST = Path(os.environ.get("D2Q_DB", Path(__file__).parent / "d2q.db"))

# The prompt is deliberately Russian: the target register is the owner's
# colloquial RU (slang, translit, no caps), not correct literary queries.
PROMPT = (
    "Заметка:\n{doc}\n\n"
    "Придумай 6 запросов, которыми человек искал бы эту заметку через полгода, "
    "забыв точные слова. 4 по-русски разговорно — с сокращениями, сленгом и "
    "транслитом, как пишут в чате, без заглавных букв. 2 по-английски коротко. "
    "Не копируй слова заметки дословно. Только запросы, по одному в строке, "
    "без нумерации и без пояснений."
)

# Floating temperature: one pass gives one "mood" of voice. Low stays close to
# the note (terms), high drifts into slang (register). Over-generate at both
# ends and let the filter sort it out: dropping a candidate is cheaper than
# not having one.
TEMPS = (0.7, 1.1)

# Sections at or above this Cyrillic share are skipped: they already speak
# the owner's register, the bridge is for the EN islands of a mixed corpus.
CYR_SKIP = float(os.environ.get("D2Q_SKIP_CYR", "0.5"))


def cyr_share(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum("Ѐ" <= c <= "ӿ" for c in letters) / len(letters)


def gen(model: str, doc: str, temp: float, timeout=300):
    body = {
        "model": model, "stream": False, "think": False,
        "options": {"num_predict": 260, "temperature": temp},
        "messages": [{"role": "user", "content": PROMPT.format(doc=doc[:1400])}],
    }
    req = urllib.request.Request(GEN_URL, json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    return (r.get("message", {}).get("content") or "").strip(), r.get("done_reason"), r.get("eval_count", 0)


def clean(raw: str):
    """Query lines out of the raw reply; junk (numbering, preambles) cut."""
    out = []
    for ln in raw.splitlines():
        s = ln.strip().lstrip("-•*0123456789.) \t").strip().strip('"\'')
        if not s or len(s) < 4 or len(s) > 160:
            continue
        if s.endswith(":") or s.lower().startswith(("вот ", "запросы", "here", "sure")):
            continue
        out.append(s)
    return out[:6]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    model = sys.argv[1]
    pool_n = int(sys.argv[sys.argv.index("--pool") + 1]) if "--pool" in sys.argv else 400
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0

    src = sqlite3.connect(SRC)
    rows = src.execute(
        f"SELECT id, path, line, doc, heading, embed_text FROM {TABLE} ORDER BY id"
    ).fetchall()
    src.close()

    # Explicit section list (--ids file.json) — targeted top-up for the gold
    # docs of the held-out stage: rescue cannot be measured on docs that have
    # no expansions.
    if "--ids" in sys.argv:
        want = set(json.load(open(sys.argv[sys.argv.index("--ids") + 1])))
        pool = [r for r in rows if r[0] in want]
    else:
        # Deterministic pool: every n-th row, so the whole corpus is covered,
        # not one section of it.
        step = max(1, len(rows) // pool_n)
        pool = rows[::step][:pool_n]
    if limit:
        pool = pool[:limit]

    # REGISTER GUARD: a section already written mostly in the owner's own
    # language/register does not need a voice bridge — expanding it only adds
    # collision surface. Measured on the motivating corpus: just 13% of
    # sections were clean EN; the majority already carries Cyrillic.
    skipped = [r for r in pool if cyr_share(r[5]) >= CYR_SKIP]
    if skipped:
        print(f"guard: skipped {len(skipped)} sections ≥{CYR_SKIP:.0%} Cyrillic "
              f"(already in the owner's register; not a silent cap)", flush=True)
    pool = [r for r in pool if cyr_share(r[5]) < CYR_SKIP]

    # WAL + busy wait: generator and filter may share this DB. Without it the
    # second writer dies with 'database is locked' (caught live).
    dst = sqlite3.connect(DST, timeout=120)
    dst.execute("PRAGMA journal_mode=WAL")
    dst.execute("PRAGMA busy_timeout=120000")
    dst.execute("""CREATE TABLE IF NOT EXISTS exp (
        id TEXT, model TEXT, temp REAL, path TEXT, line INTEGER, heading TEXT,
        queries TEXT, raw TEXT, status TEXT, done_reason TEXT,
        eval_count INTEGER, secs REAL,
        PRIMARY KEY (id, model, temp))""")
    dst.commit()

    # Unit of work = (document, temperature). Resume by pair.
    done = {(r[0], r[1]) for r in
            dst.execute("SELECT id, temp FROM exp WHERE model=?", (model,))}
    todo = [(r, t) for r in pool for t in TEMPS if (r[0], t) not in done]
    print(f"{model}: pool {len(pool)} × temps {TEMPS} = {len(pool)*len(TEMPS)} tasks, "
          f"done {len(done)}, to generate {len(todo)}", flush=True)

    t0 = time.time()
    ok = empty = err = 0
    for i, ((rid, path, line, doc, heading, etext), temp) in enumerate(todo, 1):
        t = time.time()
        try:
            raw, dr, ec = gen(model, etext, temp)
            qs = clean(raw)
            # EMPTY is a status, not a missing row.
            status = "ok" if qs else ("empty" if not raw else "unparsed")
            if status == "ok":
                ok += 1
            else:
                empty += 1
        except Exception as e:
            raw, dr, ec, qs, status = f"{type(e).__name__}: {e}", None, 0, [], "error"
            err += 1
        dst.execute("INSERT OR IGNORE INTO exp VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, model, temp, path, line, heading,
                     json.dumps(qs, ensure_ascii=False),
                     raw[:2000], status, dr, ec, round(time.time() - t, 2)))
        dst.commit()
        if i % 25 == 0 or i == len(todo):
            el = time.time() - t0
            print(f"  {i}/{len(todo)}  ok={ok} empty={empty} err={err}  "
                  f"{el:.0f}s  ETA {el/i*(len(todo)-i)/60:.1f}m", flush=True)
    dst.close()
    print(f"DONE {model}: ok={ok} empty={empty} err={err}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
