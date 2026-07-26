# Bastra Recall – Evolutionsarchitektur V1 → V2 (Claude-Revision C-049 bis C-054)

> Status: Release- und Zielarchitektur; V1.0 ist der nächste verbindliche
> Releasevertrag, V2.0 das langfristige, messungsabhängige Zielbild
>
> Stand: 25. Juli 2026
>
> Ausgangsstand: Bastra Recall 0.8.6, aktueller Vault, reale
> 30-Tage-Telemetrie und bestehende Eval-Geometrie
>
> Basis dieser Fassung: `docs/Evolutionsarchitektur V1 zu V2.md` im
> abgenommenen Stand C-001–C-028, fortgeschrieben durch
> `docs/Evolutionsarchitektur V1 zu V2 – Claude-Revision ab C-029.md`
> (C-029–C-039) und `docs/Evolutionsarchitektur V1 zu V2 – Claude-Revision
> C-040 bis C-048.md` (C-040–C-048). Diese Datei ersetzt keine davon; alle
> vier bleiben nebeneinander erhalten.
>
> Neu in dieser Fassung sind ausschließlich die Deltas C-049–C-054 aus dem
> Codex-Delta-Review der Vorgängerrevision. Es handelt sich um einen reinen
> Delta-Fix, nicht um eine Vollrevision: Passagen ohne Delta sind
> unverändert. Jede geänderte Passage ist über das Ledger in 0.4 und das
> Delta-Ledger in Abschnitt 28 auf genau eine C-ID zurückführbar. Der Stand
> C-001–C-048 bleibt als historische Basis erhalten und wird nicht umgedeutet;
> wo ein neuer Eintrag einen älteren korrigiert, steht das als
> Korrekturverweis am älteren Eintrag.
>
> Die vier Product-Owner-Entscheidungen in Abschnitt 31 bleiben offen und
> werden von dieser Fassung nicht vorweggenommen.
>
> Nächste freie ID nach dieser Runde: C-055.

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
| C-037 | Messproblem | Nutzungssignale werden über `acted_on` hinaus erweitert und exposure-korrigiert ausgewertet; Nichtreaktion bleibt ein schwaches Negativ ohne Live-Wirkung vor M6. **Begriff korrigiert durch C-044:** es ist eine Exposure-*Normalisierung*, keine Bias-Korrektur. |
| C-038 | Messproblem | M5 misst zusätzlich zu Latenz und Recall den Qualitätszerfall bei Wachstum, insbesondere Abstention, Widerspruchsauflösung und temporale Fragen. **Abnahmekriterium ersetzt durch C-045:** verbindlich sind die numerischen Toleranzen aus 18.6.1. |
| C-039 | Hypothese | Gravity- und Hub-Dämpfung werden als zusätzliche M2-Ablationsarme geführt; sie ergänzen die bestehende Lifecycle-, Curator-, Doc- und Salience-Dämpfung, ersetzen sie nicht. |
| C-040 | Messproblem | Die Quellenmatrix in 29 führt je Fremdclaim kanonische Quelle, Version oder Commit, genaue Fundstelle, Abrufdatum und bei Messungen Reader, Judge, Top-k und Kontextbudget; fehlende Angaben werden als fehlend ausgewiesen. |
| C-041 | Architekturentscheidung | Das Zeitmodell wird vollständig bi-temporal: `recorded_at`/`retracted_at` bilden den Wissenszeitraum als Intervall ab. `valid_until` bleibt ausschließlich Lifecycle-Feld und wird weder mit `valid_to` gleichgesetzt noch automatisch migriert. |
| C-042 | Ist-Korrektur | Ein fehlendes `provenance_class` gilt niemals als `user_asserted`. Altbestand ohne eindeutige Zuordnung wird `unknown_legacy`; nur explizites `write_origin: user-directed` wird automatisch `user_asserted`. **Eingeschränkt durch C-049:** Die Importherkunft hat Vorrang — ein importierter Save wird trotz `write_origin: user-directed` zu `imported_unverified`. |
| C-043 | Messproblem | Die Reduktion auf Bridge- und Horizon-Cues ist Hypothese, nicht Entscheidung: M2 vergleicht vier Cue-Arme. Provenienzfelder eines Cues werden nie ablated, nur seine Rankingwirkung; Cue- und Dämpfungsarm erhalten getrennte Gates. |
| C-044 | Messproblem | Die Division durch die Ausspielungszahl ist Exposure-Normalisierung, nicht Bias-Korrektur. Ein kausaler Utility-Lift setzt geloggte Auswahlwahrscheinlichkeiten, kontrollierte Exploration und die Behandlung nicht ausgespielter Kandidaten als zensiert voraus. |
| C-045 | Messproblem | Der Skalen- und Interferenztest wird von der Flat/HNSW-Entscheidung getrennt. M5 vergleicht beide Backends auf identischem Korpus, identischen Queries und identischer Konfiguration; die Qualitätskategorien erhalten nach der Baseline numerische Toleranzen. |
| C-046 | Ist-Korrektur | Der heute in Hooks aktive `related_via`-Hop bleibt als semantische Baseline und Kontrollarm erhalten, bis jede neue logische Sicht ihren eigenen Lift belegt. Ein Graph-Hop erzeugt allein niemals `required`. |
| C-047 | Architekturentscheidung | Die Deep-Recall-Abbruchbedingungen erhalten versionierte Höchstwerte und eine messbare Definition des Evidenzgewinns; ein Budgetabbruch wird als `inconclusive_budget_exhausted` ausgewiesen und nie als `no_answer`. |
| C-048 | Architekturentscheidung | Die Erreichbarkeitsgarantie erhält eine versionierte maximale Hop-Zahl und eine messbare Survival-/Zitationsquote; Accessibility-Operatoren werden von inhaltlichen Versionsoperatoren getrennt und benötigen einen eigenen Override-/Floor-Vertrag. |
| C-049 | Ist-Korrektur | Importherkunft hat Vorrang vor `write_origin`: Der Import stempelt auch maschinelle Inhalte als `user-directed`, deshalb wird nur ein nicht importierter, belegbar nutzergesteuerter Save automatisch `user_asserted`. `confidence` wird indexiert, wirkt aber nicht. |
| C-050 | Architekturentscheidung | Ein Widerspruch erzeugt zunächst einen konkurrierenden Claim, nicht `retracted_at`; `valid_to`, `recorded_at`/`retracted_at`, `valid_until`, `obsolete` und Soft Delete sind fünf getrennte Zustände ohne automatische Gleichsetzung. |
| C-051 | Messproblem | Die Cue-Arme bilden ein 2×2-faktorielles Design mit getrennt ausgewerteten Hauptwirkungen und Interaktion; Szenen-Cues brauchen entweder eine eigene Stufe nach M4 oder eine definierte read-only Episodenprojektion. |
| C-052 | Architekturentscheidung | Ausbleibender Evidenzgewinn schließt nur den Ast, nicht den Lauf; `no_answer` setzt deterministische Erschöpfung aller Äste voraus. Der Ergebnisvertrag wird unverändert durch alle Oberflächen geführt, die Hop-Kennzeichnung bleibt serverintern. |
| C-053 | Architekturentscheidung | Die Survival-Invariante wird vor jeder Klasse-A-Operation simuliert und blockiert oder erzeugt Provenienz-Shortcuts; `max_provenance_hops` = 2 ist Startkandidat. `SUPERSEDE` bleibt Klasse A mit sekundärer Sichtbarkeitswirkung ohne Accessibility-Override. |
| C-054 | Messproblem | Ledger- und Quellenkonsistenz: Korrekturverweise an C-037 und C-038, Quellenzuordnung der AgentRunbook-Messzeile, angepasste `confidence`-Aussage in 32, durchgängig C-055 als nächste freie ID. |

**Abnahmestand 24.07.2026:** Vollabgleich Ledger C-001–C-027,
Gate-Messbarkeit, Ist-Behauptungs-Sweep (58 Aussagen, alle gedeckt),
Implementierer-Review. Künftige Gegenprüfungen betreffen ausschließlich
Änderungs-Deltas gegen diesen Stand.

**Finale Architekturabnahme 24.07.2026:** C-028 ist im finalen Delta-Review
bestätigt; es bestehen keine substanziellen offenen Deltas. Die abgenommene
Basis C-001–C-027 bleibt unverändert. Nächste freie ID: C-029. *(Historischer
Stand vom 24.07.2026. Die aktuell gültige nächste freie ID steht am Ende
dieses Abschnitts.)*

**Recherche-Delta-Revision 25.07.2026:** Gegenprüfung eines
Recherche-Briefings gegen die dort zitierten Primärquellen und gegen den
Code-Stand. Alle im Briefing genannten Quellen wurden abgerufen; eine URL war
tot, eine Zahlenreihe war ohne eigene Quelle zitiert, und neun Ist-Aussagen
über Bastra wurden am HEAD erneut belegt. Ergebnis sind die Deltas
C-029–C-039. Die Basis C-001–C-028 blieb unverändert gültig; kein früheres
Urteil wurde revidiert.

**Codex-Gegenreview der Revision, 25.07.2026:** Der
Gegenreview beanstandete neun Punkte an C-029–C-039 — fehlende
Reproduzierbarkeit der Quellenmatrix, ein nur halb bi-temporales Zeitmodell,
einen gefährlichen Provenienz-Fallback, eine unbelegte Cue-Reduktion, eine
falsch benannte Exposure-Korrektur, die Vermischung von Skalentest und
Backend-Entscheidung, den drohenden stillen Verlust der heutigen
Hop-Baseline, nicht ausführbare Deep-Recall-Abbruchbedingungen und eine
unmessbare Erreichbarkeitsgarantie. Alle neun sind bestätigt und als
C-040–C-048 eingearbeitet; drei davon korrigieren einen Fehler der
Vorgängerrevision, nicht nur eine Ungenauigkeit. Details in Abschnitt 28,
Quellenbelege in Abschnitt 29.

**Codex-Delta-Review, 25.07.2026 (diese Fassung):** Ein reiner Delta-Fix mit
sechs Punkten. Der schwerwiegendste ist C-049: Das in C-042 eingeführte
Provenienz-Mapping hätte über den Import-Pfad genau den Fehler wieder
eingeführt, den C-042 beheben sollte — der Import stempelt jeden Inhalt und
sogar einen maschinell erzeugten Navigations-Index als `user-directed`.
Zusätzlich waren zwei Ist-Aussagen zu präzisieren, drei Verträge zu schärfen
und fünf Konsistenzstellen zu bereinigen. C-001–C-048 bleiben unverändert;
korrigierte ältere Einträge tragen einen Korrekturverweis an Ort und Stelle.

**Nächste freie ID: C-055.** Neue Delta-Reviews beginnen dort. Ein Urteil
ändert sich nur mit neuer Code-, Telemetrie- oder Run-Evidenz; Geschmacksfragen
werden als Architekturentscheidung statt als Faktenfehler markiert.

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
- Mem0 erreicht mit der Managed-Pipeline 94,8 % auf LongMemEval bei Top 50 und
  92,5 % auf LoCoMo bei Top 200 — zwei verschiedene Retrieval-Tiefen, die nicht
  nebeneinandergestellt werden dürfen; bei gleicher Tiefe sind es 94,4 %
  beziehungsweise 91,8 %. Auf BEAM bei zehn Millionen Token Historie fällt
  dieselbe Pipeline auf 50,5 % Pass Rate, mit Durchschnittswerten von 0,163 für
  temporale Fragen, 0,325 für Widerspruchsauflösung und 0,400 für Abstention
  auf einer Skala von 0 bis 1; die zugehörigen Pass Rates lauten 20 %, 25 % und
  40 %. Der Lauf umfasst 200 der 2.000 offiziellen BEAM-Fragen.

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

Bi-temporal heißt: Beide Achsen sind **Intervalle**, nicht Zeitpunkte. Die Welt
kennt einen Gültigkeitszeitraum, das System einen Wissenszeitraum — und beide
können unabhängig voneinander enden:

| Feld | Achse | Bedeutung |
|---|---|---|
| `occurred_at` | Ereignis | wann das Ereignis stattgefunden hat |
| `valid_from` / `valid_to` | Weltgültigkeit | in welchem Zeitraum eine Aussage in der Welt gilt |
| `recorded_at` / `retracted_at` | Systemwissen | in welchem Zeitraum Recall die Aussage kannte und für gültig hielt |
| `derived_at` | Ableitung | wann eine abgeleitete Aussage erzeugt wurde, optional |

Ein einzelner `recorded_at`-Zeitpunkt genügt nicht. Erst das Paar
`recorded_at`/`retracted_at` beantwortet die Frage „was hielt das System am
Stichtag X für wahr?“ getrennt von „was war am Stichtag X tatsächlich wahr?“.
Ohne `retracted_at` wäre jede zurückgenommene Aussage rückwirkend so zu lesen,
als hätte das System sie nie geglaubt — womit sich Fehlentscheidungen der
Vergangenheit nicht mehr rekonstruieren ließen.

**Ein Widerspruch allein setzt `retracted_at` nicht.** Das wäre eine stille
automatische Entscheidung und stünde gegen die Regel aus Abschnitt 13, dass
Widersprüche sichtbar erklärt statt aufgelöst werden. Der Ablauf ist gestuft:

1. Ein erkannter Widerspruch erzeugt zunächst einen **sichtbaren
   Konfliktbefund** und einen `LINK`-Vorschlag für die `contradicts`-Kante.
   Beide Aussagen bleiben aktiv und sichtbar; der Konflikt wird ausgewiesen.
   Die Kante selbst wird erst nach Freigabe gemäß 14.4 persistiert — sie ist
   eine starke Kante und unterliegt damit der Evidenz- und Freigabepflicht aus
   Abschnitt 13.
2. `retracted_at` wird erst gesetzt durch eine **bestätigte Auflösung** — eine
   akzeptierte Korrektur oder ein bestätigtes `SUPERSEDE`.
3. Bleibt der Konflikt unaufgelöst, bleibt er offen. Ein offener Widerspruch
   ist ein gültiger Systemzustand und zählt in die Gedächtnisgesundheit nach
   Abschnitt 20, nicht in die Zeitachsen.

Gelöscht wird in keinem Schritt.

**`valid_until` ist keines dieser Felder.** Es existiert heute bereits und ist
ausschließlich ein Lifecycle- beziehungsweise Accessibility-Feld: Es wird an
genau einer Stelle gelesen und dort in einen Score-Multiplikator übersetzt —
`expired` dämpft auf 20 %, `aging` auf 85 %. Es schließt kein Memory aus dem
Recall aus, und es sagt nichts darüber, ob die Aussage in der Welt noch gilt.
Ein abgelaufenes `valid_until` bedeutet „dieses Memory soll seltener spontan
auftauchen“, ein erreichtes `valid_to` bedeutet „diese Aussage ist nicht mehr
wahr“. Das ist nicht dasselbe.

Daraus folgt verbindlich:

- `valid_until` wird **nicht** mit `valid_to` gleichgesetzt;
- `valid_until` wird **nicht** automatisch nach `valid_to` migriert;
- `valid_until` behält seine heutige Dämpfungswirkung unverändert;
- ein Memory kann gleichzeitig `valid_to` in der Zukunft und ein abgelaufenes
  `valid_until` haben — es ist dann wahr, aber schwer zugänglich. Genau diese
  Kombination ist der Grund, beide Felder zu trennen.

`created` und `updated` behalten ebenfalls ihre heutige Semantik als
Schreibzeiten und werden nicht nachträglich umgedeutet. Bemerkenswert und
absichtlich unverändert: `updated` speist heute die Staleness-Rechnung,
`created` nicht.

#### Fünf getrennte Zustände

Zeitliche Gültigkeit, systemseitiges Wissen, Zugänglichkeit, Ausblendung und
Löschung sind fünf verschiedene Dinge. Sie werden häufig verwechselt, weil sie
alle dazu führen können, dass ein Memory nicht mehr auftaucht:

| Zustand | Aussage | Ebene |
|---|---|---|
| `valid_to` erreicht | die Aussage gilt in der Welt nicht mehr | Claim |
| `retracted_at` gesetzt | das System hält die Aussage nicht mehr für gültig | Claim |
| `valid_until` abgelaufen | das Memory wird im Ranking gedämpft | Memory, Accessibility |
| `obsolete` gesetzt | das Memory ist aus dem normalen Recall entfernt | Memory |
| Soft Delete | die Datei liegt im wiederherstellbaren Papierkorb, mit Audit | Datei |

