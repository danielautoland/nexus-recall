# Bastra Recall – Recherche- und Integrationsbriefing für die nächste V2-Fassung

> Adressat: Claude, zur vollständigen Analyse und kontrollierten Überarbeitung
> der bestehenden Evolutionsarchitektur
>
> Stand der Recherche: 24. Juli 2026
>
> Verbindliche Ausgangsbasis:
> `docs/Evolutionsarchitektur V1 zu V2.md`
>
> Englische Schwesterfassung:
> `docs/Evolution Architecture V1 to V2.md`
>
> Status dieses Dokuments: Forschungs- und Änderungsbriefing, noch kein
> freigegebener Architekturvertrag

## 0. Auftrag an Claude

Dieses Dokument enthält die Ergebnisse einer aktuellen Netz- und
Forschungsanalyse zu Agent-Memory-Systemen, die Bastra Recall ähneln, einzelne
Teile davon bereits umgesetzt haben oder in bestimmten Disziplinen nachweislich
weiter sind.

Dein Auftrag ist:

1. jede hier aufgeführte Behauptung und Quelle selbst gegenzuprüfen;
2. sauber zwischen produktiv implementierter Funktion, wissenschaftlichem
   Prototyp, Anbieterbehauptung und belastbarer Vergleichsevidenz zu
   unterscheiden;
3. jede Erkenntnis einer der folgenden Klassen zuzuordnen:
   - bestätigt bereits die vorhandene V2-Richtung;
   - präzisiert einen vorhandenen V2-Baustein;
   - ist eine sinnvolle neue V2-Erweiterung;
   - gehört nur in eine spätere Forschungsstufe;
   - ist abzulehnen;
4. die sinnvollen und belegbaren Erkenntnisse als nachvollziehbare Deltas in
   `docs/Evolutionsarchitektur V1 zu V2.md` zu übernehmen;
5. die englische Schwesterfassung erst nach der deutschen fachlichen Abnahme
   wieder synchron nachzuführen;
6. eine Delta-Liste mit Passage, Begründung, Quelle, Gate, Datenquelle,
   Abnahmekriterium und gegebenenfalls Rollback zu liefern;
7. keine bestehende Abnahme historisch umzudeuten.

Der abgenommene Stand C-001–C-028 bleibt die unveränderte Basis. Neue
Gegenreview-Punkte beginnen bei C-029. Eine neue C-ID soll nur entstehen, wenn
aus der Recherche tatsächlich eine verbindliche Architekturentscheidung, eine
Korrektur oder ein messrelevanter Vertragspunkt folgt. Nicht jede interessante
Idee braucht automatisch eine Ledger-ID.

### 0.1 Erwartetes Ergebnis deiner Bearbeitung

Erwartet wird keine unkritische Übernahme aller Ideen, sondern:

- eine Quellen- und Behauptungsmatrix;
- ein begründetes Urteil zu jeder vorgeschlagenen Verbesserung;
- eine überarbeitete deutsche Evolutionsarchitektur;
- ein präzises Delta gegenüber dem abgenommenen Stand;
- neue beziehungsweise erweiterte Messgates;
- klare Kennzeichnung dessen, was V1.0, V1.x, V2.0 oder spätere Forschung ist;
- eine Liste ausdrücklich verworfener oder zurückgestellter Ansätze;
- ein Übergabevermerk für den anschließenden Codex-Gegenreview.

### 0.2 Unverhandelbare Leitplanken

Bei der Überarbeitung müssen folgende Eigenschaften erhalten bleiben:

- Markdown/YAML bleibt Source of Truth.
- Nutzerwissen bleibt menschenlesbar, portabel und manuell bearbeitbar.
- Bestehende IDs, Memory-Typen und `recall_when` bleiben kompatibel.
- Neue abgeleitete Strukturen beginnen als Sidecar, Shadow-Modell oder
  read-only Projektion, solange ihr Schema-/Vertragsgate nicht bestanden ist.
- Normal Recall bleibt schnell, selektiv und hook-tauglich.
- Deep Recall darf langsamer sein, wird aber bewusst ausgelöst und blockiert
  keine normalen Hooks.
- `no_answer` bleibt ein regulärer und gewünschter Systemzustand.
- Rang, Ähnlichkeit, Salience, Zugriffshäufigkeit und emotionale Gewichtung
  dürfen nie allein als Wahrheit oder Relevanzwahrscheinlichkeit ausgegeben
  werden.
- Kein Live-Lernen aus dem heutigen `acted_on`-Token-Overlap-Proxy.
- Keine autonome inhaltliche Umschreibung oder Löschung von Nutzerwissen.
- Jede Konsolidierung behält Evidenz, Versionen und Rückverfolgbarkeit.
- Reflex-Aktivierung bleibt bewusst kontrolliert und darf fehlende
  Query-Relevanz nicht durch emotionale Stärke ersetzen.
- HNSW, Cross-Encoder, LLM-Reranker und Graph-Hops werden nur dort live
  eingesetzt, wo Nutzen, Latenz und Qualität gemessen sind.
- Privacy, Sensitivity, Scope und Berechtigungen gelten auch für Graph,
  Deep Recall, Manifeste und abgeleitete Cues.

## 1. Kurzurteil der Recherche

Es existiert derzeit kein gefundenes System, das die gesamte Bastra-Zielidee
nachweisbar übertrifft.

Es gibt jedoch Systeme, die Bastra Recall in einzelnen Disziplinen aktuell
übertreffen:

- Hindsight bei strukturierter zeitlicher Erinnerung, Mehrkanal-Retrieval,
  Fakten-/Meinungs-Trennung und evidenzhaltiger Konsolidierung;
- Zep/Graphiti bei bi-temporaler Wahrheit, Faktinvalidierung, Skalierung und
  produktivem Temporal Graph Retrieval;
- Ori Mnemos bei bereits implementierter kognitiver Retrievalsteuerung,
  Graph-Aktivierung, lernender Utility-Schätzung und rekursiver Tiefensuche;
- Mem0 bei Integrationsbreite, öffentlicher Benchmarkfähigkeit und
  Plattformreife;
- T-Mem bei explizit typisierten, zukunftsorientierten Abruf-Cues;
- All-Mem bei nichtdestruktiver Topologieentwicklung über sichtbare und
  archivierte Memory-Bereiche;
- MAGMA bei logisch getrennten semantischen, zeitlichen, kausalen und
  Entity-Beziehungsräumen;
- AgentRunbook-C bei absichtlicher, mehrstufiger Navigation durch große,
  dateibasierte Erfahrungsspeicher.

Der zentrale Befund lautet:

> Bastras Richtung ist nicht widerlegt. Mehrere unabhängige Systeme und
> Forschungsarbeiten bestätigen wesentliche Teile davon. Die V2-Architektur
> kann aber bei Cue-Typisierung, Zeitmodell, epistemischer Trennung,
> agentischem Deep Recall, Graph-Sichten, nichtdestruktiver Konsolidierung und
> Evaluation deutlich präziser werden.

## 2. Vergleichsgrundlage: Was Bastra heute ist und was erst Zielbild ist

Jeder Vergleich muss aktuellen Stand und Zielarchitektur auseinanderhalten.

### 2.1 Aktuell produktiv beziehungsweise codegedeckt

Bastra Recall 0.8.6 besitzt:

- einen lokalen Markdown/YAML-Vault als Source of Truth;
- BM25 mit besonders stark gewichtetem `recall_when`;
- optionale Embeddings;
- RRF-Fusion aus lexikalischen und semantischen Treffern;
- stabile Memory-IDs, Scope, Sensitivity, Soft Delete und manuelle
  Bearbeitbarkeit;
- Staleness, Floors und Curator;
- Salience, die bereits die Staleness-Lebensdauer beeinflusst;
- eine kontrollierte Reflex-Lane;
- lokale Telemetrie für `surfaced`, `loaded` und den
  Token-Overlap-Proxy `acted_on`;
- sieben ruhige Claude-Code-Hooks, die nicht nur auf explizite Suche warten,
  sondern unter anderem vor Edits, Plänen und nach Fehlern erinnern;
- Claude-Desktop-Autonomie über MCP und Session-Kontext;
- BM25-Fallback, wenn Embeddings fehlen oder ausfallen.

