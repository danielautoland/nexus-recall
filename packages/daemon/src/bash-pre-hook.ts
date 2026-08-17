#!/usr/bin/env node
/**
 * bastra-recall bash-pre-hook — THIN CLIENT (#343 pattern).
 *
 * The tripwire pipeline (pattern tables, recall, STOP/CAUTION formatting)
 * lives daemon-side in `bash-pre-lane.ts` behind POST /hook/bash-pre. The
 * pattern tables moved WITH it on purpose: a new risky-command pattern must
 * never require a stub rebuild (#344), so this client has no content gate —
 * it forwards every Bash PreToolUse payload and the lane answers `{}` for
 * non-matching commands in under a millisecond of daemon work.
 *
 * Discipline: fail open to `{}` on every path, exit 0, stdlib only.
 */
import { envInt } from "./env.js";
import { readStdin, daemonBaseUrl, postLane, classifyTransportError } from "./thin-client.js";

const HOOK_TIMEOUT_MS = envInt("BASTRA_HOOK_TIMEOUT_MS", 500, "NEXUS_HOOK_TIMEOUT_MS");

let stdoutEmitted = false;
function emitOnce(payload: string): void {
  if (stdoutEmitted) return;
  stdoutEmitted = true;
  process.stdout.write(payload);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const raw = await readStdin();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return emitOnce("{}");
  }
  const remainingMs = Math.max(50, HOOK_TIMEOUT_MS - (Date.now() - startedAt));
  try {
    emitOnce(await postLane(daemonBaseUrl(), "/hook/bash-pre", { payload }, remainingMs));
  } catch (err) {
    // Connection failures are not separately logged here: unlike the
    // write/prompt lanes this one has no skip telemetry to keep consistent,
    // and a down daemon already shows up in every other lane's client events.
    void classifyTransportError(err as NodeJS.ErrnoException);
    emitOnce("{}");
  }
}

const isCliEntry = (process.argv[1] ?? "").endsWith("bash-pre-hook.js") || (process.argv[1] ?? "").endsWith("bash-pre-hook.ts");

if (isCliEntry) {
  const killSwitch = setTimeout(() => {
    emitOnce("{}");
    process.exit(0);
  }, HOOK_TIMEOUT_MS + 50);
  killSwitch.unref();

  main()
    .then(() => process.exit(0))
    .catch(() => {
      emitOnce("{}");
      process.exit(0);
    });
}
