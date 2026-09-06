/**
 * #478 Part 2 in shadow: a hint that is followed WITHOUT ever being loaded
 * becomes visible — and nothing else moves (#484).
 *
 * `acted_on` can only ever be produced by an explicit `load_memory`, because
 * `loadedMemories` is appended to in the load path alone. The suppression
 * breaker then reads that as evidence a hint is worthless. This opens the same
 * act-detection window for hints a hook ACTUALLY injected, and writes the
 * result to its own event kind — so the number exists on 10.09. without the
 * breaker's `used` condition changing by one line.
 *
 * Runner: `node --import tsx --test packages/daemon/__tests__/hint-followed-shadow.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileURLToPath } from "node:url";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { request } from "node:http";
import { startHttpServer } from "../src/http.js";
import { Telemetry } from "../src/telemetry.js";

/** Telemetry with its own log dir, plus a record of every usage moment. */
async function harness() {
  const logDir = await mkdtemp(join(tmpdir(), "bastra-hintshadow-"));
  const usage: Array<{ id: string; kind: string }> = [];
  const telemetry = new Telemetry({ logDir, onUsage: (events) => usage.push(...events) });
  return {
    telemetry,
    usage,
    /**
     * The event write is fire-and-forget (telemetry must never block a tool
     * call), so reading straight after the match is a race. Poll until the
     * expected count appears; the negative cases pass `0` and simply spend the
     * settle time, so "no event" means no event rather than "not yet".
     */
    events: async (expected = 0): Promise<Array<Record<string, unknown>>> => {
      const read = async (): Promise<Array<Record<string, unknown>>> => {
        const files = await readdir(logDir).catch(() => [] as string[]);
        const rows: Array<Record<string, unknown>> = [];
        for (const f of files) {
          const raw = await readFile(join(logDir, f), "utf8");
          for (const line of raw.split("\n").filter(Boolean)) rows.push(JSON.parse(line));
        }
        return rows;
      };
      let rows = await read();
      for (let i = 0; i < 50 && rows.length < Math.max(expected, 1); i++) {
        await new Promise((r) => setTimeout(r, 10));
        rows = await read();
      }
      return rows;
    },
    cleanup: () => rm(logDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  };
}

const TOKENS = ["portrace", "eaddrinuse", "kickstart"];

test("a followed hint is counted in its own event kind, not as acted_on", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-1");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-1");

    const episodes = h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "fixing the portrace after eaddrinuse",
      session_id: "sess-1",
    });

    // No recall_episode: the report counts every surfaced episode as `loaded`
    // (telemetry-report.ts:184-188), so one here would inflate the USE rate.
    assert.deepEqual(episodes, []);

    const shadow = (await h.events(1)).filter((e) => e.kind === "hint_followed_shadow");
    assert.equal(shadow.length, 1);
    assert.equal(shadow[0]!.memory_id, "m1");
    assert.equal(shadow[0]!.followed, true);
    assert.equal(shadow[0]!.match_strength, 2);
    assert.equal(shadow[0]!.tool_name, "Edit");
    // Must be session-bound: an inferred turn is closable by a parallel session.
    assert.equal(shadow[0]!.turn_source, "session");
  } finally {
    await h.cleanup();
  }
});

test("being shown is not a load: no usage moment is emitted for a hint", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-2");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-2");
    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse kickstart all three",
      session_id: "sess-2",
    });

    // `hint-suppression.ts:93` reads revision_loaded and revision_acted_on.
    // Package 2 delivers a number, not a behaviour change — so neither may
    // appear here, however strongly the hint matched.
    assert.deepEqual(h.usage.filter((u) => u.kind === "loaded" || u.kind === "acted_on"), []);
  } finally {
    await h.cleanup();
  }
});

test("a hint that is not followed is recorded as followed: false", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-3");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-3");
    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "something else entirely",
      session_id: "sess-3",
    });

    const shadow = (await h.events(1)).filter((e) => e.kind === "hint_followed_shadow");
    assert.equal(shadow.length, 1);
    assert.equal(shadow[0]!.followed, false);
    // Same threshold as acted_on (>= 2), so both numbers stay comparable.
    assert.ok(Number(shadow[0]!.match_strength) < 2);
  } finally {
    await h.cleanup();
  }
});

test("the raw top-k opens no window — a hint cannot match the input that produced it", async () => {
  const h = await harness();
  try {
    // This is what runs in the same call as matchLoadedMemories
    // (http-hook-routes.ts:473-479). If it opened an act window, the fresh hint
    // would match the very tool input that retrieved it.
    h.telemetry.recordHookHints("r1", [{ id: "m1", score: 120 }]);

    const episodes = h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse kickstart",
      session_id: "sess-4",
    });

    assert.deepEqual(episodes, []);
    assert.deepEqual((await h.events()).filter((e) => e.kind === "hint_followed_shadow"), []);
  } finally {
    await h.cleanup();
  }
});

test("a hint without distinctive tokens opens no window", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-5");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: [] }], "sess-5");
    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "anything at all",
      session_id: "sess-5",
    });
    assert.deepEqual((await h.events()).filter((e) => e.kind === "hint_followed_shadow"), []);
  } finally {
    await h.cleanup();
  }
});