Zum Messzeitpunkt umfasste der Vault 577 Memories. Die dokumentierte
BM25-Stufe lag in der 30-Tage-Telemetrie bei p50 1 ms, p95 11 ms und p99
25 ms. Diese Zahlen beschreiben nicht automatisch die gesamte Hook- oder
MCP-Latenz.

### 2.2 Noch nicht produktiv bewiesen

Die abgenommene Evolutionsarchitektur beschreibt als gegatetes Ziel:

- echte deterministische Relevanzevidenz und Abstention;
- projektfähigen gemeinsamen Session-Assembler;
- globales Kontext- und Latenzbudget;
- Working, Episodic, Semantic und Reflex Memory;
- ein einheitliches Accessibility-Modell;
- Asteroidengürtel und Deep Recall;
- adaptive Auswahl von BM25, Vector, HNSW und Deep Recall;
- getrennte Cue- und Content-Repräsentationen;
- Claims, Evidenz und Typed Graph;
- kontrollierte Konsolidierung und Rekonsolidierung;
- Flat/HNSW-Automation;
- gelerntes Ranking erst nach Shadow-Evidenz;
- M0–M6 als messbare Freigabekette.

Diese Zielbausteine dürfen beim Vergleich nicht als bereits ausgelieferte
Bastra-Funktionen dargestellt werden.

### 2.3 Aktuelle größte Beweislücke

Bastra besitzt noch keinen extern vergleichbaren Standardlauf auf LoCoMo,
LongMemEval, BEAM, LoCoMo-Plus, Mem2ActBench oder LongMemEval-V2.

Das bedeutet:

- Es ist nicht belegbar, dass ein Fremdsystem Bastra insgesamt übertrifft.
- Es ist ebenso wenig belegbar, dass Bastra diese Systeme bei allgemeiner
  Retrievalqualität übertrifft.
- Produktivtelemetrie und Standardbenchmarks beantworten unterschiedliche
  Fragen.
- Bastras lokaler Realbetrieb ist ein Vorteil, ersetzt aber keinen
  vergleichbaren Goldset- oder Standardbenchmark.

## 3. Vergleichsmatrix

| System/Arbeit | Besonders stark | Schwäche beziehungsweise Beweisgrenze | Relevanz für Bastra |
|---|---|---|---|
| Hindsight | vier epistemische Netze, Temporal Retrieval, Graph, BM25, Dense, Cross-Encoder, Reflect | LLM-Extraktionsfehler, englische Benchmarks, Meinungsevolution ohne Benutzerstudie | sehr hoch |
| Zep/Graphiti | bi-temporale Fakten, Invalidierung, Quellenpfad, Skalierung | aktuelle Spitzenwerte sind Anbieterläufe; Managed Engine teils proprietär | sehr hoch |
| Ori Mnemos | lokales Markdown, ACT-R-artige Aktivierung, PageRank, Utility Learning, rekursive Exploration | Eigenbenchmarks, kleine HotpotQA-Stichprobe, uneinheitliche Vergleichsmetriken | sehr hoch |
| Mem0 | Plattformreife, Integrationen, Benchmark-Suite, Multi-Tenant-Betrieb | starke Einbrüche bei 10M-Token-BEAM; Anbieterbenchmarks | hoch |
| T-Mem | beschreibende und assoziative Trigger auf Item-/Scene-Ebene | Paper-Stand, Code laut Paper erst nach Annahme, Offline-Konstruktion | sehr hoch |
| All-Mem | sichtbare Oberfläche, Archiv, SPLIT/MERGE/UPDATE, unveränderliche Evidenz | Forschungsprototyp und LLM-gestützte Offline-Diagnose | sehr hoch |
| MAGMA | semantische, zeitliche, kausale und Entity-Graph-Sichten; Intent-Router | höhere Komplexität, LLM-abhängige Kanten, Benchmarktuning | hoch |
| AgentRunbook-C | agentische Dateinavigation, Manifeste, Hilfsskripte, Evidenzsammlung | 108–140 Sekunden pro Query; kein Normal-Recall-Pfad | sehr hoch für Deep Recall |
| Mem2ActBench | misst Erinnerungsanwendung in Tool Calls | Benchmark, kein fertiges Memory-System | sehr hoch für Evaluation |
| Basic Memory | Markdown, MCP, Knowledge Graph, Schema-Inferenz und -Validierung | weniger proaktive Aufmerksamkeit und kognitive Gewichtung | mittel bis hoch |
| Letta | explizite Kontext-Hierarchie und immer sichtbare Memory Blocks | Datenbank-/Agent-Runtime statt nutzereigenem Markdown; autonome Block-Änderungen | mittel |
| MIRIX | sechs Memory-Arten, Multimodalität, Bildschirm-Erfahrung | hohe Agent-/LLM-Komplexität, anderer Produktscope | optional/später |

## 4. Hindsight

### 4.1 Belegte Architektur

Hindsight organisiert Memory in vier logischen Netzen:

1. **World Network** – objektive Fakten über die Außenwelt;
2. **Experience Network** – eigene Handlungen und Erfahrungen des Agenten;
3. **Observation Network** – abgeleitete, möglichst präferenzneutrale
   Entity-Zusammenfassungen;
4. **Opinion Network** – subjektive Überzeugungen mit veränderlicher
   Konfidenz.

Der Recall läuft über vier parallele Kanäle:

- HNSW-basierte semantische Suche;
- BM25;
- Graph-Aktivierung über Entity-, Temporal- und Causal-Links;
- zeitliche Filter.

Danach:

- RRF-Fusion;
- Cross-Encoder-Reranking;
- Ausgabe unter explizitem Tokenbudget.

Das System unterscheidet Ereigniszeit beziehungsweise Gültigkeitsintervall und
den Zeitpunkt, an dem die Information erwähnt beziehungsweise gelernt wurde.

Die Hintergrundkonsolidierung erzeugt Beobachtungen, die unter anderem
enthalten:

- Proof Count;
- unterstützende Zitate;
- Freshness-Trend wie `new`, `strengthening`, `stable`, `weakening` oder
  `stale`;
- Rückverfolgbarkeit auf zugrunde liegende Fakten.

Quelle:

- https://aclanthology.org/2026.acl-demo.27/
- https://github.com/vectorize-io/hindsight

### 4.2 Veröffentlichte Ergebnisse

Das ACL-Demo-Paper berichtet:

- 91,4 % auf LongMemEval mit Gemini-3;
- 89,6 % auf LoCoMo mit Gemini-3;
- 83,6 % LongMemEval mit einem offenen 20B-Backbone;
- unter 200 ms Recall für 10.000 Memory Units, ohne nachgelagerten
  Backbone-LLM-Aufruf.

Die Autoren erklären, dass die Benchmarks durch Forschungspartner reproduziert
worden seien. Diese Formulierung ist als Autorenangabe zu behandeln, nicht als
von uns unabhängig verifizierte Replikationsstudie.

### 4.3 Offene Risiken

Das Paper nennt selbst:

- Fehler bei Fakt-Extraktion oder Entity Resolution können sich im Graph
  fortpflanzen;
- die Evaluation ist englischsprachig;
- Opinion Evolution wurde nicht formal mit Nutzerinnen und Nutzern validiert.

Zusätzlich relevant für Bastra:

- Ein Opinion Network kann unerwünschte, selbstverstärkende Agentenmeinungen
  erzeugen.
- Konfidenz ist nicht gleich Wahrheit.
- Ein Cross-Encoder auf jedem Hook würde Bastras Latenzziel gefährden.

### 4.4 Übertragbarer Architekturgewinn

Bastra sollte die epistemische Trennung präzisieren:

- vom Nutzer oder einer autorisierten Quelle behaupteter Fakt;
- beobachtetes Ereignis beziehungsweise Agentenerfahrung;
- abgeleitete Zusammenfassung oder Observation;
- Hypothese beziehungsweise Meinung;
- kontrollierte Regel beziehungsweise Reflex.

Abgeleitete Inhalte müssen:

