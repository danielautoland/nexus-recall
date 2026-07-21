/**
 * #242 — the vault watcher must actually emit events.
 *
 * From 2026-05-31 (chokidar 5 bump) until this test existed, `startWatching()`
 * emitted nothing at all: `chokidar.watch()` was handed a glob, and chokidar
 * dropped glob support in v4, so it watched a literal path that never existed.
 * No events, no error. A type check and a green suite cannot catch a silent
 * no-op — only an end-to-end event assertion can, which is why this file
 * asserts on delivered events rather than on configuration.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Vault, type VaultEvent } from "../src/vault.js";

function memoryMd(id: string, body = "Body."): string {
  return `---
id: ${id}
title: Title ${id}
type: lesson
summary: summary for ${id}
topic_path: [test]
tags: [test]
scope: test
recall_when: ["when ${id}"]
created: 2026-05-01
updated: 2026-05-01
---

${body}
`;
}

/** Wait until `predicate` sees a matching event, or fail after `ms`. */
async function waitFor(
  events: VaultEvent[],
  predicate: (e: VaultEvent) => boolean,
  ms = 8000,
): Promise<VaultEvent> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = events.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `no matching watcher event within ${ms}ms — saw: ${JSON.stringify(
      events.map((e) => `${e.kind}:${"memory" in e && e.memory ? e.memory.fm.id : ""}`),
    )}`,
  );
}

async function watchedVault(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-vault-watcher-"));
  const vault = new Vault(dir);
  await vault.init();
  const events: VaultEvent[] = [];
  vault.on((e) => events.push(e));
  vault.startWatching();
  // chokidar needs a beat to finish its initial scan before writes register.
  await new Promise((r) => setTimeout(r, 300));
  t.after(async () => {
    await vault.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return { dir, vault, events };
}

test("a new .md file at the vault root produces an add event", async (t) => {
  const { dir, vault, events } = await watchedVault(t);

  await writeFile(path.join(dir, "alpha.md"), memoryMd("alpha"), "utf8");

  await waitFor(events, (e) => e.kind === "add" && e.memory?.fm.id === "alpha");
  assert.equal(vault.get("alpha")?.fm.title, "Title alpha");
});

test("a nested .md file is watched too", async (t) => {
  const { dir, vault, events } = await watchedVault(t);

  await mkdir(path.join(dir, "memories", "projects", "demo"), { recursive: true });
  await writeFile(
    path.join(dir, "memories", "projects", "demo", "beta.md"),
    memoryMd("beta"),
    "utf8",
  );

  await waitFor(events, (e) => e.kind === "add" && e.memory?.fm.id === "beta");
  assert.equal(vault.get("beta")?.fm.id, "beta");
});

test("editing and deleting a watched file produces change and remove", async (t) => {
  const { dir, vault, events } = await watchedVault(t);
  const file = path.join(dir, "gamma.md");

  await writeFile(file, memoryMd("gamma"), "utf8");
  await waitFor(events, (e) => e.kind === "add" && e.memory?.fm.id === "gamma");

  await writeFile(file, memoryMd("gamma", "Edited body."), "utf8");
  await waitFor(events, (e) => e.kind === "change" && e.memory?.fm.id === "gamma");

  await unlink(file);
  await waitFor(events, (e) => e.kind === "remove");
  assert.equal(vault.get("gamma"), undefined);
});

test("the cloud-mount polling path delivers events too", async (t) => {
  // The usePolling branch exists because fsevents/kqueue do not fire for
  // files written into a GoogleDrive/iCloud/Dropbox provider mount. It was
  // configuring a watcher that never fired, so nothing exercised it —
  // a vault path containing the marker selects that branch.
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-CloudStorage-watch-"));
  const vault = new Vault(dir);
  await vault.init();
  const events: VaultEvent[] = [];
  vault.on((e) => events.push(e));
  vault.startWatching();
  await new Promise((r) => setTimeout(r, 300));
  t.after(async () => {
    await vault.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  await writeFile(path.join(dir, "delta.md"), memoryMd("delta"), "utf8");

  // Polling interval is 1.5 s on cloud mounts, so allow for it.
  await waitFor(events, (e) => e.kind === "add" && e.memory?.fm.id === "delta", 12000);
  assert.equal(vault.get("delta")?.fm.id, "delta");
});

test("a file the save path already indexed must not arrive as a second add", async (t) => {
  // The save path writes the file and indexes it itself (reindexFile), because
  // the watcher is unreliable on cloud mounts. The watcher then reports the
  // very same file as a fresh "add" — and the vault used to pass that kind
  // through unchanged, so one new memory produced TWO add events. The map's
  // topbar counter follows those (+1 per add), so every save counted double
  // and only a reload put the number straight.
  const { dir, vault, events } = await watchedVault(t);
  const file = path.join(dir, "zeta.md");

  await writeFile(file, memoryMd("zeta"), "utf8");
  await vault.reindexFile(file);
  const addsOf = (): VaultEvent[] =>
    events.filter((e) => e.kind === "add" && e.memory?.fm.id === "zeta");
  assert.equal(addsOf().length, 1, "the save path itself announces the newborn once");

  // the watcher's own report for the same file must land as a change
  await waitFor(events, (e) => e.kind === "change" && e.memory?.fm.id === "zeta");
  assert.equal(addsOf().length, 1, "a second add would count the memory twice");
});

test("a watcher error is survivable — it must not take the process down", async (t) => {
  const { dir, vault, events } = await watchedVault(t);

  // FSWatcher is an EventEmitter: an unhandled "error" event terminates the
  // process, and there is no uncaughtException handler in core or daemon.
  // EMFILE is reachable for a launchd-spawned daemon at the macOS default of
  // 256 descriptors, so this has to degrade to the periodic reconcile.
  const watcher = (vault as unknown as { watcher?: { emit: (ev: string, err: Error) => void } })
    .watcher;
  assert.ok(watcher, "startWatching must have created a watcher");
  assert.doesNotThrow(() => watcher!.emit("error", new Error("EMFILE: simulated")));

  // …and the vault keeps working afterwards.
  await writeFile(path.join(dir, "epsilon.md"), memoryMd("epsilon"), "utf8");
  await waitFor(events, (e) => e.kind === "add" && e.memory?.fm.id === "epsilon");
});

test("non-markdown files and dotfolders stay out of the vault", async (t) => {
  const { dir, vault, events } = await watchedVault(t);

  await writeFile(path.join(dir, "notes.txt"), "not a memory", "utf8");
  await mkdir(path.join(dir, ".obsidian"), { recursive: true });
  await writeFile(path.join(dir, ".obsidian", "hidden.md"), memoryMd("hidden"), "utf8");

  // Anchor on a file that MUST arrive, so this isn't just a race we won.
  await writeFile(path.join(dir, "anchor.md"), memoryMd("anchor"), "utf8");
  await waitFor(events, (e) => e.kind === "add" && e.memory?.fm.id === "anchor");

  assert.equal(vault.get("hidden"), undefined, "dotfolders must stay ignored");
  assert.equal(vault.size(), 1, "only the anchor memory may be indexed");
});
