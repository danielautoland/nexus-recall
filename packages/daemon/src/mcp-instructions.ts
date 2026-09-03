/**
 * MCP InitializeResult instructions are injected into every fresh client session.
 * Keep this policy narrower than tool availability: a tool being present is not
 * permission to use it reflexively or to write to the user's memory.
 */
export const SERVER_INSTRUCTIONS =
  "bastra-recall is the user's persistent local memory, not default context. Call `recall` only when " +
  "the user explicitly asks for memory or history, or a named durable fact is needed but absent from " +
  "both the prompt and its named live source. For a current file, repository, runtime or service, read " +
  "the live source first. Do not search supplied logs, URLs, uploads, generic questions or ordinary " +
  "current-state work. Make at most one Recall call per turn; load only 1-2 directly relevant hits. " +
  "Never save memory automatically: save only when the user explicitly asks.";
