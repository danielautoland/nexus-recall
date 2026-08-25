/**
 * Kandidaten-Union für das Qualitätsset (#362, Phase 0.5).
 *
 * Jede Bewertung, die bisher gefahren wurde, hat dieselbe Schwäche: Sie nimmt
 * die heute ausgelieferten Treffer als Wahrheit. Das ist zirkulär. Ein Treffer
 * mit `score >= 100` muss konstruktionsbedingt aus BEIDEN Armen stammen — wer
 * gegen diese Menge misst, kann nie herausfinden, was ein einarmiger Modus
 * besser fände, weil solche Kandidaten die 100 nie erreichen und deshalb gar
 * nicht erst im Vergleich auftauchen.
 *
 * Dieses Werkzeug baut die Menge, gegen die man ehrlich messen kann: die
 * VEREINIGUNG dessen, was die verschiedenen Wege vorschlagen —
 *
 *   - die Top-N des dichten Arms,
 *   - die Top-N des lexikalischen Arms,
 *   - den schnellen Lexikpfad als eigenen Modus (`bm25_no_fuzzy`),
 *   - was über der Einblendgrenze liegt (Score >= 100),
 *   - beide Ränder: unter 100 UND unter dem Floor von 30, letzteres aus dem
 *     tiefen Kandidatenpool, den die Antwort gar nicht mehr enthält,
 *   - exakte Identifier-Treffer (die Klasse, die der dichte Arm nachweislich
 *     verfehlt: 22 von 90 im Stresstest),
 *   - eine Kontrollstichprobe aus dem Vault, die KEIN Retriever vorgeschlagen
 *     hat — sonst misst das Set nur, wie einig sich die Retriever sind.
 *
 * Ausgegeben wird ein Arbeitsblatt zum Labeln — `required` / `optional` /
 * `irrelevant` — mit der PROVENIENZ jedes Kandidaten, aber ohne die Scores.
 * Das ist Absicht: Wer beim Labeln die Zahl sieht, labelt die Zahl.
 *
 * ```
 * BASTRA_VAULT_PATH=~/vault npx tsx src/candidate-union.ts --n 20 --out set.json
 * ```
 *
 * Die Aufteilung in Train/Validation gehört NICHT hierher und passiert nicht
 * zufällig über einzelne Treffer: Zwei Kandidaten derselben Query sind nicht
 * unabhängig. Getrennt wird nach ganzen Queries beziehungsweise Sessions.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  Vault,
  SearchIndex,
  EmbeddingIndex,
  OllamaEmbeddingProvider,
  groupQueryTerms,
  tokenizeWithIdentifiers,
} from "@bastra-recall/core";

const MUST_LOAD_SCORE = 100;
const RECALL_FLOOR = 30;

/** Wieviele Kandidaten direkt UNTER dem Floor mit ins Set kommen. Der Rand ist
 *  interessant, der Rest des Pools ist Rauschen — und Labelzeit ist die
 *  knappste Ressource dieses ganzen Vorhabens. */
const BELOW_FLOOR_MARGIN = 5;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Woher ein Kandidat kommt. Mehrere Quellen pro Kandidat sind der Normalfall. */
type Provenance =
  | "dense-top"
  | "lexical-top"
  /** Score >= 100 im Core. NICHT dasselbe wie „wurde eingeblendet": danach
   *  kommen Scope-Filter, weak_result, Backoff, Session-Dedup und Lane-Regeln.
   *  Der Name sagt deshalb, was gemessen wurde, nicht was vermutet wird. */
  | "above-inject-floor"
  | "below-floor"
  | "identifier-exact"
  /** Der schnelle Lexikpfad als eigener Modus (`bm25_no_fuzzy`) — er ist es,
   *  der freigegeben werden soll, also muss er seine eigenen Kandidaten
   *  vorschlagen dürfen. Exakte Identifier-Abfragen ersetzen ihn nicht. */
  | "lexical-fast"
  /** Zufällige scope-kompatible Memories. Eine Union kann nur labeln, was
   *  mindestens ein Retriever gefunden hat — diese Quelle ist der einzige
   *  Blick auf den GEMEINSAMEN blinden Fleck. Ohne sie misst das Set, wie gut
   *  die Retriever untereinander übereinstimmen, nicht wie gut sie sind. */
  | "random-control";

interface Candidate {
  id: string;
  title: string;
  provenance: Provenance[];
  /** Label — vom Menschen zu setzen. `null` heißt: noch offen. */
  label: null | "required" | "optional" | "irrelevant";
}

interface QuerySet {
  query: string;
  query_chars: number;
  unique_terms: number;
  candidates: Candidate[];
}

