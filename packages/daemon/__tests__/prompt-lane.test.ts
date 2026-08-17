/**
 * Tests for the UserPromptSubmit lane (Issue #33; daemon-side since #343).
 *
 * Strategy: unit-test the pure helpers (detectRetrieval, extractPrompt,
 * formatHintBlock) directly, then run the full pipeline via `runPromptLane`
 * in-process against a mock HTTP server. The mock serves the same
 * /hook/recall + /hook/reflex + /hook/hinted endpoints as in the CLI era —
 * the lane still reaches them over loopback, so the request assertions kept
 * their meaning across the migration. The thin CLI's own stdin→stdout
 * behaviour is covered separately in prompt-hook.test.ts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectAssertion,
  detectRetrieval,
  effectiveScoreFloor,
  extractPrompt,
  formatHintBlock,
  formatReflexBlock,
  isTrivialPrompt,
  runPromptLane,
  MUST_LOAD_SCORE,
  type PromptReflexHit,
  type RecallHit,
} from "../src/prompt-lane.ts";
import { decideBackoff, type SourceBackoff } from "../src/session-state.ts";

// ─── Pure unit tests ─────────────────────────────────────────────────────

test("detectRetrieval — DE triggers match", () => {
  const cases = [
    "such mal meinen Strafzettel",
    "Suche nach Rechnungen von 2024",
    "finde alle PDFs zum Mietvertrag",
    "wo ist meine Steuererklärung?",
    "wo sind die Notizen vom Meeting?",
    "wann war der letzte Arzttermin?",
    "wann hatte ich Urlaub im Juli?",
    "wieviel habe ich für Strom bezahlt?",
    "wie viel Miete im März?",
    "was habe ich zum Architekt gesagt?",
    "Was hab ich gestern gemacht?",
    "was war der Stand bei der Steuer?",
  ];
  for (const c of cases) {
    assert.equal(detectRetrieval(c), true, `expected retrieval match for: ${c}`);
  }
});

test("detectRetrieval — EN triggers match", () => {
  const cases = [
    "find the parking ticket pdf",
    "search invoices from last quarter",
    "where is the lease agreement?",
    "where are the meeting notes?",
    "when was the last vet visit?",
    "when did I sign the contract?",
    "how much did I spend on rent?",
    "what did I tell the architect?",
    "what was the status on the tax filing?",
  ];
  for (const c of cases) {
    assert.equal(detectRetrieval(c), true, `expected retrieval match for: ${c}`);
  }
});

test("detectRetrieval — non-retrieval prompts skip", () => {
  const cases = [
    "bitte schreib mir einen Hook",
    "implement a UserPromptSubmit handler",
    "lass uns über das design reden",
    "refactor the daemon",
    "thanks!",
    "",
    "   ",
    "ok",
    "go ahead",
    "machen wir das so",
  ];
  for (const c of cases) {
    assert.equal(detectRetrieval(c), false, `expected NO retrieval match for: ${c}`);
  }
});

// ─── assertion lane (#252) ───────────────────────────────────────────────────

test("detectAssertion — outbound writing requests match", () => {
  const cases = [
    "draft a reply to zzallirog's field report",
    "write the release notes for v0.9",
    "schreib mir bitte die Release Notes",
    "verfasse einen Kommentar zu #257",
    "antworte auf den Discord-Thread",
    "compose an announcement for the blog",
    "entwirf die PR description",
    "beantworte die Mail",
  ];
  for (const c of cases) {
    assert.equal(detectAssertion(c), true, `expected assertion match for: ${c}`);
  }
});

test("detectAssertion — project-state questions match", () => {
  const cases = [
    "what's the state of our recall@pool measurement?",
    "how good are the eval numbers right now",
    "wie ist der Stand beim v0.9 Milestone",
    "wie viele Tests haben wir",
  ];
  for (const c of cases) {
    assert.equal(detectAssertion(c), true, `expected assertion match for: ${c}`);
  }
});

test("detectAssertion — a bare composing verb is not a trigger", () => {
  // The lane that fires on every declarative prompt is the noise #252 warns
  // about: two signals required, never the verb alone.
  const cases = [
    "write a helper that parses the frontmatter",
    "schreib die Funktion neu",
    "draft the migration in typescript",
    "fix the failing test",
    "was hältst du davon",
    "refactor curator.ts",
    "",
  ];
  for (const c of cases) {
    assert.equal(detectAssertion(c), false, `expected NO assertion match for: ${c}`);
  }
});

test("detectAssertion — retrieval wins the classification", () => {
  // "how much …" is both; the hook checks retrieval first, so the lookup
  // instruction is what the agent sees.
  const prompt = "how much did the release cost";
  assert.equal(detectRetrieval(prompt), true);
});

test("effectiveScoreFloor — assertion recalls at the retrieval floor, not the generic one", () => {
  assert.equal(effectiveScoreFloor("assertion"), effectiveScoreFloor("retrieval"));
  assert.notEqual(effectiveScoreFloor("assertion"), effectiveScoreFloor("generic"));
});

test("formatHintBlock — assertion mode forbids asserting from memory and names the alternative", () => {
  const hits: RecallHit[] = [
    { id: "pool-measurement", title: "P", type: "project-fact", scope: "p", summary: "96 of 103", score: 120 },
  ];
  const block = formatHintBlock(hits, "bastra-recall", "assertion");
  assert.match(block, /makes a CLAIM/);
  assert.match(block, /Do NOT assert numbers/);
  assert.match(block, /do not know instead of guessing/);
  assert.match(block, /pool-measurement/);
  assert.doesNotMatch(block, /LOOKUP \/ retrieval query/);
});

test("extractPrompt — prefers payload.prompt", () => {
  assert.equal(extractPrompt({ prompt: "hello", user_message: "ignored" }), "hello");
});

test("extractPrompt — falls back to user_message", () => {
  assert.equal(extractPrompt({ user_message: "fallback" }), "fallback");
});

test("extractPrompt — empty/missing returns null", () => {
  assert.equal(extractPrompt({}), null);
  assert.equal(extractPrompt({ prompt: "" }), null);
  assert.equal(extractPrompt({ prompt: "   " }), null);
});

test("formatHintBlock — retrieval mode includes lookup instruction", () => {
  const hits: RecallHit[] = [
    {
      id: "test-memory",
      title: "Test",
      type: "lesson",
      scope: "user",
      summary: "Summary of the lesson",
      score: 120,
    },
  ];
  const block = formatHintBlock(hits, "myproject", "retrieval");
  assert.match(block, /<recall-hints surface="claude-code" trigger="prompt-lookup"/);
  assert.match(block, /project="myproject"/);
  assert.match(block, /LOOKUP \/ retrieval query/);
  assert.match(block, /bastra-recall:recall.*BEFORE conversation_search/i);
  assert.match(block, /test-memory/);
  assert.match(block, /<\/recall-hints>/);
});

test("formatHintBlock — separates strong vs OPTIONAL by score", () => {
  const hits: RecallHit[] = [
    { id: "high", title: "H", type: "lesson", scope: "user", summary: "high", score: 150 },
    { id: "mid", title: "M", type: "lesson", scope: "user", summary: "mid", score: 70 },
  ];
  const block = formatHintBlock(hits, null, "retrieval");
  // #302: the headline states arm agreement now, not strength — the score is a
  // rank sum and never carried the claim "Strong matches" made. The split this
  // test guards is unchanged; only its anchor moved off the retired wording.
  const strongIdx = block.indexOf("Both search paths agreed");
  const optionalIdx = block.indexOf("OPTIONAL");
  assert.ok(strongIdx >= 0, "required-band section missing");
  assert.ok(optionalIdx > strongIdx, "OPTIONAL must come after the required-band section");
  assert.ok(!block.includes("Strong matches"), "#302: strength is not what the score measures");
  assert.ok(block.indexOf("high") < block.indexOf("mid"));
  // Hints must read as non-coercive (no "REQUIRED"/"not allowed" wording).
  assert.ok(!block.includes("REQUIRED"), "must not use coercive REQUIRED wording");
  assert.ok(!block.includes("not allowed"), "must not use coercive 'not allowed' wording");
});

test("formatReflexBlock — reflex frame with matched trigger phrase (#217)", () => {
  const hits: PromptReflexHit[] = [
    {
      id: "reflex-css-lesson",
      title: "CSS-Spezifität",
      type: "lesson",
      scope: "all-projects",
      summary: "Inline style schlägt Tailwind-Hover immer.",
      matched_phrase: "tailwind grid",
    },
  ];
  const block = formatReflexBlock(hits, "myproject");
  assert.match(block, /<recall-hints surface="claude-code" trigger="reflex"/);
  assert.match(block, /project="myproject"/);
  assert.match(block, /reflex-css-lesson \(lesson, trigger "tailwind grid"\)/);
  assert.match(block, /load_memory\(id\) before answering/);
  assert.match(block, /<\/recall-hints>/);
  // Hints must read as non-coercive, wie formatHintBlock.
  assert.ok(!block.includes("REQUIRED"));
});

// ─── Integration test via mock daemon ────────────────────────────────────

function startMockDaemon(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  return new Promise<{ port: number; close: () => Promise<void> }>((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      ok({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * #343: the pipeline these tests exercise is `runPromptLane`, in-process. The
 * mock daemon stays IDENTICAL to the CLI era — the lane still reaches recall,
 * reflex and hinted over loopback HTTP, so every request assertion below keeps
 * meaning what it meant. env vars are applied around the call and restored,
 * mirroring what the spawned CLI inherited before.
 */
