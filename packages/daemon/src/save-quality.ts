/**
 * `save_quality` — the advisory the save path hands back to the agent.
 *
 * Split out of tool-handlers.ts (#239 follow-up): eight open issues touch that
 * file and it had grown past 1400 lines, so the scoring logic gets its own
 * boundary before the next one lands on it. Pure move — no behaviour change.
 *
 * This is ADVISORY: it never blocks a save. It reports how specific the
 * triggers are, whether the memory looks like a near-duplicate of one that
 * already exists, and whether its `recall_when` phrases collide with the rest
 * of its scope. The numbers it returns have to mean what their names say —
 * that was the whole point of #239.
 */
import {
  SaveMemoryInput,
  containsInjectedBlock,
  scanForInjection,
  formatInjectionAdvisory,
} from "@bastra-recall/core";
import { detectLanguage } from "./learned-recall/language.js";
import { envInt } from "./env.js";
import {
  fieldSimilarity,
  triggerRestatesSummary,
  DUPLICATE_SIMILARITY_MIN,
  tokens as words,
  type SimilarityFields,
} from "./save-similarity.js";
import type { ToolDeps } from "./tool-deps.js";

const RECALL_FLOOR = envInt("BASTRA_RECALL_FLOOR", 30);

/** #239: upper bound for the collision scan. The pool decides `k`, but a
 *  pathological scope must not turn an advisory into a full-index sweep on
 *  every save. Above this the count is reported as a lower bound. */
const COLLISION_SCAN_MAX = 300;

export interface SaveQualityResult {
  /** 0-100 advisory score: higher means more specific, less duplicative triggers. */
  score: number;
  band: "low" | "medium" | "high";
  issues: string[];
  suggestions: string[];
  /** #239: `similarity` is a normalized 0..1 content overlap, NOT the raw BM25
   *  score this used to expose. The old field was additive, query-dependent and
   *  ran into the tens of thousands, which invited comparison with the capped
   *  hybrid recall score even though the two scales mean different things. */
  duplicate_candidates: Array<{ id: string; similarity: number; title: string }>;
  trigger_collisions: Array<{
    trigger: string;
    count: number;
    examples: string[];
    /** #239: true when `count` is bounded by the retrieval cap and the real
     *  number is higher. An exact count cannot reuse `SearchIndex.recall` —
     *  staleness/demotion multipliers are applied only to the already-sliced
     *  candidate set — so the honest move is to mark the bound rather than
     *  render a capped value as exact. */
    at_least?: boolean;
    /** Memories the scope/type filter admits at all — "20 of 21 admitted" is
     *  actionable where a bare "20" is not, and it makes the signal comparable
     *  across vault sizes. */
    admitted_pool?: number;
  }>;
}

export const GENERIC_TRIGGER_WORDS = new Set([
  "api",
  "app",
  "auth",
  "bug",
  "code",
  "css",
  "data",
  "db",
  "debug",
  "design",
  "docs",
  "error",
  "fix",
  "frontend",
  "ios",
  "js",
  "macos",
  "memory",
  "node",
  "python",
  "react",
  "refactor",
  "server",
  "swift",
  "test",
  "typescript",
  "ui",
  "ux",
]);

function triggerSpecificityIssue(trigger: string): string | undefined {
  const tokens = words(trigger);
  if (tokens.length <= 1) return `recall_when '${trigger}' is too short/generic`;
  if (tokens.length <= 2 && tokens.every((t) => GENERIC_TRIGGER_WORDS.has(t))) {
    return `recall_when '${trigger}' is only generic technology words`;
  }
  return undefined;
}

function buildSpecificTriggerSuggestion(input: SaveMemoryInput): string {
  const path = input.topic_path.join("/") || input.scope;
  const summaryTokens = words(input.summary)
    .filter((t) => !GENERIC_TRIGGER_WORDS.has(t))
    .slice(0, 5)
    .join(" ");
  const anchor = summaryTokens || input.title.toLowerCase();
  return `tighten recall_when around an action + anchor, e.g. 'about to ${input.type} in ${path}: ${anchor}'`;
}

