/**
 * Query-Normalizer + Identifier-erhaltender Tokenizer (#162).
 *
 * Problem: Code-Lesson-Queries tragen gepunktete/gebundene/unterstrichene
 * Identifier (`my-app.config.ts`, `chat-send`, `P2.2`, `--force-push`).
 * MiniSearchs Default-Tokenizer splittet auf jeder Punktuation — Index- wie
 * Query-seitig zerfällt `my-app.config.ts` zu `my app config ts`: lauter
 * generische Terme, die Präzision genau bei der Query-Klasse kosten, für die
 * Recall gebaut ist.
 *
 * Entscheidung: Der Index splittet Identifier heute selbst (Default-
 * Tokenizer) — ein rein query-seitiges Bewahren oder Expandieren würde also
 * nie matchen. Stattdessen wird der Tokenizer auf BEIDEN Seiten getauscht:
 * MiniSearch nutzt das top-level `tokenize` auch für Queries, solange kein
 * `searchOptions.tokenize` gesetzt ist — eine Funktion, garantierte
 * Symmetrie. `tokenizeWithIdentifiers` macht Dual-Emission: der
 * zusammenhängende Identifier UND seine Teile werden emittiert. Recall
 * bleibt damit ≥ Status quo (alle bisherigen Sub-Terme sind weiter im Index
 * und in der Query), Präzision steigt über den exakten, IDF-starken
 * Identifier-Term. Kein Migrationsproblem: der Index lebt in-memory und
 * wird bei jedem Daemon-Start aus dem Vault neu gebaut.
 *
 * `normalizeQuery` ist davon unabhängige Query-Hygiene am Recall-Entry
 * (SearchIndex.recall / recallHybrid — MCP- und Hook-Pfad laufen beide da
 * durch): Längen-Cap gegen hostile Input, Whitespace-Kollaps, dangling
 * boolean-artige Operatoren an den Rändern strippen.
 */

/** Query-Längen-Cap (hostile-input defense). */
export const QUERY_MAX_CHARS = 1000;

// MiniSearch-Default-Splitter ist /[\n\r\p{Z}\p{P}]+/u. Ein Token-Zeichen
// ist alles, was der Default NICHT splittet — plus `.`, `-`, `_` als
// Identifier-Kleber. Alles andere (Slash, Doppelpunkt, Quotes, …) trennt
// weiterhin, damit Pfade wie `src/search.ts:42` in Segmente zerfallen.
const TOKEN_RE = /(?:[._-]|[^\n\r\p{Z}\p{P}])+/gu;
const GLUE_TRIM_RE = /^[._-]+|[._-]+$/g;
const GLUE_SPLIT_RE = /[._-]+/;

/**
 * Gemeinsamer Tokenizer für Index- UND Query-Seite (Symmetrie-Invariante,
 * siehe Header). Emittiert pro Roh-Token den von Rand-Punktuation befreiten
 * Identifier als Ganzes; enthält er inneren Kleber (`.` `-` `_`), zusätzlich
 * seine Teile. Lowercasing übernimmt MiniSearchs `processTerm` — hier nicht
 * duplizieren.
 */
export function tokenizeWithIdentifiers(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.matchAll(TOKEN_RE)) {
    const token = raw[0].replace(GLUE_TRIM_RE, "");
    if (!token) continue;
    out.push(token);
    if (GLUE_SPLIT_RE.test(token)) {
      for (const part of token.split(GLUE_SPLIT_RE)) {
        if (part) out.push(part);
      }
    }
  }
  return out;
}

// Dangling boolean-artige Operatoren an den Query-Rändern. Nur
// alleinstehende Tokens — Identifier wie `--force-push` bleiben unberührt,
// ebenso Operatoren mitten in der Query.
const DANGLING_OPS = new Set([
  "and",
  "or",
  "not",
  "&&",
  "||",
  "&",
  "|",
  "+",
  "!",
  "-",
  "--",
]);

/**
 * Pure Query-Hygiene für den Recall-Entry: Cap auf QUERY_MAX_CHARS,
 * Whitespace-Kollaps, dangling Operatoren an beiden Enden strippen.
 * Idempotent; wirft nie. Identifier-Tokens bleiben byte-identisch erhalten.
 */
export function normalizeQuery(query: string): string {
  // Cap zuerst — alles Weitere arbeitet auf gedeckelter Länge.
  const capped = query.slice(0, QUERY_MAX_CHARS);
  const collapsed = capped.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const words = collapsed.split(" ");
  while (words.length > 0 && DANGLING_OPS.has(words[0].toLowerCase())) {
    words.shift();
  }
  while (words.length > 0 && DANGLING_OPS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
}