Zwischen diesen Zuständen gibt es **keine automatische Gleichsetzung und keine
automatische Migration**. Ein abgelaufenes `valid_until` macht keinen Claim
ungültig; `obsolete` sagt nichts über Wahrheit; ein Soft Delete ist kein
Widerspruch; und kein Zeitfeld setzt jemals selbsttätig `obsolete` oder löst
einen Soft Delete aus.

Für `valid_to` gilt eine Präzisierung: Es entfernt ein Memory nicht aus dem
Retrieval, verändert aber seine **Rolle**. Ein Claim jenseits seiner
Weltgültigkeit ist historisch im Sinne von 6.5 und wird nicht mehr als aktuelle
Regel injiziert; abgelaufene Gültigkeit zählt zudem nach 7.3 als negatives
Accessibility-Signal und geht damit in die berechnete Zone ein. Beides ist
gewollt und bleibt eine Wirkung auf Rolle und Zugänglichkeit — nicht auf
Existenz, Auffindbarkeit über die ID oder Deep Recall.

Eine bestätigte Operation darf mehrere dieser Zustände gezielt setzen — ein
angenommenes `SUPERSEDE` etwa `retracted_at` am Vorgänger-Claim und dessen
Ausblendung aus dem aktuellen Recall. Sie muss dann aber **im Operatorvertrag
ausweisen, welche Zustände sie berührt**, und jeder davon muss einzeln
zurückrollbar sein. Was der Operator nicht ausweist, setzt er nicht.

Für Regeln, Präferenzen, Lessons und Workflows ist `occurred_at` in der Regel
leer und `valid_to` optional; ein fehlendes `valid_to` bedeutet „gilt bis auf
Widerruf“ und nicht „unbegrenzt bewiesen“.

Diese Felder sind Schemaarbeit und hängen am gesonderten Schemaentscheid aus
21.4. Bis dahin existieren sie höchstens als abgeleitete read-only Projektion.
Vorbild ist ein produktiv implementiertes Fremdsystem, das genau diese vier
Marken führt — zwei auf der Transaktions- und zwei auf der Ereigniszeitlinie —
und widersprochene Fakten zeitlich invalidiert statt sie zu löschen. Bastra
weicht in einem Punkt bewusst ab: Dort invalidiert die Konflikterkennung
unmittelbar, hier erst die bestätigte Auflösung (siehe oben).

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
| `imported_unverified` | aus einem fremden Vault übernommen, Urheberschaft nicht geprüft |
| `unknown_legacy` | Herkunft nicht eindeutig rekonstruierbar |

Abgeleitete Inhalte tragen zusätzlich Generator, Version und Konfidenz,
referenzieren ihre Evidenz über `derived_from` und dürfen einen
`user_asserted`-Inhalt niemals still ersetzen. Ein eigenes Meinungs- oder
Belief-Netz wird nicht eingeführt: Ein System, das eigene Überzeugungen mit
selbstverstärkender Konfidenz führt, widerspricht dem Grundsatz, dass Bastra
Nutzerwissen verwaltet und nicht eigene Positionen bildet.

#### Fallback für den Altbestand

**Ein fehlendes `provenance_class` gilt niemals als `user_asserted`.** Der
Umkehrschluss wäre der gefährlichste denkbare Default: Er würde jedem
Altbestand die höchste Vertrauens- und Schutzklasse zusprechen und damit genau
die Grenze aufheben, die das Feld ziehen soll.

Der heutige Code stützt das: `write_origin` ist optional ohne Schema-Default,
und alle Schutzprüfungen vergleichen strikt gegen `user-directed`. Ein
Bestandsmemory ohne das Feld ist heute faktisch `agent-session` und damit
ungeschützt; beim nächsten Save wird `agent-session` materialisiert. Der Vault
enthält also keine Information, die eine Nutzerurheberschaft belegen würde.

Das Mapping ist **zweistufig und in dieser Reihenfolge auszuwerten**. Die
Reihenfolge ist nicht redaktionell, sondern trägt die Sicherheit des ganzen
Verfahrens:

**Stufe 1 — Importherkunft prüfen. Sie hat Vorrang vor jedem anderen Signal.**

| Beobachtung | abgeleitete Klasse |
|---|---|
| `source` mit Import-Adapter-Präfix `<adapter>:<label>:<relKey>` | `imported_unverified` |
| `source` mit Präfix `index:<label>` | `imported_unverified` |
| `topic_path` beginnt mit `imported` oder Tag `imported` gesetzt | `imported_unverified` |
| vergleichbare maschinelle Quellkennzeichnung | `imported_unverified` |

Trifft eine dieser Bedingungen zu, endet die Auswertung hier. `write_origin`
wird in diesem Fall **nicht** ausgewertet.

**Stufe 2 — nur für nicht importierte Memories.**

| Beobachtung | abgeleitete Klasse |
|---|---|
| `write_origin: user-directed` | `user_asserted` |
| `write_origin: capture-review` | `unknown_legacy`, Review-Status `pending` |
| `write_origin: agent-session` | `unknown_legacy` |
| `write_origin` fehlt | `unknown_legacy` |

Der Grund für den Vorrang der Importprüfung ist ein Ist-Stand des Codes: Der
Vault-Import stempelt **jeden** übernommenen Inhalt mit
`write_origin: "user-directed"` — und zwar auch einen vollständig maschinell
erzeugten Navigations-Index über den Import. Ein einstufiges Mapping nach
`write_origin` würde also einen fremden Vault samt generierter Hilfsknoten
geschlossen zu Nutzeraussagen erklären. Das ist genau der Fehler, den die
Fallback-Regel verhindern soll, nur durch eine andere Tür.

Nur ein **nicht importierter, belegbar nutzergesteuerter** Save wird
automatisch `user_asserted`. `agent-session` bedeutet lediglich, dass der Agent
geschrieben hat — nicht, dass der Inhalt eine Agentenbeobachtung ist; eine vom
Nutzer diktierte Regel und eine selbstgezogene Schlussfolgerung sind darin
ununterscheidbar. Deshalb wird `agent-session` nicht nach `agent_observed`
gemappt, sondern nach `unknown_legacy`.

`confidence` wird für dieses Mapping ausdrücklich **nicht** herangezogen. Das
Feld besitzt einen Schema-Default von 1,0 und wird zwar als Metadatum in den
Suchindex aufgenommen und dort gespeichert, beeinflusst aber weder Ranking noch
Filterung noch den Evidenzentscheid. Es trägt deshalb keine Information, aus
der sich Herkunft ableiten ließe.

#### Review-Status statt Prosa-Vormerkung

Die Auflösung von `imported_unverified` und von `unknown_legacy` mit
Review-Status `pending` läuft nicht über eine unverbindliche Notiz, sondern
über ein benanntes Feld der Sidecar-Projektion:

| Feld | Werte |
|---|---|
| `provenance_review` | `pending`, `confirmed`, `rejected`, `not_required` |
| `provenance_reviewed_at` | Datum der Entscheidung |
| `provenance_review_note` | optionale Begründung |

`pending` ist der Startwert für jedes `imported_unverified` und für
`capture-review`. `not_required` gilt ausschließlich für die übrigen
Stufe-2-Fälle, also für `user-directed`, `agent-session` und fehlendes
`write_origin` — `capture-review` ist davon ausdrücklich ausgenommen und
startet auf `pending`.

`confirmed` darf ausschließlich durch eine ausdrückliche Nutzerentscheidung
gesetzt werden und überführt das Memory in die dann benannte Klasse. Es ist
damit **eine persistierte Nutzerentscheidung und keine abgeleitete
Projektion**: Es überstimmt die Stufe-1-Ableitung dauerhaft und wird wie ein
Override nach 14.4 Klasse B geführt. Andernfalls würde jede Neuberechnung ein
bestätigtes Memory wieder auf `imported_unverified` zurückwerfen, weil die
Stufe-1-Signale in `source`, `topic_path` und Tags unverändert bleiben.

Die abgeleiteten Statuswerte leben in der Sidecar-Projektion, nicht im
Markdown — sie hängen damit am selben Schemaentscheid wie die übrigen
Provenienzfelder und erzeugen vorher keine Vault-Änderung.

`unknown_legacy` und `imported_unverified` sind keine Vertrauensklassen,
sondern das Eingeständnis, dass die Herkunft unbekannt beziehungsweise
ungeprüft ist. Sie schützen nicht wie `user_asserted` und qualifizieren nicht
zum Überschreiben wie `derived`. Ein Memory verlässt diesen Zustand nur durch
eine ausdrückliche Nutzerbestätigung oder durch einen neuen Save mit expliziter
Klasse. Ein Massen-Rewrite des Vaults findet nicht statt.

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
8. liefert einen der drei Ausgänge aus 8.5: `no_answer` nur bei
   deterministischer Erschöpfung, sonst `inconclusive_budget_exhausted`.

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

Beide Stufen liefern ihren Suchpfad mit. Die Abbruchbedingungen von Stufe 2 sind
explizit, ausführbar und nicht verhandelbar.

**Budgetgrenzen.** Jeder Deep-Recall-Lauf startet mit einem versionierten
Grenzwertsatz. Die konkreten Zahlen werden nach dem M0-Baseline-Run festgelegt
und gemeinsam mit der Konfiguration versioniert abgelegt; die Größen selbst sind
verbindlich:

| Grenze | Art | Wirkung bei Erreichen |
|---|---|---|
| maximale Laufzeit | hart | Lauf endet |
| maximales Tokenbudget | hart | Lauf endet |
| maximale Zahl offener Äste | weich | keine neuen Äste mehr |
| maximale Tiefe je Ast | weich | Ast wird geschlossen |
| maximale Zahl Provider-Aufrufe | weich | kein semantischer Arm mehr |
| maximale Zahl betrachteter Kandidaten | weich | kein Poolausbau mehr |

Harte Grenzen beenden den Lauf sofort. Weiche Grenzen beenden ihn nicht,
sondern verengen den Suchraum — und genau darin liegt eine Falle: Wenn wegen
einer erreichten weichen Grenze keine neuen Äste mehr geöffnet werden, kann der
Suchbaum formal leerlaufen, ohne dass der Vault ausgeschöpft wurde. Der
Controller merkt sich deshalb, ob eine weiche Grenze gegriffen hat.

**Evidenzgewinn.** Ein Schritt gilt genau dann als ertragreich, wenn er
mindestens eine bisher nicht gesehene Evidenz-ID liefert oder mindestens eine
offene Teilfrage beantwortet. Ein Schritt, der nur bereits bekannte IDs erneut
findet, zählt als ertraglos — unabhängig davon, wie hoch die Scores sind.

**Abbruch auf zwei Ebenen.** Ast und Lauf enden nach verschiedenen Regeln, und
die Verwechslung beider wäre folgenreich:

*Ast-Ebene.* Zwei aufeinanderfolgende Schritte ohne Evidenzgewinn schließen
**den betroffenen Ast**. Sie beenden nicht den Lauf. Solange andere Äste offen
sind, arbeitet der Controller dort weiter — ein einzelner erschöpfter Zweig
sagt nichts über den Rest des Suchbaums.

*Lauf-Ebene.* Der Lauf endet, wenn eine der folgenden Bedingungen eintritt:

1. jede Teilfrage ist beantwortet oder aufgegeben und **kein zulässiger Ast ist
   mehr offen**, ohne dass eine weiche Grenze gegriffen hat — deterministische
   Erschöpfung;
2. eine **harte** Grenze ist erreicht;
3. der Suchbaum ist leergelaufen, **nachdem** eine weiche Grenze gegriffen hat.

Bedingung 1 ist die einzige, die eine Aussage über den Vault erlaubt.
Bedingung 3 sieht ihr von außen zum Verwechseln ähnlich — der Baum ist in
beiden Fällen leer —, sagt aber nur, dass der Controller nicht weitersuchen
durfte.

**Drei unterscheidbare Ergebnisse.** Der Ausgang wird nie zusammengefasst:

| Ergebnis | Bedeutung |
|---|---|
| `answer_found` | belastbare Evidenz gefunden und mit Suchpfad ausgegeben |
| `no_answer` | die Suche war **deterministisch ausgeschöpft** — Bedingung 1 — und es existiert nachweislich keine belastbare Evidenz |
| `inconclusive_budget_exhausted` | der Lauf endete an einer harten Grenze oder lief nach einer weichen Grenze leer — Bedingung 2 oder 3; über das Vorhandensein von Evidenz ist damit nichts ausgesagt |

`no_answer` setzt Bedingung 1 voraus und nichts sonst. Jeder andere Ausgang ist
**inconclusive** — auch dann, wenn mehrere Äste nacheinander ohne Gewinn
geschlossen wurden und der Baum am Ende leer aussieht. Der Controller meldet
dann `inconclusive_budget_exhausted` und benennt im Feld `limit` die Grenze, die
gegriffen hat: Laufzeit, Tokens, Äste, Tiefe, Provider-Aufrufe oder Kandidaten.
Muss er aus einem hier nicht vorgesehenen Grund abbrechen, meldet er dasselbe
Ergebnis mit `limit: "other"` und der Ursache — er erfindet keinen vierten
stillen Ausgang und deklariert einen erzwungenen Halt niemals als Erschöpfung.

Ein Lauf, der stehen bleibt, während noch Äste offen sind und keine Grenze
gegriffen hat, ist **kein zulässiger Endzustand**, sondern ein Defekt: Der
Controller hätte weitersuchen müssen. Solche Fälle werden als Fehler
protokolliert, nicht als Ergebnis ausgegeben.

Ein Budgetabbruch darf niemals als `no_answer` ausgegeben werden. Beides sähe
für den Nutzer ähnlich aus, bedeutet aber das Gegenteil: Das eine ist eine
Aussage über den Vault, das andere eine Aussage über die Suchkosten. Die
Verwechslung würde zusätzlich die Abstention-Metriken aus 18.2 verfälschen, weil
abgebrochene Läufe dort als korrekte Enthaltung gezählt würden.

Bei `inconclusive_budget_exhausted` bleibt die bewusste Budgetverlängerung die
einzige Fortsetzung; sie erfolgt nie automatisch.

**Oberflächenvertrag.** Das Ergebnis ist ein explizites Aufzählungsfeld in
einem eigenen Ergebnisobjekt, nicht eine Formulierung im Antworttext:

```ts
interface DeepRecallResult {
  outcome: "answer_found" | "no_answer" | "inconclusive_budget_exhausted";
  limit?: "runtime" | "tokens" | "branches" | "depth" | "provider_calls" | "candidates" | "other";
  limit_reason?: string;   // Pflicht bei limit === "other"
  evidence: EvidenceRef[];
  search_path: BranchNode[];
  open_branches: number;
}
```

Dieses Objekt wird **unverändert** durch MCP, REST, CLI und Mindspace geführt.
Für jede dieser Oberflächen gilt:

- `answer_found`, `no_answer` und `inconclusive_budget_exhausted` bleiben
  unterscheidbar;
- ein Budgetstatus wird weder durch HTTP- oder MCP-Fehlerbehandlung noch durch
  UI-Text in `no_answer` umgewandelt;
- ein Transportfehler ist kein `no_answer` und kein
  `inconclusive_budget_exhausted`, sondern ein Fehler.

Die Hooks sind **kein Konsument des Deep Recall** — weder Stufe 1 noch Stufe 2
wird aus einem Hook gestartet; beide sind laut 8.4 bewusste Interaktionen und
mit dem PreTool-Budget aus 18.3 ohnehin unvereinbar. Der Oberflächenvertrag
berührt die Hook-Antwort deshalb nicht.

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
- Quellenqualität; belegte Quellen-Confidence erst nach dem Schemaentscheid aus
  21.4, da das heutige `confidence`-Feld einen Default von 1,0 trägt und keine
  Herkunfts- oder Qualitätsinformation enthält (siehe 6.3);
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

Zusätzliche Cues dürfen abgeleitet werden. Vier Familien kommen dafür in
Betracht:

| Cue-Familie | Frage | Achse |
|---|---|---|
| `descriptive_entity` | Welchem übergeordneten Begriff lässt sich dieser einzelne Fakt zuordnen? | Item, beschreibend |
| `associative_bridge` | In welcher künftigen Situation wäre dieser einzelne Fakt wichtig? | Item, assoziativ |
| `descriptive_scene` | Wie lässt sich die Situation dieser Episode beschreiben? | Szene, beschreibend |
| `associative_horizon` | Welche größere Lage oder Aufgabe macht diese ganze Episode relevant? | Szene, assoziativ |