- als abgeleitet markiert sein;
- ihre Evidenz referenzieren;
- eine eigene Freshness und gegebenenfalls Konfidenz tragen;
- widerrufbar sein;
- niemals still einen Nutzerfakt ersetzen;
- vor Live-Nutzung mindestens M4 durchlaufen.

## 5. Zep und Graphiti

### 5.1 Belegte Architektur

Graphiti baut einen temporalen Knowledge Graph aus:

- nichtverlustigen Episoden;
- semantischen Entity-Knoten und Fakten;
- Community-Zusammenfassungen;
- bidirektionalen Verweisen zwischen abgeleiteten Fakten und Episoden.

Entscheidend ist das bi-temporale Modell:

- **Valid Time** – wann eine Aussage in der Welt gültig war;
- **Transaction beziehungsweise Knowledge Time** – wann das System davon
  erfahren oder sie gespeichert hat.

Neue widersprechende Fakten löschen ältere Fakten nicht. Die ältere Kante wird
zeitlich invalidiert und bleibt für historische Abfragen und Provenienz
erhalten.

Quellen:

- https://arxiv.org/abs/2501.13956
- https://help.getzep.com/graphiti/getting-started/overview
- https://github.com/getzep/graphiti

### 5.2 Aktuelle Anbieterbenchmarks

Zep berichtet aktuell:

- LoCoMo: 94,7 % Accuracy, p95 Retrieval 155 ms, median 5.760
  Kontexttokens;
- LongMemEval: 90,2 % Accuracy, p95 Retrieval 162 ms, median 4.408
  Kontexttokens.

Die veröffentlichte Methodik nennt GPT-5.4 als Reader und Judge und
unterschiedliche Retrieval-Sichten. Diese Ergebnisse sind:

- für Zep intern nachvollziehbar beschrieben;
- nicht ohne Weiteres mit Hindsight, Mem0, MAGMA oder Bastra vergleichbar;
- kein Beweis, dass die gesamte Zep-Architektur für Bastras lokalen Scope
  geeigneter wäre.

Quelle:

- https://www.getzep.com/research/

### 5.3 Übertragbarer Architekturgewinn

Für Bastra sollte geprüft werden:

- `valid_from`;
- `valid_to`;
- `observed_at` oder `occurred_at`;
- `learned_at` beziehungsweise `recorded_at`;
- `supersedes`;
- `supports`;
- `contradicts`;
- `derived_from`.

Die Begriffe müssen eindeutig sein. Ein Dateifeld `created` darf nicht
gleichzeitig Ereigniszeit, Schreibzeit und Gültigkeitsbeginn bedeuten.

Bei nicht faktischen Memories wie Regeln, Präferenzen oder Lessons muss
definiert werden, welche Zeitachsen überhaupt sinnvoll sind.

## 6. Ori Mnemos

### 6.1 Warum Ori der direkteste Vergleich ist

Ori Mnemos ähnelt Bastra stärker als die üblichen Cloud-Memory-Plattformen:

- Markdown auf der Festplatte;
- Git-freundlich;
- MCP;
- Claude-Code-Lifecycle-Integration;
- lokale Embeddings;
- BM25;
- Knowledge Graph über Wiki-Links;
- getrennte Memory-Spaces;
- kognitiv inspirierte Zugänglichkeit und Vergessen;
- bewusste Tiefensuche.

Quelle:

- https://github.com/aayoawoyemi/Ori-Mnemos

### 6.2 Retrieval und Vergessen

Ori beschreibt eine Vier-Signal-Fusion aus:

- semantischen Embeddings;
- BM25;
- Personalized PageRank;
- assoziativer „Warmth“.

Weitere Mechanismen:

- ACT-R-artige Base-Level-Aktivierung;
- Spreading Activation entlang von Links;
- unterschiedliche Decay-Geschwindigkeiten für Identity, Knowledge und
  Operations;
- Schutz strukturell wichtiger Knoten;
- Gravity Dampening gegen hochähnliche Treffer ohne Query-Term-Overlap;
- Hub Dampening gegen dominierende Map-/Hub-Knoten;
- Boost für anwendbares Wissen wie Entscheidungen und Learnings.

### 6.3 Retrieval Intelligence

Ori beschreibt drei lernende Ebenen:

1. **Q-Value-Reranking**
   - positives Signal bei späterem Zitieren;
   - positives Signal bei Edit nach Recall;
   - positives Signal bei neuer Downstream-Memory;
   - positives Signal bei erneutem Recall;
   - negatives Signal bei Top-Treffern ohne Folgehandlung;
   - Exploration Bonus;
   - Exposure-Korrektur und Bias Cap.
2. **Co-Occurrence Edges**
   - zusammen abgerufene Notes werden verbunden;
   - NPMI-Normalisierung;
   - Hebbian-artige Verstärkung;
   - Homeostasis gegen Hub-Dominanz.
3. **Stage Meta-Learning**
   - ein contextual Bandit entscheidet pro Pipeline-Stufe zwischen
     `run`, `skip` und `abstain`;
   - teure Stufen benötigen einen höheren erwarteten Nutzen;
   - Grundstufen bleiben garantiert verfügbar.

Quelle:

- https://github.com/aayoawoyemi/Ori-Mnemos/blob/main/RETRIEVAL_INTELLIGENCE_SPEC.md

### 6.4 Rekursive Exploration

Ori zerlegt ungelöste Fragen in Teilfragen, zeigt einen Suchbaum, erlaubt die
Vertiefung einzelner Äste und beendet die Exploration bei Konvergenz.

Das entspricht der Nutzerintuition des bewussten „Wühlens“ wesentlich besser
als ein bloß erhöhtes `k`.

### 6.5 Benchmarkgrenzen

Ori meldet unter anderem starke Ergebnisse gegen Mem0 auf HotpotQA und eigene
LoCoMo-Runs.

Die Evidenz ist nur qualifiziert verwendbar:

- HotpotQA umfasst im veröffentlichten Lauf 50 Fragen;
- HotpotQA ist Dokument-Multi-Hop-Retrieval, kein vollständiger
  Langzeit-Agentenbetrieb;
- der Mem0-Vergleich enthält sehr unterschiedliche Ingestion-Kosten;
- die LoCoMo-Kennzahlen und die im Haupt-README zitierten Fremdwerte nutzen
  nicht durchgehend dieselben Metriken;
- es handelt sich um Eigenmessungen.

Quelle:

- https://github.com/aayoawoyemi/Ori-Mnemos/tree/main/bench

### 6.6 Übertragbarer Architekturgewinn

Für Bastra sinnvoll:

- Gravity- und Hub-Dampening als M2-Ablationsarme;
- Graph-Aktivierung als abgeleitete Accessibility-Komponente;
- Q- und Co-Occurrence-Signale ausschließlich in M6-Shadow;
- Exposure-Korrektur, damit häufig ausgespielte Memories nicht automatisch
  häufiger „bewiesen“ werden;
- sichtbarer Deep-Recall-Suchbaum;
- Konvergenz und Sackgassen als Telemetrie;
- getrennte metabolische beziehungsweise Accessibility-Raten pro Memory-Art.

Nicht ungeprüft übernehmen:

- positives Lernen aus bloßer zeitlicher Korrelation;
- negative Rewards aus Nichtreaktion;
- automatische Graph-Modifikation im Live-Pfad;
- Query-Rohtexte in einer langfristigen Lern-Datenbank ohne Privacy-Prüfung;
- Bandit-Aktivierung vor ausreichendem Mindest-N.

## 7. Mem0

### 7.1 Produktstärken

Mem0 besitzt:

- breite SDK- und Framework-Integration;
- User-, Agent- und Anwendungsscope;
- Managed- und Open-Source-Varianten;
- Fact Extraction;
- Vector- und optionale Graph-Strukturen;
- CRUD, History und Export;
- eine öffentliche Benchmark-Suite.

Quellen:

- https://github.com/mem0ai/mem0
- https://docs.mem0.ai/open-source/features/graph-memory
- https://arxiv.org/abs/2504.19413

### 7.2 Aktuelle Benchmarkangaben

Die Mem0-Benchmark-Suite berichtet für die Managed-v3-Pipeline:

- LongMemEval Top 50: 94,8 %;
- LoCoMo Top 200: 92,5 %.

Auf BEAM bei 10M Token Historie:

- Pass Rate: 50,5 %;
- Temporal Reasoning: 16,3 %;
- Contradiction Resolution: 32,5 %;
- Abstention: 40,0 %;
- Multi-Session Reasoning: 26,1 %.

Quelle:

- https://github.com/mem0ai/memory-benchmarks

### 7.3 Schlussfolgerung

Hohe LongMemEval- oder LoCoMo-Zahlen bedeuten nicht, dass Langzeitgedächtnis
bei Größenwachstum, Interferenz, Widerspruch und Abstention gelöst ist.

Bastra sollte Standardbenchmarks nutzen, aber nicht für einen einzigen
Headline-Score optimieren.

## 8. T-Mem und typisierte Zukunftscues

### 8.1 Zentrale Idee

T-Mem unterscheidet zwei Achsen:

1. **Granularität**
   - Item beziehungsweise einzelner Fakt;
   - Scene beziehungsweise zusammenhängende Episode.
2. **Orientierung**
   - descriptive;
   - associative.

Daraus entstehen vier Triggerfamilien:

- **Entity Trigger** – Item × descriptive;
- **Bridge Trigger** – Item × associative;
- **Scene Trigger** – Scene × descriptive;
- **Horizon Trigger** – Scene × associative.

Die Trigger werden beim Schreiben beziehungsweise bei der
Memory-Konstruktion erzeugt und getrennt vom eigentlichen Beweismaterial
indexiert.

Quelle:

- https://arxiv.org/abs/2606.15405

### 8.2 Beispiel

Gespeicherte Information:

> Ein Kollege im Team hat eine schwere Meeresfrüchteallergie.

Spätere Query:

> Wo sollen wir heute mit dem Team essen gehen?

Zwischen beiden Texten besteht nur geringe lexikalische oder direkte
semantische Ähnlichkeit. Die Erinnerung ist trotzdem kausal und situativ
relevant.

### 8.3 Bedeutung für `recall_when`

Bastras `recall_when` ist bereits ein explizites Zukunftscue und damit
konzeptionell näher an T-Mem als ein gewöhnlicher Vector Store.

Die bestehende Richtung sollte nicht ersetzt, sondern präzisiert werden:

- `recall_when` bleibt der primäre handgeschriebene beziehungsweise vom
  Agenten beim Save explizit formulierte Zukunftscue;
- zusätzliche Cues dürfen abgeleitet werden;
- Cue und Evidenz bleiben getrennt;
- abgeleitete Cues tragen Herkunft, Modell/Regel, Version und Konfidenz;
- ein Treffer auf einen Cue liefert noch keine Wahrheit, sondern öffnet den
  Pfad zur eigentlichen Evidenz.

### 8.4 Vorgeschlagene Cue-Typen

Als logisches Modell prüfen:

- `descriptive_item`;
- `associative_bridge`;
- `descriptive_scene`;
- `associative_horizon`;
- optional `entity`;
- optional `causal`;
- bestehendes `recall_when` als autorisierte beziehungsweise primäre
  Cue-Quelle.

Die endgültigen Feldnamen sind keine Vorentscheidung. Zunächst reicht eine
read-only Sidecar-Projektion.

### 8.5 Notwendige Ablation

Mindestens folgende Arme:

- Content only;
- heutiges `recall_when`;
- Content + `recall_when`;
- abgeleitete descriptive Cues;
- abgeleitete associative Cues;
- Item Cues;
- Scene Cues;
- Cue Retrieval mit Rückgabe der unveränderten Evidence;
- Cue Retrieval ohne Evidence-Rückbindung als negative Kontrolle.

Metriken:

- Recall@k;
- MRR/nDCG;
- assoziative Gold-Abdeckung;
- False-Interrupt-Rate;
- falsche Brücken;
- Kontexttokens;
- Query-/Memory-Sprachmischung;
- Latenz;
- Provenienzvollständigkeit.

## 9. All-Mem und nichtdestruktive Topologieentwicklung

### 9.1 Zentrale Idee

All-Mem hält eine begrenzte sichtbare Memory-Oberfläche für den schnellen
Abruf. Ältere oder weniger zugängliche Evidenz bleibt archiviert und über
typisierte Links erreichbar.

Offline werden drei Operationen vorgeschlagen:

- `SPLIT`;
- `MERGE`;
- `UPDATE`.

Die Operationen reorganisieren die Retrievaltopologie, ohne ursprüngliche
Evidenz zu löschen.

Quelle:

- https://arxiv.org/abs/2603.19595

### 9.2 Bedeutung für den Asteroidengürtel

All-Mem ist eine starke unabhängige Bestätigung für:

- sichtbare aktive Zone;
- dormante, aber erreichbare Zone;
- bounded visible surface;
- bewusste Expansion in archivierte Evidenz;
- unveränderliche Quellen;
- Versionen und Rückverfolgbarkeit;
- Offline-Konsolidierung außerhalb des schnellen Pfads.

### 9.3 Präzisierungen für Bastra

Prüfen:

- garantierte Erreichbarkeit jeder konsolidierten oder dormanten Quelle über
  eine begrenzte Zahl typisierter Links;
- `SPLIT`, `MERGE`, `UPDATE` als Proposal-Typen, nicht als unkontrollierte
  direkte Markdown-Operationen;
- jede abgeleitete Memory referenziert alle Inputs;
- alte IDs bleiben zitierbar;
- archivierte Inhalte bleiben per ID und Deep Recall erreichbar;
- eine sichtbare Memory darf eine archivierte Quelle repräsentieren, aber
  nicht still deren Inhalt ersetzen;
- der Asteroidengürtel ist Accessibility, nicht Löschung.

## 10. MAGMA und logische Multi-Graph-Sichten

### 10.1 Zentrale Idee

MAGMA repräsentiert Memory-Beziehungen in vier orthogonalen Sichten:

- semantic;
- temporal;
- causal;
- entity.

Ein Intent-Aware Router bestimmt, welche Sichten zu einer Query passen.
Retrieval traversiert die ausgewählten Sichten getrennt und fusioniert danach
die Ergebnisse.

Zusätzlich:

- schneller Ingestion-Pfad ohne blockierendes LLM;
- langsame asynchrone strukturelle Konsolidierung;
- adaptive Traversal-Policy;
- budgetierter Kontextaufbau.

Quelle:

- https://aclanthology.org/2026.acl-long.1709/

### 10.2 Veröffentlichte Ergebnisse und Grenzen

Das Paper berichtet auf seiner LoCoMo-Konfiguration:

- MAGMA Overall 0,700;
- Nemori 0,590;
- A-MEM 0,580;
- Full Context 0,481.

Es nutzt ein gemeinsames GPT-4o-mini-Setup. Die Hyperparameter wurden laut
Paper auf LoCoMo optimiert. Die Zahlen sind daher keine direkte Rangliste
gegen aktuelle Zep-, Mem0- oder Hindsight-Produktstände.

Das Paper nennt selbst:

- LLM-abhängige Graphqualität;
- mögliche falsche oder fehlende Kanten;
- höhere Storage- und Engineering-Komplexität;
- begrenzte Generalisierbarkeit der Benchmarks.

### 10.3 Übertragbarer Architekturgewinn

Bastra braucht wahrscheinlich nicht vier physische Graphen.

Sinnvoller Prüfgegenstand:

- ein gemeinsamer Typed Graph;
- vier logische Edge-Views;
- Query-Intent bestimmt View-Gewichte und Hop-Budget;
- jede View kann unabhängig ablated werden;
- Causal und Temporal dürfen nicht aus bloßer semantischer Ähnlichkeit
  entstehen;
- abgeleitete Kanten benötigen Evidenz und Konfidenz;
- Normal Recall nutzt begrenzte Traversalpfade;
- Deep Recall darf Views breiter kombinieren.

## 11. LongMemEval-V2 und AgentRunbook-C

### 11.1 Was der Benchmark misst

LongMemEval-V2 untersucht Erfahrung in spezialisierten Agentenumgebungen:

- statische Zustände;
- dynamische Zustandsänderungen;
- Workflows;
- wiederkehrende Fehler und Gotchas;
- Premise Awareness;
- große, teils multimodale Agententrajektorien.

