/**
 * #356: the Stop hook's save_eval_call event must carry the Claude Code
 * session_id from the payload — before the fix every Stop stamped a fresh
 * randomUUID(), so per-session aggregation over the Stop lane was impossible.
 *
 * The hook is a stdin→stdout CLI without an in-process runner, so this test
 * spawns it the way Claude Code does, against a throwaway log dir.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hookSrc = join(here, "..", "src", "stop-hook.ts");

function runStopHook(payload: object, env: Record<string, string>): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      ["--import", "tsx", hookSrc],
      { env: { ...process.env, ...env }, timeout: 20_000 },
      (_err, stdout) => resolve({ stdout: String(stdout), code: child.exitCode }),
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}

test("#356 — save_eval_call carries the payload session_id, not a synthetic one", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "bastra-stop-telemetry-"));
  const pendingPath = join(logDir, "pending.json");
  try {
    const { stdout } = await runStopHook(
      {
        hook_event_name: "Stop",
        session_id: "stop-sess-356",
        cwd: process.cwd(),
        transcript: [
          { role: "user", content: "please run the tests" },
          { role: "assistant", content: "done, all green" },
        ],
      },
      {
        BASTRA_TELEMETRY: "on",
        BASTRA_LOG_PATH: logDir,
        BASTRA_PENDING_SUGGESTIONS_PATH: pendingPath,
        // drift fetch must fail fast, not find a real daemon
        BASTRA_HTTP_URL: "http://127.0.0.1:1",
      },
    );
    assert.equal(stdout.trim(), "{}", "the Stop hook stays silent on stdout");

    const files = (await readdir(logDir)).filter((n) => n.startsWith("events-") && n.endsWith(".jsonl"));
    assert.equal(files.length, 1, "exactly one day file written");
    const events = (await readFile(join(logDir, files[0]), "utf8"))
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const ev = events.find((e) => e.kind === "save_eval_call");
    assert.ok(ev, "a save_eval_call event must be written");
    assert.equal(ev.session_id, "stop-sess-356");
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});
