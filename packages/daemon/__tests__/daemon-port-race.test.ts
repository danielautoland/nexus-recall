/**
 * #483: the loser of a daemon start race must stop, not keep working.
 *
 * A service-owned daemon and a forwarder-spawned one can start at the same
 * moment. The second lost `:6723` with EADDRINUSE — but by then it had already
 * opened the vault, subscribed a watcher, built the embedding index and
 * prewarmed Ollama, so one vault update produced that work twice. The repair
 * is ordering: ask about the port before any of that starts, and treat a lost
 * bind as "I am not the daemon".
 *
 * No daemon is spawned here (same rule as map-daemon-start.test.ts). Both
 * halves are real sockets on an ephemeral port, so nothing sleeps and nothing
 * touches the developer's own :6723.
 *
 * Runner: `node --import tsx --test packages/daemon/__tests__/daemon-port-race.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex } from "@bastra-recall/core";

import { probeDaemonPort, startHttpServer } from "../src/http.js";
import { Telemetry } from "../src/telemetry.js";

/** An occupied port, and the free port number it leaves behind on close. */
async function occupiedPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const holder = createServer();
  await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
  const port = (holder.address() as AddressInfo).port;
  return {
    port,
    release: () => new Promise<void>((resolve) => holder.close(() => resolve())),
  };
}

test("a port another daemon holds reads as in-use", async () => {
  const held = await occupiedPort();
  try {
    assert.equal(await probeDaemonPort(held.port), "in-use");
  } finally {
    await held.release();
  }
});

test("the same port reads as free once nobody holds it", async () => {
  const held = await occupiedPort();
  const port = held.port;
  await held.release();
  assert.equal(await probeDaemonPort(port), "free");
});

test("the probe leaves the port free for the real listen()", async () => {
  const held = await occupiedPort();
  const port = held.port;
  await held.release();

  assert.equal(await probeDaemonPort(port), "free");
  // The winner must be able to bind right after its own probe — a probe that
  // kept the socket would lock the daemon out of its own port.
  const winner = createServer();
  await new Promise<void>((resolve, reject) => {
    winner.once("error", reject);
    winner.listen(port, "127.0.0.1", resolve);
  });
  assert.equal((winner.address() as AddressInfo).port, port);
  // And the loser of the race sees it taken.
  assert.equal(await probeDaemonPort(port), "in-use");
  await new Promise<void>((resolve) => winner.close(() => resolve()));
});

function memoryMarkdown(id: string, title: string): string {
  const ts = new Date().toISOString();
  return [
    "---", `id: ${id}`, `title: ${title}`, "type: reference", `summary: ${title}`,
    "topic_path:", "  - test", "tags:", "  - test", "scope: port-race-test",
    "recall_when:", `  - ${title}`, `created: ${ts}`, `updated: ${ts}`, "---",
    "", `Body for ${title}.`, "",
  ].join("\n");
}

test("startHttpServer reports the lost bind instead of a silent success", async () => {
  const held = await occupiedPort();
  const dir = await mkdtemp(join(tmpdir(), "bastra-port-race-"));
  await writeFile(join(dir, "alpha.md"), memoryMarkdown("alpha", "alpha bravo"), "utf8");
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const telemetry = new Telemetry();

  try {
    const handle = await startHttpServer({
      port: held.port,
      vault,
      search,
      telemetry,
      version: "test",
      toolDeps: { vault, search, telemetry, vaultPath: dir },
      documentWriteEnabled: false,
      onActivity: () => undefined,
      embedding: { on: false, providerId: null, source: "none" },
    });
    assert.equal(handle.port, null);
    // Before #483 this was indistinguishable from "HTTP is off" and daemon
    // startup simply continued past it.
    assert.equal(handle.addressInUse, true);
    await handle.close();
  } finally {
    search.stop();
    await vault.stop?.();
    await held.release();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The whole point of #483 is an ORDER, and order is what a later edit breaks
 * silently: move the probe below `vault.init()` and every test above still
 * passes while the duplicate lifecycle is back. So this one reads the source.
 * Same approach as file-size-check.test.ts / update-preflight.test.ts.
 */
test("the port probe stays above the vault and embedding lifecycle", async () => {
  const src = await readFile(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");

  const probe = src.indexOf("probeDaemonPort(HTTP_PORT)");
  const vault = src.indexOf("new Vault(VAULT_PATH!)");
  const init = src.indexOf("vault.init()");
  const watching = src.indexOf("vault.startWatching()");
  const prewarm = src.indexOf("prewarmOllamaModel(");

  assert.ok(probe > 0, "the early bind probe is gone from index.ts");
  for (const [name, at] of [
    ["new Vault", vault],
    ["vault.init", init],
    ["vault.startWatching", watching],
    ["prewarmOllamaModel", prewarm],
  ] as const) {
    assert.ok(at > 0, `${name} not found in index.ts — update this test`);
    assert.ok(probe < at, `the #483 probe must run before ${name}, not after it`);
  }

  // And it must not fire in the deliberate no-server mode.
  assert.match(
    src.slice(probe - 120, probe),
    /HTTP_DISABLED/,
    "the probe must stay guarded by HTTP_DISABLED (BASTRA_HTTP=off)",
  );
});
