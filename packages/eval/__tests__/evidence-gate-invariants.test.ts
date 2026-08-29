/**
 * The three §18.2 component gates that are INVARIANTS, tested at the predicate.
 *
 * Four of the seven "vorläufige Komponenten-Schaltgates für den
 * Evidenzentscheid" are corpus measurements and need a run. Three are not: they
 * are properties `decideHit` either has or does not, on any input, and pinning
 * them here means a regression shows up in the suite instead of in a
 * measurement someone has to remember to take.
 *
 *   - a `required` needs a hard anchor or independent signals;
 *   - a hit on a DERIVED cue alone must not produce `required`;
 *   - a hit reached only over a graph hop must not produce `required` (C-046).
 *
 * `packages/eval/src/goldset-gate.ts` counts the same three over a scored run —
 * how often they are exercised, and by how much. The numbers there are the
 * corpus side of these tests, not a substitute for them.
 *
 * Run: npx tsx --test packages/eval/__tests__/evidence-gate-invariants.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideHit, type RecallHit } from "@bastra-recall/core";

/** A hit with everything the decision reads, defaulting to "no signal at all". */
const hit = (over: Partial<RecallHit> = {}): RecallHit =>
  ({
    id: "m1",
    title: "Ein Memory",
    type: "lesson",
    scope: "bastra-recall",
    summary: "",
    topic_path: [],
    score: 120,
    matched_terms: [],
    ...over,
  }) as RecallHit;

test("a hit reached only over a graph hop never becomes required (C-046, §18.2)", () => {
  // Everything else is as strong as it gets: an exact identifier in the title
  // and a matching scope. The hop alone has to be enough to withhold the duty.
  const direct = decideHit({
    hit: hit({ title: "packages/core/src/search.ts", matched_recall_when: true, hop: "direct" }),
    queryTerms: ["packages/core/src/search.ts"],
    scope: "bastra-recall",
  });
  assert.equal(direct.decision, "required", "the same hit without the hop IS a duty");

  const hopped = decideHit({
    hit: hit({ title: "packages/core/src/search.ts", matched_recall_when: true, hop: "1-hop" }),
    queryTerms: ["packages/core/src/search.ts"],
    scope: "bastra-recall",
  });
  assert.notEqual(hopped.decision, "required", "reached only through a neighbour, so it carries no duty");
  assert.equal(hopped.abstain_reason, "hop_only", "and the reason says which rule withheld it");
});

test("a required always rests on a hard anchor or on independent signals (§18.2)", () => {
  // The predicate's own rule, asserted from the outside: nothing may reach
  // `required` on a single soft signal.
  const scopeOnly = decideHit({
    hit: hit({ hop: "direct" }),
    queryTerms: ["etwas", "ganz", "anderes"],
    scope: "bastra-recall",
  });
  assert.equal(scopeOnly.decision, "optional", "being in the right scope is a hint, not a duty");
  assert.equal(scopeOnly.evidence.exact_identifier, false);
  assert.equal(scopeOnly.evidence.recall_when_coverage, 0);

  // A hard anchor on its own is enough — that is the "harter Anker" half. It
  // has to be identifier-SHAPED to count: `IDENTIFIER_SHAPE` wants a delimiter,
  // so a bare camelCase word is a word and not an anchor.
  const anchored = decideHit({
    hit: hit({ title: "siehe packages/core/src/search.ts", hop: "direct" }),
    queryTerms: ["packages/core/src/search.ts"],
    scope: null,
  });
  assert.equal(anchored.decision, "required");
  assert.equal(anchored.evidence.exact_identifier, true, "and it is the identifier that carries it");
  assert.equal(anchored.evidence.scope_match, false, "on its own — no scope, no arms, no trigger");

  const bareWord = decideHit({
    hit: hit({ title: "tokenizeWithIdentifiers", hop: "direct" }),
    queryTerms: ["tokenizeWithIdentifiers"],
    scope: null,
  });
  assert.equal(bareWord.evidence.exact_identifier, false, "a word without a delimiter is not an identifier");
  assert.notEqual(bareWord.decision, "required");
});

test("a derived cue alone does not carry a required (§18.2, §10.2)", () => {
  // `recall_when_coverage` is defined over the HAND-written trigger only, so a
  // hit that owes its place to a generated cue arrives here with coverage 0 and
  // no identifier. Whatever it then becomes, it is not a duty on the cue's
  // account — it would need two other signals, and the test denies it those.
  const cueOnly = decideHit({
    hit: hit({ matched_recall_when: false, hop: "direct" }),
    queryTerms: ["worte", "die", "nirgends", "wörtlich", "stehen"],
    scope: null,
  });
  assert.equal(cueOnly.evidence.recall_when_coverage, 0, "a derived cue is never itself evidence");
  assert.equal(cueOnly.evidence.exact_identifier, false);
  assert.notEqual(cueOnly.decision, "required");
});

test("an expired or obsolete target is never a duty, whatever else it has", () => {
  // Not one of the seven, but the same shape of rule and free to pin here: the
  // corpus counter in goldset-gate.ts would otherwise be the only thing
  // watching it.
  // The two ways core derives it: `obsolete: true`, or a `valid_until` in the
  // past. Read from the memory, so the fixtures are frontmatter, not a status
  // string somebody made up.
  const frontmatter = [
    { label: "obsolete", fm: { id: "m1", title: "packages/core/src/search.ts", obsolete: true } },
    { label: "expired", fm: { id: "m1", title: "packages/core/src/search.ts", valid_until: "2020-01-01" } },
  ];
  for (const { label, fm } of frontmatter) {
    const stale = decideHit({
      hit: hit({ title: "packages/core/src/search.ts", matched_recall_when: true, hop: "direct" }),
      memory: { fm } as never,
      queryTerms: ["packages/core/src/search.ts"],
      scope: null,
    });
    assert.notEqual(stale.decision, "required", `${label} carries no duty`);
    assert.equal(stale.abstain_reason, "stale", "and the reason names the rule");
  }
});
