/**
 * A test run must not write into the developer's own telemetry log.
 *
 * Telemetry resolves its log dir once, in the constructor: BASTRA_LOG_PATH, else
 * ~/.bastra/logs. 22 test files construct one without redirecting it, so `npm test`
 * appended 114 events per run to the real log — including two recall_episode rows
 * carrying the fixture memory id "m1", with acted_on=true.
 *
 * The log is an INPUT, not just a record. `bastra bridges mint` joins recall to
 * recall_episode and mints bridges from every acted-on reach it finds, writing them
 * into the Commons clone for contribution; `bastra logs --stats` reports over the
 * same file. Fixture rows there mean fixture bridges and contaminated statistics,
 * and neither failure announces itself.
 *
 * scripts/test-env.mjs fills in a throwaway BASTRA_LOG_PATH for any test process
 * that did not pick one. This pins that guard: it asserts the property (writes land
 * somewhere disposable) rather than the mechanism, so it still holds if the guard is
 * reimplemented.
 *
 * Run: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/telemetry-test-isolation.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Telemetry } from "../src/telemetry.js";

/** Where a Telemetry built under the current env would write. */
const REAL_LOG_DIR = resolve(join(homedir(), ".bastra", "logs"));

test("the ambient log dir under test is never the developer's real one", () => {
  const configured = process.env.BASTRA_LOG_PATH;
  assert.ok(
    configured,
    "BASTRA_LOG_PATH must be set for a test process — scripts/test-env.mjs does this via --import in the root test script",
  );
  assert.notEqual(
    resolve(configured),
    REAL_LOG_DIR,
    "a test run pointed at ~/.bastra/logs would mint fixture bridges and skew `bastra logs --stats`",
  );
  assert.ok(
    resolve(configured).startsWith(resolve(tmpdir())),
    `the test log dir should be disposable, got ${configured}`,
  );
});

test("a default-constructed Telemetry writes an acted-on episode to the throwaway dir, not to $HOME", async () => {
  // Exactly the shape hook-act.test.ts produced: a loaded memory, then an edit
  // that mentions two of its distinctive tokens.
  const t = new Telemetry();
  t.rotateTurn("iso-session");
  t.recordLoadedMemory({
    memory_id: "isolation-probe",
    distinctive_tokens: ["zirconflux", "pallasgate"],
    hook_hint: { recall_id: "iso-recall", score: 90 },
    session_id: "iso-session",
  });
  const episodes = t.matchLoadedMemories({
    tool_name: "Bash",
    tool_input_excerpt: "zirconflux pallasgate rollout",
    session_id: "iso-session",
  });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].acted_on, true, "this is the row that used to leak");
  await t.logRecallEpisode(episodes[0]);
  await t.flushNow();

  const today = new Date().toISOString().slice(0, 10);
  const written = await readdir(process.env.BASTRA_LOG_PATH as string);
  assert.ok(
    written.includes(`events-${today}.jsonl`),
    `the episode should be in the throwaway dir, found ${JSON.stringify(written)}`,
  );

  // And the real dir must not have grown a row for this probe. Reading it is safe:
  // if it does not exist, there is nothing to contaminate.
  let realRows = "";
  try {
    const { readFile } = await import("node:fs/promises");
    realRows = await readFile(join(REAL_LOG_DIR, `events-${today}.jsonl`), "utf8");
  } catch {
    /* no real log on this machine — the property holds trivially */
  }
  assert.doesNotMatch(
    realRows,
    /isolation-probe/,
    "the probe reached the developer's real telemetry log",
  );
});