async function runHook(
  payload: object,
  env: Record<string, string>,
): Promise<{ stdout: string }> {
  const applied: Record<string, string | undefined> = {};
  const withDefaults: Record<string, string> = { BASTRA_TELEMETRY: "off", ...env };
  for (const [k, v] of Object.entries(withDefaults)) {
    applied[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const baseUrl = withDefaults.BASTRA_HTTP_URL ?? "http://127.0.0.1:1";
    const stdout = await runPromptLane(payload as Parameters<typeof runPromptLane>[0], null, baseUrl);
    return { stdout };
  } finally {
    for (const [k, v] of Object.entries(applied)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("integration — retrieval prompt yields recall-hints block", async () => {
  let received: { url: string | undefined; body: unknown } | null = null;
  const daemon = await startMockDaemon((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      // The hook now also fires a /hook/hinted usage ping (#154) and the
      // reflex probe (#217) — only the recall request is what this test
      // asserts on; the reflex lane answers empty here.
      if (req.url === "/hook/recall") received = { url: req.url, body: JSON.parse(body) };
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/hook/reflex") {
        res.end('{"hits":[],"recall_id":null}');
        return;
      }
      res.end(
        JSON.stringify({
          hits: [
            {
              id: "parkticket-2025",
              title: "Strafzettel März 2025",
              type: "project-fact",
              scope: "personal",
              summary: "Parkverstoß Berlin Mitte, 35€, bezahlt 2025-03-12.",
              score: 142,
            },
          ],
          vault_size: 100,
          latency_ms: 12,
          recall_id: "test-recall",
        }),
      );
    });
  });

  try {
    const { stdout } = await runHook(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "such mal meinen Strafzettel",
        cwd: process.cwd(),
      },
      { BASTRA_HTTP_URL: `http://127.0.0.1:${daemon.port}` },
    );

    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string; hookEventName?: string };
    };
    assert.ok(parsed.hookSpecificOutput, "hook should emit hookSpecificOutput");
    assert.equal(parsed.hookSpecificOutput?.hookEventName, "UserPromptSubmit");
    const ctx = parsed.hookSpecificOutput?.additionalContext ?? "";
    assert.match(ctx, /parkticket-2025/);
    assert.match(ctx, /trigger="prompt-lookup"/);
    assert.match(ctx, /BEFORE conversation_search/);

    assert.ok(received, "mock daemon should have received request");
    const r = received as { url: string | undefined; body: { query: string; k: number } };
    assert.equal(r.url, "/hook/recall");
    assert.equal(r.body.query, "such mal meinen Strafzettel");
    assert.equal(r.body.k, 5);
  } finally {
    await daemon.close();
  }
});

