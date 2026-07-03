/**
 * Tests for the guided-install wizard's pure parts: the gate that decides
 * wizard vs. classic path, the surface-choice builder (detection →
 * preselection), and the custom-vault path expansion. The interactive clack
 * flow itself is exercised by the expect-based smoke, not here (no TTY on CI).
 *
 * Run: npx tsx --test packages/daemon/__tests__/wizard.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  shouldRunWizard,
  buildSurfaceChoices,
  detectSurfaces,
  expandUserPath,
  decideWizardSemantic,
} from "../src/cli/wizard.js";
import { cmdInstall } from "../src/cli/commands.js";
import type { ParsedArgs } from "../src/cli/types.js";

// ─── gate ────────────────────────────────────────────────────────────────────

test("wizard gate: bare install on a TTY → wizard", () => {
  assert.equal(shouldRunWizard({ surface: null, interactive: true, yes: false, dryRun: false }), true);
});

test("wizard gate: every scripted invocation stays on the classic path", () => {
  // named surface / all
  assert.equal(shouldRunWizard({ surface: "all", interactive: true, yes: false, dryRun: false }), false);
  assert.equal(shouldRunWizard({ surface: "claude-code", interactive: true, yes: false, dryRun: false }), false);
  // non-TTY (CI, pipes, hooks) — must keep the deterministic "missing surface" error
  assert.equal(shouldRunWizard({ surface: null, interactive: false, yes: false, dryRun: false }), false);
  // automation flags
  assert.equal(shouldRunWizard({ surface: null, interactive: true, yes: true, dryRun: false }), false);
  assert.equal(shouldRunWizard({ surface: null, interactive: true, yes: false, dryRun: true }), false);
});

// ─── surface choices ─────────────────────────────────────────────────────────

test("surface choices: detected clients are preselected and hinted", () => {
  const { options, initialValues } = buildSurfaceChoices({
    "claude-code": true,
    "claude-desktop": false,
    cursor: true,
  });
  assert.deepEqual(options.map((o) => o.value), ["claude-desktop", "claude-code", "cursor"]);
  assert.deepEqual(new Set(initialValues), new Set(["claude-code", "cursor"]));
  assert.equal(options.find((o) => o.value === "claude-code")?.hint, "detected");
  assert.equal(options.find((o) => o.value === "claude-desktop")?.hint, "not detected");
});

test("surface choices: nothing detected → everything preselected (plain Enter = full install)", () => {
  const { options, initialValues } = buildSurfaceChoices({});
  assert.deepEqual(initialValues, options.map((o) => o.value));
});

test("surface choices: labels drop the parenthetical detail", () => {
  const { options } = buildSurfaceChoices({});
  for (const o of options) assert.ok(!o.label.includes("("), `label still has parens: ${o.label}`);
});

// ─── detection ───────────────────────────────────────────────────────────────

test("detectSurfaces: home-relative traces are found in the given home", async () => {
  // Only home-relative traces are assertable: absolute ones (/Applications/…)
  // depend on the machine running the tests.
  const home = await mkdtemp(join(tmpdir(), "bastra-wizard-home-"));
  try {
    assert.equal(detectSurfaces(home)["claude-code"], false);
    await writeFile(join(home, ".claude.json"), "{}", "utf8");
    assert.equal(detectSurfaces(home)["claude-code"], true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// ─── semantic step decision ──────────────────────────────────────────────────

test("wizard semantic: --ollama = consent, never asks (flag beats everything)", () => {
  assert.equal(decideWizardSemantic({ ollamaFlag: "auto", effectiveProvider: "none", daemonSemanticOn: false }), "on");
  assert.equal(decideWizardSemantic({ ollamaFlag: "auto", effectiveProvider: "ollama", daemonSemanticOn: false }), "on");
});

test("wizard semantic: effective provider or semantic daemon → nothing to ask", () => {
  assert.equal(decideWizardSemantic({ ollamaFlag: null, effectiveProvider: "ollama", daemonSemanticOn: false }), "already");
  assert.equal(decideWizardSemantic({ ollamaFlag: null, effectiveProvider: "none", daemonSemanticOn: true }), "already");
  // --no-ollama with an effective provider: skips provisioning, disables nothing
  assert.equal(decideWizardSemantic({ ollamaFlag: "skip", effectiveProvider: "openai", daemonSemanticOn: false }), "already");
});

test("wizard semantic: --no-ollama = opt-out, never asks (review find 2026-07-03)", () => {
  assert.equal(decideWizardSemantic({ ollamaFlag: "skip", effectiveProvider: "none", daemonSemanticOn: false }), "later");
});

test("wizard semantic: no flag, nothing effective → ask", () => {
  assert.equal(decideWizardSemantic({ ollamaFlag: null, effectiveProvider: "none", daemonSemanticOn: false }), "ask");
});

// ─── install --help gate ─────────────────────────────────────────────────────

test("install --help documents instead of acting (wizard or missing-surface error)", async () => {
  const args: ParsedArgs = {
    command: "install", surface: null, dryRun: false, vaultPath: null,
    showHelp: true, showVersion: false, json: false, quiet: false, yes: false,
    fix: false, withStopHook: false, staged: false, ollama: null, positional: ["install"],
  };
  const origWrite = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    const rc = await cmdInstall(args);
    assert.equal(rc, 0);
    assert.match(out, /Usage:/);
  } finally {
    process.stdout.write = origWrite;
  }
});

// ─── path expansion ──────────────────────────────────────────────────────────

test("expandUserPath: tilde, relative, and absolute inputs", () => {
  assert.equal(expandUserPath("~", "/Users/x"), "/Users/x");
  assert.equal(expandUserPath("~/Vault", "/Users/x"), "/Users/x/Vault");
  assert.equal(expandUserPath("  ~/Vault  ", "/Users/x"), "/Users/x/Vault");
  assert.equal(expandUserPath("/abs/path", "/Users/x"), "/abs/path");
  assert.equal(expandUserPath("rel/path", "/Users/x"), resolve("rel/path"));
});
