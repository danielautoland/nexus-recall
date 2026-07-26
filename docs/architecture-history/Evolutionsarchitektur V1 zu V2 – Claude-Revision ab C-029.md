# Bastra Recall – Evolutionsarchitektur V1 → V2 (Claude-Revision ab C-029)

> Status: Release- und Zielarchitektur; V1.0 ist der nächste verbindliche
> Releasevertrag, V2.0 das langfristige, messungsabhängige Zielbild
>
> Stand: 25. Juli 2026
>
> Ausgangsstand: Bastra Recall 0.8.6, aktueller Vault, reale
> 30-Tage-Telemetrie und bestehende Eval-Geometrie
>
> Basis dieser Fassung: `docs/Evolutionsarchitektur V1 zu V2.md` im
> abgenommenen Stand C-001–C-028. Diese Datei ersetzt das Original nicht,
> sondern ist die zur Gegenprüfung vorgelegte Revision.
>
> Neu in dieser Fassung sind ausschließlich die Deltas C-029–C-039 aus der
> Gegenprüfung des Recherche-Briefings `docs/Claude-Briefing – Recherche-Delta
> Evolutionsarchitektur V2.md`. Jede geänderte Passage ist über das Ledger in
> 0.4 und das Delta-Ledger in Abschnitt 28 auf genau eine C-ID zurückführbar.
> Der abgenommene Stand C-001–C-028 wird nicht umgedeutet und nicht neu
> aufgerollt.

## 0. Entscheidungs- und Reviewstatus

Dieses Dokument trennt fünf Ebenen:

1. **verifizierter Ist-Stand** – direkt durch Code, Telemetrie oder einen
   reproduzierbaren Run belegt;
2. **V1.0-Releasevertrag** – die kleinste Arbeit, die eine belastbare Mess-,
   Entscheidungs- und Kontrollbasis herstellt;
3. **V1.x-Evolution** – einzeln gegatete, rückwärtskompatible Schritte auf
   Basis realer Messungen;
4. **V2.0-Zielbild** – die gemeinsame Promotion der während V1.x bewiesenen
   Gedächtnisfunktionen;
5. **Hypothese** – darf jederzeit gemessen oder im Shadow untersucht werden,
   wird aber erst nach dem vorher definierten Gate zu Schema-, Vertrags- oder
   Live-Arbeit.

### 0.1 V1.0 – Mess- und Kontrollbasis

Der aktuelle Stand 0.8.6 erfüllt V1 noch nicht vollständig. V1.0 ist erreicht,
wenn ausschließlich folgende Grundlagen umgesetzt und nachgewiesen sind:

1. Messwahrheit und reproduzierbare Baselines herstellen;
2. einen deterministischen, erklärbaren Abstention- und Relevanzentscheid aus
   bereits vorhandenen Signalen bauen;
3. den vorhandenen Session-Context-Pfad zu einem gemeinsamen, projektfähigen
   und parallelen Server-Assembler weiterentwickeln;
4. ein globales Kontextbudget einführen und Retrievalqualität getrennt von
   Hook-Formulierung beziehungsweise Consumer-Verhalten messen.

V1.0 enthält keine neuen Memory-Typen, Claims, Graph-Kantentypen,
Dual-Vektoren, Chunking-, HNSW- oder Learned-Ranking-Live-Schicht.

### 0.2 Releaseleiter

| Release | Funktion | Freigabelogik |
|---|---|---|
| 0.8.6 | heutiger Vor-V1-Ist-Stand | Diagnosegrundlage, kein abgeschlossener V1-Vertrag |
| V1.0 | beobachtbare und selektive Mess-/Kontrollbasis | Abschnitt 0.1 und Definition of Done 26.1 vollständig erfüllt |
| V1.x | schrittweise Evolution | jeder Baustein einzeln durch das jeweils benannte Messgate freigegeben und rückwärtskompatibel ausgeliefert |
| V2.0 | vollständiges adaptives Gedächtnissystem | alle verpflichtenden V2-Eigenschaften aus 26.2 gemeinsam nachgewiesen |

Messung, Shadow-Betrieb und read-only Projektionen sind jederzeit zulässig.
Messgates gaten ausschließlich Schema-/Vertragsänderungen und
Live-Aktivierung. Ausnahme sind Qualitätsvergleiche, deren Interpretation die
M0-Baseline voraussetzt.

Accessibility/Asteroidengürtel, Deep Recall, Episodic Memory, Claims, Typed
Graph, Konsolidierung, Dual-Vektoren, HNSW und Learned Ranking bleiben als
V2-Zielbild im Dokument. Während V1.x dürfen nur die Bausteine dauerhaft in
Produktverhalten, Schema oder Verträgen umgesetzt beziehungsweise live
aktiviert werden, deren benanntes Messgate den Bedarf und die Sicherheit
belegt. Vorher bleiben sie auf Messung, Shadow, read-only oder isolierte
Experimente begrenzt.

V2.0 ist keine Sammelfreigabe für vorab gebaute Komponenten. Es ist die
Beförderung der während V1.x einzeln bewiesenen Teile zu einem stabilen
Gesamtsystem.

### 0.3 Reviewdisziplin

Gegenprüfungen unterscheiden strikt zwischen falschem Ist-Stand, Messproblem,
Architekturentscheidung und zukünftiger Hypothese. Jeder Einwand erhält eine
stabile ID, konkrete Passage, Urteil, Datei-/Zeilenevidenz oder reproduzierbaren
Befehl sowie eine minimale Korrektur. Bereits geklärte Punkte werden nur mit
neuer Evidenz erneut geöffnet.

### 0.4 Abgenommenes Review-Ledger

| ID | Urteil | Verbindliche Konsequenz im Dokument |
|---|---|---|
| C-001 | bestätigt | BM25-Rohscore und skalierter RRF dürfen keine gemeinsamen absoluten 30/100-Bänder mehr als Relevanzversprechen verwenden. |
| C-002 | bestätigt | Das heutige `weak_result` ist nur ein informatives MCP-Signal und kein Hook-Gate; V1.0 führt einen echten Evidenzentscheid mit Abstention ein. |
| C-003 | korrigiert | Der produktive Candidate Pool ist `max(k × 4, 20)`, nicht überall 20; für Out-of-pool-Evals wird er explizit auf 100/200 erweitert. |
| C-004 | korrigiert | `GET /hook/session-context` existiert, ist aber projektlos und intern seriell; er wird erweitert, nicht unverändert als Ersatz für SessionStart eingesetzt. |
| C-005 | korrigiert | Bridges sind opt-in und ohne Pool ein No-op; auf dieser Instanz waren zwei Bridges aktiv und erweiterten in der Messperiode 853 Queries. Diese Feuerrate belegt Aktivität, nicht Nutzen oder Qualitätslift. |
| C-006 | bestätigt | `acted_on` ist ein Token-Overlap-Proxy und kein Goldlabel; V1.0 behauptet deshalb keine `relevance_probability`. |
| C-007 | qualifiziert | HNSW ist beim heutigen Vault nicht begründet, bleibt aber als ausdrücklich gegatete spätere Auto-Switch-Strategie spezifiziert. |
| C-008 | bestätigt | Vollständiges Mutation-Audit besteht heute nur im Mac-App-Bridge-Pfad; reguläre MCP-/HTTP-Saves sind davon nicht umfasst. |
| C-009 | bestätigt | Load-/Use-Quoten vermischen Retrieval, Hook-Formulierung, Consumer-Verhalten und Telemetrie-Zuordnung; V1.0 trennt diese Effekte experimentell. |
| C-010 | bestätigt | Die Ad-hoc-Baseline besitzt noch kein versioniertes Run-Artefakt und wird erst nach M0 zur offiziellen Baseline. |
| C-011 | bestätigt | Salience wirkt live auf die Staleness-Lebensdauer; direkter Rankingeinfluss bleibt standardmäßig Shadow-only. |
| C-012 | bestätigt | Die Produktions-Telemetrie weist für den BM25-Schritt p50 1 ms, p95 11 ms und p99 25 ms aus; die abweichende Ad-hoc-Zeile wird separat und als nicht archiviert gekennzeichnet. |
| C-013 | bestätigt | Accessibility und Typed Graph Evidence sind keine V1.0-Evidenzsignale; §10.2 trennt verfügbare V1-Signale von späteren V2-Signalen. |
| C-014 | bestätigt | Context-ROI ist eine System-Erfolgsmetrik und kein Live-Schaltgate des Evidenzentscheids; dessen Aktivierung hängt nur an retrieval-isolierten Gates. |
| C-015 | bestätigt | Die 45,2-%-Messung besitzt keine archivierte unabhängige Provenienz und wird als Ad-hoc-Paraphrasenmessung bezeichnet. |
| C-016 | bestätigt | Das absolute Recall@3-Ziel ist kein Schaltgate des klassifizierenden Evidenzentscheids; dieser muss den Recall gegenüber dem ungegateten Arm erhalten, während die absolute Coverage ab V1.0 als Systemziel beobachtet wird. |
| C-017 | bestätigt | Typed Graph, Versionen und Rekonsolidierung benötigen nach M4-Vorbereitung zusätzlich einen gesonderten Schemaentscheid; §25 benennt dieses Gate ausdrücklich. |
| C-018 | Product-Owner-Vorgabe | Messung, Shadow-Betrieb und read-only Projektionen bleiben jederzeit zulässig; Messgates beschränken Schema-/Vertragsänderungen und Live-Aktivierung, mit M0-Vorbehalt nur für interpretierte Qualitätsvergleiche. |
| C-019 | bestätigt | `acted_on` und die daraus berechneten Tokenkosten werden durchgängig als Token-Overlap-Proxy bezeichnet, nicht als nachweisliche Nutzung. |
| C-020 | bestätigt | V1.0-Telemetrie erhält `client`, `hook_source` und eine pseudonyme Session-Dimension, damit die beschlossenen Auswertungen und Experimentarme ausführbar sind. |
| C-021 | bestätigt | M0 liefert nach dem Baseline-Run versionierte numerische M1-Toleranzen. |
| C-022 | Product-Owner-Entscheid | Shadow-Abnahme nach mindestens 14 Tagen oder 500 geloggten Hook-Entscheidungen; zusätzlich müssen Goldset-Gates bestehen und alle `required`/`no_answer`-Divergenzen erklärt sein. |
| C-023 | Product-Owner-Entscheid | Der Live-Evidenzentscheid läuft hinter einem Konfigurations-Flag mit sofortigem Fallback auf das heutige Floor-Verhalten; kein Hard-Cutover. |
| C-024 | Product-Owner-Entscheid | Retrieval-/Präsentationsexperimente weisen den Arm deterministisch pro pseudonymer Session-ID zu; Mindest-N pro Arm wird nach M0 versioniert festgelegt. |
| C-025 | Product-Owner-Entscheid | Private Run-Artefakte liegen unter `~/.bastra/eval-runs/<datum>-<hash>/`; das öffentliche Repo erhält nur aggregierte Reports ohne Vault-abgeleitete Query-Texte. |
| C-026 | bestätigt | Chunking wird nicht durch M2 freigegeben, sondern benötigt einen gesonderten Repräsentationsentscheid auf Basis einer Chunking-on/off-Ablation. |
| C-027 | bestätigt | Produktmetriken sind erst ab ihrer jeweils gegateten Datenquelle messbar; vorher bleiben sie ausdrücklich Zielbild. |
| C-028 | bestätigt | §19 definiert die zulässigen unabhängigen Query-Quellen, verbietet beim Formulieren den Zugriff auf Body, Summary und `recall_when` des Ziel-Memorys und macht die Provenienzfelder im Datensatzmanifest und privaten Run-Artefakt verbindlich. |
| C-029 | Architekturentscheidung | Fremdsystemzahlen werden mit ihrer Evidenzklasse geführt und sind niemals Messgate, Zielwert oder Abnahmekriterium; §2.3 hält die geprüften Grenzen der zitierten Messungen fest. |
| C-030 | Architekturentscheidung | Cue und Evidenz werden getrennt. `recall_when` bleibt der primäre autorisierte Cue; abgeleitete Cues starten als read-only Sidecar mit Herkunft und begründen für sich genommen nie `required`. |
| C-031 | Architekturentscheidung | Deep Recall ist ein eigener, bewusst ausgelöster Modus mit deterministischer Stufe 1 und agentischer Stufe 2; er wird gegen bloß größeres `k` ablated und läuft nie in einem Hook-Latenzbudget. |
| C-032 | Architekturentscheidung | Die vier Zeitachsen `occurred_at`, `valid_from`/`valid_to`, `recorded_at` und `derived_at` werden getrennt benannt; `created` und `updated` bleiben reine Dateizeiten. |
| C-033 | Architekturentscheidung | Herkunft wird als `provenance_class` an Claims und abgeleiteten Inhalten geführt statt als zweite Memory-Taxonomie; ein eigenes Meinungs-/Belief-Netz wird abgelehnt. |
| C-034 | Architekturentscheidung | Der Typed Graph erhält logische Sichten mit Hop-Budget statt getrennter physischer Graphen; kausale und temporale Kanten entstehen nie aus Ähnlichkeit, und jede Sicht braucht einen No-Graph-Kontrollarm. |
| C-035 | Architekturentscheidung | Konsolidierung äußert sich ausschließlich in benannten, nichtdestruktiven und reversiblen Proposal-Operatoren; jede archivierte Quelle bleibt über eine begrenzte Zahl typisierter Links erreichbar. |
| C-036 | Messproblem | Das Goldset erhält handlungsbezogene und assoziative Fallklassen; externe Standardbenchmarks bleiben V1.x-Adapterarbeit und sind kein V1.0-Releaseblocker. |
| C-037 | Messproblem | Nutzungssignale werden über `acted_on` hinaus erweitert und exposure-korrigiert ausgewertet; Nichtreaktion bleibt ein schwaches Negativ ohne Live-Wirkung vor M6. |
| C-038 | Messproblem | M5 misst zusätzlich zu Latenz und Recall den Qualitätszerfall bei Wachstum, insbesondere Abstention, Widerspruchsauflösung und temporale Fragen. |
| C-039 | Hypothese | Gravity- und Hub-Dämpfung werden als zusätzliche M2-Ablationsarme geführt; sie ergänzen die bestehende Lifecycle-, Curator-, Doc- und Salience-Dämpfung, ersetzen sie nicht. |

**Abnahmestand 24.07.2026:** Vollabgleich Ledger C-001–C-027,
Gate-Messbarkeit, Ist-Behauptungs-Sweep (58 Aussagen, alle gedeckt),
Implementierer-Review. Künftige Gegenprüfungen betreffen ausschließlich
Änderungs-Deltas gegen diesen Stand.

**Finale Architekturabnahme 24.07.2026:** C-028 ist im finalen Delta-Review
bestätigt; es bestehen keine substanziellen offenen Deltas. Die abgenommene
Basis C-001–C-027 bleibt unverändert. Nächste freie ID: C-029.

**Recherche-Delta-Revision 25.07.2026 (diese Fassung):** Gegenprüfung des
Recherche-Briefings gegen die dort zitierten Primärquellen und gegen den
Code-Stand. Alle im Briefing genannten Quellen wurden abgerufen; eine URL war
tot, eine Zahlenreihe war ohne eigene Quelle zitiert, und neun Ist-Aussagen
über Bastra wurden am HEAD erneut belegt. Ergebnis sind die Deltas
C-029–C-039. Die Basis C-001–C-028 bleibt unverändert gültig; kein früheres
Urteil wurde revidiert. Details in Abschnitt 28, Quellenbewertung in
Abschnitt 29. Nächste freie ID: C-040.

Neue Delta-Reviews beginnen mit C-040. Ein Urteil ändert sich nur mit neuer
Code-, Telemetrie- oder Run-Evidenz; Geschmacksfragen werden als
Architekturentscheidung statt als Faktenfehler markiert.

## 1. Zweck

Die Evolution von Bastra Recall V1 zu V2 soll nicht einfach mehr Erinnerungen
finden. Das System soll zunehmend zuverlässig entscheiden:

1. ob überhaupt eine Erinnerung relevant ist;
2. welche Art von Gedächtnis für die aktuelle Situation zuständig ist;
3. wie tief gesucht werden muss;
4. ob ein Memory spontan auftauchen, nur auf Nachfrage gefunden oder bewusst
   „aus der Ferne“ zurückgeholt werden soll;
5. wann einzelne Erfahrungen zu dauerhaftem Wissen konsolidiert werden;
6. wann altes Wissen nur schwerer zugänglich, historisch oder nachweislich
   überholt ist.

Der zentrale Produktsatz bleibt:

> Der Nutzer soll nicht für die KI mitdenken müssen.

Spätestens mit V1.0 wird eine zweite Bedingung operativ:

> Die KI soll den Nutzer nicht mit Erinnerungen belasten, die für die aktuelle
> Situation keine nachweisbare Relevanz haben.

## 2. Ausgangslage

Die heutige Architektur besitzt bereits starke Einzelbausteine:

- lokaler Markdown-/YAML-Vault als Source of Truth;
- BM25 mit hoch gewichtetem `recall_when`;
- optionale semantische Suche über Embeddings;
- RRF-Fusion von lexikalischen und semantischen Treffern;
- Doc2query-Trigger, optionale und opt-in aktivierte Sprach-Bridges sowie
  automatische Beziehungen;
- Staleness, Floors und Curator; Salience verlängert bereits die
  Staleness-Lebensdauer, ihr direkter Rankingeinfluss ist standardmäßig
  Shadow-only;
- Reflex-Memories mit expliziter Nutzerfreigabe;
- lokale Telemetrie für `surfaced`, `loaded` und `acted_on`;
- wiederherstellbares Löschen und stabile Memory-IDs; ein vollständiger
  Mutation-Audit existiert derzeit nur im Mac-App-Bridge-Pfad, nicht bei
  regulären MCP-/HTTP-Saves.

