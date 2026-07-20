/**
 * Tests für #150 — anti-thrash semantics on save_memory:
 * consecutive-failure cap (terminal "STOP retrying" error) and the terminal
 * success note. A failed memory side effect must never eat the turn.
 *
 * Runner: tsx --test packages/daemon/__tests__/save-anti-thrash.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { Telemetry } from "../src/telemetry.js";
import {
  saveMemoryHandler,
  noteSaveFailure,
  resetSaveFailures,
  SAVE_FAILURE_CAP,
  SAVE_FAILURE_WINDOW_MS,
  type ToolDeps,
} from "../src/tool-handlers.js";

// Invalid input only needs to survive until safeParse — deps are never touched.
const DUMMY_DEPS = {} as ToolDeps;

async function makeDeps(): Promise<{ deps: ToolDeps; close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-thrash-test-"));
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const deps: ToolDeps = { vault, search, telemetry: new Telemetry(), vaultPath: dir };
  return {
    deps,
    close: async () => {
      search.stop();
      await vault.stop?.();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

const VALID_SAVE = {
  title: "anti-thrash test memory",
  type: "lesson",
  summary: "a summary",
  body: "a body",
  topic_path: ["test"],
  tags: ["test"],
  scope: "test-scope",
  recall_when: ["running the anti-thrash test"],
};

describe("#150: noteSaveFailure window semantics", () => {
  beforeEach(() => resetSaveFailures());

  it("counts consecutive failures", () => {
    assert.equal(noteSaveFailure(1000), 1);
    assert.equal(noteSaveFailure(2000), 2);
    assert.equal(noteSaveFailure(3000), 3);
  });

  it("expired window restarts the streak", () => {
    noteSaveFailure(1000);
    noteSaveFailure(2000);
    assert.equal(noteSaveFailure(2000 + SAVE_FAILURE_WINDOW_MS + 1), 1);
  });
});

describe("#150: saveMemoryHandler failure cap", () => {
  beforeEach(() => resetSaveFailures());

  it("turns the error terminal at the cap and stays terminal", async () => {
    for (let i = 1; i < SAVE_FAILURE_CAP; i++) {
      await assert.rejects(
        saveMemoryHandler(DUMMY_DEPS, { not: "valid" }),
        (err: Error) => !err.message.includes("STOP retrying"),
        `failure ${i} must stay a plain error`,
      );
    }
    await assert.rejects(
      saveMemoryHandler(DUMMY_DEPS, { not: "valid" }),
      (err: Error) =>
        err.message.includes("STOP retrying") && err.message.includes("last error:"),
      "failure at cap must be terminal",
    );
    // A further retry stays terminal — no reset on the terminal path.
    await assert.rejects(
      saveMemoryHandler(DUMMY_DEPS, { not: "valid" }),
      (err: Error) => err.message.includes("STOP retrying"),
      "retry after terminal must stay terminal",
    );
  });

  it("a successful save resets the streak and carries the terminal note", async () => {
    const { deps, close } = await makeDeps();
    try {
      await assert.rejects(saveMemoryHandler(deps, { not: "valid" }));
      await assert.rejects(saveMemoryHandler(deps, { not: "valid" }));

      const result = await saveMemoryHandler(deps, VALID_SAVE);
      assert.equal(result.created, true);
      assert.match(result.note ?? "", /do not repeat/);

      // Streak was reset by the success: the next failure is plain again.
      await assert.rejects(
        saveMemoryHandler(deps, { not: "valid" }),
        (err: Error) => !err.message.includes("STOP retrying"),
        "failure after success must be a plain error again",
      );
    } finally {
      await close();
    }
  });
});