Die Erwartung ist, dass nur die assoziative Achse einen eigenen Beitrag leistet,
weil Titel, Tags, `topic_path` und Summary die beschreibende Achse im
bestehenden Index bereits abdecken. Das ist jedoch eine **Hypothese und keine
Entscheidung**: Sie stützt sich auf eine Fremdarbeit und auf die Struktur des
heutigen BM25-Index, nicht auf eine Bastra-Messung. Welche Familien persistent
werden, entscheiden die Ablation in 18.3 und der anschließende gesonderte
Repräsentationsentscheid nach 11.2; bis dahin bleiben alle vier im Prüfumfang.

Dabei ist eine Stufenabhängigkeit zu beachten: `descriptive_entity` und
`associative_bridge` beziehen sich auf ein einzelnes Memory und sind auf dem
heutigen Bestand unmittelbar bildbar. `descriptive_scene` und
`associative_horizon` beziehen sich dagegen auf eine Episode oder Szene — ein
Gegenstand, den das Vault-Schema erst mit der M4-Stufe kennt. Die Cue-Ablation
muss deshalb ausweisen, auf welcher Stufe sie geprüft hat; siehe 18.3.

Regeln:

- jeder abgeleitete Cue trägt **immer** Ziel-ID des Memorys, Herkunft,
  Generatorversion, `derived_at`, Konfidenz und die Verbindung zur Evidenz;
  diese Felder sind Bestandteil des Cues und niemals Gegenstand einer
  Ablation — ablated wird ausschließlich seine Rankingwirkung;
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

Ein Cue ohne auflösbare Ziel-ID oder ohne Evidenzverbindung ist kein
unvollständiger Cue, sondern ein ungültiger. Er wird verworfen, nicht
degradiert verwendet.

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

#### Die heutige Hop-Baseline bleibt erhalten

Diese Beschränkung darf nicht dazu führen, dass eine bereits produktive
Fähigkeit stillschweigend verschwindet. Der Hook-Pfad traversiert heute
standardmäßig **einen `related_via`-Hop** — und zwar nicht auf Wunsch der
Hooks, sondern weil der Hook-Endpunkt `expand_hops` von sich aus auf 1 setzt,
sofern der Aufrufer nicht ausdrücklich 0 sendet. Kein Hook sendet den Parameter.
Der MCP-Pfad hoppt umgekehrt nie; der Forwarder setzt ihn explizit auf 0. Diese
Asymmetrie ist der heutige Ist-Stand.

Der traversierte Kantentyp ist ausschließlich `related_via`, also die
automatisch erzeugte semantische Nähe — nicht das Wikilink-Array `related`,
das nur in die Graph-Projektion einfließt. In der Sprache von 13.1 ist das
genau die **semantische Sicht**, und sie ist damit die einzige heute live
erprobte. Sie bleibt erhalten:

- Die semantische Sicht mit Hop-Budget eins bleibt der produktive Zustand und
  gleichzeitig der **Kontrollarm**, gegen den jede neue Sicht antreten muss.
- Eine neue Sicht ersetzt sie nicht, sondern tritt neben sie, solange sie
  ihren eigenen Lift nicht belegt hat.
- Erst wenn eine Sicht ihren Lift gegenüber dieser Baseline und gegenüber dem
  No-Graph-Arm zeigt, darf über eine Umschichtung des Hop-Budgets entschieden
  werden.

#### Ein Hop erzeugt niemals allein `required`

Ein Treffer, der nur über eine Kante erreicht wurde, ist ein Kandidat und kein
Beleg. Das Ziel-Memory muss den regulären Evidenzentscheid aus Abschnitt 10 aus
eigener Kraft bestehen, um `required` zu werden.

Diese Regel schließt eine heute bestehende Lücke. Der Ist-Stand:

- Ein Hop-Nachbar erhält höchstens die Hälfte des rohen Seed-Scores.
- Die Herkunftskennzeichnung `hop` wird auf dem Weg zum Hook aus der Antwort
  herausprojiziert; der Hook sieht nur noch Titel, Typ, Scope, Summary und
  Score.
- Die `required`-Entscheidung fällt allein über die Score-Schwelle 100 und ist
  damit hop-blind.
- Auf dem Hybrid-Pfad ist der Score eine skalierte Rangsumme mit einer
  Obergrenze um 164, sodass ein Hop-Nachbar rechnerisch höchstens etwa 82
  erreicht und die Schwelle nicht überschreiten kann.
- Auf dem **BM25-only-Pfad** sind die Scores dagegen unbegrenzt. Dort kann der
  Nachbar eines sehr starken Treffers die 100 überschreiten und wird dann als
  `required` ausgespielt, ohne vom Hook als Hop erkennbar zu sein.

Die Trennung hängt heute also an einer zufälligen Eigenschaft der
Score-Skalierung — und ausgerechnet der degradierte Pfad ohne Embeddings, der
bei Providerausfall greift, besitzt diese Sicherung nicht. V1.0 macht die Regel
deshalb explizit, statt sich auf die Deckelung zu verlassen.

Voraussetzung dafür ist, dass die Hop-Herkunft dem Entscheidungspunkt zur
Verfügung steht. Der Evidenzentscheid fällt **serverseitig**, vor der
Projektion der Antwort — die Kennzeichnung muss deshalb nur bis dorthin
reichen und **nicht** Teil der öffentlichen Lean-Antwort werden. Die heutige
Lean-Projektion (ID, Titel, Typ, Scope, Summary, Score) bleibt unverändert; zusätzlich steht die
Hop-Herkunft in Telemetrie und Debug-Ausgabe zur Verfügung, wo sie für die
Auswertung nach 18.2 und 18.5 gebraucht wird. Rückwärtskompatibilität für
bestehende Clients ist damit gewahrt.

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
Vorschlägen. Es gibt keine freie inhaltliche Umschreibung. Die Operatoren
zerfallen in zwei Klassen, die nicht vermischt werden dürfen.

**Klasse A – Topologie- und Inhaltsoperatoren.** Sie verändern Bestand oder
Beziehungen und erzeugen Versionen:

| Operator | Wirkung |
|---|---|
| `SPLIT` | ein zu breites Memory wird in mehrere Nachfolger zerlegt |
| `MERGE` | mehrere Memories werden zu einem Nachfolger zusammengeführt |
| `UPDATE` | Inhalt oder Gültigkeit eines Memorys wird fortgeschrieben |
| `LINK` | eine typisierte Kante wird vorgeschlagen |
| `SUPERSEDE` | ein Memory wird als ersetzt markiert und bleibt zitierbar |

Für jeden Operator der Klasse A gilt:

- er referenziert alle Eingaben vollständig;
- er erzeugt eine neue Version oder abgeleitete Repräsentation und löscht keine
  Evidenz;
- er trägt Begründung und Konfidenz;
- er wird vor der Persistenz vom Nutzer freigegeben;
- er ist einzeln zurückrollbar, weil der Vorgängerzustand zitierbar bleibt;
- ein nicht angenommener Vorschlag hinterlässt keinen Zustand im Vault.

**Klasse B – Accessibility-Entscheidungen.** `DORMANT` und `REACTIVATE` sind
keine Inhaltsoperationen. Sie erzeugen keine Version, ändern keinen Text und
keine Kante, sondern wirken auf die Zugänglichkeit:

| Operator | Wirkung |
|---|---|
| `DORMANT` | die Zugänglichkeit wird gesenkt, Inhalt und Kanten bleiben unverändert |
| `REACTIVATE` | die Zugänglichkeit wird nach belegtem Bedarf angehoben |

Für Klasse B gilt gesondert:

- Accessibility ist laut 7.1 eine reproduzierbare Projektion und keine
  gespeicherte Wahrheit. Ein Operator, der sie als Version schriebe, würde
  genau diese Eigenschaft aufheben.
- Eine **dauerhafte** Zugänglichkeitsentscheidung des Nutzers wird deshalb nicht
  als Konsolidierungsvorschlag ausgeführt, sondern über einen eigenen
  Override-Vertrag festgehalten: einen expliziten Floor beziehungsweise Pin nach
  7.2 und 7.4, der die berechnete Projektion überstimmt, jederzeit sichtbar ist
  und jederzeit widerrufen werden kann.
- Ein Klasse-B-Vorschlag ohne solchen Override wirkt nur bis zur nächsten
  Neuberechnung der Projektion. Das ist beabsichtigt und wird dem Nutzer so
  angezeigt.
- `user-directed`-Memories und gefloorte Memories sind von automatischen
  `DORMANT`-Vorschlägen ausgenommen.

**Erreichbarkeitsgarantie.** Jede archivierte, dormante oder konsolidierte
Quelle bleibt vom sichtbaren Bestand aus über höchstens `max_provenance_hops`
typisierte Links erreichbar. Der Startwert zwei ist ein **zu prüfender
Kandidat**, keine gesetzte Konstante: Eine Ursprungsquelle, die erst durch
`SPLIT` und danach durch `MERGE` läuft, liegt danach genau zwei Hops entfernt —
die Grenze wird erreicht, aber noch nicht überschritten. Bereits eine weitere
Generation aus `UPDATE`, `MERGE` oder `SPLIT` überschreitet sie. Der Wert ist
versioniert abgelegt und wird nur mit dokumentierter Begründung geändert.

**Erhaltungsregel.** Weil die Grenze schon in der zweiten Generation greift,
genügt es nicht, sie zu benennen — sie muss durchgesetzt werden:

1. Vor der Annahme **jedes** Klasse-A-Operators wird die Survival-Invariante
   für den Zustand *nach* der Operation simuliert.
2. Läge anschließend eine Quelle außerhalb von `max_provenance_hops`, wird die
   Operation **blockiert**.
3. Alternativ darf die Operation typisierte **Provenienz-Shortcuts** vom neuen
   sichtbaren Memory zu den ursprünglichen Leaf-Quellen erzeugen oder einen
   geeigneten Zwischenknoten sichtbar halten.
4. Shortcuts sind additiv. Sie **ersetzen und löschen die ursprüngliche
   Provenienzkette nicht**; die vollständige Ableitungsgeschichte bleibt
   traversierbar.
5. Die Prüfung gilt nach **jeder einzelnen Operation**, nicht erst am Ende
   eines Konsolidierungslaufs. Ein Lauf, der zwischenzeitlich die Invariante
   verletzt, ist auch dann unzulässig, wenn sein Endzustand sie wieder erfüllt.

Gemessen wird die Garantie über zwei Größen:

- **Survival-Quote:** Anteil der archivierten oder konsolidierten Quellen, die
  innerhalb von `max_provenance_hops` vom sichtbaren Bestand aus erreichbar
  sind. Zielwert 100 %; jede Unterschreitung ist ein Fehler, kein Rauschen.
- **Zitationsquote:** Anteil der abgeleiteten Memories, deren sämtliche Inputs
  über auflösbare IDs referenziert und abrufbar sind.

Eine sichtbare Memory darf eine archivierte Quelle repräsentieren, aber niemals
still deren Inhalt ersetzen. Der Asteroidengürtel ist damit eine
Zugänglichkeitsaussage und keine Löschung — die Konsolidierung darf diese
Eigenschaft nicht unterlaufen.

#### Sonderfall `SUPERSEDE`

`SUPERSEDE` bleibt ein Klasse-A-Operator: Es erzeugt eine Version und
verschiebt den Wahrheitsstand. Es besitzt daneben aber eine **sekundäre
Sichtbarkeitswirkung**, die klar begrenzt ist:

- Der Vorgänger ist nicht mehr aktuelle Wahrheit und wird im normalen Recall
  nicht mehr als geltende Aussage ausgespielt.
- Er bleibt historisch, über seine ID und über Deep Recall erreichbar.
- Diese Wirkung ist **keine Klasse-B-`DORMANT`-Entscheidung**. Sie folgt aus
  dem Versionsstand und nicht aus einer Zugänglichkeitsbewertung.
- Sie erzeugt **keinen dauerhaften Accessibility-Override**. Ein Floor oder Pin
  entsteht nur über den Weg aus dem Klasse-B-Abschnitt.
- Dass die Accessibility-Projektion aus 7.1 den Term `superseded_penalty`
  enthält und 7.5 für „explizit ersetzt“ die Zone Historical vorsieht, steht
  dazu nicht im Widerspruch: Beides sind **berechnete Projektionen** aus dem
  Versionsstand, keine gespeicherten Entscheidungen. `SUPERSEDE` setzt die
  Version; die Zone folgt daraus, ohne dass ein Operator sie schreibt.

Der Rollback eines `SUPERSEDE` muss beides wiederherstellen: den Versions- und
Zeitstatus — also insbesondere ein gesetztes `retracted_at` am
Vorgänger-Claim — **und** die aktuelle Sichtbarkeit. Ein Rollback, der nur die
Version zurücknimmt und den Vorgänger unsichtbar lässt, ist unvollständig und
gilt als fehlgeschlagen.

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

- **Exposure-Normalisierung.** Ein häufig ausgespieltes Memory sammelt
  automatisch mehr positive Ereignisse und gilt deshalb nicht als besser
  belegt. Jedes Signal wird auf die Zahl seiner Ausspielungen normiert, und
  diese Normalisierung wird im Report als solche ausgewiesen.
- **Sie ist keine Korrektur des Selektionsbias.** Die Division durch die
  Ausspielungszahl macht Raten vergleichbar; sie sagt nichts darüber, warum ein
  Memory ausgespielt wurde. Der eigentliche Bias liegt darin, dass die Auswahl
  selbst vom bisherigen Ranking abhängt. Eine belastbare Bias-Korrektur setzt
  voraus:
  1. geloggte Auswahlwahrscheinlichkeiten beziehungsweise Propensities je
     Kandidat und Ausspielung;
  2. kontrollierte Exploration oder einen geeigneten randomisierten Arm, damit
     überhaupt Gegenbeobachtungen entstehen;
  3. die Behandlung nicht ausgespielter Kandidaten als zensiert und nicht als
     negativ.
  Solange diese drei Voraussetzungen nicht erfüllt sind, darf aus den Signalen
  **kein kausaler Utility-Lift** behauptet werden — weder im Report noch als
  Begründung für eine Live-Schaltung. Zulässig bleiben deskriptive Aussagen
  über beobachtete Raten.
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
Oracle-Retrieval. Das Finden der richtigen Evidenz ist damit der **dominante**
Engpass — aber nicht der einzige: Auch mit perfektem Retrieval bleiben knapp
die Hälfte der Argumente falsch. Die korrekte Anwendung einer richtig
gefundenen Erinnerung ist ein eigenes, ungelöstes Problem. Für Bastra folgt
daraus beides: Retrieval ist die Größe, die V1.0 verbessern will und deshalb
gemessen werden muss; und ein Fortschritt beim Retrieval darf nicht als
Fortschritt bei der Anwendung ausgegeben werden. Deshalb stehen Argumenttreue
und korrekte Nichtanwendung als eigene Metriken neben Recall@k.

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
  `required`;
- ein nur über einen Graph-Hop erreichter Treffer erzeugt für sich genommen
  kein `required`; der Report weist die Hop-Herkunft der Required-Treffer
  aus.

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
- flacher Kontrollarm ohne jede Graph-Sicht als Referenz für spätere
  Graph-Experimente.

Die Cue-Schicht wird read-only beziehungsweise im Shadow als **2×2-faktorielles
Design über die beiden Cue-Achsen** verglichen — nicht als vier beliebige
Varianten:

| Arm | beschreibende Achse | assoziative Achse |
|---|---|---|
| 1 — Referenz | aus | aus |
| 2 | ein | aus |
| 3 | aus | ein |
| 4 | ein | ein |

Ausgewertet werden getrennt:

- die **Hauptwirkung der beschreibenden Achse** aus dem Vergleich (2 gegen 1)
  und (4 gegen 3);
- die **Hauptwirkung der assoziativen Achse** aus (3 gegen 1) und (4 gegen 2);
- die **Interaktion** aus der Differenz beider Hauptwirkungen.