Diese Komponenten ergeben aber noch kein geschlossenes Modell für Aufmerksamkeit,
Vergessen, Wiedererinnern und Konsolidierung. Besonders die heutige
Score-Semantik führt dazu, dass nahezu jede Anfrage einen scheinbar starken
Top-Treffer erzeugt.

### 2.1 Verifizierte Momentaufnahme, noch kein reproduzierbarer Benchmark

Am 24. Juli 2026 read-only gemessene Größen auf dem aktuellen Vault mit 577
Memories:

| Messung | Ergebnis |
|---|---:|
| BM25-Schritt, 30-Tage-Produktionstelemetrie | n 22.819 · p50 1 ms · p95 11 ms · p99 25 ms |
| BM25-Ad-hoc-Benchmark, Methode nicht archiviert | p50 5,1 ms · p95 13,3 ms · p99 19,3 ms |
| PreTool-Hook gesamt | Median 141 ms · p95 255 ms |
| Recall-Anteil im Daemon | Median 95 ms · p95 223 ms |
| SessionStart | Median 381 ms · p95 499 ms |
| MCP-Recall | Median 105 ms · p95 200 ms |
| Ad-hoc-Paraphrasen, Provenienz nicht archiviert | Recall@1 45,2 % · Recall@3 57,1 % · MRR 0,521 |
| Anti-Query-Topscore | Median 137,7 |

30-Tage-Telemetrie:

| Signal | Ergebnis |
|---|---:|
| erreichbare PreTool-Aufrufe | 4.009 |
| Topscore ≥ heutiger Required-Schwelle | 4.006 · 99,9 % |
| ausgespielte Required-Hinweise | 16.762 |
| davon geladen | 153 · 0,9 % |
| davon als `acted_on` gewertet (Token-Overlap-Proxy) | 82 · 0,5 % der ausgespielten Hinweise |
| geschätzte injizierte Hint-Tokens | 519.588 |
| Tokens pro als `acted_on` gewertetem Memory (Proxy) | ca. 6.336 |

Die Telemetriegrößen stammen aus der bestehenden `stats.ts`-Methodik. Das
30-Tage-Fenster wandert; geringfügig andere Werte bei einem späteren Run sind
deshalb kein Widerspruch.

Die Produktionszeile zum BM25-Schritt stammt aus
`recall_stages.bm25_search_ms`; bei der Gegenprüfung am 24. Juli 2026 enthielt
das wandernde Fenster 22.819 passende Events. Die getrennten
BM25-Ad-hoc-, Paraphrasen- und Anti-Query-Werte wurden mit read-only Läufen
gemessen, aber noch nicht als versioniertes Run-Artefakt mit Befehlszeile,
Methode, Code-, Vault-, Modell-, Konfigurations- und Datensatz-Hash gespeichert.
Insbesondere ist für die 45,2-%-Paraphrasenmessung keine von der
Memory-Oberfläche unabhängige Provenienz archiviert. Diese Werte sind
diagnostische Hinweise und dürfen erst nach M0 als offizielle Baseline gelten.

Die Load- und `acted_on`-Quoten beweisen nicht, dass jeder ungeladene Hinweis
falsch war. Sie messen das Gesamtsystem aus Retrieval, Hook-Formulierung,
Consumer-Verhalten und Telemetrie-Zuordnung. `acted_on` ist heute selbst ein
lexikalischer Token-Overlap-Proxy. Die Werte zeigen dennoch eindeutig, dass der
aktuelle absolute Score kein belastbares Relevanzversprechen ist und das
Required-Band als interne Steuerungsgröße nicht kalibriert ist. Der sichtbare
Hook-Text nennt die Treffer bereits „hints, not obligations“; Scope- und
Suppression-Bypässe hängen intern aber weiterhin an der 100er-Schwelle.

Die in dieser Instanz aktivierten zwei Sprach-Bridges waren nicht nur
theoretisch verdrahtet: In der ausgewerteten 30-Tage-Momentaufnahme erweiterten
sie 853 Queries. Ohne Opt-in oder ohne Bridge-Pool bleibt die Schicht
definitionsgemäß ein No-op. Die 853 Erweiterungen messen ausschließlich, wie
oft eine Bridge feuerte; sie belegen weder Trefferqualität noch einen kausalen
Recall-Lift.

### 2.2 Hauptprobleme

1. **Rang ist keine Wahrscheinlichkeit.** BM25 und skalierter RRF leben in
   unterschiedlichen Score-Räumen, verwenden aber dieselben absoluten Floors.

2. **Es fehlt echte Abstention.** Ein Ranking besitzt immer einen ersten Platz,
   auch wenn die richtige Antwort „nichts Passendes vorhanden“ lautet.

3. **Assoziation ist stärker als Hemmung.** Embeddings, Query-Expansion und
   Graph-Hops erhöhen Reichweite, aber nicht automatisch Präzision.

4. **Episoden und dauerhaftes Wissen konkurrieren im selben Abrufraum.**

5. **Vergessen ist nur aus Einzelregeln zusammengesetzt.** Zeit, Salience,
   Curator-Demotion und Floors ergeben noch keine einheitliche, erklärbare
   Accessibility.

6. **Der heiße Pfad ist unnötig seriell.** SessionStart führt mehrere Recall- und
   Metadatenanfragen nacheinander aus.

7. **Die Eval-Sets sind teilweise zu klein oder nicht produktionsnah.** Kleine
   synthetische Sets erreichen Deckenwerte, während reale Paraphrasen deutlich
   schwächer abschneiden.

8. **Der Hybrid-Stresspfad ist nicht verlässlich verdrahtet.** Ein
   `packages/daemon/scripts/eval-stress.ts --hybrid`-Lauf bleibt im aktuellen
   Stress-Harness strukturell BM25-only, weil dort kein `EmbeddingIndex`
   angelegt wird. Andere spezialisierte Eval-Arme können bereits echte
   Embeddings verwenden; die Aussage gilt ausdrücklich dem Stress-Harness.

9. **Retrieval und Consumer-Verhalten sind in der ROI-Messung vermischt.**
   Niedrige Load-Raten können durch irrelevante Treffer, Hook-Sprache,
   Consumer-Compliance oder unvollständige Telemetrie-Zuordnung entstehen.

10. **Die aktuelle Qualitätsmessung hat noch keine Run-Provenienz.** Ohne
    versioniertes Artefakt ist eine echte Vorher-/Nachher-Entscheidung nicht
    reproduzierbar.

Die Punkte 1, 2, 6 bis 10 sind unmittelbar verifizierte Probleme des
V1.0-Releasevertrags. Die Punkte 3 bis 5 begründen das langfristige Zielbild,
sind aber noch kein Beleg dafür, dass die dazu beschriebenen späteren
Komponenten jetzt gebaut werden müssen.

### 2.3 Fremdsystem-Evidenz und ihre Grenzen

Am 25. Juli 2026 wurden die Quellen einer externen Recherche zu vergleichbaren
Agent-Memory-Systemen abgerufen und ihre Kernbehauptungen einzeln geprüft. Das
Ergebnis stützt die Richtung dieses Dokuments. Es ändert nichts am Ist-Stand
aus 2.1, und kein geprüftes System liefert eine unabhängig replizierte Messung,
die eine Bastra-Entscheidung tragen könnte.

Verbindliche Konsequenz:

- Jede Fremdzahl wird mit ihrer Evidenzklasse geführt: peer-reviewed,
  Preprint, produktiv implementierter Code beziehungsweise Dokumentation,
  Anbieterbenchmark oder Eigenmessung des jeweiligen Projekts.
- Fremdzahlen dürfen Designentscheidungen motivieren. Sie sind niemals
  Messgate, Zielwert oder Abnahmekriterium für Bastra.
- Unterschiedliche Reader, Judges, Prompts, Top-k, Kandidatenpools,
  Kontextbudgets und Datensatzversionen verbieten eine gemeinsame Rangliste.

Die belegten Grenzen der stärksten zitierten Zahlen:

- Hindsight berichtet 91,4 % LongMemEval und 89,6 % LoCoMo sowie Recall unter
  200 ms bei 10.000 Memory Units ohne Backbone-Aufruf. Die im Paper genannte
  unabhängige Reproduktion stammt von Virginia Tech und Washington Post; beide
  stellen Co-Autoren des Papers. In derselben Tabelle liegt auf LoCoMo ein
  Fremdsystem mit 90,0 % vor Hindsight.
- Zeps LoCoMo 94,7 % und LongMemEval 90,2 % stehen ausschließlich auf der
  eigenen Research-Seite; Reader und Judge sind dasselbe Modell. Das
  zugehörige Paper nennt ältere, abweichende Werte.
- MAGMAs LoCoMo-Vorsprung von 0,700 gegenüber 0,590, 0,580 und 0,481 gilt nur
  für die LLM-as-a-Judge-Metrik. Die Hyperparameter wurden laut Appendix auf
  LoCoMo optimiert, während die Vergleichssysteme mit Defaults liefen; bei den
  lexikalischen Metriken liegt ein Vergleichssystem vorn.
- Ori Mnemos meldet HotpotQA-Ergebnisse aus einem Lauf mit 50 Fragen, und die
  Zahlen im Haupt-README weichen von denen im `bench`-Verzeichnis ab.
- Mem0 erreicht mit der Managed-Pipeline 94,8 % LongMemEval und 92,5 % LoCoMo,
  fällt auf BEAM bei 10 Millionen Token Historie aber auf 50,5 % Pass Rate,
  16,3 % Temporal Reasoning, 32,5 % Contradiction Resolution und 40,0 %
  Abstention.

Der letzte Punkt ist der wichtigste Einzelbefund der Recherche und der Grund
für das Delta an M5: Hohe Werte auf kurzen Konversationsbenchmarks sagen nichts
über Interferenz, Widerspruch und Abstention bei Wachstum. Genau diese
Eigenschaften sind Bastras Produktversprechen.

T-Mem, All-Mem und LongMemEval-V2 beziehungsweise AgentRunbook sind Preprints
ohne nachweisbare Annahme; für T-Mem ist zum Prüfzeitpunkt kein Code
veröffentlicht. Peer-reviewed belegt sind dagegen Hindsight als ACL-Demo,
MAGMA, Mem2ActBench und die Graph-Gegenposition aus derselben Konferenz.

## 3. Wissenschaftliche Leitplanken

Bastra simuliert kein biologisches Gehirn. V2 übernimmt nur Prinzipien, die sich
als nützliche Systemarchitektur übersetzen lassen.

### 3.1 Komplementäre Lernsysteme

Die Complementary-Learning-Systems-Theorie unterscheidet schnelles Lernen
einzelner Erfahrungen von langsamem Aufbau strukturierter Kenntnisse. Replay
verbindet beide Systeme.

Übertragung auf Bastra:

- schneller, append-only Episodenspeicher;
- langsamer, stabiler semantischer Speicher;
- regelmäßige, evidenzbasierte Konsolidierung statt sofortiger Generalisierung.

