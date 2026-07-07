# Changelog

All notable changes to bastra-recall are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.7] — 2026-07-07

### Added
- **Guided-install wizard, expanded to 8 steps**: beyond vault / clients /
  semantic recall / text model, the wizard now offers the Claude Code **Stop
  hook** (default on), **Bastra Commons** (community recipe vault, read-only,
  default off), **shared learned-recall bridges** (default off, only when
  Commons is on), **auto-update mode**, and **product-doc capture** — each a
  cancellable selection with safe defaults.
- **`bastra models` command** (`status` / `recommend` / `set <tag>`): inspect
  or set the local generation (doc2query + rerank) text model, hardware-tiered
  by this machine's RAM (`cli/hardware.ts`); the choice persists to
  cli-settings.json so Windows/Linux installs carry it too.

### Changed
- **Stop save-eval hook is now registered by default** (live-validated #48; it
  has been silent since the file-relay redesign — suggestions go to
  `pending-suggestions.json`, read by the next session, no chat noise). Opt out
  with `--no-stop-hook`. A silent background auto-update never bolts it onto a
  user who hasn't opted in — only a real `bastra install` / the wizard does.
- **Text-model wizard step also reaches existing users**: when semantic recall
  already runs on Ollama but no generation model is pulled yet, the wizard
  offers to add one (skipped for OpenAI-embedding installs, where the daemon's
  expander never runs).
- **Bastra Commons repository is now public** — anonymous read-only clone, no
  GitHub login required.

### Fixed
- **Commons clone can no longer hang on a git login prompt**: clone/pull run
  with `GIT_TERMINAL_PROMPT=0`, so an unreachable/private repo fails fast and
  the wizard continues instead of blocking.
- **Wizard robustness**: the text-model download no longer runs after a failed
  semantic-recall setup; bridges are enabled only when the Commons clone
  actually succeeded.

## [0.7.6] — 2026-07-04

> Versioning note: from this release on, the `-beta.N` suffix is dropped — the
> leading `0.` (pre-1.0) already signals beta status per SemVer.

