import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { unlink } from "node:fs/promises";
import {
  readExitCode,
  extractErrorContext,
  extractCommandHead,
  extractErrorKeywords,
  formatHintBlock,
  isThrottled,
  markThrottle,
  throttleFile,
} from "../src/bash-fail-hook.js";

const SESSION = "test-session-fail-hook";

async function clearThrottle(): Promise<void> {
  try {
    await unlink(throttleFile(SESSION));
  } catch {
    // ignore
  }
}

describe("bash-fail-hook: readExitCode", () => {
  it("reads exit_code from numeric field", () => {
    assert.equal(readExitCode({ exit_code: 1 }), 1);
  });
  it("reads from camelCase exitCode", () => {
    assert.equal(readExitCode({ exitCode: 2 }), 2);
  });
  it("parses string exit codes", () => {
    assert.equal(readExitCode({ exit_code: "127" }), 127);
  });
  it("returns null when missing", () => {
    assert.equal(readExitCode({}), null);
  });
});

describe("bash-fail-hook: extractCommandHead", () => {
  it("returns first 3 tokens of first clause", () => {
    assert.equal(extractCommandHead("npm install --save react"), "npm install --save");
  });
  it("stops at pipeline operators", () => {
    assert.equal(extractCommandHead("ls -la | grep foo"), "ls -la");
  });
});

describe("bash-fail-hook: extractErrorContext", () => {
  it("prefers error/Failed/fatal lines", () => {
    const out = extractErrorContext({
      stderr: "doing things\nthings happen\nError: ENOENT no such file\ndone",
    });
    assert.match(out, /Error: ENOENT/);
  });
  it("falls back to tail when no interesting lines", () => {
    const out = extractErrorContext({ stderr: "plain noise" });
    assert.equal(out, "plain noise");
  });
});

describe("bash-fail-hook: extractErrorKeywords", () => {
  it("extracts alpha-token keywords, deduped, capped", () => {
    const out = extractErrorKeywords("Error: ENOENT module not found react react react");
    assert.match(out, /Error/);
    assert.match(out, /ENOENT/);
    assert.match(out, /module/);
    // dedup: 'react' should appear once
    assert.equal((out.match(/react/g) ?? []).length, 1);
  });
});

describe("bash-fail-hook: formatHintBlock", () => {
  it("emits bash-fail trigger and the failure-mode wording", () => {
    const out = formatHintBlock([
      {
        id: "some-lesson",
        title: "t",
        type: "lesson",
        scope: "all",
        summary: "s",
        score: 80,
      },
    ]);
    assert.match(out, /trigger="bash-fail"/);
    assert.match(out, /failure modes/);
    assert.match(out, /some-lesson/);
  });
});

describe("bash-fail-hook: throttle", () => {
  beforeEach(async () => {
    await clearThrottle();
  });

  it("is not throttled before any markThrottle call", async () => {
    assert.equal(await isThrottled(SESSION), false);
  });

  it("is throttled immediately after markThrottle", async () => {
    await markThrottle(SESSION);
    assert.equal(await isThrottled(SESSION), true);
  });
});

// ─── #144: act-signal integration (mock daemon + spawned hook) ────────────

import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __dirname144 = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH_144 = resolvePath(__dirname144, "..", "src", "bash-fail-hook.ts");

interface SeenRequest {
  path: string;
  body: Record<string, unknown>;
}

function startRecordingDaemon(): Promise<{ port: number; seen: SeenRequest[]; close: () => Promise<void> }> {
  const seen: SeenRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/hook/act") res.end(JSON.stringify({ matched: 0 }));
      else res.end(JSON.stringify({ hits: [], vault_size: 0, latency_ms: 1, recall_id: "t" }));
    });
  });
  return new Promise((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      ok({ port, seen, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

function runFailHook(payload: object, port: number): Promise<string> {
  return new Promise((ok, ko) => {
    const child = spawn("npx", ["tsx", HOOK_PATH_144], {
      env: { ...process.env, BASTRA_HTTP_URL: `http://127.0.0.1:${port}`, BASTRA_TELEMETRY: "off" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.on("error", ko);
    child.on("close", () => ok(stdout));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("bash-fail-hook: #144 act-signal", () => {
  it("successful command sends /hook/act only and emits {}", async () => {
    const daemon = await startRecordingDaemon();
    try {
      const stdout = await runFailHook(
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: `act-ok-${Date.now()}`,
          tool_input: { command: "npm test" },
          tool_response: { exit_code: 0 },
        },
        daemon.port,
      );
      assert.equal(stdout.trim(), "{}");
      const paths = daemon.seen.map((r) => r.path);
      assert.deepEqual(paths, ["/hook/act"]);
      assert.equal(daemon.seen[0].body.tool_input_excerpt, "npm test");
      assert.equal(daemon.seen[0].body.exit_code, 0);
    } finally {
      await daemon.close();
    }
  });

  it("failed command sends /hook/act AND the fail-recall", async () => {
    const daemon = await startRecordingDaemon();
    try {
      await runFailHook(
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: `act-fail-${Date.now()}`,
          tool_input: { command: "npm run build" },
          tool_response: { exit_code: 1, stderr: "Error: tsc failed with TS2304" },
        },
        daemon.port,
      );
      const paths = daemon.seen.map((r) => r.path);
      assert.deepEqual(paths, ["/hook/act", "/hook/recall"]);
      assert.equal(daemon.seen[0].body.exit_code, 1);
    } finally {
      await daemon.close();
    }
  });

  it("Ctrl-C (130) sends nothing at all", async () => {
    const daemon = await startRecordingDaemon();
    try {
      const stdout = await runFailHook(
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: `act-int-${Date.now()}`,
          tool_input: { command: "npm run dev" },
          tool_response: { exit_code: 130 },
        },
        daemon.port,
      );
      assert.equal(stdout.trim(), "{}");
      assert.equal(daemon.seen.length, 0);
    } finally {
      await daemon.close();
    }
  });
});