Der Medium-Tier reicht bis ungefähr 500 Trajektorien beziehungsweise
115 Millionen Token Historie.

Quelle:

- https://arxiv.org/abs/2605.12493
- https://github.com/xiaowu0162/LongMemEval-V2

### 11.2 AgentRunbook-R

AgentRunbook-R hält getrennte Knowledge Pools für:

- rohe Zustandsbeobachtungen;
- State-Transition-Events;
- höherwertige Strategie- und Gotcha-Notes.

Es ist schneller als eine coding-agentische Exploration, aber weniger genau.

### 11.3 AgentRunbook-C

AgentRunbook-C:

- speichert Trajektorien als Dateien;
- stellt Workflow-Dokumente bereit;
- erzeugt Memory-Manifeste;
- liefert Hilfsskripte für State- und Trajectory-Inspektion;
- lässt einen Coding-Agenten die relevante Evidenz mehrstufig sammeln.

Veröffentlichte Mittelwerte:

- AgentRunbook-C: 72,5 %;
- stärkste einfache RAG-Baseline: 48,5 %;
- off-the-shelf Coding Agent: 69,3 %.

Latenz:

- ungefähr 108–140 Sekunden pro Query für AgentRunbook-C;
- daher ungeeignet als normaler Hook-Recall.

### 11.4 Architekturfolge für Deep Recall

Deep Recall darf nicht nur heißen:

- größeres `k`;
- geringerer Score Floor;
- mehr Graph-Hops;
- HNSW statt Flat;
- mehr Tokens.

Deep Recall sollte ein eigener agentischer Modus sein:

1. Query analysieren;
2. gegebenenfalls in Teilfragen zerlegen;
3. Memory-Manifest und Zeit-/Scope-Übersicht lesen;
4. exakte IDs, Symbole, Dateipfade und Entity-Namen prüfen;
5. BM25, Semantic, Zeitfilter und Graph gezielt kombinieren;
6. einzelne Suchäste vertiefen;
7. Sackgassen markieren;
8. Evidenz über IDs und Quellen sammeln;
9. Konvergenz erkennen;
10. Budgetverlängerung nur bewusst zulassen;
11. Ergebnis mit Suchpfad und Evidenz zurückgeben;
12. bei fehlender Evidenz ehrlich `no_answer` liefern.

### 11.5 Visuelle Folge

Mindspace kann den Deep-Recall-Prozess zusätzlich darstellen:

- Startpunkt in der inneren Galaxie;
- Übergang in den Asteroidengürtel;
- verzweigende Suchpfade;
- starke, schwache und tote Äste;
- wiedergefundene Evidenz;
- Herkunft und Alter;
- Rückkehr einer Memory in eine zugänglichere Zone nur nach definiertem
  Reaktivierungssignal.

Die Visualisierung ist eine Erklärung des Retrievalprozesses, nicht dessen
Wahrheitsbeweis.

## 12. Mem2ActBench und die Anwendung von Erinnerung

### 12.1 Zentrale Erkenntnis

Übliche Benchmarks fragen:

> Was war das Budget des Nutzers?

Mem2ActBench verlangt stattdessen:

> Führe eine spätere, unvollständig spezifizierte Aufgabe mit dem früher
> genannten Budget, den Präferenzen und Einschränkungen korrekt aus.

Die Erinnerung muss in einen Tool Call und dessen Argumente eingehen.

Quelle:

- https://aclanthology.org/2026.acl-long.370/

### 12.2 Ergebnisse

Im gemeinsamen Setup:

- A-MEM erreicht mit Qwen2.5-72B ungefähr 35,9 Argument-F1;
- einfacher Long-Term-Memory-RAG ungefähr 35,3;
- perfektes Oracle Retrieval ungefähr 53,8;
- der beste passive Hybrid Retriever ungefähr 30,7.

Der dominante Engpass bleibt das Finden der richtigen Evidenz.

### 12.3 Bedeutung für Bastra

Bastras Architektur nennt bereits Task-/Tool-Erfolg zusätzlich zu `loaded` und
`acted_on`. Diese Richtung muss verbindlicher werden.

Prüfen:

- Coding-Aufgaben mit impliziten früheren Projektregeln;
- Tool Calls mit früher gespeicherten Pfaden, IDs, Limits und
  Sicherheitsregeln;
- Vorher-/Nachher-Vergleich mit und ohne Recall;
- falsche Anwendung einer richtigen Memory;
- korrekte Nichtanwendung einer irrelevanten Memory;
- genaue Argumenttreue;
- Task Success;
- Safety-Verstöße durch falschen Recall;
- Memory-induzierte Overconfidence.

## 13. „Does Memory Need Graphs?“ – wichtige Gegenposition

Eine ACL-2026-Analyse zerlegt Graph- und Nicht-Graph-Systeme in vergleichbare
Komponenten und kommt zu einem für Bastra wichtigen Ergebnis:

- grundlegende Systementscheidungen beeinflussen Ergebnisse stark;
- Graphen können in passenden Konfigurationen helfen;
- ungeeignete Graphkonstruktion oder Retrievalstrategien können Ergebnisse
  verschlechtern;
- starke flache Baselines sind häufig konkurrenzfähig;
- Rohsessions als Evidence Value können wertvoller sein als zu stark
  komprimierte Graphbeschreibungen;
- Update/Noop können Recall verbessern, aber Precision verschlechtern.

Quelle:

- https://aclanthology.org/2026.acl-long.1232/

Folge:

- Die bestehende Bastra-Gating-Strategie ist richtig.
- Typed Graph darf kein Dogma werden.
- Jede Graph-Sicht braucht eine Flat-/No-Graph-Ablation.
- Representation, Candidate Generation, Traversal und Presentation müssen
  getrennt gemessen werden.
- Ein besserer End-to-End-Score beweist nicht, dass der Graph die Ursache war.

## 14. Basic Memory

### 14.1 Relevante Produktmerkmale

Basic Memory besitzt:

- lokales Markdown als Source of Truth;
- bidirektionale Bearbeitung durch Mensch und Agent;
- MCP;
- Wiki-Link-/Relations-Graph;
- hybride Text-/Vector-Suche;
- `build_context` mit Tiefe und Zeitraum;
- Multi-Projekt-Verwaltung;
- optionale Cloud ohne Pflicht;
- Schema-Inferenz, Schema-Validierung und Schema-Diff;
- MCP Tool Annotations für read-only, destructive und idempotent.

Quelle:

- https://github.com/basicmachines-co/basic-memory

### 14.2 Was Bastra davon lernen kann

Nicht primär kognitive Architektur, sondern Produkt- und Wartbarkeit:

- Vault-Schema inferieren;
- tatsächliche Memories gegen das Schema validieren;
- Schemaänderungen als Diff zeigen;
- Graph-Orphans und kaputte Links diagnostizieren;
- MCP-Tools semantisch annotieren;
- Context Builder mit explizitem Depth-/Timeframe-Budget;
- strikte Auflösung vor destruktiven Operationen.

Bastra bleibt bei proaktiver Aufmerksamkeit, `recall_when`, Reflex, Salience
und abstention-orientierter Hooksteuerung eigenständiger.

## 15. Letta

### 15.1 Relevante Architektur

Letta besitzt eine explizite Kontext-Hierarchie:

- immer sichtbare Memory Blocks;
- teilweise eingeblendete Files;
- unbegrenztes Archival Memory über Tools;
- externe RAG-/MCP-Quellen.

Memory Blocks können:

- agent-managed;
- read-only;
- zwischen Agenten geteilt;
- permanent im Kontext gehalten werden.

Quellen:

- https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- https://docs.letta.com/guides/core-concepts/memory/context-hierarchy

### 15.2 Übertragbarer Architekturgewinn

Bastra besitzt mit Floors, Pinned Memories, Session Context und dem geplanten
Working Memory bereits verwandte Mechanismen.

Präzisiert werden könnte:

- welches Wissen immer sichtbar sein darf;
- maximales Budget pro Lane;
- read-only Policies;
- agentenspezifische und gemeinsam geteilte Blöcke;
- Konflikt- und Prioritätsregeln zwischen Floor, Working, Reflex und Recall;
- Schutz vor Last-Write-Wins bei konkurrierenden Agenten.

