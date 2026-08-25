/**
 * #360 — the write-time claim gate.
 *
 * A save whose `recall_when` fully contains an existing memory's trigger
 * declares a situation that memory already owns. Before the gate that produced
 * a silent sibling: #300's advisory warned, the write went through anyway, and
 * two memories answered one cue forever. The gate holds the save and makes the
 * agent name which of three things it is — successor, contradiction, or a
 * deliberate pair.
 *
 * These tests pin the issue's acceptance ("a save whose trigger fully contains
 * an existing memory does not pass without one of the three answers") plus the
 * paths that must stay open: overwrite, non-colliding saves, and a partially
 * answered set.
 *
 * Runner: `tsx --test __tests__/claim-gate.test.ts`
 * Real file vault, no mocking.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { saveMemoryHandler, resetSaveFailures, type ToolDeps } from "../src/tool-handlers.js";
import { collectClaimedTwice } from "../src/claimed-twice.js";
import { containedIn, TRIGGER_CLAIMS_SITUATION_MIN } from "../src/save-similarity.js";
import { Telemetry } from "../src/telemetry.js";

async function makeDeps(): Promise<{ deps: ToolDeps; vaultPath: string; cleanup: () => Promise<void> }> {
  const vaultPath = await mkdtemp(join(tmpdir(), "bastra-claim-gate-"));
  const vault = new Vault(vaultPath);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  resetSaveFailures();
  const deps: ToolDeps = { vault, search, telemetry: new Telemetry(), vaultPath };
  return {
    deps,
    vaultPath,
    cleanup: async () => {
      search.stop();
      await vault.stop?.();
      await rm(vaultPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

const memo = (title: string, recallWhen: string[], extra: Record<string, unknown> = {}) => ({
  title,
  type: "project-fact",
  summary: `Zusammenfassung für ${title}`,
  body: `Inhalt von ${title}.`,
  topic_path: ["deploy"],
  tags: ["deploy"],
  scope: "gateproj",
  recall_when: recallWhen,
  ...extra,
});

/** The first memory owns the situation; the second one's trigger is a strict
 *  subset of its words, which is what full containment means. */
const OWNER_TRIGGER = "das Deployment der Staging-Umgebung vorbereiten";
const CLAIMING_TRIGGER = "Deployment der Staging-Umgebung";

/** Some `md` files exist for reasons other than a memory (the audit log lives
 *  under a dot-directory, but be explicit about what we count). */
async function memoryFiles(vaultPath: string): Promise<string[]> {
  const entries = await readdir(vaultPath, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
}

test("#360: a save claiming an existing memory's situation is held, not written", async (t) => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  const before = await memoryFiles(vaultPath);

  const held = await saveMemoryHandler(deps, memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER]));

  assert.equal(held.created, false, "the gated save must not report a creation");
  assert.ok("claim_gate" in held, `expected a claim_gate result, got ${JSON.stringify(held)}`);
  const gate = (held as { claim_gate: { claimed: Array<{ id: string; claim: string }> } }).claim_gate;
  assert.equal(gate.claimed.length, 1);
  assert.equal(gate.claimed[0].id, "staging-deploy-ablauf");
  assert.equal(gate.claimed[0].claim, OWNER_TRIGGER, "the refusal must quote THEIR trigger");
  assert.match(held.note ?? "", /NOTHING WAS SAVED/);
  // All three answers have to be reachable from the message alone.
  for (const field of ["replaces", "conflict_with", "sibling_of"]) {
    assert.match(held.note ?? "", new RegExp(field), `the refusal must name ${field}`);
  }

  assert.deepEqual(
    (await memoryFiles(vaultPath)).sort(),
    before.sort(),
    "the gate must not leave a file behind",
  );
});

test("#360: `replaces` is an answer — the same save goes through", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  const result = await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], { replaces: "staging-deploy-ablauf" }),
  );

  assert.equal(result.created, true);
  assert.ok(!("claim_gate" in result), "an answered save must not be held");
});

