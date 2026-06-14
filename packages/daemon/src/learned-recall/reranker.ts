/**
 * Teacher 2 (#120): a local LLM reranker over a recall's candidate pool. For a far
 * query whose right memory ranked low, a stronger model picks which candidate truly
 * answers it — the offline judgment the bi-encoder/BM25 couldn't make. Runs on a LOCAL
 * Ollama chat model (default qwen3-vl:4b), so it stays OSS-autonomous: no API key, no
 * cloud, no egress. Offline + hard-cases-only, per zzallirog's design.
 *
 * The chat call is injected (ChatFn) so the prompt-building and answer-parsing are
 * unit-testable without a running model.
 */

export interface RerankCandidate {
  id: string;
  /** Short text the model judges against the query (title + summary). */
  text: string;
}

export interface RerankResult {
  /** The candidate the model judged best, or null when it found none fitting. */
  bestId: string | null;
  /** 1-based rank the chosen candidate had in the input pool (1 = was already top). */
  chosenRank: number | null;
}

/** Injectable chat function: prompt in, raw model reply out. */
export type ChatFn = (prompt: string) => Promise<string>;

export const DEFAULT_RERANK_MODEL = "qwen3-vl:4b";

/**
 * The reranker sends candidate memory text to the chat endpoint, so a non-loopback
 * `baseURL` means that text leaves the machine. The header contract is "no egress" —
 * this enforces it: stay on loopback by default, reach a remote endpoint only when the
 * operator opts in explicitly (BASTRA_ALLOW_REMOTE_OLLAMA=1). Guards against a mistyped
 * or injected BASTRA_OLLAMA_URL silently shipping memory off-box. Malformed URLs fall
 * through so the existing fetch path reports them as before. Exported for tests.
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
    `bastra-recall: refusing non-loopback Ollama endpoint "${host}" — the reranker would ` +
      `send memory text off-box. Set BASTRA_ALLOW_REMOTE_OLLAMA=1 to use a remote endpoint on purpose.`,
  );
}

/** A live Ollama chat client (POST /api/chat, non-streaming). */
export function ollamaChat(opts: { baseURL?: string; model?: string; timeoutMs?: number } = {}): ChatFn {
  const baseURL = (opts.baseURL ?? process.env.BASTRA_OLLAMA_URL ?? "http://localhost:11434").replace(/\/+$/, "");
  assertLocalOrOptIn(baseURL);
  const model = opts.model ?? process.env.BASTRA_RERANK_MODEL ?? DEFAULT_RERANK_MODEL;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return async (prompt: string): Promise<string> => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`${baseURL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { temperature: 0 },
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error(`Ollama chat HTTP ${resp.status}`);
      const json = (await resp.json()) as { message?: { content?: string } };
      return json.message?.content ?? "";
    } finally {
      clearTimeout(tid);
    }
  };
}

/** Build the RankGPT-light prompt: query + numbered candidates, pick-one-or-none. */
export function buildRerankPrompt(query: string, candidates: RerankCandidate[]): string {
  const list = candidates.map((c, i) => `${i + 1}. ${c.text.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
  return [
    "A user searched their personal memory with this query:",
    `"${query}"`,
    "",
    "Candidate memories (numbered):",
    list,
    "",
    `Which single candidate best answers the query? Reply with ONLY the number (1-${candidates.length}), or 0 if none truly fits.`,
  ].join("\n");
}

/** Parse the model's reply to a 1-based index, or null (0 / no number / out of range). */
export function parseRerankAnswer(answer: string, n: number): number | null {
  const m = answer.match(/\d+/);
  if (!m) return null;
  const num = parseInt(m[0], 10);
  if (num < 1 || num > n) return null;
  return num; // 1-based
}

/**
 * Ask the reranker which pooled candidate best answers the query. Returns the chosen
 * candidate's id and the rank it had in the pool — so the caller can tell a "far"
 * rescue (model picked a low-ranked candidate) from a no-op (it picked the top one).
 */
export async function rerank(query: string, candidates: RerankCandidate[], chat: ChatFn): Promise<RerankResult> {
  if (candidates.length === 0) return { bestId: null, chosenRank: null };
  const answer = await chat(buildRerankPrompt(query, candidates));
  const idx1 = parseRerankAnswer(answer, candidates.length);
  if (idx1 === null) return { bestId: null, chosenRank: null };
  return { bestId: candidates[idx1 - 1].id, chosenRank: idx1 };
}