Letta ist kein Grund, die Markdown-Source-of-Truth aufzugeben.

## 16. MIRIX

MIRIX unterscheidet:

- Core Memory;
- Episodic Memory;
- Semantic Memory;
- Procedural Memory;
- Resource Memory;
- Knowledge Vault.

Es nutzt spezialisierte Agenten und kann Bildschirmaktivität beziehungsweise
multimodale Erfahrungen verarbeiten.

Quellen:

- https://arxiv.org/abs/2507.07957
- https://github.com/Mirix-AI/MIRIX
- https://docs.mirix.io/architecture/multi-agent-system/

Relevanz:

- Multimodale Episoden können später für Bastra Mac interessant werden.
- Resource Memory kann Dateien, Screenshots und externe Artefakte von
  semantischen Nutzerfakten trennen.
- Sechs Management-Agenten sind für Bastras aktuellen lokalen Scope vermutlich
  zu schwergewichtig.

Empfehlung:

- Multimodalität als späteren optionalen Forschungszweig festhalten;
- nicht zum Pflichtbestandteil der V2-Promotion machen;
- zuerst Text-/Tool-/Projektgedächtnis beweisen.

## 17. Vorgeschlagene V2-Präzisierungen

Die folgenden Punkte sind Prüfaufträge, noch keine freigegebenen Änderungen.

### 17.1 Typed Cue Layer

Ziel:

- Abrufbarkeit von Evidenz trennen;
- beschreibende und assoziative Cues unterscheiden;
- Item- und Scene-Cues unterscheiden;
- `recall_when` als primäre Zukunftscue erhalten.

Mögliche Architektur:

```text
Evidence
  ├─ body / claim / episode / source
  └─ immutable or versioned evidence refs

Cue Sidecar
  ├─ descriptive_item
  ├─ associative_bridge
  ├─ descriptive_scene
  ├─ associative_horizon
  ├─ origin
  ├─ generator/version
  └─ confidence
```

Wichtig:

- Cues dürfen Kandidaten öffnen.
- Cues dürfen nicht selbst als Beweis ausgegeben werden.
- Manuelles `recall_when` hat eine andere Vertrauensklasse als ein
  LLM-abgeleiteter Cue.

### 17.2 Agentischer Deep Recall

Deep Recall erhält einen eigenen Controller:

- Query Decomposition;
- Scope-/Time-/Type-Manifeste;
- iterative Suche;
- Branch Tree;
- Graph-/BM25-/Semantic-/Exact-Search-Werkzeuge;
- Evidence Collector;
- Convergence Detector;
- Budget Manager;
- `no_answer`.

Normal Recall bleibt davon unabhängig.

### 17.3 Bi-temporales Claim-Modell

Mindestens logisch trennen:

- wann etwas passiert beziehungsweise gegolten hat;
- wann die Aussage geäußert wurde;
- wann Recall sie gespeichert hat;
- wann eine abgeleitete Aussage erzeugt wurde;
- wann eine frühere Aussage invalidiert oder superseded wurde.

### 17.4 Epistemische Memory-Arten

Zusätzlich zu funktionalen Memory-Lanes prüfen:

- `source_fact`;
- `agent_experience`;
- `derived_observation`;
- `hypothesis_or_opinion`;
- `approved_rule_or_reflex`.

Diese Achse kann orthogonal zu Working/Episodic/Semantic/Reflex sein. Nicht
vorschnell die Taxonomie verdoppeln; gegebenenfalls reichen Claim-Type und
Provenienz.

### 17.5 Logische Relation Views

Im Typed Graph:

- semantic;
- temporal;
- causal;
- entity;
- evidence/provenance.

Query Intent steuert:

- aktive Views;
- Kantengewichte;
- Hop-Budget;
- Candidate Budget;
- Normal- versus Deep-Recall-Modus.

### 17.6 Nichtdestruktive Topologieoperationen

Konsolidierungs-Proposals:

- `SPLIT`;
- `MERGE`;
- `UPDATE`;
- gegebenenfalls `LINK`;
- `SUPERSEDE`;
- `REACTIVATE`;
- `DORMANT`.

Jede Operation:

- referenziert Inputs;
- erzeugt eine neue Version oder abgeleitete Repräsentation;
- löscht keine Evidence;
- ist prüfbar und rückrollbar;
- enthält Begründung und Konfidenz;
- wird vor Persistenz gegated.

### 17.7 Utility Learning

Mögliche bessere Nutzungssignale:

- explizite Annahme oder Ablehnung;
- späteres Zitat einer Memory-ID;
- Edit nach Recall;
- erfolgreiche Downstream-Erstellung;
- wiederholter Recall in verschiedenen Queries;
- Task-/Tool-Erfolg;
- Safety-Vermeidung;
- Korrektur nach falschem Recall;
- Deep-Recall-Reaktivierung;
- dokumentierte Sackgasse.

Pflicht:

- Exposure Bias korrigieren;
- Nichtreaktion nicht als sicheres Negativlabel behandeln;
- Attribution auf Client, Hook Source, Session und Experimentarm;
- kein Live-Ranking vor M6.

### 17.8 Memory Manifeste

Read-only Manifeste können Deep Recall orientieren:

- Projekte und Scopes;
- Zeiträume;
- Memory-Arten;
- Entities;
- Episoden;
- Claims;
- dormante Zonen;
- bekannte Konflikte;
- Graph-Communities;
- Indexfrische;
- verfügbare Quellen.

Manifeste dürfen keine privaten Inhalte oder Sensitivity-Filter umgehen.

## 18. Vorgeschlagenes erweitertes Evaluationsportfolio

### 18.1 Lokales Bastra-Goldset bleibt Pflicht

Das M0/M1-Goldset bleibt maßgeblich für Bastras tatsächlichen Produktscope:

- reale unabhängige Paraphrasen;
- Anti-Queries;
- `no_answer`;
- Projekt-/Scope-Fälle;
- Code-/Pfad-/ID-Queries;
- Regeln, Entscheidungen und Präferenzen;
- gemischte Sprache;
- dormante und Deep-Recall-Fälle;
- Provenienzpflicht.

### 18.2 LoCoMo und LongMemEval

Zweck:

- externe Vergleichbarkeit;
- Temporal-, Multi-Session- und Knowledge-Update-Fähigkeit;
- nicht als alleiniger Produktmaßstab.

### 18.3 LoCoMo-Plus

Zweck:

- assoziative Cues;
- geringe Oberflächenähnlichkeit;
- Prüfung von Bridge-/Horizon-Triggern.

Quelle:

- im T-Mem-Paper beschrieben:
  https://arxiv.org/abs/2606.15405

### 18.4 Mem2Act-artiger Bastra-Test

Zweck:

- Anwendung von Memory in echten Aktionen;
- Toolargumente;
- implizite Constraints;
- korrekte Nichtanwendung irrelevanter Memories.

### 18.5 LongMemEval-V2-artiger Test

Zweck:

- Projekt-Workflows;
- Gotchas;
- Fehlertrajektorien;
- Zustandswechsel;
- Premise Awareness;
- agentischer Deep Recall.

Ein vollständiger 115M-Token-Lauf ist für V1.0 nicht zwingend. Ein
repräsentativer lokaler Subset kann zuerst reichen.

### 18.6 BEAM-artiger Skalierungstest

Zweck:

- Interferenz bei starkem Wachstum;
- Widersprüche;
- Abstention;
- Event Ordering;
- Knowledge Update;
- Multi-Session Reasoning;
- Qualitäts- und Latenzabbau über Größenstufen.

### 18.7 Deep-Recall-Metriken

- Erfolgsquote definierter dormanter Golds;
- Zeit bis zur Evidence;
- Zahl der Suchäste;
- Sackgassenquote;
- Konvergenzquote;
- Budgetüberschreitungen;
- falsche Reaktivierungen;
- Evidence Coverage;
- Zitationsvollständigkeit;
- `no_answer`-Qualität;
- Normal-Recall-Verwechslungen;
- Nutzerabbruch beziehungsweise manuelle Budgetverlängerung.

### 18.8 Assoziative-Cue-Metriken