test("#360: `sibling_of` is an answer and lands in the frontmatter", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  const result = await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], { sibling_of: ["staging-deploy-ablauf"] }),
  );

  assert.equal(result.created, true);
  const written = await readFile((result as { file_path: string }).file_path, "utf8");
  assert.match(written, /siblings:\n\s+- staging-deploy-ablauf/, `frontmatter was:\n${written.slice(0, 400)}`);

  // And the quittance holds: re-saving it does not get held again.
  resetSaveFailures();
  const again = await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], {
      sibling_of: ["staging-deploy-ablauf"],
      overwrite: true,
    }),
  );
  assert.ok(!("claim_gate" in again));
});

test("#360: answering for one of two colliding memories still leaves the other open", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Runbook", ["das Deployment der Staging-Umgebung dokumentieren"], {
      sibling_of: ["staging-deploy-ablauf"],
    }),
  );

  const held = await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], { replaces: "staging-deploy-ablauf" }),
  );

  assert.ok("claim_gate" in held, "the unanswered second memory must still hold the save");
  const gate = (held as { claim_gate: { claimed: Array<{ id: string }> } }).claim_gate;
  assert.deepEqual(
    gate.claimed.map((c) => c.id),
    ["staging-deploy-runbook"],
    "only the memory that was NOT answered for may be reported",
  );
});

test("#360: overwrite is never gated by the memory's own triggers", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  const again = await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Ablauf", [OWNER_TRIGGER], { overwrite: true }),
  );

  assert.ok(!("claim_gate" in again), "re-saving a memory must not be held by its own trigger");
  assert.equal(again.created, false, "overwrite updates rather than creates");
});

test("#360: an unrelated save is untouched by the gate", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  const result = await saveMemoryHandler(
    deps,
    memo("Backup-Rotation", ["die wöchentliche Sicherung der Datenbank rotieren"]),
  );

  assert.equal(result.created, true);
  assert.ok(!("claim_gate" in result));
});

test("#360: the curator sweep finds the pairs that predate the gate, and skips answered ones", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  // Written past the gate on purpose (sibling_of), to build the shape the sweep
  // has to find in a vault whose pairs were created before the gate existed.
  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], { sibling_of: ["staging-deploy-ablauf"] }),
  );
  await saveMemoryHandler(deps, memo("Backup-Rotation", ["die wöchentliche Sicherung der Datenbank rotieren"]));

  const answered = collectClaimedTwice(deps.vault);
  assert.deepEqual(answered, [], `an answered pair must not be reported, got ${JSON.stringify(answered)}`);

  // Same pair, quittance removed: now it is exactly the row the report exists for.
  resetSaveFailures();
  await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], { sibling_of: [], overwrite: true }),
  );
  // `sibling_of: []` cannot clear a stored quittance (the merge is a union), so
  // assert against the vault rather than assuming — this documents which of the
  // two behaviours is the real one.
  const stored = deps.vault.get("staging-deploy-zweitnotiz")?.fm.siblings;
  assert.deepEqual(stored, ["staging-deploy-ablauf"], "quittances accumulate; an empty list clears nothing");
});

test("#360: the sweep reports an unanswered pair once, naming both triggers", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  // Two memories that both declare the situation, neither carrying an answer —
  // written directly through the vault so the gate does not intercept them,
  // which is exactly how every pair already in a real vault got there.
  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], { sibling_of: ["staging-deploy-ablauf"] }),
  );

  const pairs = collectClaimedTwice({
    list: () =>
      deps.vault.list().map((m) => ({
        fm: { ...m.fm, siblings: undefined },
      })),
  });

  assert.equal(pairs.length, 1, `expected exactly one pair, got ${JSON.stringify(pairs)}`);
  assert.equal(pairs[0].fromId, "staging-deploy-zweitnotiz");
  assert.equal(pairs[0].toId, "staging-deploy-ablauf");
  assert.equal(pairs[0].trigger, CLAIMING_TRIGGER);
  assert.equal(pairs[0].claim, OWNER_TRIGGER);
});

// ─── #360b: does the incoming text add anything? ──────────────────────────

