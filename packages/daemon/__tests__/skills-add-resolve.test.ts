/**
 * #223 — `bastra skills add <slug>` reported success while doing nothing
 * useful. Reported by zzallirog (field test 2026-07-18): `skills add
 * uncertainty-check` printed "it now renders in the map's skills ring instead
 * of as an unwritten ghost", but the ghost in his vault is
 * `memory-uncertainty-check` — the imported-namespace form — so the command
 * minted a fresh degree-0 node beside the untouched ghost.
 *
 * In a native vault the `[[slug]]` and the node id are the same string, which
 * is why the help text claimed they always are. After a vault import they
 * differ (label prefix + slugification, `import-vault.ts:239`).
 *
 * The resolution is pure and vault-shaped, so it is tested here without
 * touching the filesystem or the registry.
 *
 * Runner: `tsx --test __tests__/skills-add-resolve.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSkillTarget } from "../src/cli/skills-cmd.js";

const ghosts = ["memory-uncertainty-check", "memory-deep-work", "notes-alpha", "notes-beta-check"];

test("an exact ghost match is taken as-is", () => {
  const r = resolveSkillTarget("memory-uncertainty-check", ghosts);
  assert.equal(r.id, "memory-uncertainty-check");
  assert.equal(r.kind, "exact");
});

test("the bare slug resolves to its namespaced ghost", () => {
  const r = resolveSkillTarget("uncertainty-check", ghosts);
  assert.equal(r.id, "memory-uncertainty-check");
  assert.equal(r.kind, "namespaced");
  assert.equal(r.input, "uncertainty-check", "the resolution must be able to say what was typed");
});

test("an ambiguous suffix resolves to nothing and reports every candidate", () => {
  const r = resolveSkillTarget("check", ["memory-uncertainty-check", "notes-beta-check"]);
  assert.equal(r.kind, "ambiguous");
  assert.equal(r.id, null);
  assert.deepEqual(r.candidates.sort(), ["memory-uncertainty-check", "notes-beta-check"]);
});

test("a slug that matches no ghost is still declared — but honestly, as a new node", () => {
  const r = resolveSkillTarget("brand-new-skill", ghosts);
  assert.equal(r.kind, "unmatched");
  assert.equal(r.id, "brand-new-skill", "declaring ahead of the link is legitimate; it just is not an adoption");
});

test("suffix matching respects the separator — 'check' must not match 'recheck'", () => {
  const r = resolveSkillTarget("check", ["memory-recheck"]);
  assert.equal(r.kind, "unmatched", "'-recheck' does not end with '-check'");
});

test("an exact match wins over a namespaced one, even when both exist", () => {
  const r = resolveSkillTarget("alpha", ["alpha", "notes-alpha"]);
  assert.equal(r.kind, "exact");
  assert.equal(r.id, "alpha");
});

test("resolution is case-insensitive on the input but returns the real node id", () => {
  const r = resolveSkillTarget("Uncertainty-Check", ghosts);
  assert.equal(r.id, "memory-uncertainty-check");
  assert.equal(r.kind, "namespaced");
});
