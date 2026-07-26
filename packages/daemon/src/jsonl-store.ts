/**
 * Fail-loud JSONL append/read (#274).
 *
 * Cut in advance of the affirm log (#198) and the provenance review log
 * (#271) after the substrate question was asked and answered: there is no
 * shared event substrate. Strip both consumers of everything only one of them
 * needs and what survives is "append a line, read the lines back, and fail
 * loudly instead of silently" — two file functions with no event vocabulary in
 * them. Record shape, clocks, dedup and projection all stay in the consumer.
 *
 * The one genuinely shared property is that errors propagate. That inverts
 * this repo's default: the usage sidecar is best-effort by contract
 * (usage-sidecar.ts), the floors registry treats a corrupt file as empty
 * (floors.ts), and telemetry swallows write failures. Correct there — a broken
 * counter must never break a tool call. Wrong for a decision log: #198's
 * outbox contract needs the caller to re-queue when a write fails, and a
 * silent "corrupt → empty" would discard an entire confirmation history
 * rather than surface it.
 *
 * Limits, stated so nobody has to read the source to find them:
 * - Single writer per file. No cross-process lock exists in core or daemon,
 *   and this does not add one; concurrent appenders from separate processes
 *   can interleave partial lines.
 * - No fsync. A crash between the append returning and the page cache
 *   flushing can lose the last record.
 * - A torn or malformed last line is skipped on read, not repaired.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Appends one JSON line. Creates the directory (0700) and the file (0600) if
 * they are missing. Every failure — unserialisable value, permissions, full
 * disk — reaches the caller.
 */
export async function appendJsonl(path: string, obj: unknown): Promise<void> {
  const line = JSON.stringify(obj);
  if (typeof line !== "string") {
    // JSON.stringify returns undefined for undefined, functions and symbols.
    // Writing the string "undefined" would be the silent corruption this
    // module exists to avoid.
    throw new TypeError(`jsonl: value is not JSON-serialisable (${path})`);
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, line + "\n", { encoding: "utf8", mode: 0o600 });
}

/**
 * Reads every record the guard accepts, in file order.
 *
 * A missing file is an empty log — the normal state before the first write.
 * Any other read error throws: an unreadable decision log is a fault to
 * report, not an empty history to carry on with. Individual lines that fail
 * to parse or fail the guard are skipped, so one torn tail does not cost the
 * records before it.
 */
export async function readJsonl<T>(path: string, isT: (v: unknown) => v is T): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }

  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isT(parsed)) out.push(parsed);
  }
  return out;
}
