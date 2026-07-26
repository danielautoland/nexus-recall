# Bastra Recall – Evolution Architecture V1 → V2

> Status: release and target architecture; V1.0 is the next binding release
> contract, while V2.0 is the long-term, measurement-dependent target
>
> As of: July 24, 2026
>
> Baseline: Bastra Recall 0.8.6, the current vault, real 30-day telemetry, and
> the existing evaluation geometry

## 0. Decision and Review Status

This document distinguishes five levels:

1. **verified current state** – supported directly by code, telemetry, or a
   reproducible run;
2. **V1.0 release contract** – the smallest body of work that establishes a
   reliable measurement, decision, and control foundation;
3. **V1.x evolution** – individually gated, backward-compatible steps based on
   real measurements;
4. **V2.0 target** – the joint promotion of memory capabilities proven during
   V1.x;
5. **hypothesis** – may be measured or examined in shadow mode at any time,
   but becomes schema, contract, or live work only after its predefined gate.

### 0.1 V1.0 – Measurement and Control Foundation

The current 0.8.6 state does not yet fully satisfy V1. V1.0 is reached when,
and only when, the following foundations have been implemented and
demonstrated:

1. establish measurement truth and reproducible baselines;
2. build a deterministic, explainable abstention and relevance decision from
   signals that already exist;
3. evolve the existing session-context path into one shared, project-aware,
   parallel server-side assembler;
4. introduce a global context budget and measure retrieval quality separately
   from hook wording and consumer behavior.

V1.0 does not include new memory types, claims, graph edge types, dual vectors,
chunking, HNSW, or a live learned-ranking layer.

### 0.2 Release Ladder

| Release | Function | Release logic |
|---|---|---|
| 0.8.6 | current pre-V1 state | diagnostic baseline, not a completed V1 contract |
| V1.0 | observable and selective measurement/control foundation | Section 0.1 and Definition of Done 26.1 are fully satisfied |
| V1.x | incremental evolution | each component is released separately through its named measurement gate and delivered backward-compatibly |
| V2.0 | complete adaptive memory system | all mandatory V2 properties in 26.2 have been demonstrated together |

Measurement, shadow operation, and read-only projections are permitted at any
time. Measurement gates govern only schema/contract changes and live
activation. The exception is a quality comparison whose interpretation
requires the M0 baseline.

Accessibility/the Asteroid Belt, Deep Recall, Episodic Memory, Claims, the
Typed Graph, consolidation, dual vectors, HNSW, and learned ranking remain in
this document as the V2 target. During V1.x, these components may be made
persistent in product behavior, schemas, or contracts, or activated live, only
after their named measurement gate has demonstrated need and safety. Until
then, they remain limited to measurement, shadow, read-only, or isolated
experiments.

V2.0 is not a blanket approval for components built in advance. It is the
promotion of individually proven V1.x components into one stable system.

### 0.3 Review Discipline

Counter-reviews strictly distinguish an incorrect current-state claim, a
measurement problem, an architecture decision, and a future hypothesis. Every
objection receives a stable ID, the exact passage, a verdict, file/line
evidence or a reproducible command, and the smallest necessary correction.
Resolved points are reopened only when new evidence exists.

### 0.4 Approved Review Ledger

| ID | Verdict | Binding consequence in this document |
|---|---|---|
| C-001 | confirmed | Raw BM25 scores and scaled RRF scores must no longer use shared absolute 30/100 bands as a relevance promise. |
| C-002 | confirmed | The current `weak_result` is only an informational MCP signal, not a hook gate; V1.0 introduces a real evidence decision with abstention. |
| C-003 | corrected | The production candidate pool is `max(k × 4, 20)`, not always 20; out-of-pool evaluations explicitly expand it to 100/200. |
| C-004 | corrected | `GET /hook/session-context` exists, but is projectless and internally serial; it will be extended rather than used unchanged as a SessionStart replacement. |
| C-005 | corrected | Bridges are opt-in and are a no-op without a pool; on this instance, two active bridges expanded 853 queries during the measurement period. This firing rate demonstrates activity, not usefulness or quality lift. |
| C-006 | confirmed | `acted_on` is a token-overlap proxy, not a gold label; V1.0 therefore does not claim a `relevance_probability`. |
| C-007 | qualified | HNSW is not justified for the current vault, but remains specified as an explicitly gated future automatic-switch strategy. |
| C-008 | confirmed | A complete mutation audit currently exists only on the Mac app bridge path; regular MCP/HTTP saves are not covered. |
| C-009 | confirmed | Load/use rates mix retrieval, hook wording, consumer behavior, and telemetry attribution; V1.0 separates these effects experimentally. |
| C-010 | confirmed | The ad hoc baseline has no versioned run artifact and becomes an official baseline only after M0. |
| C-011 | confirmed | Salience affects staleness lifetime in production; its direct ranking influence remains shadow-only by default. |
| C-012 | confirmed | Production telemetry reports BM25-stage p50 1 ms, p95 11 ms, and p99 25 ms; the differing ad hoc row is shown separately and marked as unarchived. |
| C-013 | confirmed | Accessibility and Typed Graph Evidence are not V1.0 evidence signals; Section 10.2 separates available V1 signals from later V2 signals. |
| C-014 | confirmed | Context ROI is a system success metric, not a live activation gate for the evidence decision; activation depends only on retrieval-isolated gates. |
| C-015 | confirmed | The 45.2% measurement has no archived independent provenance and is labeled as an ad hoc paraphrase measurement. |
| C-016 | confirmed | The absolute Recall@3 target is not an activation gate for the classifying evidence decision; that component must preserve recall relative to the ungated arm, while absolute coverage is observed as a system target from V1.0 onward. |
| C-017 | confirmed | Typed Graph, versions, and reconsolidation require a separate schema decision in addition to M4 preparation; Section 25 names that gate explicitly. |
| C-018 | Product Owner directive | Measurement, shadow operation, and read-only projections remain permitted at all times; measurement gates constrain schema/contract changes and live activation, with an M0 prerequisite only for interpreted quality comparisons. |
| C-019 | confirmed | `acted_on` and token costs derived from it are consistently described as a token-overlap proxy, not as demonstrated use. |
| C-020 | confirmed | V1.0 telemetry gains `client`, `hook_source`, and a pseudonymous session dimension so the agreed analyses and experiment arms are executable. |
| C-021 | confirmed | M0 produces versioned numerical M1 tolerances after the baseline run. |
| C-022 | Product Owner decision | Shadow acceptance requires at least 14 days or 500 logged hook decisions; gold-set gates must also pass and every `required`/`no_answer` divergence must be explained. |
| C-023 | Product Owner decision | The live evidence decision runs behind a configuration flag with immediate fallback to today’s floor behavior; there is no hard cutover. |
| C-024 | Product Owner decision | Retrieval/presentation experiments assign arms deterministically by pseudonymous session ID; minimum N per arm is versioned after M0. |
| C-025 | Product Owner decision | Private run artifacts live under `~/.bastra/eval-runs/<date>-<hash>/`; the public repository receives only aggregate reports without vault-derived query text. |
| C-026 | confirmed | Chunking is not released by M2; it requires a separate representation decision based on a chunking on/off ablation. |
| C-027 | confirmed | Product metrics become measurable only when their gated data source exists; until then, they explicitly remain part of the target. |
| C-028 | confirmed | Section 19 defines permitted independent query sources, prohibits access to the target memory’s body, summary, and `recall_when` while authoring a query, and makes provenance fields mandatory in the dataset manifest and private run artifact. |