- Bridge Recall@k;
- Horizon Recall@k;
- Cue-to-Evidence Precision;
- falsche Assoziationen;
- assoziative False-Interrupt-Rate;
- mehrsprachige Cue-Übertragung;
- Cue Drift nach Memory-Updates;
- Verlust alter Cues nach Konsolidierung.

## 19. Vorgeschlagene Zuordnung zu M0–M6

Diese Zuordnung ist von Claude zu prüfen und gegebenenfalls zu ändern.

### M0 – Messwahrheit

Ergänzen beziehungsweise prüfen:

- Standardbenchmark-Harness-Versionen;
- Modell-, Judge- und Promptversionen;
- Kontextbudget und Top-k;
- Retrieval- versus Answering-Metriken;
- Scale-Stufen;
- Mem2Act-/Task-Success-Subset;
- unabhängige Herkunft der Queries;
- keine nicht vergleichbaren Anbieterwerte in einer gemeinsamen Rangliste.

### M1 – Relevanzevidenz und Abstention

Ergänzen beziehungsweise prüfen:

- Anti-Query- und `no_answer`-Fälle aus Standardbenchmarks;
- falsche Anwendung einer richtigen Memory;
- Premise Awareness;
- Overconfidence nach Recall;
- Cue-Treffer ohne ausreichende Evidence führt nicht zu `required`.

### M2 – Retrievalkaskade und Repräsentationsexperimente

Ergänzen beziehungsweise prüfen:

- Gravity Dampening;
- Hub Dampening;
- bedingter Cross-Encoder nur außerhalb harter Hook-Budgets oder bei
  ausreichender Restlatenz;
- typed-cue Ablation;
- Item versus Scene;
- descriptive versus associative;
- Cue-to-Evidence-Rückbindung;
- Flat-/No-Graph-Kontrollarm.

Eine Typed-Cue-Persistenz braucht gegebenenfalls weiterhin einen gesonderten
Repräsentationsentscheid analog Chunking.

### M3 – Accessibility und Deep Recall

Ergänzen beziehungsweise prüfen:

- agentische Deep-Recall-Ablation gegen bloßes größeres `k`;
- Branch Tree und Konvergenz;
- Manifest-Nutzen;
- Asteroidengürtel-Erreichbarkeit;
- kontrollierte Reaktivierung;
- Time/Token Budgets;
- bewusste Budgetverlängerung;
- keine automatische Hook-Nutzung des agentischen Pfads.

### M4 – Episodic, Claims, Graph und Konsolidierung

Ergänzen beziehungsweise prüfen:

- bi-temporale Felder;
- epistemische Claim-Typen;
- vier logische Relation Views;
- `SPLIT`/`MERGE`/`UPDATE`;
- immutable Evidence;
- Punkt-in-der-Zeit-Abfragen;
- Graph versus Flat;
- falsche Kanten und Entity-Linking-Fehler;
- vollständige Versionierbarkeit.

### M5 – Flat/HNSW

Keine grundsätzliche Änderung:

- HNSW bleibt Größen-/Latenzentscheidung;
- Graphkomplexität ist kein HNSW-Argument;
- Cross-Encoder und HNSW getrennt messen;
- der aktuelle 577-Memory-Vault rechtfertigt keine vorgezogene
  Live-Aktivierung.

### M6 – Learned Layer

Ergänzen beziehungsweise prüfen:

- Utility-Signale jenseits `acted_on`;
- Exposure-Korrektur;
- Co-Occurrence in Shadow;
- Q-Value-Historie;
- Stage `run`/`skip`/`abstain`;
- Mindest-N pro Query-/Client-/Hook-Klasse;
- Drift- und Bias-Monitoring;
- sofortiger Fallback auf deterministische Reihenfolge;
- kein Lernen aus privaten Query-Rohtexten ohne explizite
  Datenschutzentscheidung.

## 20. Änderungen, die ausdrücklich nicht vorschnell erfolgen dürfen

- kein Opinion Network live, nur weil Hindsight gute Benchmarks zeigt;
- keine vier physischen Graphdatenbanken, nur weil MAGMA vier Views nutzt;
- keine automatische Markdown-Konsolidierung durch SPLIT/MERGE/UPDATE;
- keine Q-Wert-Livegewichtung aus `acted_on`;
- keine Co-Occurrence-Kanten ohne Exposure- und Hub-Kontrolle;
- kein Cross-Encoder in jedem PreTool-Hook;
- keine vollständige AgentRunbook-C-Suche im Normal Recall;
- kein vollständiger LongMemEval-V2-Medium-Lauf als V1.0-Blocker;
- keine Abschaffung von `recall_when`;
- keine Ersetzung von Evidence durch Triggertexte oder Zusammenfassungen;
- keine Löschung älterer widersprochener Fakten;
- keine Behauptung, ein „hirnähnlicher“ Name beweise biologische Plausibilität;
- keine Optimierung auf einen einzigen Anbieterbenchmark;
- keine Live-Aktivierung ohne Bastra-spezifischen Nutzen.

## 21. Priorisierungsvorschlag

### Priorität A – Architektur jetzt präzisieren

1. Cue und Evidence ausdrücklich trennen.
2. `recall_when` in ein typisierbares Cue-Modell einordnen.
3. Deep Recall als agentische Navigation definieren.
4. Claim-Zeitmodell bi-temporal präzisieren.
5. epistemische Herkunft und Ableitungsart explizit machen.
6. Typed Graph in logische Relation Views zerlegen.
7. Konsolidierung über nichtdestruktive Proposal-Operatoren definieren.
8. Evaluationsportfolio um assoziative und handlungsbezogene Tests erweitern.

### Priorität B – Shadow-Experimente vorbereiten

1. Gravity-/Hub-Dampening;
2. typed-cue Sidecar;
3. Scene-/Episode-Manifeste;
4. Deep-Recall-Branch-Controller;
5. Cross-Encoder-Ablation;
6. Graph-View-Routing;
7. Utility-Signal-Sammlung;
8. Co-Occurrence-Projektion;
9. Standardbenchmark-Adapter.

### Priorität C – nur nach Evidenz

1. learned Stage Controller;
2. Q-Value-Reranking;
3. automatische Reaktivierung;
4. persistente abgeleitete Cues;
5. persistente bi-temporale Claims;
6. persistente Graph-Kanten;
7. autonome Konsolidierungs-Proposals;
8. multimodale Episoden;
9. HNSW;
10. Opinion-/Belief-Layer.

## 22. Erwartete Architekturpassagen für den Delta-Review

Claude soll mindestens prüfen, ob Änderungen in folgenden Passagen nötig sind:

- §0 – Decision und Review Status;
- §2 – Current State und Problem Statement;
- §3 – wissenschaftliche Leitplanken;
- §4 – Architekturprinzipien;
- §5 – Zielarchitekturdiagramm;
- §6 – Memory-Lanes;
- §7 – Accessibility;
- §8 – Asteroidengürtel und Deep Recall;
- §9 – Adaptive Retrieval;
- §10 – Relevanzevidenz und Abstention;
- §11 – Cue-/Content-Repräsentation;
- §13 – Typed Graph;
- §14 – Konsolidierung;
- §15 – Rekonsolidierung;
- §16 – Hook-/Session-Orchestrierung;
- §17 – Learning und Experimente;
- §18 – M0–M6;
- §19 – Evaluationsdaten und Provenienz;
- §20 – Produktmetriken;
- §21 – Migration;
- §23 – Privacy und Sicherheit;
- §24 – ausdrücklich nicht zuerst bauen;
- §25 – Umsetzungsreihenfolge;
- §26 – Definition of Done;
- §27 – Kurzfassung.

Änderungen sollen nur dort vorgenommen werden, wo ein tatsächliches Delta
entsteht. Wiederholungen und Architekturaufblähung sind zu vermeiden.

## 23. Quellenverzeichnis und Evidenzklasse

### 23.1 Peer-reviewed beziehungsweise offizielle Konferenzquellen

Hindsight:

- https://aclanthology.org/2026.acl-demo.27/

MAGMA:

- https://aclanthology.org/2026.acl-long.1709/

Does Memory Need Graphs?:

- https://aclanthology.org/2026.acl-long.1232/

Mem2ActBench:

