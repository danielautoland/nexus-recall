# Claude-Code-Übergabe: Recall-Performance, Suchmodi und BM25-Beschleunigung

**Stand:** 25. August 2026  
**Status:** Recherche, Gegenmessung und Incident-Analyse; keine Produktionsänderung  
**Relevanter Produktionscode:** [`packages/core/src/search.ts`](../packages/core/src/search.ts)  
**Vorhandenes Messwerkzeug:** `npm run bm25-expansion --workspace @bastra-recall/eval`

> **Aktualisierung nach Gegenprüfung:** Die Termgruppierung ist nur dann
> rangneutral, wenn nach MiniSearchs `processTerm` gruppiert wird. Eine
> Gruppierung direkt nach `tokenizeWithIdentifiers` ist **nicht** rangneutral.
> Beide Varianten wurden am 25.08.2026 auf demselben 989-Memory-/30-Prompt-
> Aufbau gegeneinander gemessen; der exakte Code und die Ergebnisse stehen in
> Abschnitt 4.5. Zusätzlich dokumentiert Abschnitt 4.6 einen bestätigten
> Produktions-Incident mit unfused BM25-Scores bis in den Millionenbereich und
> einen falschen `matched_recall_when`-Anker.

## 1. Auftrag und Randbedingungen

Bastra Recall durchsucht bei Prompts und Tool-Aufrufen einen lokalen Vault aus derzeit rund 989 Markdown-Memories. Die Suche besteht aus einem lexikalischen MiniSearch/BM25-Arm und optional einem dichten Arm über ein lokales Ollama-Embedding-Modell. Beide Ranglisten werden per Reciprocal Rank Fusion (RRF) zusammengeführt.

Das Ziel ist eine belastbare Recall-Latenz von ungefähr 200 ms pro Aufruf. Lange Prompts liegen heute bei rund 1.100 bis 1.300 ms. Timeouts sind besonders gefährlich, weil sie keinen sichtbaren Fehler erzeugen, sondern schlicht keine Erinnerung liefern.

Zwingende Produktanforderungen:

- BM25 darf nicht vollständig entfernt werden. Viele Nutzer können oder wollen kein zusätzliches Embedding-Modell laden.
- Exakte Code-Bezeichner, Dateinamen, Pfade und Funktionsnamen sind ein wichtiger Suchfall.
- Ein optionaler dichter Arm darf schnelle Rechner verbessern, darf aber nicht Voraussetzung für Recall sein.
- Änderungen müssen gegen echte Prompts und den echten Vault geprüft werden. Die derzeit ausgelieferten Treffer sind als Regressionstest nützlich, aber nicht automatisch die Wahrheit über Relevanz.
- Diese Übergabe empfiehlt Änderungen, implementiert sie aber nicht.

## 2. Kurzfazit

Die klare Antwort lautet:

1. **Vor jeder Performancearbeit steht jetzt ein P0-Korrektheitsfix.** Beim Hook-Timeout fällt `recallHybrid()` auf rohe, unbeschränkte BM25-Scores zurück. `/hook/recall` kennzeichnet sie korrekt als `unfused`, aber die Prompt-Lane verwirft dieses Signal, wendet trotzdem die RRF-Grenzen 50/100 an und präsentiert sechsstellige BM25-Werte als REQUIRED. Ein zweiter Fehler lässt Fuzzy-Terme als absichtliche `recall_when`-Anker gelten.
2. **Mit dem heutigen Verhalten „jeden der ungefähr 1.000 Query-Terme exakt, als Präfix und fuzzy über sieben Felder suchen“ sind 200 ms auf einem einzelnen JavaScript-Thread nicht realistisch.** Ein Worker macht den Daemon reaktionsfähig und ermöglicht echte Überlappung mit Ollama, verkürzt aber die BM25-Rechenarbeit selbst nicht.
3. **BM25 muss trotzdem bleiben.** Bei langen Prompts ist der dichte Arm sehr stark. Bei kurzen exakten Identifier-Suchen gibt es dagegen eine nachgemessene Klasse von Treffern, die der dichte Arm verpasst.
4. **Der beste rangneutrale Performancehebel ist präzise definiert:** doppelte, bereits durch `processTerm` normalisierte Query-Terme einmal suchen und ihre Häufigkeit über MiniSearchs `boostTerm` erhalten. Im aktuellen Gegenlauf sank p50 von 1.237 auf 493 ms und p90 von 1.692 auf 719 ms; alle 30 vollständigen Ranglisten blieben identisch. Gruppierung vor `processTerm` ist dagegen nicht neutral.
5. **Der Weg zu 200 ms ist danach ein kostenabhängiger Suchrouter:**
   - kurze oder billige Queries: voller BM25-Arm, optional hybrid;
   - lange Queries mit Ollama: dichter Arm plus sehr billige exakte Identifier-Rettung;
   - lange Queries ohne Ollama: deduplizierter Exact/Prefix-BM25-Pass, Fuzzy nur gezielt oder als billiger Fallback für kurze/OOV-Terme;
   - Provider-Ausfall: immer ein sichtbarer, ehrlicher BM25-Fallback, niemals still „keine Erinnerung“.
6. **Der Score-Schwellwert ist ein eigener Konstruktionsfehler und inzwischen als Incident sichtbar.** RRF ist eine Ordnungsfunktion, keine kalibrierte Relevanzwahrscheinlichkeit. Ein hybrider RRF-Score, ein einarmiger Vector-Rang und ein roher BM25-Score dürfen nicht durch eine nackte `score`-Zahl auf dieselbe scheinbare Skala gezwungen werden. Retrieval und Einblendentscheidung müssen getrennt werden.

Mit dieser Architektur erscheint ein warmer p50-Wert um 200 ms plausibel. Eine harte 200-ms-Garantie oder p99 unter 200 ms ist mit einem dichten Arm, dessen Median allein 175 ms beträgt, nicht plausibel. Das SLO muss deshalb explizit als p50, p90 oder Deadline definiert werden.

## 3. Ist-Zustand im Repository

### 3.1 Lexikalischer Arm

`SearchIndex` baut einen In-Memory-Index mit MiniSearch 7.2.0 auf. Gesucht werden sieben Felder:

| Feld | Gewicht |
|---|---:|
| `recall_when_flat` | 5 |
| `title` | 4 |
| `tags_flat` | 3 |
| `recall_when_expanded_flat` | 2 |
| `topic_path_flat` | 2 |
| `summary` | 2 |
| `body` | 1 |

Globale Suchoptionen:

- `combineWith: "OR"`
- `prefix: true`
- `fuzzy: 0.2`

Der eigene Tokenizer emittiert Identifier sowohl als Ganzes als auch zerlegt. `my-app.config.ts` produziert beispielsweise den vollständigen Identifier und zusätzlich `my`, `app`, `config`, `ts`. Das ist für exakte Codesuche wertvoll, erhöht bei langen Prompts aber die Zahl der Expansionen.

`normalizeQuery()` kappt erst bei 8.000 Zeichen. Der Cap ist als Schutz gegen feindliche Eingaben gedacht und ausdrücklich kein Relevanz-Knopf.

### 3.2 Dichter Arm

Der dichte Arm erzeugt ein Query-Embedding über Ollama/EmbeddingGemma und vergleicht es per Cosinus mit den gespeicherten Vektoren. Der Memory-Embeddingtext enthält Titel, Tags, `recall_when`, Summary und die ersten 4.000 Zeichen des Bodys.

Der Arm hat eine eigene Deadline von 150 ms. Beim Überschreiten wird sein Ergebnis für diesen Aufruf aufgegeben; die eigentliche Anfrage darf im Hintergrund fertiglaufen, damit ein kaltes Modell warm werden kann.

