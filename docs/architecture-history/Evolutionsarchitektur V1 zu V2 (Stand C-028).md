# Bastra Recall – Evolutionsarchitektur V1 → V2

> Status: Release- und Zielarchitektur; V1.0 ist der nächste verbindliche
> Releasevertrag, V2.0 das langfristige, messungsabhängige Zielbild
>
> Stand: 24. Juli 2026
>
> Ausgangsstand: Bastra Recall 0.8.6, aktueller Vault, reale
> 30-Tage-Telemetrie und bestehende Eval-Geometrie

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

**Abnahmestand 24.07.2026:** Vollabgleich Ledger C-001–C-027,
Gate-Messbarkeit, Ist-Behauptungs-Sweep (58 Aussagen, alle gedeckt),
Implementierer-Review. Künftige Gegenprüfungen betreffen ausschließlich
Änderungs-Deltas gegen diesen Stand.

**Finale Architekturabnahme 24.07.2026:** C-028 ist im finalen Delta-Review
bestätigt; es bestehen keine substanziellen offenen Deltas. Die abgenommene
Basis C-001–C-027 bleibt unverändert. Nächste freie ID: C-029.

Neue Delta-Reviews beginnen mit C-029. Ein Urteil ändert sich nur mit neuer
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
- Typed Graph Evidence nach eingeführtem und evaluiertem Kantenschema.

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
  Dritt-Reproduzierbarkeit wird zugunsten der Vault-Privacy akzeptiert.

Gate:

- kein stiller Arm-Fallback;
- keine unbekannten Gold-IDs;
- reproduzierbarer Report;
- Label-Shuffle-Null und Kontrollarm vorhanden.

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
- Load-/Use-Rate getrennt nach Hook-Formulierung, Client und Hook-Quelle.

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
- Falsch-Abstention bleibt unter der in M0 festgelegten Toleranz.

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
- adaptive Kaskade plus bedingter lokaler Reranker.

Metriken:

- p50/p95/p99;
- Provider-Aufrufe pro Recall;
- Query-Cache-Hitrate;
- Energie-/Modellresidenz;
- Recallqualität pro Query-Klasse;
- Timeout- und Degraded-Rate.

Live-Gates:

- PreTool p95 < 150 ms;
- SessionStart p95 < 300 ms;
- BM25-eindeutige Queries lösen keinen unnötigen Provider-Aufruf aus;
- semantische Query-Klassen verlieren nicht mehr als die definierte Toleranz.

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
- bewusste Deep-Recall-Query.

Metriken:

- korrekte Zonenklassifikation;
- spontane False-Injection-Rate aus dem Gürtel;
- Deep-Recall@k für dormante Golds;
- Erklärbarkeit der Zonenentscheidung;
- Reaktivierungsrate nach erfolgreichem Deep Recall;
- Survival-by-ID und Zitierbarkeit.

Live-Gates:

- Floors sinken nie automatisch in Deep-only;
- Historical wird nie als aktuelle Regel ausgegeben;
- exakte IDs bleiben erreichbar;
- Deep Recall findet definierte dormante Golds;
- Normal Recall injiziert keine Belt-Memories ohne außergewöhnlich starke,
  explizit messbare Evidenz.

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
- Retrievalqualität vor und nach Konsolidierung.

Schema-/Live-Gates:

- keine autonome Regeländerung;
- jede Lesson verweist auf ihre Episoden oder Quelle;
- Widersprüche werden angezeigt, nicht still überschrieben;
- Episode bleibt nach Konsolidierung erhalten.

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

Live-Gates:

- Recall@10 gegenüber Flat ≥ 98 %;
- keine Sensitivity- oder Scope-Leaks;
- p95 tatsächlich besser;
- atomarer, wiederholbarer Switch;
- Flat-Fallback jederzeit funktionsfähig.

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
- reproduzierbarer Rollback.

Live-Freigabe nur nach bestandenem M6, nachgewiesenem inkrementellem Lift über
den deterministischen Evidenzentscheid, erklärbarem Verhalten und
reproduzierbarem Rollback.

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
- Query-Typen aus realer Hook-Telemetrie.

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

## 24. Was ausdrücklich nicht zuerst gebaut wird

- kein größeres Embedding-Modell als Antwort auf falsche Required-Hits;
- keine tieferen untypisierten Graph-Hops;
- keine aggressive automatische Triggervermehrung;
- kein aggressiveres automatisches Speichern;
- kein autonomes Umschreiben von Nutzerwissen;
- keine HNSW-Live-Schaltung ohne Flat-Vergleich;
- keine Salience-Live-Gewichtung ohne ausreichende Shadow-Evidenz;
- kein Learned Ranker auf einem fehlerhaften oder driftenden Kandidatenpool.

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
7. Deep Recall live nach bestandenem M3.
8. Cue-/Content-Vektoren und Chunking persistent oder live erst nach
   gesondertem Repräsentationsentscheid gemäß 11.2; M2 allein genügt nicht.
9. Episodic Memory und strukturierte Claims persistent erst nach gesondertem
   Schemaentscheid, live nach bestandenem M4.
10. Typed Graph, Versionen und Rekonsolidierung persistent erst nach
    gesondertem Schemaentscheid gemäß 21.4, live nach bestandenem M4.
11. Kontrollierte Konsolidierung live nach bestandenem M4.
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
