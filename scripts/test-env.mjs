/**
 * Test-run isolation for anything that writes user data.
 *
 * `new Telemetry()` resolves its log dir at construction: BASTRA_LOG_PATH, else
 * ~/.bastra/logs. 22 test files construct one without redirecting it, so a plain
 * `npm test` appended 114 real telemetry events to the developer's own log —
 * 63 save_memory, 25 recall, 2 recall_episode carrying the fixture id "m1".
 *
 * That is not cosmetic. The event log is an INPUT: `bastra logs --stats` reports
 * from it, and `bastra bridges mint` mines it for (query → acted-on memory) reaches
 * and writes the resulting bridges into the Commons clone. Fixture rows in that log
 * become fixture bridges staged for contribution, and every measurement taken over
 * the log is contaminated by however many times the suite happened to run.
 *
 * Fixing this per-file would need 22 edits and would silently regress the next time
 * someone adds a 23rd. Redirecting once, here, closes the class: a test process
 * that did not deliberately choose a log dir gets a throwaway one. Files that set
 * BASTRA_LOG_PATH themselves are untouched — this only fills in the default.
 *
 * Wired via `--import` in the root `test` script, so it applies to every per-file
 * test process the runner spawns.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.BASTRA_LOG_PATH) {
  process.env.BASTRA_LOG_PATH = mkdtempSync(join(tmpdir(), "bastra-test-logs-"));
}