test("integration — non-retrieval prompt emits empty object", async () => {
  // #217: die Reflex-Lane pingt den Daemon jetzt bei JEDEM non-trivialen
  // Prompt — nur der Recall-Endpoint darf ohne Retrieval-Signal still bleiben.
  let recallCalled = false;
  const daemon = await startMockDaemon((req, res) => {
    if (req.url === "/hook/recall") recallCalled = true;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/hook/reflex") {
      res.end('{"hits":[],"recall_id":null}');
      return;
    }
    res.end('{"hits":[],"vault_size":0,"latency_ms":1,"recall_id":"x"}');
  });
  try {
    const { stdout } = await runHook(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "lass uns das implementieren",
        cwd: process.cwd(),
      },
      { BASTRA_HTTP_URL: `http://127.0.0.1:${daemon.port}` },
    );
    assert.equal(stdout.trim(), "{}");
    assert.equal(recallCalled, false, "recall must not be called when no retrieval signal");
  } finally {
    await daemon.close();
  }
});

test("integration — reflex hit fires without a retrieval signal (#217)", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "bastra-reflex-state-"));
  let recallCalled = false;
  let hintedIds: string[] | null = null;
  const daemon = await startMockDaemon((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (req.url === "/hook/recall") recallCalled = true;
      if (req.url === "/hook/hinted") hintedIds = (JSON.parse(body) as { ids: string[] }).ids;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/hook/reflex") {
        res.end(
          JSON.stringify({
            hits: [
              {
                id: "reflex-css-lesson",
                title: "CSS-Spezifität",
                type: "lesson",
                scope: "all-projects",
                summary: "Inline style schlägt Tailwind-Hover immer.",
                matched_phrase: "tailwind grid",
              },
            ],
            recall_id: "reflex-1",
          }),
        );
        return;
      }
      res.end('{"ok":true}');
    });
  });
  try {
    const { stdout } = await runHook(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "lass uns das tailwind grid implementieren",
        cwd: process.cwd(),
        session_id: "reflex-session",
      },
      {
        BASTRA_HTTP_URL: `http://127.0.0.1:${daemon.port}`,
        BASTRA_HOOK_STATE_DIR: stateDir,
      },
    );
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const ctx = parsed.hookSpecificOutput?.additionalContext ?? "";
    assert.match(ctx, /trigger="reflex"/);
    assert.match(ctx, /reflex-css-lesson/);
    assert.match(ctx, /trigger "tailwind grid"/);
    assert.equal(recallCalled, false, "no retrieval signal → recall stays silent");
    assert.deepEqual(hintedIds, ["reflex-css-lesson"], "reflex injection counts as surfaced");
  } finally {
    await daemon.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("integration — wrong hook_event_name emits empty object", async () => {
  const daemon = await startMockDaemon((_req, res) => {
    res.writeHead(200);
    res.end("{}");
  });
  try {
    const { stdout } = await runHook(
      { hook_event_name: "PreToolUse", prompt: "such mal meinen Strafzettel" },
      { BASTRA_HTTP_URL: `http://127.0.0.1:${daemon.port}` },
    );
    assert.equal(stdout.trim(), "{}");
  } finally {
    await daemon.close();
  }
});

// ─── #151: trivial-prompt gate ───────────────────────────────────────────

test("isTrivialPrompt gates bare acks DE+EN (trailing punctuation tolerated)", () => {
  for (const p of ["ok", "OK!", "ja", "Ja.", "danke", "passt", "yes", "thanks", "weiter", "nö", "go"]) {
    assert.equal(isTrivialPrompt(p), true, `should gate: ${p}`);
  }
});

test("isTrivialPrompt gates slash-command invocations, typed and expanded", () => {
  assert.equal(isTrivialPrompt("/fast"), true);
  assert.equal(isTrivialPrompt("/code-review ultra 123"), true);
  assert.equal(isTrivialPrompt("<command-name>/effort</command-name>\nstdout follows"), true);
  assert.equal(isTrivialPrompt("<local-command-caveat>...</local-command-caveat>"), true);
});

test("isTrivialPrompt does NOT gate paths, retrieval queries, or real prose", () => {
  assert.equal(isTrivialPrompt("/Users/n0mad/Projekte/x bitte lesen"), false);
  assert.equal(isTrivialPrompt("find my rental contract"), false);
  assert.equal(isTrivialPrompt("such mal meinen mietvertrag"), false);
  assert.equal(isTrivialPrompt("wo ist die config für den daemon"), false);
  assert.equal(isTrivialPrompt("ok, aber warum schlägt der test fehl?"), false);
});

test("gate wins over retrieval regex on expanded command payloads", () => {
  // An expanded slash-command payload whose body happens to contain a
  // retrieval-shaped phrase must still be gated — the phrase is skill/command
  // scaffolding, not user intent.
  const payload = "<command-name>/deep-research</command-name>\nfind all sources about X";
  assert.equal(isTrivialPrompt(payload), true);
});

// ─── #161: backoff safety — retrieval exemption + generic-mode invariant ──

test("#161 — generic mode floors at MUST_LOAD_SCORE: suppression impossible by construction", () => {
  // Every hit surviving the generic floor sits in the REQUIRED band …
  assert.ok(
    effectiveScoreFloor("generic") >= MUST_LOAD_SCORE,
    "generic floor must be >= MUST_LOAD_SCORE — this is what makes the invariant hold",
  );
  // … so hasRequired is true for any non-empty generic emission, and the
  // shared decideBackoff can never suppress it — whatever the streak says.
  const hotEntries: SourceBackoff[] = [
    { streak: 2, at: Date.now() - 1000, ids: ["x"], skipped: 0 },
    { streak: 50, at: Date.now() - 1000, ids: ["x"], skipped: 0 },
  ];
  for (const e of hotEntries) {
    assert.equal(decideBackoff(e, false, false).suppress, true, "precondition: would suppress");
    assert.equal(decideBackoff(e, false, true).suppress, false, "REQUIRED band bypasses");
  }
});

test("integration — #161: retrieval lookup is NEVER suppressed, even in a hot suppression window", async () => {
  // Pre-seed a prompt-lookup backoff state that would suppress a generic
  // emission (streak far above BACKOFF_MIN_STREAK, window wide open).
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const stateDir = await mkdtemp(join(tmpdir(), "bastra-prompt-backoff-"));
  const sessionId = "prompt-backoff-retrieval-exempt";
  await writeFile(
    join(stateDir, `${sessionId}.json`),
    JSON.stringify({
      shown: {},
      sources: {
        "prompt-lookup": { streak: 6, at: Date.now() - 1000, ids: ["old-hit"], skipped: 0 },
      },
    }),
    "utf8",
  );

  const daemon = await startMockDaemon((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/hook/recall") {
      // Sub-REQUIRED score (70 < MUST_LOAD_SCORE): the emission must survive
      // via the retrieval exemption itself, not via the hasRequired bypass.
      res.end(
        JSON.stringify({
          hits: [
            {
              id: "lease-2024",
              title: "Mietvertrag 2024",
              type: "project-fact",
              scope: "personal",
              summary: "Mietvertrag Hauptstr. 5, unterschrieben 2024-01-15.",
              score: 70,
            },
          ],
          vault_size: 50,
          latency_ms: 5,
          recall_id: "t",
        }),
      );
    } else {
      res.end("{}");
    }
  });

  try {
    const { stdout } = await runHook(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "such mal meinen Mietvertrag",
        session_id: sessionId,
        cwd: process.cwd(),
      },
      {
        BASTRA_HTTP_URL: `http://127.0.0.1:${daemon.port}`,
        BASTRA_HOOK_STATE_DIR: stateDir,
      },
    );
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    assert.ok(parsed.hookSpecificOutput, "retrieval lookup must emit — never suppressed");
    assert.match(parsed.hookSpecificOutput?.additionalContext ?? "", /lease-2024/);
  } finally {
    await daemon.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});
