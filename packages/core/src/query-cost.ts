/**
 * Kostenschätzung für den lexikalischen Arm (#362, Phase 2).
 *
 * Der Router muss VOR der Suche entscheiden, ob der volle BM25-Arm ins Budget
 * passt. Die naheliegende Größe — die Zeichenzahl des Prompts — ist dafür ein
 * schlechter Stellvertreter: Ein 2000-Zeichen-Stacktrace mit lauter
 * eindeutigen Pfaden ist teurer als 4000 Zeichen Fließtext, der die Hälfte
 * seiner Wörter wiederholt. Gemessen an genau diesem Fall: derselbe Prompt hat
 * 502 emittierte, aber nur 25 eindeutige Terme — die Kosten folgen der zweiten
 * Zahl.
 *
 * Was hier geschätzt wird, ist deshalb die Zahl der EINDEUTIGEN Terme nach der
 * Gruppierung, multipliziert mit dem gemessenen Preis pro Term. Die Bänder aus
 * #362, umgerechnet auf den gruppierten Arm (30 echte Prompts, 991 Memories):
 *
 * ```
 * eindeutige Terme (Median)   25    613
 * bm25_search_ms              43    461
 * ```
 *
 * Das sind ~0,75 ms pro eindeutigem Term, mit einem kleinen Sockel. Bewusst
 * eine gerade Linie und kein gelerntes Modell: Die Schätzung entscheidet, ob
 * ein Budget reicht, nicht wie ein Ranking aussieht. Sie darf grob sein, sie
 * darf sich irren — sie muss nur monoton in der Größe sein, die die Kosten
 * wirklich treibt, und sie muss ohne Suche auskommen.
 *
 * Kalibriert wird sie über die Telemetrie: `recall_stages.terms_unique` gegen
 * `recall_stages.bm25_search_ms` derselben Events. Weichen die Werte auf einer
 * anderen Maschine systematisch ab, gehören die beiden Konstanten angepasst —
 * dafür stehen sie hier einzeln und benannt.
 */

/** Sockel je Aufruf (Tokenisierung, Aufbau, Sortierung) in ms. */
export const BM25_COST_BASE_MS = 8;

/** Grenzkosten je EINDEUTIGEM Query-Term in ms, auf dem gruppierten Arm. */
export const BM25_COST_PER_UNIQUE_TERM_MS = 0.75;

/**
 * Geschätzte Laufzeit des vollen lexikalischen Arms in ms.
 *
 * `uniqueTerms` kommt aus `groupQueryTerms()` — die Gruppierung läuft ohnehin
 * vor jeder Suche, die Zahl ist also kostenlos zu haben und beschreibt exakt
 * die Arbeit, die danach ansteht.
 */
export function estimateBm25Ms(uniqueTerms: number): number {
  return BM25_COST_BASE_MS + uniqueTerms * BM25_COST_PER_UNIQUE_TERM_MS;
}

/**
 * Passt der volle lexikalische Arm in das Budget, das nach dem dichten Arm
 * übrig bleibt?
 *
 * `budgetMs` ist das Gesamtbudget der Lane, `denseReservedMs` das, was der
 * dichte Arm davon braucht. Beide Arme laufen nebenläufig, aber der
 * lexikalische blockiert den Event Loop — der dichte kann seine Antwort also
 * erst verarbeiten, wenn BM25 fertig ist. Solange das so ist, addieren sich
 * die Zeiten praktisch, und die Reserve ist keine Vorsicht, sondern Arithmetik.
 */
export function lexicalFitsBudget(
  uniqueTerms: number,
  budgetMs: number,
  denseReservedMs: number,
): boolean {
  if (budgetMs <= 0) return true; // kein Budget gesetzt = keine Beschränkung
  return estimateBm25Ms(uniqueTerms) <= budgetMs - denseReservedMs;
}