Diese Auswertung ist der Grund für das Design: Arm 4 verdeckt die Arme 2 und 3
nur dann, wenn man ihn als fünfte Variante gegen den Referenzarm liest. Als
Zelle eines faktoriellen Plans trägt er im Gegenteil zu beiden Hauptwirkungen
bei und liefert zusätzlich die Interaktion. Fällt die Interaktion deutlich
negativ aus, gehören die Achsen nicht gemeinsam live, auch wenn jede für sich
einen Lift zeigt.

**Stufenproblem und zulässige Varianten.** Die beschreibende und die assoziative
Achse existieren je einmal auf Item- und einmal auf Szenenebene, und die
Szenenebene setzt das Episoden- und Claim-Schema aus M4 voraus. M2 darf deshalb
nur eine der beiden folgenden Varianten fahren und muss im Report ausweisen,
welche:

**Variante (a) — gestuft, ohne neue Infrastruktur.** M2 prüft das 2×2 auf
Item-Ebene mit `descriptive_entity` und `associative_bridge`. Die Szenenebene
mit `descriptive_scene` und `associative_horizon` folgt nach M4 als eigene,
gleich aufgebaute Ablation. Dies ist der empfohlene Weg, weil er keine
Vorleistung braucht.

**Variante (b) — vollständig, mit Vorleistung.** M2 prüft alle vier Familien,
setzt dafür aber eine klar definierte read-only Episoden- beziehungsweise
Szenenprojektion voraus, samt benannter Datenquelle und eigenen Goldfällen für
szenenbezogene Treffer. Ohne diese Projektion sind Szenen-Cues nicht bildbar.

Ohne eine dieser beiden Varianten darf ein M2-Report **nicht** behaupten, alle
vier Cue-Familien geprüft zu haben. Ein auf Item-Ebene gemessener Befund wird
nicht auf die Szenenebene übertragen.

Ablated wird ausschließlich die Rankingwirkung eines Cues, niemals seine
Provenienz: Ziel-ID, Herkunft, Generatorversion und Evidenzverbindung sind in
jedem Arm vollständig vorhanden. Ein Arm, der Cues ohne Evidenzverbindung
ausspielt, wäre keine Negativkontrolle, sondern ein Verstoß gegen 11.4 und wird
nicht gefahren.

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
- semantische Query-Klassen verlieren nicht mehr als die definierte Toleranz.

Cue- und Dämpfungsarme verfolgen verschiedene Ziele und erhalten deshalb
getrennte Gates:

- **Cue-Arm.** Die assoziative Coverage steigt messbar, während die
  False-Interrupt-Rate nicht schlechter und der Recall auf den übrigen
  Query-Klassen nicht schlechter wird. Eine gesenkte False-Interrupt-Rate
  allein qualifiziert einen Cue-Arm nicht — dafür ist er nicht gebaut.
- **Dämpfungsarm.** Die False-Interrupt-Rate sinkt messbar, ohne relevanten
  Recall-Verlust gegenüber dem identischen Arm ohne die zusätzliche
  Gravity-/Hub-Dämpfung.

Die numerischen Toleranzen beider Gates werden wie alle übrigen erst nach dem
M0-Baseline-Run festgelegt und versioniert abgelegt.

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
- Qualität der `no_answer`-Fälle, getrennt von der Rate der
  `inconclusive_budget_exhausted`-Fälle;
- Anteil der Läufe, die an einer Budgetgrenze statt an Erschöpfung enden,
  aufgeschlüsselt nach der zuerst erreichten Grenze;
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
  nachweislich greifen;
- kein Lauf gibt einen Budgetabbruch als `no_answer` aus; die drei Ergebnisse
  aus 8.5 sind in der Telemetrie unterscheidbar;
- die Budgetgrenzen sind versioniert abgelegt und im Report ausgewiesen;
- ausbleibender Evidenzgewinn schließt nachweislich nur den betroffenen Ast:
  kein Lauf endet mit `no_answer`, solange die Telemetrie offene Äste ausweist;
- das Ergebnisobjekt aus 8.5 kommt an MCP, REST, CLI und Mindspace
  unterschiedbar an; kein Konsument bildet einen Budgetstatus auf `no_answer`
  ab.

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
- ein erkannter Widerspruch erzeugt einen sichtbaren Konfliktbefund und einen
  `LINK`-Vorschlag für die `contradicts`-Kante, setzt aber kein `retracted_at`;
  zeitlich invalidiert wird ausschließlich durch eine bestätigte Auflösung;
- eine historische Aussage bleibt nach `SUPERSEDE` über ID, Version und Zitat
  erreichbar;
- die Survival-Quote nach 14.4 erreicht 100 % innerhalb von
  `max_provenance_hops`, und die Zitationsquote abgeleiteter Memories ist
  vollständig;
- die Survival-Invariante wird vor jeder einzelnen Klasse-A-Operation simuliert
  und blockiert die Operation oder erzeugt Provenienz-Shortcuts; kein
  Zwischenzustand eines Konsolidierungslaufs verletzt sie;
- ein `SUPERSEDE`-Rollback stellt Versions- und Zeitstatus **und** die aktuelle
  Sichtbarkeit wieder her;
- eine Graph-Sicht geht nur live, wenn sie ihren No-Graph-Kontrollarm schlägt;
- jede Topologie-Operation der Klasse A ist vor der Persistenz freigegeben und
  einzeln zurückrollbar;
- kein Klasse-B-Operator erzeugt eine Version, und keine dauerhafte
  Zugänglichkeitsentscheidung entsteht ohne expliziten Floor- oder
  Pin-Override.

### 18.6 M5 – Skalen- und Interferenztest sowie Flat/HNSW-Entscheidung

M5 beantwortet zwei verschiedene Fragen, die getrennt gemessen werden, weil sie
getrennte Ursachen haben: Wie zerfällt die Qualität, wenn der Vault wächst — und
lohnt sich ein anderes Vector-Backend? Ein gemeinsamer Lauf würde beides
vermischen und jeden Befund unbrauchbar machen.

#### 18.6.1 Skalen- und Interferenztest (backend-agnostisch)

Hypothese:

> Wachsender Vault erzeugt Interferenz, die sich nicht in der Latenz zeigt,
> sondern in Abstention, Widerspruchsauflösung und temporaler Genauigkeit.

Dieser Test ist eine Messung im Sinne von C-018 und darf jederzeit laufen. Er
gatet nichts und hängt an keinem Backend: Er wird auf **demselben** Backend über
alle Skalenstufen gefahren, damit ein beobachteter Abfall dem Wachstum und nicht
dem Index zuzuschreiben ist.

Skalen: aktueller Vault, 1.000, 3.000, 10.000, 50.000 Memories beziehungsweise
Chunks.

Heute messbare Kategorien:

- Abstention-Precision und -Recall auf den bestehenden Anti-Query- und
  `no_answer`-Fällen;
- Interferenz durch semantisch benachbarte Memories;
- Recall@1/@3/@10 und False-Interrupt-Rate je Skalenstufe;
- Latenz- und Degraded-Verhalten je Skalenstufe.

Erst nach M4 messbar, weil sie das Claim-, Versions- und Zeitschema
voraussetzen:

- Auflösung widersprechender Claims;
- temporale Fragen mit Versions- oder Gültigkeitsbezug;
- korrekte Reihenfolge zeitlich geordneter Ereignisse.

Diese zweite Gruppe wird vor M4 ausdrücklich nicht behauptet, nicht approximiert
und nicht als Lücke im Report verschwiegen; sie erscheint als „noch nicht
messbar, abhängig von M4“.

Toleranzen: Für jede heute messbare Kategorie wird nach dem M0-Baseline-Run ein
numerischer maximaler Abfall je Skalenverdopplung festgelegt und versioniert
abgelegt. Eine Ursachenbeschreibung dokumentiert einen Befund, ersetzt aber
niemals eine eingehaltene Toleranz: Ein verfehltes Ziel bleibt verfehlt, auch
wenn die Ursache bekannt ist.

Der Anlass ist belegt: Ein verbreitetes Fremdsystem erreicht auf kurzen
Konversationsbenchmarks Werte über 90 %, fällt aber bei zehn Millionen Token
Historie auf 50,5 % Pass Rate, mit deutlich schlechteren Teilwerten für
temporale Fragen, Widerspruchsauflösung und Abstention (siehe 2.3 für die
exakte Skala). Diese Zahlen stammen aus **verschiedenen Benchmarks mit
verschiedenen Aufgaben, Fragenmengen und Retrieval-Tiefen** und sind deshalb
kein isolierter Skalierungsbeweis: Sie zeigen nicht, dass Wachstum die Ursache
ist, sondern nur, dass niemand den Gegenbeweis erbracht hat. Sie sind der Grund,
selbst zu messen — mehr nicht. Absolutwerte des Fremdsystems sind kein Zielwert
(siehe 2.3); relevant ist ausschließlich der eigene Verlauf über die eigenen
Skalenstufen bei sonst identischem Aufbau.

#### 18.6.2 Flat/HNSW-Entscheidung (Live-Gate)

Hypothese:

> Automatische Backend-Wahl verbessert große Vaults, ohne relevante Treffer
> gegenüber exakter Flat Search zu verlieren.

Der Vergleich läuft auf **identischem Korpus, identischen Queries und
identischer Konfiguration**; die einzige Variable ist das Backend. Ein Vergleich
über verschiedene Korpusgrößen oder Konfigurationen hinweg ist kein
Backend-Vergleich.

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

Live-Gates:

- Recall@10 gegenüber Flat ≥ 98 % bei identischem Korpus und identischer
  Konfiguration;
- keine Sensitivity- oder Scope-Leaks;
- p95 tatsächlich besser;
- atomarer, wiederholbarer Switch;
- Flat-Fallback jederzeit funktionsfähig;
- keine Verschlechterung der in 18.6.1 gemessenen Qualitätskategorien über die
  dort festgelegten Toleranzen hinaus, gemessen auf demselben Korpus mit
  beiden Backends.

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
- ausgewiesene Exposure-Normalisierung gemäß 17.5 auf jedem Nutzungssignal;
- eine Aussage über kausalen Lift erst, wenn Propensity-Logging, kontrollierte
  Exploration und die Zensur-Behandlung nicht ausgespielter Kandidaten
  vorliegen; bis dahin sind ausschließlich deskriptive Ratenvergleiche
  zulässig;
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
- `valid_until` behält seine heutige Lifecycle-Semantik und wird nicht
  migriert; neue Zeitfelder kommen additiv daneben.
- Bestandsmemories ohne `provenance_class` gelten als `unknown_legacy`,
  importierte Bestände als `imported_unverified`; beide werden nicht massenhaft
  umgeschrieben.
- Der heutige `related_via`-Hop im Hook-Pfad bleibt aktiv, bis eine Messung
  eine bessere Sicht belegt.

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
- keine Übernahme eines Fremdsystem-Zielwerts als Bastra-Gate;
- keine Behauptung eines kausalen Utility-Lifts ohne Propensity-Logging,
  kontrollierte Exploration und Zensur-Behandlung nicht ausgespielter
  Kandidaten;
- kein Deep-Recall-Budgetabbruch, der als `no_answer` ausgegeben wird;
- kein abgeleiteter Cue und kein Graph-Hop, der allein `required` erzeugt;
- keine Ablation, die die Provenienzfelder eines abgeleiteten Cues entfernt;
- keine automatische Migration von `valid_until` in ein Gültigkeitsfeld;
- kein Altbestand, der ohne explizite Herkunft als Nutzeraussage gilt;
- kein importierter Inhalt, der allein wegen seines Import-`write_origin` als
  Nutzeraussage gilt.

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
- Ereignis-, Gültigkeits-, Wissens- und Ableitungszeit getrennt beantwortbar
  sind;
- Deep Recall eine erschöpfte Suche von einem Budgetabbruch unterscheidet;
- Zugänglichkeitsentscheidungen von inhaltlichen Versionen getrennt bleiben;
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

## 28. Delta-Ledger (C-029–C-054)

Dieser Abschnitt dokumentiert drei aufeinanderfolgende Runden von Deltas
gegenüber dem abgenommenen Stand C-001–C-028. Jeder Eintrag nennt die betroffene
Passage, die Art des Deltas, die tragende Evidenz, das Gate, die Datenquelle,
das Abnahmekriterium und den Rollback. Kein Eintrag deutet ein früheres Urteil
um.

**Runde 1 — C-029 bis C-039** entstand aus der Gegenprüfung eines
Recherche-Briefings zu vergleichbaren Agent-Memory-Systemen. Diese Einträge
sind unverändert übernommen; wo eine spätere Korrektur sie berührt, ist das im
jeweiligen Eintrag der Runde 2 vermerkt.

**Runde 2 — C-040 bis C-048** entstand aus dem Codex-Gegenreview der Runde 1.
Drei dieser Einträge korrigieren einen Fehler und nicht nur eine Ungenauigkeit:
C-042 kehrt einen sicherheitsrelevant falschen Default um, C-046 verhindert den
stillen Verlust einer produktiven Fähigkeit und deckt zugleich eine bestehende
Lücke auf dem BM25-only-Pfad auf, und C-040 hat zwei Fehlzitate der Runde 1
aufgedeckt.

Welcher Eintrag der Runde 1 durch welchen der Runde 2 präzisiert oder korrigiert
wird — bei Abweichung gilt stets die Fassung der Runde 2:

| Runde 1 | wird präzisiert durch | Art |
|---|---|---|
| C-029 | C-040 | Präzisierung: Belegpflicht wird operationalisiert |
| C-030 | C-043 | Korrektur: die Cue-Reduktion war Hypothese, nicht Entscheidung |
| C-031 | C-047 | Präzisierung: Abbruchbedingungen werden ausführbar |
| C-032 | C-041 | Präzisierung: Wissensachse wird Intervall, `valid_until` abgegrenzt |
| C-033 | C-042 | Korrektur: Fallback war sicherheitsrelevant falsch |
| C-034 | C-046 | Korrektur: heutige Hop-Baseline wäre still entfallen |
| C-035 | C-048 | Präzisierung: Erreichbarkeit wird messbar, Operatorklassen getrennt |
| C-036 | redaktionell | Präzisierung: Retrieval ist dominanter, nicht alleiniger Engpass |
| C-037 | C-044 | Korrektur: Normalisierung ist keine Bias-Korrektur |
| C-038 | C-045 | Korrektur: Skalentest und Backend-Gate waren vermischt |
| C-039 | redaktionell | Präzisierung: Vergleichsarm ist nicht „ungedämpft“ |

**Runde 3 — C-049 bis C-054** entstand aus dem Codex-Delta-Review der Runde 2
und ist ein reiner Delta-Fix. C-049 ist der schwerwiegendste Eintrag: Das in
C-042 eingeführte Mapping hätte über den Import-Pfad genau den Fehler wieder
eingeführt, den C-042 beheben sollte. Die Zuordnung zur Runde 2:

| Runde 2 | wird präzisiert durch | Art |
|---|---|---|
| C-042 | C-049 | Korrektur: Importherkunft muss `write_origin` vorgehen |
| C-041 | C-050 | Präzisierung: Widerspruch setzt kein `retracted_at`; fünf Zustände abgegrenzt |
| C-043 | C-051 | Präzisierung: 2×2-Design mit Stufenausweis statt Armliste |
| C-047 | C-052 | Korrektur: Astabbruch beendete fälschlich den Lauf |
| C-046 | C-052 | Präzisierung: Hop-Kennzeichnung bleibt serverintern |
| C-048 | C-053 | Präzisierung: Invariante wird durchgesetzt, `SUPERSEDE` abgegrenzt |
| C-040, C-044, C-045 | C-054 | Konsistenz: Korrekturverweise, Quellenzuordnung, ID-Stand |

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
- **Abnahmekriterium ersetzt durch C-043.** Das vorstehende Oder-Kriterium
  („hebt die assoziative Coverage oder senkt die False-Interrupt-Rate“) hätte
  einen Cue-Arm allein durch gesenkte Fehlinjektionen bestehen lassen.
  Verbindlich sind die getrennten Gates je Armtyp aus 18.3.

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
- **Korrigiert durch C-042.** Die vorstehende Rollback-Zeile ist falsch und
  wird nicht mehr angewandt: Ein fehlendes `provenance_class` gilt als
  `unknown_legacy`, niemals als `user_asserted`. Der Eintrag bleibt im
  Originalwortlaut stehen, weil das Ledger die Historie abbildet; verbindlich
  ist die Fassung in C-042 und 6.3.

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
- **Ergänzt durch C-046.** Die hier beschriebene Beschränkung des Normal Recall
  hätte die heute produktive semantische Hop-Baseline still entfernt. Sie
  bleibt als Kontrollarm erhalten, und ein Hop erzeugt niemals allein
  `required`.

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
  Argument-F1 bei perfektem Oracle-Retrieval. Das Finden der Evidenz ist damit
  der dominante, aber nicht der alleinige Engpass — selbst Oracle-Retrieval
  bleibt bei 53,8. T-Mem belegt zusätzlich Fälle, deren Cue dem Ziel weder
  lexikalisch noch semantisch ähnelt.
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
- **Begriff korrigiert durch C-044.** Dieser Eintrag spricht durchgehend von
  „Exposure-Korrektur“. Verbindlich ist die Bezeichnung
  **Exposure-Normalisierung**: Die Division durch die Ausspielungszahl macht
  Raten vergleichbar und behebt den Selektionsbias nicht. Der Eintrag bleibt im
  Originalwortlaut stehen, weil das Ledger die Historie abbildet; maßgeblich
  sind C-044 und 17.5.