Quelle:
[Kumaran, Hassabis & McClelland – Complementary Learning Systems Theory Updated](https://pubmed.ncbi.nlm.nih.gov/27315762/)

### 3.2 Pattern Separation und Pattern Completion

Pattern Separation hält ähnliche Erfahrungen auseinander und reduziert
Interferenz. Pattern Completion rekonstruiert eine Erinnerung aus unvollständigen
Hinweisen.

Übertragung auf Bastra:

- getrennte Episoden, Versionen, Entities und Zeiträume;
- keine vorschnelle Verschmelzung ähnlicher Memories;
- BM25, Embeddings, Doc2query und Graph als Pattern-Completion-Werkzeuge;
- typed edges, Claims und Konflikterkennung als Pattern-Separation-Werkzeuge.

Quelle:
[Yassa & Stark – Pattern separation in the hippocampus](https://pubmed.ncbi.nlm.nih.gov/21788086/)

### 3.3 Replay und Konsolidierung

Offline-Reaktivierung kann neue und alte Erfahrungen integrieren und gleichzeitig
bestehendes Wissen schützen.

Übertragung auf Bastra:

- Curator als kontrollierter „Schlaf“-Pass;
- Mischung aus neuen, alten, erfolgreichen und widersprechenden Episoden;
- Vorschläge statt autonomer inhaltlicher Umschreibung;
- Beibehaltung der Ursprungsbelege.

Quelle:
[Singh, Norman & Schapiro – Sleep-dependent memory consolidation](https://pubmed.ncbi.nlm.nih.gov/36279437/)

### 3.4 Rekonsolidierung

Reaktivierte Erinnerungen können vorübergehend veränderbar werden und müssen
erneut stabilisiert werden. Die direkte biologische Evidenz stammt unter anderem
aus Tiermodellen; für Bastra ist dies eine Designanalogie, keine Gleichsetzung.

Übertragung auf Bastra:

- erfolgreicher Abruf eröffnet einen überprüfbaren Update-Kandidaten;
- neue Evidenz erzeugt eine Version oder `supersedes`-Beziehung;
- keine stille Überschreibung historischer Wahrheit.

Quelle:
[Nader, Schafe & LeDoux – Reconsolidation after retrieval](https://pubmed.ncbi.nlm.nih.gov/10963596/)

### 3.5 Adaptives Vergessen

Vergessen ist nicht nur Verlust. Die Unterdrückung konkurrierender Erinnerungen
kann zukünftige Interferenz reduzieren.

Übertragung auf Bastra:

- Zugänglichkeit reduzieren, nicht löschen;
- häufig ignorierte Konkurrenz dämpfen;
- erfolgreiche Wiederverwendung verstärken;
- Deep Recall erhält den Zugriff auf dormante Inhalte.

Quelle:
[Wimber et al. – Retrieval induces adaptive forgetting](https://pubmed.ncbi.nlm.nih.gov/25774450/)

## 4. Architekturprinzipien

1. **Hemmung vor zusätzlicher Assoziation.** Jede Erweiterung des Kandidatenraums
   braucht ein stärkeres Relevanz- oder Abstention-Gate.

2. **Zugänglichkeit ist nicht Existenz.** Ein Memory darf schwer erreichbar
   werden, ohne gelöscht zu werden.

3. **Rang ist nicht Vertrauen.** Interne Suchscores dürfen nie direkt als
   Nutzerversprechen ausgegeben werden.

4. **Keine Antwort ist ein gültiges Ergebnis.** `no_answer` ist ein normaler
   Systemzustand, kein Fehler.

5. **Arbeitskontext begrenzt Langzeitgedächtnis.** Ziel, Projekt, Dateien,
   Entities und Task-Phase filtern vor dem breiten Abruf.

6. **Episoden werden schnell gespeichert, Regeln langsam gelernt.**

7. **Jede Generalisierung behält ihre Evidenz.**

8. **Vergessen und Wiedererinnern müssen erklärbar sein.**

9. **Automatische Backend-Wahl wird gemessen, nicht geraten.**

10. **Human-in-the-loop bleibt für dauerhafte Regeln, Reflexe, Präferenzen,
    Konfliktauflösung und Löschung erhalten.**

11. **Local-first, Privacy und Survival-by-ID bleiben unverhandelbar.**

## 5. Zielbild

```text
Prompt / Tool Intent / Session Context
                |
                v
      Working-Memory Controller
      - goal, project, files, entities
      - task phase, recent errors, constraints
                |
                v
      Adaptive Retrieval Controller
      - exact/reflex lane
      - lexical lane
      - semantic lane
      - deep-recall lane
      - deadline + token budget
                |
       +--------+---------+
       |                  |
       v                  v
  Sparse Index       Vector Strategy
  BM25 / fields      Flat or HNSW
       |                  |
       +--------+---------+
                |
                v
        Candidate Evidence Set
        - lexical evidence
        - vector evidence
        - scope/time/source
        - accessibility
        - graph relations
                |
                v
      Deterministic Evidence Gate + Abstention
      - later: calibrated probability
                |
       +--------+---------+
       |                  |
       v                  v
  Normal Recall       Deep Recall
  Core + Orbit        Asteroidengürtel
       |                  |
       +--------+---------+
                |
                v
      bounded context / load-on-demand
                |
                v
      usage, correction and outcome signals
                |
                v
       Curator / Consolidation / Review
```

## 6. Gedächtnislagen

V2 trennt die Funktion von Memories, ohne den bestehenden Markdown-Vault
aufzugeben.

### 6.1 Working Memory

Flüchtiger Sitzungszustand, nicht automatisch dauerhaft:

- aktuelles Ziel;
- Projekt und Worktree;
- betroffene Dateien und Symbole;
- aktive Entities;
- aktuelle Task-Phase;
- jüngste Fehler und Korrekturen;
- bestätigte Constraints;
- offene Fragen;
- bereits geladene Memories.

Working Memory dient als Aufmerksamkeits- und Filtermodell. Es soll klein,
zeitnah und vollständig verwerfbar sein.

### 6.2 Episodic Memory

Neue Lane beziehungsweise neuer Memory-Typ `episode`:

- `occurred_at`;
- `session_id` oder stabiler Task-Bezug;
- Situation und Kontext;
- ausgeführte Handlung;
- Ergebnis;
- erfolgreich / fehlgeschlagen / teilweise;
- beteiligte Dateien, Symbole und Entities;
- Quelle oder Beleg;
- mögliche emotionale Salience;
- Links auf Entscheidungen, Lessons und andere Episoden.

Regeln:

- append-only als Standard;
- keine automatische Required-Injektion;
- primäre Nutzung für Deep Recall, Konsolidierung und Ursachensuche;
- alte Episoden dürfen verblassen, bleiben aber erhalten;
- ähnliche Episoden werden verknüpft, nicht still zusammengeführt.

### 6.3 Semantic Memory

Stabiles Wissen:

- Lessons;
- Decisions;
- Preferences;
- Project Facts;
- Workflows;
- References;
- Dokument-Sidecars.

V2 ergänzt beziehungsweise operationalisiert:

- strukturierte Claims;
- Evidenz-Links;
- `valid_from`;
- `valid_to`;
- `confidence`;
- `supersedes`;
- `contradicts`;
- `derived_from`;
- `last_verified_at`.

Semantische Memories entstehen aus expliziter Nutzeranweisung, gesicherter Quelle
oder bestätigter Konsolidierung.

#### Zeitachsen

Zeit ist nicht eine Größe, sondern vier. Sie werden getrennt benannt und nie
vermischt:

| Feld | Bedeutung |
|---|---|
| `occurred_at` | wann das Ereignis stattgefunden hat |
| `valid_from` / `valid_to` | in welchem Zeitraum eine Aussage in der Welt gilt |
| `recorded_at` | wann Recall die Aussage gespeichert hat |
| `derived_at` | wann eine abgeleitete Aussage erzeugt wurde |

Die heutigen Felder `created` und `updated` bleiben Schreibzeiten der Datei und
werden nicht nachträglich zu Ereignis- oder Gültigkeitszeit umgedeutet. Für
Regeln, Präferenzen, Lessons und Workflows ist `occurred_at` in der Regel leer
und `valid_to` optional; ein fehlendes `valid_to` bedeutet „gilt bis auf
Widerruf“ und nicht „unbegrenzt bewiesen“. Ein Widerspruch invalidiert eine
Aussage zeitlich, er löscht sie nicht.

Diese Felder sind Schemaarbeit und hängen am gesonderten Schemaentscheid aus
21.4. Bis dahin existieren sie höchstens als abgeleitete read-only Projektion.

#### Herkunft

Herkunft wird als eigenes Feld geführt, nicht als zweite Memory-Taxonomie.
`provenance_class` unterscheidet:

| Wert | Bedeutung |
|---|---|
| `user_asserted` | vom Nutzer oder einer autorisierten Quelle behauptet |
| `agent_observed` | vom Agenten beobachtetes Ereignis oder eigene Erfahrung |
| `derived` | aus anderen Memories oder Episoden abgeleitet |
| `hypothesis` | Vermutung ohne ausreichende Evidenz |
| `approved_rule` | vom Nutzer freigegebene Regel oder Reflex |

Abgeleitete Inhalte tragen zusätzlich Generator, Version und Konfidenz,
referenzieren ihre Evidenz über `derived_from` und dürfen einen
`user_asserted`-Inhalt niemals still ersetzen. Ein eigenes Meinungs- oder
Belief-Netz wird nicht eingeführt: Ein System, das eigene Überzeugungen mit
selbstverstärkender Konfidenz führt, widerspricht dem Grundsatz, dass Bastra
Nutzerwissen verwaltet und nicht eigene Positionen bildet.

### 6.4 Procedural / Reflex Memory

Die bestehende Reflex-Lane bleibt die prozedurale Schicht:

- deterministische Trigger;
- kleines Budget;
- keine fuzzy Selbstinjektion;
- Promotion nur nach Nutzerbestätigung;
- hohe Präzision vor Reichweite;
- jederzeit widerrufbar.

### 6.5 Historical Memory

Historical ist kein Löschzustand, sondern eine Abrufrolle:

- explizit ersetzt;
- zeitlich nicht mehr gültig;
- nur für Verlauf, Ursachenanalyse oder alte Projektstände relevant;
- über ID, Version, Zitat und Deep Recall weiterhin erreichbar;
- niemals als aktuelle Regel injizieren.

## 7. Adaptive Memory Accessibility

### 7.1 Definition

Accessibility ist ausdrücklich keine sechste Dämpfungsschicht. Wenn sie nach
erfolgreicher Evaluation live geht, vereinheitlicht und erklärt sie die
langfristigen Memory-Mechanismen, die heute getrennt als Staleness,
Curator-Demotion, Floors, Salience, Gültigkeit und später gegebenenfalls
Confidence wirken. Diese Mechanismen dürfen dann nicht zusätzlich noch einmal
unabhängig denselben Score multiplizieren.

Session-Dedup, Empty-Streak-Backoff und Turn-Kontext bleiben getrennte
Aufmerksamkeits- und Ausspielmechanismen. Sie beschreiben nicht die
Langzeitzugänglichkeit eines Memorys und fließen deshalb nicht in dessen
Accessibility ein.

Jedes Memory erhält eine berechnete `accessibility` zwischen 0 und 1. Sie ist
keine dauerhaft gespeicherte Wahrheit, sondern eine reproduzierbare Projektion
aus stabilen Feldern und Nutzungsdaten.

```text
accessibility =
    type_durability
  + successful_use_reinforcement
  + bounded_salience
  + source_confidence
  + explicit_floor
  + recent_verification
  - time_decay
  - repeated_non_use
  - contradiction_penalty
  - superseded_penalty
```

Die Formel beschreibt zunächst die Signalgruppen, nicht bereits eine
implementierte Score-Funktion. Exakte Gewichte, Zonen und selbst die Frage, ob
eine kontinuierliche Zahl stabiler ist als erklärbare Zustände, werden erst in
M3 entschieden. Die zugehörige V1.x-Stufe beginnt ausschließlich als read-only
Projektion im Sidecar und Mindspace.

### 7.2 Positive Signale

- expliziter Floor oder Pin;
- erfolgreicher `loaded` → `acted_on`-Pfad;
- wiederholte erfolgreiche Verwendung in verschiedenen Kontexten;
- aktuelle Bestätigung oder Review;
- hohe und belegte Quellen-Confidence;
- moderat begrenzte Salience;
- explizite Nutzeranweisung;
- aktive Abhängigkeit durch eine aktuelle Decision oder einen Workflow.

### 7.3 Negative Signale

- explizites `superseded_by`;
- abgelaufene Gültigkeit;
- bestätigter Widerspruch;
- wiederholt ausgespielt, aber nicht geladen;
- geladen, danach verworfen oder korrigiert;
- lange nicht erfolgreich verwendet;
- veralteter Projektstand;
- geringe oder unbekannte Quellenqualität.

Nichtladen ist nur ein schwaches negatives Signal. Das System kann nicht sicher
beobachten, ob ein Hinweis indirekt geholfen hat. Eine explizite Korrektur oder
ein nachweislich ersetzender Claim ist deutlich stärker.

### 7.4 Harte Regeln

- Alter allein darf kein Memory löschen oder historisch erklären.
- Floors verhindern das automatische Absinken in den Asteroidengürtel.
- `user-directed` darf nicht automatisch inhaltlich verändert werden.
- Salience darf fehlende Query-Relevanz nicht überstimmen.
- Ein ungültiges Memory darf durch hohe Usage nicht wieder „aktuell“ werden.
- Exakte ID-, Zitat- und Versionsabrufe umgehen den Accessibility-Floor.
- Accessibility beeinflusst spontane Zugänglichkeit, nicht Datenexistenz.

### 7.5 Accessibility-Zonen

Die folgenden Grenzen sind Startbereiche für die Evaluation, keine endgültigen
Produktkonstanten:

| Accessibility | Zone | Verhalten |
|---:|---|---|
| 0,80–1,00 | Core | bei hoher Query-Relevanz spontan injizierbar |
| 0,50–0,79 | Orbit | normaler Recall |
| 0,20–0,49 | Outer Orbit | nur bei deutlicher Query-Übereinstimmung |
| 0,00–0,19 | Asteroidengürtel | keine automatische Injektion; Deep Recall |
| explizit ersetzt | Historical | nur zeitlich/historisch oder über Nachfolger |

Die Zonen dürfen nicht direkt aus Alter berechnet werden. Sie entstehen aus der
gesamten Accessibility-Funktion.

## 8. Asteroidengürtel und Deep Recall

### 8.1 Bedeutung

Der Asteroidengürtel visualisiert Erinnerungen, deren spontane Zugänglichkeit
stark gesunken ist. Er ist:

- kein Papierkorb;
- kein Löschzustand;
- kein separates Wahrheitsarchiv;
- vollständig durchsuchbar;
- bewusst von automatischer Kontextinjektion getrennt.

Er entspricht dem menschlich vertrauten Zustand:

> „Ich weiß, da war etwas, aber ich muss tiefer danach suchen.“

### 8.2 Visuelle Darstellung im Mindspace

- Core-Memories liegen hell und zentral.
- Orbit-Memories bilden die regulären Systeme und Galaxien.
- Outer-Orbit-Memories werden kleiner, dunkler und weiter außen dargestellt.
- Dormante Memories bilden einen Asteroidengürtel um die aktive innere Galaxie.
- Saliente Memories behalten einen erkennbaren farbigen Kern.
- Ersetzte Memories erscheinen gebrochen oder transparent und zeigen eine
  gerichtete Verbindung zum Nachfolger.
- Widersprüche erscheinen als gespannte oder farblich abgesetzte Kante.
- Beim Öffnen eines Memories wird der Accessibility-Grund erklärt.

Beispiel:

```text
Asteroidengürtel
  accessibility: 0,14
  letzter erfolgreicher Einsatz: vor 214 Tagen
  surfaced: 11
  loaded: 1
  acted_on: 0
  Status: dormant, nicht veraltet
```

### 8.3 Interaktion

Der Nutzer kann den Gürtel bewusst betreten:

- „Tiefer suchen“;
- „Auch verblasste Erinnerungen durchsuchen“;
- „Ich weiß, dass wir dazu früher etwas hatten“;
- Klick auf den Asteroidengürtel im Mindspace.

Beim Eintritt wird sichtbar, dass sich die Retrieval-Tiefe ändert:

1. normale Ergebnisse bleiben als Referenz erhalten;
2. dormante Ergebnisse erscheinen schrittweise;
3. alte Versionen und Episoden werden gruppiert;
4. Beziehungen und Widersprüche werden erklärt;
5. der Nutzer kann einen Treffer reaktivieren, bestätigen oder historisch
   belassen.

### 8.4 Technischer Deep-Recall-Pfad

Deep Recall:

1. öffnet den Dormant-Filter;
2. erhöht den Kandidatenpool;
3. aktiviert Query-Expansion und Sprach-Bridges;
4. durchsucht Episoden und Historical Memories;
5. erlaubt kontrollierte typed Graph Traversal;
6. verwendet einen stärkeren lokalen Reranker, sofern verfügbar;
7. gruppiert nach Zeit, Entity, Claim und Version;
8. liefert weiterhin ein ehrliches `no_answer`, wenn nichts belastbar ist.

Deep Recall darf langsamer sein als Normal Recall. Er ist eine bewusste
Interaktion, kein impliziter Hook-Hot-Path.

### 8.5 Zwei Stufen statt „dasselbe Retrieval mit größerem k“

Deep Recall ist ausdrücklich kein Normal Recall mit erhöhtem `k`, gesenktem
Floor und mehr Tokens. Er hat zwei klar getrennte Stufen:

**Stufe 1 – strukturierter Deep Recall, deterministisch.** Dormant-Filter,
größerer Kandidatenpool, Query-Expansion und Bridges, Zeit- und Scope-Manifest,
exakte Identifier, gruppierte Ausgabe nach Zeit, Entity, Claim und Version.
Reproduzierbar, ohne Agentenschleife, im Sekundenbereich.

**Stufe 2 – agentischer Deep Recall, iterativ.** Zerlegung der Query in
Teilfragen, sichtbarer Suchbaum, gezielte Kombination von exakter, lexikalischer,
semantischer, zeitlicher und Graph-Suche je Ast, Markierung von Sackgassen,
Evidenzsammlung über IDs und Quellen, Konvergenzerkennung, Budgetmanager und
ausschließlich bewusst bestätigte Budgetverlängerung.

Beide Stufen liefern ihren Suchpfad mit und enden bei fehlender Evidenz mit
`no_answer`. Die Abbruchbedingungen von Stufe 2 sind explizit und nicht
verhandelbar:

1. kein neuer Evidenzgewinn über zwei aufeinanderfolgende Erweiterungen;
2. erschöpftes Zeit- oder Tokenbudget;
3. abgearbeitete Teilfragenliste ohne offene Äste.

Ohne diese Bedingungen ist Stufe 2 nicht freigabefähig. Ein Deep Recall, der
ohne Abbruchkriterium läuft, ist kein Feature, sondern ein Kostenrisiko.

Die Stufung folgt einer belegten Messung aus dem Umfeld agentischer
Erfahrungsspeicher: Dort erreicht ein strukturierter Mehrpool-Ansatz rund
58,6 % bei etwa 27 Sekunden pro Query, während die vollständig agentische
Variante rund 74,9 % bei 108 bis 140 Sekunden erreicht. Beides sind
Eigenmessungen der Autoren auf ihrem eigenen Benchmark und damit kein Zielwert
für Bastra (siehe 2.3). Verwertbar ist die Struktur der Aussage: Der Aufpreis
der Agentenschleife ist erheblich und muss bei Bastra gegen Stufe 1 einzeln
nachgewiesen werden, statt als gegeben angenommen zu werden.

## 9. Adaptive Retrieval Controller

Der Controller entscheidet nicht nur, was rankt, sondern welcher Abrufpfad
überhaupt nötig ist.

### 9.1 Eingaben

- Query;
- Tool-Intent;
- Working Memory;
- Projekt und Scope;
- Dateien, Symbole und Entities;
- Zeitbudget;
- Tokenbudget;
- gewünschte Recall-Tiefe;
- Vault-Größe und Indexgesundheit;
- verfügbare lokale Modelle;
- bisherige Trefferstärke und Abstention-Signal.

### 9.2 Routing

```text
Exact ID / citation / filename
  -> direct lookup + BM25 evidence

Hard reflex trigger
  -> deterministic reflex lane

Clear lexical query
  -> BM25 first

Ambiguous or paraphrased query
  -> BM25 + semantic lane

Large vector set
  -> selected vector backend: Flat or HNSW

Explicit deep-memory intent
  -> full Deep Recall including Asteroidengürtel
```

### 9.3 Normal-Recall-Kaskade

1. Query normalisieren.
2. Working-Memory-Kontext und harte Filter bestimmen.
3. Exakte IDs, Symbole, Pfade und Reflex-Trigger prüfen.
4. BM25 ausführen.
5. Lexikalische Evidenz bewerten.
6. Bei eindeutigem Ergebnis semantischen Arm überspringen.
7. Bei Mehrdeutigkeit oder Paraphrase Vector Search ausführen.
8. Kandidaten zusammenführen, ohne Score-Räume vorzutäuschen.
9. Top-Kandidaten optional lokal reranken.
10. Duplikate und nahe Varianten diversifizieren.
11. Kandidaten per deterministischem Evidenzentscheid als `required`,
    `optional` oder `no_answer` klassifizieren.
12. Bei unzureichender Evidenz abstain.
13. Nur ein begrenztes Ergebnis- und Tokenbudget ausspielen.

Eine kalibrierte Wahrscheinlichkeit ersetzt diesen Schritt erst später, wenn
M0/M1 einen unabhängigen, versionierten Goldbestand und genügend
Kalibrierungsfälle bereitstellen.

### 9.4 Deadline-Verhalten

- BM25 ist der garantierte schnelle Pfad.
- Semantische Suche erhält ein eigenes Teilbudget.
- Bei Deadline wird ein Vector-Aufruf abgebrochen oder ignoriert.
- Ein unvollständiger Hybridpfad darf nicht so tun, als wäre er vollständig.
- Der Response kennzeichnet `lexical_only`, `hybrid`, `degraded` oder
  `deep_recall`.
- Hooks blockieren nie auf einen langsamen Reranker.
- Ein Cross-Encoder läuft grundsätzlich nicht im PreTool- oder
  SessionStart-Budget. Er bleibt auf Deep Recall und auf Läufe mit
  nachweislich freier Restlatenz beschränkt. Vergleichbare Fremdsysteme
  reranken jeden Recall mit einem Cross-Encoder; sie haben aber auch kein
  Hook-Budget von 150 ms einzuhalten.

## 10. Relevanzevidenz, Abstention und spätere Kalibrierung

### 10.1 Neues Ergebnisobjekt

Rohe Suchscores bleiben Diagnosewerte. Die konsumierbare Entscheidung verwendet
in V1.0 keine vorgetäuschte Wahrscheinlichkeit, sondern einen
deterministischen, erklärbaren Evidenzentscheid:

```ts
interface RecallDecisionHit {
  id: string;
  decision: "required" | "optional" | "no_answer";
  abstain_reason?: string;
  evidence: {
    exact_identifier: boolean;
    recall_when_coverage: number;
    lexical_rank?: number;
    lexical_score?: number;
    vector_rank?: number;
    vector_similarity?: number;
    arm_agreement: boolean;
    scope_match: boolean;
    temporal_status: string;
    source_confidence?: number;
  };
  // Erst nach unabhängiger Kalibrierung und ausreichenden Labels:
  relevance_probability?: number;
  // Erst ab der später gegateten Accessibility-Stufe:
  accessibility?: number;
}
```

Die vorhandenen `acted_on`-Ereignisse reichen nicht, um eine
Relevanzwahrscheinlichkeit zu behaupten: Das aktuelle Signal ist ein
Token-Overlap-Proxy und das 30-Tage-Fenster enthält nur eine kleine Zahl
positiver Hook-Episoden. `relevance_probability` bleibt deshalb absent, bis M0
ein unabhängiges Goldset und eine echte Kalibrierungsmessung bereitstellt.

### 10.2 Evidenzsignale nach Reifestufe

Für V1.0 verfügbar oder innerhalb des freigegebenen Releasevertrags
deterministisch ableitbar:

- vollständige und partielle `recall_when`-Abdeckung;
- Phrase statt beliebigem Einzelwort;
- exakte Identifier-, Pfad-, Symbol- und Entity-Matches;
- scope- und projektspezifische Übereinstimmung;
- normalisierte BM25-Evidenz;
- tatsächliche Vector Similarity;
- Rangübereinstimmung der Arme;
- Query-Typ;
- Confidence und Quellenqualität;
- temporale Gültigkeit;
- erfolgreiche historische Nutzung;
- Neuheit und Duplikatgrad.

Erst in späteren, gesondert freizugebenden V1.x-/V2-Stufen:

- Accessibility nach bestandenem M3-Gate;
- Typed Graph Evidence nach eingeführtem und evaluiertem Kantenschema;
- Treffer auf abgeleiteten Cues nach bestandener Cue-Ablation und gesondertem
  Repräsentationsentscheid gemäß 11.4.

Ein Treffer auf einem abgeleiteten Cue öffnet höchstens den Kandidatenpfad zur
eigentlichen Evidenz. Er begründet für sich genommen niemals `required` und
wird nie selbst als Beleg ausgegeben.

### 10.3 Entscheidungen

Produktsemantik von V1.0:

- `required`: harter Anker oder mehrere voneinander unabhängige,
  deterministisch belegte Signale;
- `optional`: plausible Relevanz, aber keine sichere Pflicht;
- `no_answer`: die vorhandene Evidenz reicht für keine Ausspielung.

`deep-only` und `historical` kommen erst mit der gegateten Accessibility- und
Deep-Recall-Stufe hinzu.

Die alten absoluten Schwellen `30` und `100` werden nicht auf die neue Semantik
übertragen.

### 10.4 Training und Kalibrierung

Stufen:

1. deterministischer, erklärbarer Regelentscheid;
2. Shadow-Logging seiner Entscheidungen;
3. unabhängiges, versioniertes Goldset und kontrollierte Consumer-Experimente;
4. Offline-Kalibrierung erst bei ausreichenden und geeigneten Labels;
5. erst danach optional ein logistisches Modell oder kleiner Gradient-Booster;
6. `relevance_probability` nur bei nachgewiesener Kalibrierung ausgeben;
7. kein autonomes Online-Lernen ohne Rollback und Drift-Überwachung.

`surfaced-but-not-loaded` ist höchstens ein weak negative. `acted_on` ist
stärker, aber noch kein Goldlabel. Explizite Korrektur, Re-Query,
Nutzerverwerfung und unabhängig gelabelte Relevanz sind belastbarere Signale.

## 11. Embedding- und Vektorarchitektur

### 11.1 Feldbewusste Repräsentation

Ein einzelner monolithischer Vektor vermischt „wann soll das feuern?“ und „worum
geht es?“. V2 trennt:

#### Cue Vector

- `recall_when`;
- Titel;
- Tags;
- Aliases;
- Entities;
- Symbole;
- optional geprüfte `recall_when_expanded`.

#### Content Vector

- Summary;
- semantische Claims;
- Body-Chunks;
- Dokumentabschnitte;
- episodischer Kontext.

#### Struktur bleibt Filter

- Scope;
- Type;
- Zeit;
- Sensitivity;
- Accessibility-Zone;
- Historical-Status.

Strukturelle Felder werden nicht nur in Freitext eingebettet, sondern vor oder
während der Suche gefiltert.

### 11.2 Chunking

- lange Bodies werden abschnittsweise eingebettet;
- jeder Chunk behält Memory-ID, Heading und Offset;
- Memory-Ranking aggregiert Chunk-Evidenz;
- ein einzelner zufälliger Body-Anfang repräsentiert nicht mehr das gesamte
  Dokument;
- Ergebnis lädt weiterhin das Memory, nicht unkontrolliert alle Chunks.

Offline-Messungen und eine Chunking-on/off-Ablation auf langen Bodies sind
jederzeit zulässig. M2 testet Chunking nicht und kann es daher nicht
freigeben. Eine persistente Änderung der Vektor-/Indexrepräsentation durch
Cue-/Content-Dual-Vektoren oder Chunking benötigt einen gesonderten
Repräsentationsentscheid auf Basis dieser Ablationen; eine Live-Aktivierung
benötigt anschließend das zugehörige Qualitäts- und Migrationsgate.

### 11.3 Query-Embedding-Cache

- eigener Cache unabhängig vom finalen Recall-Response;
- Schlüssel enthält Modell, Dimension und normalisierte Query;
- begrenzte LRU-Größe;
- sichere Invalidierung bei Modellwechsel;
- SessionStart-Queries können vorgewärmt werden;
- keine dauerhafte Speicherung sensibler Query-Texte ohne explizite Entscheidung.

### 11.4 Cue-Schicht und Vertrauensklassen

Cue und Evidenz sind verschiedene Dinge. Ein Cue beantwortet „wann soll das
auftauchen?“, die Evidenz beantwortet „was steht da und warum stimmt es?“.
`recall_when` ist bereits heute ein handgeschriebener Zukunftscue, trägt im
BM25-Index das höchste Feldgewicht und bleibt die primäre autorisierte
Cue-Quelle. Es wird nicht ersetzt und nicht abgeschafft.

Zusätzliche Cues dürfen abgeleitet werden. Zwei Familien sind trennscharf genug,
um den Aufwand zu rechtfertigen:

| Cue-Familie | Frage | Warum eigenständig |
|---|---|---|
| `associative_bridge` | In welcher künftigen Situation wäre dieser einzelne Fakt wichtig? | Situative Relevanz ohne lexikalische oder semantische Nähe zur Query |
| `associative_horizon` | Welche größere Lage oder Aufgabe macht diese ganze Episode relevant? | Szenenbezug, den weder Titel noch Summary abbilden |

Beschreibende Item- und Szenen-Cues werden nicht als eigene Felder eingeführt.
Titel, Tags, `topic_path` und Summary decken diese Achse im bestehenden Index
bereits ab; ihre Verdopplung wäre bei der aktuellen Vault-Größe reine
Schemalast ohne erwartbaren Trefferzuwachs. Der Nutzen der Cue-Idee liegt
ausschließlich auf der assoziativen Achse — dort, wo ein Memory relevant ist,
obwohl es der Query nicht ähnelt.

Regeln:

- jeder abgeleitete Cue trägt Herkunft, Generator, Version, `derived_at` und
  Konfidenz;
- handgeschriebenes `recall_when` und abgeleiteter Cue haben verschiedene
  Vertrauensklassen und werden nie zu einem Feld verschmolzen;
- Cues öffnen Kandidaten, sind aber nie die ausgegebene Evidenz;
- die Schicht beginnt als read-only Sidecar-Projektion ohne jede
  Markdown-Änderung;
- eine persistente Aufnahme ins Vault-Schema benötigt denselben gesonderten
  Repräsentationsentscheid wie Dual-Vektoren und Chunking gemäß 11.2;
- Sensitivity, Scope und Egress-Regeln gelten für abgeleitete Cues unverändert;
- ein Cue, dessen Ziel-Memory sich ändert, wird als veraltet markiert, statt
  stillschweigend weiter zu feuern.

Rollback: Die Sidecar-Datei wird ignoriert. Retrieval verhält sich dann exakt
wie heute, weil `recall_when` und der BM25-Index unverändert bleiben.

## 12. Flat Search und HNSW

Dieser Abschnitt ist eine spätere Zielarchitektur. Der Vault mit zum
Messzeitpunkt 577 Memories begründet keine HNSW-Live-Aktivierung. Messungen,
Prototypen und Shadow-Vergleiche sind jederzeit zulässig. Recall soll bei
tatsächlich wachsender Vektormenge selbstständig und qualitätsgesichert zwischen
Flat und HNSW wechseln; live geht dieser Wechsel erst, wenn kontrolliertes
Profiling einen Flat-Search-Engpass und M5 den Qualitäts- und Latenzvorteil
belegen. Provider-Latenz allein ist kein HNSW-Argument.

### 12.1 Begriffe

Flat beziehungsweise Brute Force vergleicht den Query-Vektor mit jedem
gespeicherten Vektor. Das ist exakt, einfach und bei kleinen Vaults schnell.

HNSW bedeutet **Hierarchical Navigable Small World**. Es organisiert Vektoren in
einem mehrstufigen Nachbarschaftsgraphen und springt bei der Suche schnell in eine
wahrscheinlich relevante Region. Das ist deutlich skalierbarer, aber
approximativ.

### 12.2 Gemeinsame Schnittstelle

```ts
interface VectorSearchBackend {
  kind: "flat" | "hnsw";
  build(snapshot: VectorSnapshot): Promise<void>;
  upsert(items: VectorItem[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  search(query: Float32Array, options: VectorSearchOptions): Promise<VectorHit[]>;
  health(): VectorBackendHealth;
  snapshotId(): string;
}
```

Der Retrieval Controller kennt keine backend-spezifische Logik außerhalb dieser
Schnittstelle.

### 12.3 Automatische Wahl

Der Backend-Wechsel hängt nicht allein an einer magischen Memory-Zahl:

- Anzahl der Vektoren;
- Anzahl der Chunks;
- Vektordimension;
- gemessene Flat-p95-Latenz;
- verfügbare RAM-Menge;
- aktuelle Hardware;
- HNSW-Recall gegenüber Flat-Gold;
- Build- und Updatekosten;
- Fehlerrate und Indexgesundheit.

Startlogik:

1. Flat ist immer verfügbar und die Referenz.
2. Ab einer konfigurierbaren Größen- oder Latenzschwelle baut Recall HNSW im
   Hintergrund.
3. Shadow-Queries laufen gegen beide Backends.
4. HNSW wird nur aktiviert, wenn Geschwindigkeit und Qualitätsgate bestehen.
5. Der Wechsel erfolgt atomar auf einen vollständigen Snapshot.
6. Bei Korruption, Drift oder schlechter Qualität fällt Recall auf Flat zurück.
7. Manuelles Erzwingen bleibt für Diagnose möglich.

Praktische Erwartung, nicht harte Regel:

- unter einigen Tausend Vektoren meist Flat;
- zwischen einigen Tausend und 10.000 anhand realer p95-Messung entscheiden;
- ab deutlich größeren Chunk-/Memory-Mengen meist HNSW;
- Deep Recall darf bei kritischen Fällen Flat zur Verifikation nachziehen.

### 12.4 Qualitätsgate für HNSW

HNSW darf erst live gehen, wenn:

- Recall@10 gegenüber Flat mindestens 98 % erreicht;
- Gold-Recall@3 nicht relevant sinkt;
- keine Scope-/Sensitivity-Fehler auftreten;
- p95 messbar besser ist;
- Indexaufbau und inkrementelle Updates stabil sind;
- Neustart und Snapshot-Wiederherstellung getestet sind.

Die genauen Parameter wie `M`, `efConstruction` und `efSearch` werden durch
Benchmarking bestimmt und als Teil des Snapshot-Manifests gespeichert.

## 13. Typed Memory Graph

`related_via` bleibt als schwache semantische Nähe erhalten, darf aber nicht alle
Beziehungsarten vertreten.

V2-Beziehungen:

| Typ | Bedeutung |
|---|---|
| `related_to` | allgemeine semantische Nähe |
| `supports` | liefert Evidenz für einen Claim |
| `contradicts` | widerspricht einem Claim |
| `supersedes` | ersetzt eine ältere Version |
| `derived_from` | wurde aus Episode oder Quelle konsolidiert |
| `caused_by` | Ursache-Wirkung |
| `resolved_by` | Problem wurde dadurch gelöst |
| `applies_to` | gilt für Entity, Projekt, Datei oder Symbol |
| `example_of` | konkrete Episode eines semantischen Musters |

Regeln:

- automatische Cosine-Nähe erzeugt höchstens `related_to`;
- starke Kanten benötigen strukturelle Evidenz oder Bestätigung;
- Normal Recall traversiert höchstens kontrollierte typed edges;
- Deep Recall darf breiter traversieren;
- widersprechende oder historische Kanten werden sichtbar erklärt;
- Graph-Hops erhalten kein pauschales Score-Multiplikator-Modell.

### 13.1 Logische Sichten statt getrennter Graphen

Die Kantentypen werden zu logischen Sichten gebündelt — semantisch, temporal,
kausal und entity —, nicht zu getrennten physischen Graphen. Ein Vault dieser
Größenordnung rechtfertigt keine vierfache Speicherhaltung; der Gewinn liegt in
der getrennten Auswertbarkeit, nicht in getrennten Datenbanken. Der Query-Intent
bestimmt, welche Sichten mit welchem Hop-Budget überhaupt aktiv sind:

- Normal Recall nutzt höchstens die Entity- und die temporale Sicht mit einem
  harten Hop-Budget von eins;
- Deep Recall darf Sichten breiter kombinieren und mehrfach traversieren;
- kausale und temporale Kanten entstehen nie aus bloßer Ähnlichkeit, sondern
  benötigen strukturelle Evidenz oder eine Bestätigung;
- jede Sicht wird einzeln ablated und gegen einen No-Graph-Kontrollarm
  gemessen;
- eine Verbesserung des Gesamtergebnisses ohne bestandenen Kontrollarm gilt
  nicht als Beleg dafür, dass der Graph die Ursache war.

Der Kontrollarm ist keine Formalie. Eine peer-reviewte Vergleichsanalyse zerlegt
Graph- und Nicht-Graph-Memorysysteme in vergleichbare Komponenten und zeigt
beides: Ungeeignete Graphkonstruktion verschlechtert Ergebnisse, und starke
flache Baselines bleiben häufig konkurrenzfähig — aber gut konstruierte Kanten
aus Entity-Beschreibungen schlagen flache Indizes teilweise deutlich. Das
verbietet ein Dogma in beide Richtungen: weder „Graph immer“ noch „flach
reicht“. Entschieden wird pro Sicht und pro Query-Klasse, nicht global.

## 14. Konsolidierung als kontrollierter Schlaf-Pass

### 14.1 Eingang

Der Pass betrachtet eine Mischung aus:

- neuen Episoden;
- älteren ähnlichen Episoden;
- häufig erfolgreich verwendeten Memories;
- wiederholt ignorierten Kandidaten;
- Korrekturen;
- Widersprüchen;
- zeitlich abgelaufenen Decisions;
- bestehenden semantischen Regeln.

Nur die größten Topic-Path-Cluster zu betrachten reicht nicht.

### 14.2 Operationen

1. Episoden nach Entity, Claim, Ursache, Lösung und Ergebnis clustern.
2. Ähnliche Episoden bewusst getrennt halten.
3. Wiederkehrende Muster identifizieren.
4. Gegenbeispiele und Fehlschläge einbeziehen.
5. Widersprüche erkennen.
6. Kandidat für neue Lesson, Decision oder Workflow erzeugen.
7. Ursprungsbelege über `derived_from` erhalten.
8. Confidence und Gültigkeitsbereich vorschlagen.
9. Nutzerbestätigung einholen.
10. Episoden bestehen lassen und nur ihre Accessibility anpassen.

### 14.3 Replay-Mischung

Der Replay-Sampler darf nicht nur das zuletzt Häufige wählen:

- Anteil neuer Episoden;
- Anteil alter, noch relevanter Episoden;
- Anteil selten verwendeter, aber hoch salienter Memories;
- Anteil widersprechender oder korrigierter Fälle;
- Anteil zufälliger Kontrollfälle.

Dadurch wird verhindert, dass das System nur das bereits Dominante weiter
verstärkt.

### 14.4 Nichtdestruktive Topologie-Operatoren

Konsolidierung äußert sich ausschließlich in benannten, reversiblen
Vorschlägen. Es gibt keine freie inhaltliche Umschreibung:

| Operator | Wirkung |
|---|---|
| `SPLIT` | ein zu breites Memory wird in mehrere Nachfolger zerlegt |
| `MERGE` | mehrere Memories werden zu einem Nachfolger zusammengeführt |
| `UPDATE` | Inhalt oder Gültigkeit eines Memorys wird fortgeschrieben |
| `LINK` | eine typisierte Kante wird vorgeschlagen |
| `SUPERSEDE` | ein Memory wird als ersetzt markiert und bleibt zitierbar |
| `DORMANT` | die Zugänglichkeit wird gesenkt, der Inhalt bleibt vollständig |
| `REACTIVATE` | die Zugänglichkeit wird nach belegtem Bedarf angehoben |

Für jeden Operator gilt:

- er referenziert alle Eingaben vollständig;
- er erzeugt eine neue Version oder abgeleitete Repräsentation und löscht keine
  Evidenz;
- er trägt Begründung und Konfidenz;
- er wird vor der Persistenz vom Nutzer freigegeben;
- er ist einzeln zurückrollbar, weil der Vorgängerzustand zitierbar bleibt;
- ein nicht angenommener Vorschlag hinterlässt keinen Zustand im Vault.

Zusätzlich gilt eine Erreichbarkeitsgarantie: Jede archivierte, dormante oder
konsolidierte Quelle bleibt vom sichtbaren Bestand aus über eine begrenzte Zahl
typisierter Links erreichbar. Eine sichtbare Memory darf eine archivierte Quelle
repräsentieren, aber niemals still deren Inhalt ersetzen. Der Asteroidengürtel
ist damit eine Zugänglichkeitsaussage, keine Löschung — und die
Konsolidierung darf diese Eigenschaft nicht unterlaufen.

## 15. Rekonsolidierung und Versionen

Erfolgreicher Abruf kann einen Review-Kandidaten erzeugen:

```text
Memory geladen
  -> im Tool-Kontext verwendet
  -> neue Evidenz oder Korrektur beobachtet
  -> Rekonsolidierungs-Kandidat
  -> no-op, bestätigen, patchen oder neue Version
```

Regeln:

- kein automatisches Überschreiben aufgrund eines einzelnen Toolaufrufs;
- alte Version bleibt zitierbar;
- aktuelle Version zeigt auf Vorgänger;
- Vorgänger zeigt auf Nachfolger;
- historische Queries können den damaligen Zustand abrufen;
- normale Queries bevorzugen aktuell gültige Claims;
- Konflikte werden nicht durch Recency allein entschieden.

## 16. Hook- und Session-Orchestrierung

### 16.1 SessionStart

Ein `GET /hook/session-context` existiert bereits. Er dient heute dem
MCP-Forwarder für hooklose Clients, ist bewusst projektlos, schließt
projektbezogene und `all-projects`-Hints aus und assembliert seine Quellen
ebenfalls weitgehend sequenziell. Er ist deshalb kein Drop-in-Ersatz für den
Claude-Code-SessionStart-Hook.

V1.0 baut keinen zweiten konkurrierenden Session-Context-Pfad. Der vorhandene
Server-Assembler wird zur gemeinsamen Implementierung erweitert:

```text
GET  /hook/session-context
  -> rückwärtskompatibler, projektloser Forwarder-Pfad

POST /hook/session-context
  -> cwd / project / source / budgets
  -> preferences
  -> project context
  -> cross-project rules
  -> floors
  -> taxonomy
  -> care/import/onboarding state
  -> health
```

Der Claude-Code-Hook ruft danach den projektfähigen Pfad einmal auf. Hooklose
Clients behalten den bisherigen GET-Vertrag. Serverseitig laufen unabhängige
Schritte parallel. Die Response besitzt:

- globales Zeitbudget;
- globales Tokenbudget;
- priorisierte Blöcke;
- klare Degraded-Kennzeichnung;
- Abbruch nichtkritischer Teile bei Deadline.

### 16.2 PreToolUse und Prompt

- exakte und lexikalische Prüfung zuerst;
- semantischer Arm nur bei Bedarf;
- kein pauschales Multi-Hop;
- `no_answer` wird respektiert;
- Required nur aus dem deterministischen Evidenzentscheid; eine kalibrierte
  Wahrscheinlichkeit kommt erst nach M1-Labelevidenz infrage;
- Backoff gilt auch für scheinbar starke Treffer, wenn deren Relevanz nicht
  unabhängig belegt ist;
- identische Routinglogik wird zentral geteilt.

### 16.3 Kontextbudget

Ein globaler Context Governor entscheidet:

- wie viele Memories ausgespielt werden;
- wie viele Token verbraucht werden;
- ob nur Titel/Summary oder voller Load nötig ist;
- ob ein bereits geladenes Memory erneut erwähnt werden darf;
- welche Zonen automatisch ausgeschlossen sind.

## 17. Lernen aus Nutzung

### 17.1 Positive Signale

- `loaded` und anschließend `acted_on`;
- explizites „Das war richtig“;
- wiederholte erfolgreiche Verwendung in unterschiedlichen Situationen;
- ein Memory verhindert nachweislich einen zuvor wiederkehrenden Fehler;
- ein Deep-Recall-Treffer wird reaktiviert.

### 17.2 Negative Signale

- Nutzer verwirft oder korrigiert den Treffer;
- unmittelbare Re-Query mit anderer Formulierung;
- geladen, aber als unpassend markiert;
- wiederholt ausgespielt und nie geladen;
- Claim wird durch neue Evidenz ersetzt.

### 17.3 Selektionsbias

Nur ausgespielte Memories können geladen werden. Deshalb gilt:

- `surfaced-not-loaded` ist kein sicherer Beweis für Irrelevanz;
- `acted_on` ist heute ein lexikalischer Proxy, kein Ground-Truth-Label;
- Out-of-pool-Fälle liefern keine direkten Rankinglabels;
- Learned Ranking wird zunächst ausschließlich shadow betrieben;
- Coverage und Rankingqualität werden getrennt gemessen;
- Exploration bleibt klein, kontrolliert und transparent.

### 17.4 Retrieval und Präsentation getrennt messen

Die Hook-Load-Quote hängt nicht allein vom Ranking ab. Für den
V1.0-Releasevertrag werden getrennte Arme benötigt:

1. identische Treffer mit unterschiedlicher Hook-Formulierung;
2. identische Formulierung mit und ohne deterministisches Abstention-Gate;
3. unabhängige Relevanzlabels für eine Stichprobe ausgespielter und
   zurückgehaltener Kandidaten;
4. Task-/Tool-Erfolg zusätzlich zu `loaded` und `acted_on`;
5. Auswertung getrennt nach Client, Hook-Quelle und Query-Klasse.

Die Arm-Zuweisung erfolgt deterministisch pro pseudonymer Session-ID. Eine
Session verbleibt für alle zugehörigen Ereignisse im selben Arm. Das Mindest-N
pro Arm wird nach dem M0-Baseline-Run festgelegt und gemeinsam mit
Zuweisungsfunktion und Experimentkonfiguration versioniert abgelegt.

Tokens pro `acted_on` bleiben eine wichtige System-ROI-Metrik, werden aber nicht
als reine Retrieval-Precision interpretiert.

### 17.5 Nutzungssignale jenseits von `acted_on`

`acted_on` bleibt ein Token-Overlap-Proxy. Die folgenden Signale sind
belastbarer und werden erhoben, sobald sie ohne Schemaänderung verfügbar sind:

- explizite Annahme oder Ablehnung eines Hinweises;
- spätere Nennung einer Memory-ID im weiteren Verlauf;
- Edit einer Datei nach dem Recall, die der Hinweis betrifft;
- neue Memory, die erkennbar aus dem Hinweis entstanden ist;
- wiederholter Recall desselben Memorys über unterschiedlich formulierte
  Queries;
- Task- oder Tool-Erfolg;
- nachweislich vermiedener Regel- oder Sicherheitsverstoß;
- Korrektur nach falschem Recall;
- Reaktivierung eines dormanten Memorys nach Deep Recall;
- dokumentierte Sackgasse in einem Deep-Recall-Ast.

Pflichten für jede Auswertung dieser Signale:

- **Exposure-Korrektur.** Ein häufig ausgespieltes Memory sammelt automatisch
  mehr positive Ereignisse und gilt deshalb nicht als besser belegt. Jedes
  Signal wird auf die Zahl seiner Ausspielungen normiert, und die Korrektur
  wird im Report ausgewiesen. Ohne sie misst das System nur seine eigene
  bisherige Auswahl.
- Nichtreaktion bleibt ein schwaches Negativ und wird nie als sicheres
  Negativlabel verwendet.
- Jedes Signal trägt Client, Hook-Quelle, pseudonyme Session und Experimentarm.
- Kein Signal wirkt live auf das Ranking vor bestandenem M6.
- Query-Rohtexte gehen nicht ohne gesonderte Datenschutzentscheidung in eine
  langfristige Lerndatenbank ein.

## 18. Messgates auf dem Weg von V1 zu V2

Die Messgates prüfen nicht nur Recall@k. Sie prüfen die gesamte
Entscheidungskette aus Coverage, Relevanz, Abstention, Accessibility, Latenz und
Kontextkosten.

### 18.0 Freigabestatus

Der V1.0-Releasevertrag umfasst M0, den deterministischen Teil von M1, den
gemeinsamen projektfähigen Session-Assembler und das
Kontext-/Consumer-Experiment aus Abschnitt 17.4. Messungen, Prototypen,
Shadow-Betrieb und read-only Projektionen für M2 bis M5 dürfen jederzeit
beginnen; Qualitätsvergleiche, die eine Referenzwirkung behaupten, werden erst
gegen eine belastbare M0-Baseline interpretiert. Ein reines M6-Shadow-Modell
setzt M0 und M1 voraus, nicht aber M3 bis M5. Schema-/Vertragsänderungen und
Live-Aktivierungen bleiben bis zum jeweils benannten Gate und einer expliziten
Freigabe gesperrt.

Die Bezeichnung `M` steht für Messgate. Sie ist bewusst von den
Produktversionen V1/V2 getrennt.

### 18.1 M0 – Messwahrheit herstellen

Ziel:

- sicherstellen, dass jeder Eval-Arm tatsächlich den produktiven Codepfad
  ausführt.

Arbeit:

- `packages/daemon/scripts/eval-stress.ts --hybrid` muss einen echten
  `EmbeddingIndex` anlegen;
- verwendetes Modell und Backend werden im Report ausgewiesen;
- die aktuelle Produktionsformel `max(k × 4, 20)` wird im Report ausgewiesen
  (beim Paraphrasen-Slice mit `k=10` heute 40, bei kleineren `k` meist 20);
- der Candidate Pool wird ausschließlich für die entsprechenden Evals
  explizit auf mindestens 100 oder 200 erweitert;
- Near, Far-in-pool und Far-out-of-pool werden getrennt gelabelt;
- veraltete Gold-IDs werden entfernt oder versioniert;
- Eval-Queries werden unabhängig von der aktuellen Memory-Oberfläche erstellt;
- Datensatzmanifest und privates Run-Artefakt führen für jeden Goldfall
  `origin_type`, `authoring_mode` und `origin_ref_hash`;
- Label-Shuffle-Null und Kontrollarm werden im Harness implementiert und im
  Report ausgewiesen;
- jeder Run erhält Code-, Vault-, Modell-, Konfigurations- und Datensatz-Hash;
- Befehlszeile, Roh-stdout/stderr, Manifest und strukturierte JSON-Ergebnisse
  werden unter `~/.bastra/eval-runs/<datum>-<hash>/` als versioniertes
  Run-Artefakt gespeichert;
- nach dem Baseline-Run werden die numerischen M1-Toleranzen festgelegt und
  versioniert abgelegt;
- im öffentlichen Repository werden ausschließlich aggregierte Reports ohne
  Vault-abgeleitete Query-Texte gespeichert. Die geringere
  Dritt-Reproduzierbarkeit wird zugunsten der Vault-Privacy akzeptiert;
- jede im Report zitierte Fremdzahl trägt ihre Evidenzklasse gemäß 2.3;
- ein späterer Standardbenchmark-Lauf wird nur mit Harness-Version, Modell-,
  Judge- und Promptversion, Kontextbudget, Top-k sowie getrennter Ausweisung
  von Retrieval- und Antwortmetrik archiviert.

Gate:

- kein stiller Arm-Fallback;
- keine unbekannten Gold-IDs;
- reproduzierbarer Report;
- Label-Shuffle-Null und Kontrollarm vorhanden;
- keine Fremdzahl ohne Evidenzklasse und keine gemeinsame Rangliste aus
  Messungen mit unterschiedlichem Reader, Judge, Top-k oder Kontextbudget.

### 18.2 M1 – Relevanz und Abstention

Hypothese:

> Ein deterministischer, erklärbarer Relevanz- und No-answer-Gate reduziert
> Fehlinjektionen stark, ohne den Recall echter Gold-Memories relevant zu
> verschlechtern.

Datensätze:

- echte unabhängige Paraphrasen;
- Anti-Halluzinationsqueries;
- Cross-Scope-Fälle;
- Identifier und technische Symbole;
- deutsche, englische und gemischte Queries;
- harte semantische Distraktoren;
- absichtlich leere Queries mit keinem passenden Memory.

Metriken:

- Recall@1/@3/@10;
- MRR und nDCG;
- Precision der Required-Band;
- False-Interrupt-Rate;
- Abstention Precision/Recall;
- unabhängige menschliche beziehungsweise kuratierte Relevanzlabels;
- Context-Tokens pro `acted_on`;
- Rate echter Golds, die fälschlich abstained wurden;
- Load-/Use-Rate getrennt nach Hook-Formulierung, Client und Hook-Quelle;
- Argumenttreue bei handlungsbezogenen Fällen, also die korrekte Übernahme
  gespeicherter Pfade, Limits, Präferenzen und Sicherheitsregeln in die
  Argumente eines Tool-Aufrufs;
- korrekte Nichtanwendung einer irrelevanten Memory;
- Premise Awareness bei Queries mit falscher Voraussetzung;
- falsche Anwendung einer inhaltlich richtigen Memory.

Die handlungsbezogenen Metriken haben einen konkreten Anlass: Eine peer-reviewte
Arbeit zur Anwendung von Erinnerung in Tool-Aufrufen misst für passives
Retrieval rund 30,7 Argument-F1 gegenüber rund 53,8 bei perfektem
Oracle-Retrieval. Der Engpass liegt also im Finden der richtigen Evidenz und
nicht im Formulieren der Antwort. Das ist genau die Größe, die V1.0 verbessern
will — sie muss deshalb auch gemessen werden und nicht nur Recall@k.

Definitionen:

- `nDCG@k` verwendet die versionierte Relevanzskala `0 = irrelevant`,
  `1 = optional relevant`, `2 = klar relevant`; Fälle ohne abgestuftes
  Goldlabel werden nur mit MRR/Recall ausgewertet.
- `False-Interrupt-Rate` ist der Anteil der Gold-`no_answer`-Queries, bei denen
  der Hook trotzdem mindestens ein Memory automatisch injiziert.

AUROC, Calibration Error und `relevance_probability` werden erst in einer
späteren Kalibrierungsstufe verwendet, wenn M0/M1 genügend geeignete Labels
bereitstellen.

Vorläufige Komponenten-Schaltgates für den Evidenzentscheid:

- Anti-Query-Fehlinjektionen < 5 %;
- kein relevanter Recall@3-Verlust gegenüber demselben ungegateten
  Retrieval-Arm;
- Required benötigt harten Anker oder unabhängige Arm-Evidenz;
- kein relevanter Verlust bei Identifier-Queries;
- Falsch-Abstention bleibt unter der in M0 festgelegten Toleranz;
- ein Treffer auf einem abgeleiteten Cue erzeugt für sich genommen kein
  `required`.

Recall@3 ≥ 85 % auf unabhängigen realen Paraphrasen, Context-Tokens pro
erfolgreicher Nutzung, Load-/Use-Rate und die zunächst angestrebte zehnfache
Context-ROI-Verbesserung werden ab V1.0 als Systemziele beobachtet. Sie sind
weder Live-Schaltgates des Evidenzentscheids noch vor Abschluss von M0 pauschale
V1.0-Releasebedingungen: Die absolute Coverage hängt auch vom Retrieval-Arm ab;
die übrigen Größen messen Retrieval, Hook-Formulierung, Consumer-Verhalten und
Telemetrie-Zuordnung gemeinsam.

Die numerischen Komponenten-Grenzen und die Systemziele werden erst nach dem
reproduzierbaren M0-Baseline-Run finalisiert.

Shadow-Abnahme:

- mindestens 14 Kalendertage oder mindestens 500 geloggte
  Hook-Entscheidungen;
- alle retrieval-isolierten Komponentengates bestehen auf dem versionierten
  Goldset;
- jede beobachtete `required`/`no_answer`-Divergenz zwischen Legacy- und
  Evidenzentscheid ist durch Features, Reason-Code oder Review erklärbar;
- unerklärte Divergenzen blockieren die Live-Aktivierung.

Rollout und Rollback:

- Live-Aktivierung erfolgt hinter einem Konfigurations-Flag;
- bei Fehler, Drift oder operativer Unsicherheit fällt Recall sofort auf das
  heutige Score-/Floor-Verhalten zurück;
- es gibt keinen Hard-Cutover;
- der Legacy-Pfad wird erst nach dokumentiert stabilem Live-Betrieb und einer
  gesonderten Freigabe entfernt.

### 18.3 M2 – Adaptive Retrieval-Kaskade

Hypothese:

> BM25-first mit bedingtem Semantic Recall senkt p95, ohne die semantische
> Coverage zu verlieren.

Arme:

- heutiger Always-Hybrid-Pfad;
- BM25-only;
- adaptive Kaskade;
- adaptive Kaskade plus bedingter lokaler Reranker;
- adaptive Kaskade plus Gravity- und Hub-Dämpfung;
- adaptive Kaskade plus abgeleitete Cue-Schicht mit Bridge- und
  Horizon-Cues, jeweils mit und ohne Rückbindung an die Evidenz;
- flacher Kontrollarm ohne jede Graph-Sicht als Referenz für spätere
  Graph-Experimente.

Gravity- und Hub-Dämpfung sind eigene Arme und keine Neuauflage der bereits
produktiven Dämpfung: Heute wirken Lifecycle-, Curator-, Doc- und
Salience-Multiplikatoren auf den vollen Kandidatenpool vor dem k-Schnitt.
Gravity-Dämpfung adressiert stattdessen semantisch nahe Treffer ohne
Query-Term-Überlappung, Hub-Dämpfung die Dominanz stark verlinkter Knoten.
Beide bleiben Hypothese, bis der Ablationsarm einen Präzisionsgewinn ohne
Recall-Verlust zeigt.

Metriken:

- p50/p95/p99;
- Provider-Aufrufe pro Recall;
- Query-Cache-Hitrate;
- Energie-/Modellresidenz;
- Recallqualität pro Query-Klasse;
- Timeout- und Degraded-Rate;
- Bridge- und Horizon-Recall@k auf assoziativen Goldfällen;
- Cue-to-Evidence-Precision und Rate falscher Assoziationen;
- assoziative False-Interrupt-Rate;
- Cue-Übertragung zwischen deutschen und englischen Queries.

Live-Gates:

- PreTool p95 < 150 ms;
- SessionStart p95 < 300 ms;
- BM25-eindeutige Queries lösen keinen unnötigen Provider-Aufruf aus;
- semantische Query-Klassen verlieren nicht mehr als die definierte Toleranz;
- ein Dämpfungs- oder Cue-Arm geht nur live, wenn er die
  False-Interrupt-Rate senkt oder die assoziative Coverage erhöht, ohne den
  Recall@3 des ungedämpften Arms zu verschlechtern.

M2 gibt weiterhin keine persistente Repräsentationsänderung frei. Eine
dauerhafte Speicherung abgeleiteter Cues benötigt denselben gesonderten
Repräsentationsentscheid wie Chunking und Dual-Vektoren gemäß 11.2 und 11.4.

### 18.4 M3 – Accessibility und Asteroidengürtel

Hypothese:

> Ein zoniertes Accessibility-Modell reduziert spontane Interferenz, während
> Deep Recall alte Memories zuverlässig wiederfindet.

Testfälle:

- häufig erfolgreich verwendete aktuelle Memories;
- alte, nie gebrauchte Memories;
- alte, aber hoch saliente Memories;
- gefloorte Memories;
- ersetzte Decisions;
- widersprechende Claims;
- dormant Memory mit exaktem Identifier;
- bewusste Deep-Recall-Query;
- dieselbe Deep-Recall-Query gegen einen Kontrollarm mit lediglich
  vervierfachtem `k` und gesenktem Floor.

Metriken:

- korrekte Zonenklassifikation;
- spontane False-Injection-Rate aus dem Gürtel;
- Deep-Recall@k für dormante Golds;
- Erklärbarkeit der Zonenentscheidung;
- Reaktivierungsrate nach erfolgreichem Deep Recall;
- Survival-by-ID und Zitierbarkeit;
- Zeit bis zur ersten belastbaren Evidenz;
- Zahl der Suchäste, Sackgassenquote und Konvergenzquote;
- Budgetüberschreitungen und Zahl bewusster Budgetverlängerungen;
- Evidence Coverage und Zitationsvollständigkeit;
- Qualität der `no_answer`-Fälle;
- falsche Reaktivierungen.

Live-Gates:

- Floors sinken nie automatisch in Deep-only;
- Historical wird nie als aktuelle Regel ausgegeben;
- exakte IDs bleiben erreichbar;
- Deep Recall findet definierte dormante Golds;
- Normal Recall injiziert keine Belt-Memories ohne außergewöhnlich starke,
  explizit messbare Evidenz;
- der agentische Pfad aus 8.5 wird nie aus einem Hook heraus ausgelöst;
- Stufe 1 schlägt den `k`-Kontrollarm messbar, sonst ist der Deep-Recall-Modus
  nicht gerechtfertigt;
- Stufe 2 geht nur live, wenn sie gegenüber Stufe 1 einen eigenen, an Kosten
  und Latenz gemessenen Nutzen zeigt und ihre Abbruchbedingungen aus 8.5
  nachweislich greifen.

### 18.5 M4 – Episoden und Konsolidierung

Hypothese:

> Die Trennung von Episoden und Semantik reduziert Interferenz und erzeugt
> bessere dauerhafte Lessons.

Metriken:

- Cluster Precision;
- Anteil Generalisierungen mit vollständiger Evidenz;
- Gegenbeispiel-Abdeckung;
- Widerspruchserkennung;
- Nutzerannahme der Vorschläge;
- Rate falscher oder zu früher Generalisierungen;
- Retrievalqualität vor und nach Konsolidierung;
- Korrektheit von Punkt-in-der-Zeit-Abfragen über die vier Zeitachsen aus 6.3;
- Trennschärfe der `provenance_class` in Stichproben;
- Rate falscher Kanten und Entity-Linking-Fehler je logischer Sicht;
- Ergebnis jeder Sicht gegen den No-Graph-Kontrollarm;
- Reversibilität jeder ausgeführten Topologie-Operation.

Schema-/Live-Gates:

- keine autonome Regeländerung;
- jede Lesson verweist auf ihre Episoden oder Quelle;
- Widersprüche werden angezeigt, nicht still überschrieben;
- Episode bleibt nach Konsolidierung erhalten;
- ein Widerspruch invalidiert eine Aussage zeitlich und löscht sie nicht;
- eine historische Aussage bleibt nach `SUPERSEDE` über ID, Version und Zitat
  erreichbar;
- jede archivierte Quelle bleibt über höchstens die definierte Zahl typisierter
  Links erreichbar;
- eine Graph-Sicht geht nur live, wenn sie ihren No-Graph-Kontrollarm schlägt;
- jede Topologie-Operation ist vor der Persistenz freigegeben und einzeln
  zurückrollbar.

### 18.6 M5 – Flat/HNSW-Automatik

Hypothese:

> Automatische Backend-Wahl verbessert große Vaults, ohne relevante Treffer
> gegenüber exakter Flat Search zu verlieren.

Skalen:

- aktueller Vault;
- 1.000;
- 3.000;
- 10.000;
- 50.000 Memories beziehungsweise Chunks.

Metriken:

- Buildzeit;
- RAM;
- Indexgröße;
- Update- und Delete-Latenz;
- Search-p50/p95/p99;
- Recall@3/@10 gegen Flat-Gold;
- Snapshot-Recovery;
- automatische Switch-Entscheidung;
- Fallback-Zeit.

Zusätzlich misst jede Skalenstufe nicht nur Geschwindigkeit, sondern den
Qualitätszerfall unter Wachstum:

- Abstention-Precision und -Recall;
- Auflösung widersprechender Memories;
- temporale Fragen mit Versions- oder Gültigkeitsbezug;
- Interferenz durch semantisch benachbarte Memories;
- korrekte Reihenfolge zeitlich geordneter Ereignisse.

Der Anlass ist belegt: Ein verbreitetes Fremdsystem erreicht auf kurzen
Konversationsbenchmarks Werte über 90 %, fällt aber bei zehn Millionen Token
Historie auf rund 50 % Pass Rate, mit deutlich schlechteren Teilwerten für
temporale Fragen, Widerspruchsauflösung und Abstention. Ein reiner
Latenz- und Recall-Blick auf die Skalenleiter würde diesen Zerfall nicht
sichtbar machen. Absolutwerte des Fremdsystems sind dabei kein Zielwert
(siehe 2.3); relevant ist ausschließlich der eigene Verlauf über die
Skalenstufen.

Live-Gates:

- Recall@10 gegenüber Flat ≥ 98 %;
- keine Sensitivity- oder Scope-Leaks;
- p95 tatsächlich besser;
- atomarer, wiederholbarer Switch;
- Flat-Fallback jederzeit funktionsfähig;
- kein überproportionaler Abfall von Abstention-, Widerspruchs- oder
  Temporalqualität zwischen zwei Skalenstufen ohne benannte Ursache.

### 18.7 M6 – Learned Ranking und Accessibility

Ein reines Shadow-Modell darf nach abgeschlossenen M0 und M1 beginnen. M3 bis
M5 sind dafür keine Voraussetzung; Signale aus noch nicht existierenden Stufen
bleiben im Modell abwesend:

- Shadow-Modell;
- keine Live-Mutation;
- Zeit-Split statt zufälligem Split;
- Projekte und Personen getrennt evaluieren;
- positives, negatives und zensiertes Feedback unterscheiden;
- Driftmonitoring;
- reproduzierbarer Rollback;
- ausgewiesene Exposure-Korrektur gemäß 17.5 auf jedem Nutzungssignal;
- Mindest-N je Query-, Client- und Hook-Klasse vor jeder Aussage über Lift;
- Co-Occurrence-Projektionen ausschließlich shadow und nur mit Hub-Kontrolle;
- eine Stufenentscheidung zwischen Ausführen, Überspringen und Aussetzen darf
  frühestens nach erreichtem Mindest-N überhaupt aktiv werden, und die
  Grundstufen BM25 und exakter Abruf bleiben immer garantiert verfügbar.

Live-Freigabe nur nach bestandenem M6, nachgewiesenem inkrementellem Lift über
den deterministischen Evidenzentscheid, erklärbarem Verhalten und
reproduzierbarem Rollback. Der Fallback ist die deterministische Reihenfolge des
Evidenzentscheids und nicht das Legacy-Score-Verhalten.

## 19. Eval-Datensätze

Der wachsende V1→V2-Goldbestand benötigt mindestens:

- unabhängige reale Paraphrasen;
- echte No-answer-Queries;
- harte semantische Distraktoren;
- Cross-Scope- und Cross-Project-Fälle;
- Zeit- und Versionsfragen;
- widersprechende Memories;
- exakte IDs, Pfade und Symbole;
- Deutsch, Englisch und gemischte technische Sprache;
- Episoden gegen semantische Regeln;
- Dormant- und Deep-Recall-Fälle;
- private und team/public Sensitivity;
- Dokumente mit langen Bodies;
- Query-Typen aus realer Hook-Telemetrie;
- handlungsbezogene Fälle, in denen eine frühere Regel, ein Pfad, ein Limit
  oder eine Sicherheitsvorgabe in die Argumente eines Tool-Aufrufs eingehen
  muss, einschließlich Fällen, in denen die korrekte Antwort das
  Nichtanwenden einer vorhandenen Memory ist;
- assoziative Fälle, deren Query dem Ziel-Memory weder lexikalisch noch
  semantisch ähnelt und die nur über den situativen Zusammenhang auflösbar
  sind.

Jeder Fall erhält:

- Query;
- unabhängige Herkunft;
- erwartete IDs;
- akzeptable Alternativen;
- erwartete Zone;
- `no_answer` ja/nein;
- Scope;
- Zeitpunkt beziehungsweise Versionssicht;
- erlaubte Retrieval-Tiefe;
- Begründung des Goldlabels.

Zulässige unabhängige Query-Quellen sind datenschutzkonform aufbereitete reale
Session-Transkripte, ursprüngliche Task-Texte, Issue-/Incident-Beschreibungen,
direkt vom Nutzer formulierte Suchanfragen und eine unabhängig arbeitende
Zweitperson. Beim Formulieren oder Auswählen der Query dürfen Body, Summary und
`recall_when` des Ziel-Memorys nicht geöffnet werden. Die Zuordnung zum
Gold-Memory erfolgt erst danach durch einen getrennten Label-Schritt.

Für jeden Goldfall sind im Datensatzmanifest und im privaten Run-Artefakt
folgende Provenienzfelder verpflichtend:

- `origin_type`: `session_transcript`, `task_text`, `issue_incident`,
  `user_query` oder `second_person`;
- `authoring_mode`: wie die Query unabhängig gewonnen oder formuliert wurde;
- `origin_ref_hash`: datenschutzkonformer Hash der lokalen Herkunftsreferenz.

Rohtext oder eine auflösbare lokale Herkunftsreferenz bleiben privat und werden
nicht in aggregierte öffentliche Reports übernommen.

### 19.1 Externe Standardbenchmarks

Das lokale Goldset bleibt der maßgebliche Maßstab für Bastras Produktscope.
Externe Standardbenchmarks für Langzeitgedächtnis beantworten eine andere Frage
— externe Vergleichbarkeit — und sind deshalb Adapterarbeit in V1.x, nicht Teil
des V1.0-Releasevertrags. Insbesondere ist kein vollständiger Lauf eines
großskaligen Trajektorien-Benchmarks eine V1.0-Releasebedingung; ein
repräsentatives lokales Subset genügt für die erste Einordnung.

Für jeden externen Lauf gelten die Regeln aus 2.3 und M0: Evidenzklasse,
Harness- und Modellversionen, Kontextbudget und Top-k werden mitgeführt, und
Retrieval- wird von Antwortqualität getrennt ausgewiesen. Ein externer Score ist
nie ein Live-Gate. Es wird ausdrücklich nicht auf einen einzelnen
Headline-Score optimiert.

## 20. Produktmetriken

Die Recall-Evolution optimiert nicht nur Suchtreffer:

Metriken werden erst mit der Datenquelle ihrer jeweils gegateten Stufe messbar.
Bis dahin beschreiben sie das Zielbild und dürfen nicht als vorhandene
Produkttelemetrie ausgegeben werden.

### Qualität

- Recall@k;
- MRR/nDCG;
- Required Precision;
- No-answer-Qualität;
- Konflikt- und Temporal Accuracy;
- Deep-Recall-Erfolg.

### Aufmerksamkeit

- Hook-Emissionen;
- geladene Hinweise;
- `acted_on`;
- Tokens pro erfolgreichem Einsatz;
- Wiederholungs- und Backoff-Rate;
- Anteil störender Hinweise.

### Geschwindigkeit

- p50/p95/p99 je Retrieval-Lane;
- Provider-Zeit;
- Cache-Hitrate;
- SessionStart-Zeit;
- Timeout- und Degraded-Rate.

### Gedächtnisgesundheit

- Episoden pro konsolidierter Lesson;
- ungeklärte Widersprüche;
- historische Versionen;
- Dormant-Anteil;
- reaktivierte Memories;
- veraltete Quellen;
- Anteil Memories ohne belastbare Evidenz.

## 21. Migration

### 21.1 V1.0 – Freigegebener Releasevertrag, keine Schemaänderung

- M0-Eval-Harness reparieren und reproduzierbare Run-Artefakte erzeugen;
- Score-, Evidenz-, Abstention- und No-answer-Telemetrie um `client`,
  `hook_source` und eine pseudonyme `session_id` erweitern;
- deterministischen Evidenzentscheid zunächst shadow ausführen und erst nach
  bestandenen retrieval-isolierten M1-Komponentengates aktiv schalten;
- den bestehenden Session-Context zu einem gemeinsamen, projektfähigen
  Assembler erweitern;
- unabhängige Serveranteile innerhalb dieses Assemblers parallelisieren;
- ein globales Kontext- und Latenzbudget einführen;
- Retrievalqualität und Wirkung der Hook-Formulierung in getrennten
  Experimentarmen messen.

### 21.2 V1.x/M2 – Adaptive Retrieval, live noch nicht freigegeben

Messung, Prototyp und Shadow-Betrieb sind jederzeit zulässig. Ein
Qualitätsvergleich wird erst gegen die M0-Baseline interpretiert. Eine
Live-Aktivierung erfolgt erst, wenn M2 sein Qualitäts- und Latenzgate erfüllt:

- BM25-first-Kaskade;
- bedingter semantischer Arm;
- Query-Embedding-Cache;
- Deadline- und Degraded-Verhalten;
- keine Verschlechterung der semantischen Query-Klassen.

### 21.3 V1.x/M3 – Accessibility und Deep Recall, live noch nicht freigegeben

Read-only Projektionen und Deep-Recall-Experimente sind jederzeit zulässig. Eine
Live-Aktivierung erfolgt erst, wenn M1 relevante alters-, konflikt- oder
zugänglichkeitsbedingte Interferenz nachweist und M3 sein Gate erfüllt. Die
Stufe beginnt ohne Schemaänderung:

- Accessibility ausschließlich als read-only Sidecar-Projektion;
- keine Markdown-Massenänderung;
- Zone und Gründe im UI anzeigen;
- Asteroidengürtel als read-only Projektion;
- Deep Recall experimentell und erst nach bestandenem M3-Gate live.

### 21.4 V1.x/M4 – Memory-Lanes, Claims und Konsolidierung, Schema/live noch nicht freigegeben

Isolierte Messungen, Fixture-/Sidecar-Prototypen und read-only Projektionen sind
jederzeit zulässig. Jede persistente Vault-Schema- oder Vertragsänderung
benötigt einen gesonderten Schemaentscheid auf Basis der bis dahin verfügbaren
Evidenz. Eine Live-Migration folgt ausschließlich nach bestandenem M4:

Memory-Lanes und Schema:

- `episode` ergänzen;
- optionale Claim-/Evidenzfelder;
- Version- und typed-edge-Schema;
- alte Memories bleiben vollständig kompatibel;
- Defaults werden aus bestehendem Type abgeleitet.

Konsolidierung:

- Replay-Sampler;
- Cluster und Widerspruchsvorschläge;
- Human Review;
- keine autonome semantische Mutation.

### 21.5 V1.x/M5 – Vector Strategy, live noch nicht freigegeben

Messung, Prototyp und Shadow-Implementierung sind jederzeit zulässig. Eine
Live-Aktivierung erfolgt erst, wenn kontrolliertes Profiling auf der
Zielhardware einen realen Flat-Search-Engpass und M5 den Qualitäts- und
Latenzvorteil belegen. Providerlatenz allein ist kein Grund für HNSW:

- Backend-Abstraktion;
- Flat als Referenz;
- HNSW im Shadow;
- automatisches Qualitäts- und Latenzgate;
- atomarer Switch mit Fallback.

### 21.6 V1.x/M6 – Learned Layer, live noch nicht freigegeben

- reiner Shadow-Beginn nach stabiler Messgeometrie und abgeschlossenen M0/M1;
- M3–M5 sind für das Shadow-Modell keine Voraussetzung;
- shadow-first;
- zeitbasierte Offline-Evaluation;
- Live-Aktivierung nur nach bestandenem M6, expliziter Freigabe und
  nachgewiesenem Rollback.

### 21.7 V2.0 – Promotion statt Big-Bang

V2.0 wird erst vergeben, wenn die verpflichtenden Eigenschaften aus 26.2
gemeinsam nachgewiesen sind. Experimentelle V1.x-Funktionen werden nicht allein
durch ihre Existenz zu V2-Bestandteilen. Sie benötigen stabile Verträge,
Rückwärtskompatibilität, dokumentierte Migration, Rollback und ihre jeweils
bestandenen Messgates.

## 22. Rückwärtskompatibilität

- Markdown bleibt Source of Truth.
- Bestehende Memory-Typen bleiben gültig.
- `recall_when` bleibt das primäre handgeschriebene Abrufsignal.
- Bestehende IDs bleiben stabil.
- Alte Clients können weiterhin Lean-Hits erhalten.
- Neue Entscheidungs- und Evidenzfelder werden additiv eingeführt.
- Eine `relevance_probability` wird erst nach erfolgreicher Kalibrierung
  additiv angeboten; vorher bleibt sie abwesend.
- Ohne Embeddings funktioniert BM25 vollständig.
- Ohne HNSW funktioniert Flat Search vollständig.
- Ohne Accessibility-Sidecar gelten konservative Default-Zonen.
- Ohne Mindspace bleibt Deep Recall über API/CLI erreichbar.

## 23. Privacy und Sicherheit

- Kein neuer Cloudzwang.
- Query- und Memory-Embeddings respektieren bestehende Provider- und
  Egress-Regeln.
- Sensitivity wird vor Retrieval und erneut vor Ausgabe geprüft.
- HNSW darf keine ausgefilterten privaten IDs über Nachbarschaft oder Diagnose
  leaken.
- Working Memory wird standardmäßig nicht dauerhaft gespeichert.
- Episodenaufnahme folgt denselben Capture- und Injection-Schutzregeln.
- Nutzerinhalte werden niemals als ausführbare Anweisungen aus dem Vault
  behandelt.
- Pseudonyme Experiment-Session-IDs enthalten keinen Query- oder Vault-Inhalt.
- Rohartefakte aus Eval-Runs bleiben lokal; öffentliche Reports enthalten
  keine Vault-abgeleiteten Query-Texte.
- Deep Recall erweitert Reichweite, nicht Berechtigungen.
- Soft Delete und Survival-by-ID bleiben erhalten.
- Das bestehende Audit des Mac-Bridge-Mutationspfads bleibt erhalten. Ein
  einheitliches Audit für reguläre MCP-/HTTP-Mutationen ist gesonderte spätere
  Arbeit und wird hier nicht als bereits vorhandene Eigenschaft vorausgesetzt.
- Abgeleitete Cues, Manifeste und Graph-Projektionen unterliegen denselben
  Scope-, Sensitivity- und Egress-Regeln wie der zugrunde liegende Inhalt. Ein
  Manifest darf einen Filter nicht dadurch umgehen, dass es aggregiert.
- Deep Recall und Manifeste erweitern die Reichweite innerhalb bestehender
  Berechtigungen; sie erzeugen keine neuen.
- Nutzungssignale und Utility-Historie enthalten keine Query-Rohtexte, solange
  dafür keine gesonderte Datenschutzentscheidung vorliegt.

## 24. Was ausdrücklich nicht zuerst gebaut wird

- kein größeres Embedding-Modell als Antwort auf falsche Required-Hits;
- keine tieferen untypisierten Graph-Hops;
- keine aggressive automatische Triggervermehrung;
- kein aggressiveres automatisches Speichern;
- kein autonomes Umschreiben von Nutzerwissen;
- keine HNSW-Live-Schaltung ohne Flat-Vergleich;
- keine Salience-Live-Gewichtung ohne ausreichende Shadow-Evidenz;
- kein Learned Ranker auf einem fehlerhaften oder driftenden Kandidatenpool;
- kein Meinungs- oder Belief-Netz mit eigener, selbstverstärkender Konfidenz;
- keine getrennten physischen Graphdatenbanken je Relationstyp;
- kein Cross-Encoder im PreTool- oder SessionStart-Budget;
- keine automatische Ausführung von Konsolidierungs-Operatoren ohne Freigabe;
- keine Live-Gewichtung aus Q-Werten oder Co-Occurrence-Kanten ohne
  Exposure- und Hub-Kontrolle;
- keine zweite epistemische Memory-Taxonomie neben den bestehenden Typen;
- kein vollständiger Lauf eines großskaligen Trajektorien-Benchmarks als
  V1.0-Blocker;
- keine Ersetzung von Evidenz durch Cue- oder Triggertexte;
- keine Übernahme eines Fremdsystem-Zielwerts als Bastra-Gate.

## 25. Umsetzungsreihenfolge

V1.0:

1. Messwahrheit und reproduzierbare Baselines.
2. Deterministische Relevanzevidenz und echte Abstention.
3. Gemeinsamer projektfähiger Session-Assembler mit interner Parallelisierung.
4. Globales Kontextbudget und getrenntes Retrieval-/Präsentationsexperiment.

Bis einschließlich Punkt 4 ist die Umsetzung als V1.0 freigegeben. Alle
folgenden Nummern ordnen Schema-/Vertragsänderungen und Live-Aktivierungen.
Messung, Shadow-Betrieb und read-only Projektionen bleiben unabhängig davon
zulässig; Qualitätsaussagen mit Referenzwirkung setzen M0 voraus:

5. BM25-first-Kaskade und Query-Embedding-Cache live nach bestandenem M2.
6. Abgeleitete Accessibility und Asteroidengürtel live nach M1-Nachweis und
   bestandenem M3.
7. Deep Recall Stufe 1 live nach bestandenem M3; Stufe 2 erst nach
   zusätzlichem Nachweis eigenen Nutzens gegenüber Stufe 1 gemäß 8.5.
8. Cue-/Content-Vektoren, abgeleitete Cue-Schicht und Chunking persistent oder
   live erst nach gesondertem Repräsentationsentscheid gemäß 11.2 und 11.4;
   M2 allein genügt nicht.
9. Episodic Memory, strukturierte Claims, die Zeitachsen aus 6.3 und die
   `provenance_class` persistent erst nach gesondertem Schemaentscheid, live
   nach bestandenem M4.
10. Typed Graph, logische Sichten, Versionen und Rekonsolidierung persistent
    erst nach gesondertem Schemaentscheid gemäß 21.4, live nach bestandenem M4
    und je Sicht bestandenem No-Graph-Kontrollarm.
11. Kontrollierte Konsolidierung mit den Proposal-Operatoren aus 14.4 live nach
    bestandenem M4.
12. Flat-/HNSW-Strategie live erst, wenn kontrolliertes Profiling einen
    Flat-Search-Engpass und M5 den Qualitäts- und Latenzvorteil belegen.
13. Learned Ranking shadow nach M0/M1, live erst nach bestandenem M6.

## 26. Definition of Done

### 26.1 Releasevertrag V1.0

V1.0 ist fertig, wenn:

- jeder Eval-Lauf als reproduzierbares, versioniertes Artefakt mit Code-,
  Vault-, Modell-, Konfigurations- und Datensatz-Hash vorliegt;
- der Hybrid-Stress-Eval nachweislich einen echten `EmbeddingIndex` benutzt und
  keinen stillen BM25-Fallback als Hybrid ausweist;
- keine unbekannten Gold-IDs oder unprotokollierten Candidate-Pool-Größen in
  die Auswertung eingehen;
- jeder Goldfall die verpflichtenden Provenienzfelder im Datensatzmanifest und
  privaten Run-Artefakt trägt;
- die numerischen M1-Toleranzen nach dem M0-Baseline-Run versioniert
  festgeschrieben sind;
- Run-Artefakte im privaten Eval-Verzeichnis vollständig sind und öffentliche
  Reports keine Vault-abgeleiteten Query-Texte enthalten;
- der deterministische Evidenzentscheid zunächst im Shadow geprüft wurde;
- der Shadow-Betrieb die festgelegte Mindestdauer beziehungsweise
  Mindestfallzahl erreicht und die retrieval-isolierten M1-Komponentengates vor
  der Live-Schaltung bestanden hat;
- die Live-Schaltung hinter einem Konfigurations-Flag liegt und der
  Score-/Floor-Legacy-Pfad als getesteter Fallback erhalten bleibt;
- Hook und Session-Context `no_answer` respektieren und schwache Treffer nicht
  allein wegen eines inkompatiblen Rohscores als Required behandeln;
- der gemeinsame Session-Assembler Projektpfad und Scope korrekt übernimmt,
  seine unabhängigen Serveranteile parallel ausführt und für vorhandene Clients
  kompatibel bleibt;
- ein globales Token- und Latenzbudget die gesamte Session-Antwort begrenzt;
- Retrievalqualität, Hook-Formulierung und Consumer-Verhalten getrennt
  ausgewertet werden;
- `client`, `hook_source` und pseudonyme Session-Zuordnung die dafür
  erforderlichen Telemetriedimensionen liefern;
- Experimentarme deterministisch pro Session zugewiesen werden und ihr nach M0
  versioniertes Mindest-N erreicht haben;
- Context-ROI als Systemmetrik reproduzierbar messbar ist, ohne die
  Live-Schaltung einer korrekten Retrievalentscheidung zirkulär zu steuern;
- dafür weder Vault-Schema, Memory-Typen noch Vector-Backend migriert werden.

### 26.2 Promotion zu V2.0

V2.0 gilt nicht als fertig, wenn lediglich neue Komponenten existieren. Die
Promotion erfolgt erst, wenn:

- Recall zuverlässig nichts sagt, wenn nichts passt;
- Required wieder ein belastbares Relevanzversprechen ist;
- reale unabhängige Paraphrasen das Qualitätsgate erfüllen;
- Hook-Kontext deutlich weniger Tokens pro erfolgreicher Nutzung verbraucht;
- Normal Recall innerhalb des Latenzbudgets bleibt;
- der Asteroidengürtel Zugänglichkeit erklärt, ohne Memories zu verlieren;
- Deep Recall dormante Erinnerungen bewusst zurückholen kann;
- Episoden und dauerhafte Regeln getrennte Rollen besitzen;
- jede Konsolidierung ihre Evidenz behält;
- alte Versionen zitierbar bleiben;
- abgeleitete Inhalte ihre Herkunft tragen und keinen Nutzerfakt still
  ersetzen;
- Ereignis-, Gültigkeits-, Aufnahme- und Ableitungszeit getrennt beantwortbar
  sind;
- HNSW nur dann automatisch aktiviert wird, wenn es auf der aktuellen Hardware
  messbar sinnvoll und qualitativ sicher ist;
- jede adaptive Entscheidung shadow-getestet, erklärbar und zurückrollbar ist.

## 27. Kurzfassung

Bastra Recall 0.8.6 wird zuerst zu V1.0: einem reproduzierbar messbaren,
selektiven und kontrollierbaren Recall-System. Während V1.x werden weitere
Gedächtnisfunktionen nur nach bestandenen Messgates ergänzt. V2.0 bezeichnet
schließlich das gemeinsam bewiesene, adaptive und mehrschichtige
Gedächtnissystem:

- Working Memory steuert Aufmerksamkeit.
- Episodic Memory speichert Erfahrungen schnell und getrennt.
- Semantic Memory hält bestätigtes, stabiles Wissen.
- Reflex Memory trägt bewusst freigegebene Routinen.
- Accessibility steuert, wie leicht etwas spontan auftaucht.
- Der Asteroidengürtel bewahrt dormante Erinnerungen sichtbar und auffindbar.
- Deep Recall erlaubt bewusstes „Wühlen“ in alten Zusammenhängen.
- Ein adaptiver Controller wählt BM25, Flat Vector, HNSW oder Deep Recall nach
  Query, Vault, Hardware, Qualität und Zeitbudget.
- Deterministische Relevanzevidenz und Abstention verhindern zunächst, dass
  Rang mit Wahrheit verwechselt wird; eine kalibrierte Wahrscheinlichkeit darf
  später nur auf unabhängigen Labels aufsetzen.
- Konsolidierung und Rekonsolidierung entwickeln Wissen weiter, ohne seine
  Geschichte zu löschen.

Das Ziel ist nicht maximaler Recall. Das Ziel ist:

> Zur richtigen Zeit die richtige Erinnerung – und ansonsten Ruhe.

## 28. Delta-Ledger der Recherche-Revision (C-029–C-039)

Dieser Abschnitt dokumentiert die Deltas dieser Fassung gegenüber dem
abgenommenen Stand C-001–C-028. Jeder Eintrag nennt die betroffene Passage, die
Art des Deltas, die tragende Evidenz, das Gate, die Datenquelle, das
Abnahmekriterium und den Rollback. Kein Eintrag deutet ein früheres Urteil um.

### C-029 – Evidenzklassen für Fremdsystemzahlen

- **Passage:** 2.3 (neu), 18.1 M0 unter Arbeit und Gate.
- **Art:** Architekturentscheidung mit Messfolge.
- **Evidenz:** Quellenprüfung vom 25. Juli 2026 (Abschnitt 29). Die im
  Hindsight-Paper genannte unabhängige Reproduktion stammt von Institutionen,
  die Co-Autoren stellen. Zeps Bestwerte stehen nur auf der eigenen
  Research-Seite und verwenden dasselbe Modell als Reader und als Judge.
  MAGMAs Hyperparameter wurden laut Appendix auf dem Vergleichsbenchmark
  optimiert, während die Baselines mit Defaults liefen. Oris Zahlen weichen
  zwischen Haupt-README und `bench`-Verzeichnis voneinander ab.
- **Gate:** M0.
- **Datenquelle:** Report-Metadaten des Eval-Harness, Quellenmatrix 29.
- **Abnahmekriterium:** Kein Report enthält eine Fremdzahl ohne Evidenzklasse;
  keine gemeinsame Rangliste über Messungen mit unterschiedlichem Reader,
  Judge, Top-k oder Kontextbudget.
- **Rollback:** Reine Dokumentations- und Reportregel ohne Laufzeitwirkung.

### C-030 – Trennung von Cue und Evidenz

- **Passage:** 10.2, 11.4 (neu), 18.2 M1 Schaltgates, 18.3 M2 Arme und
  Metriken, 25 Punkt 8.
- **Art:** Architekturentscheidung.
- **Evidenz:** T-Mem (Preprint) belegt die Unterscheidung nach Granularität und
  Orientierung sowie die bewusste Entkopplung von Trigger und Evidenzpfad.
  Bastras `recall_when` trägt bereits heute das höchste BM25-Feldgewicht
  (`packages/core/src/search.ts:179`), das maschinell expandierte Feld ein
  deutlich niedrigeres — die Vertrauensklassen sind also schon implementiert
  und werden hier nur konsequent fortgeschrieben.
- **Gate:** M2-Ablation und anschließend derselbe gesonderte
  Repräsentationsentscheid wie für Chunking und Dual-Vektoren.
- **Datenquelle:** assoziative Goldfälle aus 19, Sidecar-Projektion,
  M2-Report.
- **Abnahmekriterium:** Der Bridge-/Horizon-Arm hebt die assoziative Coverage
  oder senkt die False-Interrupt-Rate, ohne Recall@3 gegenüber dem Arm ohne
  Cues zu verschlechtern; ein Cue-Treffer erzeugt nie allein `required`.
- **Rollback:** Sidecar-Datei ignorieren. Da `recall_when` und der BM25-Index
  unverändert bleiben, entspricht das exakt dem heutigen Verhalten.

### C-031 – Deep Recall als eigener zweistufiger Modus

- **Passage:** 8.5 (neu), 9.4, 18.4 M3, 25 Punkt 7.
- **Art:** Architekturentscheidung.
- **Evidenz:** Der LongMemEval-V2-Preprint misst für einen strukturierten
  Mehrpool-Ansatz rund 58,6 % bei etwa 27 Sekunden gegenüber rund 74,9 % bei
  108 bis 140 Sekunden für die vollständig agentische Variante. Beides sind
  Eigenmessungen und keine Zielwerte; verwertbar ist der belegte Kostensprung
  zwischen den beiden Bauformen. Ergänzend: Hindsight und Zep reranken jeden
  Recall per Cross-Encoder, ohne ein Hook-Budget einhalten zu müssen.
- **Gate:** M3, mit getrennter Freigabe für Stufe 2.
- **Datenquelle:** dormante Goldfälle, Branch- und Konvergenztelemetrie,
  Kontrollarm mit lediglich vervierfachtem `k`.
- **Abnahmekriterium:** Stufe 1 schlägt den `k`-Kontrollarm messbar; Stufe 2
  zeigt gegenüber Stufe 1 einen an Latenz und Kosten gemessenen Eigennutzen;
  die Abbruchbedingungen aus 8.5 greifen nachweislich.
- **Rollback:** Stufe 2 abschalten oder Deep Recall ganz deaktivieren. Normal
  Recall ist nicht betroffen, weil Deep Recall ein getrennter Modus ist.

### C-032 – Vier getrennt benannte Zeitachsen

- **Passage:** 6.3 Zeitachsen, 18.5 M4, 25 Punkt 9, 26.2.
- **Art:** Architekturentscheidung als Schemavorbereitung.
- **Evidenz:** Graphiti implementiert produktiv ein bi-temporales Modell mit
  vier Zeitstempeln und invalidiert widersprochene Fakten zeitlich, statt sie zu
  löschen — belegt in Preprint, Repository und Produktdokumentation. Bastra
  kennt heute nur Dateizeiten plus `valid_until`.
- **Gate:** M4 und der gesonderte Schemaentscheid aus 21.4.
- **Datenquelle:** Punkt-in-der-Zeit-Goldfälle, read-only Projektion.
- **Abnahmekriterium:** Punkt-in-der-Zeit-Abfragen liefern den damals gültigen
  Stand; kein Feld trägt zwei Bedeutungen; Altbestand ohne die neuen Felder
  bleibt uneingeschränkt gültig.
- **Rollback:** Die Felder sind additiv und optional. Projektion verwerfen
  stellt das heutige Verhalten her.

### C-033 – Herkunft als Feld statt als zweite Taxonomie

- **Passage:** 6.3 Herkunft, 18.5 M4, 24, 26.2.
- **Art:** Architekturentscheidung, einschließlich einer ausdrücklichen
  Ablehnung.
- **Evidenz:** Hindsight führt ein Opinion Network mit veränderlicher Konfidenz
  und nennt in den Limitations selbst, dass die Meinungsentwicklung nie mit
  Nutzerinnen und Nutzern validiert wurde. Eine solche Schicht widerspricht dem
  Grundsatz, dass Bastra Nutzerwissen verwaltet und keine eigenen Positionen
  bildet. Die vom Briefing vorgeschlagenen fünf epistemischen Memory-Arten
  würden zudem die bestehende Typ-Taxonomie verdoppeln.
- **Gate:** M4 und Schemaentscheid.
- **Datenquelle:** Stichprobenklassifikation, Konsolidierungs-Reviews.
- **Abnahmekriterium:** Die Klassen sind in einer Stichprobe trennscharf
  zuweisbar; kein `derived`-Inhalt ersetzt still einen `user_asserted`-Inhalt.
- **Rollback:** Feld additiv; ohne Feld gilt konservativ `user_asserted`, was
  dem heutigen Verhalten entspricht.

### C-034 – Logische Graph-Sichten und No-Graph-Kontrollarm

- **Passage:** 13.1 (neu), 18.3 M2 Kontrollarm, 18.5 M4, 25 Punkt 10.
- **Art:** Architekturentscheidung.
- **Evidenz:** MAGMA belegt peer-reviewed den Nutzen orthogonaler Sichten mit
  Intent-Router, allerdings mit auf dem Benchmark optimierten Hyperparametern
  gegenüber Baselines mit Defaults. Die Graph-Gegenanalyse derselben Konferenz
  zeigt, dass ungeeignete Graphkonstruktion Ergebnisse verschlechtert und starke
  flache Baselines häufig konkurrenzfähig bleiben, gut konstruierte Kanten aus
  Entity-Beschreibungen flache Indizes aber teilweise deutlich schlagen.
- **Gate:** M4, einzeln je Sicht.
- **Datenquelle:** Ablation je Sicht gegen den flachen Kontrollarm.
- **Abnahmekriterium:** Eine Sicht geht nur live, wenn sie ihren Kontrollarm
  schlägt; kausale und temporale Kanten besitzen strukturelle Evidenz; das
  Hop-Budget von eins im Normal Recall wird eingehalten.
- **Rollback:** Sicht deaktivieren. `related_via` verhält sich dann wie heute.

### C-035 – Nichtdestruktive Proposal-Operatoren

- **Passage:** 14.4 (neu), 18.5 M4, 24, 25 Punkt 11.
- **Art:** Architekturentscheidung.
- **Evidenz:** All-Mem (Preprint) belegt eine begrenzte sichtbare Oberfläche mit
  hop-begrenzter Expansion in archivierte Evidenz sowie die Operatoren Split,
  Merge und Update bei unveränderlicher Evidenz. Das bestätigt den
  Asteroidengürtel unabhängig und liefert die fehlende Operator-Semantik für
  Abschnitt 14.
- **Gate:** M4.
- **Datenquelle:** Konsolidierungsläufe, Review-Protokolle.
- **Abnahmekriterium:** Jede Operation ist einzeln reversibel, Evidenz bleibt
  vollständig, die Erreichbarkeitsgarantie über typisierte Links gilt, und ohne
  Freigabe entsteht kein Vault-Zustand.
- **Rollback:** Vorschläge nicht anwenden. Ein nicht angenommener Vorschlag
  hinterlässt definitionsgemäß keinen Zustand.

### C-036 – Handlungsbezogene und assoziative Evaluation

- **Passage:** 18.2 M1 Metriken, 19, 19.1 (neu).
- **Art:** Messproblem.
- **Evidenz:** Eine peer-reviewte Arbeit zur Anwendung von Erinnerung in
  Tool-Aufrufen misst für passives Retrieval rund 30,7 gegenüber rund 53,8
  Argument-F1 bei perfektem Oracle-Retrieval. Der Engpass ist das Finden der
  Evidenz. T-Mem belegt zusätzlich Fälle, deren Cue dem Ziel weder lexikalisch
  noch semantisch ähnelt.
- **Gate:** M0 für Datensatz und Manifest, M1 für die Metriken.
- **Datenquelle:** lokales Goldset, optionale externe Adapter in V1.x.
- **Abnahmekriterium:** Beide Fallklassen sind mit vollständiger Provenienz im
  Goldset vorhanden; Argumenttreue und korrekte Nichtanwendung sind
  reproduzierbar messbar.
- **Rollback:** Fallklassen aus der Auswertung nehmen; die bestehenden Metriken
  bleiben unberührt.

### C-037 – Nutzungssignale und Exposure-Korrektur

- **Passage:** 17.5 (neu), 18.7 M6.
- **Art:** Messproblem.
- **Evidenz:** Ori Mnemos spezifiziert Q-Wert-Rewards mit Exposure-Korrektur
  und Bias-Cap. C-006 und C-019 halten bereits fest, dass `acted_on` nur ein
  Token-Overlap-Proxy ist; ohne Exposure-Korrektur misst jede darauf gestützte
  Auswertung die eigene bisherige Auswahl.
- **Gate:** M6 im Shadow, Live-Wirkung erst nach bestandenem M6.
- **Datenquelle:** erweiterte Telemetrie mit `client`, `hook_source` und
  pseudonymer Session gemäß C-020.
- **Abnahmekriterium:** Die Exposure-Korrektur ist im Report ausgewiesen, das
  Mindest-N je Query-, Client- und Hook-Klasse ist erreicht, und kein Signal
  wirkt vor M6 live.
- **Rollback:** Signale nur protokollieren. Fallback ist die deterministische
  Reihenfolge des Evidenzentscheids.

### C-038 – M5 misst Qualitätszerfall unter Wachstum

- **Passage:** 18.6 M5.
- **Art:** Messproblem.
- **Evidenz:** Ein verbreitetes Fremdsystem erreicht auf kurzen
  Konversationsbenchmarks 94,8 % und 92,5 %, fällt bei zehn Millionen Token
  Historie aber auf 50,5 % Pass Rate, 16,3 % bei temporalen Fragen, 32,5 % bei
  Widerspruchsauflösung und 40,0 % bei Abstention.
- **Gate:** M5.
- **Datenquelle:** die bestehenden Skalenstufen bis 50.000 Memories,
  angereichert um Goldfälle je Qualitätskategorie.
- **Abnahmekriterium:** Kein überproportionaler Abfall von Abstention-,
  Widerspruchs- oder Temporalqualität zwischen zwei Skalenstufen ohne benannte
  Ursache.
- **Rollback:** Reine Messerweiterung ohne Produktwirkung.

### C-039 – Gravity- und Hub-Dämpfung als Ablationsarme

- **Passage:** 18.3 M2 Arme.
- **Art:** Hypothese.
- **Evidenz:** Ori Mnemos dokumentiert beide Mechanismen als Post-Fusion-Schritt.
  Bastra dämpft heute ausschließlich über Lifecycle-, Curator-, Doc- und
  Salience-Multiplikatoren auf dem vollen Kandidatenpool vor dem k-Schnitt
  (`packages/core/src/search.ts:311`); die vorgeschlagenen Mechanismen greifen
  an anderer Stelle und ersetzen die bestehende Dämpfung nicht.
- **Gate:** M2.
- **Datenquelle:** M2-Ablationsarme auf dem versionierten Goldset.
- **Abnahmekriterium:** Präzisionsgewinn oder gesenkte False-Interrupt-Rate ohne
  Recall@3-Verlust gegenüber dem ungedämpften Arm.
- **Rollback:** Arm abschalten; die bestehende Dämpfung bleibt unverändert.

## 29. Quellen- und Behauptungsmatrix

Geprüft am 25. Juli 2026 durch Abruf der jeweiligen Primärquelle. „Evidenzklasse“
bezeichnet, worauf sich die Aussage tatsächlich stützt, nicht wie überzeugend
sie klingt.

| Fund | Quelle | Evidenzklasse | Urteil | Architekturfolge |
|---|---|---|---|---|
| Vier epistemische Netze, bi-temporale Metadaten, Vier-Kanal-Recall mit RRF, Cross-Encoder und Tokenbudget | ACL-2026-Demo zu Hindsight, arXiv-Vollfassung, Repository | peer-reviewed und produktiv implementiert | bestätigt | präzisiert C-032, C-033 und die Reranker-Regel in 9.4 |
| 91,4 % LongMemEval, 89,6 % LoCoMo, unter 200 ms bei 10.000 Units | dasselbe Paper, Tabelle 2 | Eigenmessung der Autoren | bestätigt als Angabe, nicht als Vergleichsmaßstab | kein Zielwert; fließt nur in 2.3 ein |
| „Unabhängig durch Forschungspartner reproduziert“ | Acknowledgements desselben Papers | Selbstauskunft | relativiert: die genannten Institutionen stellen Co-Autoren | Begründung für C-029 |
| Bi-temporales Modell, Invalidierung statt Löschung, nichtverlustige Episoden | Graphiti-Preprint, Repository, Produktdokumentation | Preprint plus produktiv implementiert | bestätigt | trägt C-032 |
| LoCoMo 94,7 %, LongMemEval 90,2 %, p95 155/162 ms | Zep-Research-Seite | Anbieterbenchmark, Reader und Judge identisch | bestätigt als Angabe | kein Zielwert; Begründung für C-029 |
| ACT-R-Aktivierung, Vier-Signal-Fusion, Gravity- und Hub-Dämpfung, Q-Werte mit Exposure-Korrektur, rekursive Exploration | Ori-Mnemos-Repository und Retrieval-Spezifikation | produktiv dokumentiert, teils Spezifikation | bestätigt, Konvergenzkriterium der Exploration nicht auffindbar | trägt C-037 und C-039; die fehlende Abbruchbedingung ist in 8.5 selbst definiert |
| HotpotQA- und LoCoMo-Ergebnisse gegen Mem0 | Ori-`bench`-Verzeichnis | Eigenmessung, n=50, intern abweichende Zahlen | relativiert | keine Architekturfolge |
| Plattformumfang, Fact Extraction, Scopes, öffentliche Benchmark-Suite | Mem0-Repositories und Dokumentation | produktiv implementiert | überwiegend bestätigt; die im Briefing zitierte Graph-Dokumentationsseite existiert nicht mehr | keine Architekturfolge außer der Quellenkorrektur |
| 94,8 % LongMemEval und 92,5 % LoCoMo, aber 50,5 % Pass Rate bei 10M Token | Mem0-Benchmark-Suite | Eigenmessung auf fremdem Benchmark | bestätigt | trägt C-038 |
| BEAM als unabhängiger Benchmark bis 10M Token | ICLR-2026-Arbeit, im Briefing ohne eigene Quelle zitiert | peer-reviewed | bestätigt, Quelle ergänzt; die Kategorie „Multi-Session Reasoning“ ist ein Label des Anbieters, keine offizielle Fähigkeit des Benchmarks | Quellenkorrektur, fließt in C-038 |
| Zwei Achsen und vier Triggerfamilien, Trigger getrennt vom Evidenzpfad indexiert, LoCoMo-Plus | T-Mem-Preprint | Preprint, kein veröffentlichter Code | bestätigt | trägt C-030 und C-036, reduziert auf zwei Cue-Familien |
| Begrenzte sichtbare Oberfläche, hop-begrenzte Expansion, Split/Merge/Update bei unveränderlicher Evidenz | All-Mem-Preprint | Preprint, Forschungscode | bestätigt | trägt C-035 |
| Vier orthogonale Sichten mit Intent-Router, schneller Ingestion- und langsamer Konsolidierungspfad | MAGMA, ACL 2026 | peer-reviewed | bestätigt | trägt C-034 |
| MAGMA 0,700 gegenüber 0,590/0,580/0,481 | dasselbe Paper, Tabelle 1 | peer-reviewed, aber auf dem Benchmark optimiert | relativiert: gilt nur für die Judge-Metrik | kein Zielwert |
| Graphen helfen nur bei passender Konstruktion; starke flache Baselines bleiben konkurrenzfähig | ACL-2026-Vergleichsanalyse | peer-reviewed | bestätigt, mit Gegenrichtung: gut konstruierte Entity-Kanten schlagen flache Indizes teilweise | trägt den Kontrollarm in C-034 |
| Retrieval ist der Engpass: 30,7 gegenüber 53,8 Argument-F1 | Mem2ActBench, ACL 2026 | peer-reviewed | bestätigt | trägt C-036 |
| Strukturierter Mehrpool-Ansatz 58,6 % bei 27 s gegenüber agentisch 74,9 % bei 108–140 s | LongMemEval-V2-Preprint und Projektseite | Preprint, Eigenmessung | bestätigt | trägt die Zweistufigkeit in C-031 |
| Markdown als Source of Truth, Schema-Inferenz und -Validierung, annotierte MCP-Tools | Basic Memory | produktiv implementiert | bestätigt | keine Architekturänderung; bestätigt bestehende Richtung |
| Vierstufige Kontexthierarchie mit stets sichtbaren Blöcken | Letta-Dokumentation | produktiv implementiert | bestätigt | bestätigt Floors, Session-Context und Working Memory |
| Sechs Memory-Arten mit spezialisierten Agenten und Multimodalität | MIRIX | Preprint plus Implementierung | bestätigt | zurückgestellt, siehe 30 |

## 30. Ausdrücklich verworfen oder zurückgestellt

Verworfen, weil es Bastras Grundsätzen widerspricht:

- ein Meinungs- oder Belief-Netz mit eigener, selbstverstärkender Konfidenz;
- fünf zusätzliche epistemische Memory-Typen neben den bestehenden Typen;
- vier getrennte physische Graphdatenbanken;
- Cross-Encoder-Reranking in jedem Hook-Aufruf;
- Live-Lernen aus Q-Werten oder Co-Occurrence ohne Exposure- und Hub-Kontrolle;
- automatische Ausführung von Konsolidierungs-Operatoren ohne Freigabe;
- Übernahme eines Fremdsystem-Scores als Bastra-Gate oder -Zielwert.

Zurückgestellt, weil der Nutzen für den heutigen Scope nicht belegt ist:

- beschreibende Item- und Szenen-Cues als eigene Felder — Titel, Tags,
  `topic_path` und Summary decken diese Achse bereits ab;
- multimodale Episoden und Bildschirmerfahrung;
- ein Multi-Agenten-Konsolidierungsapparat;
- vollständige Läufe großskaliger Trajektorien-Benchmarks;
- HNSW, unverändert gegenüber C-007 und M5;
- ein lernender Stufen-Controller, der Pipeline-Schritte überspringt oder
  aussetzt, vor Erreichen des Mindest-N.

## 31. Offene Entscheidungen für den Product Owner

Nur Punkte, die ohne Vorgabe nicht entscheidbar sind.

**1. Wer erzeugt abgeleitete Cues?** Empfohlen wird die Erzeugung durch den
ohnehin schreibenden Agenten beim Save, weil dort der Situationskontext
vorliegt, der einen Bridge- oder Horizon-Cue überhaupt erst sinnvoll macht.
Alternative ist ein reproduzierbarer Offline-Batch mit einem lokalen Modell über
den bestehenden Bestand. Trade-off: Agentenerzeugung liefert bessere Cues, ist
aber schlechter versionierbar und pro Save unterschiedlich; der Batch ist
reproduzierbar und hash-bar, kennt aber nur den Text. Auswirkung: betrifft nur
die Sidecar-Erzeugung, nicht das Vault-Schema; Privacy unverändert, da lokal.

**2. Wird ein externer Standardbenchmark adaptiert, und wenn ja, welcher?**
Empfohlen wird genau ein Adapter in V1.x, um externe Vergleichbarkeit
herzustellen, ohne den Aufwand zu vervielfachen. Alternative ist der Verzicht
zugunsten des lokalen Goldsets. Trade-off: Ohne Adapter bleibt die in 2.3
benannte Beweislücke bestehen; mit Adapter entsteht laufender Pflegeaufwand für
Harness-, Modell- und Judge-Versionen. Auswirkung: kein Release-Effekt, da
19.1 den Adapter ausdrücklich außerhalb des V1.0-Vertrags hält.

**3. Wird Deep Recall Stufe 2 überhaupt gebaut?** Empfohlen wird, die
Entscheidung bis nach der Messung von Stufe 1 gegen den `k`-Kontrollarm zu
vertagen. Alternative ist der sofortige Bau beider Stufen. Trade-off: Die
Fremdmessung legt einen erheblichen Kostensprung nahe, dessen Nutzen für einen
Vault dieser Größe unbelegt ist; ein vorgezogener Bau bindet Aufwand, den M3
möglicherweise nicht rechtfertigt. Auswirkung: keine, solange Stufe 1 das
Deep-Recall-Versprechen aus Abschnitt 8 einlöst.

**4. Wann fällt der Schemaentscheid für Zeitachsen und Herkunft?** Empfohlen
wird ein gemeinsamer Entscheid für beide Felder nach M4-Vorbereitung, weil sie
dieselben Konsumenten haben und ein zweiter Migrationsschritt teurer wäre als
ein gemeinsamer. Alternative ist die getrennte Einführung, zuerst der
Zeitachsen. Trade-off: gemeinsam bedeutet später, aber nur eine Migration.
Auswirkung: rein additive Felder, Rückwärtskompatibilität nach 22 in beiden
Varianten gewahrt.

## 32. Übergabe an den Codex-Gegenreview

**Was geändert wurde.** Gegenüber dem abgenommenen Stand C-001–C-028 sind
ausschließlich die Deltas C-029–C-039 hinzugekommen. Neue Passagen sind 2.3,
6.3 mit den Unterabschnitten zu Zeitachsen und Herkunft, 8.5, 11.4, 13.1, 14.4,
17.5, 19.1 sowie die Abschnitte 28 bis 32. Erweitert wurden 9.4, 10.2, 18.1 bis
18.7, 19, 23, 24, 25 und 26.2. Kein bestehendes Urteil wurde revidiert, keine
Passage der abgenommenen Basis gestrichen.

**Welche neuen Claims entstanden.** Über Bastras Ist-Stand entstanden keine
neuen Behauptungen. Die neun in dieser Revision berührten Ist-Aussagen wurden
am HEAD erneut belegt: sieben Claude-Code-Hooks über fünf Ereignistypen, der
BM25-Fallback auf drei Ebenen, der strukturell wirkungslose `--hybrid`-Schalter
im Stress-Harness, der projektlose und vollständig sequenzielle
`GET /hook/session-context`, der Kandidatenpool `max(k × 4, 20)` in beiden
produktiven Pfaden, das höchste BM25-Feldgewicht auf `recall_when`, die live
wirkende Salience-Verlängerung der Staleness bei shadow-only Rankingeinfluss,
das nur im Mac-Bridge-Pfad vorhandene Mutation-Audit und der MCP-Toolumfang.
Neu sind ausschließlich Aussagen über Fremdsysteme; sie stehen mit
Evidenzklasse in Abschnitt 29.

**Was besonders zu prüfen ist.**

1. Ob 2.3 und die Gate-Ergänzungen in 18.1 die Messdisziplin wirklich
   verschärfen und nicht nur beschreiben.
2. Ob die Reduktion der Cue-Familien auf zwei in 11.4 trägt oder ob
   beschreibende Cues doch einen eigenen Beitrag hätten.
3. Ob die Abbruchbedingungen in 8.5 vollständig sind und Stufe 2 damit
   überhaupt abnehmbar wäre.
4. Ob die Zeitachsen in 6.3 mit `valid_until` im heutigen Schema kollidieren.
5. Ob das Hop-Budget von eins in 13.1 mit der bestehenden
   `expand_hops`-Semantik konsistent ist.
6. Ob die neuen M5-Kategorien in 18.6 ohne Episoden- und Claim-Schema
   überhaupt messbar sind oder faktisch M4 voraussetzen.
7. Ob durch C-030 und C-034 ein verdeckter Pfad entsteht, auf dem ein
   abgeleitetes Signal doch `required` erzeugt.

**Was die Änderung trägt.** Für die Fremdsystem-Aussagen die Primärquellen und
Evidenzklassen aus Abschnitt 29; für die Bastra-Aussagen der Code am HEAD,
dessen Fundstellen bei den betroffenen Deltas C-030 und C-039 in Abschnitt 28
mit Datei und Zeile genannt sind; für die Gate-Änderungen die bestehenden
Messgates M0 bis M6 in Abschnitt 18, die dadurch erweitert, aber nicht in ihrer
Freigabelogik verändert wurden.
