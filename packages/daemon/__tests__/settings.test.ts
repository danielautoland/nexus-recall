/**
 * Tests for src/settings.ts — the OSS CLI settings store (update mode).
 *
 * node:test via tsx, no extra deps. All reads/writes go to a temp file via the
 * injectable `path` parameter, so this never touches the real ~/.bastra.
 *
 * Run: npx tsx --test packages/daemon/__tests__/settings.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_UPDATE_MODE,
  effectiveUpdateMode,
  getUpdateMode,
  readSettings,
  setUpdateMode,
} from "../src/settings.js";

async function withTempFile<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-settings-"));
  try {
    return await fn(join(dir, "cli-settings.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs fn with BASTRA_UPDATE_CHECK set to `val` (or deleted if null), then restores. */
async function withEnv(val: string | null, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.BASTRA_UPDATE_CHECK;
  if (val === null) delete process.env.BASTRA_UPDATE_CHECK;
  else process.env.BASTRA_UPDATE_CHECK = val;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.BASTRA_UPDATE_CHECK;
    else process.env.BASTRA_UPDATE_CHECK = prev;
  }
}

test("readSettings: missing file → default mode, never throws", async () => {
  await withTempFile(async (path) => {
    const s = await readSettings(path);
    assert.equal(s.update.mode, DEFAULT_UPDATE_MODE);
    assert.equal(DEFAULT_UPDATE_MODE, "notify");
  });
});

test("setUpdateMode → getUpdateMode round-trips every valid mode", async () => {
  await withTempFile(async (path) => {
    for (const mode of ["auto", "off", "notify"] as const) {
      await setUpdateMode(mode, path);
      assert.equal(await getUpdateMode(path), mode);
    }
  });
});

test("readSettings: corrupt JSON → default mode (no throw)", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, "{ not valid json", "utf8");
    assert.equal((await readSettings(path)).update.mode, DEFAULT_UPDATE_MODE);
  });
});

test("readSettings: unknown stored mode → falls back to default", async () => {
  await withTempFile(async (path) => {
    await writeFile(path, JSON.stringify({ update: { mode: "bogus" } }), "utf8");
    assert.equal((await readSettings(path)).update.mode, DEFAULT_UPDATE_MODE);
  });
});

test("effectiveUpdateMode: env kill-switch forces 'off' over stored 'auto'", async () => {
  await withTempFile(async (path) => {
    await setUpdateMode("auto", path);
    await withEnv("off", async () => {
      assert.equal(await effectiveUpdateMode(path), "off");
    });
    for (const falsy of ["0", "false", "no"]) {
      await withEnv(falsy, async () => {
        assert.equal(await effectiveUpdateMode(path), "off");
      });
    }
  });
});

test("effectiveUpdateMode: no env → stored mode wins", async () => {
  await withTempFile(async (path) => {
    await setUpdateMode("auto", path);
    await withEnv(null, async () => {
      assert.equal(await effectiveUpdateMode(path), "auto");
    });
  });
});

test("setUpdateMode preserves the file as valid JSON object", async () => {
  await withTempFile(async (path) => {
    await setUpdateMode("auto", path);
    const s = await readSettings(path);
    assert.equal(s.update.mode, "auto");
  });
});