### C-038 – M5 misst Qualitätszerfall unter Wachstum

- **Passage:** 18.6 M5.
- **Art:** Messproblem.
- **Evidenz:** Ein verbreitetes Fremdsystem erreicht auf kurzen
  Konversationsbenchmarks 94,8 % (Top 50) und 92,5 % (Top 200), fällt bei zehn
  Millionen Token Historie aber auf 50,5 % Pass Rate; die Teilkategorien
  temporale Fragen, Widerspruchsauflösung und Abstention liegen bei
  Durchschnittswerten von 0,163, 0,325 und 0,400 auf einer 0-bis-1-Skala. Siehe
  auch C-040: Die im Vorgängerdokument stehende Prozentlesart dieser drei Werte
  war falsch.
- **Gate:** M5.
- **Datenquelle:** die bestehenden Skalenstufen bis 50.000 Memories,
  angereichert um Goldfälle je Qualitätskategorie.
- **Abnahmekriterium:** Kein überproportionaler Abfall von Abstention-,
  Widerspruchs- oder Temporalqualität zwischen zwei Skalenstufen ohne benannte
  Ursache.
- **Rollback:** Reine Messerweiterung ohne Produktwirkung.
- **Abnahmekriterium ersetzt durch C-045.** Das vorstehende Kriterium „kein
  überproportionaler Abfall … ohne benannte Ursache“ ist nicht ausführbar: Es
  lässt sich weder bestehen noch verfehlen, und eine Ursachenbeschreibung hätte
  jedes Verfehlen entschuldigt. Verbindlich sind die nach der Baseline
  festzulegenden numerischen Toleranzen je Kategorie aus 18.6.1.

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
  Recall@3-Verlust gegenüber dem identischen Arm ohne die zusätzliche Gravity-
  und Hub-Dämpfung. Der Vergleichsarm ist ausdrücklich nicht „ungedämpft“: Die
  bestehende Lifecycle-, Curator-, Doc- und Salience-Dämpfung bleibt in beiden
  Armen aktiv.
- **Rollback:** Arm abschalten; die bestehende Dämpfung bleibt unverändert.

---

*Ab hier Runde 2: die Deltas aus dem Codex-Gegenreview der vorstehenden
Einträge.*

### C-040 – Reproduzierbare Quellenmatrix

- **Passage:** 29 vollständig neu gefasst, mit den Unterabschnitten 29.1 bis
  29.5; ergänzend 18.1 M0 unter Arbeit und Gate.
- **Art:** Messproblem.
- **Evidenz:** Die Matrix der Vorgängerrevision nannte je Fremdclaim nur System,
  Evidenzklasse und Urteil. Ohne Version, Fundstelle und Messkonfiguration ist
  keine dieser Aussagen nachprüfbar. Der Abruf aller Quellen am 25. Juli 2026
  hat das bestätigt und zugleich zwei eigene Fehlzitate aufgedeckt: die Lesart
  dreier BEAM-Durchschnittswerte als Prozentzahlen und die Behauptung, Ori
  dokumentiere kein Konvergenzkriterium. Von neunzehn geprüften Messungen
  nennen drei alle vier Konfigurationsgrößen; am häufigsten fehlt das
  Kontextbudget, am folgenreichsten der Judge.
- **Gate:** M0.
- **Datenquelle:** die Primärquellen selbst sowie die Report-Metadaten des
  Eval-Harness.
- **Abnahmekriterium:** Jede zitierte Fremdaussage trägt kanonischen Ort,
  Version oder Commit, Fundstelle und Abrufdatum; jede zitierte Messung
  zusätzlich Reader, Judge, Top-k und Kontextbudget oder den ausdrücklichen
  Vermerk, dass die Quelle die Angabe nicht macht. Geschätzte oder aus anderen
  Quellen übertragene Werte sind unzulässig.
- **Rollback:** Reine Dokumentations- und Reportregel ohne Laufzeitwirkung.

### C-041 – Vollständig bi-temporales Zeitmodell

- **Passage:** 6.3 Unterabschnitt Zeitachsen; 18.5 M4; 22; 24; 25 Punkt 9.
- **Art:** Architekturentscheidung.
- **Evidenz:** Die Vorgängerrevision führte `recorded_at` als Zeitpunkt. Damit
  ist die Wissensachse kein Intervall, und die Frage „was hielt das System am
  Stichtag X für wahr?“ bleibt unbeantwortbar. Ein produktiv implementiertes
  Fremdsystem führt an dieser Stelle vier Marken — zwei auf der Transaktions-
  und zwei auf der Ereigniszeitlinie — und invalidiert widersprochene Fakten
  zeitlich, statt sie zu löschen. Zum heutigen `valid_until` belegt der Code:
  Es wird an genau einer Stelle gelesen und dort ausschließlich in einen
  Score-Multiplikator übersetzt — 20 % bei abgelaufener, 85 % bei alternder
  Gültigkeit. Kein Codepfad schließt ein Memory deswegen aus. Ein Feld mit
  Weltgültigkeitssemantik existiert heute nicht, ebenso wenig ein Feld mit
  Ereigniszeitsemantik.
- **Gate:** M4 und der gesonderte Schemaentscheid aus 21.4.
- **Datenquelle:** Punkt-in-der-Zeit-Goldfälle über beide Achsen; read-only
  Projektion vor der Schemaentscheidung.
- **Abnahmekriterium:** Eine Punkt-in-der-Zeit-Abfrage liefert getrennt, was am
  Stichtag wahr war und was das System damals dafür hielt; kein Feld trägt zwei
  Bedeutungen; `valid_until` behält seine Dämpfungswirkung unverändert und wird
  nicht migriert.
- **Rollback:** Alle Felder sind additiv und optional. Wird die Projektion
  verworfen, verhält sich das System exakt wie heute, weil `valid_until`
  unangetastet blieb.

### C-042 – Sicherer Provenienz-Fallback

- **Passage:** 6.3 Unterabschnitt Herkunft, neuer Block „Fallback für den
  Altbestand“; 18.5 M4; 22; 24; Rollback-Zeile in C-033.
- **Art:** Ist-Korrektur eines Fehlers der Vorgängerrevision.
- **Evidenz:** Die Vorgängerrevision schrieb als Rollback „ohne Feld gilt
  konservativ `user_asserted`“. Das ist die gefährlichste mögliche Voreinstellung
  und zugleich sachlich falsch. Der Code belegt das Gegenteil: `write_origin`
  ist optional ohne Schema-Default, die Schreibkaskade endet auf
  `agent-session`, und sämtliche Schutzprüfungen vergleichen strikt gegen
  `user-directed`. Ein Bestandsmemory ohne das Feld ist heute faktisch
  ungeschützt. Der Vault enthält also gerade keine Information, die eine
  Nutzerurheberschaft belegen würde. Ergänzend: `confidence` besitzt einen
  Schema-Default von 1,0 und wird im gesamten Retrieval-Pfad nie gelesen, taugt
  also nicht als Herkunftssignal; `source` wird maschinell nur vom Vault-Import
  gesetzt.
- **Gate:** M4 und Schemaentscheid; die Regel selbst gilt sofort für jede
  Ableitung.
- **Datenquelle:** Stichprobenklassifikation über den Bestand;
  Konsolidierungs-Reviews.
- **Abnahmekriterium:** Kein Memory erhält automatisch `user_asserted`, außer
  es trägt explizit `write_origin: user-directed`; alles übrige wird
  `unknown_legacy`; `confidence` geht in kein Mapping ein; es findet kein
  Massen-Rewrite statt.
- **Rollback:** Das Feld ist additiv. Ohne es verhält sich das System wie heute;
  `unknown_legacy` erzeugt keinerlei Sonderbehandlung, sondern nur die
  Verweigerung einer unbelegten Einstufung.
- **Korrigiert durch C-049 in zwei Punkten.** Erstens ist das hier beschriebene
  einstufige Mapping unsicher: Der Vault-Import stempelt auch maschinelle
  Inhalte als `write_origin: user-directed`, weshalb die Importprüfung Vorrang
  hat und nur ein nicht importierter Save automatisch `user_asserted` wird.
  Zweitens ist die Formulierung, `confidence` werde „im gesamten Retrieval-Pfad
  nie gelesen“, sachlich falsch — das Feld wird beim Indexieren gelesen und im
  Suchindex gehalten, wirkt dort aber nicht. Der Eintrag bleibt im
  Originalwortlaut stehen; maßgeblich sind C-049 und 6.3.

### C-043 – Cue-Ablation statt vorweggenommener Reduktion

- **Passage:** 11.4; 18.3 M2 Arme, Metriken und Gates.
- **Art:** Messproblem.
- **Evidenz:** Die Vorgängerrevision reduzierte die vier Cue-Familien auf zwei
  und begründete das mit der Abdeckung der beschreibenden Achse durch Titel,
  Tags, `topic_path` und Summary. Diese Begründung ist plausibel, stützt sich
  aber auf eine Fremdarbeit und auf die Struktur des Index — nicht auf eine
  Bastra-Messung. Damit nahm sie das Ergebnis der Ablation vorweg, die sie im
  selben Dokument anordnete. Zweitens sah dieselbe Fassung Arme „mit und ohne
  Rückbindung an die Evidenz“ vor; ein Arm ohne Provenienz verstößt gegen die
  Regel aus 11.4 und wäre keine Negativkontrolle, sondern ein Regelbruch.
  Drittens verband ein einziges Gate die Cue- und die Dämpfungsarme mit einem
  Oder — womit ein Cue-Arm allein durch gesenkte Fehlinjektionen hätte bestehen
  können, ohne je assoziative Abdeckung zu liefern.
- **Gate:** M2, mit getrennten Gates je Armtyp.
- **Datenquelle:** assoziative Goldfälle nach 19; vier Cue-Arme als read-only
  beziehungsweise Shadow-Projektion.
- **Abnahmekriterium:** Cue-Arm — die assoziative Coverage steigt messbar, ohne
  Verschlechterung von False-Interrupt-Rate und Recall. Dämpfungsarm — die
  False-Interrupt-Rate sinkt ohne relevanten Recall-Verlust. Jeder abgeleitete
  Cue trägt in jedem Arm Ziel-ID, Herkunft, Generatorversion und
  Evidenzverbindung.
- **Rollback:** Sidecar ignorieren; das Retrieval verhält sich wie heute.

### C-044 – Exposure-Normalisierung ist keine Bias-Korrektur

- **Passage:** 17.5; 18.7 M6; 24.
- **Art:** Messproblem.
- **Evidenz:** Die Vorgängerrevision nannte die Division durch die
  Ausspielungszahl „Exposure-Korrektur“ und behauptete damit implizit, sie
  behebe den Selektionsbias. Sie macht Raten vergleichbar, mehr nicht: Warum ein
  Kandidat überhaupt ausgespielt wurde, hängt vom bisherigen Ranking ab, und
  genau das bleibt unbeobachtet. Auch das als Vorbild zitierte Fremdsystem
  normalisiert lediglich — es teilt den Reward durch die Exposure-Zahl hoch 0,5
  — und beansprucht keine Propensity-Korrektur.
- **Gate:** M6; vor Erfüllung der drei Voraussetzungen ist keine kausale
  Aussage zulässig.
- **Datenquelle:** Telemetrie mit `client`, `hook_source` und pseudonymer
  Session nach C-020; zusätzlich geloggte Auswahlwahrscheinlichkeiten und ein
  randomisierter beziehungsweise Explorationsarm.
- **Abnahmekriterium:** Der Report weist die Normalisierung als solche aus. Ein
  kausaler Utility-Lift wird erst behauptet, wenn Propensities geloggt sind,
  kontrollierte Exploration läuft und nicht ausgespielte Kandidaten als
  zensiert behandelt werden. Bis dahin sind ausschließlich deskriptive
  Ratenvergleiche zulässig.
- **Rollback:** Signale weiter protokollieren, keine Live-Wirkung; Fallback ist
  die deterministische Reihenfolge des Evidenzentscheids.

### C-045 – Skalentest und Backend-Entscheidung getrennt

- **Passage:** 18.6 neu gegliedert in 18.6.1 und 18.6.2.
- **Art:** Messproblem.
- **Evidenz:** Die Vorgängerrevision hängte die Qualitätskategorien an das
  Flat/HNSW-Gate. Damit wären Wachstumseffekte und Backend-Effekte in einem
  Lauf vermischt worden und kein Befund mehr einer Ursache zuzuordnen. Zweitens
  setzen drei der fünf Kategorien — Widerspruchsauflösung, temporale Fragen,
  Ereignisreihenfolge — ein Claim-, Versions- und Zeitschema voraus, das erst
  M4 liefert; sie waren im Gate aufgeführt, ohne messbar zu sein. Drittens ist
  „kein überproportionaler Abfall ohne benannte Ursache“ kein ausführbares
  Kriterium: Es lässt sich nicht bestehen oder verfehlen, und eine
  Ursachenbeschreibung hätte jedes Verfehlen entschuldigt.
- **Gate:** 18.6.1 gatet nichts und ist jederzeit als Messung zulässig; 18.6.2
  bleibt das Live-Gate M5.
- **Datenquelle:** Skalenstufen bis 50.000 Memories auf identischem Backend für
  den Interferenztest; identischer Korpus mit beiden Backends für den
  Backend-Vergleich.
- **Abnahmekriterium:** Der Backend-Vergleich variiert ausschließlich das
  Backend. Für jede heute messbare Qualitätskategorie liegt nach der Baseline
  ein numerischer maximaler Abfall je Skalenverdopplung versioniert vor; ein
  verfehlter Wert bleibt verfehlt, unabhängig von der Ursachenbeschreibung.
  M4-abhängige Kategorien erscheinen bis dahin als „noch nicht messbar“.
- **Rollback:** Reine Messgliederung ohne Produktwirkung.

### C-046 – Erhalt der heutigen Hop-Baseline und Hop-Regel für `required`

- **Passage:** 13.1, neue Unterabschnitte zur Hop-Baseline und zur
  `required`-Regel; 18.2 M1; 18.5 M4; 22; 24.
- **Art:** Ist-Korrektur.
- **Evidenz:** Die Beschränkung des Normal Recall auf die Entity- und die
  temporale Sicht hätte eine heute produktive Fähigkeit stillschweigend
  entfernt. Der Code belegt: Der Hook-Endpunkt setzt `expand_hops` von sich aus
  auf 1, sofern der Aufrufer nicht ausdrücklich 0 sendet; kein Hook sendet den
  Parameter. Traversiert wird ausschließlich `related_via`, also genau die
  semantische Sicht. Der MCP-Pfad hoppt dagegen nie. Zur `required`-Regel
  belegt derselbe Code eine offene Lücke: Ein Hop-Nachbar erhält höchstens die
  Hälfte des rohen Seed-Scores, die Herkunftskennzeichnung `hop` wird vor der
  Auslieferung an den Hook aus der Antwort projiziert, und die
  `required`-Entscheidung fällt allein über die Schwelle 100. Auf dem
  Hybrid-Pfad verhindert nur die Obergrenze der skalierten Rangsumme bei rund
  164, dass ein Nachbar diese Schwelle erreicht. Auf dem BM25-only-Pfad — dem
  Fallback bei fehlenden oder ausgefallenen Embeddings — existiert diese
  Sicherung nicht.
