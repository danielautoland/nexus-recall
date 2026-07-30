# Changelog

All notable changes to bastra-recall are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.8] — 2026-07-28

### Fixed

- **Concurrent `saveMemory` calls no longer overwrite the writer that won the
  id first** (#285, #245 follow-up). They now commit under a per-target
  exclusive claim, compare the exact preimage again at commit time, and publish
  a new file without replacement. Callers that prove ownership first can pass
  that raw preimage as `expectedTarget`, so the proof and the write are one
  compare-and-swap operation; import does this for both notes and its synthetic
  index. A losing writer gets the stable `BASTRA_WRITE_CONFLICT` error and can
  retry from the current file instead of silently replacing it. A claim whose
  owner died mid-commit is reclaimed rather than blocking the id forever: it
  records the writing process and machine, and a later writer takes it once the
  owner is provably gone or the claim has aged past its window.

- **The hooks were losing one recall in sixteen, silently.** The budget that
  cuts a hook off if the daemon is slow sat at 250 ms — just under what a real
  recall costs. Measured over 30 days of actual use: 12,966 calls before an
  edit, median 60 ms, but a 90th percentile of 225 ms and 806 timeouts. Every
  one of those was an edit that should have been warned about a stored
  decision and wasn't, with nothing in the interface to show it. The ceiling is
  now 600 ms, which the same measurement puts at 65 % headroom. It costs
  nothing when the daemon is quick — a timeout is a ceiling, not a wait. (#252)

### Added

- **`bastra logs --stats` — the hook lanes, read out.** The event log already
  recorded which trigger fired, whether the daemon answered in time and whether
  anything came back; it just took a grep and a hand-written script to see it.
  One command now aggregates it per lane: how often each fired, how often it
  surfaced something, and where the latency sits against the budget. It found
  the timeout loss above on its first run — an average over all events had
  hidden it, because the lane that never recalls is fast and drags the mean
  down. (#279, first slice)

- **An update no longer replaces your local changes without saying so.** If you
  patched something in the installed package — as happened here for days while a
  locale fix waited to be merged — `bastra update` used to overwrite it silently,
  and the automatic update did it unattended. It now takes a fingerprint of the
  installation, notices what you changed, **copies those files aside before
  anything is replaced**, and asks before continuing. The automatic update
  refuses outright and leaves a note the next session shows you, rather than
  deciding for you. Reapplying your changes afterwards is a separate step, still
  to come. (#268)
- **Updates check where the package came from.** Every release is published
  through a protected workflow that signs it. Before installing, that signature
  is now verified. Deliberately narrow: only a genuinely bad signature blocks —
  an unreachable registry, an offline machine or an npm too old for the check
  are reported and let through, because a verifier that cannot run must not
  become the reason nobody can update. (#226)
- **The status panel shows both versions when they drift apart.** CLI and daemon
  can be on different versions after a partial update; until now one of them was
  quietly displayed as if it were both. `bastra doctor` says so too. (#225)
- **A dormant Ollama gets mentioned instead of ignored.** If semantic recall is
  off but a local Ollama is running, the panel now tells you it could be turned
  on. (#224)
- **Recall now also fires before a claim, not just before an edit.** The hook
  that reaches the assistant was bound to file edits — but writing a sentence
  edits nothing, so a draft reply, a changelog entry or an answer about "what
  we measured" came straight out of model memory while the vault held the
  number. That happened twice in one week here, once publicly. Asking for
  outbound text or for the project's measured state now recalls first, and the
  assistant is told to write that it doesn't know rather than guess when the
  vault has no answer. Deliberately narrow: two signals are needed, so "write
  a helper" still fires nothing. (#252)
- **The skill installs as a directory.** Both install paths — `bastra install`
  and `packages/skill/install.sh` — carried exactly one file, so any reference
  file next to `SKILL.md` would have been a dangling pointer. They now carry
  the whole skill, and the copy that ships inside the npm package is
  regenerated on every build instead of by hand (it had drifted three edits
  behind). Prerequisite for splitting the skill. (#232)
- **The skill got half its size back.** Its instructions had grown to the point
  where a third of them repeated what the tool descriptions already say on
  every turn — and every duplicated rule dilutes compliance with all the
  others. The core is now triggers only, half as long, and the mechanics live
  where they are read: in the tool descriptions, at the point of use. Four
  subsystems that fire on a minority of turns — project topology, establishing
  a convention, adopting imported memories, Commons — moved into reference
  files the assistant opens when their moment arrives, and each gate now names
  its own file so the pointer arrives with the signal instead of sitting in
  context all day. (#232)

### Fixed

- **The file-size hint stops scolding throwaway files.** A sandbox or lab
  directory is where oversized files are the point; the hint now stays quiet
  there and keeps working everywhere else. (#280)
- **Three things the code did but the docs never said.** From a field report on
  a mixed Russian/English vault: the bridge layer is latin-alphabet only, so a
  non-latin vault gets ordinary recall but no vocabulary expansion; reflex
  `recall_when` phrases must match *every* content word, which makes a
  sentence-length trigger a dead one, and the stopword list that softens that
  is German and English only; and the event log lives at `~/.bastra/logs/`,
  not inside the vault. Docs only — nothing behaved differently. (#257)

### Added

- **A memory can carry a command that proves it.** Notes that state facts about
  the world — "the daemon listens on 6723", "that file exists" — go stale
  quietly, and then keep being recalled as if they were still true. You can now
  attach a short command to such a memory (`verify_cmd`), and whoever loads it
  later sees it with a note: check this before relying on the claim. **Nothing
  runs it automatically** — not the daemon, not the background pass, nothing.
  It is shown, and the session decides under its own permission rules, because
  the command lives in your vault and is yours to judge. Turning a failed check
  into an actual staleness signal is a later step that needs its own security
  round. Shape borrowed from zzallirog's ida-box. (#235)

### Added

- **Recall can now say "this isn't in your vault at all".** There is a
  difference between finding the wrong note and finding nothing — and until now
  the daemon could not tell you which had happened, because on the hybrid search
  path a top result always looks confident. The new `no_home` signal fires when
  the best hit exists in only one of the two search arms, which is the shape an
  absent fact takes. It is deliberately narrower than `weak_result`: a wrong-but-
  real match still looks like a match, and pretending otherwise would make the
  signal lie. Both are recorded locally now, so "how often does my vault come up
  empty?" becomes a question with an answer. Found by zzallirog while
  dogfooding. (#230)

### Fixed

- **The hints your agent gets on every edit stop calling noise a strong match.**
  When you edit a file, bastra injects a few memories it thinks are relevant.
  The daemon already knew when none of them actually matched — on the hybrid
  search path a top score is high by construction, because a list always has a
  first element — but it only told the MCP path, never the hook path. So every
  `rm -rf` and every file edit got the same handful of unrelated memories under
  the heading "Strong matches". They are now labelled for what they are: ranked,
  but nothing anchored, treat as probably-not-relevant. The flag is also written
  to the local telemetry now — over 3,126 real recalls in a week it had read
  zero, which looked like health and was actually silence. (#249)

### Added

- **Every write the assistant makes now leaves a record.** The vault has kept an
  append-only audit log for a while, but it was only wired into the Mac app —
  the MCP and REST paths, which is how your AI actually writes, went past it. So
  the one surface that runs on its own was the one you could not review.
  `save_memory`, `save_product_doc` and `archive_memory` now append to
  `.bastra/audit-log.ndjson` with what changed, when, through which surface, and
  the state before and after. Telemetry was never a substitute — it can be
  switched off and is pruned after 90 days; this log is neither. If the log
  cannot be written, your save still succeeds. (#206)

## [0.8.7] — 2026-07-27

A patch release for one reason: two of these are paths on which data could
disappear without anyone being told. Those do not wait for a feature release.

### Added

- **A memory can now say "I am the new version of that one".** Pass `replaces`
  to `save_memory` and both memories record the link. The old one **stays in
  your vault** — still there, still findable by its id, still opening when
  something cites it. It becomes a previous version, not a deleted one, and
  opening it tells you a newer version exists. That is the difference from
  archiving, which retires a memory and takes it out of circulation. Nothing
  about ranking changes yet: a superseded memory is found exactly as before.
  This release lays the track — what a later version does with it (showing old
  versions as faded, letting you search them deliberately) is built on top.
  (#164)
- **Saving a memory now tells you when its triggers just repeat the summary.**
  On a real 471-note vault, 81% of notes had their first `recall_when` phrase as
  a verbatim copy of the summary — which spends the strongest search field on
  text that is already indexed at a lower weight, and leaves the trigger that
  should fire carrying no distinct signal. Rewriting those into real triggers
  moved that vault's recall@5 from 0.457 to 0.565 while making the notes
  *smaller*. `save_quality` now points at the ones that restate, and the
  guidance says it plainly: name the situation, not the content. Advisory only —
  it never blocks a save. Found and measured by zzallirog. (#238)

### Fixed

- **Half the galaxies were turning the wrong way.** Real spiral galaxies trail
  their arms — the outer tips lag behind the rotation, they never lead it. The
  map wound every disc the same direction while picking each galaxy's spin
  direction at random, so on any vault roughly half the galaxies rendered
  leading arms and read as spinning backwards. The winding now mirrors the spin
  sign, so both handednesses still occur across a universe and both are
  physically right. (#283)
- **The save-time duplicate warning stops inventing numbers.** It used to decide
  "this looks like a duplicate" from a raw search score — a number that grows
  when a word is repeated, grows with the size of your vault, and had no fixed
  meaning at any threshold. The result was unrelated memories presented as
  near-duplicates at five-digit "scores", nudging the agent toward overwriting
  the wrong note. Search now only proposes candidates; the decision runs on a
  real content overlap between 0 and 1, computed over the fields you actually
  wrote, and the penalty follows how similar the two memories are instead of how
  many candidates came back. Repeating a term cannot move it, and the same pair
  of memories scores the same on a small vault and a large one. Trigger
  collisions now say "matches 20 of 21 memories in this scope" instead of a bare
  count, and a count the search had to cut short is marked as a lower bound
  rather than printed as if it were exact. (#239)
- **A broken character no longer costs you the whole note.** The vault loader
  used to drop any memory whose frontmatter did not parse — an unknown escape
  sequence inside a quoted value, an unquoted line containing a `:` or a `·`,
  a missing required key — and the only trace was a warning on a daemon stderr
  nobody reads. On one contributor's vault that was 28 notes, invisible in
  Obsidian's file list and absent from every recall. The loader now rescues the
  frontmatter one entry at a time, fills what is missing from what it can know
  (the filename, the body, the file's own timestamp), and keeps the note in the
  index. Nothing is rewritten on disk: the repairs live in memory and are listed
  in the vault report under "Damaged frontmatter", so the damage is something
  you can see and fix rather than something that quietly happened. Structural
  strictness is unchanged — a file without a recognizable `type:` is still an
  ordinary note, not a memory. Reported by zzallirog. (#222)
- **The folder import stops guessing about who owns a node.** Four paths could
  still overwrite a stranger through `saveMemory(overwrite:true)` — which is
  temp+rename with no trash, so the loss is final. A prior import with no
  recorded source path now counts as foreign rather than as its own predecessor
  (this one hit every existing user on the first reimport after updating); a
  read error while checking ownership is refused instead of read as "nothing
  there", which matters on the cloud mounts this project supports; ownership is
  re-checked immediately before each write; and an exhausted id allocator skips
  the file rather than handing back an id it never verified. Every refusal is
  visible in the import's `skipped` list. Follow-up to #240, found by an
  adversarial counter-audit. (#245)
- **`bastra skills add` says what it actually did.** It reported that a ghost
  now renders as a skill while minting a fresh empty node beside the untouched
  ghost — because in an imported vault the name you know (`uncertainty-check`)
  and the id your notes link (`memory-uncertainty-check`) are different strings.
  The command now resolves the name against the ghosts that really exist, tells
  you which id it took, refuses when the name matches more than one, and admits
  when it adopted nothing at all. The help text no longer claims the link slug
  and the node id are always the same. Reported by zzallirog. (#223)
- **`bastra bridges harvest` no longer dies on a model it never pulled.**
  The far-slice reranker fired its default Ollama chat model blind and 404'd
  at the first case on any machine without it. Harvest now probes `/api/tags`
  first and resolves to an installed model — exact tag, same family, or any
  other chat model — and when nothing fits it says which model to pull instead
  of erroring mid-run. `BASTRA_RERANK_MODEL` still overrides. Reported by
  zzallirog.

### Security

- **The Commons target is allowlisted.** `BASTRA_COMMONS_REPO` fed both the
  clone and the contribution PR with no check on where it pointed, and the
  contribution path is egress — a redirected repo would receive your
  verification records. Only `github.com/n0mad-ai/…` is accepted now; anything
  else is refused before the clone and before the push, and it fails closed, so
  a local path or an unparseable value is refused rather than passed through to
  git. `BASTRA_ALLOW_REMOTE_COMMONS=1` opts in on purpose and prints the
  overridden target every time. Flagged by zzallirog during a security read.
  (#260)

## [0.8.6] — 2026-07-22

The mindspace stops being a picture of your vault and starts being a view of it
working. Alongside that, the import path came through an adversarial re-audit —
several findings were destructive, and they are the reason this release exists.

### Added

- **Activity travels the strands.** When a memory is recalled, read or written,
  the bolt now runs along the actual edges to its neighbours instead of cutting
  across empty space — memory to memory to memory. How far a bolt may leave its
  strand, how long activity keeps running, and whether it runs at all are
  sliders and a switch in the sidebar, because ambient motion is a preference,
  not a feature.
- **Nodes say why they glow.** Usage heat is drawn only where there is real
  demand rather than after a single graze, the demand clock carries a time term
  so old attention fades, and a node's tooltip explains its own brightness.
  `GET /api/v1/graph` now serves the raw counts behind the normalized share, so
  the number is auditable and not just pretty.
- **Live notices for recall.** Every hit that `recall` and the PreToolUse hook
  actually serve surfaces as a notice — you can watch which memories your agent
  is being handed while it works. The notices are a deck with a tick rail
  instead of a wall of cards, and the session history uses the same rail.
- **Local weather, opt-in.** The map can tint its backdrop with the weather
  where you are — picked by GPS or typed into a topbar chip that shows
  temperature, condition and place. Off until you choose a place; coordinates
  are rounded to ~11 km and the picker states plainly, before you decide, that
  they leave the machine.
- **Depth-true galaxy labels** in the universe view, and a re-tuned mindspace
  that reads as space rather than as a disc.
- **`GET /api/v1/health`** — reachability without spending a recall.
- **A TypeScript producer for the anno-check symbol table** (`tools/`), built
  from the compiler. The annotation gate's reference producer reads a code-graph
  engine we do not run; the format needs neither. Verified against the reference
  implementation's own fixture, symbol for symbol.
- **doc2query bridge for colloquial RU/UA → EN** in the eval corpus, with a
  register guard so documents already written in the target register are not
  expanded a second time.

### Fixed

- **`save_memory` with `overwrite` is a patch, not a replace** (#240, #239,
  #242). It silently dropped every field the caller did not resend — provenance,
  valence, relations. Overwriting to fix a typo could strip a memory bare.
- **Import never overwrites a foreign node** (#240). Provenance is checked
  before a write, and the automatic legacy migration was removed outright rather
  than made safer: it could lose data, and no import needs it.
- **No destructive or half-applied file operations** (#240/A4, A5). Trash moves
  are versioned, document writes cannot land partially, and a failed step leaves
  the vault as it was.
- **An import batch keeps its structure.** A single-batch import collapsed every
  memory into one cluster because the source hierarchy sat unread in
  `topic_path` — found and fixed by **zzallirog** (#243), whose PR also brought
  the re-announce cooldown for live notices.
- **A save no longer announces itself twice.** The save path indexes its own
  write and the watcher then reported the same file as a fresh add, so the
  topbar counter rose by two per save and only a reload put it straight.
- **A notice reaches its memory after a daemon restart.** The delivery cursor
  lives in daemon memory and resets to zero on restart, which silently swallowed
  the events an open map had not yet seen — including the birth of a node it
  then could not open.
- **A busy memory still announces itself.** The quiet window could be re-armed
  without bound by a steady writer, so a memory under load never surfaced at all.
- **Index detection judges prose per link**, not preamble length, so a genuine
  index is not mistaken for a note and vice versa.
- **`find_document` reports `docs_indexed`**, so an empty result is readable as
  "nothing indexed" rather than "nothing found".
- **The weather chip catches up** instead of showing a reading from hours ago
  when the tab has been in the background.

### Security

- **The map runs under a Content-Security-Policy** that bounds its egress to the
  hosts it actually needs.
- **Three patchable advisories pinned out** of the MCP SDK's dependency tail.
- The CSP test compares hosts instead of matching substrings, so a permissive
  policy can no longer pass by accident.
- `BASTRA_ALLOW_REMOTE_OLLAMA` is documented as the explicit opt-in it is.

## [0.8.5] — 2026-07-19

### Added
- **Intake adoption** (#217): imported memories start as lean "intake" nodes and
  are *adopted* into the full memory format when Claude actually uses one —
  adopt-on-touch (one per turn), adopt-merge when a duplicate check hits, or in
  bulk on request. A new **`archive_memory`** MCP tool retires the original
  (vault trash + forget) and stamps `superseded_by` on the archived copy, so the
  adoption stays auditable from both sides. The curator proposes adoption
  candidates for intake memories that keep earning recalls (≥ 2 acted-on recalls
  in 30 days; `BASTRA_ADOPTION_PROMOTION_MIN`) through the pending-suggestions
  relay — it never self-wires.
- **Opt-in galactic mindspace**: the map's Mindspace can render your own
  memories as a slowly rotating core with every area orbiting it. Two display
  controls: **Distance** — `woven` (areas pull inward by how much they share
  edges and usage heat with your memories) or `balanced` (spaced by size) — and
  an **orbital drift** toggle. Off by default; the standard Mindspace view is
  unchanged.
- **Persona-aware onboarding**: the onboarding interview adapts to a chosen lens
  — developer / business / personal / mixed. Developers get convention questions
  (file-size guide value in lines, which folder holds what); the answers become
  profile memories, and a named size guide is written straight to `size.guide`.
  Runs across the vault map, `bastra onboard` and the session hook.
- **Language-first recall** (#231): onboarding asks for your primary authoring
  language — 12 explicitly named languages recognized, with a statistical
  German/English detection fallback when none is named — and persists it as
  `language.primary`. The session hook injects a `<memory-language>` guide so
  memories get written in your language (genuine tech terms stay English), and
  `save_memory` returns a quality advisory when an English `recall_when` is saved
  on a non-English vault. The recall hook's query is now language-neutral (file
  identifier + topics, no English filler verbs), so an English template no longer
  spends recall's lexical vote on tokens a non-English vault can't contain — kill
  switch `BASTRA_HOOK_QUERY=english` restores the old action-verb template.
- **Score transparency** (#230): with `verbosity: "full"`, each recall hit now
  carries the RRF rank pair its score is built from — `rrf: { rank_bm25,
  rank_vector, raw }`. `recall` also returns a top-level `weak_result: true` when
  no returned hit actually matched a `recall_when` or title on the hybrid path —
  an explicit "nothing really matched here" signal that rides alongside the
  structurally-high rank score and filters nothing.
- **File-size guard hook**: a new `PreToolUse` check counts a code file's lines
  before every Write/Edit and injects a compact `<file-size-check>` block as the
  file nears the guide value — the size convention is enforced deterministically
  instead of relying on the agent to remember it. Thresholds resolve
  env > `bastra config set size.guide`/`size.critical` > built-in (500 guide /
  800 critical; test files 700 / 1000). Kill switch `BASTRA_SIZE_CHECK=off`.

### Fixed
- **Ring view — PROJECTS stays instance-browsing**: the PROJECTS ring now always
  shows one project at a time with the sidebar switcher, independent of the
  project count, instead of flipping to fan-out mode once the cluster count
  crossed the instance threshold under the user's feet.
- **Import: cleaner graphs from real vaults** (zzallirog 0.8.4 verification
  round): wikilinks written *inside* code spans no longer parse as edges (shared
  `stripCodeSpans` helper) — no more phantom edges/ghosts from prose *about*
  links; a file other notes link to is imported as a real hub, never skipped as a
  nav file; and `MEMORY.md` indexes are harvested into sections + per-file
  descriptions, tied together by a single navigation-hub node (a native
  Claude-Code memory went from 52 disconnected islands to 53 nodes / 50 edges /
  0 ghosts). The core graph's edge keys use unicode escapes instead of literal
  NUL bytes, so the graph file is no longer binary to grep and other tools.
- **Embedding backfill race** (#233): a save that lands in the drain end-window
  (queue already empty) no longer strands its embedding — fast sequential saves
  all get indexed.
- **Care flags keep their notes** (#228): the note field stays hidden until a
  flag kind is picked, and "Flag for session" no longer silently swallows a typed
  note when clicked before a kind is chosen.
- **Live updates are lossless** (#234): vault events are no longer dropped under
  load; reading the same memory several times collapses into one history entry
  with a ×N counter once the reads settle, and the panel polls by delivery
  sequence so nothing between polls is missed.
- **Mindspace flow sheen — steady tempo**: the sheen that glides along active
  strands now animates at a constant tempo regardless of strand length (a fixed
  wave period instead of per-line), and no longer speeds up the longer the map
  has been open (the phase wraps travelled distance before normalizing, killing
  the session-age time-dilation).
- **Semantic depth view is navigable** (map): in depth mode, drag rotates and
  shift-drag pans (the same orbit gesture as Mindspace), and the old auto-spin is
  now an opt-in hint toggle, off by default. The flat/depth toggle no longer
  leaks into views that don't have it.

## [0.8.4] — 2026-07-18

### Fixed
- **`import vault` slug-twin ghosts** (#219, zzallirog field report): body
  wikilink targets now go through the SAME slugify as the minted node ids —
  `[[feedback_gate_catalog]]` resolves onto `<label>-feedback-gate-catalog`
  instead of minting an underscored ghost twin. This one mismatch accounted
  for 81% (326/402) of the reported ghost count. Acceptance is the reporter's
  falsifiable prediction: re-importing the same vault should land the ghost
  count in the 60–80 range with edges climbing.
- **`import vault` walks archives** (#220): `_archive/` and `archive/`
  directories (any depth, case-insensitive) are now skipped by default —
  retired copies no longer mint `-2`/`-3` collision twins of live notes.
  New repeatable `--exclude <dir>` flag for vault-specific layouts; dotdirs
  and `node_modules` stay always-skipped.

## [0.8.3] — 2026-07-18

### Fixed
- **`import vault` self-ingest guard** (zzallirog field report): importing a
  folder that overlaps the vault — the vault itself, a subfolder, or a parent
  directory — now refuses with a clear message instead of writing a slugified
  copy of the vault into itself. For users whose memory directory *is* the
  vault this was the default first run; the daemon hid the echo (it scopes
  cleanly), but every other tool on the shared folder saw a half-duplicate
  corpus. Symlinks are resolved before the check.
- Every successful folder import now writes a `.bastra-imported` marker into
  `memories/imported/<label>/` (source, label, count, timestamp), so external
  tools walking the shared folder — atlas viewers, indexers, grep — can
  recognize and skip the machine-imported set.

### Added
- **Semantic view: depth mode** (zzallirog idea — "a wire between two things
  you've already made"): the server-side PCA now ships the third principal
  component as `z`, and the semantic view gets a flat/depth toggle in the
  sidebar (the spot the structure switch occupies in other views). Depth mode
  projects the meaning cloud through the Mindspace-style camera — slow drift,
  perspective size and fade, depth-sorted occlusion; the flat 2D layout stays
  byte-identical to before.

## [0.8.2] — 2026-07-18

### Added
- **Mindspace view** (#216): the map's new default view — a real universe over
  your vault: volume-spread galaxies, subgalaxies, solar systems, dwarfs,
  nebulae, background stars and shooting stars, fully mouse-navigable
  (recenter via button or hotkey `C`).
- **Areas manager** (#216): create, rename and delete top-level areas right in
  the browser — scopes are rewritten across memories, `dokumentationen/<scope>`
  follows, deletion goes to the vault trash, never hard-deletes.
- **Meta ring** (#216): taxonomy conventions and declared skills render as a
  superordinate ring level above the content rings.
- **Live updates** (#216/#217): an opt-in live mode (persisted topbar toggle) —
  new memories land as a supernova with preview card and seconds counter,
  reads/changes/deletes show as typed live notices with anti-spam rules, node
  flashes per notice kind, and newborn nodes join the running simulation
  clickable. A **session history** panel behind a topbar button lists what
  happened while you watched.
- **Human-like memory axes** (#217): optional `salience`, `emotion` and
  `recall_mode` frontmatter. High salience slows staleness aging; ranking gets
  a bounded salience multiplier in SHADOW mode by default (would-be re-ranking
  is logged, goes live only via `BASTRA_SALIENCE_RANK=live` after a measured
  lift). The map shows an emotion-colored **valence glow** and a usage-**heat
  core** per node.
- **Reflex lane** (#217): `POST /hook/reflex` matches prompts
  deterministically against the `recall_when` of `recall_mode: "reflex"`
  memories (token-AND, budgeted, per-session dedup) — the prompt hook fires it
  in parallel on every non-trivial prompt. Promotion stays user-confirmed: the
  curator proposes reflex candidates (≥3 acted-on recalls/30d) and
  episodic→semantic consolidation clusters via the pending-suggestions relay,
  never self-wiring.
- **Claude Desktop Extension** (#218): `bastra-recall-<version>.mcpb` —
  double-click install with the Bastra logo and a vault-folder picker; every
  GitHub release now carries the bundle as an asset, and
  **`bastra install claude-desktop --extension`** is the CLI on-ramp (fetch →
  dedupe config registration → open Desktop's install dialog). The MCP
  handshake now also ships `serverInfo.icons` + `title` (spec 2025-11-25) for
  the day Desktop renders them.

### Changed
- The map's CSS moved from one `app.css` to 15 module files (aggregator only
  `@import`s); the renderer uses glow sprites and viewport culling instead of
  per-frame gradients (#216).

## [0.8.1] — 2026-07-17

### Added
- **Onboarding interview** (#212): a fresh vault offers to seed itself — pick
  what your memory will mainly hold (developer / business / personal / mixed)
  and answer a handful of persona-aware questions; every answer becomes a
  profile memory immediately (`write_origin: "user-directed"`). Three
  surfaces, one catalog: the vault map auto-opens the wizard, `bastra onboard`
  runs it in the terminal, and the session hook guides an adaptive interview.
- **Import staging** (#208): `bastra import <file|->` stages memory lists from
  ChatGPT / Claude / Gemini exports (or free text) as checkbox candidates in
  `import-review.md` — the next AI session distills accepted ones WITH the
  user; nothing is saved without an accept. The map carries a visual import
  dialog (topbar ↓).
- **Chat-history mining** (#211): `bastra import <conversations.json>`
  recognizes the official ChatGPT/Claude data exports, keeps only the USER's
  own messages and queues them locally under `~/.bastra/`; the session combs
  the queue chunk-wise via `bastra import mine` and stages candidates through
  the same review gate. `bastra import clear` discards; the queue is deleted
  on drain.
- **Rules-file import** (#209): `bastra import rules` stages the list lines of
  local instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
  `.cursor/rules/`, `~/.claude/CLAUDE.md`) through the same gate.
- **Feedback channel** (#210): `bastra feedback <bug|idea>` opens a prefilled
  GitHub issue form (sanitized diagnostics — never paths, never content); the
  map links both forms in its sidebar.
- **Claude Desktop autonomy** (#214): the forwarder ships MCP server
  instructions in the handshake, marks the read tools with
  `readOnlyHint`/`destructiveHint` annotations (bulk-approvable in Desktop's
  permission UI), and appends the session context — pinned memories, durable
  preferences, conventions, open care/import/onboarding state — to the FIRST
  tool result of every hookless client session (`GET /hook/session-context`;
  Claude Code sessions are detected and skipped;
  `BASTRA_MCP_SESSION_CONTEXT=0` opts out).

- **Folder import** (#215): **`bastra import vault <dir> [label]`** — import a
  whole folder of foreign memory files in one command, no per-item review.
  A tolerant Claude-Code adapter reads both frontmatter variants (flat
  `type:` and nested `metadata.type`), files with or without `[[wikilinks]]`,
  and frontmatter-less legacy notes (YAML errors degrade gracefully instead
  of dropping the file); anything else falls back to a generic markdown
  adapter (title from the first H1 or filename, summary from the first
  paragraph). The CC `description` field — the format's declared recall cue —
  maps straight onto `summary` + `recall_when`, so a known format imports
  deterministically. Everything lands isolated under
  `memories/imported/<label>/` with namespaced ids and its own scope:
  nothing existing is read or modified, re-import is idempotent, and
  deleting that one folder removes the whole set. Hand-maintained index
  files (frontmatter-less link lists) are recognized as navigation and
  skipped — they don't become nodes and don't inflate the ghost count.
  The map's import dialog grew a matching folder section with a directory
  picker (`POST /ui/import-vault`, `GET /ui/fs` — directory names only,
  loopback + ui-gated).
- **Skills ring** (#215): **`bastra skills <list|add|remove>`** — a
  declare-once registry (`~/.bastra/skills.json`) for link targets that live
  on another surface, e.g. Claude Code skills. Declared ids render as solid
  nodes in the map's own `skills` ring instead of dashed "unwritten" ghosts,
  keep their place even when the last live link drops, and the curator stops
  reporting them as dangling links. Also available in the map: **"Mark as
  skill"** on any ghost node (`/ui/skills`). No path, no folder scan, no
  sync — the id is the whole declaration.

### Fixed
- **Search copilot** (`/ui/chat`): a truncated model response no longer leaks
  raw JSON into the chat (reply-value rescue), and the copilot never claims a
  memory "does not exist" — it says the search didn't surface it.

## [0.8.0] — 2026-07-16

### Added
- **Vault map** (#207): an interactive, local-only map of the vault at
  `http://127.0.0.1:6723/ui` — opt-in via `ui.enabled`, opened with the new
  **`bastra map`** command (also surfaced in `bastra status` and the install
  wizard). Three views: **Clouds** (force layout along the folder structure,
  draggable clouds with an animated evade + gravity-back comfort band),
  **Ring** (a drill-down wheel over the six memory building blocks — projects,
  people, self, knowledge, rules, artifacts — with per-project emblems and an
  instance switcher), and **Semantic** (positions from a PCA projection of the
  embedding vectors, plus dashed strands for *connections you never wrote*:
  semantically close pairs with no explicit link). Ghost nodes mark unwritten
  wikilink targets, bridge halos mark cross-cluster connectors. Renders from
  three open, token-gated endpoints (`GET /api/v1/graph`, `/graph/node`,
  `/graph/semantic`) — the web UI is one viewer among equals (#140); private
  memories never appear.
- **Search copilot** (#207): a chat docked beside the map's search results
  that deepens a search — it fans the question out into several recall
  queries, answers grounded in the notes' actual bodies, and pins its finds
  highlighted on top of the result list. Runs on the same local Ollama
  generation model as doc2query (`POST /ui/chat`, loopback-only); nothing
  leaves the machine.
- **Vault care** (#207): flag memories straight from the map (*delete*,
  *edit*, *write*, *note*) into an open `vault-care.md` checklist; the next
  AI session sees the open flags via the session hook and works the list off
  with you.
- **Capture admission rules** (#159): SKILL.md, the `save_memory` description,
  and two advisory `save_quality` checks now guard against memories that rot —
  negative capability claims without a fix, imperative self-directives, and
  stale-in-7-days artifacts.
- **`write_origin` provenance** (#158): memories carry who authored them
  (`user-directed` | `agent-session` | `capture-review`). Stamped at save
  time, preserved on overwrite, and user-directed memories are exempt from
  automated lifecycle passes (curator).

### Fixed
- **`reconcile()` heals in-place edits** (#199): files edited by external
  processes — Obsidian, scripts, a second machine, especially on cloud-storage
  mounts — no longer serve stale content until a daemon restart. Reconcile now
  stat-compares mtime/size per indexed file and re-reads on drift.

## [0.7.9] — 2026-07-07

### Fixed
- **`bastra-recall install` always reaches the guided wizard now.** Package-
  manager bin resolution (`npx` / `npm exec`) could route `bastra-recall
  <command>` to the daemon entry point, which then died with
  `FATAL: BASTRA_VAULT_PATH is not set` instead of running the CLI. The daemon
  entry now detects a CLI command (`install`, `doctor`, `status`, …) and
  delegates to the CLI — so `npx bastra-recall install` runs the install wizard
  regardless of which bin the package manager picks. The daemon path is
  unchanged when started with no command (as the forwarder does).

## [0.7.8] — 2026-07-07

### Fixed
- **`npx bastra-recall install` now launches the guided wizard** instead of
  crashing with `FATAL: BASTRA_VAULT_PATH is not set`. The unscoped wrapper
  package only exposed a `bastra` bin, so the `bastra-recall` command resolved
  to the **daemon's** `bastra-recall` bin (the raw daemon entry, which needs a
  vault env) rather than the CLI. Fix: the wrapper now also exposes a
  `bastra-recall` bin → CLI launcher, and the daemon's daemon-entry bin was
  renamed to `bastra-recall-daemon` to remove the name collision. Any bare
  `bastra install` / `npx bastra-recall install` on a terminal runs the wizard.

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

[0.8.8]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.8
[0.8.7]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.7
[0.8.6]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.6
[0.8.5]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.5
[0.8.4]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.4
[0.8.3]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.3
[0.8.2]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.2
[0.8.1]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.1
[0.8.0]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.8.0
[0.7.9]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.9
[0.7.8]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.8
[0.7.7]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.7
[0.7.6]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.6
[0.7.0-beta.5]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.0-beta.5
[0.7.0-beta.4]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.0-beta.4
[0.7.0-beta.3]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.7.0-beta.3
[0.6.0-beta.1]: https://github.com/n0mad-ai/bastra-recall/releases/tag/v0.6.0-beta.1
