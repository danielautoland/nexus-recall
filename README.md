<p align="center">
  <img src="./assets/github-banner.jpg" alt="Bastra — the open memory layer for AI assistants and agents" width="100%" />
</p>

# Bastra.Recall

> A persistent teammate memory for your AI assistants — one local vault, shared by every tool that speaks MCP.
> Ein persistentes Teammate-Gedächtnis für deine AI-Assistenten — ein lokaler Vault, geteilt von jedem Tool, das MCP spricht.

[![Website](https://img.shields.io/badge/website-bastra.io-2563eb)](https://bastra.io)
[![Discord](https://img.shields.io/badge/Discord-join%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/5yNaXsRhWB)
[![License: MIT](https://img.shields.io/github/license/n0mad-ai/bastra-recall?color=blue)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/n0mad-ai/bastra-recall?style=flat&color=yellow)](https://github.com/n0mad-ai/bastra-recall/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/n0mad-ai/bastra-recall)](https://github.com/n0mad-ai/bastra-recall/issues)
[![Last commit](https://img.shields.io/github/last-commit/n0mad-ai/bastra-recall)](https://github.com/n0mad-ai/bastra-recall/commits/main)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-orange)](https://modelcontextprotocol.io/)
[![Sponsor](https://img.shields.io/github/sponsors/n0mad-ai?label=sponsor&color=ea4aaa&logo=github)](https://github.com/sponsors/n0mad-ai)

---

## 🇬🇧 English

**What it is** — A long-term memory for your AI assistant. Whenever you correct it, state a rule, or commit to a decision, it gets saved as a small note. In your next chat — days or weeks later — the AI pulls those notes back automatically. No more repeating yourself. Everything stays on your own Mac as plain Markdown files (Obsidian-compatible), and every connected tool shares the same memory at the same time. Today that means **Claude Code and Claude Desktop, tested in daily use** — see the support matrix below for what's wired and what's next.

**Status** — 🟢 Early beta, `v0.8.x`. The v0.9 milestone (self-improving recall) is in progress; the V1.0 release contract — a reproducibly measured, selective, controllable recall base — is fully specified. See [PLAN.md](./PLAN.md).

### Supported surfaces

| Surface | Status | Notes |
|---|---|---|
| **Claude Code** | ✅ tested — in daily use | MCP + Skill + seven quiet hooks + statusline |
| **Claude Desktop** | ✅ tested | MCP + Skill, autonomous session context without hooks; `.mcpb` double-click extension |
| **Cursor** | 🟡 implemented | installs and registers cleanly; not yet verified in daily use — targeted testing planned for v1.0 |
| **ChatGPT** (Custom GPT Actions) | 🗺️ planned | the REST gateway and an OpenAPI starter spec ship today; the packaged Custom-GPT action is next in line — tracked in [#13](https://github.com/n0mad-ai/bastra-recall/issues/13) |
| **Codex CLI** | 🗺️ planned | lands via the same MCP forwarder — adapter tracked in [#15](https://github.com/n0mad-ai/bastra-recall/issues/15) |

Anything else that speaks MCP can attach through the forwarder today — untested surfaces are exactly that, and field reports are welcome. Non-MCP clients can use the REST API (`docs/USAGE.md`).

### Why

Working with an AI assistant over months means re-explaining the same things. Pitfalls it already learned in one project recur in the next. Stable preferences (*"give me a recommendation, not a 5-option menu"*) get forgotten between sessions. Project-specific facts get re-discovered every time.

Most AI tools have memory features, but they're **passive**: a static index file at best, no proactive recall, no cross-surface continuity.

The cost isn't just frustration — it's that the user ends up thinking *for* the AI. *"Wait, didn't we solve this last week?"* That's the bug.

### What bastra-recall does

A persistent memory layer that:

- **Saves autonomously** — when a lesson is learned (frustration, repeated correction, durable preference, finalized decision), the AI writes it to the vault without being asked. Trigger discipline ships as a Claude Code Skill; other clients are conditioned through their own rules layer.
- **Recalls before acting** — not only when the user prompts. The AI is instructed to query the vault before writing code, before plans, and at session start. The highest-weighted search field is `recall_when`, declared at save time.
- **Works across surfaces** — one local daemon serves all your connected AI tools at once, over MCP or HTTP. One vault, one index, shared state (see the support matrix above).
- **Plain markdown, Obsidian-compatible** — the vault is a folder of `.md` files with YAML frontmatter. Edit in Obsidian, in the AI, or by hand. Vaults on Google Drive / iCloud / Dropbox mounts are supported via automatic polling-mode in the file watcher.

<p align="center">
  <img src="./assets/memory-save-ack.png" alt="An autonomous save confirmation in the terminal: → saved: … (salience 0.85)" width="100%" />
  <br/>
  <sub><em>An autonomous save: the AI spots a recurring pattern (here the third occurrence), records the lesson itself and weights it by salience — you just see the one-line confirmation, no prompting needed.</em></sub>
</p>

### The single success metric

> **The user doesn't have to think for the AI anymore.**

If recurring mistakes still recur, if the user still has to re-state preferences each session — the project failed, regardless of how clean the architecture is.

### How it works

```mermaid
flowchart TB
    CC["Claude Code"]
    CD["Claude Desktop"]
    CU["Cursor"]
    WEB["REST clients<br/>(web apps, scripts)"]

    CC -->|stdio MCP| FWD["MCP forwarder<br/>stdio to HTTP"]
    CD -->|stdio MCP| FWD
    CU -->|stdio MCP| FWD
    WEB -->|"REST /api/v1 + token"| D
    CC -.->|"hooks: recall before edits,<br/>context at session start"| D

    FWD --> D["bastra-recall daemon<br/>127.0.0.1:6723<br/>one process for every client"]
    D --> IDX["BM25 index<br/>+ optional embeddings"]
    IDX --> V[("Your vault<br/>plain markdown + YAML<br/>on your disk")]

    D -.->|"save_memory writes a file,<br/>then re-indexes it"| V
```

Everything above runs on your machine. Nothing leaves it unless you point a tunnel at the REST gateway yourself. Recall is hybrid — an in-memory BM25 index (with `recall_when` weighted highest) plus an optional local embedding pass, fused via RRF. In Claude Code, seven quiet hooks recall before edits, at session start, before plans, before a claim about measured project state goes into text someone else reads, and after failed commands.

Details: [docs/architecture.md](./docs/architecture.md) · [docs/hooks.md](./docs/hooks.md) · [docs/triggers.md](./docs/triggers.md) · [docs/USAGE.md](./docs/USAGE.md).

### Memory shape

Each memory is a markdown file with structured frontmatter:

```yaml
---
id: css-input-focus-ring-stacking
title: "Don't stack focus styles on inputs"
type: lesson
summary: "Stacking ring + outline + custom :focus on nested inputs causes double focus rings. Use single :focus-visible."
topic_path: [css, input, focus]
tags: [css, input, focus-ring, ui-bug]
scope: all-projects
recall_when:
  - creating new input component
  - writing input or form css
  - focus or accessibility styling
related: [css-effects-stacking-antipattern]
source: "carnexus, recurring lesson"
confidence: 0.95
---
```

The `recall_when` field is the bridge between save and recall: when saving, the AI declares the contexts under which future sessions should be reminded. Full field semantics and examples: [docs/memory-schema.md](./docs/memory-schema.md).

### Install

#### A) One double-click — easiest, for non-coders

1. Download **Install Bastra.command** from the [latest GitHub release](https://github.com/n0mad-ai/bastra-recall/releases/latest).
2. Double-click it in Finder.
3. Done. Restart Claude Code / Claude Desktop / Cursor.

The script installs Homebrew if it's missing, adds the bastra tap, installs `bastra-recall`, and hands over to the guided setup — no terminal knowledge required. Leaving is one double-click too: **Uninstall Bastra.command** unregisters every client and stops the daemon, never deleting a memory.

#### B) One command — for developers

```bash
npx bastra-recall install           # zero-install: guided setup with selection lists
# or:
npm install -g bastra-recall && bastra install
# or from source (Node 22+, Git):
git clone https://github.com/n0mad-ai/bastra-recall.git && cd bastra-recall
npm install && npm run build
node packages/daemon/dist/cli.js install all --vault /abs/path/to/your/vault
```

`bastra doctor` checks (and `--fix` repairs) every registration. Every config write is idempotent, atomic, backed up, and parse-safe — details in [docs/USAGE.md](./docs/USAGE.md).

#### C) Fully manual — fallback

Add the MCP forwarder block to your client's config by hand: [docs/USAGE.md](./docs/USAGE.md#fully-manual-install--fallback).

### Semantic recall (optional)

BM25 keyword search is the always-on default; a local embedding pass joins in once a provider is set up — one command, fully reversible:

```bash
bastra embeddings on       # installs Ollama (if missing), pulls the model, persists the choice
bastra embeddings off      # back to BM25 keyword-only — nothing breaks
```

Details and system requirements: **[System Requirements](https://github.com/n0mad-ai/bastra-recall/wiki/System-Requirements)** (wiki).

### Everything else, in one place

- **Cookbook — a working week with a memory:** [docs/USAGE.md](./docs/USAGE.md#cookbook)
- **Valence & reflex** — memories with emotional charge that age slower and can self-inject on hard trigger matches: [wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Valence-and-Reflex)
- **Self-learning taxonomy** — the vault grows its own folder conventions: [docs/taxonomy.md](./docs/taxonomy.md)
- **Vault map** — your vault as a navigable universe, with live mode and a local search copilot: [wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Vault-Map)
- **Bastra Commons (beta)** — a community vault of verified engineering recipes as a second, read-only recall source: [wiki](../../wiki/Bastra-Commons)
- **Product docs** — living user-facing documentation per project, updated by the agent: [wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Product-Docs)
- **Claude Desktop autonomy** — memory without hooks, via server instructions + first-call session context: [wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Claude-Desktop)
- **Onboarding & import** — five-minute warm start, and `bastra import` for ChatGPT/Claude/Gemini exports, rules files, and whole memory folders: [docs/USAGE.md](./docs/USAGE.md#importing-memories--skip-the-cold-start)
- **Vault care** — flag stale memories on the map, groom them with your next session: [docs/USAGE.md](./docs/USAGE.md#vault-care--flag-it-now-groom-it-later)
- **Updating** — `bastra update`, or hands-off with `update.mode auto`: [wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Updating)
- **Cursor rules, shell completion, feedback:** [docs/USAGE.md](./docs/USAGE.md)
- **REST API** for non-MCP clients (token, CORS, tunnel setup): [docs/USAGE.md](./docs/USAGE.md#rest-api-for-non-mcp-clients) · [docs/openapi.yaml](./docs/openapi.yaml)
- **Troubleshooting:** [docs/USAGE.md](./docs/USAGE.md#troubleshooting)

### Roadmap

- **Shipped:** daemon + hybrid read path, autonomous save path, the seven-hook Claude Code reflex layer, npm + Homebrew + `.command` distribution, Claude Desktop autonomy.
- **In progress — v0.9 "Self-improving recall":** usage-driven lifecycle, update safety (local patches survive `bastra update`), hardening from contributor field reports.
- **Next — V1.0 release contract:** a reproducibly measured, selective, controllable recall base — honest eval baselines, deterministic relevance evidence with real abstention, a project-aware session assembler, a global context budget. The long-term V2 target (adaptive, multi-layer memory) is specified and strictly measurement-gated.

Full picture: [PLAN.md](./PLAN.md). Out of v0: multi-device sync — today the vault folder syncs at OS level (iCloud / Google Drive / Dropbox / Git); the file watcher's polling mode handles the latency.

### Bastra Mac App

A native macOS app is being built on top of bastra-recall — same vault, same daemon, just a graphical interface for people who don't want to live in the terminal. In development.

### License

MIT — see [LICENSE](./LICENSE).

Public docs and code on this branch are published under the open license; private notes (in `private/`, gitignored) are not. The statusline (`packages/statusline/`) bundles [owloops/claude-powerline](https://github.com/owloops/claude-powerline) (MIT, © 2025 Owloops) as its rendering engine; the upstream license is retained in [`packages/statusline/LICENSE`](./packages/statusline/LICENSE).

### Status & contact

Early beta. Issues and discussions welcome — early feedback shapes the design. Please report security issues privately via [SECURITY.md](./SECURITY.md).

Built by [@n0mad-ai](https://github.com/n0mad-ai).

---

## 🇩🇪 Deutsch

**Was es ist** — Ein Langzeit-Gedächtnis für deinen AI-Assistenten. Sobald du etwas korrigierst, eine Regel aufstellst oder eine Entscheidung triffst, wird das als kleine Notiz gespeichert. In der nächsten Sitzung — Tage oder Wochen später — holt die AI diese Notizen automatisch wieder hervor. Schluss mit ewigem Wiederholen. Alles bleibt lokal auf deinem Mac als reine Markdown-Dateien (Obsidian-kompatibel), und alle verbundenen Tools teilen sich dasselbe Gedächtnis gleichzeitig. Heute heißt das: **Claude Code und Claude Desktop, im Alltag getestet** — was verdrahtet ist und was als Nächstes kommt, zeigt die Support-Matrix.

**Status** — 🟢 Frühe Beta, `v0.8.x`. Der v0.9-Milestone (self-improving recall) läuft; der V1.0-Releasevertrag — eine reproduzierbar gemessene, selektive, kontrollierbare Recall-Basis — ist vollständig spezifiziert. Siehe [PLAN.md](./PLAN.md).

### Unterstützte Oberflächen

| Surface | Status | Notizen |
|---|---|---|
| **Claude Code** | ✅ getestet — im täglichen Einsatz | MCP + Skill + sieben ruhige Hooks + Statusline |
| **Claude Desktop** | ✅ getestet | MCP + Skill, autonomer Session-Kontext ohne Hooks; `.mcpb`-Doppelklick-Extension |
| **Cursor** | 🟡 implementiert | installiert und registriert sauber; noch nicht im Alltag verifiziert — gezielter Test ab v1.0 geplant |
| **ChatGPT** (Custom GPT Actions) | 🗺️ geplant | REST-Gateway und OpenAPI-Starter-Spec sind da; die verpackte Custom-GPT-Action ist als Nächstes dran — verfolgt in [#13](https://github.com/n0mad-ai/bastra-recall/issues/13) |
| **Codex CLI** | 🗺️ geplant | kommt über denselben MCP-Forwarder — Adapter verfolgt in [#15](https://github.com/n0mad-ai/bastra-recall/issues/15) |

Alles andere, was MCP spricht, kann sich heute über den Forwarder verbinden — ungetestete Oberflächen sind genau das, und Erfahrungsberichte sind willkommen. Nicht-MCP-Clients nutzen die REST-API (`docs/USAGE.md`).

### Warum

Wenn du Monate mit einem AI-Assistenten arbeitest, erklärst du dieselben Dinge immer wieder. Stolperfallen, die er in einem Projekt schon mal gelernt hat, kommen im nächsten zurück. Stabile Vorlieben (*"gib mir eine Empfehlung, kein 5-Optionen-Menü"*) sind zwischen Sitzungen vergessen. Projekt-spezifische Fakten werden jedes Mal neu entdeckt.

Die meisten AI-Tools haben zwar Memory-Features, aber die sind **passiv**: bestenfalls eine statische Index-Datei, kein proaktives Erinnern, keine Kontinuität über verschiedene Oberflächen hinweg.

Der Preis ist nicht nur Frust — sondern dass am Ende der User für die AI mitdenkt. *"Moment, das hatten wir doch letzte Woche schon gelöst?"* Genau das ist der Bug.

### Was bastra-recall macht

Eine persistente Gedächtnis-Schicht, die:

- **Autonom speichert** — wenn etwas gelernt wird (Frust, wiederholte Korrektur, dauerhafte Vorliebe, finale Entscheidung), schreibt die AI das ungefragt in den Vault. Die Trigger-Disziplin wird als Claude Code Skill ausgeliefert; andere Clients werden über ihre eigene Rules-Schicht konditioniert.
- **Vor dem Handeln erinnert** — nicht erst auf User-Anfrage. Die AI wird angewiesen, den Vault vor dem Code-Schreiben, vor Plänen und beim Sitzungsstart abzufragen. Das höchstgewichtete Suchfeld ist `recall_when`, das beim Speichern deklariert wird.
- **Über Oberflächen hinweg funktioniert** — ein lokaler Daemon bedient alle verbundenen AI-Tools gleichzeitig, über MCP oder HTTP. Ein Vault, ein Index, geteilter Zustand (siehe Support-Matrix oben).
- **Reines Markdown, Obsidian-kompatibel** — der Vault ist ein Ordner mit `.md`-Dateien und YAML-Frontmatter. Bearbeitbar in Obsidian, durch die AI oder per Hand. Vaults auf Google Drive / iCloud / Dropbox werden über den automatischen Polling-Modus des File-Watchers unterstützt.

<p align="center">
  <img src="./assets/memory-save-ack.png" alt="Autonome Save-Bestätigung im Terminal: → saved: … (salience 0.85)" width="100%" />
  <br/>
  <sub><em>Ein autonomer Save: die AI erkennt ein wiederkehrendes Muster (hier der dritte Vorfall), hält die Lesson selbst fest und gewichtet sie per Salience — du siehst nur die einzeilige Bestätigung, ganz ohne Nachfragen.</em></sub>
</p>

### Der einzige Erfolgs-Maßstab

> **Der User muss nicht mehr für die AI mitdenken.**

Wenn wiederkehrende Fehler weiter auftreten, wenn der User in jeder Sitzung dieselben Vorlieben wiederholen muss — dann ist das Projekt gescheitert, egal wie sauber die Architektur ist.

### Wie es funktioniert

```mermaid
flowchart TB
    CC["Claude Code"]
    CD["Claude Desktop"]
    CU["Cursor"]
    WEB["REST-Clients<br/>(Web-Apps, Skripte)"]

    CC -->|stdio MCP| FWD["MCP-Forwarder<br/>stdio zu HTTP"]
    CD -->|stdio MCP| FWD
    CU -->|stdio MCP| FWD
    WEB -->|"REST /api/v1 + Token"| D
    CC -.->|"Hooks: Recall vor Edits,<br/>Kontext beim Session-Start"| D

    FWD --> D["bastra-recall-Daemon<br/>127.0.0.1:6723<br/>ein Prozess für alle Clients"]
    D --> IDX["BM25-Index<br/>+ optionale Embeddings"]
    IDX --> V[("Dein Vault<br/>reines Markdown + YAML<br/>auf deiner Platte")]

    D -.->|"save_memory schreibt eine Datei<br/>und indiziert sie neu"| V
```

Alles davon läuft auf deiner Maschine. Nichts verlässt sie, solange du nicht selbst einen Tunnel auf das REST-Gateway legst. Recall ist hybrid — ein In-Memory-BM25-Index (mit `recall_when` als höchstgewichtetem Feld) plus ein optionaler lokaler Embedding-Pass, fusioniert via RRF. In Claude Code erinnern sieben ruhige Hooks vor Edits, beim Session-Start, vor Plänen, bevor eine Aussage über gemessenen Projektzustand in Text geht, den jemand anderes liest, und nach fehlgeschlagenen Commands.

Details: [docs/architecture.md](./docs/architecture.md) · [docs/hooks.md](./docs/hooks.md) · [docs/triggers.md](./docs/triggers.md) · [docs/USAGE.md](./docs/USAGE.md).

### Aufbau einer Memory

Jede Memory ist eine Markdown-Datei mit strukturiertem Frontmatter:

```yaml
---
id: css-input-focus-ring-stacking
title: "Don't stack focus styles on inputs"
type: lesson
summary: "Stacking ring + outline + custom :focus on nested inputs causes double focus rings. Use single :focus-visible."
topic_path: [css, input, focus]
tags: [css, input, focus-ring, ui-bug]
scope: all-projects
recall_when:
  - creating new input component
  - writing input or form css
  - focus or accessibility styling
related: [css-effects-stacking-antipattern]
source: "carnexus, recurring lesson"
confidence: 0.95
---
```

Das `recall_when`-Feld ist die Brücke zwischen Save und Recall: beim Speichern deklariert die AI die Kontexte, in denen die spätere Sitzung daran erinnert werden soll. Vollständige Feld-Semantik und Beispiele: [docs/memory-schema.md](./docs/memory-schema.md).

### Installation

#### A) Ein Doppelklick — am einfachsten, für Nicht-Coder

1. Lade **Install Bastra.command** aus dem [aktuellen GitHub-Release](https://github.com/n0mad-ai/bastra-recall/releases/latest).
2. Doppelklick im Finder.
3. Fertig. Claude Code / Claude Desktop / Cursor neu starten.

Das Skript installiert bei Bedarf Homebrew, fügt den bastra-Tap hinzu, installiert `bastra-recall` und startet das geführte Setup — kein Terminal-Wissen nötig. Der Weg hinaus ist genauso kurz: **Uninstall Bastra.command** meldet Bastra bei allen Clients ab und stoppt den Daemon — ohne je eine Memory zu löschen.

#### B) Ein Befehl — für Entwickler

```bash
npx bastra-recall install           # ohne Installation: geführtes Setup mit Auswahllisten
# oder:
npm install -g bastra-recall && bastra install
# oder aus dem Quellcode (Node 22+, Git):
git clone https://github.com/n0mad-ai/bastra-recall.git && cd bastra-recall
npm install && npm run build
node packages/daemon/dist/cli.js install all --vault /abs/pfad/zu/deinem/vault
```

`bastra doctor` prüft (und `--fix` repariert) jede Registrierung. Jeder Config-Write ist idempotent, atomar, gesichert und parse-safe — Details in [docs/USAGE.md](./docs/USAGE.md).

#### C) Komplett manuell — Fallback

Den MCP-Forwarder-Block von Hand in die Client-Config eintragen: [docs/USAGE.md](./docs/USAGE.md#komplett-manuelle-installation--fallback).

### Semantischer Recall (optional)

BM25-Stichwortsuche ist der immer aktive Default; ein lokaler Embedding-Pass kommt dazu, sobald ein Provider eingerichtet ist — ein Befehl, jederzeit umkehrbar:

```bash
bastra embeddings on       # installiert Ollama (falls nötig), zieht das Modell, persistiert die Wahl
bastra embeddings off      # zurück zu reiner BM25-Stichwortsuche — nichts bricht
```

Details und Systemvoraussetzungen: **[System Requirements](https://github.com/n0mad-ai/bastra-recall/wiki/System-Requirements)** (Wiki).

### Alles Weitere, an einem Ort

- **Kochbuch — eine Arbeitswoche mit Gedächtnis:** [docs/USAGE.md](./docs/USAGE.md#kochbuch)
- **Valenz & Reflex** — Memories mit emotionaler Ladung, die langsamer altern und sich bei hartem Trigger-Match selbst injizieren: [Wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Valence-and-Reflex)
- **Selbstlernende Taxonomie** — der Vault baut sich seine Ordner-Konventionen selbst: [docs/taxonomy.md](./docs/taxonomy.md)
- **Vault-Map** — dein Vault als navigierbares Universum, mit Live-Modus und lokalem Search-Copiloten: [Wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Vault-Map)
- **Bastra Commons (Beta)** — ein Community-Vault verifizierter Engineering-Rezepte als zweite, schreibgeschützte Recall-Quelle: [Wiki](../../wiki/Bastra-Commons)
- **Produkt-Doku** — lebende User-facing-Dokumentation pro Projekt, vom Agenten gepflegt: [Wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Product-Docs)
- **Claude-Desktop-Autonomie** — Gedächtnis ohne Hooks, über Server-Instructions + First-Call-Session-Kontext: [Wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Claude-Desktop)
- **Onboarding & Import** — Warmstart in fünf Minuten, und `bastra import` für ChatGPT-/Claude-/Gemini-Exporte, Rules-Dateien und ganze Memory-Ordner: [docs/USAGE.md](./docs/USAGE.md#memories-importieren--den-kaltstart-überspringen)
- **Vault-Pflege** — veraltete Memories auf der Map markieren, mit der nächsten Session aufräumen: [docs/USAGE.md](./docs/USAGE.md#vault-pflege--jetzt-markieren-später-aufräumen)
- **Updates** — `bastra update`, oder freihändig mit `update.mode auto`: [Wiki](https://github.com/n0mad-ai/bastra-recall/wiki/Updating)
- **Cursor-Rules, Shell-Completion, Feedback:** [docs/USAGE.md](./docs/USAGE.md)
- **REST API** für Nicht-MCP-Clients (Token, CORS, Tunnel-Setup): [docs/USAGE.md](./docs/USAGE.md#rest-api-für-nicht-mcp-clients) · [docs/openapi.yaml](./docs/openapi.yaml)
- **Fehlerbehebung:** [docs/USAGE.md](./docs/USAGE.md#fehlerbehebung)

### Roadmap

- **Ausgeliefert:** Daemon + hybrider Read-Path, autonomer Save-Path, der Sieben-Hook-Reflex-Layer für Claude Code, npm- + Homebrew- + `.command`-Distribution, Claude-Desktop-Autonomie.
- **In Arbeit — v0.9 „Self-improving recall":** nutzungsgetriebener Lifecycle, Update-Sicherheit (lokale Patches überleben `bastra update`), Härtung aus Contributor-Field-Reports.
- **Als Nächstes — V1.0-Releasevertrag:** eine reproduzierbar gemessene, selektive, kontrollierbare Recall-Basis — ehrliche Eval-Baselines, deterministische Relevanzevidenz mit echter Abstention, ein projektfähiger Session-Assembler, ein globales Kontextbudget. Das langfristige V2-Ziel (adaptives, mehrschichtiges Gedächtnis) ist spezifiziert und strikt messungs-gegated.

Das ganze Bild: [PLAN.md](./PLAN.md). Außerhalb von v0: Multi-Device-Sync — heute synchronisiert der Vault-Ordner auf OS-Ebene (iCloud / Google Drive / Dropbox / Git); der Polling-Modus des File-Watchers gleicht die Latenz aus.

### Bastra Mac App

Eine native macOS-App entsteht auf Basis von bastra-recall — selber Vault, selber Daemon, nur mit grafischer Oberfläche für Leute, die nicht im Terminal leben wollen. In Entwicklung.

### Lizenz

MIT — siehe [LICENSE](./LICENSE).

Public Docs und Code auf diesem Branch laufen unter der Open License; private Notizen (in `private/`, gitignored) nicht. Die Statusline (`packages/statusline/`) nutzt [owloops/claude-powerline](https://github.com/owloops/claude-powerline) (MIT, © 2025 Owloops) als Rendering-Engine; die Upstream-Lizenz liegt unverändert in [`packages/statusline/LICENSE`](./packages/statusline/LICENSE).

### Status & Kontakt

Frühe Beta. Issues und Diskussionen willkommen — frühes Feedback formt das Design. Sicherheitsprobleme bitte vertraulich über [SECURITY.md](./SECURITY.md) melden.

Gebaut von [@n0mad-ai](https://github.com/n0mad-ai).
