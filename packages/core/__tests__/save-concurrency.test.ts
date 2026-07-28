/**
 * #285 — ownership-aware saveMemory commit.
 *
 * The precondition and commit claim are separate invariants:
 * - expectedTarget closes a caller ownership-check → writer-commit window;
 * - the O_EXCL claim serializes saveMemory writers across processes;
 * - create publishes without replacement, so a late creator is never clobbered.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import {
  MEMORY_WRITE_CONFLICT,
  MemoryWriteConflictError,
  saveMemory,
} from "../src/save.js";
import type { SaveMemoryInput } from "../src/save.js";

const ID = "shared-memory";

function input(body: string, over: Partial<SaveMemoryInput> = {}): SaveMemoryInput {
  return {
    id: ID,
    title: "Shared Memory",
    type: "lesson",
    summary: `summary ${body.slice(0, 12)}`,
    body,
    topic_path: ["concurrency"],
    tags: ["save"],
    scope: "race",
    recall_when: ["when testing concurrent saves"],
    overwrite: true,
    ...over,
  } as SaveMemoryInput;
}

function targetFor(vault: string, folder = "memories/projects/race"): string {
  return path.join(vault, folder, `${ID}.md`);
}

async function harness(t: { after: (fn: () => unknown) => void }): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), "bastra-save-concurrency-"));
  t.after(() => rm(vault, { recursive: true, force: true }));
  return vault;
}

async function artifacts(file: string): Promise<string[]> {
  try {
    return (await readdir(path.dirname(file))).filter(
      (name) => name.endsWith(".tmp") || name.endsWith(".bastra-write.lock"),
    );
  } catch {
    return [];
  }
}

async function runWorker(
  vault: string,
  body: string,
  expectedFile: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const worker = fileURLToPath(
    new URL("./fixtures/save-concurrency-worker.ts", import.meta.url),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", worker, vault, body, expectedFile],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function assertConflict(reason: unknown): asserts reason is MemoryWriteConflictError {
  assert.ok(reason instanceof MemoryWriteConflictError);
  assert.equal(reason.name, "MemoryWriteConflictError");
  assert.equal(reason.code, MEMORY_WRITE_CONFLICT);
  assert.equal(reason.id, ID);
  assert.match(reason.message, /Retry from the current file/);
}

test("concurrent creates: exactly one wins and the loser reports a stable conflict", async (t) => {
  const vault = await harness(t);
  const file = targetFor(vault);

  const settled = await Promise.allSettled([
    saveMemory(vault, input("writer A"), { expectedTarget: null }),
    saveMemory(vault, input("writer B"), { expectedTarget: null }),
  ]);

  const winners = settled.filter((result) => result.status === "fulfilled");
  const losers = settled.filter((result) => result.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assertConflict((losers[0] as PromiseRejectedResult).reason);

  const raw = await readFile(file, "utf8");
  assert.ok(raw.includes("writer A") || raw.includes("writer B"));
  assert.deepEqual(await artifacts(file), []);
});

test("concurrent overwrites from one preimage: exactly one patch wins", async (t) => {
  const vault = await harness(t);
  const first = await saveMemory(vault, input("original", { sensitivity: "private" }));
  const preimage = await readFile(first.file_path, "utf8");

  const settled = await Promise.allSettled([
    saveMemory(vault, input("writer A"), { expectedTarget: preimage }),
    saveMemory(vault, input("writer B"), { expectedTarget: preimage }),
  ]);

  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  const loser = settled.find((result) => result.status === "rejected");
  assert.ok(loser && loser.status === "rejected");
  assertConflict(loser.reason);

  const raw = await readFile(first.file_path, "utf8");
  assert.ok(raw.includes("writer A") || raw.includes("writer B"));
  assert.equal(matter(raw).data.sensitivity, "private", "the winning overwrite remains a patch");
  assert.deepEqual(await artifacts(first.file_path), []);
});

test("overlapping ordinary overwrites are serialized even without a caller precondition", async (t) => {
  const vault = await harness(t);
  const first = await saveMemory(vault, input("original"));

  const settled = await Promise.allSettled([
    saveMemory(vault, input("writer A")),
    saveMemory(vault, input("writer B")),
  ]);

  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  const loser = settled.find((result) => result.status === "rejected");
  assert.ok(loser && loser.status === "rejected");
  assertConflict(loser.reason);
  const raw = await readFile(first.file_path, "utf8");
  assert.ok(raw.includes("writer A") || raw.includes("writer B"));
  assert.deepEqual(await artifacts(first.file_path), []);
});

test("an expected-free save refuses a target that appeared before entry", async (t) => {
  const vault = await harness(t);
  const landed = await saveMemory(vault, input("landed first"));
  const before = await readFile(landed.file_path, "utf8");

  await assert.rejects(
    saveMemory(vault, input("must lose"), { expectedTarget: null }),
    (err) => {
      assertConflict(err);
      return true;
    },
  );
  assert.equal(await readFile(landed.file_path, "utf8"), before);
  assert.deepEqual(await artifacts(landed.file_path), []);
});

test("an expected preimage refuses a byte change and preserves the newcomer", async (t) => {
  const vault = await harness(t);
  const seeded = await saveMemory(vault, input("original"));
  const expected = await readFile(seeded.file_path, "utf8");
  const newcomer = expected.replace("original", "external edit");
  await writeFile(seeded.file_path, newcomer, "utf8");

  await assert.rejects(
    saveMemory(vault, input("must lose"), { expectedTarget: expected }),
    MemoryWriteConflictError,
  );
  assert.equal(await readFile(seeded.file_path, "utf8"), newcomer);
  assert.deepEqual(await artifacts(seeded.file_path), []);
});

test("a held commit claim fails visibly without touching the target or claim", async (t) => {
  const vault = await harness(t);
  const seeded = await saveMemory(vault, input("original"));
  const expected = await readFile(seeded.file_path, "utf8");
  const lock = `${seeded.file_path}.bastra-write.lock`;
  await writeFile(lock, "other writer", "utf8");

  await assert.rejects(
    saveMemory(vault, input("must lose"), { expectedTarget: expected }),
    (err) => {
      assertConflict(err);
      assert.match((err as Error).message, /another save is committing/);
      return true;
    },
  );
  assert.equal(await readFile(seeded.file_path, "utf8"), expected);
  assert.equal(await readFile(lock, "utf8"), "other writer");
  assert.deepEqual(
    (await artifacts(seeded.file_path)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("ordinary sequential overwrites stay compatible and both succeed", async (t) => {
  const vault = await harness(t);
  const created = await saveMemory(vault, input("v1"));
  const second = await saveMemory(vault, input("v2"));
  const third = await saveMemory(vault, input("v3"));

  assert.equal(created.created, true);
  assert.equal(second.created, false);
  assert.equal(third.created, false);
  assert.match(await readFile(created.file_path, "utf8"), /v3/);
  assert.deepEqual(await artifacts(created.file_path), []);
});

test("unrelated ids do not share a commit claim", async (t) => {
  const vault = await harness(t);
  const [a, b] = await Promise.all([
    saveMemory(vault, input("A", { id: "memory-a" }), { expectedTarget: null }),
    saveMemory(vault, input("B", { id: "memory-b" }), { expectedTarget: null }),
  ]);

  assert.equal(a.created, true);
  assert.equal(b.created, true);
});

test("the same id in distinct folders commits independently", async (t) => {
  const vault = await harness(t);
  const [a, b] = await Promise.all([
    saveMemory(vault, input("A", { folder: "memories/projects/a" }), {
      expectedTarget: null,
    }),
    saveMemory(vault, input("B", { folder: "memories/projects/b" }), {
      expectedTarget: null,
    }),
  ]);

  assert.notEqual(a.file_path, b.file_path);
  assert.equal(a.created, true);
  assert.equal(b.created, true);
});

test("non-ENOENT inspection failures fail closed before temp or lock creation", async (t) => {
  const vault = await harness(t);
  const file = targetFor(vault);
  await mkdir(file, { recursive: true });

  await assert.rejects(saveMemory(vault, input("must not write")), (err: unknown) => {
    assert.equal((err as NodeJS.ErrnoException).code, "EISDIR");
    return true;
  });
  assert.deepEqual(await artifacts(file), []);
});

test("the same preimage is claimed exactly once across Node processes", async (t) => {
  const vault = await harness(t);
  const seeded = await saveMemory(vault, input("original"));
  const expectedFile = path.join(vault, "approved-preimage.txt");
  await writeFile(expectedFile, await readFile(seeded.file_path, "utf8"), "utf8");

  const results = await Promise.all([
    runWorker(vault, "process A", expectedFile),
    runWorker(vault, "process B", expectedFile),
  ]);

  assert.deepEqual(
    results.map((result) => result.code).sort(),
    [0, 2],
    results.map((result) => result.stderr).join("\n"),
  );
  const loser = results.find((result) => result.code === 2);
  assert.ok(loser);
  const report = JSON.parse(loser.stdout) as { code: string; name: string };
  assert.equal(report.code, MEMORY_WRITE_CONFLICT);
  assert.equal(report.name, "MemoryWriteConflictError");
  const raw = await readFile(seeded.file_path, "utf8");
  assert.ok(raw.includes("process A") || raw.includes("process B"));
  assert.deepEqual(await artifacts(seeded.file_path), []);
});