// #159: admission rules — vault rot has a known shape. Negative capability
// claims harden into standing refusals that outlive the problem; imperative
// phrasing gets re-read as a directive in unrelated later contexts. Both are
// advisory-only flags, never blocks.
const NEGATIVE_CLAIM_RE =
  /\b(is broken|does ?n[o']?t work|not working|no longer works|never works|funktioniert nicht( mehr)?|ist kaputt|geht nicht( mehr)?)\b/i;
const FIX_MARKER_RE =
  /\b(fix(ed)?|lösung|solution|workaround|abhilfe|stattdessen|instead|how to apply)\b/i;
const IMPERATIVE_LEAD_RE =
  /^(always|never|don'?t|do not|avoid|remember to|ensure|immer|nie(mals)?|benutze|verwende|vermeide|nutze|stelle sicher)\b/i;

/**
 * @param excludeId Die EFFEKTIVE id des Saves (`input.id ?? slugify(title)`).
 *   Muss vom Caller berechnet werden: `input.id` ist auf dem dokumentierten
 *   Normalpfad `undefined` (der Agent schickt nur den Titel), und ein Filter
 *   gegen `undefined` schließt nichts aus — das Memory fand beim Overwrite
 *   sich selbst als Top-Duplikat und kollidierte mit den eigenen Triggern.
 */
export function scoreSaveQuality(
  deps: ToolDeps,
  input: SaveMemoryInput,
  excludeId: string,
): SaveQualityResult {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const triggerIssues = input.recall_when
    .map(triggerSpecificityIssue)
    .filter((issue): issue is string => issue !== undefined);
  if (triggerIssues.length > 0) {
    issues.push(...triggerIssues);
    suggestions.push(buildSpecificTriggerSuggestion(input));
    score -= Math.min(55, triggerIssues.length * 25);
  }

  const genericTags = input.tags.filter((tag) => {
    const tokens = words(tag);
    return tokens.length === 1 && GENERIC_TRIGGER_WORDS.has(tokens[0]);
  });
  if (genericTags.length > 0) {
    issues.push(`generic tags: ${genericTags.join(", ")}`);
    suggestions.push("add at least one project/component/outcome tag so future matches are narrower");
    score -= Math.min(24, genericTags.length * 12);
  }

  // #159: 'X is broken / doesn't work' without a fix becomes a standing
  // refusal that keeps surfacing long after the problem was solved
  if (
    NEGATIVE_CLAIM_RE.test(`${input.title} ${input.summary}`) &&
    !FIX_MARKER_RE.test(`${input.summary} ${input.body}`)
  ) {
    issues.push("negative capability claim without a fix — hardens into a standing refusal");
    suggestions.push(
      "capture the FIX (install step, config, env var) instead of the failure as a constraint — or add the fix to the body",
    );
    score -= 12;
  }

  // #159: imperative lead reads as a directive when recalled in unrelated
  // contexts — declarative facts age better
  if (IMPERATIVE_LEAD_RE.test(input.title.trim()) || IMPERATIVE_LEAD_RE.test(input.summary.trim())) {
    issues.push("imperative phrasing — re-reads as a self-directive in unrelated later contexts");
    suggestions.push("state it as a declarative fact: 'User prefers …' / 'X requires Y', not 'Always/Never …'");
    score -= 8;
  }

  // #238 (zzallirog, measured on a 471-note vault): 81% of real notes had
  // recall_when[0] as a verbatim copy of the summary. That spends the weight-5
  // field on text already indexed at weight 2 — bytes without signal, diluting
  // the one field that decides whether a memory surfaces at the right moment.
  // Rewriting to distinct triggers moved that vault's recall@5 from 0.457 to
  // 0.565 while getting SMALLER. Trust the direction, not the magnitude:
  // single vault, authored queries, small per-arm n.
  const restating = input.recall_when.filter((trigger) => triggerRestatesSummary(trigger, input.summary));
  if (restating.length > 0) {
    issues.push(
      `recall_when restates the summary: ${restating.map((t) => `'${t}'`).join(", ")} — the weight-5 trigger field carries text already indexed at weight 2`,
    );
    suggestions.push(
      "author each trigger as a SITUATION where this should surface ('about to write a Tailwind grid'), not a paraphrase of the summary",
    );
    // Small nudge, like its advisory siblings. This is an authoring hint, not
    // a defect: the memory still works, it just spends its best field badly.
    score -= Math.min(16, restating.length * 8);
  }

  // #231 (language-first recall): the hook manufactures English queries on every
  // box, so on a non-English vault the highest-weighted field (recall_when)
  // structurally can't match English-authored triggers. If the user's primary
  // language is set and non-English but the joined triggers read as English,
  // nudge toward authoring in their language. Conservative by construction:
  // detectLanguage only fires on a confident "en" (it abstains on short /
  // code-shaped / ambiguous input and can only tell de/en apart, so e.g. a
  // Russian primary with Russian triggers abstains and never trips this),
  // advisory only — never a rejection. A false negative is cheaper here.
  const primaryLang = deps.primaryLanguage;
  if (primaryLang && primaryLang !== "en" && detectLanguage(input.recall_when.join(" ")).lang === "en") {
    issues.push(`recall_when reads as English but your primary language is '${primaryLang}'`);
    suggestions.push(
      `author triggers in '${primaryLang}', keeping only genuine English tech terms (daemon, deploy, hook, …) as cross-lingual anchors`,
    );
    score -= 8;
  }

  // #149: a complete hook/context block quoted in memory content is
  // conversation scaffolding, not memory — it re-enters the index via body
  // search and (title/summary) doc2query. Advisory only: save content is never
  // silently rewritten; the agent removes the block and re-saves.
  const injectedTags = Array.from(
    new Set([
      ...containsInjectedBlock(input.title),
      ...containsInjectedBlock(input.summary),
      ...containsInjectedBlock(input.body),
    ]),
  );
  if (injectedTags.length > 0) {
    issues.push(`injected context blocks in content: <${injectedTags.join(">, <")}>`);
    suggestions.push(
      "remove quoted hook/context blocks (<recall-hints>, <session-context>, <system-reminder>, …) — they are conversation scaffolding, not memory content",
    );
    score -= 20;
  }

  // #147: Injection-Marker im Save-Inhalt — advisory only, nie blocken (der
  // Flag ist billig, ein verpasster Marker nicht). Trifft vor allem Captures
  // von Third-Party-Content (Bridge, zitierte Dokumente); rein user-eigene
  // Memories triggern die Muster praktisch nie.
  const injectionFindings = scanForInjection([input.title, input.summary, input.body].join("\n"));
  const injectionAdvisory = formatInjectionAdvisory(injectionFindings);
  if (injectionAdvisory) {
    issues.push(injectionAdvisory);
    suggestions.push(
      "review the flagged spans — quoted third-party material keeps the flag as provenance; if it is your own phrasing, reword it",
    );
    score -= 15;
  }

  // #162: kurze, diskriminierende Felder (title, tags, recall_when) zuerst,
  // die potentiell lange summary zuletzt — falls der QUERY_MAX_CHARS-Cap
  // greift, fällt nur Summary-Schwanz weg, nie ein diskriminierender Term.
  // #239: BM25 generates candidates, it does NOT decide. Its raw score is
  // additive and query-dependent — repeating a term multiplies it, corpus size
  // moves it — so the old `hit.score >= 20` gate flagged unrelated memories at
  // five-digit "scores" and pointed agents at the wrong overwrite target. The
  // decision now runs on `fieldSimilarity` (0..1, set-based, vault-independent).
  // Query terms are deduped before retrieval so repetition cannot widen the net
  // either.
  const duplicateQuery = [
    ...new Set(words([input.title, ...input.tags, ...input.recall_when, input.summary].join(" "))),
  ].join(" ");
  const asFields = (m: { title: string; summary: string; tags?: string[]; recall_when?: string[] }): SimilarityFields => ({
    title: m.title,
    summary: m.summary,
    tags: m.tags ?? [],
    recall_when: m.recall_when ?? [],
  });
  const self = asFields(input);
  const duplicateCandidates = deps.search
    .recall(duplicateQuery, { k: 10, scope: input.scope, type: input.type, allow_private: false })
    .filter((hit) => hit.id !== excludeId)
    .map((hit) => {
      // The hit carries only title/summary; tags and recall_when — the fields
      // the author wrote to be matched — come from the vault.
      const stored = deps.vault.get(hit.id)?.fm;
      return {
        id: hit.id,
        title: hit.title,
        similarity: fieldSimilarity(
          self,
          asFields({
            title: stored?.title ?? hit.title,
            summary: stored?.summary ?? hit.summary,
            tags: stored?.tags,
            recall_when: stored?.recall_when,
          }),
        ),
      };
    })
    .filter((candidate) => candidate.similarity >= DUPLICATE_SIMILARITY_MIN)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map((candidate) => ({ ...candidate, similarity: Math.round(candidate.similarity * 1000) / 1000 }));
  if (duplicateCandidates.length > 0) {
    const top = duplicateCandidates[0];
    issues.push(`possible duplicate: ${top.id} (similarity ${top.similarity})`);
    suggestions.push(`consider load_memory('${top.id}') and overwrite/update instead of creating a near-duplicate`);
    // #239: the penalty follows HOW similar, not how many candidates came back.
    // The old `12 + n*6` charged 18 points for one candidate regardless of
    // whether it was a near-copy or a distant neighbour.
    score -= Math.round(30 * top.similarity);
  }

  // #239: the scope/type filter decides which memories a trigger could collide
  // with at all. "20 of 21 admitted" says the scope shares vocabulary; a bare
  // "20" says nothing and does not compare across vaults.
  const admittedPool = deps.vault
    .list()
    .filter((m) => m.fm.scope === input.scope && m.fm.type === input.type && m.fm.id !== excludeId).length;
  const triggerCollisions = input.recall_when
    .map((trigger) => {
      // #108: ohne den Noise-Floor zählte das die rohe top-k-Liste — jeder
      // Trigger meldete "matches 20 memories" (k-Cap, keine Kollisionen).
      // Kollision = ein anderes Memory, das dieser Trigger ÜBER dem Floor
      // hochspülen würde, exakt wie recall() selbst filtert.
      //
      // #239: `k` was 20 while the reported number was rendered as exact, so a
      // trigger matching 146 memories reported "19". `k` now follows the pool,
      // and whatever the cap still hides is marked rather than hidden.
      const k = Math.max(20, Math.min(admittedPool, COLLISION_SCAN_MAX));
      const raw = deps.search.recall(trigger, { k, scope: input.scope, type: input.type, allow_private: false });
      const hits = raw.filter((hit) => hit.id !== excludeId).filter((hit) => hit.score >= RECALL_FLOOR);
      return {
        trigger,
        count: hits.length,
        examples: hits.slice(0, 3).map((h) => h.id),
        // Bounded either by our own cap or by the pool being bigger than it.
        ...(raw.length >= k && admittedPool > k ? { at_least: true } : {}),
        admitted_pool: admittedPool,
      };
    })
    .filter((collision) => collision.count >= 3);
  if (triggerCollisions.length > 0) {
    const top = triggerCollisions[0];
    const howMany = `${top.at_least ? "at least " : ""}${top.count} of ${top.admitted_pool}`;
    issues.push(`trigger collision: ${top.trigger} already matches ${howMany} memories in this scope`);
    suggestions.push("make high-collision triggers include a concrete action, subsystem, failure mode, or file family");
    score -= Math.min(30, triggerCollisions.length * 12);
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: clamped,
    band: clamped >= 80 ? "high" : clamped >= 50 ? "medium" : "low",
    issues,
    suggestions: Array.from(new Set(suggestions)),
    duplicate_candidates: duplicateCandidates,
    trigger_collisions: triggerCollisions,
  };
}
