/**
 * Detect the Claude/MCP failure where native JSON tool arguments switch into
 * legacy XML inside the first multiline string. The lost siblings never reach
 * Zod, so a generic "received undefined" message sends the model into a retry
 * loop. Detection is deliberately narrow: required fields must be absent and
 * the surviving string must contain structural tags for at least two of them.
 *
 * #482: this is a TRANSPORT failure, not a save failure — it hits every tool
 * with more than one parameter in exactly the same way. `save_memory` is only
 * where it was noticed, because it has the most parameters and the longest
 * values. The expected fields therefore come in as an argument, taken from
 * each tool's own `inputSchema.required`, so a new tool is covered without
 * anyone remembering to add it.
 *
 * The narrowness is the load-bearing part: a false positive here would mask a
 * genuine validation error, which is worse than the generic message.
 */

export interface CallCorruption {
  missing: string[];
  swallowed: string[];
  container: string;
}

const tagFor = (field: string): RegExp =>
  new RegExp(`(?:<|&lt;)\\/?${field}(?:\\s|>|&gt;)|(?:<|&lt;)parameter\\s+name=["']${field}["']`, "i");

export function detectCallCorruption(raw: unknown, requiredFields: readonly string[]): CallCorruption | null {
  if (requiredFields.length === 0) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const args = raw as Record<string, unknown>;
  const missing = requiredFields.filter((field) => args[field] === undefined);
  if (missing.length === 0) return null;
  for (const [container, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    const swallowed = missing.filter((field) => tagFor(field).test(value));
    if (swallowed.length >= 2) return { missing: [...missing], swallowed, container };
  }
  return null;
}

export function callCorruptionMessage(
  tool: string,
  corruption: CallCorruption,
  /** A read tool writes nothing, so claiming "nothing was saved" there would be
   *  its own small lie. Taken from the tool's own `annotations.readOnlyHint`. */
  readOnly = false,
): string {
  const nothingHappened = readOnly ? "THE CALL DID NOT RUN." : "NOTHING WAS SAVED.";
  return (
    `${tool} arguments were corrupted before validation: ${corruption.swallowed.join(", ")} ` +
    `were embedded as XML inside '${corruption.container}' instead of arriving as JSON properties ` +
    `(missing required fields: ${corruption.missing.join(", ")}). ${nothingHappened} ` +
    `This is a caller-side MCP serialization failure, not a vault or schema rejection. ` +
    `STOP retrying this call in the current session; start a fresh client session, update the client if possible, and retry once.`
  );
}

/** `inputSchema.required` of a tool definition, or an empty list. */
export function requiredFieldsOf(def: { inputSchema?: Record<string, unknown> } | undefined): string[] {
  const required = def?.inputSchema?.required;
  return Array.isArray(required) ? required.filter((f): f is string => typeof f === "string") : [];
}

/**
 * The boundary check: resolve the tool's own required fields once, then throw
 * the honest diagnosis instead of letting Zod report anonymous "received
 * undefined" lines. Returns silently for unknown tools and for anything that
 * does not match the narrow shape.
 */
export function assertCallNotCorrupted(
  tool: string,
  args: unknown,
  defs: ReadonlyMap<string, { required: readonly string[]; readOnly: boolean }>,
): void {
  const def = defs.get(tool);
  if (!def) return;
  const corruption = detectCallCorruption(args, def.required);
  if (corruption) throw new Error(callCorruptionMessage(tool, corruption, def.readOnly));
}
