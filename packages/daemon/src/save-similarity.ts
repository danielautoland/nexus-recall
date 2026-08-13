/**
 * #239 — normalized content similarity for the save-time advisories.
 *
 * `save_quality` used to gate its duplicate advisory on a raw BM25 score
 * (`hit.score >= 20`). BM25 is additive and query-dependent: repeating a term
 * multiplies it (`cors` 192 → `cors`×20 = 3849 on the reporter's vault), it
 * grows with corpus size and field boosts, and it has no stable meaning at any
 * absolute threshold. Field reports showed unrelated memories presented as
 * near-duplicates at five-digit "scores", pointing agents at the wrong
 * overwrite target.
 *
 * BM25 stays the cheap candidate generator. The decision is made here, on a
 * value that means the same thing on every vault:
 *
 *   similarity = Σ weight(t) for t ∈ A∩B  /  Σ weight(t) for t ∈ A∪B
 *
 * A weighted Jaccard over the authored high-signal fields. Symmetric, bounded
 * 0..1, and immune to term repetition because it works on SETS — the property
 * the raw score lacked.
 *
 * Token weights come from the field a token appears in (its strongest one).
 * `recall_when` outranks the rest because it is the field the author wrote
 * specifically to be matched; `summary` counts least because it is prose and
 * shares the most vocabulary with unrelated notes.
 *
 * Shared with #238 on purpose: that issue adds a "recall_when merely restates
 * summary" advisory, which needs the same primitive. Two competing similarity
 * measures inside one scoring function would be worse than either.
 */

/** Case-folded tokens in ANY script — the Unicode class matters, an ASCII
 *  `\w` regex shreds exactly the tokens that carry the signal on a non-English
 *  vault (`Lösung → sung`, `Größe → gr, e`).
 *
 *  Exported as the single tokenizer for the save path: `save-quality.ts` and
 *  the acted-on token derivation in `tool-handlers.ts` both use it, so a
 *  tokenizer fix lands in one place. This module is a leaf (no project
 *  imports), so nobody can create a cycle through it. */
export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
}

/**
 * Umlaut folding for the SIMILARITY path only (#325).
 *
 * "nächste Nachricht an zzalli entwerfen" and "naechste Nachricht an zzalli
 * entwerfen" are the same sentence, and without this they are two different
 * tokens: four memory pairs in a real vault scored 0.80 instead of 1.0 purely
 * because of ä vs ae, so a collision the author would call obvious was never
 * reported. Both spellings occur in one vault because one of them was typed
 * and the other came from a keyboard or a paste.
 *
 * Transliteration MUST run before NFKD — `slugify` (`core/src/save.ts`)
 * documents why: NFKD splits ä into a + combining mark, the diacritic strip
 * turns that into a bare "a", and a later ä-replace finds nothing, so ä/ö/ü
 * would degrade to a/o/u instead of ae/oe/ue.
 *
 * Deliberately NOT applied inside `tokens()`, though that would be one line
 * fewer. `tokens()` is also the tokenizer for `distinctiveTokensForActedOn`
 * (`tool-handlers.ts:536`), whose output rides in telemetry and survives a
 * restart; folding there would silently change what open episodes match
 * against, for no gain on this problem. `tokens()` answers "where are the word
 * boundaries", folding is a choice this similarity measure makes.
 */
export function foldUmlauts(token: string): string {
  return token
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "");
}

/** A token reduced to its comparable form, or null when it carries no signal.
 *  The stopword list is folded too — otherwise "für" survives as "fuer", is no
 *  longer recognised as a function word, and starts making any two German
 *  notes look similar, which is the failure mode STOPWORDS exists to prevent. */
function contentToken(raw: string): string | null {
  const token = foldUmlauts(raw);
  if (token.length < MIN_TOKEN_LENGTH || FOLDED_STOPWORDS.has(token)) return null;
  return token;
}

/** Function words carry no topical signal, so leaving them in would make any
 *  two German notes look similar — which is the reported failure mode. Same
 *  list as the reflex lane's (`reflex.ts`), duplicated rather than imported:
 *  that one is tuned for prompt matching and must stay free to drift. */
const STOPWORDS = new Set([
  // EN
  "about", "after", "all", "and", "any", "are", "because", "been", "before",
  // NOTE: this list is folded through `foldUmlauts` where it is used, so "für"
  // and "über" below still match after folding. Write entries the way a German
  // writes them; the folding is applied to both sides.
  "between", "but", "can", "for", "from", "has", "have", "how", "into", "its",
  "just", "not", "only", "should", "than", "that", "the", "their", "then",
  "there", "these", "this", "through", "was", "were", "what", "when", "which",
  "will", "with", "without", "would", "you", "your",
  // DE
  "aber", "alle", "als", "auch", "auf", "aus", "bei", "beim", "bitte", "das",
  "dass", "dem", "den", "der", "des", "die", "durch", "ein", "eine", "einem",
  "einen", "einer", "für", "hat", "ist", "kann", "mal", "man", "mit", "nach",
  "nicht", "noch", "nur", "oder", "sich", "sind", "soll", "über", "und", "von",
  "vor", "war", "wenn", "werden", "wie", "wird", "zum", "zur",
]);

/** The list above, in the same shape tokens arrive in after folding. */
const FOLDED_STOPWORDS = new Set([...STOPWORDS].map(foldUmlauts));

