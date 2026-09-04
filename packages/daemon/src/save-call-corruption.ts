/**
 * Detect the Claude/MCP failure where native JSON tool arguments switch into
 * legacy XML inside the first multiline string. The lost siblings never reach
 * Zod, so a generic "received undefined" message sends the model into a retry
 * loop. Detection is deliberately narrow: required fields must be absent and
 * the surviving string must contain structural tags for at least two of them.
 */
const REQUIRED_SAVE_FIELDS = [
  "title",
  "type",
  "summary",
  "body",
  "topic_path",
  "tags",
  "scope",
  "recall_when",
] as const;

export interface SaveCallCorruption {
  missing: string[];
  swallowed: string[];
  container: string;
}

const tagFor = (field: string): RegExp =>
  new RegExp(`(?:<|&lt;)\\/?${field}(?:\\s|>|&gt;)|(?:<|&lt;)parameter\\s+name=["']${field}["']`, "i");

export function detectSaveCallCorruption(raw: unknown): SaveCallCorruption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const args = raw as Record<string, unknown>;
  const missing = REQUIRED_SAVE_FIELDS.filter((field) => args[field] === undefined);
  if (missing.length === 0) return null;
  for (const [container, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    const swallowed = missing.filter((field) => tagFor(field).test(value));
    if (swallowed.length >= 2) return { missing: [...missing], swallowed, container };
  }
  return null;
}

export function saveCallCorruptionMessage(corruption: SaveCallCorruption): string {
  return (
    `save_memory arguments were corrupted before validation: ${corruption.swallowed.join(", ")} ` +
    `were embedded as XML inside '${corruption.container}' instead of arriving as JSON properties ` +
    `(missing required fields: ${corruption.missing.join(", ")}). NOTHING WAS SAVED. ` +
    `This is a caller-side MCP serialization failure, not a vault or schema rejection. ` +
    `STOP retrying this call in the current session; start a fresh client session, update the client if possible, and retry once.`
  );
}
