/**
 * Scope-Kompatibilitätsfilter für Recall-Hints — daemon-seitig, weil
 * `passesScopeFilter` den Score-Band-Kontext (mustLoadScore, anchor_strength)
 * kennen muss, den die zentrale `isScopeCompatible` (@bastra-recall/core)
 * selbst nicht trägt.
 *
 * Split aus `hook-skip.ts` (#360-Folgefund): `isScopeCompatible` lag dort
 * bis zur Zentralisierung, aber `hook-skip.ts` wird von `hook.ts` importiert
 * — dem THIN CLIENT, der bei JEDEM Tool-Call neu startet und laut eigenem
 * Kopfkommentar bewusst "stdlib + the dependency-free hook-skip/env modules
 * only" lädt. Ein Re-Export von `@bastra-recall/core/scope` aus `hook-skip.ts`
 * hätte diesen Import in JEDEN hook.ts-Start gezogen, obwohl hook.ts nur
 * `shouldSkipPath` braucht. Dieses Modul trägt den core-Import stattdessen;
 * `write-lane.ts` (das core ohnehin komplett lädt) importiert von hier.
 */
import { GLOBAL_SCOPES, isScopeCompatible } from "@bastra-recall/core/scope";

export { GLOBAL_SCOPES, isScopeCompatible };

/**
 * Scope-Filter-Entscheidung pro Hint (#148): lässt einen starken, ABSICHTLICHEN
 * Cross-Scope-Hit durch die #110-Hard-Filter, ohne den tag/topic-Noise-Fall
 * wieder zu öffnen.
 *
 * Kompatible Scopes passieren immer (`isScopeCompatible`). Ein FREMDER
 * Projekt-Scope passiert nur, wenn beides gilt:
 *   - der Hit matchte auf seinem HAND-geschriebenen `recall_when`
 *     (`matched_recall_when` — deliberate Cross-Project-Relevanz, nicht bloß
 *     thematische tag/topic-Überlappung), UND
 *   - er sitzt im REQUIRED-Band (`score ≥ mustLoadScore`).
 *
 * Warum nicht Score allein: der ursprüngliche #107-Bypass ließ jeden Hit mit
 * `score ≥ 100` durch, in der Annahme „hoher Score ≈ starker recall_when-Match".
 * Das wurde am Einführungstag widerlegt (#110) — ein bastra-io-Hint kam mit
 * Score 159 über reinen tag/topic-Overlap durch. Das echte
 * `matched_recall_when`-Signal trennt die beiden Fälle: der 159er-Noise-Hit
 * hätte es nie gesetzt, der absichtliche Cross-Scope-Treffer schon.
 */
export function passesScopeFilter(
  hit: {
    scope: string;
    score: number;
    matched_recall_when?: boolean;
    anchor_strength?: "strong" | "weak";
  },
  project: string | null,
  mustLoadScore: number,
): boolean {
  if (isScopeCompatible(hit.scope, project)) return true;
  // P0: Ein einzelnes häufiges Wort, das zufällig in einer fremden
  // Triggerphrase steht, ist keine Absichtserklärung — dafür verlangt der
  // Bypass jetzt einen TRAGFÄHIGEN Anker (zwei exakte Trigger-Terme oder einen
  // seltenen, siehe `anchorStrength` in core). Fehlt das Feld — ältere Antwort,
  // fremder Aufrufer —, bleibt es beim reinen Flag: Der Filter darf an einem
  // unbekannten Feld nicht strenger werden, als er es vorher war.
  if (hit.anchor_strength !== undefined && hit.anchor_strength !== "strong") return false;
  return hit.matched_recall_when === true && hit.score >= mustLoadScore;
}