/** A single character carries no topical signal and inflates the union. */
const MIN_TOKEN_LENGTH = 2;

export interface SimilarityFields {
  title: string;
  summary: string;
  tags: string[];
  recall_when: string[];
}

/** Per-field token weight. Ordered by how deliberately the author chose the
 *  words: triggers are written to be matched, prose is written to be read. */
const FIELD_WEIGHTS: Array<[keyof SimilarityFields, number]> = [
  ["recall_when", 1.0],
  ["title", 0.8],
  ["tags", 0.6],
  ["summary", 0.35],
];

/** token → its strongest field weight in this memory. */
function weighTokens(fields: SimilarityFields): Map<string, number> {
  const out = new Map<string, number>();
  for (const [field, weight] of FIELD_WEIGHTS) {
    const raw = fields[field];
    const text = Array.isArray(raw) ? raw.join(" ") : (raw ?? "");
    for (const raw of tokens(text)) {
      const token = contentToken(raw);
      if (token === null) continue;
      const prev = out.get(token);
      if (prev === undefined || weight > prev) out.set(token, weight);
    }
  }
  return out;
}

/**
 * Weighted Jaccard over the authored fields, 0..1.
 *
 * 1.0 means the two memories are built from the same content words; 0 means
 * they share none. Repetition cannot move it, and neither can vault size —
 * unlike the raw BM25 score this replaces.
 *
 * A shared token contributes the WEAKER of its two weights: a word that is a
 * deliberate trigger on one side but incidental prose on the other is weak
 * evidence, and scoring it as strong is how "broad infrastructure vocabulary"
 * used to read as a duplicate.
 */
export function fieldSimilarity(a: SimilarityFields, b: SimilarityFields): number {
  const wa = weighTokens(a);
  const wb = weighTokens(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  let union = 0;
  for (const [token, weight] of wa) {
    const other = wb.get(token);
    if (other === undefined) {
      union += weight;
      continue;
    }
    intersection += Math.min(weight, other);
    union += Math.max(weight, other);
  }
  for (const [token, weight] of wb) {
    if (!wa.has(token)) union += weight;
  }
  return union === 0 ? 0 : intersection / union;
}

/**
 * #238 — how much of `text` is already contained in `inside`, 0..1.
 *
 * Containment rather than Jaccard, because the two sides are deliberately
 * different lengths: a trigger is a phrase, a summary is a sentence. A verbatim
 * copy of the summary's opening scores 1.0 here, where symmetric overlap would
 * be dragged down by everything the summary says beyond it.
 *
 * Shares `tokens()` and the stopword filter with `fieldSimilarity` on purpose:
 * two competing notions of "similar" inside one scoring function is exactly
 * what #239's thread warned against.
 */
export function containedIn(text: string, inside: string): number {
  const a = contentTokens(text);
  const b = contentTokens(inside);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / a.size;
}

function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of tokens(text)) {
    const token = contentToken(raw);
    if (token !== null) out.add(token);
  }
  return out;
}

/**
 * A `recall_when` phrase whose content words are this fully covered by the
 * summary is restating it rather than naming a situation (#238).
 *
 * High on purpose. `recall_when` is the weight-5 field and the summary is
 * weight 2, so a copy spends the strongest signal on text that is already
 * indexed — but a trigger that merely shares vocabulary with the summary is
 * normal and must not be flagged. Only near-total containment is evidence.
 */
export const TRIGGER_RESTATES_SUMMARY_MIN = 0.85;

/** Below this many content words a coverage ratio is noise: three of three
 *  shared words is a coincidence, not a restatement. */
export const TRIGGER_MIN_CONTENT_TOKENS = 4;

/** True when this trigger reads as a paraphrase of the summary. */
export function triggerRestatesSummary(trigger: string, summary: string): boolean {
  const triggerTokens = contentTokens(trigger);
  if (triggerTokens.size < TRIGGER_MIN_CONTENT_TOKENS) return false;
  if (contentTokens(summary).size === 0) return false;
  return containedIn(trigger, summary) >= TRIGGER_RESTATES_SUMMARY_MIN;
}

/**
 * #300 — when does another memory's trigger CLAIM this one's situation?
 *
 * At the end of the scale on purpose. `containedIn(mine, theirs) === 1` reads
 * as "every content word my trigger says, their trigger already says" — the
 * boundary is a property of the measure, not a number somebody picked, so it
 * cannot rot the way an absolute score floor did. Anything below 1.0 is a
 * paraphrase question, and paraphrases need a goldset this vault does not have:
 * measured on the 661-memory vault, the 0.80–0.99 band mixes genuine
 * restatements ("neue Server Action absichern" / "… schreiben") with templated
 * triggers whose only distinguishing word is a proper noun ("<handle> taucht
 * auf (PR, Issue, Kommentar)"), and no threshold separates the two.
 */
export const TRIGGER_CLAIMS_SITUATION_MIN = 1;

/**
 * Above this, two memories are close enough that the agent should look before
 * creating a third one.
 *
 * Deliberately NOT calibrated on a labeled fixture set: this is an advisory
 * that does not block the save, and the converged thread agreed a dataset
 * build-out is disproportionate for it. It is set where the regression matrix
 * separates authored near-duplicates from same-domain neighbours, and it is a
 * named constant so moving it is one edit and one test run.
 */
export const DUPLICATE_SIMILARITY_MIN = 0.34;