### Added
- **Prompt-injection capture scan (#147)**: incoming third-party content
  (document/OCR ingest, bridge captures, externally-sourced saves) is scanned
  for injection markers — instructions addressed to the AI, authority framing,
  hidden/encoded text, exfiltration asks. Findings **flag, never block**:
  `save_document` stamps `injection_flags` into the sidecar and surfaces an
  `injection_warning` in the tool result, `save_memory` gets a non-blocking
  `save_quality` advisory, and the vault-health report lists flagged captures
  as a review section. Zero recall-path cost — the scan runs on capture only.
- **Embedding circuit breaker (#165)**: after 3 consecutive provider failures,
  hybrid recall silently degrades to BM25-only for a 60s cooldown (no
  per-query timeout tax); a half-open probe re-closes on recovery. Resets on
  Ollama autostart; `/health` carries the breaker snapshot; degraded recalls
  are marked in telemetry (`embedding_degraded`).
- **Identifier-preserving search tokenization (#162)**: dotted/hyphenated/
  underscored identifiers (`my-app.config.ts`, `chat-send`, `P2.2`) now match
  as units on BOTH index and query side (dual emission keeps all previous
  matches working). Query hygiene: 8000-char hostile-input cap at word
  boundaries, dangling-operator strip; bridge expansion terms structurally
  survive the cap.
- **Hook empty-streak backoff (#161)**: hint sources whose injections go
  unconsumed widen their cadence per session (cap 8×); any load/acted_on
  resets. Safety carve-outs: the bash-tripwire STOP warning never backs off,
  REQUIRED-band hints (score ≥ 100) always emit, explicit retrieval prompts
  are exempt. Suppressed emissions are logged for net-context-ROI.
- **Stable npx runtime (#180)**: installs from an npx cache copy the runtime
  to `~/.bastra/runtime/<version>/` and register ALL paths (forwarder, hooks,
  statusline) from there — cache eviction no longer breaks registrations.
  Old versions are pruned; `doctor` warns about remaining `_npx` paths.
- **Obsidian-resolvable doc cross-links (#188)**: document sidecars carry
  their doc-id as an Obsidian alias, so the enricher's `[[doc-id]]` links
  resolve to the sidecar instead of creating empty stray notes on click.
  The schema coerces any hand-edited alias shape — a memory is never
  rejected over `aliases`.

### Fixed
- **`uninstall all` removes the shared skill (#181)**: a final sweep deletes
  `~/.claude/skills/bastra-recall/` when no skill-sharing registration
  remains (surfaces whose uninstall failed count as still registered).

## [0.7.0-beta.5] — 2026-07-04

### Added
- **Guided install wizard (#185)**: bare `bastra install` on a terminal runs
  a guided setup with selection lists — memory vault (create `~/BastraVault`
  or pick a folder), AI clients (multiselect, detected ones preselected),
  semantic recall (enable / keyword-only). Ctrl-C cancels cleanly without
  writing anything; all scripted flows (`install all`, `--yes`, `--dry-run`,
  non-TTY) are unchanged and `--ollama`/`--no-ollama` are honored.
- **Self-improving lifecycle, Wave C (#186)**:
  - *Usage sidecar (#154)* — durable per-memory aggregate of
    surfaced/loaded/acted_on under `<vault>/.bastra/usage/`; "surfaced"
    counts only hints the hooks actually injected (post-filter feedback via
    `POST /hook/hinted`).
  - *Staleness curator, phase A (#155)* — deterministic score-only demotion
    of memories that keep surfacing without engagement. Review-first pass,
    ≥30 days of usage data required, floored/doc/taxonomy memories protected,
    any real load reactivates; survival-by-id now CI-pinned for curator
    demotions too.
  - *Vault-health report (#156)* — each curator run projects `REPORT.md`
    into the vault: stale candidates with usage numbers, floors awaiting
    re-affirmation, same-topic clusters, dangling wikilinks, 0-byte files.
    Manual trigger: `POST /curator/run` (dry-run by default).
- **First-run vault offer (#178, #179)**: on a fresh machine an interactive
  `bastra install` asks once to create `~/BastraVault` instead of erroring
  per surface; non-TTY/`--yes`/`--dry-run` keep deterministic behavior
  (pure decision function, unit-tested).

### Fixed
- **Daemon-aware embeddings status (#177)**: `bastra embeddings status` and
  the install-end prompt respect a RUNNING daemon whose environment already
  enables semantic recall — no more contradictory OFF notes or re-prompts.
- **`brew trust` for the tap (#182, #183)**: `Install Bastra.command` trusts
  the third-party tap before installing (new Homebrew security gate).
- **Double-click installer prompts (#185)**: the install log pipe made
  stdout non-TTY and silently skipped every interactive prompt — the guided
  setup now runs on `/dev/tty`, with a fallback to `install all` on older
  CLI versions.

## [0.7.0-beta.4] — 2026-07-03

### Fixed
- **Stale version-string constants**: `scripts/bump.mjs` now rewrites the
  hardcoded version constants (CLI `VERSION`, daemon `DAEMON_VERSION`,
  forwarder serverInfo) and fails loudly on a pattern miss — `/health` no
  longer reports an old version after a release.
- Homebrew formula (tap repo): build the full workspace root and ship pruned
  production `node_modules` — fixes 67 TS build errors and the
  `ERR_MODULE_NOT_FOUND: @bastra-recall/core` crash from release tarballs
  (#184).

## [0.7.0-beta.3] — 2026-07-03

### Added
- **Floor/pin primitive (#141, #142)**: push-by-state memories with an
  opaque per-entry handle `{memory_id, condition, reason, last_affirmed,
  affirmed_by, why}`; keyed `release(condition)`; `affirm` is an explicit
  call requiring `affirmed_by` + a fresh `why` (no why → the clock does not
  move). Expired floors drop back to ranked — unpin ≠ remove. Exposed via
  loopback REST (`/api/v1/floors`) and injected as a pinned block with an
  audit line.
- **Discoverable semantic recall (#79)**: new `bastra embeddings
  <on|off|status>` command, a one-time install-end prompt, and a doctor note
  — turning the embedding layer on is a single line instead of an env dance.
- **Wave A ingest hygiene (#149–#152)**: central pre-ingest scrubber strips
  bastra's own injected context blocks before heuristics/doc2query; injected
  hint blocks are fenced as reference-only; anti-thrash save semantics
  (terminal success note + consecutive-failure cap); trivial-prompt gate
  skips hint injection for bare acks and slash commands.
- **Wider acted_on surface (#144)**: a lightweight act-signal on every
  completed Bash command closes open recall episodes without letting
  unrelated commands kill them (`closeOnMiss=false` on the high-frequency
  path).
- **Three-arm survival harness (#103)**: `lexical · hybrid · expanded` eval
  arms with a far-split — measured on a real vault: hybrid rescues far
  recall (+16.5pp); the residual gap is ranking, not demand.
- **Survival substrate invariant (#146)**: demote is score-only (file
  byte-identical), soft-delete is append-only trash + audit, both CI-pinned
  (`survival-by-id.test.ts`) and documented as a citable contract in
  `docs/survival.md`.

### Fixed
- **Strong cross-scope recall hints (#148)**: a hit passes the #110
  foreign-scope filter only when it matched its hand-written `recall_when`
  AND sits in the REQUIRED band — deliberate cross-project relevance gets
  through, tag/topic-overlap noise stays filtered.
- `save_memory` update without an explicit folder no longer relocates the
  memory.
- Security: js-yaml 3.14.2 → 3.15.0 (GHSA-h67p-54hq-rp68).

## [0.7.0-beta.2] — 2026-06-28

### Added
- **doc2query slug-filter + corpus prune (#145, #143)**: a structural
  `isSlugChain` gate (plus a sharpened write-time prompt) drops slug-chains
  (`panel-close-fix`) and hallucinated tag-strings from `recall_when_expanded`
  before they reach the BM25 index — a small local model emits them despite the
  prompt, and they poison recall with noise terms. The gate keeps real search
  tokens (`z-index`, `gpt-4`, and idioms like `left-to-right` via a function-word
  seam heuristic). The new `prune-slug-expansions` maintenance script applies the
  same gate to *existing* expansions (340 slug entries removed across the vault,
  the good paraphrases and the clean files left untouched), so the stored corpus
  matches what new writes get.
- **doc2query trigger expansion (#117)**: a local Ollama model paraphrases each
  memory's `title`/`summary`/`recall_when` into *different* words at write time
  and indexes them (new `recall_when_expanded` frontmatter field, BM25 weight 2
  vs `recall_when`'s 5), so a reworded ("far") query weeks later still fires on
  the lexical layer with zero query-time model cost. The new `TriggerExpander`
  runs in the background (on every embed + a one-shot backfill sweep over
  existing memories), keeps only paraphrases that retrieve their own memory in a
  semantic self-test, and is loop-guarded by a source hash. On by default when
  Ollama is the embedding provider; `BASTRA_TRIGGER_EXPAND=0` disables it,
  `BASTRA_EXPAND_MODEL` overrides the model, and `BASTRA_EXPAND_TIMEOUT_MS`
  (default 120000) sizes the generation timeout — doc2query generation is far
  slower than a rerank judgment, so it gets its own generous timeout and the
  background expansion is hardened so a chat timeout can never crash the daemon.
- **`bastra token clear` (#97)**: removes the stored REST API token (browser/REST
  clients are locked out on the next daemon restart). `bastra` (the status panel)
  and `bastra status` now show whether a token is set, without printing it.
- **Product docs (opt-in)**: living user-facing documentation per project in
  `dokumentationen/<project>/` — one markdown file per feature area, written
  update-in-place via the new `save_product_doc` MCP/REST tool (stable id
  `doku-<project>-<area>`). Two settings drive it: `docs.mode`
  (`off`|`suggest`|`auto`, default `off`) and `docs.language` (default `en`),
  via `bastra config set`, the new loopback `GET/POST /settings/docs` endpoint
  (for the Mac-app options pane), or the settings file. With mode set, the
  SessionStart hook injects the capture instruction (`suggest` proposes first,
  `auto` writes autonomously) and the stop hook's feature-completion suggestion
  reminds about the doc. `type: doc` hits are damped (×0.5) in default `recall`
  so doc bodies never crowd out lessons; `find_document` ranks them undamped.
  The `bastra` panel shows the docs mode.
- **Bastra Commons (beta)**: `bastra commons enable|update|disable|status`
  git-syncs a community vault of verified engineering recipes to
  `~/.bastra/commons` and the daemon loads it as a second, strictly read-only
  BM25 index. `recall` fuses Commons hits (`scope: commons`) slightly below
  personal memories; on id collisions the personal memory wins and
  `load_memory` falls back to Commons. Best-practice status in the Commons is
  earned through independent verification records, never declared — see the
  wiki page "Bastra Commons".
- **Commons verify loop**: `bastra commons verify <recipe-id> <works|fails>
  ["env note"]` writes an append-only verification record
  (`verifications/<recipe>/<verifier>.json`, one per user+solution, history
  via git) and submits it as a mini pull request. The daemon counts merged
  records on boot and feeds them into the fusion ranking
  (`commonsRankFactor`: independent works lift a recipe, fails sink it —
  capped both ways). `load_memory` of a commons recipe returns the evidence
  counts plus a `verify_hint`, so agents close the loop right where the
  recipe was applied.
- Energy-aware Ollama model lifecycle (#78, #109): the daemon prewarms the
  embedding model on boot, sends a per-request `keep_alive`
  (`BASTRA_OLLAMA_KEEP_ALIVE`, default `10m`) via the native `/api/embed`
  endpoint, and unloads the model from Ollama RAM after an embed-idle window
  (`BASTRA_OLLAMA_IDLE_UNLOAD_MS`, default 10 min) — instead of pinning it
  forever with `OLLAMA_KEEP_ALIVE=-1`. New `ollama_lifecycle` telemetry events
  plus a RAM-residency summary in `stats.ts`.
- Daemon boot now restarts a stopped local Ollama (probe-first, loopback-only,
  honours `ollama.autostart`) when semantic recall is configured — previously
  only `bastra install` could start it, so killing the Mac app silently
  dropped recall to BM25.

### Changed
- Stop hook redesigned to be silent (#48): save-eval suggestions are written
  to `~/.bastra/pending-suggestions.json` and injected as additionalContext by
  the next SessionStart (consume-once, 7-day expiry) instead of `systemMessage`
  — which Claude Code rendered 1:1 into the chat as an undecipherable flood.
  Injected transcript turns (skill body, system-reminders) no longer feed the
  heuristics (the self-trigger defect). Still opt-in via
  `bastra install --with-stop-hook`.
- Daemon self-update (#81): with `update.mode=auto` the daemon stages updates
  itself (shared once-per-day throttle with the SessionStart path) and
  re-checks every 6 h — covers Claude Desktop, which has no hook surface. A
  LaunchAgent-owned daemon restarts on ≥15 min idle after staging so the new
  code actually goes live (launchd respawns it).
- Honest v0.7 scoreboard: `recall_episode` carries a `surfaced` flag so direct
  loads without a preceding hint no longer pollute the `below_floor` USE-rate
  band (#77); `stats.ts` adds a net-context-ROI report (injected hint tokens
  vs. acted-on loads, plus top context-tax memories as archival candidates,
  #72) and splits the USE-rate by hint source — bash-tripwire vs. write/edit
  (#71). MCP `load_memory` calls now join the real Claude Code session/turn
  via forwarder headers (`x-bastra-cc-session`/`x-bastra-cc-turn`, stamped by
  the prompt-hook into the session feed), making the acted-on join accurate
  with multiple concurrent sessions on one daemon (#74).
- Claude Desktop reliability (#78): the MCP forwarder holds tool calls while
  the daemon boots (health timeout 10 s → 60 s) and respawns a dead daemon
  once instead of erroring; the daemon skips idle self-shutdown when a
  LaunchAgent owns its lifecycle.
- Recall-hint hygiene: the same memory now appears in `<recall-hints>` at most
  once per session by default (`BASTRA_HOOK_MAX_SHOW`, #106), and hints from
  foreign project scopes are hard-filtered in all score bands (#107, #110).
- `save_memory` quality advisory (#108): trigger-collision counting applies
  the recall noise floor instead of reporting the raw top-k for every trigger.
- Memory-storage conventions moved into the shipped skill
  (`packages/skill/SKILL.md`), so every MCP surface gets them instead of them
  living in one vault: **people** store as one canonical memo per person under
  `memories/people/` (`id: <handle>`, `type: project-fact`, tag `person`), with
  project content linking in via `[[<handle>]]`; **contributor conversations**
  are captured autonomously on two rails (identity → `people/`, content →
  `project-fact`); and the self-learning taxonomy now establishes cluster homes
  proactively from **conversation context** (e.g. a stack of scanned invoices →
  a `buchhaltung/` home), not only when a vault cluster recurs three times. A
  new `docs/commons.md` documents the Commons sharing model end to end (opt-in,
  default-off, PR-gated, scrubbed-bridges-only, no auto-egress).
- The shipped skill re-anchors the **RECALL-first reflex** above the grown
  capture/convention sections, so the agent reaches for the vault before acting
  instead of being pulled toward the save machinery first.

### Security
- CORS is deny-by-default (#95): with `BASTRA_CORS_ORIGIN` unset no browser
  origin is allowed; `*` is an explicit opt-in and warns when combined with a
  minted API token.
- `bastra update` spawns brew/npm via vetted absolute paths with hard
  timeouts; a spawn killed by signal/timeout no longer counts as success (#91).

### Fixed
- **Telemetry join-state across daemon boots**: the recall→action correlation
  state lived only in memory and reset on every daemon restart, skewing the
  `recall_episode`/USE-rate join. It now persists across boots, so the acted-on
  numbers are honest rather than truncated at each restart.
- **`save_memory` tool-schema skew (#132)**: the stdio forwarder shipped its own
  static copy of the tool definitions, so the schema a client was told came from
  the forwarder's build while validation happened at the daemon. A long-lived
  shared daemon running older code in RAM (it deliberately doesn't restart on a
  `dist` rebuild) could then validate against a schema that differed from what
  the client saw — surfacing as a required argument arriving `undefined`. The
  forwarder now fetches the schemas from the daemon via a new token-free
  loopback `GET /tools` endpoint (single source of truth: `ALL_TOOL_DEFS`), so
  the client schema always matches the validator. Falls back to the bundled
  defs when the daemon isn't reachable yet.
- Zombie `mcp-forwarder` processes from Claude Desktop's `disclaimer` wrapper
  are now reaped — the forwarder detects the dead grandparent, the daemon
  sweeps stale forwarders on boot (#80).
- `/health` and `bastra status` report `semantic_recall: "degraded"` (with the
  last provider error) when the embedding provider dies at runtime, instead of
  silently advertising semantic recall while serving BM25-only (#92).
- Statusline memory count now stays correct across sessions. The daemon
  publishes the live vault size to a shared file — refreshed on every index
  change plus a periodic disk reconcile — and the statusline segment reads it.
  Previously an idle session kept showing a stale count after another session
  (or an external write the file watcher missed) changed the vault, because the
  per-session feed only refreshed on that session's own tool calls.

## [0.6.5-beta.1] — 2026-06-01

### Added
- Auto-update (opt-in): a new `update.mode` setting (`notify` default / `auto` /
  `off`) stored in `~/.bastra/cli-settings.json`. In `auto`, a new Claude Code
  session stages an update in the background (file swap, no daemon restart),
  throttled to once per day — the running session is never disrupted and the new
  code goes live on the next daemon start.
- `bastra` with no arguments now prints a status panel: version, update status,
  daemon health, and live vault size.
- `bastra config get|set update.mode` to read or change the update mode.
- `bastra update --staged` — swaps files without restarting the daemon (used by
  the session-start auto-update).
- Live memory count: `Vault.reconcile()` and `GET /vault/count` reconcile the
  index against disk, so the status panel's count stays correct even when the
  cloud-storage file watcher misses external writes or deletes.
- Public `fixtures/sample-vault` smoke fixture so recall quality can be tested
  from a fresh clone without private data.
- Security policy, Dependabot config, dependency review, CodeQL, OpenSSF
  Scorecard, and manual npm publish workflow with provenance.
- OpenAPI starter spec for REST / ChatGPT Actions integrations.

### Changed
- Smoke tests now run against the public sample vault.
- npm packaging is hardened for public workspaces and packaged Skill assets.
- Homebrew formula builds the full monorepo so daemon hooks and statusline are
  installed together.
- Claude Code Stop save-eval hook is opt-in (`--with-stop-hook`) because its
  multi-line suggestions can add terminal noise.

### Fixed
- Lockfile: restored the `@esbuild/*` platform-binary entries that a prior
  `npm update` had dropped. Without them `npm ci` (and the tsx test runner)
  failed on a clean install on the affected platform.

## [0.6.0-beta.1] — 2026-05-29

First public (pre-release) build. `0.x` signals the API may still change;
the `-beta` tag means it's feature-complete enough to use but may have rough
edges. Dogfooded daily against a real vault.

### Core
- **Memory vault** over plain markdown files with YAML frontmatter — your
  data stays as readable files you own.
- **Hybrid recall** — BM25 keyword search fused with optional embeddings
  (Ollama or OpenAI), with staleness ranking and a query cache.
- **Lean-by-default `recall`/`load_memory`** — `recall` returns slim
  candidates; `load_memory` fetches full content only for what you need
  (`verbosity:"full"` opts back in). ~32% smaller recall payloads.
- **`save_memory`** with typed entries (lesson, preference, decision,
  project-fact, …) and auto-related wikilink enrichment.
- **Documents** — `find_document` / `read_document` over PDFs, scans, notes.

### Daemon
- Single shared daemon (MCP over stdio + HTTP REST), spawned on demand by a
  forwarder so every AI client shares one vault/index — no N-copies sync bug.
- **Idle self-shutdown** (default 30 min, env-tunable) — keeps the process
  table clean; respawns on the next recall.
- Background update-check against GitHub releases.

### Reflex layer (hooks)
- SessionStart + PreToolUse hooks surface relevant memories automatically,
  before you write code or start a session.

### CLI & distribution
- `bastra install | uninstall | doctor | update` across Claude Code,
  Claude Desktop, and Cursor.
- Homebrew formula (head build) + double-click installer.

### Statusline
- Optional powerline-style statusline with a native `bastra` segment
  (live recall stats + vault size).

### Tooling
- CI (GitHub Actions): `npm ci` → build → type-check → test on a Node 20/22
  matrix, on every push and PR.

[0.7.7]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.7
[0.7.6]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.6
[0.7.0-beta.5]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.0-beta.5
[0.7.0-beta.4]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.0-beta.4
[0.7.0-beta.3]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.0-beta.3
[0.6.0-beta.1]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.6.0-beta.1