**Acceptance status, July 24, 2026:** Full reconciliation of ledger C-001–C-027,
gate measurability, current-state claim sweep (58 claims, all supported), and
implementer review. Future counter-reviews concern only change deltas against
this state.

**Final architecture acceptance, July 24, 2026:** C-028 was confirmed in the
final delta review; no substantive open deltas remain. The approved C-001–C-027
baseline remains unchanged. Next available ID: C-029.

New delta reviews begin with C-029. A verdict changes only with new code,
telemetry, or run evidence; matters of preference are recorded as architecture
decisions rather than factual errors.

## 1. Purpose

The evolution of Bastra Recall from V1 to V2 is not merely intended to find
more memories. The system must become increasingly reliable at deciding:

1. whether any memory is relevant at all;
2. which kind of memory is responsible for the current situation;
3. how deeply it must search;
4. whether a memory should surface spontaneously, be found only on request, or
   be deliberately recovered “from far away”;
5. when individual experiences should be consolidated into durable knowledge;
6. when old knowledge is merely difficult to access, historical, or
   demonstrably outdated.

The central product statement remains:

> The user should not have to think on behalf of the AI.

By V1.0 at the latest, a second condition becomes operational:

> The AI must not burden the user with memories that have no demonstrable
> relevance to the current situation.

## 2. Current State

The current architecture already has strong individual components:

- a local Markdown/YAML vault as the source of truth;
- BM25 with a heavily weighted `recall_when` field;
- optional semantic search through embeddings;
- RRF fusion of lexical and semantic hits;
- doc2query triggers, optional and opt-in language bridges, and automatic
  relationships;
- Staleness, Floors, and the Curator; Salience already extends staleness
  lifetime, while its direct ranking influence is shadow-only by default;
- Reflex memories with explicit user approval;
- local telemetry for `surfaced`, `loaded`, and `acted_on`;
- recoverable deletion and stable memory IDs; a complete mutation audit
  currently exists only on the Mac app bridge path, not for regular MCP/HTTP
  saves.

Together, these components do not yet form a closed model of attention,
forgetting, remembering, and consolidation. In particular, today’s score
semantics cause almost every query to produce an apparently strong top hit.

### 2.1 Verified Snapshot, Not Yet a Reproducible Benchmark

Read-only measurements taken on July 24, 2026 against the current vault of 577
memories:

| Measurement | Result |
|---|---:|
| BM25 stage, 30-day production telemetry | n 22,819 · p50 1 ms · p95 11 ms · p99 25 ms |
| BM25 ad hoc benchmark, method not archived | p50 5.1 ms · p95 13.3 ms · p99 19.3 ms |
| PreTool hook total | median 141 ms · p95 255 ms |
| Recall portion in the daemon | median 95 ms · p95 223 ms |
| SessionStart | median 381 ms · p95 499 ms |
| MCP recall | median 105 ms · p95 200 ms |
| Ad hoc paraphrases, provenance not archived | Recall@1 45.2% · Recall@3 57.1% · MRR 0.521 |
| Anti-query top score | median 137.7 |

30-day telemetry:

| Signal | Result |
|---|---:|
| reachable PreTool calls | 4,009 |
| top score ≥ today’s Required threshold | 4,006 · 99.9% |
| emitted Required hints | 16,762 |
| loaded | 153 · 0.9% |
| classified as `acted_on` (token-overlap proxy) | 82 · 0.5% of emitted hints |
| estimated injected hint tokens | 519,588 |
| tokens per memory classified as `acted_on` (proxy) | approx. 6,336 |

The telemetry figures use the existing `stats.ts` methodology. The 30-day
window moves, so slightly different figures in a later run are not a
contradiction.

The production BM25-stage row comes from
`recall_stages.bm25_search_ms`; during the July 24, 2026 counter-check, the
moving window contained 22,819 matching events. The separate BM25 ad hoc,
paraphrase, and anti-query values were measured in read-only runs but have not
yet been stored as a versioned run artifact with command line, method, code,
vault, model, configuration, and dataset hashes. In particular, no provenance
independent of the memory surface was archived for the 45.2% paraphrase
measurement. These values are diagnostic indicators and may become an official
baseline only after M0.

The load and `acted_on` rates do not prove that every unloaded hint was wrong.
They measure the combined system of retrieval, hook wording, consumer behavior,
and telemetry attribution. Today, `acted_on` itself is a lexical token-overlap
proxy. The values nevertheless demonstrate that the current absolute score is
not a reliable relevance promise and that the Required band is not calibrated
as an internal control variable. The visible hook text already calls hits
“hints, not obligations,” but scope and suppression bypasses still depend on
the internal 100 threshold.

The two language bridges enabled on this instance were not merely wired in:
they expanded 853 queries in the evaluated 30-day snapshot. Without opt-in or
without a bridge pool, the layer is a no-op by definition. Those 853 expansions
measure only how often a bridge fired; they demonstrate neither retrieval
quality nor causal recall lift.

### 2.2 Main Problems

1. **Rank is not probability.** BM25 and scaled RRF occupy different score
   spaces but use the same absolute floors.

2. **Real abstention is missing.** A ranking always has a first place, even
   when the correct answer is “nothing relevant exists.”

3. **Association is stronger than inhibition.** Embeddings, query expansion,
   and graph hops increase reach, but not automatically precision.

4. **Episodes and durable knowledge compete in the same retrieval space.**

5. **Forgetting is assembled from isolated rules.** Time, Salience, Curator
   demotion, and Floors do not yet produce one unified, explainable
   accessibility model.

6. **The hot path is unnecessarily serial.** SessionStart performs several
   recall and metadata requests sequentially.

7. **Some evaluation sets are too small or not production-like.** Small
   synthetic sets hit ceiling values while real paraphrases perform
   substantially worse.

8. **The hybrid stress path is not wired reliably.** A
   `packages/daemon/scripts/eval-stress.ts --hybrid` run remains structurally
   BM25-only in the current stress harness because that harness does not create
   an `EmbeddingIndex`. Other specialized evaluation arms can already use real
   embeddings; this statement applies specifically to the stress harness.

9. **Retrieval and consumer behavior are mixed in ROI measurement.** Low load
   rates can result from irrelevant hits, hook language, consumer compliance,
   or incomplete telemetry attribution.

10. **Current quality measurement has no run provenance.** Without a versioned
    artifact, a real before/after decision is not reproducible.

Points 1, 2, and 6–10 are immediately verified problems covered by the V1.0
release contract. Points 3–5 motivate the long-term target, but do not prove
that the later components described for them must be built now.

## 3. Scientific Guardrails

Bastra does not simulate a biological brain. V2 adopts only principles that can
be translated into useful system architecture.

### 3.1 Complementary Learning Systems

Complementary Learning Systems theory distinguishes rapid learning of
individual experiences from the slow construction of structured knowledge.
Replay connects the two systems.

Translation to Bastra:

- a fast, append-only episodic store;
- a slower, stable semantic store;
- periodic, evidence-based consolidation instead of immediate generalization.