async function collectPrompts(limit: number): Promise<string[]> {
  const root = path.join(os.homedir(), ".claude", "projects");
  const found = new Set<string>();
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(root);
  } catch {
    return [];
  }
  for (const d of dirs) {
    let files: string[] = [];
    try {
      files = (await fs.readdir(path.join(root, d))).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      let raw: string;
      try {
        raw = await fs.readFile(path.join(root, d, f), "utf8");
      } catch {
        continue;
      }
      for (const line of raw.split("\n")) {
        if (!line.startsWith("{")) continue;
        let rec: { type?: string; message?: { role?: string; content?: unknown } };
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (rec.type !== "user" || rec.message?.role !== "user") continue;
        const c = rec.message.content;
        const text =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c
                  .filter((p): p is { type: string; text: string } => (p as { type?: string })?.type === "text")
                  .map((p) => p.text)
                  .join("\n")
              : "";
        if (text.includes("<recall-hints") || text.includes("<system-reminder")) continue;
        // Bewusst die ganze Breite, nicht nur lange Prompts: Der Router muss
        // gerade an der Grenze zwischen billig und teuer bewertet werden.
        if (text.length >= 40 && text.length <= 8000) found.add(text);
      }
    }
  }
  // Deterministisch und über die Längen gestreut, damit kurze exakte Suchen und
  // lange Prosa beide im Set landen.
  const sorted = [...found].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  const step = Math.max(1, Math.floor(sorted.length / limit));
  const out: string[] = [];
  for (let i = 0; i < sorted.length && out.length < limit; i += step) out.push(sorted[i]);
  return out;
}

function add(map: Map<string, Candidate>, id: string, title: string, p: Provenance): void {
  const existing = map.get(id);
  if (existing) {
    if (!existing.provenance.includes(p)) existing.provenance.push(p);
    return;
  }
  map.set(id, { id, title, provenance: [p], label: null });
}

/** Sieht der Term aus wie ein Bezeichner — Pfad, Datei, camelCase, Punktkette? */
function looksLikeIdentifier(term: string): boolean {
  if (term.length < 4) return false;
  return /[./_-]/.test(term) || /[a-z][A-Z]/.test(term) || /\d/.test(term);
}

