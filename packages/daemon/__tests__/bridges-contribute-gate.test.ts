/**
 * `bastra bridges contribute` stays shut — and says why, accurately.
 *
 * The refusal is deliberate. #129 (OPEN) opens with "Before `bastra bridges
 * contribute` is wired, harvested bridges need a verification contract on par
 * with the Commons recipe contract": a harvested bridge has promotion
 * (`evidence`) but no demotion, the judge that mints it is the judge that scores
 * it, and `expansionsFor` fires on any query sharing one trigger term, so a
 * single mint perturbs every query that shares it. Wiring contribution without
 * that contract would ship exactly those four failure modes into a shared repo.
 *
 * What was wrong was only the stated reason: the message blamed #121, which
 * closed 2026-06-16, while `mint` and `harvest` in the same file had been
 * producing real bridges since. A stale blocker invites someone to "finish" a
 * hold that is doing its job — which is what this test exists to prevent.
 *
 * Run: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/bridges-contribute-gate.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { cmdBridges } from "../src/cli/bridges.js";

async function runContribute(): Promise<{ rc: number; out: string }> {
  let captured = "";
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string) => ((captured += c), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string) => ((captured += c), true)) as typeof process.stderr.write;
  try {
    const rc = await cmdBridges({ sub: "contribute", positional: [] });
    return { rc, out: captured };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

test("contribute refuses — the #129 verification contract is not met", async () => {
  const { rc, out } = await runContribute();
  assert.equal(rc, 1, "a deliberate hold reports failure, so a script cannot mistake it for a submission");
  assert.match(out, /not yet available/);
});

test("the refusal names the LIVE gate, not the closed one", async () => {
  const { out } = await runContribute();
  assert.match(out, /#129/, "the live blocker is the verification contract");
  assert.doesNotMatch(
    out,
    /depends on #121/,
    "#121 closed 2026-06-16 and mint/harvest work — blaming it invites someone to 'finish' a hold that is intentional",
  );
});

test("the refusal says what is missing, so the gate is actionable", async () => {
  const { out } = await runContribute();
  assert.match(out, /held-out|regression|demotion/i, "name the contract, not just the issue number");
});