Source:
[Kumaran, Hassabis & McClelland – Complementary Learning Systems Theory Updated](https://pubmed.ncbi.nlm.nih.gov/27315762/)

### 3.2 Pattern Separation and Pattern Completion

Pattern separation keeps similar experiences distinct and reduces
interference. Pattern completion reconstructs a memory from incomplete cues.

Translation to Bastra:

- separate episodes, versions, entities, and time periods;
- no premature merging of similar memories;
- BM25, embeddings, doc2query, and the graph as pattern-completion tools;
- typed edges, claims, and conflict detection as pattern-separation tools.

Source:
[Yassa & Stark – Pattern separation in the hippocampus](https://pubmed.ncbi.nlm.nih.gov/21788086/)

### 3.3 Replay and Consolidation

Offline reactivation can integrate new and old experiences while protecting
existing knowledge.

Translation to Bastra:

- the Curator as a controlled “sleep” pass;
- a mixture of new, old, successful, and conflicting episodes;
- proposals instead of autonomous content rewriting;
- retention of original evidence.

Source:
[Singh, Norman & Schapiro – Sleep-dependent memory consolidation](https://pubmed.ncbi.nlm.nih.gov/36279437/)

### 3.4 Reconsolidation

Reactivated memories can temporarily become modifiable and must be stabilized
again. Direct biological evidence includes animal models; for Bastra, this is a
design analogy, not an equivalence.

Translation to Bastra:

- successful retrieval opens a reviewable update candidate;
- new evidence creates a version or `supersedes` relationship;
- historical truth is never overwritten silently.

Source:
[Nader, Schafe & LeDoux – Reconsolidation after retrieval](https://pubmed.ncbi.nlm.nih.gov/10963596/)

### 3.5 Adaptive Forgetting

Forgetting is not merely loss. Suppressing competing memories can reduce future
interference.

Translation to Bastra:

- reduce accessibility, do not delete;
- damp frequently ignored competition;
- reinforce successful reuse;
- retain access to dormant content through Deep Recall.

Source:
[Wimber et al. – Retrieval induces adaptive forgetting](https://pubmed.ncbi.nlm.nih.gov/25774450/)

## 4. Architecture Principles

1. **Inhibition before additional association.** Every expansion of the
   candidate space requires a stronger relevance or abstention gate.

2. **Accessibility is not existence.** A memory may become difficult to reach
   without being deleted.

3. **Rank is not confidence.** Internal search scores must never be exposed
   directly as a promise to the user.

4. **No answer is a valid result.** `no_answer` is a normal system state, not an
   error.

5. **Working context constrains long-term memory.** Goal, project, files,
   entities, and task phase filter before broad retrieval.

6. **Episodes are stored quickly; rules are learned slowly.**

7. **Every generalization retains its evidence.**

8. **Forgetting and remembering must be explainable.**

9. **Automatic backend selection is measured, not guessed.**

10. **Human-in-the-loop remains in place for durable rules, reflexes,
    preferences, conflict resolution, and deletion.**

11. **Local-first operation, privacy, and survival by ID remain
    non-negotiable.**

## 5. Target Architecture

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
  Core + Orbit        Asteroid Belt
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

## 6. Memory Layers

V2 separates the function of memories without abandoning the existing
Markdown vault.

### 6.1 Working Memory

Ephemeral session state, not automatically durable:

- current goal;
- project and worktree;
- affected files and symbols;
- active entities;
- current task phase;
- recent errors and corrections;
- confirmed constraints;
- open questions;
- memories already loaded.

Working Memory is the attention and filtering model. It should remain small,
current, and completely disposable.

### 6.2 Episodic Memory

New lane or memory type, `episode`:

- `occurred_at`;
- `session_id` or stable task reference;
- situation and context;
- action taken;
- outcome;
- succeeded / failed / partial;
- involved files, symbols, and entities;
- source or evidence;
- possible emotional salience;
- links to decisions, lessons, and other episodes.

Rules:

- append-only by default;
- no automatic Required injection;
- used primarily for Deep Recall, consolidation, and causal investigation;
- old episodes may fade but remain preserved;
- similar episodes are linked, not silently merged.

### 6.3 Semantic Memory

Stable knowledge:

- Lessons;
- Decisions;
- Preferences;
- Project Facts;
- Workflows;
- References;
- document sidecars.

V2 adds or operationalizes:

- structured claims;
- evidence links;
- `valid_from`;
- `valid_to`;
- `confidence`;
- `supersedes`;
- `contradicts`;
- `derived_from`;
- `last_verified_at`.

Semantic memories arise from an explicit user instruction, a reliable source,
or confirmed consolidation.

### 6.4 Procedural / Reflex Memory

The existing Reflex lane remains the procedural layer:

- deterministic triggers;
- small budget;
- no fuzzy self-injection;
- promotion only after user confirmation;
- precision before reach;
- revocable at any time.

### 6.5 Historical Memory

Historical is not a deletion state but a retrieval role:

- explicitly superseded;
- no longer temporally valid;
- relevant only to history, causal analysis, or older project states;
- still available by ID, version, citation, and Deep Recall;
- never injected as a current rule.

## 7. Adaptive Memory Accessibility

### 7.1 Definition

Accessibility is explicitly not a sixth damping layer. If it goes live after
successful evaluation, it unifies and explains the long-term memory mechanisms
that currently act separately as Staleness, Curator demotion, Floors, Salience,
validity, and potentially Confidence later. Those mechanisms must not then
independently multiply the same score again.

Session deduplication, empty-streak backoff, and turn context remain separate
attention and emission mechanisms. They do not describe a memory’s long-term
accessibility and therefore do not contribute to its Accessibility.

Every memory receives a computed `accessibility` between 0 and 1. It is not a
permanently stored truth, but a reproducible projection from stable fields and
usage data.

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

At first, the formula describes signal groups, not an implemented score
function. Exact weights and zones—and even whether an explainable state model
is more stable than a continuous number—are decided only in M3. The
corresponding V1.x stage begins exclusively as a read-only projection in the
sidecar and Mindspace.

### 7.2 Positive Signals

- explicit floor or pin;
- successful `loaded` → `acted_on` path;
- repeated successful use in different contexts;
- recent confirmation or review;
- high, supported source confidence;
- moderately bounded Salience;
- explicit user instruction;
- an active dependency through a current Decision or Workflow.

### 7.3 Negative Signals

- explicit `superseded_by`;
- expired validity;
- confirmed contradiction;
- repeatedly surfaced but not loaded;
- loaded, then rejected or corrected;
- not used successfully for a long time;
- obsolete project state;
- low or unknown source quality.

Not loading is only a weak negative signal. The system cannot reliably observe
whether a hint helped indirectly. An explicit correction or a demonstrably
superseding claim is much stronger.

### 7.4 Hard Rules

- Age alone must never delete a memory or classify it as historical.
- Floors prevent automatic descent into the Asteroid Belt.
- `user-directed` content must not be changed automatically.
- Salience must not override missing query relevance.
- High usage must not make an invalid memory current again.
- Exact ID, citation, and version retrieval bypasses the Accessibility floor.
- Accessibility affects spontaneous reachability, not data existence.

### 7.5 Accessibility Zones

The following thresholds are starting ranges for evaluation, not final product
constants:

| Accessibility | Zone | Behavior |
|---:|---|---|
| 0.80–1.00 | Core | eligible for spontaneous injection when query relevance is high |
| 0.50–0.79 | Orbit | normal recall |
| 0.20–0.49 | Outer Orbit | only with clear query agreement |
| 0.00–0.19 | Asteroid Belt | no automatic injection; Deep Recall only |
| explicitly superseded | Historical | only for temporal/historical retrieval or through its successor |

Zones must not be computed directly from age. They result from the complete
Accessibility function.

## 8. Asteroid Belt and Deep Recall

### 8.1 Meaning

The Asteroid Belt visualizes memories whose spontaneous accessibility has
dropped sharply. It is:

- not a trash bin;
- not a deletion state;
- not a separate truth archive;
- fully searchable;
- deliberately separated from automatic context injection.

It corresponds to the familiar human state:

> “I know there was something, but I need to search deeper for it.”

### 8.2 Visual Representation in Mindspace

- Core memories are bright and central.
- Orbit memories form the regular systems and galaxies.
- Outer Orbit memories appear smaller, darker, and farther away.
- Dormant memories form an Asteroid Belt around the active inner galaxy.
- Salient memories retain a recognizable colored core.
- Superseded memories appear fractured or translucent and show a directed link
  to their successor.
- Contradictions appear as tense or color-separated edges.
- Opening a memory explains the reason for its Accessibility state.

Example:

```text
Asteroid Belt
  accessibility: 0.14
  last successful use: 214 days ago
  surfaced: 11
  loaded: 1
  acted_on: 0
  status: dormant, not obsolete
```

### 8.3 Interaction

The user can deliberately enter the belt:

- “Search deeper”;
- “Include faded memories”;
- “I know we had something about this before”;
- click the Asteroid Belt in Mindspace.

On entry, the change in retrieval depth becomes visible:

1. normal results remain as a reference;
2. dormant results appear gradually;
3. old versions and episodes are grouped;
4. relationships and contradictions are explained;
5. the user can reactivate, confirm, or leave a hit historical.

### 8.4 Technical Deep Recall Path

Deep Recall:

1. opens the dormant filter;
2. increases the candidate pool;
3. activates query expansion and language bridges;
4. searches episodes and Historical memories;
5. permits controlled typed-graph traversal;
6. uses a stronger local reranker when available;
7. groups by time, entity, claim, and version;
8. still returns an honest `no_answer` when nothing is sufficiently supported.

Deep Recall may be slower than Normal Recall. It is a deliberate interaction,
not an implicit hook hot path.

## 9. Adaptive Retrieval Controller

The controller decides not only what ranks, but which retrieval path is needed
at all.

### 9.1 Inputs

- Query;
- tool intent;
- Working Memory;
- project and scope;
- files, symbols, and entities;
- time budget;
- token budget;
- requested recall depth;
- vault size and index health;
- available local models;
- observed hit strength and abstention signal.

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
  -> full Deep Recall including Asteroid Belt
```

### 9.3 Normal Recall Cascade

1. Normalize the query.
2. Determine Working Memory context and hard filters.
3. Check exact IDs, symbols, paths, and Reflex triggers.
4. Run BM25.
5. Evaluate lexical evidence.
6. Skip the semantic arm when the result is unambiguous.
7. Run vector search for ambiguity or paraphrase.
8. Merge candidates without pretending their score spaces are equivalent.
9. Optionally rerank top candidates locally.
10. Diversify duplicates and near variants.
11. Use the deterministic evidence decision to classify candidates as
    `required`, `optional`, or `no_answer`.
12. Abstain when evidence is insufficient.
13. Emit only a bounded result and token budget.

A calibrated probability replaces this step only later, after M0/M1 provide an
independent, versioned gold set and enough calibration cases.

### 9.4 Deadline Behavior

- BM25 is the guaranteed fast path.
- Semantic search receives its own sub-budget.
- A vector call is cancelled or ignored at the deadline.
- An incomplete hybrid path must not pretend to be complete.
- The response identifies `lexical_only`, `hybrid`, `degraded`, or
  `deep_recall`.
- Hooks never block on a slow reranker.

## 10. Relevance Evidence, Abstention, and Later Calibration

### 10.1 New Result Object

Raw search scores remain diagnostic values. In V1.0, the consumable decision
does not use a fabricated probability; it uses a deterministic, explainable
evidence decision:

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
  // Only after independent calibration and sufficient labels:
  relevance_probability?: number;
  // Only from the later, separately gated Accessibility stage:
  accessibility?: number;
}
```

Existing `acted_on` events are not enough to claim a relevance probability:
the current signal is a token-overlap proxy, and the 30-day window contains
only a small number of positive hook episodes. `relevance_probability`
therefore remains absent until M0 provides an independent gold set and a real
calibration measurement.

### 10.2 Evidence Signals by Maturity

Available in V1.0 or deterministically derivable within the approved release
contract:

- full and partial `recall_when` coverage;
- phrase match rather than any single word;
- exact identifier, path, symbol, and entity matches;
- scope- and project-specific agreement;
- normalized BM25 evidence;
- actual vector similarity;
- agreement between retrieval arms;
- query type;
- confidence and source quality;
- temporal validity;
- successful historical use;
- novelty and duplication degree.

Only in later, separately approved V1.x/V2 stages:

- Accessibility after the M3 gate passes;
- Typed Graph Evidence after an edge schema has been introduced and evaluated.

### 10.3 Decisions

V1.0 product semantics:

- `required`: a hard anchor or multiple independent, deterministically
  supported signals;
- `optional`: plausible relevance, but not a certain obligation;
- `no_answer`: available evidence is insufficient for emission.

`deep-only` and `historical` arrive only with the gated Accessibility and Deep
Recall stage.

The old absolute thresholds `30` and `100` are not carried over to the new
semantics.

### 10.4 Training and Calibration

Stages:

1. deterministic, explainable rule decision;
2. shadow logging of its decisions;
3. independent, versioned gold set and controlled consumer experiments;
4. offline calibration only when sufficient, appropriate labels exist;
5. only then, optionally, a logistic model or small gradient booster;
6. emit `relevance_probability` only after demonstrated calibration;
7. no autonomous online learning without rollback and drift monitoring.

`surfaced-but-not-loaded` is at most a weak negative. `acted_on` is stronger,
but is still not a gold label. Explicit correction, re-query, user rejection,
and independently labeled relevance are more reliable signals.

## 11. Embedding and Vector Architecture

### 11.1 Field-Aware Representation

A single monolithic vector mixes “when should this fire?” with “what is this
about?” V2 separates the two:

#### Cue Vector

- `recall_when`;
- title;
- tags;
- aliases;
- entities;
- symbols;
- optionally validated `recall_when_expanded`.

#### Content Vector

- summary;
- semantic claims;
- body chunks;
- document sections;
- episodic context.

#### Structure Remains a Filter

- scope;
- type;
- time;
- sensitivity;
- Accessibility zone;
- Historical status.

Structured fields are not merely embedded as free text; they are filtered
before or during search.

### 11.2 Chunking

- long bodies are embedded section by section;
- every chunk retains memory ID, heading, and offset;
- memory ranking aggregates chunk evidence;
- a single arbitrary body prefix no longer represents the entire document;
- the result still loads the memory, not every chunk without control.

Offline measurements and a chunking on/off ablation on long bodies are
permitted at any time. M2 does not test chunking and therefore cannot release
it. A persistent change to vector/index representation through Cue/Content
dual vectors or chunking requires a separate representation decision based on
these ablations; live activation then requires the associated quality and
migration gate.

### 11.3 Query Embedding Cache

- a dedicated cache independent of the final recall response;
- key includes model, dimension, and normalized query;
- bounded LRU size;
- safe invalidation on model change;
- SessionStart queries may be prewarmed;
- no durable storage of sensitive query text without an explicit decision.

## 12. Flat Search and HNSW

This section describes a later target architecture. A vault of 577 memories at
measurement time does not justify live HNSW activation. Measurements,
prototypes, and shadow comparisons are permitted at any time. As vector volume
actually grows, Recall should switch automatically and with quality safeguards
between Flat and HNSW; the switch goes live only after controlled profiling
demonstrates a Flat-search bottleneck and M5 demonstrates the quality and
latency advantage. Provider latency alone is not an HNSW argument.

### 12.1 Terms

Flat, or brute-force, search compares the query vector with every stored
vector. It is exact, simple, and fast for small vaults.

HNSW means **Hierarchical Navigable Small World**. It organizes vectors into a
multilevel neighborhood graph and rapidly jumps into a probably relevant
region during search. It scales much better, but is approximate.

### 12.2 Shared Interface

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

The Retrieval Controller contains no backend-specific logic outside this
interface.

### 12.3 Automatic Selection

The backend switch does not depend on one magic memory count:

- number of vectors;
- number of chunks;
- vector dimension;
- measured Flat p95 latency;
- available RAM;
- current hardware;
- HNSW recall against Flat gold;
- build and update costs;
- error rate and index health.

Initial logic:

1. Flat is always available and remains the reference.
2. Above a configurable size or latency threshold, Recall builds HNSW in the
   background.
3. Shadow queries run against both backends.
4. HNSW is activated only when both the speed and quality gates pass.
5. The switch is atomic and targets a complete snapshot.
6. Corruption, drift, or poor quality causes Recall to fall back to Flat.
7. Manual forcing remains available for diagnostics.

Practical expectation, not a hard rule:

- below a few thousand vectors, usually Flat;
- between a few thousand and 10,000, decide from real p95 measurements;
- at substantially larger chunk/memory volumes, usually HNSW;
- Deep Recall may use Flat for verification in critical cases.

### 12.4 HNSW Quality Gate

HNSW may go live only when:

- Recall@10 reaches at least 98% relative to Flat;
- gold Recall@3 does not drop materially;
- no scope or sensitivity errors occur;
- p95 is measurably better;
- index build and incremental updates are stable;
- restart and snapshot recovery have been tested.

Exact parameters such as `M`, `efConstruction`, and `efSearch` are determined
by benchmarking and stored as part of the snapshot manifest.

## 13. Typed Memory Graph

`related_via` remains available for weak semantic proximity, but must not
represent every relationship type.

V2 relationships:

| Type | Meaning |
|---|---|
| `related_to` | general semantic proximity |
| `supports` | provides evidence for a claim |
| `contradicts` | contradicts a claim |
| `supersedes` | replaces an older version |
| `derived_from` | consolidated from an episode or source |
| `caused_by` | cause and effect |
| `resolved_by` | the problem was solved by this |
| `applies_to` | applies to an entity, project, file, or symbol |
| `example_of` | concrete episode of a semantic pattern |

Rules:

- automatic cosine proximity creates at most `related_to`;
- strong edges require structured evidence or confirmation;
- Normal Recall traverses only controlled typed edges;
- Deep Recall may traverse more broadly;
- contradictory or historical edges are explained visibly;
- graph hops receive no blanket score-multiplier model.

## 14. Consolidation as a Controlled Sleep Pass

### 14.1 Input

The pass examines a mixture of:

- new episodes;
- older similar episodes;
- frequently and successfully used memories;
- repeatedly ignored candidates;
- corrections;
- contradictions;
- temporally expired Decisions;
- existing semantic rules.

Examining only the largest topic-path clusters is insufficient.

### 14.2 Operations

1. Cluster episodes by entity, claim, cause, solution, and outcome.
2. Deliberately keep similar episodes separate.
3. Identify recurring patterns.
4. Include counterexamples and failures.
5. Detect contradictions.
6. Create a candidate Lesson, Decision, or Workflow.
7. Preserve original evidence through `derived_from`.
8. Propose confidence and scope of validity.
9. Obtain user confirmation.
10. Retain episodes and adjust only their Accessibility.

### 14.3 Replay Mixture

The replay sampler must not select only what was recently frequent:

- a share of new episodes;
- a share of old but still relevant episodes;
- a share of rarely used but highly salient memories;
- a share of contradictory or corrected cases;
- a share of random control cases.

This prevents the system from reinforcing only what is already dominant.

## 15. Reconsolidation and Versions

Successful retrieval may produce a review candidate:

```text
Memory loaded
  -> used in tool context
  -> new evidence or correction observed
  -> reconsolidation candidate
  -> no-op, confirm, patch, or new version
```

Rules:

- no automatic overwrite because of a single tool call;
- the old version remains citable;
- the current version points to its predecessor;
- the predecessor points to its successor;
- historical queries can retrieve the state as it existed then;
- normal queries prefer currently valid claims;
- conflicts are not decided by recency alone.

## 16. Hook and Session Orchestration

### 16.1 SessionStart

A `GET /hook/session-context` endpoint already exists. Today it serves the MCP
forwarder for clients without hooks, is deliberately projectless, excludes
project-specific and `all-projects` hints, and assembles its sources mostly
sequentially. It is therefore not a drop-in replacement for the Claude Code
SessionStart hook.

V1.0 does not build a second competing session-context path. The existing
server-side assembler becomes the shared implementation:

```text
GET  /hook/session-context
  -> backward-compatible, projectless forwarder path

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

The Claude Code hook then calls the project-aware path once. Hookless clients
retain the existing GET contract. Independent server-side steps run in
parallel. The response has:

- a global time budget;
- a global token budget;
- prioritized blocks;
- a clear degraded marker;
- cancellation of noncritical parts at the deadline.

### 16.2 PreToolUse and Prompt

- exact and lexical checks first;
- semantic arm only when needed;
- no blanket multi-hop;
- respect `no_answer`;
- Required only from the deterministic evidence decision; a calibrated
  probability is considered only after M1 label evidence;
- backoff also applies to apparently strong hits whose relevance is not
  independently supported;
- identical routing logic is shared centrally.

### 16.3 Context Budget

A global Context Governor decides:

- how many memories are emitted;
- how many tokens are consumed;
- whether only title/summary or a full load is needed;
- whether a memory already loaded may be mentioned again;
- which zones are excluded automatically.

## 17. Learning from Use

### 17.1 Positive Signals

- `loaded` followed by `acted_on`;
- explicit “That was correct”;
- repeated successful use in different situations;
- a memory demonstrably prevents a previously recurring error;
- a Deep Recall hit is reactivated.

### 17.2 Negative Signals

- user rejects or corrects the hit;
- immediate re-query with different wording;
- loaded but marked unsuitable afterward;
- repeatedly surfaced and never loaded;
- a claim is superseded by new evidence.

### 17.3 Selection Bias

Only surfaced memories can be loaded. Therefore:

- `surfaced-not-loaded` is not reliable proof of irrelevance;
- today, `acted_on` is a lexical proxy, not a ground-truth label;
- out-of-pool cases do not produce direct ranking labels;
- learned ranking initially operates exclusively in shadow;
- coverage and ranking quality are measured separately;
- exploration remains small, controlled, and transparent.

### 17.4 Measuring Retrieval and Presentation Separately

Hook load rate does not depend on ranking alone. The V1.0 release contract
requires separate arms:

1. identical hits with different hook wording;
2. identical wording with and without the deterministic abstention gate;
3. independent relevance labels for a sample of emitted and withheld
   candidates;
4. task/tool success in addition to `loaded` and `acted_on`;
5. analysis separated by client, hook source, and query class.

Arm assignment is deterministic per pseudonymous session ID. A session remains
in the same arm for all associated events. Minimum N per arm is determined
after the M0 baseline run and stored in versioned form together with the
assignment function and experiment configuration.

Tokens per `acted_on` remain an important system ROI metric, but are not
interpreted as pure retrieval precision.

## 18. Measurement Gates on the Path from V1 to V2

The measurement gates evaluate more than Recall@k. They evaluate the complete
decision chain across coverage, relevance, abstention, Accessibility, latency,
and context cost.

### 18.0 Release Status

The V1.0 release contract includes M0, the deterministic portion of M1, the
shared project-aware session assembler, and the context/consumer experiment
from Section 17.4. Measurements, prototypes, shadow operation, and read-only
projections for M2 through M5 may begin at any time; quality comparisons that
claim a reference effect are interpreted only against a reliable M0 baseline.
A pure M6 shadow model requires M0 and M1, but not M3 through M5. Schema or
contract changes and live activation remain blocked until the named gate and
explicit approval.

The `M` designation means measurement gate. It is deliberately distinct from
the V1/V2 product versions.

### 18.1 M0 – Establish Measurement Truth

Goal:

- ensure that every evaluation arm actually executes the production code path.

Work:

- `packages/daemon/scripts/eval-stress.ts --hybrid` must create a real
  `EmbeddingIndex`;
- the report identifies the model and backend used;
- the report identifies the current production formula `max(k × 4, 20)`
  (currently 40 for the paraphrase slice with `k=10`, and usually 20 for
  smaller `k`);
- the candidate pool is expanded explicitly to at least 100 or 200 only for the
  corresponding evaluations;
- Near, Far-in-pool, and Far-out-of-pool receive separate labels;
- stale gold IDs are removed or versioned;
- evaluation queries are created independently of the current memory surface;
- the dataset manifest and private run artifact carry `origin_type`,
  `authoring_mode`, and `origin_ref_hash` for every gold case;
- a label-shuffle null and control arm are implemented in the harness and
  identified in the report;
- every run receives code, vault, model, configuration, and dataset hashes;
- command line, raw stdout/stderr, manifest, and structured JSON results are
  stored as a versioned run artifact under
  `~/.bastra/eval-runs/<date>-<hash>/`;
- after the baseline run, numerical M1 tolerances are set and stored in
  versioned form;
- the public repository stores only aggregate reports without vault-derived
  query text. Reduced third-party reproducibility is accepted in favor of vault
  privacy.

Gate:

- no silent arm fallback;
- no unknown gold IDs;
- reproducible report;
- label-shuffle null and control arm present.

### 18.2 M1 – Relevance and Abstention

Hypothesis:

> A deterministic, explainable relevance and no-answer gate sharply reduces
> false injection without materially degrading recall of true gold memories.

Datasets:

- real independent paraphrases;
- anti-hallucination queries;
- cross-scope cases;
- identifiers and technical symbols;
- German, English, and mixed-language queries;
- hard semantic distractors;
- deliberately empty queries for which no memory matches.

Metrics:

- Recall@1/@3/@10;
- MRR and nDCG;
- precision of the Required band;
- `False-Interrupt-Rate`;
- abstention precision/recall;
- independent human or curated relevance labels;
- context tokens per `acted_on`;
- rate of true golds that were incorrectly abstained;
- load/use rate separated by hook wording, client, and hook source.

Definitions:

- `nDCG@k` uses the versioned relevance scale `0 = irrelevant`,
  `1 = optionally relevant`, `2 = clearly relevant`; cases without graded gold
  labels are evaluated only with MRR/Recall.
- `False-Interrupt-Rate` is the proportion of gold `no_answer` queries for
  which the hook nevertheless injects at least one memory automatically.

AUROC, Calibration Error, and `relevance_probability` are used only in a later
calibration stage, after M0/M1 provide enough appropriate labels.

Provisional component activation gates for the evidence decision:

- anti-query false injection < 5%;
- no material Recall@3 loss relative to the same ungated retrieval arm;
- Required requires a hard anchor or independent evidence across arms;
- no material loss on identifier queries;
- false abstention remains below the tolerance set in M0.

Recall@3 ≥ 85% on independent real paraphrases, context tokens per successful
use, load/use rate, and the initially targeted tenfold Context ROI improvement
are observed as system goals from V1.0 onward. They are neither live activation
gates for the evidence decision nor blanket V1.0 release conditions before M0
is complete: absolute coverage also depends on the retrieval arm, while the
other metrics combine retrieval, hook wording, consumer behavior, and telemetry
attribution.

Numerical component limits and system targets are finalized only after the
reproducible M0 baseline run.

Shadow acceptance:

- at least 14 calendar days or at least 500 logged hook decisions;
- all retrieval-isolated component gates pass on the versioned gold set;
- every observed `required`/`no_answer` divergence between the legacy and
  evidence decisions is explainable through features, a reason code, or review;
- unexplained divergences block live activation.

Rollout and rollback:

- live activation occurs behind a configuration flag;
- on error, drift, or operational uncertainty, Recall immediately falls back
  to today’s score/floor behavior;
- there is no hard cutover;
- the legacy path is removed only after documented stable live operation and
  separate approval.

### 18.3 M2 – Adaptive Retrieval Cascade

Hypothesis:

> BM25-first with conditional Semantic Recall lowers p95 without losing
> semantic coverage.

Arms:

- today’s always-hybrid path;
- BM25-only;
- adaptive cascade;
- adaptive cascade plus a conditional local reranker.

Metrics:

- p50/p95/p99;
- provider calls per recall;
- query-cache hit rate;
- energy/model residency;
- recall quality by query class;
- timeout and degraded rate.

Live gates:

- PreTool p95 < 150 ms;
- SessionStart p95 < 300 ms;
- BM25-unambiguous queries trigger no unnecessary provider call;
- semantic query classes lose no more than the defined tolerance.

### 18.4 M3 – Accessibility and the Asteroid Belt

Hypothesis:

> A zoned Accessibility model reduces spontaneous interference while Deep
> Recall reliably recovers old memories.

Test cases:

- current memories used frequently and successfully;
- old memories that were never used;
- old but highly salient memories;
- floored memories;
- superseded Decisions;
- contradictory Claims;
- dormant memory with an exact identifier;
- deliberate Deep Recall query.

Metrics:

- correct zone classification;
- spontaneous false-injection rate from the belt;
- Deep-Recall@k for dormant golds;
- explainability of the zone decision;
- reactivation rate after successful Deep Recall;
- survival by ID and citability.

Live gates:

- Floors never automatically descend to Deep-only;
- Historical is never emitted as a current rule;
- exact IDs remain reachable;
- Deep Recall finds the defined dormant golds;
- Normal Recall injects no belt memories without exceptionally strong,
  explicitly measurable evidence.

### 18.5 M4 – Episodes and Consolidation

Hypothesis:

> Separating episodes from semantics reduces interference and produces better
> durable lessons.

Metrics:

- cluster precision;
- share of generalizations with complete evidence;
- counterexample coverage;
- contradiction detection;
- user acceptance of proposals;
- rate of false or premature generalizations;
- retrieval quality before and after consolidation.

Schema/live gates:

- no autonomous rule change;
- every Lesson references its episodes or source;
- contradictions are shown, not silently overwritten;
- the episode remains after consolidation.

### 18.6 M5 – Flat/HNSW Automation

Hypothesis:

> Automatic backend selection improves large vaults without losing relevant
> hits relative to exact Flat search.

Scales:

- current vault;
- 1,000;
- 3,000;
- 10,000;
- 50,000 memories or chunks.

Metrics:

- build time;
- RAM;
- index size;
- update and delete latency;
- search p50/p95/p99;
- Recall@3/@10 against Flat gold;
- snapshot recovery;
- automatic switch decision;
- fallback time.

Live gates:

- Recall@10 relative to Flat ≥ 98%;
- no sensitivity or scope leaks;
- p95 is actually better;
- atomic, repeatable switch;
- Flat fallback is always functional.

### 18.7 M6 – Learned Ranking and Accessibility

A pure shadow model may begin after M0 and M1 are complete. M3 through M5 are
not prerequisites; signals from stages that do not yet exist remain absent from
the model:

- shadow model;
- no live mutation;
- time split instead of random split;
- evaluate projects and people separately;
- distinguish positive, negative, and censored feedback;
- drift monitoring;
- reproducible rollback.

Live release only after M6 passes, incremental lift over the deterministic
evidence decision is demonstrated, behavior is explainable, and rollback is
reproducible.

## 19. Evaluation Datasets

The growing V1→V2 gold set requires at least:

- independent real paraphrases;
- real no-answer queries;
- hard semantic distractors;
- cross-scope and cross-project cases;
- temporal and version questions;
- contradictory memories;
- exact IDs, paths, and symbols;
- German, English, and mixed technical language;
- episodes versus semantic rules;
- dormant and Deep Recall cases;
- private and team/public sensitivity;
- documents with long bodies;
- query types from real hook telemetry.

Every case includes:

- query;
- independent origin;
- expected IDs;
- acceptable alternatives;
- expected zone;
- `no_answer` yes/no;
- scope;
- time or version view;
- permitted retrieval depth;
- rationale for the gold label.

Permitted independent query sources are privacy-safe real session transcripts,
original task text, issue/incident descriptions, queries phrased directly by
the user, and an independent second person. While formulating or selecting the
query, the author must not open the target memory’s body, summary, or
`recall_when`. Mapping the query to the gold memory occurs only afterward in a
separate labeling step.

For every gold case, the following provenance fields are mandatory in the
dataset manifest and private run artifact:

- `origin_type`: `session_transcript`, `task_text`, `issue_incident`,
  `user_query`, or `second_person`;
- `authoring_mode`: how the query was obtained or authored independently;
- `origin_ref_hash`: a privacy-safe hash of the local origin reference.

Raw text or a resolvable local origin reference remains private and is not
included in aggregate public reports.

## 20. Product Metrics

Recall evolution optimizes more than search hits:

Metrics become measurable only when the data source for their gated stage
exists. Until then, they describe the target and must not be reported as
existing product telemetry.

### Quality

- Recall@k;
- MRR/nDCG;
- Required precision;
- no-answer quality;
- conflict and temporal accuracy;
- Deep Recall success.

### Attention

- hook emissions;
- loaded hints;
- `acted_on`;
- tokens per successful use;
- repetition and backoff rate;
- share of disruptive hints.

### Speed

- p50/p95/p99 by retrieval lane;
- provider time;
- cache hit rate;
- SessionStart time;
- timeout and degraded rate.

### Memory Health

- episodes per consolidated Lesson;
- unresolved contradictions;
- historical versions;
- dormant share;
- reactivated memories;
- outdated sources;
- share of memories without reliable evidence.

## 21. Migration

### 21.1 V1.0 – Approved Release Contract, No Schema Change

- repair the M0 evaluation harness and produce reproducible run artifacts;
- extend score, evidence, abstention, and no-answer telemetry with `client`,
  `hook_source`, and a pseudonymous `session_id`;
- run the deterministic evidence decision in shadow first, and activate it only
  after the retrieval-isolated M1 component gates pass;
- extend the existing session context into one shared, project-aware assembler;
- parallelize independent server-side parts within that assembler;
- introduce a global context and latency budget;
- measure retrieval quality and the effect of hook wording in separate
  experiment arms.

### 21.2 V1.x/M2 – Adaptive Retrieval, Not Yet Approved for Live Use

Measurement, prototypes, and shadow operation are permitted at any time. A
quality comparison is interpreted only against the M0 baseline. Live
activation occurs only when M2 passes its quality and latency gates:

- BM25-first cascade;
- conditional semantic arm;
- query embedding cache;
- deadline and degraded behavior;
- no degradation of semantic query classes.

### 21.3 V1.x/M3 – Accessibility and Deep Recall, Not Yet Approved for Live Use

Read-only projections and Deep Recall experiments are permitted at any time.
Live activation occurs only when M1 demonstrates relevant age-, conflict-, or
accessibility-related interference and M3 passes its gate. The stage begins
without a schema change:

- Accessibility exclusively as a read-only sidecar projection;
- no mass Markdown changes;
- show the zone and its reasons in the UI;
- Asteroid Belt as a read-only projection;
- Deep Recall remains experimental and goes live only after M3 passes.

### 21.4 V1.x/M4 – Memory Lanes, Claims, and Consolidation, Schema/Live Not Yet Approved

Isolated measurements, fixture/sidecar prototypes, and read-only projections
are permitted at any time. Every persistent vault-schema or contract change
requires a separate schema decision based on the evidence available at that
time. Live migration occurs only after M4 passes.

Memory lanes and schema:

- add `episode`;
- optional claim/evidence fields;
- version and typed-edge schema;
- old memories remain fully compatible;
- defaults are derived from the existing type.

Consolidation:

- replay sampler;
- cluster and contradiction proposals;
- human review;
- no autonomous semantic mutation.

### 21.5 V1.x/M5 – Vector Strategy, Not Yet Approved for Live Use

Measurement, prototypes, and shadow implementation are permitted at any time.
Live activation occurs only when controlled profiling on the target hardware
demonstrates a real Flat-search bottleneck and M5 demonstrates the quality and
latency advantage. Provider latency alone is not a reason for HNSW:

- backend abstraction;
- Flat as reference;
- HNSW in shadow;
- automatic quality and latency gate;
- atomic switch with fallback.

### 21.6 V1.x/M6 – Learned Layer, Not Yet Approved for Live Use

- pure shadow start after stable measurement geometry and completed M0/M1;
- M3–M5 are not prerequisites for the shadow model;
- shadow-first;
- time-based offline evaluation;
- live activation only after M6 passes, explicit approval, and demonstrated
  rollback.

### 21.7 V2.0 – Promotion, Not a Big Bang

V2.0 is assigned only after the mandatory properties in 26.2 have been
demonstrated together. Experimental V1.x features do not become V2 components
merely because they exist. They require stable contracts, backward
compatibility, documented migration, rollback, and their respective passed
measurement gates.

## 22. Backward Compatibility

- Markdown remains the source of truth.
- Existing memory types remain valid.
- `recall_when` remains the primary manually authored retrieval signal.
- Existing IDs remain stable.
- Older clients can continue to receive lean hits.
- New decision and evidence fields are introduced additively.
- A `relevance_probability` is offered additively only after successful
  calibration; until then, it remains absent.
- Without embeddings, BM25 remains fully functional.
- Without HNSW, flat search remains fully functional.
- Without the accessibility sidecar, conservative default zones apply.
- Without Mindspace, Deep Recall remains accessible through the API/CLI.

## 23. Privacy and Security

- No new cloud requirement.
- Query and memory embeddings respect the existing provider and egress rules.
- Sensitivity is checked before retrieval and again before output.
- HNSW must not leak filtered private IDs through neighborhoods or diagnostics.
- Working Memory is not persisted by default.
- Episode capture follows the same capture and injection-protection rules.
- User content from the vault is never treated as executable instructions.
- Pseudonymous experiment session IDs contain no query or vault content.
- Raw artifacts from evaluation runs remain local; public reports contain no
  vault-derived query texts.
- Deep Recall extends reach, not permissions.
- Soft delete and survival by ID remain intact.
- The existing audit trail for the Mac Bridge mutation path remains intact. A
  unified audit trail for regular MCP/HTTP mutations is separate future work
  and is not assumed here to be an already existing property.

## 24. What Explicitly Will Not Be Built First

- no larger embedding model as the answer to incorrect Required hits;
- no deeper untyped graph hops;
- no aggressive automatic proliferation of triggers;
- no more aggressive automatic storage;
- no autonomous rewriting of user knowledge;
- no live activation of HNSW without a flat-search comparison;
- no live salience weighting without sufficient shadow evidence;
- no learned ranker on a faulty or drifting candidate pool.

## 25. Implementation Order

V1.0:

1. Measurement truth and reproducible baselines.
2. Deterministic relevance evidence and genuine abstention.
3. A shared project-capable session assembler with internal parallelization.
4. A global context budget and separate retrieval/presentation experiment.

Implementation through item 4 is approved for V1.0. All subsequent items order
schema/contract changes and live activations. Measurement, shadow operation,
and read-only projections remain permissible independently of that sequence;
quality claims with reference value require M0:

5. BM25-first cascade and query-embedding cache live after passing M2.
6. Derived accessibility and asteroid belt live after M1 evidence and passing
   M3.
7. Deep Recall live after passing M3.
8. Cue/content vectors and chunking persistent or live only after a separate
   representation decision under 11.2; M2 alone is insufficient.
9. Episodic Memory and structured claims persistent only after a separate
   schema decision, live after passing M4.
10. Typed graph, versions, and reconsolidation persistent only after a separate
    schema decision under 21.4, live after passing M4.
11. Controlled consolidation live after passing M4.
12. Flat/HNSW strategy live only when controlled profiling demonstrates a
    flat-search bottleneck and M5 demonstrates the quality and latency
    advantage.
13. Learned ranking in shadow after M0/M1, live only after passing M6.

## 26. Definition of Done

### 26.1 V1.0 Release Contract

V1.0 is complete when:

- every evaluation run exists as a reproducible, versioned artifact with code,
  vault, model, configuration, and dataset hashes;
- the hybrid stress evaluation demonstrably uses a real `EmbeddingIndex` and
  does not report a silent BM25 fallback as hybrid retrieval;
- no unknown gold IDs or unlogged candidate-pool sizes enter the evaluation;
- every gold case carries the mandatory provenance fields in the dataset
  manifest and private run artifact;
- the numerical M1 tolerances have been versioned and fixed after the M0
  baseline run;
- run artifacts are complete in the private evaluation directory and public
  reports contain no vault-derived query texts;
- the deterministic evidence decision has first been evaluated in shadow;
- shadow operation has reached the defined minimum duration or minimum case
  count and passed the retrieval-isolated M1 component gates before live
  activation;
- live activation sits behind a configuration flag and the score/floor legacy
  path remains available as a tested fallback;
- hooks and session context respect `no_answer` and do not treat weak hits as
  Required solely because of an incompatible raw score;
- the shared session assembler correctly adopts project path and scope, runs
  its independent server components in parallel, and remains compatible with
  existing clients;
- a global token and latency budget limits the complete session response;
- retrieval quality, hook wording, and consumer behavior are evaluated
  separately;
- `client`, `hook_source`, and pseudonymous session assignment provide the
  telemetry dimensions required for that separation;
- experiment arms are assigned deterministically per session and have reached
  their post-M0 versioned minimum N;
- Context ROI is reproducibly measurable as a system metric without circularly
  controlling live activation of a correct retrieval decision;
- none of this requires migration of the vault schema, memory types, or vector
  backend.

### 26.2 Promotion to V2.0

V2.0 is not complete merely because new components exist. Promotion occurs
only when:

- Recall reliably says nothing when nothing fits;
- Required once again represents a dependable relevance promise;
- real independent paraphrases satisfy the quality gate;
- hook context consumes substantially fewer tokens per successful use;
- Normal Recall stays within the latency budget;
- the asteroid belt explains accessibility without losing memories;
- Deep Recall can deliberately recover dormant memories;
- episodes and persistent rules have separate roles;
- every consolidation retains its evidence;
- old versions remain citable;
- HNSW is activated automatically only when it is measurably useful and
  qualitatively safe on the current hardware;
- every adaptive decision has been shadow-tested, is explainable, and can be
  rolled back.

## 27. Summary

Bastra Recall 0.8.6 first becomes V1.0: a reproducibly measurable, selective,
and controllable recall system. During V1.x, further memory functions are added
only after passing their measurement gates. V2.0 ultimately denotes the jointly
proven adaptive, multilayer memory system:

- Working Memory controls attention.
- Episodic Memory stores experiences quickly and separately.
- Semantic Memory holds confirmed, stable knowledge.
- Reflex Memory carries deliberately approved routines.
- Accessibility controls how readily something surfaces spontaneously.
- The asteroid belt keeps dormant memories visible and discoverable.
- Deep Recall enables deliberate “rummaging” through old contexts.
- An adaptive controller selects BM25, flat vector search, HNSW, or Deep Recall
  according to the query, vault, hardware, quality, and time budget.
- Deterministic relevance evidence and abstention initially prevent rank from
  being mistaken for truth; a calibrated probability may later be based only
  on independent labels.
- Consolidation and reconsolidation evolve knowledge without erasing its
  history.

The goal is not maximum recall. The goal is:

> The right memory at the right time — and otherwise silence.
