/**
 * Tests for src/learned-recall/mint-job.ts (#353) — the in-band mint on its
 * own trigger: mints from a telemetry log, records last-mint.json, stays
 * idempotent across re-runs.
 *
 * Run: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/mint-job.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "@bastra-recall/core";
import { runInBandMint, readLastMint, LAST_MINT_FILE } from "../src/learned-recall/mint-job.js";

function nearMemory(): string {
  const ts = new Date().toISOString();
  return [
    "---",
    "id: panel-dismiss",
    "title: NSPanel resignKey dismissal",
    "type: lesson",
    "summary: panel dismissal on resignKey",
    "topic_path:",
    "  - swift",
    "tags:",
    "  - swift",
    "scope: personal",
    "recall_when:",
    "  - macOS window dismiss observer resignKey attachedSheet",
    `created: ${ts}`,
    `updated: ${ts}`,
    "---",
    "",
    "Hold the panel; respect attachedSheet on resignKey.",
    "",
  ].join("\n");
}

/** A far reach onto panel-dismiss: query shares no vocabulary with the memory. */
function eventLogLines(): string {
  const ts = new Date().toISOString();
  return (
    [
      { kind: "hook_recall", ts, recall_id: "r1", query: "warum schließt sich mein Fenster von allein" },
      { kind: "recall_episode", ts, recall_id: "r1", memory_id: "panel-dismiss", acted_on: true },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n"
  );
}

test("runInBandMint: mints from the log, records last-mint.json, re-run is idempotent", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "bastra-mint-vault-"));
  const logDir = await mkdtemp(join(tmpdir(), "bastra-mint-log-"));
  const bridgesRoot = await mkdtemp(join(tmpdir(), "bastra-mint-bridges-"));
  try {
    await writeFile(join(vaultDir, "panel.md"), nearMemory(), "utf8");
    const today = new Date().toISOString().slice(0, 10);
    await writeFile(join(logDir, `events-${today}.jsonl`), eventLogLines(), "utf8");
    const vault = new Vault(vaultDir);
    await vault.init();

    const first = await runInBandMint({ vault, bridgesRoot, trigger: "daemon-boot", logDir });
    assert.equal(first.reaches, 1);
    assert.equal(first.minted, 1);
    assert.equal(first.written, 1);

    // #353 observability: the run is visible without counting files
    const last = await readLastMint(bridgesRoot);
    assert.ok(last, "last-mint.json must exist after a run");
    assert.equal(last.trigger, "daemon-boot");
    assert.equal(last.minted, 1);
    assert.equal(last.reaches, 1);

    // idempotent: same log, same bridges — overwritten, not duplicated
    const second = await runInBandMint({ vault, bridgesRoot, trigger: "daemon-interval", logDir });
    assert.equal(second.minted, 1);
    const langDirs = await readdir(join(bridgesRoot, "bridges"));
    let files = 0;
    for (const lang of langDirs) files += (await readdir(join(bridgesRoot, "bridges", lang))).length;
    assert.equal(files, 1, "re-run must overwrite the same bridge file, not add a second");
    assert.equal((await readLastMint(bridgesRoot))?.trigger, "daemon-interval");
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(logDir, { recursive: true, force: true });
    await rm(bridgesRoot, { recursive: true, force: true });
  }
});

test("runInBandMint: empty log still records the run (frozen-pool visibility)", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "bastra-mint-vault2-"));
  const logDir = await mkdtemp(join(tmpdir(), "bastra-mint-log2-"));
  const bridgesRoot = await mkdtemp(join(tmpdir(), "bastra-mint-bridges2-"));
  try {
    await mkdir(bridgesRoot, { recursive: true });
    const vault = new Vault(vaultDir);
    await vault.init();
    const outcome = await runInBandMint({ vault, bridgesRoot, trigger: "cli", logDir });
    assert.deepEqual(outcome, { minted: 0, reaches: 0, written: 0 });
    const last = await readLastMint(bridgesRoot);
    assert.ok(last, `${LAST_MINT_FILE} must be written even when nothing minted`);
    assert.equal(last.minted, 0);
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(logDir, { recursive: true, force: true });
    await rm(bridgesRoot, { recursive: true, force: true });
  }
});