test("the breaker's used condition is untouched — Package 2 delivers a number, not a change", async () => {
  const src = await readFile(fileURLToPath(new URL("../src/hint-suppression.ts", import.meta.url)), "utf8");
  const used = src.split("\n").find((l) => l.includes("const used ="));
  assert.ok(used, "the used condition is gone from hint-suppression.ts");
  assert.equal(
    used!.trim(),
    "const used = (entry?.revision_loaded ?? 0) > 0 || (entry?.revision_acted_on ?? 0) > 0;",
    "#484 stays open until 10.09.: the shadow signal must not feed the breaker",
  );
});

function memoryMarkdown(id: string, body: string): string {
  const ts = new Date().toISOString();
  return [
    "---", `id: ${id}`, `title: ${id}`, "type: lesson",
    "summary: prevent duplicate daemon startup when the port is taken",
    "topic_path:", "  - test", "tags:", "  - test", "scope: hint-shadow-test",
    "recall_when:", `  - ${id}`, `created: ${ts}`, `updated: ${ts}`, "---",
    "", body, "",
  ].join("\n");
}

function httpPost(port: number, path: string, payload: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() } },
      (res) => { res.on("data", () => undefined); res.on("end", () => resolve(res.statusCode ?? 0)); },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

test("POST /hook/hinted opens the window with tokens the daemon derived itself", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-hintshadow-vault-"));
  const logDir = await mkdtemp(join(tmpdir(), "bastra-hintshadow-logs-"));
  await writeFile(join(dir, "m1.md"), memoryMarkdown("m1", "Body words nobody ever sees: portrace eaddrinuse kickstart."), "utf8");
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const telemetry = new Telemetry({ logDir });
  const handle = await startHttpServer({
    port: 0, vault, search, telemetry, version: "test",
    toolDeps: { vault, search, telemetry, vaultPath: dir },
    documentWriteEnabled: false,
    embedding: { on: false, providerId: null, source: "none" },
  });
  try {
    telemetry.rotateTurn("sess-http");
    assert.equal(await httpPost(handle.port!, "/hook/hinted", { ids: ["m1"], session_id: "sess-http" }), 200);

    const episodes = telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "checking the duplicate daemon startup guard",
      session_id: "sess-http",
    });
    assert.deepEqual(episodes, [], "an injected hint must not become a recall_episode");

    let rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const files = await readdir(logDir).catch(() => [] as string[]);
      rows = [];
      for (const f of files) {
        const raw = await readFile(join(logDir, f), "utf8");
        for (const line of raw.split("\n").filter(Boolean)) rows.push(JSON.parse(line));
      }
    }
    const shadow = rows.filter((e) => e.kind === "hint_followed_shadow");
    assert.equal(shadow.length, 1);
    assert.equal(shadow[0]!.memory_id, "m1");
    assert.equal(shadow[0]!.followed, true, "the user followed the summary — the only text that was shown");
  } finally {
    search.stop();
    await vault.stop?.();
    await handle.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(logDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("review find 1: no session id, no window — a parallel session must not close it", async () => {
  const h = await harness();
  try {
    // What `reportHinted` sent before the fix: ids only.
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], null);
    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse from a different session",
      session_id: "someone-else",
    });
    assert.deepEqual(
      (await h.events()).filter((e) => e.kind === "hint_followed_shadow"),
      [],
      "an entry on an inferred turn is closable by any session — better no number than a wrong one",
    );
  } finally {
    await h.cleanup();
  }
});

test("review find 3: a hint that is loaded leaves the shadow population", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-load");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-load");
    // The user opens it explicitly — from here on `acted_on` can see it.
    h.telemetry.recordLoadedMemory({
      memory_id: "m1",
      distinctive_tokens: TOKENS,
      hook_hint: null,
      session_id: "sess-load",
    });

    const episodes = h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse now applied",
      session_id: "sess-load",
    });

    assert.equal(episodes.length, 1, "the load still produces its recall_episode");
    assert.equal(episodes[0]!.acted_on, true);
    assert.deepEqual(
      (await h.events()).filter((e) => e.kind === "hint_followed_shadow"),
      [],
      "'followed without ever being loaded' must not count a memory that was loaded",
    );
  } finally {
    await h.cleanup();
  }
});

test("second review find 1: a session id without a turn opens no window", async () => {
  const h = await harness();
  try {
    // SessionStart, or right after a daemon restart: the id is real, but no
    // UserPromptSubmit has rotated a turn for it yet. `currentTurn` would fall
    // back to an inferred turn, which the session lock does not protect.
    h.telemetry.rotateTurn("some-other-session");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "fresh-session");

    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse in a parallel session",
      session_id: "some-other-session",
    });

    assert.deepEqual((await h.events()).filter((e) => e.kind === "hint_followed_shadow"), []);
  } finally {
    await h.cleanup();
  }
});

