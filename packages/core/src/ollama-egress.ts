/**
 * Egress contract for the local Ollama endpoint.
 *
 * Both the reranker (chat, candidate text) and the embedding provider (query +
 * memory text) talk to Ollama at `BASTRA_OLLAMA_URL`. The documented contract is
 * "no API key, no cloud, no egress" — the text stays on the machine. But the URL
 * is a free-form env var, so a mistyped or injected value would silently ship
 * memory text off-box.
 *
 * This is the single shared assertion that enforces the contract: stay on
 * loopback by default, reach a remote endpoint only when the operator opts in
 * explicitly (BASTRA_ALLOW_REMOTE_OLLAMA=1). Malformed URLs fall through so the
 * existing fetch path reports them exactly as before (behaviour unchanged).
 *
 * Lives in core (the lower layer) so the daemon reranker and the core embedding
 * provider share one guard instead of each re-implementing it.
 */
export function assertLocalOrOptIn(rawUrl: string): void {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return; // not a parseable URL — let fetch fail normally, behaviour unchanged
  }
  const isLoopback =
    host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);
  if (isLoopback || process.env.BASTRA_ALLOW_REMOTE_OLLAMA === "1") return;
  throw new Error(
    `bastra-recall: refusing non-loopback Ollama endpoint "${host}" — this would ` +
      `send memory text off-box. Set BASTRA_ALLOW_REMOTE_OLLAMA=1 to use a remote endpoint on purpose.`,
  );
}