- **Gate:** M1 für die `required`-Regel; M4 für den Sichtenvergleich.
- **Datenquelle:** Goldfälle, deren Ziel nur über einen Hop erreichbar ist;
  Hook-Telemetrie mit erhaltener Hop-Kennzeichnung; Sichtenablation gegen die
  semantische Baseline und gegen den No-Graph-Arm.
- **Abnahmekriterium:** Die semantische Sicht mit Hop-Budget eins bleibt aktiv
  und dient als Kontrollarm; keine neue Sicht verdrängt sie ohne eigenen
  belegten Lift. Kein Treffer wird allein aufgrund einer Kante `required`; die
  Hop-Herkunft steht dem Evidenzentscheid zur Verfügung.
- **Rollback:** Sichten deaktivieren; `related_via` mit Hop-Budget eins ist der
  heutige Zustand und bleibt der Rückfallpunkt.

### C-047 – Ausführbare Deep-Recall-Abbruchbedingungen

- **Passage:** 8.5, Blöcke zu Budgetgrenzen, Evidenzgewinn, Abbruch und den
  drei Ergebnissen; 18.4 M3 Metriken und Gates; 24; 26.2.
- **Art:** Architekturentscheidung.
- **Evidenz:** Die Vorgängerrevision nannte drei qualitative
  Abbruchbedingungen. „Kein neuer Evidenzgewinn“ war undefiniert, und für
  Laufzeit, Tokens, Äste, Tiefe, Provider-Aufrufe und Kandidaten existierte
  keine Obergrenze. Schwerer wiegt, dass beide erschöpfenden Ausgänge und der
  Budgetabbruch in einem einzigen `no_answer` zusammengefallen wären. Das ist
  nicht nur für den Nutzer irreführend — es verfälscht die Abstention-Metriken
  aus 18.2, weil abgebrochene Läufe dort als korrekte Enthaltung gezählt
  würden.
- **Gate:** M3, mit gesonderter Freigabe für Stufe 2.
- **Datenquelle:** Branch-, Konvergenz- und Budgettelemetrie; dormante
  Goldfälle; Kontrollarm mit lediglich vervierfachtem `k`.
- **Abnahmekriterium:** Die Grenzwerte liegen versioniert vor und stehen im
  Report. Evidenzgewinn ist über neue Evidenz-IDs oder neu beantwortete
  Teilfragen definiert. Die drei Ergebnisse sind in der Telemetrie
  unterscheidbar, und kein Budgetabbruch wird als `no_answer` ausgegeben.
- **Rollback:** Stufe 2 abschalten; Stufe 1 und Normal Recall bleiben
  unberührt.
- **Korrigiert durch C-052.** Die hier eingeführte Abbruchbedingung „zwei
  aufeinanderfolgende Schritte ohne Evidenzgewinn“ beendete den gesamten Lauf
  und wurde `no_answer` zugeordnet. Verbindlich ist die Fassung in 8.5: Sie
  schließt nur den Ast, und `no_answer` setzt deterministische Erschöpfung
  voraus.

### C-048 – Messbare Erreichbarkeit, getrennte Accessibility-Operatoren

- **Passage:** 14.4, gegliedert in Klasse A und Klasse B sowie den Block zur
  Erreichbarkeitsgarantie; 18.5 M4; 26.2.
- **Art:** Architekturentscheidung.
- **Evidenz:** „Eine begrenzte Zahl typisierter Links“ ist ohne Zahl nicht
  prüfbar; auch die als Vorbild zitierte Fremdarbeit führt an dieser Stelle nur
  ein Symbol und keinen Wert. Zweitens standen `DORMANT` und `REACTIVATE` in
  derselben Operatorliste wie `SPLIT`, `MERGE` und `UPDATE`, obwohl sie keinen
  Inhalt ändern. Das widerspricht 7.1: Accessibility ist dort ausdrücklich eine
  reproduzierbare Projektion und keine gespeicherte Wahrheit — ein Operator,
  der sie als Version schriebe, hübe genau diese Eigenschaft auf.
- **Gate:** M4.
- **Datenquelle:** Konsolidierungsläufe; Erreichbarkeitsprüfung über den
  archivierten Bestand; Review-Protokolle.
- **Abnahmekriterium:** `max_provenance_hops` liegt versioniert vor und beginnt
  bei zwei. Die Survival-Quote erreicht 100 %, die Zitationsquote abgeleiteter
  Memories ist vollständig. Kein Klasse-B-Operator erzeugt eine Version, und
  eine dauerhafte Zugänglichkeitsentscheidung entsteht nur über einen
  expliziten Floor- oder Pin-Override.
- **Rollback:** Vorschläge nicht anwenden. Klasse-B-Vorschläge wirken ohne
  Override ohnehin nur bis zur nächsten Neuberechnung der Projektion.

---

*Ab hier Runde 3: die Deltas aus dem Codex-Delta-Review der Runde 2. Ein reiner
Delta-Fix — Passagen ohne Befund wurden nicht angefasst.*

### C-049 – Importherkunft vor `write_origin`, korrigierte `confidence`-Aussage

- **Passage:** 6.3, Fallback-Block vollständig neu gefasst als zweistufiges
  Mapping mit neuem Unterabschnitt „Review-Status statt Prosa-Vormerkung“; neue
  Klasse `imported_unverified` in der Klassentabelle; Korrektur der
  `confidence`-Aussage in 6.3, in 10.2, im Delta-Eintrag C-042 samt Ledgerzeile
  und in 32; Ergänzung der Importklasse in 22 und der Verbotszeile in 24.
- **Art:** Ist-Korrektur.
- **Evidenz:** Der Vault-Import stempelt jeden übernommenen Inhalt mit
  `write_origin: "user-directed"` — belegt in
  `packages/daemon/src/import/adapters.ts:153`, dort zusammen mit
  `source: "<adapter>:<label>:<relKey>"`. Dasselbe gilt in
  `packages/daemon/src/import-vault.ts:369` für einen **vollständig maschinell
  erzeugten Navigations-Index**, dort mit `source: "index:<label>"`,
  `topic_path: ["imported", <label>]` und dem Tag `imported`. Das in C-042
  eingeführte einstufige Mapping hätte damit einen fremden Vault samt
  generierter Hilfsknoten geschlossen zu Nutzeraussagen erklärt — genau der
  Fehler, den C-042 beheben sollte, nur durch eine andere Tür. Zur zweiten
  Korrektur: `confidence` wird sehr wohl gelesen, nämlich beim Indexieren
  (`packages/core/src/search.ts:724`), und als `storeField` im Suchindex
  gehalten (`search.ts:106` und `search.ts:175`). Die Aussage „wird beim
  Retrieval nirgends gelesen“ war falsch; richtig ist, dass das Feld weder
  Ranking noch Filterung noch den Evidenzentscheid beeinflusst.
- **Gate:** M4 und Schemaentscheid; die Vorrangregel gilt sofort für jede
  Ableitung.
- **Datenquelle:** `source`, `topic_path` und Tags des Bestandsmemorys für
  Stufe 1; `write_origin` ausschließlich für Stufe 2; Review-Status in der
  Sidecar-Projektion.
- **Abnahmekriterium:** Kein importiertes Memory erhält automatisch
  `user_asserted`; die Importprüfung läuft nachweislich vor der
  `write_origin`-Auswertung; `capture-review` landet konservativ auf
  `unknown_legacy` mit Review-Status `pending`; `confidence` geht in kein
  Mapping ein und wird im Dokument nicht mehr als ungelesen bezeichnet.
- **Rollback:** Additive Sidecar-Felder. Ohne sie verhält sich das System wie
  heute; `imported_unverified` erzeugt keine Sonderbehandlung, sondern nur die
  Verweigerung einer unbelegten Einstufung.

### C-050 – Widerspruch, Zeitachsen und die übrigen Zustände abgegrenzt

- **Passage:** 6.3 Zeitachsen, gestufter Widerspruchsablauf, Abgrenzung von
  `valid_to` gegen Rolle und Accessibility sowie neuer Unterabschnitt „Fünf
  getrennte Zustände“; nachgezogene Gate-Zeile in 18.5.
- **Art:** Architekturentscheidung.
- **Evidenz:** Die Formulierung „Ein Widerspruch setzt deshalb `retracted_at`“
  war zu stark. Sie hätte eine automatische Wahrheitsentscheidung aus einer
  bloßen Konflikterkennung abgeleitet und damit gegen die Regel aus Abschnitt
  13 verstoßen, dass widersprechende Kanten sichtbar erklärt und nicht still
  aufgelöst werden. Zweitens standen `valid_to`, `recorded_at`/`retracted_at`,
  `valid_until`, `obsolete` und Soft Delete unverbunden nebeneinander, obwohl
  sie sich in der Wirkung ähneln — alle fünf können dazu führen, dass ein
  Memory nicht mehr auftaucht — und in der Bedeutung nicht.
- **Gate:** M4 und Schemaentscheid.
- **Datenquelle:** Goldfälle mit offenen und mit aufgelösten Widersprüchen;
  Operatorprotokolle.
- **Abnahmekriterium:** Ein erkannter Widerspruch erzeugt einen konkurrierenden
  Claim beziehungsweise eine `contradicts`-Kante und setzt kein `retracted_at`;
  dieses wird ausschließlich durch bestätigte Auflösung, akzeptierte Korrektur
  oder bestätigtes `SUPERSEDE` gesetzt. Keine automatische Gleichsetzung oder
  Migration zwischen den fünf Zuständen; eine Operation, die mehrere berührt,
  weist das im Operatorvertrag aus.
- **Rollback:** Ein offener Widerspruch ist der Ausgangszustand. Wird die
  Auflösung zurückgenommen, entfällt `retracted_at` und beide Aussagen sind
  wieder aktiv.

### C-051 – Cue-Ablation als 2×2-Design mit Stufenausweis

- **Passage:** 18.3, Cue-Abschnitt neu gefasst; 11.4 um die Stufenabhängigkeit
  ergänzt; 30 umformuliert.
- **Art:** Messproblem.
- **Evidenz:** Die vier Arme aus der Vorgängerrevision waren als Liste
  formuliert. Gelesen als vier Varianten gegen einen Referenzarm verdeckt der
  Kombinationsarm die Einzelarme; gelesen als Zellen eines faktoriellen Plans
  über die beiden Achsen tut er das nicht, sondern liefert zusätzlich die
  Interaktion. Zweitens beziehen sich `descriptive_scene` und
  `associative_horizon` auf Episoden beziehungsweise Szenen — ein Gegenstand,
  den das Vault-Schema erst mit M4 kennt. M2 hätte also über zwei Familien
  berichtet, die es gar nicht bilden kann. Drittens las sich die
  Zurückstellung in Abschnitt 30 wie eine bereits getroffene Ablehnung der
  beschreibenden Achse.
- **Gate:** M2 für die Item-Ebene; M4 für die Szenenebene, sofern Variante (a)
  gewählt wird.
- **Datenquelle:** assoziative und beschreibende Goldfälle nach 19; für
  Variante (b) zusätzlich eine benannte read-only Episoden- beziehungsweise
  Szenenprojektion mit eigenen Goldfällen.
- **Abnahmekriterium:** Der Report weist Hauptwirkung je Achse und Interaktion
  getrennt aus und benennt, welche der beiden Varianten gefahren wurde. Ein auf
  Item-Ebene gemessener Befund wird nicht auf die Szenenebene übertragen. Kein
  Report behauptet ohne eine der beiden Varianten, alle vier Familien geprüft
  zu haben.
- **Rollback:** Sidecar ignorieren; das Retrieval verhält sich wie heute.

### C-052 – Ast- und Laufabbruch getrennt, Ergebnisvertrag über alle Oberflächen

- **Passage:** 8.5, Abbruchabschnitt neu gefasst, Budgetgrenzen in harte und
  weiche getrennt und um den Oberflächenvertrag ergänzt; 8.4 Punkt 8
  nachgezogen; 13.1, Schlussabsatz zur Hop-Kennzeichnung; 18.2 und 18.4.
- **Art:** Architekturentscheidung.
- **Evidenz:** Die Vorgängerrevision ließ „zwei aufeinanderfolgende Schritte
  ohne Evidenzgewinn“ den gesamten Lauf beenden und ordnete diesen Ausgang
  zudem `no_answer` zu. Beides ist falsch: Ein erschöpfter Zweig sagt nichts
  über die übrigen offenen Äste, und ein Lauf, der mit offenen Ästen stehen
  bleibt, hat gerade nicht gezeigt, dass keine Evidenz existiert. In dieser
  Form hätte die Regel dieselbe Metrikverfälschung erzeugt, die C-047
  verhindern wollte. Zweitens war der Ergebnisvertrag nur für die
  Deep-Recall-Stufe beschrieben, nicht für die Oberflächen, über die er
  ausgeliefert wird.
- **Gate:** M3.
- **Datenquelle:** Branch- und Konvergenztelemetrie mit Zahl offener Äste je
  Abbruch; Oberflächenprotokolle von MCP, REST, CLI und Mindspace.
- **Abnahmekriterium:** Ausbleibender Evidenzgewinn schließt nur den Ast.
  `no_answer` tritt ausschließlich nach deterministischer Erschöpfung aller
  Teilfragen und zulässigen Äste auf. Das Ergebnisobjekt wird unverändert durch
  MCP, REST, CLI und Mindspace geführt; kein Budgetstatus wird durch Fehler-
  oder UI-Behandlung in `no_answer` umgewandelt. Die Hooks sind kein Konsument
  der Stufe 2.
- **Rollback:** Stufe 2 abschalten; Stufe 1 und Normal Recall bleiben
  unberührt. Die Lean-Projektion der Hook-Antwort bleibt in jedem Fall
  unverändert, da die Hop-Kennzeichnung serverintern bleibt.

### C-053 – Erhaltungsregel für die Survival-Invariante, Sonderfall `SUPERSEDE`

- **Passage:** 14.4, Erreichbarkeitsgarantie um die Erhaltungsregel erweitert,
  neuer Unterabschnitt zu `SUPERSEDE`; 18.5.
- **Art:** Architekturentscheidung.
- **Evidenz:** `SPLIT` gefolgt von `MERGE` bringt eine Ursprungsquelle auf
  genau zwei Provenienz-Hops — die Grenze wird erreicht, aber nicht
  überschritten. Bereits eine weitere Generation überschreitet sie. Ein
  Startwert ohne Durchsetzungsmechanismus wäre damit in der zweiten
  Konsolidierungsrunde wirkungslos. Zum zweiten Punkt: `SUPERSEDE` verschiebt
  den Wahrheitsstand und wirkt dadurch auch auf die Sichtbarkeit des
  Vorgängers. Ohne ausdrückliche Abgrenzung wäre unklar, ob daraus eine
  Accessibility-Entscheidung der Klasse B folgt — was der Trennung aus C-048
  widerspräche.
- **Gate:** M4.
- **Datenquelle:** Simulation der Invariante je Operation; Erreichbarkeitslauf
  über den archivierten Bestand nach jedem Konsolidierungsschritt;
  Rollback-Protokolle.
- **Abnahmekriterium:** `max_provenance_hops` = 2 gilt als Startkandidat und
  wird durch die Messung bestätigt oder korrigiert. Vor jeder einzelnen
  Klasse-A-Operation wird die Invariante simuliert; die Operation wird
  blockiert oder erzeugt additive Provenienz-Shortcuts, welche die ursprüngliche
  Kette nicht ersetzen. Kein Zwischenzustand eines Laufs verletzt die
  Invariante. `SUPERSEDE` bleibt Klasse A, erzeugt keinen dauerhaften
  Accessibility-Override, und sein Rollback stellt Versions- und Zeitstatus
  sowie die aktuelle Sichtbarkeit wieder her.
- **Rollback:** Vorschläge nicht anwenden. Eine blockierte Operation
  hinterlässt keinen Zustand.

### C-054 – Ledger- und Quellenkonsistenz

- **Passage:** 0.4 Ledgerzeilen zu C-037 und C-038; die Delta-Einträge C-037
  und C-038 in Abschnitt 28; 29.3 Zeile zu AgentRunbook; 32; sämtliche Angaben
  zur nächsten freien ID.