test("#360b: a save that repeats the existing body is told to drop itself", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]),
    body: "Der Staging-Deploy laeuft ueber die Pipeline und braucht einen Freigabeklick.",
  });

  const held = await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER]),
    summary: "Kurzfassung",
    // Same content words, different sentence — nothing this memory does not say.
    body: "Braucht einen Freigabeklick und laeuft ueber die Pipeline: der Staging-Deploy.",
  });

  const claimed = (held as { claim_gate: { claimed: Array<{ delta?: { covered: number; new_terms: string[] } }> } })
    .claim_gate.claimed[0];
  assert.deepEqual(
    claimed.delta?.new_terms,
    [],
    `a restatement must add no terms, got ${JSON.stringify(claimed.delta?.new_terms)}`,
  );
  assert.equal(claimed.delta?.covered, 1);
  assert.match(held.note ?? "", /adds NO new terms/);
  assert.match(held.note ?? "", /DROP this save/);
});

test("#360b: a save carrying a new fact is pointed at an overwrite, not a second memory", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]),
    body: "Der Staging-Deploy laeuft ueber die Pipeline.",
  });

  const held = await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER]),
    body: "Der Staging-Deploy laeuft ueber die Pipeline und bricht ohne Datenbankmigration ab.",
  });

  const claimed = (held as {
    claim_gate: { claimed: Array<{ delta?: { covered: number; new_terms: string[] }; existing_body?: string }> };
  }).claim_gate.claimed[0];

  assert.ok(claimed.delta !== undefined);
  assert.ok(claimed.delta.covered < 1, "a genuinely new term must not read as fully covered");
  assert.ok(
    claimed.delta.new_terms.includes("datenbankmigration"),
    `the added term must be named, got ${JSON.stringify(claimed.delta.new_terms)}`,
  );
  assert.equal(
    claimed.existing_body,
    "Der Staging-Deploy laeuft ueber die Pipeline.",
    "the agent must see the existing text without a second roundtrip",
  );
  assert.match(held.note ?? "", /overwrite: true/);
  assert.match(held.note ?? "", /do not create a second one/);
});

test("#360b: the delta ignores what the machine appended to the body", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  const first = await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]),
    body: "Der Staging-Deploy laeuft ueber die Pipeline.",
  });

  // Simulate the RelatedEnricher: an auto-related block whose wikilinked ids are
  // vocabulary the author never wrote.
  const path = (first as { file_path: string }).file_path;
  const raw = await readFile(path, "utf8");
  await writeFile(
    path,
    `${raw.trimEnd()}\n\n<!-- bastra:auto-related:start -->\n## Verwandt\n- [[zufallsbegriff-katamaran]]\n<!-- bastra:auto-related:end -->\n`,
    "utf8",
  );
  await deps.vault.reindexFile(path);

  const held = await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER]),
    body: "Der Staging-Deploy laeuft ueber die Pipeline und braucht einen Katamaran.",
  });

  const claimed = (held as { claim_gate: { claimed: Array<{ delta?: { new_terms: string[] }; existing_body?: string }> } })
    .claim_gate.claimed[0];
  assert.ok(
    claimed.delta?.new_terms.includes("katamaran"),
    `a word that only appears in the auto-related block must still count as new, got ${JSON.stringify(claimed.delta?.new_terms)}`,
  );
  assert.ok(
    !(claimed.existing_body ?? "").includes("auto-related"),
    "the quoted body must not carry the machine block",
  );
});

test("#360b: a compound the memory already wrote covers its parts", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]),
    body: "Das FSRS-6-Decay-Modell und der Staging-Deploy-Ablauf sind beschrieben.",
  });

  const held = await saveMemoryHandler(deps, {
    ...memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER]),
    body: "FSRS-6 und der Ablauf sind hier nochmal notiert, plus ein Rollbackpfad.",
  });

  const delta = (held as { claim_gate: { claimed: Array<{ delta?: { new_terms: string[] } }> } })
    .claim_gate.claimed[0].delta;
  assert.ok(
    !delta?.new_terms.includes("fsrs-6"),
    `a part of a compound the memory already wrote must not read as new, got ${JSON.stringify(delta?.new_terms)}`,
  );
  assert.ok(
    delta?.new_terms.includes("rollbackpfad"),
    `a genuinely new word must survive, got ${JSON.stringify(delta?.new_terms)}`,
  );
});

