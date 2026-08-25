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
 *   - was heute tatsächlich eingeblendet wird (Score >= 100),
 *   - was knapp unter dem heutigen Floor liegt (der interessanteste Rand),
 *   - exakte Identifier-Treffer (die Klasse, die der dichte Arm nachweislich
 *     verfehlt: 22 von 90 im Stresstest).
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

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Woher ein Kandidat kommt. Mehrere Quellen pro Kandidat sind der Normalfall. */
type Provenance =
  | "dense-top"
  | "lexical-top"
  | "injected-today"
  | "below-floor"
  | "identifier-exact";

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

    // 1) Was heute ausgeliefert würde, plus der Rand knapp darunter.
    const hybrid = await search.recallHybrid(q, { k: 30 });
    for (const h of hybrid) {
      if (h.score >= MUST_LOAD_SCORE) add(map, h.id, h.title, "injected-today");
      else if (h.score >= RECALL_FLOOR) add(map, h.id, h.title, "below-floor");
    }

    // 2) Der dichte Arm für sich — er findet anderes als die Fusion zeigt.
    for (const d of await emb.search(q, 20)) add(map, d.id, titleOf(d.id), "dense-top");

    // 3) Der lexikalische Arm für sich.
    for (const b of search.recall(q, { k: 20 })) add(map, b.id, b.title, "lexical-top");

    // 4) Exakte Identifier — die Klasse, die der dichte Arm nachweislich
    //    verfehlt. Ohne sie fehlt dem Set genau der Fall, für den BM25 bleibt.
    const grouped = groupQueryTerms(q, tokenizeWithIdentifiers);
    for (const term of grouped.counts.keys()) {
      if (!looksLikeIdentifier(term)) continue;
      for (const h of search.recall(term, { k: 5, bm25_no_fuzzy: true })) {
        add(map, h.id, h.title, "identifier-exact");
      }
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
  const onlyDense = sets.flatMap((s) => s.candidates).filter((c) => c.provenance.length === 1 && c.provenance[0] === "dense-top").length;
  const onlyLex = sets.flatMap((s) => s.candidates).filter((c) => c.provenance.length === 1 && c.provenance[0] === "lexical-top").length;
  console.log(`\nNur vom dichten Arm vorgeschlagen:      ${onlyDense}`);
  console.log(`Nur vom lexikalischen Arm vorgeschlagen: ${onlyLex}`);
  console.log("Genau diese beiden Zahlen kann ein Set aus den heutigen Treffern nicht enthalten.");

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
