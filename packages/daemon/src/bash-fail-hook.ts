#!/usr/bin/env node
/**
 * bastra-recall bash-fail-hook — THIN CLIENT (#343 pattern).
 *
 * The post-Bash pipeline (act-signal #144, gates incl. invokesOwnBinary,
 * throttle, fail-recall, backoff) lives daemon-side in `bash-fail-lane.ts`
 * behind POST /hook/bash-fail. The gates moved WITH it: `invokesOwnBinary`
 * exists because an imprecise gate once swallowed ~75% of commands — gate
 * logic that can be wrong must stay hot-swappable, not baked into a
 * compiled stub (#344).
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
    emitOnce(await postLane(daemonBaseUrl(), "/hook/bash-fail", { payload }, remainingMs));
  } catch (err) {
    // See bash-pre-hook.ts for why connection failures skip client telemetry.
    void classifyTransportError(err as NodeJS.ErrnoException);
    emitOnce("{}");
  }
}

const isCliEntry = (process.argv[1] ?? "").endsWith("bash-fail-hook.js") || (process.argv[1] ?? "").endsWith("bash-fail-hook.ts");

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
