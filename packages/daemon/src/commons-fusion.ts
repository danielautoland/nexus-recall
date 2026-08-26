/**
 * Bastra Commons als ZWEITE RANGLISTE, nicht als zweiter Zahlenraum.
 *
 * Der Commons-Index ist BM25-only. Seine Scores sind roh und nach oben offen
 * (auf einem echten Vault sechsstellig). Die persönliche Trefferliste kommt
 * dagegen aus der RRF-Fusion und ist durch 163.934 gedeckelt. Beide Listen
 * zusammen zu sortieren hieß: der Commons-Treffer gewinnt immer, weil seine
 * Zahl größer ist — nicht, weil er besser passt. Die Dämpfung mit 0.8 änderte
 * daran nichts; 80 % eines sechsstelligen Werts ist immer noch sechsstellig.
 *
 * Also fusioniert diese Funktion, was zwischen den Listen überhaupt
 * vergleichbar ist: den RANG. Genau die Operation, mit der schon BM25- und
 * Vektor-Arm zusammenkommen (`fuseRRF` in core), nur mit einem Gewicht auf dem
 * Commons-Beitrag statt auf dem Ergebnis.
 *
 * Die Evidenz-Dämpfung (`commonsRankFactor`, 0.5–0.95) reitet auf dem
 * Rang-Beitrag mit: Ein Commons-Rezept auf Rang 1 zählt so viel wie ein
 * persönliches Memory auf Rang 1 mal seinem Vertrauensfaktor. Es kann ein
 * persönliches Memory desselben Rangs damit nie überholen — die
 * Produktentscheidung „persönliche Memories gewinnen" bleibt erhalten, und
 * zwar jetzt unabhängig von der Größe irgendwelcher Rohwerte.
 */
import { RRF_K, RRF_SCALE } from "@bastra-recall/core/rrf";
import type { RecallHit } from "@bastra-recall/core";

/**
 * @param personal  Die persönliche Trefferliste, absteigend sortiert.
 * @param commons   Die Commons-Trefferliste, absteigend sortiert.
 * @param weightFor Vertrauensgewicht pro Commons-ID (`commonsRankFactor`).
 * @returns Eine Liste in EINEM Score-Raum (RRF-Skala), absteigend sortiert.
 */
export function fuseCommonsHits(
  personal: RecallHit[],
  commons: RecallHit[],
  weightFor: (id: string) => number,
): RecallHit[] {
  const fused = new Map<string, { hit: RecallHit; raw: number }>();
  personal.forEach((hit, index) => {
    fused.set(hit.id, { hit, raw: 1 / (RRF_K + index + 1) });
  });
  commons.forEach((hit, index) => {
    const contribution = weightFor(hit.id) / (RRF_K + index + 1);
    const existing = fused.get(hit.id);
    // ID-Kollision: das persönliche Memory bleibt das ausgelieferte Objekt
    // (Scope, Body, Frontmatter), sein Rang im Commons-Index zählt aber mit —
    // zwei unabhängige Listen, die sich einig sind, ist das Signal, das RRF
    // überhaupt messen soll.
    if (existing) existing.raw += contribution;
    else fused.set(hit.id, { hit, raw: contribution });
  });
  return [...fused.values()]
    .map(({ hit, raw }) => {
      // `rrf` dekomponiert den Score in seine BM25-/Vektor-Ränge. Nach dieser
      // zweiten Fusion tut es das nicht mehr — ein Feld, das den Score
      // erklären soll und ihn nicht mehr erklärt, ist schlimmer als keines.
      const { rrf: _dropped, ...rest } = hit;
      return { ...rest, score: Math.round(raw * RRF_SCALE * 1000) / 1000 } as RecallHit;
    })
    .sort((a, b) => b.score - a.score);
}