test("second review find 3: a body without tokens still leaves the shadow population", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-terse");
    // Title and summary carry distinctive words, so a window opens.
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-terse");
    // The BODY is terse — recordLoadedMemory returns before the token gate.
    h.telemetry.recordLoadedMemory({
      memory_id: "m1",
      distinctive_tokens: [],
      hook_hint: null,
      session_id: "sess-terse",
    });

    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse applied after the load",
      session_id: "sess-terse",
    });

    assert.deepEqual(
      (await h.events()).filter((e) => e.kind === "hint_followed_shadow"),
      [],
      "it was loaded — the early return on an empty body must not keep it in the count",
    );
  } finally {
    await h.cleanup();
  }
});

test("second review find 2: the visible id matches, the hidden title does not", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-hintshadow-vis-"));
  const logDir = await mkdtemp(join(tmpdir(), "bastra-hintshadow-vislogs-"));
  // What the lanes print is `id (type): summary` — never the title, never the body.
  const ts = new Date().toISOString();
  await writeFile(join(dir, "portrace-eaddrinuse.md"), [
    "---", "id: portrace-eaddrinuse", "title: Daemon startup race", "type: lesson",
    "summary: Exit before initialization", "topic_path:", "  - test", "tags:", "  - test",
    "scope: hint-shadow-test", "recall_when:", "  - portrace", `created: ${ts}`, `updated: ${ts}`,
    "---", "", "Body words nobody sees: kickstart bootstrap.", "",
  ].join("\n"), "utf8");
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const telemetry = new Telemetry({ logDir });
  const handle = await startHttpServer({
    port: 0, vault, search, telemetry, version: "test",
    toolDeps: { vault, search, telemetry, vaultPath: dir },
    documentWriteEnabled: false,
    embedding: { on: false, providerId: null, source: "none" },
  });
  try {
    telemetry.rotateTurn("sess-vis");
    await httpPost(handle.port!, "/hook/hinted", { ids: ["portrace-eaddrinuse"], session_id: "sess-vis" });

    // The reader followed the id they saw on screen.
    telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "looking into portrace eaddrinuse",
      session_id: "sess-vis",
    });

    let rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const files = await readdir(logDir).catch(() => [] as string[]);
      rows = [];
      for (const f of files) {
        const raw = await readFile(join(logDir, f), "utf8");
        for (const line of raw.split("\n").filter(Boolean)) rows.push(JSON.parse(line));
      }
    }
    const shadow = rows.filter((e) => e.kind === "hint_followed_shadow");
    assert.equal(shadow.length, 1);
    assert.equal(shadow[0]!.followed, true, "the id is on screen and its words must count");
  } finally {
    search.stop();
    await vault.stop?.();
    await handle.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(logDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("third review find 1: a load in session A leaves session B's window intact", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-A");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-A");
    h.telemetry.rotateTurn("sess-B");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-B");

    // A opens it explicitly. That says nothing about B.
    h.telemetry.recordLoadedMemory({
      memory_id: "m1",
      distinctive_tokens: TOKENS,
      hook_hint: null,
      session_id: "sess-A",
    });

    // B follows its own hint without ever loading.
    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse as B saw it",
      session_id: "sess-B",
    });

    const shadow = (await h.events(1)).filter((e) => e.kind === "hint_followed_shadow");
    assert.equal(shadow.length, 1, "B's measurement must survive A's load");
    assert.equal(shadow[0]!.followed, true);
  } finally {
    await h.cleanup();
  }
});

test("no recall provenance is attached — one slot per id cannot be trusted", async () => {
  const h = await harness();
  try {
    h.telemetry.rotateTurn("sess-A");
    h.telemetry.recordHookHints("recall-A", [{ id: "m1", score: 150 }]);
    // Overlapping tool calls, same session or another one: hookHints keeps a
    // single slot per memory id, so this overwrites recall-A.
    h.telemetry.recordHookHints("recall-B", [{ id: "m1", score: 40 }]);

    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-A");
    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse in session A",
      session_id: "sess-A",
    });

    const shadow = (await h.events(1)).filter((e) => e.kind === "hint_followed_shadow");
    assert.equal(shadow.length, 1);
    assert.equal(shadow[0]!.recall_id, undefined, "the field is gone rather than wrong");
  } finally {
    await h.cleanup();
  }
});

test("fourth review find: a load without a session clears every window for that memory", async () => {
  const h = await harness();
  try {
    // The standalone stdio surface calls loadMemoryHandler with no session
    // (index.ts:578-580), while its own hook opened the window under a real one.
    h.telemetry.rotateTurn("sess-standalone");
    h.telemetry.recordSurfacedHints([{ memory_id: "m1", distinctive_tokens: TOKENS }], "sess-standalone");

    h.telemetry.recordLoadedMemory({
      memory_id: "m1",
      distinctive_tokens: TOKENS,
      hook_hint: null,
      session_id: null,
    });

    h.telemetry.matchLoadedMemories({
      tool_name: "Edit",
      tool_input_excerpt: "portrace eaddrinuse after the standalone load",
      session_id: "sess-standalone",
    });

    assert.deepEqual(
      (await h.events()).filter((e) => e.kind === "hint_followed_shadow"),
      [],
      "it was loaded — a sessionless load must not leave the claim standing",
    );
  } finally {
    await h.cleanup();
  }
});