- **Art:** Messproblem beziehungsweise Redaktionsfehler.
- **Evidenz:** Fünf Inkonsistenzen aus der Vorgängerfassung: C-037 sprach
  weiterhin von „Exposure-Korrektur“, obwohl C-044 den Begriff korrigiert;
  C-038 führte weiterhin das durch C-045 ersetzte, nicht ausführbare
  Abnahmekriterium; die AgentRunbook-Messzeile in 29.3 nannte nur „Tabelle 2“
  ohne Quellenbezug und war damit nur indirekt auflösbar; die Zusammenfassung in
  32 stützte sich auf die inzwischen korrigierte `confidence`-Aussage; und die
  nächste freie ID stand an drei Stellen auf dem alten Wert.
- **Gate:** entfällt — Dokumentkonsistenz.
- **Datenquelle:** das Dokument selbst.
- **Abnahmekriterium:** Jeder korrigierte Alteintrag trägt an Ort und Stelle
  einen Korrekturverweis auf den korrigierenden Eintrag, analog zur bereits
  bestehenden Behandlung von C-033 durch C-042. Jede Messzeile in 29.3 ist über
  Quelle, Version und Fundstelle auflösbar. Die nächste freie ID lautet an allen
  Stellen C-055.
- **Rollback:** Rein redaktionell, ohne Laufzeit- oder Vertragswirkung.

## 29. Quellen- und Behauptungsmatrix

Alle Angaben wurden am **25. Juli 2026** durch Abruf der jeweiligen Primärquelle
erhoben. Diese Fassung ersetzt die knappe Matrix der Vorgängerrevision, die
weder Versionen noch Fundstellen noch Messkonfigurationen enthielt und damit
nicht nachprüfbar war.

### 29.1 Zitierregel

Jede Fremdaussage, die in diesem Dokument als Begründung auftaucht, muss
belegbar sein durch:

1. den kanonischen Quellenort — DOI, wenn vergeben, sonst die stabile
   arXiv-`abs`-, Anthology- oder Repository-URL;
2. die Version — arXiv-Versionsnummer mit Datum, Commit-SHA mit Datum oder
   Proceedings-Seitenzahlen; bei undatierten Anbieterseiten der Vermerk „nicht
   versioniert“ samt etwaigem `dateModified`;
3. die genaue Fundstelle — Tabelle, Abschnitt, Seite oder README-Abschnitt;
4. das Abrufdatum;
5. bei Messungen zusätzlich Reader, Judge, Top-k und Kontextbudget.

Fehlt eine dieser Angaben in der Quelle, wird sie als **fehlend ausgewiesen**
und nicht ergänzt, geschätzt oder aus einer anderen Quelle übertragen. Die
Lückenliste in 29.3 ist Teil des Belegs, nicht ein Mangel daran.

### 29.2 Quellenverzeichnis

| Kurzname | Kanonischer Ort | Version / Stand |
|---|---|---|
| Hindsight (Demo) | `doi:10.18653/v1/2026.acl-demo.27` | ACL 2026 System Demonstrations, S. 275–285 |
| Hindsight (Vollfassung) | `doi:10.48550/arXiv.2512.12818` | v1, 2025-12-14, 28 Seiten |
| Hindsight (Code) | `github.com/vectorize-io/hindsight` | `ed120a2`, 2026-07-24, MIT |
| Zep/Graphiti (Paper) | `doi:10.48550/arXiv.2501.13956` | v1, 2025-01-20, 12 Seiten |
| Zep (Anbieterzahlen) | `getzep.com/research` | nicht versioniert, `dateModified` 2026-05-28 |
| Graphiti (Code) | `github.com/getzep/graphiti` | `3bb2d0b`, 2026-07-23 |
| Mem0 (Benchmarks) | `github.com/mem0ai/memory-benchmarks` | `4b61c5d`, 2026-05-13, Apache 2.0 |
| Mem0 (SDK) | `github.com/mem0ai/mem0` | `d653b63`, 2026-07-24 |
| Mem0 (Paper) | `doi:10.48550/arXiv.2504.19413` | v1, 2025-04-28 |
| BEAM | `doi:10.48550/arXiv.2510.27246` | v2, 2026-02-21; ICLR 2026 |
| T-Mem | `arxiv.org/abs/2606.15405` | v1, 2026-06-13; kein DOI, kein Code |
| All-Mem (Paper) | `arxiv.org/abs/2603.19595` | v2, 2026-06-15; kein DOI |
| All-Mem (Code) | `github.com/LvCan926/All-Mem` | `f5d6912`, 2026-06-15, MIT |
| MAGMA (Paper) | `doi:10.18653/v1/2026.acl-long.1709` | ACL 2026 Long Papers, S. 36848–36865 |
| MAGMA (Code) | `github.com/FredJiang0324/MAGMA` | `467cb70`, 2026-07-10 |
| Mem2ActBench | `doi:10.18653/v1/2026.acl-long.370` | ACL 2026 Long Papers, S. 8173–8190 |
| Graph-Gegenanalyse | `doi:10.18653/v1/2026.acl-long.1232` | ACL 2026 Long Papers, S. 26758–26782 |
| Graph-Gegenanalyse (Code) | `github.com/AvatarMemory/UnifiedMem` | `3df9428`, 2026-04-18 |
| LongMemEval-V2 (Paper) | `arxiv.org/abs/2605.12493` | v1, 2026-05-12; kein DOI |
| LongMemEval-V2 (Code) | `github.com/xiaowu0162/LongMemEval-V2` | `6f020ac`, 2026-07-19 |
| Ori Mnemos | `github.com/aayoawoyemi/Ori-Mnemos` | `8afc915`, 2026-07-22, v0.6.0, Apache 2.0 |

Nicht erreichbar zum Abrufdatum: das im Mem2ActBench-Paper zugesagte Code- und
Datenrepository (`github.com/Cantaloupe-M/Mem2ActBench`, HTTP 404). Die im
Recherche-Briefing zitierte Mem0-Graph-Dokumentationsseite unter
`/open-source/features/graph-memory` existiert nicht mehr; die Funktion wurde
aus dem Open-Source-SDK entfernt, nicht nur die Seite verschoben.

### 29.3 Messungen und ihr Setup

| Messung | Fundstelle | Reader | Judge | Top-k | Kontextbudget |
|---|---|---|---|---|---|
| Hindsight 91,4 % LongMemEval / 89,6 % LoCoMo (Gemini-3); 83,6 / 83,2 (20B) | Demo, Tabelle 2, S. 280 | je Zeile verschieden; Gemini-3 Pro nur als finaler Antwortgenerator, Memory-Stack GPT-OSS-120b | in der Demo **nicht angegeben**; Vollfassung nennt GPT-OSS-120b, Temperatur 0,0, binär | **nicht angegeben** | **nicht angegeben**; Vollfassung enthält an dieser Stelle einen unausgefüllten Platzhalter |
| Hindsight Recall unter 200 ms bei 10.000 Units | Demo, §4.2, S. 279 | entfällt, Backbone-Aufruf ausdrücklich ausgeschlossen | entfällt | 20–50 Kandidaten vor dem Reranking | **nicht angegeben** |
| Zep LoCoMo 94,7 % / LongMemEval 90,2 % | `getzep.com/research`, Kennzahlenblöcke | gpt-5.4, Reasoning mittel | gpt-5.4 mit Chain-of-Thought — **Reader und Judge identisch** | 20 Edges, 10 Nodes, 10 Episoden, 5 Thread-Summaries, 5 Observations, danach Cross-Encoder | kein vorgegebenes Budget; gemessener Median 5.760 bzw. 4.408 Tokens |
| Mem0 LongMemEval 94,8 % | Benchmarks-README, Platform-Tabelle | **nicht angegeben**; CLI-Default gpt-4o | **nicht angegeben**; CLI-Default gpt-4o | Top 50 | **nicht angegeben** |
| Mem0 LoCoMo 92,5 % | Benchmarks-README, Platform-Tabelle | **nicht angegeben** | **nicht angegeben** | Top 200 | **nicht angegeben** |
| Mem0 BEAM 10M, Pass Rate 50,5 % | Benchmarks-README, BEAM-Tabelle | **nicht angegeben** | **nicht angegeben** | Top 200 | **nicht angegeben**; „10M“ ist die Konversationslänge, nicht das Kontextfenster |
| MAGMA LoCoMo 0,700 | Tabelle 1, S. 36854 | gpt-4o-mini, Temperatur 0,0, für alle Systeme | gpt-4o-mini, Temperatur 0,0, kontinuierliche Skala | Vektor-Top-k 20, RRF-k 60, max. Tiefe 5, max. 200 Knoten | kein konfiguriertes Budget; gemessen 3,37k Tokens/Query |
| MAGMA lexikalisch F1/BLEU-1 | Tabelle 9, Anhang F, S. 36864 | gpt-4o-mini | kein LLM-Judge, token-level F1 und BLEU-1 | wie Tabelle 1 | **nicht angegeben** |
| Mem2ActBench A-Mem 35,93 / LTMemory 35,32 | Tabelle 3, S. 8179 | Qwen2.5-7B/32B/72B-Instruct, Temperatur 0,0 | kein LLM-Judge; Argument-F1, BLEU-1, Tool Accuracy | **nicht angegeben** | **nicht angegeben** |
| Mem2ActBench Oracle 53,8 / bester passiver Retriever 30,7 | Tabelle 4, S. 8179 | **nicht angegeben** | kein LLM-Judge | Hybrid bei k=5 als bestes passives Ergebnis; Oracle ohne k | **nicht angegeben** |
| Graph-Gegenanalyse DescGraph gegen flach | Tabelle 4, S. 26763 | LLaMA-3.1-8B für Extraktion und Antwort | kein Judge, reine Retrieval-Metriken R@5/R@10 | Top-k der Initial Activation **nicht beziffert** | **nicht angegeben** |
| Graph-Gegenanalyse End-to-End | Tabellen 7 und 8, S. 26765 | zwei Konfigurationen: LLaMA-3.1-8B mit Contriever, sowie gpt-4o-mini für Extraktion und GPT-4o für Antwort | gpt-4o für LongMemEval, gpt-4o-mini für HaluMem | Top-5 bzw. Top-20 Werte im Antwortkontext | **nicht angegeben** |
| AgentRunbook-C 72,5 % / -R 57,8 % mit Latenzen | LongMemEval-V2, `arXiv:2605.12493` v1, Tabelle 2 | durchgängig Qwen3.5-9B; Controller Qwen3.5-9B bzw. GPT-5.4-mini | deterministische Evaluatoren plus GPT-5.2 für Gotchas und Abstention | **nicht angegeben** | 200k Tokens Truncation |
| T-Mem LoCoMo | §4.3 | GPT-4o-mini | GPT-4o-mini | Betriebspunkt (15, 5, 15, 10) | **nicht angegeben** |
| T-Mem LoCoMo-Plus | §4.3 | GPT-4o | Gemini-2.5-Flash — **anderes Paar als auf LoCoMo** | Betriebspunkt (15, 5, 15, 10) | **nicht angegeben** |
| All-Mem LoCoMo / LongMemEval-s | §4.3, Tabelle 2 | GPT-4o-mini, Temperatur 0 | GPT-4o | k=10 Anker, L=40 Expansion, K=16 final | kein Token-Cap; „matched budget“ ohne Zahl |
| Ori HotpotQA, n=50 | `bench/README.md` | **nicht angegeben** | **nicht angegeben** | k=5 implizit über R@5 | **nicht angegeben** |
| Ori LoCoMo, n=695 | `bench/README.md` | GPT-4.1-mini | **nicht angegeben** | **nicht angegeben** | **nicht angegeben** |
| BEAM Hauptmessung | §4, Tabelle 1, S. 8 | GPT-4.1-nano, Gemini-2.0-flash, Qwen2.5-32B-AWQ, Llama-4-Maverick-fp8 | Nugget-basierter LLM-Judge, **Modell nicht genannt** | RAG-Baseline Top 5; Ablation über 5/10/15/20 | 1M bei den proprietären Modellen, 128k bzw. 32k bei Qwen |

Von neunzehn geprüften Messungen nennen **drei** alle vier Konfigurationsgrößen.
Am häufigsten fehlt das Kontextbudget, am folgenreichsten der Judge. Das ist der
sachliche Grund für die Regel aus C-029, keine Fremdzahl als Gate zu verwenden:
Man könnte sie überwiegend gar nicht nachstellen.

### 29.4 Belegstellen der übernommenen Aussagen

| Aussage im Dokument | Quelle | Fundstelle | Urteil |
|---|---|---|---|
| Vier epistemische Netze mit Konfidenz auf Meinungen | Hindsight Demo | §3.1, S. 276–277 | bestätigt |
| Zwei Zeitmarken je Einheit: Ereignisintervall und Lernzeitpunkt | Hindsight Demo | §3.3, S. 277–278 | bestätigt; die Quelle verwendet das Wort „bi-temporal“ selbst nicht |
| Vier-Kanal-Recall mit RRF, Cross-Encoder und Tokenbudget | Hindsight Demo | §3.2, S. 277; §4.1, S. 278 | bestätigt |
| Observation-Konsolidierung mit Proof Count und Freshness-Trend | Hindsight Demo | §3.3, S. 278; Anhang D, S. 285 | bestätigt |
| Reproduktion durch Institutionen, die Co-Autoren stellen | Hindsight Demo | Acknowledgements, S. 282; Affiliationen S. 275 | bestätigt |
| Bi-temporales Modell mit vier Kantenzeitmarken | Zep/Graphiti | §2.1, S. 2; §2.2.3, S. 3 | bestätigt; Namen `t'_created`, `t'_expired`, `t_valid`, `t_invalid` |
| Invalidierung statt Löschung | Zep/Graphiti + README | §2.2.3, S. 3; README „Temporal Fact Management“ | bestätigt |
| Vier orthogonale Sichten mit Intent-Router | MAGMA | §3.2, S. 36851; §3.3, S. 36851 | bestätigt |
| Hyperparameter auf dem Berichtsbenchmark optimiert | MAGMA | Anhang B.1, S. 36860 | bestätigt |
| Lexikalisch führt nicht MAGMA | MAGMA | Tabelle 9, Anhang F, S. 36864 | bestätigt |
| Ungeeignete Graphkonstruktion verschlechtert Ergebnisse | Graph-Gegenanalyse | §5, S. 26766 | bestätigt |
| Gut konstruierte Entity-Beschreibungen schlagen flache Indizes | Graph-Gegenanalyse | §4.4, Tabelle 4, S. 26763 | bestätigt |
| Befunde generalisieren nicht auf Nicht-Dialog-Aufgaben | Graph-Gegenanalyse | Limitations, S. 26766 | bestätigt |
| Retrieval ist der dominante Engpass | Mem2ActBench | §5.1, S. 8178 | bestätigt |
| Anwendung bleibt auch bei perfektem Retrieval ein Problem | Mem2ActBench | Abstract S. 8173; §5.2, §5.4, §5.5, S. 8178–8180 | bestätigt |
| Zwei Achsen, vier Triggerfamilien, Write-Time-Erzeugung | T-Mem | Figure 1, §1; §3.2.3; §3.1 | bestätigt |
| Trigger bleiben vom Evidenzpfad getrennt | T-Mem | §3.1 | bestätigt |
| Begrenzte sichtbare Oberfläche mit hop-begrenzter Expansion | All-Mem | §3.1, §3.2 | bestätigt |
| Split/Merge/Update erhalten unveränderliche Evidenz | All-Mem | §3.3 | bestätigt |
| Strukturierter Mehrpool-Ansatz gegen agentische Suche | LongMemEval-V2 | Tabelle 2 | bestätigt: 58,6 % bei 26,9 s und 57,0 % bei 25,8 s für die RAG-Variante; 74,9 % bei 108,3 s und 70,1 % bei 139,9 s für die agentische |
| Gravity- und Hub-Dämpfung | Ori Mnemos | README, Abschnitt Retrieval Intelligence | bestätigt; Gravity halbiert bei null Query-Term-Overlap, Hub bestraft ab P90-Grad |
| Exposure-Behandlung ist eine Normalisierung | Ori Mnemos | `RETRIEVAL_INTELLIGENCE_SPEC.md`, Abschnitt Exposure-aware correction | bestätigt: Division durch die Exposure-Zahl hoch 0,5 — keine Propensity-Korrektur |
| Rekursive Exploration mit Abbruchkriterium | Ori Mnemos | `docs/recursive-explore.md` | **korrigiert**: ein Kriterium ist dokumentiert, mit Tiefenlimit 2 und Notizlimit 30 |
| BEAM misst zehn Fähigkeiten bis zehn Millionen Token | BEAM | §2.2; Tabelle 1, S. 8 | bestätigt; 100 Konversationen, 2.000 Fragen |

