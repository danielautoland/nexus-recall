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
import { redecide } from "../src/goldset-gate.js";

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

test("the body is what the anchor variant takes away — and the only thing (§10.3)", () => {
  // The A1 pattern: an identifier-shaped query term appearing in flowing BODY
  // prose anchors the hit, and a hard anchor alone carries `required`. The
  // variant blanks the body and nothing else; this pins that "nothing else".
  const withBody = {
    fm: { id: "m1", title: "Ein Memory ohne Pfad im Titel", recall_when: ["wenn der Daemon klemmt"] },
    body: "wir haben das in packages/core/src/search.ts nachgezogen",
  } as never;
  const noBody = { ...(withBody as object), body: "" } as never;
  const input = {
    hit: hit({ title: "Ein Memory ohne Pfad im Titel", hop: "direct" }),
    queryTerms: ["packages/core/src/search.ts"],
    scope: null,
  };

  const before = decideHit({ ...input, memory: withBody });
  assert.equal(before.evidence.exact_identifier, true, "prose in the body anchors today");
  assert.equal(before.decision, "required", "and that alone is enough for a duty");

  const after = decideHit({ ...input, memory: noBody });
  assert.equal(after.evidence.exact_identifier, false, "the variant takes the anchor away");
  assert.notEqual(after.decision, "required");

  // Everything else the decision reads is untouched by blanking the body.
  for (const field of ["recall_when_coverage", "arm_agreement", "scope_match", "temporal_status"] as const) {
    assert.deepEqual(after.evidence[field], before.evidence[field], `${field} must not move with the body`);
  }
});

test("an anchor in the title survives the variant (§10.3)", () => {
  // The narrowing keeps title, recall_when and frontmatter — a hit anchored
  // there must be unaffected, or the variant would measure something else.
  const fm = { id: "m1", title: "packages/core/src/search.ts erklärt", recall_when: ["wenn die Suche klemmt"] };
  const input = {
    hit: hit({ title: "packages/core/src/search.ts erklärt", hop: "direct" }),
    queryTerms: ["packages/core/src/search.ts"],
    scope: null,
  };
  const before = decideHit({ ...input, memory: { fm, body: "irgendein Fließtext" } as never });
  const after = decideHit({ ...input, memory: { fm, body: "" } as never });
  assert.equal(before.decision, "required");
  assert.equal(after.decision, "required", "the title still anchors it");
  assert.equal(after.evidence.exact_identifier, true);
});

test("the variant re-derivation reproduces decideHit exactly (§10.3, #422)", () => {
  // The guarantee the whole narrowing family rests on. `redecide` combines the
  // shipped evidence itself, so it can drift from `decideHit`; every shape
  // below is a case where it could.
  const shapes = [
    { title: "packages/core/src/search.ts", terms: ["packages/core/src/search.ts"], scope: null },
    { title: "Ein Memory", terms: ["ein", "memory"], scope: null },
    { title: "Ein Memory", terms: ["voellig", "andere", "worte"], scope: "bastra-recall" },
    { title: "Ein Memory", terms: ["ein"], scope: "bastra-recall" },
  ];
  for (const s of shapes) {
    for (const hop of ["direct", "1-hop"] as const) {
      for (const fm of [
        { id: "m1", title: s.title, recall_when: ["ein memory fuer den fall"] },
        { id: "m1", title: s.title, recall_when: ["ein memory fuer den fall"], obsolete: true },
        { id: "m1", title: s.title },
      ]) {
        const d = decideHit({
          hit: hit({ title: s.title, hop, scope: "bastra-recall" }),
          memory: { fm, body: "" } as never,
          queryTerms: s.terms,
          scope: s.scope,
        });
        const mine = redecide(d.evidence, hop, s.terms.filter((t) => t.length >= 3).length);
        assert.equal(mine, d.decision, `re-derivation must match on ${JSON.stringify({ ...s, hop, fm })}`);
      }
    }
  }
});

test("the narrowings tighten only what they say they tighten (§10.3)", () => {
  // Evidence with partial coverage and arm agreement — a duty today through
  // the two-of-three rule, and exactly the population the candidates target.
  const evidence = {
    exact_identifier: false,
    recall_when_coverage: 0.25,
    arm_agreement: true,
    scope_match: false,
    temporal_status: "valid",
    lexical_score: 120,
  };
  assert.equal(redecide(evidence, "direct", 8), "required", "one shared term in eight carries a duty today");
  assert.equal(redecide(evidence, "direct", 8, { minCoverage: 0.5 }), "optional", "a relative floor withholds it");
  assert.equal(redecide(evidence, "direct", 8, { minMatchedTerms: 2 }), "required", "two of eight terms matched");
  assert.equal(redecide(evidence, "direct", 4, { minMatchedTerms: 2 }), "optional", "one of four did not");

  // Neither narrowing may push anything to no_answer: a signal that no longer
  // earns a duty is still a signal.
  for (const rule of [{ minCoverage: 0.5 }, { minMatchedTerms: 2 }]) {
    assert.notEqual(redecide(evidence, "direct", 4, rule), "no_answer", "a weakened duty stays a suggestion");
  }

  // And a hard anchor is untouched by both — they narrow the OTHER half of §10.3.
  const anchored = { ...evidence, exact_identifier: true };
  for (const rule of [{}, { minCoverage: 0.5 }, { minMatchedTerms: 2 }]) {
    assert.equal(redecide(anchored, "direct", 8, rule), "required");
  }
});