async function main(): Promise<void> {
  const vaultRoot = (process.env.BASTRA_VAULT_PATH ?? arg("--vault", "")).replace(/^~/, os.homedir());
  if (!vaultRoot) {
    console.error("FATAL: set BASTRA_VAULT_PATH (or --vault)");
    process.exit(1);
  }
  const n = Number.parseInt(arg("--n", "20"), 10);
  const out = arg("--out", "");

  const vault = new Vault(vaultRoot);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const emb = new EmbeddingIndex(
    vault,
    new OllamaEmbeddingProvider({
      baseURL: process.env.BASTRA_OLLAMA_URL ?? "http://localhost:11434",
      model: process.env.BASTRA_EMBEDDING_MODEL ?? "embeddinggemma",
      keepAlive: "10m",
    }),
    path.join(vaultRoot, ".bastra", "embeddings.json"),
  );
  await emb.start();
  search.useEmbeddings(emb);

  const prompts = await collectPrompts(n);
  const sets: QuerySet[] = [];

  for (const q of prompts) {
    const map = new Map<string, Candidate>();
    const titleOf = (id: string): string => vault.get(id)?.fm.title ?? id;

    // 1) Was über der Einblendgrenze liegt, plus BEIDE Ränder. Der tiefe
    //    Kandidatenpool geht unter den Floor von 30 — genau dort sitzt der
    //    Kandidat, den ein anderer Modus nach oben spülen könnte, und ein Set
    //    ohne ihn kann diesen Effekt nie messen.
    let deepPool: { id: string; score: number }[] = [];
    const hybrid = await search.recallHybrid(q, {
      k: 30,
      onCandidatePool: (pool) => {
        deepPool = pool.map((h) => ({ id: h.id, score: h.score }));
      },
    });
    for (const h of hybrid) {
      if (h.score >= MUST_LOAD_SCORE) add(map, h.id, h.title, "above-inject-floor");
      else if (h.score >= RECALL_FLOOR) add(map, h.id, h.title, "below-floor");
    }
    // Der Rand UNTER 30 — im Pool, aber nie zurückgegeben. Bewusst nur die
    // NÄCHSTEN paar: Gefragt ist die Schwellenumgebung, nicht der ganze Pool.
    // Ungebremst kamen auf 12 Queries 1004 Randkandidaten zusammen, mehr als
    // hundert pro Query — ein Arbeitsblatt, das niemand labelt, ist so wertlos
    // wie gar keines.
    const nearMiss = deepPool
      .filter((c) => c.score < RECALL_FLOOR)
      .sort((a, b) => b.score - a.score)
      .slice(0, BELOW_FLOOR_MARGIN);
    for (const c of nearMiss) add(map, c.id, titleOf(c.id), "below-floor");

    // 2) Der dichte Arm für sich — er findet anderes als die Fusion zeigt.
    for (const d of await emb.search(q, 20)) add(map, d.id, titleOf(d.id), "dense-top");

    // 3) Der lexikalische Arm für sich.
    for (const b of search.recall(q, { k: 20 })) add(map, b.id, b.title, "lexical-top");

    // 4) Der schnelle Lexikpfad als eigener Modus — er soll freigegeben
    //    werden, also schlägt er selbst vor.
    for (const h of search.recall(q, { k: 20, bm25_no_fuzzy: true })) {
      add(map, h.id, h.title, "lexical-fast");
    }

    // 5) Exakte Identifier — die Klasse, die der dichte Arm nachweislich
    //    verfehlt. Ohne sie fehlt dem Set genau der Fall, für den BM25 bleibt.
    const grouped = groupQueryTerms(q, tokenizeWithIdentifiers);
    for (const term of grouped.counts.keys()) {
      if (!looksLikeIdentifier(term)) continue;
      for (const h of search.recall(term, { k: 5, bm25_no_fuzzy: true })) {
        add(map, h.id, h.title, "identifier-exact");
      }
    }

    // 6) Kontrollstichprobe: scope-kompatible Memories, die KEIN Retriever
    //    vorgeschlagen hat. Deterministisch gezogen (jedes k-te nach id), damit
    //    ein zweiter Lauf dieselbe Kontrolle zieht.
    const all = vault.list();
    const stride = Math.max(1, Math.floor(all.length / 8));
    for (let i = 0; i < all.length; i += stride) {
      const m = all[i];
      if (!map.has(m.fm.id)) add(map, m.fm.id, m.fm.title, "random-control");
    }

    sets.push({
      query: q,
      query_chars: q.length,
      unique_terms: grouped.counts.size,
      candidates: [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    });
    process.stderr.write(`  ${sets.length}/${prompts.length}: ${map.size} Kandidaten\n`);
  }

  const total = sets.reduce((s, q) => s + q.candidates.length, 0);
  const byProv = new Map<string, number>();
  for (const s of sets)
    for (const c of s.candidates)
      for (const p of c.provenance) byProv.set(p, (byProv.get(p) ?? 0) + 1);

  console.log(`\nQueries: ${sets.length}, Kandidaten gesamt: ${total}`);
  console.log("Provenienz (Mehrfachnennung pro Kandidat möglich):");
  for (const [p, c] of [...byProv.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(18)} ${String(c).padStart(5)}`);
  }
  // Exklusivität wird gegen die ARM-Quellen gerechnet, nicht gegen alle
  // Provenienzen: `below-floor` und `random-control` sagen nichts darüber aus,
  // WELCHER Retriever einen Kandidaten gefunden hat, und würden die Aussage
  // sonst verwässern, bis sie null ergibt.
  const LEX: Provenance[] = ["lexical-top", "lexical-fast", "identifier-exact"];
  const all = sets.flatMap((s) => s.candidates);
  const onlyDense = all.filter(
    (c) => c.provenance.includes("dense-top") && !LEX.some((p) => c.provenance.includes(p)),
  ).length;
  const onlyLex = all.filter(
    (c) => LEX.some((p) => c.provenance.includes(p)) && !c.provenance.includes("dense-top"),
  ).length;
  const neither = all.filter(
    (c) => !c.provenance.includes("dense-top") && !LEX.some((p) => c.provenance.includes(p)),
  ).length;
  console.log(`\nNur vom dichten Arm gefunden:      ${onlyDense}`);
  console.log(`Nur von einem lexikalischen Modus: ${onlyLex}`);
  console.log(`Von KEINEM Retriever gefunden:     ${neither}  (Randzone + Kontrolle)`);
  console.log("Die ersten beiden Zahlen kann ein Set aus den heutigen Treffern nicht enthalten;");
  console.log("die dritte ist der gemeinsame blinde Fleck, den nur die Kontrolle sichtbar macht.");
  console.log(`\nLabelaufwand: ${all.length} Kandidaten über ${sets.length} Queries (${Math.round(all.length / sets.length)} je Query).`);

  if (out) {
    await fs.writeFile(out, JSON.stringify({ created_for: "#362 Phase 0", sets }, null, 2), "utf8");
    console.log(`\nArbeitsblatt geschrieben: ${out}`);
    console.log('Labeln: jedes `label: null` auf "required" | "optional" | "irrelevant" setzen.');
  }

  search.stop();
  emb.stop();
  await vault.stop();
  process.exit(0);
}

void main();