EmbeddingGemma hat offiziell ein Kontextfenster von 2.048 Tokens. Ollamas Embed-Endpunkt schneidet zu lange Eingaben standardmäßig auf das Kontextfenster zu. Bei langen, codehaltigen Prompts ist deshalb zu prüfen, wie viele Tokens tatsächlich verarbeitet werden und ob wichtige Identifier am Ende abgeschnitten werden. [Google EmbeddingGemma](https://ai.google.dev/gemma/docs/embeddinggemma), [Ollama Embed API](https://docs.ollama.com/api/embed)

### 3.3 Nebenläufigkeit

Der dichte Promise wird vor MiniSearch gestartet. MiniSearch läuft danach synchron im Node-Hauptthread. Dadurch kann der Event Loop während BM25 weder Netzwerkfortschritt noch Timer und Promise-Fortsetzungen normal abarbeiten. Die beiden Arme sind logisch nebenläufig, aber der CPU-Arm verhindert echte Nebenläufigkeit im Daemon.

### 3.4 RRF und Schwellen

Aktuell gilt:

```text
RRF_K = 5
RRF_SCALE = 5000 × (RRF_K + 1) / 61 = 491,803...
Beitrag eines Arms auf Rang r = RRF_SCALE / (RRF_K + r)
```

Folgen:

- einarmig Rang 1: maximal 81,967 Punkte;
- beide Arme Rang 1: maximal 163,934 Punkte;
- die `required`-Schwelle 100 ist mit nur einem RRF-Arm unerreichbar;
- bei zwei Armen bestehen ungefähr noch folgende Grenzpaare: `(1,22)`, `(2,11)`, `(3,7)`, `(4,5)`; selbst `(5,5)` liegt bereits unter 100.

Die Prompt-Lane verwendet für generische Prompts 100 und für erkannte Retrieval-Prompts 50. Andere Lanes verwenden ebenfalls absolute Grenzen aus dem Bereich 30/50/100. Der rohe BM25-Fallback liegt wiederum auf einer anderen Skala. Der Zahlenwert `score` bedeutet damit je nach Betriebsart nicht dasselbe.

## 4. Vorliegende Messungen

### 4.1 Produktionsmessung langer Prompts

30 echte Prompts, 2.000 bis 8.000 Zeichen, Median 7.407, echter Vault und vollständiger Produktionspfad:

| Messgröße | Ergebnis |
|---|---:|
| Lexikalischer Arm p50 | 1.137 ms |
| Lexikalischer Arm p90 | 1.621 ms |
| Gesamtaufruf p50 | 1.327 ms |
| Dichter Arm | 124–153 ms, an der Deadline |
| Rauschgrenze | ca. 3 % |
| Kontrolllauf | 30/30 identische Ergebnisse |

Historische Skalierung des lexikalischen Arms:

| Terme, Median | 4 | 41 | 147 | 1.001 | 2.403 |
|---|---:|---:|---:|---:|---:|
| BM25 in ms | 9 | 84 | 178 | 454 | 741 |

Das Kostenwachstum folgt primär der Zahl der emittierten Terme und ihrer Prefix/Fuzzy-Expansion, nicht der kleinen Dokumentzahl von knapp 1.000.

### 4.2 Bereits verworfene Varianten

**Query-Cap auf seltene Terme:** Bei 200 Zeichen gingen auf 15 von 15 Testqueries injizierbare Treffer verloren, im Mittel 2,27. Selbst bei 2.000 Zeichen verloren 12 von 15 Queries Treffer.

**Fuzzy nur für seltene Terme:** isoliert schnell, im Produktionspfad deutlich schwächer. Sobald die Schwelle genug Arbeit sparte, kippte mindestens ein injizierbarer Treffer.

Diese Varianten scheiterten nicht zwingend daran, dass relevante Dokumente komplett aus der Kandidatenmenge verschwanden. Schon eine BM25-Rangpermutation verändert den diskreten RRF-Score und lässt Kandidaten an der absoluten Schwelle 100 umkippen.

### 4.3 Dense-only-Nachmessung für lange Prompts

20 echte Prompts, 2.000 bis 8.000 Zeichen, Median 7.581, 989 Memories:

| Modus | Median |
|---|---:|
| heutiger Hybridpfad | 1.297 ms |
| nur dichter Arm | 175 ms |

Von den 42 Treffern, die die Produktion mit `score >= 100` tatsächlich einblendete:

- 39 lagen im reinen Vektor-Ranking auf Rang 1–5;
- alle 42 lagen auf Rang 1–20;
- Median-Rang war 2;
- keiner fehlte in den Top 100.

Das ist ein starkes Signal dafür, dass bei langen Prompts der dichte Arm die heute ausgelieferten Treffer trägt. Es ist aber **kein vollständiger Recall-Beweis**: Ein Treffer mit `score >= 100` muss konstruktionsbedingt Beiträge aus beiden Armen haben und damit ohnehin im Vektor-Pool liegen. BM25-only-Kandidaten können die 100 nie erreichen und kommen deshalb gar nicht in die 42 positiven Beispiele. Die Auswertung ist als Produktionsregression nützlich, aber zirkulär als Goldstandard.

### 4.4 Kurze Identifier-Suchen: der Grund, BM25 zu behalten

Zwei ergänzende, nur lesende Auswertungen wurden durchgeführt.

**50 reale kurze Prompts mit Identifiern, Median 106 Zeichen:**

- Bei der hohen hybriden Schwelle 100 gab es 36 Treffer über 21 Queries.
- 31 lagen vectorseitig auf Rang 1–5, vier auf Rang 6–20 und einer auf Rang 21–100.
- Auch dieses Ergebnis ist durch die hybride Auswahl teilweise zirkulär.

**Nicht-zirkulärer Stress-Test mit bekanntem Ziel-Memory:**

90 eindeutige Bezeichner wurden aus echten Memories gewählt, deren Ziel im BM25-Ranking auf Rang 1–5 lag: 30 Dateinamen, 30 Funktionsnamen, 30 zusammengesetzte Identifier.

| Queryklasse | Vector Top 5 | Vector Top 20 | Vector Top 100 | fehlt Top 100 |
|---|---:|---:|---:|---:|
| insgesamt, n=90 | 38 | 55 | 68 | 22 |
| Dateinamen, n=30 | 16 | 22 | 25 | 5 |
| Funktionsnamen, n=30 | 11 | 17 | 20 | 10 |
| zusammengesetzte Identifier, n=30 | 11 | 16 | 23 | 7 |

89 der 90 Bezeichner waren im gebauten Memory-Embeddingtext sichtbar. 21 der 22 Vector-Fehlschläge waren ebenfalls sichtbar. Die Ausfälle lassen sich also nicht einfach mit dem 4.000-Zeichen-Body-Cap erklären.

Der Stress-Test ist absichtlich auf lexikalisch starke Fälle angereichert und schätzt nicht deren Häufigkeit im echten Verkehr. Er beweist aber, dass diese wichtige Fehlerklasse existiert. **BM25 ganz zu entfernen wäre sachlich falsch.**

### 4.5 Kostenzerlegung auf dem aktuellen Vault

30 echte lange Prompts, aktueller Vault mit 989 Memories. Eine Gegenmessung
hat einen wichtigen Unterschied zwischen zwei scheinbar gleichen
Gruppierungsvarianten offengelegt:

| Variante | p50 | p90 | Menge | Rang 1 | Top-5-Menge | Top-5-Reihenfolge | volle Reihenfolge | größte Score-Differenz |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| MiniSearch unverändert | 1.237 ms | 1.692 ms | Referenz | Referenz | Referenz | Referenz | Referenz | 0 |
| nach **Roh-Tokenizer** gruppiert | 531 ms | 713 ms | 30/30 | 29/30 | 11/30 | 4/30 | 0/30 | 2,553 × 10⁶ |
| nach **`processTerm`** gruppiert | 493 ms | 719 ms | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 | 1,49 × 10⁻⁸ |

Die ursprüngliche Messung der korrekt verarbeiteten Variante lag bei p50
467 ms und p90 698 ms. Der Gegenlauf bestätigt Größenordnung, Faktor und
Rangneutralität. Die abweichende Rückmeldung mit p50 500 ms und 0/30
identischen Vollrankings wurde ebenfalls exakt reproduziert: Sie gruppierte
vor MiniSearchs `processTerm`.

Warum das passiert:

1. `tokenizeWithIdentifiers()` erhält Groß-/Kleinschreibung. `AND` und `and`
   sind dort verschiedene Rohterme.
2. MiniSearchs Default-`processTerm` lowercaset anschließend beide zu `and`.
3. Werden vorher Rohhäufigkeiten gebildet, können mehrere vermeintlich
   eindeutige Terme nachträglich kollabieren. `boostTerm` wird dann mit einer
   Häufigkeit aus dem falschen Key-Raum aufgerufen. Das über- oder untergewichtet
   einzelne Terme massiv.
4. MiniSearch addiert den BM25-Beitrag jeder Query-Term-Instanz, multipliziert
   am Ende aber mit der Zahl der **unterschiedlichen verarbeiteten gematchten
   Query-Terme**. Nach `processTerm` gruppiert ist `ein Term n-mal` daher unter
   den heutigen Optionen algebraisch gleich `ein Term einmal mit boostTerm n`.

Der rangneutrale Kern muss sinngemäß so aussehen:

```ts
const processedTerms = tokenizeWithIdentifiers(query)
  // Exakt dieselbe processTerm-Funktion verwenden wie der Index.
  // Heute ist das MiniSearchs Default: term.toLowerCase().
  .map((term) => term.toLowerCase());

const frequency = new Map<string, number>();
for (const term of processedTerms) {
  frequency.set(term, (frequency.get(term) ?? 0) + 1);
}
const uniqueTerms = [...frequency.keys()];

const hits = mini.search(uniqueTerms.join(" "), {
  // Die Terme sind bereits tokenisiert und verarbeitet: kein zweiter
  // Identifier-Split und kein zweites processTerm.
  tokenize: (text) => text.split(" "),
  processTerm: (term) => term,
  boostTerm: (term) => frequency.get(term) ?? 1,
});
```

Robuster als das fest codierte Lowercasing wäre, die exakt konfigurierte
`processTerm`-Funktion gemeinsam für Index und Query-Gruppierung zu besitzen.
Wenn `processTerm` Arrays zurückgeben kann, müssen diese vor dem Zählen genauso
geflattet und leere Ergebnisse genauso verworfen werden wie MiniSearch es tut.
Auch zukünftige `fuzzy`-/`prefix`-Funktionen dürfen für Rangneutralität nicht
vom Termindex oder von der ungruppierten `terms[]`-Länge abhängen.

Weitere isolierte Kostenmessungen aus dem vorherigen Lauf:

| Variante | p50 | p90 | Rangverhalten |
|---|---:|---:|---|
| nur exact, ungruppiert | 106 ms | 139 ms | verändert |
| exact + prefix, ungruppiert | 600 ms | 1.194 ms | verändert |
| nur exact, korrekt gruppiert | 38 ms | 49 ms | verändert gegenüber Full-Fuzzy |
| exact + prefix, korrekt gruppiert | 140 ms | 194 ms | verändert gegenüber Full-Fuzzy |
| korrekt gruppiert plus Expansion-Cache | 419 ms | 631 ms | damals rangidentisch, aber hoher Cache-Wuchs |

Zusätzliche Beobachtungen:

- Median emittierte Terme: 1.186.
- Median eindeutige **Rohterme**: 649; nach `processTerm`: 613. Für die
  rangneutrale Gruppierung zählt ausschließlich die zweite Zahl.
- Der Index enthält ungefähr 65.475 Vokabularterme.
- Vault-Laden dauerte in der Messung ungefähr 132 ms, MiniSearch-Indexaufbau ungefähr 539 ms.
- Grobe RSS-Zunahme: Vault ca. 49 MiB, MiniSearch-Index zusätzlich ca. 152 MiB. Der exakte Wert hängt vom Node-Prozess und GC ab.
- Der Expansion-Cache brachte nach der Gruppierung nur rund weitere 10 %. Lange echte Prompts teilen zu wenige seltene Terme, während der Cache auf ungefähr 9.000 Prefix- und 9.000 Fuzzy-Einträge anwuchs.

Die zentrale Diagnose ist damit messbar: **Nach dem korrekt normalisierten
Entfernen doppelter Arbeit sind Fuzzy-Expansionen der größte Restposten; Prefix
ist ebenfalls teuer. Das eigentliche BM25-Scoring über knapp 1.000 Dokumente
ist nicht das Hauptproblem.**

### 4.6 Bestätigter Produktions-Incident: Score-Space-Leak im Prompt-Hook

Die Telemetrie vom 25.08.2026 belegt für dieselbe Session und denselben
Top-Treffer zwei verschiedene Score-Räume:

| Pfad | Top-Score | BM25-Stage | Vector-Stage | Zustand |
|---|---:|---:|---:|---|
| `UserPromptSubmit` | 405.584,777 | 395 ms | 396 ms | `vector-arm-timeout` |
| MCP-Forwarder, gleiche Query | 81,967 | 275 ms | 359 ms | RRF lief, nicht degraded |

Die Hook-Deadline für den Vector-Arm beträgt 150 ms, die MCP-Deadline 1.500
ms. Der synchrone BM25-Pass blockiert den Event Loop so lange, dass der Hook
den Vector-Arm verliert. `recallHybrid()` fällt dann absichtlich auf den rohen
BM25-Pfad zurück. Der Wert 405.584 ist deshalb kein doppelt skalierter RRF-Wert,
sondern ein gültiger, aber unbeschränkter MiniSearch-Score aus einem **anderen
Score-Raum**. Der scheinbare Faktor von ungefähr 4.900 ist nicht konstant; auch
die vollständige Rangfolge unterscheidet sich. Nicht teilen, nicht bei 164
abschneiden.

Der Recall-Endpunkt erkennt das bereits und liefert `unfused: true` sowie
`degraded: "vector-arm-timeout"`. Die Prompt-Lane besitzt diese Felder aber
nicht in ihrem Response-Typ und ignoriert sie. Danach passieren vier sachlich
falsche Schritte:

1. rohe BM25-Werte werden mit den hybriden Floors 50/100 gefiltert;
2. `score >= 100` wird als REQUIRED gelesen;
3. REQUIRED umgeht den Backoff;
4. der Text behauptet, beide Suchpfade hätten zugestimmt.

Das ist nicht nur schlechte Formulierung, sondern verändert Auslieferung und
Unterdrückung. In derselben Tagesdatei stehen weitere Hook-Fallbacks mit
Top-Scores bis 2,77 Millionen. Ein kurzer Hook kann ebenfalls degraden; lange
oder expansionsreiche Queries erhöhen aber Wahrscheinlichkeit und Magnitude.
Die Incident-Query hatte 1.532 Zeichen und zeigt damit erneut, warum ein Router
nicht nur Zeichen zählen darf.

Relevante Stellen:

- Hook-Deadline: [`packages/daemon/src/http-hook-routes.ts`](../packages/daemon/src/http-hook-routes.ts)
- MCP-Deadline: [`packages/daemon/src/mcp-forwarder.ts`](../packages/daemon/src/mcp-forwarder.ts)
- roher BM25-Fallback: [`packages/core/src/search.ts`](../packages/core/src/search.ts)
- verlorene Response-Felder/Floors: [`packages/daemon/src/prompt-lane.ts`](../packages/daemon/src/prompt-lane.ts)

### 4.7 Bestätigter Qualitätsfehler: `matched_recall_when` ist fuzzy

`matched_recall_when` bedeutet heute nicht, dass eine authored Triggerphrase
exakt gepasst hat. Die Funktion prüft lediglich, ob irgendein von MiniSearch
gemeldeter Dokumentterm im Feld `recall_when_flat` lag. MiniSearchs `match`-Map
enthält jedoch auch Prefix- und Fuzzy-Treffer und ist nach dem abgeleiteten
**Dokumentterm**, nicht zwingend nach dem ursprünglichen Queryterm indiziert.

Der konkrete Incident enthält ein fast beweisendes Minimalmuster:

- Die fremde Query enthielt das eigenständige Wort `and`, aber nicht `sand`.
- Das themenfremde Memory enthält `Sand` in `recall_when`.
- `and` → `sand` hat Levenshtein-Distanz 1.
- MiniSearch erlaubt bei drei Zeichen und `fuzzy: 0.2` genau einen Edit.
- Der resultierende Match im `recall_when`-Feld setzt den Flag auf `true`.

Damit kann ein gewöhnliches englisches `and` als absichtlicher Sand-Theme-
Trigger erscheinen. Das ist aus zwei Gründen sicherheitsrelevant:

1. `weak_result` wird für die **gesamte Trefferliste** unterdrückt, sobald ein
   Hit `matched_recall_when` oder einen toleranten Titelanker meldet.
2. Der Cross-Scope-Filter lässt einen fremden REQUIRED-Hit durch, wenn genau
   dieser Flag wahr ist. Zusammen mit einem sechsstelligen unfused BM25-Score
   greifen beide Fehler ineinander.

Ein „deliberate anchor“ muss getrennte Provenienz tragen. Mindestens darf ein
Fuzzy-/Prefix-Match ihn nicht allein setzen. Für einen Cross-Scope-Bypass ist
eine stärkere Regel ratsam: exakter seltener Identifier oder mindestens zwei
signifikante exakte Tokens aus derselben authored `recall_when`-Phrase.
`weak_result` sollte zudem pro Treffer belegbare Anchor-Arten sehen, statt von
einem booleschen Flag eines beliebigen Listenmitglieds abzuhängen.

### 4.8 Verdacht gegen Commit `0180698` widerlegt

Der zeitlich nahe Commit `0180698` ist für beide Incidents nicht ursächlich:

- `matchedRecallWhen()` stammt aus Commit `201c857` vom 30.06.2026.
- Der rohe BM25-Fallback und die unbeschränkte Skala existierten vorher.
- Die Hook-Vector-Deadline stammt vom 17.08.2026.
- `0180698` ergänzt nur `bm25_fuzzy_rare_df_max`; der Knopf ist default-off.
- Hook und MCP übergeben diese Option nicht. `bm25SearchOptions()` liefert
  deshalb `undefined`, also das Verhalten vor dem Commit.

Ein Revert von `0180698` würde die beobachteten Fehler nicht beheben.

## 5. Was die Primärquellen dazu sagen

### 5.1 MiniSearch

MiniSearch hält den Index in einer `SearchableMap`, einer Radix-Tree-Struktur. Prefix-Suche läuft über `atPrefix`, Fuzzy-Suche über `fuzzyGet`; dabei wird eine Levenshtein-Matrix während eines Tiefenscans durch den Radix Tree fortgeschrieben. Das passt exakt zum gemessenen Kostenbild: Jeder Query-Term stößt eigene Wörterbucharbeit an. [MiniSearch Design Document](https://github.com/lucaong/minisearch/blob/master/DESIGN_DOCUMENT.md)

MiniSearch erlaubt `prefix`, `fuzzy` und `boostTerm` als Funktionen pro Query-Term. Der Default für `maxFuzzy` ist 6; die Dokumentation warnt ausdrücklich, dass hohe Distanzen die Performance stark belasten können. Bei `fuzzy: 0.2` wächst die erlaubte Edit-Distanz mit der Termlänge bis zu diesem Cap. [MiniSearch-Quellcode](https://github.com/lucaong/minisearch/blob/master/src/MiniSearch.ts)

Das stützt zwei Empfehlungen und eine harte Vorbedingung:

1. Identische **verarbeitete** Query-Terme algebraisch zusammenzufassen ist
   ein rangneutraler Hebel. Rohterme vor `processTerm` zu gruppieren ist es
   nachweislich nicht.
2. Die Äquivalenz beruht auf MiniSearchs heutiger Formel: linearer
   Termbeitrag plus Qualitätsfaktor aus unterschiedlichen gematchten
   verarbeiteten Query-Termen. Jede Änderung an `processTerm`, `combineWith`
   oder index-/listenabhängigen Prefix-/Fuzzy-Funktionen muss den Paritätstest
   erneut bestehen.
3. Fuzzy über jeden Term eines langen Prompts ist strukturell teuer. Ein kleineres `maxFuzzy`, eine nicht-fuzzy Prefix-Länge oder termabhängiges Fuzzy kann viel sparen, verändert aber Kandidaten und Ränge und muss deshalb als Retrievaländerung evaluiert werden.

MiniSearch hat Fuzzy-Performance in früheren Versionen bereits wesentlich verbessert. Da das Projekt schon Version 7.2.0 verwendet, ist ein reines Bibliotheksupdate nicht als siebenfacher Gewinn zu erwarten. [MiniSearch Changelog](https://github.com/lucaong/minisearch/blob/master/CHANGELOG.md)

### 5.2 Worker Threads

Node empfiehlt Worker Threads ausdrücklich für CPU-intensive JavaScript-Arbeit. `ArrayBuffer` kann übertragen und `SharedArrayBuffer` geteilt werden. Ein MiniSearch-Index aus Maps und Objektgraphen wird dadurch jedoch nicht automatisch geteilter Speicher. [Node.js `worker_threads`](https://nodejs.org/api/worker_threads.html)

Praktische Folge:

- Ein Worker beseitigt Event-Loop-Blockaden und lässt den Ollama-I/O tatsächlich überlappen.
- Ein Worker macht aus 1.100 ms CPU-Arbeit nicht 200 ms; die Wanduhr nähert sich nur `max(BM25, Dense)` statt der Summe.
- Mehrere Worker können Query-Terme sharden, benötigen mit dem heutigen Index aber wahrscheinlich je eine Indexkopie. Vier Kopien lägen in der groben Messung bei rund 600 MiB nur für MiniSearch, zuzüglich Worker-Heaps, Vault und Ollama. Das ist gerade für schwache Rechner unattraktiv.
- Ein synchron laufender Workerauftrag lässt sich nicht sauber mitten in MiniSearch abbrechen. Das System braucht eine begrenzte Queue und muss verspätete Ergebnisse verwerfen; Worker-Terminierung als Timeout würde den Index verlieren und einen teuren Neuaufbau erzwingen.

### 5.3 Native Volltextindizes

**SQLite FTS5** bietet nativen BM25, Feldgewichte und optionale Prefix-Indizes. Prefix-Indizes tauschen zusätzlichen Speicher und Indexierungsarbeit gegen schnellere Prefix-Abfragen. Sein BM25 ist aber fest mit `k1=1.2`, `b=0.75` definiert, und FTS5 besitzt keine drop-in-äquivalente allgemeine Levenshtein-Fuzzy-Suche wie MiniSearch. Die Rangfolge wäre deshalb eine Produktänderung. [SQLite FTS5](https://www.sqlite.org/fts5.html)

**Tantivy** bietet nativen BM25, Boolean Queries, Feld-Boosts sowie Fuzzy- und Fuzzy-Prefix-Termqueries. Es ist auf Top-K-Suche, segmentierte Indizes und parallele Ausführung ausgelegt. Das macht Tantivy zum stärksten Kandidaten für einen lokalen Bake-off, aber nicht zum rangidentischen Austausch: Tokenisierung, Fuzzy-Semantik, BM25-Details und Query-Kombination müssen nachgebaut beziehungsweise neu kalibriert werden. Dazu kommen Rust-/N-API- oder Sidecar-Packaging für alle Plattformen. [Tantivy Queries](https://docs.rs/tantivy/latest/tantivy/query/index.html), [Tantivy FuzzyTermQuery](https://docs.rs/tantivy/latest/tantivy/query/struct.FuzzyTermQuery.html), [Tantivy QueryParser](https://docs.rs/tantivy/latest/tantivy/query/struct.QueryParser.html), [Tantivy Architecture](https://github.com/quickwit-oss/tantivy/blob/main/ARCHITECTURE.md)

Lucenes ausgereifte `FuzzyQuery` begrenzt Edit-Distanzen auf höchstens zwei und warnt, dass höhere Distanzen einen großen Teil des Termwörterbuchs matchen. Außerdem kann sie eine exakte gemeinsame Prefix-Länge und eine maximale Zahl von Expansionen verlangen. Das ist kein Beweis, dass Bastra dieselben Werte verwenden soll, aber ein starkes Indiz, dass bis zu sechs Edits für alle langen Terme eine aggressive Einstellung ist. [Apache Lucene FuzzyQuery](https://lucene.apache.org/core/7_7_3/core/org/apache/lucene/search/FuzzyQuery.html)

### 5.4 Andere Beschleuniger

**SymSpell** berechnet Delete-Varianten im Voraus und reduziert damit die Zahl teurer Wörterbuchvergleiche. Der Preis ist zusätzlicher Speicher, Indexaufbau und eine andere Kandidaten-/Distanzsemantik. Es ist ein möglicher Fuzzy-Kandidatengenerator, aber nur dann rangneutral, wenn die resultierende Termmenge und ihre Distanzen gegen MiniSearch vollständig äquivalent nachgewiesen werden. [SymSpell](https://github.com/wolfgarbe/SymSpell)

**Block-Max WAND** kann Top-K-Auswertung mit beweisbar sicherem Pruning beschleunigen. Das ist für große Postinglisten wertvoll. Bei Bastra zeigen die Messungen jedoch, dass Exact-Scoring nur 38–49 ms kostet und die hunderten Millisekunden vorher in Prefix/Fuzzy-Termexpansion entstehen. WAND wäre deshalb nicht der erste Hebel. [Block-Max WAND, SIGIR 2017](https://doi.org/10.1145/3077136.3080780)

## 6. Empfohlene Zielarchitektur

### 6.1 Nicht nach Zeichenlänge allein umschalten

Zeichenlänge korreliert mit Kosten, ist aber nur ein grober Proxy. Ein 2.000-Zeichen-Stacktrace mit vielen eindeutigen Pfaden kann teurer sein als 4.000 Zeichen Fließtext mit vielen Wiederholungen. Der Router sollte mindestens folgende billige Merkmale verwenden:

- emittierte und eindeutige Termzahl;
- Anteil von Identifiern, Pfaden, Dateiendungen, Hashes und quoted literals;
- Anteil OOV-Terme beziehungsweise sehr seltener Terme;
- mittlere/maximale Termlänge, weil sie die Fuzzy-Distanz beeinflusst;
- Verfügbarkeit und Warm-/Fehlerzustand des Embedding-Providers.

Aus der Telemetrie kann zunächst ein konservatives Kostenmodell gelernt werden, beispielsweise eine kleine lineare Schätzung für BM25-p90. Der volle lexikalische Arm wird nur gestartet, wenn seine vorhergesagte Laufzeit ins Budget passt.

### 6.2 Vier Betriebsarten

```text
Query einmal normalisieren und tokenisieren
│
├─ Dense verfügbar?
│  ├─ ja, voller BM25 voraussichtlich billig
│  │    → Hybrid: Dense + voller gruppierter BM25 im Worker
│  └─ ja, voller BM25 voraussichtlich teuer
│       → Dense primär + exakte lexikalische Identifier-Rettung
│
└─ Dense nicht verfügbar/fehlerhaft
   ├─ voller BM25 voraussichtlich billig
   │    → voller gruppierter BM25 im Worker
   └─ voller BM25 voraussichtlich teuer
        → gruppierter Exact/Prefix-Pass über den ganzen Prompt
          + gezieltes Fuzzy nur für wertvolle/OOV-Terme
```

#### Modus A: voller lexikalischer Arm

Für kurze, präzise Queries bleibt das heutige Verhalten inklusive Fuzzy und Prefix erhalten. Genau hier ist die Termzahl niedrig und BM25s Stärke bei exakten Bezeichnern am wertvollsten.

#### Modus B: voller Hybridarm

Auf einem embeddingsfähigen Rechner laufen Dense und der gruppierte BM25-Arm in getrennten Ausführungskontexten. Hybrid bleibt sinnvoll, solange der lexikalische Arm sein Budget voraussichtlich einhält.

#### Modus C: Dense-dominant plus Identifier-Rettung

Für teure lange Prompts wird der dichte Arm primär. Parallel läuft kein vollständiges Fuzzy über den Prompt, sondern eine kleine lexikalische Rettung für:

- vollständige Dateinamen und Pfadsegmente;
- Funktions-, Klassen-, Paket- und Config-Namen;
- Flags, Issue-IDs, Hashes, Versionen und quoted literals;
- exakte seltene Terme in stark gewichteten Feldern.

Die Rettung sollte zunächst exact arbeiten, optional mit begrenztem Prefix. Eine eigene Identifier-Postingmap kann deutlich billiger sein als ein allgemeiner MiniSearch-Aufruf. Ihr Zweck ist nicht, Prosa semantisch zu verstehen, sondern die 22/90 nachgewiesenen Vector-Fehlfälle der exakten Suchklasse abzufangen.

#### Modus D: schneller langer Lexikpfad ohne Dense

Auf schwächeren Rechnern kann die lange Query nicht an Dense delegiert werden. Hier ist die gemessene Kombination „gruppiert + exact/prefix“ der realistische Ausgangspunkt: p50 140 ms, p90 194 ms im isolierten lexikalischen Arm.

Fuzzy wird dann nur aktiviert, wenn es preislich und inhaltlich sinnvoll ist, zum Beispiel:

- bei kurzen Queries generell;
- für wenige OOV-Terme, die wie ein Identifier aussehen;
- für seltene, ausreichend lange Terme mit kleiner maximaler Edit-Distanz;
- als zweiter Pass nur dann, wenn der schnelle Pass keine hinreichende Evidenz erzeugt und noch Deadline-Budget übrig ist.

Das verändert das heutige Ranking. Es ist aber der einzige realistische Weg, auf einer BM25-only-Maschine lange Prompts in ungefähr 200 ms zu behandeln, solange kein nativer kompatibler Fuzzy-Executor existiert.

### 6.3 Retrieval und Einblendentscheidung trennen

RRF sollte weiterhin Ranglisten kombinieren dürfen, aber nicht mehr allein entscheiden, ob ein Memory `required` ist.

Die erste, nicht aufschiebbare Trennung ist typseitig: Eine nackte Zahl darf
nicht mehr wahlweise RRF oder rohes BM25 bedeuten. Mindestens nötig sind
`score_kind: "rrf" | "bm25"`, `retrieval_mode` und ein expliziter
`degraded_reason`. `unfused` darf auf keinem Transport oder in keiner Lane
verloren gehen. Auf `score_kind: "bm25"` dürfen RRF-Floors, RRF-Headlines und
der RRF-basierte REQUIRED-Backoff niemals angewendet werden.

Empfohlenes internes Evidenzmodell:

```text
retrieval_mode
score_kind, score_version
rank_bm25, raw_bm25
rank_vector, cosine, cosine_gap
exact_identifier_match
anchor_kind               # exact_identifier | exact_phrase | prefix | fuzzy | none
matched_field
document_frequency
provider_state, degraded_reason
rrf_score                 # nur wenn beide Arme vorhanden
```

Darauf folgt eine separate Admission-Entscheidung:

```text
required | optional | drop
```

Zunächst dürfen die Regeln pro Modus verschieden sein:

- Hybrid: bisheriger RRF-Wert als Übergangsregel.
- Dense-long: Vector-Rang plus Cosinus und Abstand zum nächsten Kandidaten.
- BM25-only: roher BM25-Wert, Rang und Matchfeld.
- Identifier-Rettung: exakter Match, Feldgewicht und Seltenheit.

Wenn später unbedingt eine gemeinsame Zahl benötigt wird, sollte sie eine auf gelabelten Daten kalibrierte Wahrscheinlichkeit wie `P(required)` sein, mit `score_version` und `retrieval_mode`. Einarmige RRF-Werte einfach zu verdoppeln ist keine Kalibrierung: Es würde einen Treffer aus einer Quelle künstlich mit der Übereinstimmung zweier unabhängiger Quellen gleichsetzen.

## 7. Vorschläge mit Preis und Vorabprüfung

| Vorschlag | Erwarteter Nutzen | Qualitätspreis | Speicher/Startzeit | Komplexität | Vor dem Ausliefern prüfen |
|---|---|---|---|---|---|
| Scoretyp und Degradation bis in jede Lane erhalten | verhindert falsches REQUIRED, falschen Backoff und irreführende Millionenscores | keiner; korrigiert bereits falsches Verhalten | keiner | niedrig–mittel | Hook/MCP mit erzwungenem Timeout/Providerfehler; kein RRF-Floor auf BM25; Response-Vertrag auf allen Transporten |
| `matched_recall_when` durch exakte Anchor-Provenienz ersetzen | verhindert Fuzzy-Falschpositive und Cross-Scope-Leaks | strengere Regel kann bisherige fuzzy Trigger verlieren; bewusst neu labeln | gering | mittel | `and`→`sand`, Prefix, Tippfehler, exakte Phrase, exakter Identifier, Cross-Scope und weak-result pro Treffer |
| Doppelte **verarbeitete** Query-Terme gruppieren, Häufigkeit über `boostTerm` | gemessen ca. 2,5×; p50 1.237 → 493 ms | keiner unter heutigen Optionen und korrektem `processTerm`; Rohgruppierung ist nicht neutral | praktisch keiner | mittel | alle vollständigen IDs/Ränge/Matchfelder identisch; Score-Toleranz ≤1e-7; Case-/Unicode-/Identifier-Property-Tests; Rohgruppierung als negativer Test |
| MiniSearch in einen Worker verschieben | Event Loop frei, echte Dense-Überlappung, kontrollierbare Queue | keiner bei gleichem Ergebnis | ein Index im Worker etwa heutiger Index; Start/IPC | mittel | p50/p90/p99 Gesamt, Event-Loop-Delay, Zeitpunkt des Ollama-Dispatch, Update- und Crash-Tests |
| Mehrere Term-Worker | theoretisch gruppierte p50/p90 durch 4 nahe 123/180 ms vor Overhead | keiner nur bei exakt gleicher Merge-Logik | bis ca. 600 MiB für vier Indexkopien plus Heaps | hoch | 1/2/4-Worker-Bake-off auf schwacher und starker Hardware; RSS, CPU-Konkurrenz zu Ollama, exakte Parität |
| Prefix/Fuzzy termabhängig machen | größter verbleibender JS-Hebel | Kandidaten und Ränge ändern; Typo-Recall kann sinken | gering | mittel | gelabelte Queryklassen, besonders Tippfehler und Identifier; Expansionen pro Term; false negatives |
| `maxFuzzy` auf 1–2 und/oder exakte Prefix-Länge | kann lange-Term-Explosion stark begrenzen | andere Fuzzy-Semantik | keiner | niedrig | Sweep nicht nur gegen aktuelle Ausgaben, sondern gegen Relevanzlabels; Edit-Distanz-Histogramm der echten Gewinne |
| Exact-Identifier-Rettungsindex | erhält lexikalische Stärke im Dense-long-Modus sehr billig | generische Identifier können false positives erzeugen | zusätzliche kleine Postingmap, etwas Startzeit | mittel | die 90 Identifier-Fälle plus echte Verkehrsstichprobe; Feld-/DF-Regeln; Präzision der Einblendungen |
| Getrennter kompakter Fuzzy-Index für `title`, `tags`, `recall_when`, `topic` und exact-only Body | viel kleineres Fuzzy-Wörterbuch | Body-Tippfehler verlieren Gewicht; Scores ändern sich | zweiter Index oder neue Indexaufteilung | mittel | Feld-Ablation: welche injizierbaren/gelabelten Treffer kommen ausschließlich fuzzy aus Body/Summary? |
| SQLite-FTS5-Prototyp | nativer Exact/Prefix-BM25, persistenter kleiner Index | Ranking und Fuzzy nicht kompatibel | Disk-Index; Binding/Runtime abhängig | mittel–hoch | gleicher Tokenizer und sieben Felder; Latenz, RSS, Start, Kandidaten-Recall; Fuzzy-Lücke explizit messen |
| Tantivy-Prototyp | stärkster Kandidat für schnellen nativen BM25/Fuzzy-Top-K-Pfad | Ranking nicht automatisch identisch | persistenter Index; native Binaries | hoch | lokaler Bake-off gegen MiniSearch auf langen Prompts, Identifiern und Tippfehlern; Plattformmatrix |
| SymSpell als Fuzzy-Kandidatengenerator | mögliche massive Beschleunigung der Termsuche | Distanz-/Kandidatenabweichungen möglich | mehr Indexspeicher und Bauzeit | hoch | für jedes Query-Term exakte Gleichheit der MiniSearch-Expansionen und Distanzen beweisen, erst dann Rankingtest |
| Block-Max WAND/sicheres Top-K-Pruning | später nützlich bei viel größerem Vault | bei korrekter Implementierung keiner | Zusatzstatistiken | sehr hoch | erst profilieren, ob Postings-Scoring nach Expansion relevant wird; derzeit nicht der Engpass |
| Ollama `keep_alive` erhöhen | vermeidet kalte Modellstarts | keine Retrievaländerung | Modell bleibt länger in RAM/VRAM | niedrig | getrennte warm/cold Latenzen und RAM-Budget; Provider-Ausfall |
| Embedding-Dimension 768 → 256/128 | weniger Vektorspeicher und schnellerer Cosinus-Pass | möglicher Recall-Verlust; vollständiges Re-Embedding | Vektorspeicher sinkt, Modell-RAM kaum | mittel | Dense-Rank-Recall und Cosinuslatenz messen; nicht erwarten, dass Modellinferenz proportional schneller wird |
| Query-/Expansion-Cache ausbauen | schnell bei echten Wiederholungen | keiner bei korrekter Invalidierung | unbeschränkt riskant | mittel | reale Hit-Rate und Speicherwachstum messen; aktueller Expansionstest zeigte nur ca. 10 % Zusatzgewinn |

## 8. Konkrete Reihenfolge für Claude Code

### P0: Score-Space und Anchor-Ehrlichkeit reparieren

Diese Phase steht vor jeder Optimierung. Performanceänderungen können die
Timeout-Rate senken, aber Ollama kann weiterhin fehlen, ausfallen oder langsam
sein; der Fallback muss für sich korrekt sein.

1. `unfused` und `degraded` in `prompt-lane.ts` in den Response-Typ aufnehmen
   und bis Filter, Backoff, Formatter und Telemetrie durchreichen.
2. Einen expliziten `score_kind`/Retrievalmodus in den gemeinsamen Hit- oder
   Response-Vertrag aufnehmen. Kein Caller darf den Modus aus der Höhe der Zahl
   erraten.
3. Für unfused BM25 eine eigene Admission und Wortwahl verwenden. Bis diese
   kalibriert ist, darf rohes BM25 nicht automatisch REQUIRED werden und keinen
   RRF-basierten Backoff-Bypass erhalten.
4. Alle Recall-Oberflächen auditieren. `write-lane.ts` kennt `unfused` bereits;
   die Prompt-Lane tut es nicht. Auch `recall-handler.ts` muss eine während des
   Calls eintretende Degradation erkennen statt nur den Providerzustand vor dem
   Call zu betrachten.
5. `matched_recall_when` nicht mehr aus der unspezifischen MiniSearch-`match`-
   Map ableiten. Exakte/Fuzzy/Prefix-Provenienz getrennt erfassen.
6. Cross-Scope-Bypass nur für einen exakten starken Anchor erlauben. Eine
   plausible Startregel ist: exakter seltener Identifier oder zwei
   signifikante exakte Tokens derselben authored Phrase.
7. `weak_result`/`no_home` pro Trefferprovenienz prüfen; ein einzelnes
   fragwürdiges Listenmitglied darf nicht die gesamte Liste gesund erklären.

Pflicht-Regressionen:

- erzwungener Vector-Timeout: Response `score_kind=bm25`, `unfused=true`, kein
  RRF-REQUIRED und keine „beide Pfade“-Aussage;
- gleiche Query mit 150-ms-Hook- und 1.500-ms-MCP-Deadline;
- Query `and` gegen `recall_when: sand theme`: BM25 darf fuzzy treffen, aber
  `deliberate anchor` muss false bleiben;
- exakte Phrase und exakter Identifier müssen den vorgesehenen Anchor setzen;
- Provider nicht installiert, Providerfehler und leerer Vector-Index.

Akzeptanzkriterium: keine Score-Space-Verwechslung auf irgendeiner Oberfläche,
keine Fuzzy-/Prefix-Evidenz als absichtlicher Cross-Scope-Anker.

### Phase 0: Mess- und Qualitätsgrundlage

Noch keine Retrievaländerung ausliefern.

1. Das bestehende Harness `npm run bm25-expansion --workspace @bastra-recall/eval` um Querykosten-Merkmale ergänzen:
   - emittierte/eindeutige Terme;
   - Identifier-, OOV- und Termlängenanteile;
   - Zahl der Prefix- und Fuzzy-Expansionen pro Term;
   - tatsächliche erlaubte Edit-Distanz;
   - Zeit getrennt nach Tokenisierung, Expansion, Posting/Scoring, Sortierung und Damping.
2. `monitorEventLoopDelay()` oder gleichwertige Telemetrie um den Recall-Aufruf ergänzen.
3. Beim dichten Arm Ollama-Dispatch, Modell-Ladezeit, `prompt_eval_count`, gesamte Dauer, Timeout und Providerfehler getrennt erfassen.
4. Nach dem P0-Fix sicherstellen, dass Timeout/Degradation nicht nur in der
   Recall-Telemetrie, sondern auch in der konsumierenden Lane sichtbar bleibt.
   Ein stiller leerer Recall darf nicht dasselbe Ereignis sein wie „ehrlich
   keine relevanten Treffer“.
5. Qualitätsset aus der **Vereinigung** folgender Kandidaten bauen:
   - Vector Top 20 oder Top 50;
   - BM25 Top 20 oder Top 50;
   - aktuell injizierte Treffer;
   - Identifier-Rettungskandidaten;
   - einige Kandidaten direkt unter den heutigen Floors.
6. Kandidaten mit `required`, `optional`, `irrelevant` labeln. Nach Queryklassen und ganzen Sessions/Projekten in Train/Validation trennen, nicht zufällig einzelne Treffer derselben Session verteilen.

Akzeptanzkriterium: Messungen unterscheiden Retrieval-Latenz, Event-Loop-Blockade, Provider-Timeout und echte Abwesenheit; Qualitätsbewertung ist nicht mehr nur „gleich wie Produktion“.

### Phase 1: rangneutrale Arbeit

1. Query genau einmal mit dem produktiven Identifier-Tokenizer tokenisieren.
2. **Danach exakt dieselbe `processTerm`-Funktion wie der Index anwenden**, ihre
   Array-Rückgaben gegebenenfalls flatten und leere Ergebnisse verwerfen.
3. Erst in diesem verarbeiteten Termraum Häufigkeiten bilden. Niemals
   Groß-/Kleinschreibung erhaltende Rohterme gruppieren.
4. Jeden eindeutigen verarbeiteten Term einmal suchen, zweites Tokenisieren/
   Verarbeiten unterbinden und die Wiederholungswirkung über `boostTerm`
   erhalten. Der Code aus Abschnitt 4.5 ist die Referenz.
5. Vollständige Parität von Kandidatenmenge, IDs, Reihenfolge, Scores,
   `terms`, `queryTerms`, Matchfeldern, Anchor-Provenienz und RRF-Rangpaaren
   testen. Score-Toleranz höchstens in der beobachteten Float-Größenordnung;
   2,553 Millionen Differenz ist der negative Kontrollfall.
6. Regressionen mit Case-Kollisionen (`AND`, `and`), Unicode-Lowercasing,
   wiederholten Identifierteilen und Termen, die nach `processTerm` auf
   denselben Key fallen, hinzufügen.
7. Danach MiniSearch vollständig in einen langlebigen Worker verschieben. Der Worker besitzt den Index und erhält Vault-Add/Change/Remove-Ereignisse.
8. Queue begrenzen, Request-IDs verwenden und verspätete Resultate verwerfen. Crash und Index-Rebuild testen.

Erwartung aus dem bestätigten Gegenlauf: ungefähr 493/719 ms lexikalisch auf
den gemessenen langen Prompts, aber ein reaktionsfähiger Daemon und echte
Dense-Überlappung. **Diese Phase allein erreicht 200 ms nicht.**

### Phase 2: Suchrouter und mode-spezifische Admission im Shadow-Modus

1. Billiges Query-Kostenmodell auf Telemetriedaten bauen.
2. Die vier Modi aus Abschnitt 6 zunächst nur als Shadow-Entscheidung berechnen. Produktion liefert weiterhin den bisherigen Pfad aus.
3. Für Dense-long Vector Top 20/50 plus exakte Identifier-Rettung aufzeichnen.
4. Für Lexical-long gruppiertes Exact+Prefix plus kontrollierte Fuzzy-Varianten aufzeichnen.
5. Pro Modus Admission-Regeln gegen menschliche Labels kalibrieren.
6. Besonders prüfen:
   - lange Prosa;
   - lange Code-/Log-Prompts mit wichtigem Identifier am Anfang, in der Mitte und am Ende;
   - kurze exakte Datei-/Funktionsnamen;
   - ein Tippfehler in einem Identifier;
   - mehrere ähnlich benannte Memories;
   - Ollama kalt, nicht installiert, fehlerhaft und zu langsam.

Ship-Gate: kein statistisch oder praktisch relevanter Verlust bei `required`-Recall auf dem Holdout; Einblendpräzision mindestens Status quo; keine stillen Ausfälle.

### Phase 3: schneller BM25-only-Pfad

1. Gruppiert Exact+Prefix als Basis für lange teure Queries messen.
2. Fuzzy-Policy als Matrix testen:
   - nur kurze Query;
   - nur OOV;
   - nur Identifier;
   - Distanz maximal 1 oder 2;
   - Fuzzy nur in hoch gewichteten Feldern;
   - zweiter Pass nur bei niedriger Evidenz und Restbudget.
3. Eine kleine exakte Identifier-Postingmap gegen MiniSearch-Exact vergleichen.
4. Admission nicht aus dem veränderten BM25-Rang in einen alten RRF-Floor pressen, sondern lexical-mode-spezifisch entscheiden.

Zielkorridor aus der heutigen Messung: lexikalischer p50 ≤150 ms und p90 ≤200 ms warm; End-to-End p90 inklusive IPC und Lane-Logik separat ausweisen.

### Phase 4: nativer Bake-off nur wenn Phase 3 nicht genügt

Tantivy, SQLite FTS5 und gruppiertes MiniSearch gegeneinander testen. Kein großer Umbau vor dem Bake-off.

Minimaler Prototyp muss abbilden:

- produktiven Dual-Identifier-Tokenizer;
- alle sieben Felder und Gewichte;
- OR-Semantik;
- Exact, Prefix, Fuzzy;
- Top 50;
- inkrementelle Adds/Changes/Removes;
- persistenter Neustart;
- alle Filter und nachgelagerte Dämpfung unverändert.

Auswahlkriterien in dieser Reihenfolge:

1. `required`-Recall und Präzision auf gelabeltem Holdout;
2. p50/p90/p99 auf langen und kurzen Queryklassen;
3. RSS auf schwacher Hardware;
4. Start-/Reindexzeit;
5. macOS/Linux/Windows-Packaging und Update-Sicherheit;
6. Wartungskomplexität.

## 9. Messplan und SLO

„200 ms pro Aufruf“ muss operationalisiert werden. Empfohlen:

| SLO | Aussage |
|---|---|
| warm p50 ≤ 200 ms | unmittelbares UX-Ziel auf typischer Hardware |
| warm p90 ≤ 250 ms, später ≤ 200 ms | verhindert, dass nur der Median schön ist |
| p99/deadline explizit | kalte Modelle und Ausreißer dürfen nicht still verschwinden |
| Event-Loop-Delay p99 < 25 ms während Recall | Daemon bleibt reaktionsfähig, auch wenn Worker noch rechnet |
| 0 stille Abwesenheiten | Timeout, Providerfehler und „keine Treffer“ sind unterscheidbar |

Jede Benchmark-Zeile sollte zusätzlich ausweisen:

- Hardware, Node-, MiniSearch-, Ollama- und Modellversion;
- Vaultgröße, Vokabulargröße, Vektordimension;
- Promptzeichen, Modelltoken, emittierte/eindeutige Terme;
- warm/kalt, Cache hit/miss;
- Retrievalmodus und Providerzustand;
- p50, p90, p99 statt nur Median;
- RSS, CPU-Zeit, Event-Loop-Delay und Startzeit;
- Qualitätsmetriken je Queryklasse.

## 10. Was nicht empfohlen wird

- **Performance vor Score-Space-Ehrlichkeit ausliefern.** Weniger Timeouts
  verstecken den Fehler nur; BM25-only und Provider-Ausfall bleiben.
- **Unfused BM25 mit RRF 50/100 banding.** Der rohe Score ist offen und kann
  Millionen erreichen.
- **Unfused Scores durch ungefähr 4.900 teilen oder bei 164 deckeln.** Der
  beobachtete Faktor ist nicht konstant und die Ranglisten sind verschieden.
- **Termhäufigkeiten direkt nach `tokenizeWithIdentifiers` bilden.** Das wurde
  mit 0/30 identischen Vollrankings widerlegt; erst `processTerm`, dann zählen.
- **Jeden Match im Feld `recall_when` als absichtliche Phrase behandeln.**
  Prefix/Fuzzy kann `and` auf `sand` abbilden.
- **BM25 vollständig abschalten.** Der Identifier-Stress-Test widerlegt das.
- **Nur nach Zeichenlänge umschalten.** Termzahl und Queryform erklären die Kosten besser.
- **Die 42 heutigen Hybridtreffer als vollständiges Goldset verwenden.** Die Auswahl setzt Vector-Beteiligung mathematisch voraus.
- **Einarmigen RRF-Score verdoppeln.** Das erfindet eine Übereinstimmung zweier Arme.
- **Erneut blind Queryterme abschneiden.** Das wurde bereits mit echten Verlusten widerlegt.
- **Von einem Worker siebenfachen Speedup erwarten.** Er löst Event-Loop und Überlappung, nicht den Algorithmus.
- **Vier vollständige MiniSearch-Worker als Standard für schwache Rechner bauen.** Speicher- und CPU-Kosten widersprechen dem Produktziel.
- **Sofort auf einen nativen Index migrieren.** Erst einen kleinen lokalen Bake-off; Rang- und Packagingkosten sind real.
- **Fuzzy-Caches unbegrenzt wachsen lassen.** Die gemessene Wiederverwendung war zu klein.
- **Nur Median messen.** Dense-only liegt schon bei 175 ms Median; ein scheinbar erreichtes 200-ms-Ziel kann trotzdem viele Timeouts haben.

## 11. Endempfehlung

Claude Code sollte nicht mit einem großen Indexwechsel beginnen. Die sinnvollste Abfolge ist:

1. **P0: Score-Space-Leak und falsche Anchor-Provenienz beheben.**
2. **Termgruppierung nach `processTerm` als nachweislich rangneutrale Beschleunigung; Rohterm-Gruppierung ausdrücklich nicht verwenden.**
3. **Ein Worker als Stabilitäts- und Nebenläufigkeitsmaßnahme.**
4. **Ehrliche Telemetrie und ein gelabeltes Kandidaten-Union-Set.**
5. **Kostenbasierter Router mit vollem BM25 für kurze/exakte Queries, Dense plus Exact-Rescue für lange Queries auf starken Rechnern und Exact/Prefix plus gezieltem Fuzzy für lange Queries auf BM25-only-Rechnern.**
6. **RRF dauerhaft von der Admission-Entscheidung entkoppeln.**
7. **Nur wenn der BM25-only-Pfad danach das p90-Ziel verfehlt: Tantivy als ersten nativen Bake-off, SQLite FTS5 als einfacheren Exact/Prefix-Vergleich.**

Die unbequeme, aber wichtige Grenze lautet: **Exakt das heutige Full-Fuzzy-Ranking für ungefähr 1.000 Query-Terme auf einem einzelnen MiniSearch-Thread in 200 ms zu reproduzieren ist mit den vorliegenden Messungen nicht realistisch.** Die korrekt normalisierte Termgruppierung bewahrt dieses Ranking und halbiert bis drittelt die Kosten, kommt allein aber nur auf ungefähr 493/719 ms. 200 ms werden realistisch, wenn Bastra die teure Fuzzy-Arbeit nach Queryklasse bezahlt und die Einblendentscheidung nicht länger an eine je nach Modus anders bedeutende nackte Score-Zahl bindet.

## 12. Quellen

Primärquellen und offizielle Dokumentation:

- [MiniSearch Repository und Dokumentation](https://github.com/lucaong/minisearch)
- [MiniSearch Quellcode (`MiniSearch.ts`)](https://github.com/lucaong/minisearch/blob/master/src/MiniSearch.ts)
- [MiniSearch Design Document](https://github.com/lucaong/minisearch/blob/master/DESIGN_DOCUMENT.md)
- [MiniSearch Changelog](https://github.com/lucaong/minisearch/blob/master/CHANGELOG.md)
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- [Ollama Embed API](https://docs.ollama.com/api/embed)
- [Ollama OpenAPI-Spezifikation](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml)
- [Google EmbeddingGemma](https://ai.google.dev/gemma/docs/embeddinggemma)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [Tantivy Query-Modul](https://docs.rs/tantivy/latest/tantivy/query/index.html)
- [Tantivy FuzzyTermQuery](https://docs.rs/tantivy/latest/tantivy/query/struct.FuzzyTermQuery.html)
- [Tantivy QueryParser](https://docs.rs/tantivy/latest/tantivy/query/struct.QueryParser.html)
- [Tantivy Architecture](https://github.com/quickwit-oss/tantivy/blob/main/ARCHITECTURE.md)
- [Apache Lucene FuzzyQuery](https://lucene.apache.org/core/7_7_3/core/org/apache/lucene/search/FuzzyQuery.html)
- [SymSpell](https://github.com/wolfgarbe/SymSpell)
- [Block-Max WAND, SIGIR 2017](https://doi.org/10.1145/3077136.3080780)

---

## 13. Nachtrag: Gegenprüfung durch Claude Code (25.08.2026)

Alle drei Kernbefunde wurden am Code und am echten Vault nachgeprüft, bevor
gebaut wurde. Ergebnis: zwei bestätigt, einer mit korrigierter Begründung.

**Termgruppierung — bestätigt.** Ein erster Nachbau ohne `processTerm` ergab
0/30 identische Ranglisten; mit dem Fix aus dieser Übergabe (erst falten, dann
zählen) sind es 30/30 bei maximal 1,77 × 10⁻⁸ Abweichung, gemessen 1100 → 441 ms
p50 über 30 echte Prompts. Die Reihenfolge `processTerm` vor Gruppierung ist
damit nicht Stilfrage, sondern die Bedingung, unter der die Aussage überhaupt
gilt.

**Score-Space-Leak — bestätigt, mit einem Zusatz.** `write-lane.ts:91` führt
`unfused` bereits im Response-Typ und reicht es an den Formatter durch; die
Prompt-Lane kannte das Feld nicht. Die Lücke war also an einer Oberfläche
längst geschlossen und an der anderen offen — was den Fund von einer Theorie zu
einer nachweisbaren Inkonsistenz macht.

**`matched_recall_when` — Mechanismus bestätigt, Beispiel widerlegt.** Die Query
`and` trifft `sand` NICHT: Bei drei Zeichen expandiert MiniSearch mit
`fuzzy: 0.2` nicht, die Query liefert gegen den echten Vault null Treffer. Der
Fehler existiert trotzdem, nur eine Wortlänge höher — gemessen setzten
`obsidan` (ein Edit) und `tripwir` (ein Präfix) das Flag auf Memories, deren
`recall_when` diese Wörter nie enthielt. Die Pflicht-Regression in §8/P0 sollte
entsprechend auf ein Wort ab ~5 Zeichen umgestellt werden.

### Was daraufhin gebaut wurde (P0, Punkte 1–5 und 7)

- `matchedRecallWhen()` vergleicht gegen die tokenisierten, gefalteten
  Query-Terme. Prefix- und Fuzzy-Evidenz setzt den Anker nicht mehr; damit
  greifen Cross-Scope-Bypass (`hook-skip.ts`) und `weak_result`-Unterdrückung
  (`weak-result.ts`) nur noch auf exakter Autorenabsicht.
- `unfused` und `degraded` sind im Response-Typ der Prompt-Lane, werden an
  Backoff, Formatter und Telemetrie durchgereicht.
- Ohne Fusion: kein REQUIRED-Band, kein Backoff-Bypass, keine „beide
  Suchpfade"-Aussage, und die Punktzahl wird nicht mehr gezeigt — auf einer
  offenen Skala lädt sie zu einem Vergleich ein, den sie nicht trägt.

Punkte 2, 4 und 6 sind inzwischen ebenfalls gebaut: `score_kind` (`"rrf"` |
`"bm25"`) steht neben `unfused`/`degraded` im Antwortvertrag; der Handler liest
die Degradation aus derselben `done`-Stage, die die Hook-Route schon auswertete,
statt aus dem Breaker-Zustand vor dem Call; und `anchor_strength` gradiert den
Anker nach der Regel, die `reflex.ts` seit dem 20.08.-Vorfall verwendet — zwei
exakte Trigger-Terme oder einer, dessen Document-Frequency ihn für sich sprechen
lässt. Der Cross-Scope-Bypass verlangt `"strong"`; fehlt das Feld, bleibt es beim
alten Verhalten, damit ein älterer Daemon nicht still strenger wird.

Damit ist P0 abgeschlossen. Offen bleiben Phase 0 (Messgrundlage und gelabeltes
Qualitätsset) und Phase 1 (Termgruppierung, Worker) — beide unverändert wie
oben beschrieben.
