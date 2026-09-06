/**
 * The canonical list of MCP tool definitions the daemon exposes — the single
 * source of truth for both the embedded server (index.ts), the stdio forwarder
 * (mcp-forwarder.ts), and the `GET /tools` endpoint (http.ts).
 *
 * Why one place: the forwarder used to ship its OWN static copy of this list,
 * so the schema a client saw came from the forwarder's build while validation
 * happened at the daemon. A long-lived shared daemon running older code in RAM
 * (it deliberately doesn't restart on a dist rebuild — the update-staged
 * pattern) could then validate against a schema that differed from what the
 * client was told — surfacing as "argument X arrives undefined" (#132). The
 * forwarder now fetches /tools from the daemon, so the schema the client sees
 * always matches the validator; this constant is the fallback when the daemon
 * isn't reachable yet.
 */
import { requiredFieldsOf } from "./call-corruption.js";
import { MEMORY_TOOL_DEFS } from "./tool-handlers.js";
import { documentTools } from "./documents-handler.js";
import { documentWriteTools } from "./documents-write-handler.js";
import { productDocTools } from "./product-doc-handler.js";

export const ALL_TOOL_DEFS = [
  ...MEMORY_TOOL_DEFS,
  ...documentTools,
  ...documentWriteTools,
  ...productDocTools,
];

/**
 * #482: what each tool needs, resolved ONCE at module load — the corrupted-
 * arguments check runs on every tool call, so it must not rebuild anything.
 * Derived from the definitions above rather than a hand-kept constant, so a
 * new tool is covered the moment it is declared.
 */
export const TOOL_ARG_EXPECTATIONS: ReadonlyMap<string, { required: readonly string[]; readOnly: boolean }> =
  new Map(
    ALL_TOOL_DEFS.map((def) => [
      def.name,
      {
        required: requiredFieldsOf(def),
        readOnly: (def as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true,
      },
    ]),
  );