### 29.5 Berichtigte Fehlzitate

Die folgenden Aussagen standen so in der Vorgängerrevision beziehungsweise im
zugrunde liegenden Recherche-Briefing und sind falsch. Sie sind in dieser
Fassung korrigiert:

1. **BEAM-Teilwerte als Prozentzahlen.** 0,163, 0,325 und 0,400 sind
   Durchschnittswerte auf einer Skala von 0 bis 1, keine Prozentwerte. Die
   zugehörigen Pass Rates lauten 20 %, 25 % und 40 %. Die Formulierung „16,3 %
   Temporal Reasoning“ war eine Fehllesart.
2. **Vermischte Retrieval-Tiefen.** 94,8 % auf LongMemEval ist ein
   Top-50-Wert, 92,5 % auf LoCoMo ein Top-200-Wert. Nebeneinandergestellt
   suggerieren sie eine Vergleichbarkeit, die nicht besteht.
3. **Ori ohne Konvergenzkriterium.** Die Vorgängerrevision hielt fest, ein
   Abbruchkriterium der rekursiven Exploration sei nicht auffindbar. Es ist
   dokumentiert, nur nicht in README oder Spezifikation, sondern in
   `docs/recursive-explore.md`. Die Vorprüfung hatte diese Datei nicht gelesen.
4. **„Multi-Session Reasoning“ als BEAM-Fähigkeit.** Der Benchmark führt zehn
   Fähigkeiten; diese ist nicht darunter. Die inhaltlich nächste heißt
   „Multi-Hop Reasoning“. Die Bezeichnung stammt aus dem Ergebnis-README des
   messenden Anbieters.
5. **Mem0-Paper als Beleg für die aktuellen Zahlen.** Das Paper von 2025 deckt
   nur die ältere LoCoMo-Evaluation ab. Wer 94,8 % oder 92,5 % damit belegt,
   zitiert falsch.

Punkt 1 und 3 sind eigene Fehler dieser Dokumentlinie, nicht des Briefings.
Beide wären mit den Anforderungen aus 29.1 nicht entstanden — was die
Begründung für C-040 liefert.

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

- die **Persistenz** beschreibender Item- und Szenen-Cues als eigene Felder,
  solange die Ablation aus 18.3 ihren eigenen Beitrag nicht belegt und der
  gesonderte Repräsentationsentscheid nach 11.2 nicht gefallen ist. Die
  Vermutung, dass Titel, Tags, `topic_path` und Summary diese Achse bereits
  abdecken, ist der Grund für die Zurückstellung — nicht für einen Verzicht auf
  die Prüfung. Die beschreibende Achse bleibt vollwertiger Faktor des
  2×2-Designs;
- multimodale Episoden und Bildschirmerfahrung;
- ein Multi-Agenten-Konsolidierungsapparat;
- vollständige Läufe großskaliger Trajektorien-Benchmarks;
- HNSW, unverändert gegenüber C-007 und M5;
- ein lernender Stufen-Controller, der Pipeline-Schritte überspringt oder
  aussetzt, vor Erreichen des Mindest-N.

## 31. Offene Entscheidungen für den Product Owner

**Status: keine dieser vier Entscheidungen ist getroffen.** Sie sind hier als
Entscheidungsvorlage aufbereitet und werden von Product Owner und Codex
gemeinsam entschieden. Bis dahin bindet nichts davon die Umsetzung; keine der
Optionen ist an anderer Stelle im Dokument bereits vorausgesetzt.

### Entscheidung 1 – Wer erzeugt abgeleitete Cues?

**Empfehlung:** Erzeugung durch den ohnehin schreibenden Agenten beim Save.

**Alternativen:** (a) reproduzierbarer Offline-Batch mit einem lokalen Modell
über den bestehenden Bestand; (b) beides — Agent beim Save für Neuzugänge, Batch
einmalig für den Altbestand.

**Begründung der Empfehlung:** Ein Bridge- oder Horizon-Cue beantwortet „in
welcher künftigen Situation wäre das wichtig?“. Diese Information liegt beim
Save vor und nirgends sonst; ein Batch über den fertigen Text kann sie nur
raten.

**Auswirkungen:** Die Agentenvariante liefert kontextreichere Cues, ist aber pro
Save unterschiedlich und damit schlechter versionierbar — was der Ablation in
18.3 die saubere Vergleichbarkeit nimmt. Der Batch ist reproduzierbar und
hashbar und passt besser zu M0, kennt aber nur den Text. Variante (b) löst den
Konflikt, verdoppelt aber die Generatorpfade und damit die Provenienzfälle.
Betroffen ist ausschließlich die Sidecar-Erzeugung, nicht das Vault-Schema.
Privacy unverändert, da lokal. Release-Wirkung: keine, die Schicht liegt hinter
M2.

**Offene Vorfrage:** Wenn die Ablation in 18.3 zeigt, dass nur die assoziative
Achse trägt, verkleinert sich der Batch-Nachteil erheblich — die Entscheidung
kann deshalb auch bewusst bis nach der Ablation vertagt werden.

### Entscheidung 2 – Wird ein externer Standardbenchmark adaptiert?

**Empfehlung:** genau ein Adapter in V1.x.

**Alternativen:** (a) Verzicht zugunsten des lokalen Goldsets; (b) mehrere
Adapter für breitere Vergleichbarkeit.

**Begründung der Empfehlung:** Ein Adapter schließt die in 2.3 benannte
Beweislücke im Grundsatz, ohne den Pflegeaufwand zu vervielfachen.

**Auswirkungen:** Ohne Adapter bleibt dauerhaft unbelegbar, wie Bastra gegenüber
Fremdsystemen steht — was für ein lokal-first-Produkt vertretbar, für die
öffentliche Kommunikation aber eine Lücke ist. Mit Adapter entsteht laufender
Pflegeaufwand für Harness-, Modell- und Judge-Versionen, und jeder externe Lauf
muss die Metadatenpflicht aus C-040 erfüllen. Release-Wirkung: keine, da 19.1
den Adapter ausdrücklich außerhalb des V1.0-Vertrags hält. Privacy: externe
Benchmarks laufen auf Fremddaten, berühren den Vault also nicht.

**Zusatzfrage bei Zustimmung:** welcher — ein konversationsorientierter
Benchmark misst andere Fähigkeiten als ein handlungsorientierter. Für Bastras
Produktscope ist der handlungsorientierte näher an der Realität, hat aber die
kleinere Vergleichsbasis.

### Entscheidung 3 – Wird Deep Recall Stufe 2 gebaut?

**Empfehlung:** Entscheidung bis nach der Messung von Stufe 1 gegen den
`k`-Kontrollarm vertagen.

**Alternativen:** (a) sofortiger Bau beider Stufen; (b) dauerhafter Verzicht auf
Stufe 2.

**Begründung der Empfehlung:** Die Fremdmessung legt einen erheblichen
Kostensprung für die Agentenschleife nahe, dessen Nutzen für einen Vault dieser
Größe unbelegt ist. Stufe 1 ist deutlich billiger und könnte das
Deep-Recall-Versprechen aus Abschnitt 8 bereits einlösen.

**Auswirkungen:** Vertagen kostet nichts, weil Stufe 1 unabhängig nutzbar ist.
Sofortiger Bau bindet Aufwand, den M3 möglicherweise nicht rechtfertigt, und
erzeugt mit den Budgetgrenzen aus 8.5 zusätzliche Konfigurationsfläche.
Dauerhafter Verzicht schließt den in 8.5 belegten Qualitätsabstand aus, der in
der Fremdmessung immerhin rund sechzehn Prozentpunkte betrug. Release-Wirkung:
keine. Rückwärtskompatibilität: unberührt, da eigener Modus.

### Entscheidung 4 – Wann fällt der Schemaentscheid für Zeit und Herkunft?

**Empfehlung:** ein gemeinsamer Entscheid für beide Feldgruppen nach
M4-Vorbereitung.

**Alternativen:** (a) getrennt, zuerst die Zeitachsen; (b) getrennt, zuerst die
Provenienz.

**Begründung der Empfehlung:** Beide Feldgruppen haben dieselben Konsumenten —
Konsolidierung, Rekonsolidierung, Deep Recall — und ein zweiter
Migrationsschritt wäre teurer als ein gemeinsamer.

**Auswirkungen:** Gemeinsam bedeutet später, aber nur eine Migration. Variante
(b) hätte ein eigenes Argument: Die Provenienz-Fallback-Regel aus C-042 ist eine
Korrektheitsfrage, die Zeitachsen sind eine Ausdrucksfrage. Wenn abgeleitete
Inhalte früher entstehen als das Zeitmodell gebraucht wird, wäre die
Vorwegnahme der Provenienz die sicherere Reihenfolge. In allen Varianten sind
die Felder rein additiv, und die Rückwärtskompatibilität nach 22 bleibt
gewahrt. Das heutige `valid_until` wird in keiner Variante angefasst — siehe
C-041.

## 32. Übergabe an den finalen Codex-Delta-Review

**Was geändert wurde.** Diese Fassung ist ein reiner Delta-Fix und fügt der
Vorgängerrevision die Deltas C-049–C-054 hinzu. Geändert wurden ausschließlich:
das Provenienz-Mapping samt Review-Status in 6.3; der Widerspruchsablauf, die
`valid_to`-Abgrenzung und die fünf Zustände in 6.3 Zeitachsen; Punkt 8 in 8.4;
der Abbruch- und Oberflächenvertrag samt Trennung harter und weicher Grenzen in
8.5; die Stufenabhängigkeit in 11.4; das Signal zur Quellen-Confidence in 10.2;
der Schlussabsatz zur Hop-Kennzeichnung in 13.1; die Erhaltungsregel und der
`SUPERSEDE`-Abschnitt in 14.4; der Cue-Abschnitt in 18.3; Gate-Zeilen in 18.2,
18.4 und 18.5; die Importklasse in 22; die Verbotszeilen in 24; die
Zurückstellung in 30; die Ledgerzeilen und Delta-Einträge zu C-030, C-034,
C-037, C-038, C-042 und C-047 als Korrekturverweise; die AgentRunbook-Zeile in
29.3; dieser Abschnitt; und die Angabe der nächsten freien ID. Alle übrigen
Passagen sind unangetastet.

**Selbstprüfung vor Übergabe.** Die Fassung wurde nach dem Delta-Fix gegen die
sechs Forderungen und gegen den unveränderten Rest des Dokuments gegengeprüft.
Von 38 Teilforderungen waren 36 unmittelbar erfüllt; die beiden übrigen sowie
17 Konsistenzbefunde gegen Bestandspassagen sind in dieser Fassung bereits
behoben. Die drei schwersten waren: die Gate-Zeile in 18.5, die weiterhin eine
zeitliche Invalidierung durch den Widerspruch selbst forderte; die automatisch
erzeugte `contradicts`-Kante, die die Freigabepflicht aus 13 und 14.4 umgangen
hätte; und die Budgetgrenzen-Tabelle, deren vier weiche Grenzen der
Lauf-Abbruchbedingung widersprachen und darüber genau den `no_answer`-Fehlausweis
wieder ermöglicht hätten, den C-052 verhindern soll. Alle Korrekturen liegen
innerhalb der sechs Delta-Punkte; es wurde keine neue C-ID vergeben.

**Was gegenüber der Vorgängerrevision sachlich falsch war.** Drei Punkte:

1. Das Provenienz-Mapping (C-049). `write_origin: user-directed → user_asserted`
   greift zu früh, weil der Import jeden Inhalt so stempelt — einschließlich
   eines maschinell erzeugten Navigations-Index. Die Importprüfung hat jetzt
   Vorrang; nur ein nicht importierter, belegbar nutzergesteuerter Save wird
   automatisch `user_asserted`.
2. Die `confidence`-Aussage (C-049). Das Feld wird beim Indexieren gelesen und
   als `storeField` im Suchindex gehalten. Richtig ist: Es wird zwar als
   Metadatum indexiert, beeinflusst aber weder Ranking noch Filterung noch den
   Evidenzentscheid und eignet sich deshalb nicht als Herkunftssignal.
3. Der Deep-Recall-Abbruch (C-052). Ausbleibender Evidenzgewinn beendete den
   gesamten Lauf und wurde als `no_answer` ausgegeben. Er schließt jetzt nur
   den Ast; `no_answer` setzt die deterministische Erschöpfung aller Teilfragen
   und zulässigen Äste voraus.

**Welche Ist-Claims betroffen sind.** Von den sechs Ist-Claims der
Vorgängerrevision ist einer korrigiert und einer ergänzt:

- korrigiert: `confidence` wird beim Indexieren gelesen und im Suchindex
  gehalten (`packages/core/src/search.ts:106`, `:175`, `:724`), wirkt dort aber
  nicht;
- ergänzt: Der Vault-Import setzt `write_origin: "user-directed"` — für jeden
  importierten Inhalt (`packages/daemon/src/import/adapters.ts:153`) und auch
  für einen maschinell erzeugten Navigations-Index
  (`packages/daemon/src/import-vault.ts:369`).

Die übrigen vier Ist-Claims — `valid_until` als reiner Score-Multiplikator, das
Fehlen von Ereignis- und Weltgültigkeitsfeldern, die `write_origin`-Kaskade auf
`agent-session` sowie der erzwungene `related_via`-Hop im Hook-Pfad mit
weggeschnittener Hop-Kennzeichnung — bleiben unverändert gültig.

**Was besonders zu prüfen ist.**

1. Ob die Stufe-1-Erkennung in 6.3 vollständig ist. Geprüft werden
   Adapter-Präfix, `index:`-Präfix, `topic_path` und Tag — gibt es weitere
   maschinelle Schreibpfade, die `user-directed` setzen? Bekannt sind
   zusätzlich zwei Stellen im Onboarding.
2. Ob `provenance_review` mit `not_required` für Stufe-2-Ergebnisse richtig
   belegt ist oder ob auch `user_asserted` aus Stufe 2 eine Bestätigung
   braucht.
3. Ob die Zustandsabgrenzung in 6.3 vollständig ist — insbesondere, ob
   `stale_status` als reine UI-Projektion einen sechsten Zustand darstellt.
4. Ob das 2×2-Design in 18.3 mit den vorhandenen Goldfallzahlen statistisch
   auswertbar ist, oder ob die Interaktion Mindest-N sprengt.
5. Ob die Trennung harter und weicher Grenzen in 8.5 vollständig ist und ob
   `limit: "other"` mit Pflichtbegründung als Auffangwert genügt.
6. Ob die Blockade einer Klasse-A-Operation nach 14.4 einen
   Konsolidierungslauf dauerhaft verklemmen kann, wenn jede zulässige Operation
   die Invariante verletzt.
7. Ob die sekundäre Sichtbarkeitswirkung von `SUPERSEDE` in 14.4 mit dem
   `obsolete`-Mechanismus kollidiert, der laut 6.3 ein getrennter Zustand ist.

**Aus der Vorrunde offen geblieben.** Der Delta-Review hat einen Prüfpunkt der
Vorgängerübergabe nicht adressiert; er bleibt offen: Ob 18.6.1 ohne M4 genug
messbare Kategorien behält, um aussagekräftig zu sein — es bleiben vier von
sieben.

**Nebenbefund ohne eigene C-ID, unverändert offen.** Die Daemon-README
beschreibt abgelaufene Memories als „(or excluded if expired)“. Der Code
schließt sie nicht aus, sondern dämpft sie auf 20 %. Das betrifft nicht dieses
Dokument, sollte aber in der README korrigiert werden.

**Was die Änderung trägt.** Für die beiden Ist-Korrekturen der Code am HEAD mit
den in C-049 genannten fünf Fundstellen; für die Vertragsänderungen die
bestehenden Messgates M0 bis M6, deren Freigabelogik unverändert bleibt; für die
Konsistenzbereinigungen das Dokument selbst.

**Weiterhin offen.** Die vier Product-Owner-Entscheidungen in Abschnitt 31 sind
unverändert und werden von dieser Fassung nicht vorweggenommen. Keine Passage
setzt eine ihrer Optionen voraus.

**Nächste freie ID: C-055.**