- https://aclanthology.org/2026.acl-long.370/

### 23.2 Forschungsarbeiten beziehungsweise Preprints

Zep/Graphiti:

- https://arxiv.org/abs/2501.13956

Mem0:

- https://arxiv.org/abs/2504.19413

Hindsight Full Paper:

- https://arxiv.org/abs/2512.12818

T-Mem:

- https://arxiv.org/abs/2606.15405

All-Mem:

- https://arxiv.org/abs/2603.19595

LongMemEval-V2:

- https://arxiv.org/abs/2605.12493

MIRIX:

- https://arxiv.org/abs/2507.07957

A-MEM:

- https://arxiv.org/abs/2502.12110

HippoRAG 2:

- https://github.com/osu-nlp-group/hipporag

### 23.3 Offizielle Produkt-, Dokumentations- und Repositoryquellen

Hindsight:

- https://github.com/vectorize-io/hindsight
- https://hindsight.vectorize.io/

Zep/Graphiti:

- https://github.com/getzep/graphiti
- https://help.getzep.com/graphiti/getting-started/overview
- https://www.getzep.com/research/

Ori Mnemos:

- https://github.com/aayoawoyemi/Ori-Mnemos
- https://github.com/aayoawoyemi/Ori-Mnemos/tree/main/bench
- https://github.com/aayoawoyemi/Ori-Mnemos/blob/main/RETRIEVAL_INTELLIGENCE_SPEC.md

Mem0:

- https://github.com/mem0ai/mem0
- https://github.com/mem0ai/memory-benchmarks
- https://docs.mem0.ai/open-source/features/graph-memory

Basic Memory:

- https://github.com/basicmachines-co/basic-memory

Letta:

- https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- https://docs.letta.com/guides/core-concepts/memory/context-hierarchy

MIRIX:

- https://github.com/Mirix-AI/MIRIX
- https://docs.mirix.io/architecture/multi-agent-system/

LongMemEval-V2:

- https://github.com/xiaowu0162/LongMemEval-V2
- https://xiaowu0162.github.io/longmemeval-v2/

### 23.4 Quellenkritik

Für alle Zahlen gilt:

- Anbieterbenchmarks sind nicht automatisch falsch, aber nicht unabhängig.
- Unterschiedliche Reader, Judges, Prompts, Top-k, Candidate Pools,
  Kontextbudgets und Dataset-Versionen verhindern direkte Ranglisten.
- LLM-as-a-Judge-Werte sind nicht mit F1, Recall@k oder Task Success
  gleichzusetzen.
- Retrievalqualität und Antwortmodell müssen getrennt werden.
- Self-reported „SOTA“ wird nur als veröffentlichte Behauptung wiedergegeben.
- Neuere Systeme werden teilweise auf älteren Baselines dargestellt.
- Benchmarktuning kann Generalisierung überschätzen.
- LoCoMo und LongMemEval messen nur einen Ausschnitt realer Agent-Memory.

## 24. Konkrete Fragen, die Claude beantworten soll

1. Welche der vorgeschlagenen Cue-Typen sind semantisch trennscharf?
2. Reicht eine abgeleitete Sidecar-Repräsentation oder ist später ein
   Markdown-Schema nötig?
3. Wie bleibt `recall_when` rückwärtskompatibel und primär?
4. Welche Deep-Recall-Schritte sind deterministisch, welche agentisch?
5. Wie wird Deep Recall beendet, wenn kein ausreichender Beleg existiert?
6. Welche Manifeste sind nützlich, ohne private Inhalte zu leaken?
7. Wie werden Event Time, Valid Time, Mention Time und Record Time benannt?
8. Braucht Bastra wirklich einen eigenen Opinion-/Belief-Typ oder reichen
   abgeleitete Claims?
9. Wie wird eine abgeleitete Observation von einem Nutzerfakt getrennt?
10. Welche Relation Views sind im normalen Recall wirklich erforderlich?
11. Wie wird kausale Evidenz validiert?
12. Wie bleiben alte Fakten nach Superseding historisch erreichbar?
13. Wie werden `SPLIT`, `MERGE` und `UPDATE` als reversible Proposals
    modelliert?
14. Welche Ori-Signale taugen als echte Labels und welche nur als Proxies?
15. Wie wird Exposure Bias gemessen?
16. Wann ist ein Cross-Encoder innerhalb des Latenzbudgets sinnvoll?
17. Wie wird ein agentischer Deep Recall gegen einfaches größeres `k`
    ablated?
18. Welche Standardbenchmarks sind für V1.0 sinnvoll, welche erst für V1.x?
19. Wie wird ein Mem2Act-artiger Coding-Test konstruiert?
20. Welche neuen Datenquellen entstehen für jedes vorgeschlagene Gate?
21. Welche Änderungen brauchen ein neues C-ID-Delta?
22. Welche Punkte bestätigen die Architektur nur und benötigen keinen
    Vertragstext?
23. Welche Punkte würden die Architektur unnötig komplex machen?
24. Welche neuen Funktionen wären für einen Vault von 577 Memories
    unverhältnismäßig?
25. Wie sieht für jedes Live-Feature der Fallback aus?

## 25. Erwartetes Übergabeformat von Claude

Claude soll nach der Bearbeitung liefern:

### A. Gesamturteil

- Ist die bisherige V2-Richtung bestätigt?
- Welche substanziellen Lücken wurden gefunden?
- Welche Recherchebehauptungen wurden verworfen oder relativiert?

### B. Quellenmatrix

| Fund | Quelle | Evidenzklasse | Urteil | Architekturfolge |
|---|---|---|---|---|

### C. Delta-Ledger

Für jeden neuen Punkt:

1. ID ab C-029, falls wirklich erforderlich;
2. betroffene Passage;
3. Art: Ist-Korrektur, Messproblem, Architekturentscheidung oder Hypothese;
4. Evidenz;
5. minimale notwendige Textänderung;
6. Gate;
7. Datenquelle;
8. Abnahmekriterium;
9. Rollback beziehungsweise Fallback.

### D. Dokumentänderung

- deutsche Evolutionsarchitektur aktualisiert;
- historische Abnahme C-001–C-028 nicht umgedeutet;
- neue Deltas sichtbar;
- keine unbelegten Ist-Behauptungen;
- keine Produktfreigabe durch bloße Aufnahme ins Zielbild.

### E. Offene Entscheidungen

Nur Entscheidungen aufführen, die Product-Owner-Vorgaben benötigen. Für jede
Entscheidung:

- empfohlene Option;
- Alternative;
- Trade-off;
- Auswirkung auf Release, Messung, Privacy und Rückwärtskompatibilität.

### F. Gegenreview-Übergabe

Kurzer, kopierbarer Auftrag an Codex:

- was geändert wurde;
- welche neuen Claims entstanden;
- welche Stellen besonders geprüft werden müssen;
- welche Tests beziehungsweise Quellen die Änderung tragen.

## 26. Schlussfolgerung

Die Recherche widerlegt Bastras Zielbild nicht. Sie schärft es.

Die stärkste Gesamtposition von Bastra bleibt die Verbindung aus:

- lokalem, nutzereigenem Markdown-Wissen;
- proaktivem Erinnern vor relevanten Handlungen;
- Zukunftscues über `recall_when`;
- bewusst kontrollierter Reflexaktivierung;
- emotionaler und nutzungsabhängiger Accessibility;
- sichtbarem dormanten Gedächtnis;
- bewusstem Deep Recall;
- echter Abstention;
- nachvollziehbarer Evidenz;
- Messgates, Shadow-Betrieb und Rollback.

Die nächste V2-Fassung sollte diese Identität nicht durch unkritisches
Nachbauen fremder Plattformen verwässern.

Sie sollte präziser werden bei:

- Cue-Typen;
- Cue-/Evidence-Trennung;
- agentischem Deep Recall;
- bi-temporaler Wahrheit;
- epistemischer Herkunft;
- logischen Graph-Sichten;
- nichtdestruktiver Topologieentwicklung;
- Utility Learning;
- handlungsbezogener und assoziativer Evaluation.

Das Ziel bleibt:

> Zur richtigen Zeit die richtige Erinnerung – und ansonsten Ruhe.
