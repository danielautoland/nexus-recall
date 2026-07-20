#!/usr/bin/env python3
"""
d2q_styled — arm C: doc2query CONDITIONED on the owner's register.

The axis (from the owner's earlier bakeoff): seed source decides more than
the generator.
  doc-seeded      covers every section, voice of the model
  query-seeded    champion, but UNAVAILABLE without real query→doc pairs
This arm is the compromise: the seed stays the document (coverage), but the
VOICE comes from the owner's real replies.

VOICE DONOR (D2Q_VOICES, jsonl): verbatim user replies with acted_on=true —
each one already selected by effect ("this is how the person talks when they
actually need something"), which beats raw prompt logs selected by mere
availability.

WHY AT ALL: measured — an unconditioned model writes CORRECT Russian ("Как
настроить мышь в Hyprland?") while the owner writes clipped slang. Between
the two lies the zero-shared-tokens gap this whole stand is about.

Guards: same as d2q_gen.py, plus:
  LEAK-HYGIENE   donor replies are used as style samples only; their words
                 must not leak into a query about an unrelated topic
                 (checked downstream by the filter).
  DETERMINISM    few-shot picks hash on the document id, not random() —
                 the run is reproducible and resume-safe.

Usage: d2q_styled.py <model> [--pool N] [--limit N] [--ids ids.json]
"""
import hashlib
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
ALIAS = Path(os.environ.get("D2Q_VOICES", Path(__file__).parent / "voices.jsonl"))
DST = Path(os.environ.get("D2Q_DB", Path(__file__).parent / "d2q.db"))
TEMPS = (0.7, 1.1)
ARM = "styled"

# Same register guard as d2q_gen.py: a doc already in the owner's register
# gets no voice expansion — it would only add collision surface.
CYR_SKIP = float(os.environ.get("D2Q_SKIP_CYR", "0.5"))


def cyr_share(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum("Ѐ" <= c <= "ӿ" for c in letters) / len(letters)


def load_voices():
    """Owner replies as voice samples. acted_on only — selected by effect."""
    out = []
    for ln in ALIAS.read_text(errors="replace").splitlines():
        if not ln.strip():
            continue
        try:
            r = json.loads(ln)
        except Exception:
            continue
        s = (r.get("surface") or "").strip()
        if r.get("acted_on") and 15 < len(s) < 130:
            out.append(s)
    return out


VOICES = load_voices()

# Russian on purpose — see d2q_gen.py.
PROMPT = (
    "Вот как ЭТОТ человек формулирует, когда что-то ищет — обрати внимание на "
    "обрезанность, сленг, транслит, отсутствие заглавных, опечатки:\n{shots}\n\n"
    "Заметка:\n{doc}\n\n"
    "Напиши 6 запросов, которыми ИМЕННО ЭТОТ человек искал бы эту заметку через "
    "полгода, забыв точные слова. Его голосом, не литературным русским. "
    "4 по-русски, 2 по-английски коротко. Не копируй слова заметки дословно. "
    "Только запросы, по одному в строке, без нумерации."
)


def shots_for(rid: str, k=5):
    """Deterministic few-shot pick: hash of the id, not random — resume-safe."""
    if not VOICES:
        return ""
    h = int(hashlib.sha1(rid.encode()).hexdigest(), 16)
    picked = [VOICES[(h + i * 7) % len(VOICES)] for i in range(k)]
    return "\n".join("  · " + s for s in picked)


def gen(model, doc, rid, temp, timeout=300):
    body = {
        "model": model, "stream": False, "think": False,
        "options": {"num_predict": 260, "temperature": temp},
        "messages": [{"role": "user", "content": PROMPT.format(
            shots=shots_for(rid), doc=doc[:1200])}],
    }
    req = urllib.request.Request(GEN_URL, json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    return (r.get("message", {}).get("content") or "").strip(), r.get("done_reason"), r.get("eval_count", 0)


def clean(raw):
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
    pool_n = int(sys.argv[sys.argv.index("--pool") + 1]) if "--pool" in sys.argv else 200
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    tag = f"{model}|{ARM}"

    print(f"voice-donor replies loaded: {len(VOICES)}", flush=True)

    src = sqlite3.connect(SRC)
    rows = src.execute(f"SELECT id, path, line, doc, heading, embed_text FROM {TABLE} ORDER BY id").fetchall()
    src.close()
    if "--ids" in sys.argv:
        want = set(json.load(open(sys.argv[sys.argv.index("--ids") + 1])))
        pool = [r for r in rows if r[0] in want]
    else:
        step = max(1, len(rows) // pool_n)
        pool = rows[::step][:pool_n]
    if limit:
        pool = pool[:limit]

    skipped = [r for r in pool if cyr_share(r[5]) >= CYR_SKIP]
    if skipped:
        print(f"guard: skipped {len(skipped)} sections ≥{CYR_SKIP:.0%} Cyrillic "
              f"(already in the owner's register; not a silent cap)", flush=True)
    pool = [r for r in pool if cyr_share(r[5]) < CYR_SKIP]

    dst = sqlite3.connect(DST, timeout=120)
    dst.execute("PRAGMA journal_mode=WAL")
    dst.execute("PRAGMA busy_timeout=120000")
    dst.execute("""CREATE TABLE IF NOT EXISTS exp (
        id TEXT, model TEXT, temp REAL, path TEXT, line INTEGER, heading TEXT,
        queries TEXT, raw TEXT, status TEXT, done_reason TEXT,
        eval_count INTEGER, secs REAL,
        PRIMARY KEY (id, model, temp))""")
    dst.commit()

    done = {(r[0], r[1]) for r in
            dst.execute("SELECT id, temp FROM exp WHERE model=?", (tag,))}
    todo = [(r, t) for r in pool for t in TEMPS if (r[0], t) not in done]
    print(f"{tag}: to generate {len(todo)}", flush=True)

    t0 = time.time()
    ok = bad = 0
    for i, ((rid, path, line, doc, heading, etext), temp) in enumerate(todo, 1):
        t = time.time()
        try:
            raw, dr, ec = gen(model, etext, rid, temp)
            qs = clean(raw)
            status = "ok" if qs else ("empty" if not raw else "unparsed")
            ok += status == "ok"
            bad += status != "ok"
        except Exception as e:
            raw, dr, ec, qs, status = f"{type(e).__name__}: {e}", None, 0, [], "error"
            bad += 1
        dst.execute("INSERT OR IGNORE INTO exp VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, tag, temp, path, line, heading,
                     json.dumps(qs, ensure_ascii=False),
                     raw[:2000], status, dr, ec, round(time.time() - t, 2)))
        dst.commit()
        if i % 25 == 0 or i == len(todo):
            el = time.time() - t0
            print(f"  {i}/{len(todo)} ok={ok} bad={bad} {el:.0f}s "
                  f"ETA {el/i*(len(todo)-i)/60:.1f}m", flush=True)
    dst.close()
    print(f"DONE {tag}: ok={ok} bad={bad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
