/**
 * Tests für die Live-Updates (#216): Vault-add-Events landen im Ringpuffer,
 * GET /ui/updates liefert sie mit since-Filter, Overwrites stapeln nicht,
 * ui.enabled-Gate greift.
 *
 * Runner: `tsx --test __tests__/live-updates.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { Vault } from "@bastra-recall/core";
import { createLiveUpdates, type LiveUpdate } from "../src/live-updates.js";

function memoryMarkdown(id: string, title: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "type: reference",
    `summary: Summary of ${id}`,
    "topic_path:\n  - test",
    "tags:\n  - test",
    "scope: live-test",
    `recall_when:\n  - ${id}`,
    "created: 2026-07-18",
    "updated: 2026-07-18",
    "---",
    "",
    "Body.",
  ].join("\n");
}

test("live updates: add events buffer, since filters, overwrite refreshes, ui gate", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "live-vault-"));
  const settingsDir = await mkdtemp(join(tmpdir(), "live-settings-"));
  const settingsPath = join(settingsDir, "cli-settings.json");
  const memDir = join(vaultDir, "memories", "projects", "live-test");
  await mkdir(memDir, { recursive: true });
  const vault = new Vault(vaultDir);
  await vault.init();
  const live = createLiveUpdates(vault);

  const server = createServer((req, res) => {
    void live.handleUiUpdates(req, res, settingsPath);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const call = (since = 0): Promise<{ status: number; json: { updates: LiveUpdate[]; now: number } }> =>
    new Promise((resolve, reject) => {
      const rq = request({ hostname: "127.0.0.1", port, path: `/ui/updates?since=${since}`, method: "GET" }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} }));
      });
      rq.on("error", reject);
      rq.end();
    });

  try {
    assert.equal((await call()).status, 404, "ui disabled → 404");
    await writeFile(settingsPath, JSON.stringify({ ui: { enabled: true } }));

    // a fresh memory file + reindex = the watcher-equivalent add event
    const f1 = join(memDir, "fresh-one.md");
    await writeFile(f1, memoryMarkdown("fresh-one", "Fresh one"));
    await vault.reindexFile(f1);

    let r = await call();
    assert.equal(r.status, 200);
    assert.equal(r.json.updates.length, 1);
    assert.equal(r.json.updates[0].id, "fresh-one");
    assert.equal(r.json.updates[0].cluster, "live-test");
    assert.equal(r.json.updates[0].title, "Fresh one");
    assert.ok(r.json.now > 0);

    // an overwrite emits "change" — deliberately ignored: only NEW memories
    // are live events, an enrich/edit cycle must not re-announce the note
    await writeFile(f1, memoryMarkdown("fresh-one", "Fresh one v2"));
    await vault.reindexFile(f1);
    r = await call();
    assert.equal(r.json.updates.length, 1);
    assert.equal(r.json.updates[0].title, "Fresh one");

    // a duplicate add event for the same id (watcher + reindex race) must
    // refresh the entry, never stack a second card
    vault.forgetFile(f1);
    await vault.reindexFile(f1);
    r = await call();
    assert.equal(r.json.updates.length, 1);
    assert.equal(r.json.updates[0].title, "Fresh one v2");

    // since-filter: nothing newer than "now" → empty
    r = await call(Date.now() + 1000);
    assert.equal(r.json.updates.length, 0);
  } finally {
    live.stop();
    server.close();
    await rm(vaultDir, { recursive: true, force: true });
    await rm(settingsDir, { recursive: true, force: true });
  }
});

test("live updates: change/delete/read kinds with anti-spam rules (#216)", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "live-kinds-"));
  const settingsDir = await mkdtemp(join(tmpdir(), "live-kinds-settings-"));
  const settingsPath = join(settingsDir, "cli-settings.json");
  await writeFile(settingsPath, JSON.stringify({ ui: { enabled: true } }));
  const memDir = join(vaultDir, "memories", "projects", "live-test");
  await mkdir(memDir, { recursive: true });
  // zwei Bestands-Memories, die VOR der Live-Subscription existieren —
  // ihre adds sieht der Buffer nie, nur spätere Events
  const f1 = join(memDir, "old-note.md");
  const f2 = join(memDir, "quiet-note.md");
  await writeFile(f1, memoryMarkdown("old-note", "Old note"));
  await writeFile(f2, memoryMarkdown("quiet-note", "Quiet note"));
  const vault = new Vault(vaultDir);
  await vault.init();
  const live = createLiveUpdates(vault);

  const server = createServer((req, res) => {
    void live.handleUiUpdates(req, res, settingsPath);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const call = (): Promise<{ updates: LiveUpdate[] }> =>
    new Promise((resolve, reject) => {
      const rq = request({ hostname: "127.0.0.1", port, path: "/ui/updates?since=0", method: "GET" }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve(JSON.parse(raw)));
      });
      rq.on("error", reject);
      rq.end();
    });
  const entry = (updates: LiveUpdate[], id: string) => updates.find((u) => u.id === id);

  try {
    // change auf ein Bestands-Memory (kein frischer add-Eintrag) → "updated"
    await writeFile(f1, memoryMarkdown("old-note", "Old note v2"));
    await vault.reindexFile(f1);
    let r = await call();
    assert.equal(entry(r.updates, "old-note")?.kind, "change");
    assert.equal(entry(r.updates, "old-note")?.title, "Old note v2");

    // zweiter change kurz danach: Daten frisch, aber KEIN Re-Announce (at bleibt)
    const atBefore = entry(r.updates, "old-note")!.at;
    await writeFile(f1, memoryMarkdown("old-note", "Old note v3"));
    await vault.reindexFile(f1);
    r = await call();
    assert.equal(entry(r.updates, "old-note")?.title, "Old note v3");
    assert.equal(entry(r.updates, "old-note")?.at, atBefore, "same-kind burst must not re-announce");

    // read auf ein unangetastetes Memory → "read"-Notice
    live.notifyRead("quiet-note");
    r = await call();
    assert.equal(entry(r.updates, "quiet-note")?.kind, "read");

    // read verdrängt nie eine heißere Notice
    live.notifyRead("old-note");
    r = await call();
    assert.equal(entry(r.updates, "old-note")?.kind, "change");

    // delete gewinnt immer; Titel kommt aus dem letzten bekannten Eintrag
    vault.forgetFile(f1);
    r = await call();
    assert.equal(entry(r.updates, "old-note")?.kind, "delete");
    assert.equal(entry(r.updates, "old-note")?.title, "Old note v3");
  } finally {
    live.stop();
    server.close();
    await rm(vaultDir, { recursive: true, force: true });
    await rm(settingsDir, { recursive: true, force: true });
  }
});