test("#360: the inverted index finds every pair a brute-force sweep finds", async (t) => {
  const { deps, cleanup } = await makeDeps();
  t.after(cleanup);

  // Shapes the index has to survive: a single-token trigger (its rarest token
  // IS its only token), a long compound one, a pair whose shared word is the
  // most common in the pool, and a memory in a different pool that must not pair.
  const fixtures: Array<[string, string[]]> = [
    ["Alpha", ["deployment vorbereiten"]],
    ["Beta", ["deployment"]],
    ["Gamma", ["das deployment der staging umgebung sorgfaeltig vorbereiten"]],
    ["Delta", ["deployment vorbereiten und pruefen"]],
    ["Epsilon", ["ganz andere situation ohne gemeinsame woerter"]],
    ["Zeta", ["deployment vorbereiten"]],
  ];
  for (const [title, triggers] of fixtures) {
    resetSaveFailures();
    // sibling_of past the gate: the sweep must see the pairs, and these
    // fixtures collide by construction.
    await saveMemoryHandler(deps, memo(title, triggers, { sibling_of: ["nothing-real"] }));
  }

  const list = deps.vault.list().map((m) => ({ fm: { ...m.fm, siblings: undefined } }));

  const brute = new Set<string>();
  const entries: Array<{ id: string; trigger: string; pool: string }> = [];
  for (const m of list) {
    const fm = m.fm as Record<string, unknown>;
    const id = String(fm.id ?? "");
    if (!id || fm.obsolete === true) continue;
    const pool = `${String(fm.scope ?? "")}|${String(fm.type ?? "")}`;
    for (const trig of (fm.recall_when ?? []) as string[]) entries.push({ id, trigger: trig, pool });
  }
  for (const a of entries) {
    for (const b of entries) {
      if (a.id === b.id || a.pool !== b.pool) continue;
      if (containedIn(a.trigger, b.trigger) < TRIGGER_CLAIMS_SITUATION_MIN) continue;
      brute.add(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
    }
  }

  const swept = new Set(
    collectClaimedTwice({ list: () => list }, 10_000).map((p) =>
      p.fromId < p.toId ? `${p.fromId}|${p.toId}` : `${p.toId}|${p.fromId}`,
    ),
  );

  assert.ok(brute.size > 0, "precondition: the fixtures must actually collide");
  assert.deepEqual(
    [...swept].sort(),
    [...brute].sort(),
    "the rarest-token candidate set must not narrow the result",
  );
});

test("#360: generated triggers (docs, bookmarks) stay out of the sweep", async (t) => {
  const { deps, vaultPath, cleanup } = await makeDeps();
  t.after(cleanup);

  // Two document sidecars as the importer writes them: identical generated
  // trigger, different files. They collide by construction and forever.
  for (const name of ["doc-inbox-alpha", "doc-inbox-beta"]) {
    const ts = new Date().toISOString();
    await writeFile(
      join(vaultPath, `${name}.md`),
      [
        "---",
        `id: ${name}`,
        `title: ${name}`,
        "type: doc",
        "summary: 'Bild: ein Foto'",
        "topic_path:",
        "  - documents",
        "tags:",
        "  - dokument",
        "scope: documents",
        "recall_when:",
        "  - foto bild unsortiert",
        `created: ${ts}`,
        `updated: ${ts}`,
        "---",
        "",
        `Sidecar ${name}.`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
  await deps.vault.reindex?.();

  // A real colliding memory pair alongside, to prove the sweep still works.
  await saveMemoryHandler(deps, memo("Staging-Deploy Ablauf", [OWNER_TRIGGER]));
  await saveMemoryHandler(
    deps,
    memo("Staging-Deploy Zweitnotiz", [CLAIMING_TRIGGER], { sibling_of: ["staging-deploy-ablauf"] }),
  );

  const pairs = collectClaimedTwice({
    list: () => deps.vault.list().map((m) => ({ fm: { ...m.fm, siblings: undefined } })),
  });

  assert.ok(
    !pairs.some((p) => p.fromId.startsWith("doc-inbox") || p.toId.startsWith("doc-inbox")),
    `a generated trigger must not produce a row, got ${JSON.stringify(pairs)}`,
  );
  assert.ok(
    pairs.some((p) => p.fromId === "staging-deploy-zweitnotiz"),
    "the authored pair must still be reported",
  );
});
